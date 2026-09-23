# Control laws

Everything a bot does leaves as one input word through `World.setInput`
(`bot.js _writeInput`), consumed by the world's next 30 Hz tick exactly as a
human's is.

## The word

| field | on foot | ground vehicle | aircraft |
|---|---|---|---|
| `forward` | 1 inside the steering cone, 0.5 crouched, else 0 | throttle -1..1 | 0 |
| `strafe` | 0 (a bot never strafes) | steer (`c_PIYaw`) | 0 |
| `walk` / `crouch` / `prone` | the stance input | | |
| `fire` | `isFiring` | the hull's trigger | the guns |
| look `x`, `y` | mouse counts (yaw, pitch) | the turret | |
| `forwardKeys`, `rudder`, `roll`, `pitch`, `pad` | | | throttle ramp, yaw, roll, pitch stick |

**Look counts** (`_aimLook`), on foot: the engine's count law
(`mouseControlLookAtDirection`, Mounted guns below) with the soldier's own
ControlInfo (`SoldierCtrl`: sensitivities 0.4363323 / -0.5235988, scales 5.0;
AI-108), the camera the look yaw and pitch with a level right. A MoveTo steer
(`infanteryControlTowardsDirection`) and an aim go through it alike, each
count at most 4. A null wanted pitch leaves the pitch count at 0. The world
turns a soldier `3 deg` a yaw count and `1 deg` a pitch count per tick
(`mouse-input.js soldierLookDegrees`, ENGINE gains).

*Example.* A point 30 deg off the facing: 4 counts, 12 deg this tick; at 18
deg off 3.7 counts (11.2 deg); at 6 deg 0.63 (1.9 deg); the soldier is inside 0.5
deg after 15 ticks (35 deg start) and never swings past. The old law wrote
10 counts and faced it after one tick. A point 10 deg above: 1.6 counts
(1.6 deg) the first tick, inside 0.5 deg after 45 ticks.

## Infantry

**Steering** (`_steerToward`, `infanteryControlTowardsDirection`, AI-31):
look toward the point (`_aimLook(bearing, 0)`, up to 16 counts); throttle
only when the bearing is within **31.5 deg** (0.5497787 rad) of the facing;
never strafe. A point behind turns at the full rate.

*Example.* A route point 20 deg off: full throttle and a 20 deg turn this
tick. 45 deg off: no throttle this tick, a 45 deg turn, full throttle the
next.

**Pose**: `SoldierPose` sets the stance input; the world's soldier owns the
transition.

**Trigger** (`_execTrigger`): while the facing (the nose for a plane) is
within `max(plan tolerance, 5 deg)` of the target's +1 m and a line from the
eye to it is clear, `isFiring` is true for the tick. A mounted gunner's is the
precision condition (Mounted guns, below).
The page fires at the held weapon's `roundOfFire` while it is (PAGE
`botFireTick`), from its magazine (size, spare magazines, reload time).

**The shot** (PAGE `resolveBotShot`, INVENTION of the hit test): one round a
cooldown from the bot's eye along its facing, rolled into the deviation cone
(`theta = spread x sqrt(u)`, azimuth uniform, `spread` the cone's half-angle),
against every enemy soldier as a vertical 0.6 m capsule at +1.0 m, within
600 m, the terrain in between tested; the nearest hit takes the projectile's
`damage.json` material damage x the attacker / soldier modifier. The engine
flies a real projectile against a soldier body the viewer's collider does not
carry.

**Deviation** (`deviation.js`): the held weapon's own channels (`setMinDev`,
fire, speed, turn, misc: `HandFireArms::updateDeviation` at 30 Hz, rebuilt on
a weapon change) plus the AI term (AI-16, AI-17):

```
AI = (1 - 0.75 A) C + dev x ( max(0, T (1 - A) - (now - B)) / T + 0.25 (1 - A) )
A  = botSkill (0.75 default)          dev = weaponTemplate.deviation (5.0 default)
T  = deviationCorrectionTime (10.0)   B = firingTargetTime (set when the target changes)
C  = 0 (never passed)
```

Research disagreement on `C`: AI-18 (2026-09-21, two readers) reads an
anti-aircraft penalty keyed on the shooter's equipment and an `ITAir` target
(0 / 10 / 30); AI-36 and bot-behaviours §3 (2026-09-23, later) read 0 against
infantry, 30 against a vehicle, 10 for a primary or occupied one (3 / 1 for
the continuous entry). Both give 0 for infantry against infantry, which is
all the code does. The engine adds the term once per trigger pull (it is
consumed by the next deviation update, AI-19); the viewer recomputes it every
tick and holds it.

