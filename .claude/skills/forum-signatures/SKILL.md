---
name: forum-signatures
description: Add, redraw or fix the player and server forum signatures (the banner.png images people put in forum sigs), whose hero art is the mesh viewer's own soldiers, tanks and aircraft posed mid-fight per mod. Use whenever the owner asks to "add more player and server signatures", add a scene or a mod to the signature builder ("a sniper scene", "a Panther firing", "signatures for Pirates"), redraw the art after a model or exporter change, or when a signature looks wrong (a figure facing the wrong way, a flash in the wrong place, no bombs, no backdrop, a cropped plane).
---

# Forum signatures: adding and redrawing scenes

The design, the code map and what was checked are in
`features/forum-signatures/README.md`. Read it first. This skill is the
procedure.

Each signature is the API compositing three layers:
1. the level's loading screen, from the assets volume;
2. one **hero** webp from `api/Signatures/Art/<mod>/<scene>.webp`;
3. the words.

The heroes are rendered **locally**, committed, and shipped in the API image.
Nothing 3D runs in production.

## The loop

```bash
# 1. Add the scene's line to scripts/signatures/scenes.json (schema below).
# 2. Draw it, and look at it:
python3 scripts/signatures/render_signature_art.py <mod>/<scene> --sheet /private/tmp/<scratch>/s.png
#    (Read the PNG. Iterate on yaw, pitch, time, rot and the anchors until it reads.)
# 3. Check the backdrop level exists live:
curl -s -o /dev/null -w '%{http_code}\n' "https://bfstats.io/stats/assets/maps/<gameId>/<level lowercase>?kind=loading"
# 4. Render a whole signature with the backdrop, and look at it:
#    copy that loading screen to <tmp>/assets/maps/<gameId>/<level>.load.webp, then
cd tests/api && ASSETS_STORAGE_PATH=<tmp>/assets SIGNATURE_PREVIEW_DIR=<tmp>/prev \
  dotnet test --filter FullyQualifiedName~BannerRenderTests
# 5. Verify, then commit the webp(s), catalogue.json and scenes.json, and push.
./scripts/verify.sh e2e/forum-signatures.spec.ts --project=chromium
```

Running the script with no arguments redraws all 60 scenes in about 4 minutes.
Every run rewrites `api/Signatures/Art/catalogue.json` from `scenes.json`.
Only scenes that have a webp are listed in it.

## scenes.json

Each mod holds `name`, `short` (the tag on the banner), `gameIds` (the bflist
ids that play its art; DC Final plays `desertcombat`), `accent` (`#rrggbb`) and
`scenes`. Every scene has `id` (it goes in the URL, so never rename one that is
live), `label`, `kind` and `backdrop` (a level of the same mod and theatre).

**Soldier** (`"kind": "soldier"`):
- `kit`: a kit template from that tree's `kits.json`. The kit gives the soldier
  template, the primary weapon and the worn helmet and packs. Override them with
  `soldier` and `weapon`.
- `gait` and `time`: a lower and an upper clip from the shared gait glbs, and
  the moment to draw:

  | Gait | Use | `time` |
  |---|---|---|
  | `run.lower+Ub_Fire` | run and gun | 0.3 |
  | `lie.lower+Ub_LieFire` | prone fire; set `"pitch": 0.22` | 0.05 |
  | `crouch.lower+Ub_Fire` | launcher; set `"box": "launcher"` to leave room for the backblast | 0.05 |
  | `Lb_RunJump+Ub_RunJump` | the leap | 0.15 |
  | `stand.lower+Ub_Fire` on a grenade pose | throw | about 0.7 is the arm cocked |

  Other clips: `gaits/die`, `explosion`, `parachute`, the reloads. List a gait
  glb's clips and their lengths before choosing a time. When a mod has no gait
  for its weapon, the script falls back to the stance clip and says so.
- `yaw`: 1.9 is three-quarter front, facing left.
- `fx`: `smallarms`, `mg`, `rocket`, `flame` or `laser-arms`. A blaster also
  takes `"bolt": "red"` or `"green"`.

**Vehicle or plane** (`"kind": "vehicle"` or `"plane"`):
- `glb`: the file in the mod's tree.
- `yaw`: vehicle and plane noses point the other way from soldiers. -0.99
  gives a tank three-quarter front facing left; -1.5708 gives a plane side-on
  facing left.
- `rot`: `[pitch, yaw, roll]` in radians on the model itself. `[0,0,0.75]` is
  a fighter banking with its belly shown; `[-0.4,0,0]` is a dive.
- `box`: `"plane"` or `"compact"` for planes.
- Anchors for the effects:
  - `barrel`: the gun mesh. The muzzle is its most forward point.
  - `tip` and `base`: for a gun with no mesh of its own. Give `[x,y,z]` world
    points or a `--mark-extreme` spec such as `"M3GrantTower:w:0,0,-1"`.
  - `discs`: `[{"mesh": "<X>PropellerStatic"}]`, or `"kind": "rotor"` for a
    helicopter. The static mesh is hidden and a blurred disc drawn in its place.
  - `bomb`: the plane's `_projectile` mesh. When that mesh is only a box, add
    `bombGlb` to borrow another model's bomb.
  - `skip`: landing gear, wheels and the blurred-prop meshes.
- `fx`: `cannon`, `guns`, `lasers`, `bombs` or `laser`.

To find the mesh names, mirror the glb and list its parts:

```bash
python3 -c "import sys; sys.path.insert(0,'scripts/signatures'); import mesh_mirror as m; print(m.glb('models/mods/fh/PantherG.glb'))"
node scripts/render-game-sprite.mjs --glb <that path> --clip none --bounds --projectiles
```

Each mod's `models.json` (through `mesh_mirror.models(mod)`) lists what exists
and its category.

## Where the assets come from

`scripts/signatures/mesh_mirror.py` reads mesh.bfstats.io and caches the files
in `~/.cache/bfstats-signature-assets`, laid out like the viewer tree. It only
reads the live site and never writes to it. This Mac's own viewer tree is
partial, so do not render from it.

Textures are fetched with the viewer's `?r=2` epoch. The edge still holds some
cached 404s from before 2026-11-13.

## A new mod

1. Add the mod to `scenes.json`, with its `gameIds`.
2. Its tree needs `models.json`, posed soldiers and `kits.json` on the live
   site (`mods.json` counts show what exists).
3. Its levels need loading art on the assets volume. If
   `/stats/assets/maps/<id>/<level>?kind=loading` returns 404, build the art
   with `scripts/build_map_loading_art.py --viewer-maps tools/bf1942-models/viewer/maps --out <tmp>`.
   Then upload **only that mod's folder** (new files) through the API pod
   (`features/map-loading-art`, "Publishing"). This upload is routine asset
   publishing and needs no confirmation.
4. `BannerRenderTests` asserts at least 9 mods. `forum-signatures.spec.ts`
   counts the mod strip (9), so update that count.

## What a good hero looks like

Every hero faces left, from the right side of the 640x400 canvas. It must keep
its muzzle, wings and bombs inside the frame.

Check each one in the sheet against these failures, all already hit once:
- a gun firing from the wrong end;
- a flash above the turret on a hull-gun tank;
- bombs too small to read, or missing;
- a head-on aircraft cropped by the frame;
- backblast clipped at the edge.

Keep scenes recognisably the mod's own. Use its signature kit, vehicle and
aircraft, not vanilla stand-ins.
