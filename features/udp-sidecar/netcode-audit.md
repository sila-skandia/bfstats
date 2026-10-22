# Netcode audit: the sidecar against the engine, and why the page vibrates

Started 2026-10-21. Scope: the play path the browser uses against a real server,
meaning `tools/bf1942-models/sidecar/` plus the page's own prediction and
correction in `viewer/net-room.js`, `viewer/net-sidecar.js` and
`viewer/netcode-reconcile.js`. The engine evidence is `bf1942_lnxded.static`
(the named ground truth for everything a client sends and everything a server
sends a client) and the reads already recorded in
[wire.md](wire.md) and [netcode.md](../bf1942-engine-reference/subsystems/netcode.md).
Nothing here was checked against a live round; each finding says what would
confirm it.

The owner's report: play is solid, but at times it is noticeably more jittery
than the retail client, with the HUD and the object the player spawned in
appearing to vibrate.

## 1. What the correction path actually does

Four loops. The first three are driven by the server's acknowledgement and
apply their error whole; the fourth has no error to apply.

| loop | where | error closed | cadence |
|---|---|---|---|
| own soldier | `createReconciler({ smoothing: 1, facing: 'acked' })`, `viewer/net-room.js:1429`, applied at `:1800` | position x/z, facing, view pitch | every snapshot |
| own hull (driver) | `createHullReconciler`, `viewer/netcode-reconcile.js:325`, applied from `correctDrivenHull` `viewer/net-room.js:1158` | position x/y/z, orientation, velocity | every snapshot |
| own turret (seated) | `createAimReconciler`, `viewer/netcode-reconcile.js:412`, applied from `correctSeatAim` `viewer/net-room.js:1134` | each axis angle | every snapshot |
| everything else | `xfAt` `viewer/net-sidecar.js:915` | none: interpolation at now - 100 ms, then extrapolation | per frame |

"Every snapshot" is the server's ghost rate, and it is the rate the control
object is sent at, not the object's change rate.
`GameServer::processGameStateAndSendPackets` `0x08139420` calls
`GameServer::updatePlayerControlObject` `0x081377d0`, which calls
`GhostManager::updatePlayerControlObject` `0x08142210`; that sets the
per-connection `hasControl` flag (`+0x94`) and stores the acked serial, so the
control state and the serial echo inside it are written on every send, 20 times
a second by default and 10 once the choke has lowered the rate (R-1). The
corrections therefore land at that rate.

The soldier and the turret are closed whole by construction (`smoothing: 1`,
and `createAimReconciler` has no smoothing argument). The hull has no smoothing
knob at all: `createHullReconciler.accept` writes `dx`, `dy`, `dz` and the
orientation delta straight onto the live body (`netcode-reconcile.js:345-361`),
with no deadband, so a micro-metre disagreement still moves the hull.

This is the retail client's law, and the comments say so with citations
(`readControlObjectState` `0x004968a0` sets the state whole, then the handler at
`0x00491c90` re-runs the unacknowledged actions). The part that does not carry
across is the precondition.

## 2. Why retail gets away with it and we do not

A retail client's correction at the acked tick is structurally zero. The client
has run the same words through the same integrator from the same starting state,
so when it drops the acknowledged actions, sets the server's transform and
velocities, and re-runs the pending ones, it reproduces the server's trajectory
exactly. That is why the control state carries velocities at all:
`readControlObjectState` restores position, rotation and `vecA`, so the replay
starts from the server's position and velocity rather than from a position
carrying the client's own velocity.

Our page runs a different integrator. The hull rides `viewer/suspension.js` and
the tracked and wheeled solvers, with our spring constants, our contact
response and our gearbox; the soldier runs `world.js` with our movement ramps.
Neither is the engine's. So the error at the acked tick is not noise around
zero, it is the difference between two integrators accumulated over a round trip,
and it is re-created in full between every pair of snapshots.

Applying that whole, 20 times a second, is a sawtooth. On foot it is a few
millimetres to a few centimetres of position and a fraction of a degree of
facing. In a hull it also moves the body vertically and rotates it, and both the
camera and the vehicle HUD hang off the hull node (`local-look.js`
`applyVehicleInterp` writes the drawn pose on the same node the seat camera
reads), so the whole view inherits it while the screen-space HUD does not. If
the HUD itself appears to move, what moved is the camera.

