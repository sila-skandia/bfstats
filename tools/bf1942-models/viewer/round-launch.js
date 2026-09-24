// Launching a round: which barrel, which way, how fast, and what leaves it —
// a tracer streak (or the hidden hit-test round between tracers) for a bullet,
// the baked body for a shell, rocket, bomb or thrown charge. Split out of
// `gunfire.js`; every function takes the `GunFire` instance (`guns`) whose
// scene, pools and dice it uses.

import * as THREE from 'three';
import { isFuseRound, roundTimeToLive, sampleCrd } from './effects-core.js';
import { proximityFuseOf } from './proximity-fuse.js';
import { GRAVITY } from './physics.js';
// The contact a fuse round gets when it lands — elasticity, friction and
// resistance off the material pair, at the engine's own 30 Hz. See
// `contact-response.js` for why a grenade does not rebound and what it does
// instead. Imports nothing itself, so this costs the page no extra module.
import { FuseRoundBody, contactMaterialFor } from './contact-response.js';
import { releaseSpeed } from './bomb-release.js';
import { adopt, shellMaterial, tracerGeometry, tracerMaterial } from './round-visuals.js';

// Real muzzle velocities (400-1000 m/s) cross a parked model between two
// frames; scaled down so a burst reads as a stream instead of a strobe.
// Slow rounds (a Katyusha rocket leaves at 45 m/s, a tank shell at 100) are
// already watchable and fly at their real speed.
export const TRACER_SPEED_SCALE = 0.15;
export const PROJECTILE_SCALE_CUTOFF = 150;  // m/s; below this, no scaling
export const TRACER_MAX_AGE = 1.5;      // seconds, when the data declares none
export const TRACER_MAX_RANGE = 250;    // metres of travel before recycling

const _origin = new THREE.Vector3();
const _aim = new THREE.Quaternion();
const _minusZ = new THREE.Vector3(0, 0, -1);
const _spreadU = new THREE.Vector3();
const _spreadV = new THREE.Vector3();
const _aimBack = new THREE.Vector3();
// Scratch for the per-frame and per-shot paths below: a flash's roll, a
// gun's recoil offset and a round's unit direction were each a fresh
// allocation before, per emitter per frame and per shot, and a frame that
// allocates is a frame that will pay for it at the collector's convenience
// (features/mesh-viewer-performance, rule 5).
const _direction = new THREE.Vector3();

/** One projectile, out of one barrel. */
export function fireBarrel(guns, group, muzzle) {
  group.shots += 1;
  // An emitter with no declared `view` is drawn in both, which is 341 of
  // vanilla's 364 — and it is also what a glb baked before the flag was
  // exported looks like, so a stale asset behaves exactly as it used to.
  const view = guns.firstPerson ? 'first' : 'third';
  for (const emitter of group.emitters) {
    if (emitter.spec.view && emitter.spec.view !== view) continue;
    if (emitter.muzzle && emitter.muzzle !== muzzle) continue;
    // R2 / V-R2: Em_Shell792D* delay 2.0 s — age starts negative so the
    // casing is not strobed with the muzzle flash (T2).
    const delay = emitter.spec.delay || 0;
    emitter.age = -delay;
    emitter.node.visible = delay <= 0;
    // The engine rolls each flash particle (`startRotation CRD_UNIFORM
    // 0/180`), which is what keeps a held burst from looking like one frame.
    emitter.spin = guns.rand() * Math.PI * 2;
    // Bundle wrappers between the FireArms node and the emitter are hidden
    // too; walk them visible up to the gun.
    for (let node = emitter.node.parent;
         node && node !== group.node; node = node.parent) {
      node.visible = true;
    }
  }
  if (group.recoil !== null) group.recoil = 0;
  const tracer = group.stats.tracer;
  const tracerRound = tracer
    ? group.shots % Math.max(tracer.interval, 1) === 0
    : false;
  const projectile = group.stats.projectile;
  const spec = projectile && typeof projectile === 'object' ? projectile : null;
  if (spec && (spec.kind === 'shell' || spec.kind === 'rocket')
      && group.projectileMesh) {
    spawnProjectile(guns, muzzle, group, spec);
  } else if (spec && spec.kind === 'bullet') {
    // GUN-10 / V-R2: rifle projectiles are `invisible 1` — retail draws no
    // body. Tracer rounds still get the bright TLight streak. Every other
    // round still needs a ballistic in `tracers` so `sweep` / `impact`
    // run: hand weapons declare no tracer interval, so dropping the dim
    // stand-in without a hidden hit-test round killed every surface FX.
    spawnTracer(guns, muzzle, group, !!tracerRound);
    if (!tracerRound) {
      const tracer = guns.tracers[guns.tracers.length - 1];
      if (tracer) tracer.mesh.visible = false;
    }
  } else if (group.stats.velocity > 0) {
    // Stale GLB (`projectile` is a bare template name, or the drawn body
    // failed to bake): the old streak per round.
    spawnTracer(guns, muzzle, group, tracerRound);
  }
}

