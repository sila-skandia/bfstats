// Buoyancy: what holds a ship up, and where it ends up floating.
//
// `PhysicsFloatingBundle::updatePhysics` (lnxded `0x0824d640`, client
// `0x0057e980`) is the whole of Refractor's water. A hull hangs some number of
// `FloatingBundle` children — every vanilla capital ship hangs exactly eight —
// and each one adds a **world-vertical** acceleration at its own world
// position. Nothing else levels a ship: pitch and roll righting fall out of
// `addAccelerationAtAbsolutePosition` summing `(P - com) x a` into the torque
// accumulator, so eight nodes at different fore/aft and port/starboard offsets
// at different depths make their own couple.
//
// The law, transcribed (research `features/bf1942-ships-research-2026-09-22`
// §1.3, as corrected by that folder's `VERDICT.md` §2.1, §2.2 and §2.7):
//
//   f    = ((P.y - hullHeight) - waterLevel + sinkOffset) / hullHeight
//   t    = clamp(angle - f*hullHeight, 0, 1)        // from the UNCLAMPED f
//   if (!(f < 0)) return                            // above the reference: nothing
//   f    = max(f, -1)                               // buoyancy saturates
//   lift = (1-t)*floatMinLift + t*floatMaxLift
//   a_y  = (drag * (1 + 24f) * 100 * DX*DZ / mass) * vy          // heave damping
//        + (g * (-f) * lift) / -9.82                             // buoyancy
//
// Three details that a reasonable-looking port gets wrong:
//
//  - **`t` is computed from the unclamped `f`.** `0x0824d718` is `fst`, not
//    `fstp`; the `max(f, -1)` store is at `0x0824d778`, after `t` has already
//    been formed. So submersion depth goes on driving `t` after the buoyancy
//    magnitude has saturated, and that is exactly what makes a submarine's
//    trim angle a **dive depth setpoint in metres** rather than a one-way
//    sink: the boat settles at `depth = angle_Y + 0.5`, where `t = 0.5`,
//    `lift = (min+max)/2 = 1.2275` and `8 * 1.5 * 1.2275 = 14.73 = |g|`
//    exactly. DICE centred the pair on `|g| / (N * 1.5)`.
//  - **`g / -9.82` is exactly 1.5**, not 1.49995. An authored lift is quoted
//    against a 9.82 m/s^2 gravity and the engine runs at -14.73.
//  - **`1 + 24f` really does reverse sign.** The bytes are `(1 - f) + f*25`
//    (`0x0824d890`-`0x0824d8b3`, the 25.0 at `0x086ccce0`), so over
//    `f in [-1, 0)` the coefficient runs `+1 -> -23` and the sliver
//    `f in (-1/24, 0)` is anti-damping. It reads like an intended
//    `lerp(1, 25, |f|)` with a sign slip — that reading is inference, not a
//    read — and it is ported as written, because the sliver is never an
//    equilibrium.
//
// `setWaterHeight` (`FloatingBundleTemplate+0x1b0`) and `setDragModifier`
// (`+0x1c0`) have **no reader anywhere in the image**; the drag in the damping
// term is the parent hull's own `ObjectTemplate.drag` and the area is the
// hull's geometry bounding-box footprint. `Hatsuzuki`'s `setDragModifier 8000`
// does nothing. The waterline is flat: `PatchTerrain::getWaterLevel(x, z)`
// `0x083d7a80` discards both arguments and tail-jumps to
// `WaterPatch::getWaterLevel()` `0x083d96f0` = `fld [this+0x18]`, the level's
// single `GeometryTemplate.waterLevel`. Ships do not bob.
//
// Nothing here imports `three`: the module is plain numbers plus the same
// duck-typed node access `collision.js` and `vehicle-bodies.js` use
// (`userData`, `children`, `matrixWorld.elements`), so it runs under node.

import { RigidBody, TICK } from './rigid-body.js';

/** `BasicPhysicsSystem::getGravity` (vtable `+0x14`, `0x08251ec0`) — a field
 *  read, so -14.73 is configured rather than literal in that function. */
export const GRAVITY = -14.73;

/** The divisor at `0x086d0d6c`: -9.819999694824219. */
export const BUOYANCY_DIVISOR = -9.82;

/** `g / -9.82`. Exactly 1.5 — `9.82 * 1.5 = 14.73`. */
export const LIFT_NORMALISER = 1.5;

