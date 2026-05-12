/**
 * 晨翼Agent - 云端服务 v3.0（Rust内核集成版）
 * 
 * 新增功能：
 * - 通过HTTP调用Rust内核API
 * - 支持内核会话管理
 * - 支持内核记忆检索
 * - 支持内核工具执行
 */

const http = require('http');
const url = require('url');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { WebSocketServer } = require('ws');
const axios = require('axios');

// ==================== 配置 ====================
const PORT = process.env.PORT || 3002;
const JWT_SECRET = process.env.JWT_SECRET || 'chenyi-secret-key-2024';
const HEARTBEAT_INTERVAL = 30000;

// Rust内核配置
const KERNEL_ENABLED = process.env.KERNEL_ENABLED === 'true';
const KERNEL_URL = process.env.KERNEL_URL || 'http://127.0.0.1:8080';

// ==================== 智谱AI配置（备用） ====================
const ZHIPU_API_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
const ZHIPU_API_KEY = process.env.ZHIPU_API_KEY || '';
const ZHIPU_MODEL = 'glm-4';

// ==================== 内存存储 ====================
const users = new Map();
const connections = new Map();
const userDevices = new Map();
const sessions = new Map();
const deviceBindings = new Map();

// 初始化测试用户
users.set('test@chenyi.com', {
  id: uuidv4(),
  email: 'test@chenyi.com',
  password: '123456',
  name: '测试用户',
  createdAt: Date.now()
});

// ==================== 内核API调用 ====================
/**
 * 调用Rust内核API
 */
async function callKernel(endpoint, method = 'GET', body = null) {
  if (!KERNEL_ENABLED) {
    throw new Error('Rust内核未启用');
  }

  const options = {
    method,
    url: `${KERNEL_URL}${endpoint}`,
    timeout: 30000,
  };

  if (body) {
    options.data = body;
    options.headers = { 'Content-Type': 'application/json' };
  }

  const response = await axios(options);
  return response.data;
}

/**
 * 检查内核状态
 */
async function checkKernelHealth() {
  try {
    const result = await callKernel('/health');
    return result.status === 'ok';
  } catch (error) {
    console.error('内核健康检查失败:', error.message);
    return false;
  }
}

/**
 * 通过内核处理消息
 */
async function processMessageWithKernel(content, sessionId) {
  try {
    const response = await callKernel('/api/v1/session/messages', 'POST', {
      content,
      session_id: sessionId,
    });
    return response.response.content;
  } catch (error) {
    console.error('内核消息处理失败:', error.message);
    throw error;
  }
}

/**
 * 通过内核搜索记忆
 */
async function searchMemoryWithKernel(query, k = 10) {
  try {
    const response = await callKernel('/api/v1/memory/search', 'POST', {
      query,
      k,
    });
    return response.results || [];
  } catch (error) {
    console.error('内核记忆搜索失败:', error.message);
    return [];
  }
}

/**
 * 通过内核执行工具
 */
async function executeToolWithKernel(toolName, params) {
  try {
    const response = await callKernel(`/api/v1/tools/${toolName}/execute`, 'POST', params);
    return response.result;
  } catch (error) {
    console.error('内核工具执行失败:', error.message);
    throw error;
  }
}

/**
 * 获取内核工具列表
 */
async function getKernelTools() {
  try {
    const response = await callKernel('/api/v1/tools');
    return response;
  } catch (error) {
    console.error('获取内核工具列表失败:', error.message);
    return [];
  }
}

// ==================== 智谱AI调用（备用） ====================
async function callZhipuAI(userMessage) {
  if (!ZHIPU_API_KEY) {
    throw new Error('智谱API Key未配置');
  }

  const response = await axios.post(ZHIPU_API_URL, {
    model: ZHIPU_MODEL,
    messages: [{ role: 'user', content: userMessage }],
    temperature: 0.7,
    top_p: 0.9
  }, {
    headers: {
      'Authorization': `Bearer ${ZHIPU_API_KEY}`,
      'Content-Type': 'application/json'
    },
    timeout: 30000
  });

  return response.data?.choices?.[0]?.message?.content || '';
}

