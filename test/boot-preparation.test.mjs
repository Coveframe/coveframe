import test from 'node:test';
import assert from 'node:assert/strict';
import { assessBootPreparation } from '../src/boot-preparation.mjs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentAttempt = '32ebd2d3-21b3-485c-a246-b5f830da0815';
function completedAttempt(attemptId = currentAttempt) {
  return {
    dryRun: { schemaVersion: 1, attemptId, dryRun: true,
      probe: { status: 'partial-proof', checks: [
        { name: 'received-and-decoded-hls-video', passed: true },
        { name: 'completed-hardware-transcode-log', passed: true },
      ], transcode: { hardwareDecode: true, completedHardwareEncode: true } },
      capture: { service: { name: 'MediaHubLabJellyfin', sessionId: 0 }, audit: { complete: true } } },
    result: { schemaVersion: 1, attemptId, dryRun: true, collectionCompleted: true,
      status: 'blocked', qualified: false, blockers: ['new-boot-required'] },
  };
}
const options = { attemptId: currentAttempt, taskState: 'Ready', taskResult: 0 };

test('boot preparation rejects previous successful receipts when the new attempt has not completed', () => {
  const result = assessBootPreparation(completedAttempt('af296c00-9847-48ef-a934-38d3a2a432cd'), options);
  assert.equal(result.status, 'blocked');
  assert.ok(result.blockers.includes('dry-run-attempt-mismatch'));
});

test('a running or failed task cannot arm the test even with matching playback receipts', () => {
  for (const changed of [{ taskState: 'Running' }, { taskResult: 267009 }, { taskResult: 1 }]) {
    const result = assessBootPreparation(completedAttempt(), { ...options, ...changed });
    assert.equal(result.status, 'blocked');
    assert.ok(result.blockers.includes('dry-run-task-not-successful'));
  }
});

test('a failed collection or incomplete hardware playback blocks preparation', () => {
  const cases = [
    value => { value.result.collectionCompleted = false; },
    value => { value.result.dryRun = false; },
    value => { value.dryRun.dryRun = false; },
    value => { value.dryRun.probe.checks[0].passed = false; },
    value => { value.dryRun.probe.transcode.hardwareDecode = false; },
    value => { value.dryRun.capture.service.name = 'JellyfinServer'; },
  ];
  for (const mutate of cases) {
    const evidence = completedAttempt();
    mutate(evidence);
    assert.equal(assessBootPreparation(evidence, options).status, 'blocked');
  }
});

test('a fresh completed SYSTEM attempt permits arming without claiming boot qualification', () => {
  const result = assessBootPreparation(completedAttempt(), options);
  assert.equal(result.status, 'ready-to-arm');
  assert.equal(result.qualified, false);
  assert.equal(result.homeCompatibility, 'unverified');
  assert.deepEqual(result.blockers, []);
});

test('the executable preparation gate reads attempt files and rejects mixed or missing receipts', async () => {
  const execute = promisify(execFile);
  const cli = fileURLToPath(new URL('../scripts/evaluate-boot-preparation.mjs', import.meta.url));
  const directory = await mkdtemp(path.join(os.tmpdir(), 'mediahub-attempt-'));
  try {
    const evidence = completedAttempt();
    await writeFile(path.join(directory, 'dry-run.json'), '\uFEFF' + JSON.stringify(evidence.dryRun));
    await writeFile(path.join(directory, 'dry-run-result.json'), JSON.stringify(evidence.result));
    const args = [cli, directory, currentAttempt, 'Ready', '0'];
    const good = await execute(process.execPath, args, { windowsHide: true });
    assert.equal(JSON.parse(good.stdout).status, 'ready-to-arm');
    evidence.result.attemptId = 'af296c00-9847-48ef-a934-38d3a2a432cd';
    await writeFile(path.join(directory, 'dry-run-result.json'), JSON.stringify(evidence.result));
    await assert.rejects(execute(process.execPath, args, { windowsHide: true }), error =>
      error.code === 2 && JSON.parse(error.stdout).blockers.includes('dry-run-attempt-mismatch'));
    await writeFile(path.join(directory, 'dry-run-result.json'), '{bad-json-must-not-appear');
    await assert.rejects(execute(process.execPath, args, { windowsHide: true }), error =>
      error.code === 2 && !error.stdout.includes('bad-json-must-not-appear'));
  } finally {
    const target = path.resolve(directory);
    assert.ok(target.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(target).startsWith('mediahub-attempt-'));
    await rm(target, { recursive: true, force: true });
  }
});
