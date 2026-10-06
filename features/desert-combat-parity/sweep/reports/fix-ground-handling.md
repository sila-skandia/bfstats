The DPV and BRDM-2 handling the review measured is not a tyre-law fault, and neither is the T-72's speed. Both came from comparing the viewer against a different input than the one the bots actually gave the cars. Real faults did turn up on the way, and those are fixed: tank inertia and yaw damping, the KettenKrad and the two bikes, critical damage, and the Krupp's drag. All of it is on branch `worktree-agent-ground-handling` (base a8bbe93e). My original worktree had been auto-removed, so I recreated it at `.claude/worktrees/agent-ground-handling`.

## Items 1 and 2: what retail actually shows

**Turn rate and slip (item 1).** All 266 full-lock episodes at speed in the four LOD 0 rounds have the throttle released. The car slows from 13 to 2 m/s in about 1.3 s, and its yaw rate climbs as it slows. The "99 deg/s and a spin" came from holding full throttle through the lock, which no recording covers. I replayed the recorded throttle servo and wheel angle tick by tick, through `dc_truth`'s own 0.25 s estimator on both sides. The viewer then matches:

| car | yaw, viewer / retail (deg/s) | slip, viewer / retail (deg) |
|---|---|---|
| DPV | 41.5 / 37.8 | 8.2 / 8.9 |
| Humvee | 20.4 / 21.9 | 33.9 / 36.2 |
| Humvee_TOW | 21.1 / 20.2 | 15.1 / 25.9 |
| BRDM-2 | 17.3 / 23.7 | 17.0 / 18.5 |
| Technical_Recoilless | 29.6 / 39.9 | 9.0 / 11.5 |

Nothing spins. That estimator, applied the same way to both sides, also accounts for the "viewer slips half as much" the census reported. I did not change the tyre law.

**Tank top speed (item 2).** The lab's tank speeds are the AI law (AI-45) holding each tank just under its `aiTemplatePlugIn.maxSpeed`: T-72 12, M1A1 15, BMP-2 17, M2A3 20 m/s. The recorded throttle moves between 0.4 and 1.0 tick to tick, and a T-72 holds 11.2 m/s whether it is in fourth or fifth gear. The drivetrain ceiling is 14.89 m/s for all four. The T-72's extra dummy springs cost nothing: the engine returns from the friction code for that grip type before any friction, resistance or averaging (objdump `0x0825b75b` / `0x0825c671`). Driven by the AI's own law, the viewer now gives:

| tank | viewer | lab |
|---|---|---|
| T-72 | 11.30 m/s, revs 0.758 | 11.2, revs 0.755 |
| M1A1 | 14.19, revs 0.953 | 14.1, revs 0.947 |
| BMP-2, M2A3 | 14.90, 14.89 | 14.88, 14.86 |

## What was actually broken, and the fixes

- **Tank inertia and yaw damping** (`35ded927`). `TrackedVehicle` took its inertia from the road-wheel footprint, about half the engine's geometry box (COL-15). It also had a fitted 2.0/s yaw damper; the engine has nothing comparable.
  - The small inertia made the AI's steering loop flip sign every tick, so a bot Sherman crawled at 8 m/s.
  - The damper held every tank's on-the-spot turn to a third to three fifths of retail.
  - Now they fall in the lab's 0.5–2 m/s envelope:

    | tank | viewer (deg/s) | lab p99 / max |
    |---|---|---|
    | Sherman | 63 | 62 / 64 |
    | T-72 | 93 | 78 / 84 |
    | M1A1 | 81 | 80 / 84 |
    | BMP-2 | 99 | 86 / 95 |

  - Top speed, reverse and roll are unchanged across all four fleets.
- **TANK-13 wording** (`475b3a7b`). The ledger had the min/max the wrong way round. The tank load is the frame maximum when revs ≥ 0 (objdump `0x0824c91d`–`0x0824c937`). Corrected in place; the code already did it right.
- **Critical damage stops a land engine** (`5728f492`, item 4). `vehicleTick` now clears the engine's running flag for land drives too. A critical Humvee or T-72 stops dead, stays off when re-boarded, and drives again once repaired.
- **The wheels a `.con` hides** (`72cf9934`, item 3).
  - The exporter dropped every `createInvisible` template, but the engine still builds those as physical wheels. An invisible Spring is now kept as an undrawn node with its physics and collision probes.
  - The KettenKrad stands on two such wheels behind its tracks, and the R75 and HD_XA42 on their sidecar wheel. The LVT4 drives through two of them.
  - Without them, the KettenKrad fell onto its back. The bikes tipped over and slid off at 30 m/s with the throttle closed, which is the reported "reverse drives forward".
  - `GroundVehicle` also now skips dummy rollers, as `TrackedVehicle` already did.
  - Re-extracted into scratch:

    | vehicle | top speed (m/s) | reverse (m/s) |
    |---|---|---|
    | KettenKrad | 0.08 → 28.1 | 0.1 → −7.1 |
    | R75 | 30.8 → 30.9 | +25.4 → −6.9 |
    | HD_XA42 | 30.7 → 30.8 | −28.2 → −6.8 |

  - The LVT4 becomes a tank with its water kit: 14.9 m/s on land, 6.3 afloat.
  - Not byte-identical for some vanilla and DC cars. The dummy-roller change shifts full-lock turn at speed for cars carrying dummy rollers: Katyusha/BM-21 12.8 → 20.1 deg/s, Greyhound 11.4 → 18.0, Krupp 16.6 → 22.1. It is engine-correct for them too.
