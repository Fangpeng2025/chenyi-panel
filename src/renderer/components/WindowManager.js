/**
 * 窗口管理器 - macOS 风格
 * 支持：拖拽、缩放、最大化、最小化、多窗口层级管理
 */

class WindowManager {
  constructor() {
    this.windows = new Map();
    this.activeWindowId = null;
    this.zIndexCounter = 100;
    this.minimizedWindows = [];
    this.maxZIndex = 200;
    
    this.styles = null;
    this.init();
  }
  
  init() {
    this.injectStyles();
    this.bindGlobalEvents();
    console.log('[WindowManager] 窗口管理器已初始化');
  }
  
  injectStyles() {
    if (document.getElementById('window-manager-styles')) return;
    
    this.styles = document.createElement('style');
    this.styles.id = 'window-manager-styles';
    this.styles.textContent = `
      /* ==================== 窗口管理器样式 ==================== */
      
      /* 窗口基础样式 */
      .macos-window {
        position: absolute;
        display: flex;
        flex-direction: column;
        min-width: 400px;
        min-height: 300px;
        border-radius: 12px;
        overflow: hidden;
        transition: box-shadow 0.2s ease;
      }
      
      /* 窗口激活状态 */
      .macos-window.active {
        box-shadow: 
          0 30px 60px rgba(0, 0, 0, 0.6),
          0 0 0 1px rgba(255, 255, 255, 0.08) inset;
      }
      
      /* 窗口非激活状态 */
      .macos-window:not(.active) {
        box-shadow: 
          0 20px 40px rgba(0, 0, 0, 0.4),
          0 0 0 1px rgba(255, 255, 255, 0.05) inset;
      }
      
      /* 窗口最大化 */
      .macos-window.maximized {
        width: 100% !important;
        height: calc(100% - 28px - 80px) !important;
        top: 28px !important;
        left: 0 !important;
        border-radius: 0;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      }
      
      /* 窗口最小化 */
      .macos-window.minimized {
        transform: scale(0.1);
        opacity: 0;
        pointer-events: none;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      }
      
      /* 窗口打开动画 */
      @keyframes windowOpen {
        from {
          opacity: 0;
          transform: scale(0.9) translateY(20px);
        }
        to {
          opacity: 1;
          transform: scale(1) translateY(0);
        }
      }
      
      .macos-window.opening {
        animation: windowOpen 0.4s cubic-bezier(0.4, 0, 0.2, 1);
      }
      
      /* 窗口关闭动画 */
      @keyframes windowClose {
        from {
          opacity: 1;
          transform: scale(1) translateY(0);
        }
        to {
          opacity: 0;
          transform: scale(0.9) translateY(20px);
        }
      }
      
      .macos-window.closing {
        animation: windowClose 0.3s cubic-bezier(0.4, 0, 0.2, 1) forwards;
      }
      
      /* 窗口标题栏 */
      .window-titlebar {
        height: 52px;
        background: linear-gradient(180deg, rgba(45, 45, 48, 0.95), rgba(35, 35, 38, 0.9));
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        display: flex;
        align-items: center;
        padding: 0 16px;
        gap: 12px;
        cursor: default;
        flex-shrink: 0;
        user-select: none;
      }
      
      /* 窗口控制按钮 */
      .window-controls {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      
      .window-btn {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        cursor: pointer;
        transition: all 0.15s ease;
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      
      .window-btn::after {
        content: '';
        opacity: 0;
        transition: opacity 0.15s ease;
        font-size: 10px;
        font-weight: bold;
        color: rgba(0, 0, 0, 0.6);
      }
      
      .window-btn:hover::after {
        opacity: 1;
      }
      
      .window-btn.close {
        background: #ff5f57;
        box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.1);
      }
      
      .window-btn.close:hover {
        background: #ff3b30;
      }
      
      .window-btn.close::after {
        content: '×';
      }
      
      .window-btn.minimize {
        background: #febc2e;
        box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.1);
      }
      
      .window-btn.minimize:hover {
        background: #ff9500;
      }
      
      .window-btn.minimize::after {
        content: '−';
      }
      
      .window-btn.maximize {
        background: #28c840;
        box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.1);
      }
      
      .window-btn.maximize:hover {
        background: #00c853;
      }
      
      .window-btn.maximize::after {
        content: '+';
      }
      
      /* 窗口标题 */
      .window-title {
        flex: 1;
        display: flex;
        align-items: center;
        gap: 12px;
        overflow: hidden;
      }
      
      .window-title-icon {
        font-size: 20px;
        filter: drop-shadow(0 0 6px rgba(0, 122, 255, 0.4));
      }
      
      .window-title-text {
        font-size: 15px;
        font-weight: 600;
        color: var(--text-primary, #f5f5f7);
        letter-spacing: 0.02em;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      
      /* 窗口内容区 */
      .window-content {
        flex: 1;
        display: flex;
        overflow: hidden;
        background: rgba(30, 30, 32, 0.92);
      }
      
      /* 窗口调整大小手柄 */
      .window-resize-handle {
        position: absolute;
        z-index: 10;
      }
      
      .window-resize-handle.n {
        top: 0;
        left: 10px;
        right: 10px;
        height: 5px;
        cursor: n-resize;
      }
      
      .window-resize-handle.s {
        bottom: 0;
        left: 10px;
        right: 10px;
        height: 5px;
        cursor: s-resize;
      }
      
      .window-resize-handle.e {
        right: 0;
        top: 10px;
        bottom: 10px;
        width: 5px;
        cursor: e-resize;
      }
      
      .window-resize-handle.w {
        left: 0;
        top: 10px;
        bottom: 10px;
        width: 5px;
        cursor: w-resize;
      }
      
      .window-resize-handle.ne {
        top: 0;
        right: 0;
        width: 15px;
        height: 15px;
        cursor: ne-resize;
      }
      
      .window-resize-handle.nw {
        top: 0;
        left: 0;
        width: 15px;
        height: 15px;
        cursor: nw-resize;
      }
      
      .window-resize-handle.se {
        bottom: 0;
        right: 0;
        width: 15px;
        height: 15px;
        cursor: se-resize;
      }
      
      .window-resize-handle.sw {
        bottom: 0;
        left: 0;
        width: 15px;
        height: 15px;
        cursor: sw-resize;
      }
      
      /* 窗口工具栏 */
      .window-toolbar {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      
      .toolbar-btn {
        padding: 6px 12px;
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 6px;
        font-size: 12px;
        font-weight: 500;
        color: var(--text-secondary, #a1a1a6);
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 6px;
        transition: all 0.15s ease;
      }
      
      .toolbar-btn:hover {
        background: rgba(255, 255, 255, 0.12);
        color: var(--text-primary, #f5f5f7);
        border-color: rgba(255, 255, 255, 0.15);
      }
      
      .toolbar-btn.active {
        background: var(--accent, #007aff);
        color: white;
        border-color: var(--accent, #007aff);
      }
      
      /* 拖拽时的样式 - 优化性能 */
      .macos-window.dragging {
        opacity: 0.9;
        cursor: grabbing !important;
        /* 禁用过渡以提升拖拽性能 */
        transition: none !important;
      }
      
      .macos-window.dragging .window-titlebar {
        cursor: grabbing !important;
      }
      
      /* 调整大小时禁用过渡 */
      .macos-window.resizing {
        transition: none !important;
      }
      
      /* 窗口快照（用于最小化预览） */
      .window-snapshot {
        width: 40px;
        height: 40px;
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.1);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 20px;
        cursor: pointer;
        transition: all 0.2s ease;
      }
      
      .window-snapshot:hover {
        background: rgba(255, 255, 255, 0.2);
        transform: scale(1.1);
      }
    `;
    
    document.head.appendChild(this.styles);
  }
  
