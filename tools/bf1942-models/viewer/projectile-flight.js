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
import { fuseArmed, fuseTarget } from './proximity-fuse.js';

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
// What the floor must not do is add light: a widened streak is dimmed by the
// widening (`advanceTracers`), so past convergence the pair fades to the faint
// specks retail shows instead of running on as two bright lines.
export const TRACER_MIN_SCREEN_PX = 2.5;
const TRAIL_PUFF_SPACING = 0.9;  // metres of flight between smoke puffs
/** The ellipse inscribed in each face of the drag box (physics.md section 3), with
 *  the engine's own `3.14f` for pi (`ds:0x86d1384`, read at `0x082545b8`). */
const BOX_AREA = 3.14 * 0.25;
/**
 * The most a full physics body's summed acceleration can be in one tick, m/s^2
 * (ledger COL-8, collision-response.md section 4.2).
 * `PhysicsNode::updatePositionalPhysics` (lnxded `0x08253570`) scales the
 * accumulator `+0x28` back to 1000 when its squared length passes `1e6`, before
 * it integrates it, and everything that pushes the body this tick is in it: the
 * box drag, a motor's push, the gravity seeded at the end of the last tick
 * (`updatePhysics` `0x082543d0`). A Desert Combat AIM-9 or AA-10 leaving a jet
 * at 510-520 m/s loses exactly 33.3 m/s a tick for its first three or four
 * ticks in the lab's recordings, both alike, before the drag falls under the
 * lid (`features/rocket-flight`, section 3). Without it the box law at 30 Hz
 * overshoots a stiff body and runs away (an AT-2 at `drag 1`, `mass 5`).
 */
export const MAX_BODY_ACCELERATION = 1000;
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
// Everything that pushes a ballistic round this frame, summed before it is
// integrated (`MAX_BODY_ACCELERATION`).
const _accel = new THREE.Vector3();
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
// Scratch for the motor and the box drag law.
const _nose = new THREE.Vector3();
const _engineAt = new THREE.Vector3();
// Scratch for a falling tracer-path round: where the round is, and its heading.
const _head = new THREE.Vector3();
const _turn = new THREE.Vector3();

/**
 * One frame of a round's own motors (`rocket-motor.js`, ledger PHY-18..21).
 *
 * The push is along the engine's own forward axis, which for every rocket in
 * vanilla, Desert Combat, DC Final and EoD is the round's nose (each Engine
 * sits on the axis with `setRotation 0/0/0`), at the engine's own height for
 * the air density and the water test. FHSW's Norden bombs (`0/30/0`) and
 * lantern (`0/90/0`) turn theirs, and the turn is not honoured here
 * (`features/rocket-flight` Open item 10).
 * Where the nose points is the body's business:
 *
 *  - a full physics body (`setHasPointPhysics 0`, `shot.dragBox` set) has its
 *    tail `Wing` weathervane it into the flow: `PhysicsWing` pushes along
 *    `-surfaceUp` at the wing's own position, behind the centre of mass. The
 *    viewer has no inertia for a round, so the weathervaning is taken as
 *    complete, the nose as the flight path and the wing's lift, at zero
 *    incidence, as zero (inferred, not read; `features/rocket-flight` open
 *    item 2);
 *  - a point body never turns (`PointPhysicsNode` has no torque and keeps
 *    only `addAccelerationAtAbsolutePosition`'s linear part, `0x08256620`), so
 *    its nose is where the muzzle pointed (`shot.thrustAxis`). Every shipped
 *    point-body rocket also declares `gravityModifier 0`.
 *
 * `timeScale` is 1 on the map page; the model browser slows fast rounds, and
 * the motor then reads the real speed and its push is scaled by the square,
 * as `gravityScale` is. The push is added to `out`, an acceleration.
 */
function pushMotors(guns, shot, dt, out) {
  const scale = shot.timeScale || 1;
  const q = shot.mesh.quaternion;
  if (shot.thrustAxis) _nose.copy(shot.thrustAxis);
  else if (shot.velocity.lengthSq() > 1e-12) _nose.copy(shot.velocity).normalize();
  else _nose.set(0, 0, -1).applyQuaternion(q);
  const along = shot.velocity.dot(_nose) / scale;
  const water = guns.collider?.waterLevel;
  for (const motor of shot.motors) {
    const p = motor.position;
    _engineAt.set(p[0], p[1], p[2]).applyQuaternion(q).add(shot.mesh.position);
    const underWater = Number.isFinite(water) && _engineAt.y < water;
    const accel = motor.tick(dt * scale, along, _engineAt.y, underWater);
    if (accel) out.addScaledVector(_nose, accel * scale * scale);
  }
}

