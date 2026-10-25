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
- **Allowed WebSocket origins:** `https://bfstats.io`, `https://mesh.bfstats.io`,
  and localhost (`http(s)://localhost`, `127.0.0.1`, `[::1]`, any port) while
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
`<level>-<mode>.baked.json`. It is called

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
- [ ] WebSocket origin allowlist in `sidecar/wsserver.mjs`
- [ ] Electron tray app: menu, child sidecar per join, log viewer, settings,
      `bfstats-sidecar://join/<ip:port>` handler, single instance
- [ ] Linux AppImage build; Windows NSIS config
- [ ] Gated "Play in browser" item in the site's connect menu
