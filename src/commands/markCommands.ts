import * as vscode from 'vscode';
import { AIDetector } from '../core/aiDetector';
import { GitAnalyzer } from '../core/gitAnalyzer';
import { TeamStatsManager } from '../core/teamStats';
import { MarkPatternManager } from '../core/markPatternManager';

export class MarkCommands {
  constructor(
    private gitAnalyzer: GitAnalyzer,
    private statsManager: TeamStatsManager
  ) {}

  async markAsAI(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('请先打开一个文件');
      return;
    }
    
    const selection = editor.selection;
    if (selection.isEmpty) {
      vscode.window.showWarningMessage('请先选中要标记的代码');
      return;
    }
    
    const config = vscode.workspace.getConfiguration('aiCodeTracker');
    const markFormat = config.get<string>('markFormat', 'comment');
    
    let model = await vscode.window.showInputBox({
      prompt: '请输入AI模型名称',
      placeHolder: 'deepseek-v3, copilot, chatgpt...',
      value: 'deepseek-v3'
    });
    
    if (!model) return;
    
    const patternManager = MarkPatternManager.getInstance();
    
    // 获取作者信息
    let author: string | undefined;
    if (markFormat === 'block') {
      const savedAuthor = config.get<string>('blockMarkAuthor');
      if (savedAuthor) {
        author = savedAuthor;
      } else {
        const { getCurrentGitUser } = await import('../utils/git');
        const user = await getCurrentGitUser();
        author = user.name.split('@')[0] || user.email.split('@')[0];
      }
    }
    
    if (markFormat === 'block') {
      // 块标记模式：添加开始和结束标记
      const startMark = patternManager.generateAIMark(editor.document.languageId, model, {
        format: 'block',
        author: author,
        date: new Date()
      });
      
      const endMark = patternManager.generateEndMark(editor.document.languageId);
      
      await editor.edit(editBuilder => {
        // 在选中代码前添加开始标记
        editBuilder.insert(new vscode.Position(selection.start.line, 0), startMark + '\n');
        // 在选中代码后添加结束标记
        const endLine = selection.end.line + 1; // +1 因为插入了一行
        editBuilder.insert(new vscode.Position(endLine, 0), endMark + '\n');
      });
      
      vscode.window.showInformationMessage(`✅ 已标记代码块为AI生成 (${model}) by ${author || 'unknown'}`);
    } else {
      // 单行标记模式
      const aiMark = patternManager.generateAIMark(editor.document.languageId, model, {
        format: markFormat as any,
        author: author
      });
      
      await editor.edit(editBuilder => {
        editBuilder.insert(new vscode.Position(selection.start.line, 0), aiMark + '\n');
      });
      
      vscode.window.showInformationMessage(`✅ 已标记选中代码为AI生成 (${model})`);
    }
    
    await this.gitAnalyzer.analyzeFile(editor.document.fileName);
  }

  async markAsHuman(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('请先打开一个文件');
      return;
    }
    
    const selection = editor.selection;
    if (selection.isEmpty) {
      vscode.window.showWarningMessage('请先选中要标记的代码');
      return;
    }
    
    const author = await vscode.window.showInputBox({
      prompt: '请输入作者名称',
      placeHolder: 'your-name'
    });
    
    const markComment = AIDetector.getCommentSyntax(editor.document.languageId);
    const humanMark = `${markComment} [HUMAN] author=${author || 'unknown'} timestamp=${new Date().toISOString()}\n`;
    
    await editor.edit(editBuilder => {
      editBuilder.insert(new vscode.Position(selection.start.line, 0), humanMark);
    });
    
    await this.gitAnalyzer.analyzeFile(editor.document.fileName);
    vscode.window.showInformationMessage('✅ 已标记为人工编写代码');
  }

  async analyzeGitHistory(): Promise<void> {
    vscode.window.showInformationMessage('正在分析Git历史，这可能需要几分钟...');
    await this.gitAnalyzer.analyzeWorkspace();
    vscode.window.showInformationMessage('✅ Git历史分析完成！');
    // 触发统计更新
    this.statsManager.getStats(); // 确保统计已更新
  }

  async smartPaste(): Promise<void> {
    try {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('没有打开的编辑器');
        return;
      }
      
      const config = vscode.workspace.getConfiguration('aiCodeTracker');
      const clipboardText = await vscode.env.clipboard.readText();
      
      if (!clipboardText || clipboardText.trim() === '') {
        vscode.window.showWarningMessage('剪贴板为空');
        return;
      }
      
      const aiModel = AIDetector.detectSource(clipboardText);
      
      if (aiModel) {
        const selection = editor.selection;
        const startLine = selection.start.line;
        
        let hasMark = false;
        for (let i = Math.max(0, startLine - 5); i <= startLine; i++) {
          if (i >= editor.document.lineCount) break;
          const line = editor.document.lineAt(i).text;
          if (line.includes('[AI-GEN]')) {
            hasMark = true;
            break;
          }
        }
        
        if (!hasMark) {
          const autoMark = config.get('autoMarkAI', false);
          
          if (autoMark) {
            await this.pasteWithAIMark(editor, clipboardText, aiModel);
            vscode.window.showInformationMessage(`✅ 已自动标记为 AI 生成代码 (${aiModel})`);
            return;
          } else {
            const choice = await vscode.window.showInformationMessage(
              `检测到来自 ${aiModel} 的代码，是否标记为AI生成？`,
              '标记为AI代码',
              '不标记',
              '总是自动标记'
            );
            
            if (choice === '标记为AI代码') {
              await this.pasteWithAIMark(editor, clipboardText, aiModel);
              return;
            } else if (choice === '总是自动标记') {
              await this.pasteWithAIMark(editor, clipboardText, aiModel);
              await config.update('autoMarkAI', true, vscode.ConfigurationTarget.Global);
              vscode.window.showInformationMessage('✅ 已启用自动标记');
              return;
            }
          }
        }
      }
      
      // 没有检测到 AI 代码，执行普通粘贴
      await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
      
    } catch (error) {
      console.error('智能粘贴出错:', error);
      await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
    }
  }

  private async pasteWithAIMark(
    editor: vscode.TextEditor,
    clipboardText: string,
    model: string
  ): Promise<void> {
    const selection = editor.selection;
    const markComment = AIDetector.getCommentSyntax(editor.document.languageId);
    const aiMark = `${markComment} [AI-GEN] model=${model} timestamp=${new Date().toISOString()}\n`;
    const finalText = aiMark + clipboardText;
    
    await editor.edit(editBuilder => {
      if (selection.isEmpty) {
        editBuilder.insert(selection.active, finalText);
      } else {
        editBuilder.replace(selection, finalText);
      }
    });
    
    await this.gitAnalyzer.analyzeFile(editor.document.fileName);
  }
}