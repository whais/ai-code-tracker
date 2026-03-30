import * as fs from 'fs';
import * as path from 'path';
import { WeeklyReport, TeamReportStats, TrendData } from './reportGenerator';
import { ReportSummary } from '../types';

export class ReportFormatter {
  
  // ==================== 保存报告 ====================
  
  static saveReport(report: WeeklyReport, outputPath: string, format: string): string {
    let content: string;
    let extension: string;
    
    switch (format) {
      case 'html':
        content = this.toHTML(report);
        extension = 'html';
        break;
      case 'markdown':
        content = this.toMarkdown(report);
        extension = 'md';
        break;
      case 'json':
        content = this.toJSON(report);
        extension = 'json';
        break;
      default:
        content = this.toHTML(report);
        extension = 'html';
    }
    
    const filename = `ai-report-${report.weekStart.toISOString().split('T')[0]}.${extension}`;
    const fullPath = path.join(outputPath, filename);
    
    if (!fs.existsSync(outputPath)) {
      fs.mkdirSync(outputPath, { recursive: true });
    }
    
    fs.writeFileSync(fullPath, content, 'utf-8');
    return fullPath;
  }
  
  // ==================== HTML 报告 ====================
  
  static toHTML(report: WeeklyReport): string {
    const weekStartStr = this.formatDate(report.weekStart);
    const weekEndStr = this.formatDate(report.weekEnd);
    
    const teamTableRows = report.teamStats.map(member => this.generateTeamTableRow(member)).join('');
    const trendsChart = this.generateTrendsChart(report.trends);
    const recommendationsHtml = report.recommendations.map(rec => `<li>${this.escapeHtml(rec)}</li>`).join('');
    
    return `<!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>AI代码使用周报 - ${weekStartStr} 至 ${weekEndStr}</title>
      <style>
        ${this.getHTMLStyles()}
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🤖 AI代码使用周报</h1>
          <div class="date">${weekStartStr} - ${weekEndStr}</div>
        </div>
        
        <div class="summary-cards">
          ${this.generateSummaryCards(report.summary)}
        </div>
        
        <div class="section">
          <h2>📊 团队AI使用率排行</h2>
          <table>
            <thead>
              <tr>
                <th>成员</th><th>总行数</th><th>AI行数</th><th>人工行数</th><th>AI使用率</th><th>趋势</th><th>贡献占比</th>
              </tr>
            </thead>
            <tbody>${teamTableRows}</tbody>
          </table>
        </div>
        
        <div class="section">
          <h2>📈 AI使用趋势</h2>
          <div id="trends-chart" style="height: 400px; margin-top: 20px;">${trendsChart}</div>
        </div>
        
        <div class="section">
          <h2>🏆 本周之星</h2>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
            <div>
              <h3>🤖 AI使用达人</h3>
              ${this.generateContributorList(report.topAIContributors, 'ai')}
            </div>
            <div>
              <h3>👤 人工编码达人</h3>
              ${this.generateContributorList(report.topHumanContributors, 'human')}
            </div>
          </div>
        </div>
        
        ${this.generateRecommendationsSection(recommendationsHtml)}
        
        <div class="footer">
          <p>报告生成时间: ${new Date().toLocaleString('zh-CN')}</p>
          <p>由 AI Code Tracker 自动生成 | 数据基于代码分析</p>
        </div>
      </div>
    </body>
    </html>`;
  }
  
  // ==================== Markdown 报告 ====================
  
