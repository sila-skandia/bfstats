// Rigid-body contacts: find where two collidable parts touch, and turn a
// touch into a push. This is `features/bf1942-engine-reference/subsystems/
// collision-response.md` §5.2, §5.3, §5.5 and §6 (call it "the spec" below;
// section numbers are its numbers) — the broadphase pair filter, the
// direction/weight rule, the vertex-vs-face narrow phase, and the response
// (`impulseOn`/`solveImpulse`). §5.1's grid query and §4's integrator belong
// to `rigid-body.js` (track A); §7/§8 (terrain and friction) to
// `body-ground.js`/`body-friction.js` (track D); §9 (crash damage) to
// `crash-damage.js` (track C).
//
// Framework-free like `armor.js`, `physics.js` and `collision.js` — no
// three.js, no DOM, no imports at all — so `tests/body_contact_harness.mjs`
// runs the real thing under plain node. A **body** is duck-typed (the
// briefing's `IMPLEMENTATION.md`, "Shared interfaces"): `mass`, `isStatic`,
// `pos`/`axes`/`v`/`w`, `sleeping`, `wake()`, `tangentSpeed(p, out)`,
// `translate(dp)`, `addAccelerationAt(p, a)`, `addAcceleration(a)`,
// `addFrictionAt(p, f)`. This module additionally reads `body.boundingRadius`
// — the ROOT's own composite bounding radius, used by the LOD rule (§5.4) and
// the direction rule (§5.3) — which the briefing's compact interface list
// omits but which every caller (`checkObjectVsObject`'s `getBoundingRadius()`
// calls, F9/F6) needs; flagged in the track report as an addition to the
// contract, not an invention.
//
// A **shape** is `{ layers: [{ vertices, vertexMaterials, faces,
// faceMaterials, normals, min, max }, ...], radius }` (col0 = the coarse
// hull, col1 = the fine mesh when present — §5.4). A **CollisionPart** wraps
// one collidable piece of a body: its own `shape`, its `response` (a
// `Response`), and its `offset`/`rot` relative to the body (identity/zero for
// the root part itself).
//
// `impulseOn`'s last three arguments are already-averaged `friction`/
// `elasticity`/`resistance` numbers, not material ids: the spec's own
// `impulseOn(relPos, speed, normal, depth, mat1, mat2)` (§6.3) looks the pair
// up in the material table and averages, but this module carries no material
// table (the briefing's `tables.materials`/`tables.modifiers` belongs to
// whoever calls in). `collidePair`'s `handlers.materialValues(matVertex,
// matFace) -> {friction, elasticity, resistance}` is where that lookup and
// the `0.5*(mat1+mat2)` averaging happens; this module just carries the
// three numbers into `impulseOn`.
//
// **Bug parity, with one named exception** (the briefing, "Ground rules"):
// the engine's low mass-share snap writes `shareB = +1.0` (an inconsistent
// sign — see `LOW_SNAP_SHARE_B` below); this port uses `-1.0` instead.
// Everything else — the `N.y`-blind friction (not this file), the `|v|^2`
// (not `|v|`) sweep margin, the half-of-closing-speed-per-tick response — is
// carried through unchanged.

// --- named spec constants ---------------------------------------------------

/**
 * §6.1's low snap: the binary writes `shareB = +1.0` there (`0x0825a3d5`,
 * confirmed by both L0/C1 and its verifier V0, and again by V3), which pushes
 * a much-lighter face-side body *toward* the vertex side — the wrong
 * direction under `impulseOn`'s own sign convention (posAdjust = -depth*n,
 * speedAdjust = -(v.n)n). The general (unsnapped) branch's sign is negative;
 * `collision-response.md` §6.1 and §12 say to port -1.0 "unless bug parity is
 * the goal". This is that one named exception to bug-for-bug porting.
 */
export const LOW_SNAP_SHARE_B = -1;

/** §6.1: `s > this` snaps to `(shareA, shareB) = (1, 0)`. */
export const SHARE_SNAP_HIGH = 0.95;
/** §6.1: `s < this` snaps to `(shareA, shareB) = (0, LOW_SNAP_SHARE_B)`. */
export const SHARE_SNAP_LOW = 0.05;

/** §5.2 rules 7/8: a part under this radius is never tested alone. */
export const PART_RADIUS_MIN = 0.45;
/** §5.2 rule 9's swept-sphere margin factor: `|v_root|^2 * dt * this`. */
export const SPEED_MARGIN_FACTOR = 0.25;
/** §5.2 rule 9 / §5.5: fewer than this many col0 vertices collapses to 1 probe. */
export const MIN_VERTEX_COUNT = 4;
/** §5.4: the vertex side's root radius below this reads col1 for faces. */
export const FACE_LOD_RADIUS = 4.0;
/** §5.3's "differ by more than 4x": the smaller must be `<= this * larger`. */
export const SIZE_RATIO_SMALL = 0.25;
/** §6.2: below this squared relative speed, handlers are skipped, response still runs. */
export const HANDLER_SPEED_THRESHOLD_SQ = 0.1;
/** §6.4's `g_simulationFps`, the fixed tick rate the acceleration is scaled by. */
export const SIMULATION_FPS = 30;

// --- small vector helpers (no allocation; every `out` is caller-owned) -----

