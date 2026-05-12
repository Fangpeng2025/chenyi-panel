/**
 * Agent 内核集成测试
 * 在 Electron 中测试 Agent 功能
 */

// 测试配置
const testConfig = {
  provider: {
    name: 'minimax',
    baseURL: 'https://api.minimax.chat/v1',
    apiKey: process.env.MINIMAX_API_KEY || 'test-key',
    models: [{
      id: 'MiniMax-M2.7',
      name: 'MiniMax M2.7',
      contextWindow: 200000,
      maxTokens: 16384
    }]
  },
  model: 'MiniMax-M2.7',
  maxTokens: 128000,
  systemPrompt: '你是晨翼Agent，一个智能助手。请用中文回答问题。',
  memoryPath: './test-memory'
};

// 测试函数
async function testAgent() {
  console.log('=== Agent 内核集成测试 ===\n');

  const AgentService = require('./src/agent');

  // 1. 初始化测试
  console.log('1. 初始化 Agent...');
  const initResult = await AgentService.initialize(testConfig);
  console.log('   结果:', initResult);

  if (!initResult.success) {
    console.error('初始化失败:', initResult.error);
    return;
  }

  // 2. 获取状态测试
  console.log('\n2. 获取 Agent 状态...');
  const state = AgentService.getState();
  console.log('   状态:', JSON.stringify(state, null, 2));

  // 3. 对话测试（需要真实 API Key）
  if (process.env.MINIMAX_API_KEY) {
    console.log('\n3. 测试对话...');
    const response = await AgentService.chat('你好，请自我介绍');
    console.log('   响应:', response);
  } else {
    console.log('\n3. 跳过对话测试（未设置 MINIMAX_API_KEY）');
  }

  // 4. 记忆测试
  console.log('\n4. 测试记忆管理...');
  await AgentService.updateMemory('# 测试记忆\n\n这是一个测试。');
  const memory = AgentService.getMemory();
  console.log('   记忆内容:', memory ? '已设置' : '空');

  // 5. 清理
  console.log('\n5. 清理...');
  AgentService.destroy();
  console.log('   完成');

  console.log('\n=== 测试完成 ===');
}

// 运行测试
testAgent().catch(console.error);
