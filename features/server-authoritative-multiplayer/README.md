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
| **The local player's soldier, and the hull he drives** | **predicted and reconciled, the retail client's own law. `&predict=0` draws the server's row instead** |

That last row is the mode's one exception to "the server is the truth", and it
is retail's exception too: the client predicts its own soldier from the same
actions it sends (netcode.md P-1) and takes the server's word whole at the
acked tick (`readControlObjectState` -- the reconciler at smoothing 1 is a port
of it). The reconciliation's numbers are 0.001 m median error on foot, 0.5 m
on a spawn and 0.04 degrees on a turret, so the page shows the server's truth
to a millimetre while answering the mouse in a frame.

The strict reading -- `&predict=0`, the body placed at the server's lerped
stream every tick, no ledger, no replay, no easing -- was the default for a
day (2026-10-17) on the strict reading of "the server stream is the absolute
source of truth". Measured, it is exact (20.42 m walked, zero corrections,
page and server the same number, `490.7, -1282.12`) and it still moves the
player at full speed because the server moves him. But it draws the OWN body a
render lookback (100 ms) plus half a round trip behind the keys: the view
turns at once while the translation lags, which the owner's next session
reported as stutter -- the one feel retail never has. So the default went back
to the retail law (2026-10-18) and the strict mode stays one parameter away
for the side-by-side.

**The latency difference is NOT measurable headless.** Input-to-movement came
out the same both ways -- predicted 50/65/65/66/73 ms, strict 50/54/65/66/75
ms -- because a headless page's own frame interval (~60 ms) swamps the
difference; on a real GPU the predicted path answers in about a frame while
the strict one waits out the lookback and the trip.

## Closed since: the engines (2026-10-18)

A hull the server stands is a loaded model, not a `Vehicle`, so nothing ran
`advanceEngineLods` and a remote aircraft's propeller never turned. The record
carried this as "the server sends no revs". It does send them:
`EngineNetworkable::updateStateMask` (`0x08227620`) puts `PhysicsEngine+0xa0`
on the wire under mask bit 0x080, and that is the float the tail of
`PhysicsEngine::updatePhysics` spins the Engine's first child LodObject from
(PHY-30). A retail client is **told** a remote's propeller speed, which is the
whole argument of this feature applied to one more subsystem.

Ledger NET-11 has the whole engine body, bit for bit, including the 1.25
asymmetry that makes every client's remote propellers turn at 80% of the
server's rate. `sidecar/ghost/pco.mjs` keeps the field, `ghost-writer.mjs`
writes the recorder's own `g` rows (so sidecar recordings replay with blades
turning), and `viewer/server-entities.js` `spin` draws it
(`tests/test_server_engine_spin.py`).

## Closed since: the spawn, and the body the server walks (2026-10-18, live)

The owner's first live test found two things in the first minute, and the
second was two symptoms of one cause. Both are `d7311417`.

**The spawn was the page's, not the server's.** The deploy screen stood a body
43 ms after the press (measured), before the server had spawned one at all.
Retail's screen is waiting out a respawn timer there; this one let you walk,
and teleported you when the server's spawn arrived at the point it had chosen.
`spawning.js` `deploySpawn` now asks and holds the screen, and `net-room.js`
stands the body on the snapshot that first reports this player alive, at the
server's point (`standServerSpawn`). The "ask the server and wait" that the
`awaitingServerSpawn` comment described since the start is now what the code
does. Measured after: server alive at 13-17 ms, body at 85-106 ms, both sides
on the same metre. An unanswered request is re-sent after 5 s, because a round
restart drops it; a redeploy over a live body keeps the old path, since a real
server ignores a spawn request from a player who is already alive.

**The jitter and the backwards walk were one bug.** Strict mode ran the local
sim AND hard-set the body onto the newest snapshot, ten times a second. Two
things follow, and the owner saw both:

- The sim walked between rows and the row yanked him back onto the server's
  position. The camera moved 0.04 m one frame and 0.21 m the next in a
  repeating six-frame beat -- a surge and a stall, not something smoothing
  downstream could have hidden, because the body really was doing it.
