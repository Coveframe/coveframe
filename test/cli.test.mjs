import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const execute = promisify(execFile);
const cli = fileURLToPath(new URL('../bin/media-hub.mjs', import.meta.url));

test('setup-preview exports offline HTML exclusively and never accepts credential input', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mediahub-cli-'));
  try {
    const output = path.join(dir, 'setup.html');
    const result = await execute(process.execPath, [cli, 'setup-preview', '--output', output], { windowsHide: true });
    assert.equal(JSON.parse(result.stdout).status, 'preview-written');
    const html = await readFile(output, 'utf8');
    assert.match(html, /<title>Coveframe/);
    await assert.rejects(execute(process.execPath, [cli, 'setup-preview', '--output', output], { windowsHide: true }));
    assert.equal(await readFile(output, 'utf8'), html);
    await assert.rejects(execute(process.execPath, [cli, 'setup-preview', '--input', 'must-not-read.json'], { windowsHide: true }));
  } finally {
    const target = path.resolve(dir);
    assert.ok(target.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(target).startsWith('mediahub-cli-'));
    await rm(target, { recursive: true, force: true });
  }
});

test('the CLI rejects incomplete evidence without echoing credentials and preserves existing output files', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mediahub-cli-'));
  try {
    const input = path.join(dir, 'input.json'), output = path.join(dir, 'report.json');
    await writeFile(input, JSON.stringify({ secret: 'must-never-appear' }));
    let result;
    try { await execute(process.execPath, [cli, 'evaluate-boot', '--input', input, '--output', output], { windowsHide: true }); }
    catch (error) { result = error; }
    assert.equal(result?.code, 2);
    assert.ok(!result.stdout.includes('must-never-appear'));
    const original = await readFile(output, 'utf8');
    assert.equal(JSON.parse(original).qualified, false);
    await assert.rejects(execute(process.execPath, [cli, 'evaluate-boot', '--input', input, '--output', output], { windowsHide: true }));
    assert.equal(await readFile(output, 'utf8'), original);
  } finally {
    const resolved = path.resolve(dir), tempRoot = path.resolve(os.tmpdir()) + path.sep;
    assert.ok(resolved.startsWith(tempRoot) && path.basename(resolved).startsWith('mediahub-cli-'));
    await rm(resolved, { recursive: true, force: true });
  }
});

test('setup-guide generates a native Windows guide without starting services or echoing input secrets', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mediahub-cli-'));
  try {
    const input = path.join(dir, 'preferences.json');
    await writeFile(input, JSON.stringify({ providers: [{ id: 'torbox', plan: 'pro' }, { id: 'real-debrid' }], useUsenet: true, apiKey: 'do-not-echo-this' }));
    const result = await execute(process.execPath, [cli, 'setup-guide', '--input', input], { windowsHide: true });
    const report = JSON.parse(result.stdout);
    assert.equal(report.runtime, 'native-windows-services');
    assert.deepEqual(report.providers.map(item => item.selectedPlan.id), ['pro', 'premium']);
    assert.equal(report.status, 'guide-preview');
    assert.equal(report.qualified, false);
    assert.ok(!result.stdout.includes('do-not-echo-this'));
  } finally {
    const target = path.resolve(dir);
    assert.ok(target.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(target).startsWith('mediahub-cli-'));
    await rm(target, { recursive: true, force: true });
  }
});
