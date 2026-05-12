"use strict";
/**
 * 晨翼Agent 内核 - Agent 核心
 * 统一的 Agent 入口
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentCore = void 0;
const eventemitter3_1 = __importDefault(require("eventemitter3"));
const LLMClient_1 = require("./LLMClient");
const ToolRunner_1 = require("./ToolRunner");
const SkillEngine_1 = require("./SkillEngine");
const MemoryManager_1 = require("./MemoryManager");
const ContextManager_1 = require("./ContextManager");
class AgentCore extends eventemitter3_1.default {
    llmClient;
    toolRunner;
    skillEngine;
    memoryManager;
    contextManager;
    state;
    config;
    constructor(config) {
        super();
        this.config = config;
        // 初始化各个模块
        this.llmClient = new LLMClient_1.LLMClient({
            providers: [config.provider],
            defaultProvider: config.provider.name,
            defaultModel: config.model
        });
        this.toolRunner = new ToolRunner_1.ToolRunner();
        if (config.tools) {
            this.toolRunner.registerAll(config.tools);
        }
        this.skillEngine = new SkillEngine_1.SkillEngine();
        if (config.skills) {
            for (const skill of config.skills) {
                this.skillEngine.register(skill);
            }
        }
        this.memoryManager = new MemoryManager_1.MemoryManager(config.memory);
        this.contextManager = new ContextManager_1.ContextManager(config.context);
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
    async initialize() {
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
    async chat(userMessage) {
        // 更新状态
        this.updateState({ status: 'thinking', currentTask: userMessage });
        try {
            // 检查是否匹配 Skill
            const matchedSkill = this.skillEngine.getBestMatch(userMessage);
            if (matchedSkill) {
                this.emit('skill:match', matchedSkill.id);
            }
            // 添加用户消息到上下文
            const userMsg = { role: 'user', content: userMessage };
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
        }
        catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            this.emit('error', err);
            this.updateState({ status: 'error', currentTask: undefined });
            throw err;
        }
    }
    /**
     * 处理工具调用
     */
    async handleToolCalls(toolCalls, initialResponse) {
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
    async compressContext() {
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
    setupToolListeners() {
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
    updateState(updates) {
        this.state = { ...this.state, ...updates, lastActivity: new Date() };
        this.emit('state:change', this.state);
    }
    /**
     * 更新统计信息
     */
    updateStats(response) {
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
    generateId() {
        return `agent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    // ==================== 公共 API ====================
    /**
     * 获取状态
     */
    getState() {
        return { ...this.state };
    }
    /**
     * 注册工具
     */
    registerTool(tool) {
        this.toolRunner.register(tool);
    }
    /**
     * 注册 Skill
     */
    registerSkill(skill) {
        this.skillEngine.register(skill);
    }
    /**
     * 获取记忆管理器
     */
    getMemoryManager() {
        return this.memoryManager;
    }
    /**
     * 获取上下文管理器
     */
    getContextManager() {
        return this.contextManager;
    }
    /**
     * 清空对话
     */
    clearConversation() {
        this.contextManager.clear();
    }
    /**
     * 导出状态
     */
    exportState() {
        return JSON.stringify({
            state: this.state,
            context: this.contextManager.export()
        });
    }
    /**
     * 导入状态
     */
    importState(data) {
        try {
            const parsed = JSON.parse(data);
            if (parsed.state)
                this.state = parsed.state;
            if (parsed.context)
                this.contextManager.import(parsed.context);
        }
        catch (e) {
            console.error('[AgentCore] Failed to import state:', e);
        }
    }
}
exports.AgentCore = AgentCore;
