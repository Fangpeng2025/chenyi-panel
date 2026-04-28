const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const os = require('os');
const { exec, execSync } = require('child_process');
const fs = require('fs');

let mainWindow;

// ==================== 鹏程万里 WebSocket 连接管理 ====================
let pcwlWs = null;           // WebSocket 连接实例
let pcwlConnected = false;   // 连接状态
let pcwlDeviceId = 0;        // 请求ID计数器
let pcwlDeviceInfo = null;   // 设备信息

// 发送手机命令（通过 WebSocket）
function sendPhoneCommand(cmd, params = {}) {
  return new Promise((resolve, reject) => {
    if (!pcwlWs || !pcwlConnected) {
      reject(new Error('手机未连接'));
      return;
    }
    
    const id = `req_${++pcwlDeviceId}`;
    const request = { id, command: cmd, params };
    const timeout = setTimeout(() => reject(new Error('命令超时')), 15000);
    
    const handler = (data) => {
      try {
        const resp = JSON.parse(data.toString());
        if (resp.id === id) {
          clearTimeout(timeout);
          pcwlWs.off('message', handler);
          resolve(resp);
        }
      } catch (e) {}
    };
    
    pcwlWs.on('message', handler);
    pcwlWs.send(JSON.stringify(request));
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    backgroundColor: '#1a1a2e',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    icon: path.join(__dirname, 'assets/icon.png'),
  });

  mainWindow.loadFile('index.html');
  
  // 开发模式打开DevTools
  // mainWindow.webContents.openDevTools();
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// IPC 处理
ipcMain.on('window-minimize', () => mainWindow.minimize());
ipcMain.on('window-maximize', () => {
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on('window-close', () => mainWindow.close());

// 执行命令
ipcMain.handle('exec-command', async (event, cmd) => {
  return new Promise((resolve) => {
    exec(cmd, (error, stdout, stderr) => {
      resolve({ error: error?.message, stdout, stderr });
    });
  });
});

// 同步执行命令
ipcMain.handle('exec-sync', (event, cmd) => {
  try {
    const result = execSync(cmd, { encoding: 'utf-8', timeout: 5000 });
    return { success: true, data: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 检查进程
ipcMain.handle('check-process', (event, name) => {
  try {
    const result = execSync(`pgrep -f "${name}"`, { encoding: 'utf-8' });
    return result.trim().length > 0;
  } catch {
    return false;
  }
});

// 打开外部链接
ipcMain.handle('open-external', (event, url) => {
  shell.openExternal(url);
});

// ==================== 聊天API ====================

// Hermes聊天
ipcMain.handle('hermes-chat', async (event, message) => {
  const { spawn } = require('child_process');
  
  return new Promise((resolve, reject) => {
    // 使用 -z 参数传递消息
    const hermes = spawn('hermes', ['-z', message], {
      shell: true,
      timeout: 60000
    });
    
    let output = '';
    let errorOutput = '';
    
    hermes.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    hermes.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });
    
    hermes.on('close', (code) => {
      if (code === 0 && output.trim()) {
        resolve(output.trim());
      } else {
        // 如果hermes命令失败，尝试直接调用API
        callHermesDirectAPI(message).then(resolve).catch(() => {
          reject(new Error(errorOutput || 'Hermes调用失败'));
        });
      }
    });
    
    hermes.on('error', () => {
      // 如果spawn失败，尝试直接调用API
      callHermesDirectAPI(message).then(resolve).catch(reject);
    });
  });
});

// Hermes直接API调用（备用方案）
async function callHermesDirectAPI(message) {
  const http = require('http');
  const os = require('os');
  const fs = require('fs');
  const path = require('path');
  
  // 读取Hermes配置
  const configPath = path.join(os.homedir(), '.hermes', 'config.yaml');
  let apiUrl = 'http://localhost:8080'; // 默认
  
  // TODO: 解析config.yaml获取实际API地址
  
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      message: message,
      stream: false
    });
    
    const req = http.request({
      hostname: 'localhost',
      port: 8080,
      path: '/api/chat',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 30000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.response || json.message || data);
        } catch {
          resolve(data);
        }
      });
    });
    
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// ==================== 服务管理 ====================

