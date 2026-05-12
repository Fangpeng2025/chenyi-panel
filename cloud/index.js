/**
 * 云端同步服务 - HTTP API入口
 */

const http = require('http');
const url = require('url');
const { PORT } = require('./sync-server');
const auth = require('./auth');
const device = require('./device');
const sync = require('./sync');
const { initWebSocket } = require('./ws-router');

// 创建HTTP服务器
const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const path = parsedUrl.pathname;
  const method = req.method;
  
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }
  
  // 解析请求体
  let body = null;
  if (method === 'POST' || method === 'PUT') {
    body = await parseBody(req);
  }
  
  // 路由
  try {
    if (path === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: 'chenyi-cloud-sync' }));
    }
    // 认证
    else if (path === '/api/auth/register' && method === 'POST') {
      const result = auth.register(body.email, body.password, body.name);
      sendJSON(res, result.error ? 400 : 200, result);
    }
    else if (path === '/api/auth/login' && method === 'POST') {
      const result = auth.login(body.email, body.password);
      sendJSON(res, result.error ? 401 : 200, result);
    }
    // 设备
    else if (path === '/api/device/register' && method === 'POST') {
      const userId = getUserId(req);
      if (!userId) return send401(res);
      const result = device.registerDevice(userId, body);
      sendJSON(res, 200, result);
    }
    else if (path === '/api/device/list' && method === 'GET') {
      const userId = getUserId(req);
      if (!userId) return send401(res);
      const result = device.getUserDevices(userId);
      sendJSON(res, 200, result);
    }
    // 设备详情 /^\/api\/device\/(.+)$/
    else if (method === 'GET' && path.startsWith('/api/device/') && path !== '/api/device/list' && path !== '/api/device/register') {
      const deviceId = path.replace('/api/device/', '');
      const result = device.getDevice(deviceId);
      sendJSON(res, result.error ? 404 : 200, result);
    }
    // 更新设备
    else if (method === 'PUT' && path.startsWith('/api/device/')) {
      const deviceId = path.replace('/api/device/', '');
      const userId = getUserId(req);
      if (!userId) return send401(res);
      const result = device.updateDevice(deviceId, body);
      sendJSON(res, result.error ? 400 : 200, result);
    }
    // 删除设备
    else if (method === 'DELETE' && path.startsWith('/api/device/')) {
      const deviceId = path.replace('/api/device/', '');
      const userId = getUserId(req);
      if (!userId) return send401(res);
      const result = device.deleteDevice(userId, deviceId);
      sendJSON(res, result.error ? 400 : 200, result);
    }
    // 设备心跳
    else if (path === '/api/device/heartbeat' && method === 'POST') {
      const userId = getUserId(req);
      if (!userId) return send401(res);
      const deviceId = body.deviceId;
      if (!deviceId) return sendJSON(res, 400, { error: '缺少deviceId' });
      const result = device.deviceHeartbeat(deviceId);
      sendJSON(res, result.error ? 404 : 200, result);
    }
    // 会话
    else if (path === '/api/session' && method === 'POST') {
      const userId = getUserId(req);
      if (!userId) return send401(res);
      const result = sync.createSession(userId, body);
      sendJSON(res, 200, result);
    }
    else if (path === '/api/session' && method === 'GET') {
      const userId = getUserId(req);
      if (!userId) return send401(res);
      const result = sync.getUserSessions(userId);
      sendJSON(res, 200, result);
    }
    // 任务
    else if (path === '/api/task' && method === 'POST') {
      const userId = getUserId(req);
      if (!userId) return send401(res);
      const result = sync.createTask(userId, body);
      sendJSON(res, 200, result);
    }
    else if (path === '/api/task' && method === 'GET') {
      const userId = getUserId(req);
      if (!userId) return send401(res);
      const result = sync.getUserTasks(userId);
      sendJSON(res, 200, result);
    }
    // 记忆
    else if (path === '/api/memory' && method === 'POST') {
      const userId = getUserId(req);
      if (!userId) return send401(res);
      const result = sync.saveMemory(userId, body.content, body.metadata);
      sendJSON(res, 200, result);
    }
    else if (path === '/api/memory' && method === 'GET') {
      const userId = getUserId(req);
      if (!userId) return send401(res);
      const result = sync.getUserMemories(userId);
      sendJSON(res, 200, result);
    }
    else {
      send404(res);
    }
  } catch (err) {
    console.error('[API] 错误:', err);
    sendJSON(res, 500, { error: '服务器错误' });
  }
});

// 初始化WebSocket
initWebSocket(server);

// 启动服务
server.listen(PORT, () => {
  console.log(`云端同步服务运行在端口 ${PORT}`);
  console.log('API: http://localhost:' + PORT);
  console.log('WebSocket: ws://localhost:' + PORT + '/ws');
});

// 工具函数
function parseBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => {
      try {
        resolve(JSON.parse(data));
      } catch {
        resolve({});
      }
    });
  });
}

function getUserId(req) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return null;
  const session = auth.verifyToken(token);
  return session?.userId;
}

function sendJSON(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function send401(res) {
  sendJSON(res, 401, { error: '未授权' });
}

function send404(res) {
  sendJSON(res, 404, { error: '未找到' });
}
