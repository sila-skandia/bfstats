// The vehicle camera: the view modes one seat cycles through on C, and the
// state that smooths them. Split out of `flight.js`, which still re-exports it.

import * as THREE from 'three';
import { cameraPivotOffset } from './camera-pivot.js';

// --- camera modes ----------------------------------------------------------
//
// BF1942 cycles a vehicle's view on C (`c_PIToggleCameraMode`) and selects one
// directly on F9-F12 (`c_PICameraMode1..4`). Which views a given seat offers is
// data: `SoldierCamera` is the one vanilla template that spells the set out —
// `CVMInside 1, CVMChase 0, CVMFrontChase 0, CVMFlyBy 0, CVMTrace 0,
// CVMExternTrace 0`, an infantryman locked to first person. Vehicle cameras omit
// the flags and get the engine's default cycle.
//
// BE CLEAR ABOUT WHAT IS RECONSTRUCTED AND WHAT IS INVENTED.
//
// Only `cockpit` below is read from data. Its eye point is the `<Vehicle>Camera`
// node's own place in the vehicle (`CorsairCamera` at 0.028/1.202/0.04), its look
// limits are that template's `setMinRotation -70/-40/0` / `setMaxRotation 70/5/0`,
// and the interior mesh swap is its LodObject's `DistCompareSelector`.
//
// `chase`, `front` and `flyby` are OURS. A survey of every `Camera` template in
// vanilla `Objects.rfa` plus thirteen installed mods — ~37,000 `.con` files —
// finds a 13-command vocabulary on that template (setMinRotation, setMaxRotation,
// setMaxSpeed, setAcceleration, setInputToYaw/Pitch/Roll, setPivotPosition,
// toggleMouseLook, OutsideHudOffset, setHasTarget, setContinousRotationSpeed,
// CVM*) and not one distance, offset, lag, spring or damping term among them. The
// `CVM*` flags are booleans: they say a mode exists, never where it sits. So the
// engine's chase framing is a hardcoded constant we cannot read, and every number
// in this section is a viewer choice tuned by eye.
//
// `OutsideHudOffset` is the one per-vehicle datum that mentions the outside view
// at all, and it is not a camera. Vanilla declares it 13 times, aircraft only,
// Corsair `0/-0.4/4.45`. Refractor's +Z is forward (`CorsairEngine`, the
// propeller, sits at z=+4.149; `CorsairRudder` at z=-2.649), so that point is
// 0.3 m *past the propeller hub* — ahead of the aircraft, where a chase camera
// can never be. It anchors the outside-view HUD reticle, exactly as its name
// says, and nothing here uses it.
//
// THE NOSE CAM (2026-09-23) is the one correction to the paragraph above.
// Retail's aircraft have a second inside view between the cockpit and the
// chase -- no cockpit, no airframe, the reticle over open air, the engine
// heard from ahead of the propeller -- and `OutsideHudOffset` is where it
// stands: 0.3 m past the Corsair's propeller hub is exactly where a camera
// has to be to look forward without the prop disc across the frame, and the
// B17's 2.5 m is the pilot who already sits at the nose. The word is declared
// on every aircraft Camera and nothing else, which is also the list of
// vehicles retail gives a nose cam to. `game.serverAllowNoseCam` switches it.
// `seat-view.js` carries the survey and the reasoning; here it is `nose`:
// the seat's eye plus that offset in the eye's own frame, the interior LOD
// off, the cockpit's own neck clamps.
//
// See `features/flyable-vehicles/camera-modes.md`.

/**
 * The whole vocabulary, in the order C walks it: inside -> outside, as the
 * game's own progression. Which of these one SEAT actually reaches is per
 * instance (`VehicleCamera.modes`): `seat-view.js` gates the external three on
 * the seat's `CVM*` words and the server's `externalViews`, and `nose` exists
 * only where the seat Camera declares `OutsideHudOffset` (every aircraft,
 * nothing else) and the server allows it. A camera built with no `modes`
 * option gets the four the page has always had, nose excluded, so the flight
 * harness and any older caller see no change.
 */
export const CAMERA_MODES = ['cockpit', 'nose', 'chase', 'front', 'flyby'];
/** The default per-instance cycle: the pre-nose-cam four. */
export const DEFAULT_CAMERA_MODES = ['cockpit', 'chase', 'front', 'flyby'];

