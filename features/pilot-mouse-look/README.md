# The pilot's mouse-look key

The owner's request (2026-09-25): *"turn off free roam looking in planes when inside the cockpit
(i.e. moving the mouse does nothing)... it's just annoying to knock the mouse and nudge their
pov around."* Retail already behaves this way. Ledger MLK-1..MLK-6 has the full
evidence, and `viewer/mouse-look-key.js` carries the addresses.

Since 2026-10-06 the other half is built too: with the key up the mouse flies
the aircraft, and the keys reach the stick in one tick (MLK-7..MLK-12,
"The mouse flies the aircraft" below).

## What the engine does

- **The camera word.** `ObjectTemplate.toggleMouseLook` is a byte on the
  Camera template, default 0.
  - lnxded: `+0x1c2`; constructor `0x081acc20`; `makeScript` `0x081acd60`,
    literal `0x086c5120`.
  - client: `+0x272`; constructor `0x00564f30`.
  - `Camera::getToggleMouseLook` is lnxded `0x081acaf0` and client
    `0x00564610`, in ICameraObject slot `+0x40` of both binaries.
- **The router.** `BFPlayer::handleInput` (lnxded `0x08052530`, client
  `0x00407ec0`) runs once per tick, called from `simulatePlayerUpdate` at
  `0x0815bebc`.
  - It applies only to a seat whose camera sets the word.
  - `c_PIMouseLook` held (channel 11, value above 0.5): it zeroes `c_PIYaw`,
    `c_PIPitch` and `c_PIRoll`, whatever device they come from.
  - Released: it zeroes `c_PIMouseLookX/Y`.
- **The camera.** `Camera::handlePlayerInput` (lnxded `0x081aa490`, client
  `0x00564af0`).
  - Released, with the word set: it zeroes the look's speed and input, and
    multiplies the look angles by **0.75 per tick** (`ds:0x86ba8cc`, client
    `[0x008d1e28]`). The view eases back to straight ahead: half the angle is
    gone in 80 ms, 90% in 8 ticks.
  - Held, or without the word: an ordinary RotationalBundle.
- **Every view mode obeys the key.** Neither function reads the mode, and the
  engine's chase views never draw the look angle (CVM-2).
- **Which seats (shipped data).** The word is on exactly the aircraft pilots'
  cameras, never on a gunner's camera.
  - vanilla: 13 of 90 Camera templates;
  - XPack1: 2;
  - XPack2: 7.
  - Each one is the camera of a `VCAir` pilot PCO.
  - Read from the three installs' `Objects.rfa`.
- **The key.** Only `Air.con` binds it: `c_PIMouseLook IDFKeyboard
  IDKey_LeftShift c_CMPushAndHold` (`Settings/Default/Controls/Air.con:21` and
  the Default profile's). Left Shift is also `c_PIWalk` on the Infantry map
  and `c_GILeftShift` on the game map. The map is chosen per vehicle category,
  so in a pilot's seat Left Shift is the look alone. The retail mouse flies
  the plane while the key is up (MLK-7; built 2026-10-06, below).

## What changed

- `viewer/mouse-look-key.js` (new, pure): the constants, and four functions:
  - `seatNeedsMouseLookKey`: the root seat of an `air` hull. The glbs do not
    carry the word, so this is the shipped data's rule;
  - `recentreFactor` / `recentreLook`: `0.75 ** (30 * dt)`, exact at every
    tick boundary;
  - `routeFlightInput`: the router's held branch.
- `viewer/local-look.js`:
  - `lookDelta` drops a pilot's mouse unless the key is held (the profile's
    `c_PIMouseLook`, keyboard or joystick; on touch, a finger on the view);
  - new `stepMouseLookKey(dt)` for the ease-back.
- `viewer/seat-camera.js`: `pilot()` eases the look back before posing any
  view. The pilot hint now reads "L Shift+mouse look around".
- `viewer/local-player.js`: while the key is held, the pilot's rudder, roll
  and pitch read 0. The touch pad's override is kept.
