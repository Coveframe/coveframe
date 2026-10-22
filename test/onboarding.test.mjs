import test from 'node:test';
import assert from 'node:assert/strict';
import { getSetupGuide, getSetupPlan } from '../src/onboarding.mjs';

const today = new Date('2026-10-21T20:00:00Z');

test('the recommended setup combines TorBox and Real-Debrid and keeps an independent tier for each', () => {
  const plan = getSetupPlan({ now: today });
  assert.equal(plan.schemaVersion, 2);
  assert.deepEqual(plan.providers.map(item => [item.id, item.selectedPlan.id]), [['torbox', 'essential'], ['real-debrid', 'premium']]);
  assert.equal(plan.requiredSubscriptions, 2);
  assert.equal(plan.providers.every(item => item.integrationStatus === 'not-yet-validated'), true);
  assert.deepEqual(plan.blockers, []);
});

test('Usenet only needs one capable selected plan, and duplicates or unknown tiers are rejected', () => {
  const pair = getSetupPlan({ providers: [{ id: 'torbox', plan: 'standard' }, { id: 'real-debrid', plan: 'premium' }], now: today });
  assert.equal(pair.providers[0].selectedPlan.id, 'standard');
  assert.equal(pair.providers[1].selectedPlan.id, 'premium');
  const unsupported = getSetupPlan({ providers: [{ id: 'torbox', plan: 'essential' }, { id: 'real-debrid' }], useUsenet: true, now: today });
  assert.deepEqual(unsupported.blockers, ['usenet-requires-capable-selected-plan']);
  const supported = getSetupPlan({ providers: [{ id: 'torbox', plan: 'essential' }, { id: 'premiumize' }, { id: 'real-debrid' }], useUsenet: true, now: today });
  assert.deepEqual(supported.blockers, []);
  assert.throws(() => getSetupPlan({ providers: [{ id: 'torbox' }, { id: 'torbox' }], now: today }), /once/);
  assert.throws(() => getSetupPlan({ providers: [{ id: 'torbox', plan: 'premium' }], now: today }), /supported plan/);
  assert.throws(() => getSetupPlan({ providers: [{ id: '__proto__' }], now: today }), /supported provider/);
});

test('multi-provider plans expire prices at use time, omit credentials and include the complete recommended checklist', () => {
  const plan = getSetupPlan({ providers: [{ id: 'torbox', plan: 'pro', apiKey: 'never-copy-me' }, { id: 'real-debrid' }], apiKey: 'never-copy-me', now: today });
  assert.deepEqual(plan.steps.map(step => step.id), ['pc', 'household', 'providers', 'metadata', 'preferences', 'tv', 'summary']);
  assert.ok(plan.recommendations.some(item => item.id === 'playback-test' && item.required));
  assert.ok(plan.recommendations.some(item => item.id === 'downloads' && !item.required));
  assert.doesNotMatch(JSON.stringify(plan), /never-copy-me/);
  const local = getSetupPlan({ providers: [], now: today });
  assert.equal(local.requiredSubscriptions, 0);
  assert.deepEqual(local.providers, []);
  const stale = getSetupPlan({ now: new Date('2026-12-01T00:00:00Z') });
  assert.equal(stale.providers[0].selectedPlan.price, null);
});

test('the normal setup uses native services and one provider, with metadata keys and downloads optional', () => {
  const guide = getSetupGuide({ now: today });
  assert.equal(guide.runtime, 'native-windows-services');
  assert.deepEqual(guide.steps.map(step => step.id), ['pc', 'household', 'provider', 'preferences', 'tv']);
  assert.equal(guide.requiredSubscriptions, 1);
  assert.equal(guide.metadata.find(item => item.id === 'tmdb').requiredPersonalKey, false);
  assert.equal(guide.metadata.find(item => item.id === 'mdblist').optional, true);
  assert.equal(guide.metadata.find(item => item.id === 'omdb').optional, true);
  assert.equal(guide.downloads.enabledByDefault, false);
  assert.equal(guide.downloads.canRequestWithoutConfiguredPipeline, false);
  assert.equal(guide.qualified, false);
});

test('TorBox recommends Essential for cached playback and Pro only when Usenet is selected', () => {
  const basic = getSetupGuide({ provider: 'torbox', now: today });
  assert.equal(basic.provider.recommendedPlan.id, 'essential');
  assert.deepEqual(basic.provider.recommendedPlan.price, { amount: 3, currency: 'USD', period: 'month' });
  const usenet = getSetupGuide({ provider: 'torbox', useUsenet: true, now: today });
  assert.equal(usenet.provider.recommendedPlan.id, 'pro');
  assert.deepEqual(usenet.provider.recommendedPlan.price, { amount: 10, currency: 'USD', period: 'month' });
  assert.match(usenet.provider.reason, /Usenet/);
  assert.equal(basic.provider.integrationStatus, 'not-yet-validated');
  assert.equal(basic.provider.buyBeforeConnectionTest, false);
});

test('existing provider users see one applicable paid tier and direct connection instructions', () => {
  const premiumize = getSetupGuide({ provider: 'premiumize', now: today });
  assert.equal(premiumize.provider.recommendedPlan.id, 'premium-month');
  assert.equal(premiumize.provider.recommendedPlan.price.amount, 11.99);
  assert.match(premiumize.provider.notes.join(' '), /fair-use/i);
  const rd = getSetupGuide({ provider: 'real-debrid', now: today });
  assert.equal(rd.provider.recommendedPlan.id, 'premium');
  assert.equal(rd.provider.recommendedPlan.price, null);
  assert.equal(rd.provider.recommendedPlan.priceLabel, 'Check the current price on Real-Debrid');
  assert.equal(rd.provider.keyUrl, 'https://real-debrid.com/apitoken');
  assert.equal(rd.requiredSubscriptions, 1);
});

test('expired prices are suppressed, and a missing Usenet capability is stated explicitly', () => {
  const stale = getSetupGuide({ now: new Date('2026-12-01T00:00:00Z') });
  assert.equal(stale.pricing.status, 'needs-review');
  assert.equal(stale.provider.recommendedPlan.price, null);
  assert.ok(stale.provider.plans.every(plan => plan.price === null));
  const unsupported = getSetupGuide({ provider: 'real-debrid', useUsenet: true, now: today });
  assert.ok(unsupported.blockers.includes('provider-does-not-include-usenet'));
  assert.match(unsupported.provider.reason, /does not include Usenet/);
});

test('local files need no subscription, and app-supplied metadata never embeds a personal key', () => {
  const guide = getSetupGuide({ libraryOnly: true, apiKey: 'never-embed-this-value', now: today });
  assert.equal(guide.requiredSubscriptions, 0);
  assert.equal(guide.provider, null);
  assert.equal(guide.appProvidedMetadata.status, 'not-configured');
  assert.equal(guide.appProvidedMetadata.personalKeyBundling, false);
  assert.ok(!JSON.stringify(guide).includes('never-embed-this-value'));
  assert.ok(guide.metadata.every(item => item.keyUrl.startsWith('https://')));
  assert.throws(() => getSetupGuide({ provider: '__proto__' }), /supported provider/);
});
