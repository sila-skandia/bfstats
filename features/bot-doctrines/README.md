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

The SAI's beach orders (`WPBeachLanding`, `WPMoveToBeachLanding`: Brief D,
`doctrine-landing.js`, built in `strategic-ai.js _orderBeach`, registered with
an executor that flips the leg and bails the crew) are the worked example.
An order is the object a bot's
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

Run on main at `363d6dc1` (2026-09-24), **after Brief C** (Bocage's bridges
join the banks, `900ff25e`), Brief I (the runner loads the page's real
vehicles: aircraft, landing craft, fixed guns, parked hulls, `GunFire`),
Brief D (the beach orders) and Brief K items 1..4 (fixed guns scored by
`basicTemp`, the runway and air-avoid rules, the control point's own capture
law, the redeploy measured per order); before Brief M's baked search maps
(`088fe039`, which landed while this ran). 8 bots a side, 600 s, **seeds 1,
2, 3, 4, 5, 6, 7, 8, 9, 10**, three configs a level: `sai` (the engine's
SAI on both sides, the baseline), `axis=squad` and `allies=squad` (the play
on one side against the SAI). 60 matches, 8 at a time, about 75 minutes
wall clock on a 20-core machine shared with other runs (load 20 to 30).

```sh
V=/home/dylan/projects/skandia/bfstats/tools/bf1942-models/viewer
node sim/compare.mjs --maps el_alamein,bocage --seeds 1-10 --time 600 \
     --configs "sai axis=squad allies=squad" --jobs 8 \
     --maps-dir $V/maps --models-dir $V/models --out <dir> --markdown <dir>/table.md
```

Every cell is mean ± sd over the ten seeds; "first capture" averages the
runs that had one. The second table under each level pairs each seed of the
play with the same seed and side under the SAI, which takes the level's own
asymmetry out.

#### El Alamein

| metric | sai: Axis (sai) | sai: Allies (sai) | axis=squad: Axis (squad) | axis=squad: Allies (sai) | allies=squad: Axis (sai) | allies=squad: Allies (squad) |
|---|---:|---:|---:|---:|---:|---:|
| runs | 10 | 10 | 10 | 10 | 10 | 10 |
| tickets at the end | 89.2 ± 13.9 | 83.3 ± 17.5 | 72.7 ± 14.3 | 92.5 ± 6.5 | 81.8 ± 16.3 | 89.2 ± 13.8 |
| ticket margin (side - other) | 5.9 ± 25.9 | -5.9 ± 25.9 | -19.8 ± 20.4 | 19.8 ± 20.4 | -7.4 ± 26.0 | 7.4 ± 26.0 |
| ahead at the end | 7 / 10 | 3 / 10 | 2 / 10 | 8 / 10 | 4 / 10 | 5 / 10 |
| control points held (time mean) | 1.71 ± 0.55 | 1.97 ± 0.55 | 1.49 ± 0.47 | 2.18 ± 0.53 | 1.69 ± 0.62 | 2.09 ± 0.63 |
| first capture, s (runs with one) | 185 ± 46 (8/10) | 113 ± 51 (9/10) | 201 ± 14 (6/10) | 133 ± 72 (9/10) | 185 ± 26 (8/10) | 152 ± 69 (9/10) |
| captures | 1.4 ± 1.2 | 1.5 ± 1.0 | 1.0 ± 1.1 | 1.8 ± 0.8 | 1.2 ± 0.9 | 1.8 ± 1.0 |
| deaths | 1.5 ± 1.6 | 5.4 ± 2.5 | 2.8 ± 1.6 | 4.5 ± 1.6 | 2.5 ± 1.4 | 4.5 ± 1.7 |
| kills | 3.0 ± 2.4 | 0.7 ± 1.1 | 1.4 ± 2.5 | 2.4 ± 1.6 | 2.8 ± 1.9 | 1.6 ± 1.3 |
| deaths per capture (pooled) | 1.07 | 3.60 | 2.80 | 2.50 | 2.08 | 2.50 |
| mounted share | 0.78 ± 0.05 | 0.77 ± 0.08 | 0.87 ± 0.09 | 0.80 ± 0.07 | 0.79 ± 0.06 | 0.78 ± 0.07 |
| route failures | 52 ± 99 | 32 ± 48 | 80 ± 93 | 32 ± 52 | 13 ± 20 | 47 ± 93 |
| redeploys | 0.1 ± 0.3 | 0.4 ± 0.5 | 0.0 ± 0.0 | 0.1 ± 0.3 | 0.3 ± 0.9 | 0.0 ± 0.0 |
| bot errors | 0 | 0 | 0 | 0 | 0 | 0 |
| play: holds |  |  | 24.5 ± 5.4 |  |  | 2.2 ± 0.6 |
| play: holdSeconds |  |  | 262 ± 67 |  |  | 15 ± 10 |
| play: boardOrders |  |  | 15.9 ± 17.2 |  |  | 0.0 ± 0.0 |
| play: boardings |  |  | 5.9 ± 5.6 |  |  | 2.0 ± 0.0 |
| play: leaveOrders |  |  | 0.0 ± 0.0 |  |  | 0.0 ± 0.0 |
| play: leaderChanges |  |  | 4.2 ± 2.0 |  |  | 2.0 ± 0.0 |
| play: meanFollowerDistance |  |  | 53.0 ± 18.5 |  |  | 35.1 ± 0.0 |
| play: withinRegroupShare |  |  | 0.54 ± 0.23 |  |  | 0.33 ± 0.00 |
| play: sharedHullShare |  |  | 0.55 ± 0.21 |  |  | 0.08 ± 0.05 |

