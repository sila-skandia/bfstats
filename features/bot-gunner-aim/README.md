# A bot gunner's aim, and a hull that stays put when boarded (Brief F, 2026-09-24)

Brief F of `features/bf1942-ai-research-2026-09-21/AGENT_BRIEFS.md`, with the
two runner findings the coordinator folded into it (the Sherman's turret
Browning rests facing aft; the B17 moves when it is adopted).

## 1. The gunner's aim

### What the engine does (read from the decompile)

- **The count law.** `mouseControlLookAtDirection` (lnxded `0x08627b90`) takes
  the world direction to aim along and the camera's matrix, and writes two
  look counts:

  ```
  up, right, ahead = dir . camera up, right, forward   (each clamped to [-1, 1])
  shape(c)         = sign(c) log10(9 |c| + 1)
  pitch            = acos(clamp(shape(up)))    - pi/2
  yaw              = acos(clamp(shape(right))) - pi/2
  both |angle| <= tolerance -> both counts 0
  ahead < 0        -> yaw = sign(yaw) pi/2
  Y = clamp(sign(pitchSensitivity) sign(pitch) SCurve(|pitch|) pitchScale, -4, 4)
  X = clamp(sign(rollSensitivity)  sign(yaw)   SCurve(|yaw|)   rollScale,  -4, 4)
  ```

  `SCurve::calculate` `0x08658420` is the 101-entry table `SCurve::init`
  `0x08658030` writes, interpolated at `x * 100` (the `fistl` truncates:
  control word `0xc` at `0x08658457`). The ControlInfo offsets are the console
  setters': `pitchSensitivity` +0x08 (ConsoleClass566 `0x08507670`),
  `rollSensitivity` +0x0c (567 `0x08507a60`), `pitchScale` +0x28 (574
  `0x085095f0`), `rollScale` +0x2c (575 `0x085099e0`), `lookVerticalControl`
  +0x60 (588 `0x0850cd10`), `lookHorizontalControl` +0x64 (589 `0x0850d100`).
  The disassembly confirms the constants (`ds:0x86c08cc` 9.0, `ds:0x86c0304`
  4.0, `ds:0x86e9be0` -4.0) and the `fmuls 0x28(%eax)` at `0x086285ec`.
- **Who calls it.** `EntryMouseTurretAimAt::execute` `0x08619ac0`, with the
  camera from `AIPlayer::getCameraTransformation` and a tolerance of 0.0 (so
  the counts are only zeroed on an exact hit). The direction is the aim
  statement's `getAimVec` (`BAPAAimAtObject::getAimVec` `0x0853b820`); when it
  finds no solution, the straight line (`getVectorToTarget` `0x0853c1e0`).
- **The lead.** `getAimVec` samples the target relative to the muzzle and its
  velocity relative to the shooter's (`Aimer::addTargetSample` `0x085389a0`)
  and asks `Aimer::getFiringDirection` `0x08538ad0` for a direction: a search
  over the elevation, starting on the line to the target, step
  `pi / (60 precision + 5)` with the 0.5 precision `EntryMouseTurretAimAt`
  passes, flight time `h / (v cos a)` to the predicted target's horizontal
  distance, the round's height `v sin a t + g t^2 / 2` against the predicted
  target's, reversing and halving once it has crossed, six halvings. The exit
  velocity and gravity modifier are the AI weapon template's +0x28 / +0x2c
  (`Weapon::getExitVelocity` `0x085ecb50`, `getGravityModifier` `0x085ecb40`),
  gravity the physics system's (`BFEnvironment::getGravity` `0x085e5500`).
  The Aimer's +0 drag term is `pi r^2 drag / mass` of the projectile
  (`WeaponFireArm::init` `0x085ee220`); the viewer passes 0.
- **The trigger.** The ground fire plan is one plan for a soldier and every
  turret (`BBPFireInfantery::createFirePlan` `0x085ac240`); its trigger's
  condition is `BAPCConPrecision` (`evaluate` `0x0854b570`): the target's
  predicted position at the impact time against where a round fired down the
  barrel now is then (`Aimer::getImpactPosition` `0x08539300`). The precision
  is the target's largest extent (at least 1.0) for an air target, else a
  quarter of its three extents (at least 0.4), squared, at least 0.01. A
  burst weapon fires while the miss is inside it; a single-shot one on the
  closest approach (the flag is `burst ^ 1`, `0x085ac9f8`).
