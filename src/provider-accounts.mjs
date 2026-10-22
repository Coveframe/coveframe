// Keys never enter URLs; account checks cannot create torrents, downloads or charges.
const endpoints = new Map([
  ['torbox', 'https://api.torbox.app/v1/api/user/me?settings=false'],
  ['real-debrid', 'https://api.real-debrid.com/rest/1.0/user'],
]);
const failure = (code, message) => ({ ok: false, code, message });
export async function checkProviderAccount(provider, credential, { transport = fetch, now = new Date() } = {}) {
  if (!endpoints.has(provider)) return failure('unsupported-provider', 'Account connections currently support TorBox and Real-Debrid.');
  if (typeof credential !== 'string' || !/^[\x21-\x7e]{1,4096}$/.test(credential)) return failure('invalid-key', 'Paste the API key from your provider account page.');
  try {
    const response = await transport(endpoints.get(provider), {
      method: 'GET', headers: { Authorization: `Bearer ${credential}`, Accept: 'application/json' },
      redirect: 'error', signal: AbortSignal.timeout(12000),
    });
    if (response.status === 401) return failure('invalid-key', 'The provider did not accept this key. Copy it again from your account page.');
    if (response.status === 403) return failure('account-restricted', 'The provider refused access. Check your subscription and account status on its website.');
    if (response.status === 429) return failure('rate-limited', 'The provider needs a pause. Wait a minute before checking again.');
    if (!response.ok) return failure('unavailable', 'The provider is temporarily unavailable. Try again later.');
    // Bound responses as well as request duration. Never relay upstream JSON or errors.
    let bytes = 0;
    const chunks = [];
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > 262144) throw Error('Response too large');
      chunks.push(chunk);
    }
    const raw = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (provider === 'torbox' && raw.success === false) {
      return failure(['BAD_TOKEN', 'AUTH_ERROR', 'NO_AUTH'].includes(raw.error) ? 'invalid-key' : 'unavailable', 'TorBox could not verify this account. Check your key and subscription, then try again.');
    }
    const data = provider === 'torbox' ? raw.data : raw;
    const plan = provider === 'torbox' ? new Map([[0, 'free'], [1, 'essential'], [2, 'pro'], [3, 'standard']]).get(data?.plan)
      : ['premium', 'free'].includes(data?.type) ? data.type : undefined;
    const expires = Date.parse(provider === 'torbox' ? data?.premium_expires_at : data?.expiration);
    if (!plan || !Number.isFinite(expires)) return failure('unexpected-response', 'The provider returned incomplete account information. Try again later.');
    const active = plan !== 'free' && expires > now.getTime() && (provider === 'torbox' || Number(data.premium) > 0);
    return { ok: true, provider, plan, active, usenet: active && provider === 'torbox' && plan === 'pro',
      expiresAt: new Date(expires).toISOString(), checkedAt: now.toISOString(),
      message: active ? 'Account verified. Playback still needs to be tested.' : 'Account verified, but a current paid subscription is needed for this setup.' };
  } catch {
    return failure('unavailable', 'Could not reach the provider. Check your internet connection and try again.');
  }
}
