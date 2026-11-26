#!/usr/bin/env node
import 'dotenv/config';
import express from 'express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { WebSocketServer } from 'ws';
import http from 'http';
import https from 'https';
import fs from 'fs';
import os from 'os';
import WebSocket from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { inspectUI } from './ui_inspector.js';
import { execSync, execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORTS = [9000, 9001, 9002, 9003];
const POLL_INTERVAL = 1500; // 1.5 seconds (balanced responsiveness & mobile memory)
const SERVER_PORT = process.env.PORT || 3000;
const APP_PASSWORD = process.env.APP_PASSWORD || 'antigravity';
const AUTH_COOKIE_NAME = 'ag_auth_token';

// Security warning for default credentials
if (APP_PASSWORD === 'antigravity') {
    console.warn('\n\x1b[33m%s\x1b[0m', '⚠️  SECURITY WARNING: Using default APP_PASSWORD ("antigravity").');
    console.warn('\x1b[33m%s\x1b[0m', '   Set a strong APP_PASSWORD in your .env file for production use.\n');
}

// Note: hashString is defined later, so we'll initialize the token inside createServer or use a simple string for now.
let AUTH_TOKEN = 'ag_default_token';


// Shared CDP connection
let cdpConnection = null;
let currentTargetUrl = null;
let lastSnapshot = null;
let lastSnapshotHash = null;
let cachedCSSHash = null;
let cachedModels = null;
let cachedModelsAt = 0;
let cachedQuota = null;
let cachedQuotaAt = 0;
let isUiMenuBusy = false;

// Kill any existing process on the server port (prevents EADDRINUSE)
function killPortProcess(port) {
    try {
        if (process.platform === 'win32') {
            // Windows: Find PID using netstat and kill it
            const result = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
            const lines = result.trim().split('\n');
            const pids = new Set();
            for (const line of lines) {
                const parts = line.trim().split(/\s+/);
                const pid = parts[parts.length - 1];
                if (pid && pid !== '0') pids.add(pid);
            }
            for (const pid of pids) {
                try {
                    execSync(`taskkill /PID ${pid} /F`, { stdio: 'pipe' });
                    console.log(`⚠️  Killed existing process on port ${port} (PID: ${pid})`);
                } catch (e) { /* Process may have already exited */ }
            }
        } else {
            // Linux/macOS: Use lsof and kill
            const result = execSync(`lsof -ti:${port}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
            const pids = result.trim().split('\n').filter(p => p);
            for (const pid of pids) {
                try {
                    execSync(`kill -9 ${pid}`, { stdio: 'pipe' });
                    console.log(`⚠️  Killed existing process on port ${port} (PID: ${pid})`);
                } catch (e) { /* Process may have already exited */ }
            }
        }
        // Small delay to let the port be released
        return new Promise(resolve => setTimeout(resolve, 500));
    } catch (e) {
        // No process found on port - this is fine
        return Promise.resolve();
    }
}

// Get local IP address for mobile access
// Prefers physical Wi-Fi/LAN adapters over virtual adapters (VMware/WSL/Docker/Clash TUN)
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    const candidates = [];

    for (const name of Object.keys(interfaces)) {
        const lowerName = name.toLowerCase();
        const isVirtual = /vmware|vmnet|virtualbox|vbox|vethernet|wsl|docker|hyper-v|meta|clash|tun|tap|loopback/i.test(lowerName);
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                const rangeScore = iface.address.startsWith('192.168.') ? 1 :
                    iface.address.startsWith('10.') ? 2 :
                        iface.address.startsWith('172.') ? 3 : 4;
                candidates.push({
                    address: iface.address,
                    name: name,
                    priority: (isVirtual ? 10 : 0) + rangeScore
                });
            }
        }
    }

    candidates.sort((a, b) => a.priority - b.priority);
    return candidates.length > 0 ? candidates[0].address : 'localhost';
}

// Helper: HTTP GET JSON
function getJson(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
            });
        }).on('error', reject);
    });
}

// Only allow real local Antigravity windows (exclude built-in browser web tabs like github.com)
function isAntigravityTargetUrl(url) {
    if (!url || typeof url !== 'string') return false;
    if (url.startsWith('data:') || url.startsWith('devtools:') || url.startsWith('chrome-extension:')) return false;
    return /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/i.test(url)
        || url.includes('workbench.html')
        || url.includes('jetski');
}

// List all discoverable Antigravity page targets across debug ports
async function listCDPTargets() {
    const found = [];
    for (const port of PORTS) {
        try {
            const list = await getJson(`http://127.0.0.1:${port}/json/list`);
            for (const t of list) {
                if (t.type !== 'page' || !t.webSocketDebuggerUrl) continue;
                const url = t.url || '';
                if (!isAntigravityTargetUrl(url)) continue;
                found.push({
                    id: t.id,
                    port,
                    title: (t.title || 'Antigravity Window').trim(),
                    url,
                    wsUrl: t.webSocketDebuggerUrl,
                    active: t.webSocketDebuggerUrl === currentTargetUrl
                });
            }
        } catch (e) {}
    }
    return found;
}

// Find Antigravity CDP endpoint
async function discoverCDP() {
    const errors = [];
    for (const port of PORTS) {
        try {
            const list = await getJson(`http://127.0.0.1:${port}/json/list`);

            // Priority 0: Antigravity 2.0 Conversation Window (local loopback only)
            const ag2 = list.find(t =>
                t.type === 'page' &&
                t.webSocketDebuggerUrl &&
                isAntigravityTargetUrl(t.url) &&
                (t.url.includes('/c/') || t.title?.includes('Antigravity'))
            );
            if (ag2) {
                console.log('Found Antigravity 2.0 target:', ag2.title);
                currentTargetUrl = ag2.webSocketDebuggerUrl;
                return { port, url: ag2.webSocketDebuggerUrl };
            }

            // Priority 0.5: Local Antigravity Launchpad / Session Root
            const localPage = list.find(t =>
                t.type === 'page' &&
                t.webSocketDebuggerUrl &&
                /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/i.test(t.url || '')
            );
            if (localPage) {
                console.log('Found local Antigravity target:', localPage.title);
                currentTargetUrl = localPage.webSocketDebuggerUrl;
                return { port, url: localPage.webSocketDebuggerUrl };
            }

            // Priority 1: Standard Workbench (The main window)
            const workbench = list.find(t => t.url?.includes('workbench.html') || (isAntigravityTargetUrl(t.url) && t.title?.includes('workbench')));
            if (workbench && workbench.webSocketDebuggerUrl) {
                console.log('Found Workbench target:', workbench.title);
                currentTargetUrl = workbench.webSocketDebuggerUrl;
                return { port, url: workbench.webSocketDebuggerUrl };
            }

            // Priority 2: Jetski/Launchpad (Fallback)
            const jetski = list.find(t => t.url?.includes('jetski') || (isAntigravityTargetUrl(t.url) && t.title === 'Launchpad'));
            if (jetski && jetski.webSocketDebuggerUrl) {
                console.log('Found Jetski/Launchpad target:', jetski.title);
                currentTargetUrl = jetski.webSocketDebuggerUrl;
                return { port, url: jetski.webSocketDebuggerUrl };
            }
        } catch (e) {
            errors.push(`${port}: ${e.message}`);
        }
    }
    const errorSummary = errors.length ? `Errors: ${errors.join(', ')}` : 'No ports responding';
    throw new Error(`CDP not found. ${errorSummary}`);
}

// Switch active CDP connection to another Antigravity window
async function switchCDPTarget(wsUrl) {
    if (!wsUrl || !/^ws:\/\/(127\.0\.0\.1|localhost):\d+\//.test(wsUrl)) {
        throw new Error('Invalid local CDP WebSocket URL');
    }
    const oldConn = cdpConnection;
    const nextConn = await connectCDP(wsUrl);
    cdpConnection = nextConn;
    currentTargetUrl = wsUrl;
    lastSnapshot = null;
    lastSnapshotHash = null;
    cachedModels = null;
    cachedModelsAt = 0;
    cachedQuota = null;
    cachedQuotaAt = 0;
    if (oldConn?.ws && oldConn.ws !== nextConn.ws) {
        try { oldConn.ws.close(); } catch (e) {}
    }
    return nextConn;
}

// Connect to CDP
async function connectCDP(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
        ws.on('open', resolve);
        ws.on('error', reject);
    });

    ws.on('error', (err) => {
        console.warn('⚠️ CDP WebSocket error:', err.message);
    });

    let idCounter = 1;
    const pendingCalls = new Map(); // Track pending calls by ID
    const contexts = [];
    const CDP_CALL_TIMEOUT = 30000; // 30 seconds timeout

    // Single centralized message handler (fixes MaxListenersExceeded warning)
    ws.on('message', (msg) => {
        try {
            const data = JSON.parse(msg);

            // Handle CDP method responses
            if (data.id !== undefined && pendingCalls.has(data.id)) {
                const { resolve, reject, timeoutId } = pendingCalls.get(data.id);
                clearTimeout(timeoutId);
                pendingCalls.delete(data.id);

                if (data.error) reject(data.error);
                else resolve(data.result);
            }

            // Handle execution context events
            if (data.method === 'Runtime.executionContextCreated') {
                contexts.push(data.params.context);
            } else if (data.method === 'Runtime.executionContextDestroyed') {
                const id = data.params.executionContextId;
                const idx = contexts.findIndex(c => c.id === id);
                if (idx !== -1) contexts.splice(idx, 1);
            } else if (data.method === 'Runtime.executionContextsCleared') {
                contexts.length = 0;
            }
        } catch (e) { }
    });

    const call = (method, params) => new Promise((resolve, reject) => {
        const id = idCounter++;

        // Setup timeout to prevent memory leaks from never-resolved calls
        const timeoutId = setTimeout(() => {
            if (pendingCalls.has(id)) {
                pendingCalls.delete(id);
                reject(new Error(`CDP call ${method} timed out after ${CDP_CALL_TIMEOUT}ms`));
            }
        }, CDP_CALL_TIMEOUT);

        pendingCalls.set(id, { resolve, reject, timeoutId });
        ws.send(JSON.stringify({ id, method, params }));
    });

    await call("Runtime.enable", {});
    await new Promise(r => setTimeout(r, 1000));

    return { ws, call, contexts };
}

