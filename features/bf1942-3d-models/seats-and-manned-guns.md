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

**A nested PCO buckets by that `control` tag, not by its own node name** — a
review pass this round found `surveyVehicle` originally keyed a nested PCO's
own seat by `obj.name` instead, and on Wake (two Shermans) that is not the
same string: the export gives every node under the second-and-later instance
of a vehicle a scene-wide disambiguating suffix, so one Sherman's own
`shermanBrowning_PCO1` node is named `shermanBrowning_PCO1_1` while every one
of *its own descendants* still reports the bare `shermanBrowning_PCO1` as
`control` — confirmed headless against the live scene, not a hypothetical.
Keying by the node name split that one seat into two: an empty bucket holding
only `.node` (nothing else ever resolved to the suffixed name) and a fully
populated one holding the entryPoints/axes/fireArms/camera but no `.node` —
`classifySeat` read the empty half as a bare `seat`, not a `gun`, and `order`
gained a phantom entry, shifting the real gunner from seat position 1 to 2 and
leaving position 1 (key "2", SEAT-24's own driver-then-gunner reading) an
unfireable dead seat. Fixed by bucketing a PCO the same way its own
descendants already do; `test_a_nested_pco_buckets_by_control_tag_not_by_its_
own_node_name` (`test_seats.py`) reproduces the exact shape and pins the fix.

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
  **Fixed in round 3**: `nearestEntry` picks among candidates with
  `seats.js`'s new `pickNearest`, not a bare `distance < best` compare — the
  Sherman declares a separate `EntryPoint` for the driver and the hull gunner
  at each of its two doors, and both compose to the *same* world position
  (confirmed against the live Wake scene: ~1.1457e-13 m apart, double-
  precision noise, not real data — M3A1's four passenger seats go one further
  and tie at exactly 0 m). A plain compare let whichever candidate's own
  transform chain happened to round a hair smaller win the door, effectively
  at random; `pickNearest` only lets a candidate more than `TIE_EPSILON`
  (1e-6 m — far above the measured noise, far below any real gap between two
  distinct doors) closer displace the incumbent, so the first one reached in
  `surveyVehicle`'s own declaration order — SEAT-22, root seat first — wins
  every time. At a shared Sherman door that seats the driver, matching where
  the number keys already put position 0.
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
  `exitVehicle()` no longer gates an aircraft's exit on `grounded`/airspeed —
  a review pass found that predates this round and directly contradicts
  SEAT-5/SEAT-8 (confirmed twice: `isAllowedToExit()` is pure geometry, no
  speed/altitude check exists in vanilla); removed, `soldier.spawn()`'s own
  fall-to-floor already lands an exit point left in mid-air.
- **Cooldown**: E is `c_PIUse` (SEAT-2 — the report's own correction: no
  distinctly-named "enter/exit" enum value exists), gated by SEAT-6's
  hard-coded 1.0s per-player cooldown (`SEAT_TOGGLE_COOLDOWN_MS`), refreshed
  only on an actual enter/switch/exit — a press that finds no door and no
  seat to leave costs nothing, matching `toggleEntryPoint`'s own
  success-path-only refresh.

## Aiming: the engine's velocity servo (GUN-2)

> **Superseded, 2026-09-19.** This section used to describe GUN-3's "two
> per-axis accumulators whose *product* drives the angle", a ±40 bank of aim
> and a ±1.0 deadzone. All of that was a misreading of one function, and the
> 2026-09-19 round read that function end to end. What it actually is, and
> what changed in the viewer, is in
> [2026-09-19: the servo, the dial and the dots](#2026-09-19-the-servo-the-dial-and-the-dots)
> below. The paragraphs immediately after this one are kept only because the
> two 2026-09-17 sections argue against them.

`TurretAxis.step` (`seats.js`) is `RotationalBundle::calculateAndClipAngle`
(lnxded `0x081d7490`), whose 361 instructions were traced in full and then
re-traced independently:

```
speed  ->  sign(acceleration) * input * maxSpeed,  ramped at |acceleration| deg/s^2
angle  +=  speed * dt  +  continousRotationSpeed * dt
then:  minRotation == 0 && maxRotation == 0  ->  one +-360 correction
       otherwise  angle > max -> max,  else  angle < min -> min
```

Degrees throughout, two registers that persist between ticks, and
`automaticReset` a different law entirely. The one number that is still this
viewer's own is what a pointer-lock pixel is worth as `input` — GUN-2b.

## Camera and firing

The gunner's eye is always the seat's own Camera node's live world pose
(`readWorldPose`), read after the turret steps — GUN-5/6 confirm a gunner
Camera never aims itself, it only rides the RotationalBundle chain it is
parented under, so there is no cockpit/orbit/fly-by mode to speak of, unlike
`VehicleCamera`'s four for a plane or car. Its FOV is `frame()`'s own
`MANNED_GUN_FOV` (57.3°, GUN-6's confirmed render-view default — no vanilla
vehicle calls `setVehicleFov`), corrected every frame `manned()` is the active
dispatch rather than once on entry: a review pass found `enterVehicle` set
`camera.fov` to the free-fly default (60°) for every kind alike, and neither
`pilot()`/`drive()`/`VehicleCamera` (outside this track) ever touch `fov` at
all, so a manned gun kept whatever FOV the *previous* mode left behind,
wrong the moment you first entered one and never fixed by switching seats.

**Not simulated**: SEAT-13/13b's team/hostility gates on which door you can
even use — this page has one soldier and no second team's vehicle for either
gate to reject, so there is nothing to exercise it against (noted in
`nearestEntry`'s own comment, not previously documented anywhere).

Firing goes through the existing `gunfire.js`, scoped per seat (`mannedGuns`,
rebuilt on every seat switch) rather than the whole vehicle at once — sharing
one array with `drive()`/`pilot()`'s own `vehicleGuns` would have the
driver's Space bar also fire an unmanned hull MG nobody is sitting in, since
neither loop gates on which seat is active. **Keeping the two arrays separate
was necessary but, until a round-3 review pass, not sufficient**:
`collectGuns()` built `vehicleGuns` from `guns.collect(vehicle.node, ...)` —
the whole vehicle subtree, root plus every nested seat — so it independently
picked up the hull `Browning` too, and `drive()`'s own firing loop matches by
`stats.input` alone, which the hull MG shares with the cannon
(`c_PIFire`). Reproduced headless: holding Space while driving the Sherman
fired the hull gun for real (shots incrementing, ammo draining) with nobody
in that seat. Fixed by dropping anything from the broad collect that is not
the root seat's own FireArms (`occupancy.seatInfo(occupancy.rootId).fireArms`)
before it becomes `vehicleGuns`, releasing it from `guns.groups` the same way
`releaseGuns()` already does — a nested seat's own gun still gets its real,
firing-capable group from `collectMannedGuns()` once someone actually sits in
that seat. `FireState` (`seats.js`)
reproduces GUN-12's confirmed gate order (eject → reload → overheat →
**rate-of-fire**, ahead of the ammo check — the verifier's own addition to the
prior pass) and `getHasHeat`'s corrected strict-**greater**-than test.
Firing itself uses **Space**, not the on-foot LMB: this page already binds
vehicle fire to Space for both the aircraft and the car, and reaching for the
on-foot mousedown state machine (`triggerHeld`/`clickQueued`) instead would
mean editing code scoped to the hand weapon.

**Fixed in round 3** (this section originally flagged it as an approximation
outside the prior round's file ownership): `frame()`'s dispatch is no longer
exclusive between `manned()` and `drive()`/`pilot()`. It now calls
`pilot()`/`drive()` unconditionally whenever `occupancy` exists — each gated
*internally* on `occupancy.isActiveRoot()` — so `car`/`aircraft.integrate(dt)`
steps every frame the vehicle exists, no matter which seat is active, while
reading fresh WASD/Space input, firing the seat's own `vehicleGuns` and
moving the camera stay exclusive to the frames the driver's own root seat
really is the one occupied. A moving Sherman whose driver switches to the
hull gunner now keeps coasting on its last throttle/steering — proven
headless (T2's final report): 0.5 s of throttle build a real ~11 m baseline,
then two full seconds *while the gunner seat was active* moved the hull a
further ~40 m each, with before/after screenshots showing the background
scenery having visibly scrolled past. `vehicleGuns`' own firing loop is kept
unconditional too, but the *value* passed to `setFiring` is now
`isActiveRoot() && ...` rather than the call itself being skipped — a
vehicle's weapon now actually stops the instant its own seat is vacated
(mid-fire and switch seats: previously it would have stayed latched firing,
since nothing ran `setFiring(false)` again until the driver's seat became
active once more), rather than only while `drive()`/`pilot()` happened to be
the mode running. `mannedGuns`' own `platformVelocity` (previously hard-coded
`null`, correct only because the vehicle used to be provably frozen while
nested) now reads the live `(aircraft||car)?.state.velocity` exactly like
`vehicleGuns`' copy, so a hull machine gun fired from a coasting tank
inherits the hull's motion the same way its cannon already did.

## HUD variables fed (BRIEFING2.md's contract)

`feedVehicleHud()` writes into `window.__hud.vars` (P1's painter, merged since
this doc was first written — every write is still a plain assignment behind
`window.__hud?.vars`, now a live one rather than a no-op) whenever a seat is
entered or switched, and once every frame from `frame()` itself, **after**
`guns.advance(dt)` rather than from inside `manned()` (round 3's own fix: a
call from the tail of `manned()` ran *before* `advance()` had fired that
frame's rounds, so a shot landing on frame N showed its old ammo/heat until
frame N+1 — one frame late but real, and exactly the kind of thing "the HUD
numbers following" a held trigger has to get right. `manned()`'s own body
notes why it no longer calls this itself.):

    Vehicle/ShowVehicleIcon        true whenever any seat is occupied
    Vehicle/VehicleIcon            active seat's own `vehicleIcon` (R2-31: icon is per seat)
    Vehicle/VehicleHitPoints       root PCO's own `hitpoints` (R2-31, corrected: shared, not per seat)
    Vehicle/VehicleMaxHitPoints    root PCO's own `maxHitpoints`
    Ammo/PrimaryAmmoIcon/Bar       active seat's own values (`ammoBarCode` decodes R2-8's 8-way enum)
    Ammo/SecondaryAmmoIcon/Bar     ditto, when the seat declares one
    Ammo/PrimaryAmmo/MaxPrimaryAmmo/PrimaryMag, Ammo/SecondaryAmmo/MaxSecondaryAmmo,
    Ammo/ReloadTime/ReloadTimeSecondary, Overheat/OverHeat
                                   only while `manned()` is stepping a `FireState` for this
                                   seat's own FireArms — an aircraft/car's FireArms have no
                                   `FireState` here (see "Firing", above): building one just
                                   for this read would decrement on every shot via the global
                                   `chainOnShot` hook without anything ever stepping it back,
                                   an orphaned, silently-wrong counter rather than an absent one.
                                   `nodes[0]`/`[1]` (the seat's own FireArms declaration order)
                                   stand in for primary/secondary — the Sherman's root is the
                                   real vanilla case with two (R2-30: cannon then coax), and its
                                   heat weapon is the *secondary* one, which is why `Overheat/
                                   OverHeat` (one shared variable, confirmed against
                                   `hud-layout.json`, not per-slot) is fed from whichever of the
                                   two actually has heat rather than always `nodes[0]`.
                                   `Ammo/ReloadTime[Secondary]` is fed as `reloadRemaining /
                                   reloadTime` against the layout's own `max: 1.0` — the fill
                                   *direction* (counts down vs. counts up to full) is not in
                                   verify-r2.md/verify-r6.md or the layout's metadata, so this
                                   is an approximation, not a confirmed reading

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

## 2026-09-17: a tank's driver aims his own gun

Follow-on from the Sherman round (`ground-vehicles.md`, `in-game-hud.md`). A
tank in the viewer drove with its gun welded forward: the mouse swung the
camera and the turret never moved. Everything needed was already in the
extracted data — `Sherman.glb` declares `ShermanTower` as a *free*
`c_PIMouseLookX` traverse at 35 deg/s and `ShermanGunBase` as a
`c_PIMouseLookY` elevation over −20..+5 at 20 deg/s, both under the tank's own
control, with the driver's `ShermanCamera` parented under the gun base exactly
as retail has it. Five things were in the way.

**`setActiveSeat` asked the wrong question.** It built a `TurretRig` when
`classifySeat` returned `'gun'` — and an Engine at the root is precisely what
takes that classification away (GUN-10: "an Engine wins at the root"). So a
drivetrain seat never got one, `applyRig` re-posed both bundles from a surface
table nothing writes `c_PIMouseLookX/Y` into, and the turret was pinned
forward every frame. It now asks `hasAimAxes(seat)` — is this seat *wired* to
something the mouse reaches — which is the question the rig itself answers.

**`TurretRig` claimed axes it never drives.** It took every axis on the seat
and then fed only the mouse-look pair, which pinned the rest to their rest
pose instead of leaving them to `applyRig`. Harmless while only manned guns
had rigs (the six mixed seats in the corpus all pair mouse-look with a
`c_PIFire` barrel-spin axis nothing feeds either way) but not once a driving
seat can have one: the V-100's carries a turret *and* a steered front axle.

**`surveyVehicle` gave the slot to the wrong bundle.** It keeps one bundle per
axis *name*, first-wins — and the V-100 traverses `V-100FrontWheelR`,
`V-100FrontWheelL`, then `V-100Turret`, so the wheel took `yaw` and the turret
was unreachable. Thirteen vehicles across vanilla and the mods have this
shape (M3GMC's turret against its steering; the M113 family's and the LVT4's
`pitch` against a gun-hatch or ramp animation). An axis the mouse reaches now
takes the slot from one it does not; the losing bundle keeps being posed by
`applyRig`, which is the only thing that ever posed it.

**Every manned gun in the viewer was inverted.** `lookDelta` passed
`(-dx, -dy)` to `aim`, borrowed from the soldier's own `look()` whose yaw
counts the other way, and that negation landed on top of `RIG_SIGN`'s own flip
inside `_apply`. The two together meant the mouse pushed right swung a gun
left and pushed down raised it. Measured on the Sherman's hull Browning as
well as its main gun, so this was never tank-specific — it had simply never
been driven far enough to notice. `aim` now documents that it takes the
browser's screen sense directly.

**A sensitivity constant was tuned twice and neither value helped**, which is
what eventually pointed at the model rather than the numbers — see the rate
section below. `test_seats.py`'s deadzone fixture is now written in degrees of
ask and converted, so it stops failing every time a feel constant moves for a
reason that has nothing to do with the deadzone it is about.

**A turret now stays where it was left.** Rigs are cached per seat on the
occupancy rather than rebuilt on every `setActiveSeat`, and `applyTurrets()`
re-asserts *all* of them right after the drivetrain's `integrate` — because
`integrate` ends in `applyRig`, which would otherwise snap every unmanned
seat's gun to rest. Climb from a Sherman's driving seat to its hull gun and
back and the tower is still pointed where you left it.

The camera needed nothing: `ShermanCamera` hangs off the gun base, so it
follows the traverse and the elevation for free, which is how retail gets it
too.

### What it does now

- Mouse right traverses right, mouse up elevates; 35 deg/s saturated, its own
  declared rate.
- The gun base honours its own −20..+5, i.e. 20 degrees of elevation and 5 of
  depression.
- Shells leave the muzzle wherever the turret is pointed (the muzzle's world
  position tracks the traverse).
- The HUD's turret dial draws for the first time — see `in-game-hud.md`.

### Follow-up the same day: rate, and the two triggers

Reported back from play: "it rotates much slower than in-game, and it isn't
firing: left click is the tank shell, right is the machine gun."

**The coaxial machine gun had no input at all.** `Sherman.con` gives the
cannon `c_PIFire` and `Coaxial_browning` `c_PIAltFire`, and this page's only
vehicle trigger was Space, wired to `c_PIFire`. So the coax was collected, had
a `FireState`, drew its own ammo panel and heat bar — and could never be
fired, from any seat, because nothing ever wrote the input it declares. The
mouse buttons now drive both: left is `c_PIFire`, right is `c_PIAltFire`,
through the same chord machine the soldier's own buttons already use
(`footButtonChange`, now `buttonChange`, which handles a second button
pressed while the first is held — the browser reports that as a `pointermove`
carrying the changed button, not a `pointerdown`). `manned()` routes per
weapon rather than per seat, off each FireArms node's own declared input, for
the same reason a driver's does. Space still works and still means
`c_PIFire`. A Corsair gets the pair for free: its guns declare the first and
its bombs the second.

**The traverse was slow because the mouse was asking for a rate, not an
angle.** Two rounds of tuning constants did not fix it, and could not have:
the model was wrong. `TurretAxis` drained its input sample to zero on every
`step`, so the only thing it could ever know was "how fast is the hand moving
*right now*" — everything a fast frame asked for above the clamp was
discarded, and the whole of a flick vanished the instant the hand stopped.

`manned-guns.md` §3 states the correction outright and it had been read past:
the input register at `+0x128` **accumulates**. So `feed` now banks degrees of
ask and `step` spends them as fast as the axis allows, taking what it spends
off the bank. The scale is `map.html`'s own `LOOK_SENS` in degrees — a
gunner's hand asks a turret for the same travel it asks a soldier's head for,
and the turret's own rate is then the only thing that makes one heavier than
the other. The bank is clamped (`TURRET_PENDING_CLAMP`, **40 degrees** since this
round — down from 90), which is GUN-3's own hard-clamped input register (±40)
in this file's units: it bounds a flick rather than letting one keep the turret
swinging for seconds. A pending bank still sitting idle for three frames (about
50 ms at 60 Hz — too short to notice on an active sweep) decays at
`TURRET_IDLE_DECAY` (12/s), so the axis settles to a stop instead of coasting
the bank's full remainder at full rate after the hand has lifted — the
"overshoot" complaint, matched to the game's own `automaticReset` silence.

Measured on the page, against what the same hand movement turns a soldier:

| sustained sweep | mouse asked for | turret delivered |
|---|---|---|
| 5 px/frame for 0.5 s | 18.9° | **18.9°** |
| 10 px/frame | 37.8° | **37.8°** |
| 20 px/frame | 75.6° | **75.6°** |
| 40 px/frame | 151.3° | 151.3° (now uncapped — the 4× faster wind-up and 40° clamp no longer starve the bank) |
| 80 px/frame | 302.5° | 302.5° (cap-bound at speedScale×maxSpeed, not at the bank) |

Ordinary aiming is now 1:1 with the pointer, exactly as it is on foot. The
axis's own rate only bites on a sweep faster than 20 px a frame, and the
wind-up clears that in under a tenth of a second. Before this round, 40 px/frame
for half a second moved the turret just 11 degrees — "way slower than the
game", twice reported.

**`setMaxSpeed` is not confirmed to be a deg/s ceiling, and is no longer
treated as one.** §3 says the ±40 input clamp is "not the template's
`maxSpeed`", that `automaticReset` branches on whether `|acceleration|`
multiplies `maxRotation` or `maxSpeed` and that "this downstream use was not
closed out", and that the closed form of `angle += reg[0x110] × reg[0x128]`
is open. Taken literally, a Sherman's `setMaxSpeed 35` is about nine times
slower than the same hand movement turns a soldier's head. It is now a rate
cap times `TURRET_SPEED_SCALE` (4), tunable live with **`?turret=<scale>`**
or `window.__turretScale(n)`, because that number wants settling by playing
rather than by another guess. At 4 it is no longer the binding constraint at
any hand speed measured above — the bank clamp and the wind-up are.

**The wind-up is still GUN-3's, and now has real data behind it.**
`setAcceleration`'s magnitude is deg/s² of servo acceleration
(flight-model.md §2a, confirmed, vanilla magnitudes 30–150) and is exactly
the `|acceleration|·dt` §3 has the velocity register accumulating. `con.py`
emitted only its *sign* (as `direction`) and threw the magnitude away; it now
emits both, `TurretAxis` ramps at the axis's own number where the extract
carries it, and `TURRET_ACCELERATION` (90 deg/s², the middle of the confirmed
band) is the fallback for every glb baked before today — against the flat
1.0 s per gun that preceded it.

**The acceleration is scaled by `speedScale`.** Without this, the wind-up
time is `speedScale × (maxSpeed / acceleration)` instead of the game's own
`maxSpeed / acceleration` — a Defgun with `speedScale=4` and the 90 deg/s²
fallback would take a full 4 seconds to reach its 360 deg/s cap instead of
the game's ~1 s. Scaling both the cap and the ramp rate keeps the ratio
intact and the hand feel honest.

### Still open

- **The external camera modes still hang off the hull, not the turret.**
  `VehicleCamera.followFrame` builds its frame from `state.orientation`, so
  cycling to chase/front on a tank frames the hull's heading while the mouse
  turns the turret. Cockpit — the default, and the one the tank spawns in — is
  correct because it reads the camera node.
- **A seat can still only hold one bundle per axis name.** The preference rule
  picks the right one of the two; a hypothetical seat with two aim axes on the
  same name would still lose one.
- Everything GUN-3 already left open about the integrator (the accumulator
product's closed form, `automaticReset`) is unchanged — this round only
changed who gets a rig, which axes it claims, which way it points and how
fast it winds up.
- **No extracted model carries `acceleration` yet.** `con.py` emits it from
now on, but `viewer/models` is a shared untracked tree nothing re-baked
here, so every gun in the viewer is still on the 90 deg/s² fallback. A
re-extraction replaces guesses with the game's own per-axis numbers, and
`TURRET_ACCELERATION` then only ever covers a mod that declares none. The
fallback is now scaled by `speedScale`, so even without per-axis data the
wind-up preserves the game's `maxSpeed / acceleration` ratio rather than
spending four times as long as the game does.
- **Ground-vehicle keyboard input is no longer smoothed by `axisToward`.**
  `drive()` in `map.html` passes `KeyW/S/A/D` straight to `setInput`, the
  same way the game's `PhysicsEngine` samples `c_PIThrottle` — the Engine's
  own `RotationalBundle` servo (`setMaxSpeed`/`setAcceleration`) is the only
  rate limiter, not the 0.4 s `axisToward` ramp built for aircraft sticks.
  That ramp was the root cause of "the axis jeep just slides around" and
  "the Sherman is very hard to maneuvre" — the steering and throttle answered
  a full half-second late, so the tyres were always fighting a demand the
  hands had already cancelled.
- **The seated trigger routing has no unit test.** It lives in `map.html`,
  which no harness here loads; it was verified in the browser through the real
  pointer-event path (`__chordEvent`), including the two-button chord.

## 2026-09-19: the servo, the dial and the dots

The parity round read `RotationalBundle::calculateAndClipAngle` (lnxded
`0x081d7490`) instruction by instruction, twice and independently, and closed
GUN-2. Four things this file had recorded as confirmed were wrong, and they
were wrong together because they were all readings of the same function.

### What the servo actually is

```
speed  ->  sign(acceleration) * input * maxSpeed,  ramped at |acceleration| deg/s^2
angle  +=  speed * dt  +  continousRotationSpeed * dt
```

A first-order velocity servo: one angle register (`+0x104`), one speed
register (`+0x110`), both persisting between ticks. Not a product of two
accumulators.

**There is no bank of aim.** `+0x128`, which this file modelled as "degrees
of ask, clamped to ±40", is an **input backlog in input units**, and both it
and the `-1.0` constant beside it live inside the `rememberExcessInput`
branch. A survey of every `.con` and `.inc` in every archive of all 18
installs finds 1,468 declarations of that flag and **not one on a turret,
manned gun, tank or `Objects.con` rotational bundle** — vanilla's 32 are all
aircraft rudder and tail-flap `Wing` bundles. For every gun in this viewer
the register does not exist, so `TURRET_PENDING_CLAMP`, `TURRET_DEADZONE`,
`TURRET_IDLE_DECAY` and `TURRET_IDLE_DECAY_FRAMES` are all gone. The "settles
to a stop instead of coasting" behaviour those were tuned to produce now
falls out of the servo for free: when the hand stops, the commanded rate is
zero and the speed register ramps down to meet it.

### Three things the servo brings that were never there

- **`continousRotationSpeed · dt` is added unconditionally**, every tick, in
  the non-`automaticReset` path — alongside whatever the input asks for, not
  instead of it. `con.py` now carries it per axis. In vanilla no input-bound
  axis declares a non-zero one (the windmills, watermills and radar dishes
  that do have no input binding at all, and reach the viewer as `assemble.py`'s
  baked `ambient` glTF clip, which `map.html` already plays); 127 input-bound
  axes across the installed mods do, none of them mouse-look.
- **`automaticReset` is a different control law.** The angle ramps *straight*
  toward `input × maxRotation` at `|acceleration|` **deg/s** — a rate, so one
  tick from rest moves exactly `acceleration · dt` — with no velocity
  register and no continuous term. Release and the target is zero, so the part
  drives itself home at the same rate. That is what makes a steering wheel
  self-centre, and 221 vanilla templates (steering wheels and Engines) were
  running under the wrong law.
- **The wrap gate is `minRotation == 0 && maxRotation == 0`**, the template
  default, not a zero-width range. `con.py`'s `free` rule asked `lo == hi`,
  which read `min == max == 45` as free-spinning. **151 input-bound axes
  across 13 installs** author a non-zero zero-width range — three in vanilla
  (`Elco_ThrottleL` pitch 60/60 among them), 87 in FHSW, 33 in GCMOD — and the
  engine pins every one of them where the viewer spun it. A component the
  `.con` omits is that same template 0, so an axis declaring only
  `setMinRotation -70/0/0` clamps to [-70, 0] rather than spinning; the rule
  is "are both zero", not "is either absent".

### `TURRET_SPEED_SCALE` stays at 4

The research pass recommended removing it, on the reading that `maxSpeed` is
the literal deg/s ceiling. That was **refuted three ways** and the constant is
left alone; only its justification changes, because the old one cited the
now-corrected "±40 is not the template's `maxSpeed`" wording.

`maxSpeed` is a **gain — deg/s per unit of input**, and nothing establishes
the input's unit. The ±1 clamp lives inside `rememberExcessInput`, which no
gun declares. The wire format reserves headroom to **±16**:
`PlayerAction::set` packs every `PlayerInput` float with
`floatToFixed(v, 12, 16.0f)` and `get` decodes `((n/4095)·2 − 1)·16.0`, so an
input normalised to ±1 would leave fifteen sixteenths of the encoding dead.
And the "a soldier's head turns nine times faster for the same hand movement"
observation that produced the constant compares two different control laws —
`SoldierCamera` declares `setMaxSpeed 0/0/0` and never enters this function.

**The open question is now stated narrowly (ledger GUN-2b): what magnitude the
client's mouse-look axis delivers as `PlayerInput[c_PIMouseLookX/Y]`.** The
trail runs as far as the client's `ControlMap.addAxisToAxisMapping` registrars
(`FUN_006bba90` / `FUN_006bbd90`) without reaching the multiply. Until someone
reads it, `seats.js` makes its stand-in explicit in one place: a hand asking
for more travel per second than `maxSpeed · TURRET_SPEED_SCALE` delivers
input 1, so that product is the viewer's traverse ceiling — which is the
behaviour this page has shipped all along and the part players have judged.

### What the rewrite changes to the feel: nothing you aim with

Measured in the node harness against the two guns' real `.con` numbers —
`ShermanTower` `setMaxSpeed 35/25/0`, `setAcceleration 1000/0/0`;
`StationaryMG42Point` `setMaxSpeed 70/0/0`, `setAcceleration 5000/0/0` — under
the same scripted pointer input, before and after:

| same scripted input | before (bank) | after (servo) |
|---|---|---|
| Sherman turret through 90°, saturating (40 px/frame) | **0.667 s** | **0.667 s** |
| MG42 through 90°, saturating | **0.333 s** | **0.333 s** |
| MG42 to its real 70° stop, saturating | **0.250 s** | **0.250 s** |
| Sherman through 90°, tracking (10 px/frame) | **1.200 s** | **1.200 s** |
| MG42 through 90°, tracking | **1.200 s** | **1.200 s** |
| Sherman coast after a one-frame 2000 px flick | **19.7°** | **0°** |
| Sherman coast after releasing a saturating sweep | 19.4° | 1.3° |

Every time through 90 degrees is identical to the tick, which is the answer to
"does this change how every gun in the viewer feels": sustained aiming, the
thing a player actually does, is unchanged. What goes is the coast — the bank
kept paying out ~20 degrees after the hand stopped, and the idle decay was a
patch on exactly that. The servo's own ramp-down covers it in 1.3 degrees,
because a Sherman tower's 1000 deg/s² (4000 scaled) takes two ticks to bleed
140 deg/s.

### `inputScale`, for the damaged-vehicle hook

`TurretAxis.step(dt, inputScale = 1)` and `TurretRig.step(dt, inputScale = 1)`
multiply the sampled input before the servo sees it. That is exactly where the
engine applies HP-15: `RotationalBundle::handlePlayerInput` (`0x081d834f`)
scales all three axes by the double at `ds:0x86c8678` = **0.2** while
`SimpleObject+0xee` is set, i.e. for the whole wrecked lifetime of a
critically damaged vehicle. `map.html` owns deciding which, since it is the
only thing that knows the hull's live Armor; the two call sites are
`drive()`'s `occupancy.turret?.step(dt)` and `manned()`'s.

### Still open after this round

- GUN-2b, above: the mouse-axis magnitude.
- `con.py` drops a zero `setAcceleration` rather than emitting `0`, so the
  engine's own early-out (`acceleration == 0 && continousRotationSpeed == 0`
  returns without touching either register) cannot be told apart from "this
  glb predates the field". The fallback is applied in both cases.
- The clamp follows the engine in NOT sorting `min`/`max`: it tests `> max`
  first and `< min` second on the authored components. An inverted authored
  range would pin the angle, which is what the engine does.