const WORLD_UP = new THREE.Vector3(0, 1, 0);

/**
 * Framing per external mode. Offsets are metres in the *follow frame* (the
 * aircraft's heading with roll removed, see `followFrame`), -Z forward, so a
 * positive `back` is behind the aircraft and a negative one is ahead of it.
 *
 * `tau` is the follow frame's smoothing time constant in seconds — the lag that
 * makes these watchable rather than nauseating.
 */
const CHASE = {
  // Far enough back that the Corsair's 12 m span sits inside the frame, high
  // enough to see over the fuselage at the horizon.
  back: 17, up: 4.2,
  // Aim ahead of the nose rather than at it: the aircraft settles into the lower
  // third and you can see where you are going, which is the whole point of a
  // chase view and what makes it flyable.
  lead: 22,
  // 0.32 s. Long enough that a 200 deg/s full-stick roll is visibly absorbed,
  // short enough that the aircraft never leaves the frame in a hard turn.
  tau: 0.32,
};
const FRONT = {
  // `roughly from the propeller`: the prop disc is 4.15 m ahead of the vehicle
  // origin, so 11 m clears it and still frames the whole aircraft.
  back: -11, up: 1.6,
  // Aim behind the nose so the aircraft fills the frame looking back at you.
  lead: -4,
  // Tighter than the chase. A front camera that lags badly swings wide of the
  // nose and shows the aircraft in profile instead of head-on; a little lag is
  // still wanted, because it is what banks the aircraft across the frame in a
  // turn rather than pivoting it in place.
  tau: 0.18,
};

/**
 * Fly-by compositions, cycled in order so successive plants differ on purpose.
 *
 * `lateral` is the closest-approach distance (the camera plants this far off the
 * flight path), `up` its height relative to the aircraft. The three are a level
 * close pass, a low wide one that throws the aircraft against the sky, and a high
 * one that puts it against the terrain.
 */
const FLYBY_SHOTS = [
  { lateral: 38, up: 5 },
  { lateral: 64, up: -14 },
  { lateral: 46, up: 26 },
];
const FLYBY = {
  // How far ahead to plant, as seconds of flight. The aircraft then takes about
  // this long to arrive, which is the pause that makes it read as a held shot
  // rather than a jump cut.
  lead: 3.2,
  minLead: 70, maxLead: 260,
  // Speed floor for the lead, so a parked or stalled aircraft still plants a
  // camera a sensible distance away instead of on top of itself.
  minSpeed: 35,
  // Re-plant once the aircraft is this far *and receding*. Both terms matter:
  // the plant distance itself is already ~180 m, so a bare distance test would
  // re-plant every frame.
  replant: 300,
  // Never plant inside the terrain or the sea.
  clearance: 4,
};

/** Mouse-look limits per mode, radians. Cockpit's pair is the only one in data. */
const LOOK_LIMITS = {
  // `CorsairCamera`: setMinRotation -70/-40/0, setMaxRotation 70/5/0. [data]
  cockpit: { yaw: Math.PI * 70 / 180, pitchDown: -Math.PI * 40 / 180, pitchUp: Math.PI * 5 / 180 },
  // The nose cam is the same Camera object with its eye displaced, so it keeps
  // the same neck.
  nose: { yaw: Math.PI * 70 / 180, pitchDown: -Math.PI * 40 / 180, pitchUp: Math.PI * 5 / 180 },
  // An external camera orbits rather than swivels a neck, so it gets the full
  // circle and a pitch stopping short of the poles where the frame would flip.
  chase: { yaw: Infinity, pitchDown: -1.2, pitchUp: 1.2 },
  front: { yaw: Infinity, pitchDown: -1.2, pitchUp: 1.2 },
  // Fly-by is a camera on a tripod in the world. It has no operator's head.
  flyby: null,
};

/**
 * A seat root with no drivetrain -- a Defgun, an AA gun, a Browning on its
 * tripod -- standing in for a `Vehicle` under `VehicleCamera`.
 *
 * The camera reads `state.position` / `state.orientation` / `state.velocity`
 * and calls `setFirstPerson`; a fixed emplacement has the first two in its
 * node's world pose, no velocity, and nothing to swap (bare guns ship no
 * interior LOD). `sync()` re-reads the node each frame, because the root of
 * a gun bolted to a ship's deck is not fixed at all.
 */
