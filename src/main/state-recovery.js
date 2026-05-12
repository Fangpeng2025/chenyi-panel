/**
 * 晨翼Agent - 状态恢复管理器
 * 
 * 处理断线重连后的状态恢复，确保数据一致性
 * 支持会话状态、消息队列、操作重放
 */

const EventEmitter = require('events');

// 状态类型
const StateType = {
  SESSION: 'SESSION',
  MESSAGES: 'MESSAGES',
  PENDING_OPERATIONS: 'PENDING_OPERATIONS',
  USER_CONTEXT: 'USER_CONTEXT'
};

// 恢复策略
const RecoveryStrategy = {
  RETRY: 'RETRY',           // 重试操作
  SKIP: 'SKIP',             // 跳过操作
  COMPENSATE: 'COMPENSATE', // 补偿操作
  ROLLBACK: 'ROLLBACK'      // 回滚操作
};

/**
 * 状态恢复管理器
 */
class StateRecoveryManager extends EventEmitter {
  constructor(options = {}) {
    super();
    
    // 状态存储
    this.states = new Map();
    
    // 待处理操作队列
    this.pendingOperations = [];
    
    // 操作历史（用于重放）
    this.operationHistory = [];
    this.maxHistorySize = options.maxHistorySize || 100;
    
    // 恢复配置
    this.maxRecoveryAttempts = options.maxRecoveryAttempts || 3;
    this.recoveryDelay = options.recoveryDelay || 1000;
    
    // 检查点
    this.checkpoints = new Map();
    this.checkpointInterval = options.checkpointInterval || 60000; // 1分钟
    this.checkpointTimer = null;
    
    // 统计
    this.stats = {
      recoveries: 0,
      successfulRecoveries: 0,
      failedRecoveries: 0,
      operationsRecovered: 0,
      operationsLost: 0
    };
  }
  
  /**
   * 初始化状态管理
   */
  initialize() {
    // 启动定期检查点
    this.checkpointTimer = setInterval(() => {
      this.createCheckpoint('auto');
    }, this.checkpointInterval);
    
    console.log('[状态恢复] 管理器已初始化');
  }
  
  /**
   * 保存状态
   */
  saveState(type, key, state, options = {}) {
    const stateEntry = {
      type,
      key,
      state,
      timestamp: Date.now(),
      version: options.version || 1,
      metadata: options.metadata || {}
    };
    
    const stateKey = `${type}:${key}`;
    this.states.set(stateKey, stateEntry);
    
    // 记录操作
    this._recordOperation('SAVE_STATE', { type, key, stateKey });
    
    this.emit('state:saved', { type, key, timestamp: stateEntry.timestamp });
    
    return stateEntry;
  }
  
  /**
   * 获取状态
   */
  getState(type, key) {
    const stateKey = `${type}:${key}`;
    return this.states.get(stateKey);
  }
  
  /**
   * 删除状态
   */
  deleteState(type, key) {
    const stateKey = `${type}:${key}`;
    const existed = this.states.delete(stateKey);
    
    if (existed) {
      this._recordOperation('DELETE_STATE', { type, key, stateKey });
      this.emit('state:deleted', { type, key });
    }
    
    return existed;
  }
  
