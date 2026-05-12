/**
 * 晨翼Agent - 模型配置 IPC v3.0
 * 
 * 极简设计，参考 Hermes
 */

const { ModelConfigManager } = require('../config/model-config');

const modelConfig = new ModelConfigManager();

function registerModelConfigHandlers(ipcMain, mainWindow) {
  
  // ==================== 获取配置 ====================
  
  // 获取完整配置（UI 显示）
  ipcMain.handle('model:get-config', async () => {
    return modelConfig.getConfig();
  });
  
  // 获取当前模型配置（LLM 调用）
  ipcMain.handle('model:get-current', async () => {
    return modelConfig.getCurrentModelConfig();
  });
  
  // 获取所有 Provider
  ipcMain.handle('model:get-providers', async () => {
    return modelConfig.getAllProviders();
  });
  
  // 获取单个 Provider
  ipcMain.handle('model:get-provider', async (event, providerId) => {
    return modelConfig.getProvider(providerId);
  });
  
  // ==================== 更新配置 ====================
  
  // 更新 Provider 配置（base_url, api_key, model）
  ipcMain.handle('model:update-provider', async (event, providerId, config) => {
    modelConfig.updateProvider(providerId, config);
    return { success: true, provider: modelConfig.getProvider(providerId) };
  });
  
  // 切换 Provider
  ipcMain.handle('model:switch-provider', async (event, providerId, modelName) => {
    // 更新 Provider
    modelConfig.config.model.provider = providerId;
    
    // 更新模型名称
    if (modelName) {
      modelConfig.config.model.default = modelName;
      if (modelConfig.config.providers[providerId]) {
        modelConfig.config.providers[providerId].model = modelName;
      }
    }
    
    modelConfig.save();
    return { success: true, config: modelConfig.getConfig() };
  });
  
  // 设置模型名称
  ipcMain.handle('model:set-model', async (event, modelName) => {
    modelConfig.setModel(modelName);
    return { success: true, config: modelConfig.getConfig() };
  });
  
  // 更新模型参数
  ipcMain.handle('model:update-settings', async (event, settings) => {
    Object.assign(modelConfig.config.model, settings);
    modelConfig.save();
    return { success: true };
  });
  
  // ==================== 导入导出 ====================
  
  // 导出为 Hermes 格式
  ipcMain.handle('model:export-hermes', async () => {
    return modelConfig.exportToHermesFormat();
  });
  
  // 从 Hermes 格式导入
  ipcMain.handle('model:import-hermes', async (event, data) => {
    modelConfig.importFromHermesFormat(data);
    return { success: true };
  });
  
  // 导出配置（云端同步）
  ipcMain.handle('model:export', async () => {
    return modelConfig.exportForSync();
  });
  
  // 同步到云端
  ipcMain.handle('model:sync-to-cloud', async () => {
    // TODO: 调用云端 API 同步
    const data = modelConfig.exportForSync();
    console.log('[ModelConfig] 同步到云端:', data);
    return { success: true, data };
  });
  
  // 从云端同步
  ipcMain.handle('model:sync-from-cloud', async () => {
    // TODO: 从云端拉取配置
    console.log('[ModelConfig] 从云端同步');
    return { success: true };
  });
  
  // 重置配置
  ipcMain.handle('model:reset', async () => {
    modelConfig.reset();
    return { success: true };
  });
  
  console.log('[ModelConfig] IPC 处理已注册');
}

module.exports = {
  registerModelConfigHandlers,
  modelConfig,
};