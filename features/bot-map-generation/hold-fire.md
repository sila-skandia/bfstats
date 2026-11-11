# Hold-fire for a teammate, and a give-up on a unit out of reach (2026-11-11)

Two bot behaviours measured by the generated-layer work made matches with
bots worse than they need to be: bots shooting through their own side
([page-matches.md](page-matches.md) sections 3, 5 and 6), and bots queueing
all match for a seat they can never reach
([seat-behaviour.md](seat-behaviour.md) 2.4). Both are fixed here with an
INVENTION each, labelled in the code. The engine has neither rule: a retail
bot fires through a friend in its line (ledger FF-7), and a failed path
rebuilds the same Change plan with no give-up (AI-140). The owner's decision
is that playability wins over parity for both.

Code: `viewer/friendly-fire.js` (`HOLD_FIRE`, `friendInLine`),
`viewer/bot-plans.js` (`holdFireFor`, `holdFireStep`, in `execTrigger`),
`viewer/bot-mount.js` (`UNIT_VETO`, `chaseUnit`, `unitVetoed`, in
`execEnterVehicle` and `urgencyChange`), the switch in `bot-referee.js`,
`map.html`, `sim/match.mjs` and `sim/run.mjs`. Tests:
`tests/test_bot_hold_fire.py` (`bot_hold_fire_harness.mjs`). Knobs:
[KNOBS.md](../bf1942-ai-spec/KNOBS.md) (fire, change). The friendly-fire
decision it supersedes: [bot friendly fire](../bot-friendly-fire/README.md),
"Decisions to know about".

## 1. What was measured before

* **The page, The_Maze (generator version 5), 8 a side, ten minutes**:
  0.15 team kills a bot-minute, the Axis side 20 of the 24 and half its
  deaths not caused by the enemy. 23 of the 24 victims stood within a metre
  of the line from the shooter to its target; all 24 rounds were hand
  weapons (Sg44, Mp40, Thompson, the pistols, two No4 snipers). Most victims
  stood 1 to 10 m from the muzzle, five 46 to 64 m down the line, and one
  0.27 m from it.
* **The page, Berlin and Stalingrad**: 0.056 and 0.019 team kills a
  bot-minute; of their 11 team kills, 6 were hand grenades (thrown, off the
  line by 1.2 to 17 m) and a Panzerschreck, the rest submachine guns and a
  rifle with the victim 0.2 to 0.6 m off the line.
* **The runner**, the garrison, DICE's four levels on foot, 10 seeds, 600 s:
  244 team kills at 8 a side and 887 at 16 (0.048 and 0.089 a bot-minute,
  medians); The_Maze 349 in its 20 matches. The runner flies no grenades,
  so these are all direct rounds: rifles, snipers, the BAR, the Mp40.
* **Mauerfall** (BF1918), with its vehicles: Change a fifth to a third of
  every bot's alive time (0.20 at 8 a side, 0.31 at 16), the worst bot
  0.70; no capture in any of its 20 matches. The unit most wanted, by
  bot-seconds of Change on foot, is the Maxima on the tower (22,175 bot-s at
  16 a side, 167 bots), then the Werfer16 and the Hotchkiss MGs.

## 2. The hold-fire

**Rule.** A bot does not let its trigger down while a living teammate's
body lies in the line from its muzzle to the target's aim point, nearer than
the target. It keeps aiming and fires the tick the line clears. On foot,
after holding for 1.0 s it strafes away from the friend for 0.75 s, then
looks again.

| Knob | Value | Why |
|---|---|---|
| body | a vertical axis from the feet + 0.1 m to the stance's top: 1.8 standing, 1.25 crouched, 0.5 prone, 1.2 over a seat | a prone friend under the line is not in it |
| tube radius | 0.6 m at the muzzle | the referee's stand-in body radius (`BOT_BODY_RADIUS`), where the runner's round meets a body; wider than a drawn body's shoulders. 23 of 24 page victims stood within 1 m |
| widening | + the bot's own deviation cone at the friend's distance (`aimDeviation / 100` rad a metre), at most 2 m in all | with a fixed tube a quarter of the runner's remaining Maze team kills were past 43 m: rifles whose cone put the round on a friend a metre off the line. The cap keeps a wild MG from being silenced by every friend ahead |
| reach | 100 m | the page logged victims 46 to 64 m down the line; past 100 m the round has usually met the target or the ground |
| clear of the target | 1.0 m | a friend at the target's own spot does not silence the bot |
| behind the muzzle | 0.3 m | a body overlapping the muzzle counts (page victims 0.2 m off it) |
| step aside | after 1.0 s, a strafe of 0.75 s away from the friend's side; the other side when the cell 1 m off is not walkable; neither, stay | a file of bots in a corridor would otherwise all stand silent behind the first one. The strafe is the soldier's own input, so it is no teleport, and the aim goes on |

