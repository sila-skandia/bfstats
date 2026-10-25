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

### The panel

A small dark popup, and the place everything lives: the server you are on
(its map behind the card, the round time and tickets when bfstats.io lists
the server, Open viewer, Leave), the live servers to join with one click,
Recent, Join by address, where your player name comes from, Logs, Settings
(Start at login is there) and Quit.

- **Windows, KDE:** left-click the tray icon; it opens by the icon and closes
  when you click elsewhere, press Escape, or click it again.
- **GNOME:** double-click the icon. A single click (or a right click) opens
  the brief menu instead, which has **Open panel** too: the AppIndicator
  extension keeps the single click for its menu. The panel closes from its X
  button, on Escape, or when you click elsewhere after using it.
- **No tray** (GNOME without the extension): the panel is the app's window;
  closing it quits.

### The tray menu

The tray icon carries a dot while you are on a server: orange while joining
(or rejoining, or leaving), green in game. The right-click menu is a brief of
where you are: the session's state, the server's name and address, its map,
game type and player count, and the name you play as; then Open panel and
Quit.

### Your player name

Settings > Player name says where the name you join as comes from:

- **From the viewer's profile** (the default). The profile on your
  bfstats.io account: import it once from the game on the site's profile
  page, and the viewer sends its player name as it opens. The app opens the
  viewer before it connects and waits up to 15 s for that name; without one
  (signed out, no profile) it joins as the custom name, or the name the
  viewer gave last time.
- **A profile from this PC's game install.** The player names of
  `Mods/bf1942/Settings/Profiles/*` in your BF1942 folder. The app finds the
  folder (on Windows from the registry, else the default install paths; on
  Linux under `~/.wine`); set it in Settings when it is somewhere else.
- **Custom name.** The name typed in Settings.

The menu's session header shows "Playing as <name>" once the name is known.

A `bfstats-sidecar://join/<host>:<port>`
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
`SIDECAR_DESKTOP_NO_BROWSER=1` logs the viewer URL instead of opening it;
`SIDECAR_DESKTOP_PANEL=popup|window` forces the panel's kind;
`SIDECAR_DESKTOP_X11=1` runs under XWayland on a Wayland session, so the
panel can place itself (the default lets the compositor place it).
