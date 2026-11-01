# Map loading art on the stats site

The stats site shows a map's loading screen dimmed behind a page header, in the same
45% opacity and bottom-up scrim the player map page's hero card already used. The page
layouts are unchanged; the art only sits behind headers that were already there.

| Where | What is behind it |
|---|---|
| Server details, the header (back link, name, actions, meta row) | the map the server is playing now |
| Map drill-in drawer, the header | the drilled map |
| Servers landing, the "in combat" row | the busiest server's map, named at the right |
| Player map detail, the hero card | the map; falls back to the 128px thumbnail, then the minimap |

The Maps tab's popularity summary also gained the 44px menu thumbnail per row, the same
image the landing table uses.

## Where the art comes from

The map viewer's level exports. Every exported level's `maps.json` row has a `loading`
block whose `background` names its screen: the level's own `<level>/load.webp` (most FHSW
and every EoD level) or the mod's shared screen for that theatre (`_shared/load/...`,
vanilla, RtR, SW, DC, DC Final). So a mod server gets its mod's art: DC Final's Iwo Jima
shows the DC harrier screen, not vanilla Pacific.

`scripts/build_map_loading_art.py` writes one copy per exported level:

```bash
python3 scripts/build_map_loading_art.py \
    --viewer-maps tools/bf1942-models/viewer/maps --out tournament-images/maps
```

- 640px wide, letterbox bars trimmed (stock 800x600 screens pad 16:9 art with black),
  a 1.5px blur, WebP at quality 50. It is only ever seen dimmed behind text: the blur
  halves the bytes and keeps titles that FHSW and EoD paint into the art from competing
  with the page heading.
- Median 6-11 KB a level (the full screen is 25-115 KB). 695 levels, 6.9 MB in all.
- Covers exported levels only, the rows of each tree's `maps.json`: bf1942 24, xpack1 29,
  xpack2 32, dc_final 48, desertcombat 35, fh 10, fhsw 278 (FHSWEurope's rows fill in
  FHSW), eod 239. Other mods have no backdrop and the header shows its plain ground.
- A screen a tree lacks is taken from the same path in a sibling tree. This PC's FHSW
  tree is missing `_shared/load/battleofmakin.webp`; FHSWEurope's copy is used.

## Serving

`/stats/assets/maps/{gameId}/{mapName}?kind=loading`, the same endpoint as thumbnails and
minimaps (`api/ImageStorage/MapImageResolver.cs`, `MapImageKind.Loading`). The files are
`<mod>/<level>.load.webp` beside the thumbnails, and they are not listed in
`manifest.json`: the resolver probes the disk along the mod's search path (FHSW -> FH ->
BF1942), so a publish adds files and never rewrites the manifest.

In the UI, `MmMapBackdrop.vue` is the backdrop: first child of a `position: relative;
overflow: hidden` block whose other children are lifted with `position: relative`. A 404
is remembered per kind (`<key>#loading`), so a level with no loading screen keeps its
thumbnail elsewhere on the page.

## Publishing

New files only, into the API pod's volume (the skill `bf1942-map-images` has the pod):

```bash
tar cf - -C <out> . | kubectl --context hetzner -n bf42-stats exec -i <pod> -c nginx -- \
    tar xf - --no-same-owner -C /mnt/data/assets/maps
```

Published 2026-11-01: 695 files, per-mod counts on the volume match the build.

## Open

- The standalone map popularity page (`/v4/map-popularity/:serverGuid`) has no gameId,
  so its summary rows show no thumbnail; the server's Maps tab does.
- Levels exported later need a re-run of the script and a publish; it skips files that
  already exist (`--force` rebuilds them).
