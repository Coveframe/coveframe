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
  const nonce = localSetup ? ` nonce="${localSetup.nonce}"` : '';
  const data = JSON.stringify(catalog).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer">${localSetup ? `<meta name="media-hub-token" content="${localSetup.token}">` : ''}<title>Coveframe — ${localSetup ? 'Your media' : 'Setup guide preview'}</title>
<style>${css}</style></head><body><a class="skip-link" href="#content">Skip to content</a>
<div class="shell"><aside><header><strong>Coveframe<span class="brand-dot" aria-hidden="true"></span></strong><span>Setup guide</span></header>
${localSetup ? '<nav aria-label="Coveframe" class="hub-nav"><button id="hub-home">Dashboard</button><button id="hub-library">Find titles</button><button id="hub-settings">Settings</button><button id="hub-guide">Setup guide</button><button id="hub-system">About this PC</button></nav>' : ''}
<nav aria-label="Setup steps" id="setup-navigation"><ol id="steps"></ol></nav>
<div class="preview-note">${localSetup ? '<p class="local-label">On this PC only</p><button id="stop-apps" class="secondary">Stop all apps</button><button id="stop-setup" class="rail-quiet">Quit Coveframe</button><p id="lifecycle-message" role="status"></p>' : 'Preview only. No changes to your PC.'}</div></aside>
<main><div class="page"><p id="progress" class="progress"></p><section id="content" aria-labelledby="page-title"></section>
<p id="announcement" class="sr-only" aria-live="polite"></p></div>
<footer><button id="back" class="secondary">Back</button><button id="next" class="primary">Continue</button></footer></main></div>
<script id="guide-data" type="application/json"${nonce}>${data}</script><script type="module"${nonce}>${engine}\n${client}\n${libraryClient}\n${systemClient}\n${dashboardClient}\n${liveClient}\ninitializeSetupPreview({ composeSetupPlan, saveSetupPlan, resolveWizardStep${localSetup ? ', runtime: await createLocalSetupRuntime()' : ''} });</script>
</body></html>`;
}
