import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// DPAPI CurrentUser: portable app, signed-in Windows user. Not a service credential store.
function transform(value, decrypt) {
  if (process.platform !== 'win32') return Promise.reject(Error('Windows credential protection is required'));
  const operation = decrypt ? 'Unprotect' : 'Protect';
  const script = `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $inputBytes=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $outputBytes=[Security.Cryptography.ProtectedData]::${operation}($inputBytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($outputBytes))`;
  return new Promise((resolve, reject) => {
    const child = spawn(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const output = [];
    let size = 0;
    const timer = setTimeout(() => { child.kill(); }, 15000);
    child.stdout.on('data', data => { size += data.length; if (size > 131072) child.kill(); else output.push(data); });
    child.stderr.resume(); // Never surface PowerShell diagnostics which could contain input.
    child.stdin.on('error', () => {});
    child.on('error', () => { clearTimeout(timer); reject(Error('Windows credential protection failed')); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0 || size > 131072) reject(Error('Windows credential protection failed'));
      else resolve(Buffer.from(Buffer.concat(output).toString('utf8').trim(), 'base64'));
    });
    child.stdin.end(Buffer.from(value).toString('base64'));
  });
}

export function createWindowsVault(directory) {
  const file = join(directory, 'accounts.dpapi');
  return {
    async read() {
      let encrypted;
      try { encrypted = await readFile(file); }
      catch (error) { if (error.code === 'ENOENT') return {}; throw Error('Cannot read saved accounts'); }
      try { return JSON.parse((await transform(encrypted, true)).toString('utf8')); }
      catch { throw Error('Cannot unlock saved accounts for this Windows user. Keep the original file for recovery.'); }
    },
    async write(value) {
      const encrypted = await transform(Buffer.from(JSON.stringify(value)), false);
      await mkdir(directory, { recursive: true });
      const temporary = join(directory, `accounts-${randomUUID()}.dpapi`);
      try {
        await writeFile(temporary, encrypted, { flag: 'wx', mode: 0o600 });
        await rename(temporary, file);
      } finally { await rm(temporary, { force: true }); }
    },
  };
}
