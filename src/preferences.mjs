import {mkdir, readFile, writeFile, rename, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';

export function recommendedPreferences() {
  return {moonfin:{autoAdvance:true,trailerPreview:false,themeMusic:false},
    aio:{maxResolution:'any',sortBy:'resolution',excludeLowQuality:true}};
}

export function validatePreferences(section, value) {
  const defaults=recommendedPreferences()[section];
  if (!defaults || !value || typeof value!=='object' || Array.isArray(value) ||
      Object.keys(value).length!==Object.keys(defaults).length || Object.keys(defaults).some(k=>!Object.hasOwn(value,k))) throw Error('Choose supported settings.');
  if (section==='moonfin' && Object.values(value).some(v=>typeof v!=='boolean') ||
      section==='aio' && (!['any','1080p','720p'].includes(value.maxResolution) || !['resolution','size'].includes(value.sortBy) || typeof value.excludeLowQuality!=='boolean')) throw Error('Choose supported settings.');
  return structuredClone(value);
}

// Nonsecret preferences only. Accounts, API keys and library data live elsewhere.
export async function createPreferences(directory) {
  const path=join(directory,'preferences.json');
  let saved=recommendedPreferences(), queue=Promise.resolve();
  try {
    const data=JSON.parse(await readFile(path,'utf8'));
    if(data.version!==1) throw Error('Unsupported preferences version');
    saved={moonfin:validatePreferences('moonfin',data.moonfin),aio:validatePreferences('aio',data.aio)};
  } catch(error) {if(error.code!=='ENOENT') throw Error('Cannot read saved preferences. Preserve the file for recovery.');}
  function save(section,value) {
    const operation=queue.then(async()=>{
      const validated=validatePreferences(section,value);
      const next={...saved,[section]:validated};
      const temporary=join(directory,`preferences-${randomUUID()}.tmp`);
      await mkdir(directory,{recursive:true});
      try {await writeFile(temporary,JSON.stringify({version:1,...next},null,2)+'\n',{flag:'wx',mode:0o600});await rename(temporary,path);saved=next;}
      finally {await rm(temporary,{force:true});}
      return structuredClone(saved);
    });
    queue=operation.catch(()=>{});
    return operation;
  }
  return {read:()=>structuredClone(saved),save,reset:section=>save(section,recommendedPreferences()[section])};
}
