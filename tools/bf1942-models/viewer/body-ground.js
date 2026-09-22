// Terrain contact for one collidable part (`ResponsePhysics::checkVsTerrain`,
// `features/bf1942-engine-reference/subsystems/collision-response.md` §7 —
// call it "the spec" below), the wheel suspension spring
// (`PhysicsSpring::updatePhysics`, `physics.md` §6), and `ParkedVehicle`: the
// three engine-order phases (spec §2) that settle a parked, unoccupied
// vehicle onto the ground, hold it there under static friction, and let a
// collision impulse shove it, spin it and slide it to a stop.
//
// Framework-free like `body-friction.js` — no three.js, no DOM — so
// `tests/body_ground_harness.mjs` runs it under plain node. A **part** is
// duck-typed to `body-contact.js`'s `CollisionPart` shape (`IMPLEMENTATION.md`
// "Shared interfaces"): `body`, `shape` (`{layers: [{vertices,
// vertexMaterials, min, max}, ...]}`), `response` (a `body-friction.js`-
// compatible `Response`), `isRoot`, `offset` (body-local, MUTABLE — see
// `ParkedVehicle.detectGround` below), `rot`, `kind`, `worldPos(out)`,
// `worldVertex(layer, i, out)`. A **terrain** is `{height(x,z),
// normal(x,z,out), material(x,z), waterLevel}`. This module imports
// `GRAVITY`/`TICK` from `rigid-body.js` and `addFriction`/`parkedGrip`/
// `GRIP_*` from `body-friction.js` — both files this track also owns and
// both named in this track's own reading list — but never `body-contact.js`
// itself: every part/response field this module touches is read or written
// by field name, the same discipline `crash-damage.js` already uses.
//
// No per-tick allocation in hot paths: every intermediate vector is a
// module-level scratch array. Neither `terrainContact` nor `ParkedVehicle`'s
// methods are reentrant — each completes before the next begins.

import { GRAVITY, TICK } from './rigid-body.js';
import {
  addFriction, parkedGrip,
  WAKE_CONTACT_SPEED_SQ as HANDLER_SPEED_THRESHOLD_SQ,
} from './body-friction.js';

function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
function lenSq3(v) { return v[0] * v[0] + v[1] * v[1] + v[2] * v[2]; }

// --- §7: terrain contact for one part ---------------------------------------

const _w = [0, 0, 0];
const _C = [0, 0, 0];
const _N = [0, 0, 0];
const _speed = [0, 0, 0];
const _relPos = [0, 0, 0];
const _partPosTC = [0, 0, 0];
const _bodyV = [0, 0, 0];

/**
 * `ResponsePhysics::checkVsTerrain` for ONE part (§7, R1 F3, V1). The part's
 * own col0 (layer-0) vertices dropped onto the heightfield: vertex 0 only
 * when the layer has 3 or fewer (a wheel's few-vertex probe collapses to one
 * test — R1: "the `n<=3 -> n=1` rule is how a 3-vertex wheel mesh becomes a
 * single contact point"), every vertex tested otherwise. The `n>10`
 * bounding-box early-out (R1 F3's `doCheck`) is deliberately NOT ported —
 * this track's briefing calls for testing every vertex, and a viewer's
 * collision meshes are small enough that the early-out only ever saved a
 * server a few dozen redundant height look-ups, never changed a result.
 * Likewise not ported: the soldier `n=5` override — `ParkedVehicle` never
 * carries a `kind === 'soldier'` part, so this module has no case to
 * exercise it against.
 *
 * Per vertex in contact (`depth <= 0`): `handlers.onTerrain` runs (result
 * ignored, exactly like the engine discards `handleCollision`'s return for
 * terrain — §7) only above the same 0.1 squared-speed floor `body-contact.js`
 * uses for object contacts, then `impulseOn` ALWAYS runs, with an implicit
 * share of 1.0 (no share parameter exists for terrain — R1 F3).
 *
 * Water (`terrain.waterLevel` finite and the LOWEST tested vertex, `minY`
 * over every vertex regardless of contact, below it): `handlers.onWater`
 * every tick this holds, no impulse. `bodyV` is the root's own plain
 * velocity (`root.getPositionalSpeed()`, R1 F3 — NOT a tangent speed at any
 * point). `depthBelow` is `terrain.waterLevel - minY`, the vertex-based
 * submersion depth the engine itself uses for `setUnderWater`'s drag scaling
 * (physics.md §3) — not the OTHER water quantity the spec's own
 * `handleCollision` call passes (`water - P.y`, the part's ORIGIN height,
 * used only to marshal that call's `relPos` argument). This module's
 * `onWater` is a stand-in for the whole notification, so the always-
 * non-negative submersion reading is the more useful number to hand a
 * caller; see this track's report for the alternative and why it was not
 * chosen.
 *
 * @returns {number} how many of the tested vertices were in contact this
 *   call (for tests/diagnostics; the spec has no equivalent return value)
 */
