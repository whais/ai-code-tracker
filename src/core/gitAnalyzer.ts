import * as vscode from 'vscode';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { TeamStats, MemberStats, FileStats, IntegratedFileStats } from '../types';
import { MarkPatternManager } from './markPatternManager';
import { AIDetector } from './aiDetector';
import { LRUCache } from '../utils/lruCache';
import { getWorkspaceFolderForFile, getWorkspaceFolders, forEachWorkspace } from '../utils/workspace';
import { storage } from '../utils/storage';
import { LineTracker, FileSourceStats } from './lineTracker';

const execAsync = promisify(exec);

// 数据来源类型
export type DataSource = 'marks' | 'tracking' | 'blame' | 'integrated';

// Git blame 缓存键类型
interface BlameCacheKey {
  filePath: string;
  mtime: number; // 文件修改时间，用于判断缓存是否有效
}

// Git blame 缓存值类型
type BlameCacheValue = Map<number, { email: string; name: string }>;

// 区域类型定义
interface Region {
  type: 'ai' | 'human';
  startLine: number;  // 区域开始行（包含）
  endLine: number;    // 区域结束行（包含），-1 表示到文件结束
}

export class GitAnalyzer {
  private teamStats: TeamStats;
  private onStatsUpdate: () => void;
  private blameCache: LRUCache<string, BlameCacheValue>; // 使用文件路径作为缓存键
  private lineTracker: LineTracker;

  constructor(teamStats: TeamStats, onUpdate: () => void) {
    this.teamStats = teamStats;
    this.onStatsUpdate = onUpdate;
    // 初始化缓存：最大 200 个文件，5 分钟过期
    this.blameCache = new LRUCache<string, BlameCacheValue>(200, 5 * 60 * 1000);
    // 获取 LineTracker 单例
    this.lineTracker = LineTracker.getInstance();
  }

  /**
   * 生成缓存键（包含文件路径和修改时间）
   */
  private generateCacheKey(filePath: string): string | null {
    try {
      const stats = fs.statSync(filePath);
      return `${filePath}:${stats.mtime.getTime()}`;
    } catch {
      return null;
    }
  }

  /**
   * 清空缓存
   */
  clearCache(): void {
    this.blameCache.clear();
  }

  /**
   * 获取缓存统计信息
   */
  getCacheStats(): { size: number; maxSize: number; ttl: number } {
    return this.blameCache.getStats();
  }

  /**
   * 减去指定文件的历史统计贡献
   * 在重新分析文件前调用，避免重复累加
   */
  private subtractFileStats(filePath: string): void {
    // 遍历所有成员，查找并减去该文件的贡献
    for (const [email, member] of this.teamStats.members) {
      const fileStat = member.files.get(filePath);
      if (!fileStat) continue;

      // 减去该成员的贡献
      member.totalLines -= fileStat.totalLines;
      member.aiLines -= fileStat.aiLines;
      member.humanLines -= fileStat.humanLines;
      member.aiPercentage = member.totalLines > 0 
        ? (member.aiLines / member.totalLines * 100) 
        : 0;

      // 从成员的 files 中删除该文件
      member.files.delete(filePath);

      // 如果成员没有文件了，可以选择删除该成员或保留
      // 这里保留成员，即使统计为 0

      // 减去全局统计
      this.teamStats.totalLines -= fileStat.totalLines;
      this.teamStats.aiLines -= fileStat.aiLines;
      this.teamStats.humanLines -= fileStat.humanLines;

      console.log(`[GitAnalyzer] 减去文件历史贡献: ${filePath}, 成员: ${member.name}, ` +
        `AI: -${fileStat.aiLines}, Human: -${fileStat.humanLines}`);
    }

    // 确保统计不会变成负数（防止数据不一致）
    this.teamStats.totalLines = Math.max(0, this.teamStats.totalLines);
    this.teamStats.aiLines = Math.max(0, this.teamStats.aiLines);
    this.teamStats.humanLines = Math.max(0, this.teamStats.humanLines);
  }

