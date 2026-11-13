// Our collision resolve for a walking body: the capsule sweep against the
// hulls, the slide, the steep-terrain refusal and the ground clamp, with the
// per-tick contact record the jump gate reads. Split out of `walking-body.js`,
// whose `SoldierBody` calls these with itself as `walker` once a tick, after
// its integrator has moved the point body.

import { GRAVITY } from './point-body.js';
import { ENGINE_TICK_RATE } from './soldier-locomotion.js';
import { BODY_RADIUS, CHARACTER_HEIGHT } from './soldier-pose.js';
import {
  JUMP_CONTACT_NORMAL_Y, MATERIAL_WATER, MATERIAL_KILL, STEP_HEIGHT, SNAP_DOWN, MAX_GROUND_SLOPE,
  OBSTACLE_HANDLER_SPEED_SQ, SOLDIER_MASS,
} from './soldier-locomotion.js';

/** Gap kept between a body and whatever it stops against, in metres. */
const SKIN = 0.01;

/**
 * The capsule's radius against hulls: the engine's hull reach less `SKIN`.
 *
 * The engine probes a soldier's 17 hard-coded `SkeletonCollisionMesh`
 * vertices against a static's col1 faces (`checkObjectVsObject` 0x08259690,
 * every vertex, no soldier cap; COL-6) and pushes each out to the plane
 * (COL-9), flattening a non-foot vertex's normal (0x0825a0eb). The rings at
 * the origin and 0.8 over it reach 0.40 m along either body axis
 * (`(+-0.4, 0, +-0.2)`, `(+-0.4, 0.8, 0)`; PARA-6's table), so his origin
 * stops 0.40 m off a wall he walks square into. 0.3 + SKIN stopped the page
 * 0.09 m deeper, and every correction pulled it back (El Alamein, 2026-10-16).
 * The reach rises to 0.447 m at 26.6 degrees off a body axis; a capsule
 * cannot carry that, and walking square into a wall is the case that shows.
 */
export const HULL_REACH = 0.40;
const HULL_RADIUS = HULL_REACH - SKIN;

/** Passes the slide resolver will make before it gives up on a corner. */
const SLIDE_PASSES = 4;

// Scratch for the capsule sweep. `world.sweepSphere` hands back a record it
// owns and reuses, so the nearest of several sphere sweeps has to be copied out
// before the next call overwrites it.
const _contact = {
  t: 0, nx: 0, ny: 1, nz: 0, px: 0, py: 0, pz: 0, material: 0, triangle: -1, owner: -1, depth: 0,
};

/** Scratch for `sweepCapsule`'s walk direction. */
const _walkDir = [0, 0, 0];

/** Scratch for `Heightfield.normal`, which writes into a caller's array. */
const _normal = [0, 1, 0];

/** Scratch for `groundUnder`. */
const _ground = { y: -Infinity, nx: 0, ny: 1, nz: 0, material: -1, sea: NaN, terrain: false };

/**
 * How far a sphere may already be into an edge or a corner and still be
 * stopped by it, in metres (`CollisionIndex.sweepSphere`'s `shell`).
 *
 * The sweep lets go of any edge a sphere overlaps, so that a body caught
 * inside a parked jeep can push its way out. Left at that, a soldier who
 * finished a glancing slide along the side edge of a beached Daihatsu's
 * lowered ramp, his middle sphere tangent to it, was carried a hair into the
 * edge by rounding and had lost it for good: every later sweep started inside
 * it, and he walked on under the ramp with the plate through his waist. The
 * shell keeps an edge solid to a sphere that is only grazing it.
 */
const EDGE_SHELL = 0.02;

/**
 * Nearest contact for a stack of spheres swept together, or null.
 *
 * A capsule sweep done as N sphere sweeps. Exact swept-capsule-vs-triangle is
 * a longer piece of algebra for a body that is 1.8 m of three overlapping
 * 0.3 m spheres; the approximation's only error is the scalloping between
 * them, which is under a centimetre and is on the inside of the volume.
 */
function sweepCapsule(world, x, y, z, dx, dy, dz, dist, radius, offsets,
                      walker = null, skipOwner = -1) {
  if (!world || !world.sweepSphere) return null;
  let best = -1;
  // A grounded body's move is his walk plus the tick of gravity that
  // `settleFeet` puts back. Judged with that drop, a head walking into the
  // underside edge of a beam reads as leaving it (the drop is away from
  // anything facing down) and the edge is skipped, while the walk carries
  // the head on into it and the clamp lifts it back unswept: on Bocage a
  // bot's head sank into a beam end in French_Barn_Lrg_m1 a few millimetres
  // a tick until it was past the shell and stood in it for good (seed 1,
  // 162.6 s). So against what faces down, a grounded body closes or leaves
  // by his walk alone.
  const h = walker?.grounded ? Math.hypot(dx, dz) : 0;
  const walk = h > 1e-9 ? _walkDir : null;
  if (walk) { walk[0] = dx / h; walk[1] = 0; walk[2] = dz / h; }
  for (const offset of offsets) {
    let hit = world.sweepSphere(x, y + offset, z, dx, dy, dz, dist, radius,
                                skipOwner, false, -Infinity, 2, false, EDGE_SHELL, walk);
    if (!hit) continue;
    // Barbed wire (`BFSoldier::handleCollision` 0x0827d3b0's Obstacle
    // branch): above the handler gate the contact is recorded and vetoed,
    // and the sphere goes on to whatever is behind the wire.
    if (walker?._obstaclePass && world.obstacleAt) {
      const obstacle = world.obstacleAt(hit);
      if (obstacle >= 0) {
        noteObstacle(walker, obstacle, hit.px, hit.py, hit.pz);
        hit = world.sweepSphere(x, y + offset, z, dx, dy, dz, dist, radius,
                                skipOwner, false, -Infinity, 2, true, EDGE_SHELL, walk);
        if (!hit) continue;
      }
    }
    // A surface the motion is travelling *away* from cannot stop it. The sweep
    // reports one at `t = 0` for any sphere already resting against geometry,
    // and `#resolve` then advances by `max(0, t - SKIN)` = 0, finds the move is
    // not into the plane so strips nothing, sweeps again from the same point,
    // and burns all four passes without moving the body one millimetre.
    //
    // That is how a soldier who walked off the test platform hung on its lip
    // instead of falling: the instant `grounded` goes false the capsule's
    // lowest sphere drops from `STEP_HEIGHT + r` to `r`, which lands it exactly
    // tangent to the deck he just left, and every tick after that was spent
    // re-finding the same tangent contact. His velocity reached -25 m/s while
    // his position moved 0.2 m in two seconds.
    const closing = walk && hit.ny < 0
      ? walk[0] * hit.nx + walk[2] * hit.nz
      : dx * hit.nx + dy * hit.ny + dz * hit.nz;
    if (closing >= 0) continue;
    if (best >= 0 && hit.t >= best) continue;
    best = hit.t;
    _contact.t = hit.t;
    _contact.nx = hit.nx; _contact.ny = hit.ny; _contact.nz = hit.nz;
    _contact.px = hit.px; _contact.py = hit.py; _contact.pz = hit.pz;
    _contact.material = hit.material;
    _contact.triangle = hit.triangle ?? -1;
    _contact.owner = hit.owner;
    _contact.depth = hit.depth ?? 0;
  }
  return best >= 0 ? _contact : null;
}

/**
 * A vetoed touch of an `Obstacle` this tick, once per wire: what
 * `BFSoldier::handleCollision` bills (the slow flag, the message, the
 * damage), which `walking-body.js` and the world's soldier tick act on.
 */
function noteObstacle(walker, obstacle, x, y, z) {
  const list = walker.obstacleContacts;
  for (const c of list) if (c.id === obstacle) return;
  list.push({ id: obstacle, x, y, z });
}

