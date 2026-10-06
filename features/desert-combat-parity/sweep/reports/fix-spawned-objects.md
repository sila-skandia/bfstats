All five items are built, each in its own commit. Main (a8bbe93e) is merged in, the tree is clean, and nothing is pushed. The rafts and the No Fly Zone Day 2 ruin behave as the game does in both the node harnesses and the page. 4 helicopter tests in `test_flight.py` fail, but main fails the same 4 on its own.

## What was wrong and what changed

1. **Spawned objects got no body.** The bake never said whether the template's object can move. The emitter spec now carries `hasMobilePhysics`, and the spawned object is built at depth 0 so main's PHY-17 stamp lands on it. `effect-objects.js` gives it one of three bodies:
   - **Static** when the bit is clear (the ruins).
   - **Float** over water: `body-float.js` `FloatingHull`, stepped on the world's 30 Hz ticks, with the sea bed as a floor.
   - **Ground** otherwise: it falls until its box meets the terrain.

   A raft stood up 0.47 m under the water rises to +0.068, the float law's rest, in about 2 s.
2. **The ruin was in neither the collider nor the damage system.**
   - `CollisionIndex.addOwner` appends one object's hulls under a new owner id and re-packs the grid; existing ids don't change.
   - The object's armor joins the damageables under the same id (`registerDamageable`). A moving raft reports its pose through `setMovedOwner`.
   - The effects bake now keeps a spawned object's collision hulls; it used to drop them along with every particle's.
3. **What removes a spawned object (read in lnxded).** I added three ledger rows:
   - HP-19: a dead object stays its `timeToLiveAfterDeath`, after a one-tick latch, then the server destroys it.
   - HP-20: the first tick of the end game destroys every root PlayerControlObject.
   - EMT-11: `spawnObject` arms no abandon clock, so nothing else removes a spawned object.

   The page now removes a spawned object when its wreck clock runs out or the round ends. A sunk raft is gone the next tick; an unhurt ruin stands until the round ends.
4. **`timeToLiveAfterDeath` was ignored.** con.py now reads all five after-death words, and the armor extras carry them. `vehicle-wrecks.js` runs the engine's clock: 10 s with a fade from 8 s where nothing is written, instead of the old 12.5 s house rule. A wreck glb that arrives after the object is gone no longer appears.
5. **Level bundle sounds weren't exported.** `--levels` now writes `<level>/effects.sounds.json` (the row key is `effectSounds`). `EffectAudio.setLevel` puts it in front of the mod's set. The three bundles resolve: Battle of Britain's smoke stacks (through their `e_ExplGas` child), Kasserine Pass's `e_Fire`, and DC Final First Light's `e_OilFireSuper`.

Two more fixes were needed, found in the page:
- **A PT boat killed by a round never left a raft.** The immediate tier re-pick ignored water, so the boat got its land death tier instead of the water one that holds `e_PTBoatWreck`.
- **The tower went before standing its ruin up.** A `timeToLiveAfterDeath 0` object was removed in the frame it died, which stopped its death tier. The engine's one-tick latch fixes that.

## Commits
- `ff882c8a` fix(effects): a spawned object gets the body its template asks for
- `9853a9a7` fix(effects): what a spawn effect stands up is solid and can be shot
- `102d6a6e` fix(wrecks): timeToLiveAfterDeath (item 4)
- `791c2e95` fix(effects): what removes a spawned object (item 3, plus the ledger rows, symbols and subsystem note)
- `edc2c95f` feat(effects): a level's own bundles carry their sounds
- `0ff90b8f` merge of main a8bbe93e
- `0c67b822` fix(viewer): a boat killed by a round dies in the water
- `7d50342e` fix(wrecks): a death latches for a tick before its time to live runs
- `0bbf62c1` docs: `features/level-effects/README.md` and `features/level-bake-layers/README.md`