- The sim walked him along the page's VIEW yaw; the server walks its copy
  along the BODY yaw it holds, and the engine turns the body after the view in
  60 degree twist steps. Measured live: the server's body yaw stepped
  -141.7 -> -81.7 while the page's view held -103.3, so travel came out 21
  degrees off the way he faced. Far enough apart -- which is exactly where a
  fresh spawn leaves them -- and the two motions oppose. That is walking
  backwards.

`placeServerSelf` now runs at the end of every world tick, hooked ahead of the
presentation capture the way `hull-bodies.js` hooks the held craft, and reads
the same lerped stream (`netcode-client.js` `lerped`, 50 ms behind the newest
sample) that every other body on the field is drawn through. The sim still
runs the man whole: his stance, gait, bob, footsteps and collisions are read
off the tick he has just run, and only where he ENDS that tick is the server's
word, so none of his own travel survives into the next one.

An earlier attempt stripped the travel channels out of the word the local
world consumes. It was smoother than this on paper and wrong: with no
movement input the soldier's gait stays `stand`, which is no view bob and no
footstep sounds. The tick hook keeps both.

Walking measured against single player over the same ground, 240 frames:

| | camera step, mean | variation (cv) | max | footsteps |
|---|---|---|---|---|
| before | 0.118 | the 0.04 / 0.21 beat | 0.495 | -- |
| after | 0.095 | 0.31 | 0.213 | 11 |
| single player | 0.099 | 0.26 | 0.271 | 11 |

Travel bearing after the fix matches the server's exactly and sits 0-1 degrees
off the view yaw. Remote bodies were never part of this: measured at the same
moment, a running bot's drawn heading was 1 degree off its own travel.

Not done: the respawn countdown is not drawn. The screen honours the wait, it
does not yet show the number retail shows beside it.

## Open

- The respawn countdown's digits. The wait is real now; nothing paints it, so
  the screen simply stays up. Where retail's number comes from is unread: the
  server's `gameRules` carries no spawn delay (checked on a live feed).
- GUN-2b: what magnitude the client delivers as `PlayerInput[c_PIMouseLookX/Y]`.
  It decides how a turret feels under the mouse; it no longer decides whether the
  page and the server agree about where it points.
- **The prediction default has moved twice.** The local player's own soldier
  and the hull he drives are predicted and corrected, by design: retail does
  the same (P-1). c7777871 flipped that to the strict server's-row placement
  on the strict reading of "the server stream is the absolute source of
  truth"; the owner's next session reported the result as stutter, and on
  2026-10-18 the default went back to the retail law. Measured both ways --
  predicting, 0.001 m median error on foot and 0.04 degrees on a turret with
  the loop closing a 30 degree divergence in 600 ms; strict, 20 m walked with
  the page and the server both at `[490.7, -1282.12]` and zero corrections.
  **`&predict=0` keeps the strict mode runnable**, one URL parameter away.
- The tonight fixes that patch symptoms of this (deaths, seats, respawned vehicle
  binding, server rounds, torso twist, held weapon) are in `../udp-sidecar/` and are
  worth keeping until the seam replaces them.

## The hull-copy seam is the next root (2026-10-18)

Tonight's live tests (retail client + sidecar, El Alamein co-op) showed a cluster
of "not aligned with the server" symptoms that are all one fault: in authority
mode the page still keeps its OWN vehicle world — the level's placed vehicles, a
local spawn/respawn lifecycle, and a predicted LEVEL-NODE copy of the hull it
controls — running next to the server's. The two drift and double.

**Proof.** A board-probe on a flak38 (`net-sidecar` id 629): the server's flak is
at `[877.4, 60, -1757.4]`, but `adoptServerSeat` -> `pageHullOf` -> `sidecarNodeFor`
bound it to a LEVEL flak **600 m away at [342, 40, -1245]**, and while manned BOTH
drew (the server entity is not suppressed because a flak has no `drive`, so
`net-room` `drivenId` misses it). The binding is doomed by construction: **the
server spawns hulls where the level has no matching copy** — a flak at a captured
flag, a Panzer on a flag the level stocks with a Sherman — so there is often no
near level node to bind to, and when there is, it is a second body.

The symptoms this explains: the phantom Sherman under the server's Panzer; two
hulls on bail/nudge; a stationary gun shown at the level's position while the aim
points the server's way; (and it is the same family as) a vehicle you can't see.

