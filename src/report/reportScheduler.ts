import * as vscode from 'vscode';

// [AI-GEN] model=detected-ai timestamp=2026-03-30T02:20:51.096Z
export class ReportScheduler {
  private timer: NodeJS.Timeout | undefined;
  private onGenerateReport: () => Promise<void>;

  constructor(onGenerateReport: () => Promise<void>) {
    this.onGenerateReport = onGenerateReport;
    this.start();
  }

  start(): void {
    this.stop();
    
    const config = vscode.workspace.getConfiguration('aiCodeTracker');
    const weeklyConfig = config.get('weeklyReport') as any;
    if (!weeklyConfig?.enabled) return;
    
    this.timer = setInterval(async () => {
      const now = new Date();
      const currentDay = now.getDay();
      const currentHour = now.getHours();
      const currentMinute = now.getMinutes();
      const adjustedDay = currentDay === 0 ? 6 : currentDay - 1;
      
      if (adjustedDay === weeklyConfig.dayOfWeek &&
          currentHour === weeklyConfig.hour &&
          currentMinute === weeklyConfig.minute) {
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