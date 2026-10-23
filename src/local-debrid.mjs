import {createServer} from 'node:http';
import {timingSafeEqual} from 'node:crypto';

const hashOf=value=>/^[a-f0-9]{40}$/i.test(value)?value.toLowerCase():String(value).match(/(?:\?|&)xt=urn:btih:([a-f0-9]{40})(?:&|$)/i)?.[1].toLowerCase();
const validId=id=>/^[a-zA-Z0-9_-]{1,80}$/.test(String(id));
const deny=status=>{throw Object.assign(Error('Local provider request unavailable.'),{status});};
function mediaLink(value){const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password)deny(503);return {link:url.href};}

function realDebrid(call){
 const links=new Set(),details=new Map();let library,pending;
 const item=x=>({id:x.id,hash:x.hash,name:x.filename,size:x.bytes,added_at:x.added,status:x.status==='downloaded'?'downloaded':'unknown',private:false});
 async function completed(){
  if(library?.expires>Date.now())return library.items;
  pending??=call('/torrents?limit=5000').then(({data})=>{
   if(!Array.isArray(data))deny(503);
   library={expires:Date.now()+30000,items:data.filter(x=>x.status==='downloaded')};return library.items;
  }).finally(()=>{pending=null;});return pending;
 }
 async function detail(id){
  if(details.has(id))return details.get(id);
  const {data}=await call('/torrents/info/'+id);
  if(data.status!=='downloaded')return {...item(data),files:[]};
  let index=0;
  const files=(data.files||[]).filter(f=>f.selected===1).map(f=>{
   const link=data.links?.[index++];if(link)links.add(link);
   return {index:f.id,name:f.path.split('/').pop(),path:f.path,size:f.bytes,link};
  });
  const result={...item(data),files};details.set(id,result);return result;
 }
 return {
  detail,
  async list(limit,offset){const {data,total}=await call('/torrents?limit='+limit+(offset?'&offset='+offset:''));if(!Array.isArray(data))deny(503);return {items:data.map(item),total_items:total||data.length};},
  async check(hashes){
   const all=await completed(),items=[];
   for(const hash of hashes){const match=all.find(x=>x.hash?.toLowerCase()===hash);const found=match?await detail(match.id):{status:'unknown',files:[]};
    items.push({hash,magnet:hash,status:found.status,files:found.files.map(({link,...file})=>file)});}
   return {items};
  },
  async add(magnet){const match=(await completed()).find(x=>x.hash?.toLowerCase()===hashOf(magnet));if(!match)deny(409);return detail(match.id);},
  async generate(link){if(!links.has(link))deny(400);return mediaLink((await call('/unrestrict/link',new URLSearchParams({link}))).data.download);},
  async user(){return {id:'local-account',email:'',subscription_status:(await call('/user')).data.type==='premium'?'premium':'free'};}
 };
}

function torbox(call,credential){
 const links=new Map();
 const item=x=>({id:String(x.id),hash:x.hash,name:x.name,size:x.size,added_at:x.created_at,status:x.download_finished?'downloaded':'unknown',private:false});
 const files=(x,linked=false)=>(x.files||[]).map(f=>{
  const link='coveframe:torbox:'+x.id+':'+f.id;
  if(linked)links.set(link,{torrent_id:String(x.id),file_id:String(f.id)});
  return {index:f.id,name:f.short_name||f.name.split('/').pop(),path:f.name,size:f.size,...(linked?{link}:{})};
 });
 async function detail(id){
  const {data}=await call('/torrents/mylist?id='+id+'&bypass_cache=true');
  const x=Array.isArray(data)?data.find(x=>String(x.id)===String(id)):data;
  if(!x||String(x.id)!==String(id))deny(503);
  return {...item(x),files:files(x,true)};
 }
 return {
  detail,
  async list(limit,offset){const {data}=await call('/torrents/mylist?bypass_cache=true');if(!Array.isArray(data))deny(503);return {items:data.slice(offset,offset+limit).map(item),total_items:data.length};},
  async check(hashes){const {data}=await call('/torrents/checkcached?hash='+hashes.join(',')+'&format=object&list_files=true');
   return {items:hashes.map(hash=>({hash,magnet:hash,status:data?.[hash]?'downloaded':'unknown',files:data?.[hash]?files(data[hash]):[]}))};},
  async add(magnet){const form=new FormData();form.set('magnet',magnet);form.set('add_only_if_cached','true');
   const {data}=await call('/torrents/createtorrent',form);if(!validId(data?.torrent_id))deny(503);return detail(data.torrent_id);},
  async generate(link){if(!links.has(link))deny(400);const query=new URLSearchParams({token:credential,...links.get(link),redirect:'false',zip_link:'false'});
   return mediaLink((await call('/torrents/requestdl?'+query)).data);},
  async user(){return {id:'local-account',email:'',subscription_status:(await call('/user/me?settings=false')).data.plan>0?'premium':'free'};}
 };
}

