# Pose asset deduplication

Stop publishing a full body+weapon glb per soldier-per-pose combination. The
pose files re-embed the same soldier mesh and textures dozens of times and the
same weapon tree once per soldier; the viewer already has the machinery to
compose rigid parts onto a posed skeleton at runtime (`kit-graft.js`), and the
pipeline already dedupes animation into shared sidecars (`gaits/`). Extend both
ideas to the whole pose file.

## The measurement

`extract_pose.py` writes one self-contained `<Soldier>__<PoseName>.pose.glb` per
soldier per pose. Sizes measured on 2026-09-25:

| tree | pose glbs | soldiers | bytes |
|---|---|---|---|
| vanilla `viewer/models/poses` | 288 | 8 | 327 MB |
| xpack1 `mods/xpack1/poses` | 176 | 10 | 204 MB |
| xpack2 `mods/xpack2/poses` | 246 | 10 | 277 MB |
| eod `mods/eod/poses` | 1,786 | 19 | 2.0 GB |
| **total** | **2,496** | | **~2.8 GB** |

(`ls` on the vanilla dir shows 579 files — the other half is the
`.pose.report.json` sidecars.)

(`viewer/models` is 4.2 GB overall; poses are two thirds of it.)

Parsed contents of three representative files (glb JSON chunk + bin chunk):

- `USSoldier__K98.pose.glb` — 1.15 MB bin, meshes `us1face, UsBody,
  USRightHand, USLeftHand, K98_base_m1, K98_trigger_m1, K98_load_m1,
  riflebulletclip_m1`, 8 embedded PNGs, 158 KB of vertex data, 10 KB of
  animation samples, 3 KB of inverse binds.
- `USSoldier__Bar1918.pose.glb` — same body meshes and textures again, BAR
  parts instead of K98 parts. 1.70 MB.
- `GermanSoldier__K98.pose.glb` — German body again, K98 parts again. 1.10 MB.

So of the ~2.8 GB:

- the soldier body (mesh + textures + skeleton) is stored once per pose per
  soldier — 36 times per vanilla soldier and 19 per EoD one, with the
  same multiplication;
- each weapon template tree is stored once per soldier holding it — 8 copies in
  vanilla;
- the textures dominate the bin chunk (of `USSoldier__K98`'s 1.15 MB, vertex
  data is 158 KB, animations 10 KB, inverse binds 3 KB — the rest is mostly the
  eight PNG images).

Both halves of every combination already exist as standalone published assets:
`USSoldier.glb` and `K98.glb` sit in the same tree as `USSoldier__K98.pose.glb`.
The pose files duplicate assets the volume already carries.

## What a pose actually is

Everything pose-specific in a pose glb is tiny:

- the skeleton's rest pose (the joint TRSs from `Lb_Stand` + `Ub_StandAim<W>`);
- three constant stance clips (`stand`, `crouch`, `lie`), 10 KB of samples;
- the weapon subtree's attachment transform under `Bip01 R Hand`;
- the two `extras.gaitAssets` references.

The weapon is rigid — no skin, no animation of its own. The body is skinned to
the one shared `.ske` rig that every soldier shares, which is exactly why the
gait sidecars can be retargeted by bone name today.

## Design

Three asset kinds instead of one:

1. **Rig glb per soldier** — `poses/rigs/<Soldier>.rig.glb`: face, body, hands,
   skeleton, inverse binds, textures. This is today's seat pose minus the
   weapon (`USSoldier__SitInVehicle.pose.glb` is 754 KB, all of it body).
   47 tree-soldier pairs across the four trees but only 22 unique bodies (the
   packs reuse vanilla ones) — at the seat pose's 754 KB that is ~16 MB, not
   327 MB.
2. **Weapon glbs, unchanged** — already extracted per template tree.
3. **Pose recipes** — `<Soldier>__<PoseName>.pose.json` (or a tiny glb if
   three.js JSON is awkward for the stance clips): rest-pose joint TRSs, the
   three stance clips, the weapon attachment TRS, `gaitAssets`. A few KB each.

The viewer composes: load the rig once per soldier (cache), graft the weapon
under the hand bone with the recipe's transform, build the animation mixer on
the rig's skeleton and feed it the recipe's clips plus the shared gait sidecars.

### Why the viewer can do this already

