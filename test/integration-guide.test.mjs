import test from 'node:test';
import assert from 'node:assert/strict';
import { getIntegrationGuide } from '../src/integration-guide.mjs';
import { getSetupCatalog } from '../src/onboarding.mjs';
import { composeSetupPlan } from '../src/setup-plan.mjs';

test('the recommended streaming setup distinguishes purchases, generated credentials and optional keys', () => {
  const guide = getIntegrationGuide({ streaming: true });
  assert.deepEqual(guide.subscriptions.map(x => x.id), ['torbox', 'real-debrid']);
  assert.equal(guide.apps.find(x => x.id === 'aiostreams').needed, true);
  assert.equal(guide.apps.find(x => x.id === 'jellyfin').credential, 'generated-locally');
  assert.equal(guide.apps.find(x => x.id === 'moonbase').kind, 'jellyfin-plugin');
  assert.deepEqual(guide.keys.filter(x => x.required).map(x => x.id), []);
  assert.match(guide.keys.find(x => x.id === 'tmdb').instructions, /AIOStreams.*matching|matching.*AIOStreams/);
  assert.match(guide.keyPolicy, /personal.*key/i);
  assert.equal(guide.apps.find(x => x.id === 'radarr').needed, false);
});

test('the wizard removes debrid and AIO requirements for a local library and explains optional download requirements', () => {
  const catalog = getSetupCatalog();
  const local = composeSetupPlan(catalog, { providers: [] }).integrations;
  assert.deepEqual(local.subscriptions, []);
  assert.equal(local.apps.find(x => x.id === 'aiostreams').needed, false);
  const downloads = composeSetupPlan(catalog, { downloads: true }).integrations;
  assert.equal(downloads.apps.find(x => x.id === 'radarr').needed, true);
  assert.equal(downloads.keys.find(x => x.id === 'indexers').required, true);
});