export class FixedSubject {
  /** @param {THREE.Object3D} node the seat root */
  constructor(node) {
    this.node = node;
    this.control = node.userData?.control || node.name || 'vehicle';
    this.state = {
      position: new THREE.Vector3(),
      orientation: new THREE.Quaternion(),
      velocity: new THREE.Vector3(),
      throttle: 0,
    };
    this.cameraNode = null;
    node.traverse(obj => {
      if (!this.cameraNode && obj !== node
          && (obj.userData?.cameraView || obj.userData?.templateKind === 'Camera')) {
        this.cameraNode = obj;
      }
    });
    this.firstPerson = true;
    this.sync();
  }

  /** Read the root's world pose into `state`. */
  sync() {
    this.node.updateWorldMatrix(true, false);
    this.node.getWorldPosition(this.state.position);
    this.node.getWorldQuaternion(this.state.orientation);
    return this;
  }

  setFirstPerson(on) {
    this.firstPerson = !!on;
    return this.firstPerson;
  }

  /** The seat Camera's world pose, or a point behind the root without one. */
  cameraPose(target = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() }) {
    if (this.cameraNode) {
      this.cameraNode.updateWorldMatrix(true, false);
      this.cameraNode.getWorldPosition(target.position);
      this.cameraNode.getWorldQuaternion(target.quaternion);
    } else {
      target.position.set(0, 2, 4).applyQuaternion(this.state.orientation).add(this.state.position);
      target.quaternion.copy(this.state.orientation);
    }
    return target;
  }
}

/**
 * The view rig for one SEAT: the modes it reaches, and the state that smooths
 * them.
 *
 * Kept out of the page because it needs the vehicle's orientation every frame and
 * nothing else, so a replay viewer or a second page gets it for free. The one
 * thing it cannot know on its own is where the ground is; `groundHeight` is
 * injected the same way `Aircraft.groundHeight` is.
 *
 * One per active seat, not per vehicle: a gunner's inside view is his own
 * Camera node (`eyeNode`), his external views hang off the hull the same as
 * the driver's, and which of them he reaches is his Camera's own `CVM*` words
 * (`modes`). The subject is the drivetrain when the root has one and a
 * `FixedSubject` when it does not.
 */
export class VehicleCamera {
  /**
   * @param {Vehicle | FixedSubject} vehicle
   * @param {{mode?: string, groundHeight?: (x: number, z: number) => number,
   *   eyeNode?: THREE.Object3D | null, modes?: string[] | null,
   *   nose?: number[] | null}} [options]
   *   `eyeNode`: the seat's own Camera node; absent, the subject's `cameraPose`.
   *   `modes`: the cycle, in order (`seat-view.js` `seatViewModes`); absent,
   *   the four the page has always had. `nose`: the nose cam's offset from
   *   the eye in the eye's own frame, glTF axes; absent, no nose view even if
   *   `modes` names one.
   */
  constructor(vehicle, options = {}) {
    this.vehicle = vehicle;
    this.eyeNode = options.eyeNode || null;
    this.nose = Array.isArray(options.nose) && options.nose.length === 3
      ? new THREE.Vector3().fromArray(options.nose) : null;
    this.modes = [...DEFAULT_CAMERA_MODES];
    this.setModes(options.modes, false);
    this.mode = this.modes.includes(options.mode) ? options.mode : this.modes[0];
    this.groundHeight = options.groundHeight || (() => -Infinity);
    /** Mouse-look offset, radians, clamped per mode by `look()`. */
    this.look = { yaw: 0, pitch: 0 };
    /**
     * The roll-free heading frame the external views hang off, carried between
     * frames. It is the smoothing state *and* the continuity state: a basis
     * rebuilt from scratch each frame would flip as the nose passes vertical,
     * where `fwd x worldUp` degenerates.
     */
    this.follow = new THREE.Quaternion();
    this.followValid = false;
    /** Fly-by: where the tripod is standing, and which composition is next. */
    this.anchor = new THREE.Vector3();
    this.anchored = false;
    this.shot = 0;
    this.side = 1;
    /**
     * Where the hull is being DRAWN this frame, when that is not where the
     * simulation left it.
     *
     * The cockpit view needs nothing here — it reads the `<Vehicle>Camera`
     * node, so it follows whatever pose the scene graph is carrying — but the
     * chase, front and fly-by views hang off `state.position`, which only
     * moves on a tick. Left alone they would step at 30 Hz while the hull they
     * are filming slid smoothly between ticks, and the aircraft would jitter
     * inside the frame. A page that interpolates the drawn pose (map.html)
     * points this at the vector it drew; anyone else leaves it null and the
     * sim position stands, exactly as before.
     */
    this.drawnPosition = null;
    /**
     * An external-view law supplied by the page, or null.
     *
     * Called once per `update()` in EVERY mode as `(mode, dt, pose)`; it
     * returns true when it has written `pose` for this frame, and false to let
     * the framing below stand. It sees the cockpit and fly-by frames too
     * because the engine's chase offset is carried through them (it starts
     * from zero out of the cockpit, which is the swoop out of the vehicle).
     * map.html sets it for seats that run `chase-camera.js`; this file imports
     * nothing new, so the node harnesses that copy it are untouched.
     */
    this.externalLaw = null;
    this.pose = {
      position: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
    };
    // Scratch, so a per-frame update allocates nothing.
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._offset = new THREE.Vector3();
    this._target = new THREE.Vector3();
    this._basis = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
  }

