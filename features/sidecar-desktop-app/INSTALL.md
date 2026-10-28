# Installing the bfstats Sidecar

The Sidecar lets you join a live BF1942 server and play it in your browser. You
don't need the game installed.

## 1. Install

Download from the latest **Sidecar desktop** release:
https://github.com/sila-skandia/bfstats/releases?q=sidecar-desktop

**Windows**
1. Download `bfstats-sidecar-<version>-x64.exe`.
2. Run it and choose **Only for me**. You won't need admin rights.
3. If Windows shows "Windows protected your PC", click **More info**, then
   **Run anyway**.

**Linux (AppImage)**
1. Download `bfstats-sidecar-<version>-x86_64.AppImage`.
2. Run `chmod +x bfstats-sidecar-*.AppImage`.
3. Run the AppImage once. This registers the links the site uses.

**Linux (Arch)**: `sudo pacman -U bfstats-sidecar-<version>-x64.pacman`

**Linux (Debian/Ubuntu)**: `sudo apt install ./bfstats-sidecar-<version>-amd64.deb`

The app runs in your system tray, and closing its window doesn't quit it.

**GNOME only:** without the AppIndicator extension there is no tray icon, and the
app opens as a normal window instead. That window lists the steps to add the
extension.

## 2. Turn on "Play in Browser" on bfstats.io

The site hides this option for now.

1. Open bfstats.io in a desktop browser.
2. Press **F12**, open the **Console** tab, paste the line below and press Enter:
   ```js
   localStorage.setItem('bfstats.sidecarJoin', '1')
   ```
3. Reload the page.

## 3. Join a server

1. Open a server, click **Connect**, then click **Play in Browser**.
2. When your browser asks to open **bfstats Sidecar**, allow it.
3. The Sidecar opens the game in a new tab. If Chrome or Edge asks for
   **local network access**, click **Allow**. The page needs it to talk to the
   app on your PC.
4. The page shows "Connecting to ..." and then the live game. In the tray, the
   icon dot turns green.

You can also join from inside the app. It has its own live server list.

## If it doesn't work

- **Clicking Play in Browser does nothing.** The app isn't registered. Run the
  AppImage or the installer again.
- **The page says "Can't reach the sidecar".** Check that the app is running.
  Then allow local network access for the site in your browser's site settings
  and click **Retry**.
- **Windows Firewall asks about bfstats Sidecar.** Allow it on **Private**
  networks.
- **Logs** are behind the Logs button in the app's panel.

## Phones

Android and iOS have their own app, **bfstats.io**. It has its own server list,
so you just tap a server and press **Join**. A phone doesn't need a PC. On
iPhone the game leaves the server about 15 seconds after you switch to another
app.
