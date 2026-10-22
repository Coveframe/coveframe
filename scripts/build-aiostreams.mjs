// Build-time only. End users receive the compiled runtime and need no compiler or pnpm.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, cp, access, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const run = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const revision = 'ce6244454ee131bf0945b2bd6abc670a449b224d';
const source = join(root, 'artifacts/upstream/aiostreams-2.36.0');
const prepared = process.argv.indexOf('--prepared');
const output = resolve(process.argv[2] || join(root, 'artifacts/aiostreams-windows-2.36.0'));
try { await access(output); throw Error('Output exists; choose a new build directory.'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const execute = (file, args, cwd = source) => run(file, args, { cwd, windowsHide: true, timeout: 900000, maxBuffer: 4 * 1024 * 1024 });
try { await access(source); }
catch { await execute('git', ['clone', '--depth', '1', '--branch', 'v2.36.0', 'https://github.com/Viren070/AIOStreams.git', source], root); }
if ((await execute('git', ['rev-parse', 'HEAD'])).stdout.trim() !== revision) throw Error('Unexpected AIOStreams revision');
// This upstream version has no configurable bind address. Preserve loopback isolation.
const serverPath = join(source, 'packages/server/src/server.ts');
const originalListen = 'app.listen(appConfig.bootstrap.port, (error) => {';
const loopbackListen = "app.listen(appConfig.bootstrap.port, '127.0.0.1', (error) => {";
let server = await readFile(serverPath, 'utf8');
if (!server.includes(loopbackListen) && !server.includes(originalListen)) throw Error('Listen patch no longer matches');
await writeFile(serverPath, server.replace(originalListen, loopbackListen));
const workspacePath = join(source, 'pnpm-workspace.yaml');
const workspace = await readFile(workspacePath, 'utf8');
await writeFile(workspacePath, workspace.replace("'@aiostreams/crypto': set this to true or false", "'@aiostreams/crypto': true"));
await mkdir(output, { recursive: true });
const runtime = join(output, 'runtime');
if (prepared !== -1) {
  await cp(resolve(process.argv[prepared + 1]), runtime, { recursive: true, errorOnExist: true });
} else {
  const npm = join(process.env.ProgramFiles, 'nodejs/node_modules/npm/bin/npm-cli.js');
  const pnpm = args => execute(process.execPath, [npm, 'exec', '--yes', '--package', 'pnpm@11.0.8', '--', 'pnpm', ...args]);
  await pnpm(['install', '--frozen-lockfile']);
  await pnpm(['run', 'build']);
  await pnpm(['--config.block-exotic-subdeps=false', '--config.node-linker=hoisted', '--filter', '@aiostreams/server', 'deploy', '--prod', '--legacy', join(runtime, 'server')]);
}
for (const name of ['frontend', 'web']) await cp(join(source, 'packages', name, 'dist'), join(runtime, name, 'dist'), { recursive: true });
await copyFile(join(source, 'LICENSE'), join(output, 'LICENSE-AIOStreams'));
const patches = (await execute('git', ['diff', '--', 'packages/server/src/server.ts', 'pnpm-workspace.yaml'])).stdout;
await writeFile(join(output, 'media-hub.patch'), patches);
await execute('git', ['archive', '--format=zip', '--output=' + join(output, 'corresponding-source.zip'), 'HEAD']);
await copyFile(fileURLToPath(import.meta.url), join(output, 'build-aiostreams.mjs'));
await writeFile(join(output, 'BUILD.txt'), `AIOStreams v2.36.0\nSource: https://github.com/Viren070/AIOStreams\nRevision: ${revision}\nLicense: AGPL-3.0; corresponding source and local patch included.\nBuild prerequisites: Node 24, Windows x64 C++ Build Tools, Python.\nRecipe: apply media-hub.patch to corresponding-source.zip; pnpm 11 install --frozen-lockfile; pnpm run build; pnpm --config.block-exotic-subdeps=false --config.node-linker=hoisted --filter @aiostreams/server deploy --prod --legacy <destination>/runtime/server; copy packages/frontend/dist and packages/web/dist to runtime/frontend/dist and runtime/web/dist. Native package install scripts must run.\nMedia Hub patch binds the server to 127.0.0.1. This package does not include user configurations or keys.\n`);
const archive = output + '.zip';
const ps = "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; $p=([Console]::In.ReadToEnd()|ConvertFrom-Json); [IO.Compression.ZipFile]::CreateFromDirectory($p.source,$p.archive,[IO.Compression.CompressionLevel]::Optimal,$false)";
await new Promise((yes, no) => {
  const child = execFile(join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, timeout: 180000 }, error => error ? no(error) : yes());
  child.stdin.end(JSON.stringify({ source: output, archive }));
});
process.stdout.write(JSON.stringify({ archive, sha256: createHash('sha256').update(await readFile(archive)).digest('hex') }) + '\n');
