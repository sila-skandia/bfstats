All the follow-ups are done, everything is committed on `worktree-agent-a143677afe141e2ca` (latest `2dfce5b2`), and the extractor, fixture and `lab-ground-truth.md` are ready to land. Nothing is pushed or merged. The lab server is idle, I stopped only my own runs, and I removed the replay copies from `viewer/replays` after each stop. Disk is at 96%; the long Gazala run added about 600 MB under `~/bf1942-lab/runs`.

## Your three last asks

- **Spandrel correction: done.** Measured against the BRDM-2's own motion, the 12 flights left at 199.8–201.0 m/s; the fit is 200.5 plus 1.015 times the launcher's speed. That is the 200 m/s FireArms default (FA-3). The 191.3 m/s round came from a BRDM-2 backing away at 8.9 m/s, so 200.2 relative to it. The TOW gives 99.97 plus 1.037 times its launcher's speed. `round-launch.js` already adds the platform's velocity this way.
- **Helicopter rockets: still unmeasured, so the Hellfire's 83 m/s can't be checked from bots.** A Gazala LOD 0 run of 18 rounds (12,199 s, every shot real) added 972 s of AH-64 flight, 606 s of Mi-24D and 1,352 s of Mi-8. With the earlier LOD 2 runs that is 3.7 h of helicopter flight. The only helicopter weapon fired was the AH-64's M230 (132 shots). No Hydra, Hellfire, S-5 or AT-2 fired, and no soldier fired a Stinger or SA-7.
  - DC's AI data does list the Hydra, Hellfire and AT-2 racks as bot weapons, so why bots never fire them is still unread.
  - **DC 0.7 data bug:** the Mi-24's S-5 rack names `aiTemplate Mi25DS5`, but the weapon template is `Mi24DS5`. Bots therefore have no S-5.
- **Static wrecks (COL-16..18): can't be answered from bot recordings.**
  - No recorded level places a static wreck.
  - The levels that do (Bragg, 73 Easting, Urban Siege, Inshallah, Basrah Nights, vanilla Liberation of Caen) have no co-op layer, so bots can't play them.
  - The one co-op level with wrecks, Basrah's Edge, uses `DC_pickup-wreck1_m1` and `DC_slumwreckage1_m1`. Both write `ObjectTemplate.setHasCollisionPhysics 1`, so not every DC wreck template lacks it; only the vehicle wrecks used as statics do (`Mi24DWreck`, `T72Wreck` and so on).
  - In a 750 s LOD 0 round there, no round came within 14 m of any of them.
  - Settling it needs a human on Bragg in Conquest.

## The earlier asks

- **(a) Pads, LOD 0 El Alamein Day 2:** this round confirms the earlier findings.
  - Captured pads spawn the capturer's hull within 0.00–0.04 s.
  - Respawns follow `calcSpawnDelay` with the bots counted: fill 0.934–0.936 for hulls spawned during play, the full maximum for hulls placed at load.
  - Wrecks stand 60 s for tanks, IFVs and BRDM-2s, 10 s for everything else.
  - The abandon drain starts after 47–51 s idle, at 9.2–10.1 hp/s.
- **(b) Vanilla LOD 0 (El Alamein and Kursk).**
  - Level top speeds at full throttle (p99 / max): Sherman 14.21 / 14.63 m/s, Panzer IV 14.59 / 14.72, Tiger 9.11 / 9.19, Priest 11.03 / 11.24.
  - Slope does not move a tank's top speed.
  - The T-34 (10.9) and T-34-85 (11.1) are lower bounds only, because the Panzer IV also tops out lower on Kursk.
  - Turn rates by speed: tanks pivot at 40–60 deg/s near a standstill and turn 11–15 deg/s (p95) at 6–12 m/s; DC armour turns about twice as fast at that speed.
  - Willys and Kubelwagen full-lock tables are in the doc. The bot drive law holds cars at 18–19 m/s, so their top speed and anything above 20 m/s stay unmeasured.
- **(c) Rockets that did fly:** the MLRS, AS-7, TOW, AT-5, Spandrel, Aim-9 and AA-10. The rounds table now covers every run.
- **(d) Rifle spread (DEV-9): unsettled.**
  - The `f` record's direction is the aim before any spread: a shotgun's pellets share one direction and fly up to 1.9 degrees apart.
  - A still bot's rifle rounds hold one offset per burst and vary only 0.03–0.05 degrees rms, which is the recorder's resolution, so no per-shot spread is drawn to test.
  - The Saiga's pellets lean towards a square cone but don't decide it.
  - It needs a human shooter on the lab server, or a read of the binary at `fireBarrel`.

## Extractor fixes in this stretch

- A template's ground lives and its airborne lives are now summed apart, labelled `aloft`. Before this, one M1A1 left 15 m above Gazala's heightmap pulled every M1A1 life into the air table.
- The end tickets are cut at the round's end, not at the next round's reset.
- Unmatched flights are counted under `(unmatched)` instead of crashing the JSON output.

## Tests

`test_dc_truth` now has 12 tests (one new), and it and `test_lab` pass. The full bf1942-models suite ran 4,612 tests with 2 failures, neither mine:
- `test_features_catalogue`: `features/desert-combat-parity` needs its line in `features/README.md`, which you add.
- `test_nav_baked` Bocage route failures.

## What's left unmeasured

Water entry, boats and ships, the Harrier's hover, the DPV above 15 m/s, Weapon Bunkers, helicopter and shoulder rockets, DEV-9, and the static-wreck collision rule.

## Files

- `<repo>/.claude/worktrees/agent-a143677afe141e2ca/features/desert-combat-parity/lab-ground-truth.md`
- `<repo>/.claude/worktrees/agent-a143677afe141e2ca/features/desert-combat-parity/lab-ground-truth.json` (the 10 DC runs)
- `<repo>/.claude/worktrees/agent-a143677afe141e2ca/features/desert-combat-parity/lab-ground-truth-vanilla.json`
- `<repo>/.claude/worktrees/agent-a143677afe141e2ca/tools/bf1942-models/lab/dc_truth.py`
- `<repo>/.claude/worktrees/agent-a143677afe141e2ca/tools/bf1942-models/tests/test_dc_truth.py`
- `<repo>/.claude/worktrees/agent-a143677afe141e2ca/tools/bf1942-models/tests/fixtures/dc_truth_el_alamein.ndjson.gz`
- New scenarios in `<repo>/.claude/worktrees/agent-a143677afe141e2ca/tools/bf1942-models/lab/scenarios/`: `dc-gazala-coop-lod0-rec.json`, `dc-basrahs_edge-coop-lod0-rec.json`
- The probe scripts are in `~/.cache/dc-sweep/dc-lab/`.