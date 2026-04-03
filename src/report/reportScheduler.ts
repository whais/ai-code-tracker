import * as vscode from 'vscode';

// [AI-GEN] model=detected-ai timestamp=2026-03-30T02:20:51.096Z
export class ReportScheduler {
  private timer: NodeJS.Timeout | undefined;
  private onGenerateReport: () => Promise<void>;
  private lastExecutedDate: string | null = null; // 记录上次执行日期，避免重复执行

  constructor(onGenerateReport: () => Promise<void>) {
    this.onGenerateReport = onGenerateReport;
    this.start();
  }

  start(): void {
    this.stop();
    
    const config = vscode.workspace.getConfiguration('aiCodeTracker');
    const weeklyConfig = config.get('weeklyReport') as any;
    if (!weeklyConfig?.enabled) return;
    
    // 计算到下一个检查点的延迟，然后每分钟检查一次
    const calculateNextCheck = () => {
      const now = new Date();
      const currentDay = now.getDay();
      const currentHour = now.getHours();
      const currentMinute = now.getMinutes();
      const adjustedDay = currentDay === 0 ? 6 : currentDay - 1;
      
      // 检查是否到达执行时间（使用日期字符串避免同一分钟重复执行）
      const todayStr = now.toISOString().split('T')[0];
      if (adjustedDay === weeklyConfig.dayOfWeek &&
          currentHour === weeklyConfig.hour &&
          currentMinute === weeklyConfig.minute &&
          this.lastExecutedDate !== todayStr) {
        this.lastExecutedDate = todayStr;
        return true;
      }
      return false;
    };
    
    this.timer = setInterval(async () => {
      if (calculateNextCheck()) {
        await this.onGenerateReport();
      }
    }, 60 * 1000);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  dispose(): void {
    this.stop();
  }
}