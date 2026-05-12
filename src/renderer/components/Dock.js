/**
 * Dock 组件 - macOS 风格
 * 支持：悬停放大、拖拽排序、活跃指示
 */

class MacDock {
  constructor(containerId, options = {}) {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      console.error('Dock container not found:', containerId);
      return;
    }
    
    this.options = {
      itemSize: options.itemSize || 50,
      magnification: options.magnification || 2.0, // 放大倍数
      magnifyRange: options.magnifyRange || 150, // 影响范围（像素）
      enableDrag: options.enableDrag !== false,
      enableTooltip: options.enableTooltip !== false,
      animationDuration: options.animationDuration || 200,
      onReorder: options.onReorder || null,
      onItemClick: options.onItemClick || null,
      ...options
    };
    
    this.items = [];
    this.sortableInstance = null;
    this.isDragging = false;
    
    this.init();
  }
  
  init() {
    // 添加必要的样式
    this.injectStyles();
    
    // 初始化拖拽
    if (this.options.enableDrag && typeof Sortable !== 'undefined') {
      this.initSortable();
    }
    
    // 绑定事件
    this.bindEvents();
    
    console.log('[Dock] 初始化完成');
  }
  
  injectStyles() {
    if (document.getElementById('dock-enhanced-styles')) return;
    
    const styles = document.createElement('style');
    styles.id = 'dock-enhanced-styles';
    styles.textContent = `
      /* Dock 增强样式 */
      .dock-container {
        position: relative;
        transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      }
      
      .dock-item {
        transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1),
                    margin 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        will-change: transform, margin;
      }
      
      /* 拖拽时的样式 */
      .dock-item.sortable-ghost {
        opacity: 0.4;
      }
      
      .dock-item.sortable-chosen {
        transform: scale(1.2) !important;
        z-index: 1000;
      }
      
      .dock-item.sortable-drag {
        opacity: 1;
      }
      
      /* 活跃指示点动画 */
      .dock-item.active::after {
        content: '';
        position: absolute;
        bottom: -4px;
        left: 50%;
        transform: translateX(-50%);
        width: 5px;
        height: 5px;
        background: rgba(255, 255, 255, 0.9);
        border-radius: 50%;
        box-shadow: 0 0 6px rgba(255, 255, 255, 0.5);
        animation: dotPulse 2s ease-in-out infinite;
      }
      
      @keyframes dotPulse {
        0%, 100% { opacity: 1; transform: translateX(-50%) scale(1); }
        50% { opacity: 0.7; transform: translateX(-50%) scale(0.8); }
      }
      
      /* Tooltip 增强 */
      .dock-tooltip {
        position: absolute;
        top: -45px;
        left: 50%;
        transform: translateX(-50%) translateY(5px);
        background: rgba(0, 0, 0, 0.85);
        color: white;
        padding: 6px 12px;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 500;
        white-space: nowrap;
        opacity: 0;
        pointer-events: none;
        transition: all 0.2s ease;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
        z-index: 10000;
      }
      
      .dock-tooltip::after {
        content: '';
        position: absolute;
        bottom: -5px;
        left: 50%;
        transform: translateX(-50%);
        border-left: 5px solid transparent;
        border-right: 5px solid transparent;
        border-top: 5px solid rgba(0, 0, 0, 0.85);
      }
      
      .dock-item:hover .dock-tooltip {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }
      
      /* Dock 图标样式 */
      .dock-item-icon {
        width: 46px;
        height: 46px;
        border-radius: 10px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 24px;
        background: linear-gradient(135deg, var(--accent), var(--accent-purple));
        box-shadow: 0 4px 12px rgba(0, 122, 255, 0.3);
        transition: all 0.2s ease;
        position: relative;
        overflow: hidden;
      }
      
      .dock-item-icon::before {
        content: '';
        position: absolute;
        inset: 0;
        background: linear-gradient(135deg, rgba(255,255,255,0.25), transparent);
        opacity: 0;
        transition: opacity 0.2s ease;
      }
      
      .dock-item:hover .dock-item-icon::before {
        opacity: 1;
      }
      
      .dock-item:hover .dock-item-icon {
        box-shadow: 0 6px 20px rgba(0, 122, 255, 0.5);
      }
      
      /* Dock 分隔线 */
      .dock-divider {
        width: 1px;
        height: 40px;
        background: rgba(255, 255, 255, 0.2);
        margin: 0 8px;
        flex-shrink: 0;
      }
      
      /* 最小化窗口区域 */
      .dock-minimized {
        display: flex;
        align-items: center;
        gap: 4px;
        margin-left: 8px;
        padding-left: 8px;
        border-left: 1px solid rgba(255, 255, 255, 0.2);
      }
      
      .dock-minimized-item {
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
      
      .dock-minimized-item:hover {
        background: rgba(255, 255, 255, 0.2);
        transform: scale(1.1);
      }
    `;
    
    document.head.appendChild(styles);
  }
  
  initSortable() {
    if (typeof Sortable === 'undefined') {
      console.warn('[Dock] Sortable.js not loaded');
      return;
    }
    
    this.sortableInstance = new Sortable(this.container, {
      animation: this.options.animationDuration,
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      dragClass: 'sortable-drag',
      filter: '.dock-divider, .dock-minimized',
      onStart: (evt) => {
        this.isDragging = true;
        this.container.style.cursor = 'grabbing';
      },
      onEnd: (evt) => {
        this.isDragging = false;
        this.container.style.cursor = '';
        
        if (this.options.onReorder) {
          const newOrder = Array.from(this.container.querySelectorAll('.dock-item[data-app]'))
            .map(item => item.dataset.app);
          this.options.onReorder(newOrder);
        }
      }
    });
  }
  
  bindEvents() {
    // 鼠标移动 - 放大效果
    this.container.addEventListener('mousemove', (e) => {
      if (this.isDragging) return;
      this.handleMagnification(e);
    });
    
    // 鼠标离开 - 重置
    this.container.addEventListener('mouseleave', () => {
      this.resetMagnification();
    });
    
    // 点击事件
    this.container.addEventListener('click', (e) => {
      const item = e.target.closest('.dock-item');
      if (item && this.options.onItemClick) {
        const appId = item.dataset.app;
        this.options.onItemClick(appId, item);
      }
    });
  }
  
  handleMagnification(e) {
    const items = this.container.querySelectorAll('.dock-item:not(.dock-divider):not(.dock-minimized-item)');
    const containerRect = this.container.getBoundingClientRect();
    
    items.forEach((item, index) => {
      const itemRect = item.getBoundingClientRect();
      const itemCenter = itemRect.left + itemRect.width / 2;
      const distance = Math.abs(e.clientX - itemCenter);
      
      if (distance < this.options.magnifyRange) {
        // 计算放大比例（距离越近，放大越多）
        const ratio = 1 - (distance / this.options.magnifyRange);
        const scale = 1 + (this.options.magnification - 1) * ratio;
        const translateY = -10 * ratio;
        
        // 计算额外的 margin（防止重叠）
        const margin = 12 * ratio;
        
        item.style.transform = `scale(${scale}) translateY(${translateY}px)`;
        item.style.marginLeft = `${margin}px`;
        item.style.marginRight = `${margin}px`;
        item.style.zIndex = Math.round(10 * ratio);
      } else {
        item.style.transform = '';
        item.style.marginLeft = '';
        item.style.marginRight = '';
        item.style.zIndex = '';
      }
    });
  }
  
  resetMagnification() {
    const items = this.container.querySelectorAll('.dock-item');
    items.forEach(item => {
      item.style.transform = '';
      item.style.marginLeft = '';
      item.style.marginRight = '';
      item.style.zIndex = '';
    });
  }
  
  // 添加项目
  addItem(config) {
    const item = document.createElement('div');
    item.className = 'dock-item';
    item.dataset.app = config.id;
    
    if (config.active) {
      item.classList.add('active');
    }
    
    item.innerHTML = `
      <div class="dock-item-icon" style="${config.iconStyle || ''}">${config.icon}</div>
      ${this.options.enableTooltip ? `<span class="dock-tooltip">${config.title}</span>` : ''}
    `;
    
    // 插入到分隔线之前
    const divider = this.container.querySelector('.dock-divider');
    if (divider) {
      this.container.insertBefore(item, divider);
    } else {
      this.container.appendChild(item);
    }
    
    this.items.push(config);
    return item;
  }
  
  // 移除项目
  removeItem(appId) {
    const item = this.container.querySelector(`[data-app="${appId}"]`);
    if (item) {
      item.remove();
      this.items = this.items.filter(i => i.id !== appId);
    }
  }
  
  // 设置活跃状态
  setActive(appId, active = true) {
    const item = this.container.querySelector(`[data-app="${appId}"]`);
    if (item) {
      item.classList.toggle('active', active);
    }
  }
  
  // 添加最小化窗口
  addMinimizedWindow(windowId, config) {
    let minimizedContainer = this.container.querySelector('.dock-minimized');
    if (!minimizedContainer) {
      minimizedContainer = document.createElement('div');
      minimizedContainer.className = 'dock-minimized';
      this.container.appendChild(minimizedContainer);
    }
    
    const item = document.createElement('div');
    item.className = 'dock-minimized-item';
    item.dataset.windowId = windowId;
    item.innerHTML = config.icon;
    item.title = config.title;
    
    item.addEventListener('click', () => {
      if (this.options.onRestoreWindow) {
        this.options.onRestoreWindow(windowId);
      }
    });
    
    minimizedContainer.appendChild(item);
    return item;
  }
  
  // 移除最小化窗口
  removeMinimizedWindow(windowId) {
    const item = this.container.querySelector(`.dock-minimized-item[data-window-id="${windowId}"]`);
    if (item) {
      item.remove();
    }
  }
  
  // 销毁
  destroy() {
    if (this.sortableInstance) {
      this.sortableInstance.destroy();
    }
  }
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MacDock;
}
