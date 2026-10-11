# Secret Weapons and Road to Rome: behaviour audit

Status: built 2026-10-11 on branch `claude/swrtr-behaviour-audit`. The owner
reported five defects in a replay of a SW + RtR round
(`replays/sw-rtr-user.ndjson`); this folder is the adversary pass over what
those two packs *do*, as opposed to how they look: each SW/RtR-specific
behaviour was enumerated, run through a node harness or the headless sim, and
either fixed with a test or proved faithful with the engine's own words. The
ledger rows are `SWB-1` to `SWB-11` in
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
| Raid on Agheila's own vehicles (Greyhound, M4A1, MunitionsPanzer, Krupp, RocketPlatform, Flettner) | no hull in `collision-meshes.json`: the load settle threw each 11-62 m and on its side, destroyed unattributed at t = 10 s and every respawn | the extractor also reads each own level's own `Objects/` vehicles (SWB-8) | `extract_collision_meshes.py` |
| Essen's Allied bots at the start | all six at the world origin until the first respawn (the carried paratroop group was handed to them, down) | a flag with every carrier down is not handed (SWB-9) | `viewer/bot.js` `spawnBots` |
| A pad's other-side vehicle at load (Kharkov, Kursk: Katyusha beside Wespe) | the deck settle ran both in one world; a Katyusha ended on its side | settled apart, as the terrain settle does (SWB-10) | `viewer/hull-bodies.js` |
| A thrown commando or elite knife in a replay | `CommandoKnifeThrow.glb` 404: never drawn | named by its weapon and drawn by its trail bundle (SWB-11) | `viewer/replay-props.js` |

## Checked and faithful (no change)

- The kill feed prints raw template names, as the game does; the lexicon is a
  superset of what the SW/RtR templates need.
- Raid on Agheila ships only `Heightmap.raw` and `MaterialMap.raw`: no
  pathfinding data, so bots there use the generic grid. Nothing to extract.

## Open

- The Flettner's rotors do not turn in a replay below the blur threshold:
  `Flettner_RightRotor` / `Flettner_LeftRotor` are `Engine`s with no input
  binding and `setMinRotation`/`setMaxRotation` +-150 (`c_ETPlane`, torque
  0.001), which the rig exporter leaves out (it keys on `setInputTo*`); at
  throttle above 0.5 the blurred disc is shown and nothing is missed. The
  engine's law for an input-less `Engine` (its revs against its range) is
  unread, so no spin is invented.
- Raid on Agheila's `Centre_Base` sits on a stepped structure 7 m over the
  terrain with no path to it from the baked nav: mounted bots fail the route
  every tick (19 636 in 90 s). The level ships no pathfinding maps; the page's
  painted map is the stand-in, so what the retail bots did there is unknown.
- Kharkov's first Katyusha still rests 31 degrees off level on its pad (SWB-10).
- `test_extract_vehicle_sounds` `[XPack2]` fails in this worktree: the
  published `_shared/vehicle-sounds.json` was rewritten at 09:25 by another
  agent's re-extraction and differs from this branch's extractor on the
  `Sherman_T34` gun rows. Not touched by this branch.
- `vehicle-sounds.json` has no row for the level-own Greyhound, M4A1, Krupp,
  MunitionsPanzer and RocketPlatform by design (the level's `scene.json`
  carries them); not re-checked in play.
- The Wasserfall guided missile: documented gap
  (`features/flyable-vehicles/helicopters.md`).
- Browser verification of the replay of the recording and of play-mode
  jetpack and stab was prepared (`rprobe.cjs`, `steps1.json` in the session
  scratchpad) but not run: the shared Chromium lock was never free. Everything
  above is verified by node harnesses and the headless sim.
- HUD `Recover/ShowRecover` = 3 feeding the pack's fuel bar is read from the
  layout; no retail capture of it was compared (SWB-6 is `inferred`).

## Sample audit: the stab variants (2026-10-11)

`sounds/weapons.json` of xpack1 and xpack2 named `K98BayonetStabFireArm.1-.5.mp3`,
`No4BayonetStabFireArm.1-.5.mp3`, `CommandoKnifeStab.1-.2.mp3` and
`EliteKnifeStab.1-.2.mp3` (the `randomPlay` loads of the stab patch) that were
not on disk. The extractor wrote them; the install did not. A named run of
`extract_weapon_sounds.py` replaced `weapons.json` with only the named entries,
so the tree's manifest was merged by hand and only the base mp3 copied. A
named run now merges into the manifest already at `--out`, so
`--out <tree>/sounds <Name>...` is a safe narrow install, and
`tests/test_weapon_sounds_on_disk.py` fails when any sample a tree's manifest
names (vanilla, xpack1, xpack2) is missing. Files: xpack1
`K98BayonetStabFireArm.{1..5}.mp3`, `No4BayonetStabFireArm.{1..5}.mp3`; xpack2
`CommandoKnifeStab.{1,2}.mp3`, `EliteKnifeStab.{1,2}.mp3`, all under
`models/mods/<mod>/sounds/`.

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
- `maps/mods/xpack2/_shared/collision-meshes.json` (+16 meshes in the
  second pass, +26 in the first: the Raid on Agheila vehicles and Battle of
  Britain's Ju88A and radar towers; nothing existing changed),
  `maps/mods/xpack1/_shared/collision-meshes.json` (+16, Battle of Britain's),
  `maps/_shared/collision-meshes.json` (vanilla, +19: Battle of Britain's
  Ju88A, radar towers and factory, Liberation of Caen's Pak40 and raft). The
  recipe is unchanged (`extract_collision_meshes.py --mod <M> --out <shared>`).
- `maps/mods/xpack2/_shared/loadouts.json`, `_shared/effects.glb` (+ `.gz`),
  `effects.report.json`, `effects.sounds.json`.
- Eight viewmodel glbs carrying `altfire` clips (+ `.gz`, `.report.json`):
  xpack1 `{British,French,US}Soldier__No4Bayonet`,
  `{German,Italian}Soldier__K98Bayonet`; xpack2
  `BritishCommandoSoldier__CommandoKnife`,
  `BritishCommandoSoldier__EliteKnife`, `GermanEliteSoldier__EliteKnife`.

A re-extract of xpack2's `models.json` drops the Willy variant unless the
`level_variants` step runs after it (it is in the recipe, after `models`).
