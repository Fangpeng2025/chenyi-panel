/**
 * 晨翼Agent - 手机控制模块
 * 通过WebSocket连接并控制Android手机
 */

const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');

// 配置
const CONFIG = {
  phoneIp: '192.168.0.102',
  phonePort: 8765,
  connectionTimeout: 5000,
  commandTimeout: 10000,
  stateFile: path.join(process.env.HOME, '.hermes', 'scripts', '.phone_connection_state')
};

class PhoneController extends EventEmitter {
  constructor() {
    super();
    this.ws = null;
    this.connected = false;
    this.deviceInfo = null;
    this.requestId = 0;
    this.pendingRequests = new Map();
    this.reconnectTimer = null;
  }

  /**
   * 连接到手机
   */
  async connect(ip = CONFIG.phoneIp, port = CONFIG.phonePort) {
    if (this.connected && this.ws) {
      return { success: true, device: this.deviceInfo };
    }

    return new Promise((resolve, reject) => {
      try {
        const url = `ws://${ip}:${port}`;
        console.log(`[PhoneController] 正在连接 ${url}...`);
        
        this.ws = new WebSocket(url);

        const timeout = setTimeout(() => {
          this.ws.close();
          reject(new Error('连接超时'));
        }, CONFIG.connectionTimeout);

        this.ws.on('open', async () => {
          clearTimeout(timeout);
          console.log('[PhoneController] WebSocket已连接');
          
          try {
            const result = await this.sendCommand('get_device_info');
            
            if (result.success) {
              this.deviceInfo = {
                ...result.data,
                ip,
                port,
                connectedAt: new Date().toISOString()
              };
              this.connected = true;
              this.saveState();
              this.emit('connected', this.deviceInfo);
              console.log(`[PhoneController] 已连接: ${this.deviceInfo.model}`);
              resolve({ success: true, device: this.deviceInfo });
            } else {
              this.ws.close();
              reject(new Error('获取设备信息失败'));
            }
          } catch (err) {
            this.ws.close();
            reject(err);
          }
        });

        this.ws.on('message', (data) => this.handleMessage(data));
        this.ws.on('close', () => this.handleClose());
        this.ws.on('error', (err) => {
          clearTimeout(timeout);
          this.emit('error', err);
          reject(err);
        });

      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * 断开连接
   */
  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.connected = false;
    this.deviceInfo = null;
    // 正确清理所有超时定时器
    this.pendingRequests.forEach(({ timeout }) => clearTimeout(timeout));
    this.pendingRequests.clear();
    this.saveState();
    this.emit('disconnected');
    console.log('[PhoneController] 已断开连接');
  }

  /**
   * 处理收到的消息
   */
  handleMessage(data) {
    try {
      const resp = JSON.parse(data.toString());
      const { id, success, data: result, error } = resp;
      
      if (id && this.pendingRequests.has(id)) {
        const { resolve, reject, timeout } = this.pendingRequests.get(id);
        clearTimeout(timeout);
        this.pendingRequests.delete(id);
        
        if (success) {
          resolve({ success: true, data: result });
        } else {
          reject(new Error(error || 'Unknown error'));
        }
      }
    } catch (err) {
      console.error('[PhoneController] 解析消息失败:', err);
    }
  }

  /**
   * 处理连接关闭
   */
  handleClose() {
    const wasConnected = this.connected;
    this.connected = false;
    
    // 正确清理所有超时定时器
    this.pendingRequests.forEach(({ timeout }) => clearTimeout(timeout));
    this.pendingRequests.clear();

    if (wasConnected) {
      this.emit('disconnected');
      console.log('[PhoneController] 连接已关闭');
    }
  }

  /**
   * 发送命令
   */
  sendCommand(command, params = {}) {
    return new Promise((resolve, reject) => {
      // 只检查ws是否存在，不检查connected状态（连接过程中也需要发送命令）
      if (!this.ws) {
        reject(new Error('未连接到手机'));
        return;
      }

      const id = `req_${++this.requestId}`;
      const request = { id, command, params };

      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error('命令超时'));
      }, CONFIG.commandTimeout);

      this.pendingRequests.set(id, { resolve, reject, timeout });
      this.ws.send(JSON.stringify(request));
    });
  }

  /**
   * 点击屏幕
   */
  async tap(x, y) {
    return this.sendCommand('tap', { x, y });
  }

  /**
   * 滑动屏幕
   */
  async swipe(x1, y1, x2, y2, duration = 300) {
    return this.sendCommand('swipe', { x1, y1, x2, y2, duration });
  }

  /**
   * 输入文本
   */
  async inputText(text) {
    return this.sendCommand('input_text', { text });
  }

  /**
   * 截图
   */
  async screenshot() {
    return this.sendCommand('screenshot');
  }

  /**
   * 获取UI层次
   */
  async dumpUi() {
    return this.sendCommand('dump_ui');
  }

  /**
   * 按键操作
   */
  async pressKey(key) {
    return this.sendCommand('press_key', { key });
  }

  /**
   * 音量加
   */
  async volumeUp() {
    return this.sendCommand('press_key', { key: 'VOLUME_UP' });
  }

  /**
   * 音量减
   */
  async volumeDown() {
    return this.sendCommand('press_key', { key: 'VOLUME_DOWN' });
  }

  /**
   * 静音
   */
  async muteVolume() {
    return this.sendCommand('press_key', { key: 'VOLUME_MUTE' });
  }

  /**
   * 获取设备信息
   */
  async getDeviceInfo() {
    if (this.connected && this.deviceInfo) {
      return { success: true, data: this.deviceInfo };
    }
    return this.sendCommand('get_device_info');
  }

  /**
   * 获取设备状态
   */
  async getStatus() {
    return this.sendCommand('get_status');
  }

  /**
   * 保存连接状态
   */
  saveState() {
    try {
      const state = {
        connected: this.connected,
        device: this.deviceInfo,
        ip: CONFIG.phoneIp,
        port: CONFIG.phonePort,
        lastUpdate: new Date().toISOString()
      };
      fs.writeFileSync(CONFIG.stateFile, JSON.stringify(state, null, 2));
    } catch (err) {
      console.error('[PhoneController] 保存状态失败:', err);
    }
  }

  /**
   * 加载保存的状态
   */
  loadState() {
    try {
      if (fs.existsSync(CONFIG.stateFile)) {
        const state = JSON.parse(fs.readFileSync(CONFIG.stateFile, 'utf-8'));
        return state;
      }
    } catch (err) {
      console.error('[PhoneController] 加载状态失败:', err);
    }
    return null;
  }
}

// 导出单例
module.exports = new PhoneController();
