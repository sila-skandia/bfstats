// Turning a placed vehicle into something that can be rammed.
//
// The engine makes no distinction between the jeep you are driving and the
// plane you drive it into: both are a root `PhysicsNode` with collidable parts,
// both are probed, pushed and damaged by the same code
// (`features/bf1942-engine-reference/subsystems/collision-response.md`). The
// viewer grew the other way round — one elaborate drive model for the vehicle
// under the player (`ground.js`, `flight.js`) and frozen scenery for everything
// else — so this module is the seam between the two:
//
//   - `describeVehicleParts` reads a placed vehicle's node tree and the
//     `collision-meshes.json` sidecar into the collision shapes, part offsets
//     and physics numbers the body modules want. It touches scene nodes only
//     through `matrixWorld.elements`, `userData`, `children` and `parent`, the
//     way `collision.js` does, so it imports nothing and runs under node.
//   - `DrivenBody` wraps a `Vehicle`'s own state (`flight.js` `VehicleState`)
//     in the body interface, so the contact solver can probe it, push it and
//     spin it without knowing it is not a `RigidBody`.
//
// Conventions are `IMPLEMENTATION.md`'s: an orientation is three row vectors,
// the body's X, Y, Z axes in world space — which for a three.js matrix are its
// first three columns.

import { boxInertia, RigidBody, TICK } from './rigid-body.js';
import { CollisionPart, Response } from './body-contact.js';
import { ParkedVehicle, WheelSpring } from './body-ground.js';

/** Acceleration clamp shared with `rigid-body.js` (spec 4.2): |a| <= 1000. */
const ACCEL_LIMIT = 1000;

// --- small algebra, no allocation ---------------------------------------------

function cross(a, b, out) {
  const x = a[1] * b[2] - a[2] * b[1];
  const y = a[2] * b[0] - a[0] * b[2];
  const z = a[0] * b[1] - a[1] * b[0];
  out[0] = x; out[1] = y; out[2] = z;
  return out;
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Rows of the rotation a unit quaternion `{x, y, z, w}` stands for. */
export function axesFromQuaternion(q, out) {
  const { x, y, z, w } = q;
  const xx = x * x, yy = y * y, zz = z * z;
  const xy = x * y, xz = x * z, yz = y * z;
  const wx = w * x, wy = w * y, wz = w * z;
  // Column i of the rotation matrix is the image of basis vector i: the body's
  // i-th axis in world space, which is row i of `axes`.
  out[0][0] = 1 - 2 * (yy + zz); out[0][1] = 2 * (xy + wz);     out[0][2] = 2 * (xz - wy);
  out[1][0] = 2 * (xy - wz);     out[1][1] = 1 - 2 * (xx + zz); out[1][2] = 2 * (yz + wx);
  out[2][0] = 2 * (xz + wy);     out[2][1] = 2 * (yz - wx);     out[2][2] = 1 - 2 * (xx + yy);
  return out;
}

/** The unit quaternion for three orthonormal row axes; writes `{x, y, z, w}`. */
export function quaternionFromAxes(axes, out) {
  // m[r][c] with columns = body axes.
  const m00 = axes[0][0], m10 = axes[0][1], m20 = axes[0][2];
  const m01 = axes[1][0], m11 = axes[1][1], m21 = axes[1][2];
  const m02 = axes[2][0], m12 = axes[2][1], m22 = axes[2][2];
  const trace = m00 + m11 + m22;
  let x, y, z, w;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    w = 0.25 / s; x = (m21 - m12) * s; y = (m02 - m20) * s; z = (m10 - m01) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    w = (m21 - m12) / s; x = 0.25 * s; y = (m01 + m10) / s; z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    w = (m02 - m20) / s; x = (m01 + m10) / s; y = 0.25 * s; z = (m12 + m21) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = 0.25 * s;
  }
  const n = Math.hypot(x, y, z, w) || 1;
  out.x = x / n; out.y = y / n; out.z = z / n; out.w = w / n;
  return out;
}

// --- collision shapes from the sidecar -----------------------------------------

const shapeCache = new WeakMap();

/**
 * A `collision-meshes.json` mesh entry as the collision shape of
 * `IMPLEMENTATION.md`: typed arrays per layer, bounds, a bounding radius.
 * Cached per entry — every Willy on the map shares one shape.
 */
