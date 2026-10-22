import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWindowsVault } from '../src/windows-vault.mjs';
import { createConnections } from '../src/connections.mjs';

test('only selected active accounts reach a local integration callback, with a fresh account check', async () => {
  const checks = [];
  const vault = { read: async () => ({}), write: async () => {} };
  const accounts = await createConnections({ vault, check: async (id, key) => {
    checks.push(id); return { ok: true, provider: id, active: key !== 'expired', expiresAt: '2099-01-01T00:00:00Z' };
  } });
  await accounts.connect('torbox', 'fixture-tb');
  await accounts.connect('real-debrid', 'expired');
  let passed;
  await accounts.withCredentials(['torbox'], keys => { passed = keys; });
  assert.deepEqual(passed, { torbox: 'fixture-tb' });
  assert.equal(checks.filter(x => x === 'torbox').length, 2);
  await assert.rejects(accounts.withCredentials(['real-debrid'], () => assert.fail()), /active/);
  await assert.rejects(accounts.withCredentials(['unknown'], () => assert.fail()), /supported/);
  assert.doesNotMatch(JSON.stringify(accounts.status()), /fixture-tb|expired/);
});

test('Windows vault persists encrypted credentials and can forget them', { skip: process.platform !== 'win32' }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'media-hub-vault-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const vault = createWindowsVault(directory);
  assert.deepEqual(await vault.read(), {});
  await vault.write({ torbox: { credential: 'synthetic-test-key-not-an-account' } });
  assert.doesNotMatch(await readFile(join(directory, 'accounts.dpapi'), 'utf8'), /synthetic-test-key/);
  assert.deepEqual(await createWindowsVault(directory).read(), { torbox: { credential: 'synthetic-test-key-not-an-account' } });
  await vault.write({});
  assert.deepEqual(await vault.read(), {});
});

test('connections survive restart, recheck saved keys, and remove keys on disconnect without returning them', async () => {
  let stored = {};
  const vault = { read: async () => structuredClone(stored), write: async value => { stored = structuredClone(value); } };
  const check = async (provider, key) => ({ ok: key === 'secret', provider, plan: 'essential', active: true, usenet: false, checkedAt: '2026-10-21T20:00:00Z', expiresAt: '2027-01-01T00:00:00Z' });
  const connections = await createConnections({ vault, check });
  assert.equal((await connections.connect('torbox', 'secret')).ok, true);
  assert.equal((await connections.connect('real-debrid', 'secret')).ok, true);
  assert.doesNotMatch(JSON.stringify(connections.status()), /secret|credential/);
  const resumed = await createConnections({ vault, check });
  assert.equal(resumed.status().torbox.configured, true);
  assert.equal(resumed.status().torbox.verifiedThisSession, false);
  assert.equal((await resumed.recheck('torbox')).ok, true);
  assert.equal(resumed.status().torbox.verifiedThisSession, true);
  await resumed.disconnect('torbox');
  assert.equal(resumed.status().torbox.configured, false);
  assert.equal(stored.torbox, undefined);
  assert.equal(stored['real-debrid'].credential, 'secret');
});

test('bad keys do not replace saved accounts and storage failures never report a saved connection', async () => {
  let stored = {};
  let fail = false;
  const vault = { read: async () => stored, write: async value => { if (fail) throw Error('secret details'); stored = value; } };
  const check = async (provider, key) => key === 'bad' ? { ok: false, code: 'invalid-key', message: 'Invalid key' } : { ok: true, provider, active: true, plan: 'premium' };
  const accounts = await createConnections({ vault, check });
  await accounts.connect('real-debrid', 'old-key');
  assert.equal((await accounts.connect('real-debrid', 'bad')).ok, false);
  assert.equal(stored['real-debrid'].credential, 'old-key');
  assert.equal(accounts.status()['real-debrid'].verifiedThisSession, false);
  fail = true;
  const result = await accounts.connect('torbox', 'new-key');
  assert.equal(result.code, 'storage-failed');
  assert.equal(accounts.status().torbox.configured, false);
  assert.doesNotMatch(JSON.stringify(result), /secret details|new-key/);
  assert.equal((await accounts.disconnect('real-debrid')).ok, false);
  assert.equal(accounts.status()['real-debrid'].configured, true);
});
