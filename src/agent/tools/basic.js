"use strict";
/**
 * 晨翼Agent 内核 - 基础工具
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.basicTools = exports.httpRequestTool = exports.execTool = exports.listDirTool = exports.writeFileTool = exports.readFileTool = void 0;
/**
 * 读取文件工具
 */
exports.readFileTool = {
    name: 'read_file',
    description: 'Read content from a file',
    parameters: {
        type: 'object',
        properties: {
            path: {
                type: 'string',
                description: 'File path to read'
            }
        },
        required: ['path']
    },
    execute: async (params) => {
        try {
            if (typeof require === 'undefined') {
                return { success: false, error: 'File system not available' };
            }
            const fs = await Promise.resolve().then(() => __importStar(require('fs/promises')));
            const content = await fs.readFile(params.path, 'utf-8');
            return { success: true, data: content };
        }
        catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }
};
/**
 * 写入文件工具
 */
exports.writeFileTool = {
    name: 'write_file',
    description: 'Write content to a file',
    parameters: {
        type: 'object',
        properties: {
            path: {
                type: 'string',
                description: 'File path to write'
            },
            content: {
                type: 'string',
                description: 'Content to write'
            }
        },
        required: ['path', 'content']
    },
    execute: async (params) => {
        try {
            if (typeof require === 'undefined') {
                return { success: false, error: 'File system not available' };
            }
            const fs = await Promise.resolve().then(() => __importStar(require('fs/promises')));
            const path = await Promise.resolve().then(() => __importStar(require('path')));
            // 确保目录存在
            await fs.mkdir(path.dirname(params.path), { recursive: true });
            await fs.writeFile(params.path, params.content, 'utf-8');
            return { success: true, data: { path: params.path } };
        }
        catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }
};
/**
 * 列出目录工具
 */
exports.listDirTool = {
    name: 'list_dir',
    description: 'List files and directories in a path',
    parameters: {
        type: 'object',
        properties: {
            path: {
                type: 'string',
                description: 'Directory path to list'
            }
        },
        required: ['path']
    },
    execute: async (params) => {
        try {
            if (typeof require === 'undefined') {
                return { success: false, error: 'File system not available' };
            }
            const fs = await Promise.resolve().then(() => __importStar(require('fs/promises')));
            const entries = await fs.readdir(params.path, { withFileTypes: true });
            const result = entries.map(entry => ({
                name: entry.name,
                type: entry.isDirectory() ? 'directory' : 'file'
            }));
            return { success: true, data: result };
        }
        catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }
};
/**
 * 执行命令工具
 */
exports.execTool = {
    name: 'exec',
    description: 'Execute a shell command',
    parameters: {
        type: 'object',
        properties: {
            command: {
                type: 'string',
                description: 'Command to execute'
            },
            timeout: {
                type: 'number',
                description: 'Timeout in milliseconds (default: 30000)'
            }
        },
        required: ['command']
    },
    execute: async (params) => {
        try {
            if (typeof require === 'undefined') {
                return { success: false, error: 'Shell not available' };
            }
            const { exec } = require('child_process');
            const util = require('util');
            const execPromise = util.promisify(exec);
            const { stdout, stderr } = await execPromise(params.command, {
                timeout: params.timeout || 30000,
                maxBuffer: 1024 * 1024 * 10 // 10MB
            });
            return {
                success: true,
                data: {
                    stdout: stdout.toString(),
                    stderr: stderr.toString()
                }
            };
        }
        catch (error) {
            return {
                success: false,
                error: error.message || String(error),
                data: {
                    stdout: error.stdout?.toString() || '',
                    stderr: error.stderr?.toString() || ''
                }
            };
        }
    }
};
/**
 * HTTP 请求工具
 */
exports.httpRequestTool = {
    name: 'http_request',
    description: 'Make an HTTP request',
    parameters: {
        type: 'object',
        properties: {
            url: {
                type: 'string',
                description: 'URL to request'
            },
            method: {
                type: 'string',
                enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
                description: 'HTTP method'
            },
            headers: {
                type: 'object',
                description: 'Request headers'
            },
            body: {
                type: 'string',
                description: 'Request body (for POST/PUT/PATCH)'
            }
        },
        required: ['url']
    },
    execute: async (params) => {
        try {
            const response = await fetch(params.url, {
                method: params.method || 'GET',
                headers: params.headers,
                body: params.body
            });
            const text = await response.text();
            return {
                success: response.ok,
                data: {
                    status: response.status,
                    statusText: response.statusText,
                    headers: Object.fromEntries(response.headers.entries()),
                    body: text
                }
            };
        }
        catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }
};
/**
 * 所有基础工具
 */
exports.basicTools = [
    exports.readFileTool,
    exports.writeFileTool,
    exports.listDirTool,
    exports.execTool,
    exports.httpRequestTool
];
