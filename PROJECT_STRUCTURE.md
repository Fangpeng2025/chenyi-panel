# 晨翼Agent v1.0 项目结构

```
chenyi-panel/
├── src/                    # Electron 客户端源码
│   ├── main/              # 主进程
│   │   ├── index.js       # 入口文件
│   │   ├── connection.js  # WebSocket连接管理
│   │   ├── executor.js    # 指令执行器
│   │   └── ipc.js         # IPC通信
│   ├── renderer/          # 渲染进程
│   │   ├── index.html     # 主界面
│   │   ├── renderer.js    # 渲染逻辑
│   │   └── styles.css     # 样式
│   └── shared/            # 共享代码
│       ├── protocol.js    # 协议定义
│       └── constants.js   # 常量定义
│
├── cloud/                  # 云端服务源码
│   ├── api/               # HTTP API
│   ├── ws/                # WebSocket服务
│   ├── models/            # 数据模型
│   ├── routes/            # 路由定义
│   └── services/          # 业务逻辑
│
├── docs/                   # 开发文档
│   ├── architecture.md
│   ├── client-development.md
│   ├── cloud-service.md
│   └── ui-design.md
│
├── assets/                 # 资源文件
├── dist/                   # 构建输出
└── package.json
```

## 开发顺序

1. **第一阶段：云端服务**
   - 用户认证系统
   - 设备管理
   - WebSocket网关
   - 消息路由

2. **第二阶段：Electron客户端**
   - 登录界面
   - 设备管理
   - AI对话
   - 投屏控制

3. **第三阶段：Android客户端**
   - 集成到鹏程万里APP
   - 连接云端
   - 执行指令

## 技术栈

- **云端**: Node.js 20 + Fastify + PostgreSQL + Redis + BullMQ
- **客户端**: Electron 28 + WebSocket
- **协议**: WebSocket (控制) + HTTP (数据) + WebRTC (投屏)
