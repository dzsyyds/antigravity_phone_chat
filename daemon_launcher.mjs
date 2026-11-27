#!/usr/bin/env node
import 'dotenv/config';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PID_FILE = join(__dirname, 'daemon.pid');
const LOG_FILE = join(__dirname, 'daemon.log');
const STATE_FILE = join(__dirname, 'tunnel_state.json');
const INFO_FILE = join(__dirname, '连接信息.txt');
const PORT = String(process.env.PORT || '3000');
const CPOLAR_REGION = String(process.env.CPOLAR_REGION || 'cn_top').trim();
const CPOLAR_SUBDOMAIN = String(process.env.CPOLAR_SUBDOMAIN || '').trim();

function isPidAlive(pid) {
    if (!pid || !Number.isInteger(pid) || pid <= 0) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

if (fs.existsSync(PID_FILE)) {
    const existingPid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
    if (existingPid && existingPid !== process.pid && isPidAlive(existingPid)) {
        process.exit(0);
    }
}

fs.writeFileSync(PID_FILE, String(process.pid), 'utf8');
// Rotate log if older than 2MB
try {
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > 2 * 1024 * 1024) {
        fs.writeFileSync(LOG_FILE, '', 'utf8');
    }
} catch {}

function appendLog(tag, text) {
    const line = `[${new Date().toLocaleString('zh-CN', { hour12: false })}] [${tag}] ${text}\n`;
    try { fs.appendFileSync(LOG_FILE, line, 'utf8'); } catch {}
}

function getLocalLanIP() {
    const nets = os.networkInterfaces();
    for (const [name, list] of Object.entries(nets)) {
        if (/vmware|virtual|vbox|meta|loopback|vethernet/i.test(name)) continue;
        for (const iface of list || []) {
            if (iface.family === 'IPv4' && !iface.internal && !iface.address.startsWith('169.254.')) {
                return iface.address;
            }
        }
    }
    return '127.0.0.1';
}

function findCpolarBinary() {
    const candidates = [
        process.env.CPOLAR_PATH,
        join(__dirname, 'cpolar.exe'),
        join(__dirname, '..', 'mobile-agent-webui', 'cpolar.exe'),
        'cpolar.exe'
    ].filter(Boolean);
    for (const p of candidates) {
        if (p === 'cpolar.exe' || fs.existsSync(p)) return p;
    }
    return null;
}

const cleanEnv = { ...process.env };
delete cleanEnv.HTTP_PROXY;
delete cleanEnv.HTTPS_PROXY;
delete cleanEnv.ALL_PROXY;
delete cleanEnv.http_proxy;
delete cleanEnv.https_proxy;
delete cleanEnv.all_proxy;
cleanEnv.NO_PROXY = '*';

let shuttingDown = false;
let serverChild = null;
let cpolarChild = null;
let currentPublicUrl = '';

function writeConnectionInfo(publicUrl = currentPublicUrl) {
    currentPublicUrl = publicUrl;
    const lanIp = getLocalLanIP();
    const localUrl = `http://${lanIp}:${PORT}`;
    const updatedAt = new Date().toISOString();
    try {
        fs.writeFileSync(STATE_FILE, JSON.stringify({
            publicUrl: currentPublicUrl,
            localUrl,
            port: Number(PORT),
            daemonPid: process.pid,
            updatedAt
        }, null, 2), 'utf8');
    } catch {}

    const lines = [
        '==================================================',
        '  Antigravity 掌上控制台 - 当前可用访问地址',
        '==================================================',
        `更新时间: ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
        `守护进程 PID: ${process.pid}`,
        '',
        `[1] 公网 HTTPS 地址（手机/平板 5G/图书馆通用，支持语音）:`,
        `    ${currentPublicUrl || '正在分配中，请稍候 3 秒再查看...'}`,
        '',
        `[2] 校园网/局域网内网地址（免密码直连）:`,
        `    ${localUrl}`,
        '',
        '提示：本后台进程已脱离 Antigravity 对话独立运行，重启 IDE 不会断线换网址。',
        '=================================================='
    ];
    try { fs.writeFileSync(INFO_FILE, lines.join('\r\n'), 'utf8'); } catch {}
}

function startServerChild() {
    if (shuttingDown) return;
    appendLog('daemon', 'Starting server.js...');
    serverChild = spawn(process.execPath, [join(__dirname, 'server.js')], {
        cwd: __dirname,
        env: cleanEnv,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
    });
    serverChild.stdout.on('data', (chunk) => appendLog('server', chunk.toString().trimEnd()));
    serverChild.stderr.on('data', (chunk) => appendLog('server:err', chunk.toString().trimEnd()));
    serverChild.on('exit', (code) => {
        appendLog('daemon', `server.js exited with code ${code}`);
        serverChild = null;
        if (!shuttingDown) setTimeout(startServerChild, 3000);
    });
}

function startCpolarChild() {
    if (shuttingDown) return;
    const bin = findCpolarBinary();
    if (!bin) {
        appendLog('daemon', 'cpolar.exe not found; running LAN-only mode.');
        writeConnectionInfo('');
        return;
    }
    const args = ['http', PORT, '-region', CPOLAR_REGION, '-log', 'stdout'];
    if (CPOLAR_SUBDOMAIN) {
        args.push('-subdomain', CPOLAR_SUBDOMAIN);
    }
    appendLog('daemon', `Starting cpolar: ${bin} ${args.join(' ')}`);
    cpolarChild = spawn(bin, args, {
        cwd: dirname(bin) === '.' ? __dirname : dirname(bin),
        env: cleanEnv,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
    });
    const onCpolarOutput = (chunk) => {
        const text = chunk.toString();
        const match = text.match(/https:\/\/[a-z0-9.-]+\.cpolar\.[a-z]+/i);
        if (match && match[0] !== currentPublicUrl) {
            appendLog('cpolar', `Tunnel established: ${match[0]}`);
            writeConnectionInfo(match[0]);
        }
    };
    cpolarChild.stdout.on('data', onCpolarOutput);
    cpolarChild.stderr.on('data', onCpolarOutput);
    cpolarChild.on('exit', (code) => {
        appendLog('daemon', `cpolar exited with code ${code}`);
        cpolarChild = null;
        if (!shuttingDown) setTimeout(startCpolarChild, 4000);
    });
}

function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    appendLog('daemon', 'Shutting down daemon and child processes...');
    try { if (serverChild) serverChild.kill(); } catch {}
    try { if (cpolarChild) cpolarChild.kill(); } catch {}
    try { if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE); } catch {}
    setTimeout(() => process.exit(0), 500);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

writeConnectionInfo('');
startServerChild();
setTimeout(startCpolarChild, 1200);
