import test from 'node:test';
import assert from 'node:assert/strict';
import { readLabPlaylist } from '../src/hls.mjs';

test('an HLS master requires following the variant before fetching media segments', () => {
  const master=readLabPlaylist('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=700000\nmain.m3u8?test=1\n','http://127.0.0.1:18796/Videos/id/master.m3u8');
  assert.equal(master.kind,'master');
  assert.equal(master.urls[0],'http://127.0.0.1:18796/Videos/id/main.m3u8?test=1');
  const media=readLabPlaylist('#EXTM3U\n#EXTINF:3,\nseg0.ts\n#EXT-X-ENDLIST','http://127.0.0.1:18796/Videos/id/main.m3u8');
  assert.equal(media.kind,'media');
  assert.equal(media.urls.length,1);
});

test('lab HLS parsing refuses external destinations, empty playlists and non-HLS bodies', () => {
  assert.throws(()=>readLabPlaylist('#EXTM3U\nhttps://example.org/file.ts','http://127.0.0.1:18796/main.m3u8'),/loopback/);
  assert.throws(()=>readLabPlaylist('#EXTM3U','http://127.0.0.1:18796/main.m3u8'),/empty/);
  assert.throws(()=>readLabPlaylist('<html>error</html>','http://127.0.0.1:18796/main.m3u8'),/HLS/);
});
