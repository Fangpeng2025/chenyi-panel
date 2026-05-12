/**
 * 晨翼Agent - 结构化日志系统
 * 
 * 提供统一的日志记录、错误追踪和性能监控
 * 支持日志级别、结构化输出和日志轮转
 */

const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

// 日志级别
const LogLevel = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  FATAL: 4
};

// 日志级别名称
const LogLevelNames = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'];

// 日志颜色（终端）
const LogColors = {
  DEBUG: '\x1b[36m',  // 青色
  INFO: '\x1b[32m',   // 绿色
  WARN: '\x1b[33m',   // 黄色
  ERROR: '\x1b[31m',  // 红色
  FATAL: '\x1b[35m',  // 紫色
  RESET: '\x1b[0m'
};

/**
 * 结构化日志记录器
 */
class Logger extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.name = options.name || 'ChenYi';
    this.level = options.level || LogLevel.INFO;
    this.console = options.console !== false;
    this.file = options.file || null;
    this.maxFileSize = options.maxFileSize || 10 * 1024 * 1024; // 10MB
    this.maxFiles = options.maxFiles || 5;
    this.jsonFormat = options.jsonFormat || false;
    
    // 性能指标
    this.metrics = {
      logsByLevel: {},
      errorsByType: {},
      slowOperations: [],
      alerts: []
    };
    
    // 告警阈值
    this.alertThresholds = {
      errorRate: options.errorRateThreshold || 0.1, // 10%错误率
      slowOperationMs: options.slowOperationThreshold || 5000, // 5秒
      maxErrorsPerMinute: options.maxErrorsPerMinute || 10
    };
    
    // 错误计数（用于告警）
    this.errorWindow = [];
    this.errorWindowSize = 60000; // 1分钟窗口
    
    // 确保日志目录存在
    if (this.file) {
      const dir = path.dirname(this.file);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }
  
  /**
   * 记录日志
   */
  log(level, message, context = {}) {
    if (level < this.level) return;
    
    const timestamp = new Date().toISOString();
    const levelName = LogLevelNames[level];
    
    const logEntry = {
      timestamp,
      level: levelName,
      logger: this.name,
      message,
      ...context
    };
    
    // 更新指标
    this.metrics.logsByLevel[levelName] = (this.metrics.logsByLevel[levelName] || 0) + 1;
    
    // 错误追踪
    if (level >= LogLevel.ERROR) {
      this._trackError(logEntry);
    }
    
    // 控制台输出
    if (this.console) {
      this._consoleOutput(logEntry);
    }
    
    // 文件输出
    if (this.file) {
      this._fileOutput(logEntry);
    }
    
    // 发出事件
    this.emit('log', logEntry);
    
    // 检查告警
    this._checkAlerts(logEntry);
  }
  
  /**
   * 控制台输出
   */
  _consoleOutput(entry) {
    const color = LogColors[entry.level] || '';
    const reset = LogColors.RESET;
    
    if (this.jsonFormat) {
      console.log(JSON.stringify(entry));
    } else {
      const contextStr = Object.keys(entry).length > 4 
        ? ' ' + JSON.stringify(this._sanitizeContext(entry))
        : '';
      console.log(`${color}[${entry.timestamp}] [${entry.level}] [${entry.logger}]${reset} ${entry.message}${contextStr}`);
    }
  }
  
  /**
   * 文件输出（带轮转）
   */
  _fileOutput(entry) {
    try {
      // 检查文件大小，必要时轮转
      if (fs.existsSync(this.file)) {
        const stats = fs.statSync(this.file);
        if (stats.size >= this.maxFileSize) {
          this._rotateLog();
        }
      }
      
      const logLine = this.jsonFormat 
        ? JSON.stringify(entry) + '\n'
        : `[${entry.timestamp}] [${entry.level}] [${entry.logger}] ${entry.message}` +
          (Object.keys(entry).length > 4 ? ' ' + JSON.stringify(this._sanitizeContext(entry)) : '') + '\n';
      
      fs.appendFileSync(this.file, logLine);
    } catch (err) {
      console.error('日志写入失败:', err.message);
    }
  }
  
  /**
   * 日志轮转
   */
  _rotateLog() {
    try {
      // 删除最旧的文件
      const oldestFile = `${this.file}.${this.maxFiles}`;
      if (fs.existsSync(oldestFile)) {
        fs.unlinkSync(oldestFile);
      }
      
      // 重命名现有文件
      for (let i = this.maxFiles - 1; i >= 1; i--) {
        const oldFile = `${this.file}.${i}`;
        const newFile = `${this.file}.${i + 1}`;
        if (fs.existsSync(oldFile)) {
          fs.renameSync(oldFile, newFile);
        }
      }
      
      // 重命名当前文件
      fs.renameSync(this.file, `${this.file}.1`);
    } catch (err) {
      console.error('日志轮转失败:', err.message);
    }
  }
  
  /**
   * 追踪错误
   */
  _trackError(entry) {
    const errorType = entry.errorType || entry.type || 'UNKNOWN';
    this.metrics.errorsByType[errorType] = (this.metrics.errorsByType[errorType] || 0) + 1;
    
    // 添加到错误窗口
    const now = Date.now();
    this.errorWindow.push({ timestamp: now, type: errorType });
    
    // 清理过期条目
    this.errorWindow = this.errorWindow.filter(e => now - e.timestamp < this.errorWindowSize);
  }
  
  /**
   * 检查告警条件
   */
  _checkAlerts(entry) {
    const now = Date.now();
    
    // 检查错误率
    const recentErrors = this.errorWindow.filter(e => now - e.timestamp < this.errorWindowSize);
    if (recentErrors.length >= this.alertThresholds.maxErrorsPerMinute) {
      const alert = {
        type: 'HIGH_ERROR_RATE',
        message: `错误率过高: ${recentErrors.length}次/分钟`,
        timestamp: now,
        details: { errorCount: recentErrors.length, threshold: this.alertThresholds.maxErrorsPerMinute }
      };
      this.metrics.alerts.push(alert);
      this.emit('alert', alert);
    }
    
    // 检查慢操作
    if (entry.duration && entry.duration >= this.alertThresholds.slowOperationMs) {
      const alert = {
        type: 'SLOW_OPERATION',
        message: `慢操作: ${entry.operation || 'unknown'} (${entry.duration}ms)`,
        timestamp: now,
        details: { operation: entry.operation, duration: entry.duration }
      };
      this.metrics.slowOperations.push(alert);
      this.emit('alert', alert);
    }
  }
  
  /**
   * 清理上下文（移除敏感信息）
   */
  _sanitizeContext(entry) {
    const sanitized = { ...entry };
    delete sanitized.timestamp;
    delete sanitized.level;
    delete sanitized.logger;
    delete sanitized.message;
    
    // 移除敏感字段
    const sensitiveFields = ['password', 'token', 'secret', 'apiKey', 'authorization'];
    for (const field of sensitiveFields) {
      if (sanitized[field]) {
        sanitized[field] = '***REDACTED***';
      }
    }
    
    return sanitized;
  }
  
  // ==================== 便捷方法 ====================
  
  debug(message, context = {}) {
    this.log(LogLevel.DEBUG, message, context);
  }
  
  info(message, context = {}) {
    this.log(LogLevel.INFO, message, context);
  }
  
  warn(message, context = {}) {
    this.log(LogLevel.WARN, message, context);
  }
  
  error(message, context = {}) {
    this.log(LogLevel.ERROR, message, context);
  }
  
  fatal(message, context = {}) {
    this.log(LogLevel.FATAL, message, context);
  }
  
  // ==================== 性能追踪 ====================
  
  /**
   * 开始性能追踪
   */
  startTrace(operation, context = {}) {
    const traceId = `${operation}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();
    
    return {
      traceId,
      operation,
      startTime,
      context,
      end: (additionalContext = {}) => {
        const duration = Date.now() - startTime;
        const fullContext = { ...context, ...additionalContext, duration, operation, traceId };
        
        if (duration >= this.alertThresholds.slowOperationMs) {
          this.warn(`慢操作完成: ${operation}`, fullContext);
        } else {
          this.debug(`操作完成: ${operation}`, fullContext);
        }
        
        return duration;
      }
    };
  }
  
  // ==================== 指标和报告 ====================
  
  /**
   * 获取指标
   */
  getMetrics() {
    return {
      ...this.metrics,
      errorWindow: this.errorWindow.length,
      alertCount: this.metrics.alerts.length,
      slowOperationCount: this.metrics.slowOperations.length
    };
  }
  
  /**
   * 重置指标
   */
  resetMetrics() {
    this.metrics = {
      logsByLevel: {},
      errorsByType: {},
      slowOperations: [],
      alerts: []
    };
    this.errorWindow = [];
  }
  
  /**
   * 生成报告
   */
  generateReport() {
    const metrics = this.getMetrics();
    const totalLogs = Object.values(metrics.logsByLevel).reduce((a, b) => a + b, 0);
    const totalErrors = Object.values(metrics.errorsByType).reduce((a, b) => a + b, 0);
    
    return {
      summary: {
        totalLogs,
        totalErrors,
        errorRate: totalLogs > 0 ? (totalErrors / totalLogs * 100).toFixed(2) + '%' : '0%',
        alertCount: metrics.alertCount,
        slowOperationCount: metrics.slowOperationCount
      },
      logsByLevel: metrics.logsByLevel,
      errorsByType: metrics.errorsByType,
      recentAlerts: metrics.alerts.slice(-10),
      recentSlowOperations: metrics.slowOperations.slice(-10)
    };
  }
}

// 创建默认日志记录器
const defaultLogger = new Logger({
  name: 'ChenYi',
  level: process.env.LOG_LEVEL ? LogLevel[process.env.LOG_LEVEL] : LogLevel.INFO,
  file: process.env.LOG_FILE || null
});

// 导出日志记录器和工厂函数
module.exports = {
  Logger,
  LogLevel,
  defaultLogger,
  createLogger: (options) => new Logger(options)
};
