// An amphibian's water half: the `c_ETShip` Engine, the `FloatingBundle`s and
// the two rudder `Wing`s a land hull carries beside its own drivetrain.
//
// Desert Combat's BMP-2 is a `c_ETTank` Engine driving its tracks and a
// `c_ETShip` Engine (`BMP2_WaterEngine`, 0/-0.75/-1, differential 2.3, torque
// 1.5, roll -5..20 on `c_PIThrottle` with `setAutomaticReset 1`), four
// `BMP2_Floater`s at +-2.5 m and two `Wing` rudders on `c_PIYaw` 2 m fore and
// aft. The engine has no amphibian class and no switch between land and
// water. Every one of those objects runs its own physics every tick:
//
//  - The land engine returns at the second instruction of
//    `PhysicsEngine::updatePhysics` (`0x0824cc20`, `engineType & 1` clear) and
//    propels only through the `c_PGFEngineGrip` springs that find it walking
//    up their ancestors (`ResponsePhysics::addFriction` `0x0825c1b0`). That is
//    `TrackedVehicle` / `GroundVehicle`, unchanged.
//  - The water engine runs the thrust body a ship's screw does (`ship.js`):
//    `F = fwd * K * getCurrentRatio()` along its OWN axis at its own position,
//    `K = 0.1|revs| + e|e|` on the gearbox's revs (TANK-12). Its water rule is
//    bit 3's, read at `0x0824cc89` / `0x0824d047` (lnxded, re-read
//    2026-09-30): with its node below the water level the thrust runs; above
//    it, with `|revs| > 0.02`, the thrust is skipped and `PhysicsEngine+0xa0`
//    is pinned to 1.0. Both engines take `c_PIThrottle` together, so on land
//    the first press pins the water engine's revs at 1.0 and it pushes nothing
//    until it is wet; a hull that has never had its throttle opened (revs 0)
//    runs the law above water too, where `e|e|` with `e = -v/fade` is a
//    brake.
//  - A `FloatingBundle` lifts only below its reference plane
//    (`PhysicsFloatingBundle::updatePhysics` `0x0824d640`, `body-float.js`).
//  - A `Wing` makes lift everywhere, ten times over under water
//    (`PhysicsWing::updatePhysics`); a rudder's `setWingLift 0` over
//    `setFlapLift 1` is `aircraft.js`'s `Surface`.
//  - The hull's own box drag takes the submerged multiplier
//    `1 + 24 min(depth/DY, 1)` twice over (physics.md §3, `ship.js`
//    `applyDrag`). The land classes carry their own dry drag, so only the
//    multiplier's excess, `(s^2 - 1)` times the dry box law, is added here.
//
// So this module is those four, stepped inside the land class's own sub-step,
// in its body frame and per unit mass, which is how `TrackedVehicle` and
// `GroundVehicle` accumulate. On dry land the floats and the water engine
// contribute nothing and the rudders a little air lift; in the water the
// hull floats, the screw pushes and the rudders steer.
//
// Divergences, all of them:
//
//  - A land hull stands on the sea BED here (`bedGroundHeight`), not on the
//    sea surface every other land vehicle in the viewer treats as a floor.
//  - `underWater` is the collision box bottom's depth under the hull's origin,
//    as `ship.js` takes it, not the lowest col0 vertex's.
//  - Only `c_ETShip` / `c_ETTorpedo` engines are run. A land hull carrying a
//    `c_ETPlane` (FHSW's CharB1 traverse engines) keeps it idle, as before.

import * as THREE from 'three';
import { Surface, calculateLift } from './aircraft.js';
import { VectoredEngine, engineGeometry } from './vectored-engines.js';
import { floatNodesOf, floatAcceleration } from './body-float.js';
import { hullGeometry } from './ship-spec.js';
import { axisAngle, keyOf } from './vehicle-base.js';

/** `engineType` values with bit 3 set: the ship's water rule. */
const WATER_ENGINE_TYPES = new Set(['c_etship', 'c_ettorpedo']);

/** `|revs| > 0.02`, the above-water branch's dead band (`0x0824d047`). */
const WATER_REV_BAND = 0.02;

