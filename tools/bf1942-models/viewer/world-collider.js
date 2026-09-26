// Terrain, sea and hulls behind one query: the collider every caller holds.
//
// What a round runs into: the heightfield, the sea, and the collision hulls.
//
// Refractor gives a projectile three kinds of thing to hit and collides against
// each differently. The shapes of the shipped data are what decide the three
// tests below, and each one is measured rather than guessed:
//
//   - **Terrain.** `Heightmap.raw` is a `dim x dim` grid of 16-bit samples at
//     `worldSize / dim` metres — 513 x 513 vertices on a 4 m lattice for every
//     vanilla 2048 m level. There is no terrain collision mesh anywhere in the
//     archives: the heightmap *is* the collider. So the honest test is an
//     analytic march over the lattice, not a raycast against the 524,288 drawn
//     triangles. `map.html` already had the raycast version, wired only to the
//     aircraft; this replaces it for everyone (gap C-5).
//   - **Water.** One horizontal plane at `waterLevel` over the whole world
//     (`extract_map.py` builds the quad world-wide, not just under the textured
//     patches). A plane test is exact and costs a divide (gap C-6).
//   - **Statics.** Real collision hulls, carried inside each `.sm` ahead of the
//     LOD chain and split into one glTF primitive per `defenseMaterial`. Bocage
//     exports 21,661 such triangles across 427 placements, 51 distinct
//     materials. That is small enough that a uniform XZ grid beats a BVH: the
//     build is a counting sort and the query is a DDA walk (gap C-1).
//
// Two query shapes come out of it. `cast` is the ray a round flies along.
// `sweepSphere` is the fat version a *body* needs — a soldier, and later a
// vehicle — and it shares the same grid rather than building a second one; see
// the method for why it queries that grid as a rectangle instead of walking it.
//
// The module is deliberately free of any `three` import. It reads three.js
// objects through the three fields it needs (`geometry.attributes.position`,
// `geometry.index`, `matrixWorld.elements`) and hands back plain numbers, which
// is what lets `tests/test_collision.py` run the whole thing under node with no
// renderer and no GL.
//
// Coordinate note, because it bites every reader once: the exporter negates Z
// (`bf42/gltf.py`), so a level occupies x in [0, worldSize] and z in
// [-worldSize, 0], and a heightmap sample index is `(x / spacing, -z / spacing)`.
//
// The collider's modules, each imported by name (`collision.js` re-exported
// them all until 2026-09-24):
//
//   `collision-materials.js`  material ids, impact effect / family / footstep
//   `heightfield.js`          the terrain lattice
//   `static-index.js`         the collision hulls' grid and its queries
//   `collision-meshes.js`     which scene nodes are hulls, and which are decks
//   `drivable-mask.js`        the drivable-deck broadphase
//   `world-collider.js`       terrain + sea + hulls behind one `cast` (this file)

import { WATER_MATERIAL } from './collision-materials.js';

// --- the world -------------------------------------------------------------

const _normal = [0, 0, 0];

/** How far past its hull's bounding sphere an articulated part may swing
 *  (a Daihatsu's second ramp leaf, 180 degrees out), metres. */
const SUB_PART_REACH = 6;

const _onInv = new Float64Array(16);
const _swing = new Float64Array(16);
const _tmpA = new Float64Array(16);
const _tmpB = new Float64Array(16);

/** `out = a * b`, column-major 4x4s; `out` must not alias either. */
function mul4(a, b, out) {
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] = a[r] * b0 + a[4 + r] * b1 + a[8 + r] * b2 + a[12 + r] * b3;
    }
  }
  return out;
}

/** `out = inverse(m)`, column-major 4x4 (three.js `Matrix4.invert`'s
 *  cofactor expansion); a singular `m` leaves the identity. */