/**
 * Record a contact, the way `handleCollision` does.
 *
 * Two things come out of it and both are per-tick. The kept normal is the
 * **most upward** of the frame, not the last or the nearest (lnxded
 * `0x0827d4d5`-`0x0827d503`), which is what makes a jump in the corner of a
 * room use the floor rather than the wall. And the jump-arming bit is set by
 * any contact whose `normal.y` exceeds `JUMP_CONTACT_NORMAL_Y` on a material
 * that is not Water — so treading water never arms a jump, and a 70-degree
 * face does, even though nothing that steep counts as `grounded` here.
 */
function recordContact(walker, nx, ny, nz, material, terrain = false) {
  if (!Number.isFinite(ny)) return;
  if (ny > walker._bestNormalY) {
    walker._bestNormalY = ny;
    walker.contactNormal.x = nx;
    walker.contactNormal.y = ny;
    walker.contactNormal.z = nz;
    walker.contactMaterial = material;
    // `handleCollision` stores the normal at `+0x3d0` and, beside it, whether
    // the contact was the terrain (`sete 0x3dc`, the other object null,
    // `0x0827d528`): the lying tilt reads both (PHY-38).
    walker.contactTerrain = terrain;
  }
  if (ny > JUMP_CONTACT_NORMAL_Y && material !== MATERIAL_WATER) {
    walker._armed = true;
  }
}

/**
 * Whether the engine would have found `hit`'s face at all: its one-sided test
 * (ledger COL-23) counts a face only from in front of its stored normal,
 * `(v2 - v0) x (v1 - v0)` in glTF space, and this resolve is two-sided with
 * the normal turned toward the probe (`body-statics.js` divergence 1). A kill
 * face is billed only from its front (`MATERIAL_KILL`). A hit with no static
 * triangle behind it is judged by its normal: vanilla's kill faces are floors.
 */
function metFromFront(world, hit) {
  const tris = world?.statics?.tris;
  const t = hit.triangle;
  if (!tris || !(t >= 0)) return hit.ny > 0;
  const j = t * 9;
  const ax = tris[j + 6] - tris[j], ay = tris[j + 7] - tris[j + 1], az = tris[j + 8] - tris[j + 2];
  const bx = tris[j + 3] - tris[j], by = tris[j + 4] - tris[j + 1], bz = tris[j + 5] - tris[j + 2];
  const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
  return nx * hit.nx + ny * hit.ny + nz * hit.nz > 0;
}

/** The spheres making up the capsule, lowest lifted by a step when grounded. */
function capsule(walker) {
  const height = walker.height;
  const r = HULL_RADIUS;
  const floor = (walker.grounded ? STEP_HEIGHT : 0) + r;
  const top = Math.max(floor, height - r);
  const offsets = walker._offsets;
  offsets.length = 0;
  offsets.push(floor);
  const mid = (floor + top) / 2;
  if (mid - floor > 0.05) offsets.push(mid);
  if (top - floor > 0.05) offsets.push(top);
  return offsets;
}

/**
 * Move along the integrator's delta, stopping at hulls and sliding along them.
 *
 * Standard iterate-and-project: sweep, advance to just short of the contact,
 * strip the component of both the remaining motion and the velocity that goes
 * into the surface, repeat. Four passes handles a corner (two walls) and a
 * corner with a floor; anything needing a fifth is a crack and stopping there
 * is the right answer.
 */
export function resolveMove(walker) {
  const world = walker.world;
  const body = walker.body;
  walker.contacts = 0;
  walker.obstacleContacts.length = 0;
  walker.killFace = false;
  // Every handler, the wire's veto included, runs only above this contact
  // speed (collision-response.md §6.2); a body slower than it meets the wire
  // as any static. A static's contact speed is the body's own velocity.
  const v0 = body.velocity;
  walker._obstaclePass = v0.x * v0.x + v0.y * v0.y + v0.z * v0.z
    > OBSTACLE_HANDLER_SPEED_SQ;
  if (!world || !world.sweepSphere) return;
  const from = body.previous;
  let px = from.x, py = from.y, pz = from.z;
  let rx = body.delta.x, ry = body.delta.y, rz = body.delta.z;
  const offsets = capsule(walker);
  for (let pass = 0; pass < SLIDE_PASSES; pass++) {
    const dist = Math.hypot(rx, ry, rz);
    if (dist < 1e-6) break;
    const dx = rx / dist, dy = ry / dist, dz = rz / dist;
    const hit = sweepCapsule(world, px, py, pz, dx, dy, dz, dist,
                             HULL_RADIUS, offsets, walker, walker.ignoreOwner ?? -1);
    if (!hit) {
      px += rx; py += ry; pz += rz;
      rx = 0; ry = 0; rz = 0;
      break;
    }
    walker.contacts++;
    recordContact(walker, hit.nx, hit.ny, hit.nz, hit.material);
    if (hit.material === MATERIAL_KILL && metFromFront(world, hit)) walker.killFace = true;
    const advance = Math.max(0, hit.t - SKIN);
    px += dx * advance; py += dy * advance; pz += dz * advance;
    // A floor-ish contact is ground, which is how you stand on a bunker roof
    // rather than only on the heightfield.
    const floorish = hit.ny >= MAX_GROUND_SLOPE;
    if (floorish) walker.grounded = true;
    // Walking into a wall must not lift the body. A wall's normal has a small
    // upward component wherever the hull is not perfectly vertical, and
    // projecting 6 m/s of forward motion onto it converts a slice of that
    // into climb — which over a few seconds walks a body up the side of a
    // building. While grounded, a wall contact is flattened first so it can
    // only ever redirect sideways.
    let nx = hit.nx, ny = hit.ny, nz = hit.nz;
    if (walker.grounded && !floorish) {
      const flat = Math.hypot(nx, nz);
      if (flat > 1e-6) { nx /= flat; ny = 0; nz /= flat; }
    }
    // A contact met already inside it, no deeper than the shell (a graze,
    // `t = 0`), is pushed back out by its depth along the normal, flattened
    // as the wall's own strip is: the engine's response moves the body out
    // by the penetration at once (`impulseOn` 0x08258900, `solveImpulse`
    // 0x08258d30, COL-9). Left in, a graze only grows (a slide along an
    // edge's round falls into it, the clamp lifts a head into it) until it
    // is past the shell and the sweep lets the edge go for good.
    if (hit.t === 0 && hit.depth > 0 && hit.depth <= EDGE_SHELL) {
      const out = hit.depth + SKIN;
      px += nx * out; py += ny * out; pz += nz * out;
    }
    // What is left of the move, projected onto the contact plane. A flattened
    // plane is parallel to the vertical part of the move, which can still be
    // closing on the contact itself: the tick of gravity, or the ground
    // falling away under a slide along a plate's edge. Left alone it either
    // carried the sphere into the edge by a hair, after which the sweep let
    // go of it (a soldier ended up under a beached Daihatsu's ramp that way),
    // or burnt every pass re-finding the edge at `t = 0` and froze the body.
    // So the move is stripped against the contact too; after the flat strip
    // that can only shrink the vertical part, by ny^2 of it, never turn it
    // into a climb.
    const left = dist - advance;
    rx = dx * left; ry = dy * left; rz = dz * left;
    const v = body.velocity;
    for (let k = ny === hit.ny ? 1 : 0; k < 2; k++) {
      const mx = k ? hit.nx : nx, my = k ? hit.ny : ny, mz = k ? hit.nz : nz;
      const into = rx * mx + ry * my + rz * mz;
      if (into < 0) { rx -= mx * into; ry -= my * into; rz -= mz * into; }
      const vInto = v.x * mx + v.y * my + v.z * mz;
      if (vInto < 0) { v.x -= mx * vInto; v.y -= my * vInto; v.z -= mz * vInto; }
    }
  }
  body.position.x = px;
  body.position.y = py;
  body.position.z = pz;
}

