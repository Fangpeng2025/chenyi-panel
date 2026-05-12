/**
 * UI 组件集成
 * 将 Dock、GlassEffect、WindowManager 整合到主应用
 */

// 引入组件（如果使用模块系统）
// import MacDock from './components/Dock.js';
// import GlassEffect from './components/GlassEffect.js';
// import WindowManager from './components/WindowManager.js';

class UIIntegration {
  constructor() {
    this.dock = null;
    this.glassEffect = null;
    this.windowManager = null;
    
    this.init();
  }
  
  init() {
    // 等待 DOM 加载完成
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.setup());
    } else {
      this.setup();
    }
  }
  
  setup() {
    console.log('[UIIntegration] 开始集成 UI 组件...');
    
    // 初始化毛玻璃效果
    this.initGlassEffect();
    
    // 初始化窗口管理器
    this.initWindowManager();
    
    // 初始化 Dock
    this.initDock();
    
    // 应用增强样式
    this.applyEnhancedStyles();
    
    console.log('[UIIntegration] UI 组件集成完成');
  }
  
  initGlassEffect() {
    if (typeof getGlassEffect === 'function') {
      this.glassEffect = getGlassEffect();
    } else if (typeof GlassEffect === 'function') {
      this.glassEffect = new GlassEffect();
    }
    
    // 应用毛玻璃效果到主要元素
    this.applyGlassToElements();
  }
  
  applyGlassToElements() {
    // 菜单栏
    const menubar = document.querySelector('.menu-bar');
    if (menubar) {
      menubar.classList.add('glass-menubar');
    }
    
    // Dock
    const dockContainer = document.getElementById('dock-container');
    if (dockContainer) {
      dockContainer.classList.add('glass-dock');
    }
    
    // 窗口
    document.querySelectorAll('.macos-window').forEach(win => {
      win.classList.add('glass-window');
    });
    
    // 侧边栏
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) {
      sidebar.classList.add('glass-dark');
    }
    
    // 输入框
    const chatInput = document.getElementById('chat-input');
    if (chatInput) {
      chatInput.classList.add('glass-input');
    }
    
    // 按钮
    document.querySelectorAll('.toolbar-btn').forEach(btn => {
      btn.classList.add('glass-button');
    });
  }
  
  initWindowManager() {
    if (typeof getWindowManager === 'function') {
      this.windowManager = getWindowManager();
    } else if (typeof WindowManager === 'function') {
      this.windowManager = new WindowManager();
    }
    
    // 注册现有窗口
    const chatWindow = document.getElementById('window-chat');
    if (chatWindow) {
      this.windowManager.register('window-chat', {
        title: '晨翼对话',
        icon: '💬',
        appId: 'chat',
        width: 900,
        height: 600,
        x: (window.innerWidth - 900) / 2,
        y: 60
      });
    }
    
    // 设置为全局变量，供其他代码使用
    window.windowManager = this.windowManager;
  }
  
  initDock() {
    const dockContainer = document.getElementById('dock-container');
    if (!dockContainer) return;
    
    if (typeof MacDock === 'function') {
      this.dock = new MacDock('dock-container', {
        itemSize: 50,
        magnification: 2.0,
        magnifyRange: 150,
        enableDrag: true,
        enableTooltip: true,
        onReorder: (newOrder) => {
          console.log('[Dock] 新顺序:', newOrder);
          // 保存到 localStorage
          localStorage.setItem('dock_order', JSON.stringify(newOrder));
        },
        onItemClick: (appId, item) => {
          console.log('[Dock] 点击:', appId);
          this.handleDockClick(appId);
        },
        onRestoreWindow: (windowId) => {
          if (this.windowManager) {
            this.windowManager.restore(windowId);
          }
        }
      });
      
      // 设置为全局变量
      window.macDock = this.dock;
    } else {
      // 降级方案：使用原有的简单 Dock 效果
      this.setupSimpleDock();
    }
  }
  
  handleDockClick(appId) {
    // 检查是否已有打开的窗口
    const existingWindow = this.windowManager?.getAll().find(w => 
      w.config.appId === appId && 
      w.element.style.display !== 'none' &&
      !w.state.isMinimized
    );
    
    if (existingWindow) {
      // 激活现有窗口
      this.windowManager.focus(existingWindow.id);
    } else {
      // 打开新窗口
      this.openAppWindow(appId);
    }
  }
  
  openAppWindow(appId) {
    const appConfigs = {
      files: {
        title: '文件管理',
        icon: '📁',
        content: '<div style="padding: 20px; color: var(--text-secondary);">文件管理功能开发中...</div>'
      },
      tools: {
        title: '工具箱',
        icon: '🔧',
        content: '<div style="padding: 20px; color: var(--text-secondary);">工具箱功能开发中...</div>'
      },
      devices: {
        title: '设备管理',
        icon: '📱',
        content: '<div style="padding: 20px; color: var(--text-secondary);">设备管理功能开发中...</div>'
      },
      settings: {
        title: '设置',
        icon: '⚙️',
        content: '<div style="padding: 20px; color: var(--text-secondary);">设置功能开发中...</div>'
      },
      chat: {
        // 聊天窗口已存在，直接激活
        existing: true
      }
    };
    
    const config = appConfigs[appId];
    if (!config) return;
    
    if (config.existing) {
      const win = document.getElementById('window-chat');
      if (win) {
        win.style.display = 'flex';
        this.windowManager?.focus('window-chat');
      }
      return;
    }
    
    // 创建新窗口
    const windowId = `window-${appId}-${Date.now()}`;
    this.windowManager?.create({
      id: windowId,
      title: config.title,
      icon: config.icon,
      appId: appId,
      content: config.content,
      width: 800,
      height: 500,
      onClose: (id) => {
        console.log('[App] 关闭窗口:', id);
        return true;
      }
    });
    
    this.windowManager?.open(windowId);
  }
  
  setupSimpleDock() {
    // 简单的 Dock 效果（不依赖 Sortable.js）
    const dockItems = document.querySelectorAll('.dock-item');
    
    dockItems.forEach((item, index) => {
      item.addEventListener('mouseenter', () => {
        dockItems.forEach((otherItem, otherIndex) => {
          const distance = Math.abs(index - otherIndex);
          if (distance === 1) {
            otherItem.style.transform = 'scale(1.15) translateY(-4px)';
          } else if (distance === 2) {
            otherItem.style.transform = 'scale(1.05) translateY(-2px)';
          }
        });
      });
      
      item.addEventListener('mouseleave', () => {
        dockItems.forEach(otherItem => {
          otherItem.style.transform = '';
        });
      });
      
      item.addEventListener('click', () => {
        const appId = item.dataset.app;
        if (appId) {
          this.handleDockClick(appId);
        }
      });
    });
  }
  
  applyEnhancedStyles() {
    // 添加额外的增强样式
    const style = document.createElement('style');
    style.textContent = `
      /* 增强动画 */
      .macos-window {
        transition: box-shadow 0.3s ease, transform 0.3s ease;
      }
      
      /* 消息气泡增强 */
      .message-content {
        transition: transform 0.2s ease, box-shadow 0.2s ease;
      }
      
      .message:hover .message-content {
        transform: translateX(2px);
      }
      
      /* 输入区域增强 */
      .chat-input-area {
        background: rgba(30, 30, 32, 0.6);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
      }
      
      /* 按钮悬停效果 */
      .btn-send {
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      }
      
      .btn-send:hover {
        transform: translateY(-2px) scale(1.05);
      }
      
      /* 会话列表项增强 */
      .session-item {
        transition: all 0.2s ease;
      }
      
      .session-item:hover {
        transform: translateX(4px);
      }
      
      /* 导航项增强 */
      .nav-item {
        transition: all 0.2s ease;
      }
      
      .nav-item:hover {
        transform: translateX(4px);
      }
      
      /* 工具调用块增强 */
      .tool-call {
        transition: all 0.2s ease;
      }
      
      .tool-call:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0, 122, 255, 0.2);
      }
      
      /* 滚动条增强 */
      ::-webkit-scrollbar {
        width: 8px;
        height: 8px;
      }
      
      ::-webkit-scrollbar-track {
        background: transparent;
      }
      
      ::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.15);
        border-radius: 4px;
        transition: background 0.2s ease;
      }
      
      ::-webkit-scrollbar-thumb:hover {
        background: rgba(255, 255, 255, 0.25);
      }
      
      /* 选中文本增强 */
      ::selection {
        background: rgba(0, 122, 255, 0.3);
        color: white;
      }
      
      /* 焦点增强 */
      *:focus {
        outline: none;
      }
      
      *:focus-visible {
        outline: 2px solid rgba(0, 122, 255, 0.5);
        outline-offset: 2px;
      }
      
      /* 响应式调整 */
      @media (max-width: 768px) {
        .macos-window {
          width: 100% !important;
          height: calc(100% - 28px - 80px) !important;
          top: 28px !important;
          left: 0 !important;
          border-radius: 0;
        }
        
        .sidebar {
          width: 60px;
        }
        
        .sidebar-header,
        .nav-section-title,
        .session-time {
          display: none;
        }
        
        .session-name {
          font-size: 11px;
        }
      }
      
      /* 打印样式 */
      @media print {
        .menu-bar,
        .dock,
        .window-titlebar,
        .chat-input-area {
          display: none !important;
        }
        
        .macos-window {
          position: static !important;
          width: 100% !important;
          height: auto !important;
          box-shadow: none !important;
          border: 1px solid #ddd !important;
        }
      }
    `;
    
    document.head.appendChild(style);
  }
  
  // 公共方法：创建自定义窗口
  createWindow(config) {
    return this.windowManager?.create(config);
  }
  
  // 公共方法：关闭窗口
  closeWindow(windowId) {
    this.windowManager?.close(windowId);
  }
  
  // 公共方法：最小化窗口
  minimizeWindow(windowId) {
    this.windowManager?.minimize(windowId);
  }
  
  // 公共方法：最大化窗口
  maximizeWindow(windowId) {
    this.windowManager?.toggleMaximize(windowId);
  }
  
  // 公共方法：激活窗口
  focusWindow(windowId) {
    this.windowManager?.focus(windowId);
  }
  
  // 公共方法：添加 Dock 项目
  addDockItem(config) {
    this.dock?.addItem(config);
  }
  
  // 公共方法：移除 Dock 项目
  removeDockItem(appId) {
    this.dock?.removeItem(appId);
  }
  
  // 公共方法：设置 Dock 活跃状态
  setDockActive(appId, active) {
    this.dock?.setActive(appId, active);
  }
}

// 创建全局实例
let uiIntegration = null;

function initUI() {
  if (!uiIntegration) {
    uiIntegration = new UIIntegration();
  }
  return uiIntegration;
}

// 自动初始化
if (typeof window !== 'undefined') {
  window.initUI = initUI;
  window.uiIntegration = null;
  
  // 在 DOM 加载后自动初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      window.uiIntegration = initUI();
    });
  } else {
    window.uiIntegration = initUI();
  }
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { UIIntegration, initUI };
}
