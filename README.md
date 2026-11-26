<div align="center">

<img src="assets/antigravity.png" alt="Antigravity 掌上控制台 Logo" width="84" />

# Antigravity 掌上控制台 📱

**面向 Antigravity 2.0 的全中文手机端实时监控与远程控制 WebUI**

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![Release](https://img.shields.io/badge/版本-v0.4.0-emerald.svg)](RELEASE_NOTES.md)
[![Antigravity 2.0](https://img.shields.io/badge/适配-Antigravity%202.0-indigo.svg)](#核心特性)
[![CI Check](https://github.com/dzsyyds/antigravity_phone_chat/actions/workflows/ci.yml/badge.svg)](https://github.com/dzsyyds/antigravity_phone_chat/actions/workflows/ci.yml)

[核心特性](#核心特性) · [快速开始](#快速开始) · [公网远程访问](#公网远程访问) · [版本记录](RELEASE_NOTES.md) · [开源协议与致谢](#开源协议与致谢)

</div>

---

> [!NOTE]
> **关于本项目（GPL-3.0 合规二次开发声明）**
> 本仓库为开源项目 [`krishnakanthb13/antigravity_phone_chat`](https://github.com/krishnakanthb13/antigravity_phone_chat)（其前身为 [`gherghett/Antigravity-Shit-Chat`](https://github.com/gherghett/Antigravity-Shit-Chat)）的公开 Fork 分支，严格遵循 **GNU GPL v3.0** 协议保留完整版权声明与提交历史。
> 针对 **Antigravity 2.0 桌面端架构变更** 以及 **国内手机浏览器的实际使用痛点**，本分支已完成全中文界面重构与大量底层稳定性增强。

---

## 核心特性

### 1. 全中文移动端与 Antigravity 2.0 深度适配
- **全界面中文化**：手机主控台（[`public/index.html`](public/index.html)）、登录鉴权页（[`public/login.html`](public/login.html)）、交互提示与服务端报错全面汉化。
- **去除海外外链阻断**：移除会拖慢国内移动网络的 Google Fonts 外部字体请求，手机端秒开响应。
- **Antigravity 2.0 镜像与注入兼容**：适配新版桌面端 DOM 结构、`:root` CSS 变量同步以及 Lexical 富文本输入框，远程发消息、停生成、审批操作（Allow / Reject 等）精准直达。

### 2. 顶部栏「一眼可见」模型剩余额度
- **无需点开二级菜单**：顶部设置栏首位直接常驻显示当前剩余额度胶囊（例如 `5h 82% · 周 94%`），并按剩余百分比自动变色（正常绿 / 预警橙 / 低额红）。
- **分组详情与即时刷新**：后端 `/quota` 接口带 `120s` 缓存与启动预热；点击胶囊可展开完整模型分组额度及重置倒计时，并支持一键 `🔄 立即刷新`。

### 3. 手机传图、多窗口切换与代码 Diff 审阅
- **多工作区窗口切换（`/targets` & `/switch-target`）**：电脑同时打开多个 Antigravity 桌面窗口时，手机端点击窗口胶囊即可一键切换监听目标。
- **手机端压缩传图（`/upload-image`）**：相册选图后在前端 Canvas 自动压缩，再经由 CDP `DOM.setFileInputFiles` 直接注入桌面端输入框；若桌面端仍在生成会提前拦截，避免残留空附件。
- **Git 改动审阅（`/git-status` & `/git-diff`）**：手机端直接查看当前工作区所在分支、未提交文件数量及红绿高亮的逐行 Diff；支持 `execFile` 参数隔离与路径遍历校验。
- **完成与审批提醒**：支持开启声音提示、手机震动与浏览器通知，长任务结束或出现需要人工确认的操作时即时提醒。

### 4. 安卓软键盘与防崩溃深度优化
- **键盘弹出不遮挡、不抖动**：启用 `interactive-widget=resizes-content`，结合 `visualViewport` 动态锁定视口与紧凑模式，点击对话区域自动收起输入法，彻底解决安卓浏览器顶飞输入框问题。
- **增量 DOM 补丁与低内存运行**：用 `patchChatHtml` 增量更新替代整树重绘；清理十余处高显存消耗的 `backdrop-filter` 模糊层；服务端基于 `htmlHash` 仅在变化时下发更新（轮询间隔 `1500ms`），显著降低手机 WebView 闪退率。
- **独立回看历史消息**：区分脚本自动滚底与手动上滑回看，不再出现强行抢滚动条的情况。

---

## 快速开始

### 前置条件
- **Node.js**（建议 v18 及以上）
- **Antigravity 桌面端** 需带调试端口启动（默认监听 `9000`–`9003` 端口）：

```powershell
# Windows 启动示例（根据实际安装路径调整）
antigravity --remote-debugging-port=9000
```

### 安装与运行

1. **克隆仓库并安装依赖**
   ```bash
   git clone https://github.com/dzsyyds/antigravity_phone_chat.git
   cd antigravity_phone_chat
   npm install
   ```

2. **配置环境变量与访问口令**
   ```bash
   cp .env.example .env
   ```
   编辑 `.env` 文件，务必将 `APP_PASSWORD` 修改为你自己的强口令（默认端口为 `3000`，可通过 `PORT` 修改）：
   ```env
   APP_PASSWORD=请改为你自己的密码
   PORT=3000
   ```

3. **运行语法校验并启动服务**
   ```bash
   npm run check
   npm start
   ```
   也可直接使用根目录启动脚本 [`start_ag_phone_connect_web.bat`](start_ag_phone_connect_web.bat)（Windows）或 [`start_ag_phone_connect_web.sh`](start_ag_phone_connect_web.sh)（macOS / Linux）。

4. **手机访问**
   - **同一局域网 Wi-Fi**：手机浏览器打开终端输出的局域网地址 `http://<电脑局域网IP>:3000`（如已配置本地证书则为 `https://`）。
   - **外出 4G/5G 访问**：请参考下方 [公网远程访问](#公网远程访问) 配置内网穿透。

---

## 公网远程访问

### 推荐方案：Cpolar（国内移动网络直连稳定）

在电脑端启动本地 WebUI（默认监听 `3000` 端口）后，使用 `cpolar` 映射公网 HTTPS 地址：

```powershell
# 建议先在当前终端清理代理环境变量，确保穿透直连稳定
$env:HTTP_PROXY=""; $env:HTTPS_PROXY=""; $env:ALL_PROXY=""; $env:NO_PROXY="*"
.\cpolar.exe http 3000 -region cn_top -log stdout
```

> [!TIP]
> **Clash Verge / 系统代理并存避坑指南**
> 如果电脑同时开启了 **Clash Verge（TUN 模式 + 规则模式）**，建议在独立命令行中清空 `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` 并设置 `NO_PROXY="*"` 后再启动 `server.js` 与 `cpolar.exe`，可避免隧道握手被本地代理端口劫持，手机端与桌面端可同时保持流畅。

### 其他穿透方案
如需使用 **ngrok** 或 **Cloudflare Tunnel (`cloudflared`)**，可在 `.env` 中配置相应参数，或直接将公网隧道指向 `http://localhost:3000`。对外开放时**务必设置强口令 `APP_PASSWORD`**。

---

## 项目文件概览

| 路径 | 说明 |
| :--- | :--- |
| [`server.js`](server.js) | 核心后端：CDP 连接、Antigravity 2.0 镜像提取、`/quota`、`/targets`、`/upload-image`、`/git-diff` 与鉴权服务 |
| [`public/index.html`](public/index.html) | 全中文手机主界面布局 |
| [`public/login.html`](public/login.html) | 全中文登录鉴权页面 |
| [`public/js/app.js`](public/js/app.js) | 增量 DOM 补丁、安卓软键盘适配、额度胶囊、传图压缩与提醒逻辑 |
| [`public/css/style.css`](public/css/style.css) | 移动端暗色主题与低 GPU 消耗样式 |
| [`.env.example`](.env.example) | 中文配置模板（含端口、口令与穿透说明） |
| [`RELEASE_NOTES.md`](RELEASE_NOTES.md) | 中文版本更新记录 |
| [`.github/workflows/ci.yml`](.github/workflows/ci.yml) | GitHub Actions 自动检查工作流（`npm run check`） |

> 原项目附带的英文架构与设计参考文档保留于 [`CODE_DOCUMENTATION.md`](CODE_DOCUMENTATION.md)、[`DESIGN_PHILOSOPHY.md`](DESIGN_PHILOSOPHY.md)、[`SECURITY.md`](SECURITY.md) 与 [`CONTRIBUTING.md`](CONTRIBUTING.md)。

---

## 开源协议与致谢

- 本项目基于 **GNU General Public License v3.0 (GPL-3.0)** 开源发布，详见 [`LICENSE`](LICENSE) 与 [`package.json`](package.json)。
- 感谢上游开源作者 **Krishna Kanth B ([`krishnakanthb13/antigravity_phone_chat`](https://github.com/krishnakanthb13/antigravity_phone_chat))** 与最早提出雏形的 **[`gherghett/Antigravity-Shit-Chat`](https://github.com/gherghett/Antigravity-Shit-Chat)**。
- 欢迎通过 Issue 与 Pull Request 共同完善 Antigravity 2.0 移动端中文生态。
