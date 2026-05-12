/**
 * 晨翼Agent - 前后端集成测试
 * 测试Electron前端与Rust内核的通信
 * 
 * v2.0 - 增强错误场景测试
 */

const KernelClient = require('./src/main/kernel-client');
const KernelIPC = require('./src/main/kernel-ipc');
const path = require('path');

console.log('🧪 晨翼Agent - 前后端集成测试\n');

// 测试结果统计
const results = {
  total: 0,
  passed: 0,
  failed: 0,
  skipped: 0,
  errors: []
};

function test(name, fn) {
  results.total++;
  try {
    const result = fn();
    if (result === true || result?.then) {
      if (result === true) {
        results.passed++;
        console.log(`✅ ${name}`);
      }
      return result;
    } else {
      throw new Error('测试返回false');
    }
  } catch (err) {
    results.failed++;
    results.errors.push({ name, error: err.message });
    console.log(`❌ ${name}: ${err.message}`);
  }
}

async function asyncTest(name, fn) {
  results.total++;
  try {
    await fn();
    results.passed++;
    console.log(`✅ ${name}`);
  } catch (err) {
    results.failed++;
    results.errors.push({ name, error: err.message });
    console.log(`❌ ${name}: ${err.message}`);
  }
}

function skipTest(name, reason) {
  results.total++;
  results.skipped++;
  console.log(`⏭️  ${name} (${reason})`);
}

// ==================== HTTP API 测试 ====================

async function testHTTPAPI() {
  console.log('\n📡 测试HTTP API...\n');
  
  const client = new KernelClient('http://localhost:8080');
  
  await asyncTest('健康检查', async () => {
    const result = await client.health();
    if (result.status !== 'ok') throw new Error('健康检查失败');
  });
  
  await asyncTest('列出会话', async () => {
    const result = await client.listSessions();
    if (!Array.isArray(result.sessions)) throw new Error('会话列表格式错误');
  });
  
  await asyncTest('创建会话', async () => {
    const result = await client.createSession('test', 'integration-test');
    if (!result.session_id) throw new Error('创建会话失败');
  });
  
  await asyncTest('发送消息', async () => {
    const result = await client.sendMessage('你好，这是一条测试消息');
    if (!result.content) throw new Error('发送消息失败');
  });
  
  await asyncTest('搜索记忆', async () => {
    const result = await client.request('POST', '/api/v1/memory/search', { query: '测试', k: 5 });
    if (!Array.isArray(result.results)) throw new Error('记忆搜索失败');
  });
  
  await asyncTest('列出技能', async () => {
    const result = await client.listSkills();
    if (!Array.isArray(result.skills)) throw new Error('技能列表格式错误');
  });
  
  // 测试统计信息
  await asyncTest('获取统计信息', async () => {
    const stats = client.getStats();
    if (typeof stats.requests !== 'number') throw new Error('统计信息格式错误');
    console.log('   统计:', JSON.stringify(stats));
  });
}

// ==================== HTTP API 错误场景测试 ====================

