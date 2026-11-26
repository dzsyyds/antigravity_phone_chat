// --- Elements ---
const chatContainer = document.getElementById('chatContainer');
const chatContent = document.getElementById('chatContent');
const messageInput = document.getElementById('messageInput');
const clearInputBtn = document.getElementById('clearInputBtn');
const sendBtn = document.getElementById('sendBtn');
const scrollToBottomBtn = document.getElementById('scrollToBottom');
const statusBadge = document.getElementById('statusBadge');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const chatTitleText = document.getElementById('chatTitleText');
const refreshBtn = document.getElementById('refreshBtn');
const stopBtn = document.getElementById('stopBtn');
const newChatBtn = document.getElementById('newChatBtn');
const historyBtn = document.getElementById('historyBtn');

const modeBtn = document.getElementById('modeBtn');
const modelBtn = document.getElementById('modelBtn');
const modalOverlay = document.getElementById('modalOverlay');
const modalList = document.getElementById('modalList');
const modalTitle = document.getElementById('modalTitle');
const modeText = document.getElementById('modeText');
const modelText = document.getElementById('modelText');
const historyLayer = document.getElementById('historyLayer');
const historyList = document.getElementById('historyList');
const historySearchInput = document.getElementById('historySearchInput');
const historyCountBadge = document.getElementById('historyCountBadge');

const pendingActionsBar = document.getElementById('pendingActionsBar');
const pendingActionsBtns = document.getElementById('pendingActionsBtns');
const toastContainer = document.getElementById('toastContainer');

const codeModalOverlay = document.getElementById('codeModalOverlay');
const codeModalTitle = document.getElementById('codeModalTitle');
const codeModalContent = document.getElementById('codeModalContent');
const codeModalCopyBtn = document.getElementById('codeModalCopyBtn');
const codeModalCloseBtn = document.getElementById('codeModalCloseBtn');

const windowBtn = document.getElementById('windowBtn');
const windowText = document.getElementById('windowText');
const quotaBtn = document.getElementById('quotaBtn');
const quotaText = document.getElementById('quotaText');
const gitDiffBtn = document.getElementById('gitDiffBtn');
const gitDiffText = document.getElementById('gitDiffText');
const notifyBtn = document.getElementById('notifyBtn');
const notifyText = document.getElementById('notifyText');
const attachImgBtn = document.getElementById('attachImgBtn');
const imageFileInput = document.getElementById('imageFileInput');
const attachmentPreview = document.getElementById('attachmentPreview');
const attachmentThumb = document.getElementById('attachmentThumb');
const attachmentName = document.getElementById('attachmentName');
const attachmentSize = document.getElementById('attachmentSize');
const removeAttachmentBtn = document.getElementById('removeAttachmentBtn');

const enableHttpsBtn = document.getElementById('enableHttpsBtn');
const dismissSslBtn = document.querySelector('.dismiss-btn');
const closeModalBtn = document.getElementById('closeModalBtn');
const supportBtn = document.getElementById('supportBtn');
const supportOverlay = document.getElementById('supportOverlay');
const closeSupportBtn = document.getElementById('closeSupportBtn');
const backHistoryBtn = document.querySelector('.history-header .icon-btn');
const quickActionChips = document.querySelectorAll('.action-chip');

// --- State ---
let autoRefreshEnabled = true;
let userIsScrolling = false;
let userScrollLockUntil = 0;
let ws = null;
let wsConnected = false;
let idleTimer = null;
let currentMode = '极速 (Turbo)';
let currentModel = 'Gemini 4 Hydrogen High';
let isAgentBusy = false;
let chatIsOpen = true;
let cachedCssHash = '';
let cachedHtmlHash = '';
let cachedHistoryChats = [];
let currentFullscreenCode = '';
let isFetchingAppState = false;

const USER_SCROLL_LOCK_DURATION = 3000;

const FALLBACK_MODELS = [
    { name: 'Gemini 4 Hydrogen', badge: 'High · 新', disabled: false },
    { name: 'Gemini 3.8 Flash', badge: 'Medium', disabled: false },
    { name: 'Claude Sonnet 4.6 (Thinking)', badge: '', disabled: false },
    { name: 'Claude Opus 4.6 (Thinking)', badge: '', disabled: false },
    { name: 'GPT-OSS 120B (Medium)', badge: '', disabled: false }
];

// --- Utilities: Toast & Haptic ---
function haptic(ms = 12) {
    try {
        if (navigator.vibrate) navigator.vibrate(ms);
    } catch (e) {}
}

function showToast(message, type = 'info', duration = 2400) {
    if (!toastContainer) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const iconMap = { success: '✅', error: '❌', info: '✨' };
    toast.innerHTML = `<span>${iconMap[type] || '✨'}</span><span>${escapeHtml(message)}</span>`;
    toastContainer.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 220);
    }, duration);
}

// --- Auth Utilities ---
async function fetchWithAuth(url, options = {}) {
    if (!options.headers) options.headers = {};
    options.headers['ngrok-skip-browser-warning'] = 'true';

    const res = await fetch(url, options);
    if (res.status === 401) {
        window.location.href = '/login.html';
        return new Promise(() => {});
    }
    return res;
}

const ALERTS_KEY = 'ag_alerts_enabled';
const BASE_DOC_TITLE = document.title;
let alertsEnabled = localStorage.getItem(ALERTS_KEY) === 'true';
let prevIsBusy = null;
let prevPendingCount = 0;
let pendingAttachment = null;
let titleFlashTimer = null;

function applyNotifyUI() {
    if (notifyBtn) notifyBtn.classList.toggle('active', alertsEnabled);
    if (notifyText) notifyText.textContent = alertsEnabled ? '提醒:开' : '提醒:关';
}

function playAlertTone() {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const now = ctx.currentTime;
        [587.33, 880].forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, now + i * 0.11);
            gain.gain.setValueAtTime(0.001, now + i * 0.11);
            gain.gain.exponentialRampToValueAtTime(0.08, now + i * 0.11 + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.11 + 0.22);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now + i * 0.11);
            osc.stop(now + i * 0.11 + 0.23);
        });
        setTimeout(() => { try { ctx.close(); } catch (e) {} }, 600);
    } catch (e) {}
}

function triggerMobileAlert(title, body, type = 'success') {
    showToast(`${title}${body ? ' · ' + body : ''}`, type, 3200);
    if (!alertsEnabled) return;
    haptic([80, 40, 120]);
    playAlertTone();
    clearTimeout(titleFlashTimer);
    document.title = `✅ ${title}`;
    titleFlashTimer = setTimeout(() => { document.title = BASE_DOC_TITLE; }, 5000);
    if ('Notification' in window && Notification.permission === 'granted') {
        try { new Notification(title, { body: body || '' }); } catch (e) {}
    }
}

applyNotifyUI();

if (notifyBtn) {
    notifyBtn.addEventListener('click', async () => {
        haptic(10);
        alertsEnabled = !alertsEnabled;
        try { localStorage.setItem(ALERTS_KEY, String(alertsEnabled)); } catch (e) {}
        applyNotifyUI();
        if (alertsEnabled) {
            playAlertTone();
            if ('Notification' in window && Notification.permission === 'default') {
                try { await Notification.requestPermission(); } catch (e) {}
            }
            showToast('已开启完成与审批提醒', 'success', 2000);
        } else {
            showToast('已关闭声音与弹窗提醒', 'info', 1600);
        }
    });
}

// --- Sync State (Desktop is Always Priority) ---
async function fetchAppState() {
    if (document.hidden || isFetchingAppState) return;
    isFetchingAppState = true;
    try {
        const res = await fetchWithAuth('/app-state');
        const data = await res.json();

        // Mode Sync
        if (data.mode && data.mode !== 'Unknown') {
            currentMode = data.mode;
            const isReview = /审查|review|plan/i.test(data.mode);
            modeText.textContent = isReview ? '审查模式' : '极速 (Turbo)';
            modeBtn.classList.toggle('active', isReview);
        }

        // Model Sync
        if (data.model && data.model !== 'Unknown') {
            currentModel = data.model;
            modelText.textContent = data.model;
        }

        // Active Conversation Title
        if (chatTitleText) {
            chatTitleText.textContent = data.chatTitle ? data.chatTitle : 'Antigravity 2.0 桌面控制台';
        }

        // Busy / Idle Status & Completion Alert
        const nextBusy = !!data.isBusy;
        if (prevIsBusy === true && !nextBusy) {
            triggerMobileAlert('AI 生成已完成', data.chatTitle || '可查看最新回复', 'success');
            refreshGitBadge();
            fetchQuotaSummary(true);
        }
        prevIsBusy = nextBusy;
        isAgentBusy = nextBusy;
        updateConnectionVisual();

        // Pending Approval Action Bar & Alert
        const actions = data.pendingActions || [];
        if (actions.length > 0 && prevPendingCount === 0) {
            triggerMobileAlert('需要手机审批确认', data.pendingPrompt || actions.map(a => a.text).join(' / '), 'info');
        }
        prevPendingCount = actions.length;
        renderPendingActions(actions, data.pendingPrompt || '');
    } catch (e) {
        console.error('[SYNC] Failed to sync state', e);
    } finally {
        isFetchingAppState = false;
    }
}

let lastPendingSignature = '';

