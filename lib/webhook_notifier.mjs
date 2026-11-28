import fs from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CONFIG_PATH = join(__dirname, '..', 'webhook_config.json');

const DEBOUNCE_MS = 30000;
const lastSentAt = new Map();

function readFileConfig() {
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') return parsed;
        }
    } catch {}
    return null;
}

export function detectChannel(url, explicitType = 'auto') {
    const type = String(explicitType || 'auto').trim().toLowerCase();
    if (type && type !== 'auto') return type;
    const u = String(url || '').toLowerCase();
    if (!u) return 'generic';
    if (u.includes('open.feishu.cn') || u.includes('open.larksuite.com')) return 'feishu';
    if (u.includes('oapi.dingtalk.com')) return 'dingtalk';
    if (u.includes('qyapi.weixin.qq.com')) return 'wecom';
    if (u.includes('api.day.app') || u.includes('/bark/')) return 'bark';
    if (u.includes('sctapi.ftqq.com') || u.includes('sc.ftqq.com')) return 'serverchan';
    if (u.includes('pushplus.plus')) return 'pushplus';
    if (u.includes('api.telegram.org')) return 'telegram';
    return 'generic';
}

export function getWebhookConfig() {
    const fileCfg = readFileConfig();
    const enabled = fileCfg
        ? Boolean(fileCfg.enabled)
        : /^(1|true|yes)$/i.test(String(process.env.NOTIFY_WEBHOOK_ENABLED || ''));
    const channel = String(
        (fileCfg ? fileCfg.channel : process.env.NOTIFY_WEBHOOK_TYPE) || 'auto'
    ).trim().toLowerCase();
    const url = String(
        (fileCfg ? fileCfg.url : process.env.NOTIFY_WEBHOOK_URL) || ''
    ).trim();
    const telegramChatId = String(
        (fileCfg ? fileCfg.telegramChatId : process.env.NOTIFY_TELEGRAM_CHAT_ID) || ''
    ).trim();

    return { enabled, channel, url, telegramChatId };
}

export function saveWebhookConfig(input = {}) {
    const prev = getWebhookConfig();
    const next = {
        enabled: input.enabled !== undefined ? Boolean(input.enabled) : prev.enabled,
        channel: String(input.channel !== undefined ? input.channel : prev.channel || 'auto').trim().toLowerCase(),
        url: String(input.url !== undefined ? input.url : prev.url || '').trim(),
        telegramChatId: String(input.telegramChatId !== undefined ? input.telegramChatId : prev.telegramChatId || '').trim(),
        updatedAt: new Date().toISOString()
    };

    if (next.url && !/^https?:\/\//i.test(next.url)) {
        throw new Error('Webhook URL 必须以 http:// 或 https:// 开头');
    }

    fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), 'utf8');
    return next;
}

function buildPayload(channel, title, body, linkUrl, cfg) {
    const text = linkUrl ? `${title}\n${body}\n控制台: ${linkUrl}` : `${title}\n${body}`;
    switch (channel) {
        case 'feishu':
            return {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    msg_type: 'text',
                    content: { text }
                })
            };
        case 'dingtalk':
            return {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    msgtype: 'markdown',
                    markdown: {
                        title,
                        text: `### ${title}\n\n${body}${linkUrl ? `\n\n[打开手机控制台](${linkUrl})` : ''}`
                    }
                })
            };
        case 'wecom':
            return {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    msgtype: 'text',
                    text: { content: text }
                })
            };
        case 'bark':
            return {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title,
                    body,
                    url: linkUrl || undefined,
                    group: 'Antigravity'
                })
            };
        case 'serverchan': {
            const params = new URLSearchParams();
            params.set('title', title);
            params.set('desp', linkUrl ? `${body}\n\n[打开手机控制台](${linkUrl})` : body);
            return {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: params.toString()
            };
        }
        case 'pushplus':
            return {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title,
                    content: linkUrl ? `${body}<br><a href="${linkUrl}">打开手机控制台</a>` : body,
                    template: 'html'
                })
            };
        case 'telegram':
            return {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: cfg.telegramChatId || undefined,
                    text
                })
            };
        default:
            return {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title,
                    body,
                    text,
                    linkUrl: linkUrl || '',
                    timestamp: new Date().toISOString()
                })
            };
    }
}

export async function dispatchWebhook(cfg, title, body, linkUrl = '') {
    if (!cfg || !cfg.url) {
        return { ok: false, skipped: true, reason: 'Webhook URL 未配置' };
    }
    const channel = detectChannel(cfg.url, cfg.channel);
    const reqInit = buildPayload(channel, title, body, linkUrl, cfg);
    const resp = await fetch(cfg.url, {
        ...reqInit,
        signal: AbortSignal.timeout(5000)
    });
    const respText = await resp.text().catch(() => '');
    if (!resp.ok) {
        return { ok: false, status: resp.status, channel, error: respText.slice(0, 200) || `HTTP ${resp.status}` };
    }
    return { ok: true, status: resp.status, channel };
}

export async function sendWebhookNotification(eventType, title, body, linkUrl = '') {
    const cfg = getWebhookConfig();
    if (!cfg.enabled || !cfg.url) return { ok: false, skipped: true };

    const now = Date.now();
    const prev = lastSentAt.get(eventType) || 0;
    if (now - prev < DEBOUNCE_MS) {
        return { ok: false, skipped: true, debounced: true };
    }
    lastSentAt.set(eventType, now);
    try {
        return await dispatchWebhook(cfg, title, body, linkUrl);
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

export async function sendTestWebhook(overrideCfg = null, linkUrl = '') {
    const cfg = overrideCfg ? { ...getWebhookConfig(), ...overrideCfg, enabled: true } : getWebhookConfig();
    if (!cfg.url) {
        throw new Error('请先填写 Webhook 地址');
    }
    return dispatchWebhook(
        cfg,
        'Antigravity 掌上控制台 · 测试通知',
        '手机端离屏推送通道配置成功，长任务完成或待审批时将即时推送。',
        linkUrl
    );
}
