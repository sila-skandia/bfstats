// A round's flight, from the muzzle to wherever it stops: the tracer step and
// its on-screen width floor, the ballistic step (gravity, rocket motor, drag),
// a fuse round's contact physics, a torpedo's water run, and the swept hit test
// between one frame's position and the next. Split out of `gunfire.js`; every
// function takes the `GunFire` instance (`guns`) whose rounds it steps.

import * as THREE from 'three';
// The world's downward acceleration, signed, taken from the module that owns
// it rather than declared again here. It is -14.73 m/s^2 and not Earth's
// -9.81: `BasicPhysicsSystem`'s constructor at `0x00578f00` writes 0xC16BAE14
// into the gravity field and no vanilla `.con` overrides it. This file carried
// its own 9.81 until the client was read, which flew every shell, bomb and
// torpedo under two thirds of the gravity the game drops them under.
// `physics.js` imports nothing, so taking the constant from there costs this
// module no new dependency beyond the one line.
import { GRAVITY } from './physics.js';
import { SURFACE_STANDOFF } from './contact-response.js';
import { dragAcceleration, entersWater } from './bomb-release.js';
import { TorpedoRun, runParts } from './torpedo-run.js';
import { detonate, impact } from './round-impact.js';
import { spawnPuff } from './round-visuals.js';

// Minimum apparent width of a tracer streak, in pixels.
//
// The streak's real cross-section is honest: `TLight_m1` at `tracerScaler 50`
// is 0.30 m across and 50 m long, and broadside that is exactly what it draws.
// Fired down the boresight it is seen end-on, and 0.30 m at the Corsair's 116 m
// convergence subtends 1.1 px at 60 deg over 620 — a fragment that modern GL
// drops whenever the triangle misses a pixel centre, which is why the stream
// read as "barely visible little lines" pointing straight at the gunsight.
// Refractor's fixed-function rasteriser kept that same sub-pixel triangle as
// one bright additive pixel, so flooring the *apparent* width restores the
// engine's picture rather than inventing one. Length is never touched — only
// the cross-section, and only upward, so nothing shrinks below the real mesh.
export const TRACER_MIN_SCREEN_PX = 2.5;
// c_ETRocket motors light after launch; a gentle ramp reads as the Katyusha's
// kick without turning the rocket into a bullet.
const ROCKET_ACCEL = 25;         // m/s^2
const TRAIL_PUFF_SPACING = 0.9;  // metres of flight between smoke puffs
// Per-frame lid on collision queries. `features/flyable-vehicles/collision-and-crash.md`
// budgets the swept narrowphase at 0.1-0.3 ms worst case for one body; a held
// burst from a twelve-round-a-second gun keeps tens of rounds in the air, and
// this caps the whole loop at that same order. Rounds past the lid keep flying
// and are tested next frame — they do not tunnel, because the untested step is
// carried forward into the segment the next frame casts.
const MAX_CASTS_PER_FRAME = 192;

const _aimBack = new THREE.Vector3();
const _step = new THREE.Vector3();
// The drag acceleration of one round, per frame. Scratch, like every other
// vector on this page: a round in flight must not allocate.
const _drag = new THREE.Vector3();
const _tip = new THREE.Vector3();
// Where a fuse round stood at the top of the frame, so the distance it
// actually travelled under the contact solver can be measured rather than
// integrated (the solver moves it, snaps it to surfaces and pushes it out).
const _fuseFrom = new THREE.Vector3();
// Scratch for `layOnSurface`: the basis a landed fuse round is stood up in.
const _restN = new THREE.Vector3();
const _restF = new THREE.Vector3();
const _restR = new THREE.Vector3();
const _restM = new THREE.Matrix4();

