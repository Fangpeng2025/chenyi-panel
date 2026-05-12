#!/bin/bash

# 晨翼Agent UI 优化测试脚本

echo "========================================"
echo "晨翼Agent UI 优化测试"
echo "========================================"
echo ""

# 检查项目路径
PROJECT_DIR="/home/fangpeng/projects/chenyi-panel"

if [ ! -d "$PROJECT_DIR" ]; then
    echo "❌ 项目目录不存在: $PROJECT_DIR"
    exit 1
fi

cd "$PROJECT_DIR"

echo "📁 项目目录: $PROJECT_DIR"
echo ""

# 1. 检查依赖
echo "1. 检查依赖..."
if [ -f "package.json" ]; then
    if grep -q "sortablejs" package.json; then
        echo "   ✅ sortablejs 已安装"
    else
        echo "   ❌ sortablejs 未安装"
        echo "   正在安装..."
        npm install sortablejs --save
    fi
else
    echo "   ❌ package.json 不存在"
    exit 1
fi
echo ""

# 2. 检查文件
echo "2. 检查文件完整性..."
FILES=(
    "src/renderer/components/Dock.js"
    "src/renderer/components/GlassEffect.js"
    "src/renderer/components/WindowManager.js"
    "src/renderer/UIIntegration.js"
    "src/renderer/index.html"
    "src/renderer/renderer.js"
)

for FILE in "${FILES[@]}"; do
    if [ -f "$FILE" ]; then
        echo "   ✅ $FILE"
    else
        echo "   ❌ $FILE 不存在"
    fi
done
echo ""

# 3. 运行组件测试
echo "3. 运行组件测试..."
if [ -f "test-ui-components.js" ]; then
    node test-ui-components.js
else
    echo "   ❌ test-ui-components.js 不存在"
fi
echo ""

# 4. 检查文档
echo "4. 检查文档..."
if [ -f "docs/UI_OPTIMIZATION.md" ]; then
    echo "   ✅ UI_OPTIMIZATION.md"
else
    echo "   ❌ UI_OPTIMIZATION.md 不存在"
fi

if [ -f "docs/UI_OPTIMIZATION_SUMMARY.md" ]; then
    echo "   ✅ UI_OPTIMIZATION_SUMMARY.md"
else
    echo "   ❌ UI_OPTIMIZATION_SUMMARY.md 不存在"
fi
echo ""

# 5. 提供启动选项
echo "========================================"
echo "测试完成！"
echo "========================================"
echo ""
echo "下一步操作："
echo ""
echo "  1. 启动应用（需要图形界面）："
echo "     cd $PROJECT_DIR && npm start"
echo ""
echo "  2. 查看演示页面（浏览器）："
echo "     file://$PROJECT_DIR/src/renderer/demo.html"
echo ""
echo "  3. 查看详细文档："
echo "     cat docs/UI_OPTIMIZATION.md"
echo ""
echo "  4. 查看总结文档："
echo "     cat docs/UI_OPTIMIZATION_SUMMARY.md"
echo ""

# 如果有 DISPLAY 环境变量，尝试启动应用
if [ ! -z "$DISPLAY" ]; then
    echo "检测到图形环境，是否启动应用？(y/n)"
    read -r answer
    if [ "$answer" = "y" ] || [ "$answer" = "Y" ]; then
        echo "启动应用..."
        npm start
    fi
fi

echo ""
echo "✨ UI 优化已完成！"