/** What `0x0824d06d` pins the revs of a dry screw to. */
const DRY_SCREW_REVS = 1;

/** `PhysicsWing::updatePhysics`: a submerged surface's medium. */
const SUBMERGED_MEDIUM = 10;

/** `airDensityZeroAtHeight`, the air medium's and the thrust's `rho`. */
const AIR_DENSITY_ZERO_AT_HEIGHT = 1000;

/** `PhysicsWing::updatePhysics`'s per-surface clamp, m/s^2. */
const SURFACE_LIFT_CLAMP = 200;

/** `1 + 24 min(depth/DY, 1)`: the 25.0 at `0x086ccce0`. */
const SUBMERGED_DRAG_TOP = 25;

/** The box law's faces are ellipses inscribed in them. */
const BOX_AREA = Math.PI / 4;

const UP = new THREE.Vector3(0, 1, 0);
const IDENTITY = new THREE.Quaternion();

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

const _inv = new THREE.Matrix4();
const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _arm = new THREE.Vector3();
const _world = new THREE.Vector3();
const _f = new THREE.Vector3();
const _t = new THREE.Vector3();
const _c = new THREE.Vector3();
const _v = new THREE.Vector3();
const _up = new THREE.Vector3();
const _qs = new THREE.Quaternion();

/**
 * The ground under a land hull that can swim: the terrain and any drivable
 * deck, never the sea surface.
 *
 * `WorldCollider.surfaceHeight` answers `max(terrain, water)`, which is right
 * for a soldier's feet and for every land vehicle that cannot float, and is
 * wrong for one that can: its wheels would stand on the water and its floats
 * would never get wet. The engine's own `checkVsTerrain` (`0x0825a960`) meets
 * the heightfield and lets water produce no impulse at all
 * (collision-response.md §7). With no heightfield to ask (a harness, a level
 * with none) the page's own function is kept.
 *
 * @param {object|null} collider the page's `WorldCollider` (or a wrapper of it)
 * @param {number} waterLevel the level's flat sea
 * @param {(x: number, z: number, fromY?: number) => number} fallback
 */
export function bedGroundHeight(collider, waterLevel, fallback) {
  const hf = collider?.heightfield;
  if (!hf || typeof hf.height !== 'function' || !Number.isFinite(waterLevel)) return fallback;
  return (x, z, fromY) => {
    let g = hf.height(x, z);
    if (Number.isFinite(fromY) && typeof collider.deckHeight === 'function') {
      const deck = collider.deckHeight(x, z, fromY);
      if (Number.isFinite(deck) && !(deck <= g)) g = deck;
    }
    return Number.isFinite(g) ? g : fallback(x, z, fromY);
  };
}

/** A node's pose in the root's frame, as `aircraftSpec` reads a Wing: the
 *  position in Refractor's own frame (z mirrored back), the rotation in the
 *  glb's. */
function rootFrame(root, node) {
  _inv.copy(root.matrixWorld).invert();
  _m.multiplyMatrices(_inv, node.matrixWorld).decompose(_p, _q, _s);
  return { position: [_p.x, _p.y, -_p.z], quaternion: [_q.x, _q.y, _q.z, _q.w] };
}

/** One rudder, as the `Surface` `aircraftSpec` would build for it. */
function wingSurface(root, node) {
  const data = node.userData;
  const part = data.physics || {};
  const axis = data.rig?.axes?.pitch;
  const frame = rootFrame(root, node);
  const surface = new Surface({
    id: node.name,
    node: node.name,
    attach: frame.position,
    offset: part.positionOffset ? [...part.positionOffset] : [0, 0, 0],
    mountQuaternion: frame.quaternion,
    min: axis?.min ?? 0,
    max: axis?.max ?? 0,
    maxSpeed: axis?.maxSpeed ?? 0,
    direction: axis?.direction ?? 1,
    input: axis?.input,
    wingLift: part.wingLift ?? 0,
    flapLift: part.flapLift ?? 0,
    pitchOffset: part.pitchOffset ?? 0,
  });
  // The servo that moves it is the land class's own rig part for this node
  // (`Vehicle.advanceSurfaces`), keyed on the rig's control and input.
  surface.key = `${keyOf(data.rig?.control || 'vehicle', surface.axis.input)}/pitch`;
  return surface;
}