  bindGlobalEvents() {
    // 点击窗口时激活
    document.addEventListener('mousedown', (e) => {
      const windowEl = e.target.closest('.macos-window');
      if (windowEl) {
        const windowId = windowEl.id;
        if (windowId && this.windows.has(windowId)) {
          this.focus(windowId);
        }
      }
    });
    
    // 全局鼠标事件
    document.addEventListener('mousemove', (e) => {
      if (this.dragState) {
        this.handleDrag(e);
      }
      if (this.resizeState) {
        this.handleResize(e);
      }
    });
    
    document.addEventListener('mouseup', () => {
      if (this.dragState) {
        this.endDrag();
      }
      if (this.resizeState) {
        this.endResize();
      }
    });
  }
  
  // 注册窗口
  register(windowId, config = {}) {
    const windowEl = document.getElementById(windowId);
    if (!windowEl) {
      console.error('[WindowManager] Window element not found:', windowId);
      return null;
    }
    
    const windowConfig = {
      id: windowId,
      element: windowEl,
      config: {
        title: config.title || '窗口',
        icon: config.icon || '📄',
        appId: config.appId || windowId,
        width: config.width || 800,
        height: config.height || 500,
        minWidth: config.minWidth || 400,
        minHeight: config.minHeight || 300,
        x: config.x,
        y: config.y,
        resizable: config.resizable !== false,
        maximizable: config.maximizable !== false,
        minimizable: config.minimizable !== false,
        closable: config.closable !== false,
        onClose: config.onClose,
        onMinimize: config.onMinimize,
        onMaximize: config.onMaximize,
        onFocus: config.onFocus,
        ...config
      },
      state: {
        isMaximized: false,
        isMinimized: false,
        position: { x: 0, y: 0 },
        size: { width: 0, height: 0 },
        restorePosition: null,
        restoreSize: null
      }
    };
    
    this.windows.set(windowId, windowConfig);
    
    // 初始化位置
    if (!windowConfig.config.x) {
      windowConfig.config.x = (window.innerWidth - windowConfig.config.width) / 2;
    }
    if (!windowConfig.config.y) {
      windowConfig.config.y = 60;
    }
    
    // 设置初始位置和大小
    windowEl.style.left = windowConfig.config.x + 'px';
    windowEl.style.top = windowConfig.config.y + 'px';
    windowEl.style.width = windowConfig.config.width + 'px';
    windowEl.style.height = windowConfig.config.height + 'px';
    
    // 绑定事件
    this.bindWindowEvents(windowId);
    
    console.log('[WindowManager] 窗口已注册:', windowId);
    return windowConfig;
  }
  
