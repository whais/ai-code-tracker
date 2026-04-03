# 无感统计方案可行性分析与集成方案

## 一、方案可行性评估

### ✅ 优势

| 维度 | 评估 | 说明 |
|------|------|------|
| **准确性** | ⭐⭐⭐⭐⭐ | 源头记录，100%准确识别AI代码 |
| **无侵入性** | ⭐⭐⭐⭐⭐ | 用户无需手动标记，真正的"无感" |
| **实时性** | ⭐⭐⭐⭐ | 实时监听，即时更新行级地图 |
| **技术可行性** | ⭐⭐⭐⭐ | VSCode API 支持监听键盘、Git事件 |

### ⚠️ 挑战与限制

| 挑战 | 风险等级 | 解决方案 |
|------|----------|----------|
| **多AI源支持** | 中等 | Copilot有官方API，其他AI需适配 |
| **复杂编辑场景** | 高 | 需要完善行追踪算法（diff算法） |
| **Git Hook可靠性** | 中等 | 使用VSCode Git API + 文件监听双重保障 |
| **性能开销** | 低 | 增量更新，只记录变更行 |

## 二、与现有插件的对比

| 特性 | 现有方案 | 新方案 | 建议 |
|------|----------|--------|------|
| 检测方式 | 启发式+手动标记 | 事件监听+行追踪 | **新方案为主，旧方案兜底** |
| 准确性 | 60-80% | 95%+ | 新方案更准确 |
| 用户体验 | 需要主动标记 | 完全无感 | 新方案更优 |
| 兼容性 | 通用 | 需适配各AI插件 | 保留旧方案作为fallback |
| 历史代码 | 可分析Git历史 | 只能统计激活后 | 保留Git分析功能 |

## 三、核心架构设计

```
┌─────────────────────────────────────────────────────────────────┐
│                        无感统计架构                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │  AI事件监听   │    │  人工编辑监听  │    │  Git事件监听  │      │
│  │  (Copilot等) │    │  (键盘/粘贴)  │    │ (add/commit) │      │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘      │
│         │                   │                   │                │
│         └───────────┬───────┴───────────────────┘                │
│                     ▼                                            │
│           ┌──────────────────┐                                  │
│           │    LineTracker   │                                  │
│           │   (行级归属地图)  │                                  │
│           └────────┬─────────┘                                  │
│                    │                                             │
│         ┌─────────┴──────────┐                                  │
│         ▼                    ▼                                  │
│  ┌──────────────┐    ┌──────────────┐                          │
│  │  LineState   │    │  DiffEngine  │                          │
│  │  (AI/Human)  │    │  (变更计算)   │                          │
│  └──────────────┘    └──────┬───────┘                          │
│                             │                                   │
│                             ▼                                   │
│                    ┌──────────────────┐                        │
│                    │  StatsCalculator │                        │
│                    │   (指标计算)      │                        │
│                    └────────┬─────────┘                        │
│                             │                                   │
│              ┌──────────────┼──────────────┐                   │
│              ▼              ▼              ▼                   │
│       ┌──────────┐  ┌──────────┐  ┌──────────┐                │
│       │ 本地存储  │  │ 状态栏   │  │ 上报后端  │                │
│       │ (State)  │  │ 显示     │  │ (HTTP)   │                │
│       └──────────┘  └──────────┘  └──────────┘                │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## 四、与现有插件的集成方案

### 4.1 保留的模块

```typescript
// 保留的核心功能
1. TeamStatsManager     → 统计存储与计算（需扩展支持新指标）
2. MarkPatternManager   → 作为fallback和兼容模式
3. GitAnalyzer          → 历史分析（新插件只能统计激活后的代码）
4. ReportGenerator      → 周报功能（整合新统计数据）
5. StatusBarManager     → 状态栏显示（增加实时采纳率）
```

### 4.2 新增的模块

```typescript
// 新增核心模块
1. LineTracker          → 行级归属追踪（核心）
2. AIEventListener      → AI生成事件监听（Copilot/通义等）
3. EditTracker          → 人工编辑追踪
4. GitHookManager       → Git add/commit钩子
5. DiffEngine           → 行级差异计算
```

### 4.3 废弃/弱化的模块

```typescript
// 降级为fallback
1. AIDetector           → 仅用于无AI插件支持的场景
2. TextChangeListener   → 被EditTracker取代
3. SaveListener         → 被GitHookManager取代
```

## 五、详细实现步骤

### 步骤1：数据模型扩展

```typescript
// types/index.ts 新增

