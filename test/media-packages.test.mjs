import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { obtainMediaPackage, mediaPackages } from '../src/media-packages.mjs';

test('automatic download apps use pinned official native Windows packages',()=>{
  for(const id of ['radarr','sonarr','prowlarr','decypharr']){
    assert.match(mediaPackages[id]?.url||'',/^https:\/\/github.com\//);
    assert.match(mediaPackages[id]?.sha256||'',/^[a-f0-9]{64}$/);
  }
});

test('a corrupt cached or downloaded package is never extracted or accepted', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'media-package-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let requests = 0;
  const transport = async () => { requests++; return new Response('wrong bytes'); };
  await assert.rejects(obtainMediaPackage('jellyfin', dir, { transport }), /checksum/);
  assert.deepEqual(await readdir(dir), []);
  await writeFile(join(dir, mediaPackages.jellyfin.file), 'corrupt cache');
  await assert.rejects(obtainMediaPackage('jellyfin', dir, { transport }), /verification/);
  assert.equal(requests, 1);
});
