# Artillery spotting: scout cameras

**Status:** built 2026-10-10 for the local player in vanilla, Road to Rome,
Secret Weapons, Desert Combat and DC Final: placing a marker with any
`magType 2` weapon (the Binoculars, Desert Combat's `CallArtillary` and
`AltCallArtillary`), the list, the spotter's radio call, the gunner's
toggle, next and previous, the view through a marker (mode 17) with its
gaze, its endings, and part of the HUD (the scout icon, the minimap wedges,
the fade, the scout line and the binocular overlay). **Not built:** the
traverse and elevation bars, the bearing dial, the scope picture, markers
over the network and in a replay. See "Built in the viewer" below, and
"Open" at the end. The type-14 artillery driver's Fire (SPOT-16) was built
on 2026-09-30.

The research is of 2026-09-30. The retail mechanic is read end to end:
placing a marker, sharing it, looking through it, the view, and the inputs.
The HUD (section 7) and the bots (section 8) were read by one researcher
each and spot-checked. Sections 1 to 6 were re-derived by a second reader.
The ledger rows are SPOT-1..SPOT-17.

The question came from FHSW. The Cromwell's commander seat has an "Artillery
Spotting" weapon. The owner's reading was that it marks a point for friendly
artillery, the way a vanilla scout's binoculars do, and that an artillery
gunner can switch to a camera looking at the spot and correct their fire. That
reading is right, with a few differences in detail. FHSW adds no new engine
code; it reuses the vanilla mechanic on 12 weapons and 696 gun seats (section 9).

**The binaries.** Linux server `bf1942_lnxded.static` (md5 `59bc08ca…`, named
symbols) through `features/bf1942-engine-reference/lnxded/decompile.sh`, and the
client `BF1942.exe` (sha256 `60c9452d…cd3699`) through the Ghidra bridge
(`xref.py`). Addresses starting `0x08` are lnxded, `0x004`..`0x008` the client.

**The data.** `~/.wine/drive_c/EA Games/Battlefield 1942/Mods/{bf1942,XPack1,XPack2,FHSW}/Archives/objects.rfa`,
and vanilla `menu.rfa` `menu/InGame` for the HUD.

---

## How it works, in one pass

1. **A spotter fires a marker weapon.** Any `FireArms` with `magType 2` is one:
   vanilla's `Binoculars`, FHSW's `Land_Spotter` and eleven others. On the
   server, `FireArms::Fire` sends it to `placeScoutCamera` instead of firing
   (SPOT-1).
2. **The server places a marker.** It casts a ray up to 10 km from the
   spotter's camera. The marker goes 30 m straight above the spotter's eye,
   looking at the point the ray hit. The marker is the weapon's projectile, a
   `damageType 3` object that lives out its `timeToLive` (120 s vanilla). Each
   weapon keeps one: a new mark destroys the old one (SPOT-2, SPOT-3).
3. **Every client learns about it.** The marker is a networked object
   (`SpyProjectileInfo`, `c_NIGhostAlways`). When its ghost arrives, each client
   adds it to the game's scout-camera list. It is removed when the projectile
   dies (SPOT-4). The spotter's own client then sends the team radio "artillery
   support" call (59) automatically (SPOT-5).
4. **An artillery gunner looks through it.** A seat can look through markers when
   its `PlayerControlObject` has `artPos 1` and its camera has
   `CVMExternTrace 1`, and at least one marker belongs to a teammate. There,
   **right mouse** (`c_PIAltFire`) toggles the marker view and
   **next/previous item** step through the marker list (SPOT-6..SPOT-9).
5. **The view.** The camera switches to view mode 17. The eye sits at the
   marker, and the gaze eases toward the last shell the gunner's seat fired,
   then back toward the marked point. The gunner watches their own rounds land
   from the spotter's side while still aiming the gun (SPOT-10, SPOT-11).
6. **It ends** when the gunner toggles it off, or when the marker dies (the
   spotter re-marks, or its time runs out). The view mode and field of view are
   restored (SPOT-12).

---

## Built in the viewer (2026-10-10)

### What it does

