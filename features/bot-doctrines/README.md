# Bot doctrines: the strategic interface and the first play

Brief J of [the agent briefs](../bf1942-ai-research-2026-09-21/AGENT_BRIEFS.md)
(2026-09-23/24). The engine's strategic AI (the SAI,
`viewer/strategic-ai.js`) was the only source of bot orders. It now sits
behind an interface, so another doctrine ("play") can order a side instead
and the headless runner can compare the two, with the engine's SAI as the
baseline.

| file | what |
|---|---|
| `viewer/doctrine.js` | the interface: `StrategicCommand`, the doctrine and order-kind registries, the 'sai' doctrine, the `WPCloseTo`-law orders (`WPFollow`, `WPHold`) and the play's `WPBoard` / `WPLeave` |
| `viewer/doctrine-squad.js` | the first play, 'squad' |
| `viewer/strategic.js` | re-exports both; importing it registers the play |
| `viewer/strategic-ai.js` | `update` split into `beginPass` (both sides) and `sidePass` (one side); nothing else changed |
| `viewer/bot-referee.js` | holds a `StrategicCommand` built over the SAI; `env.doctrine` picks the doctrines (the page passes none: the SAI) |
| `sim/run.mjs --doctrine`, `sim/compare.mjs` | the runner option and the comparison script (sim/README.md) |
| `tests/test_doctrine.py`, `tests/doctrine_harness.mjs` | the pins; `tests/test_sim_match.py SimDoctrineTests` the runner |

## The interface

