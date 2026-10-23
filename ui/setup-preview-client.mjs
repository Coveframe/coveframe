export function initializeSetupPreview({ composeSetupPlan, saveSetupPlan, resolveWizardStep, runtime = null }) {
  const catalog = JSON.parse(document.getElementById('guide-data').textContent);
  const state = { step: 0, providers: [{ id: 'torbox' }, { id: 'real-debrid' }], useUsenet: false,
    televisions: '1', profiles: '1', tv: 'androidtv', mdblist: false, omdb: false, downloads: false, sourceSearch: true, ...runtime?.initialState };
  const content = document.getElementById('content');
  const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const external = (url, label, cls = '') => `<a href="${escape(url)}" target="_blank" rel="noopener noreferrer"${cls ? ` class="${cls}"` : ''}>${escape(label)}</a>`;
  const price = plan => plan.price ? new Intl.NumberFormat('en-US', { style: 'currency', currency: plan.price.currency, maximumFractionDigits: 2 }).format(plan.price.amount).replace('.00', '') + ` / ${plan.price.period}` : plan.priceLabel;
  const title = (text, intro) => `<h1 id="page-title" tabindex="-1">${text}</h1><p class="intro">${intro}</p>`;
  const list = rows => `<ul class="rows">${rows.map(([heading, copy]) => `<li><h3>${heading}</h3><p class="muted">${copy}</p></li>`).join('')}</ul>`;
  const planNow = () => composeSetupPlan(catalog, state);
  const blocker = 'Usenet needs TorBox Pro or a Premiumize Premium plan. Change a selected tier, add a supported provider, or turn off Usenet to continue.';

  function providerPage(guide) {
    const checkboxes = [['torbox', 'TorBox'], ['real-debrid', 'Real-Debrid'], ['premiumize', 'Premiumize']].map(([id, label]) => `<label><input type="checkbox" id="provider-${id}" data-provider="${id}"${state.providers.some(item => item.id === id) ? ' checked' : ''}>${label}</label>`).join('');
    const rows = guide.providers.map(provider => `<section class="provider-plan" aria-labelledby="name-${provider.id}">
      <h2 id="name-${provider.id}">${escape(provider.name)}</h2>
      <div class="provider-body"><div class="provider-tier"><label for="plan-${provider.id}">Plan</label><select id="plan-${provider.id}" data-plan="${provider.id}">${provider.plans.map(plan => `<option value="${plan.id}"${provider.selectedPlan.id === plan.id ? ' selected' : ''}>${escape(plan.name)} — ${escape(price(plan))}</option>`).join('')}</select>
      <p class="hint">${provider.id === 'torbox' ? 'Essential is the recommended starting point.' : provider.id === 'real-debrid' ? 'Use your existing Premium subscription.' : escape(provider.reason)}</p>
      ${external(provider.pricingUrl, 'View plans')}${!runtime ? ' · '+external(provider.keyUrl, 'Find my API key') : ''}</div>
      ${runtime?.providerPanel(provider) || ''}</div>
      <details><summary>Plan and account help</summary>
      <ol><li>${external(provider.accountUrl, `Open ${provider.name}`)} and sign in to your account.</li>
      <li>Review the selected plan above. Use an existing subscription first.</li>
      <li>${escape(provider.connectionInstructions)}</li><li>${runtime ? 'Paste your API key below and choose Connect account.' : 'In the finished installer, connect this account and wait for a successful account test.'}</li></ol>
      <ul>${provider.notes.map(note => `<li>${escape(note)}</li>`).join('')}</ul>
      <p class="hint">${guide.pricing.status === 'needs-review' ? 'Prices need a fresh review.' : 'Prices reviewed 21 October 2026.'} ${escape(guide.pricing.message)}</p>
      ${external(provider.helpUrl, 'Provider guidance')}</details></section>`).join('');
    return title('Choose your providers', 'Start with TorBox + Real-Debrid. Connect one or both.') +
      `<fieldset class="providers"><legend class="sr-only">Streaming providers — choose any combination</legend>${checkboxes}</fieldset>
      <p class="hint local-hint">Uncheck all services to use only your local library.</p>
      ${guide.blockers.length ? `<p id="provider-blocker" class="notice warning" role="alert">${blocker}</p>` : ''}
      <div class="provider-plans">${rows || '<section class="provider-plan"><div><h2>Use your own library</h2><p class="muted">No streaming subscription needed. Import and playback will be available after installation.</p></div></section>'}</div>
      <details><summary>Privacy & advanced options</summary><p class="hint">${runtime ? 'Account checks verify subscriptions without starting downloads. Keys are encrypted for your Windows user.' : 'Connection testing is not available in this preview. Wait to buy until the app can validate your accounts.'}</p><label class="check"><input id="usenet" type="checkbox"${state.useUsenet ? ' checked' : ''}${guide.providers.length ? '' : ' disabled'}><span>Plan for Usenet<span class="hint">Requires TorBox Pro or a supported Premiumize plan. Not connected by this preview.</span></span></label><p class="hint">Two providers do not guarantee every title or automatic fallback.</p></details>`;
  }

  function metadataPage(guide) {
    return title('Posters come with your library', 'Start with the built-in movie and TV information. Extra ratings can wait.') +
      `<div class="notice included-panel"><h2>You're covered</h2><p>Movie and TV posters, descriptions and cast information come from Jellyfin's built-in providers.</p><p class="hint">No personal API key needed for your basic library. Continue with the defaults.</p></div><details class="optional-options"><summary>Extra ratings & API key guides <span class="hint">Optional</span></summary><div class="metadata-row"><h3>TMDB</h3>
      <details><summary>If another integration asks for TMDB</summary><p>Sign in, open Settings → API, and follow the developer application steps. Check the usage and attribution requirements.</p>${external(guide.metadata[0].keyUrl, 'Open TMDB API settings')} · ${external(guide.metadata[0].helpUrl, 'TMDB guidance')}</details></div>` +
      guide.metadata.filter(item => item.optional).map(item => `<div class="metadata-row"><label class="check"><input type="checkbox" id="${item.id}"${state[item.id] ? ' checked' : ''}><span><strong>Add ${escape(item.name)} later</strong><span class="hint">Optional · ${escape(item.purpose)}</span></span></label>
      <div class="actions">${external(item.keyUrl, 'Get a free API key')} · ${external(item.helpUrl, 'Setup help')}</div>
      ${state[item.id] ? `<p class="hint">${escape(item.instructions)} This choice is saved for later; it does not connect the account.</p>` : ''}</div>`).join('') +
      `<div class="metadata-row"><h3>Other integrations</h3>${guide.integrations.keys.filter(item => !['mdblist', 'omdb'].includes(item.id)).map(item => `<details><summary>${escape(item.name)}</summary><p>${escape(item.instructions)}</p>${external(item.url, 'Open account / API key page')}</details>`).join('')}</div><p class="hint">${escape(guide.integrations.keyPolicy)}</p></details>`;
  }

  function preferencesPage() {
    return title('Start with the recommended settings', 'Clear defaults for playback. Downloads can be added later.') +
      list([['Cached sources', 'Watch from an available cached source or your own local files.'],
        ['Original audio', 'Keep the original language of the movie or show.'],
        ['English subtitles', 'Use a matching English track when available.']]) +
      `<label class="check"><input type="checkbox" id="downloads"${state.downloads ? ' checked' : ''}><span><strong>Plan downloads for later</strong><span class="hint">Optional · Keep files for offline viewing using Radarr, Sonarr and a download client.</span></span></label>
      ${state.downloads ? '<p class="notice">Saved for later. Settings → Optional downloads explains Radarr, Sonarr and Decypharr before you install or run them.</p>' : '<p class="hint">Downloads stay off. You can add them in Settings anytime.</p>'}`;
  }

  function tvPage() {
    const devices = [['androidtv', 'Android / Google TV'], ['firetv', 'Fire TV'], ['appletv', 'Apple TV'], ['other', 'Another TV or device']];
    const store = { androidtv: 'Open the Play Store on your TV and search for Moonfin.', firetv: 'Search for Moonfin in the Amazon Appstore on your Fire TV.', appletv: 'Open the App Store on your Apple TV and search for Moonfin.', other: 'Check the official Moonfin installation guide or the Jellyfin client list for your device.' };
    return title('Watch on your TV', runtime?'Connect your home network, then sign in to Moonfin.':'Choose your device. The offline preview cannot enable TV access.') +
      `<div class="fields"><label>Your TV or streaming device<select id="tv">${devices.map(([id, name]) => `<option value="${id}"${state.tv === id ? ' selected' : ''}>${name}</option>`).join('')}</select></label></div>
      ${runtime?'':`<details><summary>TV setup guide</summary><p>Keep both devices on the same home network.</p><ol class="tv-steps"><li>${store[state.tv]}</li><li>Use the PC's network address. Localhost works only on the PC itself.</li><li>Sign in with your household profile.</li><li>Test playback, seeking, resume, audio and subtitles.</li></ol>
      <div class="actions">${external('https://github.com/Moonfin-Client/Moonfin-Core/wiki/Installation', 'Moonfin installation guide', 'button secondary')}${external('https://jellyfin.org/clients/', 'Jellyfin client options')}</div>
      <p class="hint">No TV connection has been tested by this preview.</p></details>`}`;
  }

  function summaryPage(guide) {
    const saved = saveSetupPlan(guide, state);
    const rows = [
      ['Windows setup', runtime ? 'Local web wizard. No virtual machine.' : 'Native Windows services. No virtual machine.'],
      ['Household', `${saved.household.televisions} TV(s), ${saved.household.profiles} viewer profile(s)`],
      ['Streaming', guide.providers.length ? guide.providers.map(provider => `${provider.name} ${provider.selectedPlan.name} — ${price(provider.selectedPlan)}`).join('; ') : 'Local library only — no subscription'],
      ['Usenet', guide.useUsenet ? 'Requested through a selected capable plan; not connected yet.' : 'Off'],
      ['Posters & ratings', `Built-in posters${saved.metadata.optionalRatings.length ? '; add ' + saved.metadata.optionalRatings.join(' and ') + ' later' : '; no extra ratings account'}`],
      ['Audio & subtitles', 'Original audio. English subtitles when a matching track is available.'],
      ['Downloads', state.downloads ? 'Add Radarr, Sonarr and a download client later. Currently off.' : 'Off. Optional after streaming works.'],
    ];
    return title('Your setup plan', runtime ? 'Save these choices on this PC and return whenever you need.' : 'Review your choices. Save a plan to keep these details for the installer.') +
      `<dl class="plan">${rows.map(([key, value]) => `<div><dt>${key}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl>
      <details><summary>Full setup checklist</summary><ol>${guide.recommendations.filter(item => item.required || state.downloads && item.id === 'downloads').map(item => `<li>${escape(item.label)}</li>`).join('')}</ol></details>
      <p class="hint">${runtime ? 'Saving keeps your choices and opens Dashboard. It does not start more apps or enable downloads.' : 'Saving a plan does not install apps or connect accounts.'}</p><details><summary>Preview limitations</summary><p class="hint">TV network access, Windows Home and startup before sign-in are not yet qualified. Saving choices does not verify playback.</p></details>`;
  }

  function render({ focus = false, restore = '' } = {}) {
    if (!content.isConnected) return;
    if(runtime?.renderDashboard?.(content,()=>render(),navigate))return;
    const guide = planNow();
    document.getElementById('steps').innerHTML = guide.steps.map((step, index) => `<li><button data-step="${index}"${state.step === index ? ' aria-current="step"' : ''}><span class="step-number">${index + 1}</span><span>${escape(step.title)}</span></button></li>`).join('');
    document.getElementById('progress').innerHTML = `<span>Step ${state.step + 1} of ${guide.steps.length}</span><progress aria-label="Setup position" max="${guide.steps.length}" value="${state.step + 1}"></progress>`;
    if (state.step === 0) content.innerHTML = title('Your media. A simpler setup.', 'A few guided steps to your own movie and TV library.') +
      list([['Create your household', 'Set up Jellyfin and Moonfin with separate watch histories.'],
        ['Connect your sources', 'Use TorBox + Real-Debrid, one provider, or your own files.'],
        ['Make it yours', 'Keep the recommended defaults. Customize anytime in Settings.']]) +
      (runtime ? runtime.welcome : `<div class="notice"><h3>This is a setup guide preview</h3><p>Explore your choices and save a plan. PC compatibility, installation and connections are not available here yet.</p><p class="hint">No Windows compatibility check has run. Windows Home and startup before sign-in are still unverified.</p></div>`) +
      `<details><summary>Apps included in the setup plan</summary>${list(guide.integrations.apps.map(app => [escape(app.name) + ' · ' + (app.needed ? 'Included in this plan' : 'Optional'), escape(app.purpose)]))}<p class="hint">Internal app credentials are generated by setup. The TV app is installed on your TV. Inclusion in this list does not mean an app is installed.</p></details>`;
    if (state.step === 1) content.innerHTML = title('Make room for everyone', runtime ? 'Each viewer gets their own watch history.' : 'Choose your TVs and viewer profiles for the setup plan.') +
      `<div class="fields"><label>How many TVs?<select id="televisions">${[1,2,3,4,5,6].map(n => `<option value="${n}"${state.televisions === String(n) ? ' selected' : ''}>${n === 6 ? '6 or more' : n}</option>`).join('')}</select></label>
      <label>Viewer profiles<select id="profiles">${[1,2,3,4,5,6].map(n => `<option value="${n}"${state.profiles === String(n) ? ' selected' : ''}>${n === 6 ? '6 or more' : n}</option>`).join('')}</select></label></div>` +
      `<details><summary>About profiles & simultaneous streams</summary><p class="hint">Setup connects your media apps automatically. Playback on several TVs at once depends on your PC and provider limits; the number selected here does not guarantee capacity.</p></details>`;
    if (state.step === 2) content.innerHTML = providerPage(guide);
    if (state.step === 3) content.innerHTML = metadataPage(guide);
    if (state.step === 4) content.innerHTML = preferencesPage();
    if (state.step === 5) content.innerHTML = tvPage();
    if (state.step === 6) content.innerHTML = summaryPage(guide);
    document.getElementById('back').disabled = state.step === 0;
    const next = document.getElementById('next');
    next.textContent = state.step === 6 ? (runtime ? 'Save & open Dashboard' : 'Save my plan') : state.step === 0 ? 'Let’s get started' : 'Continue';
    const nextStep = document.getElementById('next-step');
    if(nextStep) nextStep.textContent = state.step === 6 ? 'You can change these choices later' : `Next: ${guide.steps[state.step + 1].title}`;
    next.disabled = state.step === 2 && guide.blockers.length > 0;
    if (next.disabled) next.setAttribute('aria-describedby', 'provider-blocker');
    else next.removeAttribute('aria-describedby');
    runtime?.decorate(content, state, guide, () => render());
    if (focus) document.getElementById('page-title').focus();
    if (restore) document.getElementById(restore)?.focus();
  }

  function navigate(step) {
    if (!content.isConnected) return;
    runtime?.showGuide?.();
    state.step = resolveWizardStep(planNow(), step);
    if (state.step !== step) document.getElementById('announcement').textContent = blocker;
    render({ focus: true });
  }
  document.getElementById('steps').addEventListener('click', event => {
    const step = event.target.closest('[data-step]');
    if (step) navigate(Number(step.dataset.step));
  });
  content.addEventListener('change', event => {
    const target = event.target;
    if (target.dataset.provider) {
      if (target.checked) state.providers.push({ id: target.dataset.provider });
      else state.providers = state.providers.filter(item => item.id !== target.dataset.provider);
      if (!state.providers.length) state.useUsenet = false;
    } else if (target.dataset.plan) state.providers.find(item => item.id === target.dataset.plan).plan = target.value;
    else if (target.id === 'usenet') state.useUsenet = target.checked;
    else if (['mdblist', 'omdb', 'downloads', 'sourceSearch'].includes(target.id)) state[target.id] = target.checked;
    else if (['televisions', 'profiles', 'tv'].includes(target.id)) state[target.id] = target.value;
    else return;
    render({ restore: target.id });
  });
  document.getElementById('back').addEventListener('click', () => navigate(state.step - 1));
  document.getElementById('next').addEventListener('click', async () => {
    if (state.step < 6) return navigate(state.step + 1);
    const plan = saveSetupPlan(planNow(), state);
    if (runtime) return runtime.save(state);
    const url = URL.createObjectURL(new Blob([JSON.stringify(plan, null, 2) + '\n'], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'media-hub-setup-plan.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    document.getElementById('announcement').textContent = 'Your browser was asked to save the plan. No installation or account connection has happened.';
  });
  render();
}
