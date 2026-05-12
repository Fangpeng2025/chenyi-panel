# 晨翼Agent UI 优化说明

## 🎨 已实现的优化

### 1. **Dock 菜单动效** ✅

#### 功能特性：
- ✅ **悬停放大效果**：鼠标悬停时，图标放大到 `scale(2)` 并向上移动 `translateY(-10px)`
- ✅ **邻近图标联动**：相邻图标也会相应放大，营造流畅的视觉效果
- ✅ **拖拽排序**：使用 Sortable.js 实现，可以自由调整 Dock 图标顺序
- ✅ **活跃状态指示点**：当前打开的应用会显示白色小圆点
- ✅ **工具提示**：悬停时显示应用名称

#### 技术实现：
```javascript
// 文件：src/renderer/components/Dock.js

// 初始化 Dock
const dock = new MacDock('dock-container', {
  itemSize: 50,          // 图标大小
  magnification: 2.0,    // 放大倍数
  magnifyRange: 150,     // 影响范围（像素）
  enableDrag: true,      // 启用拖拽
  enableTooltip: true,   // 启用提示
  onReorder: (newOrder) => {
    // 保存新顺序
    localStorage.setItem('dock_order', JSON.stringify(newOrder));
  },
  onItemClick: (appId, item) => {
    // 处理点击事件
    console.log('点击应用:', appId);
  }
});

// 添加新项目
dock.addItem({
  id: 'my-app',
  icon: '🚀',
  title: '我的应用',
  iconStyle: 'background: linear-gradient(135deg, #ff6b6b, #feca57);'
});

// 设置活跃状态
dock.setActive('my-app', true);
```

### 2. **毛玻璃效果** ✅

#### 功能特性：
- ✅ **backdrop-filter: blur(20px)**：20px 模糊效果
- ✅ **saturate(180%)**：色彩饱和度增强
- ✅ **多种预设样式**：提供多种毛玻璃变体
- ✅ **圆角边框**：macOS 风格的圆角设计
- ✅ **响应式降级**：低性能设备自动降级

#### 可用的毛玻璃样式：
```css
.glass              /* 基础毛玻璃 */
.glass-light        /* 浅色毛玻璃 */
.glass-dark         /* 深色毛玻璃 */
.glass-accent       /* 强调色毛玻璃 */
.glass-window       /* 窗口毛玻璃 */
.glass-dock         /* Dock 毛玻璃 */
.glass-menubar      /* 菜单栏毛玻璃 */
.glass-card         /* 卡片毛玻璃 */
.glass-modal        /* 模态框毛玻璃 */
.glass-notification /* 通知毛玻璃 */
.glass-input        /* 输入框毛玻璃 */
.glass-button       /* 按钮毛玻璃 */
```

#### 使用方法：
```javascript
// 文件：src/renderer/components/GlassEffect.js

// 获取实例
const glassEffect = getGlassEffect();

// 应用到元素
glassEffect.apply('.my-element', 'dark');
glassEffect.apply(document.getElementById('myDiv'), 'accent');

// 创建毛玻璃元素
const element = glassEffect.create('card', 'div');
document.body.appendChild(element);
```

### 3. **多窗口管理** ✅

#### 功能特性：
- ✅ **自定义弹窗组件**：类似 v3layer 的窗口系统
- ✅ **拖拽移动**：标题栏拖拽移动窗口
- ✅ **缩放调整**：8个方向的调整大小手柄
- ✅ **最大化/还原**：双击标题栏或点击最大化按钮
- ✅ **最小化**：最小化到 Dock
- ✅ **窗口层级管理**：自动管理 z-index
- ✅ **动态传入组件**：支持动态创建窗口并传入内容

