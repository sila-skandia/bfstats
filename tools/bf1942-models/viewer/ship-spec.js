// A ship read out of her own node tree: the root's own geometry box and keel
// (`hullGeometry`) and the `Aircraft`-shaped physics table (`shipSpec`) every
// number of which comes out of the glb. Split out of `ship.js`, which
// re-exports both; its header carries the engine reading, including why the
// box is the root's own hull mesh and not everything drawn under it.

import * as THREE from 'three';

/** `EngineTemplate`'s ctor default for `setTorque` (`0x0823f082`'s neighbour,
 *  tank-driving.md §3: "Constructor defaults are `numberOfGears = 1`,
 *  `differential = 10.0`, `torque = 60.0`"). Only reached by a hull that
 *  authors no `setTorque`; every vanilla ship authors one. */
export const DEFAULT_TORQUE = 60;

/** The node kinds a root's own geometry may be reached THROUGH. Anything else
 *  under the root is a separate object with its own geometry, and the engine's
 *  box does not contain it. A plain untagged mesh counts, which is what makes a
 *  hand-built test hull work. */
const GEOMETRY_CHAIN_KINDS = new Set([undefined, null, '', 'LodObject', 'Bundle']);

const _box = new THREE.Box3();
const _size = new THREE.Vector3();
const _inv = new THREE.Matrix4();
const _local = new THREE.Matrix4();

/** A node's translation in Refractor's own frame (z forward), which is what a
 *  `flight.js` spec is written in: the exporter mirrored z on the way out. */
function conPosition(node) {
  return [node.position.x, node.position.y, -node.position.z];
}

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
  // The meshes that belong to ONE node: its own, plus every untagged non-collision
  // mesh child. The second half is what the level assembler needs — it splits a
  // hull's single StandardMesh into one sub-mesh per material, so a placed
  // Fletcher's geometry is nineteen `Fletch_hull_M1*` children of
  // `FletcherComplex` rather than a mesh on it, while the standalone glb puts the
  // mesh on the node. A child with a `templateKind` is a separate object with
  // geometry of its own and is never in it.
  const meshesOf = node => {
    const found = [];
    if (node.isMesh && node.geometry && !isCollisionNode(node)) found.push(node);
    for (const child of node.children) {
      if (isCollisionNode(child) || !child.isMesh || !child.geometry) continue;
      if (!GEOMETRY_CHAIN_KINDS.has(child.userData?.templateKind)) continue;
      found.push(child);
    }
    return found;
  };
  // Down the chain to the first node that has any. `guard` is only there so a
  // pathological tree cannot hang the page.
  let body = null, meshes = [];
  for (let node = root, guard = 0; node && guard < 16; guard++) {
    meshes = meshesOf(node);
    if (meshes.length) { body = node; break; }
    node = node.children.find(child => !isCollisionNode(child)
      && GEOMETRY_CHAIN_KINDS.has(child.userData?.templateKind)) ?? null;
  }
  // In the ROOT's own frame, never the world's: `applyMatrix4` on a Box3 takes
  // the AABB of the transformed box, so measuring through `matrixWorld` would
  // make a hull placed at 45 degrees of yaw report a beam of 107 m.
  _inv.copy(root.matrixWorld).invert();
  const union = new THREE.Box3();
  const add = node => {
    node.geometry.computeBoundingBox();
    _box.copy(node.geometry.boundingBox)
      .applyMatrix4(_local.multiplyMatrices(_inv, node.matrixWorld));
    union.union(_box);
  };
  for (const mesh of meshes) add(mesh);
  if (union.isEmpty()) {
    // No mesh down the chain (a landing craft's hull is a `SimpleObject`
    // under its cockpit `LodObject`): every mesh under the root but the
    // effects', each in the root's own frame. Not `setFromObject`: that is a world AABB, and
    // a yawed hull inflates it (a Daihatsu lying at 45 deg read 20.8 m square
    // with its keel 3 m down, and grounded in 2.7 m of water).
    // Effect emitters (the bow-wave and foam sprites 2..3 m under the
    // waterline) are no part of the hull.
    const walk = node => {
      const kind = node.userData?.templateKind;
      if (kind === 'EffectBundle' || kind === 'Emitter') return;
      if (node.isMesh && node.geometry && !isCollisionNode(node)) add(node);
      for (const child of node.children) walk(child);
    };
    walk(root);
    if (union.isEmpty()) union.setFromObject(root).applyMatrix4(_inv);
  }
  union.getSize(_size);
  const size = [_size.x, _size.y, _size.z];
  const bottom = union.min.y;
  // The keel: the lowest point of the hull's own collision geometry, which is
  // the quantity `ResponsePhysics::checkVsTerrain` hands `setUnderWater`. It
  // hangs off whichever of the two shapes above carries it.
  let keel = Infinity;
  const hosts = body ? [body, ...meshes] : [];
  for (const host of hosts) {
    for (const child of host.children) {
      if (!child.isMesh || !child.geometry || !isCollisionNode(child)) continue;
      child.geometry.computeBoundingBox();
      _box.copy(child.geometry.boundingBox)
        .applyMatrix4(_local.multiplyMatrices(_inv, child.matrixWorld));
      keel = Math.min(keel, _box.min.y);
    }
  }
  // Where that box SITS, in x and z: a hull's geometry is not centred on its
  // origin (a Gato's reaches 56.6 m aft and 38.4 m forward), so a footprint
  // laid out symmetrically about the origin misses one end of her and
  // over-reaches the other. `Ship.deepestContact` needs the centre as well as
  // the extents.
  const centre = [(union.min.x + union.max.x) / 2, (union.min.z + union.max.z) / 2];
  return { size, bottom, centre, keel: Number.isFinite(keel) ? keel : bottom };
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
    // `[x, z]` of the geometry box's centre in the hull's own frame: where the
    // footprint the grounding samples actually lies.
    hullCentre: hull.centre,
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
