# bfstats Sidecar (desktop app)

A tray app that joins a BF1942 server through the UDP sidecar
(`tools/bf1942-models/sidecar`) and opens the browser viewer on it. Plan,
decisions and verification: `features/sidecar-desktop-app/README.md`.

## Install

### Linux (AppImage)

1. Download `bfstats-sidecar-<version>-x86_64.AppImage`, make it executable
   (`chmod +x`), and run it once. It adds "bfstats Sidecar" (with its icon)
   to the app launcher and registers itself as the handler for
   `bfstats-sidecar://` links (`~/.local/share/applications/bfstats-sidecar.desktop`).
2. Arch users can install `bfstats-sidecar-<version>-x64.pacman` instead:
   `sudo pacman -U bfstats-sidecar-<version>-x64.pacman` (its launcher entry
   is `/usr/share/applications/bfstats-sidecar.desktop`).

### Linux on GNOME: the tray icon

GNOME shows tray icons only with the AppIndicator extension. Without it the
app runs in window mode (below). To get the icon, install the extension:

```bash
sudo pacman -S gnome-shell-extension-appindicator      # Arch
sudo dnf install gnome-shell-extension-appindicator    # Fedora
sudo apt install gnome-shell-extension-appindicator    # Debian, Ubuntu
```

On Wayland, log out and back in so GNOME Shell sees the new extension, then
turn it on (or use the Extensions app):

```bash
gnome-extensions enable appindicatorsupport@rgcjonas.gmail.com
```

The window-mode panel shows the same steps, this PC's distro first, with copy
buttons. The app moves to the tray as soon as the extension is on; no
restart. KDE, XFCE and most other panels show the icon as they are.

### Windows

Run `bfstats-sidecar-<version>-x64.exe` (NSIS installer, per user). The app
registers `bfstats-sidecar://` when it starts.

## Use

### The panel

A small dark popup, and the place everything lives: your bfstats.io account
and game profiles, the server you are on (its map behind the card, the round
time and tickets when bfstats.io lists the server, Open viewer, Leave), the live servers to join with one click,
Recent, Join by address, where your player name comes from, Logs, Settings
(Start at login is there, in tray mode) and Quit.

- **Windows, KDE:** left-click the tray icon; it opens by the icon and closes
  when you click elsewhere, press Escape, or click it again.
- **GNOME:** double-click the icon. A single click (or a right click) opens
  the brief menu instead, which has **Open panel** too: the AppIndicator
  extension keeps the single click for its menu. The panel closes from its X
  button, on Escape, or when you click elsewhere after using it.
- **No tray** (GNOME without the extension): window mode. The panel is a
  normal app window, in the dock and Alt+Tab, and minimises. Launch the app
  again (the app launcher's "bfstats Sidecar", or a `bfstats-sidecar://`
  link) to bring it back. Start at login is not offered here.

**Closing never quits.** The panel's X, the window's close button and Alt+F4
hide the panel; the app keeps running and stays on its server. The first time
the window-mode panel is hidden, a notification says where it went. Quit from
the panel's footer or the tray menu; logging out or shutting down quits too.
Every quit leaves the server first.

### The tray menu

The tray icon carries a dot while you are on a server: orange while joining
(or rejoining, or leaving), green in game. The right-click menu is a brief of
where you are: the session's state, the server's name and address, its map,
game type and player count, and the name you play as; then the account
("Sign in..." signed out, a **Profile** submenu to switch profiles signed
in); then Open panel and Quit.

### Signing in

The panel's top card is your bfstats.io account. **Sign in with bfstats.io**
opens bfstats.io in your browser, where you click Allow; the card says
"Finish signing in in your browser" until then (Cancel stops it; it gives up
after 5 minutes). Signed in, it shows your account name and the profile you
play as; click it for the list of your game profiles and click one to make
it active (on the site too). **Import profiles on bfstats.io** opens the
site's Game profiles tab, where profiles are imported from the game. The
exit icon signs out (and ends this sign-in on bfstats.io).

The app keeps the sign-in encrypted in its data folder. On Linux without a
keyring service (gnome-keyring, KWallet) it is encrypted with a fixed key
instead, and the card says "Sign-in saved without a keyring". If bfstats.io
ends the sign-in (signed out from the site's Signed-in apps list, or the
account erased), the card says so once and the app is signed out.

### Your player name

Settings > Player name says where the name you join as comes from:

- **Your bfstats.io profile** (the default). Signed in, the active game
  profile's sidecar name when it has one, else its player name; the list is
  read again before each join. Signed out
  (or with no profile), the viewer's profile: the viewer sends its player
  name as it opens; the app opens the viewer before it connects and waits up
  to 15 s for that name, then joins as the custom name, or the name the
  viewer gave last time. (Settings saved before 2026-10-25 as "From the
  viewer's profile" become this.)
- **A profile from this PC's game install.** The player names of
  `Mods/bf1942/Settings/Profiles/*` in your BF1942 folder. The app finds the
  folder (on Windows from the registry, else the default install paths; on
  Linux under `~/.wine`); set it in Settings when it is somewhere else.
- **Custom name.** The name typed in Settings.

The menu's session header shows "Playing as <name>" once the name is known.

**A different name for the sidecar.** A profile can carry a sidecar name: the
name you play as through the app, while the game keeps its own. In the
panel's profile list, the pencil on a row edits it (Enter saves, the undo
icon goes back to the game name); the row then shows the sidecar name with
`game: <name>` beside it. The site's Game profiles tab has the same edit
(**Sidecar name** on each profile). At most 23 characters (what the server
keeps), Western European letters, no quotes.

A `bfstats-sidecar://join/<host>:<port>`
link (the "Play in Browser" item on bfstats.io, behind the
`bfstats.sidecarJoin` localStorage flag) joins too.

## Develop

```bash
npm install
npm test                 # node --test test/ (account.test.js runs the sign-in against scripts/stand-in-api.js)
node scripts/stand-in-api.js 18611 --many   # a stand-in bfstats.io sign-in and profiles API
npm start                # run from this checkout
npm run register-linux   # a launcher entry for this checkout, which bfstats-sidecar:// links open
npm run dist:linux       # AppImage + pacman in dist/
npm run dist:win         # NSIS installer in dist/ (on Linux this needs wine)
```

`SIDECAR_DESKTOP_DATA=<dir>` runs with its own data folder;
`SIDECAR_DESKTOP_NO_BROWSER=1` logs the viewer and sign-in URLs instead of
opening them; `SIDECAR_DESKTOP_AUTH_URL_FILE=<file>` writes the sign-in URL
there instead (a check fetches it); `SIDECAR_DESKTOP_SITE=<url>` and
`SIDECAR_DESKTOP_API=<url>` point the account at another bfstats.io (the
settings have both too); `SIDECAR_DESKTOP_MENU_FILE=<file>` writes the brief
menu's model there on every change;
`SIDECAR_DESKTOP_PANEL=popup|window` forces tray mode or window mode (window
fakes a desktop without a tray; either turns off the live switch);
`SIDECAR_DESKTOP_TRAY_WATCHER=<bus name>` watches another name in place of
`org.kde.StatusNotifierWatcher` (hold one with a script to check the switch);
`SIDECAR_DESKTOP_X11=1` runs under XWayland on a Wayland session, so the
panel can place itself (the default lets the compositor place it).
