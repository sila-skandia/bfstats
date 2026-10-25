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
- [ ] WebSocket origin allowlist in `sidecar/wsserver.mjs`
- [ ] Electron tray app: menu, child sidecar per join, log viewer, settings,
      `bfstats-sidecar://join/<ip:port>` handler, single instance
- [ ] Linux AppImage build; Windows NSIS config
- [ ] Gated "Play in browser" item in the site's connect menu
