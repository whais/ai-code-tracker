/**
 * 统一日志管理器
 * 使用 VSCode 输出通道替代 console.log，提供更专业的日志管理
 */

import * as vscode from 'vscode';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

export class Logger {
  private static instance: Logger;
  private outputChannel: vscode.OutputChannel;
  private logLevel: LogLevel;

  private constructor() {
    this.outputChannel = vscode.window.createOutputChannel('AI Code Tracker');
    this.logLevel = LogLevel.INFO; // 默认级别
  }

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  /**
   * 设置日志级别
   */
  setLogLevel(level: LogLevel): void {
    this.logLevel = level;
  }

  /**
   * 获取当前日志级别
   */
  getLogLevel(): LogLevel {
    return this.logLevel;
  }

  /**
   * 格式化日志消息
   */
  private formatMessage(level: string, message: string): string {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${level}] ${message}`;
  }

  /**
   * 记录调试日志
   */
  debug(message: string, ...args: any[]): void {
    if (this.logLevel <= LogLevel.DEBUG) {
      const formatted = this.formatMessage('DEBUG', message);
      this.outputChannel.appendLine(formatted);
      if (args.length > 0) {
        this.outputChannel.appendLine('  ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
      }
    }
  }

  /**
   * 记录信息日志
   */
  info(message: string, ...args: any[]): void {
    if (this.logLevel <= LogLevel.INFO) {
      const formatted = this.formatMessage('INFO', message);
      this.outputChannel.appendLine(formatted);
      if (args.length > 0) {
        this.outputChannel.appendLine('  ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
      }
    }
  }

  /**
   * 记录警告日志
   */
  warn(message: string, ...args: any[]): void {
    if (this.logLevel <= LogLevel.WARN) {
      const formatted = this.formatMessage('WARN', message);
      this.outputChannel.appendLine(formatted);
      if (args.length > 0) {
        this.outputChannel.appendLine('  ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
      }
    }
  }

  /**
   * 记录错误日志
   */
  error(message: string, error?: Error | any): void {
    if (this.logLevel <= LogLevel.ERROR) {
      const formatted = this.formatMessage('ERROR', message);
      this.outputChannel.appendLine(formatted);
      if (error) {
        if (error instanceof Error) {
          this.outputChannel.appendLine(`  ${error.name}: ${error.message}`);
          if (error.stack) {
            this.outputChannel.appendLine('  Stack: ' + error.stack);
          }
        } else {
          this.outputChannel.appendLine('  ' + String(error));
        }
      }
    }
  }

  /**
   * 显示输出面板
   */
  show(): void {
    this.outputChannel.show(true);
  }

  /**
   * 清空日志
   */
  clear(): void {
    this.outputChannel.clear();
  }

  /**
   * 记录性能信息
   */
  perf(operation: string, startTime: number): void {
    const duration = Date.now() - startTime;
    this.debug(`[PERF] ${operation} 耗时: ${duration}ms`);
  }

  /**
   * 记录缓存操作
   */
  cache(operation: 'hit' | 'miss' | 'set' | 'clear', key: string): void {
    this.debug(`[CACHE] ${operation.toUpperCase()}: ${key}`);
  }

  /**
   * 记录 Git 操作
   */
  git(operation: string, details?: string): void {
    this.debug(`[GIT] ${operation}${details ? ': ' + details : ''}`);
  }

  /**
   * 记录统计信息
   */
  stats(operation: string, details?: Record<string, any>): void {
    this.debug(`[STATS] ${operation}`, details);
  }

  /**
   * 销毁日志器
   */
  dispose(): void {
    this.outputChannel.dispose();
  }
}

// 导出便捷函数
export const logger = Logger.getInstance();

/**
 * 快速记录调试日志
 */
export function debug(message: string, ...args: any[]): void {
  logger.debug(message, ...args);
}

/**
 * 快速记录信息日志
 */
export function info(message: string, ...args: any[]): void {
  logger.info(message, ...args);
}

/**
 * 快速记录警告日志
 */
export function warn(message: string, ...args: any[]): void {
  logger.warn(message, ...args);
}

/**
 * 快速记录错误日志
 */
export function error(message: string, err?: Error | any): void {
  logger.error(message, err);
}
