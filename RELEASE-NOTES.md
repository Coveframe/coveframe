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
