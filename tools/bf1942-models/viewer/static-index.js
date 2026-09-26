// The static collision hulls: every collision triangle in the level, in one
// XZ grid, and the ray / swept-sphere / box queries against it.
//
// Split out of `collision.js`; see `world-collider.js`'s header for why a
// uniform grid and not a BVH, and for the coordinate note. Which scene
// nodes are collision hulls, and which of those are drivable decks, is
// `collision-meshes.js`, re-exported from here.

import { isCollisionMesh, isDrivableCollisionMesh } from './collision-meshes.js';

export { isCollisionMesh, isDrivableCollisionMesh } from './collision-meshes.js';

// --- static hulls ----------------------------------------------------------

// Metres. 32 m (64 x 64 cells over a 2048 m level) until 2026-09-26: Berlin
// packs 400 triangles into its median cell and 1,800 into its fullest, and a
// soldier's short probes (a metre or two, `body-statics.js`) and the bots'
// sense rays paid the whole cell's candidate walk each -- 1,440 candidates a
// query, 42 us a cast, 6.8 ms of every 30 Hz tick for sixteen bots on foot.
// At 8 m the same queries walk a sixteenth of the triangles; a long ray
// crosses more cells, each with a Y-band reject, and the DDA's step guard
// below is sized from the grid rather than fixed (features/bot-fight-performance).
const CELL_SIZE = 8;

/** Smallest root of `a t^2 + b t + c` inside [0, limit], or -1. */
function lowestRoot(a, b, c, limit) {
  if (a > -1e-12 && a < 1e-12) return -1;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const root = Math.sqrt(disc);
  let lo = (-b - root) / (2 * a);
  let hi = (-b + root) / (2 * a);
  // `a` is negative for the edge quadratic, which flips the two.
  if (lo > hi) { const swap = lo; lo = hi; hi = swap; }
  if (lo >= 0 && lo <= limit) return lo;
  if (hi >= 0 && hi <= limit) return hi;
  return -1;
}

/**
 * Every collision triangle in the level, in world space, in one XZ grid.
 *
 * Triangles are stored flat — nine floats each, no objects — because the
 * narrowphase runs Moller-Trumbore straight out of the array and a per-triangle
 * object would cost more in cache misses than the test costs in arithmetic.
 *
 * `owners` is which placed object a triangle belongs to. A round is fired from
 * inside its own vehicle's hull, so without it every shot would detonate at the
 * muzzle; `cast` takes the firing object's owner id and skips it.
 */
export class CollisionIndex {
  // Where `#sweepTriangle` leaves its contact. Instance scratch rather than an
  // object, for the same reason the triangles are nine loose floats: the sweep
  // runs over every candidate in the cell and must not allocate once.
  #sweepNx = 0; #sweepNy = 0; #sweepNz = 0;
  #sweepPx = 0; #sweepPy = 0; #sweepPz = 0;

  constructor(tris, materials, owners, ownerNodes, bounds, drivable = null) {
    this.tris = tris;                 // Float32Array, 9 per triangle
    this.materials = materials;       // Uint16Array, 1 per triangle
    this.owners = owners;             // Int32Array, 1 per triangle
    this.ownerNodes = ownerNodes;     // Object3D[] indexed by owner id
    /**
     * 1 where the triangle belongs to a surface a ground vehicle drives on top
     * of rather than into — a bridge span, a repair/reload bay, a ramp (see
     * `DRIVABLE_TOP_RE`). Per TRIANGLE, not per owner, because both readers
     * need that resolution: the deck ray must ignore the terrain and the
     * buildings around the bridge, and the vehicle hull sweep must keep the
     * bridge's own parapet walls while ignoring its road surface. null when
     * the level ships no drivable static at all.
     */
    this.drivable = drivable;         // Uint8Array, 1 per triangle, or null
    this.count = materials.length;
    this.minX = bounds.minX;
    this.minZ = bounds.minZ;
    this.cols = bounds.cols;
    this.rows = bounds.rows;
    this.cellSize = bounds.cellSize;
    this.cellStart = null;            // Int32Array(cols * rows + 1)
    this.cellItems = null;            // Int32Array
    this.cellMinY = null;             // Float32Array(cols * rows)
    this.cellMaxY = null;
    this._stamp = new Int32Array(this.count);
    this._query = 0;
    // Owners whose hull should not block walking or rounds — a faded wreck
    // whose visual is gone but whose triangles are still in the bake.
    this._disabled = new Uint8Array(ownerNodes.length);
    // Owners the rigid-body world simulates (`body-world.js`). A body's own
    // hull sweep leaves them to the contact solver; everything else - a
    // round, a soldier - still meets them here.
    this._body = new Uint8Array(ownerNodes.length);
    // Measured per-query work, for the budget in the feature doc. Reset by
    // whoever is reading it.
    this.stats = { queries: 0, cells: 0, candidates: 0, tests: 0 };
    /**
     * Articulated sub-parts: a hull's collision meshes that hang under a rig
     * node which swings on its own -- a landing craft's ramp
     * (`DaihatsuLanding1/2`, `Lcvp_Ramp`, `c_PIPitch`), a turret. The bake
     * put their triangles where the part stood at load, and the owner moves
     * as one rigid body (`WorldCollider.setMovedOwner`), so a lowered ramp
     * left its raised copy standing at the hinge as an invisible wall. Per
     * triangle, the sub-part it belongs to (-1: the hull itself); per
     * sub-part, its node, its owner and the two world matrices it was baked
     * under. A sub-part flagged active (`_subActive`, set by the world
     * collider when its pose leaves the bake) is left out of every query
     * except its own (`onlySub`), which the collider asks in its own frame.
     */
    this.subs = null;                 // Int32Array, 1 per triangle, or null
    this.subParts = [];               // { node, owner, ownerBaked, baked }
    this._subActive = new Uint8Array(0);
    /**
     * Per triangle, the `Obstacle` object it belongs to (an index into
     * `obstacleNodes`), or -1; null when the level places none. Per TRIANGLE,
     * not per owner: XPack2's `Milifence_*` is a `Bundle` whose wire is an
     * `Obstacle` child beside a `SimpleObject` fence, and the engine asks each
     * child's own `handleCollision` (`Obstacle::handleCollision` lnxded
     * 0x08315e10), so the fence stops a body and the wire beside it does not.
     */
    this.obstacles = null;            // Int32Array, 1 per triangle, or null
    this.obstacleNodes = [];          // Object3D[] indexed by obstacle id
    /** While set, `sweepSphere` looks past obstacle triangles: a body whose
     *  contact with the wire the handler vetoed goes on to meet what is
     *  behind it (`WorldCollider.sweepSphere`'s `passObstacles`). */
    this.passObstacles = false;
    /**
     * Per triangle, which of its edges are seams inside one flat surface
     * rather than a rim: bit 0 the edge a-b, bit 1 a-c, bit 2 b-c, set when
     * the same owner and sub-part has a triangle across that edge lying in
     * (near enough) the same plane (`markInternalEdges`). A sphere sunk into
     * a wall or a floor meets those seams edge-on as it slides, and they are
     * not there to meet: the neighbour's face is. Read only where the sweep
     * tests a triangle's border without closing on its plane. null: every
     * edge a rim.
     */
    this.internalEdges = null;
  }

