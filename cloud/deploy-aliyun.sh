#!/bin/bash
# 晨翼Agent - 云端同步服务部署脚本

set -e

SERVER="8.147.232.175"
USER="root"
PEM="$HOME/服务器/阿里云pem"
REMOTE_DIR="/home/fangpeng/chenyi-cloud"

echo "=== 晨翼Agent 云端同步服务部署 ==="
echo "服务器: $SERVER"
echo "远程目录: $REMOTE_DIR"

# 1. 创建远程目录
echo "[1/5] 创建远程目录..."
ssh -i $PEM $USER@$SERVER "mkdir -p $REMOTE_DIR"

# 2. 上传文件
echo "[2/5] 上传文件..."
scp -i $PEM ~/projects/chenyi-panel/cloud/server.js $USER@$SERVER:$REMOTE_DIR/
scp -i $PEM ~/projects/chenyi-panel/cloud/index.js $USER@$SERVER:$REMOTE_DIR/
scp -i $PEM ~/projects/chenyi-panel/cloud/sync-server.js $USER@$SERVER:$REMOTE_DIR/
scp -i $PEM ~/projects/chenyi-panel/cloud/auth.js $USER@$SERVER:$REMOTE_DIR/
scp -i $PEM ~/projects/chenyi-panel/cloud/device.js $USER@$SERVER:$REMOTE_DIR/
scp -i $PEM ~/projects/chenyi-panel/cloud/sync.js $USER@$SERVER:$REMOTE_DIR/
scp -i $PEM ~/projects/chenyi-panel/cloud/ws-router.js $USER@$SERVER:$REMOTE_DIR/
scp -i $PEM ~/projects/chenyi-panel/cloud/package.json $USER@$SERVER:$REMOTE_DIR/

# 3. 安装依赖
echo "[3/5] 安装依赖..."
ssh -i $PEM $USER@$SERVER "cd $REMOTE_DIR && npm install --production"

# 4. 创建systemd服务
echo "[4/5] 创建systemd服务..."
ssh -i $PEM $USER@$SERVER "sudo tee /etc/systemd/system/chenyi-cloud.service" << 'EOF'
[Unit]
Description=晨翼Agent云端同步服务
After=network.target

[Service]
Type=simple
User=fangpeng
WorkingDirectory=/home/fangpeng/chenyi-cloud
ExecStart=/usr/bin/node index.js
Restart=always
RestartSec=10
Environment=PORT=3001
Environment=JWT_SECRET=chenyi-secret-key-2024

[Install]
WantedBy=multi-user.target
EOF

# 5. 启动服务
echo "[5/5] 启动服务..."
ssh -i $PEM $USER@$SERVER "sudo systemctl daemon-reload && sudo systemctl enable chenyi-cloud && sudo systemctl restart chenyi-cloud"

echo "=== 部署完成 ==="
echo "服务地址: http://$SERVER:3001"
echo "健康检查: http://$SERVER:3001/health"