// Capture chat snapshot
async function captureSnapshot(cdp) {
    const CAPTURE_SCRIPT = `(async () => {
        const scrollCandidates = Array.from(document.querySelectorAll('[data-testid="autoscroll-viewport"], .overflow-y-auto, [data-scroll-area]'));
        const cascade = document.querySelector('[data-testid="autoscroll-viewport"]') ||
                        document.getElementById('conversation') || 
                        document.getElementById('chat') || 
                        document.getElementById('cascade') ||
                        scrollCandidates.find(s => s.scrollHeight > s.clientHeight && s.clientHeight > 200) ||
                        scrollCandidates[0] ||
                        document.getElementById('root') ||
                        document.body;
        if (!cascade) {
            const body = document.body;
            const childIds = Array.from(body.children).map(c => c.id).filter(id => id).join(', ');
            return { error: 'chat container not found', debug: { hasBody: !!body, availableIds: childIds } };
        }
        
        const cascadeStyles = window.getComputedStyle(cascade);
        
        // Find the main scrollable container
        const scrollContainer = cascade.matches('[data-testid="autoscroll-viewport"]')
            ? cascade
            : (cascade.querySelector('[data-testid="autoscroll-viewport"], .overflow-y-auto, [data-scroll-area]') || cascade);
        const scrollInfo = {
            scrollTop: scrollContainer.scrollTop,
            scrollHeight: scrollContainer.scrollHeight,
            clientHeight: scrollContainer.clientHeight,
            scrollPercent: scrollContainer.scrollTop / (scrollContainer.scrollHeight - scrollContainer.clientHeight) || 0
        };
        
        // Mark fixed/absolute elements in the original DOM before cloning
        const candidates = cascade.querySelectorAll('*');
        candidates.forEach(el => {
            try {
                const pos = window.getComputedStyle(el).position;
                if (pos === 'fixed' || pos === 'absolute') {
                    el.setAttribute('data-ag-rem', 'true');
                }
            } catch(e) {}
        });

        // Clone cascade to modify it without affecting the original
        const clone = cascade.cloneNode(true);
        
        // Clean up markers from the original DOM immediately after cloning
        candidates.forEach(el => el.removeAttribute('data-ag-rem'));

        // Optimize container padding and neutralize desktop size-containment/masks for mobile viewport
        const vpTargets = [clone, ...clone.querySelectorAll('[data-testid="autoscroll-viewport"]')];
        vpTargets.forEach(vp => {
            if (vp && vp.style) {
                vp.style.paddingLeft = '12px';
                vp.style.paddingRight = '12px';
                vp.style.maskImage = 'none';
                vp.style.webkitMaskImage = 'none';
                vp.style.containerType = 'normal';
                vp.style.height = 'auto';
                vp.style.minHeight = '0';
                vp.style.overflow = 'visible';
            }
        });
        
        // Aggressively remove the entire interaction/input/review area
        try {
            const interactionSelectors = [
                '.surface-composer',
                '.surface-composer-card',
                '.relative.flex.flex-col.gap-8',
                '.flex.grow.flex-col.justify-start.gap-8',
                'div[class*="interaction-area"]',
                '.p-1.bg-gray-500\\/10',
                '.outline-solid.justify-between',
                '[contenteditable="true"]',
                '[data-lexical-editor]',
                'form',
                '.mx-8.mb-8',
                '.mx-4.mb-4',
                '.fixed.bottom-0',
                '.absolute.bottom-0'
            ];

            interactionSelectors.forEach(selector => {
                clone.querySelectorAll(selector).forEach(el => {
                    try {
                        const text = (el.innerText || '').toLowerCase();
                        const isActionArea = text.includes('allow') || text.includes('deny') || 
                                           text.includes('review') || text.includes('run') ||
                                           text.includes('confirm') || text.includes('允许') ||
                                           text.includes('拒绝') || text.includes('确认') ||
                                           text.includes('运行') || text.includes('评审');
                        
                        const isEditor = el.getAttribute('contenteditable') === 'true' || 
                                       el.hasAttribute('data-lexical-editor') ||
                                       el.classList?.contains('surface-composer') ||
                                       el.classList?.contains('surface-composer-card') ||
                                       text.includes('ask anything') ||
                                       text.includes('to mention') ||
                                       text.includes('提问任何问题');
                        if (!isEditor && isActionArea && selector !== '[contenteditable="true"]') {
                            return; // Protect action bars
                        }

                        // For the editor or its container, remove it
                        // Go up to find the main floating box if it's a deep selector
                        let targetToRemove = el;
                        if (isEditor || selector.includes('bottom-0')) {
                             // Find the common container for the input box (usually has margins or padding)
                             let parent = el.parentElement;
                             for (let i = 0; i < 4; i++) {
                                 if (!parent || parent === clone) break;
                                 const pCls = (parent.className || '').toString();
                                 if (pCls.includes('mx-') || pCls.includes('mb-') || pCls.includes('bg-')) {
                                     targetToRemove = parent;
                                 }
                                 parent = parent.parentElement;
                             }
                        }
                        
                        if (targetToRemove && targetToRemove !== clone) {
                            targetToRemove.remove();
                        } else {
                            el.remove();
                        }
                    } catch(e) {}
                });
            });

            // 2. Text-based cleanup for stray status bars and redundant desktop inputs
            const allElements = clone.querySelectorAll('*');
            allElements.forEach(el => {
                try {
                    const text = (el.innerText || '').toLowerCase();
                    const placeholder = (el.getAttribute('placeholder') || '').toLowerCase();
                    const isInputPlaceholder = text.includes('ask anything') || 
                                              text.includes('to mention') || 
                                              text.includes('提问任何问题') ||
                                              placeholder.includes('ask anything') ||
                                              placeholder.includes('提问任何问题');
                    
                    if (isInputPlaceholder && text.length < 150) {
                        let container = el;
                        for (let i = 0; i < 5; i++) {
                            if (!container.parentElement || container.parentElement === clone) break;
                            const cls = (container.className || '').toString();
                            if (cls.includes('flex-col') || cls.includes('input') || cls.includes('area') || cls.includes('composer')) {
                                container.remove();
                                return;
                            }
                            container = container.parentElement;
                        }
                        el.remove();
                        return;
                    }
                } catch(e) {}
            });

            // 3. NUCLEAR: If any editor or redundant UI remains, remove its entire branch
            const redundantElements = clone.querySelectorAll('.surface-composer, .surface-composer-card, [contenteditable="true"], [data-lexical-editor], [role="textbox"], form, .mx-8.mb-8, .mx-4.mb-4');
            redundantElements.forEach(el => {
                try {
                    let branch = el;
                    while (branch.parentElement && branch.parentElement !== clone) {
                        const p = branch.parentElement;
                        const pCls = (p.className || '').toString().toLowerCase();
                        if (pCls.includes('message') || pCls.includes('bubble') || pCls.includes('conversation')) break;
                        branch = p;
                    }
                    if (branch && branch !== clone) branch.remove();
                    else el.remove();
                } catch(e) {}
            });

            // 4. Force hide any fixed/absolute elements (desktop overlays)
            clone.querySelectorAll('[data-ag-rem]').forEach(el => {
                try {
                    const text = (el.innerText || '').toLowerCase();
                    if (text.includes('allow') || text.includes('deny') || text.includes('review') || text.includes('允许') || text.includes('拒绝') || text.includes('确认') || text.includes('运行') || text.includes('评审')) {
                        el.removeAttribute('data-ag-rem');
                        return;
                    }
                    el.remove();
                } catch(e) {}
            });
        } catch (globalErr) { }

        // Convert local images to base64
        const images = clone.querySelectorAll('img');
        const promises = Array.from(images).map(async (img) => {
            const rawSrc = img.getAttribute('src');
            if (rawSrc && (rawSrc.startsWith('/') || rawSrc.startsWith('vscode-file:')) && !rawSrc.startsWith('data:')) {
                try {
                    const res = await fetch(rawSrc);
                    const blob = await res.blob();
                    await new Promise(r => {
                        const reader = new FileReader();
                        reader.onloadend = () => { img.src = reader.result; r(); };
                        reader.onerror = () => r();
                        reader.readAsDataURL(blob);
                    });
                } catch(e) {}
            }
        });
        await Promise.all(promises);

        // Fix inline file references: Antigravity nests <div> elements inside
        // <span> and <p> tags (e.g. file-type icons). Browsers auto-close <p> and
        // <span> when they encounter a <div>, causing unwanted line breaks.
        // Solution: Convert any <div> inside an inline parent to a <span>.
        try {
            const inlineTags = new Set(['SPAN', 'P', 'A', 'LABEL', 'EM', 'STRONG', 'CODE']);
            const allDivs = Array.from(clone.querySelectorAll('div'));
            for (const div of allDivs) {
                try {
                    if (!div.parentNode) continue;
                    const parent = div.parentElement;
                    if (!parent) continue;
                    
                    const parentIsInline = inlineTags.has(parent.tagName) || 
                        (parent.className && (parent.className.includes('inline-flex') || parent.className.includes('inline-block')));
                        
                    if (parentIsInline) {
                        const span = document.createElement('span');
                        // MOVE children instead of copying (prevents orphaning nested divs)
                        while (div.firstChild) {
                            span.appendChild(div.firstChild);
                        }
                        if (div.className) span.className = div.className;
                        if (div.getAttribute('style')) span.setAttribute('style', div.getAttribute('style'));
                        span.style.display = 'inline-flex';
                        span.style.alignItems = 'center';
                        span.style.verticalAlign = 'middle';
                        div.replaceWith(span);
                    }
                } catch(e) {}
            }
        } catch(e) {}
        
        const html = clone.outerHTML;
        
        const rules = [];
        for (const sheet of document.styleSheets) {
            try {
                for (const rule of sheet.cssRules) {
                    rules.push(rule.cssText);
                }
            } catch (e) { }
        }
        // Extract inline CSS custom properties from <html> and <body> (critical for Antigravity 2.0 dark theme variables)
        const htmlInlineStyle = document.documentElement.getAttribute('style') || '';
        const bodyInlineStyle = document.body?.getAttribute('style') || '';
        const rootVarsRule = ':root, html, body { ' + htmlInlineStyle + '; ' + bodyInlineStyle + '; }';
        const allCSS = rootVarsRule + '\\n' + rules.join('\\n');
        
        return {
            html: html,
            css: allCSS,
            backgroundColor: cascadeStyles.backgroundColor,
            color: cascadeStyles.color,
            fontFamily: cascadeStyles.fontFamily,
            scrollInfo: scrollInfo,
            stats: {
                nodes: clone.getElementsByTagName('*').length,
                htmlSize: html.length,
                cssSize: allCSS.length
            }
        };
    })()`;

    for (const ctx of cdp.contexts) {
        try {
            // console.log(`Trying context ${ctx.id} (${ctx.name || ctx.origin})...`);
            const result = await cdp.call("Runtime.evaluate", {
                expression: CAPTURE_SCRIPT,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });

            if (result.exceptionDetails) {
                // console.log(`Context ${ctx.id} exception:`, result.exceptionDetails);
                continue;
            }

            if (result.result && result.result.value) {
                const val = result.result.value;
                if (val.error) {
                    // console.log(`Context ${ctx.id} script error:`, val.error);
                    // if (val.debug) console.log(`   Debug info:`, JSON.stringify(val.debug));
                } else {
                    return val;
                }
            }
        } catch (e) {
            console.log(`Context ${ctx.id} connection error:`, e.message);
        }
    }

    return null;
}

// Inject message into Antigravity
async function injectMessage(cdp, text) {
    // Use JSON.stringify for robust escaping (handles ", \, newlines, backticks, unicode, etc.)
    const safeText = JSON.stringify(text);

    const PREPARE_EXPR = `(async () => {
        const cancel = document.querySelector('[data-testid="input-cancel-button"], button[aria-label*="取消"], [data-tooltip-id="input-send-button-cancel-tooltip"]');
        if (cancel && cancel.offsetParent !== null) return { ok:false, reason:"busy" };

        const editors = [...document.querySelectorAll('[contenteditable="true"], [data-lexical-editor="true"], [data-lexical-editor], textarea, #conversation [contenteditable="true"]')]
            .filter(el => el.offsetParent !== null);
        const editor = editors.at(-1);
        if (!editor) return { ok:false, error:"editor_not_found" };

        const textToInsert = ${safeText};

        editor.focus();
        if ((editor.innerText || '').trim().length > 0) {
            try {
                const sel = window.getSelection();
                const range = document.createRange();
                range.selectNodeContents(editor);
                sel.removeAllRanges();
                sel.addRange(range);
            } catch {}
            document.execCommand?.("selectAll", false, null);
            document.execCommand?.("delete", false, null);
            await new Promise(r => setTimeout(r, 30));
        }

        let inserted = false;
        if ((editor.innerText || '').trim().length === 0) {
            try { inserted = !!document.execCommand?.("insertText", false, textToInsert); } catch {}
        }
        if (!inserted || !(editor.innerText || '').trim()) {
            return {
                ok: false,
                needsCdpFallback: true,
                editorHasText: !!(editor.innerText || '').trim(),
                submitFound: false,
                submitDisabled: true
            };
        }

        const findSendBtn = () =>
            document.querySelector('[data-testid="send-button"]') ||
            document.querySelector('button[aria-label="发送消息"]') ||
            document.querySelector('button[aria-label*="发送"]') ||
            document.querySelector("svg.lucide-arrow-right")?.closest("button") ||
            document.querySelector("button[aria-label*='Send'], button[aria-label*='send'], button[type='submit']") ||
            document.querySelector("button:has(svg.lucide-arrow-up), button:has(svg.lucide-corner-down-left)");

        // Poll up to 450ms for Lexical/React to enable the send button
        let submit = null;
        for (let i = 0; i < 9; i++) {
            await new Promise(r => setTimeout(r, 50));
            submit = findSendBtn();
            if (submit && !submit.disabled && submit.getAttribute('aria-disabled') !== 'true') {
                submit.click();
                return { ok:true, method:"click_submit", attempt:i };
            }
        }

        return {
            ok: false,
            needsCdpFallback: true,
            editorHasText: !!(editor.innerText || '').trim(),
            submitFound: !!submit,
            submitDisabled: submit ? (submit.disabled || submit.getAttribute('aria-disabled') === 'true') : null
        };
    })()`;

    const CLICK_OR_ENTER_EXPR = `(async () => {
        const findSendBtn = () =>
            document.querySelector('[data-testid="send-button"]') ||
            document.querySelector('button[aria-label="发送消息"]') ||
            document.querySelector('button[aria-label*="发送"]') ||
            document.querySelector("svg.lucide-arrow-right")?.closest("button") ||
            document.querySelector("button[aria-label*='Send'], button[aria-label*='send'], button[type='submit']");
        for (let i = 0; i < 6; i++) {
            await new Promise(r => setTimeout(r, 50));
            const submit = findSendBtn();
            if (submit && !submit.disabled && submit.getAttribute('aria-disabled') !== 'true') {
                submit.click();
                return { ok:true, method:"cdp_click_submit" };
            }
        }
        return { ok:false };
    })()`;

    let lastVal = null;
    for (const ctx of cdp.contexts) {
        try {
            const result = await cdp.call("Runtime.evaluate", {
                expression: PREPARE_EXPR,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });

            const val = result.result?.value;
            if (!val) continue;
            lastVal = val;

            if (val.ok || val.reason === "busy") {
                return val;
            }

            if (val.needsCdpFallback) {
                // Use native CDP Input APIs if Lexical still had text or didn't pick up synthetic DOM insert
                await cdp.call("Input.dispatchKeyEvent", { type: "keyDown", modifiers: 2, key: "a", code: "KeyA", windowsVirtualKeyCode: 65 }).catch(() => {});
                await cdp.call("Input.dispatchKeyEvent", { type: "keyUp", modifiers: 2, key: "a", code: "KeyA", windowsVirtualKeyCode: 65 }).catch(() => {});
                await cdp.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 }).catch(() => {});
                await cdp.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 }).catch(() => {});
                await cdp.call("Input.insertText", { text }).catch(() => {});
                const retry = await cdp.call("Runtime.evaluate", {
                    expression: CLICK_OR_ENTER_EXPR,
                    returnByValue: true,
                    awaitPromise: true,
                    contextId: ctx.id
                });
                if (retry.result?.value?.ok) return retry.result.value;

                // Final fallback: real Enter key via CDP Input.dispatchKeyEvent
                await cdp.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 }).catch(() => {});
                await cdp.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 }).catch(() => {});
                return { ok: true, method: "cdp_enter_keypress" };
            }
        } catch (e) { }
    }

    return lastVal || { ok: false, reason: "no_context" };
}

