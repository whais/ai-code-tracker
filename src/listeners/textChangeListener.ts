import * as vscode from 'vscode';
import { AIDetector } from '../core/aiDetector';
import { GitAnalyzer } from '../core/gitAnalyzer';
import { PendingDetection } from '../types';

export class TextChangeListener {
  private pendingDetection: PendingDetection | null = null;

  constructor(
    private gitAnalyzer: GitAnalyzer,
    private onAICodeDetected: (source: string, document: vscode.TextDocument, startLine: number, endLine: number) => Promise<void>
  ) {}

  async handleTextChange(event: vscode.TextDocumentChangeEvent): Promise<void> {
    const document = event.document;
    const changes = event.contentChanges;
    
    if (changes.length === 0) return;
    
    const insertedText = changes.map(c => c.text).join('\n');
    const totalAddedLines = insertedText.split('\n').length;
    
    const config = vscode.workspace.getConfiguration('aiCodeTracker');
    const threshold = config.get('autoDetectThreshold', 3);
    
    // 检查是否应该触发检测
    let shouldDetect = totalAddedLines >= threshold;
    
    // 即使行数较少，如果启发式检测置信度很高，也触发检测
    if (!shouldDetect && totalAddedLines >= 1) {
      const detection = AIDetector.detectAIGeneratedCode(insertedText, document.languageId);
      if (detection.confidence >= 70) {
        shouldDetect = true;
      }
    }
    
    if (shouldDetect) {
      if (this.pendingDetection) {
        clearTimeout(this.pendingDetection.timeout);
      }
      
      const version = document.version;
      
      const timeout = setTimeout(async () => {
        if (document.version === version) {
          await this.detectAICodeInsertion(document, changes);
        }
        this.pendingDetection = null;
      }, 500);
      
      this.pendingDetection = { document, changes, timeout };
    }
  }

  private async detectAICodeInsertion(
    document: vscode.TextDocument,
    changes: readonly vscode.TextDocumentContentChangeEvent[]
  ): Promise<void> {
    const insertedText = changes.map(c => c.text).join('\n');
    
    // 1. 首先尝试检测文本中已有的 AI 标记
    let aiSource = AIDetector.detectSource(insertedText);
    let confidence = 100;
    let reason = 'detected_mark';
    
    // 2. 如果没有检测到标记，使用启发式检测
    if (!aiSource) {
      const detection = AIDetector.detectAIGeneratedCode(insertedText, document.languageId);
      if (detection.isAI) {
        aiSource = `ai-detected (${detection.confidence}%)`;
        confidence = detection.confidence;
        reason = detection.reason;
      }
    }
    
    if (aiSource) {
      const firstChange = changes[0];
      const startLine = firstChange.range.start.line;
      const endLine = firstChange.range.end.line + insertedText.split('\n').length - 1;
      const hasAIMark = AIDetector.hasAIMark(document, startLine, endLine);
      
      if (!hasAIMark) {
        const message = confidence === 100 
          ? `检测到来自 ${aiSource} 的代码，是否标记为 AI 生成？`
          : `检测到可能是 AI 生成的代码（置信度: ${confidence}%），是否标记？`;
        
        const action = await vscode.window.showInformationMessage(
          message,
          '标记为 AI 代码',
          '不标记',
          '总是自动标记'
        );
        
        if (action === '标记为 AI 代码' || action === '总是自动标记') {
          await this.onAICodeDetected(aiSource, document, startLine, endLine);
          vscode.window.showInformationMessage(`✅ 已标记为 AI 生成代码 (${aiSource})`);
          
          if (action === '总是自动标记') {
            const config = vscode.workspace.getConfiguration('aiCodeTracker');
            await config.update('autoMarkAI', true, vscode.ConfigurationTarget.Global);
          }
        }
      }
    }
  }

  dispose(): void {
    if (this.pendingDetection) {
      clearTimeout(this.pendingDetection.timeout);
      this.pendingDetection = null;
    }
  }
}