Recorded magnitudes from the earlier live rounds, which are the size of the step:

- own soldier: error median 1.8 cm, p90 12 cm at the acked tick (wire.md §20,
  the measurement that set `smoothing: 1`);
- own hull: 2 to 65 mm at the acked tick through a 160 degree turn (wire.md
  §31).

A 2 cm step at 20 Hz on a body the eye is attached to is visible. A 12 cm step
is a lurch.

### The vertical term, which is the one that reads as vibration

`createHullReconciler` corrects `y` as well, whole, and `y` is where our sim
diverges most confidently: both sides suspend the hull on springs, and the two
spring sets have different constants and different damping, so the two bodies
bob at the same frequency with a phase and amplitude difference. A phase
difference is exactly the shape that a whole-error correction cannot fix: it
reverses sign every half cycle, so the correction pushes one way, the local
simulation pushes back, and the loop oscillates at the ack rate instead of
decaying.

A model of it, run against the shipped reconciler: a 3 cm, 2 Hz bob 0.6 radians
out of phase, with the ack two ticks behind, produces a mean 4.5 mm and a
maximum 7.1 mm vertical step on every snapshot; three ticks behind, 12.3 mm mean
and 19.3 mm maximum. Driven at 20 Hz that is a 5 to 19 mm buzz in the cockpit
which no amount of driving skill removes. Closing a quarter of the error per
snapshot (the soldier's own 0.25 share) drops the step from 4.5 mm to 1.1 mm
mean, and the body still converges on the server's pose.

None of these are measurements of the page. They are the mechanism, and the
number to beat.

## 3. The fallback that turns a small error into a large one

`correctDrivenHull` needs the server's hull state *at the acked tick*. It takes
it from the ack row (`st.selfHull`, `viewer/net-sidecar.js:1370`), and the row
is only written when the control state's decoded body carried all three of
`pos`, `rot` and `vecA` (`sidecar/sidecar.mjs:543`). Those three are
mask-gated, not unconditional: `readSimpleObject` reads each only when its mask
bit is set (`sidecar/ghost/pco.mjs:114-129`, bits `0x2`, `0x1`, `0x4`), because
a control state is the object's ordinary delta against its ring reference. A
tick where the velocity did not change carries no `vecA`. A hull whose
controller vectors are not written at all (the `physics` flag the control
decoder tries both ways, `sidecar/ghost/control-state.mjs:104-121`) carries none
of them.

When that happens the page does not skip the correction. It substitutes the
newest transform (`net-room.js:1189-1190`):

```
const exact = acked && acked.id === id && acked.ack === ack ? acked : null;
const plan = hullLedger.accept(exact ?? pose, ack, st);
```

`pose` is `remoteVehicle(id)`, the newest sample with no lookback, and it
describes the server's *present*, not the acked tick. Handed to a reconciler
that measures against the ledger entry for `ack`, it reads the client's own
motion since then as error and adds it to the body as if it were a correction.

Measured with the shipped reconciler, a hull at 12 m/s with the ack two ticks
behind and both sides on one integrator, which isolates the fallback: the acked
row gives a 0 m correction on every snapshot, the path as intended, and the
fallback gives a mean 0.27 m and a peak 0.80 m. A
third of a metre of horizontal step 20 times a second, in whichever direction
the sign falls. This is the defect wire.md §20 records as fixed ("about 2 m at
12 m/s, read as error and dragged back"), and it returns on any snapshot where
the delta leaves the fields out.

Two fixes, both small:

1. Carry the hull state forward in the sidecar the way the soldier's aim is
   carried (`carrySelfAim`, `sidecar/soldier-ghost.mjs:200`). Merge each acked
   control state over the previous one per netId, so every `k:"ack"` row
   carries a complete state at that tick. This is what the engine's own client
   does implicitly, since its receive path keeps the fields a delta leaves out.
2. On the page, treat a missing exact ack state as "no correction" rather than
   "correct against the newest pose". A missed correction costs one snapshot of
   convergence; a wrong one costs a metre.

The second alone removes the hazard; the first makes the correction complete
again. Both are needed for a hull whose velocity is rarely in the delta.

## 4. Divergences law by law

The engine's laws, and where the sidecar stands.

| law | source | state |
|---|---|---|
| `PlayerAction` 104 bits, six 12-bit axes, u32 buttons | W-1..W-5 | conforms (`sidecar/input.mjs`, `encodeInput` in `viewer/netcode.js`) |
| one action consumed per tick, empty is zeroed input, trim to 4 dropping oldest, dedupe by serial | D-1..D-4 | conforms on the server's side; the sender paces one new word per tick and repeats the previous two under their own serials (`input.mjs:322-392`), which the dedupe makes free |
| backlog over 9 ticks collapses to 1 | D-4 | deliberately not copied: the page sends every word it ran, paced one per tick. Sending a burst got about half of them trimmed and the server simulating zero input (wire.md §20) |
| join: ServerInfo, ServerInfo2, Challenge, world dump, DataBaseComplete, Simulation | J-1..J-6 | conforms (`sidecar/session.mjs`) |
| disconnect is packet type 0xd | J-3 | conforms |
| rejoin inside the 180 s reconnect slot with the four digits | §29 | conforms (`sidecar/rejoin.mjs`) |
| events: 7-bit type, block of u8 count, u5 index, u1 resend | NET-3 | conforms |
| event block resend: a block whose datagram was reported lost is replayed from the save queue, new blocks are held while unconfirmed is at the cap | `GameEventManager::transmit` `0x0812d770`, `handlePacketStatus` `0x0812df00` | conforms in shape (`session.mjs:170-195`); the cap is 15 in the sidecar, the server's `+0x9c` is unread |
| ghost block: u32 tick, u8 count, hasControl, the control state, then per object a 2-bit action, netId, and the body | NET-4 | conforms |
| ghost scope: full updates within view distance + 20 m, own side everywhere | §19 | the server's choice, nothing for the client to implement |
| the control state is written every block, carrying the acked serial | `0x08142210` | conforms |
| remotes drawn 100 ms behind, interpolated, extrapolated up to 1200 ms, 16 samples | `predict` `0x08237a90`, `interpolationTime`/`extrapolationTime` | conforms (`net-sidecar.js:88-112`, `xfAt`); the engine's "pair closer than 1 ms draws the newer sample whole" rule is not implemented |
| own control object: state at the acked tick, whole, then the pending actions re-run through the physics | `0x004968a0`, `0x00491c90` | the state half conforms, the re-run half does not exist: we shift the ledger instead of re-running. Equivalent for a linear integrator, not for a sprung hull (section 2) |
| `UpdateRate` (0x10) exists in the engine's event table | `GameServer::setUpdateRate` `0x08133010` walks every connection into `changeUpdateFrequency` `0x08132ff0`, which writes the rate (`+0xc`); nothing in that path queues the event, so what (if anything) tells the client its rate moved is unread | not read at all (section 5) |

Two smaller ones worth knowing:

- `xfAt` extrapolates position along the last pair's velocity but holds the
  rotation, so a hull turning while it moves is drawn with its position a
  sample ahead of its heading. The engine's `predict` does the same for the
  transform, so this is parity, but it is why a turning tank's hull can look
  like it is sliding for a frame.
- A ghost block that fails to frame (`session.mjs:345`, `reason: 'frame-underflow'`)
  keeps the records it decoded and drops the rest of the block, so one body that
  does not size costs every later object in that block its sample. Nothing is
  wrong with the decoders today; the review log is the instrument that says so,
  and it should stay empty.

## 5. Server events decoded but not used

All 51 event types `GameEvent::initEvents` (`0x0811bee0`) registers have a
decoder in `sidecar/events.mjs`, plus bf42++'s three. Decoding is complete. The
gaps are in what the page does with them.

| id | event | state |
|---|---|---|
| 0x04 | Simulation | only the first one is read, to mark the join. A later `running = false`, a world the server has stopped stepping, is not propagated, so the page keeps predicting and sending |
| 0x10 | UpdateRate | not read. The engine can change a connection's ghost rate (`GameServer::setUpdateRate` `0x08133010` walks every connection into `changeUpdateFrequency` `0x08132ff0`, which writes `+0xc`); what tells the client is unread, but the page's 100 ms lookback and the sidecar's 30 Hz pacing are fixed regardless |
| 0x0e | SetTempCamera | not read. No spectator camera |
| 0x26 | ReqScoutCamera | not read. No scout camera |
| 0x12 | Vote | not read in either direction. The server runs a vote system (`updateVoteSystem`); a page player cannot start or answer a vote |
| 0x13 | Map | not read. The server's map list never reaches the page |
| 0x17 | WelcomeMsg | parsed for bf42++ settings only. Retail prints the line; the page shows nothing |
| 0x3b | TriggerObjectSpawner | not read. A spawner the server enables or disables is invisible to the page, which draws pads and hulls from createObject alone |
| 0x09 | SetDefaultVehicle | used to flag an on-foot control object; the page relies on derived control rows instead. Works, but the wire's own word is ignored |
| 0x03, 0x19, 0x2b, 0x37 | Debug, CheckSum, PBFragment, SessionId | no action, by design |

## 6. Client traffic the retail client sends and the sidecar does not

| event | what the server does with it | state |
|---|---|---|
| 0x02 Ack | `GameServer::handleGameEventManagerEvent` `0x08135cb0` case 2: XORs the u32 with the connection's `+0x148` and compares it against the server's own value (`+0xe8 ^ 0x61314213`), gated on `Setup::getServerContentCheck()`, and writes the result to the connection's `+0x170` | the sidecar sends `Ack { value: 0 }` once, at DataBaseComplete. On a server with the content check off (the lab) the comparison is bypassed and the flag is set true, which is why this has never mattered. On a server with it on, zero cannot pass |
| 0x19 CheckSum | the client's file/content sums | never sent. Same family as the challenge: the lab does not ask |
| 0x33 Suicide | ends the player's own life | not offered. A page player who is stuck has no way out but the server |
| 0x12 Vote | records a vote | not offered |
| 0x0d SetPlayerName | renames the player | the page names itself at join only |
| 0x3d RemoteCommand | runs a server command with a password | not offered (correctly) |

The content-check pair is the one to know about: everything else here is a
feature a player can live without, and this one decides whether a server with
the check turned on sees this client as verified. It is the same caveat the
challenge already carries in [wire.md §4](wire.md).

## 7. What to change, in the order that pays

1. **Stop the fallback** (`net-room.js:1189`): no exact acked state, no
   correction. Two lines. Removes the 0.3 to 0.8 m periodic drag when a control
   delta leaves the pose or the velocity out.
2. **Carry the hull state forward** in `sidecar/sidecar.mjs`, as `carrySelfAim`
   does for the soldier, so the ack row is always complete. Then remove the
   fallback's reason to exist.
3. **Give the hull correction a share and a deadband**, the way the soldier's
   has one: close a fraction of the acked-tick error per snapshot (0.25 is the
   soldier's measured default), skip anything under a few millimetres or a few
   hundredths of a degree, and keep the whole-error path only for the big
   divergence that is a different event. The physics stays on the server's
   curve because the correction still converges; the eye stops seeing the
   integrator difference as a buzz.
4. **Treat `y` and the orientation as the terms to damp first.** They are where
   the two suspensions disagree, and they are what a camera inside the hull
   turns into vibration. Measure them separately: `createHullReconciler` already
   returns `errorY` and `oriError` for exactly this.
5. **Find out whether a connection's ghost rate can move under us** and, if it
   can, scale the lookback with it. `changeUpdateFrequency` `0x08132ff0` writes
   `conn+0xc` and the choke calls it; nothing read so far tells the client. At
   10 Hz the samples are 100 ms apart, which is the whole lookback, and every
   estimator in the page assumes 20.

Items 1 and 2 are checkable by a harness against the real modules without a
server. Items 3 and 4 need one drive on the lab, because the numbers they turn
on are the ones `correctDrivenHull` already publishes (`room.netHullCorrection`:
`error`, `errorY`, `oriError`, `speedError`). Item 5 is a binary read.

## 8. Open, and what would settle it

- Whether the hull's control state leaves `vecA` out often enough to trigger the
  fallback. One lab drive with a counter on `c.body.vecA == null` in
  `sidecar.mjs` answers it in a minute, and it decides whether section 3 is
  first or merely prudent.
- The size of the hull's `errorY` and `oriError` at rest and under way on a real
  map. Those two numbers, not `error`, are the vibration.
- What the server does with `+0x170` when the content check fails. Reading the
  readers of that field in `bf1942_lnxded.static` settles the Ack finding in
  section 6.
- Whether a retail client sends one action per tick or three to a datagram
  (R-2's open question). The sidecar's three-record datagram is safe either
  way, since the receiver dedupes by serial.

## 9. The two the owner reported on 2026-10-21, and what they were

Both were page-side. The authority's send order, read at last, rules it out as
the source of either: `GameServer::processGameStateAndSendPackets` `0x08139420`
runs `updatePlayerControlObject` (`0x081377d0`) and then `updateGhostManager` and
`GhostManager::update` before `transmitMsgs`, so the pose a ghost carries in the
packet that acks input serial N is the pose after N was applied. A yaw residual
measured against that pose is the page's, not a one tick lag in the authority.

### 9.1 The view yaw jumped when the twist folded (fixed)

`composedViewYaw`, `viewer/net-sidecar.js`. The view is the body yaw plus
`VIEW_TWIST_DEG` times the twist register, and the correction closes to it. The
engine folds a standing turn's twist into the body on a moving tick
(`BFSoldier::handlePlayerInput` `0x08273c70`: the body turns by `-3 x twist` and
the register is zeroed), and the fold preserves the view only if both halves are
read at once.

They do not arrive at once. The live recording of 2026-10-20 11:16 (`sidecar-2026-
10-20-11-16-04.ndjson`) has a block where the body turns 26.2 degrees with the
twist register unchanged, and the register clears to zero a block later. Read
literally, `body + 3 x twist` drops the view 26.2 degrees on the first block and
puts it back on the second, and the reconciler applies each half as a whole
correction to `body.yaw`: a flick, then the flick back.

The composition is now tracked rather than recomputed. A block whose body turn
is exactly `3 x twist _before` is a fold's body half and moves the view by
nothing; the register's clearing block is the other half, matched by the negative
of that turn. Anything else moves the view by `dbody + 3 x dtwist` as before, and
the thresholds are 1.5 degrees. `tests/sidecar_client_harness.mjs` scenario
`viewFold` feeds the two-block split and the one-block fold and
`test_sidecar_client` pins it: the literal formula swings 26.1 degrees and back,
the tracked one moves 0 and settles on the same yaw as the literal one.

### 9.2 A remote soldier did not look up (fixed)

`twistTorso`, `viewer/netcode-render.js`. Only the twist was applied to the spine,
so a remote aiming at the sky stood level, and his rounds (which already took
`aim x 2.5`, `net-remote-rounds.js`) left his muzzle from above his shoulder.
The spine now takes the same aim as a pitch about its own right axis, clamped to
60 degrees, eased with the twist. The register's law, re-read at `0x08273c70` and
worth writing down because the clamp is not the page's: `+0x284` accumulates the
pitch axis with no gain of its own and is clamped by the soldier template's up
and down angles (`template+0x61`, `template+0x62`), scaled by 0.4 on foot, while
`handleUpdate` poses the camera at `-2.5 x` the register.

The same read settles the standstill turn: at the twist's clamp the axis is not
zeroed (`handlePlayerInput` zeroes the tick's yaw only while the register is
inside its limits), so a standing soldier who keeps turning turns his body at the
clamp. That is how retail spins in place, and it matches the page's single-yaw
law of 3 degrees a unit standing and 6 moving.

### 9.3 What is still open: the size of the residual at the end of a turn

`__net().jumps` now carries the last twelve corrections that moved the view more
than 0.2 degrees, each with `yaw` and `pitch` in degrees, `err`, `hard`, `acked`
and `ms` since the previous one. A single burst of one or two entries after a
turn stops is a correction landing late; a steady run during the turn is a rate
mismatch. Either way the numbers say which of the remaining candidates it is:
the page's tick to serial mapping, the moving turn's 2x taken on input axes while
the authority took it on its own (both use the input axes, so this is only a
question of the tick they were read on), or the twist reaching its clamp mid
turn.

### 9.4 The first attempt at 9.2 leaned the man over (fixed)

Reported the next drive: looking up made the model lean left or right. The
pitch was being taken about the WORLD x axis. A man facing +Z has the two axes
coincident and nothing shows, but at any other facing the world x is somewhere
between his forward and his side, so the rotation rolls him. The axis is now his
own right, `(cos yaw, 0, -sin yaw)` for the page's `(sin yaw, 0, cos yaw)`
forward, taken through the parent's inverse before it is used. `state.yaw` is
degrees in this renderer (`netcode-render.js` builds the group's Euler with
`rad(state.yaw)`), so the cosine and sine are of the body's own yaw.

### 9.5 Joining a sidecar that had been running replayed the round (fixed)

`sidecar.mjs` kept every line it wrote in an array and, on a page connecting,
sent the lot before `live`. The file is a buffered stream, so the array existed
to stop a joining page losing rows that had not been flushed (2026-10-16), but
it grew with the round: a sidecar left up for a while replayed tens of thousands
of rows on connect, every event of the round included, and the page processed
them as if they were happening now. That crashed the browser (2026-10-21).

The array is gone. What is kept instead is the state a joining page needs and
nothing else: the header and animation table, the level and server identity,
`createPlayer` and `control`, one `o` row per live object, the `j` and `jn`
entries per parent, and one batched row each for transforms, states, hit points
and control points, plus the latest `ps`, `tk` and `win`. Despawned objects are
dropped from it. Memory is bounded by the number of objects rather than by the
length of the round, and `--out` is unchanged.

Measured on the lab: a page connecting to a sidecar 22 seconds into a round
receives 108 lines (56 KB) up to `live`, with the only events being
serverInfo, serverName, setLevel, ten createPlayer and one control, and no
rounds or despawns. The same connection used to receive the whole recording.

What a joining page therefore does NOT get is history it can see: a round
already in flight shows from the moment it connected. That is the intent.

### 9.6 Reading the pan residual

`__net().trace` carries the last 24 acknowledged ticks with the server's own
view advance split into its terms (`dv`, `db`, `dt`), this page's own facing
advance over the same two serials (`dl`), and the correction the ack asked for
(`yaw`, `pitch`, `err`). `dv` must equal `db + 3 x dt` on every
ack, since that is how the composition is defined. Two readings:

- A `yaw` that is nonzero while `db + 3 x dt == dv` means the page's yaw at that
  serial was not the server's view at that serial, and the fault is upstream of
  the composition: the axis the page applied and the axis in its input word
  disagree, or the serials are off by a tick.
- A `yaw` that is nonzero where `dv != db + 3 x dt` means the fold's two halves
  landed in different blocks, which is what `composedViewYaw` is meant to
  absorb, and the numbers will say so directly.

`dl` against `dv` is the same disagreement seen from the page's side. Equal
`dl` and `dv` with a nonzero `yaw` is not possible, so a nonzero `yaw` always
lands in one of the two readings above, and the pair says which.

### 9.7 What the screen recording of 2026-10-21 measures, and the settle

`~/jitter-hermes.mp4` (23.6 s, 1280x720, 60 fps). Phase correlation between
consecutive frames over a terrain band, with the HUD and the weapon out of the
window, gives the view's own motion:

- 0 to 9 s, walking and slow turning, 200 to 800 px a second of travel at 640 px
  width.
- 9 to 16 s, standing, 30 to 130 px a second, which at the 57.3 degree lens
  (0.09 degrees a pixel) is 3 to 12 degrees a second of drift with no input.
  That is the bumpiness the recording opens with: the view never fully settles.
- 17 to 23 s, the pans, 1000 to 2800 px a second, and monotonic frame to frame.
  The two largest single frame outliers the correlation reports (a step of 185
  and 176 px the wrong way) were checked against the frames themselves: the palm
  trees and the hangar advance in order across them, so those are repeat texture
  failures in the estimate, not jumps.

So the recording confirms the drift and shows the pans are smooth where the
hand is moving. It cannot size the correction that lands when the hand stops,
because a 4 degree step and a 45 px one are not separable from the texture noise
here.

The settle, then, by feel rather than by proof: `createReconciler` takes
`yawShare`, how much of the acked facing error one acknowledgement closes, and
the sidecar path passes 0.5 instead of closing it whole. A 4.6 degree residue
becomes 2.3, 1.2, 0.6, 0.3 across four acks, 200 ms, instead of one frame's
snap; a 10 degree one is under a tenth of a degree by the seventh. It is
monotonic and does not overshoot (`test_netcode_reconcile`, scenario `p`). Hard
corrections still take the authority's facing outright and the position law is
untouched, so this changes what a correction looks like, not where the body
ends up.

That is a treatment of the symptom on purpose. Section 9.6 is still how the
cause gets named, and `__net().trace` is the reading that names it.
