/**
 * 晨翼Agent - Rust内核IPC客户端
 * 通过子进程 + stdin/stdout 与 Rust内核通信
 * 替代旧版HTTP kernel-client.js
 * 
 * v2.1 - 集成日志系统和状态恢复
 */

const { spawn } = require('child_process');
const path = require('path');
const EventEmitter = require('events');
const { Logger, LogLevel } = require('./logger.js');
const { StateRecoveryManager, StateType, RecoveryStrategy } = require('./state-recovery.js');

// 错误类型枚举
const ErrorType = {
  TIMEOUT: 'TIMEOUT',
  PROCESS_EXIT: 'PROCESS_EXIT',
  PROCESS_ERROR: 'PROCESS_ERROR',
  NOT_READY: 'NOT_READY',
  INVALID_RESPONSE: 'INVALID_RESPONSE',
  KERNEL_ERROR: 'KERNEL_ERROR',
  BUFFER_OVERFLOW: 'BUFFER_OVERFLOW'
};

// 命令超时配置（毫秒）
const CommandTimeout = {
  default: 30000,      // 默认30秒
  health: 5000,        // 健康检查5秒
  chat: 120000,        // 对话2分钟（支持长链工具调用）
  session: 10000,      // 会话操作10秒
  memory: 15000        // 记忆操作15秒
};

class KernelIPC extends EventEmitter {
  constructor(options = {}) {
    super();
    this.binaryPath = options.binaryPath || path.join(__dirname, '../../../chenyi-kernel/target/release/chenyi-kernel');
    this.autoRestart = options.autoRestart !== false;
    this.process = null;
    this.buffer = '';
    this.maxBufferSize = options.maxBufferSize || 10 * 1024 * 1024; // 10MB
    this.pending = new Map(); // id -> { resolve, reject, timer, cmd }
    this.nextId = 1;
    this.running = false;
    this.ready = false;
    
    // 日志系统
    this.logger = options.logger || new Logger({ name: 'KernelIPC', level: LogLevel.INFO });
    
    // 状态恢复管理器
    this.recoveryManager = options.recoveryManager || new StateRecoveryManager();
    
    // 重连配置
    this.restartAttempts = 0;
    this.maxRestartAttempts = options.maxRestartAttempts || 5;
    this.restartDelay = options.restartDelay || 1000; // 初始延迟1秒
    this.maxRestartDelay = options.maxRestartDelay || 30000; // 最大延迟30秒
    
    // 统计信息
    this.stats = {
      requests: 0,
      successes: 0,
      failures: 0,
      restarts: 0,
      lastError: null
    };
  }

  /**
   * 启动Rust内核子进程
   */
  start() {
    if (this.process) return;

    this.running = true;
    this.logger.info(`启动内核 (尝试 ${this.restartAttempts + 1}/${this.maxRestartAttempts})`);
    
    try {
      this.process = spawn(this.binaryPath, ['--ipc'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, RUST_LOG: 'error' }
      });
    } catch (err) {
      this.logger.error('启动失败', { error: err.message });
      this._handleStartError(err);
      return;
    }

    this.process.stdout.on('data', (data) => {
      // 检查缓冲区大小，防止内存溢出
      if (this.buffer.length + data.length > this.maxBufferSize) {
        this.logger.error('缓冲区溢出，清空并重置');
        this.buffer = '';
        this._emitError(ErrorType.BUFFER_OVERFLOW, '缓冲区溢出');
        return;
      }
      this.buffer += data.toString();
      this._processLines();
    });