/**
 * Lay a fuse round on the surface it is touching, instead of pointing it down
 * its own velocity.
 *
 * WHY THIS EXISTS. Every round in this module is aimed with
 * `mesh.lookAt(position - velocity)` — nose along flight — and for a shell in
 * the air that is right. For the four rounds that survive contact it is wrong
 * the moment they touch anything, and wrong in a way that is easy to watch: an
 * explosives pack thrown along the ground slides flat, sheds its along-surface
 * speed to friction, and then — with the horizontal component gone and one
 * tick of gravity still being added and cancelled every tick
 * (`contact-response.js`, "rest is judged on distance moved") — the only
 * velocity left is a hair of DOWNWARD, so `lookAt` swung the slab onto its end
 * and stood it in the dirt. In the game it stays flat.
 *
 * WHAT IT DOES. The body's contact normal is the round's up; the heading it
 * was travelling on, flattened into the surface, is the direction it faces.
 * Both grenades, the landmine and the pack are authored lying in their own
 * XZ plane (local +Y up, the exporter's world-up), so this is the whole of
 * "lie down on what you hit" — a pack on a slope tilts with the slope, and
 * one on a wall lies against the wall, which is what a charge stuck to a
 * bridge girder should do.
 *
 * `heading` may be null or parallel to the normal (a round dropped straight
 * down onto flat ground); any perpendicular will do then, and world +X
 * projected onto the surface is the cheapest one that is always defined.
 */
function layOnSurface(mesh, normal, heading) {
  _restN.set(normal.nx, normal.ny, normal.nz);
  if (_restN.lengthSq() < 1e-9) return;
  _restN.normalize();
  _restF.copy(heading || _restR.set(1, 0, 0));
  _restF.addScaledVector(_restN, -_restF.dot(_restN));
  if (_restF.lengthSq() < 1e-6) {
    _restF.set(1, 0, 0).addScaledVector(_restN, -_restN.x);
    if (_restF.lengthSq() < 1e-6) _restF.set(0, 0, 1).addScaledVector(_restN, -_restN.z);
  }
  _restF.normalize();
  // Right-handed basis with the mesh's own -Z as the facing axis, the same
  // axis `lookAt` uses, so a round that lands nose-first keeps its heading.
  // Y = n, Z = -f, and X must be Y x Z = f x n for the matrix to be a
  // rotation — build it the other way round and `setFromRotationMatrix`
  // reads a mirror and hands back a quaternion that turns the round inside
  // out.
  _restR.crossVectors(_restF, _restN);
  _restM.makeBasis(_restR, _restN, _restF.negate());
  mesh.quaternion.setFromRotationMatrix(_restM);
}

/**
 * Test the segment a round just flew, and hand back the first surface on it.
 *
 * This is the sweep, and it is the whole reason a round cannot pass through a
 * wall: at 1000 m/s a round moves 16.7 m between frames and Bocage's church
 * walls are 0.3 m thick, so a point test at the new position would miss the
 * wall in 98 frames out of 100. The segment from where the round *was* to
 * where it *is* cannot.
 *
 * `lead` is how far ahead of `position` the round itself sits — zero for the
 * baked streak, whose head is its origin, and half a length for the stand-in
 * cylinder, which is drawn centred.
 */
function sweep(guns, group, position, velocity, step, lead) {
  const collider = guns.collider;
  if (!collider || step <= 0 || guns.casts >= MAX_CASTS_PER_FRAME) return null;
  const speed = velocity.length();
  if (!(speed > 0)) return null;
  _step.copy(velocity).divideScalar(speed);
  const from = _tip.copy(position)
    .addScaledVector(_step, lead - step);
  guns.casts++;
  const hit = collider.cast(from.x, from.y, from.z, _step.x, _step.y, _step.z,
                            step, gunOwner(guns, group));
  const body = guns.bodyCast?.(from.x, from.y, from.z, _step.x, _step.y, _step.z,
                               hit ? hit.t : step, group);
  return body ?? hit;
}