/**
 * The water half of one land hull, or nothing for a hull with no water engine
 * and no float (every vanilla land vehicle but XPack2's LVT and Schwimmwagen).
 */
export class AmphibiousKit {
  /**
   * @param {THREE.Object3D} root the hull's root node
   * @param {{waterLevel?: number, mass?: number, drag?: number}} [options]
   * @returns {AmphibiousKit|null}
   */
  static of(root, options = {}) {
    if (!root) return null;
    root.updateWorldMatrix(true, true);
    const control = root.userData?.control || root.name;
    const ownedByRoot = data => (data.control || control) === control;
    const engines = [];
    const wings = [];
    let floats = 0;
    root.traverse(node => {
      const data = node.userData || {};
      if (!ownedByRoot(data)) return;
      if (data.templateKind === 'Engine'
          && WATER_ENGINE_TYPES.has(String(data.physics?.engineType ?? '').toLowerCase())) {
        engines.push(node);
      } else if (data.templateKind === 'Wing' && data.rig?.axes?.pitch) {
        wings.push(node);
      } else if (data.templateKind === 'FloatingBundle') {
        floats += 1;
      }
    });
    if (!engines.length && !floats) return null;
    return new AmphibiousKit(root, engines, wings, options);
  }

  constructor(root, engineNodes, wingNodes, options = {}) {
    const physics = root.userData?.physics || {};
    /** The level's flat sea; -Infinity on a map with none. */
    this.waterLevel = Number.isFinite(options.waterLevel) ? options.waterLevel : -Infinity;
    /** The hull's own `ObjectTemplate.mass` / `drag`: the float damping and
     *  the submerged drag both divide by the one and scale with the other. */
    this.mass = physics.mass > 0 ? physics.mass : (options.mass ?? 1);
    this.drag = Number.isFinite(physics.drag) ? physics.drag : (options.drag ?? 0);

    this.engines = engineNodes.map(node => {
      const part = node.userData.physics;
      return new VectoredEngine({
        id: node.name,
        engineType: part.engineType,
        differential: part.differential ?? 1,
        torque: part.torque,
        noPropellerEffectAtSpeed: part.noPropellerEffectAtSpeed ?? 100,
        ...engineGeometry(root, node),
      });
    });
    this.surfaces = wingNodes.map(node => wingSurface(root, node));

    // The float offsets, in the hull's body frame: `floatNodesOf` measures
    // them in world space against the root as it stands.
    const inverse = root.getWorldQuaternion(new THREE.Quaternion()).invert();
    this.floats = floatNodesOf(root)
      .filter(float => (float.node.userData?.control || root.userData?.control || root.name)
        === (root.userData?.control || root.name))
      .map(float => ({
        ...float,
        local: new THREE.Vector3(float.offsetX, float.offsetY, float.offsetZ).applyQuaternion(inverse),
      }));

    const hull = hullGeometry(root);
    const [dx, dy, dz] = hull.size.map(v => (Number.isFinite(v) ? v : 0));
    this.size = [dx, dy, dz];
    /** `DX*DZ`, the footprint the float damping scales with. */
    this.footprint = dx * dz;
    /** The collision box's bottom, what `setUnderWater` measures. */
    this.keel = Number.isFinite(hull.keel) ? hull.keel : 0;
    this._area = [BOX_AREA * dy * dz, BOX_AREA * dx * dz, BOX_AREA * dx * dy];

    /** This sub-step's reading, for harnesses and `window.__drive()`. */
    this.depth = 0;
    this.afloat = false;
  }

  /** The water engine's rev state (the first one's), for audio and probes. */
  get revs() { return this.engines[0]?.revs ?? 0; }

  /** Back to the engines' construction state. */
  reset() {
    for (const engine of this.engines) engine.reset();
    this.depth = 0;
    this.afloat = false;
  }

