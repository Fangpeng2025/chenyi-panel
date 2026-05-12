"use strict";
/**
 * 晨翼Agent 内核 - Provider 导出
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.OneAPIProvider = exports.MiniMaxProvider = exports.BaseProvider = void 0;
exports.createProvider = createProvider;
var BaseProvider_1 = require("./BaseProvider");
Object.defineProperty(exports, "BaseProvider", { enumerable: true, get: function () { return BaseProvider_1.BaseProvider; } });
var MiniMaxProvider_1 = require("./MiniMaxProvider");
Object.defineProperty(exports, "MiniMaxProvider", { enumerable: true, get: function () { return MiniMaxProvider_1.MiniMaxProvider; } });
var OneAPIProvider_1 = require("./OneAPIProvider");
Object.defineProperty(exports, "OneAPIProvider", { enumerable: true, get: function () { return OneAPIProvider_1.OneAPIProvider; } });
const MiniMaxProvider_2 = require("./MiniMaxProvider");
const OneAPIProvider_2 = require("./OneAPIProvider");
/**
 * 创建 Provider 实例
 */
function createProvider(config) {
    const name = config.name.toLowerCase();
    if (name.includes('minimax')) {
        return new MiniMaxProvider_2.MiniMaxProvider(config);
    }
    if (name.includes('oneapi') || name.includes('xintiandi')) {
        return new OneAPIProvider_2.OneAPIProvider(config);
    }
    // 默认使用 OneAPI 兼容
    return new OneAPIProvider_2.OneAPIProvider(config);
}
