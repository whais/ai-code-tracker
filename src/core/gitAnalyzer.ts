import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { TeamStats, MemberStats, FileStats } from '../types';
import { MarkPatternManager } from './markPatternManager';
import { AIDetector } from './aiDetector';

const execAsync = promisify(exec);

// 区域类型定义
interface Region {
  type: 'ai' | 'human';
  startLine: number;  // 区域开始行（包含）
  endLine: number;    // 区域结束行（包含），-1 表示到文件结束
}

export class GitAnalyzer {
  private teamStats: TeamStats;
  private onStatsUpdate: () => void;

  constructor(teamStats: TeamStats, onUpdate: () => void) {
    this.teamStats = teamStats;
    this.onStatsUpdate = onUpdate;
  }

  async analyzeFile(filePath: string): Promise<void> {
    if (!vscode.workspace.workspaceFolders) return;
    
    const workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
    const relativePath = path.relative(workspacePath, filePath);
    
    if (!fs.existsSync(filePath)) return;
    
    try {
      const { stdout } = await execAsync(
        `git blame --line-porcelain "${relativePath}" 2>/dev/null || true`,
        { cwd: workspacePath }
      );
      
      if (stdout) {
        const authors = this.parseBlame(stdout);
        this.updateStatsFromBlame(filePath, authors);
        this.onStatsUpdate();
      }
    } catch (error) {
      console.log(`无法分析 ${filePath}`);
    }
  }

  async analyzeWorkspace(): Promise<void> {
    if (!vscode.workspace.workspaceFolders) return;
    
    const workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
    const files = await this.findCodeFiles(workspacePath);
    
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

  private updateStatsFromBlame(filePath: string, authors: Map<number, { email: string; name: string }>) {
    const config = vscode.workspace.getConfiguration('aiCodeTracker');
    const teamMembers = config.get('teamMembers') as Record<string, string> || {};
    const patternManager = MarkPatternManager.getInstance();
    
    if (!fs.existsSync(filePath)) return;
    
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    
    // 存储每行是否属于 AI 代码
    const aiLinesSet = new Set<number>();
    
    // ============ 1. JSON 文件特殊处理 ============
    const isJsonFile = filePath.endsWith('.json');
    if (isJsonFile && AIDetector.hasGeneratedMarkerFile(filePath)) {
      // 标记所有行为 AI
      for (let i = 0; i < lines.length; i++) {
        aiLinesSet.add(i);
      }
      console.log(`[JSON] ${filePath}: 检测到 .generated 标记，标记所有行为 AI`);
    }
    
    // ============ 2. 如果已有标记，直接跳过区域检测 ============
    if (aiLinesSet.size === 0) {
      // 区域栈管理
      const regionStack: Region[] = [];
      
      // 2.1 检测文件级头部标记（多行注释）
      const headerRegion = this.detectMultilineHeader(lines, patternManager);
      if (headerRegion) {
        // 头部注释，从注释结束后到文件末尾都是该类型区域
        const regionStart = headerRegion.endLine + 1;
        if (regionStart < lines.length) {
          regionStack.push({
            type: headerRegion.type,
            startLine: regionStart,
            endLine: -1  // -1 表示到文件结束
          });
          console.log(`[HEADER] ${filePath}: 检测到 ${headerRegion.type.toUpperCase()} 头部注释 (行 ${headerRegion.startLine}-${headerRegion.endLine})，区域从行 ${regionStart} 开始`);
        }
      }
      
      // 2.2 逐行扫描，处理块级标记
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // 检查 AI 块级开始标记
        const aiStartMark = patternManager.isStartMark(line);
        if (aiStartMark) {
          // 推入新区域
          regionStack.push({
            type: 'ai',
            startLine: i + 1,  // 标记从下一行开始生效
            endLine: -1
          });
          console.log(`[BLOCK-START] ${filePath}: AI 区域开始于行 ${i}，从行 ${i + 1} 生效`);
          continue;
        }
        
        // 检查 Human 块级开始标记
        if (patternManager.isHumanStartMark(line)) {
          regionStack.push({
            type: 'human',
            startLine: i + 1,
            endLine: -1
          });
          console.log(`[BLOCK-START] ${filePath}: HUMAN 区域开始于行 ${i}，从行 ${i + 1} 生效`);
          continue;
        }
        
        // 检查结束标记（AI 或 Human）
        const isAIEnd = patternManager.isEndMark(line);
        const isHumanEnd = patternManager.isHumanEndMark(line);
        
        if (isAIEnd || isHumanEnd) {
          if (regionStack.length > 0) {
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
            // 在区域内，只有代码行才计入
            if (this.isCodeLine(line)) {
              if (currentRegion.type === 'ai') {
                aiLinesSet.add(i);
              }
              // human 区域不添加任何标记（即不算 AI）
            }
          }
        }
      }
      
      // 2.3 输出区域统计
      console.log(`[REGIONS] ${filePath}: 共处理 ${regionStack.length} 个区域，AI 代码行数: ${aiLinesSet.size}`);
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

  private async findCodeFiles(dir: string): Promise<string[]> {
    const files: string[] = [];
    const extensions = ['.ts', '.js', '.py', '.java', '.go', '.rs', '.cpp', '.c', '.jsx', '.tsx', '.vue'];
    
    async function walk(currentDir: string) {
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
              await walk(fullPath);
            }
          } else if (extensions.includes(path.extname(entry))) {
            files.push(fullPath);
          }
        }
      } catch (error) {
        // 忽略无法访问的目录
      }
    }
    
    await walk(dir);
    return files;
  }
}