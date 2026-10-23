# Watch on your TV

1. Start Coveframe and choose **Start my media apps** on Dashboard.
2. Choose **Set up my TV**. Keep the PC and TV on the same home Wi-Fi or wired network.
3. Choose your home connection, then **Enable TV access**. Read the permission popup. Windows may ask to run **Windows PowerShell** to add the home-TV firewall rule.
4. Install Moonfin on your TV. Android/Google TV uses the Play Store, Fire TV uses the Amazon Appstore, and Apple TV uses the App Store. See the [official Moonfin installation guide](https://github.com/Moonfin-Client/Moonfin-Core/wiki/Installation) for other devices, including the separate Samsung/LG client. Store guidance checked October 22, 2026.
5. In Moonfin, add a server manually. Enter the complete **Server address for your TV** shown by Coveframe, including `http://` and `:18799`. Sign in with your household name and password.
6. Play a title, seek forward, stop and resume. Check audio and subtitles. **Check connection** can detect another device reaching the server; it cannot verify that the TV played a title successfully.

Keep Coveframe open and the PC awake. Add streaming titles using **Find titles** on the PC; the discovery page is not shared with the TV. TorBox Essential + Real-Debrid Premium remains the recommended source setup. TV connection does not change subscriptions or connect saved provider keys.

## If Windows says Public

Only on your own trusted home network, open **Windows Settings → Network & internet → your Wi-Fi or Ethernet connection → Network profile type → Private**. Return to Coveframe and choose **Scan again**. Coveframe never changes a Public network to Private itself. Guest Wi-Fi and corporate networks may block devices from reaching each other.

## If it cannot connect

Open **Get help with Codex** at the bottom of **Your TV**. Review the generated prompt, choose **Copy Codex prompt**, then paste it into Codex on this PC. Add your TV model and what went wrong. It includes selected plans, connection status and the local network address, with no API keys or passwords. If clipboard access is unavailable, the prompt is selected for manual copying.

- Use the address shown by Coveframe, never `localhost` or `127.0.0.1` on the TV.
- Check both devices use the same network. Guest Wi-Fi or access-point isolation can prevent access.
- Check that media apps are running and the PC is awake. **Stop all apps** also stops TV access.
- If the PC address changes, choose **Update TV connection** and update the server address in Moonfin. Saved TV access is checked on app restart; a missing adapter, Public profile or missing firewall permission leaves it off with instructions.
- A VPN may have a local-network blocking option. Use its trusted-LAN setting if available. No router port forwarding is required.
- If sign-in works but playback fails, check your sources on the PC and try an available title. A network connection does not guarantee provider availability or codec support.

## What changes on the PC

Coveframe binds a separate media gateway to the selected private IPv4 address on TCP **18799**. It accepts clients only in that adapter's subnet and retains Jellyfin's sign-in. Its firewall rule is limited to the Coveframe Node runtime, Private profiles and LocalSubnet. Network checks repeat while access is on. No UDP discovery, UPnP or router changes are made. Entering the server address manually is expected.

This is HTTP for a trusted home network, without internet sharing or TLS. The setup wizard stays on loopback port **18797**, and source/download services remain loopback-only. Playback redirects are fetched on the PC so client links do not expose the internal provider bridge. Jellyfin media traffic, JSON link translation and WebSockets use the gateway. The architecture follows Jellyfin's [reverse-proxy requirements](https://jellyfin.org/docs/general/post-install/networking/reverse-proxy/), including WebSocket support; forwarded client headers are stripped and the gateway enforces its own subnet restriction.

**Turn off TV access** closes the gateway and saves the choice. The inactive firewall rule remains available for re-enabling; uninstall asks Windows to remove it. Canceling removal preserves the app data for retry. Boot/startup testing remains deferred, and this feature has not yet been qualified on a physical TV or a clean Windows PC.