function renderPendingActions(actions, pendingPrompt = '') {
    if (!pendingActionsBar || !pendingActionsBtns) return;
    if (!actions || actions.length === 0) {
        if (lastPendingSignature !== '') {
            lastPendingSignature = '';
            pendingActionsBar.style.display = 'none';
            pendingActionsBtns.innerHTML = '';
        }
        return;
    }

    const sig = JSON.stringify({ p: pendingPrompt, a: actions.map(a => [a.text, a.kind, a.scope, a.index]) });
    if (sig === lastPendingSignature) return;
    lastPendingSignature = sig;

    const promptEl = document.getElementById('pendingPromptText');
    if (promptEl) {
        promptEl.textContent = pendingPrompt ? `等待确认：${pendingPrompt}` : '等待远程确认';
    }

    pendingActionsBar.style.display = 'flex';
    pendingActionsBtns.innerHTML = '';
    actions.forEach(action => {
        const btn = document.createElement('button');
        btn.className = `pending-action-btn ${action.kind === 'reject' ? 'reject' : 'approve'}`;
        btn.textContent = action.text;
        btn.addEventListener('click', async () => {
            haptic(15);
            btn.disabled = true;
            btn.style.opacity = '0.6';
            try {
                const rcRes = await fetchWithAuth('/remote-click', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        selector: action.selector || 'button, [role="button"]',
                        index: action.index || 0,
                        textContent: action.text,
                        scope: action.scope || 'auto'
                    })
                });
                const rcData = await rcRes.json().catch(() => ({}));
                if (rcData.success) {
                    showToast(`已执行：${action.text}`, 'success');
                } else {
                    showToast(rcData.error || '未能点击该按钮，请稍后重试', 'error');
                    btn.disabled = false;
                    btn.style.opacity = '1';
                }
                setTimeout(loadSnapshot, 400);
                setTimeout(fetchAppState, 700);
            } catch (err) {
                showToast('远程点击失败', 'error');
                btn.disabled = false;
                btn.style.opacity = '1';
            }
        });
        pendingActionsBtns.appendChild(btn);
    });
}

// --- SSL Banner ---
const sslBanner = document.getElementById('sslBanner');

async function checkSslStatus() {
    if (window.location.protocol === 'https:') return;
    if (localStorage.getItem('sslBannerDismissed')) return;
    if (sslBanner) sslBanner.style.display = 'flex';
}

async function enableHttps() {
    const btn = document.getElementById('enableHttpsBtn');
    btn.textContent = '生成中...';
    btn.disabled = true;

    try {
        const res = await fetchWithAuth('/generate-ssl', { method: 'POST' });
        const data = await res.json();

        if (data.success) {
            sslBanner.innerHTML = `
                <span>✅ 证书已生成，重启服务后生效</span>
                <button id="sslReloadBtn">刷新页面</button>
            `;
            sslBanner.style.background = 'linear-gradient(90deg, #10b981, #059669)';
            const reloadBtn = document.getElementById('sslReloadBtn');
            if (reloadBtn) reloadBtn.addEventListener('click', () => location.reload());
        } else {
            btn.textContent = '生成失败 - 重试';
            btn.disabled = false;
        }
    } catch (e) {
        btn.textContent = '网络错误 - 重试';
        btn.disabled = false;
    }
}

function dismissSslBanner() {
    if (sslBanner) sslBanner.style.display = 'none';
    localStorage.setItem('sslBannerDismissed', 'true');
}

checkSslStatus();

// --- WebSocket ---
let isProgrammaticScroll = false;
let programmaticScrollTimer = null;
let pendingSnapshotUpdate = false;
let lastViewportChangeAt = 0;
let isLoadingSnapshot = false;
let queuedSnapshotReload = false;
let queuedForceBottom = false;
let lastSnapshotRenderAt = 0;
let snapshotThrottleTimer = null;

function scheduleSnapshotLoad(forceBottom = false) {
    if (document.hidden) {
        pendingSnapshotUpdate = true;
        return;
    }
    if (forceBottom) queuedForceBottom = true;
    const elapsed = Date.now() - lastSnapshotRenderAt;
    if (!isLoadingSnapshot && elapsed >= 1100) {
        const fb = queuedForceBottom;
        queuedForceBottom = false;
        loadSnapshot(fb);
        return;
    }
    queuedSnapshotReload = true;
    if (!snapshotThrottleTimer) {
        const waitMs = Math.max(120, 1100 - elapsed);
        snapshotThrottleTimer = setTimeout(() => {
            snapshotThrottleTimer = null;
            if (!isLoadingSnapshot && queuedSnapshotReload) {
                const fb = queuedForceBottom;
                queuedSnapshotReload = false;
                queuedForceBottom = false;
                loadSnapshot(fb);
            }
        }, waitMs);
    }
}

function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}`);

    ws.onopen = () => {
        wsConnected = true;
        updateConnectionVisual();
        loadSnapshot(true);
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'error' && data.message === 'Unauthorized') {
            window.location.href = '/login.html';
            return;
        }
        if (data.type === 'snapshot_update' && autoRefreshEnabled) {
            if (userIsScrolling || document.hidden) {
                pendingSnapshotUpdate = true;
            } else {
                scheduleSnapshotLoad(false);
            }
        }
    };

    ws.onclose = () => {
        wsConnected = false;
        updateConnectionVisual();
        setTimeout(connectWebSocket, 2000);
    };
}

function updateConnectionVisual() {
    if (!wsConnected) {
        statusDot.className = 'status-dot disconnected';
        statusBadge.classList.remove('busy');
        statusText.textContent = '重连中';
        if (stopBtn) stopBtn.classList.remove('is-active');
        return;
    }

    if (isAgentBusy) {
        statusDot.className = 'status-dot busy';
        statusBadge.classList.add('busy');
        statusText.textContent = '执行中';
        if (stopBtn) stopBtn.classList.add('is-active');
    } else {
        statusDot.className = 'status-dot connected';
        statusBadge.classList.remove('busy');
        statusText.textContent = '实时同步';
        if (stopBtn) stopBtn.classList.remove('is-active');
    }
}

function fastHtmlHash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36) + '_' + str.length;
}

function patchElementChildren(liveEl, nextEl, depth = 0) {
    const liveKids = Array.from(liveEl.children);
    const nextKids = Array.from(nextEl.children);
    const minLen = Math.min(liveKids.length, nextKids.length);

    for (let i = 0; i < minLen; i++) {
        const cur = liveKids[i];
        const inc = nextKids[i];
        const hash = fastHtmlHash(inc.outerHTML);
        if (cur._agRawHash === hash) continue;

        // Recursively patch deep containers (like active assistant turns) so earlier blocks stay mounted and scrollTop never clamps
        if (depth < 3 && cur.tagName === inc.tagName && cur.className === inc.className && cur.children.length > 0 && inc.children.length > 0) {
            cur._agRawHash = hash;
            patchElementChildren(cur, inc, depth + 1);
            continue;
        }

        const imported = document.importNode(inc, true);
        imported._agRawHash = hash;
        cur.replaceWith(imported);
        addMobileCopyButtons(imported);
    }

    for (let i = minLen; i < nextKids.length; i++) {
        const inc = nextKids[i];
        const hash = fastHtmlHash(inc.outerHTML);
        const imported = document.importNode(inc, true);
        imported._agRawHash = hash;
        liveEl.appendChild(imported);
        addMobileCopyButtons(imported);
    }

    for (let i = liveKids.length - 1; i >= nextKids.length; i--) {
        liveKids[i].remove();
    }
}

function patchChatHtml(html) {
    const tpl = document.createElement('template');
    tpl.innerHTML = html;

    const liveRoot = chatContent.querySelector('[data-quotable-root="true"]');
    const nextRoot = tpl.content.querySelector('[data-quotable-root="true"]');

    if (liveRoot && nextRoot) {
        patchElementChildren(liveRoot, nextRoot, 0);
        return;
    }

    chatContent.innerHTML = '';
    chatContent.appendChild(tpl.content);
    const createdRoot = chatContent.querySelector('[data-quotable-root="true"]');
    if (createdRoot) {
        Array.from(createdRoot.children).forEach(el => {
            el._agRawHash = fastHtmlHash(el.outerHTML);
        });
    }
    addMobileCopyButtons(chatContent);
}

// --- Rendering ---
async function loadSnapshot(forceBottom = false) {
    if (isLoadingSnapshot) {
        queuedSnapshotReload = true;
        if (forceBottom) queuedForceBottom = true;
        return;
    }
    isLoadingSnapshot = true;
    try {
        const hasStyleTag = !!document.getElementById('cdp-styles');
        const params = new URLSearchParams();
        if (cachedCssHash && hasStyleTag) params.set('cssHash', cachedCssHash);
        if (cachedHtmlHash && chatContent.querySelector('[data-testid="autoscroll-viewport"]')) {
            params.set('htmlHash', cachedHtmlHash);
        }
        const qs = params.toString();
        const url = qs ? `/snapshot?${qs}` : '/snapshot';
        const response = await fetchWithAuth(url);
        if (!response.ok) {
            if (response.status === 503) {
                chatIsOpen = false;
                cachedHtmlHash = '';
                showEmptyState();
                return;
            }
            throw new Error('Failed to load snapshot');
        }

        chatIsOpen = true;
        const data = await response.json();
        lastSnapshotRenderAt = Date.now();

        // --- UPDATE STATS ---
        if (data.stats) {
            const htmlKb = Math.round(data.stats.htmlSize / 1024);
            const nodes = data.stats.nodes;
            const statsText = document.getElementById('statsText');
            if (statsText) statsText.textContent = `${nodes} 节点 · ${htmlKb}KB`;
        }

        if (data.unchanged) {
            if (forceBottom) {
                userIsScrolling = false;
                userScrollLockUntil = 0;
                scrollToBottom(false);
            }
            return;
        }

        const scrollPos = chatContainer.scrollTop;
        const scrollHeight = chatContainer.scrollHeight;
        const clientHeight = chatContainer.clientHeight;
        const isNearBottom = scrollHeight - scrollPos - clientHeight < 120;
        const isUserScrollLocked = Date.now() < userScrollLockUntil;

        // --- CSS INJECTION (Delta Cached, Base CSS & Static Mobile Overrides Separated) ---
        if (data.css) {
            const nextCssHash = data.cssHash || cachedCssHash;
            let styleTag = document.getElementById('cdp-styles');
            if (!styleTag || cachedCssHash !== nextCssHash) {
                if (!styleTag) {
                    styleTag = document.createElement('style');
                    styleTag.id = 'cdp-styles';
                    document.head.appendChild(styleTag);
                }
                if (styleTag.textContent !== data.css) {
                    styleTag.textContent = data.css;
                }
            }
            cachedCssHash = nextCssHash;
        }

        if (!document.getElementById('ag-mobile-overrides')) {
            const overrideTag = document.createElement('style');
            overrideTag.id = 'ag-mobile-overrides';
            overrideTag.textContent = `/* --- MOBILE DARK MODE OVERRIDES --- */
