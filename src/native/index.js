/**
 * 晨翼Agent Rust 内核 - Electron 集成
 */

const path = require('path');
const http = require('http');
const { Worker } = require('worker_threads');

// Worker 实例
let worker = null;
let requestId = 0;
const pendingRequests = new Map();

class RustKernel {
  constructor() {
    this.initialized = false;
    this.cloudConfig = null;
  }
  
  async initialize(config = {}) {
    try {
      // 创建 Worker
      const workerPath = path.join(__dirname, 'kernel-worker.js');
      console.log('[Kernel] Worker路径:', workerPath);
      worker = new Worker(workerPath);
      
      // 监听 Worker 消息
      worker.on('message', (data) => {
        console.log('[Kernel] Worker消息:', data);
        const { id, success, result, error } = data;
        const pending = pendingRequests.get(id);
        if (pending) {
          pendingRequests.delete(id);
          if (success) {
            pending.resolve(result);
          } else {
            pending.reject(new Error(error));
          }
        }
      });
      
      worker.on('error', (err) => {
        console.error('[Kernel Worker] 错误:', err);
      });
      
      worker.on('exit', (code) => {
        console.log('[Kernel Worker] 退出, code:', code);
      });
      
      // 初始化内核
      console.log('[Kernel] 发送初始化请求...');
      await this.sendRequest('initialize', {});
      this.initialized = true;
      
      // 自动设置云端配置
      const isDev = process.env.NODE_ENV === 'development';
      const cloudUrl = isDev 
        ? 'http://localhost:3002/api'
        : 'https://chenyi.xintiandi.online/cloud/api';
      this.setCloudConfig(cloudUrl);
      
      console.log('✓ Rust 内核初始化成功');
      return true;
    } catch (err) {
      console.error('Rust 内核初始化失败:', err);
      return false;
    }
  }
  
  // 发送请求到 Worker
  sendRequest(action, args) {
    return new Promise((resolve, reject) => {
      const id = ++requestId;
      pendingRequests.set(id, { resolve, reject });
      worker.postMessage({ id, action, args });
    });
  }
  
  // ==================== LLM ====================
  
  async chat(message) {
    if (!this.kernel || !this.initialized) {
      throw new Error('内核未初始化');
    }
    return await this.kernel.chat(message);
  }
  
  // 使用外部消息历史进行对话（云端同步模式）
  async chatWithHistory(message, history, options = {}) {
    if (!this.initialized) {
      throw new Error('内核未初始化');
    }
    const { model, thinking, enableTools } = options;
    console.log('[Kernel] chatWithHistory 调用, message:', message.substring(0, 50));
    try {
      const result = await this.sendRequest('chatWithTools', {
        message,
        history,
        model,
        thinking,
        enableTools
      });
      console.log('[Kernel] chatWithHistory 结果:', JSON.stringify(result).substring(0, 100));
      return result;
    } catch (e) {
      console.error('[Kernel] chatWithHistory 错误:', e);
      throw e;
    }
  }
  
