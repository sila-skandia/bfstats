# vehicle-physics

## Summary

38 ledger rows plus a sweep of the lnxded vehicle classes (`PlayerControlObject`, `Armor`,
`Engine`/`PhysicsEngine`, `Wing`/`PhysicsWing`, `Spring`/`PhysicsSpring`, `FloatingBundle`,
`RotationalBundle`, `WheelTrack*`) and of the vehicle-side console words in the binary's string
table against `bf42/con.py` and the viewer/server.

Rows: BUILT 30, NOT-GAME 3 (COL-1, TANK-5, SHIP-3 is moot and the page already treats it so),
MISSING 1 (COL-22), PARTIAL 1 (SUB-6), UNREAD 2 (COL-26, COL-12 belongs to netcode).
The slice is well covered. Nearly every row's "Where" cell names live code, and spot checks agree.

From the sweep: MISSING 3, PARTIAL 1, UNREAD 1, plus one open question (ARM-7) settled as "no effect".

Top findings by impact:
1. **MISSING, medium: a destroyed vehicle does not explode on anything near it.** `Armor::status`
   calls `GameServer::handleExplosion` with the Armor's `explosionRadius`/`explosionDamage`/
   `explosionForce`, credited to the last hitter. 53 vanilla/XPack templates write damage 5 and
   radius 8. Our code does not parse those fields and has no death blast.
2. **PARTIAL, medium (needs one headless run to confirm): a soldier standing on a moving deck
   is not carried by friction.** In retail the object contacts use the relative velocity. Our
   walker's friction law ignores the hull's velocity, and the hull floor sets only `y`.
3. MISSING, low: COL-22. Large hulls meet a static's col0 layer; the page always uses col1.
4. MISSING, low: `RotationalBundleTemplate.lesserYawAtSpeed` and `ObjectTemplate.vehicleCameraShake`
   are not read. No vanilla data uses the first; one XPack2 object uses the second.

## Findings (MISSING / PARTIAL / DIFFERENT / UNREAD), highest impact first

### [MISSING] [impact: medium] [effort: S] A destroyed vehicle's own explosion (Armor explosionRadius / explosionDamage / explosionForce)
- Retail: `Armor::status` `0x081739e0`, the destroyed branch `0x08173d60`-`0x08173df0`, runs
  after it sends message `0x15`. If `explosionDamage` (`+0x100`, setter `0x08174240`) is over
  0.001 (`0x086c0308`), it calls the game's vt `+0x38`, which is `GameServer::handleExplosion`
  `0x08156ef0` (HP-9 names that slot). The call takes the owner's position (owner `+0x34`,
  vt `+0x38`), radius `+0xf8` (setter `0x081741e0`), explosion material `+0xfc`, damage `+0x100`,
  the Armor's last hitter `+0x14` as the attacker, team and type -1, explosion force `+0x104`, a
  factor of 1.0 and the owner. HP-9's falloff (linear, material-pair `getDamageMod`, soldier
  exposure) and KNOCK-4's push then apply as for any shell. Vanilla data, from a scan of the
  three `objects.rfa`: 52 templates have `explosionRadius 8`, 53 have `explosionDamage 5`, and
  vehicles have `explosionForceMod` 5-20. Every land vehicle, aircraft and boat explodes this way.
- Ours: `bf42/con.py` parses `explosion_radius` only on projectiles. `explosionDamage`,
  Armor `explosionRadius`, `explosionForce` and `explosionMaterial` have no reader in `bf42/`,
  `viewer/` or `server/`. `vehicle-wrecks.js` plays the death effect and kills the crew
  (`damageAllAttachedSoldiers`), but it damages and pushes nothing around the wreck.
- A player notices: when a tank or plane blows up beside them or beside another vehicle, they
  take no damage and are not knocked back. A vehicle finished off next to a damaged one does not
  set off a chain, and the kill credit for a soldier finished by the blast is missing.
