---
name: bf1942-mod-pipeline
description: >
  The one way to get a Battlefield 1942 mod, or more of its levels, into the
  map viewer and the play front end complete: models, level bakes, kits, poses,
  loadouts, first-person rigs and their level paint, sounds, voices, HUD pack,
  loading screens, bot data, thumbnails and the registry, in order, with gates.
  Use it whenever the task is to extract, bake or add maps or levels for any
  mod or pack (FHSW, FH, Desert Combat, DC Final, EoD, Road to Rome, Secret
  Weapons, bf1918, GC, Interstate, Pirates), in any phrasing: "extract the
  next ten FHSW maps", "bake Kharkov", "get Operation Goodwood into the
  viewer", "add these levels", "re-extract after the exporter fix", "finish
  the FHSW tree", "run the pipeline". Use it too when a baked level is missing
  something a bake alone never writes: soldiers spawn bare-handed or silent,
  no hands in first person, a winter level in summer gloves, vanilla kits on a
  mod's deploy screen, no loading screen, no thumbnails, bots that never board
  a vehicle, a registry count that does not match. Do NOT run extract_maps_all.py,
  extract_kits.py or any extract_*.py by hand for this: run mod_pipeline.py.
---

# Extracting a mod, or more of its levels

A level in the viewer is not a `scene.glb`. It is the scene plus about twenty
other artefacts that other extractors write from the same install: the kits
the level binds and what each kit puts in a soldier's hands, the first-person
rigs and the level's own paint on them, the soldier poses, the loadouts, the
weapon and soldier sounds, the vehicle tables, the voices, the HUD pack with
the level's own vehicle icons, the loading screen and its music, the bot
names and the vehicles a bot may board, the collision meshes, the effects,
the thumbnails, and the registry that makes the mod appear in the dropdown.
`extract_maps_all.py --levels X` writes the scene and nothing else. Every
"the kits are missing" report of October 2026 was a level baked that way.

`tools/bf1942-models/mod_pipeline.py` is the recipe as code: 28 ordered steps,
each with the files it must produce, resumable, and since 2026-10-13 aware of
its inputs, so a step recorded `done` runs again when the level set it reads
has grown. The full table and the gates are in
`features/mod-extraction-pipeline/README.md`. Run it from `tools/bf1942-models`.

## The command, by situation

| You were asked to | Run |
|---|---|
| Add the next N levels of a mod, chosen by the pipeline ("the next ten FHSW maps") | `python3 mod_pipeline.py pick --mod FHSW --pick 10` to see the choice, then `run --mod FHSW --pick 10 -j 12 --no-gates`. The pick is the mod's own levels not yet baked, the ones with single-player data first (the game's own Instant Battle rule, and the only levels a bot can be put on), the rest at random; `--pick-random` drops the preference, `--seed` repeats a choice. The choice is printed and recorded in the state file |
| Add named levels ("bake Kharkov and Karelia") | `python3 mod_pipeline.py run --mod FHSW --levels Kharkov_Winter-1941 Karelia -j 12 --no-gates` |
| Bring a whole new mod in | add a `ModConfig` to `MODS` in `mod_pipeline.py` (id, install folder, `kit_flags`, `level_all`), then `run --mod <Mod> --all-own-levels -j 12 --no-gates` |
| Finish a tree someone baked by hand (kits, skins, loading, registry missing) | `run --mod <Mod> -j 12 --no-gates`: with no `--levels` the baked set is read from `maps.json`, `levels` skips scenes that exist, and every step whose input set changed runs. A tree built before the pipeline has no state record, so the plan says `would-run (no state record; outputs already present)` for every step, `models` included; when the models are known current, `--from-step levels` |
| Re-bake after an exporter change (`bf42/gltf.py`, `assemble.py`, `rs.py`, `extract_map.py`) | `<affected>` is drawn from the tree's exported levels (`maps.json` rows; FHSW and FHSWEurope: the rows with a `loading` block), never from a scan of the install's archives. Then `run --mod <Mod> --levels <affected> --force-steps --only-steps levels flag_cloth optimise`, then `run --mod <Mod> --no-gates` to let the rest catch up. A change that reaches only `scene.json` is a layer: `patch_scene.py --layer <L> --mod <id> --all` (`features/level-bake-layers/README.md`) |
| Say what state a tree is in | `verify --mod <Mod> --no-gates` (the five verification steps, nothing written), `gates --mod <Mod> --scorecard-dir ../../features/mod-extraction-pipeline/scorecards` for the audits and tier |

