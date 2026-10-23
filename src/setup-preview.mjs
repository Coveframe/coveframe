import { readFile } from 'node:fs/promises';
import { getSetupCatalog } from './onboarding.mjs';

// One offline HTML file: no server, third-party scripts, credential fields or installer actions.
export async function renderSetupPreview({ now = new Date(), localSetup = null } = {}) {
  const catalog = getSetupCatalog({ now });
  const [css, engine, client] = await Promise.all([
    readFile(new URL('../ui/setup-preview.css', import.meta.url), 'utf8'),
    readFile(new URL('./setup-plan.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../ui/setup-preview-client.mjs', import.meta.url), 'utf8'),
  ]);
  const liveClient = localSetup ? await readFile(new URL('../ui/setup-local-client.mjs', import.meta.url), 'utf8') : '';
  const dashboardClient=localSetup ? await readFile(new URL('../ui/dashboard-client.mjs',import.meta.url),'utf8') : '';
  const libraryClient=localSetup ? await readFile(new URL('../ui/library-client.mjs',import.meta.url),'utf8') : '';
  const systemClient=localSetup ? await readFile(new URL('../ui/system-client.mjs',import.meta.url),'utf8') : '';
  const tvClient=localSetup ? await readFile(new URL('../ui/tv-client.mjs',import.meta.url),'utf8') : '';
  const nonce = localSetup ? ` nonce="${localSetup.nonce}"` : '';
  const data = JSON.stringify(catalog).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const navigation = [
    ['home','Dashboard','M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z'],
    ['library','Find titles','M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0'],
    ['settings','Settings','M4 7h16M4 17h16M8 4v6M16 14v6'],
    ['guide','Setup guide','M9 6h12M9 12h12M9 18h12M3 6h1M3 12h1M3 18h1'],
    ['system','About this PC','M3 4h18v13H3ZM8 21h8M12 17v4'],
  ].map(([id,label,path])=>`<button id="hub-${id}"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg><span>${label}</span></button>`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer">${localSetup ? `<meta name="media-hub-token" content="${localSetup.token}">` : ''}<title>Coveframe — ${localSetup ? 'Your media' : 'Setup guide preview'}</title>
<style>${css}</style></head><body><a class="skip-link" href="#content">Skip to content</a>
<div class="shell"><aside><header><strong>Coveframe<span class="brand-dot" aria-hidden="true"></span></strong><span>Setup guide</span></header>
${localSetup ? `<nav aria-label="Coveframe" class="hub-nav">${navigation}</nav>` : ''}
<nav aria-label="Setup steps" id="setup-navigation"><p class="nav-label">Your setup</p><ol id="steps"></ol></nav>
<div class="preview-note">${localSetup ? '<p class="local-label">Setup stays on this PC</p><button id="stop-apps" class="secondary">Stop all apps</button><button id="stop-setup" class="rail-quiet">Quit Coveframe</button><p id="lifecycle-message" role="status"></p>' : 'Preview only. No changes to your PC.'}</div></aside>
<main><div class="page"><p id="progress" class="progress"></p><section id="content" aria-labelledby="page-title"></section>
<p id="announcement" class="sr-only" aria-live="polite"></p></div>
<footer><button id="back" class="secondary">Back</button><span id="next-step" class="footer-hint"></span><button id="next" class="primary">Continue</button></footer></main></div>
<script id="guide-data" type="application/json"${nonce}>${data}</script><script type="module"${nonce}>${engine}\n${client}\n${libraryClient}\n${systemClient}\n${dashboardClient}\n${tvClient}\n${liveClient}\ninitializeSetupPreview({ composeSetupPlan, saveSetupPlan, resolveWizardStep${localSetup ? ', runtime: await createLocalSetupRuntime()' : ''} });</script>
</body></html>`;
}