**The fix is the thin client.** In authority mode the page must draw ONLY the
server's objects: every vehicle is its `server-entities.js` entity, no level
vehicles, no local vehicle lifecycle, and the page occupies/draws the ENTITY it
controls (predicting only its pose, reconciled), never a bound level copy. Staged,
lowest-risk first:

1. **Stationary guns (flak/MG/Defgun) first.** No drivetrain to port: the page
   mans the server entity's group directly (it carries the glb's seat, turret and
   EntryPoint), `serverEntities` keeps placing the fixed hull and skips the owner's
   turret joints (as it does for `ownId`), and the level-copy bind is dropped. This
   alone removes the flak double and the old-position/new-aim split.
2. **Driven hulls (tank/plane/ship).** The drivetrain (`vehicle-instance` ->
   `hull-bodies` `bodyScene`/`adoptDriven`) must build on the server entity's group
   rather than a level node. The entity already has a collider owner and Armor
   (`serverEntities.register`); it needs a `bodyScene` entry and `bodySpecFor`.

**Acceptance (headless-verifiable):** `bail_probe.cjs` — board, assert exactly one
visible copy at the server's position; exit, assert one. Firing/aim on the entity
and the driving FEEL need the owner's live confirm (the goal's own rule), so this
lands with a retail-client check, not blind.

**Not this seam:** the capture announcer is correct (verified: Allied owner hears
"WeHaveLostControlOf" on an Axis cap); the flight jitter is the plane PHYSICS
integrator diverging, not the bot control law AI-60; the spawn countdown's value
is still unread (not in `gameRules`, above).

### Landed 2026-10-18 (stage 1)

Verified headless against the lab and committed:
- `applyVisibility` hides every parked spawner vehicle when `serverOwnsVehicles`
  is set (`net-room` sets it with `remotePads`); the driven one is reparented out
  and keeps its visibility. Kills the phantom parked copy (the Sherman under the
  Panzer) and the before-you-board double. The reliable hide `clearLevelVehicles`
  could not guarantee by timing.
- The driven level copy is hidden on exit (`net-room` `drivenLevelNode`): it is
  reparented out so `applyVisibility` never hid it, and it stood beside the server
  entity that returns -- the bail/nudge double.
- A stationary gun (`classifyRoot` not in `DRIVE_KINDS`) is manned on the server
  entity's own group (`adoptServerSeat`), not a bound level copy 600 m off. One
  hull, at the right place, aimed. Verified: entering a `Stationary_Browning`
  entity gives `onboard` with the entity as the occupancy root.

Probe `bail_probe.cjs`: Priest shows one visible copy before enter, while driving,
after exit. `enter_entity_probe.cjs`: the gun-entity entry takes.

### Landed 2026-10-18 (wrecks on a server kill)

The owner saw a crashed hull (their own B17, a remote Spitfire) die where it
should and leave no wrecked hull. Cause: `server-entities.js` `hull(id, hp,
destroyed)` lowered the Armor's hit points but never placed the wreck -- a local
round wrecks through `vehicle-hits.js` (`if (change.died) page.wreckVehicle(..)`),
and the server's `hull` row had no equivalent. Fixes:
- `hull` now calls `ctx.wreckVehicle(armor)` on the destroyed transition (both
  the `destroyed` flag and hp falling to zero), once. `net-room` passes
  `wreckVehicle: v => page.wreckVehicle?.(v)`. The wreck lingers in this mode
  until the server's `vehicleGone` clears it (`stepWrecks`'s `remote` branch).
- The player's **own** hull has no server entity while driven (`id === driven`
  drops it), so the `hull` kill event finds nothing to wreck. The crash ends the
  drive and the hull returns from the object table; the server's standing
  destroyed state is now applied once, latched on the entity the first frame it
  has an Armor (`e.standingApplied`), so it comes back a wreck. The latch is a
  one-shot so it never heals away a local round mid-life.
Covered by `tests/test_server_hull_wreck.py` (destroyed flag, hp-to-zero, the
living/healing no-op, and the own-hull reappearing a wreck). Needs the owner's
live confirm that both wrecks now show, and that the server keeps the own hull
in the table long enough for the entity to return (if it drops it on the same
tick as death, there is nothing to wreck -- that would need the predicted copy
to wreck locally before `drivenLevelNode` is hidden; noted but not built).