export function shapeFromMeshEntry(entry) {
  let shape = shapeCache.get(entry);
  if (shape) return shape;
  let radius = 0;
  const layers = entry.layers.map(layer => {
    const vertices = Float32Array.from(layer.v);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < vertices.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const c = vertices[i + k];
        if (c < min[k]) min[k] = c;
        if (c > max[k]) max[k] = c;
      }
      radius = Math.max(radius, Math.hypot(vertices[i], vertices[i + 1], vertices[i + 2]));
    }
    return {
      vertices,
      vertexMaterials: Uint16Array.from(layer.vm),
      faces: Uint32Array.from(layer.f),
      faceMaterials: Uint16Array.from(layer.fm),
      normals: Float32Array.from(layer.n),
      min, max,
    };
  });
  shape = { layers, radius, bbox: entry.bbox };
  shapeCache.set(entry, shape);
  return shape;
}

/** The sidecar entry a glb collision node's `sourceGeometry` resolves to. */
export function meshEntryFor(collisionMeshes, sourceGeometry) {
  if (!collisionMeshes || !sourceGeometry) return null;
  const key = String(sourceGeometry).toLowerCase();
  const file = collisionMeshes.geometries?.[key] ?? key;
  return collisionMeshes.meshes?.[file] ?? null;
}

// --- a placed vehicle's parts --------------------------------------------------

/**
 * `partWorld` relative to `rootWorld`, both three.js column-major 4x4 arrays,
 * as `{ offset, rot }` in the body frame. Rigid transforms only: a placed
 * vehicle is never scaled, and a scale here would corrupt every probe.
 */
function relativeTransform(rootWorld, partWorld) {
  const rootAxes = [
    [rootWorld[0], rootWorld[1], rootWorld[2]],
    [rootWorld[4], rootWorld[5], rootWorld[6]],
    [rootWorld[8], rootWorld[9], rootWorld[10]],
  ];
  const d = [partWorld[12] - rootWorld[12], partWorld[13] - rootWorld[13],
    partWorld[14] - rootWorld[14]];
  const offset = [dot(d, rootAxes[0]), dot(d, rootAxes[1]), dot(d, rootAxes[2])];
  const rot = [];
  for (let i = 0; i < 3; i++) {
    const axis = [partWorld[4 * i], partWorld[4 * i + 1], partWorld[4 * i + 2]];
    const len = Math.hypot(axis[0], axis[1], axis[2]) || 1;
    rot.push([dot(axis, rootAxes[0]) / len, dot(axis, rootAxes[1]) / len,
      dot(axis, rootAxes[2]) / len]);
  }
  return { offset, rot };
}

/**
 * Everything the body modules need to know about one placed vehicle.
 *
 * Walks `root` for the collision nodes the assembler hangs under each part
 * (`userData.collision`, `sourceGeometry`), resolves each through the sidecar,
 * and reads the root's own `physics` / `armor` extras. A part is a wheel when
 * the node it hangs from is a `Spring`; everything else is hull.
 *
 * The inertia box is the hull's visual bounding box — the engine asks the
 * object for its own geometry, and failing that the highest LOD's
 * (`updateRotationalPhysics`, spec 4.2), which for every vehicle is the hull
 * mesh. Among several hull parts the largest box stands for it.
 *
 * Returns null when the vehicle has no mass (a stationary gun, a spawner for
 * something static) or none of its parts resolve: such a thing stays scenery.
 */
export function describeVehicleParts(root, collisionMeshes) {
  const physics = root?.userData?.physics;
  if (!physics || !(physics.mass > 0)) return null;
  const rootWorld = root.matrixWorld.elements;
  const parts = [];
  let hullBox = null, hullVolume = -1;

  const visit = node => {
    const data = node.userData;
    if (data?.collision && data.sourceGeometry) {
      const entry = meshEntryFor(collisionMeshes, data.sourceGeometry);
      if (entry && entry.layers.length && entry.layers[0].v.length) {
        const owner = node.parent;
        const isSpring = owner?.userData?.templateKind === 'Spring';
        const { offset, rot } = relativeTransform(rootWorld, node.matrixWorld.elements);
        parts.push({
          node: owner, kind: isSpring ? 'spring' : 'body',
          shape: shapeFromMeshEntry(entry), offset, rot,
          spring: isSpring ? (owner.userData.physics || null) : null,
        });
        if (!isSpring) {
          const [lo, hi] = entry.bbox;
          const size = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
          const volume = size[0] * size[1] * size[2];
          if (volume > hullVolume) { hullVolume = volume; hullBox = size; }
        }
      }
    }
    for (const child of node.children) visit(child);
  };
  visit(root);
  if (!parts.length || !hullBox) return null;

  // The first hull part stands for the root: the engine tests child part
  // against child part never, root against anything always (spec 5.2).
  const rootPart = parts.find(p => p.kind === 'body');
  for (const part of parts) part.isRoot = part === rootPart;

  let boundingRadius = 0;
  for (const part of parts) {
    boundingRadius = Math.max(boundingRadius,
      Math.hypot(part.offset[0], part.offset[1], part.offset[2]) + part.shape.radius);
  }
  const armor = root.userData.armor || {};
  return {
    parts, box: hullBox, boundingRadius,
    mass: physics.mass,
    inertiaModifier: physics.inertiaModifier || [1, 1, 1],
    // Engine defaults where the template authors nothing (spec section 3).
    speedMod: physics.speedMod ?? 0.05,
    angleMod: physics.angleMod ?? 0,
    damageMod: physics.damageMod ?? 1,
    damageFromWater: !!(armor.damageFromWater ?? physics.damageFromWater),
  };
}

