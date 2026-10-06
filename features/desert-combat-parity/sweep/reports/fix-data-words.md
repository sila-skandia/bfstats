All five `data-words` items are done in 7 commits on `worktree-agent-aeee2813062b96bbd` (not pushed). Four are code fixes. The CIWS item needed nothing: its `autoFire` is set to the default. The whole suite ran 4608 tests with 1 failure, `test_nav_baked` `test_bocage_match_route_failures`. That failure was already there before my branch: the same seeded Bocage match gives 306 route failures on the branch base too.

## What was wrong and what changed

**1. `hasMobilePhysics 0` keeps an object static (G3), including the No Fly Zone buildings you flagged.**
- **Engine read (ledger PHY-16):** an object whose template has this bit clear gets a static physics node, and that node's update and every force it takes do nothing. Engines push on the root object's node, so the object never moves, whether anyone is at the helm or not. The default is also clear, so leaving the word out means static too.
- **Cause:** `con.py` parsed the word but it never reached the glb extras.
- **Exporter fix:** a placed root (depth 0, not an effect) gets `extras.physics.hasMobilePhysics = false` when it writes the word 0, or when it carries an Engine with the bit clear. The stamp is the only change: a Nimitz glb exported before and after differs in that one key on the root node.
- **Viewer fix:** `rootDriveKind` returns null for a stamped root, so the helm stays an enterable seat with no drive. `hull-bodies.js` no longer settles, floats or parks a stamped root, so it stays scenery where the level put it.
- **Sea Rigs carrier:** with a bot holding full throttle for 50 s, it moved 186.7 m before and 0 m now. It sits at its authored height (80.0) instead of being floated to 81.4.
- **No Fly Zone Day 2:** on the live bake, six of the eight objective buildings move by 7.8 to 175 m. The control tower rises 6.2 m and lies on its side at 84 degrees. On a scratch bake with the fix, all eight move 0.00 m over a 30 s match.
- **Vanilla:** Midway's Enterprise is unchanged (167.3 m in 20 s). Battle of Britain's factories and radar towers write the word too; they didn't move before and get the stamp at their next bake.

**2. Repair by vehicle type (WP7).**
- **Engine read (ledger SUP-18 to SUP-20):**
  - **Repair:** every 0.5 s cycle a depot works on each root vehicle in reach, crewed or empty. It heals by the first row naming the vehicle's template (case doesn't matter), at the row's rate per cycle, not per second. `setHealth` never reaches a vehicle.
  - **Kill depots:** a negative rate does damage, which is how Medina Ridge's `fk1` (`-1000`) kills what it lists.
  - **Ammo and heal:** both happen in the same cycle. The old note that ammo starves healing is refuted.
  - **Seated soldiers:** only a depot on their own vehicle serves them.
- **Fix:** `SupplyField.update` is now one pass per world tick over every soldier and every vehicle (`supplyFieldTick`). The old per-player pass shared one clock, so with bots in the world each cycle served only one of them, and empty vehicles never.
- **Level load:** depots now exist from the level's first tick. Before, they appeared only once the local player first stood on foot.
- **Checked:** 20 `test_supply.py` cases (carrier pad, `fk1`, finite reserves). In the page on El Alamein, a Willy on a `repairpoint` went from 40 to 50 HP, both driven and empty.

**3. CIWS `autoFire`.** The Phalanx writes `autoFire 0`, the engine's default, so it is already an ordinary manned gun (ledger FA-4). It is the only `autoFire` line in vanilla, the packs, DC and DC Final. What `1` would do is recorded in FA-4 but not built.

**4. Random body paints.**
- **Fix:** a level bake now runs the engine's single round-robin counter (ledger KIT-1 to KIT-3), so each placed Lada, Pickup, Technical and Technical_Recoilless gets its own paint in placement order. Model exports keep variant 1. The cockpit glb's swap list names all three paint variants, so the right exterior hides whichever paint the vehicle has.
- **Checked:** a scratch Urban Siege bake rolls 3, 1, 1, 2 for its Ladas and 2, 3, 1, 2, 2, 3 for its Pickup-bodied vehicles, against 1 everywhere in the live bake.

**5. OSA-2 beach launch.** This was a viewer bug in `ship.js`. Ground contact cancelled closing speed only at the hull's centre, so a hull arriving with spin kept tumbling on its own footprint. `stopAtContact` now also removes the spin's speed into the ground at the mean contact point. The OSA-2 now comes to rest about 1 m over the sand with no spin; before, it was still tumbling 6 m up. The jump off the crest is unchanged and I did not touch ship top speeds.