Checked cheaply: the teammates only (a box cut first), no terrain ray. A
friend behind a wall the round could not pass still holds the round; that
costs a moment's fire, never a friend.

**What holds and what does not.**

* Held: every hand weapon fired along a line (rifles, submachine guns,
  pistols, the BAR, the rocket launchers, whose rocket meets the friend in
  front as surely as a bullet), a seat's guns (the turret-aim branch of
  `execTrigger`, the machine guns), and a tank's main gun and coax (the
  approach branch: the engine's tank plan has no line test of its own,
  AI-125; the hold is added after `approach.holds`, so the parity part is
  unchanged and the INVENTION is one more condition on top).
* Not held: aircraft (the line runs down at the ground from far above and
  the bombs are not aimed down it), the medic's heal (a friend is the
  target), indirect weapons (every hand grenade is `indirect 1` in the
  kits' AI data) and thrown ones (a `fireDelay` FireArms). **A blast near
  friends is unchanged**, neither better nor worse: the page's grenades are
  about half its team kills on DICE's levels and are the next question.
* The round itself is untouched (FF-1): a friend who steps into a round
  already in flight is still hit.

**Doctrine.** It is a default under every doctrine. It is off with
`?holdfire=0` on the page and `--hold-fire off` in the runner, and off by
default in a runner match with the SAI on both sides, which is the
engine-parity configuration whose seeded traces name no doctrine
(`sim/match.mjs` `baseline`; `--hold-fire on` turns it on there). The
runner's `summary.json` says whether it was on, how many bot-ticks a round
was held and how many steps aside were taken (`holdFire`).

## 3. The give-up on a unit out of reach

**Rule.** While its Change plan runs and the seat is still out of the Use
key's 12.375 m (AI-138), a bot keeps the nearest it has come to the seat (3D,
from its origin, as the Use key measures). When 20 s pass without gaining
1 m, or its route has failed 3 times in a row, that unit's hull is vetoed
for that bot for 180 s: no seat of it is scored, on foot or from another
seat, the plan is dropped and the bot goes back to its order. A gap of more
than 5 s in the chase (another behaviour won meanwhile) starts the clock
again.

| Knob | Value | Why |
|---|---|---|
| patience | 20 s | a soldier runs about 5 m/s, so a walk to anything within the 50 m search radius gains a metre every second or so; 20 s with nothing gained is standing, or circling |
| progress | 1 m | below the walk's own wobble round a corner |
| route failures | 3 in a row | the route's own retry widens its box three times before it is a real failure |
| veto | 180 s, the hull | a bot under an unreachable gun spends at most a ninth of its time on it; a gun whose way opens is tried again within the round |

Height is not the test: DICE's Berlin has an MG42 11.4 m up that bots
reach, and a walk that gains on it is never vetoed. The test is progress.
This is not the engine's rule: AI-140 reads the engine rebuilding the same
plan with no give-up, and nothing in `BBChange` or `BBPChange` remembers a
unit a bot failed to reach. So it is an INVENTION.

## 4. The runner, before and after

The garrison, 10 seeds, 600 s, 8 and 16 a side; before is this branch's
base (`2c6aef45f`), after is this branch. The bars are scratch files, not
`sim/baselines/`.

### DICE's four levels on foot

| Figure, median of 40 matches | 8 a side before | after | 16 a side before | after |
|---|---|---|---|---|
| team kills a bot-minute | 0.048 | **0.021** | 0.089 | **0.035** |
| team kills, all matches | 244 | **108** | 887 | **352** |
| enemy kills a bot-minute | 0.881 | 0.874 | 0.853 | 0.965 |
| captures a match | 2 | 3 | 2 | 2 |
| stuck seconds a bot-minute | 1.38 | 1.29 | 0.79 | 1.01 |
| route failures a bot-minute | 0.035 | 0.039 | 0.083 | 0.073 |
| redeploys a bot-minute | 0.125 | 0.127 | 0.112 | 0.097 |
| deaths no enemy caused, worse side | 0.19 | 0.17 | 0.23 | 0.14 |

Kills do not fall because bots hold fire: enemy kills are within a percent
at 8 a side and 13 % higher at 16, where fewer bots die to their own side
and stay in the fight. Holding is rare: Berlin at 16 a side held a round on
13,800 bot-ticks over ten matches of 576,000 bot-ticks each, one in about
four hundred.

### DICE's four levels with vehicles

