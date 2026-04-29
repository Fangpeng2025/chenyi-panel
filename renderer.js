const { ipcRenderer } = require('electron');

// ==================== 状态管理 ====================
let messages = []; // 消息历史
let sessions = []; // 会话列表
let currentSessionId = null;
let isGenerating = false;
let streamAbortController = null; // 用于停止流式生成

// 会话状态
let currentSessionTokens = { input: 0, output: 0 };
let sessionStartTime = null;
let sessionTimerInterval = null;
let totalContextLength = 200000;
let availableModels = [];

// ==================== 初始化 ====================
function init() {
  initTheme();
  initWindowControls();
  loadSessions();
  initMarkdown();
  loadAvailableModels(); // 加载可用模型
  
  // 自动调整输入框高度
  const input = document.getElementById('message-input');
  if (input) {
    input.addEventListener('input', autoResize);
  }
  
  // 初始化快捷键
  initKeyboardShortcuts();
}

// 初始化Markdown渲染器
function initMarkdown() {
  if (typeof marked !== 'undefined') {
    marked.setOptions({
      highlight: function(code, lang) {
        if (typeof hljs !== 'undefined' && lang && hljs.getLanguage(lang)) {
          try {
            return hljs.highlight(code, { language: lang }).value;
          } catch (e) {}
        }
        return code;
      },
      breaks: true,
      gfm: true
    });
  }
}

// 初始化快捷键
function initKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Ctrl+Enter 发送消息
    if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      sendMessage();
    }
    // Escape 停止生成
    if (e.key === 'Escape' && isGenerating) {
      stopGeneration();
    }
    // Ctrl+N 新建会话
    if (e.ctrlKey && e.key === 'n') {
      e.preventDefault();
      newSession();
    }
    // Ctrl+S 保存设置
    if (e.ctrlKey && e.key === 's') {
      e.preventDefault();
      if (currentPanel === 'settings') {
        saveSettingsWithFeedback();
      }
    }
  });
}

// 等待DOM加载完成后再初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// 主题管理
function initTheme() {
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'dark') {
    document.documentElement.classList.add('dark');
  } else if (savedTheme === 'light') {
    document.documentElement.classList.remove('dark');
  } else {
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      document.documentElement.classList.add('dark');
    }
  }
}

function toggleTheme() {
  const isDark = document.documentElement.classList.toggle('dark');
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
}

// 窗口控制
function initWindowControls() {
  document.getElementById('btn-minimize').onclick = () => ipcRenderer.send('window-minimize');
  document.getElementById('btn-maximize').onclick = () => ipcRenderer.send('window-maximize');
  document.getElementById('btn-close').onclick = () => ipcRenderer.send('window-close');
  document.getElementById('theme-toggle').onclick = toggleTheme;
}

// ==================== 模型与状态管理 ====================
// 加载可用模型和配置
async function loadAvailableModels() {
  try {
    // 并行加载模型列表和配置
    const [models, config] = await Promise.all([
      ipcRenderer.invoke('hermes-models'),
      ipcRenderer.invoke('hermes-config')
    ]);
    
    availableModels = models || ['glm-5'];
    
    // 更新配置
    if (config) {
      totalContextLength = config.contextLength || 200000;
      document.getElementById('status-model').textContent = config.model || 'glm-5';
      localStorage.setItem('currentModel', config.model || 'glm-5');
      // 更新仪表盘模型名称
      const modelNameEl = document.getElementById('current-model-name');
      if (modelNameEl) modelNameEl.textContent = config.model || 'glm-5';
    }
    
    updateModelSelector();
    updateStatusBar();
  } catch (e) {
    console.error('加载模型失败:', e);
    availableModels = ['glm-5'];
    updateModelSelector();
  }
}

// 更新模型选择器
function updateModelSelector() {
  const selector = document.getElementById('model-selector');
  if (!selector) return;
  
  const currentModel = localStorage.getItem('currentModel') || 'glm-5';
  selector.innerHTML = availableModels.map(m => 
    `<option value="${m}" ${m === currentModel ? 'selected' : ''}>${m}</option>`
  ).join('');
}

// 更新状态栏
function updateStatusBar() {
  const total = currentSessionTokens.input + currentSessionTokens.output;
  const percent = Math.min(100, (total / totalContextLength) * 100);
  
  document.getElementById('status-tokens').textContent = 
    `${formatNumber(total/1000)}K/${Math.round(totalContextLength/1000)}K`;
  document.getElementById('status-progress').style.width = `${percent}%`;
  document.getElementById('status-percent').textContent = `${Math.round(percent)}%`;
}

// 格式化数字
function formatNumber(n) {
  return n.toFixed(1);
}

// 开始会话计时
function startSessionTimer() {
  sessionStartTime = Date.now();
  sessionTimerInterval = setInterval(updateSessionTime, 1000);
}

// 更新会话时间显示
function updateSessionTime() {
  if (!sessionStartTime) return;
  const elapsed = Math.floor((Date.now() - sessionStartTime) / 1000);
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  document.getElementById('status-time').textContent = `⏲ ${mins}m ${secs}s`;
}

// 停止会话计时
function stopSessionTimer() {
  if (sessionTimerInterval) {
    clearInterval(sessionTimerInterval);
    sessionTimerInterval = null;
  }
}

// ==================== 输入框自动调整 ====================
function autoResize() {
  const input = document.getElementById('message-input');
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 200) + 'px';
}

// ==================== 键盘事件 ====================
function handleKeyDown(event) {
  // Ctrl+Enter 发送
  if (event.ctrlKey && event.key === 'Enter') {
    event.preventDefault();
    sendMessage();
    return;
  }
  // Enter发送（不带Ctrl），Shift+Enter换行
  if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey) {
    event.preventDefault();
    sendMessage();
  }
}

window.handleKeyDown = handleKeyDown;

// ==================== 快捷消息 ====================
function sendQuickMessage(text) {
  document.getElementById('message-input').value = text;
  sendMessage();
}

window.sendQuickMessage = sendQuickMessage;

// ==================== 发送消息 ====================
async function sendMessage() {
  const input = document.getElementById('message-input');
  const text = input.value.trim();
  
  if (!text || isGenerating) return;
  
  // 检测快捷命令
  if (text.startsWith('/')) {
    handleCommand(text);
    input.value = '';
    autoResize();
    return;
  }
  
  // 启动会话计时（如果是第一条消息）
  if (messages.length === 0) {
    startSessionTimer();
  }
  
  // 更新输入token
  const inputTokens = Math.ceil(text.length / 4); // 粗略估算
  currentSessionTokens.input += inputTokens;
  updateStatusBar();
  
  // 添加用户消息
  const userMessage = {
    role: 'user',
    content: text,
    timestamp: Date.now()
  };
  messages.push(userMessage);
  renderMessages();
  
  // 清空输入框
  input.value = '';
  autoResize();
  
  // 禁用发送按钮，显示停止按钮
  isGenerating = true;
  updateSendButton();
  
  // 显示加载状态
  showTypingIndicator();
  
  // 创建用于流式输出的AI消息占位
  const aiMessage = {
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
    streaming: true
  };
  messages.push(aiMessage);
  
  try {
    // 创建AbortController用于停止
    streamAbortController = new AbortController();
    
    // 调用Hermes API（流式）
    await callHermesAPIStream(text, (chunk) => {
      // 更新AI消息内容
      aiMessage.content += chunk;
      renderMessages(true); // isStreaming = true
    });
    
    // 完成
    aiMessage.streaming = false;
    renderMessages();
    
    // 更新输出token
    const outputTokens = Math.ceil(aiMessage.content.length / 4);
    currentSessionTokens.output += outputTokens;
    updateStatusBar();
    
    // 保存会话
    saveSession();
    
  } catch (error) {
    if (error.name === 'AbortError') {
      // 用户停止了生成
      aiMessage.content += '\n\n*[已停止生成]*';
      aiMessage.streaming = false;
      renderMessages();
    } else {
      console.error('发送消息失败:', error);
      // 移除AI占位消息
      messages.pop();
      addErrorMessage(error.message);
    }
  } finally {
    isGenerating = false;
    streamAbortController = null;
    updateSendButton();
    hideTypingIndicator();
  }
}

window.sendMessage = sendMessage;

// ==================== 快捷命令处理 ====================
function handleCommand(command) {
  const parts = command.split(' ');
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1).join(' ');
  
  switch (cmd) {
    case '/help':
      showHelp();
      break;
    case '/clear':
      clearCurrentSession();
      break;
    case '/export':
      exportChat();
      break;
    case '/skills':
      showSkills();
      break;
    case '/tools':
      showTools();
      break;
    case '/model':
      switchModel(args);
      break;
    default:
      showToast(`未知命令: ${cmd}。输入 /help 查看可用命令`, 'warning');
  }
}

// 显示帮助信息
function showHelp() {
  const helpContent = `## 快捷命令帮助

| 命令 | 说明 |
|------|------|
| /help | 显示帮助信息 |
| /clear | 清空当前会话 |
| /export | 导出对话为Markdown |
| /skills | 显示已安装技能 |
| /tools | 显示可用工具 |
| /model [name] | 切换模型 |

**提示**: 直接输入命令即可执行，例如输入 \`/clear\` 清空会话。`;
  
  // 添加系统消息显示帮助
  const helpMessage = {
    role: 'assistant',
    content: helpContent,
    timestamp: Date.now()
  };
  messages.push(helpMessage);
  renderMessages();
}

// 清空当前会话
function clearCurrentSession() {
  if (messages.length === 0) {
    showToast('当前会话已经是空的', 'info');
    return;
  }
  
  if (confirm('确定要清空当前会话吗？')) {
    messages = [];
    renderMessages();
    showToast('会话已清空', 'success');
  }
}

// 显示已安装技能
function showSkills() {
  // 从localStorage获取已安装技能
  const skills = JSON.parse(localStorage.getItem('installed-skills') || '[]');
  
  let skillsContent = '## 已安装技能\n\n';
  
  if (skills.length === 0) {
    skillsContent += '暂无已安装的技能。\n\n> 提示: 可以在技能面板中安装新技能。';
  } else {
    skillsContent += '| 技能名称 | 状态 | 描述 |\n|----------|------|------|\n';
    skills.forEach(skill => {
      const status = skill.enabled ? '✅ 启用' : '❌ 禁用';
      skillsContent += `| ${skill.name} | ${status} | ${skill.description || '-'} |\n`;
    });
  }
  
  const skillsMessage = {
    role: 'assistant',
    content: skillsContent,
    timestamp: Date.now()
  };
  messages.push(skillsMessage);
  renderMessages();
}

// 显示可用工具
function showTools() {
  // 获取可用工具列表（从设置或默认）
  const defaultTools = [
    { name: 'terminal', description: '执行终端命令' },
    { name: 'read_file', description: '读取文件内容' },
    { name: 'write_file', description: '写入文件内容' },
    { name: 'search_files', description: '搜索文件' },
    { name: 'patch', description: '编辑文件（查找替换）' },
    { name: 'process', description: '管理后台进程' }
  ];
  
  let toolsContent = '## 可用工具\n\n';
  toolsContent += '| 工具名称 | 描述 |\n|----------|------|\n';
  
  defaultTools.forEach(tool => {
    toolsContent += `| \`${tool.name}\` | ${tool.description} |\n`;
  });
  
  toolsContent += '\n> 提示: AI会自动选择合适的工具来完成任务。';
  
  const toolsMessage = {
    role: 'assistant',
    content: toolsContent,
    timestamp: Date.now()
  };
  messages.push(toolsMessage);
  renderMessages();
}

// 切换模型
async function switchModel(modelName) {
  if (!modelName) return;
  
  try {
    // 调用IPC设置模型
    await ipcRenderer.invoke('hermes-set-model', modelName);
    
    // 更新本地状态
    localStorage.setItem('currentModel', modelName);
    document.getElementById('status-model').textContent = modelName;
    
    // 更新选择器选中状态
    const selector = document.getElementById('model-selector');
    if (selector) {
      selector.value = modelName;
    }
    
    showToast(`模型已切换为 ${modelName}`, 'success');
  } catch (e) {
    console.error('切换模型失败:', e);
    showToast('切换模型失败', 'error');
  }
}

