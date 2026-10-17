# Server-authoritative multiplayer in the browser

Status: design, opened 2026-10-17.

**Goal (the owner's, 2026-10-17):** a multiplayer mode in the browser game that is
*separate from the single-player one*, in which joining a server makes the server's
stream the absolute source of truth.

## Why

The page is a single-player simulator with a network client bolted onto it. On a real
server it keeps simulating what the server owns, and is then periodically overruled. A
whole evening of live play against a retail client (`../udp-sidecar/pairing-playtest.md`,
"The owner in the browser") produced a list of defects that all reduce to that one fact:

- vehicles the server respawned were invisible and intangible on the page, because the
  page does not *create* server objects, it tries to marry them onto its own
  level-placed copies by template and proximity, and when the marriage fails there is
  no body at all;
- an APC blew up on the page ten seconds before it blew up on the server, because the
  page runs its own damage and physics for hulls the server owns;
- the page's spawn is a prediction, so every life begins 50-220 m from where the server
  put the player and then snaps;
- a seated player's aim is never corrected, because the server's seated aim is never
  sent (`sidecar.mjs` computes an aim state only for a `BFSoldierNetworkable`) and
  `net-room.js` returns before the reconciler whenever the player is seated.

The owner's reading, which the code bears out: **from the retail client's point of view
the browser player looks fine; it is the browser's own picture of the world that is
not the server's.**

## What is measured, not assumed

Measured live on 2026-10-17 with a probe sidecar and a headless page on the lab server:

| Case | Page | Server | Verdict |
|---|---|---|---|
| On foot, standing, slow pan, 8 samples | view yaw | identical to the server's view yaw every sample | the on-foot prediction and correction loop is **healthy** |
| On foot, same pan | | body yaw lags by up to 42 deg (twist pinned at 14 units x 3 deg) | the engine's own twist, not a defect |
| Seated in a PanzerIV, 6 x 120 px | camera turned 6.67 deg total | `self.yaw` never moved: for a seated player it is the HULL's yaw | **nothing to reconcile a turret against** |
| Turn rate | 0.1215 deg/px on foot, 0.00926 deg/px in the turret | | a factor of **13**, the magnitude ledger row GUN-2b calls open |

A separate measurement of 181 samples from the same evening: on-foot steady-state
correction error is 0.001 m median, 0.58 m p95, and every error over 1 m is the first
reading after a deploy (224 m, 76 m, 76 m, 51 m -- one a life).

## Status: on by default for a sidecar join

`&authority=0` returns to the old behaviour for a side-by-side. Single player
has no authority to defer to and never enters this path.

## Measured (2026-10-17 to 18, probe on the lab server)

| Check | Before | After |
|---|---|---|
| Vehicles on the field | the level's 59, bound to the server's by template and proximity, a failed bind drawing nothing | the server's 46, every one loaded, collidable and seated |
| Boarding a server-respawned hull | impossible where the bind failed (walked through it) | entered a Tiger and drove it 25 m, the server agreeing on netId 566 |
| Spawn error, first reading after deploy | 224 m, 76 m, 76 m, 51 m, one hard correction a life | 0.5 m on a death-and-respawn the server placed elsewhere, zero hard corrections |
| A hull's hit points | the page's own abandon clock could wreck one ten seconds early | the clock cannot reach it (`spawned: true`, EMT-11); the server's `hull` row overwrites any local bite |
| A seated player's aim | nothing in the wire said where his own gun pointed | the ack's `haim`: in a Wespe's gunner seat, page 19.95 against the server's 20.00, agreeing to 0.04 deg |
| Walking | -- | 22.4 m in 4 s (5.6 m/s), correction error 0.01 m, on a machine with no other headless browser running |

### The probe harness went unreliable overnight

By the early hours of 2026-10-18 the headless page would barely walk at all:
0.05 m in 4 s of held throttle in the mode, and 0.64 m in the same test with
`?authority=1` OFF. Page and server agreed the soldier was standing still
(`error 0.02`), he was on the ground (y 40.4 against a ground of 40.35) and
corrections arrived at the normal rate -- the input simply stopped taking
effect, in BOTH modes. It is the harness or the machine (headless Chromium
after a night of restarts), not the mode, and it is the reason the last
pieces below are unverified rather than verified. Earlier the same evening
the same mode walked, boarded a Tiger and drove it 25 m.

### A performance scare that was a measurement error

A headless probe appeared to walk at 0.1-0.4 m/s where another page did 3.16,
and the mode was blamed for it twice -- first the per-frame collider publish,
then browser contention. Both were wrong: the same page measured 0.19 m/s with
`?authority=1` OFF, and later, once warm, **2.7 m/s with it on** (108 m in 40 s
of held throttle). The slow readings were taken seconds after a page load that
takes five minutes to settle. There is no measured performance cost to the
mode. A real page on a real GPU still has not been measured; that is the number
that matters and it needs the owner.

The two optimisations the scare produced were kept because they are right on
their own terms -- `CollisionIndex.cast` walks every moved owner on every ray,
and `setMovedOwner` takes a hull out of the static index -- and one of them
exposed a real defect (registration before the glb loaded left 47 of 48 hulls
with no collider at all).

## The open engine question this depends on

**GUN-2b** (`../bf1942-engine-reference/ledger.md`): what magnitude the client delivers
as `PlayerInput[c_PIMouseLookX/Y]`. Until it is read nobody can say what rate a turret
really turns at, and `viewer/seats.js` `TURRET_SPEED_SCALE` must be left alone. The wire
reserves headroom to +-16 (`PlayerAction::set` packs each input with
`floatToFixed(v, 12, 16.0f)`), so an input normalised to +-1 would leave 15/16 of the
encoding dead. The trail stops at the client's `ControlMap.addAxisToAxisMapping`
registrars, `FUN_006bba90` / `FUN_006bbd90`. The 13x measured above is a live data point
for that row.

## What is shared and what is not (the owner, 2026-10-17)

Single player and multiplayer are **different systems**, and the page does not
borrow single player's where multiplayer needs its own. What they share is the
simulation itself -- the physics, the mechanics, the gameplay rules, the models
and the assets. What differs is **the direction the updates come from**: in
single player every change is decided locally; in multiplayer the server
decides and the page follows.

That rules a line through each subsystem. The seat survey, the collider, the
Armor, the damage tiers, the animation rigs and every glb are shared code and
shared data. The control flow is not: single player's entry prediction, its
pads, its abandon clocks, its local damage resolution and its spawn choice are
single player's, and multiplayer asks the server instead and reflects the
answer.

### GUN-2b, narrowed (2026-10-17)

Read in the client with REA (Ghidra 12.1.2 headless, `BF1942.exe` sha256
`60c9452d1ddb...`, image base 0x400000, 16,602 procedures):

`FUN_006bba90` is **only the console-property registrar** for
`setInfMouseSensitivity`: it writes the property name, the vtable
`PTR_LAB_00920a58`, and the type string `"float"` (compared against
`"std::string"` to pick the type tag). It does no arithmetic and holds no
sensitivity value. `procedure_callers` returns nothing for it and Ghidra
reports one unresolved incoming call reference, so the binding to the
backing variable is an indirect reference its analysis does not follow.

So the ledger's "the trail runs as far as the registrars without reaching the
multiply" is confirmed at the registrar itself, and the next attempt should go
at it from the other end -- the lnxded project, where the ledger's symbols are
already attached -- rather than forward from here. The live measurement in the
table above (13x between a soldier's turn and a turret's for the same mouse
travel) stands as the magnitude any answer has to explain.

## The shape of the mode

One switch, not a scatter of `if (sidecarUrl)`. In server mode:

1. **Entities come from the wire.** A server object creates a page entity from its
   template at the server's pose and `destroyObject` removes it. No binding to
   level-placed copies, no proximity matching, no level vehicles on the field. The
   level supplies terrain, statics and models; it must not supply entity identity.
2. **The page simulates only the local player** -- his soldier, and the hull he is
   driving -- and corrects both against the server. Everything else is rendered.
3. **Damage, destruction, hit points, seats, teams, tickets and spawns are the
   server's word.** The page predicts none of them; the spawn waits for the server
   rather than guessing a point and snapping.
4. **A seated player's aim is corrected like his feet are**, which needs the seated
   aim on the wire (the hull's joint rotations are already decoded for drawing remote
   turrets; they are the same data).

## The seated aim: why nothing corrected it, and what now can

A client is sent **no ghost updates about the object it controls**. The joint
rows that carry every other hull's turret (`jn` names the parts --
`ShermanTower`, `TigerTower`, the page's own node names -- and `j` their
rotations) therefore have nothing for the hull this player drives, which is
why the page never corrected its own gun and why the owner's Tiger ended up
aiming somewhere other than where he looked. Confirmed live on 2026-10-18:
seated in Tiger 566, `__seatAim()` answered "server sends no joints".

