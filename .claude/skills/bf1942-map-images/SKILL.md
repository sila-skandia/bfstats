---
name: bf1942-map-images
description: >
  Extracts map preview images (menu thumbnails and in-game minimaps) from a
  Battlefield 1942 installation by decoding Refractor .rfa archives, and uploads them
  to the bfstats assets volume on the Hetzner cluster. Use this whenever the user wants
  map thumbnails, map previews, minimaps, loading screens, or any other art pulled out of
  BF1942 or one of its mods (Desert Combat, Forgotten Hope, FHSW, Eve of Destruction,
  Interstate 82, GC, BF1918, Road to Rome, Secret Weapons) — including when they only say
  "get the map images", "show the current map on the server card", "we need a picture for
  each map", or ask how to read a .rfa file at all. Also use it for uploading an already
  extracted maps/ tree to the filebrowser volume on Hetzner.
---

# BF1942 map preview images

Battlefield 1942 ships every map's art inside per-level `.rfa` archives. Two images per
level are worth having:

| Image inside the archive | What it is | Typical size |
|---|---|---|
| `<level>/Menu/thumbnail.dds` | the preview screenshot the map list shows | 128x128 (4:3 art, padded) |
| `<level>/Textures/InGameMap.dds` | the minimap, with grid and terrain | 512x512 |

`scripts/extract_map_images.py` decodes both and writes PNGs. It needs nothing beyond the
Python standard library and the system `liblzo2` (already present on Arch; `apt install
liblzo2-2` on Debian). No wine, no WinRFA, no pip install.

## Extracting

```bash
python3 scripts/extract_map_images.py \
  --game-dir "~/.wine/drive_c/EA Games/Battlefield 1942" \
  --out ./maps
```

Useful flags:

- `--minimaps` — also emit `<map>.map.png`. Off by default because it is the bulk of the
  output: on a full install thumbnails are ~10MB but minimaps are ~170MB at full size.
- `--minimap-size 256` — downscale minimaps (256px brings that 170MB down to ~80MB).
  PNG is a poor fit for photographic terrain, so this is the main lever on size.
- `--mods fhsw fh` — restrict to particular mod folders.
- `--no-crop` — keep the padded square thumbnail. By default thumbnails are cropped to
  their 4:3 artwork, since the bottom quarter of the texture is dead padding (usually
  black, sometimes white) that the game never displays.
- `--force` — re-extract images that already exist.

A full install (11 mods, ~950 level archives) yields ~820 maps in about 4 minutes.

## Output layout

```
maps/
├── manifest.json
├── bf1942/
│   ├── wake.png            <- thumbnail
│   ├── wake.map.png        <- minimap
│   └── battle_of_the_bulge.png
├── dc_final/
└── fhsw/
```

The directory is the mod folder name lowercased and the filename is the level folder name
lowercased. That is not arbitrary: it is exactly what bflist reports.

## Matching a live server to an image

`https://api.bflist.io/v2/bf1942/servers` returns `gameId` and `mapName` per server:

```json
{ "gameId": "fhsw", "mapId": "FHSW", "mapName": "operation coronet-1946" }
```

`gameId` is the mod folder and `mapName` is the level folder with underscores turned into
spaces. So the lookup is `maps/<gameId>/<mapName with spaces -> underscores>.png`. Two
things will bite you if you skip them:

**Casing is inconsistent in the live data.** The same mod appears as both `bf1942` and
`BF1942`, `eod` and `EOD`, `interstate` and `Interstate`. Map names vary too (`Berlin`
alongside `berlin`). Lowercase both sides before looking anything up.

**Mods inherit maps from their parents.** A mod's `init.con` declares where the engine
looks for content it does not ship itself:

```
game.addModPath Mods/FHSW/
game.addModPath Mods/FH/
game.addModPath Mods/Bf1942/
```

So an FHSW server can legitimately report `wake`, which only exists in the base game. The
generated `manifest.json` records each mod's `searchPath` and which image kinds exist per
map, so a miss can walk the same chain the game does rather than 404:

```json
{
  "version": 1,
  "mods": {
    "fhsw": {
      "searchPath": ["fhsw", "fh", "bf1942"],
      "maps": { "operation_coronet-1946": ["minimap", "thumbnail"] }
    }
  }
}
```