function dot3(ax, ay, az, bx, by, bz) { return ax * bx + ay * by + az * bz; }
function lenSq3(v) { return v[0] * v[0] + v[1] * v[1] + v[2] * v[2]; }

function clamp(value, lo, hi) {
  return value < lo ? lo : (value > hi ? hi : value);
}

/**
 * Row-vector rotation: `rows` are three basis vectors (each `[x,y,z]`)
 * expressed in the target frame, matching the coordinate convention in
 * `IMPLEMENTATION.md` ("an orientation is three unit row vectors"). Local
 * point `(x,y,z)` -> target frame: `x*rows[0] + y*rows[1] + z*rows[2]`.
 */
function rotateByRows(x, y, z, rows, out) {
  const r0 = rows[0], r1 = rows[1], r2 = rows[2];
  out[0] = x * r0[0] + y * r1[0] + z * r2[0];
  out[1] = x * r0[1] + y * r1[1] + z * r2[1];
  out[2] = x * r0[2] + y * r1[2] + z * r2[2];
  return out;
}

/** The inverse of `rotateByRows` for an orthonormal `rows` — its transpose. */
function worldToLocalRows(x, y, z, rows, out) {
  const r0 = rows[0], r1 = rows[1], r2 = rows[2];
  out[0] = x * r0[0] + y * r0[1] + z * r0[2];
  out[1] = x * r1[0] + y * r1[1] + z * r1[2];
  out[2] = x * r2[0] + y * r2[1] + z * r2[2];
  return out;
}

const IDENTITY_ROWS = Object.freeze([
  Object.freeze([1, 0, 0]), Object.freeze([0, 1, 0]), Object.freeze([0, 0, 1]),
]);

const _tmpRot = [0, 0, 0];

/** part-local point -> world. `offset` is body-local; `rot` is part-local-to-body-local. */
function toWorldPoint(part, lx, ly, lz, out) {
  rotateByRows(lx, ly, lz, part.rot, _tmpRot);
  const bx = _tmpRot[0] + part.offset[0], by = _tmpRot[1] + part.offset[1], bz = _tmpRot[2] + part.offset[2];
  rotateByRows(bx, by, bz, part.body.axes, out);
  out[0] += part.body.pos[0]; out[1] += part.body.pos[1]; out[2] += part.body.pos[2];
  return out;
}

/** part-local direction -> world (no translation). */
function toWorldDir(part, lx, ly, lz, out) {
  rotateByRows(lx, ly, lz, part.rot, _tmpRot);
  rotateByRows(_tmpRot[0], _tmpRot[1], _tmpRot[2], part.body.axes, out);
  return out;
}

/** world point -> part-local (the inverse of `toWorldPoint`). */
function toLocalPoint(part, wx, wy, wz, out) {
  const dx = wx - part.body.pos[0], dy = wy - part.body.pos[1], dz = wz - part.body.pos[2];
  worldToLocalRows(dx, dy, dz, part.body.axes, _tmpRot);
  const bx = _tmpRot[0] - part.offset[0], by = _tmpRot[1] - part.offset[1], bz = _tmpRot[2] - part.offset[2];
  return worldToLocalRows(bx, by, bz, part.rot, out);
}

// --- §6.3's per-axis merge ---------------------------------------------------

/**
 * `ResponsePhysics::setAdjust` (§6.3, C3, verified by V0 with the exact
 * per-branch opcodes). One axis of one accumulator: empty takes the
 * candidate; opposite signs add (which is how an over-limit push cancels
 * against an under-limit one); same sign keeps the larger magnitude (so many
 * vertices hitting one face do not stack). `candidate === 0` naturally falls
 * into the "add" branches on either side, i.e. is a no-op — matching the
 * binary rather than being special-cased.
 */
export function setAdjust(current, candidate) {
  if (current === 0) return candidate;
  if (current > 0) return candidate > 0 ? Math.max(current, candidate) : current + candidate;
  return candidate < 0 ? Math.min(current, candidate) : current + candidate;
}

// --- the response accumulator (§6.3, §6.4) ----------------------------------

// `solve()`'s non-spring-branch scratch (see the comment at its call site):
// never returned to the caller, so reused across every `Response` instance.
const _solvePoint = [0, 0, 0], _solveAccel = [0, 0, 0];

/**
 * One per collidable part (`ResponsePhysics`, §6). Accumulates this tick's
 * contacts via `impulseOn`, turns the accumulated push into a body correction
 * via `solve`, and leaves the running-mean contact averages
 * (`avgNormal`/`avgSpeed`/`avgRelPos`/`count`) for the friction pass
 * (§8, another track) — `clearContacts()` is that pass's cleanup hook, called
 * once it has consumed them.
 */
export class Response {
  /**
   * @param {'body'|'spring'|'soldier'|'projectile'} [kind]
   * @param {number} [grip] the part's authored grip byte (0-0x7f; DummyGrip/
   *   EngineGrip/RollGrip/ContactGrip live outside this module, in the
   *   friction track)
   */
  constructor(kind = 'body', grip = 0) {
    this.posAdjust = [0, 0, 0];
    this.speedAdjust = [0, 0, 0];
    this.rootPosAdjustCopy = [0, 0, 0];
    this.count = 0;
    this.avgNormal = [0, 0, 0];
    this.avgSpeed = [0, 0, 0];
    this.avgRelPos = [0, 0, 0];
    // Material defaults (§9.4): 1.0/0/0.01. Overwritten by the first contact;
    // these only matter if `solve` or the friction pass runs before any
    // `impulseOn` this tick, which cannot happen (posAdjust is zero then).
    this.friction = 1.0;
    this.elasticity = 0;
    this.resistance = 0.01;
    this.grip = grip;
    this.liveGrip = grip;
    this.surfaceSpeed = [0, 0, 0];
    this.kind = kind;
  }