// --- the vehicle under the player, as a body -----------------------------------

/**
 * A driven `Vehicle` (`ground.js`, `flight.js`) seen through the body
 * interface.
 *
 * The drive model keeps its own state and integrator; this reads it before a
 * world tick (`sync`) and writes the contact solver's verdict back after it
 * (`flush`). The positional push-out lands immediately, as the engine's does.
 * The velocity change is posted as an acceleration at the contact point and
 * becomes `dv = a * dt` and `dw = sum over body axes of proj(r x a) * dt /
 * (inertiaModifier * I)` with the engine's box inertia — the same arithmetic
 * `RigidBody.step` runs, applied to the drive model's state one tick early
 * rather than one tick late, which no one can see at 30 Hz.
 *
 * Contact *friction* is dropped: a driven vehicle's tyres are the drive
 * model's business, and a hull-to-hull contact has next to none anyway (the
 * budget scales with the normal's Y, spec section 8). Contact resistance is
 * an acceleration and is kept.
 */
export class DrivenBody {
  constructor(vehicle, { mass, inertiaModifier = [1, 1, 1], box, boundingRadius }) {
    this.vehicle = vehicle;
    this.mass = mass;
    this.isStatic = false;
    this.boundingRadius = boundingRadius;
    this.inertiaModifier = inertiaModifier;
    this.inertia = boxInertia(box[0], box[1], box[2]);
    this.pos = [0, 0, 0];
    this.axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    this.v = [0, 0, 0];
    this.w = [0, 0, 0];
    this.acc = [0, 0, 0];
    this.racc = [0, 0, 0];
    this.sleepiness = 100;
    this._r = [0, 0, 0];
    this._t = [0, 0, 0];
    this.sync();
  }

  get sleeping() { return false; }
  wake() {}

  /** Read the drive model's state. Call before every world tick. */
  sync() {
    const s = this.vehicle.state;
    this.pos[0] = s.position.x; this.pos[1] = s.position.y; this.pos[2] = s.position.z;
    axesFromQuaternion(s.orientation, this.axes);
    this.v[0] = s.velocity.x; this.v[1] = s.velocity.y; this.v[2] = s.velocity.z;
    // `angularVelocity` is body rates (the drive models post-multiply their
    // spin), so the world vector is the sum of the axes weighted by it.
    const b = s.angularVelocity;
    for (let k = 0; k < 3; k++) {
      this.w[k] = b.x * this.axes[0][k] + b.y * this.axes[1][k] + b.z * this.axes[2][k];
    }
  }

  tangentSpeed(p, out) {
    const r = this._r;
    r[0] = p[0] - this.pos[0]; r[1] = p[1] - this.pos[1]; r[2] = p[2] - this.pos[2];
    cross(this.w, r, out);
    out[0] += this.v[0]; out[1] += this.v[1]; out[2] += this.v[2];
    return out;
  }

  translate(dp) {
    const p = this.vehicle.state.position;
    p.x += dp[0]; p.y += dp[1]; p.z += dp[2];
    this.pos[0] += dp[0]; this.pos[1] += dp[1]; this.pos[2] += dp[2];
  }

  addAccelerationAt(p, a) {
    const r = this._r;
    r[0] = p[0] - this.pos[0]; r[1] = p[1] - this.pos[1]; r[2] = p[2] - this.pos[2];
    cross(r, a, this._t);
    for (let k = 0; k < 3; k++) { this.acc[k] += a[k]; this.racc[k] += this._t[k]; }
  }