/**
 * Refuse a horizontal move onto ground too steep to have walked up.
 *
 * `#resolve` cannot see this and is not meant to: the heightfield is never in
 * the sweep (see `WorldCollider.sweepSphere`), because a body standing on a
 * function of (x, z) is one lookup and a clamp rather than half a million
 * triangles. But that clamp is unconditional, so without this a body walks
 * into a cliff face and the clamp ratchets it up the outside — six metres a
 * second of forward input turning into six metres a second of climb.
 *
 * So the *same* `MAX_GROUND_SLOPE` the hull contacts are judged by is applied
 * to the terrain here, once, after the sweep and before the clamp: if the
 * move would put the feet on ground steeper than that and *higher* than where
 * they are, the uphill component of it is stripped and the across-the-face
 * component is kept, which is the wall behaviour in `#resolve` written for a
 * surface that is not in the sweep. Walking downhill, or off the world, is
 * never refused — you are allowed to fall off anything.
 *
 * Note this deliberately does not fire while airborne. Landing on a cliff is
 * landing; what happens next is a walk attempt, and that is judged here.
 */
export function refuseSteepGround(walker) {
  const world = walker.world;
  if (!walker.grounded || !world || !world.surfaceHeight) return;
  const field = world.heightfield;
  if (!field || !field.normal) return;
  const p = walker.body.position;
  const q = walker.body.previous;
  let dx = p.x - q.x, dz = p.z - q.z;
  if (Math.abs(dx) < 1e-9 && Math.abs(dz) < 1e-9) return;
  if (!tooSteep(walker, p.x, p.z, p.y)) return;
  walker.contacts++;
  // The heightfield normal's horizontal part points downhill, so a move with
  // a negative dot against it is a move up the face.
  const nx = _normal[0], nz = _normal[2];
  const flat = Math.hypot(nx, nz);
  const v = walker.body.velocity;
  if (flat > 1e-6) {
    const ux = nx / flat, uz = nz / flat;
    const into = dx * ux + dz * uz;
    if (into < 0) { dx -= ux * into; dz -= uz * into; }
    const vInto = v.x * ux + v.z * uz;
    if (vInto < 0) { v.x -= ux * vInto; v.z -= uz * vInto; }
    p.x = q.x + dx;
    p.z = q.z + dz;
    // One pass, then give up: sliding across a face can land on another face
    // just as steep (the inside of a gully), and creeping up that one is the
    // bug this exists to stop.
    if (!tooSteep(walker, p.x, p.z, p.y)) return;
  }
  p.x = q.x;
  p.z = q.z;
  v.x = 0;
  v.z = 0;
}

/** Is the ground at (x, z) both above `y` and steeper than a body may climb? */
function tooSteep(walker, x, z, y) {
  const ground = walker.world.surfaceHeight(x, z);
  // Level or downhill is always allowed, and so is a step small enough that
  // it is the lattice's own bilinear wobble rather than a face.
  if (!Number.isFinite(ground) || ground <= y + SKIN) return false;
  walker.world.heightfield.normal(x, z, _normal);
  return Number.isFinite(_normal[1]) && _normal[1] < MAX_GROUND_SLOPE;
}

/** Scratch for `Heightfield.engineSurface`. */
const _surface = { y: NaN, nx: 0, ny: 1, nz: 0 };

/**
 * What the feet stand on at (x, z), from height y: the terrain (the sea bed
 * under the sea) or a hull floor. Into `g`: `y` (-Infinity for nothing), its
 * normal and material, `terrain` (whether it is the terrain, which
 * `settleFeet` meets by the engine's law), and `sea`, the water level where
 * the sea is over the terrain (NaN elsewhere).
 *
 * **The terrain is the engine's surface** where the heightfield offers it
 * (`Heightfield.engineSurface`, TERR-16: `PatchTerrain`'s checkerboard
 * triangles and their face normals), not the bilinear `height` the rest of
 * the page reads; a world without it (a harness's flat function) falls back
 * on `surfaceHeight` and the central-difference normal.
 *
 * **A man does not stand on the sea.** The water makes no contact for him
 * (PHY-16); `updateSwimming` is the only thing that ever puts a soldier's y
 * on the water, and it puts it 0.4 m *under*. Standing in shallow water is
 * standing on the seabed, with the seabed's own normal and material; deep
 * water leaves nothing within reach and the body falls, which is what hands
 * it to `#updateSwim`.
 *
 * Hulls get a downward **ray**, not a sweep, and that distinction was paid
 * for: a sweep returns the nearest contact of *any* orientation, so standing
 * under Wake's farm awning the nearest thing below the body was one of the
 * roof posts beside it, the floor underfoot was never reported, the body went
 * un-grounded, the capsule dropped its lowest sphere back into the floor it
 * had been standing on, and it wedged there for good. A vertical ray can only
 * meet what is actually underneath. The ray's own terrain and water answers
 * are not floors here: the terrain is the engine sampler's above.
 */
function groundUnder(walker, x, y, z, g) {
  const world = walker.world;
  let ground = -Infinity;
  let groundNx = 0, groundNy = 1, groundNz = 0, groundMaterial = -1;
  let terrain = false;
  let owner = -1;
  g.sea = NaN;
  const field = world?.heightfield;
  const level = world?.waterLevel;
  if (field && field.engineSurface) {
    field.engineSurface(x, z, _surface);
    if (Number.isFinite(_surface.y)) {
      ground = _surface.y;
      groundNx = _surface.nx; groundNy = _surface.ny; groundNz = _surface.nz;
      groundMaterial = field.material ? field.material(x, z) : -1;
      terrain = true;
      if (Number.isFinite(level) && !(ground > level)) {
        g.sea = level;
        // The bed exactly at the water line: keep water's material so a jump
        // is still refused there.
        if (!(ground < level)) groundMaterial = MATERIAL_WATER;
      }
    } else if (Number.isFinite(level)) {
      g.sea = level;   // a hole in the lattice under the sea
    }
  } else if (world && world.surfaceHeight) {
    // A world with no engine sampler: `surfaceHeight` answers
    // `max(heightfield, waterLevel)`, so where the sea is the higher surface
    // the heightfield is asked what is actually underfoot.
    const h = world.surfaceHeight(x, z);
    const isSea = Number.isFinite(h) && level != null
      && Math.abs(h - level) <= 1e-6;
    g.sea = isSea ? level : NaN;
    const bed = isSea && field && field.height ? field.height(x, z) : NaN;
    const solid = isSea ? bed : h;
    if (Number.isFinite(solid)) {
      ground = solid;
      terrain = true;
      if (isSea && !(bed < level)) {
        groundMaterial = MATERIAL_WATER;
      } else {
        if (field && field.normal) {
          field.normal(x, z, _normal);
          if (Number.isFinite(_normal[1])) {
            groundNx = _normal[0]; groundNy = _normal[1]; groundNz = _normal[2];
          }
        }
        if (field && field.material) groundMaterial = field.material(x, z);
      }
    }
  }
  if (world && world.cast) {
    // From a step up, straight down, far enough to catch both the lift onto a
    // kerb and the glue onto a descending ramp.
    //
    // The ray goes on through what is not a floor here and stops at the
    // first thing that is. The sea is nothing underfoot, but a static's face
    // under it is (trois_ponts' trench tunnel floor, 0.3 m under the river's
    // plane). The collider's terrain is its bilinear lattice, not the engine
    // sampler that answers the terrain above, and the two part by most of a
    // metre on a steep cell (transcarpathia's riverbank trench, its floor
    // 0.15 m under the lattice and 0.6 m over the engine's ground). Stopped
    // on either, the ray never saw the floor, the capsule's sweep held the
    // feet on it unseen, and the soldier stood there ungrounded for good.
    // The engine's soldier meets a static's faces wherever they are (COL-6,
    // COL-9), under the water plane or not.
    // Barbed wire is no floor to a body moving through it (the same veto as
    // the sweep's): the touch is recorded and the ray goes on below it.
    const skipOwner = walker.ignoreOwner ?? -1;
    // Nothing under the ground already found can win, so the ray goes no
    // lower: on open ground, where the lattice and the sampler agree, it
    // stops at the terrain and costs the one cast it always did.
    const bottom = Math.max(y - SNAP_DOWN, ground + 0.01);
    let hit = world.cast(x, y + STEP_HEIGHT, z, 0, -1, 0,
                         STEP_HEIGHT + SNAP_DOWN, skipOwner);
    for (let pass = 0; hit && pass < 4; pass++) {
      if (hit.kind === 'water' || hit.kind === 'terrain') {
        // passed through
      } else if (walker._obstaclePass && world.obstacleAt && world.obstacleAt(hit) >= 0) {
        noteObstacle(walker, world.obstacleAt(hit), hit.x, hit.y, hit.z);
      } else {
        break;
      }
      const from = hit.y - 1e-3;
      hit = from > bottom ? world.cast(x, from, z, 0, -1, 0, from - bottom, skipOwner) : null;
    }
    if (hit && walker._obstaclePass && world.obstacleAt && world.obstacleAt(hit) >= 0) hit = null;
    if (hit && (hit.kind === 'water' || hit.kind === 'terrain')) {
      // the sea is nothing underfoot, and the terrain is answered above
    } else if (hit && hit.ny >= MAX_GROUND_SLOPE && hit.y > ground) {
      ground = hit.y;
      groundNx = hit.nx; groundNy = hit.ny; groundNz = hit.nz;
      groundMaterial = hit.material;
      terrain = false;
      owner = hit.owner ?? -1;
    }
  }
  g.y = ground;
  g.nx = groundNx; g.ny = groundNy; g.nz = groundNz;
  g.material = groundMaterial;
  g.terrain = terrain;
  // The hull the floor belongs to, for its point speed (`deck-carry.js`).
  g.owner = terrain ? -1 : owner;
  return g;
}

