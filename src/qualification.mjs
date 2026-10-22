export function assessPreflight(host, { mode = 'qualification-home' } = {}) {
  const blockers = [];
  const development = mode === 'pro-development';
  if (!['qualification-home','pro-development'].includes(mode)) blockers.push('unknown-mode');
  if (!host || host.schemaVersion !== 1 || !host.machineId ||
      !Array.isArray(host.services) || !Array.isArray(host.listeners) || !Array.isArray(host.gpus) ||
      host.services?.some?.(row => !row || typeof row.name !== 'string' || !row.name) ||
      host.listeners?.some?.(row => !row || !Number.isInteger(row.port) || row.port < 1 || row.port > 65535)) {
    blockers.push('inventory-incomplete');
  }
  if (!(development ? ['Professional','ProfessionalN'] : ['Core', 'CoreN', 'CoreSingleLanguage', 'CoreCountrySpecific']).includes(host?.editionId)) {
    blockers.push(development ? 'windows-pro-required' : 'windows-home-required');
  }
  if (!Number.isInteger(host?.buildNumber) || host.buildNumber < 22000) blockers.push('windows-11-required');
  if (host?.architecture !== 'AMD64') blockers.push('windows-x64-required');
  if (!host?.model || !host?.manufacturer ||
      /virtual|vmware|qemu|kvm|parallels|xen|amazon ec2|google compute/i.test(`${host?.manufacturer} ${host?.model}`)) {
    blockers.push('physical-host-required');
  }
  if (!Array.isArray(host?.gpus) || !host.gpus.some(gpu => gpu && /nvidia|intel|amd|radeon/i.test(gpu.name || '') && gpu.driverVersion &&
      !/virtual|parsec|basic display/i.test(gpu.name))) blockers.push('gpu-required');
  if (!development && Array.isArray(host?.services) && host.services.some(service => service && /jellyfin|seerr|aiostream|mediahub|media-hub|sonarr|radarr/i.test(service.name || ''))) {
    blockers.push('existing-media-service');
  }
  if (Array.isArray(host?.listeners) && host.listeners.some(listener => listener && (development ? [18796,18797,18798,18799,18800] : [8096,8920,5055,3000,18796,18797]).includes(listener.port))) {
    blockers.push('existing-media-port');
  }
  return { status: blockers.length ? 'blocked' : development ? 'ready-for-isolated-development' : 'ready-for-lab',
    qualified: false, homeCompatibility: 'unverified', blockers };
}
