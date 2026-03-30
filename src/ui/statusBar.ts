import * as vscode from 'vscode';
import { TeamStatsManager } from '../core/teamStats';
import { getCurrentGitUser } from '../utils/git';

export class StatusBarManager {
  private personalBar: vscode.StatusBarItem;
  private teamBar: vscode.StatusBarItem;
  private statsManager: TeamStatsManager;

  constructor(statsManager: TeamStatsManager) {
    this.statsManager = statsManager;
    this.personalBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.teamBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
    
    this.personalBar.command = 'ai-code-tracker.showStats';
    this.teamBar.command = 'ai-code-tracker.showTeamStats';
    
    this.personalBar.show();
    this.teamBar.show();
    
    statsManager.addListener(() => this.update());
  }

  async update(): Promise<void> {
    const user = await getCurrentGitUser();
    const member = this.statsManager.getMember(user.email);
    
    if (member) {
      this.personalBar.text = `👤 ${member.name}: ${member.aiPercentage.toFixed(0)}%`;
      this.personalBar.tooltip = `${member.name} 的AI使用率: ${member.aiPercentage.toFixed(1)}%`;
    } else {
      this.personalBar.text = `👤 AI: 0%`;
    }
    
    const totalAIPercentage = this.statsManager.getTotalAIPercentage();
    this.teamBar.text = `👥 团队AI: ${totalAIPercentage.toFixed(0)}%`;
    this.teamBar.tooltip = `团队平均AI使用率: ${totalAIPercentage.toFixed(1)}%\n点击查看详细统计`;
  }

  dispose(): void {
    this.personalBar.dispose();
    this.teamBar.dispose();
  }
}