// 检查服务进程状态
ipcMain.handle('check-service-status', async (event, serviceName) => {
  try {
    let running = false;
    let statusText = 'stopped';
    
    switch (serviceName) {
      case 'hermes':
        // 检查hermes gateway进程
        try {
          const result = execSync('pgrep -f "hermes.*gateway" 2>/dev/null || echo ""', { encoding: 'utf-8' });
          running = result.trim().length > 0;
          statusText = running ? 'running' : 'stopped';
        } catch {
          running = false;
        }
        break;
        
      case 'phone':
        // 检查ADB连接状态
        try {
          const result = execSync('adb devices 2>/dev/null | grep -v "List of devices" | grep -v "^$" | wc -l', { encoding: 'utf-8' });
          running = parseInt(result.trim()) > 0;
          statusText = running ? 'connected' : 'disconnected';
        } catch {
          running = false;
        }
        break;
        
      case 'droidpilot':
        // 检查DroidPilot MCP进程
        try {
          const result = execSync('pgrep -f "droidpilot|mcp-server" 2>/dev/null || echo ""', { encoding: 'utf-8' });
          running = result.trim().length > 0;
          statusText = running ? 'running' : 'stopped';
        } catch {
          running = false;
        }
        break;
        
      default:
        // 通用进程检查
        try {
          const pidResult = execSync(`pgrep -f "${serviceName}" 2>/dev/null || echo ""`, { encoding: 'utf-8' });
          running = pidResult.trim().length > 0;
          statusText = running ? 'running' : 'stopped';
        } catch {
          running = false;
        }
    }
    
    return { running, status: statusText };
  } catch (error) {
    return { running: false, status: 'error', error: error.message };
  }
});