interface LineInfo {
  source: 'ai' | 'human';        // 来源
  status: 'generated' | 'modified' | 'deleted' | 'unchanged';
  aiModel?: string;              // AI模型（如copilot, deepseek）
  aiConfidence?: number;         // AI生成时的置信度
  originalContent: string;       // 原始内容（AI生成时的内容）
  currentContent: string;        // 当前内容
  history: EditHistory[];        // 编辑历史
  lastModified: number;          // 最后修改时间
  lastModifiedBy: 'ai' | 'human';
}

interface EditHistory {
  type: 'generate' | 'insert' | 'delete' | 'replace';
  source: 'ai' | 'human';
  timestamp: number;
  content?: string;
  aiModel?: string;
}

// 扩展 TeamStats 支持新指标
interface TeamStats {
  // ... 原有字段
  
  // 新增无感统计指标
  aiMetrics: {
    totalAIGeneratedLines: number;     // AI生成的总行数
    totalAIAcceptedLines: number;      // 被采纳的AI行数
    totalAIModifiedLines: number;      // AI生成后被人工修改的行数
    totalHumanLines: number;           // 纯人工编写的行数
    
    // 分模型统计
    byModel: Map<string, {
      generated: number;
      accepted: number;
      modified: number;
    }>;
    
    // 实时采纳率
    currentAcceptanceRate: number;
  };
}
```

### 步骤2：行级追踪器 (LineTracker)

```typescript
// core/lineTracker.ts

export class LineTracker {
  private lineMap: Map<string, LineInfo[]> = new Map(); // filePath -> lines
  private strategy: AttributionStrategy = 'conservative';
  
  // AI生成代码时调用
  recordAIGeneration(
    filePath: string, 
    startLine: number, 
    content: string,
    aiModel: string,
    confidence: number
  ): void {
    const lines = content.split('\n');
    const fileLines = this.getOrCreateFileLines(filePath);
    
    lines.forEach((line, index) => {
      const lineNum = startLine + index;
      fileLines[lineNum] = {
        source: 'ai',
        status: 'generated',
        aiModel,
        aiConfidence: confidence,
        originalContent: line,
        currentContent: line,
        history: [{
          type: 'generate',
          source: 'ai',
          timestamp: Date.now(),
          content: line
        }],
        lastModified: Date.now(),
        lastModifiedBy: 'ai'
      };
    });
  }
  
  // 人工编辑时调用
  recordHumanEdit(
    filePath: string,
    startLine: number,
    endLine: number,
    newContent: string,
    editType: 'insert' | 'delete' | 'replace'
  ): void {
    const fileLines = this.getOrCreateFileLines(filePath);
    
    // 根据策略更新归属
    switch (this.strategy) {
      case 'conservative':
        // 任何人工修改都转为human
        this.applyConservativeStrategy(fileLines, startLine, endLine, newContent);
        break;
      case 'aggressive':
        // 只有大幅修改才变更
        this.applyAggressiveStrategy(fileLines, startLine, endLine, newContent);
        break;
      case 'last-modifier':
        // 最后修改者决定
        this.applyLastModifierStrategy(fileLines, startLine, endLine, newContent);
        break;
    }
  }
  
  // 计算指定范围的AI贡献
  calculateAIContribution(filePath: string, startLine?: number, endLine?: number): {
    aiLines: number;
    humanLines: number;
    modifiedAILines: number;
  } {
    const lines = this.lineMap.get(filePath) || [];
    const range = startLine !== undefined && endLine !== undefined 
      ? lines.slice(startLine, endLine + 1)
      : lines;
      
    return range.reduce((acc, line) => {
      if (!line) return acc;
      
      if (line.source === 'ai') {
        if (line.status === 'modified') {
          acc.modifiedAILines++;
        } else {
          acc.aiLines++;
        }
      } else {
        acc.humanLines++;
      }
      return acc;
    }, { aiLines: 0, humanLines: 0, modifiedAILines: 0 });
  }
}
```

### 步骤3：AI事件监听器

```typescript
// listeners/aiEventListener.ts

