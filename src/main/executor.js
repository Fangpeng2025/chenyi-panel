/**
 * 晨翼Agent - 指令执行器
 * 负责执行云端下发的控制指令
 */

const EventEmitter = require('events');
const { exec } = require('child_process');
const { desktopCapturer } = require('electron');

class Executor extends EventEmitter {
  constructor() {
    super();
    this.busy = false;
  }

  /**
   * 执行控制指令
   */
  async execute(msg) {
    const { requestId, data } = msg;
    const { action, params } = data;

    try {
      let result;
      
      switch (action) {
        case 'screenshot':
          result = await this.takeScreenshot();
          break;
        
        case 'run_script':
          result = await this.runScript(params.script);
          break;
        
        case 'open_app':
          result = await this.openApp(params.appName);
          break;
        
        case 'get_status':
          result = await this.getStatus();
          break;
        
        default:
          result = { success: false, error: `未知指令: ${action}` };
      }

      this.emit('result', {
        requestId,
        success: result.success !== false,
        data: result
      });

    } catch (err) {
      this.emit('result', {
        requestId,
        success: false,
        error: err.message
      });
    }
  }

  /**
   * 执行任务
   */
  async executeTask(msg) {
    const { taskId, data } = msg;
    this.busy = true;

    try {
      const result = await this.execute(data);
      this.emit('result', {
        type: 'task_result',
        taskId,
        success: result.success !== false,
        data: result
      });
    } finally {
      this.busy = false;
    }
  }

  /**
   * 截图
   */
  async takeScreenshot() {
    const sources = await desktopCapturer.getSources({ 
      types: ['screen'],
      thumbnailSize: { width: 1920, height: 1080 }
    });
    
    if (sources.length === 0) {
      return { success: false, error: '无法获取屏幕' };
    }

    const thumbnail = sources[0].thumbnail;
    const base64 = thumbnail.toPNG().toString('base64');
    
    return { 
      success: true, 
      image: base64,
      width: thumbnail.getSize().width,
      height: thumbnail.getSize().height
    };
  }

  /**
   * 执行脚本
   */
  async runScript(script) {
    return new Promise((resolve, reject) => {
      exec(script, { timeout: 30000 }, (err, stdout, stderr) => {
        if (err) {
          resolve({ success: false, error: err.message, stderr });
        } else {
          resolve({ success: true, output: stdout });
        }
      });
    });
  }

  /**
   * 打开应用
   */
  async openApp(appName) {
    // Linux: 使用系统命令打开应用
    const cmd = process.platform === 'linux' 
      ? `which ${appName} && ${appName} &`
      : `open ${appName}`;
    
    return new Promise((resolve) => {
      exec(cmd, (err) => {
        if (err) {
          resolve({ success: false, error: `无法打开应用: ${appName}` });
        } else {
          resolve({ success: true });
        }
      });
    });
  }

  /**
   * 获取状态
   */
  async getStatus() {
    const os = require('os');
    return {
      success: true,
      status: this.busy ? 'busy' : 'idle',
      cpu: os.loadavg()[0],
      memory: {
        total: os.totalmem(),
        free: os.freemem(),
        usedPercent: ((os.totalmem() - os.freemem()) / os.totalmem() * 100).toFixed(1)
      },
      platform: os.platform(),
      hostname: os.hostname()
    };
  }
}

module.exports = Executor;