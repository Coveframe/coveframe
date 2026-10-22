import { join } from 'node:path';

export const jellyfinIdentity = 'Media Hub (local wizard)';
export const moonbaseId = '8c5d0e91-4f2a-4b6d-9e3f-1a7c8d9e0f2b';

export function validateHousehold(household) {
  if (!household || typeof household.name !== 'string' || !/^[\p{L}\p{N} _.-]{1,40}$/u.test(household.name) ||
      household.name.toLowerCase() === 'mediahubsystem' || /^viewer [2-6]$/i.test(household.name) ||
      typeof household.password !== 'string' || household.password.length < 12 || household.password.length > 256 ||
      /[\x00-\x1f\x7f]/.test(household.password) || !Number.isInteger(household.profiles) || household.profiles < 1 || household.profiles > 6) {
    throw Error('Enter a household name and a password of 12–256 characters. Choose 1–6 profiles.');
  }
}

// Only the owned runtime supplies request. Never accepts a user-supplied server address.
export async function provisionJellyfin({ request, systemPassword, household, libraryRoot, onAuthenticated = () => {} }) {
  validateHousehold(household);
  let token;
  const call = (path, method, data) => request(path, method, data, token);
  const info = await call('/System/Info/Public');
  if (!info.StartupWizardCompleted) {
    await call('/Startup/Configuration', 'POST', { ServerName: jellyfinIdentity, UICulture: 'en-US', MetadataCountryCode: 'US', PreferredMetadataLanguage: 'en' });
    await call('/Startup/User');
    await call('/Startup/User', 'POST', { Name: 'MediaHubSystem', Password: systemPassword });
    await call('/Startup/RemoteAccess', 'POST', { EnableRemoteAccess: false });
    await call('/Startup/Complete', 'POST');
  } else if (info.ServerName !== jellyfinIdentity) throw Error('This server belongs to another installation. No accounts were changed.');
  const session = await call('/Users/AuthenticateByName', 'POST', { Username: 'MediaHubSystem', Pw: systemPassword });
  if (!session.AccessToken) throw Error('Could not authenticate this installation. Preserve its data for recovery.');
  token = session.AccessToken;
  onAuthenticated(token);
  const existing = await call('/Users');
  const names = [household.name, ...Array.from({ length: household.profiles - 1 }, (_, i) => `Viewer ${i + 2}`)];
  for (const name of names) {
    let user = existing.find(x => x.Name.toLowerCase() === name.toLowerCase());
    if (!user) user = await call('/Users/New', 'POST', { Name: name, Password: household.password });
    await call(`/Users/${user.Id}/Policy`, 'POST', { ...user.Policy, IsAdministrator: false, IsHidden: false,
      EnableRemoteAccess: false, EnableAllFolders: true, EnableMediaPlayback: true, EnableContentDownloading: false });
    await call(`/Users/${user.Id}/Configuration`, 'POST', { SubtitleLanguagePreference: 'eng', SubtitleMode: 'Default',
      PlayDefaultAudioTrack: true, RememberAudioSelections: true, RememberSubtitleSelections: true });
  }
  const folders = await call('/Library/VirtualFolders');
  for (const [name, type, folder] of [['Movies', 'movies', 'Movies'], ['TV Shows', 'tvshows', 'TV']]) {
    if (!folders.some(x => x.Name === name)) await call(`/Library/VirtualFolders?name=${encodeURIComponent(name)}&collectionType=${type}&refreshLibrary=false`, 'POST', {
      LibraryOptions: { PathInfos: [{ Path: join(libraryRoot, folder) }], EnableInternetProviders: true,
        EnableRealtimeMonitor: true, PreferredMetadataLanguage: 'en', SubtitleDownloadLanguages: ['eng'], RequirePerfectSubtitleMatch: true,
        EnableChapterImageExtraction: false, EnableTrickplayImageExtraction: false },
    });
  }
  const pluginPath=`/Plugins/${moonbaseId}/Configuration`;
  const plugin=await call(pluginPath);
  await call(pluginPath, 'POST', { SeerrEnabled:false, AnimeMarkersEnabled:false, GamesEnabled:false, ...plugin, EnableSettingsSync:true,
    WebDefaultServerUrl:'http://127.0.0.1:18798',WebForcedServerUrl:'http://127.0.0.1:18798',WebEnableWebRtcScan:false });
  return { householdCreated: true, profiles: names, libraries: ['Movies', 'TV Shows'], moonbaseConfigured: true,
    streamingReady: false, playbackVerified: false, beforeSignIn: 'deferred' };
}