Level names are the archive names as the install spells them
(`Kharkov_Winter-1941`, not the lower-case directory). `--levels` with a name
the mod does not ship is an error from `extract_maps_all.py`, not a silent skip.

Always `--dry-run` first and read the plan. Each step prints `up-to-date`,
`would-run`, or `would-run (inputs changed: viewer/maps/mods/fhsw/maps.json)`.
A plan where only `levels` would run is the mistake this skill exists for: it
means the state file is from another tree or the pipeline is older than
2026-10-13. Paste the plan into your report.

```bash
cd tools/bf1942-models
python3 mod_pipeline.py run --mod FHSW --levels <names> --dry-run --no-gates
```

## The prompt that gets a complete result

When briefing an agent, name the skill, the mod and either the count or the
level names, and ask for the two artefacts that prove completeness:

```
Add the next ten FHSW levels to the map viewer, complete, with the
bf1942-mod-pipeline skill: let the pipeline pick them (--pick 10,
single-player levels first), run mod_pipeline.py and no extract_*.py by
hand, run the preflight first and stop if another extractor is writing the
tree, run from a detached worktree with the asset trees linked and the state
file in the main checkout. Report the picked levels, the --dry-run plan, the
step results with any done-with-findings, and `verify --mod fhsw --no-gates`
with all five checks passing (v_levels included). Then publish both trees with
the bfstats-mesh-assets skill, staging only your own files, and confirm three
live URLs with a cache-buster.
```

Drop the last sentence to play-test locally first; add `gates --mod fhsw
--levels <the ten>` for a scorecard tier (15 to 45 min a level).

## Before you start

`bash .claude/skills/bf1942-mod-pipeline/scripts/preflight.sh <Mod>` prints
all of this in one go. By hand:

1. **Nobody else is writing the tree.** `pgrep -af 'extract_|audit_|shoot.mjs|mod_pipeline'`.
   `viewer/maps` and `viewer/models` are one shared untracked tree every
   worktree writes; a second extractor's `promote()` replaces whole level
   directories under you. Wait, or coordinate.
2. **Run the code you mean to run.** The main checkout usually has other
   sessions' half-written edits under `tools/bf1942-models/` (`git status`
   shows them). Extract from a detached worktree at a commit, with the asset
   trees linked in, and keep the state file in the main checkout:
   ```bash
   git worktree add --detach ~/.cache/pipeline-wt HEAD
   tools/bf1942-models/link_viewer_assets.sh ~/.cache/pipeline-wt
   ln -s "$PWD/ui/node_modules" ~/.cache/pipeline-wt/ui/node_modules   # shoot.mjs needs Playwright
   cd ~/.cache/pipeline-wt/tools/bf1942-models
   python3 mod_pipeline.py run --mod FHSW --levels ... --no-gates \
     --state-file /home/dylan/projects/skandia/bfstats/tools/bf1942-models/out/mod-pipeline/fhsw/state.json
   ```
   Step logs then land under the worktree's `out/mod-pipeline/<id>/logs/`.
3. **Disk.** `df -h /home`. The disk guard kills a step below 15 GB free
   (`--min-free-gb`). A `--level-all` models pass on a big mod is archive GB
   times six; FHSW's filled the disk to zero on 2026-09-30 and is off in its
   `ModConfig`.
4. **Ports and the browser.** Never `--port 5273`, the owner plays there (the
   pipeline refuses it). Thumbnails take `flock /tmp/claude-1000/chromium.lock`;
   one headless Chromium at a time on this PC, and a long audit in another
   session can hold the lock for an hour. `ls -la /tmp/claude-1000/chromium.lock`
   and `fuser` it.
