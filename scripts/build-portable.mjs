import { mkdir, readFile, writeFile, copyFile, cp, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { mediaPackages } from '../src/media-packages.mjs';

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(await readFile(join(root,'package.json'),'utf8')).version;
const output = join(root, 'artifacts', `Coveframe-${version}-windows-x64`);
const runtime = 'node-v24.15.0-win-x64';
const expected = 'cc5149eabd53779ce1e7bdc5401643622d0c7e6800ade18928a767e940bb0e62';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
if (process.platform !== 'win32') throw Error('Build the Windows launcher on Windows');
try { await access(output); throw Error('Build folder already exists. Preserve it and choose a new version before rebuilding.'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const cache = join(root, 'artifacts', 'downloads');
await mkdir(cache, { recursive: true });
const archive = join(cache, runtime + '.zip');
try { await access(archive); }
catch {
  const response = await fetch(`https://nodejs.org/dist/v24.15.0/${runtime}.zip`, { signal: AbortSignal.timeout(120000), redirect: 'error' });
  if (!response.ok) throw Error('Official Node runtime download failed');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (sha(bytes) !== expected) throw Error('Official runtime checksum did not match');
  await writeFile(archive, bytes, { flag: 'wx' });
}
if (sha(await readFile(archive)) !== expected) throw Error('Cached runtime checksum did not match');
const powershell = join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
// Paths are separate argv values, not interpolated PowerShell commands.
await run(powershell, ['-NoProfile', '-NonInteractive', '-File', join(root, 'scripts', 'package-portable.ps1'), '-Root', root, '-Output', output, '-Archive', archive], { windowsHide: true, timeout: 120000 });
await mkdir(join(output, 'src'), { recursive: true });
await mkdir(join(output, 'bin'));
for (const file of ['onboarding', 'setup-plan', 'setup-preview', 'provider-accounts', 'windows-vault', 'connections', 'setup-server',
  'integration-guide','local-media','jellyfin-setup','media-packages','aio-runtime','aiostreams-setup','local-debrid','playback-gateway','setup-directory',
  'home-network','windows-home-network','home-media-gateway',
  'library-items','metadata-connections','private-directory','seerr-runtime','seerr-setup','package-links','preferences','moonfin-preferences',
  'discovery-catalog','download-connections','download-library','automatic-downloads','managed-downloads','app-lifecycle']) {
  await copyFile(join(root, 'src', file + '.mjs'), join(output, 'src', file + '.mjs'));
}
await copyFile(join(root, 'bin', 'start-local.mjs'), join(output, 'bin', 'start-local.mjs'));
await cp(join(root, 'ui'), join(output, 'ui'), { recursive: true });
await cp(join(root, 'assets'), join(output, 'assets'), { recursive: true });
await mkdir(join(output, 'docs'));
await copyFile(join(root, 'docs', 'TV-SETUP.md'), join(output, 'docs', 'TV-SETUP.md'));
await copyFile(join(root, 'launcher', 'README-FIRST.txt'), join(output, 'READ ME FIRST.txt'));
for(const file of ['RELEASE-NOTES.md','README.md','THIRD-PARTY.md','LICENSE'])await copyFile(join(root,file),join(output,file));
await mkdir(join(output,'packages'));
for(const id of ['aiostreams','seerr']) {
  const pkg=mediaPackages[id], source=join(root,'artifacts',pkg.file);
  if(sha(await readFile(source))!==pkg.sha256)throw Error(`Bundled ${id} checksum did not match`);
  await copyFile(source,join(output,'packages',pkg.file));
}
await writeFile(join(output, 'build.json'), JSON.stringify({ name: 'Coveframe', version,
  runtime: { name: runtime, sha256: expected, source: `https://nodejs.org/dist/v24.15.0/${runtime}.zip` },
  packages:mediaPackages,scope: 'Public beta: local streaming wizard, optional downloads and Private-network TV setup; physical TV and boot unqualified', signed: false, builtAt: new Date().toISOString() }, null, 2) + '\n');
await run(powershell, ['-NoProfile', '-NonInteractive', '-File', join(root, 'scripts', 'package-portable.ps1'), '-Root', root, '-Output', output, '-ZipOnly'], { windowsHide: true, timeout: 600000 });
const zip = output + '.zip';
const checksum = sha(await readFile(zip));
await writeFile(zip + '.sha256', checksum + '  ' + zip.split(/[\\/]/).pop() + '\n', { flag: 'wx' });
process.stdout.write(JSON.stringify({ directory: output, zip, sha256: checksum }) + '\n');