/** The least a contact must face down to be a ceiling to a rise. */
const CEILING_NY = 0.25;

/**
 * Is there no headroom for the lift `settleFeet` is about to make?
 *
 * The clamp onto the ground is a vertical move the sweep in `resolveMove`
 * never saw, and a lift carries the head up into whatever is over it: the
 * beach rising under a soldier's run put his head into the underside of a
 * beached Daihatsu's bow and lowered ramp, a few centimetres a tick, until
 * the sweep counted him inside the plate, let go of it, and walked him on
 * underneath. So a lift is swept with the top sphere, and only up and only
 * that sphere: the sides and the feet of a capsule rising are moving along
 * or away from whatever they touch.
 */
function noHeadroom(walker, ground) {
  const world = walker.world;
  const p = walker.body.position;
  const q = walker.body.previous;
  if (!world || !world.sweepSphere || !(ground > p.y + 1e-4)) return false;
  if (!(p.y <= ground + SKIN)) return false;
  // Ground no higher than the feet stood last tick is not a rise, only the
  // tick's millimetre of gravity being put back, which every grounded tick
  // on the flat makes.
  if (!(ground > q.y + 1e-4)) return false;
  if (Math.abs(p.x - q.x) < 1e-6 && Math.abs(p.z - q.z) < 1e-6) return false;
  const offsets = walker._offsets;
  if (!offsets.length) return false;
  const hit = world.sweepSphere(p.x, p.y + offsets[offsets.length - 1], p.z,
                                // The capsule's own top sphere, radius and all: its
                                // centre sits HULL_RADIUS under the head.
                                0, 1, 0, ground - p.y, HULL_RADIUS,
                                walker.ignoreOwner ?? -1, false, -Infinity, 2,
                                false, EDGE_SHELL);
  if (!hit || hit.ny >= -CEILING_NY) return false;
  // As deep as the lift would put the head into it: a scrape inside the shell
  // is allowed, as it is sideways. A head already further in than that was
  // put there by something else (a spawn, a vehicle), and refusing the step
  // would only hold it there.
  const depth = hit.depth ?? 0;
  return depth <= EDGE_SHELL && depth + (ground - p.y) - hit.t > EDGE_SHELL;
}

/**
 * Put the feet on whatever is under them (`groundUnder`): the heightfield, the
 * sea bed, or a hull.
 */
export function settleFeet(walker) {
  const world = walker.world;
  const p = walker.body.position;
  const q = walker.body.previous;
  const v = walker.body.velocity;
  const g = groundUnder(walker, p.x, p.y, p.z, _ground);
  // Rising into a ceiling: the step that asked for it is refused, as
  // `refuseSteepGround` refuses one up a cliff.
  if (noHeadroom(walker, g.y)) {
    p.x = q.x;
    p.z = q.z;
    v.x = 0;
    v.z = 0;
    walker.contacts++;
    groundUnder(walker, p.x, p.y, p.z, g);
  }
  // The surface is not a floor, but it **is** a collision: HP-14's water
  // landing damage comes from `GameServer::handleCollisionLandOrWater`'s
  // `param_7 == 1` arm (`0x08154960`, and material 1 is hardcoded into all
  // three of its lookups), so a man who falls in is billed for it -- about
  // 67x more gently than the same drop onto land, because water's
  // `damageMod` is 1.5e-05 against dirt's 0.001. Registered here as a
  // one-tick contact on the crossing, with no clamp and no `grounded`.
  if (p.y <= g.sea + SKIN && q.y > g.sea + SKIN) {
    walker._waterEntry = true;
    // The drop is billed to the surface, not to wherever inside the tick's
    // step the body ended up, so that the same 10 m fall is the same `F`
    // whether it ends on dirt or in the sea and the only thing that differs
    // is the material's own `damageMod`.
    walker._waterEntryY = g.sea;
    walker.contacts++;
    recordContact(walker, 0, 1, 0, MATERIAL_WATER);
  }
  const ground = g.y;
  const groundNx = g.nx, groundNy = g.ny, groundNz = g.nz;
  const groundMaterial = g.material;
  if (Number.isFinite(ground) && g.terrain) {
    // **The terrain, by the engine's law.** `ResponsePhysics::checkVsTerrain`
    // (`0x0825a960`) tests the soldier's lowest collision vertex, his feet,
    // against the terrain's height there: `depth = y - h`, and a vertex at or
    // under the ground is a contact. `impulseOn` (`0x08258900`) pushes it out
    // ALONG THE FACE NORMAL by the depth (`posAdjust`), which `solveImpulse`
    // (`0x08258d30`) applies at once; the speed is not touched here -- the
    // normal's share of it, `-(v . n) n`, goes to the next tick's
    // accumulator (`walking-body.js` `#contactLaw`). No glue: ground falling
    // away faster than gravity takes him leaves him in the air for a tick, as
    // the server's does. One vertex where the engine walks five (PHY-34);
    // on terrain the feet are the one that touches.
    //
    // The feet vertex is (0, -1, 0) in his OWN frame: `checkVsTerrain` takes
    // each vertex through the object's rotation (`0x0825ab0e`..: row 1 times
    // the vertex y) before it adds the origin. Lying, his up row leans onto
    // the ground's normal (`walker.up`, `walking-body.js` `#updateTilt`,
    // PHY-38), so the vertex is `origin - up`: up the slope from under his
    // origin, which is then pushed out to stand `1 / cos(slope)` over the
    // ground under it rather than 1.0 m. `position` stays `origin - (0, 1, 0)`.
    let depth = p.y - ground;
    let nx = groundNx, ny = groundNy, nz = groundNz, mat = groundMaterial;
    const up = walker.up;
    if (up && up.y < 1 && world?.heightfield?.engineSurface) {
      world.heightfield.engineSurface(p.x - up.x, p.z - up.z, _surface);
      if (Number.isFinite(_surface.y)) {
        depth = p.y + 1 - up.y - _surface.y;
        nx = _surface.nx; ny = _surface.ny; nz = _surface.nz;
        if (world.heightfield.material) mat = world.heightfield.material(p.x - up.x, p.z - up.z);
      }
    }
    if (depth <= 0) {
      p.x -= depth * nx;
      p.y -= depth * ny;
      p.z -= depth * nz;
      walker._terrainDepth = depth;
      walker._terrainNormal.x = nx;
      walker._terrainNormal.y = ny;
      walker._terrainNormal.z = nz;
      walker.contacts++;
      walker.grounded = true;
      recordContact(walker, nx, ny, nz, mat, true);
    } else {
      walker.grounded = false;
    }
  } else if (Number.isFinite(ground)) {
    // A hull floor (`groundUnder`'s ray): **ours**, the page's stand-in for
    // the skeleton's vertices against a static's col1 faces (COL-6, COL-9).
    if (p.y <= ground + SKIN) {
      p.y = ground;
      if (v.y < 0) v.y = 0;
      walker.grounded = true;
      recordContact(walker, groundNx, groundNy, groundNz, groundMaterial);
      walker.floorOwner = g.owner;
    } else if (walker.grounded && v.y <= 0 && p.y - ground <= SNAP_DOWN) {
      // Glued to a deck falling away underneath, so walking down a ramp is
      // walking rather than a sequence of small falls. Still a contact: a
      // soldier jogging down a ramp may jump off it.
      p.y = ground;
      v.y = 0;
      recordContact(walker, groundNx, groundNy, groundNz, groundMaterial);
      walker.floorOwner = g.owner;
    } else {
      walker.grounded = false;
    }
  } else {
    walker.grounded = false;
  }
  // Held up by something the ground probe did not find — a hull face too
  // steep to stand on, or a body that has ended up inside geometry. It is
  // supported either way, and saying so matters twice over: without it the
  // downward velocity grows without bound behind the obstruction and fires
  // the body through the floor the instant it comes free, and the capsule
  // never lifts back to its step height, so a body that wedges stays wedged.
  // Only a real fall counts as wedged: at a jump's apex v.y is barely
  // negative and one tick moves the body less than the epsilon, and this
  // guard used to call that "supported" — one grounded tick a metre off
  // the floor, which re-armed a held jump into a mid-air double jump. A
  // genuinely blocked body gains two ticks of gravity within two ticks;
  // demanding that much fall costs it nothing. The body's tick is the
  // engine's 1/30 s (LOOP-1, PHY-34).
  const wedgeMinFall = 2 * Math.abs(GRAVITY) / ENGINE_TICK_RATE;
  if (!walker.grounded && v.y < -wedgeMinFall
      && p.y >= q.y - 1e-4) {
    v.y = 0;
    walker.grounded = true;
  }
  if (world && world.heightfield && walker.grounded) {
    walker.material = world.heightfield.material(p.x, p.z);
  }
}