  /** Does this mode show the first-person interior? Exactly one does. */
  get firstPerson() {
    return this.mode === 'cockpit';
  }

  /**
   * Is this the engine's view mode 3 -- the eye on the seat's own Camera?
   * Two of ours are: the cockpit, and the nose cam, which is the same Camera
   * with its interior LOD off and its eye pushed past the propeller.
   */
  get inside() {
    return this.mode === 'cockpit' || this.mode === 'nose';
  }

  /** `Camera::setViewMode`'s own id for the current mode. */
  get modeId() {
    return this.inside ? 3 : this.mode === 'chase' ? 12 : this.mode === 'front' ? 13 : 14;
  }

  /**
   * Replace the cycle. Unknown names and a nose view this seat has no offset
   * for are dropped; an empty result falls back to the cockpit alone. The
   * current mode survives if the new cycle still reaches it, otherwise the
   * view drops back to the cycle's first, which is always the cockpit.
   */
  setModes(modes, apply = true) {
    let next = Array.isArray(modes) ? modes.filter(m => CAMERA_MODES.includes(m)) : null;
    if (!next || !next.length) next = [...DEFAULT_CAMERA_MODES];
    if (!this.nose) next = next.filter(m => m !== 'nose');
    if (!next.includes('cockpit')) next = ['cockpit', ...next];
    this.modes = next;
    if (apply && !this.modes.includes(this.mode)) this.setMode(this.modes[0]);
    return this.modes;
  }

  /** Select a mode by name, or fall back to the cycle's first. */
  setMode(mode) {
    if (!this.modes.includes(mode)) mode = this.modes[0];
    if (mode === this.mode) return this.mode;
    this.mode = mode;
    // A head turned 70 degrees left in the cockpit should not become an orbit
    // 70 degrees round the tail, and an orbit should not survive back into the
    // cockpit as a crick in the pilot's neck. Every mode starts looking forward.
    this.look.yaw = 0;
    this.look.pitch = 0;
    // Re-plant on entering fly-by rather than resuming the tripod the aircraft
    // left behind minutes ago, which would otherwise open on an empty sky.
    if (mode === 'flyby') this.anchored = false;
    this.vehicle.setFirstPerson(this.firstPerson);
    return this.mode;
  }

  /** What C does: the next view round the cycle. */
  cycle() {
    const i = this.modes.indexOf(this.mode);
    return this.setMode(this.modes[(i + 1) % this.modes.length]);
  }

  /**
   * The seat's own eye, world space: the injected Camera node when there is
   * one, else whatever the subject calls its cockpit. The node is walked
   * first because a gunner's Camera rides the turret the world just stepped.
   */
  eyePose(out) {
    if (this.eyeNode) {
      this.eyeNode.updateWorldMatrix(true, false);
      this.eyeNode.getWorldPosition(out.position);
      this.eyeNode.getWorldQuaternion(out.quaternion);
    } else {
      this.vehicle.cameraPose(out);
    }
    return out;
  }

