"use strict";
/**
 * 晨翼Agent 内核 - 工具运行器
 * 负责工具注册、验证、执行
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ToolRunner = void 0;
const eventemitter3_1 = __importDefault(require("eventemitter3"));
class ToolRunner extends eventemitter3_1.default {
    tools = new Map();
    /**
     * 注册工具
     */
    register(tool) {
        if (this.tools.has(tool.name)) {
            console.warn(`[ToolRunner] Tool "${tool.name}" already registered, overwriting`);
        }
        this.tools.set(tool.name, tool);
    }
    /**
     * 批量注册工具
     */
    registerAll(tools) {
        for (const tool of tools) {
            this.register(tool);
        }
    }
    /**
     * 注销工具
     */
    unregister(name) {
        return this.tools.delete(name);
    }
    /**
     * 获取工具
     */
    get(name) {
        return this.tools.get(name);
    }
    /**
     * 获取所有工具
     */
    getAll() {
        return Array.from(this.tools.values());
    }
    /**
     * 获取工具定义 (用于 LLM function calling)
     */
    getDefinitions() {
        return this.getAll().map(tool => ({
            type: 'function',
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
    async execute(toolCall) {
        const { name, arguments: argsStr } = toolCall.function;
        const tool = this.tools.get(name);
        if (!tool) {
            return {
                success: false,
                error: `Unknown tool: ${name}`
            };
        }
        // 解析参数
        let params;
        try {
            params = JSON.parse(argsStr);
        }
        catch (e) {
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
        }
        catch (error) {
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
    async executeAll(toolCalls) {
        const results = new Map();
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
    has(name) {
        return this.tools.has(name);
    }
    /**
     * 获取工具数量
     */
    size() {
        return this.tools.size;
    }
}
exports.ToolRunner = ToolRunner;