- `map.html`: three wiring lines.
- Unchanged:
  - gunner seats (B17 turrets, rear guns) and every seat of a hull that is not
    an aircraft;
  - the look law while the key is held (`HEAD_SENS`, the Corsair clamps).

## Verification

- `tests/test_mouse_look_key.py` + `mouse_look_key_harness.mjs`, 25 tests
  against the real `controls.js`, `createLocalLook` and `VehicleCamera`:
  - 0.75 per tick, the same at any frame rate;
  - comes to rest at exactly 0;
  - only an aircraft pilot needs the key;
  - Left Shift is the look on the Air map only, in the shipped maps and the
    owner's profile, and a profile can rebind it to a joystick button;
  - a gunner's mouse still reaches his turret; a driver's and a helmsman's
    views are unchanged.
- `test_mouse_input.py` and `test_controls.py` pass.
- Live, Bocage, BF109:
  - Without the key, `__lookDelta(300,100)` gives look 0/0 and the camera
    turns 0.000 deg.
  - With `ShiftLeft` held: look -37.815/-12.605 and the camera turns 39.8
    deg; still there 5 ticks later.
  - Released: back to 0.000 deg within the second.
  - Stick and rudder at 0.64 go to 0 with Shift held, and return (0.88)
    without it.
  - Chase view: the knock does nothing, held orbits -50.4 deg, and it returns
    to 0.
  - The per-tick ratio cannot be isolated live, because the page's own
    animation loop runs between the rig's stepped frames.

## The mouse flies the aircraft (2026-10-06)

Desert Combat census, package `air-input` (`~/.cache/dc-sweep/reports/air.md`,
WP3 and items 8 and 9). DC ships no control maps, so this is the vanilla
`Air.con` for every mod.

### What the engine does

- **The stick is the mouse (MLK-7).** The Air map binds mouse X to `c_PIRoll`
  and mouse Y to `c_PIPitch` as well as to the look, and every mapping of a
  mouse axis reads the one device register. So the stick value is the look's
  own law (`bf1942-mouse-input`): `0.001 x counts/s x 3.85` at the shipped
  `setAirMouseSensitivity 0.75`, held for the frame's ticks, quantised to 0.01.
  It is a rate. A still mouse is a centred stick, and a hand faster than about
  260 counts a second asks for more than full deflection, which the part clips.
- **The invert box is the device's Y (MLK-8).** `setAirMouseInvert 1` (shipped)
  inverts the stick's pitch and the held look's `c_PIMouseLookY` together. A
  pull of the mouse toward you raises the nose.