  addAcceleration(a) {
    this.acc[0] += a[0]; this.acc[1] += a[1]; this.acc[2] += a[2];
  }

  addFrictionAt() {}

  /** Hand what the tick's contacts posted to the drive model. */
  flush(dt = TICK) {
    const s = this.vehicle.state;
    const { acc, racc } = this;
    let a2 = dot(acc, acc);
    if (a2 > ACCEL_LIMIT * ACCEL_LIMIT) {
      const k = ACCEL_LIMIT / Math.sqrt(a2);
      acc[0] *= k; acc[1] *= k; acc[2] *= k;
    }
    a2 = dot(racc, racc);
    if (a2 > ACCEL_LIMIT * ACCEL_LIMIT) {
      const k = ACCEL_LIMIT / Math.sqrt(a2);
      racc[0] *= k; racc[1] *= k; racc[2] *= k;
    }
    s.velocity.x += acc[0] * dt; s.velocity.y += acc[1] * dt; s.velocity.z += acc[2] * dt;
    // In body rates the projection onto axis i is simply component i.
    const b = s.angularVelocity;
    b.x += dot(racc, this.axes[0]) * dt / (this.inertiaModifier[0] * this.inertia[0]);
    b.y += dot(racc, this.axes[1]) * dt / (this.inertiaModifier[1] * this.inertia[1]);
    b.z += dot(racc, this.axes[2]) * dt / (this.inertiaModifier[2] * this.inertia[2]);
    acc[0] = acc[1] = acc[2] = 0;
    racc[0] = racc[1] = racc[2] = 0;
  }
}

// --- building bodies out of a description --------------------------------------

/** ContactGrip: what a part with no authored grip gets (template default 1). */
const DEFAULT_GRIP = 1;

/** `CollisionPart`s (and their `Response`s) for a described vehicle on `body`. */
export function collisionPartsFor(spec, body, { hullOnly = false } = {}) {
  const parts = [];
  for (const desc of spec.parts) {
    if (hullOnly && desc.kind !== 'body') continue;
    const grip = desc.kind === 'spring' ? (desc.spring?.gripFlags ?? DEFAULT_GRIP) : DEFAULT_GRIP;
    const part = new CollisionPart({
      body, shape: desc.shape, response: new Response(desc.kind, grip),
      isRoot: desc.isRoot, offset: desc.offset.slice(), rot: desc.rot.map(r => r.slice()),
      kind: desc.kind,
    });
    part.node = desc.node;
    part.spring = desc.spring;
    parts.push(part);
  }
  return parts;
}

/**
 * A described vehicle standing on its own springs at `position` / `axes`.
 *
 * `asleep` parks it the way a level finds it: nothing integrates until a
 * contact wakes it (spec 4.3). Pass false for a vehicle the player has just
 * stepped out of, which should settle where it was left.
 */
export function buildParkedVehicle(spec, { position, axes, asleep = true }) {
  const body = new RigidBody({
    mass: spec.mass, inertiaModifier: spec.inertiaModifier, box: spec.box,
    position, axes,
  });
  body.boundingRadius = spec.boundingRadius;
  if (asleep) body.setSleepiness(0);
  const parts = collisionPartsFor(spec, body);
  const wheels = parts.filter(p => p.kind === 'spring').map(part => ({
    part,
    spring: new WheelSpring({
      strength: part.spring?.strength ?? 0,
      damping: part.spring?.damping ?? 0,
    }),
  }));
  return new ParkedVehicle({ body, parts, wheels });
}

/** The world axle of a wheel part: its own X axis, for RollGrip friction. */
export function wheelFrictionOpts(part) {
  if (part.kind !== 'spring') return undefined;
  const a = part.body.axes, r = part.rot[0];
  _axle[0] = r[0] * a[0][0] + r[1] * a[1][0] + r[2] * a[2][0];
  _axle[1] = r[0] * a[0][1] + r[1] * a[1][1] + r[2] * a[2][1];
  _axle[2] = r[0] * a[0][2] + r[1] * a[1][2] + r[2] * a[2][2];
  _frictionOpts.axle = _axle;
  return _frictionOpts;
}
const _axle = [0, 0, 0];
const _frictionOpts = { axle: _axle, engineSurfaceSpeed: [0, 0, 0] };
