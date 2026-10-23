import {recommendedPreferences,validatePreferences} from './preferences.mjs';
// Only the local AIOStreams process receives this configuration. Never return it over the wizard API.
const serviceIds = { torbox: 'torbox', 'real-debrid': 'realdebrid' };
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function limitedRequest(request,wait=delay){
  return async(...args)=>{
    try{return await request(...args);}catch(error){
      if(error.httpStatus!==429 || !(error.retryAfter>0&&error.retryAfter<=5))throw error;
      await wait(error.retryAfter*1000);return request(...args);
    }
  };
}
async function operatorHeaders(request,password,session){
  if(!session.cookie){
    const login=await request('/api/v1/auth/login','POST',{username:'MediaHubSystem',password});
    if(!login.data?.success||!login.cookie)throw Error('The local AIOStreams operator could not sign in.');
    session.cookie=login.cookie;
  }
  return {Cookie:session.cookie};
}
export function aioPreferenceConfig(value=recommendedPreferences().aio) {
  const preferences=validatePreferences('aio',value);
  return {excludeUncached:true,
    excludedResolutions:preferences.maxResolution==='any'?[]:preferences.maxResolution==='1080p'?['2160p','1440p','Unknown']:['2160p','1440p','1080p','Unknown'],
    sortCriteria:{global:[{key:'cached',direction:'desc'},{key:preferences.sortBy,direction:preferences.sortBy==='size'?'asc':'desc'}]},
    excludedQualities:preferences.excludeLowQuality?['CAM','TS','TC','SCR','HC HD-Rip']:[]};
}
export async function updateAioPreferences({request,operatorPassword,account,accountPassword,preferences,session={},wait=delay,retried=false}) {
  const patch=aioPreferenceConfig(preferences);
  const call=limitedRequest(request,wait);
  const headers={...await operatorHeaders(call,operatorPassword,session),Authorization:'Basic '+Buffer.from(`${account.uuid}:${accountPassword}`).toString('base64')};
  try{
  const read=async()=>{
    const response=await call('/api/v1/user?raw=true','GET',undefined,headers);
    if(!response.data?.success || !response.data.data?.userData)throw Error('AIOStreams settings could not be read.');
    return response.data.data.userData;
  };
  const config={...await read(),...patch};
  const result=await call('/api/v1/user','PUT',{config},headers);
  if(!result.data?.success)throw Error('AIOStreams settings could not be saved.');
  const actual=await read();
  if(Object.entries(patch).some(([k,v])=>JSON.stringify(actual[k])!==JSON.stringify(v)))throw Error('AIOStreams settings could not be verified.');
  return true;
  }catch(error){
    if(error.httpStatus!==401||retried)throw error;
    delete session.cookie;
    return updateAioPreferences({request,operatorPassword,account,accountPassword,preferences,session,wait,retried:true});
  }
}
export function composeAioConfig({ credentials, sourceSearch = false, tmdbApiKey, preferences } = {}) {
  const entries = Object.entries(credentials || {});
  if (!entries.length) throw Error('Connect at least one debrid account first.');
  if (entries.some(([id, key]) => !serviceIds[id] || typeof key !== 'string' || !key.length)) throw Error('Choose supported connected accounts.');
  const preset = type => ({ type, instanceId: `media-hub-${type}`, enabled: true,
    options: { name: type === 'library' ? 'My cloud library' : 'Cached source search', timeout: 30000, useMultipleInstances: false,
      ...(type==='library'?{sources:['torrent']}:{}) } });
  return {
    addonName: 'Media Hub sources',
    services: entries.map(([id, key]) => ({ id: serviceIds[id], enabled: true, credentials: { apiKey: key } })),
    presets: [preset('library'), ...(sourceSearch ? [preset('knaben')] : [])],
    ...aioPreferenceConfig(preferences),
    formatter: { id: 'prism' },
    ...(tmdbApiKey ? { tmdbApiKey, titleMatching: { enabled: true, ambiguousResults: 'discard' } } : {}),
    hideErrors: false,
  };
}

export async function provisionAio({ request, operatorPassword, accountPassword, credentials, account, sourceSearch = false, tmdbApiKey, preferences,session={} }) {
  request=limitedRequest(request);
  const headers=await operatorHeaders(request,operatorPassword,session);
  const config = composeAioConfig({ credentials, sourceSearch, tmdbApiKey, preferences });
  let saved = account;
  if (saved) {
    const updated = await request('/api/v1/user', 'PUT', { config }, { ...headers,
      Authorization: 'Basic ' + Buffer.from(`${saved.uuid}:${accountPassword}`).toString('base64') });
    if (!updated.data?.success) throw Error('The local AIOStreams configuration could not be updated.');
  } else {
    const created = await request('/api/v1/user', 'POST', { config, password: accountPassword }, headers);
    saved = created.data?.data;
    if (!created.data?.success || !saved?.uuid || !saved?.encryptedPassword) throw Error('The local AIOStreams configuration could not be created.');
  }
  const manifest = await request(`/stremio/${encodeURIComponent(saved.uuid)}/${encodeURIComponent(saved.encryptedPassword)}/manifest.json`, 'GET');
  if (!manifest.data?.id || !Array.isArray(manifest.data.resources)) throw Error('AIOStreams did not return a usable manifest.');
  return { account: { uuid: saved.uuid, encryptedPassword: saved.encryptedPassword },
    receipt: { configured: true, providers: Object.keys(credentials), sourceSearch, manifestVerified: true, playbackVerified: false } };
}
