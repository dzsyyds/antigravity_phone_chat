# P0 + P1 移动端控制台升级立项计划 (`antigravity_phone_chat`)

- 创建时间：2026-11-28
- 范围：P0-1 ~ P0-4、P1-1 ~ P1-4（共 8 项）
- 技术约束：轻量 Node.js + 原生 HTML/CSS/JS、禁止海外 CDN / `backdrop-filter`、保留安卓 `visualViewport` 软键盘与增量 DOM 更新（`patchChatHtml`）、全量测试通过后方可提交推送。

---

## 功能清单与验收标准

- [x] **P0-1 一键扫码免密登录 (`QR Pairing`)**
  - `POST /pair-token` 生成 120s 有效期一次性令牌 + SVG 二维码；`GET /pair?t=` 验证后种 `httpOnly` Cookie 并 302 跳转 `/`；复用失效；`login.html` 展示过期提示。
  - 顶部设置条新增 `#qrPairBtn`（`扫码`），支持公网/局域网地址切换与倒计时刷新。
- [x] **P0-2 手机常亮锁 + 电脑防休眠 (`Wake Lock & Keep-Awake`)**
  - `lib/keep_awake.mjs`：Windows 下通过轻量 PowerShell 调用 `SetThreadExecutionState`，支持手动开关与桌面端 `busy` 自动防休眠，退出时释放。
  - `GET/POST /keep-awake`；顶部设置条新增 `#wakeLockBtn`（`常亮`），联动 `navigator.wakeLock` 与主机防休眠。
- [x] **P0-3 自定义快捷指令胶囊 (`Custom Prompt Snippets`)**
  - `#quickActionsBar` 由 `localStorage` (`ag_custom_snippets_v1`) 驱动，支持增删排序、切换点击即发/填入输入框、一键恢复默认。
- [x] **P0-4 完整 PWA 注册 + 自适应省电轮询**
  - `public/sw.js` 提供最小合规定位（纯透传网络，绝不缓存 `/snapshot` 与 API）；`manifest.json` 与 `#08090e` 主题对齐。
  - `server.js` `startPolling` 动态降频（忙碌/近期变化 `800ms` -> `1500ms` -> 空闲 `>=30s` 降为 `3500ms`）；前端后台暂停 `fetchAppState`。
- [x] **P1-1 离屏多通道 Webhook 推送**
  - `lib/webhook_notifier.mjs` 零额外依赖支持自动识别 / 飞书 / 钉钉 / 企微 / Bark / Server酱 / PushPlus / Telegram / 通用 JSON，30s 防抖、5s 超时保护；配置存 `webhook_config.json`（已 gitignore）。
  - 监听 `busy: true -> false`（>=5s 任务完成）与首次待审批动作，异步推送；`#notifyBtn` 弹窗支持前端通知开关 + Webhook 保存与测试推送。
- [x] **P1-2 繁忙态指令排队队列 (`Busy-State Prompt Queue`)**
  - `GET/POST/DELETE /queue`、`POST /queue/clear`、`POST /queue/send-now`；桌面端空闲稳定且无审批阻塞时自动出队注入并通过 WebSocket `queue_update` 同步。
  - `#queueBar` 位于输入框上方，自动调用 `updateFabOffset()` 避让。
- [x] **P1-3 只读工作区文件树 + 一键 `@文件` 引用与预览**
  - `GET /files?dir=&q=` 与 `GET /file-content?path=`（严格防 `..` 路径穿越、忽略 `node_modules`/`.git`、限制 200KB 文本）。
  - `#filesBtn` 打开 `#filesLayer` 抽屉，支持目录切换、模糊搜索、点击阅读源码、点击 `@` 插入路径到 `#messageInput`。
- [x] **P1-4 手机端 Git 操作闭环 (`Stage / Commit / Discard`)**
  - 扩展 `GET /git-status` 返回 `staged`/`unstaged` 标记；新增 `POST /git-stage`、`POST /git-commit`、`POST /git-discard`（`execFile` 隔离、禁用危险 `-` 标志与路径穿越，不开放 `push --force`/`reset --hard`）。
  - 升级 `#gitDiffBtn` 抽屉支持单文件/全量暂存、撤暂存、二次确认丢弃、填写 Commit 信息提交。