// ==================== 消息处理 ====================
/**
 * 处理用户消息（优先使用内核）
 */
async function processMessage(userMessage, sessionId) {
  // 优先使用Rust内核
  if (KERNEL_ENABLED) {
    try {
      return await processMessageWithKernel(userMessage, sessionId);
    } catch (error) {
      console.warn('内核处理失败，降级到智谱AI:', error.message);
    }
  }

  // 降级到智谱AI
  return await callZhipuAI(userMessage);
}

// ==================== 工具函数 ====================
function createToken(userId, email) {
  const payload = { userId, email, iat: Date.now() };
  const signature = crypto.createHmac('sha256', JWT_SECRET)
    .update(JSON.stringify(payload))
    .digest('hex');
  const token = Buffer.from(JSON.stringify({ payload, signature }))
    .toString('base64url');
  sessions.set(token, { userId, email, createdAt: Date.now() });
  return token;
}

function verifyToken(token) {
  try {
    const data = JSON.parse(Buffer.from(token, 'base64url').toString());
    const session = sessions.get(token);
    if (!session) return null;
    if (Date.now() - session.createdAt > 7 * 24 * 60 * 60 * 1000) {
      sessions.delete(token);
      return null;
    }
    return data.payload;
  } catch {
    return null;
  }
}

// ==================== HTTP服务器 ====================
const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const path = parsedUrl.pathname;

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // 路由处理
  try {
    // 健康检查
    if (path === '/health') {
      const kernelHealthy = KERNEL_ENABLED ? await checkKernelHealth() : false;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        service: 'chenyi-cloud',
        version: '3.0.0',
        kernel: {
          enabled: KERNEL_ENABLED,
          healthy: kernelHealthy,
          url: KERNEL_URL,
        },
      }));
      return;
    }

    // 内核状态
    if (path === '/api/kernel/status') {
      if (!KERNEL_ENABLED) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '内核未启用' }));
        return;
      }
      
      const healthy = await checkKernelHealth();
      const tools = await getKernelTools();
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        healthy,
        tools,
        url: KERNEL_URL,
      }));
      return;
    }

    // 内核工具列表
    if (path === '/api/kernel/tools') {
      const tools = await getKernelTools();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(tools));
      return;
    }

    // 内核记忆搜索
    if (path === '/api/kernel/memory/search') {
      const { query, k } = parsedUrl.query;
      const results = await searchMemoryWithKernel(query, parseInt(k) || 10);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ results }));
      return;
    }

    // 登录
    if (path === '/api/auth/login' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        const { email, password } = JSON.parse(body);
        const user = users.get(email);
        
        if (!user || user.password !== password) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: '邮箱或密码错误' }));
          return;
        }

        const token = createToken(user.id, user.email);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          token,
          user: { id: user.id, email: user.email, name: user.name }
        }));
      });
      return;
    }

    // 设备列表
    if (path === '/api/devices') {
      const auth = req.headers.authorization;
      const token = auth?.replace('Bearer ', '');
      const payload = verifyToken(token);
      
      if (!payload) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '未授权' }));
        return;
      }

      const devices = Array.from(deviceBindings.entries())
        .filter(([_, binding]) => binding.userId === payload.userId)
        .map(([deviceId, binding]) => ({
          deviceId,
          deviceName: binding.deviceName,
          platform: binding.platform,
          boundAt: binding.boundAt,
          online: connections.has(deviceId),
        }));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ devices }));
      return;
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));

  } catch (error) {
    console.error('请求处理错误:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
});

