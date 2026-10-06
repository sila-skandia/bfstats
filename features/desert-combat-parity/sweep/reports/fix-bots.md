All four brief items and your add-ons are built and committed, and so are your two latest corrections. The branch is `worktree-agent-a28699fc8f9384781` in `<repo>/.claude/worktrees/agent-a28699fc8f9384781`, rebased on main a8bbe93e: 17 commits, not pushed or merged. The full suite passes (4,911 tests, 10 skipped).

## What was wrong and what changed (oldest first)

1. **AI records.** Records were keyed by folder, so hulls whose `aiTemplate` lives elsewhere had no bot AI. Each hull now reaches its own `ObjectTemplate.aiTemplate` (AI-137); vanilla and the XPacks are unchanged. The re-extract commands for the five `vehicle-ai.json` files are in README section 1. They now also carry `exitVelocity` and `useAimerOnly`.
2. **Frozen in Change.** The engine's foot plan replaces my door walk: no walk inside 12.5 m, Use within 12.375 m, seated within 15 m of the seat, and fixed guns approached from behind (AI-138..141). There is no give-up timer, because the engine has none.
3. **Basrah's Edge nav.** The decoder is right. The tank map is DC's own authoring, so this is a documentation commit only.
4. **Door-less artillery driver seats.** The seat swap now reaches them, as the engine's teleport change does.
5. **CW12 / CW9.** Bots lead with the AI weapon's own `exitVelocity`, and `useAimerOnly` fires on the aimer's solution (AI-143). `timeToGetControl 0` now takes a point on the first frame (AI-142).
6. **Shotguns.** Every barrel fires its own pellet through `cameraLaunch`.
7. **Heat stop.** In the engine this is a hold inside the plan, not a break. The trigger lets go at heat 0.8, keeps aiming, and fires again at 0.5 (AI-144). The latch belongs to the plan, so a new plan can fire anywhere under 0.8. Your "resume at 0.5" is right within a plan. The lab bursts agree: resumes peak at heat 0.48–0.50 and the rest spread over 0.56–0.78.
   - Seat MGs read the world's heat state; hand MGs get their own per item.
   - The live DC M249 and PKM glbs already carry heat words, so nothing needs re-extracting for this.
   - The test you asked for passes: a stationary MG42 burst ends at 30 rounds (Browning 30, coax 20). Live on vanilla Battleaxe, 263 MG42 bursts topped out at 30–31 rounds and none ended above heat 0.827.
8. **Whole ticks.** The heat work exposed this: bots fired hand weapons at the exact `roundOfFire`, carrying the remainder between rounds. They now fire on whole ticks like the human (GUN-13): the M249 at 10 a second, the Mp40 at 7.5.
9. **Fixed guns, second freeze.** A bot coming at a fixed gun from the front stood on the gun's own spot and never got behind it. On vanilla Bocage two bots waited at an AA gun for 170 s. The walk now aims a soldier's radius past the gun's box; this is a labelled invention.
10. **Bot deviation point (your correction 1).** Read the seed path. The draw depends only on the input index plus the barrel, over a fixed table in the binary.
    - A bot's queued action carries an index nothing ever writes, so it never changes.
    - The lab recordings show one point. All 3,394 bot MG rounds, vanilla and DC, lie along one direction of the square, and the smallest deviations match index 617 for three guns with different floors. Of the 1,024 indices, only 617 fits both (AI-145).
    - The stack value itself was not traced to its writer; the recordings settled it.
    - `rollCone` is gone. Bots now call `round-launch.js deviate` with that point, in the cone's own unit; the old code multiplied it into degrees. Shotgun barrel *i* takes point *i*.
11. **Aimer drag (your correction 2).** The engine gives the aimer the round's `pi r^2 drag / mass` (AI-146). Bots now pass it. Rounds without a `drag` word, which is every vanilla bullet and shell, are unchanged.

## Proof matches (final branch vs main's viewer, seed 1, 6 a side, 300 s)

| level | frozen | route failures | mounts | kills | captures |
|---|---|---|---|---|---|
| DC Basrah's Edge | 4 -> 0 | 51,793 -> 17,253 | 9 -> 15 | 0 -> 0 | 1 -> 0 |
| DC Desert Shield | 3 -> 1 | 10,742 -> 13,272 | 18 -> 23 | 0 -> 2 | 1 -> 1 |
| DC Kharkov Day 2 | 5 -> 3 | 180 -> 1 | 9 -> 10 | 0 -> 0 | 3 -> 2 |
| DC Battleaxe | 3 -> 0 | 201 -> 3 | 10 -> 15 | 1 -> 4 | 0 -> 0 |
| vanilla Battleaxe | 3 -> 0 | 199 -> 5 | 12 -> 18 | 1 -> 0 | 0 -> 0 |
| vanilla Kharkov | 3 -> 0 | 4 -> 0 | 9 -> 27 | 0 -> 5 | 3 -> 4 |
| vanilla El Alamein | 0 -> 0 | 0 -> 0 | 15 -> 50 | 0 -> 5 | 3 -> 3 |
| vanilla Bocage | 0 -> 0 | 7 -> 0 | 34 -> 40 | 6 -> 3 | 3 -> 3 |

Vanilla controls used your fixed loadouts.

**Four-seed check.** El Alamein does not regress: captures 3.0 -> 3.2. Bocage captures less than main over four seeds (3.8 -> 2.8), with kills 8.5 -> 4.5. Its bots now spend 3,200 of 3,600 bot-seconds mounted, against 2,700 on main, much of it in AA guns and Flak 38s that main's bots never reached. How long a retail bot stays in one was not measured.

## Shared files touched (small hunks)
- `map.html` (`botWeaponData`): barrels and heat words.
- `sim/level.mjs` and `sim/env.mjs`: the same, for the runner.
- `round-launch.js`: the one-word `export` on `deviate`.
- Rebase conflicts were in `bot-pilot.js groupBallistics` (kept main's gravity law plus my `exitVelocity`) and `bot_ai_harness.mjs`.

## Open items
- **Wedged bots:** three on Kharkov Day 2 and one on Desert Shield still stand in Change, pushed into geometry the map calls free. This was there on main too.
- **Basrah's Edge:** two drivers re-route every tick toward order points with no strategic path (8,934 and 8,090 failures).
- **Empty magazine:** the engine holds the fire plan, presses reload and keeps aiming; mine still ends the plan.
- **Planes:** the attack plan's own heat limits are named but nothing applies them.
- **Ticks with no queued action:** the index for those (618) is not modelled. It may explain the few percent of recorded rounds below the floor.
- **Vehicle guns** get no deviation in the viewer at all; that belongs to another package.
- **Vanilla's published `vehicle-ai.json`** predates the Pak40. Re-extracting it is in the section 1 commands.

## Parity rows for `features/desert-combat-parity/README.md`
Not edited, per the brief. The rows for levels 28/29, ground G6 and air 25 can go to fixed, except the residual wedged bots and Basrah's strategic order points, which stay open.

Ledger rows AI-137..AI-146 are claimed in `~/.cache/dc-sweep/LEDGER_IDS.md`. Details and evidence are in `features/bot-desert-combat/README.md` sections 1–11 and `features/bf1942-engine-reference/ledger.md`. Scratch scripts are in `~/.cache/dc-sweep/bots/` (137 MB; the large snapshots are pruned).