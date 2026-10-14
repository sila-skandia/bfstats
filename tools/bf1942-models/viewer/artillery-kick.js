// The view's kick when an artillery seat fires: the scope's picture lifts about
// 1.2 degrees, then settles over about a second.
//
// Measured from the owner's retail clip of the 37M 105mm (2026-10-14). The
// optic's picture moves about 14 px down a 720p frame before the muzzle flash,
// flashes at about 1.23 s, and is back in place by about 1.9 s. The HUD does
// not move in that clip (top bar, bottom icons and clock show zero offset), so
// only the picture rides the kick. The retail numbers are one clip's; the owner
// tunes KICK_DEG and FALL_S against the next clip.
//
// The kick is a rotation about the camera's own X axis, applied after the
// camera's pose is set and undone after the draw, so it never accumulates into
// the next frame's pose (`map.html` draw(), the same place the soldier's
// `shakeView` goes).

import * as THREE from 'three';

/** Peak pitch in degrees: positive lifts the view, as the picture moved down. */
export const KICK_DEG = 1.2;
/** Seconds from the shot to the peak. */
export const RISE_S = 0.15;
/** Seconds from the peak back to rest. */
export const FALL_S = 0.9;

export class ArtilleryKick {
  constructor() {
    /** Seconds since the last shot, or Infinity when no kick is running. */
    this.t = Infinity;
    this._axis = new THREE.Vector3(1, 0, 0);
    this._rot = new THREE.Quaternion();
  }

  /** A shot was fired from an artillery seat. */
  trigger() {
    this.t = 0;
  }

  /** Advance the kick by `dt` seconds; a no-op when none is running. */
  step(dt) {
    if (this.t !== Infinity) this.t += dt;
  }

  /** The pitch in degrees this frame: a linear lift, then a cosine fall. */
  angle() {
    if (this.t === Infinity) return 0;
    if (this.t < RISE_S) return KICK_DEG * (this.t / RISE_S);
    const x = (this.t - RISE_S) / FALL_S;
    if (x >= 1) {
      this.t = Infinity;
      return 0;
    }
    return KICK_DEG * 0.5 * (1 + Math.cos(Math.PI * x));
  }

  /**
   * Put this frame's kick on `camera`. Returns the function that puts the
   * camera's own orientation back, or null when there is nothing to show.
   */
  apply(camera) {
    const deg = this.angle();
    if (!deg || !camera) return null;
    const saved = camera.quaternion.clone();
    this._rot.setFromAxisAngle(this._axis, THREE.MathUtils.degToRad(deg));
    camera.quaternion.multiply(this._rot);
    return () => camera.quaternion.copy(saved);
  }
}
