All four items are done and committed on the branch, with main `a8bbe93e` merged in. The full test suite ran 4,899 tests with 5 failures, none of them caused by this branch (details under Tests). The fix only reaches the live levels once you run the heightmap layer command below.

## 1. Launched off steep faces (fixed)
**Two causes:**
- **No hull contact with the terrain.** `body-world.js` billed damage for a driven hull's vertices in the ground but never pushed the hull out. A driven land hull's col0 vertices now go through the engine's terrain contact, the same as a parked hull's. It is pushed out along the slope's normal, half its closing speed is removed each tick, and the drive's friction gets the contact. Aircraft still only take the damage.
- **The spring probe misread steep faces.** `probeAlongAxis` in `suspension.js` assumed level ground after one step. On a steep rise it overshot and read the wheel as buried, so the bump stop fired at full load, about 100 m/s² per wheel. If the old answer lands within 2 cm of the ground it still stands, so normal driving is unchanged. Otherwise the probe now solves for the real crossing.

**Headless runner, real levels, main vs branch:**

| Vehicle | Face | Top speed (m/s) | Upward (m/s) | Height over ground (m) |
|---|---|---|---|---|
| Willy, Gazala | 45° | 93.9 → 13.3 | 68 → 7.3 | 174 → 1.2 |
| Willy, Gazala | 56° | 83.4 → 13.6 | 74 → 7.9 | 187 → 1.8 |
| Willy, Gazala | 70° | 34.7 → 13.3 | 35 → 4.0 | 27 → 1.8 |
| M1A1, Medina Ridge | 64° | 40.4 → 12.8 | 37 → 5.7 | 59 → 2.7 |
| Humvee, Medina Ridge | 46.5° | 85.6 → 16.3 | 47 → 9.7 | 3.1 after |

- Every hull now stops at the face, slides back, or climbs a short face on its own momentum. That matches the engine's friction budget: no hull can drive up 45° under power.
- The other M1A1 and Humvee runs (46.5° and 51°) also stay at or under their own top speed, under 10 m/s upward and under 4 m over the ground. The full table is in the feature README.
- The vanilla drive, bot and world suites (717 tests) pass both before and after.

## 2. No ground under undrawn patches (fixed, needs your re-bake)
- **New bake layer `heightmap`.** It writes the level's whole raw heightmap to `terrain/heightmap.png` and adds a `heightmap` key to `scene.json`. It takes under a second per level and touches no glb.
- **All three loaders use it:** the page, the headless runner and the room server. A tree without the layer falls back to the old tile-based ground.
- **Census over the five in-scope trees (167 levels):**
  - Where a tile is drawn, the two ground sources agree exactly on every level, and the new one has no holes.
  - 41 levels gain sea floor that had none.
  - All the PNGs together come to 37 MB.
  - A headless browser decodes the PNGs exactly.
- **The Sherman off Guadalcanal** now follows the bed down to 65 m and crawls along it at 6.7 m/s. It used to rise to the surface at the undrawn patch and drive 800 m across the sea.

**Side effects on DC Sea Rigs:**
- Sea Rigs draws no terrain tiles at all, so it gains its first ground. The load settle then dropped its two Forklifts 115 m off the oil rigs onto the sea bed. A new check, `standsOverTheSea`, now leaves a hull alone when it sits clear above the sea on a structure.
- Its bots also behave differently on the new ground: 60 s route failures fell from 6,283 to 3,888, and they no longer take the LCVPs. This is for the bots package to look at.

## 3. Multiplayer rooms (fixed)
- **No land vehicle moved in any room before this.** The room server never decoded wheel meshes, so every wheel radius read as -Infinity. No wheel touched the ground, and every tank and jeep sat still at full throttle.
- **Rooms now get what the page gets:** the collider, the water level, the collision meshes, the deck normal, `waterPart`, each wheel's contact depth, and the static probe. Wheel meshes are now decoded.
- **Results in a room:**
  - The Guadalcanal Sherman produces exactly the same trace as the headless runner.
  - A DC BMP-2 swims at 5.44 m/s.
  - A Wake Willy drives 10.7 m in 2 s.

