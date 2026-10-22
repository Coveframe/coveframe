import test from 'node:test';
import assert from 'node:assert/strict';
import { assessBootRun } from '../src/boot-proof.mjs';

export function validRun() {
  return {
    schemaVersion: 1, machineId: 'lab-host', bootStartedAt: '2026-10-20T10:00:00Z', bootKind: 'cold',
    collectedAt: '2026-10-20T10:08:00Z',
    service: { name: 'JellyfinServer', startMode: 'Auto', identity: 'NT Authority\\NetworkService',
      processStartedAt: '2026-10-20T10:00:30Z', sessionId: 0, processId: 123 },
    audit: { enabledBeforeBoot: true, enabledAtCollection: true, complete: true,
      oldestEventAt: '2026-10-19T00:00:00Z', windowStart: '2026-10-20T10:00:00Z',
      windowEnd: '2026-10-20T10:06:00Z', interactiveLogons: [], policyChanges: [], cleared: false },
    observer: { machineId: 'different-client', startedAt: '2026-10-20T10:02:00Z', endedAt: '2026-10-20T10:06:00Z',
      receivedVideoSeconds: 120, seekVerified: true, fixtureId: 'mediahub-qualification-h264', clockOffsetMs: 100 },
    transcode: { fixtureId: 'mediahub-qualification-h264', processId: 456, parentProcessId: 123,
      log: '-hwaccel cuda -c:v h264_nvenc\nframe=3600\nvideo:1234KiB',
      gpuSamples: [{ processId: 456, engine: 'VideoEncode', utilization: 30 },
        { processId: 456, engine: 'VideoDecode', utilization: 20 }] },
  };
}

test('complete before-sign-in evidence can proceed to human review without declaring the product qualified', () => {
  const result = assessBootRun(validRun());
  assert.equal(result.status, 'ready-for-review');
  assert.equal(result.qualified, false);
  assert.deepEqual(result.blockers, []);
});

test('a locked session after an earlier login is rejected as before-sign-in proof', () => {
  const run = validRun();
  run.audit.interactiveLogons = [{ at: '2026-10-20T10:01:00Z', logonType: 2 }];
  assert.ok(assessBootRun(run).blockers.includes('interactive-login-during-proof'));
});

test('missing audit coverage, same-device playback and unrelated GPU activity fail closed', () => {
  const run = validRun();
  run.audit.complete = false;
  run.observer.machineId = run.machineId;
  run.transcode.gpuSamples.forEach(sample => { sample.processId = 999; });
  const blockers = assessBootRun(run).blockers;
  assert.ok(blockers.includes('logon-audit-incomplete'));
  assert.ok(blockers.includes('separate-observer-required'));
  assert.ok(blockers.includes('matching-gpu-activity-required'));
});

test('software encoding and a desktop-session process cannot pass the service/GPU gate', () => {
  const run = validRun();
  run.service.sessionId = 1;
  run.transcode.log = '-c:v libx264\nframe=3600\nvideo:1234KiB';
  const blockers = assessBootRun(run).blockers;
  assert.ok(blockers.includes('session-zero-service-required'));
  assert.ok(blockers.includes('hardware-transcode-not-demonstrated'));
});

test('malformed receipts and insufficient playback never produce a passing report', () => {
  assert.equal(assessBootRun(null).status, 'blocked');
  const run = validRun();
  run.observer.receivedVideoSeconds = 2;
  run.observer.seekVerified = false;
  run.audit.windowEnd = '2026-10-20T10:03:00Z';
  const blockers = assessBootRun(run).blockers;
  assert.ok(blockers.includes('sustained-playback-and-seek-required'));
  assert.ok(blockers.includes('logon-audit-incomplete'));
});

test('malformed GPU observations are reported as missing evidence', () => {
  const run = validRun();
  run.transcode.gpuSamples = {};
  assert.ok(assessBootRun(run).blockers.includes('matching-gpu-activity-required'));
});
