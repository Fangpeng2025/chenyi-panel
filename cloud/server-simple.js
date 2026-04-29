/**
 * 晨翼Agent - 云端服务（简化版，无数据库依赖）
 */

const Fastify = require('fastify');
const { createServer } = require('http');
const { Server: WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

// 配置
const config = {
  port: process.env.PORT || 3000,
  jwtSecret: process.env.JWT_SECRET || 'chenyi-secret-key-2024'
};

// 初始化Fastify
const fastify = Fastify({ logger: true });

// HTTP服务器
const server = createServer(fastify.server);

// WebSocket服务器
const wss = new WebSocketServer({ server });

// 内存存储（简化版）
const users = new Map();       // email -> user
const connections = new Map(); // deviceId -> { ws, userId, deviceInfo }
const userDevices = new Map(); // userId -> Set<deviceId>

// 初始化测试用户
users.set('test@chenyi.com', {
  id: uuidv4(),
  email: 'test@chenyi.com',
  password: '123456',
  name: '测试用户'
});

// ==================== HTTP API ====================

// 用户登录
fastify.post('/api/v1/auth/login', async (request, reply) => {
  const { email, password } = request.body;
  
  const user = users.get(email);
  if (!user || user.password !== password) {
    return reply.code(401).send({ error: '邮箱或密码错误' });
  }
  
  const token = jwt.sign(
    { userId: user.id, email: user.email },
    config.jwtSecret,
    { expiresIn: '7d' }
  );
  
  return { token, user: { id: user.id, name: user.name, email: user.email } };
});

// 获取设备列表
fastify.get('/api/v1/devices', async (request, reply) => {
  const auth = request.headers.authorization;
  if (!auth) return reply.code(401).send({ error: '未授权' });
  
  try {
    const token = auth.replace('Bearer ', '');
    const decoded = jwt.verify(token, config.jwtSecret);
    
    const deviceIds = userDevices.get(decoded.userId) || new Set();
    const devices = [];
    
    for (const deviceId of deviceIds) {
      const conn = connections.get(deviceId);
      if (conn && conn.deviceInfo) {
        devices.push({
          deviceId,
          ...conn.deviceInfo,
          online: conn.ws.readyState === 1
        });
      }
    }
    
    return { devices };
  } catch (err) {
    return reply.code(401).send({ error: 'Token无效' });
  }
});

// 健康检查
fastify.get('/health', async () => {
  return { 
    status: 'ok', 
    timestamp: Date.now(),
    connections: connections.size,
    users: users.size
  };
});

// ==================== WebSocket ====================

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://localhost:${config.port}`);
  const token = url.searchParams.get('token');
  
  // 验证token
  let user = null;
  try {
    user = jwt.verify(token, config.jwtSecret);
  } catch (err) {
    ws.close(4001, 'Invalid token');
    return;
  }
  
  ws.userId = user.userId;
  ws.deviceId = null;
  ws.isAlive = true;
  
  console.log(`[WS] 用户连接: ${user.email}`);
  
  ws.on('message', (data) => handleMessage(ws, data));
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('close', () => handleDisconnect(ws));
});

/**
 * 处理消息
 */
function handleMessage(ws, data) {
  try {
    const msg = JSON.parse(data.toString());
    console.log('[WS] 收到消息:', msg.type);
    
    switch (msg.type) {
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong' }));
        break;
        
      case 'register':
        handleRegister(ws, msg);
        break;
        
      case 'control':
        handleControl(ws, msg);
        break;
        
      case 'sync':
        handleSync(ws, msg);
        break;
        
      case 'ai_chat':
        handleAIChat(ws, msg);
        break;
        
      default:
        ws.send(JSON.stringify({ type: 'error', data: { message: `未知消息类型: ${msg.type}` } }));
    }
  } catch (err) {
    console.error('[WS] 消息处理错误:', err);
  }
}

/**
 * 处理设备注册
 */
function handleRegister(ws, msg) {
  const { deviceId, deviceType, deviceName, capabilities } = msg.data;
  
  // 更新连接映射
  ws.deviceId = deviceId;
  connections.set(deviceId, {
    ws,
    userId: ws.userId,
    deviceInfo: {
      deviceType,
      deviceName,
      capabilities,
      status: 'idle',
      lastSeen: Date.now()
    }
  });
  
  // 更新用户设备列表
  if (!userDevices.has(ws.userId)) {
    userDevices.set(ws.userId, new Set());
  }
  userDevices.get(ws.userId).add(deviceId);
  
  // 响应
  ws.send(JSON.stringify({
    type: 'register_ack',
    data: { success: true, deviceId }
  }));
  
  console.log(`[WS] 设备注册: ${deviceName} (${deviceId})`);
}

/**
 * 处理控制指令
 */
function handleControl(ws, msg) {
  const { target, requestId } = msg;
  const targetConn = connections.get(target);
  
  if (targetConn && targetConn.ws.readyState === 1) {
    // 转发到目标设备
    targetConn.ws.send(JSON.stringify(msg));
    console.log(`[WS] 控制指令转发: ${target}`);
  } else {
    // 设备离线
    ws.send(JSON.stringify({
      type: 'error',
      requestId,
      data: { message: '目标设备离线' }
    }));
  }
}

/**
 * 处理状态同步
 */
function handleSync(ws, msg) {
  if (!ws.deviceId) return;
  
  const conn = connections.get(ws.deviceId);
  if (conn) {
    conn.deviceInfo = { ...conn.deviceInfo, ...msg.data, lastSeen: Date.now() };
  }
  
  // 广播给用户的其他设备
  broadcastToUser(ws.userId, {
    type: 'device_update',
    data: { deviceId: ws.deviceId, ...msg.data }
  }, ws);
}

/**
 * 处理AI对话（简化版）
 */
function handleAIChat(ws, msg) {
  // 简化版：直接返回响应
  ws.send(JSON.stringify({
    type: 'ai_chat_response',
    requestId: msg.requestId,
    data: { 
      content: '收到消息：' + msg.data.content + '\n\nAI服务正在开发中，敬请期待...',
      timestamp: Date.now()
    }
  }));
}

/**
 * 处理断开连接
 */
function handleDisconnect(ws) {
  if (ws.deviceId) {
    connections.delete(ws.deviceId);
    console.log(`[WS] 设备断开: ${ws.deviceId}`);
  }
}

/**
 * 广播给用户的所有设备
 */
function broadcastToUser(userId, msg, excludeWs = null) {
  const deviceIds = userDevices.get(userId) || new Set();
  for (const deviceId of deviceIds) {
    const conn = connections.get(deviceId);
    if (conn && conn.ws !== excludeWs && conn.ws.readyState === 1) {
      conn.ws.send(JSON.stringify(msg));
    }
  }
}

// 心跳检测
setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) {
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

// 启动服务器
server.listen(config.port, () => {
  console.log(`[Server] 晨翼云端服务已启动: http://localhost:${config.port}`);
  console.log(`[Server] WebSocket: ws://localhost:${config.port}/ws?token=xxx`);
  console.log(`[Server] 测试账号: test@chenyi.com / 123456`);
});