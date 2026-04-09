import * as vscode from 'vscode';
import { getWorkspaceRoot } from '../utils/workspace';

/**
 * 侧边栏树视图提供器
 * 显示 AI Code Tracker 的控制面板
 */
export class SidebarProvider implements vscode.TreeDataProvider<SidebarItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<SidebarItem | undefined | null | void> = new vscode.EventEmitter<SidebarItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<SidebarItem | undefined | null | void> = this._onDidChangeTreeData.event;

  constructor(private context: vscode.ExtensionContext) {
    // 监听配置变化
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('aiCodeTracker.enabled')) {
        this.refresh();
      }
    });
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: SidebarItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: SidebarItem): Thenable<SidebarItem[]> {
    if (!element) {
      // 根级别项
      return Promise.resolve(this.getRootItems());
    }
    return Promise.resolve([]);
  }

  private getRootItems(): SidebarItem[] {
    const workspaceRoot = getWorkspaceRoot();
    if (!workspaceRoot) {
      return [
        new SidebarItem(
          '未打开工作区',
          '请打开一个项目文件夹',
          vscode.TreeItemCollapsibleState.None,
          'warning'
        )
      ];
    }

    const config = vscode.workspace.getConfiguration('aiCodeTracker');
    const enabled = config.get<boolean>('enabled', false);
    const workspaceName = workspaceRoot.split('/').pop() || workspaceRoot;

    const items: SidebarItem[] = [];

    // 当前工作区信息
    items.push(new SidebarItem(
      `项目: ${workspaceName}`,
      workspaceRoot,
      vscode.TreeItemCollapsibleState.None,
      'workspace',
      undefined,
      undefined,
      false
    ));

    // 开关按钮
    items.push(new SidebarItem(
      enabled ? '🔵 统计已启用' : '⚪ 统计已禁用',
      enabled ? '点击禁用 AI 代码统计' : '点击启用 AI 代码统计',
      vscode.TreeItemCollapsibleState.None,
      enabled ? 'enabled' : 'disabled',
      {
        command: 'ai-code-tracker.toggleEnabled',
        title: '切换统计开关',
        arguments: []
      }
    ));

    // 如果启用了统计，显示更多选项
    if (enabled) {
      items.push(new SidebarItem(
        '📊 查看个人统计',
        '显示当前用户的 AI 代码统计',
        vscode.TreeItemCollapsibleState.None,
        'stats',
        {
          command: 'ai-code-tracker.showStats',
          title: '显示个人统计',
          arguments: []
        }
      ));

      items.push(new SidebarItem(
        '👥 查看团队统计',
        '显示团队的 AI 代码统计',
        vscode.TreeItemCollapsibleState.None,
        'team',
        {
          command: 'ai-code-tracker.showTeamStats',
          title: '显示团队统计',
          arguments: []
        }
      ));

      items.push(new SidebarItem(
        '📈 分析 Git 历史',
        '分析项目的 Git 历史统计',
        vscode.TreeItemCollapsibleState.None,
        'git',
        {
          command: 'ai-code-tracker.analyzeGitBlame',
          title: '分析 Git 历史',
          arguments: []
        }
      ));

      items.push(new SidebarItem(
        '📄 生成周报',
        '生成团队 AI 代码周报',
        vscode.TreeItemCollapsibleState.None,
        'report',
        {
          command: 'ai-code-tracker.generateWeeklyReport',
          title: '生成周报',
          arguments: []
        }
      ));
    } else {
      // 未启用时显示提示
      items.push(new SidebarItem(
        '💡 提示',
        '启用统计后开始追踪 AI 代码',
        vscode.TreeItemCollapsibleState.None,
        'info',
        undefined,
        undefined,
        false
      ));
    }

    return items;
  }
}

/**
 * 侧边栏项目
 */
export class SidebarItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly tooltip: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly contextValue: string,
    public readonly command?: vscode.Command,
    public readonly iconPath?: vscode.ThemeIcon,
    public readonly showIcon: boolean = true
  ) {
    super(label, collapsibleState);
    this.tooltip = tooltip;
    this.contextValue = contextValue;
    this.command = command;

    // 设置图标
    if (showIcon) {
      switch (contextValue) {
        case 'enabled':
          this.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'));
          break;
        case 'disabled':
          this.iconPath = new vscode.ThemeIcon('circle-outline');
          break;
        case 'stats':
          this.iconPath = new vscode.ThemeIcon('account');
          break;
        case 'team':
          this.iconPath = new vscode.ThemeIcon('organization');
          break;
        case 'git':
          this.iconPath = new vscode.ThemeIcon('git-branch');
          break;
        case 'report':
          this.iconPath = new vscode.ThemeIcon('file-text');
          break;
        case 'warning':
          this.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('editorWarning.foreground'));
          break;
        case 'info':
          this.iconPath = new vscode.ThemeIcon('info');
          break;
        case 'workspace':
          this.iconPath = new vscode.ThemeIcon('folder');
          break;
        default:
          this.iconPath = iconPath;
      }
    }
  }
}