/**
 * Which placed object this gun belongs to, so its rounds ignore its own hull.
 *
 * A muzzle sits inside the vehicle's collision mesh — the Tiger's gun barrel
 * starts several metres inside `Tiger_Hull_M1` — so without this every shot
 * would detonate on the firer. Cached per group and invalidated when the
 * collider changes, because resolving it walks the ancestor chain.
 */
function gunOwner(guns, group) {
  if (group.ownerFor !== guns.collider) {
    group.ownerFor = guns.collider;
    group.owner = guns.collider?.statics?.ownerOf(group.node) ?? -1;
  }
  return group.owner;
}

/**
 * Take `shot` out of the world, blowing it up on the way when it earned it.
 *
 * `blast` is whether this is the end of the round's own fuse (or a hand
 * detonation, which the engine treats identically — `Projectile::detonate`
 * is the same call either way). The end-of-life explosion is HP-9d:
 * `damageType` 1 or 4, no `hasCollisionEffect` test, an untruncated radius.
 * This is how a grenade, an explosives pack and a landmine deal every point
 * of damage they ever deal. `detonate` plays the `endEffectTemplate`
 * itself; a round with no end-of-life blast still gets its effect through
 * the fallback below.
 */
export function endRound(guns, shot, index, blast) {
  shot.run?.stop();
  shot.wake?.stop();
  const spec = shot.group.stats.projectile;
  if (!(blast && detonate(guns, shot.group, spec, shot.mesh.position,
                                shot.travelled))) {
    if (guns.effects && spec?.endEffect) {
      const at = shot.mesh.position;
      guns.effects.play(spec.endEffect,
                        { position: [at.x, at.y, at.z], normal: [0, 1, 0] });
    }
  }
  guns.scene.remove(shot.mesh);
  shot.mesh.visible = false;
  shot.group.projectilePool.push(shot.mesh);
  guns.projectiles.splice(index, 1);
}

/**
 * One frame of a fuse round: the rigid-body contact, not the ballistic step.
 *
 * HP-9d still holds — a fuse round takes NO impact path, plays no collision
 * effect and detonates only on `timeToLive` — but what it does between the
 * first touch and the fuse is now the engine's own contact solver rather
 * than a full stop. `contact-response.js` carries the addresses; the short
 * version is that all four vanilla fuse rounds declare
 * `setHasPointPhysics 0`, so they get `ResponsePhysics`, and the restitution
 * is the mean of the two materials' authored elasticity rather than a
 * number anyone had to invent.
 *
 * Returns the distance travelled this frame, for the trail spacing.
 */
