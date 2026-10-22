import path from 'node:path';

export function buildLabPlan(inventory) {
  if (!inventory || !Array.isArray(inventory.services) || !Array.isArray(inventory.ports)) throw new Error('Complete isolation inventory required');
  const serviceName = 'MediaHubLabJellyfin', root = 'C:\\ProgramData\\MediaHubLab', port = 18796;
  if (inventory.services.some(name => typeof name !== 'string')) throw new Error('Invalid service inventory');
  if (inventory.services.some(name => name.toLowerCase() === serviceName.toLowerCase())) throw new Error('Lab service already exists');
  if (inventory.ports.includes(port)) throw new Error('Lab port is occupied');
  if (inventory.rootExists) throw new Error('Lab root already exists; inspect and preserve it');
  const serverDirectory = 'C:\\Program Files\\Jellyfin\\Server';
  const directories = ['data','config','cache','logs','media'].map(name => path.win32.join(root, name));
  return {
    schemaVersion: 1, project: 'media-hub-windows', purpose: 'Isolated native Jellyfin/GPU qualification',
    serviceName, displayName: 'Media Hub Lab - Jellyfin (isolated qualification)', root, directories, port,
    identity: 'NT Authority\\NetworkService', startMode: 'SERVICE_DEMAND_START',
    executable: path.win32.join(serverDirectory, 'jellyfin.exe'),
    wrapper: path.win32.join(serverDirectory, 'nssm.exe'),
    arguments: `--service --datadir "${directories[0]}" --configdir "${directories[1]}" --cachedir "${directories[2]}" --logdir "${directories[3]}"`,
    networkXml: `<?xml version="1.0" encoding="utf-8"?>\n<NetworkConfiguration>\n  <InternalHttpPort>${port}</InternalHttpPort>\n  <PublicHttpPort>${port}</PublicHttpPort>\n  <EnableHttps>false</EnableHttps>\n  <EnableIPv4>true</EnableIPv4>\n  <EnableIPv6>false</EnableIPv6>\n  <AutoDiscovery>false</AutoDiscovery>\n  <EnableUPnP>false</EnableUPnP>\n  <EnableRemoteAccess>false</EnableRemoteAccess>\n  <LocalNetworkAddresses><string>127.0.0.1</string></LocalNetworkAddresses>\n</NetworkConfiguration>\n`,
  };
}
