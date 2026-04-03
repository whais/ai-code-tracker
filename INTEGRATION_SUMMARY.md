# AI Code Tracker 数据整合说明

## 整合目标
将两个独立的数据源打通，实现接入前已有AI标记与接入后无感统计的整合，最终在统计报告中体现整合后的单一AI代码率。

## 架构变化

### 整合前
```
┌─────────────────┐     ┌─────────────────┐
│  GitAnalyzer    │     │  LineTracker    │
│  (文件标记)      │     │  (无感统计)      │
│                 │     │  (内存数据)      │
└────────┬────────┘     └────────┬────────┘
         │                       │
         ▼                       ▼
   统计报告A              统计报告B
   (接入前数据)           (接入后数据，未持久化)
```

### 整合后
```
┌─────────────────────────────────────────┐
│           GitAnalyzer (整合层)           │
│  ┌──────────────┐  ┌──────────────┐    │
│  │ 文件标记分析  │  │ LineTracker  │    │
│  │ (marks)      │  │ (tracking)   │    │
│  └──────┬───────┘  └──────┬───────┘    │
│         │                  │            │
│         └──────┬───────────┘            │
│                ▼                        │
│         优先级合并: marks > tracking    │
└─────────────────────────────────────────┘
                    │
                    ▼
            统一统计报告
         (整合后的AI代码率)
```

## 主要改动

### 1. LineTracker 增强 (`src/core/lineTracker.ts`)
- 改为单例模式，确保全局唯一实例
- 添加持久化存储（使用 storage.ts）
- 新增接口供 GitAnalyzer 读取数据：
  - `getFileLineMap(filePath)` - 获取文件的行级来源信息
  - `getFileStats(filePath)` - 获取文件统计信息
  - `hasTrackingData(filePath)` - 检查是否有追踪数据
  - `mergeMarkData()` - 合并外部标记数据

### 2. GitAnalyzer 整合逻辑 (`src/core/gitAnalyzer.ts`)
- 整合策略：**文件标记 (marks) > 实时追踪 (tracking) > Git blame**
- 新增 `analyzeFileMarks()` 方法 - 专门分析文件中的AI标记
- 修改 `updateStatsFromBlame()` 方法：
  1. 首先分析文件中的AI标记（接入前数据）
  2. 然后整合 LineTracker 数据（接入后数据，只补充未覆盖的行）
  3. 输出整合统计日志

### 3. 类型定义扩展 (`src/types/index.ts`)
- 新增 `IntegratedFileStats` - 整合后的文件统计，包含数据来源信息
- 新增 `IntegrationMeta` - 整合统计元数据

### 4. 存储管理器增强 (`src/utils/storage.ts`)
- 新增 `LINE_TRACKER_DATA` 存储键
- 新增 `INTEGRATED_STATS_META` 存储键
- 新增方法：`saveLineTrackerData()`, `loadLineTrackerData()`

### 5. 监听器更新 (`src/listeners/textChangeListener.ts`, `src/listeners/saveListener.ts`)
- 接收 LineTracker 实例
- 检测到AI代码时，先记录到 LineTracker，再添加文件标记

### 6. 扩展入口更新 (`src/extension.ts`)
- 初始化 LineTracker 单例
- 将 LineTracker 传递给监听器

## 数据流

### 接入前已有标记的文件
1. GitAnalyzer 分析文件
2. `analyzeFileMarks()` 检测到文件中的 `@ai-generated` 标记
3. 标记行被记录为 AI 代码（来源：marks）
4. LineTracker 数据被忽略（因为 marks 优先级更高）

### 接入后新生成的代码
1. 用户粘贴/输入AI生成的代码
2. `TextChangeListener` / `SaveListener` 检测到AI代码
3. 调用 `lineTracker.recordAIGeneration()` 记录到 LineTracker
4. 可选：添加文件标记（根据配置）
5. GitAnalyzer 分析文件时，发现 LineTracker 有该文件数据
6. 整合时合并 LineTracker 数据（来源：tracking）

### 混合场景
```
文件内容：
  行1-10: 已有 @ai-generated 标记（接入前）
  行11-20: 新粘贴的AI代码，已记录到 LineTracker
  行21-30: 人工编写的代码

整合结果：
  AI代码行 = 10 (marks) + 10 (tracking) = 20行
  人工代码行 = 10行
  AI代码率 = 20/30 = 66.7%
```

## 日志输出
整合后会输出统计日志：
```
[INTEGRATED] /path/to/file.ts: AI=25, Human=10, Sources={marks:15, tracking:10, blame:0}
```

## 配置项
无需额外配置，自动整合。可以通过以下配置控制行为：
- `aiCodeTracker.aiMarkPatterns` - 自定义AI标记模式
- `aiCodeTracker.autoMarkAI` - 是否自动添加文件标记

## 注意事项
1. 文件标记优先级最高，会覆盖 LineTracker 的冲突数据
2. LineTracker 数据会持久化到 workspaceState
3. 人工修改过的AI代码行（LineTracker 中 editCount > 0）不会被文件标记覆盖