#### 使用方法：
```javascript
// 文件：src/renderer/components/WindowManager.js

// 获取窗口管理器
const windowManager = getWindowManager();

// 注册现有窗口
windowManager.register('my-window', {
  title: '我的窗口',
  icon: '📄',
  appId: 'my-app',
  width: 800,
  height: 500,
  x: 100,
  y: 60,
  resizable: true,
  maximizable: true,
  minimizable: true,
  closable: true,
  onClose: (windowId) => {
    console.log('关闭窗口:', windowId);
    return true; // 返回 false 阻止关闭
  },
  onMinimize: (windowId) => {
    console.log('最小化窗口:', windowId);
  },
  onMaximize: (windowId, isMaximized) => {
    console.log('最大化状态:', isMaximized);
  },
  onFocus: (windowId) => {
    console.log('激活窗口:', windowId);
  }
});

// 创建新窗口
const windowEl = windowManager.create({
  id: 'dynamic-window',
  title: '动态窗口',
  icon: '🚀',
  appId: 'dynamic-app',
  content: '<div style="padding: 20px;">这是动态创建的窗口内容</div>',
  toolbar: `
    <button class="toolbar-btn">按钮1</button>
    <button class="toolbar-btn">按钮2</button>
  `
});

// 打开窗口
windowManager.open('dynamic-window');

// 关闭窗口
windowManager.close('dynamic-window');

// 最小化窗口
windowManager.minimize('dynamic-window');

// 恢复窗口
windowManager.restore('dynamic-window');

// 最大化/还原
windowManager.toggleMaximize('dynamic-window');

// 激活窗口
windowManager.focus('dynamic-window');

// 层叠所有窗口
windowManager.cascade();
```

## 📁 文件结构

```
src/renderer/
├── index.html              # 主 HTML 文件
├── renderer.js             # 主渲染进程
├── UIIntegration.js        # UI 组件集成
└── components/
    ├── Dock.js             # Dock 组件
    ├── GlassEffect.js      # 毛玻璃效果组件
    └── WindowManager.js    # 窗口管理器
```

## 🚀 快速开始

### 1. 安装依赖

```bash
cd /home/fangpeng/projects/chenyi-panel
npm install sortablejs
```

### 2. 启动应用

```bash
npm start
```

### 3. 使用组件

所有组件已自动集成，无需额外配置。如需自定义，可修改 `UIIntegration.js`。

## 🎯 设计参考

本 UI 优化参考了 [MacUI 设计](https://www.cnblogs.com/xiaoyan2017/p/14926338.html)，实现了以下核心特性：

1. **macOS Big Sur 风格**：现代化的圆角设计和毛玻璃效果
2. **流畅动画**：所有交互都有平滑的过渡动画
3. **响应式设计**：适配不同屏幕尺寸
4. **无障碍支持**：支持键盘导航和屏幕阅读器

## 🔧 自定义配置

### Dock 配置

```javascript
const dock = new MacDock('dock-container', {
  itemSize: 50,          // 图标大小
  magnification: 2.0,    // 放大倍数
  magnifyRange: 150,     // 影响范围
  enableDrag: true,      // 启用拖拽
  enableTooltip: true,   // 启用提示
  animationDuration: 200 // 动画时长（毫秒）
});
```

### 窗口配置

```javascript
windowManager.register('window-id', {
  title: '窗口标题',
  icon: '📄',
  width: 800,
  height: 500,
  minWidth: 400,
  minHeight: 300,
  x: 100,
  y: 60,
  resizable: true,
  maximizable: true,
  minimizable: true,
  closable: true
});
```

## 📝 注意事项

1. **Sortable.js 依赖**：Dock 拖拽功能需要 Sortable.js，已添加到 package.json
2. **浏览器兼容性**：毛玻璃效果需要现代浏览器支持 `backdrop-filter`
3. **性能优化**：低性能设备会自动降级毛玻璃效果
4. **响应式设计**：移动设备会自动调整窗口大小和布局

## 🐛 已知问题

- [ ] 在某些 Linux 发行版上，Electron 的 `backdrop-filter` 可能不生效
- [ ] 拖拽排序在触摸屏设备上可能不够流畅

## 📚 相关文档

- [Sortable.js 官方文档](https://github.com/SortableJS/Sortable)
- [macOS Big Sur 设计规范](https://developer.apple.com/design/human-interface-guidelines/macos/overview/themes/)
- [Electron 文档](https://www.electronjs.org/docs)

## 🎉 效果预览

启动应用后，你将看到：

1. **底部 Dock**：
   - 鼠标悬停时图标放大
   - 拖拽图标调整顺序
   - 点击打开对应窗口

2. **毛玻璃效果**：
   - 菜单栏半透明模糊
   - Dock 半透明模糊
   - 窗口半透明模糊

3. **窗口管理**：
   - 拖拽标题栏移动窗口
   - 拖拽边缘调整大小
   - 点击按钮最小化/最大化/关闭

## 💡 提示

- 双击窗口标题栏可以最大化/还原窗口
- 最小化的窗口会显示在 Dock 右侧区域
- 点击 Dock 图标可以激活或打开对应窗口
- 使用 `window.uiIntegration` 可以访问全局 UI 实例

---

**开发者：晨翼Agent UI 优化团队**  
**版本：1.0.0**  
**更新时间：2026-05-12**
