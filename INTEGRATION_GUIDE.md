# 无感统计方案集成指南

## 快速集成步骤

### 步骤1：导入新模块

在 `extension.ts` 中添加导入：

```typescript
import { LineTracker } from './core/lineTracker';
import { AIGenerationListener } from './listeners/aiGenerationListener';
import { GitHookManager } from './core/gitHookManager';
```

### 步骤2：声明全局变量

```typescript
let lineTracker: LineTracker;
let aiGenerationListener: AIGenerationListener;
let gitHookManager: GitHookManager;
```

### 步骤3：在 activate 中初始化

```typescript
export async function activate(context: vscode.ExtensionContext) {
  // ... 原有初始化代码 ...
  
  // ========== 新增：无感统计初始化 ==========
  
  // 1. 初始化行级追踪器
  lineTracker = new LineTracker(context);
  
  // 2. 初始化AI生成监听器
  aiGenerationListener = new AIGenerationListener(lineTracker);
  
  // 3. 初始化Git钩子管理器
  gitHookManager = new GitHookManager(lineTracker, context);
  
  // 4. 注册人工编辑监听（替换原有的TextChangeListener）
  const humanEditDisposable = vscode.workspace.onDidChangeTextDocument(event => {
    // 过滤掉AI生成的事件，只记录人工编辑
    const recentStats = aiGenerationListener.getRecentEditStats();
    
    // 如果最近没有大量AI生成，认为是人工编辑
    if (recentStats.editCount === 0) {
      for (const change of event.contentChanges) {
        lineTracker.recordHumanEdit(event.document, change);
      }
    }
  });
  context.subscriptions.push(humanEditDisposable);
  
  // 5. 注册手动commit统计命令
  const commitStatsCommand = vscode.commands.registerCommand(
    'ai-code-tracker.showCommitStats',
    async () => {
      await gitHookManager.manualCommitStats();
    }
  );
  context.subscriptions.push(commitStatsCommand);
  
  // ========== 无感统计初始化完成 ==========
  
  // ... 原有代码 ...
}
```

### 步骤4：在 package.json 添加命令

```json
{
  "contributes": {
    "commands": [
      {
        "command": "ai-code-tracker.showCommitStats",
        "title": "查看提交统计",
        "category": "AI Code Tracker"
      }
    ]
  }
}
```

## 双模式运行方案

### 配置选项

```typescript
// 在 package.json 中添加配置
{
  "aiCodeTracker.statisticsMode": {
    "type": "string",
    "enum": ["passive", "active", "hybrid"],
    "default": "hybrid",
    "description": "统计模式: passive=无感统计(推荐), active=主动标记, hybrid=混合模式"
  },
  "aiCodeTracker.attributionStrategy": {
    "type": "string",
    "enum": ["conservative", "aggressive", "last-modifier"],
    "default": "last-modifier",
    "description": "AI代码归属策略"
  }
}
```

### 根据模式初始化

```typescript
const statsMode = config.get<string>('statisticsMode', 'hybrid');

if (statsMode === 'passive') {
  // 纯无感模式：只用新方案
  aiGenerationListener = new AIGenerationListener(lineTracker);
  gitHookManager = new GitHookManager(lineTracker, context);
  
  // 禁用原有监听器
  // textChangeListener = null; // 不初始化
  
} else if (statsMode === 'active') {
  // 纯主动模式：只用旧方案
  textChangeListener = new TextChangeListener(...);
  saveListener = new SaveListener(...);
  
} else if (statsMode === 'hybrid') {
  // 混合模式：两者都用，新方案为主
  aiGenerationListener = new AIGenerationListener(lineTracker);
  gitHookManager = new GitHookManager(lineTracker, context);
  
  // 保留旧方案作为fallback
  textChangeListener = new TextChangeListener(...);
  
  // 当新方案无法识别时，使用旧方案的启发式检测
}
```

## 数据融合方案

### 扩展 TeamStats 支持新指标

