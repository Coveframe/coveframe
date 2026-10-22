import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,access,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {compactSeerrDependencies,poolSeerrDependencies} from '../src/package-dedupe.mjs';
import {materializePackageLinks} from '../src/package-links.mjs';
test('build compaction removes repeated locked React Aria packages only when dependency resolution is identical',async()=>{
  const root=await mkdtemp(join(tmpdir(),'media-hub-dedupe-'));
  const modules=join(root,'node_modules');
  const pkg=async(path,value)=>{await mkdir(path,{recursive:true});await writeFile(join(path,'package.json'),JSON.stringify(value));};
  try{
    const canonical={name:'react-aria',version:'3.48.0',main:'index.js',dependencies:{'peer-fixture':'1.0.0'}};
    await pkg(join(modules,'react-aria'),canonical);
    await pkg(join(modules,'peer-fixture'),{name:'peer-fixture',main:'index.js'});await writeFile(join(modules,'peer-fixture/index.js'),'');
    await pkg(join(modules,'same/node_modules/react-aria'),canonical);
    await pkg(join(modules,'different/node_modules/react-aria'),{...canonical,version:'3.47.0'});
    await pkg(join(modules,'shadowed/node_modules/react-aria'),canonical);
    await pkg(join(modules,'shadowed/node_modules/peer-fixture'),{name:'peer-fixture',main:'index.js'});await writeFile(join(modules,'shadowed/node_modules/peer-fixture/index.js'),'');
    assert.equal((await compactSeerrDependencies(modules)).deduplicated,1);
    await assert.rejects(access(join(modules,'same/node_modules/react-aria')));
    await access(join(modules,'different/node_modules/react-aria'));await access(join(modules,'shadowed/node_modules/react-aria'));await access(join(modules,'react-aria'));
  }finally{await rm(root,{recursive:true,force:true});}
});

test('portable dependency links restore the same module and reject an escaping manifest',{skip:process.platform!=='win32'},async()=>{
  const root=await mkdtemp(join(tmpdir(),'media-hub-links-'));
  const packageRoot=join(root,'package'),modules=join(packageRoot,'runtime/node_modules');
  try{
    for(const host of ['one','two']){const path=join(modules,host,'node_modules/react-aria');await mkdir(path,{recursive:true});await writeFile(join(path,'package.json'),JSON.stringify({name:'react-aria',version:'test',dependencies:{'types-only-package':'1.0.0'}}));await writeFile(join(path,'kept.txt'),'same');}
    const manifest=await poolSeerrDependencies(modules,packageRoot);assert.equal(manifest.links.length,1);
    await writeFile(join(packageRoot,'runtime-links.json'),JSON.stringify(manifest));await materializePackageLinks(packageRoot);await materializePackageLinks(packageRoot);
    assert.equal(await readFile(join(packageRoot,manifest.links[0].path,'kept.txt'),'utf8'),'same');
    await writeFile(join(packageRoot,'runtime-links.json'),JSON.stringify({links:[{path:'../outside/react-aria',target:manifest.links[0].target}]}));await assert.rejects(materializePackageLinks(packageRoot),/Invalid/);
  }finally{await rm(root,{recursive:true,force:true});}
});
