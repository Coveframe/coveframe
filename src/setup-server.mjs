import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createConnections } from './connections.mjs';
import { createWindowsVault } from './windows-vault.mjs';
import { renderSetupPreview } from './setup-preview.mjs';
import { getSetupCatalog } from './onboarding.mjs';
import { composeSetupPlan, saveSetupPlan } from './setup-plan.mjs';
import { createLocalMedia } from './local-media.mjs';
import { validateHousehold } from './jellyfin-setup.mjs';
import { createAioRuntime } from './aio-runtime.mjs';
import { validateLibraryItem } from './library-items.mjs';
import { createMetadataConnections } from './metadata-connections.mjs';
import { createSeerrRuntime } from './seerr-runtime.mjs';
import {createPreferences,recommendedPreferences} from './preferences.mjs';
import {createDownloadConnections} from './download-connections.mjs';
import {validateSelection} from './discovery-catalog.mjs';
import {createManagedDownloads} from './managed-downloads.mjs';
import {createAppLifecycle} from './app-lifecycle.mjs';

async function body(request) {
  if (request.headers['content-type'] !== 'application/json') throw { status: 415 };
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 16384) throw { status: 413 };
    chunks.push(chunk);
  }
  const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw { status: 400 };
  return data;
}

export async function startSetupServer({ port = 18797, directory, appDirectory, connections, media, aio, discovery, downloadConnections,managedDownloads,cacheDirectory, instanceId = 'test', onStop = () => {} } = {}) {
  if (!directory) throw Error('A private data directory is required');
  const lifecycle=await createAppLifecycle({directory,appDirectory});
  const accounts = connections || await createConnections({ vault: createWindowsVault(directory) });
  const mediaApps = media || await createLocalMedia({ directory, cacheDirectory });
  const sources = aio || await createAioRuntime({ directory, cacheDirectory });
  const discover = discovery || await createSeerrRuntime({directory,cacheDirectory,media:mediaApps});
  const downloads=downloadConnections||await createDownloadConnections({vault:createWindowsVault(join(directory,'Downloads'))});
  const managed=managedDownloads||await createManagedDownloads({directory,cacheDirectory,downloads,withCredentials:(selected,operation)=>accounts.withCredentials(selected,operation),linkLibrary:(type,path)=>mediaApps.connectDownloadRoot(type,path)});
  let libraryBusy=false;
  let lifecycleBusy=false,activeMutations=0,removed=false;
  async function stopApps(){
    // One failed stop must not strand its siblings. Errors never include raw vendor output.
    const results=await Promise.allSettled([managed,discover,sources,mediaApps].map(app=>Promise.resolve().then(()=>app.stop())));
    if(results.some(result=>result.status==='rejected'))throw Error('Some apps could not stop. Retry Stop all apps before removing anything.');
  }
  const settings=await createPreferences(directory);
  const settingsBusy=new Set();
  const settingsView=()=>{
    const preferences=settings.read();
    const application=Object.fromEntries([['moonfin',mediaApps],['aio',sources]].map(([section,runtime])=>{
      const state=runtime.status();
      return [section,state.phase==='running' && Object.entries(preferences[section]).every(([key,value])=>state.preferences?.[key]===value)?'applied':'pending'];
    }));
    return {preferences,defaults:recommendedPreferences(),application};
  };
  const metadata = await createMetadataConnections({ vault: createWindowsVault(join(directory,'Metadata')),
    apply: keys => mediaApps.applyMetadata ? mediaApps.applyMetadata(keys) : false });
  let savedPlan = null;
  try { savedPlan = JSON.parse(await readFile(join(directory, 'setup.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw Error('Cannot read saved setup. Preserve the original file for recovery.'); }
  const token = randomBytes(32).toString('hex');
  let url;
  const server = createServer(async (request, response) => {
    let mutation=false;
    const nonce = randomBytes(24).toString('hex');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`);
    const send = (status, value, html = false) => {
      response.writeHead(status, { 'Content-Type': html ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8' });
      response.end(html ? value : JSON.stringify(value));
    };
    try {
      const pageNavigation = request.method === 'GET' && request.url === '/' && request.headers['sec-fetch-mode'] === 'navigate';
      if (request.headers.host !== new URL(url).host ||
          request.headers.origin && request.headers.origin !== url ||
          request.headers['sec-fetch-site'] === 'cross-site' && !pageNavigation) return send(403, { error: 'Open Media Hub using its local launcher.' });
      if (request.method === 'GET' && request.url === '/health') return send(200, { app: 'media-hub-local-setup', version: 1, instanceId });
      if (request.method === 'GET' && request.url === '/') return send(200, await renderSetupPreview({ localSetup: { token, nonce } }), true);
      if (request.headers['x-media-hub-token'] !== token) return send(403, { error: 'Reopen the local setup page and try again.' });
      if(removed)return send(410,{error:'Media Hub was uninstalled. Close this tab.'});
      if(request.method==='GET'&&request.url==='/api/system')return send(200,{...await lifecycle.review(),downloadStorage:managed.status().storagePath||null,
        running:[['Jellyfin + Moonfin',mediaApps,18798],['AIOStreams',sources,18800],['Discovery',discover,18802],['Download apps',managed,'18803–18806']].map(([name,app,port])=>({name,phase:app.status().phase,address:'127.0.0.1',port})),
        releaseNotes:'/api/release-notes',sourceUrl:'https://github.com/Coveframe/coveframe'});
      if(request.method==='GET'&&request.url==='/api/release-notes')return send(200,{text:await readFile(new URL('../RELEASE-NOTES.md',import.meta.url),'utf8')});
      if(request.method==='POST'&&['/api/apps/stop','/api/uninstall'].includes(request.url)){
        const data=await body(request),uninstall=request.url==='/api/uninstall';
        if(lifecycleBusy||activeMutations)return send(409,{error:'Wait for the current action to finish, then try again.'});
        if(Object.keys(data).some(key=>!uninstall||key!=='confirmation')||uninstall&&data.confirmation!=='REMOVE MEDIA HUB')return send(400,{error:'Confirm removal before uninstalling.'});
        lifecycleBusy=true;
        try{
          await stopApps();
          if(!uninstall)return send(200,{ok:true});
          const result=await lifecycle.uninstall(data);removed=true;
          response.once('finish',()=>{close().then(onStop).catch(()=>{});});
          return send(200,result);
        }catch{return send(422,{error:'The action did not finish. Retry Stop all apps, then review the app folders before trying again. Your media files were kept.'});}
        finally{lifecycleBusy=false;}
      }
      if(request.method==='POST'){
        if(lifecycleBusy)return send(409,{error:'Wait for apps to stop before starting another action.'});
        activeMutations++;mutation=true;
      }
      if (request.method === 'GET' && request.url === '/api/state') return send(200, { plan: savedPlan, accounts: accounts.status(), media: mediaApps.status(), sources: sources.status(), metadata: metadata.status(), discovery:discover.status(),downloads:downloads.status(),managedDownloads:managed.status(),settings:settingsView() });
      const automaticMatch=request.url.match(/^\/api\/downloads\/automatic\/(start|stop)$/);
      if(request.method==='POST'&&automaticMatch){
        const data=await body(request),action=automaticMatch[1];
        if(Object.keys(data).some(key=>action==='start'?!['providers','storagePath'].includes(key):true))return send(400,{error:'Choose supported automatic download settings.'});
        if(action==='start'&&mediaApps.status().phase!=='running')return send(422,{error:'Start your media apps from Dashboard before setting up downloads.'});
        try{return send(action==='start'?202:200,action==='start'?await managed.start(data):(await managed.stop(),{ok:true}));}
        catch(error){return send(422,{error:error.publicMessage||'Automatic download setup could not complete. Check its progress and retry.'});}
      }
      const downloadMatch=request.url.match(/^\/api\/downloads\/(radarr|sonarr)\/(connect|configure|recheck|disconnect)$/);
      if(request.method==='POST'&&downloadMatch){
        const data=await body(request),[,id,action]=downloadMatch;
        if(['connect','disconnect'].includes(action)&&['preparing','downloading','starting','configuring','running'].includes(managed.status().phase))return send(409,{error:'Stop managed download apps before changing connections.'});
        const allowed=action==='connect'?['url','credential']:action==='configure'?['profileId','folderId']:[];
        if(Object.keys(data).some(key=>!allowed.includes(key)))return send(400,{error:'Choose supported download settings.'});
        try{return send(200,await downloads[action](id,data));}
        catch(error){return send(422,{error:error.message});}
      }
      const discoveryMatch=request.url.match(/^\/api\/discovery\/(search|title|add|download)$/);
      if(request.method==='POST'&&discoveryMatch){
        const data=await body(request),action=discoveryMatch[1];
        const allowed=action==='search'?['query']:action==='title'?['type','id']:['type','id','season'];
        if(Object.keys(data).some(key=>!allowed.includes(key)))return send(400,{error:'Choose a title from search.'});
        if(discover.status().phase!=='running')return send(422,{error:'Connect discovery from Dashboard before searching.'});
        try{
          if(action==='search')return send(200,{results:await discover.search(data.query)});
          validateSelection(data);
          if(action==='title')return send(200,await discover.describe(data));
          if(mediaApps.status().phase!=='running')return send(422,{error:'Start your media apps from Dashboard first.'});
          if(action==='add'&&sources.status().phase!=='running')return send(422,{error:'Connect your TorBox / Real-Debrid sources from Dashboard before adding streaming titles.'});
          if(libraryBusy)return send(409,{error:'Wait for the current library action to finish.'});
          libraryBusy=true;
          try{
            if(action==='add')return send(200,await mediaApps.addLibraryItems(await discover.items(data)));
            return send(200,await downloads.requestTitle(await discover.describe(data),{season:data.season,linkLibrary:(type,path)=>mediaApps.connectDownloadRoot(type,path)}));
          }finally{libraryBusy=false;}
        }catch(error){return send(422,{error:error.message});}
      }
      const settingsMatch=request.url.match(/^\/api\/settings\/(moonfin|aio)(\/reset)?$/);
      if(request.method==='POST' && settingsMatch){
        const data=await body(request),section=settingsMatch[1],runtime=section==='moonfin'?mediaApps:sources;
        if(settingsBusy.has(section) || ['preparing','downloading','starting','configuring'].includes(runtime.status().phase))return send(409,{error:'Wait for app setup or saving to finish, then try again.'});
        if(Object.keys(data).some(key=>key!=='value') || settingsMatch[2] && Object.keys(data).length) return send(400,{error:'Choose supported settings.'});
        settingsBusy.add(section);
        try{
          if(settingsMatch[2])await settings.reset(section);else await settings.save(section,data.value);
          let applyFailed=false;
          try {if(runtime.applyPreferences)await runtime.applyPreferences(settings.read()[section]);}catch{applyFailed=true;}
          return send(200,{...settingsView(),applyFailed});
        }finally{settingsBusy.delete(section);}
      }
      if (request.method === 'POST' && request.url === '/api/discovery/start') {
        await body(request);
        if(mediaApps.status().phase!=='running')return send(422,{error:'Start your media apps before discovery.'});
        return send(202,discover.start());
      }
      const metadataMatch = request.url.match(/^\/api\/metadata\/(tmdb|mdblist)\/(connect|disconnect)$/);
      if (request.method === 'POST' && metadataMatch) {
        const data = await body(request);
        await sources.forget();
        return send(200, metadataMatch[2] === 'connect' ? await metadata.connect(metadataMatch[1],data.credential) : await metadata.disconnect(metadataMatch[1]));
      }
      if (request.method === 'POST' && request.url === '/api/sources/start') {
        const data = await body(request);
        if (mediaApps.status().phase !== 'running' || typeof data.sourceSearch !== 'boolean') return send(422, { error: 'Set up Jellyfin first and choose whether to enable source search.' });
        const result = await accounts.withCredentials(data.providers, async credentials => {
          await mediaApps.connectSources((type,id) => sources.streams(type,id));
          return metadata.withKeys(keys => sources.start({ credentials, sourceSearch: data.sourceSearch, tmdbApiKey: keys.tmdb,preferences:settings.read().aio }));
        });
        return send(202, result);
      }
      if (request.method === 'POST' && request.url === '/api/library/add') {
        const data = await body(request);
        const info = Object.fromEntries(['type','imdbId','title','year','season','episode'].filter(x => data[x] !== undefined).map(x => [x,data[x]]));
        validateLibraryItem(info);
        if (sources.status().phase !== 'running') return send(422, { error: 'Connect AIOStreams before adding a streaming title.' });
        return send(200, await mediaApps.addLibraryItem(info));
      }
      if (request.method === 'POST' && request.url === '/api/media/start') {
        const data = await body(request);
        const household = { name: data.name, password: data.password, profiles: data.profiles };
        validateHousehold(household);
        return send(202, await metadata.withKeys(keys => mediaApps.start(household, keys,settings.read().moonfin)));
      }
      if (request.method === 'POST' && request.url === '/api/media/resume') {
        await body(request);
        return send(202, await metadata.withKeys(keys => mediaApps.resume(keys,settings.read().moonfin)));
      }
      const match = request.url.match(/^\/api\/accounts\/(torbox|real-debrid)\/(connect|recheck|disconnect)$/);
      if (request.method === 'POST' && match) {
        const data = await body(request);
        if (match[2] !== 'recheck') {await managed.stop();await sources.forget();}
        const result = match[2] === 'connect' ? await accounts.connect(match[1], data.credential)
          : await accounts[match[2]](match[1]);
        return send(result.ok ? 200 : 422, result);
      }
      if (request.method === 'POST' && request.url === '/api/plan') {
        const data = await body(request);
        const plan = saveSetupPlan(composeSetupPlan(getSetupCatalog(), data), data);
        plan.status = 'saved-local-setup';
        plan.runtime = 'local-web-wizard';
        plan.streamingReady = false;
        const statuses = accounts.status();
        for (const provider of plan.providers) provider.connected = Boolean(statuses[provider.id]?.configured);
        const temporary = join(directory, `setup-${randomBytes(12).toString('hex')}.tmp`);
        try {
          await mkdir(directory, { recursive: true });
          await writeFile(temporary, JSON.stringify(plan, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
          await rename(temporary, join(directory, 'setup.json'));
          savedPlan = plan;
        } finally { await rm(temporary, { force: true }); }
        return send(200, { ok: true, plan });
      }
      if (request.method === 'POST' && request.url === '/api/stop') {
        await body(request);
        if(activeMutations>1)return send(409,{error:'Wait for the current action to finish, then quit.'});
        lifecycleBusy=true;
        try{await stopApps();}
        catch{lifecycleBusy=false;return send(422,{error:'Some apps could not stop. Retry Stop all apps.'});}
        response.once('finish', () => { close().then(onStop).catch(()=>{}); });
        send(200, { ok: true });
        return;
      }
      return send(404, { error: 'This setup action is not available.' });
    } catch (error) {
      const status = error.status || 400;
      if (!response.headersSent) send(status, { error: status === 413 ? 'This request is too large.' : 'Could not complete this action. Check your choices and try again.' });
    }finally{if(mutation)activeMutations--;}
  });
  server.requestTimeout = 20000;
  server.headersTimeout = 10000;
  server.maxConnections = 30;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  url = `http://127.0.0.1:${server.address().port}`;
  let closing;
  function close() {
    if (!closing) closing = stopApps().then(()=>downloads.stop()).then(() => new Promise(resolve => {
      server.close(resolve);
      // Browsers can open TCP preconnections before sending HTTP headers. They
      // are not idle HTTP connections and must also close during explicit Stop.
      server.closeAllConnections();
    })).catch(error=>{closing=null;throw error;});
    return closing;
  }
  return { url, close };
}
