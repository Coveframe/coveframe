import { composeSetupPlan } from './setup-plan.mjs';
import { getIntegrationGuide } from './integration-guide.mjs';

const metadata = [
  { id: 'tmdb', name: 'TMDB', purpose: 'Movie and TV posters, descriptions and cast', optional: false,
    requiredPersonalKey: false, mode: 'built-in-jellyfin',
    instructions: 'Keep the built-in Jellyfin metadata providers for the basic library. Use your own TMDB account only if an optional integration asks for it.',
    keyUrl: 'https://www.themoviedb.org/settings/api',
    helpUrl: 'https://developer.themoviedb.org/docs/faq',
    sources: ['https://jellyfin.org/docs/general/server/metadata/', 'https://developer.themoviedb.org/docs/faq'] },
  { id: 'mdblist', name: 'MDBList', purpose: 'Extra rating sources and curated lists', optional: true,
    requiredPersonalKey: false, mode: 'own-account-optional', keyUrl: 'https://mdblist.com/preferences/',
    instructions: 'Start with a free API key. Upgrade only if your actual daily usage reaches its limit.',
    helpUrl: 'https://docs.mdblist.com/docs/api', sources: ['https://docs.mdblist.com/docs/api'] },
  { id: 'omdb', name: 'OMDb', purpose: 'An optional extra source of movie information and ratings', optional: true,
    requiredPersonalKey: false, mode: 'own-account-optional',
    keyUrl: 'https://www.omdbapi.com/apikey.aspx?__EVENTTARGET=freeAcct',
    instructions: 'Choose FREE, request a key by email and activate it using the email link. OMDb poster access is a separate patron feature; it is not needed for the basic poster library.',
    helpUrl: 'https://www.omdbapi.com/', sources: ['https://www.omdbapi.com/', 'https://www.omdbapi.com/apikey.aspx?__EVENTTARGET=freeAcct'] },
];

const providers = {
  'real-debrid': {
    id: 'real-debrid', name: 'Real-Debrid', pricingUrl: 'https://real-debrid.com/premium',
    accountUrl: 'https://real-debrid.com/', keyUrl: 'https://real-debrid.com/apitoken',
    helpUrl: 'https://api.real-debrid.com/', connection: 'device-authorization-planned',
    connectionInstructions: 'Use Connect Real-Debrid when device authorization is available. The manual alternative is your API token page after signing in.',
    sources: ['https://api.real-debrid.com/', 'https://real-debrid.com/premium'],
    plans: [{ id: 'premium', name: 'Premium', price: null, priceLabel: 'Check the current price on Real-Debrid', usenet: false }],
    defaultPlan: 'premium',
    reason: 'Use your existing Premium account if you have one. Start with a short purchase while testing a new setup.',
    notes: ['Premium is the paid access level. Check the available durations and final price in your own account.',
      'The official pricing page could not be read during this review; no unverified amount is shown.',
      'This path does not provide a Usenet subscription.'],
  },
  premiumize: {
    id: 'premiumize', name: 'Premiumize', pricingUrl: 'https://www.premiumize.me/premium',
    accountUrl: 'https://www.premiumize.me/account', keyUrl: 'https://www.premiumize.me/account',
    helpUrl: 'https://www.premiumize.me/api', connection: 'oauth-or-own-api-key-planned',
    connectionInstructions: 'Use Connect Premiumize when authorization is available. The manual alternative is the API key on your Account page.',
    sources: ['https://www.premiumize.me/premium', 'https://www.premiumize.me/api', 'https://www.premiumize.me/help/article/download-limit'],
    plans: [
      { id: 'premium-month', name: 'Premium, one month', price: { amount: 11.99, currency: 'USD', period: 'month' }, usenet: true },
      { id: 'premium-year', name: 'Premium, one year', price: { amount: 79.99, currency: 'USD', period: 'year' }, usenet: true },
    ],
    defaultPlan: 'premium-month',
    reason: 'The monthly Premium plan includes API access. Use an existing account first; consider a year only after the complete setup works.',
    notes: ['Both durations have the same Premium features. Annual pricing is the upfront yearly charge.',
      'Traffic uses a fair-use balance: up to 1,000 points, replenished by 30 points a day; generally one point per GB. Service-specific factors may apply.',
      'A yearly purchase does not reset the traffic balance every month. Check your live balance before large streams.',
      'Regional tax may apply. Confirm the final currency and total before paying.'],
  },
  torbox: {
    id: 'torbox', name: 'TorBox', pricingUrl: 'https://torbox.app/pricing',
    accountUrl: 'https://torbox.app/', keyUrl: 'https://torbox.app/settings',
    helpUrl: 'https://support.torbox.app/en/articles/9836418-account-restrictions',
    connection: 'device-authorization-planned',
    connectionInstructions: 'Use Connect TorBox when device authorization is available. The manual alternative is the API key section in TorBox Settings.',
    defaultPlan: 'essential',
    sources: ['https://torbox.app/pricing', 'https://support.torbox.app/en/articles/9836418-account-restrictions', 'https://api-docs.torbox.app/', 'https://api.torbox.app/docs'],
    plans: [
      { id: 'essential', name: 'Essential', price: { amount: 3, currency: 'USD', period: 'month' }, usenet: false },
      { id: 'standard', name: 'Standard', price: { amount: 5, currency: 'USD', period: 'month' }, usenet: false },
      { id: 'pro', name: 'Pro', price: { amount: 10, currency: 'USD', period: 'month' }, usenet: true },
    ],
    notes: ['Essential is the lowest paid option for basic cached playback.',
      'Standard adds download slots and seeding time; it is not needed just to enable Usenet.',
      'Pro is needed for Usenet. Published download slots are not a promise of simultaneous TV playback.',
      'A higher tier cannot guarantee that a particular title is available.'],
  },
};

