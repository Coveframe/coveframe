// Private server-to-server bootstrap. Never accepts an arbitrary Jellyfin URL.
export async function provisionSeerr({ request, password, viewerIds }) {
  const status = (await request('/api/v1/settings/public')).data;
  const login = await request('/api/v1/auth/jellyfin','POST',{
    username:'MediaHubSystem', password,
    ...(!status.initialized && (status.mediaServerType === undefined || status.mediaServerType === 4) ? { hostname:'127.0.0.1', port:18798, urlBase:'', useSsl:false, serverType:2 } : {}),
  });
  if (login.data?.id !== 1 || !login.cookie) throw Error('Could not authenticate the private discovery administrator.');
  const call = (path,method,data) => request(path,method,data,{ Cookie:login.cookie });
  await call('/api/v1/settings/main','POST',{ applicationTitle:'Media Hub discovery', defaultPermissions:0,
    localLogin:false, mediaServerLogin:true, newPlexLogin:true });
  const libraries = (await call('/api/v1/settings/jellyfin/library/sync','POST',{})).data;
  if (!Array.isArray(libraries)) throw Error('Discovery could not read the Jellyfin libraries.');
  for (const library of libraries.filter(x => ['Movies','TV Shows'].includes(x.name))) {
    await call(`/api/v1/settings/jellyfin/library/${encodeURIComponent(library.id)}`,'PUT',{enabled:true});
  }
  if (viewerIds.length) await call('/api/v1/user/import-from-jellyfin','POST',{jellyfinUserIds:viewerIds});
  if (!status.initialized) await call('/api/v1/settings/initialize','POST',{});
  return { configured:true, requestsEnabled:false, importedProfiles:viewerIds.length, localOnly:true,
    message:'Discovery is connected to Jellyfin. Sign into Seerr in Moonfin using your household profile. Requests are off.' };
}