  /** Attach the per-triangle obstacle ids (`buildCollisionIndex`). */
  setObstacles(ids, nodes) {
    this.obstacles = nodes.length ? ids : null;
    this.obstacleNodes = nodes;
  }

  /** The `Obstacle` a triangle belongs to, or -1. */
  obstacleOf(tri) {
    if (!this.obstacles || !(tri >= 0) || tri >= this.obstacles.length) return -1;
    return this.obstacles[tri];
  }

  /** Attach the per-triangle sub-part ids (`buildCollisionIndex`). */
  setSubParts(subs, parts) {
    this.subs = parts.length ? subs : null;
    this.subParts = parts;
    this._subActive = new Uint8Array(parts.length);
  }

  /** Is a sub-part's triangle out of this query? `onlySub` >= 0 keeps that
   *  sub-part alone; otherwise an active sub-part is out. */
  #subSkips(tri, onlySub) {
    const s = this.subs[tri];
    return onlySub >= 0 ? s !== onlySub : (s >= 0 && this._subActive[s] !== 0);
  }

  /**
   * Stop (or restore) an owner's baked hull without rebuilding the index.
   *
   * A disabled owner's triangles stay in the grid. `cast` and `sweepSphere`
   * take an `onlyOwner` that tests exactly one owner's triangles and ignores
   * this flag — which is how `WorldCollider` still hits a vehicle that has
   * been shoved off its spawn: it asks in the hull's own baked frame.
   */
  disableOwner(id) {
    if (id >= 0 && id < this._disabled.length) this._disabled[id] = 1;
  }

  enableOwner(id) {
    if (id >= 0 && id < this._disabled.length) this._disabled[id] = 0;
  }

  /** Mark (or unmark) an owner as a simulated body; see `sweepSphere`'s `skipBodies`. */
  setBodyOwner(id, on = true) {
    if (id >= 0 && id < this._body.length) this._body[id] = on ? 1 : 0;
  }
  ownerDisabled(id) {
    return id >= 0 && id < this._disabled.length && this._disabled[id] !== 0;
  }

  /**
   * The owner id of whichever placed object `node` sits under, or -1.
   *
   * Linear in the placement count, so this is a load-time or once-per-gun
   * question, never a per-round one — `GunFire` caches what it gets back.
   */
  ownerOf(node) {
    for (let n = node; n; n = n.parent) {
      const id = this.ownerNodes.indexOf(n);
      if (id >= 0) return id;
    }
    return -1;
  }

  cell(ix, iz) { return iz * this.cols + ix; }

  /**
   * Nearest hit along a segment, or null.
   *
   * `dx, dy, dz` must be unit length and `maxDist` is the segment length, so a
   * returned `t` is metres from the origin. `out` is filled in place and
   * returned — the caller owns one and it never allocates per round per frame.
   *
   * `onlyDrivable` narrows the test to the drivable-surface triangles (the
   * `drivable` mask): that is how `WorldCollider.deckHeight` asks "what deck is
   * under this wheel" without the terrain, the buildings or a parked truck
   * answering. With no mask built, it can only answer "nothing".
   *
   * `skipBodies` and the two `deck*` arguments mean exactly what they mean to
   * `sweepSphere`, and are here for the same one caller: a driven vehicle's
   * hull, which now probes its own collision vertices along a ray
   * (`body-statics.js`) instead of sweeping a sphere. A simulated body is the
   * contact solver's, and a drivable deck is a floor rather than a wall,
   * whichever query asks.
   */
  cast(ox, oy, oz, dx, dy, dz, maxDist, skipOwner, out, onlyOwner = -1,
       onlyDrivable = false, skipBodies = false, deckStepTop = -Infinity,
       deckFloorCos = 2, onlySub = -1) {
    if (onlyDrivable && !this.drivable) return null;
    if (!this.cellStart || maxDist <= 0) return null;
    const stats = this.stats;
    stats.queries++;
    const stamp = ++this._query;
    const size = this.cellSize;
    // Cell coordinates of the start, deliberately *not* clamped: a round can
    // begin outside the indexed area and fly into it, and the per-cell bounds
    // check below is what keeps an out-of-range index harmless.
    let ix = Math.floor((ox - this.minX) / size);
    let iz = Math.floor((oz - this.minZ) / size);
    const stepX = dx > 0 ? 1 : (dx < 0 ? -1 : 0);
    const stepZ = dz > 0 ? 1 : (dz < 0 ? -1 : 0);
    // Distance along the ray to the next cell boundary on each axis, and the
    // distance between boundaries (Amanatides & Woo).
    const tDeltaX = stepX ? Math.abs(size / dx) : Infinity;
    const tDeltaZ = stepZ ? Math.abs(size / dz) : Infinity;
    let tMaxX = stepX
      ? ((this.minX + (ix + (stepX > 0 ? 1 : 0)) * size) - ox) / dx
      : Infinity;
    let tMaxZ = stepZ
      ? ((this.minZ + (iz + (stepZ > 0 ? 1 : 0)) * size) - oz) / dz
      : Infinity;
    if (tMaxX < 0) tMaxX = Infinity;
    if (tMaxZ < 0) tMaxZ = Infinity;
    let tEnter = 0;
    let best = maxDist;
    let found = false;
    // Is the driven-vehicle deck gate live at all? Hoisted out of the triangle
    // loop, as `sweepSphere` hoists its own.
    const deck = this.drivable
      && (deckStepTop > -Infinity || deckFloorCos <= 1) ? this.drivable : null;
    const subs = this.subs;
    // A segment cannot cross more cells than the grid has along both axes;
    // the cap is only here so a degenerate direction cannot spin. (It was a
    // fixed 256 when the cells were 32 m; at 8 m a 1,500 m diagonal round
    // crosses 375, and a cap under that ended it short of a real hit.)
    const maxSteps = this.cols + this.rows + 2;
    for (let guard = 0; guard < maxSteps; guard++) {
      const tExit = Math.min(tMaxX, tMaxZ, maxDist);
      if (ix >= 0 && iz >= 0 && ix < this.cols && iz < this.rows) {
        const cell = this.cell(ix, iz);
        const from = this.cellStart[cell];
        const to = this.cellStart[cell + 1];
        if (to > from) {
          // Cheap reject on Y before touching a single triangle: the cell's own
          // vertical extent against the segment's over just this cell. Near-
          // ground flight over a town spends most of its candidates here.
          const tOut = Math.min(tExit, best);
          const y0 = oy + dy * tEnter;
          const y1 = oy + dy * tOut;
          const loY = Math.min(y0, y1);
          const hiY = Math.max(y0, y1);
          if (hiY >= this.cellMinY[cell] && loY <= this.cellMaxY[cell]) {
            stats.cells++;
            // The segment's own box over just this cell, for the per-triangle
            // reject below. A round crossing a town used to pay Moller-Trumbore
            // on every triangle in the cell — a thousand of them in Berlin,
            // nearly all several storeys above its head — and the short rays a
            // hull vertex probe casts (`body-statics.js`, a metre or two) pay
            // that a dozen times a tick. Six comparisons instead: 49,400
            // narrowphase tests per tick down to 116 for a half-track driving
            // through Berlin, 4.6 ms a tick down to 1.0.
            const x0 = ox + dx * tEnter, x1 = ox + dx * tOut;
            const loX = Math.min(x0, x1), hiX = Math.max(x0, x1);
            const z0 = oz + dz * tEnter, z1 = oz + dz * tOut;
            const loZ = Math.min(z0, z1), hiZ = Math.max(z0, z1);
            const p = this.tris;
            for (let k = from; k < to; k++) {
              const tri = this.cellItems[k];
              if (this._stamp[tri] === stamp) continue;
              this._stamp[tri] = stamp;
              stats.candidates++;
              if (onlyDrivable && !this.drivable[tri]) continue;
              if (onlyOwner >= 0) {
                if (this.owners[tri] !== onlyOwner) continue;
              } else {
                if (skipOwner >= 0 && this.owners[tri] === skipOwner) continue;
                if (this._disabled[this.owners[tri]]) continue;
                if (skipBodies && this._body[this.owners[tri]]) continue;
              }
              if (subs && this.#subSkips(tri, onlySub)) continue;
              const j = tri * 9;
              if (Math.min(p[j + 1], p[j + 4], p[j + 7]) > hiY
                  || Math.max(p[j + 1], p[j + 4], p[j + 7]) < loY
                  || Math.min(p[j], p[j + 3], p[j + 6]) > hiX
                  || Math.max(p[j], p[j + 3], p[j + 6]) < loX
                  || Math.min(p[j + 2], p[j + 5], p[j + 8]) > hiZ
                  || Math.max(p[j + 2], p[j + 5], p[j + 8]) < loZ) continue;
              if (deck && deck[tri] && this.#deckDrops(tri, deckStepTop, deckFloorCos)) continue;
              stats.tests++;
              const t = this.#intersect(tri, ox, oy, oz, dx, dy, dz, best);
              if (t >= 0 && t < best) {
                best = t;
                found = true;
                out.triangle = tri;
              }
            }
          }
        }
      }
      // Stop as soon as the nearest hit is behind us: anything in a later cell
      // is further along the ray by construction.
      if (found && best <= tExit) break;
      if (tExit >= maxDist) break;
      if (tMaxX < tMaxZ) { ix += stepX; tEnter = tMaxX; tMaxX += tDeltaX; }
      else { iz += stepZ; tEnter = tMaxZ; tMaxZ += tDeltaZ; }
      if (!stepX && !stepZ) break;   // straight up or down: one cell only
    }
    if (found) {
      const tri = out.triangle;
      out.t = best;
      out.x = ox + dx * best;
      out.y = oy + dy * best;
      out.z = oz + dz * best;
      out.material = this.materials[tri];
      out.owner = this.owners[tri];
      out.kind = 'object';
      this.#normal(tri, out);
    }
    // A hull that has been driven off its bake is switched OFF in this index and
    // re-asked in its own baked frame (`WorldCollider.setMovedOwner`), and that
    // second half used to live only in `WorldCollider.cast` — so a caller that
    // reaches past the world collider to the index, as `soldier.js`'s `settle`
    // deliberately does to avoid the terrain marcher, could not see a moved hull
    // at all. Spawn on a carrier that has steamed a kilometre and the deck is
    // simply not there: the man lands in the sea beside her. `movedPass` is the
    // world collider's own loop, injected, so one query answers for both halves.
    //
    // Not re-entered (`onlyOwner` is how the pass itself asks), not for a
    // drivable-only query (no moved hull carries the drivable mask), and not for
    // a caller that is itself a simulated body and owns its contacts.
    if (out && this.movedPass && onlyOwner < 0 && !onlyDrivable && !skipBodies) {
      if (this.movedPass(ox, oy, oz, dx, dy, dz,
                         found ? best : maxDist, skipOwner, out)) return out;
    }
    return found ? out : null;
  }

  /**
   * Nearest contact for a sphere of `radius` swept along a segment, or null.
   *
   * A round is a point and a body is not. `cast` answers "what does this ray
   * meet"; a walking soldier needs "how far can a 0.3 m ball travel before it
   * touches something", which is a different query and cannot be faked with a
   * ray — a ray down the middle of a doorway reports clear while the shoulders
   * are already in the frame.
   *
   * Broadphase is the same grid, queried as a rectangle rather than walked as a
   * DDA. That is deliberate: the swept volume is fat, so the cells a DDA would
   * visit are not the cells the volume touches, and a body moving at 6 m/s
   * covers 0.1 m in a tick — one or two 32 m cells either way. Building a
   * second index for this would be absurd.
   *
   * `dx, dy, dz` unit, `maxDist` metres, so `out.t` is again metres. `out.x/y/z`
   * is the sphere *centre* at contact and `out.px/py/pz` the point it touched;
   * `out.nx/ny/nz` points from the hull toward the centre, which is the
   * direction that separates them.
   *
   * `deckStepTop` and `deckFloorCos` are the driven-vehicle gate, and they only
   * ever drop triangles of a DRIVABLE surface (the `drivable` mask) — a
   * soldier, a round or a rigid body passes the defaults and sees the level
   * exactly as before. A vehicle's hull sphere is its whole bounding radius
   * (2-3 m) centred on the hull origin barely a metre off the ground, so it is
   * permanently buried in any horizontal surface it is standing on. Terrain
   * gets away with this by not being in the sweep at all; a bridge deck is a
   * static mesh, so without a gate the sweep reports a contact at t = 0 on
   * every tick a tank spends on a bridge and the tank is welded to its lip.
   * The gate is therefore what makes a deck a *floor* to the hull:
   *
   * - `deckFloorCos`: a drivable triangle within `acos(deckFloorCos)` of
   *   horizontal is a ride surface, not a wall. It drops both the road deck and
   *   its underside, and — the point of using an angle rather than a plane —
   *   the sloped approach ramp and the arch of a humped span too.
   * - `deckStepTop`: a drivable triangle lying entirely at or below this world
   *   Y is a kerb the suspension mounts rather than a wall. The caller sets it
   *   to the surface its wheels are on plus the step a driven vehicle climbs,
   *   so a deck's leading lip face is stepped over while a parapet, a pillar or
   *   a hut on the bay — all of them rising well above it — still stop the hull.
   */
  sweepSphere(ox, oy, oz, dx, dy, dz, maxDist, radius, skipOwner, out, onlyOwner = -1,
              skipBodies = false, deckStepTop = -Infinity, deckFloorCos = 2, onlySub = -1) {
    if (!this.cellStart || maxDist <= 0) return null;
    const stats = this.stats;
    stats.queries++;
    const stamp = ++this._query;
    const size = this.cellSize;
    const vx = dx * maxDist, vy = dy * maxDist, vz = dz * maxDist;
    // The swept volume's own box, grown by the radius on every side.
    const loX = Math.min(ox, ox + vx) - radius;
    const hiX = Math.max(ox, ox + vx) + radius;
    const loY = Math.min(oy, oy + vy) - radius;
    const hiY = Math.max(oy, oy + vy) + radius;
    const loZ = Math.min(oz, oz + vz) - radius;
    const hiZ = Math.max(oz, oz + vz) + radius;
    let ix0 = Math.floor((loX - this.minX) / size);
    let ix1 = Math.floor((hiX - this.minX) / size);
    let iz0 = Math.floor((loZ - this.minZ) / size);
    let iz1 = Math.floor((hiZ - this.minZ) / size);
    if (ix1 < 0 || iz1 < 0 || ix0 >= this.cols || iz0 >= this.rows) return null;
    ix0 = Math.max(0, ix0); iz0 = Math.max(0, iz0);
    ix1 = Math.min(this.cols - 1, ix1); iz1 = Math.min(this.rows - 1, iz1);
    // Fractions of the segment, not metres: the narrowphase quadratics are all
    // parameterised on the displacement vector.
    let best = 1;
    let found = false;
    // Is the driven-vehicle deck gate live at all? Hoisted out of the triangle
    // loop so the soldier and the rounds pay one boolean for it.
    const deck = this.drivable
      && (deckStepTop > -Infinity || deckFloorCos <= 1) ? this.drivable : null;
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const cell = this.cell(ix, iz);
        const from = this.cellStart[cell];
        const to = this.cellStart[cell + 1];
        if (to <= from) continue;
        if (hiY < this.cellMinY[cell] || loY > this.cellMaxY[cell]) continue;
        stats.cells++;
        for (let k = from; k < to; k++) {
          const tri = this.cellItems[k];
          if (this._stamp[tri] === stamp) continue;
          this._stamp[tri] = stamp;
          stats.candidates++;
          if (onlyOwner >= 0) {
            if (this.owners[tri] !== onlyOwner) continue;
          } else {
            if (skipOwner >= 0 && this.owners[tri] === skipOwner) continue;
            if (this._disabled[this.owners[tri]]) continue;
            if (skipBodies && this._body[this.owners[tri]]) continue;
          }
          if (this.subs && this.#subSkips(tri, onlySub)) continue;
          if (this.passObstacles && this.obstacles && this.obstacles[tri] >= 0) continue;
          // Box reject before the swept test. A ray gets away without one — the
          // per-cell Y band plus Moller-Trumbore is already cheap — but a sweep
          // costs a plane crossing, three edge quadratics and three corner
          // quadratics, and Berlin packs about a thousand triangles into the
          // 32 m cell a body is standing in, nearly all of them several storeys
          // above its head. Eighteen comparisons throws those out.
          const j = tri * 9;
          const p = this.tris;
          if (Math.min(p[j + 1], p[j + 4], p[j + 7]) > hiY
              || Math.max(p[j + 1], p[j + 4], p[j + 7]) < loY
              || Math.min(p[j], p[j + 3], p[j + 6]) > hiX
              || Math.max(p[j], p[j + 3], p[j + 6]) < loX
              || Math.min(p[j + 2], p[j + 5], p[j + 8]) > hiZ
              || Math.max(p[j + 2], p[j + 5], p[j + 8]) < loZ) continue;
          // The driven-vehicle deck gate, after the box reject so a bridge two
          // cells away never reaches it. Only a drivable triangle can be gated.
          if (deck && deck[tri] && this.#deckDrops(tri, deckStepTop, deckFloorCos)) continue;
          stats.tests++;
          const t = this.#sweepTriangle(tri, ox, oy, oz, vx, vy, vz, radius, best);
          if (t >= 0 && t <= best) {
            best = t;
            found = true;
            out.triangle = tri;
            out.nx = this.#sweepNx; out.ny = this.#sweepNy; out.nz = this.#sweepNz;
            out.px = this.#sweepPx; out.py = this.#sweepPy; out.pz = this.#sweepPz;
          }
        }
      }
    }
    if (!found) return null;
    out.t = best * maxDist;
    out.x = ox + vx * best;
    out.y = oy + vy * best;
    out.z = oz + vz * best;
    out.material = this.materials[out.triangle];
    out.owner = this.owners[out.triangle];
    out.kind = 'object';
    return out;
  }

  /**
   * A sphere swept against one triangle: the face, then its three edges, then
   * its three corners. Returns the fraction of `v` at first touch, or -1, and
   * leaves the contact in the instance scratch.
   *
   * The face case is a plane crossing; the edge and corner cases are the
   * quadratics from Fauerby's swept-sphere note, written out for a sphere of
   * arbitrary radius rather than in unit-ellipsoid space.
   *
   * What a body already inside is allowed to do is what lets it push its way
   * back out instead of freezing. Over the face (its centre projects inside
   * the triangle), moving away from the plane or along it is ignored. An edge
   * or a corner the sphere already overlaps is ignored whichever way it moves:
   * for one of those `lowestRoot` would hand back the moment the sphere comes
   * out the far side, which is not a contact, and stopping it at `t = 0`
   * instead while it closes freezes a body caught inside a parked jeep, since
   * from inside a closed hull every heading closes on some edge.
   *
   * Moving along the plane or away from it does not skip the border, though.
   * Inside the face's slab (`sd < radius`) with the centre off the face, a
   * sphere can still walk into an edge: a soldier going level at the edge of a
   * thin, near-flat plate — a landing craft's lowered ramp — has the plate
   * slicing through his middle sphere, and only the edge quadratic stops him
   * sliding under it.
   */
  #sweepTriangle(tri, cx, cy, cz, vx, vy, vz, radius, best) {
    const p = this.tris;
    const i = tri * 9;
    const ax = p[i], ay = p[i + 1], az = p[i + 2];
    const bx = p[i + 3], by = p[i + 4], bz = p[i + 5];
    const gx = p[i + 6], gy = p[i + 7], gz = p[i + 8];
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = gx - ax, e2y = gy - ay, e2z = gz - az;
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const nlen = Math.hypot(nx, ny, nz);
    if (nlen < 1e-12) return -1;               // degenerate face
    nx /= nlen; ny /= nlen; nz /= nlen;
    // Two-sided, for the same reason `#intersect` is: point the plane normal at
    // whichever side the sphere is on.
    let sd = nx * (cx - ax) + ny * (cy - ay) + nz * (cz - az);
    if (sd < 0) { nx = -nx; ny = -ny; nz = -nz; sd = -sd; }
    const nv = nx * vx + ny * vy + nz * vz;
    // The face can only be met closing on the plane. Parallel or receding, it
    // cannot; nor, outside the slab, can the border, every point of which is
    // at least `sd` away with that gap not closing. Inside the slab the border
    // is still live: `t = -1` marks that only it can be met.
    let t = -1;
    if (nv < -1e-9) {
      t = (radius - sd) / nv;
      if (t < 0) t = 0;                        // already inside the slab
      if (t > best) return -1;
    } else if (sd >= radius) {
      return -1;
    }
    // Where on the plane the sphere touches down at t — or, with no face
    // contact coming, below the centre now.
    const tf = t < 0 ? 0 : t;
    const px = cx + vx * tf - nx * radius;
    const py = cy + vy * tf - ny * radius;
    const pz = cz + vz * tf - nz * radius;
    const d11 = e1x * e1x + e1y * e1y + e1z * e1z;
    const d12 = e1x * e2x + e1y * e2y + e1z * e2z;
    const d22 = e2x * e2x + e2y * e2y + e2z * e2z;
    const denom = d11 * d22 - d12 * d12;
    // Whether a point projects inside the triangle.
    const overFace = (qx, qy, qz) => {
      if (denom <= 1e-12) return false;
      const rx = qx - ax, ry = qy - ay, rz = qz - az;
      const r1 = rx * e1x + ry * e1y + rz * e1z;
      const r2 = rx * e2x + ry * e2y + rz * e2z;
      const u = (d22 * r1 - d12 * r2) / denom;
      const w = (d11 * r2 - d12 * r1) / denom;
      return u >= 0 && w >= 0 && u + w <= 1;
    };
    if (overFace(px, py, pz)) {
      // Over the face and not closing on it: embedded, and let go.
      if (t < 0) return -1;
      this.#sweepNx = nx; this.#sweepNy = ny; this.#sweepNz = nz;
      this.#sweepPx = px; this.#sweepPy = py; this.#sweepPz = pz;
      return t;
    }
    // Off the face: the nearest of the six features on its border.
    const vv = vx * vx + vy * vy + vz * vz;
    if (vv < 1e-18) return -1;
    let hit = -1;
    const corner = (qx, qy, qz) => {
      const sx = cx - qx, sy = cy - qy, sz = cz - qz;
      const c = sx * sx + sy * sy + sz * sz - radius * radius;
      if (c < 0) return;                       // already inside it: let go
      const root = lowestRoot(vv, 2 * (vx * sx + vy * sy + vz * sz), c,
                              hit < 0 ? best : hit);
      if (root < 0) return;
      hit = root;
      this.#sweepPx = qx; this.#sweepPy = qy; this.#sweepPz = qz;
    };
    const edge = (qx, qy, qz, ex, ey, ez) => {
      const ee = ex * ex + ey * ey + ez * ez;
      if (ee < 1e-12) return;
      const kx = qx - cx, ky = qy - cy, kz = qz - cz;   // base -> corner
      const ev = ex * vx + ey * vy + ez * vz;
      const ek = ex * kx + ey * ky + ez * kz;
      const kk = kx * kx + ky * ky + kz * kz;
      // `ee (radius^2 - distance^2 to the line)`: positive while overlapping.
      const c = ee * (radius * radius - kk) + ek * ek;
      if (c > 0) return;                       // already inside it: let go
      const root = lowestRoot(
        ev * ev - ee * vv,
        2 * (ee * (vx * kx + vy * ky + vz * kz) - ev * ek),
        c,
        hit < 0 ? best : hit);
      if (root < 0) return;
      const f = (ev * root - ek) / ee;
      if (f < 0 || f > 1) return;
      hit = root;
      this.#sweepPx = qx + ex * f; this.#sweepPy = qy + ey * f; this.#sweepPz = qz + ez * f;
    };
    // Not closing on the plane, the sphere is sliding along the surface this
    // triangle is part of, so a seam inside that surface (`internalEdges`)
    // is not a border, nor a corner both of whose edges are seams.
    const seams = t < 0 && this.internalEdges ? this.internalEdges[tri] : 0;
    if ((seams & 3) !== 3) corner(ax, ay, az);
    if ((seams & 5) !== 5) corner(bx, by, bz);
    if ((seams & 6) !== 6) corner(gx, gy, gz);
    if (!(seams & 1)) edge(ax, ay, az, e1x, e1y, e1z);
    if (!(seams & 2)) edge(ax, ay, az, e2x, e2y, e2z);
    if (!(seams & 4)) edge(bx, by, bz, gx - bx, gy - by, gz - bz);
    if (hit < 0) return -1;
    // Sliding in from over the face — a wall's next panel, across a seam — the
    // sphere reaches this triangle's far rim from inside. That is the surface
    // it is already sunk into running out, not something to walk into.
    if (t < 0 && overFace(cx + vx * hit, cy + vy * hit, cz + vz * hit)) return -1;
    // The separating direction is centre-at-contact minus the point touched.
    let sx = (cx + vx * hit) - this.#sweepPx;
    let sy = (cy + vy * hit) - this.#sweepPy;
    let sz = (cz + vz * hit) - this.#sweepPz;
    const len = Math.hypot(sx, sy, sz);
    if (len < 1e-9) { sx = nx; sy = ny; sz = nz; }
    else { sx /= len; sy /= len; sz /= len; }
    this.#sweepNx = sx; this.#sweepNy = sy; this.#sweepNz = sz;
    return hit;
  }

  /**
   * The driven-vehicle deck gate for one DRIVABLE triangle: true when it is a
   * ride surface or a kerb rather than a wall, and so must be dropped. Shared
   * by `sweepSphere` and `cast` (the hull vertex probe of `body-statics.js`),
   * which have to agree — one gate deciding what a deck is, not two.
   *
   * - at or below `deckStepTop`: a kerb the suspension mounts.
   * - within `acos(deckFloorCos)` of horizontal: a road, its underside, an
   *   approach ramp or the arch of a humped span.
   */
  #deckDrops(tri, deckStepTop, deckFloorCos) {
    const p = this.tris;
    const j = tri * 9;
    if (Math.max(p[j + 1], p[j + 4], p[j + 7]) <= deckStepTop) return true;
    if (deckFloorCos > 1) return false;
    // |unit normal . up| — an absolute value, so nothing here trusts the
    // collision mesh's winding (`#intersect`'s own caveat).
    const e1x = p[j + 3] - p[j], e1y = p[j + 4] - p[j + 1], e1z = p[j + 5] - p[j + 2];
    const e2x = p[j + 6] - p[j], e2y = p[j + 7] - p[j + 1], e2z = p[j + 8] - p[j + 2];
    const cy = e1z * e2x - e1x * e2z;
    const len = Math.hypot(e1y * e2z - e1z * e2y, cy, e1x * e2y - e1y * e2x);
    return len > 1e-12 && Math.abs(cy) / len >= deckFloorCos;
  }

  /**
   * Every triangle this caller can see whose AABB overlaps the box, into
   * `out`; returns how many were written (capped at `out.length`).
   *
   * The broadphase half of a hull vertex probe (`body-statics.js`, spec §5.1's
   * one grid query per root per tick): the root collects once and every vertex
   * probe narrows against the list through `castAmong`, instead of each probe
   * walking the grid again. Triangle AABB against the box and nothing else —
   * it answers "which might", never "where".
   *
   * Pass `out = null` for the cheap existence question: it returns 1 at the
   * first candidate and 0 if there is none.
   */
  collectInBox(loX, loY, loZ, hiX, hiY, hiZ, skipOwner = -1, skipBodies = false,
               deckStepTop = -Infinity, deckFloorCos = 2, out = null) {
    if (!this.cellStart) return 0;
    const size = this.cellSize;
    let ix0 = Math.floor((loX - this.minX) / size);
    let ix1 = Math.floor((hiX - this.minX) / size);
    let iz0 = Math.floor((loZ - this.minZ) / size);
    let iz1 = Math.floor((hiZ - this.minZ) / size);
    if (ix1 < 0 || iz1 < 0 || ix0 >= this.cols || iz0 >= this.rows) return 0;
    ix0 = Math.max(0, ix0); iz0 = Math.max(0, iz0);
    ix1 = Math.min(this.cols - 1, ix1); iz1 = Math.min(this.rows - 1, iz1);
    const deck = this.drivable
      && (deckStepTop > -Infinity || deckFloorCos <= 1) ? this.drivable : null;
    const p = this.tris;
    const stats = this.stats;
    stats.queries++;
    let kept = 0;
    const limit = out ? out.length : 0;
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const cell = this.cell(ix, iz);
        const from = this.cellStart[cell];
        const to = this.cellStart[cell + 1];
        if (to <= from) continue;
        if (hiY < this.cellMinY[cell] || loY > this.cellMaxY[cell]) continue;
        stats.cells++;
        for (let k = from; k < to; k++) {
          const tri = this.cellItems[k];
          const owner = this.owners[tri];
          if (skipOwner >= 0 && owner === skipOwner) continue;
          if (this._disabled[owner]) continue;
          if (skipBodies && this._body[owner]) continue;
          if (this.subs && this.#subSkips(tri, -1)) continue;
          stats.candidates++;
          const j = tri * 9;
          if (Math.min(p[j + 1], p[j + 4], p[j + 7]) > hiY
              || Math.max(p[j + 1], p[j + 4], p[j + 7]) < loY
              || Math.min(p[j], p[j + 3], p[j + 6]) > hiX
              || Math.max(p[j], p[j + 3], p[j + 6]) < loX
              || Math.min(p[j + 2], p[j + 5], p[j + 8]) > hiZ
              || Math.max(p[j + 2], p[j + 5], p[j + 8]) < loZ) continue;
          if (deck && deck[tri] && this.#deckDrops(tri, deckStepTop, deckFloorCos)) continue;
          if (!out) return 1;
          if (kept >= limit) return kept;
          out[kept++] = tri;
        }
      }
    }
    return kept;
  }

  /**
   * Nearest hit among triangles a `collectInBox` already chose, or null.
   *
   * The second half of the engine's broadphase-then-narrowphase split (spec
   * 5.1-5.5): a root collects its candidates once per tick and every one of its
   * vertex probes tests that list, instead of each probe walking the grid
   * again. On Berlin that is one cell walk of 2,100 triangles per tick rather
   * than twenty-six of them.
   *
   * `dx/dy/dz` unit, `maxDist` metres, `out.t` metres. The returned normal
   * faces the ray's start, as `cast`'s does.
   */
  castAmong(list, count, ox, oy, oz, dx, dy, dz, maxDist, out) {
    if (!(count > 0) || !(maxDist > 0)) return null;
    const stats = this.stats;
    stats.queries++;
    let best = maxDist;
    let found = -1;
    for (let k = 0; k < count; k++) {
      const tri = list[k];
      stats.tests++;
      const t = this.#intersect(tri, ox, oy, oz, dx, dy, dz, best);
      if (t >= 0 && t < best) { best = t; found = tri; }
    }
    if (found < 0) return null;
    out.t = best;
    out.x = ox + dx * best;
    out.y = oy + dy * best;
    out.z = oz + dz * best;
    out.dx = dx; out.dy = dy; out.dz = dz;
    out.material = this.materials[found];
    out.owner = this.owners[found];
    out.triangle = found;
    out.kind = 'object';
    this.#normal(found, out);
    return out;
  }

  /** Moller-Trumbore, two-sided: a hull's winding is not something to trust. */
  #intersect(tri, ox, oy, oz, dx, dy, dz, maxDist) {
    const p = this.tris;
    const i = tri * 9;
    const ax = p[i], ay = p[i + 1], az = p[i + 2];
    const e1x = p[i + 3] - ax, e1y = p[i + 4] - ay, e1z = p[i + 5] - az;
    const e2x = p[i + 6] - ax, e2y = p[i + 7] - ay, e2z = p[i + 8] - az;
    const hx = dy * e2z - dz * e2y;
    const hy = dz * e2x - dx * e2z;
    const hz = dx * e2y - dy * e2x;
    const det = e1x * hx + e1y * hy + e1z * hz;
    if (det > -1e-9 && det < 1e-9) return -1;
    const inv = 1 / det;
    const sx = ox - ax, sy = oy - ay, sz = oz - az;
    const u = (sx * hx + sy * hy + sz * hz) * inv;
    if (u < 0 || u > 1) return -1;
    const qx = sy * e1z - sz * e1y;
    const qy = sz * e1x - sx * e1z;
    const qz = sx * e1y - sy * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * inv;
    if (v < 0 || u + v > 1) return -1;
    const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
    return (t > 1e-4 && t <= maxDist) ? t : -1;
  }

  #normal(tri, out) {
    const p = this.tris;
    const i = tri * 9;
    const ax = p[i], ay = p[i + 1], az = p[i + 2];
    const e1x = p[i + 3] - ax, e1y = p[i + 4] - ay, e1z = p[i + 5] - az;
    const e2x = p[i + 6] - ax, e2y = p[i + 7] - ay, e2z = p[i + 8] - az;
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    // Face the incoming round, so an effect stood up on the normal is never
    // buried inside the wall it hit.
    if (nx * out.dx + ny * out.dy + nz * out.dz > 0) { nx = -nx; ny = -ny; nz = -nz; }
    out.nx = nx; out.ny = ny; out.nz = nz;
  }
}

