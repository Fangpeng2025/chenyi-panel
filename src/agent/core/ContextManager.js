"use strict";
/**
 * 晨翼Agent 内核 - 上下文管理器
 * 管理对话上下文、Token 计数、压缩
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContextManager = void 0;
class ContextManager {
    config;
    state;
    tokenEstimator;
    constructor(config = {}) {
        this.config = {
            maxTokens: config.maxTokens || 128000,
            systemPrompt: config.systemPrompt || '',
            compressionThreshold: config.compressionThreshold || 0.9,
            compressionRatio: config.compressionRatio || 0.5
        };
        this.state = {
            messages: [],
            tokenCount: 0,
            systemPrompt: this.config.systemPrompt,
            memoryInjected: false
        };
        // 简单的 token 估算器
        this.tokenEstimator = (text) => {
            const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
            const otherChars = text.length - chineseChars;
            return Math.ceil(chineseChars / 2 + otherChars / 4);
        };
    }
    /**
     * 设置 Token 估算器
     */
    setTokenEstimator(estimator) {
        this.tokenEstimator = estimator;
    }
    /**
     * 设置系统提示词
     */
    setSystemPrompt(prompt) {
        this.state.systemPrompt = prompt;
        this.config.systemPrompt = prompt;
    }
    /**
     * 获取系统提示词
     */
    getSystemPrompt() {
        return this.state.systemPrompt;
    }
    /**
     * 添加消息
     */
    addMessage(message) {
        this.state.messages.push(message);
        this.state.tokenCount += this.estimateTokens(message.content);
    }
    /**
     * 添加多条消息
     */
    addMessages(messages) {
        for (const msg of messages) {
            this.addMessage(msg);
        }
    }
    /**
     * 获取所有消息
     */
    getMessages() {
        return [...this.state.messages];
    }
    /**
     * 获取完整上下文（包含系统提示词）
     */
    getFullContext() {
        const messages = [];
        // 添加系统提示词
        if (this.state.systemPrompt) {
            messages.push({
                role: 'system',
                content: this.state.systemPrompt
            });
        }
        // 添加对话消息
        messages.push(...this.state.messages);
        return messages;
    }
    /**
     * 计算 token 数量
     */
    estimateTokens(text) {
        return this.tokenEstimator(text);
    }
    /**
     * 获取当前 token 数量
     */
    getTokenCount() {
        return this.state.tokenCount + this.estimateTokens(this.state.systemPrompt);
    }
    /**
     * 检查是否需要压缩
     */
    needsCompression() {
        const ratio = this.getTokenCount() / this.config.maxTokens;
        return ratio >= this.config.compressionThreshold;
    }
    /**
     * 压缩上下文
     */
    async compress(summarizer) {
        if (!this.needsCompression())
            return;
        // 保留最近的消息
        const keepCount = Math.floor(this.state.messages.length * (1 - this.config.compressionRatio));
        const toCompress = this.state.messages.slice(0, -keepCount);
        const toKeep = this.state.messages.slice(-keepCount);
        if (toCompress.length === 0)
            return;
        // 生成摘要
        const summary = await summarizer(toCompress);
        // 更新上下文
        this.state.messages = [
            {
                role: 'system',
                content: `[Previous conversation summary]\n${summary}`
            },
            ...toKeep
        ];
        // 重新计算 token 数
        this.state.tokenCount = this.state.messages.reduce((sum, msg) => sum + this.estimateTokens(msg.content), 0);
    }
    /**
     * 清空上下文
     */
    clear() {
        this.state.messages = [];
        this.state.tokenCount = 0;
        this.state.memoryInjected = false;
    }
    /**
     * 注入记忆
     */
    injectMemory(memoryContent) {
        if (this.state.memoryInjected)
            return;
        const memoryPrompt = `
## User Memory

${memoryContent}

`;
        this.state.systemPrompt = memoryPrompt + this.config.systemPrompt;
        this.state.memoryInjected = true;
    }
    /**
     * 获取状态
     */
    getState() {
        return { ...this.state };
    }
    /**
     * 恢复状态
     */
    restoreState(state) {
        this.state = { ...state };
    }
    /**
     * 导出上下文
     */
    export() {
        return JSON.stringify({
            config: this.config,
            state: this.state
        });
    }
    /**
     * 导入上下文
     */
    import(data) {
        try {
            const parsed = JSON.parse(data);
            if (parsed.config)
                this.config = parsed.config;
            if (parsed.state)
                this.state = parsed.state;
        }
        catch (e) {
            console.error('[ContextManager] Failed to import context:', e);
        }
    }
}
exports.ContextManager = ContextManager;