// --- a moving hull against them ------------------------------------------
//
// The engine's narrow phase for a soldier on foot and a moving hull, which
// pushes the soldier out of the hull (and so along in front of
// it) and hands the contact to the run-over damage.
//
// What retail does (lnxded; features/bf1942-engine-reference, COL-2, COL-3,
// COL-6, COL-9, and the soldier rows below):
//
//   * The soldier is always the VERTEX side of a soldier-hull pair, weight 1.0
//     (collision-response.md 5.3, `ResponsePhysicsManager::checkObjectVsObjects`
//     0x0825d820), whichever of the two the manager was visiting, and the
//     hull's faces are col1 (`checkObjectVsObject` 0x08259690 asks LOD 1 for a
//     `CID_BFSoldierTemplate` vertex side).
//   * Their vertices are the 17 `SkeletonCollisionMeshTemplate`'s constructor
//     hard-codes (0x083af375-0x083af62a; -0.2, -0.4 and 0.4 are the floats at
//     0x086e972c, 0x086e9730 and 0x086c4f70), in their origin's frame, the
//     origin a metre over their feet in every pose (PHY-10, PHY-38):
//     the foot (0, -1, 0), a ring of four at -0.6, a ring of eight at 0 and
//     four at 0.8.
//   * Each is a ray from their origin as it stood one tick ago in the hull's
//     moving frame, `S = origin - (vSoldier - vHull) dt`, to the vertex where
//     it is now, against the hull's faces one-sided (a face counts only when
//     S is in front of it and the vertex on or behind it, COL-23). From
//     inside a hull every face is a back face, so a soldier already in one is
//     never held there.
//   * The share is by the roots' masses, `s = mHull / (mSoldier + mHull)`,
//     snapped to 1 over 0.95 (COL-2, `0x0825a3be`): every vanilla hull
//     outweighs a soldier twenty times over, so they take the whole push and
//     the hull feels nothing.
//   * For any vertex but the foot (vertex 0), the push is NOT the face normal:
//     `0x0825a0eb`-`0x0825a1e5` replaces it with the direction from the hit
//     back to S, flattened to the horizontal when the hit is within 0.65 m
//     (0x086cfc28) of their origin's height, the depth staying the end point's
//     plane distance; past 0.65 m the direction keeps its height and the depth
//     is the distance from the hit to the vertex along the ray. So a hull's
//     side or nose shoves them sideways along the ground, never down into it or
//     up its armour; the foot alone keeps the face's own normal, which is how
//     they stand on a deck.
//   * `impulseOn` 0x08258900 merges the pushes per axis (`setAdjust`), cancels
//     the relative speed along each, and `solveImpulse` 0x08258d30 moves them
//     out at once and posts `speedAdjust x 30 x (1 + e)/2` (e = 0) for the
//     next tick (COL-9): they are pushed clear and given half the hull's closing
//     speed, tick after tick, and carried in front of it.
//   * Before the response, a contact whose relative speed squared exceeds 0.1
//     calls both `handleCollision`s (collision-response.md 6.2); the soldier's
//     (`BFSoldier::handleCollision` 0x0827d3b0 over `SimpleObject::
//     handleCollision` 0x081dab40) bills the soldier-victim branch of
//     `handleCollisionObjectVsObject` 0x081551c0 once a second per hull
//     (COL-3, COL-5): nothing under 8 m/s (0x08155a10), and `crash-damage.js`
//     `soldierCollisionDamage` above it. The face normal, not the replaced
//     one, is what the handler is handed.
//
// So in retail a hull never ends up over a soldier: under 8 m/s it pushes them
// ahead and aside, and above it the same push comes with the run-over damage.
//
// What the page did instead: the soldier swept only their own motion against
// each hull's standing pose (`soldier-resolve.js` `resolveMove`), and the
// sweep lets go of a face a sphere already overlaps. A hull driven into them
// came on through, and once its faces were round them the two-sided sweep held
// them inside (the owner's report, 2026-11-12; tests/test_hull_runover.py).
//
//   * `relV` and so `S` take the ROOT nodes' linear speeds only
//     (`getPositionalSpeed`, 0x08259a02..0x08259b68): a hull's spin is not in
//     `S`. The speed each hit is judged and adjusted by is the tangent speed
//     at the hit, `nodeAr.getTangentSpeed(pos) - nodeBr.getTangentSpeed(pos)`
//     (`PhysicsNode::getTangentSpeed` 0x08254b90: the root's velocity plus its
//     spin crossed with the hit's offset; `fsubrs` at 0x08259dc4): a tank
//     turning on the spot sweeps a soldier at its stern with the stern's
//     speed, and the handler's 0.1 gate and the run-over's speed are that.
//   * Below the snap (`s <= 0.95`, a hull lighter than 19 soldiers, 1900 kg)
//     the soldier takes `s` of the depth and of `vRel` and the hull
//     `-(1 - s)` of both through its own `impulseOn` / `solveImpulse` at the
//     hit; below 0.05 the soldier takes nothing and the hull +1.0, the
//     engine's slip (COL-2). Every vanilla hull here snaps (a Willys is
//     2500).
//
// Ours, and said so: the hull's motion is its published pose's change since
// this soldier last looked (`WorldCollider.setMovedOwner`): the root's
// position for the linear speed, the whole frame for a hit's point speed; the
// hull's share of a light hull's push is handed to its body by the world's
// soldier tick (`walker.hullReactions`, `world-soldier-tick.js`); and the
// speed adjust lands on this tick's velocity instead of next tick's
// accumulator.

/** `SkeletonCollisionMeshTemplate`'s 17 vertices, origin frame (see header). */
export const SOLDIER_HULL_VERTICES = Object.freeze([
  [0, -1, 0],
  [-0.2, -0.6, -0.2], [-0.2, -0.6, 0.2], [0.2, -0.6, 0.2], [0.2, -0.6, -0.2],
  [-0.2, 0, -0.4], [-0.4, 0, -0.2], [-0.4, 0, 0.2], [-0.2, 0, 0.4],
  [0.2, 0, 0.4], [0.4, 0, 0.2], [0.4, 0, -0.2], [0.2, 0, -0.4],
  [0, 0.8, -0.4], [0, 0.8, 0.4], [0.4, 0.8, 0], [-0.4, 0.8, 0],
].map(v => Object.freeze(v)));