Against the same side under the SAI, paired by seed (play minus baseline):

| config | side | ticket margin | seeds better | control points held | captures | deaths |
|---|---|---:|---:|---:|---:|---:|
| axis=squad | Axis | -25.7 ± 26.9 | 2 / 10 | -0.22 ± 0.68 | -0.4 ± 1.5 | 1.3 ± 2.2 |
| allies=squad | Allies | 13.2 ± 33.5 | 7 / 10 | 0.12 ± 0.70 | 0.3 ± 1.2 | -0.9 ± 3.3 |

#### Bocage

| metric | sai: Axis (sai) | sai: Allies (sai) | axis=squad: Axis (squad) | axis=squad: Allies (sai) | allies=squad: Axis (sai) | allies=squad: Allies (squad) |
|---|---:|---:|---:|---:|---:|---:|
| runs | 10 | 10 | 10 | 10 | 10 | 10 |
| tickets at the end | 88.3 ± 15.7 | 83.9 ± 19.7 | 87.1 ± 18.3 | 95.8 ± 11.2 | 94.6 ± 9.6 | 88.1 ± 15.6 |
| ticket margin (side - other) | 4.4 ± 29.6 | -4.4 ± 29.6 | -8.7 ± 23.2 | 8.7 ± 23.2 | 6.5 ± 15.9 | -6.5 ± 15.9 |
| ahead at the end | 4 / 10 | 5 / 10 | 2 / 10 | 5 / 10 | 4 / 10 | 3 / 10 |
| control points held (time mean) | 2.28 ± 0.58 | 1.71 ± 0.49 | 1.88 ± 0.25 | 2.03 ± 0.40 | 2.16 ± 0.31 | 1.66 ± 0.37 |
| first capture, s (runs with one) | 46 ± 1 (10/10) | 150 ± 102 (8/10) | 112 ± 69 (10/10) | 114 ± 67 (10/10) | 45 ± 0 (10/10) | 190 ± 128 (9/10) |
| captures | 1.8 ± 0.8 | 1.0 ± 0.7 | 1.2 ± 0.4 | 1.5 ± 0.7 | 1.5 ± 0.5 | 1.0 ± 0.5 |
| deaths | 5.9 ± 6.0 | 1.8 ± 1.9 | 1.9 ± 2.2 | 0.8 ± 1.0 | 3.0 ± 3.5 | 0.2 ± 0.4 |
| kills | 1.4 ± 1.6 | 5.3 ± 5.7 | 0.7 ± 1.1 | 1.6 ± 2.4 | 0.1 ± 0.3 | 2.5 ± 3.1 |
| deaths per capture (pooled) | 3.28 | 1.80 | 1.58 | 0.53 | 2.00 | 0.20 |
| mounted share | 0.84 ± 0.10 | 0.94 ± 0.05 | 0.83 ± 0.06 | 0.95 ± 0.05 | 0.82 ± 0.04 | 0.83 ± 0.10 |
| route failures | 5 ± 10 | 0 ± 1 | 2 ± 3 | 1 ± 2 | 55 ± 149 | 0 ± 0 |
| redeploys | 0.1 ± 0.3 | 0.1 ± 0.3 | 0.1 ± 0.3 | 0.0 ± 0.0 | 0.1 ± 0.3 | 0.0 ± 0.0 |
| bot errors | 0 | 0 | 0 | 0 | 0 | 0 |
| play: holds |  |  | 8.5 ± 2.4 |  |  | 14.4 ± 6.7 |
| play: holdSeconds |  |  | 83 ± 23 |  |  | 205 ± 108 |
| play: boardOrders |  |  | 4.7 ± 2.3 |  |  | 0.0 ± 0.0 |
| play: boardings |  |  | 1.6 ± 1.1 |  |  | 0.0 ± 0.0 |
| play: leaveOrders |  |  | 12.5 ± 39.5 |  |  | 5.7 ± 18.0 |
| play: leaderChanges |  |  | 4.7 ± 1.6 |  |  | 0.3 ± 0.5 |
| play: meanFollowerDistance |  |  | 33.9 ± 13.1 |  |  | 47.0 ± 0.0 |
| play: withinRegroupShare |  |  | 0.49 ± 0.12 |  |  | 0.11 ± 0.00 |
| play: sharedHullShare |  |  | 0.03 ± 0.03 |  |  | 0.00 ± 0.00 |

