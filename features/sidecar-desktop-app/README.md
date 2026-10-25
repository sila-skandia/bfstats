# Sidecar desktop app: join real servers from a tray app

The UDP sidecar (`features/udp-sidecar`) plays a real BF1942 round in the
browser, but it runs from a terminal in a repo checkout and reads the game
install. This folder covers shipping it as a tray app that joins servers listed
on bfstats.io.

Not public yet. It stays private until testing is done. Android is out of scope
for now.

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
| template id table, hull and soldier layouts (`template-table.mjs`) | `python3 sidecar_tid_table.py` on the install, per mod/level/mode | baked per exported level and mode, published beside the level bake, fetched and cached |
| animation states, control point names (`game-tables.mjs`) | `python3 sidecar_tables.py`, per mod/level/mode | same bake |
| `objects.rfa` CRC for the ChallengeResponse (`objects-checksum.mjs`) | CRC of the install's archive, 0 without it | bundled per-mod table, like `content-crc.json` |
| content CRC Ack (`content-crc.mjs`) | install rows, then bundled `content-crc.json` | bundled table (already there) |
| CD key (`cdkey.mjs`) | generated once into `~/.config/bfstats-sidecar` | unchanged |

The live server list (`/stats/LiveServers/bf1942/servers`) gives each server's
`mapId`, `mapName` and `gameType`, so a join can fetch the level's tables
before it connects. A level change mid-session is fetched when SetLevel
arrives.

## Platform notes

- **GNOME has no tray by default.** On GNOME the tray icon only shows with the
  AppIndicator extension. KDE and Windows show it as-is. Installing it on Arch:

  ```bash
  sudo pacman -S gnome-shell-extension-appindicator
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

- [ ] Bake the sidecar's per-level tables for every exported level and mode;
      publish them; the sidecar fetches and caches them, the install becomes
      optional
- [ ] Bundle the per-mod `objects.rfa` CRCs
- [x] WebSocket origin allowlist in `sidecar/wsserver.mjs`
- [x] Electron tray app: menu, child sidecar per join, log viewer, settings,
      `bfstats-sidecar://join/<ip:port>` handler, single instance
- [x] Linux AppImage build (and pacman); Windows NSIS config (builds on Linux
      through wine; not yet run on Windows)
- [x] Gated "Play in browser" item in the site's connect menu
- [ ] Windows: a clean leave. `child.kill('SIGINT')` cannot signal a process
      on Windows, so Leave and Quit end the sidecar at once and the server
      keeps the player about 20 s. Needs a leave command the sidecar reads
      (stdin or IPC), which touches `sidecar.mjs`
- [ ] Bundle (or drop) the Python table helpers: a packaged sidecar finds no
      `sidecar_tid_table.py` / `sidecar_tables.py` and logs its recorded-table
      FALLBACK lines; the install-free tables above replace them

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
| `src/menu-model.js` | the menu as data: `SECTIONS` of functions of the app's context. The tray menu and the panel window both draw it. A new item is a new entry in a section (or a new section), with a unique `id` |
| `src/sidecar-session.js` | one sidecar child per join (`process.execPath` with `ELECTRON_RUN_AS_NODE=1`), `--out`/`--review` into the app's data dir, SIGINT and wait to leave, the first free socket port from the setting |
| `src/sidecar-status.js` | the sidecar's console lines to the status line. `test/app.test.js` also checks that `sidecar.mjs` still prints each line it reads |
| `src/address.js` | strict `host:port` and `bfstats-sidecar://join/<host>:<port>[?name=]` parsing; nothing is spawned for anything else |
| `src/servers.js` | the live list (`/stats/LiveServers/bf1942/servers`): populated first, `[AC]` for anticheat, `[PW]` for a password, Cyrillic names decoded as the site does |
| `src/tray-support.js` | whether a tray will be seen (a `org.kde.StatusNotifierWatcher` owner on the session bus) |
| `src/linux-integration.js` | the `.desktop` handler entry, `xdg-mime default`, the autostart entry |
| `src/ui/*` | the panel, join, logs and settings windows (sandboxed, one preload bridge) |

What it does:

- **Menu:** status line (Idle / Joining X / In game on X - map / Rejoining /
  Ended: why), Join server (the live list, refreshed every 60 s and from
  "Refresh list"; empty servers in their own submenu), Recent servers, Join by
  address..., Open viewer, Leave server, View logs, Settings..., Start at login,
  Quit.
- **A join** stops the session there is (SIGINT, then waits for its exit;
  killed after 6 s), starts the sidecar with
  `<host:port> --name <n> --team <t> --ws <port> --out ... --review ...
  --allow-origin <viewer origin>`, and when the sidecar prints `live feed:`
  opens `<viewer base>map.html?sidecar=127.0.0.1:<port>` in the default
  browser. Quitting the app leaves the server first.
- **Data** (Linux): `~/.config/bfstats-sidecar-desktop/` holds
  `settings.json`, `recordings/` (each session's `.ndjson` and
  `.review.ndjson`) and `logs/` (`app.log` and `sidecar.log`, 2 MB each, five
  rolled copies). The sidecar's own CD key store stays in
  `~/.config/bfstats-sidecar`.
- **Settings:** player name (default `BrowserSoldier`), team (auto, 1, 2),
  viewer base (default `https://mesh.bfstats.io/`; the Local preset is
  `http://localhost:5273/`, the repo's viewer server), socket port (default
  17942; the next free port is used if it is taken).
- **No tray (stock GNOME):** the app opens a panel window that draws the same
  menu, with a notice explaining the AppIndicator extension until "Got it".
  Closing the panel quits the app (and leaves the server). A desktop
  notification marks joined and ended sessions either way.

### Run it in dev

```bash
cd tools/sidecar-desktop
npm install          # electron 44.7.0, electron-builder 26.17.0, pinned
npm test             # node --test: parsing, status lines, menu model, settings, logs
npm start            # the tray app from this checkout
npm run register-linux   # bfstats-sidecar:// links open this checkout's app
xdg-open 'bfstats-sidecar://join/127.0.0.1:14568'   # the lab server
```

`register-linux` writes `~/.local/share/applications/bfstats-sidecar.desktop`
(Exec = this checkout's electron + the app folder) and runs `xdg-mime default`.
Run it from the checkout you want links to open; run it again after moving it.
The packaged app rewrites the same entry for itself at each start.

Two environment variables exist for checks: `SIDECAR_DESKTOP_DATA=<dir>`
gives a run its own data folder (and so its own single-instance lock), and
`SIDECAR_DESKTOP_NO_BROWSER=1` logs the viewer URL instead of opening it.

### Build it

```bash
npm run dist:linux   # dist/bfstats-sidecar-<v>-x86_64.AppImage and -x64.pacman
npm run dist:win     # dist/bfstats-sidecar-<v>-x64.exe (NSIS); builds on Linux with wine
npm run icons        # rebuild assets/ from ui/public/favicon.ico (16 px, scaled nearest-neighbour)
```

The packaged app carries `tools/bf1942-models/sidecar` as
`resources/sidecar` (extraResources). The sidecar imports nothing outside that
folder; it only shells out to the optional Python helpers beside it.

### On this PC

- The tray icon on GNOME needs the AppIndicator extension ("Platform notes"
  above; the same steps are in `tools/sidecar-desktop/README.md`). Until it
  is on, the panel window stands in for it.
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