| Figure, median of 40 matches (p90) | 8 a side before | after | 16 a side before | after |
|---|---|---|---|---|
| team kills a bot-minute | 0.013 (0.034) | **0.007** (0.034) | 0.045 (0.087) | **0.024** (0.061) |
| team kills, all matches | 86 | **67** | 586 | **358** |
| enemy kills a bot-minute | 0.315 | 0.365 | 0.458 | 0.463 |
| captures a match | 2.5 | 2 | 2 | 2 |
| stuck seconds a bot-minute | 0.34 (1.20) | 0.36 (1.62) | 0.63 (2.85) | 0.66 (2.32) |
| route failures a bot-minute | 0.115 (0.50) | 0.067 (0.67) | 0.195 (1.62) | 0.162 (2.43) |
| redeploys a bot-minute | 0.033 | 0.039 | 0.039 | 0.053 |
| a tank silent | 0.095 | 0.063 | 0.037 | 0.034 |
| Change, worse side (Berlin) | 0.152 | 0.132 | 0.247 | 0.168 |

The p90 of route failures is worse with vehicles, all of it on Berlin, and
there in a few matches where one driven hull fails its route hundreds of
times in one place (one seed: 320 failures, one hull). The give-up alone
does not raise them: Berlin at 16 a side with the hold-fire off and the
give-up on had 462 seated and 4,118 on-foot route failures over ten seeds,
against 496 and 4,244 before; with both on, 1,621 and 4,950. The seated
figure is five seeds of the ten with 250 to 416 against two of ten before,
with the driving code (`bot-vehicle.js`, another piece of work) the place
they happen. Not attributed further: see section 6. The redeploy rise is
0.006 to 0.014 a bot-minute.

### The_Maze (published kits and layer), on foot

| Figure, median of 10 | 8 a side before | after | 16 a side before | after |
|---|---|---|---|---|
| team kills a bot-minute | 0.046 | **0.015** | 0.091 | **0.042** |
| team kills, all ten | 73 | **26** | 276 | **100** |
| enemy kills a bot-minute | 0.927 | 0.931 | 0.889 | 0.925 |
| captures | 10 | 10.5 | 8 | 8.5 |
| stuck seconds a bot-minute | 0.28 | 0.21 | 0.41 | 0.45 |
| route failures a bot-minute | 0.45 | 0.38 | 1.49 | 1.80 |
| redeploys a bot-minute | 0.088 | 0.083 | 0.125 | 0.122 |
| verdict | pass | pass | fails route failures | fails route failures |

The two intermediate versions, on the same 20 matches: a fixed 0.6 m tube
with a 40 m reach left 189 team kills, the same with a 100 m reach 211
(noise: the far ones were outside the tube, not past the reach); widening
the tube with the cone took it to 126.

### Mauerfall (BF1918), with vehicles

| Figure, median of 10 | 8 a side before | after | 16 a side before | after |
|---|---|---|---|---|
| Change, share of all alive time | 0.203 | **0.136** | 0.312 | 0.300 |
| Change, worse side | 0.237 | **0.181** | 0.407 | 0.391 |
| Change, the worst bot | 0.70 | **0.37** | 0.70 | 0.74 |
| Change on foot wanting a Maxima (bot-seconds, ten matches) | 1,585 | 1,357 | 22,175 | **5,251** |
| Change on foot wanting the Ger77er field gun | 6,119 | **1,920** | 3,528 | 2,300 |
| enemy kills a bot-minute | 0.095 | **0.186** | 0.202 | 0.236 |
| enemy kills, all ten | 199 | 289 | 598 | 770 |
| matches with a capture | 2 of 10 | 1 of 10 | 4 of 10 | 5 of 10 |
| route failures a bot-minute | 2.04 | 1.10 | 2.28 | 3.23 |
| team kills, all ten | 13 | 7 | 95 | 56 |
| vetoes, all ten | - | 363 | - | 772 |

The give-up does what it is for: the units nobody reaches stop holding
bots (the tower's Maxima, a quarter of its old time at 16 a side; the
Ger77er a third at 8), the worst bot at 8 a side spends half as long in
Change, and enemy kills nearly double at 8 a side. **It is still not a
fight by the verdict**: `no-fight` before and after, no capture in most
seeds, the enemy-kill check passing at 8 a side only. At 16 a side the
Change share hardly moves, because the time moves to the Stationary
Hotchkiss MGs (8,019 bot-seconds to 17,033) and the Stokes mortars. That is
another cycle, not reachability: a bot walks to a Hotchkiss, is seated, and
under the garrison gets out again two seconds later with no enemy in its
traverse (bot-mount.js, the `engaged` bail), walks toward its order for a
few seconds, and wants a Hotchkiss again (seed 3, `bot_30`, seated at 108 s,
out at 110 s, in Change again at 115 s; six such approaches in two
minutes). Left: it is the garrison's
seat rule, not this work's, and the route failures at 16 a side (2.28 to
3.23) belong to the same walking back and forth.