## 4. Landed helicopter's nose (fixed)
- **The fix:** in `settle`, when a nose-up turn pushes a rear wheel into the ground, the hull is turned back nose-down onto that wheel and half the closing speed is removed per tick, as the engine's wheel contact does.
- **Result:** the AH-64 now stops at 5.5° on its tail wheel and the Mi-24 at 5.3°. The AH-6 and Mi-8 stay level. Before, a 10°/s pitch rate went past vertical.
- **Fixed-wing aircraft:** Spitfire, B-17 and Zero takeoffs are unchanged. A taildragger's pitch on the ground is now capped at its three-point attitude (Spitfire 15.5°).

## Commits (`main..HEAD`)
`b84ec1ab`, `5cf712a1`, merge `cc4a610c`, `55248173`, `42e68059`, `76908c8b`, `0007b90d`, `22336da1`, `cdf0d8fe`.

## Files outside my list, and why
- **`suspension.js`:** `probeAlongAxis` only, the probe's arithmetic. Ground-handling's spring law is untouched.
- **`body-world.js`:** the driven-hull terrain hunk.
- **`vehicle-bodies.js` and `hull-bodies.js`:** I moved `wheelContactDepths` so the server can share it, and added `standsOverTheSea`.
- **`level-load.js`, `sim/level.mjs`, `sim/stage.mjs`:** small hunks to load the heightmap.
- **Server files:** `glb-scene.mjs`, `level-load.mjs`, `level-data.mjs`.
- **Exporter:** `scene_layers.py`, `extract_map.py`, `patch_scene.py`, `bf42/terrain.py`.
- **Docs:** the feature READMEs, the `level-bake-layers` README, the PHY-16 ledger row's status, `collision-response.md` and `helicopters.md`. No new ledger IDs.

## Tests
- **New regression tests:**
  - Terrain push-out: `test_vehicle_bodies`.
  - Probe on steep faces: `test_ground`.
  - Real-level face drives: `faceWilly`, `faceM1A1` and `faceHumvee` in `test_sim_vehicles`.
  - Heightmap PNG and ground: `test_terrain_heightmap`.
  - Landed AH-64: `test_flight`.
  - Room land drive: `test_room`.
- **`test_scene_layers`** (two Berlin bakes, every layer patched back over them) passes.
- **Full suite: 4,899 tests, 5 failures, none caused by this branch:**
  - Four `test_flight` checks on the extracted DC helicopters failed because the shared model tree was rewritten (`AH64.glb` and `Mi24D.glb`, 06:05) while the suite was running. `test_flight` passes on its own, run twice since.
  - `test_carried_spawn_flags` (an AI-only spawn group showing a ring) fails on main too. It looks like test-versus-live-tree drift.

## Commands for you to run, every tree
```
cd tools/bf1942-models
for m in bf1942 XPack1 XPack2 DesertCombat DC_Final; do python3 patch_scene.py --layer heightmap --mod $m --all; done
python3 ../../scripts/publish-mesh-delta.py maps --hash
```
EoD (parked) and FHSW also have level trees if you want them. No glb re-bake is needed.

## Still open
- **Terrain height formula:** the engine builds ground height from triangles (alternating diagonals, flat face normals). The viewer interpolates bilinearly. Not ported.
- **Springs and hull push-out:** in the engine a hull pushed out of the ground loads its springs less. The drive's springs run before the hull contact and never see it. No measured case needed it.
- **Bare drive model:** without the body world it still climbs an endless analytic wall at 22–47 m/s (it was 453–1,103), because its springs push along the hull's up axis, not the ground normal. That is ground-handling's spring law. The page, runner and rooms all have the hull.
- **Smaller gaps:**
  - An aircraft's hull still meets the ground only through its height clamp.
  - Room colliders have no drivable mask, so room hulls meet no bridge decks.
  - A Humvee nosing into Medina's 46° face at 16 m/s is wrecked by crash damage. I believe that is the engine's law but have not checked it against retail.

Scratch scripts are in `~/.cache/dc-sweep/terrain-contact/` (1.9 MB). The temporary base worktree and the census copies are deleted, and nothing is left running on 5650.