  /** Feed mouse motion in, already scaled to radians. Clamped per mode. */
  turn(dyaw, dpitch) {
    const limit = LOOK_LIMITS[this.mode];
    if (!limit) return;
    this.look.yaw = limit.yaw === Infinity
      ? this.look.yaw + dyaw
      : Math.max(-limit.yaw, Math.min(limit.yaw, this.look.yaw + dyaw));
    this.look.pitch = Math.max(limit.pitchDown,
      Math.min(limit.pitchUp, this.look.pitch + dpitch));
  }

  /**
   * Rebuild the roll-free follow frame from the aircraft's nose, and ease the
   * carried one toward it.
   *
   * This is the anti-nausea mechanism, and it is one decision rather than two.
   * A camera rigidly parented to the airframe inherits a 200 deg/s roll, which
   * is unusable; a camera that merely lags a rigid parent still rolls, just
   * late. So the *target* has the roll taken out of it before any smoothing —
   * the frame keeps the aircraft's heading and pitch and derives its up from
   * world up, which leaves the horizon level while the aircraft rolls inside
   * the frame, where you can actually see it happening.
   *
   * The smoothing on top is then only about lag, and because position hangs off
   * this same frame, one time constant buys both the orientation ease and the
   * positional swing behind the aircraft in a turn.
   *
   * Refractor's own precedent for decoupling a mount from its platform is
   * `setAutomaticYawStabilization` / `setAutomaticPitchStabilization`, 15 live
   * uses in vanilla — all of them pintle MG mounts on open-top vehicles, none of
   * them a camera. The idea is the engine's; pointing it at a camera is ours.
   */
  followFrame(dt) {
    const s = this.vehicle.state;
    this._fwd.set(0, 0, -1).applyQuaternion(s.orientation);
    this._right.crossVectors(this._fwd, WORLD_UP);
    if (this._right.lengthSq() < 1e-6) {
      // Nose within a fraction of a degree of vertical: world up gives no
      // heading at all. Borrow the airframe's own right, which is continuous
      // through the top of a loop and is the only frame available there.
      this._right.set(1, 0, 0).applyQuaternion(s.orientation);
    }
    this._right.normalize();
    this._up.crossVectors(this._right, this._fwd).normalize();
    this._basis.makeBasis(this._right, this._up, this._fwd.clone().negate());
    this._q.setFromRotationMatrix(this._basis);
    if (!this.followValid) {
      this.follow.copy(this._q);
      this.followValid = true;
      return;
    }
    const tau = (this.mode === 'front' ? FRONT : CHASE).tau;
    // Frame-rate independent exponential ease: the fraction of the remaining gap
    // to close this step. A bare `slerp(q, 0.1)` would smooth twice as hard at
    // 120 Hz as at 60.
    this.follow.slerp(this._q, 1 - Math.exp(-dt / Math.max(tau, 1e-4)));
  }

  /**
   * Stand the fly-by camera up somewhere ahead of the aircraft.
   *
   * The rule, so that it reads as a deliberate shot and not a dice roll: plant
   * `lead` seconds of flight ahead along the *heading* (the roll-free frame, so
   * a camera is never planted sideways because the aircraft happened to be
   * inverted), `lateral` metres to one side, and alternate sides each plant so
   * two consecutive fly-bys never mirror each other. The composition rotates
   * through `FLYBY_SHOTS`. Finally lift the anchor clear of the terrain, because
   * a trackside camera buried in a hillside films a hillside.
   */
  plant() {
    const s = this.vehicle.state;
    const shot = FLYBY_SHOTS[this.shot % FLYBY_SHOTS.length];
    this.shot += 1;
    const speed = Math.max(s.velocity.length(), FLYBY.minSpeed);
    const lead = Math.max(FLYBY.minLead, Math.min(FLYBY.maxLead, speed * FLYBY.lead));
    this.anchor.copy(s.position)
      .addScaledVector(this._fwd, lead)
      .addScaledVector(this._right, this.side * shot.lateral);
    this.anchor.y += shot.up;
    const floor = this.groundHeight(this.anchor.x, this.anchor.z);
    if (Number.isFinite(floor)) {
      this.anchor.y = Math.max(this.anchor.y, floor + FLYBY.clearance);
    }
    this.side = -this.side;
    this.anchored = true;
  }

