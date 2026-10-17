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

## Measured after the first three slices (2026-10-17, probe on the lab server)

| Check | Before | After |
|---|---|---|
| Vehicles on the field | the level's 59, bound to the server's by template and proximity, a failed bind drawing nothing | the server's 46, every one loaded, collidable and seated |
| Boarding a server-respawned hull | impossible where the bind failed (walked through it) | entered a Tiger and drove it 25 m, the server agreeing on netId 566 |
| Spawn error, first reading after deploy | 224 m, 76 m, 76 m, 51 m, one hard correction a life | 0.5 m on a death-and-respawn the server placed elsewhere, zero hard corrections |
| A hull's hit points | the page's own abandon clock could wreck one ten seconds early | the clock cannot reach it (`spawned: true`, EMT-11); the server's `hull` row overwrites any local bite |

### An open measurement question: headless walking speed

A headless probe walked at 0.1-0.4 m/s where another headless page on the same
machine and the same server did 3.16. It is **not** the mode: the same page is
equally slow with `?authority=1` off, with one browser running and with two. It
is not the collider either (the slowest run had one registered owner in the
whole world). Unexplained, and recorded here so nobody re-derives the two
wrong attributions that were made on the way (first the per-frame collider
publish, then browser contention). A real page on a real GPU has not been
measured at all; that is the number that matters and it needs the owner.

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

## Work, in order

1. Ghidra: settle GUN-2b, and read what the client is sent about its own and another
   player's turret. This unblocks both the turret rate and the seated correction.
2. The entity seam: create and destroy page entities from the server's object table.
3. The authority seam: strip local damage, destruction and hull simulation in server
   mode.
4. The spawn: wait for the server's point instead of predicting one.
5. The seated aim correction, on the back of (1).

Each step keeps the single-player and room paths untouched; the mode is chosen at join.

## Open

- Everything above. Nothing is built yet.
- The tonight fixes that patch symptoms of this (deaths, seats, respawned vehicle
  binding, server rounds, torso twist, held weapon) are in `../udp-sidecar/` and are
  worth keeping until the seam replaces them.
