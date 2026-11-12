// How the game pans a voice that has a place in the world, and how the page
// gets a Web Audio panner to do the same. Imports nothing.
//
// The client keeps a pool of DirectSound voices of three kinds (the pool's
// builder, BF1942.exe 0x007fb640, and the buffer it makes, 0x007fe440; ledger
// SND-30): mono 2D, stereo 2D, and mono 3D. A `.ssc` layer that says `stereo`
// plays on a 2D voice (the word clears the description's 3D byte, 0x007ffc60),
// every other layer on a 3D one. A 3D voice is made with DSBCAPS_CTRL3D and
// the algorithm DS3DALG_NO_VIRTUALIZATION, the only 3D algorithm GUID in the
// binary (0x00947d5c): no HRTF, no head, "3-D output is mapped onto normal
// left and right stereo panning" (the DirectSound documentation), and "the
// vertical axis is ignored except for scaling of volume due to distance".
//
// So a gun a metre to one side of the camera is never in one ear only. The
// page used to give every such voice an HRTF PannerNode, whose head shadow at
// a wide angle leaves the far ear dull and a long way down, and the report was
// "the tank's machine gun plays out of one speaker". Forgotten Hope's coaxial
// guns hand over from their `stereo` layer to their 3D one at 1 m, and the
// driver's eye is 1.02 to 1.57 m from them, well off to one side
// (features/sound-mix-parity, "The pan").
//
// The pan law itself is DirectSound's, not the game's. What the owner's copy
// runs on is Wine's (`dlls/dsound/sound3d.c`, `DSOUND_Calc3DBuffer`, on a
// stereo device whose two speakers `dsound.c` stands at -90 and +90 degrees):
//
//   lambda = the angle between the voice's direction and the listener's
//            median plane (front x top), -90 (hard left) .. +90 degrees,
//            a voice behind mirrored to the front
//   a      = (lambda + 90) / 180
//   left   = sqrt(1 - a)        right = sqrt(a)
//
// Equal power, full to one side only at exactly 90 degrees, and a voice at
// the listener's own point (an attached one, SND-4) at a = 0.5: 0.707 a side.
//
// Web Audio's `equalpower` panner is the same idea on another curve
// (`cos(x pi/2)` and `sin(x pi/2)` of the horizontal azimuth), up to 5 dB
// wider at a wide angle. `ds3dRenderPoint` closes that: it answers the point,
// in front of the listener, whose Web Audio azimuth yields DirectSound's two
// gains for the voice's real place. `sin(x pi/2) = sqrt(a)` solves to an
// azimuth of `asin(2 lambda / pi)`.
//
// Remaster mode (`?remaster`) is the one exception to "never a head": it
// installs `remaster-audio.js` as the spatial hook below, and every placed
// voice then pans the way a modern game's does. The retail build never sets it.

/** The panning model every placed voice of the page uses by default: the
 *  software path, `game.setHardware 0`, which every shipped profile writes. */
export const DS3D_PANNING_MODEL = 'equalpower';

// OPTIONS > SOUND > HARDWARE ACCELERATION (`game.setHardware 1`, ledger
// SND-41). With it the client makes every pool voice with
// DSBCAPS_LOCHARDWARE instead of DSBCAPS_LOCSOFTWARE (0x007fe4d9..0x007fe4f5),
// and a hardware buffer is rendered by the card's own 3D engine:
// `guid3DAlgorithm` applies to software buffers only, so the
// NO_VIRTUALIZATION the game asks for is not what a Sound Blaster Live! or
// Audigy played. Those cards placed a 3D voice in the listener's head
// (Creative's HRTF on headphones and two speakers, its own multi-speaker
// placement on four or more), height included. The browser's stand-in for
// that path is Web Audio's HRTF panner at the voice's real point. It is a
// stand-in, not the card: which HRTF, and how loud the far ear, is the
// browser's (Chromium's IRCAM set), not Creative's. Off unless the player
// ticks it (`sound-options.js`).
export const DS3D_HARDWARE_PANNING_MODEL = 'HRTF';

let hardware3d = false;

