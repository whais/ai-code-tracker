import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { TeamStats, MemberStats, FileStats } from '../types';
import { MarkPatternManager } from './markPatternManager';

const execAsync = promisify(exec);

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

  private updateStatsFromBlame(filePath: string, authors: Map<number, { email: string; name: string }>) {
    const config = vscode.workspace.getConfiguration('aiCodeTracker');
    const teamMembers = config.get('teamMembers') as Record<string, string> || {};
    const patternManager = MarkPatternManager.getInstance();
    
    if (!fs.existsSync(filePath)) return;
    
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    
    const aiLinesSet = new Set<number>();
    let inAIBlock = false;
    let blockStart = -1;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // 使用新的模式管理器检测 AI 标记
      if (patternManager.hasAIMark(line)) {
        inAIBlock = true;
        blockStart = i;
      } else if (patternManager.hasHumanMark(line)) {
        inAIBlock = false;
      } else if (inAIBlock && line.trim() !== '' && !line.match(/^(\/\/|#|<!--|\/\*)/)) {
        // 在 AI 块内的非注释行
        aiLinesSet.add(i);
      }
      
      // 空行结束 AI 块
      if (inAIBlock && line.trim() === '' && blockStart !== i - 1) {
        inAIBlock = false;
      }
    }
    
    for (const [lineNum, author] of authors) {
      const lineIndex = lineNum - 1;
      if (lineIndex >= lines.length) continue;
      
      const isAI = aiLinesSet.has(lineIndex);
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