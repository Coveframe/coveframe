import test from 'node:test';
import assert from 'node:assert/strict';
import { checkProviderAccount } from '../src/provider-accounts.mjs';

const now = new Date('2026-10-21T20:00:00Z');
test('account checks use only official read-only endpoints and return no account identifiers or secrets', async () => {
  const calls = [];
  const transport = async (url, options) => {
    calls.push({ url, options });
    return Response.json(url.includes('torbox')
      ? { success: true, data: { id: 123, email: 'private@example.com', api_token: 'private', plan: 2, premium_expires_at: '2027-01-01T00:00:00Z' } }
      : { id: 456, username: 'private', type: 'premium', premium: 86400, expiration: '2026-10-22T20:00:00Z' });
  };
  const torbox = await checkProviderAccount('torbox', 'test-key', { transport, now });
  const rd = await checkProviderAccount('real-debrid', 'test-key', { transport, now });
  assert.equal(torbox.plan, 'pro');
  assert.equal(torbox.usenet, true);
  assert.equal(torbox.active, true);
  assert.equal(rd.plan, 'premium');
  assert.equal(rd.active, true);
  assert.deepEqual(calls.map(c => c.url), ['https://api.torbox.app/v1/api/user/me?settings=false', 'https://api.real-debrid.com/rest/1.0/user']);
  for (const { options } of calls) {
    assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer test-key');
    assert.ok(options.signal);
  }
  assert.doesNotMatch(JSON.stringify([torbox, rd]), /private|test-key|123|456/);
});

test('free, expired and incomplete subscriptions never become active', async () => {
  for (const [id, body] of [
    ['torbox', { success: true, data: { plan: 0, premium_expires_at: '2027-01-01T00:00:00Z' } }],
    ['torbox', { success: true, data: { plan: 1, premium_expires_at: '2025-01-01T00:00:00Z' } }],
    ['real-debrid', { type: 'free', premium: 0, expiration: '2027-01-01T00:00:00Z' }],
    ['real-debrid', { type: 'premium', premium: 100, expiration: '2025-01-01T00:00:00Z' }],
  ]) {
    const result = await checkProviderAccount(id, 'key', { now, transport: async () => Response.json(body) });
    assert.equal(result.active, false);
  }
  const malformed = await checkProviderAccount('torbox', 'key', { now, transport: async () => Response.json({ success: true, data: {} }) });
  assert.equal(malformed.ok, false);
});

test('provider and network failures are actionable and cannot leak credentials or upstream text', async () => {
  for (const status of [401, 403, 429, 500]) {
    const result = await checkProviderAccount('real-debrid', 'key', { transport: async () => new Response('key private error', { status }) });
    assert.equal(result.ok, false);
    assert.doesNotMatch(JSON.stringify(result), /key private/);
  }
  const result = await checkProviderAccount('torbox', 'key', { transport: async () => { throw Error('secret key'); } });
  assert.equal(result.code, 'unavailable');
  const rejected = await checkProviderAccount('torbox', 'key', { transport: async () => Response.json({ success: false, error: 'BAD_TOKEN', detail: 'secret key' }) });
  assert.equal(rejected.code, 'invalid-key');
  for (const value of ['', 'a\r\nb', 'a b', 'x'.repeat(4097)]) {
    assert.equal((await checkProviderAccount('torbox', value)).code, 'invalid-key');
  }
  assert.equal((await checkProviderAccount('__proto__', 'key')).code, 'unsupported-provider');
});
