import test from 'node:test';
import assert from 'node:assert/strict';
import {configureDownloadApps,downloadClientConfig,readDownloadAppJson} from '../src/automatic-downloads.mjs';
import {createManagedDownloads} from '../src/managed-downloads.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('the large Prowlarr schema can be read while ordinary responses remain size limited',async()=>{
 const payload=JSON.stringify([{implementation:'Knaben',description:'x'.repeat(6_300_000)}]);
 assert.equal((await readDownloadAppJson(new Response(payload),'/indexer/schema'))[0].implementation,'Knaben');
 await assert.rejects(readDownloadAppJson(new Response(payload),'/indexer'),/large/i);
 await assert.rejects(readDownloadAppJson(new Response('x'.repeat(13*1024*1024)),'/indexer/schema'),/large/i);
});

test('managed provider configuration uses both accounts without mounts or uncached downloads',()=>{
 const config=downloadClientConfig({credentials:{torbox:'private-tb','real-debrid':'private-rd'},folder:'D:\\Media\\Downloads',token:'private-local'});
 assert.deepEqual(config.debrids.map(x=>x.provider),['torbox','realdebrid']);
 assert.ok(config.debrids.every(x=>x.download_uncached===false));
 assert.equal(config.bind_address,'127.0.0.1');assert.equal(config.mount.type,'none');
 assert.equal(config.default_download_action,'download');assert.equal(config.use_auth,true);
 assert.equal(config.repair.enabled,false);assert.equal(config.disable_webdav,true);
});

function environment({failTest=false}={}){
 const writes=[],data={};
 const schemas={downloadclient:[{implementation:'QBittorrent',configContract:'QBittorrentSettings',fields:['host','port','useSsl','urlBase','username','password','movieCategory','tvCategory'].map(name=>({name}))}],
 indexer:[{implementation:'Knaben',configContract:'KnabenSettings',fields:[{name:'baseUrl',value:'https://api.knaben.org/'}],capabilities:{categories:[{id:2000},{id:5000}]}}],
 applications:['Radarr','Sonarr'].map(implementation=>({implementation,configContract:implementation+'Settings',fields:['prowlarrUrl','baseUrl','apiKey','syncCategories'].map(name=>({name}))}))};
 const request=async(id,path,method='GET',body)=>{
  const kind=path.split('/')[1];if(path.endsWith('/schema'))return structuredClone(schemas[kind]);
  if(path==='/qualityprofile')return [{id:1,name:'Any'},{id:5,name:'HD-1080p'}];
  if(method==='GET')return structuredClone(data[id+kind]||[]);
  writes.push({id,path,body:structuredClone(body)});
  if(path.endsWith('/test')){if(failTest)throw Error('vendor echoed private-rd');return null;}
  if(path==='/command')return {id:1};
  const list=data[id+kind]??=[];const item={...structuredClone(body),id:body.id||list.length+1};
  if(method==='PUT')list.splice(list.findIndex(x=>x.id===body.id),1,item);else list.push(item);return item;
 };
 return {request,writes,data};
}
const apps={radarr:{url:'http://127.0.0.1:18803',key:'arr-r'},sonarr:{url:'http://127.0.0.1:18804',key:'arr-s'},prowlarr:{url:'http://127.0.0.1:18805',key:'arr-p'},decypharr:{url:'http://127.0.0.1:18806',key:'private-local'}};
test('automatic setup wires client, public indexer, sync, roots and 1080p profiles and can be repeated',async()=>{
 const env=environment();const options={...env,apps,folders:{radarr:'D:\\Media\\Movies',sonarr:'D:\\Media\\TV'}};
 const first=await configureDownloadApps(options);await configureDownloadApps(options);
 assert.equal(first.radarr.profileId,5);assert.equal(first.sonarr.profileId,5);
 assert.equal(env.data.radarrdownloadclient.length,1);assert.equal(env.data.sonarrdownloadclient.length,1);
 assert.equal(env.data.prowlarrindexer.length,1);assert.equal(env.data.prowlarrapplications.length,2);
 const client=env.data.radarrdownloadclient[0];assert.equal(client.enable,true);
 assert.equal(client.fields.find(x=>x.name==='password').value,'private-local');
 assert.ok(env.writes.some(x=>x.path==='/downloadclient/test'));assert.ok(env.writes.some(x=>x.path==='/indexer/test'));
 assert.ok(env.writes.some(x=>x.path==='/command'&&x.body.name==='ApplicationIndexerSync'));
 for(const id of ['radarr','sonarr'])assert.ok(env.writes.some(x=>x.id===id&&x.path==='/command'&&x.body.name==='CheckHealth'),'refresh cached client health after startup');
 assert.ok(!JSON.stringify(first).includes('private-local'));
});
test('a failed vendor test stops configuration with a useful secret-free message',async()=>{
 const env=environment({failTest:true});
 await assert.rejects(configureDownloadApps({...env,apps,folders:{radarr:'D:\\Movies',sonarr:'D:\\TV'}}),error=>!error.message.includes('private-rd')&&/test|check/i.test(error.message));
 assert.equal(env.data.radarrdownloadclient?.length||0,0);
});
test('restarting managed apps preserves an existing valid quality choice',async()=>{
 const env=environment();const result=await configureDownloadApps({...env,apps,folders:{radarr:'D:\\Movies',sonarr:'D:\\TV'},profileIds:{radarr:1,sonarr:5}});
 assert.equal(result.radarr.profileId,1);assert.equal(result.sonarr.profileId,5);
});
test('automatic setup preserves existing manual connections before requesting accounts or packages',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'managed-download-'));t.after(()=>rm(directory,{recursive:true,force:true}));let requested=false;
 const manager=await createManagedDownloads({directory,downloads:{status:()=>({radarr:{configured:true,url:'http://127.0.0.1:7878'}})},withCredentials:()=>{requested=true;throw Error('should not run');}});
 await assert.rejects(manager.start({providers:['torbox','real-debrid']}),/existing|manual/i);assert.equal(requested,false);assert.equal(manager.status().phase,'not-started');await manager.stop();
});
test('an account check failure is recoverable without exposing credentials or provisioning apps',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'managed-download-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const manager=await createManagedDownloads({directory,downloads:{status:()=>({})},withCredentials:async()=>{throw Error('private-tb');}});
 manager.start({providers:['torbox']});await manager.whenSettled();
 assert.equal(manager.status().phase,'failed');assert.ok(!JSON.stringify(manager.status()).includes('private-tb'));await manager.stop();
});