/**
 * `ResponsePhysics::setAdjust` 0x0825cec0, one axis (`body-contact.js`
 * `setAdjust`, repeated here so this module keeps the imports the tests that
 * copy it already list): empty takes the candidate, opposite signs add, the
 * same sign keeps the larger.
 */
function setAdjust(current, candidate) {
  if (current === 0) return candidate;
  if (current > 0) return candidate > 0 ? Math.max(current, candidate) : current + candidate;
  return candidate < 0 ? Math.min(current, candidate) : current + candidate;
}

/** Every vertex's material, `0x29` (the constructor's loop after the table). */
export const SOLDIER_VERTEX_MATERIAL = 41;

/** Within this height of their origin a hit's push is flattened (0x086cfc28). */
export const FLAT_PUSH_BAND = 0.65;

/** `|relV|^2` over which the handlers run (collision-response.md 6.2). */
const HANDLER_SPEED_SQ = 0.1;

/** `solveImpulse`'s `(1 + e) / 2` with every hull and soldier material's e = 0
 *  (COL-9): the share of the speed adjust one tick of the posted
 *  acceleration (`x 30`, one 1/30 s tick) puts on them. */
const SPEED_ADJUST_SHARE = 0.5;

/** A published move longer than this between two looks is a teleport (a
 *  respawned or replaced hull), not motion. */
const TELEPORT = 8;

/** A pose not republished for more than this many world ticks is a hull at
 *  rest, not one between two frames' publishes (`trackHulls`). */
const MAX_PUBLISH_GAP = 4;

/** COL-2's snaps on `s = mHull / (mSoldier + mHull)`: 0.95 (0x086d16cc) and
 *  0.05 (0x086c08a8). */
const SHARE_SNAP_HIGH = Math.fround(0.95);
const SHARE_SNAP_LOW = Math.fround(0.05);

/**
 * COL-2's shares for a soldier (the vertex side, A) against a hull of root
 * mass `mass` (B), into `out` `{ a, b }`: `s = mB / (mA + mB)`; over 0.95
 * (1, 0); under 0.05 (0, +1.0), the engine's sign slip
 * (`fldz; fxch; fstps` at 0x0825a3d5); otherwise (s, -(1 - s)) (`xorb $0x80`
 * 0x08259980). A hull whose mass the collider was not told is taken as
 * heavy (1, 0). The soldier's weight is 1.0 (COL-6), so these are the shares.
 */
export function hullShares(mass, out = { a: 1, b: 0 }) {
  if (!(mass > 0)) { out.a = 1; out.b = 0; return out; }
  // `s` is stored as a float (`fsts` 0x0825996c) and reloaded for the
  // compare, so 1900 kg (0.95 to the float) does not snap; `1 - s` is taken
  // from the unrounded quotient (`fsubr` 0x08259972) and stored.
  const q = mass / (SOLDIER_MASS + mass);
  const s = Math.fround(q);
  if (s > SHARE_SNAP_HIGH) { out.a = 1; out.b = 0; }
  else if (s < SHARE_SNAP_LOW) { out.a = 0; out.b = 1; }
  else { out.a = s; out.b = -Math.fround(1 - q); }
  return out;
}
const _shares = { a: 1, b: 0 };

/**
 * The speed of the hull's point now at world (x, y, z) over the soldier's
 * last tick, into `out`: where that point of the hull's frame stood at the
 * last look (`track.f`) against where it is (`m.inv`), so the hull's spin is
 * in it (`getTangentSpeed`). The root's linear speed when the frame was not
 * seen last tick or jumped.
 */
function hullPointSpeed(m, track, x, y, z, dt, out) {
  out.x = track.vx; out.y = track.vy; out.z = track.vz;
  if (!track.framed || !(dt > 0)) return out;
  // Over the ticks the published pose took (`trackHulls`).
  const span = track.span > 0 ? track.span : dt;
  const e = m.inv, f = track.f;
  const bx = e[0] * x + e[4] * y + e[8] * z + e[12];
  const by = e[1] * x + e[5] * y + e[9] * z + e[13];
  const bz = e[2] * x + e[6] * y + e[10] * z + e[14];
  const dx = x - (f[0] * bx + f[4] * by + f[8] * bz + f[12]);
  const dy = y - (f[1] * bx + f[5] * by + f[9] * bz + f[13]);
  const dz = z - (f[2] * bx + f[6] * by + f[10] * bz + f[14]);
  if (dx * dx + dy * dy + dz * dz > TELEPORT * TELEPORT) return out;
  out.x = dx / span; out.y = dy / span; out.z = dz / span;
  return out;
}
const _vh = { x: 0, y: 0, z: 0 };

/** How far over their origin `pushOutOfHulls` looks for a hull's roof seen
 *  from inside, in metres. */
const ROOF_PROBE = 4;

/** Back faces skipped along one probe before it gives up. */
const MAX_BACK_FACES = 4;

const _probe = { t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, dx: 0, dy: 0, dz: 0,
                 material: 0, kind: '', owner: -1, triangle: -1 };
const _hit = { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, material: 0, triangle: -1 };

/**
 * The first face along `S -> E` that the probe meets from its front, in world
 * space, into `_hit`: 1. -1 when the first face it met was a back face and no
 * front face followed (S is inside the hull), 0 for nothing. `m` is a `WorldCollider.moved` record.
 * The index's triangles store `(v1 - v0) x (v2 - v0)` pointing into a closed
 * hull (every closed collision mesh on Wake measures a negative signed volume
 * that way), so the engine's face normal is its opposite (COL-23).
 */
function frontFace(statics, m, owner, sx, sy, sz, ex, ey, ez) {
  const e = m.inv, f = m.fwd;
  let lx = e[0] * sx + e[4] * sy + e[8] * sz + e[12];
  let ly = e[1] * sx + e[5] * sy + e[9] * sz + e[13];
  let lz = e[2] * sx + e[6] * sy + e[10] * sz + e[14];
  const qx = e[0] * ex + e[4] * ey + e[8] * ez + e[12];
  const qy = e[1] * ex + e[5] * ey + e[9] * ez + e[13];
  const qz = e[2] * ex + e[6] * ey + e[10] * ez + e[14];
  let dx = qx - lx, dy = qy - ly, dz = qz - lz;
  let len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) return 0;
  let result = 0;
  dx /= len; dy /= len; dz /= len;
  const p = statics.tris;
  for (let k = 0; k < MAX_BACK_FACES && len > 1e-6; k++) {
    _probe.dx = dx; _probe.dy = dy; _probe.dz = dz;
    const hit = statics.cast(lx, ly, lz, dx, dy, dz, len, -1, _probe, owner,
                             false, false, -Infinity, 2, m.sub ?? -1);
    if (!hit) return result;
    const i = hit.triangle * 9;
    const e1x = p[i + 3] - p[i], e1y = p[i + 4] - p[i + 1], e1z = p[i + 5] - p[i + 2];
    const e2x = p[i + 6] - p[i], e2y = p[i + 7] - p[i + 1], e2z = p[i + 8] - p[i + 2];
    // The engine's normal, out of the hull.
    let nx = -(e1y * e2z - e1z * e2y), ny = -(e1z * e2x - e1x * e2z), nz = -(e1x * e2y - e1y * e2x);
    const nl = Math.hypot(nx, ny, nz);
    if (nl > 1e-12 && nx * dx + ny * dy + nz * dz < 0) {
      nx /= nl; ny /= nl; nz /= nl;
      _hit.x = f[0] * hit.x + f[4] * hit.y + f[8] * hit.z + f[12];
      _hit.y = f[1] * hit.x + f[5] * hit.y + f[9] * hit.z + f[13];
      _hit.z = f[2] * hit.x + f[6] * hit.y + f[10] * hit.z + f[14];
      _hit.nx = f[0] * nx + f[4] * ny + f[8] * nz;
      _hit.ny = f[1] * nx + f[5] * ny + f[9] * nz;
      _hit.nz = f[2] * nx + f[6] * ny + f[10] * nz;
      _hit.material = hit.material;
      _hit.triangle = hit.triangle;
      return 1;
    }
    // A back face: the probe is leaving the hull here. Go on past it.
    if (k === 0) { result = -1; _hit.triangle = hit.triangle; }
    const step = hit.t + 1e-4;
    lx += dx * step; ly += dy * step; lz += dz * step;
    len -= step;
  }
  return result;
}

