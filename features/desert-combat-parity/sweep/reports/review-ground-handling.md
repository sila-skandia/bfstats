**Verdict: LAND WITH FIXES.** I merged main in and added six commits on `worktree-agent-ground-handling`:

- `d3c952a0` merges main; both `ground_harness.mjs` blocks are kept.
- `c099bc27` fixes the radius of hidden wheels (finding 1).
- `635f405a` makes critical damage stop a ship's engines too (finding 2).
- `f597ae73` adds ledger row PHY-24, a binary read showing that `createInvisible` only hides a part (finding 3).
- `c2fd63b0` and `62882869` are doc updates: the feature README cites PHY-24, and the PHY-4 row and physics.md now say the land drives use the box drag law.

**Tests:** the full Python suite at the branch head ran 5,014 tests with one failure, `test_carried_spawn_flags`. Main fails the same way in a clean worktree, so it isn't from this branch. Both new tests fail without their fix.

## What I checked

- **Tank yaw damping and inertia.** I drove ten vanilla tanks, four DC and three XPack2 at 5, 10 and 15 m/s, half and full lock. Nothing chatters, and nothing overshoots after the stick is centred.
  - **Bot sims:** El Alamein, Kursk and Kharkov, seeds 1–3, before and after. No mounted bot had a route failure on either side; every failure was a bot on foot. Mounts and kills were the same or higher. Bots never weaved at speed.
  - **Turn rate against the lab:** bot tanks now match the lab's turn-rate-by-speed table. The Panzer IV holds 53 deg/s near standstill (lab 54, before 33) and 12.5 at 6–9 m/s (lab 12.5, before 4.8).
- **Dummy rollers.** The engine does skip them. It returns early only when both grip bits 0x20 and 0x4 are set (`0x0825b75b`, then `0x0825c671`); a plain `c_PGFDummyGrip` still gets normal friction.
  - **Lab check:** the vanilla Kursk round has four Katyusha full-lock episodes. Replayed on their own throttle and wheel angle, at 5–10 m/s:

    | | yaw rate p50 / p95 (deg/s) | slip p50 / p95 (deg) |
    |---|---|---|
    | retail | 36.5 / 41.4 | 16.3 / 20.3 |
    | after the change | 26.8 / 32.4 | 15.0 / 18.9 |
    | before | 17.6 / 19.9 | 7.8 / 9.8 |

    The lab supports the change.
- **Box drag (PHY-4).** It applies to every live physics body, land vehicles included, and the face areas sit on the right axes. Vanilla trucks and jeeps lose under 0.2 m/s; the most I measured was 0.18. XPack2's HD_XA42 (drag 6.5) loses 0.6 m/s and DC Final's DPV 1.6. Both follow from the engine's law.
- **Hidden wheels.** I listed every `createInvisible` template in the three vanilla packs. Six vehicles gain wheels: KettenKrad, R75, HD_XA42, LVT4, and the two PT boats, Elco80 and Type38.
  - The PT boats behave exactly as before afloat and beached, because the ship drive never uses springs.
  - The LVT4 is now a tank: 6.25 m/s afloat, 14.9 on land, and it beaches.
  - The XPack2 Natter is unaffected: its hidden wheels sit under hidden landing gear, which is still dropped.
- **Clash with the `vehicle-part-collision` agent:** none in files. It hasn't touched `assemble.py`; it is editing `ship-spec.js` and docs. It is working on how a vehicle part's collision mesh joins the hull's checks (its new row COL-19), and the hidden wheels' probes would join that automatically, which is correct. Whichever lands second should re-run `test_assemble`.
- **Critical damage.** It reaches bots too, since they drive through the same per-tick code.

## Findings

| Finding | Evidence | Severity | Fixed here? |
|---|---|---|---|
| 1. A hidden wheel's radius came from its collision probe's own size: 0.002 m on the bikes' sidecar wheel, 0.000 on the LVT4's, 0.176 on the KettenKrad's. In the test harnesses the bikes leant 9° and crept off at 1.3–2.1 m/s with the throttle closed. In the page the friction was applied at the wheel's centre instead of at the ground. | `measureWheelRadius` picked the first mesh, which was the probe. It now uses the probe's depth under the axle, which is what the page already uses for contact. All three vehicles now rest level and still. Every spring in the vanilla, XPack1, XPack2 and DC land trees measures as before. | Medium | Yes, `c099bc27` |
| 2. A critical ship kept full power. | A critical Elco80 held full revs and 11.1 m/s indefinitely; the ship drive never read the engine's running flag. It now loses way (4.2 m/s after 5 s) and recovers once repaired. | Medium | Yes, `635f405a` |
| 3. The claim that `createInvisible` still builds the physics had no ledger row. | Read from the binary: it only withholds the object's "drawable" flag at `BObject::init` `0x08195770`, which the renderer's culler tests. Nothing on the physics path reads it. | Low (docs) | Yes, PHY-24 |
| 4. The asset list leaves out Type38 and the Truk variants of Elco80 and Type38. | All three carry the hidden PT wheels. | Low | Corrected below |
| 5. The report's "pivots fall in the lab envelope" holds only for the Sherman and M1A1. | T-72 92–93 against a lab maximum of 84; BMP-2 99–101 against 95; Tiger 85 against a lab p99 of 76. | Low | No, still open |
| 6. Full lock from speed with W held: tanks peak at 85–118 deg/s for about a second before downshifting. The Sherman settles at 67.5. | Gearbox behaviour, not oscillation. The lab only has bot driving, so this is unverified. | Info | Owner's real-play list |
| 7. A crewed critical ship doesn't start sinking. | `stepSinkingHulls` skips any hull someone is in, so the sink starts only once she's empty. | Medium (new gap, ships) | No; recorded as open in PHY-14 |

## New gaps for other packages

- **A running engine creeps downhill.** With the engine on and zero throttle, a car creeps down a slope: a Willy does 1.4 m/s on 5.7°. This happens on main too. It needs one lab check: a parked jeep on a slope with a driver aboard.
- **Grip test by name, not by flag bits.** The dummy-roller test compares the grip name exactly. FHSW spells it `c_PGFEngineDUmmyGrip` on two springs; testing the flag bits would cover that.
- **Other mods.** The exporter change also reaches DC Final, FH, EoD and FHSW: DC Final's UH-60 gains two hidden wheels, and FHSW has 176 hidden springs. Spot extractions of M35Hood, Harley, BoysBrenCarrier, PBR, UH-60 and Flettner all build and run cleanly. Re-extracting those trees is outside routine scope; the aircraft package should look at the UH-60 when it is.

## Asset commands (corrected)

- **Vanilla models:** KettenKrad, Elco80, Type38, plus `--level Truk` for Elco80 and Type38. Subset runs rewrite `models.json`.
- **XPack2 models:** R75, HD_XA42, LVT4.
- **Full bakes:** the agent's list is right: three vanilla levels, the same three in XPack1, and twelve in XPack2. Then run `optimise_mesh.py` and publish.

Everything I produced is in `~/.cache/dc-sweep/review-ground-handling/` (the sims are under `sim/`).