import test from 'node:test';
import assert from 'node:assert/strict';
import { assessPreflight } from '../src/qualification.mjs';

const cleanHome = () => ({
  schemaVersion: 1,
  machineId: 'lab-host', editionId: 'Core', buildNumber: 26100,
  architecture: 'AMD64', manufacturer: 'Dell Inc.', model: 'OptiPlex',
  gpus: [{ name: 'Intel UHD Graphics 770', driverVersion: '32.0.101.1' }],
  services: [], listeners: [],
});

test('a physical clean Windows Home PC can enter qualification but is not declared proven', () => {
  const result = assessPreflight(cleanHome());
  assert.equal(result.status, 'ready-for-lab');
  assert.equal(result.qualified, false);
  assert.deepEqual(result.blockers, []);
});

test('Pro cannot stand in for Home and an existing media installation is protected', () => {
  const host = { ...cleanHome(), editionId: 'Professional', services: [{ name: 'JellyfinServer' }],
    listeners: [{ port: 8096 }] };
  const result = assessPreflight(host);
  assert.equal(result.status, 'blocked');
  assert.ok(result.blockers.includes('windows-home-required'));
  assert.ok(result.blockers.includes('existing-media-service'));
  assert.ok(result.blockers.includes('existing-media-port'));
});

test('virtual GPUs and Windows 10 cannot satisfy the physical Windows 11 proof', () => {
  const result = assessPreflight({ ...cleanHome(), buildNumber: 19045, model: 'Virtual Machine' });
  assert.ok(result.blockers.includes('windows-11-required'));
  assert.ok(result.blockers.includes('physical-host-required'));
});

test('missing inventory fails closed instead of treating an incomplete scan as a clean PC', () => {
  const result = assessPreflight({ ...cleanHome(), listeners: undefined, gpus: [] });
  assert.ok(result.blockers.includes('inventory-incomplete'));
  assert.ok(result.blockers.includes('gpu-required'));
});

test('malformed inventory arrays are blocked without crashing the checker', () => {
  assert.equal(assessPreflight({ ...cleanHome(), services: {}, listeners: {}, gpus: {} }).status, 'blocked');
});

test('explicit Pro development permits an existing stack but never qualifies Home or an occupied lab port', () => {
  const host = { ...cleanHome(), editionId: 'Professional', services: [{ name: 'JellyfinServer' }], listeners: [{ port: 8096 }] };
  const report = assessPreflight(host, { mode: 'pro-development' });
  assert.equal(report.status, 'ready-for-isolated-development');
  assert.equal(report.qualified, false);
  assert.equal(report.homeCompatibility, 'unverified');
  assert.equal(assessPreflight({ ...host, listeners: [{ port: 18796 }] }, { mode: 'pro-development' }).status, 'blocked');
  assert.equal(assessPreflight(host, { mode: 'typo' }).status, 'blocked');
});

test('incomplete service or port rows cannot masquerade as a clean isolation scan', () => {
  for (const change of [{ services: [null] }, { services: [{}] }, { listeners: [{}] }, { listeners: [null] }]) {
    assert.ok(assessPreflight({ ...cleanHome(), ...change }).blockers.includes('inventory-incomplete'));
  }
});
