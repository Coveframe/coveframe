import { createServer } from 'node:http';
import { lookup as resolveHost } from 'node:dns/promises';
import { isIP } from 'node:net';

const validId = id => typeof id === 'string' && /^tt\d{5,12}(?::\d{1,4}:\d{1,5})?$/.test(id);
function publicAddress(address) {
  if (isIP(address) === 4) {
    const [a,b] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 100 && b >= 64 && b <= 127 || a === 198 && [18,19].includes(b));
  }
  // Require globally routed IPv6, excluding mapped, local, link-local and multicast addresses.
  return isIP(address) === 6 && /^[23][0-9a-f]{0,3}:/i.test(address);
}
export async function startPlaybackGateway({ port = 18801, token, streams, lookup = resolveHost }) {
  if (!/^[a-f0-9]{64}$/.test(token)) throw Error('A private playback token is required.');
  let url;
  const safeDestination = async value => {
    let target;
    try { target = new URL(value); } catch { return null; }
    if (target.username || target.password || target.hash) return null;
    // This exact owned AIO listener also serves locally resolved playback links.
    if (target.origin === 'http://127.0.0.1:18800') return target.href;
    if (target.protocol !== 'https:' || target.port && target.port !== '443') return null;
    const addresses = await lookup(target.hostname, { all: true });
    return addresses.length && addresses.every(x => publicAddress(x.address)) ? target.href : null;
  };
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    const fail = status => { response.writeHead(status, { 'Content-Type': 'text/plain' }); response.end('Playback is unavailable. Check Media Hub on the server PC.'); };
    if (request.headers.host !== new URL(url).host || !['GET','HEAD'].includes(request.method)) return fail(404);
    const match = request.url.match(new RegExp(`^/${token}/(movie|series)/(tt\\d{5,12}(?::\\d{1,4}:\\d{1,5})?)/stream$`));
    if (!match) return fail(404);
    try {
      const result = await streams(match[1], match[2]);
      for (const stream of (result?.streams || []).slice(0,30)) {
        if (!stream.url || stream.externalUrl || stream.behaviorHints?.proxyHeaders) continue;
        const destination = await safeDestination(stream.url);
        if (!destination) continue;
        response.writeHead(302, { Location: destination }); response.end(); return;
      }
      fail(503);
    } catch { fail(503); }
  });
  server.requestTimeout = 65000; server.headersTimeout = 10000; server.maxConnections = 30;
  await new Promise((yes,no) => { server.once('error',no); server.listen(port,'127.0.0.1',yes); });
  url = `http://127.0.0.1:${server.address().port}`;
  return { url,
    link(type,id) { if (!['movie','series'].includes(type) || !validId(id)) throw Error('Choose a valid movie or episode ID.'); return `${url}/${token}/${type}/${id}/stream`; },
    close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }),
  };
}
