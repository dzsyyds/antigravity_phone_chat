# 版本发布记录 (Release Notes)

## v0.4.0 - Antigravity 2.0 全面适配与全中文移动端重构 (2026-11-25)

本版本基于 GPL-3.0 开源项目深度二次开发，针对 **Antigravity 2.0** 桌面客户端与 **手机浏览器（尤其是安卓 WebView / Edge / Chrome）** 进行了全面汉化与稳定性重构。

### ✨ 核心新增功能
* **全中文移动端与登录页 (`index.html` / `login.html` / `app.js`)**：状态栏、模式切换、模型切换、历史会话、代码预览、提醒开关与登录页全面中文本地化，移除阻断国内访问的 Google Fonts 外链。
* **顶部栏「一眼可见」模型剩余额度 (`#quotaBtn` + `/quota`)**：手机端顶部设置条第一位直接显示 `5h XX% · 周 YY%` 剩余额度胶囊并按剩余比例变色（绿/橙/红），点击可查看完整模型分组详情并支持一键即时刷新。
* **多工作区窗口远程切换 (`/targets` & `/switch-target`)**：无需回到电脑前，手机端点击窗口胶囊即可切换当前连接的 Antigravity 2.0 桌面工作区窗口。
* **手机选图压缩直传 (`/upload-image`)**：支持手机端相册选图与即时预览，前端 Canvas 自动压缩后通过 CDP `DOM.setFileInputFiles` 注入桌面输入框；生成期间提前拦截，避免残留孤立附件。
* **Git 改动审阅 (`/git-status` & `/git-diff`)**：手机端直接查看当前工作区分支、未提交文件列表与红绿高亮的代码 Diff。
* **完成与审批提醒**：支持声音提示、震动反馈与浏览器通知，长任务完成或触发权限确认时第一时间提醒。

### 🛠️ Antigravity 2.0 兼容与稳定性修复
* **Antigravity 2.0 镜像与消息注入适配**：适配新版界面容器与 Lexical 富文本输入框，正确同步会话快照与 CSS 变量。
* **安卓软键盘与滚动死锁修复**：采用 `interactive-widget=resizes-content` + `visualViewport` 实时定位，弹出输入法时自动进入紧凑顶部模式并支持点击对话区自动收起键盘；修复自动滚底与手动回看的历史滚动冲突。
* **移动端防崩溃与低内存优化**：将整树重绘改为 `patchChatHtml` 增量 DOM 补丁；清理 10 余处耗费 GPU 显存的 `backdrop-filter` 模糊层；基于 `htmlHash` 仅在变化时下发内容，大幅降低移动浏览器闪退率。
* **安全与工程规范**：移除默认口令界面明文提示与硬编码个人工作区路径，使用 `execFile` 防止路径遍历与命令注入，新增 `npm run check` 语法检查与 GitHub Actions CI。

---

> 更早历史版本（`v0.3.0` 及之前）源自上游开源项目 [krishnakanthb13/antigravity_phone_chat](https://github.com/krishnakanthb13/antigravity_phone_chat)，保留 GPL-3.0 协议与完整历史提交记录。