// 导出对话为Markdown
function exportChat() {
  if (messages.length === 0) {
    showToast('当前会话为空，无法导出', 'warning');
    return;
  }
  
  // 生成Markdown内容
  let markdown = '# 晨翼 Agent 对话记录\n\n';
  markdown += `导出时间: ${new Date().toLocaleString('zh-CN')}\n\n`;
  markdown += '---\n\n';
  
  messages.forEach((msg, index) => {
    const time = new Date(msg.timestamp).toLocaleString('zh-CN');
    
    if (msg.role === 'user') {
      markdown += `## 👤 用户 (${time})\n\n${msg.content}\n\n`;
    } else if (msg.role === 'assistant') {
      markdown += `## 🦐 助手 (${time})\n\n${msg.content}\n\n`;
    } else if (msg.role === 'error') {
      markdown += `## ❌ 错误 (${time})\n\n${msg.content}\n\n`;
    }
    
    markdown += '---\n\n';
  });
  
  markdown += '\n*由晨翼 Agent 自动生成*';
  
  // 创建Blob并下载
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `chenyi-chat-${new Date().toISOString().slice(0, 10)}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  showToast('对话已导出为Markdown文件', 'success');
}

window.handleCommand = handleCommand;
window.exportChat = exportChat;

// ==================== 停止生成 ====================
function stopGeneration() {
  if (streamAbortController) {
    streamAbortController.abort();
    showToast('已停止生成', 'warning');
  }
}

window.stopGeneration = stopGeneration;

// ==================== 更新发送按钮 ====================
function updateSendButton() {
  const btn = document.getElementById('btn-send');
  const stopBtn = document.getElementById('btn-stop');
  
  btn.disabled = isGenerating;
  
  // 显示/隐藏停止按钮
  if (stopBtn) {
    if (isGenerating) {
      stopBtn.classList.remove('hidden');
    } else {
      stopBtn.classList.add('hidden');
    }
  }
  
  if (isGenerating) {
    btn.innerHTML = `
      <svg class="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
    `;
  } else {
    btn.innerHTML = `
      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"></path>
      </svg>
    `;
  }
}

// ==================== 显示/隐藏加载指示器 ====================
function showTypingIndicator() {
  const container = document.getElementById('messages');
  const indicator = document.createElement('div');
  indicator.id = 'typing-indicator';
  indicator.className = 'message px-4 py-1';
  indicator.innerHTML = `
    <div class="flex items-start gap-2">
      <div class="text-lg flex-shrink-0">🦐</div>
      <div class="flex items-center gap-1.5 text-gray-400 dark:text-gray-600 pt-1">
        <div class="flex gap-1">
          <span class="w-1.5 h-1.5 bg-gray-400 rounded-full animate-pulse"></span>
          <span class="w-1.5 h-1.5 bg-gray-400 rounded-full animate-pulse" style="animation-delay: 0.2s"></span>
          <span class="w-1.5 h-1.5 bg-gray-400 rounded-full animate-pulse" style="animation-delay: 0.4s"></span>
        </div>
        <span class="text-xs">思考中...</span>
      </div>
    </div>
  `;
  container.appendChild(indicator);
  container.scrollTop = container.scrollHeight;
}

function hideTypingIndicator() {
  const indicator = document.getElementById('typing-indicator');
  if (indicator) indicator.remove();
}

// ==================== 添加错误消息 ====================
function addErrorMessage(errorText) {
  const errorMessage = {
    role: 'error',
    content: `❌ 错误: ${errorText}`,
    timestamp: Date.now()
  };
  messages.push(errorMessage);
  renderMessages();
}

// ==================== 渲染消息列表 ====================
function renderMessages(isStreaming = false) {
  const container = document.getElementById('messages');
  
  if (messages.length === 0) {
    // 显示欢迎界面
    container.innerHTML = `
      <div class="h-full flex items-center justify-center">
        <div class="text-center max-w-md px-4">
          <div class="text-4xl mb-3">🦐</div>
          <h2 class="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-2">欢迎使用晨翼 Agent</h2>
          <p class="text-sm text-gray-500 dark:text-gray-400 mb-4">Hermes AI 助手</p>
          <div class="grid grid-cols-2 gap-1.5">
            <button class="px-2 py-1.5 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-sm transition-colors" onclick="sendQuickMessage('你好，请介绍一下你自己')">
              打个招呼
            </button>
            <button class="px-2 py-1.5 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-sm transition-colors" onclick="sendQuickMessage('帮我写一个Python脚本')">
              写代码
            </button>
          </div>
        </div>
      </div>
    `;
    return;
  }
  
  container.innerHTML = messages.map((msg, index) => {
    const isLastAssistantMessage = msg.role === 'assistant' && 
      (index === messages.length - 1 || messages.slice(index + 1).every(m => m.role !== 'assistant'));
    
    if (msg.role === 'user') {
      // 用户消息 - 右对齐蓝色气泡
      return `
        <div class="message flex justify-end px-4 py-1 group relative">
          <div class="max-w-[70%] bg-blue-500 text-white px-4 py-2 rounded-2xl rounded-br-md">
            ${escapeHtml(msg.content)}
          </div>
          <div class="message-actions opacity-0 group-hover:opacity-100 transition-opacity absolute right-4 -bottom-6 flex gap-1">
            <button onclick="copyMessage(${index})" title="复制" class="px-2 py-1 text-xs bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600">📋</button>
            <button onclick="deleteMessage(${index})" title="删除" class="px-2 py-1 text-xs bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600">🗑️</button>
          </div>
        </div>
      `;
    } else if (msg.role === 'assistant') {
      // AI消息 - 左对齐，带头像
      const content = formatMarkdown(msg.content);
      const cursor = msg.streaming ? '<span class="streaming-cursor"></span>' : '';
      
      return `
        <div class="message px-4 py-1 group relative">
          <div class="flex items-start gap-2 max-w-[85%]">
            <div class="text-lg flex-shrink-0">🦐</div>
            <div class="text-gray-800 dark:text-gray-200 pt-1 markdown-content">
              ${content}${cursor}
            </div>
          </div>
          <div class="message-actions opacity-0 group-hover:opacity-100 transition-opacity absolute left-10 -bottom-6 flex gap-1">
            <button onclick="copyMessage(${index})" title="复制" class="px-2 py-1 text-xs bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600">📋</button>
            ${isLastAssistantMessage && !msg.streaming ? `<button onclick="regenerateMessage(${index})" title="重新生成" class="px-2 py-1 text-xs bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600">🔄</button>` : ''}
            <button onclick="deleteMessage(${index})" title="删除" class="px-2 py-1 text-xs bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600">🗑️</button>
          </div>
        </div>
      `;
    } else if (msg.role === 'error') {
      // 错误消息
      return `
        <div class="message flex justify-center px-4 py-1">
          <div class="text-red-500 dark:text-red-400 text-sm">
            ${escapeHtml(msg.content)}
          </div>
        </div>
      `;
    }
  }).join('');
  
  // 为代码块添加复制按钮
  addCopyButtons(container);
  
  // 滚动到底部
  container.scrollTop = container.scrollHeight;
}

// ==================== 格式化消息（支持Markdown和代码高亮） ====================
function formatMarkdown(text) {
  if (!text) return '';
  
  // 使用marked库渲染Markdown
  if (typeof marked !== 'undefined') {
    try {
      let html = marked.parse(text);
      return html;
    } catch (e) {
      console.error('Markdown解析错误:', e);
    }
  }
  
  // 回退到简单格式化
  return formatMessage(text);
}

// 为代码块添加复制按钮
function addCopyButtons(container) {
  const codeBlocks = container.querySelectorAll('pre');
  codeBlocks.forEach((pre, index) => {
    // 避免重复添加
    if (pre.querySelector('.code-copy-btn')) return;
    
    const btn = document.createElement('button');
    btn.className = 'code-copy-btn';
    btn.textContent = '复制';
    btn.onclick = async () => {
      const code = pre.querySelector('code')?.textContent || pre.textContent;
      try {
        await navigator.clipboard.writeText(code);
        btn.textContent = '已复制!';
        setTimeout(() => btn.textContent = '复制', 2000);
      } catch (e) {
        btn.textContent = '失败';
        setTimeout(() => btn.textContent = '复制', 2000);
      }
    };
    pre.style.position = 'relative';
    pre.appendChild(btn);
  });
}

// 简单格式化（回退方案）
function formatMessage(text) {
  // 简单的Markdown支持
  let html = escapeHtml(text);
  
  // 代码块
  html = html.replace(/```(\w+)?\n([\s\S]+?)```/g, '<pre class="bg-gray-800 text-gray-200 p-3 rounded-lg my-2 overflow-x-auto"><code>$2</code></pre>');
  
  // 行内代码
  html = html.replace(/`([^`]+)`/g, '<code class="bg-gray-300 dark:bg-gray-600 px-1 rounded">$1</code>');
  
  // 粗体
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  
  // 斜体
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  
  // 换行
  html = html.replace(/\n/g, '<br>');
  
  return html;
}

// ==================== 消息操作 ====================
// 复制消息
async function copyMessage(index) {
  const msg = messages[index];
  if (!msg) return;
  
  try {
    await navigator.clipboard.writeText(msg.content);
    showToast('已复制到剪贴板', 'success');
  } catch (e) {
    showToast('复制失败', 'error');
  }
}

// 删除消息
function deleteMessage(index) {
  if (index < 0 || index >= messages.length) return;
  
  if (confirm('确定要删除这条消息吗？')) {
    messages.splice(index, 1);
    renderMessages();
    showToast('消息已删除', 'success');
  }
}

// 重新生成消息
async function regenerateMessage(index) {
  if (index < 0 || index >= messages.length) return;
  if (messages[index].role !== 'assistant') return;
  
  // 找到这条AI消息对应的用户消息（前一条用户消息）
  let userMsgIndex = index - 1;
  while (userMsgIndex >= 0 && messages[userMsgIndex].role !== 'user') {
    userMsgIndex--;
  }
  
  if (userMsgIndex < 0) {
    showToast('找不到对应的用户消息', 'warning');
    return;
  }
  
  // 删除从用户消息之后的所有消息
  messages = messages.slice(0, userMsgIndex);
  renderMessages();
  
  // 重新发送用户消息
  const userMsg = messages[userMsgIndex];
  document.getElementById('message-input').value = userMsg.content;
  await sendMessage();
}

window.copyMessage = copyMessage;
window.deleteMessage = deleteMessage;
window.regenerateMessage = regenerateMessage;

// ==================== HTML转义 ====================
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ==================== Hermes API调用 ====================
// 流式API调用（实际使用非流式，因为hermes CLI不支持流式）
async function callHermesAPIStream(message, onChunk) {
  try {
    // 通过IPC调用主进程的hermes API
    const response = await ipcRenderer.invoke('hermes-chat', message);
    
    // 模拟流式输出效果（逐字显示）
    if (response) {
      const chunks = response.split('');
      for (let i = 0; i < chunks.length; i++) {
        if (streamAbortController?.signal.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }
        onChunk(chunks[i]);
        // 每10个字符暂停一下，模拟打字效果
        if (i % 10 === 0) {
          await new Promise(r => setTimeout(r, 5));
        }
      }
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      throw error;
    }
    throw new Error(`Hermes API调用失败: ${error.message}`);
  }
}

// 非流式API调用（备用）
async function callHermesAPI(message) {
  try {
    // 通过IPC调用主进程的hermes API
    const response = await ipcRenderer.invoke('hermes-chat', message);
    return response;
  } catch (error) {
    throw new Error(`Hermes API调用失败: ${error.message}`);
  }
}

// ==================== 会话管理 ====================
function newSession() {
  messages = [];
  currentSessionId = Date.now();
  renderMessages();
}

window.newSession = newSession;

function saveSession() {
  if (messages.length === 0) return;
  
  const session = {
    id: currentSessionId || Date.now(),
    messages: messages,
    timestamp: Date.now(),
    preview: messages[0]?.content?.substring(0, 50) || '新对话'
  };
  
  // 更新或添加会话
  const index = sessions.findIndex(s => s.id === session.id);
  if (index >= 0) {
    sessions[index] = session;
  } else {
    sessions.unshift(session);
  }
  
  // 保存到localStorage
  localStorage.setItem('chat-sessions', JSON.stringify(sessions.slice(0, 50)));
  
  // 更新侧边栏
  renderSessions();
}

function loadSessions() {
  try {
    const saved = localStorage.getItem('chat-sessions');
    if (saved) {
      sessions = JSON.parse(saved);
      renderSessions();
    }
  } catch (error) {
    console.error('加载会话失败:', error);
  }
}

function renderSessions() {
  const container = document.getElementById('session-list');
  
  if (sessions.length === 0) {
    container.innerHTML = `
      <div class="text-center text-gray-400 dark:text-gray-600 py-8 text-sm">
        暂无历史会话
      </div>
    `;
    return;
  }
  
  container.innerHTML = sessions.map(session => {
    const time = new Date(session.timestamp).toLocaleDateString('zh-CN');
    const isActive = session.id === currentSessionId;
    
    return `
      <div class="group p-3 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer transition-colors ${isActive ? 'bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700' : ''}" onclick="loadSession(${session.id})">
        <div class="flex items-center justify-between gap-2 mb-1">
          <div class="flex items-center gap-2 flex-1 min-w-0">
            <span>🦐</span>
            <span class="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">${session.preview}</span>
          </div>
          <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onclick="event.stopPropagation(); renameSession(${session.id})" class="p-1 hover:bg-gray-200 dark:hover:bg-gray-600 rounded" title="重命名">
              <svg class="w-3.5 h-3.5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>
              </svg>
            </button>
            <button onclick="event.stopPropagation(); deleteSession(${session.id})" class="p-1 hover:bg-red-100 dark:hover:bg-red-900/30 rounded" title="删除">
              <svg class="w-3.5 h-3.5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
              </svg>
            </button>
          </div>
        </div>
        <div class="text-xs text-gray-400 dark:text-gray-600">${time}</div>
      </div>
    `;
  }).join('');
}

// 重命名会话
function renameSession(sessionId) {
  const session = sessions.find(s => s.id === sessionId);
  if (!session) return;
  
  const newName = prompt('请输入新的会话名称:', session.preview);
  if (newName && newName.trim()) {
    session.preview = newName.trim();
    localStorage.setItem('chat-sessions', JSON.stringify(sessions));
    renderSessions();
    showToast('会话已重命名', 'success');
  }
}

window.renameSession = renameSession;

// 删除会话
function deleteSession(sessionId) {
  if (!confirm('确定要删除这个会话吗？')) return;
  
  sessions = sessions.filter(s => s.id !== sessionId);
  localStorage.setItem('chat-sessions', JSON.stringify(sessions));
  
  // 如果删除的是当前会话，创建新会话
  if (sessionId === currentSessionId) {
    newSession();
  }
  
  renderSessions();
  showToast('会话已删除', 'success');
}

window.deleteSession = deleteSession;

function loadSession(sessionId) {
  const session = sessions.find(s => s.id === sessionId);
  if (session) {
    currentSessionId = session.id;
    messages = session.messages;
    
    // 渲染消息
    renderMessages();
    
    // 隐藏侧边栏（可选）
    // toggleSidebar();
  }
}

window.loadSession = loadSession;

// ==================== 侧边栏控制 ====================
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const currentMargin = sidebar.style.marginLeft;
  
  if (currentMargin === '0px' || currentMargin === '') {
    sidebar.style.marginLeft = '-18rem'; // 隐藏 (w-72 = 18rem)
  } else {
    sidebar.style.marginLeft = '0px'; // 显示
  }
}

window.toggleSidebar = toggleSidebar;

// ==================== 左侧导航栏控制 ====================
// 更新导航栏激活状态
function updateNavActive(panelName) {
  // 移除所有激活状态
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.remove('active');
  });
  
  // 添加当前激活状态
  const navItem = document.getElementById(`nav-${panelName}`);
  if (navItem) {
    navItem.classList.add('active');
  }
}

window.updateNavActive = updateNavActive;

// 切换导航栏展开/收缩
function toggleNav() {
  const nav = document.getElementById('main-nav');
  const sidebar = document.getElementById('sidebar');
  const main = document.querySelector('main');
  const isExpanded = nav.getAttribute('data-expanded') === 'true';
  
  // 所有需要同步调整的面板
  const panels = ['dashboard-panel', 'settings-panel', 'tasks-panel', 'phone-panel'];
  
  if (isExpanded) {
    // 收缩
    nav.setAttribute('data-expanded', 'false');
    nav.style.width = '64px';
    nav.classList.remove('w-64');
    nav.classList.add('w-16');
    // 隐藏文字标签
    document.querySelectorAll('.nav-label').forEach(el => el.classList.add('hidden'));
    if (sidebar) sidebar.style.left = '64px';
    if (main) main.style.marginLeft = '64px';
    // 同步面板宽度
    panels.forEach(id => {
      const panel = document.getElementById(id);
      if (panel) panel.style.left = '64px';
    });
  } else {
    // 展开
    nav.setAttribute('data-expanded', 'true');
    nav.style.width = '256px';
    nav.classList.remove('w-16');
    nav.classList.add('w-64');
    // 显示文字标签
    document.querySelectorAll('.nav-label').forEach(el => el.classList.remove('hidden'));
    if (sidebar) sidebar.style.left = '256px';
    if (main) main.style.marginLeft = '256px';
    // 同步面板宽度
    panels.forEach(id => {
      const panel = document.getElementById(id);
      if (panel) panel.style.left = '256px';
    });
  }
}

window.toggleNav = toggleNav;

// ==================== 统一的面板管理 ====================
// 面板配置
const panelConfig = {
  chat: { id: 'chat-panel', show: null, hide: null },
  dashboard: { id: 'dashboard-panel', show: showDashboardPanel, hide: hideDashboardPanel },
  settings: { id: 'settings-panel', show: showSettingsPanel, hide: hideSettingsPanel },
  tasks: { id: 'tasks-panel', show: showTasksPanel, hide: hideTasksPanel },
  phone: { id: 'phone-panel', show: showPhonePanel, hide: hidePhonePanel }
};

// 当前显示的面板
let currentPanel = 'chat';

// 统一显示面板函数
function showPanel(panelName) {
  // 先隐藏所有面板
  hideAllPanels();
  
  // 更新导航栏激活状态
  updateNavActive(panelName);
  
  // 显示指定面板
  if (panelName === 'chat') {
    // 聊天面板是默认的，不需要特殊处理
    currentPanel = 'chat';
    return;
  }
  
  const config = panelConfig[panelName];
  if (config) {
    const panel = document.getElementById(config.id);
    if (panel) {
      panel.classList.remove('hidden');
      currentPanel = panelName;
      
      // 执行面板特定的显示逻辑
      if (config.show) {
        config.show();
      }
    }
  }
}

window.showPanel = showPanel;

// 隐藏所有面板
function hideAllPanels() {
  Object.keys(panelConfig).forEach(key => {
    if (key === 'chat') return; // 跳过聊天面板
    
    const config = panelConfig[key];
    const panel = document.getElementById(config.id);
    if (panel) {
      panel.classList.add('hidden');
      
      // 执行面板特定的隐藏逻辑
      if (config.hide) {
        config.hide();
      }
    }
  });
  
  currentPanel = 'chat';
}

window.hideAllPanels = hideAllPanels;

// ==================== 仪表盘功能 ====================
let dashboardRefreshInterval = null;

// 显示仪表盘面板（内部函数）
function showDashboardPanel() {
  // 刷新仪表盘数据
  refreshDashboard();
  
  // 设置定时刷新（每5秒）
  if (dashboardRefreshInterval) {
    clearInterval(dashboardRefreshInterval);
  }
  dashboardRefreshInterval = setInterval(refreshDashboard, 5000);
}

// 隐藏仪表盘面板（内部函数）
function hideDashboardPanel() {
  // 停止定时刷新
  if (dashboardRefreshInterval) {
    clearInterval(dashboardRefreshInterval);
    dashboardRefreshInterval = null;
  }
}

// 显示仪表盘（兼容旧API）
function showDashboard() {
  showPanel('dashboard');
}

window.showDashboard = showDashboard;

// 隐藏仪表盘（兼容旧API）
function hideDashboard() {
  hideAllPanels();
}

window.hideDashboard = hideDashboard;

// 刷新仪表盘数据
async function refreshDashboard() {
  // 检查各服务状态
  await checkServiceStatus('hermes');
  await checkServiceStatus('phone');
  await checkServiceStatus('droidpilot');
  
  // 更新首页手机状态
  updateHomePhoneStatus();
  
  // 获取系统资源
  await updateSystemResources();
}

// 更新首页手机状态
function updateHomePhoneStatus() {
  const statusEl = document.getElementById('home-phone-status');
  if (!statusEl) return;
  
  if (pcwlConnected) {
    statusEl.innerHTML = `<span class="inline-block w-2 h-2 rounded-full bg-green-400 mr-1"></span>在线 · ${pcwlDeviceInfo?.model || 'realme RMX3888'}`;
  } else {
    statusEl.innerHTML = `<span class="inline-block w-2 h-2 rounded-full bg-gray-400 mr-1"></span>离线`;
  }
}

