/**
 * 行级归属追踪器 - 无感统计核心
 * 记录每行代码的来源和变更历史
 */

import * as vscode from 'vscode';
import { storage } from '../utils/storage';

export type LineSource = 'ai' | 'human' | 'unknown';
export type LineStatus = 'generated' | 'modified' | 'deleted' | 'original';

export interface LineInfo {
  source: LineSource;
  status: LineStatus;
  aiModel?: string;
  originalContent: string;
  currentContent: string;
  createdAt: number;
  lastModifiedAt: number;
  lastModifiedBy: LineSource;
  editCount: number;
}

export interface FileLineMap {
  [lineNumber: number]: LineInfo;
}

// 文件级别的整合统计结果
export interface FileSourceStats {
  filePath: string;
  totalLines: number;
  aiLines: number;
  humanLines: number;
  unknownLines: number;
  // 数据来源说明
  sourceBreakdown: {
    fromMarks: number;      // 来自文件标记
    fromTracking: number;   // 来自实时追踪
    fromBlame: number;      // 来自 git blame
  };
  lastUpdated: number;
}

export class LineTracker {
  private fileMaps: Map<string, FileLineMap> = new Map();
  private context?: vscode.ExtensionContext;
  private static instance: LineTracker;
  
  // 归属策略
  private strategy: 'conservative' | 'aggressive' | 'last-modifier' = 'last-modifier';
  private aggressiveThreshold = 0.8; // 80%字符变化视为重写

  private constructor() {}

  static getInstance(): LineTracker {
    if (!LineTracker.instance) {
      LineTracker.instance = new LineTracker();
    }
    return LineTracker.instance;
  }

  initialize(context: vscode.ExtensionContext): void {
    this.context = context;
    this.loadFromStorage();
  }

  /**
   * 记录AI生成的代码
   */
  recordAIGeneration(
    document: vscode.TextDocument,
    startLine: number,
    endLine: number,
    aiModel: string = 'unknown'
  ): void {
    const filePath = document.fileName;
    const map = this.getOrCreateMap(filePath);

    for (let i = startLine; i <= endLine; i++) {
      const lineContent = document.lineAt(i).text;
      map[i] = {
        source: 'ai',
        status: 'generated',
        aiModel,
        originalContent: lineContent,
        currentContent: lineContent,
        createdAt: Date.now(),
        lastModifiedAt: Date.now(),
        lastModifiedBy: 'ai',
        editCount: 0
      };
    }

    // 异步持久化，不阻塞主流程
    this.persist().catch(err => console.error('[LineTracker] 持久化失败:', err));
    console.log(`[LineTracker] 记录AI代码: ${filePath} [${startLine}-${endLine}]`);
  }

  /**
   * 记录人工编辑
   */
  recordHumanEdit(
    document: vscode.TextDocument,
    change: vscode.TextDocumentContentChangeEvent
  ): void {
    const filePath = document.fileName;
    const map = this.getOrCreateMap(filePath);
    const startLine = change.range.start.line;
    const endLine = change.range.end.line;

    // 处理删除
    if (change.text === '' && change.rangeLength > 0) {
      for (let i = startLine; i <= endLine; i++) {
        if (map[i]) {
          map[i].status = 'deleted';
          map[i].lastModifiedAt = Date.now();
          map[i].lastModifiedBy = 'human';
        }
      }
      // 异步持久化
      this.persist().catch(err => console.error('[LineTracker] 持久化失败:', err));
      return;
    }

    // 处理插入/替换
    const newLines = change.text.split('\n');
    const originalEndLine = endLine;
    const newEndLine = startLine + newLines.length - 1;

    // 如果行数变化，需要调整后续行的记录
    if (newEndLine !== originalEndLine) {
      this.adjustLineNumbers(filePath, originalEndLine, newEndLine - originalEndLine);
    }

    // 记录每一行
    newLines.forEach((content, index) => {
      const lineNum = startLine + index;
      const existing = map[lineNum];

      if (existing && existing.source === 'ai') {
        // AI代码被人工修改
        const updatedInfo = this.applyAttributionStrategy(existing, content, 'human');
        map[lineNum] = updatedInfo;
      } else if (existing) {
        // 人工代码继续修改
        existing.currentContent = content;
        existing.lastModifiedAt = Date.now();
        existing.editCount++;
      } else {
        // 全新的人工代码
        map[lineNum] = {
          source: 'human',
          status: 'original',
          originalContent: content,
          currentContent: content,
          createdAt: Date.now(),
          lastModifiedAt: Date.now(),
          lastModifiedBy: 'human',
          editCount: 1
        };
      }
    });

    // 异步持久化
    this.persist().catch(err => console.error('[LineTracker] 持久化失败:', err));
  }