// 启动或停止服务
ipcMain.handle('toggle-service', async (event, { serviceName, action }) => {
  try {
    let cmd;
    let result;
    
    switch (serviceName) {
      case 'hermes':
        // Hermes 服务使用 hermes 命令控制
        if (action === 'start') {
          cmd = 'hermes gateway start';
          result = await execCommand(cmd, 10000);
        } else {
          cmd = 'hermes gateway stop';
          result = await execCommand(cmd, 10000);
        }
        if (!result.success && !result.error?.includes('not found')) {
          // 尝试直接使用进程管理
          if (action === 'start') {
            result = await execCommand('nohup hermes gateway > /dev/null 2>&1 &', 5000);
          } else {
            result = await execCommand('pkill -f "hermes gateway"', 5000);
          }
        }
        return result;
        
      case 'phone':
        // 手机连接使用 adb connect/disconnect
        const phoneConfig = getPhoneConfig();
        const address = phoneConfig.address || '192.168.1.100:5555';
        
        if (action === 'start') {
          result = await execCommand(`adb connect ${address}`, 10000);
          if (result.success && (result.stdout?.includes('connected') || result.stdout?.includes('already connected'))) {
            return { success: true, action, message: `已连接到 ${address}` };
          }
          return { success: false, error: result.stdout || result.error || '连接失败' };
        } else {
          result = await execCommand(`adb disconnect ${address}`, 10000);
          return { success: true, action, message: `已断开 ${address}` };
        }
        
      case 'droidpilot':
        // DroidPilot MCP 服务控制
        if (action === 'start') {
          // 检查是否已运行
          try {
            const checkResult = execSync('pgrep -f "droidpilot/mcp-server"', { encoding: 'utf-8' });
            if (checkResult.trim()) {
              return { success: true, action, message: 'DroidPilot 已在运行' };
            }
          } catch {
            // 未运行，继续启动
          }
          
          // 启动 DroidPilot
          const os = require('os');
          const droidpilotPath = path.join(os.homedir(), '.hermes', 'droidpilot', 'mcp-server');
          cmd = `cd "${droidpilotPath}" && nohup node src/index.js > /tmp/droidpilot.log 2>&1 &`;
          result = await execCommand(cmd, 5000);
          return { success: true, action, message: 'DroidPilot 启动中...' };
        } else {
          // 停止 DroidPilot
          result = await execCommand('pkill -f "droidpilot/mcp-server"', 5000);
          return { success: true, action, message: 'DroidPilot 已停止' };
        }
        
      default:
        return { success: false, error: `未知服务: ${serviceName}` };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 辅助函数：执行命令
async function execCommand(cmd, timeout = 10000) {
  return new Promise((resolve) => {
    exec(cmd, { encoding: 'utf-8', timeout }, (error, stdout, stderr) => {
      if (error) {
        resolve({ success: false, error: error.message, stdout, stderr });
      } else {
        resolve({ success: true, stdout, stderr });
      }
    });
  });
}

// 辅助函数：获取手机配置
function getPhoneConfig() {
  const os = require('os');
  const fs = require('fs');
  const configPath = path.join(os.homedir(), '.hermes', 'droidpilot', 'phone-config.json');
  
  try {
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf-8');
      return JSON.parse(content);
    }
  } catch (error) {
    console.error('读取手机配置失败:', error);
  }
  
  return { address: '192.168.1.100:5555' };
}

// ==================== 系统资源 ====================

// 获取系统资源使用率
ipcMain.handle('get-system-resources', async () => {
  const os = require('os');
  const fs = require('fs');
  
  try {
    // CPU使用率
    const cpus = os.cpus();
    let totalIdle = 0;
    let totalTick = 0;
    cpus.forEach(cpu => {
      for (let type in cpu.times) {
        totalTick += cpu.times[type];
      }
      totalIdle += cpu.times.idle;
    });
    const cpuUsage = Math.round((1 - totalIdle / totalTick) * 100);
    
    // 内存使用率
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const memUsage = Math.round((1 - freeMem / totalMem) * 100);
    const memUsedGB = (totalMem - freeMem) / 1024 / 1024 / 1024;
    const memTotalGB = totalMem / 1024 / 1024 / 1024;
    
    // 磁盘使用率
    let diskUsage = 0;
    let diskUsedGB = 0;
    let diskTotalGB = 0;
    try {
      const dfResult = execSync("df -h / | tail -1 | awk '{print $2, $3, $5}'", { encoding: 'utf-8' });
      const parts = dfResult.trim().split(/\s+/);
      if (parts.length >= 3) {
        diskTotalGB = parseFloat(parts[0]) || 0;
        diskUsedGB = parseFloat(parts[1]) || 0;
        diskUsage = parseInt(parts[2]) || 0;
      }
    } catch {
      // df命令失败时使用默认值
    }
    
    return {
      cpu: { usage: cpuUsage, cores: cpus.length },
      memory: { 
        usage: memUsage, 
        used: memUsedGB.toFixed(1), 
        total: memTotalGB.toFixed(1) 
      },
      disk: { 
        usage: diskUsage, 
        used: diskUsedGB.toFixed(1), 
        total: diskTotalGB.toFixed(1) 
      },
      uptime: os.uptime(),
      platform: os.platform()
    };
  } catch (error) {
    return { error: error.message };
  }
});

// ==================== ADB功能 ====================

// ADB连接手机
ipcMain.handle('adb-connect', async (event, { ip, port = 5555 }) => {
  try {
    const address = `${ip}:${port}`;
    const result = execSync(`adb connect ${address}`, { encoding: 'utf-8', timeout: 10000 });
    
    if (result.includes('connected') || result.includes('already connected')) {
      return { success: true, message: result.trim(), address };
    } else {
      return { success: false, error: result.trim() };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ADB断开连接
ipcMain.handle('adb-disconnect', async (event, address) => {
  try {
    const result = execSync(`adb disconnect ${address}`, { encoding: 'utf-8', timeout: 10000 });
    return { success: true, message: result.trim() };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 获取ADB设备列表
ipcMain.handle('adb-devices', async () => {
  try {
    const result = execSync('adb devices -l', { encoding: 'utf-8', timeout: 10000 });
    const lines = result.trim().split('\n').slice(1); // 跳过标题行
    
    const devices = lines
      .filter(line => line.trim())
      .map(line => {
        const parts = line.split(/\s+/);
        const id = parts[0];
        const status = parts[1];
        const info = parts.slice(2).join(' ');
        
        // 解析设备信息
        let model = '';
        let product = '';
        const modelMatch = info.match(/model:(\S+)/);
        const productMatch = info.match(/product:(\S+)/);
        if (modelMatch) model = modelMatch[1];
        if (productMatch) product = productMatch[1];
        
        return {
          id,
          status,
          model,
          product,
          info
        };
      });
    
    return { success: true, devices };
  } catch (error) {
    return { success: false, error: error.message, devices: [] };
  }
});

// ADB截图并保存
ipcMain.handle('adb-screenshot', async (event, { deviceId, savePath }) => {
  const fs = require('fs');
  const os = require('os');
  
  try {
    // 默认保存路径
    if (!savePath) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      savePath = path.join(os.homedir(), 'Pictures', `adb-screenshot-${timestamp}.png`);
    }
    
    // 确保目录存在
    const saveDir = path.dirname(savePath);
    if (!fs.existsSync(saveDir)) {
      fs.mkdirSync(saveDir, { recursive: true });
    }
    
    // 设备选择参数
    const deviceArg = deviceId ? `-s ${deviceId}` : '';
    
    // 截图到设备
    execSync(`adb ${deviceArg} shell screencap -p /sdcard/screenshot_temp.png`, { encoding: 'utf-8', timeout: 10000 });
    
    // 拉取到本地
    execSync(`adb ${deviceArg} pull /sdcard/screenshot_temp.png "${savePath}"`, { encoding: 'utf-8', timeout: 15000 });
    
    // 删除设备上的临时文件
    execSync(`adb ${deviceArg} shell rm /sdcard/screenshot_temp.png`, { encoding: 'utf-8', timeout: 5000 });
    
    return { success: true, path: savePath };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ==================== Cron任务管理 ====================

// 获取Cron任务列表
ipcMain.handle('get-cron-jobs', async () => {
  try {
    const result = execSync('crontab -l 2>/dev/null || echo ""', { encoding: 'utf-8' });
    const lines = result.split('\n').filter(line => line.trim() && !line.startsWith('#'));
    const jobs = lines.map((line, index) => {
      const parts = line.split(/\s+/);
      if (parts.length >= 6) {
        return {
          id: index,
          schedule: parts.slice(0, 5).join(' '),
          command: parts.slice(5).join(' '),
          enabled: true,
          raw: line
        };
      }
      return { id: index, raw: line, enabled: true };
    });
    return { success: true, jobs };
  } catch (error) {
    return { success: true, jobs: [] };
  }
});

// 添加Cron任务
ipcMain.handle('add-cron-job', async (event, { schedule, command }) => {
  try {
    // 获取现有任务
    const existing = execSync('crontab -l 2>/dev/null || echo ""', { encoding: 'utf-8' });
    const newJob = `${schedule} ${command}`;
    const updated = existing.trim() + '\n' + newJob + '\n';
    
    // 写入临时文件
    const tmpFile = '/tmp/crontab.tmp';
    require('fs').writeFileSync(tmpFile, updated);
    
    // 安装新的crontab
    execSync(`crontab ${tmpFile}`, { encoding: 'utf-8' });
    execSync(`rm ${tmpFile}`, { encoding: 'utf-8' });
    
    return { success: true, message: '任务已添加' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 删除Cron任务
ipcMain.handle('remove-cron-job', async (event, { jobId }) => {
  try {
    const result = execSync('crontab -l 2>/dev/null || echo ""', { encoding: 'utf-8' });
    const lines = result.split('\n').filter(line => line.trim() && !line.startsWith('#'));
    
    if (jobId >= 0 && jobId < lines.length) {
      lines.splice(jobId, 1);
      const updated = lines.join('\n') + '\n';
      
      const tmpFile = '/tmp/crontab.tmp';
      require('fs').writeFileSync(tmpFile, updated);
      execSync(`crontab ${tmpFile}`, { encoding: 'utf-8' });
      execSync(`rm ${tmpFile}`, { encoding: 'utf-8' });
      
      return { success: true, message: '任务已删除' };
    }
    return { success: false, error: '任务ID无效' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 启用/禁用Cron任务
ipcMain.handle('toggle-cron-job', async (event, { jobId, enabled }) => {
  try {
    const result = execSync('crontab -l 2>/dev/null || echo ""', { encoding: 'utf-8' });
    const lines = result.split('\n').filter(line => line.trim());
    
    if (jobId >= 0 && jobId < lines.length) {
      const line = lines[jobId];
      if (enabled) {
        // 取消注释
        lines[jobId] = line.replace(/^#\s*/, '');
      } else {
        // 添加注释
        if (!line.startsWith('#')) {
          lines[jobId] = '# ' + line;
        }
      }
      
      const updated = lines.join('\n') + '\n';
      const tmpFile = '/tmp/crontab.tmp';
      require('fs').writeFileSync(tmpFile, updated);
      execSync(`crontab ${tmpFile}`, { encoding: 'utf-8' });
      execSync(`rm ${tmpFile}`, { encoding: 'utf-8' });
      
      return { success: true, message: enabled ? '任务已启用' : '任务已禁用' };
    }
    return { success: false, error: '任务ID无效' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ==================== 手机连接管理 ====================

// 手机连接
ipcMain.handle('phone-connect', async (event, { ip, port }) => {
  try {
    const address = `${ip}:${port || 5555}`;
    const result = execSync(`adb connect ${address}`, { encoding: 'utf-8', timeout: 15000 });
    
    if (result.includes('connected') || result.includes('already connected')) {
      // 保存配置
      const configPath = path.join(os.homedir(), '.hermes', 'droidpilot', 'phone-config.json');
      const configDir = path.dirname(configPath);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
      fs.writeFileSync(configPath, JSON.stringify({ address, ip, port: port || 5555 }, null, 2));
      
      return { success: true, message: `已连接到 ${address}` };
    }
    return { success: false, error: result.trim() };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 手机断开连接
ipcMain.handle('phone-disconnect', async () => {
  try {
    // 读取配置获取地址
    const configPath = path.join(os.homedir(), '.hermes', 'droidpilot', 'phone-config.json');
    let address = '';
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      address = config.address || '';
    }
    
    if (address) {
      execSync(`adb disconnect ${address}`, { encoding: 'utf-8', timeout: 10000 });
    } else {
      execSync('adb disconnect', { encoding: 'utf-8', timeout: 10000 });
    }
    
    return { success: true, message: '已断开连接' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ==================== 鹏程万里连接管理 ====================

// 鹏程万里连接（通过 WebSocket 直接连接手机APP）
ipcMain.handle('pcwl-connect', async (event, params) => {
  try {
    const phoneIp = params?.ip || '192.168.0.102';
    const phonePort = params?.port || 8765;
    
    // 如果已经连接，直接返回
    if (pcwlConnected && pcwlWs) {
      return { 
        success: true, 
        message: '已连接', 
        deviceInfo: pcwlDeviceInfo,
        data: { ip: phoneIp, port: phonePort } 
      };
    }
    
    // 动态加载 WebSocket 模块
    const WebSocket = require('ws');
    
    // 建立 WebSocket 连接
    const wsUrl = `ws://${phoneIp}:${phonePort}`;
    console.log(`[PCWL] 正在连接 ${wsUrl}...`);
    
    pcwlWs = new WebSocket(wsUrl);
    
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('连接超时'));
      }, 10000);
      
      pcwlWs.on('open', () => {
        clearTimeout(timeout);
        pcwlConnected = true;
        console.log('[PCWL] WebSocket 已连接');
        resolve();
      });
      
      pcwlWs.on('error', (err) => {
        clearTimeout(timeout);
        reject(new Error(`连接失败: ${err.message}`));
      });
    });
    
    // 获取设备信息
    const deviceResult = await sendPhoneCommand('get_device_info');
    
    if (deviceResult.success) {
      pcwlDeviceInfo = deviceResult.data;
      
      // 设置断开连接的事件处理
      pcwlWs.on('close', () => {
        console.log('[PCWL] WebSocket 已断开');
        pcwlConnected = false;
        pcwlDeviceInfo = null;
      });
      
      pcwlWs.on('error', (err) => {
        console.log('[PCWL] WebSocket 错误:', err.message);
        pcwlConnected = false;
      });
      
      return { 
        success: true, 
        message: '鹏程万里已连接', 
        deviceInfo: pcwlDeviceInfo,
        data: { ip: phoneIp, port: phonePort } 
      };
    } else {
      pcwlWs.close();
      pcwlWs = null;
      pcwlConnected = false;
      return { success: false, error: '获取设备信息失败' };
    }
  } catch (error) {
    pcwlConnected = false;
    if (pcwlWs) {
      pcwlWs.close();
      pcwlWs = null;
    }
    return { success: false, error: error.message };
  }
});

// 鹏程万里断开
ipcMain.handle('pcwl-disconnect', async () => {
  try {
    // 关闭 WebSocket 连接
    if (pcwlWs) {
      pcwlWs.close();
      pcwlWs = null;
    }
    pcwlConnected = false;
    pcwlDeviceInfo = null;
    
    return { success: true, message: '鹏程万里已断开' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 鹏程万里自动连接切换
ipcMain.handle('pcwl-auto-toggle', async (event, { enabled }) => {
  try {
    const configPath = path.join(os.homedir(), '.hermes', 'scripts', 'phone_config.json');
    
    let config = { phone: {}, service: {}, log: {} };
    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
    
    config.phone.auto_connect = enabled;
    
    const configDir = path.dirname(configPath);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    
    return { success: true, message: enabled ? '已启用自动连接' : '已禁用自动连接', data: { auto_connect: enabled } };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ==================== SSH连接管理 ====================

// SSH连接
ipcMain.handle('ssh-connect', async (event, { host, port, user, password }) => {
  try {
    const sshPort = port || 22;
    
    // 检查sshpass是否可用
    let sshCheck;
    try {
      sshCheck = execSync('which sshpass', { encoding: 'utf-8' });
    } catch (e) {
      return { success: false, error: 'sshpass未安装，请先安装: sudo apt install sshpass' };
    }
    
    // 测试SSH连接
    const testCmd = `sshpass -p '${password}' ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 -p ${sshPort} ${user}@${host} "echo connected"`;
    const result = execSync(testCmd, { encoding: 'utf-8', timeout: 15000 });
    
    if (result.includes('connected')) {
      // 保存SSH配置（不保存密码）
      const sshConfigPath = path.join(os.homedir(), '.hermes', 'scripts', 'ssh_config.json');
      const sshConfig = { host, port: sshPort, user, lastConnect: new Date().toISOString() };
      
      const configDir = path.dirname(sshConfigPath);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
      fs.writeFileSync(sshConfigPath, JSON.stringify(sshConfig, null, 2));
      
      return { success: true, message: `SSH已连接到 ${user}@${host}:${sshPort}`, data: { host, port: sshPort, user } };
    }
    return { success: false, error: '连接测试失败' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// SSH断开
ipcMain.handle('ssh-disconnect', async () => {
  try {
    // SSH是无状态连接，只需清理配置
    const sshConfigPath = path.join(os.homedir(), '.hermes', 'scripts', 'ssh_config.json');
    if (fs.existsSync(sshConfigPath)) {
      const config = JSON.parse(fs.readFileSync(sshConfigPath, 'utf-8'));
      config.connected = false;
      fs.writeFileSync(sshConfigPath, JSON.stringify(config, null, 2));
    }
    
    return { success: true, message: 'SSH连接信息已清除' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 获取手机配置
ipcMain.handle('get-phone-config', async () => {
  try {
    return getPhoneConfig();
  } catch (error) {
    return null;
  }
});

// 手机操作（截图、按键等）- 通过 WebSocket 发送命令
ipcMain.handle('phone-action', async (event, action) => {
  try {
    // 检查 WebSocket 连接
    if (!pcwlConnected || !pcwlWs) {
      return { success: false, error: '手机未连接，请先连接鹏程万里' };
    }
    
    let command = '';
    let params = {};
    let message = '';
    
    switch (action) {
      case 'screenshot':
        command = 'screenshot';
        message = '截图完成';
        break;
      case 'home':
        command = 'press_key';
        params = { key: 'home' };
        message = '已返回主页';
        break;
      case 'back':
        command = 'press_key';
        params = { key: 'back' };
        message = '已返回';
        break;
      case 'power':
        command = 'press_key';
        params = { key: 'power_dialog' };
        message = '电源菜单';
        break;
      case 'volume_up':
        command = 'press_key';
        params = { key: 'volume_up' };
        message = '音量+';
        break;
      case 'volume_down':
        command = 'press_key';
        params = { key: 'volume_down' };
        message = '音量-';
        break;
      case 'apps':
        command = 'press_key';
        params = { key: 'recents' };
        message = '应用列表';
        break;
      case 'notifications':
        command = 'press_key';
        params = { key: 'notifications' };
        message = '通知面板';
        break;
      case 'quick_settings':
        command = 'press_key';
        params = { key: 'quick_settings' };
        message = '快速设置';
        break;
      default:
        return { success: false, error: '未知操作' };
    }
    
    // 发送命令到手机
    const result = await sendPhoneCommand(command, params);
    
    if (result.success) {
      // 如果是截图，返回图片数据
      if (action === 'screenshot' && result.data) {
        return { 
          success: true, 
          message,
          screenshot: result.data  // base64 图片数据
        };
      }
      return { success: true, message };
    } else {
      return { success: false, error: result.error || '命令执行失败' };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ==================== Hermes技能管理 ====================

// 辅助函数：执行命令并返回结果
async function runCommand(cmd, timeout = 30000) {
  return new Promise((resolve) => {
    exec(cmd, { encoding: 'utf-8', timeout }, (error, stdout, stderr) => {
      if (error) {
        resolve({ success: false, error: error.message, stdout, stderr });
      } else {
        resolve({ success: true, stdout, stderr });
      }
    });
  });
}

// 获取Hermes技能列表
ipcMain.handle('hermes-skills', async () => {
  try {
    const result = await runCommand('hermes skills list --json');
    
    if (result.success && result.stdout) {
      try {
        // 尝试解析JSON输出
        const skills = JSON.parse(result.stdout);
        return { success: true, skills };
      } catch {
        // 如果不是JSON，返回原始输出让前端解析
        return { success: true, output: result.stdout };
      }
    }
    
    // 如果--json参数不支持，尝试普通输出
    const fallbackResult = await runCommand('hermes skills list');
    if (fallbackResult.success) {
      return { success: true, output: fallbackResult.stdout };
    }
    
    return { success: false, error: result.error || '获取技能列表失败' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// 切换技能状态
ipcMain.handle('hermes-skill-toggle', async (event, { name, enable }) => {
  try {
    const action = enable ? 'enable' : 'disable';
    const result = await runCommand(`hermes skills ${action} "${name}"`);
    
    if (result.success) {
      return { 
        success: true, 
        message: `技能 ${name} 已${enable ? '启用' : '禁用'}`,
        output: result.stdout 
      };
    }
    
    return { success: false, error: result.error || '操作失败' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ==================== Hermes配置管理 ====================

// Hermes操作处理器（模型列表、配置获取、模型设置等）
ipcMain.handle('hermes-action', async (event, action) => {
  const os = require('os');
  const fs = require('fs');
  const https = require('https');
  
  switch (action) {
    case 'hermes-models':
      try {
        const configPath = path.join(os.homedir(), '.hermes', 'config.yaml');
        const configContent = fs.readFileSync(configPath, 'utf-8');
        
        // 解析YAML获取API配置
        const baseUrlMatch = configContent.match(/base_url:\s*(.+)/);
        const apiKeyMatch = configContent.match(/api_key:\s*(.+)/);
        
        if (baseUrlMatch && apiKeyMatch) {
          const baseUrl = baseUrlMatch[1].trim();
          const apiKey = apiKeyMatch[1].trim();
          
          const url = new URL('/v1/models', baseUrl);
          
          return new Promise((resolve, reject) => {
            const req = https.request({
              hostname: url.hostname,
              port: url.port || 443,
              path: url.pathname,
              method: 'GET',
              headers: { 'Authorization': `Bearer ${apiKey}` }
            }, (res) => {
              let data = '';
              res.on('data', chunk => data += chunk);
              res.on('end', () => {
                try {
                  const json = JSON.parse(data);
                  const models = json.data.map(m => m.id);
                  resolve({ success: true, models });
                } catch (e) {
                  resolve({ success: false, error: e.message, models: [] });
                }
              });
            });
            req.on('error', (e) => {
              resolve({ success: false, error: e.message, models: [] });
            });
            req.end();
          });
        }
        return { success: false, error: '配置文件缺少API信息', models: [] };
      } catch (e) {
        console.error('获取模型列表失败:', e);
        return { success: false, error: e.message, models: [] };
      }

    case 'hermes-config':
      try {
        const configPath = path.join(os.homedir(), '.hermes', 'config.yaml');
        const configContent = fs.readFileSync(configPath, 'utf-8');
        
        const modelMatch = configContent.match(/default:\s*(.+)/);
        const contextMatch = configContent.match(/context_length:\s*(\d+)/);
        const maxTokensMatch = configContent.match(/max_tokens:\s*(\d+)/);
        
        return {
          success: true,
          config: {
            model: modelMatch ? modelMatch[1].trim() : 'glm-5',
            contextLength: contextMatch ? parseInt(contextMatch[1]) : 200000,
            maxTokens: maxTokensMatch ? parseInt(maxTokensMatch[1]) : 4096
          }
        };
      } catch (e) {
        return { 
          success: false, 
          error: e.message,
          config: { model: 'glm-5', contextLength: 200000, maxTokens: 4096 } 
        };
      }

    case 'hermes-set-model':
      // 需要额外传入model参数
      return { success: false, error: '请使用 hermes-set-model 单独处理器' };

    default:
      return { success: false, error: `未知操作: ${action}` };
  }
});

// 设置模型（单独处理器，需要传入model参数）
ipcMain.handle('hermes-set-model', async (event, model) => {
  const os = require('os');
  const fs = require('fs');
  
  try {
    const configPath = path.join(os.homedir(), '.hermes', 'config.yaml');
    let configContent = '';
    
    if (fs.existsSync(configPath)) {
      configContent = fs.readFileSync(configPath, 'utf-8');
    }
    
    // 替换或添加default模型配置
    if (configContent.match(/default:\s*.+/)) {
      configContent = configContent.replace(/default:\s*.+/, `default: ${model}`);
    } else {
      // 如果没有default配置，添加一个
      configContent += `\ndefault: ${model}\n`;
    }
    
    fs.writeFileSync(configPath, configContent);
    return { success: true, message: `模型已设置为 ${model}` };
  } catch (e) {
    console.error('设置模型失败:', e);
    return { success: false, error: e.message };
  }
});

// 获取可用模型列表（独立处理器）
ipcMain.handle('hermes-models', async () => {
  const os = require('os');
  const fs = require('fs');
  const https = require('https');
  
  try {
    const configPath = path.join(os.homedir(), '.hermes', 'config.yaml');
    const configContent = fs.readFileSync(configPath, 'utf-8');
    
    const baseUrlMatch = configContent.match(/base_url:\s*(.+)/);
    const apiKeyMatch = configContent.match(/api_key:\s*(.+)/);
    
    if (baseUrlMatch && apiKeyMatch) {
      const baseUrl = baseUrlMatch[1].trim();
      const apiKey = apiKeyMatch[1].trim();
      const url = new URL('/v1/models', baseUrl);
      
      return new Promise((resolve) => {
        const req = https.request({
          hostname: url.hostname,
          port: url.port || 443,
          path: url.pathname,
          method: 'GET',
          headers: { 'Authorization': `Bearer ${apiKey}` }
        }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try {
              const json = JSON.parse(data);
              const models = json.data.map(m => m.id);
              resolve(models);
            } catch (e) {
              resolve(['glm-5']); // 回退
            }
          });
        });
        req.on('error', () => resolve(['glm-5']));
        req.end();
      });
    }
    return ['glm-5'];
  } catch (e) {
    return ['glm-5'];
  }
});

// 获取当前配置（独立处理器）
ipcMain.handle('hermes-config', async () => {
  const os = require('os');
  const fs = require('fs');
  
  try {
    const configPath = path.join(os.homedir(), '.hermes', 'config.yaml');
    const configContent = fs.readFileSync(configPath, 'utf-8');
    
    const modelMatch = configContent.match(/default:\s*(.+)/);
    const contextMatch = configContent.match(/context_length:\s*(\d+)/);
    const maxTokensMatch = configContent.match(/max_tokens:\s*(\d+)/);
    
    return {
      model: modelMatch ? modelMatch[1].trim() : 'glm-5',
      contextLength: contextMatch ? parseInt(contextMatch[1]) : 200000,
      maxTokens: maxTokensMatch ? parseInt(maxTokensMatch[1]) : 4096
    };
  } catch (e) {
    return { model: 'glm-5', contextLength: 200000, maxTokens: 4096 };
  }
});
