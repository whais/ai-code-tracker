/**
 * Git钩子管理器
 * 监听git add/commit事件，计算最终统计
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { LineTracker, LineInfo } from './lineTracker';
import { logger } from '../utils/logger';

const execAsync = promisify(exec);

interface CommitStats {
  filePath: string;
  aiGeneratedLines: number;
  aiAcceptedLines: number;
  aiModifiedLines: number;
  humanLines: number;
  totalLines: number;
  acceptanceRate: number;
  modificationRate: number;
}

interface FileSnapshot {
  filePath: string;
  timestamp: number;
  lineMap: { [lineNumber: number]: LineInfo };
  gitHash?: string;
}

export class GitHookManager {
  private lineTracker: LineTracker;
  private context: vscode.ExtensionContext;
  private disposables: vscode.Disposable[] = [];
  private snapshots: Map<string, FileSnapshot> = new Map();

  constructor(lineTracker: LineTracker, context: vscode.ExtensionContext) {
    this.lineTracker = lineTracker;
    this.context = context;
    this.loadSnapshots();
    this.registerListeners();
  }

  private registerListeners(): void {
    // 1. 监听.git/index变化（git add触发）
    this.watchGitIndex();

    // 2. 监听VSCode的SCM事件
    this.registerSCMListeners();

    // 3. 监听文件保存（作为备选）
    const saveDisposable = vscode.workspace.onDidSaveTextDocument(doc => {
      this.handleFileSave(doc);
    });
    this.disposables.push(saveDisposable);
  }

  /**
   * 监听Git索引文件变化
   */
  private watchGitIndex(): void {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return;

    for (const folder of workspaceFolders) {
      const gitIndexPath = path.join(folder.uri.fsPath, '.git', 'index');
      
      if (fs.existsSync(gitIndexPath)) {
        const watcher = fs.watch(gitIndexPath, (eventType) => {
          if (eventType === 'change') {
            logger.debug('[GitHookManager] 检测到git index变化');
            this.handleGitAdd();
          }
        });

        this.disposables.push({
          dispose: () => watcher.close()
        });
      }
    }
  }

  /**
   * 注册SCM监听器
   */
  private registerSCMListeners(): void {
    // 监听源代码管理器状态变化
    const scmDisposable = vscode.workspace.onDidChangeWorkspaceFolders(() => {
      this.checkGitStatus();
    });
    this.disposables.push(scmDisposable);
  }

  /**
   * 处理git add事件
   */
  private async handleGitAdd(): Promise<void> {
    try {
      const stagedFiles = await this.getStagedFiles();
      
      for (const filePath of stagedFiles) {
        // 创建当前文件的快照
        const snapshot = this.lineTracker.createSnapshot(filePath);
        if (snapshot) {
          this.snapshots.set(filePath, snapshot);
          logger.info(`[GitHookManager] 创建快照: ${filePath}`);
        }
      }

      this.persistSnapshots();
    } catch (error) {
      logger.error('[GitHookManager] 处理git add失败', error);
    }
  }

  /**
   * 处理文件保存
   */
  private handleFileSave(document: vscode.TextDocument): void {
    // 检查文件是否已暂存
    const filePath = document.fileName;
    
    // 如果文件已在snapshots中，更新快照
    if (this.snapshots.has(filePath)) {
      const snapshot = this.lineTracker.createSnapshot(filePath);
      if (snapshot) {
        this.snapshots.set(filePath, snapshot);
        logger.debug(`[GitHookManager] 更新快照: ${filePath}`);
      }
    }
  }

  /**
   * 检查Git状态
   */
  private async checkGitStatus(): Promise<void> {
    // 这里可以添加更复杂的Git状态检查
    // 例如检测commit完成后的清理工作
  }

  /**
   * 获取暂存的文件列表
   */
  private async getStagedFiles(): Promise<string[]> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return [];

    const stagedFiles: string[] = [];

    for (const folder of workspaceFolders) {
      try {
        const { stdout } = await execAsync(
          'git diff --cached --name-only',
          { cwd: folder.uri.fsPath }
        );

        const files = stdout.split('\n')
          .filter(f => f.trim())
          .map(f => path.join(folder.uri.fsPath, f));

        stagedFiles.push(...files);
      } catch (error) {
        logger.debug(`[GitHookManager] 获取暂存文件失败: ${folder.name}`);
      }
    }

    return stagedFiles;
  }

  /**
   * 计算提交统计（在commit后调用）
   */
  async calculateCommitStats(commitHash?: string): Promise<CommitStats[]> {
    const committedFiles = await this.getCommittedFiles(commitHash);
    const results: CommitStats[] = [];

    for (const filePath of committedFiles) {
      const snapshot = this.snapshots.get(filePath);
      const currentStats = this.lineTracker.calculateFileStats(filePath);

      if (snapshot) {
        // 有快照，对比计算
        const diffStats = this.calculateDiffStats(snapshot, filePath);
        results.push(diffStats);
      } else {
        // 无快照，使用当前统计
        results.push({
          filePath,
          aiGeneratedLines: currentStats.aiGenerated,
          aiAcceptedLines: currentStats.aiAccepted,
          aiModifiedLines: currentStats.aiModified,
          humanLines: currentStats.humanWritten,
          totalLines: currentStats.total,
          acceptanceRate: currentStats.acceptanceRate,
          modificationRate: currentStats.aiGenerated > 0
            ? (currentStats.aiModified / currentStats.aiGenerated) * 100
            : 0
        });
      }

      // 清理已提交的文件的快照
      this.snapshots.delete(filePath);
    }

    this.persistSnapshots();
    return results;
  }

  /**
   * 计算差异统计
   */
  private calculateDiffStats(
    snapshot: FileSnapshot,
    currentFilePath: string
  ): CommitStats {
    const currentStats = this.lineTracker.calculateFileStats(currentFilePath);
    const snapshotLines = Object.keys(snapshot.lineMap).length;
    
    // 计算变化
    let addedAIGenerated = 0;
    let addedHuman = 0;
    let modifiedAI = 0;

    // 遍历当前文件的行
    const document = vscode.workspace.textDocuments.find(
      d => d.fileName === currentFilePath
    );

    if (document) {
      for (let i = 0; i < document.lineCount; i++) {
        const currentLine = this.lineTracker['fileMaps'].get(currentFilePath)?.[i];
        const snapshotLine = snapshot.lineMap[i];

        if (!snapshotLine && currentLine) {
          // 新增行
          if (currentLine.source === 'ai') {
            addedAIGenerated++;
          } else {
            addedHuman++;
          }
        } else if (snapshotLine && currentLine) {
          // 已存在的行
          if (snapshotLine.source === 'ai' && currentLine.status === 'modified') {
            modifiedAI++;
          }
        }
      }
    }

    const totalLines = currentStats.total;
    const aiGeneratedLines = snapshotLines + addedAIGenerated;

    return {
      filePath: currentFilePath,
      aiGeneratedLines,
      aiAcceptedLines: currentStats.aiAccepted,
      aiModifiedLines: modifiedAI,
      humanLines: currentStats.humanWritten + addedHuman,
      totalLines,
      acceptanceRate: aiGeneratedLines > 0
        ? (currentStats.aiAccepted / aiGeneratedLines) * 100
        : 0,
      modificationRate: aiGeneratedLines > 0
        ? (modifiedAI / aiGeneratedLines) * 100
        : 0
    };
  }

  /**
   * 获取已提交的文件列表
   */
  private async getCommittedFiles(commitHash?: string): Promise<string[]> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return [];

    const committedFiles: string[] = [];
    const hash = commitHash || 'HEAD';

    for (const folder of workspaceFolders) {
      try {
        const { stdout } = await execAsync(
          `git diff-tree --no-commit-id --name-only -r ${hash}`,
          { cwd: folder.uri.fsPath }
        );

        const files = stdout.split('\n')
          .filter(f => f.trim())
          .map(f => path.join(folder.uri.fsPath, f));

        committedFiles.push(...files);
      } catch (error) {
        logger.debug(`[GitHookManager] 获取提交文件失败: ${folder.name}`);
      }
    }

    return committedFiles;
  }

  /**
   * 上报统计结果
   */
  async reportStats(stats: CommitStats[]): Promise<void> {
    if (stats.length === 0) return;

    // 汇总统计
    const summary = stats.reduce((acc, s) => ({
      aiGeneratedLines: acc.aiGeneratedLines + s.aiGeneratedLines,
      aiAcceptedLines: acc.aiAcceptedLines + s.aiAcceptedLines,
      aiModifiedLines: acc.aiModifiedLines + s.aiModifiedLines,
      humanLines: acc.humanLines + s.humanLines,
      totalLines: acc.totalLines + s.totalLines
    }), {
      aiGeneratedLines: 0,
      aiAcceptedLines: 0,
      aiModifiedLines: 0,
      humanLines: 0,
      totalLines: 0
    });

    const acceptanceRate = summary.aiGeneratedLines > 0
      ? (summary.aiAcceptedLines / summary.aiGeneratedLines) * 100
      : 0;

    logger.info('[GitHookManager] 提交统计', {
      files: stats.length,
      ...summary,
      acceptanceRate: acceptanceRate.toFixed(2) + '%'
    });

    // 显示通知
    vscode.window.showInformationMessage(
      `📊 本次提交: ${summary.aiGeneratedLines}行AI生成, ` +
      `采纳率 ${acceptanceRate.toFixed(1)}%`
    );

    // 这里可以添加上报到后端服务器的逻辑
    // await this.uploadStats(stats);
  }

  /**
   * 持久化快照
   */
  private persistSnapshots(): void {
    const data = Array.from(this.snapshots.entries());
    this.context.workspaceState.update('gitHookManager.snapshots', data);
  }

  /**
   * 加载快照
   */
  private loadSnapshots(): void {
    const data = this.context.workspaceState.get<[string, FileSnapshot][]>(
      'gitHookManager.snapshots',
      []
    );
    this.snapshots = new Map(data);
  }

  /**
   * 手动触发提交统计（供命令调用）
   */
  async manualCommitStats(): Promise<void> {
    const stats = await this.calculateCommitStats();
    await this.reportStats(stats);
    
    // 清理行追踪器的已提交文件
    for (const stat of stats) {
      this.lineTracker.clearFile(stat.filePath);
    }
  }

  dispose(): void {
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
  }
}
