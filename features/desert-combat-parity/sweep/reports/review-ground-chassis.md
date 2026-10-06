**Verdict: LAND WITH FIXES.** I added four commits; the branch head is now `ed04e9cd`. G2 has two known defects, listed below. Neither one is the fall-through you were worried about, so I'd land it with them recorded as open. If you'd rather hold G2 until undrawn patches have a floor, that is a fair call.

My commits:
- `2c697866` — ground's row renumbered to **COL-15**, and every citation on the branch updated.
- `961c187a` — the inertia and sea box now come from the `.sm` header box for land hulls.
- `9368352f` — G5's conclusion withdrawn in the docs, since retail contradicts it.
- `ed04e9cd` — the upside-down billing now matches the retail Humvee_TOW.

**Ledger clash:** ground's COL-13 and air's COL-14 describe the same walk and agree at every step; I re-decompiled it and checked it in objdump. COL-15 now keeps only what a land hull takes from COL-14:
- the tank case (`ShermanComplex`) and the car case (`Willy_Hull_M1`);
- the root part's collision mesh, which `getVertexCollision` finds through the same walk;
- the main LOD's alternative being entry 0 on the physics path, which I read (ground had only inferred it).

Ground's old wording differed in three places: the "else" of step (b), that inference, and the claim "the glb vertex box equals the header box", which is false for DC. COL-15 assumes main's COL-13 and COL-14, which have already landed.

| Finding | Evidence | Severity | Fixed here? |
|---|---|---|---|
| G1's choice of box is right | I ran the engine's walk over the `.con` trees of every land root in vanilla, XPack1, XPack2, DC and DC Final. The branch picks the same node every time. | – | – |
| G1 measured the glb vertex box, but the engine reads the `.sm` header box | They differ on 17 of DC's 41 land hulls: Humvee 2.545×1.905×5.008 header vs 2.33×1.905×4.945 vertices; Stryker height 1.97 vs 4.89; BMP-2 height 1.156 vs 1.36. They match on every vanilla/XPack hull. `collision-meshes.json` already carries the header box. | Medium | Yes, `961c187a` |
| Vanilla/XPack wheeled vehicles that move more than the Willy | Katyusha full-lock turn 16.6→12.8 deg/s (its own box); Greyhound 13.3→11.4; Krupp top speed 111→95 km/h (its own `drag 15`, still in the viewer's non-engine drag law); Schwimmwagen 15.8→21.7 deg/s (drawn wheel radius; it nearly rolls over in both). The XPack2 R75/HD_XA42 bikes were already broken on the base: reverse drives them forward at 138–163 km/h. Every tracked vehicle is identical. | Explained | Written up in the feature README |
| PHY-16 and the PHY-3 correction | Both confirmed in the binary: water gives no impulse, the depth is written on the part's own node, and every path reaches the submarine block. New reading: the rotational drag takes the underwater scale once; the viewer doesn't apply it. | Low | Ledger updated |
| **G2 at undrawn terrain patches** | The hull doesn't fall through. It gets lifted onto the sea surface. In the runner, a Sherman driven off a Guadalcanal beach sinks to 8 m, reaches the undrawn patch 40 m out, rises 11.8 m in one tick, then drives 800 m across the sea. A Willy drowns before it gets there. A proper fix needs the level's raw heightmap in the viewer, which means exporter work and a re-bake. | Medium | No (recorded in PHY-16 and the README) |
| **G2 doesn't reach multiplayer** | `server/level-instance.mjs` builds drives with no `collider` or `waterLevel`, and the server's `bodySpecFor` tags no `waterPart`. In a room, land hulls still drive on the sea; amphibians already couldn't swim there before this branch. | Medium | No |
| Amphibians still swim | BMP-2 3.3→5.4 m/s; BRDM-2 7.1→9.3 m/s (+31%, not in the fix report); Schwimmwagen 15→27.6 km/h in the runner (the report's 22 is the harness figure); XPack2 LVT4 unchanged. No tree contains a DUKW. The inputs (hull depth, box height) are engine-correct. | Low | README corrected |
| HP-18's comparisons | Sign of every branch confirmed in objdump. My new test confirms an upright hull on a slope is billed only past 72.5°, which is the engine's answer. | – | Test added |
| HP-18 against retail | Retail billed the unmanned Humvee_TOW 5 HP at each whole second. The branch billed only once the hull had slept (3.3 s), and 5.17 HP every 1.03 s. Two causes: the viewer judged contact after the collision response (the engine judges it before, when gravity alone gives 0.49 m/s), and it counted the one-second timer in double precision instead of the engine's float. The runner now shows 100, 95, 90 at 1.0 and 2.0 s. | Medium | Yes, `ed04e9cd` |
| G5's "no change needed" | Retail DPV at 10–15 m/s full lock: 24.9 deg/s, slip 4.3°, no spin. The branch: 99 deg/s, slip 16.7°, and it spins. Its steering lock is right (50°). | Medium | Docs and test comment only; the cause is open |
| Launch off steep terrain | Same on the base for every tracked vehicle; it already happens at 45° (M1A1 749 m/s). Retail never launches, so it is a viewer bug. | Pre-existing | No |
| Lab recordings as evidence for water entry | Older rounds had bots at AI LOD 2, and in the LOD 0 round they never drove into the sea, so neither says anything about water entry. | – | – |

**Tests:** the full suite ran 4623 tests with one failure, the BF109 wreck test in `test_sim_vehicles`. It passes on its own and with its whole file, so it is load-sensitive, not a regression.

**Merging with main:** expect conflicts in `ledger.md`, `collision-response.md`, `symbols.json` (three addresses appear on both sides: `0x0818daf0`, `0x0818db50`, `0x083b4e40`) and the two ship-pitch test files. All of them resolve by keeping both sides. A trial merge resolved that way passed the ground, damage, world, ship and sim suites.

**New gaps for other packages:**
- **Tank top speed:** every DC tank tops out at 14.89 m/s in the viewer. Retail T-72 is 11.3 and M1A1 14.1; the T-72 has the extra dummy springs. This belongs to `tracked-vehicle.js`.
- **Full-lock turn rates against retail:** the DPV is 4× too fast at 10–15 m/s, and the BRDM-2 is 2.8× too fast at 15–20 m/s. Humvee, Humvee_TOW and Technical are within about 10–25%.
- **XPack2 bikes and KettenKrad:** the R75 and HD_XA42 bikes go forward on full reverse, and the KettenKrad doesn't move at all.
- **Terrain:** undrawn terrain patches need the raw heightmap in the viewer.
- **Multiplayer server:** the server's land drives need the sea (`collider`, `waterLevel`, `waterPart`).

My scripts and logs are in `~/.cache/dc-sweep/review-ground-chassis/`; the scratch worktrees are removed.