/**
 * Gather every collision triangle under `root` into a queryable index.
 *
 * A collision node is one the assembler tagged `extras.collision` — it arrives
 * as `userData.collision` on the node and the per-material split arrives as
 * `geometry.userData.defenseMaterial` on each primitive, which is the same pair
 * the model browser's armour inspector already reads.
 *
 * `ownerRoots` decides what counts as one object for self-hit purposes: pass
 * the scene's top-level children plus each spawned vehicle, which is exactly
 * what `indexScene` in `map.html` already walks.
 */
export function buildCollisionIndex(root, { ownerRoots = null, cellSize = CELL_SIZE } = {}) {
  const owners = [];
  const ownerOf = new Map();
  if (ownerRoots) {
    for (const node of ownerRoots) {
      const id = owners.length;
      owners.push(node);
      node.traverse(child => ownerOf.set(child, id));
    }
  }
  const meshes = [];
  root.traverse(obj => {
    if (!obj.isMesh || !obj.geometry) return;
    if (!isCollisionMesh(obj)) return;
    meshes.push(obj);
  });
  // The articulated sub-part each collision mesh hangs under, if any
  // (`CollisionIndex.setSubParts`).
  const subParts = [];
  const subOfNode = new Map();
  const subOf = (mesh, owner) => {
    if (owner < 0) return -1;
    const ownerNode = owners[owner];
    for (let n = mesh.parent; n && n !== ownerNode; n = n.parent) {
      if (!isArticulated(n)) continue;
      let id = subOfNode.get(n);
      if (id === undefined) {
        id = subParts.length;
        subOfNode.set(n, id);
        subParts.push({ node: n, owner, ownerBaked: Float64Array.from(ownerNode.matrixWorld.elements),
                        baked: Float64Array.from(n.matrixWorld.elements) });
      }
      return id;
    }
    return -1;
  };
  if (!meshes.length) return null;
  let total = 0;
  for (const mesh of meshes) {
    const index = mesh.geometry.index;
    const position = mesh.geometry.attributes.position;
    total += Math.floor((index ? index.count : position.count) / 3);
  }
  const tris = new Float32Array(total * 9);
  const materials = new Uint16Array(total);
  const ownerIds = new Int32Array(total).fill(-1);
  // Which triangles belong to a drivable surface. One byte a triangle (21 kB on
  // Bocage) and it is what both the exact deck ray and the vehicle hull sweep
  // read; left null when the level ships no drivable static at all, so nothing
  // downstream pays for a level with no bridges.
  const drivableIds = new Uint8Array(total);
  const subIds = new Int32Array(total).fill(-1);
  // The `Obstacle` each mesh hangs under (nearest ancestor up to its owner
  // whose `templateKind` is `Obstacle`: barbed wire), one id per such node.
  const obstacleIds = new Int32Array(total).fill(-1);
  const obstacleNodes = [];
  const obstacleIdOf = new Map();
  const obstacleOfMesh = (mesh, owner) => {
    const stop = owner >= 0 ? owners[owner] : null;
    for (let n = mesh; n; n = n.parent) {
      if (n.userData?.templateKind === 'Obstacle') {
        let id = obstacleIdOf.get(n);
        if (id === undefined) {
          id = obstacleNodes.length;
          obstacleIdOf.set(n, id);
          obstacleNodes.push(n);
        }
        return id;
      }
      if (n === stop) break;
    }
    return -1;
  };
  let anyDrivable = false;
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  let at = 0;
  for (const mesh of meshes) {
    const geometry = mesh.geometry;
    const position = geometry.attributes.position;
    const array = position.array;
    const index = geometry.index ? geometry.index.array : null;
    const m = mesh.matrixWorld.elements;
    const material = geometry.userData?.defenseMaterial ?? 0;
    const owner = ownerOf.get(mesh) ?? -1;
    const sub = subOf(mesh, owner);
    const obstacle = obstacleOfMesh(mesh, owner);
    const drivable = isDrivableCollisionMesh(mesh) ? 1 : 0;
    if (drivable) anyDrivable = true;
    const faces = Math.floor((geometry.index ? geometry.index.count : position.count) / 3);
    for (let f = 0; f < faces; f++) {
      for (let c = 0; c < 3; c++) {
        const vi = index ? index[f * 3 + c] : f * 3 + c;
        const lx = array[vi * 3], ly = array[vi * 3 + 1], lz = array[vi * 3 + 2];
        const x = m[0] * lx + m[4] * ly + m[8] * lz + m[12];
        const y = m[1] * lx + m[5] * ly + m[9] * lz + m[13];
        const z = m[2] * lx + m[6] * ly + m[10] * lz + m[14];
        tris[at * 9 + c * 3] = x;
        tris[at * 9 + c * 3 + 1] = y;
        tris[at * 9 + c * 3 + 2] = z;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }
      materials[at] = material;
      ownerIds[at] = owner;
      drivableIds[at] = drivable;
      subIds[at] = sub;
      obstacleIds[at] = obstacle;
      at++;
    }
  }
  if (!at) return null;
  const index = packIndex(tris, materials, ownerIds, owners, at, cellSize,
                          { minX, minZ, maxX, maxZ },
                          anyDrivable ? drivableIds : null);
  index.setSubParts(subIds.subarray(0, at), subParts);
  index.setObstacles(obstacleIds.subarray(0, at), obstacleNodes);
  index.internalEdges = markInternalEdges(tris, ownerIds, subIds, at);
  return index;
}