- **A `magType 2` weapon marks instead of firing** (SPOT-1). On the press of
  its trigger the page casts 10 km from the camera (the weapon's own frame
  for anyone but the page's player), and lists a marker 30 m above the eye
  looking at the hit, or at the fire pose with no owner on a miss (SPOT-2).
  No round, no report, no recoil. Before this the weapon had no gun group at
  all (`gun-groups.js` dropped it as a placeholder), so the trigger did
  nothing.
- **One marker per weapon.** A re-mark removes the weapon's old marker 0.2 s
  later (SPOT-3). The list is newest first and holds both teams' (SPOT-4). A
  marker lives its projectile's `timeToLive` on the world's tick clock.
- **The spotter's call** (SPOT-5): "You called for artillery!" in the log and
  team radio 59, when the marker listed is his own. A gunner sitting in an
  `artPos` seat gets "<name> called for artillery (timeleft: N)" once per new
  teammate marker.
- **The gunner** (SPOT-6..SPOT-9): in a seat the table lists, with a marker
  owned by a current teammate, the press of alt-fire toggles the view and
  the mouse wheel (next / previous item) steps the list, enemy markers
  included, with the stall the client has. Elsewhere the wheel keeps its
  meaning.
- **The view** (SPOT-7, SPOT-10, SPOT-11): the camera sits at the marker's
  eye. Its look-at point starts 20 m along the marker's forward and moves a
  tenth of the way per rendered frame toward the seat's latest shell, or
  back to that point with none in the air. The seat's interior is turned
  off as in an outside view. Off puts the interior and the field of view
  back; the seat's own view mode is never changed, so there is nothing else
  to restore.
- **The endings** (SPOT-12): alt-fire, the marker leaving the list, its whole
  seconds reaching 0. Leaving the seat drops the view and restores nothing.
- **The HUD** (SPOT-13, in part): `Icon_scout_1` / `_2` at (174, 503)
  changing every 1.5 s while a teammate's marker lives; each such marker on
  the minimap and full map as `artillery_minimap_camview`, centred on its
  eye and opening along its gaze, the selected one blinking by
  `Game.setCameraBlink`; on a toggle or a step a black fade held 0.5 s and
  cleared over 2.5 s; "Scout: <name>" and the whole seconds left at
  (280, 470); `binocular.tga` at (-8, -2, 825, 625) while looking.

### Where

| Piece | Where |
|---|---|
| `artPos` and the `DirBar*` words | `bf42/con.py` (`art_pos`, `dir_bar`) |
| Which seats, the blink, the three lexicon lines, the four pictures, per mod | `extract_vehicle_spotting.py` -> `<maps tree>/_shared/vehicle-spotting.json` and `_shared/spotting/*.png`; `extract_maps_all.py` writes them after its levels |
| The rules (pure) | `viewer/spotter.js`: `isMarkerWeapon`, `lookAtMatrix`, `markerPose`, `ScoutCameras`, `ScoutView`, `ScoutSelector`, the HUD's `teamMarkers`, `scoutIconFrame`, `wedgeBlinkAlpha`, `fadeAlpha`, `scoutLine`, `calledLine`, `artSeat` |
| The pull | `viewer/gun-cycle.js` (`guns.onMark` on the press, no round), `gun-groups.js` (a marker weapon keeps its group), `hand-fire.js` (a hand weapon's pulse ends on the mark) |
| The page's side | `viewer/map-spotter.js`: the ray, the seat, the camera, the keys, the trace, the minimap wedges and the `scout-canvas` paint. Built in `map.html`; `map-surfaces.js` draws the wedges; `page-input.js` hands the wheel over; `comms.js` `callArtillery` and `text` |
| Test hook | `window.__spotter()`: the seat's entry, the gate, the markers, the selector, the view and its look-at, the traced shell, the HUD. `__spotter.toggle()` and `__spotter.step(dir)` are the keys |
| Tests | `tests/test_spotter.py` + `tests/spotter_harness.mjs` (41 tests: the matrix, placing, the list, the view, the selector's quirks, the endings, the HUD rules, the parser and the table), and `tests/test_spotter_pull.mjs` (`gun-cycle.js`: one mark a press, no round) |

`magType` rides the glbs already. `artPos` does not, and goes in a table
beside `vehicle-sonar.json` for the same reason that one does: no mesh
depends on it and every level's `scene.glb` holds a baked copy of every hull.

The table and its pictures are new files in each tree and have to be
published with the levels: `_shared/vehicle-spotting.json` and
`_shared/spotting/{icon_scout_1,icon_scout_2,camview,binocular}.png`.
Without them the viewer still places markers and makes the call; no seat
can look through one.

### How it was checked

Headless Chromium on the worktree's own server, `map.html?shots=1&dev=1`,
frames stepped with `__renderOnce` at one tick a frame.

DC Final Kursk, team 1:

- OH-6 pilot, alt-fire held 20 frames: one marker. Its eye is the camera's
  position plus exactly 30 in y, its forward `normalize(target - eye)`, 119.2
  s left, no round in flight and both gun groups at 0 shots. The log reads
  "You called for artillery!" and "[D2] Player: Artillery needed!".
- A second press: the new marker at the front, the old one given a removal
  time 0.2 s after the press, still listed 5 ticks later and gone at 8.
- Co-pilot seat (`H6CoPilot`), main fire: a second weapon's marker; both
  stay.
- M-109 driver's seat: no table entry, gate shut, alt-fire does nothing.
  Gunner's seat (`M-109_Gunner_PCO1`): gate open, icon up, two wedges, the
  line "Player called for artillery (timeleft: 118)".
- Alt-fire: the camera at the newest marker's eye to 1e-9, its direction the
  marker's forward, field of view unchanged at 57.3, look-at 20 m ahead,
  "Scout: Player" and 117 s. Next and previous move the view between the
  two markers.
- The gun fired at 30 degrees: for all 39 following frames the look-at point
  equalled `previous + 0.1 x (shell - previous)` to the last digit.
- Alt-fire again: the camera back at the seat, 57.3. On again and left
  alone: the countdown ran to 0 at the marker's 120 s, the view dropped, the
  selection cleared, the list empty, the icon off.

Vanilla Kursk, scout kit, Binoculars in hand: one click, one marker, eye 30
above the camera, target equal to the page's own `__castRay` from the same
eye and direction to the last digit; no shot counted; a held trigger marks
once; a second click replaces the first marker.

Vanilla Kursk again: a Binoculars mark on foot, then the Katyusha. Its
driver's seat has no entry and alt-fire does nothing; `Katyusha_PCO1` takes
the view, the camera 362 m from the seat.

`python3 -m unittest discover -s tests -p 'test_*.py'` passes (5325 tests,
through `./scripts/verify.sh --skip-e2e`). That script's API half did not
run on 2026-10-10: `dotnet restore` stopped on NuGet's audit of
`SixLabors.ImageSharp` 3.1.12, which this work does not touch.

### What the build decided where the record is silent

Each of these is the viewer's choice and not a reading:

- **The pull is the trigger's press.** `FireArms::Fire` is what branches,
  and when it is called for a held trigger was not read for this branch.
  Every marker weapon surveyed declares `fireOnce 1` (section 9), so the
  viewer marks once per press. A `magType 2` weapon without `fireOnce` would
  need the read.
- **The ray skips the spotter's own hull and ignores the water.** The row
  names the object test and the terrain's collider and no water plane, so
  the cast runs with the water off. Whether `ObjectFlagPredicator(0x200)`
  lets the ray meet the vehicle the spotter sits in was not read; the viewer
  skips it, as its rounds do. The object test's one-unit head start is not
  modelled.
- **A miss has no team.** The engine leaves whatever the pooled projectile
  held. The viewer gives it none, so it is never a teammate's and never
  drawn, and next / previous can still land on it.
- **A selection whose marker has left the list is cleared on the next
  frame.** The record has the countdown clear it at 0 and
  `checkIfLocalPlayersArtCameraIsRemoved` only turn the camera off. Without
  the clear, the first alt-fire after a re-mark would be spent turning off a
  view that is already off.
- **"A list of one does nothing" is applied only with a marker selected.**
  With none, next takes the one marker.
- **The seconds are drawn after the scout line** on the same row, 8 units
  on. The row gives the box's corner and not the number's place in it.
- **The scout icon's condition** is the minimap's: a teammate's marker (by
  the team stored on it) with life left.
- **Alt-fire is not kept from the seat's own weapon.** No `artPos` seat in
  the five mods has a weapon on `c_PIAltFire` (the table records each
  seat's `weaponInputs`), and no seat that carries `AltCallArtillary` is an
  `artPos` seat, so the two uses of the button never meet in this data.
- **The spam limit** is run on the spotter's radio call, with the keys' own
  counter (it is inside the team send, `0x006d41c0`). A refused call still
  places its marker and prints its log line. Until 2026-10-10 it was not
  run, and a spotter clicking fast started one voice a click.

---

## 1. The marker weapon: `magType 2`

`FireArms::Fire` `0x0828a090` branches on the weapon template's `+0x230`.
`magType`'s console setter (`ConsoleClass289::executeObjectMethod`
`0x082c9440`) writes that field. `magType 1` (the medic and repair packs'
heat bar) takes a branch of its own that only draws down the magazine. With
`magType 2`, when fired by
a player, it calls `FireArms::placeScoutCamera(IPlayer*)` `0x0828dde0` and
returns. No round is fired. **`damageType 3` does not choose this branch;
`magType 2` does** (SPOT-1). The projectile's `damageType 3` matters later,
for the list (section 2).

`placeScoutCamera`, in order:

- **Server only.** It returns at once if the game answers
  `queryInterface(IID_IGameClient 0x1d4c2)`. A pure client never places a
  marker; it hears about the server's (section 2).
- **One marker per weapon.** `FireArms +0x1d4` holds the last marker's object
  id. If that object still exists and its template's class is
  `CID_ProjectileTemplate` (`0x9495`), `Projectile::detonate` `0x0831e680`
  runs on it. `detonate` does not remove it at once: it posts message `0x18`
  with a 0.2 s delay (`ObjectManager::postMessage`, vt+0xc8), so the old
  marker leaves the list about 0.2 s later. So re-marking moves the camera,
  and firing at the sky removes it (below).
- It creates a projectile from the weapon's projectile template (`+0x194`) and
  stores its id in `+0x1d4`. This happens before the ray is cast.
- **The ray.** It starts at `getFireArmsTransformation()` `0x0828cdc0`. With
  `fireInCameraDof` (template `+0x264`, set on the Binoculars and every FHSW
  spotter) that is the player's camera (XHIT-12). The ray runs 10000 along
  the matrix's row 2 (forward). The object test (`objectManager` vt+0x48,
  `intersectLine`, `ObjectFlagPredicator(0x200)`) starts one unit ahead, at
  row 3 + row 2. The terrain's vector collider starts at row 3. Both
  distances are measured from row 3, and the terrain replaces the object hit
  only when strictly nearer (`0x0828e2bd`), so a tie goes to the object.
  `10000.0` is read from `0x086c04a8`.
- **Placement, only when the hit is strictly nearer than 10000** (`fucompp` at
  `0x0828e0d1`, `test ah,0x45`). The marker's matrix is
  `calcLookAtMatrix(from = eye + (0, 30, 0), to = hit, up = (0, 1, 0))`.
  `30.0` is read from `0x086b01b4`. `calcLookAtMatrix` `0x08159b80` sets row 2
  to `normalize(to − from)`, row 0 to `up × fwd` (normalised), row 1 to
  `fwd × right` and row 3 to `from`. Then:
  - `+0x134..+0x13c` = the hit point, the spotted target;
  - `+0x108` = the spotter's `BFPlayer::getId()` (vt+0x48);
  - `+0x12c` = the spotter's team (`IPlayer +0x7c`);
  - `game->placeScoutCamera(marker)` (Game vt+0x88, `0x0805e740`). This calls
    `removeScoutCamera` (vt+0x8c) first, so a marker is never listed twice.
    It then links the marker in **before the first node** of the list at
    `Game +0x5c`, so the list is **newest-first** (client `0x0040ee00` does
    the same).
- **A miss** (nothing within 10 km, such as the sky) still leaves the new
  projectile alive. It was given the fire matrix before the ray
  (`0x0828df4f`), and `activate` set its owner `+0x108` to −1 (`0x0831e120`).
  The server does not list it, but clients do: they list any activated
  `damageType 3` ghost (section 2). There it sits at the spotter's camera pose
  with no owner, and a team value left over from the pooled projectile. It
  can never be viewed (the owner lookup fails), but next/previous can land on
  it (section 4). The old marker is gone either way.
- **Straight down.** When `to − from` is parallel to world up (`|fwd·up|`
  within `1.19e-7` of 1), `calcLookAtMatrix` has already written row 2, but
  leaves rows 0, 1 and 3 at identity, **so the position is the origin**. The
  camera then refuses the view, because `Camera::setViewMode(17)` rejects an
  all-zero position (section 5). The spotter would have to mark the point
  exactly below their own eye, 30 m plus eye height down from `from`, so this
  only matters as a guard.

The projectile's own template supplies the rest. Vanilla's
`BinocularsProjectile` has `timeToLive CRD_NONE/120/0/0`,
`hasCollisionPhysics 0`, `gravityModifier 0.0`, `hasCollisionEffect 0`,
`damageType 3` and `networkableInfo SpyProjectileInfo`. The marker neither
moves nor collides, and it lasts two minutes. The Binoculars'
`projectile2Template BinocularsProjectile2` has none of that.
`FireArms::Fire`'s `magType 2` branch never reads it (open whether alt-fire
uses it; the Binoculars have `altFireOnce 1`).