## Commits
```
5d6365fe fix(viewer): a root without mobile physics stays where the level put it
eff0dcac fix(viewer): depots repair hulls by vehicle type, and one cycle serves everyone in reach
a9703b14 docs(engine): the Nimitz CIWS's autoFire 0 is the default, nothing to build
de56aa4f fix(viewer): the ground stops a beached hull's spin as well as its fall
aa7869ef feat(exporter): a level bake rolls each placed Lada's and Pickup's paint
631fd4a2 fix(viewer): the world has its depots from a level's first tick
01f202c6 fix(viewer): any placed root without mobile physics stays where it was placed
```

**Files touched:**
- **Exporter:** `bf42/con.py`, `bf42/assemble.py`, `extract_map.py` (`level_assembler` only).
- **Viewer:** `seat-survey.js`, `supply.js`, `world-fields.js`, `world.js`, `level-load.js`, `ship.js`, `hull-bodies.js`. `world.js` is a small hunk: one tick call, and two stamps in `addDamageable`.
- **Tests:** `test_assemble`, `test_seats`, `test_supply`, `test_world`, `test_ship`, `test_deck_spawn_host`, plus their harnesses.
- **Docs:** ledger rows PHY-16, SUP-18 to SUP-20, FA-4 and a LOAD-6 note; `symbols.json`; the `collision-response.md` and `supply-depots.md` notes; `viewer-ships` §25, §25.1, §25.2 and §26; `viewer-healing-packs`; `fhsw-random-kit-items` §4; one refuted claim marked in `supply-and-health.md`.

**Outside my file list, with reason:** `hull-bodies.js` (your directive about the buildings) and `world.js` (the depot pass had to move from per player to per world).

## Asset commands you need to run
All of these are exporter output changes: full bakes, then `optimise_mesh.py`, then publish.
1. **Models**, DC and DC Final: `extract_models.py --mod DesertCombat` (and `DC_Final`) for `Nimitz_Static Nimitz_Static_Empty Nimitz_Static_Heli Nimitz_Static_Heli_UrbS`. XPack2 `Jetpack` and DC Final `Patriot` also gain the key but nothing places them.
2. **Cockpits**, DC and DC Final: `extract_models.py --cockpit` for `Lada Pickup Technical Technical_Recoilless`. `Lada.cockpit.glb` is new.
3. **Full level bakes**, `extract_maps_all.py --mod <M> --levels …`:
   - **DesertCombat:** `dc_sea_rigs dc_urban_siege midway wake dc_no_fly_zone dc_no_fly_zone_day2 dc_medina_ridge dc_operation_bragg berlin bocage dc_al_khafji_docks dc_basrah_nights dc_basrahs_edge dc_desertshield el_alamein omaha_beach`.
   - **DC_Final:** the same set, plus `dc_first_light dc_cornered aberdeen battle_of_the_bulge dc_al_nas dc_al_nas_day2 dc_coastal_hammer dc_dustbowl dc_twin_rivers liberation_of_caen battle_of_britain`.
   - **Vanilla:** `battle_of_britain` and `liberation_of_caen`. Only the new key changes; no behaviour changes there.
4. The depot, ship and depot-at-load changes are viewer-only and need no assets.

## Still open
- **Stationary guns:** they never write `hasMobilePhysics`, so the engine holds them still too, but the page still parks them as bodies that can be shoved. Stamping them changes every level in every tree, so that needs a decision.
- **Bots (bots package):** bots skip every seat of a vehicle whose root counts as a bare seat. That is now true of `Nimitz_Static` on DC Midway and Wake, as it already was of the plain Nimitz's CIWS and Sea Sparrow seats.
- **Headless runner:** `sim/stage.mjs` never gives its world any depots, so bots in `sim/run.mjs` never heal or repair.
- **Paint rolls:** the paint is rolled once at bake time, not on every respawn.
- **Depot details:** depot clocks start in step, not at the engine's random phase, and the empty-vehicle rearm isn't built. `repairVehicle` skips a vehicle when one of its fields (`+0x17c`) is 0.0; I read that check but don't know what the field is.
- **Unrelated:** the live tree is missing three `_shared/hud` JSON files and returns 404 for them.

Scratch scripts are in `~/.cache/dc-sweep/data-words/` (`ground_sim.mjs`, `static_roots_sim.mjs`, `depot_page.cjs`, the census scripts). I deleted the large scratch bakes, and the 5624 server is stopped.