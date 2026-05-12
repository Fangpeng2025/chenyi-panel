"use strict";
/**
 * 晨翼Agent 内核 - Provider 基类
 * 所有 LLM Provider 必须继承此类
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseProvider = void 0;
class BaseProvider {
    config;
    constructor(config) {
        this.config = config;
    }
    /**
     * 验证配置
     */
    validateConfig() {
        return !!(this.config.baseURL && this.config.apiKey);
    }
    /**
     * 获取 Provider 名称
     */
    getName() {
        return this.config.name;
    }
    /**
     * 获取默认模型
     */
    getDefaultModel() {
        return this.config.defaultModel || this.config.models?.[0]?.id || '';
    }
    /**
     * 构建请求体
     */
    buildRequestBody(messages, options) {
        const body = {
            model: options?.model || this.getDefaultModel(),
            messages: messages.map(m => ({
                role: m.role,
                content: m.content,
                ...(m.name && { name: m.name }),
                ...(m.toolCalls && { tool_calls: m.toolCalls }),
                ...(m.toolCallId && { tool_call_id: m.toolCallId })
            })),
            temperature: options?.temperature ?? 0.7,
            top_p: options?.topP ?? 0.9,
            max_tokens: options?.maxTokens ?? 4096
        };
        if (options?.tools) {
            body.tools = options.tools;
        }
        if (options?.stop) {
            body.stop = options.stop;
        }
        return body;
    }
    /**
     * 计算 token 数量 (估算)
     */
    estimateTokens(text) {
        // 简单估算: 英文约 4 字符 = 1 token, 中文约 2 字符 = 1 token
        const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
        const otherChars = text.length - chineseChars;
        return Math.ceil(chineseChars / 2 + otherChars / 4);
    }
    /**
     * 计算 messages 总 token 数
     */
    estimateMessagesTokens(messages) {
        return messages.reduce((sum, m) => {
            return sum + this.estimateTokens(m.content);
        }, 0);
    }
}
exports.BaseProvider = BaseProvider;
