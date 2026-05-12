/**
 * 晨翼Agent - IPC压力测试套件
 * 
 * 测试高并发、网络不稳定、内核崩溃恢复等场景
 */

const KernelIPC = require('./kernel-ipc.js');
const { Logger, LogLevel } = require('./logger.js');
const { StateRecoveryManager, StateType, RecoveryStrategy } = require('./state-recovery.js');

// 测试配置
const TEST_CONFIG = {
  concurrency: {
    low: 10,
    medium: 50,
    high: 100
  },
  duration: {
    short: 10000,    // 10秒
    medium: 60000,   // 1分钟
    long: 300000     // 5分钟
  },
  network: {
    packetLoss: 0.1,  // 10%丢包率
    latency: 100,     // 100ms延迟
    jitter: 50        // 50ms抖动
  }
};

// 测试结果
class TestResult {
  constructor(name) {
    this.name = name;
    this.startTime = Date.now();
    this.endTime = null;
    this.passed = true;
    this.errors = [];
    this.metrics = {};
  }
  
  fail(error) {
    this.passed = false;
    this.errors.push({
      time: Date.now(),
      error: error.message || error,
      stack: error.stack
    });
  }
  
  complete(metrics = {}) {
    this.endTime = Date.now();
    this.duration = this.endTime - this.startTime;
    this.metrics = metrics;
  }
  
  toString() {
    const status = this.passed ? '✅ 通过' : '❌ 失败';
    const duration = this.duration ? `(${this.duration}ms)` : '';
    return `${status} ${this.name} ${duration}`;
  }
}

// 测试套件
class IPCTestSuite {
  constructor(options = {}) {
    this.kernel = options.kernel || new KernelIPC();
    this.logger = options.logger || new Logger({ name: 'TestSuite', level: LogLevel.INFO });
    this.recoveryManager = options.recoveryManager || new StateRecoveryManager();
    this.results = [];
    this.running = false;
  }
  
  /**
   * 运行所有测试
   */
  async runAll() {
    console.log('\n========================================');
    console.log('  IPC 压力测试套件');
    console.log('========================================\n');
    
    this.running = true;
    this.results = [];
    
    // 启动内核
    if (!this.kernel.isReady()) {
      console.log('启动内核...');
      this.kernel.start();
      await new Promise(resolve => this.kernel.once('ready', resolve));
    }
    
    // 运行测试
    const tests = [
      () => this.testBasicCommunication(),
      () => this.testHighConcurrency(),
      () => this.testTimeoutHandling(),
      () => this.testErrorRecovery(),
      () => this.testNetworkInstability(),
      () => this.testKernelRestart(),
      () => this.testStateRecovery(),
      () => this.testMemoryPressure()
    ];
    
    for (const test of tests) {
      if (!this.running) break;
      
      try {
        const result = await test();
        this.results.push(result);
        console.log(result.toString());
      } catch (err) {
        console.error('测试执行失败:', err.message);
        const result = new TestResult(test.name || 'Unknown');
        result.fail(err);
        this.results.push(result);
      }
      
      // 测试间短暂休息
      await this._sleep(1000);
    }
    
    // 生成报告
    this._generateReport();
    
    return this.results;
  }
  
  /**
   * 测试基础通信
   */
  async testBasicCommunication() {
    const result = new TestResult('基础通信测试');
    const metrics = { requests: 0, successes: 0, failures: 0 };
    
    try {
      // 健康检查
      const health = await this.kernel.health();
      if (!health.ok) {
        throw new Error('健康检查失败');
      }
      metrics.requests++;
      metrics.successes++;
      
      // 创建会话
      const session = await this.kernel.createSession('测试会话');
      if (!session.session_id) {
        throw new Error('会话创建失败');
      }
      metrics.requests++;
      metrics.successes++;
      
      // 发送消息
      const response = await this.kernel.chat('你好');
      if (!response) {
        throw new Error('消息发送失败');
      }
      metrics.requests++;
      metrics.successes++;
      
      // 列出会话
      const sessions = await this.kernel.listSessions();
      if (!Array.isArray(sessions)) {
        throw new Error('会话列表获取失败');
      }
      metrics.requests++;
      metrics.successes++;
      
      result.complete(metrics);
    } catch (err) {
      result.fail(err);
      result.complete(metrics);
    }
    
    return result;
  }
  
  /**
   * 测试高并发
   */
  async testHighConcurrency() {
    const result = new TestResult('高并发测试');
    const metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      avgResponseTime: 0,
      maxResponseTime: 0
    };
    
