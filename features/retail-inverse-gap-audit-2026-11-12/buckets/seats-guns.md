# seats-guns

## Summary

Rows (17): BUILT 13 (SEAT-3, SEAT-4, SEAT-10, SEAT-25, SEAT-29, SEAT-39, SEAT-40, SEAT-41, GUN-8, GUN-11, GUN-24, SPOT-14, SPOT-17), NOT-GAME 3 (GUN-17, SPOT-15, CVM-3), and SEAT-12 split: the per-seat exit is BUILT, `exitTimer` is NOT-GAME (no binary knows the word, read below).
Sweep: 1 MISSING, 1 DIFFERENT (a known open row, still open), 1 PARTIAL, 2 UNREAD.

Top findings:
1. **MISSING, medium/high: a restricted exit.** All eight vanilla tanks set `hasRestrictedExit`. Retail tests a line from the hull to the exit point. When that line is blocked it tries the mirrored side, and when both are blocked E does nothing. Ours always puts the soldier at the declared exit, into a wall, a rock or another hull.
2. **DIFFERENT, medium: E at a tank's gunner door still seats you as gunner.** Retail gives the driver's seat while it is free (SEAT-30, `getPreferredPco`). Ours applies this only to a spawn's press.
3. **PARTIAL, low: CAM-4's lingering death camera** (the camera parked behind a destroyed SW `WasserfallRocket`) exists only in the replay camera, not in the live game.
4. **UNREAD, low: whether a seat's view mode carries over.** Ours carries the view mode across a seat switch and reopens inside after you leave. Retail keeps one view mode per seat Camera (`Camera+0x14c`, `PlayerControlObject::setCurrentCamera`).

## Findings (MISSING / PARTIAL / DIFFERENT / UNREAD), highest impact first

### [MISSING] [impact: medium] [effort: M] Restricted exit: a blocked exit flips to the other side, and is refused when both sides are blocked
- Retail: `GameServer::toggleEntryPoint` 0x0814ee70 calls `PlayerControlObject::isAllowedToExit` 0x08317490 (call at 0x0814eed9) before every exit. If it returns false, the press does nothing (`je 0x814ee9d`, the function returns).
  - The test runs only when the PCO template's `hasRestrictedExit` byte (`+0x192`) is set (0x083174c5). Otherwise it returns 1.
  - With the byte set, it builds the exit matrix from the template's `soldierExitLocation`: position `+0x158`, rotation `+0x164` via `setRotation`, Y raised by 0.5 (the double at `0x086be450`, read with readmem: 0.5). It walks to the root parent with `queryInterface(ICompositeObject)` and `getRootParent`.
  - It then asks `objectManager` (`0x0871dc24`) vt+0x48 for a hit on the segment from the hull to that point. The filter object has vtable `0x873eb88` and flags `0x200`.
  - **No hit**: allowed (0x8317705 -> 0x8317960 -> return 1).
  - **Hit**: it negates the exit's X (`xor $0x80000000`, 0x8317714), stores the mirrored vector in the instance's `+0x18c..+0x194` (only while that is still 0/0/0) and tests the segment again.
    - Clear: it sets the instance flag `+0x198 = 1` and allows the exit (0x831792c).
    - Blocked: it returns 0 (0x8317938).
  - `PlayerControlObject::exit(bool)` reads `+0x198` at 0x8317e1d. When it is set, the soldier goes to `+0x18c` (the mirrored point) and the flag is cleared (0x8317e45).
  - Submarines first take the `getSubPos` (vt+0x140) branch, a depth test (0x8317978...).
  - Data: every vanilla tank sets `hasRestrictedExit 1`: Sherman, PanzerIV, Tiger, T34, T34-85, M10, Sexton, Chi-ha (parsed from the bf1942 glbs under `~/.cache/bfstats-tank-school/bf1942/models`). The Willy's PCOs set it too (`viewer/models/Willy.glb`).
  - SEAT-5 says the check is geometric but never wrote down what it tests. This is my reading of the disassembly (one reader).
  - Side note: the server also registers `altSoldierExitPosition` on template class 0xc4c2, a Vec3 at `+0x194..+0x19c` (ConsoleClass499 0x082f2530). No reader was found in `isAllowedToExit`, which mirrors X itself.
- Ours: `vehicle-entry.js` `exitVehicle` / `exitManned` place the soldier at `exitPose` / `exitPoseManned` unconditionally. The comment at line 407 says the restricted-exit gate "is not implemented". `con.py` already exports `hasRestrictedExit`.
- A player notices: when they park a tank with its left side against a building, a wall or another tank and press E. Retail steps them out on the right side, or keeps them inside when both sides are blocked. Ours puts them inside the wall or the other hull, where they get stuck or are pushed out at random.
- To build: in `exitSeat`, when `physics.hasRestrictedExit`, cast the hull-to-exit segment (+0.5 m Y) against the page collider's statics and hulls (`collider` ray). On a hit, mirror X and cast again. Use the mirrored point, or refuse the exit (keep the occupancy, consume the press). The server's room exit (`server/room-control.mjs` / `level-instance.mjs`) needs the same test.
  - Before building, check what objectManager vt+0x48 tests: objects only, or the terrain too. That decides whether a tank half-buried on a slope can be left.

