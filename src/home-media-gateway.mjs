import {createServer,request as httpRequest} from 'node:http';
import {request as httpsRequest} from 'node:https';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {pipeline} from 'node:stream/promises';

export function privateIPv4(value){
 if(isIP(value)!==4)return false;
 const [a,b]=value.split('.').map(Number);return a===10||a===172&&b>=16&&b<=31||a===192&&b===168;
}
const numeric=value=>value.split('.').reduce((n,x)=>(n*256+Number(x))>>>0,0);
function localPeer(peer,address,prefix){
 peer=peer?.replace(/^::ffff:/,'');if(!privateIPv4(peer)&&peer!=='127.0.0.1')return false;
 const mask=(0xffffffff<<(32-prefix))>>>0;return (numeric(peer)&mask)===(numeric(address)&mask);
}
const hop=new Set(['connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade']);
const headersWithoutHop=headers=>Object.fromEntries(Object.entries(headers).filter(([key])=>!hop.has(key.toLowerCase())));
function publiclyRouted(address){
 if(isIP(address)===4){const [a,b]=address.split('.').map(Number);return !(privateIPv4(address)||a===0||a===127||a>=224||a===169&&b===254||a===100&&b>=64&&b<=127||a===198&&[18,19].includes(b));}
 return isIP(address)===6&&/^[23][0-9a-f]{0,3}:/i.test(address);
}