// `Sound.dopplerFactor` (ledger SND-45): the client hands it unchanged to
// `IDirectSound3DListener::SetDopplerFactor` (0x00537300 stores 0x00958294,
// 1.0 at start-up, and calls the listener wrapper's slot +0x4, 0x00663cb0,
// which calls the interface's +0x30 deferred), so it means what DirectSound
// says: a multiple of the real world's shift, 0 none, 1 real, at most 10
// (DS3D_MAXDOPPLERFACTOR; a value outside 0..10 DirectSound refuses, and the
// voices keep the last one it took). `engine-audio.js` multiplies the radial
// speed its doppler shift is made from by it.
let dopplerStored = 1;
let dopplerApplied = 1;

/** `Sound.dopplerFactor` as last written (what the console reads back). */
export function ds3dDopplerFactor() { return dopplerStored; }

/** The factor the voices are shifted by: the last one in 0..10. */
export function ds3dDopplerApplied() { return dopplerApplied; }

/** Write `Sound.dopplerFactor`. Returns the factor the voices now use. */
export function setDs3dDopplerFactor(value) {
  const v = Number(value);
  if (!Number.isFinite(v)) return dopplerApplied;
  dopplerStored = v;
  if (v >= 0 && v <= 10) dopplerApplied = v;
  return dopplerApplied;
}
// Every panner `configureDs3dPanner` set up, so a change of the setting
// reaches the voices already playing. Weak: a finished one-shot's panner is
// not kept alive by being listed here.
const configured = new Set();
const canWeak = typeof WeakRef === 'function';

/** Whether placed voices take the hardware path (an HRTF head at their own
 *  point) instead of DirectSound's software amplitude pan. */
export function ds3dHardware() { return hardware3d; }

/** The panning model a placed voice gets now. */
export function ds3dPanningModel() {
  return hardware3d || spatialHook ? DS3D_HARDWARE_PANNING_MODEL : DS3D_PANNING_MODEL;
}

// The remaster's spatial chain (`remaster-audio.js`, features/remaster-browser),
// installed only under `?remaster`. Null in the retail build, and then nothing
// below behaves differently. Set, every placed voice takes the hardware path
// (an HRTF head at its real point) and is handed to the hook's `adopt`, which
// puts air absorption, occlusion and a reverb send behind the panner.
let spatialHook = null;

/** The installed spatial chain, or null (the retail build). */
export function ds3dSpatialHook() { return spatialHook; }

/** Install (or with null, remove) the spatial chain. Panners already
 *  configured take the new panning model where they stand. */
export function setDs3dSpatialHook(hook) {
  spatialHook = hook || null;
  setDs3dHardware(hardware3d);
  return spatialHook;
}

/**
 * Switch the page between the two paths. Panners already made are switched
 * where they stand; a voice that `ds3dRenderPoint` places moves to its real
 * point (or back to its render point) on its next frame. Returns the setting.
 */
export function setDs3dHardware(on) {
  hardware3d = Boolean(on);
  const model = ds3dPanningModel();
  for (const ref of [...configured]) {
    const panner = canWeak ? ref.deref() : ref;
    if (!panner) { configured.delete(ref); continue; }
    try { panner.panningModel = model; } catch (_) { configured.delete(ref); }
  }
  return hardware3d;
}

// The size at which the list is next swept of collected panners. Doubled
// past what a sweep leaves, so the sweeps cost a constant per panner however
// many stay alive.
let sweepAt = 512;

function remember(panner) {
  if (configured.size >= sweepAt) {
    if (canWeak) for (const ref of configured) if (!ref.deref()) configured.delete(ref);
    sweepAt = Math.max(512, configured.size * 2);
  }
  configured.add(canWeak ? new WeakRef(panner) : panner);
}

// How far out a render point stands when the caller's panner has no distance
// curve of its own to keep (`engine-audio.js` turns its panners' rolloff off).
// Far enough that a frame of listener travel cannot swing it off its bearing.
export const DS3D_RENDER_RADIUS = 10;

const HALF_PI = Math.PI / 2;
const clampUnit = v => (v < -1 ? -1 : v > 1 ? 1 : v);

/**
 * DirectSound's pan position for a voice whose direction makes `sinLateral`
 * with the listener's right (the sine of its angle off the median plane):
 * 0 hard left, 0.5 centre, 1 hard right.
 */
export function ds3dPanAmount(sinLateral) {
  const s = Number.isFinite(sinLateral) ? clampUnit(sinLateral) : 0;
  return (Math.asin(s) + HALF_PI) / Math.PI;
}

