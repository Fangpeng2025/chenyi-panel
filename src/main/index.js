/**
 * 晨翼Agent - Electron主进程
 * 负责WebSocket连接、IPC通信、系统集成
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const http = require('http');
const { machineIdSync } = require('node-machine-id');
const ConnectionManager = require('./connection');
const Executor = require('./executor');
const { 
  MessageType, 
  DeviceType, 
  DeviceCapability,
  createRegisterMessage 
} = require('../shared/protocol');
const { CLOUD_CONFIG, HEARTBEAT_CONFIG, STORAGE_KEYS } = require('../shared/constants');

let mainWindow = null;
let connectionManager = null;
let executor = null;
let currentToken = null;

// ==================== HTTP工具 ====================
function apiRequest(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, CLOUD_CONFIG.API_URL);
    const options = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname,
      method,
      headers: {
        'Content-Type': 'application/json'
      }
    };
    
    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }
    
    const req = http.request(options, (res) => {
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
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

/**
 * 创建主窗口
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: '晨翼Agent',
    icon: path.join(__dirname, '../../assets/icon.png'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: true
    },
    frame: false,  // 无边框窗口
    backgroundColor: '#1a1a2e'
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  // 开发模式下打开DevTools
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/**
 * 初始化连接管理器
 */
function initConnection() {
  // WebSocket连接地址
  const wsBaseUrl = process.env.NODE_ENV === 'development' 
    ? CLOUD_CONFIG.DEV_WS_URL 
    : CLOUD_CONFIG.WS_URL;
  
  connectionManager = new ConnectionManager({
    wsUrl: wsBaseUrl,
    heartbeatInterval: HEARTBEAT_CONFIG.INTERVAL,
    heartbeatTimeout: HEARTBEAT_CONFIG.TIMEOUT
  });

  // 连接事件
  connectionManager.on('connected', () => {
    // 连接成功后注册设备
    const deviceId = generateDeviceId();
    connectionManager.send(createRegisterMessage(
      deviceId,
      DeviceType.ELECTRON,
      getDeviceName(),
      [DeviceCapability.AI_CHAT, DeviceCapability.FILE_SYNC]
    ));
    
    mainWindow?.webContents.send('connection-status', { connected: true });
  });

  connectionManager.on('disconnected', () => {
    mainWindow?.webContents.send('connection-status', { connected: false });
  });

  connectionManager.on('message', (msg) => {
    handleMessage(msg);
  });

  connectionManager.on('error', (err) => {
    mainWindow?.webContents.send('error', err.message);
  });
}

/**
 * 初始化指令执行器
 */
function initExecutor() {
  executor = new Executor();
  
  executor.on('result', (result) => {
    connectionManager.send({
      type: MessageType.CONTROL_RESULT,
      requestId: result.requestId,
      data: result
    });
  });
}

/**
 * 处理接收到的消息
 */
function handleMessage(msg) {
  switch (msg.type) {
    case MessageType.REGISTER_ACK:
      // 设备注册成功
      mainWindow?.webContents.send('registered', msg.data);
      break;

    case MessageType.CONTROL:
      // 收到控制指令，执行
      executor.execute(msg);
      break;

    case MessageType.TASK:
      // 收到任务
      executor.executeTask(msg);
      break;

    case MessageType.DEVICE_UPDATE:
      // 设备状态更新
      mainWindow?.webContents.send('device-update', msg.data);
      break;

    case MessageType.PONG:
      // 心跳响应
      connectionManager.resetHeartbeat();
      break;

    case MessageType.ERROR:
      mainWindow?.webContents.send('error', msg.data.message);
      break;
  }
}

/**
 * 生成设备ID
 */
function generateDeviceId() {
  const machineId = machineIdSync();
  return `electron_${machineId}`;
}

/**
 * 获取设备名称
 */
function getDeviceName() {
  return require('os').hostname() || 'Unknown PC';
}

/**
 * 设置IPC通信
 */
function setupIPC() {
  // 登录
  ipcMain.handle('login', async (event, { email, password }) => {
    try {
      const result = await apiRequest('POST', '/auth/login', { email, password });
      if (result.token) {
        currentToken = result.token;
        // 保存到本地存储
        mainWindow?.webContents.session?.cookies?.set({
          url: CLOUD_CONFIG.API_URL,
          name: STORAGE_KEYS.TOKEN,
          value: result.token
        });
      }
      return result;
    } catch (err) {
      return { error: err.message };
    }
  });

  // 连接云端
  ipcMain.handle('connect', async (event, token) => {
    currentToken = token || currentToken;
    if (currentToken) {
      // 构建WebSocket URL，带token参数
      const wsUrl = `${CLOUD_CONFIG.WS_URL}?token=${currentToken}`;
      connectionManager.connect(currentToken);
    }
    return { success: !!currentToken };
  });

  // 断开连接
  ipcMain.handle('disconnect', async () => {
    connectionManager.disconnect();
    return { success: true };
  });

  // 发送消息
  ipcMain.handle('send-message', async (event, msg) => {
    connectionManager.send(msg);
    return { success: true };
  });

  // 发送AI对话
  ipcMain.handle('ai-chat', async (event, content) => {
    connectionManager.send({
      type: 'ai_chat',
      data: { content }
    });
    return { success: true };
  });

  // 控制设备
  ipcMain.handle('control-device', async (event, { targetId, action, params }) => {
    const requestId = `req_${Date.now()}`;
    connectionManager.send({
      type: MessageType.CONTROL,
      requestId,
      target: targetId,
      data: { action, params }
    });
    return { requestId };
  });

  // 获取设备列表
  ipcMain.handle('get-devices', async () => {
    try {
      return await apiRequest('GET', '/devices', null, currentToken);
    } catch (err) {
      return { error: err.message, devices: [] };
    }
  });

  // 窗口控制
  ipcMain.on('window-minimize', () => mainWindow?.minimize());
  ipcMain.on('window-maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });
  ipcMain.on('window-close', () => mainWindow?.close());
}

// 应用启动
app.whenReady().then(() => {
  createWindow();
  initConnection();
  initExecutor();
  setupIPC();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});