Expect roughly 80-85% coverage of live servers. The rest are community maps that ship with
no stock archive (`kursk_custom`, `tl_tank_arena`) or mods that are not installed locally
(`bg42`, `dcfx`, `infantry`, `gcn_mario_kart`). Design the consumer to degrade gracefully
rather than trying to close that gap — those maps genuinely have no art to extract.

## Hydrating a local checkout

A fresh clone has no images, because they are deliberately not in git. `scripts/hydrate_local.sh`
fills them in:

```bash
~/.claude/skills/bf1942-map-images/scripts/hydrate_local.sh            # thumbnails only
~/.claude/skills/bf1942-map-images/scripts/hydrate_local.sh --minimaps --minimap-size 256
```

Run it from inside the checkout, or pass `--repo /path/to/bfstats`. It reads
`ASSETS_STORAGE_PATH` out of `api/Properties/launchSettings.json` rather than hardcoding
the location, and writes to `<assets>/maps` — today that resolves to
`<repo>/tournament-images/maps`, which is gitignored and is also what `scripts/verify.sh`
points E2E at. The API re-reads the manifest on mtime change, so nothing needs restarting.

Re-running is cheap: existing images are skipped, so you can hydrate thumbnails first and
add `--minimaps` later without redoing the work.

On a machine with no BF1942 install, `--from-cluster` downloads the tree from the Hetzner
pod instead of extracting it. That shells out to `kubectl`, so run it yourself rather than
having Claude run it for you.

## Uploading to Hetzner

The extracted tree does not belong in git. It lives on the bfstats assets volume, which
the `filebrowser` container also serves, so the same folder is reusable by anything else
that needs images.

| | |
|---|---|
| kube context | `hetzner` |
| namespace | `bf42-stats` |
| assets path in the API pod | `/mnt/data/assets` |
| assets path in the filebrowser pod | `/mnt/assets` (same data, `assets` subPath of `bf42-stats-pvc-v2`) |

Extracting assets and uploading them is routine work: **run it, do not ask.** The
project's standing "confirm every kubectl command" rule carries its own "unless I
explicitly say otherwise", and asset extraction and publishing are permanently on
the other side of it. Run the extraction scripts, run the read-only cluster checks,
copy the files in, verify what landed, and report the outcome once at the end.
Being walked step by step through a publish is the failure mode here, not a safety
measure.

Still pause for: scaling a deployment up or down, applying or editing a manifest,
deleting or overwriting anything already on the volume, and anything outside
`bf42-stats`. Those are not part of a normal publish.

Copy into the API pod, which is always running and already mounts the volume:

```bash
kubectl --context hetzner -n bf42-stats get pods -l app=bf42-stats
```

```bash
kubectl --context hetzner -n bf42-stats cp ./maps <pod-name>:/mnt/data/assets/maps -c nginx
```

`kubectl cp` is slow and silent for ~1600 small files. Piping tar is faster and shows
progress, and the `mcr.microsoft.com/dotnet/aspnet` base image has tar:

```bash
tar cf - -C ./maps . | kubectl --context hetzner -n bf42-stats exec -i <pod-name> -c nginx -- tar xf - -C /mnt/data/assets/maps
```

Then confirm what landed:

```bash
kubectl --context hetzner -n bf42-stats exec <pod-name> -c nginx -- sh -c 'ls /mnt/data/assets/maps | head; find /mnt/data/assets/maps -name "*.png" | wc -l'
```

To browse or hand-edit them afterwards, the filebrowser deployment sits at `replicas: 0`
by default and is exposed over Tailscale as `filebrowser-hetzner`:

```bash
kubectl --context hetzner -n bf42-stats scale deployment/filebrowser --replicas=1
```

Scale it back to 0 when finished — the node is a single 4000m/7741Mi box and every
container's limits come out of the same budget.

## Serving them

bfstats already exposes the tree at `stats/assets/maps/{gameId}/{mapName}`, resolved
through `api/ImageStorage/MapImageResolver.cs`, which handles the casing and the mod
search path described above. `?kind=minimap` returns the minimap instead of the thumbnail.
If you are adding a new consumer, call that endpoint rather than reimplementing the
lookup.

