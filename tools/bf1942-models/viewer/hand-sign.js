// The hand sign a soldier makes when they shout, laid over their left arm.
//
// RADIO-3: a shout on foot plays the voice and then the sign. `BFSoldier::
// speakLine(int, string)` (lnxded `0x0826e220`; client `0x004feb20`) takes the
// sign's number, 0..6 (`cmpl $0x6, %ebx` at `0x0826e232`), looks the state
// `HandSign_Freeze` up by name (`0x086d1dd8`, `findState` at `0x0826e2d2`) and
// calls `AnimationStateMachineInstance::setCurrentState(index + sign)`
// (`0x0826e305`) on the instance at `this + 0x360`: the soldier's THIRD
// machine, beside the legs' and the torso's, the one the face states run on.
// So the seven signs are addressed by their declaration order in
// `AnimationStatesFace.con` (`HAND_SIGNS` below), and a sign neither enters
// nor leaves a torso state: the fire, the reload and the aim go on under it.
//
// Each is a `c_AsmPlayOnce` of `animations/3P_NoWeapon/Handsignals/
// 3pHandSign_<Name>.baf` at rate 1.0 (one second), `setMorphFactor 2.5`, then
// `addTransitionWhenDone StopDummyState`, whose `resetSkeleton` stops the
// machine writing. The clips hold 19 bones, the left arm from the clavicle to
// the fingertips, so the machine writes those and no others; every machine
// slerps a bone from where it stands toward its clip by the state's weight
// (ANIM-4), and this one runs after the torso's, so the arm drawn is
// `slerp(torso pose, sign pose, w)` with `w` rising 2.5 a second from 0.
// When the one-shot ends the torso's own write is all that is left. That it
// then cuts back rather than easing is read from the scripts (no state
// follows the sign), not watched on a client.
//
// The clips are baked into `gaits/handsign.gait.glb` under the states' own
// names (`extract_pose.py` `HANDSIGN_STATES`). This samples the one playing
// straight off its tracks, after the body's mixer and morph have posed the
// frame, because a second action on the body's mixer would be averaged with
// the torso's clip rather than laid over it.
//
// Free of `three` and of the DOM (the tracks and bones are handed in), so
// `tests/hand_sign_harness.mjs` runs the real thing under node.

/** The signs in the engine's order: `speakLine`'s number is the index. */
export const HAND_SIGNS = Object.freeze([
  'Freeze', 'Come', 'Medic', 'Shout', 'Down', 'Roger', 'Negative',
]);

/** `setMorphFactor 2.5` on all seven (`AnimationStatesFace.con`). */
export const HAND_SIGN_MORPH = 2.5;

/** The state a sign's name or number is, or null: `'Medic'`, `2` and
 *  `'HandSign_Medic'` are all `HandSign_Medic`. */
export function handSignState(sign) {
  if (Number.isInteger(sign)) return HAND_SIGNS[sign] ? `HandSign_${HAND_SIGNS[sign]}` : null;
  if (typeof sign !== 'string' || !sign) return null;
  const name = sign.replace(/^HandSign_/i, '').toLowerCase();
  const found = HAND_SIGNS.find(s => s.toLowerCase() === name);
  return found ? `HandSign_${found}` : null;
}

/** Whether `name` is one of the bundle's sign clips (kept off a body's mixer). */
export function isHandSignClip(name) {
  return typeof name === 'string' && /^HandSign_/i.test(name);
}

/**
 * One body's sign machine.
 *
 * `clips` are the body's clips (three `AnimationClip`s, or `{ name, duration,
 * tracks, userData }` under node); the `HandSign_*` ones are kept. `findBone`
 * answers a track's node name with the bone (`{ quaternion, position }`).
 * Call `play(sign)` on the shout, `restore()` once a frame BEFORE the body's
 * mixer and `update(dt)` AFTER its mixer and morph: it writes the sign's
 * bones over what they drew.
 * It costs nothing while no sign plays, and 19 slerps a frame while one does.
 */
export class HandSignOverlay {
  constructor(clips, findBone) {
    this.findBone = findBone;
    this.clips = new Map();
    for (const clip of clips ?? []) {
      if (isHandSignClip(clip?.name) && !this.clips.has(clip.name)) this.clips.set(clip.name, clip);
    }
    this.bound = new Map();
    this.current = null;
    /** The tracks whose bones hold the sign's pose, until `restore`. */
    this.worn = null;
  }

  has(sign) {
    const name = handSignState(sign);
    return !!name && this.clips.has(name);
  }

  get playing() { return this.current?.name ?? null; }