/**
 * The velocity a round leaves `muzzle` with, in world space.
 *
 * A muzzle node's forward is the gun's forward: Refractor +Z, glTF -Z —
 * wing-gun convergence is already in the node's rotation. The platform's own
 * velocity rides on top, which is the whole difference between a gun bolted
 * to the ground and one bolted to a fighter: fired forward the rounds pull
 * away at the muzzle velocity but cross the ground faster, and fired while
 * yawing they visibly trail the nose.
 *
 * The platform's velocity is added unscaled even when `speedScale` is not 1,
 * because the world around it still runs at real time — but the two do not
 * really mix, and a caller supplying a platform velocity should be firing at
 * the real muzzle velocity too.
 *
 * A group with `aimRay` skips the muzzle transform entirely: the round
 * leaves the caller's origin along the caller's direction, which for a hand
 * weapon is the eye down the camera axis — `fireInCameraDof 1`, the reason
 * a BF1942 rifle hits what the crosshair covers regardless of where the
 * viewmodel's barrel points. `spreadDeg` then wanders the direction inside
 * the deviation cone, on either path.
 */
function muzzleVelocity(guns, muzzle, group, speed, out) {
  const ray = group.aimRay?.();
  if (ray) {
    _origin.set(ray.origin.x, ray.origin.y, ray.origin.z);
    out.set(ray.dir.x, ray.dir.y, ray.dir.z).normalize();
  } else {
    muzzle.updateWorldMatrix(true, false);
    muzzle.getWorldPosition(_origin);
    muzzle.getWorldQuaternion(_aim);
    out.set(0, 0, -1).applyQuaternion(_aim);
  }
  const spread = group.spreadDeg?.() || 0;
  if (spread > 0) wander(guns, out, spread);
  // On the ray path `_aim` still has to say which way the round points — a
  // bazooka's drawn rocket takes its first-frame orientation from it — and
  // it is taken after the wander so the rocket points where it is going.
  if (ray) _aim.setFromUnitVectors(_minusZ, out);
  out.multiplyScalar(speed);
  const platform = group.platformVelocity?.();
  if (platform) out.add(platform);
  return out;
}

/**
 * Rotate `dir` to a random direction inside a cone of `degrees` half-angle.
 *
 * The polar angle is `spread x sqrt(u)` — uniform over the cone's cross
 * section rather than over its rim or its axis, so a burst paints a disc the
 * way a target card looks, not a ring and not a hot centre. The azimuth is
 * free. Both draws come from `guns.rand`, the same authority the flash
 * roll already answers to — `Math.random` unless a check has seeded it.
 */
function wander(guns, dir, degrees) {
  const theta = degrees * (Math.PI / 180) * Math.sqrt(guns.rand());
  const phi = guns.rand() * Math.PI * 2;
  // An orthonormal frame around the direction of fire. The up reference
  // flips to +X when the shot is near-vertical, where up and dir would be
  // parallel and the cross product degenerate.
  _spreadU.set(0, 1, 0);
  if (Math.abs(dir.y) > 0.99) _spreadU.set(1, 0, 0);
  _spreadU.cross(dir).normalize();
  _spreadV.crossVectors(dir, _spreadU);
  const sin = Math.sin(theta);
  dir.multiplyScalar(Math.cos(theta))
    .addScaledVector(_spreadU, sin * Math.cos(phi))
    .addScaledVector(_spreadV, sin * Math.sin(phi));
  return dir;
}

function displaySpeed(guns, group, velocity) {
  return velocity > PROJECTILE_SCALE_CUTOFF ? velocity * group.speedScale : velocity;
}

