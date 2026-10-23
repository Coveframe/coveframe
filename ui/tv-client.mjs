// Embedded only in the authenticated PC wizard.
// Project allowlisted facts only, never whole responses, URLs or error messages.
export function buildCodexSetupPrompt({state={},media={},accounts={},sources={},discovery={},selectedId}={}){
 const phase=value=>['running','not-started','stopped','failed','preparing','downloading','starting','configuring','off','permission','needs-attention'].includes(value)?value:'unknown';
 const devices={androidtv:'Android / Google TV',firetv:'Fire TV',appletv:'Apple TV',other:'Other TV or device'};
 const providers={torbox:'TorBox','real-debrid':'Real-Debrid',premiumize:'Premiumize'},tiers={essential:'Essential',pro:'Pro',premium:'Premium'};
 const network=media.network||{},adapter=(network.adapters||[]).find(x=>x.id===(selectedId??network.selectedId));
 const parts=String(adapter?.address||'').split('.'),octets=parts.map(Number);
 const address=parts.length===4&&parts.every(x=>/^\d{1,3}$/.test(x))&&octets.every(x=>x>=0&&x<=255)&&
  (octets[0]===10||octets[0]===192&&octets[1]===168||octets[0]===172&&octets[1]>=16&&octets[1]<=31)?octets.join('.'):null;
 const category=['Private','Public','DomainAuthenticated'].includes(adapter?.category)?adapter.category:'unknown';
 const rows=['Help me finish Coveframe setup on this Windows PC and connect my TV using Moonfin. Work step by step and explain actions I must do on the TV.',
  '', 'Project: https://github.com/Coveframe/coveframe', 'Setup dashboard (on this PC): http://127.0.0.1:18797/',
  'This is a snapshot from the local wizard. Recheck the installed version and live status first; the public release may differ.',
  '', 'CURRENT SETUP',`TV: ${Object.hasOwn(devices,state.tv)?devices[state.tv]:'Not chosen'}`,`Media apps: ${phase(media.phase)}`,`Source apps: ${phase(sources.phase)}`,`Discovery: ${phase(discovery.phase)}`,
  `TV access: ${phase(network.phase)}`,`Selected home connection: ${address||'not detected'} (${category})`,
  `Windows TV firewall permission: ${network.firewallAllowed===true?'present at last check':'not confirmed'}`,
  `Home address responds: ${network.reachable===true?'yes at last check':'not confirmed'}`,
  `Another device connected: ${network.deviceSeen===true?'observed':'not observed'}`,`Device sign-in: ${network.signedIn===true?'observed':'not observed'}`];
 if(network.phase==='running'&&address&&category==='Private'&&network.url===`http://${address}:18799`)rows.push(`TV server: http://${address}:18799 (never enter localhost on the TV)`);
 else if(network.phase==='running')rows.push('TV server: check the current address in the wizard; the selected connection may differ.');
 for(const provider of state.providers||[]){
  const name=Object.hasOwn(providers,provider.id)?providers[provider.id]:null;if(!name)continue;
  rows.push(`${name}: ${Object.hasOwn(tiers,provider.plan)?tiers[provider.plan]:'tier not selected'}`);
  const account=accounts[provider.id];
  rows.push(`${name} account: ${!account?.configured?'not connected':!account.verifiedThisSession?'key saved; not verified this session':account.active?'connected at last verification':'subscription needs checking'}`);
 }
 rows.push(`Downloads: optional; ${state.downloads===true?'requested; installation/status must be checked':'not requested'}`,
  `Extra ratings selected: ${[state.mdblist===true?'MDBList':'',state.omdb===true?'OMDb':''].filter(Boolean).join(', ')||'none'}; basic Jellyfin metadata needs no personal key`,
  '', 'HOW TO HELP',
  '1. Find my extracted Coveframe folder or source checkout (ask its location if needed), inspect README, RELEASE-NOTES and docs/TV-SETUP.md if available, then check local app status. Preserve existing apps, settings, files and other media installations. Ask which PC/network or TV model if unclear. This snapshot is not playback proof.',
  '2. Keep TorBox Essential + Real-Debrid Premium recommended; multiple providers are supported. Do not buy subscriptions or change my selected tiers. Keys belong only in the local wizard, never chat. Do not read credential vaults, copy keys, or expose passwords, session tokens, source URLs or raw logs.',
  '3. Both devices need the same trusted home network. If Windows shows Public, explain how I can mark only my trusted home connection Private, then Scan again. Explain and ask before changing network profiles, firewall, permissions or router settings. Never disable antivirus, bypass Windows protection, forward ports or expose the dashboard to the internet.',
  '4. Use the wizard: start media apps, scan, Enable TV access and review its Windows PowerShell permission prompt. The media-only connection uses TCP 18799, Private networks and the local subnet; setup and provider services stay on this PC. Use official Moonfin instructions for my device, Add server with the full address, then household sign-in. Keep the PC awake and Coveframe open. Explain remote-control steps; do not claim to operate a physical TV you cannot access.',
  '5. Use Find titles on the PC, then open the TV library. Check guest Wi-Fi/isolation, changed IP addresses and VPN local-network blocking if needed. Radarr/Sonarr and Decypharr downloads are optional: explain why they help and show the wizard confirmation before installing or running them. Ask before live provider tests or downloads and use only a title I am authorized to access.',
  '6. Verify actual physical TV sign-in, playback, seeking, stop/resume, audio and subtitles. A responding server or sign-in is not playback proof. Report what was tested and what needs my help. Leave boot testing and rebooting deferred.',
  '', 'MY ISSUE / TV MODEL (add details here):');
 return rows.join('\n');
}

