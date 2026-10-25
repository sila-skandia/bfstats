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

- [x] Bake the sidecar's per-level tables for every exported level and mode;
      publish them; the sidecar fetches and caches them, the install becomes
      optional (vanilla, RtR, SW, DC, FH; EoD, FHSW and FHSWEurope not baked,
      see above)
- [x] Bundle the per-mod `objects.rfa` CRCs
- [x] WebSocket origin allowlist in `sidecar/wsserver.mjs`
- [x] Electron tray app: menu, child sidecar per join, log viewer, settings,
      `bfstats-sidecar://join/<ip:port>` handler, single instance
- [x] Linux AppImage build (and pacman); Windows NSIS config (builds on Linux
      through wine; not yet run on Windows)
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
| `src/sidecar-session.js` | one sidecar child per join (`process.execPath` with `ELECTRON_RUN_AS_NODE=1`), `--out`/`--review` into the app's data dir, `leave` on stdin (and SIGINT) and wait to leave, the first free socket port from the setting |
| `src/sidecar-status.js` | the sidecar's console lines to the status line. `test/app.test.js` also checks that `sidecar.mjs` still prints each line it reads |
| `src/game-install.js` | the BF1942 install (Settings, the registry's `GAMEDIR`, default paths) and its profiles' player names, for the name setting |
| `src/address.js` | strict `host:port` and `bfstats-sidecar://join/<host>:<port>[?name=]` parsing; nothing is spawned for anything else |
| `src/servers.js` | the live list (`/stats/LiveServers/bf1942/servers`): populated first, `[AC]` for anticheat, `[PW]` for a password, Cyrillic names decoded as the site does; keeps `gameId`, the map image URL, `roundTimeRemain`, `tickets1`/`tickets2` and the team labels for the panel |
| `src/tray-support.js` | whether a tray will be seen (a `org.kde.StatusNotifierWatcher` owner on the session bus) |
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
  `~/.config/bfstats-sidecar`.
- **Settings:** player name, from the viewer's profile (default:
  `--name-from-page`), a profile of this PC's game install, or a custom name
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
  reads `state.panel` from the `app:state` broadcast; the tray menu stays as
  it was. Map images come from bfstats.io (`img-src` allows only that host);
  a 404 falls back to a gradient and is not asked for again.
  - **Windows, KDE:** a left click on the tray icon toggles it, placed by the
    icon (`tray.getBounds()`, the display nearest it, clamped to its work
    area). It hides when it loses focus, on Escape and from its close button.
  - **GNOME (AppIndicator):** the extension sends no click, so "Open panel"
    heads the right-click menu. Linux trays report no bounds: the panel asks
    for the top-right corner of the primary display's work area. On a native
    Wayland session the compositor places it instead (a Wayland client cannot
    place its own window); `SIDECAR_DESKTOP_X11=1` runs the app under XWayland
    where the position holds, but on this PC Chromium's GPU process crashed
    there, so it is not the default. A window shown from a menu click is not
    given focus on GNOME Wayland, so the close button and Escape (once the
    panel has been clicked) are the dependable ways to hide it; it hides on
    blur once it has had focus.
  - **No tray (stock GNOME):** the panel is a normal framed window (min
    340x560) with a notice explaining the AppIndicator extension until "Got
    it", and Quit in its footer. Closing it quits the app (and leaves the
    server). A desktop notification marks joined and ended sessions either way.

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

Environment variables for checks: `SIDECAR_DESKTOP_DATA=<dir>` gives a run
its own data folder (and so its own single-instance lock),
`SIDECAR_DESKTOP_NO_BROWSER=1` logs the viewer URL instead of opening it,
`SIDECAR_DESKTOP_PANEL=popup|window` forces the panel's kind (a popup check on
a desktop without a tray), and `SIDECAR_DESKTOP_X11=1` runs under XWayland. A
second start with the same data folder opens the panel (or joins, with a link).

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