The referee asks `StrategicCommand.waypointsOf(id)` for every bot's order
each tick and nothing else writes `bot.waypoints`. The command's `update(dt,
alive)` keeps the SAI's clock and, every `SAI.updateFrequency` (2 s), runs a
pass:

1. `sai.beginPass(alive)`: the flags bound to the areas, and every area's
   presence, owner, status and temperatures, counted with every alive bot of
   both sides.
2. For side 1, then side 2: `doctrine.orders(view)`, and each order it
   returns is checked (`checkOrder`) and stored.

Between passes it runs the per-tick executor of every held order whose kind
has one.

A **doctrine** is built once per side by `factory({ side, sai, layer,
random, command })` and answers `orders(view)` with a `Map` of bot id to
order (or null). An id it leaves out keeps its order; returning the same
object keeps the bot's arrival state. Optional: `botDied(id)`,
`unitChanged(id)`, `stats()`. The `view` (all fields lazy): `side`, `time`,
`roster`, `alive` (both sides), `bots` (the side's alive bots with
`position`, `health`, `unit`, `seat`, `order`), `areas` (owner, status,
presence), `flags`, `enemy` (the side's `EnemyStrengthTables`), `vehicles`
(the seat candidates), `sai`, `layer`, `isWalkable`, `command`.

The **'sai' doctrine** is `sai.sidePass(side, view.alive)` and the SAI's own
orders back: exactly what `StrategicAI.update` did, in the same order.
Checked byte for byte on seeded runner traces before and after the interface
(the commit that added it, on the main of the day):

| run | trace sha256 before and after |
|---|---|
| synthetic, 4 a side, 120 s, seed 1 | `764b9517...` |
| El Alamein, 8 a side, 300 s, seed 3, every 3rd tick | `81e1f2ef...` |
| Bocage, 8 a side, 200 s, seed 2, every 3rd tick | `a11dc3fc...` |

and again after the runner's `--doctrine` option went in. A baseline run's
trace names no doctrine; `tests/test_doctrine.py` also pins the command
against the bare SAI over 60 s of moving bots with deaths and a unit change.

### Adding an order kind

Brief D's `WPBeachLanding` is the next one. An order is the object a bot's
`waypoints` holds, and every kind meets the contract the bots read
(`doctrine.js` header): `kind`, `point [x, z]`, `radius`, `y` for an air
order only, `area` with `inside(x, z)` (or no area), `urgency(x, z,
pathRadius, y)` which also sets `arrived`. A bot re-plans its move when the
order is a different object, so a goal that moves is a new object.

1. Build it where it is decided: in `strategic-ai.js` next to `_order` /
   `_orderAir` when the SAI issues it (the 'sai' doctrine passes it on
   untouched), or in the doctrine that invents it.
2. `registerOrderKind('<Kind>', { tick })` in the same module. `tick(order,
   { id, position, command, candidates(), actuators })` runs every tick for
   every alive bot holding one; returning an object replaces the order.
   `actuators.enter(id, candId)` presses Use at a seat, `actuators.exit(id)`
   leaves the hull (the referee seats or unseats him on its vehicle tick). A
   landing craft's passengers bailing at the beach is an `exit` from a tick.
3. Return it from `orders`. An unregistered kind or a broken contract
   throws in `checkOrder`.

What the bots' behaviours cannot express through point, radius, urgency and
the two actuators needs a behaviour change in `bot*.js`, outside this
interface.

### Adding a doctrine

`registerDoctrine('<name>', ctx => ({ orders(view) { ... } }))` in its own
module, imported from `strategic.js`. It may hand some of its bots to the
SAI (`view.sai.sidePass(view.side, subset)`, then `sai.waypointsOf(id)`),
as the squad play does for its leaders; the areas were already counted with
everyone. Name it on the runner with `--doctrine <name>` (both sides) or
`--doctrine axis=<name>` / `allies=<name>`.

## The engine's follow waypoint (ledger AI-77)

The engine has a waypoint on an object: `WPCloseTo` (and `WPAltitudeCloseTo`).
Read 2026-09-24: R = max(5, radius, 2 x the object's bounding radius);
urgency 0 inside R, else `min(1, d^2 / 4R^2)` in 3D with no floor and no x2;
the goal is the object's centre now, re-stored (and the waypoint flagged
changed) when it has moved more than R; `modifyMaxSpeed` matches the
object's speed close in. Nothing in the retail server builds one (no caller
of either ctor, no other write of the vtable), so no engine bot ever
follows anything. It is still the engine's own law for the job, so the
play's `WPFollow` and `WPHold` are built on it (not the speed match: the
viewer's plans have no speed cap).

## The first play: squad follow (INVENTION)

`doctrine-squad.js`, the constants in `SQUAD` and KNOBS.md's `squad play`
rows:

- **Squads**: the side's bots in registration order, in fours.
- **Leader**: a member at the wheel of a hull; else the leader while he
  lives; else the first alive member. The leaders alone go to the SAI
  (`sidePass` with them only) and hold its order. A bot leaving the SAI's
  hands is released there (`botChangedUnit`), so it does not come back with
  a stale order.
- **Followers**: a `WPFollow` on a slot 8 m behind and 4 m beside the leader
  (the third 12 m behind), in the frame of the leader's heading to his
  order's point, carrying the leader's area; a slot off the infantry map
  falls back to the leader himself.
- **One hull**: the squad's hull is the leader's. A follower on foot within
  60 m of it takes a free seat, the driver's first (`WPBoard`: walk to the
  door, Use inside its radius); aboard, he follows the hull (asks nothing).
  A follower sitting in someone else's parked hull 25 m or more from the
  leader gets out (`WPLeave`); a rider of a driven hull stays.
- **A hull cannot be followed on foot**: while the leader is mounted, a
  follower on foot who is not boarding (no free seat left for him, or more
  than 60 m off) goes to the SAI, and comes back when the leader is on foot
  again or a seat is his; while the leader flies, so does every follower not
  aboard. The first version let them chase the hull, which could only end
  in the page's 12 s no-progress redeploy (bot-decision.js, INVENTION)
  sending them back to the spawn. That was not the main source of the
  Allied redeploys, though: they stayed at 54 a match after this rule went
  in, and the comparison below finds the cause (a follower keeping pace on
  foot).
- **Regroup**: the leader holds where he is (`WPHold`) while a follower on
  foot is 25..100 m off (beyond, a fresh respawn is not waited for), a
  follower at the wheel of his own hull is more than 25 m behind, or one is
  walking to the squad's hull; at most 15 s, then 20 s before the next hold.

The play counts, per side: holds and their seconds, board orders, boardings
(a follower in the squad's hull who was not at the last pass), leave orders,
leader changes, the mean distance of a follower on foot from his leader, the
share of those samples within 25 m, and the share of passes with a squad
hull where a follower rode in it.

## The comparison

Run on main at `b1fe0db9` (2026-09-24), the runner as it is before Brief I:
land vehicles only, kinematic `SimDrive` hulls, hitscan mounted guns. 8 bots
a side, 600 s, **seeds 1, 2, 3, 4, 5, 6, 7, 8, 9, 10**, three configs a
level: `sai` (the engine's SAI on both sides, the baseline), `axis=squad`
and `allies=squad` (the play on one side against the SAI). 60 matches, 10 at
a time, 16 minutes wall clock on a loaded 20-core machine.

```sh
V=/home/dylan/projects/skandia/bfstats/tools/bf1942-models/viewer
node sim/compare.mjs --maps el_alamein,bocage --seeds 1-10 --time 600 --bots 8 \
     --configs "sai axis=squad allies=squad" --jobs 10 \
     --maps-dir $V/maps --models-dir $V/models --out <dir> --markdown <dir>/table.md