  /**
   * Advance one frame and return the world pose the page should give the camera.
   *
   * @param {number} dt seconds
   * @returns {{position: THREE.Vector3, quaternion: THREE.Quaternion}}
   */
  update(dt) {
    // A fixed emplacement's pose is its node's, re-read each frame.
    if (typeof this.vehicle.sync === 'function') this.vehicle.sync();
    const s = this.vehicle.state;
    const out = this.pose;
    // The hull as drawn, for every view that frames it from outside; the
    // velocity, the heading frame and the fly-by's re-plant test stay on the
    // sim state, where a fraction of a tick of position makes no difference.
    const at = this.drawnPosition || s.position;

    // The page's law gets first refusal. When it takes the frame the follow
    // frame is still kept warm, so dropping back to the framing below (a
    // `?chase=` change, a seat without the law) never opens on a snap.
    if (this.externalLaw && this.externalLaw(this.mode, dt, out)) {
      this.followFrame(dt);
      return out;
    }

    if (this.inside) {
      // Straight off the seat's Camera node, which is already posed in world
      // space by `applyTransform` (and the turret step, for a gunner). The
      // head offset goes on in the aircraft's own frame so the pilot turns
      // with the plane rather than against it.
      this.eyePose(out);
      // The nose cam: the same eye, pushed `OutsideHudOffset` along the
      // Camera's own axes -- past the propeller, below the eye line -- before
      // the neck turns, so the head swivels about the nose rather than the
      // seat.
      if (this.mode === 'nose' && this.nose) {
        out.position.add(this._offset.copy(this.nose).applyQuaternion(out.quaternion));
      }
      if (this.look.yaw || this.look.pitch) {
        this._q.setFromEuler(new THREE.Euler(this.look.pitch, this.look.yaw, 0, 'YXZ'));
        // A Camera with a `setPivotPosition` turns its eye with the head:
        // `Camera::handleUpdate` builds `T(pivot) * R(look) * bundle`, so the
        // eye sits at the pivot turned by the look (camera-pivot.js). The
        // node already carries the unturned pivot; swap it for the turned one.
        const pivot = this.eyeNode?.userData?.pivotApplied
          && cameraPivotOffset(this.eyeNode.userData);
        if (pivot) {
          this._offset.fromArray(pivot);
          this._target.copy(this._offset).applyQuaternion(this._q).sub(this._offset);
          out.position.add(this._target.applyQuaternion(out.quaternion));
        }
        out.quaternion.multiply(this._q);
      }
      // Keep the follow frame warm so switching to an external view opens
      // already settled behind the aircraft rather than snapping into place.
      this.followFrame(dt);
      return out;
    }

    this.followFrame(dt);

    if (this.mode === 'flyby') {
      // A planted camera, tracking. Re-plant only once the aircraft is both far
      // away and going further — the anchor starts ~180 m out, so a bare
      // distance test would re-plant on the frame it was planted.
      const receding = this.anchored
        && s.velocity.dot(this._target.subVectors(this.anchor, s.position)) < 0;
      if (!this.anchored
        || (receding && s.position.distanceTo(this.anchor) > FLYBY.replant)) {
        this.plant();
      }
      out.position.copy(this.anchor);
      // Level: a tripod does not roll, so world up, and the aircraft centred.
      this._basis.lookAt(out.position, at, WORLD_UP);
      out.quaternion.setFromRotationMatrix(this._basis);
      return out;
    }

    const rig = this.mode === 'front' ? FRONT : CHASE;
    // Orbit the offset inside the follow frame, so the mouse swings the camera
    // around the aircraft and a centred mouse is the framing above.
    this._offset.set(0, rig.up, rig.back)
      .applyEuler(new THREE.Euler(this.look.pitch, this.look.yaw, 0, 'YXZ'))
      .applyQuaternion(this.follow);
    out.position.copy(at).add(this._offset);
    // Aim at a point along the *smoothed* heading rather than the live nose, or
    // the aim would reintroduce the high-frequency motion the frame just took
    // out. Up comes from the same frame, which is what holds the horizon level
    // through a roll and stays continuous over the top of a loop.
    this._target.set(0, 0, -rig.lead).applyQuaternion(this.follow).add(at);
    this._up.set(0, 1, 0).applyQuaternion(this.follow);
    this._basis.lookAt(out.position, this._target, this._up);
    out.quaternion.setFromRotationMatrix(this._basis);
    return out;
  }
}
