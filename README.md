# 晨翼控制面板 (Chenyi Panel)

晨翼Agent - 跨设备智能控制系统

## 项目结构

```
chenyi-panel/
├── src/                    # Electron 客户端
│   ├── main/              # 主进程
│   │   ├── index.js       # 入口
│   │   ├── connection.js  # WebSocket连接
│   │   └── executor.js    # 指令执行
│   ├── renderer/          # 渲染进程
│   │   ├── index.html     # 界面
│   │   └── renderer.js    # 逻辑
│   └── shared/            # 共享代码
│       ├── protocol.js    # 协议定义
│       └── constants.js   # 常量
│
├── cloud/                  # 云端服务
│   ├── server.js          # 服务入口
│   ├── init.sql           # 数据库初始化
│   └── package.json
│
└── docs/                   # 开发文档
    ├── architecture.md     # 架构设计
    ├── client-development.md
    ├── cloud-service.md
    └── ui-design.md
```

## 快速开始

### 云端服务

```bash
cd cloud

# 配置环境变量
export DATABASE_URL="postgresql://user:pass@localhost/chenyi"
export REDIS_URL="redis://localhost:6379"
export JWT_SECRET="your-secret-key"

# 初始化数据库
psql -d chenyi -f init.sql

# 启动服务
npm start
```

### Electron客户端

```bash
npm install
npm start
```

## 技术栈

| 组件 | 技术 |
|------|------|
| 云端 | Node.js + Fastify + PostgreSQL + Redis |
| 客户端 | Electron 28 |
| 通信 | WebSocket + HTTP |
| 认证 | JWT |

## 开发文档

详见 [docs/](./docs/) 目录

## License

MIT