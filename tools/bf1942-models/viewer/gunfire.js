// Firing a Refractor FireArms: muzzle flash, tracers, projectiles, recoil.
//
// A FireArms template is the gun a seat fires. The extractor stamps its node
// with `fireArms` (roundOfFire in rounds/second, velocity, magSize, tracer
// interval, recoil, a typed `projectile` dict), hangs a mesh-less `muzzle` node
// per barrel (a plane's wing guns carry their authored convergence there), and
// bakes the additive emitters of the flash EffectBundle — plus the projectile's
// drawn body and trail sprite, when it has them — as hidden tagged nodes. This
// module strobes the emitters per shot, replays their authored sizeOverTime /
// colorRGBAOverTime ramps over each one's timeToLive, and flies what the gun
// actually launches: tracer streaks on tracer rounds for bullets, the baked
// mesh for shells and rockets.
//
// It was written inside `index.html` for the model browser, which fires a
// stationary model on a turntable, and lifted out here when the map flythrough
// grew a flyable Corsair. Two things had to change to make it work from
// something doing 55 m/s, and both are options rather than branches:
//
//   - `platformVelocity`. A round leaves the muzzle at the gun's velocity
//     *plus* the aircraft's. Without it a Corsair firing while diving flies
//     through its own tracer stream.
//   - `speedScale`. The browser slows fast rounds to 15% (`TRACER_SPEED_SCALE`)
//     because a 400 m/s round crosses a parked model between two frames and
//     reads as a strobe. From a cockpit the round's *relative* motion is the
//     picture, and it is already legible, so the flown path fires at the real
//     400 m/s and lets `timeToLive` end the round instead of a range cap.
//
// Everything the two pages share stayed shared, including the bug this port
// fixed: see `fireShot` on muzzle alternation.

import * as THREE from 'three';
import { impactEffect, materialFamily } from './collision.js';

// Real muzzle velocities (400-1000 m/s) cross a parked model between two
// frames; scaled down so a burst reads as a stream instead of a strobe.
// Slow rounds (a Katyusha rocket leaves at 45 m/s, a tank shell at 100) are
// already watchable and fly at their real speed.
export const TRACER_SPEED_SCALE = 0.15;
export const PROJECTILE_SCALE_CUTOFF = 150;  // m/s; below this, no scaling
export const TRACER_MAX_AGE = 1.5;      // seconds, when the data declares none
export const TRACER_MAX_RANGE = 250;    // metres of travel before recycling
// `recoilSize 3` as 3 m of barrel travel is not a picture; a tenth reads as
// a gun. Recovery runs at the same scale so size/speed keeps the engine's
// ratio (Sherman: 0.3 m kick recovered in 0.3 s).
export const RECOIL_KICK_SCALE = 0.1;
// `fx_MuzzHeavy` ramps sizeOverTime 0.12 -> 9.4 on a mesh already 1.76 m
// long: replayed as absolute node scale that is a 16.5 m fireball. In game
// the late ramp plays on particles that have left the muzzle; parked here,
// the scale gets a lid instead.
export const FLASH_RAMP_MAX = 3;
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
const GRAVITY = 9.81;
const TRAIL_PUFF_SPACING = 0.9;  // metres of flight between smoke puffs
const MAX_TRAIL_PUFFS = 96;
// Per-frame lid on collision queries. `features/flyable-vehicles/collision-and-crash.md`
// budgets the swept narrowphase at 0.1-0.3 ms worst case for one body; a held
// burst from a twelve-round-a-second gun keeps tens of rounds in the air, and
// this caps the whole loop at that same order. Rounds past the lid keep flying
// and are tested next frame — they do not tunnel, because the untested step is
// carried forward into the segment the next frame casts.
const MAX_CASTS_PER_FRAME = 192;
// How long an impact stand-in lives, by surface family. The authored bundles
// declare `timeToLive CRD_NONE/1.8/0/0` almost uniformly; these are shorter
// because a flat billboard holding for 1.8 s reads as a decal, not a burst.
const IMPACT_TTL = 0.45;
const IMPACT_WATER_TTL = 0.8;
const MAX_IMPACTS = 48;

