# The pilot's mouse-look key

The owner's request (2026-09-25): *"turn off free roam looking in planes when inside the cockpit
(i.e. moving the mouse does nothing)... it's just annoying to knock the mouse and nudge their
pov around."* Retail already behaves this way. Ledger MLK-1..MLK-6 has the full
evidence, and `viewer/mouse-look-key.js` carries the addresses.

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
  the plane while the key is up. That part is not built.

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
  - the look law while the key is held (`HEAD_SENS`, the Corsair clamps);
  - mouse flying (not built).

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

## Open

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
  `90/-90`, which flips the vertical look.
- The page never clears held keys on window blur (predates this change).
- A mouse-button binding of `c_PIMouseLook` is not read by `controls.held`.
- The live B17 gunner and Sherman readouts were not captured before the budget
  stop. The unit tests cover both paths.
