import { checkProviderAccount } from './provider-accounts.mjs';

const providers = ['torbox', 'real-debrid'];
const failed = (code, message) => ({ ok: false, code, message });
export async function createConnections({ vault, check = checkProviderAccount }) {
  let saved = await vault.read();
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw Error('Saved accounts are invalid');
  const verified = new Set();
  let queue = Promise.resolve();
  const serialize = operation => {
    const pending = queue.then(operation);
    queue = pending.catch(() => {});
    return pending;
  };
  // Explicit allowlist, even for locally persisted data. Never return email, tokens or raw provider bodies.
  const summary = result => Object.fromEntries(['provider', 'plan', 'active', 'usenet', 'expiresAt', 'checkedAt', 'message']
    .filter(key => result[key] !== undefined).map(key => [key, result[key]]));
  async function connect(provider, credential) {
    if (!providers.includes(provider)) return failed('unsupported-provider', 'Choose TorBox or Real-Debrid to connect an account.');
    verified.delete(provider);
    const result = await check(provider, credential);
    if (!result.ok) return result;
    const next = { ...saved, [provider]: { credential, summary: summary(result) } };
    try { await vault.write(next); }
    catch { return failed('storage-failed', 'Windows could not save this key securely. Your previous saved accounts are unchanged.'); }
    saved = next;
    verified.add(provider);
    return { ok: true, ...summary(result), saved: true };
  }
  return {
    // Server-side only. HTTP handlers never serialize this callback's input.
    withCredentials: (selected, operation) => serialize(async () => {
      if (!Array.isArray(selected) || !selected.length || selected.length > 2 || new Set(selected).size !== selected.length || selected.some(id => !providers.includes(id))) throw Error('Choose supported accounts.');
      const keys = {};
      for (const id of selected) {
        if (!saved[id]?.credential) throw Error('Connect each selected account first.');
        const checked = await connect(id, saved[id].credential);
        if (!checked.ok || !checked.active || !Number.isFinite(Date.parse(checked.expiresAt)) || Date.parse(checked.expiresAt) <= Date.now()) throw Error('Each selected account needs an active subscription.');
        keys[id] = saved[id].credential;
      }
      return operation(keys);
    }),
    status() {
      return Object.fromEntries(providers.map(provider => {
        const data = saved[provider]?.summary;
        return [provider, { ...(data ? summary(data) : {}), configured: Boolean(saved[provider]?.credential),
          verifiedThisSession: verified.has(provider),
          active: Boolean(data?.active && Date.parse(data.expiresAt) > Date.now()) }];
      }));
    },
    connect: (provider, credential) => serialize(() => connect(provider, credential)),
    recheck: provider => serialize(() => saved[provider]?.credential ? connect(provider, saved[provider].credential)
      : failed('not-connected', 'Connect this account first.')),
    disconnect: provider => serialize(async () => {
      if (!providers.includes(provider)) return failed('unsupported-provider', 'Choose a supported provider.');
      const next = { ...saved };
      delete next[provider];
      try { await vault.write(next); }
      catch { return failed('storage-failed', 'Could not remove the saved account. Try again.'); }
      saved = next;
      verified.delete(provider);
      return { ok: true };
    }),
  };
}
