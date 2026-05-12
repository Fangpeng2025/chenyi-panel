/**
 * 晨翼Agent - 客户端IPC处理器
 * 
 * 处理渲染进程与ChenYiClient的通信
 * 注意：这个模块提供额外的API，不替换现有的IPC处理器
 * 
 * v2.0 - 增强错误处理和状态管理
 */

const { ipcMain } = require('electron');

let client = null;
let mainWindow = null;

// 错误类型
const ErrorType = {
  CLIENT_NOT_INITIALIZED: 'CLIENT_NOT_INITIALIZED',
  CLIENT_ERROR: 'CLIENT_ERROR',
  NETWORK_ERROR: 'NETWORK_ERROR',
  TIMEOUT: 'TIMEOUT',
  VALIDATION_ERROR: 'VALIDATION_ERROR'
};

// 统计信息
const stats = {
  requests: 0,
  successes: 0,
  failures: 0,
  lastError: null,
  errorsByType: {}
};

/**
 * 创建结构化错误响应
 */
function createErrorResponse(error, type = ErrorType.CLIENT_ERROR) {
  const errorInfo = {
    type: type,
    message: error.message || '未知错误',
    timestamp: Date.now()
  };
  
  // 添加额外错误信息
  if (error.code) errorInfo.code = error.code;
  if (error.statusCode) errorInfo.statusCode = error.statusCode;
  if (error.stack && process.env.NODE_ENV === 'development') {
    errorInfo.stack = error.stack;
  }
  
  // 更新统计
  stats.failures++;
  stats.lastError = errorInfo;
  stats.errorsByType[type] = (stats.errorsByType[type] || 0) + 1;
  
  return { success: false, error: errorInfo };
}

/**
 * 创建成功响应
 */
function createSuccessResponse(data = {}) {
  stats.successes++;
  return { success: true, ...data };
}

/**
 * 检查客户端是否可用
 */
function checkClient() {
  if (!client) {
    return { available: false, error: '客户端未初始化' };
  }
  return { available: true };
}

/**
 * 包装IPC处理器，添加统一错误处理
 */
function wrapHandler(handler) {
  return async (event, ...args) => {
    stats.requests++;
    
    try {
      const result = await handler(event, ...args);
      return result;
    } catch (error) {
      console.error('[ChenYiIPC] 处理器错误:', error.message);
      
      // 根据错误类型返回不同的错误响应
      if (error.message.includes('未初始化')) {
        return createErrorResponse(error, ErrorType.CLIENT_NOT_INITIALIZED);
      } else if (error.message.includes('超时')) {
        return createErrorResponse(error, ErrorType.TIMEOUT);
      } else if (error.message.includes('网络') || error.code === 'ECONNREFUSED') {
        return createErrorResponse(error, ErrorType.NETWORK_ERROR);
      } else {
        return createErrorResponse(error, ErrorType.CLIENT_ERROR);
      }
    }
  };
}

/**
 * 注册IPC处理器
 * @param {BrowserWindow} window - 主窗口
 * @param {ChenYiClient} chenyiClient - 客户端实例（可选）
 */
