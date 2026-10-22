import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createPreferences} from '../src/preferences.mjs';

test('household preferences survive reopening and section reset preserves the other choices', async t => {
  const directory=await mkdtemp(join(tmpdir(),'media-hub-preferences-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const settings=await createPreferences(directory);
  await settings.save('moonfin',{autoAdvance:false,trailerPreview:false,themeMusic:true});
  await settings.save('aio',{maxResolution:'1080p',sortBy:'size',excludeLowQuality:true});
  const reopened=await createPreferences(directory);
  assert.equal(reopened.read().moonfin.themeMusic,true);
  await reopened.reset('aio');
  assert.deepEqual(reopened.read().aio,{maxResolution:'any',sortBy:'resolution',excludeLowQuality:true});
  assert.equal(reopened.read().moonfin.themeMusic,true);
  await assert.rejects(reopened.save('moonfin',{autoAdvance:true,trailerPreview:false,themeMusic:false,apiKey:'do-not-store'}));
  assert.equal((await createPreferences(directory)).read().moonfin.themeMusic,true);
});