### Lab verification 2026-10-18 (items 3, 4, 5 against the running server)

Confirmed headless against the live lab (el_alamein CoOp, a team-2 sidecar), not
just by reasoning:
- **Team / announcer (item 3).** Deployed team 2; the page's own team read 2
  (`__net().self.team`), consistent with the deploy team -- the inconsistency
  that made the announcer pick the wrong voice (the owner's "Position secured"
  on an enemy cap, pre the `25b7b17d` team fix) is gone. An observed capture by
  my own side ("Allies captured the control point") played the `gain` voice,
  which is correct for a friendly capture. The wrong-voice report was the team
  bug, now closed.
- **Spawn countdown (item 4).** On the deploy screen the line read
  `TIME TO SPAWN: 11` and ticked `3, 2, 1, 0`, then held at "SELECT A SPAWN
  POINT" -- the retail shape.
- **Kill log weapon (item 5).** Two kills in the window: one carried
  `weapon = 0xFFFFFFFF` (-1, the engine's "no weapon template" sentinel) and
  rendered `[killed]`, which is what retail shows for a stampless kill; the other
  carried `weapon = 2827`, which the sidecar resolved to `PanzerIV`
  (`sidecar.mjs:440` `tidNames`), so its line names the weapon. The owner's
  "killed for everything" is fixed: a kill with a weapon stamp now shows it, and
  `[killed]` is reserved for genuine -1 kills, matching retail (`chat-log.js`
  `killStamp`/`killWord`; the format matches BF1942.exe `FUN_004933d0` case 3).

### Open: the bumpy drive/flight ("sand with short ridges")

Traced, not yet root-caused, because the cause can only be read live. The
driven hull is reconciled by `correctDrivenHull` -> `createHullReconciler.accept`
(`netcode-reconcile.js`): the server's state at the ACKED tick is compared to
the page's own recorded state at that same tick, and the error is applied WHOLE
to the present hull, the unacked ticks carried on top. This is retail's law
(`readControlObjectState` 0x004968a0, then replay the unacked actions), and it
is invisible only while the error each snapshot is near zero. A visible ridge at
the snapshot cadence therefore means a genuine, near-constant per-snapshot
PREDICTION error: the page's physics integrator drifting from the server's
between snapshots and being snapped back each time. That is goal item #2 (flight/
drive prediction fidelity), an engine-physics divergence, not a reconcile bug to
patch -- patching the reconcile to smooth it would mask the drift, which the
owner has ruled out.

**Morning diagnostic (decisive).** While driving on a straight, open stretch,
read the live correction in the browser console:

```js
// one snapshot
__net().hull            // { id, error (m), speedError (m/s), acked, hard }
// sample it over a few seconds of steady driving:
(() => { const s=[]; const h=setInterval(()=>{const c=__net().hull; if(c) s.push(c.error);}, 50);
  setTimeout(()=>{clearInterval(h); const n=s.length, mean=s.reduce((a,b)=>a+b,0)/n;
  console.log({n, mean:+mean.toFixed(3), max:+Math.max(...s).toFixed(3),
               snaps:__net().hullSnaps, bad:__net().hullBad});}, 4000); })()
```

- `error` in centimetres and `hard` never true -> the reconcile is healthy; the
  ridge is elsewhere (presentation/interp), look at `local-look.js` tick capture.
- `error` steady at tens of centimetres a snapshot -> the physics divergence is
  real and is the ridge. Next step is RE: compare the page's hull integrator
  (`hull-bodies.js` / `aircraft.js` step) against `performMobilePhysicsUpdate`
  (client 0x00491c90) for the vehicle class the owner felt it worst on, one tick
  at a time, and close the gap in the integrator -- NOT in the reconcile.
- `hullBad` climbing -> the drive is going non-finite and being hard-reset; a
  different bug (the reset snap), chase that first.

