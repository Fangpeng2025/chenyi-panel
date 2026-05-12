# 晨翼Agent - IPC错误处理指南

## 概述

本文档描述了晨翼Agent IPC通信层的错误处理策略、最佳实践和故障排除方法。

## 架构

```
┌─────────────────┐
│  渲染进程       │
│  (React UI)     │
└────────┬────────┘
         │ IPC (Electron)
         ▼
┌─────────────────┐
│  主进程         │
│  chenyi-ipc.js  │ ← 统一错误处理
└────────┬────────┘
         │
    ┌────┴────┐
    │         │
    ▼         ▼
┌────────┐ ┌────────────┐
│ HTTP   │ │ stdin/stdout│
│ Client │ │ IPC        │
└───┬────┘ └─────┬──────┘
    │            │
    └─────┬──────┘
          ▼
    ┌───────────┐
    │ Rust内核  │
    └───────────┘
```

## 错误类型

### 1. 连接错误

| 错误类型 | 描述 | 处理策略 |
|---------|------|---------|
| `NETWORK` | 网络连接失败 | 自动重试（指数退避） |
| `TIMEOUT` | 请求超时 | 根据命令类型调整超时 |
| `PROCESS_EXIT` | 内核进程退出 | 自动重启（指数退避） |
| `PROCESS_ERROR` | 进程启动失败 | 检查二进制路径，重试 |
| `NOT_READY` | 内核未就绪 | 等待ready事件 |

### 2. 业务错误

| 错误类型 | 描述 | 处理策略 |
|---------|------|---------|
| `KERNEL_ERROR` | 内核返回错误 | 记录日志，通知用户 |
| `INVALID_RESPONSE` | 无效响应格式 | 记录日志，重试 |
| `VALIDATION_ERROR` | 参数验证失败 | 直接返回错误 |
| `CLIENT_NOT_INITIALIZED` | 客户端未初始化 | 初始化后重试 |

### 3. 系统错误

| 错误类型 | 描述 | 处理策略 |
|---------|------|---------|
| `BUFFER_OVERFLOW` | 缓冲区溢出 | 清空缓冲区，重启 |
| `CIRCUIT_OPEN` | 熔断器开启 | 等待恢复，降级处理 |

## 超时配置

### 分类超时

```javascript
const CommandTimeout = {
  default: 30000,      // 默认30秒
  health: 5000,        // 健康检查5秒
  chat: 120000,        // 对话2分钟（支持长链工具调用）
  session: 10000,      // 会话操作10秒
  memory: 15000        // 记忆操作15秒
};
```

### 自定义超时

```javascript
// 发送命令时指定超时
await kernel.send('chat', { message }, { timeout: 60000 });
```

## 重试机制

### 指数退避重试

```javascript
// kernel-client.js
const retryConfig = {
  maxRetries: 3,
  retryDelay: 1000,      // 初始延迟1秒
  retryMultiplier: 2     // 每次翻倍
};

// 重试延迟: 1s → 2s → 4s
```

### 可重试的错误

- 网络错误 (`NETWORK`)
- 超时错误 (`TIMEOUT`)
- 服务器错误 (HTTP 5xx)

### 不可重试的错误

- 客户端错误 (HTTP 4xx)
- 验证错误 (`VALIDATION_ERROR`)
- 业务逻辑错误

## 熔断器

### 工作原理

```
CLOSED (正常) ──失败次数达到阈值──> OPEN (熔断)
     ↑                              │
     │                              │ 30秒后
     │                              ▼
     └────成功次数达到阈值── HALF_OPEN (半开)
```

### 配置

```javascript
const circuitBreaker = {
  failureThreshold: 5,    // 5次失败后熔断
  successThreshold: 2,    // 2次成功后恢复
  timeout: 30000          // 30秒后尝试恢复
};
```

### 手动控制

```javascript
// 重置熔断器
kernelClient.resetCircuit();

// 检查状态
const stats = kernelClient.getStats();
console.log('熔断器状态:', stats.circuitState);
```

## 状态恢复

### 检查点机制

```javascript
// 创建检查点
const checkpointId = recoveryManager.createCheckpoint('before-operation');

// 恢复到检查点
recoveryManager.restoreCheckpoint(checkpointId);
```

### 待处理操作

```javascript
// 添加待处理操作
const opId = recoveryManager.addPendingOperation({
  operation: 'sendMessage',
  params: { content: 'Hello' },
  strategy: RecoveryStrategy.RETRY,
  maxAttempts: 3,
  compensate: async (params) => {
    // 补偿操作：删除已发送的消息
    await deleteMessage(params.messageId);
  }
});

// 完成操作
recoveryManager.completeOperation(opId);
```

### 恢复策略

| 策略 | 描述 | 适用场景 |
|-----|------|---------|
| `RETRY` | 重试操作 | 幂等操作 |
| `SKIP` | 跳过操作 | 非关键操作 |
| `COMPENSATE` | 执行补偿 | 非幂等操作 |
| `ROLLBACK` | 回滚状态 | 事务性操作 |

## 日志记录

### 结构化日志

```javascript
const { Logger, LogLevel } = require('./logger.js');

const logger = new Logger({
  name: 'ChenYi',
  level: LogLevel.INFO,
  file: '/var/log/chenyi/app.log'
});

// 记录日志
logger.info('会话创建成功', { sessionId: 'xxx' });
logger.error('请求失败', { error: 'TIMEOUT', cmd: 'chat' });
```

### 性能追踪

```javascript
// 开始追踪
const trace = logger.startTrace('sendMessage', { sessionId: 'xxx' });

// ... 执行操作 ...

// 结束追踪
const duration = trace.end({ messageLength: 100 });
// 自动记录慢操作（>5秒）
```

