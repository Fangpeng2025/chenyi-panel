# 晨翼工具调用显示和审批机制完善

## 修改概述

本次修改完善了晨翼Agent的工具调用显示和审批机制，包括以下功能：

### 1. 工具审批UI

当Agent需要调用工具时，会显示审批对话框：

- **工具名称和图标** - 根据工具类型显示对应的图标
- **工具参数** - JSON格式化显示，便于阅读
- **警告提示** - 危险工具（写入文件、执行命令等）会显示警告
- **允许/拒绝按钮** - 用户可以批准或拒绝工具调用
- **始终允许选项** - 勾选后，本次会话该工具不再需要审批

### 2. 工具调用详情显示

新的工具调用卡片设计：

- **工具图标** - 根据工具类型显示不同图标（📄读取、✏️写入、⚡执行等）
- **执行状态** - 蓝色执行中、绿色成功、红色失败
- **参数预览** - 折叠显示，点击展开查看详情
- **结果预览** - 折叠显示，支持滚动查看长结果
- **执行时间** - 显示工具调用的耗时

### 3. 工具执行进度

- **状态颜色区分**：
  - 🔵 蓝色 - 执行中
  - 🟢 绿色 - 成功
  - 🔴 红色 - 失败
- **执行时间显示** - 精确到毫秒
- **折叠/展开** - 点击工具卡片头部可折叠/展开详情

### 4. 工具调用历史

侧边栏显示工具调用历史：

- **搜索功能** - 按工具名称或参数搜索
- **过滤功能** - 按状态过滤（全部/成功/失败/执行中）
- **点击查看详情** - 点击历史记录项查看完整参数和结果
- **浮动按钮** - 右下角浮动按钮显示工具调用数量，点击打开历史面板

## 新增代码结构

### CSS样式 (index.html)

```css
/* 工具审批对话框 */
.tool-approval-overlay { ... }
.tool-approval-card { ... }
.tool-approval-header { ... }
.tool-approval-warning { ... }
.tool-approval-actions { ... }

/* 工具调用详情卡片 */
.tool-call-card { ... }
.tool-call-header { ... }
.tool-call-body { ... }
.tool-call-timing { ... }

/* 工具历史侧边栏 */
.tool-history-panel { ... }
.tool-history-filter { ... }
.tool-history-item { ... }
```

### JavaScript函数 (renderer.js)

```javascript
// 工具审批
showToolApproval(toolName, args)  // 显示审批对话框
allowToolCall()                   // 允许工具调用
denyToolCall()                    // 拒绝工具调用

// 工具历史
addToToolHistory(toolCall)        // 添加到历史记录
updateToolHistoryItem(id, updates) // 更新历史记录项
renderToolHistoryList()           // 渲染历史列表
toggleToolHistory()               // 切换历史面板
setToolHistoryFilter(filter)      // 设置过滤器
filterToolHistory()               // 搜索过滤
showToolHistoryDetail(id)         // 显示详情模态框

// 辅助函数
getToolDisplayName(toolName)      // 获取工具显示名称
formatDuration(ms)                // 格式化执行时间
toggleToolCall(headerEl)          // 折叠/展开工具卡片
```

### 状态管理

```javascript
// 新增状态
state.toolApproval = {
  pending: null,              // 待审批的工具调用
  allowedTools: new Set(),    // 本次会话始终允许的工具
  callback: null
};

state.toolHistory = [];       // 工具调用历史
state.toolHistoryFilter = 'all';  // 当前过滤器
state.toolHistorySearch = '';     // 搜索关键词

// 工具图标映射
const TOOL_ICONS = { ... };

// 危险工具列表
const DANGEROUS_TOOLS = ['write_file', 'edit', 'execute_command', 'process', 'cron'];
```

## 使用说明

### 工具审批流程

1. Agent请求调用工具
2. 系统检查是否为危险工具
3. 如果是危险工具且未在"始终允许"列表中，显示审批对话框
4. 用户选择：
   - 点击"允许" - 执行工具
   - 点击"拒绝" - 取消工具调用
   - 勾选"始终允许"后点击"允许" - 执行工具并记录到允许列表

### 查看工具历史

1. 点击右下角浮动按钮（显示工具调用数量）
2. 在侧边栏中查看所有工具调用记录
3. 使用搜索框搜索特定工具
4. 使用过滤器按状态过滤
5. 点击记录项查看完整详情

### 工具调用卡片

- 默认折叠状态，只显示工具名称和状态
- 点击卡片头部展开查看参数和结果
- 显示执行耗时

## 技术细节

### 工具图标映射

| 工具 | 图标 | 显示名称 |
|------|------|----------|
| read_file | 📄 | 读取文件 |
| write_file | ✏️ | 写入文件 |
| edit | 📝 | 编辑文件 |
| execute_command | ⚡ | 执行命令 |
| process | ⚙️ | 进程管理 |
| web_search | 🔍 | 网络搜索 |
| web_fetch | 🌐 | 网页抓取 |
| memory_get | 🧠 | 获取记忆 |
| memory_search | 🔎 | 搜索记忆 |

### 危险工具

以下工具被视为危险工具，调用时需要审批：

- `write_file` - 写入文件
- `edit` - 编辑文件
- `execute_command` - 执行命令
- `process` - 进程管理
- `cron` - 定时任务

## 后续优化建议

1. **审批策略配置** - 允许用户配置不同工具的审批策略
2. **工具调用统计** - 添加工具调用成功率、平均耗时等统计
3. **工具调用重试** - 失败的工具调用支持一键重试
4. **批量审批** - 支持批量审批多个工具调用
5. **审批历史** - 记录审批决策，便于审计
