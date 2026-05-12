/**
 * 毛玻璃效果组件 - macOS Big Sur 风格
 * 支持：backdrop-filter、动态模糊、圆角边框
 */

class GlassEffect {
  constructor() {
    this.styles = null;
    this.init();
  }
  
  init() {
    this.injectStyles();
    console.log('[GlassEffect] 毛玻璃效果已初始化');
  }
  
  injectStyles() {
    if (document.getElementById('glass-effect-styles')) return;
    
    this.styles = document.createElement('style');
    this.styles.id = 'glass-effect-styles';
    this.styles.textContent = `
      /* ==================== 毛玻璃效果系统 ==================== */
      
      /* 基础毛玻璃 */
      .glass {
        background: rgba(255, 255, 255, 0.08);
        backdrop-filter: blur(20px) saturate(180%);
        -webkit-backdrop-filter: blur(20px) saturate(180%);
        border: 1px solid rgba(255, 255, 255, 0.1);
        box-shadow: 
          0 8px 32px rgba(0, 0, 0, 0.2),
          inset 0 1px 0 rgba(255, 255, 255, 0.1);
      }
      
      /* 浅色毛玻璃 */
      .glass-light {
        background: rgba(255, 255, 255, 0.15);
        backdrop-filter: blur(25px) saturate(200%);
        -webkit-backdrop-filter: blur(25px) saturate(200%);
        border: 1px solid rgba(255, 255, 255, 0.15);
        box-shadow: 
          0 8px 32px rgba(0, 0, 0, 0.15),
          inset 0 1px 0 rgba(255, 255, 255, 0.15);
      }
      
      /* 深色毛玻璃 */
      .glass-dark {
        background: rgba(30, 30, 32, 0.85);
        backdrop-filter: blur(30px) saturate(180%);
        -webkit-backdrop-filter: blur(30px) saturate(180%);
        border: 1px solid rgba(255, 255, 255, 0.08);
        box-shadow: 
          0 12px 40px rgba(0, 0, 0, 0.3),
          inset 0 1px 0 rgba(255, 255, 255, 0.08);
      }
      
      /* 强调毛玻璃 */
      .glass-accent {
        background: linear-gradient(
          135deg,
          rgba(0, 122, 255, 0.15),
          rgba(191, 90, 242, 0.15)
        );
        backdrop-filter: blur(20px) saturate(180%);
        -webkit-backdrop-filter: blur(20px) saturate(180%);
        border: 1px solid rgba(0, 122, 255, 0.2);
        box-shadow: 
          0 8px 32px rgba(0, 122, 255, 0.2),
          inset 0 1px 0 rgba(255, 255, 255, 0.1);
      }
      
      /* 窗口毛玻璃 */
      .glass-window {
        background: rgba(30, 30, 32, 0.92);
        backdrop-filter: blur(40px) saturate(180%);
        -webkit-backdrop-filter: blur(40px) saturate(180%);
        border: 1px solid rgba(255, 255, 255, 0.1);
        box-shadow: 
          0 25px 50px rgba(0, 0, 0, 0.5),
          0 0 0 1px rgba(255, 255, 255, 0.05) inset;
      }
      
      /* Dock 毛玻璃 */
      .glass-dock {
        background: rgba(255, 255, 255, 0.15);
        backdrop-filter: blur(20px) saturate(180%);
        -webkit-backdrop-filter: blur(20px) saturate(180%);
        border: 1px solid rgba(255, 255, 255, 0.1);
        box-shadow: 
          0 0 0 1px rgba(255, 255, 255, 0.1),
          0 10px 40px rgba(0, 0, 0, 0.3);
      }
      
      /* 菜单栏毛玻璃 */
      .glass-menubar {
        background: rgba(30, 30, 32, 0.75);
        backdrop-filter: blur(20px) saturate(180%);
        -webkit-backdrop-filter: blur(20px) saturate(180%);
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      }
      
      /* 卡片毛玻璃 */
      .glass-card {
        background: rgba(40, 40, 43, 0.95);
        backdrop-filter: blur(20px) saturate(180%);
        -webkit-backdrop-filter: blur(20px) saturate(180%);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 14px;
        box-shadow: 
          0 4px 16px rgba(0, 0, 0, 0.2),
          inset 0 1px 0 rgba(255, 255, 255, 0.08);
      }
      
      /* 模态框毛玻璃 */
      .glass-modal {
        background: rgba(30, 30, 32, 0.95);
        backdrop-filter: blur(40px) saturate(180%);
        -webkit-backdrop-filter: blur(40px) saturate(180%);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 16px;
        box-shadow: 
          0 16px 48px rgba(0, 0, 0, 0.4),
          inset 0 1px 0 rgba(255, 255, 255, 0.1);
      }
      
      /* 通知毛玻璃 */
      .glass-notification {
        background: rgba(255, 255, 255, 0.9);
        backdrop-filter: blur(20px) saturate(180%);
        -webkit-backdrop-filter: blur(20px) saturate(180%);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 12px;
        box-shadow: 
          0 8px 24px rgba(0, 0, 0, 0.2),
          inset 0 1px 0 rgba(255, 255, 255, 0.3);
      }
      
      /* 输入框毛玻璃 */
      .glass-input {
        background: rgba(45, 45, 48, 0.8);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 10px;
        transition: all 0.2s ease;
      }
      
      .glass-input:focus {
        border-color: rgba(0, 122, 255, 0.5);
        box-shadow: 
          0 0 0 3px rgba(0, 122, 255, 0.2),
          inset 0 1px 0 rgba(255, 255, 255, 0.1);
      }
      
      /* 按钮毛玻璃 */
      .glass-button {
        background: rgba(255, 255, 255, 0.08);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 8px;
        transition: all 0.2s ease;
      }
      
      .glass-button:hover {
        background: rgba(255, 255, 255, 0.12);
        border-color: rgba(255, 255, 255, 0.15);
        transform: translateY(-1px);
      }
      
      .glass-button:active {
        transform: translateY(0);
        background: rgba(255, 255, 255, 0.1);
      }
      
      /* ==================== 动态毛玻璃效果 ==================== */
      
      /* 光晕效果 */
      .glass-glow {
        position: relative;
      }
      
      .glass-glow::before {
        content: '';
        position: absolute;
        inset: -2px;
        background: linear-gradient(
          45deg,
          rgba(0, 122, 255, 0.3),
          rgba(191, 90, 242, 0.3),
          rgba(48, 209, 88, 0.3)
        );
        border-radius: inherit;
        filter: blur(15px);
        opacity: 0;
        transition: opacity 0.3s ease;
        z-index: -1;
      }
      
      .glass-glow:hover::before {
        opacity: 1;
      }
      
      /* 边框渐变 */
      .glass-border-gradient {
        position: relative;
        background: rgba(30, 30, 32, 0.9);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
      }
      
      .glass-border-gradient::before {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: inherit;
        padding: 1px;
        background: linear-gradient(
          135deg,
          rgba(0, 122, 255, 0.5),
          rgba(191, 90, 242, 0.5)
        );
        -webkit-mask: 
          linear-gradient(#fff 0 0) content-box, 
          linear-gradient(#fff 0 0);
        -webkit-mask-composite: xor;
        mask-composite: exclude;
        pointer-events: none;
      }
      
      /* ==================== 特殊效果 ==================== */
      
      /* 磨砂玻璃 */
      .glass-frosted {
        background: rgba(255, 255, 255, 0.05);
        backdrop-filter: blur(30px) brightness(0.9);
        -webkit-backdrop-filter: blur(30px) brightness(0.9);
        border: 1px solid rgba(255, 255, 255, 0.08);
      }
      
      /* 半透明玻璃 */
      .glass-transparent {
        background: rgba(255, 255, 255, 0.03);
        backdrop-filter: blur(15px);
        -webkit-backdrop-filter: blur(15px);
        border: 1px solid rgba(255, 255, 255, 0.05);
      }
      
      /* 镜面玻璃 */
      .glass-mirror {
        background: linear-gradient(
          135deg,
          rgba(255, 255, 255, 0.2),
          rgba(255, 255, 255, 0.05)
        );
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border: 1px solid rgba(255, 255, 255, 0.2);
      }
      
      /* ==================== 动画效果 ==================== */
      
      @keyframes glassShimmer {
        0% {
          background-position: -100% 0;
        }
        100% {
          background-position: 200% 0;
        }
      }
      
      .glass-shimmer {
        position: relative;
        overflow: hidden;
      }
      
      .glass-shimmer::after {
        content: '';
        position: absolute;
        inset: 0;
        background: linear-gradient(
          90deg,
          transparent,
          rgba(255, 255, 255, 0.1),
          transparent
        );
        background-size: 200% 100%;
        animation: glassShimmer 3s ease-in-out infinite;
        pointer-events: none;
      }
      
      /* ==================== 响应式调整 ==================== */
      
      @media (prefers-reduced-motion: reduce) {
        .glass-shimmer::after {
          animation: none;
        }
      }
      
      /* 低性能设备降级 */
      @media (prefers-reduced-transparency: reduce) {
        .glass,
        .glass-light,
        .glass-dark,
        .glass-accent,
        .glass-window,
        .glass-dock,
        .glass-menubar,
        .glass-card,
        .glass-modal,
        .glass-notification,
        .glass-input,
        .glass-button {
          backdrop-filter: none;
          -webkit-backdrop-filter: none;
        }
      }
    `;
    
    document.head.appendChild(this.styles);
  }
  