  /**
   * `ResponsePhysics::impulseOn` (§6.3, C3). `speed`/`normal`/`relPos` are
   * read-only 3-vectors; `friction`/`elasticity`/`resistance` are the
   * caller's already-averaged material numbers (see the module header) —
   * overwritten here, not averaged across contacts ("last contact wins").
   */
  impulseOn(relPos, speed, normal, depth, friction, elasticity, resistance) {
    const nn = lenSq3(normal);
    let sx = 0, sy = 0, sz = 0;
    if (nn !== 0) {
      const k = -(dot3(speed[0], speed[1], speed[2], normal[0], normal[1], normal[2]) / nn);
      sx = k * normal[0]; sy = k * normal[1]; sz = k * normal[2];
    }
    this.speedAdjust[0] = setAdjust(this.speedAdjust[0], sx);
    this.speedAdjust[1] = setAdjust(this.speedAdjust[1], sy);
    this.speedAdjust[2] = setAdjust(this.speedAdjust[2], sz);

    const px = -depth * normal[0], py = -depth * normal[1], pz = -depth * normal[2];
    this.posAdjust[0] = setAdjust(this.posAdjust[0], px);
    this.posAdjust[1] = setAdjust(this.posAdjust[1], py);
    this.posAdjust[2] = setAdjust(this.posAdjust[2], pz);

    const n = this.count;
    this.avgNormal[0] = (this.avgNormal[0] * n + normal[0]) / (n + 1);
    this.avgNormal[1] = (this.avgNormal[1] * n + normal[1]) / (n + 1);
    this.avgNormal[2] = (this.avgNormal[2] * n + normal[2]) / (n + 1);
    this.avgSpeed[0] = (this.avgSpeed[0] * n + speed[0]) / (n + 1);
    this.avgSpeed[1] = (this.avgSpeed[1] * n + speed[1]) / (n + 1);
    this.avgSpeed[2] = (this.avgSpeed[2] * n + speed[2]) / (n + 1);
    this.avgRelPos[0] = (this.avgRelPos[0] * n + relPos[0]) / (n + 1);
    this.avgRelPos[1] = (this.avgRelPos[1] * n + relPos[1]) / (n + 1);
    this.avgRelPos[2] = (this.avgRelPos[2] * n + relPos[2]) / (n + 1);
    this.count = n + 1;

    this.friction = friction;
    this.elasticity = elasticity;
    this.resistance = resistance;

    this.liveGrip = (this.liveGrip & 0x80) | this.grip;
  }

  /**
   * `ResponsePhysics::solveImpulse` (§6.4, C4/V0 — the speed impulse is
   * gated on the SAME `posAdjust != 0` test as the position step, per V0's
   * correction of L0). Only touches `posAdjust`/`rootPosAdjustCopy`/
   * `speedAdjust`; the running-mean contact averages are left for the
   * friction pass — call `clearContacts()` once that pass has consumed them.
   *
   * Not ported: C4's soldier (zero avg contact pos) and projectile
   * (pitch/roll toward the normal) extras — out of this track's scope; add
   * them here if a future track needs ragdolls or tumbling ordnance.
   *
   * @param {object} body the duck-typed body this part belongs to (unused,
   *   not moved, for the 'spring' kind)
   * @param {number[]} partPos this part's current world position (its own
   *   `worldPos`, not the root's — C4/V0: the acceleration is posted at
   *   *this part's* position plus the averaged contact offset)
   * @param {Response} rootResponse the body's root part's Response (may be
   *   `this` when this response IS the root's)
   * @returns {number[]|null} for `kind === 'spring'`, the suspension push
   *   the caller must apply itself (this method never moves a spring's
   *   body); `null` otherwise, including when `posAdjust` was zero
   */
  solve(body, partPos, rootResponse) {
    if (this.posAdjust[0] === 0 && this.posAdjust[1] === 0 && this.posAdjust[2] === 0) return null;

    if (rootResponse !== this) {
      this.rootPosAdjustCopy[0] = rootResponse.posAdjust[0];
      this.rootPosAdjustCopy[1] = rootResponse.posAdjust[1];
      this.rootPosAdjustCopy[2] = rootResponse.posAdjust[2];
    }

    let result = null;
    if (this.kind === 'spring') {
      const d = clamp(
        dot3(this.posAdjust[0], this.posAdjust[1], this.posAdjust[2],
             this.avgNormal[0], this.avgNormal[1], this.avgNormal[2]) -
        dot3(this.rootPosAdjustCopy[0], this.rootPosAdjustCopy[1], this.rootPosAdjustCopy[2],
             this.avgNormal[0], this.avgNormal[1], this.avgNormal[2]),
        0, 1);
      result = [d * this.avgNormal[0], d * this.avgNormal[1], d * this.avgNormal[2]];
    } else {
      body.translate(this.posAdjust);
      const factor = SIMULATION_FPS * (1 + this.elasticity) * 0.5;
      // Scratch, not returned to the caller (unlike the spring `result`
      // below): `body.addAccelerationAt` is specified to consume `p`/`a`
      // synchronously (IMPLEMENTATION.md: "acc += a; racc += cross(...)"),
      // so reusing a persistent buffer here is safe and avoids allocating
      // twice per non-spring `solve()` call.
      _solvePoint[0] = partPos[0] + this.avgRelPos[0];
      _solvePoint[1] = partPos[1] + this.avgRelPos[1];
      _solvePoint[2] = partPos[2] + this.avgRelPos[2];
      _solveAccel[0] = this.speedAdjust[0] * factor;
      _solveAccel[1] = this.speedAdjust[1] * factor;
      _solveAccel[2] = this.speedAdjust[2] * factor;
      body.addAccelerationAt(_solvePoint, _solveAccel);
    }

    this.posAdjust[0] = this.posAdjust[1] = this.posAdjust[2] = 0;
    this.rootPosAdjustCopy[0] = this.rootPosAdjustCopy[1] = this.rootPosAdjustCopy[2] = 0;
    this.speedAdjust[0] = this.speedAdjust[1] = this.speedAdjust[2] = 0;
    return result;
  }