```typescript
// 在 types/index.ts 中扩展

interface TeamStats {
  // ... 原有字段 ...
  
  // 无感统计指标
  passiveMetrics?: {
    totalAIGenerated: number;
    totalAIAccepted: number;
    totalAIModified: number;
    totalHumanWritten: number;
    currentAcceptanceRate: number;
    byModel: Map<string, ModelMetrics>;
  };
  
  // 主动统计指标（原有）
  activeMetrics?: {
    markedAILines: number;
    markedHumanLines: number;
  };
}
```

### 状态栏显示双指标

```typescript
// 在 StatusBarManager 中添加

async update(): Promise<void> {
  const stats = this.statsManager.getStats();
  
  // 优先显示无感统计（更准确）
  if (stats.passiveMetrics) {
    const rate = stats.passiveMetrics.currentAcceptanceRate;
    this.personalBar.text = `🤖 ${rate.toFixed(0)}%`;
    this.personalBar.tooltip = `AI采纳率: ${rate.toFixed(1)}%\n` +
      `生成: ${stats.passiveMetrics.totalAIGenerated}\n` +
      `采纳: ${stats.passiveMetrics.totalAIAccepted}`;
  } else {
    // 回退到原有显示
    const rate = this.statsManager.getTotalAIPercentage();
    this.personalBar.text = `👤 AI: ${rate.toFixed(0)}%`;
  }
}
```

## 迁移路径

### 阶段1：并行运行（1周）
- 启用双模式
- 对比两种统计结果
- 调试新方案的准确性

### 阶段2：切换默认（1周）
- 默认启用无感统计
- 旧方案作为fallback
- 收集用户反馈

### 阶段3：全面切换（1周）
- 默认纯无感模式
- 保留旧方案供手动标记使用
- 废弃启发式检测

## 关键决策点

### 1. 如何检测AI生成？

当前实现使用**启发式检测**（输入速度+代码特征），建议后续：
- 接入 Copilot 官方 API（如果可用）
- 接入通义灵码等国内AI插件
- 开发 VSCode 扩展 API 供AI插件主动调用

### 2. 存储位置选择

当前实现使用：**VSCode State + 内存**
- ✅ 自动随VSCode同步
- ✅ 无需额外权限
- ⚠️ 容量有限（约10MB）

如需更大容量，可改用：
- SQLite 本地数据库
- 项目目录下的 `.ai-stats` 文件夹

### 3. Git Hook 可靠性

当前实现使用：**文件系统监听 + SCM事件**
- 监听 `.git/index` 变化检测 `git add`
- 监听工作区变化检测 `git commit`

备选方案：
- 安装 Git Hooks（需要用户授权修改项目）
- 定期轮询 `git status`

## 测试建议

### 单元测试

```typescript
// test/lineTracker.test.ts
suite('LineTracker', () => {
  test('should record AI generation', () => {
    const tracker = new LineTracker(mockContext);
    tracker.recordAIGeneration(mockDoc, 0, 5, 'copilot');
    
    const stats = tracker.calculateFileStats('test.ts');
    assert.strictEqual(stats.aiGenerated, 6);
  });
  
  test('should apply attribution strategy', () => {
    // 测试归属策略
  });
});
```

### 集成测试

1. 打开一个文件
2. 模拟AI生成代码（使用命令触发）
3. 修改部分AI代码
4. 保存文件
5. 执行 `git add`
6. 检查是否正确创建快照
7. 执行 `git commit`
8. 检查统计是否正确

## 性能考虑

### 内存优化
- 只追踪已打开的文件
- 文件关闭后只保留统计摘要
- 定期清理已提交的文件的详细记录

### CPU优化
- 行级地图使用增量更新
- 相似度计算使用简化算法
- Git状态检查使用防抖

## 后续扩展

1. **支持更多AI插件**：通义灵码、Codeium、Cursor等
2. **精细归因**：区分"完全重写"和"小修改"
3. **团队共享**：将统计结果同步到团队服务器
4. **智能建议**：基于统计数据给出代码改进建议