function stepFuseRound(guns, shot, dt) {
  if (shot.resting) return 0;
  const collider = guns.collider;
  const before = _fuseFrom.copy(shot.mesh.position);
  // The contact probe. Same budget as `sweep`: a round that has already
  // spent the frame's casts simply does not move this frame, which is
  // better than one that tunnels through the floor.
  const owner = gunOwner(guns, shot.group);
  const probe = collider
    ? (ox, oy, oz, dx, dy, dz, maxDist) => {
        if (guns.casts >= MAX_CASTS_PER_FRAME) return null;
        guns.casts++;
        return collider.cast(ox, oy, oz, dx, dy, dz, maxDist, owner);
      }
    : null;
  shot.body.step(dt, shot.mesh.position, shot.velocity, probe);
  // The floor of last resort. `WorldCollider.cast` leaves a ray that starts
  // under the heightfield alone (a round spawned inside a hill must not be
  // deleted at the muzzle), so a fuse round that ever gets under the ground
  // — off the lip of a slab, through a seam between two hulls — would fall
  // for the rest of its fuse and blow up under the map. Terrain is a height
  // function: one lookup puts it back.
  const field = collider?.heightfield;
  if (field) {
    const p = shot.mesh.position;
    const ground = field.height(p.x, p.z);
    if (p.y < ground) {
      p.y = ground + SURFACE_STANDOFF;
      if (shot.velocity.y < 0) shot.velocity.y = 0;
    }
  }
  shot.resting = shot.body.resting;
  const step = before.distanceTo(shot.mesh.position);
  shot.travelled += step;
  // The heading it is travelling on, flattened — remembered while it is
  // moving so `layOnSurface` has something to face the round along once the
  // velocity has been spent.
  if (shot.velocity.x || shot.velocity.z) {
    shot.heading.set(shot.velocity.x, 0, shot.velocity.z).normalize();
  }
  if (shot.body.contact) {
    // Touching something: lie on it. Nose-along-velocity is for flight, and
    // a round in contact has almost no velocity left that points anywhere
    // meaningful — see `layOnSurface` for the pack that used to stand on
    // its end in the dirt because of it.
    layOnSurface(shot.mesh, shot.body.contact, shot.heading);
  } else if (shot.velocity.lengthSq() > 1e-6) {
    // Nose along the velocity while it is in the air, and left where it was
    // once it is not — a resting grenade should lie still, not snap to a
    // lookAt of a zero vector.
    _aimBack.copy(shot.mesh.position).sub(shot.velocity);
    shot.mesh.lookAt(_aimBack);
    // The authored tumble, on top of the nose-along-flight orientation and
    // about the round's own X — so a grenade turns over as it arcs instead of
    // tracking the path like a dart. Accumulated rather than incremented into
    // the quaternion, because `lookAt` above overwrites it every tick.
    if (shot.spin) {
      shot.spun += shot.spin * dt;
      shot.mesh.rotateX(shot.spun);
    }
  }
  return step;
}

/**
 * A water contact this round is allowed to survive: the engine's only
 * `return 0`, and the whole of an aircraft torpedo's water entry.
 *
 * `Projectile::handleCollision` (lnxded `0x0831ee80`) swallows a water contact
 * on a round whose `detonateOnWaterCollision` is clear (`+0x1ac`, tested at
 * `0x0831f3ae`) — it changes no velocity and returns without detonating, so
 * the round keeps going into the sea. This viewer ran the contact
 * unconditionally, which `features/bf1942-blast-and-bounce/README.md` already
 * recorded as a divergence; this closes it.
 *
 * Handing the round to a `TorpedoRun` happens here rather than at the spawn,
 * because "am I in the water" is only answerable once it is. Bombs are
 * unaffected: none of the three declares the word, so `entersWater` is false
 * and a bomb still bursts on the sea.
 *
 * @returns {boolean} true when the caller must NOT end the round
 */
function throughWater(guns, shot, hit) {
  if (hit.kind !== 'water') return false;
  const spec = shot.group.stats.projectile;
  if (!entersWater(spec)) return false;
  if (!shot.torpedo) {
    const waterLevel = guns.collider?.waterLevel ?? hit.y;
    if (!runParts(spec).isTorpedo) {
      // `detonateOnWaterCollision 0` with no floaters: the contact is still
      // swallowed (that is the engine's rule and it does not consult the
      // children), the round simply keeps its ballistic step under water.
      return true;
    }
    shot.torpedo = new TorpedoRun(spec, waterLevel, shot.boundingRadius || 1);
    // The wake, attached so its frame is the torpedo's own. Same contract as
    // the bazooka's `e_rocketFume`; `shot.run` is the in-air trail and is
    // stopped so the two do not both play.
    if (guns.effects && spec.trailBundle && guns.effects.has(spec.trailBundle)) {
      shot.run?.stop();
      shot.run = null;
      shot.wake = guns.effects.play(spec.trailBundle, {
        attach: { object: shot.mesh, velocity: () => shot.velocity },
      });
    }
  }
  return true;
}

/** Take `shot` out of the world with no blast — the plain contact path. */
function recycle(guns, shot, index) {
  shot.run?.stop();
  shot.wake?.stop();
  guns.scene.remove(shot.mesh);
  shot.mesh.visible = false;
  shot.group.projectilePool.push(shot.mesh);
  guns.projectiles.splice(index, 1);
}

