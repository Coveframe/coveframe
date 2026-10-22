import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { startSetupServer } from '../src/setup-server.mjs';
import { createConnections } from '../src/connections.mjs';

async function launch(t, media, aio, discovery, managedDownloads) {
  const directory = await mkdtemp(join(tmpdir(), 'media-hub-web-'));
  let data = {};
  const connections = await createConnections({ vault: { read: async () => data, write: async value => { data = value; } },
    check: async (provider, credential) => ({ ok: credential === 'test-secret', provider, plan: provider === 'torbox' ? 'pro' : 'premium', active: true, usenet: provider === 'torbox', expiresAt: '2027-01-01T00:00:00Z', checkedAt: new Date().toISOString() }) });
  const app = await startSetupServer({ port: 0, directory, connections, media, aio, discovery,managedDownloads });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const page = await fetch(app.url).then(r => r.text());
  const token = page.match(/name="media-hub-token" content="([a-f0-9]+)"/)[1];
  const call = (path, body, extra = {}) => fetch(app.url + path, { method: body === undefined ? 'GET' : 'POST',
    headers: { 'x-media-hub-token': token, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...extra },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { app, call, page, directory };
}

test('automatic download routes expose progress, reject unsupported input, and stop on provider changes',async t=>{
 let started,stops=0;const managed={status:()=>({phase:'preparing',message:'Checking apps'}),start:async value=>{started=value;return {ok:true};},stop:async()=>{stops++;}};
 const {call}=await launch(t,{status:()=>({phase:'running'}),stop:async()=>{}},undefined,undefined,managed);
 assert.equal((await call('/api/downloads/automatic/start',{providers:['torbox','real-debrid']})).status,202);
 assert.deepEqual(started,{providers:['torbox','real-debrid']});
 assert.equal((await(await call('/api/state')).json()).managedDownloads.phase,'preparing');
 assert.equal((await call('/api/downloads/automatic/start',{providers:['torbox'],credential:'should-not-be-accepted'})).status,400);
 await call('/api/accounts/torbox/connect',{credential:'test-secret'});assert.equal(stops,1);
 assert.equal((await call('/api/downloads/automatic/stop',{})).status,200);assert.equal(stops,2);
});

test('Stop all apps keeps the wizard available, blocks concurrent starts and attempts every owned runtime',async t=>{
 let phase='running',release;const stopped=new Set();
 const media={status:()=>({phase,canResume:true}),resume:()=>({ok:true}),stop:async()=>{stopped.add('media');phase='stopped';}};
 const aio={status:()=>({phase:'stopped'}),stop:async()=>{stopped.add('sources');}};
 const discovery={status:()=>({phase:'stopped'}),stop:async()=>{stopped.add('discovery');}};
 const managed={status:()=>({phase:'running'}),stop:()=>new Promise(resolve=>{stopped.add('downloads');release=resolve;})};
 const {call}=await launch(t,media,aio,discovery,managed);
 const stopping=call('/api/apps/stop',{});
 for(let i=0;i<100&&!release;i++)await new Promise(resolve=>setTimeout(resolve,5));
 if(!release){managed.stop=async()=>{};assert.equal((await stopping).status,200);}
 assert.equal((await call('/api/media/resume',{})).status,409);
 release();assert.equal((await stopping).status,200);
 assert.deepEqual([...stopped].sort(),['discovery','downloads','media','sources']);
 assert.equal((await call('/api/state')).status,200);
 // Teardown is a separate stop and must settle immediately.
 managed.stop=async()=>{};
});

test('a failed stop still stops other apps and prevents uninstalling live app files',async t=>{
 const stopped=new Set();let fail=true;
 const runtime=name=>({status:()=>({phase:'running'}),stop:async()=>{stopped.add(name);if(name==='downloads'&&fail)throw Error('private vendor message');}});
 const {call,directory}=await launch(t,runtime('media'),runtime('sources'),runtime('discovery'),runtime('downloads'));
 const response=await call('/api/uninstall',{confirmation:'REMOVE MEDIA HUB'});
 assert.equal(response.status,422);assert.equal(stopped.size,4);
 assert.doesNotMatch(await response.text(),/private vendor message/);
 assert.ok(await readFile(join(directory,'.media-hub-setup.json')));
 fail=false;
});

test('uninstall requires explicit confirmation and shuts down only after clearing saved setup',async t=>{
 const {call,app,directory}=await launch(t);
 assert.equal((await call('/api/uninstall',{})).status,400);
 await call('/api/plan',{providers:[],televisions:'1',profiles:'1',tv:'androidtv'});
 assert.equal((await call('/api/system')).status,200);
 assert.equal((await call('/api/uninstall',{confirmation:'REMOVE MEDIA HUB'})).status,200);
 await app.close();
 await assert.rejects(readFile(join(directory,'setup.json')),{code:'ENOENT'});
 await assert.rejects(fetch(app.url));
});

test('settings persist, report pending or applied honestly, and reset one section without clearing accounts',async t=>{
  let phase='stopped', applied;
  const media={status:()=>({phase,preferences:applied}),stop:async()=>{},applyPreferences:async value=>{
    if(phase!=='running')return false;applied=value;return true;
  }};
  const {call}=await launch(t,media);
  await call('/api/accounts/torbox/connect',{credential:'test-secret'});
  const choices={autoAdvance:false,trailerPreview:false,themeMusic:true};
  let response=await call('/api/settings/moonfin',{value:choices});
  assert.equal(response.status,200);
  assert.equal((await response.json()).application.moonfin,'pending');
  phase='running';
  response=await call('/api/settings/moonfin',{value:choices});
  assert.equal((await response.json()).application.moonfin,'applied');
  const reset=await(await call('/api/settings/moonfin/reset',{})).json();
  assert.equal(reset.preferences.moonfin.themeMusic,false);
  assert.equal(reset.application.moonfin,'applied');
  assert.equal((await(await call('/api/state')).json()).accounts.torbox.configured,true);
  assert.equal((await call('/api/settings/moonfin',{value:{...choices,apiKey:'secret'}})).status,400);
  phase='configuring';
  assert.equal((await call('/api/settings/moonfin',{value:choices})).status,409);
});

test('discovered titles resolve on the server and add their library batch only with connected sources',async t=>{
  let phase='stopped',added;
  const discovery={status:()=>({phase:'running'}),search:async query=>[{id:101,type:'movie',title:query}],
    describe:async()=>({id:101,type:'movie',title:'Resolved movie'}),items:async selection=>{
      assert.deepEqual(selection,{type:'movie',id:101});
      return [{type:'movie',imdbId:'tt1234567',title:'Resolved movie'}];
    },stop:async()=>{}};
  const media={status:()=>({phase:'running'}),addLibraryItems:async items=>{added=items;return {added:true,count:items.length,scanRequested:true,playbackVerified:false};},stop:async()=>{}};
  const aio={status:()=>({phase}),stop:async()=>{}};
  const {call}=await launch(t,media,aio,discovery);
  assert.equal((await call('/api/discovery/search',{query:'Example'})).status,200);
  assert.equal((await call('/api/discovery/add',{type:'movie',id:101})).status,422);
  phase='running';
  assert.equal((await call('/api/discovery/add',{type:'movie',id:101,imdbId:'tt7654321'})).status,400);
  const response=await call('/api/discovery/add',{type:'movie',id:101});
  assert.equal(response.status,200);
  assert.equal((await response.json()).scanRequested,true);
  assert.equal(added[0].imdbId,'tt1234567');
});

test('shutdown closes browser preconnections that have not sent an HTTP request', async t=>{
  const {connect}=await import('node:net');
  const {app}=await launch(t);
  const socket=connect(new URL(app.url).port,'127.0.0.1');
  await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('error',reject);});
  let timer;
  try{
    const stopped=await Promise.race([app.close().then(()=>true),new Promise(resolve=>{timer=setTimeout(()=>resolve(false),700);})]);
    assert.equal(stopped,true,'Stop must not leave the wizard process waiting for a browser preconnection');
  }finally{clearTimeout(timer);socket.destroy();}
});

