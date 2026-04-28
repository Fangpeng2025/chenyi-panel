# 晨翼控制面板 (Chenyi Panel)

<div align="center">

![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20Windows%20%7C%20macOS-lightgrey.svg)
![Electron](https://img.shields.io/badge/Electron-28.0.0-9FEAF9.svg)

**晨翼Agent 控制面板 - 跨设备智能控制终端**

[功能特性](#功能特性) • [快速开始](#快速开始) • [使用指南](#使用指南) • [技术架构](#技术架构) • [开发文档](#开发文档)

</div>

---

## 简介

晨翼控制面板是一个基于 Electron 的桌面应用，作为晨翼Agent系统的电脑端控制终端。它提供了：

- 🖥️ **AI 对话** - 集成 Hermes AI 助手，支持流式对话
- 📱 **手机投屏** - 实时 H264 视频流，低延迟控制
- 🎮 **远程控制** - 点击、滑动、输入等操作
- 🔄 **多设备管理** - 跨设备协同工作

## 功能特性

### 🤖 AI 对话面板

- 流式响应，实时显示生成内容
- 多会话管理，历史记录持久化
- Markdown 渲染，代码高亮
- Token 使用统计，上下文管理

### 📱 手机投屏控制

- **实时投屏** - H264 视频流，支持 30/60 FPS
- **触控操作** - 点击、滑动、长按、手势
- **按键模拟** - 返回、Home、多任务、音量控制
- **文本输入** - 直接输入中文和特殊字符
- **截图保存** - 一键截图保存到本地

### 🎛️ 系统集成

- Hermes CLI 集成
- 系统服务监控
- 快捷键支持
- 深色/浅色主题

## 快速开始

### 环境要求

- Node.js >= 18.0.0
- npm >= 9.0.0
- 鹏程万里 APP（手机端）

### 安装

```bash
# 克隆仓库
git clone https://github.com/Fangpeng2025/chenyi-panel.git
cd chenyi-panel

# 安装依赖
npm install

# 启动应用
npm start
```

### 连接手机

1. 确保手机和电脑在同一局域网
2. 打开鹏程万里 APP，启动服务
3. 在控制面板输入手机地址（如 `192.168.0.102:8765`）
4. 点击「连接」按钮

## 使用指南

### 手机投屏

| 操作 | 方式 |
|------|------|
| 点击 | 鼠标左键单击 |
| 滑动 | 鼠标拖拽 |
| 长按 | 鼠标右键 |
| 返回 | `Esc` 键或点击返回按钮 |
| Home | 点击 Home 按钮 |
| 输入文本 | 使用输入框发送文字 |

### 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl + Enter` | 发送消息 |
| `Ctrl + N` | 新建会话 |
| `Ctrl + S` | 保存设置 |
| `Escape` | 停止生成 |

### 投屏设置

- **画质**：高清 / 标准 / 流畅
- **帧率**：15 / 30 / 60 FPS
- **分辨率**：自适应 / 原始

## 技术架构

```
┌─────────────────────────────────────────────────────────────┐
│                    晨翼控制面板 (Electron)                    │
├─────────────────────────────────────────────────────────────┤
│  渲染进程 (Renderer)          │  主进程 (Main)               │
│  ├─ UI 界面                   │  ├─ IPC 通信                 │
│  ├─ 投屏 Canvas               │  ├─ WebSocket 客户端         │
│  └─ 用户交互                  │  └─ 系统集成                 │
├─────────────────────────────────────────────────────────────┤
│                      通信协议层                               │
│  WebSocket (控制) │ HTTP (数据) │ H264 视频流                 │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│                   鹏程万里 APP (手机端)                       │
│  ├─ 屏幕采集 (MediaProjection)                               │
│  ├─ H264 编码 (MediaCodec)                                   │
│  └─ WebSocket 服务                                           │
└─────────────────────────────────────────────────────────────┘
```

### 技术栈

| 类别 | 技术 |
|------|------|
| 框架 | Electron 28 |
| 前端 | HTML5 + Tailwind CSS |
| 通信 | WebSocket (ws) |
| 视频 | H264 解码 + Canvas 渲染 |
| AI | Hermes CLI / API |

## 开发文档

详细文档请参阅 [`docs/`](./docs/) 目录：

- [架构设计](./docs/architecture.md) - 系统架构和协议设计
- [客户端开发](./docs/client-development.md) - 开发指南和 API
- [云服务](./docs/cloud-service.md) - 云端服务架构
- [UI 设计](./docs/ui-design.md) - 界面设计规范

### 项目结构

```
chenyi-panel/
├── main.js           # Electron 主进程
├── renderer.js       # 渲染进程逻辑
├── index.html        # 主界面
├── styles.css        # 样式文件
├── package.json      # 项目配置
├── docs/             # 文档目录
│   ├── architecture.md
│   ├── client-development.md
│   ├── cloud-service.md
│   └── ui-design.md
└── assets/           # 资源文件
```

## 贡献指南

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'feat: add amazing feature'`)
4. 推送分支 (`git push origin feature/amazing-feature`)
5. 创建 Pull Request

## 许可证

本项目采用 [MIT](./LICENSE) 许可证。

---

<div align="center">

**晨翼Agent** - 让设备更智能

Made with ❤️ by Fangpeng

</div>
