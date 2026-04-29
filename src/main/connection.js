/**
 * 晨翼Agent - WebSocket连接管理器
 * 负责与云端建立连接、心跳检测、断线重连
 */

const WebSocket = require('ws');
const EventEmitter = require('events');
const { HEARTBEAT_CONFIG } = require('../shared/constants');

class ConnectionManager extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.wsUrl = options.wsUrl;
    this.heartbeatInterval = options.heartbeatInterval || HEARTBEAT_CONFIG.INTERVAL;
    this.heartbeatTimeout = options.heartbeatTimeout || HEARTBEAT_CONFIG.TIMEOUT;
    this.maxReconnectDelay = HEARTBEAT_CONFIG.MAX_RECONNECT_DELAY;
    
    this.ws = null;
    this.connected = false;
    this.token = null;
    
    // 重连相关
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
    this.isReconnecting = false;
    this.manualDisconnect = false;
    
    // 心跳相关
    this.heartbeatTimer = null;
    this.heartbeatTimeoutTimer = null;
  }

  /**
   * 连接云端
   */
  connect(token) {
    this.token = token;
    this.manualDisconnect = false;
    
    const wsUrl = `${this.wsUrl}?token=${token}`;
    console.log('[Connection] 连接中...', wsUrl);
    
    try {
      this.ws = new WebSocket(wsUrl);
      this.setupWebSocket();
    } catch (err) {
      console.error('[Connection] 连接失败:', err);
      this.emit('error', err);
      this.scheduleReconnect();
    }
  }

  /**
   * 设置WebSocket事件
   */
  setupWebSocket() {
    this.ws.on('open', () => {
      console.log('[Connection] 已连接');
      this.connected = true;
      this.reconnectAttempts = 0;
      this.isReconnecting = false;
      this.startHeartbeat();
      this.emit('connected');
    });

    this.ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        this.emit('message', msg);
      } catch (err) {
        console.error('[Connection] 消息解析失败:', err);
      }
    });

    this.ws.on('close', () => {
      console.log('[Connection] 连接关闭');
      this.connected = false;
      this.stopHeartbeat();
      this.emit('disconnected');
      
      if (!this.manualDisconnect) {
        this.scheduleReconnect();
      }
    });

    this.ws.on('error', (err) => {
      console.error('[Connection] WebSocket错误:', err);
      this.emit('error', err);
    });

    this.ws.on('pong', () => {
      this.resetHeartbeat();
    });
  }

  /**
   * 断开连接
   */
  disconnect() {
    this.manualDisconnect = true;
    this.stopHeartbeat();
    this.cancelReconnect();
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    this.connected = false;
    console.log('[Connection] 已断开');
  }

  /**
   * 发送消息
   */
  send(msg) {
    if (!this.ws || !this.connected) {
      console.warn('[Connection] 未连接，无法发送消息');
      return false;
    }

    try {
      const data = typeof msg === 'string' ? msg : JSON.stringify(msg);
      this.ws.send(data);
      return true;
    } catch (err) {
      console.error('[Connection] 发送失败:', err);
      return false;
    }
  }

  /**
   * 开始心跳检测
   */
  startHeartbeat() {
    this.stopHeartbeat();
    
    this.heartbeatTimer = setInterval(() => {
      if (!this.ws || !this.connected) return;
      
      // 发送ping
      this.ws.ping();
      
      // 设置超时
      this.heartbeatTimeoutTimer = setTimeout(() => {
        console.warn('[Connection] 心跳超时');
        if (this.ws) {
          this.ws.terminate();
        }
      }, this.heartbeatTimeout - this.heartbeatInterval);
      
    }, this.heartbeatInterval);
    
    console.log('[Connection] 心跳检测已启动');
  }

  /**
   * 停止心跳检测
   */
  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.heartbeatTimeoutTimer) {
      clearTimeout(this.heartbeatTimeoutTimer);
      this.heartbeatTimeoutTimer = null;
    }
  }

  /**
   * 重置心跳超时
   */
  resetHeartbeat() {
    if (this.heartbeatTimeoutTimer) {
      clearTimeout(this.heartbeatTimeoutTimer);
      this.heartbeatTimeoutTimer = null;
    }
  }

  /**
   * 计算重连延迟（指数退避）
   */
  calculateReconnectDelay() {
    return Math.min(1000 * Math.pow(2, this.reconnectAttempts), this.maxReconnectDelay);
  }

  /**
   * 安排重连
   */
  scheduleReconnect() {
    if (this.isReconnecting || this.manualDisconnect) return;
    
    this.isReconnecting = true;
    const delay = this.calculateReconnectDelay();
    
    console.log(`[Connection] ${delay/1000}秒后重连（第${this.reconnectAttempts + 1}次）`);
    
    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempts++;
      this.isReconnecting = false;
      this.connect(this.token);
    }, delay);
  }

  /**
   * 取消重连
   */
  cancelReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.isReconnecting = false;
  }
}

module.exports = ConnectionManager;
