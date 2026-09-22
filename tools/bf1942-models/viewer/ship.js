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
// The throttle in that thrust law is NOT the pedal. It is
// `PhysicsEngine+0xa0`, the gearbox's rev state, and the gearbox has a load
// feedback whose divisor is the torque curve — `engine-revs.js` holds the whole
// of it, and it is what makes a destroyer move at a destroyer's speed. Without
// it a Fletcher accelerates as though the pedal were the engine.
//
// A ship also runs aground. `ResponsePhysics::checkVsTerrain` (`0x0825a960`) is
// the only caller of `setUnderWater` on the vehicle side, and the same function
// is where a hull meets the sea bed; `Ship.settle` is the beaching half of it.
//
// Divergences from the engine, all of them:
//
//  - **`underWater` is the box bottom's depth, not the lowest collision
//    vertex's.** The caller is now read: `ResponsePhysics::checkVsTerrain`
//    (`0x0825a960`) walks the object's collision vertices into world space,
//    keeps the **minimum world y** (seeded to 9999.0 at `ds:0x86d16d0`), asks
//    `dice::ref2::geom::terrainBase` (`0x087435f0`) for the water level through
//    vtable `+0x5c` (`PatchTerrain::getWaterLevel` `0x083d7a80`, which discards
//    both arguments and returns the level's flat scalar), and calls
//    `setUnderWater(waterLevel - minVertexY)` at `0x0825ac60` when the lowest
//    vertex is below the sea, `setUnderWater(0.0)` at `0x0825ad41` when it is
//    not. So `underWater` is **a depth in metres**, of one point: the keel.
//    This file takes that depth off the lowest corner of the hull's collision
//    box rather than off its lowest vertex, which are the same number for an
//    upright hull and differ by the hull's own roll when she leans.
//  - **Which hulls reach that call is UNVERIFIED.** The loop is over a count
//    `n` taken from slot `+0x18` of whatever
//    `ResponsePhysics::getVertexCollision(0)` (vtable `+0x5c`, `0x082587e0`)
//    returns — the col0 collision mesh, reached as an interface subobject, so
//    that slot number is not one of `SimpleCollisionMesh`'s or
//    `GridCollisionMesh`'s primary vtable and **is not identified here**. `n` is
//    forced to 1 when `<= 3` (`0x0825aa5c`) and sends the function to an
//    entirely different arm when `> 10` (`0x0825aa72 cmp ...,0xa; jg
//    0x0825b04f`) — and that arm calls **neither** setter: a scan of every
//    `call [reg+0xc0]` in the image finds only `0x0825ac60` and `0x0825ad41`
//    inside this function. So if `n` is a vertex or LOD count large enough on a
//    capital ship, the engine may never write `underWater` for one at all. The
//    law is ported as though it does, because a hull whose drag never gets the
//    submerged multiplier has no terminal speed worth the name.
//  - The geometry box is the **root object's own hull mesh**, found by walking
//    the LOD chain (`hullGeometry`), not every mesh drawn under the root. The
//    engine asks the object for its own `IGeometry` (IID `0x492fe0fe`), which is
//    the root's standard mesh: a Fletcher's turrets, climbing nets, ammo boxes,
//    depth-charge projectiles and water-effect sprites belong to child objects
//    and are not in it. Masts ARE in it — `FletcherComplex` measures
//    18.87 x 35.26 x 115.49 m — because they are part of the hull mesh.
//  - `getCurrentRatio()` is **not** rev-dependent, and the corpus's note that
//    it is comes from reading `PhysicsEngine+0xbc` as a rev. `0x0824ca70`
//    indexes the curve at `100*gear/numberOfGears` (`fild [ebx+0xbc]` over
//    `fild [edx+0x360]`), `+0xbc` is the **gear** (TANK-12, physics.md §5),
//    `EngineTemplate`'s ctor defaults `numberOfGears` to 1 (`0x0823f018`), and
//    no vanilla ship authors the word — so the index is 100 and the divisor is
//    0.94 at every rev. `Fletcher`'s 7.447 is exact, not a max-rev figure.
//  - The box law's **angular** half is now implemented too, and it does nothing:
//    at five degrees a second of yaw a Fletcher's own hull damps itself at
//    2.2e-9 rad/s², thirteen orders below what the rudders are doing. A ship's
//    turn is damped by her two `Wing`s and by nothing else — which is why the
//    steady turn rate barely moved when the inertia was corrected, and why the
//    correction shows up as **responsiveness** instead.
//  - The propeller visual's two-LOD spin (`throttle*20` above a `|throttle|` of
//    0.08, `throttle*400` below) is `flight.js`'s `advancePropeller`, and it is
//    keyed on the pedal. The engine keys it on `+0xa0`, the revs
//    (`0x0824cd1a`), so a screw here spins up faster than the thrust does.
//    Cosmetic, and left alone so the engine audio keeps reading one number.

