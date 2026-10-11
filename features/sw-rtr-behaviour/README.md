# Secret Weapons and Road to Rome: behaviour audit

Status: built 2026-10-11 on branch `claude/swrtr-behaviour-audit`. The owner
reported five defects in a replay of a SW + RtR round
(`replays/sw-rtr-user.ndjson`); this folder is the adversary pass over what
those two packs *do*, as opposed to how they look: each SW/RtR-specific
behaviour was enumerated, run through a node harness or the headless sim, and
either fixed with a test or proved faithful with the engine's own words. The
ledger rows are `SWB-1` to `SWB-7` in
[bf1942-engine-reference](../bf1942-engine-reference/ledger.md).

## What was wrong, and what is built

| Behaviour | Was | Now | Where |
|---|---|---|---|
| The SW jetpack trooper | walked: the `ActiveKitPart` was never read (SWB-1, SWB-2) | thrust, lift, heat, the fuel bar, the flight pose, the flame, the burst report, the fall damping (SWB-3) | `viewer/rocket-pack.js`, `rocket-flame.js`, `soldier.js` `#stepRocketPack`, `replay-bodies.js` `updateFlames` |
| The same trooper in a replay | an upright figure gliding | the rocketeering pose family, the flame while the pose says the pack burns, the report on the rising edge | `replay-bodies.js`, `replay-recording.js` |
| Knife and bayonet stab (RtR bayonets, SW commando and elite knives) | the right button toggled a zoom | a stab: the `altfire` viewmodel clip, the child FireArms' report (SWB-4) | `viewer/hand-alt-fire.js`, `hand-weapon.js`, `extract_viewmodel.py` `altfire` family |
| A mod's replay and bots drawing a vanilla vehicle | 404 on the mod's tree, no hull | the mod's tree first, vanilla's behind it, for models, weapons, cockpits, viewmodels | `viewer/pose-bases.js` `modelUrls`/`fetchFirst`, `replay-assets.js`, `arms-rig.js`, `vehicle-base.js` |
| Raid on Agheila's SAS `Willy` | the replay drew vanilla's jeep, the level bake the SAS one | a model of its own, `Willy.Raid_on_Agheila.glb`, and a pipeline step (`level_variants`) so a re-extract does not drop it (SWB-5) | `extract_level_variants.py`, `mod_pipeline.py` |
| The Natter (SW's rocket glider) at level load | flipped off its launch ramp by the terrain-only settle and destroyed unattributed at t = 2 s, every respawn, on Hellendoorn (SWB-7) | stays where the level put it | `viewer/vehicle-bodies.js` `standsOnAStatic`, `hull-bodies.js`, `level-terrain.js`, `static-index.js` `skipRoots` |

## Checked and faithful (no change)

- The kill feed prints raw template names, as the game does; the lexicon is a
  superset of what the SW/RtR templates need.
- Raid on Agheila ships only `Heightmap.raw` and `MaterialMap.raw`: no
  pathfinding data, so bots there use the generic grid. Nothing to extract.

## Open

- The Wasserfall guided missile: documented gap
  (`features/flyable-vehicles/helicopters.md`).
- Browser verification of the replay of the recording and of play-mode
  jetpack and stab was prepared (`rprobe.cjs`, `steps1.json` in the session
  scratchpad) but not run: the shared Chromium lock was never free. Everything
  above is verified by node harnesses and the headless sim.
- HUD `Recover/ShowRecover` = 3 feeding the pack's fuel bar is read from the
  layout; no retail capture of it was compared (SWB-6 is `inferred`).

## Assets the publisher sends

Relative to `tools/bf1942-models/viewer/`:

- `models/mods/xpack2/Willy.Raid_on_Agheila.glb` (+ `.gz`, `.report.json`),
  `Willy.wreck.Raid_on_Agheila.glb` (+ `.gz`, `.report.json`),
  `models/mods/xpack2/models.json`.
- `models/mods/xpack2/sounds/weapons.json` and the mp3s
  `GermanElite_RocketPack.mp3`, `GermanElite_RocketPack.r1.0.mp3`,
  `jetpack-idle.mp3`, `CommandoKnifeStab.mp3`, `EliteKnifeStab.mp3`.
- `models/mods/xpack1/sounds/weapons.json` and `K98BayonetStabFireArm.mp3`,
  `No4BayonetStabFireArm.mp3`, `SoMeWa2.mp3`.
- `maps/mods/xpack2/_shared/loadouts.json`, `_shared/effects.glb` (+ `.gz`),
  `effects.report.json`, `effects.sounds.json`.
- Eight viewmodel glbs carrying `altfire` clips (+ `.gz`, `.report.json`):
  xpack1 `{British,French,US}Soldier__No4Bayonet`,
  `{German,Italian}Soldier__K98Bayonet`; xpack2
  `BritishCommandoSoldier__CommandoKnife`,
  `BritishCommandoSoldier__EliteKnife`, `GermanEliteSoldier__EliteKnife`.

A re-extract of xpack2's `models.json` drops the Willy variant unless the
`level_variants` step runs after it (it is in the recipe, after `models`).
