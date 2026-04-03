/**
 * 数据持久化管理器
 * 使用 VSCode ExtensionContext 的 globalState 和 workspaceState 存储数据
 */

import * as vscode from 'vscode';
import { TeamStats, MemberStats, FileStats } from '../types';

// 存储键名常量
export const StorageKeys = {
  TEAM_STATS: 'aiCodeTracker.teamStats',
  LAST_ANALYZED: 'aiCodeTracker.lastAnalyzed',
  CACHE_METADATA: 'aiCodeTracker.cacheMetadata'
} as const;

// 序列化后的 MemberStats 类型（Map 转为普通对象）
interface SerializedMemberStats {
  name: string;
  email: string;
  totalLines: number;
  aiLines: number;
  humanLines: number;
  modifiedAILines: number;
  aiPercentage: number;
  files: Record<string, FileStats>;
}

// 序列化后的 TeamStats 类型
interface SerializedTeamStats {
  totalLines: number;
  aiLines: number;
  humanLines: number;
  modifiedAILines: number;
  members: Record<string, SerializedMemberStats>;
  timestamp: number;
}

export class StorageManager {
  private static instance: StorageManager;
  private context: vscode.ExtensionContext | null = null;

  private constructor() {}

  static getInstance(): StorageManager {
    if (!StorageManager.instance) {
      StorageManager.instance = new StorageManager();
    }
    return StorageManager.instance;
  }

  /**
   * 初始化存储管理器
   * @param context VSCode 扩展上下文
   */
  initialize(context: vscode.ExtensionContext): void {
    this.context = context;
  }

  /**
   * 检查是否已初始化
   */
  private checkInitialized(): void {
    if (!this.context) {
      throw new Error('StorageManager 未初始化，请先调用 initialize()');
    }
  }

  /**
   * 将 TeamStats 序列化为可存储的格式
   */
  private serializeTeamStats(stats: TeamStats): SerializedTeamStats {
    const members: Record<string, SerializedMemberStats> = {};
    
    for (const [email, member] of stats.members.entries()) {
      const files: Record<string, FileStats> = {};
      for (const [filePath, fileStat] of member.files.entries()) {
        files[filePath] = fileStat;
      }
      
      members[email] = {
        name: member.name,
        email: member.email,
        totalLines: member.totalLines,
        aiLines: member.aiLines,
        humanLines: member.humanLines,
        modifiedAILines: member.modifiedAILines,
        aiPercentage: member.aiPercentage,
        files
      };
    }

    return {
      totalLines: stats.totalLines,
      aiLines: stats.aiLines,
      humanLines: stats.humanLines,
      modifiedAILines: stats.modifiedAILines,
      members,
      timestamp: Date.now()
    };
  }

  /**
   * 将序列化数据还原为 TeamStats
   */
  private deserializeTeamStats(data: SerializedTeamStats): TeamStats {
    const members = new Map<string, MemberStats>();

    for (const [email, memberData] of Object.entries(data.members)) {
      const files = new Map<string, FileStats>();
      
      for (const [filePath, fileStat] of Object.entries(memberData.files)) {
        // 还原 authorLines 为 Map
        const authorLines = new Map<string, number>();
        if (fileStat.authorLines) {
          for (const [author, count] of Object.entries(fileStat.authorLines)) {
            authorLines.set(author, count as number);
          }
        }
        
        files.set(filePath, {
          ...fileStat,
          authorLines
        });
      }

      members.set(email, {
        name: memberData.name,
        email: memberData.email,
        totalLines: memberData.totalLines,
        aiLines: memberData.aiLines,
        humanLines: memberData.humanLines,
        modifiedAILines: memberData.modifiedAILines,
        aiPercentage: memberData.aiPercentage,
        files
      });
    }

    return {
      totalLines: data.totalLines,
      aiLines: data.aiLines,
      humanLines: data.humanLines,
      modifiedAILines: data.modifiedAILines,
      members
    };
  }

