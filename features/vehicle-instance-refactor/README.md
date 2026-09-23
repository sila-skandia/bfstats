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

## Part 1: landed (2026-09-23)

`viewer/vehicle-instance.js`: `VehicleRegistry` (every occupied hull, keyed
by its root node, and every seated player), `VehicleInstance` (one per hull:
the seat model `VehicleOccupancy` with one `TurretRig` per seat, the one
drive, the gun groups per seat, the seat map) and `SeatHandle` (what an
occupant holds: `{ instance, seatId }`, answering the per-seat questions the
world, HUD and camera used to ask a per-occupant `VehicleOccupancy`).
`enter`, `leave` and `switchSeat` are the only mutations; the page's human
path (`setPilot`, `leaveSeat`, `switchSeat`, `exitVehicle`, `exitManned`)
and bot path (`botEnterVehicle`, `botLeaveVehicle`, `botSwitchSeat`) call
them. The page hands the registry its drive options (`buildHullDrive`, one
function for both), the body world (`adoptDrivenBody` /
`releaseDrivenBody`), the freeze, the guns and the audio rack.

Rules as built:

- The drive is built when someone takes the root seat of a drivable hull
  and kept until the last occupant leaves. A gunner alone in a parked hull
  sits on the parked body; a gunner whose driver leaves rides a hull that
  coasts. The root seat's controls are released when it is vacated.
- `world.js #assignIntegrators`: each drive integrates once a tick, in the
  tick of its root seat's holder (else its first occupant), from that
  holder's input word. Every occupant's record carries the same drive.
- A seat's gun groups are collected when it is taken and released when it
  is left: the root seat's own FireArms from the drive (fired from the
  drive's inputs), then the seat's own. A bot driver no longer fires the
  hull gunner's Browning (the old bot path collected the whole hull).
