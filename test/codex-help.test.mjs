import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCodexSetupPrompt} from '../ui/tv-client.mjs';

test('help identifies the current wizard step and updates choices without copying free-form input',()=>{
 const state={step:2,televisions:'2',profiles:'3',providers:[{id:'torbox',plan:'essential'}],sourceSearch:true};
 const before=buildCodexSetupPrompt({state});
 assert.match(before,/Current step: 3 of 7 — Your providers/);
 assert.match(before,/Household: 2 TVs; 3 viewer profiles/);
 assert.match(before,/TorBox: Essential/);
 const after=buildCodexSetupPrompt({state:{...state,step:4,downloads:true,mdblist:true,householdName:'SECRET-NAME',issue:'SECRET-ISSUE'}});
 assert.match(after,/Current step: 5 of 7 — How you watch/);
 assert.match(after,/Downloads: optional; requested/);
 assert.match(after,/Extra ratings selected: MDBList/);
 assert.doesNotMatch(after,/SECRET/);
 assert.match(buildCodexSetupPrompt({state:{step:'SECRET-STEP',profiles:'SECRET-PROFILES'}}),/Current step: not selected/);
});

test('the setup-help prompt gives Codex useful current context without forwarding credentials or arbitrary text',()=>{
 const prompt=buildCodexSetupPrompt({state:{tv:'firetv',providers:[{id:'torbox',plan:'pro'},{id:'real-debrid',plan:'premium'}],downloads:false},
  selectedId:9,media:{phase:'running',password:'SECRET-HOUSEHOLD',network:{phase:'off',selectedId:7,adapters:[{id:9,name:'SECRET-ADAPTER',address:'192.168.1.57',category:'Public'}],url:'https://SECRET-URL@example.com/?key=SECRET-QUERY',message:'SECRET-ERROR',firewallAllowed:false}},
  accounts:{torbox:{configured:true,active:true,verifiedThisSession:false,apiKey:'SECRET-TORBOX'},'real-debrid':{configured:false,token:'SECRET-RD'}},sources:{phase:'stopped',url:'SECRET-SOURCE'},discovery:{phase:'not-started'},token:'SECRET-WIZARD'});
 assert.match(prompt,/Fire TV/);assert.match(prompt,/TorBox: Pro/);assert.match(prompt,/Real-Debrid: Premium/);
 assert.match(prompt,/TorBox account: key saved; not verified this session/);
 assert.match(prompt,/Real-Debrid account: not connected/);
 assert.match(prompt,/192\.168\.1\.57 \(Public\)/);assert.match(prompt,/Media apps: running/);
 assert.match(prompt,/Source apps: stopped/);assert.match(prompt,/Downloads: optional; not requested/);
 assert.match(prompt,/https:\/\/github.com\/Coveframe\/coveframe/);
 assert.match(prompt,/boot testing.*deferred/i);assert.match(prompt,/physical TV/i);
 assert.doesNotMatch(prompt,/SECRET|https:\/\/192\.168|TV server: http/);
});

test('the prompt uses only the actual running TV address and never claims playback is verified',()=>{
 const media={phase:'running',network:{phase:'running',selectedId:7,url:'http://10.0.0.20:18799',deviceSeen:true,signedIn:true,reachable:true,
  adapters:[{id:7,address:'10.0.0.20',category:'Private'},{id:9,address:'192.168.1.30',category:'Private'}]}};
 const running=buildCodexSetupPrompt({media});
 assert.match(running,/TV server: http:\/\/10\.0\.0\.20:18799/);
 assert.match(running,/Device sign-in: observed/);assert.match(running,/sign-in is not playback proof/);
 const changed=buildCodexSetupPrompt({media,selectedId:9});
 assert.doesNotMatch(changed,/TV server: http:\/\/192\.168\.1\.30/);
 assert.match(buildCodexSetupPrompt(),/Selected home connection: not detected \(unknown\)/);
});
