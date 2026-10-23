import test from 'node:test';
import assert from 'node:assert/strict';
import { composeAioConfig, provisionAio, updateAioPreferences } from '../src/aiostreams-setup.mjs';

test('updating AIO preferences preserves saved accounts, search choices and custom configuration',async()=>{
  let config={services:[{id:'torbox',credentials:{apiKey:'private-fixture'}}],presets:[{type:'library'}],addonName:'Keep my name'};
  const request=async(path,method,data)=>{
    if(path.includes('/auth/login'))return {data:{success:true},cookie:'private-cookie'};
    if(method==='PUT'){config=data.config;return {data:{success:true}};}
    return {data:{success:true,data:{userData:config}}};
  };
  await updateAioPreferences({request,operatorPassword:'private',account:{uuid:'private'},accountPassword:'private',
    preferences:{maxResolution:'720p',sortBy:'size',excludeLowQuality:true}});
  assert.equal(config.services[0].credentials.apiKey,'private-fixture');
  assert.equal(config.addonName,'Keep my name');
  assert.deepEqual(config.presets,[{type:'library'}]);
  assert.deepEqual(config.excludedResolutions,['2160p','1440p','1080p','Unknown']);
});

test('AIO preferences reuse the operator session and respect a short rate-limit retry',async()=>{
  let limited=true,config={},waits=[];
  const session={cookie:'existing-private-session'};
  const request=async(path,method,data,headers)=>{
    assert.equal(path.includes('/auth/login'),false,'Saving again must reuse the operator session');
    assert.equal(headers.Cookie,'existing-private-session');
    if(limited){limited=false;throw Object.assign(Error('limited'),{httpStatus:429,retryAfter:1});}
    if(method==='PUT'){config=data.config;return {data:{success:true}};}
    return {data:{success:true,data:{userData:config}}};
  };
  await updateAioPreferences({request,session,wait:async ms=>waits.push(ms),operatorPassword:'private',account:{uuid:'private'},accountPassword:'private',
    preferences:{maxResolution:'any',sortBy:'resolution',excludeLowQuality:true}});
  assert.deepEqual(waits,[1000]);
});

test('saved source preferences limit resolution and sort smaller cached files first',()=>{
  const config=composeAioConfig({credentials:{torbox:'fixture'},preferences:{maxResolution:'1080p',sortBy:'size',excludeLowQuality:false}});
  assert.deepEqual(config.excludedResolutions,['2160p','1440p','Unknown']);
  assert.deepEqual(config.sortCriteria.global,[{key:'cached',direction:'desc'},{key:'size',direction:'asc'}]);
  assert.deepEqual(config.excludedQualities,[]);
  assert.equal(config.excludeUncached,true);
});

test('the local AIO configuration supports the selected pair without retired addons or third-party key delivery', () => {
  const config = composeAioConfig({ credentials: { torbox: 'tb-fixture', 'real-debrid': 'rd-fixture' }, sourceSearch: true });
  assert.deepEqual(config.services.map(x => x.id), ['torbox', 'realdebrid']);
  assert.equal(config.services[1].credentials.apiKey, 'rd-fixture');
  assert.equal(config.excludeUncached, true);
  assert.deepEqual(config.presets.map(x => x.type), ['library', 'knaben']);
  assert.deepEqual(config.presets[0].options.sources,['torrent']);
  assert.equal(config.presets.some(x => x.type === 'torbox-search' || x.type === 'torrentio'), false);
  assert.doesNotMatch(JSON.stringify(config.presets), /tb-fixture|rd-fixture/);
  assert.throws(() => composeAioConfig({ credentials: { unknown: 'x' } }), /supported/);
  assert.throws(() => composeAioConfig({ credentials: {} }), /Connect/);
});

test('AIO operator login, account creation and manifest check keep all internal credentials private', async () => {
  const calls = [];
  const request = async (path, method, body, headers) => {
    calls.push({ path, method, body, headers });
    if (path === '/api/v1/auth/login') return { cookie: 'aiostreams.session=fixture', data: { success: true } };
    if (path === '/api/v1/user') return { data: { success: true, data: { uuid: 'test-uuid', encryptedPassword: 'encrypted-fixture' } } };
    return { data: { id: 'aiostreams', resources: ['stream'] } };
  };
  const result = await provisionAio({ request, operatorPassword: 'operator-fixture', accountPassword: 'account-fixture', credentials: { torbox: 'tb-fixture' } });
  assert.equal(calls[1].headers.Cookie, 'aiostreams.session=fixture');
  assert.equal(result.account.uuid, 'test-uuid');
  assert.equal(result.receipt.manifestVerified, true);
  assert.equal(result.receipt.playbackVerified, false);
  assert.doesNotMatch(JSON.stringify(result.receipt), /fixture|test-uuid/);
});
