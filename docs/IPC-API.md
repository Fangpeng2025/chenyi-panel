# 晨翼Agent - IPC API文档

## 概述

本文档描述了晨翼Agent IPC通信层的API接口。

## 核心模块

### 1. KernelIPC (kernel-ipc.js)

IPC客户端，通过子进程与Rust内核通信。

#### 构造函数

```javascript
const kernel = new KernelIPC({
  binaryPath: '/path/to/chenyi-kernel',  // 内核二进制路径
  autoRestart: true,                      // 自动重启（默认true）
  maxRestartAttempts: 5,                  // 最大重启尝试次数
  restartDelay: 1000,                     // 初始重启延迟（毫秒）
  maxRestartDelay: 30000,                 // 最大重启延迟（毫秒）
  maxBufferSize: 10 * 1024 * 1024,        // 最大缓冲区大小（10MB）
  logger: customLogger,                   // 自定义日志记录器
  recoveryManager: customRecoveryManager  // 自定义状态恢复管理器
});
```

#### 方法

##### start()

启动内核进程。

```javascript
kernel.start();
kernel.on('ready', () => {
  console.log('内核已就绪');
});
```

##### stop()

停止内核进程。

```javascript
kernel.stop();
```

##### send(cmd, params, options)

发送命令到内核。

```javascript
const result = await kernel.send('chat', 
  { message: '你好' },
  {
    timeout: 60000,        // 超时时间（毫秒）
    retries: 3,            // 重试次数
    trackState: true,      // 是否追踪状态
    recoveryStrategy: 'RETRY'  // 恢复策略
  }
);
```

##### health()

健康检查。

```javascript
const health = await kernel.health();
// { ok: true, result: { status: 'ok', uptime: 123, version: '0.1.0' } }
```

##### createSession(title)

创建新会话。

```javascript
const session = await kernel.createSession('新对话');
// { session_id: 'xxx', title: '新对话', created_at: '...' }
```

##### listSessions()

列出所有会话。

```javascript
const sessions = await kernel.listSessions();
// [{ session_id: 'xxx', title: '对话1', ... }, ...]
```

##### deleteSession(sessionId)

删除会话。

```javascript
await kernel.deleteSession('session-id');
```

##### getSessionMessages(sessionId)

获取会话消息。

```javascript
const messages = await kernel.getSessionMessages('session-id');
// [{ role: 'user', content: '...' }, ...]
```

##### chat(message)

发送消息并获取回复。

```javascript
const response = await kernel.chat('你好');
// { content: '你好！有什么可以帮助你的吗？', ... }
```

##### getStats()

获取统计信息。

```javascript
const stats = kernel.getStats();
// {
//   requests: 100,
//   successes: 95,
//   failures: 5,
//   restarts: 2,
//   ready: true,
//   running: true,
//   pendingRequests: 0,
//   restartAttempts: 0,
//   logger: { ... },
//   recovery: { ... }
// }
```

##### isReady()

检查内核是否就绪。

```javascript
if (kernel.isReady()) {
  // 内核已就绪
}
```

#### 事件

| 事件 | 参数 | 描述 |
|-----|------|------|
| `ready` | - | 内核已就绪 |
| `started` | - | 内核进程已启动 |
| `exit` | `{ code, signal }` | 内核进程退出 |
| `error` | `Error` | 发生错误 |
| `response` | `response` | 收到无ID响应 |

### 2. KernelClient (kernel-client.js)

HTTP客户端，通过HTTP与Rust内核通信。

#### 构造函数

```javascript
const client = new KernelClient('http://localhost:8080', {
  maxRetries: 3,              // 最大重试次数
  retryDelay: 1000,           // 初始重试延迟
  retryMultiplier: 2,         // 重试延迟倍数
  failureThreshold: 5,        // 熔断失败阈值
  successThreshold: 2,        // 熔断恢复成功阈值
  circuitTimeout: 30000,      // 熔断超时时间
  defaultTimeout: 30000       // 默认请求超时
});
```

#### 方法

##### setToken(token)

设置认证Token。

```javascript
client.setToken('your-jwt-token');
```

##### health()

健康检查。

```javascript
const health = await client.health();
```

##### createSession(channel, sender)

创建会话。

```javascript
const session = await client.createSession('electron', 'user');
```

##### getSession(sessionId)

获取会话。

```javascript
const session = await client.getSession('session-id');
```

