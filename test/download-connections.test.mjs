import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createDownloadConnections} from '../src/download-connections.mjs';

async function fixture(t,{app='Radarr',indexers=[{enableAutomaticSearch:true}]}={}){
  let saved={},movies=[],series=[];const writes=[];
  const server=createServer(async(req,res)=>{
    assert.equal(req.headers['x-api-key'],'synthetic-arr-key');
    const path=new URL(req.url,'http://local').pathname;
    const send=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
    let body='';for await(const bytes of req)body+=bytes;
    if(req.method!=='GET')writes.push({path,body:JSON.parse(body)});
    if(path.endsWith('/system/status'))return send({appName:app,version:'5.0.0'});
    if(path.endsWith('/qualityprofile'))return send([{id:1,name:'HD-1080p'}]);
    if(path.endsWith('/rootfolder'))return send([{id:2,path:'D:\\Movies',accessible:true}]);
    if(path.endsWith('/downloadclient'))return send([{enable:true,fields:[{name:'password',value:'never-return'}]}]);
    if(path.endsWith('/indexer'))return send(indexers);
    if(path.endsWith('/health'))return send([]);
    if(path.endsWith('/movie/lookup'))return send([{tmdbId:101,title:'Example Movie',year:2020,titleSlug:'example',images:[]}]);
    if(path.endsWith('/movie')){
      if(req.method==='POST'){movies.push({...JSON.parse(body),id:7});return send(movies.at(-1));}
      return send(movies);
    }
    if(path.endsWith('/series/lookup'))return send([{tvdbId:1234,title:'Example Show',seriesType:'standard',seasons:[{seasonNumber:0},{seasonNumber:1},{seasonNumber:2}]}]);
    if(path.endsWith('/series')){
      if(req.method==='POST'){series.push({...JSON.parse(body),id:9});return send(series.at(-1));}
      return send(series);
    }
    res.writeHead(404);res.end('{}');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const vault={read:async()=>structuredClone(saved),write:async value=>{saved=structuredClone(value);}};
  const client=await createDownloadConnections({vault});
  return {client,vault,url:`http://127.0.0.1:${server.address().port}`,writes};
}

test('local Radarr connection checks the pipeline and keeps its key and client secrets private',async t=>{
  const {client,vault,url}=await fixture(t);
  await client.connect('radarr',{url,credential:'synthetic-arr-key'});
  const status=client.status().radarr;
  assert.equal(status.configured,true);
  assert.equal(status.pipelineReady,true);
  assert.deepEqual(status.profiles,[{id:1,name:'HD-1080p'}]);
  assert.equal(status.folderId,2);
  assert.doesNotMatch(JSON.stringify(status),/synthetic-arr-key|never-return/);
  assert.equal((await vault.read()).radarr.key,'synthetic-arr-key');
  await assert.rejects(client.connect('radarr',{url:'http://example.com:7878',credential:'synthetic-arr-key'}),/this PC/);
  await assert.rejects(client.connect('radarr',{url:url+'/?apikey=secret',credential:'synthetic-arr-key'}),/this PC/);
});

test('Sonarr requests only the chosen season and an incomplete pipeline cannot start downloads',async t=>{
  const {client,url,writes}=await fixture(t,{app:'Sonarr'});
  await client.connect('sonarr',{url,credential:'synthetic-arr-key'});
  await client.requestTitle({type:'tv',id:202,tvdbId:1234,seasons:[{number:1}]},{season:1,linkLibrary:async()=>{}});
  const series=writes.find(x=>x.path.endsWith('/series')).body;
  assert.deepEqual(series.seasons,[{seasonNumber:0,monitored:false},{seasonNumber:1,monitored:true},{seasonNumber:2,monitored:false}]);
  assert.equal(series.monitorNewItems,'none');
  assert.equal(series.addOptions.searchForMissingEpisodes,true);
  const blocked=await fixture(t,{indexers:[]});
  await blocked.client.connect('radarr',{url:blocked.url,credential:'synthetic-arr-key'});
  assert.equal(blocked.client.status().radarr.pipelineReady,false);
  await assert.rejects(blocked.client.requestTitle({type:'movie',id:101},{linkLibrary:async()=>{throw Error('Should not link');}}),/checks/);
  assert.equal(blocked.writes.length,0);
});

test('an explicit movie download links its folder, starts a search, and repeat clicks do not create duplicates',async t=>{
  const {client,url,writes}=await fixture(t);const linked=[];
  await client.connect('radarr',{url,credential:'synthetic-arr-key'});
  const title={type:'movie',id:101,title:'Example Movie',year:2020};
  const first=await client.requestTitle(title,{linkLibrary:async(type,path)=>linked.push({type,path})});
  assert.equal(first.accepted,true);
  assert.equal(first.downloadVerified,false);
  assert.deepEqual(linked,[{type:'movie',path:'D:\\Movies'}]);
  const movie=writes.find(x=>x.path.endsWith('/movie')).body;
  assert.equal(movie.tmdbId,101);
  assert.equal(movie.qualityProfileId,1);
  assert.equal(movie.rootFolderPath,'D:\\Movies');
  assert.deepEqual(movie.addOptions,{searchForMovie:true});
  const again=await client.requestTitle(title,{linkLibrary:async()=>{}});
  assert.equal(again.alreadyManaged,true);
  assert.equal(writes.filter(x=>x.path.endsWith('/movie')).length,1);
});
test('Sonarr rejects a metadata season that its own lookup cannot match',async t=>{
  const {client,url,writes}=await fixture(t,{app:'Sonarr'});
  await client.connect('sonarr',{url,credential:'synthetic-arr-key'});
  await assert.rejects(client.requestTitle({type:'tv',id:202,tvdbId:1234,seasons:[{number:3}]},{season:3,linkLibrary:async()=>{}}),/match.*season/i);
  assert.equal(writes.length,0);
});
