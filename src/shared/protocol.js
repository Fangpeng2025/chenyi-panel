/**
 * 晨翼Agent - 协议定义
 * 定义客户端与云端之间的通信协议
 */

// 消息类型
const MessageType = {
  // 连接管理
  PING: 'ping',
  PONG: 'pong',
  REGISTER: 'register',
  REGISTER_ACK: 'register_ack',
  
  // 控制指令
  CONTROL: 'control',
  CONTROL_RESULT: 'control_result',
  
  // 任务管理
  TASK: 'task',
  TASK_RESULT: 'task_result',
  
  // 状态同步
  SYNC: 'sync',
  DEVICE_UPDATE: 'device_update',
  
  // AI对话
  AI_CHAT: 'ai_chat',
  AI_CHAT_ACK: 'ai_chat_ack',
  
  // 错误
  ERROR: 'error'
};

// 设备类型
const DeviceType = {
  ANDROID: 'android',
  ELECTRON: 'electron',
  WEB: 'web'
};

// 设备能力
const DeviceCapability = {
  SCREEN_STREAM: 'screen_stream',  // 投屏
  CONTROL: 'control',              // 控制
  FILE_SYNC: 'file_sync',          // 文件同步
  AI_CHAT: 'ai_chat'               // AI对话
};

// 设备状态
const DeviceStatus = {
  ONLINE: 'online',
  OFFLINE: 'offline',
  BUSY: 'busy',
  IDLE: 'idle'
};

// 控制动作
const ControlAction = {
  TAP: 'tap',
  SWIPE: 'swipe',
  INPUT_TEXT: 'input_text',
  SCREENSHOT: 'screenshot',
  PRESS_KEY: 'press_key',
  LONG_PRESS: 'long_press'
};

// 任务状态
const TaskStatus = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed'
};

/**
 * 创建消息
 */
function createMessage(type, data = {}, requestId = null) {
  const msg = {
    type,
    timestamp: Date.now(),
    data
  };
  if (requestId) {
    msg.requestId = requestId;
  }
  return msg;
}

/**
 * 创建注册消息
 */
function createRegisterMessage(deviceId, deviceType, deviceName, capabilities) {
  return createMessage(MessageType.REGISTER, {
    deviceId,
    deviceType,
    deviceName,
    capabilities
  });
}

/**
 * 创建控制消息
 */
function createControlMessage(targetDeviceId, action, params, requestId) {
  return createMessage(MessageType.CONTROL, {
    target: targetDeviceId,
    action,
    params
  }, requestId);
}

/**
 * 创建心跳消息
 */
function createPingMessage() {
  return createMessage(MessageType.PING);
}

module.exports = {
  MessageType,
  DeviceType,
  DeviceCapability,
  DeviceStatus,
  ControlAction,
  TaskStatus,
  createMessage,
  createRegisterMessage,
  createControlMessage,
  createPingMessage
};
