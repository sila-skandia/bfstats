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
// map binds it. With the key up the mouse flies the aircraft: the same device
// rate the look would have had (mouse-input.js, Air profile, `5 x 0.75 + 0.1`
// = 3.85, its Y inverted by `game.setAirMouseInvert 1`) is the stick's
// `c_PIRoll` and `c_PIPitch`, through whatever the profile's Air map binds
// (`controls.js` `axis(trigger, mouse)`). Held, the stick is let go and the
// head turns. features/pilot-mouse-look has the whole read; the addresses are
// here so the numbers below can be re-derived.
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
// all VCLand, all free to look). Desert Combat puts it on passengers too: the
// MH-6's and the SA-342's passenger cameras, and the MH-53 co-pilot's, which is
// the pilot's own `MH53PilotCamera` (ledger MLK-14). A glb baked with the
// word carries it as `cameraView.toggleMouseLook`, and the seat's camera
// answers for itself. A tree baked before that carries nothing, and the viewer
// falls back to the shipped data's rule -- the root seat of a hull the viewer
// classifies `air` -- plus the one thing such a tree can still prove: a seat
// whose camera is the pilot's own template (the same node name) has the
// pilot's byte. A ship shares the aircraft's drive class and is not `air`.
//
// WHICH MAP. A seat is its own PlayerControlObject, and entering it makes it
// the player's vehicle (`PlayerControlObject::enter` lnxded 0x08316f00 calls
// `setVehicle(this)` at 0x08317035), so the control map and the mouse profile
// follow the seat's own `setVehicleCategory`, not the hull's (MLK-14, MLK-8):
// DC's `VCAir` co-pilots and passengers fly the Air map, Left Shift and all,
// on the Air sensitivity and the Air invert box. The glb carries the category
// on each seat's PCO node (`physics.vehicleCategory`).

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
 * `getToggleMouseLook()`: the camera's own word when its glb carries it, else
 * the shipped data's rule (header).
 *
 * @param {{rootKind?: string, root?: boolean, cameraView?: object | null,
 *   cameraKey?: string | null, rootCameraKey?: string | null} | null} seat
 *   `rootKind` the hull's classification, `root` whether the seat taken is
 *   the hull's root seat (the pilot's), `cameraView` the seat camera's extras,
 *   `cameraKey`/`rootCameraKey` the bare node names of the seat's camera and
 *   the root seat's (`describeSeat`).
 */
export function seatNeedsMouseLookKey(seat) {
  if (!seat) return false;
  const word = seat.cameraView?.toggleMouseLook;
  if (typeof word === 'boolean') return word;
  if (seat.rootKind !== 'air') return false;
  if (seat.root === true) return true;
  // The same Camera template as the pilot's is the same byte (MLK-1): DC's
  // `MH53CoPilot` sits behind `MH53PilotCamera` itself.
  return !!seat.cameraKey && seat.cameraKey === seat.rootCameraKey;
}

/** `VehicleCategory` as `operator>>` reads the word (lnxded 0x0829b580):
 *  VCLand/Land 0, VCSea/Sea 1, VCAir/Air 2; any other spelling is 3. */
const CATEGORY_PROFILE = Object.freeze({
  vcland: 'landSea', land: 'landSea', vcsea: 'landSea', sea: 'landSea',
  vcair: 'air', air: 'air',
});

/**
 * The control map and mouse profile a seat flies on: its own PCO's category
 * (MLK-14). 0 and 1 pick LandSea, 2 Air, and 3 -- a word `operator>>` did not
 * know -- changes nothing, so the soldier's Infantry map stays (`mouse-input.js`
 * `profileFor` has the client read). A seat that names no category (a stub
 * with no seat table, or a PCO node without the word) keeps the rule the page
 * always used, the pilot of an `air` hull on Air and everything else on
 * LandSea.
 *
 * @returns {'air' | 'landSea' | 'infantry'}
 */
export function seatProfile(seat) {
  if (!seat) return 'infantry';
  const category = seat.vehicleCategory;
  if (typeof category === 'string' && category) {
    return CATEGORY_PROFILE[category.toLowerCase()] ?? 'infantry';
  }
  return seat.rootKind === 'air' && seat.root === true ? 'air' : 'landSea';
}

/**
 * Which way the seat camera's pitch turns for a positive `c_PIMouseLookY`:
 * the sign of its `setAcceleration` pitch (GUN-2, MLK-13). Read off the
 * camera's own look rig, which a glb baked with the word carries as
 * `cameraView.look` and an older one only where the Camera had children of
 * its own (`rig`, DC's `H6CoPilotCamera`). Unread, it is the shipped majority
 * of the profile: negative on Air (every vanilla pilot camera but five, 23 of
 * DC's 24, every DC 0.7 co-pilot and passenger), positive on LandSea (46 of 50
 * vanilla look cameras).
 */
export function seatLookPitchSign(seat, profile = seatProfile(seat)) {
  const axis = seat?.cameraView?.look?.axes?.pitch ?? seat?.cameraRig?.axes?.pitch;
  const direction = Number(axis?.direction);
  if (direction === 1 || direction === -1) return direction;
  return profile === 'air' ? -1 : 1;
}

/** A node's name without the scene document's duplicate-instance suffix. */
function nodeKey(node) {
  const name = node?.name;
  return name ? String(name).toLowerCase().replace(/_\d+$/, '') : null;
}

const SEAT_CACHE = new WeakMap();

/**
 * What the rules above read about the seat an occupancy holds (a
 * `SeatHandle`, `vehicle-instance.js`): the hull's kind, whether it is the
 * root seat, the seat PCO's category, and its camera. Cached per surveyed
 * seat, whose node and camera never change. An occupancy without a seat table
 * (a test's stub) gets `rootKind` and `root` alone.
 */
export function describeSeat(occupancy) {
  if (!occupancy) return null;
  const id = occupancy.activeSeatId ?? occupancy.seatId;
  const info = typeof occupancy.seatInfo === 'function' ? occupancy.seatInfo(id) : null;
  const root = typeof occupancy.isActiveRoot === 'function' ? occupancy.isActiveRoot() : undefined;
  if (!info) return { rootKind: occupancy.rootKind, root };
  const cached = SEAT_CACHE.get(info);
  if (cached && cached.rootKind === occupancy.rootKind && cached.root === root) return cached;
  const rootInfo = occupancy.rootId != null ? occupancy.seatInfo(occupancy.rootId) : null;
  const camera = info.camera ?? null;
  const described = {
    rootKind: occupancy.rootKind,
    root,
    // The node's own word first: the survey reads it when it first meets the
    // seat, which can be through a child before the PCO node itself.
    vehicleCategory: info.node?.userData?.physics?.vehicleCategory ?? info.vehicleCategory ?? null,
    cameraView: camera?.userData?.cameraView ?? null,
    cameraRig: camera?.userData?.rig ?? null,
    cameraKey: nodeKey(camera),
    rootCameraKey: nodeKey(rootInfo?.camera),
  };
  SEAT_CACHE.set(info, described);
  return described;
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

/**
 * The router's released branch on the look pair: with the key up the tick's
 * `c_PIMouseLookX/Y` (channels 4 and 5) read zero, so the counts the mouse
 * sent fly the aircraft and turn nothing (`BFPlayer::handleInput` lnxded
 * 0x08052674 onward, client `[ESP+0x20]`/`[+0x24]` under mask bits 0x10/0x20).
 * Held, the pair is the look's and is left alone. Returns the pair.
 */
export function routeLookPair(look, held) {
  if (held || !look) return look;
  look.x = 0;
  look.y = 0;
  return look;
}