- **Read, not ported.** `BAPAAimAt::correctAim` `0x0853a6d0` adds 0.8 times
  the observed miss of the last round to the aim point, and decays the sum by
  0.99 a call after 10 s without a new observation. Its data comes from
  outside the fire callback (`WeaponFireArm::FireCallback::fire` `0x085ee9a0`
  only stamps the time of firing); where the impact is fed back was not found.
  (Found and ported since: the AI collision handler, Brief L below.)

### The per-seat numbers

`extract_vehicle_ai.py` now writes each seat's ControlInfo into
`vehicle-ai.json` (`seatsAi.<seat>.controlInfo`). Across vanilla's 78
ControlInfo plug-ins: 53 carry `pitchScale` / `rollScale` 5.0 (the Sherman's
seats, every aircraft gunner), 18 carry 1.0 (the stationary MGs, AA_Allies,
Flak38 and several light tanks), 3 are hull-turning gun carriages (M3A1,
Priest, Wespe: `lookHorizontalControl PIYaw`), 2 are the Prince of Wales's with
a negative `pitchSensitivity`, the soldier's is 5.0 with its own signs, and the
Defgun's is 0.1.

### What the viewer did, and what changed

The viewer wrote `lookX = -dYaw / 3`, `lookY = -dPitch` (degrees), capped at 4:
a soldier's law (3 and 1 degrees a count) applied to a turret whose servo
turns `count x maxSpeed` deg/s, 90 for the Browning. And it measured the gun
as the hull's heading plus the rig's traverse, which for the Sherman's
Browning (its FireArms node rests turned 180 degrees on its holder) is the
wrong way round; an earlier fix multiplied the counts by the axis's
`direction` to make up for it.

Now (`viewer/bot-aim.js`): a mounted gunner's reference is the barrel itself,
the muzzle node the round leaves from (`barrelFrame`), with a level right
vector; `lookAtCounts` is the law above with the seat's ControlInfo;
`firingDirection` is the Aimer's search; `turretAimAt` leads the target and
writes the counts; `turretMiss` / `precisionFor` / `precisionHolds` are the
trigger's condition, which `bot-plans.js execTrigger` uses for a mounted bot.
A soldier keeps the old law (below, open).

### Verified

Harness (`tests/bot_ai_harness.mjs` `gunnerScenarios`, a real `TurretRig` with
the gun turned 180 degrees on its mount; `tests/test_bot_ai.py
GunnerAimTests`): the Browning (90 deg/s, 5000 deg/s^2) turns from rest onto a
target 35 degrees off and is inside 0.5 degrees after 7 ticks (0.23 s) and
stays inside (largest error 0.49); at 1 s the error is 0.004 degrees. The old
law on the same rig still swings 2.13 degrees in its third second. A 35 deg/s
tower starting 180 degrees away settles in 2.3 s.

Live, El Alamein, `?botCount=8&botSkill=0.75&shots&noaudio&botDebug`, every
other bot frozen far away:

