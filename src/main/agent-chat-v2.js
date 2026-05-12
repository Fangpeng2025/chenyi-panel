/**
 * 晨翼Agent - AI对话服务
 * 通过IPC模式对接Rust内核（子进程 + stdin/stdout）
 */

const EventEmitter = require('events');
const KernelIPC = require('./kernel-ipc');

class AgentChat extends EventEmitter {
  constructor(kernelPath) {
    super();
    this.ipc = new KernelIPC({ binaryPath: kernelPath });
    this.sessionId = null;
    this.messages = [];
  }

  /**
   * 初始化：启动内核IPC进程
   */
  async initialize(title = 'AI助手') {
    try {
      this.ipc.start();

      // 等待内核就绪
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('内核启动超时')), 30000);
        this.ipc.once('ready', () => {
          clearTimeout(timeout);
          resolve();
        });
        this.ipc.once('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });

      console.log('[AgentChat] 内核IPC已就绪');
      this.sessionId = 'local-session';
      return true;
    } catch (err) {
      console.error('[AgentChat] 内核启动失败:', err);
      return false;
    }
  }

  /**
   * 设置会话ID
   */
  setSession(sessionId) {
    this.sessionId = sessionId;
    console.log('[AgentChat] 会话已设置:', sessionId);
  }

  /**
   * 发送消息，通过IPC直接调用内核
   */
  async sendMessage(content) {
    if (!this.ipc.isReady()) {
      throw new Error('内核未就绪');
    }

    // 添加用户消息到历史
    const userMessage = {
      role: 'user',
      content: content,
      timestamp: Date.now()
    };
    this.messages.push(userMessage);
    this.emit('message', userMessage);

    try {
      // 通过IPC直接调用内核chat
      const reply = await this.ipc.chat(content);

      // 添加AI回复
      const aiMessage = {
        role: 'assistant',
        content: reply,
        timestamp: Date.now()
      };
      this.messages.push(aiMessage);
      this.emit('message', aiMessage);

      return aiMessage;
    } catch (err) {
      console.error('[AgentChat] 内核调用失败:', err);

      const errorMessage = {
        role: 'assistant',
        content: `内核响应失败：${err.message}`,
        timestamp: Date.now(),
        error: true
      };
      this.messages.push(errorMessage);
      this.emit('message', errorMessage);

      return errorMessage;
    }
  }

  /**
   * 获取对话历史
   */
  getHistory() {
    return this.messages;
  }

  /**
   * 清空对话历史
   */
  clearHistory() {
    this.messages = [];
    this.emit('clear');
  }

  /**
   * 停止内核进程
   */
  stop() {
    this.ipc.stop();
  }
}

module.exports = AgentChat;