// Set functionality mode (Fast/Turbo vs Planning/Review)
async function setMode(cdp, mode) {
    const isTurbo = /turbo|fast|极速/i.test(mode);
    const isReview = /review|plan|审查/i.test(mode);
    if (!isTurbo && !isReview) return { error: 'Invalid mode: ' + mode };

    const targetKeyword = isTurbo ? '极速' : '审查';

    const EXP = `(async () => {
        try {
            let btn = document.querySelector('[data-testid="permissions-selector-trigger"], button[aria-label*="preset selector"], button[aria-label*="permissions"]');
            if (!btn) {
                const allButtons = Array.from(document.querySelectorAll('button'));
                btn = allButtons.find(b => /turbo|极速|审查/i.test(b.innerText || b.getAttribute('aria-label') || ''));
            }
            if (!btn) return { error: 'Permissions/Mode button not found' };

            const curText = (btn.innerText || '').trim();
            if (curText.includes('${targetKeyword}')) {
                return { success: true, alreadySet: true, mode: curText };
            }

            btn.click();
            await new Promise(r => setTimeout(r, 400));

            const items = Array.from(document.querySelectorAll('.agy-overlay-item, [role="menuitem"], .agy-overlay button'));
            const targetItem = items.find(el => (el.innerText || '').includes('${targetKeyword}'));
            if (targetItem) {
                targetItem.click();
                await new Promise(r => setTimeout(r, 200));
                return { success: true, switchedTo: '${targetKeyword}' };
            }

            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            return { error: 'Mode option "${targetKeyword}" not found in dropdown' };
        } catch(err) {
            return { error: 'JS Error: ' + err.toString() };
        }
    })()`;

    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: EXP,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });
            if (res.result?.value) return res.result.value;
        } catch (e) { }
    }
    return { error: 'Context failed' };
}

// Stop Generation
async function stopGeneration(cdp) {
    const EXP = `(async () => {
        const cancel = document.querySelector('[data-testid="input-cancel-button"], button[aria-label*="取消"], button[aria-label*="Cancel"], [data-tooltip-id="input-send-button-cancel-tooltip"]');
        if (cancel && cancel.offsetParent !== null) {
            cancel.click();
            return { success: true };
        }
        
        const stopBtn = document.querySelector('button svg.lucide-square')?.closest('button');
        if (stopBtn && stopBtn.offsetParent !== null) {
            stopBtn.click();
            return { success: true, method: 'fallback_square' };
        }

        return { error: 'No active generation found to stop' };
    })()`;

    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: EXP,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });
            if (res.result?.value) return res.result.value;
        } catch (e) { }
    }
    return { error: 'Context failed' };
}

// Click Element (Remote) - supports chat viewport, floating permission dialogs, and trusted CDP mouse clicks
async function clickElement(cdp, { selector, index, textContent, scope }) {
    const safeSelector = JSON.stringify(selector || 'button, [role="button"]');
    const safeText = JSON.stringify(textContent || '');
    const safeScope = JSON.stringify(scope || 'auto');

    const LOCATE_EXP = `(async () => {
        try {
            const sel = ${safeSelector};
            const scopeMode = ${safeScope};
            const filterText = ${safeText};

            const collectVisible = (container) => {
                if (!container) return [];
                return Array.from(container.querySelectorAll(sel)).filter(el =>
                    el.offsetParent !== null &&
                    !el.disabled &&
                    el.getAttribute('aria-disabled') !== 'true' &&
                    !el.closest('[data-testid="input-cancel-button"], [data-tooltip-id="input-send-button-cancel-tooltip"]')
                );
            };

            let pool = [];
            if (scopeMode === 'dialog') {
                const dialogs = Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"], .agy-overlay'));
                for (const d of dialogs) pool.push(...collectVisible(d));
            }
            if (pool.length === 0) {
                const chatRoot = document.querySelector('[data-testid="autoscroll-viewport"]') || document.getElementById('conversation') || document.getElementById('chat') || document.getElementById('cascade');
                pool = collectVisible(chatRoot);
            }
            if (pool.length === 0 || scopeMode === 'page') {
                const seen = new Set(pool);
                for (const el of collectVisible(document)) {
                    if (!seen.has(el)) { seen.add(el); pool.push(el); }
                }
            }

            let elements = pool;
            if (filterText) {
                elements = elements.filter(el => {
                    const txt = (el.innerText || el.textContent || '').trim().replace(/\\s+/g, ' ');
                    const firstLine = txt.split('\\n')[0].trim();
                    return firstLine === filterText || txt === filterText || txt.toLowerCase().includes(filterText.toLowerCase());
                });
                elements = elements.filter(el => !elements.some(other => other !== el && el.contains(other)));
            }

            const target = elements[${Number.isInteger(index) ? index : 0}] || elements[elements.length - 1];
            if (!target) {
                return { error: 'Element not found among ' + elements.length + ' visible matches' };
            }

            target.scrollIntoView({ block: 'center', inline: 'nearest' });
            await new Promise(r => setTimeout(r, 40));
            const rect = target.getBoundingClientRect();
            const hasBox = rect.width > 2 && rect.height > 2 && rect.bottom > 0 && rect.right > 0;
            if (!hasBox) {
                if (target.focus) target.focus();
                target.click();
                return { success: true, method: 'dom_click', found: elements.length };
            }
            return {
                located: true,
                x: Math.round(rect.left + rect.width / 2),
                y: Math.round(rect.top + rect.height / 2),
                found: elements.length
            };
        } catch (e) {
            return { error: e.toString() };
        }
    })()`;

    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: LOCATE_EXP,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });
            const val = res.result?.value;
            if (!val) continue;
            if (val.success) return val;
            if (val.located && typeof val.x === 'number' && typeof val.y === 'number') {
                await cdp.call("Input.dispatchMouseEvent", { type: "mouseMoved", x: val.x, y: val.y, button: "none" }).catch(() => {});
                await cdp.call("Input.dispatchMouseEvent", { type: "mousePressed", x: val.x, y: val.y, button: "left", clickCount: 1 });
                await cdp.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: val.x, y: val.y, button: "left", clickCount: 1 });
                return { success: true, method: 'cdp_mouse', x: val.x, y: val.y, found: val.found };
            }
        } catch (e) { }
    }
    return { error: '远程点击未找到匹配按钮，请刷新后重试' };
}

// Remote scroll - sync phone scroll to desktop
async function remoteScroll(cdp, { scrollTop, scrollPercent }) {
    const EXPRESSION = `(async () => {
        try {
            const viewport = document.querySelector('[data-testid="autoscroll-viewport"]');
            const scrollables = viewport ? [viewport] : [
                ...document.querySelectorAll('#conversation [class*="scroll"], #chat [class*="scroll"], #cascade [class*="scroll"], .overflow-y-auto')
            ].filter(el => el.scrollHeight > el.clientHeight);
            
            if (scrollables.length === 0) {
                const cascade = document.getElementById('conversation') || document.getElementById('chat') || document.getElementById('cascade');
                if (cascade && cascade.scrollHeight > cascade.clientHeight) {
                    scrollables.push(cascade);
                }
            }
            
            if (scrollables.length === 0) return { error: 'No scrollable element found' };
            
            const target = scrollables[0];
            
            if (${scrollPercent} !== undefined && !isNaN(${scrollPercent})) {
                const maxScroll = Math.max(0, target.scrollHeight - target.clientHeight);
                target.scrollTop = maxScroll * ${scrollPercent};
            } else {
                target.scrollTop = ${scrollTop || 0};
            }
            
            return { success: true, scrolled: target.scrollTop };
        } catch(e) {
            return { error: e.toString() };
        }
    })()`;

    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: EXPRESSION,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });
            if (res.result?.value?.success) return res.result.value;
        } catch (e) { }
    }
    return { error: 'Scroll failed in all contexts' };
}

// Set AI Model
async function setModel(cdp, modelName) {
    const safeModelName = JSON.stringify(modelName || '');

    const EXP = `(async () => {
        try {
            let btn = document.querySelector('[data-testid="model-selector-trigger"], button[aria-label*="Select model"]');
            if (!btn) {
                const allButtons = Array.from(document.querySelectorAll('button'));
                btn = allButtons.find(b => /gemini|claude|gpt|model/i.test(b.innerText || b.getAttribute('aria-label') || ''));
            }
            if (!btn) return { error: 'Model selector button not found' };

            const curText = (btn.innerText || '').trim();
            const requested = ${safeModelName};
            if (curText.toLowerCase().includes(requested.toLowerCase())) {
                return { success: true, alreadySet: true, model: curText };
            }

            btn.click();
            await new Promise(r => setTimeout(r, 400));

            const items = Array.from(document.querySelectorAll('.agy-overlay-item, [role="menuitem"], .agy-overlay button'));
            
            // 1. Partial or exact text match
            let target = items.find(el => {
                const txt = (el.innerText || '').trim();
                return txt.toLowerCase().includes(requested.toLowerCase()) || requested.toLowerCase().includes(txt.toLowerCase());
            });

            // 2. Keyword fallback (Gemini / Claude / Sonnet / Opus / GPT / 120B)
            if (!target) {
                const keywords = requested.toLowerCase().split(/[\\s()]+/).filter(w => w.length >= 3);
                target = items.find(el => {
                    const txt = (el.innerText || '').toLowerCase();
                    return keywords.some(k => txt.includes(k));
                });
            }

            if (target) {
                target.scrollIntoView({ block: 'center' });
                target.click();
                await new Promise(r => setTimeout(r, 200));
                return { success: true, switchedTo: requested };
            }

            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            return { error: 'Model option not found in dropdown. Available: ' + items.map(i => i.innerText.trim()).join(' | ') };
        } catch(err) {
            return { error: 'JS Error: ' + err.toString() };
        }
    })()`;

    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: EXP,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });
            if (res.result?.value) return res.result.value;
        } catch (e) { }
    }
    return { error: 'Context failed' };
}

