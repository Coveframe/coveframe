# Coveframe 0.7.1 Beta 1

- A small **Get help** button appears in the same place on every setup step. The Codex prompt opens only on request, includes the current step and household choices, and refreshes on open and copy. Close or Escape returns to setup; API keys and passwords remain excluded.
- Added setup, Dashboard and help-dialog screenshots to the README, using simulated demo data.
- Public beta naming throughout the launcher, README and About this PC. Includes the streaming wizard, TorBox Essential + Real-Debrid Premium recommendation, optional download consent and home-network TV setup from 0.7.0.

Download the Windows x64 ZIP, extract the entire folder and open **Coveframe.exe**. No VM, Docker or separate Node installation is needed. Connect your own provider accounts in the local wizard. Optional Radarr/Sonarr downloads explain and confirm the official Decypharr executable before it runs.

To update: **Quit Coveframe**, extract the beta into a new folder and open its launcher. Keep the same data folder for accounts and settings, and retain your old release until the beta works. Do not run both together.

This beta is unsigned. Physical-TV playback, the real Windows firewall permission, clean-PC setup, full completed-download/import, broad provider seek/audio/subtitle reliability and vendor-app upgrade/rollback checks remain incomplete. Real-Debrid supports completed cloud-library files through the local bridge. Boot testing remains deferred. Follow normal Windows trust decisions; do not disable antivirus or bypass Windows protection.

# Coveframe 0.7.0 — friends preview

Download the Windows x64 ZIP, extract the whole folder and open **Coveframe.exe**. Follow the seven-step local wizard. Recommended: **TorBox Essential + Real-Debrid Premium**; basic posters need no personal API key. Optional ratings and downloads can wait.

- Your TV includes a collapsed **Get help with Codex** section. Copy a prompt with current setup choices and connection status, review it, then paste into Codex. Keys, passwords and raw error messages are excluded; manual copying is available when clipboard access fails.

- Streaming stays the recommended start. A short comparison explains why you might add Radarr and Sonarr for saved files and new episodes.
- Optional download apps require a confirmation before installing or starting. The popup names Decypharr.exe, links its official GitHub release and identifies it as unsigned. Cancel keeps the apps off.
- Source provider requests use a local bridge to the official APIs. AIOStreams receives local session tokens. TorBox checks cached search results; Real-Debrid uses completed files in your cloud library. General Real-Debrid cache discovery is not provided through a third-party relay.
- Redesigned all seven setup steps, Dashboard, Settings, Find titles and About this PC with consistent dark panels, clearer actions and shorter expandable guidance. Mobile gets compact step navigation, stacked forms and a persistent Back / Continue bar.
- Default AppData startup works with Windows packaged-folder redirection.
- Your TV now detects home adapters, offers a media-only server address and guides Moonfin sign-in. Enabling access requires a permission review; the Windows firewall rule allows TCP 18799 on Private networks for local devices only. Public networks are blocked. The wizard, provider APIs and download controls stay PC-only.
- TV playback links are resolved on the PC, including seek/range requests; internal localhost URLs are translated for clients. Dashboard and Settings link back to TV setup. Saved TV access resumes with the media apps when the same adapter is still Private; turning it off closes the listener, and uninstall removes its firewall permission with Windows approval.
- TV instructions cover Android/Google TV, Fire TV, Apple TV and other clients, plus connection checks and troubleshooting. Physical TV playback and the real Windows permission prompt still need a household test. The current development PC's connection is Public and was left unchanged.

This is an unsigned preview. Physical-TV playback and the real Windows firewall permission still need household qualification; full completed-download/import, clean-PC, audio/subtitle and software-update checks remain incomplete. Some provider playback has been checked, but broad coverage and reliability are not guaranteed. Real-Debrid supports completed files in your cloud library; general cache discovery is not available through the local bridge. Boot testing remains deferred.

To update from 0.6.0: **Quit Coveframe**, extract this release into a new folder and open its launcher. Keep the same data folder and retain the old release until the new one works. Do not run both together. Vendor-app upgrades and rollback are not yet qualified.

# Coveframe 0.6.0 — preview

Unsigned Windows x64 preview for local testing. This is not yet a general-use release.

## Changes

- A quieter dashboard, Settings, gentle transitions and reduced-motion support.
- About this PC explains downloads, pinned versions, ports, storage and privacy.
- Stop all apps keeps the dashboard open. Quit Coveframe stops the owned apps and closes the wizard.
- Uninstall removes downloaded software, app databases, profiles, settings and saved keys after confirmation. Media and streaming library links are kept. Delete the extracted launcher folder yourself after closing the tab.
- Removal verifies installation ownership and refuses linked or unrelated folders. Failed shutdown prevents removal.
- Public source and build scripts: https://github.com/Coveframe/coveframe.
- Diagnostic output avoids raw provider responses. AIOStreams sensitive logging is explicitly disabled; discovery logging is reduced to errors.

## Included setup

The wizard provisions separate Jellyfin, Moonbase/Moonfin web, household profiles, AIOStreams and optional Seerr discovery. TorBox Essential + Real-Debrid Premium is recommended. TorBox Pro is available for Usenet. Multiple providers are supported; purchase subscriptions directly from them. Basic posters need no personal metadata key.

Find titles adds streaming library links. Optional downloads connect Radarr, Sonarr, Prowlarr and Decypharr, with 1080p profiles and the public Knaben indexer. Downloads require an explicit request.

## Privacy and trust

No administrator rights, VM, Docker, separate Node installation or Windows service is needed. This preview is unsigned. Follow your normal Windows trust decisions. Do not disable antivirus or bypass Windows protection. Publisher signing remains future work.

Saved credentials use Windows DPAPI for the current user. Connected apps also need private local databases/configuration; vendor logs and playback URLs may contain access credentials. Do not share the data directory. Coveframe runs no account or telemetry server. Providers, metadata services and the selected public indexer receive requests needed for their features.

## Remaining verification

- Boot testing is deferred. No automatic startup is configured.
- Real paid-account streaming, seeking, subtitles and provider fallback need testing.
- The first completed debrid download and library import need testing.
- TV/LAN access is not enabled; this preview binds to 127.0.0.1.
- Coordinated software updates and recovery are unfinished. Settings changes preferences, not app binaries.
- Premiumize can be planned but is not connected yet.

Existing media installations are not adopted or changed. After uninstall, retained media can be reused by setting up a new household.
