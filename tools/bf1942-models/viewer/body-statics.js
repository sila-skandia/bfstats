// A body's hull against the static world: a building is a contact, not a wall.
//
// `features/bf1942-engine-reference/subsystems/collision-response.md` (the
// spec below; section numbers are its numbers) draws no line between a jeep
// hitting a plane and a jeep hitting a hangar. Both are
// `checkObjectVsObject`: the smaller body's col0 vertices against the other
// side's faces, the push split by mass, posted as an acceleration **at the
// contact point** so it spins the body. A static object is only the degenerate
// case — §5.3's first arm makes it always the face side at weight 1.0, and
// §6.1's "a static object's node reports a mass of 1e12" snaps the share so
// the moving body takes the whole correction.
//
// `body-contact.js` already runs that for two bodies. What it cannot do is
// probe the *static* side, because a level's collision geometry is not a
// `CollisionPart`: it is `collision.js`'s triangle soup, 20,000 triangles in a
// uniform XZ grid, with no per-mesh transform and no BSP. This module is that
// one missing arm — the engine's §5.5 probe asked of the grid instead of a
// mesh — and nothing else. The response, the accumulation and the friction
// hand-off are `body-contact.js`'s `Response` exactly as they are for a
// vehicle pair, which is the point: `ground.js`'s old swept sphere was a
// second, parallel physics for one half of the world.
//
// Framework-free (only `body-contact.js`, itself import-free), so
// `tests/body_statics_harness.mjs` runs the real thing under node with a fake
// static world.
//
// --- what the static world has to answer -------------------------------------
//
//   near(x, y, z, dx, dy, dz, dist, radius, owner, stepTop) -> boolean
//       Optional broadphase, the analogue of §5.1's one grid query per root
//       per tick: is anything static within `radius` of the segment at all.
//       Called ONCE per body, before its vertex casts, and a real adapter is
//       entitled to treat it as "choose this body's candidate triangles" and
//       to apply `owner` and `stepTop` here rather than per cast
//       (`WorldCollider.staticProbe` does exactly that, and it is the
//       difference between one grid walk per body per tick and one per
//       vertex). Without it every vertex pays a grid walk on an empty field.
//   cast(ox, oy, oz, dx, dy, dz, maxDist, owner, stepTop)
//       The first static face a ray crosses, or null. `dx/dy/dz` unit,
//       `maxDist` metres. `owner` is the probing body's own owner id, to be
//       skipped along with every other simulated body (those are the contact
//       solver's, not this pass's); `stepTop` is the drivable-deck gate (see
//       `supportY`). Both are passed on every cast so an adapter with no
//       `near` still has them. The hit carries `x/y/z` (the crossing),
//       `nx/ny/nz` (the face normal **oriented back toward the ray's start**)
//       and `material`.
//   supportY(x, z, fromY) -> number
//       Optional. The height of the surface the body is standing on, terrain
//       or drivable deck. `stepTop` is that plus `KERB_STEP`: a drivable
//       triangle below it is a kerb the suspension mounts rather than a wall,
//       which is the same gate `ground.js`'s sweep has always passed and the
//       reason a tank is not welded to the lip of every bridge.
//
// --- where this diverges from the engine, and why ----------------------------
//
//  1. **The faces are two-sided, oriented toward the probe's start.** §5.5
//     culls back faces by the stored face normal. A level's baked triangles
//     have no trustworthy winding — `collision.js`'s own narrowphase says so
//     in as many words ("a hull's winding is not something to trust"), and the
//     assembler's Z-mirror reverses orientation — so the normal is taken as
//     the triangle's and flipped to face the ray's start. The visible
//     consequence is at the one place the two rules differ: from *inside* a
//     closed building the engine finds no face at all (which is why the
//     insides of closed buildings carry the kill material 99 instead), while
//     this pushes the body back off the wall it crossed. Sane, and not what
//     the engine does.
//  2. **No `handleCollision`, so no crash damage yet.** The hook is here
//     (`handlers.onStatic`, with the veto semantics of §6.2) and unused: the
//     deferral is `features/viewer-ground-hull-collision/README.md` §3's, and
//     material 99 is why it is not a one-line switch-on.
//  3. **Springs are not probed.** A wheel part's static contact would be
//     §6.4's suspension branch, and in this viewer a wheel reads the ground
//     through `groundHeight`, which already includes drivable decks. Probing
//     them here would double the deck up. Hull parts only.
//  4. The `-1.0` low-mass share is `body-contact.js`'s inherited divergence
//     (§6.1). It cannot fire against a static, which always snaps high.

