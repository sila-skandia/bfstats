// The mouse-look key: `c_PIMouseLook`, held to look around from a pilot's seat.
//
// Framework-free: no three.js, no DOM, so it runs unchanged under node
// (`tests/test_mouse_look_key.py`). The page's half -- which seat, which key,
// where the camera is posed -- is a few lines in `local-look.js`,
// `seat-camera.js` and `local-player.js`.
//
// In retail BF1942 a pilot's mouse does not look around. The shipped Air map
// binds the mouse twice: to the stick (`c_PIPitch IDFMouse IDAxis_1`,
// `c_PIRoll IDFMouse IDAxis_0`) and to the look axes (`c_PIMouseLookX/Y`), and
// one push-and-hold trigger decides which of the two a tick's input reaches:
// `c_PIMouseLook`, Left Shift (`Settings/Default/Controls/Air.con:21`, and the
// same line in `Settings/Profiles/Default/Controls/Air.con`). No other shipped
// map binds it. The viewer never flew the plane on the mouse and still does
// not; what it takes from the engine is the gate, the recentre, and what
// holding the key costs the stick. features/pilot-mouse-look has the whole
// read; the addresses are here so the numbers below can be re-derived.
//
// THE CAMERA WORD. `ObjectTemplate.toggleMouseLook` is a byte on the Camera
// template: lnxded `CameraTemplate+0x1c2`, seeded 0 by the constructor
// (0x081acc20) and written back by `makeScript` (0x081acd60) as the literal
// `ObjectTemplate.toggleMouseLook 1` (0x086c5120) when set; client `+0x272`
// (constructor 0x00564f30, `makeScript` twin 0x005646a6).
// `Camera::getToggleMouseLook` (lnxded 0x081acaf0, client 0x00564610) returns
// it; `FreeCamera`'s returns 0 (0x081b1f00).
//
// THE ROUTER. `BFPlayer::handleInput` (lnxded 0x08052530, client 0x00407ec0),
// once a tick per player (`GameServer::simulatePlayerUpdate` 0x0815bebc). For
// a player in a vehicle whose camera answers `getToggleMouseLook()` (ICamera
// slot +0x40 in both binaries) it copies the input and, before the vehicle's
// own `handlePlayerInput` sees it, zeroes
//
//     key held      c_PIYaw, c_PIPitch, c_PIRoll       (channels 0, 1, 2)
//     key released  c_PIMouseLookX, c_PIMouseLookY     (channels 4, 5)
//
// "Held" is the channel's mapped bit and a value above 0.5 (lnxded
// `ds:0x86b05e8`; client `PlayerInput` helper 0x00407d60, `[0x008c4220]`).
//
// THE CAMERA. `Camera::handlePlayerInput` (lnxded 0x081aa490, client
// 0x00564af0) runs the same test on the same channel. Released, with the word
// set, it zeroes the look's speed and input registers and multiplies its
// angles by 0.75 (lnxded `ds:0x86ba8cc`, client `[0x008d1e28]`) -- every
// tick, 30 a second -- then rebuilds the transform: the view eases back to
// straight ahead, half the way in 80 ms. Held, or without the word, it is an
// ordinary RotationalBundle. Neither function reads the view mode, so the rule
// is the same inside the cockpit and out of it.
//
// WHICH SEATS. The word is per Camera template. Read out of the shipped
// `Objects.rfa` (vanilla, XPack1, XPack2) it sits on exactly the aircraft
// pilots' cameras -- 13 vanilla, 2 Road to Rome, 7 Secret Weapons -- each the
// Camera of a `setVehicleCategory VCAir` PlayerControlObject, and on none of
// the gunners' (B17_Camera2/3, StukaRearCamera, the `_For_PCO1` rear seats:
// all VCLand, all free to look). The extracted trees do not carry the word
// (`assemble.py` writes `cameraView` without it), so the viewer applies the
// shipped data's own rule: the pilot's seat of an aircraft, i.e. the root seat
// of a hull the viewer classifies `air`. A ship shares the aircraft's drive
// class and is not `air`; a gunner's seat is never the root.

/** The trigger the profile binds the key to (Air.con only, in shipped data). */
export const MOUSE_LOOK_TRIGGER = 'c_PIMouseLook';

/**
 * `PlayerInputMap` id of `c_PIMouseLook`: the twelfth name of the table at
 * lnxded 0x086c86a5 (`c_PIYaw` 0 ... `c_PIUse` 10, `c_PIMouseLook` 11 at
 * 0x086c871f), the bit both binaries test (`shrd $0xb`, `and 0x800`) and the
 * float they read (`PlayerInput+0x2c`).
 */
export const MOUSE_LOOK_CHANNEL = 11;

/** A trigger channel counts as held above this. lnxded `ds:0x86b05e8`,
 *  client `[0x008c4220]`. */
export const HELD_THRESHOLD = 0.5;

/** What a released look keeps of its angle each tick. lnxded `ds:0x86ba8cc`
 *  = 0x3f400000, client `[0x008d1e28]`. */
export const RECENTRE_PER_TICK = 0.75;

/** The tick the 0.75 is spent on: `g_simulationFps`, lnxded 0x08716b5c. */
export const TICK_HZ = 30;

/**
 * Below this a released look is put exactly at rest, in radians (about six
 * hundred-thousandths of a degree). The engine's float gets there by
 * underflow after a dozen seconds; a double would take thousands of ticks,
 * and nothing that small is visible.
 */
export const LOOK_REST = 1e-6;

/**
 * Does this seat's camera need the key to look around -- the engine's
 * `getToggleMouseLook()`, answered by the shipped data's rule (header).
 *
 * @param {{rootKind?: string, root?: boolean} | null} seat
 *   `rootKind` the hull's classification, `root` whether the seat taken is
 *   the hull's root seat (the pilot's).
 */
export function seatNeedsMouseLookKey(seat) {
  return !!seat && seat.rootKind === 'air' && seat.root === true;
}

/**
 * The fraction of a look angle still standing `dt` seconds after the key
 * went up: 0.75 a tick, 30 ticks a second. Exactly 0.75 at one tick and
 * exactly the engine's value at every tick boundary; smooth in between,
 * because the page draws between ticks rather than on them (rule 8,
 * `local-look.js`).
 */
export function recentreFactor(dt) {
  if (!(dt > 0)) return 1;
  return RECENTRE_PER_TICK ** (TICK_HZ * dt);
}

/**
 * Ease a `{ yaw, pitch }` look back toward straight ahead, in place, for
 * `dt` seconds of a released key.
 */
export function recentreLook(look, dt) {
  if (!look) return look;
  const k = recentreFactor(dt);
  look.yaw = Math.abs(look.yaw * k) < LOOK_REST ? 0 : look.yaw * k;
  look.pitch = Math.abs(look.pitch * k) < LOOK_REST ? 0 : look.pitch * k;
  return look;
}

/**
 * The router's held branch on the page's input word: while the look is held
 * the rudder (`c_PIYaw`) and the stick (`c_PIPitch`, `c_PIRoll`) read zero,
 * whatever device they come from, and the throttle and the triggers are
 * untouched. The touch pad's roll and pitch (`pad`) are the page's own
 * override, outside the control map, and are left alone. Returns the word.
 */
export function routeFlightInput(input, held) {
  if (!held || !input) return input;
  input.rudder = 0;
  if (!input.pad) {
    input.roll = 0;
    input.pitch = 0;
  }
  return input;
}
