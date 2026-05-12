/**
 * 晨翼Agent 内核 - Provider 基类
 * 所有 LLM Provider 必须继承此类
 */

import type {
  ProviderConfig,
  Message,
  ChatOptions,
  ChatCompletionResponse,
  ToolDefinition
} from '../types';

export abstract class BaseProvider {
  protected config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  /**
   * 发送聊天请求
   */
  abstract chat(
    messages: Message[],
    options?: ChatOptions
  ): Promise<ChatCompletionResponse>;

  /**
   * 流式聊天请求
   */
  abstract chatStream?(
    messages: Message[],
    options?: ChatOptions
  ): AsyncIterable<Message>;

  /**
   * 获取可用模型列表
   */
  abstract getModels(): Promise<string[]>;

  /**
   * 验证配置
   */
  validateConfig(): boolean {
    return !!(this.config.baseURL && this.config.apiKey);
  }

  /**
   * 获取 Provider 名称
   */
  getName(): string {
    return this.config.name;
  }

  /**
   * 获取默认模型
   */
  getDefaultModel(): string {
    return this.config.defaultModel || this.config.models?.[0]?.id || '';
  }

  /**
   * 构建请求体
   */
  protected buildRequestBody(
    messages: Message[],
    options?: ChatOptions
  ): Record<string, any> {
    const body: Record<string, any> = {
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
  estimateTokens(text: string): number {
    // 简单估算: 英文约 4 字符 = 1 token, 中文约 2 字符 = 1 token
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const otherChars = text.length - chineseChars;
    return Math.ceil(chineseChars / 2 + otherChars / 4);
  }

  /**
   * 计算 messages 总 token 数
   */
  estimateMessagesTokens(messages: Message[]): number {
    return messages.reduce((sum, m) => {
      return sum + this.estimateTokens(m.content);
    }, 0);
  }
}
