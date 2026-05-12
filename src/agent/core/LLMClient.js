"use strict";
/**
 * 晨翼Agent 内核 - LLM 客户端
 * 统一的 LLM 调用接口
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.LLMClient = void 0;
const providers_1 = require("../providers");
class LLMClient {
    providers = new Map();
    defaultProvider;
    defaultModel;
    fallbackEnabled;
    constructor(config) {
        // 初始化所有 providers
        for (const providerConfig of config.providers) {
            const provider = (0, providers_1.createProvider)(providerConfig);
            this.providers.set(providerConfig.name, provider);
        }
        // 设置默认 provider
        this.defaultProvider = config.defaultProvider || config.providers[0]?.name || '';
        this.defaultModel = config.defaultModel || '';
        this.fallbackEnabled = config.fallbackEnabled ?? true;
    }
    /**
     * 发送聊天请求
     */
    async chat(messages, options) {
        const providerName = options?.provider || this.defaultProvider;
        const provider = this.providers.get(providerName);
        if (!provider) {
            throw new Error(`Provider not found: ${providerName}`);
        }
        // 合并默认模型
        const chatOptions = {
            ...options,
            model: options?.model || this.defaultModel || provider.getDefaultModel()
        };
        try {
            return await provider.chat(messages, chatOptions);
        }
        catch (error) {
            // 如果启用 fallback，尝试其他 provider
            if (this.fallbackEnabled) {
                return await this.fallbackChat(messages, chatOptions, providerName);
            }
            throw error;
        }
    }
    /**
     * 流式聊天
     */
    async *chatStream(messages, options) {
        const providerName = options?.provider || this.defaultProvider;
        const provider = this.providers.get(providerName);
        if (!provider || !provider.chatStream) {
            // 不支持流式，回退到普通请求
            const response = await this.chat(messages, options);
            yield response.choices[0]?.message || { role: 'assistant', content: '' };
            return;
        }
        const chatOptions = {
            ...options,
            model: options?.model || this.defaultModel || provider.getDefaultModel()
        };
        yield* provider.chatStream(messages, chatOptions);
    }
    /**
     * Fallback 到其他 provider
     */
    async fallbackChat(messages, options, failedProvider) {
        for (const [name, provider] of this.providers) {
            if (name === failedProvider)
                continue;
            try {
                console.log(`[LLMClient] Fallback to provider: ${name}`);
                return await provider.chat(messages, options);
            }
            catch (error) {
                console.error(`[LLMClient] Fallback failed for ${name}:`, error);
            }
        }
        throw new Error('All providers failed');
    }
    /**
     * 获取 Provider
     */
    getProvider(name) {
        return this.providers.get(name || this.defaultProvider);
    }
    /**
     * 获取所有 Provider 名称
     */
    getProviderNames() {
        return Array.from(this.providers.keys());
    }
    /**
     * 获取可用模型列表
     */
    async getAvailableModels(providerName) {
        const provider = this.getProvider(providerName);
        if (!provider)
            return [];
        return provider.getModels();
    }
    /**
     * 计算 token 数量
     */
    estimateTokens(text) {
        const provider = this.getProvider();
        return provider?.estimateTokens(text) || Math.ceil(text.length / 4);
    }
    /**
     * 计算 messages 总 token 数
     */
    estimateMessagesTokens(messages) {
        const provider = this.getProvider();
        return provider?.estimateMessagesTokens(messages) ||
            messages.reduce((sum, m) => sum + this.estimateTokens(m.content), 0);
    }
}
exports.LLMClient = LLMClient;
