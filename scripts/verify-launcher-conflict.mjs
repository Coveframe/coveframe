import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const run = promisify(execFile);
const launcher = resolve(process.argv[2]);
const unrelated = createServer((request, response) => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ app: 'unrelated-test-fixture' })); });
await new Promise((resolve, reject) => { unrelated.once('error', reject); unrelated.listen(18797, '127.0.0.1', resolve); });
try {
  let code;
  try { await run(launcher, ['--check'], { windowsHide: true, timeout: 15000 }); }
  catch (error) { code = error.code; }
  assert.equal(code, 1, 'Launcher must refuse a listener belonging to another app');
  const status = await fetch('http://127.0.0.1:18797/health').then(r => r.json());
  assert.equal(status.app, 'unrelated-test-fixture', 'The unrelated listener must remain available');
  process.stdout.write(JSON.stringify({ pass: true, conflictRefused: true, unrelatedListenerPreserved: true }) + '\n');
} finally { await new Promise(resolve => { unrelated.close(resolve); unrelated.closeIdleConnections(); }); }