// Start New Chat
async function startNewChat(cdp) {
    const EXP = `(async () => {
        try {
            const allButtons = Array.from(document.querySelectorAll('button, [role="button"], a'));
            const newChatBtn = allButtons.find(btn => {
                const txt = (btn.innerText || '').trim();
                const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
                return txt === '新建会话' || aria.includes('new conversation') || aria.includes('新建');
            });
            if (newChatBtn) {
                newChatBtn.click();
                return { success: true, method: 'dom_button' };
            }

            // Fallback: navigate via CDP Page.navigate to root
            return { success: true, method: 'fallback_needed' };
        } catch(e) {
            return { error: e.toString() };
        }
    })()`;

    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: EXP,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });
            if (res.result?.value?.success) return res.result.value;
        } catch (e) { }
    }
    return { error: 'Context failed' };
}
// Get Chat History - Click history button and scrape conversations
async function getChatHistory(cdp) {
    const EXP = `(async () => {
        try {
            const chats = [];
            const seenTitles = new Set();

            // Priority 1: Look for tooltip ID pattern (history/past/recent)
            let historyBtn = document.querySelector('[data-tooltip-id*="history"], [data-tooltip-id*="past"], [data-tooltip-id*="recent"], [data-tooltip-id*="conversation-history"]');
            
            // Priority 2: Look for button ADJACENT to the new chat button
            if (!historyBtn) {
                const newChatBtn = document.querySelector('[data-tooltip-id="new-conversation-tooltip"]');
                if (newChatBtn) {
                    const parent = newChatBtn.parentElement;
                    if (parent) {
                        const siblings = Array.from(parent.children).filter(el => el !== newChatBtn);
                        historyBtn = siblings.find(el => el.tagName === 'A' || el.tagName === 'BUTTON' || el.getAttribute('role') === 'button');
                    }
                }
            }

            // Fallback: Use previous heuristics (icon/aria-label)
            if (!historyBtn) {
                const allButtons = Array.from(document.querySelectorAll('button, [role="button"], a[data-tooltip-id]'));
                for (const btn of allButtons) {
                    if (btn.offsetParent === null) continue;
                    const hasHistoryIcon = btn.querySelector('svg.lucide-clock') ||
                                           btn.querySelector('svg.lucide-history') ||
                                           btn.querySelector('svg.lucide-folder') ||
                                           btn.querySelector('svg[class*="clock"]') ||
                                           btn.querySelector('svg[class*="history"]');
                    if (hasHistoryIcon) {
                        historyBtn = btn;
                        break;
                    }
                }
            }
            
            if (!historyBtn) {
                return { error: 'History button not found', chats: [] };
            }

            // Click and Wait
            historyBtn.click();
            await new Promise(r => setTimeout(r, 2000));
            
            // Find the side panel
            let panel = null;
            let inputsFoundDebug = [];
            
            // Strategy 1: The search input has specific placeholder
            let searchInput = null;
            const inputs = Array.from(document.querySelectorAll('input'));
            searchInput = inputs.find(i => {
                const ph = (i.placeholder || '').toLowerCase();
                return ph.includes('select') || ph.includes('conversation');
            });
            
            // Strategy 2: Look for any text input that looks like a search bar (based on user snippet classes)
            if (!searchInput) {
                const allInputs = Array.from(document.querySelectorAll('input[type="text"]'));
                inputsFoundDebug = allInputs.map(i => 'ph:' + i.placeholder + ', cls:' + i.className);
                
                searchInput = allInputs.find(i => 
                    i.offsetParent !== null && 
                    (i.className.includes('w-full') || i.classList.contains('w-full'))
                );
            }
            
            // Strategy 3: Find known text in the panel (Anchor Text Strategy)
            let anchorElement = null;
            if (!searchInput) {
                 const allSpans = Array.from(document.querySelectorAll('span, div, p'));
                 anchorElement = allSpans.find(s => {
                     const t = (s.innerText || '').trim();
                     return t === 'Current' || t === 'Refining Chat History Scraper'; // specific known title
                 });
            }

            const startElement = searchInput || anchorElement;

            if (startElement) {
                // Walk up to find the panel container
                let container = startElement;
                for (let i = 0; i < 15; i++) { 
                    if (!container.parentElement) break;
                    container = container.parentElement;
                    const rect = container.getBoundingClientRect();
                    
                    // Panel should have good dimensions
                    // Relaxed constraints for mobile
                    if (rect.width > 50 && rect.height > 100) {
                        panel = container;
                        
                        // If it looks like a modal/popover (fixed or absolute pos), that's definitely it
                        const style = window.getComputedStyle(container);
                        if (style.position === 'fixed' || style.position === 'absolute' || style.zIndex > 10) {
                            break;
                        }
                    }
                }
                
                // Fallback if loop finishes without specific break
                if (!panel && startElement) {
                     // Just go up 4 levels
                     let p = startElement;
                     for(let k=0; k<4; k++) { if(p.parentElement) p = p.parentElement; }
                     panel = p;
                }
            }
            
            const debugInfo = { 
                panelFound: !!panel, 
                panelWidth: panel?.offsetWidth || 0,
                inputFound: !!searchInput,
                anchorFound: !!anchorElement,
                inputsDebug: inputsFoundDebug.slice(0, 5)
            };
            
            if (panel) {
                // Chat titles are in <span> elements
                const spans = Array.from(panel.querySelectorAll('span'));
                
                // Section headers and workspace labels to skip
                const SKIP_EXACT = new Set([
                    'current', 'other conversations', 'now',
                    'projects', 'personal', 'workspace', 'default', 'phone connect antigravity'
                ]);
                
                for (const span of spans) {
                    const text = span.textContent?.trim() || '';
                    const lower = text.toLowerCase();
                    
                    // Skip empty or too short
                    if (text.length < 3) continue;

                    // Sibling-span heuristic: skip tag/badge labels (like workspaces)
                    // If a short span has a longer sibling span, it's likely a tag next to the actual title
                    if (text.length < 40 && span.parentElement) {
                        let hasLongerSiblingSpan = false;
                        for (const child of span.parentElement.children) {
                            if (child !== span && child.tagName === 'SPAN') {
                                const childTextLength = (child.textContent?.trim() || '').length;
                                if (childTextLength > text.length) {
                                    hasLongerSiblingSpan = true;
                                    break;
                                }
                            }
                        }
                        if (hasLongerSiblingSpan) continue;
                    }
                    
                    // Skip section headers
                    if (SKIP_EXACT.has(lower)) continue;
                    if (lower.startsWith('recent in ')) continue;
                    if (lower.startsWith('show ') && lower.includes('more')) continue;
                    
                    // Skip timestamps
                    if (lower.endsWith(' ago') || /^\\d+\\s*(sec|min|hr|day|wk|mo|yr)/i.test(lower)) continue;
                    
                    // Skip very long text (containers)
                    if (text.length > 100) continue;
                    
                    // Skip duplicates
                    if (seenTitles.has(text)) continue;
                    
                    seenTitles.add(text);
                    chats.push({ title: text, date: 'Recent' });
                    
                    if (chats.length >= 50) break;
                }
            }
            
            // Note: Panel is left open on PC as requested ("launch history on pc")

            return { success: true, chats: chats, debug: debugInfo };
        } catch(e) {
            return { error: e.toString(), chats: [] };
        }
    })()`;

    let lastError = null;
    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: EXP,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });
            if (res.result?.value) return res.result.value;
            // If result.value is null/undefined but no error thrown, check exceptionDetails
            if (res.exceptionDetails) {
                lastError = res.exceptionDetails.exception?.description || res.exceptionDetails.text;
            }
        } catch (e) {
            lastError = e.message;
        }
    }
    return { error: 'Context failed: ' + (lastError || 'No contexts available'), chats: [] };
}

async function selectChat(cdp, chatTitle) {
    const safeChatTitle = JSON.stringify(chatTitle);

    const EXP = `(async () => {
        try {
            const targetTitle = ${safeChatTitle};
            let debugInfo = [];
            const log = (msg) => debugInfo.push(msg);
            log('Starting selectChat for: ' + targetTitle);

            // 1. Open History Panel (same robust method style as getChatHistory)
            let historyBtn = document.querySelector('[data-tooltip-id="history-tooltip"]');
            
            if (!historyBtn) {
                const allButtons = Array.from(document.querySelectorAll('button, [role="button"]'));
                
                // Try icon first
                historyBtn = allButtons.find(btn => {
                    if (btn.offsetParent === null) return false;
                    return btn.querySelector('svg.lucide-clock') ||
                        btn.querySelector('svg.lucide-history') ||
                        btn.querySelector('svg.lucide-folder') ||
                        btn.querySelector('svg.lucide-clock-rotate-left');
                });
                
                // Try position strategy (second button near new chat)
                if (!historyBtn) {
                    const topButtons = allButtons.filter(btn => {
                        if (btn.offsetParent === null) return false;
                        const rect = btn.getBoundingClientRect();
                        return rect.top < 100 && rect.top > 0;
                    }).sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
                    
                    if (topButtons.length >= 2) historyBtn = topButtons[1];
                }
            }

            if (!historyBtn) return { error: 'History button not found', debug: debugInfo };

            historyBtn.click();
            log('Clicked history button');

            // 2. Wait-for-visible polling (up to 3s)
            let panel = null;
            let panelFound = false;
            for (let i = 0; i < 15; i++) {
                await new Promise(r => setTimeout(r, 200));

                const inputs = Array.from(document.querySelectorAll('input[type="text"]'));
                const searchInput = inputs.find(input =>
                    input.offsetParent !== null &&
                    (input.placeholder?.toLowerCase().includes('select') ||
                     input.placeholder?.toLowerCase().includes('conversation') ||
                     input.className.includes('w-full'))
                );

                const allSpans = Array.from(document.querySelectorAll('span, div, p'));
                const anchorSpan = allSpans.find(s => s.offsetParent !== null && (s.innerText || '').trim() === 'Current');

                const anchor = searchInput || anchorSpan;
                if (anchor) {
                    let container = anchor;
                    for (let j = 0; j < 15; j++) {
                        if (!container) break;
                        const rect = container.getBoundingClientRect();
                        if (rect.width > 50 && rect.height > 100) {
                            const style = window.getComputedStyle(container);
                            if (style.position === 'fixed' || style.position === 'absolute' || style.zIndex > 10) {
                                panel = container;
                                panelFound = true;
                                break;
                            }
                        }
                        container = container.parentElement;
                    }
                }
                if (panelFound) break;
            }

            if (!panelFound) return { error: 'History panel did not open', debug: debugInfo };
            log('Panel found');

            // Give panel a bit more time to render list items
            await new Promise(r => setTimeout(r, 300));

            // 3. Scored fuzzy matching
            let candidates = Array.from(panel.querySelectorAll('span, p, div'))
                .filter(el => {
                    const text = el.textContent?.trim() || '';
                    return text.length >= 3 && el.children.length === 0 && el.offsetParent !== null;
                })
                .map(el => {
                    const text = el.textContent.trim();
                    const targetLower = targetTitle.toLowerCase();
                    const textLower = text.toLowerCase();

                    let score = 0;
                    if (text === targetTitle) score += 100;
                    else if (textLower === targetLower) score += 90;
                    else if (text.includes(targetTitle)) score += 60;
                    else if (textLower.includes(targetLower)) score += 50;
                    else if (targetLower.includes(textLower)) score += 40;
                    else if (textLower.startsWith(targetLower.substring(0, Math.min(20, targetLower.length)))) score += 30;

                    // Penalty for tiny labels/tags
                    if (text.length < 5) score -= 10;

                    // Bonus for deeper nodes (usually more specific)
                    let depth = 0;
                    let p = el;
                    while (p) { depth++; p = p.parentElement; }
                    score += depth;

                    return { el, text, score };
                })
                .filter(c => c.score >= 30)
                .sort((a, b) => b.score - a.score);

            if (candidates.length === 0) return { error: 'Chat title not found in panel', title: targetTitle, debug: debugInfo };

            log('Found ' + candidates.length + ' candidates. Best match: "' + candidates[0].text + '" (Score: ' + candidates[0].score + ')');

            // 4. Click execution with MouseEvent fallback
            const executeClick = (targetEl) => {
                let clickable = targetEl;
                let foundClickable = false;

                for (let i = 0; i < 5; i++) {
                    if (!clickable) break;
                    const style = window.getComputedStyle(clickable);
                    if (style.cursor === 'pointer' || clickable.tagName === 'BUTTON' || clickable.onclick) {
                        foundClickable = true;
                        break;
                    }
                    if (clickable.parentElement) clickable = clickable.parentElement;
                }

                const finalTarget = foundClickable ? clickable : targetEl;
                finalTarget.click();

                try {
                    const rect = finalTarget.getBoundingClientRect();
                    const centerX = rect.left + (rect.width / 2);
                    const centerY = rect.top + (rect.height / 2);
                    const events = ['mousedown', 'mouseup', 'click'];
                    events.forEach(type => {
                        finalTarget.dispatchEvent(new MouseEvent(type, {
                            view: window,
                            bubbles: true,
                            cancelable: true,
                            clientX: centerX,
                            clientY: centerY,
                            button: 0
                        }));
                    });
                } catch (e) {
                    log('MouseEvent fallback failed: ' + e.message);
                }
            };

            executeClick(candidates[0].el);
            log('Executed click on candidate 0');

            // 5. Verify/retry if panel still open
            await new Promise(r => setTimeout(r, 1500));
            const isPanelStillOpen = panel.offsetParent !== null && panel.style.display !== 'none' && panel.getBoundingClientRect().height > 0;

            if (isPanelStillOpen && candidates.length > 1) {
                log('Panel still open, retrying with candidate 1: "' + candidates[1].text + '"');
                executeClick(candidates[1].el);
                await new Promise(r => setTimeout(r, 1000));
            }

            // Ensure panel closes
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
            document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', bubbles: true }));

            return { success: true, method: 'heuristic_click', bestMatch: candidates[0].text, retried: isPanelStillOpen, debug: debugInfo };
        } catch (e) {
            return { error: 'JS Exception: ' + e.toString() };
        }
    })()`;

    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: EXP,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });
            if (res.result?.value) return res.result.value;
        } catch (e) { }
    }
    return { error: 'Context failed' };
}

// Close History Panel (Escape)
async function closeHistory(cdp) {
    const EXP = `(async () => {
        try {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
            document.dispatchEvent(new KeyboardEvent('keyup',   { key: 'Escape', code: 'Escape', bubbles: true }));
            return { success: true };
        } catch(e) {
            return { error: e.toString() };
        }
    })()`;

    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: EXP,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });
            if (res.result?.value?.success) return res.result.value;
        } catch (e) { }
    }
    return { error: 'Failed to close history panel' };
}

// Check if a chat is currently open
async function hasChatOpen(cdp) {
    const EXP = `(() => {
    const composer = document.querySelector('.surface-composer, .surface-composer-card, [data-testid="autoscroll-viewport"], #conversation, #chat, #cascade');
    const editor = document.querySelector('[contenteditable="true"], [data-lexical-editor="true"], textarea');
    return {
        hasChat: !!composer,
        hasMessages: true,
        editorFound: !!editor
    };
})()`;

    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: EXP,
                returnByValue: true,
                contextId: ctx.id
            });
            if (res.result?.value) return res.result.value;
        } catch (e) { }
    }
    return { hasChat: false, hasMessages: false, editorFound: false };
}