- To build: carry the Armor block's four fields in `con.py`/`assemble.py` (`armor` extras). On a
  hull's destroyed transition (`vehicle-damage.js`, `server/authority.mjs`), call the existing
  splash path (`vehicle-damage.js` `applySplash` and the soldier splash in `projectile-damage.js`)
  with that radius, damage and material, at the owner's origin, with the Armor's last hitter as
  the attacker. Add `knockback.js` with the Armor's force. Still open: the default of
  `explosionMaterial` (the Armor ctor, the ArmorTemplate ctor). Read it before pricing the blast
  against the material table.

### [PARTIAL] [impact: medium] [effort: M] A soldier on a moving deck is not carried along
- Retail: collision-response.md §8. Object contacts feed the friction pass with the
  share-scaled relative velocity, "so a light body standing on a heavy moving one is carried
  along". AI-160 measured bots at LOD 0 staying on the moving Hood's and Bismarck's decks for
  400 s. `BFSoldier` alone writes `setSurfacePositionalSpeed` (`0x08274e2f`).
- Ours: `walking-body.js` `#contactLaw` takes `V = v - vCmd` with no velocity for the surface
  they stand on. `soldier-resolve.js` `settleFeet` puts a hull floor under them by setting
  `p.y` alone. The new moving-hull pass `pushOutOfHulls` (uncommitted, the run-over fix) uses
  `v - vHull` only for the push along the face normal, which is vertical for the foot vertex.
  So nothing moves a soldier sideways with a deck except a wall pushing them. Not run headless;
  one harness with a soldier on an Elco or LCVP deck under way would settle it.
- A player notices: when they stand on a destroyer, PT boat, LCVP or carrier deck that is
  under way, the deck slides out from under them. On an open deck they are left behind or fall
  off the stern.
- To build: hand the walker the velocity of the hull it stands on at the ground probe
  (`groundUnder` already knows the owner, and `WorldCollider.moved` has its pose per tick).
  Subtract that velocity in `#contactLaw`'s `V`, as `addFriction` 0x0825b6e0 does for an object
  contact. Files: `walking-body.js`, `soldier-resolve.js`, `world-collider.js`.

### [MISSING] [impact: low] [effort: M] COL-22: a large root meets a static's col0, the page meets col1 always
- Retail: COL-22. `lod = rootRadius < 4.0 ? 1 : 0` (`0x08259690`). The Sherman, Tiger, T-34
  and others meet the col0 layer of a two-layer static, for example `supplyde_m1`'s 8-vertex box.