5. **The install.** The mod's folder under `~/.wine/drive_c/EA Games/Battlefield 1942/Mods/`
   has `Archives/` (case varies) with the sound archive and
   `Archives/bf1942/levels/*.rfa`. A level archive whose size is an exact
   multiple of 64 KiB is truncated and skips. FHSW on this PC is 0.81 with 143
   levels; an earlier half-synced copy produced bakes that are void.

Run it detached (`nohup ... > out/mod-pipeline/<id>-run.log 2>&1 &`), not under
a foreground timeout. FHSW (2026-10-13 numbers, before the seat-pose change): `collision` is
about 5 min at `-j 20`, `kits` 2.5 min, a level bake 1 to 3 min per level.
The sound table inside `levels` was 31 min single-process and is about 4 min
at 12 workers (`extract_vehicle_sounds.py -j`). The `viewmodels` pass is parallel
per rig now; its full-pass time at `-j 20` is not measured yet (69 min at `-j 4`
before). The `models` step went from 77.6 min at `-j 4` to 70.8 min at `-j 20`,
most of the rest being the seat-pose pass, now parallel. The thumbnails are about
a minute per hundred models. `features/mod-extraction-pipeline/README.md`,
"Parallel steps and CPU use", has the measurements.

## When it stops

The run stops at the first failed step and says so. Re-issuing the same
command skips what is done. Read the step's log (`out/mod-pipeline/<id>/logs/<step>.log`)
before touching anything:

* `failed-outputs` with `rc=0`: the extractor ran and wrote too little. Usually
  a `--mod` spelling (install folder, not tree id) or an empty voices set
  because the mod's language is not in `extract_capture_voices.LANGUAGE_NATIONS`.
  Every language the chain's soldiers declare with `setRadioLanguage` must be
  there. Hungarian was not until 2026-10-14, so a Hungarian side spoke American
  radio on FHSWEurope and FHSW, and the table is now guarded by
  `tests/test_language_nations.py`. A language missing here is silent: the viewer
  falls back to `voices/us`.
* `done-with-findings`: the extractor exited non-zero for a fact about the mod
  and finished anyway (FHSW's sixteen grenade pairs with no first-person
  clip). The findings are the lines in the log; carry them into the report.
* `failed-disk`: free space under the guard. Clear space, re-run.
* A step killed by a sibling's Chromium or a lost lock: re-run.

Do not work around a failed step by running its extractor by hand into the
tree. A subset `extract_models.py --out viewer/models/...` rewrites
`models.json` to that subset and strips every thumb key; the pipeline's
`reextract_models_subset` exists for that. Nothing else in the recipe is safe
to run by hand either, because nothing else records that it ran.

## Fix what the run finds, in the same run

When a step log, `verify`, or the state file shows a defect, fix it and re-run
the affected steps. Do not stop to ask whether to fix it: an extract request
includes the fixes it needs. Stop only for a decision the owner has to make
(which levels, what to publish), not for a bug.

Classify each finding first, then fix at the owning layer:

- **A registry does not know the tree** (`unknown tree`, a tool's `MODS` map
  lacks the id): add the id to every tool's registry (`mod_pipeline.MODS`,
  `patch_flag_cloth.MODS`, and any other map a step names the tree in).
- **A parser raises on one malformed level** (`IndexError` in a `bf42/` reader):
  scan the whole chain for every failing level first. Keep the shared
  parser's raise contract. Catch the exception at the caller that owns the
  level, use that caller's documented no-data fallback, and print one warning
  naming the level. Other callers (`kit.py` already skips a malformed layer) are
  not affected.
- **A kit names a template no `.con` in the chain defines** (`no such weapon
  template`): a dangling reference in the mod's data. Skip the pair with a
  logged line and count it apart from failed rigs. Check the whole chain first:
  search every `.con` for `create <name>`.
- **A missing sample** a sound script names: check the whole chain's archives.
  If it is absent from all of them, it is the mod's data; record it as a finding.

