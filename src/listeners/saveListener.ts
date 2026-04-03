import * as vscode from 'vscode';
import { AIDetector } from '../core/aiDetector';
import { GitAnalyzer } from '../core/gitAnalyzer';

// [AI-GEN] model=detected-ai timestamp=2026-03-30T02:19:31.067Z
export class SaveListener {
  constructor(
    private gitAnalyzer: GitAnalyzer,
    private onMarkCode: (document: vscode.TextDocument, startLine: number, endLine: number, source: string) => Promise<void>
  ) {}

  // 文件大小限制：超过 100KB 的文件跳过检测
  private readonly MAX_FILE_SIZE = 100 * 1024;

  async handleDocumentSave(document: vscode.TextDocument): Promise<void> {
    // 检查文件大小，避免大文件性能问题
    const content = document.getText();
    if (content.length > this.MAX_FILE_SIZE) {
      console.log(`[SaveListener] ${document.fileName}: 文件过大 (${(content.length / 1024).toFixed(2)}KB)，跳过未标记代码检测`);
      return;
    }
    
    const lines = content.split('\n');
    const unmarkedBlocks = AIDetector.findUnmarkedAICode(lines);
    
    if (unmarkedBlocks.length === 0) return;
    
    const action = await vscode.window.showWarningMessage(
      `发现 ${unmarkedBlocks.length} 个未标记的 AI 代码块，是否标记？`,
      '标记所有',
      '逐个查看',
      '忽略'
    );
    
    if (action === '标记所有') {
      for (const block of unmarkedBlocks) {
        await this.onMarkCode(document, block.startLine, block.endLine, 'detected-ai');
      }
    } else if (action === '逐个查看') {
      const currentEditor = vscode.window.activeTextEditor;
      
      for (const block of unmarkedBlocks) {
        const mark = await vscode.window.showInformationMessage(
          `标记第 ${block.startLine + 1}-${block.endLine + 1} 行的代码块为 AI 生成？`,
          '标记',
          '跳过'
        );
        
        if (mark === '标记') {
          await this.onMarkCode(document, block.startLine, block.endLine, 'detected-ai');
        }
      }
      
      if (currentEditor) {
        await vscode.window.showTextDocument(currentEditor.document, {
          selection: currentEditor.selection
        });
      }
    }
  }
}