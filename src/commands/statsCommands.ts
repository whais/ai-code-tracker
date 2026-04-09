import * as vscode from 'vscode';
import * as path from 'path';
import { TeamStatsManager } from '../core/teamStats';
import { LineTracker } from '../core/lineTracker';
import { WebviewManager } from '../ui/webview';
import { getCurrentGitUser } from '../utils/git';
import { getWorkspaceRoot } from '../utils/workspace';
import { MemberStats, FileStats } from '../types';

export class StatsCommands {
  constructor(private statsManager: TeamStatsManager) {}

  async showPersonalStats(): Promise<void> {
    const user = await getCurrentGitUser();
    const member = this.statsManager.getMember(user.email);
    
    // 整合 LineTracker 的实时数据（包含无感统计和自动打标）
    const integratedMember = await this.integrateLineTrackerData(user.email, member);
    
    if (!integratedMember) {
      vscode.window.showInformationMessage('暂无当前用户的代码统计');
      return;
    }
    
    WebviewManager.showPersonalStats(integratedMember);
  }

  /**
   * 整合 LineTracker 的实时追踪数据到 MemberStats
   * 确保无感统计和自动打标的代码被包含在报告中
   */
  private async integrateLineTrackerData(
    email: string, 
    gitMember: MemberStats | undefined
  ): Promise<MemberStats | null> {
    const lineTracker = LineTracker.getInstance();
    const workspaceRoot = getWorkspaceRoot();
    
    // 获取当前用户信息（用于处理 "Not Committed Yet"）
    const currentUser = await getCurrentGitUser();
    
    // 处理 "Not Committed Yet" 的邮箱
    let targetEmail = email;
    if (!email || email === '' || email === 'Not Committed Yet') {
      targetEmail = currentUser.email;
    }
    
    // 从 LineTracker 获取当前工作区的实时统计
    const trackerStats = lineTracker.getStatsByUser(workspaceRoot || undefined);
    
    // 获取目标邮箱的 tracker 数据，同时检查 "Not Committed Yet" 的数据
    let trackerData = trackerStats.get(targetEmail);
    const notCommittedData = trackerStats.get('') || trackerStats.get('Not Committed Yet');
    
    // 如果有 "Not Committed Yet" 的数据，合并到当前用户
    if (notCommittedData && targetEmail === currentUser.email) {
      if (!trackerData) {
        trackerData = { ...notCommittedData };
      } else {
        trackerData.aiLines += notCommittedData.aiLines;
        trackerData.humanLines += notCommittedData.humanLines;
        trackerData.totalLines += notCommittedData.totalLines;
      }
    }
    
    // 如果没有 Git 数据也没有 Tracker 数据，返回 null
    if (!gitMember && !trackerData) {
      return null;
    }

    const displayName = gitMember?.name || currentUser.name || targetEmail.split('@')[0];
    
    // 创建基础 MemberStats
    const integrated: MemberStats = {
      name: displayName,
      email: targetEmail,
      totalLines: gitMember?.totalLines || 0,
      aiLines: gitMember?.aiLines || 0,
      humanLines: gitMember?.humanLines || 0,
      modifiedAILines: gitMember?.modifiedAILines || 0,
      aiPercentage: 0,
      files: new Map(gitMember?.files || []) // 复制 Git 分析的文件数据
    };

    // 如果有 LineTracker 数据，进行整合
    if (trackerData) {
      // 更新总体统计（取 Git 和 Tracker 的最大值，避免重复计算）
      integrated.aiLines = Math.max(integrated.aiLines, trackerData.aiLines);
      integrated.humanLines = Math.max(integrated.humanLines, trackerData.humanLines);
      integrated.totalLines = Math.max(integrated.totalLines, trackerData.totalLines);
      
      // 从 LineTracker 获取文件级别的统计
      const fileMaps = (lineTracker as any).fileMaps as Map<string, any>;
      if (fileMaps && workspaceRoot) {
        for (const [filePath, lineMap] of fileMaps) {
          // 只处理当前工作区的文件
          if (!filePath.startsWith(workspaceRoot)) continue;
          
          let fileAiLines = 0;
          let fileHumanLines = 0;
          let fileTotalLines = 0;
          
          // 统计该文件的 AI/Human 行数（包括目标用户和 "Not Committed Yet"）
          for (const [lineNum, lineInfo] of Object.entries(lineMap)) {
            const info = lineInfo as any;
            if (info.status === 'deleted') continue;
            
            // 检查是否是目标用户或 "Not Committed Yet"（如果是当前用户查询）
            const isTargetUser = info.author === targetEmail;
            const isNotCommitted = !info.author || info.author === '' || info.author === 'Not Committed Yet';
            
            if (!isTargetUser && !(isNotCommitted && targetEmail === currentUser.email)) {
              continue;
            }
            
            fileTotalLines++;
            if (info.source === 'ai') {
              fileAiLines++;
            } else if (info.source === 'human') {
              fileHumanLines++;
            }
          }
          
          // 如果该文件有当前用户的代码
          if (fileTotalLines > 0) {
            const existingFile = integrated.files.get(filePath);
            if (existingFile) {
              // 合并数据（取最大值）
              existingFile.aiLines = Math.max(existingFile.aiLines, fileAiLines);
              existingFile.humanLines = Math.max(existingFile.humanLines, fileHumanLines);
              existingFile.totalLines = Math.max(existingFile.totalLines, fileTotalLines);
            } else {
              // 添加新文件记录
              integrated.files.set(filePath, {
                filePath,
                totalLines: fileTotalLines,
                aiLines: fileAiLines,
                humanLines: fileHumanLines,
                modifiedAILines: 0,
                authorLines: new Map([[displayName, fileTotalLines]])
              });
            }
          }
        }
      }
    }

    // 重新计算 AI 百分比
    integrated.aiPercentage = integrated.totalLines > 0 
      ? (integrated.aiLines / integrated.totalLines * 100) 
      : 0;

    return integrated;
  }

