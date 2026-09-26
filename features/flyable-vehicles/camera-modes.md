# BF1942 vehicle camera modes — what is data, and what is ours

The flythrough's flown Corsair now has four views on C: cockpit, chase, front and
fly-by. This records which of them Refractor actually describes in data — one —
and states plainly that the other three are viewer inventions with numbers tuned
by eye.

Companion to `input-and-cockpit.md`, which covers the cockpit camera itself (§5),
the `DistCompareSelector` mesh swap (§8) and the control scheme (§4). Same tagging
convention: `confirmed` (read directly from data or proven by our runtime),
`strong inference`, `speculative`.

Survey method, per the repo rule (measure before you decompile): a script parsed
every `.con` inside `Objects.rfa` for vanilla **and thirteen installed mods** —
~37,000 files, `beginrem`/`endrem`-aware — and tabulated every directive that ever
lands on a template of kind `Camera`. Ghidra was not opened. It was not close to
necessary; the vocabulary answers the question outright.

---

## 1. The answer, per mode

| mode | placement / behaviour | availability |
|---|---|---|
| **Cockpit** | **data** — `CorsairCamera`'s own node position, look clamps and rates | data (`CVMInside`) |
| **Chase** | **ours** — nothing in data | data (`CVMChase`) |
| **Front** | **ours** — nothing in data | data (`CVMFrontChase`) |
| **Fly-by** | **ours** — nothing in data | data (`CVMFlyBy`) |

The split is sharp and worth stating precisely: **the data says which views a seat
offers and never where any of them sits.** Availability is a per-camera boolean;
geometry is engine-side and unreadable.

## 2. The complete `Camera` vocabulary

Union of every directive ever written on a `Camera` template across vanilla plus
DC/DC_Final/EoD/FH/FHSW/FinnWars/GCMOD/Pirates/WarFront/XPack1/XPack2/bf1918/
bfheroes/bg42/interstate. Case-folding the handful of typos leaves **13 real
commands**. `confirmed`.

| directive | uses (all mods) | what it does |
|---|---|---|
| `setMaxSpeed` | 2367 | look rate, deg/s |
| `setAcceleration` | 2356 | look accel |
| `setInputToYaw` / `ToPitch` / `ToRoll` | 2118 / 2082 / 288 | which `c_PI*` drives which axis |
| `setMaxRotation` / `setMinRotation` | 1861 / 1859 | look clamps |
| `OutsideHudOffset` | 1335 | outside-view HUD anchor (§4) |
| `CVMExternTrace` | 841 | shell-following view, artillery and ships |
| `toggleMouseLook` | 641 | consumes the shift-held mouse-look reroute |
| `setPivotPosition` | 624 | the eye's offset in the Camera's own frame, usually `0/0/0` or a ~0.25 m nudge; the half-tracks' MG is `0/0.3/-1` (see `features/bf1942-camera-pivot/`) |
| `setHasTarget` | 160 | — |
| `setContinousRotationSpeed` | 126 | — |
| `CVMInside` / `Chase` / `FrontChase` / `FlyBy` / `Trace` | 89 / 88 / 89 / 93 / 89 | per-mode availability booleans |

**There is no distance, no offset, no lag, no spring and no damping term anywhere
in that list.** Not in vanilla, not in any mod, not once in 37,000 files. Whatever
BF1942's chase camera does, it does from a hardcoded constant we cannot read.

## 3. `CVM*` is a boolean, and omission means on

`SoldierCamera` is the one vanilla template that spells out the whole set:

```
ObjectTemplate.create Camera SoldierCamera
  ObjectTemplate.CVMInside 1
  ObjectTemplate.CVMChase 0
  ObjectTemplate.CVMFrontChase 0
  ObjectTemplate.CVMFlyBy 0
  ObjectTemplate.CVMTrace 0
  ObjectTemplate.CVMExternTrace 0
```

