import * as vscode from 'vscode';
import { StatsCommands } from './statsCommands';
import { MarkCommands } from './markCommands';
import { ReportCommands } from './reportCommands';
import { SettingsCommands } from './settingsCommands';

/**
 * 命令对象容器接口
 * 使用容器模式解决闭包问题 - 命令对象可以动态更新
 */
export interface CommandsContainer {
  statsCommands?: StatsCommands;
  markCommands?: MarkCommands;
  reportCommands?: ReportCommands;
  settingsCommands: SettingsCommands;
}

/**
 * 检查统计是否已启用的辅助函数
 */
function checkStatsEnabled(): boolean {
  const config = vscode.workspace.getConfiguration('aiCodeTracker');
  return config.get<boolean>('enabled', false);
}

/**
 * 显示需要启用统计的提示
 */
function showEnableStatsMessage(): void {
  vscode.window.showWarningMessage('📊 请先启用 AI 代码统计（点击左侧活动栏的开关按钮）');
}

/**
 * 注册所有命令
 * 使用容器模式，命令对象可以通过容器动态更新
 */
export function registerCommands(container: CommandsContainer): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('ai-code-tracker.showStats', () => {
      if (!checkStatsEnabled()) {
        showEnableStatsMessage();
        return;
      }
      if (!container.statsCommands) {
        vscode.window.showWarningMessage('统计功能正在初始化，请稍后再试');
        return;
      }
      container.statsCommands.showPersonalStats();
    }),
    vscode.commands.registerCommand('ai-code-tracker.showTeamStats', () => {
      if (!checkStatsEnabled()) {
        showEnableStatsMessage();
        return;
      }
      if (!container.statsCommands) {
        vscode.window.showWarningMessage('统计功能正在初始化，请稍后再试');
        return;
      }
      container.statsCommands.showTeamStats();
    }),
    vscode.commands.registerCommand('ai-code-tracker.markAsAI', () => {
      if (!checkStatsEnabled()) {
        showEnableStatsMessage();
        return;
      }
      if (!container.markCommands) {
        vscode.window.showWarningMessage('统计功能正在初始化，请稍后再试');
        return;
      }
      container.markCommands.markAsAI();
    }),
    vscode.commands.registerCommand('ai-code-tracker.markAsHuman', () => {
      if (!checkStatsEnabled()) {
        showEnableStatsMessage();
        return;
      }
      if (!container.markCommands) {
        vscode.window.showWarningMessage('统计功能正在初始化，请稍后再试');
        return;
      }
      container.markCommands.markAsHuman();
    }),
    vscode.commands.registerCommand('ai-code-tracker.analyzeGitBlame', () => {
      if (!checkStatsEnabled()) {
        showEnableStatsMessage();
        return;
      }
      if (!container.markCommands) {
        vscode.window.showWarningMessage('统计功能正在初始化，请稍后再试');
        return;
      }
      container.markCommands.analyzeGitHistory();
    }),
    vscode.commands.registerCommand('ai-code-tracker.generateWeeklyReport', () => {
      if (!checkStatsEnabled()) {
        showEnableStatsMessage();
        return;
      }
      if (!container.reportCommands) {
        vscode.window.showWarningMessage('统计功能正在初始化，请稍后再试');
        return;
      }
      container.reportCommands.generateAndShowReport();
    }),
    vscode.commands.registerCommand('ai-code-tracker.autoReportSettings', () => {
      if (!checkStatsEnabled()) {
        showEnableStatsMessage();
        return;
      }
      if (!container.reportCommands) {
        vscode.window.showWarningMessage('统计功能正在初始化，请稍后再试');
        return;
      }
      container.reportCommands.configureAutoReport();
    }),
    vscode.commands.registerCommand('ai-code-tracker.smartPaste', () => {
      if (!checkStatsEnabled()) {
        showEnableStatsMessage();
        return;
      }
      if (!container.markCommands) {
        vscode.window.showWarningMessage('统计功能正在初始化，请稍后再试');
        return;
      }
      container.markCommands.smartPaste();
    }),
    vscode.commands.registerCommand('ai-code-tracker.configureAIMarks', () => {
      // 这个命令不需要启用统计，settingsCommands 总是存在的
      container.settingsCommands.configureAIMarks();
    })
  ];
}
