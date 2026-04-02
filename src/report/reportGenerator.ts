import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { TeamStatsManager } from '../core/teamStats';
import { MemberStats } from '../types';

const execAsync = promisify(exec);

// ==================== 类型定义 ====================

export interface WeeklyReport {
  weekStart: Date;
  weekEnd: Date;
  projectName: string;
  summary: ReportSummary;
  teamStats: TeamReportStats[];
  trends: TrendData[];
  topAIContributors: ContributorStats[];
  topHumanContributors: ContributorStats[];
  fileStats: FileReportStats[];
  recommendations: string[];
}

export interface ReportSummary {
  totalLines: number;
  aiLines: number;
  humanLines: number;
  modifiedAILines: number;
  aiPercentage: number;
  activeMembers: number;
  newFilesCount: number;
  modifiedFilesCount: number;
}

export interface TeamReportStats {
  name: string;
  email: string;
  totalLines: number;
  aiLines: number;
  humanLines: number;
  aiPercentage: number;
  trend: number;
  contribution: number;
}

export interface TrendData {
  date: string;
  aiPercentage: number;
  totalLines: number;
  aiLines: number;
}

export interface ContributorStats {
  name: string;
  email: string;
  aiLines: number;
  totalLines: number;
  aiPercentage: number;
}

export interface FileReportStats {
  filePath: string;
  aiLines: number;
  totalLines: number;
  aiPercentage: number;
  topAuthors: Map<string, number>;
}

// ==================== 报告生成器 ====================

export class ReportGenerator {
  private statsManager: TeamStatsManager;
  private context?: vscode.ExtensionContext;
  private reportHistory: Map<string, any>;
  
  constructor(statsManager: TeamStatsManager, context?: vscode.ExtensionContext) {
    this.statsManager = statsManager;
    this.context = context;
    this.reportHistory = new Map();
    this.loadHistoricalData();
  }
  
  // 加载历史数据
  private loadHistoricalData(): void {
    if (this.context) {
      const stored = this.context.globalState.get('aiReportHistory', []);
      this.reportHistory = new Map(stored);
    }
  }
  
  // 保存历史数据
  private saveHistoricalData(): void {
    if (this.context) {
      this.context.globalState.update('aiReportHistory', Array.from(this.reportHistory.entries()));
    }
  }
  
