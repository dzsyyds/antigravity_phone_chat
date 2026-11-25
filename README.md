<div align="center">
  <img src="./assets/antigravity.png" alt="Antigravity Phone Connect" width="300">
  <h1>Antigravity Phone Connect 📱</h1>
</div>

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

**Antigravity Phone Connect** is a high-performance, real-time mobile monitor and remote control for your Antigravity AI sessions. It allows you to step away from your desk while keeping full sight and control over your AI's thinking process and generations.

- **🚀 Lightning Fast Snapshots**: Sub-100ms mirroring of the Antigravity chat via Chrome DevTools Protocol (CDP).
- **🛡️ Security First**: Built-in security audits, XSS protection via a strict Content Security Policy (No-Inline-JS), and encrypted session handling via signed `httpOnly` cookies.
- **📱 Mobile-First History**: Access and switch conversation history from a sleek, full-screen mobile drawer with native-feel cards and micro-animations.
- **🏠 One-Tap Connect**: Automatically trusts your local home Wi-Fi (LAN) for instant access, while maintaining a Zero-Trust policy with password protection for all external traffic.

![Antigravity Phone Connect](./assets/release_generic-1.png)

![Antigravity Phone Connect](./assets/global_access_hero_2.png)

**Note:** This enhanced edition builds upon [krishnakanthb13/antigravity_phone_chat](https://github.com/krishnakanthb13/antigravity_phone_chat) (originally forked from [gherghett/Antigravity-Shit-Chat](https://github.com/gherghett/Antigravity-Shit-Chat)) under **GNU GPL v3**, adding full **Antigravity 2.0** support, Android mobile stability & keyboard ergonomics, multi-window switching, mobile image upload, workspace Git Diff viewer, and completion alerts.

---

## ✨ 增强版核心升级 (Enhanced Features)

- **⚡ Antigravity 2.0 全面适配**:
  - 支持 `[data-testid="autoscroll-viewport"]`、`size-container` / `mask-image` 中和、`:root` CSS 变量动态提取；
  - 兼容 Lexical 编辑器 `[data-testid="send-button"]` 发送与原生 CDP 输入兜底、动态多端口会话跳转。
- **📱 深度安卓移动端体验与防闪退优化**:
  - **增量 DOM Patch + `htmlHash` 差异缓存**: 未变化的对话节点与图片保持复用，不再整页重建；未变更时 `/snapshot` 仅返回约百字节；
  - **无模糊合成层开销**: 移除常驻工具栏 `backdrop-filter`，避免低/中端安卓设备 GPU OOM 闪退；
  - **防黑屏键盘贴底 (`interactive-widget=resizes-content` + `visualViewport` 双重锁定)**: 输入法弹出不顶飞页面，支持 `⏎ 回车:发送/换行` 切换、中文 IME 联想防误发、`／` `/` `＠` `@` 快捷插入、轻点聊天空白处收起键盘。
- **📊 模型剩余额度实时查看 (`GET /quota`)**:
  - 手机端一键读取 Antigravity 的 `View Usage` 用量数据（如 Gemini / Claude & GPT 的 5 小时与每周剩余百分比及重置倒计时），带可视化进度条与手动刷新。
- **🪟 多窗口切换 (`GET /targets` · `POST /switch-target`)**:
  - 在手机端一键枚举并切换电脑上打开的多个 Antigravity 项目窗口。
- **📷 手机端拍照 / 截图直接发送 (`POST /upload-image`)**:
  - 手机选图后前端 Canvas 自动压缩并预览，通过 CDP `DOM.setFileInputFiles` 直接注入桌面端输入框发送（可附带文字说明）。
- **📂 工作区 Git 改动与红绿 Diff 查看器 (`GET /git-status` · `GET /git-diff`)**:
  - 顶部状态栏实时显示改动文件数，手机端即可查看分支状态与逐行红绿 `+ / -` Diff。
- **🔔 任务完成与待审批提醒**:
  - 支持开启提醒开关：当 AI 从“执行中”变为完成，或桌面端弹出“运行/允许/确认”待审批操作时，自动触发震动、提示音与通知栏提醒。

---

## 🌐 国内网络 Cpolar + Clash TUN 避坑指南 (China Remote Access)

如果电脑同时开启 **Clash Verge TUN 模式** 与 **cpolar**（如 `cpolar http 3000 -region cn_top`）：
1. Clash 代理模式建议保持在 **`规则 (Rule)`**（而非全局 `Global`），并确保代理组选择了延迟正常的可用节点；
2. 将 `cpolar.exe`、`.cpolar.cn/.com/.top`、服务端 IP 与 `4443` 端口加入 `DIRECT` 直连规则；
3. 启动 `cpolar` 前清空终端代理环境变量并设置 `NO_PROXY=*`：
   ```bat
   set HTTP_PROXY=
   set HTTPS_PROXY=
   set ALL_PROXY=
   set NO_PROXY=*
   cpolar.exe http 3000 -region cn_top
   ```

---

## 🚀 Quick Start

> 💡 **Tip:** While we recommend starting Antigravity first, the server is now smart enough to wait and automatically connect whenever Antigravity becomes available!

### Step 1: Launch Antigravity in Debug Mode

Start Antigravity with the remote debugging port enabled:

**Option A: Using Right-Click Context Menu (Recommended)**
- Run `install_context_menu.bat` (Windows) or `./install_context_menu.sh` (Linux) and select **[1] Install**
- Then right-click any project folder → **"Open with Antigravity (Debug)"** (now with visual icons!)

**Option B: Manual Command**
```bash
antigravity . --remote-debugging-port=9000
```

### Step 2: Open or Start a Chat

- In Antigravity, open an **existing chat** from the bottom-right panel, **OR**
- Start a **new chat** by typing a message

> 💡 The server needs an active chat session to capture snapshots. Without this, you'll see "chat container not found" errors.

### Step 3: Run the Server

**Windows:**
```
Double-click start_ag_phone_connect.bat
```

**macOS / Linux:**
```bash
chmod +x start_ag_phone_connect.sh   # First time only
./start_ag_phone_connect.sh
```

The script will:
- **Auto-setup a Python Virtual Environment (`venv`)** (Fixes PEP 668 issues on Arch/Linux)
- Verify Node.js and Python dependencies
- Auto-kill any existing server on port 3000
- **Wait for Antigravity** if it's not started yet
- Display a **QR Code** and your **Link** (e.g., `https://192.168.1.5:3000`)
- Provide numbered steps for easy connection

### Step 4: Connect Your Phone (Local Wi-Fi)

1. Ensure your phone is on the **same Wi-Fi network** as your PC
2. Open your mobile browser and enter the **URL shown in the terminal**
3. If using HTTPS: Accept the self-signed certificate warning on first visit

---

## 🌍 NEW: Global Remote Access (Web Mode)

Access your Antigravity session from **anywhere in the world** (Mobile Data, outside Wi-Fi) with secure passcode protection.

### Step 1: Choose a Tunnel Provider

You can use **ngrok** (requires account), **Cloudflare Tunnel** (requires `cloudflared`), or **Pinggy** (free SSH tunnel, no account/install needed).

#### Option A: ngrok (Default)
1. **Get an ngrok Token**: Sign up for free at [ngrok.com](https://ngrok.com) and get your "Authtoken".
2. **Setup**: Update your `.env` file:
   ```env
   TUNNEL_PROVIDER=ngrok
   NGROK_AUTHTOKEN=your_token_here
   ```

#### Option B: Cloudflare Tunnel
1. **Install cloudflared**: Follow the [official guide](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started-guide/local/instance/install-run/) to install `cloudflared` on your system.
2. **Setup**: Update your `.env` file:
   ```env
   TUNNEL_PROVIDER=cloudflare
   ```

#### Option C: Pinggy Tunnel
1. **No Install Required**: Pinggy works via SSH and the Python SDK. The launcher will automatically install the `pinggy` pip package.
2. **Setup**: Update your `.env` file:
   ```env
   TUNNEL_PROVIDER=pinggy
   ```
   *(Optional)* You can add `PINGGY_TOKEN=your-token` for a persistent subdomain if you have a Pinggy account.

### Step 2: Configuration
1. **Automatic Configuration**: Simply run any launcher script. They will detect if `.env` is missing and automatically create it using `.env.example` as a template.
2. **Manual Setup**: Alternatively, copy `.env.example` to `.env` manually and update the values:
   ```bash
   copy .env.example .env   # Windows
   cp .env.example .env     # Mac/Linux
   ```
   Ensure you set a secure password:
   ```env
   APP_PASSWORD=your_secure_passcode
   ```

### Usage
- **Windows**: Run `start_ag_phone_connect_web.bat`
- **Mac/Linux**: Run `./start_ag_phone_connect_web.sh`

The script will launch the server and provide a **Public URL** (e.g., `https://abcd-123.ngrok-free.app`). 

**Two Ways to Connect:**
1. **Magic Link (Easiest)**: Scan the **Magic QR Code** displayed in the terminal. It logs you in automatically!
2. **Manual**: 
   - Open the URL on your phone.
   - Enter your `APP_PASSWORD` to log in.

> 💡 **Tip:** Devices on the same local Wi-Fi still enjoy direct access without needing a password.

---

## 🔒 Enabling HTTPS (Recommended)

For a secure connection without the browser warning icon:

### Option 1: Command Line
```bash
node generate_ssl.js
```
- Uses **OpenSSL** if available (includes your IP in certificate)
- Falls back to **Node.js crypto** if OpenSSL not found
- Creates certificates in `./certs/` directory

### Option 2: Web UI
1. Start the server on HTTP
2. Look for the yellow **"⚠️ Not Secure"** banner
3. Click **"Enable HTTPS"** button
4. Restart the server when prompted

### After Generating:
1. **Restart the server** - it will automatically detect and use HTTPS.
2. **On your phone's first visit**:
   - You'll see a security warning (normal for self-signed certs).
   - Tap **"Advanced"** → **"Proceed to site"**.
   - The warning won't appear again!

---

### macOS: Adding Right-Click "Quick Action" (Optional)

Since macOS requires Automator for context menu entries, follow these steps manually:

1.  Open **Automator** (Spotlight → type "Automator").
2.  Click **File → New** and select **Quick Action**.
3.  At the top, set:
    - "Workflow receives current" → **folders**
    - "in" → **Finder**
4.  In the left sidebar, search for **"Run Shell Script"** and drag it to the right pane.
5.  Set "Shell" to `/bin/zsh` and "Pass input" to **as arguments**.
6.  Paste this script:
    ```bash
    cd "$1"
    antigravity . --remote-debugging-port=9000
    ```
7.  **Save** the Quick Action with a name like `Open with Antigravity (Debug)`.
8.  Now you can right-click any folder in Finder → **Quick Actions → Open with Antigravity (Debug)**.

---

## 🏗️ Architecture Infographic

![Repo Infographic](./assets/repo_infographic.png)

---

## 🛡️ Shielding & Account Safety

This tool is designed with a **"Local-First"** security model. 

- **Bridge Mechanism**: It uses the **Chrome DevTools Protocol (CDP)** to mirror the UI of your *already-running* desktop session. It **never** extracts OAuth tokens or interacts with Google/AI-provider APIs directly.
- **Natural Traffic**: All AI requests are still sent by your official desktop application. To the AI provider, your usage looks identical to normal desktop activity.
- **Zero Bans**: There have been **no reports** of account flags or bans. This is a "Wireless Viewport," not a third-party client that bypasses official security.

---

## ✨ Features

- **🧹 Clean Mobile View (NEW!)**: Automatically filters out redundant Desktop-specific input areas using an aggressive "Nuclear Cleanup" strategy. It targets the main desktop chat box and fixed overlays while carefully **preserving** actionable items like "Review Changes" and permission bars.
- **Glassmorphism UI (NEW!)**: Sleek and modern quick-action and settings menus featuring a beautiful glassmorphism effect for enhanced mobile usability. Includes customizable, ready-to-use prompt pills (like "Explain this code", "Continue", and "Fix Bugs").
- **🌙 Improved Dark Mode (NEW!)**: Enhanced UI styling and state capture designed to provide maximum clarity and correct model detection in dark mode.
- **🧠 Latest AI Models**: Automatically updated support for the latest model versions from Gemini, Claude, and OpenAI.
- **💖 Support the Developer (NEW!)**: A dedicated heart icon in the mobile header allows users to support the project and the developer with a single tap, opening a premium support modal.
- **📜 Premium Chat History (NEW!)**: Full-screen history management with a completely redesigned, sleek card-based UI. Features modern loading states, gorgeous gradients, and intelligent strictly-scoped scraping to safely extract past conversations without background noise. Dismissing the history view automatically triggers a remote Escape sequence on the desktop to keep your workspace clean.
- **➕ One-Tap New Chat (NEW!)**: Start a fresh conversation instantly from your phone without needing to touch your desktop.
- **🖼️ Context Menu Icons (NEW!)**: Visual icons in the right-click menu for better navigation.
- **🌍 Global Web Access**: Secure remote access via ngrok tunnel. Access your AI from mobile data with passcode protection.
- **🛡️ Auto-Cleanup**: Launchers now automatically sweep away "ghost" processes from previous sessions for a clean start every time.
- **🔒 HTTPS Support**: Secure connections with self-signed SSL certificates.
- **Local Image Support**: Local images and SVGs (`vscode-file://` paths) in the desktop chat are automatically converted to Base64 so they render perfectly on mobile without exposing local files.
- **Real-Time Mirroring**: 1-second polling interval for near-instant sync.
- **Remote Control**: Send messages, stop generations, and switch Modes (Fast/Planning) or Models (Gemini/Claude/GPT) directly from your phone.
- **Scroll Sync**: When you scroll on your phone, the desktop Antigravity scrolls too!
- **🎯 Precision Remote Control (NEW!)**: A deterministic targeting layer that prevents "Sync-Fighting". It uses leaf-node filtering to ensure clicks land exactly on buttons, even when nested inside complex DOM structures.
- **Occurrence Index Tracking**: Robustly handles multiple identical elements (like three "Run" buttons in history) by tracking the specific tapped instance.
- **Thought & Status Expansion (NEW!)**: Tap on "Thinking...", "Thought", "Worked for", "Edited", or "X files" blocks on your phone to remotely expand/collapse them with intelligent text matching.
- **Remote Action Support (NEW!)**: Direct support for "Allow", "Deny", "Allow Once", "Review Changes", "Apply", and "Save" buttons. No more walking back to your desk for simple permissions.
- **Smart Sync**: Bi-directional synchronization ensures your phone always shows the current Model and Mode selected on your desktop.
- **Premium Mobile UI**: A sleek, dark-themed interface optimized for touch interaction.
- **Context Menu Management**: Dedicated scripts to **Install, Remove, Restart, or Backup** your Right-Click integrations.
- **Health Monitoring**: Built-in `/health` endpoint for server status checks.
- **Graceful Shutdown**: Clean exit on Ctrl+C, closing all connections properly.
- **Python Virtual Environment (`venv`) Support**: Launcher scripts now automatically create and use a local `venv` (approx. 25-30MB). This ensures compatibility with modern Linux distributions (Arch, Debian 12+) that enforce PEP 668 (externally-managed-environment) and prevents package conflicts on Windows/macOS.
- **Zero-Config**: The launch scripts handle the heavy lifting of environment setup.

---

## 📂 Documentation

For more technical details, check out:
- [**Code Documentation**](CODE_DOCUMENTATION.md) - Architecture, Data Flow, and API.
- [**Security Guide**](SECURITY.md) - HTTPS setup, certificate warnings, and security model.
- [**Design Philosophy**](DESIGN_PHILOSOPHY.md) - Why it was built this way.
- [**Contributing**](CONTRIBUTING.md) - Guidelines for developers.

---

## License

Licensed under the [GNU GPL v3](LICENSE).  
Copyright (C) 2026 **Krishna Kanth B** (@krishnakanthb13)

---

## Star History

<a href="https://www.star-history.com/#krishnakanthb13/antigravity_phone_chat&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=krishnakanthb13/antigravity_phone_chat&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=krishnakanthb13/antigravity_phone_chat&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=krishnakanthb13/antigravity_phone_chat&type=date&legend=top-left" />
 </picture>
</a>

---