  /**
   * 保存团队统计数据
   * @param stats 团队统计数据
   */
  async saveTeamStats(stats: TeamStats): Promise<void> {
    this.checkInitialized();
    
    const serialized = this.serializeTeamStats(stats);
    await this.context!.globalState.update(StorageKeys.TEAM_STATS, serialized);
    
    console.log('[Storage] 团队统计数据已保存');
  }

  /**
   * 加载团队统计数据
   * @returns 团队统计数据，如果没有则返回 null
   */
  loadTeamStats(): TeamStats | null {
    this.checkInitialized();
    
    const data = this.context!.globalState.get<SerializedTeamStats>(StorageKeys.TEAM_STATS);
    if (!data) {
      return null;
    }

    try {
      const stats = this.deserializeTeamStats(data);
      console.log(`[Storage] 团队统计数据已加载 (保存于 ${new Date(data.timestamp).toLocaleString()})`);
      return stats;
    } catch (error) {
      console.error('[Storage] 加载团队统计数据失败:', error);
      return null;
    }
  }

  /**
   * 清除团队统计数据
   */
  async clearTeamStats(): Promise<void> {
    this.checkInitialized();
    await this.context!.globalState.update(StorageKeys.TEAM_STATS, undefined);
    console.log('[Storage] 团队统计数据已清除');
  }

  /**
   * 保存最后分析时间
   * @param filePath 文件路径
   * @param timestamp 分析时间戳
   */
  async saveLastAnalyzed(filePath: string, timestamp: number = Date.now()): Promise<void> {
    this.checkInitialized();
    
    const data = this.context!.workspaceState.get<Record<string, number>>(StorageKeys.LAST_ANALYZED, {});
    data[filePath] = timestamp;
    await this.context!.workspaceState.update(StorageKeys.LAST_ANALYZED, data);
  }

  /**
   * 获取最后分析时间
   * @param filePath 文件路径
   * @returns 分析时间戳，如果没有则返回 0
   */
  getLastAnalyzed(filePath: string): number {
    this.checkInitialized();
    
    const data = this.context!.workspaceState.get<Record<string, number>>(StorageKeys.LAST_ANALYZED, {});
    return data[filePath] || 0;
  }

  /**
   * 检查文件是否需要重新分析
   * @param filePath 文件路径
   * @param maxAge 最大年龄（毫秒），默认 5 分钟
   * @returns 是否需要重新分析
   */
  needsReanalysis(filePath: string, maxAge: number = 5 * 60 * 1000): boolean {
    const lastAnalyzed = this.getLastAnalyzed(filePath);
    if (lastAnalyzed === 0) {
      return true;
    }
    
    return Date.now() - lastAnalyzed > maxAge;
  }

  /**
   * 清除所有存储的数据
   */
  async clearAll(): Promise<void> {
    this.checkInitialized();
    
    await this.context!.globalState.update(StorageKeys.TEAM_STATS, undefined);
    await this.context!.workspaceState.update(StorageKeys.LAST_ANALYZED, undefined);
    await this.context!.workspaceState.update(StorageKeys.CACHE_METADATA, undefined);
    
    console.log('[Storage] 所有数据已清除');
  }

  /**
   * 获取存储统计信息
   */
  getStats(): { globalKeys: number; workspaceKeys: number } {
    this.checkInitialized();
    
    // VSCode API 没有直接提供获取所有键的方法
    // 这里只能检查已知的键
    const globalKeys = [StorageKeys.TEAM_STATS].filter(
      key => this.context!.globalState.get(key) !== undefined
    ).length;
    
    const workspaceKeys = [StorageKeys.LAST_ANALYZED, StorageKeys.CACHE_METADATA].filter(
      key => this.context!.workspaceState.get(key) !== undefined
    ).length;
    
    return { globalKeys, workspaceKeys };
  }
}

// 导出便捷实例
export const storage = StorageManager.getInstance();