/**
 * The box drag law of a full physics body (PHY-4; `PhysicsNode::
 * updatePositionalDragAdvanced` lnxded `0x08252f50`), into `out`:
 *
 *   accel = -drag*|v|/mass * (Ax proj0(v) + Ay proj1(v) + Az proj2(v))
 *
 * with `Ax = (pi/4) DY DZ` and the rest, the ellipses in the geometry box's
 * faces, and `projN` the flow along the body's own axis N. A round's nose is
 * held on its flight path here (its fins' work, see `pushMotors`), so the flow
 * is all along its own Z and the law is `-drag*|v|/mass * Az * v`: the
 * frontal ellipse alone. Projecting onto the drawn mesh instead, whose
 * orientation is a frame old, put a sliver of the flow on the long side faces
 * (6.6 times the frontal area on an MLRS round) and flew a lift whose size
 * depended on the frame rate. Quadratic in speed, so a slowed round needs no
 * correction. The submersion scale is left at 1: a round that runs in water
 * is `torpedo-run.js`'s, and every other one bursts on it. The full form is
 * `aircraft.js` `applyBoxDrag`.
 */
function boxDrag(spec, velocity, box, out) {
  out.set(0, 0, 0);
  const mass = spec?.mass, drag = spec?.drag;
  const speed = velocity.length();
  if (!(mass > 0) || !(drag > 0) || !(speed > 0)) return out;
  const frontal = BOX_AREA * box[0] * box[1];
  return out.copy(velocity).multiplyScalar(-drag * speed * frontal / mass);
}

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
  const record = blast
    ? detonate(guns, shot.group, spec, shot.mesh.position, shot.travelled)
    : null;
  // The hull whose proximity set it off, for `guns.hits` readers.
  if (record && shot.fusedOn != null) record.fusedOn = shot.fusedOn;
  if (!record) {
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

/**
 * Does a vehicle near `shot` set its proximity fuse off this frame?
 *
 * `proximity-fuse.js` is the law; this is the query. The engine runs it once
 * per `Projectile::handleUpdate` (0x0831e940) against the round's position
 * then; the viewer runs it once per `advance`, at the position the round has
 * reached, which samples the path at least as densely. The candidates are
 * every hull the page reports near the round (`guns.nearObjects`), human- or
 * bot-driven alike. Records the vehicle that did it on the shot, for the
 * readout.
 */
function proximityDetonates(guns, shot) {
  if (!guns.nearObjects || !fuseArmed(shot.proximity, shot.age)) return false;
  const p = shot.mesh.position;
  const water = guns.collider?.waterLevel;
  // `getUnderWater` is a float on the round's physics node (+0x8c / +0x44);
  // reading "below the sea plane" as non-zero is the viewer's, not read.
  const underWater = Number.isFinite(water) && p.y < water;
  const near = guns.nearObjects(p.x, p.y, p.z, shot.proximity.distance);
  const target = fuseTarget(shot.proximity,
                            { x: p.x, y: p.y, z: p.z, underWater }, near);
  if (!target) return false;
  shot.fusedOn = target.owner ?? null;
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
    // A round that declares a `gravityModifier` falls by it (IMP-7), on the
    // tracer path as on the shell path; `tracerGravity` in round-launch.js
    // says which word applies. Zero for every retail rifle and MG round.
    let step;
    if (tracer.gravity) {
      // The round is `lead` ahead of the drawn mesh's origin along its flight
      // (the stand-in cylinder is drawn centred). It is the ROUND that falls:
      // step it, then hang the mesh `lead` behind it on the new heading.
      // Stepping the mesh instead swung a 50 m stand-in's head through the
      // turn, and a CBU-87 bomblet landed 20 m from where it fell.
      _head.copy(tracer.velocity).normalize()
        .multiplyScalar(tracer.lead).add(tracer.mesh.position);
      tracer.velocity.y += GRAVITY * tracer.gravity * tracer.gravityScale * dt;
      step = tracer.velocity.length() * dt;
      _head.addScaledVector(tracer.velocity, dt);
      _turn.copy(tracer.velocity).normalize();
      tracer.mesh.position.copy(_head).addScaledVector(_turn, -tracer.lead);
      // Pointed down its velocity, as `spawnTracer` points it at launch.
      tracer.mesh.lookAt(_aimBack.copy(tracer.mesh.position).add(_turn));
    } else {
      step = tracer.velocity.length() * dt;
      tracer.mesh.position.addScaledVector(tracer.velocity, dt);
    }
    tracer.travelled += step;
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
                   tracer.velocity, tracer.travelled - step + struck.t, tracer.origin);
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
      // Widened, it is dimmed by the same factor, so the light it puts on
      // screen stays what the real sub-pixel streak would. At full opacity the
      // floor drew a converged stream as two bright 2.5 px lines carrying on
      // hundreds of metres past the crossing; retail's real 0.3 m streak goes
      // to faint specks there (a Zero's burst, owner capture 2026-09-26).
      const coverage = tracer.lengthScale / across;
      for (const fade of tracer.mesh.userData.tracerFade ?? []) {
        fade.material.opacity = fade.opacity * coverage;
      }
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
                     shot.velocity, shot.travelled - step + struck.t, shot.origin);
        recycle(guns, shot, i);
        continue;
      }
    } else if (!shot.resting) {
      // The motor, from the round's own baked Engine (`pushMotors`). It used
      // to be a flat 25 m/s^2 for every `kind: 'rocket'` round (parity-audit
      // P-2), with no top speed.
      // A full physics body (`shot.dragBox`) sums what pushes it, at the
      // frame's starting velocity, and integrates the sum under the engine's
      // 1000 m/s^2 lid (`MAX_BODY_ACCELERATION`); a point body keeps its own
      // order, each term applied as it comes.
      _accel.set(0, 0, 0);
      if (shot.motors) pushMotors(guns, shot, dt, _accel);
      // `GRAVITY` is signed downward, so this adds. `gravityModifier` scales
      // it per projectile (IMP-7): 0.5 on the Panzer IV's and the Chi-ha's
      // rounds, 0 on the motor-carried rockets that say so, and unset — so 1
      // — on every other tank gun, howitzer, naval gun, bomb, torpedo and
      // artillery rocket.
      if (shot.gravity) _accel.y += GRAVITY * shot.gravity * shot.gravityScale;
      if (!shot.dragBox) {
        shot.velocity.addScaledVector(_accel, dt);
        _accel.set(0, 0, 0);
      }
      // Aerodynamic drag, the engine's own law (PHY-7,
      // `updatePositionalDragSimple` `0x00578990`). Inert until this round's
      // extractor change, because no projectile carried `mass` or `drag`; for
      // a 250 kg bomb at `drag 0.08` it is about 0.12 m/s^2 at 150 m/s, so it
      // is a correction and not a change of shape. `speedScale` is 1 wherever
      // this matters, so the term is applied on real time. A full physics
      // body (`setHasPointPhysics 0`: the rockets, the bombs, the torpedo in
      // the air) takes the box law instead, which is the engine's for it.
      if (shot.dragBox) {
        boxDrag(shot.group.stats.projectile, shot.velocity, shot.dragBox, _drag);
        _accel.add(_drag);
        // The lid is the engine's in real units; a slowed round's are scaled
        // by the square of its display scale, as its gravity is.
        const lid = MAX_BODY_ACCELERATION * shot.gravityScale;
        if (_accel.lengthSq() > lid * lid) _accel.setLength(lid);
        shot.velocity.addScaledVector(_accel, dt);
      } else if (shot.boundingRadius) {
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
                     shot.velocity, shot.travelled - step + struck.t, shot.origin);
        recycle(guns, shot, i);
        continue;
      }
    }
    // The proximity fuse, after the contact test: a round that met a hull
    // this frame has already gone through `impact`. Which of the two the
    // engine runs first within a tick (the physics contact or
    // `handleUpdate`) was not read; at a 10 m fuse the fuse nearly always
    // wins by frames, not by order.
    if (shot.proximity && proximityDetonates(guns, shot)) {
      endRound(guns, shot, i, true);
      continue;
    }
    const expired = shot.age > shot.ttl;
    if (expired && shot.onTimeEffect === false) {
      // The fuse ran out on a round that does not set `hasOnTimeEffect`:
      // `resetProjectile`, with no effect and no splash (PROX-7). Only a round
      // whose assets say so; `null` (too old to say) keeps the burst below.
      recycle(guns, shot, i);
      continue;
    }
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
