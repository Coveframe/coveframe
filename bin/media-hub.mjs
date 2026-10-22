import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assessPreflight } from '../src/qualification.mjs';
import { assessBootRun } from '../src/boot-proof.mjs';
import { inspectTranscodeLog } from '../src/transcode.mjs';
import { getSetupPlan } from '../src/onboarding.mjs';
import { renderSetupPreview } from '../src/setup-preview.mjs';

const execute = promisify(execFile);
const [command, ...args] = process.argv.slice(2);
const help = 'Commands: preflight [--mode qualification-home|pro-development] [--output FILE], inspect-transcode --input FILE [--output FILE], evaluate-boot --input FILE [--output FILE], setup-guide [--input PREFERENCES.json] [--output FILE], setup-preview --output FILE.html';
const options = {};

async function inputFile() {
  if (!options.input) throw new Error('--input is required');
  if ((await stat(options.input)).size > 8 * 1024 * 1024) throw new Error('Input exceeds the 8 MiB evidence limit');
  return readFile(options.input, 'utf8');
}

try {
  if (!command || ['help','--help'].includes(command)) { process.stdout.write(`${help}\n`); }
  else {
    if (args.length % 2) throw new Error('Options require a value');
    for (let i = 0; i < args.length; i += 2) {
      if (!['--input','--output','--mode'].includes(args[i]) || options[args[i].slice(2)]) throw new Error('Unknown or repeated option');
      options[args[i].slice(2)] = args[i + 1];
    }
    let report;
    let previewWritten = false;
    if (command === 'setup-preview') {
      if (!options.output || options.input || options.mode) throw new Error('Use setup-preview --output FILE.html; no input or credentials are accepted');
      const html = await renderSetupPreview();
      await mkdir(path.dirname(path.resolve(options.output)), { recursive: true });
      await writeFile(options.output, html, { flag: 'wx' });
      previewWritten = true;
      report = { schemaVersion: 1, status: 'preview-written', qualified: false, installed: false, output: path.resolve(options.output) };
    } else if (command === 'setup-guide') {
      report = getSetupPlan(options.input ? JSON.parse(await inputFile()) : {});
    } else if (command === 'preflight') {
      if (process.platform !== 'win32') throw new Error('Native inventory requires Windows');
      const script = fileURLToPath(new URL('../scripts/Get-HostInventory.ps1', import.meta.url));
      const { stdout } = await execute('powershell.exe', ['-NoProfile','-NonInteractive','-File',script], {
        windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024,
      });
      const inventory = JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
      report = { schemaVersion: 1, ...assessPreflight(inventory, { mode: options.mode }), inventory };
    } else if (command === 'inspect-transcode') {
      report = { schemaVersion: 1, ...inspectTranscodeLog(await inputFile()), qualified: false };
    } else if (command === 'evaluate-boot') {
      report = { schemaVersion: 1, ...assessBootRun(JSON.parse(await inputFile())) };
    } else { throw new Error(help); }
    const json = `${JSON.stringify(report, null, 2)}\n`;
    if (options.output && !previewWritten) {
      await mkdir(path.dirname(path.resolve(options.output)), { recursive: true });
      await writeFile(options.output, json, { flag: 'wx' });
    }
    process.stdout.write(json);
    if (report.status === 'blocked') process.exitCode = 2;
  }
} catch (error) {
  // Do not print raw evidence, child stdout/stderr, requests, credentials or stack traces.
  const message = error.code === 'EEXIST' ? 'Output already exists; choose a new file' :
    error instanceof SyntaxError ? 'Input is not valid JSON' :
    error.cmd || error.stdout || error.stderr ? 'Native inventory failed; no qualification was granted' : error.message;
  process.stderr.write(`${JSON.stringify({ status: 'error', qualified: false, message })}\n`);
  process.exitCode = 1;
}
