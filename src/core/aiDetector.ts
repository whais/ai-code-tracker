import * as vscode from 'vscode';
import * as fs from 'fs';
import { MarkPatternManager } from './markPatternManager';

export class AIDetector {
  private static patternManager = MarkPatternManager.getInstance();

  static hasHeaderAIMark(filePath: string): boolean {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      
      // 检查前30行
      for (let i = 0; i < Math.min(30, lines.length); i++) {
        const line = lines[i];
        
        // JSDoc 头部
        if (line.trim().startsWith('/**') && this.patternManager.hasAIMark(line)) {
          return true;
        }
        
        // 单行头部
        if (this.patternManager.hasAIMark(line) && 
            (line.trim().startsWith('//') || line.trim().startsWith('#') || 
            line.includes('<!--'))) {
          return true;
        }
      }
    } catch (error) {
      console.error(`读取文件失败: ${filePath}`, error);
    }
    return false;
  }

  // 检测 JSON 文件是否有对应的 .generated 标记文件
  static hasGeneratedMarkerFile(filePath: string): boolean {
    const generatedFilePath = filePath + '.generated';
    try {
      if (fs.existsSync(generatedFilePath)) {
        const content = fs.readFileSync(generatedFilePath, 'utf-8');
        // 检查 .generated 文件是否包含 AI 标记
        return this.patternManager.hasAIMark(content) || 
               content.includes('@ai-generated') ||
               content.includes('[AI-GEN]');
      }
    } catch (error) {
      console.error(`读取 .generated 文件失败: ${generatedFilePath}`, error);
    }
    return false;
  }

  // 检测文件是否是 AI 生成的（包括 .generated 标记）
  static isAIGeneratedFile(filePath: string): boolean {
    // 检查 .generated 标记文件
    if (this.hasGeneratedMarkerFile(filePath)) {
      return true;
    }
    
    // 检查头部标记
    if (this.hasHeaderAIMark(filePath)) {
      return true;
    }
    
    // 检查文件内容的前20行
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      
      for (let i = 0; i < Math.min(20, lines.length); i++) {
        if (this.patternManager.hasAIMark(lines[i])) {
          return true;
        }
      }
    } catch (error) {
      console.error(`读取文件失败: ${filePath}`, error);
    }
    
    return false;
  }

  static detectSource(text: string): string | null {
    const result = this.patternManager.detectMark(text);
    if (result && result.name !== 'human') {
      return result.name;
    }
    return null;
  }

  static hasAIMark(document: vscode.TextDocument, startLine: number, endLine?: number): boolean {
    const checkStart = Math.max(0, startLine - 5);
    const checkEnd = endLine !== undefined ? endLine : startLine;
    const lineCount = document.lineCount;
    for (let i = checkStart; i <= Math.min(checkEnd, lineCount - 1); i++) {
      const line = document.lineAt(i).text;
      if (this.patternManager.hasAIMark(line)) {
        return true;
      }
    }
    return false;
  }

  static hasHumanMark(document: vscode.TextDocument, startLine: number, endLine?: number): boolean {
    const checkStart = Math.max(0, startLine - 5);
    const checkEnd = endLine !== undefined ? endLine : startLine;
    const lineCount = document.lineCount;
    for (let i = checkStart; i <= Math.min(checkEnd, lineCount - 1); i++) {
      const line = document.lineAt(i).text;
      if (this.patternManager.hasHumanMark(line)) {
        return true;
      }
    }
    return false;
  }

  static getAIModel(line: string): string | null {
    return this.patternManager.getModelName(line);
  }

  static detectCodeLine(line: string): boolean {
    // 检测是否是代码行（用于启发式检测）
    const patterns = [
      /function\s+\w+\s*\([^)]*\)\s*{/,
      /def\s+\w+\s*\([^)]*\):/,
      /class\s+\w+/,
      /\/\/\s*(TODO|FIXME|NOTE):/,
      /\*\*\/?/,
      /""".*?"""/,
      /const\s+\w+\s*=\s*\([^)]*\)\s*=>/,
      /export\s+(default\s+)?(class|function|const)/,
      /import\s+.*\s+from\s+['"]/,
      /require\s*\(/
    ];
    
    return patterns.some(pattern => pattern.test(line));
  }

  /**
   * 启发式检测大模型插件生成的代码
   * 基于代码特征、体积和上下文判断是否是 AI 生成的代码
   */
  static detectAIGeneratedCode(text: string, languageId: string): { isAI: boolean; confidence: number; reason: string } {
    const lines = text.split('\n');
    const totalLines = lines.length;
    
    // 1. 检查是否包含已有的 AI 标记
    if (this.patternManager.hasAIMark(text)) {
      return { isAI: false, confidence: 0, reason: 'already_marked' };
    }
    
    // 2. 计算代码特征分数
    let codeLineCount = 0;
    let importLineCount = 0;
    let functionCount = 0;
    let classCount = 0;
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === '') continue;
      
      // 代码行
      if (this.detectCodeLine(line)) {
        codeLineCount++;
      }
      
      // import/require 行
      if (/^import\s+|^require\s*\(/.test(trimmed)) {
        importLineCount++;
      }
      
      // 函数定义
      if (/^(export\s+)?(async\s+)?function\s+\w+/.test(trimmed) ||
          /^(export\s+)?const\s+\w+\s*=\s*(async\s*)?\(/.test(trimmed) ||
          /^(export\s+)?async\s+\w+\(/.test(trimmed)) {
        functionCount++;
      }
      
      // 类定义
      if (/^(export\s+)?class\s+\w+/.test(trimmed)) {
        classCount++;
      }
    }
    
    // 3. 计算置信度
    let confidence = 0;
    const reasons: string[] = [];
    
    // 大量代码（超过 10 行有效代码）
    if (codeLineCount >= 10) {
      confidence += 30;
      reasons.push('large_code_block');
    }
    
    // 包含完整函数定义
    if (functionCount >= 1) {
      confidence += 25;
      reasons.push('has_function');
    }
    
    // 包含类定义
    if (classCount >= 1) {
      confidence += 20;
      reasons.push('has_class');
    }
    
    // 包含 import 语句（可能是新增文件或模块）
    if (importLineCount >= 1) {
      confidence += 15;
      reasons.push('has_imports');
    }
    
    // 代码结构完整（有代码行但注释比例适中）
    const codeRatio = totalLines > 0 ? codeLineCount / totalLines : 0;
    if (codeRatio > 0.3 && codeRatio < 0.9) {
      confidence += 10;
      reasons.push('good_structure');
    }
    
    // 4. 特殊模式检测（大模型常见代码模式）
    const aiPatterns = [
      /\/\/\s*@ts-ignore|@ts-expect-error/,  // TypeScript 忽略注释
      /console\.log\s*\(\s*['"`][\w\s]+['"`]\s*\)/,  // 调试日志
      /throw\s+new\s+(Error|TypeError|ReferenceError)/,  // 错误抛出
      /try\s*{\s*$/,  // try 块开始
      /catch\s*\(\s*\w+\s*\)/,  // catch 块
    ];
    
    for (const pattern of aiPatterns) {
      if (pattern.test(text)) {
        confidence += 5;
        reasons.push('ai_pattern');
        break;
      }
    }
    
    // 5. 根据文件类型调整阈值
    const highConfidenceLanguages = ['typescript', 'javascript', 'python', 'java', 'go', 'rust'];
    if (highConfidenceLanguages.includes(languageId)) {
      confidence += 10;
    }
    
    return {
      isAI: confidence >= 50,
      confidence,
      reason: reasons.join(',')
    };
  }

  static getCommentSyntax(languageId: string): string {
    const syntax: Record<string, string> = {
      'javascript': '//',
      'typescript': '//',
      'python': '#',
      'java': '//',
      'c': '//',
      'cpp': '//',
      'go': '//',
      'rust': '//',
      'ruby': '#',
      'php': '//',
      'html': '<!--',
      'css': '/*',
      'json': '//',
      'vue': '<!--',
      'jsx': '//',
      'tsx': '//'
    };
    return syntax[languageId] || '//';
  }

  static findUnmarkedAICode(lines: string[]): Array<{startLine: number, endLine: number}> {
    const blocks: Array<{startLine: number, endLine: number}> = [];
    let inCodeBlock = false;
    let blockStart = -1;
    let consecutiveCodeLines = 0;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const isAICodeLine = this.detectCodeLine(line);
      const hasMark = this.patternManager.hasAIMark(line);
      
      if (isAICodeLine && !hasMark && !inCodeBlock) {
        inCodeBlock = true;
        blockStart = i;
        consecutiveCodeLines = 1;
      } else if (isAICodeLine && !hasMark && inCodeBlock) {
        consecutiveCodeLines++;
      } else if ((!isAICodeLine || hasMark) && inCodeBlock) {
        // 代码块结束
        if (consecutiveCodeLines > 3) {
          // 检查块前面是否有标记
          let hasMarkBefore = false;
          for (let j = Math.max(0, blockStart - 5); j < blockStart; j++) {
            if (this.patternManager.hasAIMark(lines[j]) || this.patternManager.hasHumanMark(lines[j])) {
              hasMarkBefore = true;
              break;
            }
          }
          
          if (!hasMarkBefore) {
            blocks.push({ startLine: blockStart, endLine: i - 1 });
          }
        }
        inCodeBlock = false;
        consecutiveCodeLines = 0;
      }
    }
    
    // 处理文件末尾的代码块
    if (inCodeBlock && consecutiveCodeLines > 3) {
      let hasMarkBefore = false;
      for (let j = Math.max(0, blockStart - 5); j < blockStart; j++) {
        if (this.patternManager.hasAIMark(lines[j]) || this.patternManager.hasHumanMark(lines[j])) {
          hasMarkBefore = true;
          break;
        }
      }
      
      if (!hasMarkBefore) {
        blocks.push({ startLine: blockStart, endLine: lines.length - 1 });
      }
    }
    
    // 使用启发式检测过滤，只返回高置信度的 AI 代码块
    const filteredBlocks: Array<{startLine: number, endLine: number}> = [];
    for (const block of blocks) {
      const blockText = lines.slice(block.startLine, block.endLine + 1).join('\n');
      const detection = this.detectAIGeneratedCode(blockText, 'typescript'); // 使用通用类型
      
      // 只保留置信度 >= 40 的代码块
      if (detection.confidence >= 40) {
        filteredBlocks.push(block);
      }
    }
    
    return filteredBlocks;
  }

  static generateAIMark(languageId: string, model: string): string {
    return MarkPatternManager.getInstance().generateAIMark(languageId, model);
  }

  static generateHumanMark(languageId: string, author: string): string {
    return MarkPatternManager.getInstance().generateHumanMark(languageId, author);
  }
}