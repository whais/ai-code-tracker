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
import { SidebarProvider } from './ui/sidebarProvider';

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
let sidebarProvider: SidebarProvider;

// 当前工作区跟踪，用于检测工作区切换
let currentWorkspaceRoot: string | null = null;

// 防抖定时器管理（按工作区隔离，防止多项目串数据）
interface StatsUpdateState {
  timer: NodeJS.Timeout | null;
  hasPendingUpdate: boolean;
}
const statsUpdateStates = new Map<string, StatsUpdateState>();
const STATS_UPDATE_DELAY = 3000; // 3 秒防抖延迟

/**
 * 获取当前工作区的更新状态
 */
function getUpdateState(): StatsUpdateState {
  const workspaceRoot = getWorkspaceRoot();
  const key = workspaceRoot || 'default';
  
  if (!statsUpdateStates.has(key)) {
    statsUpdateStates.set(key, {
      timer: null,
      hasPendingUpdate: false
    });
  }
  return statsUpdateStates.get(key)!;
}

/**
 * 检查当前工作区是否启用了 AI 统计
 */
function isStatsEnabled(): boolean {
  const config = vscode.workspace.getConfiguration('aiCodeTracker');
  return config.get<boolean>('enabled', false);
}

/**
 * 切换统计开关
 */
async function toggleEnabled(): Promise<void> {
  const config = vscode.workspace.getConfiguration('aiCodeTracker');
  const currentValue = config.get<boolean>('enabled', false);
  const newValue = !currentValue;
  
  // 更新配置（工作区级别）
  await config.update('enabled', newValue, false);
  
  // 刷新侧边栏
  sidebarProvider?.refresh();
  
  if (newValue) {
    // 启用统计
    vscode.window.showInformationMessage('✅ AI 代码统计已启用');
    
    // 初始化统计组件
    await initializeStats();
    
    // 分析当前工作区
    await gitAnalyzer.analyzeWorkspace();
    
    // 保存统计数据到持久化存储
    await storage.saveTeamStats(statsManager.getStats());
    
    // 更新状态栏
    await statusBarManager.update();
    
    // 显示启动提示
    vscode.window.showInformationMessage('📊 开始统计 AI 代码，使用 Cmd+Shift+V 进行智能粘贴');
  } else {
    // 禁用统计
    vscode.window.showInformationMessage('⏸️ AI 代码统计已禁用');
    
    // 清理状态栏
    statusBarManager?.dispose();
  }
}

/**
 * 初始化统计相关组件
 */
async function initializeStats(): Promise<void> {
  if (statsManager) return; // 已经初始化
  
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
  reportCommands = new ReportCommands(statsManager, statsCommands, storage.getContext()!);
  
  // 初始化监听器（传入 LineTracker 用于无感统计）
  textChangeListener = new TextChangeListener(gitAnalyzer, lineTracker, async (source, document, startLine, endLine) => {
    await addAIMark(document, startLine, endLine, source);
  });
  saveListener = new SaveListener(gitAnalyzer, lineTracker, async (document, startLine, endLine, source) => {
    await addAIMark(document, startLine, endLine, source);
  });
  
  // 初始化团队配置
  await initTeamConfig();
}

/**
 * 清理统计组件
 */
function disposeStats(): void {
  statusBarManager?.dispose();
  textChangeListener?.dispose();
  statsManager = undefined as any;
  gitAnalyzer = undefined as any;
  statusBarManager = undefined as any;
  textChangeListener = undefined as any;
  saveListener = undefined as any;
}

