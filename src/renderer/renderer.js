/**
 * 晨翼Agent - 渲染进程
 * macOS 风格桌面 UI
 */

const { ipcRenderer } = require('electron');

// ==================== 状态管理 ====================
const state = {
  isLoggedIn: false,
  user: null,
  messages: [],
  sessions: [],
  currentSessionId: null,
  isLoading: false,
  kernelReady: false,
  totalUsage: { prompt: 0, completion: 0, total: 0 },
  quotingMessage: null,
  editingMessageId: null,
  abortController: null,
  tools: {
    enabled: new Set(['read', 'write', 'edit', 'exec', 'process', 'web_search', 'web_fetch', 'memory_get', 'memory_search']),
    configs: {},
    usage: []
  },
  showThinking: true,
  showTools: true,
  // 记忆管理
  memories: [],
  memorySearchQuery: '',
  // 系统监控状态
  systemStats: {
    ipc: { requests: 0, successes: 0, failures: 0, retries: 0 },
    circuitBreaker: { state: 'CLOSED', failures: 0 },
    kernel: { ready: false, running: false, restartAttempts: 0 },
    logs: { errors: 0, warnings: 0 }
  },
  errors: [],
  performance: {
    requestTime: 0,
    slowOperations: [],
    retryCount: 0
  }
};

let currentModel = localStorage.getItem('currentModel') || 'glm-4-flash';

// ==================== 性能优化工具 ====================
const debounce = (fn, delay) => {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
};

const throttle = (fn, limit) => {
  let inThrottle = false;
  return (...args) => {
    if (!inThrottle) {
      fn(...args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
};

// ==================== 初始化 ====================
document.addEventListener('DOMContentLoaded', () => {
  loadSavedCredentials();
  setupInputEvents();
  startClock();
  setupDockEffects();
  initWindows();
  initSystemMonitoring();
});

// 初始化窗口管理
function initWindows() {
  // 使用新的窗口管理器（如果可用）
  if (window.windowManager) {
    window.windowManager.register('window-chat', {
      title: '晨翼对话',
      icon: '💬',
      appId: 'chat',
      width: 900,
      height: 600,
      x: (window.innerWidth - 900) / 2,
      y: 60
    });
    window.windowManager.focus('window-chat');
  }
  // 注意：移除了 initResizeHandles 调用，WindowManager 已内置调整大小功能
}

// 时钟 - 优化：减少更新频率
let clockInterval = null;
function startClock() {
  function updateTime() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    const dateStr = now.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
    const el = document.getElementById('menu-time');
    if (el) el.textContent = `${dateStr} ${timeStr}`;
  }
  updateTime();
  // 清理旧的定时器
  if (clockInterval) clearInterval(clockInterval);
  clockInterval = setInterval(updateTime, 1000);
}

// Dock 动效 - 优化：使用 CSS will-change 和 requestAnimationFrame
function setupDockEffects() {
  const dockItems = document.querySelectorAll('.dock-item');
  
  // 预先标记 will-change
  dockItems.forEach(item => {
    item.style.willChange = 'transform';
  });
  
  dockItems.forEach((item, index) => {
    item.addEventListener('mouseenter', () => {
      // 使用 requestAnimationFrame 批量更新
      requestAnimationFrame(() => {
        dockItems.forEach((otherItem, otherIndex) => {
          const distance = Math.abs(index - otherIndex);
          if (distance === 1) {
            otherItem.style.transform = 'scale(1.15) translateY(-4px)';
          } else if (distance === 2) {
            otherItem.style.transform = 'scale(1.05) translateY(-2px)';
          }
        });
      });
    });
    
    item.addEventListener('mouseleave', () => {
      requestAnimationFrame(() => {
        dockItems.forEach(otherItem => {
          otherItem.style.transform = '';
        });
      });
    });
  });
}

// 输入事件 - 优化：添加防抖
function setupInputEvents() {
  const input = document.getElementById('chat-input');
  if (!input) return;
  
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  
  // 使用防抖优化输入事件
  const updateInputHeight = debounce(() => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 150) + 'px';
  const charCount = document.getElementById('input-chars');
    if (charCount) charCount.textContent = `${input.value.length} 字符`;
  }, 50);
  
  input.addEventListener('input', updateInputHeight);
}

// ==================== 登录 ====================
function loadSavedCredentials() {
  const saved = localStorage.getItem('chenyi_credentials');
  if (saved) {
    try {
      const { username, password } = JSON.parse(saved);
      const usernameEl = document.getElementById('login-username');
      const passwordEl = document.getElementById('login-password');
      const rememberEl = document.getElementById('remember-me');
      if (usernameEl) usernameEl.value = username || '';
      if (passwordEl) passwordEl.value = password || '';
      if (rememberEl) rememberEl.checked = true;
    } catch (e) {}
  }
}

