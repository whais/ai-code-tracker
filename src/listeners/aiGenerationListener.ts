/**
 * AI代码生成监听器
 * 检测各种AI插件的代码生成事件
 */

import * as vscode from 'vscode';
import { LineTracker } from '../core/lineTracker';
import { logger } from '../utils/logger';

interface AIGenerationEvent {
  source: string;        // AI来源：copilot, tongyi, etc.
  model?: string;        // 模型版本
  confidence?: number;   // 置信度
  startLine: number;
  endLine: number;
  content: string;
  timestamp: number;
}

export class AIGenerationListener {
  private lineTracker: LineTracker;
  private disposables: vscode.Disposable[] = [];
  
  // 用于检测AI生成的启发式规则
  private lastEditTime: number = 0;
  private editHistory: { time: number; lines: number }[] = [];
  private readonly AI_TYPING_SPEED_THRESHOLD = 50; // 毫秒/字符，AI通常很快

  constructor(lineTracker: LineTracker) {
    this.lineTracker = lineTracker;
    this.registerListeners();
  }

  private registerListeners(): void {
    // 1. 监听文本变化
    const changeDisposable = vscode.workspace.onDidChangeTextDocument(
      event => this.handleTextChange(event)
    );
    this.disposables.push(changeDisposable);

    // 2. 监听命令执行（Copilot等会触发特定命令）
    const commandDisposable = vscode.commands.registerCommand(
      'ai-code-tracker.trackGeneration',
      (event: AIGenerationEvent) => this.handleAIGeneration(event)
    );
    this.disposables.push(commandDisposable);

    // 3. 监听接受内联建议（如果VSCode API支持）
    this.registerInlineCompletionListener();
  }

  /**
   * 处理文本变化，检测是否为AI生成
   */
  private handleTextChange(event: vscode.TextDocumentChangeEvent): void {
    // 跳过没有实际内容变化的
    if (event.contentChanges.length === 0) return;

    for (const change of event.contentChanges) {
      const insertedText = change.text;
      const lines = insertedText.split('\n');
      const lineCount = lines.length;
      const charCount = insertedText.length;

      // 启发式检测1：单次大量插入
      if (lineCount >= 3 && change.rangeLength === 0) {
        // 检测是否为AI特征
        if (this.isAIGenerationPattern(lines)) {
          const startLine = change.range.start.line;
          const endLine = startLine + lineCount - 1;
          
          logger.info(`[AIGenerationListener] 检测到AI生成代码: ${lineCount}行`);
          
          this.lineTracker.recordAIGeneration(
            event.document,
            startLine,
            endLine,
            this.detectAIModel(lines)
          );
          continue;
        }
      }

      // 启发式检测2：快速连续输入
      const now = Date.now();
      const timeDelta = now - this.lastEditTime;
      const typingSpeed = charCount / (timeDelta || 1); // 字符/毫秒

      if (typingSpeed > 1 / this.AI_TYPING_SPEED_THRESHOLD && lineCount > 1) {
        // 输入速度超过阈值，可能是AI
        logger.debug(`[AIGenerationListener] 快速输入检测: ${typingSpeed.toFixed(2)} 字符/ms`);
        
        // 结合其他特征确认
        if (this.hasAIFeatures(lines)) {
          const startLine = change.range.start.line;
          const endLine = startLine + lineCount - 1;
          
          this.lineTracker.recordAIGeneration(
            event.document,
            startLine,
            endLine,
            'detected-by-speed'
          );
        }
      }

      // 记录编辑历史
      this.editHistory.push({ time: now, lines: lineCount });
      this.lastEditTime = now;
      
      // 清理旧历史（保留最近1秒）
      this.editHistory = this.editHistory.filter(h => now - h.time < 1000);
    }
  }

  /**
   * 处理明确的AI生成事件（由其他插件主动调用）
   */
  private handleAIGeneration(event: AIGenerationEvent): void {
    logger.info(`[AIGenerationListener] 收到AI生成事件: ${event.source}`);
    
    // 获取文档
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    this.lineTracker.recordAIGeneration(
      editor.document,
      event.startLine,
      event.endLine,
      event.model || event.source
    );

    // 可以在这里添加上报逻辑
    this.reportAIGeneration(event);
  }

