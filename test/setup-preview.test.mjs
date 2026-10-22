import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSetupPreview } from '../src/setup-preview.mjs';
import { getSetupCatalog } from '../src/onboarding.mjs';
import { composeSetupPlan, saveSetupPlan, resolveWizardStep } from '../src/setup-plan.mjs';

test('the preview is a standalone accessible guide with no credentials, network dependencies or installer claims', async () => {
  const html = await renderSetupPreview({ now: new Date('2026-10-21T19:00:00Z') });
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /lang="en"/);
  assert.match(html, /name="viewport"/);
  assert.match(html, /Choose your providers/);
  assert.match(html, /Preview only/);
  assert.match(html, /No changes to your PC/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /TorBox/);
  assert.match(html, /real-debrid.com\/apitoken/);
  assert.match(html, /prefers-reduced-motion/);
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+href=|type="password"|localStorage|fetch\(/i);
});

test('a combined plan saves both selected tiers, optional recommendations and device guidance without secrets or readiness', () => {
  const plan = composeSetupPlan(getSetupCatalog(), { providers: [{ id: 'torbox', plan: 'pro' }, { id: 'real-debrid' }], useUsenet: true });
  const saved = saveSetupPlan(plan, { televisions: '2', profiles: '3', tv: 'firetv', mdblist: true, omdb: false, downloads: true, apiKey: 'do-not-save' });
  assert.deepEqual(saved.providers, [{ id: 'torbox', plan: 'pro', connected: false }, { id: 'real-debrid', plan: 'premium', connected: false }]);
  assert.equal(saved.tv.device, 'firetv');
  assert.equal(saved.useUsenet, true);
  assert.equal(saved.downloads.requestedForLater, true);
  assert.equal(saved.downloads.enabled, false);
  assert.equal(saved.installed, false);
  assert.equal(saved.qualified, false);
  assert.deepEqual(saved.metadata.optionalRatings, ['mdblist']);
  assert.doesNotMatch(JSON.stringify(saved), /do-not-save/);
});

test('a blocked provider combination cannot skip ahead or save, but other selections and stale review are handled', () => {
  const catalog = getSetupCatalog({ now: new Date('2026-10-21T20:00:00Z') });
  const blocked = composeSetupPlan(catalog, { providers: [{ id: 'real-debrid' }], useUsenet: true });
  assert.equal(resolveWizardStep(blocked, 6), 2);
  assert.throws(() => saveSetupPlan(blocked, {}), /Resolve/);
  const expired = composeSetupPlan(catalog, { now: new Date('2026-12-10T00:00:00Z') });
  assert.equal(expired.providers[0].selectedPlan.price, null);
  assert.equal(expired.providers[0].recommendedPlan.price, null);
  assert.equal(resolveWizardStep(expired, 6), 6);
  assert.equal(resolveWizardStep(expired, 100), 6);
});
