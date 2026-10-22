import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { assessBootPreparation } from '../src/boot-preparation.mjs';

const [directory, attemptId, taskState, taskResult] = process.argv.slice(2);
try {
  const read = async name => JSON.parse((await readFile(path.join(directory, name), 'utf8')).replace(/^\uFEFF/, ''));
  const report = assessBootPreparation({ dryRun: await read('dry-run.json'), result: await read('dry-run-result.json') },
    { attemptId, taskState, taskResult: Number(taskResult) });
  console.log(JSON.stringify(report));
  if (report.status !== 'ready-to-arm') process.exitCode = 2;
} catch {
  console.log(JSON.stringify({ schemaVersion: 1, status: 'blocked', qualified: false, blockers: ['dry-run-receipt-unavailable'] }));
  process.exitCode = 2;
}
