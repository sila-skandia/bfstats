# seams-world

The physical interactions between subsystems. There are no ledger rows of my own. I worked from an
interaction matrix, checked each cell against the ledger, `subsystems/collision-response.md` and
lnxded, and ran the page's own modules headless where a cell needed it. The scratch harness is
`<audit scratch>/seams-world-harness/deck.mjs`. It is a copy of `tests/hull_runover_harness.mjs`'s
staging plus a deck test, and nothing in the repo was edited.

## Summary

| class | count |
|---|---|
| MISSING | 3 |
| DIFFERENT | 3 |
| PARTIAL | 2 |
| UNREAD | 1 |
| BUILT | 18 |
| NOT-GAME | 0 |

Top findings:

1. **MISSING, high.** A moving hull does not carry what stands on it. Measured headless: a soldier
   on a deck moving at 8 m/s is left behind at exactly the deck's speed, and falls off the end of a
   40 m deck within 3 s. This covers ship and carrier decks, the top of a tank, riders standing in a
   landing craft, trains, and a parachutist who lands on a moving hull.
2. **MISSING, high.** An explosion never pushes a vehicle. KNOCK-4 and KNOCK-5 push every root
   object that has a physics node. Ours pushes soldiers only. This is the TNT jeep launch, and a
   jeep hopping off a landmine.
3. **MISSING, medium.** Soldiers never push each other. Retail separates two soldiers to 1.0 m.
   Ours lets them walk through one another.
4. **DIFFERENT, medium.** A wreck is frozen into scenery. Retail's wreck stays a live body: it rolls
   down slopes, gets shoved by rams and blasts, and sinks.
5. **DIFFERENT, medium.** Ladders are indexed once, at the level's baked poses. A ship's
   `ClimbingNet` stays where the ship was moored after the ship sails away.
6. **DIFFERENT, medium.** The room server's collider has no ladders at all.

## Findings (MISSING / PARTIAL / DIFFERENT / UNREAD), highest impact first

### [MISSING] [impact: high] [effort: M] Standing on a moving hull: nothing carries the soldier
- **Retail.** Collision-response.md section 8 (`ResponsePhysics::addFriction` 0x0825b6e0):
  - Object contacts feed the share-scaled relative contact speed into the friction solve. A light
    body standing on a heavy moving one is therefore carried along.
  - `setSurfacePositionalSpeed` is written only by BFSoldier, and is their own command.
  - The ships research (bf1942-ships-research-2026-09-22 section 3.2, SPAWN-6) concludes that a
    soldier walking on a moving destroyer is "an emergent property of the ordinary contact path",
    with no parent link.
  - I checked lnxded for any other ride mechanism. `BFSoldier::handleCollision` 0x0827d3b0 does
    store the object stood on in `+0x558` (0x0827da4c/0x0827db44, gated on the contact normal's
    y > 0.1 at 0x0827da00). Its only reader outside handleCollision is
    `BFSoldierNetworkable::updateStateMask` 0x082228e4, which turns it into a networked bool
    (`setne +0x84`). So the carry is the friction's relative speed alone.
- **Ours.**
  - `walking-body.js` `#contactLaw` takes `V = v - vCmd` against an absolute world frame. The
    floor's own velocity is never subtracted.
  - `soldier-resolve.js` `pushOutOfHulls` only pushes along contact normals. On a level deck that
    is vertical, so it never moves the soldier sideways.
  - `vehicle-entry.js` gives a soldier the hull's velocity when they get out (`Soldier.carry`). The
    friction then bleeds that speed off against the ground frame, so a soldier who steps out onto a
    moving deck slides aft.
