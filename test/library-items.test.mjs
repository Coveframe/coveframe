import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeLibraryItem } from '../src/library-items.mjs';

test('movies and episodes get stable private stream links and escaped metadata without overwriting files', async t => {
  const root = await mkdtemp(join(tmpdir(), 'media-hub-library-'));
  t.after(() => rm(root,{recursive:true,force:true}));
  const link = 'http://127.0.0.1:18801/' + 'a'.repeat(64) + '/movie/tt0000001/stream';
  const info = { type: 'movie', imdbId: 'tt0000001', title: 'A & B', year: 2026 };
  const result = await writeLibraryItem({ libraryRoot: root, info, link });
  assert.equal(await readFile(join(root,'Movies','Media Hub tt0000001','movie.strm'),'utf8'), link + '\n');
  assert.match(await readFile(join(root,'Movies','Media Hub tt0000001','movie.nfo'),'utf8'), /A &amp; B/);
  assert.doesNotMatch(JSON.stringify(result), /18801|aaaa/);
  await writeLibraryItem({ libraryRoot: root, info, link });
  await assert.rejects(writeLibraryItem({ libraryRoot:root, info, link:link+'?changed' }), /Preserve/);
  const episode = { type: 'series', imdbId: 'tt0000002', title: 'Example Show', season: 2, episode: 3 };
  await writeLibraryItem({ libraryRoot:root, info:episode, link:link.replace('/movie/tt0000001/','/series/tt0000002:2:3/') });
  assert.match(await readFile(join(root,'TV','Media Hub tt0000002','Season 02','S02E03.nfo'),'utf8'), /<season>2<\/season>/);
  await assert.rejects(writeLibraryItem({ libraryRoot:root, info:{...info,imdbId:'../../outside'},link }), /valid/);
});
