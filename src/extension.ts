import * as vscode from 'vscode';
import { TeamStatsManager } from './core/teamStats';
import { GitAnalyzer } from './core/gitAnalyzer';
import { StatusBarManager } from './ui/statusBar';
import { TextChangeListener } from './listeners/textChangeListener';
import { SaveListener } from './listeners/saveListener';
import { StatsCommands } from './commands/statsCommands';
import { MarkCommands } from './commands/markCommands';
import { ReportCommands } from './commands/reportCommands';
import { SettingsCommands } from './commands/settingsCommands';
import { registerCommands } from './commands';
import { initTeamConfig } from './utils/git';
import { AIDetector } from './core/aiDetector';
import { MarkPatternManager } from './core/markPatternManager';

let statsManager: TeamStatsManager;
let gitAnalyzer: GitAnalyzer;
let statusBarManager: StatusBarManager;
let textChangeListener: TextChangeListener;
let saveListener: SaveListener;
let statsCommands: StatsCommands;
let markCommands: MarkCommands;
let reportCommands: ReportCommands;
let settingsCommands: SettingsCommands;

export async function activate(context: vscode.ExtensionContext) {
  console.log('AI Code Tracker 已激活');
  
  // 初始化 MarkPatternManager（单例，会自动加载配置）
  const patternManager = MarkPatternManager.getInstance();
  
  // 监听配置变化
  const configChangeListener = vscode.workspace.onDidChangeConfiguration(event => {
    if (event.affectsConfiguration('aiCodeTracker.aiMarkPatterns') ||
        event.affectsConfiguration('aiCodeTracker.markFormat') ||
        event.affectsConfiguration('aiCodeTracker.customMarkTemplate')) {
      patternManager.loadPatterns();
      console.log('AI 标记配置已更新');
    }
  });
  context.subscriptions.push(configChangeListener);
  
  // 初始化核心组件
  statsManager = new TeamStatsManager();
  gitAnalyzer = new GitAnalyzer(statsManager.getStats(), () => {
    statusBarManager?.update();
  });
  
  // 初始化 UI
  statusBarManager = new StatusBarManager(statsManager);
  
  // 初始化命令
  statsCommands = new StatsCommands(statsManager);
  markCommands = new MarkCommands(gitAnalyzer, statsManager);
  reportCommands = new ReportCommands(statsManager, statsCommands, context);
  settingsCommands = new SettingsCommands();
  
  // 注册命令
  const commands = registerCommands(statsCommands, markCommands, reportCommands, settingsCommands);
  context.subscriptions.push(...commands);
  
  // 初始化监听器
  textChangeListener = new TextChangeListener(gitAnalyzer, async (source, document, startLine, endLine) => {
    await addAIMark(document, startLine, endLine, source);
  });
  saveListener = new SaveListener(gitAnalyzer, async (document, startLine, endLine, source) => {
    await addAIMark(document, startLine, endLine, source);
  });
  
  // 注册事件监听
  const textChangeDisposable = vscode.workspace.onDidChangeTextDocument(
    (e) => textChangeListener.handleTextChange(e)
  );
  const saveDisposable = vscode.workspace.onDidSaveTextDocument(
    (doc) => saveListener.handleDocumentSave(doc)
  );
  
  context.subscriptions.push(textChangeDisposable, saveDisposable);
  
  // 加载历史数据
  loadHistoricalData(context);
  
  // 初始化团队配置
  await initTeamConfig();
  
  // 分析当前工作区
  await gitAnalyzer.analyzeWorkspace();
  
  // 更新状态栏
  await statusBarManager.update();
  
  vscode.window.showInformationMessage('✅ AI Code Tracker 已启动，使用 Cmd+Shift+V 进行智能粘贴');
}

async function addAIMark(
  document: vscode.TextDocument,
  startLine: number,
  endLine: number,
  source: string
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document !== document) return;
  
  const patternManager = MarkPatternManager.getInstance();
  const lines = document.getText().split('\n');
  
  // 判断是新增文件还是修改现有文件
  // 新增文件：文件总行数较少（< 100）且大部分内容都是新添加的
  const isNewFile = lines.length <= endLine - startLine + 5 && startLine <= 5;
  
  await editor.edit(editBuilder => {
    if (isNewFile) {
      // 新增文件：在文件头部添加 JSDoc 头部标记
      const relativePath = vscode.workspace.asRelativePath(document.fileName);
      const headerMark = patternManager.generateAIMark(document.languageId, source, {
        format: 'header',
        author: source,
        date: new Date(),
        description: relativePath
      });
      editBuilder.insert(new vscode.Position(0, 0), headerMark + '\n\n');
    } else if (startLine === endLine) {
      // 单行修改：在行内添加行内标记
      const lineText = lines[startLine];
      const inlineMark = patternManager.generateAIMark(document.languageId, source, {
        format: 'inline',
        date: new Date()
      });
      
      // 找到行尾位置，在代码后面添加注释
      const lineEndPosition = new vscode.Position(startLine, lineText.length);
      editBuilder.insert(lineEndPosition, ' ' + inlineMark);
    } else {
      // 多行修改：在代码段开头和结尾添加块级标记
      const blockMark = patternManager.generateAIMark(document.languageId, source, {
        format: 'block',
        author: source,
        date: new Date()
      });
      
      // 块标记格式包含开始和结束标记，用换行分隔
      const [startMark, endMark] = blockMark.split('\n\n');
      
      // 获取第一行代码的缩进
      const firstLineText = lines[startLine];
      const indentMatch = firstLineText.match(/^(\s*)/);
      const indent = indentMatch ? indentMatch[1] : '';
      
      // 在代码段开始前插入开始标记（保持相同缩进）
      editBuilder.insert(new vscode.Position(startLine, 0), indent + startMark + '\n');
      
      // 在代码段结束后插入结束标记（保持相同缩进）
      const lastLineText = lines[endLine];
      editBuilder.insert(new vscode.Position(endLine, lastLineText.length), '\n' + indent + endMark);
    }
  });
  
  await gitAnalyzer.analyzeFile(document.fileName);
}

function loadHistoricalData(context: vscode.ExtensionContext) {
  const stored = context.globalState.get('aiReportHistory', []);
  // reportHistory = new Map(stored);
}

export function deactivate() {
  if (textChangeListener) {
    textChangeListener.dispose();
  }
  if (statusBarManager) {
    statusBarManager.dispose();
  }
  console.log('AI Code Tracker 已停用');
}