// 从首页发送AI消息
function sendHomeAiMessage() {
  const input = document.getElementById('home-ai-input');
  if (!input || !input.value.trim()) return;
  
  const message = input.value.trim();
  input.value = '';
  
  // 切换到AI助手面板并发送消息
  showPanel('chat');
  
  // 延迟发送，等待面板切换完成
  setTimeout(() => {
    const chatInput = document.getElementById('message-input');
    if (chatInput) {
      chatInput.value = message;
      // 触发发送
      const sendBtn = document.querySelector('button[onclick="sendMessage()"]');
      if (sendBtn) sendBtn.click();
    }
  }, 100);
}

window.sendHomeAiMessage = sendHomeAiMessage;

window.refreshDashboard = refreshDashboard;

// 检查服务状态
async function checkServiceStatus(service) {
  const statusEl = document.getElementById(`${service}-status`);
  const toggleEl = document.getElementById(`${service}-toggle`);
  const indicatorEl = document.getElementById(`${service}-indicator`);
  
  try {
    const status = await ipcRenderer.invoke('check-service-status', service);
    
    if (status.running) {
      statusEl.textContent = '运行中';
      statusEl.className = 'text-xs px-3 py-1 rounded-full bg-white/30 text-white backdrop-blur-sm';
      toggleEl.textContent = '停止';
      toggleEl.className = 'text-xs px-4 py-1.5 bg-white/90 hover:bg-white text-red-600 font-medium rounded-lg transition-all shadow-sm hover:shadow';
      // 更新指示器为绿色脉冲
      if (indicatorEl) {
        indicatorEl.className = 'w-3 h-3 rounded-full bg-green-400 animate-pulse shadow-lg shadow-green-400/50';
      }
    } else {
      statusEl.textContent = '未运行';
      statusEl.className = 'text-xs px-3 py-1 rounded-full bg-white/20 text-white backdrop-blur-sm';
      toggleEl.textContent = service === 'phone' ? '连接' : '启动';
      // 根据服务类型设置按钮颜色
      const colorMap = {
        hermes: 'blue',
        phone: 'green',
        droidpilot: 'purple'
      };
      const color = colorMap[service] || 'blue';
      toggleEl.className = `text-xs px-4 py-1.5 bg-white/90 hover:bg-white text-${color}-600 font-medium rounded-lg transition-all shadow-sm hover:shadow`;
      // 更新指示器为灰色
      if (indicatorEl) {
        indicatorEl.className = 'w-3 h-3 rounded-full bg-gray-300 animate-pulse';
      }
    }
  } catch (error) {
    console.error(`检查${service}状态失败:`, error);
    statusEl.textContent = '检测失败';
    statusEl.className = 'text-xs px-3 py-1 rounded-full bg-red-400/50 text-white backdrop-blur-sm';
    // 更新指示器为红色
    if (indicatorEl) {
      indicatorEl.className = 'w-3 h-3 rounded-full bg-red-400 animate-pulse';
    }
  }
}

// 切换服务状态
async function toggleService(service) {
  const toggleEl = document.getElementById(`${service}-toggle`);
  const statusEl = document.getElementById(`${service}-status`);
  const currentText = toggleEl.textContent.trim();
  
  // 根据当前按钮文本决定操作
  let action;
  if (service === 'phone') {
    action = currentText === '连接' ? 'start' : 'stop';
  } else {
    action = currentText === '启动' ? 'start' : 'stop';
  }
  
  toggleEl.disabled = true;
  toggleEl.textContent = '处理中...';
  
  try {
    const result = await ipcRenderer.invoke('toggle-service', { serviceName: service, action });
    console.log(`${service} ${action}操作结果:`, result);
    
    if (result.success) {
      const actionText = action === 'start' ? (service === 'phone' ? '连接成功' : '启动成功') : '停止成功';
      showToast(`${getServiceName(service)} ${actionText}`, 'success');
      // 延迟刷新状态
      setTimeout(() => checkServiceStatus(service), 1000);
    } else {
      showToast(`${getServiceName(service)} 操作失败: ${result.error || '未知错误'}`, 'error');
      toggleEl.textContent = currentText;
    }
  } catch (error) {
    console.error(`切换${service}状态失败:`, error);
    showToast(`${getServiceName(service)} 操作失败: ${error.message}`, 'error');
    toggleEl.textContent = currentText;
  } finally {
    toggleEl.disabled = false;
  }
}

// 获取服务显示名称
function getServiceName(service) {
  const nameMap = {
    hermes: 'Hermes Gateway',
    phone: '手机连接',
    droidpilot: 'DroidPilot'
  };
  return nameMap[service] || service;
}

// ==================== 手机连接页面功能 ====================

// DroidPilot MCP 服务控制
async function toggleDroidPilotService() {
  const btn = document.getElementById('droidpilot-toggle-btn');
  const indicator = document.getElementById('droidpilot-service-indicator');
  const status = document.getElementById('droidpilot-service-status');
  const isRunning = btn.textContent.includes('停止');
  
  btn.disabled = true;
  btn.textContent = '处理中...';
  
  try {
    if (isRunning) {
      // 停止服务
      await ipcRenderer.invoke('toggle-service', { serviceName: 'droidpilot', action: 'stop' });
      indicator.className = 'w-3 h-3 rounded-full bg-gray-400';
      status.textContent = '已停止';
      btn.textContent = '启动服务';
      btn.className = btn.className.replace('bg-red-500 hover:bg-red-600', 'bg-purple-500 hover:bg-purple-600');
      showToast('DroidPilot 服务已停止', 'success');
    } else {
      // 启动服务
      await ipcRenderer.invoke('toggle-service', { serviceName: 'droidpilot', action: 'start' });
      indicator.className = 'w-3 h-3 rounded-full bg-green-500 animate-pulse';
      status.textContent = '运行中';
      btn.textContent = '停止服务';
      btn.className = btn.className.replace('bg-purple-500 hover:bg-purple-600', 'bg-red-500 hover:bg-red-600');
      showToast('DroidPilot 服务已启动', 'success');
    }
  } catch (e) {
    showToast('操作失败: ' + e.message, 'error');
    btn.textContent = isRunning ? '停止服务' : '启动服务';
  } finally {
    btn.disabled = false;
  }
}

// 手机截图
async function phoneScreenshot() {
  showToast('正在截图...', 'info');
  try {
    const result = await ipcRenderer.invoke('phone-action', 'screenshot');
    if (result.success) {
      showToast('截图成功', 'success');
    } else {
      showToast('截图失败: ' + result.error, 'error');
    }
  } catch (e) {
    showToast('截图失败', 'error');
  }
}

// 刷新UI树
async function phoneRefreshUI() {
  showToast('正在刷新UI...', 'info');
  try {
    const result = await ipcRenderer.invoke('phone-action', 'refresh_ui');
    if (result.success) {
      showToast('UI刷新成功', 'success');
    } else {
      showToast('刷新失败: ' + result.error, 'error');
    }
  } catch (e) {
    showToast('刷新失败', 'error');
  }
}

// 打开应用
async function phoneOpenApp() {
  const appName = prompt('请输入应用包名:', 'com.android.settings');
  if (!appName) return;
  
  showToast('正在打开应用...', 'info');
  try {
    const result = await ipcRenderer.invoke('phone-action', { action: 'open_app', package: appName });
    if (result.success) {
      showToast('应用已打开', 'success');
    } else {
      showToast('打开失败: ' + result.error, 'error');
    }
  } catch (e) {
    showToast('操作失败', 'error');
  }
}

// Shell命令
async function phoneShell() {
  const cmd = prompt('请输入Shell命令:', 'ls /sdcard');
  if (!cmd) return;
  
  showToast('执行命令中...', 'info');
  try {
    const result = await ipcRenderer.invoke('phone-action', { action: 'shell', command: cmd });
    if (result.success) {
      showToast('命令执行成功', 'success');
      console.log('Shell结果:', result.output);
    } else {
      showToast('执行失败: ' + result.error, 'error');
    }
  } catch (e) {
    showToast('执行失败', 'error');
  }
}

