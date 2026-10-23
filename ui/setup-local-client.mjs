// Only embedded in the loopback app, never in exported offline previews.
export async function createLocalSetupRuntime() {
  const token = document.querySelector('meta[name="media-hub-token"]').content;
  const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  async function api(path, data) {
    const response = await fetch(path, { method: data === undefined ? 'GET' : 'POST',
      headers: { 'x-media-hub-token': token, ...(data === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    const result = await response.json();
    if (!response.ok) throw Error(result.message || result.error || 'Could not complete this action. Try again.');
    return result;
  }
  let current;
  try { current = await api('/api/state'); }
  catch { document.getElementById('content').textContent = 'Could not load setup. Close this page and open Media Hub again.'; throw Error('Setup unavailable'); }
  let accounts = current.accounts;
  let media = current.media;
  let sources = current.sources;
  let metadata = current.metadata;
  let discovery = current.discovery;
  const tvScreen=createTvSetup({api,getMedia:()=>media,onMedia:value=>{media=value;},getContext:()=>({accounts,sources,discovery})});
  const hub=createHubDashboard({api,initial:current,onState:latest=>{
    accounts=latest.accounts;media=latest.media;sources=latest.sources;metadata=latest.metadata;discovery=latest.discovery;
  }});
  const metadataMessages = {};
  let poll;
  const messages = {};
  let busy = false;
  const saved = current.plan;
  const initialState = saved ? { providers: saved.providers.map(({ id, plan }) => ({ id, plan })), useUsenet: saved.useUsenet,
    televisions: String(saved.household.televisions), profiles: String(saved.household.profiles), tv: saved.tv.device,
    mdblist: saved.metadata.optionalRatings.includes('mdblist'), omdb: saved.metadata.optionalRatings.includes('omdb'), downloads: saved.downloads.requestedForLater, sourceSearch: saved.sources?.sourceSearch === true } : {};
  if(media.savedProfileCount) initialState.profiles=String(media.savedProfileCount);
  const working = status => status && !['not-started', 'stopped', 'failed', 'running'].includes(status.phase);
  function refresh(render) {
    clearTimeout(poll);
    poll = setTimeout(async () => {
      try {
        const latest = await api('/api/state'); media = latest.media; sources = latest.sources; discovery = latest.discovery;
        render();
        if (working(media) || working(sources) || working(discovery)) refresh(render);
      } catch { const announcement=document.getElementById('announcement'); if(announcement) announcement.textContent = 'Could not read setup progress. Reopen Media Hub to continue.'; }
    }, 1000);
  }
  document.addEventListener('coveframe:closed',()=>{busy=true;clearTimeout(poll);});
  document.getElementById('stop-apps').onclick=()=>{if(!busy)hub.lifecycle('/api/apps/stop');};
  document.getElementById('stop-setup').onclick=()=>{if(!busy)hub.lifecycle('/api/stop');};
  return {
    initialState,
    renderDashboard:(content,render,navigate)=>hub.render(content,render,navigate),
    showGuide:()=>hub.showGuide(),
    welcome: '<div class="notice welcome-note"><h2>On your PC. In your control.</h2><p>Apps run locally while you are signed in. Start with streaming; downloads and extra ratings can wait.</p><p class="hint">Preview software · no virtual machine needed.</p></div>',
    providerPanel(provider) {
      if (!['torbox', 'real-debrid'].includes(provider.id)) return '<p class="hint">Premiumize connection support is coming later. You can keep it in your plan.</p>';
      const account = accounts[provider.id];
      const label = account.configured ? account.verifiedThisSession ? account.active ? 'Connected' : 'Check subscription' : 'Key saved' : 'Not connected';
      const mismatch = account.configured && account.plan !== provider.selectedPlan.id;
      return `<div class="account-connect"><p class="provider-status${account.configured?' is-saved':''}${messages[provider.id]?' is-message':''}" role="status">${escape(messages[provider.id] || label)}</p>
        ${account.configured ? '<details><summary>Manage connection</summary>' : ''}
        ${mismatch ? `<p class="hint">Your account uses ${escape(account.plan || 'unknown')}. Selecting a plan here does not change your subscription.${guideUsenetWarning(account, provider)}</p>` : ''}
        ${account.expiresAt ? `<p class="hint">Expires ${escape(new Date(account.expiresAt).toLocaleDateString())}</p>` : ''}
        <label for="key-${provider.id}">${account.configured ? 'Replace API key' : 'API key'}</label>
        <input type="password" id="key-${provider.id}" autocomplete="off" spellcheck="false" maxlength="4096" aria-describedby="key-help-${provider.id}">
        <p class="hint" id="key-help-${provider.id}"><a href="${escape(provider.keyUrl)}" target="_blank" rel="noopener noreferrer">Find my API key</a> · Clears after connecting.</p>
        <div class="actions"><button class="primary" data-account="${provider.id}" data-action="connect"${busy ? ' disabled' : ''}>${busy ? 'Please wait…' : 'Connect account'}</button>
        ${account.configured ? `<button class="secondary" data-account="${provider.id}" data-action="recheck"${busy ? ' disabled' : ''}>Recheck</button><button class="secondary" data-account="${provider.id}" data-action="disconnect"${busy ? ' disabled' : ''}>Disconnect</button>` : ''}</div>${account.configured ? '</details>' : ''}</div>`;
    },
    decorate(content, state, guide, render) {
      if(state.step===5)tvScreen.render(content,{...state,providers:guide.providers.map(x=>({id:x.id,plan:x.selectedPlan.id}))},render);
      if (working(media) || working(sources) || working(discovery)) refresh(render);
      if(state.step===1 && media.canResume) {
        const profiles=document.getElementById('profiles');
        if(profiles){profiles.disabled=true;profiles.title='This household is already created. Manage additional users in Jellyfin.';}
      }
      const mediaSection = document.createElement('section');
      mediaSection.className = 'notice';
      if (state.step === 1) {
        mediaSection.innerHTML = `<h2>${media.canResume?'Your household is saved':'Create your household'}</h2><p role="status">${escape(working(media)||media.phase==='failed'?media.message:media.phase==='running'?'Your media apps are running.':'Jellyfin keeps your library. Moonfin is where you watch.')}</p>`;
        if (media.phase === 'running') {
          mediaSection.innerHTML += `<p class="hint">Profiles: ${media.profiles.map(escape).join(', ')}.</p><div class="actions"><a class="button secondary" href="${escape(media.moonfinUrl)}" target="_blank" rel="noopener noreferrer">Open Moonfin on this PC</a><a href="${escape(media.url)}" target="_blank" rel="noopener noreferrer">Jellyfin dashboard</a></div><p class="hint">${media.network?.phase==='running'?'Home TV access is on.':'Enable home TV access on Your TV.'} Stop all apps pauses the server.</p>`;
        } else if (state.step === 1 && !working(media) && media.canResume) {
          mediaSection.innerHTML += '<p>Your profiles and password are saved on this PC.</p><button id="resume-media" class="primary">Start my media apps</button>';
        } else if (state.step === 1 && !working(media)) {
          mediaSection.innerHTML += `<p class="hint">Downloads Jellyfin + the Moonbase plugin (about 275 MB) into Coveframe's private app folder.</p><div class="fields"><label>Household name<input id="household-name" autocomplete="username" maxlength="40" value="Household" required></label><label>Household password<input id="household-password" type="password" autocomplete="new-password" minlength="12" maxlength="256" required aria-describedby="household-password-help"></label></div><p class="hint" id="household-password-help">At least 12 characters. Your viewer profiles share this password.</p><button id="setup-media" class="primary">Create household & install apps</button><details><summary>What gets installed?</summary><p class="hint">A separate Jellyfin 12.2 server and Moonbase 2.4 plugin. Existing media servers are not used. Viewer profiles have separate watch history and cannot administer the server. Setup creates a private administrator credential.</p></details>`;
        }
        content.append(mediaSection);
        const resume = document.getElementById('resume-media');
        if (resume) resume.onclick = async () => {
          resume.disabled = true;
          try { await api('/api/media/resume', {}); media = (await api('/api/state')).media; render(); refresh(render); }
          catch (error) { document.getElementById('announcement').textContent = error.message; resume.disabled = false; }
        };
        const start = document.getElementById('setup-media');
        if (start) start.onclick = async () => {
          const name = document.getElementById('household-name').value.trim();
          const input = document.getElementById('household-password');
          const password = input.value;
          if (password.length < 12) { input.setCustomValidity('Use a password with at least 12 characters.'); input.reportValidity(); return; }
          input.setCustomValidity(''); input.value = '';
          start.disabled = true;
          try {
            await api('/api/media/start', { name, password, profiles: Number(state.profiles) });
            media = (await api('/api/state')).media;
            refresh(render); render();
          } catch (error) { media = { phase: 'failed', message: error.message }; render(); }
        };
      }
      if (state.step === 2 && guide.providers.length) {
        const sourceSection = document.createElement('section'); sourceSection.className = 'notice';
        const ready = media.phase === 'running' && guide.providers.every(p => accounts[p.id]?.configured && accounts[p.id]?.active);
        sourceSection.innerHTML = `<div class="section-heading"><h2>Connect your library to your sources</h2><span class="status-pill">AIOStreams</span></div><p class="hint">TorBox checks cached searches. Real-Debrid plays completed titles in your cloud library.</p><p role="status">${escape(working(sources)||sources.phase==='failed'?sources.message:sources.phase==='running'?'Sources connected.':'Not connected yet.')}</p>${!ready ? '<p class="hint">Create your household and connect accounts above first.</p>' : ''}<button id="setup-sources" class="secondary"${!ready || working(sources) || busy ? ' disabled' : ''}>${sources.phase === 'running' ? 'Update connections' : 'Connect AIOStreams'}</button><details><summary>Source search & privacy</summary><label class="check"><input type="checkbox" id="sourceSearch"${state.sourceSearch ? ' checked' : ''}><span>Search public indexes<span class="hint">Sends title names and IDs to Knaben.</span></span></label><p class="hint">Provider keys go directly from this PC to TorBox or Real-Debrid. AIOStreams uses a local connection token. Unknown Real-Debrid sources stay hidden; setup does not use a third-party key relay.</p></details>`;
        content.append(sourceSection);
        if (sources.fixture) sourceSection.insertAdjacentHTML('afterbegin','<p class="warning">QA fixture: provider checks and AIO source results are simulated. No real provider key or playback is being tested.</p>');
        document.getElementById('setup-sources').onclick = async () => {
          document.getElementById('setup-sources').disabled = true;
          try { await api('/api/sources/start', { providers: guide.providers.map(p => p.id), sourceSearch: state.sourceSearch === true });
            sources = (await api('/api/state')).sources; render(); refresh(render); }
          catch (error) { document.getElementById('announcement').textContent = error.message; render(); }
        };
      }
      if (state.step === 4) {
        const section=document.createElement('section');section.className='notice';
        section.innerHTML=`<div class="section-heading"><h2>Find your next watch</h2><span class="status-pill">Optional · Seerr</span></div><p>Search movies and TV by name. No extra subscription or personal API key needed.</p><p class="hint" role="status">${escape(working(discovery)||discovery?.phase==='failed'?discovery.message:discovery?.phase==='running'?'Discovery connected.':media.phase==='running'?'Ready to connect.':'Start your media apps to connect discovery.')}</p><button id="setup-discovery" class="secondary"${media.phase!=='running'||working(discovery)||busy?' disabled':''}>${discovery?.phase==='running'?'Update discovery connection':'Connect discovery'}</button><details><summary>How discovery works</summary><p class="hint">After saving, open Find titles to add a movie or aired TV season. For Moonfin browsing, open Settings → Integrations → Seerr and sign in with your household profile once. Seerr download requests stay off. Optional downloads are in Coveframe Settings.</p></details>`;
        content.append(section);
        document.getElementById('setup-discovery').onclick=async()=>{
          document.getElementById('setup-discovery').disabled=true;
          try{await api('/api/discovery/start',{});discovery=(await api('/api/state')).discovery;render();refresh(render);}
          catch(error){document.getElementById('announcement').textContent=error.message;render();}
        };
      }
      if (state.step === 3) {
        const section = document.createElement('section'); section.className = 'metadata-connections';
        section.innerHTML = '<h3>Your own keys</h3><p class="hint">Saved locally for Moonbase. TMDB also supplies AIOStreams title matching. Saving does not verify quota or subscription.</p>' + ['tmdb','mdblist'].map(id => {
          const label = id === 'tmdb' ? 'TMDB' : 'MDBList';
          return `<details><summary>${label}: ${metadata[id].configured ? 'key saved' : 'optional, no key saved'}</summary><p>${id === 'tmdb' ? 'Copy the API key (v3 auth) from the TMDB API page linked above. Use your own approved application details and follow TMDB attribution requirements.' : 'Copy your own MDBList key from Preferences using the link above. Start with the free account.'}</p><label for="metadata-${id}">${label} API key</label><input id="metadata-${id}" type="password" autocomplete="off" spellcheck="false" maxlength="256"><div class="actions"><button data-metadata="${id}" data-action="connect" class="secondary"${busy ? ' disabled' : ''}>Save ${label} key</button>${metadata[id].configured ? `<button data-metadata="${id}" data-action="disconnect" class="secondary"${busy ? ' disabled' : ''}>Remove ${label} key</button>` : ''}</div><p role="status">${escape(metadataMessages[id] || '')}</p></details>`;
        }).join('') + '<p class="hint">Changing a key clears the AIOStreams connection. Reconnect it on Your providers afterward.</p>';
        (content.querySelector('.optional-options')||content).append(section);
        for (const button of section.querySelectorAll('[data-metadata]')) button.onclick = async () => {
          if (busy) return;
          const id = button.dataset.metadata, action = button.dataset.action;
          const input = document.getElementById(`metadata-${id}`), credential = input.value.trim();
          if (action === 'connect' && !credential) { input.focus(); return; }
          input.value = ''; busy = true; render();
          try { const result = await api(`/api/metadata/${id}/${action}`, action === 'connect' ? { credential } : {});
            metadataMessages[id] = action === 'disconnect' ? 'Saved key removed.' : result.applied ? 'Key saved and applied to Moonbase. Provider access has not been verified.' : 'Key saved. Start your media apps to apply it.';
            const latest = await api('/api/state'); metadata = latest.metadata; sources = latest.sources;
          } catch (error) { metadataMessages[id] = error.message; }
          finally { busy = false; render(); }
        };
      }
      if (state.step === 4 && sources.phase === 'running') {
        const section = document.createElement('section'); section.className = 'advanced-library';
        section.innerHTML = '<h2>Add a streaming title to Jellyfin</h2><p>Use an IMDb title ID, for example tt followed by its digits. This adds a library link; it does not download the film or prove a cached source exists.</p><label>Title<input id="library-title" maxlength="200"></label><label>IMDb ID<input id="library-imdb" placeholder="tt…" maxlength="14"></label><label>Movie or TV episode<select id="library-type"><option value="movie">Movie</option><option value="series">TV episode</option></select></label><p class="hint">For a TV episode, enter its season and episode numbers.</p><div class="fields"><label>Season<input id="library-season" type="number" min="0" max="9999" value="1"></label><label>Episode<input id="library-episode" type="number" min="1" max="99999" value="1"></label></div><button id="add-library" class="secondary">Add to my library</button><p id="library-result" role="status"></p>';
        section.innerHTML = '<details><summary>Advanced: add a title by IMDb ID</summary><p>For everyday browsing, use Find titles after saving setup.</p>' + section.innerHTML + '</details>';
        content.append(section);
        document.getElementById('add-library').onclick = async () => {
          const button = document.getElementById('add-library'); button.disabled = true;
          const info = { title:document.getElementById('library-title').value.trim(), imdbId:document.getElementById('library-imdb').value.trim(), type:document.getElementById('library-type').value };
          if (info.type === 'series') { info.season = Number(document.getElementById('library-season').value); info.episode = Number(document.getElementById('library-episode').value); }
          try { await api('/api/library/add',info); document.getElementById('library-result').textContent = 'Added. Jellyfin is scanning the library. Playback still needs a real test.'; }
          catch (error) { document.getElementById('library-result').textContent = error.message; }
          button.disabled = false;
        };
      }
      for (const button of content.querySelectorAll('[data-account]')) button.onclick = async () => {
        if (busy) return;
        const id = button.dataset.account;
        const action = button.dataset.action;
        const input = document.getElementById(`key-${id}`);
        const credential = input?.value.trim();
        if (action === 'connect' && !credential) { input.focus(); return; }
        if (input) input.value = '';
        busy = true;
        messages[id] = action === 'disconnect' ? 'Removing saved key…' : 'Checking your account…';
        render();
        try {
          const result = await api(`/api/accounts/${id}/${action}`, action === 'connect' ? { credential } : {});
          messages[id] = action === 'disconnect' ? 'Disconnected. The saved key was removed from this PC.' : result.message || 'Account checked and saved.';
        } catch (error) { messages[id] = error.message; }
        try { accounts = (await api('/api/state')).accounts; } catch { messages[id] += ' Reopen setup to refresh account status.'; }
        busy = false;
        render();
      };
      if (state.step === 6) {
        const section = document.createElement('div');
        section.className = 'notice';
        section.innerHTML = '<h2>Connections at a glance</h2><ul class="account-summary"><li><strong>Household</strong><span>'+(media.canResume?'Saved on this PC':'Not created yet')+'</span></li>' + guide.providers.map(p => `<li><strong>${escape(p.name)}</strong><span>${accounts[p.id]?.configured ? 'Key saved' : 'Not connected'}</span></li>`).join('') + '<li><strong>AIOStreams</strong><span>'+(sources.phase==='running'?'Connected':'Not running')+'</span></li></ul><p class="hint">Use the step list to change anything. Dashboard shows what to start next.</p>';
        content.append(section);
      }
    },
    async save(state) {
      if (busy) return;
      const button = document.getElementById('next');
      button.disabled = true;
      button.textContent = 'Saving…';
      try { await api('/api/plan', state); hub.showHome(await api('/api/state')); document.getElementById('announcement').textContent = 'Setup saved on this PC. Open Dashboard to continue.';
        button.textContent = 'Saved on this PC'; }
      catch (error) { document.getElementById('announcement').textContent = error.message; button.textContent = 'Try saving again'; }
      finally { button.disabled = false; }
    },
  };
}

function guideUsenetWarning(account, provider) {
  return provider.selectedPlan.usenet && !account.usenet ? ' This account does not currently provide Usenet.' : '';
}