### 日志级别

| 级别 | 描述 | 使用场景 |
|-----|------|---------|
| DEBUG | 调试信息 | 开发环境 |
| INFO | 一般信息 | 正常操作 |
| WARN | 警告信息 | 潜在问题 |
| ERROR | 错误信息 | 操作失败 |
| FATAL | 致命错误 | 系统崩溃 |

## 监控指标

### 内核IPC统计

```javascript
const stats = kernelIPC.getStats();
// {
//   requests: 100,
//   successes: 95,
//   failures: 5,
//   restarts: 2,
//   pendingRequests: 3,
//   ready: true,
//   running: true,
//   lastError: { type: 'TIMEOUT', ... }
// }
```

### HTTP客户端统计

```javascript
const stats = kernelClient.getStats();
// {
//   requests: 100,
//   successes: 95,
//   failures: 5,
//   retries: 10,
//   circuitOpens: 2,
//   circuitState: 'CLOSED',
//   failureCount: 0
// }
```

### IPC处理器统计

```javascript
const stats = getStats();
// {
//   requests: 100,
//   successes: 95,
//   failures: 5,
//   errorsByType: { TIMEOUT: 3, NETWORK: 2 },
//   lastError: { ... }
// }
```

## 最佳实践

### 1. 错误处理

```javascript
// ✅ 正确：捕获并分类错误
try {
  await kernel.chat(message);
} catch (error) {
  if (error.type === 'TIMEOUT') {
    // 处理超时
    showNotification('请求超时，请重试');
  } else if (error.type === 'PROCESS_EXIT') {
    // 处理进程退出
    showNotification('内核已重启，请稍候');
    await waitForReady();
  } else {
    // 其他错误
    showError(error.message);
  }
}

// ❌ 错误：忽略错误类型
try {
  await kernel.chat(message);
} catch (error) {
  showError('操作失败'); // 信息不足
}
```

### 2. 重试逻辑

```javascript
// ✅ 正确：使用内置重试
const result = await kernel.send('chat', { message }, { 
  retries: 3,
  timeout: 60000 
});

// ❌ 错误：手动重试
for (let i = 0; i < 3; i++) {
  try {
    await kernel.chat(message);
    break;
  } catch (e) {
    // 没有退避，可能加剧问题
  }
}
```

### 3. 状态管理

```javascript
// ✅ 正确：保存状态并支持恢复
recoveryManager.saveState(StateType.SESSION, sessionId, {
  sessionId,
  title,
  messages
});

// 定期创建检查点
setInterval(() => {
  recoveryManager.createCheckpoint('auto');
}, 60000);

// ❌ 错误：不保存状态
// 重启后所有会话信息丢失
```

### 4. 日志记录

```javascript
// ✅ 正确：结构化日志
logger.info('会话创建', { 
  sessionId, 
  channel: 'electron',
  userId 
});

// ❌ 错误：非结构化日志
console.log(`会话创建: ${sessionId}, ${channel}, ${userId}`);
```

## 故障排除

### 问题：内核启动失败

**症状：**
```
[内核IPC] 启动失败: spawn ENOENT
```

**解决方案：**
1. 检查二进制路径是否正确
2. 确认二进制文件有执行权限
3. 检查依赖库是否安装

```bash
# 检查文件
ls -la /path/to/chenyi-kernel

# 添加执行权限
chmod +x /path/to/chenyi-kernel

# 检查依赖
ldd /path/to/chenyi-kernel
```

### 问题：频繁超时

**症状：**
```
命令超时: chat (30000ms)
```

**解决方案：**
1. 增加超时时间
2. 检查内核性能
3. 检查系统资源

```javascript
// 增加超时
await kernel.send('chat', { message }, { timeout: 120000 });
```

### 问题：熔断器频繁开启

**症状：**
```
[KernelClient] 熔断器开启 (失败次数: 5)
```

**解决方案：**
1. 检查内核是否稳定
2. 调整熔断阈值
3. 检查网络连接

```javascript
// 调整阈值
const client = new KernelClient(baseUrl, {
  failureThreshold: 10,  // 提高阈值
  circuitTimeout: 60000  // 延长恢复时间
});
```

### 问题：内存持续增长

**症状：**
```
内存增长: 150MB
```

**解决方案：**
1. 检查是否有未清理的监听器
2. 检查是否有循环引用
3. 使用堆快照分析

```javascript
// 清理监听器
kernel.removeAllListeners();

// 生成堆快照
const { writeHeapSnapshot } = require('v8');
writeHeapSnapshot('heap.heapsnapshot');
```

## 测试

### 运行压力测试

```bash
cd /home/fangpeng/projects/chenyi-panel
node src/main/ipc-stress-test.js
```

### 测试项目

- 基础通信测试
- 高并发测试（50并发）
- 超时处理测试
- 错误恢复测试
- 网络不稳定测试
- 内核重启测试
- 状态恢复测试
- 内存压力测试

### 查看测试报告

测试完成后会自动生成报告：

```
========================================
  测试报告
========================================

总计: 8 个测试
通过: 7 个
失败: 1 个
成功率: 87.50%

详细指标:
...
```

## 相关文件

- `kernel-ipc.js` - IPC客户端（子进程通信）
- `kernel-client.js` - HTTP客户端
- `chenyi-ipc.js` - IPC处理器
- `logger.js` - 日志系统
- `state-recovery.js` - 状态恢复管理器
- `ipc-stress-test.js` - 压力测试套件

## 更新日志

### v2.0 (2026-05-12)

- 添加分类超时配置
- 实现指数退避重试
- 添加熔断器机制
- 实现状态恢复管理
- 添加结构化日志系统
- 创建压力测试套件
- 编写错误处理文档
