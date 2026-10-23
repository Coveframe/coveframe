import test from 'node:test';
import assert from 'node:assert/strict';
import {startLocalDebrid} from '../src/local-debrid.mjs';

const hash='dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c';
const headers={'X-StremThru-Store-Name':'realdebrid','X-StremThru-Store-Authorization':'Bearer local-session-fixture'};
const movie={id:'own123',hash,filename:'Big Buck Bunny (2008)',bytes:276134947,status:'downloaded',added:'2026-10-22T00:00:00Z'};
const info={...movie,files:[{id:1,path:'/Big Buck Bunny.mp4',bytes:276134947,selected:1}],links:['https://real-debrid.com/d/test-link']};

test('local debrid authenticates loopback requests and reads the provider directly without forwarding its key to a relay',async t=>{
 const destinations=[];
 const bridge=await startLocalDebrid({port:0,accounts:{realdebrid:{credential:'provider-secret-fixture',token:'local-session-fixture'}},transport:async(url,options)=>{
  const target=new URL(url);destinations.push(target.origin);
  assert.equal(target.origin,'https://api.real-debrid.com');
  assert.equal(target.searchParams.has('offset'),false,'Real-Debrid returns an empty 204 for explicit offset=0');
  assert.equal(options.headers.Authorization,'Bearer provider-secret-fixture');
  return Response.json([movie],{headers:{'X-Total-Count':'1'}});
 }});
 t.after(()=>bridge.close());
 assert.equal((await fetch(bridge.url+'/v0/store/magnets')).status,401);
 assert.equal((await fetch(bridge.url+'/v0/store/magnets',{headers:{...headers,Origin:'https://untrusted.example'}})).status,403);
 assert.equal(destinations.length,0);
 const response=await fetch(bridge.url+'/v0/store/magnets?limit=100&offset=0',{headers});
 assert.equal(response.status,200);
 const result=await response.json();
 assert.equal(result.data.items[0].name,'Big Buck Bunny (2008)');
 assert.equal(result.data.items[0].status,'downloaded');
 assert.equal(result.data.total_items,1);
 assert.doesNotMatch(JSON.stringify(result),/provider-secret|local-session/);
 assert.deepEqual(destinations,['https://api.real-debrid.com']);
});

test('an empty Real-Debrid library is usable and provider failures cannot echo credentials',async t=>{
 let fail=false;
 const bridge=await startLocalDebrid({port:0,accounts:{realdebrid:{credential:'secret-fixture',token:'local-session-fixture'}},transport:async()=>
  fail?Response.json({error:'secret-fixture private-provider-details'},{status:403}):new Response(null,{status:204})});
 t.after(()=>bridge.close());
 const empty=await fetch(bridge.url+'/v0/store/magnets',{headers});assert.equal(empty.status,200);
 assert.deepEqual((await empty.json()).data,{items:[],total_items:0});
 fail=true;const denied=await fetch(bridge.url+'/v0/store/magnets',{headers});assert.equal(denied.status,503);
 assert.doesNotMatch(await denied.text(),/secret-fixture|private-provider-details/);
});

test('TorBox cached search resolves a stream directly and explicitly refuses uncached cloud downloads',async t=>{
 const tbHeaders={'X-StremThru-Store-Name':'torbox','X-StremThru-Store-Authorization':'Bearer tb-session'};
 let cachedOnly=false;
 const tb={id:42,hash,name:'Big Buck Bunny',size:276134947,created_at:'2026-10-22',download_finished:true,
  files:[{id:1,name:'Big Buck Bunny/Big Buck Bunny.mp4',short_name:'Big Buck Bunny.mp4',size:276134947}]};
 const bridge=await startLocalDebrid({port:0,accounts:{torbox:{credential:'tb-private',token:'tb-session'}},transport:async(url,options)=>{
  const target=new URL(url);
  assert.equal(target.origin,'https://api.torbox.app');
  assert.equal(options.headers.Authorization,'Bearer tb-private');
  if(target.pathname.endsWith('/checkcached'))return Response.json({success:true,data:{[hash]:tb}});
  if(target.pathname.endsWith('/createtorrent')){cachedOnly=options.body.get('add_only_if_cached')==='true';return Response.json({success:true,data:{torrent_id:42}});}
  if(target.pathname.endsWith('/mylist'))return Response.json({success:true,data:[tb]});
  if(target.pathname.endsWith('/requestdl')){
   assert.equal(target.searchParams.get('token'),'tb-private');
   assert.equal(target.searchParams.get('torrent_id'),'42');assert.equal(target.searchParams.get('file_id'),'1');
   return Response.json({success:true,data:'https://media.example.com/bunny.mp4'});
  }
  throw Error('Unexpected TorBox operation.');
 }});
 t.after(()=>bridge.close());
 const call=(path,data)=>fetch(bridge.url+path,{method:data?'POST':'GET',headers:{...tbHeaders,'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});
 const checked=await(await call('/v0/store/magnets/check?magnet='+hash)).json();
 assert.equal(checked.data.items[0].status,'downloaded');
 const result=await(await call('/v0/store/magnets',{magnet:'magnet:?xt=urn:btih:'+hash})).json();
 assert.equal(cachedOnly,true);
 assert.equal(result.data.files[0].name,'Big Buck Bunny.mp4');
 const link=await(await call('/v0/store/link/generate',{link:result.data.files[0].link})).json();
 assert.equal(link.data.link,'https://media.example.com/bunny.mp4');
});

test('cached checks and playback reuse completed cloud files while unknown sources cannot start downloads or delete library items',async t=>{
 const mutations=[];
 const bridge=await startLocalDebrid({port:0,accounts:{realdebrid:{credential:'provider-fixture',token:'local-session-fixture'}},transport:async(url,options)=>{
  const path=new URL(url).pathname;
  if(options.method==='POST'){
   mutations.push(path);
   assert.equal(path,'/rest/1.0/unrestrict/link');
   assert.equal(new URLSearchParams(options.body).get('link'),'https://real-debrid.com/d/test-link');
   return Response.json({download:'https://media.example.com/movie.mp4'});
  }
  if(path.endsWith('/torrents/info/own123'))return Response.json(info);
  if(path.endsWith('/torrents'))return Response.json([movie]);
  throw Error('Unexpected provider call.');
 }});
 t.after(()=>bridge.close());
 const call=(path,data,method)=>fetch(bridge.url+path,{method:method||(data?'POST':'GET'),headers:{...headers,'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});
 const unknown='a'.repeat(40);
 const checked=await(await call('/v0/store/magnets/check?magnet='+hash+','+unknown)).json();
 assert.equal(checked.data.items[0].status,'downloaded');
 assert.equal(checked.data.items[0].files[0].size,276134947);
 assert.equal(checked.data.items[1].status,'unknown');
 const reused=await(await call('/v0/store/magnets',{magnet:'magnet:?xt=urn:btih:'+hash})).json();
 assert.equal(reused.data.id,'own123');
 assert.equal(reused.data.files[0].link,'https://real-debrid.com/d/test-link');
 assert.equal((await call('/v0/store/magnets',{magnet:'magnet:?xt=urn:btih:'+unknown})).status,409);
 assert.equal((await call('/v0/store/magnets/own123',undefined,'DELETE')).status,405);
 assert.equal((await call('/v0/store/link/generate',{link:'https://other.example/private'})).status,400);
 const link=await(await call('/v0/store/link/generate',{link:'https://real-debrid.com/d/test-link'})).json();
 assert.equal(link.data.link,'https://media.example.com/movie.mp4');
 assert.deepEqual(mutations,['/rest/1.0/unrestrict/link']);
});
