import test from 'node:test';
import assert from 'node:assert/strict';
import { provisionSeerr } from '../src/seerr-setup.mjs';

test('Seerr bootstraps only the owned Jellyfin, imports viewers with requests off and keeps credentials private', async () => {
  const calls = [];
  const request = async (path, method = 'GET', data, headers) => {
    calls.push({ path, method, data, headers });
    if (path === '/api/v1/settings/public') return { data: { initialized: false, mediaServerType:4 } };
    if (path === '/api/v1/auth/jellyfin') return { data: { id: 1 }, cookie: 'private-session' };
    if (path === '/api/v1/settings/jellyfin/library/sync') return { data: [{ id:'movies', name:'Movies' },{ id:'tv', name:'TV Shows' }] };
    return { data: {} };
  };
  const receipt = await provisionSeerr({ request, password:'private-admin', viewerIds:['viewer1','viewer2'] });
  const login = calls.find(x => x.path === '/api/v1/auth/jellyfin');
  assert.equal(login.data.hostname, '127.0.0.1');
  assert.equal(login.data.port, 18798);
  assert.equal(login.data.serverType, 2);
  assert.equal(calls.find(x => x.path === '/api/v1/settings/main').data.defaultPermissions, 0);
  assert.deepEqual(calls.find(x => x.path === '/api/v1/user/import-from-jellyfin').data.jellyfinUserIds,['viewer1','viewer2']);
  assert.equal(calls.filter(x => x.method === 'PUT').length, 2);
  assert.equal(receipt.requestsEnabled,false);
  assert.doesNotMatch(JSON.stringify(receipt),/private-admin|private-session/);
});

test('Seerr retry logs into its existing setup and refuses a non-owner administrator', async () => {
  const calls = [];
  await assert.rejects(provisionSeerr({ password:'private', viewerIds:[], request: async (path, method, data) => {
    calls.push({ path, method, data });
    return path.endsWith('/public') ? { data:{ initialized:true } } : { data:{ id:2 },cookie:'private' };
  } }),/administrator/);
  assert.equal(calls.length,2);
  assert.equal(calls[1].data.hostname, undefined);
});
