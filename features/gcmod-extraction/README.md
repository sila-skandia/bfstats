# Galactic Conquest (GCMOD) in the viewer

Tree id `gcmod`, install folder `GCMOD` (version 8.5, chain GCMOD -> bf1942).
Extracted 2026-11-12 on the owner's request ("convert GC Mod into our browser
implementation"), every one of the mod's 30 own levels, with
`mod_pipeline.py run --mod GCMOD --all-own-levels`.

Before this the volume held only the service record's poses-only tree for the
mod (`mods.json` counts: 0 models, 0 maps, 44 poses). It now holds 273 models,
30 levels and 232 poses.

## What the run found and what was fixed

The first quick behaviour run over the 30 levels read 93 majors; after the
fixes below, 10. Each fix is in the pipeline's regression corpus
(`features/mod-extraction-pipeline/README.md`) with its guard.

| Finding | Cause | Fix |
|---|---|---|
| `poses_shared` failed, no reason in its log | GCMOD keeps a `Parachute` AnimatedBundle by name with no skeleton, geometry or children | `extract_pose.export_canopy`: an empty or undeclared chute is `absent`, not an error; the canopy's errors are printed |
| 39 `asset.404` on vanilla rigs | the viewer server's remote cache kept a `viewmodels/index.json` from Nov 5 forever, naming shas production had replaced | `serve_viewer.py`: a cached manifest is re-fetched after an hour |
| Escape pods and the A-Wing family (Green, Alpha, Avenger) in the capital ships' hangars on GC_Taskforce, GC_Vanguard, GC_Tanaab: every axis dead, 0 m/s at full throttle | the spawner's hold is released on the revs of the first engine, which here is the A-Wing's VTOL lift engine, wound backwards (`setAcceleration 500/0/-10000`), so W leaves it at 0 | `Aircraft.holdEngine`, the engine nearest the root (INFERRED reading of AI-121's `getEngineFromChildsAndSiblings`) |
| ImpGunship (Corellia) and ImpSkiff (Dantooine) did not yaw | `browse_rig` stripped the hover-engine racks' `c_PIYaw` from the model glb over hidden roll wheels | `browse_rig(carries_engine=)` for a bundle carrying a plane engine; the eight affected gcmod model glbs patched in place with `patch_held_axes.py --mod gcmod` |
| A-Wing clones and the TIE fighter `air.diverges`; podracers' pitch dead; AT-STs off their pads | the audit released VTOL craft at a lift-off speed their engines made, read cockpit-tilt bundles as control surfaces, and took a hip-high origin for a hull in the air | `audit_verdicts.mjs`: `releaseSpeed({vectored})`, `airAxisRole` 'cosmetic', `padGroundVerdict({hullBottom})` |
| `land-no-collision` play-breaker on Endor's `Lift_Cabine` | a lift's cabin: three seats and a HUD, no Engine, Spring, Wing or float, `hasMobilePhysics 0` | `audit_mod.py`: accepted cause `land-no-collision-immobile` |

Accepted as the mod's data (`audit_behaviour_accepted.json`, each with its
evidence): Alaris Prime's `CrateTransporter` engine (its script is in no
archive), the Carrack cruiser's slow vertical push (mass 100000, a torque-1
lift engine), the Mos Eisley `Speederbike` falling from 500 m (no lifting
surface).

## Open

The second quick behaviour run (2026-11-12) read 10 majors. Since then:

