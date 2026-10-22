import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLabPlan } from '../src/lab-plan.mjs';

test('lab service has its own root, reserved loopback port and least-privilege identity', () => {
  const plan = buildLabPlan({ services: ['JellyfinServer'], ports: [8096] });
  assert.equal(plan.serviceName, 'MediaHubLabJellyfin');
  assert.equal(plan.root, 'C:\\ProgramData\\MediaHubLab');
  assert.equal(plan.identity, 'NT Authority\\NetworkService');
  assert.equal(plan.port, 18796);
  assert.match(plan.networkXml, /<AutoDiscovery>false<\/AutoDiscovery>/);
  assert.match(plan.networkXml, /<string>127.0.0.1<\/string>/);
  assert.match(plan.arguments, /--datadir "C:\\ProgramData\\MediaHubLab\\data"/);
  assert.ok(!plan.arguments.includes('C:\\ProgramData\\Jellyfin'));
  assert.equal(plan.startMode, 'SERVICE_DEMAND_START');
});

test('lab planning never adopts or overwrites an existing service or occupied port', () => {
  assert.throws(() => buildLabPlan({ services: ['MediaHubLabJellyfin'], ports: [] }), /already exists/);
  assert.throws(() => buildLabPlan({ services: [], ports: [18796] }), /occupied/);
  assert.throws(() => buildLabPlan({ services: [], ports: [], rootExists: true }), /already exists/);
  assert.throws(() => buildLabPlan(null), /inventory/i);
});