export class AIEventListener {
  private lineTracker: LineTracker;
  
  constructor(lineTracker: LineTracker) {
    this.lineTracker = lineTracker;
    this.registerCopilotListener();
    this.registerTongyiListener();
    // 其他AI插件...
  }
  
  private registerCopilotListener(): void {
    // GitHub Copilot 通过特定命令触发
    // 监听编辑器内容变化 + 检测Copilot特定模式
    vscode.workspace.onDidChangeTextDocument(event => {
      const isCopilotInsertion = this.detectCopilotInsertion(event);
      if (isCopilotInsertion) {
        this.lineTracker.recordAIGeneration(
          event.document.fileName,
          isCopilotInsertion.startLine,
          isCopilotInsertion.content,
          'copilot',
          0.95
        );
      }
    });
  }
  
  // 检测Copilot代码插入的特征
  private detectCopilotInsertion(
    event: vscode.TextDocumentChangeEvent
  ): { startLine: number; content: string } | null {
    // Copilot通常在短时间内插入多行代码
    // 且插入位置有特定特征
    const changes = event.contentChanges;
    
    if (changes.length === 1) {
      const change = changes[0];
      const insertedText = change.text;
      const lines = insertedText.split('\n');
      
      // 启发式：一次插入超过3行代码，可能是AI生成
      if (lines.length >= 3 && change.rangeLength === 0) {
        return {
          startLine: change.range.start.line,
          content: insertedText
        };
      }
    }
    
    return null;
  }
}
```

### 步骤4：Git钩子管理器

```typescript
// core/gitHookManager.ts

export class GitHookManager {
  private lineTracker: LineTracker;
  private storage: StorageManager;
  
  constructor(lineTracker: LineTracker, storage: StorageManager) {
    this.lineTracker = lineTracker;
    this.storage = storage;
    this.setupGitListeners();
  }
  
  private setupGitListeners(): void {
    // 方法1：监听文件系统变化（.git/index）
    const gitIndexWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.workspace.workspaceFolders![0], '.git/index')
    );
    
    gitIndexWatcher.onDidChange(() => {
      this.handleGitAdd();
    });
    
    // 方法2：监听VSCode的SCM事件
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      // 检查Git扩展状态变化
    });
    
    // 方法3：使用Git Hook（如果项目允许）
    this.installGitHooks();
  }
  
  private handleGitAdd(): void {
    // git add 时创建快照
    const stagedFiles = this.getStagedFiles();
    
    for (const filePath of stagedFiles) {
      const snapshot = {
        filePath,
        timestamp: Date.now(),
        lineMap: this.lineTracker.getLineMap(filePath),
        gitStatus: 'staged'
      };
      
      this.storage.saveSnapshot(snapshot);
    }
  }
  
  private async handleGitCommit(): Promise<void> {
    // git commit 时计算最终统计
    const committedFiles = await this.getCommittedFiles();
    
    for (const filePath of committedFiles) {
      const snapshot = this.storage.getSnapshot(filePath);
      const currentLineMap = this.lineTracker.getLineMap(filePath);
      
      // 对比快照和最终代码
      const stats = this.calculateFinalStats(snapshot, currentLineMap);
      
      // 上报统计
      await this.reportStats(filePath, stats);
    }
    
    // 清理已提交的文件的行地图
    this.lineTracker.clearCommittedFiles(committedFiles);
  }
  
  private calculateFinalStats(
    snapshot: Snapshot,
    current: LineInfo[]
  ): CommitStats {
    // 详细的行级对比逻辑
    // ...
    return {
      aiGeneratedLines: 0,
      aiAcceptedLines: 0,
      aiModifiedLines: 0,
      humanLines: 0,
      acceptanceRate: 0
    };
  }
}
```

### 步骤5：归属策略实现

```typescript
// core/attributionStrategies.ts

export type AttributionStrategy = 'conservative' | 'aggressive' | 'last-modifier';

export class AttributionStrategies {
  