  /**
   * Zeroes the running-mean contact averages (`avgNormal`/`avgSpeed`/
   * `avgRelPos`/`count`) and `surfaceSpeed`, for the friction pass (§8: "clear
   * the contact averages and the surface speed") to call once it is done
   * with them — which is also, since detection for the next tick starts
   * fresh, the reset for that next tick. Does not touch `friction`/
   * `elasticity`/`resistance`/`grip`/`liveGrip`: the first two triples get
   * overwritten by the next contact regardless, and grip/liveGrip persist
   * (liveGrip's high bit is a cross-tick static-friction latch, §8).
   */
  clearContacts() {
    this.avgNormal[0] = this.avgNormal[1] = this.avgNormal[2] = 0;
    this.avgSpeed[0] = this.avgSpeed[1] = this.avgSpeed[2] = 0;
    this.avgRelPos[0] = this.avgRelPos[1] = this.avgRelPos[2] = 0;
    this.count = 0;
    this.surfaceSpeed[0] = this.surfaceSpeed[1] = this.surfaceSpeed[2] = 0;
  }
}

// --- one collidable piece of a body -----------------------------------------

/**
 * One collidable part: the root itself, or a child (a wheel, a wing, a
 * spring). `offset`/`rot` place it relative to its `body` — `[0,0,0]`/
 * identity for the root part. `kind` mirrors `response.kind`'s vocabulary
 * (`'body'|'spring'|'soldier'|'projectile'`) and is what `probe`/
 * `collideBodies` read for the soldier special cases (§5.3, §5.5); keep the
 * two in sync when constructing a spring or soldier part.
 */
export class CollisionPart {
  constructor({ body, shape, response, isRoot = false, offset = [0, 0, 0], rot = IDENTITY_ROWS, kind = 'body' }) {
    this.body = body;
    this.shape = shape;
    this.response = response;
    this.isRoot = isRoot;
    this.offset = offset;
    this.rot = rot;
    this.kind = kind;
  }

  /** This part's own origin, in world space. */
  worldPos(out) {
    return toWorldPoint(this, 0, 0, 0, out);
  }

  /** World position of vertex `i` of collision layer `layer`. */
  worldVertex(layer, i, out) {
    const L = this.shape.layers[layer];
    const b = i * 3;
    return toWorldPoint(this, L.vertices[b], L.vertices[b + 1], L.vertices[b + 2], out);
  }
}

// --- §6.1: mass shares --------------------------------------------------

/**
 * Allocation-free core of `shares()` below: writes `[shareA, shareB]` into
 * `out` and returns it, instead of allocating a fresh array — `collidePair`
 * calls this directly (with a persistent module-scratch `out`) so it does
 * not allocate per call. `shares()` is the public, tested wrapper: it
 * allocates its own array each call, which is fine there (called at most
 * once per pair, and its whole point as a public export is an independent,
 * caller-owned result the caller may hold onto).
 */
function shareAB(massA, massB, hasNodeA, hasNodeB, out) {
  if (!hasNodeA) { out[0] = 0; out[1] = LOW_SNAP_SHARE_B; return out; }
  if (!hasNodeB) { out[0] = 1; out[1] = 0; return out; }
  const s = massB / (massA + massB);
  if (s > SHARE_SNAP_HIGH) { out[0] = 1; out[1] = 0; return out; }
  if (s < SHARE_SNAP_LOW) { out[0] = 0; out[1] = LOW_SNAP_SHARE_B; return out; }
  out[0] = s; out[1] = -(1 - s);
  return out;
}

/**
 * `ResponsePhysics::checkObjectVsObject`'s share split (§6.1, C1, confirmed
 * by V0/V3 down to the raw opcodes). `hasNodeA`/`hasNodeB` are for the
 * engine's defensive "root object has no physics node at all" case — every
 * body this viewer constructs has one, so callers normally pass `true` for
 * both; the parameters exist so the full rule (briefing item 4) is ported,
 * not just the common path. See `LOW_SNAP_SHARE_B` for the one sign this
 * deliberately does not port bug-for-bug.
 *
 * @returns {[number, number]} `[shareA, shareB]`, NOT yet multiplied by the
 *   §5.3 direction weight — `collidePair` does that.
 */