/** Two faces meeting at a seam within about 10 degrees count as one surface. */
const SEAM_COS = 0.985;

/**
 * `CollisionIndex.internalEdges`: for each triangle, the edges it shares with
 * a triangle of the same owner and sub-part that lies across the edge from it
 * in near enough the same plane.
 *
 * "Across" is the test that matters, not the winding: the collision meshes do
 * not keep one, so the neighbour's normal is compared by its absolute value,
 * and its third corner must fall on the far side of the shared edge. That is
 * what tells a wall's next panel from a double-sided plate's back face, which
 * shares all three corners and must leave the plate's rim a rim.
 *
 * Corners are matched on a millimetre grid. The level has some 30,000
 * triangles, so a map of their edges costs a few milliseconds at load.
 */
function markInternalEdges(tris, ownerIds, subIds, count) {
  const flags = new Uint8Array(count);
  const vertexIds = new Map();
  const vertexOf = (i) => {
    const key = `${Math.round(tris[i] * 1000)},${Math.round(tris[i + 1] * 1000)},${Math.round(tris[i + 2] * 1000)}`;
    let id = vertexIds.get(key);
    if (id === undefined) { id = vertexIds.size; vertexIds.set(key, id); }
    return id;
  };
  const normal = new Float64Array(count * 3);
  // Edge k of a triangle runs between its corners EDGE[k] and EDGE[k + 1];
  // OPPOSITE[k] is the corner off it. The bit order is the sweep's.
  const EDGE = [0, 1, 0, 2, 1, 2];
  const OPPOSITE = [2, 1, 0];
  const edges = new Map();
  for (let tri = 0; tri < count; tri++) {
    const j = tri * 9;
    const e1x = tris[j + 3] - tris[j], e1y = tris[j + 4] - tris[j + 1], e1z = tris[j + 5] - tris[j + 2];
    const e2x = tris[j + 6] - tris[j], e2y = tris[j + 7] - tris[j + 1], e2z = tris[j + 8] - tris[j + 2];
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-12) continue;                 // degenerate: never a neighbour
    normal[tri * 3] = nx / len; normal[tri * 3 + 1] = ny / len; normal[tri * 3 + 2] = nz / len;
    const v = [vertexOf(j), vertexOf(j + 3), vertexOf(j + 6)];
    for (let k = 0; k < 3; k++) {
      const p = v[EDGE[k * 2]], q = v[EDGE[k * 2 + 1]];
      if (p === q) continue;
      const key = `${ownerIds[tri]}:${subIds[tri]}:${Math.min(p, q)}:${Math.max(p, q)}`;
      const list = edges.get(key);
      if (list) list.push(tri * 3 + k); else edges.set(key, [tri * 3 + k]);
    }
  }
  const corner = (tri, c, axis) => tris[tri * 9 + c * 3 + axis];
  for (const list of edges.values()) {
    if (list.length < 2) continue;
    for (let x = 0; x < list.length; x++) {
      const ta = Math.floor(list[x] / 3), ka = list[x] % 3;
      for (let y = x + 1; y < list.length; y++) {
        const tb = Math.floor(list[y] / 3), kb = list[y] % 3;
        const na = ta * 3, nb = tb * 3;
        const dot = normal[na] * normal[nb] + normal[na + 1] * normal[nb + 1] + normal[na + 2] * normal[nb + 2];
        if (Math.abs(dot) < SEAM_COS) continue;
        // The in-plane perpendicular to the shared edge, and which side of
        // it each triangle's third corner falls.
        const p0 = EDGE[ka * 2], p1 = EDGE[ka * 2 + 1];
        const ex = corner(ta, p1, 0) - corner(ta, p0, 0);
        const ey = corner(ta, p1, 1) - corner(ta, p0, 1);
        const ez = corner(ta, p1, 2) - corner(ta, p0, 2);
        const wx = ey * normal[na + 2] - ez * normal[na + 1];
        const wy = ez * normal[na] - ex * normal[na + 2];
        const wz = ex * normal[na + 1] - ey * normal[na];
        const side = (tri, c) => wx * (corner(tri, c, 0) - corner(ta, p0, 0))
          + wy * (corner(tri, c, 1) - corner(ta, p0, 1)) + wz * (corner(tri, c, 2) - corner(ta, p0, 2));
        if (side(ta, OPPOSITE[ka]) * side(tb, OPPOSITE[kb]) >= 0) continue;
        flags[ta] |= 1 << ka;
        flags[tb] |= 1 << kb;
      }
    }
  }
  return flags;
}

