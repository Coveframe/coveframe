import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { access, mkdir, readFile, writeFile, readdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createWindowsVault } from './windows-vault.mjs';
import { makePrivateDirectory } from './private-directory.mjs';
import { obtainMediaPackage, extractMediaPackage, mediaPackages } from './media-packages.mjs';
import { provisionSeerr } from './seerr-setup.mjs';
import { materializePackageLinks } from './package-links.mjs';
import {createDiscoveryCatalog} from './discovery-catalog.mjs';
const base='http://127.0.0.1:18802';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export async function createSeerrRuntime({directory,cacheDirectory,media}) {
  const root=join(directory,'Discovery');
  const vault=createWindowsVault(join(root,'Secrets'));
  let secrets=await vault.read(), child, job, abort,catalogCookie;
  let state={phase:'not-started',configured:false,requestsEnabled:false};
  async function request(path,method='GET',body,headers={}) {
    const response=await fetch(base+path,{method,redirect:'error',signal:AbortSignal.any([abort.signal,AbortSignal.timeout(30000)]),
      headers:{'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});
    if(!response.ok) { const error=Error(`Discovery setup returned HTTP ${response.status}. Its private data has been preserved.`); error.step=path.split('?')[0];error.status=response.status;throw error; }
    const bytes=await response.text();
    if(bytes.length>2*1024*1024) throw Error('Discovery response was too large.');
    return {data:bytes?JSON.parse(bytes):null,cookie:response.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ')};
  }
  async function catalogRequest(path,retry=true){
    if(state.phase!=='running')throw Error('Connect discovery from Dashboard before searching.');
    if(!catalogCookie){
      const login=await media.withDiscoveryAdmin(({password})=>request('/api/v1/auth/jellyfin','POST',{username:'MediaHubSystem',password}));
      if(login.data?.id!==1||!login.cookie)throw Error('Reconnect discovery before searching.');
      catalogCookie=login.cookie;
    }
    try{return (await request(path,'GET',undefined,{Cookie:catalogCookie})).data;}
    catch(error){if(retry&&[401,403].includes(error.status)){catalogCookie=null;return catalogRequest(path,false);}throw Error('Discovery could not load this title. Check its connection and try again.');}
  }
  const catalog=createDiscoveryCatalog({request:catalogRequest});
  async function stopChild() {
    if(!child || child.exitCode!==null || child.signalCode!==null) return;
    const owned=child; let timer;
    const exited=new Promise(resolve=>owned.once('exit',resolve)); owned.kill();
    await Promise.race([exited,new Promise(resolve=>{timer=setTimeout(resolve,10000);})]); clearTimeout(timer);
    if(owned.exitCode===null && owned.signalCode===null) throw Error('The isolated discovery process did not stop.');
    child=null;
  }
  async function run() {
    try {
      if(!child || child.exitCode!==null || child.signalCode!==null) {
        await new Promise((yes,no)=>{const probe=createServer();probe.once('error',()=>no(Error('Port 18802 is occupied. No existing app was changed.')));probe.listen(18802,'0.0.0.0',()=>probe.close(yes));});
        await mkdir(root,{recursive:true});
        const marker=join(root,'installation.json');
        try { const identity=JSON.parse(await readFile(marker,'utf8')); if(identity.app!=='media-hub-discovery'||identity.id!==secrets.installationId)throw Error('Discovery installation identity does not match.'); }
        catch(error) {
          if(error.code!=='ENOENT')throw error;
          if((await readdir(root)).some(x=>x!=='Secrets'))throw Error('Preserve the existing discovery directory for recovery.');
          secrets={installationId:randomUUID()};await vault.write(secrets);await writeFile(marker,JSON.stringify({app:'media-hub-discovery',id:secrets.installationId}),{flag:'wx'});
        }
        await makePrivateDirectory(root);
        const target=join(root,'Packages',mediaPackages.seerr.version);
        try {await access(join(target,'.media-hub-complete'));}
        catch(error) {
          if(error.code!=='ENOENT')throw error;
          state={...state,phase:'unpacking',message:'Preparing the bundled discovery app…'};
          const archive=await obtainMediaPackage('seerr',join(root,'Downloads'),{cacheDirectory,signal:abort.signal});
          await mkdir(join(target,'..'),{recursive:true});const staging=target+'-'+randomUUID();
          await extractMediaPackage(archive,staging,{signal:abort.signal});await rename(staging,target);
          await materializePackageLinks(target);await writeFile(join(target,'.media-hub-complete'),mediaPackages.seerr.sha256);
        }
        await mkdir(join(root,'Data'),{recursive:true});
        const env=Object.fromEntries(['SystemRoot','WINDIR','PATH','TEMP','TMP','USERPROFILE','LOCALAPPDATA','APPDATA','ProgramData'].filter(x=>process.env[x]).map(x=>[x,process.env[x]]));
        Object.assign(env,{NODE_ENV:'production',LOG_LEVEL:'error',HOST:'127.0.0.1',PORT:'18802',CONFIG_DIRECTORY:join(root,'Data'),NEXT_TELEMETRY_DISABLED:'1'});
        state={...state,phase:'starting',message:'Starting discovery on this PC…'};
        child=spawn(join(target,'node/node.exe'),[join(target,'runtime/dist/index.js')],{cwd:join(target,'runtime'),env,windowsHide:true,stdio:'ignore'});
        let failed=false;child.once('error',()=>{failed=true;});let healthy=false;
        for(let i=0;i<90;i++) {
          abort.signal.throwIfAborted();if(failed||child.exitCode!==null||child.signalCode!==null)throw Error('Discovery could not start. Its private logs are preserved.');
          try{await request('/api/v1/status');healthy=true;break;}catch{}
          await delay(1000);
        }
        if(!healthy)throw Error('Discovery did not become ready in time.');
      }
      state={...state,phase:'configuring',message:'Connecting discovery to household profiles…'};
      const receipt=await media.withDiscoveryAdmin(credentials=>provisionSeerr({request,...credentials}));
      await media.connectDiscovery();
      state={...receipt,phase:'running',url:base};
    }catch(error){try{await stopChild();}catch{}state={phase:abort.signal.aborted?'stopped':'failed',configured:false,requestsEnabled:false,message:abort.signal.aborted?'Discovery stopped.':error.message,...(error.step?{diagnostic:{step:error.step}}:{})};}
  }
  return {
    status:()=>structuredClone(state),
    search:query=>catalog.search(query),
    describe:selection=>catalog.describe(selection),
    items:selection=>catalog.items(selection),
    start(){if(job)throw Error('Discovery setup is already in progress.');if(media.status().phase!=='running')throw Error('Start your media apps first.');abort=new AbortController();state={...state,phase:'preparing',message:'Preparing discovery…'};job=run().finally(()=>{job=null;});return {ok:true};},
    async stop(){catalogCookie=null;abort?.abort();if(job)await job;await stopChild();state={...state,phase:'stopped'};},
  };
}
