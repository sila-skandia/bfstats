# One vehicle instance per hull (2026-09-23, design)

## The bug that exposed it

A bot drives a Sherman; the human takes its gunner seat. The tank's engine is
heard moving, the human's view stays put, and on exit the hull teleports to
where it really was.

`setPilot` (`viewer/map.html`) builds a `VehicleOccupancy` per occupant and
`ensureDrive` builds a drivetrain per occupancy. `botEnterVehicle` does the
same for the bot. Two drives own one node: the bot's integrates and feeds the
audio, the human's idle one writes the node's transform (the camera follows
`occupancy.root`), and on exit the bot's `applyTransform` moves the node to
its state.

## The flaw

Vehicle-level state is owned by occupants, and the local player's copy lives in
globals (`aircraft`, `car`, `view`, `occupancy`) that the HUD, camera, audio,
input and chase view read. That held while one occupant per hull existed;
bots mounting broke it, and the bot code grew a second copy of enter, leave,
rider position and gun collection.

## The design

- `VehicleInstance`, one per hull, in a registry keyed by the root node. It
  owns: the single drive (built once through `ensureDrive`), the seat rigs
  (`TurretRig` per seat), the gun groups per seat, the body adoption
  (`adoptDrivenBody` / `releaseDrivenBody` / thaw / freeze), and the seat map
  (`seatId -> occupant id | null`).
- An occupant (the local player or a bot) holds `{ instance, seatId }` and
  nothing else. `enter(instance, seatId, playerId)`, `leave(playerId)` and
  `switchSeat(playerId, seatId)` are the only three mutations; the human path
  (`enterVehicle`, `leaveVehicle`, `leaveManned`, `setPilot`) and the bot path
  (`botEnterVehicle`, `botLeaveVehicle`, the seat swap in `botVehicleTick`)
  call them.
- The drive reads input from whoever holds the root seat through the world's
  per-player input (`world.setInput`, already how bots drive). Seat guns fire
  from their seat holder's input.
- Every seat's world position is published by the instance each tick
  (`world.setPlayerPosition` for every occupant), replacing the hand-fed rider
  position in `botVehicleTick` and the local `occupancy.root.getWorldPosition`.
- Camera, HUD, audio, chase view and the cockpit swap look up the local
  player's instance and seat each frame. The `aircraft`, `car`, `view` and
  `occupancy` globals are removed; `stepVehicleBodies` steps instances.
- `seats.js` keeps `VehicleOccupancy` as the seat/rig model but stops owning
  the drive; or it becomes the instance. Either way one object per hull.

## Acceptance

1. A bot drives a Sherman, the human takes the gunner seat: the view rides the
   moving hull, the gun fires, exit leaves the human beside the hull's true
   position. No teleport.
2. The human drives a Sherman, a bot takes the gunner seat (the seat swap and
   `botEnterVehicle` still work) and fires at what it sees.
3. Two bots in one hull swap seats without the hull moving.
4. Every existing recipe in `features/bf1942-ai-research-2026-09-21/
   PARITY_STATUS_2026-09-23.md` and the E2E specs touching vehicles still
   pass; `./scripts/verify.sh` full.

## Sequencing

Start after the parity agent's current run lands, since it is editing the bot
half of the same functions; do the refactor in its own worktree and rebase.

## Part 2: the page becomes wiring (agreed 2026-09-23)

`viewer/map.html` is 19,182 lines with 459 top-level functions and 549
top-level `let`/`const` bindings in one scope; nothing in it can be imported,
which is why `sim/match.mjs` had to copy the bot referee. After the instance
refactor, lift the page script into modules along these seams, each with an
explicit interface and no reach into another's state:

1. `bot-referee.js`: bot fire resolution, damage, death and respawn, capture,
   seating (`botEnterVehicle`, `botLeaveVehicle`, the seat swap,
   `botVehicleTick`), the enemy tables feed. The page and `sim/match.mjs`
   import the same copy; the copy in `match.mjs` is deleted.
2. `vehicle-instance.js`: the registry from Part 1 (drives, seats, guns, body
   adoption, seat position publishing).
3. `local-player.js`: the human's entry, exit, seat switch, input sampling,
   camera and chase view, cockpit swap; it consumes a `VehicleInstance` and
   the world, nothing else.
4. `capture.js` and `spawning.js`: flags, tickets, the deploy flow, spawn
   selection for humans and bots.
5. `hud-feed.js`: what the HUD reads each frame, as a plain object built from
   the modules above; `hud.js` stays the renderer.
6. `level-load.js`: scene, collider, nav grids, water, damage and AI data
   loading, returning one `level` object the others take as a parameter.

`map.html` ends as the loader, the frame loop and the wiring of those
modules. Rules for the split: no new behaviour; every function moves with its
tests; module-level state becomes fields on the object the module exports;
globals the modules still need are passed in, not read from the page scope.
Only after this, split any module where two subsystems share a file
(`ground.js` wheels / tracks / suspension first).

Acceptance for Part 2: `map.html` under 3,000 lines; `sim/` imports the
referee rather than copying it; the full `./scripts/verify.sh` (E2E included)
and every `tests/` suite pass; the live recipes in
`features/bf1942-ai-research-2026-09-21/PARITY_STATUS_2026-09-23.md` still pass.
