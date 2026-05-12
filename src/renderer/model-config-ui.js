/**
 * 晨翼Agent - 模型配置 UI v4.0
 * 
 * 极简设计：Provider + API Key + 模型名称
 */

// ==================== 状态 ====================
let modelState = {
  config: null,
  providers: [],
  currentProvider: null,
};

// ==================== 初始化 ====================

async function initModelConfig() {
  try {
    // 加载配置
    modelState.config = await ipcRenderer.invoke('model:get-config');
    modelState.providers = modelState.config.providers || [];
    
    // 更新 UI
    renderCurrentModel();
    renderProviderList();
    renderGlobalSettings();
    
    console.log('✓ 模型配置已加载');
  } catch (err) {
    console.error('加载模型配置失败:', err);
  }
}

// ==================== 当前模型显示 ====================

function renderCurrentModel() {
  const nameEl = document.getElementById('current-model-name');
  const providerEl = document.getElementById('current-provider-name');
  const contextEl = document.getElementById('current-context-window');
  
  if (!modelState.config?.model) return;
  
  const model = modelState.config.model;
  
  if (nameEl) nameEl.textContent = model.default || '未设置';
  if (providerEl) providerEl.textContent = `Provider: ${model.provider || '未设置'}`;
  if (contextEl) contextEl.textContent = model.context_length ? `${model.context_length} tokens` : '-';
}

// ==================== Provider 列表 ====================

function renderProviderList() {
  const container = document.getElementById('provider-list');
  if (!container) return;
  
  let html = '';
  
  for (const provider of modelState.providers) {
    const isCurrent = provider.id === modelState.config?.model?.provider;
    const hasKey = !!provider.api_key;
    
    html += `
      <div class="provider-card ${isCurrent ? 'current' : ''}" style="
        background: var(--bg-card);
        border: 1px solid ${isCurrent ? 'var(--accent)' : 'var(--border)'};
        border-radius: 8px;
        padding: 16px;
      ">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <div>
            <div style="font-weight: 600;">${provider.name}</div>
            <div style="font-size: 12px; color: var(--text-secondary);">${provider.id}</div>
          </div>
          <div style="display: flex; gap: 8px; align-items: center;">
            ${hasKey ? '<span style="color: var(--success);">✓ 已配置</span>' : '<span style="color: var(--text-secondary);">未配置</span>'}
            ${isCurrent ? '<span style="background: var(--accent); color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px;">当前</span>' : ''}
          </div>
        </div>
        
        <div style="display: grid; gap: 8px; margin-bottom: 12px;">
          <div style="display: flex; gap: 8px; align-items: center;">
            <label style="width: 80px; font-size: 13px;">Base URL:</label>
            <input type="text" id="base-url-${provider.id}" value="${provider.base_url || ''}" 
              placeholder="API URL" style="
                flex: 1;
                padding: 8px;
                background: var(--bg-tertiary);
                border: 1px solid var(--border);
                border-radius: 4px;
                color: var(--text-primary);
                font-size: 13px;
              ">
          </div>
          <div style="display: flex; gap: 8px; align-items: center;">
            <label style="width: 80px; font-size: 13px;">API Key:</label>
            <input type="password" id="api-key-${provider.id}" value="" 
              placeholder="${hasKey ? '已配置 (输入可更新)' : '输入 API Key'}" style="
                flex: 1;
                padding: 8px;
                background: var(--bg-tertiary);
                border: 1px solid var(--border);
                border-radius: 4px;
                color: var(--text-primary);
                font-size: 13px;
              ">
          </div>
          <div style="display: flex; gap: 8px; align-items: center;">
            <label style="width: 80px; font-size: 13px;">模型:</label>
            <input type="text" id="model-name-${provider.id}" value="${provider.model || ''}" 
              placeholder="模型名称 (如 glm-4)" style="
                flex: 1;
                padding: 8px;
                background: var(--bg-tertiary);
                border: 1px solid var(--border);
                border-radius: 4px;
                color: var(--text-primary);
                font-size: 13px;
              ">
          </div>
        </div>
        
        <div style="display: flex; gap: 8px;">
          <button class="btn btn-primary btn-sm" onclick="saveProvider('${provider.id}')">保存</button>
          ${hasKey && !isCurrent ? `<button class="btn btn-secondary btn-sm" onclick="switchProvider('${provider.id}')">切换到此 Provider</button>` : ''}
        </div>
      </div>
    `;
  }
  
  container.innerHTML = html;
}

// ==================== 全局设置 ====================

function renderGlobalSettings() {
  const settings = modelState.config?.model || {};
  
  const tempEl = document.getElementById('global-temperature');
  const tokensEl = document.getElementById('global-max-tokens');
  const timeoutEl = document.getElementById('global-timeout');
  
  if (tempEl) tempEl.value = settings.temperature || 0.7;
  if (tokensEl) tokensEl.value = settings.max_tokens || 4096;
  if (timeoutEl) timeoutEl.value = settings.timeout || 120;
}

