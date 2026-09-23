# Headless match runner

Runs a whole match of bots against bots with no renderer, at full speed, on
the viewer's own AI code (`viewer/world.js`, `bot*.js`, `nav-grid.js`,
`strategic.js`, `collision.js`), imported unmodified. A seed fixes every
random draw, so the same seed replays the same match byte for byte. The
algorithm it runs is specified in
[`features/bf1942-ai-spec/`](../../../features/bf1942-ai-spec/README.md).

## Usage

From `tools/bf1942-models/`:

```sh
# the synthetic harness level (no assets needed)
node sim/run.mjs --synthetic --bots 4 --time 120 --seed 1

# a real extracted level; the maps and models trees are untracked, so point
# at the checkout that has them
V=/home/dylan/projects/skandia/bfstats/tools/bf1942-models/viewer
node sim/run.mjs --map el_alamein --maps $V/maps --models $V/models \
     --bots 8 --time 600 --seed 3 --trace-every 3

# read a trace back
node sim/run.mjs --replay-summary sim/out/el_alamein-s3/trace.jsonl --step 60
node sim/run.mjs --why bot_4 312.5 --trace sim/out/el_alamein-s3/trace.jsonl
```

| option | default | |
|---|---|---|
| `--synthetic` / `--map <dir>` | synthetic | the level; `<dir>` is a directory under the maps tree |
| `--bots N` | 4 | bots a side |
| `--time T` | 120 | game seconds; a side at 0 tickets ends the match early |
| `--seed S` | 1 | the seed |
| `--skill A` | 0.75 | `botSkill` (the engine's default) |
| `--trace-every K` | 1 | a tick line every K-th 30 Hz tick (every tick costs about 1 MB a bot-minute) |
| `--sample-every S` | 1 | the tickets/flags sample period, seconds |
| `--no-vehicles` | | leave the level's land vehicles out |
| `--no-trace` | | the summary only |
| `--out DIR` | `sim/out/<level>-s<seed>` | writes `trace.jsonl` and `summary.json` |
| `--maps DIR`, `--models DIR` | `<viewer>/maps`, `<viewer>/models` | the extracted trees |
| `--viewer DIR` | `../viewer` | the viewer the AI is loaded from |

Speed: the synthetic level with 3 bots a side plays 60 s in about 0.6 s; El
Alamein with 8 a side plays 600 s in about 30 s tracing every third tick
(a 60 MB trace), after a load of about a second.

Test: `python3 -m unittest tests.test_sim_match` (a 20 s seeded match on the
synthetic level, run twice for the same seed and once for another).

## What it loads

**The synthetic harness level** (`level.mjs syntheticLevel`): the frame and
the two flags of `tests/bot_ai_harness.mjs` (Home at (100, -100), Enemy at
(100, -220), 256 m world, flat ground), a neutral Middle flag between them,
an uncapturable base behind each side, the harness's 1 m sandbag line across
the Allied approach and its mirror across the Axis one (both cover objects),
a Willy and a Sherman at each base, five strategic areas and two strategies
a side, and three kits a side built from the vanilla K98 / Thompson / Colt /
MedPack AI templates and fire data (values copied into `level.mjs`).

**A real level** (`level.mjs realLevel`), loaded as `map.html` loads it:

- `scene.json` is the world's `extras` (flags, spawns, tickets, `ai`).
- `scene.glb` goes through the viewer's own `GLTFLoader` with its images and
  textures stripped from the JSON chunk, which gives the page's scene graph
  (names, `userData`, geometry). The collider is `buildCollider`'s:
  `buildHeightfield` over the `kind: terrain` meshes, `buildCollisionIndex`
  over the top-level owners, `buildDrivableMask`, `WorldCollider` with the
  level's water.
- kits from `maps/_shared/loadouts.json`, weapon fire data from each weapon's
  `models/<name>.glb` `extras.weapon`, round damage from `maps/damage.json`,
  vehicle AI from `maps/_shared/vehicle-ai.json`.

Verified on El Alamein (2026-09-23): the glb loads in 0.4 s, 33,911 static
collision triangles, the heightfield, 26 cover values, 30 land vehicles,
four strategies a side, and a 600 s match with 8 a side runs in 31 s.

**What it cannot load, and what each would need** (none of it needs a change
to `bot.js` or `map.html`; each is a runner-side port of page code):

| missing | what the page uses | what the runner would need |
|---|---|---|
| real vehicle physics | `VehicleOccupancy(node).ensureDrive(...)` over the vehicle's glb node, `adoptDrivenBody`, the body world (`World.setupBodies` with the damage tables and `bodyTerrain`) | the placed vehicles kept in the scene graph, `seats.js VehicleOccupancy`, the drive classes the page passes (`Aircraft`, `GroundVehicle`, `TrackedVehicle`, `Ship`), and `World.setupBodies`; the runner uses `SimDrive` instead (below) |
| vehicle guns | `guns.collect(node)` (gunfire.js) and the world firing the groups; shells billed by `applyVehicleHit`'s splash, MG rounds by `resolveBotShot` from the gun | `GunFire` headless (it builds tracer meshes) or a port of its round flight; the runner's mounted guns are hitscan (`SIM_GUN`) |
| aircraft and ships | the same `ensureDrive`, `botWaterNav` for boats | as above; the runner seats bots in land vehicles only (`class: Land`) |
| fixed guns | `botVehicleCandidates` lists `gun` roots | the placed gun nodes and their seat surveys (`surveyVehicle`, `seatYawLimits`) |
| parked vehicles as obstacles | `settlePlacedVehicles`, the body world; the nav map skips body owners | the runner leaves the spawner group out of the static index: parked hulls block neither rays nor bodies |
| ship deck spawns | `rebaseDeckSpawns` | the carrier's live transform; a deck-spawn level is out of scope |
| the human | the local player, `resolvePlayerShotOnBots`, his shots heard | nothing: the runner is bots only |

## Trace schema (`trace.jsonl`, one JSON object a line)

The first line is the header, the last the summary. Numbers are rounded to
0.01 (positions, times) or 0.0001 (urgencies). The file is byte-identical for
a seed; nothing wall-clock is written to it.

`{"k":"match", ...}` — `version`, `level`, `seed`, `botsPerSide`, `botSkill`,
`duration`, `tickHz` (30), `traceEvery`, `sampleEvery`, `worldSize`,
`behaviours` (the order of every urgency array below), `nav` (`width`,
`height`, `cellSize`), `strategic` (area names, or null: bots walk at the
nearest enemy flag), `flags` (`name`, `team`, `pos`, `radius`,
`uncapturable`, `controlPoint`), `tickets`, `lossPerMin`, `covers`,
`vehicles`, `bots` (`id`, `side`, `name`, `kit`, `weapons`).

`{"k":"tick", ...}` — one per bot per traced tick, after the bot's tick:

| field | |
|---|---|
| `t`, `n` | game time (s) and tick index |
| `bot`, `side` | `bot_<i>`, 1 Axis / 2 Allies |
| `alive` | false: only `respawnIn` follows |
| `hp`, `pos`, `yaw`, `stance` | the body (the hull's position when mounted) |
| `area`, `order` | the order: the strategic area's name, `{point, radius, src}` (`src` `order` from the SAI, `fallback` for the nearest-enemy-flag stand-in) |
| `beh`, `since` | the active behaviour and the seconds since it was chosen |
| `u` | every behaviour's urgency this tick (`bot.urgency`), in `behaviours` order |
| `act` | the snapshot the hysteresis compares against (`bot.activeUrgency`) |
| `mod` | the modifier each behaviour was evaluated with this tick (personality x the active behaviour's curve x its inhibitor column); null: not evaluated (not registered for the unit, or mod <= 0, so the old urgency stands) |
| `plan`, `planLen` | the first unfinished plan action and the plan's length |
| `ctl` | the input word written: `[forward, strafe/steer, lookX, lookY, fire]` |
| `stall` | the stalled-tick counter (150 obstructed, 401 route failed) |
| `target` | the firing target's id |
| `veh` | `{id, template, seat, drives}` when mounted |
| `route` | `{points, failed}` of the followed route |
| `terms` | the winning behaviour's inputs (`moveTo`: `dist`, `radius`, `factor`, `q` = d²/4(R+r)², `shaped`; `scout`: `dir`, `accum`, `quad`; `takeCover`: `danger`, `cover`, `goal`; `special`: `target`, `arrive`; `change`: `best`, `u`, `bail`, `teleport`; `avoid`: `threat`), plus `fire` (`target`, `score`, `weapon`, `dist`, `visible`) whenever a target is held |

`{"k":"ev", "t", "type", ...}` — events:

| type | fields |
|---|---|
| `capture` | `flag`, `from`, `to`, `by`, `alive` (false: a dead bot's position took it, as the page's capture law allows) |
| `kill` | `killer`, `killerSide`, `victim`, `victimSide`, `weapon`, `dist`, `pos` |
| `respawn` | `bot`, `side`, `flag`, `pos` |
| `mount` / `dismount` | `bot`, `side`, `vehicle`, `template`, `seat` / `killed`, `driver` |
| `route_failed` | `bot`, `side`, `count` (the bot's `_pathFailures`), `pos`, `goal`, `mounted` |
| `redeploy` | `bot`, `side`, `flag`, `pos` (the 12 s no-progress redeploy) |
| `strategy` | `side`, `from`, `to` |
| `vehicle_destroyed` / `vehicle_respawn` | `vehicle`, `template` |
| `bot_error` | `bot`, `side`, `message`, `at` (the top stack frames), `beh`: a bot's tick threw; the first time per bot and message (the count is in `perBot.errors`) |

`{"k":"sample", "t", "tickets":{1,2}, "flags":{0,1,2}, "alive":{1,2},
"mounted":{1,2}, "owners":[...]}` — every `--sample-every` seconds; `flags`
counts the control points each side holds (0 neutral), `owners` lists them
in header order (control points only).

`{"k":"summary", ...}` — the summary below without `trace`, `runtime` and
`level_info`.

## Summary (`summary.json`)

`result` (`reason` `time` or `tickets`, `winner`, `tickets`) and `metrics`:
`ticketsOverTime` and `flagsHeldOverTime` (every 5 s: `[t, axis, allies]`,
`[t, neutral, axis, allies]`), `timeToFirstCapture`, `captures`, `deaths`,
`kills`, `deathsPerCapture`, `vehicleUtilisation` (`mountedShare` = mounted
bot-seconds / alive bot-seconds, `mounts`, `mountsByTemplate`, `destroyed`),
`routeFailures` (total and per bot), `redeploys`, `strategyChanges`,
`botErrors`, `behaviourShare` (bot-seconds per active behaviour); `perBot`
(kills, deaths, shots, hits, captures, route failures, redeploys, mounts,
seconds alive and mounted, seconds per behaviour, errors and their
messages); `trace` (`lines`, `sha256`); `runtime`.

## What the runner adds around the bots

The bots, the world, the nav map and the strategic AI are the viewer's. The
page-side referee is copied from `map.html` because the page is not a module;
`match.mjs`'s header lists each function it mirrors (`tickBots`,
`botRespawnTick`, `botFireTick`, `resolveBotShot`, `botMagazineTick`,
`applyDamageToBot`, `botDamageLanded`, `resolveBotHeal`, `botCaptureTick`,
`buildBotCovers`, `botOccupiedUnits`, `botUnitInfo`, `botStrategicUnit`,
`botVehicleTick`, `botEnterVehicle`, `botLeaveVehicle` with their
`botChangedUnit` calls, `botVehicleCandidates`). A change to one of those in
the page needs the same change here.

**A throwing bot tick** ends the page's `frame()`; the runner catches it per
bot, records a `bot_error` event and carries on with the next bot, so one
broken path shows up in the trace instead of ending the match.

**Cadence.** The runner ticks every bot once per 30 Hz world tick. The page
ticks them once per display frame, so the tick-counted constants (the stall
counts 150 / 401, `CONTACT_TICKS` 10) run twice as fast at 60 fps in the
page as here; everything timed in seconds matches.

Runner-only, labelled SIM in the code:

- **Tickets**: one a death, and `lossPerMin` a minute while the other side
  holds more than half the control points
  (`features/bf1942-3d-models/tickets-hud.md`). The viewer's counter does not
  move.
- **`SimDrive`** (`vehicles.mjs`): a kinematic hull driven by the bot's input
  word through `World`'s occupied-vehicle tick: throttle to speed at 4 m/s²,
  a tracked hull pivots at 0.7 rad/s, a wheeled one turns on
  `max(speed, 2) / turnRadius`, a blocked cell of the vehicle map is a wall
  it slides along.
- **`SimTurret`**: the look pair turns the turret at the soldier's gains, no
  limits.
- **Doors** 2.5 m either side of the hull; **hull hit points** 400
  (HeavyArmour) / 100 (LightArmour); small arms do 2 % / 30 % of their
  damage to a hull, a shell 50 % / 100 %; **mounted guns** are hitscan from
  the turret: a `burst` gun 8 rounds/s at 15, any other 1 round per 4 s at
  100.
- The seated crew's soldier record rides at the hull, so a round aimed at a
  hull finds the crew's record and bills the hull.

## First findings

From the runs made while building it (El Alamein, 8 a side, seed 3, 600 s,
and the synthetic level):

- **A medic with a strategic order throws** (`wp.inside is not a function`,
  `bot.js _urgencySpecial`) as soon as a wounded friend passes the medic's
  filters: `strategic.js _order` stopped giving its order an `inside` in
  `ee729113`. Synthetic level, seed 1: 248 throws in 30 s. The same change
  makes `_insideOrderedArea` always true, so the outside-area factors of
  Fire and Change no longer apply.
- El Alamein never changes strategy (0 changes in 600 s): every condition of
  its prerequisites is Required, and a passing Required condition adds
  nothing to the score (`strategic.js _evaluatePrerequisite`), so every
  strategy scores 0 and each side keeps `broad`.

- **A bot cycles in and out of a Willy's passenger seat every 0.37 s** (62
  mounts in 10 minutes; bot_1, t = 166.8 .. 167.9 s). Seated in the undriven seat, Change's best is
  another Willy's driver seat, so it exits; on foot, the best is the seat it
  just left. Two things in `bot.js` let it: the 15 s left-unit ramp never
  applies, because `dismount()` stores the seat candidate's id
  (`<vehicle>:<seat>`) in `_leftVehicle.id` and `_urgencyChange` compares it
  with `c.vehicleId`; and the 10 s change ramp only scales the urgency, which
  saturates (`Declein(...) = 1`, so `1.9 x 4 x ramp` passes Idle's 0.1 at
  ramp 0.013, 0.13 s after the change). The page has the same ids, so the
  page should show it too.
- Riders of undriven hulls spend most of the match in Scout; drivers spend
  it in MoveTo.
- The page's capture law lets a dead bot's body take a flag during its 8 s
  respawn wait; the `capture` event's `alive` says when that happened.