async function handleLogin(event) {
  if (event) event.preventDefault();
  
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const remember = document.getElementById('remember-me').checked;
  const btn = document.getElementById('login-btn');
  const errorDiv = document.getElementById('login-error');
  
  if (!username || !password) {
    showError('请输入用户名和密码');
    return;
  }
  
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span><span>登录中...</span>';
  errorDiv.style.display = 'none';
  
  try {
    // 先确保内核初始化
    const kernelStatus = await ipcRenderer.invoke('kernel:status');
    if (!kernelStatus.connected) {
      // 尝试初始化内核
      const initResult = await ipcRenderer.invoke('agent:init', {});
      if (!initResult.success) {
        showError('内核初始化失败: ' + (initResult.error || '未知错误'));
        return;
      }
    }
    
    // 调用登录接口 - 使用用户名
    const result = await ipcRenderer.invoke('login', { username, password });
    
    if (result.success) {
      if (remember) {
        localStorage.setItem('chenyi_credentials', JSON.stringify({ username, password }));
      } else {
        localStorage.removeItem('chenyi_credentials');
      }
      
      if (result.token) {
        localStorage.setItem('chenyi_token', result.token);
      }
      
      state.isLoggedIn = true;
      state.user = result.user;
      
      // 更新用户信息显示
      const userNameEl = document.getElementById('user-name');
      if (userNameEl && result.user) {
        userNameEl.textContent = result.user.name || result.user.username || '用户';
      }
      
      showDesktop();
      showNotification('登录成功', 'success');
      
      // 初始化应用并加载会话
      await initializeApp();
      await loadSessions();
    } else {
      showError(result.error || '登录失败');
    }
  } catch (err) {
    console.error('[Login] 登录错误:', err);
    showError('登录失败: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span>登录</span>';
  }
}

async function handleRegister(event) {
  if (event) event.preventDefault();
  
  const name = document.getElementById('register-name').value.trim();
  const username = document.getElementById('register-username').value.trim();
  const password = document.getElementById('register-password').value;
  
  if (!name || !username || !password) {
    showNotification('请填写完整信息', 'error');
    return;
  }
  
  if (password.length < 6) {
    showNotification('密码至少6位', 'error');
    return;
  }
  
  try {
    // 先确保内核初始化
    const kernelStatus = await ipcRenderer.invoke('kernel:status');
    if (!kernelStatus.connected) {
      const initResult = await ipcRenderer.invoke('agent:init', {});
      if (!initResult.success) {
        showNotification('内核初始化失败', 'error');
        return;
      }
    }
    
    // 调用注册接口 - 使用用户名
    const result = await ipcRenderer.invoke('register', { 
      username, 
      password, 
      name 
    });
    
    if (result.success) {
      showNotification('注册成功，请登录', 'success');
      closeRegisterModal();
      document.getElementById('login-username').value = username;
      document.getElementById('login-password').value = '';
    } else {
      showNotification(result.error || '注册失败', 'error');
    }
  } catch (err) {
    console.error('[Register] 注册错误:', err);
    showNotification('注册失败: ' + err.message, 'error');
  }
}

function showError(message) {
  const errorDiv = document.getElementById('login-error');
  if (errorDiv) {
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
  }
}

function showDesktop() {
  document.getElementById('login-overlay').classList.add('hidden');
  document.getElementById('macos-desktop').classList.remove('hidden');
}

// ==================== 应用初始化 ====================
async function initializeApp() {
  try {
    // 检查内核状态
    const kernelStatus = await ipcRenderer.invoke('kernel:status');
    state.kernelReady = kernelStatus.connected;
    
    if (!kernelStatus.connected) {
      console.log('[App] 内核未就绪，尝试初始化...');
      const initResult = await ipcRenderer.invoke('agent:init', {});
      state.kernelReady = initResult.success;
    }
    
    console.log('[App] 初始化完成，内核:', state.kernelReady);
    
    // 如果已登录，设置云端配置
    const token = localStorage.getItem('chenyi_token');
    if (token && state.kernelReady) {
      await ipcRenderer.invoke('connect', token);
    }
  } catch (err) {
    console.error('[App] 初始化失败:', err);
  }
}

// ==================== 面板切换 ====================
function switchPanel(panelName) {
  // 更新工具栏按钮状态
  document.querySelectorAll('.toolbar-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  const activeBtn = document.getElementById(`btn-${panelName}`);
  if (activeBtn) activeBtn.classList.add('active');
  
  // 更新 Dock 状态
  document.querySelectorAll('.dock-item').forEach(item => {
    item.classList.remove('active');
  });
  
  // 这里可以根据 panelName 切换不同的面板内容
  // 当前只实现聊天面板
}

// ==================== 会话管理 ====================
async function loadSessions() {
  try {
    const result = await ipcRenderer.invoke('session:list');
    
    if (result.success && result.sessions) {
      state.sessions = result.sessions.map(s => ({
        session_id: s.session_id || s.id,
        title: s.title || '新对话',
        started_at: s.started_at || s.created_at || Date.now(),
        last_interaction_at: s.last_interaction_at || s.updatedAt || Date.now(),
        messages: s.messages || []
      }));
      
      renderSessionList();
      
      if (state.sessions.length > 0) {
        const lastSession = state.sessions.sort((a, b) => 
          new Date(b.last_interaction_at) - new Date(a.last_interaction_at)
        )[0];
        await switchToSession(lastSession.session_id);
      } else {
        await createNewSession();
      }
    }
  } catch (err) {
    console.error('[Session] 加载失败:', err);
  }
}

function renderSessionList(filter = '') {
  const container = document.getElementById('session-list');
  if (!container) return;
  
  // 过滤会话
  let filteredSessions = state.sessions;
  if (filter) {
    const lowerFilter = filter.toLowerCase();
    filteredSessions = state.sessions.filter(s => {
      const title = getSessionTitle(s).toLowerCase();
      return title.includes(lowerFilter);
    });
  }
  
  const sessionsHtml = filteredSessions.map((session, index) => `
    <div class="session-item ${session.session_id === state.currentSessionId ? 'active' : ''}" 
         data-session-id="${session.session_id}"
         onclick="switchToSession('${session.session_id}')"
         ondblclick="renameSession('${session.session_id}')">
      <span class="session-icon">💬</span>
      <div class="session-info">
        <div class="session-name">${escapeHtml(getSessionTitle(session))}</div>
        <div class="session-time">${formatTime(session.last_interaction_at)}</div>
      </div>
      <span class="session-close" onclick="event.stopPropagation(); deleteSession('${session.session_id}')">✕</span>
    </div>
  `).join('');
  
  container.innerHTML = sessionsHtml + `
    <div class="session-add" onclick="createNewSession()">
      <span>+ 新建对话</span>
    </div>
  `;
}

function searchSessions(query) {
  renderSessionList(query);
}

function getSessionTitle(session) {
  if (session.title && session.title !== '新对话') return session.title;
  const date = new Date(session.started_at || session.last_interaction_at);
  return `会话 ${date.toLocaleDateString('zh-CN')}`;
}

async function createNewSession() {
  try {
    const result = await ipcRenderer.invoke('session:create', '新对话');
    
    if (result.success && result.sessionId) {
      const newSession = {
        session_id: result.sessionId,
        title: result.session?.title || '新对话',
        started_at: Date.now(),
        last_interaction_at: Date.now(),
      };
      
      state.sessions.unshift(newSession);
      state.currentSessionId = result.sessionId;
      state.messages = [];
      
      renderSessionList();
      renderMessages();
      updateWindowTitle('新对话');
    }
  } catch (err) {
    console.error('[Session] 创建失败:', err);
  }
}

async function switchToSession(sessionId) {
  if (state.currentSessionId === sessionId) return;
  
  state.currentSessionId = sessionId;
  state.messages = [];
  
  renderSessionList();
  
  try {
    const result = await ipcRenderer.invoke('session:switch', sessionId);
    
    if (result.success && result.messages) {
      state.messages = result.messages.map(m => ({
        id: m.id || `msg_${Date.now()}_${Math.random()}`,
        role: m.role,
        content: m.content,
        timestamp: m.timestamp || Date.now(),
        thinking: m.thinking,
        tool_results: m.tool_results
      }));
      renderMessages();
    }
    
    const session = state.sessions.find(s => s.session_id === sessionId);
    updateWindowTitle(session ? getSessionTitle(session) : '对话');
  } catch (err) {
    console.error('[Session] 切换失败:', err);
  }
}

async function deleteSession(sessionId) {
  if (!confirm('确定删除这个会话吗？')) return;
  
  try {
    const result = await ipcRenderer.invoke('session:delete', sessionId);
    
    if (result.success) {
      state.sessions = state.sessions.filter(s => s.session_id !== sessionId);
      
      if (state.currentSessionId === sessionId) {
        if (state.sessions.length > 0) {
          await switchToSession(state.sessions[0].session_id);
        } else {
          await createNewSession();
        }
      }
      
      renderSessionList();
    }
  } catch (err) {
    console.error('[Session] 删除失败:', err);
  }
}

// ==================== 聊天核心 ====================
async function sendMessage() {
  const input = document.getElementById('chat-input');
  const content = input.value.trim();
  
  if (!content || state.isLoading) return;
  
  const startTime = Date.now();
  
  const userMsg = {
    id: `msg_${Date.now()}_user`,
    role: 'user',
    content: content,
    timestamp: Date.now()
  };
  
  if (state.quotingMessage) {
    userMsg.quote = {
      role: state.quotingMessage.role,
      content: state.quotingMessage.content.substring(0, 100)
    };
    cancelQuote();
  }
  
  addMessageToState(userMsg);
  renderMessages();
  
  input.value = '';
  input.style.height = 'auto';
  document.getElementById('input-chars').textContent = '0 字符';
  
  state.isLoading = true;
  showTypingIndicator();
  updateSendButton();
  
  const streamMsgId = `stream_${Date.now()}`;
  let streamContent = '';
  let toolCalls = [];
  let thinkingContent = '';
  let retryCount = 0;
  
  const streamHandler = (event, data) => {
    switch (data.type) {
      case 'start':
        hideTypingIndicator();
        addStreamMessage(streamMsgId, 'assistant', '');
        break;
        
      case 'text_delta':
        streamContent += data.delta;
        updateStreamMessage(streamMsgId, streamContent, toolCalls, thinkingContent);
        break;
        
      case 'thinking_delta':
        thinkingContent += data.delta;
        updateStreamMessage(streamMsgId, streamContent, toolCalls, thinkingContent);
        break;
        
      case 'tool_call_start':
        toolCalls.push({
          id: data.id || `tool_${Date.now()}`,
          name: data.name,
          status: 'running',
          args: '',
          result: null
        });
        updateStreamMessage(streamMsgId, streamContent, toolCalls, thinkingContent);
        showNotification(`🔧 调用工具: ${data.name}`, 'info');
        break;
        
      case 'tool_call_args':
        const tool = toolCalls.find(t => t.id === data.id);
        if (tool) {
          tool.args += data.delta;
          updateStreamMessage(streamMsgId, streamContent, toolCalls, thinkingContent);
        }
        break;
        
      case 'tool_call_result':
        const toolResult = toolCalls.find(t => t.id === data.id);
        if (toolResult) {
          toolResult.status = data.success ? 'success' : 'error';
          toolResult.result = data.result;
          updateStreamMessage(streamMsgId, streamContent, toolCalls, thinkingContent);
        }
        break;
        
      case 'done':
        const duration = Date.now() - startTime;
        showPerformanceMonitor(duration, 'chat');
        finalizeStreamMessage(streamMsgId, streamContent, toolCalls, thinkingContent);
        ipcRenderer.removeListener('agent:stream-event', streamHandler);
        state.isLoading = false;
        updateSendButton();
        
        state.messages.push({
          id: `msg_${Date.now()}_assistant`,
          role: 'assistant',
          content: data.content || streamContent,
          timestamp: Date.now(),
          thinking: thinkingContent,
          tool_results: toolCalls
        });
        updateMessageCount();
        break;
        
      case 'error':
        const errorDuration = Date.now() - startTime;
        showPerformanceMonitor(errorDuration, 'chat-error');
        updateStreamMessage(streamMsgId, `❌ 错误: ${data.message}`, [], '');
        ipcRenderer.removeListener('agent:stream-event', streamHandler);
        state.isLoading = false;
        updateSendButton();
        
        // 记录错误
        handleSystemError({
          type: 'chat',
          message: data.message,
          details: data
        });
        break;
        
      case 'retry':
        retryCount++;
        incrementRetryCount();
        showNotification(`重试中... (${retryCount})`, 'warning');
        break;
    }
  };
  
  ipcRenderer.on('agent:stream-event', streamHandler);
  
  state.abortController = () => {
    ipcRenderer.removeListener('agent:stream-event', streamHandler);
  };
  
  try {
    const result = await ipcRenderer.invoke('agent:chat-stream', content, state.currentSessionId, {
      model: currentModel
    });
    
    if (!result.success) {
      const errorDuration = Date.now() - startTime;
      showPerformanceMonitor(errorDuration, 'chat-failed');
      hideTypingIndicator();
      addMessageToState({
        id: `msg_${Date.now()}_error`,
        role: 'error',
        content: result.error || '请求失败',
        timestamp: Date.now()
      });
      renderMessages();
      state.isLoading = false;
      updateSendButton();
      ipcRenderer.removeListener('agent:stream-event', streamHandler);
      
      handleSystemError({
        type: 'chat',
        message: result.error || '请求失败',
        details: result
      });
    }
  } catch (err) {
    const errorDuration = Date.now() - startTime;
    showPerformanceMonitor(errorDuration, 'chat-exception');
    hideTypingIndicator();
    addMessageToState({
      id: `msg_${Date.now()}_error`,
      role: 'error',
      content: '发送失败: ' + err.message,
      timestamp: Date.now()
    });
    renderMessages();
    state.isLoading = false;
    updateSendButton();
    ipcRenderer.removeListener('agent:stream-event', streamHandler);
    
    handleSystemError({
      type: 'network',
      message: err.message,
      details: err
    });
  }
}

// ==================== 消息渲染 - 优化：使用 DocumentFragment ====================
function renderMessages() {
  const container = document.getElementById('chat-messages');
  if (!container) return;
  
  // 使用 DocumentFragment 减少 DOM 操作
  const fragment = document.createDocumentFragment();
  const tempDiv = document.createElement('div');
  
  state.messages.forEach((msg, index) => {
    tempDiv.innerHTML = renderMessage(msg, index);
    fragment.appendChild(tempDiv.firstElementChild.cloneNode(true));
  });
  
  // 一次性更新 DOM
  container.innerHTML = '';
  container.appendChild(fragment);
  scrollToBottom();
}

function renderMessage(msg, index) {
  const avatar = msg.role === 'user' ? '👤' : (msg.role === 'assistant' ? '🦐' : '❌');
  const roleName = msg.role === 'user' ? '你' : (msg.role === 'assistant' ? '晨翼' : '错误');
  
  let thinkingHtml = '';
  if (state.showThinking && msg.thinking) {
    thinkingHtml = `
      <div class="thinking-block collapsed">
        <div class="thinking-header" onclick="toggleThinking(this)">
          <span class="thinking-icon">💭</span>
          <span class="thinking-title">思考过程</span>
          <span class="thinking-toggle">▼</span>
        </div>
        <div class="thinking-body">${escapeHtml(msg.thinking)}</div>
      </div>
    `;
  }
  
  let toolsHtml = '';
  if (state.showTools && msg.tool_results && msg.tool_results.length > 0) {
    toolsHtml = msg.tool_results.map(tool => `
      <div class="tool-call">
        <div class="tool-header">
          <span class="tool-icon">🔧</span>
          <span class="tool-name">${escapeHtml(tool.name)}</span>
          <span class="tool-status ${tool.status}">${getToolStatusText(tool.status)}</span>
        </div>
        ${tool.result ? `<div class="tool-body">${escapeHtml(formatToolResult(tool.result))}</div>` : ''}
      </div>
    `).join('');
  }
  
  return `
    <div class="message ${msg.role}" data-id="${msg.id}">
      <div class="message-avatar">${avatar}</div>
      <div class="message-content">
        <div class="message-header">
          <span class="message-role">${roleName}</span>
          <span class="message-time">${formatTime(msg.timestamp)}</span>
        </div>
        ${thinkingHtml}
        ${toolsHtml}
        <div class="message-text">${formatContent(msg.content)}</div>
        <div class="message-actions">
          <button class="msg-action-btn" onclick="copyMessage('${msg.id}')">📋 复制</button>
          <button class="msg-action-btn" onclick="quoteMessage('${msg.id}')">💬 引用</button>
          ${msg.role === 'user' ? `<button class="msg-action-btn" onclick="editMessage('${msg.id}')">✏️ 编辑</button>` : ''}
          ${msg.role === 'assistant' ? `<button class="msg-action-btn" onclick="regenerateMessage()">🔄 重试</button>` : ''}
          <button class="msg-action-btn" onclick="deleteMessage('${msg.id}')">🗑️ 删除</button>
          ${msg.role === 'assistant' ? `
          <div class="feedback-buttons">
            <button class="feedback-btn positive" onclick="giveFeedback('${msg.id}', 'positive')" title="有帮助">👍</button>
            <button class="feedback-btn negative" onclick="giveFeedback('${msg.id}', 'negative')" title="没帮助">👎</button>
          </div>` : ''}
        </div>
      </div>
    </div>
  `;
}

function addMessageToState(msg) {
  state.messages.push(msg);
}

function addStreamMessage(id, role, content) {
  const container = document.getElementById('chat-messages');
  if (!container) return;
  
  const msgHtml = `
    <div class="message ${role}" data-id="${id}">
      <div class="message-avatar">🦐</div>
      <div class="message-content">
        <div class="message-header">
          <span class="message-role">晨翼</span>
          <span class="message-time">正在输入...</span>
        </div>
        <div class="message-text">${content}<span class="streaming-cursor"></span></div>
      </div>
    </div>
  `;
  
  container.insertAdjacentHTML('beforeend', msgHtml);
  scrollToBottom();
}

// 流式消息更新 - 优化：减少 DOM 操作频率
let streamUpdateRaf = null;
function updateStreamMessage(id, content, tools, thinking) {
  // 取消之前的更新
  if (streamUpdateRaf) {
    cancelAnimationFrame(streamUpdateRaf);
  }
  
  streamUpdateRaf = requestAnimationFrame(() => {
    const msgEl = document.querySelector(`[data-id="${id}"]`);
    if (!msgEl) return;
    
    const textEl = msgEl.querySelector('.message-text');
    if (textEl) {
      textEl.innerHTML = formatContent(content) + '<span class="streaming-cursor"></span>';
    }
    
    scrollToBottom();
  });
}

function finalizeStreamMessage(id, content, tools, thinking) {
  const msgEl = document.querySelector(`[data-id="${id}"]`);
  if (!msgEl) return;
  
  const timeEl = msgEl.querySelector('.message-time');
  if (timeEl) {
    timeEl.textContent = formatTime(Date.now());
  }
  
  const textEl = msgEl.querySelector('.message-text');
  if (textEl) {
    textEl.innerHTML = formatContent(content);
  }
}

// ==================== 辅助函数 ====================
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatTime(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return date.toLocaleDateString('zh-CN', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatContent(content) {
  if (!content) return '';
  
  let html = escapeHtml(content);
  
  // 代码块
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, code) => {
    return `<pre><span class="code-lang">${lang || 'code'}</span><code>${code.trim()}</code><button class="code-copy" onclick="copyCode(this)">复制</button></pre>`;
  });
  
  // 行内代码
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  
  // 粗体
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  
  // 斜体
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  
  // 链接
  html = html.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" style="color: var(--accent-light);">$1</a>');
  
  return html;
}

function formatToolResult(result) {
  if (typeof result === 'string') {
    return result.length > 300 ? result.substring(0, 300) + '...' : result;
  }
  try {
    const str = JSON.stringify(result, null, 2);
    return str.length > 300 ? str.substring(0, 300) + '...' : str;
  } catch (e) {
    return String(result).substring(0, 300);
  }
}

function getToolStatusText(status) {
  const texts = {
    running: '执行中',
    success: '成功',
    error: '失败'
  };
  return texts[status] || status;
}

// 滚动到底部 - 优化：使用 requestAnimationFrame
function scrollToBottom() {
  const container = document.getElementById('chat-messages');
  if (container) {
    requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
  }
}

// ==================== UI 操作 ====================
function showTypingIndicator() {
  const container = document.getElementById('chat-messages');
  if (!container) return;
  
  const indicator = `
    <div class="message assistant" id="typing-indicator">
      <div class="message-avatar">🦐</div>
      <div class="typing-indicator">
        <div class="typing-dots">
          <span></span>
          <span></span>
          <span></span>
        </div>
        <span>正在思考...</span>
      </div>
    </div>
  `;
  
  container.insertAdjacentHTML('beforeend', indicator);
  scrollToBottom();
}

function hideTypingIndicator() {
  const indicator = document.getElementById('typing-indicator');
  if (indicator) indicator.remove();
}

function updateSendButton() {
  const btn = document.getElementById('btn-send');
  if (btn) {
    btn.disabled = state.isLoading;
  }
}

function updateMessageCount() {
  const el = document.getElementById('msg-count');
  if (el) {
    el.textContent = state.messages.length;
  }
}

function updateWindowTitle(title) {
  const el = document.getElementById('window-title');
  if (el) {
    el.textContent = title || '晨翼对话';
  }
}

// ==================== 消息操作 ====================
function copyMessage(id) {
  // 支持 id 或 index
  let msg;
  if (typeof id === 'string') {
    msg = state.messages.find(m => m.id === id);
  } else {
    msg = state.messages[id];
  }
  
  if (msg) {
    navigator.clipboard.writeText(msg.content).then(() => {
      showNotification('已复制到剪贴板', 'success');
    }).catch(err => {
      showNotification('复制失败: ' + err.message, 'error');
    });
  }
}

function copyCode(btn) {
  const pre = btn.closest('pre');
  const codeEl = pre?.querySelector('code');
  const code = codeEl?.textContent || '';
  
  navigator.clipboard.writeText(code).then(() => {
    btn.textContent = '已复制';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.textContent = '复制';
      btn.classList.remove('copied');
    }, 2000);
    showNotification('代码已复制', 'success');
  }).catch(err => {
    showNotification('复制失败', 'error');
  });
}