export function createTvSetup({api,getMedia,onMedia,getContext=()=>({})}){
 let scanned=false,busy=false,message='',selectedId;
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 async function action(action,data,render){
  if(busy)return;busy=true;message=action==='scan'?'Finding your home network…':action==='enable'?'Waiting for Windows permission and checking the connection…':'Checking…';render();
  try{await api('/api/tv/'+action,data||{});onMedia((await api('/api/state')).media);message=action==='disable'?'TV access is off. You can still watch on this PC.':'';}
  catch(error){message=error.message;try{onMedia((await api('/api/state')).media);}catch{}}
  finally{busy=false;render();}
 }
 return {render(content,state,render){
  const media=getMedia(),network=media.network||{phase:'off',adapters:[]},adapters=network.adapters||[],running=network.phase==='running';
  if(!adapters.some(x=>x.id===selectedId))selectedId=network.selectedId||adapters.find(x=>x.category==='Private')?.id||adapters[0]?.id;
  const selected=adapters.find(x=>x.id===selectedId);
  const section=document.createElement('section');section.className='hub-section tv-network';
  section.innerHTML=`<div class="section-heading"><h2>1. Connect your home</h2><span class="status-pill">${running?'TV access on':'PC only'}</span></div>
   <p>Keep the PC and TV on the same home Wi-Fi or wired network.</p>
   ${media.phase!=='running'?'<p class="notice">Start your media apps first.</p><button id="tv-household" class="secondary">Go to Your household</button>':`
   ${adapters.length?`<label for="tv-adapter">Home connection<select id="tv-adapter"${busy?' disabled':''}>${adapters.map(x=>`<option value="${x.id}"${x.id===selectedId?' selected':''}>${escape(x.name)} · ${escape(x.address)} · ${escape(x.category)}</option>`).join('')}</select></label>`:'<p class="hint">No supported home connection found yet. Connect to your home Wi-Fi or Ethernet, then scan again.</p>'}
   ${selected&&selected.category!=='Private'?'<p class="notice warning">Windows has not marked this as a Private home connection. On your own trusted home network, open Windows Settings → Network &amp; internet → your connection → Network profile type → Private. Then scan again.</p>':''}
   <div class="actions"><button id="tv-enable" class="primary"${busy||!selected||selected.category!=='Private'?' disabled':''}>${running?'Update TV connection':'Enable TV access'}</button><button id="tv-scan" class="secondary"${busy?' disabled':''}>Scan again</button>${running?`<button id="tv-disable" class="text-button"${busy?' disabled':''}>Turn off TV access</button>`:''}</div>`}
   <p id="tv-message" role="status"${message?' class="notice"':''}>${escape(message||network.message||'')}</p>
   ${running?`<div class="tv-address"><label for="tv-server">Server address for your TV</label><div class="tv-address-row"><input id="tv-server" readonly value="${escape(network.url)}" spellcheck="false"><button id="tv-copy" class="secondary">Copy</button></div><p class="hint">Enter the full address, including http:// and :18799. Keep Coveframe open and the PC awake.</p></div>`:''}
   <details><summary>What changes?</summary><p>Runs a media-only connection on port 18799. Windows may ask to run PowerShell to allow it through the firewall on Private networks, for devices on your local subnet.</p><p class="hint">This uses HTTP on your trusted home network. The setup dashboard and account keys stay on this PC. No router changes or internet access are enabled. Turning TV access off closes the connection; uninstall also removes its firewall permission.</p></details>`;
  content.append(section);
  section.querySelector('#tv-household')?.addEventListener('click',()=>document.querySelector('[data-step="1"]')?.click());
  section.querySelector('#tv-adapter')?.addEventListener('change',event=>{selectedId=Number(event.target.value);render();});
  section.querySelector('#tv-scan')?.addEventListener('click',()=>action('scan',{},render));
  section.querySelector('#tv-disable')?.addEventListener('click',()=>action('disable',{},render));
  section.querySelector('#tv-copy')?.addEventListener('click',async()=>{
   try{await navigator.clipboard.writeText(network.url);section.querySelector('#tv-copy').textContent='Copied';}
   catch{section.querySelector('#tv-server').select();section.querySelector('#tv-message').textContent='Select and copy the highlighted server address.';}
  });
  section.querySelector('#tv-enable')?.addEventListener('click',()=>{
   const dialog=document.createElement('dialog');dialog.className='download-confirmation';
   dialog.setAttribute('aria-labelledby','tv-permission-title');
   dialog.innerHTML='<form method="dialog"><h2 id="tv-permission-title">Allow your TV to connect?</h2><p>Coveframe will share Jellyfin and Moonfin with devices on your Private home network.</p><p>Windows may ask permission for <strong>Windows PowerShell</strong> to add one firewall rule: TCP port 18799, Private networks, local devices only.</p><p class="hint">Your setup dashboard stays private to this PC. No router settings change. Use this only on a home network you trust.</p><div class="actions"><button value="cancel" class="secondary" autofocus>Cancel</button><button value="allow" class="primary">Allow TV access</button></div></form>';
   document.body.append(dialog);dialog.addEventListener('close',()=>{const accepted=dialog.returnValue==='allow';dialog.remove();if(accepted)action('enable',{adapterId:selectedId,confirmation:'ALLOW HOME TV'},render);else section.querySelector('#tv-enable')?.focus();},{once:true});dialog.showModal();
  });
  if(running){
   const guide=document.createElement('section');guide.className='hub-section';
   const store={androidtv:'Open the Play Store on your TV and install Moonfin.',firetv:'Search for Moonfin on your Fire TV and install it from the Amazon Appstore.',appletv:'Open the App Store on your Apple TV and install Moonfin.',other:'Use the official Moonfin installation guide below to find the client for your device. Samsung and LG use the separate Smart-TV client.'};
   guide.innerHTML=`<h2>2. Open Moonfin on your TV</h2><ol class="tv-steps"><li>${store[state.tv]||store.other}</li><li>Choose <strong>Add server</strong> or manual connection and enter <strong>${escape(network.url)}</strong>.</li><li>Sign in with your household name and password from Your household.</li></ol><p class="hint">Add movies and shows using Find titles on this PC, then open your library on the TV. The PC's discovery page is not shared with the TV.</p><a href="https://github.com/Moonfin-Client/Moonfin-Core/wiki/Installation" target="_blank" rel="noopener noreferrer">Official Moonfin installation guide</a>
    <h2>3. Try something to watch</h2><p>Play a title, jump forward, then stop and resume. Check audio and subtitles too.</p><p role="status">${network.deviceSeen?'Another device has reached this server.':'Waiting for a TV or another home device to connect.'} ${network.signedIn?'A device has signed in.':''}</p><p class="hint">${network.reachable?'The server responds at its home address.':'The PC could not reach the home address. Scan again and check Windows permission.'} A server check cannot confirm TV playback.</p><button id="tv-check" class="secondary"${busy?' disabled':''}>Check connection</button>
    <details><summary>Can't connect?</summary><ul><li>Check both devices use the same home network. Guest Wi-Fi and Wi-Fi isolation can block the connection.</li><li>Type the full server address shown above. Never enter localhost or 127.0.0.1 on the TV.</li><li>Keep this PC awake and Coveframe's media apps running. If the address changes, scan and update the TV connection.</li><li>If you use a VPN, its local-network blocking option may prevent TV access. Use its trusted local-network setting if available.</li><li>If sign-in works but a title will not play, check your sources on this PC and try another available title.</li></ul></details>`;
   content.append(guide);guide.querySelector('#tv-check').onclick=()=>action('check',{},render);
  }
  const help=document.createElement('details');help.className='hub-section codex-help';
  help.innerHTML='<summary>Get help with Codex</summary><p>Copy this prompt into Codex on this PC. Add your TV model and what went wrong.</p><p class="hint">Includes setup choices, app status and your local network address. No API keys or passwords. Review it before sharing.</p><label for="codex-setup-prompt">Your setup prompt</label><textarea id="codex-setup-prompt" rows="9" readonly spellcheck="false"></textarea><div class="actions"><button id="codex-copy" class="secondary">Copy Codex prompt</button></div><p id="codex-copy-status" role="status"></p>';
  const field=help.querySelector('#codex-setup-prompt'),feedback=help.querySelector('#codex-copy-status');
  const updatePrompt=()=>{field.value=buildCodexSetupPrompt({...getContext(),state,media:getMedia(),selectedId});};
  updatePrompt();help.addEventListener('toggle',()=>{if(help.open)updatePrompt();});
  help.querySelector('#codex-copy').addEventListener('click',async()=>{
   updatePrompt();try{await navigator.clipboard.writeText(field.value);feedback.textContent='Copied. Paste into Codex on this PC.';}
   catch{field.focus();field.select();feedback.textContent='Prompt selected. Press Ctrl+C, or use your device’s Copy command.';}
  });
  content.append(help);
  if(!scanned&&media.phase==='running'){scanned=true;queueMicrotask(()=>action('scan',{},render));}
 }};
}
