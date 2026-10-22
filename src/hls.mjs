export function readLabPlaylist(text, parentUrl) {
  if (!text.trimStart().startsWith('#EXTM3U')) throw new Error('Expected an HLS playlist');
  const urls=text.split(/\r?\n/).map(line=>line.trim()).filter(line=>line && !line.startsWith('#')).map(line=>{
    const url=new URL(line,parentUrl);
    if(url.origin!=='http://127.0.0.1:18796' || url.username || url.password) throw new Error('Lab HLS must remain on loopback');
    return url.href;
  });
  if(!urls.length) throw new Error('HLS playlist is empty');
  return {kind:text.includes('#EXT-X-STREAM-INF:')?'master':'media',urls};
}