function editMessage(id) {
  const msg = state.messages.find(m => m.id === id);
  if (msg) {
    const input = document.getElementById('chat-input');
    if (input) {
      input.value = msg.content;
      input.focus();
    }
  }
}

function deleteMessage(id) {
  if (confirm('确定删除这条消息吗？')) {
    const index = state.messages.findIndex(m => m.id === id);
    if (index !== -1) {
      state.messages.splice(index, 1);
      renderMessages();
      showNotification('消息已删除', 'success');
    }
  }
}

function quoteMessage(id) {
  const msg = state.messages.find(m => m.id === id);
  if (msg && msg.role !== 'assistant') {
    state.quotingMessage = msg;
    const input = document.getElementById('chat-input');
    if (input) {
      input.placeholder = `回复: ${msg.content.substring(0, 50)}...`;
      input.focus();
    }
    showNotification('引用消息已选中', 'info');
  } else if (msg && msg.role === 'assistant') {
    // AI消息直接复制内容到输入框
    const input = document.getElementById('chat-input');
    if (input) {
      input.value = msg.content;
      input.focus();
    }
  }
}

function cancelQuote() {
  state.quotingMessage = null;
  const input = document.getElementById('chat-input');
  if (input) {
    input.placeholder = '输入消息... (Ctrl+Enter 发送)';
  }
}