// Toast 提示函数
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  
  const bgColor = {
    success: 'bg-green-500',
    error: 'bg-red-500',
    info: 'bg-blue-500',
    warning: 'bg-yellow-500'
  }[type] || 'bg-blue-500';
  
  const icon = {
    success: '✓',
    error: '✕',
    info: 'ℹ',
    warning: '⚠'
  }[type] || 'ℹ';
  
  const toast = document.createElement('div');
  toast.className = `${bgColor} text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 pointer-events-auto transform translate-x-full transition-transform duration-300`;
  toast.innerHTML = `
    <span class="text-lg font-bold">${icon}</span>
    <span>${message}</span>
  `;
  
  container.appendChild(toast);
  
  // 动画进入
  requestAnimationFrame(() => {
    toast.classList.remove('translate-x-full');
    toast.classList.add('translate-x-0');
  });
  
  // 3秒后自动消失
  setTimeout(() => {
    toast.classList.remove('translate-x-0');
    toast.classList.add('translate-x-full');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

window.toggleService = toggleService;

// 启动所有服务
async function startAllServices() {
  const services = ['hermes', 'droidpilot'];
  for (const service of services) {
    try {
      const result = await ipcRenderer.invoke('toggle-service', { serviceName: service, action: 'start' });
      if (result.success) {
        showToast(`${getServiceName(service)} 启动成功`, 'success');
      } else {
        showToast(`${getServiceName(service)} 启动失败`, 'error');
      }
    } catch (error) {
      console.error(`启动${service}失败:`, error);
      showToast(`${getServiceName(service)} 启动失败: ${error.message}`, 'error');
    }
  }
  setTimeout(refreshDashboard, 1500);
}

window.startAllServices = startAllServices;

// 停止所有服务
async function stopAllServices() {
  const services = ['hermes', 'droidpilot'];
  for (const service of services) {
    try {
      const result = await ipcRenderer.invoke('toggle-service', { serviceName: service, action: 'stop' });
      if (result.success) {
        showToast(`${getServiceName(service)} 已停止`, 'success');
      } else {
        showToast(`${getServiceName(service)} 停止失败`, 'error');
      }
    } catch (error) {
      console.error(`停止${service}失败:`, error);
      showToast(`${getServiceName(service)} 停止失败: ${error.message}`, 'error');
    }
  }
  setTimeout(refreshDashboard, 1500);
}

window.stopAllServices = stopAllServices;

// 更新系统资源显示
async function updateSystemResources() {
  try {
    const resources = await ipcRenderer.invoke('get-system-resources');
    
    if (resources) {
      // 圆形进度条周长 (2 * π * 56)
      const circumference = 351.86;
      
      // CPU
      if (resources.cpu && resources.cpu.usage !== undefined) {
        const cpuUsage = resources.cpu.usage;
        document.getElementById('cpu-percent').textContent = `${cpuUsage}%`;
        const offset = circumference * (1 - Math.min(cpuUsage, 100) / 100);
        const cpuCircle = document.getElementById('cpu-circle');
        if (cpuCircle) cpuCircle.style.strokeDashoffset = offset;
      }
      
      // 内存
      if (resources.memory && resources.memory.usage !== undefined) {
        const memUsage = resources.memory.usage;
        document.getElementById('memory-percent').textContent = `${memUsage}%`;
        const offset = circumference * (1 - Math.min(memUsage, 100) / 100);
        const memCircle = document.getElementById('memory-circle');
        if (memCircle) memCircle.style.strokeDashoffset = offset;
      }
      
      // 磁盘
      if (resources.disk && resources.disk.usage !== undefined) {
        const diskUsage = resources.disk.usage;
        document.getElementById('disk-percent').textContent = `${diskUsage}%`;
        const offset = circumference * (1 - Math.min(diskUsage, 100) / 100);
        const diskCircle = document.getElementById('disk-circle');
        if (diskCircle) diskCircle.style.strokeDashoffset = offset;
      }
    }
  } catch (error) {
    console.error('获取系统资源失败:', error);
    showToast('获取系统资源失败', 'error');
  }
}

// ==================== 设置面板功能 ====================
// 显示设置面板（内部函数）
function showSettingsPanel() {
  // 加载保存的设置
  loadSettings();
  
  // 更新主题复选框状态
  updateThemeCheckbox();
}

// 隐藏设置面板（内部函数）
function hideSettingsPanel() {
  // 可选：离开面板时自动保存
  // saveSettings();
}

// 更新主题复选框状态
function updateThemeCheckbox() {
  const checkbox = document.getElementById('settings-theme-checkbox');
  const statusText = document.getElementById('theme-status-text');
  
  if (checkbox && statusText) {
    const isDark = document.documentElement.classList.contains('dark');
    checkbox.checked = isDark;
    statusText.textContent = isDark ? '深色' : '浅色';
  }
}

// 显示设置面板（兼容旧API）
function showSettings() {
  showPanel('settings');
}

window.showSettings = showSettings;

// 隐藏设置面板（兼容旧API）
function hideSettings() {
  hideAllPanels();
}

window.hideSettings = hideSettings;

// 加载设置
function loadSettings() {
  try {
    const savedSettings = localStorage.getItem('app-settings');
    if (savedSettings) {
      const settings = JSON.parse(savedSettings);
      
      // Hermes配置
      if (settings.hermesModel) {
        document.getElementById('settings-hermes-model').value = settings.hermesModel;
      }
      if (settings.hermesApi) {
        document.getElementById('settings-hermes-api').value = settings.hermesApi;
      }
      
      console.log('设置已加载');
    }
    
    // 更新主题复选框状态
    updateThemeCheckbox();
  } catch (error) {
    console.error('加载设置失败:', error);
  }
}

// 保存设置
function saveSettings() {
  try {
    const settings = {
      hermesModel: document.getElementById('settings-hermes-model').value,
      hermesApi: document.getElementById('settings-hermes-api').value
    };
    
    localStorage.setItem('app-settings', JSON.stringify(settings));
    console.log('设置已保存');
    return true;
  } catch (error) {
    console.error('保存设置失败:', error);
    return false;
  }
}

// 带反馈的保存设置
function saveSettingsWithFeedback() {
  const success = saveSettings();
  
  if (success) {
    // 显示成功提示
    showToast('设置已保存', 'success');
  } else {
    showToast('保存失败，请重试', 'error');
  }
}

window.saveSettingsWithFeedback = saveSettingsWithFeedback;

// 重置设置为默认值
function resetSettings() {
  try {
    // 默认设置
    const defaultSettings = {
      hermesModel: 'glm-4-flash',
      hermesApi: 'http://localhost:8080'
    };
    
    // 更新输入框
    document.getElementById('settings-hermes-model').value = defaultSettings.hermesModel;
    document.getElementById('settings-hermes-api').value = defaultSettings.hermesApi;
    
    // 保存到localStorage
    localStorage.setItem('app-settings', JSON.stringify(defaultSettings));
    
    showToast('已重置为默认设置', 'info');
  } catch (error) {
    console.error('重置设置失败:', error);
    showToast('重置失败', 'error');
  }
}

window.resetSettings = resetSettings;

// 显示Toast提示
function showToast(message, type = 'info') {
  // 移除已存在的toast
  const existingToast = document.getElementById('settings-toast');
  if (existingToast) {
    existingToast.remove();
  }
  
  // 创建toast元素
  const toast = document.createElement('div');
  toast.id = 'settings-toast';
  
  // 根据类型设置样式
  const typeStyles = {
    success: 'bg-green-500',
    error: 'bg-red-500',
    info: 'bg-blue-500',
    warning: 'bg-yellow-500'
  };
  
  const typeIcons = {
    success: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>',
    error: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>',
    info: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>',
    warning: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>'
  };
  
  toast.className = `fixed bottom-6 right-6 flex items-center gap-2 px-4 py-3 ${typeStyles[type]} text-white rounded-lg shadow-lg transform transition-all duration-300 z-50`;
  toast.innerHTML = `${typeIcons[type]}<span class="font-medium">${message}</span>`;
  
  document.body.appendChild(toast);
  
  // 动画进入
  setTimeout(() => {
    toast.classList.add('translate-y-0', 'opacity-100');
  }, 10);
  
  // 3秒后自动消失
  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-y-2');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

window.showToast = showToast;

// 获取当前设置
function getSettings() {
  try {
    const savedSettings = localStorage.getItem('app-settings');
    if (savedSettings) {
      return JSON.parse(savedSettings);
    }
  } catch (error) {
    console.error('获取设置失败:', error);
  }
  
  // 返回默认设置
  return {
    hermesModel: 'glm-4-flash',
    hermesApi: 'http://localhost:8080'
  };
}

window.getSettings = getSettings;

// ==================== 任务调度功能 ====================
let editingTaskId = null; // 当前编辑的任务ID

// 显示任务面板（内部函数）
async function showTasksPanel() {
  // 加载任务列表
  await loadTasks();
}

// 隐藏任务面板（内部函数）
function hideTasksPanel() {
  // 无需特殊处理
}

// 显示任务面板（兼容旧API）
async function showTasks() {
  showPanel('tasks');
}

window.showTasks = showTasks;

// 隐藏任务面板（兼容旧API）
function hideTasks() {
  hideAllPanels();
}

window.hideTasks = hideTasks;

// 加载任务列表
async function loadTasks() {
  const container = document.getElementById('tasks-list');
  
  try {
    const result = await ipcRenderer.invoke('get-cron-jobs');
    
    if (result.success && result.jobs && result.jobs.length > 0) {
      container.innerHTML = result.jobs.map(job => renderTaskItem(job)).join('');
    } else if (result.success) {
      container.innerHTML = `
        <div class="p-8 text-center text-gray-400 dark:text-gray-600">
          <span class="text-3xl mb-2 block">📋</span>
          <p>暂无定时任务</p>
          <p class="text-sm mt-1">点击上方"添加任务"按钮创建新任务</p>
        </div>
      `;
    } else {
      container.innerHTML = `
        <div class="p-8 text-center text-red-500">
          <p>加载失败: ${result.error || '未知错误'}</p>
        </div>
      `;
    }
  } catch (error) {
    container.innerHTML = `
      <div class="p-8 text-center text-red-500">
        <p>加载失败: ${error.message}</p>
      </div>
    `;
  }
}

// 渲染单个任务项
function renderTaskItem(job) {
  const statusClass = job.enabled 
    ? 'bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800' 
    : 'bg-gray-100 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-600';
  const statusText = job.enabled ? '已启用' : '已禁用';
  const cardBgClass = job.enabled 
    ? 'bg-white dark:bg-gray-800 border-blue-100 dark:border-blue-900/50' 
    : 'bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700';
  const hoverShadow = job.enabled 
    ? 'hover:shadow-lg hover:shadow-blue-100/50 dark:hover:shadow-blue-900/20' 
    : 'hover:shadow-lg';
  
  return `
    <div class="group relative ${cardBgClass} rounded-xl p-4 border transition-all duration-300 ${hoverShadow} hover:-translate-y-0.5 hover:border-blue-300 dark:hover:border-blue-700">
      <!-- 状态指示条 -->
      <div class="absolute left-0 top-4 bottom-4 w-1 rounded-full ${job.enabled ? 'bg-gradient-to-b from-blue-500 to-indigo-500' : 'bg-gray-300 dark:bg-gray-600'}"></div>
      
      <div class="flex items-start justify-between gap-4 ml-3">
        <!-- 左侧内容 -->
        <div class="flex-1 min-w-0">
          <!-- 标题行 -->
          <div class="flex items-center gap-2 mb-2">
            <h4 class="font-semibold text-gray-800 dark:text-gray-200 truncate">${escapeHtml(job.name)}</h4>
            <span class="text-xs px-2.5 py-1 rounded-full ${statusClass} font-medium">${statusText}</span>
          </div>
          
          <!-- Cron表达式和命令 -->
          <div class="flex flex-wrap items-center gap-2 mb-2">
            <div class="flex items-center gap-1.5 bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-900/30 dark:to-purple-900/30 px-3 py-1.5 rounded-lg border border-indigo-100 dark:border-indigo-800">
              <svg class="w-4 h-4 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
              </svg>
              <code class="text-sm font-mono text-indigo-700 dark:text-indigo-300">${escapeHtml(job.cron)}</code>
            </div>
            <svg class="w-4 h-4 text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7l5 5m0 0l-5 5m5-5H6"></path>
            </svg>
            <div class="flex items-center gap-1.5 bg-gradient-to-r from-blue-50 to-cyan-50 dark:from-blue-900/30 dark:to-cyan-900/30 px-3 py-1.5 rounded-lg border border-blue-100 dark:border-blue-800">
              <svg class="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
              </svg>
              <code class="text-sm text-blue-700 dark:text-blue-300 truncate max-w-[200px]">${escapeHtml(job.command)}</code>
            </div>
          </div>
          
          <!-- 描述 -->
          ${job.description ? `
            <p class="text-sm text-gray-500 dark:text-gray-400 flex items-start gap-1.5">
              <svg class="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
              </svg>
              <span class="line-clamp-2">${escapeHtml(job.description)}</span>
            </p>
          ` : ''}
        </div>
        
        <!-- 右侧操作按钮 -->
        <div class="flex items-center gap-1.5 opacity-60 group-hover:opacity-100 transition-opacity">
          <button onclick="toggleTask('${job.id}')" 
            class="p-2 rounded-lg ${job.enabled 
              ? 'bg-green-100 dark:bg-green-900/30 hover:bg-green-200 dark:hover:bg-green-800/50 text-green-600 dark:text-green-400' 
              : 'bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-500 dark:text-gray-400'} 
            transition-all duration-200 hover:scale-110 active:scale-95" 
            title="${job.enabled ? '点击禁用' : '点击启用'}">
            ${job.enabled 
              ? '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>'
              : '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>'
            }
          </button>
          <button onclick="editTask('${job.id}')" 
            class="p-2 rounded-lg bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-800/50 text-blue-600 dark:text-blue-400 transition-all duration-200 hover:scale-110 active:scale-95" 
            title="编辑任务">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>
            </svg>
          </button>
          <button onclick="deleteTask('${job.id}')" 
            class="p-2 rounded-lg bg-red-50 dark:bg-red-900/30 hover:bg-red-100 dark:hover:bg-red-800/50 text-red-500 dark:text-red-400 transition-all duration-200 hover:scale-110 active:scale-95" 
            title="删除任务">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
            </svg>
          </button>
        </div>
      </div>
    </div>
  `;
}

// 显示添加任务模态框
function showAddTaskModal() {
  editingTaskId = null;
  document.getElementById('task-modal-title').textContent = '添加任务';
  document.getElementById('task-name').value = '';
  document.getElementById('task-cron').value = '';
  document.getElementById('task-command').value = '';
  document.getElementById('task-description').value = '';
  document.getElementById('task-modal').classList.remove('hidden');
}

window.showAddTaskModal = showAddTaskModal;

// 隐藏任务模态框
function hideTaskModal() {
  document.getElementById('task-modal').classList.add('hidden');
  editingTaskId = null;
}

window.hideTaskModal = hideTaskModal;

// 编辑任务
async function editTask(taskId) {
  try {
    const result = await ipcRenderer.invoke('get-cron-jobs');
    if (result.success && result.jobs) {
      const job = result.jobs.find(j => j.id === taskId);
      if (job) {
        editingTaskId = taskId;
        document.getElementById('task-modal-title').textContent = '编辑任务';
        document.getElementById('task-name').value = job.name || '';
        document.getElementById('task-cron').value = job.cron || '';
        document.getElementById('task-command').value = job.command || '';
        document.getElementById('task-description').value = job.description || '';
        document.getElementById('task-modal').classList.remove('hidden');
      }
    }
  } catch (error) {
    console.error('加载任务失败:', error);
    alert('加载任务失败: ' + error.message);
  }
}

window.editTask = editTask;

// 保存任务
async function saveTask() {
  const name = document.getElementById('task-name').value.trim();
  const cron = document.getElementById('task-cron').value.trim();
  const command = document.getElementById('task-command').value.trim();
  const description = document.getElementById('task-description').value.trim();
  
  if (!name) {
    alert('请输入任务名称');
    return;
  }
  if (!cron) {
    alert('请输入Cron表达式');
    return;
  }
  if (!command) {
    alert('请输入执行命令');
    return;
  }
  
  // 简单的cron表达式验证
  const cronParts = cron.split(/\s+/);
  if (cronParts.length < 5) {
    alert('Cron表达式格式错误，应为5或6个字段（分 时 日 月 周）');
    return;
  }
  
  const task = {
    id: editingTaskId || `task-${Date.now()}`,
    name,
    cron,
    command,
    description,
    enabled: true
  };
  
  try {
    // 传递正确的参数格式 {schedule, command}
    const result = await ipcRenderer.invoke('add-cron-job', { 
      schedule: cron, 
      command: command 
    });
    if (result.success) {
      hideTaskModal();
      await loadTasks();
    } else {
      alert('保存失败: ' + (result.error || '未知错误'));
    }
  } catch (error) {
    alert('保存失败: ' + error.message);
  }
}

window.saveTask = saveTask;

// 删除任务
async function deleteTask(taskId) {
  if (!confirm('确定要删除这个任务吗？')) {
    return;
  }
  
  try {
    const result = await ipcRenderer.invoke('remove-cron-job', { jobId: taskId });
    if (result.success) {
      await loadTasks();
    } else {
      alert('删除失败: ' + (result.error || '未知错误'));
    }
  } catch (error) {
    alert('删除失败: ' + error.message);
  }
}

window.deleteTask = deleteTask;

// 切换任务启用状态
async function toggleTask(taskId) {
  try {
    const result = await ipcRenderer.invoke('get-cron-jobs');
    if (result.success && result.jobs) {
      const job = result.jobs.find(j => j.id === taskId);
      if (job) {
        const updatedJob = { ...job, enabled: !job.enabled };
        const updateResult = await ipcRenderer.invoke('add-cron-job', updatedJob);
        if (updateResult.success) {
          await loadTasks();
        } else {
          alert('操作失败: ' + (updateResult.error || '未知错误'));
        }
      }
    }
  } catch (error) {
    alert('操作失败: ' + error.message);
  }
}

window.toggleTask = toggleTask;

// ==================== 手机连接功能 ====================
// 手机连接状态
let phoneConnectionState = {
  connected: false,
  connecting: false,
  deviceInfo: null
};

// 显示手机面板（内部函数）
function showPhonePanel() {
  // 初始化UI状态
  initPhonePanelUI();
  // 刷新手机状态
  refreshPhoneStatus();
}

// 初始化手机面板UI
function initPhonePanelUI() {
  const card = document.getElementById('phone-device-card');
  const animation = document.getElementById('phone-connecting-animation');
  
  // 重置连接动画
  if (animation) {
    animation.classList.add('hidden');
  }
  
  // 如果未连接，显示占位信息
  if (!phoneConnectionState.connected && !phoneConnectionState.connecting) {
    updateDeviceCardPlaceholder();
  }
}

// 更新设备卡片占位信息
function updateDeviceCardPlaceholder() {
  const modelEl = document.getElementById('phone-device-model');
  const osEl = document.getElementById('phone-device-os');
  const batteryPercent = document.getElementById('phone-battery-percent');
  const batteryBar = document.getElementById('phone-battery-bar');
  const storageText = document.getElementById('phone-storage-text');
  const storageBar = document.getElementById('phone-storage-bar');
  const connStatus = document.getElementById('phone-conn-status');
  
  if (modelEl) modelEl.textContent = '等待连接...';
  if (osEl) osEl.textContent = '系统版本: --';
  if (batteryPercent) batteryPercent.textContent = '--%';
  if (batteryBar) {
    batteryBar.style.width = '0%';
    batteryBar.className = 'bg-gray-400 h-2 rounded-full transition-all duration-500';
  }
  if (storageText) storageText.textContent = '-- / --';
  if (storageBar) storageBar.style.width = '0%';
  if (connStatus) {
    connStatus.textContent = '未连接';
    connStatus.className = 'text-xs px-2 py-1 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400';
  }
}

// 更新设备卡片信息
function updateDeviceCard(deviceInfo) {
  console.log('updateDeviceCard被调用，参数:', deviceInfo);
  if (!deviceInfo) {
    console.log('deviceInfo为空，返回');
    return;
  }
  
  const modelEl = document.getElementById('phone-device-model');
  const osEl = document.getElementById('phone-device-os');
  const batteryPercent = document.getElementById('phone-battery-percent');
  const batteryBar = document.getElementById('phone-battery-bar');
  const storageText = document.getElementById('phone-storage-text');
  const storageBar = document.getElementById('phone-storage-bar');
  const connStatus = document.getElementById('phone-conn-status');
  
  console.log('找到的元素:', { modelEl, osEl, connStatus });
  
  if (modelEl) modelEl.textContent = deviceInfo.model || '未知设备';
  if (osEl) osEl.textContent = deviceInfo.os ? `系统版本: ${deviceInfo.os}` : '系统版本: --';
  if (connStatus) {
    connStatus.textContent = '已连接';
    connStatus.className = 'text-xs px-2 py-1 rounded-full bg-green-100 dark:bg-green-900 text-green-600 dark:text-green-400';
  }
  
  // 电量（如果有）
  if (deviceInfo.battery) {
    const battery = parseInt(deviceInfo.battery) || 0;
    if (batteryPercent) batteryPercent.textContent = `${battery}%`;
    if (batteryBar) {
      batteryBar.style.width = `${battery}%`;
      batteryBar.className = battery > 20 ? 'bg-green-500 h-2 rounded-full transition-all duration-500' : 'bg-red-500 h-2 rounded-full transition-all duration-500';
    }
  }
  
  // 存储（如果有）
  if (deviceInfo.storage) {
    if (storageText) storageText.textContent = deviceInfo.storage;
    if (storageBar && deviceInfo.storagePercent) {
      storageBar.style.width = `${deviceInfo.storagePercent}%`;
    }
  }
}

// 隐藏手机面板（内部函数）
function hidePhonePanel() {
  // 清理定时器等资源
  phoneConnectionState.connecting = false;
}

// 显示手机面板（兼容旧API）
function showPhonePanelOld() {
  showPanel('phone');
}

// ==================== 连接方式切换 ====================

// 切换连接方式Tab
function switchConnectMode(mode) {
  // 更新Tab样式
  const tabs = document.querySelectorAll('.connect-tab');
  tabs.forEach(tab => {
    if (tab.dataset.mode === mode) {
      tab.classList.add('active', 'text-blue-600', 'border-blue-600', 'dark:text-blue-400', 'dark:border-blue-400');
      tab.classList.remove('text-gray-500', 'border-transparent', 'dark:text-gray-400');
    } else {
      tab.classList.remove('active', 'text-blue-600', 'border-blue-600', 'dark:text-blue-400', 'dark:border-blue-400');
      tab.classList.add('text-gray-500', 'border-transparent', 'dark:text-gray-400');
    }
  });

  // 切换内容区域
  const pcwlPanel = document.getElementById('pcwl-connect-panel');
  const adbPanel = document.getElementById('adb-connect-panel');
  const sshPanel = document.getElementById('ssh-connect-panel');

  if (pcwlPanel) pcwlPanel.classList.add('hidden');
  if (adbPanel) adbPanel.classList.add('hidden');
  if (sshPanel) sshPanel.classList.add('hidden');

  if (mode === 'pcwl' && pcwlPanel) {
    pcwlPanel.classList.remove('hidden');
  } else if (mode === 'adb' && adbPanel) {
    adbPanel.classList.remove('hidden');
  } else if (mode === 'ssh' && sshPanel) {
    sshPanel.classList.remove('hidden');
  }

  // 保存当前选择的连接方式
  localStorage.setItem('connectMode', mode);
}

// 鹏程万里自动连接开关状态
let pcwlAutoConnectEnabled = false;

// 切换鹏程万里自动连接
async function toggleAutoConnect() {
  const toggle = document.getElementById('pcwl-auto-toggle');
  
  pcwlAutoConnectEnabled = !pcwlAutoConnectEnabled;
  
  if (toggle) {
    if (pcwlAutoConnectEnabled) {
      toggle.classList.add('bg-blue-600');
      toggle.classList.remove('bg-green-500', 'hover:bg-green-600', 'bg-green-600');
      toggle.textContent = '连接中...';
      
      // 尝试自动连接
      await connectPCWL(true);
      
      // 连接完成后更新按钮文本
      if (phoneConnectionState.connected) {
        toggle.textContent = '已连接 ✓';
      } else {
        toggle.textContent = '启动自动连接';
        toggle.classList.remove('bg-blue-600');
        toggle.classList.add('bg-green-500', 'hover:bg-green-600');
        pcwlAutoConnectEnabled = false;
      }
    } else {
      toggle.classList.remove('bg-blue-600', 'bg-green-600');
      toggle.classList.add('bg-green-500', 'hover:bg-green-600');
      toggle.textContent = '启动自动连接';
    }
  }
  
  localStorage.setItem('pcwlAutoConnect', pcwlAutoConnectEnabled);
}

// 显示已连接状态的功能区域
function showConnectedFeatures() {
  // 显示设备信息卡片
  document.getElementById('phone-connected-section')?.classList.remove('hidden');
  // 显示快捷操作区域
  document.getElementById('quick-actions-section')?.classList.remove('hidden');
  // 显示投屏区域
  document.getElementById('screen-stream-section')?.classList.remove('hidden');
}

// 隐藏已连接状态的功能区域
function hideConnectedFeatures() {
  document.getElementById('phone-connected-section')?.classList.add('hidden');
  document.getElementById('quick-actions-section')?.classList.add('hidden');
  // 隐藏投屏区域并停止投屏
  const streamSection = document.getElementById('screen-stream-section');
  if (streamSection) streamSection.classList.add('hidden');
  // 如果正在投屏，停止它
  if (typeof getScreenStreamState === 'function') {
    const state = getScreenStreamState();
    if (state && state.isStreaming && typeof stopScreenStream === 'function') {
      stopScreenStream();
    }
  }
}

// 鹏程万里手动连接
async function connectPCWL(isAutoConnect = false) {
  const connectBtn = document.getElementById('pcwl-connect-btn');
  const statusDot = document.getElementById('pcwl-status-indicator');
  const statusText = document.getElementById('pcwl-status-text');
  const deviceInfoEl = document.getElementById('pcwl-device-info');
  
  // 禁用按钮
  if (connectBtn) {
    connectBtn.disabled = true;
    connectBtn.innerHTML = `
      <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
      连接中...
    `;
  }
  
  // 更新状态显示
  if (statusText) statusText.textContent = '连接中...';
  if (deviceInfoEl) deviceInfoEl.textContent = '正在连接...';
  
  try {
    // 获取IP和端口
    const ipInput = document.getElementById('pcwl-ip');
    const portInput = document.getElementById('pcwl-port');
    const ip = ipInput?.value?.trim() || '192.168.0.102';
    const port = portInput?.value?.trim() || '8765';
    
    // 调用主进程连接鹏程万里
    const result = await ipcRenderer.invoke('pcwl-connect', { ip, port });
    
    if (result && result.success) {
      console.log('连接成功，设备信息:', result.deviceInfo);
      updatePCWLStatus(true, result.deviceInfo);
      showPhoneNotification(isAutoConnect ? '鹏程万里自动连接成功' : '鹏程万里连接成功', 'success');
      
      // 更新设备卡片
      if (result.deviceInfo) {
        console.log('更新设备卡片...');
        updateDeviceCard(result.deviceInfo);
      }
      
      // 显示已连接功能区域
      console.log('显示功能区域...');
      showConnectedFeatures();
    } else {
      throw new Error(result?.error || '连接失败');
    }
  } catch (error) {
    console.error('鹏程万里连接失败:', error);
    updatePCWLStatus(false);
    if (!isAutoConnect) {
      showPhoneNotification('连接失败: ' + error.message, 'error');
    }
  } finally {
    // 恢复按钮
    if (connectBtn) {
      connectBtn.disabled = false;
      connectBtn.innerHTML = `
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path>
        </svg>
        连接
      `;
    }
  }
}

// 鹏程万里断开连接
async function disconnectPCWL() {
  const statusDot = document.getElementById('pcwl-status-indicator');
  const statusText = document.getElementById('pcwl-status-text');
  const deviceInfoEl = document.getElementById('pcwl-device-info');
  
  try {
    const result = await ipcRenderer.invoke('pcwl-disconnect');
    
    if (result && result.success) {
      updatePCWLStatus(false);
      showPhoneNotification('已断开鹏程万里连接', 'info');
      
      // 更新设备卡片
      updateDeviceCardPlaceholder();
      
      // 隐藏已连接功能区域
      hideConnectedFeatures();
    } else {
      throw new Error(result?.error || '断开失败');
    }
  } catch (error) {
    console.error('断开鹏程万里连接失败:', error);
    showPhoneNotification('断开连接失败: ' + error.message, 'error');
  }
}

// 更新鹏程万里状态显示
function updatePCWLStatus(connected, deviceInfo = null) {
  const statusDot = document.getElementById('pcwl-status-indicator');
  const statusText = document.getElementById('pcwl-status-text');
  const deviceInfoEl = document.getElementById('pcwl-device-info');
  const connectBtn = document.getElementById('pcwl-connect-btn');
  const disconnectBtn = document.getElementById('pcwl-disconnect-btn');
  const autoToggleBtn = document.getElementById('pcwl-auto-toggle');
  
  if (statusDot) {
    if (connected) {
      statusDot.classList.remove('bg-gray-400');
      statusDot.classList.add('bg-green-500');
      // 添加脉冲动画表示在线
      statusDot.classList.add('animate-pulse');
    } else {
      statusDot.classList.remove('bg-green-500', 'animate-pulse');
      statusDot.classList.add('bg-gray-400');
    }
  }
  
  if (statusText) {
    if (connected) {
      statusText.textContent = '已连接';
      statusText.classList.remove('text-gray-700', 'dark:text-gray-300');
      statusText.classList.add('text-green-600', 'dark:text-green-400', 'font-medium');
    } else {
      statusText.textContent = '未连接';
      statusText.classList.remove('text-green-600', 'dark:text-green-400', 'font-medium');
      statusText.classList.add('text-gray-700', 'dark:text-gray-300');
    }
  }
  
  // 更新设备信息显示
  if (deviceInfoEl) {
    if (connected && deviceInfo) {
      const deviceName = deviceInfo.model || deviceInfo.brand || deviceInfo.name || '未知设备';
      const androidVersion = deviceInfo.version || deviceInfo.androidVersion || '';
      deviceInfoEl.textContent = `${deviceName} (Android ${androidVersion})`;
      deviceInfoEl.classList.remove('text-gray-500', 'dark:text-gray-400');
      deviceInfoEl.classList.add('text-green-500', 'dark:text-green-300');
    } else {
      deviceInfoEl.textContent = '自动发现设备';
      deviceInfoEl.classList.remove('text-green-500', 'dark:text-green-300');
      deviceInfoEl.classList.add('text-gray-500', 'dark:text-gray-400');
    }
  }
  
  // 更新按钮状态
  if (connectBtn) {
    connectBtn.disabled = connected;
    if (connected) {
      connectBtn.classList.add('opacity-50', 'cursor-not-allowed');
    } else {
      connectBtn.classList.remove('opacity-50', 'cursor-not-allowed');
    }
  }
  if (disconnectBtn) {
    disconnectBtn.disabled = !connected;
    if (!connected) {
      disconnectBtn.classList.add('opacity-50', 'cursor-not-allowed');
    } else {
      disconnectBtn.classList.remove('opacity-50', 'cursor-not-allowed');
    }
  }
  
  // 更新自动连接按钮状态
  if (autoToggleBtn && connected) {
    autoToggleBtn.textContent = '已连接 ✓';
    autoToggleBtn.classList.remove('bg-green-500', 'hover:bg-green-600');
    autoToggleBtn.classList.add('bg-green-600');
  }
  
  // 更新全局连接状态
  phoneConnectionState.connected = connected;
  phoneConnectionState.deviceInfo = deviceInfo;
  
  // 根据连接状态切换功能区域显示
  if (connected) {
    showConnectedFeatures();
  } else {
    hideConnectedFeatures();
  }
}

// 导出函数供HTML调用
window.switchConnectMode = switchConnectMode;
window.toggleAutoConnect = toggleAutoConnect;
window.connectPCWL = connectPCWL;
window.disconnectPCWL = disconnectPCWL;
window.updatePCWLStatus = updatePCWLStatus;

// 连接手机
async function connectPhone() {
  const ipInput = document.getElementById('phone-ip-input');
  const portInput = document.getElementById('phone-port-input');
  const connectBtn = document.getElementById('phone-connect-btn');
  const animation = document.getElementById('phone-connecting-animation');
  
  // 获取IP和端口
  const ip = ipInput?.value?.trim() || '';
  const port = portInput?.value?.trim() || '5555';
  
  // 验证输入
  if (!ip) {
    showPhoneNotification('请输入设备IP地址', 'warning');
    ipInput?.focus();
    return;
  }
  
  // 更新连接状态
  phoneConnectionState.connecting = true;
  
  // 显示连接动画
  if (animation) {
    animation.classList.remove('hidden');
  }
  
  // 禁用连接按钮
  if (connectBtn) {
    connectBtn.disabled = true;
    connectBtn.innerHTML = `
      <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
      连接中...
    `;
  }
  
  try {
    // 调用主进程连接
    const result = await ipcRenderer.invoke('phone-connect', { ip, port });
    
    if (result && result.success) {
      phoneConnectionState.connected = true;
      phoneConnectionState.deviceInfo = result.deviceInfo || {};
      showPhoneNotification('连接成功!', 'success');
      
      // 更新UI
      updateDeviceCard(phoneConnectionState.deviceInfo);
      
      // 延迟刷新状态
      setTimeout(refreshPhoneStatus, 500);
    } else {
      throw new Error(result?.error || '连接失败');
    }
  } catch (error) {
    console.error('连接手机失败:', error);
    showPhoneNotification('连接失败: ' + error.message, 'error');
    phoneConnectionState.connected = false;
  } finally {
    phoneConnectionState.connecting = false;
    
    // 隐藏动画
    if (animation) {
      animation.classList.add('hidden');
    }
    
    // 恢复连接按钮
    if (connectBtn) {
      connectBtn.disabled = false;
      connectBtn.innerHTML = `
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path>
        </svg>
        连接
      `;
    }
  }
}

// 断开手机连接
async function disconnectPhone() {
  try {
    const result = await ipcRenderer.invoke('phone-disconnect');
    if (result && result.success) {
      phoneConnectionState.connected = false;
      phoneConnectionState.deviceInfo = null;
      showPhoneNotification('已断开连接', 'info');
      
      // 更新UI
      updateDeviceCardPlaceholder();
      refreshPhoneStatus();
    }
  } catch (error) {
    console.error('断开连接失败:', error);
    showPhoneNotification('断开失败: ' + error.message, 'error');
  }
}

// ==================== ADB连接管理 ====================

// ADB无线连接
async function connectADB() {
  const ipInput = document.getElementById('adb-ip-input');
  const portInput = document.getElementById('adb-port-input');
  const connectBtn = document.getElementById('adb-connect-btn');
  
  // 获取IP和端口
  const ip = ipInput?.value?.trim() || '';
  const port = portInput?.value?.trim() || '5555';
  
  // 验证输入
  if (!ip) {
    showPhoneNotification('请输入ADB设备IP地址', 'warning');
    ipInput?.focus();
    return;
  }
  
  // 禁用连接按钮
  if (connectBtn) {
    connectBtn.disabled = true;
    connectBtn.innerHTML = `
      <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
      连接中...
    `;
  }
  
  try {
    // 调用主进程进行ADB连接
    const result = await ipcRenderer.invoke('adb-connect', { ip, port });
    
    if (result && result.success) {
      showPhoneNotification(`ADB连接成功: ${ip}:${port}`, 'success');
      
      // 更新UI状态
      updateADBStatus(true, `${ip}:${port}`);
      
      // 显示已连接功能区域
      showConnectedFeatures();
    } else {
      throw new Error(result?.error || 'ADB连接失败');
    }
  } catch (error) {
    console.error('ADB连接失败:', error);
    showPhoneNotification('ADB连接失败: ' + error.message, 'error');
  } finally {
    // 恢复连接按钮
    if (connectBtn) {
      connectBtn.disabled = false;
      connectBtn.innerHTML = `
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path>
        </svg>
        连接
      `;
    }
  }
}

// ADB断开连接
async function disconnectADB() {
  const ipInput = document.getElementById('adb-ip-input');
  const connectBtn = document.getElementById('adb-connect-btn');
  
  // 获取当前连接的地址
  const address = ipInput?.value?.trim() || '';
  
  try {
    // 调用主进程断开ADB连接
    const result = await ipcRenderer.invoke('adb-disconnect', { address });
    
    if (result && result.success) {
      showPhoneNotification('ADB已断开连接', 'info');
      
      // 更新UI状态
      updateADBStatus(false, null);
      
      // 隐藏已连接功能区域
      hideConnectedFeatures();
    } else {
      throw new Error(result?.error || '断开连接失败');
    }
  } catch (error) {
    console.error('ADB断开连接失败:', error);
    showPhoneNotification('断开失败: ' + error.message, 'error');
  }
}

// 更新ADB连接状态UI
function updateADBStatus(connected, address) {
  const statusEl = document.getElementById('adb-status');
  const addressEl = document.getElementById('adb-address');
  
  if (statusEl) {
    if (connected) {
      statusEl.textContent = '已连接';
      statusEl.className = 'text-xs px-2 py-1 rounded-full bg-green-100 dark:bg-green-900 text-green-600 dark:text-green-400';
    } else {
      statusEl.textContent = '未连接';
      statusEl.className = 'text-xs px-2 py-1 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400';
    }
  }
  
  if (addressEl && address) {
    addressEl.textContent = address;
  }
}

// ==================== SSH连接管理 ====================

// SSH连接
async function connectSSH() {
  const hostInput = document.getElementById('ssh-host-input');
  const portInput = document.getElementById('ssh-port-input');
  const userInput = document.getElementById('ssh-user-input');
  const passwordInput = document.getElementById('ssh-password-input');
  const connectBtn = document.getElementById('ssh-connect-btn');
  
  // 获取连接参数
  const host = hostInput?.value?.trim() || '';
  const port = portInput?.value?.trim() || '22';
  const user = userInput?.value?.trim() || '';
  const password = passwordInput?.value || '';
  
  // 验证输入
  if (!host) {
    showPhoneNotification('请输入SSH主机地址', 'warning');
    hostInput?.focus();
    return;
  }
  if (!user) {
    showPhoneNotification('请输入SSH用户名', 'warning');
    userInput?.focus();
    return;
  }
  
  // 禁用连接按钮
  if (connectBtn) {
    connectBtn.disabled = true;
    connectBtn.innerHTML = `
      <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
      连接中...
    `;
  }
  
  try {
    // 调用主进程进行SSH连接
    const result = await ipcRenderer.invoke('ssh-connect', { 
      host, 
      port: parseInt(port) || 22, 
      user, 
      password 
    });
    
    if (result && result.success) {
      showPhoneNotification(`SSH连接成功: ${user}@${host}`, 'success');
      
      // 更新UI状态
      updateSSHStatus(true, host, user);
    } else {
      throw new Error(result?.error || 'SSH连接失败');
    }
  } catch (error) {
    console.error('SSH连接失败:', error);
    showPhoneNotification('SSH连接失败: ' + error.message, 'error');
  } finally {
    // 恢复连接按钮
    if (connectBtn) {
      connectBtn.disabled = false;
      connectBtn.innerHTML = `
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path>
        </svg>
        连接
      `;
    }
  }
}

// SSH断开连接
async function disconnectSSH() {
  const hostInput = document.getElementById('ssh-host-input');
  const connectBtn = document.getElementById('ssh-connect-btn');
  
  // 获取当前连接的主机
  const host = hostInput?.value?.trim() || '';
  
  try {
    // 调用主进程断开SSH连接
    const result = await ipcRenderer.invoke('ssh-disconnect', { host });
    
    if (result && result.success) {
      showPhoneNotification('SSH已断开连接', 'info');
      
      // 更新UI状态
      updateSSHStatus(false, null, null);
    } else {
      throw new Error(result?.error || '断开连接失败');
    }
  } catch (error) {
    console.error('SSH断开连接失败:', error);
    showPhoneNotification('断开失败: ' + error.message, 'error');
  }
}

// 更新SSH连接状态UI
function updateSSHStatus(connected, host, user) {
  const statusEl = document.getElementById('ssh-status');
  const hostEl = document.getElementById('ssh-host');
  
  if (statusEl) {
    if (connected) {
      statusEl.textContent = '已连接';
      statusEl.className = 'text-xs px-2 py-1 rounded-full bg-green-100 dark:bg-green-900 text-green-600 dark:text-green-400';
    } else {
      statusEl.textContent = '未连接';
      statusEl.className = 'text-xs px-2 py-1 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400';
    }
  }
  
  if (hostEl && host && user) {
    hostEl.textContent = `${user}@${host}`;
  }
}

// 更新设备信息卡片
function updateDeviceCard(deviceInfo) {
  if (!deviceInfo) return;
  
  const modelEl = document.getElementById('phone-device-model');
  const osEl = document.getElementById('phone-device-os');
  const batteryPercent = document.getElementById('phone-battery-percent');
  const batteryBar = document.getElementById('phone-battery-bar');
  const storageText = document.getElementById('phone-storage-text');
  const storageBar = document.getElementById('phone-storage-bar');
  const statusEl = document.getElementById('phone-conn-status');
  
  // 更新型号
  if (modelEl) {
    modelEl.textContent = deviceInfo.model || deviceInfo.brand || 'Android设备';
  }
  
  // 更新系统版本
  if (osEl) {
    osEl.textContent = `系统版本: Android ${deviceInfo.version || deviceInfo.androidVersion || '--'}`;
  }
  
  // 更新电量
  const battery = parseInt(deviceInfo.battery) || 0;
  if (batteryPercent) {
    batteryPercent.textContent = `${battery}%`;
  }
  if (batteryBar) {
    batteryBar.style.width = `${battery}%`;
    // 根据电量设置颜色
    if (battery <= 20) {
      batteryBar.className = 'bg-red-500 h-2 rounded-full transition-all duration-500';
    } else if (battery <= 50) {
      batteryBar.className = 'bg-yellow-500 h-2 rounded-full transition-all duration-500';
    } else {
      batteryBar.className = 'bg-green-500 h-2 rounded-full transition-all duration-500';
    }
  }
  
  // 更新存储
  if (deviceInfo.storage) {
    const { used, total } = deviceInfo.storage;
    if (storageText && used && total) {
      storageText.textContent = `${formatStorage(used)} / ${formatStorage(total)}`;
    }
    if (storageBar && used && total) {
      const percent = Math.round((used / total) * 100);
      storageBar.style.width = `${percent}%`;
    }
  }
  
  // 更新状态标签
  if (statusEl) {
    statusEl.textContent = '已连接';
    statusEl.className = 'text-xs px-2 py-1 rounded-full bg-green-100 dark:bg-green-900 text-green-600 dark:text-green-400 animate-pulse';
    setTimeout(() => {
      statusEl.classList.remove('animate-pulse');
    }, 1000);
  }
}

// 格式化存储空间
function formatStorage(bytes) {
  if (!bytes) return '--';
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) {
    return gb.toFixed(1) + ' GB';
  }
  const mb = bytes / (1024 * 1024);
  return mb.toFixed(0) + ' MB';
}

// 显示手机通知
function showPhoneNotification(message, type = 'info') {
  // 创建通知元素
  const notification = document.createElement('div');
  notification.className = `fixed top-20 right-4 z-50 px-4 py-2 rounded-lg shadow-lg transform transition-all duration-300 translate-x-full`;
  
  // 根据类型设置样式
  const styles = {
    success: 'bg-green-500 text-white',
    error: 'bg-red-500 text-white',
    warning: 'bg-yellow-500 text-white',
    info: 'bg-blue-500 text-white'
  };
  notification.className += ` ${styles[type] || styles.info}`;
  
  // 添加图标
  const icons = {
    success: '✓',
    error: '✕',
    warning: '⚠',
    info: 'ℹ'
  };
  
  notification.innerHTML = `
    <div class="flex items-center gap-2">
      <span>${icons[type] || icons.info}</span>
      <span>${message}</span>
    </div>
  `;
  
  document.body.appendChild(notification);
  
  // 显示动画
  requestAnimationFrame(() => {
    notification.classList.remove('translate-x-full');
  });
  
  // 3秒后移除
  setTimeout(() => {
    notification.classList.add('translate-x-full', 'opacity-0');
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

window.connectPhone = connectPhone;
window.disconnectPhone = disconnectPhone;
window.connectADB = connectADB;
window.disconnectADB = disconnectADB;
window.connectSSH = connectSSH;
window.disconnectSSH = disconnectSSH;

// 刷新手机状态
async function refreshPhoneStatus() {
  const statusEl = document.getElementById('phone-conn-status');
  
  if (!statusEl) return;
  
  try {
    const status = await ipcRenderer.invoke('check-service-status', 'phone');
    
    if (status && status.running) {
      phoneConnectionState.connected = true;
      phoneConnectionState.deviceInfo = status.deviceInfo || {};
      
      // 更新状态标签
      statusEl.textContent = '已连接';
      statusEl.className = 'text-xs px-2 py-1 rounded-full bg-green-100 dark:bg-green-900 text-green-600 dark:text-green-400';
      
      // 更新设备信息卡片
      if (status.deviceInfo) {
        updateDeviceCard(status.deviceInfo);
      }
    } else {
      phoneConnectionState.connected = false;
      phoneConnectionState.deviceInfo = null;
      
      statusEl.textContent = '未连接';
      statusEl.className = 'text-xs px-2 py-1 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400';
      
      // 显示占位信息
      updateDeviceCardPlaceholder();
    }
  } catch (error) {
    console.error('获取手机状态失败:', error);
    phoneConnectionState.connected = false;
    
    statusEl.textContent = '检测失败';
    statusEl.className = 'text-xs px-2 py-1 rounded-full bg-red-100 dark:bg-red-900 text-red-600 dark:text-red-400';
  }
}

window.refreshPhoneStatus = refreshPhoneStatus;

// 手机快捷操作
async function phoneAction(action) {
  // 检查连接状态
  if (!phoneConnectionState.connected) {
    showPhoneNotification('请先连接设备', 'warning');
    return;
  }
  
  // 操作名称映射
  const actionNames = {
    screenshot: '截图',
    home: '主页',
    back: '返回',
    volume: '音量',
    power: '电源',
    apps: '应用列表'
  };
  
  // 特殊处理：音量调节显示对话框
  if (action === 'volume') {
    showVolumeDialog();
    return;
  }
  
  try {
    // 显示操作提示
    showPhoneNotification(`正在执行: ${actionNames[action] || action}`, 'info');
    
    const result = await ipcRenderer.invoke('phone-action', action);
    
    if (result && result.success) {
      showPhoneNotification(`${actionNames[action] || action} 成功`, 'success');
      
      // 如果是截图，可能需要显示预览
      if (action === 'screenshot' && result.path) {
        console.log('截图保存至:', result.path);
      }
    } else {
      throw new Error(result?.error || '操作失败');
    }
  } catch (error) {
    console.error(`手机操作 ${action} 失败:`, error);
    showPhoneNotification(`${actionNames[action] || action} 失败: ${error.message}`, 'error');
  }
}

// 显示音量调节对话框
function showVolumeDialog() {
  // 检查是否已有对话框，有则移除
  const existingDialog = document.getElementById('volume-dialog');
  if (existingDialog) {
    existingDialog.remove();
    return;
  }
  
  // 创建对话框
  const dialog = document.createElement('div');
  dialog.id = 'volume-dialog';
  dialog.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/50';
  dialog.innerHTML = `
    <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-6 w-80 max-w-sm transform transition-all">
      <h3 class="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-6 text-center">
        🔊 音量调节
      </h3>
      <div class="flex gap-4 justify-center mb-6">
        <button onclick="adjustVolume('down')" class="w-20 h-20 rounded-xl bg-gradient-to-b from-orange-400 to-orange-500 hover:from-orange-500 hover:to-orange-600 text-white font-bold text-2xl shadow-lg hover:shadow-xl transition-all active:scale-95 flex items-center justify-center">
          <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M20 12H4"></path>
          </svg>
        </button>
        <button onclick="adjustVolume('up')" class="w-20 h-20 rounded-xl bg-gradient-to-b from-blue-400 to-blue-500 hover:from-blue-500 hover:to-blue-600 text-white font-bold text-2xl shadow-lg hover:shadow-xl transition-all active:scale-95 flex items-center justify-center">
          <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M12 4v16m8-8H4"></path>
          </svg>
        </button>
      </div>
      <div class="flex gap-3">
        <button onclick="closeVolumeDialog()" class="flex-1 px-4 py-2.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg transition-colors font-medium">
          关闭
        </button>
      </div>
    </div>
  `;
  
  document.body.appendChild(dialog);
  
  // 点击背景关闭
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) {
      closeVolumeDialog();
    }
  });
  
  // ESC键关闭
  const escHandler = (e) => {
    if (e.key === 'Escape') {
      closeVolumeDialog();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);
}

// 调节音量
async function adjustVolume(direction) {
  if (!phoneConnectionState.connected) {
    showPhoneNotification('请先连接设备', 'warning');
    return;
  }
  
  try {
    const action = direction === 'up' ? 'volume_up' : 'volume_down';
    const result = await ipcRenderer.invoke('phone-action', action);
    
    if (result && result.success) {
      showPhoneNotification(direction === 'up' ? '音量 +' : '音量 -', 'success');
    } else {
      throw new Error(result?.error || '操作失败');
    }
  } catch (error) {
    console.error('调节音量失败:', error);
    showPhoneNotification('调节音量失败', 'error');
  }
}

// 关闭音量对话框
function closeVolumeDialog() {
  const dialog = document.getElementById('volume-dialog');
  if (dialog) {
    dialog.remove();
  }
}

window.phoneAction = phoneAction;
window.showVolumeDialog = showVolumeDialog;
window.adjustVolume = adjustVolume;
window.closeVolumeDialog = closeVolumeDialog;

// ==================== 屏幕视频流功能 ====================
// 屏幕流状态管理
let screenStreamState = {
  isStreaming: false,
  currentStreamId: null,
  frameCount: 0,
  ws: null,
  canvas: null,
  ctx: null,
  deviceWidth: 0,
  deviceHeight: 0,
  lastFrameTime: 0,
  startTime: 0,
  // H.264 解码器相关
  videoDecoder: null,
  codecConfigured: false,
  streamFormat: null, // 'h264' 或 'jpeg'
  pendingFrames: [],
  spsNalu: null,
  ppsNalu: null
};

// 启动屏幕视频流
async function startScreenStream(ip, port, options = {}) {
  const {
    canvasId = 'screen-canvas',
    quality = 80,
    fps = 30,
    onFrame = null,
    onConnect = null,
    onError = null,
    onClose = null
  } = options;
  
  // 检查是否已经在流中
  if (screenStreamState.isStreaming) {
    showPhoneNotification('屏幕流已经在运行', 'warning');
    return false;
  }
  
  // 获取Canvas元素
  const canvas = document.getElementById(canvasId);
  if (!canvas) {
    console.error(`Canvas元素 #${canvasId} 未找到`);
    if (onError) onError(new Error(`Canvas元素 #${canvasId} 未找到`));
    return false;
  }
  
  // 初始化Canvas
  screenStreamState.canvas = canvas;
  screenStreamState.ctx = canvas.getContext('2d');
  screenStreamState.frameCount = 0;
  
  // 构建WebSocket URL
  const wsUrl = `ws://${ip}:${port}`;
  
  try {
    showPhoneNotification('正在连接屏幕流...', 'info');
    
    // 创建WebSocket连接
    const ws = new WebSocket(wsUrl);
    screenStreamState.ws = ws;
    
    // 连接超时处理
    const connectTimeout = setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        ws.close();
        showPhoneNotification('连接屏幕流超时', 'error');
        if (onError) onError(new Error('连接超时'));
      }
    }, 10000);
    
    // WebSocket打开
    ws.onopen = () => {
      clearTimeout(connectTimeout);
      console.log('[ScreenStream] WebSocket已连接');
      
      // 初始化 H264 解码器
      initH264Decoder();
      
      // 发送 H264 流命令
      const startCommand = {
        id: Date.now().toString(),
        command: 'start_h264_stream',
        params: {
          width: 720,
          height: 1280,
          bitrate: 2000000,
          fps: fps
        }
      };
      ws.send(JSON.stringify(startCommand));
      screenStreamState.streamFormat = 'h264';
      
      screenStreamState.isStreaming = true;
      showPhoneNotification('H264屏幕流已启动', 'success');
      
      if (onConnect) onConnect();
    };
    
    // 接收消息 - 支持二进制 H264 帧
    ws.binaryType = 'arraybuffer';
    ws.onmessage = (event) => {
      // 二进制 H264 帧数据
      if (event.data instanceof ArrayBuffer) {
        decodeH264Frame(event.data);
        screenStreamState.frameCount++;
        screenStreamState.lastFrameTime = Date.now();
        
        // 计算FPS
        if (!screenStreamState.startTime) {
          screenStreamState.startTime = Date.now();
        }
        const elapsed = (Date.now() - screenStreamState.startTime) / 1000;
        const currentFps = elapsed > 0 ? screenStreamState.frameCount / elapsed : 0;
        
        if (onFrame) onFrame({ fps: currentFps });
        return;
      }
      
      // 首先检查是否是纯base64帧数据（旧格式兼容）
      if (typeof event.data === 'string' && !event.data.startsWith('{')) {
        // 纯base64帧数据
        renderFrameFromBase64(event.data);
        screenStreamState.frameCount++;
        screenStreamState.lastFrameTime = Date.now();
        
        // 计算FPS
        if (!screenStreamState.startTime) {
          screenStreamState.startTime = Date.now();
        }
        const elapsed = (Date.now() - screenStreamState.startTime) / 1000;
        const currentFps = elapsed > 0 ? screenStreamState.frameCount / elapsed : 0;
        
        if (onFrame) onFrame({ fps: currentFps, data: event.data });
        return;
      }
      
      try {
        const data = JSON.parse(event.data);
        
        // 处理不同类型的消息（匹配Android CommandResponse格式）
        if (data.success === true && data.data) {
          // 成功响应
          const responseData = data.data;
          
          // 检查是否是流启动响应
          if (responseData.stream_id) {
            screenStreamState.currentStreamId = responseData.stream_id;
            screenStreamState.deviceWidth = responseData.width || 0;
            screenStreamState.deviceHeight = responseData.height || 0;
            screenStreamState.startTime = Date.now(); // 开始计时
            console.log('[ScreenStream] 流已启动:', responseData);
            
            // 设置Canvas尺寸
            if (responseData.width && responseData.height) {
              canvas.width = responseData.width;
              canvas.height = responseData.height;
            }
            return;
          }
          
          // 检查是否是帧数据
          if (responseData.image) {
            // base64 图像数据
            renderFrameFromBase64(responseData.image);
            screenStreamState.frameCount++;
            screenStreamState.lastFrameTime = Date.now();
            if (onFrame) onFrame({ 
              fps: screenStreamState.frameCount / ((Date.now() - screenStreamState.startTime) / 1000),
              data: responseData 
            });
            return;
          }
        }
        
        // 错误响应
        if (data.success === false && data.error) {
          console.error('[ScreenStream] 服务器错误:', data.error);
          
          // 检测MediaProjection授权错误
          const errorMsg = data.error.toLowerCase();
          if (errorMsg.includes('mediaprojection') || errorMsg.includes('permission') || errorMsg.includes('授权')) {
            showPhoneNotification('需要屏幕录制权限，请在手机上授权后重试', 'warning');
            // 自动降级到JPEG截图模式
            console.log('[ScreenStream] 降级到JPEG截图模式');
            stopScreenStream();
            setTimeout(() => startJpegStream(ip, port, options), 1000);
          } else {
            showPhoneNotification(`屏幕流错误: ${data.error}`, 'error');
            if (onError) onError(new Error(data.error));
          }
          return;
        }
        
        // 兼容旧格式
        switch (data.type) {
          case 'frame':
            renderFrame(data.data, data.width, data.height);
            screenStreamState.frameCount++;
            screenStreamState.lastFrameTime = Date.now();
            if (onFrame) onFrame(data);
            break;
            
          case 'stream_started':
            screenStreamState.currentStreamId = data.streamId;
            screenStreamState.deviceWidth = data.width || 0;
            screenStreamState.deviceHeight = data.height || 0;
            console.log('[ScreenStream] 流已启动:', data);
            if (data.width && data.height) {
              canvas.width = data.width;
              canvas.height = data.height;
            }
            break;
            
          case 'stream_stopped':
            console.log('[ScreenStream] 流已停止');
            break;
            
          case 'error':
            console.error('[ScreenStream] 服务器错误:', data.message);
            showPhoneNotification(`屏幕流错误: ${data.message}`, 'error');
            if (onError) onError(new Error(data.message));
            break;
            
          default:
            // 尝试解析为base64帧数据（兼容格式）
            if (typeof event.data === 'string' && event.data.startsWith('data:image')) {
              renderFrameFromBase64(event.data);
              screenStreamState.frameCount++;
              screenStreamState.lastFrameTime = Date.now();
              if (onFrame) onFrame({ data: event.data });
            }
        }
      } catch (e) {
        // 可能是纯base64帧数据
        if (typeof event.data === 'string') {
          renderFrameFromBase64(event.data);
          screenStreamState.frameCount++;
          screenStreamState.lastFrameTime = Date.now();
          if (onFrame) onFrame({ data: event.data });
        }
      }
    };
    
    // WebSocket关闭
    ws.onclose = (event) => {
      clearTimeout(connectTimeout);
      console.log('[ScreenStream] WebSocket已关闭:', event.code, event.reason);
      
      screenStreamState.isStreaming = false;
      screenStreamState.ws = null;
      
      if (event.code !== 1000) {
        showPhoneNotification('屏幕流连接已断开', 'warning');
      }
      
      if (onClose) onClose(event);
    };
    
    // WebSocket错误
    ws.onerror = (error) => {
      clearTimeout(connectTimeout);
      console.error('[ScreenStream] WebSocket错误:', error);
      showPhoneNotification('屏幕流连接错误', 'error');
      
      screenStreamState.isStreaming = false;
      if (onError) onError(error);
    };
    
    return true;
    
  } catch (error) {
    console.error('[ScreenStream] 启动失败:', error);
    showPhoneNotification('启动屏幕流失败', 'error');
    if (onError) onError(error);
    return false;
  }
}