function invert4(m, out) {
  const n11 = m[0], n21 = m[1], n31 = m[2], n41 = m[3];
  const n12 = m[4], n22 = m[5], n32 = m[6], n42 = m[7];
  const n13 = m[8], n23 = m[9], n33 = m[10], n43 = m[11];
  const n14 = m[12], n24 = m[13], n34 = m[14], n44 = m[15];
  const t11 = n23 * n34 * n42 - n24 * n33 * n42 + n24 * n32 * n43 - n22 * n34 * n43 - n23 * n32 * n44 + n22 * n33 * n44;
  const t12 = n14 * n33 * n42 - n13 * n34 * n42 - n14 * n32 * n43 + n12 * n34 * n43 + n13 * n32 * n44 - n12 * n33 * n44;
  const t13 = n13 * n24 * n42 - n14 * n23 * n42 + n14 * n22 * n43 - n12 * n24 * n43 - n13 * n22 * n44 + n12 * n23 * n44;
  const t14 = n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33 + n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34;
  const det = n11 * t11 + n21 * t12 + n31 * t13 + n41 * t14;
  if (det === 0) { out.fill(0); out[0] = out[5] = out[10] = out[15] = 1; return out; }
  const d = 1 / det;
  out[0] = t11 * d;
  out[1] = (n24 * n33 * n41 - n23 * n34 * n41 - n24 * n31 * n43 + n21 * n34 * n43 + n23 * n31 * n44 - n21 * n33 * n44) * d;
  out[2] = (n22 * n34 * n41 - n24 * n32 * n41 + n24 * n31 * n42 - n21 * n34 * n42 - n22 * n31 * n44 + n21 * n32 * n44) * d;
  out[3] = (n23 * n32 * n41 - n22 * n33 * n41 - n23 * n31 * n42 + n21 * n33 * n42 + n22 * n31 * n43 - n21 * n32 * n43) * d;
  out[4] = t12 * d;
  out[5] = (n13 * n34 * n41 - n14 * n33 * n41 + n14 * n31 * n43 - n11 * n34 * n43 - n13 * n31 * n44 + n11 * n33 * n44) * d;
  out[6] = (n14 * n32 * n41 - n12 * n34 * n41 - n14 * n31 * n42 + n11 * n34 * n42 + n12 * n31 * n44 - n11 * n32 * n44) * d;
  out[7] = (n12 * n33 * n41 - n13 * n32 * n41 + n13 * n31 * n42 - n11 * n33 * n42 - n12 * n31 * n43 + n11 * n32 * n43) * d;
  out[8] = t13 * d;
  out[9] = (n14 * n23 * n41 - n13 * n24 * n41 - n14 * n21 * n43 + n11 * n24 * n43 + n13 * n21 * n44 - n11 * n23 * n44) * d;
  out[10] = (n12 * n24 * n41 - n14 * n22 * n41 + n14 * n21 * n42 - n11 * n24 * n42 - n12 * n21 * n44 + n11 * n22 * n44) * d;
  out[11] = (n13 * n22 * n41 - n12 * n23 * n41 - n13 * n21 * n42 + n11 * n23 * n42 + n12 * n21 * n43 - n11 * n22 * n43) * d;
  out[12] = t14 * d;
  out[13] = (n13 * n24 * n31 - n14 * n23 * n31 + n14 * n21 * n33 - n11 * n24 * n33 - n13 * n21 * n34 + n11 * n23 * n34) * d;
  out[14] = (n14 * n22 * n31 - n12 * n24 * n31 - n14 * n21 * n32 + n11 * n24 * n32 + n12 * n21 * n34 - n11 * n22 * n34) * d;
  out[15] = (n12 * n23 * n31 - n13 * n22 * n31 + n13 * n21 * n32 - n11 * n23 * n32 - n12 * n21 * n33 + n11 * n22 * n33) * d;
  return out;
}

/**
 * Whether a segment (or a sphere swept along it) can reach a moved hull's
 * bounding sphere at all: closest approach of the segment to the centre.
 */
function reachesSphere(ox, oy, oz, dx, dy, dz, maxDist, m, radius) {
  const cx = m.x - ox, cy = m.y - oy, cz = m.z - oz;
  let t = cx * dx + cy * dy + cz * dz;
  if (t < 0) t = 0; else if (t > maxDist) t = maxDist;
  const ex = cx - dx * t, ey = cy - dy * t, ez = cz - dz * t;
  const reach = m.radius + radius;
  return ex * ex + ey * ey + ez * ez <= reach * reach;
}

/**
 * Terrain, sea and hulls behind one `cast`.
 *
 * Order is cheapest-first *and* narrowing: the water plane is a divide, the
 * heightfield is a handful of bilinear samples, and each one shortens the
 * segment handed to the grid. A round over open sea therefore never touches a
 * triangle at all, and a round over a town only tests the triangles in front of
 * the ground it was going to hit anyway.
 */
