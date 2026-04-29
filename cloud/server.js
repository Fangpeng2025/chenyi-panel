/**
 * 晨翼Agent - 云端服务 v2.0（轻量稳定版）
 * 使用原生Node.js HTTP + WebSocket，无重型依赖
 */

const http = require('http');
const url = require('url');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { WebSocketServer } = require('ws');

// ==================== 配置 ====================
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'chenyi-secret-key-2024';
const HEARTBEAT_INTERVAL = 30000;

// ==================== 内存存储 ====================
const users = new Map();
const connections = new Map(); // deviceId -> { ws, userId, deviceInfo, lastHeartbeat }
const userDevices = new Map(); // userId -> Set<deviceId>
const sessions = new Map(); // token -> { userId, email, createdAt }

// 初始化测试用户
users.set('test@chenyi.com', {
  id: uuidv4(),
  email: 'test@chenyi.com',
  password: '123456',
  name: '测试用户'
});

// ==================== 工具函数 ====================
function createToken(userId, email) {
  const payload = { userId, email, iat: Date.now() };
  const token = Buffer.from(JSON.stringify(payload)).toString('base64');
  sessions.set(token, { userId, email, createdAt: Date.now() });
  return token;
}

function verifyToken(token) {
  try {
    const payload = JSON.parse(Buffer.from(token, 'base64').toString());
    const session = sessions.get(token);
    if (!session) return null;
    // 7天过期
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
    // 用户登录
    if (parsedUrl.pathname === '/api/v1/auth/login' && req.method === 'POST') {
      const { email, password } = await parseBody(req);
      const user = users.get(email);
      if (!user || user.password !== password) {
        return sendJson(res, 401, { error: '邮箱或密码错误' });
      }
      const token = createToken(user.id, user.email);
      return sendJson(res, 200, {
        token,
        user: { id: user.id, name: user.name, email: user.email }
      });
    }
    
    // 获取设备列表
    if (parsedUrl.pathname === '/api/v1/devices' && req.method === 'GET') {
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
    if (parsedUrl.pathname === '/api/v1/control' && req.method === 'POST') {
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
    
    // AI对话
    if (parsedUrl.pathname === '/api/v1/ai/chat' && req.method === 'POST') {
      const token = req.headers.authorization?.replace('Bearer ', '');
      const auth = verifyToken(token);
      if (!auth) return sendJson(res, 401, { error: '未授权' });
      
      const { message, deviceId } = await parseBody(req);
      // TODO: 接入AI服务
      return sendJson(res, 200, { 
        reply: `收到消息: ${message}`,
        deviceId
      });
    }
    
    // 健康检查
    if (parsedUrl.pathname === '/health') {
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
