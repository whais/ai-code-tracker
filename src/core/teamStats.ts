import * as vscode from 'vscode';
import { TeamStats, MemberStats } from '../types';
import { storage } from '../utils/storage';

export class TeamStatsManager {
  private stats: TeamStats;
  private listeners: (() => void)[] = [];
  private storageInitialized = false;

  constructor() {
    // 延迟初始化：等 storage 初始化后再加载数据
    this.stats = {
      totalLines: 0,
      aiLines: 0,
      humanLines: 0,
      modifiedAILines: 0,
      members: new Map()
    };
  }

  /**
   * 从持久化存储加载数据
   * 应在 storage 初始化后调用
   */
  loadFromStorage(): void {
    if (this.storageInitialized) {
      return;
    }
    
    try {
      const savedStats = storage.loadTeamStats();
      if (savedStats) {
        this.stats = savedStats;
        console.log('[TeamStatsManager] 已从存储加载统计数据');
      }
    } catch (error) {
      console.log('[TeamStatsManager] 从存储加载数据失败:', error);
    }
    
    this.storageInitialized = true;
  }

  getStats(): TeamStats {
    return this.stats;
  }

  getMember(email: string): MemberStats | undefined {
    return this.stats.members.get(email);
  }

  addListener(listener: () => void): void {
    this.listeners.push(listener);
  }

  private notifyListeners(): void {
    this.listeners.forEach(listener => listener());
  }

  updateStats(updater: (stats: TeamStats) => void): void {
    updater(this.stats);
    this.notifyListeners();
  }

  getTotalAIPercentage(): number {
    return this.stats.totalLines > 0 
      ? (this.stats.aiLines / this.stats.totalLines * 100) 
      : 0;
  }

  getSortedMembers(): MemberStats[] {
    return Array.from(this.stats.members.values())
      .sort((a, b) => b.aiPercentage - a.aiPercentage);
  }

  clear(): void {
    this.stats = {
      totalLines: 0,
      aiLines: 0,
      humanLines: 0,
      modifiedAILines: 0,
      members: new Map()
    };
    this.notifyListeners();
  }
}