/**
 * A rig node that swings its children on its own: every declared axis a
 * position servo (a ramp, a turret, a gun's elevation). A `rate` axis (an
 * engine, a propeller, a wheel's roll) turns without end and never stands
 * still long enough to be worth a frame of its own.
 */
function isArticulated(node) {
  const axes = node.userData?.rig?.axes;
  if (!axes) return false;
  const list = Object.values(axes);
  return list.length > 0 && list.every(a => a && a.driver !== 'rate');
}

/**
 * Counting-sort the triangles into cells.
 *
 * Two passes and no intermediate arrays-of-arrays: count per cell, prefix-sum
 * into `cellStart`, then write each triangle into its cells. Bocage's 21,661
 * triangles come out at roughly 1.2 cell entries each.
 */
function packIndex(tris, materials, ownerIds, ownerNodes, count, cellSize, box,
                   drivableIds = null) {
  const minX = Math.floor(box.minX / cellSize) * cellSize;
  const minZ = Math.floor(box.minZ / cellSize) * cellSize;
  const cols = Math.max(1, Math.ceil((box.maxX - minX) / cellSize) + 1);
  const rows = Math.max(1, Math.ceil((box.maxZ - minZ) / cellSize) + 1);
  const index = new CollisionIndex(
    tris.subarray(0, count * 9), materials.subarray(0, count),
    ownerIds.subarray(0, count), ownerNodes,
    { minX, minZ, cols, rows, cellSize },
    drivableIds ? drivableIds.subarray(0, count) : null);
  const cells = cols * rows;
  const counts = new Int32Array(cells + 1);
  const spanOf = (tri) => {
    const i = tri * 9;
    const x0 = Math.min(tris[i], tris[i + 3], tris[i + 6]);
    const x1 = Math.max(tris[i], tris[i + 3], tris[i + 6]);
    const z0 = Math.min(tris[i + 2], tris[i + 5], tris[i + 8]);
    const z1 = Math.max(tris[i + 2], tris[i + 5], tris[i + 8]);
    return [
      Math.max(0, Math.floor((x0 - minX) / cellSize)),
      Math.min(cols - 1, Math.floor((x1 - minX) / cellSize)),
      Math.max(0, Math.floor((z0 - minZ) / cellSize)),
      Math.min(rows - 1, Math.floor((z1 - minZ) / cellSize)),
    ];
  };
  for (let tri = 0; tri < count; tri++) {
    const [ix0, ix1, iz0, iz1] = spanOf(tri);
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) counts[iz * cols + ix + 1]++;
    }
  }
  for (let i = 0; i < cells; i++) counts[i + 1] += counts[i];
  const items = new Int32Array(counts[cells]);
  const cursor = counts.slice(0, cells);
  const minY = new Float32Array(cells).fill(Infinity);
  const maxY = new Float32Array(cells).fill(-Infinity);
  for (let tri = 0; tri < count; tri++) {
    const i = tri * 9;
    const y0 = Math.min(tris[i + 1], tris[i + 4], tris[i + 7]);
    const y1 = Math.max(tris[i + 1], tris[i + 4], tris[i + 7]);
    const [ix0, ix1, iz0, iz1] = spanOf(tri);
    for (let iz = iz0; iz <= iz1; iz++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const cell = iz * cols + ix;
        items[cursor[cell]++] = tri;
        if (y0 < minY[cell]) minY[cell] = y0;
        if (y1 > maxY[cell]) maxY[cell] = y1;
      }
    }
  }
  index.cellStart = counts;
  index.cellItems = items;
  index.cellMinY = minY;
  index.cellMaxY = maxY;
  return index;
}