// JPEG截图流（H.264降级方案）
let jpegStreamInterval = null;

async function startJpegStream(ip, port, options = {}) {
  const {
    canvasId = 'screen-canvas',
    fps = 15,
    onFrame = null,
    onError = null
  } = options;
  
  const canvas = document.getElementById(canvasId);
  if (!canvas) {
    console.error(`Canvas元素 #${canvasId} 未找到`);
    return false;
  }
  
  screenStreamState.canvas = canvas;
  screenStreamState.ctx = canvas.getContext('2d');
  screenStreamState.streamFormat = 'jpeg';
  
  showPhoneNotification('使用JPEG截图模式（低帧率）', 'info');
  
  // 通过IPC请求截图
  const captureFrame = async () => {
    if (screenStreamState.streamFormat !== 'jpeg') return;
    
    try {
      const result = await ipcRenderer.invoke('phone-action', 'screenshot');
      if (result.success && result.screenshot) {
        renderFrameFromBase64(result.screenshot);
        screenStreamState.frameCount++;
        if (onFrame) onFrame({ fps: fps });
      }
    } catch (err) {
      console.error('[JpegStream] 截图失败:', err);
    }
  };
  
  // 启动定时截图
  screenStreamState.isStreaming = true;
  jpegStreamInterval = setInterval(captureFrame, 1000 / fps);
  
  // 立即截取第一帧
  await captureFrame();
  
  return true;
}