    try {
      const concurrency = TEST_CONFIG.concurrency.medium;
      const requestsPerBatch = 10;
      const batches = 5;
      
      const responseTimes = [];
      
      for (let batch = 0; batch < batches; batch++) {
        console.log(`  批次 ${batch + 1}/${batches}...`);
        
        const promises = [];
        for (let i = 0; i < concurrency; i++) {
          promises.push((async () => {
            const start = Date.now();
            try {
              await this.kernel.health();
              const duration = Date.now() - start;
              responseTimes.push(duration);
              return { success: true };
            } catch (err) {
              return { success: false, error: err };
            }
          })());
        }
        
        const results = await Promise.all(promises);
        
        for (const res of results) {
          metrics.totalRequests++;
          if (res.success) {
            metrics.successfulRequests++;
          } else {
            metrics.failedRequests++;
          }
        }
        
        await this._sleep(100);
      }
      
      if (responseTimes.length > 0) {
        metrics.avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
        metrics.maxResponseTime = Math.max(...responseTimes);
      }
      
      // 检查成功率
      const successRate = metrics.successfulRequests / metrics.totalRequests;
      if (successRate < 0.95) {
        throw new Error(`成功率过低: ${(successRate * 100).toFixed(2)}%`);
      }
      
      result.complete(metrics);
    } catch (err) {
      result.fail(err);
      result.complete(metrics);
    }
    