:root {
    --bg-app: #07070a;
    --text-main: #f8fafc;
    --text-muted: #94a3b8;
    --border-color: rgba(255,255,255,0.1);
    --overview-panel-reserve: 0px !important;
    --conversation-nav-reserve: 0px !important;
}

[data-testid="autoscroll-viewport"], #conversation, #chat, #cascade {
    background-color: transparent !important;
    color: var(--text-main) !important;
    font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif !important;
    position: relative !important;
    height: auto !important;
    min-height: 0 !important;
    width: 100% !important;
    overflow: visible !important;
    container-type: normal !important;
    mask-image: none !important;
    -webkit-mask-image: none !important;
    padding-left: 10px !important;
    padding-right: 10px !important;
}

#chatContent [data-testid="autoscroll-viewport"] > div {
    max-width: 100% !important;
}

#conversation > div, #chat > div, #cascade > div {
    position: static !important;
}

#chatContent [style*="position: absolute"], #chatContent [style*="position: fixed"],
#chatContent [data-headlessui-state], #chatContent [id*="headlessui"] {
    position: absolute !important;
}

#conversation p, #chat p, #cascade p,
[data-testid="autoscroll-viewport"] p, [data-testid="autoscroll-viewport"] li {
    color: inherit !important;
    line-height: 1.6 !important;
}

[style*="color: rgb(0, 0, 0)"], [style*="color: black"],
[style*="color:#000"], [style*="color: #000"] {
    color: #e2e8f0 !important;
}

#conversation a, #chat a, #cascade a, [data-testid="autoscroll-viewport"] a {
    color: #818cf8 !important;
    text-decoration: underline;
    word-break: break-all;
}

img[src^="/c:"], img[src^="/C:"], img[src*="AppData"] {
    display: none !important;
}

#chatContent img, #chatContent svg {
    display: inline !important;
    vertical-align: middle !important;
}

#chatContent div:has(> img[src^="data:"]), #chatContent div:has(> img[alt]), #chatContent span:has(> img) {
    display: inline !important;
    vertical-align: middle !important;
}

[class*="inline-flex"], [class*="inline-block"], [class*="items-center"]:has(img) {
    display: inline-flex !important;
    vertical-align: middle !important;
}

:not(pre) > code {
    padding: 1px 5px !important;
    border-radius: 5px !important;
    background-color: rgba(99, 102, 241, 0.14) !important;
    color: #c7d2fe !important;
    font-size: 0.84em !important;
    font-family: 'JetBrains Mono', monospace !important;
}

pre, code, .monaco-editor-background, [class*="terminal"] {
    background-color: #111420 !important;
    color: #e2e8f0 !important;
    font-family: 'JetBrains Mono', monospace !important;
    border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, 0.08);
}

pre {
    position: relative !important;
    white-space: pre-wrap !important;
    word-break: break-word !important;
    padding: 10px 10px !important;
    margin: 6px 0 !important;
    display: block !important;
    width: 100% !important;
    font-size: 12.5px !important;
}

pre.has-copy-btn {
    padding-top: 34px !important;
}

pre.single-line-pre {
    display: inline-block !important;
    width: auto !important;
    max-width: 100% !important;
    padding: 2px 6px !important;
    margin: 0 !important;
    vertical-align: middle !important;
    font-size: 0.85em !important;
}

td pre.single-line-pre, th pre.single-line-pre,
td code, th code {
    white-space: pre-wrap !important;
    word-break: break-all !important;
}

pre.single-line-pre > code {
    display: inline !important;
    white-space: nowrap !important;
    border: none !important;
}

pre:not(.single-line-pre) > code {
    display: block !important;
    width: 100% !important;
    overflow-x: auto !important;
    background: transparent !important;
    border: none !important;
    padding: 0 !important;
    margin: 0 !important;
}

.mobile-code-toolbar {
    position: absolute !important;
    top: 6px !important;
    right: 6px !important;
    display: flex !important;
    gap: 6px !important;
    z-index: 10 !important;
}

.mobile-copy-btn, .mobile-expand-btn {
    background: rgba(30, 41, 59, 0.85) !important;
    color: #cbd5e1 !important;
    border: 1px solid rgba(255, 255, 255, 0.12) !important;
    height: 24px !important;
    padding: 0 8px !important;
    cursor: pointer !important;
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;
    gap: 4px !important;
    border-radius: 6px !important;
    font-size: 11px !important;
    font-family: inherit !important;
    transition: all 0.2s ease !important;
}

.mobile-copy-btn svg, .mobile-expand-btn svg {
    width: 13px !important;
    height: 13px !important;
    stroke: currentColor !important;
    stroke-width: 2 !important;
    fill: none !important;
}

blockquote {
    border-left: 3px solid #6366f1 !important;
    background: rgba(99, 102, 241, 0.09) !important;
    color: #cbd5e1 !important;
    padding: 8px 12px !important;
    border-radius: 0 8px 8px 0 !important;
    margin: 8px 0 !important;
}

table {
    display: block !important;
    overflow-x: auto !important;
    border-collapse: collapse !important;
    width: 100% !important;
    border: 1px solid rgba(255, 255, 255, 0.1) !important;
    border-radius: 8px !important;
}
th, td {
    border: 1px solid rgba(255, 255, 255, 0.08) !important;
    padding: 7px 10px !important;
    color: #e2e8f0 !important;
    font-size: 12.5px !important;
}

::-webkit-scrollbar {
    width: 0 !important;
    height: 0 !important;
}

[style*="background-color: rgb(255, 255, 255)"],
[style*="background-color: white"],
[style*="background: white"] {
    background-color: transparent !important;
}

#chatContent *, #chatContent *::before, #chatContent *::after {
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
}