// 停止屏幕视频流
async function stopScreenStream() {
  // 停止JPEG截图流
  if (jpegStreamInterval) {
    clearInterval(jpegStreamInterval);
    jpegStreamInterval = null;
    screenStreamState.isStreaming = false;
    screenStreamState.streamFormat = null;
    showPhoneNotification('JPEG截图流已停止', 'success');
    console.log('[ScreenStream] JPEG流已停止');
    return true;
  }
  
  if (!screenStreamState.isStreaming || !screenStreamState.ws) {
    showPhoneNotification('没有正在运行的屏幕流', 'warning');
    return false;
  }
  
  try {
    // 发送停止流命令
    const stopCommand = {
      type: 'stop_stream'
    };
    
    if (screenStreamState.ws.readyState === WebSocket.OPEN) {
      screenStreamState.ws.send(JSON.stringify(stopCommand));
    }
    
    // 关闭WebSocket连接
    screenStreamState.ws.close(1000, '用户停止');
    
    // 重置状态
    screenStreamState.isStreaming = false;
    screenStreamState.ws = null;
    screenStreamState.currentStreamId = null;
    screenStreamState.frameCount = 0;
    screenStreamState.streamFormat = null;
    
    showPhoneNotification('屏幕流已停止', 'success');
    console.log('[ScreenStream] 已停止');
    
    return true;
    
  } catch (error) {
    console.error('[ScreenStream] 停止失败:', error);
    showPhoneNotification('停止屏幕流失败', 'error');
    return false;
  }
}