### [DIFFERENT] [impact: medium] [effort: S] E at a gunner door of an armoured hull seats you as gunner, not as driver (SEAT-30, already open)
- Retail: on a human's press, `toggleEntryPoint` asks the seat its finder returned for `getPreferredPco()` 0x083193c0. A seat whose own template is `VTHeavyTank`, `VTLightTank`, `VTArmoredCar` or `VTTankHunter` gives way to the root seat while the root is free.
- Ours: `page-input.js` `useKey` -> `vehicle-entry.js` `nearestEntry()` -> `enterVehicle(entry)`, with no `preferredSeat`. `local-player.js` `setPilot` even says that walking up to a Sherman's hull-gunner door "seats you there directly". `preferredSeat` (`spawn-seat.js`) is applied only in `spawnSeat` (the spawn's press).
- A player notices: walking up to an empty Sherman from the hull-gunner side seats them in the Browning, and they have to press F1 to drive. In retail they are in the driver's seat.
- To build: in `useKey`, map the entry through `preferredSeat(entry.seatId, {vehicleType, rootId, rootFree})` the way `spawnSeat` does, and do the same in the server's enter action. Note: the row only becomes visible when the hit seat's own template declares `setVehicleType`. Check that the Sherman gunner PCO carries a type in the exported `seats` data before you assume the effect.

### [PARTIAL] [impact: low] [effort: S] The camera that lingers behind a destroyed `cameraDelayTime` hull (CAM-4) exists only in replays
- Retail: `GameServer::exitAndPlaceCameraIfApplicable`, called from `_giveDamage` on a lethal hit. It parks each occupant's camera `cameraDelayDistance` behind the hull for `cameraDelayTime` seconds, in view mode 17. Vanilla's only user is XPack2's `WasserfallRocket` (5 s, 15 m).
- Ours: `replay-camera.js` (around line 1280) does it. A live player riding the rocket in `map.html` gets the normal death or exit handling.
- A player notices: on Secret Weapons, when the Wasserfall hits, retail holds a view of the impact for 5 s. Ours cuts away straight away.
- To build: in the live occupant-death path, when the template's `cameraDelayTime > 0`, hold a fixed camera on the hull's last matrix moved back `cameraDelayDistance` for that long. Reuse the replay's code.

### [UNREAD] [impact: low] [effort: S] Whether a seat keeps its own view mode across switches and re-entry
- Retail: each seat Camera holds its own mode (`Camera+0x14c`). `PlayerControlObject::setCurrentCamera` 0x08318700 / `nextCamera` 0x083186b0 step through a PCO's camera list (`+0x12c`, index `+0x130`). `BFSoldier::setUseSeat` reads the new seat's first camera's mode (vt+0x14, `cmp $3` at 0x08271b25) to set first person. That suggests the mode belongs to the seat's camera rather than being carried from the previous seat. It also suggests a vehicle you leave in chase view and re-enter still opens in chase.
- Ours: `seat-camera.js` `buildSeatView` carries `seatCamera.view?.mode` across a seat switch and opens inside on a fresh entry.
- What would settle it: read `PlayerControlObject::enter` 0x08316f00 and `Camera::handleMessage` 0x081aa400 for any `setViewMode` on enter or exit, or test on the lab: chase view as driver, F2 to the gunner, see which view the gunner seat opens in.

### [UNREAD] [impact: low] [effort: S] `nextCamera` over a PCO's camera list
- Retail: `PlayerControlObject::nextCamera` cycles the PCO's cameras when it holds more than one. Ours models one `camera` per seat (`seat-survey.js`). I did not find which key reaches PCO `nextCamera`, or whether any shipped PCO declares two Cameras directly. The level glbs I could check (wake, battle_of_britain) show several Camera nodes per template name, but those counts cover every instance, so they prove nothing.
- What would settle it: a census of Camera children directly under one PCO instance in `objects.con` across the vanilla packs, and the caller of IPCO vt `nextCamera`.

## From the sweep: retail behaviour with no ledger row

