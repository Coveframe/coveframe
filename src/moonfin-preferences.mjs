import {moonbaseId} from './jellyfin-setup.mjs';
import {validatePreferences} from './preferences.mjs';

// Pinned Moonbase 2.4 settings envelope. Partial merge preserves rows, themes,
// integrations and all other user choices; no private data leaves this adapter.
export async function applyMoonfinPreferences({request,viewerIds,preferences}) {
  const value=validatePreferences('moonfin',preferences);
  const patch={mediaBarAutoAdvance:value.autoAdvance,mediaBarTrailerPreview:value.trailerPreview,themeMusicEnabled:value.themeMusic};
  const path=`/Plugins/${moonbaseId}/Configuration`;
  const plugin=await request(path);
  await request(path,'POST',{...plugin,EnableSettingsSync:true,DefaultUserSettings:{...plugin.DefaultUserSettings,...patch}});
  for(const id of viewerIds){
    const route=`/Moonfin/Settings/${id}`;
    const result=await request(route,'POST',{ClientId:'media-hub-settings',MergeMode:'merge',
      Settings:{schemaVersion:2,...Object.fromEntries(['global','desktop','mobile','tv'].map(p=>[p,patch]))}});
    if(!(result?.Success??result?.success))throw Error('Moonfin could not save household preferences.');
    const actual=await request(route);
    if(['global','desktop','mobile','tv'].some(p=>Object.entries(patch).some(([key,val])=>actual?.[p]?.[key]!==val))) throw Error('Moonfin preferences could not be verified.');
  }
  return true;
}
