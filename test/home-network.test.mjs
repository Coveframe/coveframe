import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHomeNetwork} from '../src/home-network.mjs';

test('TV setup selects a private home adapter, requires permission before firewall changes, and resumes saved access',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'coveframe-lan-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 let permitted=false,changes=0,closed=0;
 const adapters=[{id:7,name:'Wi-Fi',address:'192.168.1.22',prefixLength:24,category:'Private'},
  {id:9,name:'Guest',address:'10.0.0.2',prefixLength:24,category:'Public'}];
 const windows={inspect:async()=>({adapters,firewallAllowed:permitted}),allow:async()=>{changes++;permitted=true;},remove:async()=>{permitted=false;}};
 const listen=async()=>({url:'http://192.168.1.22:18799',close:async()=>{closed++;},status:()=>({deviceSeen:false}),check:async()=>true});
 const network=await createHomeNetwork({directory,windows,listen,isMediaRunning:()=>true});
 assert.equal((await network.scan()).selectedId,7);
 await assert.rejects(network.enable({adapterId:9,confirmation:'ALLOW HOME TV'}),/Private/);
 await assert.rejects(network.enable({adapterId:7}),/permission/);
 assert.equal(changes,0);
 assert.equal((await network.enable({adapterId:7,confirmation:'ALLOW HOME TV'})).phase,'running');
 assert.equal(network.status().url,'http://192.168.1.22:18799');
 assert.equal((await network.check()).reachable,true);
 await network.stop();assert.equal(closed,1);
 const reopened=await createHomeNetwork({directory,windows,listen,isMediaRunning:()=>true});
 await reopened.resume();assert.equal(reopened.status().phase,'running');assert.equal(changes,1);
 adapters[0].category='Public';await reopened.check();assert.equal(reopened.status().phase,'needs-attention');assert.equal(closed,2);
 await reopened.disable();
 const disabled=await createHomeNetwork({directory,windows,listen,isMediaRunning:()=>true});
 await disabled.resume();assert.equal(disabled.status().phase,'off');
});

test('saved TV access never opens a Public network, and failed permissions remain actionable',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'coveframe-lan-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 let category='Private',allowed=true,opened=0;
 const windows={inspect:async()=>({adapters:[{id:7,name:'Ethernet',address:'192.168.2.15',prefixLength:24,category}],firewallAllowed:allowed}),allow:async()=>{throw Error('raw diagnostic');},remove:async()=>{}};
 const listen=async()=>{opened++;return {url:'http://192.168.2.15:18799',status:()=>({}),check:async()=>true,close:async()=>{}};};
 const network=await createHomeNetwork({directory,windows,listen,isMediaRunning:()=>true});
 await network.enable({adapterId:7});await network.stop();category='Public';await network.resume();
 assert.equal(opened,1);assert.equal(network.status().phase,'needs-attention');assert.match(network.status().message,/Private/);
 category='Private';allowed=false;
 await assert.rejects(network.enable({adapterId:7,confirmation:'ALLOW HOME TV'}),/Windows permission was not completed/);
 assert.equal(opened,1);assert.doesNotMatch(network.status().message,/raw diagnostic/);
});