Then re-run only the steps the fix touches, for example
`run --mod <Mod> --only-steps hud viewmodels manifest manifest_final --force-steps --no-gates`,
and run `verify` again. Work in the detached worktree. Edit the main checkout's
copy of a file only when no other session has uncommitted edits to it;
otherwise say which checkout still needs the fix. Record each fixed defect
class with its guard in the pipeline README's regression corpus the same day.

## After the run

1. `verify --mod <Mod> --no-gates` must pass all five steps. `v_levels` names,
   per baked level, what a bake alone never writes: a loading block, a kit that
   binds it, a `loadouts.json` entry, first-person paint in
   `viewmodels/skins.json`, a fresh `scene.glb.gz`. A level in any of its lists
   is not done.
2. `gates --mod <Mod> --levels <new ones> --scorecard-dir ../../features/mod-extraction-pipeline/scorecards`
   runs the six audits over the new levels and writes the tier. The behaviour
   gate drives every vehicle and kit in a headless page and is 15 to 45 min a
   level; `--behaviour-quick` is a sample and can never earn a tier. Read the
   scorecard's `blocked` rows: each names its cause and the owning script.
3. **The stats site's half.** The viewer's tree is not the whole of a level:
   the stats site resolves a live server's map onto a dossier, a thumbnail and
   kit icons under `tournament-images/`, a different volume path. Run from the
   repo root, for the mod in hand, and publish only the changed files
   (`features/map-dossier/README.md`, "Regenerating"):
   ```bash
   python3 scripts/extract_map_dossiers.py --mods <Install> --force
   python3 .claude/skills/bf1942-map-images/scripts/extract_map_images.py --mods <id> --out ./maps   # skill bf1942-map-images
   python3 scripts/extract_hud_assets.py            # kit icons, per mod
   ```
   The completeness audit (`audit_mod.py --mod <id> --audit completeness`)
   reports a mod whose dossiers lag its baked levels as `site-dossier-missing`.
4. **Publish.** Skill `bfstats-mesh-assets`: `scripts/publish-mesh-delta.py
   models maps --dry-run` and read the count, then the real send, manifests
   last. Other sessions' unpublished work rides along with a tree-wide send;
   when that is not wanted, hard-link exactly your files into a staging root
   (`~/.cache/<name>/{models,maps,textures}`, the textures the glbs point at
   too) and pass `--root`. The publisher refuses a glb without a fresh
   `.glb.gz`. Check live with `?cb=$(date +%s)`: a bare probe caches a 404 at
   the edge for a day.
5. **Record.** The level list and the scorecard tier go in the mod's tracker
   (table below); a defect class fixed on the way goes in the pipeline README's
   regression corpus the day it is fixed, with its guard.

## Done means

* `verify` passes, including `v_levels`, for every level in `maps.json`.
* `models/mods.json` counts equal the tree (`v_counts`), and the mod's levels
  open at `map.html?mod=<id>&map=<Level>` on a local `serve_viewer.py` with a
  soldier who has hands and a weapon, the level's loading screen, and the
  mod's kits on the deploy screen.
* The new levels have a scorecard tier, and the `blocked` rows are either
  fixed or in the tracker with their cause.
* The dossiers and thumbnails exist for the new levels, and what changed is
  on the volume.
* The report says which steps ran, which were up to date, what
  `done-with-findings` found, and what is left.

## Triaging a report on a mod level

