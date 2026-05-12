/**
 * 晨翼Agent 内核 - Agent 核心
 * 统一的 Agent 入口
 */

import EventEmitter from 'eventemitter3';
import { LLMClient } from './LLMClient';
import { ToolRunner } from './ToolRunner';
import { SkillEngine } from './SkillEngine';
import { MemoryManager } from './MemoryManager';
import { ContextManager } from './ContextManager';
import type {
  AgentConfig,
  AgentState,
  Message,
  ChatCompletionResponse,
  ToolCall,
  ToolResult
} from '../types';

export interface AgentCoreEvents {
  'state:change': (state: AgentState) => void;
  'message:user': (message: Message) => void;
  'message:assistant': (message: Message, response: ChatCompletionResponse) => void;
  'tool:call': (toolCall: ToolCall) => void;
  'tool:result': (toolCall: ToolCall, result: ToolResult) => void;
  'skill:match': (skillId: string) => void;
  'error': (error: Error) => void;
}

export class AgentCore extends EventEmitter<AgentCoreEvents> {
  private llmClient: LLMClient;
  private toolRunner: ToolRunner;
  private skillEngine: SkillEngine;
  private memoryManager: MemoryManager;
  private contextManager: ContextManager;
  
  private state: AgentState;
  private config: AgentConfig;

  constructor(config: AgentConfig) {
    super();

    this.config = config;

    // 初始化各个模块
    this.llmClient = new LLMClient({
      providers: [config.provider],
      defaultProvider: config.provider.name,
      defaultModel: config.model
    });

    this.toolRunner = new ToolRunner();
    if (config.tools) {
      this.toolRunner.registerAll(config.tools);
    }

    this.skillEngine = new SkillEngine();
    if (config.skills) {
      for (const skill of config.skills) {
        this.skillEngine.register(skill);
      }
    }

    this.memoryManager = new MemoryManager(config.memory);
    this.contextManager = new ContextManager(config.context);

    // 设置工具事件监听
    this.setupToolListeners();

    // 初始化状态
    this.state = {
      id: this.generateId(),
      status: 'idle',
      lastActivity: new Date(),
      messageCount: 0,
      tokenUsage: { prompt: 0, completion: 0, total: 0 }
    };
  }

  /**
   * 初始化 Agent
   */
  async initialize(): Promise<void> {
    await this.memoryManager.initialize();
    
    // 注入记忆到上下文
    const memory = this.memoryManager.getMemory();
    if (memory) {
      this.contextManager.injectMemory(memory);
    }
  }

  /**
   * 发送消息
   */
  async chat(userMessage: string): Promise<Message> {
    // 更新状态
    this.updateState({ status: 'thinking', currentTask: userMessage });

    try {
      // 检查是否匹配 Skill
      const matchedSkill = this.skillEngine.getBestMatch(userMessage);
      if (matchedSkill) {
        this.emit('skill:match', matchedSkill.id);
      }

      // 添加用户消息到上下文
      const userMsg: Message = { role: 'user', content: userMessage };
      this.contextManager.addMessage(userMsg);
      this.emit('message:user', userMsg);

      // 检查是否需要压缩上下文
      if (this.contextManager.needsCompression()) {
        await this.compressContext();
      }

      // 获取完整上下文
      const messages = this.contextManager.getFullContext();

      // 调用 LLM
      const response = await this.llmClient.chat(messages, {
        tools: this.toolRunner.getDefinitions()
      });

      // 处理响应
      const assistantMsg = response.choices[0]?.message;
      if (!assistantMsg) {
        throw new Error('No response from LLM');
      }

      // 检查是否有工具调用
      if (assistantMsg.toolCalls && assistantMsg.toolCalls.length > 0) {
        return await this.handleToolCalls(assistantMsg.toolCalls, response);
      }

      // 添加助手消息到上下文
      this.contextManager.addMessage(assistantMsg);
      this.emit('message:assistant', assistantMsg, response);

      // 更新统计
      this.updateStats(response);
      this.updateState({ status: 'idle', currentTask: undefined });

      return assistantMsg;

    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.emit('error', err);
      this.updateState({ status: 'error', currentTask: undefined });
      throw err;
    }
  }

