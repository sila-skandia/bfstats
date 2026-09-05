# Map preview images

Every BF1942 map ships a menu thumbnail and an in-game minimap inside its level `.rfa`
archive. We extract those once, put them on the assets volume, and serve them so a server
card or a round view can show the map it is talking about.

## Where things live

| | |
|---|---|
| Extraction tool | the `bf1942-map-images` skill (`~/.claude/skills/bf1942-map-images/`) |
| Images on disk | `/mnt/data/assets/maps/` on the Hetzner PVC, also visible to the `filebrowser` container as `/mnt/assets/maps/` |
| Images in git | none, deliberately — `maps/` is gitignored |
| Endpoint | `GET /stats/assets/maps/{gameId}/{mapName}` |
| Resolver | [MapImageResolver.cs](../../api/ImageStorage/MapImageResolver.cs) |
| Tests | [MapImageResolverTests.cs](../../tests/api/ImageStorage/MapImageResolverTests.cs) |

The `maps/` folder is a sibling of `tournaments/` and `players/` under the same assets
root, so anything else that needs shared imagery can use it too.

## Addressing an image

bflist reports a server's map as `gameId` + `mapName`, and that pair is the URL:

```
GET /stats/assets/maps/bf1942/wake
GET /stats/assets/maps/fhsw/operation%20coronet-1946
GET /stats/assets/maps/bf1942/wake?kind=minimap
```

Map names may be passed with spaces or underscores, in any case, with or without a
trailing `.png`. Missing images return 404 rather than a placeholder — the caller decides
what to show instead.

Two details the resolver handles that a naive path join would not:

**bflist casing is inconsistent.** The same mod appears in the live feed as both `bf1942`
and `BF1942`, `eod` and `EOD`, `interstate` and `Interstate`.

**Mods inherit maps.** Each mod's `init.con` declares a content search path — FHSW falls
back to FH, which falls back to the base game. An FHSW server can therefore report `wake`,
which only exists in `bf1942`. `manifest.json`, generated alongside the images, records
each mod's search path and which images exist, and the resolver walks it the same way the
engine does. The manifest is re-read when its mtime changes, so replacing the assets
through FileBrowser does not need an API restart.

## Coverage

A full local install (11 mods, ~950 level archives) yields ~820 maps: 801 thumbnails
(~10MB) and 779 minimaps (~80MB downscaled to 256px, ~170MB at full 512px).

Measured against the live bflist server list, 78 of 93 servers resolve to a thumbnail.
The remainder are community maps with no stock archive (`kursk_custom`, `tl_tank_arena`,
`toujane_tunisia`) or mods nobody has installed locally (`bg42`, `dcfx`, `infantry`,
`gcn_mario_kart`). There is no art to extract for those, so consumers should degrade
gracefully rather than assume an image exists.

## Local development

A fresh clone has no images. Hydrate them from a local BF1942 install:

```bash
~/.claude/skills/bf1942-map-images/scripts/hydrate_local.sh --minimaps --minimap-size 256
```

That writes to `<repo>/tournament-images/maps`, which is where both `dotnet run` (via
`api/Properties/launchSettings.json`) and `scripts/verify.sh` point `ASSETS_STORAGE_PATH`.
It is gitignored. Re-running skips images that already exist, and `--from-cluster`
downloads the tree from Hetzner if you have no game install.

## Regenerating or uploading

Ask Claude for the `bf1942-map-images` skill — it covers extraction flags, the output
layout, and the `kubectl --context hetzner` upload into `/mnt/data/assets/maps`.

## Not done yet

No UI surface consumes the endpoint. Wiring it into server cards or the round view is a
separate change.