export function terrainContact(part, terrain, handlers, reportTerrainDamage = true) {
  const layer0 = part.shape.layers[0];
  if (!layer0 || !layer0.vertices) return 0;
  const rawCount = layer0.vertices.length / 3;
  if (rawCount === 0) return 0;
  const n = rawCount <= 3 ? 1 : rawCount;

  part.worldPos(_partPosTC);

  let minY = Infinity;
  let contacts = 0;

  for (let i = 0; i < n; i++) {
    part.worldVertex(0, i, _w);
    if (_w[1] < minY) minY = _w[1];

    const h = terrain.height(_w[0], _w[2]);
    const depth = _w[1] - h;
    if (depth > 0) continue;

    _C[0] = _w[0]; _C[1] = h; _C[2] = _w[2];
    terrain.normal(_w[0], _w[2], _N);
    part.body.tangentSpeed(_C, _speed);

    const matSelf = layer0.vertexMaterials ? layer0.vertexMaterials[i] : 0;
    const matTerrain = terrain.material(_w[0], _w[2]);

    if (reportTerrainDamage && lenSq3(_speed) > HANDLER_SPEED_THRESHOLD_SQ) {
      handlers.onTerrain(part, _speed, _N, _C, matSelf, matTerrain);
    }

    const mv = handlers.materialValues(matSelf, matTerrain);
    _relPos[0] = _C[0] - _partPosTC[0];
    _relPos[1] = _C[1] - _partPosTC[1];
    _relPos[2] = _C[2] - _partPosTC[2];
    part.response.impulseOn(_relPos, _speed, _N, depth, mv.friction, mv.elasticity, mv.resistance);
    contacts++;
  }

  if (Number.isFinite(terrain.waterLevel) && minY < terrain.waterLevel) {
    const v = part.body.v;
    _bodyV[0] = v[0]; _bodyV[1] = v[1]; _bodyV[2] = v[2];
    handlers.onWater(part, _bodyV, terrain.waterLevel - minY);
  }

  return contacts;
}

// --- the wheel suspension spring --------------------------------------------
//
// Read from `PhysicsSpring::updatePhysics` (lnxded `0x0824ddd0`, decompiled
// 2026-09-20), which settles what physics.md section 6 left as a scalar
// formula. Per tick, for each wheel:
//
//   anchor = the wheel's authored relative position, through its parent's
//            absolute transformation                       (a world point)
//   D      = anchor - wheelNode.absolutePosition           (a world VECTOR)
//   store D as next tick's "previous"                      (asleep or not)
//   if the root is awake:
//     reset the wheel's relative transformation to its authored position
//     a = -( strength * D * (g * -0.101833)  +  damping * (D - Dprev) / dt )
//     root.addAccelerationAtRelativePosition(anchor - root.pos, a)
//
// So the wheel **snaps back to its rest position every tick**, and the only
// thing that ever moves it is `solveImpulse`'s spring branch, which pushes it
// along the averaged contact normal by `clamp(penetration, 0, 1)` during the
// resolve pass. D is therefore minus that push: the compression is measured
// afresh each tick as how far the rest-pose wheel sank into the ground, it is
// a vector along the *ground's* normal rather than the body's up axis (a
// taildragger standing nose-high is not pushed backwards by its own springs),
// and there is no travel limit and no relaxation state to invent.
// `g * -0.101833` is 1.49999 at the shipped gravity.

const SPRING_GRAVITY_SCALE = GRAVITY * -0.101833;

const _springAccel = [0, 0, 0];

export class WheelSpring {
  constructor({ strength, damping }) {
    this.strength = strength;
    this.damping = damping;
    /** This tick's push from `Response.solve` (world vector along the contact normal). */
    this.push = [0, 0, 0];
    /** Last tick's D, for the damper's backward difference. */
    this.previous = [0, 0, 0];
  }