import * as THREE from 'three';
import { Aircraft } from './flight.js';
import { floatAcceleration, floatNodesOf } from './body-float.js';
import {
  currentRatio, currentTorque, loadSample, revAdvance,
} from './engine-revs.js';
import {
  COULOMB_GRAVITY, COULOMB_KINETIC_COEFFICIENT, SIMULATION_FPS,
} from './body-friction.js';

/** `ObjectTemplate.engineType` values whose bit 3 is set: the water rule. */
const WATER_ENGINE_TYPES = new Set(['c_ETShip', 'c_ETTorpedo']);

/** `|throttle| > 0.02`: the dead band the above-water branch tests. */
const WATER_THROTTLE_BAND = 0.02;

/** `1 + 24*min(depth/DY, 1)`: the 25.0 at `0x086ccce0`, again. */
const SUBMERGED_DRAG_TOP = 25;

/** `(pi/4)` — the box law's faces are ellipses inscribed in them. */
const BOX_AREA = Math.PI / 4;

/** `EngineTemplate`'s ctor default for `setTorque` (`0x0823f082`'s neighbour,
 *  tank-driving.md §3: "Constructor defaults are `numberOfGears = 1`,
 *  `differential = 10.0`, `torque = 60.0`"). Only reached by a hull that
 *  authors no `setTorque`; every vanilla ship authors one. */
const DEFAULT_TORQUE = 60;

/**
 * The friction scalar `A` for a hull resting on a sea bed, when the page has
 * not said what the bottom is made of.
 *
 * `impulseOn` (`0x08258900`) writes `A = 0.5*(friction(matA) + friction(matB))`
 * — the mean of the two surfaces' `MaterialManager.materialFriction`, whose
 * vanilla table (physics.md §10) reads 0 default 1.0, 10/11 sand 0.8, 12 rock
 * 0.6. A steel hull (material 0) on sand is `0.5*(1.0 + 0.8)`. [data]
 */
const SEABED_FRICTION = 0.9;

/** The node kinds a root's own geometry may be reached THROUGH. Anything else
 *  under the root is a separate object with its own geometry, and the engine's
 *  box does not contain it. A plain untagged mesh counts, which is what makes a
 *  hand-built test hull work. */
const GEOMETRY_CHAIN_KINDS = new Set([undefined, null, '', 'LodObject', 'Bundle']);

const _r = new THREE.Vector3();
const _force = new THREE.Vector3();
const _arm = new THREE.Vector3();
const _spin = new THREE.Vector3();
const _rel = new THREE.Vector3();
const _qi = new THREE.Quaternion();
const _box = new THREE.Box3();
const _size = new THREE.Vector3();
const _inv = new THREE.Matrix4();
const _local = new THREE.Matrix4();

/** A node's translation in Refractor's own frame (z forward), which is what a
 *  `flight.js` spec is written in: the exporter mirrored z on the way out. */
function conPosition(node) {
  return [node.position.x, node.position.y, -node.position.z];
}

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

/** The assembler's collision primitives, by the test `map.html` itself uses. */
function isCollisionNode(node) {
  return Boolean(node.userData?.collision || node.geometry?.userData?.collision
                 || /collision/i.test(node.name || ''));
}