- `viewer/kit-graft.js` grafts rigid kit parts (helmets, packs) onto exactly
  three bones of the posed skeleton and they follow the mixer. A weapon under
  `Bip01 R Hand` is the same mechanism with one more slot. The file's own
  history is a warning: three automated checks passed while every helmet was
  upside down, and the slot rotations were pinned by eye. The hand attachment
  transform must come from the assembler, not be re-derived, and must be
  eyeballed once per grip family.
- `viewer/pose-bases.js` already resolves a pose across the mod tree then
  vanilla. Its fallthrough must apply per half (rig, recipe, weapon
  independently) so a mod pose that pairs a vanilla soldier with a mod weapon
  still resolves.
- `viewer/bot-visuals.js` caches pose pairs per `Soldier__Weapon` key; the cache
  becomes per-soldier rig + per-recipe clips, which also removes the per-bot
  scene duplication in memory, not just on disk.
- `pose-motion.js` builds its mixer on "the pose's own scene" and searches
  embedded clips before falling through to the sidecars. With recipes, the
  mixer root is the rig scene and the clips come from the recipe document; the
  embedded-first search order must be preserved so `--gaits embed` keeps
  working.

### Gait and transition sidecars

Unchanged. `gaits/lower.gait.glb` and `gaits/<Grip>.gait.glb` already carry the
locomotion clips, stance transitions and fire/reload halves, and each pose names
its two in `gaitAssets`. Recipes keep naming them.

### Seat poses

A seat pose file today is a body re-baked into the seat's rest pose plus the
arm-IK hints the viewer reads (`seat-body.js`, `seat-pose.js`). A seat pose
recipe is the same rest-pose TRSs and IK spec without the body: the seat
resolves the rig by soldier template exactly as `seatSoldier` does today.

## Phased tasklist

Phase 1 — extractor (no viewer change, old files still present)

- [x] Capture the weapon→`Bip01 R Hand` attachment TRS in `extract_pose.py` and
      write it into the pose file's extras (it is currently only implicit in the
      baked node tree). The recipe's `attach` holds it, and `check_recipe.py`
      pins it against the grip node the glb still carries.
- [x] Add `--split` output mode: `poses/rigs/<Soldier>.rig.glb` +
      `<Soldier>__<Pose>.pose.json` recipes alongside the existing monolithic
      glbs, so both trees exist and the viewer can migrate per consumer.
- [x] Recipe carries: rest TRSs, stance clips, attachment TRS, `gaitAssets`,
      `weaponTemplate`, `soldierTemplate`. Named `joints`, `clips`, `attach`,
      `gaitAssets`, `weapon`, `soldier`; `root` and `clipNames` came along.
- [x] Unit tests in `tools/bf1942-models/tests/` for recipe/rig emission and
      for the cross-tree pairing (vanilla soldier + mod weapon):
      `test_pose_recipe.py` (25 tests), `test_pose_compose.py` (17),
      `test_pose_bases.py` grew the per-half URL cases.

Phase 2 — viewer consumers, one at a time behind a recipe-exists check

- [x] `pose-bases.js`: per-half URL resolution (rig, recipe, weapon).
- [x] `bot-visuals.js`: rig cache keyed by soldier template; graft weapon via
      kit-graft's mechanism; mixer on the rig skeleton. Done through one shared
      module instead, `pose-compose.js`, because every consumer needed the same
      three steps.
- [x] `pose-motion.js`: stance clips from the recipe; keep the embedded-first
      search for `--gaits embed`. The search order is untouched; `--split` with
      `--gaits embed` is now refused by the CLI, because a recipe carries no
      embedded timelines.
- [x] `seat-body.js` / `seat-pose.js`: seat recipes.
- [x] `remote-gait.js`, `netcode-render.js`, `kit-loadout.js`: any remaining
      direct `__<Pose>.pose.glb` fetches. None were left in `remote-gait.js` or
      `kit-loadout.js`; `replay-assets.js`, `controls-preview.js`, `poses.html`
      and `kits.html` were the remaining fetchers and all four moved.
- [x] Live browser pass per `references/viewer-verification.md` — this is the
      gate that catches a wiring mistake.

Phase 3 — cutover and publish

- [ ] Eyeball pass on the hand attachment: every grip family (rifle, pistol,
      LMG, launcher, binoculars, grenade) posed and looked at, the way the
      kit slot rotations were pinned.
