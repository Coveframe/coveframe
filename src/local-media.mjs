import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, access, readdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { createWindowsVault } from './windows-vault.mjs';
import { obtainMediaPackage, extractMediaPackage, mediaPackages } from './media-packages.mjs';
import { provisionJellyfin, validateHousehold, moonbaseId } from './jellyfin-setup.mjs';
import {applyMoonfinPreferences} from './moonfin-preferences.mjs';
import {recommendedPreferences} from './preferences.mjs';
import { startPlaybackGateway } from './playback-gateway.mjs';
import { writeLibraryItem,validateLibraryItem } from './library-items.mjs';
import {connectDownloadLibrary} from './download-library.mjs';
import { makePrivateDirectory } from './private-directory.mjs';
import {createHomeNetwork} from './home-network.mjs';

const baseUrl = 'http://127.0.0.1:18798';
const auth = 'MediaBrowser Client="Media Hub", Device="Local wizard", DeviceId="media-hub-owned-runtime", Version="0.2.0"';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function createLocalMedia({ directory, cacheDirectory } = {}) {
  const root = join(directory, 'Media');
  const vault = createWindowsVault(join(root, 'Secrets'));
  let secrets = await vault.read();
  let child;
  let job;
  let abort;
  let systemToken, gateway;
  let state = { phase: 'not-started', message: 'Set up Jellyfin and Moonbase on this PC.', streamingReady: false, beforeSignIn: 'deferred' };
  const tv=await createHomeNetwork({directory:join(root,'HomeNetwork'),isMediaRunning:()=>state.phase==='running',onAddress:async address=>{
    if(state.phase!=='running'||!systemToken)return;
    const route=`/Plugins/${moonbaseId}/Configuration`,config=await request(route,'GET',undefined,systemToken);
    await request(route,'POST',{...config,WebDefaultServerUrl:address||baseUrl,WebForcedServerUrl:address?'':baseUrl},systemToken);
    state={...state,localOnly:!address};
  }});
  async function request(route, method = 'GET', data, token) {
    const response = await fetch(baseUrl + route, { method, redirect: 'error', signal: AbortSignal.any([abort.signal, AbortSignal.timeout(20000)]),
      headers: { Authorization: auth + (token ? `, Token="${token}"` : ''), ...(token ? { 'X-Emby-Token': token } : {}), 'Content-Type': 'application/json' },
      body: data === undefined ? undefined : JSON.stringify(data) });
    if (!response.ok) {
      const error = Error('Jellyfin setup did not complete. Your isolated data has been preserved.');
      error.setupStep = route.split('?')[0]; error.httpStatus = response.status; throw error;
    }
    if (response.status === 204) return null;
    const bytes = await response.text();
    if (bytes.length > 2097152) throw Error('Jellyfin response was too large');
    if (route === '/health') return bytes;
    return bytes ? JSON.parse(bytes) : null;
  }
  async function stopChild() {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const owned = child;
    let timer;
    const exited = new Promise(resolve => owned.once('exit', resolve));
    owned.kill();
    await Promise.race([exited, new Promise(resolve => { timer = setTimeout(resolve, 10000); })]);
    clearTimeout(timer);
    if (owned.exitCode === null && owned.signalCode === null) throw Error('The isolated Jellyfin process did not stop. Close it before restarting setup.');
    child = null;
  }
  async function applyMetadata(keys) {
    if (state.phase !== 'running' || !systemToken) return false;
    const config = await request(`/Plugins/${moonbaseId}/Configuration`, 'GET', undefined, systemToken);
    await request(`/Plugins/${moonbaseId}/Configuration`, 'POST', { ...config, TmdbApiKey: keys.tmdb || '', MdblistApiKey: keys.mdblist || '' }, systemToken);
    state = { ...state, metadata: { tmdbConfigured: Boolean(keys.tmdb), mdblistConfigured: Boolean(keys.mdblist) } };
    return true;
  }
  async function applyPreferences(preferences) {
    if(state.phase!=='running' || !systemToken)return false;
    state={...state,preferences:undefined,preferencesError:false};
    const users=await request('/Users','GET',undefined,systemToken);
    const names=new Set(state.profiles.map(x=>x.toLowerCase()));
    await applyMoonfinPreferences({request:(path,method,data)=>request(path,method,data,systemToken),
      viewerIds:users.filter(x=>names.has(x.Name.toLowerCase())).map(x=>x.Id),preferences});
    state={...state,preferences:structuredClone(preferences)};
    return true;
  }
  async function run(household, metadataKeys, preferences) {
    try {
      state = { ...state, phase: 'preparing', message: 'Checking the isolated folder and server port…' };
      // Never adopt an existing listener, even if it speaks Jellyfin.
      await new Promise((resolve, reject) => {
        const check = createServer();
        check.once('error', () => reject(Error('Port 18798 is already in use. No existing server was changed.')));
        check.listen(18798, '0.0.0.0', () => check.close(resolve));
      });
      await mkdir(root, { recursive: true });
      const marker = join(root, 'installation.json');
      try {
        const identity = JSON.parse(await readFile(marker, 'utf8'));
        if(identity.app==='media-hub-windows'&&!secrets.installationId&&(await readdir(root)).every(name=>['Secrets','Library','installation.json'].includes(name))){
          secrets={installationId:identity.id,systemPassword:randomBytes(32).toString('base64url')};
        }
        if (identity.app !== 'media-hub-windows' || identity.id !== secrets.installationId) throw Error('The isolated installation identity does not match. Preserve its files for recovery.');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        if ((await readdir(root)).some(name => name !== 'Secrets')) throw Error('This folder already contains files from another setup. No files were replaced.');
        secrets = { ...secrets, installationId: randomUUID(), systemPassword: randomBytes(32).toString('base64url') };
        await vault.write(secrets);
        await writeFile(marker, JSON.stringify({ app: 'media-hub-windows', id: secrets.installationId }), { flag: 'wx' });
      }
      secrets.household = household;
      await vault.write(secrets); // Persist retry credentials before any account is created.
      await makePrivateDirectory(root);
      for (const id of ['jellyfin', 'moonbase']) {
        const target = id === 'jellyfin' ? join(root, 'Packages', `jellyfin-${mediaPackages[id].version}`)
          : join(root, 'Data', 'plugins', `Moonbase_${mediaPackages[id].version}`);
        try { await access(join(target, '.media-hub-complete')); }
        catch (error) {
          if (error.code !== 'ENOENT') throw error;
          state = { ...state, phase: 'downloading', message: `Downloading and verifying ${id === 'jellyfin' ? 'Jellyfin' : 'Moonbase'}…` };
          const archive = await obtainMediaPackage(id, join(root, 'Downloads'), { cacheDirectory, signal: abort.signal });
          await mkdir(join(target, '..'), { recursive: true });
          const staging = target + '-' + randomUUID();
          await extractMediaPackage(archive, staging, { signal: abort.signal });
          await writeFile(join(staging, '.media-hub-complete'), mediaPackages[id].sha256, { flag: 'wx' });
          await rename(staging, target);
        }
      }
      for (const name of ['Data', 'Config', 'Cache', 'Logs', 'Library/Movies', 'Library/TV']) await mkdir(join(root, name), { recursive: true });
      const network = join(root, 'Config', 'network.xml');
      try { await access(network); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        await writeFile(network, '<?xml version="1.0" encoding="utf-8"?><NetworkConfiguration><InternalHttpPort>18798</InternalHttpPort><PublicHttpPort>18798</PublicHttpPort><EnableHttps>false</EnableHttps><EnableIPv4>true</EnableIPv4><EnableIPv6>false</EnableIPv6><AutoDiscovery>false</AutoDiscovery><EnableUPnP>false</EnableUPnP><EnableRemoteAccess>false</EnableRemoteAccess><LocalNetworkAddresses><string>127.0.0.1</string></LocalNetworkAddresses></NetworkConfiguration>', { flag: 'wx' });
      }
      state = { ...state, phase: 'starting', message: 'Starting your separate Jellyfin server…' };
      const binary = join(root, 'Packages', `jellyfin-${mediaPackages.jellyfin.version}`, 'jellyfin');
      child = spawn(join(binary, 'jellyfin.exe'),
        ['--service', '--datadir', join(root, 'Data'), '--configdir', join(root, 'Config'), '--cachedir', join(root, 'Cache'), '--logdir', join(root, 'Logs'),
          '--webdir', join(binary, 'jellyfin-web'), '--ffmpeg', join(binary, 'ffmpeg.exe')],
        { windowsHide: true, stdio: 'ignore', cwd: root });
      let spawnFailed = false;
      child.once('error', () => { spawnFailed = true; });
      child.once('exit',()=>{
        if(!abort.signal.aborted&&state.phase==='running'){
          state={...state,phase:'failed',message:'Jellyfin stopped unexpectedly. Start your media apps again.',streamingReady:false};
          tv.stop().catch(()=>{});
        }
      });
      let ready = false;
      for (let attempt = 0; attempt < 90; attempt++) {
        abort.signal.throwIfAborted();
        if (spawnFailed || child.exitCode !== null) throw Error('Jellyfin could not start. Its isolated logs are preserved on this PC.');
        try { if ((await request('/health')).trim() === 'Healthy') { ready = true; break; } } catch {}
        await delay(1000);
      }
      if (!ready) throw Error('Jellyfin did not become ready in time. Try again after checking this PC.');
      state = { ...state, phase: 'configuring', message: 'Creating household profiles and connecting Moonbase…' };
      const result = await provisionJellyfin({ request, systemPassword: secrets.systemPassword, household, libraryRoot: join(root, 'Library'), onAuthenticated: token => { systemToken = token; } });
      state = { ...state, ...result, phase: 'running', message: 'Jellyfin and Moonbase are running on this PC. Streaming and TV access still need setup.',
        url: baseUrl, moonfinUrl: baseUrl + '/Moonfin/Web/', localOnly: true, pid: child.pid };
      await applyMetadata(metadataKeys);
      try{await applyPreferences(preferences);}catch{state={...state,preferencesError:true};}
      await tv.resume();
    } catch (error) {
      try { await stopChild(); } catch {}
      state = { ...state, phase: abort.signal.aborted ? 'stopped' : 'failed', message: abort.signal.aborted ? 'Media setup stopped. Reopen Media Hub to continue.' : error.message || 'Media setup failed. Preserve its files for recovery.', streamingReady: false,
        ...(error.setupStep ? { diagnostic: { step: error.setupStep, status: error.httpStatus } } : {}) };
    }
  }
  function start(household, metadataKeys = {}, preferences = recommendedPreferences().moonfin) {
      validateHousehold(household);
      if (job || state.phase === 'running') throw Error('Media setup is already running.');
      abort = new AbortController();
      state = { ...state, phase: 'preparing', message: 'Preparing your media apps…' };
      job = run(household, metadataKeys, preferences).finally(() => { job = null; });
      return { ok: true };
  }
  return {
    status: () => ({ ...structuredClone(state), localOnly:tv.status().phase!=='running', network:tv.status(), canResume: Boolean(secrets.household), ...(secrets.household ? { savedProfileCount:secrets.household.profiles } : {}) }),
    start,
    resume(keys,preferences) { if (!secrets.household) throw Error('Create your household first.'); return start(secrets.household, keys,preferences); },
    applyMetadata,
    applyPreferences,
    homeNetwork(action,data){if(!['scan','enable','disable','check'].includes(action))throw Error('Choose a supported TV action.');return tv[action](data);},
    removeHomeNetworkPermission:()=>tv.removePermission(),
    async withDiscoveryAdmin(operation) {
      if (state.phase !== 'running' || !systemToken) throw Error('Start your media apps first.');
      const users = await request('/Users', 'GET', undefined, systemToken);
      const names = new Set(state.profiles.map(x => x.toLowerCase()));
      return operation({ password: secrets.systemPassword, viewerIds: users.filter(x => names.has(x.Name.toLowerCase())).map(x => x.Id) });
    },
    async connectDiscovery() {
      if (state.phase !== 'running' || !systemToken) throw Error('Start your media apps first.');
      const path = `/Plugins/${moonbaseId}/Configuration`;
      const config = await request(path,'GET',undefined,systemToken);
      await request(path,'POST',{...config,SeerrEnabled:true,SeerrUrl:'http://127.0.0.1:18802',SeerrDisplayName:'Discover',EnableSettingsSync:true},systemToken);
      state = {...state, discoveryConfigured:true};
    },
    async connectSources(streams) {
      if (state.phase !== 'running') throw Error('Start the media apps first.');
      if (!gateway) {
        if (!secrets.gatewayToken) { secrets.gatewayToken = randomBytes(32).toString('hex'); await vault.write(secrets); }
        gateway = await startPlaybackGateway({ token: secrets.gatewayToken, streams });
      }
      state = { ...state, gatewayRunning: true };
    },
    async addLibraryItem(info) {
      if (state.phase !== 'running' || !gateway) throw Error('Connect the source apps first.');
      const id = info.type === 'series' ? `${info.imdbId}:${info.season}:${info.episode}` : info.imdbId;
      const receipt = await writeLibraryItem({ libraryRoot: join(root, 'Library'), info, link: gateway.link(info.type,id) });
      await request('/Library/Refresh', 'POST', undefined, systemToken);
      return { ...receipt, scanRequested: true };
    },
    async addLibraryItems(items){
      if(state.phase!=='running'||!gateway)throw Error('Connect the source apps first.');
      if(!Array.isArray(items)||!items.length||items.length>100)throw Error('Choose a movie or a season with up to 100 aired episodes.');
      items.forEach(validateLibraryItem);
      for(const info of items){
        const id=info.type==='series'?`${info.imdbId}:${info.season}:${info.episode}`:info.imdbId;
        await writeLibraryItem({libraryRoot:join(root,'Library'),info,link:gateway.link(info.type,id)});
      }
      await request('/Library/Refresh','POST',undefined,systemToken);
      return {added:true,count:items.length,scanRequested:true,playbackVerified:false};
    },
    async connectDownloadRoot(type,path){
      if(state.phase!=='running'||!systemToken)throw Error('Start your media apps first.');
      return connectDownloadLibrary({request:(route,method,data)=>request(route,method,data,systemToken),type,path});
    },
    async stop() {
      abort?.abort();
      await tv.stop();
      if (gateway) { await gateway.close(); gateway = null; }
      if (job) await job;
      await stopChild();
      if (state.phase === 'running') state = { ...state, phase: 'stopped', message: 'Media apps stopped. Reopen setup to start them again.' };
    },
  };
}