  /** Start `sign` from its first frame; a sign already playing is replaced,
   *  as `setCurrentState` replaces the machine's state. False when the tree
   *  bakes no such clip. */
  play(sign) {
    const name = handSignState(sign);
    const clip = name ? this.clips.get(name) : null;
    if (!clip) return false;
    const info = clip.userData ?? {};
    const speed = Number.isFinite(info.speed) && info.speed !== 0 ? Math.abs(info.speed) : 1;
    const morph = Number.isFinite(info.morph) ? info.morph : HAND_SIGN_MORPH;
    this.current = {
      name, tracks: this.bind(clip),
      time: 0, seconds: 1 / speed, clipSeconds: clip.duration,
      w: morph > 1000 ? 1 : 0, morph, fresh: true,
    };
    return true;
  }

  stop() { this.current = null; }

  bind(clip) {
    let tracks = this.bound.get(clip.name);
    if (tracks) return tracks;
    tracks = [];
    for (const track of clip.tracks ?? []) {
      const dot = track.name.lastIndexOf('.');
      const bone = this.findBone(track.name.slice(0, dot));
      const property = track.name.slice(dot + 1);
      if (!bone || (property !== 'quaternion' && property !== 'position')) continue;
      tracks.push({ bone, property, interpolant: track.createInterpolant(),
                    saved: new Float64Array(property === 'quaternion' ? 4 : 3) });
    }
    this.bound.set(clip.name, tracks);
    return tracks;
  }

  /**
   * Before the body's mixer: what the body drew back on the bones the last
   * `update` wrote over. three's `PropertyMixer.apply` writes a bone only
   * when its value changed since it last wrote it, so a bone the torso's clip
   * holds still would otherwise keep the sign's pose, and the next frame
   * would slerp from the sign instead of from the torso (the fault
   * `MorphBlend.restore` exists for).
   */
  restore() {
    const tracks = this.worn;
    if (!tracks) return;
    this.worn = null;
    for (const { bone, property, saved } of tracks) {
      if (property === 'quaternion') setQuaternion(bone.quaternion, saved[0], saved[1], saved[2], saved[3]);
      else { bone.position.x = saved[0]; bone.position.y = saved[1]; bone.position.z = saved[2]; }
    }
  }

  /** One frame. Returns the playing state's name, or null. */
  update(dt) {
    const s = this.current;
    if (!s) return null;
    // The weight is 0 on the frame the state is entered and gains `dt x
    // morph` a frame after (ANIM-4), as the body's own morph does.
    if (s.fresh) s.fresh = false;
    else {
      s.time += Math.max(0, dt);
      s.w = Math.min(1, s.w + Math.max(0, dt) * s.morph);
    }
    // `AnimationState::update`: the one-shot is over when its phase passes 1.
    if (s.time >= s.seconds - 1e-9) { this.current = null; return null; }
    const t = (s.time / s.seconds) * s.clipSeconds;
    this.worn = s.tracks;
    for (const { bone, property, interpolant, saved } of s.tracks) {
      const v = interpolant.evaluate(t);
      if (property === 'quaternion') {
        const q = bone.quaternion;
        saved[0] = q.x; saved[1] = q.y; saved[2] = q.z; saved[3] = q.w;
        slerpTo(q, v[0], v[1], v[2], v[3], s.w);
      } else {
        const p = bone.position;
        saved[0] = p.x; saved[1] = p.y; saved[2] = p.z;
        p.x += (v[0] - p.x) * s.w; p.y += (v[1] - p.y) * s.w; p.z += (v[2] - p.z) * s.w;
      }
    }
    return s.name;
  }
}

/** `q = slerp(q, to, t)`, the short way round. */
function slerpTo(q, tx, ty, tz, tw, t) {
  const fx = q.x, fy = q.y, fz = q.z, fw = q.w;
  let cos = fx * tx + fy * ty + fz * tz + fw * tw;
  if (cos < 0) { tx = -tx; ty = -ty; tz = -tz; tw = -tw; cos = -cos; }
  let a, b;
  if (cos > 0.9995) { a = 1 - t; b = t; }
  else {
    const theta = Math.acos(Math.min(1, cos));
    const sin = Math.sin(theta);
    a = Math.sin((1 - t) * theta) / sin;
    b = Math.sin(t * theta) / sin;
  }
  let x = fx * a + tx * b, y = fy * a + ty * b, z = fz * a + tz * b, w = fw * a + tw * b;
  const len = Math.hypot(x, y, z, w) || 1;
  x /= len; y /= len; z /= len; w /= len;
  setQuaternion(q, x, y, z, w);
}

function setQuaternion(q, x, y, z, w) {
  if (typeof q.set === 'function') q.set(x, y, z, w);
  else { q.x = x; q.y = y; q.z = z; q.w = w; }
}
