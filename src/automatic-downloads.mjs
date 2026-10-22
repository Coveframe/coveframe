// Vendor configuration stays behind this interface; only profile/root IDs leave it.
export async function readDownloadAppJson(response,path){
 if(!response.ok)throw Error('The download app rejected its check.');
 // Prowlarr's complete formatted schema is over 6 MB. Keep this exception scoped.
 const limit=(path.endsWith('/schema')?12:4)*1024*1024,chunks=[];let size=0;
 for await(const bytes of response.body){size+=bytes.length;if(size>limit)throw Error('Download app response is too large.');chunks.push(bytes);}
 const text=Buffer.concat(chunks).toString('utf8');return text?JSON.parse(text):null;
}
export function downloadClientConfig({credentials,folder}){
 return {bind_address:'127.0.0.1',port:'18806',use_auth:true,download_folder:folder,
  categories:['movies','tv'],default_download_action:'download',mount:{type:'none'},disable_webdav:true,
  log_level:'error',repair:{enabled:false},skip_auto_move:true,
  debrids:['torbox','real-debrid'].filter(id=>credentials[id]).map(id=>({provider:id==='real-debrid'?'realdebrid':id,name:id,api_key:credentials[id],download_uncached:false})),
 };
}
function fields(schema,values){
 return {...schema,fields:schema.fields.map(field=>Object.hasOwn(values,field.name)?{...field,value:values[field.name]}:field)};
}
export async function configureDownloadApps({request,apps,folders,profileIds={}}){
 async function schema(id,kind,implementation){
  const list=await request(id,`/${kind}/schema`),item=list.find(x=>x.implementation===implementation);
  if(!item)throw Error('This app version does not support the recommended setup.');return item;
 }
 async function upsert(id,kind,value){
  const all=await request(id,`/${kind}`),existing=all.find(x=>x.name===value.name);
  if(existing)value={...value,id:existing.id};
  try{await request(id,`/${kind}/test`,'POST',value);}catch{throw Error(`${id} could not test the ${kind==='indexer'?'public indexer':kind==='applications'?'app connection':'download client'}. Check your internet connection and retry setup.`);}
  return request(id,`/${kind}${existing?'/'+existing.id:''}`,existing?'PUT':'POST',value);
 }
 const result={};
 for(const id of ['radarr','sonarr']){
  const profiles=await request(id,'/qualityprofile'),profile=profiles.find(x=>x.id===profileIds[id])||profiles.find(x=>x.name==='HD-1080p');
  if(!profile)throw Error('The recommended 1080p quality profile is missing. Preserve the managed app data and check its settings.');
  const roots=await request(id,'/rootfolder');let root=roots.find(x=>x.path.toLowerCase()===folders[id].toLowerCase());
  if(!root)root=await request(id,'/rootfolder','POST',{path:folders[id]});
  const client=fields(await schema(id,'downloadclient','QBittorrent'),{host:'127.0.0.1',port:18806,useSsl:false,urlBase:'',username:'mediahub',password:apps.decypharr.key,movieCategory:'movies',tvCategory:'tv'});
  await upsert(id,'downloadclient',{...client,name:'Media Hub Debrid',enable:true,priority:1,removeCompletedDownloads:true,removeFailedDownloads:true,tags:[]});
  result[id]={profileId:profile.id,folderId:root.id};
 }
 const knaben=await schema('prowlarr','indexer','Knaben');
 await upsert('prowlarr','indexer',{...knaben,name:'Media Hub Knaben',enable:true,priority:25,appProfileId:1,tags:[]});
 for(const id of ['radarr','sonarr']){
  const implementation=id==='radarr'?'Radarr':'Sonarr';
  const app=fields(await schema('prowlarr','applications',implementation),{prowlarrUrl:apps.prowlarr.url,baseUrl:apps[id].url,apiKey:apps[id].key,syncCategories:id==='radarr'?[2000]:[5000]});
  await upsert('prowlarr','applications',{...app,name:'Media Hub '+implementation,syncLevel:'fullSync',tags:[]});
 }
 await request('prowlarr','/command','POST',{name:'ApplicationIndexerSync',forceSync:true});
 for(const id of ['radarr','sonarr'])await request(id,'/command','POST',{name:'CheckHealth'});
 return result;
}
