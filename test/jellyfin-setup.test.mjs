import test from 'node:test';
import assert from 'node:assert/strict';
import { provisionJellyfin } from '../src/jellyfin-setup.mjs';

test('a new isolated server gets a private administrator, household viewers, libraries and Moonbase defaults', async () => {
  let complete = false;
  const users = [];
  const folders = [];
  let plugin;
  const request = async (path, method = 'GET', data) => {
    if (path === '/System/Info/Public') return { ServerName: complete ? 'Media Hub (local wizard)' : 'NEW', StartupWizardCompleted: complete };
    if (path === '/Startup/Complete') { complete = true; return; }
    if (path === '/Users/AuthenticateByName') return { AccessToken: 'internal-secret', User: { Id: 'system' } };
    if (path === '/Users' && method === 'GET') return users;
    if (path === '/Users/New') { const user = { Id: String(users.length + 1), Name: data.Name }; users.push(user); return user; }
    if (path === '/Library/VirtualFolders') return folders;
    if (path.startsWith('/Library/VirtualFolders?')) { folders.push({ Name: new URL('http://local' + path).searchParams.get('name') }); return; }
    if (path === '/Plugins/8c5d0e91-4f2a-4b6d-9e3f-1a7c8d9e0f2b/Configuration') { if(method==='GET')return {GamesEnabled:false,SeerrDisplayName:'My discovery'};plugin = data; return; }
    return {};
  };
  const result = await provisionJellyfin({ request, systemPassword: 'machine-secret',
    household: { name: 'Alex', password: 'a-long-household-password', profiles: 2 }, libraryRoot: 'C:\\Isolated\\Library' });
  assert.deepEqual(users.map(x => x.Name), ['Alex', 'Viewer 2']);
  assert.deepEqual(folders.map(x => x.Name), ['Movies', 'TV Shows']);
  assert.equal(plugin.EnableSettingsSync, true);
  assert.equal(plugin.SeerrEnabled, false);
  assert.equal(plugin.WebForcedServerUrl,'http://127.0.0.1:18798');
  assert.equal(plugin.WebEnableWebRtcScan,false);
  assert.equal(plugin.SeerrDisplayName,'My discovery');
  assert.equal(result.householdCreated, true);
  assert.equal(result.streamingReady, false);
  assert.doesNotMatch(JSON.stringify(result), /machine-secret|internal-secret|a-long-household-password/);
});

test('setup refuses a different initialized server and rejects weak household credentials before writing', async () => {
  const writes = [];
  const request = async (path, method) => {
    if (method === 'POST') writes.push(path);
    return { StartupWizardCompleted: true, ServerName: 'Existing family server' };
  };
  const options = { request, systemPassword: 'private', household: { name: 'Alex', password: 'long-password-for-home', profiles: 1 }, libraryRoot: 'C:\\Owned' };
  await assert.rejects(provisionJellyfin(options), /another installation/);
  await assert.rejects(provisionJellyfin({ ...options, household: { ...options.household, password: 'weak' } }), /12/);
  assert.deepEqual(writes, []);
});
