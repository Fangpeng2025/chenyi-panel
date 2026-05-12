/**
 * 快速验证修复效果
 */

const fs = require('fs');

console.log('🔍 验证性能优化和窗口拖拽修复...\n');

// 读取文件
const renderer = fs.readFileSync('src/renderer/renderer.js', 'utf-8');
const wm = fs.readFileSync('src/renderer/components/WindowManager.js', 'utf-8');
const html = fs.readFileSync('src/renderer/index.html', 'utf-8');

// 检查项目
const checks = [
  // 性能优化
  { category: '性能优化', name: 'requestAnimationFrame 拖拽优化', file: renderer, check: 'dragState.rafId' },
  { category: '性能优化', name: 'requestAnimationFrame 调整大小优化', file: renderer, check: 'resizeState.rafId' },
  { category: '性能优化', name: 'requestAnimationFrame 流式更新优化', file: renderer, check: 'streamUpdateRaf' },
  { category: '性能优化', name: '防抖函数', file: renderer, check: 'const debounce = (fn, delay)' },
  { category: '性能优化', name: '节流函数', file: renderer, check: 'const throttle = (fn, limit)' },
  { category: '性能优化', name: 'DocumentFragment 消息渲染', file: renderer, check: 'document.createDocumentFragment()' },
  { category: '性能优化', name: 'passive 事件监听', file: renderer, check: '{ passive: true }' },
  { category: '性能优化', name: 'will-change CSS 优化', file: html, check: 'will-change:' },
  { category: '性能优化', name: '定时器清理函数', file: renderer, check: 'function cleanup()' },
  { category: '性能优化', name: 'beforeunload 清理', file: renderer, check: "window.addEventListener('beforeunload', cleanup)" },
  
  // 窗口拖拽修复
  { category: '窗口拖拽', name: 'WindowManager 自动初始化', file: wm, check: 'window.windowManager = getWindowManager()' },
  { category: '窗口拖拽', name: '拖拽 RAF 优化', file: wm, check: 'this.dragState.rafId' },
  { category: '窗口拖拽', name: '拖拽 preventDefault', file: wm, check: 'e.preventDefault()' },
  { category: '窗口拖拽', name: '拖拽样式优化', file: wm, check: 'transition: none !important' },
  
  // 内存泄漏修复
  { category: '内存泄漏', name: '时钟定时器清理', file: renderer, check: 'if (clockInterval) clearInterval(clockInterval)' },
  { category: '内存泄漏', name: '系统统计定时器清理', file: renderer, check: 'if (systemStatsInterval) clearInterval(systemStatsInterval)' },
];

let passed = 0;
let failed = 0;

checks.forEach(({ category, name, file, check }) => {
  const found = file.includes(check);
  const status = found ? '✅' : '❌';
  console.log(`${status} [${category}] ${name}`);
  if (found) passed++;
  else failed++;
});

console.log('\n' + '='.repeat(50));
console.log(`📊 测试结果: ${passed}/${checks.length} 通过`);
console.log(`${passed === checks.length ? '✅ 所有检查通过！' : '❌ 有 ' + failed + ' 项检查失败'}`);

process.exit(failed === 0 ? 0 : 1);