The angles were nevertheless being decoded and discarded. A driven vehicle's
control state reads its rotational bundles (`ghost/pco.mjs`
`readRotationalBundle`), so the ack now carries them as `haim`, the page keeps
them as `selfHullAim`, and `seatAimDrift` compares them against the occupied
seat's rig axis by axis.

**This takes GUN-2b off the critical path.** With the server's own angle in
hand, a correction loop converges whatever the local input scale is, exactly
as the on-foot path does. GUN-2b still decides how a turret *feels* under the
mouse; it no longer decides whether the page and the server agree.

**Verified 2026-10-18**: `haim` arrives and the page reads it. In a Wespe's
gunner seat `__seatAim()` answered `{"source":"ack","rows":[{"axis":"yaw",
"node":"WespeTower_1","page":19.95,"server":20,"deg":0.04}]}`.

Two bugs were in the way, both reachable only from a seat on a real server:
the ack's id is the control object's, and a gunner controls his seat rather
than the hull, so comparing it against the hull's id rejected every turret
that aims; and the drift read `pose.joints` before returning down the ack
path, throwing every snapshot for the page's own hull.

**The correction pulls**, shown by forcing a divergence
(`__nudgeSeatAim(30)`, a test hook that shoves the page's own turret off
where it is). Seated in a respawned Wespe's gunner seat with page and server
both at 0:

