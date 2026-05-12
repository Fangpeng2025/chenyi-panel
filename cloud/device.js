/**
 * 设备管理模块
 * 支持设备注册、能力声明、在线状态追踪
 */

const { devices, userDevices, uuidv4 } = require('./sync-server');

// 注册设备
function registerDevice(userId, deviceInfo) {
  const deviceId = deviceInfo.deviceId || `device_${uuidv4()}`;
  
  devices.set(deviceId, {
    ...deviceInfo,
    deviceId,
    userId,
    online: true,
    lastSeen: Date.now(),
    registeredAt: Date.now()
  });
  
  // 维护 user→devices 映射（持久化）
  const existing = userDevices.get(userId);
  const deviceIds = existing instanceof Set ? existing : new Set(existing || []);
  deviceIds.add(deviceId);
  userDevices.set(userId, deviceIds);
  
  return { success: true, deviceId };
}

// 获取设备详情
function getDevice(deviceId) {
  const device = devices.get(deviceId);
  if (!device) {
    return { error: '设备不存在' };
  }
  return { device };
}

// 更新设备信息
function updateDevice(deviceId, updates) {
  const device = devices.get(deviceId);
  if (!device) {
    return { error: '设备不存在' };
  }
  
  // 只允许更新指定字段
  const allowed = ['deviceName', 'deviceType', 'capabilities', 'metadata'];
  for (const key of allowed) {
    if (updates[key] !== undefined) {
      device[key] = updates[key];
    }
  }
  device.lastSeen = Date.now();
  
  devices.set(deviceId, device); // 持久化
  return { success: true };
}

// 更新设备状态
function updateDeviceStatus(deviceId, status) {
  const device = devices.get(deviceId);
  if (!device) {
    return { error: '设备不存在' };
  }
  
  device.online = status.online !== undefined ? status.online : device.online;
  device.lastSeen = Date.now();
  
  // 持久化修改
  devices.set(deviceId, device);
  
  return { success: true };
}

// 获取用户设备列表
function getUserDevices(userId) {
  const deviceIds = userDevices.get(userId) || new Set();
  const deviceList = [];
  
  for (const deviceId of deviceIds) {
    const device = devices.get(deviceId);
    if (device) {
      deviceList.push({
        deviceId: device.deviceId,
        deviceName: device.deviceName,
        deviceType: device.deviceType,
        capabilities: device.capabilities,
        online: device.online,
        lastSeen: device.lastSeen
      });
    }
  }
  
  return { devices: deviceList };
}

// 设备离线
function deviceOffline(deviceId) {
  const device = devices.get(deviceId);
  if (device) {
    device.online = false;
    device.lastSeen = Date.now();
    devices.set(deviceId, device); // 持久化
  }
}

// 删除设备（解绑）
function deleteDevice(userId, deviceId) {
  const device = devices.get(deviceId);
  if (!device) {
    return { error: '设备不存在' };
  }
  if (device.userId !== userId) {
    return { error: '无权操作' };
  }
  
  devices.delete(deviceId);
  
  // 从用户设备列表移除
  const deviceIds = userDevices.get(userId);
  if (deviceIds) {
    deviceIds.delete(deviceId);
    userDevices.set(userId, deviceIds);
  }
  
  return { success: true };
}

// 同步设备心跳
function deviceHeartbeat(deviceId) {
  const device = devices.get(deviceId);
  if (!device) {
    return { error: '设备未注册' };
  }
  
  device.online = true;
  device.lastSeen = Date.now();
  devices.set(deviceId, device); // 持久化
  
  return { success: true, lastSeen: device.lastSeen };
}

module.exports = {
  registerDevice,
  getDevice,
  updateDevice,
  updateDeviceStatus,
  getUserDevices,
  deviceOffline,
  deleteDevice,
  deviceHeartbeat
};
