// Our collision resolve for a walking body: the capsule sweep against the
// hulls, the slide, the steep-terrain refusal and the ground clamp, with the
// per-tick contact record the jump gate reads. Split out of `walking-body.js`,
// whose `SoldierBody` calls these with itself as `walker` once a tick, after
// its integrator has moved the point body.

import { GRAVITY } from './point-body.js';
import { TICK_RATE } from './fixed-step.js';
import { BODY_RADIUS } from './soldier-pose.js';
import {
  JUMP_CONTACT_NORMAL_Y, MATERIAL_WATER, STEP_HEIGHT, SNAP_DOWN, MAX_GROUND_SLOPE,
  OBSTACLE_HANDLER_SPEED_SQ,
} from './soldier-locomotion.js';

/** Gap kept between a body and whatever it stops against, in metres. */
const SKIN = 0.01;

/** Passes the slide resolver will make before it gives up on a corner. */
const SLIDE_PASSES = 4;

// Scratch for the capsule sweep. `world.sweepSphere` hands back a record it
// owns and reuses, so the nearest of several sphere sweeps has to be copied out
// before the next call overwrites it.
const _contact = {
  t: 0, nx: 0, ny: 1, nz: 0, px: 0, py: 0, pz: 0, material: 0, owner: -1,
};

/** Scratch for `Heightfield.normal`, which writes into a caller's array. */
const _normal = [0, 1, 0];

