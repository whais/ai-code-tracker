
# Change Log

All notable changes to the "ai-code-tracker" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-03-30

### Added
- 🎯 **自定义 AI 标记模式系统**
  - 支持通过正则表达式配置项目中的 AI 标记格式
  - 内置 9+ 种主流 AI 工具标记模式（DeepSeek、Copilot、ChatGPT、Claude、Cursor、TabNine、Codeium 等）
  - 支持启用/禁用特定标记模式
  - 配置变化实时生效，无需重启

- 🔧 **AI 标记配置命令面板**
  - `AI Code Tracker: 配置 AI 标记模式` - 统一的配置入口
  - 查看当前所有标记模式
  - 添加自定义标记模式
  - 编辑现有标记模式
  - 删除自定义标记模式
  - 配置标记格式（注释/标签/自定义）
  - 测试正则表达式模式

- 🏷️ **多种标记格式支持**
  - 注释格式：`// [AI-GEN] model={model} timestamp={timestamp}`
  - 标签格式：`[AI-GEN] model={model} timestamp={timestamp}`
  - 自定义格式：支持模板变量 `{model}`, `{timestamp}`, `{date}`

- 🧪 **标记模式测试工具**
  - 实时测试正则表达式是否能正确匹配
  - 支持选中代码或手动输入测试文本
  - 显示匹配结果和匹配的模式

- 📊 **双数据源报告生成**
  - Git 历史模式：基于完整的 Git 提交历史分析
  - 本地统计模式：基于当前工作区统计，速度更快
  - 在周报配置中可选择数据源

- ⚙️ **新增配置项**
  - `aiCodeTracker.aiMarkPatterns` - 自定义标记模式列表
  - `aiCodeTracker.markFormat` - 标记格式类型
  - `aiCodeTracker.customMarkTemplate` - 自定义标记模板
  - `aiCodeTracker.defaultModel` - 默认 AI 模型名称
  - `aiCodeTracker.autoDetectThreshold` - 自动检测阈值
  - `weeklyReport.useGit` - 周报数据源选择

### Changed
- 🔄 重构 AI 标记识别系统，使用统一的 MarkPatternManager
- 🔄 优化 AI 代码检测算法，提高识别准确率
- 🔄 改进标记生成逻辑，支持动态模板
- 🔄 完善团队统计准确性，更好地识别 AI 标记
- 📝 更新文档，添加自定义标记配置说明

### Fixed
- 🐛 修复 Git 历史分析时 AI 标记识别不准确的问题
- 🐛 修复某些情况下自动标记重复添加的问题
- 🐛 修复配置文件变化后统计不更新的问题

## [1.0.0] - 2026-03-27

### Added
- 🎉 首次发布
- ✨ AI 代码自动检测和标记功能
  - 自动检测从 AI 工具粘贴的代码
  - 支持 DeepSeek、Copilot、ChatGPT、Claude 等主流 AI 工具
  - 智能识别 AI 生成的代码特征
- 👥 团队统计功能
  - Git Blame 集成，精确到行级统计
  - 成员 AI 使用率排行
  - 贡献占比分析
  - 趋势环比分析
- 📊 实时状态栏显示
  - 个人 AI 使用率显示
  - 团队平均 AI 使用率显示
  - 点击状态栏查看详细统计
- 📈 手动标记功能
  - 标记选中代码为 AI 生成
  - 标记选中代码为人工编写
  - 支持自定义模型名称/作者名称
- 🔍 Git 历史分析
  - 分析整个项目的历史提交
  - 追溯每行代码的来源
  - 支持大型项目增量分析
- 📧 自动周报生成
  - 支持 HTML、Markdown、JSON 格式
  - 可配置生成时间和周期
  - 精美的 HTML 报告模板
  - 数据可视化图表
  - 智能改进建议
- 💡 智能改进建议
  - AI 使用率变化提醒
  - 团队协作建议
  - 代码质量提示
- 🎨 Webview 可视化界面
  - 团队统计看板
  - 个人详细统计
  - 进度条可视化
- ⚙️ 灵活配置选项
  - 团队成员映射
  - AI 模型关键词列表
  - 周报配置
  - 通知设置

### Technical
- 📦 纯 TypeScript 实现
- 🔧 支持多种主流编程语言（JavaScript, TypeScript, Python, Java, Go, Rust, C/C++, Ruby, PHP 等）
- 🚀 高性能增量分析架构
- 📝 完整的类型定义
- 📚 详细的文档和示例

### Documentation
- 📖 完整的 README 文档
- 📝 配置说明
- 💡 使用指南
- ❓ 常见问题解答

## [Unreleased]

### Planned
- 📧 邮件自动发送功能
- 📊 数据库持久化存储
- 🌐 多语言支持
- 📱 远程团队统计面板
- 🤖 更多 AI 工具的智能识别
- 📈 更详细的可视化图表
- 🔔 实时通知功能
- 📊 导出为 PDF 格式

---

## Version History

| Version | Release Date | Highlights |
|---------|-------------|------------|
| 1.1.0 | 2026-03-30 | 自定义标记模式、多种标记格式、配置面板 |
| 1.0.0 | 2026-03-27 | 首次发布，核心功能完整 |