```

Every cell is mean ± sd over the ten seeds; "first capture" averages the
runs that had one. The second table under each level pairs each seed of the
play with the same seed and side under the SAI, which takes the level's own
asymmetry out (El Alamein favours the Axis 7 of 10 under the SAI).

#### El Alamein

| metric | sai: Axis (sai) | sai: Allies (sai) | axis=squad: Axis (squad) | axis=squad: Allies (sai) | allies=squad: Axis (sai) | allies=squad: Allies (squad) |
|---|---:|---:|---:|---:|---:|---:|
| runs | 10 | 10 | 10 | 10 | 10 | 10 |
| tickets at the end | 87.4 ± 12.8 | 80.1 ± 13.8 | 72.6 ± 15.2 | 95.3 ± 4.9 | 89.0 ± 17.8 | 79.3 ± 17.5 |
| ticket margin (side - other) | 7.3 ± 20.3 | -7.3 ± 20.3 | -22.7 ± 18.1 | 22.7 ± 18.1 | 9.8 ± 29.8 | -9.8 ± 29.8 |
| ahead at the end | 7 / 10 | 3 / 10 | 2 / 10 | 8 / 10 | 7 / 10 | 3 / 10 |
| control points held (time mean) | 1.85 ± 0.39 | 2.08 ± 0.31 | 1.20 ± 0.26 | 2.56 ± 0.51 | 2.00 ± 0.60 | 2.04 ± 0.38 |
| first capture, s (runs with one) | 174 ± 67 (10/10) | 104 ± 4 (10/10) | 310 ± 141 (7/10) | 100 ± 2 (10/10) | 143 ± 48 (9/10) | 59 ± 1 (10/10) |
| captures | 4.4 ± 7.0 | 4.5 ± 7.3 | 2.1 ± 3.7 | 4.1 ± 3.8 | 1.5 ± 0.8 | 1.4 ± 0.5 |
| deaths | 0.8 ± 1.2 | 10.9 ± 2.2 | 1.8 ± 2.7 | 4.7 ± 4.9 | 1.7 ± 2.1 | 7.5 ± 3.3 |
| kills | 10.9 ± 2.2 | 0.8 ± 1.2 | 4.7 ± 4.9 | 1.8 ± 2.7 | 7.5 ± 3.3 | 1.7 ± 2.1 |
| deaths per capture (pooled) | 0.18 | 2.42 | 0.86 | 1.15 | 1.13 | 5.36 |
| mounted share | 0.85 ± 0.06 | 0.59 ± 0.06 | 0.85 ± 0.10 | 0.49 ± 0.12 | 0.81 ± 0.09 | 0.35 ± 0.15 |
| route failures | 151 ± 268 | 60 ± 119 | 98 ± 87 | 100 ± 115 | 216 ± 283 | 8 ± 19 |
| redeploys | 5.5 ± 1.4 | 4.4 ± 3.2 | 3.8 ± 5.7 | 9.3 ± 4.3 | 4.9 ± 0.9 | 54.0 ± 40.2 |
| bot errors | 0 | 0 | 0 | 0 | 0 | 0 |
| play: holds |  |  | 24.1 ± 5.6 |  |  | 13.7 ± 3.9 |
| play: holdSeconds |  |  | 328 ± 73 |  |  | 156 ± 61 |
| play: boardOrders |  |  | 3.9 ± 3.3 |  |  | 2.3 ± 2.8 |
| play: boardings |  |  | 1.6 ± 1.5 |  |  | 1.5 ± 1.1 |
| play: leaveOrders |  |  | 4.8 ± 14.1 |  |  | 1.2 ± 2.0 |
| play: leaderChanges |  |  | 2.4 ± 1.0 |  |  | 4.5 ± 1.8 |
| play: meanFollowerDistance |  |  | 111.1 ± 124.3 |  |  | 298.9 ± 110.5 |
| play: withinRegroupShare |  |  | 0.22 ± 0.07 |  |  | 0.33 ± 0.10 |
| play: sharedHullShare |  |  | 0.37 ± 0.42 |  |  | 0.34 ± 0.24 |

Against the same side under the SAI, paired by seed (play minus baseline):

| config | side | ticket margin | seeds better | control points held | captures | deaths |
|---|---|---:|---:|---:|---:|---:|
| axis=squad | Axis | -29.9 ± 32.4 | 1 / 10 | -0.65 ± 0.52 | -2.3 ± 7.8 | 1.0 ± 2.4 |
| allies=squad | Allies | -2.5 ± 34.2 | 4 / 10 | -0.04 ± 0.47 | -3.1 ± 7.4 | -3.4 ± 3.2 |

#### Bocage

| metric | sai: Axis (sai) | sai: Allies (sai) | axis=squad: Axis (squad) | axis=squad: Allies (sai) | allies=squad: Axis (sai) | allies=squad: Allies (squad) |
|---|---:|---:|---:|---:|---:|---:|
| runs | 10 | 10 | 10 | 10 | 10 | 10 |
| tickets at the end | 99.5 ± 0.8 | 89.1 ± 15.6 | 99.7 ± 0.9 | 96.5 ± 11.0 | 99.4 ± 0.7 | 88.1 ± 12.7 |
| ticket margin (side - other) | 10.4 ± 16.0 | -10.4 ± 16.0 | 3.2 ± 11.2 | -3.2 ± 11.2 | 11.3 ± 12.7 | -11.3 ± 12.7 |
| ahead at the end | 4 / 10 | 3 / 10 | 1 / 10 | 1 / 10 | 7 / 10 | 0 / 10 |
| control points held (time mean) | 2.15 ± 0.31 | 1.30 ± 0.41 | 1.96 ± 0.22 | 1.81 ± 0.14 | 2.22 ± 0.36 | 1.65 ± 0.25 |
| first capture, s (runs with one) | 36 ± 0 (10/10) | 147 ± 117 (4/10) | 65 ± 4 (10/10) | 111 ± 82 (10/10) | 36 ± 0 (10/10) | 71 ± 7 (10/10) |
| captures | 1.4 ± 0.5 | 0.4 ± 0.5 | 1.1 ± 0.3 | 1.0 ± 0.0 | 3.7 ± 3.4 | 3.3 ± 3.6 |
| deaths | 0.5 ± 0.8 | 0.1 ± 0.3 | 0.3 ± 0.9 | 0.0 ± 0.0 | 0.6 ± 0.7 | 0.5 ± 0.7 |
| kills | 0.1 ± 0.3 | 0.5 ± 0.8 | 0.0 ± 0.0 | 0.3 ± 0.9 | 0.5 ± 0.7 | 0.6 ± 0.7 |
| deaths per capture (pooled) | 0.36 | 0.25 | 0.27 | 0.00 | 0.16 | 0.15 |
| mounted share | 0.71 ± 0.12 | 0.84 ± 0.04 | 0.81 ± 0.08 | 0.84 ± 0.09 | 0.73 ± 0.09 | 0.79 ± 0.10 |
| route failures | 49506 ± 10051 | 32422 ± 14890 | 28110 ± 7002 | 41416 ± 8228 | 43080 ± 10702 | 28296 ± 8086 |
| redeploys | 8.7 ± 9.5 | 10.9 ± 5.8 | 8.1 ± 14.9 | 4.0 ± 5.3 | 5.7 ± 4.9 | 8.2 ± 4.5 |
| bot errors | 0 | 0 | 0 | 0 | 0 | 0 |
| play: holds |  |  | 17.0 ± 2.5 |  |  | 23.3 ± 4.4 |
| play: holdSeconds |  |  | 250 ± 56 |  |  | 319 ± 86 |
| play: boardOrders |  |  | 98.4 ± 125.2 |  |  | 1.0 ± 0.0 |
| play: boardings |  |  | 1.3 ± 0.8 |  |  | 0.0 ± 0.0 |
| play: leaveOrders |  |  | 0.4 ± 1.3 |  |  | 2.4 ± 6.3 |
| play: leaderChanges |  |  | 1.8 ± 0.4 |  |  | 1.0 ± 0.0 |
| play: meanFollowerDistance |  |  | 17.0 ± 9.3 |  |  | 34.8 ± 0.1 |
| play: withinRegroupShare |  |  | 0.77 ± 0.14 |  |  | 0.36 ± 0.00 |
| play: sharedHullShare |  |  | 0.39 ± 0.20 |  |  | 0.00 ± 0.00 |

Against the same side under the SAI, paired by seed (play minus baseline):

| config | side | ticket margin | seeds better | control points held | captures | deaths |
|---|---|---:|---:|---:|---:|---:|
| axis=squad | Axis | -7.2 ± 21.3 | 4 / 10 | -0.19 ± 0.42 | -0.3 ± 0.7 | -0.2 ± 1.4 |
| allies=squad | Allies | -0.9 ± 22.6 | 4 / 10 | 0.35 ± 0.57 | 2.9 ± 3.7 | 0.4 ± 0.8 |

**Reading it.**

- **No bot errors** in 60 matches. The first matrix threw 9 times on El
  Alamein seed 6 (`Invalid array length`). That was a latent bug in
  `nav-search.js findLocalPath` (the search box was sized before a buried
  start or goal was moved out to open paint). The follow orders' many short
  legs found it; it is fixed in `58e61c32` with a pin in the nav harness,
  and the baseline traces did not move.
- **El Alamein: the play loses.** The Axis under the squad play ends 29.9
  tickets worse off than the Axis under the SAI (ahead in 1 seed of 10) and
  holds 0.65 fewer control points on average. It also takes its first
  capture later (310 s in 7 runs, against 174 s in 10). The Allies under
  the play come out level within the noise (-2.5 ± 34.2, 4 of 10). The
  leaders hold for about 330 s a match (Axis) to wait for followers. Two
  thirds of the followers' samples are more than 25 m from their leader
  (`withinRegroupShare` 0.22 / 0.33). On a vehicle level with 30 hulls and
  two-seat stand-ins, a squad of four cannot ride together, so the play
  mostly slows its leaders.
- **The Allied side's 54 redeploys a match are an artifact, not the play.**
  128 of the 145 Allied redeploys in seed 3 were followers on a `WPFollow`
  keeping pace behind a walking leader. The page's no-progress safety net
  (`bot-decision.js updateObjectiveReadout`, 12 s, INVENTION) keeps its best
  distance across a change of order, and a follow goal that moves on every
  5 m never shows progress at a steady distance. The redeploy then puts the
  follower back at the spawn. See the what-if below.
- **Bocage says little.** Both sides lose 28,000 to 50,000 route failures a
  match to the tank map's missing bridge crossing (Brief C). Almost nobody
  dies (under one death a side), and the Allied squad's counters are the
  same in every seed (0 boardings, 1 leader change, follower distance 34.8 ±
  0.1). The differences (-7.2 and -0.9 tickets; Allies +0.35 control points
  and +2.9 captures) are inside one sd.

**What-if: the no-progress test restarted on a new order.** The same El
Alamein matrix, same seeds, run with `sim/compare.mjs --viewer` on a scratch
copy of the viewer whose `updateObjectiveReadout` resets `_bestGoalDist`
and `_noProgress` when `bot.waypoints` is a different object. The change was
not made on main: `bot-decision.js` is outside this brief, and the change
moves the baseline trace. The rows that matter:

| | sai: Axis | sai: Allies | axis=squad: Axis (squad) | allies=squad: Allies (squad) |
|---|---:|---:|---:|---:|
| redeploys, main | 5.5 ± 1.4 | 4.4 ± 3.2 | 3.8 ± 5.7 | 54.0 ± 40.2 |
| redeploys, reset | 2.1 ± 0.3 | 1.7 ± 1.8 | 0.3 ± 0.5 | 2.0 ± 1.1 |
| margin vs same side under the SAI, main | | | -29.9 ± 32.4 (1/10 better) | -2.5 ± 34.2 (4/10) |
| margin vs same side under the SAI, reset | | | -24.8 ± 16.2 (1/10) | -15.5 ± 43.4 (3/10) |
| control points held vs SAI, reset | | | -0.64 ± 0.23 | -0.06 ± 0.60 |
| follower within 25 m of his leader, reset | | | 0.22 | 0.66 |

With the reset, the redeploy storm is gone, and the SAI's own redeploys
halve too (the net misfires on the SAI's re-orders as well). The play still
loses on El Alamein: the Axis squad side is worse in 9 seeds of 10, and the
Allied result is noise around a loss. **Recommended**: make the reset in
`bot-decision.js` (one line; it changes seeded traces wherever an order
changes while a bot is in MoveTo), then re-run this comparison.

## Open

- **Re-run the comparison once Brief I lands.** The runner today seats bots
  in land vehicles only, as kinematic `SimDrive` hulls with hitscan guns;
  planes, ships, fixed guns and parked hulls as obstacles are missing
  (sim/README.md). A squad's vehicle life (boarding, convoys) is the part of
  the play those stand-ins distort most. The command is the same:
  `node sim/compare.mjs --maps el_alamein,bocage --seeds 1-10 --time 600
  --configs "sai axis=squad allies=squad" ...`.
- The no-progress redeploy (`bot-decision.js updateObjectiveReadout`)
  should restart on a new order (the what-if above); not changed here.
- The page runs the SAI only: nothing passes `env.doctrine` from `map.html`
  yet (a `?doctrine=` parameter would be one line in the page's referee env).
- `WPCloseTo::modifyMaxSpeed` (a follower matching the leader's speed close
  in) is not built: the plans carry no speed cap.
- The bots' own Change behaviour competes with `WPBoard`: a follower whose
  Change picks another seat walks there instead (synthetic level, seed 1,
  4.1 s: Change 5.7 against MoveTo 3.0 on the board order; another squad's
  bot took the seat first and the follower went for a Willy). The play
  cannot steer Change through the order contract. With two-seat hulls
  (Willy, Sherman, the runner's stand-ins) at most one follower can board
  anyway.
- Bocage's route failures (the tank map has no bridge crossing, Brief C)
  dominate its runs for every doctrine; re-run it after C as well.
- Plays worth trying next, on what this one showed: a squad whose followers
  take their own hulls and drive as a convoy (in one traced El Alamein
  match the followers at the wheel of their own hull were within 25 m of the
  leader two thirds of the time, against a fifth for those on foot); pairs
  rather than fours on a vehicle level.