## 2. The list, and the network

`SpyProjectileInfo` is `setPredictionMode PMLinear` with
`setBasePriority c_NIGhostAlways`
(`Objects/HandWeapons/Common/Network.con`). The name says the marker is
ghosted to every client whatever its distance. That reading is **inferred**:
the priority's effect was not traced.

On a client, `ProjectileNetworkable::setNetUpdate` `0x08232be0` copies
`+0x134` (the target), `+0x108` (the owner) and `+0x12c` (the team) off the
wire. When this update ran `activate()` and the template's `damageType`
(`+0x160`, `ConsoleClass377` `0x082dc1e0`) is **3**, it calls
`game->placeScoutCamera` (`0x08232f95`; client twin `0x0055ed45` →
`0x0040ee00`). `activate()` runs on a full update and **also on every delta
update** whose state `+0x20` is 0 (`0x08232ee7` → `0x08233050`). Each such
update re-lists the marker: `placeScoutCamera` removes it first, which drops a
gunner who was looking through it (`checkIfLocalPlayersArtCameraIsRemoved`),
then puts it back at the front. `updateStateMask` `0x08232630` flags only
changes, so a marker that never moves may never get a delta. Whether one does
is **open**. `Projectile::destroy` `0x0831e610` and `resetProjectile`
`0x0831e720` call `game->removeScoutCamera` for the same `damageType 3`.
`removeScoutCamera` `0x0805e7a0` unlinks the marker and calls
`checkIfLocalPlayersArtCameraIsRemoved` `0x0805f940` (client twin `0x0040c490`).
If the local player is in view mode 17 on that very marker, this calls
`toggleScoutCamera(-1)` and drops the view (SPOT-4, SPOT-12).

So the list is every live marker, **both teams'**. Filtering by team happens
when a gunner picks from it (section 4).

**The spotter's client calls for artillery by itself.** The client's
`Game::placeScoutCamera` is `0x0040ee00` (the same remove-then-append). When
the new marker's owner (`+0x120`) is the local player (`getId`, vt+0x44) and
the message log exists (`[0x00971eac]+0x128`), it calls `0x006a6540`. That
function logs lexicon `PLAYER_CALLED_FOR_ARTILLERY` (string `0x0091d638`) and
sends **team radio 59**, `RADIO_ARTILLERY_SUPPORT`, through
`0x006d4590(0x3b)` → `0x006d41c0` (`0x006a6597`). So marking a target is heard
by the team as the "artillery support" radio call. The viewer's `radio.js`
already maps 59 to team patch 12. Gunners get a line too:
the minimap's update (`BfMap__update` `0x0046a680`) logs `CALLED_FOR_ARTILLERY`,
"<name> called for artillery (timeleft: N)", once per new teammate marker
(`BfMap +0x108` remembers the last one). Only players sitting in an `artPos`
seat see it (section 7).

## 3. Which seats can look through a marker