// Implements only AIO's provider protocol. Real keys go solely to official APIs;
// AIO receives disposable loopback tokens and cannot request arbitrary URLs.
export async function startLocalDebrid({accounts,port=18807,transport=fetch}){
 const abort=new AbortController(),stores=new Map();let url;
 for(const [name,account] of Object.entries(accounts||{})){
  if(!['torbox','realdebrid'].includes(name)||!account.credential||!account.token)throw Error('A local provider connection is required.');
  const call=async(path,body)=>{
   const base=name==='torbox'?'https://api.torbox.app/v1/api':'https://api.real-debrid.com/rest/1.0';
   const response=await transport(base+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+account.credential,Accept:'application/json'},
    ...(body?{body}:{}),redirect:'error',signal:AbortSignal.any([abort.signal,AbortSignal.timeout(20000)])});
   if(!response.ok)deny(503);
   if(name==='realdebrid'&&response.status===204&&/^\/torrents\?/.test(path))return {data:[],total:0};
   const chunks=[];let size=0;
   for await(const chunk of response.body){size+=chunk.length;if(size>4*1024*1024)deny(503);chunks.push(chunk);}
   const raw=JSON.parse(Buffer.concat(chunks).toString());
   if(name==='torbox'&&!raw.success)deny(503);
   return {data:name==='torbox'?raw.data:raw,total:Number(response.headers.get('X-Total-Count'))};
  };
  stores.set(name,{token:'Bearer '+account.token,adapter:name==='torbox'?torbox(call,account.credential):realDebrid(call)});
 }
 async function body(req){let text='';for await(const chunk of req){text+=chunk;if(text.length>16384)deny(400);}
  if(!/^application\/json\b/.test(req.headers['content-type']||''))deny(400);try{return JSON.parse(text);}catch{deny(400);}}
 const server=createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(status===200?{data}:{error:{code:'PROVIDER_UNAVAILABLE',type:'api_error',message:'Local provider request unavailable.'}}));};
  if(req.headers.host!==new URL(url).host||req.headers.origin)return send(403);
  const store=stores.get(req.headers['x-stremthru-store-name']),auth=Buffer.from(req.headers['x-stremthru-store-authorization']||'');
  if(!store||auth.length!==Buffer.byteLength(store.token)||!timingSafeEqual(auth,Buffer.from(store.token)))return send(401);
  const adapter=store.adapter;
  try{
   const target=new URL(req.url,url);
   if(req.method==='GET'&&target.pathname==='/v0/store/magnets/check'){
    const hashes=(target.searchParams.get('magnet')||'').split(',').map(hashOf);
    if(hashes.length>500||hashes.some(x=>!x))return send(400);return send(200,await adapter.check(hashes));
   }
   if(req.method==='POST'&&target.pathname==='/v0/store/magnets'){
    const input=await body(req);if(!hashOf(input.magnet||''))return send(400);return send(200,await adapter.add(input.magnet));
   }
   const match=target.pathname.match(/^\/v0\/store\/magnets\/([a-zA-Z0-9_-]{1,80})$/);
   if(match){if(req.method==='DELETE')return send(405);if(req.method==='GET')return send(200,await adapter.detail(match[1]));}
   if(req.method==='POST'&&target.pathname==='/v0/store/link/generate'){const input=await body(req);return send(200,await adapter.generate(input.link));}
   if(req.method==='GET'&&target.pathname==='/v0/store/user')return send(200,await adapter.user());
   if(req.method==='GET'&&target.pathname==='/v0/store/magnets'){
    const limit=Number(target.searchParams.get('limit')||100),offset=Number(target.searchParams.get('offset')||0);
    if(!Number.isInteger(limit)||limit<1||limit>500||!Number.isInteger(offset)||offset<0||offset>5000)return send(400);
    return send(200,await adapter.list(limit,offset));
   }
   send(404);
  }catch(error){send(error.status||503);}
 });
 server.requestTimeout=30000;server.headersTimeout=10000;server.maxConnections=20;
 await new Promise((yes,no)=>{server.once('error',no);server.listen(port,'127.0.0.1',yes);});
 url='http://127.0.0.1:'+server.address().port;
 return {url,async close(){abort.abort();stores.clear();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});}};
}