  /** `solveImpulse`'s spring branch moved the wheel by `push` this tick. */
  compress(push) {
    this.push[0] = push[0]; this.push[1] = push[1]; this.push[2] = push[2];
  }

  /** How far the wheel is compressed right now, metres. */
  get displacement() {
    return Math.hypot(this.push[0], this.push[1], this.push[2]);
  }

  /**
   * One `PhysicsSpring::updatePhysics`. `anchorWorld` is the wheel's rest
   * position in world space; `asleep` skips the force but still rolls the
   * damper's history forward, as the engine does.
   */
  apply(body, anchorWorld, dt = TICK, asleep = false) {
    const prev = this.previous, push = this.push;
    // D = anchor - wheelPos, and the wheel sits at anchor + push.
    const dx = -push[0], dy = -push[1], dz = -push[2];
    if (!asleep) {
      const k = this.strength * SPRING_GRAVITY_SCALE, c = this.damping / dt;
      _springAccel[0] = -(k * dx + c * (dx - prev[0]));
      _springAccel[1] = -(k * dy + c * (dy - prev[1]));
      _springAccel[2] = -(k * dz + c * (dz - prev[2]));
      body.addAccelerationAt(anchorWorld, _springAccel);
      // The wheel is reset to its rest position: nothing carries over.
      push[0] = push[1] = push[2] = 0;
    }
    prev[0] = dx; prev[1] = dy; prev[2] = dz;
  }
}

// --- ParkedVehicle: the three engine-order phases (spec §2) ----------------

function toWorldPoint(body, localOffset, out) {
  const ax = body.axes[0], ay = body.axes[1], az = body.axes[2];
  const lx = localOffset[0], ly = localOffset[1], lz = localOffset[2];
  out[0] = body.pos[0] + lx * ax[0] + ly * ay[0] + lz * az[0];
  out[1] = body.pos[1] + lx * ax[1] + ly * ay[1] + lz * az[1];
  out[2] = body.pos[2] + lx * ax[2] + ly * ay[2] + lz * az[2];
  return out;
}

const _attach = [0, 0, 0];
const _partPosPV = [0, 0, 0];
const _rootSnapshot = { posAdjust: [0, 0, 0] };

/**
 * A parked, unoccupied vehicle: one `RigidBody` root, its `CollisionPart`s
 * (a hull part or parts, `kind: 'body'`; wheels, `kind: 'spring'`, each
 * paired with a `WheelSpring`), and the three phases the lead's world loop
 * calls in the engine's own per-tick order (spec §2):
 *
 * ```
 * vehicle.accumulate(dt)         // springs push the root
 * body.step(dt)                  // the lead calls this directly — rigid-body.js
 * vehicle.detectGround(terrain, handlers)
 * ...the lead's object-vs-object pass against every other body...
 * vehicle.resolve(frictionOptsFor)
 * ```
 *
 * Every wheel's authored grip is fixed up ONCE at construction by
 * `parkedGrip` — a `ParkedVehicle` is definitionally unoccupied, so a wheel
 * whose flags include `GRIP_ROLL_WHEN_OCCUPIED` becomes `ContactGrip`
 * (physics.md §6, R1 F9) for good, not re-derived every tick the way the
 * engine's own `PhysicsSpring` does for a vehicle that can be entered.
 *
 * A wheel's collision part stays at its authored rest offset, always: the
 * engine snaps the wheel back there every tick (`PhysicsSpring::updatePhysics`
 * resets its relative transformation), so the penetration `detectGround`
 * finds is the whole compression, measured afresh, and the spring's force
 * follows from it on the next `accumulate`.
 */