The owner play-tests and reports in a sentence ("the kits are missing on Desert
Rose", "the rifle spins on reload", "the tank's MG sounds like a car horn").
Measure before theorising; each row is the tool that turns the sentence into a
finding with a cause, run from `tools/bf1942-models`.

| The report | Measure with |
|---|---|
| Kits missing, vanilla kits, bare-handed soldiers, no loading screen, no thumbnails, bots never board | `python3 mod_pipeline.py verify --mod <id> --no-gates` (`v_levels`), then `python3 audit_mod.py --mod <id> --audit completeness` for the owning script |
| A weapon fires the wrong round, a magazine or reload rule is off, a declared word nothing reads | `python3 conformance_weapons.py --mod <id> --levels <l1,l2>`; `python3 census_weapon_words.py --mod <M>` for FireArms words the reader has no branch for |
| A first-person rig spins, drops a part, does not return to the aim | `python3 audit_viewmodel_motion.py --mod <id>`; the fix class is `features/viewmodel-motion-audit` |
| White, magenta, black or untextured objects; floating, buried or stacked placements; silent guns or engines; a sound under another weapon's script | `python3 audit_mod.py --mod <id> --audit textures placement sound models data animation` |
| A vehicle will not drive, fly or fire; a kit cannot spawn; a flag cannot be taken | `flock /tmp/claude-1000/chromium.lock node audit_behaviour.mjs --mod <id> --levels <Level> --port 5310 --json <out>` (15 to 45 min a level, one Chromium) |
| A gun sounds like a car horn, a drone, a honk | skill `bf1942-mod-extraction` section 11 first: the coherence invariant and its two guards, then `sound_coherence_measure.cjs` |
| A pose or animation reads wrong against the real game | the kit poses are `extract_pose.py --kit-poses` (state rules ANIM-16 and the ledger `ANIM` rows); `features/soldier-locomotion-animation`, `bot-body-animation`; a retail capture or a bf42plus recording settles it (skill `bf1942-server-lab`) |
| A hull placed in or on a building floor jumps, flips or sinks when entered or left (a plane in a hangar) | `python3 audit_mod.py --mod <id> --audit placement` (cause `hull-sunk-in-static`); `node surveys/census_hulls_on_statics.mjs --trees <id> --levels <l>` for what each hull stands on. The rule is `viewer/static-settle.js` (`features/fhswe-mechanics-audit`, item 1) |
| A building looks right close up and streaked, flat or wrong past some distance | its LOD rungs: `python3 surveys/census_lod_chains.py --trees <id>`; a lightmapped mesh keeps LOD 0 alone (ledger LOD-6, `features/fhswe-mechanics-audit`, item 2) |
| A seat spawn shows the kit's weapon, a round selector or a ramp springs back on release | `node audit_behaviour.mjs --mod <id> --levels <l> --only spawns,vehicles` (causes `spawn.seat-shows-kit`, `veh.selector-springs-back`); `surveys/census_seat_spawns.py`, `surveys/census_held_axes.py` |
| A gunner's sight missing in one view or on some seats; a mod's own map symbol missing (a dot, the plain arrow) | `surveys/census_seat_sights.py --vehicles`, `surveys/census_minimap_icons.py -v` (`features/fhswe-mechanics-audit`, items 5 and 6) |
| A seaplane loses hit points parked on the water or sinks; a boat will not leave a dock or shoal it floats over | `surveys/census_seaplanes.py`, `surveys/census_ship_undersides.py`; a hull is wet by its root part and floats on its `FloatingBundle`s, and a ship grounds on her col0 underside, not her box (`features/fhswe-mechanics-audit`, items 7 and 8). A torpedo bursting at the bow in shallow water is retail: it runs 6.58 m deep (FLOAT-1) |
| A hole or pit in the ground in one game mode only | `surveys/census_mode_cut_covers.py`: a heightmap cut covered only by another mode's statics. Check the level's own `<mode>.con` before calling it a bake defect (Omaha Charlie sector's CoOp, `features/fhswe-mechanics-audit`) |
| What the engine does, before any of the above is "fixed" | skill `bf1942-knowledge`: the ledger row wins; `python3 .claude/skills/bf1942-knowledge/scripts/find.py <words>` |

A defect fixed on the way goes into the pipeline's regression corpus with its
guard the same day (`features/mod-extraction-pipeline/README.md`); a finding
left open goes in the mod's tracker below with its evidence.

## Where each mod's work is tracked

| Tree id | Install folder | Tracker and open issues | Scorecard |
|---|---|---|---|
| `fhsw` | `FHSW` (0.81, chain FHSW -> FH -> bf1942) | `features/fh-fhsw-open-issues/README.md` (FHX, FHV, FHR rows); `features/fhsw-random-kit-items` | `features/mod-extraction-pipeline/scorecards/fhsw.md` |
| `fh` | `FH` | `features/fh-mod-extraction/` (README, AUDIT, BEHAVIOUR, COMPLETENESS, MECHANICS); `features/fh-fhsw-open-issues` | `scorecards/fh.md` |
| `fhsweurope` | `FHSWEurope` (0.84, chain FHSWEurope -> FHSW -> FH -> bf1942; ships its own partial `standardmesh.rfa` and `texture.rfa`) | `features/fhsweurope-extraction/README.md` (fixed, measured and open items with their owners) | none yet |
| `desertcombat`, `dc_final` | `DesertCombat`, `DC_Final` | `features/desert-combat-parity/README.md` (paused 2026-10-07), `bot-desert-combat`, `dc-engine-reads`, `dc-mortar-and-kit-pads`, `con-reader-spellings` | none yet |
| `xpack1`, `xpack2` | `XPack1`, `XPack2` | `features/swrtr-asset-audit`, `features/sw-rtr-behaviour`; never `extract_all --own` alone, the pack tree must hold the whole chain's templates | none yet |
| `eod` | `EoD` | `features/mesh-mod-assets/README.md` (the pilot); parked until the vanilla bot issues close (owner, 2026-09-24) | none yet |
| `bf1942` (vanilla) | `bf1942` | `features/bf1942-parity-round-2026-09-19` is the open list | |

Every mod tree lives at `viewer/models/mods/<id>` and `viewer/maps/mods/<id>`;
vanilla at `viewer/models` and `viewer/maps`. The layout and the registry are
`features/mesh-mod-assets/README.md`. What each extractor reads and the
formats are skill `bf1942-mod-extraction`.

## Traps that cost a day each

* **Level names with apostrophes** (EoD's `charlie_don't_surf`) break a
  `--levels` list spliced into a generated shell script; write the names to a
  file and `mapfile -t`. The pipeline passes them as argv and is safe.
* **A pack or mod tree holds only what the mod adds** unless the models step
  ran over the whole chain. A replay or map on Road to Rome drew no vanilla
  jeep until the pack trees were re-extracted with the chain (2026-10-11).
* **`extract_hud_pack.py --mod M` run directly** writes a complete pack of 135
  inherited PNGs into the mod tree; the `hud` step runs `extract_hud_mods.py`,
  which keeps only what differs from vanilla.
* **A full level re-bake replaces each level directory**, taking with it
  anything another session wrote there from unlanded code. Diff against the
  volume before publishing a re-bake.
* **Inherited levels.** `extract_maps_all.py --mod XPack1` with no `--levels`
  bakes the 23 vanilla levels the pack inherits as the pack's. The pipeline's
  `--all-own-levels` is the mod's own archives only.
* **The same-size manifest.** A `mods.json` whose counts change by equal digit
  width is skipped by the publisher's size compare; publish it with `--hash`.
* **`CreateInvisible` drops the subtree, not just the draw** (fixed 2026-10-14,
  `bf42/assemble.py` `build_node`). A rotational turret or a cannon that is
  `CreateInvisible` took its children with it: FHSWEurope's T-34 and OT-34 drove
  as hulls and the IS-2 had no cannon, HUD or camera. The engine withholds only
  the object's own draw (ledger PHY-24). A glb with the turret or the cannon
  missing is this bug before it is anything else: count the subtree's nodes.
* **An RLE TGA with the origin bit clear reads as stored** (fixed 2026-10-14,
  `extract_loading_assets.py`). PIL flips it; the engine does not. Loading
  pictures, and any art a mod authors as RLE, look upside down under PIL. Check
  the descriptor byte before blaming the art (`bf42/meshtga.py` has the rule).
* **A mod's own partial archives.** FHSWEurope's `standardmesh.rfa` (103 MB) and
  `texture.rfa` (365 MB) are partial; FHSW's `_001` patches hold the rest. Read
  the chain in order, patches first, as `ArchivePool.add_dir` does. A reader that
  opens only the mod's own archives loses the chain's content silently.
* **A plank bridge has no ride surface** (fixed in the viewer, 2026-10-14).
  `viewer/collision-meshes.js` `DRIVABLE_TOP_RE` names the ride surfaces; a
  `longPlanks_m1` deck matched none of them and cars fell through it. A new
  bridge that a wheel drops through is a name gate before it is geometry.
* **Clones take the summer art.** The baked level keeps its own alt-path skins
  (snow on the Soviet side) but the viewer's clones of a registry model use the
  summer copies. Open: `viewer/level-statics.js` `loadPadVariants`
  (`features/fhsweurope-extraction/README.md`, item 6).
* **A spawn's Y is the model origin.** Pad vehicles are not ground-settled, so a
  tank's tracks can sit 0.8 m above the ground. Open:
  `viewer/level-statics.js` around the pad placement (item 7 of the same file).
* **The mod's `ModConfig` may be an uncommitted edit.** `fhsweurope` was added to
  `mod_pipeline.MODS` in the main checkout's working tree only. A detached
  worktree at HEAD does not know the tree; commit the registry before a worktree
  run, or copy the one-line `ModConfig` in by hand.
* **The silent voice fallback.** A soldier with no voice entry plays `voices/us`
  in the viewer, with no warning. A missing nation looks like a wrong nation.
* **Maintenance respects what is exported, not what is installed.** Exporting
  levels is the owner's call and is asked for explicitly ("export 10 levels",
  "export all levels"). Every other job, a rebake after an exporter fix, a layer
  patch, a re-extract, a relight, a publish, works on the levels the tree already
  exports and nothing else. A blast-radius scan over the mod's level archives
  finds levels nobody exported; intersect it with `maps.json` before acting. If
  the set you are about to bake or publish is larger than the exported set, stop
  and ask. (2026-10-14: an archive scan re-baked 36 unexported FHSWEurope levels
  and 24 FHSW ones, and they were published; 6 GB live that no page links to.)
* **A bake registers every level it writes.** `levels` read-modify-writes
  `maps.json`, so a rebake over a wider affected set adds rows for levels nobody
  imported (2026-10-14: 36 FHSWEurope and 24 FHSW). The imported set is the rows
  that carry a `loading` block (FHSWEurope 10, FHSW 70). After a rebake, restore
  the registry to the imported rows before the completion run, and list the
  rest in the tree's feature doc (`features/fhsweurope-extraction/README.md`,
  "Pending imports"). Scope the rebake to what gets tested, or accept that the
  pending levels need the same completion before import.
* **The completion run is not one command.** A bake writes scenes only. The
  rows it registers still need `loading`, `kits`, `loadouts` and `viewmodels`
  (and `manifest` for the counts). Run `run --mod X --from-step kits` after any
  rebake, then `verify`. A killed step stays `running` in the state file; the
  planner treats that as unfinished and may start a full re-extraction, so mark
  the step by hand before a resume, and say so in the state note.
* **The room server reads a level's collision itself** (`server/glb-scene.mjs`),
  not through GLTFLoader. Until 2026-10-15 it read primitive 0 of each mesh
  only and lost half a level's collision triangles (176,247 of 331,495 on
  Operation Da), among them the hangar floor under a P-40. A census or gate
  that runs in node through `server/level-load.mjs` is only as good as that
  reader: compare a node count against the page before trusting a zero.
* **A level script can place a static at 1e22 m** (FHSWEurope tigerpass-1943,
  `italianhouse05_closed_m1`). It stretched the collision index past what an
  array holds and the level never finished loading. `static-index.js` now
  drops a mesh farther than 1e6 m out; a level stuck on its loading screen
  with no console error is this before anything else.
* **Kill a pipeline run by its process group, not its shell.** Killing the
  `sh -c` and `mod_pipeline` processes by name left `extract_models.py` running
  as an orphan under `systemd --user` for an hour (2026-10-14). Its children are
  `/usr/bin/python3` with a forkserver, so name patterns miss them. It wrote
  6,116 model glbs straight into the shared tree, because `extract_all` writes
  there and the copy-with-guard step never ran. Check `ps -o ppid` for orphans
  after any stop, and expect the `.glb.gz` of anything it rewrote to be stale.