export async function activate(context: vscode.ExtensionContext) {
  // 初始化存储管理器
  storage.initialize(context);
  
  // 记录当前工作区
  currentWorkspaceRoot = getWorkspaceRoot();
  if (currentWorkspaceRoot) {
    logger.info(`当前工作区: ${currentWorkspaceRoot}`);
  }
  
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
  
  // 注册侧边栏视图
  sidebarProvider = new SidebarProvider(context);
  vscode.window.registerTreeDataProvider('aiCodeTracker.sidebar', sidebarProvider);
  
  // 监听配置变化
  const configChangeListener = vscode.workspace.onDidChangeConfiguration(event => {
    if (event.affectsConfiguration('aiCodeTracker.aiMarkPatterns') ||
        event.affectsConfiguration('aiCodeTracker.markFormat') ||
        event.affectsConfiguration('aiCodeTracker.customMarkTemplate')) {
      patternManager.loadPatterns();
      console.log('AI 标记配置已更新');
    }
    
    // 监听 enabled 配置变化（用于同步侧边栏状态）
    if (event.affectsConfiguration('aiCodeTracker.enabled')) {
      sidebarProvider.refresh();
    }
  });
  context.subscriptions.push(configChangeListener);
  
  // 监听工作区变化（切换项目时重新加载数据）
  const workspaceChangeListener = vscode.workspace.onDidChangeWorkspaceFolders(async event => {
    const newWorkspaceRoot = getWorkspaceRoot();
    if (newWorkspaceRoot !== currentWorkspaceRoot) {
      logger.info(`工作区切换: ${currentWorkspaceRoot} -> ${newWorkspaceRoot}`);
      currentWorkspaceRoot = newWorkspaceRoot;
      
      // 刷新侧边栏
      sidebarProvider.refresh();
      
      // 如果启用了统计，重新加载当前工作区的统计数据
      if (isStatsEnabled()) {
        await reloadWorkspaceData();
      }
    }
  });
  context.subscriptions.push(workspaceChangeListener);
  
  // 监听活动编辑器变化（在不同工作区的文件间切换时更新）
  const activeEditorListener = vscode.window.onDidChangeActiveTextEditor(async editor => {
    if (editor) {
      const fileWorkspace = getWorkspaceRoot(editor.document.fileName);
      if (fileWorkspace && fileWorkspace !== currentWorkspaceRoot) {
        logger.info(`切换到不同工作区的文件: ${fileWorkspace}`);
        currentWorkspaceRoot = fileWorkspace;
        
        // 刷新侧边栏
        sidebarProvider.refresh();
        
        // 如果启用了统计，重新加载当前工作区的统计数据
        if (isStatsEnabled()) {
          await reloadWorkspaceData();
        }
      }
    }
  });
  context.subscriptions.push(activeEditorListener);
  
  // 初始化设置命令（不需要统计启用也能使用）
  settingsCommands = new SettingsCommands();
  
  // 注册基础命令（不需要统计启用）
  context.subscriptions.push(
    vscode.commands.registerCommand('ai-code-tracker.toggleEnabled', toggleEnabled)
  );
  
  // 注册其他命令（这些命令需要统计启用时才可用）
  const commands = registerCommands(statsCommands, markCommands, reportCommands, settingsCommands);
  context.subscriptions.push(...commands);
  
  // 注册事件监听（带启用检查）
  const textChangeDisposable = vscode.workspace.onDidChangeTextDocument(
    (e) => {
      // 只在启用统计时处理文本变化
      if (isStatsEnabled() && textChangeListener) {
        textChangeListener.handleTextChange(e);
      }
    }
  );
  
  // 保存监听：处理 AI 代码检测和标记（带启用检查）
  const saveDisposable = vscode.workspace.onDidSaveTextDocument(
    async (doc) => {
      if (!isStatsEnabled()) return;
      
      // 先执行保存监听（可能弹出标记对话框）
      if (saveListener) {
        await saveListener.handleDocumentSave(doc);
      }
      
      // 无论是否标记，都触发统计更新（使用防抖）
      scheduleStatsFileUpdate(doc);
    }
  );
  
  context.subscriptions.push(textChangeDisposable, saveDisposable);
  
  // 注册 pre-commit 钩子处理命令（带启用检查）
  const preCommitDisposable = vscode.commands.registerCommand(
    'ai-code-tracker.preCommitUpdate',
    () => {
      if (isStatsEnabled()) {
        handlePreCommitUpdate();
      } else {
        vscode.window.showWarningMessage('请先启用 AI 代码统计');
      }
    }
  );
  context.subscriptions.push(preCommitDisposable);
  
  // 尝试安装 Git 钩子（如果可能）
  await installGitHook();
  
  // 如果启用了统计，初始化统计组件
  if (isStatsEnabled()) {
    await initializeStats();
    
    // 分析当前工作区
    await gitAnalyzer.analyzeWorkspace();
    
    // 保存统计数据到持久化存储
    await storage.saveTeamStats(statsManager.getStats());
    
    // 更新状态栏
    await statusBarManager.update();
    
    // 定期保存统计数据（每 5 分钟）
    const saveInterval = setInterval(async () => {
      if (isStatsEnabled() && statsManager) {
        await storage.saveTeamStats(statsManager.getStats());
      }
    }, 5 * 60 * 1000);
    
    // 注册清理函数
    context.subscriptions.push({
      dispose: () => clearInterval(saveInterval)
    });
    
    vscode.window.showInformationMessage('✅ AI Code Tracker 已启动，使用 Cmd+Shift+V 进行智能粘贴');
  } else {
    // 未启用统计，显示提示
    vscode.window.showInformationMessage('📊 AI Code Tracker 已加载，点击左侧活动栏图标开启统计');
  }
}