- Every seat's world position is published each tick from the world's
  `onTick` (`publishSeatPositions`, the seat node's), replacing the rider
  feed in `botVehicleTick` and the frame's root read.
- `localPlayer` (map.html) looks the human's hull up in the registry on
  every read: `occupancy` (his handle), `aircraft` / `car` (the hull's drive
  by kind), `vehicleGuns` / `mannedGuns` (his seat's groups); `view` is his
  seat's `VehicleCamera`, rebuilt by `syncLocalSeat` when his seat or its
  drive changes under him (a bot taking the wheel). The `aircraft`, `car`,
  `view`, `occupancy`, `vehicleGuns`, `mannedGuns` globals are gone.
- Seat dots now show the hull's other occupants (bots) against the local
  team.

Found on the way (fixed): a bot in the Sherman's hull-gunner seat drove the
Browning to its elevation stop and never fired: that axis declares a
negative acceleration (`direction -1`), which the servo applies to its input
and the bot's aim law did not. `bot.js _aimLook` now puts its command
through the same sign (`_turretInputSigns`).

Found, not fixed: the same gunner's aim oscillates +-2.4 deg about the
target (the bot's count law assumes the soldier's gains; the Browning's 90
deg/s servo moves ~3x per count what the Sherman tower's 20 does), so it
fires steadily but misses a soldier at 40 m. A hull entered by anyone rises
~0.6 m on its springs after adoption (60.85 -> 61.49 on El Alamein's
Sherman), on main too.

Verified live (El Alamein, 8 bots, `?shots&noaudio&botDebug`, the worktree's
own static server): (1) bot_0 drives a Sherman, the human takes
`shermanBrowning_PCO1` through `enterVehicle` (`__enterSeat`): one instance,
both seats, the camera stays within 0.5 m of the hull over 300 frames while
it drives 10 m, the Browning fires 10 rounds a second, and `__exitSeat`
puts the soldier 2.3 m from the hull's true position while the hull drives
on, node and drive state identical frame to frame; (2) the human drives a
Sherman, bot_2 takes the gunner seat with `__botMount` and fires at a frozen
soldier 40 m ahead (36 rounds in 4 s); (3) two bots in an M3A1: the driver
swaps to a passenger seat and back while the hull moves at 4.3 m/s, with no
discontinuity in its position; (4) the recipes: a bot Sherman kills a soldier
at 40 m with three shells, a bot Spitfire takes off and climbs to 85 m (the
same numbers to the decimal as main under the same script).

Tests: `tests/test_vehicle_instance.py` (the registry with the real World
and a stub drive: one drive per hull, one integration a tick from the root
seat, a gunner's word never reaching the drive, a held seat refusing, the
swap keeping the drive, the last one out parking the hull).

## Part 2: landed (2026-09-23)

`map.html` went from 19,089 lines to 1,977: the loader, the renderer and
scene setup, the frame loop (`frame`, ~420 lines), `buildHullDrive`, the
bot and effect loaders, and the wiring below. The stylesheet is `map.css`.
Each module is a factory, `createX(page)`, that returns one object. The
module-level state it took with it is now fields on that object. Whatever
it still needs from the page comes in through `page`, an object of getters
(and setters for the few bindings a module writes) that the page builds at
the call site. No module reads the page scope. Code moved verbatim: no new
behaviour, and no function was rewritten on the way.

| Module | Object | Lines | What it holds |
|---|---|---|---|
| `vehicle-instance.js` | `vehicles` | 344 | Part 1's registry |
| `bot-referee.js` | `referee` | 779 | bot fire, damage, death and respawn, capture, seating, enemy tables; shared with `sim/match.mjs` |
| `bot-units.js` | `botUnits` | 351 | the page's vehicle layer for the referee (candidates, nav, seats) |
| `bot-visuals.js` | `botBodies` | 266 | the bots' bodies: pose pairs, gait rigs, interpolation |
| `local-player.js` | `localPlayer` | 1684 | the human: seat, view, entry and exit, soldier, look, render interpolation |
| `page-input.js` | `pageInput` | 1173 | keyboard, mouse and pointer lock, touch, key lock, free camera |
| `page-console.js` | `pageConsole` | 322 | the console's page commands and the Esc menu |
| `capture.js` | `flagCapture` | 515 | flags, capture, tickets |
| `spawning.js` | `spawning` | 481 | spawn selection and the deploy flow |
| `deploy-screen.js` | `deployScreen` | 513 | the deploy screen |
| `scoreboard-screen.js` | `scoreboard` | 234 | the scoreboard |
| `hud-feed.js` | `hudFeed` | 959 | what the HUD reads each frame (`hud.js` stays the renderer) |
| `map-surfaces.js` | `mapSurfaces` | 1043 | minimap, full map, their sprites, ticket variables |
| `level-load.js` | `level` | 2300 | the level: show, scene binding, sky, water, collider, terrain queries |
| `hand-weapon.js` | `soldierKit` | 1923 | kits, arms rig, load, fire, reload, demolitions |
| `seat-pose.js` | `seatPose` | 397 | the seated soldier |
| `foot-body.js` | `footBodies` | 379 | the body on foot |
| `soldier-view.js` | `soldierView` | 298 | the on-foot camera |
| `page-audio.js` | `pageAudio` | 712 | the page's sound |
| `vehicle-wrecks.js` | `wrecks` | 480 | wrecks |
| `hull-bodies.js` | `hullBodies` | 757 | the hulls' physics bodies (adoption, parking) |
| `vehicle-hits.js` | `vehicleHits` | 387 | rounds against hulls |
| `net-room.js` | `room` | 469 | the room client, replicas, seat rows, error card |
| `test-hooks.js` | `testHooks` | 1509 | the `?shots` headless hooks |

The referee is one copy. `sim/match.mjs` builds it with
`createBotReferee(this.refereeEnv())` and deleted its own copy. The page and
the runner differ only in the `env` they pass it: `units` (`bot-units.js`
against `SimVehicles`) plus hooks for stats, events and tickets. See
`sim/README.md`. Two trace differences came from sharing it, and both are
documented there:

- a seat swap is now one mount event where the old copy logged a dismount
  and a mount;
- the redeploy check keeps the runner's `!bot.vehicle` guard.

`mesh/nginx.conf` revalidates the viewer's top-level `*.js` and `map.css`,
the same as the page. A deploy therefore never pairs a new `map.html` with
cached old modules.

Tests that pinned page wiring by reading `map.html` now read every page
file through `tests/page_source.py` (`page_source()`, `file_defining(name)`,
`function_body(name)`). The changed tests are `test_idle_vehicle`,
`test_deploy_spots`, `test_hud_layout`, `test_swim` and `test_map_entry`.
Their regexes now also accept the `obj.` prefix a moved name carries. No
assertion was loosened beyond that.

Verified live on the final page (El Alamein, 8 bots,
`?shots&noaudio&botDebug`, the worktree's own server). The page loads with
no uncaught error. Deploy, walk and fire, bot mount, and the HUD's 39
variables all work.

- Case 1: bot_0 drives a Sherman and the human takes the Browning. It is
  one instance with both seats (`TrackedVehicle`). Over 120 frames of
  driving, the camera-to-hull distance varies by 0.02 m. The Browning fires
  20 rounds. Exit puts the soldier 2.5 m from the hull's true position.
- Case 2: the human drives a Sherman at 9.5 m/s with bot_2 in the gunner
  seat. The seat map reads `{Sherman: local, shermanBrowning_PCO1: bot_2}`.
- Case 3: the human swaps from the M3A1's driver seat to its Browning at
  5.5 m/s. The largest per-frame step after the swap is 0.246 m, against
  0.234 m while driving. The hull coasts on (the released controls), and
  there is no jump.
- The recipes:
  - A bot Sherman kills a soldier 40 m ahead within 75 frames.
  - A bot Spitfire takes off and holds about 70 m AGL.
  - Two squads of four placed 35 m apart trade five kills and five
    respawns in 1,500 frames.

Left:

- ~~`page` is the modules' interface, but a wide one~~ Narrowed, see below.
  The split of files where two subsystems share one (`ground.js` wheels,
  tracks and suspension first) is still to do.
- The frame loop is still one 420-line function in `map.html`.
- Still open from Part 1: the bot gunner's aim gain (it misses at 40 m),
  and the hull rising ~0.6 m after adoption.
- Found here, not fixed: the bot vehicle-candidate cache and the nav maps
  are not reset on a level switch (the same on main).

## Part 2b: every module takes the values it reads (2026-09-23)

Nothing in any `page` bag was unused. The width was whole modules handed
across: `pageInput` got all of `localPlayer` and used 21 of its members,
`spawning` got all of `deployScreen` and used 18. A module could reach
anything in the modules it was given, and its header did not say what it
depended on.

Each whole-module getter is now one getter per member the module reads, plus
a setter where it writes (`aimHeld`, `triggerHeld`, `deployZ`,
`hudViewTimer` and so on). `page.localPlayer.occupancy` became
`page.occupancy`. The page builds the getter from the same expression
(`get occupancy() { return localPlayer.occupancy; }`), so reads stay live and
nothing is cached. Where the module used `?.`, the getter does too. Each
module's header lists exactly what it takes. There is one commit per module,
done mechanically: the transform refused anything it could not rewrite, and
it met nothing like that.

Two objects are still handed in whole, on purpose: `world` (the `World`) and
`vehicles` (the `VehicleRegistry`). They are class instances whose methods use
`this`, so a getter handing out `world.player` would unbind it, and they are
the shared simulation every module talks to. `referee` and `botUnits` already
took a purpose-built `env` and are unchanged.

The bags got longer: `pageInput` went from 27 keys to 70 and `localPlayer`
from 37 to 61. That is the dependency list made visible, not new coupling.
The worst offenders are now easy to see. `pageInput` reads 21 of the human's
members and 9 of the hand weapon's, and it is the next candidate for
splitting (keyboard/mouse vs. what each key does).

Verified: the full `./scripts/verify.sh` passed on main before the change
(2,824 Python, 388 API, 144 E2E), and the Python suite passes after it. A
live smoke pass on El Alamein with 8 bots raised no uncaught error or
rejection. It covered: deploy; walking 5.4 m; prone on Z; hand fire (6
rounds); entering a Sherman; C to chase (8.5 m out); driving 7.8 m; digit 2
to the second seat and firing it; E out, 2.3 m from the hull; the full map on
M; the scoreboard; the Esc menu; a wrecked Willys killing its bot crew; and a
bot Sherman mounting and killing.

## Part 2c: the model browser, `index.html` (2026-09-23)

The same pattern applied to the model browser. `index.html` went from 5,850
lines to 747: the markup, the stage (renderer, scene, camera, orbit controls,
lights, portrait framing), the on-demand frame loop, the loader (`show`) and
the wiring. The stylesheet is `index.css`, which nginx revalidates like
`map.css`. Code moved verbatim. Each module's header lists what `page` hands
in. Where a module needs one member of another module, the bag names that
member (`get isCollisionMesh() { return armour.isCollisionMesh; }`), never the
module.

| Module | Object | Lines | What it holds |
|---|---|---|---|
| `model-armour.js` | `armour` | 930 | collision hulls, damage tables, weapon picker, the placed shot and its readout, the armour hooks |
| `model-envmap.js` | `envReflection` | 259 | the `envmap true` stage: sky cube, picker, shader patch, readout |
| `model-display.js` | `display` | 93 | wireframe/untextured/explode/double-side, each material's own texture |
| `model-rig.js` | `rig` | 242 | RotationalBundles and drivetrains, input values, rate angles, scrolling treads |
| `model-clips.js` | `engineClips` | 108 | baked spin and ambient clips, the engine switch, propeller blur |
| `model-guns.js` | `gunTriggers` | 136 | the `GunFire` runtime and the hold-to-fire buttons |
| `model-seat-cams.js` | `seatCams` | 100 | camera-view nodes and the glide between them |
| `model-crew.js` | `crewConsole` | 801 | stations, instruments, keys, gear tween |
| `model-touchpad.js` | `touchpad` | 311 | the touch disk |
| `model-variants.js` | `variantPicker` | 93 | build/skin pickers, plus the variant helpers as plain exports |
| `model-browser.js` | `armoury` | 719 | the faceted catalogue, its three layouts, the sidebar card and crumb |
| `model-test-hooks.js` | (installs) | 144 | `window.__scene`, `__camera`, `__controls`, `__modelInspector` |

Shared state that went away:

- The page-wide `state` object. Its display switches belong to `display`,
  its collision switches to `armour` (read as `armour.collision`, set
  through `setCollision`).
- The loader no longer writes other modules' state. `originalMap.set` is
  `display.rememberMap`, the envmap sets are cleared by
  `envReflection.forgetModelMaterials` and filled by `bindModelEnvmap`,
  `cameraGlide = null` is `seatCams.cancelGlide()`, and `currentReport`
  plus the weapon and collision setup is `armour.adoptModel`.
- The rig half of the loader's traversal is `rig.collectRig`. It is a second
  pass over the same tree in the same order, so the parts are collected
  exactly as before.
- The crew console sets a rig input through `rig.setInput`, not by writing
  the rig's map.
- Constants and pure helpers other modules need are plain ES exports:
  `GEAR_INPUT`, `FREE_RANGE` and `keyOf` from the rig; `AIM`, `STICK`,
  `DRIVE`, `SHORT_LABEL`, `degreesAt` and `inputFor` from the crew console;
  the variant helpers from `model-variants.js`.

What modules still write of each other is only the stage's three.js objects
(the orbit controls' `enabled` during an angle drag, the helpers' visibility
for a portrait, the camera during a glide) and `main.dataset`.

No test pinned `index.html`'s script, so `tests/page_source.py` is unchanged.
Verified by loading the page headless (Sherman, then Corsair) and driving it
against the pre-refactor page, served side by side, with the result diffed.
The run covers the hooks, rig inputs, firing, station keys, the collision
view by hook and by canvas click, weapon damage, display toggles, the envmap
picker, the touchpad drag, the variant picker, the catalogue's search, facets
and layouts, the engine and gear, and seat and orbit views. Both pages
produced the same output, with no uncaught error.

## Part 2d: the kit and grip inspectors, `kits.html` and `poses.html` (2026-09-23)

The same pattern as Part 2c. `kits.html` went from 1,307 lines to 364 (its
inline script from 800 to 267) and `poses.html` from 1,184 to 354 (782 to
240). Each page is now its markup, the stage (renderer, scene, camera, orbit
controls, lights), its loader (`showKit` / `loadPair`), the on-demand frame
loop and the wiring. The stylesheets are `kits.css` and `poses.css`, and
nginx revalidates both, plus `kits.html`, like the other pages. Code moved
verbatim, and each module's header lists what `page` hands in.

Shared by both pages. Each page had the same copy of these:

| Module | Export | Lines | What it holds |
|---|---|---|---|
| `camera-glide.js` | `createCameraGlide` | 62 | the eased camera and target move, and its `cameraMove` |
| `dispose-model.js` | `disposeModel` | 19 | freeing a glb's geometry, materials and textures |
| `controls-collapse.js` | `installControlsCollapse` | 28 | the panel's collapse button and the stage's Controls button |

`kits.html`:

| Module | Object | Lines | What it holds |
|---|---|---|---|
| `kit-catalogue.js` | `catalogue` | 115 | kits.json, the pose matrix and models.json, with vanilla as the floor, and the kits built from them |
| `kit-stance.js` | `kitStance` | 110 | the stance, its buttons, mixer and blend |
| `kit-view.js` | `kitView` | 77 | framing off the posed joints, the head point, the figure/head buttons |
| `kit-worn.js` | `kitWorn` | 139 | grafting worn parts onto bones, the hidden slots, the Worn panel |
| `kit-panels.js` | `kitPanels` | 84 | the weapon rack and the Fields on panel |
| `kit-picker.js` | `kitPicker` | 170 | the nation/class/soldier selects, the kit list and filter, the hash, the keys |

`poses.html`:

| Module | Object | Lines | What it holds |
|---|---|---|---|
| `pose-motion.js` | `poseMotion` | 301 | stance and motion, the stance and gait actions, the gait sidecars, the weight blend, buttons and gait readout |
| `pose-view.js` | `poseView` | 91 | framing off the posed joints, the grip point, the figure/grip buttons |
| `pose-pairs.js` | `posePairs` | 188 | the soldier/weapon selects and steppers, the pair list, the weld readout, the keys |
| `pose-test-hooks.js` | (installs) | 80 | `window.__poseInspector`, same name and members |

Shared state that went away:

- `kits.html`'s page-wide `state`. The stance belongs to `kitStance`, the
  hidden worn slots to `kitWorn` and the view to `kitView`. What is left is
  the loader's own selection (kit, soldier, held), which the panels and the
  picker read through getters.
- The loaders no longer write other modules' state. `cameraMove = null` is
  `cameraGlide.cancel()`. The mixer reset and clip binding is
  `kitStance.bindFigure` / `poseMotion.bindFigure`, and `grafted = []` is
  `kitWorn.forgetGrafts()`. A deep link's stance is `presetStance`, and
  `poses.html`'s URL stance and motion are `presetStance` / `presetMotion`.
- The `sampleCycle` hook cleared `poseBlend` and re-applied the target
  weights itself. It now calls `poseMotion.settleWeights()`, which does the
  same two things.

Not shared, on purpose. The two pages' stance code is not the same code:
`kits.html` has stills only, and `poses.html` adds gaits and a weight map.
Their `refit`/`applyView` differ in the target joint and the distances.
`kit-graft.js` was already shared with `seat-pose.js` and is still imported
(by `kit-worn.js`). `kit-loadout.js`, `kit-icon.js` and `stance-clips.js`
answer the map's questions (the deploy row's kit, the icon, the
`prone`-named clip chains), not these pages', so nothing here duplicated
them. `index.html` still has its own copy of `disposeModel` and the panel
collapse. It can import the new modules later.

No test read either page's script. `test_map_entry` reads their nav markup,
which did not change, so `tests/page_source.py` is unchanged. Verified by
serving a copy of each original page beside the new one and driving both
headless with the same script, then diffing the JSON:

- The kit page covers stance buttons and q/w/e, digits 1-3, every rack slot,
  hiding and showing every worn slot, the nation/class/soldier selects,
  arrow keys, the filter, list clicks, figure/head view, wireframe, axes,
  spin, collapse and expand, and a deep link.
- The grip page covers stance and motion buttons and keys, `sampleCycle`
  per gait, the weapon steppers, arrow keys, both selects, the filter, sort
  by worst weld, list clicks, figure/grip view, wireframe, skeleton, axes,
  spin, collapse and expand, the hooks, and `?soldier&weapon&stance&motion`.

The results matched, including the canvas samples, and neither page raised a
console error. Both pages also load identically under `?mod=` for xpack1,
xpack2 and eod.

## Part 3: one owner per piece of state, and the rest of the code base (2026-09-23)

Goal for this round: the whole game code base modular and concise, with as
little shared state as possible. Part 2 had made every page subsystem a
module. What was still shared was state: a module's `page` bag could carry
setters, and 70 of them let one module assign another module's fields.

### No module writes another module's state

Every setter is gone. The last page bag setter was removed in `79cb3e2a`.
Each piece of state now has one owning module, and the others ask it by name:

| State | Owner | Operations others call |
|---|---|---|
| the soldier's life, the death cam | `localPlayer` | `dieOnFoot`, `dieInWreck`, `revive`, `discardSoldier`, `forgetSoldier`, `runDeathCam`, `toggleProne`, `standUp` |
| the mouse buttons | `pageInput` | `releaseButtons`, `pressTrigger`, `setAim`, `setSeatTriggers`, `setTouchTriggers`, `dropClick` |
| the seat-toggle cooldown | `pageInput` | `seatToggleReady`, `noteSeatToggle` |
| the deploy screen's selection | `spawning` | `chooseTeam`, `chooseKit`, `forgetFlagChoice`, `buildSpawnFlags`, `showFlagPicker` |
| the deploy map's ease | `deployScreen` | `easeOpen`, `easeClose` |
| the camera lens | `localPlayer` | `useLens('foot'\|'seat'\|'fly')`, `setFov` |
| the mode boxes | `localPlayer` | `leavePilot`, `leaveOnFoot`, `markPilot`, `markOnFoot` |
| the camera's look | `freeCamera` | `setLook`, `turnLook` |
| the HUD line | `hudFeed` | `showHint`, `flashHud`, `updateHud` |
| the hit indicator | `soldierHud` | `triggerHitIndicator`, `clearHitIndicator` |
| the room's occupied hull, capture banner | `room`, `flagCapture` | `noteOccupiedVehicle`, `occupiedVehicleIdFor`, `forgetOccupiedVehicle`, `roomCapture*` |
| the door list | `vehicleEntry` | `dropEntryPoints`, `forgetEntryPoints` |
| the seat's view rig | `seatCamera` | `forgetSeatViews` |
| the hand weapon's presentation | `soldierKit` | `holster`, `drawWeapon`, `addFootLook` |
| the guns' level inputs | `GunFire` | `useLevel(collider, tables)` |

The footstep sound's ray cast also stopped borrowing the soldier's own
scratch hit record (`soldier._hit`), which soldier.js fills for its casts.

Some writes into shared page objects remain, on purpose: the three.js
camera's pose (every view writes it by design), a GunFire's `firstPerson`
flag and callback slots, the HUD line's text, and the `?shots` test hooks,
which poke whatever they probe.

The re-export files the splits left (`flight.js`, `collision.js`,
`physics.js`, `seats.js`, `server/level.mjs`, `server/rooms.mjs`) are kept on
purpose as index modules: each holds its subsystem's research header and a
module map, and the sim, the server and the tests import through them.

### map.html's bags

`page-bag.js` (`from(() => owner, 'a b c:alias')`, `bag(...)`) writes a bag
as its dependencies grouped by owner. About 940 one-line getters became 29
short lists; the keys are unchanged (every bag parsed before and after).

### What was split

| From | Into |
|---|---|
| `local-player.js` (1,916) | `local-player.js` (657): the seat mount, the soldier's life, the lens, the input word; `vehicle-entry.js`: doors, getting in and out; `local-look.js`: the mouse look, render interpolation; `seat-camera.js`: the view rig, the chase law, the seated cameras |
| `page-input.js` (1,183) | `page-input.js` (780): keyboard, mouse, pointer lock, key lock; `touch-controls.js`; `free-camera.js` |
| `hud-feed.js` (993) | `hud-feed.js`: the Hud, the sprite pack, the HUD line; `soldier-hud.js`; `vehicle-hud.js` |
| `map-surfaces.js` | `map-surfaces.js`; `ticket-feed.js` |
| `test-hooks.js` (1,494) | `test-hooks.js` plus `test-hooks-{bots,vehicles,soldier,world}.js`, the same 114 hooks |
| `level-load.js` (2,305) | `level-load.js` (700), `level-{sky,shading,flare,statics,terrain,warmup}.js` |
| `hand-weapon.js` (1,924) | `hand-weapon.js` (504), `kit-loadout.js`, `arms-rig.js`, `hand-fire-sound.js`, `demolitions.js`, `hand-fire.js` |
| `bot.js` (2,691) | `bot.js` (545), `bot-{aim,perception,route,decision,plans,mount,pilot}.js` |
| `ground.js` (3,169) | `ground.js` (750), `ground-{specs,contact,engine}.js`, `tracked-vehicle.js` |
| `flight.js` (2,161) | `vehicle-base.js`, `aircraft.js`, `vehicle-camera.js`, `vehicle-discovery.js` |
| `gunfire.js` (1,872) | `gunfire.js` (357), `gun-groups.js`, `gun-cycle.js`, `round-launch.js`, `projectile-flight.js`, `round-impact.js`, `round-visuals.js` |
| `collision.js`, `physics.js` | `collision-materials.js`, `heightfield.js`, `static-index.js`, `drivable-mask.js`, `world-collider.js`, `point-body.js`, `fixed-step.js`, `soldier-pose.js`, `soldier-locomotion.js`, `walking-body.js` |
| `seats.js` (1,270), `world.js` (1,152) | `seat-survey.js`, `turret-rig.js`, `vehicle-occupancy.js`, `entry-points.js`, `spawned-craft.js`, `fire-state.js`; `world-{input,players,snapshot,bodies,soldier-tick,vehicle-tick,fields,damage}.js` |
| `replay.js` (1,683) | `replay.js` (320), `replay-{recording,server-log,ui,gait,assets,actors,camera,gunfire}.js` |
| `server/level.mjs`, `server/rooms.mjs`, `server/server.mjs`, `play/multiplay.js` | one module per concern (see `server/README.md`); `play/lobby.js`, `play/create-game.js`, `play/stage.js`, `play/front-end.js` |

All the splits moved code verbatim; the engine-research comments went with
their code. Across `viewer/`, `server/` and `sim/`: 131 files became 254 at
the same ~83,000 lines, the largest file went from 5,850 lines to 1,854
(`map.html`, now wiring), and files over 1,000 lines from 21 to 3.

### Found on the way

- **The map page did not load on a touch device** (`9e88fb9d`). Part 2 had
  moved `pageInput` below a load-time `getTouchHudText()` call.
- **A wrecked hull offered its door** (`e9b7327b`). The E-key scan never
  asked whether the hull was destroyed, so the player could climb into a
  burning wreck. The bots' candidate list already skipped wrecks.

### How it was checked

After every step: `python3 -m unittest discover -s tests` (2,824 tests), a
syntax check of every module and of `map.html`'s inline script, ESLint
`no-undef` across the viewer, a parse-based check for `obj.member` reads of
members the object no longer defines, and a live headless pass on El
Alamein. The pass covered deploying, walking, prone, fire and reload, aim
zoom, a Sherman (drive, C cycle, seat switch, seat fire, exit), a Willys, a
manned gun, a Spitfire's throttle, dying on foot and in a wreck, a respawn, a
team and kit switch, a level switch, the full map, the scoreboard, the touch
controls under mobile emulation, and a bot Sherman killing a soldier 40 m
out. The agent-run splits also diffed node harness output and seeded sim
traces against the base commit; they were byte-identical.