##### listSessions(limit, offset)

列出会话。

```javascript
const result = await client.listSessions(20, 0);
```

##### deleteSession(sessionId)

删除会话。

```javascript
await client.deleteSession('session-id');
```

##### sendMessage(content, role)

发送消息。

```javascript
const response = await client.sendMessage('你好', 'user');
```

##### getMessages(sessionId)

获取消息。

```javascript
const messages = await client.getMessages('session-id');
```

##### saveMemory(content, metadata)

保存记忆。

```javascript
await client.saveMemory('用户喜欢编程', { category: 'preference' });
```

##### searchMemory(query, k)

搜索记忆。

```javascript
const results = await client.searchMemory('编程', 10);
```

##### executeTool(toolName, params)

执行工具。

```javascript
const result = await client.executeTool('web_search', { query: 'Rust教程' });
```

##### getStats()

获取统计信息。

```javascript
const stats = client.getStats();
```

##### resetCircuit()

重置熔断器。

```javascript
client.resetCircuit();
```

### 3. Logger (logger.js)

结构化日志记录器。

#### 构造函数

```javascript
const logger = new Logger({
  name: 'ChenYi',              // 日志记录器名称
  level: LogLevel.INFO,        // 日志级别
  console: true,               // 是否输出到控制台
  file: '/var/log/app.log',    // 日志文件路径
  maxFileSize: 10 * 1024 * 1024,  // 最大文件大小
  maxFiles: 5,                 // 最大文件数量
  jsonFormat: false,           // 是否JSON格式
  errorRateThreshold: 0.1,     // 错误率告警阈值
  slowOperationThreshold: 5000, // 慢操作阈值（毫秒）
  maxErrorsPerMinute: 10       // 每分钟最大错误数
});
```

#### 方法

##### log(level, message, context)

记录日志。

```javascript
logger.log(LogLevel.INFO, '操作成功', { operation: 'createSession' });
```

##### debug(message, context)

记录DEBUG级别日志。

```javascript
logger.debug('调试信息', { data: value });
```

##### info(message, context)

记录INFO级别日志。

```javascript
logger.info('会话创建', { sessionId: 'xxx' });
```

##### warn(message, context)

记录WARN级别日志。

```javascript
logger.warn('请求慢', { duration: 6000 });
```

##### error(message, context)

记录ERROR级别日志。

```javascript
logger.error('请求失败', { error: 'TIMEOUT' });
```

##### fatal(message, context)

记录FATAL级别日志。

```javascript
logger.fatal('系统崩溃', { reason: '...' });
```

##### startTrace(operation, context)

开始性能追踪。

```javascript
const trace = logger.startTrace('sendMessage', { sessionId: 'xxx' });
// ... 执行操作 ...
const duration = trace.end({ success: true });
```

##### getMetrics()

获取日志指标。

```javascript
const metrics = logger.getMetrics();
```

##### generateReport()

生成日志报告。

```javascript
const report = logger.generateReport();
```

### 4. StateRecoveryManager (state-recovery.js)

状态恢复管理器。

#### 构造函数

```javascript
const manager = new StateRecoveryManager({
  maxHistorySize: 100,         // 最大历史记录数
  maxRecoveryAttempts: 3,      // 最大恢复尝试次数
  recoveryDelay: 1000,         // 恢复延迟
  checkpointInterval: 60000    // 检查点间隔
});
```

#### 方法

##### initialize()

初始化管理器。

```javascript
manager.initialize();
```

##### saveState(type, key, state, options)

保存状态。

```javascript
manager.saveState(StateType.SESSION, 'session-123', {
  sessionId: 'session-123',
  title: '测试会话',
  messages: []
});
```

##### getState(type, key)

获取状态。

```javascript
const state = manager.getState(StateType.SESSION, 'session-123');
```

##### deleteState(type, key)

删除状态。

```javascript
manager.deleteState(StateType.SESSION, 'session-123');
```

##### addPendingOperation(operation)

添加待处理操作。

```javascript
const opId = manager.addPendingOperation({
  operation: 'sendMessage',
  params: { content: 'Hello' },
  strategy: RecoveryStrategy.RETRY,
  maxAttempts: 3,
  compensate: async (params) => {
    // 补偿操作
  }
});
```

##### completeOperation(operationId)

完成操作。

```javascript
manager.completeOperation(opId);
```

