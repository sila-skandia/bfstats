// A ship under way: the aircraft's own thrust law, two rudders, and buoyancy.
//
// There is **no ship-specific propulsion code in the engine at all.**
// `PhysicsEngine::updatePhysics` (`0x0824cbb0`) is one function for every
// engine type, and `c_ETShip = 9` — proved from
// `operator<<(ostream&, EngineType)` `0x0823ef60`, whose table reads
// 1 `c_ETPlane`, 2 `c_ETCar`, 6 `c_ETTank`, **9 `c_ETShip`**, 0x11
// `c_ETRocket`, 0x19 `c_ETTorpedo` — has bit 0 set, so a destroyer's screw
// runs the same `rho` / signed-square / `getCurrentRatio()` body a Corsair's
// propeller does. A car and a tank have bit 0 clear and return at the `& 1`
// gate, which is why they need `ground.js` and a ship does not.
//
// Bit 3 is the ship's own rule, read at `0x0824cc89`/`0x0824d047`:
//
//   screw BELOW the waterline  -> thrust runs (the normal case: `Fletcher_Engine`
//                                is authored at 0/-4/-40, absolute y about 16.2
//                                against a water level of 20)
//   screw ABOVE it, |throttle| > 0.02
//                              -> thrust is SKIPPED and the stored throttle is
//                                 pinned to 1.0
//
// A plane has bit 3 clear and gets the mirror rule: an engine under water has
// its throttle zeroed. Both live in `Aircraft.waterGate`, which this class
// overrides.
//
// Steering is two ordinary `Wing`s. `Fletcher_rudder` and `Fletcher_HullWing`
// declare `setWingLift 0 / setFlapLift 2` on `c_PIYaw` with opposite
// `setAcceleration` signs, so they deflect against each other and their lift,
// applied 55 m fore and aft of the centre, is a yaw couple. They work at all
// only because `PhysicsWing::updatePhysics` multiplies a surface below the
// water surface by a flat **10** (`SUBMERGED_MEDIUM` in `flight.js`) instead of
// the `1 - y/1000` air density — which is why `waterHeight` has to be set for a
// ship and why nothing else about the rudder is special.
//
// So a ship is an `Aircraft` with a different spec, one extra force
// (`FloatingBundle`, `body-float.js`) and the opposite water gate. What is NOT
// inherited is the drag: the linear `-drag*v` `flight.js` carries is a fitted
// stand-in, and for a ship it is not even the right order of magnitude —
// `Fletcher`'s `drag 3` against a `mass` of 2.5e6 through the box law with the
// submerged multiplier is the only thing that sets a terminal speed at all. See
// `applyDrag`.
//
// Divergences from the engine, all of them:
//
//  - **`underWater`, the box-drag multiplier's input, is not read.** The law is
//    `scale = 1 + 24*min(underWater/DY, 1)` (physics.md §3, ledger PHY-7) with
//    `underWater` at `PhysicsNode+0x8c`, written by `setUnderWater`
//    (`0x0824d430`) — and **who calls that setter for a ship's root, and with
//    what, is UNVERIFIED**. This file uses the depth of the hull bounding box's
//    own bottom below the water surface, clamped to `[0, DY]`, because that is
//    what "submersion depth in metres" has to mean for a box. It is the single
//    biggest lever on a ship's top speed, so the speed this model gives is
//    **not calibrated** — the research declines to offer one and so does this.
//  - The geometry box is the drawn glb's bounding box, masts and davits
//    included. The engine asks the object for its own geometry box, which for a
//    ship may be the LOD hull without them.
//  - `getCurrentRatio()` is rev-dependent (`0x0824ca70`: `3.5*setDifferential /
//    lerp(gearRatioCurve, 100*rev/maxRev)`), and `flight.js` samples the curve
//    at its last entry, 0.94, i.e. at maximum rev. So `Fletcher` gets 7.447 at
//    every rev instead of only at full. Correcting it needs TANK-12's rev
//    filter, which is another stream's.
//  - The propeller visual's two-LOD spin (`throttle*20` above a `|throttle|` of
//    0.08, `throttle*400` below) is `flight.js`'s `advancePropeller`, not this
//    law's arms.