  // 流式聊天 - 返回EventEmitter
  chatStream(message, history, options = {}) {
    const EventEmitter = require('events');
    const emitter = new EventEmitter();
    const { model, enableTools } = options;
    
    // 立即触发start事件
    setTimeout(() => emitter.emit('start'), 0);
    
    // 使用OneAPI的流式接口
    const https = require('https');
    const http = require('http');
    
    const apiUrl = 'https://oneapi.xintiandi.online/v1/chat/completions';
    const apiKey = 'sk-5YiHUyQuJ0HFYRbh213e114b31934618969760834dFaC6Be';
    
    // 构建消息
    const messages = history.map(h => ({
      role: h.role,
      content: h.content
    }));
    messages.push({ role: 'user', content: message });
    
    // 工具定义
    const tools = this.getToolDefinitions(enableTools);
    
    const body = {
      model: model || 'glm-5',
      messages,
      temperature: 0.7,
      max_tokens: 4096,
      stream: true,
      tools: tools.length > 0 ? tools : undefined
    };
    
    console.log('[Kernel] chatStream请求: messages=' + messages.length + '条, tools=' + (tools.length > 0 ? 'enabled' : 'disabled'));
    
    const url = new URL(apiUrl);
    const isHttps = url.protocol === 'https:';
    const httpModule = isHttps ? https : http;
    
    const req = httpModule.request({
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      }
    }, (res) => {
      let buffer = '';
      let toolCallsAccumulator = {}; // 累积工具调用参数
      
      res.on('data', (chunk) => {
        buffer += chunk.toString();
        
        // 处理完整的SSE行
        let lines = buffer.split('\n');
        buffer = lines.pop() || ''; // 保留不完整的行
        
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue;
          
          if (trimmed.startsWith('data: ')) {
            const data = trimmed.slice(6);
            if (data === '[DONE]') {
              console.log('[Kernel] 流式结束 [DONE]');
              emitter.emit('done');
              return;
            }
            
            try {
              const json = JSON.parse(data);
              const delta = json.choices?.[0]?.delta;
              const finishReason = json.choices?.[0]?.finish_reason;
              
              // 处理思考内容（GLM-5的reasoning_content）
              if (delta?.reasoning_content) {
                emitter.emit('thinking_delta', delta.reasoning_content);
              }
              
              // 处理正式回复内容
              if (delta?.content) {
                emitter.emit('text_delta', delta.content);
              }
              
              // 处理工具调用 - 累积参数
              if (delta?.tool_calls) {
                for (const tc of delta.tool_calls) {
                  const idx = tc.index || 0;
                  if (!toolCallsAccumulator[idx]) {
                    toolCallsAccumulator[idx] = {
                      id: tc.id,
                      name: '',
                      arguments: ''
                    };
                  }
                  if (tc.id) toolCallsAccumulator[idx].id = tc.id;
                  if (tc.function?.name) toolCallsAccumulator[idx].name = tc.function.name;
                  if (tc.function?.arguments) toolCallsAccumulator[idx].arguments += tc.function.arguments;
                  
                  emitter.emit('tool_call_delta', {
                    index: idx,
                    name: toolCallsAccumulator[idx].name,
                    arguments: toolCallsAccumulator[idx].arguments
                  });
                }
              }
              
              // 如果有工具调用完成（finish_reason === 'tool_calls'）
              if (finishReason === 'tool_calls') {
                console.log('[Kernel] 工具调用完成，准备执行');
                emitter.emit('tool_calls_ready', Object.values(toolCallsAccumulator));
                // 不触发done，等待工具执行完成后继续
                return;
              }
            } catch (e) {
              // 忽略解析错误
            }
          }
        }
      });
      
      res.on('end', () => {
        console.log('[Kernel] HTTP响应结束');
        // 只有在没有工具调用时才触发done
        if (Object.keys(toolCallsAccumulator).length === 0) {
          emitter.emit('done');
        }
      });
      
      res.on('error', (err) => {
        emitter.emit('error', err);
      });
    });
    
    req.on('error', (err) => {
      console.error('[Kernel] 请求错误:', err.message);
      emitter.emit('error', err);
    });
    
    req.on('response', (res) => {
      console.log('[Kernel] 响应状态:', res.statusCode);
    });
    
    req.write(JSON.stringify(body));
    req.end();
    
    return emitter;
  }
  
  // ==================== 记忆 ====================
  
  async searchMemory(query, k = 10) {
    if (!this.kernel || !this.initialized) {
      throw new Error('内核未初始化');
    }
    return await this.kernel.searchMemory(query, k);
  }
  
  // ==================== 工具 ====================
  
  async executeTool(toolName, params) {
    if (!this.initialized) {
      throw new Error('内核未初始化');
    }
    
    console.log('[Kernel] 执行工具:', toolName, JSON.stringify(params).substring(0, 100));
    
    try {
      const result = await this.sendRequest('executeTool', { toolName, params: JSON.stringify(params) });
      console.log('[Kernel] 工具结果:', JSON.stringify(result).substring(0, 100));
      return result;
    } catch (e) {
      console.error('[Kernel] 工具执行失败:', e.message);
      return { success: false, error: e.message };
    }
  }
  
  // ==================== 云端同步 ====================
  
  setCloudConfig(baseUrl, token) {
    // 如果没有传入baseUrl，使用默认的云端地址
    if (!baseUrl) {
      baseUrl = 'https://chenyi.xintiandi.online/cloud/api';
    }
    this.cloudConfig = { baseUrl, token };
    console.log('[Kernel] 云端配置已设置:', baseUrl, token ? '有token' : '无token');
  }
  
  async cloudRequest(method, pathStr, body = null) {
    if (!this.cloudConfig) {
      throw new Error('云端未配置');
    }
    
    const https = require('https');
    const httpModule = this.cloudConfig.baseUrl.startsWith('https') ? https : http;
    
    return new Promise((resolve, reject) => {
      const url = new URL(this.cloudConfig.baseUrl);
      const options = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + pathStr,  // 拼接完整路径
        method: method,
        headers: {
          'Content-Type': 'application/json'
        }
      };
      
      if (this.cloudConfig.token) {
        options.headers['Authorization'] = `Bearer ${this.cloudConfig.token}`;
      }
      
      const req = httpModule.request(options, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(data);
          }
        });
      });
      
      req.on('error', reject);
      req.setTimeout(10000, () => {
        req.destroy();
        reject(new Error('请求超时'));
      });
      
      if (body) {
        req.write(JSON.stringify(body));
      }
      req.end();
    });
  }
  
  // 用户认证
  async login(username, password) {
    try {
      // 支持用户名或邮箱登录
      const payload = username.includes('@') 
        ? { email: username, password } 
        : { username, password };
      
      console.log('[Kernel] 发送登录请求:', username);
      const result = await this.cloudRequest('POST', '/auth/login', payload);
      console.log('[Kernel] 登录响应:', JSON.stringify(result).substring(0, 200));
      
      if (result.token || result.success) {
        if (result.token) {
          this.cloudConfig.token = result.token;
        }
        return { 
          success: true, 
          token: result.token, 
          user: result.user || result.data?.user || { email: username, name: username }
        };
      }
      return { success: false, error: result.error || result.message || '登录失败' };
    } catch (err) {
      console.error('[Kernel] 登录异常:', err.message);
      return { success: false, error: err.message };
    }
  }
  
  // 设备注册
  async registerDevice(deviceInfo) {
    return await this.cloudRequest('POST', '/device/register', deviceInfo);
  }
  
  // 获取设备列表
  async getDevices() {
    return await this.cloudRequest('GET', '/device/list');
  }
  
  // 获取会话列表
  async getSessions() {
    return await this.cloudRequest('GET', '/sync/sessions');
  }
  
  // 创建云端会话
  async createCloudSession(session) {
    // 先获取现有会话
    const existing = await this.cloudRequest('GET', '/sync/sessions');
    const sessions = existing.sessions || [];
    
    // 添加新会话
    sessions.push({
      ...session,
      syncedAt: Date.now()
    });
    
    // 上传更新后的会话列表
    return await this.cloudRequest('POST', '/sync/sessions', { sessions });
  }
  
  // 同步消息
  async syncMessages(sessionId, messages) {
    return await this.cloudRequest('POST', `/sync/sessions/${sessionId}/messages`, messages);
  }
  
  // 获取消息
  async getMessages(sessionId) {
    const result = await this.cloudRequest('GET', `/sync/sessions/${sessionId}/messages`);
    return result;
  }
  
  // 创建会话（调用Rust内核）
  async createSession(app, user) {
    if (!this.kernel || !this.initialized) {
      throw new Error('内核未初始化');
    }
    return await this.kernel.createSession(app, user);
  }
  
  // 删除会话
  async deleteSession(sessionId) {
    // 从本地存储删除
    try {
      const result = await this.cloudRequest('DELETE', `/sync/sessions/${sessionId}`);
      return { success: true, result };
    } catch (err) {
      return { success: true }; // 本地删除成功即可
    }
  }
  
  // 重命名会话
  async renameSession(sessionId, newTitle) {
    try {
      const result = await this.cloudRequest('PATCH', `/sync/sessions/${sessionId}`, { title: newTitle });
      return { success: true, result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
  
  // 注册
  async register(username, password, name) {
    try {
      const payload = { 
        username, 
        password, 
        name: name || username 
      };
      
      // 如果username是邮箱格式，也添加email字段
      if (username.includes('@')) {
        payload.email = username;
      }
      
      console.log('[Kernel] 发送注册请求:', username);
      const result = await this.cloudRequest('POST', '/auth/register', payload);
      console.log('[Kernel] 注册响应:', JSON.stringify(result).substring(0, 200));
      
      if (result.token || result.success) {
        if (result.token) {
          this.cloudConfig.token = result.token;
        }
        return { 
          success: true, 
          token: result.token, 
          user: result.user || result.data?.user || { email: username, name: name || username }
        };
      }
      return { success: false, error: result.error || result.message || '注册失败' };
    } catch (err) {
      console.error('[Kernel] 注册异常:', err.message);
      return { success: false, error: err.message };
    }
  }
  
  // ==================== 状态 ====================
  
  getStatus() {
    if (!this.kernel) {
      return { initialized: false, version: 'none', rust: false };
    }
    
    try {
      const status = this.kernel.getStatus();
      return { ...status, rust: true, cloudEnabled: !!this.cloudConfig };
    } catch (err) {
      return { initialized: this.initialized, version: '1.0.0', rust: true, cloudEnabled: !!this.cloudConfig };
    }
  }
  
  isAvailable() {
    return this.initialized;
  }
  
  // ==================== 工具定义 ====================
  
  getToolDefinitions(enableTools) {
    if (!enableTools) return undefined;
    
    return [
      {
        type: 'function',
        function: {
          name: 'execute_command',
          description: '执行shell命令',
          parameters: {
            type: 'object',
            properties: {
              command: { type: 'string', description: '要执行的命令' },
              timeout: { type: 'number', description: '超时时间(秒)', default: 30 }
            },
            required: ['command']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'read_file',
          description: '读取文件内容',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '文件路径' }
            },
            required: ['path']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'write_file',
          description: '写入文件内容',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '文件路径' },
              content: { type: 'string', description: '文件内容' }
            },
            required: ['path', 'content']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'web_search',
          description: '搜索网络',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: '搜索关键词' }
            },
            required: ['query']
          }
        }
      }
    ];
  }
  
  // ==================== 继续对话（带工具结果） ====================
  
  continueWithToolResults(messages, toolResults, model, emitter) {
    const https = require('https');
    const http = require('http');
    
    const apiUrl = 'https://oneapi.xintiandi.online/v1/chat/completions';
    const apiKey = 'sk-5YiHUyQuJ0HFYRbh213e114b31934618969760834dFaC6Be';
    
    // 构建包含工具结果的消息
    const messagesWithTools = [...messages];
    
    // 添加工具调用消息
    for (const tr of toolResults) {
      // 添加 assistant 的工具调用消息
      messagesWithTools.push({
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: tr.tool_call_id,
          type: 'function',
          function: {
            name: tr.name,
            arguments: JSON.stringify(tr.args || {})
          }
        }]
      });
      
      // 添加工具结果消息
      messagesWithTools.push({
        role: 'tool',
        tool_call_id: tr.tool_call_id,
        content: JSON.stringify(tr.result)
      });
    }
    
    console.log('[Kernel] 继续对话，消息数:', messagesWithTools.length);
    
    const body = {
      model: model || 'glm-5',
      messages: messagesWithTools,
      temperature: 0.7,
      max_tokens: 4096,
      stream: true
    };
    
    const url = new URL(apiUrl);
    const isHttps = url.protocol === 'https:';
    const httpModule = isHttps ? https : http;
    
    const req = httpModule.request({
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      }
    }, (res) => {
      let buffer = '';
      
      res.on('data', (chunk) => {
        buffer += chunk.toString();
        let lines = buffer.split('\n');
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue;
          
          if (trimmed.startsWith('data: ')) {
            const data = trimmed.slice(6);
            if (data === '[DONE]') {
              console.log('[Kernel] 继续对话结束 [DONE]');
              emitter.emit('done');
              return;
            }
            
            try {
              const json = JSON.parse(data);
              const delta = json.choices?.[0]?.delta;
              
              if (delta?.content) {
                emitter.emit('text_delta', delta.content);
              }
            } catch (e) {}
          }
        }
      });
      
      res.on('end', () => {
        emitter.emit('done');
      });
    });
    
    
    req.on('error', (err) => {
      emitter.emit('error', err);
    });
    
    req.write(JSON.stringify(body));
    req.end();
  }
}

module.exports = {
  RustKernel,
};