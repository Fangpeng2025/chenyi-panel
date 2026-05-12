/**
 * 晨翼Agent - 渲染进程API
 * 
 * 封装IPC通信，提供简洁的API给前端使用
 */

const { ipcRenderer } = require('electron');

class ChenYiAPI {
  constructor() {
    this.listeners = new Map();
    
    // 设置IPC事件监听
    this.setupListeners();
  }

  setupListeners() {
    // 用户变化
    ipcRenderer.on('chenyi:user-changed', (event, user) => {
      this.emit('user-changed', user);
    });
    
    // 云端连接状态
    ipcRenderer.on('chenyi:cloud-status', (event, status) => {
      this.emit('cloud-status', status);
    });
    
    // 云端消息
    ipcRenderer.on('chenyi:cloud-message', (event, msg) => {
      this.emit('cloud-message', msg);
    });
    
    // 同步完成
    ipcRenderer.on('chenyi:sync-complete', (event, data) => {
      this.emit('sync-complete', data);
    });
    
    // 系统错误事件
    ipcRenderer.on('system:error', (event, error) => {
      this.emit('system-error', error);
    });
    
    // 系统状态更新
    ipcRenderer.on('system:status-update', (event, status) => {
      this.emit('system-status', status);
    });
  }

  // ==================== 事件系统 ====================
  
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
  }

  off(event, callback) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).delete(callback);
    }
  }

  emit(event, data) {
    if (this.listeners.has(event)) {
      for (const callback of this.listeners.get(event)) {
        callback(data);
      }
    }
  }

  // ==================== 初始化 ====================
  
  async initialize(config = {}) {
    return await ipcRenderer.invoke('chenyi:initialize', config);
  }

  async getStatus() {
    return await ipcRenderer.invoke('chenyi:get-status');
  }

  // ==================== 用户认证 ====================
  
  async login(email, password) {
    return await ipcRenderer.invoke('chenyi:login', { email, password });
  }

  async register(email, password, name) {
    return await ipcRenderer.invoke('chenyi:register', { email, password, name });
  }

  async logout() {
    return await ipcRenderer.invoke('chenyi:logout');
  }

  // ==================== 会话管理 ====================
  
  async createSession() {
    return await ipcRenderer.invoke('chenyi:create-session');
  }

  async sendMessage(content) {
    return await ipcRenderer.invoke('chenyi:send-message', { content });
  }

  async getMessages(sessionId) {
    return await ipcRenderer.invoke('chenyi:get-messages', { sessionId });
  }

  // ==================== 记忆管理 ====================
  
  async saveMemory(content, metadata = {}) {
    return await ipcRenderer.invoke('chenyi:save-memory', { content, metadata });
  }

  async searchMemory(query, k = 10) {
    return await ipcRenderer.invoke('chenyi:search-memory', { query, k });
  }
  
  async deleteMemory(id) {
    return await ipcRenderer.invoke('chenyi:delete-memory', { id });
  }
  
  async getMemory(id) {
    return await ipcRenderer.invoke('chenyi:get-memory', { id });
  }

  // ==================== 工具执行 ====================
  
  async executeTool(toolName, params = {}) {
    return await ipcRenderer.invoke('chenyi:execute-tool', { toolName, params });
  }

  // ==================== 数据同步 ====================
  
  async syncFromCloud() {
    return await ipcRenderer.invoke('chenyi:sync-from-cloud');
  }

  async syncToCloud() {
    return await ipcRenderer.invoke('chenyi:sync-to-cloud');
  }

  // ==================== 设备管理 ====================
  
  async getDevices() {
    return await ipcRenderer.invoke('chenyi:get-devices');
  }

  // ==================== 系统监控 ====================
  
  /**
   * 获取系统统计数据
   * @returns {Promise<Object>} 包含IPC统计、熔断器状态、内核状态等
   */
  async getStats() {
    return await ipcRenderer.invoke('system:stats');
  }

  /**
   * 生成日志报告
   * @param {Object} options - 报告选项
   * @param {string} options.format - 格式 ('json' | 'text')
   * @param {number} options.lastHours - 最近N小时
   * @returns {Promise<Object>} 日志报告
   */
  async getLogReport(options = {}) {
    return await ipcRenderer.invoke('system:log-report', options);
  }

  /**
   * 重置统计数据
   * @returns {Promise<Object>} 重置结果
   */
  async resetStats() {
    return await ipcRenderer.invoke('system:reset-stats');
  }
}

// 导出单例
const chenyi = new ChenYiAPI();
module.exports = chenyi;
