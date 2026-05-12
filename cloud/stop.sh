#!/bin/bash
# 晨翼Agent - 停止脚本

echo "=== 晨翼Agent 停止 ==="

# 停止内核
if [ -f /tmp/chenyi-kernel.pid ]; then
    KERNEL_PID=$(cat /tmp/chenyi-kernel.pid)
    if kill -0 $KERNEL_PID 2>/dev/null; then
        echo "停止内核 (PID: $KERNEL_PID)..."
        kill $KERNEL_PID
    fi
    rm /tmp/chenyi-kernel.pid
fi

# 停止云端
if [ -f /tmp/chenyi-cloud.pid ]; then
    CLOUD_PID=$(cat /tmp/chenyi-cloud.pid)
    if kill -0 $CLOUD_PID 2>/dev/null; then
        echo "停止云端 (PID: $CLOUD_PID)..."
        kill $CLOUD_PID
    fi
    rm /tmp/chenyi-cloud.pid
fi

# 清理残留进程
pkill -f "chenyi-kernel" 2>/dev/null || true
pkill -f "server-v3.js" 2>/dev/null || true

echo "已停止所有服务"