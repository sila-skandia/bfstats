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
`Tank0` map around a point), and per-tick reads of the trace's `drv` block
(`sim/match.mjs`: state, drive, angle, steering point, speed).

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

**Fix** (`viewer/bot-route.js`, INVENTION, both the rule it corrects's
own): a hull's throttle counts either way (`Math.abs`), a soldier's is
unchanged (his is never negative, so his traces are byte for byte the
same). And the circle `onHullObstructed` plants goes at the end of the
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

### 2.5 A street corner the tractor cannot make (not fixed)

Out of its pocket and past the object, the RedTractor's next stop on FH is
the street from the bridge to Cafe Gondree, where the vehicle map's free
paint is 2 to 5 cells wide and turns 90 deg at (472, -568) (`mapat.mjs`
on FH's `Tank0`). FH 8 a side seed 8, after 2.4: the tractor noses into
the corner, the touch rule backs it out 4 to 5 m down the street, it
drives into the corner again, every 12 s for 80 s or more, 109 s of the match with its
throttle off between route retries. The hull-stuck detector sees 10 s of
it: the retry pauses (1.5 s, throttle off) restart its 10 s window. The
route cuts a corner a 5 m turn radius cannot make in a street the paint
says a hull's centre fits; the fix is the map's (2.6), or a route search
that knows the hull's turn radius, which the engine's does not
(`AStarLocalSearch` searches cells, AI-30) and which was not tried.

### 2.6 The vehicle map's corridor and the hull (not the page's: the generator's)

The pocket is free paint because FH's and FHSW's generated `Tank0` maps are
painted with a 1.5 m brush (`index.json`), where DICE's levels paint
theirs at 3.0 (Berlin, Stalingrad, Kharkov, Bocage). Free paint is where a
hull's centre may stand; with 1.5 m a 2.2 m wide, 4.4 m long tractor's
nose is at the wall before its centre leaves the paint, and the pocket the
level parks it in is a place it cannot turn in. The README (18.8) chose
1.5 m because 3.0 closes the level's streets. Not changed here (the
generator is not this work's file); what it could do is in section 5.

### 2.7 Hulls blocking each other, and a hull parked on the route

Not seen on these two levels: Pegasus has one drivable hull on FHSW, and on
FH the nearest hull to a stuck one over every episode of seed 1 was a fixed
MG 20 m or more away (`stuck.mjs nearHull`). Nothing to separate.

### 2.8 Route failures are the soldiers'

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

PENDING

## 5. What the generator could paint differently (described, not done)

The generator's files are not this work's; these are what the traces argue
for, for whoever owns `sim/botgen.mjs`:

1. **A hull map painted for the hull.** The 1.5 m brush lets a hull's
   centre stand where its body does not fit (2.1, 2.2, 2.5, 2.6). DICE's
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

1. **Not looked at in a browser by a person.** Four headless page matches
   on the changed viewer (Berlin twice, Kharkov, Stalingrad; 420 s, 16
   bots) had no page errors; their kill rates are in section 4. The page
   is not seeded, so one match a level is one sample.
2. **The hull-stuck detector misses a hull that stops between retries**
   (2.4, 2.5): a driver whose throttle goes to 0 during a route's 1.5 s
   retry pause restarts its 10 s window. `stopped.mjs` (scratch) counts
   those seconds; it is not in `sim/detect.mjs` (not this work's file).
3. **Every fix is an INVENTION.** The engine's own state machine
   (`actionStatusDecision`, AI-85) and driving law are unchanged; what
   changed is the viewer's own obstruction handling around them: the
   count's pedal, the speed it reads, the circle's end, the back-out point
   and its reverse, and forgetting a hull's own circles. None of it was
   checked against the real game in the lab; whether retail's bots free a
   tractor from that pocket at all was not looked at.
4. **The PanzerIVH's wall at (462, -564.5) on FH** (2.3) was not
   identified, and the part of the fix aimed at it was not separated by a
   trace of its own.
5. **The street corner (2.5) is left.** It holds most of FH's residual.
6. **DICE's traces with vehicles moved** (section 4), as any change to a
   hull's handling moves them; on-foot traces of the four levels (seed 1,
   8 and 16 a side, 600 s) are byte for byte the same before and after
   every fix.
7. **The trace's sampling moves the detector a little**: FH 8 a side seed
   1 with fix 1 alone read 534 s of hull stuck at one tick a second (the
   matrix's) and 522.9 s at every tick; the episodes' edges fall on
   different samples. Before the fixes the two agreed to within 1 %.