- **`isAllowedToExit`'s mirrored exit** (first finding above). SEAT-5 says the check exists. No row says what it does: the hull-to-exit segment test, the X-mirror retry, instance `+0x18c` / `+0x198`, and `exit(bool)` consuming the mirrored point at 0x8317e1d. Worth a new SEAT row.
- **`altSoldierExitPosition`**: a console word on template class 0xc4c2, a Vec3 at `+0x194..+0x19c` (ConsoleClass499 executeObjectMethod 0x082f2530). No consumer was found in this pass. Our extractor does not parse it. Lead only.
- **`exitSpeedMod`** is a real console word (both binaries; ConsoleClass vtable 0x8735aa8). `con.py` exports it. I did not trace its consumer. If it scales the hull velocity a soldier keeps when he steps out, `vehicle-entry.js` `stepOut` (which carries the full `vx, vy, vz`) would differ. UNREAD. To settle it, find the setter's template offset and its reader in `PlayerControlObject::exit(bool)` 0x08317d00.
- `EntryPoint::handleUpdate` 0x081adfa0 caches the linked PCO (walking up the `+0x50` parents with `IID_IPlayerControlObject`) in `+0x10c`, then turns its own updates off (vt+0x2c with 0x1000). Internal. NOT-GAME.
- The held-seat request in `toggleEntryPoint` returns through 0x0814efbe without stamping the 1 s cooldown (`+0x98`). Ours does not stamp it either (`page-input.js` `useKey`'s `requestHeldSeat` branch skips `noteSeatToggle`). This matches.

## BUILT and NOT-GAME, one line each

- SEAT-3 BUILT: nearest in-range door -> `spawn-seat.js` `findEntryPoint` via `vehicle-entry.js` `nearestEntry`. The current-vehicle exclusion never matters because E while seated is an exit (`page-input.js` `useKey`).
- SEAT-4 BUILT: the radius choice and the wreck gate -> `vehicle-entry.js` `enterVehicle` / `isWreck` (SEAT-28 corrected the gate to `Armor::isDestroyed`).
- SEAT-10 BUILT (effect): an inside view hides the occupant's own seated body -> `seat-pose.js` `updateSeatPoseVisibility` (`!view.inside`), with `subject.setFirstPerson(view.firstPerson)` in `seat-camera.js` `buildSeatView`.
- SEAT-12 BUILT: per-seat exit in the seat PCO's frame -> `vehicle-entry.js` `exitPoseManned` (`exitLocationNode`). **`exitTimer` is NOT-GAME**: the word is in neither `bf1942_lnxded.static` nor `BF1942.exe` (`strings`, case-insensitive: no `exittimer`). The console has no such word, so the boats' negative values are dead data and there is no consuming function to find.
- SEAT-25 BUILT: a body only where a SeatObject is reached, and `seatFlags` -> `seat-body.js` (`hideBelowPelvis`, `seatStandIn`), `seat-ik.js` `seatBody`.
- SEAT-29 BUILT: bots skip enemy-crewed hulls -> `bot-vehicle.js` `mannedByEnemy`, used in `bot-mount.js` (lines 317, 378).
- SEAT-39 BUILT: the 3.0 m default door radius -> `vehicle-entry.js` `ENTRY_RADIUS_FALLBACK`.
- SEAT-40 BUILT: E with no free door asks the bot holding the nearest one -> `vehicle-entry.js` `heldEntry`, `map.html` `requestHeldSeat`, `bot-referee.js` `requestSeat`, `bot-vehicle.js` `unitUrgency`. Rooms have no server bots, so there is nothing to mirror there.
- SEAT-41 BUILT: a seat key to a bot-held seat is refused and sends the request -> `local-player.js` `switchSeat`.
- GUN-8 BUILT (superseded): manned guns run the GUN-2 servo in `turret-rig.js` `TurretAxis`. `vehicle-base.js` `axisAngle` poses only aircraft surfaces.
- GUN-11 BUILT: routed by bound input, not by slot; raw-int bindings resolved -> `seat-survey.js` `isAimAxis`, `turret-rig.js` `TurretRig` (comment at line 433), `con.py` `rig()`.
- GUN-24 BUILT: key-bound levers with no gun (Bunkertuer, Schranke1) -> `seat-survey.js` `KEY_INPUTS`, `turret-rig.js` `keyAxes`. Covered in `tests/test_seats_harness.mjs` (line 1500).
- SPOT-14 BUILT (agrees): bots target-driven, no SAI artillery step, no binocular use -> `bot-fire.js`, `bot-perception.js`. The type-14 driver is SPOT-16's.
- SPOT-17 BUILT: vehicle `magType 2` FireArms (DC's `CallArtillary` / `AltCallArtillary`) mark through the seat's guns -> `gun-cycle.js` `isMarkerWeapon` -> `map-spotter.js` `guns.onMark`. Seat alt-fire reaches it (`local-player.js` `altFire`).
- GUN-17 NOT-GAME: the stabilization bytes do nothing in retail; `turret-rig.js` correctly composes under the hull.
- SPOT-15 NOT-GAME: a data survey (`extract_vehicle_spotting.py`, `_shared/vehicle-spotting.json`).
- CVM-3 NOT-GAME for live play: the chase gate `traceValid` is set only for a human occupant, and our live chase only ever runs for the human's own seat. The replay's chase of bots is our own feature, not retail's.
