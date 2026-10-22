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
    const rows = guide.providers.map(provider => `<section class="provider-plan" aria-labelledby="name-${provider.id}"><div>
      <h2 id="name-${provider.id}">${escape(provider.name)}</h2>
      <div class="plan-controls"><label for="plan-${provider.id}">Plan</label><select id="plan-${provider.id}" data-plan="${provider.id}">${provider.plans.map(plan => `<option value="${plan.id}"${provider.selectedPlan.id === plan.id ? ' selected' : ''}>${escape(plan.name)} — ${escape(price(plan))}</option>`).join('')}</select>
      ${external(provider.pricingUrl, 'View plans', 'button primary')}${external(provider.keyUrl, 'Find my API key', 'button secondary')}</div>
      <p class="hint">${provider.id === 'torbox' ? 'Start with Essential for cached streaming. Pro adds Usenet.' : escape(provider.reason)}</p>
      <details><summary>Plan and account instructions</summary>
      <ol><li>${external(provider.accountUrl, `Open ${provider.name}`)} and sign in to your account.</li>
      <li>Review the selected plan above. Use an existing subscription first.</li>
      <li>${escape(provider.connectionInstructions)}</li><li>${runtime ? 'Paste your API key below and choose Connect account.' : 'In the finished installer, connect this account and wait for a successful account test.'}</li></ol>
      <ul>${provider.notes.map(note => `<li>${escape(note)}</li>`).join('')}</ul>
      <p class="hint">${guide.pricing.status === 'needs-review' ? 'Prices need a fresh review.' : 'Prices reviewed 21 October 2026.'} ${escape(guide.pricing.message)}</p>
      ${external(provider.helpUrl, 'Provider guidance')}</details>${runtime?.providerPanel(provider) || ''}</div></section>`).join('');
    return title('Choose your providers', 'Use one or more services. TorBox + Real-Debrid is the recommended combination.') +
      `<fieldset class="providers"><legend class="sr-only">Streaming providers — choose any combination</legend>${checkboxes}</fieldset>
      <p class="hint local-hint">Uncheck all services to use only your local library.</p>
      <label class="check"><input id="usenet" type="checkbox"${state.useUsenet ? ' checked' : ''}${guide.providers.length ? '' : ' disabled'}><span><strong>I need Usenet</strong><span class="hint">Leave this off unless you already know you need it.</span></span></label>
      ${guide.blockers.length ? `<p id="provider-blocker" class="notice warning" role="alert">${blocker}</p>` : ''}
      <div class="provider-plans">${rows || '<section class="provider-plan"><div><h2>Use your own library</h2><p class="muted">No streaming subscription needed. Import and playback will be available after installation.</p></div></section>'}</div>
      <p class="hint">${runtime ? 'Account checks verify your subscription without starting downloads. Keys are encrypted for your Windows user. Connect AIOStreams below after starting your media apps.' : 'Connection testing is not available in this preview. Wait to buy until the app can validate your accounts.'}</p>
      <p class="hint">Two services can offer different cached sources. Availability and automatic fallback are not yet verified in this project.</p>`;
  }

  function metadataPage(guide) {
    return title('Posters come with your library', 'Start with the built-in movie and TV information. Extra ratings can wait.') +
      `<div class="metadata-row"><h3>Movie and TV posters</h3><p class="muted">Jellyfin has built-in metadata providers. You do not need a personal API key for the basic library.</p>
      <details><summary>If another integration asks for TMDB</summary><p>Sign in, open Settings → API, and follow the developer application steps. Check the usage and attribution requirements.</p>${external(guide.metadata[0].keyUrl, 'Open TMDB API settings')} · ${external(guide.metadata[0].helpUrl, 'TMDB guidance')}</details></div>` +
      guide.metadata.filter(item => item.optional).map(item => `<div class="metadata-row"><label class="check"><input type="checkbox" id="${item.id}"${state[item.id] ? ' checked' : ''}><span><strong>Add ${escape(item.name)} later</strong><span class="hint">Optional · ${escape(item.purpose)}</span></span></label>
      <div class="actions">${external(item.keyUrl, 'Get a free API key')} · ${external(item.helpUrl, 'Setup help')}</div>
      ${state[item.id] ? `<p class="hint">${escape(item.instructions)} This preview does not collect keys or connect the account.</p>` : ''}</div>`).join('') +
      `<div class="notice"><h3>AIOStreams matching and optional plugins</h3>${guide.integrations.keys.filter(item => !['mdblist', 'omdb'].includes(item.id)).map(item => `<details><summary>${escape(item.name)} · ${item.required ? 'Required for your download plan' : item.recommended ? 'Recommended for streaming matching' : 'Optional'}</summary><p>${escape(item.instructions)}</p>${external(item.url, 'Open account / API key page')}</details>`).join('')}</div><p class="hint">${escape(guide.integrations.keyPolicy)}</p>`;
  }

  function preferencesPage() {
    return title('Start with the recommended settings', 'Clear defaults for playback. Downloads can be added later.') +
      list([['Sources', 'Try verified local files and cached instant sources. A finished DVD or HDTV release is fine; a PROPER tag is not required.'],
        ['Audio', 'Prefer the original language of the movie or show.'],
        ['Subtitles', 'Use matched English subtitles when available. Say clearly when a matching track cannot be found.']]) +
      `<label class="check"><input type="checkbox" id="downloads"${state.downloads ? ' checked' : ''}><span><strong>Plan downloads for later</strong><span class="hint">Optional · Keep files for offline viewing using Radarr, Sonarr and a download client.</span></span></label>
      ${state.downloads ? '<div class="notice"><h3>Add downloads after streaming works</h3><ol><li>Choose a download folder and check free space.</li><li>Connect Radarr for movies and Sonarr for TV.</li><li>Connect a download client and any needed indexers.</li><li>Run a complete request-to-library test before enabling requests.</li></ol><p class="hint">This saves your preference only. No apps, accounts, downloads or requests are started.</p></div>' : '<p class="hint">Downloads stay off. Missing instant sources will not silently create download requests.</p>'}`;
  }

  function tvPage() {
    const devices = [['androidtv', 'Android / Google TV'], ['firetv', 'Fire TV'], ['appletv', 'Apple TV'], ['other', 'Another TV or device']];
    const store = { androidtv: 'Open the Play Store on your TV and search for Moonfin.', firetv: 'Search for Moonfin in the Amazon Appstore on your Fire TV.', appletv: 'Open the App Store on your Apple TV and search for Moonfin.', other: 'Check the official Moonfin installation guide or the Jellyfin client list for your device.' };
    return title('Connect your TV', 'Keep your TV and the Windows PC on the same home network.') +
      `<div class="fields"><label>Your TV or streaming device<select id="tv">${devices.map(([id, name]) => `<option value="${id}"${state.tv === id ? ' selected' : ''}>${name}</option>`).join('')}</select></label></div>
      <ol class="tv-steps"><li>${store[state.tv]}</li><li>After installation, use the server address shown by Media Hub. Do not enter localhost on your TV.</li><li>Sign in with the household access created during setup.</li><li>Play a test video. Check seeking, resume, original audio and English subtitles.</li></ol>
      <div class="actions">${external('https://github.com/Moonfin-Client/Moonfin-Core/wiki/Installation', 'Moonfin installation guide', 'button secondary')}${external('https://jellyfin.org/clients/', 'Jellyfin client options')}</div>
      <p class="hint">A server address and pairing are not available in this preview. No TV has been connected or tested.</p>`;
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
      <details open><summary>Recommended setup checklist</summary><ol>${guide.recommendations.filter(item => item.required || state.downloads && item.id === 'downloads').map(item => `<li>${escape(item.label)}</li>`).join('')}</ol></details>
      <div class="notice"><h3>What still needs to happen</h3><p>${runtime ? 'Set up your media apps, connect AIOStreams and optionally connect discovery using the buttons in this guide. Real-account playback and TV pairing still need verification. The download pipeline is not enabled.' : 'This preview has not installed anything or connected an account. The installer, PC checks and TV pairing are still being built.'}</p><p class="hint">Windows Home and startup before sign-in are not yet qualified. Saving a plan does not verify playback.</p></div>`;
  }

  function render({ focus = false, restore = '' } = {}) {
    if (!content.isConnected) return;
    if(runtime?.renderDashboard?.(content,()=>render(),navigate))return;
    const guide = planNow();
    document.getElementById('steps').innerHTML = guide.steps.map((step, index) => `<li><button data-step="${index}"${state.step === index ? ' aria-current="step"' : ''}><span class="step-number">${index + 1}</span>${escape(step.title)}</button></li>`).join('');
    document.getElementById('progress').textContent = `Step ${state.step + 1} of ${guide.steps.length}`;
    if (state.step === 0) content.innerHTML = title('Your media, without the setup maze', 'A guided Windows setup for your library and your TVs.') +
      list([['Keep it on Windows', runtime ? 'Open this local wizard from the Media Hub launcher. No virtual machine or administrator prompt.' : 'The planned app runs as Windows services. No Hyper-V VM, Docker or Linux setup.'],
        ['Choose the services you want', 'Start with TorBox + Real-Debrid for this setup, keep one provider, or use your own local library.'],
        ['Use the recommended defaults', 'Built-in posters, original audio and matched English subtitles. Add ratings and downloads only if wanted.']]) +
      (runtime ? runtime.welcome : `<div class="notice"><h3>This is a setup guide preview</h3><p>Explore your choices and save a plan. PC compatibility, installation and connections are not available here yet.</p><p class="hint">No Windows compatibility check has run. Windows Home and startup before sign-in are still unverified.</p></div>`) +
      `<details><summary>Apps included in the setup plan</summary>${list(guide.integrations.apps.map(app => [escape(app.name) + ' · ' + (app.needed ? 'Included in this plan' : 'Optional'), escape(app.purpose)]))}<p class="hint">Internal app credentials are generated by setup. The TV app is installed on your TV. Inclusion in this list does not mean an app is installed.</p></details>`;
    if (state.step === 1) content.innerHTML = title('Make room for everyone', runtime ? 'Choose your viewer profiles, then create your household below.' : 'Plan your TVs and viewer profiles. Accounts will be created during installation.') +
      `<div class="fields"><label>How many TVs?<select id="televisions">${[1,2,3,4,5,6].map(n => `<option value="${n}"${state.televisions === String(n) ? ' selected' : ''}>${n === 6 ? '6 or more' : n}</option>`).join('')}</select></label>
      <label>Viewer profiles<select id="profiles">${[1,2,3,4,5,6].map(n => `<option value="${n}"${state.profiles === String(n) ? ' selected' : ''}>${n === 6 ? '6 or more' : n}</option>`).join('')}</select></label></div>` +
      `<p class="muted">Each person can have their own watch history. Setup will handle the internal app connections.</p><p class="hint">The number of TVs does not guarantee simultaneous streams. Playback capacity still needs a real test on your PC and providers.</p>`;
    if (state.step === 2) content.innerHTML = providerPage(guide);
    if (state.step === 3) content.innerHTML = metadataPage(guide);
    if (state.step === 4) content.innerHTML = preferencesPage();
    if (state.step === 5) content.innerHTML = tvPage();
    if (state.step === 6) content.innerHTML = summaryPage(guide);
    document.getElementById('back').disabled = state.step === 0;
    const next = document.getElementById('next');
    next.textContent = state.step === 6 ? (runtime ? 'Save setup' : 'Save my plan') : 'Continue';
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