    this.process.stderr.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) {
        // 区分日志级别
        if (msg.includes('ERROR') || msg.includes('error')) {
          this.logger.error(msg);
        } else if (msg.includes('WARN') || msg.includes('warn')) {
          this.logger.warn(msg);
        } else {
          this.logger.debug(msg);
        }
      }
    });

    this.process.on('exit', (code, signal) => {
      const exitInfo = signal ? `signal=${signal}` : `code=${code}`;
      this.logger.warn(`进程退出 (${exitInfo})`);
      
      // 记录退出原因
      this.stats.lastError = { type: ErrorType.PROCESS_EXIT, code, signal };
      
      this._cleanupProcess();
      this.emit('exit', { code, signal });

      // 自动重启（带指数退避）
      if (this.running && this.autoRestart) {
        this._scheduleRestart();
      }
    });

    this.process.on('error', (err) => {
      this.logger.error('进程错误', { error: err.message });
      this.stats.lastError = { type: ErrorType.PROCESS_ERROR, message: err.message };
      this._emitError(ErrorType.PROCESS_ERROR, err.message);
    });

    this.emit('started');

    // 内核启动后立即发送健康检查，触发ready事件
    this._waitForReady();
  }
  
  /**
   * 等待内核就绪
   */
  _waitForReady() {
    const timeout = setTimeout(() => {
      if (!this.ready) {
        this.logger.error('内核启动超时');
        this._emitError(ErrorType.TIMEOUT, '内核启动超时');
        this._cleanupProcess();
        if (this.running && this.autoRestart) {
          this._scheduleRestart();
        }
      }
    }, 10000);
    
    this.health().then(() => {
      clearTimeout(timeout);
      if (!this.ready) {
        this.ready = true;
        this.restartAttempts = 0; // 重置重试计数
        this.restartDelay = 1000; // 重置延迟
        this.logger.info('内核已就绪');
        this.emit('ready');
        
        // 执行状态恢复
        this._performStateRecovery();
      }
    }).catch((err) => {
      clearTimeout(timeout);
      this.logger.error('健康检查失败', { error: err.message });
    });
  }
  
  /**
   * 执行状态恢复
   */
  async _performStateRecovery() {
    try {
      const result = await this.recoveryManager.performRecovery({ kernelIPC: this });
      if (result.success) {
        this.logger.info('状态恢复成功', {
          recoveredStates: result.recoveredStates,
          recoveredOperations: result.recoveredOperations
        });
      } else {
        this.logger.warn('状态恢复部分失败', {
          errors: result.errors
        });
      }
    } catch (err) {
      this.logger.error('状态恢复失败', { error: err.message });
    }
  }
  
  /**
   * 清理进程资源
   */
  _cleanupProcess() {
    if (this.process) {
      // 移除所有监听器，防止重复触发
      this.process.removeAllListeners();
      try {
        // 尝试优雅关闭
        this.process.kill('SIGTERM');
      } catch (e) {
        // 忽略错误
      }
      this.process = null;
    }
    this.ready = false;
    
    // 拒绝所有待处理的请求
    for (const [id, p] of this.pending) {
      const error = new Error('内核进程已退出');
      error.type = ErrorType.PROCESS_EXIT;
      p.reject(error);
      clearTimeout(p.timer);
    }
    this.pending.clear();
  }
  
  /**
   * 调度重启（指数退避）
   */
  _scheduleRestart() {
    if (this.restartAttempts >= this.maxRestartAttempts) {
      this.logger.error(`达到最大重试次数 (${this.maxRestartAttempts})，停止重试`);
      this.running = false;
      this._emitError(ErrorType.PROCESS_ERROR, '达到最大重试次数');
      return;
    }
    
    this.restartAttempts++;
    this.stats.restarts++;
    
    const delay = Math.min(
      this.restartDelay * Math.pow(2, this.restartAttempts - 1),
      this.maxRestartDelay
    );
    
    this.logger.info(`${delay/1000}秒后自动重启 (尝试 ${this.restartAttempts}/${this.maxRestartAttempts})`);
    
    setTimeout(() => {
      if (this.running) {
        this.start();
      }
    }, delay);
  }
  
  /**
   * 处理启动错误
   */
  _handleStartError(err) {
    this.stats.lastError = { type: ErrorType.PROCESS_ERROR, message: err.message };
    this._emitError(ErrorType.PROCESS_ERROR, err.message);
    
    if (this.running && this.autoRestart) {
      this._scheduleRestart();
    }
  }
  
  /**
   * 发出结构化错误事件
   */
  _emitError(type, message, details = {}) {
    const error = new Error(message);
    error.type = type;
    error.details = details;
    error.timestamp = Date.now();
    this.emit('error', error);
  }

  /**
   * 处理stdout缓冲区中的JSON行
   */
  _processLines() {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || ''; // 保留最后一个不完整的行

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const response = JSON.parse(trimmed);
        // 标记为已就绪
        if (!this.ready) {
          this.ready = true;
          this.emit('ready');
        }
        this._handleResponse(response);
      } catch (err) {
        // 非JSON输出（如健康检查的调试信息），忽略
      }
    }
  }

  /**
   * 处理响应
   */
  _handleResponse(response) {
    const id = response.id;
    if (id !== undefined && this.pending.has(id)) {
      const p = this.pending.get(id);
      this.pending.delete(id);
      clearTimeout(p.timer);
      
      this.stats.requests++;

      if (response.ok) {
        this.stats.successes++;
        if (p.trace) {
          p.trace.end({ success: true });
        }
        p.resolve(response);
      } else {
        this.stats.failures++;
        const error = new Error(response.error || '内核返回失败');
        error.type = ErrorType.KERNEL_ERROR;
        error.details = { cmd: p.cmd, kernelError: response.error };
        this.stats.lastError = { type: ErrorType.KERNEL_ERROR, message: error.message };
        
        if (p.trace) {
          p.trace.end({ success: false, error: error.message });
        }
        p.reject(error);
      }
    } else {
      // 无ID的响应（如事件推送）
      this.emit('response', response);
    }
  }

  /**
   * 发送命令到内核，返回Promise
   * @param {string} cmd - 命令名称
   * @param {object} params - 命令参数
   * @param {object} options - 选项 { timeout, retries, trackState }
   */
  send(cmd, params = {}, options = {}) {
    return new Promise((resolve, reject) => {
      if (!this.process || !this.running) {
        const error = new Error('内核未启动');
        error.type = ErrorType.NOT_READY;
        reject(error);
        return;
      }
      
      if (!this.ready && cmd !== 'health') {
        const error = new Error('内核未就绪');
        error.type = ErrorType.NOT_READY;
        reject(error);
        return;
      }

      const id = this.nextId++;
      const request = { id, cmd, ...params };
      
      // 根据命令类型选择超时时间
      const timeout = options.timeout || this._getTimeoutForCommand(cmd);
      const retries = options.retries || 0;
      
      // 性能追踪
      const trace = this.logger.startTrace(cmd, { id, params });

      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.stats.failures++;
        this.stats.lastError = { type: ErrorType.TIMEOUT, cmd, timeout };
        
        const error = new Error(`命令超时: ${cmd} (${timeout}ms)`);
        error.type = ErrorType.TIMEOUT;
        error.details = { cmd, timeout };
        
        trace.end({ success: false, error: error.message });
        reject(error);
      }, timeout);

      this.pending.set(id, { resolve, reject, timer, cmd, retries, trace });
      
      // 如果需要状态追踪，添加到恢复管理器
      if (options.trackState) {
        this.recoveryManager.addPendingOperation({
          operation: cmd,
          params,
          strategy: options.recoveryStrategy || RecoveryStrategy.RETRY,
          maxAttempts: retries + 1
        });
      }
      
      try {
        this.process.stdin.write(JSON.stringify(request) + '\n');
        this.logger.debug('发送命令', { cmd, id });
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        const error = new Error(`发送命令失败: ${err.message}`);
        error.type = ErrorType.PROCESS_ERROR;
        trace.end({ success: false, error: error.message });
        reject(error);
      }
    });
  }
  
  /**
   * 根据命令类型获取超时时间
   */
  _getTimeoutForCommand(cmd) {
    if (cmd === 'health') return CommandTimeout.health;
    if (cmd === 'chat') return CommandTimeout.chat;
    if (cmd.startsWith('session:')) return CommandTimeout.session;
    if (cmd.startsWith('memory:')) return CommandTimeout.memory;
    return CommandTimeout.default;
  }

  /**
   * 健康检查
   */
  async health() {
    return this.send('health');
  }

  // ==================== 会话管理 ====================

  /**
   * 列出所有会话
   */
  async listSessions() {
    const result = await this.send('session:list');
    return result.sessions || [];
  }

  /**
   * 创建新会话
   */
  async createSession(title = '新对话') {
    return this.send('session:create', { title });
  }

  /**
   * 删除会话
   */
  async deleteSession(sessionId) {
    return this.send('session:delete', { session_id: sessionId });
  }

  /**
   * 获取会话消息
   */
  async getSessionMessages(sessionId) {
    const result = await this.send('session:messages', { session_id: sessionId });
    return result.messages || [];
  }

  /**
   * 对话
   */
  async chat(message) {
    const result = await this.send('chat', { message });
    return result.content;
  }

  /**
   * 停止内核进程
   */
  stop() {
    this.running = false;
    this.logger.info('正在停止内核...');
    
    // 创建检查点
    this.recoveryManager.createCheckpoint('before-stop');
    
    if (this.process) {
      // 尝试优雅关闭
      this.send('exit').catch(() => {});
      
      // 设置强制关闭超时
      const forceKillTimer = setTimeout(() => {
        if (this.process) {
          this.logger.warn('强制终止内核进程');
          try {
            this.process.kill('SIGKILL');
          } catch (e) {
            // 忽略错误
          }
        }
      }, 3000);
      
      // 监听退出事件，清理定时器
      this.process.once('exit', () => {
        clearTimeout(forceKillTimer);
      });
    }
  }
  
  /**
   * 获取统计信息
   */
  getStats() {
    return {
      ...this.stats,
      ready: this.ready,
      running: this.running,
      pendingRequests: this.pending.size,
      restartAttempts: this.restartAttempts,
      logger: this.logger.getMetrics(),
      recovery: this.recoveryManager.getStats()
    };
  }
  
  /**
   * 重置统计信息
   */
  resetStats() {
    this.stats = {
      requests: 0,
      successes: 0,
      failures: 0,
      restarts: 0,
      lastError: null
    };
  }

  /**
   * 检查内核是否就绪
   */
  isReady() {
    return this.ready;
  }
}

module.exports = KernelIPC;