  // 绑定窗口事件
  bindWindowEvents(windowId) {
    const win = this.windows.get(windowId);
    if (!win) return;
    
    const windowEl = win.element;
    
    // 标题栏拖拽 - 确保正确绑定
    const titlebar = windowEl.querySelector('.window-titlebar');
    if (titlebar) {
      // 移除可能存在的旧事件监听器
      titlebar.removeEventListener('mousedown', this._handleTitlebarMouseDown);
      
      // 创建新的处理函数
      this._handleTitlebarMouseDown = (e) => {
        // 阻止在控制按钮区域拖拽
        if (e.target.closest('.window-controls') || 
            e.target.closest('.window-toolbar') ||
            e.target.classList.contains('window-btn')) {
          return;
        }
        this.startDrag(windowId, e);
      };
      
      titlebar.addEventListener('mousedown', this._handleTitlebarMouseDown);
    }
    
    // 控制按钮
    const closeBtn = windowEl.querySelector('.window-btn.close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.close(windowId));
    }
    
    const minimizeBtn = windowEl.querySelector('.window-btn.minimize');
    if (minimizeBtn) {
      minimizeBtn.addEventListener('click', () => this.minimize(windowId));
    }
    
    const maximizeBtn = windowEl.querySelector('.window-btn.maximize');
    if (maximizeBtn) {
      maximizeBtn.addEventListener('click', () => this.toggleMaximize(windowId));
    }
    
    // 调整大小手柄
    if (win.config.resizable) {
      const handles = windowEl.querySelectorAll('.window-resize-handle');
      handles.forEach(handle => {
        handle.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const direction = Array.from(handle.classList).find(c => c !== 'window-resize-handle');
          this.startResize(windowId, direction, e);
        });
      });
    }
  }
  
  // 激活窗口
  focus(windowId) {
    const win = this.windows.get(windowId);
    if (!win) return;
    
    // 取消之前的活动窗口
    if (this.activeWindowId && this.activeWindowId !== windowId) {
      const prevWin = this.windows.get(this.activeWindowId);
      if (prevWin && prevWin.element) {
        prevWin.element.classList.remove('active');
      }
    }
    
    // 设置新活动窗口
    win.element.classList.add('active');
    win.element.style.zIndex = ++this.zIndexCounter;
    this.activeWindowId = windowId;
    
    // 回调
    if (win.config.onFocus) {
      win.config.onFocus(windowId);
    }
    
    // 更新 Dock 状态
    this.updateDockState();
  }
  
  // 打开窗口
  open(windowId) {
    const win = this.windows.get(windowId);
    if (!win) return;
    
    win.element.style.display = 'flex';
    win.element.classList.add('opening');
    win.element.classList.remove('minimized', 'closing');
    win.state.isMinimized = false;
    
    // 从最小化列表移除
    const idx = this.minimizedWindows.indexOf(windowId);
    if (idx > -1) {
      this.minimizedWindows.splice(idx, 1);
      this.updateMinimizedDock();
    }
    
    setTimeout(() => {
      win.element.classList.remove('opening');
    }, 400);
    
    this.focus(windowId);
  }
  
  // 关闭窗口
  close(windowId) {
    const win = this.windows.get(windowId);
    if (!win) return;
    
    // 回调
    if (win.config.onClose) {
      const shouldClose = win.config.onClose(windowId);
      if (shouldClose === false) return;
    }
    
    // 动画关闭
    win.element.classList.add('closing');
    
    setTimeout(() => {
      win.element.style.display = 'none';
      win.element.classList.remove('closing', 'active');
      
      // 从最小化列表移除
      const idx = this.minimizedWindows.indexOf(windowId);
      if (idx > -1) {
        this.minimizedWindows.splice(idx, 1);
        this.updateMinimizedDock();
      }
      
      // 如果是活动窗口，取消激活
      if (this.activeWindowId === windowId) {
        this.activeWindowId = null;
      }
      
      this.updateDockState();
    }, 300);
  }
  
  // 最小化窗口
  minimize(windowId) {
    const win = this.windows.get(windowId);
    if (!win || !win.config.minimizable) return;
    
    // 回调
    if (win.config.onMinimize) {
      win.config.onMinimize(windowId);
    }
    
    win.element.classList.add('minimized');
    win.state.isMinimized = true;
    
    // 添加到最小化列表
    if (!this.minimizedWindows.includes(windowId)) {
      this.minimizedWindows.push(windowId);
    }
    this.updateMinimizedDock();
    
    // 如果是活动窗口，取消激活
    if (this.activeWindowId === windowId) {
      win.element.classList.remove('active');
      this.activeWindowId = null;
    }
    
    this.updateDockState();
  }
  
  // 恢复窗口
  restore(windowId) {
    const win = this.windows.get(windowId);
    if (!win) return;
    
    win.element.classList.remove('minimized');
    win.state.isMinimized = false;
    
    // 从最小化列表移除
    const idx = this.minimizedWindows.indexOf(windowId);
    if (idx > -1) {
      this.minimizedWindows.splice(idx, 1);
    }
    this.updateMinimizedDock();
    
    this.focus(windowId);
  }
  
  // 切换最大化
  toggleMaximize(windowId) {
    const win = this.windows.get(windowId);
    if (!win || !win.config.maximizable) return;
    
    // 回调
    if (win.config.onMaximize) {
      win.config.onMaximize(windowId, !win.state.isMaximized);
    }
    
    if (win.state.isMaximized) {
      // 还原
      win.element.classList.remove('maximized');
      
      if (win.state.restorePosition && win.state.restoreSize) {
        win.element.style.width = win.state.restoreSize.width + 'px';
        win.element.style.height = win.state.restoreSize.height + 'px';
        win.element.style.left = win.state.restorePosition.x + 'px';
        win.element.style.top = win.state.restorePosition.y + 'px';
        win.element.style.transform = 'none';
      }
      
      win.state.isMaximized = false;
    } else {
      // 保存当前位置和大小
      win.state.restorePosition = {
        x: win.element.offsetLeft,
        y: win.element.offsetTop
      };
      win.state.restoreSize = {
        width: win.element.offsetWidth,
        height: win.element.offsetHeight
      };
      
      // 最大化
      win.element.classList.add('maximized');
      win.state.isMaximized = true;
    }
  }
  
  // 开始拖拽
  startDrag(windowId, e) {
    const win = this.windows.get(windowId);
    if (!win || win.state.isMaximized) return;
    
    // 阻止在控制按钮区域拖拽
    if (e.target.closest('.window-controls') || 
        e.target.closest('.window-toolbar') ||
        e.target.classList.contains('window-btn')) {
      return;
    }
    
    e.preventDefault();
    
    this.dragState = {
      windowId,
      startX: e.clientX,
      startY: e.clientY,
      windowStartX: win.element.offsetLeft,
      windowStartY: win.element.offsetTop,
      rafId: null
    };
    
    win.element.classList.add('dragging');
    this.focus(windowId);
  }
  
  // 处理拖拽 - 使用 requestAnimationFrame 优化
  handleDrag(e) {
    if (!this.dragState) return;
    
    // 取消之前的 RAF
    if (this.dragState.rafId) {
      cancelAnimationFrame(this.dragState.rafId);
    }
    
    // 使用 requestAnimationFrame 优化性能
    this.dragState.rafId = requestAnimationFrame(() => {
      const win = this.windows.get(this.dragState.windowId);
      if (!win) return;
      
      const deltaX = e.clientX - this.dragState.startX;
      const deltaY = e.clientY - this.dragState.startY;
      
      const newX = this.dragState.windowStartX + deltaX;
      const newY = Math.max(28, this.dragState.windowStartY + deltaY); // 不超过菜单栏
      
      win.element.style.left = newX + 'px';
      win.element.style.top = newY + 'px';
      win.element.style.transform = 'none';
    });
  }
  
  // 结束拖拽
  endDrag() {
    if (!this.dragState) return;
    
    // 取消未完成的 RAF
    if (this.dragState.rafId) {
      cancelAnimationFrame(this.dragState.rafId);
    }
    
    const win = this.windows.get(this.dragState.windowId);
    if (win) {
      win.element.classList.remove('dragging');
    }
    
    this.dragState = null;
  }
  
  // 开始调整大小
  startResize(windowId, direction, e) {
    const win = this.windows.get(windowId);
    if (!win || !win.config.resizable || win.state.isMaximized) return;
    
    e.preventDefault();
    
    this.resizeState = {
      windowId,
      direction,
      startX: e.clientX,
      startY: e.clientY,
      startWidth: win.element.offsetWidth,
      startHeight: win.element.offsetHeight,
      startLeft: win.element.offsetLeft,
      startTop: win.element.offsetTop,
      rafId: null
    };
    
    win.element.classList.add('resizing');
    this.focus(windowId);
  }
  
  // 处理调整大小 - 使用 requestAnimationFrame 优化
  handleResize(e) {
    if (!this.resizeState) return;
    
    // 取消之前的 RAF
    if (this.resizeState.rafId) {
      cancelAnimationFrame(this.resizeState.rafId);
    }
    
    this.resizeState.rafId = requestAnimationFrame(() => {
      const win = this.windows.get(this.resizeState.windowId);
      if (!win) return;
      
      const deltaX = e.clientX - this.resizeState.startX;
      const deltaY = e.clientY - this.resizeState.startY;
      const dir = this.resizeState.direction;
      
      const minWidth = win.config.minWidth || 400;
      const minHeight = win.config.minHeight || 300;
      
      let newWidth = this.resizeState.startWidth;
      let newHeight = this.resizeState.startHeight;
      let newLeft = this.resizeState.startLeft;
      let newTop = this.resizeState.startTop;
      
      // 根据方向调整
      if (dir.includes('e')) {
        newWidth = Math.max(minWidth, this.resizeState.startWidth + deltaX);
      }
      if (dir.includes('w')) {
        newWidth = Math.max(minWidth, this.resizeState.startWidth - deltaX);
        if (newWidth > minWidth) {
          newLeft = this.resizeState.startLeft + deltaX;
        }
      }
      if (dir.includes('s')) {
        newHeight = Math.max(minHeight, this.resizeState.startHeight + deltaY);
      }
      if (dir.includes('n')) {
        newHeight = Math.max(minHeight, this.resizeState.startHeight - deltaY);
        if (newHeight > minHeight) {
          newTop = this.resizeState.startTop + deltaY;
        }
      }
      
      win.element.style.width = newWidth + 'px';
      win.element.style.height = newHeight + 'px';
      
      if (dir.includes('w') || dir.includes('n')) {
        win.element.style.left = newLeft + 'px';
        win.element.style.top = Math.max(28, newTop) + 'px';
      }
    });
  }
  
  // 结束调整大小
  endResize() {
    if (!this.resizeState) return;
    
    // 取消未完成的 RAF
    if (this.resizeState.rafId) {
      cancelAnimationFrame(this.resizeState.rafId);
    }
    
    const win = this.windows.get(this.resizeState.windowId);
    if (win) {
      win.element.classList.remove('resizing');
    }
    
    this.resizeState = null;
  }
  
  // 更新 Dock 状态
  updateDockState() {
    document.querySelectorAll('.dock-item[data-app]').forEach(item => {
      const appId = item.dataset.app;
      const hasOpenWindow = Array.from(this.windows.values()).some(w => 
        w.element.style.display !== 'none' && 
        !w.state.isMinimized &&
        w.config.appId === appId
      );
      item.classList.toggle('active', hasOpenWindow);
    });
  }
  
  // 更新最小化区域
  updateMinimizedDock() {
    const container = document.getElementById('dock-minimized');
    if (!container) return;
    
    container.innerHTML = this.minimizedWindows.map(windowId => {
      const win = this.windows.get(windowId);
      if (!win) return '';
      return `
        <div class="window-snapshot" onclick="windowManager.restore('${windowId}')" title="${win.config.title}">
          ${win.config.icon}
        </div>
      `;
    }).join('');
  }
  
  // 创建新窗口
  create(config) {
    const windowId = config.id || `window-${Date.now()}`;
    
    // 创建窗口元素
    const windowEl = document.createElement('div');
    windowEl.id = windowId;
    windowEl.className = 'macos-window glass-window';
    windowEl.innerHTML = `
      <div class="window-resize-handle n"></div>
      <div class="window-resize-handle s"></div>
      <div class="window-resize-handle e"></div>
      <div class="window-resize-handle w"></div>
      <div class="window-resize-handle ne"></div>
      <div class="window-resize-handle nw"></div>
      <div class="window-resize-handle se"></div>
      <div class="window-resize-handle sw"></div>
      
      <div class="window-titlebar">
        <div class="window-controls">
          <div class="window-btn close"></div>
          <div class="window-btn minimize"></div>
          <div class="window-btn maximize"></div>
        </div>
        <div class="window-title">
          <span class="window-title-icon">${config.icon || '📄'}</span>
          <span class="window-title-text">${config.title || '新窗口'}</span>
        </div>
        ${config.toolbar ? `<div class="window-toolbar">${config.toolbar}</div>` : ''}
      </div>
      
      <div class="window-content">
        ${config.content || ''}
      </div>
    `;
    
    // 添加到桌面
    const desktop = document.getElementById('desktop-area');
    if (desktop) {
      desktop.appendChild(windowEl);
    } else {
      document.body.appendChild(windowEl);
    }
    
    // 注册窗口
    this.register(windowId, config);
    
    return windowEl;
  }
  
  // 销毁窗口
  destroy(windowId) {
    const win = this.windows.get(windowId);
    if (!win) return;
    
    win.element.remove();
    this.windows.delete(windowId);
    
    const idx = this.minimizedWindows.indexOf(windowId);
    if (idx > -1) {
      this.minimizedWindows.splice(idx, 1);
      this.updateMinimizedDock();
    }
    
    if (this.activeWindowId === windowId) {
      this.activeWindowId = null;
    }
    
    this.updateDockState();
  }
  
  // 获取所有窗口
  getAll() {
    return Array.from(this.windows.values());
  }
  
  // 获取活动窗口
  getActive() {
    return this.activeWindowId ? this.windows.get(this.activeWindowId) : null;
  }
  
  // 层叠窗口
  cascade() {
    const windows = this.getAll().filter(w => !w.state.isMinimized && w.element.style.display !== 'none');
    const startX = 100;
    const startY = 60;
    const offsetX = 30;
    const offsetY = 30;
    
    windows.forEach((win, index) => {
      win.element.style.left = (startX + index * offsetX) + 'px';
      win.element.style.top = (startY + index * offsetY) + 'px';
      win.element.style.transform = 'none';
      win.state.isMaximized = false;
      win.element.classList.remove('maximized');
    });
  }
  
  // 销毁
  destroy() {
    if (this.styles && this.styles.parentNode) {
      this.styles.parentNode.removeChild(this.styles);
    }
  }
}

// 单例
let windowManagerInstance = null;

function getWindowManager() {
  if (!windowManagerInstance) {
    windowManagerInstance = new WindowManager();
  }
  return windowManagerInstance;
}

// 自动初始化并挂载到 window
window.windowManager = getWindowManager();

// 导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { WindowManager, getWindowManager };
}