/**
 * The root object's OWN geometry box, and the depth of its keel.
 *
 * `getGeometryInertia` and `PhysicsNode`'s box drag both ask the object for its
 * `IGeometry` (IID `0x492fe0fe`, one of the interfaces
 * `BStandardMesh::queryInterface` answers with itself), which is the root's own
 * standard mesh — not the union of everything drawn beneath it. On a Fletcher
 * that is `FletcherComplex`, reached down the LOD chain; its turrets, climbing
 * nets, ammo boxes, depth-charge projectiles, muzzle-flash sprites and water
 * wash sprites are all children with geometry of their own, and one of those
 * sprites alone used to add 0.67 m to `DY`.
 *
 * The walk descends only through `GEOMETRY_CHAIN_KINDS`, stops at the first node
 * that carries a mesh, and takes that node's mesh plus its own collision
 * children. If nothing is found it falls back to the whole subtree, which is
 * what this file did before and is still right for a hull with no LOD chain.
 *
 * @returns {{size: number[], bottom: number, keel: number}} `size` is
 *   `[DX, DY, DZ]`; `bottom` is how far the geometry box reaches below the root
 *   origin (negative); `keel` the same for the collision box, which is what
 *   `setUnderWater` measures.
 */
export function hullGeometry(root) {
  root.updateWorldMatrix(true, true);
  // Down the chain to the node that carries the root's own mesh, preferring a
  // mesh child over another structural one. `guard` is only there so a cyclic
  // or pathological tree cannot hang the page.
  let node = root;
  for (let guard = 0; node && !(node !== root && node.isMesh) && guard < 16; guard++) {
    let chain = null, mesh = null;
    for (const child of node.children) {
      if (isCollisionNode(child)) continue;
      if (!GEOMETRY_CHAIN_KINDS.has(child.userData?.templateKind)) continue;
      if (child.isMesh) { mesh = child; break; }
      if (!chain) chain = child;
    }
    node = mesh || chain;
  }
  const body = node?.isMesh ? node : null;
  // In the ROOT's own frame, never the world's: `applyMatrix4` on a Box3 takes
  // the AABB of the transformed box, so measuring through `matrixWorld` would
  // make a hull placed at 45 degrees of yaw report a box half as long again.
  _inv.copy(root.matrixWorld).invert();
  const local = geom => {
    geom.computeBoundingBox();
    return _box.copy(geom.boundingBox);
  };
  if (body?.geometry) {
    local(body.geometry).applyMatrix4(_local.multiplyMatrices(_inv, body.matrixWorld));
  } else {
    _box.setFromObject(root).applyMatrix4(_inv);
  }
  _box.getSize(_size);
  const size = [_size.x, _size.y, _size.z];
  const bottom = _box.min.y;
  // The keel: the lowest point of the hull's own collision geometry, which is
  // the quantity `ResponsePhysics::checkVsTerrain` hands `setUnderWater`.
  let keel = Infinity;
  for (const child of body?.children || []) {
    if (!child.isMesh || !isCollisionNode(child) || !child.geometry) continue;
    local(child.geometry).applyMatrix4(_local.multiplyMatrices(_inv, child.matrixWorld));
    keel = Math.min(keel, _box.min.y);
  }
  return { size, bottom, keel: Number.isFinite(keel) ? keel : bottom };
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
  // `T1 = Engine+0x10c / maxRotation.z`, and `+0x10c` is the CLIPPED angle, so
  // the pedal's own floor is `minRotation.z / maxRotation.z`. `Fletcher_Engine`
  // runs -4000 to 5000, which is -0.8, not -1: astern is 80 per cent of ahead
  // before the signed square ever sees it.
  let throttleMin = -1;
  root.traverse(node => {
    const data = node.userData || {};
    const part = data.physics;
    if (data.templateKind === 'Engine' && part?.engineType) {
      engines.push({
        id: node.name,
        engineType: part.engineType,
        position: conPosition(node),
        // `getCurrentRatio` = 3.5*setDifferential / ratioCurve[100*gear/gears],
        // constant for a ship (one gear); `engine-revs.js` has the derivation.
        differential: part.differential ?? 1,
        // `setTorque` is NOT thrust — but it is not only the engine sound
        // either. `getCurrentTorque()` (`0x0824cb10`) is the **divisor of the
        // gearbox's load** (TANK-13), so it sets how hard the rev governor
        // pulls the throttle down, and therefore the top speed.
        torque: part.torque ?? DEFAULT_TORQUE,
        numberOfGears: part.numberOfGears ?? undefined,
        noPropellerEffectAtSpeed: part.noPropellerEffectAtSpeed ?? 120,
      });
      // `setMaxSpeed` over the rev accumulator's own span, the same reading
      // `CORSAIR.throttleRate` is: `Fletcher_Engine` is 5000 over 5000, so a
      // second from stop to full ahead.
      const span = Math.abs(part.maxRotation?.[2] ?? 0);
      const speed = Math.abs(part.maxSpeed?.[2] ?? 0);
      if (span > 0 && speed > 0) throttleRate = speed / span;
      const roll = data.rig?.axes?.roll;
      if (roll && roll.max > 0 && Number.isFinite(roll.min)) {
        throttleMin = Math.max(-1, Math.min(0, roll.min / roll.max));
      }
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
  const hull = hullGeometry(root);
  return {
    mass: physics.mass,
    drag: physics.drag ?? 0,
    gravity: 14.73,
    inertiaModifier: physics.inertiaModifier || [1, 1, 1],
    size: hull.size,
    // How far the hull's own geometry and collision boxes reach below the root
    // origin. `keel` is what `setUnderWater` measures and what grounds her.
    boxBottom: hull.bottom,
    keel: hull.keel,
    // The engine's own `getGeometryInertia`, `(DY²+DZ²)/3` and friends —
    // FOUR times a solid box's. A 115 m hull on a solid box's inertia turns
    // four times too eagerly, and that is most of "too manoeuvrable".
    inertiaLaw: 'geometry',
    // A ship does not stand on the sea bed at her origin: she grounds when her
    // KEEL touches it, which is `-keel` below the origin.
    groundClearance: -hull.keel,
    throttleRate,
    // Astern, from the Engine's own clipped roll range (see `throttleMin`
    // above): -0.8 for every vanilla ship, and `K` is a signed square.
    throttleMin,
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
    /** How far the hull's own geometry box reaches below its origin, so the drag
     *  law can say how deep the box is, and how far its collision box does,
     *  which is what `setUnderWater` measures and what grounds her. */
    this.boxBottom = this.spec.boxBottom ?? 0;
    this.keel = this.spec.keel ?? this.boxBottom;
    /** `PhysicsEngine+0xa0`: the gearbox's rev state, which IS the throttle the
     *  thrust law reads. Not the pedal — see the file header. */
    this.revs = 0;
    /** `PhysicsEngine+0xa4` and `+0xac`: the load `feedbackLoop` accumulates
     *  during a tick and the gearbox reads at the start of the next. */
    this.load = 0;
    this.loadCount = 0;
    /**
     * The contact friction scalar `A` for the sea bed under her.
     *
     * A number, or a function of `(x, z)` the page installs so the material
     * under the keel is the level's own rather than a default. `impulseOn`
     * averages the two surfaces' `materialFriction`; a hull on sand is 0.9.
     */
    this.seabedFriction = SEABED_FRICTION;
  }

  /**
   * Bit 3's rule, the ship half — over the gearbox's rev state, not the pedal.
   *
   * Below the waterline the screw bites and the thrust runs on `+0xa0`. Above
   * it, with the revs off their dead band, the engine **skips the thrust
   * entirely and pins `+0xa0` to 1.0** (`0x0824d06d`) — so a hull lifted clear
   * of the water, or one going down by the bow, roars at full power and makes
   * nothing. Returning `null` is "no thrust this step", which is exactly the
   * engine's `goto propellerVisual`.
   *
   * The pin is on the REVS, not on the pedal: `0x0824d06d` writes `[edi+0xa0]`.
   * Pinning the pedal instead would have the hull come out of the water with
   * the helm order changed under the player's hand.
   */
  waterGate(engine, worldY) {
    const ship = WATER_ENGINE_TYPES.has(engine.engineType);
    if (!ship) return super.waterGate(engine, worldY);
    if (worldY < this.waterHeight) return this.revs;
    if (Math.abs(this.revs) > WATER_THROTTLE_BAND) {
      this.revs = 1;
      return null;
    }
    return this.revs;
  }

  /**
   * `Engine::handleUpdate` (`0x0823e120`) — the whole gearbox, once a tick.
   *
   * `revs += 0.05*((T1 - L) - 0.5*revs)`, clamped to [-1, 1.2], where `T1` is
   * the clipped pedal angle over `maxRotation.z` and `L` is the load the
   * previous tick's `feedbackLoop` calls accumulated. The load is then cleared,
   * exactly as the engine clears `+0xa4`/`+0xac` at the function's tail.
   *
   * The 0.05 is per ENGINE tick, so the caller's `dt` is converted to ticks
   * rather than used as a time: `engine-revs.js` `revAdvance` is the closed form
   * of the same filter and is exact for a fractional count.
   */
  advanceEngines(dt) {
    const t1 = clamp(this.state.throttle, this.spec.throttleMin ?? -1, 1);
    this.revs = revAdvance(this.revs, t1, this.load, dt * SIMULATION_FPS);
    this.load = 0;
    this.loadCount = 0;
  }

  /**
   * `PhysicsEngine::feedbackLoop(K*fwd, fwd)` (`0x0824cfc1` -> `0x0824c850`).
   *
   * `L0 = dot(K*fwd, fwd) * getCurrentRatio() / getCurrentTorque()` — and `fwd`
   * is a unit vector, so the dot is `K` itself. A ship's `engineType` has bits 1
   * and 2 clear, so neither the `& 2` clamp nor the `& 4` frame min/max applies
   * and the value lands in the running mean.
   *
   * This is the negative feedback that holds a destroyer's revs near 0.46 at
   * full pedal from rest, and lower still the faster she goes: `K` climbs with
   * `e`, `L` climbs with `K`, and the revs come down.
   */
  noteThrust(engine, k, _throttle) {
    if (!WATER_ENGINE_TYPES.has(engine.engineType)) return;
    const torque = currentTorque(engine.torque ?? DEFAULT_TORQUE, this.revs);
    if (!(Math.abs(torque) > 1e-9)) return;
    const ratio = engine.ratio ?? currentRatio(engine.differential ?? 1);
    this.load = loadSample(this.load, this.loadCount, k * ratio / torque);
    this.loadCount++;
  }

  /**
   * Aground: the keel is on the bottom.
   *
   * `Aircraft.integrate`'s floor clamp has already pushed her up so the keel
   * rests on the sea bed (`groundClearance` is `-keel`) and killed the downward
   * speed. What is left is the friction, and for a beached hull the friction is
   * the whole behaviour the owner asked for: **full throttle does not free
   * her**.
   *
   * `ResponsePhysics::addFriction` (`0x0825b6e0`, physics.md §10) caps the
   * per-tick tangential velocity change at
   *
   *     mu_lo = A * 1.50 * 9.82 * L / 30        (sliding)
   *     mu_hi = A * 2.25 * 9.82 * L / 30        (break-away)
   *
   * with `A` the mean of the two surfaces' `materialFriction` and `L` the
   * averaged contact normal's y — 1.0 for a hull sitting flat on the bottom.
   * The sliding arm is the smaller of the two and is the one used here, so this
   * is the *weakest* the engine's own friction can be: 0.9 * 1.5 * 9.82 = 13.3
   * m/s² against a thrust of about 1.5. She stops, and she stays.
   *
   * Only the horizontal velocity and the yaw rate are taken: the vertical is the
   * clamp's and buoyancy's, and a hull that has flooded enough to come off the
   * bottom must be free to rise.
   */
  settle(h) {
    const s = this.state;
    const friction = typeof this.seabedFriction === 'function'
      ? this.seabedFriction(s.position.x, s.position.z)
      : this.seabedFriction;
    const budget = Math.max(0, friction) * COULOMB_KINETIC_COEFFICIENT
      * COULOMB_GRAVITY * h;
    const speed = Math.hypot(s.velocity.x, s.velocity.z);
    if (speed <= budget) {
      s.velocity.x = 0;
      s.velocity.z = 0;
    } else {
      const keep = (speed - budget) / speed;
      s.velocity.x *= keep;
      s.velocity.z *= keep;
    }
    // A grounded hull does not pivot either: the same budget, taken on the yaw
    // rate over the hull's own half-length, so a 115 m ship on the bottom is
    // held far harder than a launch is.
    const arm = Math.max(1, this.spec.size[2] / 2);
    const spin = Math.abs(s.angularVelocity.y) * arm;
    if (spin > 1e-9) {
      const keep = spin <= budget ? 0 : (spin - budget) / spin;
      s.angularVelocity.y *= keep;
    }
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
  /** True while the keel is on the bottom: `Aircraft.step`'s own floor test,
   *  which for a hull whose `groundClearance` is its draft means beached. */
  get aground() { return this.state.grounded; }

  /**
   * `PhysicsNode+0x8c`, as `ResponsePhysics::checkVsTerrain` writes it.
   *
   * `waterLevel - (lowest collision point's world y)`, floored at zero — the
   * `0x0825ac60` / `0x0825ad41` pair. Taken off the collision box's bottom
   * corner rather than off each vertex, so it ignores the hull's roll; see the
   * file header.
   */
  underWater() {
    if (!Number.isFinite(this.waterHeight)) return 0;
    return Math.max(0, this.waterHeight - (this.state.position.y + this.keel));
  }

  applyDrag(accel, _h, moment) {
    const k = this.spec;
    const [dx, dy, dz] = k.size;
    if (!(k.drag > 0) || !(k.mass > 0) || !(dy > 0)) return;
    const scale = 1 + (SUBMERGED_DRAG_TOP - 1) * Math.min(this.underWater() / dy, 1);
    const ax = BOX_AREA * dy * dz, ay = BOX_AREA * dx * dz, az = BOX_AREA * dx * dy;
    _qi.copy(this.state.orientation).invert();
    _rel.copy(this.state.velocity).multiplyScalar(scale);
    const speed = _rel.length();
    if (speed > 1e-9) {
      const coefficient = -k.drag * speed / k.mass;
      // Into the body frame, scaled by each face's own ellipse, and back out:
      // the engine's `projN` onto row N of the absolute transform, written as
      // one rotate-scale-rotate rather than three projections.
      _spin.copy(_rel).applyQuaternion(_qi);
      _force.set(_spin.x * ax, _spin.y * ay, _spin.z * az)
        .applyQuaternion(this.state.orientation);
      accel.addScaledVector(_force, coefficient);
    }
    // The angular half of the same law, which the linear half's own comment used
    // to say was left out:
    //
    //   k'      = -drag * |w| / mass
    //   angAcc += k' * ((Ay+Az)*proj0(w) + (Ax+Az)*proj1(w) + (Ax+Ay)*proj2(w))
    //
    // No `scale`: the submerged multiplier is on the linear arm only. It is
    // ported because it is in the law, not because it does anything — for a
    // Fletcher at 5 degrees a second of yaw it is 4.7e-6 rad/s² against a rudder
    // couple three orders of magnitude larger, so a hull's turn is damped by its
    // own two `Wing`s and by nothing else. That is measured, in `test_ship.py`.
    if (!moment) return;
    const w = this.state.angularVelocity;
    const rate = w.length();
    if (rate < 1e-9) return;
    _spin.copy(w).applyQuaternion(_qi);
    _force.set(_spin.x * (ay + az), _spin.y * (ax + az), _spin.z * (ax + ay))
      .applyQuaternion(this.state.orientation);
    moment.addScaledVector(_force, -k.drag * rate / k.mass);
  }
}
