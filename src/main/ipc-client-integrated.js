/**
 * 晨翼Agent - IPC完整集成示例
 * 
 * 展示如何使用所有改进功能：
 * - 结构化日志
 * - 状态恢复
 * - 性能监控
 * - 错误处理
 */

const KernelIPC = require('./kernel-ipc.js');
const { Logger, LogLevel } = require('./logger.js');
const { StateRecoveryManager, StateType, RecoveryStrategy } = require('./state-recovery.js');

/**
 * 完整的IPC客户端封装
 */
class ChenYiIPCClient {
  constructor(options = {}) {
    // 创建日志记录器
    this.logger = new Logger({
      name: options.name || 'ChenYi',
      level: options.logLevel || LogLevel.INFO,
      console: options.consoleLog !== false,
      file: options.logFile,
      jsonFormat: options.jsonLog || false
    });
    
    // 创建状态恢复管理器
    this.recoveryManager = new StateRecoveryManager({
      maxHistorySize: options.maxHistorySize || 100,
      checkpointInterval: options.checkpointInterval || 60000
    });
    
    // 创建IPC客户端
    this.kernel = new KernelIPC({
      binaryPath: options.binaryPath,
      autoRestart: options.autoRestart !== false,
      maxRestartAttempts: options.maxRestartAttempts || 5,
      logger: this.logger,
      recoveryManager: this.recoveryManager
    });
    
    this.currentSession = null;
    this.initialized = false;
    
    // 设置事件监听
    this._setupEventHandlers();
  }
  
  /**
   * 设置事件处理器
   */
  _setupEventHandlers() {
    // 内核就绪
    this.kernel.on('ready', () => {
      this.logger.info('内核已就绪');
      this.initialized = true;
    });
    
    // 内核错误
    this.kernel.on('error', (error) => {
      this.logger.error('内核错误', {
        type: error.type,
        message: error.message,
        timestamp: error.timestamp
      });
      
      // 发出错误事件
      this.emit('error', error);
    });
    
    // 内核退出
    this.kernel.on('exit', ({ code, signal }) => {
      this.logger.warn('内核退出', { code, signal });
      this.initialized = false;
      
      // 保存当前状态
      if (this.currentSession) {
        this.recoveryManager.saveState(
          StateType.SESSION,
          this.currentSession.session_id,
          this.currentSession
        );
      }
    });
    
    // 日志告警
    this.logger.on('alert', (alert) => {
      this.logger.warn('告警触发', alert);
      this.emit('alert', alert);
    });
  }
  