  async showTeamStats(): Promise<void> {
    // 整合 LineTracker 数据到团队统计
    const integratedStats = await this.integrateAllMembersWithLineTracker();
    const members = Array.from(integratedStats.members.values())
      .sort((a, b) => b.aiPercentage - a.aiPercentage);
    const totalAIPercentage = integratedStats.totalLines > 0 
      ? (integratedStats.aiLines / integratedStats.totalLines * 100) 
      : 0;
    
    if (members.length === 0) {
      vscode.window.showInformationMessage('暂无团队代码统计');
      return;
    }
    
    WebviewManager.showTeamStats(members, integratedStats, totalAIPercentage);
  }

  /**
   * 整合所有成员的 LineTracker 数据
   */
  private async integrateAllMembersWithLineTracker(): Promise<import('../types').TeamStats> {
    const lineTracker = LineTracker.getInstance();
    const workspaceRoot = getWorkspaceRoot();
    const baseStats = this.statsManager.getStats();
    
    // 获取当前用户信息（用于处理 "Not Committed Yet"）
    const currentUser = await getCurrentGitUser();
    
    // 创建新的统计对象
    const integrated: import('../types').TeamStats = {
      totalLines: baseStats.totalLines,
      aiLines: baseStats.aiLines,
      humanLines: baseStats.humanLines,
      modifiedAILines: baseStats.modifiedAILines,
      members: new Map(baseStats.members)
    };
    
    // 处理 baseStats 中可能存在的 "Not Committed Yet" 数据
    for (const [email, member] of integrated.members) {
      if (!email || email === '' || email === 'Not Committed Yet' || member.name === 'Not Committed Yet') {
        // 将 "Not Committed Yet" 的数据合并到当前用户
        const currentUserMember = integrated.members.get(currentUser.email);
        if (currentUserMember) {
          currentUserMember.aiLines += member.aiLines;
          currentUserMember.humanLines += member.humanLines;
          currentUserMember.totalLines += member.totalLines;
        } else {
          // 当前用户还不存在，重命名这个成员
          integrated.members.delete(email);
          integrated.members.set(currentUser.email, {
            ...member,
            name: currentUser.name,
            email: currentUser.email
          });
          continue;
        }
        // 删除 "Not Committed Yet" 成员
        integrated.members.delete(email);
      }
    }

    // 从 LineTracker 获取所有用户的统计
    const trackerStats = lineTracker.getStatsByUser(workspaceRoot || undefined);
    
    for (const [email, trackerData] of trackerStats) {
      // 处理 "Not Committed Yet" 和空邮箱的情况
      let normalizedEmail = email;
      let normalizedName = trackerData.name;
      
      if (!email || email === '' || email === 'Not Committed Yet' || trackerData.name === 'Not Committed Yet') {
        normalizedEmail = currentUser.email;
        normalizedName = currentUser.name;
      }
      
      const existingMember = integrated.members.get(normalizedEmail);
      
      if (existingMember) {
        // 更新现有成员数据
        existingMember.aiLines = Math.max(existingMember.aiLines, trackerData.aiLines);
        existingMember.humanLines = Math.max(existingMember.humanLines, trackerData.humanLines);
        existingMember.totalLines = Math.max(existingMember.totalLines, trackerData.totalLines);
        existingMember.aiPercentage = existingMember.totalLines > 0 
          ? (existingMember.aiLines / existingMember.totalLines * 100) 
          : 0;
      } else {
        // 添加新成员（只有 LineTracker 数据的）
        integrated.members.set(normalizedEmail, {
          name: normalizedName,
          email: normalizedEmail,
          totalLines: trackerData.totalLines,
          aiLines: trackerData.aiLines,
          humanLines: trackerData.humanLines,
          modifiedAILines: 0,
          aiPercentage: trackerData.totalLines > 0 
            ? (trackerData.aiLines / trackerData.totalLines * 100) 
            : 0,
          files: new Map()
        });
      }
    }

    // 重新计算总计
    integrated.totalLines = 0;
    integrated.aiLines = 0;
    integrated.humanLines = 0;
    
    for (const member of integrated.members.values()) {
      integrated.totalLines += member.totalLines;
      integrated.aiLines += member.aiLines;
      integrated.humanLines += member.humanLines;
    }

    return integrated;
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
    
    // 整合 LineTracker 数据
    const integratedMember = await this.integrateLineTrackerData(user.email, member);
    
    if (!integratedMember) {
      vscode.window.showInformationMessage('暂无当前用户的代码统计');
      return;
    }
    
    const aiPercentage = integratedMember.aiPercentage.toFixed(1);
    
    const message = `📊 ${integratedMember.name} 的AI代码统计
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
总代码行数: ${integratedMember.totalLines} 行
🤖 AI生成: ${integratedMember.aiLines} 行 (${aiPercentage}%)
👤 人工编写: ${integratedMember.humanLines} 行
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 AI代码率: ${aiPercentage}%

详细文件列表:
${Array.from(integratedMember.files.values()).slice(0, 10).map(file => {
    const fileAI = file.totalLines > 0 ? (file.aiLines / file.totalLines * 100).toFixed(1) : 0;
    return `  📄 ${path.basename(file.filePath)}: ${fileAI}% AI`;
  }).join('\n')}`;
    
    vscode.window.showInformationMessage(message, { modal: true });
  }

  private async showTeamStatsMessage(): Promise<void> {
    // 整合 LineTracker 数据
    const integratedStats = await this.integrateAllMembersWithLineTracker();
    const members = Array.from(integratedStats.members.values())
      .sort((a, b) => b.aiPercentage - a.aiPercentage);
    const totalAIPercentage = integratedStats.totalLines > 0 
      ? (integratedStats.aiLines / integratedStats.totalLines * 100) 
      : 0;
    
    const memberList = members.map(member => {
      const bar = this.generateProgressBar(member.aiPercentage);
      return `  ${member.name.padEnd(15)} ${bar} ${member.aiPercentage.toFixed(1)}% (${member.aiLines}/${member.totalLines}行)`;
    }).join('\n');
    
    const message = `👥 团队AI代码统计报告
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📈 总体AI代码率: ${totalAIPercentage.toFixed(1)}%
📊 总代码行数: ${integratedStats.totalLines} 行
🤖 AI生成代码: ${integratedStats.aiLines} 行
👤 人工编写: ${integratedStats.humanLines} 行
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