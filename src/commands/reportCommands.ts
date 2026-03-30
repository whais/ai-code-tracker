import * as vscode from 'vscode';
import * as path from 'path';
import { ReportGenerator, WeeklyReport } from '../report/reportGenerator';
import { ReportFormatter } from '../report/reportFormatter';
import { ReportScheduler } from '../report/reportScheduler';
import { TeamStatsManager } from '../core/teamStats';
import { StatsCommands } from './statsCommands';

export class ReportCommands {
  private reportScheduler: ReportScheduler;
  private reportGenerator: ReportGenerator;

  constructor(
    private statsManager: TeamStatsManager,
    private statsCommands: StatsCommands,
    context?: vscode.ExtensionContext
  ) {
    this.reportGenerator = new ReportGenerator(statsManager, context);
    this.reportScheduler = new ReportScheduler(() => this.generateAndSaveReport());
  }

  async generateAndShowReport(useGit: boolean = true): Promise<void> {
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: "正在生成周报...",
      cancellable: false
    }, async (progress) => {
      progress.report({ increment: 0, message: "收集数据..." });
      
      let report: WeeklyReport;
      if (useGit && vscode.workspace.workspaceFolders) {
        report = await this.reportGenerator.generateWeeklyReportFromGit();
      } else {
        report = await this.reportGenerator.generateWeeklyReportFromStats();
      }
      
      progress.report({ increment: 50, message: "生成报告..." });
      
      const config = vscode.workspace.getConfiguration('aiCodeTracker');
      const weeklyConfig = config.get('weeklyReport') as any || {};
      const outputPath = path.join(
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '',
        weeklyConfig.outputPath || 'ai-reports'
      );
      const format = weeklyConfig.format || 'html';
      const reportPath = ReportFormatter.saveReport(report, outputPath, format);
      
      progress.report({ increment: 100, message: "完成" });
      
      const open = await vscode.window.showInformationMessage(
        `周报已生成: ${reportPath}`,
        '打开报告',
        '查看统计'
      );
      
      if (open === '打开报告') {
        vscode.commands.executeCommand('vscode.open', vscode.Uri.file(reportPath));
      } else if (open === '查看统计') {
        this.statsCommands.showTeamStats();
      }
    });
  }

  async configureAutoReport(): Promise<void> {
    const config = vscode.workspace.getConfiguration('aiCodeTracker');
    const current = config.get('weeklyReport') as any || {};
    
    const enabled = await vscode.window.showQuickPick(['启用', '禁用'], {
      placeHolder: `当前状态: ${current.enabled ? '已启用' : '已禁用'}`
    });
    
    if (enabled === '启用') {
      const dayOfWeek = await vscode.window.showQuickPick(
        ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],
        { placeHolder: '选择报告生成日期' }
      );
      
      const hour = await vscode.window.showInputBox({
        prompt: '设置生成时间（小时，0-23）',
        value: '17',
        validateInput: (value) => {
          const num = parseInt(value);
          return isNaN(num) || num < 0 || num > 23 ? '请输入0-23之间的数字' : null;
        }
      });
      
      const format = await vscode.window.showQuickPick(
        ['html', 'markdown', 'json'],
        { placeHolder: '选择报告格式' }
      );
      
      const dataSource = await vscode.window.showQuickPick(
        ['Git历史（更准确）', '本地统计（更快）'],
        { placeHolder: '选择数据源' }
      );
      
      const newConfig = {
        ...current,
        enabled: true,
        dayOfWeek: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'].indexOf(dayOfWeek || '周五'),
        hour: parseInt(hour || '17'),
        minute: 0,
        format: format || 'html',
        outputPath: current.outputPath || 'ai-reports',
        useGit: dataSource === 'Git历史（更准确）',
        autoSend: false,
        emailRecipients: current.emailRecipients || []
      };
      
      await config.update('weeklyReport', newConfig, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage('✅ 自动周报已配置');
      this.reportScheduler.start();
    } else if (enabled === '禁用') {
      await config.update('weeklyReport', { ...current, enabled: false }, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage('⏸️ 自动周报已禁用');
      this.reportScheduler.stop();
    }
  }

  private async generateAndSaveReport(): Promise<void> {
    const config = vscode.workspace.getConfiguration('aiCodeTracker');
    const weeklyConfig = config.get('weeklyReport') as any;
    
    let report: WeeklyReport;
    if (weeklyConfig?.useGit && vscode.workspace.workspaceFolders) {
      report = await this.reportGenerator.generateWeeklyReportFromGit();
    } else {
      report = await this.reportGenerator.generateWeeklyReportFromStats();
    }
    
    const outputPath = path.join(
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '',
      weeklyConfig?.outputPath || 'ai-reports'
    );
    const format = weeklyConfig?.format || 'html';
    const reportPath = ReportFormatter.saveReport(report, outputPath, format);
    
    vscode.window.showInformationMessage(`📊 自动周报已生成: ${reportPath}`);
  }
}