  /**
   * 处理工具调用
   */
  private async handleToolCalls(
    toolCalls: ToolCall[],
    initialResponse: ChatCompletionResponse
  ): Promise<Message> {
    this.updateState({ status: 'executing' });

    // 添加助手消息（包含工具调用）到上下文
    this.contextManager.addMessage({
      role: 'assistant',
      content: '',
      toolCalls
    });

    // 执行所有工具
    const results = await this.toolRunner.executeAll(toolCalls);

    // 添加工具结果到上下文
    for (const toolCall of toolCalls) {
      const result = results.get(toolCall.id);
      if (result) {
        this.contextManager.addMessage({
          role: 'tool',
          content: JSON.stringify(result),
          toolCallId: toolCall.id
        });
      }
    }

    // 再次调用 LLM 获取最终响应
    const messages = this.contextManager.getFullContext();
    const response = await this.llmClient.chat(messages);

    const assistantMsg = response.choices[0]?.message;
    if (assistantMsg) {
      this.contextManager.addMessage(assistantMsg);
      this.emit('message:assistant', assistantMsg, response);
    }

    this.updateStats(response);
    this.updateState({ status: 'idle' });

    return assistantMsg || { role: 'assistant', content: '' };
  }

  /**
   * 压缩上下文
   */
  private async compressContext(): Promise<void> {
    await this.contextManager.compress(async (messages) => {
      // 使用 LLM 生成摘要
      const response = await this.llmClient.chat([
        {
          role: 'system',
          content: 'Summarize the following conversation concisely, preserving key information:'
        },
        ...messages
      ]);
      return response.choices[0]?.message?.content || '';
    });
  }

  /**
   * 设置工具事件监听
   */
  private setupToolListeners(): void {
    this.toolRunner.on('tool:call', (toolCall) => {
      this.emit('tool:call', toolCall);
    });

    this.toolRunner.on('tool:result', (toolCall, result) => {
      this.emit('tool:result', toolCall, result);
    });
  }

  /**
   * 更新状态
   */
  private updateState(updates: Partial<AgentState>): void {
    this.state = { ...this.state, ...updates, lastActivity: new Date() };
    this.emit('state:change', this.state);
  }

  /**
   * 更新统计信息
   */
  private updateStats(response: ChatCompletionResponse): void {
    if (response.usage) {
      this.state.tokenUsage.prompt += response.usage.promptTokens;
      this.state.tokenUsage.completion += response.usage.completionTokens;
      this.state.tokenUsage.total += response.usage.totalTokens;
    }
    this.state.messageCount++;
  }

  /**
   * 生成唯一 ID
   */
  private generateId(): string {
    return `agent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // ==================== 公共 API ====================

  /**
   * 获取状态
   */
  getState(): AgentState {
    return { ...this.state };
  }

  /**
   * 注册工具
   */
  registerTool(tool: any): void {
    this.toolRunner.register(tool);
  }

  /**
   * 注册 Skill
   */
  registerSkill(skill: any): void {
    this.skillEngine.register(skill);
  }

  /**
   * 获取记忆管理器
   */
  getMemoryManager(): MemoryManager {
    return this.memoryManager;
  }

  /**
   * 获取上下文管理器
   */
  getContextManager(): ContextManager {
    return this.contextManager;
  }

  /**
   * 清空对话
   */
  clearConversation(): void {
    this.contextManager.clear();
  }

  /**
   * 导出状态
   */
  exportState(): string {
    return JSON.stringify({
      state: this.state,
      context: this.contextManager.export()
    });
  }

  /**
   * 导入状态
   */
  importState(data: string): void {
    try {
      const parsed = JSON.parse(data);
      if (parsed.state) this.state = parsed.state;
      if (parsed.context) this.contextManager.import(parsed.context);
    } catch (e) {
      console.error('[AgentCore] Failed to import state:', e);
    }
  }
}
