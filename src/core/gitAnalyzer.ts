import * as vscode from 'vscode';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { TeamStats, MemberStats, FileStats } from '../types';
import { MarkPatternManager } from './markPatternManager';
import { AIDetector } from './aiDetector';
import { LRUCache } from '../utils/lruCache';
import { getWorkspaceFolderForFile, getWorkspaceFolders, forEachWorkspace } from '../utils/workspace';
import { storage } from '../utils/storage';

const execAsync = promisify(exec);

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

  constructor(teamStats: TeamStats, onUpdate: () => void) {
    this.teamStats = teamStats;
    this.onStatsUpdate = onUpdate;
    // 初始化缓存：最大 200 个文件，5 分钟过期
    this.blameCache = new LRUCache<string, BlameCacheValue>(200, 5 * 60 * 1000);
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
    const folders = getWorkspaceFolders();
    if (folders.length === 0) return;
    
    // 分析所有工作区
    for (const folder of folders) {
      const workspacePath = folder.uri.fsPath;
      console.log(`[GitAnalyzer] 分析工作区: ${folder.name} (${workspacePath})`);
      
      const files = await this.findCodeFiles(workspacePath);
      console.log(`[GitAnalyzer] 找到 ${files.length} 个文件待分析`);
      
      for (const file of files) {
        await this.analyzeFile(file);
      }
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
    
    let content: string;
    try {
      content = await fsp.readFile(filePath, 'utf-8');
    } catch {
      return;
    }
    const lines = content.split('\n');
    
    // 存储每行是否属于 AI 代码
    const aiLinesSet = new Set<number>();
    
    // ============ 1. JSON 文件特殊处理 ============
    const isJsonFile = filePath.endsWith('.json');
    if (isJsonFile && AIDetector.hasGeneratedMarkerFile(filePath)) {
      // 验证 JSON 格式是否合法（仅记录日志，不影响标记）
      try {
        JSON.parse(content);
      } catch (e) {
        console.log(`[JSON] ${filePath}: 文件格式可能不合法，但仍标记为 AI 生成`);
      }
      // 标记所有行为 AI
      for (let i = 0; i < lines.length; i++) {
        aiLinesSet.add(i);
      }
      console.log(`[JSON] ${filePath}: 检测到 .generated 标记，标记所有行为 AI`);
    }
    
    // ============ 2. 区域检测与标记 ============
    if (aiLinesSet.size === 0) {
      // 区域栈管理
      const regionStack: Region[] = [];
      
      // 2.1 检测文件级头部标记（多行注释）
      const headerRegion = this.detectMultilineHeader(lines, patternManager);
      
      // 标志位：是否存在文件级 AI 头部标记
      const hasFileLevelAIMark = headerRegion?.type === 'ai';
      
      if (headerRegion) {
        // 头部注释，将整个文件（从第0行开始）都标记为该类型区域
        // 因为头部注释本身也是 AI 生成的，应该算作 AI 代码
        regionStack.push({
          type: headerRegion.type,
          startLine: 0,  // 从文件开头开始
          endLine: -1  // -1 表示到文件结束
        });
        console.log(`[HEADER] ${filePath}: 检测到 ${headerRegion.type.toUpperCase()} 头部注释 (行 ${headerRegion.startLine}-${headerRegion.endLine})，整个文件标记为 ${headerRegion.type.toUpperCase()}`);
      }
      
      // 2.2 逐行扫描，处理块级标记
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // 检查 AI 块级开始标记
        const aiStartMark = patternManager.isStartMark(line);
        if (aiStartMark) {
          // 如果存在文件级 AI 头部标记，忽略 AI 块级标记（只做修改记录，不做区域统计）
          if (hasFileLevelAIMark) {
            console.log(`[BLOCK-START] ${filePath}: 检测到 AI 块开始标记，但文件已有 AI 头部注释，忽略此标记（行 ${i}）`);
          } else {
            // 推入新区域
            regionStack.push({
              type: 'ai',
              startLine: i + 1,  // 标记从下一行开始生效
              endLine: -1
            });
            console.log(`[BLOCK-START] ${filePath}: AI 区域开始于行 ${i}，从行 ${i + 1} 生效`);
          }
          continue;
        }
        
        // 检查 Human 块级开始标记（始终处理，不受文件级 AI 标记影响）
        if (patternManager.isHumanStartMark(line)) {
          regionStack.push({
            type: 'human',
            startLine: i + 1,
            endLine: -1
          });
          console.log(`[BLOCK-START] ${filePath}: HUMAN 区域开始于行 ${i}，从行 ${i + 1} 生效`);
          continue;
        }
        
        // 检查结束标记
        const isAIEnd = patternManager.isEndMark(line);
        const isHumanEnd = patternManager.isHumanEndMark(line);
        
        if (isAIEnd || isHumanEnd) {
          // 如果存在文件级 AI 头部标记且当前是 AI 结束标记，忽略它
          if (hasFileLevelAIMark && isAIEnd) {
            console.log(`[BLOCK-END] ${filePath}: 检测到 AI 块结束标记，但文件已有 AI 头部注释，忽略此标记（行 ${i}）`);
          } else if (regionStack.length > 0) {
            const closedRegion = regionStack.pop()!;
            closedRegion.endLine = i - 1;  // 结束标记本身不计入区域
            console.log(`[BLOCK-END] ${filePath}: ${closedRegion.type.toUpperCase()} 区域结束于行 ${i}，实际代码行 ${closedRegion.startLine}-${closedRegion.endLine}`);
          }
          continue;
        }
        
        // 判断当前行属于哪个区域
        if (regionStack.length > 0) {
          const currentRegion = regionStack[regionStack.length - 1];
          
          // 检查当前行是否在区域内
          if (i >= currentRegion.startLine && (currentRegion.endLine === -1 || i <= currentRegion.endLine)) {
            // 在 AI 区域内，所有行（包括代码、注释、空行）都算作 AI 代码
            // 在 Human 区域内，所有行都算作 Human 代码（即不算 AI）
            if (currentRegion.type === 'ai') {
              aiLinesSet.add(i);
            }
            // human 区域不添加任何标记（即不算 AI）
          }
        }
      }
      
      // 2.3 输出区域统计
      console.log(`[REGIONS] ${filePath}: 文件级AI标记=${hasFileLevelAIMark}, 未闭合区域=${regionStack.length}, AI 代码行数: ${aiLinesSet.size}`);
      if (aiLinesSet.size > 0 && aiLinesSet.size < 20) {
        console.log(`[REGIONS] AI 代码行: ${Array.from(aiLinesSet).sort((a, b) => a - b).join(', ')}`);
      }
    }
    
    // ============ 3. 更新统计信息 ============
    for (const [lineNum, author] of authors) {
      const lineIndex = lineNum - 1;  // git blame 的行号从1开始，转换为0-based
      if (lineIndex >= lines.length) continue;
      
      const isAI = aiLinesSet.has(lineIndex);
      
      // 调试输出前10行
      if (lineIndex < 10) {
        const linePreview = lines[lineIndex].substring(0, 50);
        console.log(`[LINE ${lineIndex}] isAI=${isAI}, content=${linePreview}`);
      }
      
      const email = author.email;
      const displayName = teamMembers[email] || author.name || email.split('@')[0];
      
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
      
      member.totalLines++;
      this.teamStats.totalLines++;
      
      if (isAI) {
        member.aiLines++;
        this.teamStats.aiLines++;
      } else {
        member.humanLines++;
        this.teamStats.humanLines++;
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