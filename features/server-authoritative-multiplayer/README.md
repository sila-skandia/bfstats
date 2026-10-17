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

## The open engine question this depends on

**GUN-2b** (`../bf1942-engine-reference/ledger.md`): what magnitude the client delivers
as `PlayerInput[c_PIMouseLookX/Y]`. Until it is read nobody can say what rate a turret
really turns at, and `viewer/seats.js` `TURRET_SPEED_SCALE` must be left alone. The wire
reserves headroom to +-16 (`PlayerAction::set` packs each input with
`floatToFixed(v, 12, 16.0f)`), so an input normalised to +-1 would leave 15/16 of the
encoding dead. The trail stops at the client's `ControlMap.addAxisToAxisMapping`
registrars, `FUN_006bba90` / `FUN_006bbd90`. The 13x measured above is a live data point
for that row.

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
