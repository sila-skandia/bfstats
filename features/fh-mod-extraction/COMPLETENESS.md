# FH completeness: the missing pieces, not the wrong ones

Status: built and run on the FH tree (2026-10-11). Nothing here is published.

`AUDIT.md` asks whether what was extracted is sound. This asks whether
everything the viewer, the play front end and the mod's own files call for was
extracted at all. The check is mod-agnostic and lives in
`tools/bf1942-models/audit_completeness.py`, behind
`audit_mod.py --audit completeness`.

```bash
cd tools/bf1942-models
python3 audit_mod.py --mod <id> --audit completeness --json out.json
python3 -m unittest tests.test_audit_completeness
```

Exit status 1 on any `blocker` or `major` finding that carries no accepted
evidence. Findings use one schema (also what `--json` writes, next to the
legacy keys): `check`, `level` (null = mod-wide), `item`, `severity`
(`blocker|major|minor|info`), `cause_key`, `owning_script`, `evidence`,
`accepted`. `owning_script` is the extractor to re-run for that item.

## How "required" is derived (no per-mod list)

1. **What the viewer asks for.** `viewer_requests()` scans every `_shared/<file>`
   and `<file>.json` literal in `viewer/*.js`, `viewer/play/*.js` and the pages.
   A request that a built reference carries but no registered artifact names is
   `unregistered-viewer-request`, so the registry cannot rot silently.
2. **What the built references have.** Every other tree carrying the core set
   (models, kits, maps, loadouts, vehicle sounds) votes. A data manifest that at
   least 60% of them carry, the target lacks and the registry does not know is
   `reference-has-it-unregistered`. Sample, texture and glb families do not vote:
   they are content a mod may or may not own.
3. **What the mod's own files define**, read from the install through the mod
   chain: a `movies/*.bik` owes the menu movie, a `music/*.bik` the five menu
   tracks, a level whose `GameTypes/` lists a mode owes that mode in
   `scene.json`, a level archive with `InGameMap.dds` owes a minimap, each own
   level archive owes a baked level, a menu thumbnail and a dossier, the
   mod's `menu.rfa` owes its textures to the pack, and `init.con`'s
   `setCustomGameVersion`/`Url` must match the `mods.json` row.

The artifact registry (`ARTIFACTS`) is the only hand-written table, and it is
generic: a path, the script that owns it, a severity, and an optional probe
that makes the requirement conditional on what the mod defines.

## The class `extract_all.py` omits

`extract_all.py` runs only `extract_models.py`, `extract_pose.py`, `shoot.mjs`
and `verify`. Every artifact below belongs to a script it never starts, which is
how `deployables.json` went missing from FH. A recipe generated from the
registry should run them all (`python3 -c "import audit_completeness as a;
[print(x.root, x.rel, x.script) for x in a.ARTIFACTS]"`).

| Artifact | Owning script | Needs |
|---|---|---|
| `deployables.json` | `extract_deployables.py` | `--mod M --out models/mods/m` |
| `sounds/soldier.json` | `extract_soldier_sounds.py` | `--mod M --out models/mods/m` |
| `sounds/weapons.json` | `extract_weapon_sounds.py` | |
| `viewmodels/index.json`, `kits.json` | `extract_viewmodel.py`, `extract_kits.py` | `--kits`, `--maps` |
| `_shared/loadouts.json` | `extract_loadouts.py` | |
| `_shared/bot-names.json` | `extract_bot_names.py` | `--mod M --out .../_shared/bot-names.json` |
| `_shared/voices/*.json` | `extract_radio.py`, `extract_capture_voices.py`, `extract_soldier_voices.py` | one `--out` |
| `_shared/voices/ctf-sounds.json` | `extract_ctf_voices.py` | only when a baked level carries a Ctf mode |
| `_shared/movies/background.webm` | `extract_menu_movie.py` | `ffmpeg`; only when the chain has `movies/*.bik` |
| `_shared/music/*.mp3` | `extract_menu_music.py` | |
| `_shared/load/*.png`, `<level>/load.webp`, `maps.json` `loading` | `extract_loading_assets.py` | |
| `_shared/effects.*`, `damage.json` | `extract_effects.py` | |
| `_shared/collision-meshes.json` | `extract_collision_meshes.py` | |
| `_shared/trees.json`, `trees/` | `extract_tree_billboards.py` | |
| `_shared/vehicle-ai.json` | `extract_vehicle_ai.py` | |
| `_shared/vehicle-sonar.json`, `vehicle-spotting.json` | `extract_vehicle_sonar.py`, `extract_vehicle_spotting.py` | |
| `_shared/hud/*` | `extract_hud_mods.py` | |
| `models/mods.json` | `build_mods_manifest.py` | last |
| `tournament-images/dossiers/<mod>` | `scripts/extract_map_dossiers.py` | `--mods M --force` |
| `tournament-images/hud/kits/<mod>` | `scripts/extract_hud_assets.py` | |