/** What `sum (-f_i) * lift_i` has to reach for buoyancy to cancel gravity:
 *  `|g| / LIFT_NORMALISER` = 9.82. */
export const EQUILIBRIUM_SUM = 9.82;

/** The 100.0 at `0x086b01ac`, multiplying the bounding-box footprint. */
export const DAMPING_AREA_SCALE = 100;

/** The 25.0 at `0x086ccce0`: the damping coefficient is `(1 - f) + f*25`. */
export const DAMPING_LERP_TOP = 25;

/** `f` floor, the float32 -1.0 at `0x086b05ec`. */
export const SUBMERSION_FLOOR = -1;

/** `handleMessage`'s own constants: `rate = (q + 0.1) * 0.05 * sinkingSpeedMod`. */
export const SINK_RATE_BIAS = 0.1;
export const SINK_RATE_SCALE = 0.05;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * `f`, unclamped and signed. 0 at `waterLevel + hullHeight`, -1 at `waterLevel`.
 *
 * `hullHeight` is **not** the hull's height. It is the height above the
 * waterline of the reference plane the node's own `y` is measured against —
 * `Fletcher_Floater` declares 20 while sitting 7.5 m above a hull origin on a
 * ship with about 8 m of freeboard. Read as a datum, not a dimension.
 */
export function submersion(nodeY, hullHeight, waterLevel, sinkOffset = 0) {
  return ((nodeY - hullHeight) - waterLevel + sinkOffset) / hullHeight;
}

/**
 * `lift`, from the **unclamped** `f`.
 *
 * `angle` is the node's own `+0xa0`, which `FloatingBundle::handleUpdate`
 * (`0x08240180`) writes as `-angle[1]` of the bundle's `RotationalBundle`
 * angle every update. It is 0 for every ship; only `GatoFloater` and
 * `Sub7C_Floater` (and the two torpedo floaters, which author
 * `min == max` and so cannot notice) declare `maxRotation.y != 0`. Since
 * `-f*hullHeight` is the submersion depth in metres, `t = clamp(depth - angle_Y)`
 * and the angle reads as a depth setpoint.
 */
export function floatLift(f, hullHeight, angle, minLift, maxLift) {
  const t = clamp(angle - f * hullHeight, 0, 1);
  return (1 - t) * minLift + t * maxLift;
}

/**
 * One float node's contribution, m/s^2, world-vertical.
 *
 * Returns 0 when the node is at or above its reference plane — the engine's
 * `if (!(f < 0)) return`, which skips the damping as well as the lift, so a
 * hull lifted clear of the water has no vertical drag either.
 *
 * `areaXZ` is `DX*DZ` of the **hull's** geometry bounding box, and `drag` and
 * `mass` are the hull's too (`PhysicsNode::getDrag` `+0x98`, `getMass`
 * `+0xa0`). That the damping scales with the node count while the area does
 * not is the engine's, not a porting slip.
 */
export function floatAcceleration(float, {
  nodeY, waterLevel, verticalSpeed = 0, angle = 0, sinkOffset = 0,
  drag = 0, mass = 1, areaXZ = 0,
} = {}) {
  const hullHeight = float?.hullHeight;
  if (!(hullHeight > 0) || !(mass > 0)) return 0;
  const raw = submersion(nodeY, hullHeight, waterLevel, sinkOffset);
  const minLift = float.floatMinLift ?? float.floatMaxLift ?? 0;
  const maxLift = float.floatMaxLift ?? minLift;
  const lift = floatLift(raw, hullHeight, angle, minLift, maxLift);
  if (!(raw < 0)) return 0;
  const f = Math.max(raw, SUBMERSION_FLOOR);
  const damping = drag * (1 + (DAMPING_LERP_TOP - 1) * f)
    * DAMPING_AREA_SCALE * areaXZ / mass;
  return damping * verticalSpeed + (GRAVITY * -f * lift) / BUOYANCY_DIVISOR;
}

/**
 * `sum (-f_i) * lift_i` for a hull whose root sits at `rootY`.
 *
 * Monotonically decreasing in `rootY` — raising the hull raises every `f`
 * toward zero, and shallower also means a smaller `t` and so a smaller lift
 * whenever `maxLift > minLift`. Both terms pull the same way, which is what
 * makes `equilibriumRootY`'s bisection safe.
 */