  /**
   * One sub-step of the four laws, added to the land class's own
   * accumulators: `force` (body frame, per unit mass) and `torque` (body
   * frame, per unit mass, divided by the class's own per-mass inertia).
   *
   * @param {number} h seconds
   * @param {object} ctx `{ q, qInv, position, vBody, w, force, torque,
   *   surfaces, running, inputOf }`: the hull's orientation and its inverse,
   *   its world position, its body-frame velocity and angular velocity, the
   *   two accumulators, `state.surfaces` (the rudders' servo positions),
   *   whether the engine runs (`Engine+0x142`) and the input reader
   */
  step(h, ctx) {
    const { q, position, vBody, w, force, torque } = ctx;
    const water = this.waterLevel;
    const wet = y => Number.isFinite(water) && y < water;

    // The screw, `PhysicsEngine::updatePhysics` with bit 3's water rule.
    for (const engine of this.engines) {
      engine.advance(h, engine.input ? ctx.inputOf(engine.input) : 0, ctx.running !== false);
      engine.stepBundles(h, ctx.inputOf);
      engine.pose(IDENTITY, _dir, _arm);
      const worldY = position.y + _world.copy(_arm).applyQuaternion(q).y;
      if (!wet(worldY) && Math.abs(engine.revs) > WATER_REV_BAND) {
        engine.revs = DRY_SCREW_REVS;
        continue;
      }
      const rho = 1 - clamp(worldY / AIR_DENSITY_ZERO_AT_HEIGHT, 0, 1);
      const k = engine.thrust(vBody.dot(_dir), rho);
      _f.copy(_dir).multiplyScalar(k * engine.ratio);
      force.add(_f);
      torque.add(_t.crossVectors(_arm, _f));
    }

    // The floats: world-vertical, each at its own depth, so their differing
    // depths make the couple that rights the hull.
    if (Number.isFinite(water)) {
      for (const float of this.floats) {
        const nodeY = position.y + _world.copy(float.local).applyQuaternion(q).y;
        _v.copy(vBody).add(_c.crossVectors(w, float.local)).applyQuaternion(q);
        const a = floatAcceleration(float, {
          nodeY, waterLevel: water, verticalSpeed: _v.y,
          drag: this.drag, mass: this.mass, areaXZ: this.footprint,
        });
        if (a === 0) continue;
        _f.set(0, a, 0).applyQuaternion(ctx.qInv);
        force.add(_f);
        torque.add(_t.crossVectors(float.local, _f));
      }
    }

    // The rudders: `Aircraft.step`'s surface loop in the body frame.
    for (const surface of this.surfaces) {
      surface.orient(axisAngle(surface.axis, ctx.surfaces?.get(surface.key) ?? 0), _qs);
      _up.copy(UP).applyQuaternion(_qs);
      _v.copy(vBody).add(_c.crossVectors(w, surface.apply));
      const worldY = position.y + _world.copy(surface.apply).applyQuaternion(q).y;
      const medium = wet(worldY) ? SUBMERGED_MEDIUM
        : 1 - clamp(worldY / AIR_DENSITY_ZERO_AT_HEIGHT, 0, 1);
      const lift = calculateLift(_v, _up, surface.coeff) * medium;
      _f.copy(_up).multiplyScalar(-clamp(lift, -SURFACE_LIFT_CLAMP, SURFACE_LIFT_CLAMP));
      force.add(_f);
      torque.add(_t.crossVectors(surface.apply, _f));
    }

    // The submerged multiplier's share of the hull's box drag.
    this.depth = Number.isFinite(water) ? Math.max(0, water - (position.y + this.keel)) : 0;
    this.afloat = this.depth > 0;
    const dy = this.size[1];
    if (this.depth > 0 && dy > 0 && this.drag > 0) {
      const scale = 1 + (SUBMERGED_DRAG_TOP - 1) * Math.min(this.depth / dy, 1);
      const coefficient = -this.drag * vBody.length() / this.mass * (scale * scale - 1);
      force.x += vBody.x * this._area[0] * coefficient;
      force.y += vBody.y * this._area[1] * coefficient;
      force.z += vBody.z * this._area[2] * coefficient;
    }
  }
}
