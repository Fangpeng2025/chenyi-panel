/**
 * 晨翼Agent - 工具调用模块
 * 处理 Function Calling 和工具执行
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const { execSync } = require('child_process');

// 定义工具
const TOOLS = [
  { type: 'function', function: { name: 'web_search', description: '搜索互联网', parameters: { type: 'object', properties: { query: { type: 'string', description: '搜索关键词' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'read_file', description: '读取文件', parameters: { type: 'object', properties: { path: { type: 'string', description: '文件路径' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'write_file', description: '写入文件', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } } },
  { type: 'function', function: { name: 'execute_command', description: '执行命令', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } } },
  { type: 'function', function: { name: 'http_request', description: 'HTTP请求', parameters: { type: 'object', properties: { url: { type: 'string' }, method: { type: 'string', enum: ['GET', 'POST'] } }, required: ['url'] } } },
];

// 工具执行器
const TOOL_EXECUTORS = {
  web_search: async (args) => {
    const query = encodeURIComponent(args.query);
    const searchUrl = `https://api.duckduckgo.com/?q=${query}&format=json&no_html=1`;
    return await new Promise((resolve) => {
      https.get(searchUrl, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const j = JSON.parse(data);
            resolve(j.Abstract || j.RelatedTopics?.[0]?.Text || '未找到结果');
          } catch { resolve('搜索失败'); }
        });
      }).on('error', () => resolve('搜索失败'));
    });
  },
  
  read_file: (args) => {
    try {
      return fs.readFileSync(args.path, 'utf-8').slice(0, 5000);
    } catch (e) {
      return `读取失败: ${e.message}`;
    }
  },
  
  write_file: (args) => {
    try {
      fs.writeFileSync(args.path, args.content);
      return '写入成功';
    } catch (e) {
      return `写入失败: ${e.message}`;
    }
  },
  
  execute_command: (args) => {
    try {
      return execSync(args.command, { encoding: 'utf-8', timeout: 10000 }).slice(0, 3000);
    } catch (e) {
      return `执行失败: ${e.message}`;
    }
  },
  
  http_request: async (args) => {
    return await new Promise((resolve) => {
      const u = new URL(args.url);
      const client = u.protocol === 'https:' ? https : http;
      client.get(args.url, (res) => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => resolve(d.slice(0, 3000)));
      }).on('error', e => resolve(`请求失败: ${e.message}`));
    });
  },
};

/**
 * 执行工具
 */
async function executeTool(toolName, args) {
  const executor = TOOL_EXECUTORS[toolName];
  if (!executor) {
    return `未知工具: ${toolName}`;
  }
  
  try {
    return await executor(args);
  } catch (e) {
    return `工具执行失败: ${e.message}`;
  }
}

/**
 * 发送 LLM 请求
 */
async function sendLLMRequest(config, messages, useTools = true) {
  const url = new URL(config.baseURL + '/chat/completions');
  const isHttps = url.protocol === 'https:';
  const lib = isHttps ? https : http;
  
  const body = JSON.stringify({
    model: config.model,
    messages,
    tools: useTools ? TOOLS : undefined,
    tool_choice: useTools ? 'auto' : undefined,
    temperature: config.temperature,
    max_tokens: Math.min(config.maxTokens, 4096),
  });
  
  return await new Promise((resolve) => {
    const req = lib.request({
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve({ error: '解析失败' });
        }
      });
    }).on('error', e => resolve({ error: e.message }));
    req.write(body);
    req.end();
  });
}

/**
 * 运行 Agent 对话（带工具调用）
 */
async function runAgentChat(config, userMessage) {
  // 对话历史
  const messages = [
    { role: 'system', content: '你是晨翼Agent。根据用户需求调用工具，执行完成后给出简洁回复。不要重复调用同一工具。' },
    { role: 'user', content: userMessage }
  ];
  
  // 最多 3 次工具调用
  const maxToolCalls = 3;
  let toolCallCount = 0;
  
  while (toolCallCount < maxToolCalls) {
    const result = await sendLLMRequest(config, messages, toolCallCount < maxToolCalls);
    
    if (result.error) {
      return { success: false, error: result.error };
    }
    
    if (!result.choices?.[0]) {
      return { success: false, error: '无响应' };
    }
    
    const choice = result.choices[0];
    
    // 检查是否有工具调用
    if (choice.message?.tool_calls && choice.message.tool_calls.length > 0) {
      // 添加助手消息
      messages.push(choice.message);
      
      // 执行每个工具
      for (const tc of choice.message.tool_calls) {
        const fnName = tc.function.name;
        const args = JSON.parse(tc.function.arguments || '{}');
        
        // 执行工具
        const toolResult = await executeTool(fnName, args);
        
        // 添加工具结果
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: String(toolResult)
        });
        
        toolCallCount++;
      }
      
      // 继续让模型处理工具结果
      continue;
    }
    
    // 没有工具调用，返回最终结果
    return {
      success: true,
      message: choice.message?.content || '',
      usage: result.usage,
    };
  }
  
  // 超过最大次数，强制获取最终回复（不带工具）
  const finalResult = await sendLLMRequest(config, messages, false);
  
  if (finalResult.error) {
    return { success: false, error: finalResult.error };
  }
  
  return {
    success: true,
    message: finalResult.choices?.[0]?.message?.content || '',
    usage: finalResult.usage,
  };
}

module.exports = {
  TOOLS,
  TOOL_EXECUTORS,
  executeTool,
  sendLLMRequest,
  runAgentChat,
};