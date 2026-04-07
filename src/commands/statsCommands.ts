import * as vscode from 'vscode';
import * as path from 'path';
import { TeamStatsManager } from '../core/teamStats';
import { WebviewManager } from '../ui/webview';
import { getCurrentGitUser } from '../utils/git';

export class StatsCommands {
  constructor(private statsManager: TeamStatsManager) {}

  async showPersonalStats(): Promise<void> {
    const user = await getCurrentGitUser();
    const member = this.statsManager.getMember(user.email);
    
    if (!member) {
      vscode.window.showInformationMessage('暂无当前用户的代码统计');
      return;
    }
    
    WebviewManager.showPersonalStats(member);
  }

  async showTeamStats(): Promise<void> {
    const stats = this.statsManager.getStats();
    const members = this.statsManager.getSortedMembers();
    const totalAIPercentage = this.statsManager.getTotalAIPercentage();
    
    if (members.length === 0) {
      vscode.window.showInformationMessage('暂无团队代码统计');
      return;
    }
    
    WebviewManager.showTeamStats(members, stats, totalAIPercentage);
  }

  async showStatsInMessage(type: 'personal' | 'team'): Promise<void> {
    if (type === 'team') {
      await this.showTeamStatsMessage();
    } else {
      await this.showPersonalStatsMessage();
    }
  }

  private async showPersonalStatsMessage(): Promise<void> {
    const user = await getCurrentGitUser();
    const member = this.statsManager.getMember(user.email);
    
    if (!member) {
      vscode.window.showInformationMessage('暂无当前用户的代码统计');
      return;
    }
    
    const aiPercentage = member.aiPercentage.toFixed(1);
    
    const message = `📊 ${member.name} 的AI代码统计
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
总代码行数: ${member.totalLines} 行
🤖 AI生成: ${member.aiLines} 行 (${aiPercentage}%)
👤 人工编写: ${member.humanLines} 行
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 AI代码率: ${aiPercentage}%

详细文件列表:
${Array.from(member.files.values()).slice(0, 10).map(file => {
    const fileAI = file.totalLines > 0 ? (file.aiLines / file.totalLines * 100).toFixed(1) : 0;
    return `  📄 ${path.basename(file.filePath)}: ${fileAI}% AI`;
  }).join('\n')}`;
    
    vscode.window.showInformationMessage(message, { modal: true });
  }

  private async showTeamStatsMessage(): Promise<void> {
    const stats = this.statsManager.getStats();
    const members = this.statsManager.getSortedMembers();
    const totalAIPercentage = this.statsManager.getTotalAIPercentage();
    
    const memberList = members.map(member => {
      const bar = this.generateProgressBar(member.aiPercentage);
      return `  ${member.name.padEnd(15)} ${bar} ${member.aiPercentage.toFixed(1)}% (${member.aiLines}/${member.totalLines}行)`;
    }).join('\n');
    
    const message = `👥 团队AI代码统计报告
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📈 总体AI代码率: ${totalAIPercentage.toFixed(1)}%
📊 总代码行数: ${stats.totalLines} 行
🤖 AI生成代码: ${stats.aiLines} 行
👤 人工编写: ${stats.humanLines} 行
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 成员AI使用率排行:
${memberList}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🏆 ${members[0]?.name || '暂无'} ${members[0] ? '是AI使用冠军！' : ''}`;
    
    vscode.window.showInformationMessage(message, { modal: true });
  }

  private generateProgressBar(percentage: number): string {
    const barLength = 20;
    const filled = Math.round(percentage / 100 * barLength);
    const empty = barLength - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
  }
}