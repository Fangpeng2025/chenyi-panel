/**
 * 晨翼Agent - Electron主进程
 * 负责WebSocket连接、IPC通信、系统集成
 * 
 * v2.0 - 集成改进的IPC模块、日志系统和状态恢复
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const http = require('http');
const { machineIdSync } = require('node-machine-id');
const ConnectionManager = require('./connection');
const Executor = require('./executor');
const PhoneController = require('./phone-controller');
const ScreenStream = require('./screen-stream');
const { RustKernel } = require('../native');
const { registerModelConfigHandlers } = require('./model-config-ipc');
const {
  MessageType,
  DeviceType,
  DeviceCapability,
  createRegisterMessage
} = require('../shared/protocol');
const { CLOUD_CONFIG, KERNEL_CONFIG, HEARTBEAT_CONFIG, STORAGE_KEYS } = require('../shared/constants');

// ==================== 改进的IPC模块 ====================
const { Logger, LogLevel, createLogger } = require('./logger');
const KernelClient = require('./kernel-client');
const KernelIPC = require('./kernel-ipc');
const { registerChenYiIPC } = require('./chenyi-ipc');
const { StateRecoveryManager, StateType, RecoveryStrategy } = require('./state-recovery');

// ==================== 全局实例 ====================
// 日志系统
const logger = createLogger({
  name: 'Main',
  level: process.env.LOG_LEVEL ? LogLevel[process.env.LOG_LEVEL] : LogLevel.INFO,
  file: path.join(app.getPath('userData'), 'logs', 'main.log')
});

// 状态恢复管理器
let stateRecovery = null;

// IPC通信方式选择
let kernelClient = null;  // HTTP客户端
let kernelIPC = null;    // 进程IPC客户端

// 通信方式配置
const IPC_MODE = process.env.IPC_MODE || 'http'; // 'http' 或 'ipc'

let mainWindow = null;
let connectionManager = null;
let executor = null;
let screenStream = null;
let currentToken = null;
let localDevice = null;  // 本机设备信息
let phoneController = null;
let rustKernel = null;
let currentUser = null; // 当前用户信息

// ==================== HTTP工具 ====================
function apiRequest(method, endpoint, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const apiUrl = CLOUD_CONFIG.API_URL; // e.g. http://8.147.232.175/api/v1
    const url = new URL(apiUrl);
    const basePath = apiUrl.replace(/^http:\/\/[^\/]+/, ''); // /api/v1
    const fullPath = basePath + endpoint; // /api/v1/auth/login

    const options = {
      hostname: url.hostname,
      port: url.port || 80,
      path: fullPath,
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
  const trace = logger.startTrace('createWindow');
  
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
    logger.info('主窗口已关闭');
  });
  
  trace.end();
}

/**
 * 初始化连接管理器
 */
function initConnection() {
  const trace = logger.startTrace('initConnection');
  
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
    logger.info('WebSocket连接成功');
    
    // 连接成功后注册设备
    const deviceId = generateDeviceId();
    const deviceName = getDeviceName();

    // 保存本机设备信息
    localDevice = {
      deviceId,
      deviceType: DeviceType.ELECTRON,
      deviceName,
      capabilities: [DeviceCapability.AI_CHAT, DeviceCapability.FILE_SYNC],
      online: true,
      isLocal: true,
      platform: process.platform,
      lastSeen: new Date().toISOString()
    };

    // 保存状态到恢复管理器
    if (stateRecovery) {
      stateRecovery.saveState(StateType.USER_CONTEXT, 'localDevice', localDevice);
    }

    connectionManager.send(createRegisterMessage(
      deviceId,
      DeviceType.ELECTRON,
      deviceName,
      [DeviceCapability.AI_CHAT, DeviceCapability.FILE_SYNC]
    ));

    mainWindow?.webContents.send('connection-status', { connected: true });
    // 立即通知渲染进程本机设备已注册
    mainWindow?.webContents.send('registered', localDevice);
  });

  connectionManager.on('disconnected', () => {
    logger.warn('WebSocket连接断开');
    mainWindow?.webContents.send('connection-status', { connected: false });
  });

  connectionManager.on('message', (msg) => {
    handleMessage(msg);
  });

  connectionManager.on('error', (err) => {
    logger.error('WebSocket连接错误', { error: err.message });
    mainWindow?.webContents.send('error', err.message);
  });
  
  trace.end();
}