export function shares(massA, massB, hasNodeA = true, hasNodeB = true) {
  return shareAB(massA, massB, hasNodeA, hasNodeB, [0, 0]);
}

// --- §5.5: the narrow phase --------------------------------------------------

const _faceHit = { hit: [0, 0, 0], fa: 0, fb: 0 };

/**
 * `geom::checkFaceAndEdgeCollision` (R3 F11, confirmed by V3 §4 down to the
 * raw opcodes: `de ec`/`de ea`/`dc ea` for the two dot products, the branch
 * order). Everything here is in whatever frame the caller already put
 * `p0`/`p1`/the triangle in (this module always calls it in B-part-local
 * space). `doubleSided` is always `false` for a vehicle probe (§5.5); the
 * parameter exists because the spec's function takes it.
 */
function checkFaceAndEdgeCollision(
  v0x, v0y, v0z, v1x, v1y, v1z, v2x, v2y, v2z,
  nx, ny, nz, p0x, p0y, p0z, p1x, p1y, p1z, doubleSided, out) {
  const dx = p1x - p0x, dy = p1y - p0y, dz = p1z - p0z;
  if (dx === 0 && dy === 0 && dz === 0) return false;

  const e = dot3(p1x - v0x, p1y - v0y, p1z - v0z, nx, ny, nz);
  if (e > 0) return false;                     // END must be on/behind the plane
  const s = dot3(p0x - v0x, p0y - v0y, p0z - v0z, nx, ny, nz);
  if (!(s > 0)) return false;                   // START strictly in front
  const dn = dot3(nx, ny, nz, dx, dy, dz);
  if (!doubleSided && !(dn < 0)) return false;
  const t = s / (-dn);

  const hx = p0x + t * dx, hy = p0y + t * dy, hz = p0z + t * dz;

  // Axis choice for the 2-D point-in-triangle test (F11). Components are
  // picked directly per branch (no per-call closure — this runs once per
  // candidate face per probed vertex, a hot inner loop; see the module
  // report's "hot-path allocation" note).
  const anx = Math.abs(nx), any = Math.abs(ny), anz = Math.abs(nz);
  let hu, hv, v0u, v0v, v1u, v1v, v2u, v2v;
  if (any >= 0.7) {              // (x, z)
    hu = hx; hv = hz; v0u = v0x; v0v = v0z; v1u = v1x; v1v = v1z; v2u = v2x; v2v = v2z;
  } else if (anz <= 0.3) {       // (y, z)
    hu = hy; hv = hz; v0u = v0y; v0v = v0z; v1u = v1y; v1v = v1z; v2u = v2y; v2v = v2z;
  } else {                       // (x, y)
    hu = hx; hv = hy; v0u = v0x; v0v = v0y; v1u = v1x; v1v = v1y; v2u = v2x; v2v = v2y;
  }

  const c0 = (v1u - v0u) * (hv - v0v) - (v1v - v0v) * (hu - v0u);
  const c1 = (v2u - v1u) * (hv - v1v) - (v2v - v1v) * (hu - v1u);
  const c2 = (v0u - v2u) * (hv - v2v) - (v0v - v2v) * (hu - v2u);
  const hasNeg = c0 < 0 || c1 < 0 || c2 < 0;
  const hasPos = c0 > 0 || c1 > 0 || c2 > 0;
  if (hasNeg && hasPos) return false;           // outside on at least one edge, either winding

  out.hit[0] = hx; out.hit[1] = hy; out.hit[2] = hz;
  out.fa = e;                                    // <= 0, penetration along the normal
  out.fb = (t - 1) * Math.sqrt(dx * dx + dy * dy + dz * dz);   // <= 0
  return true;
}

/** F10 step 2: reject unless the 2-point segment's own AABB overlaps the mesh's. */
function segmentTouchesAABB(p0x, p0y, p0z, p1x, p1y, p1z, min, max) {
  if (Math.max(p0x, p1x) < min[0] || Math.min(p0x, p1x) > max[0]) return false;
  if (Math.max(p0y, p1y) < min[1] || Math.min(p0y, p1y) > max[1]) return false;
  if (Math.max(p0z, p1z) < min[2] || Math.min(p0z, p1z) > max[2]) return false;
  return true;
}

const _S = [0, 0, 0], _E = [0, 0, 0], _Slocal = [0, 0, 0], _Elocal = [0, 0, 0];

/**
 * `ResponsePhysics::checkObjectVsObject`'s narrow phase (§5.5, F9, confirmed
 * by V3 §4): `partA`'s col0 vertices (one probe only, vertex 0, when the
 * layer has fewer than `MIN_VERTEX_COUNT`) against `partB`'s face layer,
 * single-sided, keeping the closest-to-start face per vertex. One hit
 * record per vertex that found one — NOT one hit for the whole pair, because
 * that is what the engine does (F9/C2: the handler/response dispatch runs
 * once per vertex, inside the same loop).
 *
 * @param {number} dt fixed tick, 1/30
 * @param {Array} out caller-owned scratch array of hit records; entries are
 *   reused in place (`{vertexIndex, normal:[3], pos:[3], depth, matVertex,
 *   matFace, faceIndex}`) and the array is extended, never shrunk — read only
 *   `out[0..returned count - 1]`
 * @returns {number} the number of hits written into `out`
 */
