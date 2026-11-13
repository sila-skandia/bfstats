# Hull steering: why bot-driven land vehicles stood still on the Pegasus levels (2026-11-11)

Sections 18.5, 18.8 and 19 of the README measured "hull stuck" (a driver
with the throttle on whose hull moves under 2 m in 10 s, `sim/detect.mjs
vehicleFigures`) at 21 to 28 s of every driving minute on FH's and FHSW's
Pegasus against DICE's 0.5 to 0.9, and `seat-behaviour.md` 2.4 saw FHSW's
hulls "pinned in reverse-turn states" (8 and 9) without saying why. This
note finds what those hulls were doing, fixes it, and gives the figures
before and after.

Tools (scratch, not in the repo): `stuck.mjs` (every hull-stuck episode of a
trace by `detect.mjs`'s own rule, with the driver's `actionStatusDecision`
states, pedal, plan, route and nearest hull over it), `mapat.mjs` (the baked
`Tank0` map around a point), `stopped.mjs` (seconds a driver in MoveTo sat
with its throttle off and no live route, which the hull-stuck detector
cannot see), `boot.py` (a bootstrap of a pooled median's change), an
env-gated probe printed from `bot-route.js` while debugging (removed), and
per-tick reads of the trace's `drv` block (`sim/match.mjs`: state, drive,
angle, steering point, speed).

In short: five causes, five fixes, all in `viewer/bot-route.js` and
`viewer/nav-search.js`, all INVENTION around the engine's own
`actionStatusDecision` and driving law, which are unchanged. Hull-stuck
time on the two Pegasus levels falls from 20 to 25 s a driving minute to
1 to 2 (section 4); DICE's four levels move inside their seed spread; on
foot nothing moves.

## 1. Where the stuck time is

Seed 1, 600 s, garrison doctrine, both levels at 8 and 16 a side, every
tick traced:

| Level, side size | hull stuck s a driving minute | episodes | of it the RedTractor in its spawn pocket |
|---|---|---|---|
| FH Pegasus, 8 | 9.41 | 3 | 115.8 of 115.8 s |
| FH Pegasus, 16 | 27.96 | 4 | 557.7 of 557.7 s |
| FHSW Pegasus, 8 | 25.19 | 1 | 578.0 of 578.0 s |
| FHSW Pegasus, 16 | 19.42 | 1 | 578.0 of 578.0 s |

Over the ten-seed matrix (section 4) the same pocket, the 4 m cells
`500,-600` and `504,-600`, holds all of FHSW's and 95 % or more of FH's;
the rest on FH is a PanzerIVH in the streets by Cafe Gondree (79 s in one
match of twenty) and a CivCpeRust in Benouville (21 and 37 s).

FHSW's Pegasus places one drivable land hull, FH's a few more (a PanzerIVH,
an Opelblitz, a CivCpeRust). The one that holds the time is the
RedTractor of the `traktorspawner` at (502.1, -598.6), turned -90 deg so its
nose points west into a pocket of the vehicle map 7 m long and 6 to 7 m
wide, closed on three sides (`mapat.mjs`, FHSW's `Tank0`, `@` the tractor,
`A` its first route point, `#` blocked):

```
  -600 .............############....................
  -599 .............###........................A....
  -598 .............####.....@......................
  -597 .............####............................
  ...
  -593 .............####.#####......................
  -591 .............###################.............
```

Its first order is east (Cafe Gondree or the bridge, both behind it), so
the route's first point lies 18 m astern.

## 2. Causes

### 2.1 The turn in the box shuffles the tractor across its own threshold, and the count never saw it (fixed)

The driver's states and pedal, every half second, FHSW 16 a side seed 1
(`drv.st`, `ctl[0]`, the speed, `stall` the obstruction count):

```
 24.97 500.74,-599.05 ctl  1 st 9 v 0.04 stall  8
 25.97 500.73,-599.05 ctl  1 st 9 v 0    stall 38
 26.97 500.57,-599.11 ctl  1 st 9 v 0.72 stall 68
 27.47 500.42,-599.18 ctl -1 st 8 v 0    stall  0
 28.97 500.42,-599.18 ctl -1 st 8 v 0.05 stall  0
 29.47 500.61,-599.10 ctl  1 st 9 v 0.29 stall  3
 ...   (the same for 578 s)
```

