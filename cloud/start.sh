#!/bin/bash
# 晨翼Agent - 启动脚本
# 同时启动Rust内核和云端服务

set -e

# 配置
KERNEL_DIR="/home/fangpeng/projects/chenyi-kernel"
CLOUD_DIR="/home/fangpeng/projects/chenyi-panel/cloud"
KERNEL_PORT=8080
CLOUD_PORT=3002

echo "=== 晨翼Agent 启动 ==="

# 1. 启动Rust内核
echo "[1] 启动Rust内核..."
cd "$KERNEL_DIR"

# 检查是否已编译
if [ ! -f "target/release/chenyi-kernel" ]; then
    echo "    编译内核..."
    cargo build --release
fi

# 启动内核（后台）
echo "    启动内核服务 (端口 $KERNEL_PORT)..."
./target/release/chenyi-kernel &
KERNEL_PID=$!
echo "    内核PID: $KERNEL_PID"

# 等待内核启动
sleep 2

# 检查内核是否运行
if curl -s http://localhost:$KERNEL_PORT/health > /dev/null; then
    echo "    内核启动成功 ✓"
else
    echo "    内核启动失败 ✗"
    kill $KERNEL_PID 2>/dev/null
    exit 1
fi

# 2. 启动云端服务
echo "[2] 启动云端服务..."
cd "$CLOUD_DIR"

# 设置环境变量
export KERNEL_ENABLED=true
export KERNEL_URL="http://127.0.0.1:$KERNEL_PORT"
export PORT=$CLOUD_PORT

# 启动云端服务
echo "    启动云端服务 (端口 $CLOUD_PORT)..."
node server-v3.js &
CLOUD_PID=$!
echo "    云端PID: $CLOUD_PID"

# 等待云端启动
sleep 2

# 检查云端是否运行
if curl -s http://localhost:$CLOUD_PORT/health > /dev/null; then
    echo "    云端启动成功 ✓"
else
    echo "    云端启动失败 ✗"
    kill $KERNEL_PID 2>/dev/null
    kill $CLOUD_PID 2>/dev/null
    exit 1
fi

# 保存PID
echo "$KERNEL_PID" > /tmp/chenyi-kernel.pid
echo "$CLOUD_PID" > /tmp/chenyi-cloud.pid

echo ""
echo "=== 启动完成 ==="
echo "内核API: http://localhost:$KERNEL_PORT"
echo "云端API: http://localhost:$CLOUD_PORT"
echo ""
echo "停止服务: ./stop.sh"