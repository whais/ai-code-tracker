/**
 * 团队统计文件管理器
 * 负责读写 .ai-tracker/stats.json 文件，实现团队统计数据的共享
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getWorkspaceRoot } from '../utils/workspace';

// 统计文件路径
const STATS_DIR = '.ai-tracker';
const STATS_FILE = 'stats.json';

// 成员统计接口（简化版，用于共享）
export interface SharedMemberStats {
  name: string;
  totalLines: number;
  aiLines: number;
  humanLines: number;
  aiPercentage: number;
  lastUpdated: number;
}

// 共享统计数据结构
export interface SharedTeamStats {
  version: string;
  lastUpdated: number;
  project: string;
  members: Record<string, SharedMemberStats>;
  total: {
    totalLines: number;
    aiLines: number;
    humanLines: number;
    aiPercentage: number;
  };
}

export class StatsFileManager {
  private static instance: StatsFileManager;
  private statsCache: SharedTeamStats | null = null;
  private lastReadTime: number = 0;
  private readonly CACHE_TTL = 5000; // 缓存 5 秒

  private constructor() {}

  static getInstance(): StatsFileManager {
    if (!StatsFileManager.instance) {
      StatsFileManager.instance = new StatsFileManager();
    }
    return StatsFileManager.instance;
  }

  /**
   * 获取统计文件的完整路径
   */
  private getStatsFilePath(): string | null {
    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) return null;
    return path.join(workspaceRoot, STATS_DIR, STATS_FILE);
  }

  /**
   * 确保统计目录存在
   */
  private ensureStatsDir(): boolean {
    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) return false;
    
    const statsDir = path.join(workspaceRoot, STATS_DIR);
    try {
      if (!fs.existsSync(statsDir)) {
        fs.mkdirSync(statsDir, { recursive: true });
      }
      return true;
    } catch (error) {
      console.error('[StatsFileManager] 创建统计目录失败:', error);
      return false;
    }
  }

  /**
   * 读取统计文件（带缓存）
   */
  readStats(): SharedTeamStats | null {
    // 检查缓存是否有效
    if (this.statsCache && Date.now() - this.lastReadTime < this.CACHE_TTL) {
      return this.statsCache;
    }

    const filePath = this.getStatsFilePath();
    if (!filePath) return null;

    try {
      if (!fs.existsSync(filePath)) {
        return null;
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      const stats = JSON.parse(content) as SharedTeamStats;
      
      // 更新缓存
      this.statsCache = stats;
      this.lastReadTime = Date.now();
      
      return stats;
    } catch (error) {
      console.error('[StatsFileManager] 读取统计文件失败:', error);
      return null;
    }
  }

  /**
   * 写入统计文件
   */
  writeStats(stats: SharedTeamStats): boolean {
    if (!this.ensureStatsDir()) return false;

    const filePath = this.getStatsFilePath();
    if (!filePath) return false;

    try {
      // 更新元数据
      stats.version = '1.0';
      stats.lastUpdated = Date.now();
      
      const content = JSON.stringify(stats, null, 2);
      fs.writeFileSync(filePath, content, 'utf-8');
      
      // 更新缓存
      this.statsCache = stats;
      this.lastReadTime = Date.now();
      
      console.log('[StatsFileManager] 统计文件已更新:', filePath);
      return true;
    } catch (error) {
      console.error('[StatsFileManager] 写入统计文件失败:', error);
      return false;
    }
  }

  /**
   * 更新或添加成员统计（增量更新）
   */
  updateMemberStats(email: string, delta: Partial<SharedMemberStats>): boolean {
    const stats = this.readStats() || this.createEmptyStats();
    
    const existing = stats.members[email] || {
      name: delta.name || email.split('@')[0],
      totalLines: 0,
      aiLines: 0,
      humanLines: 0,
      aiPercentage: 0,
      lastUpdated: Date.now()
    };

    // 累加数值
    if (delta.totalLines !== undefined) existing.totalLines += delta.totalLines;
    if (delta.aiLines !== undefined) existing.aiLines += delta.aiLines;
    if (delta.humanLines !== undefined) existing.humanLines += delta.humanLines;
    if (delta.name !== undefined) existing.name = delta.name;
    
    // 重新计算百分比
    if (existing.totalLines > 0) {
      existing.aiPercentage = (existing.aiLines / existing.totalLines) * 100;
    }
    
    existing.lastUpdated = Date.now();
    stats.members[email] = existing;

    // 更新总计
    this.recalculateTotal(stats);
    
    return this.writeStats(stats);
  }

  /**
   * 重新计算总计
   */
  private recalculateTotal(stats: SharedTeamStats): void {
    let totalLines = 0;
    let aiLines = 0;
    let humanLines = 0;

    for (const member of Object.values(stats.members)) {
      totalLines += member.totalLines;
      aiLines += member.aiLines;
      humanLines += member.humanLines;
    }

    stats.total = {
      totalLines,
      aiLines,
      humanLines,
      aiPercentage: totalLines > 0 ? (aiLines / totalLines) * 100 : 0
    };
  }

  /**
   * 创建空的统计结构
   */
  private createEmptyStats(): SharedTeamStats {
    const workspaceRoot = getWorkspaceRoot();
    const projectName = workspaceRoot ? path.basename(workspaceRoot) : 'unknown';
    
    return {
      version: '1.0',
      lastUpdated: Date.now(),
      project: projectName,
      members: {},
      total: {
        totalLines: 0,
        aiLines: 0,
        humanLines: 0,
        aiPercentage: 0
      }
    };
  }

  /**
   * 获取团队成员列表
   */
  getTeamMembers(): Array<{ email: string; name: string }> {
    const stats = this.readStats();
    if (!stats) return [];

    return Object.entries(stats.members).map(([email, member]) => ({
      email,
      name: member.name
    }));
  }

  /**
   * 强制刷新（清除缓存并重新读取）
   */
  forceRefresh(): SharedTeamStats | null {
    this.statsCache = null;
    this.lastReadTime = 0;
    return this.readStats();
  }

  /**
   * 检查统计文件是否存在
   */
  statsFileExists(): boolean {
    const filePath = this.getStatsFilePath();
    return filePath ? fs.existsSync(filePath) : false;
  }

  /**
   * 获取统计文件路径（供 Git 操作使用）
   */
  getStatsFileRelativePath(): string | null {
    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) return null;
    return path.join(STATS_DIR, STATS_FILE);
  }
}

// 导出单例
export const statsFileManager = StatsFileManager.getInstance();
