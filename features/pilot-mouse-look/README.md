# The pilot's mouse-look key

The owner's request (2026-09-25): *"turn off free roam looking in planes when inside the cockpit
(i.e. moving the mouse does nothing)... it's just annoying to knock the mouse and nudge their
pov around."* Retail already behaves this way. Ledger MLK-1..MLK-6 has the full
evidence, and `viewer/mouse-look-key.js` carries the addresses.

Since 2026-10-06 the other half is built too: with the key up the mouse flies
the aircraft, and the keys reach the stick in one tick (MLK-7..MLK-12,
"The mouse flies the aircraft" below).

Since 2026-10-07 every seat goes by its own PCO and Camera: DC's air
co-pilots and passengers fly the Air map and profile, a channel's devices
sit in two slots and never add, the cockpit look turns 40 up and 5 down, the
wire carries an analogue rudder and throttle, a ship's pitch has no spring,
and a flick's excess on an elevator is spent over later ticks (MLK-14..MLK-18,
"Every seat, the slots and the excess" below).

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
- **What the held look does on screen is the camera's gain sign times the
  box (MLK-13).** The pilot's Camera turns by
  `sign(acceleration) x input x maxSpeed`, `maxSpeed` signed (GUN-2:
  `calculateAndClipAngle` multiplies by the template's raw `maxSpeed`, lnxded
  `0x081d7866`). Every key camera of vanilla, XPack1, XPack2 and DC 0.7 that
  looks up and down has a negative gain: the Corsair's
  `setAcceleration 5000/-5000/0` with `setMaxSpeed 90/90/0`, and the BF109's,
  Mustang's, B17's, Aichi Vals', `Ju88A_Camera`'s and DC's AC-130's
  `5000/5000/0` with `90/-90/0` alike. That undoes the shipped box: with the
  box on, their held look keeps the plain sense (a pull toward you looks
  down); off, it is inverted. The positive ones, inverted at the shipped
  setting, are DC Final's AH64, H6Pilot, MH53Pilot, Mi8, SA342Pilot, UH-60 and
  UH-60Q cameras.
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


## Every seat, the slots and the excess (2026-10-07)

Package `air-input-2`: the gaps the air-input fix and its review left
(`~/.cache/dc-sweep/reports/fix-air-input.md`, `review-air-input.md`).

### What the engine does

- **A seat flies on its own PCO's category (MLK-14).** Every seat is its own
  PlayerControlObject, and `PlayerControlObject::enter` makes itself the
  player's vehicle. The control map and the mouse profile (MLK-8) follow that
  seat's `setVehicleCategory`, not the hull's.
  - DC 0.7's `VCAir` co-pilots and passengers fly the Air map and profile:
    `H6CoPilot`, `MH6Passenger_PCO3..6`, `SA342CoPilot`, `SA342Passenger3/4`,
    `MH53CoPilot`, `F14BRIO`. DC Final has the same seats. Vanilla and XPack1
    have none.
  - Whether a seat needs the key is its own Camera's word (MLK-1). In DC 0.7
    the MH-6 and SA-342 benches carry it, and so does the MH-53 co-pilot, who
    sits behind the pilot's own `MH53PilotCamera`. The H-6 and SA-342
    co-pilots do not: DC commented the line out ("remmed to give freelook").
    No DC Final seat but the pilots carries it.
  - DC 0.7's `Mi8_CoPilot` is `VCLand` behind the pilot's `Mi8Camera`. The
    LandSea map binds no `c_PIMouseLook`, so that seat never looks.
- **Two slots, never a sum (MLK-9, MLK-15).** A `.con` line fills the slot it
  names, and a later line for that slot replaces it. A secondary line for a
  channel with no primary yet is refused. The larger magnitude wins, the
  primary on a tie. A key pair reads its first key when both are down.
- **The pitch sign (MLK-17).** A Camera's or RotationalBundle's pitch is the
  `setRotation` pitch, positive nose-down. `CorsairCamera`'s `-40..5` is 40
  degrees up and 5 down, and `ShermanGunBase`'s `-20..5` is 20 of elevation.