export function floatSupport(floats, rootY, waterLevel, angle = 0) {
  let total = 0;
  for (const float of floats) {
    const hullHeight = float?.hullHeight;
    if (!(hullHeight > 0)) continue;
    const raw = submersion(rootY + (float.offsetY || 0), hullHeight, waterLevel);
    if (!(raw < 0)) continue;
    const minLift = float.floatMinLift ?? float.floatMaxLift ?? 0;
    const maxLift = float.floatMaxLift ?? minLift;
    total += -Math.max(raw, SUBMERSION_FLOOR)
      * floatLift(raw, hullHeight, angle, minLift, maxLift);
  }
  return total;
}

/**
 * The root `y` a hull floats at, in closed form. `null` when it cannot float.
 *
 * At rest `vy = 0`, the damping term vanishes and the buoyancy has to cancel
 * the `acc = (0, g, 0)` the integrator seeds, so the condition is
 * `sum (-f_i) * lift_i * 1.5 = |g|`, i.e. `floatSupport = 9.82`. For the eight
 * vanilla capital ships — all eight float nodes at one height and one template,
 * `t` saturated at 1 — that closes to
 * `rootY = waterLevel + H - 9.82*H/(N*floatMaxLift) - relY`; the bisection here
 * is the same root without the uniformity assumption, so it also handles a
 * `Gato` (whose `t` is not saturated, and whose `angle` may be a dive
 * setpoint) and the `Elco80`/`Type38` hulls that mix two floater templates at
 * four heights.
 *
 * This is preferred over iterating the law because the iteration is heavily
 * overdamped: zeta is about 15 for a Fletcher, whose slow pole is `k/c` = about
 * 0.036 per second, so it needs roughly 2,510 ticks to come within a
 * centimetre (VERDICT §2.2). A 300-tick settle leaves a Fletcher 0.147 m and a
 * Hatsuzuki 0.180 m high.
 *
 * `null` is the honest answer for a hull that sinks: fully submerged every
 * `f` is pinned at -1 and every `t` at 1, so the support saturates at
 * `sum floatMaxLift`. If that is under 9.82 no depth can hold the hull up.
 * (For a `Gato`, `8 * 1.6275 = 13.02 > 9.82`, so it floats.)
 */