  // 获取项目名称
  private getProjectName(): string {
    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
      const workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
      return path.basename(workspacePath);
    }
    return '未命名项目';
  }

  // 生成周报（基于Git历史）
  async generateWeeklyReportFromGit(weekStart?: Date): Promise<WeeklyReport> {
    const now = new Date();
    const start = weekStart || this.getWeekStart(now);
    const end = this.getWeekEnd(start);
    
    // 获取本周数据
    const weeklyData = await this.collectGitData(start, end);
    
    // 获取上周数据用于趋势对比
    const lastWeekStart = new Date(start);
    lastWeekStart.setDate(lastWeekStart.getDate() - 7);
    const lastWeekData = await this.collectGitData(lastWeekStart, this.getWeekEnd(lastWeekStart));
    
    // 生成报告
    const report: WeeklyReport = {
      weekStart: start,
      weekEnd: end,
      projectName: this.getProjectName(),
      summary: this.calculateSummary(weeklyData),
      teamStats: this.calculateTeamStats(weeklyData, lastWeekData),
      trends: this.calculateTrends(weeklyData),
      topAIContributors: this.getTopContributors(weeklyData, 'ai'),
      topHumanContributors: this.getTopContributors(weeklyData, 'human'),
      fileStats: this.calculateFileStats(weeklyData),
      recommendations: this.generateRecommendations(weeklyData, lastWeekData)
    };
    
    // 保存历史
    this.saveWeeklyData(start, weeklyData);
    
    return report;
  }
  
  // 生成周报（基于本地统计数据，无需Git）
  async generateWeeklyReportFromStats(): Promise<WeeklyReport> {
    const now = new Date();
    const start = this.getWeekStart(now);
    const end = this.getWeekEnd(start);
    
    const stats = this.statsManager.getStats();
    const members = this.statsManager.getSortedMembers();
    
    // 构建周报数据
    const weeklyData = {
      totalLines: stats.totalLines,
      aiLines: stats.aiLines,
      humanLines: stats.humanLines,
      modifiedAILines: stats.modifiedAILines,
      authors: new Map(),
      files: stats.members,
      dailyData: new Map()
    };
    
    // 填充作者数据
    for (const member of members) {
      weeklyData.authors.set(member.email, {
        name: member.name,
        email: member.email,
        totalLines: member.totalLines,
        aiLines: member.aiLines,
        humanLines: member.humanLines,
        modifiedAILines: member.modifiedAILines
      });
    }
    
    // 获取上周数据（从历史中获取）
    const lastWeekStart = new Date(start);
    lastWeekStart.setDate(lastWeekStart.getDate() - 7);
    const lastWeekKey = lastWeekStart.toISOString().split('T')[0];
    const lastWeekData = this.reportHistory.get(lastWeekKey);
    
    const report: WeeklyReport = {
      weekStart: start,
      weekEnd: end,
      projectName: this.getProjectName(),
      summary: this.calculateSummary(weeklyData),
      teamStats: this.calculateTeamStats(weeklyData, lastWeekData),
      trends: this.calculateTrends(weeklyData),
      topAIContributors: this.getTopContributors(weeklyData, 'ai'),
      topHumanContributors: this.getTopContributors(weeklyData, 'human'),
      fileStats: this.calculateFileStats(weeklyData),
      recommendations: this.generateRecommendations(weeklyData, lastWeekData)
    };
    
    // 保存历史
    this.saveWeeklyData(start, weeklyData);
    
    return report;
  }
  
  // 获取一周的开始（周一）
  private getWeekStart(date: Date): Date {
    const d = new Date(date);
    const day = d.getDay();
    const diff = (day === 0 ? 6 : day - 1);
    d.setDate(d.getDate() - diff);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  
  // 获取一周的结束（周日）
  private getWeekEnd(start: Date): Date {
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return end;
  }
  
  // 收集Git数据
  private async collectGitData(start: Date, end: Date): Promise<any> {
    if (!vscode.workspace.workspaceFolders) {
      throw new Error('没有打开的工作区');
    }
    
    const workspacePath = vscode.workspace.workspaceFolders[0].uri.fsPath;
    const startStr = start.toISOString().split('T')[0];
    const endStr = end.toISOString().split('T')[0];
    
    try {
      // 获取本周所有提交
      const { stdout: gitLog } = await execAsync(
        `git log --since="${startStr}" --until="${endStr}" --pretty=format:"%H|%an|%ae|%ad" --date=short`,
        { cwd: workspacePath }
      );
      
      const commits = gitLog.split('\n').filter(l => l.trim()).map(line => {
        const [hash, name, email, date] = line.split('|');
        return { hash, name, email, date };
      });
      
      const weeklyStats = {
        totalLines: 0,
        aiLines: 0,
        humanLines: 0,
        modifiedAILines: 0,
        authors: new Map<string, any>(),
        files: new Map<string, any>(),
        dailyData: new Map<string, any>()
      };
      
      for (const commit of commits) {
        const stats = await this.getCommitStats(commit.hash, workspacePath);
        
        // 更新作者统计
        let author = weeklyStats.authors.get(commit.email);
        if (!author) {
          author = {
            name: commit.name,
            email: commit.email,
            totalLines: 0,
            aiLines: 0,
            humanLines: 0,
            modifiedAILines: 0
          };
          weeklyStats.authors.set(commit.email, author);
        }
        
        author.totalLines += stats.totalLines;
        author.aiLines += stats.aiLines;
        author.humanLines += stats.humanLines;
        
        weeklyStats.totalLines += stats.totalLines;
        weeklyStats.aiLines += stats.aiLines;
        weeklyStats.humanLines += stats.humanLines;
        
        // 更新每日数据
        let dayData = weeklyStats.dailyData.get(commit.date);
        if (!dayData) {
          dayData = { date: commit.date, totalLines: 0, aiLines: 0 };
          weeklyStats.dailyData.set(commit.date, dayData);
        }
        dayData.totalLines += stats.totalLines;
        dayData.aiLines += stats.aiLines;
      }
      
      return weeklyStats;
      
    } catch (error) {
      console.error('收集Git数据失败:', error);
      return null;
    }
  }
  
  // 获取提交的统计信息
  private async getCommitStats(commitHash: string, workspacePath: string): Promise<any> {
    try {
      const { stdout: diff } = await execAsync(
        `git show ${commitHash} --numstat`,
        { cwd: workspacePath }
      );
      
      const lines = diff.split('\n');
      let totalLines = 0;
      let aiLines = 0;
      let humanLines = 0;
      
      for (const line of lines) {
        const parts = line.split('\t');
        if (parts.length >= 3 && !isNaN(parseInt(parts[0]))) {
          const added = parseInt(parts[0]);
          const file = parts[2];
          
          totalLines += added;
          
          const filePath = path.join(workspacePath, file);
          if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf-8');
            if (content.includes('[AI-GEN]')) {
              aiLines += added;
            } else {
              humanLines += added;
            }
          } else {
            humanLines += added;
          }
        }
      }
      
      return { totalLines, aiLines, humanLines };
      
    } catch (error) {
      return { totalLines: 0, aiLines: 0, humanLines: 0 };
    }
  }
  
  // 计算汇总统计
  private calculateSummary(data: any): ReportSummary {
    if (!data) {
      return {
        totalLines: 0,
        aiLines: 0,
        humanLines: 0,
        modifiedAILines: 0,
        aiPercentage: 0,
        activeMembers: 0,
        newFilesCount: 0,
        modifiedFilesCount: 0
      };
    }
    
    const aiPercentage = data.totalLines > 0 
      ? (data.aiLines / data.totalLines * 100) 
      : 0;
    
    return {
      totalLines: data.totalLines,
      aiLines: data.aiLines,
      humanLines: data.humanLines,
      modifiedAILines: data.modifiedAILines || 0,
      aiPercentage,
      activeMembers: data.authors.size,
      newFilesCount: data.newFilesCount || 0,
      modifiedFilesCount: data.modifiedFilesCount || 0
    };
  }
  
  // 计算团队统计
  private calculateTeamStats(data: any, lastWeekData: any): TeamReportStats[] {
    if (!data) return [];
    
    const stats: TeamReportStats[] = [];
    const totalLines = data.totalLines;
    
    for (const [email, author] of data.authors) {
      const aiPercentage = author.totalLines > 0 
        ? (author.aiLines / author.totalLines * 100) 
        : 0;
      
      let trend = 0;
      if (lastWeekData && lastWeekData.authors?.has(email)) {
        const lastWeekAuthor = lastWeekData.authors.get(email);
        const lastWeekPercentage = lastWeekAuthor.totalLines > 0 
          ? (lastWeekAuthor.aiLines / lastWeekAuthor.totalLines * 100) 
          : 0;
        trend = aiPercentage - lastWeekPercentage;
      }
      
      stats.push({
        name: author.name,
        email: email,
        totalLines: author.totalLines,
        aiLines: author.aiLines,
        humanLines: author.humanLines,
        aiPercentage,
        trend,
        contribution: (author.totalLines / totalLines * 100)
      });
    }
    
    return stats.sort((a, b) => b.aiPercentage - a.aiPercentage);
  }
  
  // 计算趋势数据
  private calculateTrends(data: any): TrendData[] {
    if (!data?.dailyData) return [];
    
    const trends: TrendData[] = [];
    const sortedDates = Array.from(data.dailyData.keys()).sort();
    
    for (const date of sortedDates) {
      const dayData = data.dailyData.get(date);
      const aiPercentage = dayData.totalLines > 0 
        ? (dayData.aiLines / dayData.totalLines * 100) 
        : 0;
      
      trends.push({
        date: date as string,
        aiPercentage,
        totalLines: dayData.totalLines,
        aiLines: dayData.aiLines
      });
    }
    
    return trends;
  }
  
  // 获取Top贡献者
  private getTopContributors(data: any, type: 'ai' | 'human'): ContributorStats[] {
    if (!data) return [];
    
    const contributors: ContributorStats[] = [];
    
    for (const [email, author] of data.authors) {
      contributors.push({
        name: author.name,
        email: email,
        aiLines: author.aiLines,
        totalLines: author.totalLines,
        aiPercentage: author.totalLines > 0 ? (author.aiLines / author.totalLines * 100) : 0
      });
    }
    
    if (type === 'ai') {
      return contributors.sort((a, b) => b.aiLines - a.aiLines).slice(0, 5);
    } else {
      return contributors.sort((a, b) => (b.totalLines - b.aiLines) - (a.totalLines - a.aiLines)).slice(0, 5);
    }
  }
  
  // 计算文件统计
  private calculateFileStats(data: any): FileReportStats[] {
    if (!data?.files) return [];
    
    const stats: FileReportStats[] = [];
    
    for (const [filePath, file] of data.files) {
      const aiPercentage = file.totalLines > 0 
        ? (file.aiLines / file.totalLines * 100) 
        : 0;
      
      stats.push({
        filePath,
        aiLines: file.aiLines,
        totalLines: file.totalLines,
        aiPercentage,
        topAuthors: file.authorLines || new Map()
      });
    }
    
    return stats.sort((a, b) => b.aiPercentage - a.aiPercentage).slice(0, 10);
  }
  
  // 生成建议
  private generateRecommendations(data: any, lastWeekData: any): string[] {
    const recommendations: string[] = [];
    
    if (!data) return recommendations;
    
    const currentAIPercentage = data.totalLines > 0 ? (data.aiLines / data.totalLines * 100) : 0;
    const lastWeekAIPercentage = lastWeekData?.totalLines > 0 
      ? (lastWeekData.aiLines / lastWeekData.totalLines * 100) 
      : 0;
    
    if (currentAIPercentage > lastWeekAIPercentage + 10) {
      recommendations.push('📈 AI使用率大幅上升，建议团队分享AI使用技巧');
    } else if (currentAIPercentage < lastWeekAIPercentage - 10 && lastWeekAIPercentage > 0) {
      recommendations.push('📉 AI使用率下降，可以考虑组织AI工具培训');
    }
    
    if (data.authors.size < 2 && data.totalLines > 100) {
      recommendations.push('👥 团队协作较少，建议增加代码审查和协作');
    }
    
    const modifiedAIRate = data.modifiedAILines && data.aiLines > 0 
      ? (data.modifiedAILines / data.aiLines * 100) 
      : 0;
    
    if (modifiedAIRate > 30) {
      recommendations.push('🔧 AI代码修改率较高，建议优化AI提示词以提高代码质量');
    }
    
    if (recommendations.length === 0) {
      recommendations.push('🎉 团队AI使用情况良好，继续保持！');
    }
    
    return recommendations;
  }
  
  // 保存每周数据
  private saveWeeklyData(weekStart: Date, data: any): void {
    const key = weekStart.toISOString().split('T')[0];
    this.reportHistory.set(key, data);
    this.saveHistoricalData();
  }
}