- **A still axis (MLK-18).** A look axis with no look input or no acceleration
  does not turn: the template default is 0.1 deg/s^2. XPack2's C47 pilot has
  no vertical look, DC's F-14B RIO none sideways.
- **The excess (MLK-16, GUN-2).** Under `rememberExcessInput` the tick's input
  joins a backlog held to +-40, the tick spends `clamp(backlog, +-1)`, and an
  input against the backlog is taken whole and clears it. It is spent once a
  tick (`Wing::handleUpdate`). Every shipped declaration is an
  `automaticReset` elevator on `c_PIPitch` (vanilla 24, XPack1 4, XPack2 51,
  DC 23, DC Final 6).
- **The wire (W-1, W-2).** Retail carries `c_PIYaw` and `c_PIThrottle` as
  12-bit channels in +-16, like the stick.

### What changed

- `viewer/mouse-look-key.js`:
  - `seatProfile` reads the seat PCO node's `physics.vehicleCategory`, with
    `operator>>`'s spellings. A seat that names none keeps the old rule.
  - `seatNeedsMouseLookKey` reads `cameraView.toggleMouseLook` when the glb
    carries it (the con-reader export). On older trees it proves what it
    can: the pilot, and a seat whose camera is the pilot's own template.
  - `seatLookSigns` gives the camera's own yaw and pitch direction, or 0 for
    a still axis on the Air profile. With no look rig it falls back to the
    profile's majority.
  - `describeSeat` builds the descriptor, cached per surveyed seat.
- `viewer/local-look.js`:
  - the profile, the key and the look's signs come off the seat;
  - any seat with a view of its own looks. A passenger of a driverless hull
    used to fall through to the free camera.
- `viewer/controls.js`:
  - `context()` is the seat's profile;
  - `axisIn` fills the two slots in line order and reads each off its own
    device.
- `viewer/vehicle-camera.js`: the cockpit and nose defaults are the right way
  up (40 up, 5 down). `cameraLookLimits` maps the camera's own rig
  (`cameraView.look`, else the node's `rig`) as `[-max, -min]`.
- `viewer/seat-camera.js`: hands those limits to the seat's view, and a
  passenger's view eases back as a pilot's does.
- `viewer/netcode.js` and `server/room.mjs`: the record is 17 bytes, and
  bytes 14..16 carry the rudder and throttle analogue. Byte 13 keeps their
  signs, and a 14-byte record from an older page still reads.
- `viewer/world-vehicle-tick.js`, `world-input.js` and `world.js`:
  - a ship's `c_PIPitch` is the tick's value, and the spring is gone;
  - every airframe takes its channels whole, with no fixed-wing +-1 in front
    of the hull.
- `viewer/vehicle-base.js` `advanceSurfaces`: spends a remembering servo's
  backlog on the first call of each 30 Hz tick, then clips the target at +-1.
  A drive reset drops it.

Behaviour the owner will notice:

- In a DC helicopter's back, the mouse uses the Air sensitivity and the Air
  invert box.
- W and S held together walk forward, and A and D strafe right, as retail
  does. They used to cancel.
- A joystick held against a key on the same channel reads the key's full
  step, not the difference.
- Holding Left Shift in a cockpit and pushing the mouse away looks up 40
  degrees. The old limits allowed only 5.
- An LCVP's ramp follows ArrowUp at once, with only its own servo's rate.
- A mouse flick on a vanilla elevator holds full deflection for as many ticks
  as it was past 1.

### Verification

- `test_mouse_look_key.py` (57 tests):
  - the seat rules over the real `surveyVehicle`, on DC 0.7 MH-6 and MH-53
    trees and on `tests/fixtures/air-seats.json`. That fixture is the
    con-reader export of DC 0.7's MH-6, SA-342G, MH-53, Mi8 and F-14B, DC
    Final's MH-6, XPack2's C47 and vanilla's Corsair, BF109 and B17, cut to
    the seat tree;
  - the page path through `createLocalLook`: a keyed bench looks only with
    Left Shift and eases back; a co-pilot looks freely in the plain sense; DC
    Final's bench and DC's F-14 RIO are inverted on the shipped box; the C47 has
    no vertical look and the RIO none sideways; the BF109's and B17's
    `5000` with `-90` look the Corsair's way (review, 2026-10-07: the first
    version read the acceleration's sign alone and inverted them);
  - the neck: the defaults, the camera's own rig, and a pilot pushing the
    mouse away (40 up, 5 down).
- `test_controls.py` (37 tests): the slot fill (a refused secondary, a
  replaced primary, a tie) and the owner's joystick against a key (A with the
  yaw stick at 0.18 reads -1, where it was -0.82).