*Example.* A K98 (min 0.25 deg) at skill 0.75: the AI term is `5 x (2.5 / 10 +
0.0625) = 1.5625` deg at acquisition, `1.0625` a second later, `0.3125` from
2.5 s on; the cone is 1.81 deg falling to 0.56 deg. At 100 m the settled cone
has a 0.98 m radius and the roll is uniform over its disc, so `(0.6 /
0.98)² = 37 %` of rounds pass within a capsule's 0.6 m of the aim point.
Skill 0.25: 4.69 at acquisition; 1.0: 0.

## Tank and car

`EntryTankMoveTo::execute` 0x08622e80 per tick: inside the move's radius
`TankControl::resetControls` 0x0862dca0 zeroes the controls; otherwise
`actionStatusDecision` (below) gives `drive` (+1 ahead, -1 reverse, 0 turn
in place), `angle` and the motion's `sign`, and `bot-vehicle.js tankControl`
(`TankControl::controlTowardsDirection` 0x0862c670, AI-45 / AI-86) turns
them into throttle and steer. `speed` is the hull's speed `|v|`,
`rollRate` its rotational speed about its heading.

First, while `drive != 0` and `sign != drive`, the angle is negated
(0x0862c9ae..0x0862c9c2). Then:

**Aligned** (`drive != 0` and `|angle| <= 30 deg`; 60 deg on a move marked
so, never set):

```
wanted   = 20 x (1 - SCurve(slope x 1.0)), at least 2, / (10 |rollRate| + 1), at most maxSpeed
delta    = drive x wanted - speed
throttle = clamp(2 (delta - clamp(speed / (30 |delta| + 1), +-10)), +-1)
steer    = clamp(angle - clamp(yawRate / (30 |angle| + 1), +-10), +-1)
```

The two slope probes are not built (`slope = 0`, gain 1.0 INVENTION).

*Example.* A Sherman (maxSpeed 16) with the point dead ahead: from rest
`wanted = 16`, throttle `clamp(2 x 16) = 1`; at 12 m/s `2 (4 - 12/121) = 7.8
-> 1`; at 15.5 m/s `2 (0.5 - 15.5/16) = -0.94`: the hull settles near 15.3
m/s. Rolling at 1 rad/s at 3 m/s the wanted speed is `20 / 11 = 1.8`: throttle
-1. A reverse drive wants `-wanted - speed < 0`: full reverse.

**The tail** (`drive == 0`, or outside the limit; 0x0862cad8..0x0862cc3b):
full lock toward the angle (`steer = sign(angle)`), throttle `drive` (1 for a
`drive` of 0) at or under 2 m/s, none above. `turnTowardsDirection`
0x0862d630 (the 1.0 / 0.4 tweak throttles) is `EntryTankTurnTo`'s (0x086253fc)
and never runs in a move.

`c_PIYaw` takes the steer as is (`VEHICLE_YAW_SIGN = 1`, calibrated on the
Kubelwagen).

### The turn in the box (`actionStatusDecision`)