- Ours: `bf42/assemble.py` `_collision_mesh_indices` keeps one layer (the last non-empty one).
- A player notices: rarely. The row found no case where a tank stops against a different face
  (the Tobruk depot's layers are 0.07 m apart).
- To build: as COL-22 says, keep col0 per tree for the 201 two-layer meshes and add a second
  static index chosen by root radius in `body-statics.js`.

### [PARTIAL] [impact: low] [effort: S] SUB-6: who sees the submarine HUD
- Retail: `IPlayerControlObject` vt `+0x60` (`getSubPos`, set by `PlayerControlObjectTemplate::setSubPos`).
- Ours: `submarine-hud.js` `isSubmarine` decides by `VTSubmarine` plus `submarineData`.
  `setSubPos` is not exported (grep: no reader).
- A player notices: only on a mod hull that authors `subPos` differently from vanilla.
- To build: export `subPos` per seat in `con.py` and gate on it.

### [UNREAD] [impact: low] COL-26: `checkVsTerrain`'s path for a part with more than 10 col0 vertices
- Retail: the branch at `0x0825aa72`/`0x0825b04f` is found but not traced.
- Ours: `body-ground.js` `terrainContact` and `vehicle-bodies.js` `col0Points` use vertex 0 or
  the lowest vertex. `aircraft-ground-law.js` `legProbe` (AIRGND-13) takes the lowest vertex.
- Settle it: disassemble `0x0825b04f` onward (the reads at vt `+0x28`/`+0x1c` and the box extents).

### [UNREAD] [impact: low] COL-12 (netcode, not this slice): a client runs contacts for remote vehicles
- Retail: the client runs the same response code for every vehicle, remote ones included.
- Ours: remote hulls in `net-room.js` are drawn from the room's poses (`remoteVehicle`).
  Whether that differs visibly is the netcode bucket's call.

## From the sweep: retail behaviour with no ledger row

- **Vehicle death explosion**: see the first finding. No ledger row covers `Armor::status`'s
  destroyed-branch `handleExplosion` call. HP-12 lists the values without a consumer.
- **ARM-7's open "consequence of entering a burning vehicle" is nothing.** `PlayerControlObject::enter`
  `0x08316f00` calls `isCriticalDamaged` (`+0xcc`, `0x08317095`). On true it calls
  `getHpLostWhileCriticalDamage` (`+0xd4`, `0x083172b9`) and jumps straight back
  (`0x083172c2 jmp 0x83170a6`) without storing the returned float. Entry is the same for a
  burning vehicle. NOT-GAME, but ARM-7 can be closed.
- **MISSING, low, S: `RotationalBundleTemplate.lesserYawAtSpeed`** (`0x081d9e90`, `+0x1ac`, GUN-1)
  is not parsed. It is not written in vanilla, XPack1 or XPack2 (scan of `objects.rfa`); a mod
  survey would say whether any mod uses it.
- **MISSING, low, S: `ObjectTemplate.vehicleCameraShake`** (a `CameraShakeTriggers` object) is
  not parsed. Only XPack2's `WasserfallRocket` writes it (`CstMachinegun`; HD_XA42's line is
  commented out). `setFireCameraShakeAnimationState` (14 stationary MGs) is built elsewhere
  (`cameraShakeFactor` and the fire shake).
- **UNREAD, low: wheel tracks or skid marks.** lnxded carries `WheelTrackDB`
  (`continousWheelTrack` `0x0820e810`, `addWheelTrack`, `setBumpTexture`), and the client has
  `skidMark` / `numSkidMarks` / `setMaterialSkidMarkExtraWidth`. No `.con` or `.ssc` in the
  vanilla, XPack or GC archives names a WheelTrack or SkidMark, and our viewer has none. Settle
  it with the client: `recorpus.py SkidMarkTemplate --build mac` and the caller of
  `numSkidMarks`. If the renderer draws marks by default, this becomes a medium visual gap
  (tank tracks in the sand on El Alamein).
- Out of this slice, noted on the way: `sinkInToLandAfterDeathSpeed` (61 vanilla gib templates,
  debris sinking into the ground) is parsed in `con.py` and read by nothing. It belongs to the
  debris/effects bucket.
- Checked and BUILT (no row needed): no fuel state exists in the binary (no `fuel` word). Beached
  boats are handled (`ship.js` `aground` / `#beachedTick`). Carrier decks are handled (AIRGND-5,
  `hull-bodies.js` `settleOnDecks`). No catapult exists in the binary. Abandoned-vehicle decay
  (`damageWhenLost`) is in `room-pads.mjs` and `deployables.js`. Restricted exit
  (`hasRestrictedExit`) is in `vehicle-entry.js`. Crew damage on hull damage
  (`damageAllAttachedSoldiers`) is in `world-damage.js`. Upside-down, water and deep-water hit
  point loss is in `vehicle-damage.js` and `armor.js`. Landing gear by height is in
  `aircraft.js`. `dragOffset` is inert in retail (physics.md).

## BUILT and NOT-GAME, one line each