##### createCheckpoint(name)

创建检查点。

```javascript
const checkpointId = manager.createCheckpoint('before-operation');
```

##### restoreCheckpoint(checkpointId)

恢复到检查点。

```javascript
manager.restoreCheckpoint(checkpointId);
```

##### performRecovery(context)

执行恢复。

```javascript
const result = await manager.performRecovery({
  kernelClient: client
});
```

##### getStats()

获取统计信息。

```javascript
const stats = manager.getStats();
```

##### cleanup()

清理资源。

```javascript
manager.cleanup();
```

## 错误类型

### KernelIPC错误

| 类型 | 描述 |
|-----|------|
| `TIMEOUT` | 命令超时 |
| `PROCESS_EXIT` | 进程退出 |
| `PROCESS_ERROR` | 进程错误 |
| `NOT_READY` | 内核未就绪 |
| `INVALID_RESPONSE` | 无效响应 |
| `KERNEL_ERROR` | 内核错误 |
| `BUFFER_OVERFLOW` | 缓冲区溢出 |

### KernelClient错误

| 类型 | 描述 |
|-----|------|
| `NETWORK` | 网络错误 |
| `TIMEOUT` | 请求超时 |
| `CIRCUIT_OPEN` | 熔断器开启 |
| `SERVER_ERROR` | 服务器错误 |
| `INVALID_RESPONSE` | 无效响应 |

### ChenYiIPC错误

| 类型 | 描述 |
|-----|------|
| `CLIENT_NOT_INITIALIZED` | 客户端未初始化 |
| `CLIENT_ERROR` | 客户端错误 |
| `NETWORK_ERROR` | 网络错误 |
| `TIMEOUT` | 超时 |
| `VALIDATION_ERROR` | 验证错误 |

## 超时配置

### 默认超时

| 命令类型 | 超时时间 |
|---------|---------|
| 默认 | 30秒 |
| 健康检查 | 5秒 |
| 对话 | 2分钟 |
| 会话操作 | 10秒 |
| 记忆操作 | 15秒 |

### 自定义超时

```javascript
// 发送命令时指定
await kernel.send('chat', { message }, { timeout: 60000 });

// 或修改默认配置
const CommandTimeout = {
  default: 30000,
  health: 5000,
  chat: 120000,
  session: 10000,
  memory: 15000
};
```

## 恢复策略

| 策略 | 描述 | 适用场景 |
|-----|------|---------|
| `RETRY` | 重试操作 | 幂等操作 |
| `SKIP` | 跳过操作 | 非关键操作 |
| `COMPENSATE` | 执行补偿 | 非幂等操作 |
| `ROLLBACK` | 回滚状态 | 事务性操作 |

## 使用示例

### 完整示例

```javascript
const KernelIPC = require('./kernel-ipc.js');
const { Logger, LogLevel } = require('./logger.js');
const { StateRecoveryManager, StateType, RecoveryStrategy } = require('./state-recovery.js');

// 创建组件
const logger = new Logger({ name: 'App', level: LogLevel.INFO });
const recoveryManager = new StateRecoveryManager();
const kernel = new KernelIPC({ logger, recoveryManager });

// 初始化
recoveryManager.initialize();

// 监听事件
kernel.on('ready', async () => {
  logger.info('内核已就绪');
  
  try {
    // 创建会话（带状态追踪）
    const session = await kernel.createSession('新对话');
    
    // 保存状态
    recoveryManager.saveState(StateType.SESSION, session.session_id, {
      sessionId: session.session_id,
      title: session.title
    });
    
    // 发送消息（带状态追踪）
    const response = await kernel.chat('你好', {
      trackState: true,
      recoveryStrategy: RecoveryStrategy.RETRY
    });
    
    logger.info('收到回复', { content: response.content });
    
  } catch (error) {
    logger.error('操作失败', { error: error.message, type: error.type });
  }
});

kernel.on('error', (error) => {
  logger.error('内核错误', { type: error.type, message: error.message });
});

// 启动
kernel.start();

// 优雅关闭
process.on('SIGINT', () => {
  recoveryManager.createCheckpoint('shutdown');
  kernel.stop();
  recoveryManager.cleanup();
  process.exit(0);
});
```

## 相关文档

- [IPC错误处理指南](./IPC-ERROR-HANDLING.md)
- [压力测试套件](../src/main/ipc-stress-test.js)