import { shares } from './body-contact.js';

/** §6.1: the mass a static object's physics node reports. */
export const STATIC_MASS = 1e12;

/** §5.3, first arm: a static is always the face side, at full weight. */
export const STATIC_WEIGHT = 1;

/** §5.5: fewer than this many col0 vertices collapses to one probe. */
const MIN_VERTEX_COUNT = 4;

/** §6.2: below this squared relative speed the handlers are skipped. */
const HANDLER_SPEED_THRESHOLD_SQ = 0.1;

/**
 * How far above the surface a body is riding a drivable object's face may
 * reach and still be a kerb rather than a wall. `ground.js`'s own
 * `DECK_WALL_STEP`, which its swept sphere has always passed to the collider;
 * kept here as its own constant because this pass, not that one, is now what
 * a driven hull meets. [free, numerics]
 */
export const KERB_STEP = 1.0;

/**
 * `shareA` for a body of `mass` against a static object, through the same
 * §6.1 rule a vehicle pair takes. 1.0 for every vehicle mass there is — the
 * value is not the point, going through the one rule is.
 */
export function staticShare(mass) {
  return shares(mass, STATIC_MASS)[0] * STATIC_WEIGHT;
}

const _S = [0, 0, 0], _E = [0, 0, 0], _n = [0, 0, 0], _P = [0, 0, 0];
const _vRel = [0, 0, 0], _speed = [0, 0, 0], _relPos = [0, 0, 0];
const _partPos = [0, 0, 0];

/**
 * One body's hull parts against the static world, for one tick.
 *
 * Every part must belong to the same body (`BodyWorld` calls this per entry).
 * Contacts land in each part's own `Response`, exactly as a vehicle pair's
 * do, so the caller's existing resolve pass — `response.solve(body, partPos,
 * rootResponse)` then the friction pass then `clearContacts()` — needs no
 * change at all.
 *
 * @param {Array} parts the body's `CollisionPart`s; `kind === 'spring'` is
 *   skipped (divergence 3 above)
 * @param {object} statics the static world (see the module header)
 * @param {number} dt the fixed tick, 1/30
 * @param {object} handlers `{ materialValues(matVertex, matFace) ->
 *   {friction, elasticity, resistance}, onStatic?(part, vRel, normal, pos,
 *   matVertex, matFace) -> boolean }`
 * @returns {number} contacts for which a response was applied
 */