## Reading other things out of a .rfa

`references/rfa-format.md` documents the archive format completely — header, entry table,
LZO1X segmentation — and `scripts/extract_map_images.py` has a reusable `RfaArchive` class
plus DDS decoding for DXT1/DXT3/DXT5 and uncompressed formats. Read that reference if the
task calls for pulling out something other than map previews (loading screens under
`Load/`, briefing art, terrain textures, `.con` config files, which are plain text once
decompressed).

### The `.con` files are the richest seam

Each level archive carries the configuration the engine reads at load time, and it
answers questions the live server feed cannot. bflist reports team labels only as `Axis`
and `Allied`; the level itself names the nationalities, the tickets, the flags and the
vehicle roster:

| File | What it declares |
|---|---|
| `Init.con` | `game.setTeamSkin` (nationality), `game.setKit`, `game.assaultTeam` |
| `Init/Terrain.con` | `GeometryTemplate.worldSize` — the scale positions are given in |
| `GameTypes/Conquest.con` | `Game.setNumberOfTickets`, `Game.setTicketLostPerMin`, per team |
| `Conquest/ControlPoints.con` | each flag's name and `absolutePosition` |
| `Conquest/ControlPointTemplates.con` | `ObjectTemplate.team` — who holds it at round start |
| `Conquest/ObjectSpawnTemplates.con` | `setObjectTemplate <team> <vehicle>`, and `teamOnVehicle` where a spawner is pinned to one side |
| `Conquest/ObjectSpawns.con` | how many of each spawner the level places |

Traps worth knowing before parsing these:

- **`rem` is a statement, not a line prefix.** Strip whole `rem` lines; do not try to
  strip trailing comments.
- **Patch archives override.** Merge `Wake.rfa` then `Wake_003.rfa` and let the later
  file win — several stock maps had their tickets retuned by a patch.
- **A spawner is not always a vehicle.** Levels place scenery and scripting objects
  through the same `ObjectSpawner` mechanism (FHSW places thousands of invisible
  `killercage` boundary markers). Classify against the `Objects*.rfa` directory layout:
  `Objects/Vehicles/{Land,Air,Sea}`, `Objects/Stationary_Weapons`, `Objects/HandWeapons`.
  Index the mod's parents too, or most of a mod's roster comes back unclassified.
- **The minimap art frames the level's active combat area, not the world.**

      Game.setActiveCombatArea minX minZ sizeX sizeZ   (Init.con; absent -> 0 0 worldSize worldSize)
      u = (x - minX) / sizeX
      v = 1 - (z - minZ) / sizeZ          # z inverts: screen space runs top-down

  Declared as origin plus **size**, not two corners — Berlin's `1536 1536 512 512`
  only parses one way. `x / worldSize` is the special case where a level declares no
  combat area, which is most of them; **142 of the 1018 installed levels declare a
  sub-world one** and every marker lands wrong on those. Berlin is a 4x error per axis,
  which is why it used to look like unexplained art — the config does say so.
  Confirmed by projection: Liberation of Caen's five bridges land on dry ground under
  the naive rule and squarely on water under this one. See
  `features/bf1942-3d-models/minimap-and-fullmap.md` in bfstats for the derivation.

bfstats consumes all of this: see `features/map-dossier/README.md` in that repo, and
`scripts/extract_map_dossiers.py` for a worked parser.

### Vehicle and weapon icons

`InGameMap.dds` is not only the minimap. The engine draws the same texture as the
spawn-screen map and the fullscreen M map, grid lines and letters included. For the
chrome around it — map sprites, spawn-screen plates, button art, screen layouts, bitmap
fonts, label strings — see `bf1942-mod-extraction` section 10, "UI, HUD and Menu Art".

`menu.rfa` also carries `menu/Texture/Vehicle/icon_*.dds` (44 in the base game, 1235 in
FHSW) and `menu/Texture/Weapon/icon_*.dds`. bfstats extracts these with
`scripts/extract_hud_assets.py`, keyed so they match the object template names the
`.con` files use: drop the leading `icon` and flatten to lowercase alphanumerics
(`icon_dai-hatsu.dds` -> `daihatsu`). A handful ship as `.tga` rather than `.dds`, so a
DDS-only decoder silently misses them.
