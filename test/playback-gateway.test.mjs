import test from 'node:test';
import assert from 'node:assert/strict';
import { startPlaybackGateway } from '../src/playback-gateway.mjs';

test('the private playback link resolves a movie through AIO and refuses arbitrary paths and unsafe destinations', async t => {
  let destination = 'https://media.example.com/verified.mp4?private=fixture';
  const calls = [];
  const gateway = await startPlaybackGateway({ port: 0, token: 'a'.repeat(64), streams: async (type, id) => {
    calls.push([type,id]); return { streams: [{ url: destination }] };
  }, lookup: async () => [{ address: '93.184.216.34' }] });
  t.after(() => gateway.close());
  const link = gateway.link('movie', 'tt0000001');
  const redirected = await fetch(link, { redirect: 'manual' });
  assert.equal(redirected.status, 302);
  assert.equal(redirected.headers.get('location'), destination);
  assert.deepEqual(calls, [['movie', 'tt0000001']]);
  assert.equal((await fetch(gateway.url + '/not-authorized')).status, 404);
  assert.throws(() => gateway.link('movie', '../private'), /valid/);
  destination = 'http://192.168.1.2/secrets';
  assert.equal((await fetch(link, { redirect: 'manual' })).status, 503);
});

test('a public-looking hostname resolving to a local address cannot become a playback target', async t => {
  const gateway = await startPlaybackGateway({ port: 0, token: 'b'.repeat(64),
    streams: async () => ({ streams: [{ url: 'https://media.example.com/private' }] }),
    lookup: async () => [{ address: '127.0.0.1' }] });
  t.after(() => gateway.close());
  assert.equal((await fetch(gateway.link('series','tt0000001:1:2'), { redirect: 'manual' })).status, 503);
});
