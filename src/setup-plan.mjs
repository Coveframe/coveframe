// Shared by the Node guide and the offline wizard; accepts only nonsecret choices.
export function composeSetupPlan(catalog, { providers = [{ id: 'torbox' }, { id: 'real-debrid' }], useUsenet = false, downloads = false, now = new Date() } = {}) {
  if (!Array.isArray(providers) || providers.length > 3) throw new Error('Choose up to three supported providers');
  if (typeof useUsenet !== 'boolean') throw new Error('Use a true or false Usenet preference');
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('A valid review date is required');
  const base = structuredClone(catalog.local);
  delete base.provider;
  base.schemaVersion = 2;
  const seen = new Set();
  base.providers = providers.map(choice => {
    if (!choice || typeof choice.id !== 'string' || !['torbox', 'real-debrid', 'premiumize'].includes(choice.id)) throw new Error('Choose a supported provider');
    if (seen.has(choice.id)) throw new Error('Choose each provider only once');
    seen.add(choice.id);
    const provider = structuredClone(catalog[`${choice.id}:${useUsenet}`].provider);
    provider.selectedPlan = provider.plans.find(plan => plan.id === (choice.plan ?? provider.recommendedPlan.id));
    if (!provider.selectedPlan) throw new Error('Choose a supported plan for each provider');
    return provider;
  });
  base.requiredSubscriptions = base.providers.length;
  base.integrations = structuredClone(catalog.integrationGuides[`${base.providers.length > 0}:${downloads === true}`]);
  base.integrations.subscriptions = base.providers.map(p => ({ id: p.id, name: p.name, tier: p.selectedPlan.name, url: p.pricingUrl }));
  base.useUsenet = useUsenet;
  base.blockers = useUsenet && !base.providers.some(provider => provider.selectedPlan.usenet) ? ['usenet-requires-capable-selected-plan'] : [];
  const age = now.getTime() - Date.parse(base.pricing.checkedAt);
  if (age < 0 || age > 30 * 86400000) {
    base.pricing.status = 'needs-review';
    for (const provider of base.providers) for (const plan of [...provider.plans, provider.recommendedPlan, provider.selectedPlan]) {
      plan.price = null;
      plan.priceLabel = `Check the current price with ${provider.name}`;
    }
  }
  base.steps = [
    { id: 'pc', title: 'Your PC' }, { id: 'household', title: 'Your household' },
    { id: 'providers', title: 'Your providers' }, { id: 'metadata', title: 'Posters & ratings' },
    { id: 'preferences', title: 'How you watch' }, { id: 'tv', title: 'Your TV' },
    { id: 'summary', title: 'Your plan' },
  ];
  base.recommendations = [
    { id: 'pc-check', label: 'Check Windows, graphics, free space, network and existing media apps', required: true },
    { id: 'native-install', label: 'Install native services into separate, conflict-free locations', required: true },
    { id: 'household', label: 'Create household access and viewer profiles; connect internal apps automatically', required: true },
    { id: 'providers', label: 'Connect and validate each selected provider before recommending a purchase', required: base.providers.length > 0 },
    { id: 'metadata', label: 'Keep built-in posters; add optional ratings only if wanted', required: true },
    { id: 'preferences', label: 'Prefer verified local or cached sources, original audio and matched English subtitles', required: true },
    { id: 'tv-pairing', label: 'Show the server address and device-specific client instructions', required: true },
    { id: 'playback-test', label: 'Test play, seek, resume, audio and subtitles on the TV', required: true },
    { id: 'recovery', label: 'Verify startup, recovery, backup and rollback before calling setup ready', required: true },
    { id: 'downloads', label: 'Add Radarr, Sonarr, indexers and downloads later; enable requests only after a complete test', required: false },
  ].map(item => ({ ...item, status: 'planned-not-run' }));
  base.coverage = { recommendedCombination: ['torbox', 'real-debrid'], routingStatus: 'not-yet-implemented',
    message: 'TorBox plus Real-Debrid is the recommended combination for this setup. Caches overlap; two services cannot guarantee a title or uninterrupted playback.' };
  return base;
}

export function resolveWizardStep(plan, requested) {
  const step = Math.max(0, Math.min(plan.steps.length - 1, Number.isFinite(requested) ? Math.floor(requested) : 0));
  return plan.blockers.length && step > 2 ? 2 : step;
}

export function saveSetupPlan(plan, choices) {
  if (plan.blockers.length) throw new Error('Resolve your provider choice before saving');
  const count = value => Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 6 ? Number(value) : 1;
  const tv = ['androidtv', 'firetv', 'appletv', 'other'].includes(choices.tv) ? choices.tv : 'other';
  return {
    schemaVersion: 2, status: 'preview-plan', installed: false, qualified: false, runtime: plan.runtime,
    household: { televisions: count(choices.televisions), profiles: count(choices.profiles) },
    providers: plan.providers.map(provider => ({ id: provider.id, plan: provider.selectedPlan.id, connected: false })),
    useUsenet: plan.useUsenet,
    sources: { sourceSearch: choices.sourceSearch === true, configured: false, playbackVerified: false },
    metadata: { builtInPosters: true, optionalRatings: ['mdblist', 'omdb'].filter(id => choices[id] === true), connected: false },
    preferences: structuredClone(plan.preferences),
    tv: { device: tv, paired: false, playbackVerified: false },
    downloads: { requestedForLater: choices.downloads === true, enabled: false },
    checklist: structuredClone(plan.recommendations),
  };
}
