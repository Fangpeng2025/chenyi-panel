/**
 * 晨翼Agent 内核 - 类型定义
 */

import { EventEmitter } from 'eventemitter3';

// ==================== 消息类型 ====================

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatCompletionChoice {
  index: number;
  message: Message;
  finishReason: string;
}

export interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

// ==================== Provider 类型 ====================

export interface ProviderConfig {
  name: string;
  baseURL: string;
  apiKey: string;
  models?: ModelConfig[];
  defaultModel?: string;
  timeout?: number;
  maxRetries?: number;
}

export interface ModelConfig {
  id: string;
  name: string;
  contextWindow: number;
  maxTokens: number;
  supportsVision?: boolean;
  supportsTools?: boolean;
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  stop?: string[];
  tools?: ToolDefinition[];
  stream?: boolean;
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
}

// ==================== 工具类型 ====================

export interface Tool {
  name: string;
  description: string;
  parameters: JSONSchema;
  execute: (params: Record<string, any>) => Promise<ToolResult>;
}

export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
}

export interface JSONSchema {
  type: string;
  properties?: Record<string, any>;
  required?: string[];
  [key: string]: any;
}

// ==================== Skills 类型 ====================

export interface Skill {
  id: string;
  name: string;
  description: string;
  version: string;
  content: string;
  tools?: string[];
  scripts?: SkillScript[];
  triggers?: SkillTrigger[];
}

export interface SkillScript {
  name: string;
  path: string;
  description?: string;
}

export interface SkillTrigger {
  type: 'description' | 'keyword' | 'regex';
  pattern: string;
}

export interface SkillContext {
  skill: Skill;
  messages: Message[];
  tools: Map<string, Tool>;
  provider: ProviderConfig;
}

// ==================== 记忆类型 ====================

export interface MemoryEntry {
  id: string;
  type: 'long_term' | 'daily' | 'conversation';
  content: string;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface DailyNote extends MemoryEntry {
  type: 'daily';
  date: string; // YYYY-MM-DD
  tasks?: TaskItem[];
  summary?: string;
}

export interface TaskItem {
  content: string;
  completed: boolean;
}

// ==================== 上下文类型 ====================

export interface ContextConfig {
  maxTokens: number;
  systemPrompt: string;
  compressionThreshold: number;
  compressionRatio: number;
}

export interface ContextState {
  messages: Message[];
  tokenCount: number;
  systemPrompt: string;
  memoryInjected: boolean;
}

// ==================== Agent 类型 ====================

export interface AgentConfig {
  provider: ProviderConfig;
  model?: string;
  context: ContextConfig;
  tools: Tool[];
  skills: Skill[];
  memory: MemoryConfig;
}

export interface MemoryConfig {
  persistPath?: string;
  maxDailyNotes: number;
  enableVectorSearch: boolean;
}

export interface AgentState {
  id: string;
  status: 'idle' | 'thinking' | 'executing' | 'error';
  currentTask?: string;
  lastActivity: Date;
  messageCount: number;
  tokenUsage: {
    prompt: number;
    completion: number;
    total: number;
  };
}

// ==================== 事件类型 ====================

export interface AgentEvents {
  'state:change': (state: AgentState) => void;
  'message:user': (message: Message) => void;
  'message:assistant': (message: Message) => void;
  'tool:call': (toolCall: ToolCall) => void;
  'tool:result': (result: ToolResult) => void;
  'skill:trigger': (skill: Skill) => void;
  'error': (error: Error) => void;
}

export type AgentEventType = keyof AgentEvents;

// ==================== 同步类型 ====================

export interface SyncConfig {
  cloudUrl: string;
  deviceId: string;
  syncInterval: number;
}

export interface SyncState {
  lastSync: Date;
  pending: SyncItem[];
  conflicts: ConflictItem[];
}

export interface SyncItem {
  type: 'skill' | 'memory' | 'config' | 'file';
  action: 'create' | 'update' | 'delete';
  path: string;
  hash: string;
  timestamp: Date;
}

export interface ConflictItem {
  local: SyncItem;
  remote: SyncItem;
  resolution?: 'local' | 'remote' | 'merge';
}

// ==================== 日志类型 ====================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: Date;
  context?: Record<string, any>;
}