An infantryman is locked to first person, which is exactly how BF1942 plays. Every
vanilla *vehicle* camera omits the flags entirely and gets the default cycle.

FinnWars settles the "omission means on" reading by contradiction: it writes
`CVMChase 0 / CVMFrontChase 0 / CVMFlyBy 0 / CVMTrace 0` on **67** cameras — a mod
deliberately locking 67 vehicles into first person. You only need to write `0` if
the default is `1`. `confirmed` for the flag inventory; `strong inference` for
default-on, now with a second independent witness.

## 4. `OutsideHudOffset` is not a chase camera

It is the only per-vehicle datum in the whole archive that mentions the outside
view, so it is worth killing off as a candidate explicitly. Vanilla declares it 13
times, **aircraft only**, Corsair `0/-0.4/4.45`.

Refractor's +Z is forward. Measured, not assumed, from `CorsairComplex`'s own child
placements: `CorsairEngine` (the propeller) sits at `z=+4.149` and `CorsairRudder`
at `z=-2.649`. `confirmed`.

So `0/-0.4/4.45` is **4.45 m ahead of the vehicle origin** — 0.3 m *past the
propeller hub* — and 0.4 m below it. That is a point a chase camera can never
occupy. It anchors the outside-view HUD reticle, exactly as its name says.

The other twelve behave the same way and rule out "it tracks aircraft length": the
B17, by far the largest aircraft in the game, has the *smallest* value (`0/0/2.5`),
because its pilot sits far forward and its nose is close. The Corsair, whose pilot
sits behind an enormous radial, has one of the largest. It tracks the distance from
the eye to the nose. `strong inference`.

## 5. Two corrections to `input-and-cockpit.md` §5

**5a. `vehicleFov` exists.** §5 concludes "no FOV command exists on any vehicle
Camera template ... Vehicle 1P FOV is an engine constant". The first half is right
and the second overreaches. `ObjectTemplate.vehicleFov` is live **426 times across
11 mods** (FHSW 173, bg42 188, FinnWars 28, bf1918 13, DC 6, DC_Final 8, …), values
0.1 to 1.8 as a multiplier. It sits on the `PlayerControlObject`, not the Camera,
which is why a Camera-only sweep missed it. Vanilla uses it **zero** times, so
vanilla FOV really is a constant — but the engine has the knob, and a mod extract
that ignores it will render FHSW vehicles at the wrong FOV. `confirmed`.

**5b. `setAutomatic{Yaw,Pitch}Stabilization` is a gun command, not a camera one.**
15 live uses in vanilla, every one on a `RotationalBundle` pintle-MG mount on an
open-top vehicle (Hanomag, Ho-Ha, KettenKrad, M3A1, Sherman, T34-85, Stuka rear).
It holds a mount's world-space aim while the platform moves underneath it. Relevant
here only as precedent: the engine has the concept of decoupling a mount from its
platform. Pointing it at a camera is ours. `confirmed`.

---

## 6. What we built

`viewer/flight.js`, `VehicleCamera`. Owns all four modes plus the smoothing state;
`map.html` only feeds it `dt` and takes the pose. It lives in the module rather
than the page because it needs the vehicle's orientation and nothing else, so a
replay viewer gets it free. The one thing it cannot know is where the ground is, so
`groundHeight` is injected the way `Aircraft.groundHeight` already is.

### 6a. Cockpit — reconstructed

Unchanged behaviour, now one mode among four. Eye point is the `<Vehicle>Camera`
node's world pose; the free-look offset is applied in the aircraft's frame; the
clamps are `CorsairCamera`'s declared `setMinRotation -70/-40/0` /
`setMaxRotation 70/5/0`. Verified: asking for 2.0 rad of yaw clamps at exactly
-70.0 degrees.

### 6b. Chase and front — ours, and how they avoid being nauseating

A camera rigidly parented to the airframe inherits the Corsair's 200 deg/s roll and
is unusable. A camera that merely *lags* a rigid parent still rolls, just late. So
the fix is applied to the target, before any smoothing:

