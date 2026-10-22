import test from 'node:test';
import assert from 'node:assert/strict';
import {applyMoonfinPreferences} from '../src/moonfin-preferences.mjs';

test('Moonfin preferences merge only the managed choices for household viewers',async()=>{
  const profiles=new Map([['viewer',{global:{customRows:['keep']},tv:{visualTheme:'keep-theme'}}]]);
  let plugin={TmdbApiKey:'private-fixture',SeerrEnabled:true,DefaultUserSettings:{visualTheme:'keep-theme'}};
  const request=async(path,method='GET',data)=>{
    if(path.includes('/Configuration')){if(method==='POST')plugin=data;return plugin;}
    const id=path.split('/').at(-1);
    if(method==='POST'){
      assert.equal(data.MergeMode,'merge');
      const existing=profiles.get(id);
      for(const [profile,patch]of Object.entries(data.Settings)) if(typeof patch==='object') existing[profile]={...existing[profile],...patch};
      return {Success:true};
    }
    return profiles.get(id);
  };
  const result=await applyMoonfinPreferences({request,viewerIds:['viewer'],preferences:{autoAdvance:false,trailerPreview:false,themeMusic:true}});
  assert.equal(result,true);
  assert.deepEqual(profiles.get('viewer').global.customRows,['keep']);
  assert.equal(profiles.get('viewer').tv.visualTheme,'keep-theme');
  assert.equal(profiles.get('viewer').tv.themeMusicEnabled,true);
  assert.equal(plugin.TmdbApiKey,'private-fixture');
  assert.equal(plugin.SeerrEnabled,true);
});