| after the nudge | page | server | apart |
|---|---|---|---|
| 0 ms | 2.35 | 0 | 2.36 |
| 300 ms | 0.28 | 0 | 0.28 |
| 600 ms and after | 0.05 | 0 | 0.05 |

which is the law as written: past 25 degrees it takes the server's angle
whole, and the rest eases at 30% a snapshot. A 30 degree error is gone in
about 600 ms and stays gone. The hull was netId 708, one the server had
respawned, so this also exercises a turret on a hull the level never placed.

## Work, in order

1. ~~The entity seam~~ **done**: the server's object table stands every hull, with
   collision, seats and armour, and the level's own vehicles leave the field.
2. ~~Hit points~~ **done**: the server's `hull` rows are the only source, and the
   page's abandon clock cannot reach these hulls.
3. ~~The spawn~~ **done**: the page waits for the server's point (0.5 m, no hard
   correction, against 51-224 m before).
4. ~~The seated aim correction~~ **done**: the ack carries the driven object's own
   rotational bundles (`haim`), the page corrects toward them, and in a Wespe's
   gunner seat the two agree to 0.04 degrees.
5. ~~Make it the default~~ **done**: a sidecar join is authoritative, `&authority=0`
   returns to the old behaviour.
6. GUN-2b, for feel rather than agreement.