export function probe(partA, partB, dt, out) {
  const layerA = partA.shape.layers[0];
  if (!layerA || !layerA.vertices || layerA.vertices.length < 3) return 0;

  const rawCount = layerA.vertices.length / 3;
  const probeCount = rawCount < MIN_VERTEX_COUNT ? 1 : rawCount;

  const useLod1 = partA.body.boundingRadius < FACE_LOD_RADIUS || partA.kind === 'soldier';
  let faceLayerIdx = useLod1 ? 1 : 0;
  if (!partB.shape.layers[faceLayerIdx]) faceLayerIdx = 0;
  const faceLayer = partB.shape.layers[faceLayerIdx];
  if (!faceLayer || !faceLayer.faces || faceLayer.faces.length < 3) return 0;

  const bodyA = partA.body, bodyB = partB.body;
  const relVx = bodyA.v[0] - bodyB.v[0], relVy = bodyA.v[1] - bodyB.v[1], relVz = bodyA.v[2] - bodyB.v[2];
  _S[0] = bodyA.pos[0] - relVx * dt; _S[1] = bodyA.pos[1] - relVy * dt; _S[2] = bodyA.pos[2] - relVz * dt;
  toLocalPoint(partB, _S[0], _S[1], _S[2], _Slocal);

  const faces = faceLayer.faces, normals = faceLayer.normals, verts = faceLayer.vertices;
  const faceCount = faces.length / 3;
  const min = faceLayer.min, max = faceLayer.max;

  let hitCount = 0;
  for (let vi = 0; vi < probeCount; vi++) {
    partA.worldVertex(0, vi, _E);
    toLocalPoint(partB, _E[0], _E[1], _E[2], _Elocal);

    if (min && max && !segmentTouchesAABB(_Slocal[0], _Slocal[1], _Slocal[2], _Elocal[0], _Elocal[1], _Elocal[2], min, max)) {
      continue;
    }

    const dx = _Elocal[0] - _Slocal[0], dy = _Elocal[1] - _Slocal[1], dz = _Elocal[2] - _Slocal[2];
    let bestFb = Infinity, bestFace = -1, bestFa = 0, bestHx = 0, bestHy = 0, bestHz = 0;

    for (let f = 0; f < faceCount; f++) {
      const nx = normals[f * 3], ny = normals[f * 3 + 1], nz = normals[f * 3 + 2];
      if (dx * nx + dy * ny + dz * nz >= 0) continue;   // single-sided cull (§5.5)

      const i0 = faces[f * 3], i1 = faces[f * 3 + 1], i2 = faces[f * 3 + 2];
      const hit = checkFaceAndEdgeCollision(
        verts[i0 * 3], verts[i0 * 3 + 1], verts[i0 * 3 + 2],
        verts[i1 * 3], verts[i1 * 3 + 1], verts[i1 * 3 + 2],
        verts[i2 * 3], verts[i2 * 3 + 1], verts[i2 * 3 + 2],
        nx, ny, nz, _Slocal[0], _Slocal[1], _Slocal[2], _Elocal[0], _Elocal[1], _Elocal[2],
        false, _faceHit);
      if (!hit) continue;
      if (_faceHit.fb < bestFb) {                       // F10: keep the smallest fb
        bestFb = _faceHit.fb; bestFa = _faceHit.fa; bestFace = f;
        bestHx = _faceHit.hit[0]; bestHy = _faceHit.hit[1]; bestHz = _faceHit.hit[2];
      }
    }

    if (bestFace < 0) continue;

    let rec = out[hitCount];
    if (!rec) { rec = { vertexIndex: 0, normal: [0, 0, 0], pos: [0, 0, 0], depth: 0, matVertex: 0, matFace: 0, faceIndex: -1 }; out[hitCount] = rec; }
    rec.vertexIndex = vi;
    toWorldDir(partB, normals[bestFace * 3], normals[bestFace * 3 + 1], normals[bestFace * 3 + 2], rec.normal);
    toWorldPoint(partB, bestHx, bestHy, bestHz, rec.pos);
    rec.depth = bestFa;
    rec.matVertex = layerA.vertexMaterials ? layerA.vertexMaterials[vi] : 0;
    rec.matFace = faceLayer.faceMaterials ? faceLayer.faceMaterials[bestFace] : 0;
    rec.faceIndex = bestFace;
    hitCount++;
  }

  return hitCount;
}

// --- §6.2: one direction's response --------------------------------------

const _hitScratch = [];
const _posA = [0, 0, 0], _posB = [0, 0, 0];
const _tsA = [0, 0, 0], _tsB = [0, 0, 0];
const _vRel = [0, 0, 0], _vRelNeg = [0, 0, 0];
const _relPosA = [0, 0, 0], _relPosB = [0, 0, 0];
const _speedA = [0, 0, 0], _speedB = [0, 0, 0];
const _shareScratch = [0, 0];