- **What the held look does on screen is the camera's sign times the box
  (MLK-13).** The pilot's Camera turns by `sign(acceleration) x input`
  (GUN-2), and nearly every shipped pilot camera has a negative pitch
  acceleration (`CorsairCamera 5000/-5000/0`, 23 of DC's 24), which undoes the
  shipped box. With the box on, their held look keeps the plain sense (a pull
  toward you looks down); off, it is inverted. The positive ones (BF109,
  Mustang, B17, the Aichi Vals, DC's AC-130, nine DC Final cameras) are
  inverted at the shipped setting.
- **Two devices on one channel never add (MLK-9).** A channel has a primary and
  a secondary slot (the line's last flag). `ControlMap::update` keeps the
  larger magnitude, and the primary wins a tie. Shipped Air puts the mouse
  first and the arrows second.
- **A key is a step (MLK-10).** `buttonsToAxis` rises and falls in 0.001 s,
  and nothing shipped changes that, so a key gives the full channel on the
  first tick.
- **`setAirKeyboardSensitivity 0.5` does nothing in play (MLK-11).** The
  client stores it, binds it to the options slider and writes it back to
  the profile. Nothing else reads it. Key deflection stays +-1, so the
  helicopter collective (W gives T1 = 1) and the Harrier's S-for-lift-jets are
  unchanged. This settles the census's open question 2.
- **The authority cannot tell a mouse from a key (MLK-12).**

### What changed

- `viewer/controls.js`:
  - mouse `addAxisToAxisMapping` lines are parsed;
  - every axis line records its slot;
  - `axis(trigger, mouse)` folds a pumped mouse pair into the channel by the
    slot rule (`resolveAxisSlots`). The mouse value is not clamped.
  The keyboard and joystick fold is unchanged.
- `viewer/local-look.js`: with the key up, a pilot's counts go into the look
  stage instead of being dropped. With the key held, the head's vertical is
  the negative camera's sense times the Air box (MLK-13): unchanged with the
  shipped box, inverted with it off. A touch drag is not inverted, and the
  touch look zone with the key up does nothing, as before (it is not the
  mouse and never reaches the stick; `touch-controls.js` tags its delta).
- `viewer/local-player.js`: the pilot's rudder, roll and pitch come from
  `axis(trigger, mouse)`. With the key up, the look pair is zeroed (MLK-2's
  released branch, `routeLookPair`).
- `viewer/mouse-input.js`: `DEFAULT_INVERT`, so Air starts inverted as a fresh
  install does. The page still runs the profile's own line over it.
- `viewer/world-input.js`: rudder, roll and pitch are clipped at the wire's
  +-16 instead of +-1. The docstring gives the key-law and keyboard reads.
- `viewer/world-vehicle-tick.js`: the air branch no longer springs
  (`STICK_RATE` 2.4/s out, 3.2/s back, now only on a ship's pitch).
  - A vectored airframe takes the value whole, since its racks clip at
    `maxRotation` (GUN-2). Its Wings and flaps (a Harrier's ailerons, flaps
    and pitch/roll wings, a helicopter's tail flap) are servoed by
    `vehicle-base.js` `advanceSurfaces`, which clips the target at +-1, as the
    part's own angle stops at its bound. Without that clip a 500 px/s hand
    held 1.5 s drove the AV-8B's ailerons to 1.92 of full deflection and it
    banked 106 degrees at 2 s against 78.5.
  - A fixed-wing surface takes it clipped to +-1, because `advanceSurfaces`
    has no clip of its own. For an `automaticReset` wing this is the same
    motion.
- Bots: their rudder used to go through the same spring. Without it, the
  bot helicopter law flies the five DC airframes as before (arrival and
  landing within 0.07 s, tilt within 1.2 degrees,
  `~/.cache/dc-sweep/air-input/work/heli_bot.mjs`). The plane law's harness
  test never had the spring.
- Unchanged:
  - gunner seats (LandSea map, no mouse on the stick);
  - the owner's profile, which flies on the joystick and binds no mouse axis
    to the stick;
  - the fixed-wing W/S throttle latch (an owner decision, census WP5).

### Verification

- Tests:
  - `tests/test_mouse_look_key.py`, 37 tests: the whole page chain on real
    modules. 30 px in a tick (900 counts/s) gives `c_PIRoll` 3.46 and
    `c_PIPitch` -3.47 (3.46 with the box off), and 1.21 at sensitivity 0.25.
    It also covers a still mouse, the slot rule against the arrows, Left Shift
    routing the counts to the head, the held look's sign under the box, the
    touch look zone, the owner's profile and a gunner.
  - `test_flight.py`: a surface servo held at a mouse rate of 3.46 stops at
    full deflection.
  - `test_world_air_input.py` (new): a key is full on the first tick and at
    rest the tick after release, on both kinds of airframe. A mouse rate
    reaches a rack whole and a fixed-wing surface clipped. The wire's +-16 is
    the ceiling, and a bot's word takes the same path.
  - `test_controls.py`: the slot flags, the shipped mouse lines and the fold.
  - `test_mouse_input.py`: the shipped invert boxes and Air's Y.
  - `test_world_ship_pitch.py`: the air case is now a step, and the ship keeps
    its spring.
- Flown headless through the real World tick, input stage and flight model,
  built from the glbs at 60 fps (`~/.cache/dc-sweep/air-input/fly_mouse.mjs`;
  `before.json` is HEAD 70d0b6ea, `after.json` this branch). Both airframes
  hands off are the same before and after.

DC AH-64 at 150 m, W held:

| Hand | Before | After |
|---|---|---|
| Mouse right, 300 px/s for 0.5 s | nothing (bank 0.00) | `c_PIRoll` 1.15, roll rack at its 20 degree stop, 21.2 deg/s, bank 45.8 at 3 s |
| ArrowRight for 0.5 s | 20.7 deg/s, bank 42.8 at 3 s | same as the mouse above, the rack at its stop in 0.13 s |
| Mouse pulled back, 200 px/s for 0.5 s | nothing | `c_PIPitch` -0.78, nose up at 9.9 deg/s, 21.5 degrees at 3 s |
| Mouse right, 60 px/s for 1 s | nothing | `c_PIRoll` 0.23, rack 4.6 degrees, 10.9 deg/s |

The rates hold after the hand stops because nothing damps a helicopter's
rotation (census open question 1).

Vanilla Corsair at 300 m, 80 m/s, full throttle:

| Hand | Before | After |
|---|---|---|
| Mouse right, 300 px/s for 0.5 s | nothing | `c_PIRoll` 1.155, clipped to 1. Bank 61 degrees at 1 s and 144 at 2 s, peak 238 deg/s |
| ArrowRight for 0.5 s | bank 46 at 1 s, 130 at 2 s | same as the mouse above |
| Mouse pulled back, 200 px/s for 1 s | nothing | `c_PIPitch` -0.78, nose up 46 degrees at 1.5 s, peak 61 deg/s |
| ArrowDown for 1 s | 52.2 degrees at 1.5 s | 54.6 degrees at 1.5 s, peak 75 deg/s |

The Corsair's 240 deg/s roll is the fixed-wing model's, not the input's
(census item 6).

## Open

- `rememberExcessInput` is not modelled. Vanilla's elevator Wings declare it
  (the Corsair's tail flaps do), and in retail a mouse flick past
  full deflection spends its excess over later ticks (GUN-2's backlog, up to
  +-40 input units). The fixed-wing surfaces here clip at +-1 instead. The
  fix belongs in the surface servo (`vehicle-base.js` `advanceSurfaces`, with
  the flag in the surface spec), not in the input stage.
- `advanceSurfaces` clips its target at +-1 now, so the fixed-wing +-1 in
  `world-vehicle-tick.js` is redundant and can go.
- `countsPerPixel` (one browser pixel is one count) is still the one unproven
  unit (`bf1942-mouse-input`). It now scales the pilot's stick too.
- `toggleMouseLook` is not extracted. Mods get the shipped rule, not their own
  data (641 uses across 14 installs; only vanilla, XPack1 and XPack2 were
  read). The fix:
  - parse the word in `bf42/con.py`;
  - emit it as `cameraView.toggleMouseLook` from `bf42/assemble.py`;
  - have `seatNeedsMouseLookKey` prefer it;
  - re-bake every aircraft model and every level that places an aircraft.
- The look law while the key is held is still the viewer's. The engine uses
  the camera's own `setMaxSpeed`, and each aircraft has its own clamps: BF109
  `-65/-40..65/5`, B17 `-75/-40..75/0`, Spitfire `..70/1`. Five cameras use
  `90/-90`, which flips the vertical look. The vertical's sign is the
  camera's pitch acceleration times the Air box (MLK-13). The glbs carry
  neither, so the page assumes the negative majority: right for the Corsair,
  Spitfire, Stuka, Yak-9, Zero, SBDs, Il-2, every XPack1 and XPack2 pilot and
  23 of DC's 24 cameras; wrong (not inverted) for the BF109, Mustang, B17,
  Aichi Vals, DC's AC-130 and nine DC Final cameras. The fix is the same as
  for `toggleMouseLook`: emit the camera's pitch acceleration sign in
  `cameraView` and multiply by it.
- The cockpit view's pitch limits (`vehicle-camera.js` `LOOK_LIMITS.cockpit`,
  40 degrees down and 5 up) look mirrored: the engine's negative pitch is up
  (`turret-rig.js` `RIG_SIGN.pitch`), so the Corsair camera's `-40..5` is 40
  up and 5 down. Not checked against a recording.
- The page never clears held keys on window blur (predates this change).
- A mouse-button binding of `c_PIMouseLook` is not read by `controls.held`.
- The live B17 gunner and Sherman readouts were not captured before the budget
  stop. The unit tests cover both paths.
