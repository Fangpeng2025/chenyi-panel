/**
 * 简化IPC测试 - 验证错误处理改进
 */

const KernelIPC = require('./src/main/kernel-ipc');
const path = require('path');

const kernelPath = path.join(__dirname, '../chenyi-kernel/target/release/chenyi-kernel');
const ipc = new KernelIPC({ 
  binaryPath: kernelPath,
  maxRestartAttempts: 0
});

console.log('🧪 测试IPC错误处理改进...\n');

ipc.start();

ipc.on('ready', async () => {
  console.log('✅ 内核就绪');
  
  try {
    // 测试健康检查
    console.log('\n测试健康检查...');
    const health = await ipc.health();
    console.log('✅ 健康检查成功:', health);
    
    // 测试统计信息
    console.log('\n测试统计信息...');
    const stats = ipc.getStats();
    console.log('✅ 统计信息:', JSON.stringify(stats, null, 2));
    
    // 测试列出会话
    console.log('\n测试列出会话...');
    const sessions = await ipc.listSessions();
    console.log('✅ 会话列表:', sessions);
    
    console.log('\n✅ 所有测试通过！');
    ipc.stop();
    process.exit(0);
  } catch (err) {
    console.error('❌ 测试失败:', err.message);
    console.error('   错误类型:', err.type);
    console.error('   错误详情:', err.details);
    ipc.stop();
    process.exit(1);
  }
});

ipc.on('error', (err) => {
  console.error('❌ 内核错误:', err.message);
  console.error('   错误类型:', err.type);
});

setTimeout(() => {
  console.log('⏰ 测试超时');
  ipc.stop();
  process.exit(1);
}, 20000);