    return result;
  }
  
  /**
   * 测试超时处理
   */
  async testTimeoutHandling() {
    const result = new TestResult('超时处理测试');
    const metrics = { timeouts: 0, recovered: 0 };
    
    try {
      // 测试短超时
      try {
        await this.kernel.send('health', {}, { timeout: 1 }); // 1ms超时
      } catch (err) {
        if (err.type === 'TIMEOUT') {
          metrics.timeouts++;
        }
      }
      
      // 验证内核仍然可用
      const health = await this.kernel.health();
      if (health.ok) {
        metrics.recovered++;
      } else {
        throw new Error('超时后内核不可用');
      }
      
      result.complete(metrics);
    } catch (err) {
      result.fail(err);
      result.complete(metrics);
    }
    
    return result;
  }
  
  /**
   * 测试错误恢复
   */
  async testErrorRecovery() {
    const result = new TestResult('错误恢复测试');
    const metrics = { errors: 0, recovered: 0 };
    
    try {
      // 测试无效命令
      try {
        await this.kernel.send('invalid:command');
      } catch (err) {
        metrics.errors++;
      }
      
      // 测试无效参数
      try {
        await this.kernel.send('session:delete', { session_id: 'invalid-id' });
      } catch (err) {
        metrics.errors++;
      }
      
      // 验证内核仍然可用
      const health = await this.kernel.health();
      if (health.ok) {
        metrics.recovered++;
      }
      
      // 创建新会话验证
      const session = await this.kernel.createSession('恢复测试');
      if (session.session_id) {
        metrics.recovered++;
      }
      
      result.complete(metrics);
    } catch (err) {
      result.fail(err);
      result.complete(metrics);
    }
    
    return result;
  }
  
  /**
   * 测试网络不稳定
   */
  async testNetworkInstability() {
    const result = new TestResult('网络不稳定测试');
    const metrics = {
      attempts: 0,
      successes: 0,
      failures: 0,
      avgRetryTime: 0
    };
    
    try {
      // 模拟网络不稳定：快速连续请求
      const iterations = 50;
      const retryTimes = [];
      
      for (let i = 0; i < iterations; i++) {
        metrics.attempts++;
        
        try {
          const start = Date.now();
          await this.kernel.health();
          retryTimes.push(Date.now() - start);
          metrics.successes++;
        } catch (err) {
          metrics.failures++;
        }
        
        // 随机延迟模拟网络抖动
        await this._sleep(Math.random() * 100);
      }
      
      if (retryTimes.length > 0) {
        metrics.avgRetryTime = retryTimes.reduce((a, b) => a + b, 0) / retryTimes.length;
      }
      
      // 检查成功率
      const successRate = metrics.successes / metrics.attempts;
      if (successRate < 0.9) {
        throw new Error(`网络不稳定测试成功率过低: ${(successRate * 100).toFixed(2)}%`);
      }
      
      result.complete(metrics);
    } catch (err) {
      result.fail(err);
      result.complete(metrics);
    }
    
    return result;
  }
  
  /**
   * 测试内核重启
   */
  async testKernelRestart() {
    const result = new TestResult('内核重启测试');
    const metrics = { restarts: 0, recovered: 0 };
    
    try {
      // 获取初始统计
      const initialStats = this.kernel.getStats();
      
      // 触发重启（通过发送exit命令）
      console.log('  触发内核重启...');
      this.kernel.stop();
      metrics.restarts++;
      
      // 等待重启
      await this._sleep(2000);
      
      // 重新启动
      this.kernel.start();
      await new Promise(resolve => {
        const timeout = setTimeout(() => {
          throw new Error('重启超时');
        }, 10000);
        
        this.kernel.once('ready', () => {
          clearTimeout(timeout);
          resolve();
        });
      });
      
      // 验证可用性
      const health = await this.kernel.health();
      if (health.ok) {
        metrics.recovered++;
      } else {
        throw new Error('重启后内核不可用');
      }
      
      result.complete(metrics);
    } catch (err) {
      result.fail(err);
      result.complete(metrics);
    }
    
    return result;
  }
  
  /**
   * 测试状态恢复
   */
  async testStateRecovery() {
    const result = new TestResult('状态恢复测试');
    const metrics = { statesSaved: 0, statesRecovered: 0 };
    
    try {
      // 初始化恢复管理器
      this.recoveryManager.initialize();
      
      // 保存一些状态
      this.recoveryManager.saveState(StateType.SESSION, 'test-session', {
        sessionId: 'test-123',
        title: '测试会话',
        messages: []
      });
      metrics.statesSaved++;
      
      this.recoveryManager.saveState(StateType.USER_CONTEXT, 'test-user', {
        userId: 'user-123',
        preferences: { theme: 'dark' }
      });
      metrics.statesSaved++;
      
      // 创建检查点
      const checkpointId = this.recoveryManager.createCheckpoint('test-checkpoint');
      
      // 模拟状态丢失
      this.recoveryManager.deleteState(StateType.SESSION, 'test-session');
      
      // 恢复到检查点
      this.recoveryManager.restoreCheckpoint(checkpointId);
      
      // 验证恢复
      const sessionState = this.recoveryManager.getState(StateType.SESSION, 'test-session');
      if (sessionState && sessionState.state.sessionId === 'test-123') {
        metrics.statesRecovered++;
      }
      
      const userState = this.recoveryManager.getState(StateType.USER_CONTEXT, 'test-user');
      if (userState && userState.state.userId === 'user-123') {
        metrics.statesRecovered++;
      }
      
      if (metrics.statesRecovered !== metrics.statesSaved) {
        throw new Error('状态恢复不完整');
      }
      
      // 清理
      this.recoveryManager.cleanup();
      
      result.complete(metrics);
    } catch (err) {
      result.fail(err);
      result.complete(metrics);
    }
    
    return result;
  }
  
  /**
   * 测试内存压力
   */
  async testMemoryPressure() {
    const result = new TestResult('内存压力测试');
    const metrics = {
      operations: 0,
      memoryBefore: 0,
      memoryAfter: 0,
      memoryIncrease: 0
    };
    
    try {
      // 记录初始内存
      const memoryBefore = process.memoryUsage();
      metrics.memoryBefore = memoryBefore.heapUsed;
      
      // 执行大量操作
      const iterations = 100;
      for (let i = 0; i < iterations; i++) {
        await this.kernel.health();
        metrics.operations++;
        
        // 每10次检查一次内存
        if (i % 10 === 0) {
          const current = process.memoryUsage();
          const increase = current.heapUsed - metrics.memoryBefore;
          
          // 如果内存增长超过100MB，可能存在泄漏
          if (increase > 100 * 1024 * 1024) {
            console.warn(`  警告: 内存增长过快 (${(increase / 1024 / 1024).toFixed(2)}MB)`);
          }
        }
      }
      
      // 记录最终内存
      const memoryAfter = process.memoryUsage();
      metrics.memoryAfter = memoryAfter.heapUsed;
      metrics.memoryIncrease = metrics.memoryAfter - metrics.memoryBefore;
      
      // 检查内存增长是否合理
      const increaseMB = metrics.memoryIncrease / 1024 / 1024;
      if (increaseMB > 50) {
        console.warn(`  内存增长: ${increaseMB.toFixed(2)}MB`);
      }
      
      result.complete(metrics);
    } catch (err) {
      result.fail(err);
      result.complete(metrics);
    }
    
    return result;
  }
  
  /**
   * 生成测试报告
   */
  _generateReport() {
    console.log('\n========================================');
    console.log('  测试报告');
    console.log('========================================\n');
    
    const passed = this.results.filter(r => r.passed).length;
    const failed = this.results.filter(r => !r.passed).length;
    
    console.log(`总计: ${this.results.length} 个测试`);
    console.log(`通过: ${passed} 个`);
    console.log(`失败: ${failed} 个`);
    console.log(`成功率: ${(passed / this.results.length * 100).toFixed(2)}%\n`);
    
    if (failed > 0) {
      console.log('失败的测试:');
      for (const result of this.results.filter(r => !r.passed)) {
        console.log(`  - ${result.name}`);
        for (const err of result.errors) {
          console.log(`    错误: ${err.error}`);
        }
      }
      console.log('');
    }
    
    // 详细指标
    console.log('详细指标:');
    for (const result of this.results) {
      console.log(`\n${result.name}:`);
      for (const [key, value] of Object.entries(result.metrics)) {
        if (typeof value === 'number') {
          console.log(`  ${key}: ${value.toLocaleString()}`);
        } else {
          console.log(`  ${key}: ${value}`);
        }
      }
    }
    
    console.log('\n========================================\n');
  }
  
  /**
   * 停止测试
   */
  stop() {
    this.running = false;
  }
  
  /**
   * 异步延迟
   */
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// 运行测试
async function main() {
  const suite = new IPCTestSuite();
  
  // 处理中断
  process.on('SIGINT', () => {
    console.log('\n测试中断');
    suite.stop();
    process.exit(0);
  });
  
  try {
    await suite.runAll();
  } catch (err) {
    console.error('测试套件执行失败:', err);
    process.exit(1);
  }
  
  process.exit(0);
}

// 如果直接运行
if (require.main === module) {
  main();
}

module.exports = { IPCTestSuite, TestResult, TEST_CONFIG };