  static toMarkdown(report: WeeklyReport): string {
    const weekStartStr = this.formatDate(report.weekStart);
    const weekEndStr = this.formatDate(report.weekEnd);
    
    let markdown = `# 🤖 AI代码使用周报\n\n`;
    markdown += `**周期**: ${weekStartStr} - ${weekEndStr}\n\n`;
    markdown += `---\n\n`;
    
    // 汇总
    markdown += `## 📊 总体统计\n\n`;
    markdown += `| 指标 | 数值 |\n`;
    markdown += `|------|------|\n`;
    markdown += `| 总代码行数 | ${report.summary.totalLines.toLocaleString()} |\n`;
    markdown += `| AI生成代码 | ${report.summary.aiLines.toLocaleString()} (${report.summary.aiPercentage.toFixed(1)}%) |\n`;
    markdown += `| 人工编写代码 | ${report.summary.humanLines.toLocaleString()} |\n`;
    markdown += `| 活跃成员数 | ${report.summary.activeMembers} |\n\n`;
    
    // 团队排行
    markdown += `## 👥 团队AI使用率排行\n\n`;
    markdown += `| 成员 | 总行数 | AI行数 | AI使用率 | 趋势 |\n`;
    markdown += `|------|--------|--------|----------|------|\n`;
    for (const member of report.teamStats) {
      const trendIcon = member.trend >= 0 ? '↑' : '↓';
      markdown += `| ${member.name} | ${member.totalLines} | ${member.aiLines} | ${member.aiPercentage.toFixed(1)}% | ${trendIcon} ${Math.abs(member.trend).toFixed(1)}% |\n`;
    }
    markdown += `\n`;
    
    // 趋势图（文本版）
    if (report.trends.length > 0) {
      markdown += `## 📈 AI使用趋势\n\n`;
      markdown += this.generateTextTrendsChart(report.trends);
      markdown += `\n`;
    }
    
    // 本周之星
    markdown += `## 🏆 本周之星\n\n`;
    markdown += `### 🤖 AI使用达人\n`;
    for (const c of report.topAIContributors) {
      markdown += `- **${c.name}**: ${c.aiLines} 行AI代码 (${c.aiPercentage.toFixed(1)}%)\n`;
    }
    markdown += `\n### 👤 人工编码达人\n`;
    for (const c of report.topHumanContributors) {
      markdown += `- **${c.name}**: ${(c.totalLines - c.aiLines)} 行人工代码 (${(100 - c.aiPercentage).toFixed(1)}%)\n`;
    }
    markdown += `\n`;
    
    // 建议
    if (report.recommendations.length > 0) {
      markdown += `## 💡 改进建议\n\n`;
      for (const rec of report.recommendations) {
        markdown += `- ${rec}\n`;
      }
      markdown += `\n`;
    }
    
    markdown += `---\n`;
    markdown += `*报告生成时间: ${new Date().toLocaleString('zh-CN')}*\n`;
    markdown += `*由 AI Code Tracker 自动生成*\n`;
    
    return markdown;
  }
  
  // ==================== JSON 报告 ====================
  
  static toJSON(report: WeeklyReport): string {
    // 转换 Map 为普通对象以便序列化
    const serializable = {
      ...report,
      weekStart: report.weekStart.toISOString(),
      weekEnd: report.weekEnd.toISOString(),
      fileStats: report.fileStats.map(file => ({
        ...file,
        topAuthors: Object.fromEntries(file.topAuthors)
      }))
    };
    return JSON.stringify(serializable, null, 2);
  }
  
  // ==================== 辅助生成方法 ====================
  
  private static generateSummaryCards(summary: ReportSummary): string {
    return `
      <div class="card total">
        <div class="label">总代码行数</div>
        <div class="value">${summary.totalLines.toLocaleString()}</div>
      </div>
      <div class="card ai">
        <div class="label">AI生成代码</div>
        <div class="value">${summary.aiLines.toLocaleString()}</div>
        <div>占比: ${summary.aiPercentage.toFixed(1)}%</div>
      </div>
      <div class="card human">
        <div class="label">人工编写代码</div>
        <div class="value">${summary.humanLines.toLocaleString()}</div>
      </div>
      <div class="card members">
        <div class="label">活跃成员</div>
        <div class="value">${summary.activeMembers}</div>
      </div>
    `;
  }
  
  private static generateTeamTableRow(member: TeamReportStats): string {
    return `
      <tr>
        <td>${this.escapeHtml(member.name)}</td>
        <td>${member.totalLines}</td>
        <td>${member.aiLines}</td>
        <td>${member.humanLines}</td>
        <td>
          <div class="progress-container">
            <div class="progress-bar" style="width: ${member.aiPercentage}%"></div>
            <span class="progress-text">${member.aiPercentage.toFixed(1)}%</span>
          </div>
        </td>
        <td class="${member.trend >= 0 ? 'trend-up' : 'trend-down'}">
          ${member.trend >= 0 ? '↑' : '↓'} ${Math.abs(member.trend).toFixed(1)}%
        </td>
        <td>${member.contribution.toFixed(1)}%</td>
      </tr>
    `;
  }
  
  private static generateTrendsChart(trends: TrendData[]): string {
    if (!trends || trends.length === 0) {
      return '<p>暂无趋势数据</p>';
    }
    
    const maxValue = Math.max(...trends.map(t => t.aiPercentage), 1);
    const bars = trends.map(trend => {
      const height = (trend.aiPercentage / maxValue * 100) || 0;
      return `
        <div style="flex: 1; text-align: center;">
          <div style="height: 150px; display: flex; flex-direction: column-reverse; align-items: center;">
            <div style="height: ${height}%; width: 80%; background: linear-gradient(180deg, #4ec9b0, #2ecc71); border-radius: 4px 4px 0 0;"></div>
          </div>
          <div style="margin-top: 10px; font-size: 0.8em;">${trend.date}</div>
          <div style="font-size: 0.75em; color: #666;">${trend.aiPercentage.toFixed(1)}%</div>
          <div style="font-size: 0.7em; color: #999;">${trend.totalLines}行</div>
        </div>
      `;
    }).join('');
    
    return `<div style="display: flex; align-items: flex-end; gap: 10px; height: 250px;">${bars}</div>`;
  }
  
