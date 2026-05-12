/**
 * 晨翼Agent - 常量定义
 */

// 云端服务地址（通过 Nginx 反向代理）
const CLOUD_CONFIG = {
  // 生产环境 - HTTPS
  WS_URL: 'wss://chenyi.xintiandi.online/cloud/ws',
  API_URL: 'https://chenyi.xintiandi.online/cloud/api',
  
  // 开发环境 - 本地直连
  DEV_WS_URL: 'ws://localhost:3002/ws',
  DEV_API_URL: 'http://localhost:3002/api'
};

// Rust内核配置（新版）
const KERNEL_CONFIG = {
  API_URL: 'https://chenyi.xintiandi.online/api/v1',
  WS_URL: 'wss://chenyi.xintiandi.online/ws',
  HEALTH_CHECK_INTERVAL: 60000  // 1分钟检查一次
};

// IPC通信配置
const IPC_CONFIG = {
  MODE: process.env.IPC_MODE || 'http', // 'http' 或 'ipc'
  HTTP: {
    MAX_RETRIES: 3,
    RETRY_DELAY: 1000,        // 初始延迟1秒
    RETRY_MULTIPLIER: 2,       // 指数退避
    FAILURE_THRESHOLD: 5,      // 熔断阈值
    CIRCUIT_TIMEOUT: 30000,    // 熔断30秒
    DEFAULT_TIMEOUT: 30000
  },
  PROCESS: {
    MAX_RESTART_ATTEMPTS: 5,
    RESTART_DELAY: 1000,       // 初始延迟1秒
    MAX_RESTART_DELAY: 30000,  // 最大延迟30秒
    MAX_BUFFER_SIZE: 10485760  // 10MB
  }
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
  KERNEL_CONFIG,
  IPC_CONFIG,
  HEARTBEAT_CONFIG,
  STREAM_CONFIG,
  JWT_CONFIG,
  TASK_PRIORITY,
  STORAGE_KEYS
};