export class WorldCollider {
  constructor({ heightfield = null, waterLevel = null, statics = null,
               drivableMask = null, ladders = null } = {}) {
    this.heightfield = heightfield;
    this.waterLevel = Number.isFinite(waterLevel) ? waterLevel : null;
    this.statics = statics;
    /** The drivable-deck broadphase gate (`buildDrivableMask`), or null. */
    this.drivableMask = drivableMask;
    /** Gap 16: the level's climbable ladders, world space
     *  (`ladder-climb.js` `collectLadders`), or null for a level that shipped
     *  none. The soldier's climb state reads it duck-typed, so a collider
     *  without the field simply has nothing to climb. */
    this.ladders = ladders;
    this.dynamicCast = null;
    /**
     * Where the last `deckHeight` found a deck, and the triangle it found: a
     * driven vehicle needs the surface's real normal and material as well as its
     * height, and this is how it gets them without a second ray. Reused in
     * place; valid only until the next `deckHeight`.
     */
    this.deck = { y: -Infinity, nx: 0, ny: 1, nz: 0, material: 0, triangle: -1,
                  owner: -1 };
    // Straight down, always, so the direction `#normal` orients the hit against
    // is set once here rather than per query.
    this._deckHit = {
      t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0,
      dx: 0, dy: -1, dz: 0,
      material: 0, kind: '', owner: -1, triangle: -1,
    };
    /**
     * Owners whose hull has left the pose it was baked at — a parked plane a
     * jeep has just shoved. owner -> `{ fwd, inv, x, y, z, radius }`: rigid
     * column-major 4x4s, baked frame to world and back, and the hull's current
     * bounding sphere. See `setMovedOwner`.
     */
    this.moved = new Map();
    this._movedHit = {
      t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0,
      dx: 0, dy: 0, dz: 0,
      material: 0, kind: '', owner: -1, triangle: -1,
    };
    this._movedSweep = {
      t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0,
      px: 0, py: 0, pz: 0,
      material: 0, kind: '', owner: -1, triangle: -1,
    };
    this.hit = {
      t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0,
      dx: 0, dy: 0, dz: 0,
      material: 0, kind: '', owner: -1, triangle: -1,
    };
    // A second record, not a shared one: a body resolving its move must not
    // overwrite the impact a round is in the middle of reporting.
    this.sweepHit = {
      t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0,
      px: 0, py: 0, pz: 0,
      material: 0, kind: '', owner: -1, triangle: -1,
    };
    this.elapsed = 0;    // total microseconds spent in cast(), for the budget
    this.casts = 0;
  }

  /**
   * Nearest hull contact for a swept sphere, or null.
   *
   * Hulls only. Terrain is deliberately not in here: the heightfield is a
   * function of (x, z), so a body standing on it is one `surfaceHeight` lookup
   * and a clamp, which is both exact and far cheaper than sweeping a sphere
   * against a lattice. `physics.js` does that clamp, and `map.html` composes the
   * two. The sea is not solid and never appears in a sweep at all.
   */
  sweepSphere(ox, oy, oz, dx, dy, dz, maxDist, radius, skipOwner = -1, skipBodies = false,
              deckStepTop = -Infinity, deckFloorCos = 2, passObstacles = false) {
    if (!this.statics) return null;
    const started = performance.now();
    // `passObstacles`: the caller's contact with an `Obstacle` was vetoed by
    // its handler (`BFSoldier::handleCollision` 0x0827d3b0 returns 0 for one),
    // so the sweep looks past the wire to whatever stands behind it.
    this.statics.passObstacles = !!passObstacles;
    let out = this.statics.sweepSphere(
      ox, oy, oz, dx, dy, dz, maxDist, radius, skipOwner, this.sweepHit, -1, skipBodies,
      deckStepTop, deckFloorCos);
    this.statics.passObstacles = false;
    // `skipBodies`: the caller is itself a simulated body, and what it does to
    // another one is the contact solver's business (a push, a spin, damage on
    // both sides), not a dead stop against a swept sphere.
    if (this.moved.size && !skipBodies) {
      let best = out ? out.t : maxDist;
      for (const [key, m] of this.moved) {
        const owner = m.sub >= 0 ? m.owner : key;
        if (owner === skipOwner) continue;
        if (!reachesSphere(ox, oy, oz, dx, dy, dz, best, m, radius)) continue;
        const e = m.inv;
        const hit = this.statics.sweepSphere(
          e[0] * ox + e[4] * oy + e[8] * oz + e[12],
          e[1] * ox + e[5] * oy + e[9] * oz + e[13],
          e[2] * ox + e[6] * oy + e[10] * oz + e[14],
          e[0] * dx + e[4] * dy + e[8] * dz,
          e[1] * dx + e[5] * dy + e[9] * dz,
          e[2] * dx + e[6] * dy + e[10] * dz,
          best, radius, -1, this._movedSweep, owner, false, -Infinity, 2, m.sub);
        if (!hit || hit.t >= best) continue;
        best = hit.t;
        out = this.sweepHit;
        const f = m.fwd;
        out.t = hit.t;
        out.x = f[0] * hit.x + f[4] * hit.y + f[8] * hit.z + f[12];
        out.y = f[1] * hit.x + f[5] * hit.y + f[9] * hit.z + f[13];
        out.z = f[2] * hit.x + f[6] * hit.y + f[10] * hit.z + f[14];
        out.px = f[0] * hit.px + f[4] * hit.py + f[8] * hit.pz + f[12];
        out.py = f[1] * hit.px + f[5] * hit.py + f[9] * hit.pz + f[13];
        out.pz = f[2] * hit.px + f[6] * hit.py + f[10] * hit.pz + f[14];
        out.nx = f[0] * hit.nx + f[4] * hit.ny + f[8] * hit.nz;
        out.ny = f[1] * hit.nx + f[5] * hit.ny + f[9] * hit.nz;
        out.nz = f[2] * hit.nx + f[6] * hit.ny + f[10] * hit.nz;
        out.material = hit.material;
        out.owner = owner;
        out.triangle = hit.triangle;
        out.kind = hit.kind;
      }
    }
    this.elapsed += (performance.now() - started) * 1000;
    this.casts++;
    return out;
  }