function giveFeedback(id, type) {
  const msg = state.messages.find(m => m.id === id);
  if (msg) {
    msg.feedback = type;
    showNotification(type === 'positive' ? '👍 感谢反馈！' : '👎 已记录反馈', 'success');
    // 可以发送到服务器
    console.log('[Feedback]', id, type);
  }
}

function handleAttach() {
  // 预留文件上传功能
  showNotification('附件功能开发中...', 'info');
}

async function regenerateMessage() {
  // 找到最后一条用户消息
  const userMsg = [...state.messages].reverse().find(m => m.role === 'user');
  if (userMsg) {
    const input = document.getElementById('chat-input');
    if (input) {
      input.value = userMsg.content;
      // 删除该消息之后的所有消息
      const index = state.messages.findIndex(m => m.id === userMsg.id);
      state.messages = state.messages.slice(0, index);
      renderMessages();
      await sendMessage();
    }
  }
}

function toggleThinking(header) {
  const block = header.closest('.thinking-block');
  if (block) {
    block.classList.toggle('collapsed');
  }
}

function cancelQuote() {
  state.quotingMessage = null;
}

// ==================== 窗口管理 ====================
// WindowManager 已移至 components/WindowManager.js，通过 window.windowManager 使用

// ==================== 窗口拖拽 - 修复：使用 requestAnimationFrame 优化 ====================
let dragState = {
  isDragging: false,
  windowId: null,
  startX: 0,
  startY: 0,
  windowStartX: 0,
  windowStartY: 0,
  rafId: null
};

function startDragWindow(event, windowId) {
  // 阻止在控制按钮区域拖拽
  if (event.target.closest('.window-controls') || 
      event.target.closest('.window-toolbar') ||
      event.target.classList.contains('window-btn')) {
    return;
  }
  
  const windowEl = document.getElementById(windowId);
  if (!windowEl || windowEl.classList.contains('maximized')) return;
  
  event.preventDefault();
  
  dragState.isDragging = true;
  dragState.windowId = windowId;
  dragState.startX = event.clientX;
  dragState.startY = event.clientY;
  dragState.windowStartX = windowEl.offsetLeft;
  dragState.windowStartY = windowEl.offsetTop;
  
  // 添加拖拽样式
  windowEl.classList.add('dragging');
  
  // 如果有 WindowManager，使用它的 focus
  if (window.windowManager) {
    window.windowManager.focus(windowId);
  }
  
  document.addEventListener('mousemove', onDragWindow, { passive: true });
  document.addEventListener('mouseup', stopDragWindow);
}

function onDragWindow(event) {
  if (!dragState.isDragging) return;
  
  // 取消之前的 RAF
  if (dragState.rafId) {
    cancelAnimationFrame(dragState.rafId);
  }
  
  // 使用 requestAnimationFrame 优化
  dragState.rafId = requestAnimationFrame(() => {
    const windowEl = document.getElementById(dragState.windowId);
    if (!windowEl) return;
    
    const deltaX = event.clientX - dragState.startX;
    const deltaY = event.clientY - dragState.startY;
    
    const newX = dragState.windowStartX + deltaX;
    const newY = Math.max(28, dragState.windowStartY + deltaY); // 不超过菜单栏
    
    windowEl.style.left = newX + 'px';
    windowEl.style.top = newY + 'px';
    windowEl.style.transform = 'none';
  });
}

function stopDragWindow() {
  if (!dragState.isDragging) return;
  
  // 取消未完成的 RAF
  if (dragState.rafId) {
    cancelAnimationFrame(dragState.rafId);
  }
  
  const windowEl = document.getElementById(dragState.windowId);
  if (windowEl) {
    windowEl.classList.remove('dragging');
  }
  
  dragState.isDragging = false;
  dragState.rafId = null;
  document.removeEventListener('mousemove', onDragWindow);
  document.removeEventListener('mouseup', stopDragWindow);
}

// ==================== 窗口调整大小 - 优化：使用 requestAnimationFrame ====================
let resizeState = {
  isResizing: false,
  windowId: null,
  direction: '',
  startX: 0,
  startY: 0,
  startWidth: 0,
  startHeight: 0,
  startLeft: 0,
  startTop: 0,
  rafId: null
};

function initResizeHandles(windowId) {
  const windowEl = document.getElementById(windowId);
  if (!windowEl) return;
  
  const handles = windowEl.querySelectorAll('.window-resize-handle');
  handles.forEach(handle => {
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      const direction = Array.from(handle.classList).find(c => c !== 'window-resize-handle');
      
      resizeState.isResizing = true;
      resizeState.windowId = windowId;
      resizeState.direction = direction;
      resizeState.startX = e.clientX;
      resizeState.startY = e.clientY;
      resizeState.startWidth = windowEl.offsetWidth;
      resizeState.startHeight = windowEl.offsetHeight;
      resizeState.startLeft = windowEl.offsetLeft;
      resizeState.startTop = windowEl.offsetTop;
      
      windowEl.classList.add('resizing');
      
      document.addEventListener('mousemove', onResizeWindow, { passive: true });
      document.addEventListener('mouseup', stopResizeWindow);
    });
  });
}

function onResizeWindow(event) {
  if (!resizeState.isResizing) return;
  
  // 取消之前的 RAF
  if (resizeState.rafId) {
    cancelAnimationFrame(resizeState.rafId);
  }
  
  resizeState.rafId = requestAnimationFrame(() => {
    const windowEl = document.getElementById(resizeState.windowId);
    if (!windowEl) return;
    
    const deltaX = event.clientX - resizeState.startX;
    const deltaY = event.clientY - resizeState.startY;
    const dir = resizeState.direction;
    
    const minWidth = 400;
    const minHeight = 300;
    
    let newWidth = resizeState.startWidth;
    let newHeight = resizeState.startHeight;
    let newLeft = resizeState.startLeft;
    let newTop = resizeState.startTop;
    
    // 根据方向调整
    if (dir.includes('e')) newWidth = Math.max(minWidth, resizeState.startWidth + deltaX);
    if (dir.includes('w')) {
      newWidth = Math.max(minWidth, resizeState.startWidth - deltaX);
      if (newWidth > minWidth) newLeft = resizeState.startLeft + deltaX;
    }
    if (dir.includes('s')) newHeight = Math.max(minHeight, resizeState.startHeight + deltaY);
    if (dir.includes('n')) {
      newHeight = Math.max(minHeight, resizeState.startHeight - deltaY);
      if (newHeight > minHeight) newTop = resizeState.startTop + deltaY;
    }
    
    windowEl.style.width = newWidth + 'px';
    windowEl.style.height = newHeight + 'px';
    if (dir.includes('w') || dir.includes('n')) {
      windowEl.style.left = newLeft + 'px';
      windowEl.style.top = Math.max(28, newTop) + 'px';
    }
  });
}

