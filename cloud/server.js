/**
 * 晨翼Agent - 云端服务 v2.0（轻量稳定版）
 * 使用原生Node.js HTTP + WebSocket，无重型依赖
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

// ==================== 智谱AI配置 ====================
const ZHIPU_API_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
const ZHIPU_API_KEY = process.env.ZHIPU_API_KEY || ''; // 需要在环境变量中设置
const ZHIPU_MODEL = 'glm-4';

// ==================== 内存存储 ====================
const users = new Map();
const connections = new Map(); // deviceId -> { ws, userId, deviceInfo, lastHeartbeat }
const userDevices = new Map(); // userId -> Set<deviceId>
const sessions = new Map(); // token -> { userId, email, createdAt }
const deviceBindings = new Map(); // deviceId -> { userId, deviceName, platform, boundAt }

// 初始化测试用户
users.set('test@chenyi.com', {
  id: uuidv4(),
  email: 'test@chenyi.com',
  password: '123456',
  name: '测试用户',
  createdAt: Date.now()
});

// ==================== 工具函数 ====================
/**
 * 调用智谱AI API
 * @param {string} userMessage - 用户消息
 * @returns {Promise<string>} AI回复内容
 */
async function callZhipuAI(userMessage) {
  if (!ZHIPU_API_KEY) {
    throw new Error('智谱API Key未配置，请设置ZHIPU_API_KEY环境变量');
  }

  try {
    const response = await axios.post(ZHIPU_API_URL, {
      model: ZHIPU_MODEL,
      messages: [
        {
          role: 'user',
          content: userMessage
        }
      ],
      temperature: 0.7,
      top_p: 0.9
    }, {
      headers: {
        'Authorization': `Bearer ${ZHIPU_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });

    // 解析返回内容
    if (response.data?.choices?.[0]?.message?.content) {
      return response.data.choices[0].message.content;
    } else {
      throw new Error('智谱API返回格式异常');
    }
  } catch (error) {
    console.error('智谱AI调用失败:', error.message);
    if (error.response) {
      console.error('API错误:', error.response.data);
    }
    throw error;
  }
}

// 完善token生成（加入签名）
function createToken(userId, email) {
  const payload = { userId, email, iat: Date.now() };
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(JSON.stringify(payload)).digest('hex');
  const token = Buffer.from(JSON.stringify({ payload, signature })).toString('base64url');
  sessions.set(token, { userId, email, createdAt: Date.now() });
  return token;
}

function verifyToken(token) {
  try {
    // 兼容旧版token（无signature的base64格式）
    if (!token.includes('.')) {
      const payload = JSON.parse(Buffer.from(token, 'base64').toString());
      const session = sessions.get(token);
      if (!session) return null;
      if (Date.now() - session.createdAt > 7 * 24 * 60 * 60 * 1000) {
        sessions.delete(token);
        return null;
      }
      return payload;
    }
    // 新版token（base64url格式带signature）
    const { payload, signature } = JSON.parse(Buffer.from(token, 'base64url').toString());
    const expectedSig = crypto.createHmac('sha256', JWT_SECRET).update(JSON.stringify(payload)).digest('hex');
    if (signature !== expectedSig) return null;
    const session = sessions.get(token);
    if (!session) return null;
    if (Date.now() - session.createdAt > 7 * 24 * 60 * 60 * 1000) {
      sessions.delete(token);
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(JSON.stringify(data));
}

// ==================== WebSocket 心跳 ====================
const heartbeatTimers = new Map();

function startHeartbeat(ws, deviceId) {
  const interval = setInterval(() => {
    if (ws.readyState === ws.OPEN) {
      ws.ping();
    } else {
      clearInterval(interval);
      heartbeatTimers.delete(deviceId);
    }
  }, HEARTBEAT_INTERVAL);
  heartbeatTimers.set(deviceId, interval);
}

function stopHeartbeat(deviceId) {
  const timer = heartbeatTimers.get(deviceId);
  if (timer) {
    clearInterval(timer);
    heartbeatTimers.delete(deviceId);
  }
}

// ==================== HTTP 服务器 ====================
const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  
  // 规范化路径：支持 /cloud/api/* 和 /api/* 格式，统一转为 /api/v1/*
  let normalized = parsedUrl.pathname;
  
  if (normalized.startsWith('/cloud/api/')) {
    // /cloud/api/auth/login -> /api/v1/auth/login
    let rest = normalized.replace('/cloud/api/', '');
    if (rest.startsWith('v1/')) {
      normalized = '/api/v1/' + rest.substring(3);
    } else {
      normalized = '/api/v1/' + rest;
    }
  } else if (normalized.startsWith('/api/') && !normalized.startsWith('/api/v1/')) {
    // /api/auth/login -> /api/v1/auth/login (Nginx去掉/cloud/后的请求)
    normalized = '/api/v1/' + normalized.replace('/api/', '');
  }
  
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    res.end();
    return;
  }
  
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  
  try {
    // 用户注册
    if (normalized === '/api/v1/auth/register' && req.method === 'POST') {
      const { username, password, name } = await parseBody(req);
      
      // 验证参数
      if (!username || !password) {
        return sendJson(res, 400, { error: '请填写用户名和密码' });
      }
      
      // 检查用户名是否已存在
      for (const [key, u] of users.entries()) {
        if (u.username === username || key === username) {
          return sendJson(res, 409, { error: '用户名已注册' });
        }
      }
      
      // 创建新用户
      const userId = uuidv4();
      const user = {
        id: userId,
        username,
        password,
        name: name || username,
        createdAt: Date.now()
      };
      users.set(username, user);
      
      // 创建token
      const token = createToken(userId, username);
      return sendJson(res, 201, {
        token,
        user: { id: userId, name: user.name }
      });
    }
    
    // 用户登录
    if (normalized === '/api/v1/auth/login' && req.method === 'POST') {
      const { username, password } = await parseBody(req);
      
      // 用 username 查找
      let user = users.get(username);
      
      // 如果找不到，遍历所有用户
      if (!user) {
        for (const [key, u] of users.entries()) {
          if (u.name === username || u.username === username) {
            user = u;
            break;
          }
        }
      }
      
      if (!user || user.password !== password) {
        return sendJson(res, 401, { error: '用户名或密码错误' });
      }
      const token = createToken(user.id, user.username || user.name);
      return sendJson(res, 200, {
        token,
        user: { id: user.id, name: user.name, username: user.username }
      });
    }
    
    // 获取设备列表
    if (normalized === '/api/v1/devices' && req.method === 'GET') {
      const token = req.headers.authorization?.replace('Bearer ', '');
      const auth = verifyToken(token);
      if (!auth) return sendJson(res, 401, { error: '未授权' });
      
      const deviceIds = userDevices.get(auth.userId) || new Set();
      const devices = [];
      for (const deviceId of deviceIds) {
        const conn = connections.get(deviceId);
        if (conn) {
          devices.push({
            deviceId,
            name: conn.deviceInfo?.name || '未知设备',
            platform: conn.deviceInfo?.platform || 'unknown',
            online: conn.ws.readyState === 1
          });
        }
      }
      return sendJson(res, 200, { devices });
    }
    
    // 发送控制指令
    if (normalized === '/api/v1/control' && req.method === 'POST') {
      const token = req.headers.authorization?.replace('Bearer ', '');
      const auth = verifyToken(token);
      if (!auth) return sendJson(res, 401, { error: '未授权' });
      
      const { deviceId, action, params } = await parseBody(req);
      const conn = connections.get(deviceId);
      if (!conn || conn.ws.readyState !== 1) {
        return sendJson(res, 404, { error: '设备不在线' });
      }
      
      conn.ws.send(JSON.stringify({
        type: 'CONTROL',
        action,
        params,
        requestId: uuidv4()
      }));
      return sendJson(res, 200, { success: true, message: '指令已发送' });
    }
    
    // 绑定设备
    if (normalized === '/api/v1/devices/bind' && req.method === 'POST') {
      const token = req.headers.authorization?.replace('Bearer ', '');
      const auth = verifyToken(token);
      if (!auth) return sendJson(res, 401, { error: '未授权' });
      
      const { deviceId, deviceName, platform } = await parseBody(req);
      if (!deviceId) return sendJson(res, 400, { error: '缺少deviceId' });
      
      // 保存设备绑定
      deviceBindings.set(deviceId, {
        userId: auth.userId,
        deviceName: deviceName || '未知设备',
        platform: platform || 'unknown',
        boundAt: Date.now()
      });
      
      // 添加到用户设备列表
      if (!userDevices.has(auth.userId)) {
        userDevices.set(auth.userId, new Set());
      }
      userDevices.get(auth.userId).add(deviceId);
      
      return sendJson(res, 200, { success: true, message: '设备绑定成功' });
    }
    
    // 解绑设备
    if (normalized === '/api/v1/devices/unbind' && req.method === 'POST') {
      const token = req.headers.authorization?.replace('Bearer ', '');
      const auth = verifyToken(token);
      if (!auth) return sendJson(res, 401, { error: '未授权' });
      
      const { deviceId } = await parseBody(req);
      if (!deviceId) return sendJson(res, 400, { error: '缺少deviceId' });
      
      // 检查绑定关系
      const binding = deviceBindings.get(deviceId);
      if (!binding || binding.userId !== auth.userId) {
        return sendJson(res, 403, { error: '无权解绑此设备' });
      }
      
      deviceBindings.delete(deviceId);
      userDevices.get(auth.userId)?.delete(deviceId);
      
      return sendJson(res, 200, { success: true, message: '设备已解绑' });
    }
    
    // 获取用户信息
    if (normalized === '/api/v1/user/info' && req.method === 'GET') {
      const token = req.headers.authorization?.replace('Bearer ', '');
      const auth = verifyToken(token);
      if (!auth) return sendJson(res, 401, { error: '未授权' });
      
      const user = Array.from(users.values()).find(u => u.id === auth.userId);
      if (!user) return sendJson(res, 404, { error: '用户不存在' });
      
      return sendJson(res, 200, {
        id: user.id,
        email: user.email,
        name: user.name,
        createdAt: user.createdAt,
        deviceCount: userDevices.get(auth.userId)?.size || 0
      });
    }
    
    // AI对话
    if (normalized === '/api/v1/ai/chat' && req.method === 'POST') {
      const token = req.headers.authorization?.replace('Bearer ', '');
      const auth = verifyToken(token);
      if (!auth) return sendJson(res, 401, { error: '未授权' });
      
      const { message, deviceId } = await parseBody(req);
      
      try {
        // 调用智谱AI
        const reply = await callZhipuAI(message);
        return sendJson(res, 200, { 
          reply,
          deviceId
        });
      } catch (error) {
        console.error('AI对话错误:', error.message);
        return sendJson(res, 500, { 
          error: 'AI服务调用失败: ' + error.message,
          deviceId
        });
      }
    }
    
    // 健康检查
    if (normalized === '/health') {
      return sendJson(res, 200, {
        status: 'ok',
        connections: connections.size,
        users: users.size,
        uptime: process.uptime()
      });
    }
    
    // 默认404
    sendJson(res, 404, { error: 'Not found' });
    
  } catch (error) {
    console.error('Request error:', error.message);
    sendJson(res, 500, { error: 'Internal server error' });
  }
});

// ==================== WebSocket 服务器 ====================
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  const deviceId = uuidv4();
  console.log(`[WS] 新连接: ${deviceId}`);
  
  ws.deviceId = deviceId;
  connections.set(deviceId, { ws, deviceInfo: null });
  startHeartbeat(ws, deviceId);
  
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      console.log(`[WS] ${deviceId}:`, msg.type);
      
      switch (msg.type) {
        case 'REGISTER':
          // 设备注册
          connections.get(deviceId).deviceInfo = {
            name: msg.deviceName || '未知设备',
            platform: msg.platform || 'unknown'
          };
          if (msg.userId) {
            if (!userDevices.has(msg.userId)) {
              userDevices.set(msg.userId, new Set());
            }
            userDevices.get(msg.userId).add(deviceId);
          }
          ws.send(JSON.stringify({ type: 'REGISTERED', deviceId }));
          break;
          
        case 'HEARTBEAT':
          const conn = connections.get(deviceId);
          if (conn) conn.lastHeartbeat = Date.now();
          ws.send(JSON.stringify({ type: 'HEARTBEAT_ACK' }));
          break;
          
        case 'RESPONSE':
          // 转发给客户端（如果需要）
          break;
      }
    } catch (e) {
      console.error(`[WS] ${deviceId} 消息解析错误:`, e.message);
    }
  });
  
  ws.on('close', () => {
    console.log(`[WS] 连接关闭: ${deviceId}`);
    stopHeartbeat(deviceId);
    connections.delete(deviceId);
  });
  
  ws.on('error', (err) => {
    console.error(`[WS] ${deviceId} 错误:`, err.message);
  });
  
  ws.on('pong', () => {
    const conn = connections.get(deviceId);
    if (conn) conn.lastHeartbeat = Date.now();
  });
});

// ==================== 启动 ====================
server.listen(PORT, '0.0.0.0', () => {
  console.log(`========================================`);
  console.log(`  晨翼Agent 云端服务 v2.0 已启动`);
  console.log(`  端口: ${PORT}`);
  console.log(`  健康检查: http://localhost:${PORT}/health`);
  console.log(`========================================`);
});

// ==================== 优雅关闭 ====================
process.on('SIGTERM', () => {
  console.log('收到SIGTERM，正在关闭...');
  wss.close();
  server.close(() => {
    console.log('服务已关闭');
    process.exit(0);
  });
});