| case | result |
|---|---|
| bot_2 in Sherman_2's `shermanBrowning_PCO1`, a frozen soldier 40 m off (bot_4 frozen at the wheel) | barrel starts 175 deg off (it rests aft); fires at 0.2 s (miss 0.70 m, precision 0.75); inside 0.5 deg from 0.4 s, largest error after 0.44 deg; soldier (30 HP) dead at 0.57 s |
| bot_0 driving Sherman_1 (the tower, 35 deg/s), a frozen soldier 40 m off | tower turns 61 deg; coax fires at 1.4 s; dead at 1.87 s; the hull does not move |
| bot_3 in AA_Allies_1, the human's Spitfire crossing 150 m out, 90 m up, 55 m/s | sees it at about 200 m (the level's 300 m view distance); tracks without swinging, the lead about 13 deg ahead; the miss settles at 24..30 m against a precision of 11.3 m (the Spitfire's span): no round fired |
| the same, head-on, 90 m up, 55 m/s | sees it at 197 m; the miss falls to 11.34 m at 150..170 m and grows as the plane closes: no round fired |
| the same, head-on, 120 m up, 35 m/s | sees it at 190 m; best miss 16.8 m: no round fired |

Item 4 is therefore NOT met. The engine's own law with the AA mount's own
ControlInfo (`pitchScale` / `rollScale` 1.0, a fifth of the Sherman's) is a
proportional pull through the S-curve with no integral: to turn at 7 to 12
deg/s the AA_Allies servo (100 deg/s a count) needs 0.07 to 0.12 counts, which
the law gives at 4 to 6 degrees of error, 15 to 25 m at 200 m. The harness
shows the same (`aa`: best miss 27 m crossing; `aaPass`: a plane still 500 m
out on its approach is inside the precision and draws 22 ticks of fire). What
could close it, both needing more reading: the engine's `correctAim` feedback
(which needs rounds fired first), and whether the engine senses an aircraft
beyond the level's view distance (the gunner saw the plane at 200 m of 300).

Headless runner, El Alamein, seed 1, 300 s, before (`9bd1dfc0`, item 2 in)
and after: tanks' rounds 0 -> 84, soldier kills 1 -> 7, vehicles destroyed 2
-> 5, captures 3 -> 6. The traces move from the first tank engagement on,
which is the point.

## 2. A hull that moves when it is boarded

Three disagreements between the parked body and the drive that replaces it on
boarding (`hull-bodies.js adoptDrivenBody`), measured on El Alamein:

1. **The settle missed the decks.** `settlePlacedVehicles` runs before the
   collision index exists (the index bakes each hull where it rests), so a hull
   placed on a drivable deck settled onto the heightfield under it. Sherman_1
   stands on a pad 0.68 m above the terrain: parked at 60.85, it rose through a
   2 m bounce to 61.49 when boarded, because the drive rides decks
   (`surfaceHeight(x, z, axle + DECK_STEP_UP)`). Now `setupVehicleBodies`
   settles every parked hull over a deck again once the collider exists
   (`settleOnDecks`, also on a respawn), and the body world's ground is
   deck-aware (`body-pose.js bodyTerrain` with the collider: a vertex asks for
   the deck within 0.5 m above it, as a wheel does), so a hull left on a bridge
   stays on it too. Sherman_1 now parks at 61.54.
2. **A released drive left its wheels lifted.** A land drive poses each
   `Spring` node by its compression, and the next drive reads its axles off
   those nodes (`collectChassis`). Every boarding after the first started 0.14
   m higher up the hull: Sherman_2 sat at 60.675, 60.539, 60.402 on three
   boardings. `vehicle-instance.js restWheels` puts the wheels back on the pose
   the drive found them in when the last occupant leaves.
3. **A tracked drive met the ground at the drawn wheel's radius** (0.255 m on
   a Sherman) where the parked body meets it at the wheel's col0 probe, vertex
   0 of a spring part's layer (`checkVsTerrain` `0x0825a960`, three or fewer
   vertices test one), 0.304 m under the axle. With the same springs the two
   rest 0.049 m apart. `wheelContactDepths` hands each drive wheel its probe
   depth (`wheel.contactDepth`, used by `tracked-vehicle.js`'s probe); the drawn
   radius still spins the wheel.

And the aircraft: the drive clamps its origin at the ground plus the lowest
wheel mesh's unloaded bottom, the parked body stands on the wheels' springs
sagged under the weight. The B17 rose 0.58 m on the page (42.96 to 43.54, no
damage). `standAircraftWhereParked` takes the parked height over the ground
as the drive's clearance for a plane taken at rest, and takes back the page's
0.2 m lift. The runner's 1.6 m fall onto the Corsair's 1.2 m fallback (Brief I)
did not reproduce on `1183ac12` with the current runner (bot_5 seated in the
B17, seed 1, 40 s: no loss); the same change covers it.

Live, the human boarding and leaving each hull twice (y of the body before,
while seated, after):

| hull | before this change | now |
|---|---|---|
| Sherman_1 (on a pad) | 60.85 -> 61.49 (a 2 m bounce first) | 61.538 -> 61.538 -> 61.538 |
| Sherman_2 | 60.862 -> 60.812, then -0.14 m each re-boarding | 60.862 -> 60.862 -> 60.862 |
| Willy | +0.007 | +0.007 (unchanged) |
| B17 | 42.96 -> 43.54, HP 128 | 42.958 -> 42.958 -> 42.971, HP 128 throughout |

## Open

- **Item 4**: see Brief L below. The AA gunner now fires; it still does not
  hold a 55 m/s crossing plane.
- ~~A soldier still aims with the old count law~~ ported (Brief L, AI-108).
  His trigger is still the tolerance test, not the precision condition.
- ~~The reachability block~~ ported (Brief L, AI-106). Not the Defgun alone:
  45 of the 92 seat ControlInfos limit the camera's yaw.
- **`__plane().place` / `orient` snap the presentation**, which re-captures
  every occupied hull's rig from its drawn pose (`local-look.js
  snapPresentation`). Called every tick from a test, it held a bot gunner's
  barrel on a stale pose for a whole pass; the recipe sets the drive's state
  directly instead. `local-look.js` was left alone.

## Brief L (2026-09-24): the AA gunner's trigger, the correction, the soldier's law

Ledger AI-105..AI-109; `viewer/bot-aim.js`, `bot-sense.js`,
`bot-perception.js`.

### Why the AA gunner never fired

Not the lag alone. The trigger's line test (`bot._lineClear` from the eye to
the target's +1 m) skipped only the bot's own unit, and a seated player's
+1 m is inside his own hull: every line to a plane ended on the plane. With a
Spitfire held still 181 m out the gunner's miss came down to 0.19 m against
the 11.3 m precision and no round left. The sense rays skipped the target's
hull but re-cast past only four of its faces, and a ray into a Spitfire meets
four within 1.4 m. Both fixed (AI-109): the line test skips the firing
target's unit, and re-casts past 32 faces.

### The correction (AI-105)

The writer AI-91 could not find is the AI collision handler: every round a
bot's player fires reaches `BotMain::event_firing` 0x0852cd90, which takes
one round at a time (only once the last is resolved and its miss consumed)
against the predicted target at that moment; `updateBotProjectiles`
0x084650e0 marks it passed at the target's range, `planExecution`
0x085202c0 observes it; a round that strikes anything but the target first is
observed by `event_shotMissed` 0x08526a90; a hit or a burst observes nothing
(a burst leaves the record waiting until the target changes). `correctAim`
0x0853a6d0 then adds 0.8 of the miss to the aim point. The trigger still
measures the barrel against the uncorrected target, so the correction only
helps once rounds are leaving: a gunner that never fires never corrects.

### Live, El Alamein

`?botCount=8&botSkill=0.75&shots&noaudio&botDebug`, the human in Spitfire
(owner 974) on the Allied side, the plane's state set every tick, every bot
but bot_3 frozen far off, bot_3 (Axis) in AA_Allies_1 at (1658, 60, -881).
K's own take (AI-92) did not fire here: on foot 20 to 60 m from the gun with
the plane held in view bot_3 took a Willy 35 m away, then fired his rifle at
the plane; the recipes seat him with `__botMount('bot_3', 'AA_Allies')`.

| recipe | before (line fix off) | now |
|---|---|---|
| held still 181 m out, 90 m up | miss 0.19 m, 0 rounds | 21 rounds in 8 s, first at 1.1 s; 8 observed; 2 flak hits, HP 100 -> 88.9; correction within +-8 m |
| crossing 150 m out, 90 m up, 55 m/s | engaged at 192 m; miss 18..28 m; 0 rounds | engaged at 194 m; 2 rounds at 6.8..7.0 s as the gun swings on (miss 1.0 m), 1 flak hit, HP 100 -> 87.6; then 22..34 m behind, no more; correction after 2 observations (-7.9, -0.8, 1.9) |
| head-on, 90 m up, 55 m/s | engaged at 184 m; best miss 13.8 m at 114 m; 0 rounds | the same: best 14.7 m, 0 rounds |

The plane is first seen at 180..195 m of the 300 m view distance: the far
bands are narrow (mounted 15 and 45 deg) and a plane 90 m up stands 17..27
deg above the level barrel beyond 190 m. The engine senses an aircraft
through the same banded frustum as anything else (AI-107), so this is its own
geometry. Whether the retail AA bot fires at a crossing plane is for the game
itself to say.

### The soldier (AI-108)

A soldier aims and steers through `mouseControlLookAtDirection` with
`SoldierCtrl` (0.4363323 / -0.5235988, scales 5.0). Harness: 35 deg off,
inside 0.5 deg in 15 ticks, no overshoot; a half turn in 27 ticks; a 10 deg
pitch in 45. Every seeded trace changes from the first tick (a steer writes
at most 4 counts, not 16).