/** The two channel gains DirectSound gives a mono 3D voice there. */
export function ds3dGains(sinLateral) {
  const a = ds3dPanAmount(sinLateral);
  return { left: Math.sqrt(1 - a), right: Math.sqrt(a) };
}

/**
 * The azimuth, in radians right of dead ahead, at which a Web Audio
 * `equalpower` panner with a mono input produces `ds3dGains(sinLateral)`.
 */
export function ds3dRenderAzimuth(sinLateral) {
  const s = Number.isFinite(sinLateral) ? clampUnit(sinLateral) : 0;
  return Math.asin(clampUnit(Math.asin(s) / HALF_PI));
}

/**
 * Make a PannerNode pan as a DirectSound 3D voice does: amplitude only, and
 * from one channel, because a 3D voice is a mono buffer (0x007fe440 builds it
 * with one channel) and Web Audio pans a two-channel input by another rule.
 * Leaves the distance model alone. Safe on a test double.
 */
export function configureDs3dPanner(panner) {
  if (!panner) return panner;
  panner.panningModel = ds3dPanningModel();
  remember(panner);
  try {
    panner.channelCount = 1;
    panner.channelCountMode = 'explicit';
  } catch (_) { /* a node that will not take it pans what it is given */ }
  spatialHook?.adopt?.(panner);
  return panner;
}

/**
 * Where to stand a `configureDs3dPanner` panner so it sounds as DirectSound
 * would pan a voice at world (x, y, z).
 *
 * `m` is the listener's world matrix, column-major as three.js keeps it
 * (`AudioListener.matrixWorld.elements`): right, up, back, position. The
 * point is written to `out` ({x, y, z}) and returned: in the listener's
 * horizontal plane, in front, at `radius` metres, or at the voice's own
 * distance when `radius` is null so a panner's own distance curve still reads
 * true. Returns null, and leaves `out` alone, when there is no matrix to read
 * or a number is missing: the caller then stands the panner at the real point.
 */
export function ds3dRenderPoint(m, x, y, z, out = {}, radius = DS3D_RENDER_RADIUS) {
  if (!m || m.length < 15) return null;
  const px = m[12], py = m[13], pz = m[14];
  const vx = x - px, vy = y - py, vz = z - pz;
  let rx = m[0], ry = m[1], rz = m[2];
  let fx = -m[8], fy = -m[9], fz = -m[10];
  const rl = Math.hypot(rx, ry, rz), fl = Math.hypot(fx, fy, fz);
  const d = Math.hypot(vx, vy, vz);
  if (!(rl > 0) || !(fl > 0) || !Number.isFinite(d)) return null;
  // The hardware path pans from the voice's own point, height and all: the
  // card's 3D engine was handed the true position (SetPosition), and an HRTF
  // panner reads its direction from where it stands.
  if (hardware3d || spatialHook) {
    out.x = x; out.y = y; out.z = z;
    return out;
  }
  rx /= rl; ry /= rl; rz /= rl;
  fx /= fl; fy /= fl; fz /= fl;
  // A voice at the listener's own point has no side (Wine tests the vector
  // for zero and takes the angle as 0): dead ahead.
  const sinLateral = d > 1e-6 ? (vx * rx + vy * ry + vz * rz) / d : 0;
  const azimuth = ds3dRenderAzimuth(sinLateral);
  const r = radius == null ? Math.max(d, 1e-3) : radius;
  const s = Math.sin(azimuth) * r, c = Math.cos(azimuth) * r;
  out.x = px + rx * s + fx * c;
  out.y = py + ry * s + fy * c;
  out.z = pz + rz * s + fz * c;
  return out;
}

/**
 * A one-shot's panner, made and stood once: `configureDs3dPanner`, then at
 * the render point for a voice at world (x, y, z), kept at the voice's own
 * distance so the panner's distance curve reads as it would at the real
 * point. A point fixed for the life of a short sample: the listener turning
 * under it still moves it the right way. Without a listener pose it stands at
 * the real point.
 */
export function standDs3dPanner(panner, listenerMatrix, x, y, z) {
  configureDs3dPanner(panner);
  const at = ds3dRenderPoint(listenerMatrix, x, y, z, {}, null) || { x, y, z };
  if (panner.positionX) {
    panner.positionX.value = at.x;
    panner.positionY.value = at.y;
    panner.positionZ.value = at.z;
  } else {
    panner.setPosition?.(at.x, at.y, at.z);
  }
  return panner;
}