## 5. The page, before and after

`sim/pagematch.mjs`, 8 a side, ten minutes a match, the local player on the
deploy screen. Before is the live page (play.bfstats.io); after is this
branch's viewer served locally (`serve_viewer.py`), its level files the
published ones (The_Maze's `scene.json` and `_shared/loadouts.json` copied
from mesh.bfstats.io into a local tree, since the server's cache held an
older layer and an older `maps.json`; a first attempt without them played
the wrong level and is discarded). The page is unseeded: each row is one
match.

| Level, match | team kills a bot-minute (count, of them grenades) | enemy kills a bot-minute | captures | deaths no enemy caused, worse side | page errors |
|---|---|---|---|---|---|
| Berlin, before 1 | 0.056 (9, 4) | 0.40 | 2 | 0.28 | 0 |
| Berlin, before 2 | 0.063 (10, 5) | 0.49 | 5 | 0.23 | 0 |
| Berlin, after 1 | **0.031** (5, 2) | 0.40 | 0 | 0.20 | 0 |
| Berlin, after 2 | **0.006** (1, 0) | 0.49 | 0 | 0.08 | 0 |
| Stalingrad, before 1 | 0.019 (3, 1) | 0.34 | 1 | 0.15 | 0 |
| Stalingrad, before 2 | 0 | 0.25 | 0 | 0.26 | 0 |
| Stalingrad, after 1 | 0.019 (3, 1) | 0.30 | 1 | 0.17 | 0 |
| Stalingrad, after 2 | 0.006 (1, 0) | 0.38 | 0 | 0.07 | 0 |
| The_Maze, before | 0.150 (24, 0) | 0.31 | 23 | **0.50** | 0 |
| The_Maze, after 1 | **0.038** (6, 0) | 0.32 | 9 | 0.11 | 0 |
| The_Maze, after 2 | **0.013** (2, 0) | 0.27 | 18 | 0.14 | 0 |

Means: Berlin 0.059 to 0.019 team kills a bot-minute, Stalingrad 0.009 to
0.012 (3 against 4 team kills, one a grenade: no change measurable at this
rate), The_Maze 0.150 to 0.025, a sixth. Enemy kills: Berlin 0.44 and
0.45, Stalingrad 0.30 and 0.34, The_Maze 0.31 and 0.29. On The_Maze the
Axis side no longer loses half its deaths to its own side. An earlier
version (a fixed 0.6 m tube, 40 m reach) played The_Maze once and Berlin and
Stalingrad once each: 0.038, 0.006 and 0.006, enemy kills 0.32, 0.41 and
0.44.

What is left on DICE's levels is half explosives (3 of the 6 team kills in
the two Berlin after-matches were two hand grenades and a Bazooka rocket;
the grenades the hold-fire leaves alone, the rocket's friend stood 0.36 m
off a line the rocket took a moment to fly). The direct rounds left are friends who
walk into the line inside the page's 5 Hz sampling, or rounds already in
flight (a K98 and a BAR on The_Maze, 0.07 to 0.11 m off the line at 53 and
68 m).

## 6. What is not verified

1. **Page samples.** Two matches a level after, one or two before, all
   unseeded, and the before matches ran on the live page, whose other code
   may differ from this branch's base. The Maze's fall (24 team kills to 6
   and 2) is far outside a match's spread; Berlin's (19 to 6 over two
   matches each) is likely real; Stalingrad's rate is too low to show a
   change.
2. **Route failures with vehicles** (section 4): the p90 rose, on Berlin,
   in driven hulls failing in one place. The give-up is ruled out by an
   ablation; whether the hold-fire changes where tanks end up, or the
   difference is the spread of ten seeds, was not settled.
3. **Mauerfall is still not a fight** by the verdict. The cycle that is
   left (a fixed gun mounted and left at once under the garrison, then
   wanted again) is a seat rule of the garrison's, not reachability, and is
   not changed here. Nor is the generated walk map that leaves the tower's
   gun out of reach ([seat-behaviour.md](seat-behaviour.md) 2.4).
4. **The step aside** is checked in the harness (its direction and timing)
   and counted in the runner (`summary.json` `holdFire.steps`), not watched
   on the page.
5. **Grenades and blasts near friends** are unchanged by design: the next
   question for the page's team kills on DICE's levels.
6. **The hold-fire against retail**: the engine has none (FF-7), so this is
   a departure in every doctrine but the runner's SAI-on-both-sides traces;
   no lab round was played to see how often retail's bots kill each other.
7. **The give-up's 180 s** was chosen, not tuned: a gun whose way up opens
   (a hull moved off a door) waits up to three minutes to be wanted again.
8. The rebuilt bars here are scratch files; `sim/baselines/` is not
   touched.
