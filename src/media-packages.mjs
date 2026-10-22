import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const mediaPackages = Object.freeze({
  radarr:{version:'6.4.4.10685',file:'Radarr.master.6.4.4.10685.windows-core-x64.zip',url:'https://github.com/Radarr/Radarr/releases/download/v6.4.4.10685/Radarr.master.6.4.4.10685.windows-core-x64.zip',sha256:'316c3c7e5edaab75f5497d919bc556da259d966f9497a465d484cd49df28afe9',maxBytes:150000000},
  sonarr:{version:'4.0.20.3014',file:'Sonarr.main.4.0.20.3014.win-x64.zip',url:'https://github.com/Sonarr/Sonarr/releases/download/v4.0.20.3014/Sonarr.main.4.0.20.3014.win-x64.zip',sha256:'40ffa15710d791e71ab787e152610602e4e0d9ce4c2316e3b618c3c3d265d2af',maxBytes:145000000},
  prowlarr:{version:'2.6.5.5623',file:'Prowlarr.master.2.6.5.5623.windows-core-x64.zip',url:'https://github.com/Prowlarr/Prowlarr/releases/download/v2.6.5.5623/Prowlarr.master.2.6.5.5623.windows-core-x64.zip',sha256:'7d8dfc745ab784fa3d9cd56522b29f2a6b53a2b72701adc295fe148f9d466699',maxBytes:145000000},
  decypharr:{version:'2.7',file:'decypharr-2.7-Windows_x86_64.zip',url:'https://github.com/sirrobot01/decypharr/releases/download/v2.7/decypharr_Windows_x86_64.zip',sha256:'574975f4932119ca79925220614318444c4c2854d9224859cc63a1d15cc60396',maxBytes:20000000},
  jellyfin: { version: '12.2', file: 'jellyfin_12.2-amd64.zip',
    url: 'https://repo.jellyfin.org/files/server/windows/stable/v12.2/amd64/jellyfin_12.2-amd64.zip',
    sha256: 'ab247745b54cea9af2460c3d62622f5f30a323b02b92d11cea501b67b9a8d83f', maxBytes: 260000000 },
  moonbase: { version: '2.4.0.0', file: 'Moonfin.Server-2.4.0.0.zip',
    url: 'https://github.com/Moonfin-Client/Plugin/releases/download/2.4.0/Moonfin.Server-2.4.0.0.zip',
    sha256: '2dadff3d8f4f797e18b394bf9825173f9bc2f49022d6a0220ef5fb6eb4fbd35b', maxBytes: 85000000 },
  aiostreams: { version: '2.36.0', file: 'aiostreams-windows-2.36.0.zip',
    sha256: 'c2e95930589f5c6bfc0fff3a1ad0e1b3014efeb82ea6cfabc8c6d68f39f33660', maxBytes: 100000000 },
  seerr: { version: '3.5.1', file: 'seerr-windows-3.5.1.zip',
    sha256: 'fca3195e563f27b79be923e96b9920edec159f3477b1c8fbc49b95776d8418d8', maxBytes: 500000000 },
});
const digest = data => createHash('sha256').update(data).digest('hex');

export async function obtainMediaPackage(id, directory, { transport = fetch, cacheDirectory, signal } = {}) {
  const pkg = mediaPackages[id];
  if (!pkg) throw Error('Unsupported media package');
  await mkdir(directory, { recursive: true });
  const target = join(directory, pkg.file);
  for (const candidate of [target, ...(cacheDirectory ? [join(cacheDirectory, pkg.file)] : []), fileURLToPath(new URL(`../packages/${pkg.file}`, import.meta.url))]) {
    try {
      const bytes = await readFile(candidate);
      if (digest(bytes) !== pkg.sha256) throw Error('Package checksum mismatch');
      if (candidate !== target) await writeFile(target, bytes, { flag: 'wx' });
      return target;
    } catch (error) { if (error.code !== 'ENOENT') throw Error('Cached package verification failed. Preserve it for inspection.'); }
  }
  if (!pkg.url) throw Error('A bundled media package is missing. Download the complete Media Hub package.');
  const response = await transport(pkg.url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(300000)]) : AbortSignal.timeout(300000) });
  if (!response.ok || !response.body) throw Error('Official package download failed. Try again later.');
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > pkg.maxBytes) { await response.body.cancel?.().catch(() => {}); throw Error('Package exceeds its expected size'); }
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  if (digest(bytes) !== pkg.sha256) throw Error('Package checksum mismatch. No software was started.');
  const temporary = join(directory, `download-${randomBytes(10).toString('hex')}.tmp`);
  try { await writeFile(temporary, bytes, { flag: 'wx' }); await rename(temporary, target); }
  finally { await rm(temporary, { force: true }); }
  return target;
}

export async function extractMediaPackage(archive, destination, { signal } = {}) {
  // Only verified, pinned archives reach this function. Validate entries again before extraction.
  try { await access(destination); throw Error('Preserve the existing extraction directory'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const script = `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; $p=([Console]::In.ReadToEnd()|ConvertFrom-Json); $root=[IO.Path]::GetFullPath($p.destination).TrimEnd('\\')+'\\'; $z=[IO.Compression.ZipFile]::OpenRead($p.archive); try { foreach($e in $z.Entries) { $full=[IO.Path]::GetFullPath([IO.Path]::Combine($root,$e.FullName)); if(-not $full.StartsWith($root,[StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid archive path' } } } finally { $z.Dispose() }; [IO.Compression.ZipFile]::ExtractToDirectory($p.archive,$p.destination)`;
  // Paths are stdin JSON, never shell interpolation.
  await new Promise((resolve, reject) => {
    const child = execFile(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 600000, maxBuffer: 4096, signal },
      error => error ? reject(Error('Could not unpack this media package. Preserve its files and retry.')) : resolve());
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify({ archive, destination }));
  });
}