/**
 * 初始化屏幕投屏
 */
function initScreenStream() {
  screenStream = new ScreenStream();
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
 * 初始化状态恢复管理器
 */
function initStateRecovery() {
  stateRecovery = new StateRecoveryManager({
    maxHistorySize: 100,
    maxRecoveryAttempts: 3,
    checkpointInterval: 60000
  });
  
  stateRecovery.initialize();
  logger.info('状态恢复管理器已初始化');
  
  // 监听状态恢复事件
  stateRecovery.on('recovery:complete', (result) => {
    logger.info('状态恢复完成', {
      recoveredStates: result.recoveredStates,
      recoveredOperations: result.recoveredOperations
    });
  });
  
  stateRecovery.on('recovery:failed', (result) => {
    logger.error('状态恢复失败', { errors: result.errors });
  });
}

/**
 * 初始化IPC通信（根据配置选择HTTP或进程IPC）
 */
async function initIPCCommunication() {
  const trace = logger.startTrace('initIPCCommunication', { mode: IPC_MODE });
  
  try {
    if (IPC_MODE === 'ipc') {
      // 使用进程IPC通信
      kernelIPC = new KernelIPC({
        logger: createLogger({ name: 'KernelIPC', level: logger.level }),
        recoveryManager: stateRecovery,
        autoRestart: true,
        maxRestartAttempts: 5
      });
      
      // 监听IPC事件
      kernelIPC.on('ready', () => {
        logger.info('KernelIPC已就绪');
      });
      
      kernelIPC.on('error', (err) => {
        logger.error('KernelIPC错误', { type: err.type, message: err.message });
      });
      
      kernelIPC.on('exit', ({ code, signal }) => {
        logger.warn('KernelIPC进程退出', { code, signal });
      });
      
      kernelIPC.start();
      
      // 注册ChenYi IPC处理器
      registerChenYiIPC(mainWindow, kernelIPC);
      
      logger.info('进程IPC通信已初始化');
    } else {
      // 使用HTTP通信
      const apiUrl = process.env.NODE_ENV === 'development'
        ? KERNEL_CONFIG.API_URL.replace('https://', 'http://localhost:8080')
        : KERNEL_CONFIG.API_URL;
      
      kernelClient = new KernelClient(apiUrl, {
        maxRetries: 3,
        retryDelay: 1000,
        failureThreshold: 5,
        circuitTimeout: 30000,
        defaultTimeout: 30000
      });
      
      // 注册ChenYi IPC处理器
      registerChenYiIPC(mainWindow, kernelClient);
      
      logger.info('HTTP通信已初始化', { apiUrl });
    }
    
    trace.end({ success: true });
  } catch (err) {
    logger.error('IPC通信初始化失败', { error: err.message });
    trace.end({ success: false, error: err.message });
    throw err;
  }
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
      // 收到控制指令,执行
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
  ipcMain.handle('login', async (event, { username, password }) => {
    const trace = logger.startTrace('login', { username });
    
    try {
      if (!rustKernel || !rustKernel.initialized) {
        // 尝试初始化内核
        const initResult = await initKernel();
        if (!initResult) {
          logger.error('登录失败: 内核初始化失败');
          return { success: false, error: '内核初始化失败' };
        }
      }
      
      // 确保云端配置已设置
      if (!rustKernel.cloudConfig) {
        rustKernel.setCloudConfig('https://chenyi.xintiandi.online/cloud/api');
      }
      
      logger.info('尝试登录', { username });
      const result = await rustKernel.login(username, password);
      logger.info('登录结果', { success: result.success, error: result.error });
      
      if (result.success && result.token) {
        currentToken = result.token;
        currentUser = result.user;
        
        // 保存状态到恢复管理器
        if (stateRecovery) {
          stateRecovery.saveState(StateType.USER_CONTEXT, 'auth', {
            token: currentToken,
            user: currentUser,
            loginTime: Date.now()
          });
        }
        
        // 注册设备
        try {
          const deviceId = generateDeviceId();
          await rustKernel.registerDevice({
            deviceId,
            deviceName: getDeviceName(),
            deviceType: 'electron',
            capabilities: ['ai_chat', 'file_sync', 'control']
          });
          logger.info('设备注册成功', { deviceId });
        } catch (deviceErr) {
          logger.warn('设备注册失败', { error: deviceErr.message });
          // 不影响登录成功
        }
        
        trace.end({ success: true });
        return { success: true, token: result.token, user: result.user };
      }
      trace.end({ success: false });
      return { success: false, error: result.error || '登录失败' };
    } catch (err) {
      logger.error('登录异常', { error: err.message, stack: err.stack });
      trace.end({ success: false, error: err.message });
      return { success: false, error: err.message };
    }
  });

  // 注册
  ipcMain.handle('register', async (event, { username, password, name }) => {
    const trace = logger.startTrace('register', { username, name });
    
    try {
      if (!rustKernel || !rustKernel.initialized) {
        // 尝试初始化内核
        const initResult = await initKernel();
        if (!initResult) {
          logger.error('注册失败: 内核初始化失败');
          return { success: false, error: '内核初始化失败' };
        }
      }
      
      // 确保云端配置已设置
      if (!rustKernel.cloudConfig) {
        rustKernel.setCloudConfig('https://chenyi.xintiandi.online/cloud/api');
      }
      
      logger.info('尝试注册', { username, name });
      const result = await rustKernel.register(username, password, name || username);
      logger.info('注册结果', { success: result.success, error: result.error });
      
      if (result.success && result.token) {
        currentToken = result.token;
        currentUser = result.user;
        
        // 保存状态到恢复管理器
        if (stateRecovery) {
          stateRecovery.saveState(StateType.USER_CONTEXT, 'auth', {
            token: currentToken,
            user: currentUser,
            loginTime: Date.now()
          });
        }
        
        // 注册设备
        try {
          const deviceId = generateDeviceId();
          await rustKernel.registerDevice({
            deviceId,
            deviceName: getDeviceName(),
            deviceType: 'electron',
            capabilities: ['ai_chat', 'file_sync', 'control']
          });
        } catch (deviceErr) {
          logger.warn('设备注册失败', { error: deviceErr.message });
        }
        
        trace.end({ success: true });
        return { success: true, token: result.token, user: result.user };
      }
      trace.end({ success: false });
      return { success: false, error: result.error || '注册失败' };
    } catch (err) {
      logger.error('注册异常', { error: err.message, stack: err.stack });
      trace.end({ success: false, error: err.message });
      return { success: false, error: err.message };
    }
  });

  // 连接云端
  ipcMain.handle('connect', async (event, token) => {
    currentToken = token || currentToken;
    if (!currentToken) {
      return { success: false, error: '无token' };
    }
    
    if (!rustKernel || !rustKernel.initialized) {
      return { success: false, error: '内核未初始化' };
    }
    
    // 设置云端配置
    rustKernel.setCloudConfig(CLOUD_CONFIG.API_URL, currentToken);
    return { success: true };
  });

  // 断开连接
  ipcMain.handle('disconnect', async () => {
    currentToken = null;
    currentUser = null;
    return { success: true };
  });

  // 发送消息
  ipcMain.handle('send-message', async (event, msg) => {
    // TODO: 通过内核发送消息
    return { success: true };
  });

  // 发送AI对话
  ipcMain.handle('ai-chat', async (event, content) => {
    const trace = logger.startTrace('ai-chat', { contentLength: content?.length });
    
    try {
      // 使用Rust内核
      if (rustKernel && rustKernel.initialized) {
        const result = await rustKernel.chat(content);
        trace.end({ success: true });
        return { response: { content: result } };
      }
      
      trace.end({ success: false, error: '内核未初始化' });
      return { error: '内核未初始化' };
    } catch (err) {
      logger.error('AI调用失败', { error: err.message });
      trace.end({ success: false, error: err.message });
      return { error: err.message || 'AI服务暂不可用' };
    }
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
      if (!rustKernel || !rustKernel.initialized) {
        return { devices: localDevice ? [localDevice] : [] };
      }
      const result = await rustKernel.getDevices();
      return result;
    } catch (err) {
      return { error: err.message, devices: localDevice ? [localDevice] : [] };
    }
  });

  // 窗口控制 (使用 handle 支持 invoke 调用)
  ipcMain.handle('window-minimize', () => mainWindow?.minimize());
  ipcMain.handle('window-maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });
  ipcMain.handle('window-close', () => mainWindow?.close());

  // ==================== 手机控制 ====================

  // 连接手机
  ipcMain.handle('connect-phone', async (event, { ip, port } = {}) => {
    try {
      const result = await PhoneController.connect(ip, port);
      if (result.success) {
        mainWindow?.webContents.send('phone-status', {
          connected: true,
          device: result.device
        });
      }
      return result;
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // 断开手机连接
  ipcMain.handle('disconnect-phone', async () => {
    PhoneController.disconnect();
    mainWindow?.webContents.send('phone-status', {
      connected: false,
      device: null
    });
    return { success: true };
  });

  // 手机控制操作
  ipcMain.handle('phone-control', async (event, { action, params }) => {
    if (!PhoneController.connected) {
      return { success: false, error: '手机未连接' };
    }

    try {
      switch (action) {
        case 'tap':
          return await PhoneController.tap(params.x, params.y);
        case 'swipe':
          return await PhoneController.swipe(params.x1, params.y1, params.x2, params.y2, params.duration);
        case 'input_text':
          return await PhoneController.inputText(params.text);
        case 'screenshot':
          return await PhoneController.screenshot();
        case 'dump_ui':
          return await PhoneController.dumpUi();
        case 'press_key':
          return await PhoneController.pressKey(params.key);
        case 'get_status':
          return await PhoneController.getStatus();
        case 'get_device_info':
          return await PhoneController.getDeviceInfo();
        case 'volume_up':
          return await PhoneController.volumeUp();
        case 'volume_down':
          return await PhoneController.volumeDown();
        case 'volume_mute':
          return await PhoneController.muteVolume();
        default:
          return { success: false, error: `未知操作: ${action}` };
      }
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // 获取手机连接状态
  ipcMain.handle('get-phone-status', async () => {
    return {
      connected: PhoneController.connected,
      device: PhoneController.deviceInfo
    };
  });

  // 监听手机控制器事件
  PhoneController.on('connected', (device) => {
    mainWindow?.webContents.send('phone-status', {
      connected: true,
      device
    });
  });

  PhoneController.on('disconnected', () => {
    mainWindow?.webContents.send('phone-status', {
      connected: false,
      device: null
    });
  });

  PhoneController.on('error', (err) => {
    mainWindow?.webContents.send('phone-error', err.message);
  });

  // ==================== 屏幕投屏 ====================

  // 获取可用的屏幕源列表
  ipcMain.handle('get-screen-sources', async () => {
    try {
      const sources = await screenStream.getSources();
      return { success: true, sources };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // 获取屏幕源详情
  ipcMain.handle('get-screen-source-details', async (event, sourceId) => {
    try {
      const details = await screenStream.getSourceDetails(sourceId);
      return { success: true, details };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // 获取屏幕信息
  ipcMain.handle('get-display-info', async () => {
    try {
      const info = screenStream.getDisplayInfo();
      return { success: true, info };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // 开始屏幕投屏
  ipcMain.handle('start-streaming', async (event, { sourceId, frameRate, quality }) => {
    try {
      if (frameRate) {
        screenStream.setFrameRate(frameRate);
      }
      if (quality) {
        screenStream.setQuality(quality);
      }

      const result = await screenStream.startStreaming(sourceId, (frameData) => {
        // 发送帧数据到渲染进程
        mainWindow?.webContents.send('stream-frame', frameData);
      });

      return result;
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // 停止屏幕投屏
  ipcMain.handle('stop-streaming', async () => {
    try {
      const result = await screenStream.stopStreaming();
      return result;
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // 获取投屏状态
  ipcMain.handle('get-stream-status', async () => {
    return screenStream.getStatus();
  });

  // 设置投屏参数
  ipcMain.handle('set-stream-config', async (event, { frameRate, quality }) => {
    try {
      if (frameRate !== undefined) {
        screenStream.setFrameRate(frameRate);
      }
      if (quality !== undefined) {
        screenStream.setQuality(quality);
      }
      return { success: true, config: screenStream.getStatus() };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ==================== Agent 内核 ====================

  // 初始化 Agent
  ipcMain.handle('agent:init', async (event, config) => {
    const trace = logger.startTrace('agent:init');
    
    try {
      if (!rustKernel) {
        rustKernel = new RustKernel();
      }
      const available = await rustKernel.initialize(config);
      if (available) {
        logger.info('Rust内核初始化成功');
        trace.end({ success: true });
        return { success: true, kernel: 'rust' };
      }
      trace.end({ success: false });
      return { success: false, error: '内核初始化失败' };
    } catch (err) {
      logger.error('内核初始化失败', { error: err.message });
      trace.end({ success: false, error: err.message });
      return { success: false, error: err.message };
    }
  });

  // Agent 对话
  ipcMain.handle('agent:chat', async (event, message, sessionId, options = {}) => {
    const { model, thinking, enableTools } = options;
    const trace = logger.startTrace('agent:chat', { sessionId, model, thinking, enableTools });
    logger.debug('收到消息', { message: message.substring(0, 50), sessionId, model, thinking, enableTools });
    
    try {
      if (!rustKernel || !rustKernel.initialized) {
        trace.end({ success: false, error: '内核未初始化' });
        return { success: false, error: '内核未初始化' };
      }
      
      // 获取会话历史消息（限制最近10条）
      let history = [];
      if (sessionId && rustKernel.cloudConfig && rustKernel.cloudConfig.token) {
        try {
          const cloudMessages = await rustKernel.getMessages(sessionId);
          if (cloudMessages && cloudMessages.messages) {
            // 只取最近10条消息
            const recentMessages = cloudMessages.messages.slice(-10);
            history = recentMessages.map(m => ({
              role: m.role,
              content: m.content
            }));
          }
        } catch (e) {
          logger.warn('获取历史消息失败', { error: e.message });
        }
      }
      
      // 使用历史消息进行对话（工具调用一直开启）
      const result = await rustKernel.chatWithHistory(message, history, { model, thinking, enableTools: true });
      
      // 处理工具调用结果
      if (result.tool_results && result.tool_results.length > 0) {
        logger.debug('工具调用', { toolResults: result.tool_results.map(t => t.name) });
      }
      
      // 同步到云端
      if (rustKernel.cloudConfig && rustKernel.cloudConfig.token && sessionId) {
        rustKernel.syncMessages(sessionId, [
          { id: `msg_${Date.now()}_user`, role: 'user', content: message, timestamp: Date.now() },
          { id: `msg_${Date.now()}_assistant`, role: 'assistant', content: result.content, timestamp: Date.now(), tool_results: result.tool_results }
        ]).catch(e => logger.warn('同步失败', { error: e.message }));
      }
      
      trace.end({ success: true });
      return { 
        success: true, 
        message: result.content,
        usage: result.usage,
        tool_results: result.tool_results
      };
    } catch (err) {
      logger.error('对话错误', { error: err.message, stack: err.stack });
      trace.end({ success: false, error: err.message });
      return { success: false, error: err.message };
    }
  });

  // Agent 流式对话 - 真正的SSE流式
  ipcMain.handle('agent:chat-stream', async (event, message, sessionId, options = {}) => {
    const { model, thinking } = options;
    const trace = logger.startTrace('agent:chat-stream', { sessionId, model });
    logger.debug('流式对话', { message: message.substring(0, 50), sessionId });
    
    try {
      if (!rustKernel || !rustKernel.initialized) {
        logger.warn('内核未初始化');
        trace.end({ success: false, error: '内核未初始化' });
        return { success: false, error: '内核未初始化' };
      }
      
      // 获取会话历史消息
      let history = [];
      if (sessionId && rustKernel.cloudConfig && rustKernel.cloudConfig.token) {
        try {
          const cloudMessages = await rustKernel.getMessages(sessionId);
          if (cloudMessages && cloudMessages.messages) {
            history = cloudMessages.messages.map(m => ({ role: m.role, content: m.content }));
          }
        } catch (e) {
          logger.warn('获取历史消息失败', { error: e.message });
        }
      }
      
      // 使用真正的SSE流式接口
      const streamEmitter = rustKernel.chatStream(message, history, {
        model: model || 'glm-5',
        enableTools: true
      });
      
      // 监听流式事件并转发到渲染进程
      streamEmitter.on('start', () => {
        logger.debug('start事件触发，发送到渲染进程');
        event.sender.send('agent:stream-event', { type: 'start' });
      });
      
      streamEmitter.on('thinking_delta', (delta) => {
        event.sender.send('agent:stream-event', {
          type: 'thinking_delta',
          delta: delta
        });
      });
      
      streamEmitter.on('text_delta', (delta) => {
        logger.debug('发送text_delta到渲染进程', { delta: delta.substring(0, 20) });
        event.sender.send('agent:stream-event', {
          type: 'text_delta',
          delta: delta
        });
      });
      
      streamEmitter.on('tool_call_start', (data) => {
        event.sender.send('agent:stream-event', {
          type: 'tool_call_start',
          id: data.id,
          name: data.name
        });
      });
      
      streamEmitter.on('tool_call_args', (data) => {
        event.sender.send('agent:stream-event', {
          type: 'tool_call_args',
          id: data.id,
          delta: data.delta
        });
      });
      
      streamEmitter.on('tool_call_delta', (data) => {
        event.sender.send('agent:stream-event', {
          type: 'tool_call_delta',
          name: data.name,
          arguments: data.arguments
        });
      });
      
      // 工具调用准备就绪 - 执行工具
      streamEmitter.on('tool_calls_ready', async (toolCalls) => {
        logger.debug('工具调用准备就绪', { toolCount: toolCalls.length });
        
        if (!rustKernel || !rustKernel.initialized) {
          logger.error('内核未初始化，无法执行工具');
          event.sender.send('agent:stream-event', {
            type: 'tool_call_result',
            id: 'error',
            success: false,
            result: '内核未初始化'
          });
          event.sender.send('agent:stream-event', { type: 'done' });
          return;
        }
        
        const toolResults = [];
        
        for (const toolCall of toolCalls) {
          const toolName = toolCall.name;
          let toolArgs = {};
          try {
            toolArgs = JSON.parse(toolCall.arguments || '{}');
          } catch (e) {
            logger.warn('工具参数解析失败', { error: e.message });
          }
          
          logger.debug('执行工具', { toolName, args: JSON.stringify(toolArgs).substring(0, 100) });
          
          // 发送工具开始事件
          event.sender.send('agent:stream-event', {
            type: 'tool_call_start',
            id: toolCall.id,
            name: toolName
          });
          
          try {
            // 执行工具
            const result = await rustKernel.executeTool(toolName, toolArgs);
            logger.debug('工具结果', { toolName, result: JSON.stringify(result).substring(0, 100) });
            
            // 保存工具结果
            toolResults.push({
              tool_call_id: toolCall.id,
              name: toolName,
              args: toolArgs,
              result: result
            });
            
            // 发送工具结果事件
            event.sender.send('agent:stream-event', {
              type: 'tool_call_result',
              id: toolCall.id,
              success: true,
              result: result
            });
          } catch (err) {
            logger.error('工具执行失败', { toolName, error: err.message });
            toolResults.push({
              tool_call_id: toolCall.id,
              name: toolName,
              args: toolArgs,
              result: { success: false, error: err.message }
            });
            event.sender.send('agent:stream-event', {
              type: 'tool_call_result',
              id: toolCall.id,
              success: false,
              result: err.message
            });
          }
        }
        
        // 将工具结果发送回模型继续生成
        logger.debug('工具执行完成，发送结果回模型继续生成');
        
        // 获取历史消息
        let history = [];
        if (sessionId && rustKernel.cloudConfig && rustKernel.cloudConfig.token) {
          try {
            const cloudMessages = await rustKernel.getMessages(sessionId);
            if (cloudMessages && cloudMessages.messages) {
              const recentMessages = cloudMessages.messages.slice(-10);
              history = recentMessages.map(m => ({ role: m.role, content: m.content }));
            }
          } catch (e) {
            logger.warn('获取历史消息失败', { error: e.message });
          }
        }
        
        // 添加用户消息
        history.push({ role: 'user', content: message });
        
        // 继续对话
        rustKernel.continueWithToolResults(history, toolResults, model, streamEmitter);
      });
      
      streamEmitter.on('done', () => {
        logger.debug('done事件触发');
        event.sender.send('agent:stream-event', { type: 'done' });
        trace.end({ success: true });
      });
      
      streamEmitter.on('error', (err) => {
        logger.error('流式对话错误', { error: err.message });
        event.sender.send('agent:stream-event', {
          type: 'error',
          message: err.message
        });
      });
      
      // 同步到云端（异步执行，不阻塞流式响应）
      let fullContent = '';
      streamEmitter.on('text_delta', (delta) => {
        fullContent += delta;
      });
      
      streamEmitter.on('done', async () => {
        if (rustKernel.cloudConfig && rustKernel.cloudConfig.token && sessionId) {
          rustKernel.syncMessages(sessionId, [
            { id: `msg_${Date.now()}_user`, role: 'user', content: message, timestamp: Date.now() },
            { id: `msg_${Date.now()}_assistant`, role: 'assistant', content: fullContent, timestamp: Date.now() }
          ]).catch(e => logger.warn('同步失败', { error: e.message }));
        }
      });
      
      return { success: true, streaming: true };
    } catch (err) {
      logger.error('流式对话错误', { error: err.message, stack: err.stack });
      event.sender.send('agent:stream-event', {
        type: 'error',
        message: err.message
      });
      trace.end({ success: false, error: err.message });
      return { success: false, error: err.message };
    }
  });

  // 获取内核状态
  ipcMain.handle('kernel:status', async () => {
    if (!rustKernel || !rustKernel.initialized) {
      return { connected: false };
    }
    return { connected: true, ...rustKernel.getStatus() };
  });

  // 调试日志
  ipcMain.on('debug-log', (event, message) => {
    logger.debug('渲染进程日志', { message });
  });

  // 内核记忆搜索
  ipcMain.handle('kernel:search-memory', async (event, query, k = 5) => {
    if (!rustKernel) {
      return { hits: [], error: '内核未初始化' };
    }
    
    try {
      const hits = await rustKernel.searchMemory(query, k);
      return { hits };
    } catch (err) {
      return { hits: [], error: err.message };
    }
  });

  // 内核保存记忆
  ipcMain.handle('kernel:save-memory', async (event, content, metadata = {}) => {
    if (!rustKernel) {
      return { success: false, error: '内核未初始化' };
    }
    
    try {
      const result = await rustKernel.saveMemory(content, metadata);
      return { success: true, id: result.id };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // 内核执行工具
  ipcMain.handle('kernel:execute-tool', async (event, toolName, params) => {
    if (!rustKernel) {
      return { success: false, error: '内核未初始化' };
    }
    
    try {
      const result = await rustKernel.executeTool(toolName, params);
      return { success: true, result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

// ==================== 会话管理（云同步） ====================

  // 获取会话列表
  ipcMain.handle('session:list', async () => {
    try {
      // 从云端获取会话列表
      if (rustKernel && rustKernel.cloudConfig && rustKernel.cloudConfig.token) {
        try {
          const cloudSessions = await rustKernel.getSessions();
          if (cloudSessions && cloudSessions.sessions) {
            return { success: true, sessions: cloudSessions.sessions };
          }
        } catch (cloudErr) {
          logger.warn('云端获取会话失败', { error: cloudErr.message });
          return { success: false, error: cloudErr.message, sessions: [] };
        }
      }
      
      return { success: false, error: '未登录', sessions: [] };
    } catch (err) {
      return { success: false, error: err.message, sessions: [] };
    }
  });

  // 创建会话
  ipcMain.handle('session:create', async (event, title = '新对话') => {
    try {
      if (!rustKernel || !rustKernel.cloudConfig || !rustKernel.cloudConfig.token) {
        return { success: false, error: '未登录' };
      }
      
      // 在云端创建会话
      const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const session = {
        id: sessionId,
        session_id: sessionId,
        title: title,
        created_at: Date.now(),
        updated_at: Date.now()
      };
      
      await rustKernel.createCloudSession(session);
      
      // 保存状态到恢复管理器
      if (stateRecovery) {
        stateRecovery.saveState(StateType.SESSION, sessionId, {
          sessionId,
          title,
          createdAt: Date.now()
        });
      }
      
      return { success: true, sessionId, session };
    } catch (err) {
      logger.error('创建会话失败', { error: err.message });
      return { success: false, error: err.message };
    }
  });

  // 删除会话
  ipcMain.handle('session:delete', async (event, sessionId) => {
    try {
      await rustKernel.deleteSession(sessionId);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // 切换会话
  ipcMain.handle('session:switch', async (event, sessionId) => {
    try {
      if (!rustKernel || !rustKernel.cloudConfig || !rustKernel.cloudConfig.token) {
        return { success: false, error: '未登录', messages: [] };
      }
      
      const cloudMessages = await rustKernel.getMessages(sessionId);
      return { success: true, messages: cloudMessages?.messages || [] };
    } catch (err) {
      logger.warn('获取消息失败', { error: err.message });
      return { success: false, error: err.message, messages: [] };
    }
  });

  // 手动同步会话到云端
  ipcMain.handle('session:sync', async (event, { sessionId, messages }) => {
    try {
      if (!rustKernel || !rustKernel.cloudConfig) {
        return { success: false, error: '云端未配置' };
      }
      
      await rustKernel.syncMessages(sessionId, messages);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // 重命名会话
  ipcMain.handle('session:rename', async (event, sessionId, newTitle) => {
    try {
      if (!rustKernel || !rustKernel.initialized) {
        return { success: false, error: '内核未初始化' };
      }
      return await rustKernel.renameSession(sessionId, newTitle);
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ==================== 系统状态和统计 ====================
  
  // 获取系统统计信息
  ipcMain.handle('system:stats', async () => {
    const stats = {
      logger: logger.getMetrics(),
      stateRecovery: stateRecovery ? stateRecovery.getStats() : null,
      kernelClient: kernelClient ? kernelClient.getStats() : null,
      kernelIPC: kernelIPC ? kernelIPC.getStats() : null,
      ipcMode: IPC_MODE,
      rustKernel: rustKernel ? { initialized: rustKernel.initialized } : null
    };
    return { success: true, stats };
  });
  
  // 获取日志报告
  ipcMain.handle('system:log-report', async () => {
    const report = logger.generateReport();
    return { success: true, report };
  });
  
  // 重置统计信息
  ipcMain.handle('system:reset-stats', async () => {
    logger.resetMetrics();
    if (kernelClient) kernelClient.resetCircuit();
    if (kernelIPC) kernelIPC.resetStats();
    return { success: true };
  });

  // 注册模型配置 IPC
  registerModelConfigHandlers(ipcMain, mainWindow);
}

// 初始化本地IPC Rust内核
async function initKernel() {
  const trace = logger.startTrace('initKernel');
  
  try {
    rustKernel = new RustKernel();
    const available = await rustKernel.initialize();
    if (available) {
      logger.info('Rust内核初始化成功');
      
      // 保存状态到恢复管理器
      if (stateRecovery) {
        stateRecovery.saveState(StateType.USER_CONTEXT, 'kernel', {
          initialized: true,
          initTime: Date.now()
        });
      }
      
      trace.end({ success: true });
      return true;
    }
  } catch (err) {
    logger.error('内核初始化失败', { error: err.message, stack: err.stack });
    trace.end({ success: false, error: err.message });
  }
  return false;
}

// 应用启动
app.whenReady().then(async () => {
  const trace = logger.startTrace('appStartup');
  logger.info('应用启动');
  
  // 初始化状态恢复管理器
  initStateRecovery();
  
  // 设置IPC通信
  setupIPC();
  
  // 创建主窗口
  createWindow();
  
  // 初始化内核
  await initKernel();
  
  // 初始化IPC通信（HTTP或进程IPC）
  try {
    await initIPCCommunication();
  } catch (err) {
    logger.warn('IPC通信初始化失败，将使用Rust内核', { error: err.message });
  }
  
  // 初始化执行器和屏幕投屏
  initExecutor();
  initScreenStream();
  
  trace.end();
  logger.info('应用启动完成');
});

app.on('window-all-closed', () => {
  // 创建退出检查点
  if (stateRecovery) {
    stateRecovery.createCheckpoint('before-exit');
  }
  
  if (process.platform !== 'darwin') {
    // 停止IPC进程
    if (kernelIPC) {
      kernelIPC.stop();
    }
    
    // 清理状态恢复管理器
    if (stateRecovery) {
      stateRecovery.cleanup();
    }
    
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

