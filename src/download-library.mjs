import {stat} from 'node:fs/promises';
import {win32} from 'node:path';
const same=(a,b)=>win32.normalize(a).replace(/[\\/]+$/,'').toLowerCase()===win32.normalize(b).replace(/[\\/]+$/,'').toLowerCase();
export async function connectDownloadLibrary({request,type,path,checkPath=async value=>{if(!(await stat(value)).isDirectory())throw Error();}}){
  if(!['movie','tv'].includes(type)||typeof path!=='string'||! /^[a-z]:\\[^<>:"|?*\x00-\x1f]+$/i.test(path)||path.length>240||path.split(/[\\/]/).includes('..')||same(path,win32.parse(path).root)||/^C:\\Windows(?:\\|$)/i.test(path))throw Error('Choose an existing local download folder on this Windows PC.');
  try{await checkPath(path);}catch{throw Error('Jellyfin cannot read this folder on this PC. Check the download app folder and Windows access.');}
  const name=type==='movie'?'Downloaded Movies':'Downloaded TV',folders=await request('/Library/VirtualFolders');
  const existing=folders.find(x=>x.Name===name);
  if(!existing){
    await request(`/Library/VirtualFolders?name=${encodeURIComponent(name)}&collectionType=${type==='movie'?'movies':'tvshows'}&refreshLibrary=true`,'POST',{
      LibraryOptions:{PathInfos:[{Path:path}],EnableRealtimeMonitor:true,EnableInternetProviders:true,PreferredMetadataLanguage:'en',SubtitleDownloadLanguages:['eng'],RequirePerfectSubtitleMatch:true,EnableChapterImageExtraction:false,EnableTrickplayImageExtraction:false},
    });
  }else if(!existing.Locations?.some(x=>same(x,path))){
    await request('/Library/VirtualFolders/Paths?refreshLibrary=true','POST',{Name:name,PathInfo:{Path:path}});
  }
  const updated=await request('/Library/VirtualFolders');
  if(!updated.some(x=>x.Name===name&&x.Locations?.some(location=>same(location,path))))throw Error('The download folder was not confirmed in Jellyfin. No download was started.');
  return {linked:true,library:name};
}
