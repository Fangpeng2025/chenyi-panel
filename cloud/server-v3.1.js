/**
 * 晨翼Agent - 云端服务 v3.1（数据同步版）
 * 
 * 核心功能：
 * - 用户认证 (登录/注册)
 * - 设备管理 (绑定/解绑)
 * - 数据同步 (记忆/配置/会话)
 * - 消息路由 (跨设备)
 * 
 * 不包含：
 * - AI对话处理 (由客户端内核处理)
 * - 工具执行 (由客户端内核处理)
 */

const http = require('http');
const url = require('url');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { WebSocketServer } = require('ws');
const fs = require('fs');
const path = require('path');

// ==================== 配置 ====================
const PORT = process.env.PORT || 3002;
const JWT_SECRET = process.env.JWT_SECRET || 'chenyi-secret-key-2024';
const HEARTBEAT_INTERVAL = 30000;
const DATA_DIR = process.env.DATA_DIR || './data';

// ==================== 数据存储 ====================
// 用户数据
const users = new Map();

// 设备连接
const connections = new Map(); // deviceId -> { ws, userId, deviceInfo, lastHeartbeat }
const userDevices = new Map(); // userId -> Set<deviceId>
const deviceBindings = new Map(); // deviceId -> { userId, deviceName, platform, boundAt }

// 会话数据
const sessions = new Map(); // token -> { userId, email, createdAt }

// 同步数据存储 (持久化到文件)
const syncData = {
  memories: new Map(),    // userId -> [{ id, content, metadata, createdAt }]
  configs: new Map(),     // userId -> { llm, memory, session }
  sessions: new Map(),    // userId -> [{ id, messages, metadata }]
};

// 初始化测试用户
users.set('test@chenyi.com', {
  id: uuidv4(),
  email: 'test@chenyi.com',
  password: '123456',
  name: '测试用户',
  createdAt: Date.now()
});

// 确保数据目录存在
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ==================== 数据持久化 ====================
function saveData() {
  const dataPath = path.join(DATA_DIR, 'sync-data.json');
  const data = {
    users: Array.from(users.entries()),
    deviceBindings: Array.from(deviceBindings.entries()),
    memories: Array.from(syncData.memories.entries()),
    configs: Array.from(syncData.configs.entries()),
    sessions: Array.from(syncData.sessions.entries()),
  };
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
}

function loadData() {
  const dataPath = path.join(DATA_DIR, 'sync-data.json');
  if (fs.existsSync(dataPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
      if (data.users) data.users.forEach(([k, v]) => users.set(k, v));
      if (data.deviceBindings) data.deviceBindings.forEach(([k, v]) => deviceBindings.set(k, v));
      if (data.memories) data.memories.forEach(([k, v]) => syncData.memories.set(k, v));
      if (data.configs) data.configs.forEach(([k, v]) => syncData.configs.set(k, v));
      if (data.sessions) data.sessions.forEach(([k, v]) => syncData.sessions.set(k, v));
      console.log('[云端] 数据加载完成');
    } catch (e) {
      console.error('[云端] 数据加载失败:', e.message);
    }
  }
}