### What the owner still has to see

Nothing below can be settled from a headless page, and none of it blocks the mode
being on:

- authority mode on a real GPU, looked at rather than measured;
- the three fixes from the 2026-10-17 list -- a seated remote's body, a round
  leaving the gun rather than the face, one grenade a throw -- which are in the
  NORMAL path, not this mode, and are committed but unverified by eye;
- whether the turret's feel under the mouse is right, which is GUN-2b and is
  about rate, not agreement.

Each step keeps the single-player and room paths untouched; the mode is chosen at join.

## What still runs locally, audited (2026-10-18)

The worry behind this whole feature was the page simulating what the server
owns. Measured on a joined page, what it actually runs is:

| | On a server |
|---|---|
| Bots | none. `__bots()` is empty: the local referee never starts |
| Vehicle pads and spawning | none. `round-spawners.js` returns on `page.roomJoined` before it ticks |
| Abandon clocks (the APC that blew up early) | none, by the same return; and a server hull could not be reached by one anyway (`spawned: true`, EMT-11) |
| The level's own vehicles | off the field: hidden, out of the pads' live set, out of the collider |
| Hull hit points, destruction | the server's rows |
| Flags, tickets, round state | the server's rows |
| A seated player's turret | corrected to the server's angle |
| **The local player's soldier, and the hull he drives** | **the server's row, by default. `&predict=1` predicts and reconciles instead** |

That last row was the mode's one exception to "the server is the truth", and it
is no longer the default. The case for predicting is that retail does it and
the measured position error is only 0.001 m, so the page already showed the
server's truth to a millimetre while answering the mouse a frame sooner -- but that case rests on latency,
and the latency could not be measured here (below). An unmeasured preference
should not override what was asked for, so the strict reading is the default:
the body is placed at the server's row every snapshot, with no ledger, no
replay and no easing. Verified: 20.42 m walked, **zero corrections**, page and
server the same number (`490.7, -1282.12`).

`&predict=1` restores prediction and its reconciliation, whose own numbers are
0.001 m median error on foot, 0.5 m on a spawn and 0.04 degrees on a turret.
Pick between them on a real machine, where the latency actually differs.

It is also the mode's only exception to "the server is the truth", and
whether it should exist is a judgement about feel, not correctness -- so the
strict reading is runnable rather than argued. **`&predict=0`** puts the body
where the server's snapshot has it, every snapshot, with no ledger, no replay
and no easing. Measured: the page's position and the server's are the same
number to the centimetre (`[485.86, -1263.49]` both), **zero corrections** in
four seconds of walking, and the player still moves at 5.7 m/s because the
server moves him. The cost is a round trip of input latency, which is why it
is not the default.

**The latency claim is NOT measured, and the harness cannot measure it.**
Input-to-movement came out the same both ways -- predicted 50/65/65/66/73 ms,
strict 50/54/65/66/75 ms -- because a headless page's own frame interval
(~60 ms) swamps the difference. On a real GPU at 60+ fps the predicted path
should answer in about a frame while the strict one waits for a snapshot at
~20 Hz, but that is reasoning, not a reading. Whoever runs this on a real
machine should take both numbers and pick the default on evidence; the
choice is one URL parameter either way.

## Open

- GUN-2b: what magnitude the client delivers as `PlayerInput[c_PIMouseLookX/Y]`.
  It decides how a turret feels under the mouse; it no longer decides whether the
  page and the server agree about where it points.
- The local player's own soldier and the hull he drives are still predicted and
  corrected, by design: retail does the same, and the measurements here (0.001 m
  median on foot, 0.04 degrees on a turret) say the loop works. Everything else
  is rendered from the server.
- The tonight fixes that patch symptoms of this (deaths, seats, respawned vehicle
  binding, server rounds, torso twist, held weapon) are in `../udp-sidecar/` and are
  worth keeping until the seam replaces them.