Against the same side under the SAI, paired by seed (play minus baseline):

| config | side | ticket margin | seeds better | control points held | captures | deaths |
|---|---|---:|---:|---:|---:|---:|
| axis=squad | Axis | -13.1 ± 43.4 | 4 / 10 | -0.41 ± 0.65 | -0.6 ± 1.1 | -4.0 ± 6.6 |
| allies=squad | Allies | -2.1 ± 32.3 | 5 / 10 | -0.05 ± 0.64 | 0.0 ± 0.8 | -1.6 ± 1.8 |

**Reading it.**

- **No bot errors** in 60 matches.
- **The runner's fixes show in the baseline.** Against the pre-I table
  (land vehicles only, the per-bot capture timer, the redeploy kept across
  orders): El Alamein's captures fall from 4.4 / 4.5 a side to 1.4 / 1.5
  (no flag traded every 10 s), redeploys from 5.5 / 4.4 to 0.1 / 0.4, and
  Bocage's route failures from 49,506 / 32,422 to 5 / 0 (the bridges).
  Bocage now fights: 5.9 and 1.8 deaths a side under the SAI, against 0.5
  and 0.1.
- **El Alamein: the play still loses on the Axis side** (-25.7 ± 26.9
  tickets against the Axis under the SAI, better in 2 seeds of 10) and is
  level to slightly ahead on the Allied side (+13.2 ± 33.5, 7 of 10, inside
  one sd). With real vehicles the Axis squads ride together more (shared
  hull 0.55, 5.9 boardings a match) and their leaders still hold 262 s a
  match for followers.
- **Bocage: no measurable difference** (-13.1 ± 43.4 and -2.1 ± 32.3, 4
  and 5 seeds of 10); the Allied squad side's counters barely move between
  seeds (0 boardings, follower distance 47.0 ± 0.0), so its leaders and
  followers mostly sit.

The pre-I table (`b1fe0db9`: kinematic `SimDrive` hulls, hitscan guns, land
vehicles only) had the Axis play at -29.9 ± 32.4 on El Alamein and both
Bocage differences inside one sd; its what-if (the redeploy restarted on a
new order) is now main (ledger AI-101).

## Open

- ~~Re-run the comparison once Brief I lands~~ done after Briefs I, C, D
  and K (the table above). Re-run it once Brief M's baked search maps have
  settled: they change every route.
- The no-progress redeploy (`bot-decision.js updateObjectiveReadout`)
  restarts on a new order since Brief K (ledger AI-101).
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
