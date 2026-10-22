import test from 'node:test';
import assert from 'node:assert/strict';
import { createMetadataConnections } from '../src/metadata-connections.mjs';
test('optional metadata keys are stored privately, applied locally and reported without claiming provider validation', async () => {
  let saved = {}, applied;
  const metadata = await createMetadataConnections({ vault: { read: async () => saved, write: async x => { saved = x; } },
    apply: async keys => { applied = keys; return true; } });
  const key = 'a'.repeat(32);
  const result = await metadata.connect('tmdb',key);
  assert.equal(result.applied, true);
  assert.equal(applied.tmdb,key);
  assert.equal(metadata.status().tmdb.configured,true);
  assert.equal(metadata.status().tmdb.providerVerified,false);
  assert.doesNotMatch(JSON.stringify(metadata.status()), /aaaaaaaa/);
  await assert.rejects(metadata.connect('tmdb','invalid'), /32/);
  assert.equal(saved.tmdb,key);
  await metadata.disconnect('tmdb');
  assert.equal(applied.tmdb,undefined);
  assert.equal(metadata.status().tmdb.configured,false);
});
