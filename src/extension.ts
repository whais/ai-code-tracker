import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as util from 'util';
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
import { statsFileManager } from './core/statsFileManager';
import { logger, LogLevel } from './utils/logger';
import { storage } from './utils/storage';
import { getWorkspaceRoot } from './utils/workspace';

const execAsync = util.promisify(cp.exec);

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

// 防抖定时器，用于延迟更新统计文件
let statsUpdateTimer: NodeJS.Timeout | null = null;
const STATS_UPDATE_DELAY = 3000; // 3 秒防抖延迟
// 标记是否有待更新的统计
let hasPendingStatsUpdate = false;

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
  
  // 初始化 StatsFileManager
  const workspaceRoot = getWorkspaceRoot();
  if (workspaceRoot) {
    // 检查是否存在已有的共享统计文件，如果有则加载
    const existingStats = statsFileManager.readStats();
    if (existingStats) {
      logger.info('已加载团队共享统计文件', { 
        project: existingStats.project,
        memberCount: Object.keys(existingStats.members).length 
      });
    }
  }
  
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
  
  // 注册防抖统计文件更新（文件保存时触发）
  const statsUpdateDisposable = vscode.workspace.onDidSaveTextDocument(
    (doc) => scheduleStatsFileUpdate(doc)
  );
  
  context.subscriptions.push(textChangeDisposable, saveDisposable, statsUpdateDisposable);
  
  // 注册 pre-commit 钩子处理命令
  const preCommitDisposable = vscode.commands.registerCommand(
    'ai-code-tracker.preCommitUpdate',
    () => handlePreCommitUpdate()
  );
  context.subscriptions.push(preCommitDisposable);
  
  // 尝试安装 Git 钩子（如果可能）
  await installGitHook();
  
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

/**
 * 防抖更新统计文件
 * 在文件保存后延迟 3 秒更新，避免频繁写入
 */
function scheduleStatsFileUpdate(document: vscode.TextDocument): void {
  // 只处理代码文件
  if (!isCodeFile(document.fileName)) return;
  
  hasPendingStatsUpdate = true;
  
  // 清除之前的定时器
  if (statsUpdateTimer) {
    clearTimeout(statsUpdateTimer);
  }
  
  // 设置新的定时器
  statsUpdateTimer = setTimeout(async () => {
    await flushStatsToFile();
  }, STATS_UPDATE_DELAY);
}

/**
 * 立即刷新统计到文件
 */
async function flushStatsToFile(): Promise<void> {
  if (!hasPendingStatsUpdate) return;
  
  try {
    const userStats = lineTracker.getStatsByUser();
    
    for (const [email, stats] of userStats) {
      statsFileManager.updateMemberStats(email, {
        name: stats.name,
        aiLines: stats.aiLines,
        humanLines: stats.humanLines,
        totalLines: stats.totalLines
      });
    }
    
    hasPendingStatsUpdate = false;
    logger.debug('统计文件已更新');
  } catch (error) {
    logger.error('更新统计文件失败', error);
  }
}

/**
 * 检查是否为代码文件
 */
function isCodeFile(filePath: string): boolean {
  const codeExtensions = [
    '.ts', '.js', '.py', '.java', '.go', '.rs', '.cpp', '.c',
    '.jsx', '.tsx', '.vue', '.php', '.rb', '.swift', '.kt'
  ];
  const ext = filePath.toLowerCase().slice(filePath.lastIndexOf('.'));
  return codeExtensions.includes(ext);
}

/**
 * pre-commit 钩子处理函数
 * 强制刷新统计并添加到 Git 暂存区
 */
async function handlePreCommitUpdate(): Promise<void> {
  logger.info('执行 pre-commit 统计更新');
  
  // 1. 立即刷新统计
  await flushStatsToFile();
  
  // 2. 全量重新分析并更新（确保准确）
  await fullStatsUpdate();
  
  // 3. 尝试添加到 Git 暂存区
  const workspaceRoot = getWorkspaceRoot();
  if (workspaceRoot) {
    try {
      const statsFilePath = statsFileManager.getStatsFileRelativePath();
      if (statsFilePath) {
        await execAsync(`git add "${statsFilePath}"`, { cwd: workspaceRoot });
        logger.info('统计文件已添加到 Git 暂存区');
      }
    } catch (error) {
      logger.error('添加统计文件到 Git 失败', error);
    }
  }
}

/**
 * 全量统计更新
 * 分析当前工作区所有追踪的文件
 */
async function fullStatsUpdate(): Promise<void> {
  try {
    const trackedFiles = lineTracker.getTrackedFiles();
    
    for (const filePath of trackedFiles) {
      const delta = lineTracker.calculateFileStatsDelta(filePath);
      
      for (const [email, stats] of delta) {
        statsFileManager.updateMemberStats(email, {
          name: stats.name,
          aiLines: stats.aiLines,
          humanLines: stats.humanLines,
          totalLines: stats.totalLines
        });
      }
    }
    
    logger.info('全量统计更新完成', { fileCount: trackedFiles.length });
  } catch (error) {
    logger.error('全量统计更新失败', error);
  }
}

/**
 * 安装 Git 钩子
 * 尝试在 .git/hooks/pre-commit 中添加统计更新命令
 */
async function installGitHook(): Promise<void> {
  const workspaceRoot = getWorkspaceRoot();
  if (!workspaceRoot) return;
  
  const hookPath = `${workspaceRoot}/.git/hooks/pre-commit`;
  const marker = '# AI Code Tracker Hook';
  
  try {
    let hookContent = '';
    
    // 读取现有钩子内容（如果存在）
    if (require('fs').existsSync(hookPath)) {
      hookContent = require('fs').readFileSync(hookPath, 'utf-8');
      // 如果已经安装过，跳过
      if (hookContent.includes(marker)) {
        return;
      }
    }
    
    // 添加我们的钩子代码
    const ourHook = `
${marker}
# 更新 AI 统计文件
if command -v code &> /dev/null; then
  code --extension-id=ai-code-tracker.ai-code-tracker --command=ai-code-tracker.preCommitUpdate || true
fi
${marker}-END
`;
    
    // 写入钩子文件
    const newContent = hookContent + ourHook;
    require('fs').writeFileSync(hookPath, newContent, { mode: 0o755 });
    
    logger.info('Git pre-commit 钩子已安装');
  } catch (error) {
    // 钩子安装失败不影响主功能，静默处理
    logger.debug('Git 钩子安装失败（非关键错误）', error);
  }
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
  await lineTracker.recordAIGeneration(document, startLine, endLine, source);
  
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