  private static generateTextTrendsChart(trends: TrendData[]): string {
    const maxWidth = 50;
    const maxValue = Math.max(...trends.map(t => t.aiPercentage), 1);
    
    let chart = '```\n';
    for (const trend of trends) {
      const width = Math.round((trend.aiPercentage / maxValue) * maxWidth);
      const bar = '█'.repeat(width) + '░'.repeat(maxWidth - width);
      chart += `${trend.date.padEnd(12)} |${bar}| ${trend.aiPercentage.toFixed(1)}%\n`;
    }
    chart += '```\n';
    return chart;
  }
  
  private static generateContributorList(contributors: any[], type: 'ai' | 'human'): string {
    if (!contributors.length) {
      return '<p>暂无数据</p>';
    }
    
    return contributors.map(c => {
      const lines = type === 'ai' ? c.aiLines : (c.totalLines - c.aiLines);
      const percentage = type === 'ai' ? c.aiPercentage : (100 - c.aiPercentage);
      return `
        <div style="margin: 10px 0; padding: 10px; background: #f8f9fa; border-radius: 8px;">
          <strong>${this.escapeHtml(c.name)}</strong>: ${lines} 行 (${percentage.toFixed(1)}%)
        </div>
      `;
    }).join('');
  }
  
  private static generateRecommendationsSection(recommendationsHtml: string): string {
    if (!recommendationsHtml) return '';
    return `
      <div class="section">
        <h2>💡 改进建议</h2>
        <div class="recommendations">
          <ul>${recommendationsHtml}</ul>
        </div>
      </div>
    `;
  }
  
  // ==================== HTML 样式 ====================
  
  private static getHTMLStyles(): string {
    return `
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        padding: 20px;
        min-height: 100vh;
      }
      .container {
        max-width: 1200px;
        margin: 0 auto;
        background: white;
        border-radius: 20px;
        box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        overflow: hidden;
      }
      .header {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        padding: 40px;
        text-align: center;
      }
      .header h1 { font-size: 2.5em; margin-bottom: 10px; }
      .header .date { font-size: 1.2em; opacity: 0.9; }
      .summary-cards {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
        gap: 20px;
        padding: 40px;
        background: #f8f9fa;
      }
      .card {
        background: white;
        padding: 25px;
        border-radius: 15px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        text-align: center;
        transition: transform 0.3s;
      }
      .card:hover { transform: translateY(-5px); }
      .card .value { font-size: 2.5em; font-weight: bold; margin: 15px 0; }
      .card.ai .value { color: #4ec9b0; }
      .card.human .value { color: #569cd6; }
      .card.total .value { color: #d4d4d4; }
      .card.members .value { color: #ce9178; }
      .card .label { color: #666; font-size: 0.9em; text-transform: uppercase; letter-spacing: 1px; }
      .section { padding: 30px 40px; border-bottom: 1px solid #e0e0e0; }
      .section h2 { font-size: 1.8em; margin-bottom: 20px; color: #333; display: flex; align-items: center; gap: 10px; }
      table { width: 100%; border-collapse: collapse; }
      th, td { padding: 12px; text-align: left; border-bottom: 1px solid #e0e0e0; }
      th { background: #f8f9fa; font-weight: 600; color: #555; }
      tr:hover { background: #f8f9fa; }
      .progress-container {
        position: relative;
        width: 100%;
        background: #e0e0e0;
        border-radius: 10px;
        overflow: hidden;
        height: 30px;
      }
      .progress-bar {
        background: linear-gradient(90deg, #4ec9b0, #2ecc71);
        height: 100%;
        transition: width 0.3s;
      }
      .progress-text {
        position: absolute;
        right: 10px;
        top: 50%;
        transform: translateY(-50%);
        font-size: 0.85em;
        color: #333;
      }
      .trend-up { color: #2ecc71; }
      .trend-down { color: #e74c3c; }
      .recommendations {
        background: #fff3e0;
        border-left: 4px solid #ff9800;
        padding: 20px;
        margin-top: 20px;
        border-radius: 8px;
      }
      .recommendations ul { margin-left: 20px; margin-top: 10px; }
      .recommendations li { margin: 10px 0; color: #555; }
      .footer {
        background: #f8f9fa;
        padding: 20px;
        text-align: center;
        color: #999;
        font-size: 0.85em;
      }
      @media (max-width: 768px) {
        .summary-cards { grid-template-columns: 1fr; padding: 20px; }
        .section { padding: 20px; }
        table { font-size: 0.85em; }
        th, td { padding: 8px; }
      }
      @media print {
        body { background: white; padding: 0; }
        .card:hover { transform: none; }
      }
    `;
  }
  
  // ==================== 工具方法 ====================
  
  private static formatDate(date: Date): string {
    return date.toLocaleDateString('zh-CN');
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
  
  // 生成进度条字符串（用于控制台）
  static generateProgressBar(percentage: number, length: number = 20): string {
    const filled = Math.round(percentage / 100 * length);
    const empty = length - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
  }
}