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

## The garrison (the page's default)

`doctrine-garrison.js`, 'garrison': the SAI's strategy and targets with one
bot hanging back on each flag the side has taken (a post that mans the flag's
gun or walks a ring round it) and every other bot pushing; bots not on a post take a fixed gun only
for an enemy they have spotted in its reach. The page runs it unless
`?doctrine=sai`; the runner's default stays the SAI. See
[features/bot-garrison](../bot-garrison/README.md).

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

Re-run 2026-09-24 for Brief O on main at `0c55ab7f`: the level's own search
maps (M), the level's own strategic maps and each hull's own search type
(AI-117, AI-118), the soldier's 5 s look-ahead (AI-119), Brief L's soldier
count law, Brief N's landing craft and Brief P's capture law settings and
tank fire approach. 8 bots a side, 600 s, **seeds 1..10**, three configs a
level: `sai` (the engine's SAI on both sides, the baseline), `axis=squad`
and `allies=squad` (the play on one side against the SAI). 60 matches, 13
at a time, about 40 minutes wall clock on a 20-core machine shared with
other runs.

```sh
V=/home/dylan/projects/skandia/bfstats/tools/bf1942-models/viewer
node sim/compare.mjs --maps el_alamein,bocage --seeds 1-10 --time 600 \
     --configs "sai axis=squad allies=squad" --jobs 13 \
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
| tickets at the end | 86.0 ± 13.9 | 81.9 ± 13.6 | 81.3 ± 15.1 | 88.4 ± 8.4 | 84.7 ± 15.1 | 78.1 ± 15.7 |
| ticket margin (side - other) | 4.2 ± 25.2 | -4.2 ± 25.2 | -7.1 ± 21.1 | 7.1 ± 21.1 | 6.6 ± 28.9 | -6.6 ± 28.9 |
| ahead at the end | 5 / 10 | 5 / 10 | 4 / 10 | 6 / 10 | 6 / 10 | 4 / 10 |
| control points held (time mean) | 1.75 ± 0.50 | 1.80 ± 0.53 | 1.36 ± 0.58 | 2.13 ± 0.59 | 1.78 ± 0.59 | 1.83 ± 0.41 |
| first capture, s (runs with one) | 186 ± 49 (8/10) | 210 ± 100 (9/10) | 301 ± 83 (5/10) | 145 ± 28 (10/10) | 252 ± 152 (9/10) | 197 ± 25 (9/10) |
| captures | 1.7 ± 1.2 | 1.9 ± 1.3 | 1.0 ± 1.2 | 2.6 ± 1.2 | 1.6 ± 1.1 | 1.7 ± 0.8 |
| deaths | 3.2 ± 2.2 | 7.7 ± 4.3 | 4.7 ± 4.9 | 6.5 ± 3.4 | 3.8 ± 2.5 | 7.5 ± 2.0 |
| kills | 4.4 ± 3.1 | 2.7 ± 2.1 | 2.9 ± 2.2 | 4.1 ± 4.4 | 4.3 ± 3.5 | 3.0 ± 2.5 |
| deaths per capture (pooled) | 1.88 | 4.05 | 4.70 | 2.50 | 2.38 | 4.41 |
| mounted share | 0.79 ± 0.07 | 0.80 ± 0.11 | 0.86 ± 0.04 | 0.80 ± 0.12 | 0.82 ± 0.09 | 0.78 ± 0.10 |
| route failures | 1 ± 1 | 67 ± 200 | 383 ± 1183 | 1 ± 3 | 42 ± 130 | 11 ± 24 |
| redeploys | 1.1 ± 0.3 | 1.3 ± 2.1 | 0.5 ± 0.5 | 0.4 ± 0.7 | 0.8 ± 0.4 | 0.4 ± 0.7 |
| bot errors | 0 | 0 | 0 | 0 | 0 | 0 |
| play: holds |  |  | 22.6 ± 4.5 |  |  | 9.4 ± 5.7 |
| play: holdSeconds |  |  | 277 ± 62 |  |  | 116 ± 77 |
| play: boardOrders |  |  | 15.3 ± 12.2 |  |  | 0.3 ± 0.5 |
| play: boardings |  |  | 6.1 ± 6.5 |  |  | 3.1 ± 1.0 |
| play: leaveOrders |  |  | 0.5 ± 1.3 |  |  | 1.2 ± 3.5 |
| play: leaderChanges |  |  | 3.0 ± 1.2 |  |  | 3.0 ± 0.8 |
| play: meanFollowerDistance |  |  | 42.5 ± 11.3 |  |  | 70.6 ± 89.9 |
| play: withinRegroupShare |  |  | 0.55 ± 0.12 |  |  | 0.24 ± 0.07 |
| play: sharedHullShare |  |  | 0.19 ± 0.17 |  |  | 0.28 ± 0.17 |

Against the same side under the SAI, paired by seed (play minus baseline):

| config | side | ticket margin | seeds better | control points held | captures | deaths |
|---|---|---:|---:|---:|---:|---:|
| axis=squad | Axis | -11.2 ± 36.1 | 4 / 10 | -0.38 ± 0.85 | -0.7 ± 1.8 | 1.5 ± 5.5 |
| allies=squad | Allies | -2.4 ± 42.8 | 4 / 10 | 0.03 ± 0.77 | -0.2 ± 2.0 | -0.2 ± 5.3 |

#### Bocage

| metric | sai: Axis (sai) | sai: Allies (sai) | axis=squad: Axis (squad) | axis=squad: Allies (sai) | allies=squad: Axis (sai) | allies=squad: Allies (squad) |
|---|---:|---:|---:|---:|---:|---:|
| runs | 10 | 10 | 10 | 10 | 10 | 10 |
| tickets at the end | 65.8 ± 17.1 | 93.1 ± 4.9 | 55.9 ± 8.2 | 91.1 ± 7.7 | 66.9 ± 15.8 | 88.0 ± 11.1 |
| ticket margin (side - other) | -27.3 ± 19.0 | 27.3 ± 19.0 | -35.2 ± 13.9 | 35.2 ± 13.9 | -21.1 ± 25.0 | 21.1 ± 25.0 |
| ahead at the end | 1 / 10 | 9 / 10 | 0 / 10 | 10 / 10 | 2 / 10 | 8 / 10 |
| control points held (time mean) | 1.49 ± 0.33 | 2.49 ± 0.49 | 1.25 ± 0.31 | 2.98 ± 0.38 | 1.79 ± 0.43 | 2.52 ± 0.45 |
| first capture, s (runs with one) | 49 ± 2 (10/10) | 93 ± 43 (10/10) | 192 ± 148 (6/10) | 78 ± 11 (10/10) | 59 ± 12 (10/10) | 94 ± 42 (10/10) |
| captures | 1.4 ± 0.5 | 2.2 ± 0.8 | 0.9 ± 0.9 | 2.9 ± 0.6 | 1.5 ± 0.7 | 2.3 ± 0.7 |
| deaths | 8.2 ± 2.1 | 6.9 ± 4.9 | 6.4 ± 7.3 | 7.9 ± 6.5 | 6.5 ± 3.6 | 6.4 ± 3.9 |
| kills | 4.6 ± 3.2 | 6.4 ± 2.8 | 6.2 ± 6.3 | 5.7 ± 6.8 | 4.5 ± 3.1 | 5.8 ± 3.6 |
| deaths per capture (pooled) | 5.86 | 3.14 | 7.11 | 2.72 | 4.33 | 2.78 |
| mounted share | 0.88 ± 0.03 | 0.92 ± 0.04 | 0.88 ± 0.07 | 0.89 ± 0.07 | 0.83 ± 0.06 | 0.88 ± 0.06 |
| route failures | 6 ± 8 | 11 ± 21 | 132 ± 383 | 535 ± 1611 | 35 ± 76 | 37 ± 60 |
| redeploys | 0.0 ± 0.0 | 0.1 ± 0.3 | 0.2 ± 0.4 | 0.2 ± 0.4 | 0.1 ± 0.3 | 0.3 ± 0.9 |
| bot errors | 0 | 0 | 0 | 0 | 0 | 0 |
| play: holds |  |  | 12.4 ± 5.3 |  |  | 6.7 ± 5.0 |
| play: holdSeconds |  |  | 145 ± 71 |  |  | 71 ± 66 |
| play: boardOrders |  |  | 5.3 ± 1.8 |  |  | 0.4 ± 1.0 |
| play: boardings |  |  | 3.3 ± 1.9 |  |  | 0.4 ± 0.8 |
| play: leaveOrders |  |  | 4.6 ± 6.9 |  |  | 0.0 ± 0.0 |
| play: leaderChanges |  |  | 2.7 ± 1.9 |  |  | 1.7 ± 0.9 |
| play: meanFollowerDistance |  |  | 29.1 ± 9.7 |  |  | 42.5 ± 5.7 |
| play: withinRegroupShare |  |  | 0.68 ± 0.10 |  |  | 0.21 ± 0.13 |
| play: sharedHullShare |  |  | 0.15 ± 0.14 |  |  | 0.07 ± 0.15 |

Against the same side under the SAI, paired by seed (play minus baseline):

| config | side | ticket margin | seeds better | control points held | captures | deaths |
|---|---|---:|---:|---:|---:|---:|
| axis=squad | Axis | -7.9 ± 25.1 | 4 / 10 | -0.24 ± 0.40 | -0.5 ± 1.2 | -1.8 ± 8.1 |
| allies=squad | Allies | -6.3 ± 33.4 | 4 / 10 | 0.03 ± 0.82 | 0.1 ± 1.1 | -0.5 ± 5.7 |

**Reading it.**

- **No bot errors** in 60 matches.
- **The baseline against main without Brief O** (`47353211`, the same
  seeds, SAI both sides; Axis / Allies): El Alamein captures 1.5 / 2.4 ->
  1.7 / 1.9, deaths 6.4 / 9.7 -> 3.2 / 7.7, route failures 0 / 0 -> 1 / 67;
  Bocage captures 2.1 / 2.1 -> 1.4 / 2.2, deaths 10.2 / 10.3 -> 8.2 / 6.9,
  route failures 37 / 0 -> 6 / 11. Most route failures are single seeds
  where one bot retries a route the engine would refuse too (El Alamein
  seed 10: a tank closing on a target that stands where `Tank0` has no free
  pixel within 20 m, 634; the squad play's El Alamein seed 10 and Bocage
  seed 3, 3,742 and 5,093 on one bot each).
- **El Alamein: the play is level with the SAI on either side** (-11.2 ±
  36.1 and -2.4 ± 42.8 tickets against the same side under the SAI, better
  in 4 seeds of 10 each); the Axis squads still hold 277 s a match for
  followers and take their first flag later (301 s, 5 of 10 runs).
- **Bocage: the Allies win under every doctrine** (margin 21 to 35 tickets,
  8 to 10 seeds of 10); the play changes neither side measurably (-7.9 ±
  25.1 and -6.3 ± 33.4).
- **The capture drop after M** (ledger AI-120) was mostly Brief K's capture
  law, which AI-104's baseline predated; the rest, El Alamein's Axis, was
  the Allied Willy no longer wedging on the painted map on its way to East
  outpost.

The earlier table (`363d6dc1`, after Briefs I, C, D and K and before M) had
the Axis play at -25.7 ± 26.9 on El Alamein and both Bocage differences
inside one sd.

## Open

- ~~Re-run the comparison once Brief I lands~~ done after Briefs I, C, D
  and K; ~~re-run it once Brief M's baked search maps have settled~~ done
  after Brief O (the table above).
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
- ~~Bocage's route failures (the tank map has no bridge crossing, Brief C)
  dominate its runs for every doctrine~~ gone since C and O; what is left
  are single seeds where one bot retries a route to a point its map has no
  free pixel near.
- Plays worth trying next, on what this one showed: a squad whose followers
  take their own hulls and drive as a convoy (in one traced El Alamein
  match the followers at the wheel of their own hull were within 25 m of the
  leader two thirds of the time, against a fifth for those on foot); pairs
  rather than fours on a vehicle level.
