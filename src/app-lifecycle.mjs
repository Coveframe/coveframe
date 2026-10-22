import {mkdir,readFile,writeFile,readdir,realpath,lstat,rm} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute,parse} from 'node:path';
import {randomUUID} from 'node:crypto';
import {mediaPackages} from './media-packages.mjs';

const marker='.media-hub-setup.json';
const ownedApps={Media:'media-hub-windows',AIOStreams:'media-hub-aiostreams',Discovery:'media-hub-discovery',DownloadApps:'media-hub-downloads'};
const targets=['accounts.dpapi','setup.json','preferences.json','Metadata','Downloads',
 'Media/Packages','Media/Downloads','Media/Data','Media/Config','Media/Cache','Media/Logs','Media/Secrets',
 'AIOStreams','Discovery','DownloadApps/Packages','DownloadApps/Downloads','DownloadApps/Data','DownloadApps/Secrets'];

// Removal is deliberately fixed to owned app data. Media and arbitrary paths never enter the delete list.
export async function createAppLifecycle({directory,appDirectory}={}){
 const root=resolve(directory);
 if(!isAbsolute(directory)||root===parse(root).root)throw Error('Use a dedicated Media Hub data directory.');
 await mkdir(root,{recursive:true});
 const canonical=await realpath(root);
 if(canonical.toLowerCase()!==root.toLowerCase())throw Error('The app data folder must not be a link.');
 const identityFile=join(root,marker);let identity;
 try{identity=JSON.parse(await readFile(identityFile,'utf8'));if(identity.app!=='media-hub-local-setup'||!identity.id)throw Error();}
 catch(error){
  if(error.code!=='ENOENT')throw Error('Media Hub data ownership could not be verified.');
  const allowed=new Set(['accounts.dpapi','setup.json','preferences.json','Metadata','Downloads',...Object.keys(ownedApps)]);
  if((await readdir(root)).some(name=>!allowed.has(name)))throw Error('Use a dedicated Media Hub data folder. Existing files were preserved.');
  identity={app:'media-hub-local-setup',id:randomUUID()};await writeFile(identityFile,JSON.stringify(identity),{flag:'wx',mode:0o600});
 }
 async function checked(path){
  const target=resolve(root,path),rel=relative(canonical,target);
  if(!rel||rel.startsWith('..')||isAbsolute(rel))throw Error('Removal must stay in this Media Hub data folder.');
  try{const info=await lstat(target);if(info.isSymbolicLink()||(await realpath(target)).toLowerCase()!==target.toLowerCase())throw Error('Linked app folders must be removed manually.');return target;}
  catch(error){if(error.code==='ENOENT')return null;throw error;}
 }
 async function preflight(){
  if((await realpath(root)).toLowerCase()!==canonical.toLowerCase())throw Error('The data folder changed. No files were removed.');
  const current=JSON.parse(await readFile(identityFile,'utf8'));
  if(current.id!==identity.id||current.app!==identity.app)throw Error('The data folder identity changed. No files were removed.');
  for(const [name,app] of Object.entries(ownedApps)){
   if(!await checked(name))continue;
   const files=await readdir(join(root,name));
   // Secrets-only folders can be created when opening an app before its first setup.
   if(files.every(x=>x==='Secrets'))continue;
   let value;try{value=JSON.parse(await readFile(join(root,name,'installation.json'),'utf8'));}catch{}
   if(value?.app!==app||!value.id)throw Error('An app folder has no matching ownership marker. No files were removed.');
  }
  const list=[];for(const path of targets){const target=await checked(path);if(target)list.push(target);}return list;
 }
 return {
  review:async()=>({dataDirectory:root,appDirectory:appDirectory?resolve(appDirectory):null,
   removed:['Downloaded apps and caches','Household profiles and app databases','Saved accounts, API keys and preferences'],
   kept:[join(root,'Media','Library'),join(root,'DownloadApps','Files')],
   packages:Object.entries(mediaPackages).map(([id,pkg])=>({id,version:pkg.version,source:pkg.url||null,bundled:!pkg.url})),
   startup:'Only while Media Hub is open; no Windows service or automatic startup.',
   credentials:'Windows-user encrypted vault; vendor databases and configuration stay in private folders on this PC.'}),
  async uninstall({confirmation}={}){
   if(confirmation!=='REMOVE MEDIA HUB')throw Error('Confirm removal before uninstalling.');
   const list=await preflight();
   // Re-check each absolute target immediately before deletion; never interpolate shell commands.
   for(const target of list){await checked(relative(root,target));await rm(target,{recursive:true,force:true});}
   // Keep the root marker so an empty retained Library/Files folder can be reviewed safely on a later install.
   return {ok:true,mediaPreserved:true,launcherRemoval:'Delete the extracted application folder after closing Media Hub.'};
  },
 };
}