// 定时保存
setInterval(saveData, 60000); // 每分钟保存一次

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

  // 读取请求体
  const readBody = () => new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { resolve({}); }
    });
  });

  try {
    // ==================== 公开接口 ====================
    
    // 健康检查
    if (path === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        service: 'chenyi-cloud',
        version: '3.1.0',
        mode: 'sync-only',
        users: users.size,
        devices: connections.size,
      }));
      return;
    }

    // 用户注册
    if (path === '/api/auth/register' && req.method === 'POST') {
      const body = await readBody();
      const { username, password, name } = body;
      
      // 检查用户名是否已存在
      for (const [key, u] of users.entries()) {
        if (u.username === username || key === username) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: '用户名已注册' }));
          return;
        }
      }

      const userId = uuidv4();
      const userData = {
        id: userId,
        username,
        password,
        name: name || username,
        createdAt: Date.now(),
      };
      users.set(username, userData);

      const token = createToken(userId, username);
      saveData();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        token,
        user: { id: userId, name: name || username }
      }));
      return;
    }

    // 用户登录
    if (path === '/api/auth/login' && req.method === 'POST') {
      const body = await readBody();
      const { username, password } = body;
      
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
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '用户名或密码错误' }));
        return;
      }

      const token = createToken(user.id, user.username || user.name);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        token,
        user: { id: user.id, name: user.name, username: user.username }
      }));
      return;
    }

    // ==================== 需要认证的接口 ====================
    
    // 验证Token
    const auth = req.headers.authorization;
    const token = auth?.replace('Bearer ', '');
    const payload = verifyToken(token);
    
    if (!payload && path.startsWith('/api/')) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '未授权' }));
      return;
    }

    // 获取用户信息
    if (path === '/api/user') {
      const user = users.get(payload.email);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: user.id,
        email: user.email,
        name: user.name,
        createdAt: user.createdAt,
      }));
      return;
    }

    // 设备列表
    if (path === '/api/devices') {
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

    // 解绑设备
    if (path.match(/^\/api\/devices\/[^/]+$/) && req.method === 'DELETE') {
      const deviceId = path.split('/')[3];
      const binding = deviceBindings.get(deviceId);
      
      if (!binding || binding.userId !== payload.userId) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '设备不存在' }));
        return;
      }

      deviceBindings.delete(deviceId);
      userDevices.get(payload.userId)?.delete(deviceId);
      saveData();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
      return;
    }

    // ==================== 数据同步接口 ====================

    // 上传记忆
    if (path === '/api/sync/memories' && req.method === 'POST') {
      const body = await readBody();
      const { memories } = body;
      
      if (!Array.isArray(memories)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '无效的数据格式' }));
        return;
      }

      syncData.memories.set(payload.userId, memories.map(m => ({
        ...m,
        syncedAt: Date.now(),
      })));
      saveData();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, count: memories.length }));
      return;
    }

    // 下载记忆
    if (path === '/api/sync/memories' && req.method === 'GET') {
      const memories = syncData.memories.get(payload.userId) || [];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ memories }));
      return;
    }

    // 上传配置
    if (path === '/api/sync/config' && req.method === 'POST') {
      const body = await readBody();
      syncData.configs.set(payload.userId, {
        ...body,
        syncedAt: Date.now(),
      });
      saveData();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
      return;
    }

    // 下载配置
    if (path === '/api/sync/config' && req.method === 'GET') {
      const config = syncData.configs.get(payload.userId) || {};
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ config }));
      return;
    }

    // 上传会话
    if (path === '/api/sync/sessions' && req.method === 'POST') {
      const body = await readBody();
      const { sessions: sessionList } = body;
      
      if (!Array.isArray(sessionList)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '无效的数据格式' }));
        return;
      }

      syncData.sessions.set(payload.userId, sessionList.map(s => ({
        ...s,
        syncedAt: Date.now(),
      })));
      saveData();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, count: sessionList.length }));
      return;
    }

    // 下载会话
    if (path === '/api/sync/sessions' && req.method === 'GET') {
      const sessions = syncData.sessions.get(payload.userId) || [];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sessions }));
      return;
    }

    // 删除会话
    if (path.match(/^\/api\/sync\/sessions\/[^/]+$/) && req.method === 'DELETE') {
      const sessionId = path.split('/')[4];
      const sessions = syncData.sessions.get(payload.userId) || [];
      const filtered = sessions.filter(s => s.id !== sessionId && s.session_id !== sessionId);
      syncData.sessions.set(payload.userId, filtered);
      saveData();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
      return;
    }

    // 重命名会话
    if (path.match(/^\/api\/sync\/sessions\/[^/]+$/) && req.method === 'PATCH') {
      const sessionId = path.split('/')[4];
      const body = await readBody();
      const sessions = syncData.sessions.get(payload.userId) || [];
      const session = sessions.find(s => s.id === sessionId || s.session_id === sessionId);
      if (session && body.title) {
        session.title = body.title;
        session.updatedAt = Date.now();
        saveData();
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, session }));
      return;
    }

    // 同步会话消息
    if (path.match(/^\/api\/sync\/sessions\/[^/]+\/messages$/) && req.method === 'POST') {
      const sessionId = path.split('/')[4];
      const body = await readBody();
      const sessions = syncData.sessions.get(payload.userId) || [];
      const session = sessions.find(s => s.id === sessionId || s.session_id === sessionId);
      if (session) {
        session.messages = session.messages || [];
        // 追加新消息
        if (Array.isArray(body)) {
          session.messages.push(...body);
        } else if (body.messages) {
          session.messages.push(...body.messages);
        }
        session.updatedAt = Date.now();
        saveData();
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
      return;
    }

    // 获取会话消息
    if (path.match(/^\/api\/sync\/sessions\/[^/]+\/messages$/) && req.method === 'GET') {
      const sessionId = path.split('/')[4];
      const sessions = syncData.sessions.get(payload.userId) || [];
      const session = sessions.find(s => s.id === sessionId || s.session_id === sessionId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ messages: session?.messages || [] }));
      return;
    }

    // 完整同步
    if (path === '/api/sync/full' && req.method === 'POST') {
      const body = await readBody();
      const { memories, config, sessions } = body;

      if (memories) {
        syncData.memories.set(payload.userId, memories.map(m => ({
          ...m,
          syncedAt: Date.now(),
        })));
      }

      if (config) {
        syncData.configs.set(payload.userId, {
          ...config,
          syncedAt: Date.now(),
        });
      }

      if (sessions) {
        syncData.sessions.set(payload.userId, sessions.map(s => ({
          ...s,
          syncedAt: Date.now(),
        })));
      }

      saveData();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
      return;
    }

    if (path === '/api/sync/full' && req.method === 'GET') {
      const data = {
        memories: syncData.memories.get(payload.userId) || [],
        config: syncData.configs.get(payload.userId) || {},
        sessions: syncData.sessions.get(payload.userId) || [],
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
      return;
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));

  } catch (error) {
    console.error('[云端] 请求处理错误:', error);
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
          // 验证token
          const payload = verifyToken(msg.token);
          if (!payload) {
            ws.send(JSON.stringify({ type: 'error', message: '无效的token' }));
            return;
          }

          if (deviceBindings.has(deviceId)) {
            ws.send(JSON.stringify({ type: 'error', message: '设备已绑定' }));
            return;
          }

          deviceBindings.set(deviceId, {
            userId: payload.userId,
            deviceName: msg.deviceName || '未命名设备',
            platform: msg.platform || 'unknown',
            boundAt: Date.now(),
          });
          conn.userId = payload.userId;
          
          if (!userDevices.has(payload.userId)) {
            userDevices.set(payload.userId, new Set());
          }
          userDevices.get(payload.userId).add(deviceId);
          saveData();
          
          ws.send(JSON.stringify({ type: 'bound', deviceId }));
          console.log(`[WS] 设备绑定: ${deviceId} -> ${payload.userId}`);
          break;

        case 'sync_request':
          // 客户端请求同步数据
          if (!conn.userId) {
            ws.send(JSON.stringify({ type: 'error', message: '设备未绑定' }));
            return;
          }

          const syncResponse = {
            type: 'sync_data',
            memories: syncData.memories.get(conn.userId) || [],
            config: syncData.configs.get(conn.userId) || {},
            sessions: syncData.sessions.get(conn.userId) || [],
          };
          ws.send(JSON.stringify(syncResponse));
          break;

        case 'sync_upload':
          // 客户端上传同步数据
          if (!conn.userId) {
            ws.send(JSON.stringify({ type: 'error', message: '设备未绑定' }));
            return;
          }

          if (msg.memories) {
            syncData.memories.set(conn.userId, msg.memories.map(m => ({
              ...m,
              syncedAt: Date.now(),
            })));
          }
          if (msg.config) {
            syncData.configs.set(conn.userId, {
              ...msg.config,
              syncedAt: Date.now(),
            });
          }
          if (msg.sessions) {
            syncData.sessions.set(conn.userId, msg.sessions.map(s => ({
              ...s,
              syncedAt: Date.now(),
            })));
          }
          saveData();

          ws.send(JSON.stringify({ type: 'sync_complete' }));
          break;

        case 'message':
          // 跨设备消息路由
          if (!conn.userId) {
            ws.send(JSON.stringify({ type: 'error', message: '设备未绑定' }));
            return;
          }

          // 转发给同一用户的其他设备
          const userDeviceSet = userDevices.get(conn.userId);
          if (userDeviceSet) {
            for (const targetDeviceId of userDeviceSet) {
              if (targetDeviceId !== deviceId) {
                const targetConn = connections.get(targetDeviceId);
                if (targetConn && targetConn.ws.readyState === 1) {
                  targetConn.ws.send(JSON.stringify({
                    type: 'message',
                    from: deviceId,
                    payload: msg.payload,
                  }));
                }
              }
            }
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
loadData();

server.listen(PORT, () => {
  console.log(`[晨翼云端] 服务启动 - 端口 ${PORT}`);
  console.log(`[晨翼云端] 模式: 数据同步`);
  console.log(`[晨翼云端] 数据目录: ${DATA_DIR}`);
});