  async analyzeFile(filePath: string): Promise<void> {
    // 获取文件对应的工作区
    const workspaceFolder = getWorkspaceFolderForFile(filePath);
    if (!workspaceFolder) {
      console.log(`[GitAnalyzer] 文件不在任何工作区中: ${filePath}`);
      return;
    }
    
    const workspacePath = workspaceFolder.uri.fsPath;
    const relativePath = path.relative(workspacePath, filePath);
    
    if (!fs.existsSync(filePath)) return;
    
    try {
      // 先检查是否是 Git 仓库
      await execAsync('git rev-parse --git-dir', { cwd: workspacePath });
    } catch {
      // 不是 Git 仓库，静默返回，避免重复提示
      return;
    }
    
    // 检查缓存
    const cacheKey = this.generateCacheKey(filePath);
    if (cacheKey) {
      const cachedAuthors = this.blameCache.get(cacheKey);
      if (cachedAuthors) {
        console.log(`[Cache] 使用缓存的 blame 数据: ${filePath}`);
        await this.updateStatsFromBlame(filePath, cachedAuthors);
        this.onStatsUpdate();
        return;
      }
    }
    
    try {
      const { stdout } = await execAsync(
        `git blame --line-porcelain "${relativePath}"`,
        { cwd: workspacePath }
      );
      
      if (stdout) {
        const authors = this.parseBlame(stdout);
        
        // 存入缓存
        if (cacheKey) {
          this.blameCache.set(cacheKey, authors);
          console.log(`[Cache] 缓存 blame 数据: ${filePath}`);
        }
        
        await this.updateStatsFromBlame(filePath, authors);
        this.onStatsUpdate();
        
        // 保存分析时间到持久化存储
        await storage.saveLastAnalyzed(filePath);
      }
    } catch (error) {
      // 只在文件不是 Git 跟踪的文件时记录日志，其他错误静默处理
      const errorMsg = String(error);
      if (!errorMsg.includes('no such path') && !errorMsg.includes('Not a git repository')) {
        console.log(`无法分析 ${filePath}: ${errorMsg}`);
      }
    }
  }

  async analyzeWorkspace(): Promise<void> {
    // 只分析当前活动工作区，避免多项目数据串扰
    const { getWorkspaceRoot } = await import('../utils/workspace');
    const workspacePath = getWorkspaceRoot();
    
    if (!workspacePath) {
      console.log('[GitAnalyzer] 没有打开的工作区');
      return;
    }
    
    console.log(`[GitAnalyzer] 分析当前工作区: ${workspacePath}`);
    
    const files = await this.findCodeFiles(workspacePath);
    console.log(`[GitAnalyzer] 找到 ${files.length} 个文件待分析`);
    
    for (const file of files) {
      await this.analyzeFile(file);
    }
  }

  private parseBlame(blameOutput: string): Map<number, { email: string; name: string }> {
    const lines = blameOutput.split('\n');
    const authorMap = new Map<number, { email: string; name: string }>();
    
    let currentLine = 0;
    let currentAuthor = '';
    let currentEmail = '';
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      if (line.startsWith('author ')) {
        currentAuthor = line.substring(7);
      } else if (line.startsWith('author-mail ')) {
        currentEmail = line.substring(12).replace(/[<>]/g, '');
      } else if (line.match(/^\w{40}/)) {
        const parts = line.split(' ');
        if (parts.length >= 3) {
          currentLine = parseInt(parts[2]);
        }
      } else if (line.startsWith('\t') && currentLine > 0) {
        authorMap.set(currentLine, { email: currentEmail, name: currentAuthor });
        currentLine++;
      }
    }
    
