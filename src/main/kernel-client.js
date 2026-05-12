/**
 * 晨翼Agent - Rust内核API客户端
 * 对接新版Rust内核（Axum框架）
 * 
 * v2.0 - 增强重试、熔断和错误处理
 */

const http = require('http');
const https = require('https');

// 熔断器状态
const CircuitState = {
  CLOSED: 'CLOSED',     // 正常状态
  OPEN: 'OPEN',         // 熔断状态（拒绝请求）
  HALF_OPEN: 'HALF_OPEN' // 半开状态（尝试恢复）
};

// 错误类型
const ErrorType = {
  NETWORK: 'NETWORK',
  TIMEOUT: 'TIMEOUT',
  CIRCUIT_OPEN: 'CIRCUIT_OPEN',
  SERVER_ERROR: 'SERVER_ERROR',
  INVALID_RESPONSE: 'INVALID_RESPONSE'
};

class KernelClient {
  constructor(baseUrl = 'http://localhost:8080', options = {}) {
    this.baseUrl = baseUrl;
    this.token = null;
    this.sessionId = null;
    
    // 重试配置
    this.maxRetries = options.maxRetries || 3;
    this.retryDelay = options.retryDelay || 1000; // 初始延迟1秒
    this.retryMultiplier = options.retryMultiplier || 2; // 指数退避
    
    // 熔断器配置
    this.circuitBreaker = {
      state: CircuitState.CLOSED,
      failureCount: 0,
      successCount: 0,
      failureThreshold: options.failureThreshold || 5,
      successThreshold: options.successThreshold || 2,
      timeout: options.circuitTimeout || 30000, // 熔断30秒后尝试恢复
      lastFailureTime: null
    };
    
    // 超时配置
    this.defaultTimeout = options.defaultTimeout || 30000;
    this.timeouts = {
      health: 5000,
      chat: 120000,
      session: 10000,
      memory: 15000,
      default: 30000
    };
    
    // 统计信息
    this.stats = {
      requests: 0,
      successes: 0,
      failures: 0,
      retries: 0,
      circuitOpens: 0,
      lastError: null
    };
  }

  /**
   * 设置认证Token
   */
  setToken(token) {
    this.token = token;
  }