/**
 * 重新加载当前工作区的数据
 * 在工作区切换时调用
 */
async function reloadWorkspaceData(): Promise<void> {
  if (!isStatsEnabled()) return;
  
  try {
    // 确保统计组件已初始化
    await initializeStats();
    
    // 清除 GitAnalyzer 缓存
    gitAnalyzer?.clearCache();
    
    // 清除 StatsFileManager 缓存
    statsFileManager.clearAllCache();
    
    // 切换工作区（这会重置并重新加载统计数据）
    statsManager?.switchWorkspace();
    
    // 重新分析当前工作区
    await gitAnalyzer?.analyzeWorkspace();
    
    // 保存统计数据
    await storage.saveTeamStats(statsManager?.getStats());
    
    // 更新状态栏
    await statusBarManager?.update();
    
    logger.info('工作区数据已重新加载');
  } catch (error) {
    logger.error('重新加载工作区数据失败', error);
  }
}

/**
 * 防抖更新统计文件
 * 在文件保存后延迟 3 秒更新，避免频繁写入（按工作区隔离）
 */
function scheduleStatsFileUpdate(document: vscode.TextDocument): void {
  // 只在启用统计时执行
  if (!isStatsEnabled()) return;
  
  // 只处理当前工作区的文件
  const workspaceRoot = getWorkspaceRoot();
  if (!workspaceRoot) return;
  
  // 检查文件是否属于当前工作区
  if (!document.fileName.startsWith(workspaceRoot)) return;
  
  // 只处理代码文件
  if (!isCodeFile(document.fileName)) return;
  
  const state = getUpdateState();
  state.hasPendingUpdate = true;
  
  // 清除之前的定时器
  if (state.timer) {
    clearTimeout(state.timer);
  }
  
  // 设置新的定时器
  state.timer = setTimeout(async () => {
    await flushStatsToFile(document);
  }, STATS_UPDATE_DELAY);
}

/**
 * 立即刷新统计到文件
 * 从 LineTracker 和 GitAnalyzer 整合统计数据
 */