// ==================== WebSocket服务器 ====================
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  const deviceId = uuidv4();
  console.log(`[WS] 新连接: ${deviceId}`);

  connections.set(deviceId, {
    ws,
    userId: null,
    deviceInfo: null,
    lastHeartbeat: Date.now(),
  });

  // 发送连接确认
  ws.send(JSON.stringify({
    type: 'connected',
    deviceId,
  }));

  // 心跳检测
  const heartbeatTimer = setInterval(() => {
    const conn = connections.get(deviceId);
    if (!conn) {
      clearInterval(heartbeatTimer);
      return;
    }

    if (Date.now() - conn.lastHeartbeat > HEARTBEAT_INTERVAL * 2) {
      console.log(`[WS] 连接超时: ${deviceId}`);
      ws.close();
      clearInterval(heartbeatTimer);
      return;
    }

    ws.send(JSON.stringify({ type: 'ping' }));
  }, HEARTBEAT_INTERVAL);

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      const conn = connections.get(deviceId);
      if (!conn) return;

      conn.lastHeartbeat = Date.now();

      switch (msg.type) {
        case 'pong':
          break;

        case 'register':
          conn.deviceInfo = msg.deviceInfo;
          console.log(`[WS] 设备注册: ${deviceId}`, msg.deviceInfo);
          ws.send(JSON.stringify({ type: 'registered', deviceId }));
          break;

        case 'bind':
          if (deviceBindings.has(deviceId)) {
            ws.send(JSON.stringify({ type: 'error', message: '设备已绑定' }));
            return;
          }
          deviceBindings.set(deviceId, {
            userId: msg.userId,
            deviceName: msg.deviceName || '未命名设备',
            platform: msg.platform || 'unknown',
            boundAt: Date.now(),
          });
          conn.userId = msg.userId;
          
          if (!userDevices.has(msg.userId)) {
            userDevices.set(msg.userId, new Set());
          }
          userDevices.get(msg.userId).add(deviceId);
          
          ws.send(JSON.stringify({ type: 'bound', deviceId }));
          console.log(`[WS] 设备绑定: ${deviceId} -> ${msg.userId}`);
          break;

        case 'chat':
          console.log(`[WS] 收到消息: ${msg.content}`);
          
          try {
            const response = await processMessage(msg.content, msg.sessionId);
            ws.send(JSON.stringify({
              type: 'response',
              content: response,
              messageId: uuidv4(),
            }));
          } catch (error) {
            ws.send(JSON.stringify({
              type: 'error',
              message: error.message,
            }));
          }
          break;

        case 'memory_search':
          const results = await searchMemoryWithKernel(msg.query, msg.k || 10);
          ws.send(JSON.stringify({
            type: 'memory_results',
            results,
          }));
          break;

        case 'tool_execute':
          try {
            const result = await executeToolWithKernel(msg.tool, msg.params);
            ws.send(JSON.stringify({
              type: 'tool_result',
              tool: msg.tool,
              result,
            }));
          } catch (error) {
            ws.send(JSON.stringify({
              type: 'error',
              message: `工具执行失败: ${error.message}`,
            }));
          }
          break;

        default:
          console.log(`[WS] 未知消息类型: ${msg.type}`);
      }
    } catch (error) {
      console.error('[WS] 消息处理错误:', error);
    }
  });

  ws.on('close', () => {
    console.log(`[WS] 连接关闭: ${deviceId}`);
    connections.delete(deviceId);
    clearInterval(heartbeatTimer);
  });

  ws.on('error', (error) => {
    console.error(`[WS] 错误: ${deviceId}`, error);
  });
});

// ==================== 启动 ====================
server.listen(PORT, () => {
  console.log(`[晨翼云端] 服务启动 - 端口 ${PORT}`);
  console.log(`[晨翼云端] Rust内核: ${KERNEL_ENABLED ? '已启用' : '未启用'}`);
  if (KERNEL_ENABLED) {
    console.log(`[晨翼云端] 内核URL: ${KERNEL_URL}`);
  }
});