// Get App State (Mode & Model)
async function getAppState(cdp) {
    const EXP = `(async () => {
    try {
        const state = {
            mode: '极速 (Turbo)',
            model: 'Unknown',
            isBusy: false,
            chatTitle: '',
            pendingActions: []
        };

        // 1. Get Mode from permissions trigger
        const modeBtn = document.querySelector('[data-testid="permissions-selector-trigger"], button[aria-label*="preset selector"]');
        if (modeBtn) {
            const txt = (modeBtn.innerText || '').trim();
            if (txt) state.mode = txt;
        }

        // 2. Get Model from model selector trigger
        const modelBtn = document.querySelector('[data-testid="model-selector-trigger"], button[aria-label*="Select model"]');
        if (modelBtn) {
            const txt = (modelBtn.innerText || '').trim();
            if (txt) state.model = txt;
        }

        // 3. Detect if Agent is actively generating/executing
        const cancelBtn = document.querySelector('[data-testid="input-cancel-button"], button[aria-label*="取消"], [data-tooltip-id="input-send-button-cancel-tooltip"]');
        state.isBusy = !!(cancelBtn && cancelBtn.offsetParent !== null);

        // 4. Parse clean conversation title
        const rawTitle = (document.title || '').trim();
        if (rawTitle) {
            const parts = rawTitle.split(' - ');
            state.chatTitle = parts.length > 1 ? parts[0].trim() : rawTitle;
        }

        // 5. Detect pending approval / permission prompts across viewport, composer, and floating dialogs
        const approveRegex = /^(运行|允许|总是允许|仅允许一次|允许本次对话|允许此网站|允许访问|授权|确认|同意|接受|全部接受|应用|继续|批准|提交|重试|run|run command|allow|always allow|allow once|allow this conversation|allow for this chat|allow access|allow site|grant|confirm|accept|accept all|apply|approve|continue|proceed|yes|retry)(\s*\([^)]{1,14}\))?$/i;
        const rejectRegex = /^(拒绝|不允许|拒绝本次|跳过|丢弃|放弃|deny|reject|decline|don't allow|skip|discard|cancel)(\s*\([^)]{1,14}\))?$/i;

        const collectVisibleBtns = (root) => {
            if (!root) return [];
            return Array.from(root.querySelectorAll('button, [role="button"]')).filter(btn =>
                btn.offsetParent !== null &&
                !btn.disabled &&
                btn.getAttribute('aria-disabled') !== 'true' &&
                !btn.closest('[data-testid="input-cancel-button"], [data-tooltip-id="input-send-button-cancel-tooltip"], [data-testid="send-button"], [data-testid="model-selector-trigger"], [data-testid="permissions-selector-trigger"]')
            );
        };

        const dialogs = Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"], .agy-overlay'));
        const viewport = document.querySelector('[data-testid="autoscroll-viewport"]') || document.getElementById('conversation') || document.body;
        const composer = document.querySelector('.surface-composer, .surface-composer-card');

        const scanPool = [];
        const seenBtns = new Set();
        const addFrom = (root, scopeName) => {
            for (const btn of collectVisibleBtns(root)) {
                if (seenBtns.has(btn)) continue;
                seenBtns.add(btn);
                scanPool.push({ btn, scopeName });
            }
        };
        dialogs.forEach(d => addFrom(d, 'dialog'));
        addFrom(composer, 'page');
        addFrom(viewport, 'page');

        const matched = [];
        scanPool.forEach(({ btn, scopeName }) => {
            const txt = (btn.innerText || btn.textContent || '').trim().replace(/\\s+/g, ' ');
            if (!txt || txt.length > 32) return;
            if (approveRegex.test(txt)) {
                matched.push({ btn, text: txt, kind: 'approve', scope: scopeName });
            } else if (rejectRegex.test(txt)) {
                matched.push({ btn, text: txt, kind: 'reject', scope: scopeName });
            }
        });

        const tail = matched.slice(-4);
        if (tail.length > 0) {
            const anchorBtn = tail[0].btn;
            const promptContainer = anchorBtn.closest('[role="dialog"], [role="alertdialog"], .agy-overlay, section, form, div');
            if (promptContainer) {
                const rawPrompt = (promptContainer.innerText || '').replace(/\\s+/g, ' ').trim();
                const cleaned = rawPrompt.slice(0, 80);
                if (cleaned && cleaned.length > tail[0].text.length) {
                    state.pendingPrompt = cleaned;
                }
            }
        }
        state.pendingActions = tail.map(item => {
            const sameScopeBtns = scanPool
                .filter(p => p.scopeName === item.scope)
                .map(p => p.btn)
                .filter(b => {
                    const t = (b.innerText || b.textContent || '').trim().replace(/\\s+/g, ' ');
                    return t === item.text || t.toLowerCase().includes(item.text.toLowerCase());
                });
            const idx = sameScopeBtns.indexOf(item.btn);
            return {
                text: item.text,
                kind: item.kind,
                scope: item.scope,
                selector: 'button, [role="button"]',
                index: idx >= 0 ? idx : Math.max(0, sameScopeBtns.length - 1)
            };
        });

        return state;
    } catch (e) { return { mode: '极速 (Turbo)', model: 'Unknown', isBusy: false, chatTitle: '', pendingActions: [], error: e.toString() }; }
})()`;

    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: EXP,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });
            if (res.result?.value) return res.result.value;
        } catch (e) { }
    }
    return { error: 'Context failed' };
}

// Get Available Models dynamically from Antigravity 2.0 dropdown
async function getAvailableModels(cdp, forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && cachedModels && (now - cachedModelsAt < 60000)) {
        return { success: true, models: cachedModels, cached: true };
    }
    if (isUiMenuBusy) {
        if (cachedModels) return { success: true, models: cachedModels, cached: true };
        return { error: '桌面端菜单正在读取中，请稍后再试' };
    }
    isUiMenuBusy = true;
    try {
        const EXP = `(async () => {
            try {
                const trigger = document.querySelector('[data-testid="model-selector-trigger"], button[aria-label*="Select model"]');
                if (!trigger) return { error: '未找到桌面端模型选择按钮' };
                const aria = trigger.getAttribute('aria-label') || '';
                if (trigger.disabled || /cannot be changed while the agent is running/i.test(aria)) {
                    return { error: '智能体正在生成中，暂时无法读取或切换模型' };
                }

                const currentModel = (trigger.innerText || '').trim();
                trigger.click();
                await new Promise(r => setTimeout(r, 350));

                const menu = document.querySelector('.agy-overlay[role="menu"], [role="menu"]');
                if (!menu) return { error: '未能打开桌面端模型菜单' };

                const rawItems = Array.from(menu.querySelectorAll('.agy-overlay-item, [role="menuitem"]'));
                const models = [];
                for (const el of rawItems) {
                    const lines = (el.innerText || '').split('\\n').map(s => s.trim()).filter(Boolean);
                    if (lines.length === 0) continue;
                    const name = lines[0];
                    if (/^(查看用量|view usage|usage)$/i.test(name)) continue;

                    const badge = lines.slice(1).join(' · ');
                    const disabled = el.hasAttribute('data-disabled') ||
                                     el.getAttribute('aria-disabled') === 'true' ||
                                     /unavailable|paid pro/i.test(badge);
                    const active = currentModel.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(currentModel.toLowerCase());
                    models.push({ name, badge, disabled, active });
                }

                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
                return { success: true, currentModel, models };
            } catch (err) {
                try { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); } catch (e) {}
                return { error: err.toString() };
            }
        })()`;

        let lastErr = '';
        for (const ctx of cdp.contexts) {
            try {
                const res = await cdp.call("Runtime.evaluate", {
                    expression: EXP,
                    returnByValue: true,
                    awaitPromise: true,
                    contextId: ctx.id
                });
                const val = res.result?.value;
                if (val && val.success) {
                    cachedModels = val.models;
                    cachedModelsAt = Date.now();
                    return val;
                }
                if (val?.error) lastErr = val.error;
            } catch (e) { }
        }
        return { error: lastErr || '获取可用模型列表失败' };
    } finally {
        isUiMenuBusy = false;
    }
}

// Parse Antigravity Usage / Quota panel text into structured groups
function parseQuotaText(rawText) {
    const lines = String(rawText || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const groups = [];
    let currentGroup = null;
    let currentLimit = '';

    for (const line of lines) {
        if (/^(usage|用量)$/i.test(line)) continue;
        if (/models|模型/i.test(line) && !/%/.test(line)) {
            currentGroup = { name: line, items: [] };
            groups.push(currentGroup);
            currentLimit = '';
            continue;
        }
        if (/limit|限制/i.test(line) && !/%/.test(line)) {
            currentLimit = line;
            continue;
        }
        const pctMatch = line.match(/(\d{1,3})\s*%/);
        if (pctMatch) {
            if (!currentGroup) {
                currentGroup = { name: 'Model Quota', items: [] };
                groups.push(currentGroup);
            }
            currentGroup.items.push({
                label: currentLimit || '剩余额度',
                percent: Math.max(0, Math.min(100, Number(pctMatch[1]))),
                rawPercent: line,
                resetIn: ''
            });
            continue;
        }
        const resetMatch = line.match(/^(?:resets?\s+in\s+|重置(?:时间|倒计时)?[:：\s]*)(.+)$/i);
        if (resetMatch && currentGroup && currentGroup.items.length > 0) {
            currentGroup.items[currentGroup.items.length - 1].resetIn = line;
        }
    }
    return groups;
}

// Get Model Remaining Quota from Antigravity 2.0 "View Usage" dialog
async function getModelQuota(cdp, forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && cachedQuota && (now - cachedQuotaAt < 120000)) {
        return { success: true, ...cachedQuota, cached: true };
    }
    if (isUiMenuBusy) {
        if (cachedQuota) return { success: true, ...cachedQuota, stale: true };
        return { success: false, busy: true, error: '桌面端菜单正在操作中，请稍后重试' };
    }
    isUiMenuBusy = true;
    try {

    const EXP = `(async () => {
        try {
            const findUsageBlock = () => {
                const els = Array.from(document.querySelectorAll('div, section'));
                return els.find(el => {
                    const t = el.innerText || '';
                    return t.length < 700 && /%/.test(t) && /limit|限制/i.test(t) && /Gemini|Claude|GPT/i.test(t);
                });
            };

            let block = findUsageBlock();
            let openedByScript = false;

            if (!block) {
                const trigger = document.querySelector('[data-testid="model-selector-trigger"], button[aria-label*="Select model"]');
                if (!trigger) return { error: '未找到桌面端模型选择按钮' };
                const aria = trigger.getAttribute('aria-label') || '';
                if (trigger.disabled || /cannot be changed while the agent is running/i.test(aria)) {
                    return { busy: true, error: '智能体正在生成中，请等待本轮回复结束后刷新' };
                }

                trigger.click();
                await new Promise(r => setTimeout(r, 400));

                const menu = document.querySelector('.agy-overlay[role="menu"], [role="menu"]');
                if (!menu) return { busy: true, error: '未能打开桌面端模型菜单' };

                const usageItem = Array.from(menu.querySelectorAll('.agy-overlay-item, [role="menuitem"], button, a'))
                    .find(el => /view usage|查看用量|usage|quota|额度/i.test(el.innerText || ''));
                if (!usageItem) {
                    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
                    return { error: '未在菜单中找到「查看用量」入口' };
                }

                usageItem.click();
                openedByScript = true;

                for (let i = 0; i < 12; i++) {
                    await new Promise(r => setTimeout(r, 150));
                    block = findUsageBlock();
                    if (block) break;
                }
            }

            const rawText = block ? (block.innerText || '').trim() : '';

            if (openedByScript) {
                const closeBtn = document.querySelector('[role="dialog"] button[aria-label*="Close"], [role="dialog"] button[aria-label*="关闭"], button:has(svg.lucide-x)');
                if (closeBtn) closeBtn.click();
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
                await new Promise(r => setTimeout(r, 150));
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            }

            if (!rawText) return { error: '未读取到用量额度详情' };
            return { success: true, rawText };
        } catch (err) {
            try { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); } catch (e) {}
            return { error: err.toString() };
        }
    })()`;

    let lastRes = null;
    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: EXP,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });
            const val = res.result?.value;
            if (!val) continue;
            lastRes = val;
            if (val.success && val.rawText) {
                const groups = parseQuotaText(val.rawText);
                const payload = {
                    groups,
                    rawText: val.rawText,
                    updatedAt: new Date().toISOString()
                };
                cachedQuota = payload;
                cachedQuotaAt = Date.now();
                return { success: true, ...payload, cached: false };
            }
            if (val.busy) break;
        } catch (e) {}
    }

        if (cachedQuota) {
            return { success: true, ...cachedQuota, stale: true, busy: !!lastRes?.busy };
        }
        return { success: false, busy: !!lastRes?.busy, error: lastRes?.error || '获取模型剩余额度失败' };
    } finally {
        isUiMenuBusy = false;
    }
}

// Simple hash function
function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return hash.toString(36);
}

// Check if a request is from the same Wi-Fi (internal network)
function isLocalRequest(req) {
    // 1. Check for proxy headers (Cloudflare, ngrok, etc.)
    // If these exist, the request is coming via an external tunnel/proxy
    if (req.headers['x-forwarded-for'] || req.headers['x-forwarded-host'] || req.headers['x-real-ip']) {
        return false;
    }

    // 2. Check the remote IP address
    const ip = req.ip || req.socket.remoteAddress || '';

    // Standard local/private IPv4 and IPv6 ranges
    return ip === '127.0.0.1' ||
        ip === '::1' ||
        ip === '::ffff:127.0.0.1' ||
        ip.startsWith('192.168.') ||
        ip.startsWith('10.') ||
        ip.startsWith('172.16.') || ip.startsWith('172.17.') ||
        ip.startsWith('172.18.') || ip.startsWith('172.19.') ||
        ip.startsWith('172.2') || ip.startsWith('172.3') ||
        ip.startsWith('::ffff:192.168.') ||
        ip.startsWith('::ffff:10.');
}

