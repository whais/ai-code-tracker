import * as vscode from 'vscode';
import { TeamStats, MemberStats } from '../types';

export class TeamStatsManager {
  private stats: TeamStats;
  private listeners: (() => void)[] = [];

  constructor() {
    this.stats = {
      totalLines: 0,
      aiLines: 0,
      humanLines: 0,
      modifiedAILines: 0,
      members: new Map()
    };
  }

  getStats(): TeamStats {
    return this.stats;
  }

  getMember(email: string): MemberStats | undefined {
    return this.stats.members.get(email);
  }

  addListener(listener: () => void): void {
    this.listeners.push(listener);
  }

  private notifyListeners(): void {
    this.listeners.forEach(listener => listener());
  }

  updateStats(updater: (stats: TeamStats) => void): void {
    updater(this.stats);
    this.notifyListeners();
  }

  getTotalAIPercentage(): number {
    return this.stats.totalLines > 0 
      ? (this.stats.aiLines / this.stats.totalLines * 100) 
      : 0;
  }

  getSortedMembers(): MemberStats[] {
    return Array.from(this.stats.members.values())
      .sort((a, b) => b.aiPercentage - a.aiPercentage);
  }

  clear(): void {
    this.stats = {
      totalLines: 0,
      aiLines: 0,
      humanLines: 0,
      modifiedAILines: 0,
      members: new Map()
    };
    this.notifyListeners();
  }
}