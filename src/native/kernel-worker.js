/**
 * 内核 Worker - 在独立线程中执行内核操作
 */

const { parentPort } = require('worker_threads');
const path = require('path');

// 处理asar路径 - Electron打包后native模块在asar包外
const getNativePath = () => {
  // 开发环境
  if (__dirname.includes('src/native')) {
    return path.join(__dirname, 'chenyi-kernel.linux-x64-gnu.node');
  }
  // 打包环境 - native模块被解压到app.asar.unpacked
  return __dirname.replace('app.asar', 'app.asar.unpacked') + '/chenyi-kernel.linux-x64-gnu.node';
};

// 加载原生模块
let nativeModule;
try {
  nativeModule = require(getNativePath());
} catch (err) {
  // 尝试直接路径
  try {
    nativeModule = require('./chenyi-kernel.linux-x64-gnu.node');
  } catch (err2) {
    console.error('加载 Rust 内核失败:', err, err2);
    nativeModule = null;
  }
}

let kernel = null;

// 初始化内核
function initialize() {
  if (!nativeModule) {
    throw new Error('Rust 内核不可用');
  }
  
  kernel = new nativeModule.AgentKernel();
  kernel.initialize();
  return true;
}

// 处理消息
parentPort.on('message', (data) => {
  const { id, action, args } = data;
  
  try {
    let result;
    
    switch (action) {
      case 'initialize':
        result = initialize();
        break;
        
      case 'chatWithTools':
        if (!kernel) throw new Error('内核未初始化');
        const { message, history, model, thinking, enableTools } = args;
        const historyPairs = history.map(h => [h.role, h.content]);
        const resultStr = kernel.chatWithTools(message, historyPairs, model || null, thinking || null, enableTools || false);
        result = JSON.parse(resultStr);
        break;
        
      case 'executeTool':
        if (!kernel) throw new Error('内核未初始化');
        const { toolName, params } = args;
        const toolResult = kernel.executeTool(toolName, params);
        result = JSON.parse(toolResult);
        break;
        
      default:
        throw new Error(`未知操作: ${action}`);
    }
    
    parentPort.postMessage({ id, success: true, result });
  } catch (e) {
    parentPort.postMessage({ id, success: false, error: e.message });
  }
});