export function equilibriumRootY(floats, waterLevel, { angle = 0 } = {}) {
  const usable = (floats || []).filter(f => f?.hullHeight > 0);
  if (!usable.length) return null;
  // `hi`: every node at or above its own reference plane, so every `f >= 0` and
  // the support is 0.
  const hi0 = waterLevel + Math.max(...usable.map(f => f.hullHeight - (f.offsetY || 0)));
  // `lo`: found by doubling downward rather than by a formula, because how deep
  // "deep enough" is depends on the trim angle. The support only saturates once
  // every `f` has floored at -1 AND every `t` has reached 1, and `t` is
  // `clamp(angle - f*H)` off the UNCLAMPED `f` — so for a Gato trimmed to 50 m
  // the support is still climbing 50 m under the waterline. A hull whose
  // saturated support cannot reach 9.82 sinks, and gets `null`.
  let lo = hi0;
  for (let span = 1; span <= 1 << 20; span *= 2) {
    lo = hi0 - span;
    if (floatSupport(usable, lo, waterLevel, angle) >= EQUILIBRIUM_SUM) break;
  }
  let hi = hi0;
  if (floatSupport(usable, lo, waterLevel, angle) < EQUILIBRIUM_SUM) return null;
  for (let i = 0; i < 200; i++) {
    const mid = 0.5 * (lo + hi);
    if (floatSupport(usable, mid, waterLevel, angle) > EQUILIBRIUM_SUM) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/**
 * The per-node sink rate `FloatingBundle::handleMessage` arms, metres per tick.
 *
 * `0x082402b0`, TemplateMessage **`0x14`** only — `criticalDamage`, not death.
 * `0x15` (destroyed) sets the wreck byte and leaves the rate alone, and `0x13`
 * (safe again) clears the wreck byte. The single reader of `sinkingSpeedMod`
 * is `fmul [edx+0x1c4]` at `0x08240551`.
 *
 *   q    = clamp((2R + (P.z - C.z) + (P.x - C.x)) / (4R), 0, 1)
 *   rate = (q + 0.1) * 0.05 * sinkingSpeedMod
 *
 * `R` is the hull's bounding radius and `C` its centre, so `q` differs per
 * node and the ship goes down by one end. On a capital ship `q` spans about
 * 0.30 to 0.70 — a spread of about **2:1**, not the 11:1 that "a bow-starboard
 * node gets 1, a stern-port node 0" implies (VERDICT §2.4). `sinkingSpeedMod 0`
 * means never: both rafts set it on all four floaters, and the vanilla hull
 * that actually rolls as it goes down is the **LCVP** (three `Lcvp_Floater` at
 * mod 1, one `Lcvp_Floater2` at mod 7).
 */
export function sinkRate(float, { offsetX = 0, offsetZ = 0, boundingRadius = 0 } = {}) {
  const mod = float?.sinkingSpeedMod ?? 0;
  if (!mod || !(boundingRadius > 0)) return 0;
  const q = clamp((2 * boundingRadius + offsetZ + offsetX) / (4 * boundingRadius), 0, 1);
  return (q + SINK_RATE_BIAS) * SINK_RATE_SCALE * mod;
}

/**
 * Every `FloatingBundle` under a vehicle root, as this module's descriptors.
 *
 * A float node is a **point**: `setPhysicsNodeComponent` (`0x08241090`)
 * allocates a `0xb4`-byte node and copies only the two lifts into it, and the
 * node carries no collision mesh of its own, which is why `describeVehicleParts`
 * never sees one. The offsets are taken from the live world matrices rather
 * than the authored translations so a rotated hull is still measured in world
 * metres — `addAccelerationAtAbsolutePosition` is a world-space call, and the
 * force is world-vertical whatever the hull's attitude.
 */
export function floatNodesOf(root) {
  if (!root) return [];
  root.updateWorldMatrix?.(true, true);
  const rootE = root.matrixWorld?.elements;
  if (!rootE) return [];
  const out = [];
  const visit = node => {
    const physics = node.userData?.physics;
    if (node.userData?.templateKind === 'FloatingBundle' && physics?.hullHeight > 0) {
      const e = node.matrixWorld.elements;
      out.push({
        node,
        hullHeight: physics.hullHeight,
        floatMinLift: physics.floatMinLift ?? physics.floatMaxLift ?? 0,
        floatMaxLift: physics.floatMaxLift ?? physics.floatMinLift ?? 0,
        sinkingSpeedMod: physics.sinkingSpeedMod ?? 0,
        offsetX: e[12] - rootE[12],
        offsetY: e[13] - rootE[13],
        offsetZ: e[14] - rootE[14],
      });
    }
    for (const child of node.children || []) visit(child);
  };
  visit(root);
  return out;
}

// --- a hull going down ---------------------------------------------------------

/**
 * Body-local offsets for float nodes read in world space.
 *
 * `floatNodesOf` measures each node against the hull's world origin, which is
 * what the law wants — it is a world-space call — but a hull that turns or
 * lists has to rotate them every tick, so they are taken into the body frame
 * once. `axes` is the row convention the body modules use: `axes[i]` is the
 * body's i-th axis in world space, so the body-frame component is the dot.
 */
export function localiseFloats(floats, axes) {
  return (floats || []).map(float => {
    const w = [float.offsetX || 0, float.offsetY || 0, float.offsetZ || 0];
    return {
      ...float,
      local: [
        w[0] * axes[0][0] + w[1] * axes[0][1] + w[2] * axes[0][2],
        w[0] * axes[1][0] + w[1] * axes[1][1] + w[2] * axes[1][2],
        w[0] * axes[2][0] + w[1] * axes[2][1] + w[2] * axes[2][2],
      ],
      sinkOffset: 0,
      sinkRate: 0,
      angle: 0,
    };
  });
}

/**
 * An unmanned hull in the water: afloat, and then going down by one end.
 *
 * A `RigidBody` is the engine's `PhysicsNode` (`rigid-body.js` is that read),
 * and a ship in Refractor is exactly that plus its `FloatingBundle` children
 * calling `addAccelerationAtAbsolutePosition` on it. So this class is the
 * wiring and nothing else: post each node's force at each node's world
 * position, then step.
 *
 * `arm()` is `FloatingBundle::handleMessage`'s `0x14` branch — **critical
 * damage, not death**. `0x15` (destroyed) sets the wreck byte and leaves the
 * rate alone, so a ship blown apart in one blow may never start sinking at all;
 * whether `Armor::status` can reach `0x15` without passing `0x14` is UNVERIFIED
 * in the corpus and is not modelled here either way.
 *
 * Each node gets its own rate out of `sinkRate`, so the offsets diverge and the
 * hull goes down by the end whose nodes sink fastest. That is the whole visual,
 * and it costs nothing: the righting couple is already emergent from eight
 * nodes at eight depths.
 *
 * What is NOT modelled: the hull's own box drag (a sinking hull barely
 * translates horizontally, and the float nodes carry the heave damping). A
 * `Ship` under the player holds the same float descriptors, so the manned case
 * is the same law and the same accumulator through a different integrator.
 */
export class FloatingHull {
  constructor({
    floats, mass = 1, box = null, inertiaModifier = [1, 1, 1],
    waterLevel = 0, drag = 0, boundingRadius = 0,
    position = [0, 0, 0], axes = null,
  } = {}) {
    this.body = new RigidBody({ mass, box, inertiaModifier, position, axes });
    // A `RigidBody` is born with an empty accumulator, because the engine's is:
    // the gravity a tick uses was written at the end of the tick before it
    // (rigid-body.js F8). A hull that has been floating since the level loaded
    // is not a body that has just been constructed, though, and starting it a
    // whole tick of gravity short kicks it half a metre a second upward, which
    // on a 28-second time constant takes minutes to come back. Seeding the
    // accumulator is the "this body has already been ticking" state.
    this.body.acc[1] = GRAVITY * this.body.gravityModifier;
    this.floats = floats || [];
    this.waterLevel = waterLevel;
    this.drag = drag;
    this.mass = mass;
    this.boundingRadius = boundingRadius;
    this.areaXZ = box ? box[0] * box[2] : 0;
    this.armed = false;
    this._p = [0, 0, 0];
    this._v = [0, 0, 0];
    this._a = [0, 0, 0];
  }

  /** `FloatingBundle::handleMessage(0x14)`: each node takes its own rate. */
  arm() {
    if (this.armed) return false;
    this.armed = true;
    for (const float of this.floats) {
      float.sinkRate = sinkRate(float, {
        offsetX: float.local[0], offsetZ: float.local[2],
        boundingRadius: this.boundingRadius,
      });
    }
    return true;
  }

  /** One node's world position, through the hull's current pose. */
  nodeWorld(float, out = this._p) {
    const { pos, axes } = this.body;
    const l = float.local;
    for (let i = 0; i < 3; i++) {
      out[i] = pos[i] + l[0] * axes[0][i] + l[1] * axes[1][i] + l[2] * axes[2][i];
    }
    return out;
  }

  /**
   * One tick: the accumulator, then the body.
   *
   * The offset accumulates first and wakes the hull, exactly as `updatePhysics`
   * does it — the `sinkOffset += sinkRate` and the `setIsAwake()` are the first
   * thing in that function, ahead of the sleep test, which is why a sinking
   * ship never sleeps.
   */
  step(dt = TICK) {
    const body = this.body;
    for (const float of this.floats) {
      if (float.sinkRate) { float.sinkOffset += float.sinkRate; body.wake(); }
    }
    // **A sleeping ship makes no lift.** `updatePhysics` copies the root's
    // sleepiness and returns before it touches the water, and that early return
    // is load-bearing here rather than an optimisation: a hull resting at its
    // draft sleeps after a hundred quiet ticks, and a body that wakes takes its
    // first tick with an empty accumulator — one tick of pure buoyancy, half a
    // metre a second upward. Posting lift into a sleeping hull therefore walks
    // it up out of the water, a centimetre per sleep cycle. A hull with a sink
    // rate never reaches this line: the accumulator above wakes it every tick,
    // which is why a sinking ship never sleeps.
    if (body.sleeping) { body.step(dt); return body; }
    for (const float of this.floats) {
      const p = this.nodeWorld(float, this._p);
      body.tangentSpeed(p, this._v);
      const a = floatAcceleration(float, {
        nodeY: p[1], waterLevel: this.waterLevel, verticalSpeed: this._v[1],
        angle: float.angle || 0, sinkOffset: float.sinkOffset,
        drag: this.drag, mass: this.mass, areaXZ: this.areaXZ,
      });
      if (a === 0) continue;
      this._a[0] = 0; this._a[1] = a; this._a[2] = 0;
      body.addAccelerationAt(p, this._a);
    }
    body.step(dt);
    return body;
  }
}
