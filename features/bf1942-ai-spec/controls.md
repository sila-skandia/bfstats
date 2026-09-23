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

**Look counts** (`_aimLook`): `lookX = -(yaw error in deg) / 3`, `lookY =
-(pitch error in deg) / 1`, clamped to +-16 (the axis saturation) or +-4 for
an aim (`mouseControlLookAtDirection`'s 4.0 a tick). The world turns a
soldier `3 deg` a yaw count and `1 deg` a pitch count per tick
(`mouse-input.js soldierLookDegrees`, ENGINE gains).

*Example.* A point 30 deg off the facing: a MoveTo steer writes 10 counts
and the soldier faces it after the next world tick; an aim writes 4 a tick
and needs three ticks (12 deg a tick).

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

**Trigger** (`_execTrigger`): while the facing (the turret's for a hull, the
nose for a plane) is within `max(plan tolerance, 5 deg)` of the target's
+1 m and a line from the eye to it is clear, `isFiring` is true for the tick.
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

`bot-vehicle.js tankControl` (`TankControl::controlTowardsDirection`,
AI-45), fed the look-ahead point by `_steerToward`. `angle` is the signed
angle from the hull's heading to the point, `speed` the forward velocity,
`lateral` the sideways one.

**Aligned** (`|angle| <= 30 deg`; 60 deg on a move marked so, never set):

```
wanted   = 20 x (1 - SCurve(slope x 1.0)), at least 2, / (10 |lateral| + 1), at most maxSpeed
throttle = clamp(2 ((wanted - speed) - clamp(speed / (30 |wanted - speed| + 1), +-10)), +-1)
steer    = clamp(angle - clamp(yawRate / (30 |angle| + 1), +-10), +-1)
```

The two slope probes are not built (`slope = 0`, gain 1.0 INVENTION), and
the yaw rate is 0 when the hull's is not known.

*Example.* A Sherman (maxSpeed 16) with the point dead ahead: from rest
`wanted = 16`, throttle `clamp(2 x 16) = 1`; at 12 m/s `2 (4 - 12/121) = 7.8
-> 1`; at 15.5 m/s `2 (0.5 - 15.5/16) = -0.94`: the hull settles near 15.3
m/s. A point 20 deg to the right at 8 m/s: throttle 1, steer -0.349.

**Turn first** (outside the limit, `turnTowardsDirection`, AI-47): full lock
toward the point (`steer = +-1`), throttle 1.0 while `speed <= min(1, angle² x
0.3)`, else 0.4; a point near dead astern keeps the last turn direction
while `|angle| > 150 deg` (INVENTION, stops the flip across the seam).

**The box test** (`driveDecision`, `actionStatusDecision` mode 0, AI-53):
for a point behind the beam (`forward . dir < 0`), reverse toward it when
the free run along the heading on the vehicle map (up to `2 turnRadius + 1`)
is at most `turnRadius`, `|angle| > 72 deg` (1.2566) and the free box around
the hull is at least `0.5 turnRadius` across; the angle is then flipped by pi
and the throttle's sign reversed. Modes 2..5 are not built.

*Example.* Point at 160 deg (2.8 rad), turnRadius 5, free run 3 m, box 6 m:
reverse, angle `pi - 2.8 = 0.34`. With a free run of 12 m it turns instead:
full lock, throttle 1.0 from rest, 0.4 once past 1 m/s.

`c_PIYaw` takes the steer as is (`VEHICLE_YAW_SIGN = 1`, calibrated on the
Kubelwagen). Arrival inside the move's radius stops the hull. After a failed
route a hull backs out at full reverse and opposite lock for 2 s (INVENTION).

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
no turn is made; the flag sets at 50 m up and half the top speed and clears
on the ground (the clearing rule is INVENTION: where the engine clears it is
not read). Arrival: `4 x radius` (10 m radius for an aircraft, INVENTION).
The waypoint clearance is **120 m (INVENTION)**: the order's altitude is not
read.

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

`boatControl` (`BoatControl::towardsDirection` / `speedControl`, AI-49),
routed on the water map when there is one, else a straight line:

```
steer    = sign(angle) past 30 deg, else angle / 30 deg (UNSOURCED); |steer| < 0.03 -> 0
throttle = 1 within cos 0.996 (5.1 deg); else 0.5 past 30 deg, 0.8 between (UNSOURCED)
arrived  = inside 4 x radius: throttle -0.5 above 3 m/s, else 0
```

*Example.* 40 deg off: full rudder, throttle 0.5; 11.5 deg off: rudder -0.38,
throttle 0.8; 3 deg off: rudder -0.1, throttle 1.
