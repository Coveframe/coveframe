import {readFile,realpath,lstat,mkdir,symlink} from 'node:fs/promises';
import {join,resolve,dirname,sep} from 'node:path';
export async function materializePackageLinks(packageRoot) {
  let manifest;
  try{manifest=JSON.parse(await readFile(join(packageRoot,'runtime-links.json'),'utf8'));}catch(error){if(error.code==='ENOENT')return;throw error;}
  if(!Array.isArray(manifest.links)||manifest.links.length>500)throw Error('Invalid bundled dependency links.');
  const root=await realpath(packageRoot),inside=path=>path.toLowerCase().startsWith((root+sep).toLowerCase());
  const checked=value=>typeof value==='string'&&value.startsWith('runtime/node_modules/')&&value.endsWith('/react-aria')&&value.split('/').every(x=>x&&x!=='.'&&x!=='..'&&/^[A-Za-z0-9@_.-]+$/.test(x));
  // Validate the entire manifest before any mutation.
  const entries=await Promise.all(manifest.links.map(async entry=>{
    if(!checked(entry.path)||!checked(entry.target)||entry.path===entry.target)throw Error('Invalid bundled dependency path.');
    const path=resolve(root,entry.path),target=await realpath(resolve(root,entry.target));
    if(!inside(path)||!inside(target)||(JSON.parse(await readFile(join(target,'package.json'),'utf8'))).name!=='react-aria')throw Error('Invalid bundled dependency target.');
    return {path,target};
  }));
  for(const {path,target} of entries) {
    await mkdir(dirname(path),{recursive:true});
    if(!inside(await realpath(dirname(path))))throw Error('Bundled dependency parent escaped the package.');
    try{await lstat(path);if((await realpath(path)).toLowerCase()===target.toLowerCase())continue;throw Error('Preserve the existing dependency path.');}
    catch(error){if(error.code!=='ENOENT')throw error;}
    await symlink(target,path,'junction');
  }
}
