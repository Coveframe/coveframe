import test from 'node:test';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {makePrivateDirectory} from '../src/private-directory.mjs';
test('runtime directory protection can be repeated without administrator rights or changing app data',{skip:process.platform!=='win32'},async()=>{
  const root=await mkdtemp(join(tmpdir(),'media-hub-private-'));
  try{await makePrivateDirectory(root);await writeFile(join(root,'kept.txt'),'owned test');await makePrivateDirectory(root);assert.equal(await readFile(join(root,'kept.txt'),'utf8'),'owned test');}
  finally{await rm(root,{recursive:true,force:true});}
});
test('reopening an already private populated app directory does not traverse its packages', {skip:!process.env.MEDIA_HUB_LARGE_PRIVATE_TEST_ROOT}, async()=>{
  const start=Date.now();
  await makePrivateDirectory(process.env.MEDIA_HUB_LARGE_PRIVATE_TEST_ROOT);
  assert.ok(Date.now()-start<5000,'An already protected directory should reopen without recursively rewriting child permissions');
});
