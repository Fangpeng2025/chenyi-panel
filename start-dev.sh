#!/bin/bash

# 晨翼Agent - 开发环境启动脚本

echo "=========================================="
echo "  晨翼Agent 开发环境启动"
echo "=========================================="

# 颜色定义
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 1. 启动云端服务
echo -e "${YELLOW}[1/3] 启动云端服务...${NC}"
cd ~/projects/chenyi-panel/cloud
node server-v3.js &
CLOUD_PID=$!
echo "云端服务 PID: $CLOUD_PID"
sleep 2

# 2. 启动 Electron 客户端
echo -e "${YELLOW}[2/3] 启动 Electron 客户端...${NC}"
cd ~/projects/chenyi-panel
npm run dev &
ELECTRON_PID=$!
echo "Electron PID: $ELECTRON_PID"

# 3. 显示状态
echo -e "${GREEN}[3/3] 开发环境已启动${NC}"
echo ""
echo "云端服务: http://localhost:3001"
echo "健康检查: http://localhost:3001/health"
echo ""
echo "按 Ctrl+C 停止所有服务"

# 等待进程
wait
