import * as vscode from 'vscode';
import { MemberStats, TeamStats } from '../types';

export class UIMessageFormatter {
  /**
   * 生成进度条字符串
   * @param percentage 百分比 (0-100)
   * @param length 进度条长度
   * @returns 进度条字符串
   */
  static generateProgressBar(percentage: number, length: number = 20): string {
    const filled = Math.round(percentage / 100 * length);
    const empty = length - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
  }

  /**
   * 格式化个人统计消息
   */
  static formatPersonalStats(member: MemberStats): string {
    const aiPercentage = member.aiPercentage.toFixed(1);
    
    const filesList = Array.from(member.files.values())
      .slice(0, 10)
      .map(file => {
        const fileAI = file.totalLines > 0 ? (file.aiLines / file.totalLines * 100).toFixed(1) : 0;
        const fileName = file.filePath.split('/').pop() || file.filePath;
        return `  📄 ${fileName}: ${fileAI}% AI (${file.aiLines}/${file.totalLines}行)`;
      })
      .join('\n');
    
    return `📊 ${member.name} 的AI代码统计
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
总代码行数: ${member.totalLines} 行
🤖 AI生成: ${member.aiLines} 行 (${aiPercentage}%)
👤 人工编写: ${member.humanLines} 行
✏️ 修改的AI代码: ${member.modifiedAILines} 行
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 AI代码率: ${aiPercentage}%

📁 文件详情 (前10个):
${filesList || '  暂无文件数据'}

${this.generateProgressBar(member.aiPercentage)} ${aiPercentage}%`;
  }

  /**
   * 格式化团队统计消息
   */
  static formatTeamStats(stats: TeamStats, members: MemberStats[]): string {
    const totalAIPercentage = stats.totalLines > 0 
      ? (stats.aiLines / stats.totalLines * 100).toFixed(1) 
      : '0';
    
    const memberList = members.map(member => {
      const bar = this.generateProgressBar(member.aiPercentage);
      return `  ${member.name.padEnd(15)} ${bar} ${member.aiPercentage.toFixed(1)}% (${member.aiLines}/${member.totalLines}行)`;
    }).join('\n');
    
    const topContributor = members[0];
    const bottomContributor = members[members.length - 1];
    
    return `👥 团队AI代码统计报告
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📈 总体AI代码率: ${totalAIPercentage}%
📊 总代码行数: ${stats.totalLines} 行
🤖 AI生成代码: ${stats.aiLines} 行
👤 人工编写: ${stats.humanLines} 行
✏️ 修改的AI代码: ${stats.modifiedAILines} 行
👥 活跃成员数: ${members.length}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 成员AI使用率排行:
${memberList}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🏆 AI使用冠军: ${topContributor?.name || '暂无'} ${topContributor ? `(${topContributor.aiPercentage.toFixed(1)}%)` : ''}
📉 AI使用最低: ${bottomContributor?.name || '暂无'} ${bottomContributor ? `(${bottomContributor.aiPercentage.toFixed(1)}%)` : ''}

${this.generateRecommendation(stats, members)}`;
  }

  /**
   * 生成改进建议
   */
  static generateRecommendation(stats: TeamStats, members: MemberStats[]): string {
    const totalAIPercentage = stats.totalLines > 0 ? (stats.aiLines / stats.totalLines * 100) : 0;
    
    if (totalAIPercentage > 80) {
      return '💡 建议: 团队AI使用率较高，请确保AI生成的代码经过充分审查';
    } else if (totalAIPercentage < 20 && stats.totalLines > 1000) {
      return '💡 建议: AI使用率较低，可以考虑使用AI辅助编程提高效率';
    } else if (members.length === 1 && stats.totalLines > 500) {
      return '💡 建议: 当前为单人项目，建议增加团队协作和代码审查';
    } else {
      return '🎉 团队AI使用情况良好，继续保持！';
    }
  }

  /**
   * 格式化文件统计
   */
  static formatFileStats(filePath: string, aiLines: number, totalLines: number, topAuthors: Map<string, number>): string {
    const aiPercentage = totalLines > 0 ? (aiLines / totalLines * 100).toFixed(1) : '0';
    const fileName = filePath.split('/').pop() || filePath;
    
    const authorsList = Array.from(topAuthors.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([author, lines]) => `    ${author}: ${lines} 行`)
      .join('\n');
    
    return `📄 ${fileName}
    AI代码率: ${aiPercentage}% (${aiLines}/${totalLines}行)
    主要贡献者:
${authorsList}`;
  }

  /**
   * 格式化周报摘要
   */
  static formatReportSummary(
    weekStart: Date,
    weekEnd: Date,
    totalLines: number,
    aiLines: number,
    activeMembers: number
  ): string {
    const aiPercentage = totalLines > 0 ? (aiLines / totalLines * 100).toFixed(1) : '0';
    const weekStartStr = weekStart.toLocaleDateString('zh-CN');
    const weekEndStr = weekEnd.toLocaleDateString('zh-CN');
    
    return `📊 周报摘要 (${weekStartStr} - ${weekEndStr})
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
总代码行数: ${totalLines} 行
AI生成代码: ${aiLines} 行 (${aiPercentage}%)
活跃成员数: ${activeMembers} 人
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
  }

  /**
   * 格式化时间
   */
  static formatDate(date: Date, format: 'full' | 'date' | 'time' = 'full'): string {
    switch (format) {
      case 'date':
        return date.toLocaleDateString('zh-CN');
      case 'time':
        return date.toLocaleTimeString('zh-CN');
      default:
        return date.toLocaleString('zh-CN');
    }
  }

  /**
   * 格式化文件大小
   */
  static formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  /**
   * 格式化时长（毫秒转可读字符串）
   */
  static formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days}天${hours % 24}小时`;
    if (hours > 0) return `${hours}小时${minutes % 60}分钟`;
    if (minutes > 0) return `${minutes}分钟${seconds % 60}秒`;
    return `${seconds}秒`;
  }
}