function registerChenYiIPC(window, chenyiClient = null) {
  mainWindow = window;
  client = chenyiClient;
  
  // ==================== 初始化 ====================
  
  ipcMain.handle('chenyi:initialize', wrapHandler(async (event, config) => {
    // 如果已经有client，直接返回状态
    if (client) {
      return createSuccessResponse({ status: client.getStatus() });
    }
    
    return createSuccessResponse({ status: { initialized: false } });
  }));

  // ==================== 用户认证 ====================
  
  ipcMain.handle('chenyi:login', wrapHandler(async (event, { email, password }) => {
    const check = checkClient();
    if (!check.available) {
      return createErrorResponse(new Error(check.error), ErrorType.CLIENT_NOT_INITIALIZED);
    }
    
    // 参数验证
    if (!email || !password) {
      return createErrorResponse(new Error('邮箱和密码不能为空'), ErrorType.VALIDATION_ERROR);
    }
    
    const result = await client.login(email, password);
    return createSuccessResponse(result);
  }));

  ipcMain.handle('chenyi:register', wrapHandler(async (event, { email, password, name }) => {
    const check = checkClient();
    if (!check.available) {
      return createErrorResponse(new Error(check.error), ErrorType.CLIENT_NOT_INITIALIZED);
    }
    
    // 参数验证
    if (!email || !password) {
      return createErrorResponse(new Error('邮箱和密码不能为空'), ErrorType.VALIDATION_ERROR);
    }
    
    const result = await client.register(email, password, name);
    return createSuccessResponse(result);
  }));

  ipcMain.handle('chenyi:logout', wrapHandler(async () => {
    const check = checkClient();
    if (!check.available) {
      return createErrorResponse(new Error(check.error), ErrorType.CLIENT_NOT_INITIALIZED);
    }
    
    await client.logout();
    return createSuccessResponse();
  }));

  ipcMain.handle('chenyi:get-status', wrapHandler(async () => {
    return createSuccessResponse(
      client ? client.getStatus() : { initialized: false, loggedIn: false }
    );
  }));

  // ==================== 会话管理 ====================
  
  ipcMain.handle('chenyi:create-session', wrapHandler(async () => {
    const check = checkClient();
    if (!check.available) {
      return createErrorResponse(new Error(check.error), ErrorType.CLIENT_NOT_INITIALIZED);
    }
    
    const result = await client.createSession();
    return createSuccessResponse(result);
  }));

  ipcMain.handle('chenyi:send-message', wrapHandler(async (event, { content }) => {
    const check = checkClient();
    if (!check.available) {
      return createErrorResponse(new Error(check.error), ErrorType.CLIENT_NOT_INITIALIZED);
    }
    
    // 参数验证
    if (!content || typeof content !== 'string') {
      return createErrorResponse(new Error('消息内容不能为空'), ErrorType.VALIDATION_ERROR);
    }
    
    const result = await client.sendMessage(content);
    return createSuccessResponse(result);
  }));

  ipcMain.handle('chenyi:get-messages', wrapHandler(async (event, { sessionId }) => {
    const check = checkClient();
    if (!check.available) {
      return createErrorResponse(new Error(check.error), ErrorType.CLIENT_NOT_INITIALIZED);
    }
    
    const result = await client.getMessages(sessionId);
    return createSuccessResponse(result);
  }));

  // ==================== 记忆管理 ====================
  
  ipcMain.handle('chenyi:save-memory', wrapHandler(async (event, { content, metadata }) => {
    const check = checkClient();
    if (!check.available) {
      return createErrorResponse(new Error(check.error), ErrorType.CLIENT_NOT_INITIALIZED);
    }
    
    // 参数验证
    if (!content) {
      return createErrorResponse(new Error('记忆内容不能为空'), ErrorType.VALIDATION_ERROR);
    }
    
    const result = await client.saveMemory(content, metadata || {});
    return createSuccessResponse(result);
  }));

  ipcMain.handle('chenyi:search-memory', wrapHandler(async (event, { query, k }) => {
    const check = checkClient();
    if (!check.available) {
      return createErrorResponse(new Error(check.error), ErrorType.CLIENT_NOT_INITIALIZED);
    }
    
    // 参数验证
    if (!query) {
      return createErrorResponse(new Error('搜索查询不能为空'), ErrorType.VALIDATION_ERROR);
    }
    
    const result = await client.searchMemory(query, k || 10);
    return createSuccessResponse(result);
  }));

  // ==================== 工具执行 ====================
  
  ipcMain.handle('chenyi:execute-tool', wrapHandler(async (event, { toolName, params }) => {
    const check = checkClient();
    if (!check.available) {
      return createErrorResponse(new Error(check.error), ErrorType.CLIENT_NOT_INITIALIZED);
    }
    
    // 参数验证
    if (!toolName) {
      return createErrorResponse(new Error('工具名称不能为空'), ErrorType.VALIDATION_ERROR);
    }
    
    const result = await client.executeTool(toolName, params || {});
    return createSuccessResponse(result);
  }));

  // ==================== 数据同步 ====================
  
  ipcMain.handle('chenyi:sync-from-cloud', wrapHandler(async () => {
    const check = checkClient();
    if (!check.available) {
      return createErrorResponse(new Error(check.error), ErrorType.CLIENT_NOT_INITIALIZED);
    }
    
    const result = await client.syncFromCloud();
    return createSuccessResponse(result);
  }));

  ipcMain.handle('chenyi:sync-to-cloud', wrapHandler(async () => {
    const check = checkClient();
    if (!check.available) {
      return createErrorResponse(new Error(check.error), ErrorType.CLIENT_NOT_INITIALIZED);
    }
    
    const result = await client.syncToCloud();
    return createSuccessResponse(result);
  }));

  // ==================== 设备管理 ====================
  
  ipcMain.handle('chenyi:get-devices', wrapHandler(async () => {
    const check = checkClient();
    if (!check.available) {
      return createErrorResponse(new Error(check.error), ErrorType.CLIENT_NOT_INITIALIZED);
    }
    
    const result = await client.getDevices();
    return createSuccessResponse(result);
  }));
  
  // ==================== 统计和调试 ====================
  
  ipcMain.handle('chenyi:get-stats', wrapHandler(async () => {
    return createSuccessResponse({
      ipc: stats,
      client: client ? client.getStats() : null
    });
  }));
  
  ipcMain.handle('chenyi:reset-stats', wrapHandler(async () => {
    stats.requests = 0;
    stats.successes = 0;
    stats.failures = 0;
    stats.lastError = null;
    stats.errorsByType = {};
    
    if (client && client.resetStats) {
      client.resetStats();
    }
    
    return createSuccessResponse();
  }));
}

/**
 * 获取IPC统计信息
 */
function getStats() {
  return { ...stats };
}

/**
 * 重置统计信息
 */
function resetStats() {
  stats.requests = 0;
  stats.successes = 0;
  stats.failures = 0;
  stats.lastError = null;
  stats.errorsByType = {};
}

module.exports = { registerChenYiIPC, getStats, resetStats, ErrorType };
