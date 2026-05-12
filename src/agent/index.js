/**
 * 晨翼Agent - Agent 服务
 * 管理 Agent 实例，提供统一的 AI 对话接口
 */

const EventEmitter = require('eventemitter3');
const { AgentCore } = require('./core/AgentCore');
const { LLMClient } = require('./core/LLMClient');
const { ToolRunner } = require('./core/ToolRunner');
const { SkillEngine } = require('./core/SkillEngine');
const { MemoryManager } = require('./core/MemoryManager');
const { ContextManager } = require('./core/ContextManager');
const { basicTools } = require('./tools/basic');

class AgentService extends EventEmitter {
  constructor() {
    super();
    
    this.agent = null;
    this.llmClient = null;
    this.toolRunner = null;
    this.skillEngine = null;
    this.memoryManager = null;
    this.contextManager = null;
    
    this.config = null;
    this.initialized = false;
  }

  /**
   * 初始化 Agent 服务
   */
  async initialize(config) {
    if (this.initialized) {
      return { success: true, message: 'Already initialized' };
    }

    this.config = config;

    try {
      // 创建工具运行器
      this.toolRunner = new ToolRunner();
      this.toolRunner.registerAll(basicTools);

      // 创建 Skills 引擎
      this.skillEngine = new SkillEngine();

      // 创建记忆管理器
      this.memoryManager = new MemoryManager({
        persistPath: config.memoryPath || './memory'
      });
      await this.memoryManager.initialize();

      // 创建上下文管理器
      this.contextManager = new ContextManager({
        maxTokens: config.maxTokens || 128000,
        systemPrompt: config.systemPrompt || ''
      });

      // 创建 Agent 核心
      this.agent = new AgentCore({
        provider: config.provider,
        model: config.model,
        context: {
          maxTokens: config.maxTokens || 128000,
          systemPrompt: config.systemPrompt || ''
        },
        tools: basicTools,
        skills: [],
        memory: {
          persistPath: config.memoryPath || './memory'
        }
      });

      // 设置事件监听
      this.setupEventListeners();

      this.initialized = true;
      
      return { success: true, message: 'Agent initialized' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * 设置事件监听
   */
  setupEventListeners() {
    if (!this.agent) return;

    this.agent.on('state:change', (state) => {
      this.emit('state:change', state);
    });

    this.agent.on('message:user', (message) => {
      this.emit('message:user', message);
    });

    this.agent.on('message:assistant', (message, response) => {
      this.emit('message:assistant', message, response);
    });

    this.agent.on('tool:call', (toolCall) => {
      this.emit('tool:call', toolCall);
    });

    this.agent.on('tool:result', (toolCall, result) => {
      this.emit('tool:result', toolCall, result);
    });

    this.agent.on('error', (error) => {
      this.emit('error', error);
    });
  }

  /**
   * 发送消息
   */
  async chat(message, options = {}) {
    if (!this.initialized || !this.agent) {
      throw new Error('Agent not initialized');
    }

    try {
      const response = await this.agent.chat(message);
      
      return {
        success: true,
        message: response.content,
        toolCalls: response.toolCalls || []
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 流式对话
   */
  async *chatStream(message, options = {}) {
    if (!this.initialized || !this.agent) {
      throw new Error('Agent not initialized');
    }

    // 目前使用普通对话，后续可以实现真正的流式
    const response = await this.chat(message, options);
    yield response;
  }

  /**
   * 获取状态
   */
  getState() {
    if (!this.agent) {
      return { status: 'not_initialized' };
    }
    return this.agent.getState();
  }

  /**
   * 清空对话
   */
  clearConversation() {
    if (this.agent) {
      this.agent.clearConversation();
    }
  }

  /**
   * 获取记忆
   */
  getMemory() {
    if (!this.memoryManager) return '';
    return this.memoryManager.getMemory();
  }

  /**
   * 更新记忆
   */
  async updateMemory(content) {
    if (!this.memoryManager) return;
    await this.memoryManager.updateMemory(content);
  }

  /**
   * 注册工具
   */
  registerTool(tool) {
    if (this.toolRunner) {
      this.toolRunner.register(tool);
    }
  }

  /**
   * 注册 Skill
   */
  registerSkill(skill) {
    if (this.skillEngine) {
      this.skillEngine.register(skill);
    }
  }

  /**
   * 设置系统提示词
   */
  setSystemPrompt(prompt) {
    if (this.contextManager) {
      this.contextManager.setSystemPrompt(prompt);
    }
  }

  /**
   * 销毁
   */
  destroy() {
    this.agent = null;
    this.llmClient = null;
    this.toolRunner = null;
    this.skillEngine = null;
    this.memoryManager = null;
    this.contextManager = null;
    this.initialized = false;
  }
}

// 导出单例
module.exports = new AgentService();
module.exports.AgentService = AgentService;