What it is, one piece at a time:

- **Not a wall.** The drive's own hull contacts (`drive.hullContacts`,
  read every half second in a 32 s run) are empty the whole time, so
  `trackHullContact` has nothing to plant on. The hull is not pressed on
  anything; it is not moving because of its pedal.
- **The state machine's threshold.** Facing west with the point dead
  astern, state 0 asks for the run ahead to the box's edge: the box
  (`searchBox`, the 4 m blocks of `Tank0`'s level 2, widened by a block) is
  a strip `[496, 624] x [592, 604]` and the run ahead from x 500.7 is about
  4.9 m against the tractor's `turnRadius` of 5. Under 5 it takes state 8
  (back straight out while the run ahead is under R); a few centimetres
  back the run passes 5, state 8 lets go, state 0 takes state 9 (drive
  ahead on full lock while the run along the motion beats R), and a few
  centimetres forward the run is under 5 again. It is
  `CommonControls::actionStatusDecision` 0x0860fbe0 as read (AI-85, the
  150 emulator cases), with no hysteresis.
- **The pedal reversal.** Each change of state reverses the pedal. The
  wheeled drivetrain brakes until its revs cross zero (TANK-12,
  `wheeled-vehicle.js`), a second or more, so the tractor covers a few
  centimetres a phase and its heading hardly changes: it never turns.
- **The count.** `trackObstruction` counted a tick as stalled when the
  throttle was above 0.1, forward only (the viewer's INVENTION beside the
  engine's no-visible-point rule). Every state 8 tick has the pedal at -1,
  so the count went back to 0 two seconds in four: it never reached the
  obstructed flag (151 ticks) or the path failure (401), and the escape the
  viewer has for a held hull (a circle planted on it, the route rebuilt
  from a back-out point, `onHullObstructed` and `ensureRoute`) never ran.
  On FH the tractor got out three times in a match when its plan changed
  for other reasons (a new goal, a route failed elsewhere); on FHSW it
  never did.

**Fix** (`viewer/bot-route.js`, INVENTION, as the rule it corrects is): a
hull's throttle counts either way (`Math.abs`), a soldier's is unchanged
(theirs is never negative, so their traces are byte for byte the same). And the circle `onHullObstructed` plants goes at the end of the
hull its map gives the shorter run (`freeRun` ahead and astern, to 4 R),
not the end the pedal pointed at on the flag's tick: the flag can fall in
either half of the shuffle, and a circle astern of a hull nosed into a
pocket backs it further in. On open ground the two runs are equal and the
pedal still decides, as before (`test_bot_hull_wedge.py` unchanged).

After it, FHSW 8 a side seed 1: the count reaches 151 at 30 s, the circle
goes ahead (in the pocket), state 8 backs the tractor out 5 m to where the
run ahead clears the circle, and it is driving east at 4.4 m/s by 54 s.
With this fix alone (FH's matrix, stopped at 16 of 20 matches when cause
2 turned up) the median fell from 21.5 to 1.01 s a driving minute at 8 a
side (ten seeds) and from 25.4 to 4.87 at 16 (six); seed 1 at 8 a side
kept 534 s, which is cause 2.

Why not a hysteresis in state 8 (keep backing until the run ahead beats R
by a margin)? It would change the engine's checked machine for every hull
on every level; the count is the viewer's own invention already, and
fixing it to its own words is the smaller change.

### 2.2 Out of the pocket, the tractor pressed on a wall it bounced on (fixed)

With 2.1 fixed, FH 8 a side seed 1 still held 534 s, in one place a few
metres from the pocket's mouth. The trace (one tick a second):

```
 37.03 503.41,-599.94 yaw -3.110 ctl 1 st 2 drive 1 ang  0.0009 v 0.44 stall 17
 38.03 503.54,-599.88 yaw -2.973 ctl 1 st 2 drive 1 ang  0.0010 v 0.97 stall  1
 48.03 503.47,-599.85 yaw -3.011 ctl 1 st 2 drive 1 ang -0.0009 v 1.69 stall  0
 55.03 503.50,-599.98 yaw -3.003 ctl 1 st 2 drive 1 ang  0.0009 v 0.79 stall 30
 ...   (state 2, full throttle, for 342 s, then 180 s more after a re-plan)
```

- **Where.** The hull's centre is at z -599.9, on the last free row of the
  paint; the row at -600 is the block north of the pocket (x 493 to 504).
  It faces north (yaw -3.0) with its nose in that block: the paint says
  its centre may stand there, its body says the wall is 0.5 m ahead.
- **The state.** State 2 (the box turn: drive at the mirrored point, here
  dead ahead, angle 0.001) with full throttle. The run along the move's
  direction and the box hold its test true; nothing in the decision sees
  the wall, which is not on the map.
- **The speed.** The body bounces on the wall: its speed reads 0.4 to 2.0
  m/s, never under 1.0 m/s for long, while it covers no ground. The
  obstruction count wants under 1.0 m/s and was zeroed every second or
  two (`stall` 17, 1, 0, 30); the touch rule (`trackHullContact`) wants
  the same for ten ticks running and never held either.

**Fix** (`viewer/bot-route.js hullTravelSpeed`, INVENTION): the count and
the touch rule read, for a driven hull, the lower of its speed now and the
ground it covered over the last second. It is the soldier's rule already
(`travelSpeed`: "a body wedged under a ramp read a full run and never
stalled", `execInfantryMoveTo`). Until the window has filled (a new seat,
or a gap while another plan ran) the body's speed stands. With it the same
seed: at 38 s the touch rule plants a circle on the wall, the route backs
out of it, and the tractor is driving north-east at 4.4 m/s by 53 s; the
match has no hull-stuck episode at all.

### 2.3 A wedged hull backed half a metre and drove into the same corner (fixed)

With 2.1 and 2.2, FH's ten-seed matrix still had three to five matches
near 500 s, in new places: the RedTractor at (512.7, -566.1) (seeds 8 and
9 at 8 a side, 1 at 16), a PanzerIVH at (463, -564.5) (seed 7), an
Opelblitz at (352.7, -559.5). A probe that printed the driver's obstacle
circles, route and hull contacts every second (FH 8 a side seed 8):

```
 92 512.73,-566.11 travel 1.93 asd 0 drive 1 obst []
 94 512.43,-566.46 travel 0.25 asd 0 drive 1 contacts [[-0.8,1.4,0.02]]
 95 512.18,-566.56 travel 0.03 thr -1 asd 8 obst [[511.6,-565.0,4.5]] route bo [514.5,-568.5]
 97 512.19,-566.55 travel 0.00 thr  1 asd 0 drive 0 obst [... ,[514.6,-569.8,4.5]] bo [509.5,-569.5]
 ...  (the same to the match's end: a circle more every 13 s, the hull 0.3 m either way)
```

- **Where.** The tractor's front-left corner is on a 3 x 4 m object the
  map does paint (x 510 to 512, z -566 to -563); its centre stands on the
  object's blocked edge cell, so its box is taken at its last valid
  position.
- **The escape runs, and is too short.** With 2.2 the touch rule now
  plants its 4.5 m circle on the contact and fails the route; the route
  starts at its back-out point. That point was the nearest free point
  outside every circle (`resolveClearStart`): with the hull's centre 4.2 m
  from a 4.5 m circle, 0.3 to 1.5 m away. The hull backs to it (state 8,
  a wheeled reverse that takes a second to engage), the point goes once
  the hull stands clear of the circles, which is at once, and the next
  point is ahead.
- **Then the box turns it into the corner.** With the next point behind
  its beam and the run ahead open past the circle the hull now stands just
  outside, `actionStatusDecision` answers state 9 or a turn in place
  (drive 0): full lock and throttle 1, which a wheeled hull makes by
  driving ahead into the object again. The engine's state machine has no
  way to say "back up further first", and the object is the map's, so it
  is the decision as read.

**Fix** (`viewer/bot-route.js`, three parts, INVENTION, extending the
back-out that is one already):

1. The back-out point is sought straight away from the circle that just
   held the hull, a turn radius (the hull's `turnRadius`, 5 m for the
   tractor) off where the map is free, the circles allow and a trace from
   the hull is clear, stepping in to 1 m; the nearest free point is the
   fallback.
2. It goes once the hull is on it or has passed it along the line it
   backed on, not once the hull stands clear of the circles.
3. While the hull steers at its back-out point and that point is behind
   its beam, it reverses straight to it, the tail steered at it the way
   state 8 steers a reverse (`-asin(n . dir)`, `backOutDecision`), and the
   box machine starts again from state 0 after. Every other point is the
   machine's as before.

And `onHullObstructed` reads the travel speed of 2.2 too: the PanzerIVH
of seed 7 drove west into something at (462, -564.5) at 1.6 to 3 m/s by
its velocity while it covered nothing (its count reached 401 every 13 s),
and the flag's circle is planted only on a hull under 1 m/s. What it hit
is not on the map and was not identified; in the traced re-run of the seed
the PanzerIVH had no episode, so this part is not separated from the
others by a trace of its own.

With them (traced, the same seeds): FH 8 a side seed 8 0.41 s a driving
minute (one 10 s episode in the pocket), seed 7 0.42, 16 a side seed 1 0.

### 2.4 A hull walled in by its own circles stood with its throttle off (fixed; found on DICE's Berlin)

The first DICE matrix after 2.3 had Berlin's route failures at 8 a side up
from a median of 0.096 to 0.321 a bot-minute, seed 7 at 4.83 against 0.35.
Traced (seed 7, after 2.3): 709 route failures, 702 of them a seated
bot's, all from (1830, -1870), the Soviet base's T34s; one T34 from 190 s
to the match's end:

```
 190.03 1833.0,-1874.3 ctl 0 st 0 drive 1 v 0 route {points 0, failed true}
 ...    (the same, every route failing, to 600 s)
```

The hull is held, its circles (one a flag, one a touch, now planted more
often by 2.1 and 2.2) ring it, they are dropped only once it is 25.5 m
off (`ageObstacles`), and every search from inside them fails; a hull
with a map and no route stops (`execInfantryMoveTo`). It reads as no hull
stuck at all: the detector wants the throttle on.

**Fix** (`viewer/bot-route.js ensureRoute`, INVENTION): at the second
failed search in a row, the retry drops the circles the hull planted on
itself (`unit` its own); predicted circles and a soldier's stay. The same
seed after it: 13 seated route failures of 181, and the seconds a driver
in MoveTo sits with the throttle off and no live route (`stopped.mjs`,
scratch) 7 against 681, and 48 on the code before any of this.

**The forgetting lasted one tick (fixed 2026-11-13).** Since a driver
predicts still bodies too (AI-178, 2026-11-12), most of a hull's own
circles are predicted ones: `predictObstacles` planted the same body again
on the tick after the retry dropped it, threw the route away, and the next
two searches failed. The hull crept about a third of a metre a cycle.
Bocage, 8 a side with vehicles, seed 1: a Sherman took 60 s and 38 failed
routes to pass one empty hull parked beside its base's exit lane; 243 of
the match's 258 route failures were drivers', 185 of them walled by
circles alone. The bodies
behind the dropped circles now stay forgotten for a potential obstacle's
life (`potentialObstacleMaxAge`, 10 s; `bot._forgotBodies`), and the
prediction leaves them alone until then. Same INVENTION as the forgetting
itself: retail's local search takes the circles as hard restrictions
(`AIPathfinding::localSearch` 0x0847d940 -> `initRestrictedNormal`
0x085f2a10) and fails the path the same way; what it does next was not
read. Bocage seeds 1 to 3 on one snapshot of the tree: 258, 229, 167
before; 93, 116, 189 after. Captures 3, 6, 3 against 3, 5, 6; team kills
4, 1, 0 against 0, 1, 0. Test: `tests/test_bot_hull_shuffle.py`
`test_a_forgotten_body_is_not_planted_again_at_once`.

### 2.5 An order point the hull's map cannot reach left it standing (fixed)

With 2.4, FH's matrix had three matches of ten at 8 a side where a driver
sat 400 to 550 s with its throttle off and no route (`stopped.mjs`; the
hull-stuck detector sees none of it): the RedTractor at (504.9, -600.9)
(seed 3) and at (516, -576) (seed 6), the Opelblitz at (260, -684) (seed
4). A probe on each route request, seed 3:

```
 47.6 from 508.8,-594.0 walkable  goal 390.6,-555.8  coarse 15 legs
 50.5 from 506.5,-597.5 walkable  goal 396.3,-547.4  coarse null
 52.1 ... every 1.5 s to the match's end: coarse null, circles 0
```

The order's point moved 10 m, inside the Cafe Gondree area, and the new
one is in a part of the painted coarse layer (FH's Pegasus ships no
strategic map) that the hull's region does not join: `findStrategicPath`
returns no path, the route stands failed, and a hull with a map and no
route stops. The circles are not it (2.4 had dropped them).

**Fix** (`viewer/nav-search.js findStrategicPath`'s `nearest`, asked by
`bot-route.js ensureRoute` for a driven hull only, INVENTION): when the
goal's region is not reached, the path ends in the reached region nearest
the goal. A soldier's routes and the engine's strategic map (every DICE
level ships one) are unchanged: Berlin 8 a side seed 7 with vehicles is
byte for byte the same trace with and without this part. The same three
seeds after it: stopped 54, 0 and 31 s (were 549, 433, 494); hull stuck
1.97, 0.83, 1.20 s a driving minute.

### 2.6 A street corner the tractor cannot make (not fixed)

Out of its pocket and past the object, another RedTractor stop on FH is
the street from the bridge to Cafe Gondree, where the vehicle map's free
paint is 2 to 5 cells wide and turns 90 deg at (472, -568) (`mapat.mjs`
on FH's `Tank0`). FH 8 a side seed 8, after 2.4: the tractor noses into
the corner, the touch rule backs it out 4 to 5 m down the street, it
drives into the corner again, every 12 s for 80 s or more, 109 s of the
match with its throttle off between route retries. The hull-stuck
detector sees 10 s of it: the retry pauses (1.5 s, throttle off) restart
its 10 s window. The route cuts a corner a 5 m turn radius cannot make in
a street the paint says a hull's centre fits; the fix is the map's (2.7),
or a route search
that knows the hull's turn radius, which the engine's does not
(`AStarLocalSearch` searches cells, AI-30) and which was not tried.

### 2.7 The vehicle map's corridor and the hull (not the page's: the generator's)

The pocket is free paint because FH's and FHSW's generated `Tank0` maps are
painted with a 1.5 m brush (`index.json`), where DICE's levels paint
theirs at 3.0 (Berlin, Stalingrad, Kharkov, Bocage). Free paint is where a
hull's centre may stand; with 1.5 m a 2.2 m wide, 4.4 m long tractor's
nose is at the wall before its centre leaves the paint, and the pocket the
level parks it in is a place it cannot turn in. The README (18.8) chose
1.5 m because 3.0 closes the level's streets. Not changed here (the
generator is not this work's file); what it could do is in section 5.

### 2.8 Hulls blocking each other, and a hull parked on the route

Not seen on these two levels: Pegasus has one drivable hull on FHSW, and on
FH the nearest hull to a stuck one over every episode of seed 1 was a fixed
MG 20 m or more away (`stuck.mjs nearHull`). Nothing to separate.

### 2.9 Route failures are the soldiers'

Of 3,850 route failures in FH's 8-a-side seed 1 match, 42 were a seated
bot's; on FHSW none of 931 and 3,172. Most are soldiers on the bridge
(480, -570) routing to Cafe Gondree (390, -550): the walk map's and the
layer's, not the hulls'. Not changed here.

## 3. Tests

`tools/bf1942-models/tests/test_bot_hull_shuffle.py` (harness
`bot_hull_shuffle_harness.mjs`): the count with the pedal changing sign
every 1.5 s reaches the flag at 150 and fails the path at 400 for a hull
and never for a soldier; the circle goes ahead in a pocket whichever pedal
the flag fell on, astern on open ground when reversing; and the real move
executor driving a toy front-steered hull with a rev filter, nosed into a
pocket with its point astern, leaves the pocket and arrives (54 s; with the
code before these fixes it never leaves). `bot_hull_bounce_harness.mjs`
(the same test file, `HullBounceTests`): the travel speed reads 0 for a
hull whose velocity bounces between 0.7 and 1.8 m/s in place, its speed
for one under way, and starts afresh on a new seat; fed the velocity, the
count and the touch rule never fire on such a hull, fed the travel speed
both do; a back-out point astern is reversed to and one ahead or a plain
point is left to the box; and a toy hull driven by the real executor into
a 6 m wall the map does not show gets round it and arrives (18 s); a hull
ringed by four of its own circles keeps them after one failed search and
drops them, keeping a predicted and a soldier's, after the second.
`test_bot_hull_wedge.py`'s back-out case now expects the point a turn
radius straight away from the circle, not the nearest free point; its
other cases are unchanged and pass.

## 4. Before and after

Ten seeds, 600 s, 8 and 16 a side, garrison doctrine, `botbatch matrix
--vehicles` (the Pegasus levels, on copies of the generated trees) and
`botbatch baseline --vehicles --baseline <scratch>` (DICE's four), each
built from a frozen copy of the code: "before" is the branch's start
(2c6aef45f), "after" the branch's last code commit (all five fixes).
Median (p90) over the ten matches.

### The two Pegasus levels

| FH Pegasus | 8 a side before | after | 16 a side before | after |
|---|---|---|---|---|
| hull stuck s a driving minute | 21.5 (28.1) | 1.04 (2.44) | 25.4 (56.0) | 1.11 (4.25) |
| hull stuck, worse side | 28.0 (29.7) | 1.45 (4.04) | 30.0 (56.2) | 1.24 (10.9) |
| route failures a bot-minute | 24.8 (33.8) | 23.6 (34.2) | 6.52 (20.3) | 9.86 (23.9) |
| enemy kills a bot-minute | 0.115 (0.149) | 0.154 (0.205) | 0.099 (0.158) | 0.111 (0.233) |
| captures | 2 (4) | 2 (3.2) | 1.5 (2) | 2 (2) |
| stuck s a bot-minute (on foot) | 0.99 (1.48) | 1.02 (1.24) | 0.41 (0.63) | 0.38 (1.11) |
| redeploys a bot-minute | 0.067 (0.090) | 0.068 (0.077) | 0.024 (0.035) | 0.027 (0.056) |

| FHSW Pegasus | 8 a side before | after | 16 a side before | after |
|---|---|---|---|---|
| hull stuck s a driving minute | 21.8 (29.0) | 2.07 (3.37) | 19.5 (22.3) | 1.59 (2.29) |
| hull stuck, worse side | 21.8 (29.0) | 3.14 (8.72) | 19.8 (59.6) | 1.76 (2.38) |
| route failures a bot-minute | 6.27 (10.8) | 6.30 (12.7) | 7.95 (10.8) | 6.16 (9.02) |
| enemy kills a bot-minute | 0.111 (0.211) | 0.160 (0.323) | 0.177 (0.340) | 0.122 (0.235) |
| captures | 0 (0) | 0 (0) | 0 (0) | 0 (0) |
| stuck s a bot-minute (on foot) | 1.82 (2.14) | 0.42 (1.89) | 0.49 (1.15) | 0.39 (0.98) |
| redeploys a bot-minute | 0.246 (0.274) | 0.032 (0.226) | 0.032 (0.111) | 0.026 (0.090) |

The seconds a driver in MoveTo sat with its throttle off and no live route
(`stopped.mjs`, what the detector cannot see, 2.4 to 2.6), a driving
minute, median / mean / worst of ten, after: FH 2.0 / 2.3 / 7.8 at 8 a
side and 0.44 / 1.15 / 6.0 at 16; FHSW 0 / 0 / 0 and 0 / 0.03 / 0.27.
With fixes 1 to 4 but not 5 FH read 3.4 / 7.4 / 20.2 and 3.9 / 7.1 / 19.7.
Before, seed 1 only (the before matrix kept no traces): FH 4.96 and 1.02,
FHSW 0 and 0, the tractor then never leaving its pocket to meet a street.

The hulls now drive; the levels' fight does not change with it. Route
failures are the soldiers' (2.9) and stay where they were; enemy kills
move inside the seed spread, FHSW has no capture before or after. What
keeps these two levels off the site is now on foot, not in a seat.

### DICE's four levels with vehicles

Pooled, 40 matches a side size; "change" is a bootstrap 90 % interval of
the median's change (`boot.py`, scratch):

| 8 a side | before p50 (p90), mean | after p50 (p90), mean | change of the median |
|---|---|---|---|
| hull stuck s a driving minute | 0.60 (3.97), 1.42 | 0.72 (1.93), 0.95 | -0.46 to +0.49 |
| hull stuck, worse side | 1.03 (6.57), 2.49 | 1.22 (2.85), 1.70 | -0.46 to +0.78 |
| stuck s a bot-minute | 0.34 (1.20), 0.53 | 0.39 (1.33), 0.59 | -0.12 to +0.34 |
| route failures a bot-minute | 0.115 (0.505), 0.204 | 0.072 (0.186), 0.120 | -0.070 to +0.021 |
| redeploys a bot-minute | 0.033 (0.074), 0.039 | 0.036 (0.080), 0.044 | -0.011 to +0.027 |
| enemy kills a bot-minute | 0.315 (0.637), 0.376 | 0.361 (0.709), 0.402 | -0.023 to +0.094 |
| captures | 2.5 (7), 3.15 | 3 (6.1), 3.10 | -1.5 to +2 |

| 16 a side | before p50 (p90), mean | after p50 (p90), mean | change of the median |
|---|---|---|---|
| hull stuck s a driving minute | 0.46 (4.33), 1.47 | 0.69 (3.64), 1.44 | -0.78 to +0.65 |
| hull stuck, worse side | 0.80 (5.86), 2.25 | 1.03 (5.98), 2.26 | -0.94 to +1.02 |
| stuck s a bot-minute | 0.63 (2.85), 1.07 | 0.56 (2.83), 1.05 | -0.71 to +0.48 |
| route failures a bot-minute | 0.195 (1.62), 0.535 | 0.119 (1.09), 0.417 | -0.163 to +0.036 |
| redeploys a bot-minute | 0.039 (0.158), 0.063 | 0.045 (0.164), 0.065 | -0.022 to +0.028 |
| enemy kills a bot-minute | 0.458 (0.740), 0.504 | 0.490 (0.851), 0.541 | -0.017 to +0.070 |
| captures | 2 (5.1), 2.70 | 2 (5.1), 2.68 | -1 to +1 |

Hull stuck by level, median at 8 / 16 a side, before and after: Berlin
0.94 / 2.13 and 0.94 / 2.28; Bocage 0.08 / 0.17 and 0.18 / 0.28; Kharkov
0.60 / 0.33 and 0.67 / 0.40; Stalingrad 2.54 / 2.48 and 1.10 / 1.03.

Read plainly: every interval holds 0, so no figure moved beyond the seed
spread on DICE's levels. The tail of hull-stuck time is cut (p90 3.97 to
1.93 at 8 a side, the mean 1.42 to 0.95; Stalingrad's median halves);
the medians of hull stuck rise 0.1 to 0.2 s a driving minute on three
levels where they were already low, which the tables report rather than
argue away. Route failures fall at both sizes. Fix 5 cannot reach DICE's
levels (each ships a strategic map): Berlin 8 a side seed 7's trace with
vehicles is byte for byte the same with and without it, so these DICE
matches, built before fix 5, stand for the final code.

On-foot traces of the four levels (seed 1, 8 and 16 a side, 600 s,
`--no-vehicles`) are byte for byte the same on the branch's start and its
last code commit, and after every fix in between.

### The page

`sim/pagematch.mjs` against `serve_viewer.py` on the changed viewer, 420 s,
16 bots, one match each (the page is not seeded): Berlin 0.491 enemy kills
a bot-minute, no capture; Kharkov 0.357, 5 captures; no page errors in
either. On the branch's start, the same way: Berlin 0.313 and 0.277; with
fixes 1 to 3, Berlin 0.402 and Stalingrad 0.357. The seat-behaviour note's
page figures for the published code were Berlin 0.40, Kharkov 0.34.

## 5. What the generator could paint differently (described, not done)

The generator's files are not this work's; these are what the traces argue
for, for whoever owns `sim/botgen.mjs`:

1. **A hull map painted for the hull.** The 1.5 m brush lets a hull's
   centre stand where its body does not fit (2.1, 2.2, 2.6, 2.7). DICE's
   `Tank0` maps use 3.0. Where 3.0 closes a street the level needs, paint
   the streets at 3.0 and open only the cells a corridor check (the
   hull's half width plus a margin either side, along the street's axis)
   finds, rather than the whole map at 1.5.
2. **Close what a hull cannot turn in.** A dead end shorter than a turn
   radius plus a hull length (the tractor's pocket: 7 m deep, 6 to 7 m
   wide, against R 5 and a 4.4 m body), and a corner whose inside radius
   is under the turn radius (the bridge street at (472, -568)), are free
   paint a hull's route will be sent into. Blocking them, or marking their
   cells for the hull map only, keeps the router off them.
3. **A spawn a hull can drive out of.** The tractor's `traktorspawner`
   faces into its pocket. The layer cannot turn a level's spawner, but a
   generated layer can say where the hull map is open around each vehicle
   spawn; one with no exit wider than the hull's turning circle is worth a
   lint warning.

## 6. Open, and not verified

1. **Not looked at in a browser by a person.** Headless page matches only
   (section 4): two on the final viewer, more on earlier steps and on the
   branch's start, none with a page error. The page is not seeded, so one
   match a level is one sample, and no mod level was played on the page
   (a mod level needs its row in the local `maps.json`).
2. **The hull-stuck detector misses a hull that stops between retries**
   (2.4, 2.5, 2.6): a driver whose throttle goes to 0 during a route's 1.5 s
   retry pause restarts its 10 s window. `stopped.mjs` (scratch) counts
   those seconds; it is not in `sim/detect.mjs` (not this work's file).
3. **Every fix is an INVENTION.** The engine's own state machine
   (`actionStatusDecision`, AI-85) and driving law are unchanged; what
   changed is the viewer's own obstruction handling around them: the
   count's pedal, the speed it reads, the circle's end, the back-out point
   and its reverse, forgetting a hull's own circles, and a hull's route to
   the nearest reachable region. None of it was
   checked against the real game in the lab; whether retail's bots free a
   tractor from that pocket at all was not looked at.
4. **The PanzerIVH's wall at (462, -564.5) on FH** (2.3) was not
   identified, and the part of the fix aimed at it was not separated by a
   trace of its own.
5. **The street corner (2.6) is left.** It holds most of FH's residual.
6. **DICE's traces with vehicles moved** (section 4), as any change to a
   hull's handling moves them; on-foot traces of the four levels (seed 1,
   8 and 16 a side, 600 s) are byte for byte the same before and after
   every fix.
7. **The trace's sampling moves the detector a little**: FH 8 a side seed
   1 with fix 1 alone read 534 s of hull stuck at one tick a second (the
   matrix's) and 522.9 s at every tick; the episodes' edges fall on
   different samples. Before the fixes the two agreed to within 1 %.