// Initialize CDP connection
async function initCDP() {
    console.log('🔍 Discovering Antigravity CDP endpoint...');
    const cdpInfo = await discoverCDP();
    console.log(`✅ Found Antigravity on port ${cdpInfo.port} `);

    console.log('🔌 Connecting to CDP...');
    cdpConnection = await connectCDP(cdpInfo.url);
    console.log(`✅ Connected! Found ${cdpConnection.contexts.length} execution contexts\n`);
    // Warm up quota cache once in background when idle so mobile sees quota immediately
    setTimeout(() => {
        if (cdpConnection && !cachedQuota) {
            getModelQuota(cdpConnection, false).catch(() => {});
        }
    }, 1500);
}

// Background polling
async function startPolling(wss) {
    let lastErrorLog = 0;
    let isConnecting = false;
    let zeroContextCount = 0;

    const poll = async () => {
        if (!cdpConnection || (cdpConnection.ws && cdpConnection.ws.readyState !== WebSocket.OPEN)) {
            if (!isConnecting) {
                console.log('🔍 Looking for Antigravity CDP connection...');
                isConnecting = true;
            }
            if (cdpConnection) {
                // Was connected, now lost
                console.log('🔄 CDP connection lost. Attempting to reconnect...');
                cdpConnection = null;
            }
            zeroContextCount = 0;
            try {
                await initCDP();
                if (cdpConnection) {
                    console.log('✅ CDP Connection established from polling loop');
                    isConnecting = false;
                }
            } catch (err) {
                // Not found yet, just wait for next cycle
            }
            setTimeout(poll, 2000); // Try again in 2 seconds if not found
            return;
        }

        try {
            const snapshot = await captureSnapshot(cdpConnection);
            if (snapshot && !snapshot.error) {
                zeroContextCount = 0;
                const hash = hashString(snapshot.html);
                const cssHash = snapshot.css ? hashString(snapshot.css) : cachedCSSHash;
                cachedCSSHash = cssHash;
                snapshot.cssHash = cssHash;
                snapshot.htmlHash = hash;

                // Only update if content changed
                if (hash !== lastSnapshotHash) {
                    lastSnapshot = snapshot;
                    lastSnapshotHash = hash;

                    // Broadcast to all connected clients
                    wss.clients.forEach(client => {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify({
                                type: 'snapshot_update',
                                timestamp: new Date().toISOString()
                            }));
                        }
                    });

                    console.log(`📸 Snapshot updated(hash: ${hash})`);
                }
            } else {
                // Snapshot is null or has error
                const now = Date.now();
                if (!lastErrorLog || now - lastErrorLog > 10000) {
                    const errorMsg = snapshot?.error || 'No valid snapshot captured (check contexts)';
                    console.warn(`⚠️  Snapshot capture issue: ${errorMsg} `);
                    if (errorMsg.includes('container not found')) {
                        console.log('   (Tip: Ensure an active chat is open in Antigravity)');
                    }
                    if (cdpConnection.contexts.length === 0) {
                        console.log('   (Tip: No active execution contexts found. Try interacting with the Antigravity window)');
                    }
                    lastErrorLog = now;
                }
                if (cdpConnection.contexts.length === 0) {
                    zeroContextCount++;
                    if (zeroContextCount >= 10) {
                        console.log('🔄 Zero CDP contexts persisted; resetting target discovery...');
                        try { cdpConnection.ws?.close(); } catch (e) {}
                        cdpConnection = null;
                        zeroContextCount = 0;
                    }
                } else {
                    zeroContextCount = 0;
                }
            }
        } catch (err) {
            console.error('Poll error:', err.message);
        }

        setTimeout(poll, POLL_INTERVAL);
    };

    poll();
}

// Create Express app
async function createServer() {
    const app = express();

    // Check for SSL certificates
    const keyPath = join(__dirname, 'certs', 'server.key');
    const certPath = join(__dirname, 'certs', 'server.cert');
    const hasSSL = fs.existsSync(keyPath) && fs.existsSync(certPath);

    let server;
    let httpsServer = null;

    if (hasSSL) {
        const sslOptions = {
            key: fs.readFileSync(keyPath),
            cert: fs.readFileSync(certPath)
        };
        httpsServer = https.createServer(sslOptions, app);
        server = httpsServer;
    } else {
        server = http.createServer(app);
    }

    const wss = new WebSocketServer({ server });

    // Initialize Auth Token using a unique salt from environment
    const authSalt = process.env.AUTH_SALT || 'antigravity_default_salt_99';
    AUTH_TOKEN = hashString(APP_PASSWORD + authSalt);

    app.use(compression());
    app.use(express.json({ limit: '15mb' }));

    // Use a secure session secret from .env if available
    const sessionSecret = process.env.SESSION_SECRET || 'antigravity_secret_key_1337';

    if (sessionSecret === 'antigravity_secret_key_1337') {
        console.warn('\n\x1b[33m%s\x1b[0m', '⚠️  SECURITY WARNING: Using default SESSION_SECRET ("antigravity_secret_key_1337").');
        console.warn('\x1b[33m%s\x1b[0m', '   Set a strong SESSION_SECRET in your .env file for production use.\n');
    }
    app.use(cookieParser(sessionSecret));

    // Ngrok Bypass Middleware
    app.use((req, res, next) => {
        // Tell ngrok to skip the "visit" warning for API requests
        res.setHeader('ngrok-skip-browser-warning', 'true');
        next();
    });

    // Auth Middleware
    app.use((req, res, next) => {
        const publicPaths = ['/login', '/login.html', '/favicon.ico', '/manifest.json', '/icon.svg'];
        if (publicPaths.includes(req.path) || req.path.startsWith('/css/')) {
            return next();
        }

        // Exempt local Wi-Fi devices from authentication
        if (isLocalRequest(req)) {
            return next();
        }

        // Magic Link / QR Code Auto-Login
        if (req.query.key === APP_PASSWORD) {
            res.cookie(AUTH_COOKIE_NAME, AUTH_TOKEN, {
                httpOnly: true,
                signed: true,
                maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
            });
            // Remove the key from the URL by redirecting to the base path
            return res.redirect('/');
        }

        const token = req.signedCookies[AUTH_COOKIE_NAME];
        if (token === AUTH_TOKEN) {
            return next();
        }

        // Only redirect top-level browser page navigations; return 401 JSON for all API calls
        const isPageNavigation = req.method === 'GET' && (
            req.path === '/' ||
            req.path === '/index.html' ||
            req.path.startsWith('/c/')
        );
        if (isPageNavigation && !req.xhr && !req.headers.accept?.includes('json')) {
            res.redirect('/login.html');
        } else {
            res.status(401).json({ error: 'Unauthorized' });
        }
    });

    app.use(express.static(join(__dirname, 'public')));

    // Login endpoint
    app.post('/login', (req, res) => {
        const { password } = req.body;
        if (password === APP_PASSWORD) {
            res.cookie(AUTH_COOKIE_NAME, AUTH_TOKEN, {
                httpOnly: true,
                signed: true,
                maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
            });
            res.json({ success: true });
        } else {
            res.status(401).json({ success: false, error: 'Invalid password' });
        }
    });

    // Logout endpoint
    app.post('/logout', (req, res) => {
        res.clearCookie(AUTH_COOKIE_NAME);
        res.json({ success: true });
    });

    // Get current snapshot (supports cssHash & htmlHash delta caching for ultra-fast mobile updates)
    app.get('/snapshot', (req, res) => {
        if (!lastSnapshot) {
            return res.status(503).json({ error: 'No snapshot available yet' });
        }
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        const clientCssHash = req.query.cssHash;
        const clientHtmlHash = req.query.htmlHash;
        if (clientHtmlHash && lastSnapshot.htmlHash && clientHtmlHash === lastSnapshot.htmlHash) {
            if (!clientCssHash || clientCssHash === lastSnapshot.cssHash) {
                return res.json({
                    unchanged: true,
                    htmlHash: lastSnapshot.htmlHash,
                    cssHash: lastSnapshot.cssHash,
                    stats: lastSnapshot.stats
                });
            }
        }
        if (clientCssHash && lastSnapshot.cssHash && clientCssHash === lastSnapshot.cssHash) {
            return res.json({
                ...lastSnapshot,
                css: null,
                cssCached: true
            });
        }
        res.json(lastSnapshot);
    });

    // Health check endpoint
    app.get('/health', (req, res) => {
        res.json({
            status: 'ok',
            cdpConnected: cdpConnection?.ws?.readyState === 1, // WebSocket.OPEN = 1
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
            https: hasSSL
        });
    });

    // SSL status endpoint
    app.get('/ssl-status', (req, res) => {
        const keyPath = join(__dirname, 'certs', 'server.key');
        const certPath = join(__dirname, 'certs', 'server.cert');
        const certsExist = fs.existsSync(keyPath) && fs.existsSync(certPath);
        res.json({
            enabled: hasSSL,
            certsExist: certsExist,
            message: hasSSL ? 'HTTPS is active' :
                certsExist ? 'Certificates exist, restart server to enable HTTPS' :
                    'No certificates found'
        });
    });

    // Generate SSL certificates endpoint
    app.post('/generate-ssl', async (req, res) => {
        try {
            const { execSync } = await import('child_process');
            execSync('node generate_ssl.js', { cwd: __dirname, stdio: 'pipe' });
            res.json({
                success: true,
                message: 'SSL certificates generated! Restart the server to enable HTTPS.'
            });
        } catch (e) {
            res.status(500).json({
                success: false,
                error: e.message
            });
        }
    });

    // Debug UI Endpoint
    app.get('/debug-ui', async (req, res) => {
        if (!cdpConnection) return res.status(503).json({ error: 'CDP not connected' });
        const uiTree = await inspectUI(cdpConnection);
        console.log('--- UI TREE ---');
        console.log(uiTree);
        console.log('---------------');
        res.type('json').send(uiTree);
    });

    // Set Mode
    app.post('/set-mode', async (req, res) => {
        const { mode } = req.body;
        if (!cdpConnection) return res.status(503).json({ error: 'CDP disconnected' });
        const result = await setMode(cdpConnection, mode);
        res.json(result);
    });

    // Set Model
    app.post('/set-model', async (req, res) => {
        const { model } = req.body;
        if (!cdpConnection) return res.status(503).json({ error: 'CDP disconnected' });
        const result = await setModel(cdpConnection, model);
        res.json(result);
    });

    // Stop Generation
    app.post('/stop', async (req, res) => {
        if (!cdpConnection) return res.status(503).json({ error: 'CDP disconnected' });
        const result = await stopGeneration(cdpConnection);
        res.json(result);
    });

    // Send message
    app.post('/send', async (req, res) => {
        const { message } = req.body;

        if (!message) {
            return res.status(400).json({ error: 'Message required' });
        }

        if (!cdpConnection) {
            return res.status(503).json({ error: 'CDP not connected' });
        }

        const result = await injectMessage(cdpConnection, message);

        // Always return 200 - the message usually goes through even if CDP reports issues
        // The client will refresh and see if the message appeared
        res.json({
            success: result.ok !== false,
            method: result.method || 'attempted',
            details: result
        });
    });

    // UI Inspection endpoint - Returns all buttons as JSON for debugging
    app.get('/ui-inspect', async (req, res) => {
        if (!cdpConnection) return res.status(503).json({ error: 'CDP disconnected' });

        const EXP = `(() => {
    try {
        // Safeguard for non-DOM contexts
        if (typeof window === 'undefined' || typeof document === 'undefined') {
            return { error: 'Non-DOM context' };
        }

        // Helper to get string class name safely (handles SVGAnimatedString)
        function getCls(el) {
            if (!el) return '';
            if (typeof el.className === 'string') return el.className;
            if (el.className && typeof el.className.baseVal === 'string') return el.className.baseVal;
            return '';
        }

        // Helper to pierce Shadow DOM
        function findAllElements(selector, root = document) {
            let results = Array.from(root.querySelectorAll(selector));
            const elements = root.querySelectorAll('*');
            for (const el of elements) {
                try {
                    if (el.shadowRoot) {
                        results = results.concat(Array.from(el.shadowRoot.querySelectorAll(selector)));
                    }
                } catch (e) { }
            }
            return results;
        }

        // Get standard info
        const url = window.location ? window.location.href : '';
        const title = document.title || '';
        const bodyLen = document.body ? document.body.innerHTML.length : 0;
        const hasCascade = !!document.getElementById('cascade') || !!document.querySelector('.cascade');

        // Scan for buttons
        const allLucideElements = findAllElements('svg[class*="lucide"]').map(svg => {
            const parent = svg.closest('button, [role="button"], div, span, a');
            if (!parent || parent.offsetParent === null) return null;
            const rect = parent.getBoundingClientRect();
            return {
                type: 'lucide-icon',
                tag: parent.tagName.toLowerCase(),
                x: Math.round(rect.left),
                y: Math.round(rect.top),
                svgClasses: getCls(svg),
                className: getCls(parent).substring(0, 100),
                ariaLabel: parent.getAttribute('aria-label') || '',
                title: parent.getAttribute('title') || '',
                parentText: (parent.innerText || '').trim().substring(0, 50)
            };
        }).filter(Boolean);

        const buttons = findAllElements('button, [role="button"]').map((btn, i) => {
            const rect = btn.getBoundingClientRect();
            const svg = btn.querySelector('svg');

            return {
                type: 'button',
                index: i,
                x: Math.round(rect.left),
                y: Math.round(rect.top),
                text: (btn.innerText || '').trim().substring(0, 50) || '(empty)',
                ariaLabel: btn.getAttribute('aria-label') || '',
                title: btn.getAttribute('title') || '',
                svgClasses: getCls(svg),
                className: getCls(btn).substring(0, 100),
                visible: btn.offsetParent !== null
            };
        }).filter(b => b.visible);

        return {
            url, title, bodyLen, hasCascade,
            buttons, lucideIcons: allLucideElements
        };
    } catch (err) {
        return { error: err.toString(), stack: err.stack };
    }
})()`;

        try {
            // 1. Get Frames
            const { frameTree } = await cdpConnection.call("Page.getFrameTree");
            function flattenFrames(node) {
                let list = [{
                    id: node.frame.id,
                    url: node.frame.url,
                    name: node.frame.name,
                    parentId: node.frame.parentId
                }];
                if (node.childFrames) {
                    for (const child of node.childFrames) list = list.concat(flattenFrames(child));
                }
                return list;
            }
            const allFrames = flattenFrames(frameTree);

            // 2. Map Contexts
            const contexts = cdpConnection.contexts.map(c => ({
                id: c.id,
                name: c.name,
                origin: c.origin,
                frameId: c.auxData ? c.auxData.frameId : null,
                isDefault: c.auxData ? c.auxData.isDefault : false
            }));

            // 3. Scan ALL Contexts
            const contextResults = [];
            for (const ctx of contexts) {
                try {
                    const result = await cdpConnection.call("Runtime.evaluate", {
                        expression: EXP,
                        returnByValue: true,
                        contextId: ctx.id
                    });

                    if (result.result?.value) {
                        const val = result.result.value;
                        contextResults.push({
                            contextId: ctx.id,
                            frameId: ctx.frameId,
                            url: val.url,
                            title: val.title,
                            hasCascade: val.hasCascade,
                            buttonCount: val.buttons.length,
                            lucideCount: val.lucideIcons.length,
                            buttons: val.buttons, // Store buttons for analysis
                            lucideIcons: val.lucideIcons
                        });
                    } else if (result.exceptionDetails) {
                        contextResults.push({
                            contextId: ctx.id,
                            frameId: ctx.frameId,
                            error: `Script Exception: ${result.exceptionDetails.text} ${result.exceptionDetails.exception?.description || ''} `
                        });
                    } else {
                        contextResults.push({
                            contextId: ctx.id,
                            frameId: ctx.frameId,
                            error: 'No value returned (undefined)'
                        });
                    }
                } catch (e) {
                    contextResults.push({ contextId: ctx.id, error: e.message });
                }
            }

            // 4. Match and Analyze
            const cascadeFrame = allFrames.find(f => f.url.includes('cascade'));
            const matchingContext = contextResults.find(c => c.frameId === cascadeFrame?.id);
            const contentContext = contextResults.sort((a, b) => (b.buttonCount || 0) - (a.buttonCount || 0))[0];

            // Prepare "useful buttons" from the best context
            const bestContext = matchingContext || contentContext;
            const usefulButtons = bestContext ? (bestContext.buttons || []).filter(b =>
                b.ariaLabel?.includes('New Conversation') ||
                b.title?.includes('New Conversation') ||
                b.ariaLabel?.includes('Past Conversations') ||
                b.title?.includes('Past Conversations') ||
                b.ariaLabel?.includes('History')
            ) : [];

            res.json({
                summary: {
                    frameFound: !!cascadeFrame,
                    cascadeFrameId: cascadeFrame?.id,
                    contextFound: !!matchingContext,
                    bestContextId: bestContext?.contextId
                },
                frames: allFrames,
                contexts: contexts,
                scanResults: contextResults.map(c => ({
                    id: c.contextId,
                    frameId: c.frameId,
                    url: c.url,
                    hasCascade: c.hasCascade,
                    buttons: c.buttonCount,
                    error: c.error
                })),
                usefulButtons: usefulButtons,
                bestContextData: bestContext // Full data for the best context
            });

        } catch (e) {
            res.status(500).json({ error: e.message, stack: e.stack });
        }
    });

    // Endpoint to list all CDP targets - helpful for debugging connection issues
    app.get('/cdp-targets', async (req, res) => {
        const results = {};
        for (const port of PORTS) {
            try {
                const list = await getJson(`http://127.0.0.1:${port}/json/list`);
                results[port] = list;
            } catch (e) {
                results[port] = e.message;
            }
        }
        res.json(results);
    });

    wss.on('error', (err) => {
        console.warn('⚠️ WebSocket server error:', err.message);
    });

    // WebSocket connection with Auth check
    wss.on('connection', (ws, req) => {
        ws.on('error', (err) => {
            console.warn('📱 Client WS error (handled safely):', err.message);
        });

        // Parse cookies from headers
        const rawCookies = req.headers.cookie || '';
        const parsedCookies = {};
        rawCookies.split(';').forEach(c => {
            const [k, v] = c.trim().split('=');
            if (k && v) {
                try {
                    parsedCookies[k] = decodeURIComponent(v);
                } catch (e) {
                    parsedCookies[k] = v;
                }
            }
        });

        // Verify signed cookie manually
        const signedToken = parsedCookies[AUTH_COOKIE_NAME];
        let isAuthenticated = false;

        // Exempt local Wi-Fi devices from authentication
        if (isLocalRequest(req)) {
            isAuthenticated = true;
        } else if (signedToken) {
            const sessionSecret = process.env.SESSION_SECRET || 'antigravity_secret_key_1337';

            if (sessionSecret === 'antigravity_secret_key_1337') {
                // Warning already printed on startup, but we check here for token verification
            }

            const token = cookieParser.signedCookie(signedToken, sessionSecret);
            if (token === AUTH_TOKEN) {
                isAuthenticated = true;
            }
        }

        if (!isAuthenticated) {
            console.log('🚫 Unauthorized WebSocket connection attempt');
            ws.send(JSON.stringify({ type: 'error', message: 'Unauthorized' }));
            setTimeout(() => ws.close(), 100);
            return;
        }

        console.log('📱 Client connected (Authenticated)');

        ws.on('close', () => {
            console.log('📱 Client disconnected');
        });
    });

    return { server, wss, app, hasSSL };
}

