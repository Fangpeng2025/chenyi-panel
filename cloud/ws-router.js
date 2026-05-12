/**
 * WebSocket消息路由模块
 * 设备间P2P通信
 */

const { WebSocketServer } = require('ws');
const { devices } = require('./sync-server');
const { verifyToken } = require('./auth');
const { updateDeviceStatus, deviceOffline } = require('./device');

let wss = null;
const deviceConnections = new Map(); // deviceId -> ws

// 初始化WebSocket服务器
function initWebSocket(server) {
  wss = new WebSocketServer({ server, path: '/ws' });
  
  wss.on('connection', (ws, req) => {
    const params = new URL(req.url, 'http://localhost').searchParams;
    const token = params.get('token');
    const deviceId = params.get('deviceId');
    
    // 验证Token
    const session = verifyToken(token);
    if (!session) {
      ws.close(4001, '认证失败');
      return;
    }
    
    // 注册设备连接
    deviceConnections.set(deviceId, ws);
    updateDeviceStatus(deviceId, { online: true });
    
    console.log(`[WS] 设备已连接: ${deviceId}`);
    
    ws.on('message', (data) => {
      handleMessage(deviceId, data);
    });
    
    ws.on('close', () => {
      deviceConnections.delete(deviceId);
      deviceOffline(deviceId);
      console.log(`[WS] 设备已断开: ${deviceId}`);
    });
    
    ws.on('error', (err) => {
      console.error(`[WS] 错误: ${deviceId}`, err.message);
    });
  });
  
  console.log('[WS] WebSocket服务器已启动');
}

// 处理消息
function handleMessage(fromDeviceId, data) {
  try {
    const msg = JSON.parse(data.toString());
    
    switch (msg.type) {
      case 'control':
        // 控制指令：转发到目标设备
        forwardToDevice(msg.target, {
          type: 'control',
          from: fromDeviceId,
          data: msg.data
        });
        break;
        
      case 'sync':
        // 同步消息：广播到用户所有设备
        broadcastToUserDevices(fromDeviceId, msg);
        break;
        
      case 'ping':
        // 心跳
        const ws = deviceConnections.get(fromDeviceId);
        if (ws) {
          ws.send(JSON.stringify({ type: 'pong' }));
        }
        break;
        
      default:
        console.warn(`[WS] 未知消息类型: ${msg.type}`);
    }
  } catch (err) {
    console.error('[WS] 消息处理失败:', err.message);
  }
}

// 转发消息到指定设备
function forwardToDevice(deviceId, msg) {
  const ws = deviceConnections.get(deviceId);
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify(msg));
    return true;
  }
  return false;
}

// 广播到用户所有设备
function broadcastToUserDevices(fromDeviceId, msg) {
  const device = devices.get(fromDeviceId);
  if (!device) return;
  
  for (const [devId, ws] of deviceConnections) {
    if (devId !== fromDeviceId) {
      const dev = devices.get(devId);
      if (dev && dev.userId === device.userId && ws.readyState === 1) {
        ws.send(JSON.stringify(msg));
      }
    }
  }
}

module.exports = {
  initWebSocket,
  forwardToDevice,
  broadcastToUserDevices
};