export function collideWithStatics(parts, statics, dt, handlers) {
  if (!parts || !parts.length || !statics) return 0;
  const body = parts[0].body;
  if (!body || body.sleeping) return 0;

  // §5.5's start point: where the root origin was a tick ago in the other
  // body's frame. A static does not move, so the relative velocity is the
  // body's own.
  _S[0] = body.pos[0] - body.v[0] * dt;
  _S[1] = body.pos[1] - body.v[1] * dt;
  _S[2] = body.pos[2] - body.v[2] * dt;

  const owner = parts[0].owner ?? -1;

  // The deck gate, once per body per tick: a drivable face at or below this
  // is a kerb. NaN or a missing `supportY` leaves the gate wide open, which
  // is what a level with no drivable static wants anyway.
  let stepTop = -Infinity;
  if (statics.supportY) {
    const support = statics.supportY(body.pos[0], body.pos[2], body.pos[1]);
    if (Number.isFinite(support)) stepTop = support + KERB_STEP;
  }

  // §5.1's broadphase, the one query per root per tick. The probe rays all
  // run from `_S` to a vertex, and no vertex is further from the body origin
  // than `boundingRadius`, so a sphere of that radius swept from `_S` to the
  // origin contains every one of them.
  if (statics.near) {
    const dx = body.pos[0] - _S[0], dy = body.pos[1] - _S[1], dz = body.pos[2] - _S[2];
    const dist = Math.hypot(dx, dy, dz);
    const inv = dist > 1e-9 ? 1 / dist : 0;
    if (!statics.near(_S[0], _S[1], _S[2], dx * inv, dy * inv, dz * inv,
                      dist, body.boundingRadius ?? 0, owner, stepTop)) {
      return 0;
    }
  }

  const share = staticShare(body.mass);
  let applied = 0;
  for (const part of parts) {
    if (part.kind === 'spring') continue;
    applied += probePart(part, body, statics, handlers, owner, stepTop, share);
  }
  return applied;
}

function probePart(part, body, statics, handlers, owner, stepTop, share) {
  const layer = part.shape?.layers?.[0];
  if (!layer || !layer.vertices || layer.vertices.length < 3) return 0;
  const raw = layer.vertices.length / 3;
  const count = raw < MIN_VERTEX_COUNT ? 1 : raw;
  part.worldPos(_partPos);

  let applied = 0;
  for (let vi = 0; vi < count; vi++) {
    part.worldVertex(0, vi, _E);
    const dx = _E[0] - _S[0], dy = _E[1] - _S[1], dz = _E[2] - _S[2];
    const len = Math.hypot(dx, dy, dz);
    if (!(len > 1e-6)) continue;
    const inv = 1 / len;
    const hit = statics.cast(_S[0], _S[1], _S[2], dx * inv, dy * inv, dz * inv,
                             len, owner, stepTop);
    if (!hit) continue;

    _P[0] = hit.x; _P[1] = hit.y; _P[2] = hit.z;
    _n[0] = hit.nx; _n[1] = hit.ny; _n[2] = hit.nz;
    // §5.5's `f2`: the END point's signed distance to the face plane, which is
    // the penetration the response pushes out. The normal faces the probe's
    // start and the end point is past the plane, so this is <= 0 by
    // construction; clamped anyway, because a grazing hit can land on the
    // wrong side of zero in float.
    let depth = (_E[0] - _P[0]) * _n[0] + (_E[1] - _P[1]) * _n[1] + (_E[2] - _P[2]) * _n[2];
    if (depth > 0) depth = 0;

    body.tangentSpeed(_P, _vRel);
    const matVertex = layer.vertexMaterials ? layer.vertexMaterials[vi] : 0;
    const matFace = hit.material ?? 0;

    if (_vRel[0] * _vRel[0] + _vRel[1] * _vRel[1] + _vRel[2] * _vRel[2]
        > HANDLER_SPEED_THRESHOLD_SQ && handlers.onStatic) {
      // §6.2: the static has no handler of its own to consult, so one veto is
      // the whole test.
      if (!handlers.onStatic(part, _vRel, _n, _P, matVertex, matFace)) continue;
    }

    const mv = handlers.materialValues(matVertex, matFace);
    _relPos[0] = _P[0] - _partPos[0];
    _relPos[1] = _P[1] - _partPos[1];
    _relPos[2] = _P[2] - _partPos[2];
    _speed[0] = _vRel[0] * share;
    _speed[1] = _vRel[1] * share;
    _speed[2] = _vRel[2] * share;
    part.response.impulseOn(_relPos, _speed, _n, depth * share,
                            mv.friction, mv.elasticity, mv.resistance);
    applied++;
  }
  return applied;
}