## Inventory (FH, 2026-10-11)

Reference mods voting: bf1942, dc_final, desertcombat, eod, fhsw, xpack1, xpack2.
FH registry rows checked: 39 mod-wide artifacts, 4 per-level files, plus the
install-defined checks. Result after the fixes below: **0 missing mod-wide
artifacts**, 67 own levels not yet baked (see open).

| Item | Retail FH has it | FH tree | Viewer consumes | Status |
|---|---|---|---|---|
| `deployables.json` | n/a (derived) | present (written by another agent, before this pass) | `deployables.js` | ok |
| Menu background movie | `movies/Background.bik` (own, 18 MB) | was absent | `play/menu-movie.js`, no vanilla borrow | **fixed** (a): `extract_menu_movie.py --mod fh`, 2.3 MB webm |
| Bot names | 10 name scripts, 80 levels | was absent (stand-in `Player` names) | `bot-names.js` | **fixed** (a): `extract_bot_names.py --mod FH` |
| CTF announcer | vanilla `CTF.ssc` in 8 FH nations' languages; Prokhorovka has a Ctf mode | `ctf-sounds.json` absent, 12 stems x 8 nations missing | `ctf-page.js` | **fixed** (a): `extract_ctf_voices.py --mod FH` (108 voice files now) |
| Support-kit health bar | `healthbar_{empty,full}_support_64x64`, 79 FH kits | absent from pack: blank bar | `soldier-hud.js` via kit art | **fixed** (a): see below |
| Soldier minimap flags | `flag_auss/fin/fr/it/ita/pol` named by 6 soldier templates | absent | `soldier-icons.json` `minimap` | **fixed** (a) |
| Magazine bars | `magbar_garand_*`, `magbar_mg_*` (7 templates) | absent | HUD ammo bar | **fixed** (a) |
| Spawn-screen Support class glyph | `class_support_16x16` named by FH's `menu/InGame` | absent: hole in the kit row | `spawn-layout.json` | **fixed** (a): layout backfill |
| Loading screen `theme` | `vanilla` in all 6 rows | chrome art is FH's own (`_shared/load/menu_loading.png`, `loading_bar.png`, `mp_briefing.png` all differ from vanilla's) | `theme` only picks a CSS fill colour, and only `eod` has one | (c): the field is a CSS token, not art |
| Loading backgrounds, music | 5 tracks per `init.con` | all 5 mp3 present; durations match Slaughter4 / Vehicle3 / Vehicle4 / Menu / vanilla Briefing | `progress.js` | ok |
| Level thumbnails (73 own archives; the list shows 80 with inherited) | 59 ship one (2 byte-identical to vanilla's), 14 vanilla-name overrides ship none | 57 own files; 23 resolve through the chain | `hud-pack.js menuUrl` falls back to vanilla | ok: checked `level-thumbnail-unresolved` = 0; `el_alamein`, `wake` byte-identical to vanilla's |
| Nation flags, 11 nations x 5 surfaces | `icon_flag_`, `flag_ticket_`, `conp_`, `baseflag_conp_`, `flag_` | all 55 resolve in pack or vanilla | briefing, minimap, scoreboard | ok |
| Menu textures, FH-only | 1,107 new or changed | pack carries 1,081 files; 48 textures not carried | by name only | (d): unused loading/briefing plates, editor `copy` files, SP screens; listed by `menu-texture-not-in-pack` |
| Lexicon, `menu/InGame`, 3 changed spawn strings | `lexiconall.dat`, `menu.rfa` | in `pack.json` chain | spawn screen | ok |
| `mods.json` row | name, version 0.7, url | present; `info` absent | picker | (c): FH's `init.con` sets no `setCustomGameInfo`, vanilla placeholder is lorem ipsum |
| `serverInfo.dds` | in mod root and `menu.rfa` | not extracted | not consumed (only the server-list drawer, which draws live fields) | (d) |
| Mod icon | `fh.ico` | `icons/mods/fh.png` | picker | ok |
| Game modes | per level: `GameTypes/` + root `Ctf.con`, `tdm.con` | `scene.json` carries each level's offered modes; Iwo's root Ctf/TDM are not offered by any menu | `game-modes.js` | ok (`level-mode-offered-not-baked` = 0) |
| Map dossiers | 73 own levels | 73 files locally; 15 were the 2026-09-14 `GameTypes/`-first read | stats site | **regenerated locally** (a): 15 changed, manifest stamp only; not published |
| Kit badges for the site | `tournament-images/hud/kits/fh` | 834 files | stats site | ok |
| Site map art | 73 own levels | 61 own + 12 vanilla-name overrides through `searchPath fh -> bf1942` | stats site | ok |
| Gold Beach `linnut_metsa` (14 emitters) | script loads `Sound/@RTD/linnut_metsa.wav`; the file ships as `Sound/<rate>/Ambience/linnut_metsa.wav` | silent | `area-sound.js` | (c), evidence below |
| Fonts | none of its own (no `Font.rfa` in FH) | inherits vanilla | | ok |
| Score settings | `ScoreManagerSettings*.con` | byte-identical to vanilla's, so not in the pack | | ok |

### The `linnut_metsa` question

FH level scripts spell the folder where the file needs it: 37 distinct sample
paths in FH's level archives and `objects.rfa` read `@RTD/Ambience/<name>.wav`
(Meuse River Line, Saipan, Bombing the Reich, Cretan Village, Operation
Lilliput, ...), and Prokhorovka's `Bird2.ssc` loads this same
`linnut_metsa` as `@RTD/Ambience/linnut_metsa.wav`. The authors wrote the folder
whenever the file lives under it. Gold Beach's `Bird` scripts omit it, and
there is no `linnut_metsa.wav` at the `@RTD` root. The engine's folder search
itself was not traced (no function read), so the claim stays "silent as far as
the data says"; the data is consistent with retail being silent there.

## Gaps fixed in this pass (FH only, sidecar assets, no model/level/kit re-extraction)

| Gap | Fix | Code | Test |
|---|---|---|---|
| menu movie, bot names, CTF voices | ran the three extractors for FH | none | `audit_completeness` reports 0 missing |
| templates name health bars, magazine bars and soldier flags no sprite list reaches | `extract_hud_pack.py` now treats the pictures of `setHealthBarIcon`, `setHealthBarFullIcon`, `setAmmoBar`, `setAmmoBarFill`, `setMinimapIcon` as `referenced` sprites | `object_icon_textures_in` | `ObjectIconTextureTests` |
| a layout names a sprite nothing extracted (`class_support_16x16`) | `extract_hud_mods.py` backfills every `texture` of `spawn-layout.json` and `hud-layout.json` that neither `hud.json` nor vanilla's carries, from the mod's menu chain, and records it in `hud.json` | `backfill_layout_sprites` | `test_extract_hud_mods_backfill.py` |

FH pack: 1,069 -> 1,081 files (12 PNG plus `hud.json`, `pack.json`
regenerated). Vanilla's pack is unchanged (a scratch run of the new
`extract_hud_pack.py --mod bf1942` lists the same 282 sprites).