**The follow frame keeps the aircraft's heading and pitch and derives its up from
world up, discarding roll entirely.** The horizon stays level while the aircraft
rolls *inside* the frame, where you can see it happening — which is the thing you
actually want to watch.

Smoothing then only has to handle lag, and because position hangs off the same
frame, one time constant buys both the orientation ease and the positional swing
behind the aircraft in a turn. The ease is frame-rate independent
(`1 - exp(-dt/tau)`); a bare `slerp(q, 0.1)` would smooth twice as hard at 120 Hz.

The frame is carried between frames rather than rebuilt, which is what gets it
through the singularity where `forward x worldUp` degenerates — nose vertical, top
of a loop. Below `1e-6` it borrows the airframe's own right vector, the only frame
available there.

| | back | up | aim lead | tau |
|---|---|---|---|---|
| chase | 17 m | 4.2 m | 22 m ahead | 0.32 s |
| front | 11 m ahead | 1.6 m | 4 m behind nose | 0.18 s |

All six numbers are ours. Chase is far enough back to hold the Corsair's 12 m span
and aims ahead of the nose so the aircraft settles into the lower third. Front is
11 m because the prop disc is at 4.15 m and clearing it while still framing the
whole aircraft needs about that. Front runs a tighter tau because a front camera
that lags badly swings wide and shows the aircraft in profile instead of head-on —
but it keeps *some* lag, because that is what banks the aircraft across the frame in
a turn rather than pivoting it in place.

### 6c. Fly-by — ours, and its placement rule

A fixed world camera the aircraft passes. The rule, designed to read as a held shot
rather than a dice roll:

- **Plant ahead along the heading**, `3.2 s` of flight (clamped 70–260 m), taken
  from the roll-free frame so a camera is never planted sideways because the
  aircraft happened to be inverted at that instant.
- **Alternate sides every plant**, so two consecutive fly-bys never mirror.
- **Rotate through three compositions**: a level close pass (38 m lateral, +5 m), a
  low wide one that throws the aircraft against the sky (64 m, -14 m), and a high
  one that puts it against the terrain (46 m, +26 m).
- **Lift the anchor clear of the terrain** — a trackside camera buried in a hillside
  films a hillside.
- **Re-plant only when the aircraft is both beyond 300 m and receding.** Both terms
  are load-bearing: the plant is already ~180 m out, so a bare distance test would
  re-plant on the frame it planted.

The mouse is ignored in this mode. A camera on a tripod in the world has no
operator's head, and `LOOK_LIMITS.flyby` is `null` to say so.

### 6d. The interior swap follows the view

`Aircraft` defaults `autoFirstPerson = true`, which forces first person every
`integrate()` — right for a page with one view, wrong the moment C exists. `map.html`
now turns it off and `VehicleCamera.setMode` calls `setFirstPerson` on every change.
Leaving both on would have `integrate` slam the interior back every frame.

Two consequences handled: `reset()` no longer restores the exterior (it only did so
when it owned the swap), so leaving pilot mode calls `setFirstPerson(false)`
explicitly or the parked plane sits on the strip as an open cockpit tub; and `view`
is nulled alongside `aircraft` on a map change.

---

## 7. Verified

Flown through the real input path on Wake (`map.html?shots`), not by poking state.

- **C cycles** cockpit → chase → front → fly-by → cockpit, through a real `keydown`.
- **Geometry**, sampled after the render loop: cockpit 1.20 m from the origin at
  0.04 m off the centreline; chase 17.51 m at −17.0 m along the nose; front 11.12 m
  at +11.0 m; fly-by 136 m and **the camera moves 0.00 m while the aircraft moves
  17.67 m** — genuinely nailed to the world.
- **Interior/exterior flips with the view**: cockpit `interiorVisible 1 /
  exteriorVisible 0`, all three external modes the exact inverse, and
  `guns.firstPerson` follows.
