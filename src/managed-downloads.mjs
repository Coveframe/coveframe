import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdir,readFile,writeFile,readdir,access,rename} from 'node:fs/promises';
import {join,win32} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {createWindowsVault} from './windows-vault.mjs';
import {makePrivateDirectory} from './private-directory.mjs';
import {obtainMediaPackage,extractMediaPackage,mediaPackages} from './media-packages.mjs';
import {configureDownloadApps,downloadClientConfig,readDownloadAppJson} from './automatic-downloads.mjs';
const ports={radarr:18803,sonarr:18804,prowlarr:18805,decypharr:18806};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const publicError=message=>Object.assign(Error(message),{publicMessage:message});
export async function createManagedDownloads({directory,cacheDirectory,downloads,withCredentials,linkLibrary}){
 const root=join(directory,'DownloadApps'),vault=createWindowsVault(join(root,'Secrets'));
 let secrets=await vault.read(),job,abort,children=[],closing=false,owned=false;
 let state={phase:'not-started',configured:Boolean(secrets.installationId),storagePath:secrets.storagePath||join(root,'Files'),providers:secrets.providers||[]};
 const apps=()=>Object.fromEntries(Object.entries(ports).map(([id,port])=>[id,{url:'http://127.0.0.1:'+port,key:secrets.keys?.[id]}]));
 function step(name,message){state={...state,phase:name==='preparing'?'preparing':'configuring',step:name,message};}
 async function request(id,path,method='GET',body){
  try{
   const r=await fetch(apps()[id].url+'/api/'+(id==='prowlarr'?'v1':'v3')+path,{method,redirect:'error',signal:AbortSignal.any([abort.signal,AbortSignal.timeout(45000)]),headers:{'X-Api-Key':secrets.keys[id],'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
   return await readDownloadAppJson(r,path);
  }catch{throw publicError('The managed '+id+' app did not complete its check. Retry setup; its data has been kept.');}
 }
 async function stopChildren(){
  const ownedChildren=children;children=[];let failed=false;
  for(const child of ownedChildren.reverse())if(child.exitCode===null&&child.signalCode===null){
   const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();let timer;await Promise.race([exited,new Promise(resolve=>{timer=setTimeout(resolve,10000);})]);clearTimeout(timer);
   if(child.exitCode===null&&child.signalCode===null){children.push(child);failed=true;}
  }
  // Provider keys are present only while the owned client runs. Its native config is ACL protected.
  if(!failed&&owned)try{const file=join(root,'Data','decypharr','config.json'),config=JSON.parse(await readFile(file,'utf8'));config.debrids=[];await writeFile(file,JSON.stringify(config));}catch(error){if(error.code!=='ENOENT')throw publicError('Could not clear the stopped download client configuration. Its private folder has been preserved.');}
  for(const id of ['radarr','sonarr'])if(secrets.installationId)downloads.invalidate?.(id);
  if(failed)throw publicError('An owned download app did not stop. Close Media Hub before retrying.');
 }
 async function identity(){
  await mkdir(root,{recursive:true});await makePrivateDirectory(root);
  try{const marker=JSON.parse(await readFile(join(root,'installation.json'),'utf8'));
   if(marker.app==='media-hub-downloads'&&!secrets.installationId&&(await readdir(root)).every(name=>['Secrets','Files','installation.json'].includes(name))){secrets={installationId:marker.id,keys:Object.fromEntries(Object.keys(ports).map(id=>[id,randomBytes(32).toString('hex')]))};await vault.write(secrets);}
   if(marker.app!=='media-hub-downloads'||marker.id!==secrets.installationId)throw Error();}
  catch(error){
   if(error.code!=='ENOENT')throw publicError('The managed download app identity could not be confirmed. Preserve its folder for recovery.');
   if((await readdir(root)).some(x=>x!=='Secrets'))throw publicError('The download app folder already contains files. Preserve it before retrying.');
   secrets={installationId:randomUUID(),keys:Object.fromEntries(Object.keys(ports).map(id=>[id,randomBytes(32).toString('hex')]))};
   await vault.write(secrets);await writeFile(join(root,'installation.json'),JSON.stringify({app:'media-hub-downloads',id:secrets.installationId}),{flag:'wx'});
  }
  owned=true;
 }
 async function prepareFiles(storagePath){
  if(typeof storagePath!=='string'||storagePath.length>190||! /^[a-z]:\\[^<>:"|?*\x00-\x1f]+$/i.test(storagePath)||storagePath.split(/[\\/]/).includes('..')||/^[a-z]:\\(?:Windows|Program Files(?: \(x86\))?)(?:\\|$)/i.test(storagePath))throw publicError('Choose a new local media folder on this PC, outside Windows and Program Files.');
  storagePath=win32.normalize(storagePath);
  if(secrets.storagePath&&secrets.storagePath.toLowerCase()!==storagePath.toLowerCase())throw publicError('Keep the original media folder when restarting. Moving existing downloads needs a separate migration.');
  await mkdir(storagePath,{recursive:true});
  try{const marker=JSON.parse(await readFile(join(storagePath,'.media-hub-downloads.json'),'utf8'));if(marker.id!==secrets.installationId)throw Error();}
  catch(error){if(error.code!=='ENOENT')throw publicError('This media folder belongs to another setup. Choose an empty folder.');if((await readdir(storagePath)).length)throw publicError('Choose an empty media folder so existing files are preserved.');await writeFile(join(storagePath,'.media-hub-downloads.json'),JSON.stringify({id:secrets.installationId}),{flag:'wx'});}
  for(const folder of ['Movies','TV','Downloads','Downloads/movies','Downloads/tv'])await mkdir(join(storagePath,folder),{recursive:true});
  return storagePath;
 }
 async function prepareApp(id){
  const pkg=mediaPackages[id],target=join(root,'Packages',id+'-'+pkg.version);
  try{if((await readFile(join(target,'.media-hub-complete'),'utf8'))!==pkg.sha256)throw Error();}
  catch(error){if(error.code!=='ENOENT')throw publicError('A managed app package changed. Preserve its folder for recovery.');
   state={...state,phase:'downloading',message:'Downloading and checking '+id+'…'};
   const archive=await obtainMediaPackage(id,join(root,'Downloads'),{cacheDirectory,signal:abort.signal});
   await mkdir(join(root,'Packages'),{recursive:true});const staging=target+'-'+randomUUID();await extractMediaPackage(archive,staging,{signal:abort.signal});await writeFile(join(staging,'.media-hub-complete'),pkg.sha256);await rename(staging,target);
  }
  return target;
 }
 async function run(providers,storagePath){
  try{
   let credentials;
   step('accounts','Checking the selected source accounts…');
   try{await withCredentials(providers,async keys=>{credentials={...keys};});}catch{throw publicError('Reconnect the selected TorBox / Real-Debrid accounts in Manage accounts, then retry.');}
   await identity();storagePath=await prepareFiles(storagePath);secrets={...secrets,storagePath,providers};await vault.write(secrets);
   state={...state,storagePath,providers};
   // Check every reserved port before downloading or starting any app. Never adopt an existing listener.
   for(const port of Object.values(ports))await new Promise((yes,no)=>{const probe=createServer();probe.once('error',()=>no(publicError('Port '+port+' is already in use. No existing app was changed.')));probe.listen(port,'0.0.0.0',()=>probe.close(yes));});
   for(const id of ['decypharr','radarr','sonarr','prowlarr']){
    abort.signal.throwIfAborted();const target=await prepareApp(id),data=join(root,'Data',id);await mkdir(data,{recursive:true});
    let exe,args,cwd;const app=id[0].toUpperCase()+id.slice(1);
    if(id==='decypharr'){
     await writeFile(join(data,'config.json'),JSON.stringify(downloadClientConfig({credentials,folder:join(storagePath,'Downloads')})));
     await writeFile(join(data,'auth.json'),JSON.stringify({api_token:secrets.keys.decypharr,token_only:true}));
     exe=join(target,'decypharr.exe');cwd=target;args=['-config',data,'-pprof',''];credentials=null;
    }else{
     const config=join(data,'config.xml');
     // This directory is owned; preserve vendor settings on resume, enforcing only listener/security fields.
     let xml;try{xml=await readFile(config,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;xml='<Config></Config>';}
     const values={BindAddress:'127.0.0.1',Port:ports[id],EnableSsl:'False',LaunchBrowser:'False',ApiKey:secrets.keys[id],AuthenticationMethod:'Basic',AuthenticationRequired:'Enabled',UpdateAutomatically:'False',AnalyticsEnabled:'False'};
     for(const [key,value] of Object.entries(values)){const re=new RegExp('<'+key+'>[\\s\\S]*?</'+key+'>');const tag='<'+key+'>'+value+'</'+key+'>';xml=re.test(xml)?xml.replace(re,tag):xml.replace('</Config>',tag+'</Config>');}await writeFile(config,xml);
     cwd=join(target,app);exe=join(cwd,app+'.Console.exe');args=['-nobrowser','-data='+data];
    }
    abort.signal.throwIfAborted();state={...state,phase:'starting',message:'Starting '+app+' on this PC…'};
    const env=Object.fromEntries(['SystemRoot','WINDIR','PATH','TEMP','TMP','USERPROFILE','LOCALAPPDATA','APPDATA','ProgramData'].filter(x=>process.env[x]).map(x=>[x,process.env[x]]));
    const child=spawn(exe,args,{cwd,env,windowsHide:true,stdio:'ignore'});children.push(child);let failed=false;child.once('error',()=>{failed=true;});
    let ready=false;for(let i=0;i<90;i++){
     abort.signal.throwIfAborted();if(failed||child.exitCode!==null||child.signalCode!==null)throw publicError('The managed '+id+' app could not start. Its private data has been kept.');
     try{if(id==='decypharr'){const response=await fetch(apps().decypharr.url+'/api/v2/auth/login',{method:'POST',body:new URLSearchParams({username:'mediahub',password:secrets.keys.decypharr}),signal:AbortSignal.any([abort.signal,AbortSignal.timeout(2000)])});if(!response.ok||(await response.text())!=='Ok.')throw Error();}else await request(id,'/system/status');ready=true;break;}catch{}await delay(1000);
    }
    if(!ready)throw publicError('The managed '+id+' app did not become ready. Retry setup.');
    child.once('exit',()=>{if(state.phase==='running'&&!closing){state={...state,phase:'failed',message:'A managed download app stopped. Restart automatic setup before requesting files.'};for(const appId of ['radarr','sonarr'])downloads.invalidate?.(appId);void stopChildren().catch(error=>{state={...state,message:error.publicMessage||'Could not stop all managed apps. Close Media Hub before retrying.'};});}});
   }
   step('connections','Connecting the download client, public indexer and media folders…');
   let configured;try{configured=await configureDownloadApps({request,apps:apps(),folders:{radarr:join(storagePath,'Movies'),sonarr:join(storagePath,'TV')},profileIds:Object.fromEntries(['radarr','sonarr'].map(id=>[id,downloads.status()[id]?.profileId]))});}catch(error){throw publicError(error.publicMessage||(/^(radarr|sonarr|prowlarr|This app|The recommended)/.test(error.message)?error.message:'Download app configuration could not be confirmed. Retry setup.'));}
   // Prowlarr sync is asynchronous. Read back both actual pipelines before enabling requests.
   step('checks','Checking both download connections and linking Jellyfin folders…');
   let ready=false;
   for(let attempt=0;attempt<20;attempt++){
    abort.signal.throwIfAborted();let complete=true;
    for(const id of ['radarr','sonarr']){
     if(attempt===0){const app=apps()[id];await downloads.connect(id,{url:app.url,credential:app.key});await downloads.configure(id,configured[id]);}else await downloads.recheck(id);
     complete&&=downloads.status()[id].pipelineReady;
    }
    if(complete){ready=true;break;}await delay(1500);
   }
   if(!ready)throw publicError('The apps are connected, but their download checks have not passed. Open Advanced below to review the reported checks, then retry.');
   if(linkLibrary){await linkLibrary('movie',join(storagePath,'Movies'));await linkLibrary('tv',join(storagePath,'TV'));}
   state={phase:'running',configured:true,storagePath,providers,message:'Automatic setup checks passed. Choose a title in Find titles to request files. Your first completed download still needs verification.'};
  }catch(error){
   let cleanup;try{await stopChildren();}catch(e){cleanup=e.publicMessage;}
   state={...state,phase:abort.signal.aborted?'stopped':'failed',message:cleanup||(abort.signal.aborted?'Download apps stopped.':error.publicMessage||'Automatic setup could not finish. Check your internet connection and retry; existing files have been kept.')};
  }
 }
 return {
  status:()=>structuredClone(state),
  async start({providers,storagePath=state.storagePath}={}){
   if(closing||job||children.length&&state.phase!=='running')throw publicError('Wait for the current download setup to finish or stop its apps first.');if(state.phase==='running')return {ok:true};
   if(!Array.isArray(providers)||!providers.length||providers.length>2||new Set(providers).size!==providers.length||providers.some(id=>!['torbox','real-debrid'].includes(id)))throw publicError('Choose TorBox, Real-Debrid or both. Both are recommended.');
   for(const [id,connection] of Object.entries(downloads.status()))if(['radarr','sonarr'].includes(id)&&connection.configured&&(!secrets.installationId||connection.url&&connection.url!==apps()[id].url))throw publicError('An existing manual download connection is saved. Disconnect it in Advanced before using automatic setup.');
   abort=new AbortController();state={...state,phase:'preparing',message:'Preparing automatic downloads…'};job=run(providers,storagePath).finally(()=>{job=null;});return {ok:true};
  },
  whenSettled:()=>job||Promise.resolve(),
  async stop(){closing=true;try{abort?.abort();if(job)await job;await stopChildren();state={...state,phase:'stopped',message:'Managed download apps stopped. Files and setup are kept for restart.'};}finally{closing=false;}},
 };
}