function stopResizeWindow() {
  if (!resizeState.isResizing) return;
  
  if (resizeState.rafId) {
    cancelAnimationFrame(resizeState.rafId);
  }
  
  const windowEl = document.getElementById(resizeState.windowId);
  if (windowEl) {
    windowEl.classList.remove('resizing');
  }
  
  resizeState.isResizing = false;
  resizeState.rafId = null;
  document.removeEventListener('mousemove', onResizeWindow);
  document.removeEventListener('mouseup', stopResizeWindow);
}

// ==================== 简化的窗口操作函数 ====================
function closeWindow(windowId) {
  window.windowManager.close(windowId);
}

function minimizeWindow(windowId) {
  window.windowManager.minimize(windowId);
}

function toggleMaximize(windowId) {
  window.windowManager.toggleMaximize(windowId);
}

function focusWindow(windowId) {
  const win = document.getElementById(windowId);
  if (!win) return;
  
  // 如果窗口最小化，恢复
  if (win.classList.contains('minimized')) {
    if (window.windowManager) {
      window.windowManager.restore(windowId);
    } else {
      win.classList.remove('minimized');
    }
  } else if (win.classList.contains('active')) {
    // 如果窗口已激活，最小化（快速切换）
    if (window.windowManager) {
      window.windowManager.minimize(windowId);
    } else {
      win.classList.add('minimized');
    }
  } else {
    // 显示并聚焦窗口
    if (win.style.display === 'none') {
      win.style.display = 'flex';
    }
    if (window.windowManager) {
      window.windowManager.focus(windowId);
    } else {
      win.classList.add('active');
    }
  }
}

function openWindow(appId) {
  // 简化版本，直接聚焦或显示提示
  showNotification(`${appId} 功能开发中...`, 'info');
}

// ==================== 模型切换 ====================
function changeModel(model) {
  currentModel = model;
  localStorage.setItem('currentModel', model);
  showNotification(`已切换到 ${model}`, 'info');
}

// ==================== 通知 ====================
function showNotification(message, type = 'info') {
  const existing = document.querySelector('.notification');
  if (existing) existing.remove();
  
  const icons = {
    success: '✓',
    error: '✕',
    info: 'ℹ'
  };
  
  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  notification.innerHTML = `
    <span>${icons[type] || icons.info}</span>
    <span>${message}</span>
  `;
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.style.animation = 'notifIn 0.3s ease reverse';
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

// ==================== 模态框 ====================
function showRegisterModal() {
  document.getElementById('register-modal').classList.remove('hidden');
}

function closeRegisterModal() {
  document.getElementById('register-modal').classList.add('hidden');
}

// ==================== 快捷键 ====================
document.addEventListener('keydown', (e) => {
  // Ctrl/Cmd + Enter 发送消息
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    const input = document.getElementById('chat-input');
    if (input && document.activeElement === input) {
      e.preventDefault();
      sendMessage();
    }
  }
  
  // Escape 取消
  if (e.key === 'Escape') {
    closeRegisterModal();
    if (state.isLoading && state.abortController) {
      state.abortController();
      state.isLoading = false;
      hideTypingIndicator();
      updateSendButton();
    }
  }
});