import * as THREE from 'three';
import { Aircraft } from './flight.js';
import { floatAcceleration, floatNodesOf } from './body-float.js';

/** `ObjectTemplate.engineType` values whose bit 3 is set: the water rule. */
const WATER_ENGINE_TYPES = new Set(['c_ETShip', 'c_ETTorpedo']);

/** `|throttle| > 0.02`: the dead band the above-water branch tests. */
const WATER_THROTTLE_BAND = 0.02;

/** `1 + 24*min(depth/DY, 1)`: the 25.0 at `0x086ccce0`, again. */
const SUBMERGED_DRAG_TOP = 25;

/** `(pi/4)` — the box law's faces are ellipses inscribed in them. */
const BOX_AREA = Math.PI / 4;

const _r = new THREE.Vector3();
const _force = new THREE.Vector3();
const _arm = new THREE.Vector3();
const _spin = new THREE.Vector3();
const _rel = new THREE.Vector3();
const _qi = new THREE.Quaternion();
const _box = new THREE.Box3();
const _size = new THREE.Vector3();

/** A node's translation in Refractor's own frame (z forward), which is what a
 *  `flight.js` spec is written in: the exporter mirrored z on the way out. */
function conPosition(node) {
  return [node.position.x, node.position.y, -node.position.z];
}

/**
 * An `Aircraft`-shaped physics table, read off a ship's own node tree.
 *
 * Unlike `CORSAIR` — a hand-typed table for one aeroplane — every number here
 * comes out of the glb: the hull's `ObjectTemplate.mass`/`drag`, each `Engine`'s
 * `setDifferential` and `setNoPropellerEffectAtSpeed`, and each `Wing`'s
 * `setWingLift`/`setFlapLift`/`setPositionOffset` with its own
 * `RotationalBundle` range and speed. The only free quantity is the inertia
 * box, and that is the drawn bounding box.
 *
 * Returns null when the root is not a ship, or authors no engine.
 */
export function shipSpec(root) {
  const physics = root?.userData?.physics;
  if (!physics || !(physics.mass > 0)) return null;
  const engines = [];
  const surfaces = [];
  let throttleRate = 0.1;
  root.traverse(node => {
    const data = node.userData || {};
    const part = data.physics;
    if (data.templateKind === 'Engine' && part?.engineType) {
      engines.push({
        id: node.name,
        engineType: part.engineType,
        position: conPosition(node),
        // `getCurrentRatio` = 3.5 * setDifferential / gearRatioCurve[100].
        // `setTorque` is the engine SOUND (physics.md §5), not thrust.
        differential: part.differential ?? 1,
        noPropellerEffectAtSpeed: part.noPropellerEffectAtSpeed ?? 120,
      });
      // `setMaxSpeed` over the rev accumulator's own span, the same reading
      // `CORSAIR.throttleRate` is: `Fletcher_Engine` is 5000 over 5000, so a
      // second from stop to full ahead.
      const span = Math.abs(part.maxRotation?.[2] ?? 0);
      const speed = Math.abs(part.maxSpeed?.[2] ?? 0);
      if (span > 0 && speed > 0) throttleRate = speed / span;
    } else if (data.templateKind === 'Wing') {
      const axis = data.rig?.axes?.pitch;
      surfaces.push({
        id: node.name,
        node: node.name,
        attach: conPosition(node),
        offset: part?.positionOffset
          ? [part.positionOffset[0], part.positionOffset[1], part.positionOffset[2]]
          : [0, 0, 0],
        // The node's own glb quaternion IS the mount: a rudder's `setRotation
        // 0/0/-90` arrives already conjugated, and re-deriving it from Euler
        // words the extractor does not emit would be a guess.
        mountQuaternion: [node.quaternion.x, node.quaternion.y,
                          node.quaternion.z, node.quaternion.w],
        min: axis?.min ?? 0,
        max: axis?.max ?? 0,
        maxSpeed: axis?.maxSpeed ?? 0,
        direction: axis?.direction ?? 1,
        input: axis?.input,
        wingLift: part?.wingLift ?? 0,
        flapLift: part?.flapLift ?? 0,
        pitchOffset: part?.pitchOffset ?? 0,
        regulateToLift: part?.regulateToLift ?? 0,
        wingToRegulatorRatio: part?.wingToRegulatorRatio ?? 1,
      });
    }
  });
  if (!engines.length) return null;
  root.updateWorldMatrix(true, true);
  _box.setFromObject(root);
  _box.getSize(_size);
  return {
    mass: physics.mass,
    drag: physics.drag ?? 0,
    gravity: 14.73,
    inertiaModifier: physics.inertiaModifier || [1, 1, 1],
    size: [_size.x, _size.y, _size.z],
    // The hull sits in the water, not on the sea bed: the heightfield clamp is
    // only there so a ship run onto a beach stops.
    groundClearance: 0,
    throttleRate,
    // Astern. The Engine's roll axis runs `setMinRotation 0/0/-4000` to
    // `setMaxRotation 0/0/5000`, and `K` is a signed square.
    throttleMin: -1,
    // A ship has no undercarriage to retract, and no `LandingGear` node; these
    // only keep `Aircraft.integrate`'s gear thresholds from firing on a value
    // nothing reads.
    gearUpAltitude: Infinity,
    gearDownAltitude: -Infinity,
    engines,
    surfaces,
  };
}