/** Scratch for `groundUnder`. */
const _ground = { y: -Infinity, nx: 0, ny: 1, nz: 0, material: -1, sea: NaN };

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
  for (const offset of offsets) {
    let hit = world.sweepSphere(x, y + offset, z, dx, dy, dz, dist, radius,
                                skipOwner, false, -Infinity, 2, false, EDGE_SHELL);
    if (!hit) continue;
    // Barbed wire (`BFSoldier::handleCollision` 0x0827d3b0's Obstacle
    // branch): above the handler gate the contact is recorded and vetoed,
    // and the sphere goes on to whatever is behind the wire.
    if (walker?._obstaclePass && world.obstacleAt) {
      const obstacle = world.obstacleAt(hit);
      if (obstacle >= 0) {
        noteObstacle(walker, obstacle, hit.px, hit.py, hit.pz);
        hit = world.sweepSphere(x, y + offset, z, dx, dy, dz, dist, radius,
                                skipOwner, false, -Infinity, 2, true, EDGE_SHELL);
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
    if (dx * hit.nx + dy * hit.ny + dz * hit.nz >= 0) continue;
    if (best >= 0 && hit.t >= best) continue;
    best = hit.t;
    _contact.t = hit.t;
    _contact.nx = hit.nx; _contact.ny = hit.ny; _contact.nz = hit.nz;
    _contact.px = hit.px; _contact.py = hit.py; _contact.pz = hit.pz;
    _contact.material = hit.material;
    _contact.owner = hit.owner;
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
function recordContact(walker, nx, ny, nz, material) {
  if (!Number.isFinite(ny)) return;
  if (ny > walker._bestNormalY) {
    walker._bestNormalY = ny;
    walker.contactNormal.x = nx;
    walker.contactNormal.y = ny;
    walker.contactNormal.z = nz;
    walker.contactMaterial = material;
  }
  if (ny > JUMP_CONTACT_NORMAL_Y && material !== MATERIAL_WATER) {
    walker._armed = true;
  }
}

/** The spheres making up the capsule, lowest lifted by a step when grounded. */
function capsule(walker) {
  const height = walker.height;
  const r = BODY_RADIUS;
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
                             BODY_RADIUS, offsets, walker, walker.ignoreOwner ?? -1);
    if (!hit) {
      px += rx; py += ry; pz += rz;
      rx = 0; ry = 0; rz = 0;
      break;
    }
    walker.contacts++;
    recordContact(walker, hit.nx, hit.ny, hit.nz, hit.material);
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

/**
 * What the feet stand on at (x, z), from height y: the heightfield, the sea
 * bed, or a hull. Into `g`: `y` (-Infinity for nothing), its normal and
 * material, and `sea`, the water level where the sea is the higher surface
 * (NaN elsewhere).
 *
 * Terrain is a clamp rather than a sweep on purpose. The heightfield is a
 * function of (x, z) — `WorldCollider.surfaceHeight` is one bilinear sample
 * and already answers "ground or sea, whichever is higher" — so sweeping a
 * sphere against half a million terrain triangles to learn the same number
 * would be pure waste.
 *
 * Hulls get a downward **ray**, not a sweep, and that distinction was paid
 * for: a sweep returns the nearest contact of *any* orientation, so standing
 * under Wake's farm awning the nearest thing below the body was one of the
 * roof posts beside it, the floor underfoot was never reported, the body went
 * un-grounded, the capsule dropped its lowest sphere back into the floor it
 * had been standing on, and it wedged there for good. A vertical ray can only
 * meet what is actually underneath.
 */
function groundUnder(walker, x, y, z, g) {
  const world = walker.world;
  let ground = -Infinity;
  // The normal and material of whatever the feet end up on, for `#contact`.
  // Terrain answers with its own bilinear normal; the sea plane is flat and
  // is material 1, which is what keeps a jump from arming on open water.
  let groundNx = 0, groundNy = 1, groundNz = 0, groundMaterial = -1;
  g.sea = NaN;
  if (world && world.surfaceHeight) {
    const h = world.surfaceHeight(x, z);
    const level = world.waterLevel;
    // **A man does not stand on the sea**, and this is where he used to.
    // `WorldCollider.surfaceHeight` answers `max(heightfield, waterLevel)`,
    // which is the right question for a vehicle on a bridge and the wrong one
    // for a soldier in the water: it put the feet on the water plane, reported
    // `grounded`, and let him walk out to sea. The engine has no such surface
    // for a soldier — `updateSwimming` is the only thing that ever puts a
    // soldier's y on the water, and it puts it 0.4 m *under*.
    //
    // So where the sea is the higher surface, ask the heightfield what is
    // actually underfoot. Standing in shallow water is then standing on the
    // seabed, with the seabed's own normal and material; deep water leaves
    // nothing to stand on and the body falls, which is what hands it to
    // `#updateSwim`.
    const isSea = Number.isFinite(h) && level != null
      && Math.abs(h - level) <= 1e-6;
    g.sea = isSea ? level : NaN;
    const bed = isSea && world.heightfield && world.heightfield.height
      ? world.heightfield.height(x, z) : NaN;
    const solid = isSea ? bed : h;
    if (Number.isFinite(solid)) {
      ground = solid;
      if (isSea && !(bed < level)) {
        // The sea and the bed agree to within the epsilon: a shoreline cell
        // exactly at water level. Keep the old material so a jump is still
        // refused there.
        groundMaterial = MATERIAL_WATER;
      } else {
        if (world.heightfield && world.heightfield.normal) {
          world.heightfield.normal(x, z, _normal);
          if (Number.isFinite(_normal[1])) {
            groundNx = _normal[0]; groundNy = _normal[1]; groundNz = _normal[2];
          }
        }
        if (world.heightfield && world.heightfield.material) {
          groundMaterial = world.heightfield.material(x, z);
        }
      }
    }
  }
  if (world && world.cast) {
    // From a step up, straight down, far enough to catch both the lift onto a
    // kerb and the glue onto a descending ramp. `cast` answers for terrain and
    // sea as well, which only agrees with `surfaceHeight` above — harmless,
    // and it costs one entry in the collider's cast meter per tick.
    const skipOwner = walker.ignoreOwner ?? -1;
    let hit = world.cast(x, y + STEP_HEIGHT, z, 0, -1, 0,
                         STEP_HEIGHT + SNAP_DOWN, skipOwner);
    // Barbed wire is no floor to a body moving through it (the same veto as
    // the sweep's): the touch is recorded and the ray goes on below it.
    if (hit && walker._obstaclePass && world.obstacleAt) {
      const obstacle = world.obstacleAt(hit);
      if (obstacle >= 0) {
        noteObstacle(walker, obstacle, hit.x, hit.y, hit.z);
        const from = hit.y - 1e-3;
        const reach = STEP_HEIGHT + SNAP_DOWN - (y + STEP_HEIGHT - from);
        hit = reach > 0 ? world.cast(x, from, z, 0, -1, 0, reach, skipOwner) : null;
        if (hit && world.obstacleAt(hit) >= 0) hit = null;
      }
    }
    // The cast answers for the water plane too (`collision.js`'s `kind ===
    // 'water'` arm), and that answer is not a floor for a man: without this
    // the sea came straight back in through the hull probe the moment the
    // surface test above stopped offering it.
    if (hit && hit.kind === 'water') {
      // nothing underfoot here
    } else if (hit && hit.ny >= MAX_GROUND_SLOPE && hit.y > ground) {
      ground = hit.y;
      groundNx = hit.nx; groundNy = hit.ny; groundNz = hit.nz;
      groundMaterial = hit.material;
    }
  }
  g.y = ground;
  g.nx = groundNx; g.ny = groundNy; g.nz = groundNz;
  g.material = groundMaterial;
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
                                0, 1, 0, ground - p.y, BODY_RADIUS,
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
  if (Number.isFinite(ground)) {
    if (p.y <= ground + SKIN) {
      p.y = ground;
      if (v.y < 0) v.y = 0;
      walker.grounded = true;
      recordContact(walker, groundNx, groundNy, groundNz, groundMaterial);
    } else if (walker.grounded && v.y <= 0 && p.y - ground <= SNAP_DOWN) {
      // Glued to ground falling away underneath, so walking down a dune is
      // walking rather than a sequence of small falls. Still a contact: a
      // soldier jogging down a slope may jump off it.
      p.y = ground;
      v.y = 0;
      recordContact(walker, groundNx, groundNy, groundNz, groundMaterial);
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
  // demanding that much fall costs it nothing.
  const wedgeMinFall = 2 * Math.abs(GRAVITY) / TICK_RATE;
  if (!walker.grounded && v.y < -wedgeMinFall
      && p.y >= q.y - 1e-4) {
    v.y = 0;
    walker.grounded = true;
  }
  if (world && world.heightfield && walker.grounded) {
    walker.material = world.heightfield.material(p.x, p.z);
  }
}