/** Step every tracer round, sweep it, and retire it on a hit or its caps. True while any fly. */
export function advanceTracers(guns, dt) {
  let active = false;
  // Metres per pixel at one metre from the eye; the floor below scales it by
  // the streak's own distance. Recomputed per frame because both the camera
  // and the canvas can change between them.
  const height = Math.max(guns.viewportHeight() || 0, 1);
  const metresPerPxAt1m = guns.camera?.isPerspectiveCamera
    ? (2 * Math.tan(guns.camera.fov * Math.PI / 360)) / height
    : 0;
  for (let i = guns.tracers.length - 1; i >= 0; i--) {
    const tracer = guns.tracers[i];
    tracer.age += dt;
    const step = tracer.velocity.length() * dt;
    tracer.travelled += step;
    tracer.mesh.position.addScaledVector(tracer.velocity, dt);
    const struck = sweep(guns, tracer.group, tracer.mesh.position,
                               tracer.velocity, step, tracer.lead);
    if (struck) {
      // Put the streak's head on the surface before it goes, so the last
      // frame drawn is the round stopping rather than the round past it.
      tracer.mesh.position.set(struck.x, struck.y, struck.z)
        .addScaledVector(_step, -tracer.lead);
      // Distance flown to the surface itself: the frame's step overshoots
      // it, and a slow frame at 1000 m/s overshoots it by tens of metres.
      impact(guns, tracer.group, tracer.group.stats.projectile, struck,
                   tracer.velocity, tracer.travelled - step + struck.t);
      guns.scene.remove(tracer.mesh);
      tracer.mesh.visible = false;
      tracer.pool.push(tracer.mesh);
      guns.tracers.splice(i, 1);
      continue;
    }
    if (tracer.lengthScale && tracer.width && metresPerPxAt1m) {
      // Hold the cross-section at TRACER_MIN_SCREEN_PX, never below the real
      // mesh. Length keeps its own scale, so a streak stays 50 m long and
      // only stops being a thread.
      const distance = tracer.mesh.position.distanceTo(guns.camera.position);
      const floor = (distance * metresPerPxAt1m * TRACER_MIN_SCREEN_PX)
        / tracer.width;
      const across = Math.max(tracer.lengthScale, floor);
      tracer.mesh.scale.set(across, across, tracer.lengthScale);
    }
    if (tracer.age > tracer.ttl || tracer.travelled > tracer.maxRange) {
      guns.scene.remove(tracer.mesh);
      tracer.mesh.visible = false;
      tracer.pool.push(tracer.mesh);
      guns.tracers.splice(i, 1);
    } else {
      active = true;
    }
  }
  return active;
}