**The flight law and the integrator are already read and ported** (the goal's
"read AI-60 from the binary / port Refractor's integrator"). AI-60 is a full
ledger row -- `PlaneControl::towardsDirection` `0x08629fa0`, the whole climb/turn
law, read from lnxded. Refractor's per-tick vehicle physics is ported across the
PHY rows, each binary-cited and marked built in the viewer: the box drag law
(PHY-4, PHY-22, `ground-contact.js`/`projectile-flight.js`), springs (PHY-5,
`ground.js`), an engine pushing along its own axis (PHY-12, `vectored-engines.js`),
the water floor and submersion scale (PHY-16), engine thrust and the screw/prop
gates (PHY-18, PHY-19), the 4-substep `dt/4` integrator (PHY-1). The authority
drive uses those same classes -- a probe that entered a hull got
`drive: "TrackedVehicle"`, the single-player integrator. So the port is not
missing; the bump is the small RESIDUAL between that port and the server's own
physics, corrected whole each snapshot. Closing it needs the measured error
(below) to say which term still diverges -- a blind edit to an already-ported,
single-player-parity integrator would regress the thing that passes today.

**Why the reconcile error can't be measured headless (four attempts, each with
its mechanical reason) -- and a stage-2 gap found doing it.** `correctDrivenHull`
runs only for a driven hull that is BOTH drivetrained (`occ.drive.state` exists)
AND bound to a server netId (`netVehicleIdFor(occ.root)`), so a measurement needs
both at once:
1. `__enterOwner(levelOwner)` -> a drivetrain (`drive: "TrackedVehicle"`) but the
   level copy is not server-bound, so `netVehicleIdFor` is null and the reconcile
   returns early: no `__net().hull`.
2. `__teleport` next to a hull then `__seatToggle` -> the server refuses: teleport
   moves only the LOCAL prediction, the server's bot is still at spawn, so Use
   finds no vehicle.
3. Walking the bot to the hull with `__keys.add('KeyW')` DID work (forwarded input
   moved the server bot 17 m to 2.4 m) and `__seatToggle` seated it -- but the
   seat came up `drive: null`: adopting the SERVER ENTITY's seat for a drivable
   builds no drivetrain (the stage-2 gap below), so again no drive to reconcile.
4. `lab/pilot.cjs` stalls before deploy (its connect loop waits for
   `__deploy.flags` but dismisses the briefing only after, a deadlock when the
   briefing shows).
Only the owner's natural play makes both true at once -- the server seats the bot
in a vehicle, the page binds that to the level copy and drivetrains it -- so the
`__net().hull.error` sampler needs the owner driving. This is demonstrated, not
assumed.

