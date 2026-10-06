All three items are built and committed on the branch: 8 commits, nothing pushed or merged. A pad now spawns the vehicle of the side holding its flag, an abandoned pad hull times out, and a destroyed carrier's spawns go dead. The full suite passes (4,612 tests, 10 skipped).

## What was wrong
- **Root cause A (items 24, 25, 26-Bragg).** The engine's spawner logic (`SpawnerPad`) ran only for kit pads. The bake places one vehicle per pad, from the placement's own team, and the viewer only hid it while its flag was neutral. So a capturer got the other side's tank. Respawn waited for the wreck to fade, then took a uniform random delay; the engine has no random in it (SPAWN-18). `TimeToLive` and `Distance` were never exported.
- **Root cause B (items 22, 26-Bragg).** Only floating ships switched their spawns off when critical, and only flag by flag. Iraq's spawns in the Weapon Bunkers bunkers never died. Both of Bragg's Talil spawn sets were live from the start.

## Engine findings (read from `bf1942_lnxded.static`)
- **Ledger coordination.** SPAWN-9..16 are byte-identical to the kit-pickups branch (`f4f12c23`), including its correction that the pad's slot test is `isDestroyed` (vt+0xc8), not critical. My rows are SPAWN-17..20 and SPAWNGRP-10, in a section placed so the two branches don't touch. Trial `git merge-file` against that branch is clean for the ledger, `deployables.js` and `features/README.md`. I dropped my own `test_deployables.py`, because that branch adds one at the same path.
- **What a flag change does (SPAWN-19).** At round start a neutral point switches its pads off. A capture sets the pad's team and restarts its whole delay. Nothing touches a hull already spawned: a tank parked at a lost flag stays there.
- **The respawn delay (SPAWN-18).** `min + (max−min)·(1 − players/maxPlayers)`, counted from the hull's destruction, not from the wreck clearing.
- **`spawnDelayAtStart` (SPAWN-17).** It is a bool read through `istream >> bool`. DC's six "15/60" lines fail the parse and keep the 0 written before them, so they delay nothing.
- **The abandoned-hull clock (SPAWN-20).** An extra out-of-combat-area bill exists in the same branch of code; it is not modelled.
- **Carriers (SPAWNGRP-10).** The ring averages only live points. A spawn picks a random active point, or is refused when none is left.
- Symbols are recorded in `symbols.json`.

## What changed
1. **The other side's vehicle (`86f30288`).** `loadPadVariants` loads it from the models tree at load time, so no re-bake is needed. Each pad becomes a `SpawnerPad`, joined to its flag by `osId` (the old nearest-flag guess only for scenes without `osId`). `vehicleSpawnActive` now follows the pad, and `syncVehicleSpawnOwnership` handles every kind of hull.
2. **Abandon clock (`2e3b488d`).** The exporter writes `timeToLive`, `distance` and `damageWhenLost` on every pad; `stepAbandoned` runs the clock. It only arms when the scene carries the words, so unpatched trees are unchanged.
3. **Dead carriers (`592e2fac`).** `bindCarriers` gives every carried spawn point a live `inactive`, which the ring, `pickSpawn`, `spawnPlayer` and the bot respawn all respect. A bot with nowhere to spawn now stays down; before, it stood up on its corpse.
4. **Smaller commits:**
   - Forklift fix, adv-conwords CW10 (`f995246d`). A `VCSea` hull that drives on wheels gets a parked body. Only the five DC Forklifts change, across every level of four trees.
   - First-tick guard (`14b08038`). Pads don't step until their level's damageables are registered.
   - Settle fix (`f133fb8f`). The level's own vehicles settle exactly as before; only the loaded ones settle apart.
   - Two doc commits (`61fe4058`, `48167c43`).

**Files outside my list, and why:**
- `level-load.js` and `map.html` (small hunks): the async model load has to happen before indexing, and the page has to pass `vehiclePads` and `maxPlayers`.
- `test-hooks-world.js`: a `__pads` hook for page checks.
- `world-players.js` and `bot-referee.js`: they are the bot respawn pick.
- `sim/{env,level,match,stage}.mjs`: so the runner loads the other-side vehicles and gets the server size.
- Docs: `viewer-ships/README.md` and the knowledge skill's spawn row.

