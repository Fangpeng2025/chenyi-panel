/**
 * 简单测试 - 验证IPC改进
 */

const KernelIPC = require('./kernel-ipc.js');
const { Logger, LogLevel } = require('./logger.js');
const { StateRecoveryManager, StateType } = require('./state-recovery.js');

async function testBasicFeatures() {
  console.log('\n=== 测试基础功能 ===\n');
  
  // 创建日志记录器
  const logger = new Logger({
    name: 'Test',
    level: LogLevel.DEBUG,
    console: true
  });
  
  // 创建状态恢复管理器
  const recoveryManager = new StateRecoveryManager();
  recoveryManager.initialize();
  
  // 测试日志系统
  console.log('1. 测试日志系统');
  logger.debug('调试信息', { test: true });
  logger.info('普通信息', { operation: 'test' });
  logger.warn('警告信息', { reason: 'test' });
  logger.error('错误信息', { error: 'test' });
  
  // 测试性能追踪
  console.log('\n2. 测试性能追踪');
  const trace = logger.startTrace('testOperation', { id: 1 });
  await new Promise(resolve => setTimeout(resolve, 100));
  const duration = trace.end({ result: 'success' });
  console.log(`操作耗时: ${duration}ms`);
  
  // 测试状态管理
  console.log('\n3. 测试状态管理');
  recoveryManager.saveState(StateType.SESSION, 'test-session', {
    sessionId: 'session-123',
    title: '测试会话',
    messages: []
  });
  
  const sessionState = recoveryManager.getState(StateType.SESSION, 'test-session');
  console.log('保存的状态:', sessionState.state);
  
  // 创建检查点
  const checkpointId = recoveryManager.createCheckpoint('test-checkpoint');
  console.log('创建检查点:', checkpointId);
  
  // 测试统计信息
  console.log('\n4. 测试统计信息');
  const loggerMetrics = logger.getMetrics();
  console.log('日志指标:', loggerMetrics);
  
  const recoveryStats = recoveryManager.getStats();
  console.log('恢复统计:', recoveryStats);
  
  // 清理
  recoveryManager.cleanup();
  
  console.log('\n=== 测试完成 ===\n');
}

async function testKernelIPC() {
  console.log('\n=== 测试KernelIPC集成 ===\n');
  
  // 检查内核二进制是否存在
  const fs = require('fs');
  const kernelPath = '/home/fangpeng/projects/chenyi-kernel/target/release/chenyi-kernel';
  
  if (!fs.existsSync(kernelPath)) {
    console.log('内核二进制不存在，跳过IPC测试');
    console.log('请先编译内核: cd /home/fangpeng/projects/chenyi-kernel && cargo build --release');
    return;
  }
  
  const kernel = new KernelIPC({
    binaryPath: kernelPath,
    autoRestart: true,
    maxRestartAttempts: 3
  });
  
  // 监听事件
  kernel.on('ready', () => {
    console.log('✓ 内核已就绪');
  });
  
  kernel.on('error', (error) => {
    console.log('✗ 错误:', error.message, '类型:', error.type);
  });
  
  kernel.on('exit', (info) => {
    console.log('进程退出:', info);
  });
  
  // 启动内核
  console.log('启动内核...');
  kernel.start();
  
  // 等待就绪
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('启动超时'));
    }, 15000);
    
    kernel.once('ready', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
  
  // 测试健康检查
  console.log('\n测试健康检查...');
  try {
    const health = await kernel.health();
    console.log('✓ 健康检查成功:', health);
  } catch (err) {
    console.log('✗ 健康检查失败:', err.message);
  }
  
  // 测试会话创建
  console.log('\n测试会话创建...');
  try {
    const session = await kernel.createSession('测试会话');
    console.log('✓ 会话创建成功:', session);
  } catch (err) {
    console.log('✗ 会话创建失败:', err.message);
  }
  
  // 获取统计信息
  console.log('\n统计信息:');
  const stats = kernel.getStats();
  console.log('请求:', stats.requests);
  console.log('成功:', stats.successes);
  console.log('失败:', stats.failures);
  console.log('就绪:', stats.ready);
  
  // 停止内核
  console.log('\n停止内核...');
  kernel.stop();
  
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  console.log('\n=== IPC测试完成 ===\n');
}

// 运行测试
async function main() {
  try {
    await testBasicFeatures();
    await testKernelIPC();
  } catch (err) {
    console.error('测试失败:', err);
    process.exit(1);
  }
  
  process.exit(0);
}

main();