export function getSetupGuide({ provider = 'torbox', useUsenet = false, libraryOnly = false, now = new Date() } = {}) {
  if (typeof provider !== 'string' || !Object.hasOwn(providers, provider)) throw new Error('Choose a supported provider from the setup guide');
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('A valid review date is required');
  if (typeof useUsenet !== 'boolean') throw new Error('Use a true or false Usenet preference');
  if (typeof libraryOnly !== 'boolean') throw new Error('Use a true or false local-library preference');
  const checkedAt = '2026-10-21T00:00:00Z';
  const current = now.getTime() >= Date.parse(checkedAt) && now.getTime() - Date.parse(checkedAt) <= 30 * 86400000;
  const selected = structuredClone(providers[provider]);
  if (!current) for (const plan of selected.plans) {
    plan.price = null;
    plan.priceLabel = `Check the current price with ${selected.name}`;
  }
  selected.recommendedPlan = selected.plans.find(plan => plan.id === (provider === 'torbox' && useUsenet ? 'pro' : selected.defaultPlan));
  if (provider === 'torbox') selected.reason = useUsenet ? 'You selected Usenet, which requires Pro.' : 'Essential covers basic cached playback. Start monthly while testing your setup.';
  selected.integrationStatus = 'not-yet-validated';
  selected.buyBeforeConnectionTest = false;
  const blockers = [];
  if (!libraryOnly && useUsenet && !selected.recommendedPlan.usenet) {
    blockers.push('provider-does-not-include-usenet');
    selected.reason = 'This provider path does not include Usenet. Choose TorBox Pro or an eligible Premiumize account if you want that optional feature.';
  }
  return {
    schemaVersion: 1, status: 'guide-preview', qualified: false,
    runtime: 'native-windows-services', requiredSubscriptions: libraryOnly ? 0 : 1,
    provider: libraryOnly ? null : selected,
    pricing: { checkedAt, status: current ? 'recently-reviewed' : 'needs-review',
      message: 'Published prices can change. Review the provider checkout before paying; taxes and currency conversion may differ.' },
    blockers,
    steps: [
      { id: 'pc', title: 'Check this PC', description: 'Check Windows, storage, graphics and existing media apps before installing anything.' },
      { id: 'household', title: 'Create your household account', description: 'Use one Jellyfin account for the household. Internal app connections are handled by setup.' },
      { id: 'provider', title: libraryOnly ? 'Use your local library' : 'Connect a streaming provider', description: libraryOnly ? 'Use your existing files; a streaming subscription is optional.' : 'Review the selected provider and plan, then connect your account.' },
      { id: 'preferences', title: 'Choose how you watch', description: 'Prefer original audio and English subtitles when available. Extra ratings and downloads are optional.' },
      { id: 'tv', title: 'Connect your TV', description: 'Follow the instructions for your TV, then test playback, seeking, audio and subtitles.' },
    ],
    metadata: structuredClone(metadata),
    appProvidedMetadata: { status: 'not-configured', personalKeyBundling: false,
      description: 'An approved app credential could remove optional key setup. A personal key is not included in this downloadable package.',
      requirements: ['Confirm application use and distribution with each provider',
        'Keep app secrets on a controlled backend with per-install limits and credential rotation',
        'Include the required attribution; use the commercial license if applicable'],
      sources: ['https://developer.themoviedb.org/docs/faq', 'https://www.omdbapi.com/', 'https://docs.mdblist.com/docs/api'] },
    downloads: { enabledByDefault: false, canRequestWithoutConfiguredPipeline: false,
      description: 'Add Radarr, Sonarr and a download client later if you want offline files. Requests become available after their complete download path passes a connection test.' },
    preferences: { audio: 'original', subtitles: 'English when matched subtitles are available',
      sources: 'verified-local-or-cached', releases: 'finished-consumer-release', properTagRequired: false },
  };
}

export function getSetupCatalog({ now = new Date() } = {}) {
  const catalog = { local: getSetupGuide({ libraryOnly: true, now }) };
  catalog.integrationGuides = {};
  for (const streaming of [false, true]) for (const downloads of [false, true]) {
    catalog.integrationGuides[`${streaming}:${downloads}`] = getIntegrationGuide({ streaming, downloads });
  }
  for (const provider of Object.keys(providers)) for (const useUsenet of [false, true]) {
    catalog[`${provider}:${useUsenet}`] = getSetupGuide({ provider, useUsenet, now });
  }
  return catalog;
}

export function getSetupPlan(options = {}) {
  if (options.providers !== undefined && (options.provider !== undefined || options.libraryOnly !== undefined)) throw new Error('Use providers or the legacy single-provider fields, not both');
  if (options.libraryOnly !== undefined && typeof options.libraryOnly !== 'boolean') throw new Error('Use a true or false local-library preference');
  const choices = options.libraryOnly ? [] : options.providers ?? (options.provider !== undefined ? [{ id: options.provider }] : undefined);
  return composeSetupPlan(getSetupCatalog({ now: options.now }), { providers: choices, useUsenet: options.useUsenet, now: options.now });
}
