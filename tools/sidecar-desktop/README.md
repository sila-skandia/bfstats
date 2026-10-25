# bfstats Sidecar (desktop app)

A tray app that joins a BF1942 server through the UDP sidecar
(`tools/bf1942-models/sidecar`) and opens the browser viewer on it. Plan,
decisions and verification: `features/sidecar-desktop-app/README.md`.

## Install

### Linux (AppImage)

1. Download `bfstats-sidecar-<version>-x86_64.AppImage`, make it executable
   (`chmod +x`), and run it once. It registers itself as the handler for
   `bfstats-sidecar://` links (`~/.local/share/applications/bfstats-sidecar.desktop`).
2. Arch users can install `bfstats-sidecar-<version>-x64.pacman` instead:
   `sudo pacman -U bfstats-sidecar-<version>-x64.pacman`.

### Linux on GNOME: the tray icon

GNOME shows tray icons only with the AppIndicator extension. Without it the
app opens a window that stands in for the tray menu. To get the icon on Arch:

```bash
sudo pacman -S gnome-shell-extension-appindicator
```

On Wayland, log out and back in so GNOME Shell sees the new extension, then
turn it on (or use the Extensions app):

```bash
gnome-extensions enable appindicatorsupport@rgcjonas.gmail.com
```

KDE, XFCE and most other panels show the icon as they are.

### Windows

Run `bfstats-sidecar-<version>-x64.exe` (NSIS installer, per user). The app
registers `bfstats-sidecar://` when it starts.

## Use

Right-click the tray icon: Join server (the servers live on bfstats.io),
Recent servers, Join by address..., Open viewer, Leave server, View logs,
Settings..., Start at login, Quit. A `bfstats-sidecar://join/<host>:<port>`
link (the "Play in Browser" item on bfstats.io, behind the
`bfstats.sidecarJoin` localStorage flag) joins too.

## Develop

```bash
npm install
npm test                 # node --test test/
npm start                # run from this checkout
npm run register-linux   # make bfstats-sidecar:// links open this checkout
npm run dist:linux       # AppImage + pacman in dist/
npm run dist:win         # NSIS installer in dist/ (on Linux this needs wine)
```

`SIDECAR_DESKTOP_DATA=<dir>` runs with its own data folder;
`SIDECAR_DESKTOP_NO_BROWSER=1` logs the viewer URL instead of opening it.