## Files outside my list, and why
- `bf42/effects.py`: the spawn spec flag.
- `bf42/assemble.py`: the spawned object's depth and hulls, and the after-death words in the armor block.
- `bf42/con.py`: parsing the five words, and adding them to the CON-15 property table so their `set` spellings read too.
- `effect-audio.js`: `setLevel`.
- `vehicle-hits.js` and `test-hooks-vehicles.js`: the water death tier, a few lines each.
- `map.html`: small hunks for the step call, getters and the level sound fetch.
- Ledger: new HP-19, HP-20 and EMT-11; notes added to HP-15, EMT-10 and DIE-9; plus `symbols.json` and the hitpoints subsystem note.

## Tests
- **Full suite:** 4908 tests, 4 failures, 10 skipped. The failures are the helicopter tests in `test_flight.py` (AH64, Mi24D). I ran main's own code against the same live model tree and got the same 4, so they aren't from this branch.
- **Touched suites pass:** effect objects, vehicle wrecks, effects, con, assemble, collision, body float, effect audio, hull wash and damage parity.
- **In the page** (port 5647, under the lock; the server is stopped):
  - **The raft:** vanilla Midway places no PT boat in the page's conquest set, so I ran it on Invasion of the Philippines instead. Killing an Elco80 gave the water death tier. Its raft floated upright at water +0.068 from 1 s on, is a 35 HP damageable, and a downward cast meets it where it floats.
  - **The ruin:** on DC No Fly Zone Day 2 I patched the tower's two new words into the live scene in memory, since that scene predates this exporter. One upright ruin stood up and the tower stopped drawing.
    - A soldier walking at it stopped 13.04 m from its centre, which is its hull wall. With its hulls switched off he walked 41 m straight through.
    - 15 AK rounds landed on it. They do no damage because the damage tables price that weapon at 0 against its material; a 500-point hit through the page's own hit path took it to 999,499.

  The scripts and screenshots are in `~/.cache/dc-sweep/spawned-objects/` (`inpage.cjs`, and `inpage/` for the screenshots).

## Asset commands (after merging)
- **Full scene re-bake of every tree** (bf1942, XPack1, XPack2, DesertCombat, DC_Final): `extract_maps_all.py --mod M`, then `optimise_mesh`, then publish. The after-death words sit on placed nodes in nearly every scene. Until then every hull uses the default 10 s, fading from 8 s.
- **The next model extract of each tree**, for the same words in the model glbs.
- **Rerun the effects bakes** in `features/level-effects/README.md`, the `_shared` sets and the `--levels` sets, so rafts and ruins carry their hulls and the flag.
- **Level sounds:** `--levels` without `--no-sound` needs ffmpeg and writes into each tree's `_shared/sounds`. Publish the new samples together with the `effects.sounds.json` files and the `maps.json` rows.

## Still open
- A raft can't be entered or driven.
- The bots' nav map and cover list are built at load, so they ignore spawned objects.
- A ground body keeps its spawn frame rather than tipping onto the slope.
- `FloatingHull` has no box drag, so a raft dropped from 4.4 m bounces twice before it settles.
- The spawn path's 2 m soldier clearance (SPAWN-14) isn't applied.
- A spawned object with no hulls (COL-17) gets no owner id, so nothing can damage it.
- The round's end removes only spawned objects in the page; the engine removes the level's own hulls too.
- A falling plane's wreck clock still restarts when it lands, where the engine counts from the death.
- The client's half of a spawn emitter is unread.

## For other packages
- **Replay:** replay death tiers would stand spawned objects up through the shared effect player, so the replay should skip spawn emitters.
- **No Fly Zone Day 2:** the other objective buildings still drift in the 2026-09-30 bake; PHY-17's stamp fixes them on the re-bake.
- **Missing ledger rows:** ARM-8..10 and EMT-9 are cited in code but don't exist.

**Parity rows (report only):** mark the spawned-objects items 1–5 as built, with the asset runs above pending.