- OBS-3 BUILT: a vehicle rolls through wire -> `body-statics.js` obstacle veto.
- OBS-4 BUILT: a soldier passes wire and takes its damage -> `soldier-resolve.js`, `world-soldier-tick.js` `obstacleTick`.
- OBS-5 BUILT: `slowDownMod` for one tick -> `obstacle.js`, `soldier-locomotion.js`.
- OBS-7 BUILT: no credit for the wire itself, the last hitter is credited -> `world-soldier-tick.js` `obstacleTick` (attacker -1), the referee's last attacker.
- OBS-8 BUILT: the scrape is the message, from vehicles too -> `obstacle.js`, `body-statics.js`, `area-sound.js`.
- OBS-9 BUILT: bots route by the AI map -> `bf42/ai_level.py`, `sim/routeprobe.mjs`.
- OBS-10 BUILT: no veto for a body at rest -> `body-statics.js` `HANDLER_SPEED_THRESHOLD_SQ`.
- COL-1 NOT-GAME: a data fact (no `collisionDamage` property).
- COL-10 BUILT: sleep and the two-tick wake -> `body-friction.js`, `body-world.js`.
- COL-11 BUILT: tick order, an empty vehicle simulated with zero input -> `body-world.js`, `server/level-bodies.mjs`.
- AIRGND-7 BUILT: the airframe per tick -> `aircraft-ground-law.js`, `tests/test_air_law.py`.
- AIRGND-8 BUILT: the correction replays from the acked tick -> `net-room.js` (the reconciler rebase).
- AIRGND-10 BUILT: a Wing lifts along its absolute transform and gear -> `aircraft.js`.
- AIRGND-11 BUILT: the A6M2b chatter is retail -> `aircraft-ground-law.js` springs (measured).
- AIRGND-13 BUILT: a ring wheel stands on its lowest vertex -> `aircraft-ground-law.js` `legProbe`.
- TANK-5 NOT-GAME: EngineTemplate field offsets.
- TANK-19 BUILT: the wheel spring law -> `suspension.js`, `tracked-vehicle.js`, `wheeled-vehicle.js`.
- TANK-30 BUILT: a wheeled hull slides at full lock (measured, the law) -> `wheeled-vehicle.js`.
- TANK-31 BUILT: the differential side in the steering frame -> `tracked-vehicle.js` `contactSide`.
- TANK-32 BUILT: EngineDummyGrip holds up, adds no friction -> `body-friction.js`.
- SHIP-3 NOT-GAME (moot): `dragModifier`/`waterHeight` are not read, and `body-float.js` and `torpedo-run.js` say so.
- SHIP-4 BUILT: `sinkingSpeedMod` as a rate -> `body-float.js` `sinkRate`.
- SUB-5 BUILT: the depth tape -> `hud.js` `scrollPictureBand`.
- SONAR-3 BUILT: senses every Armored root, no team test -> `sonar.js` `sensedObjects`, `map-sonar.js`.
- SONAR-8 BUILT: who has a sonar -> `extract_vehicle_sonar.py`.
- SWB-1 BUILT: the jetpack's ActiveKitPart push -> `rocket-pack.js`.
- SWB-2 BUILT: the `0.0333` burst timer -> `rocket-pack.js` `BURST_TIMER_STEP`.
- SWB-3 BUILT: kit damping of fall damage -> `rocket-pack.js` `kitDamping`, `fall-damage.js`.
- SWB-5 BUILT: level re-declared templates -> `extract_level_variants.py`, `replay-assets.js`.
- SWB-6 BUILT: the pack's fuel bar -> `soldier-hud.js`.
- SWB-8 BUILT: hulls for level-declared vehicles -> `extract_collision_meshes.py`.
- SWB-9 BUILT: no bot on a flag whose carriers are all down -> `bot.js` `spawnBots`.
- SWB-10 BUILT: pad variants settled apart -> `hull-bodies.js` `settleDeckGroup`.
- SWB-11 BUILT: a thrown knife drawn by its trail bundle -> `replay-props.js`.
