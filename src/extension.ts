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
import { LineTracker } from './core/lineTracker';
import { logger, LogLevel } from './utils/logger';
import { storage } from './utils/storage';

let statsManager: TeamStatsManager;
let gitAnalyzer: GitAnalyzer;
let lineTracker: LineTracker;
let statusBarManager: StatusBarManager;
let textChangeListener: TextChangeListener;
let saveListener: SaveListener;
let statsCommands: StatsCommands;
let markCommands: MarkCommands;
let reportCommands: ReportCommands;
let settingsCommands: SettingsCommands;

export async function activate(context: vscode.ExtensionContext) {
  // 初始化存储管理器
  storage.initialize(context);
  
  // 初始化日志系统
  const config = vscode.workspace.getConfiguration('aiCodeTracker');
  const logLevel = config.get<string>('logLevel', 'info');
  const logLevelMap: Record<string, LogLevel> = {
    'debug': LogLevel.DEBUG,
    'info': LogLevel.INFO,
    'warn': LogLevel.WARN,
    'error': LogLevel.ERROR
  };
  logger.setLogLevel(logLevelMap[logLevel] ?? LogLevel.INFO);
  logger.info('AI Code Tracker 已激活');
  
  // 初始化 MarkPatternManager（单例，会自动加载配置）
  const patternManager = MarkPatternManager.getInstance();
  
  // 初始化 LineTracker（单例）
  lineTracker = LineTracker.getInstance();
  lineTracker.initialize(context);
  
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
  statsManager.loadFromStorage(); // 从持久化存储加载数据
  
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
  
  // 初始化监听器（传入 LineTracker 用于无感统计）
  textChangeListener = new TextChangeListener(gitAnalyzer, lineTracker, async (source, document, startLine, endLine) => {
    await addAIMark(document, startLine, endLine, source);
  });
  saveListener = new SaveListener(gitAnalyzer, lineTracker, async (document, startLine, endLine, source) => {
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
  
  // 历史数据加载由 reportGenerator 处理
  
  // 初始化团队配置
  await initTeamConfig();
  
  // 分析当前工作区
  await gitAnalyzer.analyzeWorkspace();
  
  // 保存统计数据到持久化存储
  await storage.saveTeamStats(statsManager.getStats());
  
  // 更新状态栏
  await statusBarManager.update();
  
  // 定期保存统计数据（每 5 分钟）
  const saveInterval = setInterval(async () => {
    await storage.saveTeamStats(statsManager.getStats());
  }, 5 * 60 * 1000);
  
  // 注册清理函数
  context.subscriptions.push({
    dispose: () => clearInterval(saveInterval)
  });
  
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
  
  // 记录到 LineTracker（无感统计核心）
  lineTracker.recordAIGeneration(document, startLine, endLine, source);
  
  const patternManager = MarkPatternManager.getInstance();
  const lines = document.getText().split('\n');
  
  // 判断是新增文件还是修改现有文件
  // 新增文件判断条件：
  // 1. 文件总行数 <= 100（小文件）
  // 2. 新增内容占文件总行数的 80% 以上
  // 3. 从文件前 5 行开始添加
  const totalLines = lines.length;
  const addedLines = endLine - startLine + 1;
  const isNewFile = totalLines <= 100 && 
                    startLine <= 5 && 
                    addedLines >= totalLines * 0.8;
  
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

export function deactivate() {
  if (textChangeListener) {
    textChangeListener.dispose();
  }
  if (statusBarManager) {
    statusBarManager.dispose();
  }
  console.log('AI Code Tracker 已停用');
}