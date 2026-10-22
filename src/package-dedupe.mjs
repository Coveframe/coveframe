import {readFile,readdir,access,rm,realpath} from 'node:fs/promises';
import {join,resolve,sep,relative} from 'node:path';
import {createRequire} from 'node:module';

// Build-only compaction of pnpm's repeated locked React Aria package. No version resolution or install.
export async function compactSeerrDependencies(modules) {
  const root=await realpath(resolve(modules));
  const canonical=join(root,'react-aria/package.json');
  let source;
  try{source=await readFile(canonical,'utf8');}catch(error){if(error.code==='ENOENT')return {deduplicated:0};throw error;}
  const pkg=JSON.parse(source), canonicalRequire=createRequire(canonical);
  const packages=[];
  for(const entry of await readdir(root,{withFileTypes:true})) {
    if(!entry.isDirectory()||entry.name.startsWith('.'))continue;
    if(entry.name.startsWith('@'))for(const child of await readdir(join(root,entry.name),{withFileTypes:true})){if(child.isDirectory())packages.push(join(root,entry.name,child.name));}
    else packages.push(join(root,entry.name));
  }
  let deduplicated=0;
  for(const parent of packages) {
    const target=join(parent,'node_modules/react-aria');
    try{
      const actual=await realpath(target);
      if(actual!==target||!actual.startsWith(root+sep))continue;
      if(await readFile(join(target,'package.json'),'utf8')!==source)continue;
      try{await access(join(target,'node_modules'));continue;}catch(error){if(error.code!=='ENOENT')throw error;}
      const nestedRequire=createRequire(join(target,'package.json'));
      const dependencies=Object.keys({...pkg.dependencies,...pkg.peerDependencies});
      if(!dependencies.every(name=>{try{return nestedRequire.resolve(name)===canonicalRequire.resolve(name);}catch{return false;}}))continue;
      // Resolved absolute path is inside this explicit build dependency root; no links are followed.
      await rm(actual,{recursive:true});deduplicated++;
    }catch(error){if(error.code!=='ENOENT')throw error;}
  }
  return {deduplicated};
}

// A portable archive stores one copy per identical locked package and records local junctions.
export async function poolSeerrDependencies(modules,packageRoot) {
  const root=await realpath(resolve(modules)), boundary=await realpath(resolve(packageRoot));
  if(!root.startsWith(boundary+sep))throw Error('Dependency root must be inside the build package.');
  const candidates=[join(root,'react-aria')];
  for(const item of await readdir(root,{withFileTypes:true})) {
    if(!item.isDirectory()||item.name.startsWith('.'))continue;
    const parents=item.name.startsWith('@')?(await readdir(join(root,item.name),{withFileTypes:true})).filter(x=>x.isDirectory()).map(x=>join(root,item.name,x.name)):[join(root,item.name)];
    candidates.push(...parents.map(x=>join(x,'node_modules/react-aria')));
  }
  const groups=new Map(), links=[];
  for(const target of candidates) {
    try {
      if(await realpath(target)!==target||!target.startsWith(root+sep))continue;
      const text=await readFile(join(target,'package.json'),'utf8'),pkg=JSON.parse(text);
      try{await access(join(target,'node_modules'));continue;}catch(error){if(error.code!=='ENOENT')throw error;}
      const resolver=createRequire(join(target,'package.json'));
      const dependencies=Object.keys({...pkg.dependencies,...pkg.peerDependencies}).sort();
      const paths=dependencies.map(name=>{try{return resolver.resolve(name);}catch(error){return `unresolved:${name}:${error.code}`;}});
      const key=text+'\n'+JSON.stringify(paths), canonical=groups.get(key);
      if(!canonical){groups.set(key,target);continue;}
      links.push({path:relative(boundary,target).split(sep).join('/'),target:relative(boundary,canonical).split(sep).join('/')});
      await rm(target,{recursive:true});
    }catch(error){if(error.code!=='ENOENT')throw error;}
  }
  return {links};
}