// ==================== 壁纸管理 ====================
const Wallpapers = {
  current: 'default',
  list: [
    { id: 'default', name: '默认渐变', class: 'wallpaper-default' },
    { id: 'ocean', name: '海洋', url: 'https://images.unsplash.com/photo-1518837695005-2083093ee35b?w=1920' },
    { id: 'mountain', name: '山脉', url: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=1920' },
    { id: 'night', name: '星空', url: 'https://images.unsplash.com/photo-1419242902214-272b3f66ee7a?w=1920' },
    { id: 'abstract', name: '抽象', url: 'https://images.unsplash.com/photo-1557682250-33bd709cbe85?w=1920' }
  ],
  
  set(wallpaperId) {
    const wallpaper = this.list.find(w => w.id === wallpaperId);
    if (!wallpaper) return;
    
    const el = document.getElementById('desktop-wallpaper');
    if (!el) return;
    
    // 移除所有壁纸类
    el.className = 'desktop-wallpaper';
    
    if (wallpaper.url) {
      el.style.backgroundImage = `url(${wallpaper.url})`;
    } else {
      el.classList.add(wallpaper.class);
    }
    
    this.current = wallpaperId;
    localStorage.setItem('chenyi_wallpaper', wallpaperId);
  },
  
  cycle() {
    const idx = this.list.findIndex(w => w.id === this.current);
    const next = this.list[(idx + 1) % this.list.length];
    this.set(next.id);
  },
  
  load() {
    const saved = localStorage.getItem('chenyi_wallpaper');
    if (saved) {
      this.set(saved);
    }
  }
};

// ==================== 退出登录 ====================
async function logout() {
  if (!confirm('确定要退出登录吗？')) return;
  
  try {
    localStorage.removeItem('chenyi_token');
    localStorage.removeItem('chenyi_credentials');
    
    state.isLoggedIn = false;
    state.user = null;
    state.messages = [];
    state.sessions = [];
    
    document.getElementById('macos-desktop').classList.add('hidden');
    document.getElementById('login-overlay').classList.remove('hidden');
    
    showNotification('已退出登录', 'info');
  } catch (err) {
    showNotification('退出失败: ' + err.message, 'error');
  }
}

// ==================== 系统监控 ====================

/**
 * 初始化系统监控
 */
let systemStatsInterval = null;
function initSystemMonitoring() {
  // 监听系统错误事件
  ipcRenderer.on('system:error', (event, error) => {
    handleSystemError(error);
  });
  
  // 监听系统状态更新
  ipcRenderer.on('system:status-update', (event, status) => {
    updateSystemStatus(status);
  });
  
  // 定期获取系统统计 - 优化：清理旧定时器
  if (systemStatsInterval) clearInterval(systemStatsInterval);
  systemStatsInterval = setInterval(fetchSystemStats, 5000);
  fetchSystemStats();
}

/**
 * 获取系统统计数据
 */
async function fetchSystemStats() {
  try {
    const result = await ipcRenderer.invoke('system:stats');
    if (result && result.success) {
      state.systemStats = result.data;
      updateSystemStatusPanel();
      updateDockStatus();
    }
  } catch (err) {
    console.error('[System] 获取统计失败:', err);
  }
}

/**
 * 处理系统错误
 */
function handleSystemError(error) {
  const errorItem = {
    id: `error_${Date.now()}`,
    type: error.type || 'unknown',
    message: error.message || '未知错误',
    timestamp: Date.now(),
    details: error.details || null
  };
  
  state.errors.unshift(errorItem);
  if (state.errors.length > 10) {
    state.errors.pop();
  }
  
  showErrorNotification(errorItem);
  updateErrorPanel();
}

/**
 * 更新系统状态
 */
function updateSystemStatus(status) {
  if (status.ipc) {
    state.systemStats.ipc = status.ipc;
  }
  if (status.circuitBreaker) {
    state.systemStats.circuitBreaker = status.circuitBreaker;
  }
  if (status.kernel) {
    state.systemStats.kernel = status.kernel;
  }
  if (status.logs) {
    state.systemStats.logs = status.logs;
  }
  
  updateSystemStatusPanel();
  updateDockStatus();
}

/**
 * 更新系统状态面板UI
 */
function updateSystemStatusPanel() {
  const panel = document.getElementById('system-status-panel');
  if (!panel) return;
  
  // 确保 systemStats 已初始化
  if (!state.systemStats) {
    state.systemStats = {
      ipc: { requests: 0, successes: 0, failures: 0, retries: 0 },
      circuitBreaker: { state: 'CLOSED', failures: 0 },
      kernel: { ready: false, running: false, restartAttempts: 0 },
      logs: { errors: 0, warnings: 0 }
    };
  }
  
  const { ipc, circuitBreaker, kernel, logs } = state.systemStats;
  
  // IPC统计
  const ipcEl = panel.querySelector('.stat-ipc');
  if (ipcEl) {
    ipcEl.innerHTML = `
      <div class="stat-row">
        <span class="stat-label">请求数</span>
        <span class="stat-value">${ipc.requests || 0}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">成功</span>
        <span class="stat-value success">${ipc.successes || 0}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">失败</span>
        <span class="stat-value error">${ipc.failures || 0}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">重试</span>
        <span class="stat-value warning">${ipc.retries || 0}</span>
      </div>
    `;
  }
  
  // 熔断器状态
  const cbEl = panel.querySelector('.stat-circuit');
  if (cbEl) {
    const stateClass = circuitBreaker.state === 'OPEN' ? 'error' : 
                       circuitBreaker.state === 'HALF_OPEN' ? 'warning' : 'success';
    cbEl.innerHTML = `
      <div class="circuit-state ${stateClass}">
        <span class="circuit-indicator"></span>
        <span class="circuit-text">${circuitBreaker.state}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">失败次数</span>
        <span class="stat-value">${circuitBreaker.failures || 0}</span>
      </div>
    `;
  }
  
  // 内核状态
  const kernelEl = panel.querySelector('.stat-kernel');
  if (kernelEl) {
    const statusText = kernel.ready ? '就绪' : (kernel.running ? '运行中' : '未启动');
    const statusClass = kernel.ready ? 'success' : (kernel.running ? 'warning' : 'error');
    kernelEl.innerHTML = `
      <div class="kernel-status ${statusClass}">
        <span class="kernel-indicator"></span>
        <span class="kernel-text">${statusText}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">重启次数</span>
        <span class="stat-value">${kernel.restartAttempts || 0}</span>
      </div>
    `;
  }
  
  // 日志统计
  const logsEl = panel.querySelector('.stat-logs');
  if (logsEl) {
    logsEl.innerHTML = `
      <div class="stat-row">
        <span class="stat-label">错误</span>
        <span class="stat-value error">${logs.errors || 0}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">警告</span>
        <span class="stat-value warning">${logs.warnings || 0}</span>
      </div>
    `;
  }
}

/**
 * 显示错误通知
 */
function showErrorNotification(error) {
  const container = document.getElementById('error-notifications');
  if (!container) return;
  
  const notification = document.createElement('div');
  notification.className = 'error-notification';
  notification.innerHTML = `
    <div class="error-header">
      <span class="error-icon">⚠️</span>
      <span class="error-type">${escapeHtml(error.type)}</span>
      <button class="error-close" onclick="this.parentElement.parentElement.remove()">✕</button>
    </div>
    <div class="error-message">${escapeHtml(error.message)}</div>
    <div class="error-time">${formatTime(error.timestamp)}</div>
    <button class="error-retry" onclick="retryLastOperation()">重试</button>
  `;
  
  container.appendChild(notification);
  
  // 5秒后自动移除
  setTimeout(() => {
    notification.style.animation = 'errorSlideOut 0.3s ease forwards';
    setTimeout(() => notification.remove(), 300);
  }, 5000);
}

/**
 * 更新错误面板
 */
function updateErrorPanel() {
  const panel = document.getElementById('error-list-panel');
  if (!panel) return;
  
  const listEl = panel.querySelector('.error-list');
  if (listEl) {
    listEl.innerHTML = state.errors.map(err => `
      <div class="error-item">
        <div class="error-item-header">
          <span class="error-type-badge">${escapeHtml(err.type)}</span>
          <span class="error-time">${formatTime(err.timestamp)}</span>
        </div>
        <div class="error-item-message">${escapeHtml(err.message)}</div>
      </div>
    `).join('') || '<div class="no-errors">暂无错误</div>';
  }
}

/**
 * 重试最后操作
 */
async function retryLastOperation() {
  showNotification('正在重试...', 'info');
  // 这里可以触发重新发送最后一条消息
  const lastUserMsg = [...state.messages].reverse().find(m => m.role === 'user');
  if (lastUserMsg) {
    const input = document.getElementById('chat-input');
    if (input) {
      input.value = lastUserMsg.content;
      await sendMessage();
    }
  }
}

/**
 * 更新Dock状态指示器
 */
function updateDockStatus() {
  const statusDot = document.getElementById('dock-status-dot');
  if (!statusDot) return;
  
  const { circuitBreaker, kernel } = state.systemStats;
  
  // 根据状态设置颜色
  if (circuitBreaker.state === 'OPEN' || !kernel.ready) {
    statusDot.className = 'dock-status-dot error';
    statusDot.style.animation = 'none';
  } else if (circuitBreaker.state === 'HALF_OPEN') {
    statusDot.className = 'dock-status-dot warning';
    statusDot.style.animation = 'pulse 1s infinite';
  } else {
    statusDot.className = 'dock-status-dot success';
    statusDot.style.animation = 'none';
  }
}

/**
 * 显示性能监控
 */
function showPerformanceMonitor(duration, operation = 'request') {
  const monitor = document.getElementById('performance-monitor');
  if (!monitor) return;
  
  state.performance.requestTime = duration;
  
  // 慢操作告警（超过2秒）
  if (duration > 2000) {
    state.performance.slowOperations.unshift({
      operation,
      duration,
      timestamp: Date.now()
    });
    if (state.performance.slowOperations.length > 5) {
      state.performance.slowOperations.pop();
    }
  }
  
  const timeEl = monitor.querySelector('.perf-time');
  if (timeEl) {
    timeEl.textContent = `${duration}ms`;
    timeEl.className = `perf-time ${duration > 2000 ? 'slow' : duration > 1000 ? 'medium' : 'fast'}`;
  }
  
  const slowEl = monitor.querySelector('.perf-slow-list');
  if (slowEl) {
    slowEl.innerHTML = state.performance.slowOperations.map(op => `
      <div class="slow-op">
        <span class="slow-op-name">${escapeHtml(op.operation)}</span>
        <span class="slow-op-time">${op.duration}ms</span>
      </div>
    `).join('') || '<div class="no-slow">无慢操作</div>';
  }
}

/**
 * 增加重试计数
 */
function incrementRetryCount() {
  state.performance.retryCount++;
  const monitor = document.getElementById('performance-monitor');
  if (monitor) {
    const retryEl = monitor.querySelector('.perf-retries');
    if (retryEl) {
      retryEl.textContent = state.performance.retryCount;
    }
  }
}

/**
 * 重置性能监控
 */
function resetPerformanceMonitor() {
  state.performance = {
    requestTime: 0,
    slowOperations: [],
    retryCount: 0
  };
  showPerformanceMonitor(0);
}

/**
 * 生成日志报告
 */
async function generateLogReport() {
  try {
    showNotification('正在生成日志报告...', 'info');
    const result = await ipcRenderer.invoke('system:log-report', {
      format: 'text',
      lastHours: 24
    });
    
    if (result && result.success) {
      // 显示报告
      const modal = document.getElementById('log-report-modal');
      if (modal) {
        const contentEl = modal.querySelector('.log-report-content');
        if (contentEl) {
          contentEl.textContent = result.report;
        }
        modal.classList.remove('hidden');
      }
      showNotification('日志报告已生成', 'success');
    } else {
      showNotification('生成报告失败', 'error');
    }
  } catch (err) {
    showNotification('生成报告失败: ' + err.message, 'error');
  }
}

/**
 * 重置系统统计
 */
async function resetSystemStats() {
  try {
    const result = await ipcRenderer.invoke('system:reset-stats');
    if (result && result.success) {
      state.systemStats = {
        ipc: { requests: 0, successes: 0, failures: 0, retries: 0 },
        circuitBreaker: { state: 'CLOSED', failures: 0 },
        kernel: state.systemStats.kernel,
        logs: { errors: 0, warnings: 0 }
      };
      updateSystemStatusPanel();
      showNotification('统计已重置', 'success');
    }
  } catch (err) {
    showNotification('重置失败: ' + err.message, 'error');
  }
}

/**
 * 切换系统面板显示
 */
function toggleSystemPanel() {
  const panel = document.getElementById('system-status-panel');
  if (panel) {
    panel.classList.toggle('hidden');
  }
}

// ==================== 清理函数 ====================
/**
 * 清理所有定时器和事件监听器
 */
function cleanup() {
  // 清理时钟定时器
  if (clockInterval) {
    clearInterval(clockInterval);
    clockInterval = null;
  }
  
  // 清理系统统计定时器
  if (systemStatsInterval) {
    clearInterval(systemStatsInterval);
    systemStatsInterval = null;
  }
  
  // 清理记忆搜索定时器
  if (state.memorySearchTimer) {
    clearTimeout(state.memorySearchTimer);
    state.memorySearchTimer = null;
  }
  
  // 清理流式更新 RAF
  if (streamUpdateRaf) {
    cancelAnimationFrame(streamUpdateRaf);
    streamUpdateRaf = null;
  }
  
  console.log('[Renderer] 已清理所有定时器');
}

// 页面卸载时清理
window.addEventListener('beforeunload', cleanup);

// ==================== 侧边栏标签页切换 ====================

/**
 * 切换侧边栏标签页
 */
function switchSidebarTab(tabName) {
  // 更新标签状态
  document.querySelectorAll('.sidebar-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.tab === tabName);
  });
  
  // 切换面板显示
  const sessionList = document.getElementById('session-list');
  const memoryPanel = document.getElementById('memory-panel');
  
  if (tabName === 'sessions') {
    sessionList.classList.remove('hidden');
    memoryPanel.classList.add('hidden');
  } else if (tabName === 'memory') {
    sessionList.classList.add('hidden');
    memoryPanel.classList.remove('hidden');
    loadMemories();
  }
}

