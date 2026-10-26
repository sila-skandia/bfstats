# Sidecar desktop app: join real servers from a tray app

The UDP sidecar (`features/udp-sidecar`) plays a real BF1942 round in the
browser, but it runs from a terminal in a repo checkout and reads the game
install. This folder covers shipping it as a tray app that joins servers listed
on bfstats.io.

Not public yet. It stays private until testing is done. Android is its own folder,
`features/sidecar-android-app`.

## Decisions (2026-10-25)

- **No game install assumed.** Most users will have one, but not all. Anything
  the sidecar reads from the install today must come from somewhere else, with
  the install used only as an optional source.
- **A visible tray app, not a hidden daemon.** Right click opens a menu: status,
  join, leave, open the viewer, view logs, settings, quit. More discoverability
  tricks get added to this menu over time.
- **No site-side detection of the helper.** Probing `ws://127.0.0.1` from
  bfstats.io makes Chrome show a local network access prompt, and the helper is
  not public. Joins start from a dedicated link scheme, `bfstats-sidecar://`,
  which only works on a machine with the app installed. The site shows that
  link only when a localStorage flag is set.
- **Allowed WebSocket origins:** `https://bfstats.io`, `https://www.bfstats.io`,
  `https://mesh.bfstats.io`, `https://play.bfstats.io` (where
  `mesh.bfstats.io/map.html` redirects, so it is the page's real origin), and
  localhost (`http(s)://localhost`, `127.0.0.1`, `[::1]`, any port) while
  testing. Clients that send no Origin header (the node lab probes) are still
  allowed, because browsers always send one.
- **Electron.** The sidecar is Node with only built-in modules, so it runs in
  Electron's own Node (`ELECTRON_RUN_AS_NODE`) unchanged, one child process per
  join. Electron also provides the tray, the protocol handler, and installers
  for Linux (AppImage) and Windows (NSIS).

## What the install provided, and what replaces it

| input | today | install-free source |
|---|---|---|
| template id table, hull and soldier layouts (`template-table.mjs`) | `python3 sidecar_tid_table.py` on the install, per mod/level/mode | baked per exported level and mode, published beside the level bake, fetched and cached (done, below) |
| animation states, control point names (`game-tables.mjs`) | `python3 sidecar_tables.py`, per mod/level/mode | same bake (done) |
| `objects.rfa` CRC for the ChallengeResponse (`objects-checksum.mjs`) | CRC of the install's archive, 0 without it | bundled `objects-crc.json` (done) |
| content CRC Ack (`content-crc.mjs`) | install rows, then bundled `content-crc.json` | bundled table (already there) |
| CD key (`cdkey.mjs`) | generated once into `~/.config/bfstats-sidecar` | unchanged |

The live server list (`/stats/LiveServers/bf1942/servers`) gives each server's
`mapId`, `mapName` and `gameType`, so a join can fetch the level's tables
before it connects. A level change mid-session is fetched when SetLevel
arrives.

## The level tables without the install (2026-10-25)

**Baked here, published beside the level bake.** On this PC, which has the
install:

```
cd tools/bf1942-models   # from the repo root
node sidecar/bake-tables.mjs --mods bf1942,xpack1,xpack2,desertcombat,fh --jobs 10
```

For every level in a tree's `maps.json` (FHSW and FHSWEurope: only the rows
with a `loading` block) and every game type that level ships (its root
`<mode>.con`, `sidecar_level_modes.py`), it writes the values the sidecar's
sync lookups return, computed by the same code:

```
viewer/maps/<level>/sidecar/<mode>.json              bf1942
viewer/maps/mods/<mod>/<level>/sidecar/<mode>.json   every other mod
{ format: 1, mod, level, mode,
  tids: { v, names, classes, specs, hulls, soldiers },   template-table.mjs
  animStates, cpNames }                                  game-tables.mjs
```

An unchanged file is not rewritten. Publish only those files, so nothing else
pending in the shared tree goes with them:

```
mkdir -p ~/.cache/sidecar-tables-publish/maps
cd viewer/maps
find . -path '*/sidecar/*.json' -not -path './mods/dc_final/*' -not -path './mods/eod/*' \
  -not -path './mods/fhsw*' | cpio -pdl ~/.cache/sidecar-tables-publish/maps
cd ../../../..   # the repo root
scripts/publish-mesh-delta.py maps --root ~/.cache/sidecar-tables-publish
```

mesh.bfstats.io serves them at `https://mesh.bfstats.io/maps[/mods/<mod>]/<level>/sidecar/<mode>.json`,
gzipped per request (nginx `gzip_types` has `application/json`; no `.gz`
needed). Cloudflare does not cache them (`cf-cache-status: DYNAMIC`), so a
rebake is live as soon as it lands.

| tree | tables | raw | bake |
|---|---|---|---|
| bf1942 | 77 | 15.9 MB | 286 tables in 28 s, 10 workers |
| xpack1 | 98 | 23.2 MB | |
| xpack2 | 111 | 30.3 MB | |
| desertcombat | 109 | 45.9 MB | 129 tables in 24 s |
| fh | 20 | 28.2 MB | |

415 files, 143.5 MB on the volume; a vanilla table is about 216 KB, 33-40 KB
on the wire. Not baked: EoD (817 tables), FHSW (224) and FHSWEurope (352, about
12.8 MB each, so 4.5 GB), and DC Final, which is not published at all. A
sidecar on those mods still needs the install, or falls back to the recorded
`templates/<level>.json`.