- **Full-stick roll to inverted** (`up.y` → −1.0): camera roll against the world
  stays **0.0000** in both chase and front, distance constant to 0.01 m.
- **Loop through vertical** (nose `y` → 1.0): zero non-finite values, max
  frame-to-frame camera jump 0.417 m (chase) / 0.099 m (front) at a 17.5 m radius —
  about 1.4 degrees, no flip.
- **Fly-by re-plants** on schedule, alternating sides and rotating compositions;
  closest approach 41.3 m on the level pass.

## 8. The muzzle flash, settled

The Corsair's guns are in the **wings**: muzzles at `(±2.229, −0.245, −2.6)`, which
is 1.45 m below the pilot's eye and 46 degrees off the boresight.

**The third-person flash renders correctly in the external views.** Over a 90-frame
held burst, `em_MuzzHeavy` and `em_MuzzHeavy_glow` are visible 45 frames in chase
and the 1P pair 0; both flashes are plainly visible in the chase, front and fly-by
screenshots.

**The first-person path is not dead either** — and this is the part worth recording,
because "nothing happens when you fire from the cockpit" reads like a bug. Over the
same burst in cockpit view, `em_1P_MuzzHeavy` is visible **27 of 90 frames** and the
third-person pair 0. The `effect.view` filter works in both directions.

It is invisible for two compounding geometric reasons, neither of them a defect:

1. At 46 degrees off the boresight it is outside the forward frame.
2. Turn the head toward it — the ±70 degree clamp reaches easily, and the muzzle is
   then inside the frustum on 60 of 60 frames — and it is still invisible, because
   solid geometry is in the way. A ray from the eye to the muzzle at 3.67 m hits
   `Corsair_Hull_M1`, the wing, at **3.22 m**. Forcing `depthTest = false` makes the
   flash appear immediately, at the predicted pixel.

So the gun is under the wing and the pilot is above it. BF1942 would occlude its own
`em_1P_MuzzHeavy` identically. Nothing to fix; the third-person views are simply
where this aircraft's flash was always meant to be seen.

## 9. Still open

- **What the engine's actual chase distance is.** Unreadable from data by
  construction (§2). Settling it means the binary, and §1's table is honest about
  the gap in the meantime.
- **`vehicleFov` is parsed by nothing.** Vanilla never sets it, so the viewer is
  correct today, but an FHSW or bg42 extract would want it (§5a).
- ~~**`setPivotPosition`**~~ **Closed 2026-09-26.** It is the eye's offset in the
  Camera's own frame (`Camera::handleUpdate` 0x081aa940). `viewer/camera-pivot.js`
  applies it. See `features/bf1942-camera-pivot/README.md`.

## 10. Extracted (2026-09-17)

`CVM*` is now parsed (`con.py`) and emitted as `extras.cameraView.cvm` on the
Camera node — a dict of the *declared* flags only, e.g. `{"CVMINSIDE": true,
"CVMCHASE": false}`. An empty/absent dict means "all modes available" (the
omission-means-on rule from §3). `viewer/seats.js` captures it as
`seat.cameraViewModes` so `CAMERA_MODES` can filter the C cycle per seat.

Nothing in vanilla actually writes a disabling flag on a vehicle camera — every
vehicle camera omits the CVM* block and gets the full default cycle — but FinnWars
locks 67 cameras to first person with `CVMChase 0 / CVMFrontChase 0 / CVMFlyBy 0 /
CVMTrace 0` (§3), so the field earns its keep on mods even if vanilla never
exercises it.

---

## 9. 2026-09-23 — every seat cycles, the nose cam, and the server's switches

Three gaps the owner reported from play, closed together. Work recorded in
`features/vehicle-camera-toggle-sweep/README.md`; this section carries what
changed in the reading above.

### 9a. Every seat has the cycle, not only the driver