/**
 * Each moved hull ROOT's motion since this soldier last looked, by owner, into
 * `walker._hullSeen`: the root's position for its linear `vHull dt` (relV,
 * S), and its frame as it stood, for a hit's point speed (`hullPointSpeed`).
 * `pushOutOfHulls` runs it before its probes (so a sub-part's record reads its
 * owner's), and the world runs it for a seated soldier every tick
 * (`watchHulls`), so the first look after they get out measures one tick of
 * the hull's motion, not all it did while they sat.
 */
function trackHulls(walker, moved, seen, dt) {
  const tick = walker.worldTick;
  for (const [key, m] of moved) {
    if (m.sub >= 0) continue;
    let track = seen.get(key);
    // A track the previous world tick did not refresh is stale: a soldier
    // who sat in a seat, or was not stepped, has not watched the hull move,
    // and its move since would read as one tick's (a hull parked at 0.01 m/s
    // that had shifted 1.1 m while they sat billed 34 m/s and 177 HP).
    if (track && tick !== undefined && track.tick !== undefined && track.tick !== tick - 1) {
      seen.delete(key);
      track = null;
    }
    if (track) track.tick = tick;
    if (!track) {
      track = { x: m.x, y: m.y, z: m.z, f: new Float64Array(16), framed: false,
                hx: 0, hy: 0, hz: 0, vx: 0, vy: 0, vz: 0, tick, published: m.tick, span: dt };
      seen.set(key, track);
      track.f.set(m.fwd);
      continue;
    }
    // How many world ticks the pose moved over since the last look: one when
    // the hull is published every tick (the room, the runner, the page since
    // `hull-bodies.js` `publishTickPoses`); more for a pose published once a
    // frame that ran several ticks, which read as one tick's move billed a
    // teammate a 6 m/s taxiing plane's run-over at 12-21 m/s (El Alamein). Not
    // republished since (0 ticks): it has not moved where they can meet it,
    // and its speed is what it was, for the few ticks a frame runs.
    let ticks = 1;
    if (m.tick !== undefined && track.published !== undefined) ticks = m.tick - track.published;
    if (ticks === 0) {
      const stale = tick !== undefined && m.tick !== undefined && tick - m.tick > MAX_PUBLISH_GAP;
      track.hx = track.hy = track.hz = 0;
      if (stale) track.vx = track.vy = track.vz = 0;
      track.framed = false;
      continue;
    }
    if (!(ticks > 0)) ticks = 1;
    track.published = m.tick;
    const span = dt * ticks;
    track.span = span;
    let hx = m.x - track.x, hy = m.y - track.y, hz = m.z - track.z;
    const jumped = hx * hx + hy * hy + hz * hz > TELEPORT * TELEPORT;
    if (jumped) hx = hy = hz = 0;
    track.hx = hx; track.hy = hy; track.hz = hz;
    track.vx = span > 0 ? hx / span : 0; track.vy = span > 0 ? hy / span : 0; track.vz = span > 0 ? hz / span : 0;
    track.x = m.x; track.y = m.y; track.z = m.z;
    // `f` keeps last tick's frame for `hullPointSpeed` until the probes ran.
    track.framed = !jumped;
  }
}

/** `trackHulls` alone, for a soldier whose body is not stepped this tick (in
 *  a seat): their tracks follow the hulls, and the frames are kept. */
export function watchHulls(walker, dt) {
  const moved = walker.world?.moved;
  const seen = walker._hullSeen;
  if (!seen) return;
  if (!moved?.size) { seen.clear(); return; }
  trackHulls(walker, moved, seen, dt);
  for (const [key, track] of seen) {
    const m = moved.get(key);
    if (m) track.f.set(m.fwd);
  }
  if (seen.size > moved.size) for (const key of seen.keys()) if (!moved.has(key)) seen.delete(key);
}

/**
 * Push `walker` (a `SoldierBody`) out of every moved hull that has come into
 * them this tick, the engine's way (above). Run after the capsule
 * sweep has moved them, before their feet are put on the ground. Fills
 * `walker.hullContacts` with this tick's run-over contacts, one per hull:
 * `{ owner, speed, rel: [x,y,z], normal: [x,y,z], hullVelocity: [x,y,z],
 *    soldierVelocity: [x,y,z], material, x, y, z }`.
 */
