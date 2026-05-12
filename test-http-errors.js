/**
 * 测试HTTP客户端错误处理改进
 */

const KernelClient = require('./src/main/kernel-client');

console.log('🧪 测试HTTP客户端错误处理改进...\n');

async function testCircuitBreaker() {
  console.log('📊 测试熔断器...\n');
  
  const client = new KernelClient('http://localhost:9999', {
    maxRetries: 1,
    retryDelay: 100,
    failureThreshold: 3,
    circuitTimeout: 5000
  });
  
  // 触发失败
  console.log('触发失败...');
  for (let i = 0; i < 3; i++) {
    try {
      await client.health();
    } catch (e) {
      console.log(`  失败 ${i + 1}: ${e.message}`);
    }
  }
  
  const stats = client.getStats();
  console.log('\n统计信息:', JSON.stringify(stats, null, 2));
  
  if (stats.circuitState === 'OPEN') {
    console.log('✅ 熔断器已开启');
  } else {
    console.log('❌ 熔断器未开启');
    return false;
  }
  
  // 测试熔断器拒绝
  console.log('\n测试熔断器拒绝请求...');
  try {
    await client.health();
    console.log('❌ 应该被熔断器拒绝');
    return false;
  } catch (e) {
    if (e.message.includes('熔断器')) {
      console.log('✅ 熔断器正确拒绝:', e.message);
    } else {
      console.log('❌ 错误类型不正确:', e.message);
      return false;
    }
  }
  
  // 重置熔断器
  console.log('\n重置熔断器...');
  client.resetCircuit();
  const stats2 = client.getStats();
  console.log('状态:', stats2.circuitState);
  
  if (stats2.circuitState === 'CLOSED') {
    console.log('✅ 熔断器已重置');
  } else {
    console.log('❌ 熔断器重置失败');
    return false;
  }
  
  return true;
}

async function testRetry() {
  console.log('\n📊 测试重试机制...\n');
  
  const client = new KernelClient('http://localhost:9999', {
    maxRetries: 2,
    retryDelay: 50
  });
  
  console.log('发送请求（应该重试2次）...');
  try {
    await client.health();
    console.log('❌ 应该失败');
    return false;
  } catch (e) {
    const stats = client.getStats();
    console.log('重试次数:', stats.retries);
    
    if (stats.retries >= 2) {
      console.log('✅ 重试机制正常工作');
      return true;
    } else {
      console.log('❌ 重试次数不足');
      return false;
    }
  }
}

async function main() {
  try {
    const result1 = await testCircuitBreaker();
    const result2 = await testRetry();
    
    console.log('\n' + '='.repeat(50));
    if (result1 && result2) {
      console.log('✅ 所有测试通过！');
      process.exit(0);
    } else {
      console.log('❌ 部分测试失败');
      process.exit(1);
    }
  } catch (err) {
    console.error('❌ 测试异常:', err);
    process.exit(1);
  }
}

main();