export class ParkedVehicle {
  /**
   * @param {object} body a `RigidBody`-shaped root.
   * @param {object[]} parts every collidable `CollisionPart`-shaped piece of
   *   this vehicle, root included, exactly one with `isRoot === true`.
   * @param {{part: object, spring: WheelSpring}[]} wheels the subset of
   *   `parts` that carry a suspension spring, each paired with its own
   *   `WheelSpring`. Each `part.offset` is captured as that wheel's rest
   *   offset HERE, before `detectGround` ever mutates it — construct the
   *   parts with their true rest offsets already in place.
   */
  constructor({ body, parts, wheels, initialWheelState = null }) {
    this.body = body;
    this.parts = parts;
    this.rootPart = parts.find(p => p.isRoot);
    if (!this.rootPart) {
      throw new Error('ParkedVehicle: parts must include exactly one isRoot part');
    }

    this.wheels = wheels.map(w => ({
      part: w.part,
      spring: w.spring,
      restOffset: [w.part.offset[0], w.part.offset[1], w.part.offset[2]],
    }));
    this._wheelByPart = new Map(this.wheels.map(w => [w.part, w]));

    // A driven vehicle hands its live suspension to this parked body when the
    // player exits. Keeping the current compression and damper history avoids
    // treating the handoff as a fresh landing, which otherwise produces the
    // small up/down oscillation visible on every exit.
    if (initialWheelState) {
      const up = body.axes[1];
      for (const wheel of this.wheels) {
        const live = initialWheelState.get(wheel.part.node);
        const compression = live?.compression;
        if (!(compression > 0)) continue;
        const push = wheel.spring.push;
        push[0] = up[0] * compression;
        push[1] = up[1] * compression;
        push[2] = up[2] * compression;
        wheel.spring.previous[0] = -push[0];
        wheel.spring.previous[1] = -push[1];
        wheel.spring.previous[2] = -push[2];
      }
    }

    for (const part of this.parts) {
      part.response.grip = parkedGrip(part.response.grip);
      part.response.liveGrip = part.response.grip;
    }
  }

  /** Springs push the root (physics.md §6) — skipped while the body sleeps
   *  (§4.3: "a sleeping root... its springs and floats skip their force"). */
  accumulate(dt = TICK) {
    const asleep = this.body.sleeping;
    for (const w of this.wheels) {
      toWorldPoint(this.body, w.restOffset, _attach);
      w.spring.apply(this.body, _attach, dt, asleep);
    }
  }

  /** `terrainContact` for every part — skipped while asleep (spec §2's
   *  detect pass: "for every part whose node is awake"). Writes each
   *  wheel's CURRENT compression into its part's `offset` first — see this
   *  class's own doc comment for why. */
  detectGround(terrain, handlers) {
    if (this.body.sleeping) return;
    for (const part of this.parts) {
      // Wheels are suspension contacts, not hull impacts. The driven vehicle
      // path already samples hull-only terrain damage, so reporting a rolling
      // tyre's tangential speed here would slowly destroy every vehicle after
      // the player exits it.
      terrainContact(part, terrain, handlers, part.kind !== 'spring');
    }
  }

  /**
   * `solveImpulse` then `addFriction` for every part, WITH NO SLEEPING TEST
   * (spec §2's resolve pass — what lets an awake attacker's contact move a
   * sleeping victim). A spring part's `solve()` return feeds its
   * `WheelSpring`; every part then runs `addFriction`.
   *
   * @param {(part: object) => {axle?: number[], engineSurfaceSpeed?: number[]}}
   *   [frictionOptsFor] per-part `addFriction` opts — irrelevant for a
   *   parked, engine-off vehicle (every wheel is effectively `ContactGrip`,
   *   §8's `EngineGrip`/`RollGrip` branches never taken), so the default
   *   (`undefined` opts, i.e. `{}`) is correct for this class's own stated
   *   goal; supplied for a caller that wants to exercise the other grips.
   */
  resolve(frictionOptsFor) {
    // `impulseOn` copies the root's positional adjust while contacts are still
    // being found; by the time a wheel is solved here the root's own `solve`
    // has already spent it, so the wheels are handed a snapshot.
    const root = this.rootPart.response.posAdjust;
    _rootSnapshot.posAdjust[0] = root[0];
    _rootSnapshot.posAdjust[1] = root[1];
    _rootSnapshot.posAdjust[2] = root[2];
    for (const part of this.parts) {
      part.worldPos(_partPosPV);
      const rootResponse = part === this.rootPart ? part.response : _rootSnapshot;
      const push = part.response.solve(this.body, _partPosPV, rootResponse);
      if (push) {
        const w = this._wheelByPart.get(part);
        if (w) w.spring.compress(push);
      }
      const opts = frictionOptsFor ? frictionOptsFor(part) : undefined;
      addFriction(part.response, this.body, _partPosPV, opts);
    }
  }
}