function spawnTracer(guns, muzzle, group, bright) {
  const speed = displaySpeed(guns, group, group.stats.velocity || 100);
  // The velocity is the round's own for as long as it flies, so it is a
  // real allocation per shot; the unit direction is only needed to point
  // the streak and lives in scratch.
  const velocity = muzzleVelocity(guns, muzzle, group, speed, new THREE.Vector3());
  const direction = _direction.copy(velocity).normalize();
  // `setTracerTemplate` points at `Tracer_Projectile`, whose `tracerScaler
  // 50` scales `TLight_m1` (a 0.0061 m spike trailing 1 m behind the round)
  // bodily — the game's tracer is a 50 m streak 0.3 m across, and that size
  // is the only reason a round travelling 6.7 m per frame reads as anything
  // at all. A 50 m streak leaving a model on a turntable runs off the stage,
  // so the browser keeps its 1..4 m stand-in and the world path takes the
  // data.
  const scaler = group.stats.tracer?.scaler ?? 50;
  const data = group.tracerLength === 'data';
  let mesh;
  let pool;
  let lengthScale = 0;   // non-zero only for the baked streak
  if (group.tracerMesh && bright) {
    // The real streak. Its head sits at the mesh origin and the taper runs
    // back along +Z (Refractor's -Z, mirrored by the exporter), so pointing
    // the node's -Z down the line of flight leaves the tail behind the round
    // where it belongs — no half-length offset, unlike the centred cylinder.
    pool = group.tracerMeshPool;
    mesh = pool.pop() || group.tracerMesh.clone();
    mesh.visible = true;
    // Scaled uniformly: `tracerScaler` is one number, and reading it as
    // length alone leaves the streak 6 mm wide — a fifty-metre thread.
    // `advance` then widens the cross-section if the streak would otherwise
    // fall under TRACER_MIN_SCREEN_PX.
    lengthScale = data ? Math.max(scaler, 1) : Math.max(scaler * 0.04, 1);
    mesh.scale.setScalar(lengthScale);
    mesh.position.copy(_origin);
    mesh.lookAt(_aimBack.copy(mesh.position).add(direction));
  } else {
    const length = data
      ? Math.max(scaler, 1)
      : Math.min(Math.max(scaler * 0.04, 1), 4);
    mesh = guns.tracerPool.pop() || new THREE.Mesh(tracerGeometry, tracerMaterial);
    mesh.visible = true;   // recycled meshes are parked hidden
    mesh.material = bright ? tracerMaterial : shellMaterial;
    mesh.scale.set(1, 1, length);
    mesh.position.copy(_origin).addScaledVector(direction, length / 2);
    mesh.lookAt(_aimBack.copy(mesh.position).add(direction));
    pool = guns.tracerPool;
  }
  adopt(guns, mesh);
  guns.tracers.push({
    mesh,
    pool,
    group,
    lengthScale,
    width: group.tracerWidth,
    bright,
    velocity,
    // Distance from the drawn mesh's origin to the round it stands for. The
    // baked streak's head *is* its origin; the stand-in cylinder is drawn
    // centred, so its round is half a length ahead of `mesh.position`.
    lead: lengthScale ? 0 : (mesh.scale.z || 0) / 2,
    // How long the streak lives. `fixed` is the turntable policy — a tracer
    // stays on screen about 1.5 s or 250 m, tuned against rounds already
    // slowed to 15% — and stays the model browser's default. `data` is the
    // round's own declared `timeToLive`: a `CorsairProjectile` lives 1.5 s
    // and the `Tracer_Projectile` that replaces every third round lives 3,
    // and the tracer is the object actually in flight, so it is the one
    // whose clock runs.
    ttl: group.roundLifetime === 'data'
      ? ((bright ? group.stats.tracer?.timeToLive : null)
         ?? group.stats.projectile?.timeToLive ?? TRACER_MAX_AGE)
      : TRACER_MAX_AGE,
    maxRange: group.maxRange,
    age: 0,
    travelled: 0,
    // Where the round left: `FireArms::fireBarrel`'s `Projectile+0x134`,
    // the point a hit's damage arc looks at (ledger HFD-4).
    origin: [_origin.x, _origin.y, _origin.z],
  });
}