- [ ] Flip default output to split mode; stop emitting monolithic pose glbs.
- [ ] Re-run the level/model layers per `features/level-bake-layers/README.md`
      blast radius (poses are a per-tree artifact, not a `scene.json` layer,
      but every tree's `poses/` is regenerated) and publish with
      `scripts/publish-mesh-delta.py`.
- [ ] Delete the monolithic glbs from the volume; measure before/after in the
      publish log.

## What landed

Everything in phase 1 and 2. The extractor writes the split tree behind
`--split`, `--split-only` writes it alone, and every viewer that draws a soldier
reads it through `viewer/pose-compose.js`. A tree without recipes loads exactly
as it did before, so a published tree keeps working until it is re-extracted.

`viewer/pose-compose.js` is the whole viewer change: it loads a recipe, clones
the rig, assigns the recipe's joint transforms, builds the recipe's clips onto
those joints, grafts the weapon glb under the hand bone at the recipe's
transform, and hands back the `{scene, animations, userData}` shape a
`GLTFLoader` result already had. Consumers keep cloning the result per figure
and keep reading `userData.gaits` the way they read a pose glb's extras.

### Measured

One soldier, four weapon poses, `--gaits shared` both ways:

| | pose glbs | split |
|---|---|---|
| pose assets | 5.19 MB | 0.82 MB (a 748 KB rig, four 17 KB recipes) |
| gait sidecars | 2.14 MB | 2.14 MB |

84% off the pose assets. Vanilla's 327 MB of pose glbs becomes roughly 6 MB of
rigs plus KB-scale recipes.

### Verified

- `check_recipe.py` reproduces the monolithic glb from the recipe for
  `USSoldier__K98` (55 joints) and for every `USSoldier__*.pose` seat pose.
- 43 headless tests added: `test_pose_recipe.py` (25) and
  `test_pose_compose.py` (18), plus the per-half URL case in
  `test_pose_bases.py`.
- A live browser pass on the split path (`poses.html`, `kits.html`): the page
  fetches the recipe, the rig and the weapon glb and never the pose glb; 74
  sampled bone values match the glb path with a worst delta of 1.0e-05 m, the
  recipe's own rounding; the standing, crouching, prone and kit-dressed figures
  were looked at.

### Left

- Phase 3: the per-grip eyeball pass, the default flip, the re-extraction and
  publish across the four trees, and the deletion of the monolithic glbs.
- `pose-compose.js` builds each pose's clips from the recipe rather than
  reusing an `AnimationClip`, so a page showing forty poses of one soldier
  shares the rig's geometry and textures but not its clip objects. Reusing them
  needs a clip cache per (recipe, joint set), which nothing needs yet.

### The whole-map trial

Vanilla's whole pose set is split in the local `viewer/models` tree: 288 recipes
(224 weapon poses and 64 seat poses) beside 8 rigs, with every monolithic `.glb`
left in place, so a page falls back per pair. `check_recipe.py` over all 288
reports 8 disagreements, all of them `*__GrenadeAllies`: the published grenade
glbs are **stale bakes** from before the throwable's weld was fixed (their grip
node carries `r=[0,1,0,0]`, `t=None`), and a fresh bake of the same pair
reproduces its recipe exactly. The split path therefore draws grenades at the
fixed weld where the old glb did not.

A live Wake match with 16 bots, measured from the HTTP access log: 13 recipe
fetches, **0** `.pose.glb` fetches, one rig per distinct soldier, every request
200. Bots on foot and riders in vehicles both composed from recipes (the seat
path requested `*__SitInVehicle.pose.json` and
`*__SitInVehicle-StandInVehicle.pose.json`).

The first run of the same match requested 10 rigs for those 2 soldiers, because
the rig cache was keyed on the URL and `bust` is a fresh timestamp per call.
Keying without the query string took it to 2.

**`--matrix --export` only runs when `--soldiers` is given.** The matrix body
sits inside `if args.soldiers is not None:` in `main()` (pre-existing), so a
full-mod export without that flag exits 0 having written nothing:

    python3 extract_pose.py --matrix --export --split-only \
      --soldiers BritishSoldier CanadianSoldier GermanDesertSoldier GermanSoldier \
                 JapaneseSoldier RussianSoldier USMarineSoldier USSoldier \
      --out viewer/models/poses -j 4

## Non-goals

- No texture compression (KTX2/Basis) or Draco here. It is a further win on the
  now-unique bytes and can ride on top, but the dedup alone is worth all but
  ~25 MB of the ~2.8 GB and changes no rendering path.
- No change to the gait sidecar format, the `.ske` rig, or any `.con` parsing.
- No change to `viewer/models` URL layout other than adding `poses/rigs/`.
- First-person viewmodels (`viewmodels/`) are separate assets and out of scope.