The seat's `PlayerControlObject` must say yes: `getArtPos()` `0x08318c10`
returns template `+0x1f0` (`ObjectTemplate.artPos`).
`BFSoldier::getArtPos` and `FreeCamera::getArtPos` return 0. Every caller finds
that PCO the same way: start at the player's vehicle, `queryInterface`
`IID_IPlayerControlObject` (`0xc4c5`), and failing that climb to the parent
through `IID_ICompositeObject` (`0xc378`, `+0x50`). On the client,
`0x006a65b0` queries the vehicle object itself.

The camera must say yes too. `Camera::setViewMode` `0x081ac7c0` takes mode
`0x11` only when the camera template's `+0x1c0` is set. That is
`CVMExternTrace`, default 0 (CAM-1, CVM-1), registered as `ConsoleClass228`
at `0x081b3fdd`. In vanilla and XPack2, every `artPos` seat has a
`CVMExternTrace 1` camera below it (section 9). A seat with `artPos` but no
such camera passes the input gate, but the camera refuses the mode. The client
toggle then returns without sending anything (`0x004b8bc8`).

In vanilla only the gunner's seat qualifies, not the driver's. The Priest's
`artPos 1` is on `Priest_Gunner_PCO1` and `CVMExternTrace 1` on
`PriestGunnerCamera`; the hull `Priest` has neither.

## 4. The inputs

The client's player-input dispatcher, `Setup__dispatchPlayerInput`
`0x00448520`, reads the player-input array (55 channels) through `0x00407d60`.
`0x17` = `c_PIAltFire`, `0x2e` = `c_PINextItem`, `0x2f` = `c_PIPrevItem`. The
client's name switch at `0x005561d0` gives these numbers, and lnxded's
`operator<<(PlayerInputMap)` `0x081d89f0` and `io::Module::init` agree.