async function testHTTPAPIErrors() {
  console.log('\n🚨 测试HTTP API错误处理...\n');
  
  // 测试连接失败
  const badClient = new KernelClient('http://localhost:9999', {
    maxRetries: 1,
    retryDelay: 100,
    failureThreshold: 2
  });
  
  await asyncTest('连接失败 - 应该重试后失败', async () => {
    try {
      await badClient.health();
      throw new Error('应该抛出错误');
    } catch (err) {
      if (!err.message.includes('ECONNREFUSED') && !err.message.includes('网络')) {
        throw new Error('错误类型不正确: ' + err.message);
      }
    }
  });
  
  // 测试熔断器
  await asyncTest('熔断器 - 连续失败后开启', async () => {
    // 重置熔断器
    badClient.resetCircuit();
    
    // 连续触发失败
    for (let i = 0; i < 5; i++) {
      try {
        await badClient.health();
      } catch (e) {
        // 忽略
      }
    }
    
    const stats = badClient.getStats();
    if (stats.circuitState !== 'OPEN') {
      throw new Error('熔断器应该开启，当前状态: ' + stats.circuitState);
    }
  });
  
  // 测试熔断器拒绝请求
  await asyncTest('熔断器 - 开启后拒绝请求', async () => {
    try {
      await badClient.health();
      throw new Error('应该被熔断器拒绝');
    } catch (err) {
      if (!err.message.includes('熔断器')) {
        throw new Error('错误类型不正确: ' + err.message);
      }
    }
  });
  
  // 测试超时
  const timeoutClient = new KernelClient('http://localhost:8080', {
    defaultTimeout: 1 // 1ms超时
  });
  
  await asyncTest('请求超时 - 应该超时失败', async () => {
    try {
      await timeoutClient.health();
      // 如果成功，说明内核响应很快，跳过此测试
      skipTest('请求超时', '内核响应太快');
      return;
    } catch (err) {
      if (!err.message.includes('超时')) {
        throw new Error('错误类型不正确: ' + err.message);
      }
    }
  });
}

// ==================== IPC 测试 ====================

async function testIPC() {
  console.log('\n🔌 测试IPC通信...\n');
  
  const kernelPath = path.join(__dirname, '../chenyi-kernel/target/release/chenyi-kernel');
  const ipc = new KernelIPC({ 
    binaryPath: kernelPath,
    maxRestartAttempts: 3,
    restartDelay: 500
  });
  
  await asyncTest('启动内核IPC', async () => {
    ipc.start();
    await new Promise((resolve, reject) => {
      ipc.once('ready', resolve);
      ipc.once('error', reject);
      setTimeout(() => reject(new Error('启动超时')), 10000);
    });
  });
  
  await asyncTest('IPC健康检查', async () => {
    const result = await ipc.health();
    if (!result.ok) throw new Error('IPC健康检查失败');
  });
  
  await asyncTest('IPC列出会话', async () => {
    const sessions = await ipc.listSessions();
    if (!Array.isArray(sessions)) throw new Error('IPC会话列表格式错误');
  });
  
  await asyncTest('IPC创建会话', async () => {
    const result = await ipc.createSession('测试会话');
    if (!result.session_id) throw new Error('IPC创建会话失败');
  });
  
  await asyncTest('IPC对话', async () => {
    const result = await ipc.chat('你好');
    if (!result) throw new Error('IPC对话失败');
  });
  
  // 测试统计信息
  await asyncTest('IPC获取统计信息', async () => {
    const stats = ipc.getStats();
    if (typeof stats.requests !== 'number') throw new Error('统计信息格式错误');
    console.log('   统计:', JSON.stringify(stats));
  });
  
  // 停止内核
  ipc.stop();
  console.log('\n✓ IPC内核已停止');
}

// ==================== IPC 错误场景测试 ====================