// Main
async function main() {
    try {
        await initCDP();
    } catch (err) {
        console.warn(`⚠️  Initial CDP discovery failed: ${err.message}`);
        console.log('💡 Start Antigravity with --remote-debugging-port=9000 to connect.');
    }

    try {
        const { server, wss, app, hasSSL } = await createServer();

        // Start background polling (it will now handle reconnections)
        startPolling(wss);

        // Remote Click
        app.post('/remote-click', async (req, res) => {
            const { selector, index, textContent, scope } = req.body;
            if (!cdpConnection) return res.status(503).json({ error: '桌面端 CDP 未连接' });
            const result = await clickElement(cdpConnection, { selector, index, textContent, scope });
            res.json(result);
        });

        // Remote Scroll - sync phone scroll to desktop
        app.post('/remote-scroll', async (req, res) => {
            const { scrollTop, scrollPercent } = req.body;
            if (!cdpConnection) return res.status(503).json({ error: 'CDP disconnected' });
            const result = await remoteScroll(cdpConnection, { scrollTop, scrollPercent });
            res.json(result);
        });

        // Get App State
        app.get('/app-state', async (req, res) => {
            if (!cdpConnection) return res.json({ mode: 'Unknown', model: 'Unknown', isBusy: false, chatTitle: '', pendingActions: [] });
            const result = await getAppState(cdpConnection);
            res.json(result);
        });

        // Get Available Models dynamically
        app.get('/models', async (req, res) => {
            if (!cdpConnection) return res.status(503).json({ error: 'CDP disconnected' });
            const force = req.query.refresh === '1';
            const result = await getAvailableModels(cdpConnection, force);
            res.json(result);
        });

        // Get Model Remaining Quota dynamically
        app.get('/quota', async (req, res) => {
            if (!cdpConnection) return res.status(503).json({ success: false, error: 'CDP disconnected' });
            const force = req.query.refresh === '1';
            const result = await getModelQuota(cdpConnection, force);
            res.json(result);
        });

        // Start New Chat
        app.post('/new-chat', async (req, res) => {
            if (!cdpConnection) return res.status(503).json({ error: 'CDP disconnected' });
            const result = await startNewChat(cdpConnection);
            res.json(result);
        });

        // Get Chat History - Directly from Antigravity Brain on disk (100% reliable)
        app.get('/chat-history', (req, res) => {
            try {
                const homedir = os.homedir();
                const brainDir = join(homedir, '.gemini', 'antigravity', 'brain');
                if (!fs.existsSync(brainDir)) {
                    return res.json({ success: true, chats: [] });
                }

                const folders = fs.readdirSync(brainDir, { withFileTypes: true })
                    .filter(d => d.isDirectory() && d.name !== 'tempmediaStorage');

                const nowMs = Date.now();
                const formatTimeAgo = (ms) => {
                    const diffSec = Math.max(0, Math.floor((nowMs - ms) / 1000));
                    if (diffSec < 60) return '刚刚';
                    const diffMin = Math.floor(diffSec / 60);
                    if (diffMin < 60) return `${diffMin}分钟前`;
                    const diffHour = Math.floor(diffMin / 60);
                    if (diffHour < 24) return `${diffHour}小时前`;
                    const diffDay = Math.floor(diffHour / 24);
                    if (diffDay === 1) return '昨天';
                    if (diffDay < 30) return `${diffDay}天前`;
                    const d = new Date(ms);
                    return `${d.getMonth() + 1}月${d.getDate()}日`;
                };

                const chats = [];
                for (const f of folders) {
                    const convId = f.name;
                    const tPath = join(brainDir, convId, '.system_generated', 'logs', 'transcript.jsonl');
                    let title = '';
                    let mtime = 0;
                    try {
                        if (fs.existsSync(tPath)) {
                            mtime = fs.statSync(tPath).mtimeMs;
                        } else {
                            mtime = fs.statSync(join(brainDir, convId)).mtimeMs;
                        }
                    } catch (e) {}

                    if (fs.existsSync(tPath)) {
                        try {
                            const content = fs.readFileSync(tPath, 'utf8');
                            const lines = content.split('\n').filter(Boolean);
                            for (const line of lines.slice(0, 10)) {
                                const obj = JSON.parse(line);
                                if (obj.content && obj.type === 'USER_INPUT') {
                                    const match = obj.content.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
                                    if (match) {
                                        title = match[1].trim().replace(/\s+/g, ' ').substring(0, 60);
                                        break;
                                    }
                                }
                            }
                        } catch (e) {}
                    }

                    if (!title) {
                        title = `会话 ${convId.substring(0, 8)}`;
                    }

                    const date = new Date(mtime);
                    const timeStr = `${date.getMonth() + 1}月${date.getDate()}日 ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;

                    chats.push({
                        id: convId,
                        title: title,
                        time: mtime,
                        timeStr: timeStr,
                        timeAgo: formatTimeAgo(mtime)
                    });
                }

                chats.sort((a, b) => b.time - a.time);
                res.json({ success: true, chats: chats.slice(0, 30) });
            } catch (err) {
                console.error('chat-history error:', err);
                res.json({ error: '读取历史会话失败: ' + err.message, chats: [] });
            }
        });

        // Helper to build dynamic Antigravity 2.0 conversation URL from live page origin
        async function buildConversationUrl(cdp, convId) {
            let origin = '';
            let projectQuery = '';
            for (const ctx of (cdp?.contexts || [])) {
                try {
                    const r = await cdp.call('Runtime.evaluate', {
                        expression: 'JSON.stringify({ origin: location.origin, search: location.search })',
                        returnByValue: true,
                        contextId: ctx.id
                    });
                    if (r.result?.value) {
                        const info = JSON.parse(r.result.value);
                        if (info.origin && /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(info.origin)) {
                            origin = info.origin;
                            const params = new URLSearchParams(info.search || '');
                            if (params.get('project')) projectQuery = 'project=' + encodeURIComponent(params.get('project'));
                            break;
                        }
                    }
                } catch (e) {}
            }
            if (!origin) return null;
            return projectQuery ? `${origin}/c/${convId}?${projectQuery}` : `${origin}/c/${convId}`;
        }

        // Select a Chat - Navigates Antigravity 2.0 to that conversation
        app.post('/select-chat', async (req, res) => {
            const { title, id } = req.body;
            let convId = id || title;
            if (!convId) return res.status(400).json({ error: 'Chat id required' });
            
            try {
                const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
                if (!uuidRegex.test(convId)) {
                    const homedir = os.homedir();
                    const brainDir = join(homedir, '.gemini', 'antigravity', 'brain');
                    const folders = fs.readdirSync(brainDir, { withFileTypes: true }).filter(d => d.isDirectory() && d.name !== 'tempmediaStorage');
                    for (const f of folders) {
                        const tPath = join(brainDir, f.name, '.system_generated', 'logs', 'transcript.jsonl');
                        if (fs.existsSync(tPath)) {
                            const content = fs.readFileSync(tPath, 'utf8');
                            if (content.includes(title)) {
                                convId = f.name;
                                break;
                            }
                        }
                    }
                }

                if (cdpConnection) {
                    console.log(`[SELECT_CHAT] Navigating to conversation: ${convId}`);
                    const targetUrl = await buildConversationUrl(cdpConnection, convId);
                    if (!targetUrl) return res.status(503).json({ error: 'Unable to determine active Antigravity page origin' });
                    cdpConnection.call("Page.navigate", { url: targetUrl }).catch(() => {});
                    return res.json({ success: true, id: convId });
                }
                res.status(503).json({ error: 'CDP disconnected' });
            } catch (err) {
                console.error('select-chat error:', err);
                res.json({ error: err.message });
            }
        });

        // Close Chat History
        app.post('/close-history', async (req, res) => {
            if (!cdpConnection) return res.status(503).json({ error: 'CDP disconnected' });
            const result = await closeHistory(cdpConnection);
            res.json(result);
        });

        // Check if Chat is Open
        app.get('/chat-status', async (req, res) => {
            if (!cdpConnection) return res.json({ hasChat: false, hasMessages: false, editorFound: false });
            const result = await hasChatOpen(cdpConnection);
            res.json(result);
        });

        // Handle conversation links: /c/:conversationId or /c/*
        app.get('/c/:conversationId?', async (req, res) => {
            const conversationId = req.params.conversationId || req.url.split('/c/')[1]?.split('?')[0];
            try {
                if (cdpConnection && conversationId) {
                    console.log(`[NAV] Switching conversation to: ${conversationId}`);
                    const targetUrl = await buildConversationUrl(cdpConnection, conversationId);
                    if (targetUrl) {
                        cdpConnection.call("Page.navigate", {
                            url: targetUrl
                        }).catch(() => {});
                    }
                }
            } catch (err) {
                console.error('[NAV] Error navigating to conversation:', err);
            }
            res.redirect('/');
        });

        // List all active Antigravity CDP window targets
        app.get('/targets', async (req, res) => {
            try {
                const targets = await listCDPTargets();
                res.json({ success: true, targets });
            } catch (err) {
                res.status(500).json({ success: false, error: err.message, targets: [] });
            }
        });

        // Switch active Antigravity CDP window target
        app.post('/switch-target', async (req, res) => {
            const { wsUrl } = req.body || {};
            if (!wsUrl) return res.status(400).json({ success: false, error: '缺少目标窗口 wsUrl 参数' });
            try {
                await switchCDPTarget(wsUrl);
                res.json({ success: true });
            } catch (err) {
                res.status(400).json({ success: false, error: err.message });
            }
        });

        // Upload & attach image to Antigravity composer via CDP DOM.setFileInputFiles
        app.post('/upload-image', async (req, res) => {
            if (!cdpConnection) return res.status(503).json({ success: false, error: '桌面端 CDP 未连接' });
            const { dataBase64, mimeType, fileName, caption } = req.body || {};
            if (!dataBase64 || typeof dataBase64 !== 'string') {
                return res.status(400).json({ success: false, error: '缺少图片数据' });
            }

            const extMap = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' };
            const cleanMime = String(mimeType || 'image/png').toLowerCase().split(';')[0].trim();
            const ext = extMap[cleanMime] || '.png';
            const cleanBase64 = dataBase64.replace(/^data:image\/[a-z0-9+.-]+;base64,/i, '');
            const buf = Buffer.from(cleanBase64, 'base64');
            if (!buf.length || buf.length > 12 * 1024 * 1024) {
                return res.status(400).json({ success: false, error: '图片无效或超过 12MB 上限' });
            }

            const safeBase = String(fileName || 'mobile_image').replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.[^.]+$/, '') || 'mobile_image';
            const tmpFile = join(os.tmpdir(), `ag_upload_${Date.now()}_${safeBase}${ext}`);
            fs.writeFileSync(tmpFile, buf);
            setTimeout(() => { try { fs.unlinkSync(tmpFile); } catch (e) {} }, 120000);

            try {
                // Reject early if desktop agent is currently generating (avoids leaving stray attachments)
                for (const ctx of cdpConnection.contexts) {
                    const busyRes = await cdpConnection.call('Runtime.evaluate', {
                        contextId: ctx.id,
                        returnByValue: true,
                        expression: `!!(() => {
                            const c = document.querySelector('[data-testid="input-cancel-button"], button[aria-label*="取消"], [data-tooltip-id="input-send-button-cancel-tooltip"]');
                            return c && c.offsetParent !== null;
                        })()`
                    }).catch(() => null);
                    if (busyRes?.result?.value === true) {
                        try { fs.unlinkSync(tmpFile); } catch (e) {}
                        return res.json({ success: false, details: { reason: 'busy' }, attached: false });
                    }
                }

                await cdpConnection.call('DOM.enable', {});
                const doc = await cdpConnection.call('DOM.getDocument', { depth: -1 });
                let fileNode = await cdpConnection.call('DOM.querySelector', {
                    nodeId: doc.root.nodeId,
                    selector: 'input[type="file"]'
                }).catch(() => ({ nodeId: 0 }));

                if (!fileNode?.nodeId) {
                    try { fs.unlinkSync(tmpFile); } catch (e) {}
                    return res.status(404).json({ success: false, error: '未找到桌面端文件上传控件' });
                }

                await cdpConnection.call('DOM.setFileInputFiles', {
                    nodeId: fileNode.nodeId,
                    files: [tmpFile]
                });

                await new Promise(r => setTimeout(r, 450));

                if (caption && String(caption).trim()) {
                    const sendRes = await injectMessage(cdpConnection, String(caption).trim());
                    if (sendRes.ok === false) {
                        await cdpConnection.call('DOM.setFileInputFiles', { nodeId: fileNode.nodeId, files: [] }).catch(() => {});
                    }
                    return res.json({ success: sendRes.ok !== false, details: sendRes, attached: sendRes.ok !== false });
                }

                // Trigger send if user sent image without text caption
                let sent = false;
                for (const ctx of cdpConnection.contexts) {
                    const clickRes = await cdpConnection.call('Runtime.evaluate', {
                        contextId: ctx.id,
                        returnByValue: true,
                        awaitPromise: true,
                        expression: `(async () => {
                            const cancel = document.querySelector('[data-testid="input-cancel-button"], button[aria-label*="取消"], [data-tooltip-id="input-send-button-cancel-tooltip"]');
                            if (cancel && cancel.offsetParent !== null) return { ok: false, reason: 'busy' };
                            const btn = document.querySelector('[data-testid="send-button"]') || document.querySelector('button[aria-label*="发送"]');
                            if (btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true') {
                                btn.click();
                                return { ok: true };
                            }
                            return { ok: false };
                        })()`
                    }).catch(() => null);
                    if (clickRes?.result?.value?.ok) {
                        sent = true;
                        break;
                    }
                    if (clickRes?.result?.value?.reason === 'busy') {
                        await cdpConnection.call('DOM.setFileInputFiles', { nodeId: fileNode.nodeId, files: [] }).catch(() => {});
                        return res.json({ success: false, details: { reason: 'busy' }, attached: false });
                    }
                }
                return res.json({ success: true, attached: true, autoSent: sent });
            } catch (err) {
                return res.status(500).json({ success: false, error: err.message });
            }
        });

        // Resolve active Git repository root for workspace diff inspection
        async function resolveGitRoot() {
            const candidates = [
                process.env.WORKSPACE_PATH,
                process.cwd(),
                join(__dirname, '..'),
                __dirname
            ].filter(Boolean);

            for (const dir of candidates) {
                if (!fs.existsSync(dir)) continue;
                try {
                    const { stdout } = await execFileAsync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { timeout: 3000 });
                    const root = stdout.trim();
                    if (root && fs.existsSync(root)) return root;
                } catch (e) {}
            }
            return null;
        }

        // Workspace Git status summary
        app.get('/git-status', async (req, res) => {
            try {
                const gitRoot = await resolveGitRoot();
                if (!gitRoot) {
                    return res.json({ success: true, isGitRepo: false, branch: '', files: [] });
                }

                const [{ stdout: branchOut }, { stdout: statusOut }, { stdout: numstatOut }] = await Promise.all([
                    execFileAsync('git', ['-C', gitRoot, 'branch', '--show-current'], { timeout: 3000 }).catch(() => ({ stdout: '' })),
                    execFileAsync('git', ['-C', gitRoot, 'status', '--porcelain=v1', '-uall'], { timeout: 5000 }),
                    execFileAsync('git', ['-C', gitRoot, 'diff', '--numstat', 'HEAD'], { timeout: 5000 }).catch(() => ({ stdout: '' }))
                ]);

                const statsMap = new Map();
                numstatOut.split(/\r?\n/).filter(Boolean).forEach(line => {
                    const [ins, del, ...rest] = line.split('\t');
                    const filePath = rest.join('\t');
                    if (filePath) statsMap.set(filePath, { ins: ins === '-' ? 0 : Number(ins) || 0, del: del === '-' ? 0 : Number(del) || 0 });
                });

                const files = statusOut.split(/\r?\n/).filter(Boolean).map(line => {
                    const code = line.slice(0, 2);
                    let filePath = line.slice(3).trim();
                    if (filePath.includes(' -> ')) filePath = filePath.split(' -> ').pop().trim();
                    filePath = filePath.replace(/^"|"$/g, '');
                    const stat = statsMap.get(filePath) || { ins: 0, del: 0 };
                    return {
                        status: code.trim() || 'M',
                        path: filePath,
                        insertions: stat.ins,
                        deletions: stat.del
                    };
                }).slice(0, 80);

                res.json({
                    success: true,
                    isGitRepo: true,
                    rootName: gitRoot.split(/[\\/]/).pop(),
                    branch: branchOut.trim() || 'HEAD',
                    files
                });
            } catch (err) {
                res.status(500).json({ success: false, error: err.message, files: [] });
            }
        });

        // Workspace single-file Git diff viewer
        app.get('/git-diff', async (req, res) => {
            const relFile = String(req.query.file || '').trim();
            if (!relFile || relFile.includes('..') || relFile.startsWith('/') || /^[a-zA-Z]:/.test(relFile)) {
                return res.status(400).json({ success: false, error: '文件路径非法' });
            }
            try {
                const gitRoot = await resolveGitRoot();
                if (!gitRoot) return res.status(404).json({ success: false, error: '当前工作区不是 Git 仓库' });

                const { stdout: statusOut } = await execFileAsync('git', ['-C', gitRoot, 'status', '--porcelain=v1', '--', relFile], { timeout: 3000 });
                if (!statusOut.trim()) {
                    return res.status(404).json({ success: false, error: '该文件当前没有未提交改动' });
                }

                let diffText = '';
                if (statusOut.startsWith('??')) {
                    const absPath = join(gitRoot, relFile);
                    const st = fs.existsSync(absPath) ? fs.statSync(absPath) : null;
                    if (!st || st.isDirectory()) {
                        diffText = '(新目录或已移除，暂不支持文本 Diff)';
                    } else if (st.size > 512 * 1024) {
                        diffText = `(新增文件过大：${Math.round(st.size / 1024)} KB，暂不支持全文预览)`;
                    } else {
                        const rawBuf = fs.readFileSync(absPath);
                        if (rawBuf.includes(0)) {
                            diffText = '(新增二进制文件，暂不支持文本 Diff)';
                        } else {
                            const content = rawBuf.toString('utf8').split(/\r?\n/).slice(0, 250);
                            diffText = `--- /dev/null\n+++ b/${relFile}\n@@ -0,0 +1,${content.length} @@\n` + content.map(l => '+' + l).join('\n');
                        }
                    }
                } else {
                    const { stdout } = await execFileAsync('git', ['-C', gitRoot, 'diff', 'HEAD', '--', relFile], { timeout: 5000, maxBuffer: 1024 * 1024 }).catch(async () => {
                        return execFileAsync('git', ['-C', gitRoot, 'diff', '--', relFile], { timeout: 5000, maxBuffer: 1024 * 1024 });
                    });
                    diffText = stdout || '(二进制文件或无文本差异)';
                }

                if (diffText.length > 80000) {
                    diffText = diffText.slice(0, 80000) + '\n\n... (内容过长已截断显示)';
                }

                res.json({ success: true, file: relFile, diff: diffText });
            } catch (err) {
                res.status(500).json({ success: false, error: err.message });
            }
        });

        // Kill any existing process on the port before starting
        await killPortProcess(SERVER_PORT);

        // Start server
        const localIP = getLocalIP();
        const protocol = hasSSL ? 'https' : 'http';
        server.listen(SERVER_PORT, '0.0.0.0', () => {
            console.log(`🚀 Server running on ${protocol}://${localIP}:${SERVER_PORT}`);
            if (hasSSL) {
                console.log(`💡 First time on phone? Accept the security warning to proceed.`);
            }
        });

        // Graceful shutdown handlers
        const gracefulShutdown = (signal) => {
            console.log(`\n🛑 Received ${signal}. Shutting down gracefully...`);
            wss.close(() => {
                console.log('   WebSocket server closed');
            });
            server.close(() => {
                console.log('   HTTP server closed');
            });
            if (cdpConnection?.ws) {
                cdpConnection.ws.close();
                console.log('   CDP connection closed');
            }
            setTimeout(() => process.exit(0), 1000);
        };

        process.on('SIGINT', () => gracefulShutdown('SIGINT'));
        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

    } catch (err) {
        console.error('❌ Fatal error:', err.message);
        process.exit(1);
    }
}

process.on('uncaughtException', (err) => {
    console.warn('⚠️ Uncaught exception (prevented server crash):', err.message);
});

process.on('unhandledRejection', (reason) => {
    console.warn('⚠️ Unhandled rejection:', reason?.message || reason);
});

main();
