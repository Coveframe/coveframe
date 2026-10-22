const supported = ['tmdb','mdblist'];
export async function createMetadataConnections({ vault, apply }) {
  const stored = await vault.read();
  let saved = Object.fromEntries(supported.filter(id => typeof stored[id] === 'string').map(id => [id,stored[id]]));
  let queue = Promise.resolve();
  const serialize = operation => { const pending = queue.then(operation); queue = pending.catch(() => {}); return pending; };
  const change = async next => {
    await vault.write(next);
    saved = next;
    let applied = false;
    try { applied = await apply({ ...saved }); } catch {}
    return { ok: true, applied, providerVerified: false };
  };
  return {
    status: () => Object.fromEntries(supported.map(id => [id,{ configured: Boolean(saved[id]), providerVerified: false }])),
    connect: (id,key) => serialize(async () => {
      if (!supported.includes(id)) throw Error('Choose TMDB or MDBList.');
      if (typeof key !== 'string' || (id === 'tmdb' ? !/^[a-f0-9]{32}$/i.test(key) : !/^[a-zA-Z0-9_-]{8,256}$/.test(key))) throw Error(id === 'tmdb' ? 'Use the 32-character TMDB API key (v3 auth), not the read access token.' : 'Paste the MDBList API key from your preferences.');
      return change({ ...saved, [id]: key });
    }),
    disconnect: id => serialize(async () => {
      if (!supported.includes(id)) throw Error('Choose a supported metadata service.');
      const next = { ...saved }; delete next[id]; return change(next);
    }),
    withKeys: operation => serialize(() => operation({ ...saved })),
  };
}