  /**
   * The `Obstacle` (barbed wire) a hit record's triangle belongs to, as an
   * id into `obstacleNode`, or -1. `ObjectTemplate.create Obstacle` is the
   * only static class with a collision handler of its own
   * (`Obstacle::handleCollision` lnxded 0x08315e10).
   */
  obstacleAt(hit) {
    if (!hit || !this.statics?.obstacleOf) return -1;
    return this.statics.obstacleOf(hit.triangle);
  }

  /** The scene node of obstacle `id`, or null. */
  obstacleNode(id) {
    return id >= 0 ? this.statics?.obstacleNodes?.[id] ?? null : null;
  }

  /**
   * Tell the collider an owner's hull now sits somewhere other than where the
   * index baked it.
   *
   * The index is a counting sort over world-space triangles and is not
   * rebuilt for a vehicle that has been nudged two metres. Instead the owner
   * is switched off in the index proper (`disableOwner`) and every query is
   * asked a second time in the hull's *baked* frame, against that owner's
   * triangles only: a rigid transform of the ray costs eighteen multiplies and
   * the triangles, the grid and the narrowphase are all reused as they are.
   * `fwd` takes baked space to world, `inv` is its inverse; both are
   * column-major 4x4 element arrays (a three.js `Matrix4.elements`), copied.
   * `x, y, z, radius` bound the hull where it is now, for the cheap reject.
   */
  setMovedOwner(owner, fwd, inv, x, y, z, radius) {
    let m = this.moved.get(owner);
    if (!m) {
      m = { fwd: new Float64Array(16), inv: new Float64Array(16), x: 0, y: 0, z: 0, radius: 0, sub: -1 };
      this.moved.set(owner, m);
      this.statics?.disableOwner?.(owner);
      // The index answers for its own moved owners from here on, so a caller
      // that reaches past this collider to `statics.cast` — `soldier.js`'s
      // `settle`, which avoids the terrain marcher on purpose — still finds a
      // hull that has been driven. See `CollisionIndex.cast`'s own note.
      if (this.statics && !this.statics.movedPass) {
        this.statics.movedPass = (ox, oy, oz, dx, dy, dz, best, skipOwner, out) =>
          this.castMoved(ox, oy, oz, dx, dy, dz, best, skipOwner, out);
      }
    }
    m.fwd.set(fwd); m.inv.set(inv);
    m.x = x; m.y = y; m.z = z; m.radius = radius;
    this.#syncSubParts(owner, m);
  }