test('discovery setup requires running media and exposes no private bootstrap credential', async t => {
  let running = false, started = false;
  const discovery = { status:()=>({phase:started?'running':'not-started',requestsEnabled:false}), start:()=>{started=true;return {ok:true};},stop:async()=>{} };
  const media = { status:()=>({phase:running?'running':'not-started'}),stop:async()=>{} };
  const {call}=await launch(t,media,undefined,discovery);
  assert.equal((await call('/api/discovery/start',{})).status,422);
  running=true;
  assert.equal((await call('/api/discovery/start',{})).status,202);
  const state=await(await call('/api/state')).json();
  assert.equal(state.discovery.phase,'running');
  assert.equal(state.discovery.requestsEnabled,false);
});

test('the wizard wires only connected selected providers to AIO and clears its connections before disconnecting', async t => {
  let received, cleared = false;
  const aio = { status: () => ({ configured: Boolean(received) }), start: options => { received = options; return { ok: true }; },
    forget: async () => { cleared = true; }, stop: async () => {} };
  const media = { status: () => ({ phase: 'running' }), connectSources: async () => {}, stop: async () => {} };
  const { call } = await launch(t, media, aio);
  await call('/api/accounts/torbox/connect', { credential: 'test-secret' });
  const response = await call('/api/sources/start', { providers: ['torbox'], sourceSearch: true });
  assert.equal(response.status, 202);
  assert.deepEqual(received.credentials, { torbox: 'test-secret' });
  assert.equal(received.sourceSearch, true);
  assert.doesNotMatch(await (await call('/api/state')).text(), /test-secret/);
  cleared = false;
  await call('/api/accounts/torbox/disconnect', {});
  assert.equal(cleared, true);
});

