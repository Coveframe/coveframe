// Local authenticated title search and optional downloads; credentials never persist in the browser.
export function confirmDownloadApps({document=globalThis.document,configured=false}={}){
  const dialog=document.createElement('dialog');
  dialog.className='download-confirmation';dialog.setAttribute('aria-labelledby','download-confirm-title');
  dialog.setAttribute('aria-describedby','download-confirm-description');
  dialog.innerHTML=`<h2 id="download-confirm-title">${configured?'Start download apps?':'Install and start download apps?'}</h2>
    <p id="download-confirm-description">This runs Radarr, Sonarr, Prowlarr and Decypharr.exe on your PC.</p>
    <p>Decypharr connects Radarr and Sonarr to TorBox + Real-Debrid. It comes from the <a href="https://github.com/sirrobot01/decypharr/releases/tag/v2.7" target="_blank" rel="noopener noreferrer">official GitHub release</a> and is unsigned.</p>
    <p class="hint">${configured?'Existing download jobs may resume.':'No movie or show is requested during setup.'} Cancel keeps these apps off.</p>
    <div class="actions"><button data-cancel class="secondary" autofocus>Cancel</button><button data-confirm class="primary">${configured?'Start download apps':'Install & start'}</button></div>`;
  return new Promise(resolve=>{
    dialog.addEventListener('close',()=>{const approved=dialog.returnValue==='approved';dialog.remove();resolve(approved);},{once:true});
    dialog.querySelector('[data-cancel]').onclick=()=>dialog.close('');
    dialog.querySelector('[data-confirm]').onclick=()=>dialog.close('approved');
    document.body.append(dialog);dialog.showModal();dialog.querySelector('[data-cancel]').focus();
  });
}
export function createLibraryScreens({api,getState,onState,onHome,onDownloads,onAccounts}){
  let root,view,stopped=false,busy=false,query='',results=null,selected=null,season,message='';
  const addresses={};let timer,storagePath,providers,confirming=false;
  const working=()=>['preparing','downloading','starting','configuring'].includes(getState().managedDownloads?.phase);
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const alive=()=>!stopped&&root?.isConnected;
  async function run(operation,progress){
    if(busy||stopped)return;busy=true;message=progress;draw();
    try{message=await operation();}catch(error){message=error.message;}
    finally{busy=false;if(alive()){draw();root.querySelector('[role="status"]')?.focus();}}
  }
  async function refresh(){onState(await api('/api/state'));}
  function library(){
    const state=getState(),ready=state.discovery.phase==='running';
    const manager=selected?.type==='movie'?'radarr':'sonarr',download=state.downloads?.[manager];
    return `<h1 id="page-title" tabindex="-1">Find titles</h1><p class="intro">Search by name. Add a movie or an aired TV season to your Jellyfin library.</p>
      ${state.sources.fixture?'<p class="notice warning">UI test: source accounts are simulated. Playback is not being tested.</p>':''}
      <details><summary>How search &amp; playback work</summary><p>Search uses your discovery app and its metadata services. Streaming uses your connected sources. Cached availability is checked when you play.</p></details>
      <p role="status" tabindex="-1">${escape(message)}</p>
      ${!ready?'<div class="notice"><p>Start your media apps and connect discovery from Dashboard first.</p><button id="library-dashboard" class="primary">Go to Dashboard</button></div>':`
      <form id="title-search" class="hub-section"><label for="title-query">Movie or TV show</label><div class="search-controls"><input id="title-query" type="search" minlength="2" maxlength="120" value="${escape(query)}" required placeholder="Search for a title"><button class="primary"${busy?' disabled':''}>${busy?'Working…':'Search'}</button></div></form>
      ${selected?`<section class="hub-section" aria-label="Selected title"><h2>${escape(selected.title)}${selected.year?' ('+selected.year+')':''}</h2><p>${selected.type==='movie'?'Movie':'TV show'}</p>
        ${selected.type==='tv'?`<label for="title-season">Season<select id="title-season"${busy?' disabled':''}>${selected.seasons.map(x=>`<option value="${x.number}"${season===x.number?' selected':''}>${escape(x.name||'Season '+x.number)} · ${x.episodes||0} episodes</option>`).join('')}</select></label><p class="hint">Streaming adds only dated aired episodes in this season. Future episodes need another add later. A Sonarr request monitors the chosen season for files.</p>`:''}
        <div class="actions"><button id="title-add" class="primary"${busy||state.sources.phase!=='running'||state.media.phase!=='running'||selected.type==='tv'&&!season?' disabled':''}>Add ${selected.type==='tv'?'aired season':'movie'} to library</button>
        ${download?.pipelineReady?`<button id="title-download" class="secondary"${busy||state.media.phase!=='running'||selected.type==='tv'&&!season?' disabled':''}>Download ${selected.type==='tv'?'this season':'movie'} with ${manager==='radarr'?'Radarr':'Sonarr'}</button>`:'<button id="title-download-settings" class="secondary">Set up optional downloads</button>'}</div>
        ${state.sources.phase!=='running'?'<p class="notice">Connect saved source accounts from Dashboard to add streaming links. Downloads can be used separately.</p>':''}
        <p class="hint">Adding streaming links never starts a download. Download buttons ask your configured app to search; completion depends on its indexers, download client and available releases.</p></section>`:''}
      ${results!==null?`<section class="hub-section" aria-label="Search results"><h2>Search results</h2>${results.length?'<ul class="title-results">'+results.map((x,i)=>`<li><div><strong>${escape(x.title)}${x.year?' ('+x.year+')':''}</strong><span class="hint">${x.type==='movie'?'Movie':'TV show'}</span><p>${escape(x.overview)}</p></div><button class="secondary" data-title="${i}"${busy?' disabled':''}>Choose ${escape(x.title)}</button></li>`).join('')+'</ul>':'<p>No matching movies or shows. Try a shorter title, check the spelling, or search the original title.</p>'}</section>`:''}`}
      <p class="hint">Metadata from TMDB through Seerr. <a href="https://www.themoviedb.org/" target="_blank" rel="noopener noreferrer">The Movie Database</a>. This product uses the TMDB API but is not endorsed or certified by TMDB.</p>`;
  }
  function downloads(){
    const state=getState(),managed=state.managedDownloads||{},active=managed.phase==='running',pending=working();
    if(providers===undefined)providers=(managed.providers?.length?managed.providers:['torbox','real-debrid']).filter(id=>state.accounts?.[id]?.configured);
    storagePath??=managed.storagePath||'';
    return `<h1 id="page-title" tabindex="-1">Optional downloads</h1><p class="intro">Start with streaming. Add downloads whenever you want local copies.</p>
      <div class="download-choices"><section><h2>Streaming only <span class="hint">Recommended</span></h2><p>Browse and watch in Moonfin with TorBox + Real-Debrid. No Radarr or Sonarr needed.</p><p class="hint">Needs internet and an available source. New episodes aren't saved automatically.</p></section><section><h2>Add Radarr + Sonarr</h2><p>Radarr collects movies. Sonarr watches for new TV episodes. Both organize saved files in Jellyfin.</p><p class="hint">Uses disk space. Files that finish downloading can play offline.</p></section></div>
      ${state.downloads?.fixture?'<p class="notice warning">QA fixture: Radarr and Sonarr responses are simulated. No real download will start.</p>':''}
      <p role="status" tabindex="-1">${escape(message)}</p>
      <section class="hub-section" aria-label="Automatic downloads"><h2>Set up downloads automatically</h2>
      ${managed.fixture?'<p class="notice warning">UI test: provider credentials are omitted. No provider download is being tested.</p>':''}
      <p>Installs four apps on this PC (about 435 MB):</p>
      <ul class="install-apps"><li><a href="https://radarr.video/" target="_blank" rel="noopener noreferrer">Radarr</a><span>Movie requests</span></li><li><a href="https://sonarr.tv/" target="_blank" rel="noopener noreferrer">Sonarr</a><span>TV requests</span></li><li><a href="https://github.com/sirrobot01/decypharr/releases/tag/v2.7" target="_blank" rel="noopener noreferrer">Decypharr.exe</a><span>Downloads through TorBox / Real-Debrid · unsigned</span></li><li><a href="https://prowlarr.com/" target="_blank" rel="noopener noreferrer">Prowlarr</a><span>Source search</span></li></ul>
      <details><summary>Folders, privacy and Windows prompts</summary><p class="hint">Setup uses your connected providers, chooses 1080p, creates movie / TV folders and links them to Jellyfin. Keys stay in private local app files. Knaben receives searches.</p><p class="hint">Apps run while Coveframe is open. Stop all apps stops them and keeps your files. They do not need administrator access or inbound firewall access. If Windows shows a warning, check the app and official source; do not bypass Windows protection.</p><p class="hint">Setup does not request movies or shows. Completed downloads and imports still need testing.</p></details>
      <p role="status" aria-live="polite">${escape(managed.message||'Ready when you want to keep local files.')}</p>
      <form id="automatic-downloads"><fieldset${busy||pending||active?' disabled':''}>
      ${['torbox','real-debrid'].map(id=>`<label class="check"><input type="checkbox" data-download-provider="${id}"${providers.includes(id)?' checked':''}${!state.accounts?.[id]?.configured?' disabled':''}><span>${id==='torbox'?'TorBox':'Real-Debrid'}${!state.accounts?.[id]?.configured?' · connect in Manage accounts first':''}</span></label>`).join('')}
      <details><summary>Media storage folder</summary><label for="automatic-storage">Local media folder<input id="automatic-storage" value="${escape(storagePath)}" maxlength="190" required${managed.configured?' readonly':''}></label><p class="hint">Choose an empty local folder for first setup. Keep this folder for restarts; moving existing files is not automatic.</p></details>
      <button class="primary"${!providers.length||state.media.phase!=='running'?' disabled':''}>${active?'Download apps running':pending?'Setting up downloads…':managed.configured?'Start / repair download apps':'Install & connect these 4 apps'}</button></fieldset></form>
      ${state.media.phase!=='running'?'<p class="notice">Start your media apps from Dashboard first.</p>':''}
      <div class="actions"><button id="download-accounts" class="secondary"${pending?' disabled':''}>Manage accounts</button>${active||pending?'<button id="automatic-stop" class="secondary">Stop download apps</button>':''}<button id="automatic-refresh" class="secondary">Refresh status</button></div>
      <p class="hint">Only cached sources are enabled. Subscriptions do not guarantee a match.</p></section>
      <details><summary>Advanced · existing apps and connection checks</summary>
      ${['radarr','sonarr'].map(id=>{
        const app=id==='radarr'?'Radarr':'Sonarr',s=state.downloads?.[id]||{},defaultUrl='http://127.0.0.1:'+(id==='radarr'?'7878':'8989');
        return `<section class="hub-section" aria-label="${app}"><h2>${app} · ${id==='radarr'?'movies':'TV'}</h2>
          <p>${s.pipelineReady?'Configuration checks passed. Downloads can be requested from Find titles.':s.configured?'Connection saved. Check the items below before downloading.':'Not connected. Skip this if you only want streaming.'}</p>
          ${s.issues?.length?'<ul>'+s.issues.map(x=>'<li>'+escape(x)+'</li>').join('')+'</ul>':''}
          <details><summary>${s.configured?'Change connection':'Connect '+app}</summary><p>Open ${app}, then Settings → General → Security. Copy its API Key. The key disappears from this field after connecting and is encrypted for your Windows user. Stop managed download apps before changing connections.</p>
          <form data-arr="${id}"><fieldset${busy?' disabled':''}><label for="${id}-url">App address<input id="${id}-url" type="url" value="${escape(addresses[id]||s.url||defaultUrl)}" required></label><label for="${id}-key">${app} API key<input id="${id}-key" type="password" maxlength="256" autocomplete="off" spellcheck="false" required></label><button class="primary">Connect ${app}</button></fieldset></form></details>
          ${s.profiles?.length&&s.folders?.length?`<form data-options="${id}"><fieldset${busy?' disabled':''}><div class="fields"><label>Quality profile<select id="${id}-profile"><option value="">Choose a profile</option>${s.profiles.map(x=>`<option value="${x.id}"${s.profileId===x.id?' selected':''}>${escape(x.name)}</option>`).join('')}</select></label><label>Download folder<select id="${id}-folder"><option value="">Choose a folder</option>${s.folders.map(x=>`<option value="${x.id}"${s.folderId===x.id?' selected':''}>${escape(x.path)}</option>`).join('')}</select></label></div><button class="secondary">Save ${app} choices</button></fieldset></form>`:''}
          <div class="actions">${s.configured?`<button data-recheck="${id}" class="secondary"${busy?' disabled':''}>Recheck ${app}</button><button data-disconnect="${id}" class="secondary"${busy?' disabled':''}>Disconnect ${app}</button>`:''}<a class="button secondary" href="${id==='radarr'?'https://wiki.servarr.com/radarr/installation/windows':'https://wiki.servarr.com/sonarr/installation/windows'}" target="_blank" rel="noopener noreferrer">${app} setup instructions</a></div></section>`;
      }).join('')}</details>
      `;
  }
  function draw(){
    clearTimeout(timer);if(!alive())return;root.innerHTML=view==='library'?library():downloads();
    const find=id=>root.querySelector('#'+id);
    if(view==='library'){
      const home=find('library-dashboard');if(home)home.onclick=onHome;
      const form=find('title-search');if(form)form.onsubmit=event=>{event.preventDefault();query=find('title-query').value.trim();run(async()=>{const data=await api('/api/discovery/search',{query});results=data.results;selected=null;return `${results.length} title choices found.`;},'Searching…');};
      root.querySelectorAll('[data-title]').forEach(button=>button.onclick=()=>run(async()=>{const title=results[Number(button.dataset.title)];selected=await api('/api/discovery/title',{type:title.type,id:title.id});season=selected.seasons?.[0]?.number;return 'Title selected. Choose how to add it.';},'Loading title…'));
      const select=find('title-season');if(select)select.onchange=()=>{season=Number(select.value);};
      const action=download=>run(async()=>{
        const result=await api('/api/discovery/'+(download?'download':'add'),{type:selected.type,id:selected.id,...(selected.type==='tv'?{season}:{})});
        await refresh();
        return download?(result.alreadyManaged?'Already managed by your download app. Check its queue or library.':'Download request accepted. Your download app will search for releases; completion is not yet verified.'):`Added ${result.count} streaming ${result.count===1?'link':'links'}. Jellyfin is scanning. Open Moonfin to find the title; playback depends on cached sources.`;
      },download?'Sending download request…':'Adding library links…');
      if(find('title-add'))find('title-add').onclick=()=>action(false);
      if(find('title-download'))find('title-download').onclick=()=>action(true);
      if(find('title-download-settings'))find('title-download-settings').onclick=onDownloads;
    }else{
      find('download-accounts').onclick=onAccounts;
      find('automatic-refresh').onclick=()=>run(async()=>{await refresh();return 'Download status refreshed.';},'Checking status…');
      if(find('automatic-stop'))find('automatic-stop').onclick=()=>run(async()=>{await api('/api/downloads/automatic/stop',{});await refresh();return 'Download apps stopped. Files and setup are kept.';},'Stopping managed download apps…');
      root.querySelectorAll('[data-download-provider]').forEach(input=>input.onchange=()=>{providers=[...root.querySelectorAll('[data-download-provider]:checked')].map(x=>x.dataset.downloadProvider);storagePath=find('automatic-storage').value;draw();});
      find('automatic-downloads').onsubmit=async event=>{
        event.preventDefault();if(busy||confirming||stopped)return;storagePath=find('automatic-storage').value.trim();confirming=true;
        let approved;try{approved=await confirmDownloadApps({configured:getState().managedDownloads?.configured});}finally{confirming=false;}
        if(!approved||!alive())return;
        run(async()=>{await api('/api/downloads/automatic/start',{providers,storagePath});await refresh();return 'Automatic setup started. Progress appears below.';},'Starting automatic setup…');
      };
      if(working())timer=setTimeout(async()=>{if(!alive())return;try{await refresh();draw();}catch{message='Could not refresh setup progress. Use Refresh status.';draw();}},1500);
      root.querySelectorAll('[data-arr]').forEach(form=>form.onsubmit=event=>{
        event.preventDefault();const id=form.dataset.arr,url=find(id+'-url').value.trim(),credential=find(id+'-key').value.trim();find(id+'-key').value='';
        addresses[id]=url;
        run(async()=>{await api(`/api/downloads/${id}/connect`,{url,credential});await refresh();return 'Connection saved. Review the checks above.';},'Checking connection and download configuration…');
      });
      root.querySelectorAll('[data-options]').forEach(form=>form.onsubmit=event=>{
        event.preventDefault();const id=form.dataset.options,profileId=Number(find(id+'-profile').value),folderId=Number(find(id+'-folder').value);
        run(async()=>{await api(`/api/downloads/${id}/configure`,{profileId,folderId});await refresh();return 'Download choices saved.';},'Saving choices…');
      });
      for(const action of ['recheck','disconnect'])root.querySelectorAll(`[data-${action}]`).forEach(button=>button.onclick=()=>run(async()=>{await api(`/api/downloads/${button.dataset[action]}/${action}`,{});await refresh();return action==='disconnect'?'Saved connection removed. Apps and files are kept.':'Connection checks updated.';},action==='disconnect'?'Removing saved connection…':'Checking download configuration…'));
    }
  }
  return {render(next,node){if(view!==next&&!busy)message='';view=next;root=document.createElement('div');node.replaceChildren(root);draw();},stop(){stopped=true;clearTimeout(timer);}};
}
