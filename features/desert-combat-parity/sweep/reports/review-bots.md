**Verdict: LAND WITH FIXES.** I merged current main into the branch, then added three code fixes and three doc commits:

- `069ee304` merge of main (3cc3ff27). It merged with no conflicts and the full suite passed: 5,028 tests, 10 skipped.
- `7155989d` fix: bots on foot get their own deviation index.
- `388264ce` fix: a fixed gun's crew can bail from a blocked cell (new ledger row AI-147).
- `89e42290` fix: a glb with one muzzle counts as a gun with no barrels.
- `e95a3fbb`, `7bba0873`, `a58953d6`: docs.

Final suite: 5,032 tests, 1 failure. The failure is `test_carried_spawn_flags`, which reads the shared live `viewer/maps` tree. Main's own code fails it identically against that tree, so it is not from this package.

One thing stays open: Bocage. With my fixes, Bocage recovers part of the way but still trails main (captures 2.8 vs 3.2, kills 5.2 vs 8.8). Bots still sit in fixed guns far longer than retail bots do. That part is the viewer's existing scoring for seated gunners, not a law this package added. It needs its own package (first gap below).

## Findings

| Finding | Evidence | Severity | Fixed here? |
|---|---|---|---|
| **AI-145 is wrong for bots on foot**, which is the only place the viewer applied it. | I fitted the recorded shotgun pulls myself (Saiga12k and Remington, 8 barrels each, 22 pulls, 10 bot lives). Each life fits one index of its own: 76, 132, 180, 468, 476, 532, 540, 708, 772, 876. All are multiples of 4, which looks like the low bits of a memory address. The next-best index fits 10 to 2,500 times worse, and 617/618 at least 25 times worse. Still bots' rifle rounds keep one direction for a whole life, even across a weapon change. For seated MGs, 617 holds: 218 of 236 bot-and-gun groups are within 12° of it. | High | Yes, `7155989d`. The table is now built from the binary's own generator (`random_seeds` turns out to be the C runtime's `rand()` from seed 1). Each bot on foot gets a multiple of 4 per life; seated bots use 618. A test fits three recorded pulls. |
| **Barrel convention off by one.** A gun with no `addFireArmsPosition` calls `fireBarrel(-1)` (BOMB-2, call at 0x0828a750), so it draws at index − 1. The exporter gives such guns one muzzle, so a muzzle count alone can't be trusted. | Disassembly of `Fire`; `assemble.py _fire_arms` | Medium | Yes, `7155989d` and `89e42290` |
| **Bocage gun camping, root cause.** Retail bots, recorded myself on vanilla Bocage at AI LOD 0 (15 a side, 2 rounds): 3.9–7.3 % of living time in AA guns and Flak 38s, 8 of 15 stays end on foot (median 46 s), the Stationary MG42 is never used. Runner, 6 a side, 4 seeds: main 22.6 %, branch 41.9 %. | Bots enter guns about as often on both builds (7.8 vs 8.5 mounts per match). The difference is how long they stay. Main's exits were mostly churn: 9 of its 13 finished stays were 10 s or less. In a gun, the bot's urge to change seat is 0. | High | Partly, `388264ce`. The viewer refused every bail from a blocked map cell. In the binary, `isBailAllowed` 0x0855fd70 exempts guns flagged `setUseNoPathfindingToGetToObject` (the check at 0x0855ff88). With the fix the fixed-gun share is 36.8 %, captures 2.8, kills 5.2. |
| **Neither the heat hold nor the fixed-gun approach invention causes the camping.** | With the heat hold switched off, seed 1 is identical to the branch. With the trace starting from the gun's own spot (the engine's rule), captures are 2,3,2,3 on seeds 1–4, the same as the branch. | Info | n/a |
| **The invention's stated reason was wrong.** The bots on Bocage walk the level's own baked infantry map, which blocks 5 of the 7 AA gun spots. Retail's trace answers the gun's own spot at the 2 free (flag) spots too. The invention stands in for the soldier's collision with the gun body; no engine read replaces it. It is clearly marked INVENTION. | Sampled `Infantry1Level0Map.raw`; all 34 soldier spawns are free in it, so the map orientation is right. | Low | Comment and README corrected |
| **Foot-plan rows AI-138..141 check out.** Constants verified in the binary: 12.5 m (156.25), 6.25, 5.0, 12.375, the `ObjectBehind` −0.8 test (the "at most" direction confirmed), the point 12 m behind, and the 15 m seat radius. | Disassembly | — | — |
| **AI-137, 142, 144, 146 spot-checks pass.** | The +0x40 template lookup; the timer-at-or-below-0 branch; the heat latch comparisons; drag computed as π·r²·drag / mass. | — | — |
| **The seat index 617 is the best fit, not the only one.** Index 508 is also within the measurement. | The minimum-deviation test (vanilla 5th percentiles against minDev + 0.3125): 508 comes out only 3 % under 617. | Low | Ledger caveat added |
| **Vanilla controls, 4 seeds each.** | El Alamein captures 3.0 → 3.0, kills 0.2 → 4.0. Kharkov captures 2.8 → 3.8, kills 0 → 4.5. Battleaxe captures 0.25 → 0, kills 0.75 → 0.5 (both near zero). Frozen bots go to 0 everywhere. DC Basrah's Edge, seed 1: frozen 6 → 0, route failures 36,078 → 17,253 (exactly the agent's number). | — | — |
| **Rooms.** The room server runs no bots, so there is no authority law to match. The page and the runner share `bot-referee.js`, so they use the same law. Nothing in replay or netcode imports the changed modules. | grep of `server/*.mjs` and the viewer | Info | — |
| **Other mods.** The extractor runs cleanly on FH, FHSW, EoD, bf1918, GCMOD, Pirates, Interstate and DC Final. It only adds records; for example FH gains mines and shell "vehicles" that are PlayerControlObjects in FH's own data. | Scratch extracts compared against main's extractor | Low | — |
| **AI-143 missed XPack2's Wasserfall** (`exitVelocity 500`, `useAimerOnly`). | Branch extract compared with the live XPack2 tree | Low | Ledger updated |
| **Stale docs.** `rocket-flight` README still described `rollCone`; `bot.js` called `aimDeviation` degrees; AI-44 and AI-46 said the bail rule was unread. | — | Low | Yes |

## New gaps

- **Seated gunners never leave on their own** (new package). The open reads are AI-59's strategic-direction rule (an INVENTION), the spotted-list veto inside `isBailAllowed` (AI-147), and the unread immobile-unit check (vt+0x6c in AI-147). Retail ground truth is in `~/bf1942-lab/runs/20261007-060803-review-bots-bocage-coop-lod0-rec`.
- **Bocage Stationary MG42.** Retail bots never used the one MG42 in two rounds; the viewer's bots spend about 25 % of their fixed-gun time in two MG42 spots.
- **Vehicle-deviation package (in flight elsewhere).** Seated bots should draw at index 618 through `deviationIndex`. Measure before building: jet guns (one barrel, no turn) sit at about 40° (A-10, MiG-29) and about −90° (F-16, F-14) in the plane's own frame, which fits no single index.
- **Who writes the stack slot behind both indices** is still untraced.

My lab run's copy also sits in the main checkout at `viewer/replays/20261007-060803-review-bots-bocage-coop-lod0-rec/`, a duplicate of the run directory, kept so it can be replayed. The asset commands are unchanged from the agent's report: re-extract the five `vehicle-ai.json` files. That also picks up XPack2's Wasserfall. My scripts are in `~/.cache/dc-sweep/review-bots/`.