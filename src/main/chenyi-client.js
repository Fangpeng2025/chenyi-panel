/**
 * 晨翼Agent - 完整客户端
 * 
 * 整合：
 * - Rust内核 (本地AI处理)
 * - 云端同步 (数据同步)
 * - 设备管理 (跨设备)
 */

const EventEmitter = require('events');
const path = require('path');
const fs = require('fs');

// Rust内核客户端
const KernelClient = require('./kernel-client');
// 云端同步客户端
const CloudSyncClient = require('./cloud-sync-client');

class ChenYiClient extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      // 内核配置
      kernelUrl: config.kernelUrl || 'http://localhost:8080',
      
      // 云端配置
      cloudApiUrl: config.cloudApiUrl || 'http://47.97.198.239:3002',
      cloudWsUrl: config.cloudWsUrl || 'ws://47.97.198.239:3002',
      
      // 同步配置
      syncInterval: config.syncInterval || 5 * 60 * 1000, // 5分钟
      autoSync: config.autoSync !== false,
      
      // 设备信息
      deviceName: config.deviceName || require('os').hostname(),
      platform: config.platform || 'electron',
    };
    
    // 内核客户端
    this.kernel = new KernelClient(this.config.kernelUrl);
    
    // 云端同步客户端
    this.cloud = new CloudSyncClient({
      apiUrl: this.config.cloudApiUrl,
      wsUrl: this.config.cloudWsUrl,
      autoReconnect: true,
    });
    
    // 状态
    this.initialized = false;
    this.loggedIn = false;
    this.user = null;
    this.sessionId = null;
    
    // 同步定时器
    this.syncTimer = null;
    
    // 设置事件监听
    this.setupEventListeners();
  }

  // ==================== 初始化 ====================
  
  /**
   * 初始化客户端
   */
  async initialize() {
    try {
      // 检查内核健康状态
      const health = await this.kernel.health();
      console.log('[ChenYi] 内核状态:', health);
      
      if (health.status !== 'ok') {
        throw new Error('内核未就绪');
      }
      
      this.initialized = true;
      this.emit('initialized');
      
      // 启动自动同步
      if (this.config.autoSync) {
        this.startAutoSync();
      }
      
      return { success: true };
    } catch (error) {
      console.error('[ChenYi] 初始化失败:', error);
      throw error;
    }
  }

  // ==================== 用户认证 ====================
  
  /**
   * 用户登录
   */
  async login(email, password) {
    try {
      const result = await this.cloud.login(email, password);
      
      if (result.token) {
        this.loggedIn = true;
        this.user = result.user;
        
        // 设置内核的云端配置
        await this.kernel.setCloudConfig(result.token, this.user.id, this.config.cloudApiUrl);
        
        // 连接WebSocket
        this.cloud.deviceId = this.generateDeviceId();
        await this.cloud.registerDevice({
          deviceId: this.cloud.deviceId,
          deviceName: this.config.deviceName,
          platform: this.config.platform,
        });
        this.cloud.connectWebSocket();
        
        // 同步数据
        await this.syncFromCloud();
        
        this.emit('login', this.user);
      }
      
      return result;
    } catch (error) {
      console.error('[ChenYi] 登录失败:', error);
      throw error;
    }
  }

  /**
   * 用户注册
   */
  async register(email, password, name) {
    try {
      const result = await this.cloud.register(email, password, name);
      
      if (result.token) {
        this.loggedIn = true;
        this.user = result.user;
        
        // 设置内核的云端配置
        await this.kernel.setCloudConfig(result.token, this.user.id, this.config.cloudApiUrl);
        
        this.emit('login', this.user);
      }
      
      return result;
    } catch (error) {
      console.error('[ChenYi] 注册失败:', error);
      throw error;
    }
  }

  /**
   * 用户登出
   */
  async logout() {
    this.cloud.disconnect();
    this.loggedIn = false;
    this.user = null;
    this.stopAutoSync();
    this.emit('logout');
  }

  // ==================== 会话管理 ====================
  
  /**
   * 创建新会话
   */
  async createSession() {
    const result = await this.kernel.createSession();
    this.sessionId = result.session_id || this.kernel.sessionId;
    return result;
  }

  /**
   * 发送消息 (使用内核处理)
   */
  async sendMessage(content) {
    if (!this.sessionId) {
      await this.createSession();
    }
    
    const result = await this.kernel.sendMessage(content);
    
    // 触发同步
    this.scheduleSync();
    
    return result;
  }

  /**
   * 获取消息历史
   */
  async getMessages(sessionId) {
    return await this.kernel.getMessages(sessionId || this.sessionId);
  }

  // ==================== 记忆管理 ====================
  
  /**
   * 保存记忆到本地内核
   */
  async saveMemory(content, metadata = {}) {
    const result = await this.kernel.saveMemory(content, metadata);
    this.scheduleSync();
    return result;
  }

  /**
   * 搜索记忆
   */
  async searchMemory(query, k = 10) {
    return await this.kernel.searchMemory(query, k);
  }

  // ==================== 工具执行 ====================
  
  /**
   * 执行工具
   */
  async executeTool(toolName, params = {}) {
    return await this.kernel.executeTool(toolName, params);
  }

  // ==================== 数据同步 ====================
  
  /**
   * 从云端同步数据
   */
  async syncFromCloud() {
    if (!this.loggedIn) return;
    
    try {
      console.log('[ChenYi] 开始从云端同步...');
      
      // 获取云端数据
      const sessions = await this.cloud.getSessions();
      const memories = await this.cloud.getMemories();
      
      // 同步到本地内核
      // TODO: 实现具体同步逻辑
      
      console.log('[ChenYi] 同步完成');
      this.emit('sync-complete', { sessions, memories });
      
      return { success: true };
    } catch (error) {
      console.error('[ChenYi] 同步失败:', error);
      throw error;
    }
  }

  /**
   * 上传数据到云端
   */
  async syncToCloud() {
    if (!this.loggedIn) return;
    
    try {
      console.log('[ChenYi] 开始上传数据到云端...');
      
      // 获取本地数据
      const sessions = await this.kernel.listSessions();
      // TODO: 获取记忆数据
      
      // 上传到云端
      for (const session of sessions.sessions || []) {
        const messages = await this.kernel.getMessages(session.id);
        await this.cloud.syncMessages(session.id, messages.messages || []);
      }
      
      console.log('[ChenYi] 上传完成');
      this.emit('sync-complete');
      
      return { success: true };
    } catch (error) {
      console.error('[ChenYi] 上传失败:', error);
      throw error;
    }
  }

  /**
   * 启动自动同步
   */
  startAutoSync() {
    if (this.syncTimer) return;
    
    this.syncTimer = setInterval(() => {
      if (this.loggedIn) {
        this.syncToCloud().catch(err => {
          console.error('[ChenYi] 自动同步失败:', err);
        });
      }
    }, this.config.syncInterval);
  }

  /**
   * 停止自动同步
   */
  stopAutoSync() {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  /**
   * 计划同步 (延迟执行，避免频繁同步)
   */
  scheduleSync() {
    if (this.syncDebounce) {
      clearTimeout(this.syncDebounce);
    }
    
    this.syncDebounce = setTimeout(() => {
      if (this.loggedIn) {
        this.syncToCloud().catch(() => {});
      }
    }, 5000); // 5秒后同步
  }

  // ==================== 设备管理 ====================
  
  /**
   * 获取设备列表
   */
  async getDevices() {
    return await this.cloud.getDevices();
  }

  // ==================== 事件处理 ====================
  
  setupEventListeners() {
    // 云端消息
    this.cloud.on('message', (msg) => {
      this.emit('cloud-message', msg);
    });
    
    // 云端连接状态
    this.cloud.on('ws-connected', () => {
      console.log('[ChenYi] 云端WebSocket已连接');
      this.emit('cloud-connected');
    });
    
    this.cloud.on('ws-disconnected', () => {
      console.log('[ChenYi] 云端WebSocket已断开');
      this.emit('cloud-disconnected');
    });
    
    this.cloud.on('ws-error', (err) => {
      console.error('[ChenYi] 云端WebSocket错误:', err);
      this.emit('cloud-error', err);
    });
  }

  // ==================== 工具方法 ====================
  
  generateDeviceId() {
    const os = require('os');
    const crypto = require('crypto');
    const data = `${os.hostname()}-${os.platform()}-${Date.now()}`;
    return crypto.createHash('md5').update(data).digest('hex');
  }

  /**
   * 获取客户端状态
   */
  getStatus() {
    return {
      initialized: this.initialized,
      loggedIn: this.loggedIn,
      user: this.user,
      sessionId: this.sessionId,
      cloudConnected: this.cloud.connected,
      deviceId: this.cloud.deviceId,
    };
  }
}

module.exports = ChenYiClient;