- **Box drag law** (`e36e2b57`, item 5). Both land drives used a sphere drag law, which the engine uses for no physics body. They now use the engine's box law (PHY-4). The Krupp (`drag 15`) drops from 30.0 to 19.6 m/s, about 70 km/h. Vanilla trucks and jeeps move by under 0.2 m/s.
- `3025efd9` adds the replay test with a 27 KB fixture of 20 episodes, and `9c61e56c` the README section.

## Tests

- New `test_ground_handling.py` covers the lock replay, AI cruise, pivot, critical damage and the Krupp. On the base code the cruise, heading and pivot cases fail, so it catches the regression.
- Also new: a synthetic KettenKrad and a box-drag unit test in `test_ground.py`, and hidden-spring tests in `test_assemble.py`.
- I rewrote one existing test, `test_a_drivetrain_of_only_hidden_wheels_still_contributes_nothing`, because it pinned the old drop-the-hidden-wheels behaviour.
- Full suite: 4,895 tests, 1 failure, 10 skipped. The failure is `test_carried_spawn_flags` (Berlin control points), which fails the same way on a8bbe93e with the shared maps tree, so it isn't from this branch.
- Before/after drive numbers for every land vehicle in vanilla, XPack1, XPack2 and DC are in `~/.cache/dc-sweep/ground-handling/fleet/`.

## Asset commands you need to run (exporter change)

The page won't see the hidden wheels until these are re-extracted. `extract_models` subset runs rewrite `models.json` in place.

- **Models:**
  - vanilla `viewer/models`: KettenKrad, Elco80
  - `models/mods/xpack2`: R75, HD_XA42, LVT4
  - also holding copies, out of routine scope: DC, DC Final, EoD, FHSW
- **Full bakes (scene layer):**
  - vanilla: `liberation_of_caen`, `invasion_of_the_philippines`, `truk`
  - xpack1: the same three
  - xpack2: `liberation_of_caen`, `raid_on_agheila`, `invasion_of_the_philippines`, `truk`, `eagles_nest`, `gothic_line`, `hellendoorn`, `kbely_airfield`, `mimoyecques`, `peenemunde`, `telemark`, `essen`
  - out of routine scope: DC Final `invasion_of_the_philippines`, plus 4 EoD and about 60 FHSW bakes
- The Elco80 gains two undrawn nodes but drives identically, so it is only a size change.

## Merging

`main` has moved to 3cc3ff27. A trial merge conflicts only in `tests/ground_harness.mjs`: both sides appended a block before the final `process.stdout.write`. Keep both. `world-vehicle-tick.js`, `ledger.md` and `test_ground.py` merge cleanly, and the critical-damage hook survives.

## For `desert-combat-parity/README.md` (your file)

| item | row status |
|---|---|
| 1 | Matches retail for every input bots produce; the held-throttle case needs a human recording |
| 2 | Same, plus the inertia fix |
| 3 | Done; needs the assets above |
| 4 | Done |
| 5 | Done |

## Still open

- The BRDM-2 and Technical turn about 25% low in the 2 m/s crawl after a lock.
- The Humvee_TOW slips 15° in that crawl, where retail's is the kinematic 26°.
- Whether retail's DPV spins with the throttle held. That needs the human recording on the owner's real-play list.
- The car's `angularDamping 0.8` is still a fitted constant. The data doesn't decide it: at 0 the BRDM-2 and Technical match retail, but the DPV and Humvee turn 15–45% fast.
- Hidden `LandingGear` templates (Goblin, Jetpack, Natter) are still dropped. That belongs to the aircraft package.
- `lab-ground-truth.md` should say three things: the tank tops are the AI's cap, the full-lock numbers are throttle-off transients, and its slip estimator adds about yaw × 0.125 s.
- The page's wheel contact uses the unscaled collision probe, so the con-reader scale change for the M-109 and M2A3 only affects the harness fallback radius (M-109 drawn 0.36 vs probe 0.39). I didn't look further than that.