  /**
   * 应用归属策略
   */
  private applyAttributionStrategy(
    lineInfo: LineInfo,
    newContent: string,
    editor: LineSource
  ): LineInfo {
    switch (this.strategy) {
      case 'conservative':
        // 任何人工修改都转为human
        return {
          ...lineInfo,
          source: editor === 'human' ? 'human' : lineInfo.source,
          status: editor === 'human' ? 'modified' : lineInfo.status,
          currentContent: newContent,
          lastModifiedAt: Date.now(),
          lastModifiedBy: editor,
          editCount: lineInfo.editCount + 1
        };

      case 'aggressive':
        // 只有大幅修改才变更
        const similarity = this.calculateSimilarity(lineInfo.originalContent, newContent);
        const isMajorChange = similarity < (1 - this.aggressiveThreshold);
        
        return {
          ...lineInfo,
          source: (isMajorChange && editor === 'human') ? 'human' : lineInfo.source,
          status: 'modified',
          currentContent: newContent,
          lastModifiedAt: Date.now(),
          lastModifiedBy: editor,
          editCount: lineInfo.editCount + 1
        };

      case 'last-modifier':
      default:
        // 最后修改者决定
        return {
          ...lineInfo,
          source: editor,
          status: editor === 'human' && lineInfo.source === 'ai' ? 'modified' : lineInfo.status,
          currentContent: newContent,
          lastModifiedAt: Date.now(),
          lastModifiedBy: editor,
          editCount: lineInfo.editCount + 1
        };
    }
  }

  /**
   * 计算字符串相似度（简化版）
   */
  private calculateSimilarity(a: string, b: string): number {
    if (a === b) return 1;
    if (a.length === 0 || b.length === 0) return 0;
    
    const maxLen = Math.max(a.length, b.length);
    const commonLen = this.longestCommonSubsequence(a, b);
    return commonLen / maxLen;
  }

