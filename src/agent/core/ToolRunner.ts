/**
 * 晨翼Agent 内核 - 工具运行器
 * 负责工具注册、验证、执行
 */

import EventEmitter from 'eventemitter3';
import type { Tool, ToolResult, ToolCall, JSONSchema } from '../types';

export interface ToolRunnerEvents {
  'tool:call': (toolCall: ToolCall) => void;
  'tool:result': (toolCall: ToolCall, result: ToolResult) => void;
  'tool:error': (toolCall: ToolCall, error: Error) => void;
}

export class ToolRunner extends EventEmitter<ToolRunnerEvents> {
  private tools: Map<string, Tool> = new Map();

  /**
   * 注册工具
   */
  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      console.warn(`[ToolRunner] Tool "${tool.name}" already registered, overwriting`);
    }
    this.tools.set(tool.name, tool);
  }

  /**
   * 批量注册工具
   */
  registerAll(tools: Tool[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  /**
   * 注销工具
   */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  /**
   * 获取工具
   */
  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /**
   * 获取所有工具
   */
  getAll(): Tool[] {
    return Array.from(this.tools.values());
  }

  /**
   * 获取工具定义 (用于 LLM function calling)
   */
  getDefinitions(): Array<{
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: JSONSchema;
    };
  }> {
    return this.getAll().map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }
    }));
  }

  /**
   * 执行工具
   */
  async execute(toolCall: ToolCall): Promise<ToolResult> {
    const { name, arguments: argsStr } = toolCall.function;

    const tool = this.tools.get(name);
    if (!tool) {
      return {
        success: false,
        error: `Unknown tool: ${name}`
      };
    }

    // 解析参数
    let params: Record<string, any>;
    try {
      params = JSON.parse(argsStr);
    } catch (e) {
      return {
        success: false,
        error: `Invalid JSON arguments: ${argsStr}`
      };
    }

    // 触发事件
    this.emit('tool:call', toolCall);

    try {
      // 执行工具
      const result = await tool.execute(params);

      // 触发结果事件
      this.emit('tool:result', toolCall, result);

      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      
      // 触发错误事件
      this.emit('tool:error', toolCall, err);

      return {
        success: false,
        error: err.message
      };
    }
  }

  /**
   * 批量执行工具
   */
  async executeAll(toolCalls: ToolCall[]): Promise<Map<string, ToolResult>> {
    const results = new Map<string, ToolResult>();

    // 并行执行所有工具
    const promises = toolCalls.map(async (toolCall) => {
      const result = await this.execute(toolCall);
      results.set(toolCall.id, result);
    });

    await Promise.all(promises);
    return results;
  }

  /**
   * 检查工具是否存在
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * 获取工具数量
   */
  size(): number {
    return this.tools.size;
  }
}