/**
 * `ResponsePhysics::checkObjectVsObject`'s per-hit response (§6.2, C2,
 * confirmed by V0). `partA` is the vertex side, `partB` the face side —
 * `collideBodies` decides that per the §5.3 direction rule; call this
 * directly (with `weight = 1.0`) to test one direction in isolation.
 *
 * Per hit: below `HANDLER_SPEED_THRESHOLD_SQ` the handlers are not called
 * and the response always runs; at or above it, `handlers.onCollision` runs
 * for A then (only if that returned true) for B with materials and `vRel`
 * swapped/negated — both must return true or the response for that hit is
 * skipped entirely (matching the binary's `dec %al; jne skip` chain, not
 * "apply whichever side said yes").
 *
 * @param {object} handlers `{ onCollision(self, other, vRel, normal, pos,
 *   matSelf, matOther) -> boolean, materialValues(matVertex, matFace) ->
 *   {friction, elasticity, resistance} }`
 * @returns {number} hits for which a response was applied (0 if none, or if
 *   every hit's handlers vetoed it)
 */
export function collidePair(partA, partB, dt, weight, handlers) {
  const hitCount = probe(partA, partB, dt, _hitScratch);
  if (hitCount === 0) return 0;

  const bodyA = partA.body, bodyB = partB.body;
  shareAB(bodyA.mass, bodyB.mass, true, true, _shareScratch);
  const shareA = _shareScratch[0] * weight, shareB = _shareScratch[1] * weight;

  partA.worldPos(_posA);
  partB.worldPos(_posB);

  let applied = 0;
  for (let h = 0; h < hitCount; h++) {
    const hit = _hitScratch[h];

    bodyA.tangentSpeed(hit.pos, _tsA);
    bodyB.tangentSpeed(hit.pos, _tsB);
    _vRel[0] = _tsA[0] - _tsB[0]; _vRel[1] = _tsA[1] - _tsB[1]; _vRel[2] = _tsA[2] - _tsB[2];
    const vRelSq = lenSq3(_vRel);

    let responseRuns = true;
    if (vRelSq > HANDLER_SPEED_THRESHOLD_SQ) {
      const okA = handlers.onCollision(partA, partB, _vRel, hit.normal, hit.pos, hit.matVertex, hit.matFace);
      let okB = false;
      if (okA) {
        _vRelNeg[0] = -_vRel[0]; _vRelNeg[1] = -_vRel[1]; _vRelNeg[2] = -_vRel[2];
        okB = handlers.onCollision(partB, partA, _vRelNeg, hit.normal, hit.pos, hit.matFace, hit.matVertex);
      }
      responseRuns = okA && okB;
    }
    if (!responseRuns) continue;

    const mv = handlers.materialValues(hit.matVertex, hit.matFace);

    if (!bodyA.isStatic && shareA !== 0) {
      _relPosA[0] = hit.pos[0] - _posA[0]; _relPosA[1] = hit.pos[1] - _posA[1]; _relPosA[2] = hit.pos[2] - _posA[2];
      _speedA[0] = _vRel[0] * shareA; _speedA[1] = _vRel[1] * shareA; _speedA[2] = _vRel[2] * shareA;
      partA.response.impulseOn(_relPosA, _speedA, hit.normal, hit.depth * shareA, mv.friction, mv.elasticity, mv.resistance);
    }
    if (!bodyB.isStatic && shareB !== 0) {
      _relPosB[0] = hit.pos[0] - _posB[0]; _relPosB[1] = hit.pos[1] - _posB[1]; _relPosB[2] = hit.pos[2] - _posB[2];
      _speedB[0] = _vRel[0] * shareB; _speedB[1] = _vRel[1] * shareB; _speedB[2] = _vRel[2] * shareB;
      partB.response.impulseOn(_relPosB, _speedB, hit.normal, hit.depth * shareB, mv.friction, mv.elasticity, mv.resistance);
    }
    applied++;
  }
  return applied;
}

// --- §5.2/§5.3: the pair loop over a scene's parts --------------------------

function vertCount(part) {
  const L = part.shape.layers[0];
  return L && L.vertices ? L.vertices.length / 3 : 0;
}

// Module-scratch output of `directionPlan`: up to 2 `(vertexPart, facePart,
// weight)` entries, index 0 then 1 — read only `[0 .. returned count - 1]`.
// Avoids allocating an array of tuples on every part-pair `collideBodies`
// tests (see the module report's "hot-path allocation" note).
const _dirVertex = [null, null], _dirFace = [null, null], _dirWeight = [0, 0];

/**
 * §5.3's direction rule (F6, confirmed verbatim by V3 §2, including the
 * boundary being `<=` i.e. ratio `>= 4`). Writes 1 or 2 `(vertexPart,
 * facePart, weight)` entries into `_dirVertex`/`_dirFace`/`_dirWeight` (see
 * above) in call order and returns the count; both entries of a two-way
 * split run "back-to-back inside ONE iteration of the pair loop" (V3), i.e.
 * nothing is solved between them.
 */
