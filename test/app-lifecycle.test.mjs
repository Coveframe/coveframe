import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createAppLifecycle} from '../src/app-lifecycle.mjs';

test('uninstall removes owned software and credentials while retaining library and downloads',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'hub-removal-'));
 t.after(()=>rm(directory,{recursive:true,force:true}));
 const lifecycle=await createAppLifecycle({directory});
 for(const name of ['Media/Packages','Media/Library/Movies','DownloadApps/Data','DownloadApps/Files/Movies','Metadata','AIOStreams'])await mkdir(join(directory,name),{recursive:true});
 for(const [name,app] of [['Media','media-hub-windows'],['DownloadApps','media-hub-downloads'],['AIOStreams','media-hub-aiostreams']])await writeFile(join(directory,name,'installation.json'),JSON.stringify({app,id:'test-owned-installation'}));
 for(const [name,value] of [['accounts.dpapi','encrypted'],['Media/Packages/runtime.exe','software'],['Media/Library/Movies/keep.strm','library'],['DownloadApps/Files/Movies/keep.mkv','movie'],['DownloadApps/Data/config.json','private'],['Metadata/accounts.dpapi','encrypted'],['AIOStreams/private.db','private'],['preferences.json','{}'],['personal-note.txt','keep']])await writeFile(join(directory,name),value);
 const review=await lifecycle.review();
 assert.equal(review.dataDirectory,directory);
 assert.ok(review.kept.includes(join(directory,'DownloadApps','Files')));
 await assert.rejects(lifecycle.uninstall({confirmation:'no'}),/confirm/i);
 await lifecycle.uninstall({confirmation:'REMOVE MEDIA HUB'});
 for(const name of ['accounts.dpapi','Media/Packages','DownloadApps/Data','Metadata','AIOStreams','preferences.json'])await assert.rejects(readFile(join(directory,name)),{code:'ENOENT'});
 assert.equal(await readFile(join(directory,'Media/Library/Movies/keep.strm'),'utf8'),'library');
 assert.equal(await readFile(join(directory,'DownloadApps/Files/Movies/keep.mkv'),'utf8'),'movie');
 assert.equal(await readFile(join(directory,'personal-note.txt'),'utf8'),'keep');
 await lifecycle.uninstall({confirmation:'REMOVE MEDIA HUB'});
});

test('uninstall refuses an unowned or linked runtime before removing any credentials',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'hub-removal-')),outside=await mkdtemp(join(tmpdir(),'hub-keep-'));
 t.after(async()=>{await rm(directory,{recursive:true,force:true});await rm(outside,{recursive:true,force:true});});
 const lifecycle=await createAppLifecycle({directory});
 await writeFile(join(directory,'accounts.dpapi'),'keep credentials');
 await mkdir(join(directory,'Media'),{recursive:true});await writeFile(join(directory,'Media/personal.txt'),'unowned');
 await assert.rejects(lifecycle.uninstall({confirmation:'REMOVE MEDIA HUB'}),/ownership/i);
 assert.equal(await readFile(join(directory,'accounts.dpapi'),'utf8'),'keep credentials');
 await rm(join(directory,'Media'),{recursive:true});await symlink(outside,join(directory,'Metadata'),'junction');
 await writeFile(join(outside,'keep.txt'),'untouched');
 await assert.rejects(lifecycle.uninstall({confirmation:'REMOVE MEDIA HUB'}),/link/i);
 assert.equal(await readFile(join(outside,'keep.txt'),'utf8'),'untouched');
});