- **Measured.** The page's `SoldierBody` and `WorldCollider` ran headless, with a 40 x 10 m deck
  box published through `setMovedOwner` each tick (`deck.mjs`). The soldier stood still, with no
  input.

  | deck motion | soldier's place in the deck frame after 3 s | soldier's vx | what happened |
  |---|---|---|---|
  | 1 m/s | 3 m aft | 0 | left behind |
  | 3 m/s | 9 m aft | 0 | left behind |
  | 8 m/s | 24 m aft | 0 | off the stern, y 2.0 down to 0.04 |
  | turning 0.2 rad/s, standing 15 m from the pivot | 8.6 m sideways | 0 | off the side |

  Expected but not run: in a walled hull (an LCVP or a tank's turret ring) the aft wall would
  bulldoze the soldier through `pushOutOfHulls` instead of carrying them.
- **A player notices** this whenever they stand on anything that moves:
  - A destroyer or carrier under way on Midway, Coral Sea or Guadalcanal.
  - Riding on the back of a tank, a common way to travel.
  - Standing in a landing craft on Omaha.
  - BF1918's trains.
  - A paratrooper landing on a moving ship.

  The deck slides out from under them, or they get pressed against the aft wall.
- **To build.**
  - In `pushOutOfHulls`, record the hull under the foot vertex and its tick velocity (it already
    has `vhx/vhy/vhz` per moved hull).
  - Have `#contactLaw` subtract that velocity before the latch: `V = v - vHull - vCmd`, retail's
    relative speed.
  - Include the angular part. The published `fwd` matrix gives the point velocity under the foot
    as the difference of the two ticks' transforms applied to the contact point.
  - Files: `viewer/soldier-resolve.js`, `viewer/walking-body.js`, and the same path on the server,
    `server/level-instance.mjs` `publishHullPoses`.
  - Test: extend `tests/hull_runover_harness.mjs` with the deck cases above.

### [MISSING] [impact: high] [effort: S] An explosion never pushes a vehicle (or a wreck)
- **Retail.**
  - `GameServer::handleExplosionOnObject` 0x08156500 (KNOCK-4) pushes any victim that has no
    parent and has a physics node, once the priced damage is above 0.
  - The push is `F = explosionForceMod * forceOnExplosion / radius * exposure`, capped at
    `explosionForceMax` (default 300).
  - KNOCK-5: it is applied with `setIsAwake` and `addAccelerationAtAbsolutePosition(point, F*dir)`,
    at the blast's point clamped onto the victim's bounding sphere. That spins the hull as well as
    moving it. The row says that non-soldier victims get the same F and direction (without the
    soldier's up term).
  - Vanilla data, read from `Objects.rfa`:

    | template | value |
    |---|---|
    | Willy `explosionForceMod` | 20 |
    | Sherman `explosionForceMod` | 13 |
    | Spitfire `explosionForceMod` | 15 |
    | ExpPack `ForceOnExplosion` | 50 |
    | Landmine `ForceOnExplosion` | 30 |
    | grenades `ForceOnExplosion` | 10 (on the projectile) |
    | rounds that write nothing | 150 |

  - So a Willy next to a satchel takes up to 300 m/s^2 for one tick, about 10 m/s at an off-centre
    point: the flip.
- **Ours.** `knockback.js` `soldierBlastAcceleration` is called from `vehicle-hits.js`
  `throwSoldier` and `server/room-hits.mjs` for soldiers only. No call reaches `RigidBody` or
  `body-world.js` (git grep for explosionForce, blast and knock in `body-world.js`,
  `hull-bodies.js` and `rigid-body.js` finds nothing).
- **A player notices** that TNT under a jeep, a mine, or an artillery shell beside a parked plane
  damages the vehicle but never moves it. The jeep jump with C4 is one of the game's best-known
  tricks.
- **To build.**
  - In the splash pass, for each damaged root body in the body world, compute KNOCK-5's `dir`
    without the soldier's up term and add `F` as an acceleration at the clamped point:
    `RigidBody.addAccelerationAtAbsolutePosition`, the same path the contact solver posts through.
  - Wake the body.
  - A driven hull needs the push handed to its drive (`DrivenBody`), as the contact push is.
  - The room server's splash in `room-hits.mjs` needs the same.
  - Files: `viewer/vehicle-hits.js` (or `projectile-damage.js`), `viewer/body-world.js`,
    `server/room-hits.mjs`.

### [MISSING] [impact: medium] [effort: S] Soldier against soldier: no separation
- **Retail.** `ResponsePhysics::checkObjectVsObject` 0x08259690 has a soldier-soldier branch
  (collision-response.md section 5.5, `features/vehicle-collision-physics/reports/R3-geometry-broadphase.md`
  F12; read in the decompile, signs not re-derived):
  - When both are CID 0x9493, their boxes overlap in y, and `|d| < 1.0`, they are pushed apart
    horizontally to 1.0 m.
  - The push is split by `max(|v.push|, 0.9|push|)`. A seated soldier does not move, and their
    partner takes the whole push.
  - Positions are set directly: no impulse, no damage.
- **Ours.** Nothing. No soldier-soldier test exists in `soldier-resolve.js`, `walking-body.js`,
  `world-soldier-tick.js` or the room server.
- **A player notices** that bots and players stand inside one another at spawns, in doorways and
  on ladders. A soldier cannot body-block a doorway or a teammate.
- **To build.** Add a pass in `world-soldier-tick.js` after the bodies step: an O(n^2) or grid
  pair loop over live on-foot soldiers, applying F12's push to `body.position`. Re-derive the signs
  at 0x082597xx first. The pass runs the same on the server, since it uses `World`.

### [DIFFERENT] [impact: medium] [effort: M] A wreck is frozen scenery; retail's stays a body
- **Retail.**
  - `ResponsePhysicsManager::update` 0x0825d0b0 walks every hull's collidable chain "whatever the
    root's state" (HP-21).
  - Disassembling 0x0825d0b0 to 0x0825d5c0 finds no test of the destroyed flag `+0xed`.
  - `updatePositionalPhysics` 0x08253570 has none either.
  - HP-15: `+0xed` only stops player input.
  - So a destroyed hull keeps integrating, meeting the terrain, being rammed and floating or sinking
    until HP-19's `timeToLiveAfterDeath` removes it. It also takes blast pushes (finding above).
- **Ours.**
  - `vehicle-wrecks.js` calls `page.retireVehicleBody` on death (lines 434 and 552).
  - `hull-bodies.js` `retireVehicleBody` says "A wreck is scenery".
  - The node is frozen (`freezeVehicle`), and its collision stays as a static at the death pose.
  - The only exception is a plane killed in the air, which keeps flying until it lands
    (`visual.falling`).
- **A player notices** in specific cases:
  - A tank killed on a slope stays perched instead of rolling.
  - A burning jeep cannot be shoved off a road or bridge by another vehicle. A tank rams it and
    stops dead.
  - A wreck in water does not settle.
- **To build.**
  - Keep the body in `BodyWorld` on death: no drive, ContactGrip on its wheels as an empty hull
    gets.
  - Retire it at the TTL clear (`clearWreck`) instead of at death.
  - Keep `publishMovedHull` going so its collision follows it.
  - Files: `viewer/vehicle-wrecks.js`, `viewer/hull-bodies.js`, and the room server's wreck path
    (`server/level-instance.mjs`).

### [DIFFERENT] [impact: medium] [effort: S] Ladders are frozen at the level's baked pose
- **Retail.**
  - The ladder is found by contact: `BFSoldier::handleCollision` 0x0827d3b0 records the object for
    a face material 192-195 in `c_CGLadders` (0x0827d437-0x0827d46a, LADDER-1).
  - `getLadderClosestPosition` 0x08280b40 measures in the ladder object's live transform.
  - So a ship's `ClimbingNet` is wherever the ship is.
- **Ours.**
  - `ladder-climb.js` `collectLadders` runs once per level (`level-terrain.js` `buildCollider`)
    and stores `ladderRecord(spec, obj.matrixWorld.elements)`, a world-space frame.
  - Nothing refreshes `collider.ladders` when a hull moves.
  - The header says nets inside ship spawners are indexed, but at their moored poses.
- **A player notices** this on any naval map. Once a destroyer or carrier has moved, the climbing
  net a swimmer uses to get back aboard is not where the net is drawn: it is still at the mooring.
  A soldier on the ladder of a moving ship is not carried either.
- **To build.**
  - Store each ladder's owner and its frame in the owner's baked space.
  - In `soldier.js` (line 1127, the grab test), map through `collider.moved.get(owner).fwd` the way
    `pushOutOfHulls` maps faces. Carry the climber by the hull's move while they hold the ladder.
  - Files: `viewer/ladder-climb.js`, `viewer/soldier.js`, `viewer/level-terrain.js`.

### [DIFFERENT] [impact: medium] [effort: S] The room server has no ladders
- **Retail.** As above. The server is the authority for soldier movement.
- **Ours.**
  - `server/level-data.mjs` builds `new WorldCollider({ heightfield, statics, waterLevel })` with
    no `ladders` (and no `drivableMask`).
  - `git grep -i ladder -- server` finds nothing.
  - The server's `World` steps every soldier through `soldier.js`, whose climb reads
    `this.body.world?.ladders` (null there).
- **A player notices** this in a room (inferred, not run live). A joined player who climbs a ladder
  is climbing on their client only. The authoritative soldier stays at the foot, so the client is
  corrected back down, or the two disagree for the rest of the climb.
- **To build.** Call `collectLadders(root)` in `level-data.mjs` and pass it to the collider, as the
  page's `buildCollider` does. Add a `tests/test_room.py` scenario that climbs a Wake ladder.

### [PARTIAL] [impact: medium] [effort: M] A vehicle on a moving deck
- **Retail.** It is the same relative-speed friction as for soldiers (section 8). A plane's wheels
  on a carrier take the deck's tangent speed (`getTangentSpeed` of both bodies), as do a tank on an
  LCT and a car on a train.
- **Ours.**
  - A held craft on its spawner rides rigidly until the throttle rule lets it go (SPAWN-33,
    `spawned-craft.js`, AI-121). That part is built.
  - After release, `aircraft-ground-law.js` uses the plane's own contact speed. The
    aircraft-ground-law README lists "A moving deck" as open.
  - EoD's LCT keeps its land vehicle held: "no land drive stands on a moving deck once let go"
    (bf1918-extraction README).
  - BF1918's trains: "the faithful coupling is still open".
- **A player notices** this in specific cases. A plane released on a carrier that is under way
  slides aft, and an LCT's tank cannot drive off a moving craft.
- **To build.** The same relative-velocity term as the soldier finding, in `body-friction.js`'s
  contact speed for body-on-body contacts and in the ground laws' wheel contact on a moved owner.

### [PARTIAL] [impact: low] [effort: S] The hull push uses a linear move only, and the share is always 1
- **Retail.** COL-2's share `s = mHull/(mSoldier+mHull)` snaps to 1 only above 0.95.
  `checkObjectVsObject` probes from S in the hull's full moving frame, rotation included.
- **Ours.** `pushOutOfHulls`:
  - It carries S by the published translation alone (`hx/hy/hz`).
  - It always gives the soldier the whole push (both points are stated in the file and in the bug
    note's "Open" list).
- **A player notices** this in edge cases:
  - A long hull pivoting in place (a tank's stern, a ship's bow swinging) sweeps a soldier with a
    rotation the probe does not see. Large turns per tick could tunnel.
  - A motorbike or another light hull shoves a soldier as a tank would.
- **To build.** Carry S through `fwd_now * inv_prev` instead of the translation, and pass hull mass
  through `setMovedOwner`.

### [UNREAD] [impact: medium] [effort: M] Destructible scenery in mods: bridges, doors, breakable trees
- **Retail.** In vanilla, RtR and SW, only a handful of non-vehicle templates carry `hasArmor 1`.
  I surveyed `Objects.rfa` and the level archives:
  - `Window_m1`
  - three `Gibb_concret*`
  - three `scrap_metal*`
  - the `Building*` effect bundles

  Destructible bridges and buildings are a mod mechanism: FH's `brigde_dest`, `Omaha_Bdoor`,
  `quonset_dest*`, `German_Factory*` (fh-mod-extraction/MECHANICS.md, "Destructible scenery"), and
  FHSW's 76 breakable trees (ARM-3). Each is an armoured PCO with no seat. Its wreck tier's effect
  holds a spawner that stands the destroyed model up (EMT-10).
- **Ours.**
  - `vehicle-wrecks.js` registers every placed node that has an `armor` extras block. The splash
    and crash damage reach it, and `clearWreck` disables its collision at the TTL.
  - Whether a wreck-tier spawn effect stands up FH's destroyed bridge, and whether a vehicle on the
    span falls when the span's collision goes, was not checked. MECHANICS.md marks it "unchecked",
    and `map-sonar.js` says "Destroyable statics ... are not listed yet".
- **What would settle it.** Run a headless `World` on FH Prokhorovka's `brigde_dest` (or Pegasus):
  destroy it with a splash, then check the collision index, the spawned wreck object and a hull
  standing on the span.

## From the sweep: retail behaviour with no ledger row

- **The +0x558 "standing on" pointer.** `BFSoldier::handleCollision` 0x0827d3b0 sets `+0x558` to
  the root of a mobile object (vt+0xe0 on its physics node) that the soldier stands on, when the
  contact normal's y is over 0.1 (0x086ba1d8 reads 0.1 as a double). It clears it otherwise and
  uses a timer `+0x55c` (the ladder README notes it). The only consumer is
  `BFSoldierNetworkable::updateStateMask` 0x082228e4, a networked "on something" bit. No ledger row
  names it, and it shows the carry is not done by parenting. **Worth a row**, under COL or SPAWN.
- **Explosion pushes on non-soldier roots.** The data side is now recorded in the finding above:
  Willy 20, Sherman 13, Spitfire 15, with the ExpPack, Landmine and grenade forces. KNOCK-4 and
  KNOCK-5 hold the law, but nobody built the vehicle half. Its "Where" cell should say so.
- **No destroyed-state test in the physics manager** (0x0825d0b0, read here). HP-21 implies it;
  HP-19 or HP-21 could state it outright: "a wreck stays a body until removed".

## BUILT and NOT-GAME, one line each

| cell | where it lives |
|---|---|
| soldier x moving hull, push and run-over (tank, jeep, reversing, any direction) | `soldier-resolve.js` `pushOutOfHulls`, `world-soldier-tick.js` `runOverTick` (fixed today; COL-2/3/6/9) |
| run-over credit, the 2 s last driver, SEAT-33 | `world-soldier-tick.js` `hullCredit`, `noteHullExit`; `server/authority.mjs` `decreeDeaths` |
| hull poses on the room server for soldiers | `server/level-instance.mjs` `publishHullPoses` |
| swimmer x boat | the same `pushOutOfHulls` (runs unconditionally in `walking-body.js` step) |
| a taxiing plane x soldier | driven and shoved hulls are published by `hull-bodies.js` `publishMovedHull`, so the same push applies |
| soldier leaving a moving vehicle keeps its speed | `vehicle-entry.js` -> `Soldier.carry` |
| soldier walking into a parked hull (the hull never moves, share snap) | `soldier-resolve.js` `resolveMove` |
| vehicle x vehicle push, spin, wake | `body-contact.js`, `rigid-body.js`, `body-world.js` (COL rows; vehicle-collision-physics) |
| vehicle x vehicle crash damage, mass-free, once a second per pair | `crash-damage.js` (COL-3, 9.2-9.4) |
| vehicle x static (buildings, walls, decks) | `body-statics.js` `collideWithStatics` and `collideSpringsWithStatics` (COL-21); statics never move (StaticResponsePhysics, HP-21) |
| trees collide and are indestructible in vanilla | TM-2..TM-5 in the exporter; ARM-3 (no Armor) |
| barbed wire x hulls | `body-world.js` `onObstacle` |
| land vehicle in deep water sinks to the bed | PHY-16, `body-world.js` and `amphibious.js` |
| water damage, per second and deep water | HP-5 and HP-21, `armor.js`, `world-damage.js` `inWaterOwners` (built 2026-11-12) |
| ships sink from critical | SHIP-4, `body-float.js` `sinkRate`, `hull-bodies.js` `stepSinkingHulls` |
| an aircraft engine under the waterline gets zero throttle; a ship's screw out of water | SHIP-6, `aircraft.js` `waterGate`, `ship.js` |
| projectiles x water (stop, `detonateOnWaterCollision`), torpedo run, bombs | `projectile-flight.js` `throughWater`, `torpedo-run.js` |
| rounds hit moved hulls | `world-collider.js` moved owners |
| wreck lifetime, fade, removal, collision cleared | HP-19, `vehicle-wrecks.js` step and `clearWreck` |
| round-end clear of every hull | HP-20, `vehicle-wrecks.js` `clearWorld` |
| deck spawns ride a moving carrier and switch off when it is critical | SPAWN-4, SPAWN-5, `hull-bodies.js` `rebaseDeckSpawns`, `shipFlagInactive` |
| held aircraft and vehicles ride their host until released | SPAWN-33, AI-121, `spawned-craft.js` |
| parachute landing at any speed is free | PARA-10, `parachute.js` |

Known and open from today's run-over fix, not repeated above: `sim/match.mjs` does not read
`step.runOvers`, and the turret gunner's credit is not told apart (`bug-stuck-under-vehicle.md`).