**Stage-2 gap, confirmed headless (feeds item 1's thin-client goal).** Entering a
server-entity drivable through `adoptServerSeat` gives a seat with `drive: null`
-- no drivetrain -- so that hull cannot be driven from its own entity. The
authority drive today works only because it falls back to the level copy's
drivetrain (bound to the server id). The thin-client end state (item 1: "predicts
only the single object it controls") needs the drivetrain ported onto the server
entity's group (`hull-bodies` `bodyScene`/`adoptDriven`), which also removes the
level-copy dependency the clone fixes dance around.

**Ruled out (2026-10-18), so item 2 is narrowed to integrator fidelity:**
- NOT a timestep-cadence bug. The world steps whole 1/30 s ticks off an
  accumulator (`world.js`, LOOP-1 `g_simulationFps = 30`), the same rate the
  server integrates at, so our prediction and the server tick in lock-step.
- NOT a reconcile-baseline bug. `capturePresentationTick` (`local-look.js`)
  records the RAW `occupancy.drive.state.position/orientation/velocity` for the
  ledger, as the world's per-tick `onTick` with each tick's final state -- not
  the interpolated render pose -- so the error the reconcile measures is a true
  tick-for-tick divergence, not an interpolation offset.
- It affects tanks AND planes, whose integrators are different code, and our
  integrators pass single-player parity. What they share is that in authority
  mode they predict against the SERVER's full Refractor physics while running a
  simpler model. So the ridge is our simplified per-tick integration drifting
  from Refractor's and being snapped back each snapshot -- exactly goal item 2,
  "port Refractor's integrator closely enough." The RE target is the per-tick
  divergence for one class (ground first, it is simpler than flight): the
  measured `error`/`speedError` decomposition says whether it is position drift,
  a velocity/drag mismatch, or a steering/heading mismatch, which points at the
  term to match first.

### Open: Willys on the minimap but not in the 3D view

The owner sees the Allied Willys on the minimap (El Alamein main) but not in the
world. Headless this does NOT reproduce: `vehvis_probe.cjs` shows every Willy as
a server entity, `loaded` and `posed` at its base position, and the minimap and
the view read the SAME server entities in authority mode -- so a marker with no
mesh should not happen. It needs the owner's live view to pin, with this console
read while standing at the Allied main looking at where a marker sits:

```js
// level spawner Willys (should be hidden by serverOwnsVehicles) vs server-entity
// Willys actually drawn, with distances from the player:
(() => { const s=__soldier(); const sw=__serverWorld();
  const ents=(sw.entities||[]).filter(e=>/willy|kubelwagen/i.test(e.template||''))
    .map(e=>({id:e.id, t:e.template, loaded:e.loaded, posed:e.posed, vis:e.visible,
              d:+Math.hypot(e.at[0]-s.x,e.at[2]-s.z).toFixed(1)}));
  console.log('server entities', ents); })()
```

Three outcomes and their fix:
- entities present, `loaded/posed` true, but `vis:false` -> something is hiding
  the server entity (not the level copy); chase that flag.
- NO entities near the marker -> the server culls the parked Willy from the
  object table this client gets, yet the minimap still marks the level pad; the
  level copy was hidden by `serverOwnsVehicles` with no replacement. Fix: hide a
  spawner vehicle only when a server entity of the same template is drawn (its
  replacement actually exists), not unconditionally -- closes both this and the
  load-race window at spawn, and cannot bring back the double (we only hide when
  the real one is up). This is the safe refinement; it was NOT made blind because
  the current unconditional hide is the confirmed fix for the parked double, and
  the regression could not be reproduced to verify a change against.
- entities present and `vis:true` at the marker -> a render/placement issue (the
  mesh is there but not where/what you expect); compare `e.at` to the marker.

### Open: the spawn-screen "TIME TO SPAWN: N" countdown

Not a regression -- the string exists nowhere in the viewer, so the browser's
deploy screen has never shown the reinforcement countdown. The spawn MECHANISM
in authority mode works (`spawning.js` `deploySpawn` -> `askServerSpawn`, then the
screen waits for the server's alive row and `standServerSpawn` stands the body;
the headless deploy probe spawns through this path). What is missing is the
displayed timer.

**RE of the spawn model (2026-10-18, lnxded `bf1942_lnxded.static`, Ghidra via
REA). Ledger-worthy; to integrate under a SPAWN row.** Spawn is WAVE-based:
`dice::bf::GameServer` holds `spawnWaves` (bool, `0813d7d0`/`0813d800`),
`spawnWaveTime` (float, the wave period, `0813d780`/`0813d7b0`), `spawnDelay`
(float, `0813d830`/`0813d860`) and `spawnDelayPenaltyForTK`
(`0813aa10`/`0813a9f0`). `GameServer::reSpawnPlayer(BFPlayer*)` (`0814c4b0`) is
gated by `BFPlayer+0x90` (the spawn-requested flag) and the chosen group's
`BFSpawnGroup::getActive()`; on success it places the soldier at the group's
spawn point, sets `BFPlayer+0x79 = 1` (alive) and resets the float at
`BFPlayer+0x98` to -9999. (The `spawnDelay` static inside
`gameStatusPlaying(float)` at `0871b9e8` is a red herring -- an int set to 2,
decremented, `==0`-gated: a spawn-GROUP refresh throttle, not the player timer.)

**The wave config is NOT transmitted to clients.** The `GameRules` event
(id `0x16`, `0811f780`) carries only `soldierFF, externalViews, noseCam,
ticketRatio, timeLimit, worldTime, crosshairCentre` -- no spawn timing. The
`GameStatus` event (id `0x24`) only reads a tail on status 5 (the end/restart
message). So the retail client computes "TIME TO SPAWN: N" LOCALLY, from
`spawnWaveTime`/`spawnWaves` it loaded from the SAME map/server config the server
read, plus the `worldTime` the server keeps syncing in `GameRules`: the next wave
boundary is `spawnWaveTime - (worldTime mod spawnWaveTime)` when `spawnWaves` is
set, else the flat `spawnDelay` from death.

The real values are on the lab server (`bf1942-lab/server`'s
`serversettings.con`): `game.serverSpawnTime 15`, `game.serverSpawnDelay 5` --
the vanilla defaults, and the client exe carries the same setting names
(`serverSpawnTime`, `spawnWaveTime`, `spawnDelay`) and the `TIME_TO_SPAWN`
lexicon key (VA `0x91df20`), so it computes its own number from them + the
server clock.

**Landed: the countdown logic** (`viewer/spawn-timer.js`, tested by
`tests/test_spawn_timer.py`). `timeToSpawn(now, diedAt, {spawnTime, spawnDelay})`
returns whole seconds to the next GLOBAL wave boundary at or after `diedAt +
spawnDelay` (the flat delay when `spawnTime <= 0`), null before a death; waves are
a grid on the server clock, so a death mid-wave waits for the next boundary, never
a fraction early. `deployCountdownLine` gives the "TIME TO SPAWN: N" /
"SELECT A SPAWN POINT" text. Defaults `DEFAULT_SPAWN_TIME = 15`,
`DEFAULT_SPAWN_DELAY = 5`.

**How the retail CLIENT paints N (RE, BF1942.exe `FUN_006ad0a0`, the HUD/spawn
draw).** At `0x6adc1e` it pushes the `TIME_TO_SPAWN` lexicon key (VA `0x91df20`),
then `fld [edi+0xC0]` (`0x6adc2d`) loads a FLOAT off the spawn-screen object,
`ftol` (`call 0x804af0`) truncates it to int, and `Locale::getWide` (`0x5815b0`,
ecx `0x9a2170`) formats it into the string. So the client does NOT compute a wave
grid in the draw: **`N = (int)*(float*)(spawnScreenObj + 0xC0)`** -- a pre-computed
countdown the object carries, decremented elsewhere (an alternate state, vtable
`+0x74` == 3, paints the sibling string `0x91df30` off the SAME float). The last
trace is the writer of `+0xC0`: a server message (then the sidecar decodes it) or
a local decrement seeded from `spawnWaveTime` (then the browser seeds it the same
way). `spawn-timer.js`'s wave formula is the local-decrement model; if `+0xC0`
proves server-sent, swap to decoding that field.

**Landed + lab-verified: the countdown is drawn.** `net-room.js` `spawnCountdown`
measures the wait off the sidecar's server `clock` (`net-sidecar.js` `out.clock`)
from when the page first has no body, against the wave params (15/5), and
`deploy-screen.js` `paintDeployChrome` draws "TIME TO SPAWN: N" / "SELECT A SPAWN
POINT" centred near the top, repainting while it ticks. Bridged into the deploy
and test-hooks bags (`spawnCountdown`); `window.__spawnCountdown` reads it.
Verified headless against the live lab (el_alamein, a cdbot sidecar): on the
deploy screen the line read `TIME TO SPAWN: 11` and ticked `3, 2, 1, 0` then held
at the prompt -- the retail shape (count to the wave, then "select a spawn
point"). The spawn stays server-gated (`askServerSpawn`/`standServerSpawn`), so
the number is the client's own estimate, never a gate on the real spawn.

**Remaining (retail-only):** confirm N matches the retail client's number in the
lab -- if the sidecar `clock` phase differs from the server's wave grid the
displayed N can sit up to a wave (15 s) off, though the tick and the "due at 0"
shape are right. Settling it means either observing one real respawn (the moment
the server stands the body IS a wave boundary -- learn the phase from it) or
tracing the `+0xC0` writer (server message vs local decrement) in BF1942.exe.

**Stage 2 still open:** a DRIVEN hull (tank/plane/ship) still takes its predicted
LEVEL copy, so when the server spawns one away from its level pad (a respawn, a
captured-flag vehicle) the predicted copy binds to the wrong node and can sit
metres off. Porting the drivetrain (`vehicle-instance` -> `hull-bodies`
`bodyScene`/`adoptDriven`) onto the server entity's group -- which already has a
collider owner and Armor -- closes it; the group needs a `bodyScene` entry and
`bodySpecFor`. Needs the owner's live confirm (driving feel/collision).
