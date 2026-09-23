# Headless match runner

Runs a whole match of bots against bots with no renderer, at full speed, on
the viewer's own AI code (`viewer/world.js`, `bot*.js`, `nav-grid.js`,
`strategic.js`, `collision.js`) and, on a real level, the viewer's own
vehicles (`vehicle-instance.js`, the drive classes, the body world, `GunFire`,
`vehicle-hits.js`, `vehicle-wrecks.js`, `bot-units.js`), imported unmodified. A seed fixes every
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
| `--no-vehicles` | | leave the level's vehicles and fixed guns out (the spawners group) |
| `--no-trace` | | the summary only |
| `--seat B=T[:S]` | | seat bot B in the nearest free unit of template T (its seat S, else the driver's) before the first tick, the page's `__botMount` law; repeatable; real level |
| `--doctrine D` | `sai` | each side's doctrine (`viewer/doctrine.js`): `sai` the engine's SAI, `squad` the squad play, or per side `axis=squad,allies=sai`; see [features/bot-doctrines](../../../features/bot-doctrines/README.md) |
| `--out DIR` | `sim/out/<level>-s<seed>` | writes `trace.jsonl` and `summary.json` |
| `--maps DIR`, `--models DIR` | `<viewer>/maps`, `<viewer>/models` | the extracted trees |
| `--viewer DIR` | `../viewer` | the viewer the AI is loaded from |

Speed: the synthetic level with 3 bots a side plays 60 s in about 0.6 s; El
Alamein with 8 a side and the page's vehicles plays 600 s in 80 to 100 s
tracing every third tick (longer on a loaded machine), after a load of about
3 s (the glb, the settle of every parked hull, the two nav maps).

Tests: `python3 -m unittest tests.test_sim_match` (a 20 s seeded match on the
synthetic level, run twice for the same seed and once for another);
`python3 -m unittest tests.test_sim_vehicles` (the vehicle recipes of
`tests/sim_vehicles_harness.mjs` on El Alamein and Wake; it finds the
untracked maps tree in `$BF42_VIEWER_ASSETS`, this checkout's `viewer/` or
the main checkout's, and skips without one).

**Doctrines.** `--doctrine` swaps the order source behind the strategic
interface (`viewer/doctrine.js StrategicCommand`, the one thing the referee
asks for a bot's order). A run with `sai` on both sides (the default) is the
engine's SAI and its trace is byte for byte the trace from before the
interface: the header and the tick lines name no doctrine. Any other run
adds `doctrine` to the header and `kind` / `leader` to each tick's `order`.
`summary.json` carries a `doctrine` block (both sides' names, each side's
first capture and time-mean control points held, and what the play counted)
that the trace's summary line leaves out.

`sim/compare.mjs` runs a doctrine matrix and prints the per-side table:

```sh
node sim/compare.mjs --maps el_alamein,bocage --seeds 1-10 --time 600 \
     --configs "sai axis=squad allies=squad" --jobs 8 \
     --maps-dir $V/maps --models-dir $V/models --out sim/out/compare \
     --markdown sim/out/compare/table.md
node sim/compare.mjs --out sim/out/compare --report-only   # re-read, run nothing
```

Each match goes to `<out>/<map>/<config>/s<seed>` with `--no-trace`; one
that has a summary is kept (`--force` re-runs). Running the play once per
side and pairing each seed with the same side's baseline takes the level's
own asymmetry out of the difference (the second table it prints).

## What it loads

**The synthetic harness level** (`level.mjs syntheticLevel`): the frame and
the two flags of `tests/bot_ai_harness.mjs` (Home at (100, -100), Enemy at
(100, -220), 256 m world, flat ground), a neutral Middle flag between them,
an uncapturable base behind each side, the harness's 1 m sandbag line across
the Allied approach and its mirror across the Axis one (both cover objects),
a Willy and a Sherman at each base, five strategic areas and two strategies
a side, and three kits a side built from the vanilla K98 / Thompson / Colt /
MedPack AI templates and fire data (values copied into `level.mjs`).

**A real level** (`level.mjs realLevel`, then `stage.mjs createStage`),
loaded as `map.html` and `level-load.js show()` load it:

- `scene.json` through `selectGameMode` (the default layer) is the world's
  `extras` (flags, spawns, tickets, `ai`).
- `scene.glb` goes through the viewer's own `GLTFLoader` with its images and
  textures stripped from the JSON chunk, then `pruneToMode`, which gives the
  page's scene graph (names, `userData`, geometry).
- the tables `show()` fetches: `damage.json` (the level's `damage.path`),
  `collision-meshes.json`, the terrain material ids (`terrain/materials.png`,
  the room server's decoder) and `_shared/vehicle-ai.json`; kits from
  `_shared/loadouts.json`, weapon fire data from each weapon's
  `models/<name>.glb` `extras.weapon`.

The stage then builds, in `show()`'s order and with the page's own modules:
the `World` (with the guns, the crash hook and the per-tick seat positions),
the landing craft split off their ships (`detachSpawnedCraft`), the statics
indexed and frozen (`level-statics.js`), the collider (`level-terrain.js
buildCollider`: every parked hull settled on its springs and every ship
floated at its draft first, then indexed one owner each, and every Armor
registered), the body world with a parked body per hull (`hull-bodies.js
setupVehicleBodies`), the hull registry (`VehicleRegistry` with `Aircraft`,
`GroundVehicle`, `TrackedVehicle` and `Ship`), a headless `GunFire` (the
rounds flown against the collider and cast against the soldier bodies,
every landing through `applyVehicleHit`), the wrecks and their respawn, and
the bots' units (`bot-units.js` over the registry and `vehicle-entry.js`'s
doors). So a bot's hull is the page's: its one drive adopted into the body
world, its seat's gun groups fired by the world from the bot's input word,
its shells splashing and its MG rounds meeting bodies, its wreck killing its
crew and coming back off the spawner; an aircraft flies the page's flight
model, a landing craft sails on the `LandingCraft` water map, a fixed gun is
a seat with no drive, and a parked hull stops rays and bodies on its pad.

Per tick, around the referee, the page frame's order: `world.step`,
`referee.tick`, `syncVehicleSpawnOwnership`, `referee.captureTick`,
`stepVehicleBodies`, `stepSinkingHulls`, `stepVehicleDamage`, then the
renderer's matrix update for each occupied seat's guns.

Departures, labelled SIM in `stage.mjs` (none changes what a hull or a bot
does): `buildHullDrive` is copied from `map.html` (a page function) with the
cockpit off; everything presentational is a stub (no effects, no sound, the
wreck glb never loads so the pad fades the intact hull, the page's own
fallback, no render interpolation: a driven hull's node keeps the pose its
drive's `integrate` wrote); a target's description (`bot-units.js unitInfo`, which measures
the hull's box) is computed once a tick per target instead of once per
asking bot. A hull's killer is the page's own `killedBy` (the attacker of
the lethal hit), which also credits its crew's deaths.

Verified on El Alamein (2026-09-24): 38 units the bots can take (30 live at
the start: 12 tanks, 8 cars, 8 aircraft, 2 AA guns), 27 parked bodies. Seed
1, 8 a side, 600 s, `--seat bot_0=AA_Allies --trace-every 3` (main at
`8e174332`): four aircraft take off in the first 35 s (three Spitfires, a
Bf 109) and a fifth at 415 s; a PanzerIV takes North outpost at 203 s and
East outpost at 371 s; the Axis bot in the AA gun fires at 0.6 s; 588
vehicle rounds (530 from PanzerIVs, 56 from aircraft, 2 from the AA gun);
five hulls destroyed, none by a round (the B17, a pair of Spitfires
together, a Spitfire and a Bf 109 together on the airfield). The same seed
twice gives the same trace. Seeds 1..4 without `--seat` (before the rebase
onto `8e174332`) gave 20 to 26 mounts, 5 to 34 captures (most in tanks), 22
to 850 vehicle rounds and 3 to 7 hulls destroyed, and no bot took a fixed
gun. Wall clock for 600 s: 79 to 97 s on the 20-thread development machine
at a load of about 20, 145 s at a load of 30 (other matches and test runs
sharing it). On Wake a Daihatsu (split off its ship) sails 231 m on the
landing-craft map in 60 s under a bot, with a point given by hand. Since
Brief D the SAI sends a craft's helm to a beach (`WPBeachLanding`,
`doctrine-landing.js`) and its crew gets out there: seed 1, 8 a side, 300 s,
a Daihatsu with three riders lands on `SouthLanding` at 143 s and a rider
takes `Landing_Beach` 6.5 s later (features/bf1942-ai-spec/strategic.md §8).

What stays out: the human (the local player, his shots heard), and
everything that is only drawn or heard.

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
| `veh` | `{id, template, seat, drives}` when mounted; `id` is the hull's scene node name on a real level (`sherman_2`) |
| `route` | `{points, failed}` of the followed route |
| `terms` | the winning behaviour's inputs (`moveTo`: `dist`, `radius`, `factor`, `q` = d²/4(R+r)², `shaped`; `scout`: `dir`, `accum`, `quad`; `takeCover`: `danger`, `cover`, `goal`; `special`: `target`, `arrive`; `change`: `best`, `u`, `bail`, `teleport`; `avoid`: `threat`), plus `fire` (`target`, `score`, `weapon`, `dist`, `visible`) whenever a target is held |

`{"k":"ev", "t", "type", ...}` — events:

| type | fields |
|---|---|
| `capture` | `flag`, `from`, `to`, `by`, `alive` (false: a dead bot's position took it, as the page's capture law allows), `veh` (the template he took it in, when mounted) |
| `kill` | `killer`, `killerSide`, `victim`, `victimSide`, `weapon`, `dist`, `pos` |
| `respawn` | `bot`, `side`, `flag`, `pos` |
| `mount` / `dismount` | `bot`, `side`, `vehicle`, `template`, `seat` / `killed`, `driver` |
| `route_failed` | `bot`, `side`, `count` (the bot's `_pathFailures`), `pos`, `goal`, `mounted` |
| `redeploy` | `bot`, `side`, `flag`, `pos` (the 12 s no-progress redeploy) |
| `strategy` | `side`, `from`, `to` |
| `vehicle_destroyed` / `vehicle_respawn` | `vehicle`, `template`; `killer`, `killerSide` (the lethal hit's attacker, the page's `killedBy`; null for a crash or a burn-down) |
| `vehicle_fire` | `bot`, `side`, `vehicle`, `template`, `kind` (`tank`, `ground`, `air`, `ship`, `gun`), `seat`, `gun`: the first pull of a seat's gun in each seating (real level) |
| `takeoff` / `landing` | `bot`, `side`, `vehicle`, `template`, `agl`, `speed`: a bot's aircraft first 10 m over the ground, and back on its wheels |
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
`vehicleKills` (hulls destroyed: `total`, by the killer's side `1` / `2`,
`unattributed`, `byTemplate`), `vehicleFire` (projectiles the bots' seats
fired: `rounds`, `byKind`, `byTemplate`; null on the synthetic level),
`routeFailures` (total and per bot), `redeploys`, `strategyChanges`,
`botErrors`, `behaviourShare` (bot-seconds per active behaviour); `perBot`
(kills, deaths, shots, hits, captures, route failures, redeploys, mounts,
seconds alive and mounted, seconds per behaviour, `vehicleRounds`,
`vehicleKills`, errors and their messages); `trace` (`lines`, `sha256`); `runtime`.

## What the runner adds around the bots

The bots, the world, the nav map, the strategic AI **and the referee** are the
viewer's. `viewer/bot-referee.js` is the one copy of everything a server does
around the bots -- the per-tick bot work (`tick`), the respawn timer, the
rounds (`fireTick`, `resolveShot`, the magazine), damage and death
(`applyDamage`, `damageLanded`), heals, the capture law (`captureTick`,
`nearestEnemyFlag`), the covers, the enemy tables' input (`occupiedUnits`),
a target's description (`unitInfo`), the SAI's unit (`strategicUnit`) and the
seating (`vehicleTick`, `enterVehicle`, `leaveVehicle`, `switchSeat`) --
and `map.html` and `match.mjs` import it (`env.mjs` loads it with the rest).
A change to the referee lands in both.

What the runner hands the referee in place of the page's (`match.mjs
refereeEnv`): the units (on a real level the page's `bot-units.js` from the
stage, a seated bot's hand-weapon hit on his hull billed as the page bills
it; on the synthetic level the stand-ins, `SimVehicles`), an Armor from the
kit's hit points, a round's damage (the page's `botRoundDamage` on a real
level), and a hook per event: each becomes a trace line and a statistic
(`kill`, `respawn`, `redeploy`, `capture`, `mount` / `dismount`,
`strategy`, shots and hits), `tickBot` wraps each bot's tick in the error
catch below, and, on the synthetic level only, `mountedFire` is the
runner's stand-in gun.

A seat swap (`BBPChangeTeleport`) moves the bot within the hull without
stepping out, as the page's does: one `mount` event, no `dismount` (before
the referee was shared the runner left and re-entered, which stood the body
up beside the hull for the tick). Checked when the copy was deleted
(2026-09-23): the synthetic level, 3 a side, seeds 1..3 for 60 s, trace for
trace identical to the copied referee's; El Alamein, 8 a side, seed 3, 120 s,
identical until the first seat swap at 93.67 s and the same summary.

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
- The synthetic level's vehicles (it has no vehicle nodes; a real level
  plays the page's):
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

From the page's vehicles in the runner (2026-09-24, El Alamein and Wake;
all of it is page code, none of it checked live yet):

- **A B17 is destroyed by being taken.** Its parked pose (the body world's
  settle on its springs) is 1.6 m above where the `Aircraft` drive rests it
  on its gear; adopted, it falls, lands at 4.4 m/s, takes 112 of its 128 hit
  points as terrain crash damage, and burns down to a wreck 6 s later. Every
  seed's first vehicle loss is the B17 at 6.17 s.
- **Two Spitfires die together**, the same tick, no round behind it (seeds
  1..3 at 207 to 362 s): the Allied pair flies one order on one flight law.
- **The Sherman's turret Browning points backwards at rest.** Its `Browning`
  FireArms node carries a 180 deg local yaw in the level glb; `bot-aim.js
  aimReference` takes the gun to be the hull's heading plus the rig's
  traverse, so a bot gunner lays its reference on the target and the rounds
  leave the other way (194 rounds, no hit, at 30 m). It is at least part of
  Brief F's "misses a soldier at 40 m".
- **No bot takes a fixed gun.** Every vanilla gun (`AA_Allies`, `Defgun`,
  `Flak_38`, the carriers' AA batteries) has `strategicStrength` `0` at index
  `0`, which is the value `bot-units.js candidates` gives the seat; and the
  flak38 is not listed at all, its AI record being `Flak_38` against the
  node's `flak38`. An AA gun seated by hand fires, but El Alamein's sit in
  sandbag pits whose lip is above the muzzle: a soldier on the flat is out of
  their reach.
- ~~**A landing craft with the SAI's order fails its route every tick** (its
  area is inland), which also makes Wake about three times slower to run.~~
  Fixed by Brief D (the beach orders): the helm gets the beach of its target
  area, or of the first zone user on the way to it.
- **Tanks trade a flag every 10 s.** Seeds 1 and 4 see 29 and 34 captures in
  600 s: a PanzerIV and a Sherman (and in seed 4 a Tiger) sit on North outpost
  and take it from each other every 10 s for minutes, neither killing the
  other (the solo capture law runs a timer per bot, `bot-referee.js
  captureTick`).
