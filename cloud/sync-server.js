/**
 * 晨翼Agent - 云端数据同步服务（轻量级）
 * 只负责：用户认证、数据同步、设备管理、消息路由
 * 不负责：AI推理、工具执行（这些在本地内核）
 */

const http = require('http');
const url = require('url');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { WebSocketServer } = require('ws');
const { SqliteMap, init: initDb, close: closeDb } = require('./db');

// ==================== 配置 ====================
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'chenyi-secret-key-2024';

// ==================== SQLite 持久化存储 ====================
// 初始化数据库（数据保存在 data/chenyi-cloud.db）
initDb();

const users = new SqliteMap('users', 'email', 'value');
const sessions = new SqliteMap('sessions', 'token', 'value');
const devices = new SqliteMap('devices', 'device_id', 'value');
const userDevices = new SqliteMap('user_devices', 'user_id', 'device_ids');
const sessionData = new SqliteMap('session_data', 'session_id', 'value');
const taskData = new SqliteMap('task_data', 'task_id', 'value');
const memoryData = new SqliteMap('memory_data', 'memory_id', 'value');

// 初始化测试用户（仅首次）
if (!users.has('test@chenyi.com')) {
  users.set('test@chenyi.com', {
    id: uuidv4(),
    email: 'test@chenyi.com',
    password: '123456',
    name: '测试用户',
    createdAt: Date.now()
  });
  console.log('[DB] 已创建测试用户');
}

// userDevices 兼容旧接口：userId → Set<deviceId> (存为数组)
// 重写 set/get 支持 Set 类型
const _origUserDevicesSet = userDevices.set.bind(userDevices);
const _origUserDevicesGet = userDevices.get.bind(userDevices);

userDevices.set = function(userId, deviceIdSet) {
  const arr = deviceIdSet instanceof Set ? [...deviceIdSet] : deviceIdSet;
  return _origUserDevicesSet(userId, arr);
};

userDevices.get = function(userId) {
  const val = _origUserDevicesGet(userId);
  if (val && Array.isArray(val)) {
    return new Set(val);
  }
  // 兼容第一次初始化
  if (!val) {
    const s = new Set();
    userDevices.set(userId, s);
    return s;
  }
  return val;
};

console.log('晨翼Agent 云端同步服务 v2.0');
console.log('架构：边缘计算 + 云端同步（SQLite持久化）');
console.log('职责：用户认证、数据同步、设备管理、消息路由');

module.exports = {
  users, sessions, devices, userDevices,
  sessionData, taskData, memoryData,
  JWT_SECRET, uuidv4, crypto, PORT
};

// 优雅关闭
process.on('SIGINT', () => {
  console.log('\n[DB] 正在关闭数据库...');
  closeDb();
  process.exit(0);
});

process.on('SIGTERM', () => {
  closeDb();
  process.exit(0);
});
