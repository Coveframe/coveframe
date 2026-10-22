import test from 'node:test';
import assert from 'node:assert/strict';
import {connectDownloadLibrary} from '../src/download-library.mjs';

test('a download folder is added to the owned library without replacing existing paths',async()=>{
  const locations=['D:\\Old Movies'];const writes=[];
  const request=async(path,method='GET',body)=>{
    if(method==='GET')return [{Name:'Downloaded Movies',Locations:[...locations]}];
    writes.push({path,body});locations.push(body.PathInfo.Path);
  };
  const args={request,type:'movie',path:'D:\\New Movies',checkPath:async()=>{}};
  assert.equal((await connectDownloadLibrary(args)).linked,true);
  assert.deepEqual(locations,['D:\\Old Movies','D:\\New Movies']);
  assert.deepEqual(writes,[{path:'/Library/VirtualFolders/Paths?refreshLibrary=true',body:{Name:'Downloaded Movies',PathInfo:{Path:'D:\\New Movies'}}}]);
  await connectDownloadLibrary(args);
  assert.equal(writes.length,1);
  await assert.rejects(connectDownloadLibrary({...args,path:'C:\\'}),/folder/);
  await assert.rejects(connectDownloadLibrary({...args,path:'\\\\server\\share'}),/folder/);
});