  /**
   * 检测是否为AI生成模式
   */
  private isAIGenerationPattern(lines: string[]): boolean {
    // 特征1：包含注释（AI喜欢生成注释）
    const hasComments = lines.some(line => 
      line.trim().startsWith('//') || 
      line.trim().startsWith('#') ||
      line.trim().startsWith('/*') ||
      line.includes('@param') ||
      line.includes('@return')
    );

    // 特征2：包含完整函数定义
    const hasFunctionDef = lines.some(line =>
      /^(export\s+)?(async\s+)?(function|def|class|const|let|var)\s+\w+/.test(line.trim())
    );

    // 特征3：包含JSDoc风格注释
    const hasJSDoc = lines.some(line =>
      line.includes('/**') || line.includes('* @')
    );

    // 特征4：代码结构完整（有开始有结束）
    const hasBraces = lines.some(line => line.includes('{')) && 
                      lines.some(line => line.includes('}'));

    // 综合判断：至少满足2个特征
    let score = 0;
    if (hasComments) score++;
    if (hasFunctionDef) score++;
    if (hasJSDoc) score++;
    if (hasBraces) score++;

    return score >= 2;
  }

  /**
   * 检测AI模型类型
   */
  private detectAIModel(lines: string[]): string {
    const content = lines.join('\n').toLowerCase();
    
    // 检测特定模式
    if (content.includes('copilot')) return 'copilot';
    if (content.includes('tongyi') || content.includes('通义')) return 'tongyi';
    if (content.includes('codeium')) return 'codeium';
    if (content.includes('tabnine')) return 'tabnine';
    if (content.includes('cursor')) return 'cursor';
    
    // 检测代码风格特征
    if (lines.some(l => l.includes('/**') && l.includes('@ai'))) return 'deepseek';
    
    return 'unknown-ai';
  }

  /**
   * 检查是否有AI特征
   */
  private hasAIFeatures(lines: string[]): boolean {
    return this.isAIGenerationPattern(lines);
  }

  /**
   * 注册内联补全监听器（VSCode 1.58+）
   */
  private registerInlineCompletionListener(): void {
    // 注意：VSCode目前不直接暴露内联补全API
    // 但可以通过监听特定命令或文本变化来间接检测
    
    // 监听 Copilot 的接受建议命令
    const copilotAcceptDisposable = vscode.workspace.onDidChangeTextDocument(event => {
      // Copilot 通常会在短时间内插入多行完整代码
      if (event.reason === vscode.TextDocumentChangeReason.Undo) return;
      
      // 这里可以添加更多Copilot特定的检测逻辑
    });
    
    this.disposables.push(copilotAcceptDisposable);
  }

  /**
   * 上报AI生成事件（用于统计）
   */
  private reportAIGeneration(event: AIGenerationEvent): void {
    // 可以在这里添加上报到服务器的逻辑
    logger.stats('ai-generation', {
      source: event.source,
      model: event.model,
      lines: event.endLine - event.startLine + 1,
      confidence: event.confidence
    });
  }

  /**
   * 手动标记代码为AI生成（供其他模块调用）
   */
  markAsAI(
    document: vscode.TextDocument,
    startLine: number,
    endLine: number,
    model: string = 'manual'
  ): void {
    this.lineTracker.recordAIGeneration(document, startLine, endLine, model);
    logger.info(`[AIGenerationListener] 手动标记AI代码: ${document.fileName} [${startLine}-${endLine}]`);
  }

  /**
   * 获取最近的编辑统计
   */
  getRecentEditStats(): { totalLines: number; editCount: number } {
    const now = Date.now();
    const recent = this.editHistory.filter(h => now - h.time < 5000); // 最近5秒
    
    return {
      totalLines: recent.reduce((sum, h) => sum + h.lines, 0),
      editCount: recent.length
    };
  }

  dispose(): void {
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
  }
}
