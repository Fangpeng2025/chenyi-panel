"use strict";
/**
 * 晨翼Agent 内核 - OneAPI Provider
 * 支持 OneAPI 兼容的服务 (XinTianDi 等)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.OneAPIProvider = void 0;
const BaseProvider_1 = require("./BaseProvider");
class OneAPIProvider extends BaseProvider_1.BaseProvider {
    constructor(config) {
        super(config);
    }
    async chat(messages, options) {
        const url = `${this.config.baseURL}/chat/completions`;
        const body = this.buildRequestBody(messages, options);
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.config.apiKey}`
            },
            body: JSON.stringify(body)
        });
        if (!response.ok) {
            const error = await response.text();
            throw new Error(`OneAPI error: ${response.status} - ${error}`);
        }
        const data = await response.json();
        return this.normalizeResponse(data);
    }
    async *chatStream(messages, options) {
        const url = `${this.config.baseURL}/chat/completions`;
        const body = { ...this.buildRequestBody(messages, options), stream: true };
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.config.apiKey}`
            },
            body: JSON.stringify(body)
        });
        if (!response.ok) {
            const error = await response.text();
            throw new Error(`OneAPI error: ${response.status} - ${error}`);
        }
        const reader = response.body?.getReader();
        if (!reader)
            throw new Error('No response body');
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6);
                    if (data === '[DONE]')
                        return;
                    try {
                        const parsed = JSON.parse(data);
                        const delta = parsed.choices?.[0]?.delta;
                        if (delta?.content) {
                            yield {
                                role: 'assistant',
                                content: delta.content
                            };
                        }
                    }
                    catch (e) {
                        // 忽略解析错误
                    }
                }
            }
        }
    }
    async getModels() {
        // OneAPI 通常支持多个模型，从配置中获取
        return this.config.models?.map(m => m.id) || [];
    }
    normalizeResponse(data) {
        return {
            id: data.id || '',
            object: data.object || 'chat.completion',
            created: data.created || Date.now(),
            model: data.model || this.getDefaultModel(),
            choices: (data.choices || []).map((choice) => ({
                index: choice.index || 0,
                message: {
                    role: 'assistant',
                    content: choice.message?.content || '',
                    toolCalls: choice.message?.tool_calls
                },
                finishReason: choice.finish_reason || 'stop'
            })),
            usage: data.usage ? {
                promptTokens: data.usage.prompt_tokens || 0,
                completionTokens: data.usage.completion_tokens || 0,
                totalTokens: data.usage.total_tokens || 0
            } : undefined
        };
    }
}
exports.OneAPIProvider = OneAPIProvider;