| Item | State |
|---|---|
| GC_Hoth `ATST` x3, GC_Ryloth `Firehawke` 4 to 6 m under their pads | **Fixed (audit).** Hoth's pads stand over the `atatbarge`'s hold: its col1 deck at 25.42 m is a down-facing ceiling (normal -y) over the hold floor at 21.95, so a walker dropped from the pad falls through it (COL-23's one-sided test) and stands on the floor, as the page has it. The audit's floor probe took the ceiling for a floor; it now reads `__staticFloorAt` (`static-settle.js` `staticFloor`, which passes a down-facing face). Both read `veh.pad-over-ground` (info). The load settle's own `staticTop` still takes the first face; it ends right only because the body falls on. |
| GC_Vanguard `escapepod` `air.no-throttle` | **Fixed (audit).** The pods ride `runner`, the team-2 side of `lancerrunnerspawner1`; in a team-1 round the Runner is not in the world, so neither is its hold. The audit now stands an absent host before testing what it holds (`__standHost`); the pod then rolls 72 m and lifts off at 2.4 m/s |
| GC_DeathStar `TieAdvanced`, GC_Dantooine `ATST-V` | Pass alone: neighbours in the batch run, not the craft |
| GC_Mos_Eisley `Speederbike` diverges | Accepted: no lifting surface |
| GC_Podrace `Gasgano`, `PodRacer1V1`, `PodRacer2V1` roll dead | **Open, retail check asked.** c_PIRoll binds only `GasganoComplex`, the invisible RotationalBundle (0/0/-25..25) that carries the whole racer: floaters, engines, rudders. Whether that slides, banks or does nothing in retail decides the fix |
| GC_Endor `EwokGlider` silent | **Open, retail check asked.** Its Engine names `Sounds/EwokGliderEngine.ssc`, which the level does not ship; the hull itself loads `Sounds/EwokGlider_Engine.ssc` (a looped `fondo.wav`) |
| The hold engine (`Aircraft.holdEngine`) | **INFERRED, retail check asked**: which of the A-Wing's two engines (main on W, lift on S) releases a hangar hold |

### The thrust-rack fix in every tree (2026-11-12)

`patch_held_axes`'s rule, measured against the live volume by reading each
model glb's JSON chunk (every row and variant of each tree's `models.json`):
desertcombat 18 of 580 glbs (Enterprise, Nimitz and Shokaku variants, two
hangars: the deck helicopters' and jets' engine racks), fhsw 3 of 8,134
(`CounterSpawnKi-201_SP70`, `GrafZeppelin`, `GrafZeppelin+10000`),
fhsweurope 2 of 9,911, fh 0 of 3,360, gcmod 8 (patched at extraction). The
install census found no rack in vanilla, XPack1, XPack2, EoD or bf1918;
dc_final has no tree on the volume, and bg42, finnwars, interstate and
pirates are poses-only trees there. Only the new axes were added (the older
pending restores those trees carry were left alone); the store blobs were
written under their new shas, `desertcombat` and `fhsw` `models.json`
repointed, and all of it published with `--hash`. Level bakes were not
affected: Corellia's bake, made before the fix, already carried the racks'
yaw.

`v_harness` fails in the main checkout on `test_ground_handling ...
test_a_bot_tank_cruises_at_retails_speed` (M1A1 13.32 against 13.5); it passes
at HEAD and at HEAD with this work, so it is another session's uncommitted
edits to `viewer/aircraft.js`, `viewer/hull-bodies.js` and `bf42/assemble.py`.

## Found in play (2026-11-12)

- **Team radio silent (F1 to F4), shouts fine.** GCMOD writes its own
  patches into `menu/MenuRadioSound.ssc`, the script the engine loads
  (RADIO-2); vanilla's only includes `MenuRadioSoundHigh.ssc`, and
  `extract_radio.py` read that High file directly. So GC's three languages
  (`hothrebel`, `hothsnowtrooper`, `montrooper`) were asked for vanilla's
  `RogerThat`, `Negative`, ... and had 0 of 26; GC ships `RogerThat01..06`,
  `Negative1..4`, `RequestingReinforcements1..2` and the rest. The extractor
  now reads `menu/MenuRadioSound.ssc` and `SoldierVoice.ssc` at the HIGH tier,
  following their includes: GC's languages have all 38 team lines. Every other
  installed mod's two scripts are dispatchers to the same High files, so no
  other tree's output moves. Published; `tests/test_extract_radio.py`
  `GalacticConquestRadioTests`.
- **A grenade on a sleeve**, seen once and gone on a reload: a stale cached
  file, not a defect.
- **The lab server and GC.** "Data differs from server": the lab wrote the map
  list lower-cased (`gc_taskforce ... gcmod`), and GC's `contentCrc32.con`
  keys its checksums `GCMOD GC_Taskforce`. The Windows lab server
  (`--server windows`, 1.61 in the client's own bottle) now keeps the
  scenario's spelling and passes the check; scenarios
  `lab/scenarios/gcmod-*.json`. The retail client then crashed loading
  GC_Taskforce (log stops mid-load, no crash report); GC_Hoth is the next try.

## The stats site

Map pictures (60) and the kit icons were already live. 29 dossiers were live;
`gc_alaris_prime` has nothing to report (the extractor writes no dossier for
it). Four were regenerated with the root-first game-mode reading and uploaded
(`gc_bespin`, `gc_mini_cove`, `gc_mini_wasteland`, `gc_vanguard`: ticket bleed
only); the manifest was left alone, only its stamp moved.
