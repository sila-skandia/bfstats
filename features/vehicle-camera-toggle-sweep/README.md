# Camera toggling from every seat, the nose cam, and the server's view switches

2026-09-23. Three things the owner reported from play, against the retail game:

1. Only the driver (seat 1) could press C. A passenger, a hull gunner, the AA
   gun, the Defgun and the Brownings were pinned to one view.
2. The game lets a server allow soldier camera toggling; the viewer only did it
   under a `?foot3p=1` flag.
3. Aircraft were missing the view between the cockpit and the chase: the nose
   cam — full screen, the reticle, no cockpit, the engine heard from outside.

## What was read

- **The cycle is per Camera, and every seat has a Camera.** `Camera::setViewMode`
  gates each mode on the camera template's own `CVM*` byte, seeded on for inside,
  chase, front-chase and fly-by (`soldier-camera.js` has the addresses). Vanilla
  writes a `CVM*` word on ten artillery seats (`CVMExternTrace 1`) and nowhere
  else, so retail lets every seat cycle. The exporter already carried the words
  (`extras.cameraView.cvm`); nothing in the viewer read them for a gunner.
- **`OutsideHudOffset` is the nose cam.** Declared on every aircraft Camera and
  on nothing else — 22 templates across vanilla, Road to Rome and Secret Weapons,
  surveyed out of `Objects.rfa` — and it sits just past the propeller hub, which
  is where a camera stands to look forward without the prop disc in frame.
  `camera-modes.md` §4 had read it as a HUD anchor; §9b corrects that.
- **The server's four camera words.** `BF1942.exe` knows `game.serverExternalViews`,
  `game.serverAllowNoseCam`, `game.serverFreeCamera`, `game.serverDeathCameraType`.
  There is no soldier one: C on foot is a viewer departure and is labelled so.

## What was built

| file | change |
|---|---|
| `viewer/seat-view.js` | new. `seatViewModes` (the cycle from a seat's `CVM*` words and the server switches), `noseCamOffset` and the 22-entry `NOSE_CAM_OFFSETS` survey, Z-mirrored on read |
| `viewer/server-settings.js` | new. `externalViews`, `allowNoseCam` (the shipped `ServerSettings.con`, both 1) and the page's own `soldierExternalViews`; query string over `localStorage` over defaults; live `set` with listeners |
| `viewer/flight.js` | `VehicleCamera` takes `eyeNode`, `modes`, `nose`; `inside` / `modeId` / `setModes`; the `nose` mode; `FixedSubject` stands in for a root with no drivetrain. `CAMERA_MODES` is now the full vocabulary and `DEFAULT_CAMERA_MODES` the old four, so the flight harness is unchanged |
| `viewer/map.html` | `buildSeatView()` on every mount and seat switch; `mountChaseLaw()` anchors on the active seat's Camera; `manned()` takes its pose from the seat's rig and sets `guns.firstPerson` from it; FOV follows `view.inside`; `pilot()` moves a non-flying passenger's camera like `drive()` does; `cycleView()` behind C and the touch VIEW button, on foot too; `insideView()`; three side-panel switches; `soldier3pOnFoot()` reads the switch live; every exit path drops the rig |
| `viewer/soldier-camera.js` | `FOOT_VIEW_CYCLE` doc: the switch, not the flag |
| `bf42/con.py`, `bf42/assemble.py` | parse `OutsideHudOffset`, emit `extras.cameraView.outsideHudOffset` (mirrored); the viewer prefers it over the table |
| `tests/seat_view_harness.mjs`, `tests/test_seat_view.py` | 24 tests: the gate, the survey, the switches |
| `tests/test_con.py`, `tests/test_spin.py` | one test each for the exporter |

## Verified (Wake, headless, through the real `keydown`)

- **On foot**: inside → chase (2.3 m behind, 0.7 up) → front → inside. With the
  soldier switch off the cycle is `[inside]` and C does nothing.
- **AA gun** (`FixedSubject`, `AA_Allies_Camera`, engine law, turret frame,
  radius 6.03): cockpit → chase 5.56 m → front 4.41 m → fly-by 118 m → cockpit.
  Turning `externalViews` off mid-chase drops the view to the cockpit and the
  cycle to `[cockpit]`; back on restores the four.
- **Corsair**: cockpit → **nose** → chase 17.3 m → front 11.0 m → fly-by → cockpit.
  Nose: 4.47 m from the Camera node, offset matches `R(q)·(0, −0.4, −4.45)` to
  0.01 m, interior off / fuselage on, `guns.firstPerson` false.
- **Willy passenger** (seat 2, its own `WillyCamera` at 0.3/0.6/1.0): the full four.
- Every E exit leaves `view` null; no page errors across the run.
- `python3 -m unittest tests.test_seat_view tests.test_chase_camera
  tests.test_soldier_camera tests.test_con tests.test_spin tests.test_flight`:
  200 OK.

## Open

- The nose cam's exact placement is a strong inference from the data and the
  name, not a read of the client's view-mode code. If a capture shows the
  retail eye elsewhere, `noseCamOffset` is the one place to move it.
- The mode carries across a seat switch when the new seat reaches it. Retail's
  behaviour on a seat switch was not checked.
- Fly-by from a stationary gun plants at the 70 m floor; framing was not tuned
  for a gun that never moves.