async function updateGlobalSettings() {
  const temperature = parseFloat(document.getElementById('global-temperature')?.value || 0.7);
  const max_tokens = parseInt(document.getElementById('global-max-tokens')?.value || 4096);
  const timeout = parseInt(document.getElementById('global-timeout')?.value || 120);
  
  try {
    await ipcRenderer.invoke('model:update-settings', { temperature, max_tokens, timeout });
    showNotification('全局设置已更新');
  } catch (err) {
    showNotification('更新失败: ' + err.message, 'error');
  }
}

// ==================== Provider 操作 ====================

async function saveProvider(providerId) {
  const baseURL = document.getElementById(`base-url-${providerId}`)?.value.trim();
  const apiKey = document.getElementById(`api-key-${providerId}`)?.value.trim();
  const modelName = document.getElementById(`model-name-${providerId}`)?.value.trim();
  
  if (!baseURL && !apiKey && !modelName) {
    showNotification('请输入至少一项配置', 'error');
    return;
  }
  
  try {
    const result = await ipcRenderer.invoke('model:update-provider', providerId, {
      base_url: baseURL,
      api_key: apiKey,
      model: modelName,
    });
    
    if (result.success) {
      showNotification(`${providerId} 配置已保存`);
      
      // 刷新配置
      modelState.config = await ipcRenderer.invoke('model:get-config');
      modelState.providers = modelState.config.providers || [];
      renderProviderList();
      renderCurrentModel();
    } else {
      showNotification('保存失败', 'error');
    }
  } catch (err) {
    showNotification('保存失败: ' + err.message, 'error');
  }
}

async function switchProvider(providerId) {
  const modelName = document.getElementById(`model-name-${providerId}`)?.value.trim();
  
  if (!modelName) {
    showNotification('请先配置模型名称', 'error');
    return;
  }
  
  try {
    const result = await ipcRenderer.invoke('model:switch-provider', providerId, modelName);
    
    if (result.success) {
      showNotification(`已切换到 ${providerId}`);
      
      // 刷新配置
      modelState.config = await ipcRenderer.invoke('model:get-config');
      modelState.providers = modelState.config.providers || [];
      renderProviderList();
      renderCurrentModel();
      updateModelSelector();
    } else {
      showNotification('切换失败', 'error');
    }
  } catch (err) {
    showNotification('切换失败: ' + err.message, 'error');
  }
}

// ==================== 其他操作 ====================

async function resetModelConfig() {
  try {
    await ipcRenderer.invoke('model:reset');
    modelState.config = await ipcRenderer.invoke('model:get-config');
    modelState.providers = modelState.config.providers || [];
    renderProviderList();
    renderCurrentModel();
    renderGlobalSettings();
    showNotification('配置已重置');
  } catch (err) {
    showNotification('重置失败: ' + err.message, 'error');
  }
}

async function exportModelConfig() {
  try {
    const data = await ipcRenderer.invoke('model:export');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chenyi-model-config-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showNotification('配置已导出');
  } catch (err) {
    showNotification('导出失败: ' + err.message, 'error');
  }
}

async function syncModelConfig() {
  try {
    await ipcRenderer.invoke('model:sync-to-cloud');
    showNotification('配置已同步到云端');
  } catch (err) {
    showNotification('同步失败: ' + err.message, 'error');
  }
}

// ==================== 模型选择器更新 ====================

function updateModelSelector() {
  const selectEl = document.getElementById('model-select');
  if (!selectEl) return;
  
  selectEl.innerHTML = '';
  
  // 显示当前模型
  if (modelState.config?.model) {
    const option = document.createElement('option');
    option.value = modelState.config.model.default;
    option.textContent = `${modelState.config.model.default} (${modelState.config.model.provider})`;
    option.selected = true;
    selectEl.appendChild(option);
  }
  
  // 添加其他已配置的 Provider
  for (const provider of modelState.providers) {
    if (provider.id === modelState.config?.model?.provider) continue;
    if (!provider.api_key) continue;
    
    const option = document.createElement('option');
    option.value = provider.model;
    option.textContent = `${provider.model} (${provider.name})`;
    option.dataset.provider = provider.id;
    selectEl.appendChild(option);
  }
  
  // 添加配置选项
  const configOption = document.createElement('option');
  configOption.value = '__config__';
  configOption.textContent = '⚙️ 配置模型...';
  selectEl.appendChild(configOption);
}

// 模型选择器变化
async function onModelSelectChange(modelId) {
  if (modelId === '__config__') {
    switchPanel('models');
    return;
  }
  
  const selectEl = document.getElementById('model-select');
  const providerId = selectEl?.selectedOptions[0]?.dataset.provider;
  
  if (providerId) {
    try {
      await ipcRenderer.invoke('model:switch-provider', providerId, modelId);
      modelState.config = await ipcRenderer.invoke('model:get-config');
      renderCurrentModel();
      showNotification(`已切换到: ${modelId}`);
    } catch (err) {
      showNotification('切换失败: ' + err.message, 'error');
    }
  }
}