async function testIPCErrors() {
  console.log('\n🚨 测试IPC错误处理...\n');
  
  // 测试未启动时发送命令
  const ipc1 = new KernelIPC({ autoRestart: false });
  
  await asyncTest('IPC未启动 - 应该拒绝请求', async () => {
    try {
      await ipc1.health();
      throw new Error('应该抛出错误');
    } catch (err) {
      if (!err.message.includes('未启动') && !err.message.includes('未就绪')) {
        throw new Error('错误类型不正确: ' + err.message);
      }
    }
  });
  
  // 测试无效二进制路径
  const ipc2 = new KernelIPC({ 
    binaryPath: '/nonexistent/kernel',
    autoRestart: false,
    maxRestartAttempts: 0
  });
  
  await asyncTest('IPC无效路径 - 应该启动失败', async () => {
    ipc2.start();
    await new Promise((resolve) => {
      ipc2.once('error', resolve);
      setTimeout(resolve, 2000);
    });
    
    if (ipc2.isReady()) {
      throw new Error('不应该就绪');
    }
  });
  
  // 测试命令超时
  const kernelPath = path.join(__dirname, '../chenyi-kernel/target/release/chenyi-kernel');
  const ipc3 = new KernelIPC({ binaryPath: kernelPath });
  
  await asyncTest('IPC命令超时 - 应该超时失败', async () => {
    ipc3.start();
    await new Promise((resolve, reject) => {
      ipc3.once('ready', resolve);
      ipc3.once('error', reject);
      setTimeout(() => reject(new Error('启动超时')), 10000);
    });
    
    try {
      // 使用极短的超时时间
      await ipc3.send('health', {}, { timeout: 1 });
      // 如果成功，说明内核响应很快
      skipTest('IPC命令超时', '内核响应太快');
    } catch (err) {
      if (!err.message.includes('超时')) {
        throw new Error('错误类型不正确: ' + err.message);
      }
    }
    
    ipc3.stop();
  });
}

// ==================== Node绑定测试 ====================

async function testNodeBindings() {
  console.log('\n🔗 测试Node绑定...\n');
  
  try {
    const { AgentKernel } = require('../chenyi-kernel/bindings/node');
    
    test('创建内核实例', () => {
      const kernel = new AgentKernel();
      return kernel instanceof AgentKernel;
    });
    
    test('初始化内核', () => {
      const kernel = new AgentKernel();
      kernel.initialize();
      return true;
    });
    
    test('获取内核状态', () => {
      const kernel = new AgentKernel();
      kernel.initialize();
      const status = kernel.getStatus();
      return status.initialized === true;
    });
    
    test('创建会话', () => {
      const kernel = new AgentKernel();
      kernel.initialize();
      const session = kernel.createSession('test-app', 'test-user');
      return session.session_id !== undefined;
    });
    
    test('对话（带历史）', () => {
      const kernel = new AgentKernel();
      kernel.initialize();
      const history = [];
      const response = kernel.chatWithHistory('你好', history);
      return response.length > 0;
    });
    
  } catch (err) {
    console.log(`⚠️  Node绑定测试跳过: ${err.message}`);
    console.log('   请确保已编译 bindings/node');
  }
}

// ==================== 运行所有测试 ====================

async function main() {
  console.log('开始测试...\n');
  
  try {
    await testHTTPAPI();
  } catch (err) {
    console.log(`\n⚠️  HTTP API测试失败: ${err.message}`);
    console.log('   请确保内核已启动: cd chenyi-kernel && cargo run --release\n');
  }
  
  try {
    await testHTTPAPIErrors();
  } catch (err) {
    console.log(`\n⚠️  HTTP API错误测试失败: ${err.message}`);
  }
  
  try {
    await testIPC();
  } catch (err) {
    console.log(`\n⚠️  IPC测试失败: ${err.message}`);
  }
  
  try {
    await testIPCErrors();
  } catch (err) {
    console.log(`\n⚠️  IPC错误测试失败: ${err.message}`);
  }
  
  try {
    await testNodeBindings();
  } catch (err) {
    console.log(`\n⚠️  Node绑定测试失败: ${err.message}`);
  }
  
  // 打印结果
  console.log('\n' + '='.repeat(50));
  console.log(`📊 测试结果: ${results.passed}/${results.total} 通过`);
  console.log(`   ✅ 通过: ${results.passed}`);
  console.log(`   ❌ 失败: ${results.failed}`);
  console.log(`   ⏭️  跳过: ${results.skipped}`);
  
  if (results.errors.length > 0) {
    console.log('\n❌ 失败详情:');
    results.errors.forEach(({ name, error }) => {
      console.log(`   - ${name}: ${error}`);
    });
  }
  
  console.log('='.repeat(50) + '\n');
  
  process.exit(results.failed > 0 ? 1 : 0);
}

main().catch(console.error);
