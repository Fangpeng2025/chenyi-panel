/**
 * 晨翼Agent - 云端同步客户端
 * 负责与云端服务通信：用户认证、设备注册、数据同步
 */

const EventEmitter = require('events');
const WebSocket = require('ws');
const http = require('http');

class CloudSyncClient extends EventEmitter {
  constructor(config) {
    super();
    
    this.apiUrl = config.apiUrl;
    this.wsUrl = config.wsUrl;
    this.token = null;
    this.deviceId = null;
    this.ws = null;
    this.connected = false;
    
    // 自动重连配置
    this.reconnectEnabled = config.autoReconnect !== false;
    this.reconnectInterval = config.reconnectInterval || 5000;
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = config.maxReconnectAttempts || 10;
    
    // 离线消息队列
    this.messageQueue = [];
    this.maxQueueSize = config.maxQueueSize || 100;
    
    // 心跳配置
    this.heartbeatInterval = config.heartbeatInterval || 25000;
    this.heartbeatTimer = null;
  }

  // ==================== HTTP请求 ====================
  
  request(method, path, body = null) {
    return new Promise((resolve, reject) => {
      const url = new URL(this.apiUrl);
      const isHttps = url.protocol === 'https:';
      const httpModule = isHttps ? require('https') : http;
      
      // 拼接完整路径：apiUrl + path
      const fullPath = url.pathname.replace(/\/$/, '') + '/' + path.replace(/^\//, '');
      console.log('[CloudSync] HTTP请求:', method, url.hostname + fullPath);
      
      const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: fullPath,
        method: method,
        headers: {
          'Content-Type': 'application/json'
        },
        rejectUnauthorized: false  // 允许自签名证书
      };

      if (this.token) {
        options.headers['Authorization'] = `Bearer ${this.token}`;
      }

      const req = httpModule.request(options, (res) => {
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
      req.setTimeout(10000, () => {
        req.destroy();
        reject(new Error('请求超时'));
      });

      if (body) {
        req.write(JSON.stringify(body));
      }
      req.end();
    });
  }

  // ==================== 用户认证 ====================
  
  async login(email, password) {
    const result = await this.request('POST', '/auth/login', { email, password });
    
    // 服务器返回 { token, user } 表示成功
    if (result.token) {
      this.token = result.token;
      result.success = true;  // 添加成功标志
      this.emit('login', result.user);
    }
    
    return result;
  }

  async register(email, password, name) {
    const result = await this.request('POST', '/auth/register', { email, password, name });
    
    // 服务器返回 { token, user } 表示成功
    if (result.token) {
      this.token = result.token;
      result.success = true;  // 添加成功标志
      this.emit('login', result.user);
    }
    
    return result;
  }

  // ==================== 设备管理 ====================
  
  async registerDevice(deviceInfo) {
    if (!this.token) {
      throw new Error('未登录');
    }
    
    const result = await this.request('POST', '/device/register', deviceInfo);
    
    if (result.success) {
      this.deviceId = deviceInfo.deviceId;
      this.emit('device-registered', deviceInfo.deviceId);
    }
    
    return result;
  }

  async getDevices() {
    if (!this.token) {
      throw new Error('未登录');
    }
    
    return await this.request('GET', '/device/list');
  }

  // ==================== 数据同步 ====================
  
  async createSession(session) {
    if (!this.token) {
      throw new Error('未登录');
    }
    
    return await this.request('POST', '/session', session);
  }
  
  async syncMessages(sessionId, messages) {
    if (!this.token) {
      throw new Error('未登录');
    }
    
    // 逐条同步消息
    for (const msg of messages) {
      await this.request('POST', `/session/${sessionId}/messages`, msg);
    }
    
    return { success: true };
  }
  
  async getMessages(sessionId) {
    if (!this.token) {
      throw new Error('未登录');
    }
    
    return await this.request('GET', `/session/${sessionId}/messages`);
  }

  async getSessions() {
    if (!this.token) {
      throw new Error('未登录');
    }
    
    return await this.request('GET', '/session');
  }

  async createTask(task) {
    if (!this.token) {
      throw new Error('未登录');
    }
    
    return await this.request('POST', '/task', task);
  }

  async getTasks() {
    if (!this.token) {
      throw new Error('未登录');
    }
    
    return await this.request('GET', '/task');
  }

  async saveMemory(content, metadata = {}) {
    if (!this.token) {
      throw new Error('未登录');
    }
    
    return await this.request('POST', '/memory', { content, metadata });
  }

  async getMemories() {
    if (!this.token) {
      throw new Error('未登录');
    }
    
    return await this.request('GET', '/memory');
  }

  // ==================== WebSocket连接 ====================
  
  connectWebSocket() {
    if (!this.token || !this.deviceId) {
      throw new Error('未登录或设备未注册');
    }
    
    // 防止重复连接
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
      console.log('[CloudSync] WebSocket已连接或正在连接，跳过');
      return;
    }
    
    const wsUrl = `${this.wsUrl}?token=${this.token}&deviceId=${this.deviceId}`;
    
    this.ws = new WebSocket(wsUrl);
    
    this.ws.on('open', () => {
      this.connected = true;
      this.reconnectAttempts = 0; // 重置重连计数
      this.startHeartbeat(); // 启动心跳
      this.flushMessageQueue(); // 发送队列消息
      this.emit('ws-connected');
      console.log('[CloudSync] WebSocket已连接');
    });
    
    this.ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        
        // 处理心跳响应
        if (msg.type === 'HEARTBEAT_ACK') {
          return; // 心跳响应，无需emit
        }
        
        // 处理服务器ping
        if (msg.type === 'PING') {
          this.ws.send(JSON.stringify({ type: 'PONG' }));
          return;
        }
        
        this.emit('message', msg);
      } catch (err) {
        console.error('[CloudSync] 消息解析失败:', err);
      }
    });
    
    this.ws.on('close', () => {
      this.connected = false;
      this.stopHeartbeat();
      this.emit('ws-disconnected');
      console.log('[CloudSync] WebSocket已断开');
      
      // 自动重连
      this.scheduleReconnect();
    });
    
    this.ws.on('error', (err) => {
      console.error('[CloudSync] WebSocket错误:', err.message);
      this.emit('ws-error', err);
    });
    
    this.ws.on('pong', () => {
      // 收到pong响应，连接正常
    });
  }
  
  // ==================== 心跳机制 ====================
  
  startHeartbeat() {
    this.stopHeartbeat();
    
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping();
        this.ws.send(JSON.stringify({ type: 'HEARTBEAT' }));
      }
    }, this.heartbeatInterval);
  }
  
  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
  
  // ==================== 自动重连 ====================
  
  scheduleReconnect() {
    if (!this.reconnectEnabled) return;
    
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[CloudSync] 达到最大重连次数，停止重连');
      this.emit('ws-reconnect-failed');
      return;
    }
    
    if (this.reconnectTimer) return; // 已在重连中
    
    this.reconnectAttempts++;
    console.log(`[CloudSync] ${this.reconnectInterval / 1000}秒后尝试重连 (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      console.log('[CloudSync] 尝试重新连接...');
      this.connectWebSocket();
    }, this.reconnectInterval);
  }
  
  // ==================== 离线消息队列 ====================
  
  send(msg) {
    // 如果已连接，直接发送
    if (this.ws && this.connected && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
      return true;
    }
    
    // 未连接，加入队列
    if (this.messageQueue.length < this.maxQueueSize) {
      this.messageQueue.push(msg);
      console.log(`[CloudSync] 消息已加入队列 (${this.messageQueue.length}/${this.maxQueueSize})`);
      return true;
    }
    
    console.warn('[CloudSync] 消息队列已满，丢弃消息');
    return false;
  }
  
  flushMessageQueue() {
    if (this.messageQueue.length === 0) return;
    
    console.log(`[CloudSync] 发送队列消息: ${this.messageQueue.length}条`);
    
    while (this.messageQueue.length > 0) {
      const msg = this.messageQueue.shift();
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(msg));
      }
    }
  }
  
  disconnect() {
    this.reconnectEnabled = false; // 主动断开不重连
    this.stopHeartbeat();
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }
}

module.exports = CloudSyncClient;
