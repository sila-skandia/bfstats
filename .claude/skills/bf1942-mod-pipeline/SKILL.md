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
| Add levels to a mod that is already in the viewer ("the next ten FHSW maps") | `python3 mod_pipeline.py run --mod FHSW --levels Kharkov_Winter-1941 Karelia ... -j 12 --no-gates` |
| Bring a whole new mod in | add a `ModConfig` to `MODS` in `mod_pipeline.py` (id, install folder, `kit_flags`, `level_all`), then `run --mod <Mod> --all-own-levels -j 12 --no-gates` |
| Finish a tree someone baked by hand (kits, skins, loading, registry missing) | `run --mod <Mod> -j 12 --no-gates`: with no `--levels` the baked set is read from `maps.json`, `levels` skips scenes that exist, and every step whose input set changed runs. A tree built before the pipeline has no state record, so the plan says `would-run (no state record; outputs already present)` for every step, `models` included; when the models are known current, `--from-step levels` |
| Re-bake after an exporter change (`bf42/gltf.py`, `assemble.py`, `rs.py`, `extract_map.py`) | `run --mod <Mod> --levels <affected> --force-steps --only-steps levels flag_cloth optimise`, then `run --mod <Mod> --no-gates` to let the rest catch up. A change that reaches only `scene.json` is a layer: `patch_scene.py --layer <L> --mod <id> --all` (`features/level-bake-layers/README.md`) |
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
a foreground timeout. FHSW: `collision` is about 5 min at `-j 20`, `kits`
2.5 min, a level bake 1 to 3 min per level, `extract_vehicle_sounds.py` inside
the `levels` step about 30 min single-process, the full `viewmodels` pass the
best part of an hour, the thumbnails about a minute per hundred models.

## When it stops

The run stops at the first failed step and says so. Re-issuing the same
command skips what is done. Read the step's log (`out/mod-pipeline/<id>/logs/<step>.log`)
before touching anything:

* `failed-outputs` with `rc=0`: the extractor ran and wrote too little. Usually
  a `--mod` spelling (install folder, not tree id) or an empty voices set
  because the mod's language is not in `extract_capture_voices.LANGUAGE_NATIONS`
  (Hungarian voices 404 on FHSW until it was added).
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
| What the engine does, before any of the above is "fixed" | skill `bf1942-knowledge`: the ledger row wins; `python3 .claude/skills/bf1942-knowledge/scripts/find.py <words>` |

A defect fixed on the way goes into the pipeline's regression corpus with its
guard the same day (`features/mod-extraction-pipeline/README.md`); a finding
left open goes in the mod's tracker below with its evidence.

## Where each mod's work is tracked

| Tree id | Install folder | Tracker and open issues | Scorecard |
|---|---|---|---|
| `fhsw` | `FHSW` (0.81, chain FHSW -> FH -> bf1942) | `features/fh-fhsw-open-issues/README.md` (FHX, FHV, FHR rows); `features/fhsw-random-kit-items` | `features/mod-extraction-pipeline/scorecards/fhsw.md` |
| `fh` | `FH` | `features/fh-mod-extraction/` (README, AUDIT, BEHAVIOUR, COMPLETENESS, MECHANICS); `features/fh-fhsw-open-issues` | `scorecards/fh.md` |
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
