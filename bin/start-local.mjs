import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { startSetupServer } from '../src/setup-server.mjs';

// The GUI launcher starts this process hidden. No administrator rights or global installs.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const instanceId = createHash('sha256').update(root.replace(/[\\/]+$/, '').toLowerCase()).digest('hex');
if (process.platform !== 'win32' || !process.env.LOCALAPPDATA) {
  process.stderr.write('Media Hub local setup requires Windows.\n');
  process.exitCode = 1;
} else {
  try {
    const app = await startSetupServer({
      directory: process.env.MEDIA_HUB_DATA_DIR || resolve(process.env.LOCALAPPDATA, 'MediaHub', 'Setup'),
      appDirectory:root,
      instanceId, onStop: () => { process.exitCode = 0; },
    });
    process.stdout.write(`Media Hub local setup listening at ${app.url}\n`);
    const stop = () => { app.close().then(() => { process.exitCode = 0; }); };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  } catch (error) {
    process.stderr.write(error.code === 'EADDRINUSE'
      ? 'Media Hub could not start: port 18797 is already in use. No existing process was changed.\n'
      : 'Media Hub could not start. Check Windows access to the app folder and saved setup.\n');
    process.exitCode = 1;
  }
}
