import {validateSelection} from './discovery-catalog.mjs';
const ids=['radarr','sonarr'];
const name=id=>id==='radarr'?'Radarr':'Sonarr';
const clone=value=>structuredClone(value);
export function localDownloadUrl(value){
  let url;try{url=new URL(value);}catch{throw Error('Use the app address on this PC, such as http://127.0.0.1:7878.');}
  if(url.protocol!=='http:'||!['localhost','127.0.0.1'].includes(url.hostname)||url.username||url.password||url.search||url.hash||!url.port||Number(url.port)<1024||!/^\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]*$/.test(url.pathname))throw Error('Use the app address on this PC without a key or query in the URL.');
  url.hostname='127.0.0.1';return url.href.replace(/\/$/,'');
}
export async function createDownloadConnections({vault,fetchImpl=fetch}){
  let saved=await vault.read(),states={},queue=Promise.resolve();const abort=new AbortController();
  function valid(id){if(!ids.includes(id))throw Error('Choose Radarr or Sonarr.');}
  const serial=operation=>{const next=queue.then(operation);queue=next.catch(()=>{});return next;};
  async function call(config,path,method='GET',data){
    try{
      const response=await fetchImpl(config.url+'/api/v3'+path,{method,redirect:'error',signal:AbortSignal.any([abort.signal,AbortSignal.timeout(12000)]),
        headers:{'X-Api-Key':config.key,'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});
      if(!response.ok)throw Error();
      const chunks=[];let size=0;
      for await(const bytes of response.body){size+=bytes.length;if(size>4*1024*1024){await response.body.cancel().catch(()=>{});throw Error();}chunks.push(bytes);}
      const result=Buffer.concat(chunks).toString('utf8');return result?JSON.parse(result):null;
    }catch{throw Error('Could not contact the download app. Check its address and API key, then reconnect.');}
  }
  async function inspect(id,config){
    const system=await call(config,'/system/status');
    if(system.appName?.toLowerCase()!==id)throw Error(`This address is not ${name(id)}. Check the app and try again.`);
    const [profiles,folders,clients,indexers,health]=await Promise.all(['/qualityprofile','/rootfolder','/downloadclient','/indexer','/health'].map(path=>call(config,path)));
    if(![profiles,folders,clients,indexers,health].every(Array.isArray))throw Error('The download app returned unsupported setup information.');
    const options={profiles:profiles.filter(x=>Number.isInteger(x.id)&&x.id>0).map(x=>({id:x.id,name:String(x.name).slice(0,100)})),
      folders:folders.filter(x=>Number.isInteger(x.id)&&x.id>0&&typeof x.path==='string'&&x.accessible!==false).map(x=>({id:x.id,path:x.path}))};
    const profileId=config.profileId??(options.profiles.length===1?options.profiles[0].id:null),folderId=config.folderId??(options.folders.length===1?options.folders[0].id:null);
    const issues=[];
    if(!clients.some(x=>x.enable===true))issues.push(`Add an enabled download client in ${name(id)} Settings → Download Clients.`);
    if(!indexers.some(x=>x.enableAutomaticSearch===true))issues.push(`Add an indexer with automatic search enabled in ${name(id)} Settings → Indexers.`);
    if(!options.profiles.some(x=>x.id===profileId))issues.push('Choose a quality profile below.');
    if(!options.folders.some(x=>x.id===folderId))issues.push('Choose an accessible download folder below.');
    if(health.some(x=>String(x.type).toLowerCase()==='error'))issues.push(`Resolve the errors in ${name(id)} System → Status.`);
    return {...options,profileId,folderId,issues,pipelineReady:issues.length===0,configured:true,verifiedThisSession:true,url:config.url};
  }
  return {
    status:()=>Object.fromEntries(ids.map(id=>[id,clone(states[id]||{configured:Boolean(saved[id]),...(saved[id]?{url:saved[id].url,profileId:saved[id].profileId,folderId:saved[id].folderId}:{}),verifiedThisSession:false,pipelineReady:false,issues:saved[id]?['Reconnect to check this app before downloading.']:[]})])),
    invalidate(id){valid(id);delete states[id];},
    connect(id,{url,credential}={}){return serial(async()=>{
      valid(id);url=localDownloadUrl(url);
      if(typeof credential!=='string'||!credential.trim()||credential.length>256||/[\x00-\x1f\x7f]/.test(credential))throw Error('Paste the API key from the download app.');
      const config={url,key:credential.trim()},state=await inspect(id,config);
      Object.assign(config,{profileId:state.profileId,folderId:state.folderId});
      const next={...saved,[id]:config};await vault.write(next);saved=next;states[id]=state;return clone(state);
    });},
    configure(id,{profileId,folderId}={}){return serial(async()=>{
      valid(id);if(!saved[id])throw Error('Connect the download app first.');
      if(!Number.isInteger(profileId)||!Number.isInteger(folderId))throw Error('Choose a quality profile and download folder.');
      const nextConfig={...saved[id],profileId,folderId},state=await inspect(id,nextConfig);
      if(!state.profiles.some(x=>x.id===profileId)||!state.folders.some(x=>x.id===folderId))throw Error('Choose a listed profile and folder.');
      const next={...saved,[id]:nextConfig};await vault.write(next);saved=next;states[id]=state;return clone(state);
    });},
    recheck(id){return serial(async()=>{valid(id);if(!saved[id])throw Error('Connect the download app first.');states[id]={configured:true,verifiedThisSession:false,pipelineReady:false};states[id]=await inspect(id,saved[id]);return clone(states[id]);});},
    disconnect(id){return serial(async()=>{valid(id);const next={...saved};delete next[id];await vault.write(next);saved=next;delete states[id];return {configured:false};});},
    requestTitle(title,{season,linkLibrary}={}){return serial(async()=>{
      validateSelection(title);const id=title.type==='movie'?'radarr':'sonarr',config=saved[id];
      if(!config)throw Error(`Connect ${name(id)} in Downloads first.`);
      states[id]={configured:true,verifiedThisSession:false,pipelineReady:false};
      const state=states[id]=await inspect(id,config);
      if(!state.pipelineReady)throw Error(`Finish the ${name(id)} checks in Downloads before requesting files.`);
      const root=state.folders.find(x=>x.id===state.folderId).path;
      // The owned Jellyfin must see this same-PC folder before any download starts.
      await linkLibrary(title.type,root);
      let alreadyManaged=false;
      if(id==='radarr'){
        const movies=await call(config,`/movie?tmdbId=${title.id}`);
        if(!Array.isArray(movies))throw Error('Could not check existing movies. Try again.');
        const existing=movies.find(x=>x.tmdbId===title.id);
        if(existing)alreadyManaged=true;
        else{
          const choices=await call(config,`/movie/lookup?term=tmdb%3A${title.id}`),movie=choices.find(x=>x.tmdbId===title.id);
          if(!movie)throw Error('Radarr could not match this movie.');
          const {id:unused,...metadata}=movie;
          const added=await call(config,'/movie','POST',{...metadata,title:movie.title,tmdbId:title.id,qualityProfileId:state.profileId,
            rootFolderPath:root,monitored:true,minimumAvailability:'released',addOptions:{searchForMovie:true}});
          if(!Number.isInteger(added?.id))throw Error('Radarr did not acknowledge this request. Check it before retrying.');
        }
      }else{
        if(!Number.isInteger(title.tvdbId)||title.tvdbId<1||!title.seasons?.some(x=>x.number===season))throw Error('Choose a matched TV season before requesting files.');
        const all=await call(config,'/series');
        if(!Array.isArray(all))throw Error('Could not check existing shows. Try again.');
        const existing=all.find(x=>x.tvdbId===title.tvdbId);
        if(existing){
          alreadyManaged=existing.seasons?.some(x=>x.seasonNumber===season&&x.monitored===true)&&existing.monitored===true;
          if(!alreadyManaged){
            const seasons=(existing.seasons||[]).map(x=>x.seasonNumber===season?{...x,monitored:true}:x);
            if(!seasons.some(x=>x.seasonNumber===season))seasons.push({seasonNumber:season,monitored:true});
            await call(config,`/series/${existing.id}`,'PUT',{...existing,monitored:true,seasons});
            await call(config,'/command','POST',{name:'SeasonSearch',seriesId:existing.id,seasonNumber:season});
          }
        }else{
          const choices=await call(config,`/series/lookup?term=tvdb%3A${title.tvdbId}`),show=choices.find(x=>x.tvdbId===title.tvdbId);
          if(!show)throw Error('Sonarr could not match this show.');
          if(!show.seasons?.some(x=>x.seasonNumber===season))throw Error('Sonarr could not match this season. Check the season in Sonarr before retrying.');
          const {id:unused,...metadata}=show;
          const added=await call(config,'/series','POST',{...metadata,tvdbId:title.tvdbId,qualityProfileId:state.profileId,rootFolderPath:root,
            monitored:true,monitorNewItems:'none',seasonFolder:true,seriesType:show.seriesType||'standard',
            seasons:(show.seasons||[]).map(x=>({seasonNumber:x.seasonNumber,monitored:x.seasonNumber===season})),
            addOptions:{ignoreEpisodesWithFiles:true,searchForMissingEpisodes:true}});
          if(!Number.isInteger(added?.id))throw Error('Sonarr did not acknowledge this request. Check it before retrying.');
        }
      }
      return {accepted:true,manager:id,alreadyManaged,libraryConnected:true,downloadVerified:false};
    });},
    stop(){abort.abort();return queue;},
  };
}