  /**
   * The owner's articulated sub-parts (`CollisionIndex.subParts`: a landing
   * craft's ramp, a turret) against the pose they were baked in. One whose
   * rig has swung it is taken out of the owner's own pass (`_subActive`) and
   * given a frame of its own in `moved`, keyed `sub:<id>`, which every query
   * loop over `moved` asks with that sub-part alone and reports as the owner:
   *
   *   baked world -> world = fwd * Ob * inv(On) * Sn * inv(Sb)
   *
   * `Ob`/`Sb` the owner's and the part's world matrices at the bake, `On`/`Sn`
   * the scene graph's now. The owner's `fwd` carries the hull; `inv(On) * Sn`
   * is only the swing of the part inside it, so a render pose a tick ahead of
   * the drive model does not move the ramp off its hinge.
   */
  #syncSubParts(owner, m) {
    const statics = this.statics;
    if (!statics?.subs) return;
    let list = this._subsByOwner?.get(owner);
    if (!this._subsByOwner) this._subsByOwner = new Map();
    if (list === undefined) {
      list = [];
      statics.subParts.forEach((part, id) => { if (part.owner === owner) list.push(id); });
      this._subsByOwner.set(owner, list);
    }
    if (!list.length) return;
    const ownerNode = statics.ownerNodes[owner];
    if (!ownerNode?.matrixWorld) return;
    invert4(ownerNode.matrixWorld.elements, _onInv);
    for (const id of list) {
      const part = statics.subParts[id];
      const key = `sub:${id}`;
      // The swing inside the hull now, against the same at the bake.
      mul4(_onInv, part.node.matrixWorld.elements, _swing);
      if (!part.bakedSwing) {
        part.bakedSwing = new Float64Array(16);
        invert4(part.ownerBaked, _tmpA);
        mul4(_tmpA, part.baked, part.bakedSwing);
        part.bakedInv = new Float64Array(16);
        invert4(part.baked, part.bakedInv);
      }
      let moved = false;
      for (let i = 0; i < 16; i++) {
        if (Math.abs(_swing[i] - part.bakedSwing[i]) > 1e-4) { moved = true; break; }
      }
      if (!moved) {
        statics._subActive[id] = 0;
        this.moved.delete(key);
        continue;
      }
      let e = this.moved.get(key);
      if (!e) {
        e = { fwd: new Float64Array(16), inv: new Float64Array(16), x: 0, y: 0, z: 0, radius: 0,
              owner, sub: id };
        this.moved.set(key, e);
      }
      mul4(m.fwd, part.ownerBaked, _tmpA);
      mul4(_tmpA, _swing, _tmpB);
      mul4(_tmpB, part.bakedInv, e.fwd);
      invert4(e.fwd, e.inv);
      // The part swings within reach of the hull's own sphere; a ramp laid
      // flat reaches a few metres past it.
      e.x = m.x; e.y = m.y; e.z = m.z; e.radius = m.radius + SUB_PART_REACH;
      statics._subActive[id] = 1;
    }
  }

  /**
   * Every moved owner's own triangles against one ray, in world space.
   *
   * The second half of `setMovedOwner`'s arrangement, factored out of `cast` so
   * the index can run it too. Improves `out` in place and returns true when it
   * found something nearer than `best`; leaves `out` alone otherwise.
   */
  castMoved(ox, oy, oz, dx, dy, dz, best, skipOwner, out) {
    if (!this.statics || !this.moved.size || !(best > 0)) return false;
    let improved = false;
    for (const [key, m] of this.moved) {
      const owner = m.sub >= 0 ? m.owner : key;
      if (owner === skipOwner) continue;
      if (!reachesSphere(ox, oy, oz, dx, dy, dz, best, m, 0)) continue;
      const e = m.inv;
      // The index faces a hit normal toward the incoming round, and reads the
      // round's direction off the record it is handed.
      const probe = this._movedHit;
      probe.dx = e[0] * dx + e[4] * dy + e[8] * dz;
      probe.dy = e[1] * dx + e[5] * dy + e[9] * dz;
      probe.dz = e[2] * dx + e[6] * dy + e[10] * dz;
      const hit = this.statics.cast(
        e[0] * ox + e[4] * oy + e[8] * oz + e[12],
        e[1] * ox + e[5] * oy + e[9] * oz + e[13],
        e[2] * ox + e[6] * oy + e[10] * oz + e[14],
        probe.dx, probe.dy, probe.dz,
        best, -1, probe, owner, false, false, -Infinity, 2, m.sub);
      if (!hit || hit.t >= best) continue;
      best = hit.t;
      improved = true;
      const f = m.fwd;
      out.t = hit.t;
      out.x = ox + dx * hit.t; out.y = oy + dy * hit.t; out.z = oz + dz * hit.t;
      out.nx = f[0] * hit.nx + f[4] * hit.ny + f[8] * hit.nz;
      out.ny = f[1] * hit.nx + f[5] * hit.ny + f[9] * hit.nz;
      out.nz = f[2] * hit.nx + f[6] * hit.ny + f[10] * hit.nz;
      out.material = hit.material;
      out.owner = owner;
      out.triangle = hit.triangle;
      out.kind = 'object';
    }
    return improved;
  }

  /** The owner is back where it was baked (a respawn), or gone (a wreck). */
  clearMovedOwner(owner, { enable = true } = {}) {
    if (!this.moved.delete(owner)) return;
    for (const id of this._subsByOwner?.get(owner) ?? []) {
      this.moved.delete(`sub:${id}`);
      this.statics._subActive[id] = 0;
    }
    if (enable) this.statics?.enableOwner?.(owner);
  }

  /**
   * The top of the drivable deck under (x, z) **at or below `fromY`**, exactly,
   * or -Infinity where there is none. Leaves the surface it found in `this.deck`.
   *
   * A downward ray against the real collision triangles of the drivable statics
   * only (`CollisionIndex.drivable`), which is what makes this the ride surface
   * a soldier already walks on rather than an approximation of it: the repair
   * bay's incline comes out continuous, a humped span comes out arched, and the
   * answer is a triangle, so the caller can have its normal and its material
   * for free.
   *
   * Two properties do the work that the old height raster could not:
   *
   * - **It is height-aware.** The ray starts at `fromY` and goes down, so a
   *   vehicle under a bridge is never offered the deck above it, and a vehicle
   *   on the deck is never offered the riverbed. `fromY` is the caller's own
   *   reference: a wheel passes its axle plus the step it can climb, so a deck
   *   within reach is mounted and one above it is not.
   * - **The topmost surface wins by construction.** `cast` returns the NEAREST
   *   hit, and the nearest hit going down from above a deck is its road surface;
   *   the underside of the same span is behind it and can never be picked. That
   *   is the "sinks below the bridge" bug — the raster's largest-footprint rule
   *   could not tell a deck from its own soffit, which has the same footprint.
   *
   * The broadphase (`drivableMask`) is consulted first and answers most calls
   * with no ray at all; see `buildDrivableMask`.
   */
  deckHeight(x, z, fromY) {
    const deck = this.deck;
    deck.y = -Infinity;
    deck.triangle = -1;
    const mask = this.drivableMask;
    const statics = this.statics;
    if (!mask || !statics || !Number.isFinite(fromY)) return -Infinity;
    const ix = Math.floor((x - mask.minX) / mask.cellSize);
    const iz = Math.floor((z - mask.minZ) / mask.cellSize);
    if (ix < 0 || iz < 0 || ix >= mask.cols || iz >= mask.rows) return -Infinity;
    const cell = iz * mask.cols + ix;
    const lo = mask.minY[cell], hi = mask.maxY[cell];
    if (!(lo <= hi)) return -Infinity;         // no deck triangle over this cell
    if (fromY < lo) return -Infinity;          // every deck here is above us
    // Clamp the ray to the cell's own band, and lift the origin by a millimetre
    // so a query taken exactly ON the surface still finds it (`#intersect`
    // ignores a hit at t = 0).
    const top = Math.min(fromY, hi) + 1e-3;
    const hit = statics.cast(x, top, z, 0, -1, 0, top - lo + 2e-3, -1,
                             this._deckHit, -1, true);
    if (!hit) return -Infinity;
    deck.y = hit.y;
    deck.nx = hit.nx; deck.ny = hit.ny; deck.nz = hit.nz;
    deck.material = hit.material;
    deck.triangle = hit.triangle;
    deck.owner = hit.owner;
    return hit.y;
  }

  /**
   * The height a thing standing at (x, z) rests on: ground, or the sea.
   *
   * `fromY` is **opt-in and vehicles only**. Passed, the answer also includes a
   * drivable deck at or below it (`deckHeight`), which is how a driven vehicle
   * rides a bridge span or a repair bay's apron. Omitted — every other caller in
   * the viewer: the soldier, the aircraft and boat floors, the cameras, spawn
   * placement, the parked-vehicle settle — the answer is terrain and sea, and
   * nothing else, exactly as it was before decks existed. Those callers must not
   * see a deck through this: a soldier meets a bridge through `cast`, from a real
   * triangle, which is why walking over one has always worked and why lifting
   * the shared surface instead put anyone standing *under* a bridge on top of it.
   */
  surfaceHeight(x, z, fromY = NaN) {
    let ground = this.heightfield ? this.heightfield.height(x, z) : NaN;
    if (this.waterLevel !== null) {
      ground = Number.isNaN(ground) ? this.waterLevel : Math.max(ground, this.waterLevel);
    }
    if (Number.isFinite(fromY)) {
      const deck = this.deckHeight(x, z, fromY);
      // `!(deck <= ground)` rather than `>`, so a level with no heightfield (a
      // harness, a mod whose lattice would not rebuild) still gets its deck.
      if (Number.isFinite(deck) && !(deck <= ground)) ground = deck;
    }
    return ground;
  }

  /**
   * The static world as `body-statics.js` asks about it: the three functions a
   * hull vertex probe needs, bound to this collider.
   *
   * Statics only — no terrain, no sea, no simulated body. Terrain is the drive
   * model's (`groundHeight`) and a body is the contact solver's; what is left
   * is exactly the buildings, walls, piers and parked scenery a hull can hit,
   * which is what the engine's `checkObjectVsObject` meets on this side.
   *
   * `deckFloorCos` is `ground-contact.js`'s `DECK_FLOOR_COS`: a drivable triangle
   * within 60 degrees of horizontal is a ride surface, and a hull vertex must
   * not find it any more than the old swept sphere could.
   *
   * The two calls are ordered, not independent: `near` chooses this body's
   * candidate triangles for the tick and `cast` narrows against that choice.
   * Call `near` once per body before its vertex casts — which is what
   * `body-statics.js` does — or `cast` answers from a stale set.
   */
  staticProbe({ deckFloorCos = 0.5, capacity = 8192 } = {}) {
    const world = this;
    const hit = {
      t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0,
      dx: 0, dy: 0, dz: 0,
      material: 0, kind: '', owner: -1, triangle: -1,
    };
    // The body's candidate set for this tick. `near` fills it, the vertex
    // `cast`s that follow narrow against it — the engine's own split, and the
    // difference between one cell walk per body per tick and one per vertex
    // (2.9 ms a tick against 0.3, measured on Berlin with a Hanomag).
    // 8,192 is a wide margin: the box is the hull's own bounding sphere grown
    // by a tick of travel, and Berlin's densest 32 m cell holds about 2,100
    // triangles in total. A body that somehow filled it would simply not be
    // tested against the rest, which is why the margin is wide rather than
    // tight.
    const candidates = new Int32Array(capacity);
    let count = 0;
    // Per owner: 0 not asked yet, 1 not an Obstacle, 2 an Obstacle.
    const obstacleOf = { statics: null, kind: null };
    return {
      near(x, y, z, dx, dy, dz, dist, radius, owner, stepTop) {
        const s = world.statics;
        count = 0;
        if (!s) return false;
        const ex = x + dx * dist, ey = y + dy * dist, ez = z + dz * dist;
        count = s.collectInBox(
          Math.min(x, ex) - radius, Math.min(y, ey) - radius, Math.min(z, ez) - radius,
          Math.max(x, ex) + radius, Math.max(y, ey) + radius, Math.max(z, ez) + radius,
          owner, true, stepTop, deckFloorCos, candidates);
        return count > 0;
      },
      cast(ox, oy, oz, dx, dy, dz, maxDist) {
        const s = world.statics;
        if (!s || !count) return null;
        return s.castAmong(candidates, count, ox, oy, oz, dx, dy, dz, maxDist, hit);
      },
      /** Whether `owner` is an `Obstacle` (`templateKind`, the class
       *  `ObjectTemplate.create Obstacle` makes: barbed wire). */
      obstacle(owner) {
        const s = world.statics;
        if (!s || owner < 0) return false;
        if (obstacleOf.statics !== s) {
          obstacleOf.statics = s;
          obstacleOf.kind = new Uint8Array(s.ownerNodes.length);
        }
        let k = obstacleOf.kind[owner];
        if (!k) {
          k = s.ownerNodes[owner]?.userData?.templateKind === 'Obstacle' ? 2 : 1;
          obstacleOf.kind[owner] = k;
        }
        return k === 2;
      },
      /** The `Obstacle` the hit's own triangle belongs to, or -1 (per
       *  triangle: XPack2's fences carry the wire as a child of a `Bundle`). */
      obstacleAt(record) {
        return world.obstacleAt(record);
      },
      supportY(x, z, fromY) {
        return world.surfaceHeight(x, z, fromY);
      },
      /** How many candidates the last `near` kept, for a cost trace. */
      candidateCount() { return count; },
    };
  }

  /**
   * The contact normal of the drivable deck at (x, z) below `fromY`, written
   * into `out` as [nx, ny, nz]; false when no deck is the surface there.
   *
   * The hit triangle's own normal, oriented up (`#normal` faces it against the
   * downward ray). A driven vehicle needs this rather than a finite difference
   * of the height, so a tank pitches along the repair bay's incline and levels
   * on the pad instead of reading the step between two raster cells as a cliff.
   * Returns false where the terrain is still the higher surface, so the caller
   * keeps the heightfield gradient it has always used there.
   */
  deckNormal(x, z, fromY, out) {
    if (!this.deckSurface(x, z, fromY)) return false;
    out[0] = this.deck.nx; out[1] = this.deck.ny; out[2] = this.deck.nz;
    return true;
  }

  /**
   * `this.deck` when a drivable deck — not the terrain or the sea — is what a
   * vehicle at (x, z) below `fromY` is standing on, else null.
   *
   * The one place the "is the deck the surface here" comparison lives, so the
   * height, the normal and the material never disagree about it.
   */
  deckSurface(x, z, fromY) {
    if (!this.drivableMask || !this.statics) return null;
    const deck = this.deckHeight(x, z, fromY);
    if (!Number.isFinite(deck)) return null;
    let ground = this.heightfield ? this.heightfield.height(x, z) : NaN;
    if (this.waterLevel !== null) {
      ground = Number.isNaN(ground) ? this.waterLevel : Math.max(ground, this.waterLevel);
    }
    return deck <= ground ? null : this.deck;
  }

  /**
   * Nearest surface along a segment, or null.
   *
   * `dx, dy, dz` unit, `maxDist` metres. Returns the shared `hit` record — do
   * not keep it past the next call.
   */
  cast(ox, oy, oz, dx, dy, dz, maxDist, skipOwner = -1) {
    const started = performance.now();
    const out = this.hit;
    out.dx = dx; out.dy = dy; out.dz = dz;
    let best = maxDist;
    let kind = '';
    // Water: one plane, and only from above. A round that starts under the
    // surface (a boat's gun at trough level) is already wet; stopping it at the
    // ceiling it is under would delete it at the muzzle.
    if (this.waterLevel !== null && dy < 0 && oy > this.waterLevel) {
      const t = (oy - this.waterLevel) / -dy;
      if (t >= 0 && t < best) { best = t; kind = 'water'; }
    }
    // Terrain: march the lattice, then bisect the crossing.
    if (this.heightfield) {
      const t = this.#terrain(ox, oy, oz, dx, dy, dz, best);
      if (t >= 0 && t < best) { best = t; kind = 'terrain'; }
    }
    // Hulls: whatever is left of the segment.
    if (this.statics && best > 0) {
      const object = this.statics.cast(ox, oy, oz, dx, dy, dz, best, skipOwner, out);
      if (object) { best = object.t; kind = 'object'; }
    }
    if (this.dynamicCast && best > 0) {
      const dyn = this.dynamicCast(ox, oy, oz, dx, dy, dz, best, skipOwner);
      if (dyn && dyn.t < best) {
        best = dyn.t;
        kind = 'object';
        out.t = dyn.t;
        out.x = dyn.x; out.y = dyn.y; out.z = dyn.z;
        out.nx = dyn.nx; out.ny = dyn.ny; out.nz = dyn.nz;
        out.material = dyn.material ?? 61;
        out.owner = dyn.owner ?? -1;
        out.triangle = -1;
        out.kind = 'object';
      }
    }
    if (this.castMoved(ox, oy, oz, dx, dy, dz, best, skipOwner, out)) {
      best = out.t;
      kind = 'object';
    }
    this.elapsed += (performance.now() - started) * 1000;
    this.casts++;
    if (!kind) return null;
    if (kind === 'object') return out;
    out.t = best;
    out.x = ox + dx * best;
    out.y = oy + dy * best;
    out.z = oz + dz * best;
    out.owner = -1;
    out.triangle = -1;
    out.kind = kind;
    if (kind === 'water') {
      out.nx = 0; out.ny = 1; out.nz = 0;
      out.material = WATER_MATERIAL;
      // The engine snaps spray to the surface (`moveToWaterSurface 1` on
      // `Em_WaterSprite`); the hit is already exactly on it.
      out.y = this.waterLevel;
    } else {
      this.heightfield.normal(out.x, out.z, _normal);
      out.nx = _normal[0]; out.ny = _normal[1]; out.nz = _normal[2];
      out.material = this.heightfield.material(out.x, out.z);
    }
    return out;
  }

  /**
   * First point along the segment where it is at or below the heightfield.
   *
   * Steps by one lattice cell of horizontal travel — a 1000 m/s round covers
   * 16.7 m in a frame, so four samples on a 4 m lattice — then bisects the
   * bracketing interval eight times, which pins the crossing to under 7 cm of a
   * 16 m step. A round that starts underground (spawned inside a hill, or the
   * lattice has a hole) is left alone rather than deleted at the muzzle.
   */
  #terrain(ox, oy, oz, dx, dy, dz, maxDist) {
    const field = this.heightfield;
    const horizontal = Math.max(Math.abs(dx), Math.abs(dz));
    const step = horizontal > 1e-6
      ? Math.min(maxDist, field.spacing / horizontal)
      : maxDist;
    let tPrev = 0;
    // Height above ground. NaN where the lattice has a hole, and NaN fails the
    // test, which is what leaves a round over a missing tile alone.
    if (!(oy - field.height(ox, oz) > 0)) return -1;
    for (let i = 1; i <= 64; i++) {
      const t = Math.min(step * i, maxDist);
      const f = (oy + dy * t) - field.height(ox + dx * t, oz + dz * t);
      if (f <= 0) {
        let lo = tPrev, hi = t;
        for (let k = 0; k < 8; k++) {
          const mid = (lo + hi) / 2;
          const fm = (oy + dy * mid) - field.height(ox + dx * mid, oz + dz * mid);
          if (fm > 0) lo = mid; else hi = mid;
        }
        return hi;
      }
      if (t >= maxDist) break;
      tPrev = t;
    }
    return -1;
  }

  /** Microseconds per cast since the last reset, and the reset. */
  drainCost() {
    const casts = this.casts;
    const per = casts ? this.elapsed / casts : 0;
    const total = this.elapsed;
    this.elapsed = 0;
    this.casts = 0;
    const s = this.statics?.stats;
    const stats = s ? { ...s } : null;
    if (s) { s.queries = 0; s.cells = 0; s.candidates = 0; s.tests = 0; }
    return { casts, microsPerCast: per, microsTotal: total, statics: stats };
  }
}