- **Toggle, `c_PIAltFire`** (`0x00449089`). It fires only on the press
  (`+0x1ac`/`+0x1b0` latch the previous frame's state), and only when
  `0x006a65b0` returns true: the local player's vehicle is an `artPos` PCO,
  **and** at least one marker on the list has an owner
  (`getPlayerFromId(marker +0x120)`) on the local player's team (`+0xac`).
  It calls `0x006a6a60`, which calls the selector `0x006a66b0(true)`.
- **Next / previous, `c_PINextItem` / `c_PIPrevItem`** (`0x00448d09`,
  `0x00448d5f`). Under the same `0x006a65b0` condition they call `0x006a6a80`
  (next) and `0x006a6b80` (previous). **They do not skip enemy markers.**
  - Nothing selected yet: next takes the list's **first** marker (the newest)
    and previous the **last** (the oldest), and only if that marker's team
    (`+0x144`) is the player's. Otherwise the key does nothing.
  - A marker selected: they look it up (it must be on the player's team and
    carry the selected id), then step to the neighbouring node, wrapping at
    the ends, **without checking the neighbour's team** (`0x006a6b1d`..).
  - A list of one does nothing (`0x006a6ae7`).

  Each then calls the selector with `false`. If the new marker is an enemy's,
  the selector refuses the view but keeps it selected. The lookup then fails,
  so next and previous do nothing more until alt-fire toggles and clears the
  selection. **When `0x006a65b0` fails, the keys go to their usual handling**
  (`0x006ccae0` / `0x006ccb30` when `[ebx+0x90]` is set, else `0x006d4a60` /
  `0x006d4ae0`).

The client's copies of the marker fields sit 0x18 above the server's:
`+0x120` owner, `+0x144` team, `+0x14c` target. The gunner's own team is
`BFPlayer +0xac` in the client. **Two different team tests are used.** The gate
`0x006a65b0` and the selector's "on" branch use the owner's current team,
`getPlayerFromId(+0x120) → +0xac`. Next, previous and the selector's first
pick use the team stored on the marker, `+0x144`.

**The selector** `0x006a66b0(bool toggle)`:

- It finds the current marker: the selected id (`+0x104`), or, when none is
  selected, the first marker whose team is the player's.
- **It turns the view off** when `toggle` is set and the view is already on
  (`+0x10c`), or when no marker is found, or when the marker's remaining life
  is below 0 (`0x00541ed0`). It calls `game->toggleScoutCamera(...)` and
  clears `+0x104` and `+0x10c`. Remaining life is `timeToLive` (template
  `+0x260`, a CRD) minus (now − the marker's birth time `+0x13c`).
- **Otherwise**, if the marker's owner is on the player's team, it sets the HUD
  text to lexicon `SCOUT` + `L": "` + the spotter's name, shown for the
  marker's remaining life (`0x006a7900`; section 7). It calls
  `game->toggleScoutCamera(marker id)` and sets `+0x10c`. **The toggle's
  result is ignored.** The HUD line appears and `+0x10c` is set even when the
  camera refuses mode 17. On a seat with no `CVMExternTrace` camera, alt-fire
  therefore shows the line without the view.
- Both toggle calls are skipped when the vehicle's PCO vt+0x3c returns 0.

**The toggle** (`GameServer::toggleScoutCamera(unsigned)` `0x08158e10` = Game
vt+0x9c; client twins `0x004acf70` for a local server and `0x004b8af0` in the
pure client):

- **On** (the id resolves to an object). It finds the local player's PCO and
  requires `getArtPos`. It sets `camera->setExternCameraTrans(marker matrix)`
  (camera vt+0x38 through `ICameraObject`, stored at `Camera +0x210`). If the
  view mode is not already 17, it saves the mode (`+0xc`) and the render
  view's field of view (`+0x4`). It then calls `camera->setViewMode(17, 0, 0)`.
  If that succeeds, it records the id (`+0x8`). The client also sets a HUD
  flag (`0x006a9b20(1)`, section 7). The pure client additionally sends
  **`ReqScoutCameraEvent`** (game event `0x26`: u8 player id, u16 the marker's
  network id; client vtable `0x008db934`, deserialise `0x004a3c10`) to the
  server.
- **Off** (the id resolves to nothing, e.g. -1, while `+0x8` holds one). It
  restores the field of view and the saved view mode, resets the extern
  matrix to identity, sets `+0x8 = -1`, and on the client clears the HUD flag
  (`0x006a9b20(0)`, `0x006a6530`). **It runs only while the local player is
  still in an `artPos` PCO** (lnxded `0x08159048`..; client `0x004b8c4e`..).
  Otherwise it returns with `+0x8` still set and the mode and field of view
  not restored. The pure client sends nothing when turning off.
- **The server's handler** `GameServer::toggleScoutCamera(unsigned short,
  unsigned char)` `0x08158aa0` runs from `handleGameEventManagerEvent`
  (`case 0x26`, `0x08136a28`). It finds the marker by
  `networkManager::getObject(u16)` and the player by `getPlayerFromId(u8)`.
  It then applies the same "on" steps to that player's camera on the server,
  except that it records no id. Why the server keeps its own copy is **open**.
  A guess is ghosting relevance, since the server scopes what it sends by the
  player's camera. Nothing on the server turns it back off.

## 5. What the gunner sees: view mode 17

`Camera::getTransformation` `0x081aaf90`, mode 17. `Camera +0x210..+0x24c` is
the extern matrix: row 1 up at `+0x220`, row 2 forward at `+0x230`, row 3 the
eye at `+0x240`.

- **The eye is fixed** at the marker: 30 m above where the spotter stood,
  looking at what they marked. Nothing in mode 17 reads the mouse, so the view
  does not turn with it. That the gun keeps taking the mouse is **inferred**:
  the gun's `RotationalBundle`s read `c_PIMouseLookX/Y` themselves, and no code
  that stops them in mode 17 was found.
- **The gaze follows the gunner's shell.** `FireArms::fireBarrel` `0x0828aba0`
  finds the firing seat's PCO and calls `setTraceObjectId(shell id)`
  (`Camera +0x254`) on **every camera it owns**. In mode 17 the look-at point
  `+0x1ec..+0x1f4` moves 10% of the way per call toward that shell's
  position. With no live shell it moves toward `eye + 20 × forward`, which is
  back along the marked direction. The output is
  `calcLookAtMatrix(eye, look-at point, up = row 1)`. So the camera swings to
  pick up the round in flight, then drifts back to the marked spot. "Trace"
  in the mode's name means following the shell. The branch runs only when
  `dt ≠ 0` and a PCO is found up the camera's parent chain. The trace id is
  set in lnxded's `fireBarrel` through `IPlayerControlObject::getCameras`
  (slot 0x34) and `ICameraObject::setTraceObjectId` (slot 0x30). The client's
  twin of `fireBarrel` was not checked, and the view runs on the client.
- `setViewMode(17)` (`0x081ac7c0` case `0x11`) calls `lodObjectOff` on the
  camera, as the other outside views do. It refuses when the extern matrix's
  position is exactly (0, 0, 0). It seeds
  the look-at point at `eye + 20 × forward`.
- The per-call easing is per `getTransformation` call, which is per rendered
  frame, not per sim tick. **Inferred**: the call site's cadence was not traced.

What the view does if the marker's object disappears mid-view is in section 6.

## 6. When the view ends

- The gunner presses alt-fire again (the selector's toggle branch).
- The marker is removed from the list: re-marked, timed out, or otherwise
  destroyed. `checkIfLocalPlayersArtCameraIsRemoved` turns the view off when
  it was that marker (`0x0805f940` / client `0x0040c490`).
- The selector finds the marker's remaining life below 0.
- A delta update re-lists the marker (section 2), which drops the view.
  Whether static markers get deltas is **open**.
- Mode 17's branch in `getTransformation` also checks the object id at
  `Camera +0x258`. It resets when that object is gone, or when its absolute
  position differs from the camera's: the extern matrix goes back to identity,
  the field of view is restored (`+0x25c`), and the view steps back a mode
  (`prevViewMode`, vt+0x104). In lnxded nothing writes `+0x258` but the
  constructors (−1) and this reset, so the branch is inert there. The client
  was not checked (**open**).

**Leaving the seat.** `toggleScoutCamera(-1)` and
`checkIfLocalPlayersArtCameraIsRemoved` both do nothing unless the local player
is in an `artPos` PCO. So neither restores anything after the gunner leaves.
The seat's own camera stops being the player's view anyway. Whether a stale
selection (`+0x8`) matters on the next entry is **open**.
`Camera::resetCameraView` / `handleMessage` call `resetTempCamera`, which is
a different mechanism (the `SetTempCameraEvent` temporary camera).

## 7. The HUD

This is all client code; lnxded has no HUD. A researcher read it on
2026-09-30 and it was not re-derived by a second reader. Two points were
spot-checked: the direction-bar gate (`0x006ae63e`..`0x006ae657`) and the
list order. The HUD's `DirectionBar` group is `[[0x00a5f1a8]+0xc]+0x18`
(registrar `0x006ea4f0`). The camera-timer fields sit on the HUD object
`0x00973ab8` (registrar `0x006e10b0`).

**The spotter** sees nothing new beyond the chat line
`PLAYER_CALLED_FOR_ARTILLERY` ("You called for artillery!") and the radio call
of section 2.

**A gunner in an `artPos` seat, before looking:**

- **`CameraPlaced`** (`[[0x00a5f1a8]+0x44]+0x20`) is written only by
  `0x006e3510` from `BfMap__update`. That branch requires the seat's
  `getArtPos()` (`0x0046cf77`). The engine sets it to zero or non-zero. The
  meme flips it between 1 and 2 every 1.5 s to blink `Icon_scout_1.tga` /
  `Icon_scout_2.tga` at (174, 503) in the 800×600 HUD space. That is the "a
  scout camera is available" icon.
- The chat line `CALLED_FOR_ARTILLERY` for each new teammate marker
  (section 2).
- **The minimap** (`BfMap__update` `0x0046cf66`..`0x0046d465`, only in an
  `artPos` seat) draws each teammate marker (`+0x144` = player `+0xac`) with
  remaining life > 0 as `Minimap/artillery_minimap_camview_128x128.tga`. The
  sprite is a yellow wedge, 128 units, centred on the marker's **eye** (not
  its target). It is rotated by the map's rotation − atan2(fwd.x, fwd.z) −
  π/2, so the wedge opens along the look direction. Slot `+0xe4` draws the
  others at alpha 1. Slot `+0xe8` draws the one being viewed (id ==
  `+0x104`), blinking per `Game.setCameraBlink 0.75 1.5` (`Menu.con`):
  hidden for 0.75 s, alpha 0.6 until 1.5 s, then around again.

**While looking** (view mode 17):

- **A fade.** Toggle-on, next and previous set `Camera/CameraFade` = 1
  (HUD `+0x444`; `0x006a6a74`, `0x006a6c60`, `0x006a6c80`). The meme then
  drives `Camera/CameraFadeAlpha` over a full-screen black quad: to 1 at once,
  then down to 0 over 2.5 s after a 0.5 s hold. The timings are read from the
  meme's fields and were not traced.
- **The scout box** at (280, 470). `Camera/CameraTimerText` (`+0x680`) is
  "Scout: <spotter>" (lexicon `SCOUT` = "Scout"). `Camera/CameraTimer`
  (`+0x678`, an int) is the marker's remaining whole seconds, rewritten every
  frame by `BfMap__update`. It is shown while the timer ≠ 0. At expiry it
  writes 0, clears the selection and calls `toggleScoutCamera(-1)`
  (`0x006a7960`).
- **The overlays.** Turning the view on sets `CrossHair/ScopeIndex` = 1
  (`0x006a9b20`), which switches on the full-screen scope picture; which
  icon it holds then was not traced. The direction-bar group adds
  `binocular.tga` over the whole screen at (−8, −2, 825, 625).
- **The direction bars.** `DirectionBar/ShowDirectionBar` is set per frame in
  `0x006ad0a0` (`0x006ae63e`..) only when all of these hold: `CameraPlaced` ≠ 0,
  the camera's view mode is 17, and the seat's PCO has a weapon. The same
  branch forces `ShowCrossHair`. The values (`0x006ae6ee`..`0x006ae9ce`) are:
  - **X, the traverse.** X is the gun's yaw relative to its PCO in degrees,
    positive to the right. This holds where the camera rides the gun's
    bundles, as every vanilla artillery camera does; the formula compares the
    weapon's and the active camera's transforms. With `DirBarRotate` R > 0
    (180 on the rear turrets), X becomes X − R when X > 0, else X + R.
    `DirectionBarX = 128 + 128 · X / DirBarXScale`, not clamped.
  - **Y, the elevation.** Y is the gun's elevation − 90° relative to the
    vehicle root, in degrees.
    `DirectionBarY = (Y − DirBarYScaleMin) · 256 / (DirBarYScaleMax − DirBarYScaleMin)`.
    `DirectionBarYNormal = DirBarYScaleBelow · 256 / (Max − Min)` places the
    zero line. So the Priest's −90..−50 spans elevations 0..40°.
    `DirBarYScaleAbove` is never read.
  - **The "old" ghosts.** `OldDirectionBarX/Y` copy X and Y whenever
    `c_PIFire` reads pressed (`0x00449008` → `0x006acb20`). They are drawn at
    alpha 0.4, so the gunner sees where the gun was when they last fired and
    can correct from there. A HUD reset parks them at 999, off-screen.
  - **The layout.** A yaw ruler `artillery_grid_hori_256x32` at (272, 139)
    with a zero mark at x = 400. An elevation ruler turned upright, centred at
    (56, 300). The yellow `artillery_marker_32x8` on each is shifted by the
    value − 128, with its 0.4-alpha ghost beside it.
- **The bearing dial.** A static `artillery_circle_256x256` sits at
  (273, 174). A ring and `artillery_arrow_16x16` rotate on it:
  - `ArtPosAngle` = −atan2(−Δz, Δx) (mod 2π, radians), where Δ = the viewed
    marker's eye − the gun PCO's position. That is the bearing to the
    spotter's vantage point.
  - `ArtDofAngle` = the signed horizontal angle from the gun's forward to the
    marked target (`+0x14c`) − the gun position, radians, positive to the
    right. That is how far to traverse.
  - Both update only while a marker is selected.

  The meme turns the pair about pivot (0, 1) with `ArtPosAngle`, and each item
  about its own centre with `ArtDofAngle`. The pivot is the screen's
  top-left, not the dial's centre (401, 302). If that reading of
  `RotateAroundCoordinateEffect` is right, retail's ring swings off-screen for
  most bearings. **Unconfirmed against a capture.** Every installed mod ships
  the same values.

Found in passing, not fixed:

- `bf42/meme.py` reads `RotateAroundCoordinateEffect`'s fields as X, Y, Angle,
  multiplier. The client reads Angle, multiplier, X, Y (`0x007e2570`).
- `extract_menu_layout.MenuFlattener` treats `TranslateNode` as moving only
  the origin, whereas `0x007e96a0` moves the pictures after it too.
- `parity-audit/vehicle-physics.md` credits the `DirBar*` values to the
  submarines. In vanilla and the packs they are on the `artPos` guns plus
  `Sherman_T34`, `SturmTiger` and `Wasserfall`. `Wasserfall` has no `artPos`,
  so its bars never show.

## 8. Bots

**Bots take no part in this mechanic in vanilla.** They never place a marker,
never read the list, and never answer the artillery radio. A researcher read
this on 2026-09-30, and the two load-bearing lines were re-checked
(`distributeArtillery`'s body, and the client's radio call in section 2).
Symbol-level detail is in the scratch report
(`scratchpad/arty/ai/`, not kept); what matters:

- **`SAI::distributeArtillery` `0x08634850` is empty**
  (`push ebp; mov ebp,esp; pop ebp; ret`). It is state `0xd` of
  `SAI::update`'s step machine, after `distributeAttack`. So the strategic AI
  gives artillery no targets.
- **Bot artillery is ordinary target picking.** The gun seats are AI type 13,
  `FixedLargeBore`: the Priest's, Wespe's and Katyusha's guns, the DefGun and
  XPack2's Calliope. They score targets on the large-bore rule (AI-54, AI-124)
  from their own spotted list and `getEnemyObjects(850 m)`. The hulls of the
  Priest and Wespe (and XPack2's Flakpanzer) are type 14, `ArtilleryDriver`.
  Its `.con` behaviour `BBFireDriver` builds `BBFireArtilleryDriver`
  (`0x0856a650`). With the gun seat occupied it returns the large-bore
  urgency scored from that seat. With the seat empty it returns
  `BBFireUnarmed`'s result, which is always 0 (SPOT-16). Its plan
  `BBPFire2dDriver` (`0x08596fa0`) only moves and
  turns the hull toward an enemy object, and never fires. Nothing reads a
  marker or a map point.
- **An unfinished request-driven design is dead code.** `BBIndirect` and
  `BBRadio` have no callers, and `IAIEnvironment::getRadioedObjects`
  (`0x085e31d0`) only clears its vector. No vanilla, XPack1 or XPack2 file sets
  `addType ITArtillery`.
- **"Scouting" in the AI is looking around** (AI-37). `BotMain +0x1ec`
  (`getIsScouting`) and `BAPIWScout` belong to the `Scout` behaviour, not to
  binoculars.
- **Vanilla bots cannot pick the Binoculars.** The template has no
  `aiTemplate`, so no AI weapon is made for it (`SimpleObject` ctor
  `0x081da216`). **FHSW is different:** its Binoculars carry
  `aiTemplate BinocularAI` (range 75–200 m). An FHSW bot could therefore fire
  them and place a marker on the server. That is inferred from data and was
  not run.
- **Bots neither send nor read the artillery radio.** They never send radio at
  all (`AIRadio::sendMessage` is reached only from a client's event). The
  AI's radio readers read 15–21 and others, but never 13 `RMArtilleryReady`
  or 59 `RMArtillerySupport`.

For the viewer this means bot artillery stays target-driven, as `bot-fire.js`
has it. The type-14 hull's driver is built to the engine's rule since
2026-09-30 (ledger SPOT-16): his Fire is the gun seat's large-bore urgency while
the gun is manned and 0 while it is empty (`BBFireUnarmed` returns 0), and his
plan turns and places the hull for the gun and never fires. The viewer had
scored the hull seat with its own weapons: none on the Priest and Wespe, so the
driver never turned the hull for his gunner, and the Flakpanzer's coaxial MG,
so that driver fought with it.

## 9. Who has it: the data survey

Per mod's `objects.rfa`, counted by template (`scratchpad` script
`survey.py`, 2026-09-30):

| Mod | `magType 2` weapons | `damageType 3` projectiles | `artPos 1` seats | `CVMExternTrace 1` cameras | `artPos` seats with no such camera |
|---|---|---|---|---|---|
| bf1942 | 1: `Binoculars` | 1: `BinocularsProjectile` | 11 | 10 | 0 |
| XPack1 | 0 | 0 | 0 | 0 | 0 |
| XPack2 | 0 | 0 | 2 | 3 | 0 |
| FHSW | 12 | 6 | 696 | 233 | 12 |

**Vanilla's 11 seats:** `Defgun`, `Katyusha_PCO1`, `Priest_Gunner_PCO1`,
`Sexton`, `Wespe_Gunner_PCO1`, `HatsuzukiRearPCO`, `PrinceOW`,
`PrinceOW_SternCannonTower`, `Yamato`, `YamatoRearPCO` and
`Fletcher_Back_Canons_PCO`. So the fixed coastal guns, the battleships' and
destroyers' main guns, the Katyusha and the three self-propelled guns can all
fire from a scout's marker.

**XPack2:** `Sherman_T34_PCO1` (the Calliope) and `SturmTiger`. XPack2's
`Wasserfall_Camera_PCOID1` has `CVMExternTrace 1` but no `artPos` seat above
it. Scouts in XPack1 and XPack2 carry vanilla's `Binoculars`.

**FHSW** puts `magType 2` on `Binoculars`, `Air_Spotter`, `Artillery_Spotter`,
`SdKfz251/20UHU_Spotter`, six tank-destroyer spotters (`StuG3G_Spotter`,
`StuH42_Spotter`, `SU100_Spotter`, `SU122-3(1944)_Spotter`, `SU122P_Spotter`,
`SU85M_Spotter`), `Land_Spotter` and `Land_Spotter_Alt`. Every one of their
projectiles is `damageType 3`. `Land_Spotter` and `Land_Spotter_Alt`
(`setInputFire c_PIAltFire`) sit on about 127 and 68 vehicle seats across the
`!_PACK_*` files.

FHSW's 696 `artPos` seats include every field gun, howitzer battery, mortar
and AT gun, plus the "radio" aircraft (`RadioLancaster`, `RadioTyphoon`,
`RadioWellington`, the `Radio*` German set). Twelve `artPos` seats have no
`CVMExternTrace` camera: `Ratte_`, `M8HMC_Rand`, the Bluebell and Celandine
back guns, `3,9inchType98`(`wRadar`), four Kii and Owari 100 mm seats, and the
Tsurumi 3-inch guns. They can never take the view (section 3).

**The screenshot's seat** is FHSW's `Cromwell_Director_PCO`, the commander. It
has `Common_DirectorPCO_Camera` and `Land_Spotter`, with
`setPrimaryAmmoIcon "Ammo/icon_spotter.tga"` and `ABIconOnly`. The "Artillery
Spotting" panel is that weapon icon, not a special HUD. `Land_Spotter` is a
vehicle `FireArms`: `magType 2`, `fireInCameraDof 1`, `magSize 1`,
`reloadtime 120`, and a projectile `Land_Spotter_Projectile` with TTL
**180 s**. So the commander can re-mark only every two minutes, while a
vanilla scout can re-mark at any time (`magSize -1`, no reload).

### Desert Combat and DC Final (survey 2026-10-10)

Counted the same way from each mod's `objects.rfa` chain
(`extract_vehicle_spotting.py --list`, and a walk of every
PlayerControlObject for a `magType 2` FireArms below it). Recorded as
SPOT-17.

| Mod | `magType 2` weapons | `artPos 1` seats | of them with no `CVMExternTrace` camera | of them with a weapon on `c_PIAltFire` |
|---|---|---|---|---|
| bf1942, XPack1 | 1: `Binoculars` | 11 | 0 | 0 |
| XPack2 | 1 | 13 | 0 | 0 |
| DesertCombat | 3 | 18 | 0 | 0 |
| DC_Final | 3 | 20 | 0 | 0 |

**The weapons.** Desert Combat adds two vehicle FireArms in
`Objects/Stationary_weapons/CallArtillary/objects.con`: `CallArtillary` (on
`c_PIFire`) and `AltCallArtillary` (`setInputFire c_PIAltFire`,
`altFireOnce 1`). Both are `magType 2`, `magSize -1`, `fireOnce 1`,
`fireInCameraDof 1`, `projectileTemplate BinocularsProjectile`, vanilla's
120 s marker. With no reload and an unlimited magazine, a seat can re-mark
as often as a vanilla scout.

**Who carries them in DC Final** (18 seats): `AltCallArtillary` on the
pilots of `OH-6`, `MH-6`, `MD-500`, `SA-342L` / `M` / `S` and `AC-130`, and
on `DPVMK19_PCO2`; `CallArtillary` on `H6CoPilot` (the co-pilot seat in the `H6Common`
bundle the H-6 hulls share), `SA342CoPilot`, `UH-60_Passenger`, `UH-60Q`,
`HumveePassengerPCO` and its `_minigun` / `_MK19` / `_Tow` variants,
`BRDM2PassengerPCO` and `PickupPassengerPCO`. DesertCombat 0.7 has 19: the
same less the two newer Humvees and the Pickup, plus `MH-500`, `SA-342G`,
`DPVM2_PCO1`, `Humvee50Cal_PCO1` and `TechnicalMGPCO`.

**Who can look** in DC Final (20 seats): vanilla's eleven, and
`BM21_PCO1`, `M-109_Gunner_PCO1`, `M-1974_Gunner_PCO1`, `MLRSRockets`,
`SCUD-B_PCO1`, `Mortar`, `Howitzer_155`, `Howitzer_155_Battery` and
`Fletcher_FrontCannon_PCO`. DesertCombat 0.7 has the same less the two
howitzers. Every one has a `CVMExternTrace 1` camera.

**Alt-fire is never asked to do two things.** `AltCallArtillary` fires on
the button that toggles the view (SPOT-8), but the toggle only exists in an
`artPos` seat. No seat that carries `AltCallArtillary` is an `artPos` seat,
and no `artPos` seat has any weapon on `c_PIAltFire`. A pilot's alt-fire
marks; a gunner's looks.

XPack2's count here is 13 against section 9's 2 because this one walks the
mod chain, which includes vanilla's eleven.

## 10. What the viewer had before the build (2026-09-30)

Superseded by "Built in the viewer" at the top. Still true:

- The Binoculars zoom and draw their ring (SCOPE-3, SCOPE-5).
- The replay carries `BinocularsProjectile` as a networked object
  (`viewer/replay-props.js` `NETWORKED_ROUNDS`). A recording therefore holds
  each marker's matrix and life, enough to draw what was spotted and to offer
  the scout view in a replay. Not built.

## 11. What a build needs

Written before the build. Steps 1 to 4 are built, and of step 5 the icon,
the gunners' line, the wedges, the fade, the scout line and the binocular
overlay ("Built in the viewer", top).

In the order a player would meet it:

1. **Extraction.** Emit `artPos` per seat and `CVMExternTrace` per camera
   (already emitted). Emit `magType` and the projectile's `damageType` and
   `timeToLive` for marker weapons (mostly there). Emit the `DirBar*` scales
   for the HUD.
2. **Placing.** When a `magType 2` weapon fires, raycast the terrain and
   objects from the camera up to 10 km, destroy the weapon's previous marker,
   and create the marker with the lookAt matrix (eye + 30 m up, at the hit
   point, world up). It lives `timeToLive`. It goes on a game-wide list tagged
   with its owner and team. The spotter's side plays team radio 59. Vanilla
   bots never place markers (section 8).
3. **Selecting.** In an `artPos` seat whose camera allows mode 17, with at
   least one teammate's marker: alt-fire toggles on the press edge, and
   next/previous item step along the list as section 4 describes, with its
   quirks, taking over those keys only while such a marker exists.
4. **The view.** Fixed eye at the marker. The look-at point eases 10% per frame
   toward the seat's last shell, else toward eye + 20 × forward. Restore the
   saved view mode and field of view on exit. Exit when the marker dies.
5. **The HUD.** Section 7: the gunner's blinking scout icon and chat line, the
   minimap wedges, and in the view the fade, the "Scout: <name>" countdown,
   the binocular overlay, the two direction bars with their last-shot ghosts,
   and the bearing dial. The viewer's `hud.js` already paints `menu/InGame`,
   so most of this is feeding the variables. Check `meme.py`'s
   `RotateAroundCoordinateEffect` order first (section 7).

## 12. Open

Not built in the viewer:

- **The traverse and elevation bars and the bearing dial** (section 7). The
  table carries each seat's `DirBar*` words for them. The dial waits on the
  pivot question below.
- **The scope picture** `CrossHair/ScopeIndex` switches on in the view:
  which icon it holds was not traced.
- **Markers over the network and in a replay.** A marker is the page's own:
  a room's other players do not see it, and a recording's
  `BinocularsProjectile` is not listed.
- **Bots and Desert Combat's alt-fire spotter.** Vanilla bots have no marker
  weapon to pull (SPOT-14). In Desert Combat a pilot's `AltCallArtillary`
  listens on `c_PIAltFire` beside whatever else the hull fires on that
  button, and a bot that holds the button for another weapon pulls it too.
  The viewer then places a marker from the weapon's own frame (a bot has no
  camera here), owned by the bot. Whether retail's bots do the same was not
  read, and it was not seen in a run.
- **`ReqScoutCameraEvent`** and the server's copy of the view (SPOT-10).
- The choices listed under "What the build decided where the record is
  silent" each stand until the binary is read for them.
- The gunner's `c_PIFire` latch for the bars' "old" ghosts.

Not read:

- Which input or code fires the Binoculars' `projectile2Template`, and what it
  is for.
- What the server-side copy of a gunner's scout view is used for (section 4).
- What sets `Camera +0x258` on the client (section 6).
- Whether a stale selection survives leaving the seat and matters on the next
  entry (section 6).
- Whether an unmoving marker receives delta updates, each of which re-lists it
  and drops a gunner's view (section 2).
- The client's `fireBarrel` twin: that it also sets the trace id.
- HUD (section 7): whether the "old" latch follows a held fire button or only
  its press; which picture `CrossHair/ScopeIcon` holds in the scout view; the
  fade timings; whether retail's bearing dial really pivots on the screen's
  corner. A capture from the lab would settle the last three.
- The cadence of the 10% easing (per frame or per tick).
- Whether `c_NIGhostAlways` really sends the marker to every client whatever
  its distance.
- FHSW bots (section 8): whether `choseWeapon` ever prefers `BinocularAI` over
  the kit's other weapons; what target the type-14 driver's plan uses while
  its gun seat is empty; and which condition list feeds which plan branch.
  FHSW's `Artillery_Spotter` names the AI template `Jagd_BinocularAI`, which
  has no matching `weaponTemplate` in its `objects.rfa`.
- `getSAIUpdateFrequency`'s default and the `TTN*Artillery` temperature-tree
  nodes' role (AI-38; the tree is empty in vanilla data, SPOT-14).

## Evidence index

| Address | What |
|---|---|
| `0x0828a090` | `FireArms::Fire`: `magType` (`+0x230`) == 2 → `placeScoutCamera` |
| `0x082c9440` | `ConsoleClass289`: `magType` → template `+0x230` |
| `0x0828dde0` | `FireArms::placeScoutCamera`: server only, one per weapon, ray, lookAt, list |
| `0x086c04a8`, `0x086b01b4` | the constants 10000.0 and 30.0 |
| `0x08159b80` | `calcLookAtMatrix(m, from, to, up)` |
| `0x0828cdc0` | `FireArms::getFireArmsTransformation` (the camera when `fireInCameraDof`) |
| `0x0805e740` / `0x0805e7a0` / `0x080617d0` | `Game::placeScoutCamera` / `removeScoutCamera` / `getScoutCameraList` (`Game +0x5c`); Game vt+0x88 / +0x8c / +0x90 |
| `0x0805f940`, client `0x0040c490` | `Game::checkIfLocalPlayersArtCameraIsRemoved` |
| `0x082dc1e0` | `ConsoleClass377`: `damageType` → projectile template `+0x160` |
| `0x08232be0` (`0x08232f95`) | `ProjectileNetworkable::setNetUpdate`: a new `damageType 3` ghost is listed |
| `0x0831e610`, `0x0831e720` | `Projectile::destroy` / `resetProjectile`: `damageType 3` is unlisted |
| `0x08318c10` | `PlayerControlObject::getArtPos` = template `+0x1f0` |
| `0x081b3fdd` | `CVMExternTrace` → CameraTemplate `+0x1c0` (`ConsoleClass228`) |
| `0x081ac7c0` | `Camera::setViewMode`, case `0x11` |
| `0x081aaf90` | `Camera::getTransformation`, mode 17 |
| `0x0828aba0` | `FireArms::fireBarrel`: `setTraceObjectId(shell)` on every camera of the PCO |
| `0x081ada00` / `0x081ada50` | `Camera::setTraceObjectId` (`+0x254`) / `setExternCameraTrans` (`+0x210`) |
| `0x08158e10`, client `0x004acf70` / `0x004b8af0` | `GameServer::toggleScoutCamera(unsigned)` (Game vt+0x9c); the pure client's sends the event |
| `0x08158aa0`, client `0x004ace10` | the server's `ReqScoutCameraEvent` handler; `case 0x26` at `0x08136a3d` |
| `0x0811fd10` / `0x0811fd60`, client `0x004a3c10` | `ReqScoutCameraEvent` (de)serialise: u8 player, u16 marker |
| `0x00448520` | client input dispatcher: `c_PIAltFire` `0x17`, `c_PINextItem` `0x2e`, `c_PIPrevItem` `0x2f` |
| `0x005561d0` | client player-input name switch (the channel numbers) |
| `0x006a65b0` | client: may this seat use markers (`artPos` + a teammate's marker) |
| `0x006a66b0` | client selector: pick, HUD line, toggle, drop on expiry |
| `0x006a6a60` / `0x006a6a80` / `0x006a6b80` | client toggle / next / previous |
| `0x00541ed0` | client: a marker's remaining life |