**Resolution order.** `template-table.mjs` and `game-tables.mjs` stay
synchronous and resolve memo -> local cache (the install's computed table,
then a downloaded bake, both under `~/.cache/bfstats-sidecar/<mod>/`) -> the
install (Python is spawned only when `Mods/<mod>` exists) -> null, and the
callers fall back to `templates/<level>.json`. The download is async:
`level-tables.mjs` `prepareLevel({mod, level, mode})` checks the cache, then
the install, then fetches `<SIDECAR_TABLES_URL>` (default
`https://mesh.bfstats.io/`, `--tables-url`, `off` for none) into
`<level>-<mode>.baked.json`, with the response's `ETag` and `Last-Modified`
kept beside it (`_http`). mesh.bfstats.io sends both through Cloudflare (a
weak ETag on the gzipped body) and answers `If-None-Match` or
`If-Modified-Since` with 304 (checked 2026-10-25). So a cached copy is
revalidated on every join and SetLevel (a second ask within 60 s reuses the
answer): 304 keeps it, 200 replaces it and the memoised lookups re-read it,
and a failure or no answer within 3 s (`revalidateMs`) uses the cached copy
as it is, so offline still plays. A cached copy whose `tids.v` is not this
sidecar's code version is logged and fetched whole (no validators, the full
timeout), and the fresh copy is preferred. It is called