// A media-only front door: no setup, AIO configuration, debrid or download APIs.
// Jellyfin retains authentication; source redirects are fetched here so a TV
// never has to reach a loopback address or receive provider credentials.
export async function startHomeMediaGateway({address,prefixLength,port=18799,
 jellyfin='http://127.0.0.1:18798',playback='http://127.0.0.1:18801',
 localStreams=['http://127.0.0.1:18800','http://127.0.0.1:18807']}={}){
 // Loopback is only accepted for isolated integration fixtures (ephemeral port).
 if((!privateIPv4(address)&&!(port===0&&address==='127.0.0.1'))||!Number.isInteger(prefixLength)||prefixLength<8||prefixLength>30)throw Error('Choose a private home IPv4 connection.');
 const sockets=new Set();let url,deviceSeen=false,lastDeviceAt=null,signedIn=false;
 const localOrigins=new Set([playback,...localStreams].map(x=>new URL(x).origin));
 const rewrite=value=>{
  if(typeof value==='string')return value.replaceAll(playback,url+'/coveframe-stream').replaceAll(jellyfin,url);
  if(Array.isArray(value))return value.map(rewrite);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,v])=>[key,key==='SeerrEnabled'?false:key==='SeerrUrl'?'':rewrite(v)]));
  return value;
 };
 function reject(response,status=502){if(response.headersSent){response.destroy();return;}response.writeHead(status,{'Content-Type':'text/plain','Cache-Control':'no-store'});response.end('TV connection unavailable. Open Coveframe on the server PC and check Your TV.');}
 function permitted(request){return request.headers.host===new URL(url).host&&localPeer(request.socket.remoteAddress,address,prefixLength)&&(!request.headers.origin||request.headers.origin===url);}
 function observe(request){if(request.socket.remoteAddress?.replace(/^::ffff:/,'')!==address){deviceSeen=true;lastDeviceAt=new Date().toISOString();}}
 async function stream(request,response){
  if(!['GET','HEAD'].includes(request.method))return reject(response,405);
  const path=request.url.slice('/coveframe-stream'.length);
  if(!/^\/[a-f0-9]{64}\/(movie|series)\/tt\d{5,12}(?::\d{1,4}:\d{1,5})?\/stream$/.test(path))return reject(response,404);
  let target=new URL(playback+path),active;
  const cancel=()=>active?.destroy();response.once('close',cancel);
  try{
   for(let i=0;i<8;i++){
    if(target.username||target.password||target.hash)throw Error();
    let addresses;
    if(!localOrigins.has(target.origin)){
     if(target.protocol!=='https:'||target.username||target.password||target.hash||target.port&&target.port!=='443')throw Error();
     addresses=await lookup(target.hostname,{all:true});if(!addresses.length||!addresses.every(x=>publiclyRouted(x.address)))throw Error();
    }
    const upstream=await new Promise((yes,no)=>{
     active=(target.protocol==='https:'?httpsRequest:httpRequest)(target,{method:request.method,
      headers:{...(request.headers.range?{Range:request.headers.range}:{}),...(request.headers['user-agent']?{'User-Agent':request.headers['user-agent']}:{}),'Accept-Encoding':'identity'},
      ...(addresses?{lookup:(_host,opts,callback)=>callback(null,opts?.all?addresses:addresses[0].address,addresses[0].family)}:{})},yes);
     active.on('error',no);active.setTimeout(45000,()=>active.destroy(Error('Timeout')));active.end();
    });
    if([301,302,303,307,308].includes(upstream.statusCode)){
     const next=new URL(upstream.headers.location,target);upstream.destroy();target=next;continue;
    }
    if(![200,206,416].includes(upstream.statusCode)){upstream.destroy();throw Error();}
    // A paused player can stop reading for a long time. Keep the connection
    // timeout for headers, then let backpressure govern the media response.
    active.setTimeout(0);
    const headers={};for(const key of ['content-type','content-length','content-range','accept-ranges','last-modified','etag'])if(upstream.headers[key])headers[key]=upstream.headers[key];
    response.writeHead(upstream.statusCode,{...headers,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
    await pipeline(upstream,response);return;
   }
   throw Error();
  }finally{response.off('close',cancel);if(!response.writableFinished)active?.destroy();}
 }
 const server=createServer(async(request,response)=>{
  response.setHeader('Referrer-Policy','no-referrer');response.setHeader('X-Content-Type-Options','nosniff');
  if(!permitted(request))return reject(response,403);
  // Reject proxy-form URLs and URL normalization that could escape the fixed origin.
  if(!request.url.startsWith('/')||request.url.startsWith('//')||request.url.includes('\\'))return reject(response,400);
  if(request.url.startsWith('/coveframe-stream')){observe(request);try{await stream(request,response);}catch{reject(response);}return;}
  if(/^\/(api|health|\.env)(\/|\?|$)/i.test(request.url))return reject(response,404);
  const headers=headersWithoutHop(request.headers);
  // Never trust client-supplied forwarding headers or leak the wizard token.
  for(const key of Object.keys(headers))if(key.startsWith('x-forwarded-')||['forwarded','x-real-ip','x-media-hub-token'].includes(key))delete headers[key];
  headers.host=new URL(jellyfin).host;headers['accept-encoding']='identity';
  const upstream=httpRequest(jellyfin+request.url,{method:request.method,headers},async result=>{
   upstream.setTimeout(0);
   try{
    if(result.statusCode<400){observe(request);if(/^\/Users\/(Me|AuthenticateByName)(\?|$)/i.test(request.url)&&request.socket.remoteAddress!==address)signedIn=true;}
    const out=headersWithoutHop(result.headers);
    delete out['access-control-allow-origin'];delete out['access-control-allow-credentials'];
    if(out.location)out.location=rewrite(out.location);
    if(/application\/json/i.test(out['content-type']||'')&&request.method!=='HEAD'){
     const chunks=[];let size=0;for await(const chunk of result){size+=chunk.length;if(size>16*1024*1024)throw Error();chunks.push(chunk);}
     const bytes=Buffer.from(JSON.stringify(rewrite(JSON.parse(Buffer.concat(chunks).toString('utf8')))));
     delete out['content-encoding'];delete out.etag;out['content-length']=bytes.length;
     response.writeHead(result.statusCode,{...out,'Cache-Control':'no-store'});response.end(bytes);
    }else{response.writeHead(result.statusCode,out);await pipeline(result,response);}
   }catch{reject(response);}
  });
  upstream.setTimeout(60000,()=>upstream.destroy());upstream.on('error',()=>reject(response));
  response.on('close',()=>{if(!response.writableFinished)upstream.destroy();});request.on('error',()=>upstream.destroy());request.on('aborted',()=>upstream.destroy());request.pipe(upstream);
 });
 server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
 server.on('upgrade',(request,socket,head)=>{
  if(!permitted(request)||!/^\/socket(?:\?|$)/i.test(request.url)){socket.destroy();return;}
  const headers={...request.headers,host:new URL(jellyfin).host};
  for(const key of Object.keys(headers))if(key.startsWith('x-forwarded-')||['forwarded','x-real-ip','x-media-hub-token'].includes(key))delete headers[key];
  const upstream=httpRequest(jellyfin+request.url,{headers});
  const timeout=setTimeout(()=>{upstream.destroy();socket.destroy();},10000);timeout.unref();
  socket.on('error',()=>upstream.destroy());socket.on('close',()=>{clearTimeout(timeout);upstream.destroy();});
  upstream.on('upgrade',(result,remote,remoteHead)=>{
   clearTimeout(timeout);
   sockets.add(remote);remote.on('close',()=>sockets.delete(remote));
   socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(result.headers).map(([k,v])=>`${k}: ${v}`).join('\r\n')}\r\n\r\n`);
   if(remoteHead.length)socket.write(remoteHead);if(head.length)remote.write(head);
   remote.on('error',()=>socket.destroy());socket.on('error',()=>remote.destroy());socket.on('end',()=>remote.end());remote.on('end',()=>socket.end());socket.on('close',()=>remote.destroy());remote.on('close',()=>socket.destroy());socket.pipe(remote).pipe(socket);
  });upstream.on('response',()=>{clearTimeout(timeout);socket.destroy();});upstream.on('error',()=>{clearTimeout(timeout);socket.destroy();});upstream.end();
 });
 server.requestTimeout=30000;server.headersTimeout=10000;server.maxConnections=100;
 await new Promise((yes,no)=>{server.once('error',no);server.listen(port,address,yes);});
 url=`http://${address}:${server.address().port}`;
 return {url,status:()=>({deviceSeen,lastDeviceAt,signedIn}),
  async check(){try{const response=await fetch(url+'/System/Info/Public',{signal:AbortSignal.timeout(5000),redirect:'error'});return response.ok&&typeof(await response.json()).Id==='string';}catch{return false;}},
  close:()=>new Promise(resolve=>{server.close(resolve);for(const socket of sockets)socket.destroy();server.closeAllConnections();}),
 };
}
