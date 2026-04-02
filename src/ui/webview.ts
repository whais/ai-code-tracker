import * as vscode from 'vscode';
import { MemberStats, TeamStats } from '../types';

export class WebviewManager {
  static showTeamStats(members: MemberStats[], teamStats: TeamStats, totalAIPercentage: number): void {
    const panel = vscode.window.createWebviewPanel(
      'teamStats',
      '团队AI代码统计',
      vscode.ViewColumn.One,
      { enableScripts: true }
    );
    
    const rows = members.map(member => `
      <tr>
        <td>${this.escapeHtml(member.name)}</td>
        <td>${member.totalLines}</td>
        <td>${member.aiLines}</td>
        <td>${member.humanLines}</td>
        <td>
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${member.aiPercentage}%"></div>
          </div>
          ${member.aiPercentage.toFixed(1)}%
        </td>
      </tr>
    `).join('');
    
    panel.webview.html = `<!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 20px; background-color: #1e1e1e; color: #d4d4d4; }
        h1 { color: #4ec9b0; }
        .summary { background: #2d2d30; padding: 15px; border-radius: 8px; margin-bottom: 20px; }
        table { width: 100%; border-collapse: collapse; }
        th, td { text-align: left; padding: 12px; border-bottom: 1px solid #3e3e42; }
        th { background-color: #2d2d30; color: #4ec9b0; }
        .progress-bar { width: 150px; height: 20px; background-color: #3e3e42; border-radius: 10px; overflow: hidden; display: inline-block; margin-right: 10px; }
        .progress-fill { height: 100%; background-color: #4ec9b0; transition: width 0.3s; }
      </style>
    </head>
    <body>
      <h1>🤖 团队AI代码统计报告</h1>
      <div class="summary">
        <h2>📊 总体概览</h2>
        <p>总体AI代码率: <strong style="font-size: 24px; color: #4ec9b0;">${totalAIPercentage.toFixed(1)}%</strong></p>
        <p>总代码行数: ${teamStats.totalLines} 行</p>
        <p>🤖 AI生成: ${teamStats.aiLines} 行 | 👤 人工编写: ${teamStats.humanLines} 行</p>
      </div>
      <h2>👥 成员统计详情</h2>
      <table>
        <thead><tr><th>成员</th><th>总行数</th><th>AI行数</th><th>人工行数</th><th>AI使用率</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </body>
    </html>`;
  }

  static showPersonalStats(member: MemberStats): void {
    const panel = vscode.window.createWebviewPanel(
      'personalStats',
      `${member.name} 的AI代码统计`,
      vscode.ViewColumn.One,
      { enableScripts: true }
    );
    
    // 获取工作区根路径，用于计算相对路径
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
    
    const filesList = Array.from(member.files.values())
      .slice(0, 20)
      .map(file => {
        const fileAI = file.totalLines > 0 ? (file.aiLines / file.totalLines * 100).toFixed(1) : 0;
        // 计算相对路径
        let displayPath = file.filePath;
        if (workspaceRoot && file.filePath.startsWith(workspaceRoot)) {
          displayPath = file.filePath.substring(workspaceRoot.length + 1);
        }
        return `
          <div class="file-item" onclick="vscode.postMessage({ command: 'openFile', path: '${this.escapeHtml(file.filePath)}' })">
            <span class="file-name">📄 ${this.escapeHtml(displayPath)}</span>
            <div class="file-stats">
              <div class="progress-container">
                <div class="progress-fill" style="width: ${fileAI}%"></div>
                <span class="progress-text">${fileAI}% AI</span>
              </div>
              <span class="file-lines">${file.totalLines}行</span>
            </div>
          </div>
        `;
      }).join('');
    
    panel.webview.html = `<!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 20px; background: linear-gradient(135deg, #1e1e1e 0%, #2d2d30 100%); color: #d4d4d4; }
        .header { text-align: center; padding: 20px; background: #2d2d30; border-radius: 12px; margin-bottom: 20px; }
        .stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin-bottom: 30px; }
        .stat-card { background: #2d2d30; padding: 20px; border-radius: 12px; text-align: center; }
        .stat-value { font-size: 2em; font-weight: bold; color: #4ec9b0; }
        .stat-label { color: #888; margin-top: 8px; }
        .progress-container { position: relative; width: 100%; background: #3e3e42; border-radius: 10px; overflow: hidden; height: 30px; }
        .progress-fill { background: linear-gradient(90deg, #4ec9b0, #2ecc71); height: 100%; }
        .progress-text { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); font-size: 0.85em; color: #333; }
        .file-item { background: #2d2d30; padding: 12px; border-radius: 8px; margin-bottom: 10px; cursor: pointer; transition: background 0.2s; }
        .file-item:hover { background: #3e3e42; }
        .file-name { font-weight: bold; display: block; margin-bottom: 8px; font-size: 0.9em; color: #4ec9b0; word-break: break-all; }
        .file-stats { display: flex; align-items: center; gap: 15px; }
        .file-stats .progress-container { flex: 1; }
        .file-lines { color: #888; font-size: 0.9em; }
      </style>
      <script>
        const vscode = acquireVsCodeApi();
        function openFile(path) {
          vscode.postMessage({ command: 'openFile', path: path });
        }
      </script>
    </head>
    <body>
      <div class="header">
        <h1>📊 ${this.escapeHtml(member.name)} 的AI代码统计</h1>
        <p>邮箱: ${this.escapeHtml(member.email)}</p>
      </div>
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-value">${member.totalLines}</div><div class="stat-label">总代码行数</div></div>
        <div class="stat-card"><div class="stat-value">${member.aiLines}</div><div class="stat-label">AI生成代码</div></div>
        <div class="stat-card"><div class="stat-value">${member.aiPercentage.toFixed(1)}%</div><div class="stat-label">AI使用率</div></div>
      </div>
      <h3>📁 文件详情（点击文件可打开）</h3>
      ${filesList}
    </body>
    </html>`;
    
    // 处理 webview 消息
    panel.webview.onDidReceiveMessage(
      message => {
        switch (message.command) {
          case 'openFile':
            const uri = vscode.Uri.file(message.path);
            vscode.window.showTextDocument(uri);
            break;
        }
      },
      undefined,
      []
    );
  }

  private static escapeHtml(text: string): string {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
  }
}

// 导入 path 用于 basename
import * as path from 'path';