The `VehicleCamera` used to be built once per *vehicle* on the root seat, and
`manned()` pinned every gunner and every bare gun to its Camera node. That was a
viewer shortcut, not a reading: `Camera::setViewMode` gates each mode on the
**camera's own template byte**, one Camera per seat, and vanilla writes a `CVM*`
word on ten artillery seats and nowhere else. So the AA gunner, the Sherman's
hull gunner, the Willy's passenger and a tripod Browning all get the same
inside → chase → front → fly-by walk the pilot does. The rig is now built per
*active seat* (`map.html` `buildSeatView`): the inside eye is that seat's own
Camera node, the external views hang off the root, and the chase law
(`chase-camera.js`) anchors on the seat Camera as the engine's `camM` does, with
`cameraRidesTurret` asked of the active seat so a gun position follows its gun.
A root with no drivetrain frames through `flight.js` `FixedSubject`. The seat's
`cameraViewModes` (the exporter's `cvm`, upper-case) gate the cycle through
`seat-view.js` `seatViewModes`; a locked FinnWars camera or `SoldierCamera`'s
shape collapses to the cockpit alone. `confirmed` for the gate; the placement
of the external views is unchanged and still ours.

### 9b. §4 was wrong: `OutsideHudOffset` is the nose cam

Retail's aircraft have a second inside view between the cockpit and the chase:
no cockpit, no airframe, the reticle over open air, the engine heard from ahead
of the propeller. `game.serverAllowNoseCam` is its switch. §4 dismissed
`OutsideHudOffset` as "a point a chase camera can never occupy" — true, and
beside the point, because 0.3 m *past the propeller hub* is exactly where a
camera has to stand to look forward without the prop disc across the frame, and
the B17's 2.5 m is the pilot who already sits at the nose. The word is declared
on **every aircraft Camera and nothing else** — 13 vanilla, 2 Road to Rome, 7
Secret Weapons, surveyed straight out of `Objects.rfa` and tabled in
`seat-view.js` `NOSE_CAM_OFFSETS` — which is also the list of vehicles retail
gives a nose cam to. So `nose` is: the seat's eye plus that offset in the eye's
own frame (Z-mirrored into glTF), the interior LOD off, the cockpit's own neck
clamps. `strong inference` on the exact placement (the client's nose-cam code
was not read); `confirmed` on the availability list.

The exporter now carries the word as `extras.cameraView.outsideHudOffset`
(`bf42/con.py`, `bf42/assemble.py`), already mirrored, and the viewer prefers
it over the table, so a mod the table never saw works after a re-extraction
without a code change. No re-extraction was needed for what ships: the table
covers every installed mod.

Verified on Wake through the real C key: Corsair cockpit → nose → chase → front
→ fly-by → cockpit; in `nose` the eye sits **4.47 m** from the Camera node along
`R(q)·(0, −0.4, −4.45)` to 0.01 m, the interior LOD is off and the fuselage on,
`guns.firstPerson` is false (the 3P muzzle flash), and the listener at the nose
gets the exterior mix by distance alone — the `.ssc` layers are placed in
vehicle space and ramp on distance, there is no inside/outside word to honour.

### 9c. The server's switches

`BF1942.exe` has exactly four `game.server*` words that touch a camera:
`serverExternalViews`, `serverAllowNoseCam`, `serverFreeCamera`,
`serverDeathCameraType`; the shipped `ServerSettings.con` writes them
`1 / 1 / 0 / 1`. `server-settings.js` honours the first two (default on, the
side panel and `?externalViews=0` / `?noseCam=0` switch them, persisted).

A third of the page's own, `soldierExternalViews`, sat beside them from
2026-09-23 to 2026-09-26 for C on foot, under `?foot3p=1`. Retail has no such
switch and CAM-1 stands: `SoldierCamera` writes the three external `CVM*` words
to zero, so a standing soldier has one view. The owner has withdrawn it, and
the key is gone rather than defaulted off, because `set` wrote all three keys
and a browser that had touched the side panel held it on. See
[`features/viewer-foot-first-person`](../viewer-foot-first-person/README.md).