  /**
   * 发送HTTP请求（带重试和熔断）
   */
  async request(method, path, body = null, options = {}) {
    // 检查熔断器状态
    if (!this._checkCircuit()) {
      const error = new Error('熔断器开启，拒绝请求');
      error.type = ErrorType.CIRCUIT_OPEN;
      throw error;
    }
    
    const maxRetries = options.retries ?? this.maxRetries;
    const timeout = options.timeout || this._getTimeoutForPath(path);
    let lastError = null;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await this._doRequest(method, path, body, timeout);
        this._onSuccess();
        return result;
      } catch (err) {
        lastError = err;
        this._onFailure(err);
        
        // 判断是否可重试
        if (!this._isRetryable(err) || attempt === maxRetries) {
          break;
        }
        
        // 计算延迟（指数退避）
        const delay = this.retryDelay * Math.pow(this.retryMultiplier, attempt);
        console.log(`[KernelClient] 请求失败，${delay}ms后重试 (尝试 ${attempt + 1}/${maxRetries}): ${err.message}`);
        this.stats.retries++;
        
        await this._sleep(delay);
      }
    }
    
    // 所有重试失败
    throw lastError;
  }
  
  /**
   * 执行单次HTTP请求
   */
  _doRequest(method, path, body, timeout) {
    return new Promise((resolve, reject) => {
      const url = new URL(this.baseUrl);
      const isHttps = url.protocol === 'https:';
      
      const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: path,
        method: method,
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: timeout
      };

      if (this.token) {
        options.headers['Authorization'] = `Bearer ${this.token}`;
      }

      this.stats.requests++;
      const requestModule = isHttps ? https : http;
      const req = requestModule.request(options, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (res.statusCode >= 500) {
              // 服务器错误，可重试
              const error = new Error(json.error || `服务器错误: ${res.statusCode}`);
              error.type = ErrorType.SERVER_ERROR;
              error.statusCode = res.statusCode;
              reject(error);
            } else if (res.statusCode >= 400) {
              // 客户端错误，不重试
              const error = new Error(json.error || `HTTP ${res.statusCode}`);
              error.type = ErrorType.SERVER_ERROR;
              error.statusCode = res.statusCode;
              error.retryable = false;
              reject(error);
            } else {
              resolve(json);
            }
          } catch (err) {
            if (res.statusCode >= 400) {
              const error = new Error(`HTTP ${res.statusCode}`);
              error.type = ErrorType.SERVER_ERROR;
              error.statusCode = res.statusCode;
              reject(error);
            } else {
              const error = new Error('无效的响应格式');
              error.type = ErrorType.INVALID_RESPONSE;
              reject(error);
            }
          }
        });
      });

      req.on('error', (err) => {
        const error = new Error(err.message);
        error.type = ErrorType.NETWORK;
        reject(error);
      });
      
      req.on('timeout', () => {
        req.destroy();
        const error = new Error(`请求超时 (${timeout}ms)`);
        error.type = ErrorType.TIMEOUT;
        reject(error);
      });

      if (body) {
        req.write(JSON.stringify(body));
      }
      req.end();
    });
  }
  
  /**
   * 检查熔断器状态
   */
  _checkCircuit() {
    const cb = this.circuitBreaker;
    
    if (cb.state === CircuitState.OPEN) {
      // 检查是否可以尝试恢复
      if (Date.now() - cb.lastFailureTime >= cb.timeout) {
        cb.state = CircuitState.HALF_OPEN;
        console.log('[KernelClient] 熔断器进入半开状态，尝试恢复');
        return true;
      }
      return false;
    }
    
    return true;
  }
  
  /**
   * 请求成功处理
   */
  _onSuccess() {
    const cb = this.circuitBreaker;
    this.stats.successes++;
    
    if (cb.state === CircuitState.HALF_OPEN) {
      cb.successCount++;
      if (cb.successCount >= cb.successThreshold) {
        cb.state = CircuitState.CLOSED;
        cb.failureCount = 0;
        cb.successCount = 0;
        console.log('[KernelClient] 熔断器恢复正常');
      }
    } else if (cb.state === CircuitState.CLOSED) {
      cb.failureCount = 0; // 重置失败计数
    }
  }
  
  /**
   * 请求失败处理
   */
  _onFailure(err) {
    const cb = this.circuitBreaker;
    this.stats.failures++;
    this.stats.lastError = { type: err.type, message: err.message };
    
    if (cb.state === CircuitState.HALF_OPEN) {
      // 半开状态失败，立即熔断
      cb.state = CircuitState.OPEN;
      cb.lastFailureTime = Date.now();
      cb.successCount = 0;
      this.stats.circuitOpens++;
      console.log('[KernelClient] 熔断器重新开启');
    } else if (cb.state === CircuitState.CLOSED) {
      cb.failureCount++;
      if (cb.failureCount >= cb.failureThreshold) {
        cb.state = CircuitState.OPEN;
        cb.lastFailureTime = Date.now();
        this.stats.circuitOpens++;
        console.log(`[KernelClient] 熔断器开启 (失败次数: ${cb.failureCount})`);
      }
    }
  }
  
  /**
   * 判断错误是否可重试
   */
  _isRetryable(err) {
    if (err.retryable === false) return false;
    return err.type === ErrorType.NETWORK || 
           err.type === ErrorType.TIMEOUT ||
           (err.type === ErrorType.SERVER_ERROR && err.statusCode >= 500);
  }
  
  /**
   * 根据路径获取超时时间
   */
  _getTimeoutForPath(path) {
    if (path === '/health') return this.timeouts.health;
    if (path.includes('/session/messages')) return this.timeouts.chat;
    if (path.includes('/session')) return this.timeouts.session;
    if (path.includes('/memory')) return this.timeouts.memory;
    return this.timeouts.default;
  }
  
  /**
   * 异步延迟
   */
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  /**
   * 获取统计信息
   */
  getStats() {
    return {
      ...this.stats,
      circuitState: this.circuitBreaker.state,
      failureCount: this.circuitBreaker.failureCount
    };
  }
  
  /**
   * 重置熔断器
   */
  resetCircuit() {
    this.circuitBreaker = {
      state: CircuitState.CLOSED,
      failureCount: 0,
      successCount: 0,
      failureThreshold: this.circuitBreaker.failureThreshold,
      successThreshold: this.circuitBreaker.successThreshold,
      timeout: this.circuitBreaker.timeout,
      lastFailureTime: null
    };
    console.log('[KernelClient] 熔断器已重置');
  }

  // ==================== 健康检查 ====================
  
  async health() {
    return this.request('GET', '/health');
  }

  // ==================== 云端同步配置 ====================
  
  async setCloudConfig(token, userId = null, baseUrl = null) {
    const body = { token };
    if (userId) body.user_id = userId;
    if (baseUrl) body.base_url = baseUrl;
    return this.request('POST', '/api/v1/cloud/config', body);
  }

  // ==================== 会话管理 ====================
  
  async createSession(channel = 'electron', sender = 'user') {
    const result = await this.request('POST', '/api/v1/session', { channel, sender });
    if (result.session_id) {
      this.sessionId = result.session_id;
    }
    return result;
  }

  async getSession(sessionId) {
    return this.request('GET', `/api/v1/session/${sessionId}`);
  }

  async listSessions(limit = 20, offset = 0) {
    return this.request('GET', `/api/v1/session?limit=${limit}&offset=${offset}`);
  }

  async deleteSession(sessionId) {
    return this.request('DELETE', `/api/v1/session/${sessionId}`);
  }
  
  async sendMessage(content, role = 'user') {
    if (!this.sessionId) {
      throw new Error('会话未创建');
    }
    return this.request('POST', '/api/v1/session/messages', {
      session_id: this.sessionId,
      role,
      content
    });
  }
  
  async getMessages(sessionId) {
    return this.request('GET', `/api/v1/session/${sessionId || this.sessionId}/messages`);
  }

  // ==================== 记忆管理 ====================
  
  async saveMemory(content, metadata = {}) {
    return this.request('POST', '/api/v1/memory', { content, metadata });
  }

  async searchMemory(query, k = 10) {
    return this.request('GET', `/api/v1/memory/search?q=${encodeURIComponent(query)}&k=${k}`);
  }

  // ==================== 工具执行 ====================
  
  async executeTool(toolName, params = {}) {
    return this.request('POST', `/api/v1/tools/${toolName}/execute`, { parameters: params });
  }

  // ==================== 技能管理 ====================
  
  async listSkills() {
    return this.request('GET', '/api/v1/skills');
  }

  async getSkill(skillName) {
    return this.request('GET', `/api/v1/skills/${skillName}`);
  }
}

module.exports = KernelClient;
