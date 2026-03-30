import * as vscode from 'vscode';
import { StatsCommands } from './statsCommands';
import { MarkCommands } from './markCommands';
import { ReportCommands } from './reportCommands';
import { SettingsCommands } from './settingsCommands';

export function registerCommands(
  statsCommands: StatsCommands,
  markCommands: MarkCommands,
  reportCommands: ReportCommands,
  settingsCommands: SettingsCommands
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('ai-code-tracker.showStats', () => statsCommands.showPersonalStats()),
    vscode.commands.registerCommand('ai-code-tracker.showTeamStats', () => statsCommands.showTeamStats()),
    vscode.commands.registerCommand('ai-code-tracker.markAsAI', () => markCommands.markAsAI()),
    vscode.commands.registerCommand('ai-code-tracker.markAsHuman', () => markCommands.markAsHuman()),
    vscode.commands.registerCommand('ai-code-tracker.analyzeGitBlame', () => markCommands.analyzeGitHistory()),
    vscode.commands.registerCommand('ai-code-tracker.generateWeeklyReport', () => reportCommands.generateAndShowReport()),
    vscode.commands.registerCommand('ai-code-tracker.autoReportSettings', () => reportCommands.configureAutoReport()),
    vscode.commands.registerCommand('ai-code-tracker.smartPaste', () => markCommands.smartPaste()),
    vscode.commands.registerCommand('ai-code-tracker.configureAIMarks', () => settingsCommands.configureAIMarks())
  ];
}