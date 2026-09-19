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
export function terrainContact(part, terrain, handlers) {
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

    if (lenSq3(_speed) > HANDLER_SPEED_THRESHOLD_SQ) {
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

// --- physics.md §6: the wheel suspension spring -----------------------------

/** `strength * g * (-1/9.82)`: 1.5 at the shipped gravity, gravity-invariant
 *  by construction (physics.md §6's own framing) — the same derivation
 *  `viewer/ground.js`'s `SPRING_GRAVITY_SCALE` uses, from the SAME `GRAVITY`
 *  this module imports rather than a re-typed `-14.73`. */
const SPRING_GRAVITY_SCALE = -GRAVITY / 9.82;

/**
 * INVENTED, not read off the binary — flagged per this track's briefing
 * rather than folded in silently; see this track's report.
 *
 * The corpus documents the spring's restoring FORCE from a KNOWN
 * displacement (physics.md §6, R1 F5's engine-target-velocity note) and
 * that `solveImpulse`'s clamp is what ever changes a wheel's compression in
 * the first place (§6.4: "wheel (SpringTemplate): node.pos += clamp(...)").
 * It says nothing about what that stored compression does across a tick
 * that adds no fresh contact at all — a wheel has no `PhysicsNode` of its
 * own to fall under §3's ordinary "everything zeroes and copies the root"
 * rule, and the corpus's own "Still open" table carries no line for it.
 *
 * Simplest rule consistent with the documented law, using no new tunable
 * number: while unsupported, let the wheel's stored compression decay back
 * toward its rest length (0) at the SAME natural angular frequency
 * `sqrt(strength * |g| / 9.82)` the force law above already implies for
 * THIS wheel — reusing `strength` and `GRAVITY`, inventing nothing but the
 * choice to use them this way. Damping is deliberately left out of the
 * decay itself (adding it would mean inventing a damping RATIO, not reusing
 * an authored number) — the wheel still stops relaxing exactly where the
 * force law's own damping term already made it stop oscillating on the way
 * down, since `apply` recomputes `rate` from the same `displacement` this
 * function returns.
 *
 * Isolated here, alone, so a future pass that pins the real behaviour down
 * (or decides "freeze" — the literal-minimal reading — is more honest) can
 * replace it without hunting through `WheelSpring`.
 */
function relaxDisplacement(displacement, strength, dt) {
  const omegaSq = strength * SPRING_GRAVITY_SCALE;
  if (!(omegaSq > 0)) return displacement; // authored zero/negative strength: nothing pulls it back
  const decay = Math.max(0, 1 - Math.sqrt(omegaSq) * dt);
  return displacement * decay;
}

const _springAccel = [0, 0, 0];

/**
 * One `PhysicsSpring` wheel's compression state and the force it exerts on
 * the root through that compression (physics.md §6). `displacement` is the
 * engine's `D` recast as a non-negative "how compressed" scalar (0 = rest
 * length, `travel` = fully bottomed out) rather than the raw signed
 * `anchor - wheel.getAbsolutePosition()` vector the decompile shows —
 * matching `viewer/ground.js`'s own established `compression`/`travel`
 * convention (its `Wheel` class, `PHY-5`) rather than the spec prose's own
 * sign, because that convention is what makes the force law apply
 * POSITIVELY along "up" with no outer negation — see `apply`'s own doc
 * comment for the full reconciliation. `strength`/`damping`/`travel` come
 * from the wheel's `physics` extras exactly as `viewer/ground.js`'s
 * `collectChassis`/`Wheel` read them off the glb (`strength`/`damping`
 * fields; `travel` has no glb equivalent — `ground.js` gets it from a
 * per-vehicle spec table, so this class takes it as a plain constructor
 * argument rather than inventing a default).
 */
export class WheelSpring {
  constructor({ strength, damping, travel }) {
    this.strength = strength;
    this.damping = damping;
    this.travel = travel;
    /** 0..`travel`; 0 = rest length. */
    this.displacement = 0;
    /** Last tick's `displacement`, for the damper's one-tick backward
     *  difference (physics.md §6's `d(displacement)/dt`). */
    this.previous = 0;
    this._compressedThisCycle = false;
  }

  /**
   * `Response.solve`'s spring branch (`body-contact.js` §6.4) returns the
   * clamped suspension push for a `kind === 'spring'` part — a 3-vector
   * already `d * avgNormal`, `d = clamp(posAdjust.avgNormal -
   * rootPosAdjustCopy.avgNormal, 0, 1)` (metres, at most 1 per tick). This
   * ADDS that push's magnitude to the running `displacement`, clamped to
   * `[0, travel]` — the vector's own direction is not otherwise used here;
   * for the common single-contact case (`avgNormal` a single unit normal,
   * not a multi-contact mean) the magnitude equals `d` exactly, which is
   * the engine's own `node.pos +=` scalar addition along its slider axis.
   */
  compress(push) {
    const mag = Math.hypot(push[0], push[1], push[2]);
    this.displacement = clamp(this.displacement + mag, 0, this.travel);
    this._compressedThisCycle = true;
  }

  /**
   * `PhysicsSpring::updatePhysics` (physics.md §6): `accel = -(strength *
   * displacement * |g|/9.82 + damping * d(displacement)/dt)`, applied to
   * the ROOT at the wheel's (fixed, rest) attach point along the spring
   * axis (`up` — the hull's own +Y, per PHY-5, NOT world-vertical).
   *
   * **Sign reconciliation, read carefully.** The spec's literal formula
   * carries a leading minus and is written against a SIGNED `displacement`
   * (negative while the wheel sags away from its anchor) — textbook
   * Hooke's law, `F = -k*x` about a rest point. This class's own
   * `displacement` is instead the non-negative "how compressed" magnitude
   * `viewer/ground.js` already established and this track's briefing
   * points at directly ("take the same fields... spring strength,
   * damping..."). Under THAT sign convention the restoring push must come
   * out POSITIVE (supports the vehicle) as compression grows, which is
   * exactly `viewer/ground.js`'s own long-working, spec-cited
   * implementation (`load = SPRING_GRAVITY_SCALE*strength*compression +
   * damping*rate`, applied with NO outer negation — see its `integrate`).
   * So: `accelScalar = strength*displacement*SPRING_GRAVITY_SCALE +
   * damping*rate`, no leading minus, `rate` positive while compressING.
   * This is the identical physical law, expressed in the sign convention
   * this class's own state already uses — not a different formula.
   *
   * Deliberately NOT ported from `ground.js`: its `load < 0 -> load = 0`
   * clamp and its `overrun*bumpStiffness` bump-stop, both flagged there as
   * "the viewer's, only the force law is read" — i.e. `ground.js`'s own
   * practical additions, not the spec. Leaving the clamp out keeps this a
   * literal, symmetric damped spring (a damper that also resists rapid
   * REBOUND is correct, stable damped-oscillator behaviour, not a bug);
   * `WheelSpring`'s own `[0, travel]` clamp on `displacement` already
   * stops the compression side from running away without a bump-stop.
   *
   * Then relaxes — see `relaxDisplacement`'s own doc comment; only when
   * `compress` was NOT called since the last `apply` (i.e. the wheel had
   * no ground contact to resolve last tick), matching this track's
   * briefing framing the open question as "how the displacement relaxes
   * WHEN THE WHEEL LEAVES THE GROUND" rather than "every tick, contact or
   * not" — a wheel in continuous contact is governed entirely by
   * `compress`'s own accumulation and the geometry it feeds back into (see
   * `ParkedVehicle.detectGround`), with nothing here fighting it.
   */
  apply(body, attachWorldPos, up, dt) {
    const rate = (this.displacement - this.previous) / dt;
    const accelScalar = this.strength * this.displacement * SPRING_GRAVITY_SCALE + this.damping * rate;
    _springAccel[0] = up[0] * accelScalar;
    _springAccel[1] = up[1] * accelScalar;
    _springAccel[2] = up[2] * accelScalar;
    body.addAccelerationAt(attachWorldPos, _springAccel);

    this.previous = this.displacement;
    if (!this._compressedThisCycle) {
      this.displacement = relaxDisplacement(this.displacement, this.strength, dt);
    }
    this._compressedThisCycle = false;
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
 * A wheel's collision probe is kept at its FIXED rest offset for the
 * `WheelSpring`'s own force calculation (`attachWorldPos`, matching the
 * engine's `anchor`, itself computed from the template's authored, unmoving
 * offset — §6's `PhysicsSpring::updatePhysics`), but `detectGround` writes
 * the CURRENT `displacement` into the part's own `offset` before testing it
 * against the ground. This is not an added embellishment: without it, a
 * wheel's compression would grow without bound (the engine's own
 * `node.pos +=` correction moves the wheel's collision vertices too, which
 * is what makes next tick's penetration test shrink as the wheel settles —
 * see this track's report for the worked-through reasoning). It also means
 * an object-vs-object pass run by the lead against this same part sees a
 * geometrically correct, currently-compressed wheel, not a phantom one
 * pinned at rest height.
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
  constructor({ body, parts, wheels }) {
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

    for (const part of this.parts) {
      part.response.grip = parkedGrip(part.response.grip);
      part.response.liveGrip = part.response.grip;
    }
  }

  /** Springs push the root (physics.md §6) — skipped while the body sleeps
   *  (§4.3: "a sleeping root... its springs and floats skip their force"). */
  accumulate(dt = TICK) {
    if (this.body.sleeping) return;
    const up = this.body.axes[1];
    for (const w of this.wheels) {
      toWorldPoint(this.body, w.restOffset, _attach);
      w.spring.apply(this.body, _attach, up, dt);
    }
  }

  /** `terrainContact` for every part — skipped while asleep (spec §2's
   *  detect pass: "for every part whose node is awake"). Writes each
   *  wheel's CURRENT compression into its part's `offset` first — see this
   *  class's own doc comment for why. */
  detectGround(terrain, handlers) {
    if (this.body.sleeping) return;
    for (const w of this.wheels) {
      const o = w.part.offset, r = w.restOffset;
      o[0] = r[0]; o[1] = r[1] + w.spring.displacement; o[2] = r[2];
    }
    for (const part of this.parts) terrainContact(part, terrain, handlers);
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
    const rootResponse = this.rootPart.response;
    for (const part of this.parts) {
      part.worldPos(_partPosPV);
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