- before the ConnectRequest, from the level the server says it plays
  (`server-query.mjs`: its GameSpy `\status\` on game port + 8433 or + 7433,
  or the bfstats.io live list row's `mapId`, `mapName`, `gameType`;
  `--query-port`, `--no-prejoin`);
- on every SetLevel. `Session` handles what the server sends through one
  ordered queue of events and ghost streams, and `levelGate` holds it from
  the SetLevel on until prepareLevel resolves or `--level-wait` (30 s) runs
  out. No createObject is named, no ghost body decoded and no world dump
  acked (content Ack, CreatePlayerAck, DatabaseCompleteAck at
  DataBaseComplete) before the tables are there, as the retail client loads
  its level before it answers.

The mod key is the server's ServerInfo `mod` (or the live list's `mapId`) in
lower case: `bf1942` is the root tree, anything else `maps/mods/<mod>`. A
level is its directory name in lower case, spaces to underscores (`market
garden` -> `market_garden`). A miss is logged once and never ends the
session.

**objects.rfa CRCs.** `sidecar/objects-crc.json` holds every installed mod's
CRC (`node sidecar/objects-checksum.mjs --build`). The install's archive wins
when it is there.

**Content CRCs.** `content-crc.json` already held every row of every
`contentCrc32.con` the install ships (bf1942, XPack1, XPack2, GCMOD); no
other mod ships one.

**Checked** (`tests/test_sidecar_level_tables.py`, against a local HTTP
server with no install), and on the lab (Wake co-op) with `BF1942_DIR` an
empty directory, an empty `SIDECAR_CACHE` and no Python on PATH: the
sidecar fetched `maps/wake/sidecar/coop.json`, held the world dump for the
5.5 s download (`--no-prejoin`), then joined with all 86 createObjects named
and classed and the 1395-state animation table, and no fallback.

## Platform notes

- **GNOME has no tray by default.** On GNOME the tray icon only shows with the
  AppIndicator extension. KDE and Windows show it as-is. Installing it:

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

  These steps belong in the app's install instructions too.
- **Chrome and the page on mesh.bfstats.io.** An https page that opens a
  WebSocket to `127.0.0.1` makes Chrome ask once for local network access.
  Firefox does not ask. A local viewer (`http://localhost:...`) never asks.

## Tasks

- [x] Bake the sidecar's per-level tables for every exported level and mode;
      publish them; the sidecar fetches and caches them, the install becomes
      optional (vanilla, RtR, SW, DC, FH; EoD, FHSW and FHSWEurope not baked,
      see above)
- [x] Bundle the per-mod `objects.rfa` CRCs
- [x] WebSocket origin allowlist in `sidecar/wsserver.mjs`
- [x] Electron tray app: menu, child sidecar per join, log viewer, settings,
      `bfstats-sidecar://join/<ip:port>` handler, single instance
- [x] Linux AppImage build (and pacman, deb); Windows NSIS config (builds on
      Linux through wine; installs and uninstalls in a Wine prefix; not yet
      run on Windows)
- [x] Windows audit and CI (`.github/workflows/sidecar-desktop.yml`; "Windows")
- [ ] The first run on a real Windows machine ("First Windows run: the checklist")
- [ ] Code signing for the Windows installer
- [x] Gated "Play in browser" item in the site's connect menu
- [x] A clean leave on every platform: the app runs the sidecar with
      `--leave-on-stdin` and writes `leave` on its stdin (plus SIGINT where
      signals exist); stdin closing, the app gone, leaves too. Not yet run on
      Windows
- [x] The packaged app needs no Python: the table helpers only run when
      `Mods/<mod>` is installed, and the published tables cover the rest

## The socket's origin allowlist

`sidecar/wsserver.mjs` `originAllowed` checks the upgrade's Origin against
`ALLOWED_ORIGINS` and `http(s)://localhost|127.0.0.1|[::1]` on any port.
Anything else gets a 403 and a `[sidecar] page refused: origin ...` line. A
request with no Origin connects (browsers always send one; the node lab
probes send none). `--allow-origin <origin>` adds one, and is repeatable; the
desktop app passes the viewer base's origin this way, so a custom viewer
works. Tested by `tests/test_sidecar_ws_origin.py`.

## The tray app (`tools/sidecar-desktop`)

| file | |
|---|---|
| `src/main.js` | lifecycle, single-instance lock, joins, tray, windows, IPC |
| `src/menu-model.js` | the tray menu as data: `SECTIONS` of functions of the app's context. A new item is a new entry in a section (or a new section), with a unique `id` |
| `src/panel-state.js` | what the popup panel draws, from the same context: the session card (map image, round time, tickets, Playing as), the live list, recent servers, the name source |
| `src/panel-position.js` | where the popup opens: against the tray icon's bounds on the taskbar's side, clamped to the work area, or a corner of the primary display's work area |
| `src/map-image.js` | the map preview URL, `https://bfstats.io/stats/assets/maps/<gameId>/<map_slug>` (as `ui/src/utils/mapImage.ts`) |
| `src/sidecar-engine.js` | which sidecar a join runs (the native Kotlin binary or Node), where the binary is (packaged, dev), the arguments both take, the child's environment; pure ("Engines" below) |
| `src/sidecar-session.js` | one sidecar child per join (the engine's command; Node is `process.execPath` with `ELECTRON_RUN_AS_NODE=1`), the Kotlin-to-Node fallback, `--out`/`--review` into the app's data dir, `leave` on stdin (and SIGINT) and wait to leave, the first free socket port from the setting |
| `src/sidecar-status.js` | the sidecar's console lines to the status line. `test/app.test.js` also checks that `sidecar.mjs` still prints each line it reads |
| `src/game-install.js` | the BF1942 install (Settings, the registry's `GAMEDIR`, default paths) and its profiles' player names, for the name setting |
| `src/account.js` | the bfstats.io sign-in (PKCE browser hand-off to a one-shot loopback listener), the tokens (refresh with rotation, the refresh token under `safeStorage`), the account's game profiles and switching (features/app-sign-in) |
| `src/address.js` | strict `host:port` and `bfstats-sidecar://join/<host>:<port>[?name=]` parsing; nothing is spawned for anything else |
| `src/servers.js` | the live list (`/stats/LiveServers/bf1942/servers`): populated first, `[AC]` for anticheat, `[PW]` for a password, Cyrillic names decoded as the site does; keeps `gameId`, the map image URL, `roundTimeRemain`, `tickets1`/`tickets2` and the team labels for the panel |
| `src/tray-support.js` | whether a tray will be seen (a `org.kde.StatusNotifierWatcher` owner on the session bus), and `watchTray`, which reports it coming and going (`gdbus monitor`, else a 10 s poll) |
| `src/app-mode.js` | tray mode or window mode, the steps of a live switch, Start at login's visibility, the one-time "still running" notice, `/etc/os-release` parsing and the tray hint's per-distro commands; pure |
| `src/linux-integration.js` | the `.desktop` handler entry, `xdg-mime default`, the autostart entry |
| `src/ui/*` | the panel (`panel.*`, its own stylesheet and the bundled Geist fonts in `fonts/`, OFL), join, logs and settings windows (sandboxed, one preload bridge) |

What it does:

- **Menu:** status line (Idle / Joining X / In game on X - map / Rejoining /
  Ended: why), Join server (the live list, refreshed every 60 s and from
  "Refresh list"; empty servers in their own submenu), Recent servers, Join by
  address..., Open viewer, Leave server, View logs, Settings..., Start at login,
  Quit.
- **A join** stops the session there is (`leave` on stdin and SIGINT, then waits for its exit;
  killed after 6 s), starts the sidecar with
  `<host:port> --name <n> --team <t> --ws <port> --out ... --review ... --leave-on-stdin
  --allow-origin <viewer origin>` (and `--name-from-page` when the name is
  the viewer's profile's), and when the sidecar prints `live feed:`
  opens `<viewer base>map.html?sidecar=127.0.0.1:<port>` in the default
  browser. Quitting the app leaves the server first.
- **Data** (Linux): `~/.config/bfstats-sidecar-desktop/` holds
  `settings.json`, `recordings/` (each session's `.ndjson` and
  `.review.ndjson`) and `logs/` (`app.log` and `sidecar.log`, 2 MB each, five
  rolled copies). The sidecar's own CD key store stays in
  `~/.config/bfstats-sidecar`. Windows: see "Windows" below.
- **Settings:** player name, from your bfstats.io profile (default: signed in,
  the active profile's name as `--name`; signed out, `--name-from-page`; see
  features/app-sign-in), a profile of this PC's game install, or a custom name
  (default `BrowserSoldier`, also the fallback; features/game-profiles, "Tray
  app"), team (auto, 1, 2),
  viewer base (default `https://mesh.bfstats.io/`; the Local preset is
  `http://localhost:5273/`, the repo's viewer server), socket port (default
  17942; the next free port is used if it is taken).
- **The panel** (2026-10-25): a borderless, rounded, dark popup in the site's
  V4 identity. Top to bottom: the header (icon, status dot in the tray icon's
  green/orange, logs, settings, close); the session card (the map's preview
  image behind the server name, map, mode, players, the round time counting
  down and the tickets as one Axis/Allied split bar when the live list has the
  server, Playing as, Open viewer, Leave), or a compact "Not on a server" card
  with the name the next join uses; the server browser (Live and Recent tabs,
  a filter over name, map, mod and address, rows with the map thumbnail,
  `AC`/`PW` badges and a players bar, one click joins, 60 rows then "Show
  all"); Join by address inline; the footer's name source and Settings. It
  reads `state.panel` from the `app:state` broadcast. Since 2026-10-25 the
  panel is where everything lives; the right-click menu is only a brief of
  the session, Open panel and Quit (`src/menu-model.js`). Map images come from bfstats.io (`img-src` allows only that host);
  a 404 falls back to a gradient and is not asked for again.
  - **Windows, KDE:** a left click on the tray icon toggles it, placed by the
    icon (`tray.getBounds()`, the display nearest it, clamped to its work
    area). It hides when it loses focus, on Escape and from its close button.
  - **GNOME (AppIndicator):** the extension keeps a single left click (and
    the right click) for the menu, and sends `Activate` on a double click,
    which Electron reports as the tray's `click`: a double click opens the
    panel (checked 2026-10-25 by calling `org.kde.StatusNotifierItem.Activate`
    on the app's item; the extension's `indicatorStatusIcon.js`
    `vfunc_button_press_event`). The brief menu's "Open panel" is the other
    way in. Linux trays report no bounds: the panel asks
    for the top-right corner of the primary display's work area. On a native
    Wayland session the compositor places it instead (a Wayland client cannot
    place its own window); `SIDECAR_DESKTOP_X11=1` runs the app under XWayland
    where the position holds, but on this PC Chromium's GPU process crashed
    there, so it is not the default. A window shown from a menu click is not
    given focus on GNOME Wayland, so the close button and Escape (once the
    panel has been clicked) are the dependable ways to hide it; it hides on
    blur once it has had focus.
  - **No tray (stock GNOME):** window mode, below. A desktop notification
    marks joined and ended sessions either way.

### Closing hides; tray mode and window mode (2026-10-26)

The owner closes apps to get them out of the way and expects them to keep
running. So closing never quits, on any platform.

- **Closing hides.** The panel's X, the window's close button and Alt+F4 hide
  the panel (`close` is prevented); the app keeps running and on its server.
  Quit is the panel's footer Quit or the tray menu's Quit; the OS ends it with
  SIGTERM/SIGINT/SIGHUP (logout on Linux), `powerMonitor` `shutdown` (Linux,
  macOS) and the window's `session-end` (Windows). Each goes through
  `app.quit()`, whose `before-quit` leaves the server first. (The sidecar
  also leaves when its stdin closes, so an app killed outright still leaves.)
- **Two modes** (`src/app-mode.js`, pure and tested). **Tray mode** where a
  tray icon is seen: Windows and macOS always, Linux when something owns
  `org.kde.StatusNotifierWatcher` (KDE, XFCE, GNOME with AppIndicator), and
  Linux when that cannot be told (no `gdbus`). The panel is the popup.
  **Window mode** on Linux without a watcher (stock GNOME on Fedora, Arch,
  Debian): the panel is a normal framed window (min 340x560), in the dock and
  Alt+Tab, minimisable; no tray icon is made. Launching the app again (the
  launcher entry, a `bfstats-sidecar://` link) reaches the running copy
  through the single-instance lock, whose `second-instance` handler restores,
  shows and focuses the panel. The first hide in window mode shows one
  notification, "bfstats Sidecar is still running. Open it again from your app
  launcher; quit from its Quit button." (`hiddenNoticeShown` in
  `settings.json`).
- **The tray hint** (window mode, until "Got it", `trayNoticeDismissed`):
  says closing keeps the app running, then on GNOME the three steps: install
  (this PC's distro from `/etc/os-release` `ID`, then `ID_LIKE`: Arch,
  Fedora (and RHEL-likes), Debian and Ubuntu; the others fold under "Other
  distros"; all three when the distro is not known), log out and in, and
  `gnome-extensions enable appindicatorsupport@rgcjonas.gmail.com`. Each
  command has a copy button (`clipboard:write`, one line of at most 200
  characters). Not on GNOME, it says a panel with a StatusNotifierItem tray
  shows the icon.
- **The live switch.** `tray-support.js` `watchTray` runs `gdbus monitor` on
  `org.freedesktop.DBus` and reads `NameOwnerChanged` for the watcher (and
  rechecks `NameHasOwner` once the monitor is up, for a change in between);
  if `gdbus monitor` cannot run or exits, it polls `NameHasOwner` every 10 s.
  A change settles for 1 s (a shell restart drops and retakes the name), then
  window to tray makes the tray, rebuilds the panel as a popup (hidden; a
  notification says the app is in the tray if the window was showing) and
  drops the hint; tray to window destroys the tray and shows the panel
  window. `SIDECAR_DESKTOP_PANEL=popup|window` fixes the mode and turns the
  switch off.
- **Start at login** is shown in tray mode only (Windows included): in window
  mode the app would open a window at every login. The settings window
  follows a live switch.
- **The launcher entry.** `linux-integration.js` `desktopEntry` is a visible
  launcher entry (Name, Icon, Categories=Game, Keywords, the scheme's
  MimeType, `StartupWMClass=bfstats-sidecar`), written by `npm run
  register-linux` for a checkout and by the AppImage at each start, to
  `~/.local/share/applications/bfstats-sidecar.desktop`. The pacman package
  carries electron-builder's own entry from `build.linux.desktop`
  (`/usr/share/applications/bfstats-sidecar.desktop`, with the icon set from
  `assets/icons`). No deb target is configured.

### Engines: the native Kotlin sidecar, Node as the fallback (2026-10-26)

One sidecar implementation for every player is the aim
(`features/sidecar-android-app`, "Open"): the Kotlin core in
`tools/sidecar-android/core` already runs the Android app, and on Linux it
now runs the tray app's joins too, as a native executable (Kotlin/Native
linuxX64, 16 MB, libcurl linked in, no JVM, no Node). The Node sidecar
(`tools/bf1942-models/sidecar`) stays as the parity reference the Kotlin
port is tested against, Windows' engine until a Windows native build exists,
and the fallback everywhere.

- **The setting.** Settings > Sidecar engine: `kotlin` (Native, the default)
  or `node`, stored as `engine` in `settings.json`, used from the next join.
  `kotlin` runs Node, and the log says why, when no native build exists for
  the platform (anything but Linux x64) or the binary is missing.
- **The fallback.** A Kotlin child that cannot be spawned, or that exits
  before printing its first `[sidecar]` line (a loader error, a crash at
  start), is replaced by the Node one with the same arguments; the app log
  says `engine: the kotlin sidecar ... ; running the node sidecar`. A Kotlin
  sidecar that started and then failed (denied, port in use) is not replaced:
  that is the server or the PC, not the engine.
- **Same contract.** Both take the arguments the app passes
  (`HOST:PORT --name --team --ws --out --review --leave-on-stdin
  [--name-from-page] [--allow-origin]`), print the console lines
  `sidecar-status.js` reads, leave on `leave` on stdin, on stdin closing and
  on SIGINT (exit 0, after the Disconnect), read `BF1942_DIR`,
  `SIDECAR_CACHE`, `SIDECAR_TABLES_URL`, `SIDECAR_LIVE_LIST` and
  `SIDECAR_CDKEY_FILE`, and keep the CD keys in the same
  `~/.config/bfstats-sidecar/cdkeys.json` in the same bytes, so a player
  keeps one identity across engines. Differences: the Kotlin CLI refuses
  `127.0.0.1:14567` (this PC's server1) without `--force`, and leaves cleanly
  on SIGTERM too, where Node dies.
- **Where the binary is.** Packaged: `resources/sidecar-native/bfstats-sidecar-core`
  (`build.linux.extraResources`). Dev: the Gradle output,
  `tools/sidecar-android/core/build/bin/linuxX64/sidecarReleaseExecutable/sidecar.kexe`.
  `SIDECAR_DESKTOP_NATIVE=<path>` overrides both. `npm run build-sidecar`
  builds it (`gradlew -PcoreOnly=true :core:linkSidecarReleaseExecutableLinuxX64`;
  `-PcoreOnly` leaves the Android app out, so no Android SDK is needed, only a
  JDK for Gradle; about 75 s cold, seconds when nothing changed). A dev
  checkout without it runs Node and says so.
- **Fixed in the Kotlin CLI on the way** (`tools/sidecar-android/core`,
  CLI and platform layer): a `leave` on stdin hung the native process until
  stdin closed (`readlnOrNull` blocked holding stdin's FILE lock, which
  glibc's `exit()` then waited on; stdin is now read with `read(2)`); SIGINT
  exited 130 instead of 0; the server1 guard refused every server on port
  14567 (the game's default, so most public servers) and now applies to
  loopback only; a taken page-socket port aborted with a stack instead of
  Node's `listen EADDRINUSE ... 127.0.0.1:<port>` line, which the status
  parser reads.

Verified 2026-10-26 on the lab (`sidecar-wake`, 127.0.0.1:14568), through
`SidecarSession` and `resolveEngine` as `main.js` drives them, as
`skandia-sc`: each engine pre-joined (`the server plays wake coop`, `server
name: bfstats-lab`), joined (`joined as player 0 team 2: 9 players`), held 60
s with the status reading "In game on bfstats-lab - Wake, Coop - 9 players at
join - Playing as skandia-sc", left on stdin and exited 0 in about 150 ms;
the server's event log has a `createPlayer` and a `disconnectPlayer` 64 s
apart for each (a clean Disconnect, not the 20 s timeout). The CD-key file
written by either engine in an empty HOME was read by the other without a
byte changed (mode 600, `JSON.stringify(k, null, 2)` + newline), and the real
`~/.config/bfstats-sidecar/cdkeys.json` kept its hash across both joins. The
dev app and the unpacked package both logged `kotlin sidecar` for a join;
`SIDECAR_DESKTOP_NATIVE=/bin/false` fell back to Node with the reason logged.

### Run it in dev

```bash
cd tools/sidecar-desktop
npm install          # electron 44.7.0, electron-builder 26.17.0, pinned
npm test             # node --test: parsing, status lines, menu model, settings, logs
npm run build-sidecar   # the native Kotlin sidecar (Linux; needs a JDK 17+ for Gradle)
npm start            # the tray app from this checkout
npm run register-linux   # bfstats-sidecar:// links open this checkout's app
xdg-open 'bfstats-sidecar://join/127.0.0.1:14568'   # the lab server
```

`register-linux` writes `~/.local/share/applications/bfstats-sidecar.desktop`
(Exec = this checkout's electron + the app folder) and runs `xdg-mime default`.
Run it from the checkout you want links to open; run it again after moving it.
The packaged app rewrites the same entry for itself at each start.

Environment variables for checks: `SIDECAR_DESKTOP_DATA=<dir>` gives a run
its own data folder (and so its own single-instance lock),
`SIDECAR_DESKTOP_NO_BROWSER=1` logs the viewer URL instead of opening it,
`SIDECAR_DESKTOP_PANEL=popup|window` forces tray mode or window mode (window
fakes a desktop without a tray; either turns the live switch off),
`SIDECAR_DESKTOP_TRAY_WATCHER=<bus name>` watches that name in place of
`org.kde.StatusNotifierWatcher` (hold it from a script to check the live
switch), and `SIDECAR_DESKTOP_X11=1` runs under XWayland. A second start with
the same data folder shows the panel (or joins, with a link).

### Build it

```bash
npm run dist:linux   # build-sidecar, then dist/bfstats-sidecar-<v>-x86_64.AppImage, -amd64.deb and -x64.pacman
npm run dist:win     # dist/bfstats-sidecar-<v>-x64.exe (NSIS); builds on Linux with wine
npm run icons        # rebuild assets/ from the site logo, ui/src/assets/clippy_my_boi.webp
```

The packaged app carries `tools/bf1942-models/sidecar` as
`resources/sidecar` (extraResources). The sidecar imports nothing outside that
folder; it only shells out to the optional Python helpers beside it. The Linux
packages also carry the native sidecar as
`resources/sidecar-native/bfstats-sidecar-core` (`build.linux.extraResources`);
`scripts/after-pack.js` fails a Linux build without it (or
`SIDECAR_DESKTOP_NODE_ONLY=1` ships Node only) and makes it executable. No
Java ships. Sizes on 2026-10-26 (v0.1.0): AppImage 126 MB, deb 100 MB, pacman
92 MB; the native sidecar is 16 MB of that unpacked, 4 to 5 MB compressed.
CI (`.github/workflows/sidecar-desktop.yml`) builds it on the Linux runner
(JDK 17 and 25, Gradle, `~/.konan` cached) before the tests, and smokes
both engines from the checkout and from the packaged app; the Windows job is
Node only.

### On this PC

- The tray icon on GNOME needs the AppIndicator extension ("Platform notes"
  above; the same steps are in `tools/sidecar-desktop/README.md`). Until it
  is on, the app runs in window mode, and moves to the tray when it is.
- After merging, run `npm install && npm run register-linux` from the main
  checkout's `tools/sidecar-desktop` (or start the AppImage once).

### Verified (2026-10-25)

- Dev app on GNOME Wayland without a watcher: tray reported not visible
  (`gnome-no-appindicator`), the panel opened with the notice; panel, join,
  settings and logs windows drawn (screenshots over the remote debugging port).
- `xdg-open 'bfstats-sidecar://join/127.0.0.1:14568'` through the registered
  entry: the app started, spawned the sidecar, and opened
  `https://mesh.bfstats.io/map.html?sidecar=127.0.0.1:17942`.
- A second link while joined left the first server (SIGINT, exit 0) and
  joined the next; an invalid link (`join/--inspect=0.0.0.0:9229`) was
  ignored. SIGTERM to the app left the server before it exited.
- The AppImage: started, registered the handler, and through a second
  instance's link joined the lab (`joined as player 0 team 2: 9 players`),
  status "In game", then left cleanly on quit.

### Verified: the panel (2026-10-25)

- `npm test`: 19 pass, among them the tray-anchored position (bottom, top,
  left and right taskbars, a display at negative x, no bounds), the corner
  position and the shrink to a short screen; the live list's new fields; the
  panel state for joined, joining, idle and ended sessions.
- Dev app on GNOME Wayland (`SIDECAR_DESKTOP_PANEL=popup`, its own data
  folder), screenshots over the remote debugging port: idle, joining and in
  game on the lab server `127.0.0.1:14567` (`BF1942 server1`, Wake, the map
  image behind the card, Playing as the fallback name), the Recent tab, a
  filter, a listed round (clock and tickets, drawn from an injected state as
  the lab is not on the live list) with a 100-character server name
  ellipsised in the card and the row, and the 340x560 minimum (the card drops
  its headroom and address line, the list keeps 120 px). The no-tray window
  with its notice. Escape and the close button hide the popup; Leave left the
  server; quitting while joined left first.
- Not seen: where GNOME Wayland places the popup, and the Windows/KDE tray
  anchoring on a real taskbar (no screen capture here; the positions are
  unit-tested).

### Verified: closing hides, the two modes (2026-10-26)

- `npm test`: 47 pass (13 new); `test/app-mode.test.js` covers the mode decision
  (forced, Windows, no watcher, cannot tell), Start at login, the one-time
  notice, the switch steps, os-release parsing (quotes, escapes, comments),
  the distro family by `ID` and `ID_LIKE` (Arch, EndeavourOS, Manjaro,
  Fedora, Rocky, Debian, Ubuntu, Pop, openSUSE), the hint's order, the
  panel carrying the hint in window mode only, the launcher entry, and
  `watchTray` against a stand-in `gdbus monitor` (appear, vanish, the
  recheck, the poll fallback).
- Dev app on GNOME Wayland (Arch, the AppIndicator extension on), each run
  with its own data folder, checked over the remote debugging port:
  - **Window mode** (`SIDECAR_DESKTOP_PANEL=window`): the window opened with
    the hint (Arch first, "This PC"); a copy button copied and showed its
    tick; a multi-line copy was refused. `BrowserWindow.close()` (the path
    of the window's X) hid it, logged the notice and set
    `hiddenNoticeShown`; a second launch showed it again; a second hide gave
    no second notice. A `bfstats-sidecar://join/127.0.0.1:14567` launch
    joined the lab with the window hidden (`joined as player 0 team 2`); a
    hide and a show while in game kept the session. Settings had no Start at
    login. "Got it" dropped the hint. The panel's Quit left the server
    (`leaving (asked on stdin)`, sidecar exit 0) and the app exited.
  - **Tray mode** (the real watcher): a second launch opened the popup;
    `BrowserWindow.close()` and the X button hid it, with no notice;
    `org.kde.StatusNotifierItem.Activate` on the app's item (what GNOME's
    double click sends) showed it again. Settings had Start at login.
    SIGTERM quit.
  - **Live switch** (`SIDECAR_DESKTOP_TRAY_WATCHER=org.example.BfstatsFakeWatcher`,
    held by a Gio script): started in window mode; taking the name switched
    to tray mode (the panel window went, the tray item registered with the
    real watcher); Activate opened the popup; dropping the name switched
    back (the item unregistered, the window came up with the hint).
- Not seen: Windows (the close, `session-end` and Start at login paths are
  the same code with no tray check), KDE, and a real install of the
  extension mid-run (the switch was driven with a stand-in name). In
  Electron, a renderer's own `window.close()` destroys the window without a
  `close` event; nothing in the panel calls it.

## Windows (2026-10-26)

Audited for the owner's first Windows run; the app and the sidecar stay one
code path on both platforms. What was found and done:

| area | finding | done |
|---|---|---|
| sidecar folders | cache and CD keys under `~/.cache`, `~/.config` (worked, un-Windows-like) | `sidecar/paths.mjs`: `%LOCALAPPDATA%\bfstats-sidecar\cache`, `%APPDATA%\bfstats-sidecar\cdkeys.json` on Windows; Linux unchanged |
| sidecar game folder | default was the Wine path everywhere, and the app never passed one, so a Windows install was never read | `paths.mjs` tries the Windows default folders; the app passes the folder it found (`game-install.js findGameDir`) as `BF1942_DIR`, so the challenge's objects.rfa CRC is the install's |
| install but no Python | an install with the mod spawned `python3` per level (on Windows that is the Microsoft Store alias, exit 9009), synchronously | `level-tables.mjs installCanCompute`: the Python helpers must be beside the sidecar (never in the packaged app) and `python -c` must answer 3 within 5 s, asked once per process; otherwise one log line and the published tables. `python` on Windows, `python3` elsewhere; runs get `windowsHide` and a 120 s timeout |
| packaged table version | the bundle lacks the two Python files `template-table.mjs` hashes, so the packaged sidecar's version (`aa51ca51e16f`) never matched the bake's (`543d65cba852`): every join fetched the tables whole and warned "baked by other code" (Linux AppImage too) | `scripts/after-pack.js` writes the repo's version into `resources/sidecar/table-version.txt` and checks the bundle reads it; the hash reads CRLF as LF. Checked: the packaged sidecar downloads Wake co-op, then revalidates it with a 304 |
| bundled resources | nothing imports outside `sidecar/` | `after-pack.js` fails the build if any relative import leaves the bundle or points at nothing |
| leave over stdin | already the path on Windows (no signals to a child) | smoke-tested under the Windows build's own binary in Wine: `leave` and stdin closing both send the Disconnect and exit 0 |
| GameSpy pre-join query | plain `dgram`, nothing POSIX | smoke-tested on win32 (Wine) |
| registry | `reg` from PATH; `GAMEDIR` only; HKLM only | `%SystemRoot%\System32\reg.exe`; `GAMEDIR`, else `Install Dir`; the HKCU key too; Origin Games default folders |
| protocol, packaged | electron-builder's `protocols` registers nothing on Windows; the app's own `setAsDefaultProtocolClient` only ran after the first start, and nothing removed it | `build/installer.nsh` writes `HKCU\Software\Classes\bfstats-sidecar` at install and removes it (and the Start at login value) at uninstall, not on an update. Checked by installing the built NSIS installer silently in a Wine prefix: the key and `"...\bfstats-sidecar.exe" "%1"`, then gone after the uninstall |
| protocol, dev | `setAsDefaultProtocolClient(scheme, electron, [app dir])` | right as it was |
| start at login | a dev run would have registered bare `electron.exe` | `main.js` passes Electron plus the app folder in dev |
| toasts | AUMID `io.bfstats.sidecar` = the installer shortcut's: right packaged; a dev run has no shortcut, so no toasts | `main.js` uses `process.execPath` as the AUMID in dev |
| safeStorage | DPAPI, read after `ready` | right as it was |
| popup placement | DIP throughout (`tray.getBounds`, `getDisplayNearestPoint`, work area), taskbar on any edge unit-tested | `main.js` sets the bounds twice on Windows, for a move onto a display of another scale factor |
| single instance, argv | the lock is keyed by the data folder; `linkFromArgv` finds the link among Chromium's switches | right as it was |
| firewall | the WebSocket, the port probe and the sign-in listener bind `127.0.0.1` (never a prompt). The UDP game socket binds all interfaces (libuv binds explicitly before any send, so there is no implicit-bind variant to choose); Windows may ask once for bfstats Sidecar | documented (app README, "Firewall"); binding to one interface would break on VPN and route changes |
| tests on Windows | `node --test test/` fails on Windows (a directory is not a glob there); two tests compared POSIX paths | `npm test` is `node --test "test/*.test.js"`; the paths are the host's. All 42 pass under the Windows build's Node in Wine |

**CI.** `.github/workflows/sidecar-desktop.yml`, Windows and Ubuntu: `npm
ci`, `npm test`, `scripts/smoke-sidecar.js` (the sidecar under the
platform's Electron with `ELECTRON_RUN_AS_NODE=1` against a stand-in server
that answers the GameSpy query and accepts the connect: the pre-join line,
the no-Python fall-through, `live feed:`, the socket's Origin check, a
Disconnect and exit 0 on `leave` and on stdin closing), electron-builder
(NSIS; AppImage, deb, pacman), the smoke test again from the unpacked build,
checksums, artifacts; a `sidecar-desktop-v*` tag makes a release. Not run
yet (written 2026-10-26, unpushed); parsed, and every step run here.

**Open, needing a real Windows machine:** the firewall prompt and whether
Cancel affects joining; SmartScreen's wording; the tray popup's place on a
real taskbar (bottom, top, side, auto-hide), across monitors and at 125-200 %
scaling; toasts; the registry lookup against a real retail, Origin and EA App
install; the protocol link from Chrome and Edge. Code signing (an OV or EV
certificate, or Azure Trusted Signing) is not done; until it is, SmartScreen
warns on every new version.

### First Windows run: the checklist

Note anything that differs, with `%APPDATA%\bfstats-sidecar-desktop\logs\app.log`
and `sidecar.log`.

1. **Install.** Download `bfstats-sidecar-<v>-x64.exe` from the workflow's
   `sidecar-desktop-win` artifact (or a release). SmartScreen: More info, Run
   anyway (note the exact wording). Choose Only for me; no admin prompt.
   Finish with "Run" ticked.
2. **Tray.** The icon shows (maybe under `^`). Hover: "bfstats Sidecar: Idle".
   Right click: the brief menu (status, Sign in..., Open panel, Quit).
3. **Popup placement.** Left click: the panel opens against the icon, inside
   the screen, above a bottom taskbar. Click elsewhere, Escape, and the icon
   again each close it. If you can: taskbar on the top or a side, a second
   monitor, 150 % scaling; the panel stays by the icon and the right size.
4. **Sign in.** Sign in with bfstats.io: the browser opens, Allow, the card
   shows the account. Quit and start the app from the Start menu: still
   signed in (DPAPI), no "without a keyring" note.
5. **Profile switch.** Pick another profile in the panel; the footer's name
   follows, and the site shows it active.
6. **Join a live server.** One click in Live. Note any firewall dialog, what
   it says, and pick Allow. The browser opens `map.html?sidecar=127.0.0.1:17942`
   (Chrome asks once for local network access); the tray dot goes orange then
   green, a toast says In game; play a minute. `sidecar.log` names the game
   folder (`game folder ...` in `app.log`) and no Python line other than one
   "Python helpers are not here" when the install has the mod.
7. **Leave.** Leave in the panel: the dot clears, `sidecar.log` ends with
   `leaving (asked on stdin)`, and the scoreboard drops you at once (not 20 s
   later).
8. **Quit while joined.** Join again, then Quit from the tray: the app leaves
   the server first, then exits (no `bfstats-sidecar.exe` left in Task
   Manager).
9. **Protocol link.** On bfstats.io, in the console:
   `localStorage.setItem('bfstats.sidecarJoin', '1')`, reload, open a
   server's connect menu, "Play in Browser". With the app closed it starts and
   joins; with it running the running copy joins (no second tray icon).
10. **Start at login.** Turn it on in Settings, sign out of Windows and in:
    the tray icon is back, no window.
11. **Uninstall.** Quit, then Settings > Apps > bfstats Sidecar > Uninstall.
    Afterwards a `bfstats-sidecar://` link does nothing, Start at login is gone
    (Task Manager > Startup), and `%APPDATA%\bfstats-sidecar-desktop` is
    still there (delete it by hand to remove the data).

## The site's "Play in browser" item

`ui/src/components/v4/MmServerConnectAction.vue` shows a "Play in Browser"
item linking to `bfstats-sidecar://join/<ip>:<port>` in the connect menu,
only where the browser has the flag:

```js
localStorage.setItem('bfstats.sidecarJoin', '1')   // on bfstats.io, in the console
localStorage.removeItem('bfstats.sidecarJoin')     // to hide it again
```

Nothing probes for the app. Without it installed the link does nothing.
`e2e/server-connect.spec.ts` checks it is hidden without the flag and links
right with it.
