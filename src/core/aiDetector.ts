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

  static hasAIMark(document: vscode.TextDocument, startLine: number, endLine: number): boolean {
    const checkStart = Math.max(0, startLine - 5);
    for (let i = checkStart; i <= startLine; i++) {
      const line = document.lineAt(i).text;
      if (this.patternManager.hasAIMark(line)) {
        return true;
      }
    }
    return false;
  }

  static hasHumanMark(document: vscode.TextDocument, startLine: number, endLine: number): boolean {
    const checkStart = Math.max(0, startLine - 5);
    for (let i = checkStart; i <= startLine; i++) {
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
    
    return blocks;
  }

  static generateAIMark(languageId: string, model: string): string {
    return MarkPatternManager.getInstance().generateAIMark(languageId, model);
  }

  static generateHumanMark(languageId: string, author: string): string {
    return MarkPatternManager.getInstance().generateHumanMark(languageId, author);
  }
}