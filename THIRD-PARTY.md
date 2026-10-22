# Separate third-party applications

Coveframe's MIT license covers its own launcher, wizard and integration code. Separate applications retain their licenses. No provider or upstream project endorses Coveframe.

Pinned versions, official download URLs and SHA-256 checksums are in `src/media-packages.mjs`. Node.js 24.15.0 and its license are included in the portable launcher. Seerr includes Node.js 22.23.4 and its license.

| Application | Source and licensing materials |
| --- | --- |
| Jellyfin | https://github.com/jellyfin/jellyfin — license and notices in the official archive |
| Moonbase / Moonfin | https://github.com/Moonfin-Client/Plugin — source and license at the pinned release |
| AIOStreams | https://github.com/Viren070/AIOStreams — AGPL-3.0; source, license, lockfile and build instructions bundled in its package |
| Seerr | https://github.com/seerr-team/seerr — MIT; license and build patch bundled in its package |
| Radarr | https://github.com/Radarr/Radarr — license and notices in the official archive |
| Sonarr | https://github.com/Sonarr/Sonarr — license and notices in the official archive |
| Prowlarr | https://github.com/Prowlarr/Prowlarr — license and notices in the official archive |
| Decypharr | https://github.com/sirrobot01/decypharr — license and notices in the official archive |
| Node.js | https://nodejs.org/ — license and bundled dependency notices accompany each runtime |

The wizard downloads verified official packages on request. AIOStreams and Seerr are separate pinned application bundles. Their build scripts and bundled source/patch materials describe their builds. Package hashes must match the reviewed manifest. Review source, license and dependency changes before replacing a pinned archive.

Providers and metadata/index services have their own accounts, terms and privacy policies. Supply your own keys and use only content you are authorized to access.