    return authorMap;
  }

  /**
   * 检测多行头部注释（如 JSDoc、HTML、Python docstring）
   * 返回 { startLine, endLine, type } 或 null
   */
  private detectMultilineHeader(lines: string[], patternManager: MarkPatternManager): { startLine: number; endLine: number; type: 'ai' | 'human' } | null {
    // 只检查前 50 行
    const checkLimit = Math.min(50, lines.length);
  
  for (let i = 0; i < checkLimit; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    
    // JSDoc 格式开始: /**
    if (trimmed.startsWith('/**')) {
      // 收集整个多行注释的内容
      let commentContent = '';
      let endLine = i;
      
      for (let j = i; j < Math.min(i + 30, lines.length); j++) {
        commentContent += lines[j] + '\n';
        if (lines[j].includes('*/')) {
          endLine = j;
          break;
        }
      }
      
      // 检查整个注释内容是否包含 AI 标记
      if (patternManager.hasAIMark(commentContent)) {
        return { startLine: i, endLine: endLine, type: 'ai' };
      }
      if (patternManager.hasHumanMark(commentContent)) {
        return { startLine: i, endLine: endLine, type: 'human' };
      }
    }
    
    // HTML/Vue 格式开始: <!--
    if (trimmed.startsWith('<!--')) {
      let commentContent = '';
      let endLine = i;
      
      for (let j = i; j < Math.min(i + 15, lines.length); j++) {
        commentContent += lines[j] + '\n';
        if (lines[j].includes('-->')) {
          endLine = j;
          break;
        }
      }
      
      if (patternManager.hasAIMark(commentContent)) {
        return { startLine: i, endLine: endLine, type: 'ai' };
      }
      if (patternManager.hasHumanMark(commentContent)) {
        return { startLine: i, endLine: endLine, type: 'human' };
      }
    }
    
    // Python docstring 格式开始: """
    if (trimmed.startsWith('"""')) {
      let commentContent = '';
      let endLine = i;
      
      for (let j = i; j < Math.min(i + 20, lines.length); j++) {
        commentContent += lines[j] + '\n';
        if (lines[j].includes('"""') && j > i) {
          endLine = j;
          break;
        }
      }
      
      if (patternManager.hasAIMark(commentContent)) {
        return { startLine: i, endLine: endLine, type: 'ai' };
      }
      if (patternManager.hasHumanMark(commentContent)) {
        return { startLine: i, endLine: endLine, type: 'human' };
      }
    }
    
    // 单行头部: // @ai-generated 或 # @ai-generated
    if ((trimmed.startsWith('//') || trimmed.startsWith('#')) && patternManager.hasAIMark(line)) {
      return { startLine: i, endLine: i, type: 'ai' };
    }
  }
  
  return null;
  }

  /**
   * 判断一行是否为代码行（非注释、非空行）
   * 注意：这个方法现在仅用于启发式检测未标记的代码块
   * 在 AI 区域内，所有行（包括注释和空行）都算作 AI 代码
   */
  private isCodeLine(line: string): boolean {
    const trimmed = line.trim();
    if (trimmed === '') return false;
    
    // 注释行
    if (trimmed.startsWith('//') || trimmed.startsWith('#') || 
        trimmed.startsWith('/*') || trimmed.startsWith('*') ||
        trimmed.startsWith('<!--') || trimmed.startsWith('"""')) {
      return false;
    }
    
    return true;
  }

  private async updateStatsFromBlame(filePath: string, authors: Map<number, { email: string; name: string }>): Promise<void> {
    const config = vscode.workspace.getConfiguration('aiCodeTracker');
    const teamMembers = config.get('teamMembers') as Record<string, string> || {};
    const patternManager = MarkPatternManager.getInstance();
    
    // 获取当前 Git 用户信息，用于处理 "Not Committed Yet" 的情况
    const { getCurrentGitUser } = await import('../utils/git');
    const currentUser = await getCurrentGitUser();
    
    // 检查文件大小，大于 1MB 的文件跳过分析以避免性能问题
    try {
      const stats = await fsp.stat(filePath);
      if (stats.size > 1024 * 1024) {
        console.log(`[SKIP] ${filePath}: 文件过大 (${(stats.size / 1024 / 1024).toFixed(2)}MB)`);
        return;
      }
    } catch {
      return;
    }
    
    // 关键修复：在重新分析前，先减去该文件之前的历史贡献
    // 这避免了重复累加同一文件的统计
    this.subtractFileStats(filePath);
    
    let content: string;
    try {
      content = await fsp.readFile(filePath, 'utf-8');
    } catch {
      return;
    }
    const lines = content.split('\n');
    
    // ============ 1. 多源数据整合 ============
    // 整合策略：
    // 1. 文件标记 (marks) - 接入前已有标记，最高优先级
    // 2. 实时追踪 (tracking) - 接入后无感统计
    // 3. Git blame - 作为补充，主要用于作者归属
    
    const integratedStats: IntegratedFileStats = {
      filePath,
      totalLines: lines.length,
      aiLines: 0,
      humanLines: 0,
      dataSource: 'integrated',
      sourceBreakdown: {
        fromMarks: 0,
        fromTracking: 0,
        fromBlame: 0
      }
    };
    
    // 存储每行是否属于 AI 代码
    const aiLinesSet = new Set<number>();
    // 记录每行的数据来源
    const lineDataSource = new Map<number, DataSource>();
    
    // ============ 1.1 首先分析文件标记 (接入前数据) ============
    const marksResult = await this.analyzeFileMarks(filePath, lines, patternManager);
    marksResult.aiLineNumbers.forEach(lineNum => {
      aiLinesSet.add(lineNum);
      lineDataSource.set(lineNum, 'marks');
    });
    integratedStats.sourceBreakdown.fromMarks = marksResult.aiLineNumbers.size;
    
    // ============ 1.2 然后整合 LineTracker 数据 (接入后数据) ============
    // 注意：LineTracker 数据只补充文件标记未覆盖的行
    const lineTrackerData = this.lineTracker.getFileStats(filePath);
    if (lineTrackerData) {
      // 遍历 LineTracker 中的每一行
      const trackingMap = this.lineTracker.getFileLineMap(filePath);
      if (trackingMap) {
        Object.entries(trackingMap).forEach(([lineNumStr, lineInfo]) => {
          const lineNum = parseInt(lineNumStr);
          if (lineNum >= lines.length) return;
          
          // 如果该行已有文件标记，跳过（文件标记优先级更高）
          if (lineDataSource.has(lineNum)) {
            return;
          }
          
          // 使用 LineTracker 的数据
          if (lineInfo.source === 'ai') {
            aiLinesSet.add(lineNum);
            lineDataSource.set(lineNum, 'tracking');
          } else if (lineInfo.source === 'human') {
            // 明确标记为人工，不加入 aiLinesSet
            lineDataSource.set(lineNum, 'tracking');
          }
          // unknown 不处理，留给 git blame 判断
        });
      }
      integratedStats.sourceBreakdown.fromTracking = 
        Array.from(lineDataSource.values()).filter(s => s === 'tracking').length;
    }
    
    // ============ 1.3 JSON 文件特殊处理 ============
    const isJsonFile = filePath.endsWith('.json');
    if (isJsonFile && AIDetector.hasGeneratedMarkerFile(filePath)) {
      for (let i = 0; i < lines.length; i++) {
        if (!lineDataSource.has(i)) {
          aiLinesSet.add(i);
          lineDataSource.set(i, 'marks');
        }
      }
    }
    
    // ============ 2. 更新统计信息（整合后的数据） ============
    for (const [lineNum, author] of authors) {
      const lineIndex = lineNum - 1;  // git blame 的行号从1开始，转换为0-based
      if (lineIndex >= lines.length) continue;
      
      // 确定该行是否为 AI 代码
      let isAI: boolean;
      
      if (lineDataSource.has(lineIndex)) {
        // 有明确的标记或追踪数据
        isAI = aiLinesSet.has(lineIndex);
      } else {
        // 无明确数据源，尝试启发式检测（可选）
        // 这里保守处理：未标记的认为是人工代码
        isAI = false;
        lineDataSource.set(lineIndex, 'blame');
      }
      
      if (lineDataSource.get(lineIndex) === 'blame') {
        integratedStats.sourceBreakdown.fromBlame++;
      }
      
      // 处理 "Not Committed Yet" 的情况：将其归属到当前用户
      let email = author.email;
      let authorName = author.name;
      
      // 如果邮箱为空或者是 "Not Committed Yet" 作者，使用当前用户信息
      if (!email || email === '' || authorName === 'Not Committed Yet') {
        email = currentUser.email;
        authorName = currentUser.name;
      }
      
      const displayName = teamMembers[email] || authorName || email.split('@')[0];
      
      let member = this.teamStats.members.get(email);
      if (!member) {
        member = {
          name: displayName,
          email: email,
          totalLines: 0,
          aiLines: 0,
          humanLines: 0,
          modifiedAILines: 0,
          aiPercentage: 0,
          files: new Map()
        };
        this.teamStats.members.set(email, member);
      }
      
      // 更新成员名称（如果 Git 配置有变化）
      if (member.name !== displayName) {
        member.name = displayName;
      }
      
      member.totalLines++;
      this.teamStats.totalLines++;
      
      if (isAI) {
        member.aiLines++;
        this.teamStats.aiLines++;
        integratedStats.aiLines++;
      } else {
        member.humanLines++;
        this.teamStats.humanLines++;
        integratedStats.humanLines++;
      }
      
      let fileStat = member.files.get(filePath);
      if (!fileStat) {
        fileStat = {
          filePath,
          totalLines: 0,
          aiLines: 0,
          humanLines: 0,
          modifiedAILines: 0,
          authorLines: new Map()
        };
        member.files.set(filePath, fileStat);
      }
      
      fileStat.totalLines++;
      if (isAI) fileStat.aiLines++;
      else fileStat.humanLines++;
      
      const authorLines = fileStat.authorLines.get(displayName) || 0;
      fileStat.authorLines.set(displayName, authorLines + 1);
    }
    
    // 更新百分比
    for (const member of this.teamStats.members.values()) {
      member.aiPercentage = member.totalLines > 0 ? (member.aiLines / member.totalLines * 100) : 0;
    }
    
    // 输出整合统计
    console.log(`[INTEGRATED] ${filePath}: ` +
      `AI=${integratedStats.aiLines}, Human=${integratedStats.humanLines}, ` +
      `Sources={marks:${integratedStats.sourceBreakdown.fromMarks}, ` +
      `tracking:${integratedStats.sourceBreakdown.fromTracking}, ` +
      `blame:${integratedStats.sourceBreakdown.fromBlame}}`);
  }

  /**
   * 分析文件中的AI标记
   * 返回检测到的AI代码行号集合
   */
  private analyzeFileMarks(
    filePath: string, 
    lines: string[], 
    patternManager: MarkPatternManager
  ): { aiLineNumbers: Set<number> } {
    const aiLineNumbers = new Set<number>();
    const regionStack: Region[] = [];
    
    // 检测文件级头部标记
    const headerRegion = this.detectMultilineHeader(lines, patternManager);
    const hasFileLevelAIMark = headerRegion?.type === 'ai';
    
    if (headerRegion) {
      regionStack.push({
        type: headerRegion.type,
        startLine: 0,
        endLine: -1
      });
    }
    
    // 逐行扫描块级标记
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // AI 块开始
      const aiStartMark = patternManager.isStartMark(line);
      if (aiStartMark) {
        if (!hasFileLevelAIMark) {
          regionStack.push({
            type: 'ai',
            startLine: i + 1,
            endLine: -1
          });
        }
        continue;
      }
      
      // Human 块开始
      if (patternManager.isHumanStartMark(line)) {
        regionStack.push({
          type: 'human',
          startLine: i + 1,
          endLine: -1
        });
        continue;
      }
      
      // 结束标记
      const isAIEnd = patternManager.isEndMark(line);
      const isHumanEnd = patternManager.isHumanEndMark(line);
      
      if (isAIEnd || isHumanEnd) {
        if (!(hasFileLevelAIMark && isAIEnd) && regionStack.length > 0) {
          regionStack.pop();
        }
        continue;
      }
      
      // 判断当前行
      if (regionStack.length > 0) {
        const currentRegion = regionStack[regionStack.length - 1];
        if (i >= currentRegion.startLine && 
            (currentRegion.endLine === -1 || i <= currentRegion.endLine)) {
          if (currentRegion.type === 'ai') {
            aiLineNumbers.add(i);
          }
        }
      }
    }
    
    return { aiLineNumbers };
  }

  private async findCodeFiles(dir: string, maxDepth: number = 10): Promise<string[]> {
    const files: string[] = [];
    const extensions = ['.ts', '.js', '.py', '.java', '.go', '.rs', '.cpp', '.c', '.jsx', '.tsx', '.vue'];
    
    async function walk(currentDir: string, depth: number) {
      // 限制遍历深度
      if (depth > maxDepth) {
        console.log(`[findCodeFiles] 达到最大遍历深度 ${maxDepth}，跳过: ${currentDir}`);
        return;
      }
      
      try {
        const entries = fs.readdirSync(currentDir);
        
        for (const entry of entries) {
          const fullPath = path.join(currentDir, entry);
          let stat;
          try {
            stat = fs.statSync(fullPath);
          } catch {
            continue;
          }
          
          if (stat.isDirectory()) {
            if (!['node_modules', '.git', 'dist', 'build', 'out', '.vscode'].includes(entry)) {
              await walk(fullPath, depth + 1);
            }
          } else if (extensions.includes(path.extname(entry))) {
            files.push(fullPath);
          }
        }
      } catch (error) {
        // 忽略无法访问的目录
      }
    }
    
    await walk(dir, 0);
    return files;
  }
}