  /**
   * 添加待处理操作
   */
  addPendingOperation(operation) {
    const op = {
      id: `op-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      operation: operation.operation,
      params: operation.params,
      timestamp: Date.now(),
      attempts: 0,
      maxAttempts: operation.maxAttempts || this.maxRecoveryAttempts,
      strategy: operation.strategy || RecoveryStrategy.RETRY,
      compensate: operation.compensate || null, // 补偿函数
      state: 'PENDING'
    };
    
    this.pendingOperations.push(op);
    this._recordOperation('ADD_PENDING', { operationId: op.id, operation: op.operation });
    
    this.emit('operation:pending', op);
    
    return op.id;
  }
  
  /**
   * 完成操作
   */
  completeOperation(operationId) {
    const index = this.pendingOperations.findIndex(op => op.id === operationId);
    if (index !== -1) {
      const op = this.pendingOperations.splice(index, 1)[0];
      op.state = 'COMPLETED';
      op.completedAt = Date.now();
      
      this._recordOperation('COMPLETE_OPERATION', { operationId, operation: op.operation });
      this.emit('operation:completed', op);
      
      return true;
    }
    return false;
  }
  
  /**
   * 创建检查点
   */
  createCheckpoint(name = 'manual') {
    const checkpoint = {
      id: `cp-${Date.now()}`,
      name,
      timestamp: Date.now(),
      states: new Map(this.states),
      pendingOperations: [...this.pendingOperations],
      stats: { ...this.stats }
    };
    
    this.checkpoints.set(checkpoint.id, checkpoint);
    
    // 限制检查点数量
    if (this.checkpoints.size > 10) {
      const oldest = [...this.checkpoints.entries()]
        .sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
      this.checkpoints.delete(oldest[0]);
    }
    
    this.emit('checkpoint:created', checkpoint);
    
    return checkpoint.id;
  }
  
  /**
   * 恢复到检查点
   */
  restoreCheckpoint(checkpointId) {
    const checkpoint = this.checkpoints.get(checkpointId);
    if (!checkpoint) {
      throw new Error(`检查点不存在: ${checkpointId}`);
    }
    
    console.log(`[状态恢复] 恢复到检查点: ${checkpoint.name} (${new Date(checkpoint.timestamp).toISOString()})`);
    
    // 恢复状态
    this.states = new Map(checkpoint.states);
    
    // 恢复待处理操作
    this.pendingOperations = [...checkpoint.pendingOperations];
    
    this.emit('checkpoint:restored', checkpoint);
    
    return true;
  }
  
  /**
   * 执行恢复（断线重连后调用）
   */
  async performRecovery(context = {}) {
    console.log('[状态恢复] 开始执行恢复...');
    this.stats.recoveries++;
    
    const recoveryResult = {
      success: true,
      recoveredStates: 0,
      recoveredOperations: 0,
      failedOperations: 0,
      errors: []
    };
    
    try {
      // 1. 验证当前状态一致性
      const consistencyCheck = await this._checkConsistency(context);
      if (!consistencyCheck.consistent) {
        console.warn('[状态恢复] 检测到状态不一致:', consistencyCheck.issues);
        recoveryResult.consistencyIssues = consistencyCheck.issues;
      }
      
      // 2. 恢复会话状态
      const sessionStates = this._getStatesByType(StateType.SESSION);
      for (const [key, state] of sessionStates) {
        try {
          await this._recoverSessionState(state, context);
          recoveryResult.recoveredStates++;
        } catch (err) {
          recoveryResult.errors.push({
            type: 'SESSION_RECOVERY_FAILED',
            key,
            error: err.message
          });
        }
      }
      
      // 3. 重放待处理操作
      const operationsToRecover = [...this.pendingOperations];
      this.pendingOperations = []; // 清空，失败的会重新添加
      
      for (const op of operationsToRecover) {
        try {
          const recovered = await this._recoverOperation(op, context);
          if (recovered) {
            recoveryResult.recoveredOperations++;
            this.stats.operationsRecovered++;
          } else {
            recoveryResult.failedOperations++;
            this.stats.operationsLost++;
          }
        } catch (err) {
          recoveryResult.errors.push({
            type: 'OPERATION_RECOVERY_FAILED',
            operationId: op.id,
            operation: op.operation,
            error: err.message
          });
          recoveryResult.failedOperations++;
        }
      }
      
      // 4. 验证恢复结果
      if (recoveryResult.failedOperations > 0) {
        recoveryResult.success = false;
        this.stats.failedRecoveries++;
      } else {
        this.stats.successfulRecoveries++;
      }
      
      console.log(`[状态恢复] 恢复完成: ${recoveryResult.recoveredStates}个状态, ${recoveryResult.recoveredOperations}个操作`);
      
      this.emit('recovery:complete', recoveryResult);
      
      return recoveryResult;
    } catch (err) {
      console.error('[状态恢复] 恢复失败:', err.message);
      this.stats.failedRecoveries++;
      
      recoveryResult.success = false;
      recoveryResult.errors.push({
        type: 'RECOVERY_FAILED',
        error: err.message
      });
      
      this.emit('recovery:failed', recoveryResult);
      
      return recoveryResult;
    }
  }
  
  /**
   * 检查状态一致性
   */
  async _checkConsistency(context) {
    const issues = [];
    
    // 检查会话状态
    const sessionStates = this._getStatesByType(StateType.SESSION);
    for (const [key, state] of sessionStates) {
      // 如果有kernel客户端，验证会话是否存在
      if (context.kernelClient && state.state.sessionId) {
        try {
          const session = await context.kernelClient.getSession(state.state.sessionId);
          if (!session || !session.session_id) {
            issues.push({
              type: 'SESSION_NOT_FOUND',
              key,
              sessionId: state.state.sessionId
            });
          }
        } catch (err) {
          issues.push({
            type: 'SESSION_CHECK_FAILED',
            key,
            error: err.message
          });
        }
      }
    }
    
    return {
      consistent: issues.length === 0,
      issues
    };
  }
  
  /**
   * 恢复会话状态
   */
  async _recoverSessionState(stateEntry, context) {
    const { state, key } = stateEntry;
    
    // 如果有kernel客户端，尝试重新创建会话
    if (context.kernelClient && state.sessionId) {
      try {
        // 尝试获取现有会话
        const existingSession = await context.kernelClient.getSession(state.sessionId);
        if (existingSession && existingSession.session_id) {
          console.log(`[状态恢复] 会话已存在: ${state.sessionId}`);
          return true;
        }
      } catch (err) {
        // 会话不存在，创建新会话
        console.log(`[状态恢复] 会话不存在，创建新会话...`);
        const newSession = await context.kernelClient.createSession();
        
        // 更新状态
        this.saveState(StateType.SESSION, key, {
          ...state,
          sessionId: newSession.session_id,
          previousSessionId: state.sessionId,
          recoveredAt: Date.now()
        });
        
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * 恢复操作
   */
  async _recoverOperation(op, context) {
    op.attempts++;
    
    console.log(`[状态恢复] 恢复操作: ${op.operation} (尝试 ${op.attempts}/${op.maxAttempts})`);
    
    // 检查是否超过最大尝试次数
    if (op.attempts > op.maxAttempts) {
      console.warn(`[状态恢复] 操作超过最大尝试次数: ${op.id}`);
      
      // 执行补偿操作
      if (op.strategy === RecoveryStrategy.COMPENSATE && op.compensate) {
        try {
          await op.compensate(op.params);
          console.log(`[状态恢复] 补偿操作成功: ${op.id}`);
        } catch (err) {
          console.error(`[状态恢复] 补偿操作失败: ${op.id}`, err.message);
        }
      }
      
      this.emit('operation:failed', op);
      return false;
    }
    
    // 根据策略处理
    switch (op.strategy) {
      case RecoveryStrategy.RETRY:
        // 重新添加到待处理队列
        this.pendingOperations.push(op);
        this.emit('operation:retry', op);
        return true;
        
      case RecoveryStrategy.SKIP:
        console.log(`[状态恢复] 跳过操作: ${op.id}`);
        this.emit('operation:skipped', op);
        return true;
        
      case RecoveryStrategy.ROLLBACK:
        // 回滚到上一个检查点
        const checkpoints = [...this.checkpoints.values()]
          .filter(cp => cp.timestamp < op.timestamp)
          .sort((a, b) => b.timestamp - a.timestamp);
        
        if (checkpoints.length > 0) {
          this.restoreCheckpoint(checkpoints[0].id);
          return true;
        }
        return false;
        
      default:
        return false;
    }
  }
  
  /**
   * 记录操作
   */
  _recordOperation(type, details) {
    this.operationHistory.push({
      type,
      details,
      timestamp: Date.now()
    });
    
    // 限制历史大小
    if (this.operationHistory.length > this.maxHistorySize) {
      this.operationHistory.shift();
    }
  }
  
  /**
   * 获取指定类型的状态
   */
  _getStatesByType(type) {
    const result = [];
    for (const [key, value] of this.states) {
      if (value.type === type) {
        result.push([key, value]);
      }
    }
    return result;
  }
  
  /**
   * 获取统计信息
   */
  getStats() {
    return {
      ...this.stats,
      stateCount: this.states.size,
      pendingOperationCount: this.pendingOperations.length,
      checkpointCount: this.checkpoints.size,
      historySize: this.operationHistory.length
    };
  }
  
  /**
   * 清理资源
   */
  cleanup() {
    if (this.checkpointTimer) {
      clearInterval(this.checkpointTimer);
      this.checkpointTimer = null;
    }
    
    this.states.clear();
    this.pendingOperations = [];
    this.checkpoints.clear();
    this.operationHistory = [];
    
    console.log('[状态恢复] 管理器已清理');
  }
}

module.exports = {
  StateRecoveryManager,
  StateType,
  RecoveryStrategy
};