test('household setup starts through the authenticated wizard and publishes progress without passwords', async t => {
  let household;
  const media = { start(value) { household = value; return { ok: true }; },
    status: () => ({ phase: household ? 'configuring' : 'not-started', streamingReady: false }), stop: async () => {} };
  const { call, directory } = await launch(t, media);
  const response = await call('/api/media/start', { name: 'Alex', password: 'household-secret-password', profiles: 2 });
  assert.equal(response.status, 202);
  assert.equal(household.name, 'Alex');
  const state = await (await call('/api/state')).text();
  assert.equal(JSON.parse(state).media.phase, 'configuring');
  assert.doesNotMatch(state, /household-secret/);
  await assert.rejects(readFile(join(directory, 'setup.json')));
});

test('opening the wizard from another page is allowed while cross-site API calls stay blocked', async t => {
  const { app, call } = await launch(t);
  const page = await new Promise((resolve, reject) => {
    const req = request(app.url, { headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' } }, res => {
      let text = ''; res.on('data', chunk => { text += chunk; }); res.on('end', () => resolve({ status: res.statusCode, text }));
    });
    req.on('error', reject); req.end();
  });
  assert.equal(page.status, 200);
  assert.match(page.text, /Media Hub/);
  assert.equal((await call('/api/state', undefined, { 'sec-fetch-site': 'cross-site' })).status, 403);
});

test('the local wizard connects both accounts and resumes a saved nonsecret setup plan', async t => {
  const { call, page, directory } = await launch(t);
  assert.match(page, /type="password"/);
  assert.match(page, /TorBox \+ Real-Debrid/);
  assert.match(page, /Coveframe/);
  assert.match(page, /Stop all apps/);
  assert.match(page, /Quit Coveframe/);
  for (const provider of ['torbox', 'real-debrid']) {
    const response = await call(`/api/accounts/${provider}/connect`, { credential: 'test-secret' });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).ok, true);
  }
  const choices = { providers: [{ id: 'torbox', plan: 'pro' }, { id: 'real-debrid', plan: 'premium' }], useUsenet: true, televisions: '2', profiles: '3', tv: 'firetv', credential: 'must-not-save' };
  const saved = await (await call('/api/plan', choices)).json();
  assert.equal(saved.plan.providers.length, 2);
  assert.equal(saved.plan.installed, false);
  assert.equal(saved.plan.providers[0].connected, true);
  assert.equal(saved.plan.streamingReady, false);
  assert.doesNotMatch(await readFile(join(directory, 'setup.json'), 'utf8'), /test-secret|must-not-save|credential/);
  const state = await (await call('/api/state')).json();
  assert.equal(state.plan.household.televisions, 2);
  assert.equal(state.accounts.torbox.configured, true);
  assert.doesNotMatch(JSON.stringify(state), /test-secret|credential/);
  const system=await (await call('/api/system')).json();
  assert.equal(system.sourceUrl,'https://github.com/Coveframe/coveframe');
  assert.equal(system.dataDirectory,directory);
  assert.doesNotMatch(JSON.stringify(system),/test-secret|must-not-save/);
  const notes=await call('/api/release-notes');
  assert.equal(notes.status,200);
  assert.match((await notes.json()).text,/0\.6\.0/);
  await call('/api/accounts/torbox/disconnect', {});
  assert.equal((await (await call('/api/state')).json()).accounts.torbox.configured, false);
});

test('local API rejects foreign origins, missing session proof, malformed input and unsafe Host headers', async t => {
  const { call, app } = await launch(t);
  assert.equal((await fetch(app.url + '/api/state')).status, 403);
  assert.equal((await call('/api/state', undefined, { Origin: 'https://evil.example' })).status, 403);
  const foreignHost = await new Promise((resolve, reject) => {
    const req = request(app.url, { headers: { Host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode); });
    req.on('error', reject); req.end();
  });
  assert.equal(foreignHost, 403);
  assert.equal((await call('/api/accounts/torbox/connect', { credential: 'x'.repeat(20000) })).status, 413);
  assert.equal((await call('/api/plan', { providers: [{ id: 'real-debrid' }], useUsenet: true })).status, 400);
  assert.equal((await call('/api/plan', { providers: [{ id: 'unknown' }] })).status, 400);
  assert.equal((await call('/api/accounts/unknown/connect', { credential: 'test-secret' })).status, 404);
  const headers = (await fetch(app.url)).headers;
  assert.match(headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(headers.get('cache-control'), 'no-store');
  assert.equal(headers.get('access-control-allow-origin'), null);
});
