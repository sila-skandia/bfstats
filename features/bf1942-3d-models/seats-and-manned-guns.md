# Seats and manned guns: entering, switching and leaving anything with a door

The user's ask: "entering and exiting any vehicle that can be spawned in to,
e.g. a defgun can be entered and fired, it has its own HUD when inside, same
as a sherman." Before this round the viewer only classified `c_ETPlane`/
`c_ETCar` roots as enterable — everything else with an `EntryPoint` (a Defgun,
the AA guns, the Brownings, a tank, a ship's own hull) was level furniture.

## The shape: one occupancy, any kind

`viewer/seats.js`'s `surveyVehicle(root)` buckets every descendant of one
`PlayerControlObject` root by the extraction-time `control`/`seat.control`
tag `bf42/con.py`'s `rig()` already stamps onto it — the nearest enclosing
PCO's own name. That is strictly more correct than the old runtime stack-walk
`classifyVehicle` used to do itself: the extractor has already resolved PCO
nesting once, so a hull gunner's RotationalBundle is never attributed to the
driver's seat and vice versa, with no walk to get wrong at render time.

`classifySeat(seat, isRoot)` is GUN-10's own definition (verify-r6.md): an
Engine wins at the root (`air`/`ground`/`tank`); short of that, a
RotationalBundle with real motion (`maxSpeed>0`) *and* a FireArms is a manned
`gun`; anything else that reaches an EntryPoint is a bare `seat` — a
passenger position, or a hull this round has no drive model for (a ship's own
root falls through to `seat` exactly like a true passenger, which is the
honest answer for "no propulsion model," not a special case).

`VehicleOccupancy` ties one root's seat table to a lazily-built drivetrain —
`Aircraft`/`GroundVehicle`/`TrackedVehicle`, same constructor and interface,
so `air`/`ground`/`tank` still populate `map.html`'s existing `aircraft`/`car`
module variables exactly as before — and tracks which seat is active. Two
things follow from that:

- **A bare gun/seat root (Defgun, AA_Allies, Stationary_Browning) has no
  drivetrain at all.** `aircraft`/`car` stay null; the whole seat runs on
  `occupancy` alone.
- **A vehicle with a drivetrain can *also* have manned nested seats** (the
  Sherman: `c_ETTank` root + `shermanBrowning_PCO1` hull gunner). Switching to
  the gunner seat does not tear the tank down — `occupancy.activeSeatId`
  simply moves, and `mannedActive()` (`!(occupancy.isActiveRoot() &&
  (aircraft || car))`) tells `frame()`'s dispatch to run `manned()` instead of
  `drive()`/`pilot()` for exactly as long as a non-root seat is active.

`findAllVehicleRoots`/`listEntryPoints` replace the old `classifyVehicle`-gated,
spawner-scoped entry-point scan: every `PlayerControlObject` root in the
scene, spawner-placed or not, tagged with which of its seats each `EntryPoint`
opens into. This is the whole of "make every PlayerControlObject with an
EntryPoint enterable" — Wake's Defgun, AA_Allies, Stationary_Browning and the
Sherman's hull-gunner door were all unreachable before this, confirmed via
`findAllVehicleRoots`/`listEntryPoints`'s own headless dump (below).

## Entering, switching, leaving

- **Enter**: `E` while on foot and near a door (`collectEntryPoints`/
  `nearestEntry`, unchanged proximity rule — SEAT-11's exclusion of your own
  current vehicle needs no extra code, since the scan never runs while
  already seated). `setPilot(true, vehicle, seatId)` builds one
  `VehicleOccupancy`, a drivetrain if the root has one, and activates
  whichever seat's door you actually walked up to — direct entry into a
  nested seat (the hull gunner) works without ever sitting in the root first.
- **Switch**: the number row, `c_PIMenuSelect1..9` → seat position 0..8
  (SEAT-23/24, verify-r5.md), looked up in `VehicleOccupancy.seatIdAt` —
  declaration order, root always position 0 (Sherman: driver = key 1,
  `shermanBrowning_PCO1` = key 2, matching SEAT-24's own `setSelectKey`
  reading exactly). `switchSeat()` rebuilds only the active seat's own
  FireArms group (`collectMannedGuns`) and re-feeds the HUD.
- **Leave**: `E` again. `mannedActive()` picks `exitManned()` (a bare gun/seat,
  or any nested seat) vs the existing `exitVehicle()` (the drivetrain's own
  root seat). Either way there is exactly one occupant on this page, so
  leaving from *any* seat empties the whole vehicle — `leaveManned()`
  delegates to `leaveVehicle()` when a drivetrain also exists, rather than
  leaving a driverless tank "occupied" by a gunner who just climbed out.

## Aiming: GUN-3's two registers, and where this stops short of them

`TurretAxis.step` (`seats.js`) ships the parts of GUN-3 (verify-r6.md's
corrected report) the verifier fully confirmed: degrees straight off the
`.con`, the ±180° wrap when an axis is unlimited (`min==max`), a direct clamp
otherwise, no spring-to-centre. The verifier's real mechanism is two
per-axis accumulators — an input register clamped to a hardcoded ±40 and
deadzoned against ±1.0, and an `|acceleration|·dt` register — whose *product*
drives the angle, plus an `automaticReset`-dependent step the verifier
explicitly could not close out ("the exact per-tick algebra... is still not
nailed down"). Two gaps stand between that and this viewer:

1. `bf42/con.py`'s `rig()` (another track's file this round, off limits)
   exports each axis's acceleration only as a *sign*, never a magnitude — the
   real per-axis ramp rate the confirmed formula needs is not in this
   viewer's extracted data at all, independent of the algebra question.
2. Even given that magnitude, the closed form itself is unsettled.

The corrected report's own recipe names the way through both: approximate
with a tunable ease rather than ship the wrong formula. `TurretAxis` chases an
input-scaled target velocity at a fixed fraction of the axis's own real
`maxSpeed` per second (`TURRET_RAMP_TIME`, `TURRET_SENSITIVITY` — both named
as tuned-to-feel-right, not measured, in `seats.js`'s own comments). The
deadzone's asymmetric `<-1.0` branch the verifier flagged as unexplained is
not reproduced either (a plain zero for both signs is used).

**Open**: both gaps above are the verifier's own open items, not this
viewer's invention — closing either needs a further disassembly pass this
round did not do, named exactly in `verify-r6.md`'s own `## Open` section.

## Camera and firing

The gunner's eye is always the seat's own Camera node's live world pose
(`readWorldPose`), read after the turret steps — GUN-5/6 confirm a gunner
Camera never aims itself, it only rides the RotationalBundle chain it is
parented under, so there is no cockpit/orbit/fly-by mode to speak of, unlike
`VehicleCamera`'s four for a plane or car.

Firing goes through the existing `gunfire.js`, scoped per seat (`mannedGuns`,
rebuilt on every seat switch) rather than the whole vehicle at once — sharing
one array with `drive()`/`pilot()`'s own `vehicleGuns` would have the
driver's Space bar also fire an unmanned hull MG nobody is sitting in, since
neither loop gates on which seat is active. `FireState` (`seats.js`)
reproduces GUN-12's confirmed gate order (eject → reload → overheat →
**rate-of-fire**, ahead of the ammo check — the verifier's own addition to the
prior pass) and `getHasHeat`'s corrected strict-**greater**-than test.
Firing itself uses **Space**, not the on-foot LMB: this page already binds
vehicle fire to Space for both the aircraft and the car, and reaching for the
on-foot mousedown state machine (`triggerHeld`/`clickQueued`) instead would
mean editing code scoped to the hand weapon.

**Approximation, not open**: `drive()`/`pilot()`'s WASD/Space input reading is
outside this track's ownership and unconditional — it does not know how to
gate itself on which seat is active. Because `frame()`'s dispatch is
exclusive (`manned()` *or* `drive()`, never both the same frame), a vehicle's
own physics integration simply pauses for as long as a non-root seat is
active, rather than continuing under momentum with WASD ignored. A stationary
gun mount is unaffected; a moving vehicle whose driver switches to a gun seat
mid-drive will freeze in place rather than coast. Fixing this needs a change
inside `drive()`/`pilot()` (gating their own input read on
`occupancy.isActiveRoot()`), which is outside this track's file ownership —
flagged here rather than made.

## HUD variables fed (BRIEFING2.md's contract)

`feedVehicleHud()` writes into `window.__hud.vars` (P1's painter, a parallel
track not yet merged into this worktree — every write is a plain assignment
behind `window.__hud?.vars`, a documented no-op until it exists) whenever a
seat is entered, switched, or — every tick — while `manned()` is running:

    Vehicle/ShowVehicleIcon        true whenever any seat is occupied
    Vehicle/VehicleIcon            active seat's own `vehicleIcon` (R2-31: icon is per seat)
    Vehicle/VehicleHitPoints       root PCO's own `hitpoints` (R2-31, corrected: shared, not per seat)
    Vehicle/VehicleMaxHitPoints    root PCO's own `maxHitpoints`
    Ammo/PrimaryAmmoIcon/Bar       active seat's own values (`ammoBarCode` decodes R2-8's 8-way enum)
    Ammo/SecondaryAmmoIcon/Bar     ditto, when the seat declares one
    Ammo/PrimaryAmmo/MaxPrimaryAmmo/PrimaryMag, Overheat/OverHeat
                                   only while `manned()` is stepping a `FireState` for this
                                   seat's own FireArms — an aircraft/car's FireArms have no
                                   `FireState` here (see "Firing", above): building one just
                                   for this read would decrement on every shot via the global
                                   `chainOnShot` hook without anything ever stepping it back,
                                   an orphaned, silently-wrong counter rather than an absent one

Cleared (`delete`d, not set false/0) on any full exit, so the painter's own
"unknown stays absent, cull the group" rule sees an honest table.

## Verifying this

Headless, `map.html?mod=bf1942&map=wake&shots`, Playwright chromium under
SwiftShader, following BRIEFING2's own recipe. `window.__occupancy` (a getter,
added alongside the page's existing `__aircraft`/`__car`/`__getFire` test
hooks) reports the active seat, its turret's own angles, and its FireArms'
live ammo/heat/reload state; `window.__nearEntry`/`__switchSeat` are the
seat-table equivalents of `__deploy`. Exercised: Defgun and AA_Allies (bare
gun roots, no drivetrain), Stationary_Browning (a 1.1 m entry radius, the
tightest on the map), and the Sherman (tank root, seat-switch to
`shermanBrowning_PCO1` and back, firing scoped to whichever is active). See
this track's final report for the exact runs and pixel evidence captured.