/** A ship: an `Aircraft` whose lift comes from the water rather than the air. */
export class Ship extends Aircraft {
  constructor(node, parent, options = {}) {
    super(node, parent, { ...options, spec: options.spec || shipSpec(node) });
    /** The flat sea. `PatchTerrain::getWaterLevel(x, z)` `0x083d7a80` discards
     *  both arguments, so one scalar is the whole of it — and it is what makes
     *  the rudder's `medium()` return 10 instead of 1. */
    this.waterHeight = Number.isFinite(options.waterLevel)
      ? options.waterLevel : -Infinity;
    /** The float nodes, each with its offset in the HULL's frame.
     *
     *  `floatNodesOf` measures world offsets — right for the law, which is a
     *  world-space call — but they have to be re-rotated every sub-step as the
     *  hull turns, so the spawn rotation is taken out of them once here. */
    const inverse = _qi.copy(this.state.orientation).invert();
    this.floats = floatNodesOf(node).map(float => ({
      ...float,
      local: new THREE.Vector3(float.offsetX, float.offsetY, float.offsetZ)
        .applyQuaternion(inverse),
    }));
    /** `DX*DZ`, the bounding-box footprint the float nodes' damping scales with
     *  — the same box the drag law's three faces come out of. */
    this.footprint = this.spec.size[0] * this.spec.size[2];
    /** How far the hull's bounding box reaches below its own origin, so the
     *  drag law can say how deep the box is. */
    node.updateWorldMatrix(true, true);
    _box.setFromObject(node);
    this.boxBottom = _box.min.y - node.getWorldPosition(_spin).y;
  }

  /**
   * Bit 3's rule, the ship half.
   *
   * Below the waterline the screw bites and the thrust runs. Above it, with the
   * throttle off its dead band, the engine **skips the thrust entirely and pins
   * the stored throttle to 1.0** — so a hull lifted clear of the water, or one
   * going down by the bow, roars at full power and makes nothing. Returning
   * `null` is "no thrust this step", which is exactly the engine's
   * `goto propellerVisual`.
   */
  waterGate(engine, worldY) {
    const ship = WATER_ENGINE_TYPES.has(engine.engineType);
    if (!ship) return super.waterGate(engine, worldY);
    if (worldY < this.waterHeight) return this.state.throttle;
    if (Math.abs(this.state.throttle) > WATER_THROTTLE_BAND) {
      this.state.throttle = 1;
      return null;
    }
    return this.state.throttle;
  }