- `test_netcode_client.py`, `test_room.py`: the codec round trip (0.6 and
  0.37 arrive analogue, -3.46 at its rate, 16 the ceiling), a 14-byte record
  read by its signs, and a remote pilot's -0.37 rudder and 0.6 lever reaching
  the world. An older page's 14-byte records and a current page's 17-byte ones
  share one room: both walk, each sees the other, and each word arrives at its
  own record's resolution (review).
- `test_flight.py`:
  - a flick of 3.46 for one tick spends `[-1, -1, -1, -0.46, 0]`;
  - a sign flip is taken whole; the cap leaves 39 full ticks after a held
    hand; an input inside +-1 is unchanged;
  - a reset carries nothing, and the backlog is spent once a tick at 1/60;
  - an LCVP-shaped ramp servo reaches 0.5 in 1 s and 1 in 2 s.
- `test_world_ship_pitch.py`, `test_world_air_input.py`: the ship's step, DC's
  Forklift and Ural on the same step (main's ground-chassis feeds a land hull
  whose rig binds `c_PIPitch`), and the world handing every airframe the rate
  whole. `test_ground.py` `test_the_forks_move_at_their_own_rate`: the forks
  still move at their part's `setMaxSpeed` (0.375 of full deflection a
  second), not at the key.
- In the page (`dc_lostvillage`, `~/.cache/dc-sweep/air-input-2/page_seats.cjs`),
  with no page errors:
  - the MH-6 bench, co-pilot and pilot are all on the Air profile;
  - the pilot's knock turns nothing, his held look turns, and it eases back
    to 0 within the second;
  - the co-pilot's neck is his own camera's (60 up, 45 down);
  - on today's trees the bench looks freely, since his glb has no word yet.

## Open

- **The re-bake.** The MH-6 and SA-342 benches need the key once their glbs
  carry `cameraView.toggleMouseLook`. That is the con-reader package's
  export, then a re-bake of every aircraft model and every level that places
  one. The positive cameras (DC Final's helicopter pilots and passengers,
  DC's F-14 RIO) and each camera's own neck arrive with the same bake.
- **Non-`automaticReset` parts latch in retail.** GUN-2's velocity law moves
  a part while its input is held and leaves it where it stopped. The LCVP and
  Daihatsu ramps, the subs' float trim, DC's Forklift lift and Ural ramp, the
  AC-130 ramps and XPack2's M3 GMC steering wheel are all such parts.
  `advanceSurfaces` is a position servo for all of them, so a ramp closes when
  the key is let go. The law exists (`vectored-engines.js` `clipAngleStep`).
  Moving these parts onto it touches the wheeled drive's steering read and
  needs its own drive checks.
- **Trigger slots replace too (MLK-15).** Shipped `Common.con` binds
  `c_GIToggleConsole` to Grave and then Caps Lock, both primary. The binary
  keeps only the second, but the viewer ORs every binding and keeps Grave.
  Not changed: retail's console key needs checking against the game first.
- A LandSea seat's look keeps the page's free look where its camera's rig says
  the axis is still. MLK-18 holds for those cameras too; they were left alone
  in this package.
- `countsPerPixel` (one browser pixel is one count) is still the one unproven
  unit (`bf1942-mouse-input`).
- The page never clears held keys on window blur (predates this work).
- A mouse-button binding of `c_PIMouseLook` is not read by `controls.held`.