// ==================== 记忆管理 ====================

/**
 * 加载记忆列表
 */
async function loadMemories() {
  try {
    const result = await ipcRenderer.invoke('chenyi:search-memory', { 
      query: state.memorySearchQuery || '', 
      k: 20 
    });
    
    if (result && result.success !== false) {
      // 处理不同的返回格式
      state.memories = result.results || result.memories || result || [];
      if (!Array.isArray(state.memories)) state.memories = [];
      renderMemoryList();
    } else {
      state.memories = [];
      renderMemoryList();
    }
  } catch (err) {
    console.error('[Memory] 加载失败:', err);
    state.memories = [];
    renderMemoryList();
  }
}

/**
 * 搜索记忆
 */
async function searchMemories(query) {
  state.memorySearchQuery = query;
  
  // 防抖处理
  clearTimeout(state.memorySearchTimer);
  state.memorySearchTimer = setTimeout(async () => {
    await loadMemories();
  }, 300);
}

/**
 * 渲染记忆列表
 */
function renderMemoryList() {
  const container = document.getElementById('memory-list');
  if (!container) return;
  
  if (state.memories.length === 0) {
    container.innerHTML = `
      <div class="memory-empty">
        <div class="memory-empty-icon">🧠</div>
        <div class="memory-empty-text">暂无记忆</div>
      </div>
    `;
    return;
  }
  
  container.innerHTML = state.memories.map((memory, index) => {
    const title = memory.metadata?.title || memory.content?.substring(0, 50) || '无标题';
    const summary = memory.content?.substring(0, 150) || '';
    const time = memory.metadata?.created_at || memory.created_at || Date.now();
    const id = memory.id || memory.memory_id || `mem_${index}`;
    
    return `
      <div class="memory-card" onclick="showMemoryDetail('${id}')">
        <div class="memory-card-title">${escapeHtml(title)}</div>
        <div class="memory-card-summary">${escapeHtml(summary)}...</div>
        <div class="memory-card-meta">
          <span class="memory-card-time">${formatTime(time)}</span>
          <div class="memory-card-actions">
            <button class="memory-action-btn" onclick="event.stopPropagation(); editMemory('${id}')">编辑</button>
            <button class="memory-action-btn delete" onclick="event.stopPropagation(); deleteMemory('${id}')">删除</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * 显示记忆详情
 */
function showMemoryDetail(id) {
  const memory = state.memories.find(m => (m.id || m.memory_id) === id);
  if (!memory) return;
  
  const title = memory.metadata?.title || '记忆详情';
  const content = memory.content || '';
  const time = memory.metadata?.created_at || memory.created_at || Date.now();
  const tags = memory.metadata?.tags || [];
  
  const modal = document.getElementById('memory-detail-modal');
  const titleEl = document.getElementById('memory-modal-title');
  const contentEl = document.getElementById('memory-modal-content');
  
  if (titleEl) titleEl.textContent = title;
  if (contentEl) {
    contentEl.innerHTML = `
      <div class="memory-detail-header">
        <div class="memory-detail-meta">
          <span>📅 ${formatDate(time)}</span>
          <span>🆔 ${id.substring(0, 8)}</span>
        </div>
      </div>
      <div class="memory-detail-body">${escapeHtml(content)}</div>
      ${tags.length > 0 ? `
        <div class="memory-detail-tags">
          ${tags.map(tag => `<span class="memory-tag">${escapeHtml(tag)}</span>`).join('')}
        </div>
      ` : ''}
      <div style="margin-top: 16px; display: flex; gap: 10px;">
        <button class="edit-btn cancel" onclick="editMemory('${id}'); closeMemoryModal();">编辑</button>
        <button class="edit-btn save" style="background: var(--error);" onclick="deleteMemory('${id}')">删除</button>
      </div>
    `;
  }
  
  if (modal) modal.classList.remove('hidden');
}

/**
 * 关闭记忆详情模态框
 */
function closeMemoryModal() {
  document.getElementById('memory-detail-modal').classList.add('hidden');
}

/**
 * 显示添加记忆模态框
 */
function showAddMemoryModal() {
  const modal = document.getElementById('memory-edit-modal');
  const titleEl = document.getElementById('memory-edit-title');
  const formIdEl = document.getElementById('memory-form-id');
  const formTitleEl = document.getElementById('memory-form-title');
  const formContentEl = document.getElementById('memory-form-content');
  const formTagsEl = document.getElementById('memory-form-tags');
  
  if (titleEl) titleEl.textContent = '添加记忆';
  if (formIdEl) formIdEl.value = '';
  if (formTitleEl) formTitleEl.value = '';
  if (formContentEl) formContentEl.value = '';
  if (formTagsEl) formTagsEl.value = '';
  
  if (modal) modal.classList.remove('hidden');
}

/**
 * 编辑记忆
 */
function editMemory(id) {
  const memory = state.memories.find(m => (m.id || m.memory_id) === id);
  if (!memory) return;
  
  const modal = document.getElementById('memory-edit-modal');
  const titleEl = document.getElementById('memory-edit-title');
  const formIdEl = document.getElementById('memory-form-id');
  const formTitleEl = document.getElementById('memory-form-title');
  const formContentEl = document.getElementById('memory-form-content');
  const formTagsEl = document.getElementById('memory-form-tags');
  
  if (titleEl) titleEl.textContent = '编辑记忆';
  if (formIdEl) formIdEl.value = id;
  if (formTitleEl) formTitleEl.value = memory.metadata?.title || '';
  if (formContentEl) formContentEl.value = memory.content || '';
  if (formTagsEl) formTagsEl.value = (memory.metadata?.tags || []).join(', ');
  
  if (modal) modal.classList.remove('hidden');
}

/**
 * 关闭记忆编辑模态框
 */
function closeMemoryEditModal() {
  document.getElementById('memory-edit-modal').classList.add('hidden');
}

/**
 * 从表单保存记忆
 */
async function saveMemoryFromForm(event) {
  if (event) event.preventDefault();
  
  const id = document.getElementById('memory-form-id').value;
  const title = document.getElementById('memory-form-title').value.trim();
  const content = document.getElementById('memory-form-content').value.trim();
  const tagsStr = document.getElementById('memory-form-tags').value;
  const tags = tagsStr.split(',').map(t => t.trim()).filter(t => t);
  
  if (!content) {
    showNotification('请输入记忆内容', 'error');
    return;
  }
  
  try {
    const result = await ipcRenderer.invoke('chenyi:save-memory', {
      content,
      metadata: {
        title: title || content.substring(0, 50),
        tags,
        created_at: Date.now()
      }
    });
    
    if (result && result.success !== false) {
      showNotification('记忆保存成功', 'success');
      closeMemoryEditModal();
      await loadMemories();
    } else {
      showNotification(result?.error || '保存失败', 'error');
    }
  } catch (err) {
    console.error('[Memory] 保存失败:', err);
    showNotification('保存失败: ' + err.message, 'error');
  }
}

/**
 * 删除记忆
 */
async function deleteMemory(id) {
  if (!confirm('确定删除这条记忆吗？')) return;
  
  try {
    // 注意：需要后端支持删除接口
    const result = await ipcRenderer.invoke('chenyi:delete-memory', { id });
    
    if (result && result.success !== false) {
      showNotification('记忆已删除', 'success');
      closeMemoryModal();
      await loadMemories();
    } else {
      showNotification(result?.error || '删除失败', 'error');
    }
  } catch (err) {
    console.error('[Memory] 删除失败:', err);
    showNotification('删除失败: ' + err.message, 'error');
  }
}

// ==================== 设置面板 - 工具管理 ====================

/**
 * 切换设置面板标签页
 */
function switchSettingsTab(tabName) {
  // 更新标签状态
  document.querySelectorAll('.settings-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.tab === tabName);
  });
  
  // 切换内容显示
  document.getElementById('settings-tools').classList.toggle('hidden', tabName !== 'tools');
  document.getElementById('settings-general').classList.toggle('hidden', tabName !== 'general');
  document.getElementById('settings-about').classList.toggle('hidden', tabName !== 'about');
  
  if (tabName === 'tools') {
    renderToolsList();
  }
}

/**
 * 渲染工具列表
 */
function renderToolsList() {
  const container = document.getElementById('tools-list');
  if (!container) return;
  
  const tools = [
    { id: 'read', name: '读取文件', desc: '读取文件内容', icon: '📄' },
    { id: 'write', name: '写入文件', desc: '创建或覆盖文件', icon: '✏️' },
    { id: 'edit', name: '编辑文件', desc: '精确编辑文件内容', icon: '📝' },
    { id: 'exec', name: '执行命令', desc: '运行Shell命令', icon: '⚡' },
    { id: 'process', name: '进程管理', desc: '管理后台进程', icon: '🔄' },
    { id: 'web_search', name: '网络搜索', desc: '搜索互联网信息', icon: '🔍' },
    { id: 'web_fetch', name: '网页抓取', desc: '获取网页内容', icon: '🌐' },
    { id: 'memory_get', name: '获取记忆', desc: '读取特定记忆', icon: '📖' },
    { id: 'memory_search', name: '搜索记忆', desc: '语义搜索记忆', icon: '🔎' }
  ];
  
  container.innerHTML = tools.map(tool => `
    <div class="tool-item ${state.tools.enabled.has(tool.id) ? '' : 'disabled'}">
      <div class="tool-icon">${tool.icon}</div>
      <div class="tool-info">
        <div class="tool-name">${tool.name}</div>
        <div class="tool-desc">${tool.desc}</div>
      </div>
      <div class="tool-toggle ${state.tools.enabled.has(tool.id) ? 'active' : ''}" 
           onclick="toggleTool('${tool.id}')"></div>
    </div>
  `).join('');
  
  // 渲染使用历史
  renderToolHistory();
}

/**
 * 切换工具启用状态
 */
function toggleTool(toolId) {
  if (state.tools.enabled.has(toolId)) {
    state.tools.enabled.delete(toolId);
  } else {
    state.tools.enabled.add(toolId);
  }
  renderToolsList();
  showNotification(`工具 ${toolId} 已${state.tools.enabled.has(toolId) ? '启用' : '禁用'}`, 'info');
}

/**
 * 渲染工具使用历史
 */
function renderToolHistory() {
  const container = document.getElementById('tool-history-list');
  if (!container) return;
  
  if (state.tools.usage.length === 0) {
    container.innerHTML = '<div style="color: var(--text-muted); font-size: 12px; padding: 10px;">暂无使用记录</div>';
    return;
  }
  
  container.innerHTML = state.tools.usage.slice(0, 10).map(item => `
    <div class="history-item">
      <span class="history-time">${formatTime(item.timestamp)}</span>
      <span class="history-content">
        <span class="history-tool">${item.name}</span>
        ${item.success ? '✓' : '✕'}
      </span>
    </div>
  `).join('');
}

/**
 * 打开设置面板
 */
function openSettingsPanel() {
  const panel = document.getElementById('settings-panel');
  if (panel) {
    panel.classList.remove('hidden');
    switchSettingsTab('tools');
  }
}

// ==================== 消息功能增强 ====================

/**
 * 引用消息
 */
function quoteMessage(id) {
  const msg = state.messages.find(m => m.id === id);
  if (!msg) return;
  
  state.quotingMessage = msg;
  
  // 更新输入框提示
  const input = document.getElementById('chat-input');
  if (input) {
    input.placeholder = `引用 ${msg.role === 'user' ? '你' : '晨翼'} 的消息...`;
    input.focus();
  }
  
  showNotification('已引用消息，输入回复内容', 'info');
}

/**
 * 取消引用
 */
function cancelQuote() {
  state.quotingMessage = null;
  const input = document.getElementById('chat-input');
  if (input) {
    input.placeholder = '输入消息... (Ctrl+Enter 发送)';
  }
}

/**
 * 删除消息
 */
function deleteMessageFromState(id) {
  if (!confirm('确定删除这条消息吗？')) return;
  
  state.messages = state.messages.filter(m => m.id !== id);
  renderMessages();
  showNotification('消息已删除', 'success');
}

/**
 * 开始编辑消息
 */
function startEditMessage(id) {
  const msg = state.messages.find(m => m.id === id);
  if (!msg || msg.role !== 'user') return;
  
  state.editingMessageId = id;
  
  // 找到消息元素并替换为编辑模式
  const msgEl = document.querySelector(`[data-id="${id}"]`);
  if (msgEl) {
    const contentEl = msgEl.querySelector('.message-text');
    if (contentEl) {
      contentEl.innerHTML = `
        <div class="message-edit-container">
          <textarea class="message-edit-textarea" id="edit-textarea-${id}">${escapeHtml(msg.content)}</textarea>
          <div class="message-edit-actions">
            <button class="edit-btn cancel" onclick="cancelEditMessage('${id}')">取消</button>
            <button class="edit-btn save" onclick="saveEditMessage('${id}')">保存</button>
          </div>
        </div>
      `;
      
      // 聚焦并选中文本
      const textarea = document.getElementById(`edit-textarea-${id}`);
      if (textarea) {
        textarea.focus();
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      }
    }
  }
}

/**
 * 取消编辑消息
 */
function cancelEditMessage(id) {
  state.editingMessageId = null;
  renderMessages();
}

/**
 * 保存编辑的消息
 */
async function saveEditMessage(id) {
  const textarea = document.getElementById(`edit-textarea-${id}`);
  if (!textarea) return;
  
  const newContent = textarea.value.trim();
  if (!newContent) {
    showNotification('消息内容不能为空', 'error');
    return;
  }
  
  // 更新消息
  const msg = state.messages.find(m => m.id === id);
  if (msg) {
    msg.content = newContent;
    msg.edited = true;
    msg.editedAt = Date.now();
  }
  
  state.editingMessageId = null;
  renderMessages();
  showNotification('消息已更新', 'success');
}

/**
 * 更新渲染消息函数，添加引用和操作按钮
 */
function renderMessageEnhanced(msg, index) {
  const avatar = msg.role === 'user' ? '👤' : (msg.role === 'assistant' ? '🦐' : '❌');
  const roleName = msg.role === 'user' ? '你' : (msg.role === 'assistant' ? '晨翼' : '错误');
  
  // 引用内容
  let quoteHtml = '';
  if (msg.quote) {
    quoteHtml = `
      <div class="message-quote">
        <div class="message-quote-role">${msg.quote.role === 'user' ? '你' : '晨翼'}</div>
        <div class="message-quote-content">${escapeHtml(msg.quote.content)}</div>
      </div>
    `;
  }
  
  // 思考过程
  let thinkingHtml = '';
  if (state.showThinking && msg.thinking) {
    thinkingHtml = `
      <div class="thinking-block collapsed">
        <div class="thinking-header" onclick="toggleThinking(this)">
          <span class="thinking-icon">💭</span>
          <span class="thinking-title">思考过程</span>
          <span class="thinking-toggle">▼</span>
        </div>
        <div class="thinking-body">${escapeHtml(msg.thinking)}</div>
      </div>
    `;
  }
  
  // 工具调用
  let toolsHtml = '';
  if (state.showTools && msg.tool_results && msg.tool_results.length > 0) {
    toolsHtml = msg.tool_results.map(tool => `
      <div class="tool-call">
        <div class="tool-header">
          <span class="tool-icon">🔧</span>
          <span class="tool-name">${escapeHtml(tool.name)}</span>
          <span class="tool-status ${tool.status}">${getToolStatusText(tool.status)}</span>
        </div>
        ${tool.result ? `<div class="tool-body">${escapeHtml(formatToolResult(tool.result))}</div>` : ''}
      </div>
    `).join('');
  }
  
  // 编辑标记
  let editedMark = '';
  if (msg.edited) {
    editedMark = ' <span style="font-size: 10px; color: var(--text-muted);">(已编辑)</span>';
  }
  
  return `
    <div class="message ${msg.role}" data-id="${msg.id}">
      <div class="message-avatar">${avatar}</div>
      <div class="message-content">
        <div class="message-header">
          <span class="message-role">${roleName}${editedMark}</span>
          <span class="message-time">${formatTime(msg.timestamp)}</span>
        </div>
        ${quoteHtml}
        ${thinkingHtml}
        ${toolsHtml}
        <div class="message-text">${formatContent(msg.content)}</div>
        <div class="message-actions">
          <button class="msg-action-btn" onclick="quoteMessage('${msg.id}')" title="引用">💬</button>
          <button class="msg-action-btn" onclick="copyMessage(${index})" title="复制">📋</button>
          ${msg.role === 'user' ? `<button class="msg-action-btn" onclick="startEditMessage('${msg.id}')" title="编辑">✏️</button>` : ''}
          ${msg.role === 'assistant' ? `<button class="msg-action-btn" onclick="regenerateMessage()" title="重新生成">🔄</button>` : ''}
          <button class="msg-action-btn danger" onclick="deleteMessageFromState('${msg.id}')" title="删除">🗑️</button>
        </div>
      </div>
    </div>
  `;
}

// 覆盖原有的 renderMessage 函数
const originalRenderMessage = renderMessage;
function renderMessage(msg, index) {
  return renderMessageEnhanced(msg, index);
}