// ========== H.264 解码相关函数 ==========

// 初始化 H264 解码器
function initH264Decoder() {
  if (screenStreamState.videoDecoder) {
    return; // 已初始化
  }
  
  if (!('VideoDecoder' in window)) {
    console.error('[H264] WebCodecs VideoDecoder 不支持');
    showPhoneNotification('浏览器不支持 H264 硬解码', 'error');
    return;
  }
  
  screenStreamState.videoDecoder = new VideoDecoder({
    output: (frame) => {
      // 渲染解码后的帧到 canvas
      const canvas = screenStreamState.canvas;
      const ctx = screenStreamState.ctx;
      if (canvas && ctx) {
        // 调整 canvas 尺寸
        if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
          canvas.width = frame.displayWidth;
          canvas.height = frame.displayHeight;
        }
        ctx.drawImage(frame, 0, 0);
      }
      frame.close();
    },
    error: (e) => {
      console.error('[H264] 解码错误:', e);
    }
  });
  
  screenStreamState.codecConfigured = false;
  console.log('[H264] VideoDecoder 已初始化');
}

// 解码 H264 帧
function decodeH264Frame(arrayBuffer) {
  const decoder = screenStreamState.videoDecoder;
  if (!decoder) {
    console.warn('[H264] 解码器未初始化');
    return;
  }
  
  const data = new Uint8Array(arrayBuffer);
  
  // 查找 NALU 起始码 (00 00 00 01 或 00 00 01)
  let naluStart = -1;
  for (let i = 0; i < data.length - 3; i++) {
    if (data[i] === 0 && data[i+1] === 0) {
      if (data[i+2] === 1) {
        naluStart = i + 3;
        break;
      } else if (data[i+2] === 0 && data[i+3] === 1) {
        naluStart = i + 4;
        break;
      }
    }
  }
  
  if (naluStart < 0) {
    // 没有起始码，可能是纯帧数据
    naluStart = 0;
  }
  
  const naluType = data[naluStart] & 0x1F;
  
  // 配置解码器（首次遇到 SPS）
  if (!screenStreamState.codecConfigured && (naluType === 7 || naluType === 8)) {
    // SPS 或 PPS，缓存起来
    if (naluType === 7) {
      screenStreamState.spsNalu = data.slice(naluStart - 4);
    } else if (naluType === 8) {
      screenStreamState.ppsNalu = data.slice(naluStart - 4);
    }
    
    // 如果 SPS 和 PPS 都有了，配置解码器
    if (screenStreamState.spsNalu && screenStreamState.ppsNalu) {
      try {
        const config = {
          codec: 'avc1.42C01E',
          codedWidth: 720,
          codedHeight: 1280,
          description: createAVCCDescription(screenStreamState.spsNalu, screenStreamState.ppsNalu)
        };
        decoder.configure(config);
        screenStreamState.codecConfigured = true;
        console.log('[H264] 解码器已配置');
      } catch (e) {
        console.error('[H264] 配置解码器失败:', e);
      }
    }
    return;
  }
  
  // 解码帧数据
  if (screenStreamState.codecConfigured || naluType === 5) { // 5 = IDR frame
    // 如果是 IDR 帧，需要拼接 SPS/PPS
    let frameData = data;
    if (naluType === 5 && screenStreamState.spsNalu && screenStreamState.ppsNalu) {
      const sps = screenStreamState.spsNalu;
      const pps = screenStreamState.ppsNalu;
      frameData = new Uint8Array(sps.length + pps.length + data.length);
      frameData.set(sps, 0);
      frameData.set(pps, sps.length);
      frameData.set(data, sps.length + pps.length);
    }
    
    const chunk = new EncodedVideoChunk({
      type: naluType === 5 ? 'key' : 'delta',
      timestamp: Date.now() * 1000,
      data: frameData
    });
    
    try {
      decoder.decode(chunk);
    } catch (e) {
      console.error('[H264] 解码失败:', e);
    }
  }
}

// 创建 AVCC 格式的 description (用于 VideoDecoder 配置)
function createAVCCDescription(sps, pps) {
  const spsLen = sps.length - 4; // 去掉起始码
  const ppsLen = pps.length - 4;
  
  const result = new Uint8Array(7 + spsLen + ppsLen);
  let offset = 0;
  
  // configurationVersion
  result[offset++] = 1;
  // AVCProfileIndication, profile_compatibility, AVCLevelIndication
  result[offset++] = sps[4 + 1];
  result[offset++] = sps[4 + 2];
  result[offset++] = sps[4 + 3];
  // lengthSizeMinusOne
  result[offset++] = 0xFF;
  // numOfSequenceParameterSets
  result[offset++] = 0xE1;
  // sequenceParameterSetLength
  result[offset++] = (spsLen >> 8) & 0xFF;
  result[offset++] = spsLen & 0xFF;
  // SPS data (without start code)
  result.set(sps.slice(4), offset);
  offset += spsLen;
  // numOfPictureParameterSets
  result[offset++] = 1;
  // pictureParameterSetLength
  result[offset++] = (ppsLen >> 8) & 0xFF;
  result[offset++] = ppsLen & 0xFF;
  // PPS data (without start code)
  result.set(pps.slice(4), offset);
  
  return result;
}

// ========== JPEG 渲染函数 ==========

// 渲染视频帧（从base64数据）- 丢弃旧帧，只渲染最新帧
let pendingFrame = null;
let isRendering = false;

function renderFrameFromBase64(base64Data) {
  const ctx = screenStreamState.ctx;
  const canvas = screenStreamState.canvas;
  
  if (!ctx || !canvas) return;
  
  // 只保留最新帧，丢弃旧帧（避免延迟累积）
  pendingFrame = base64Data;
  
  if (!isRendering) {
    requestAnimationFrame(renderPendingFrame);
  }
}

function renderPendingFrame() {
  if (!pendingFrame) return;
  
  const ctx = screenStreamState.ctx;
  const canvas = screenStreamState.canvas;
  if (!ctx || !canvas) return;
  
  isRendering = true;
  const frame = pendingFrame;
  pendingFrame = null;
  
  // 确保base64格式正确
  const dataUrl = frame.startsWith('data:image') 
    ? frame 
    : `data:image/jpeg;base64,${frame}`;
  
  const img = new Image();
  img.onload = () => {
    // 更新Canvas尺寸（如果需要）
    if (canvas.width !== img.width || canvas.height !== img.height) {
      canvas.width = img.width;
      canvas.height = img.height;
      screenStreamState.deviceWidth = img.width;
      screenStreamState.deviceHeight = img.height;
    }
    
    // 绘制帧
    ctx.drawImage(img, 0, 0);
    isRendering = false;
  };
  
  img.onerror = (e) => {
    console.error('[ScreenStream] 帧渲染错误:', e);
    isRendering = false;
  };
  
  img.src = dataUrl;
}

// 渲染视频帧（从对象数据）
function renderFrame(frameData, width, height) {
  if (!frameData) return;
  
  // 支持多种帧数据格式
  if (typeof frameData === 'string') {
    renderFrameFromBase64(frameData);
  } else if (frameData.image) {
    renderFrameFromBase64(frameData.image);
  } else if (frameData.data) {
    renderFrameFromBase64(frameData.data);
  }
}

// 发送点击命令到设备
function sendTapToScreen(x, y) {
  if (!screenStreamState.ws || screenStreamState.ws.readyState !== WebSocket.OPEN) {
    console.warn('[ScreenStream] WebSocket未连接，无法发送点击');
    return false;
  }
  
  // 图片缩小到1/4，坐标需要放大回去
  const scale = 4;
  const realX = Math.round(x * scale);
  const realY = Math.round(y * scale);
  
  const tapCommand = {
    id: Date.now().toString(),
    command: 'tap',
    params: {
      x: realX,
      y: realY
    }
  };
  
  screenStreamState.ws.send(JSON.stringify(tapCommand));
  console.log(`[ScreenStream] 发送点击: (${realX}, ${realY}) [原始: (${x}, ${y})]`);
  return true;
}

// 发送滑动命令到设备
function sendSwipeToScreen(startX, startY, endX, endY, duration = 300) {
  if (!screenStreamState.ws || screenStreamState.ws.readyState !== WebSocket.OPEN) {
    console.warn('[ScreenStream] WebSocket未连接，无法发送滑动');
    return false;
  }
  
  // 图片缩小到1/4，坐标需要放大回去
  const scale = 4;
  const realStartX = Math.round(startX * scale);
  const realStartY = Math.round(startY * scale);
  const realEndX = Math.round(endX * scale);
  const realEndY = Math.round(endY * scale);
  
  const swipeCommand = {
    id: Date.now().toString(),
    command: 'swipe',
    params: {
      startX: realStartX,
      startY: realStartY,
      endX: realEndX,
      endY: realEndY,
      duration: duration
    }
  };
  
  screenStreamState.ws.send(JSON.stringify(swipeCommand));
  console.log(`[ScreenStream] 发送滑动: (${realStartX},${realStartY}) -> (${realEndX},${realEndY})`);
  return true;
}

// 发送长按命令到设备
function sendLongPressToScreen(x, y, duration = 500) {
  if (!screenStreamState.ws || screenStreamState.ws.readyState !== WebSocket.OPEN) {
    console.warn('[ScreenStream] WebSocket未连接，无法发送长按');
    return false;
  }
  
  // 图片缩小到1/4，坐标需要放大回去
  const scale = 4;
  const realX = Math.round(x * scale);
  const realY = Math.round(y * scale);
  
  const command = {
    id: screenStreamState.currentStreamId || 'screen',
    command: 'long_press',
    params: {
      x: realX,
      y: realY,
      duration: duration
    }
  };
  
  screenStreamState.ws.send(JSON.stringify(command));
  console.log(`[ScreenStream] 发送长按: (${realX}, ${realY}) 持续 ${duration}ms`);
  return true;
}

// 发送双击命令到设备
function sendDoubleTapToScreen(x, y) {
  if (!screenStreamState.ws || screenStreamState.ws.readyState !== WebSocket.OPEN) {
    console.warn('[ScreenStream] WebSocket未连接，无法发送双击');
    return false;
  }
  
  // 图片缩小到1/4，坐标需要放大回去
  const scale = 4;
  const realX = Math.round(x * scale);
  const realY = Math.round(y * scale);
  
  const command = {
    id: screenStreamState.currentStreamId || 'screen',
    command: 'double_tap',
    params: {
      x: realX,
      y: realY
    }
  };
  
  screenStreamState.ws.send(JSON.stringify(command));
  console.log(`[ScreenStream] 发送双击: (${realX}, ${realY})`);
  return true;
}

// 发送快捷按键命令
function sendQuickKey(keycode) {
  if (!screenStreamState.ws || screenStreamState.ws.readyState !== WebSocket.OPEN) {
    console.warn('[ScreenStream] WebSocket未连接，无法发送按键');
    showPhoneNotification('请先开始投屏', 'warning');
    return false;
  }
  
  // 转换按键名称为APP期望的格式
  const keyMap = {
    'KEYCODE_BACK': 'back',
    'KEYCODE_HOME': 'home',
    'KEYCODE_APP_SWITCH': 'recents',
    'KEYCODE_VOLUME_UP': 'volume_up',
    'KEYCODE_VOLUME_DOWN': 'volume_down',
    'KEYCODE_POWER': 'power_dialog'
  };
  
  const key = keyMap[keycode] || keycode.toLowerCase();
  
  const command = {
    id: Date.now().toString(),
    command: 'press_key',
    params: {
      key: key
    }
  };
  
  screenStreamState.ws.send(JSON.stringify(command));
  console.log(`[ScreenStream] 发送按键: ${key}`);
  
  // 显示提示
  const keyNames = {
    'KEYCODE_BACK': '返回',
    'KEYCODE_HOME': 'Home',
    'KEYCODE_APP_SWITCH': '多任务',
    'KEYCODE_VOLUME_UP': '音量+',
    'KEYCODE_VOLUME_DOWN': '音量-',
    'KEYCODE_POWER': '电源'
  };
  showPhoneNotification(`已发送 ${keyNames[keycode] || keycode} 命令`, 'success');
  return true;
}

// 发送快捷命令（截图、旋转等）
function sendQuickCommand(cmd) {
  if (!screenStreamState.ws || screenStreamState.ws.readyState !== WebSocket.OPEN) {
    console.warn('[ScreenStream] WebSocket未连接，无法发送命令');
    showPhoneNotification('请先开始投屏', 'warning');
    return false;
  }
  
  const command = {
    id: screenStreamState.currentStreamId || 'screen',
    command: cmd
  };
  
  screenStreamState.ws.send(JSON.stringify(command));
  console.log(`[ScreenStream] 发送命令: ${cmd}`);
  
  // 显示提示
  const cmdNames = {
    'screenshot': '截图',
    'rotate_screen': '旋转屏幕'
  };
  showPhoneNotification(`已发送 ${cmdNames[cmd] || cmd} 命令`, 'success');
  return true;
}

