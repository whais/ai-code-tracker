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
    
    const totalAddedLines = changes.reduce((sum, change) => {
      const lines = change.text.split('\n').length;
      return sum + lines;
    }, 0);
    
    const config = vscode.workspace.getConfiguration('aiCodeTracker');
    const threshold = config.get('autoDetectThreshold', 3);
    
    if (totalAddedLines >= threshold) {
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
    const aiSource = AIDetector.detectSource(insertedText);
    
    if (aiSource) {
      const firstChange = changes[0];
      const startLine = firstChange.range.start.line;
      const endLine = firstChange.range.end.line + insertedText.split('\n').length - 1;
      const hasAIMark = AIDetector.hasAIMark(document, startLine, endLine);
      
      if (!hasAIMark) {
        const action = await vscode.window.showInformationMessage(
          `检测到来自 ${aiSource} 的代码，是否标记为 AI 生成？`,
          '标记为 AI 代码',
          '不标记',
          '总是自动标记'
        );
        
        if (action === '标记为 AI 代码') {
          await this.onAICodeDetected(aiSource, document, startLine, endLine);
          vscode.window.showInformationMessage(`✅ 已标记为 AI 生成代码 (${aiSource})`);
        } else if (action === '总是自动标记') {
          await this.onAICodeDetected(aiSource, document, startLine, endLine);
          const config = vscode.workspace.getConfiguration('aiCodeTracker');
          await config.update('autoMarkAI', true, vscode.ConfigurationTarget.Global);
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