  /**
   * Buoyancy, node by node, world-vertical, at each node's own world position.
   *
   * This is `body-float.js`'s law with nothing added. The reason the hull
   * rights itself — and the reason a shell hole down one end makes it list — is
   * that each node's force lands in `_moment` as `r x a` with its own depth, so
   * eight nodes at eight depths make their own couple. Nothing here says
   * "level the hull".
   *
   * The vertical speed each node sees is the hull's speed AT that node,
   * `v + omega x r`, which is `PhysicsNode::getTangentSpeed` (`+0x74`).
   */
  bodyForces(accel, moment, _h) {
    if (!this.floats?.length || !Number.isFinite(this.waterHeight)) return;
    const s = this.state;
    for (const float of this.floats) {
      _r.copy(float.local).applyQuaternion(s.orientation);
      _rel.copy(s.velocity).add(_spin.crossVectors(s.angularVelocity, _r));
      const a = floatAcceleration(float, {
        nodeY: s.position.y + _r.y,
        waterLevel: this.waterHeight,
        verticalSpeed: _rel.y,
        angle: float.angle || 0,
        sinkOffset: float.sinkOffset || 0,
        drag: this.spec.drag,
        mass: this.spec.mass,
        areaXZ: this.footprint,
      });
      if (a === 0) continue;
      _force.set(0, a, 0);
      accel.add(_force);
      moment.add(_arm.crossVectors(_r, _force));
    }
  }

  /**
   * The box drag law, which for a ship is the whole of its top speed.
   *
   * `PhysicsNode`'s Advanced/box drag (physics.md §3, client `0x0053f5f0` /
   * `0x0053f7c0`), linear terms only:
   *
   *   relV  = scale * v
   *   k     = -drag * |relV| / mass
   *   accel += k * (Ax*proj0(relV) + Ay*proj1(relV) + Az*proj2(relV))
   *   Ax = (pi/4)*DY*DZ   Ay = (pi/4)*DX*DZ   Az = (pi/4)*DX*DY
   *   scale = 1 + 24*min(depth/DY, 1)
   *
   * Quadratic in speed, and `scale` enters twice, so a fully submerged body
   * feels 625 times its dry drag on the same speed. That factor is why a
   * destroyer settles at a walking-pace-times-ten rather than at 200 m/s, and
   * it is the term the linear stand-in in `flight.js` has no way to express.
   *
   * The angular half of the law is not implemented: a ship's yaw damping comes
   * from its two `Wing`s, which is where the engine's own turning rate comes
   * from too, and adding a second unmeasured damper on top would be tuning
   * rather than porting.
   */
  applyDrag(accel, _h) {
    const k = this.spec;
    const [dx, dy, dz] = k.size;
    if (!(k.drag > 0) || !(k.mass > 0) || !(dy > 0)) return;
    const depth = Number.isFinite(this.waterHeight)
      ? Math.max(0, this.waterHeight - (this.state.position.y + this.boxBottom))
      : 0;
    const scale = 1 + (SUBMERGED_DRAG_TOP - 1) * Math.min(depth / dy, 1);
    _rel.copy(this.state.velocity).multiplyScalar(scale);
    const speed = _rel.length();
    if (speed < 1e-9) return;
    const coefficient = -k.drag * speed / k.mass;
    // Into the body frame, scaled by each face's own ellipse, and back out: the
    // engine's `projN` onto row N of the absolute transform, written as one
    // rotate-scale-rotate rather than three projections.
    _spin.copy(_rel).applyQuaternion(_qi.copy(this.state.orientation).invert());
    _force.set(_spin.x * BOX_AREA * dy * dz,
               _spin.y * BOX_AREA * dx * dz,
               _spin.z * BOX_AREA * dx * dy)
      .applyQuaternion(this.state.orientation);
    accel.addScaledVector(_force, coefficient);
  }
}