// 初始化Canvas点击事件
function initScreenCanvasEvents(canvasId = 'screen-canvas') {
  const canvas = document.getElementById(canvasId);
  if (!canvas) {
    console.error(`Canvas元素 #${canvasId} 未找到`);
    return false;
  }
  
  // 长按和双击支持变量
  let longPressTimer = null;
  let lastClickTime = 0;
  let touchStartX = 0;
  let touchStartY = 0;
  let touchStartTime = 0;
  const LONG_PRESS_DURATION = 500; // 长按阈值
  const DOUBLE_TAP_INTERVAL = 300; // 双击间隔阈值
  
  // 坐标显示元素
  const coordsDisplay = document.getElementById('stream-coords');
  
  // 计算坐标的辅助函数（APP端缩小到1/3，需要还原成手机真实坐标）
  function getCanvasCoords(e) {
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) * (canvas.width / rect.width) * 3);
    const y = Math.floor((e.clientY - rect.top) * (canvas.height / rect.height) * 3);
    return { x, y };
  }
  
  // 更新坐标显示
  function updateCoordsDisplay(x, y) {
    if (coordsDisplay) {
      coordsDisplay.textContent = `X: ${x}, Y: ${y}`;
      coordsDisplay.classList.remove('hidden');
    }
  }
  
  // 鼠标移动时更新坐标
  canvas.addEventListener('mousemove', (e) => {
    if (!screenStreamState.isStreaming) return;
    const { x, y } = getCanvasCoords(e);
    updateCoordsDisplay(x, y);
  });
  
  // 鼠标离开时隐藏坐标
  canvas.addEventListener('mouseleave', () => {
    if (coordsDisplay) {
      coordsDisplay.classList.add('hidden');
    }
    // 清除长按计时器
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  });
  
  // mousedown - 开始长按计时
  canvas.addEventListener('mousedown', (e) => {
    if (!screenStreamState.isStreaming) return;
    
    const { x, y } = getCanvasCoords(e);
    touchStartX = x;
    touchStartY = y;
    touchStartTime = Date.now();
    
    // 清除之前的长按计时器
    if (longPressTimer) {
      clearTimeout(longPressTimer);
    }
    
    // 设置长按计时器
    longPressTimer = setTimeout(() => {
      // 长按触发
      sendLongPressToScreen(x, y, LONG_PRESS_DURATION);
      longPressTimer = null;
    }, LONG_PRESS_DURATION);
  });
  
  // mouseup - 处理点击、双击和滑动
  canvas.addEventListener('mouseup', (e) => {
    if (!screenStreamState.isStreaming) return;
    
    // 清除长按计时器
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    
    const { x: endX, y: endY } = getCanvasCoords(e);
    const duration = Date.now() - touchStartTime;
    const distance = Math.sqrt(
      Math.pow(endX - touchStartX, 2) + 
      Math.pow(endY - touchStartY, 2)
    );
    
    // 如果移动距离超过阈值，则视为滑动
    if (distance > 10) {
      sendSwipeToScreen(touchStartX, touchStartY, endX, endY, duration);
    } else {
      // 检测双击
      const now = Date.now();
      if (now - lastClickTime < DOUBLE_TAP_INTERVAL) {
        // 双击触发
        sendDoubleTapToScreen(endX, endY);
        lastClickTime = 0; // 重置，避免三击被误判
      } else {
        // 单击（延迟发送以等待可能的第二次点击）
        setTimeout(() => {
          if (Date.now() - lastClickTime >= DOUBLE_TAP_INTERVAL) {
            sendTapToScreen(endX, endY);
          }
        }, DOUBLE_TAP_INTERVAL);
        lastClickTime = now;
      }
    }
  });
  
  console.log('[ScreenStream] Canvas事件已初始化（支持长按、双击）');
  return true;
}

// 获取屏幕流状态
function getScreenStreamState() {
  return {
    isStreaming: screenStreamState.isStreaming,
    streamId: screenStreamState.currentStreamId,
    frameCount: screenStreamState.frameCount,
    deviceWidth: screenStreamState.deviceWidth,
    deviceHeight: screenStreamState.deviceHeight,
    fps: screenStreamState.lastFrameTime > 0 
      ? 1000 / (Date.now() - screenStreamState.lastFrameTime) 
      : 0
  };
}

// 导出屏幕流函数
window.startScreenStream = startScreenStream;
window.stopScreenStream = stopScreenStream;
window.sendTapToScreen = sendTapToScreen;
window.sendSwipeToScreen = sendSwipeToScreen;
window.sendLongPressToScreen = sendLongPressToScreen;
window.sendDoubleTapToScreen = sendDoubleTapToScreen;
window.sendQuickKey = sendQuickKey;
window.sendQuickCommand = sendQuickCommand;
window.initScreenCanvasEvents = initScreenCanvasEvents;
window.getScreenStreamState = getScreenStreamState;

// ==================== 技能面板管理 ====================

// 技能面板状态
let skillsPanelOpen = false;
let skillsList = [];
let filteredSkills = [];

// 切换技能面板
function toggleSkillsPanel() {
  const panel = document.getElementById('skills-panel');
  if (!panel) return;
  
  skillsPanelOpen = !skillsPanelOpen;
  
  if (skillsPanelOpen) {
    panel.classList.remove('translate-x-full');
    // 首次打开时加载技能列表
    if (skillsList.length === 0) {
      loadSkills();
    }
  } else {
    panel.classList.add('translate-x-full');
  }
}

window.toggleSkillsPanel = toggleSkillsPanel;

// 加载技能列表
async function loadSkills() {
  const container = document.getElementById('skills-list');
  if (!container) return;
  
  container.innerHTML = `
    <div class="text-center text-gray-400 dark:text-gray-600 py-8 text-sm">
      <svg class="w-6 h-6 mx-auto mb-2 animate-spin" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
      正在加载技能...
    </div>
  `;
  
  try {
    const result = await ipcRenderer.invoke('hermes-skills');
    
    if (result && result.success !== false) {
      // 解析技能列表
      if (typeof result === 'string') {
        try {
          skillsList = JSON.parse(result);
        } catch {
          skillsList = parseSkillsOutput(result);
        }
      } else if (Array.isArray(result)) {
        skillsList = result;
      } else if (result.skills) {
        skillsList = result.skills;
      } else {
        skillsList = [];
      }
      
      filteredSkills = [...skillsList];
      renderSkills();
    } else {
      throw new Error(result?.error || '加载失败');
    }
  } catch (error) {
    console.error('加载技能列表失败:', error);
    container.innerHTML = `
      <div class="text-center text-red-500 dark:text-red-400 py-8 text-sm">
        <svg class="w-6 h-6 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
        </svg>
        加载失败: ${error.message}
      </div>
    `;
  }
}

window.loadSkills = loadSkills;

// 解析hermes skills命令输出
function parseSkillsOutput(output) {
  const skills = [];
  const lines = output.split('\n').filter(line => line.trim());
  
  for (const line of lines) {
    // 尝试解析不同格式的技能信息
    if (line.includes('✓') || line.includes('[x]') || line.includes('enabled')) {
      const name = line.replace(/^[\s\-\*\[\]✓x]+/, '').split(/\s+/)[0];
      if (name) {
        skills.push({
          name,
          enabled: true,
          description: line
        });
      }
    } else if (line.includes('✗') || line.includes('[ ]') || line.includes('disabled')) {
      const name = line.replace(/^[\s\-\*\[\]✗]+/, '').split(/\s+/)[0];
      if (name) {
        skills.push({
          name,
          enabled: false,
          description: line
        });
      }
    } else if (line.match(/^[\w-]+:/)) {
      // 格式: skill-name: description
      const [name, ...descParts] = line.split(':');
      skills.push({
        name: name.trim(),
        enabled: true,
        description: descParts.join(':').trim()
      });
    }
  }
  
  return skills;
}

// 渲染技能列表
function renderSkills() {
  const container = document.getElementById('skills-list');
  if (!container) return;
  
  if (filteredSkills.length === 0) {
    container.innerHTML = `
      <div class="text-center text-gray-400 dark:text-gray-600 py-8 text-sm">
        ${skillsList.length === 0 ? '暂无已安装的技能' : '没有匹配的技能'}
      </div>
    `;
    return;
  }
  
  container.innerHTML = filteredSkills.map((skill, index) => {
    const isEnabled = skill.enabled !== false;
    const statusColor = isEnabled ? 'bg-green-500' : 'bg-gray-400';
    const statusText = isEnabled ? '已启用' : '已禁用';
    
    return `
      <div class="group p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
        <div class="flex items-start justify-between gap-2">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-1">
              <span class="font-medium text-gray-800 dark:text-gray-200 text-sm truncate">${escapeHtml(skill.name)}</span>
              <span class="w-2 h-2 rounded-full ${statusColor}" title="${statusText}"></span>
            </div>
            ${skill.description ? `<p class="text-xs text-gray-500 dark:text-gray-400 line-clamp-2">${escapeHtml(skill.description)}</p>` : ''}
          </div>
          <button 
            onclick="toggleSkill('${escapeHtml(skill.name)}', ${!isEnabled})"
            class="flex-shrink-0 px-2 py-1 text-xs rounded transition-colors ${isEnabled 
              ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-900/50' 
              : 'bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-300 dark:hover:bg-gray-500'}"
            title="${isEnabled ? '点击禁用' : '点击启用'}"
          >
            ${isEnabled ? '启用' : '禁用'}
          </button>
        </div>
      </div>
    `;
  }).join('');
}

// 切换技能状态
async function toggleSkill(skillName, enable) {
  try {
    const result = await ipcRenderer.invoke('hermes-skill-toggle', { name: skillName, enable });
    
    if (result && result.success !== false) {
      // 更新本地状态
      const skill = skillsList.find(s => s.name === skillName);
      if (skill) {
        skill.enabled = enable;
      }
      
      // 重新渲染
      const searchInput = document.getElementById('skills-search');
      if (searchInput && searchInput.value) {
        searchSkills(searchInput.value);
      } else {
        filteredSkills = [...skillsList];
        renderSkills();
      }
      
      showToast(`技能 "${skillName}" 已${enable ? '启用' : '禁用'}`, 'success');
    } else {
      throw new Error(result?.error || '操作失败');
    }
  } catch (error) {
    console.error('切换技能状态失败:', error);
    showToast(`操作失败: ${error.message}`, 'error');
  }
}

window.toggleSkill = toggleSkill;

// 搜索技能
function searchSkills(query) {
  const normalizedQuery = query.toLowerCase().trim();
  
  if (!normalizedQuery) {
    filteredSkills = [...skillsList];
  } else {
    filteredSkills = skillsList.filter(skill => 
      skill.name.toLowerCase().includes(normalizedQuery) ||
      (skill.description && skill.description.toLowerCase().includes(normalizedQuery))
    );
  }
  
  renderSkills();
}

window.searchSkills = searchSkills;

// 刷新技能列表
async function refreshSkills() {
  skillsList = [];
  await loadSkills();
  showToast('技能列表已刷新', 'success');
}

window.refreshSkills = refreshSkills;

// ==================== 屏幕投屏 UI 交互 ====================

// 开始投屏
async function handleStartStream() {
  const state = getScreenStreamState();
  if (state.isStreaming) {
    showToast('投屏已在运行中', 'warning');
    return;
  }
  
  // 获取设置
  const quality = parseInt(document.getElementById('stream-quality')?.value || '80');
  const fps = parseInt(document.getElementById('stream-fps-setting')?.value || '15');
  
  // 获取手机 IP 和端口
  const phoneConfig = await ipcRenderer.invoke('get-phone-config');
  if (!phoneConfig || !phoneConfig.ip) {
    showToast('请先连接手机', 'error');
    return;
  }
  
  // 显示加载状态
  const loading = document.getElementById('stream-loading');
  const placeholder = document.getElementById('stream-placeholder');
  const startBtn = document.getElementById('start-stream-btn');
  const stopBtn = document.getElementById('stop-stream-btn');
  const streamSection = document.getElementById('screen-stream-section');
  
  if (loading) loading.classList.remove('hidden');
  if (placeholder) placeholder.classList.add('hidden');
  if (startBtn) startBtn.classList.add('hidden');
  
  try {
    await startScreenStream(phoneConfig.ip, phoneConfig.port || '8765', {
      canvasId: 'screen-canvas',
      quality: quality,
      fps: fps,
      onConnect: (data) => {
        console.log('投屏已连接:', data);
        if (loading) loading.classList.add('hidden');
        if (placeholder) placeholder.classList.add('hidden');
        if (stopBtn) stopBtn.classList.remove('hidden');
        if (streamSection) streamSection.classList.remove('hidden');
        showToast('投屏已开始', 'success');
        
        // 显示 FPS 和延迟
        const fpsEl = document.getElementById('stream-fps');
        const latencyEl = document.getElementById('stream-latency');
        if (fpsEl) fpsEl.classList.remove('hidden');
        if (latencyEl) latencyEl.classList.remove('hidden');
        
        // 显示投屏控制按钮
        const controlBtns = document.getElementById('stream-control-btns');
        if (controlBtns) controlBtns.classList.remove('hidden');
        
        // 初始化 Canvas 点击事件
        initScreenCanvasEvents('screen-canvas');
      },
      onFrame: (data) => {
        // 更新 FPS 显示
        const fpsEl = document.getElementById('stream-fps');
        if (fpsEl && data.fps) {
          fpsEl.textContent = `${Math.round(data.fps)} FPS`;
        }
      },
      onError: (error) => {
        console.error('投屏错误:', error);
        if (loading) loading.classList.add('hidden');
        if (placeholder) placeholder.classList.remove('hidden');
        if (startBtn) startBtn.classList.remove('hidden');
        if (stopBtn) stopBtn.classList.add('hidden');
        showToast('投屏失败: ' + error, 'error');
      },
      onClose: () => {
        console.log('投屏已关闭');
        if (loading) loading.classList.add('hidden');
        if (placeholder) placeholder.classList.remove('hidden');
        if (startBtn) startBtn.classList.remove('hidden');
        if (stopBtn) stopBtn.classList.add('hidden');
        
        const fpsEl = document.getElementById('stream-fps');
        const latencyEl = document.getElementById('stream-latency');
        if (fpsEl) fpsEl.classList.add('hidden');
        if (latencyEl) latencyEl.classList.add('hidden');
        
        // 隐藏投屏控制按钮
        const controlBtns = document.getElementById('stream-control-btns');
        if (controlBtns) controlBtns.classList.add('hidden');
        
      }
    });
  } catch (error) {
    console.error('启动投屏失败:', error);
    if (loading) loading.classList.add('hidden');
    if (placeholder) placeholder.classList.remove('hidden');
    if (startBtn) startBtn.classList.remove('hidden');
    showToast('启动投屏失败: ' + error.message, 'error');
  }
}

// 停止投屏
function handleStopStream() {
  stopScreenStream();
  
  const placeholder = document.getElementById('stream-placeholder');
  const startBtn = document.getElementById('start-stream-btn');
  const stopBtn = document.getElementById('stop-stream-btn');
  const fpsEl = document.getElementById('stream-fps');
  const latencyEl = document.getElementById('stream-latency');
  const controlBtns = document.getElementById('stream-control-btns');
  
  if (placeholder) placeholder.classList.remove('hidden');
  if (startBtn) startBtn.classList.remove('hidden');
  if (stopBtn) stopBtn.classList.add('hidden');
  if (fpsEl) fpsEl.classList.add('hidden');
  if (latencyEl) latencyEl.classList.add('hidden');
  if (controlBtns) controlBtns.classList.add('hidden');
  
  showToast('投屏已停止', 'info');
}

// 全屏投屏
function handleFullscreenStream() {
  const canvas = document.getElementById('screen-canvas');
  if (!canvas) return;
  
  if (canvas.requestFullscreen) {
    canvas.requestFullscreen();
  } else if (canvas.webkitRequestFullscreen) {
    canvas.webkitRequestFullscreen();
  } else if (canvas.msRequestFullscreen) {
    canvas.msRequestFullscreen();
  }
}

// 显示投屏区域（连接手机后调用）
function showStreamSection() {
  const section = document.getElementById('screen-stream-section');
  if (section) section.classList.remove('hidden');
}

// 隐藏投屏区域
function hideStreamSection() {
  const section = document.getElementById('screen-stream-section');
  if (section) section.classList.add('hidden');
  
  // 如果正在投屏，先停止
  const state = getScreenStreamState();
  if (state.isStreaming) {
    stopScreenStream();
  }
}

window.handleStartStream = handleStartStream;
window.handleStopStream = handleStopStream;
window.handleFullscreenStream = handleFullscreenStream;
window.showStreamSection = showStreamSection;
window.hideStreamSection = hideStreamSection;