  /**
   * 最长公共子序列
   */
  private longestCommonSubsequence(a: string, b: string): number {
    const m = a.length, n = b.length;
    const dp: number[][] = Array(m + 1).fill(0).map(() => Array(n + 1).fill(0));
    
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (a[i - 1] === b[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }
    
    return dp[m][n];
  }

  /**
   * 调整行号（插入/删除导致）
   */
  private adjustLineNumbers(filePath: string, afterLine: number, delta: number): void {
    const map = this.fileMaps.get(filePath);
    if (!map || delta === 0) return;

    const newMap: FileLineMap = {};
    
    // 重新分配行号
    Object.entries(map).forEach(([lineNum, info]) => {
      const num = parseInt(lineNum);
      if (num > afterLine) {
        newMap[num + delta] = info;
      } else {
        newMap[num] = info;
      }
    });

    this.fileMaps.set(filePath, newMap);
  }

  /**
   * 计算文件的AI贡献
   */
  calculateFileStats(filePath: string): {
    aiGenerated: number;
    aiAccepted: number;
    aiModified: number;
    humanWritten: number;
    total: number;
    acceptanceRate: number;
  } {
    const map = this.fileMaps.get(filePath) || {};
    const lines = Object.values(map).filter(l => l.status !== 'deleted');

    const stats = {
      aiGenerated: 0,
      aiAccepted: 0,
      aiModified: 0,
      humanWritten: 0,
      total: lines.length,
      acceptanceRate: 0
    };

    lines.forEach(line => {
      if (line.source === 'ai') {
        if (line.status === 'modified') {
          stats.aiModified++;
        } else {
          stats.aiAccepted++;
        }
        stats.aiGenerated++;
      } else {
        stats.humanWritten++;
      }
    });

    stats.acceptanceRate = stats.aiGenerated > 0
      ? (stats.aiAccepted / stats.aiGenerated) * 100
      : 0;

    return stats;
  }

  /**
   * 创建Git提交快照
   */
  createSnapshot(filePath: string): {
    filePath: string;
    timestamp: number;
    lineMap: FileLineMap;
  } | null {
    const map = this.fileMaps.get(filePath);
    if (!map) return null;

    return {
      filePath,
      timestamp: Date.now(),
      lineMap: { ...map }
    };
  }



  /**
   * 获取或创建文件的行地图
   */
  private getOrCreateMap(filePath: string): FileLineMap {
    if (!this.fileMaps.has(filePath)) {
      this.fileMaps.set(filePath, {});
    }
    return this.fileMaps.get(filePath)!;
  }

  /**
   * 设置归属策略
   */
  setStrategy(strategy: 'conservative' | 'aggressive' | 'last-modifier'): void {
    this.strategy = strategy;
  }

  /**
   * 持久化到存储
   */
  private async persist(): Promise<void> {
    const data = Array.from(this.fileMaps.entries());
    // 使用统一存储管理器
    await storage.saveLineTrackerData(data);
  }

  /**
   * 从存储加载
   */
  private loadFromStorage(): void {
    const data = storage.loadLineTrackerData();
    if (data) {
      this.fileMaps = new Map(data);
    }
  }

  /**
   * 获取文件的行级来源信息
   * 供 GitAnalyzer 整合使用
   */
  getFileLineMap(filePath: string): FileLineMap | undefined {
    return this.fileMaps.get(filePath);
  }

  /**
   * 检查文件是否有实时追踪数据
   */
  hasTrackingData(filePath: string): boolean {
    return this.fileMaps.has(filePath);
  }

  /**
   * 获取指定行号的来源信息
   */
  getLineInfo(filePath: string, lineNumber: number): LineInfo | undefined {
    const map = this.fileMaps.get(filePath);
    return map?.[lineNumber];
  }

  /**
   * 获取文件的统计信息（按来源分类）
   * 用于与 GitAnalyzer 整合
   */
  getFileStats(filePath: string): FileSourceStats | null {
    const map = this.fileMaps.get(filePath);
    if (!map) return null;

    const lines = Object.values(map).filter(l => l.status !== 'deleted');
    
    let aiLines = 0;
    let humanLines = 0;
    let unknownLines = 0;

    lines.forEach(line => {
      if (line.source === 'ai') {
        aiLines++;
      } else if (line.source === 'human') {
        humanLines++;
      } else {
        unknownLines++;
      }
    });

    return {
      filePath,
      totalLines: lines.length,
      aiLines,
      humanLines,
      unknownLines,
      sourceBreakdown: {
        fromMarks: 0,     // 由 GitAnalyzer 填充
        fromTracking: aiLines + humanLines + unknownLines,
        fromBlame: 0
      },
      lastUpdated: Date.now()
    };
  }

  /**
   * 合并外部标记数据（来自 GitAnalyzer 的文件标记分析结果）
   * 优先级：文件标记 > 实时追踪
   */
  mergeMarkData(filePath: string, aiLineNumbers: Set<number>): void {
    const map = this.getOrCreateMap(filePath);
    const now = Date.now();

    aiLineNumbers.forEach(lineNum => {
      // 如果该行已有实时追踪数据且标记为人工，保留人工标记（人工修改优先）
      const existing = map[lineNum];
      if (existing && existing.source === 'human' && existing.editCount > 0) {
        // 人工修改过，不覆盖
        return;
      }

      // 否则标记为AI（来自文件标记）
      map[lineNum] = {
        source: 'ai',
        status: 'generated',
        aiModel: 'from-mark',
        originalContent: existing?.originalContent || '',
        currentContent: existing?.currentContent || '',
        createdAt: existing?.createdAt || now,
        lastModifiedAt: now,
        lastModifiedBy: 'ai',
        editCount: existing?.editCount || 0
      };
    });

    // 异步持久化
    this.persist().catch(err => console.error('[LineTracker] 持久化失败:', err));
  }

  /**
   * 清除文件的追踪数据
   */
  clearFile(filePath: string): void {
    this.fileMaps.delete(filePath);
    // 异步持久化
    this.persist().catch(err => console.error('[LineTracker] 持久化失败:', err));
  }

  /**
   * 获取所有被追踪的文件路径
   */
  getTrackedFiles(): string[] {
    return Array.from(this.fileMaps.keys());
  }

  /**
   * 获取所有文件统计
   */
  getAllStats(): Map<string, ReturnType<typeof this.calculateFileStats>> {
    const stats = new Map();
    for (const filePath of this.fileMaps.keys()) {
      stats.set(filePath, this.calculateFileStats(filePath));
    }
    return stats;
  }
}
