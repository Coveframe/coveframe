import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, access, writeFile, rename, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { createWindowsVault } from './windows-vault.mjs';
import { obtainMediaPackage, extractMediaPackage, mediaPackages } from './media-packages.mjs';
import { provisionAio,updateAioPreferences } from './aiostreams-setup.mjs';
import {recommendedPreferences} from './preferences.mjs';
import { makePrivateDirectory } from './private-directory.mjs';

const base = 'http://127.0.0.1:18800';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function createAioRuntime({ directory, cacheDirectory }) {
  const root = join(directory, 'AIOStreams');
  const vault = createWindowsVault(join(root, 'Secrets'));
  let secrets = await vault.read();
  let child, job, abort;
  const operatorSession={};
  let state = { phase: 'not-started', configured: false, playbackVerified: false };
  async function request(path, method = 'GET', body, headers = {}) {
    const response = await fetch(base + path, { method, redirect: 'error', signal: AbortSignal.any([abort.signal, AbortSignal.timeout(45000)]),
      headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!response.ok) throw Object.assign(Error(`Local AIOStreams setup returned HTTP ${response.status}. Its data has been preserved.`),
      {httpStatus:response.status,retryAfter:Number(response.headers.get('retry-after'))});
    const bytes = await response.text();
    if (bytes.length > 4 * 1024 * 1024) throw Error('AIOStreams response was too large.');
    return { data: bytes ? JSON.parse(bytes) : null, cookie: response.headers.getSetCookie().map(x => x.split(';')[0]).join('; ') };
  }
  async function stopChild() {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const owned = child;
    const exited = new Promise(resolve => owned.once('exit', resolve));
    let timer;
    owned.kill();
    await Promise.race([exited, new Promise(resolve => { timer = setTimeout(resolve, 10000); })]);
    clearTimeout(timer);
    if (owned.exitCode === null && owned.signalCode === null) throw Error('The isolated AIOStreams process did not stop.');
    child = null;
  }
  async function run(options) {
    try {
      if (!child || child.exitCode !== null || child.signalCode !== null) {
        await new Promise((yes, no) => {
          const probe = createServer();
          probe.once('error', () => no(Error('Port 18800 is occupied. No existing app was changed.')));
          probe.listen(18800, '0.0.0.0', () => probe.close(yes));
        });
        await mkdir(root, { recursive: true });
        const marker = join(root, 'installation.json');
        try {
          const identity = JSON.parse(await readFile(marker, 'utf8'));
          if (identity.id !== secrets.installationId || identity.app !== 'media-hub-aiostreams') throw Error('AIOStreams installation identity does not match.');
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
          if ((await readdir(root)).some(x => x !== 'Secrets')) throw Error('Preserve the existing AIOStreams directory for recovery.');
          secrets = { installationId: randomUUID(), secretKey: randomBytes(32).toString('hex'),
            operatorPassword: randomBytes(32).toString('base64url'), accountPassword: randomBytes(32).toString('base64url') };
          await vault.write(secrets);
          await writeFile(marker, JSON.stringify({ id: secrets.installationId, app: 'media-hub-aiostreams' }), { flag: 'wx' });
        }
        await makePrivateDirectory(root);
        const target = join(root, 'Packages', mediaPackages.aiostreams.version);
        try { await access(join(target, '.media-hub-complete')); }
        catch (error) {
          if (error.code !== 'ENOENT') throw error;
          const archive = await obtainMediaPackage('aiostreams', join(root, 'Downloads'), { cacheDirectory, signal: abort.signal });
          await mkdir(join(target, '..'), { recursive: true });
          const staging = target + '-' + randomUUID();
          await extractMediaPackage(archive, staging, { signal: abort.signal });
          await writeFile(join(staging, '.media-hub-complete'), mediaPackages.aiostreams.sha256);
          await rename(staging, target);
        }
        const working = join(root, 'Data');
        await mkdir(working, { recursive: true });
        // Only necessary Windows runtime variables are inherited. No credentials in argv or logs.
        const env = Object.fromEntries(['SystemRoot', 'WINDIR', 'PATH', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'ProgramData']
          .filter(x => process.env[x]).map(x => [x, process.env[x]]));
        Object.assign(env, { NODE_ENV: 'production', LOG_LEVEL:'error', LOG_SENSITIVE_INFO:'false', PORT: '18800', BASE_URL: base, INTERNAL_URL: base,
          SECRET_KEY: secrets.secretKey, DATABASE_URI: 'sqlite://./data/db.sqlite',
          AIOSTREAMS_AUTH: `MediaHubSystem:${secrets.operatorPassword}`, AIOSTREAMS_AUTH_PERMISSIONS: 'MediaHubSystem=admin' });
        delete operatorSession.cookie;
        child = spawn(process.execPath, [join(target, 'runtime/server/dist/server.js')], { windowsHide: true, stdio: 'ignore', cwd: working, env });
        let failed = false;
        child.once('error', () => { failed = true; });
        let healthy = false;
        for (let i = 0; i < 90; i++) {
          abort.signal.throwIfAborted();
          if (failed || child.exitCode !== null || child.signalCode !== null) throw Error('AIOStreams could not start. No provider was changed.');
          try { if ((await request('/api/v1/health')).data?.success) { healthy = true; break; } } catch {}
          await wait(1000);
        }
        if (!healthy) throw Error('AIOStreams did not become healthy in time.');
      }
      if (options.clear) {
        const login = await request('/api/v1/auth/login', 'POST', { username: 'MediaHubSystem', password: secrets.operatorPassword });
        if (!login.data?.success || !login.cookie) throw Error('Could not clear the local AIOStreams connections.');
        const cleared = await request('/api/v1/user', 'PUT', { config: { presets: [], services: [], sortCriteria: { global: [] }, formatter: { id: 'prism' } } },
          { Cookie: login.cookie, Authorization: 'Basic ' + Buffer.from(`${secrets.account.uuid}:${secrets.accountPassword}`).toString('base64') });
        if (!cleared.data?.success) throw Error('Could not clear the local AIOStreams connections.');
        await stopChild();
        state = { phase: 'stopped', configured: false, playbackVerified: false, message: 'Local source connections cleared.' };
        return;
      }
      state = { ...state, phase: 'configuring', message: 'Connecting the selected accounts to local AIOStreams…' };
      const result = await provisionAio({ request, ...options, operatorPassword: secrets.operatorPassword,
        accountPassword: secrets.accountPassword, account: secrets.account,session:operatorSession });
      secrets.account = result.account;
      await vault.write(secrets);
      state = { ...result.receipt, phase: 'running', message: 'AIOStreams is connected. Playback still needs a real-content test.', localOnly: true,
        preferences:structuredClone(options.preferences||recommendedPreferences().aio) };
    } catch (error) {
      try { await stopChild(); } catch {}
      state = { phase: abort.signal.aborted ? 'stopped' : 'failed', configured: false,
        message: abort.signal.aborted ? 'AIOStreams setup stopped. Its data is preserved.' : error.message, playbackVerified: false };
      if (options.clear) throw Error('AIOStreams connections could not be cleared. Retry before changing the saved account.');
    }
  }
  return {
    status: () => structuredClone(state),
    async applyPreferences(preferences) {
      if(job)throw Error('Wait for AIOStreams setup to finish before saving.');
      if(state.phase!=='running' || !secrets.account)return false;
      state={...state,preferences:undefined};
      // Reserve the same job slot used by start/forget/stop. No process restart.
      job=updateAioPreferences({request,operatorPassword:secrets.operatorPassword,account:secrets.account,
        accountPassword:secrets.accountPassword,preferences,session:operatorSession}).then(()=>{state={...state,preferences:structuredClone(preferences)};return true;});
      try{return await job;}finally{job=null;}
    },
    start(options) {
      if (job) throw Error('AIOStreams setup is already in progress.');
      abort = new AbortController();
      state = { ...state, phase: 'preparing', message: 'Preparing local AIOStreams…' };
      job = run(options).finally(() => { job = null; });
      return { ok: true };
    },
    async forget() {
      if (job) throw Error('Wait for source setup to finish before changing an account.');
      if (!secrets.account) return;
      abort = new AbortController();
      job = run({ clear: true }).finally(() => { job = null; });
      await job;
    },
    async streams(type, id) {
      if (state.phase !== 'running' || !secrets.account) throw Error('Connect AIOStreams first.');
      if (!['movie', 'series'].includes(type) || !/^tt\d{5,12}(?::\d{1,4}:\d{1,5})?$/.test(id)) throw Error('Choose a valid movie or episode ID.');
      const account = secrets.account;
      return (await request(`/stremio/${encodeURIComponent(account.uuid)}/${encodeURIComponent(account.encryptedPassword)}/stream/${type}/${encodeURIComponent(id)}.json`)).data;
    },
    async stop() { abort?.abort(); if (job) {try{await job;}catch{}} await stopChild(); state = { ...state, phase: 'stopped' }; },
  };
}