`CommonControls::actionStatusDecision` 0x0860fbe0 (AI-85), a state machine
on the move (`BAPAMoveTo` +0x60, 0 for a new move), in the engine's x/z
frame. `dot = forward . dir` (the heading's x/z, not normalised), `side =
asin(n . dir)` with `n` the heading's normal `(z, -x)`, `full` the full
angle `sign(side) pi - side` for a point behind the beam. The box is the
pathfinder's (`getBox` 0x08612060 -> `AIPathfinding::getBox` 0x0847d140 ->
`AStarLocalSearch::getSearchBox` 0x085f4180): at the free quadtree level
`L` (at most the map's `maxLevel`) of the hull's cell (from the last cell it stood valid on when it stands
on a blocked one), the `2^L` block grown a block at a time on +z, +x, -z, -x
in turn from each of the four starting sides (32 tries each), the largest
kept and **widened by one block on every side**. A **run** is the line from
the hull to the box's edge (`getIntersection` 0x08612210, from the box's own
point) cut at the first potential obstacle (`checkLineAgainstObjects`
0x0860f7c0 over `BotMain::getPotentialObstacles`, bot vtable +0x124), and
fails when shorter than the hull's radius. `R` is the turn radius
(`aiTemplatePlugIn.turnRadius`, Mobile template +0xc), `r` the hull's
bounding radius.

| state | while | returns | leaves to |
|---|---|---|---|
| 0 plain | point ahead of the beam | drive, `side` | stays |
| 0 plain | behind: run ahead > R | turn, `full` | 9 |
| 0 plain | behind: run ahead <= R, `abs(side) > 72 deg`, short box side >= R/2 | turn, `full` | 7 if the hit point and the hull straddle the box centre, else 4 or 2 (the hit point mirrored in x or z, whichever lies nearer the hull's beam line) |
| 0 plain | behind, otherwise (no box, no run) | turn, `full` | 8 |
| 1 | (never set) | nothing | stays |
| 2 / 4 | run along the point, mirrored point `M`, `u = (M - heading) / abs(M - heading)²` (as compiled): `u . heading > 0`, half-diagonal² < reach², `(sign speed + 1)² < reach²` with `reach² = run² + min(R²/4, abs(u)^-2)` | drive, `asin(n . u)` | 3 / 5 when the test fails |
| 3 / 5 | box diagonal² <= reach², `(sign speed + 1)² <= reach²` | reverse, `-asin(n . w)` along the box centre's line | 0 |
| 6 / 7 | the box centre less the hit point turned -45 / +45 deg lies astern, `(sign speed + 1)² <= reach²` | reverse, toward it | 0 |
| 8 | point behind or 30 deg off, run ahead < R, run astern > 1.1 r | reverse, `-side` | 0 |
| 9 | run along the motion > R | drive, `full` | 0 |

States 2..8 also hold only while the point is behind the beam or at least
30 deg off the nose; a state that lets go returns a turn in place with
`full`. Checked against
the function's own machine code in the x87 emulator
(`features/bf1942-engine-reference/lnxded/action_status_emu.py`): 150 cases
over all 25 reachable transitions, in `tests/fixtures/action_status_cases.json`
(`test_bot_ai.py test_the_turn_in_the_box_answers_as_the_binary_does`). 0 ->
6 is unreachable (state 0 takes 7 whenever the point is behind).

*Example.* A Sherman (R 5, r 3) nose-on to a wall 3 m ahead, the point dead
astern: state 8 (turn), then 8 again with `drive -1`: it backs straight out
until the run ahead passes 5 m, then 0 -> 9 and it turns ahead. Live on
Bocage (AI-85) a Sherman driven nose-first into a wall backed 2.2 m while
turning 61 deg, then turned and drove 38 m to its point.

A hull that has never stood on a valid cell has no box: `getBox`
0x08612060 asks the hull's `getValidPosition` (0x085eab10 -> 0x085d5bb0)
when its own cell fails and returns false when the hull has none, so the
state machine takes its no-box rows (0 with the point behind -> 8, and 8
turns in place). The level's own maps paint such spawns (El Alamein's
`Tank0`: the Shermans at (1731, -804) and (888, -1822), three Willys), and
the viewer's hull now starts there the engine's way (AI-103; the
nearest-free-cell stand-in is gone). The last valid position is the hull's,
kept on its node, not the driver's. The box's top level is the map's own
`maxLevel` (`getLandLevel` 0x085f3f90 from the `Vehicle`'s +0xc4a8, copied
from `LocalMap` +0x28 by `Vehicle::Vehicle` 0x0860b2c0): 2 on `Tank0`, a 4 m
block, so a tank's box grows in 4 m steps; 5 on the water maps.

## Mounted guns

A bot in a gun seat (a turret, a hull MG, an AA mount; not an aircraft's
nose guns) aims the engine's way (`bot-aim.js`, AI-88..AI-91):

**The reference** is the barrel: the chosen weapon's muzzle node (the one the
round leaves from), its `-z` the forward, right level (`barrelFrame`). A gun
whose node is turned on its mount is aimed by where it points; the Sherman's
turret Browning rests facing aft.

**The direction** is the lead (`firingDirection`, `Aimer::getFiringDirection`):
the target point (its +1 m) relative to the muzzle, its velocity relative to
the gunner's hull, the round's exit velocity and gravity; an elevation search
that drops the round onto the predicted target (6 halvings of a `pi / 35`
step), the bearing of the predicted position. No solution: the straight line.

**The counts** (`lookAtCounts`, `mouseControlLookAtDirection`; the soldier's
too, with his own ControlInfo): the direction's
up and right components in the barrel's frame, each shaped `sign(c) log10(9
abs(c) + 1)` and turned into an angle (`asin` of it, sign flipped), through the
S-curve table, times the seat's `pitchScale` / `rollScale`, signed by its
sensitivities, clamped to +-4; a target behind turns at the S-curve of 90 deg.
The servo turns `count x maxSpeed` deg/s, so the pull shrinks with the error
and the aim settles. Written to `lookY` / `lookX` as a human's mouse would be.

**The yaw window** (`seatYawWindow`, AI-106): a seat whose ControlInfo
limits the camera's yaw (`setCameraRelativeMin/MaxRotationDeg` x; 45 of
vanilla's 92 seat ControlInfos, from +-15 to +-120 deg) takes the target's
angle from the camera's base (the rig's traverse plus the target's angle off
the barrel): past the window both counts are 0, unless the long way round
reaches it, when the turn is the full rate that way. A zero-wide window (the
M3A1, Priest and Wespe, whose look turns the hull) is not applied
(INVENTION).

**The correction** (`trackOwnRounds`, `correctAim`, AI-105): the bot
watches one of its rounds at a time, against the predicted target at the
moment it left (the aim's point, frozen from the first round not taken until
the next take). Once the round has flown the target's horizontal range it is
observed; a round that strikes anything but the target first is observed
where it was; a hit on the target or a burst observes nothing (a burst leaves
the record waiting until the target changes). The next aim adds `0.8 x
(target - the round abreast of it)` to the aim point (a short round: `0.1 x`
its shortfall, upward) and the correction then decays by 0.99 a tick after
10 s without a round. The trigger still measures the barrel against the
uncorrected target. A mounted gunner only: a soldier's round is the page's
hit scan.

*Example.* A Sherman gunner (scale 5.0), target 5 deg to the right and level:
`right = sin 5 deg = 0.087`, shaped 0.252, angle 0.254 rad, S-curve 0.089, X
= 0.45 counts: the 90 deg/s Browning turns 41 deg/s, 1.4 deg this tick. At
1 deg: 0.048 counts, 0.15 deg a tick. From rest 35 deg off it is inside 0.5
deg in 7 ticks.

**The trigger** (`precisionHolds`, `BAPCConPrecision`): the miss is the
predicted target at the lead's flight time against where a round fired down
the barrel now is then (`turretMiss`); the precision is the target's largest
extent (at least 1 m) for a player in an aircraft, else a quarter of its box's
three extents (at least 0.4 m; a soldier's 0.75 m). A burst weapon fires while
the miss is inside it; a single-shot one waits for the miss to stop falling
and fires then if its smallest value was inside.

*Example.* A soldier 40 m from the Browning: fire at 0.2 s (miss 0.70 m),
dead at 0.57 s. An AA mount (scale 1.0) against a Spitfire crossing 150 m
out at 55 m/s: two rounds as the gun swings onto it (one flak hit), then a
lag of 4 to 6 deg, a 22 to 34 m miss against 11.3 m, no more fire. Held 181
m out: 21 rounds in 8 s, two flak hits (AI-109: until then the line to a
plane ended on the plane and no gunner ever fired at one).

## Aircraft

`bot-vehicle-air.js`, the engine's law (AI-60), verified against an x87
emulation of `PlaneControl::towardsDirection`.

**`towardsDirectionEngine(dir)`** in the engine frame, with `F`, `R`, `U` the
airframe's forward, right, up rows and `w` its angular velocity:

```
Rh = norm(Y x F), Fh = Rh x Y, Ul = F x Rh
behind = D.F < 0 or D.Fh < 0
s      = clamp(climbDemand / clearance, 0, 1)
k      = ((e^(2.3025851 (1 - clamp(v / 43))) - 1) / 9) x -0.833 + 0.333, clamped to [-1, maxClimb 0.3333]
limit  = from k and Ul.y / F.y (the nose's climb limit)
up     = min(Ul.D, limit)(1 - s) + s
side   = D.Rh (its sign when behind; 0 while taking off)
dive guard: up < 0, F.D > 0.9, side < 0.1:  up = -clamp(max(0.3, log10(1 - 18 up)))
nose over the limit (F.y > k):              up = min(up, -log10(9 (F.y - k) + 1))
P = clamp(clamp(w.Rh) + up),  Y = clamp(side - 0.1 clamp(w.Ul))
yaw   = (R.Rh) Y + (R.Ul) P
pitch = -((U.Rh) Y + (U.Ul) P)
roll  = 0.5 clamp(w.F) + bank + clamp(Y ((1 - P) / 0.134 when P >= 0.866), +-maxRoll 0.9999)
throttle = max(floor, s);  each stick written as sign(v) log10(9 |v| + 1)
```

*Example.* The climb limit `k` from the airspeed: -0.5 standing, -0.12 at 10
m/s, 0.11 at 20, 0.24 at 30, 0.333 from 43 m/s: a plane cannot raise its nose
until about 23 m/s, which is what makes the takeoff run tail-up. The stick
shape turns 0.05 into 0.16, 0.25 into 0.51, 0.5 into 0.74.

**`towardsPoint`** (moves): within 100 m horizontally of the point, the
wanted height is lifted toward `max(ground or water + clearance, own height)`
by `0.0001 d²`; the altitude probe runs 100 m along the velocity (and level,
when diving steeply); `climbDemand = clearance - altitude`, throttle floor 1,
no dive guard. Before the **airborne flag** the wanted height is 200 m and
no turn is made; the flag sets at 50 m up and half the top speed and is
cleared only when the bot's controlled object changes (a mount or a
dismount; a landed plane keeps it, AI-71). Arrival: `4 x radius` (10 m
radius for an aircraft, INVENTION). An order's move uses the order's
clearance, **50 m** from the air order (`WPAltitudeMoveTo` +0x14, AI-71);
`PLANE.cruiseClearance` (50) stands in when a waypoint carries none.

**`aimAtDirection`** (the guns): two 50 m probes along the velocity and its
level part, `climbDemand = max(2 (clearance - h1), 2 (clearance - h2))`,
clearance 75 m (50 m for mode 1), the dive guard on, and before the airborne
flag the wanted direction's y is 0.3333 with no turn.

**Throttle**: the world's aircraft throttle latches and ramps (`forwardKeys`),
so the bot writes +1 / -1 / 0 toward the law's throttle (`power`).

### The attack loop

`attackRunStep` (`BBPFire3d`, AI-56, AI-61), per tick, `state.phase`:

- **mode** by target (`planeFireMode`): a soldier 0 (precision `max(0.5, 0.8
  x largest extent)`), a vehicle 1 (`max(5, mean extent)`), a large one 2
  (`max(10, mean extent)`), an immobile one 3.
- `approach -> attack` inside `0.9 maxRange` with a line of fire (the memory
  record is seen now; no ray) and, for modes 1 / 2, the target past 10 m
  along the nose (`ObjectInFront`, a half-space, not a cone).
- `attack -> break` (modes 1 / 2) once inside `1.3 turnRadius` or no longer
  in front; `attack -> approach` beyond `0.9 maxRange` or on losing sight.
- `break -> approach` after 200 m of travel.
- **fire** in `attack` when `d <= maxRange` and the round's miss is at most
  `max(0.1, precision)`: the round fired now along the barrel versus the
  target's predicted position at the lead time (`roundMiss`, the relative
  velocity, drop taken out).
- flying: approach and break are `towardsPoint` with a 50 m clearance (the
  break 200 m along the heading), attack is `aimAtDirection` along the lead;
  closer than 200 m to the map edge the plane flies to the centre at 200 m.
- **end**: the target destroyed or gone, the magazine dry.

*Example.* A soldier at 200 m, guns at 800 m/s: precision `0.8 x 1.8 =
1.44 m`; a nose 2 deg off misses by 6.5 m: no fire. The first reads of this
gate had a 10 deg cone and never fired live; the corrected gate killed a
soldier 260 m down the runway (PARITY_STATUS session 2).

**Idle** in the air: a persistent `MoveTo3d` to its own position (an orbit).

## Boat

`boatControl` (`BoatControl::towardsDirection` 0x0860df70, AI-49 / AI-73 /
AI-85), routed on the water map when there is one: `actionStatusDecision`
(the tank's, on the water map at its base level 2) then `speedControl`
0x0860cf40. When `drive == 0`, or in state 0 with the angle past 30 deg, it
turns (full rudder toward the point, flipped astern; above 3 m/s the
throttle against the motion, at or below it the motion's sign). Otherwise it
is underway on the decision's angle (negated when the motion's sign differs
from the drive), wanting `drive x maxSpeed x` the open-water factor
(`boatSpeedControl`, KNOBS).

**Arrival** (`EntryBoatMoveTo::execute` 0x08613d60 inside the move's radius,
`BoatControl::resetControls` 0x0860dff0, AI-87): the rudder zeroed; `v` the
speed along the heading; above 1 m/s `throttle = -sign(v) log10(9 |v| + 1)`
(clamped to +-1) and the move is not done; at or under 1 m/s the throttle is
zeroed and the move completes. A craft at 15 m/s brakes at full reverse from
the radius on and needs about 40 m to stop in the viewer.

Without a water map a ship holds a straight line (`execBoatMoveTo`, the
older helm: full rudder past 30 deg, throttle 1 / 0.8 / 0.5, UNSOURCED).