export function pushOutOfHulls(walker, dt) {
  const contacts = walker.hullContacts;
  contacts.length = 0;
  const world = walker.world;
  const moved = world?.moved;
  const seen = walker._hullSeen;
  if (!moved?.size || !world.statics?.cast) { seen?.clear(); return; }
  const statics = world.statics;
  const body = walker.body;
  const p = body.position, prev = body.previous, v = body.velocity;
  const ox = p.x, oy = p.y + CHARACTER_HEIGHT, oz = p.z;
  const px = prev.x, py = prev.y + CHARACTER_HEIGHT, pz = prev.z;
  const c = Math.cos(walker.yaw ?? 0), s = Math.sin(walker.yaw ?? 0);
  let pushX = 0, pushY = 0, pushZ = 0, speedX = 0, speedY = 0, speedZ = 0;
  const reactions = walker.hullReactions ?? (walker.hullReactions = []);
  reactions.length = 0;
  trackHulls(walker, moved, seen, dt);
  for (const [key, m] of moved) {
    const owner = m.sub >= 0 ? m.owner : key;
    const root = m.sub >= 0 ? (moved.get(owner) ?? m) : m;
    const track = seen.get(m.sub >= 0 ? owner : key);
    if (!track) continue;
    const hx = track.hx, hy = track.hy, hz = track.hz;
    if (owner === walker.ignoreOwner) continue;
    hullShares(root.mass, _shares);
    const shareA = _shares.a, shareB = _shares.b;
    let rPushX = 0, rPushY = 0, rPushZ = 0, rSpeedX = 0, rSpeedY = 0, rSpeedZ = 0;
    let rAtX = 0, rAtY = 0, rAtZ = 0, rCount = 0;
    // Their 17 vertices reach 1.8 m from their origin at most; the probes start
    // at most the tick's two moves further off.
    const reach = m.radius + 1.0 + Math.hypot(hx, hy, hz) + Math.hypot(ox - px, oy - py, oz - pz);
    const cx = m.x - ox, cy = m.y - oy, cz = m.z - oz;
    if (cx * cx + cy * cy + cz * cz > reach * reach) continue;
    // `S`: their origin one tick ago, carried by the hull ROOT's linear move.
    const sx = px + hx, sy = py + hy, sz = pz + hz;
    const vhx = track.vx, vhy = track.vy, vhz = track.vz;
    let contact = null, fronts = 0, backs = 0;
    for (let i = 0; i < SOLDIER_HULL_VERTICES.length; i++) {
      const [vx, vy, vz] = SOLDIER_HULL_VERTICES[i];
      const ex = ox + vx * c + vz * s, ey = oy + vy, ez = oz - vx * s + vz * c;
      const met = frontFace(statics, m, owner, sx, sy, sz, ex, ey, ez);
      // Barbed wire a round's spawner stood (a moved `Obstacle` owner, bf1918's
      // `BarbWire5`): `Obstacle::handleCollision` 0x08315e10 answers 0 above
      // the handlers' gate, so there is no push at all, only the touch the
      // capsule sweep already records and bills (`resolveMove`, the slow and
      // the 5 HP); under the gate it is as solid as any static. Never a
      // reason to look through it either: a man in a coil is in the wire.
      const wire = met !== 0 && statics.obstacleOf?.(_hit.triangle) >= 0;
      if (wire && met < 0) continue;
      if (met < 0) backs++;
      if (met <= 0) continue;
      const H = _hit;
      // `vRel` at the hit: their speed less the hull's point speed there.
      hullPointSpeed(root, track, H.x, H.y, H.z, dt, _vh);
      const rx = v.x - _vh.x, ry = v.y - _vh.y, rz = v.z - _vh.z;
      if (wire && rx * rx + ry * ry + rz * rz > OBSTACLE_HANDLER_SPEED_SQ) continue;
      fronts++;
      // The end point's plane distance, <= 0 (`f2`).
      let depth = (ex - H.x) * H.nx + (ey - H.y) * H.ny + (ez - H.z) * H.nz;
      let nx = H.nx, ny = H.ny, nz = H.nz;
      if (i !== 0) {
        // 0x0825a0eb: back toward `S`, flat inside the band.
        nx = sx - H.x; ny = sy - H.y; nz = sz - H.z;
        if (Math.abs(oy - H.y) < FLAT_PUSH_BAND) {
          ny = 0;
        } else {
          // `f3`: minus the hit's distance to the vertex along the ray.
          depth = -Math.hypot(ex - H.x, ey - H.y, ez - H.z);
        }
        const l = Math.hypot(nx, ny, nz);
        if (l < 1e-6) continue;
        nx /= l; ny /= l; nz /= l;
      }
      if (depth > 0) depth = 0;
      // `impulseOn`, each side by its share: push out by the depth, cancel
      // the speed along it (`share x vRel`, `depth x share`).
      const k = -(rx * nx + ry * ny + rz * nz);
      if (shareA !== 0) {
        pushX = setAdjust(pushX, -depth * shareA * nx);
        pushY = setAdjust(pushY, -depth * shareA * ny);
        pushZ = setAdjust(pushZ, -depth * shareA * nz);
        speedX = setAdjust(speedX, k * shareA * nx);
        speedY = setAdjust(speedY, k * shareA * ny);
        speedZ = setAdjust(speedZ, k * shareA * nz);
      }
      if (shareB !== 0) {
        rPushX = setAdjust(rPushX, -depth * shareB * nx);
        rPushY = setAdjust(rPushY, -depth * shareB * ny);
        rPushZ = setAdjust(rPushZ, -depth * shareB * nz);
        rSpeedX = setAdjust(rSpeedX, k * shareB * nx);
        rSpeedY = setAdjust(rSpeedY, k * shareB * ny);
        rSpeedZ = setAdjust(rSpeedZ, k * shareB * nz);
        rAtX += H.x; rAtY += H.y; rAtZ += H.z; rCount++;
      }
      // The handlers: the first vertex past 0.1 m^2/s^2 of relative speed.
      if (!contact && rx * rx + ry * ry + rz * rz > HANDLER_SPEED_SQ) {
        contact = {
          owner, speed: Math.hypot(rx, ry, rz), rel: [rx, ry, rz],
          normal: [H.nx, H.ny, H.nz], hullVelocity: [_vh.x, _vh.y, _vh.z],
          soldierVelocity: [v.x, v.y, v.z], material: H.material,
          x: H.x, y: H.y, z: H.z,
        };
      }
    }
    if (contact) contacts.push(contact);
    // The hull's own `solveImpulse` (a light hull's share, COL-2): moved by
    // its adjust now, and `speedAdjust x 30 x (1 + e)/2` posted at the mean
    // of its hits (`impulseOn` keeps the running mean of the relative
    // position). For the world's soldier tick to hand its body.
    if (rCount && (rPushX !== 0 || rPushY !== 0 || rPushZ !== 0)) {
      reactions.push({
        owner, push: [rPushX, rPushY, rPushZ],
        accel: [rSpeedX * SPEED_ADJUST_SHARE * ENGINE_TICK_RATE,
                rSpeedY * SPEED_ADJUST_SHARE * ENGINE_TICK_RATE,
                rSpeedZ * SPEED_ADJUST_SHARE * ENGINE_TICK_RATE],
        at: [rAtX / rCount, rAtY / rCount, rAtZ / rCount],
      });
    }
    // Already inside it: the engine finds no face from in there and they walk
    // out, where the page's two-sided sweep would hold them (`resolveMove`).
    // So the sweep looks through this hull until they are clear of it, as it
    // does for a man spawned inside one (`SoldierBody.ignoreHullWithin`).
    // Inside means enclosed: the hull's roof over their origin is a back face
    // too. A probe that met only the back of an open plate (a fence, a wall
    // whose faces look the other way) is no reason to let the page's
    // two-sided sweep through it.
    if (!fronts && backs && walker.ignoreOwner < 0
        && frontFace(statics, m, owner, sx, sy, sz, sx, sy + ROOF_PROBE, sz) < 0) {
      walker.ignoreHullWithin?.({ owner, x: m.x, z: m.z, r: m.radius }, 30);
    }
  }
  // This tick's frames, for the next tick's point speeds.
  for (const [key, track] of seen) {
    const m = moved.get(key);
    if (m) track.f.set(m.fwd);
  }
  // Forget hulls that are no longer published.
  if (seen.size > moved.size) for (const key of seen.keys()) if (!moved.has(key)) seen.delete(key);
  // `solveImpulse`, gated on a non-zero positional adjust (COL-9).
  if (pushX === 0 && pushY === 0 && pushZ === 0) return;
  p.x += pushX; p.y += pushY; p.z += pushZ;
  v.x += speedX * SPEED_ADJUST_SHARE;
  v.y += speedY * SPEED_ADJUST_SHARE;
  v.z += speedZ * SPEED_ADJUST_SHARE;
  walker.hullPushed = true;
}

/**
 * Move a soldier sideways by `(dx, dz)` -- another soldier's push
 * (`world-soldier-tick.js` `separateSoldiers`) -- stopped short of whatever
 * the capsule meets on the way. The engine writes the pushed position
 * straight onto the node (`setAbsolutePosition`, lnxded 0x0825a6b2) and its
 * vertices meet the walls on the next tick; our sweep starts each tick
 * from where the last one left the feet, so a push written through a wall
 * would carry the soldier past it. Returns the fraction of the push taken.
 */
export function sweepSeparation(walker, dx, dz) {
  const dist = Math.hypot(dx, dz);
  if (dist < 1e-9) return 1;
  const p = walker.body.position;
  const hit = sweepCapsule(walker.world, p.x, p.y, p.z, dx / dist, 0, dz / dist, dist,
                           HULL_RADIUS, capsule(walker), null, walker.ignoreOwner ?? -1);
  const f = hit ? Math.max(0, hit.t - SKIN) / dist : 1;
  p.x += dx * f;
  p.z += dz * f;
  return f;
}

/**
 * The run-over damage for one contact `pushOutOfHulls` recorded: the
 * soldier-victim branch of COL-3 (`crash-damage.js` `soldierCollisionDamage`,
 * V0's exact form), the face's material the attacker's, their vertex's 41 the
 * victim's, both bodies' speeds projected on the contact speed's direction.
 * `fallHeight` is `lastCollisionHeight - y` (HP-14's `F`).
 */
export function runOverInputs(contact, { fallHeight = 0, kitDamping = 1 } = {}) {
  const [rx, ry, rz] = contact.rel;
  const l = Math.hypot(rx, ry, rz) || 1;
  const ux = rx / l, uy = ry / l, uz = rz / l;
  const [hx, hy, hz] = contact.hullVelocity;
  const [vx, vy, vz] = contact.soldierVelocity;
  return {
    speed: contact.rel, normal: contact.normal,
    matAttacker: contact.material, matVictim: SOLDIER_VERTEX_MATERIAL,
    attackerSpeedAlong: hx * ux + hy * uy + hz * uz,
    victimSpeedAlong: vx * ux + vy * uy + vz * uz,
    fallHeight, kitDamping,
  };
}
