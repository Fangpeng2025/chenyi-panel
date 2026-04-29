/**
 * 晨翼Agent - 渲染进程
 * 负责UI交互、IPC通信
 */

const { ipcRenderer } = require('electron');

// 状态
let isConnected = false;
let currentUser = null;
let devices = [];
let messages = [];

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  initEventListeners();
  checkStoredToken();
});

/**
 * 初始化事件监听
 */
function initEventListeners() {
  // IPC事件
  ipcRenderer.on('connection-status', (event, data) => {
    updateConnectionStatus(data.connected);
  });

  ipcRenderer.on('registered', (event, data) => {
    console.log('设备已注册:', data);
  });

  ipcRenderer.on('device-update', (event, data) => {
    updateDeviceList(data);
  });

  ipcRenderer.on('error', (event, message) => {
    showError(message);
  });

  // 输入框事件
  const chatInput = document.getElementById('chat-input');
  if (chatInput) {
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
  }
}

/**
 * 检查存储的Token
 */
async function checkStoredToken() {
  const token = localStorage.getItem('chenyi_token');
  if (token) {
    // 已有token，尝试连接
    showMainPage();
    await ipcRenderer.invoke('connect', token);
  }
}

/**
 * 登录处理
 */
async function handleLogin() {
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;

  if (!email || !password) {
    showError('请输入邮箱和密码');
    return;
  }

  try {
    const result = await ipcRenderer.invoke('login', { email, password });
    
    if (result.success) {
      localStorage.setItem('chenyi_token', result.token);
      showMainPage();
      await ipcRenderer.invoke('connect', result.token);
    } else {
      showError(result.error || '登录失败');
    }
  } catch (err) {
    showError('登录失败: ' + err.message);
  }
}

/**
 * 显示主页面
 */
function showMainPage() {
  document.getElementById('login-page').style.display = 'none';
  document.getElementById('main-page').style.display = 'flex';
}

/**
 * 切换面板
 */
function switchPanel(panelName) {
  // 更新导航
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.remove('active');
    if (item.dataset.panel === panelName) {
      item.classList.add('active');
    }
  });

  // 更新面板
  document.querySelectorAll('.panel').forEach(panel => {
    panel.classList.remove('active');
  });
  document.getElementById(`panel-${panelName}`).classList.add('active');
}

/**
 * 更新连接状态
 */
function updateConnectionStatus(connected) {
  isConnected = connected;
  const dot = document.getElementById('connection-dot');
  const text = document.getElementById('connection-text');
  
  if (dot && text) {
    dot.classList.toggle('online', connected);
    text.textContent = connected ? '已连接' : '未连接';
  }
}

/**
 * 更新设备列表
 */
function updateDeviceList(deviceData) {
  if (deviceData.devices) {
    devices = deviceData.devices;
  } else if (deviceData.deviceId) {
    // 单个设备更新
    const idx = devices.findIndex(d => d.deviceId === deviceData.deviceId);
    if (idx >= 0) {
      devices[idx] = { ...devices[idx], ...deviceData };
    } else {
      devices.push(deviceData);
    }
  }

  renderDeviceList();
}

/**
 * 渲染设备列表
 */
function renderDeviceList() {
  const container = document.getElementById('device-list');
  if (!container) return;

  container.innerHTML = devices.map(device => `
    <div class="device-card">
      <div class="device-header">
        <div class="device-icon">${device.deviceType === 'android' ? '📱' : '💻'}</div>
        <div class="device-info">
          <h3>${device.deviceName || '未知设备'}</h3>
          <p>${device.status === 'online' ? '在线' : '离线'} ${device.battery ? `电量 ${device.battery}%` : ''}</p>
        </div>
      </div>
      <div class="device-actions">
        <button class="btn btn-primary" onclick="controlDevice('${device.deviceId}', 'screenshot')">截图</button>
        <button class="btn btn-secondary" onclick="controlDevice('${device.deviceId}', 'get_status')">状态</button>
      </div>
    </div>
  `).join('');

  if (devices.length === 0) {
    container.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 40px;">暂无设备连接</p>';
  }
}

/**
 * 发送AI消息
 */
async function sendMessage() {
  const input = document.getElementById('chat-input');
  const content = input.value.trim();
  
  if (!content) return;

  // 添加用户消息
  addMessage('user', content);
  input.value = '';

  // 发送到云端
  try {
    await ipcRenderer.invoke('ai-chat', content);
  } catch (err) {
    showError('发送失败: ' + err.message);
  }
}

/**
 * 添加消息到聊天列表
 */
function addMessage(role, content) {
  messages.push({ role, content, timestamp: Date.now() });
  renderMessages();
}

/**
 * 渲染消息列表
 */
function renderMessages() {
  const container = document.getElementById('chat-messages');
  if (!container) return;

  container.innerHTML = messages.map(msg => `
    <div class="message ${msg.role}">
      <div class="message-avatar">${msg.role === 'user' ? '👤' : '🤖'}</div>
      <div class="message-content">${escapeHtml(msg.content)}</div>
    </div>
  `).join('');

  // 滚动到底部
  container.scrollTop = container.scrollHeight;
}

/**
 * 控制设备
 */
async function controlDevice(deviceId, action) {
  try {
    const result = await ipcRenderer.invoke('control-device', {
      targetId: deviceId,
      action,
      params: {}
    });
    console.log('控制结果:', result);
  } catch (err) {
    showError('控制失败: ' + err.message);
  }
}

/**
 * 显示错误
 */
function showError(message) {
  console.error('错误:', message);
  // TODO: 显示错误提示
}

/**
 * HTML转义
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 窗口控制
function minimizeWindow() {
  ipcRenderer.send('window-minimize');
}

function maximizeWindow() {
  ipcRenderer.send('window-maximize');
}

function closeWindow() {
  ipcRenderer.send('window-close');
}