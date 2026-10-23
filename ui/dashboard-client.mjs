// Embedded only in the authenticated local app. No browser storage or secrets.
export function createHubDashboard({api,initial,onState=()=>{}}) {
  let current=initial,view=initial.media.canResume||initial.plan?'home':'guide',draw,guide,content;
  let stopped=false,timer,busy=false;
  let animatedView;
  const draft=structuredClone(initial.settings.preferences),messages={},dirty=new Set();
  const library=createLibraryScreens({api,getState:()=>current,onState:state=>{current=state;onState(state);},onHome:()=>open('home'),onDownloads:()=>open('downloads'),onAccounts:()=>guide(2)});
  const system=createSystemScreen({api,onUninstall:data=>lifecycle('/api/uninstall',data)});
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const working=status=>status&&['preparing','downloading','starting','configuring'].includes(status.phase);
  const check=(id,label,value,hint)=>`<label class="check"><input type="checkbox" id="${id}"${value?' checked':''}><span><strong>${label}</strong><span class="hint">${hint}</span></span></label>`;
  const statusLabel=section=>current.settings.application[section]==='applied'?'Applied to the running app.': 'Saved for the next app start or connection.';
  function announce(message){const node=document.getElementById('announcement');if(node)node.textContent=message;}
  async function refresh(){current=await api('/api/state');onState(current);}
  function poll(){
    clearTimeout(timer);
    if(stopped || view==='guide' || ![current.media,current.sources,current.discovery,current.managedDownloads].some(working))return;
    timer=setTimeout(async()=>{try{await refresh();if(!stopped&&view==='home')draw();else poll();}catch{announce('Could not read app progress. Use Refresh status to try again.');}},1500);
  }
  async function action(path,data){
    if(busy||stopped)return;busy=true;draw();
    try{await api(path,data);await refresh();announce('App status updated.');}
    catch(error){messages.home=error.message;}
    finally{busy=false;if(!stopped)draw();}
  }
  async function open(next){
    if(stopped||busy)return;
    clearTimeout(timer);
    try{
      await refresh();
      for(const section of ['moonfin','aio'])if(!dirty.has(section))draft[section]=structuredClone(current.settings.preferences[section]);
    }catch{announce('Could not refresh status. Showing the last saved app status.');}
    if(stopped)return;if(next==='system')await system.load();view=next;draw?.();document.getElementById('page-title')?.focus();
  }
  function home(){
    const media=current.media,sources=current.sources,discovery=current.discovery;
    const started=media.phase==='running';
    return `<h1 id="page-title" tabindex="-1">Make yourself at home.</h1><p class="intro">Your library, sources and a few useful shortcuts.</p>
      ${messages.home?`<p class="notice warning" role="alert">${escape(messages.home)}</p>`:''}
      <section class="hub-section watch-section"><div class="section-heading"><h2>Watch &amp; discover</h2><button id="hub-refresh" class="secondary"${busy?' disabled':''}>Refresh</button></div>
      <p role="status">${escape(working(media)||media.phase==='failed'?media.message:started?'Your media apps are ready. Pick something to watch.':'Your setup is saved. Start your apps when you’re ready.')}</p>
      <div class="actions">${started?`<a class="button primary" href="${escape(media.moonfinUrl)}" target="_blank" rel="noopener noreferrer">Open Moonfin</a>`:media.canResume?`<button id="hub-start" class="primary"${busy||working(media)?' disabled':''}>${working(media)?'Starting…':'Start my media apps'}</button>`:'<button data-guide="1" class="primary">Create your household</button>'}
      <button id="hub-find-titles" class="secondary">Find titles</button>${discovery.phase==='running'?`<a class="button secondary" href="${escape(discovery.url)}" target="_blank" rel="noopener noreferrer">Open discovery</a>`:`<button id="hub-discovery" class="secondary"${!started||busy||working(discovery)?' disabled':''}>${working(discovery)?'Connecting discovery…':'Connect discovery'}</button>`}</div>
      <p class="hint">${escape(working(discovery)||discovery.phase==='failed'?discovery.message:discovery.phase==='running'?'Discovery is connected. Search movies and shows in Find titles.':'Discovery adds movie and TV search. Connect it after starting your apps.')}</p></section>
      <section class="hub-section"><div class="section-heading"><h2>Your sources</h2><span class="version">${sources.phase==='running'?'Connected':'Not running'}</span></div><p>TorBox + Real-Debrid is recommended. Each needs an active subscription.</p>
      <ul class="account-summary">${['torbox','real-debrid'].map(id=>`<li><strong>${id==='torbox'?'TorBox':'Real-Debrid'}</strong><span>${current.accounts[id]?.configured?'Key saved · '+(current.accounts[id].verifiedThisSession?'checked this session':'recheck on connection'):'Not connected'}</span></li>`).join('')}</ul>
      ${working(sources)||sources.phase==='failed'?`<p role="status">${escape(sources.message)}</p>`:''}${sources.fixture?'<p class="notice warning">UI test: provider connections are simulated.</p>':''}
      <div class="actions"><button id="hub-connect" class="primary"${busy||!started||working(sources)?' disabled':''}>${working(sources)?'Connecting…':sources.phase==='running'?'Reconnect sources':'Connect saved accounts'}</button><button data-guide="2" class="secondary">Manage accounts &amp; plans</button></div>
      <details><summary>What each source covers</summary><p>TorBox checks cached searches. Real-Debrid plays completed titles in your cloud library. Availability varies by title.</p></details></section>
      <section class="hub-section"><div class="section-heading"><h2>Watch on your TV</h2><span class="status-pill">${media.network?.phase==='running'?'Home access on':'Set up once'}</span></div><p>${media.network?.phase==='running'?`Enter <strong>${escape(media.network.url)}</strong> in Moonfin on your TV.`:'Connect your TV to Moonfin on the same home network.'}</p><button data-guide="5" class="secondary">${media.network?.phase==='running'?'TV instructions & connection check':'Set up my TV'}</button></section>
      <section class="hub-section"><h2>Make it yours</h2><p>Fine-tune Moonfin and AIOStreams anytime.</p><div class="actions"><button id="open-preferences" class="secondary">Customize</button><button data-guide="3" class="secondary">Posters &amp; ratings</button></div></section>
      <p class="hint preview-status">Preview release · <button id="open-system" class="text-button">What’s ready &amp; what’s next</button></p>`;
  }
  function settings(){
    const moon=draft.moonfin,aio=draft.aio;
    const sectionActions=section=>`<p id="${section}-message" role="status" class="settings-message">${escape(messages[section]||statusLabel(section))}</p><div class="actions"><button type="submit" class="primary">Save changes</button><button type="button" class="secondary" data-reset="${section}">Restore defaults</button></div>`;
    return `<h1 id="page-title" tabindex="-1">Settings</h1><p class="intro">A few useful choices. Change them now, or come back later.</p>
      <form id="moonfin-form" class="hub-section"><fieldset${busy?' disabled':''}><legend>Moonfin</legend><p class="muted">Make browsing feel like you. Changes apply to your household; reload Moonfin after saving.</p>
      ${check('moon-auto','Rotate the home banner',moon.autoAdvance,'Automatically move between featured titles.')}
      ${check('moon-trailers','Preview trailers',moon.trailerPreview,'Trailers can play while browsing. Off by default.')}
      ${check('moon-music','Play theme music',moon.themeMusic,'Play available theme music while browsing. Off by default.')}
      ${sectionActions('moonfin')}</fieldset></form>
      <form id="aio-form" class="hub-section"><fieldset${busy?' disabled':''}><legend>AIOStreams</legend><p class="muted">Cached sources only. Your account connections are managed separately.</p><div class="fields">
      <label>Maximum resolution<select id="aio-resolution">${[['any','Any resolution (recommended)'],['1080p','Up to 1080p'],['720p','Up to 720p']].map(([v,l])=>`<option value="${v}"${aio.maxResolution===v?' selected':''}>${l}</option>`).join('')}</select></label>
      <label>Show results by<select id="aio-sort">${[['resolution','Highest resolution first'],['size','Smallest files first']].map(([v,l])=>`<option value="${v}"${aio.sortBy===v?' selected':''}>${l}</option>`).join('')}</select></label></div>
      <p class="hint">Resolution limits also hide results with unknown resolution. Smaller files may reduce quality.</p>
      <details><summary>Advanced source options</summary>${check('aio-quality','Hide low-quality recordings',aio.excludeLowQuality,'Exclude CAM, TS, TC, SCR and HC HD-Rip recordings. Recommended on.')}<p class="hint">Source search and provider selection are in the setup guide.</p><button type="button" data-guide="2" class="secondary">Manage source connections</button></details>
      ${sectionActions('aio')}</fieldset></form>
      <div class="actions">${current.media.phase==='running'?`<a class="button secondary" href="${escape(current.media.moonfinUrl)}" target="_blank" rel="noopener noreferrer">Open Moonfin for more customization</a>`:''}<button data-guide="5" class="secondary">TV &amp; home network</button><button data-guide="3" class="secondary">Manage posters &amp; ratings keys</button><button id="open-downloads" class="secondary">Optional downloads · Radarr / Sonarr</button></div>`;
  }
  async function save(section,reset=false){
    if(busy||stopped)return;
    busy=true;messages[section]='Saving…';draw();
    try{
      const result=await api(`/api/settings/${section}${reset?'/reset':''}`,reset?{}:{value:draft[section]});
      current.settings=result;draft[section]=structuredClone(result.preferences[section]);dirty.delete(section);
      messages[section]=(reset?'Recommended defaults restored. ':'Changes saved. ')+(result.applyFailed?'Applying failed. Your choices are saved; retry Save changes when the app is ready.':statusLabel(section));
      announce(messages[section]);
    }catch(error){messages[section]=`Changes were not confirmed. ${error.message}`;announce(messages[section]);}
    finally{busy=false;if(!stopped){draw();document.getElementById(`${section}-message`)?.scrollIntoView({block:'nearest'});}}
  }
  async function lifecycle(path,data={}){
    if(busy||stopped)return;busy=true;clearTimeout(timer);
    const shell=document.querySelector('.shell'),message=document.getElementById('lifecycle-message');
    message.textContent=path==='/api/apps/stop'?'Stopping apps…':path==='/api/uninstall'?'Removing apps & settings…':'Closing…';shell.inert=true;
    try{
      await api(path,data);
      if(path==='/api/apps/stop'){await refresh();if(view==='system')await system.load();busy=false;message.textContent='All apps stopped. Your setup is saved.';draw();}
      else{
        stopped=true;library.stop();document.dispatchEvent(new Event('coveframe:closed'));
        document.querySelector('main').innerHTML=`<div class="page"><h1>${path==='/api/uninstall'?'Apps & settings removed':'Coveframe closed'}</h1><p>${path==='/api/uninstall'?'Your media files were kept. Close this tab, then delete the extracted launcher folder.':'Your setup is saved. Close this tab and open the launcher to return.'}</p></div>`;
        document.querySelectorAll('aside button').forEach(button=>button.disabled=true);message.textContent='';
      }
    }catch(error){message.textContent=error.message;}
    finally{shell.inert=false;busy=false;}
  }
  return {
    lifecycle,
    showGuide(){view='guide';clearTimeout(timer);},
    showHome(latest){current=latest;open('home');},
    stop(){stopped=true;library.stop();clearTimeout(timer);document.querySelectorAll('.hub-nav button').forEach(x=>x.disabled=true);},
    render(node,rerender,navigate){
      if(stopped)return true;
      content=node;draw=rerender;guide=navigate;
      document.getElementById('hub-home').onclick=()=>open('home');
      document.getElementById('hub-settings').onclick=()=>open('settings');
      document.getElementById('hub-library').onclick=()=>open('library');
      document.getElementById('hub-guide').onclick=()=>guide(0);
      document.getElementById('hub-system').onclick=()=>open('system');
      document.querySelector('aside header > span').textContent=({guide:'Setup guide',settings:'Settings',library:'Find titles',downloads:'Optional downloads',home:'Your media',system:'About this PC'})[view];
      document.getElementById('setup-navigation').hidden=view!=='guide';
      document.querySelector('main footer').hidden=view!=='guide';
      document.getElementById('progress').hidden=view!=='guide';
      for(const [id,target] of [['hub-home','home'],['hub-library','library'],['hub-settings','settings'],['hub-guide','guide'],['hub-system','system']]) {
        const button=document.getElementById(id);if(view===target)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
      }
      if(animatedView!==view){content.classList.remove('view-enter');void content.offsetWidth;content.classList.add('view-enter');animatedView=view;}
      if(view==='guide')return false;
      if(view==='system'){system.render(content);return true;}
      if(['library','downloads'].includes(view)){library.render(view,content);return true;}
      content.innerHTML=view==='home'?home():settings();
      content.querySelectorAll('[data-guide]').forEach(button=>button.onclick=()=>guide(Number(button.dataset.guide)));
      if(view==='home'){
        const click=(id,fn)=>{const b=document.getElementById(id);if(b)b.onclick=fn;};
        click('open-preferences',()=>open('settings'));
        click('open-system',()=>open('system'));
        click('hub-find-titles',()=>open('library'));
        click('hub-refresh',()=>action('/api/state'));
        click('hub-start',()=>action('/api/media/resume',{}));
        click('hub-discovery',()=>action('/api/discovery/start',{}));
        click('hub-connect',()=>action('/api/sources/start',{providers:current.plan?current.plan.providers.map(p=>p.id).filter(id=>['torbox','real-debrid'].includes(id)):['torbox','real-debrid'].filter(id=>current.accounts[id]?.configured),sourceSearch:current.plan?.sources?.sourceSearch!==false}));
      }else{
        document.getElementById('open-downloads').onclick=()=>open('downloads');
        for(const section of ['moonfin','aio']){
          const form=document.getElementById(`${section}-form`);
          form.onsubmit=event=>{event.preventDefault();save(section);};
          form.onchange=()=>{
            draft[section]=section==='moonfin'?{autoAdvance:document.getElementById('moon-auto').checked,trailerPreview:document.getElementById('moon-trailers').checked,themeMusic:document.getElementById('moon-music').checked}:
              {maxResolution:document.getElementById('aio-resolution').value,sortBy:document.getElementById('aio-sort').value,excludeLowQuality:document.getElementById('aio-quality').checked};
            dirty.add(section);messages[section]='Unsaved changes. Use Save changes to keep them.';
            document.getElementById(`${section}-message`).textContent=messages[section];
          };
        }
        content.querySelectorAll('[data-reset]').forEach(button=>button.onclick=()=>save(button.dataset.reset,true));
      }
      poll();return true;
    },
  };
}