  /**
   * 初始化客户端
   */
  async initialize() {
    this.logger.info('初始化IPC客户端');
    
    // 初始化状态恢复管理器
    this.recoveryManager.initialize();
    
    // 启动内核
    this.kernel.start();
    
    // 等待就绪
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('初始化超时'));
      }, 15000);
      
      this.kernel.once('ready', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }
  
  /**
   * 创建会话（带状态追踪）
   */
  async createSession(title = '新对话') {
    const trace = this.logger.startTrace('createSession', { title });
    
    try {
      const result = await this.kernel.createSession(title);
      
      // 保存会话状态
      this.currentSession = {
        session_id: result.session_id,
        title: title,
        created_at: result.created_at,
        messages: []
      };
      
      this.recoveryManager.saveState(
        StateType.SESSION,
        result.session_id,
        this.currentSession
      );
      
      trace.end({ sessionId: result.session_id });
      this.logger.info('会话创建成功', { sessionId: result.session_id });
      
      return result;
    } catch (error) {
      trace.end({ error: error.message });
      throw error;
    }
  }
  
  /**
   * 发送消息（带状态追踪和重试）
   */
  async sendMessage(content, options = {}) {
    if (!this.currentSession) {
      throw new Error('没有活动会话');
    }
    
    const trace = this.logger.startTrace('sendMessage', {
      sessionId: this.currentSession.session_id,
      contentLength: content.length
    });
    
    try {
      // 发送消息（带状态追踪）
      const response = await this.kernel.send('chat', 
        { message: content },
        {
          timeout: options.timeout || 120000,
          retries: options.retries || 3,
          trackState: true,
          recoveryStrategy: RecoveryStrategy.RETRY
        }
      );
      
      // 更新会话状态
      this.currentSession.messages.push(
        { role: 'user', content },
        { role: 'assistant', content: response.content }
      );
      
      // 保存更新后的状态
      this.recoveryManager.saveState(
        StateType.SESSION,
        this.currentSession.session_id,
        this.currentSession
      );
      
      trace.end({ responseLength: response.content?.length || 0 });
      
      return response;
    } catch (error) {
      trace.end({ error: error.message });
      this.logger.error('消息发送失败', {
        sessionId: this.currentSession.session_id,
        error: error.message,
        type: error.type
      });
      throw error;
    }
  }
  
  /**
   * 获取会话列表
   */
  async listSessions() {
    const trace = this.logger.startTrace('listSessions');
    
    try {
      const sessions = await this.kernel.listSessions();
      trace.end({ count: sessions.length });
      return sessions;
    } catch (error) {
      trace.end({ error: error.message });
      throw error;
    }
  }
  
  /**
   * 删除会话
   */
  async deleteSession(sessionId) {
    const trace = this.logger.startTrace('deleteSession', { sessionId });
    
    try {
      await this.kernel.deleteSession(sessionId);
      
      // 删除状态
      this.recoveryManager.deleteState(StateType.SESSION, sessionId);
      
      // 如果是当前会话，清空
      if (this.currentSession?.session_id === sessionId) {
        this.currentSession = null;
      }
      
      trace.end();
      this.logger.info('会话删除成功', { sessionId });
    } catch (error) {
      trace.end({ error: error.message });
      throw error;
    }
  }
  
  /**
   * 健康检查
   */
  async health() {
    return this.kernel.health();
  }
  
  /**
   * 获取统计信息
   */
  getStats() {
    return {
      kernel: this.kernel.getStats(),
      recovery: this.recoveryManager.getStats(),
      logger: this.logger.getMetrics(),
      initialized: this.initialized,
      currentSession: this.currentSession?.session_id || null
    };
  }
  
  /**
   * 创建检查点
   */
  createCheckpoint(name = 'manual') {
    const checkpointId = this.recoveryManager.createCheckpoint(name);
    this.logger.info('检查点创建', { checkpointId, name });
    return checkpointId;
  }
  
  /**
   * 生成报告
   */
  generateReport() {
    return {
      kernel: this.kernel.getStats(),
      logger: this.logger.generateReport(),
      recovery: this.recoveryManager.getStats()
    };
  }
  
  /**
   * 关闭客户端
   */
  async shutdown() {
    this.logger.info('关闭IPC客户端');
    
    // 创建最终检查点
    this.createCheckpoint('shutdown');
    
    // 停止内核
    this.kernel.stop();
    
    // 清理状态恢复管理器
    this.recoveryManager.cleanup();
    
    // 等待内核完全停止
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    this.logger.info('IPC客户端已关闭');
  }
  
  /**
   * 事件发射（简化版）
   */
  emit(event, data) {
    // 可以集成到实际的事件系统
    console.log(`[Event] ${event}:`, data);
  }
}

// 使用示例
async function example() {
  console.log('\n=== IPC完整集成示例 ===\n');
  
  // 创建客户端
  const client = new ChenYiIPCClient({
    name: 'Example',
    logLevel: LogLevel.INFO,
    consoleLog: true,
    binaryPath: '/home/fangpeng/projects/chenyi-kernel/target/release/chenyi-kernel'
  });
  
  try {
    // 初始化
    console.log('1. 初始化客户端...');
    await client.initialize();
    console.log('✓ 初始化成功');
    
    // 健康检查
    console.log('\n2. 健康检查...');
    const health = await client.health();
    console.log('✓ 健康状态:', health.result);
    
    // 创建会话
    console.log('\n3. 创建会话...');
    const session = await client.createSession('测试对话');
    console.log('✓ 会话ID:', session.session_id);
    
    // 发送消息
    console.log('\n4. 发送消息...');
    const response = await client.sendMessage('你好，请介绍一下自己');
    console.log('✓ 收到回复:', response.content?.substring(0, 100) + '...');
    
    // 创建检查点
    console.log('\n5. 创建检查点...');
    const checkpointId = client.createCheckpoint('after-message');
    console.log('✓ 检查点ID:', checkpointId);
    
    // 查看统计
    console.log('\n6. 统计信息:');
    const stats = client.getStats();
    console.log('  内核请求:', stats.kernel.requests);
    console.log('  成功:', stats.kernel.successes);
    console.log('  失败:', stats.kernel.failures);
    console.log('  状态数:', stats.recovery.stateCount);
    console.log('  检查点数:', stats.recovery.checkpointCount);
    
    // 关闭
    console.log('\n7. 关闭客户端...');
    await client.shutdown();
    console.log('✓ 已关闭');
    
  } catch (error) {
    console.error('错误:', error.message);
    await client.shutdown();
  }
  
  console.log('\n=== 示例完成 ===\n');
}

// 运行示例
if (require.main === module) {
  example().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = ChenYiIPCClient;