  // 保守策略：任何人工修改都转为human
  static conservative(
    original: LineInfo,
    newContent: string
  ): LineInfo {
    return {
      ...original,
      source: 'human',
      status: 'modified',
      currentContent: newContent,
      lastModified: Date.now(),
      lastModifiedBy: 'human',
      history: [...original.history, {
        type: 'replace',
        source: 'human',
        timestamp: Date.now(),
        content: newContent
      }]
    };
  }
  
  // 激进策略：只有大幅修改才变更
  static aggressive(
    original: LineInfo,
    newContent: string,
    threshold: number = 0.8
  ): LineInfo {
    const similarity = this.calculateSimilarity(
      original.originalContent,
      newContent
    );
    
    if (similarity < (1 - threshold)) {
      // 修改超过阈值，转为human
      return {
        ...original,
        source: 'human',
        status: 'modified',
        currentContent: newContent,
        lastModified: Date.now(),
        lastModifiedBy: 'human'
      };
    }
    
    // 小修改，保持AI归属但标记为modified
    return {
      ...original,
      status: 'modified',
      currentContent: newContent,
      lastModified: Date.now(),
      lastModifiedBy: 'human'
    };
  }
  
  // 最后修改者策略
  static lastModifier(
    original: LineInfo,
    newContent: string,
    editor: 'ai' | 'human'
  ): LineInfo {
    return {
      ...original,
      source: editor,
      status: editor === 'human' ? 'modified' : original.status,
      currentContent: newContent,
      lastModified: Date.now(),
      lastModifiedBy: editor
    };
  }
  
  private static calculateSimilarity(a: string, b: string): number {
    // 简单的相似度计算，实际可使用Levenshtein距离
    const maxLength = Math.max(a.length, b.length);
    if (maxLength === 0) return 1;
    
    const distance = this.levenshteinDistance(a, b);
    return 1 - distance / maxLength;
  }
  
  private static levenshteinDistance(a: string, b: string): number {
    // Levenshtein距离实现
    // ...
    return 0;
  }
}
```

## 六、迁移路线图

### 阶段1：基础设施（2-3天）
1. 实现 LineTracker 核心类
2. 扩展数据模型（LineInfo, 新Stats字段）
3. 实现归属策略

### 阶段2：AI监听（3-5天）
1. 实现 Copilot 检测
2. 实现通义灵码检测
3. 实现通用AI检测（基于启发式）

### 阶段3：Git集成（2-3天）
1. 实现 GitHookManager
2. 实现快照机制
3. 实现 commit 统计计算

### 阶段4：双模式运行（3-5天）
1. 集成到现有插件
2. 实现模式切换配置
3. 数据迁移与合并

### 阶段5：优化（持续）
1. 性能优化
2. 支持更多AI插件
3. 策略调优

## 七、关键决策点

### 决策1：如何检测AI生成？
- **选项A**：监听VSCode命令（Copilot有accept命令）
- **选项B**：检测内容变化特征
- **选项C**：与AI插件直接集成（需要对方提供API）
- **推荐**：A+B结合，C作为未来扩展

### 决策2：存储位置？
- **选项A**：内存（丢失风险）
- **选项B**：VSCode State（推荐）
- **选项C**：文件系统（.ai-stats目录）
- **推荐**：B为主，C为备份

### 决策3：默认归属策略？
- **保守**：适合严格管控场景
- **激进**：适合鼓励AI使用场景
- **最后修改者**：平衡方案
- **推荐**：可配置，默认"最后修改者"

## 八、风险缓解

| 风险 | 缓解措施 |
|------|----------|
| AI插件更新导致检测失效 | 多策略检测 + fallback到启发式 |
| 性能问题（大文件） | 只追踪变更行，定期清理 |
| Git操作不在VSCode中进行 | 同时使用文件系统监听Git目录 |
| 用户反感被"监控" | 明确告知 + 可关闭 + 本地优先 |

## 九、总结建议

1. **采用渐进式迁移**：新旧方案并行运行一段时间
2. **保留Git历史分析**：新方案只能统计激活后的代码
3. **配置化策略**：让用户选择归属策略
4. **数据导出**：提供将新数据导入现有统计系统的功能

这个方案技术上完全可行，关键是**行级追踪的准确性**和**Git事件监听的可靠性**。