  // 应用毛玻璃效果
  apply(element, type = 'default') {
    if (typeof element === 'string') {
      element = document.querySelector(element);
    }
    
    if (!element) return;
    
    // 移除所有 glass- 类
    element.className = element.className.replace(/\bglass[\w-]*\b/g, '').trim();
    
    // 添加新的类
    element.classList.add(`glass${type === 'default' ? '' : '-' + type}`);
    
    return element;
  }
  
  // 移除毛玻璃效果
  remove(element) {
    if (typeof element === 'string') {
      element = document.querySelector(element);
    }
    
    if (!element) return;
    
    element.className = element.className.replace(/\bglass[\w-]*\b/g, '').trim();
    
    return element;
  }
  
  // 创建毛玻璃元素
  create(type = 'default', tag = 'div') {
    const element = document.createElement(tag);
    element.className = `glass${type === 'default' ? '' : '-' + type}`;
    return element;
  }
  
  // 销毁
  destroy() {
    if (this.styles && this.styles.parentNode) {
      this.styles.parentNode.removeChild(this.styles);
    }
  }
}

// 单例
let glassEffectInstance = null;

function getGlassEffect() {
  if (!glassEffectInstance) {
    glassEffectInstance = new GlassEffect();
  }
  return glassEffectInstance;
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { GlassEffect, getGlassEffect };
}
