import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer,request} from 'node:http';
import {startHomeMediaGateway} from '../src/home-media-gateway.mjs';

async function serve(t,handler){const server=createServer(handler),sockets=new Set();server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.close(resolve);for(const socket of sockets)socket.destroy();server.closeAllConnections();}));return {server,url:`http://127.0.0.1:${server.address().port}`};}
test('TV clients sign in, receive reachable playback links and seek without exposing provider URLs or setup APIs',async t=>{
 const token='a'.repeat(64);let forwardedAuth,range;
 const media=await serve(t,(req,res)=>{
  assert.equal(req.headers.authorization,undefined,'household authorization must not reach a provider');
  range=req.headers.range;res.writeHead(206,{'Content-Type':'video/mp4','Content-Range':'bytes 2-5/8','Content-Length':'4','Accept-Ranges':'bytes'});res.end(req.method==='HEAD'?undefined:'cdef');
 });
 const playback=await serve(t,(req,res)=>{res.writeHead(302,{Location:media.url+'/private-provider-link'});res.end();});
 const jellyfin=await serve(t,(req,res)=>{
  forwardedAuth=req.headers['x-emby-token'];res.setHeader('content-type','application/json');
  if(req.url==='/System/Info/Public')res.end(JSON.stringify({Id:'fixture-server',LocalAddress:'http://127.0.0.1:18798'}));
  else if(req.url==='/Users/Me'){res.statusCode=req.headers['x-emby-token']==='viewer-session'?200:401;res.end('{}');}
  else res.end(JSON.stringify({MediaSources:[{Path:playback.url+'/'+token+'/movie/tt1234567/stream'}]}));
 });
 const gateway=await startHomeMediaGateway({address:'127.0.0.1',prefixLength:24,port:0,jellyfin:jellyfin.url,playback:playback.url,localStreams:[media.url]});t.after(()=>gateway.close());
 assert.equal(await gateway.check(),true);assert.equal(gateway.status().deviceSeen,false);
 assert.equal((await fetch(gateway.url+'/Users/Me')).status,401);
 const headers={'X-Emby-Token':'viewer-session'};
 assert.equal((await fetch(gateway.url+'/Users/Me',{headers})).status,200);assert.equal(forwardedAuth,'viewer-session');
 const info=await fetch(gateway.url+'/Items/123/PlaybackInfo',{headers}).then(r=>r.json());
 assert.equal(info.MediaSources[0].Path,gateway.url+'/coveframe-stream/'+token+'/movie/tt1234567/stream');
 const stream=await fetch(info.MediaSources[0].Path,{headers:{...headers,Range:'bytes=2-5'}});
 assert.equal(stream.status,206);assert.equal(await stream.text(),'cdef');assert.equal(range,'bytes=2-5');assert.equal(stream.headers.get('location'),null);
 assert.equal((await fetch(gateway.url+'/api/state')).status,404);
 assert.equal((await fetch(gateway.url+'/System/Info/Public',{headers:{Origin:'https://unrelated.example'}})).status,403);
 assert.equal((await fetch(gateway.url+'/coveframe-stream/wrong')).status,404);
});

test('TV streaming rejects redirects into unrelated local services, and media websocket upgrades work',async t=>{
 let touched=false;
 const privateApp=await serve(t,(_req,res)=>{touched=true;res.end('secret');});
 const playback=await serve(t,(_req,res)=>{res.writeHead(302,{Location:privateApp.url+'/api/state'});res.end();});
 const jellyfin=await serve(t,(_req,res)=>res.end('{}'));
 jellyfin.server.on('upgrade',(_req,socket)=>{socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');socket.on('data',bytes=>socket.write(bytes));});
 const gateway=await startHomeMediaGateway({address:'127.0.0.1',prefixLength:24,port:0,jellyfin:jellyfin.url,playback:playback.url,localStreams:[]});t.after(()=>gateway.close());
 assert.equal((await fetch(gateway.url+'/coveframe-stream/'+'b'.repeat(64)+'/movie/tt1234567/stream')).status,502);assert.equal(touched,false);
 const echo=await new Promise((resolve,reject)=>{
  const req=request(gateway.url+'/socket?api_key=viewer-session',{headers:{Connection:'Upgrade',Upgrade:'websocket'}});
  req.on('upgrade',(_res,socket)=>{socket.once('data',bytes=>{resolve(bytes.toString());socket.destroy();});socket.write('frame');});req.on('error',reject);req.end();
 });assert.equal(echo,'frame');
});