## Proof
- **Harnesses.** `test_vehicle_pads.py` (new) covers the round start, a capture leaving the parked hull, a burning hull holding its pad, the T72 standing up 40 s after the M1A1's destruction, and a neutral flag taken. `test_vehicle_wrecks.py` gains `AbandonedHullTests`: 60 m off its pad an M1A1 keeps 100 HP for 45 s, then loses 10 HP a second; near the pad, manned, watched or in an old scene, it keeps 100. `test_carried_spawn_flags.py` gains the bunker cases. `test_object_spawn_report.py` (new) checks the exporter against DC Gazala's archive.
- **Seeded DC Gazala, re-patched scratch tree, 8 a side, 600 s:**
  - Seed 1: the US take Gabr_Saleh and its M2A3, M1A1 and AA guns stand up. After Iraq retakes it, the M2A3 is destroyed at 516.7 s and Iraq's BMP2 stands at 556.7 s.
  - Seed 2: Iraq's capture restarts a waiting delay, and the BMP2 stands exactly 40 s later.
- **Abandoned M1A1 (DC Gazala, scratch tree).** Moved 60 m off its pad and left, it is destroyed at 55.5 s and back on its pad at 165.5 s.
- **DC Weapon Bunkers.** Bunkers destroyed: all four Iraqi bots stay down to 120 s. Bunkers left standing: all four respawn on them.
- **Bragg.** Talil spawns are off at the start; each side's capture switches on only its own carrier and spawns.
- **Wake.** A critical Shokaku alone loses its deck spawn.
- **Page.** DC Gazala and Weapon Bunkers load with no errors; destroying the bunkers turns the Iraqi flag off.
- **Vanilla against the branch base `70d0b6ea`.** El Alamein, Bocage and Wake traces are byte-identical until the first neutral flag taken, held flag neutralised or hull destroyed. Those are the three moments the law changes on purpose (165.2 s, 49.9 s and 140.6 s).

## Asset commands for the lead
This is the `spawns` layer for every tree; no glb is touched. Pass `--tree` explicitly, because the default tree path's case doesn't match the live directories. Proved on scratch copies of five DC levels and vanilla Gazala.
```
cd tools/bf1942-models
python3 patch_scene.py --mod DesertCombat --tree viewer/maps/mods/desertcombat --layer spawns --all
python3 patch_scene.py --mod DC_Final --tree viewer/maps/mods/dc_final --layer spawns --all
python3 patch_scene.py --mod bf1942 --layer spawns --all
python3 patch_scene.py --mod XPack1 --tree viewer/maps/mods/xpack1 --layer spawns --all
python3 patch_scene.py --mod XPack2 --tree viewer/maps/mods/xpack2 --layer spawns --all
scripts/publish-mesh-delta.py maps --hash
```
Re-patching vanilla is a real behaviour change, and it is engine-correct. Vanilla Gazala gains `osId` on 40 of 44 pads and per-side templates on 43 (Sherman/PanzerIV and so on), so captures there will hand out the capturer's vehicles too.

## Open, or another package's
- With all its bunkers gone, Iraq should bleed out (the end-of-round rule in TKT-5). That rule isn't built in `round-state.js`, so today Iraq only stops spawning. That is a round-state change.
- The AC-130's spawn point doesn't ride the aircraft, though it does die with it.
- A wreck lying away from its pad holds that pad's next vehicle until the wreck clears, at most 12.5 s.
- `deployables-page.js` keeps its own copy of the flag join, which doesn't switch a neutral flag's kit pad off at round start. That belongs to the kit package.

Scratch is pruned to 78 MB in `~/.cache/dc-sweep/spawner-pads/`, and the 5617 server is stopped.

The build record is `features/vehicle-spawner-pads/README.md`. Suggested rows for `desert-combat-parity`: items 22, 24 and 25 Fixed; 26-Bragg Fixed (Talil switch); WP1, WP2 and WP3 done, pending the re-patch above.