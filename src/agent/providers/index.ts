/**
 * 晨翼Agent 内核 - Provider 导出
 */

export { BaseProvider } from './BaseProvider';
export { MiniMaxProvider } from './MiniMaxProvider';
export { OneAPIProvider } from './OneAPIProvider';

export type { ProviderConfig, ModelConfig } from '../types';

import { BaseProvider } from './BaseProvider';
import { MiniMaxProvider } from './MiniMaxProvider';
import { OneAPIProvider } from './OneAPIProvider';
import type { ProviderConfig } from '../types';

/**
 * 创建 Provider 实例
 */
export function createProvider(config: ProviderConfig): BaseProvider {
  const name = config.name.toLowerCase();

  if (name.includes('minimax')) {
    return new MiniMaxProvider(config);
  }

  if (name.includes('oneapi') || name.includes('xintiandi')) {
    return new OneAPIProvider(config);
  }

  // 默认使用 OneAPI 兼容
  return new OneAPIProvider(config);
}