function directionPlan(partA, partB) {
  const bodyA = partA.body, bodyB = partB.body;
  if (bodyB.isStatic) { _dirVertex[0] = partA; _dirFace[0] = partB; _dirWeight[0] = 1.0; return 1; }
  if (bodyA.isStatic) { _dirVertex[0] = partB; _dirFace[0] = partA; _dirWeight[0] = 1.0; return 1; }

  const rAr = bodyA.boundingRadius, rBr = bodyB.boundingRadius;
  const solA = partA.kind === 'soldier', solB = partB.kind === 'soldier';

  if (rBr > rAr) {
    if (rAr <= SIZE_RATIO_SMALL * rBr || solA) {
      if (solB) { _dirVertex[0] = partB; _dirFace[0] = partA; } else { _dirVertex[0] = partA; _dirFace[0] = partB; }
      _dirWeight[0] = 1.0;
      return 1;
    }
    if (solB) { _dirVertex[0] = partB; _dirFace[0] = partA; _dirWeight[0] = 1.0; return 1; }
    _dirVertex[0] = partA; _dirFace[0] = partB; _dirWeight[0] = 0.5;
    _dirVertex[1] = partB; _dirFace[1] = partA; _dirWeight[1] = 0.5;
    return 2;
  }
  if (rBr <= SIZE_RATIO_SMALL * rAr || solB) {
    if (solA) { _dirVertex[0] = partA; _dirFace[0] = partB; } else { _dirVertex[0] = partB; _dirFace[0] = partA; }
    _dirWeight[0] = 1.0;
    return 1;
  }
  if (solA) { _dirVertex[0] = partA; _dirFace[0] = partB; _dirWeight[0] = 1.0; return 1; }
  _dirVertex[0] = partB; _dirFace[0] = partA; _dirWeight[0] = 0.5;
  _dirVertex[1] = partA; _dirFace[1] = partB; _dirWeight[1] = 0.5;
  return 2;
}

// Module-scratch grouping state for `groupPartsByBody`: a reused `Map` plus
// a pool of `{body, parts}` group objects (their `parts` arrays truncated,
// not reallocated, between calls). `collideBodies` runs once per tick, so
// without this it would hand the GC a fresh `Map` and one fresh object per
// body every tick.
const _groupMap = new Map();
const _groupPool = [];

/**
 * Buckets `parts` by their shared `body`, preserving first-seen order, into
 * the module-scratch `_groupPool` above. Returns the number of live groups;
 * read only `_groupPool[0 .. count - 1]`.
 */
function groupPartsByBody(parts) {
  _groupMap.clear();
  let count = 0;
  for (const p of parts) {
    let g = _groupMap.get(p.body);
    if (!g) {
      if (count < _groupPool.length) {
        g = _groupPool[count];
        g.body = p.body;
        g.parts.length = 0;
      } else {
        g = { body: p.body, parts: [] };
        _groupPool.push(g);
      }
      _groupMap.set(p.body, g);
      count++;
    }
    g.parts.push(p);
  }
  return count;
}

const _wpA = [0, 0, 0], _wpB = [0, 0, 0];

/**
 * §5.2's pair loop (F6) plus §5.3's direction rule, over one tick's worth of
 * parts from every body in the scene. Bodies are paired `O(n^2)` (briefing:
 * "a plain O(n^2) loop over bodies is fine" for a viewer's scene sizes);
 * de-duplication — the spec's per-tick stamp (rule 5, "B already carries
 * this tick's stamp") — falls out structurally here instead, since an `i<j`
 * loop over body groups already visits every unordered body pair exactly
 * once and every part pair under it exactly once. No explicit stamp field is
 * kept; this is a deliberate simplification, noted in the track report.
 *
 * Not implemented, both because the briefing says to skip them and because
 * neither ever filters a vehicle pair (confirmed by both R3/F7 and V3 §1d):
 * object flag `0x1` ("inactive") and collision groups.
 *
 * @param {CollisionPart[]} parts every collidable part in the scene, in any
 *   order, root and children mixed and interleaved across bodies
 * @param {object} handlers passed straight through to `collidePair`
 * @returns {number} total hits that produced a response, across every pair
 */
export function collideBodies(parts, dt, handlers) {
  const groupCount = groupPartsByBody(parts);
  let total = 0;

  for (let i = 0; i < groupCount; i++) {
    const bodyA = _groupPool[i].body;
    for (let j = i + 1; j < groupCount; j++) {
      const bodyB = _groupPool[j].body;

      const mobileAwakeA = !bodyA.isStatic && !bodyA.sleeping;
      const mobileAwakeB = !bodyB.isStatic && !bodyB.sleeping;
      if (!mobileAwakeA && !mobileAwakeB) continue;               // rule 3

      const marginA = lenSq3(bodyA.v) * dt * SPEED_MARGIN_FACTOR;  // rule 9, root speeds
      const marginB = lenSq3(bodyB.v) * dt * SPEED_MARGIN_FACTOR;

      for (const partA of _groupPool[i].parts) {
        for (const partB of _groupPool[j].parts) {
          if (!partA.isRoot && !partB.isRoot) continue;            // rule 7

          const rA = partA.shape.radius, rB = partB.shape.radius;
          if (rA < PART_RADIUS_MIN && rB < PART_RADIUS_MIN) continue;   // rule 8

          partA.worldPos(_wpA); partB.worldPos(_wpB);
          const ddx = _wpA[0] - _wpB[0], ddy = _wpA[1] - _wpB[1], ddz = _wpA[2] - _wpB[2];
          const distSq = ddx * ddx + ddy * ddy + ddz * ddz;
          const sum = rA + marginA + rB + marginB;
          if (distSq > sum * sum) continue;                        // rule 9

          if (vertCount(partA) < MIN_VERTEX_COUNT && vertCount(partB) < MIN_VERTEX_COUNT) continue;   // rule 10

          const dirCount = directionPlan(partA, partB);
          for (let d = 0; d < dirCount; d++) {
            total += collidePair(_dirVertex[d], _dirFace[d], dt, _dirWeight[d], handlers);
          }
        }
      }
    }
  }

  return total;
}