#chatContent *:not(.loading-spinner), #chatContent *::before, #chatContent *::after {
    transition: none !important;
    animation: none !important;
}`;
            document.head.appendChild(overrideTag);
        }

        if (!forceBottom && userIsScrolling) {
            pendingSnapshotUpdate = true;
            return;
        }

        if (data.htmlHash && data.htmlHash === cachedHtmlHash && chatContent.querySelector('[data-testid="autoscroll-viewport"]')) {
            if (forceBottom) {
                userIsScrolling = false;
                userScrollLockUntil = 0;
                scrollToBottom(false);
            }
            return;
        }

        if (data.html) {
            cachedHtmlHash = data.htmlHash || '';
            patchChatHtml(data.html);
        }

        const nextScrollHeight = chatContainer.scrollHeight;
        const heightDelta = Math.abs(nextScrollHeight - scrollHeight);

        if (forceBottom) {
            userIsScrolling = false;
            userScrollLockUntil = 0;
            scrollToBottom(false);
        } else if (isNearBottom || scrollPos === 0) {
            if (heightDelta > 2 || Math.abs(nextScrollHeight - chatContainer.scrollTop - clientHeight) > 4) {
                scrollToBottom(false);
            }
        } else {
            // User is reading earlier messages: guard against browser clamping scrollTop during DOM patch
            const targetTop = (isUserScrollLocked && heightDelta > 2 && scrollHeight > 0)
                ? nextScrollHeight * (scrollPos / scrollHeight)
                : scrollPos;
            if (Math.abs(chatContainer.scrollTop - targetTop) > 2) {
                isProgrammaticScroll = true;
                clearTimeout(programmaticScrollTimer);
                chatContainer.scrollTop = targetTop;
                programmaticScrollTimer = setTimeout(() => { isProgrammaticScroll = false; }, 120);
            }
        }
    } catch (err) {
        console.error(err);
    } finally {
        isLoadingSnapshot = false;
        if (queuedSnapshotReload) {
            queuedSnapshotReload = false;
            const fb = queuedForceBottom;
            queuedForceBottom = false;
            setTimeout(() => scheduleSnapshotLoad(fb), 120);
        }
    }
}

// --- Mobile Code Block Copy & Fullscreen Preview ---
function addMobileCopyButtons(scope = chatContent) {
    if (!scope || !scope.querySelectorAll) return;
    const codeBlocks = scope.querySelectorAll('pre');

    codeBlocks.forEach((pre, index) => {
        if (pre.querySelector('.mobile-code-toolbar')) return;

        const codeElement = pre.querySelector('code') || pre;
        const textToCopy = (codeElement.textContent || codeElement.innerText).trim();
        const hasNewline = /\n/.test(textToCopy);

        if (!hasNewline) {
            pre.classList.remove('has-copy-btn');
            pre.classList.add('single-line-pre');
            return;
        }

        pre.classList.remove('single-line-pre');
        pre.classList.add('has-copy-btn');

        const toolbar = document.createElement('div');
        toolbar.className = 'mobile-code-toolbar';

        const expandBtn = document.createElement('button');
        expandBtn.className = 'mobile-expand-btn';
        expandBtn.setAttribute('aria-label', '全屏查看');
        expandBtn.innerHTML = `
            <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="15 3 21 3 21 9"></polyline>
                <polyline points="9 21 3 21 3 15"></polyline>
                <line x1="21" y1="3" x2="14" y2="10"></line>
                <line x1="3" y1="21" x2="10" y2="14"></line>
            </svg>
            <span>全屏</span>
        `;
        expandBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            openCodeModal(textToCopy);
        });

        const copyBtn = document.createElement('button');
        copyBtn.className = 'mobile-copy-btn';
        copyBtn.setAttribute('data-code-index', index);
        copyBtn.setAttribute('aria-label', '复制代码');
        copyBtn.innerHTML = `
            <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            <span>复制</span>
        `;

        copyBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const success = await copyToClipboard(textToCopy);
            if (success) {
                haptic(10);
                copyBtn.innerHTML = `<span>已复制 ✓</span>`;
                showToast('代码已复制到剪贴板', 'success', 1600);
                setTimeout(() => {
                    copyBtn.innerHTML = `
                        <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                        <span>复制</span>
                    `;
                }, 1800);
            } else {
                openCodeModal(textToCopy);
                showToast('浏览器限制剪贴板，已打开全屏供手动选择', 'info');
            }
        });

        toolbar.appendChild(expandBtn);
        toolbar.appendChild(copyBtn);
        pre.appendChild(toolbar);
    });
}

function openCodeModal(code, title = '代码全屏预览') {
    currentFullscreenCode = code;
    if (codeModalTitle) codeModalTitle.textContent = title;
    if (codeModalContent && codeModalOverlay) {
        codeModalContent.textContent = code;
        codeModalOverlay.classList.add('show');
    }
}

function openDiffModal(filePath, diffText) {
    currentFullscreenCode = diffText;
    if (codeModalTitle) codeModalTitle.textContent = `改动对比 · ${filePath}`;
    if (codeModalContent && codeModalOverlay) {
        codeModalContent.innerHTML = '';
        const frag = document.createDocumentFragment();
        String(diffText || '').split(/\r?\n/).forEach(line => {
            const span = document.createElement('span');
            span.className = 'diff-line';
            if (line.startsWith('+') && !line.startsWith('+++')) span.classList.add('diff-line-add');
            else if (line.startsWith('-') && !line.startsWith('---')) span.classList.add('diff-line-del');
            else if (line.startsWith('@@') || line.startsWith('diff ') || line.startsWith('index ')) span.classList.add('diff-line-hunk');
            span.textContent = line;
            frag.appendChild(span);
        });
        codeModalContent.appendChild(frag);
        codeModalOverlay.classList.add('show');
    }
}

if (codeModalCloseBtn) {
    codeModalCloseBtn.addEventListener('click', () => {
        codeModalOverlay.classList.remove('show');
    });
}

if (codeModalCopyBtn) {
    codeModalCopyBtn.addEventListener('click', async () => {
        const ok = await copyToClipboard(currentFullscreenCode);
        if (ok) showToast('已复制全部代码', 'success');
        else showToast('请长按下方代码手动复制', 'info');
    });
}

// --- Cross-platform Clipboard Copy ---
async function copyToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (err) {}
    }

    try {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.top = '0';
        textArea.style.left = '0';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.select();
        const success = document.execCommand('copy');
        document.body.removeChild(textArea);
        if (success) return true;
    } catch (err) {}
    return false;
}

function scrollToBottom(smooth = true) {
    isProgrammaticScroll = true;
    clearTimeout(programmaticScrollTimer);
    if (smooth) {
        chatContainer.scrollTo({
            top: chatContainer.scrollHeight,
            behavior: 'smooth'
        });
        programmaticScrollTimer = setTimeout(() => {
            chatContainer.scrollTop = chatContainer.scrollHeight;
            isProgrammaticScroll = false;
            scrollToBottomBtn.classList.remove('show');
        }, 550);
    } else {
        chatContainer.scrollTop = chatContainer.scrollHeight;
        requestAnimationFrame(() => {
            chatContainer.scrollTop = chatContainer.scrollHeight;
            scrollToBottomBtn.classList.remove('show');
            programmaticScrollTimer = setTimeout(() => {
                isProgrammaticScroll = false;
            }, 120);
        });
    }
}

// --- Inputs, IME Guard, Draft & Enter-Mode ---
const DRAFT_KEY = 'ag_input_draft';
const ENTER_MODE_KEY = 'ag_enter_to_send';
const enterModeBtn = document.getElementById('enterModeBtn');
const imageModalOverlay = document.getElementById('imageModalOverlay');
const imageModalImg = document.getElementById('imageModalImg');
const imageModalClose = document.getElementById('imageModalClose');

let isComposing = false;
let isSending = false;
let enterToSend = localStorage.getItem(ENTER_MODE_KEY) !== 'false';

function applyEnterModeUI() {
    if (enterModeBtn) {
        enterModeBtn.textContent = enterToSend ? '⏎ 回车:发送' : '⏎ 回车:换行';
        enterModeBtn.classList.toggle('active', !enterToSend);
    }
    messageInput.setAttribute('enterkeyhint', enterToSend ? 'send' : 'enter');
    messageInput.placeholder = enterToSend
        ? '给 Antigravity 发消息... (回车发送)'
        : '给 Antigravity 发消息... (点右侧发送)';
}

function resizeTextarea() {
    const maxH = document.body.classList.contains('keyboard-open') ? 108 : 150;
    const prevTop = chatContainer.scrollTop;
    messageInput.style.height = '24px';
    const nextH = Math.min(maxH, Math.max(24, messageInput.scrollHeight));
    messageInput.style.height = nextH + 'px';
    messageInput.style.overflowY = messageInput.scrollHeight > maxH ? 'auto' : 'hidden';
    if (clearInputBtn) {
        clearInputBtn.style.display = messageInput.value.length > 0 ? 'flex' : 'none';
    }
    if (typeof updateFabOffset === 'function') updateFabOffset();
    if (chatContainer.scrollTop !== prevTop) chatContainer.scrollTop = prevTop;
}

function saveDraft() {
    try {
        if (messageInput.value) localStorage.setItem(DRAFT_KEY, messageInput.value);
        else localStorage.removeItem(DRAFT_KEY);
    } catch (e) {}
}

function insertTextAtCursor(snippet) {
    haptic(8);
    const start = messageInput.selectionStart ?? messageInput.value.length;
    const end = messageInput.selectionEnd ?? messageInput.value.length;
    const before = messageInput.value.slice(0, start);
    const after = messageInput.value.slice(end);
    messageInput.value = before + snippet + after;
    const nextPos = start + snippet.length;
    messageInput.focus();
    try { messageInput.setSelectionRange(nextPos, nextPos); } catch (e) {}
    resizeTextarea();
    saveDraft();
}

// Restore saved draft & enter preference on startup
(function restoreInputPrefs() {
    applyEnterModeUI();
    try {
        const draft = localStorage.getItem(DRAFT_KEY);
        if (draft) {
            messageInput.value = draft;
            resizeTextarea();
        }
    } catch (e) {}
})();

if (enterModeBtn) {
    enterModeBtn.addEventListener('click', () => {
        haptic(10);
        enterToSend = !enterToSend;
        try { localStorage.setItem(ENTER_MODE_KEY, String(enterToSend)); } catch (e) {}
        applyEnterModeUI();
        showToast(enterToSend ? '已切换：键盘回车直接发送' : '已切换：键盘回车换行，点右侧按钮发送', 'info', 2000);
    });
}

function clearAttachment() {
    pendingAttachment = null;
    if (imageFileInput) imageFileInput.value = '';
    if (attachmentPreview) attachmentPreview.style.display = 'none';
    if (attachmentThumb) attachmentThumb.removeAttribute('src');
    if (typeof updateFabOffset === 'function') updateFabOffset();
}

function compressImageFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('读取图片失败'));
        reader.onload = () => {
            const rawDataUrl = reader.result;
            // Small GIF/PNG/WebP (< 600KB) sent directly without re-encoding
            if (file.size < 600 * 1024 && file.type !== 'image/heic') {
                resolve({ dataUrl: rawDataUrl, mimeType: file.type || 'image/png', sizeBytes: file.size });
                return;
            }
            const img = new Image();
            img.onerror = () => resolve({ dataUrl: rawDataUrl, mimeType: file.type || 'image/jpeg', sizeBytes: file.size });
            img.onload = () => {
                const maxSide = 1440;
                let { width, height } = img;
                if (width > maxSide || height > maxSide) {
                    const ratio = Math.min(maxSide / width, maxSide / height);
                    width = Math.round(width * ratio);
                    height = Math.round(height * ratio);
                }
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                const outUrl = canvas.toDataURL('image/jpeg', 0.85);
                const approxBytes = Math.round((outUrl.length * 3) / 4);
                resolve({ dataUrl: outUrl, mimeType: 'image/jpeg', sizeBytes: approxBytes });
            };
            img.src = rawDataUrl;
        };
        reader.readAsDataURL(file);
    });
}

if (attachImgBtn && imageFileInput) {
    attachImgBtn.addEventListener('click', () => {
        haptic(8);
        try {
            imageFileInput.value = '';
            imageFileInput.click();
        } catch (err) {
            showToast('无法调起手机相册，请在浏览器或系统设置中允许文件/照片访问权限', 'error', 2800);
        }
    });
    imageFileInput.addEventListener('change', async () => {
        const file = imageFileInput.files?.[0];
        if (!file) return;
        try {
            showToast('正在压缩准备图片...', 'info', 1200);
            const compressed = await compressImageFile(file);
            pendingAttachment = {
                fileName: file.name || 'mobile_photo.jpg',
                mimeType: compressed.mimeType,
                dataBase64: compressed.dataUrl,
                sizeBytes: compressed.sizeBytes
            };
            if (attachmentThumb) attachmentThumb.src = compressed.dataUrl;
            if (attachmentName) attachmentName.textContent = pendingAttachment.fileName;
            if (attachmentSize) attachmentSize.textContent = `${Math.max(1, Math.round(compressed.sizeBytes / 1024))} KB`;
            if (attachmentPreview) attachmentPreview.style.display = 'flex';
            if (typeof updateFabOffset === 'function') updateFabOffset();
        } catch (err) {
            const msg = /permission|notallowed|notreadable|denied/i.test(String(err?.message || err))
                ? '缺少手机相册/文件读取权限，请在系统设置开启后重试'
                : '图片读取失败，请重新选择或检查相册权限';
            showToast(msg, 'error', 2600);
        }
    });
}

if (removeAttachmentBtn) {
    removeAttachmentBtn.addEventListener('click', () => {
        haptic(6);
        clearAttachment();
    });
}

async function sendMessage() {
    if (isSending) return;
    const message = messageInput.value.trim();
    const attachment = pendingAttachment;
    if (!message && !attachment) return;

    haptic(15);
    isSending = true;
    const prevDraft = messageInput.value;
    messageInput.value = '';
    resizeTextarea();
    saveDraft();

    sendBtn.disabled = true;
    sendBtn.classList.add('sending');

    try {
        if (!chatIsOpen) {
            const newChatRes = await fetchWithAuth('/new-chat', { method: 'POST' });
            const newChatData = await newChatRes.json();
            if (newChatData.success) {
                await new Promise(r => setTimeout(r, 800));
                chatIsOpen = true;
            }
        }

        let res;
        if (attachment) {
            res = await fetchWithAuth('/upload-image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fileName: attachment.fileName,
                    mimeType: attachment.mimeType,
                    dataBase64: attachment.dataBase64,
                    caption: message
                })
            });
        } else {
            res = await fetchWithAuth('/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message })
            });
        }
        const data = await res.json().catch(() => ({}));

        if (res.ok && data.success !== false) {
            if (attachment) clearAttachment();
            const sentMsg = attachment
                ? (data.autoSent === false ? '图片已附加到桌面输入框，请输入文字后发送' : '图片已发送至桌面端')
                : '指令已发送至桌面端';
            showToast(sentMsg, 'success', attachment && data.autoSent === false ? 2400 : 1500);
            userIsScrolling = false;
            userScrollLockUntil = 0;
            scrollToBottomBtn.classList.remove('show');
            messageInput.blur();
            setTimeout(() => loadSnapshot(true), 300);
            setTimeout(() => loadSnapshot(true), 900);
            setTimeout(() => loadSnapshot(true), 1700);
            setTimeout(fetchAppState, 1100);
            return;
        } else if (data.details?.reason === 'busy') {
            messageInput.value = prevDraft;
            resizeTextarea();
            saveDraft();
            showToast('智能体正在生成回复中，请稍候或先点“停止”', 'info', 2600);
        } else {
            messageInput.value = prevDraft;
            resizeTextarea();
            saveDraft();
            showToast(`发送未成功：${data.details?.error || data.details?.reason || data.error || '请稍后重试'}`, 'error', 2600);
        }

        setTimeout(loadSnapshot, 300);
        setTimeout(loadSnapshot, 900);
        setTimeout(fetchAppState, 1100);
    } catch (e) {
        console.error('Send error:', e);
        messageInput.value = prevDraft;
        resizeTextarea();
        saveDraft();
        showToast('网络发送异常，已保留输入内容', 'error');
        setTimeout(loadSnapshot, 600);
    } finally {
        isSending = false;
        sendBtn.disabled = false;
        sendBtn.classList.remove('sending');
    }
}

// Keep soft keyboard steady (prevent blur/re-open flash) when tapping input toolbar buttons
[sendBtn, clearInputBtn, enterModeBtn, removeAttachmentBtn, ...document.querySelectorAll('.insert-chip')].forEach(el => {
    if (el) el.addEventListener('mousedown', (e) => e.preventDefault());
});

sendBtn.addEventListener('click', sendMessage);

if (clearInputBtn) {
    clearInputBtn.addEventListener('click', () => {
        messageInput.value = '';
        resizeTextarea();
        saveDraft();
        messageInput.focus();
    });
}

refreshBtn.addEventListener('click', () => {
    haptic(10);
    const icon = refreshBtn.querySelector('svg');
    if (icon) {
        icon.classList.remove('spin-anim');
        void icon.offsetWidth;
        icon.classList.add('spin-anim');
    }
    cachedCssHash = '';
    cachedHtmlHash = '';
    loadSnapshot(true);
    fetchAppState();
    showToast('已强制刷新桌面快照', 'info', 1400);
});

messageInput.addEventListener('compositionstart', () => {
    isComposing = true;
});

messageInput.addEventListener('compositionend', () => {
    isComposing = false;
});

let lastEnterSendAt = 0;

messageInput.addEventListener('keydown', (e) => {
    // Guard against IME Chinese/CJK composition confirm Enter
    if (isComposing || e.isComposing || e.keyCode === 229) return;
    if ((e.key === 'Enter' || e.keyCode === 13) && enterToSend && !e.shiftKey) {
        e.preventDefault();
        lastEnterSendAt = Date.now();
        sendMessage();
    }
});

messageInput.addEventListener('beforeinput', (e) => {
    // Some Android IMEs bypass keydown Enter and emit insertLineBreak directly
    if (e.inputType === 'insertLineBreak' && enterToSend && !isComposing) {
        e.preventDefault();
        if (Date.now() - lastEnterSendAt > 120) {
            lastEnterSendAt = Date.now();
            sendMessage();
        }
    }
});

messageInput.addEventListener('input', () => {
    resizeTextarea();
    saveDraft();
});

// --- Scroll Handling (Zero-Flicker Native Mobile Momentum) ---
chatContainer.addEventListener('scroll', () => {
    const isNearBottom = chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight < 120;
    if (isNearBottom) {
        if (scrollToBottomBtn.classList.contains('show')) scrollToBottomBtn.classList.remove('show');
        userScrollLockUntil = 0;
    } else if (!scrollToBottomBtn.classList.contains('show')) {
        scrollToBottomBtn.classList.add('show');
    }

    // Ignore programmatic scrolls and keyboard-animation viewport resizes
    if (isProgrammaticScroll || Date.now() - lastViewportChangeAt < 350) {
        return;
    }

    userIsScrolling = true;
    userScrollLockUntil = Date.now() + 5000;
    clearTimeout(idleTimer);

    idleTimer = setTimeout(() => {
        userIsScrolling = false;
        autoRefreshEnabled = true;
        if (pendingSnapshotUpdate) {
            pendingSnapshotUpdate = false;
            loadSnapshot();
        }
    }, 1100);
}, { passive: true });

scrollToBottomBtn.addEventListener('click', () => {
    haptic(10);
    userIsScrolling = false;
    userScrollLockUntil = 0;
    scrollToBottom(true);
    if (pendingSnapshotUpdate) {
        pendingSnapshotUpdate = false;
        setTimeout(() => loadSnapshot(true), 250);
    }
});

// --- Quick Actions ---
function quickAction(text) {
    haptic(10);
    messageInput.value = text;
    resizeTextarea();
    saveDraft();
    messageInput.focus();
}

// --- Stop Logic ---
stopBtn.addEventListener('click', async () => {
    haptic(20);
    stopBtn.style.opacity = '0.5';
    try {
        const res = await fetchWithAuth('/stop', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            showToast('已终止智能体当前生成', 'info');
            setTimeout(fetchAppState, 400);
        } else {
            showToast('当前没有正在运行中的任务', 'info');
        }
    } catch (e) {
        showToast('停止指令发送失败', 'error');
    }
    setTimeout(() => stopBtn.style.opacity = '1', 400);
});

// --- New Chat Logic ---
async function startNewChat() {
    haptic(15);
    newChatBtn.style.opacity = '0.5';
    newChatBtn.style.pointerEvents = 'none';

    try {
        const res = await fetchWithAuth('/new-chat', { method: 'POST' });
        const data = await res.json();

        if (data.success) {
            showToast('已为您开启全新对话', 'success');
            setTimeout(loadSnapshot, 500);
            setTimeout(loadSnapshot, 1100);
            setTimeout(fetchAppState, 1300);
        } else {
            showToast('新建对话失败', 'error');
        }
    } catch (e) {
        showToast('新建对话异常', 'error');
    }

    setTimeout(() => {
        newChatBtn.style.opacity = '1';
        newChatBtn.style.pointerEvents = 'auto';
    }, 500);
}

newChatBtn.addEventListener('click', startNewChat);

// --- Chat History Logic ---
function renderHistoryCards(chats) {
    if (!historyList) return;
    if (historyCountBadge) {
        historyCountBadge.textContent = `${chats.length}`;
    }

    if (chats.length === 0) {
        historyList.innerHTML = `
            <div class="history-state-container">
                <div class="history-state-icon">🔍</div>
                <div class="history-state-title">未找到匹配的会话</div>
                <div class="history-state-desc">尝试换个关键词搜索，或点击下方开启新对话</div>
                <button class="history-new-btn mt-4">
                    <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round">
                        <line x1="12" y1="5" x2="12" y2="19"></line>
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                    </svg>
                    新建对话
                </button>
            </div>
        `;
        return;
    }

    let html = `
        <div class="history-action-container">
            <button class="history-new-btn">
                <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round">
                    <line x1="12" y1="5" x2="12" y2="19"></line>
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
                开启全新对话
            </button>
        </div>
        <div class="history-list-group">
    `;

    chats.forEach(chat => {
        const safeTitle = chat.title.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        html += `
            <div class="history-card" data-id="${chat.id}" data-title="${safeTitle}">
                <div class="history-card-icon">
                    <svg viewBox="0 0 24 24" width="19" height="19" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                    </svg>
                </div>
                <div class="history-card-content">
                    <span class="history-card-title">${escapeHtml(chat.title)}</span>
                    <div class="history-card-meta">
                        ${chat.timeAgo ? `<span class="history-card-ago">${escapeHtml(chat.timeAgo)}</span>` : ''}
                        ${chat.timeStr ? `<span>${escapeHtml(chat.timeStr)}</span>` : ''}
                    </div>
                </div>
                <div class="history-card-arrow">
                    <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="9 18 15 12 9 6"></polyline>
                    </svg>
                </div>
            </div>
        `;
    });

    html += `</div>`;
    historyList.innerHTML = html;
}

async function showChatHistory() {
    haptic(10);
    if (historySearchInput) historySearchInput.value = '';
    historyList.innerHTML = `
        <div class="history-state-container">
            <div class="history-spinner"></div>
            <div class="history-state-text">正在读取历史会话...</div>
        </div>
    `;
    historyLayer.classList.add('show');

    try {
        const res = await fetchWithAuth('/chat-history');
        const data = await res.json();

        if (data.error) {
            historyList.innerHTML = `
                <div class="history-state-container">
                    <div class="history-state-icon">⚠️</div>
                    <div class="history-state-title">获取历史会话失败</div>
                    <div class="history-state-desc">${escapeHtml(data.error)}</div>
                </div>
            `;
            return;
        }

        cachedHistoryChats = data.chats || [];
        renderHistoryCards(cachedHistoryChats);
    } catch (e) {
        historyList.innerHTML = `
            <div class="history-state-container">
                <div class="history-state-icon">🔌</div>
                <div class="history-state-title">网络连接异常</div>
                <div class="history-state-desc">无法连接至电脑端服务，请稍后重试。</div>
            </div>
        `;
    }
}

if (historySearchInput) {
    historySearchInput.addEventListener('input', () => {
        const q = historySearchInput.value.trim().toLowerCase();
        if (!q) {
            renderHistoryCards(cachedHistoryChats);
        } else {
            const filtered = cachedHistoryChats.filter(c => c.title.toLowerCase().includes(q));
            renderHistoryCards(filtered);
        }
    });
}

function hideChatHistory() {
    historyLayer.classList.remove('show');
    try {
        fetchWithAuth('/close-history', { method: 'POST' });
    } catch (e) {}
}

historyBtn.addEventListener('click', showChatHistory);

// --- Select Chat from History ---
async function selectChat(idOrTitle) {
    haptic(12);
    chatContent.innerHTML = '<div class="loading-state"><div class="loading-spinner"></div><p>正在切换桌面端对话...</p></div>';

    try {
        const res = await fetchWithAuth('/select-chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: idOrTitle, title: idOrTitle })
        });
        const data = await res.json();

        if (data.success) {
            showToast('已切换会话，正在同步内容', 'info', 1600);
            let attempts = 0;
            const poll = setInterval(async () => {
                await loadSnapshot();
                if (attempts === 1 || attempts === 3) fetchAppState();
                attempts++;
                if (attempts > 8) clearInterval(poll);
            }, 500);
        } else {
            showToast('切换会话失败', 'error');
            setTimeout(loadSnapshot, 500);
        }
    } catch (e) {
        setTimeout(loadSnapshot, 500);
    }
}

// --- Check Chat Status ---
async function checkChatStatus() {
    try {
        const res = await fetchWithAuth('/chat-status');
        const data = await res.json();
        chatIsOpen = data.hasChat || data.editorFound;
        if (!chatIsOpen) {
            showEmptyState();
        }
    } catch (e) {}
}

// --- Empty State (No Chat Open) ---
function showEmptyState() {
    chatContent.innerHTML = `
        <div class="empty-state">
            <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                <line x1="9" y1="10" x2="15" y2="10"></line>
            </svg>
            <h2>当前尚未打开对话</h2>
            <p>你可以立即发起一段新对话，或从右上角历史记录中恢复之前的任务。</p>
            <button class="empty-state-btn" id="newChatFromEmptyBtn">
                开启新对话
            </button>
        </div>
    `;
}

// --- Utility: Escape HTML ---
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// --- Settings Logic (Rich Bottom Sheet) ---
function openModal(title, items, onSelect) {
    modalTitle.textContent = title;
    modalList.innerHTML = '';
    items.forEach(item => {
        const opt = typeof item === 'string' ? { name: item, badge: '', disabled: false, active: false } : item;
        const div = document.createElement('div');
        div.className = `modal-option${opt.active ? ' active' : ''}${opt.disabled ? ' disabled' : ''}`;
        div.innerHTML = `
            <div class="modal-option-main">
                <span class="modal-option-name">${escapeHtml(opt.name)}</span>
                ${opt.badge ? `<span class="modal-option-badge">${escapeHtml(opt.badge)}</span>` : ''}
            </div>
            ${opt.active ? '<span class="modal-option-check">✓</span>' : ''}
        `;
        if (!opt.disabled) {
            div.addEventListener('click', () => {
                haptic(12);
                onSelect(opt.name);
                closeModal();
            });
        }
        modalList.appendChild(div);
    });
    modalOverlay.classList.add('show');
}

function closeModal() {
    modalOverlay.classList.remove('show');
}

modalOverlay.onclick = (e) => {
    if (e.target === modalOverlay) closeModal();
};

modeBtn.addEventListener('click', () => {
    haptic(10);
    const isReview = /审查|review|plan/i.test(currentMode);
    const modeItems = [
        { name: '极速 (Turbo)', badge: '默认自动运行命令，高效流畅', active: !isReview, disabled: false },
        { name: '请求审查 (Review)', badge: '每条关键命令前均请求人工审批', active: isReview, disabled: false }
    ];
    openModal('切换执行权限模式', modeItems, async (mode) => {
        modeText.textContent = '切换中...';
        try {
            const res = await fetchWithAuth('/set-mode', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode })
            });
            const data = await res.json();
            if (data.success) {
                currentMode = mode;
                const nextReview = mode.includes('审查');
                modeText.textContent = nextReview ? '审查模式' : '极速 (Turbo)';
                modeBtn.classList.toggle('active', nextReview);
                showToast(`已切换至 ${modeText.textContent}`, 'success');
            } else {
                showToast('切换失败: ' + (data.error || '未知错误'), 'error');
                modeText.textContent = isReview ? '审查模式' : '极速 (Turbo)';
            }
        } catch (e) {
            modeText.textContent = isReview ? '审查模式' : '极速 (Turbo)';
            showToast('模式切换请求失败', 'error');
        }
    });
});

modelBtn.addEventListener('click', async () => {
    haptic(10);
    let modelsToDisplay = FALLBACK_MODELS.map(m => ({
        ...m,
        active: currentModel.toLowerCase().includes(m.name.toLowerCase())
    }));

    try {
        const res = await fetchWithAuth('/models');
        const data = await res.json();
        if (data.success && Array.isArray(data.models) && data.models.length > 0) {
            modelsToDisplay = data.models;
        }
    } catch (e) {}

    openModal('切换 AI 模型引擎', modelsToDisplay, async (model) => {
        const prev = modelText.textContent;
        modelText.textContent = '切换中...';
        try {
            const res = await fetchWithAuth('/set-model', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model })
            });
            const data = await res.json();
            if (data.success) {
                currentModel = model;
                modelText.textContent = model;
                showToast(`已切换模型：${model}`, 'success');
                setTimeout(fetchAppState, 500);
            } else {
                showToast('切换失败: ' + (data.error || '未知错误'), 'error');
                modelText.textContent = prev;
            }
        } catch (e) {
            modelText.textContent = prev;
            showToast('模型切换请求失败', 'error');
        }
    });
});

// --- Viewport / Keyboard Handling (Android + iOS Rock-Solid Pinning) ---
let baseViewportHeight = Math.max(window.innerHeight || 0, document.documentElement.clientHeight || 0, 600);
let wasKeyboardOpen = false;
let keyboardSyncTimers = [];

function updateFabOffset() {
    const bottomPanel = document.getElementById('bottomPanel');
    if (bottomPanel) {
        const h = bottomPanel.offsetHeight || 110;
        document.documentElement.style.setProperty('--fab-bottom', (h + 14) + 'px');
    }
}

let lastAppliedVh = -1;
let lastAppliedVTop = -1;
let lastAppliedKbOpen = null;
let viewportSyncRaf = 0;

function syncVisualViewport() {
    const vv = window.visualViewport;
    const rawH = vv ? vv.height : window.innerHeight;
    const rawTop = vv ? vv.offsetTop : 0;
    const vh = Math.max(220, Math.round(rawH));
    const vTop = Math.max(0, Math.round(rawTop));

    if (!vv || (vv.scale <= 1.02 && vh > baseViewportHeight)) {
        baseViewportHeight = vh;
    }

    const activeEl = document.activeElement;
    const isTextFocused = !!(activeEl && (
        activeEl.tagName === 'TEXTAREA' ||
        (activeEl.tagName === 'INPUT' && !['button', 'submit', 'checkbox', 'radio'].includes(activeEl.type))
    ));
    const heightDrop = baseViewportHeight - vh;
    const isKbOpen = isTextFocused && heightDrop > 110;

    // Skip expensive :root style writes and layout recalculations if viewport metrics didn't actually change
    if (vh === lastAppliedVh && vTop === lastAppliedVTop && isKbOpen === lastAppliedKbOpen) {
        return;
    }

    if (vh !== lastAppliedVh) {
        lastAppliedVh = vh;
        document.documentElement.style.setProperty('--app-height', vh + 'px');
    }
    if (vTop !== lastAppliedVTop) {
        lastAppliedVTop = vTop;
        document.documentElement.style.setProperty('--vv-top', vTop + 'px');
    }
    if (isKbOpen !== lastAppliedKbOpen) {
        lastAppliedKbOpen = isKbOpen;
        document.body.classList.toggle('keyboard-open', isKbOpen);
    }
    lastViewportChangeAt = Date.now();

    // Only reset window layout scroll when keyboard is closed and visualViewport is at top
    if (!isKbOpen && vTop === 0 && (window.scrollY !== 0 || window.scrollX !== 0)) {
        window.scrollTo(0, 0);
    }

    // Only keep chat at bottom when keyboard first opens AND user was already near bottom before shrink
    if (isKbOpen && !wasKeyboardOpen && activeEl === messageInput) {
        const effectiveGap = chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight - Math.max(0, heightDrop);
        if (!scrollToBottomBtn.classList.contains('show') || effectiveGap < 160) {
            scrollToBottom(false);
        }
    }

    if (isKbOpen !== wasKeyboardOpen) {
        wasKeyboardOpen = isKbOpen;
        resizeTextarea();
    } else {
        wasKeyboardOpen = isKbOpen;
        updateFabOffset();
    }
}

function scheduleViewportSyncRaf() {
    if (viewportSyncRaf) return;
    viewportSyncRaf = requestAnimationFrame(() => {
        viewportSyncRaf = 0;
        syncVisualViewport();
    });
}

function scheduleKeyboardSyncs() {
    keyboardSyncTimers.forEach(clearTimeout);
    keyboardSyncTimers = [
        setTimeout(syncVisualViewport, 60),
        setTimeout(syncVisualViewport, 220),
        setTimeout(syncVisualViewport, 420)
    ];
}

if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', scheduleViewportSyncRaf);
    window.visualViewport.addEventListener('scroll', scheduleViewportSyncRaf);
}
window.addEventListener('resize', scheduleViewportSyncRaf);

messageInput.addEventListener('focus', scheduleKeyboardSyncs);
messageInput.addEventListener('blur', () => {
    setTimeout(syncVisualViewport, 80);
});
if (historySearchInput) {
    historySearchInput.addEventListener('focus', scheduleKeyboardSyncs);
    historySearchInput.addEventListener('blur', () => setTimeout(syncVisualViewport, 80));
}

syncVisualViewport();

if (imageModalClose && imageModalOverlay) {
    const closeImgModal = () => {
        imageModalOverlay.classList.remove('show');
        if (imageModalImg) imageModalImg.removeAttribute('src');
    };
    imageModalClose.addEventListener('click', closeImgModal);
    imageModalOverlay.addEventListener('click', (e) => {
        if (e.target === imageModalOverlay) closeImgModal();
    });
}

// --- Remote Click Logic (Thinking/Thought + Chinese Step Toggles + Approvals + Image Zoom) ---
chatContainer.addEventListener('click', async (e) => {
    const clickedImg = e.target.closest('img');
    if (clickedImg && clickedImg.src && imageModalOverlay && imageModalImg && clickedImg.naturalWidth > 48) {
        e.preventDefault();
        imageModalImg.src = clickedImg.src;
        imageModalOverlay.classList.add('show');
        return;
    }

    const link = e.target.closest('a');
    if (link) {
        e.preventDefault();
        const href = link.getAttribute('href') || '';
        if (href.startsWith('/c/') || href.includes('conversationId')) {
            const convId = href.split('/c/')[1]?.split('?')[0];
            if (convId) {
                link.style.opacity = '0.5';
                setTimeout(() => link.style.opacity = '1', 300);
                fetchWithAuth(`/c/${convId}`).then(() => {
                    showToast('正在同步目标会话...', 'info', 1400);
                    setTimeout(loadSnapshot, 600);
                    setTimeout(loadSnapshot, 1500);
                    setTimeout(fetchAppState, 1600);
                }).catch(console.error);
            }
        }
        return;
    }

    const target = e.target.closest('div, span, p, summary, button, details');
    if (!target) return;

    const text = target.innerText || '';
    const isUiToggle = /Thought|Thinking|Worked for|Edited|\d+\s+file|已工作|思考|评审|已修改|加载更早的消息/i.test(text) && text.length < 500;

    if (isUiToggle) {
        haptic(8);
        target.style.opacity = '0.5';
        setTimeout(() => target.style.opacity = '1', 300);

        const firstLine = text.split('\n')[0].trim();
        const allElements = chatContainer.querySelectorAll(target.tagName.toLowerCase());
        let tapIndex = 0;
        for (let i = 0; i < allElements.length; i++) {
            const el = allElements[i];
            const elText = el.innerText || '';
            const elFirstLine = elText.split('\n')[0].trim();
            if (/Thought|Thinking|Worked for|Edited|\d+\s+file|已工作|思考|评审|已修改|加载更早的消息/i.test(elText) && elText.length < 500 && elFirstLine === firstLine) {
                if (el === target || el.contains(target)) break;
                tapIndex++;
            }
        }

        try {
            await fetchWithAuth('/remote-click', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    selector: target.tagName.toLowerCase(),
                    index: tapIndex,
                    textContent: firstLine
                })
            });
            setTimeout(loadSnapshot, 400);
            setTimeout(loadSnapshot, 900);
        } catch (err) {}
        return;
    }

    const btn = e.target.closest('button, [role="button"]');
    if (btn) {
        const btnText = (btn.innerText || '').trim();
        const actionKeywords = [
            'Allow this conversation', 'Always allow', 'Allow once',
            'Review changes', 'Review',
            'Confirm', 'Accept', 'Reject', 'Discard',
            'Allow', 'Deny', 'Apply', 'Save', 'Run',
            'Yes', 'No',
            '允许', '拒绝', '确认', '应用', '保存', '运行', '查看修改', '总是允许', '仅允许一次', '评审', '接受', '丢弃', '是', '否'
        ];

        const btnTextLower = btnText.toLowerCase();
        const matchedKeyword = actionKeywords.find(kw => btnTextLower.includes(kw.toLowerCase()));
        if (matchedKeyword) {
            haptic(15);
            btn.style.opacity = '0.5';
            setTimeout(() => btn.style.opacity = '1', 300);

            const allButtons = Array.from(chatContainer.querySelectorAll('button, [role="button"]'));
            const matchingButtons = allButtons.filter(b =>
                (b.innerText || '').toLowerCase().includes(matchedKeyword.toLowerCase())
            );
            const btnIndex = matchingButtons.indexOf(btn);

            try {
                const rcRes = await fetchWithAuth('/remote-click', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        selector: 'button, [role="button"]',
                        index: btnIndex >= 0 ? btnIndex : 0,
                        textContent: matchedKeyword,
                        scope: 'auto'
                    })
                });
                const rcData = await rcRes.json().catch(() => ({}));
                if (rcData.success) {
                    showToast(`已触发：${btnText.substring(0, 14)}`, 'success', 1400);
                } else {
                    showToast(rcData.error || '远程操作失败，请刷新确认', 'error', 2000);
                }
                setTimeout(loadSnapshot, 400);
                setTimeout(loadSnapshot, 1000);
                setTimeout(fetchAppState, 1200);
            } catch (err) {}
        }
        return;
    }

    // Natural mobile habit: tapping non-interactive chat content dismisses soft keyboard
    if (document.activeElement === messageInput) {
        const sel = window.getSelection ? window.getSelection().toString() : '';
        if (!sel && !e.target.closest('button, a, input, textarea, [role="button"], .mobile-code-toolbar')) {
            messageInput.blur();
        }
    }
});

// --- Event Listeners ---
if (enableHttpsBtn) enableHttpsBtn.addEventListener('click', enableHttps);
if (dismissSslBtn) dismissSslBtn.addEventListener('click', dismissSslBanner);
if (closeModalBtn) closeModalBtn.addEventListener('click', closeModal);
if (backHistoryBtn) backHistoryBtn.addEventListener('click', hideChatHistory);

quickActionChips.forEach(chip => {
    if (chip.id === 'enterModeBtn') return;
    chip.addEventListener('click', () => {
        const insertText = chip.getAttribute('data-insert');
        if (insertText) {
            insertTextAtCursor(insertText);
            return;
        }
        const actionText = chip.getAttribute('data-action') || chip.innerText.trim();
        quickAction(actionText);
    });
});

if (historyList) {
    historyList.addEventListener('click', (e) => {
        const newBtn = e.target.closest('.history-new-btn');
        const card = e.target.closest('.history-card');
        if (newBtn) {
            hideChatHistory();
            startNewChat();
        } else if (card) {
            const id = card.getAttribute('data-id');
            const title = card.getAttribute('data-title');
            hideChatHistory();
            selectChat(id || title);
        }
    });
}

chatContent.addEventListener('click', (e) => {
    if (e.target.closest('#newChatFromEmptyBtn')) {
        startNewChat();
    }
});

// --- Multi-Window Switcher, Model Quota & Git Diff Inspector ---
const QUOTA_CACHE_KEY = 'ag_cached_quota';

function updateQuotaChip(groups) {
    if (!quotaText || !Array.isArray(groups) || groups.length === 0) return;
    try { localStorage.setItem(QUOTA_CACHE_KEY, JSON.stringify(groups)); } catch (e) {}
    const preferClaude = /claude|gpt|sonnet|opus/i.test(currentModel || '');
    const preferredGroup = groups.find(g => preferClaude ? /claude|gpt/i.test(g.name) : /gemini/i.test(g.name)) || groups[0];
    const items = preferredGroup?.items || [];
    const fiveHour = items.find(i => /5h|5\s*小时/i.test(i.label));
    const weekly = items.find(i => /week|周/i.test(i.label));

    const parts = [];
    if (fiveHour && typeof fiveHour.percent === 'number') parts.push(`5h ${fiveHour.percent}%`);
    if (weekly && typeof weekly.percent === 'number') parts.push(`周 ${weekly.percent}%`);
    if (parts.length === 0 && items[0] && typeof items[0].percent === 'number') {
        parts.push(`额度 ${items[0].percent}%`);
    }

    if (parts.length > 0) {
        quotaText.textContent = parts.join(' · ');
        const minPct = Math.min(...parts.map((_, idx) => {
            const target = idx === 0 ? (fiveHour || items[0]) : (weekly || items[0]);
            return typeof target?.percent === 'number' ? target.percent : 100;
        }));
        if (quotaBtn) {
            quotaBtn.classList.remove('good', 'warn', 'low');
            quotaBtn.classList.add(minPct < 20 ? 'low' : (minPct < 50 ? 'warn' : 'good'));
        }
    }
}

async function fetchQuotaSummary(forceRefresh = false) {
    if (document.hidden) return null;
    try {
        const res = await fetchWithAuth(forceRefresh ? '/quota?refresh=1' : '/quota');
        const data = await res.json();
        if (data.success && Array.isArray(data.groups) && data.groups.length > 0) {
            updateQuotaChip(data.groups);
            return data;
        }
    } catch (e) {}
    return null;
}

// Restore last known quota instantly on startup before live fetch finishes
try {
    const cachedQ = JSON.parse(localStorage.getItem(QUOTA_CACHE_KEY) || 'null');
    if (Array.isArray(cachedQ) && cachedQ.length > 0) {
        updateQuotaChip(cachedQ);
    }
} catch (e) {}

async function openQuotaModal(forceRefresh = false) {
    modalTitle.textContent = '模型剩余额度';
    modalList.innerHTML = `<div class="history-state-container" style="padding:28px 12px;"><div class="history-spinner"></div><div class="history-state-text">正在读取桌面端用量...</div></div>`;
    modalOverlay.classList.add('show');

    try {
        const res = await fetchWithAuth(forceRefresh ? '/quota?refresh=1' : '/quota');
        const data = await res.json();
        if (!data.success || !Array.isArray(data.groups) || data.groups.length === 0) {
            modalList.innerHTML = `
                <div class="history-state-container" style="padding:24px 12px;">
                    <div class="history-state-icon">📊</div>
                    <div class="history-state-title">${data.busy ? '智能体正在生成中' : '暂未读取到额度数据'}</div>
                    <div class="history-state-desc">${escapeHtml(data.error || '请等待桌面端回复结束后重试')}</div>
                </div>
            `;
            return;
        }

        updateQuotaChip(data.groups);

        const timeLabel = data.updatedAt ? new Date(data.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
        const statusLabel = data.stale ? '生成中 · 显示上次缓存' : (data.cached ? '缓存于 ' + timeLabel : '刚刚更新 ' + timeLabel);

        let html = `
            <div class="quota-meta-bar">
                <span>${escapeHtml(statusLabel)}</span>
                <button class="quota-refresh-btn" id="refreshQuotaBtn" type="button">🔄 立即刷新</button>
            </div>
        `;

        data.groups.forEach(group => {
            html += `<div class="quota-group-card"><div class="quota-group-title">${escapeHtml(group.name)}</div>`;
            (group.items || []).forEach(item => {
                const pct = Math.max(0, Math.min(100, Number(item.percent || 0)));
                const barCls = pct < 20 ? 'low' : (pct < 50 ? 'warn' : '');
                html += `
                    <div class="quota-item-row">
                        <div class="quota-item-head">
                            <span class="quota-item-label">${escapeHtml(item.label)}</span>
                            <span class="quota-item-pct">${escapeHtml(item.rawPercent || `${pct}%`)}</span>
                        </div>
                        <div class="quota-bar-track">
                            <div class="quota-bar-fill ${barCls}" style="width:${pct}%"></div>
                        </div>
                        ${item.resetIn ? `<div class="quota-item-reset">${escapeHtml(item.resetIn)}</div>` : ''}
                    </div>
                `;
            });
            html += `</div>`;
        });

        modalList.innerHTML = html;
        const rBtn = document.getElementById('refreshQuotaBtn');
        if (rBtn) {
            rBtn.addEventListener('click', () => {
                haptic(10);
                openQuotaModal(true);
            });
        }
    } catch (err) {
        modalList.innerHTML = `
            <div class="history-state-container" style="padding:24px 12px;">
                <div class="history-state-icon">⚠️</div>
                <div class="history-state-title">读取额度失败</div>
                <div class="history-state-desc">请确认桌面端服务连接正常</div>
            </div>
        `;
    }
}

if (quotaBtn) {
    quotaBtn.addEventListener('click', () => {
        haptic(10);
        openQuotaModal(false);
    });
}

if (windowBtn) {
    windowBtn.addEventListener('click', async () => {
        haptic(10);
        try {
            const res = await fetchWithAuth('/targets');
            const data = await res.json();
            const targets = data.targets || [];
            if (targets.length === 0) {
                showToast('未检测到可用的 Antigravity 窗口', 'info');
                return;
            }
            const items = targets.map(t => ({
                name: t.title || `端口 ${t.port}`,
                badge: `端口 ${t.port} · ${t.active ? '当前连接中' : '点击切换'}`,
                active: !!t.active,
                disabled: false,
                wsUrl: t.wsUrl
            }));
            modalTitle.textContent = '切换桌面工作区窗口';
            modalList.innerHTML = '';
            items.forEach(opt => {
                const div = document.createElement('div');
                div.className = `modal-option${opt.active ? ' active' : ''}`;
                div.innerHTML = `
                    <div class="modal-option-main">
                        <span class="modal-option-name">${escapeHtml(opt.name)}</span>
                        <span class="modal-option-badge">${escapeHtml(opt.badge)}</span>
                    </div>
                    ${opt.active ? '<span class="modal-option-check">✓</span>' : ''}
                `;
                div.addEventListener('click', async () => {
                    haptic(12);
                    closeModal();
                    if (opt.active) return;
                    try {
                        showToast('正在切换窗口...', 'info', 1400);
                        const swRes = await fetchWithAuth('/switch-target', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ wsUrl: opt.wsUrl })
                        });
                        const swData = await swRes.json();
                        if (swData.success) {
                            cachedCssHash = '';
                            cachedHtmlHash = '';
                            if (windowText) windowText.textContent = opt.name.split(' - ')[0].slice(0, 12) || '窗口';
                            setTimeout(() => loadSnapshot(true), 350);
                            setTimeout(fetchAppState, 500);
                            showToast('已切换桌面窗口', 'success');
                        } else {
                            showToast('切换失败: ' + (swData.error || '未知错误'), 'error');
                        }
                    } catch (e) {
                        showToast('切换窗口失败', 'error');
                    }
                });
                modalList.appendChild(div);
            });
            modalOverlay.classList.add('show');
        } catch (err) {
            showToast('读取桌面窗口列表失败', 'error');
        }
    });
}

async function refreshGitBadge() {
    if (!gitDiffText || document.hidden) return;
    try {
        const res = await fetchWithAuth('/git-status');
        const data = await res.json();
        const count = (data.files || []).length;
        gitDiffText.textContent = count > 0 ? `改动(${count})` : '改动';
        if (gitDiffBtn) gitDiffBtn.classList.toggle('active', count > 0);
    } catch (e) {}
}

if (gitDiffBtn) {
    gitDiffBtn.addEventListener('click', async () => {
        haptic(10);
        try {
            const res = await fetchWithAuth('/git-status');
            const data = await res.json();
            if (!data.isGitRepo) {
                showToast('当前工作区不是 Git 仓库', 'info');
                return;
            }
            const files = data.files || [];
            if (gitDiffText) gitDiffText.textContent = files.length > 0 ? `改动(${files.length})` : '改动';
            if (files.length === 0) {
                showToast(`分支 ${data.branch || 'main'} 当前工作区干净无改动`, 'success', 2200);
                return;
            }
            modalTitle.textContent = `代码改动 · ${data.branch} (${files.length})`;
            modalList.innerHTML = '';
            files.forEach(f => {
                const div = document.createElement('div');
                div.className = 'modal-option';
                const statusCls = f.status.includes('?') || f.status.includes('A') ? 'added' : (f.status.includes('D') ? 'deleted' : '');
                const statText = (f.insertions || f.deletions) ? `+${f.insertions} / -${f.deletions}` : '点击查看对比';
                div.innerHTML = `
                    <div class="modal-option-main">
                        <span class="modal-option-name">${escapeHtml(f.path)}</span>
                        <span class="modal-option-badge">${escapeHtml(statText)}</span>
                    </div>
                    <span class="diff-status-badge ${statusCls}">${escapeHtml(f.status)}</span>
                `;
                div.addEventListener('click', async () => {
                    haptic(12);
                    closeModal();
                    try {
                        const dRes = await fetchWithAuth(`/git-diff?file=${encodeURIComponent(f.path)}`);
                        const dData = await dRes.json();
                        if (dData.success) {
                            openDiffModal(f.path, dData.diff);
                        } else {
                            showToast(dData.error || '读取 Diff 失败', 'error');
                        }
                    } catch (e) {
                        showToast('读取文件 Diff 失败', 'error');
                    }
                });
                modalList.appendChild(div);
            });
            modalOverlay.classList.add('show');
        } catch (err) {
            showToast('获取 Git 状态失败', 'error');
        }
    });
}

// --- Init ---
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
        pendingSnapshotUpdate = false;
        if (!ws || ws.readyState === WebSocket.CLOSED) {
            connectWebSocket();
        }
        loadSnapshot();
        fetchAppState();
        refreshGitBadge();
    }
});

connectWebSocket();
fetchAppState();
fetchQuotaSummary(false);
setInterval(fetchAppState, 4000);
checkChatStatus();
refreshGitBadge();
setInterval(() => {
    if (!document.hidden) {
        checkChatStatus();
        refreshGitBadge();
    }
}, 10000);
setInterval(() => {
    if (!document.hidden && !isAgentBusy) {
        fetchQuotaSummary(false);
    }
}, 90000);
