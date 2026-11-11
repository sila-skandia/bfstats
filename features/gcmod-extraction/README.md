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

From the second quick behaviour run (2026-11-12), 10 majors, none
play-breaking by the gate's own list:

| Item | Evidence | Next step |
|---|---|---|
| GC_Hoth `ATST` x3, GC_Ryloth `Firehawke` stand 4 to 6 m under their pads | ATST: pad y 28.0, a static's top at 25.48 under the pad, the hull on the terrain at 21.8 with its feet at 21.6 (`--verbose` `pad-verdict`). It fell past a static floor | Find the static at the pad and whether it collides for vehicles in retail; `surveys/trace_pad_settle.mjs` |
| GC_Podrace `Gasgano`, `PodRacer1V1`, `PodRacer2V1` roll dead | c_PIRoll binds `GasganoComplex`, a RotationalBundle over the whole racer that carries its engines, so the audit judges it vectored; neither turn nor push | Whether the racer's thrust tilts with it in retail, and which drive the page gives a VCAir hull with no Wing |
| GC_Dantooine `ATST-V` `veh.steer-reversed` | D turned the nose 1.27 rad at a prior yaw rate of 2.95 rad/s, D's own share -0.21 | A walker spinning before the check; rerun alone |
| GC_DeathStar `TieAdvanced` `air.no-throttle` | 2.5 m at 0.4 m/s in 6 s | Rerun alone; check its engines against `holdEngine` |
| GC_Vanguard `escapepod` `air.no-throttle` | 0 m at 0 m/s; the same template releases on GC_Taskforce | Rerun alone on Vanguard |
| GC_Endor `EwokGlider` silent | its Engine names `Sounds/EwokGliderEngine.ssc`, which the level does not ship; the hull itself loads `Sounds/EwokGlider_Engine.ssc` (a `fondo.wav` loop) | Whether retail plays a PlayerControlObject's own script; no ledger row yet |

Also open, outside this tree: the `carries_engine` exemption reaches other
trees' model glbs. On this machine Desert Combat's carrier-deck aircraft
(Enterprise, Nimitz variants: 11 glbs, ~1300 nodes) would change, and the
trees not on this machine (fh, fhsweurope, dc_final, xpack1, xpack2,
interstate, pirates, vanilla) were not measured. `patch_held_axes.py --mod
<tree> --dry-run` measures it; Desert Combat's local tree also carries 302
nodes of older pending restores, so patch it from a tree that matches the
volume.

`v_harness` fails on `test_ground_handling ... test_a_bot_tank_cruises_at_retails_speed`
(M1A1 13.32 against 13.5) in the main checkout. It passes at HEAD and at HEAD
with this work applied; the cause is another session's uncommitted edits to
`viewer/aircraft.js`, `viewer/hull-bodies.js` and `bf42/assemble.py`.

## The stats site

Map pictures (60) and the kit icons were already live. 29 dossiers were live;
`gc_alaris_prime` has nothing to report (the extractor writes no dossier for
it). Four were regenerated with the root-first game-mode reading and uploaded
(`gc_bespin`, `gc_mini_cove`, `gc_mini_wasteland`, `gc_vanguard`: ticket bleed
only); the manifest was left alone, only its stamp moved.
