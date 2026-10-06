The lead's theory was wrong: the parts' new collision hulls don't cause the regression, their new render meshes do. The fix is a 9-line change in `viewer/ship-spec.js`, and `test_flight.py` now passes 88/88 on the new glbs and on the live tree. No model or level needs re-extracting for it, so you can install the new helicopter glbs once this is merged.

**What was wrong.** `hullGeometry` gives an aircraft its box, which sets its box drag and inertia. It counted any `Bundle`- or `LodObject`-tagged mesh child as part of the node's own geometry. Since con-reader, `AH64HydraBundle` and `Mi24D_RearStand` sit next to the cockpit LOD with meshes of their own. So the AH-64's box became its rocket pods (5.08 x 0.48 x 1.65 m instead of the fuselage's 5.05 x 4.19 x 14.45), and the Mi-24's became its tail stand (0.09 x 0.06 x 0.29 m).

**Evidence**, from `test_flight.py` pointed at scratch copies of `~/.cache/dc-sweep/rex/*`:

| Tree | Result |
|---|---|
| New glbs | 4 failures |
| New glbs, the new parts' collision nodes removed | the same 4 failures, the same numbers |
| New glbs, the new parts' render meshes removed | all 87 pass |
| New glbs, with the fix | 88/88 (87 plus the new regression test) |

**The fix.** A child with any template kind is now treated as an object of its own, which is what the engine does (COL-14) and what `ownGeometryMeshes` next to it already did. `ship-spec.js` was not on my file list, but the cause is there. I did not touch `assemble.py`, `vehicle-bodies.js`, `hull-bodies.js`, `aircraft.js` or `extract_collision_meshes.py`.

**What it moves.** I checked every vehicle with body physics in the live vanilla, XPack1, XPack2, DC and DC Final trees (1,185) and the new extracts (767). Every move goes to, or toward, the part the engine's own walk picks:
- **DC/DCF AH-64 and Mi-24D:** back to their fuselage boxes.
- **AH-6, MH-6, OH-6:** back to their pre-con-reader box.
- **MH-53:** was its landing-gear legs, now the fuselage.
- **Nimitz family (8 per tree):** was its elevators, now the deck.
- **Vanilla `Lcvp` and XPack1 `ItLcvp`:** was its door (0.66 x 1.2 x 0.15 m), now every mesh (3.4 x 3.37 x 11.55); its keel moves from 2.05 m to 0.47 m against the engine's 0.39 m.

No land vehicle, other ship or fixed-wing plane moves, and no hull set changes.

**Checks:**
- **Page, DC El Alamein live bake, unfixed vs fixed:** the page builds placed vehicles from `scene.glb`, not `models/`, so this covers the baked levels. AH-64 climb in 6 s goes from 0.9 m to 78.6 m; Mi-24D tilt on the pedal goes from 62.6° to 2.5°.
- **Page, vanilla LCVP on Iwo Jima, run up a synthetic beach:**
  - Before: 25.7 m/s, and it swung off its heading with the rudder centred.
  - After: 15.6 m/s, holds its heading and grounds cleanly.
  - This is a deliberate vanilla behaviour change, toward the engine.
- **Vehicle suites:** `test_ship`, `test_world_ship_pitch`, `test_body_float`, `test_deck_spawn_*`, `test_ground`, `test_hull_wash`, `test_landing`, `test_vehicle_bodies`, `test_collision` and `test_sim_vehicles` all pass.
- **Full suite:** 5000 tests, one failure: `test_carried_spawn_flags` (`battle_of_britain/scene.json` has an extra group 99). It reads the live map data and has nothing to do with this change.
- **Ground-handling `72cf9934`:** the two branches share no file. I extracted the KettenKrad, R75, HD_XA42 and LVT4 with the merged exporter: their hidden wheels keep their collision probes, and they drive identically with and without my fix (KettenKrad 28.1 m/s, R75 30.9 m/s, as that commit reports). That branch does conflict with main in `tests/ground_harness.mjs`, which isn't mine.

**Applying the per-part collision rule (COL-17) to vehicles: read, not built.**
- I read the engine's per-part check in the binary and recorded it as ledger row COL-19 (claimed in `LEDGER_IDS.md`). A part with a single collision layer still collides. Every new DC part says `hasCollisionPhysics 1`, so the engine tests all of them and the rule would have kept them.
- A census of what the rule would remove: vanilla 35 of 68 vehicles (97 hulls), XPack1 4/9, XPack2 14/25, DC 66/134, DC Final 73/163. That's mostly gun barrels, MGs, tank road wheels, propellers and the Yamato's small turrets. No wheel spring and no vehicle root says 0, so no wheel would lose ground contact.
- This would let rounds pass through barrels and turrets, so it needs its own package and a full re-extract. It is not needed for the helicopters.

**Asset commands:**
- **For this fix:** none.
- **For your planned DC/DCF re-bake:** not needed for this fix.
- **Collision sidecars:** the DC and DC Final `_shared/collision-meshes.json` files (dated 09-30) predate con-reader. They lack the nine new part meshes and the `scales` map. Rebuilt in scratch they gain exactly those and change no existing entry; vanilla's is unchanged. Parked helicopters settle the same either way. To rebuild them, from `tools/bf1942-models`:
  ```
  python3 extract_collision_meshes.py --mod DesertCombat --out viewer/maps/mods/desertcombat/_shared
  python3 extract_collision_meshes.py --mod DC_Final --out viewer/maps/mods/dc_final/_shared
  ```
  then publish them.

**Still open:**
- The H6 family stays on the every-mesh box (its rotor disc). The engine walk's port answers `H6ControlStick_High` for it, because the glb doesn't record the LOD-switch type the engine looks for. Moving aircraft onto the engine walk is the fixed-wing package's job.
- A parked vehicle's body box is its largest collision part. On the Mi-24D that is its main rotor (16.1 x 15.5 x 0.56 m), a part the engine doesn't even test.

**Suggested DC parity rows:** vehicle-part-collision: helicopter box regression fixed in the viewer, cause was meshes not hulls; COL-17 for vehicles measured but not built; DC sidecars need a rebuild.

**Commits** (`main..HEAD`):
- `1fe44cd0` fix(viewer): a part with a mesh of its own is never an airframe's box
- `249e1f34` docs(collision): COL-19 and the regression write-up
- `2cfba51e` docs(collision): one line in the collision-response note
- `1b35fdf8` docs(collision): the stale sidecars and the parked-body box
- `86f54d1e` docs(collision): the LCVP before and after

Files touched in `<repo>/.claude/worktrees/agent-ae397085bc667ec4a/`:
- `tools/bf1942-models/viewer/ship-spec.js`
- `tools/bf1942-models/tests/flight_harness.mjs`, `test_flight.py` (it now honours `BF42_VIEWER_MODELS`), `ship_harness.mjs`, `test_ship.py`
- `features/bf1942-engine-reference/ledger.md`, `subsystems/collision-response.md`
- `features/vehicle-collision-physics/README.md`

Scratch scripts and results are in `~/.cache/dc-sweep/vehicle-part-collision/`.