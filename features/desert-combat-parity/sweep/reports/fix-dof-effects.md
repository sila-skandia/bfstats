Both packages are done and committed on my branch (5 commits, clean tree). The full suite passes (4,612 tests, 10 skipped, 0 failures), the in-page check passed, and my server on 5628 is stopped. Nothing is pushed or merged, and no shared asset tree was written to.

## WP-C: `fireInCameraDof` on vehicle guns

**What was wrong.** `assemble.py` `_fire_arms` never wrote the word. No gun node in any tree carried it: 0 of 3,308 across the vanilla, DC, DC Final and XPack1 model trees and 12 level bakes. The viewer fell back to its vanilla/XPack1/XPack2 name table, and the `camera-dof.js` comment saying newer glbs carry the word was wrong.

- DC's library sets the word on 31 vehicle guns. 18 of them have names the table doesn't know, so they fired from the barrel and bots aimed them the same way. These include the T-72's coax and NSVT, the M2A3 and Humvee TOWs, the BMP-2 AT-5, the miniguns, M230, Mi-24 gun, Mk19, recoilless rifle and AC-130 Vulcan.
- DC Final sets it on 34, 21 of them not in the table. It switches off the AH-6 and MH-500 guns that DC has on.

**What changed.**
- `_fire_arms` now writes the word on every gun, `false` included, inside that one function.
- The viewer already preferred an exported value. The table now only answers for glbs baked before this change, the code says so, and the wrong comment is replaced.

**Proof.** `test_camera_dof.py` exports DC's T-72 and M2A3 from the install:
- The NSVT fires from `T72Camera2`, the Iraqi coax from `T72Camera`, and the M2A3 TOW from `M2A3_Camera`.
- Both main guns are written `false`.
- Read as an old bake, every one of those guns fires from its barrel.

The name table and the exported values agree on every vanilla, XPack1 and XPack2 gun (13, 18 and 18 on, none disagree), and a test keeps it that way.

## WP-D: effects a level declares

**What changed.**
- `extract_effects.py --levels` bakes each level's own bundles into `<level>/effects.glb`, using the same library the level bake uses (the level's own declarations win). It adds an `effects` key to the level's `maps.json` row, so the page only fetches it when it exists. `map.html` loads it with the level, and `effects.js` puts it in front of the mod's set.
- **The five `e_*WRECKPCO` bundles are spawn effects.** They needed more than exporting. I read the server binary and recorded new ledger row EMT-10:
  - The spawn flag hands the template to `GameServer::spawnObject`, which creates a real object for every client. The server runs no other emitter and has no camera.
  - The payload is the ruined building: a 999,999 HP object with its own smoke and fire.
  - The bake now includes that object's whole tree under the emitter. The viewer stands it up at the spawn point (ignoring the view and distance culls), and `effect-objects.js` starts its smoke and fire.
- **Death effects now play where the game plays them.** New row ARM-11: each tier's effect is a child of the object at its authored offset. The viewer used to play death effects at the origin with no heading, and it played every death tier twice. In the page, one kill stood the ruin up twice; it now plays once.
- `extract_maps_all.py` now keeps the `.gz` beside a kept `effects.glb` on a full re-bake (a reason-stated edit outside my file list).

**Proof.**
- In the `effect_objects_harness.mjs` harness, killing the No Fly Zone control tower resolves `e_air_control_tower_desWRECKPCO`, and one `air_control_tower_des_wreck` stands at the tower's position with heading error 0, smoking and burning.
- In the page, I ran No Fly Zone Day 2 with the scratch glb routed in, under the browser lock. The four bundles were listed, one kill gave one object, and smoke and fire show in `~/.cache/dc-sweep/dof-effects/inpage/*.jpg`.

**This changes vanilla and the expansions too.** It is engine-correct by those two ledger rows.
- Vanilla's PT boat and Type 38 wreck bundles were listed as missing in every tree; they now leave a static raft.
- XPack2's silo and safe wrecks now stay where they spawn instead of falling and vanishing.
- Death effects keep their offsets: Battle of Britain's dish scrap starts 8 m up.
- Battle of Britain, Kasserine Pass and Raid on Agheila each get a level glb, in every tree that holds them.

## Commits
- `e2fe873c` fix(models): fireInCameraDof on every gun
- `a0bec899` feat(effects): level bundles and spawn effects
- `53799d19` fix(viewer): a death plays its tier once
- `79a68e45` fix(maps): a re-bake keeps the kept glb's `.gz`
- `ba96bcbe` docs: ledger rows EMT-10 and ARM-11, XHIT-13's "Where" cell, two subsystem notes, a new `features/level-effects` folder (with its catalogue line), `crosshair-hit-marks`, `level-bake-layers`

## Asset commands for you
- **WP-C:** no separate command. It rides the pending DC and DC Final model re-extract and full scene re-bake, then `optimise_mesh` and publish. Other trees gain the key on their next bake.
- **WP-D:** the full list is in `features/level-effects/README.md`. In short:
  - `extract_effects.py --mod <M> --levels` for bf1942 (Battle_of_Britain, Kasserine_Pass), DesertCombat, DC_Final, XPack1 and XPack2. It optimises what it writes.
  - `extract_effects.py --mod <M> --out <tree>/_shared` for the same five mods, for the rafts and XPack2's wrecks.
  - Then publish the level glbs and their `.gz`, the `maps.json` files and the `_shared/effects.*` files.

## Still open
- The ruin isn't in the collider or the damage system yet, so nothing can stand on it or shoot it. Rafts don't float or drive.
- What removes a spawned object in the game wasn't read; the page keeps it until the level changes.
- Sounds on level bundles aren't exported: `e_BritainFactory_SmokeStacks`, `e_Fire` and `e_OilFireSuper` play silent.
- The building's own wreck model still lingers 10 s over the ruin, though the tower declares `timeToLiveAfterDeath 0`.

## Belongs to other packages
- **hasMobilePhysics package:** No Fly Zone Day 2's objective buildings move under the page's physics. The tower ended about 6 m higher and on its side, and hangars floated. They declare `hasMobilePhysics 0`.
- **MS-9:** the day-1 No Fly Zone bake has none of the objective objects, so nothing on day 1 can be destroyed.
- **Ledger:** `soldier-armor-effects.js` cites rows ARM-8 to ARM-10, which were never written. Code also cites EMT-9, which is likewise missing from the ledger. I numbered my rows past them.

## Rows for `features/desert-combat-parity`
I haven't edited that file. Mark MS-4 / WP-C and MS-5 / WP-D as built, with the asset runs pending as above.