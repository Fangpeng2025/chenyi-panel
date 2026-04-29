/**
 * 晨翼Agent - Electron主进程
 * 负责WebSocket连接、IPC通信、系统集成
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
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
  connectionManager = new ConnectionManager({
    wsUrl: process.env.NODE_ENV === 'development' 
      ? CLOUD_CONFIG.DEV_WS_URL 
      : CLOUD_CONFIG.WS_URL,
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
    // TODO: 调用云端API登录
    return { success: true, token: 'test_token' };
  });

  // 连接云端
  ipcMain.handle('connect', async (event, token) => {
    connectionManager.connect(token);
    return { success: true };
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
    // TODO: 从云端获取设备列表
    return { devices: [] };
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