/**
 * This round's `timeToLive`, drawn the way the engine draws it.
 *
 * `Projectile::activate` (lnxded 0x0831e120) samples the template's CRD per
 * round (`Random::getContinuousRandom`) and posts the expiry message at that
 * delay; `handleMessage` (0x0831e8f0) then detonates a `hasOnTimeEffect`
 * round and quietly recycles any other. The baked block keeps only the CRD's
 * first number, so without the table's full CRD every AA shell burst at
 * exactly 0.8 s, 240 m out, the "same distance every time" of the report.
 * With it the AA gun's `CRD_UNIFORM/0.8/1.4/0` spreads them over 240-420 m.
 */
function launchTimeToLive(guns, spec, entry) {
  if (Array.isArray(entry?.timeToLive)) {
    const drawn = sampleCrd(entry.timeToLive, guns.rand);
    if (drawn > 0) return drawn;
  }
  return spec.timeToLive;
}

function spawnProjectile(guns, muzzle, group, spec) {
  // `releaseSpeed` is `velocity ?? 100`, not `velocity || 100`. Every one of
  // the thirteen vanilla aircraft racks declares `velocity 0`, which is a real
  // authored value meaning "the round leaves at no speed of its own"; `||`
  // read it as absent and launched a released bomb forward at 100 m/s
  // (ledger BOMB-8). At zero the muzzle transform contributes nothing and
  // `muzzleVelocity` returns `group.platformVelocity` alone — the aircraft's
  // own motion, which is the whole of a bomb release.
  const authored = releaseSpeed(group.stats);
  const speed = displaySpeed(guns, group, authored);
  const velocity = muzzleVelocity(guns, muzzle, group, speed, new THREE.Vector3());
  let mesh = group.projectilePool.pop();
  if (!mesh) {
    if (group.projectileMesh.quaternion &&
        (Math.abs(group.projectileMesh.quaternion.x) > 1e-4 ||
         Math.abs(group.projectileMesh.quaternion.y) > 1e-4 ||
         Math.abs(group.projectileMesh.quaternion.z) > 1e-4 ||
         Math.abs(group.projectileMesh.quaternion.w - 1) > 1e-4)) {
      const container = new THREE.Group();
      const inner = group.projectileMesh.clone();
      inner.position.set(0, 0, 0);
      inner.visible = true;
      container.add(inner);
      mesh = container;
    } else {
      mesh = group.projectileMesh.clone();
    }
  }
  mesh.visible = true;
  mesh.traverse(o => { o.visible = true; });
  mesh.scale.setScalar(1);
  mesh.position.copy(_origin);
  // The baked body was Z-mirrored like every vehicle mesh, so its nose
  // points down -Z — the muzzle's own forward.
  mesh.quaternion.copy(_aim);
  adopt(guns, mesh);
  // A **fuse** round (HP-9d, HP-9e): end-of-life explosion, no impact
  // explosion, and — the condition that is easy to drop — it survives
  // contact. Vanilla's are exactly the two grenades, the explosives pack and
  // the landmine; the three flak shells pass the first two and fail the
  // third. Contact must neither detonate a fuse round nor end it, or its
  // only blast is deleted and a grenade thrown into the open does nothing at
  // all, which is what this viewer did until now. `isFuseRound` in
  // `effects-core.js` carries the rule and the addresses.
  const fuse = isFuseRound(spec?.damage);
  const entry = guns.projectileEntry(spec);
  const shot = {
    mesh,
    group,
    velocity,
    kind: spec.kind,
    // Shells fall (`gravityModifier` defaults to 1); rockets are carried by
    // their motor and fly flat here.
    gravity: spec.kind === 'shell' ? (spec.gravity ?? 1) : 0,
    // `speedScale` slows a fast round for legibility, and a round slowed in
    // speed alone is not slowed in *time*: it spends 1/scale as long over
    // every metre, so a full-strength g bends its path by 1/scale^2 more than
    // the engine bends it. Scaling g by the square is what makes the slowed
    // round draw the same shape as the real one, just later. 1 wherever the
    // round flies at its authored speed, which is every round on the map page
    // (`speedScale: 1`) and every round under the browser's 150 m/s cutoff —
    // so this is inert for tank guns and live only for the five naval guns
    // fast enough to be scaled and heavy enough to fall.
    // 1 at a zero release: there is no speed scaling to compensate for when
    // the round leaves at no speed of its own, and `0 / 0` is NaN — which
    // would have silently deleted gravity from every bomb in the game.
    gravityScale: authored > 0 ? (speed / authored) ** 2 : 1,
    // The engine's own drag law needs the body's frontal area over its mass,
    // and the radius is `getBoundingRadius` — nothing exports it, so it is
    // measured off the drawn body's geometry once per group (`collect`).
    boundingRadius: group.boundingRadius,
    // Set on the first water contact a `detonateOnWaterCollision 0` round is
    // allowed to survive; from then on `TorpedoRun` replaces the ballistic
    // step. Null for everything else, which in vanilla is everything but the
    // aircraft torpedo.
    torpedo: null,
    wake: null,
    // A fuse round runs its authored fuse; everything else is held to the
    // viewer's own flight ceiling. `roundTimeToLive` carries why — in short,
    // the ceiling was written when `timeToLive` only recycled a mesh, and
    // clamping an explosives pack's 240 s to 20 s now drops 12 m of real
    // splash on the player twenty seconds after he puts the charge down.
    ttl: roundTimeToLive(launchTimeToLive(guns, spec, entry), spec?.damage),
    trail: group.trailQuad ? spec.trail : null,
    // The proximity fuse (`proximity-fuse.js`), or null: the flak shells'
    // `explodeNearEnemyDistance 10` is what bursts them on the aircraft they
    // pass rather than in the sky behind it.
    proximity: proximityFuseOf(spec, entry),
    run: null,
    age: 0,
    travelled: 0,
    // `Projectile+0x134`, as on a tracer (ledger HFD-4).
    origin: [_origin.x, _origin.y, _origin.z],
    sincePuff: 0,
    fuse,
    // Set when a fuse round has come to rest on a surface; see `advance`.
    resting: false,
    // The round's authored spin, radians per second about its own X, from the
    // throwing weapon's `rotationalSpeed` — `8/0/0` on both grenades and on
    // nothing else in vanilla, which is why a thrown grenade tumbles and a
    // landmine does not. `PointPhysicsNode::updatePhysics` (lnxded
    // 0x082562c0) integrates one scalar rate into one accumulated angle, so
    // only the first component is the engine's; the UNIT is unverified (see
    // features/grenade-viewmodel-and-throw). Read as radians it is 1.3
    // turns a second, which is what a thrown grenade does; read as degrees
    // it would be 2.2 degrees a second, which is nothing.
    spin: group.stats.throw?.rotationalSpeed?.[0] || 0,
    spun: 0,
    // The flattened direction of travel, kept for `layOnSurface`: a round
    // that has stopped has no velocity left to face along, and the last
    // heading it had is the one the game leaves it lying on.
    heading: fuse ? new THREE.Vector3(0, 0, -1) : null,
    // The rigid-body contact a fuse round gets. The engine's four fuse
    // rounds all declare `setHasPointPhysics 0` and so take the real
    // `ResponsePhysics` path, where the restitution comes off the material
    // pair rather than out of thin air. `spec.material` is the round's own
    // `ObjectTemplate.material` — 70 for both grenades, which is the only
    // material in vanilla with an elasticity, and the whole reason a grenade
    // stops its into-surface velocity dead where a landmine keeps half.
    body: fuse
      ? new FuseRoundBody({
          material: contactMaterialFor(spec?.template,
                                       guns.attackerMaterial(spec)),
          materials: guns.materials,
          gravity: GRAVITY * (spec.gravity ?? 1),
        })
      : null,
  };
  // The authored trail — `e_rocketFume` riding the bazooka round as an
  // `addTemplate` child: a looping smoke emitter at 100/s whose puffs
  // inherit the rocket's 50 m/s and `drag 20` to a stop, and a motor flame
  // that burns out after a second. Attached, so the bundle's frame is the
  // round's own each frame. The single-sprite stand-in stays for GLBs and
  // pages without the library.
  if (guns.effects && spec.trailBundle && guns.effects.has(spec.trailBundle)) {
    shot.run = guns.effects.play(spec.trailBundle, {
      attach: { object: mesh, velocity: () => shot.velocity },
    });
    if (shot.run) shot.trail = null;
  }
  guns.projectiles.push(shot);
}
