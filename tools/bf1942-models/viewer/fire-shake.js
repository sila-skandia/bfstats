// The upper body's camera shake: the weapon's fire kick and the sniper's aim
// sway, from the `setCameraShake*` lines on its `Ub_*` states (ledger CS-1..
// CS-11). `extract_viewmodel.py` writes each clip family's shake into the
// viewmodel glb (`clips.<family>.cameraShake`, one block per slot); this is
// the engine's per-instance law over those blocks, and the move it puts on the
// drawn view.
//
// What the engine does, in one place (the rows have the addresses):
//
//   - A state's shake runs from the moment the upper machine enters it.
//     `setCurrentState` restarts it only for a state unlike the current one, so
//     an automatic's fire loop shakes once a burst, and a one-shot fire state
//     shakes each time it is entered anew (CS-9).
//   - Each frame: `t += dt`; the factor fades in at `fadeIn` a second (or snaps
//     to 1 with none), then fades out at `fadeOut` a second (or holds at 1 with
//     none), floored at `minFactor`; once it is under 0.001 the next slot
//     starts, and a slot with no block ends the shake (CS-3, CS-8).
//   - Each channel is `amplitude * factor * sin(rate * t)`: three turns in
//     degrees, pitch then yaw then roll, and three moves in metres, in the
//     camera's own frame (CS-1, CS-4, CS-11). The upper machine's factor is the
//     hard-coded 1.0 (CS-6).
//   - The camera's drawn view rides it; the camera's absolute transform, which
//     launches the rounds (XHIT-12), does not (CS-11).

import * as THREE from 'three';

/** `setCurrentState`'s timer sentinel (lnxded 0x0832b150 writes -20.0). */
const TIMER_UNSET = -20;

/** One `AnimationStateMachineInstance`'s shake: `getCameraShakeTransform`
 *  (lnxded 0x0832b6c0, client 0x00613e90) over the current state's blocks. */
export class CameraShake {
  constructor() {
    this.key = null;        // the state it is in, as the caller names it
    this.slots = null;      // that state's blocks, or null: no shake
    this.t = 0;             // +0x08, seconds
    this.timer = TIMER_UNSET; // +0x0c, `timeToShake`'s countdown
    this.factor = 0;        // +0x10
    this.fadingIn = true;   // +0x14
    this.slot = -1;         // +0x15, -1 once the shake has ended
  }

  /**
   * The machine enters a state (`setCurrentState`): the timer sentinel is
   * written whatever happens, and only a state unlike the current one starts
   * its shake again, from slot 0 and a factor of 0. The seconds clock is not
   * reset here; it went back to 0 when the last shake ended. Answers whether
   * the shake restarted.
   */
  enter(key, slots) {
    this.timer = TIMER_UNSET;
    if (key === this.key) return false;
    this.key = key;
    this.slots = Array.isArray(slots) && slots.length ? slots : null;
    this.factor = 0;
    this.fadingIn = true;
    this.slot = 0;
    return true;
  }

  /**
   * One frame of `getCameraShakeTransform`: the six channels into `out`
   * (`pitch`, `yaw`, `roll` degrees; `x` left-right, `y` up-down, `z` in-out
   * metres, the engine's own axes: x right, y up, z forward). Answers false,
   * with every channel 0, when there is no shake this frame.
   */
  update(dt, out = {}) {
    out.pitch = 0; out.yaw = 0; out.roll = 0; out.x = 0; out.y = 0; out.z = 0;
    if (this.slot < 0) return false;
    const block = this.slots?.[this.slot] ?? null;
    if (!block) {
      // No block in this slot (or a state with none): the shake is over, and
      // its clock goes back to 0 for the next one.
      this.t = 0;
      this.timer = TIMER_UNSET;
      this.slot = -1;
      return false;
    }
    const limit = block.timeToShake || 0;
    if (limit > 0 && this.timer < -10) this.timer = limit;
    this.timer -= dt;
    this.t += dt;
    if (limit > 0 && !(this.timer > 0)) {
      // `reset(0)`: the machine is put back in its first state, which carries
      // no shake. Only the stationary-gun trigger states set a time.
      this.key = null;
      this.slots = null;
      this.t = 0;
      this.slot = -1;
      return false;
    }
    if (this.fadingIn) {
      const rate = block.fadeIn || 0;
      this.factor = rate > 0 ? this.factor + rate * dt : 1;
      if (this.factor >= 1) {
        this.factor = 1;
        this.fadingIn = false;
      }
    } else if ((block.fadeOut || 0) > 0) {
      this.factor -= block.fadeOut * dt;
      if (this.factor < 0.001) {
        // The next slot starts on the next frame, fading in from nothing.
        this.factor = 0;
        this.slot += 1;
        this.fadingIn = true;
      }
    }
    if (this.factor < (block.minFactor || 0)) this.factor = block.minFactor;
    const f = this.factor;
    const t = this.t;
    const channel = pair => (pair && pair[0] ? pair[0] * f * Math.sin(pair[1] * t) : 0);
    out.pitch = channel(block.pitch);
    out.yaw = channel(block.yaw);
    out.roll = channel(block.roll);
    out.x = channel(block.leftRight);
    out.y = channel(block.upDown);
    out.z = channel(block.inOut);
    return true;
  }
}

const DEG = Math.PI / 180;
const _euler = new THREE.Euler(0, 0, 0, 'ZYX');
const _turn = new THREE.Quaternion();
const _move = new THREE.Vector3();

/**
 * Put one frame's shake on a camera, in its own frame: `S × M`, the shake on
 * the left of the camera's transform (CS-11). The engine's camera looks down
 * +z with x right; this one looks down -z, so the move's z and every turn's
 * sign flip (a positive engine pitch tips the view down, a positive yaw turns
 * it right, a positive roll leans its up to the right). The turns compose
 * pitch, then yaw, then roll on the engine's row vectors, which is Euler
 * `ZYX` here. Answers a function that puts the camera back.
 */
export function applyViewShake(camera, shake) {
  const position = camera.position.clone();
  const quaternion = camera.quaternion.clone();
  _move.set(shake.x, shake.y, -shake.z).applyQuaternion(quaternion);
  camera.position.add(_move);
  _euler.set(-shake.pitch * DEG, -shake.yaw * DEG, -shake.roll * DEG, 'ZYX');
  camera.quaternion.multiply(_turn.setFromEuler(_euler));
  camera.updateMatrixWorld();
  return () => {
    camera.position.copy(position);
    camera.quaternion.copy(quaternion);
    camera.updateMatrixWorld();
  };
}