async function flushStatsToFile(document?: vscode.TextDocument): Promise<void> {
  // 只在启用统计时执行
  if (!isStatsEnabled()) return;
  
  const state = getUpdateState();
  if (!state.hasPendingUpdate && !document) return;
  
  try {
    // 只统计当前工作区的文件
    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) return;
    
    // 获取当前用户信息（用于处理 "Not Committed Yet" 等情况）
    const { getCurrentGitUser } = await import('./utils/git');
    const currentUser = await getCurrentGitUser();
    
    // 1. 如果有指定文档，先触发 Git 分析（确保新文件被统计）
    if (document) {
      await gitAnalyzer.analyzeFile(document.fileName);
      // 保存到 workspaceState
      await storage.saveTeamStats(statsManager.getStats());
    }
    
    // 2. 从 statsManager 获取完整的团队统计（包含 Git 分析结果）
    const teamStats = statsManager.getStats();
    
    // 3. 从 LineTracker 获取实时追踪数据（优先使用，因为包含 AI 标记信息）
    const lineTrackerStats = lineTracker.getStatsByUser(workspaceRoot);
    
    // 4. 合并数据：以 LineTracker 数据为准（更精确），如果没有则使用 Git 分析数据
    const mergedStats = new Map<string, {
      name: string;
      aiLines: number;
      humanLines: number;
      totalLines: number;
    }>();
    
    // 先添加 LineTracker 的数据（优先级高）
    for (const [email, stats] of lineTrackerStats) {
      // 处理 "Not Committed Yet" 和空邮箱的情况
      let normalizedEmail = email;
      let normalizedName = stats.name;
      
      if (!email || email === '' || email === 'Not Committed Yet' || stats.name === 'Not Committed Yet') {
        normalizedEmail = currentUser.email;
        normalizedName = currentUser.name;
      }
      
      const existing = mergedStats.get(normalizedEmail);
      if (existing) {
        // 合并同一用户的数据
        existing.aiLines += stats.aiLines;
        existing.humanLines += stats.humanLines;
        existing.totalLines += stats.totalLines;
      } else {
        mergedStats.set(normalizedEmail, {
          name: normalizedName,
          aiLines: stats.aiLines,
          humanLines: stats.humanLines,
          totalLines: stats.totalLines
        });
      }
    }
    
    // 再添加 Git 分析的数据（补充 LineTracker 没有的数据）
    for (const [email, member] of teamStats.members) {
      // 处理 "Not Committed Yet" 和空邮箱的情况
      let normalizedEmail = email;
      let normalizedName = member.name;
      
      if (!email || email === '' || email === 'Not Committed Yet' || member.name === 'Not Committed Yet') {
        normalizedEmail = currentUser.email;
        normalizedName = currentUser.name;
      }
      
      // 只统计当前工作区的文件
      const workspaceFiles = Array.from(member.files.values()).filter(f => 
        f.filePath.startsWith(workspaceRoot)
      );
      
      if (workspaceFiles.length === 0) continue;
      
      // 计算当前工作区的统计
      const workspaceAiLines = workspaceFiles.reduce((sum, f) => sum + f.aiLines, 0);
      const workspaceHumanLines = workspaceFiles.reduce((sum, f) => sum + f.humanLines, 0);
      const workspaceTotalLines = workspaceFiles.reduce((sum, f) => sum + f.totalLines, 0);
      
      if (mergedStats.has(normalizedEmail)) {
        // 如果 LineTracker 已有数据，合并（取最大值，避免重复计算）
        const existing = mergedStats.get(normalizedEmail)!;
        existing.aiLines = Math.max(existing.aiLines, workspaceAiLines);
        existing.humanLines = Math.max(existing.humanLines, workspaceHumanLines);
        existing.totalLines = Math.max(existing.totalLines, workspaceTotalLines);
      } else {
        // 如果 LineTracker 没有，使用 Git 分析的数据
        mergedStats.set(normalizedEmail, {
          name: normalizedName,
          aiLines: workspaceAiLines,
          humanLines: workspaceHumanLines,
          totalLines: workspaceTotalLines
        });
      }
    }
    
    // 5. 准备写入 stats.json 的数据（过滤掉无效的用户名）
    const membersToWrite: Record<string, import('./core/statsFileManager').SharedMemberStats> = {};
    
    for (const [email, stats] of mergedStats) {
      // 过滤：确保不会写入 "Not Committed Yet" 或空用户
      if (!email || email === '' || email === 'Not Committed Yet' || 
          !stats.name || stats.name === 'Not Committed Yet') {
        logger.warn('跳过无效用户数据:', { email, name: stats.name });
        continue;
      }
      
      // 计算百分比
      const aiPercentage = stats.totalLines > 0 
        ? (stats.aiLines / stats.totalLines) * 100 
        : 0;
      
      membersToWrite[email] = {
        name: stats.name,
        totalLines: stats.totalLines,
        aiLines: stats.aiLines,
        humanLines: stats.humanLines,
        aiPercentage: aiPercentage,
        lastUpdated: Date.now()
      };
    }
    
    // 6. 使用 setAllMemberStats 完全覆盖写入（避免增量累加导致数据翻倍）
    statsFileManager.setAllMemberStats(membersToWrite);
    
    // 7. 更新状态栏显示
    await statusBarManager.update();
    
    state.hasPendingUpdate = false;
    logger.debug('统计文件已更新:', workspaceRoot, '成员数:', mergedStats.size);
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
  // 只在启用统计时执行
  if (!isStatsEnabled()) {
    logger.warn('pre-commit 钩子被调用，但统计未启用');
    return;
  }
  
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
  // 只在启用统计时执行
  if (!isStatsEnabled()) return;
  
  try {
    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) return;
    
    // 1. 重新分析整个工作区（确保 Git 数据是最新的）
    await gitAnalyzer.analyzeWorkspace();
    await storage.saveTeamStats(statsManager.getStats());
    
    // 2. 调用 flushStatsToFile 进行完整的数据合并和保存
    const state = getUpdateState();
    state.hasPendingUpdate = true;
    await flushStatsToFile();
    
    logger.info('全量统计更新完成', { workspace: workspaceRoot });
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
  // 只在启用统计时执行
  if (!isStatsEnabled()) return;
  
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
  
  // 触发 Git 分析
  await gitAnalyzer.analyzeFile(document.fileName);
  
  // 保存到 workspaceState
  await storage.saveTeamStats(statsManager.getStats());
  
  // 立即触发统计文件更新（不等待防抖）
  await flushStatsToFile(document);
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
