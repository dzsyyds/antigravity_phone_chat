import { spawn } from 'child_process';

let manualEnabled = false;
let autoBusyEnabled = false;
let psHolder = null;
let stopRequested = false;

const PS_SCRIPT = [
    '$sig = @"',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public static class SleepGuard {',
    '  [DllImport("kernel32.dll")]',
    '  public static extern uint SetThreadExecutionState(uint esFlags);',
    '}',
    '"@',
    'Add-Type -TypeDefinition $sig -ErrorAction SilentlyContinue',
    '[SleepGuard]::SetThreadExecutionState([uint32]"0x80000001") | Out-Null',
    'while ($true) { Start-Sleep -Seconds 30; [SleepGuard]::SetThreadExecutionState([uint32]"0x80000001") | Out-Null }'
].join('\n');

function syncHolder() {
    const active = manualEnabled || autoBusyEnabled;
    if (process.platform !== 'win32') return;

    if (active && !psHolder && !stopRequested) {
        try {
            const child = spawn('powershell.exe', [
                '-NoProfile',
                '-NonInteractive',
                '-WindowStyle', 'Hidden',
                '-Command', PS_SCRIPT
            ], {
                windowsHide: true,
                stdio: 'ignore'
            });
            child.on('exit', () => {
                if (psHolder === child) psHolder = null;
            });
            child.on('error', () => {
                if (psHolder === child) psHolder = null;
            });
            psHolder = child;
        } catch {
            psHolder = null;
        }
    } else if (!active && psHolder) {
        try { psHolder.kill(); } catch {}
        psHolder = null;
    }
}

export function setManualKeepAwake(enabled) {
    manualEnabled = Boolean(enabled);
    syncHolder();
    return getKeepAwakeState();
}

export function setAutoBusyKeepAwake(isBusy) {
    const next = Boolean(isBusy);
    if (autoBusyEnabled !== next) {
        autoBusyEnabled = next;
        syncHolder();
    }
}

export function getKeepAwakeState() {
    return {
        supported: process.platform === 'win32',
        manualEnabled,
        autoBusyEnabled,
        active: Boolean((manualEnabled || autoBusyEnabled) && process.platform === 'win32')
    };
}

export function stopKeepAwake() {
    stopRequested = true;
    manualEnabled = false;
    autoBusyEnabled = false;
    if (psHolder) {
        try { psHolder.kill(); } catch {}
        psHolder = null;
    }
}
