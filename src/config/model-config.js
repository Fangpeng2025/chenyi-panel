/**
 * 晨翼Agent - 模型配置系统 v3.0
 * 
 * 参考 Hermes 配置方式，极简设计：
 * - 一个 Provider = 一个 API 端点
 * - 配置 base_url + api_key + model
 * - 直接使用，无需发现
 */

const fs = require('fs');
const path = require('path');

// ==================== 默认配置 ====================

const DEFAULT_CONFIG = {
  // 当前使用的模型
  model: {
    default: 'glm-5',
    provider: 'oneapi',
    context_length: 200000,
    max_tokens: 16384,
    temperature: 0.7,
  },
  
  // Provider 列表（每个 Provider 就是一个 API 端点）
  providers: {
    oneapi: {
      name: 'OneAPI',
      base_url: 'https://www.xintiandi.online/v1',
      api_key: '',
      model: 'glm-5',
      enabled: true,
    },
    minimax: {
      name: 'MiniMax',
      base_url: 'https://api.minimax.chat/v1',
      api_key: '',
      model: 'MiniMax-M2.7',
      enabled: false,
    },
    openai: {
      name: 'OpenAI',
      base_url: 'https://api.openai.com/v1',
      api_key: '',
      model: 'gpt-4o-mini',
      enabled: false,
    },
    deepseek: {
      name: 'DeepSeek',
      base_url: 'https://api.deepseek.com/v1',
      api_key: '',
      model: 'deepseek-chat',
      enabled: false,
    },
    custom: {
      name: '自定义',
      base_url: '',
      api_key: '',
      model: '',
      enabled: false,
    },
  },
};

// ==================== 配置管理器 ====================

class ModelConfigManager {
  constructor(configPath = null) {
    this.configPath = configPath || path.join(process.cwd(), 'config', 'model-config.json');
    this.config = null;
    
    this.load();
  }
  
  /**
   * 加载配置
   */
  load() {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = JSON.parse(fs.readFileSync(this.configPath, 'utf-8'));
        this.config = this.mergeDeep(DEFAULT_CONFIG, data);
        console.log('[ModelConfig] 配置已加载');
      } else {
        this.config = { ...DEFAULT_CONFIG };
        this.save();
      }
    } catch (err) {
      console.error('[ModelConfig] 加载失败:', err);
      this.config = { ...DEFAULT_CONFIG };
    }
  }
  
  /**
   * 深度合并
   */
  mergeDeep(target, source) {
    const result = { ...target };
    for (const key in source) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this.mergeDeep(target[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }
    return result;
  }
  
  /**
   * 保存配置
   */
  save() {
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
      console.log('[ModelConfig] 配置已保存');
    } catch (err) {
      console.error('[ModelConfig] 保存失败:', err);
    }
  }
  
  /**
   * 获取当前模型配置（用于 LLM 调用）
   */
  getCurrentModelConfig() {
    const providerId = this.config.model.provider;
    const provider = this.config.providers[providerId];
    
    if (!provider || !provider.api_key) {
      return null;
    }
    
    return {
      model: this.config.model.default,
      provider: providerId,
      baseURL: provider.base_url,
      apiKey: provider.api_key,
      contextLength: this.config.model.context_length,
      maxTokens: this.config.model.max_tokens,
      temperature: this.config.model.temperature,
    };
  }
  
  /**
   * 获取所有 Provider
   */
  getAllProviders() {
    return Object.entries(this.config.providers).map(([id, p]) => ({
      id,
      ...p,
      configured: !!p.api_key,
      current: id === this.config.model.provider,
    }));
  }
  
  /**
   * 获取 Provider
   */
  getProvider(providerId) {
    const provider = this.config.providers[providerId];
    if (!provider) return null;
    
    return {
      id: providerId,
      ...provider,
      configured: !!provider.api_key,
      current: providerId === this.config.model.provider,
    };
  }
  
  /**
   * 更新 Provider 配置
   */
  updateProvider(providerId, updates) {
    if (!this.config.providers[providerId]) {
      this.config.providers[providerId] = {
        name: providerId,
        base_url: '',
        api_key: '',
        model: '',
        enabled: false,
      };
    }
    
    // 更新配置
    Object.assign(this.config.providers[providerId], updates);
    
    // 如果设置了 api_key，自动启用
    if (updates.api_key) {
      this.config.providers[providerId].enabled = true;
    }
    
    this.save();
  }
  
  /**
   * 切换到指定 Provider
   */
  switchProvider(providerId) {
    const provider = this.config.providers[providerId];
    if (!provider) return false;
    
    this.config.model.provider = providerId;
    this.config.model.default = provider.model;
    
    this.save();
    return true;
  }
  
  /**
   * 设置当前模型
   */
  setModel(modelName) {
    this.config.model.default = modelName;
    
    // 同时更新 Provider 的默认模型
    const providerId = this.config.model.provider;
    if (this.config.providers[providerId]) {
      this.config.providers[providerId].model = modelName;
    }
    
    this.save();
  }
  
  /**
   * 获取配置（用于 UI 显示）
   */
  getConfig() {
    return {
      model: this.config.model,
      providers: this.getAllProviders(),
      currentProvider: this.getProvider(this.config.model.provider),
    };
  }
  
  /**
   * 导出为 Hermes 格式
   */
  exportToHermesFormat() {
    const provider = this.getProvider(this.config.model.provider);
    
    return {
      model: {
        default: this.config.model.default,
        provider: `custom:${this.config.model.provider}`,
        context_length: this.config.model.context_length,
        max_tokens: this.config.model.max_tokens,
      },
      custom_providers: [
        {
          name: this.config.model.provider,
          base_url: provider?.base_url || '',
          api_key: provider?.api_key || '',
          model: this.config.model.default,
        },
      ],
    };
  }
  
  /**
   * 从 Hermes 格式导入
   */
  importFromHermesFormat(data) {
    if (data.model) {
      if (data.model.default) this.config.model.default = data.model.default;
      if (data.model.context_length) this.config.model.context_length = data.model.context_length;
      if (data.model.max_tokens) this.config.model.max_tokens = data.model.max_tokens;
      
      // 解析 provider
      if (data.model.provider?.startsWith('custom:')) {
        this.config.model.provider = data.model.provider.replace('custom:', '');
      }
    }
    
    if (data.custom_providers && data.custom_providers.length > 0) {
      for (const cp of data.custom_providers) {
        if (cp.name) {
          this.config.providers[cp.name] = {
            name: cp.name,
            base_url: cp.base_url || '',
            api_key: cp.api_key || '',
            model: cp.model || '',
            enabled: !!cp.api_key,
          };
        }
      }
    }
    
    this.save();
  }
  
  /**
   * 导出配置（云端同步）
   */
  exportForSync() {
    return {
      model: this.config.model,
      providers: Object.fromEntries(
        Object.entries(this.config.providers).map(([id, p]) => [
          id,
          {
            name: p.name,
            base_url: p.base_url,
            has_api_key: !!p.api_key,
            model: p.model,
            enabled: p.enabled,
            local: p.local,
          },
        ])
      ),
    };
  }
  
  /**
   * 重置配置
   */
  reset() {
    this.config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    this.save();
  }
}

module.exports = {
  ModelConfigManager,
  DEFAULT_CONFIG,
};