/** Step every projectile in flight, sweep it, and end it on a hit or its fuse. True while any fly. */
export function advanceProjectiles(guns, dt) {
  let active = false;
  for (let i = guns.projectiles.length - 1; i >= 0; i--) {
    const shot = guns.projectiles[i];
    shot.age += dt;
    let step = 0;
    // A fuse round runs the rigid-body contact solver instead of this
    // loop's ballistic step: it has to keep moving after it touches
    // something, which is the whole of what `contact-response.js` adds.
    if (shot.body) {
      step = stepFuseRound(guns, shot, dt);
    } else if (shot.torpedo) {
      // A torpedo in the water runs its own integrator instead of the
      // ballistic one: buoyancy from its two floaters, levelling from its
      // wings, thrust from its `c_ETTorpedo` engine, drag at PHY-7's
      // submerged 25x. It still sweeps for contact below, so a hull kills a
      // ship through the ordinary `impact` with material 250.
      step = shot.torpedo.step(dt, shot.mesh.position, shot.velocity);
      shot.travelled += step;
      if (shot.velocity.lengthSq() > 1e-6) {
        _aimBack.copy(shot.mesh.position).sub(shot.velocity);
        shot.mesh.lookAt(_aimBack);
      }
      // `minDistanceUnderwaterSurface 0` / `maxDistanceUnderwaterSurface 50`
      // on `e_WaterTorpedo` is the wake's own depth gate; the run reports it
      // as `running`.
      if (shot.wake && !shot.torpedo.running) {
        shot.wake.stop();
        shot.wake = null;
      }
      const struck = sweep(guns, shot.group, shot.mesh.position,
                                 shot.velocity, step, 0);
      if (struck && !throughWater(guns, shot, struck)) {
        shot.mesh.position.set(struck.x, struck.y, struck.z);
        impact(guns, shot.group, shot.group.stats.projectile, struck,
                     shot.velocity, shot.travelled - step + struck.t);
        recycle(guns, shot, i);
        continue;
      }
    } else if (!shot.resting) {
      if (shot.kind === 'rocket') {
        const speed = shot.velocity.length();
        shot.velocity.multiplyScalar((speed + ROCKET_ACCEL * dt) / speed);
      }
      // `GRAVITY` is signed downward, so this adds. `gravityModifier` scales
      // it per projectile: 0 on every bullet (a tracer never reaches this
      // loop at all), 0.5 on the Panzer IV's and the Chi-ha's rounds, and
      // unset — so 1 — on every other tank gun, howitzer, naval gun, bomb
      // and torpedo.
      if (shot.gravity) {
        shot.velocity.y += GRAVITY * shot.gravity * shot.gravityScale * dt;
      }
      // Aerodynamic drag, the engine's own law (PHY-7,
      // `updatePositionalDragSimple` `0x00578990`). Inert until this round's
      // extractor change, because no projectile carried `mass` or `drag`; for
      // a 250 kg bomb at `drag 0.08` it is about 0.12 m/s^2 at 150 m/s, so it
      // is a correction and not a change of shape. `speedScale` is 1 wherever
      // this matters, so the term is applied on real time.
      if (shot.boundingRadius) {
        dragAcceleration(shot.group.stats.projectile, shot.velocity,
                         shot.boundingRadius, 0, _drag);
        shot.velocity.addScaledVector(_drag, dt);
      }
      step = shot.velocity.length() * dt;
      shot.travelled += step;
      shot.mesh.position.addScaledVector(shot.velocity, dt);
      // Nose (local -Z) along the velocity, so shells arc over — and so a
      // released bomb points down its own path, which is what `Bomb_wing`'s
      // `setWingLift 0.2` fins do in the engine.
      _aimBack.copy(shot.mesh.position).sub(shot.velocity);
      shot.mesh.lookAt(_aimBack);
      const struck = sweep(guns, shot.group, shot.mesh.position,
                                 shot.velocity, step, 0);
      if (struck && !throughWater(guns, shot, struck)) {
        shot.mesh.position.set(struck.x, struck.y, struck.z);
        impact(guns, shot.group, shot.group.stats.projectile, struck,
                     shot.velocity, shot.travelled - step + struck.t);
        recycle(guns, shot, i);
        continue;
      }
    }
    const expired = shot.age > shot.ttl;
    if (expired || shot.travelled > shot.group.maxRange) {
      // Only on `timeToLive`, never on the range cap: `maxRange` is this
      // viewer's own recycling guard (1,500 m on the map page, further than
      // any vanilla round's `timeToLive` carries it), not the engine's fuse,
      // and exploding there would invent a blast at an arbitrary distance.
      endRound(guns, shot, i, expired);
      continue;
    }
    active = true;
    if (shot.trail) {
      shot.sincePuff += step;
      while (shot.sincePuff >= TRAIL_PUFF_SPACING) {
        shot.sincePuff -= TRAIL_PUFF_SPACING;
        spawnPuff(guns, shot);
      }
    }
  }
  return active;
}