## Same gap, other mods (counted, not modified)

From the `--audit completeness` run on every tree:

| Mod | Missing mod-wide (blocker/major) | Also |
|---|---|---|
| FHSW | `sounds/soldier.json`, `_shared/bot-names.json`, `voices/ctf-sounds.json`, `hud/menu/menu-levels.json` | 265 levels absent from the Instant Battle list, 6 own levels not baked, 2 level dirs without a scene, no dossier set; up to 31 object-icon sprites the new hud rule would add |
| EoD | `deployables.json`, `_shared/vehicle-ai.json` | up to 17 object-icon sprites |
| XPack1 / XPack2 | `deployables.json`, `viewmodels/index.json`, `_shared/load/mp_briefing.png`, 23 levels with no `loading` record each | XPack2 one loading background missing; up to 4 object-icon sprites |
| Desert Combat, DC Final | none | |
| GCMOD, BF1918, Interstate, Pirates | untouched trees (no models, no maps) | |
| Vanilla | `deployables.json` | |

## Open, and why

* **67 of FH's own levels are not baked** (`level-not-extracted`, major).
  Scope: the owner asked for the push maps first and the six are done; the
  rest need the level bake, which other agents own. The check keeps failing on
  purpose until they are baked or the owner's scope is recorded in
  `tools/bf1942-models/completeness_accepted/fh.json` (entries need evidence).
* **Dossier staleness is not detected**, only presence: the 15 changed FH
  dossiers were found by regenerating and diffing. The root-script rule is
  `features/map-dossier/README.md`.
* Dossiers, site kit badges and site map art are regenerated locally under the
  gitignored `tournament-images/` and are not published.

## Recipe changes that prevent recurrence

* `audit_mod.py --audit completeness` names every missing artifact with its
  owning script and exits 1 on a blocker or major.
* `extract_hud_pack.py` no longer depends on a hand-written sprite list for
  health bars, magazine bars and soldier flags.
* `extract_hud_mods.py` backfills layout-named sprites, so a mod's own kit
  class cannot leave a hole in the spawn screen.
* The omitted-by-`extract_all.py` table above is the list a generated recipe
  should run; `audit_completeness.ARTIFACTS` is its machine-readable form.