// Fallback streak, for a GLB baked before the tracer mesh was exported. The
// game's own `TLight_m1` is a tapered 0.0061 m spike trailing 1 m behind the
// round, scaled bodily by the projectile's `tracerScaler` (50 for every vanilla
// MG) — so the real thing is 0.3 m across, not 0.02. Two centimetres at the
// Corsair's 116 m convergence subtends a quarter of a pixel at 60 deg FOV over
// 1100 px, which is exactly the "barely visible little lines" this replaced.
const tracerGeometry = new THREE.CylinderGeometry(0.01, 0.01, 1, 6, 1, true);
tracerGeometry.rotateX(Math.PI / 2);   // length along Z so lookAt aims it
export const tracerMaterial = new THREE.MeshBasicMaterial({
  color: 0xffd9a0, transparent: true, opacity: 0.9,
  blending: THREE.AdditiveBlending, depthWrite: false,
});
// Legacy manifests only (fireArms.projectile still a bare template name):
// rounds between tracers show as a dim streak. Typed manifests draw nothing
// between tracer rounds, like the game.
const shellMaterial = new THREE.MeshBasicMaterial({
  color: 0xc9b89a, transparent: true, opacity: 0.4,
  blending: THREE.AdditiveBlending, depthWrite: false,
});

// The impact stand-in.
//
// Refractor answers "what does this hit look like" out of the MaterialManager:
// `setEffectTemplate` names one of 73 authored EffectBundles per (attacker,
// defender) pair, and `collision.js` resolves the name. Playing the bundle
// itself needs its emitters, sprites and sounds baked into the level glb the
// way the muzzle flashes already are, and that is an extractor job this pass
// did not do — see the "still missing" section of
// `features/bf1942-3d-models/projectile-collision.md`.
//
// So: one soft additive puff, expanding and fading, stood up on the surface
// normal, tinted by the material family the hit resolved to. It is a marker
// that the round stopped and where, not a reconstruction of the effect. The
// resolved bundle name rides along on the impact record so a check can assert
// the *selection* is right even though the drawing is a placeholder.
const IMPACT_TINTS = {
  ground: 0xc8ab7a,   // dust off dirt and sand
  water:  0xdff0ff,   // spray
  stone:  0xbdb6ab,   // grit and concrete dust
  metal:  0xffc98a,   // sparks
  wood:   0xa8834f,   // splinters
  armour: 0xffd07a,   // the armour flash bundles are all fire-coloured
};

