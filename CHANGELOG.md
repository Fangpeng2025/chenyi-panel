# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial project setup with Electron framework
- AI chat panel with streaming response support
- Phone screen mirroring with H264 video stream
- Remote control features (tap, swipe, input)
- Multi-device management support

## [1.0.0] - 2026-04-29

### Added
- **AI Chat Panel**
  - Streaming response with real-time display
  - Multi-session management with history persistence
  - Markdown rendering with code highlighting
  - Token usage statistics and context management

- **Phone Screen Mirroring**
  - Real-time H264 video stream (30/60 FPS support)
  - Touch operations: tap, swipe, long-press, gestures
  - Key simulation: Back, Home, Recent, Volume control
  - Text input with Chinese and special characters support
  - Screenshot capture and save to local

- **System Integration**
  - Hermes CLI integration
  - System service monitoring
  - Keyboard shortcuts support
  - Dark/Light theme switching

- **Documentation**
  - Complete README with quick start guide
  - Architecture design document
  - Client development guide
  - Cloud service documentation
  - UI design specification

- **Project Infrastructure**
  - MIT License
  - GitHub repository setup
  - Basic project structure

### Technical Details
- Framework: Electron 28
- Frontend: HTML5 + Tailwind CSS
- Communication: WebSocket (ws)
- Video: H264 decoding + Canvas rendering
- AI Integration: Hermes CLI / API

---

## Version History

| Version | Date | Description |
|---------|------|-------------|
| 1.0.0 | 2026-04-29 | Initial release |

---

[Unreleased]: https://github.com/Fangpeng2025/chenyi-panel/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/Fangpeng2025/chenyi-panel/releases/tag/v1.0.0
