# IPC改进快速参考

## 快速开始

```javascript
const ChenYiIPCClient = require('./ipc-client-integrated.js');

const client = new ChenYiIPCClient({
  name: 'MyApp',
  logLevel: 'INFO',
  binaryPath: '/path/to/chenyi-kernel'
});

await client.initialize();
await client.createSession('新对话');
await client.sendMessage('你好');
await client.shutdown();
```

## 常用操作

### 日志记录
```javascript
const { Logger, LogLevel } = require('./logger.js');

const logger = new Logger({ name: 'App', level: LogLevel.INFO });

// 基本日志
logger.info('操作成功', { sessionId: 'xxx' });
logger.error('操作失败', { error: 'TIMEOUT' });

// 性能追踪
const trace = logger.startTrace('operation');
// ... 执行操作 ...
trace.end(); // 自动记录慢操作
```

### 状态管理
```javascript
const { StateRecoveryManager, StateType } = require('./state-recovery.js');

const manager = new StateRecoveryManager();
manager.initialize();

// 保存状态
manager.saveState(StateType.SESSION, 'session-123', sessionData);

// 创建检查点
const checkpointId = manager.createCheckpoint('before-operation');

// 恢复状态
manager.restoreCheckpoint(checkpointId);

// 清理
manager.cleanup();
```

### 发送命令
```javascript
// 基本命令
await kernel.send('chat', { message: '你好' });

// 带选项
await kernel.send('chat', { message }, {
  timeout: 60000,        // 超时时间
  retries: 3,            // 重试次数
  trackState: true,      // 追踪状态
  recoveryStrategy: 'RETRY'  // 恢复策略
});
```

## 错误处理

```javascript
try {
  await kernel.chat(message);
} catch (error) {
  switch (error.type) {
    case 'TIMEOUT':
      // 处理超时
      break;
    case 'PROCESS_EXIT':
      // 处理进程退出
      break;
    case 'KERNEL_ERROR':
      // 处理内核错误
      break;
    default:
      // 其他错误
  }
}
```

## 监控指标

```javascript
// 获取统计信息
const stats = client.getStats();

console.log('请求:', stats.kernel.requests);
console.log('成功:', stats.kernel.successes);
console.log('失败:', stats.kernel.failures);
console.log('状态数:', stats.recovery.stateCount);
console.log('检查点数:', stats.recovery.checkpointCount);
```

## 测试命令

```bash
# 验证改进
node src/main/test-improvements.js

# 运行压力测试
node src/main/ipc-stress-test.js

# 运行完整示例
node src/main/ipc-client-integrated.js
```

## 文档位置

- 错误处理指南: `docs/IPC-ERROR-HANDLING.md`
- API文档: `docs/IPC-API.md`
- 改进报告: `docs/IPC-IMPROVEMENTS-REPORT.md`
- 最终报告: `docs/FINAL-REPORT.md`