let impactTexture = null;
function softDisc() {
  // A radial falloff drawn once. Additive, so the centre is the bright core
  // and the rim goes to black rather than to transparent.
  if (impactTexture) return impactTexture;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(
    size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  impactTexture = new THREE.CanvasTexture(canvas);
  impactTexture.colorSpace = THREE.SRGBColorSpace;
  return impactTexture;
}

const impactGeometry = new THREE.PlaneGeometry(1, 1);

/** Piecewise-linear sample of an over-time ramp at `phase` (0..100). */
export function sampleCurve(points, phase) {
  if (phase <= points[0][0]) return points[0].slice(1);
  for (let i = 1; i < points.length; i++) {
    if (phase <= points[i][0]) {
      const [t0, ...v0] = points[i - 1];
      const [t1, ...v1] = points[i];
      const k = t1 === t0 ? 1 : (phase - t0) / (t1 - t0);
      return v0.map((v, j) => v + (v1[j] - v) * k);
    }
  }
  return points[points.length - 1].slice(1);
}

const _origin = new THREE.Vector3();
const _aim = new THREE.Quaternion();
const _billboard = new THREE.Quaternion();
const _spinAxis = new THREE.Vector3(0, 0, 1);
const _drift = new THREE.Vector3();
const _aimBack = new THREE.Vector3();
const _extent = new THREE.Vector3();
const _step = new THREE.Vector3();
const _tip = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/**
 * Every gun in one scene, and the rounds they have in the air.
 *
 * `scene` is where flying things are parented — the world, never the vehicle,
 * or a round would ride along with the aircraft that fired it. `camera` is what
 * billboarded sprites face. `onMaterial` is called with every material this
 * module clones, which is how the model browser keeps its texture-toggle
 * bookkeeping (`originalMap`) outside the material where `Material.clone()`
 * cannot mangle it.
 */
export class GunFire {
  constructor({ scene, camera, onMaterial = null, onShot = null,
                viewportHeight = null } = {}) {
    this.scene = scene;
    this.camera = camera;
    this.onMaterial = onMaterial;
    this.onShot = onShot;
    // Drawing-buffer height in pixels, for the tracer width floor. A callback
    // rather than a number because both pages resize, and the default is right
    // for a canvas that fills the window.
    this.viewportHeight = viewportHeight || (() => window.innerHeight || 800);
    // Which flash the observer gets. Refractor bundles both and marks each
    // with the view it belongs to: from outside, `em_MuzzHeavy`'s 1.76 m mesh
    // ramping to nine times its own length; from the seat, `em_1P_MuzzHeavy`'s
    // 0.4 m sprite. A model on a turntable is always watched from outside, so
    // that is the default; a page that puts the camera in a cockpit sets this.
    this.firstPerson = false;
    this.groups = [];
    this.tracers = [];
    this.projectiles = [];
    this.puffs = [];
    this.tracerPool = [];
    // What a round runs into. A `WorldCollider` from `collision.js`, or null —
    // the model browser fires a model on a turntable with no world around it,
    // and a null collider is exactly the old behaviour: rounds end on their
    // `timeToLive` or the range cap and nothing else.
    this.collider = null;
    // The `attacker -> defender -> EffectBundle` table out of
    // `_shared/damage.json`, and the `projectileTemplate -> attacker material`
    // table beside it. Both optional; without them a hit still stops the round,
    // it just cannot name the effect the game would have played.
    this.damageEffects = null;
    this.projectileMaterials = null;
    this.onImpact = null;
    this.impacts = [];
    this.impactPool = [];
    /** The last few hits, newest first, for the debug readout and headless checks. */
    this.hits = [];
  }

  /** Attacker material for a projectile template, or null. */
  attackerMaterial(spec) {
    if (!spec) return null;
    if (Number.isFinite(spec.material)) return spec.material;
    const table = this.projectileMaterials;
    if (!table || !spec.template) return null;
    const entry = table[spec.template.toLowerCase()];
    return Number.isFinite(entry?.material) ? entry.material : null;
  }

  /** Put every round in the air back in its pool. Call on a scene change. */
  clear() {
    for (const tracer of this.tracers) {
      this.scene.remove(tracer.mesh);
      tracer.mesh.visible = false;
      // Cylinders go back to the shared pool; baked streaks go back to the
      // group they were cloned from, which `collect(replace: true)` then drops
      // along with the group itself.
      tracer.pool.push(tracer.mesh);
    }
    this.tracers.length = 0;
    // Projectile and puff meshes are clones of the outgoing model's baked
    // nodes; drop them rather than pooling across models.
    for (const shot of this.projectiles) this.scene.remove(shot.mesh);
    this.projectiles.length = 0;
    for (const puff of this.puffs) this.scene.remove(puff.mesh);
    this.puffs.length = 0;
    for (const impact of this.impacts) {
      this.scene.remove(impact.mesh);
      impact.mesh.visible = false;
      this.impactPool.push(impact.mesh);
    }
    this.impacts.length = 0;
    this.hits.length = 0;
  }

  /**
   * Index every FireArms under `root` and return the groups found.
   *
   * `replace` (the default) is the model browser's contract: one model at a
   * time, so a new one clears the last. The map flythrough collects one flown
   * vehicle out of a scene of many and passes `replace: false` so a second
   * vehicle does not evict the first.
   */
  collect(root, options = {}) {
    const {
      replace = true,
      hideEffects = true,
      speedScale = TRACER_SPEED_SCALE,
      maxRange = TRACER_MAX_RANGE,
      roundLifetime = 'fixed',
      tracerLength = 'fixed',
      platformVelocity = null,
    } = options;
    if (replace) {
      this.clear();
      this.groups.length = 0;
    }
    const found = [];
    if (hideEffects) {
      // Every baked effect stays dark until a shot strobes it — this also parks
      // non-gun effects (water-touch planes, shell ejects on unarmed variants).
      // Projectile bodies and trail sprites are spawn templates, never drawn
      // in place.
      root.traverse(obj => {
        if (obj.userData?.effect || obj.userData?.projectileMesh
            || obj.userData?.projectileTrail
            || obj.userData?.tracerMesh) obj.visible = false;
      });
    }
    root.traverse(obj => {
      const stats = obj.userData?.fireArms;
      if (!stats) return;
      const muzzles = [];
      const emitters = [];
      let projectileMesh = null;
      let trailQuad = null;
      let tracerMesh = null;
      obj.traverse(node => {
        if (node.userData?.muzzle) muzzles.push(node);
        if (node.userData?.projectileMesh) projectileMesh = node;
        if (node.userData?.projectileTrail) trailQuad = node;
        if (node.userData?.tracerMesh) tracerMesh = node;
        const spec = node.userData?.effect;
        if (!spec || spec.kind === 'bundle') return;
        // Emitter materials are shared through the exporter's cache (both wing
        // flashes, or two seats' glows, reference one material); tinting a
        // shared one would flash every gun at once. Clone per emitter.
        const materials = [];
        node.traverse(part => {
          if (!part.isMesh) return;
          const cloned = [part.material].flat().map(m => {
            const clone = m.clone();
            // glTF has no additive blend mode, so the exporter marks the
            // flash's materials in extras and GLTFLoader lands that in
            // userData. The model browser applies it to the whole model at
            // load; the map path never did, and its own dynamic-shading pass
            // rebuilds vehicle materials from scratch — so the mark is
            // honoured here too, where both pages go through.
            if (clone.userData?.additive) {
              clone.blending = THREE.AdditiveBlending;
              clone.transparent = true;
              clone.depthWrite = false;
              clone.needsUpdate = true;
            }
            this.onMaterial?.(clone);
            materials.push(clone);
            return clone;
          });
          part.material = cloned.length === 1 ? cloned[0] : cloned;
        });
        emitters.push({
          node, spec, materials, age: Infinity, spin: 0,
          // Which barrel this flash belongs to, so only the barrel that fired
          // lights up. Null for a flash hung off the FireArms itself by
          // `addTemplate` (the Sherman's `e_MuzzPanz`), which fires every shot.
          muzzle: ancestorMuzzle(node, obj),
          // Authored placement, kept aside so drift along the direction of
          // fire (offsetInDof + speedInDof x age) and billboarding never
          // accumulate into the node's own transform.
          basePos: node.position.clone(),
          baseQuat: node.quaternion.clone(),
        });
      });
      // Bomb racks declare no flash, no tracer and no recoil: nothing to show.
      if (!emitters.length && !stats.tracer && !stats.recoil
          && !(stats.velocity > 0)) return;
      // The template's cross-section, measured once, so the width floor is
      // expressed against real metres rather than a guess at what a tracer mesh
      // is shaped like. Measured on the *geometry*, in the streak's own frame:
      // `Box3.setFromObject` works in world space, and the AABB of a thin spike
      // rotated by the airframe reads 0.42 m across instead of its real 0.0061,
      // which silently pinned the floor below the streak's own scale.
      let tracerWidth = 0;
      if (tracerMesh) {
        tracerMesh.traverse(part => {
          if (!part.isMesh || !part.geometry) return;
          if (!part.geometry.boundingBox) part.geometry.computeBoundingBox();
          const size = part.geometry.boundingBox.getSize(_extent);
          tracerWidth = Math.max(tracerWidth, size.x, size.y);
        });
        // The streak's own `.rs` says `blendDest one` and `depthWrite false`,
        // and the exporter carries both through as the same `additive` extras
        // flag the flash emitters use. Applied once on the template rather than
        // per clone: every round of a gun looks identical, so unlike a flash
        // (tinted per shot by its colour ramp) there is nothing to keep apart,
        // and one shared material is one draw-call state change.
        tracerMesh.traverse(part => {
          if (!part.isMesh) return;
          for (const material of [part.material].flat()) {
            if (!material.userData?.additive) continue;
            material.blending = THREE.AdditiveBlending;
            material.transparent = true;
            material.depthWrite = false;
            material.needsUpdate = true;
          }
        });
      }
      // The recoil path poses the gun node from its authored rest position.
      // The model browser stamps `home` on every node at load for its explode
      // slider; the map path does not, so take it here when it is missing.
      if (!obj.userData.home) obj.userData.home = obj.position.clone();
      const group = {
        node: obj,
        stats,
        muzzles: muzzles.length ? muzzles : [obj],
        emitters,
        projectileMesh,
        trailQuad,
        tracerMesh,
        tracerWidth,
        projectilePool: [],
        puffPool: [],
        tracerMeshPool: [],
        firing: false,
        cooldown: 0,
        shots: 0,
        // Which placed object this gun is part of, so its own rounds ignore its
        // own hull. Resolved lazily against whatever collider is in force —
        // see `#owner` — because a level switch replaces both.
        owner: -1,
        ownerFor: undefined,
        speedScale,
        maxRange,
        roundLifetime,
        tracerLength,
        platformVelocity,
        // 1 = barrel home; a shot resets to 0 and it eases forward again.
        recoil: stats.recoil ? 1 : null,
      };
      this.groups.push(group);
      found.push(group);
    });
    return found;
  }

  /** Hold or release the trigger. Idempotent, so it can be driven per frame. */
  setFiring(group, on) {
    if (!group || group.firing === !!on) return false;
    group.firing = !!on;
    if (group.firing) group.cooldown = 0;   // first round leaves immediately
    return true;
  }

  /**
   * One round.
   *
   * Barrels take turns. Refractor cycles `addFireArmsPosition` entries one per
   * round rather than volleying them, and the shipped data settles it without
   * touching the binary: `KatyushaFireArmsBundle` declares six positions,
   * `magSize 6` and `roundOfFire 1` — six rails, six rockets, one a second,
   * which is the ripple the launcher actually fires. Volleying would empty a
   * six-round magazine as thirty-six rockets. `Elco80_Torpedos` says the same
   * thing smaller: two tubes, `magSize 2`. The model browser volleyed, so a
   * Corsair fired 24 rounds a second out of a 12 rps gun; it alternates now.
   */
  fireShot(group) {
    group.shots += 1;
    this.onShot?.(group);
    const muzzle = group.muzzles[(group.shots - 1) % group.muzzles.length];
    // An emitter with no declared `view` is drawn in both, which is 341 of
    // vanilla's 364 — and it is also what a glb baked before the flag was
    // exported looks like, so a stale asset behaves exactly as it used to.
    const view = this.firstPerson ? 'first' : 'third';
    for (const emitter of group.emitters) {
      if (emitter.spec.view && emitter.spec.view !== view) continue;
      if (emitter.muzzle && emitter.muzzle !== muzzle) continue;
      emitter.age = 0;
      emitter.node.visible = true;
      // The engine rolls each flash particle (`startRotation CRD_UNIFORM
      // 0/180`), which is what keeps a held burst from looking like one frame.
      emitter.spin = Math.random() * Math.PI * 2;
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
      this.#spawnProjectile(muzzle, group, spec);
    } else if (spec && spec.kind === 'bullet') {
      // The game draws nothing between tracer rounds — a Spitfire's
      // projectile has no geometry at all, and only every traceInterval-th
      // round carries the TLight streak.
      if (tracerRound) this.#spawnTracer(muzzle, group, true);
    } else if (group.stats.velocity > 0) {
      // Stale GLB (`projectile` is a bare template name, or the drawn body
      // failed to bake): the old streak per round.
      this.#spawnTracer(muzzle, group, tracerRound);
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
   */
  #muzzleVelocity(muzzle, group, speed, out) {
    muzzle.updateWorldMatrix(true, false);
    muzzle.getWorldPosition(_origin);
    muzzle.getWorldQuaternion(_aim);
    out.set(0, 0, -1).applyQuaternion(_aim).multiplyScalar(speed);
    const platform = group.platformVelocity?.();
    if (platform) out.add(platform);
    return out;
  }

  #displaySpeed(group, velocity) {
    return velocity > PROJECTILE_SCALE_CUTOFF ? velocity * group.speedScale : velocity;
  }

  #spawnTracer(muzzle, group, bright) {
    const speed = this.#displaySpeed(group, group.stats.velocity || 100);
    const velocity = this.#muzzleVelocity(muzzle, group, speed, new THREE.Vector3());
    const direction = velocity.clone().normalize();
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
      mesh = this.tracerPool.pop() || new THREE.Mesh(tracerGeometry, tracerMaterial);
      mesh.visible = true;   // recycled meshes are parked hidden
      mesh.material = bright ? tracerMaterial : shellMaterial;
      mesh.scale.set(1, 1, length);
      mesh.position.copy(_origin).addScaledVector(direction, length / 2);
      mesh.lookAt(_aimBack.copy(mesh.position).add(direction));
      pool = this.tracerPool;
    }
    this.scene.add(mesh);
    this.tracers.push({
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
    });
  }

  #spawnProjectile(muzzle, group, spec) {
    const speed = this.#displaySpeed(group, group.stats.velocity || 100);
    const velocity = this.#muzzleVelocity(muzzle, group, speed, new THREE.Vector3());
    const mesh = group.projectilePool.pop() || group.projectileMesh.clone();
    mesh.visible = true;
    mesh.scale.setScalar(1);
    mesh.position.copy(_origin);
    // The baked body was Z-mirrored like every vehicle mesh, so its nose
    // points down -Z — the muzzle's own forward.
    mesh.quaternion.copy(_aim);
    this.scene.add(mesh);
    this.projectiles.push({
      mesh,
      group,
      velocity,
      kind: spec.kind,
      // Shells fall (`gravityModifier` defaults to 1); rockets are carried by
      // their motor and fly flat here.
      gravity: spec.kind === 'shell' ? (spec.gravity ?? 1) : 0,
      ttl: Math.min(spec.timeToLive || 10, 20),
      trail: group.trailQuad ? spec.trail : null,
      age: 0,
      travelled: 0,
      sincePuff: 0,
    });
  }

  #spawnPuff(shot) {
    if (this.puffs.length >= MAX_TRAIL_PUFFS) return;
    const group = shot.group;
    let mesh = group.puffPool.pop();
    const materials = [];
    if (mesh) {
      mesh.traverse(part => {
        if (part.isMesh) materials.push(...[part.material].flat());
      });
    } else {
      // Clone materials so each puff fades on its own; the baked quad's
      // material is shared through the exporter's cache.
      mesh = group.trailQuad.clone();
      mesh.traverse(part => {
        if (!part.isMesh) return;
        const cloned = [part.material].flat().map(m => {
          const clone = m.clone();
          this.onMaterial?.(clone);
          materials.push(clone);
          return clone;
        });
        part.material = cloned.length === 1 ? cloned[0] : cloned;
      });
    }
    mesh.visible = true;
    mesh.position.copy(shot.mesh.position);
    mesh.quaternion.copy(this.camera.quaternion);
    this.scene.add(mesh);
    this.puffs.push({
      mesh, materials, spec: shot.trail, age: 0, pool: group.puffPool,
    });
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
  #sweep(group, position, velocity, step, lead) {
    const collider = this.collider;
    if (!collider || step <= 0 || this.casts >= MAX_CASTS_PER_FRAME) return null;
    const speed = velocity.length();
    if (!(speed > 0)) return null;
    _step.copy(velocity).divideScalar(speed);
    const from = _tip.copy(position)
      .addScaledVector(_step, lead - step);
    this.casts++;
    return collider.cast(from.x, from.y, from.z, _step.x, _step.y, _step.z,
                         step, this.#owner(group));
  }

  /**
   * Which placed object this gun belongs to, so its rounds ignore its own hull.
   *
   * A muzzle sits inside the vehicle's collision mesh — the Tiger's gun barrel
   * starts several metres inside `Tiger_Hull_M1` — so without this every shot
   * would detonate on the firer. Cached per group and invalidated when the
   * collider changes, because resolving it walks the ancestor chain.
   */
  #owner(group) {
    if (group.ownerFor !== this.collider) {
      group.ownerFor = this.collider;
      group.owner = this.collider?.statics?.ownerOf(group.node) ?? -1;
    }
    return group.owner;
  }

  /** Record a hit, name the effect the game would play, and mark the spot. */
  #impact(group, spec, hit) {
    const attacker = this.attackerMaterial(spec);
    const family = materialFamily(hit.material);
    const record = {
      kind: hit.kind,
      material: hit.material,
      family,
      attacker,
      // The authored EffectBundle for this pairing. Named, not played — see the
      // comment on IMPACT_TINTS.
      effect: impactEffect(this.damageEffects, attacker, hit.material),
      point: [hit.x, hit.y, hit.z],
      normal: [hit.nx, hit.ny, hit.nz],
      gun: group.node.name,
      distance: hit.t,
      // Which placed object was struck, against the firer's own. They must
      // never be equal; a gun shooting its own hull is the failure mode that
      // would look like "the guns stopped working" rather than like a bug.
      owner: hit.owner,
      firer: group.owner,
    };
    this.hits.unshift(record);
    if (this.hits.length > 16) this.hits.length = 16;
    this.#spawnImpact(hit, family);
    this.onImpact?.(record, hit);
  }

  #spawnImpact(hit, family) {
    if (this.impacts.length >= MAX_IMPACTS) return;
    let mesh = this.impactPool.pop();
    if (!mesh) {
      mesh = new THREE.Mesh(impactGeometry, new THREE.MeshBasicMaterial({
        map: softDisc(), transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      }));
      this.onMaterial?.(mesh.material);
    }
    mesh.material.color.setHex(IMPACT_TINTS[family] ?? IMPACT_TINTS.ground);
    mesh.material.opacity = 1;
    mesh.visible = true;
    // Lifted off the surface along its normal, the way the engine lifts its own
    // ricochet decals (`relativePositionInUp 0.001` on every `Richo*Decal`
    // emitter) — just further, because this is a billboard and not a decal.
    mesh.position.set(hit.x + hit.nx * 0.15,
                      hit.y + hit.ny * 0.15,
                      hit.z + hit.nz * 0.15);
    mesh.quaternion.copy(this.camera.quaternion);
    mesh.scale.setScalar(0.4);
    this.scene.add(mesh);
    this.impacts.push({
      mesh, age: 0,
      ttl: hit.kind === 'water' ? IMPACT_WATER_TTL : IMPACT_TTL,
      // Spray stands taller than dust; both are markers, neither is authored.
      grow: hit.kind === 'water' ? 5 : 3,
    });
  }

  /** Advance flashes, recoil, firing cadence and rounds. True while active. */
  advance(dt) {
    let active = false;
    // The per-frame collision budget, spent by `#sweep` and reset here.
    this.casts = 0;
    for (const group of this.groups) {
      for (const emitter of group.emitters) {
        if (!emitter.node.visible) continue;
        emitter.age += dt;
        const ttl = emitter.spec.timeToLive || 0.1;
        if (emitter.age >= ttl) {
          emitter.node.visible = false;
          continue;
        }
        active = true;
        const phase = (emitter.age / ttl) * 100;
        // `sizeOverTime` is the absolute size ramp; a bare `size` is the fixed
        // size of particles that declare no ramp. Capped: the ramp's tail was
        // authored for particles streaming away from the muzzle, not for one
        // node parked on it.
        const size = emitter.spec.sizeOverTime
          ? sampleCurve(emitter.spec.sizeOverTime, phase)[0]
          : (emitter.spec.size ?? 1);
        emitter.node.scale.setScalar(Math.min(Math.max(size, 1e-4), FLASH_RAMP_MAX));
        // Emitter motion along the direction of fire: muzzle smoke recedes
        // (`positionalSpeedInDof` -5), glows sit slightly ahead
        // (`relativePositionInDof` 0.2). DOF is the effect frame's Refractor
        // +Z, i.e. local -Z after the exporter's mirror.
        if (emitter.spec.offsetInDof || emitter.spec.speedInDof) {
          const drift = (emitter.spec.offsetInDof ?? 0)
            + (emitter.spec.speedInDof ?? 0) * emitter.age;
          _drift.set(0, 0, -drift).applyQuaternion(emitter.baseQuat);
          emitter.node.position.copy(emitter.basePos).add(_drift);
        }
        if (emitter.spec.colorOverTime) {
          const [r, g, b, a] = sampleCurve(emitter.spec.colorOverTime, phase);
          for (const material of emitter.materials) {
            material.color.setRGB(r / 255, g / 255, b / 255);
            material.opacity = a / 255;
          }
        }
        if (emitter.spec.billboard) {
          // Face the camera, then the per-shot roll about the view axis.
          emitter.node.parent.getWorldQuaternion(_billboard).invert();
          emitter.node.quaternion.copy(_billboard).multiply(this.camera.quaternion)
            .multiply(new THREE.Quaternion().setFromAxisAngle(_spinAxis, emitter.spin));
        }
      }
      if (group.recoil !== null && group.recoil < 1) {
        active = true;
        const recoil = group.stats.recoil;
        const recover = Math.max(recoil.size / (recoil.speed || 10), 0.05);
        group.recoil = Math.min(1, group.recoil + dt / recover);
        const kick = recoil.size * RECOIL_KICK_SCALE * (1 - group.recoil);
        const home = group.node.userData.home;
        if (home) {
          // The barrel mesh was Z-mirrored into glTF, so it points down -Z and
          // recoils along +Z of its own frame.
          const back = new THREE.Vector3(0, 0, kick).applyQuaternion(group.node.quaternion);
          group.node.position.copy(home).add(back);
        }
      }
      if (group.firing) {
        active = true;
        group.cooldown -= dt;
        const period = 1 / (group.stats.roundOfFire || 1);
        while (group.cooldown <= 0) {
          this.fireShot(group);
          group.cooldown += period;
        }
      }
    }
    // Metres per pixel at one metre from the eye; the floor below scales it by
    // the streak's own distance. Recomputed per frame because both the camera
    // and the canvas can change between them.
    const height = Math.max(this.viewportHeight() || 0, 1);
    const metresPerPxAt1m = this.camera?.isPerspectiveCamera
      ? (2 * Math.tan(this.camera.fov * Math.PI / 360)) / height
      : 0;
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tracer = this.tracers[i];
      tracer.age += dt;
      const step = tracer.velocity.length() * dt;
      tracer.travelled += step;
      tracer.mesh.position.addScaledVector(tracer.velocity, dt);
      const struck = this.#sweep(tracer.group, tracer.mesh.position,
                                 tracer.velocity, step, tracer.lead);
      if (struck) {
        // Put the streak's head on the surface before it goes, so the last
        // frame drawn is the round stopping rather than the round past it.
        tracer.mesh.position.set(struck.x, struck.y, struck.z)
          .addScaledVector(_step, -tracer.lead);
        this.#impact(tracer.group, tracer.group.stats.projectile, struck);
        this.scene.remove(tracer.mesh);
        tracer.mesh.visible = false;
        tracer.pool.push(tracer.mesh);
        this.tracers.splice(i, 1);
        continue;
      }
      if (tracer.lengthScale && tracer.width && metresPerPxAt1m) {
        // Hold the cross-section at TRACER_MIN_SCREEN_PX, never below the real
        // mesh. Length keeps its own scale, so a streak stays 50 m long and
        // only stops being a thread.
        const distance = tracer.mesh.position.distanceTo(this.camera.position);
        const floor = (distance * metresPerPxAt1m * TRACER_MIN_SCREEN_PX)
          / tracer.width;
        const across = Math.max(tracer.lengthScale, floor);
        tracer.mesh.scale.set(across, across, tracer.lengthScale);
      }
      if (tracer.age > tracer.ttl || tracer.travelled > tracer.maxRange) {
        this.scene.remove(tracer.mesh);
        tracer.mesh.visible = false;
        tracer.pool.push(tracer.mesh);
        this.tracers.splice(i, 1);
      } else {
        active = true;
      }
    }
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const shot = this.projectiles[i];
      shot.age += dt;
      if (shot.kind === 'rocket') {
        const speed = shot.velocity.length();
        shot.velocity.multiplyScalar((speed + ROCKET_ACCEL * dt) / speed);
      }
      if (shot.gravity) shot.velocity.y -= GRAVITY * shot.gravity * dt;
      const step = shot.velocity.length() * dt;
      shot.travelled += step;
      shot.mesh.position.addScaledVector(shot.velocity, dt);
      // Nose (local -Z) along the velocity, so shells arc over.
      _aimBack.copy(shot.mesh.position).sub(shot.velocity);
      shot.mesh.lookAt(_aimBack);
      const struck = this.#sweep(shot.group, shot.mesh.position,
                                 shot.velocity, step, 0);
      if (struck) {
        shot.mesh.position.set(struck.x, struck.y, struck.z);
        this.#impact(shot.group, shot.group.stats.projectile, struck);
        this.scene.remove(shot.mesh);
        shot.mesh.visible = false;
        shot.group.projectilePool.push(shot.mesh);
        this.projectiles.splice(i, 1);
        continue;
      }
      if (shot.age > shot.ttl || shot.travelled > shot.group.maxRange) {
        this.scene.remove(shot.mesh);
        shot.mesh.visible = false;
        shot.group.projectilePool.push(shot.mesh);
        this.projectiles.splice(i, 1);
        continue;
      }
      active = true;
      if (shot.trail) {
        shot.sincePuff += step;
        while (shot.sincePuff >= TRAIL_PUFF_SPACING) {
          shot.sincePuff -= TRAIL_PUFF_SPACING;
          this.#spawnPuff(shot);
        }
      }
    }
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const puff = this.puffs[i];
      puff.age += dt;
      const spec = puff.spec || {};
      const ttl = spec.timeToLive || 1;
      if (puff.age >= ttl) {
        this.scene.remove(puff.mesh);
        puff.mesh.visible = false;
        puff.pool.push(puff.mesh);
        this.puffs.splice(i, 1);
        continue;
      }
      active = true;
      const phase = (puff.age / ttl) * 100;
      const size = spec.sizeOverTime
        ? sampleCurve(spec.sizeOverTime, phase)[0]
        : (spec.size ?? 1);
      puff.mesh.scale.setScalar(Math.max(size, 1e-4));
      puff.mesh.quaternion.copy(this.camera.quaternion);
      if (spec.colorOverTime) {
        const [r, g, b, a] = sampleCurve(spec.colorOverTime, phase);
        for (const material of puff.materials) {
          material.color.setRGB(r / 255, g / 255, b / 255);
          material.opacity = a / 255;
        }
      } else {
        for (const material of puff.materials) {
          material.opacity = 1 - phase / 100;
        }
      }
    }
    for (let i = this.impacts.length - 1; i >= 0; i--) {
      const impact = this.impacts[i];
      impact.age += dt;
      if (impact.age >= impact.ttl) {
        this.scene.remove(impact.mesh);
        impact.mesh.visible = false;
        this.impactPool.push(impact.mesh);
        this.impacts.splice(i, 1);
        continue;
      }
      active = true;
      const phase = impact.age / impact.ttl;
      // Fast out, slow fade: the burst is over long before the dust is.
      impact.mesh.scale.setScalar(0.4 + impact.grow * Math.sqrt(phase));
      impact.mesh.material.opacity = (1 - phase) ** 2;
      impact.mesh.quaternion.copy(this.camera.quaternion);
    }
    return active;
  }
}

/** The `muzzle` node `node` hangs off, searching no further than `stop`. */
function ancestorMuzzle(node, stop) {
  for (let n = node; n && n !== stop; n = n.parent) {
    if (n.userData?.muzzle) return n;
  }
  return null;
}
