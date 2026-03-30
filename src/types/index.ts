import * as vscode from 'vscode';

export interface TeamStats {
  totalLines: number;
  aiLines: number;
  humanLines: number;
  modifiedAILines: number;
  members: Map<string, MemberStats>;
}

export interface MemberStats {
  name: string;
  email: string;
  totalLines: number;
  aiLines: number;
  humanLines: number;
  modifiedAILines: number;
  aiPercentage: number;
  files: Map<string, FileStats>;
}

export interface FileStats {
  filePath: string;
  totalLines: number;
  aiLines: number;
  humanLines: number;
  modifiedAILines: number;
  authorLines: Map<string, number>;
}

export interface WeeklyReport {
  weekStart: Date;
  weekEnd: Date;
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

export interface AIPluginPattern {
  name: string;
  patterns: RegExp[];
}

export interface PendingDetection {
  document: vscode.TextDocument;
  changes: readonly vscode.TextDocumentContentChangeEvent[];
  timeout: NodeJS.Timeout;
}

// [AI-GEN] model=deepseek timestamp=2026-03-30T03:56:58.326Z
export interface AIMarkPattern {
  name: string;           // 标记名称，如 'deepseek', 'copilot'
  patterns: string[];     // 正则表达式字符串数组，用于匹配
  description?: string;   // 描述
  enabled: boolean;       // 是否启用
  extractAuthor?: boolean;// 新增：是否支持提取作者信息
  authorPattern?: string; // 新增：作者提取正则（如果支持）
  extractTool?: boolean;  // 新增：是否支持提取模型/工具名
  toolPattern?: string;   // 新增：工具名提取正
}

export interface AIDetectionConfig {
  // 自定义 AI 标记模式
  customPatterns: AIMarkPattern[];
  // 是否启用自动检测
  autoDetect: boolean;
  // 自动检测阈值（行数）
  autoDetectThreshold: number;
  // 是否自动添加标记
  autoMark: boolean;
  // 默认 AI 模型名称
  defaultModel: string;
  // 标记格式: 'comment' | 'tag' | 'custom'
  markFormat: 'comment' | 'tag' | 'custom';
  // 自定义标记模板
  customMarkTemplate?: string;
}

// 新增：解析后的标记信息
export interface ParsedAIMark {
  type: 'ai' | 'human';
  tool?: string;           // AI 工具名称
  author?: string;         // 作者名称/邮箱前缀
  timestamp?: Date;        // 时间戳
  rawText: string;         // 原始文本
  matchedPattern: string;  // 匹配的模式
  description?: string;
}