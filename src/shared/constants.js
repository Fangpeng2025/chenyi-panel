/**
 * 晨翼Agent - 常量定义
 */

// 云端服务地址
const CLOUD_CONFIG = {
  WS_URL: 'wss://cloud.chenyi.com/ws',
  API_URL: 'https://cloud.chenyi.com/api/v1',
  
  // 开发环境
  DEV_WS_URL: 'ws://localhost:3000/ws',
  DEV_API_URL: 'http://localhost:3000/api/v1'
};

// 心跳配置
const HEARTBEAT_CONFIG = {
  INTERVAL: 30000,      // 心跳间隔 30秒
  TIMEOUT: 60000,       // 超时时间 60秒
  MAX_RECONNECT_DELAY: 30000  // 最大重连延迟
};

// 投屏配置
const STREAM_CONFIG = {
  CODEC: 'video/avc',   // H.264
  WIDTH: 720,
  HEIGHT: 1280,
  BIT_RATE: 2000000,    // 2Mbps
  FRAME_RATE: 30,
  I_FRAME_INTERVAL: 2
};

// JWT配置
const JWT_CONFIG = {
  EXPIRES_IN: '7d',
  ALGORITHM: 'HS256'
};

// 任务优先级
const TASK_PRIORITY = {
  HIGH: 1,
  NORMAL: 5,
  LOW: 10
};

// 本地存储键
const STORAGE_KEYS = {
  TOKEN: 'chenyi_token',
  USER: 'chenyi_user',
  DEVICE_ID: 'chenyi_device_id',
  SETTINGS: 'chenyi_settings'
};

module.exports = {
  CLOUD_CONFIG,
  HEARTBEAT_CONFIG,
  STREAM_CONFIG,
  JWT_CONFIG,
  TASK_PRIORITY,
  STORAGE_KEYS
};
