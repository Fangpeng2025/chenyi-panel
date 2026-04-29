/**
 * 晨翼Agent - 云端服务入口
 */

const Fastify = require('fastify');
const { createServer } = require('http');
const { Server: WebSocketServer } = require('ws');
const { Pool } = require('pg');
const { createClient } = require('redis');
const jwt = require('jsonwebtoken');

// 配置
const config = {
  port: process.env.PORT || 3000,
  jwtSecret: process.env.JWT_SECRET || 'your-secret-key',
  databaseUrl: process.env.DATABASE_URL || 'postgresql://localhost/chenyi',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379'
};

// 初始化Fastify
const fastify = Fastify({ logger: true });

// 数据库连接
const db = new Pool({ connectionString: config.databaseUrl });

// Redis连接
const redis = createClient({ url: config.redisUrl });
redis.connect().catch(console.error);

// HTTP服务器
const server = createServer(fastify.server);

// WebSocket服务器
const wss = new WebSocketServer({ server });

// 连接管理
const connections = new Map(); // deviceId -> WebSocket

// ==================== HTTP API ====================

// 用户登录
fastify.post('/api/v1/auth/login', async (request, reply) => {
  const { email, password } = request.body;
  
  // TODO: 验证密码
  const user = await db.query(
    'SELECT * FROM users WHERE email = $1',
    [email]
  );
  
  if (!user.rows[0]) {
    return reply.code(401).send({ error: '邮箱或密码错误' });
  }
  
  const token = jwt.sign(
    { userId: user.rows[0].id, email: user.rows[0].email },
    config.jwtSecret,
    { expiresIn: '7d' }
  );
  
  return { token, user: { id: user.rows[0].id, name: user.rows[0].name, email: user.rows[0].email } };
});

// 用户注册
fastify.post('/api/v1/auth/register', async (request, reply) => {
  const { email, password, name } = request.body;
  
  // TODO: 密码加密
  const result = await db.query(
    'INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3) RETURNING id, email, name',
    [email, password, name]
  );
  
  return { success: true, user: result.rows[0] };
});

// 获取设备列表
fastify.get('/api/v1/devices', async (request, reply) => {
  // TODO: 验证token
  const userId = request.headers['x-user-id'];
  
  const result = await db.query(
    'SELECT * FROM devices WHERE user_id = $1 ORDER BY last_seen DESC',
    [userId]
  );
  
  return { devices: result.rows };
});

// 健康检查
fastify.get('/health', async () => {
  return { status: 'ok', timestamp: Date.now() };
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
async function handleMessage(ws, data) {
  try {
    const msg = JSON.parse(data.toString());
    
    switch (msg.type) {
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong' }));
        break;
        
      case 'register':
        await handleRegister(ws, msg);
        break;
        
      case 'control':
        await handleControl(ws, msg);
        break;
        
      case 'sync':
        await handleSync(ws, msg);
        break;
        
      case 'ai_chat':
        await handleAIChat(ws, msg);
        break;
        
      default:
        console.warn('[WS] 未知消息类型:', msg.type);
    }
  } catch (err) {
    console.error('[WS] 消息处理错误:', err);
  }
}

/**
 * 处理设备注册
 */
async function handleRegister(ws, msg) {
  const { deviceId, deviceType, deviceName, capabilities } = msg.data;
  
  // 保存到数据库
  await db.query(`
    INSERT INTO devices (id, user_id, type, name, capabilities, last_seen)
    VALUES ($1, $2, $3, $4, $5, NOW())
    ON CONFLICT (id) DO UPDATE SET last_seen = NOW(), name = $4
  `, [deviceId, ws.userId, deviceType, deviceName, capabilities]);
  
  // 更新连接映射
  ws.deviceId = deviceId;
  connections.set(deviceId, ws);
  
  // 更新Redis在线状态
  await redis.set(`device:${deviceId}:online`, '1', 'EX', 120);
  
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
async function handleControl(ws, msg) {
  const { target, requestId } = msg;
  const targetWs = connections.get(target);
  
  if (targetWs) {
    // 转发到目标设备
    targetWs.send(JSON.stringify(msg));
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
async function handleSync(ws, msg) {
  const { status, battery, network } = msg.data;
  
  // 更新Redis
  if (status) await redis.set(`device:${ws.deviceId}:status`, status);
  if (battery) await redis.set(`device:${ws.deviceId}:battery`, battery.toString());
  if (network) await redis.set(`device:${ws.deviceId}:network`, network);
  
  // 广播给用户的其他设备
  broadcastToUser(ws.userId, {
    type: 'device_update',
    data: { deviceId: ws.deviceId, status, battery, network }
  }, ws);
}

/**
 * 处理AI对话
 */
async function handleAIChat(ws, msg) {
  // TODO: 调用AI服务
  ws.send(JSON.stringify({
    type: 'ai_chat_response',
    data: { content: 'AI服务开发中...' }
  }));
}

/**
 * 处理断开连接
 */
async function handleDisconnect(ws) {
  if (ws.deviceId) {
    connections.delete(ws.deviceId);
    await redis.del(`device:${ws.deviceId}:online`);
    console.log(`[WS] 设备断开: ${ws.deviceId}`);
  }
}

/**
 * 广播给用户的所有设备
 */
function broadcastToUser(userId, msg, excludeWs = null) {
  for (const [deviceId, ws] of connections) {
    if (ws.userId === userId && ws !== excludeWs) {
      ws.send(JSON.stringify(msg));
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
});