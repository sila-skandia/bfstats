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
import { damageFactor, diesOnContact, IMPACT_BLAST_OFFSET,
         splashSpec } from './effects-core.js';
// The world's downward acceleration, signed, taken from the module that owns
// it rather than declared again here. It is -14.73 m/s^2 and not Earth's
// -9.81: `BasicPhysicsSystem`'s constructor at `0x00578f00` writes 0xC16BAE14
// into the gravity field and no vanilla `.con` overrides it. This file carried
// its own 9.81 until the client was read, which flew every shell, bomb and
// torpedo under two thirds of the gravity the game drops them under.
// `physics.js` imports nothing, so taking the constant from there costs this
// module no new dependency beyond the one line.
import { GRAVITY } from './physics.js';

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

// The impact stand-in — a debug affordance, off by default.
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
// that the round stopped and where, not a reconstruction of the effect — and
// against the game's authored bursts it reads as an invented puff, so it is
// drawn only when `impactMarkers` is set (`?impacts=debug` on the map page).
// The hit itself is always recorded, and the resolved bundle name rides along
// on the impact record so a check can assert the *selection* is right even
// when nothing is drawn.
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
const _minusZ = new THREE.Vector3(0, 0, -1);
const _spreadU = new THREE.Vector3();
const _spreadV = new THREE.Vector3();
const _billboard = new THREE.Quaternion();
const _spinAxis = new THREE.Vector3(0, 0, 1);
const _drift = new THREE.Vector3();
const _aimBack = new THREE.Vector3();
const _extent = new THREE.Vector3();
const _step = new THREE.Vector3();
const _tip = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
// Scratch for the per-frame and per-shot paths below: a flash's roll, a
// gun's recoil offset and a round's unit direction were each a fresh
// allocation before, per emitter per frame and per shot, and a frame that
// allocates is a frame that will pay for it at the collector's convenience
// (features/mesh-viewer-performance, rule 5).
const _spin = new THREE.Quaternion();
const _recoil = new THREE.Vector3();
const _direction = new THREE.Vector3();

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
    // `damage.json`'s materials table, for the base damage a round does
    // (`MaterialManager.materialDamage` on the attacker's material) before
    // the projectile's own distance falloff.
    this.materials = null;
    // `damage.json`'s `damageMod` matrix, attacker group -> defender group.
    // This is the term that makes a rifle round bounce off a Tiger and a
    // Panzerfaust open it: `bf42/damage.py`'s own docstring gives the engine's
    // formula as `materialDamage(att) * damageMod(att, def) * cos(angle) *
    // distanceMod`, and until this table was wired the record carried only the
    // first and last of those four.
    this.modifiers = null;
    // An `EffectPlayer` (effects.js) holding the baked impact library. With
    // one set, a hit plays the authored bundle the material table names —
    // the ricochet burst, the dust, the bullet-hole decal — and a projectile
    // that declares a trail bundle drags the real one. Null keeps the old
    // behaviour: the hit is recorded and the debug disc, if enabled, marks it.
    this.effects = null;
    // Draw the tinted impact stand-in discs. False everywhere by default:
    // hits are recorded and reported either way, but the disc is a debug
    // marker, not the authored effect, and until the EffectBundles are baked
    // an un-asked-for puff is an invention. The map page flips this on under
    // `?impacts=debug`.
    this.impactMarkers = false;
    this.onImpact = null;
    this.impacts = [];
    this.impactPool = [];
    /** The last few hits, newest first, for the debug readout and headless checks. */
    this.hits = [];
    // The dice for the spread cone and the flash roll, the module's own the
    // way `EffectPlayer.rand` is: a headless check seeds these two and
    // nothing else. Seeding `Math.random` itself would also seed three's
    // UUIDs, so a build that clones one material more or less per pool miss
    // would fire a different burst and fail a pixel diff for no reason.
    this.rand = Math.random;
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
    for (const shot of this.projectiles) shot.run?.stop();
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
  /**
   * A detached group holding one mesh per shared stand-in material — the
   * bright tracer and the dim shell streak — so the page can compile them
   * before the first round instead of on it (`renderer.compileAsync`). A
   * gun's own baked streak, projectile body and trail quad are nodes inside
   * the model it was collected from and compile with that model.
   */
  warm() {
    const group = new THREE.Group();
    group.add(new THREE.Mesh(tracerGeometry, tracerMaterial),
              new THREE.Mesh(tracerGeometry, shellMaterial));
    return group;
  }

  collect(root, options = {}) {
    const {
      replace = true,
      hideEffects = true,
      speedScale = TRACER_SPEED_SCALE,
      maxRange = TRACER_MAX_RANGE,
      roundLifetime = 'fixed',
      tracerLength = 'fixed',
      platformVelocity = null,
      aimRay = null,
      spreadDeg = null,
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
        if (node.userData?.projectileMesh || ((node.isMesh || (node.children && node.children.some(c => c.isMesh))) && (/rocket|projectile/i.test(node.name) || /rocket|projectile/i.test(node.userData?.geometry || '')))) projectileMesh = node;
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
        // Both null on every vehicle. `aimRay` is the hand-weapon contract:
        // 25 of 28 hand weapons declare `fireInCameraDof 1` with
        // `projectilePosition 0/0/0`, meaning the round is spawned on the
        // camera's line of fire and the muzzle node only places the flash
        // (`first-person-soldier.md` §2.7). `spreadDeg` is the deviation
        // cone's half-angle, asked per shot so a blooming burst walks.
        aimRay,
        spreadDeg,
        // 1 = barrel home; a shot resets to 0 and it eases forward again.
        recoil: stats.recoil ? 1 : null,
      };
      this.groups.push(group);
      found.push(group);
    });
    return found;
  }

  /** Hold or release the trigger. Idempotent, so it can be driven per frame.
   *
   * Engaging the trigger does NOT reset `cooldown`. It used to, on the
   * reading that "the first round leaves immediately" — true, but only once
   * the gun already owes you one. Because the timer only ran while the
   * trigger was held, releasing and re-pressing handed back a fresh round
   * every time: a Sherman's cannon is `roundOfFire 0.35`, one shell every
   * 2.86 s, and tapping Space fired its whole 30-round magazine in a single
   * second (reproduced headless: 28 shells in 60 frames). `advance` now runs
   * the timer whether or not the trigger is held and floors it at zero, so
   * an idle gun is still ready the instant you press — and a gun that fired
   * 0.2 s ago still owes 2.66 s no matter how many times you press. That is
   * also the engine's own order: GUN-5 lists the `roundOfFire` cooldown as
   * one of `isReadyToUseFire`'s gates in its own right, alongside the reload
   * and overheat timers, not as something the trigger edge clears. */
  setFiring(group, on) {
    if (!group || group.firing === !!on) return false;
    group.firing = !!on;
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
      // R2 / V-R2: Em_Shell792D* delay 2.0 s — age starts negative so the
      // casing is not strobed with the muzzle flash (T2).
      const delay = emitter.spec.delay || 0;
      emitter.age = -delay;
      emitter.node.visible = delay <= 0;
      // The engine rolls each flash particle (`startRotation CRD_UNIFORM
      // 0/180`), which is what keeps a held burst from looking like one frame.
      emitter.spin = this.rand() * Math.PI * 2;
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
      // GUN-10 / V-R2: rifle projectiles are `invisible 1` — retail draws no
      // body. Tracer rounds still get the bright TLight streak. Every other
      // round still needs a ballistic in `tracers` so `#sweep` / `#impact`
      // run: hand weapons declare no tracer interval, so dropping the dim
      // stand-in without a hidden hit-test round killed every surface FX.
      this.#spawnTracer(muzzle, group, !!tracerRound);
      if (!tracerRound) {
        const tracer = this.tracers[this.tracers.length - 1];
        if (tracer) tracer.mesh.visible = false;
      }
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
   *
   * A group with `aimRay` skips the muzzle transform entirely: the round
   * leaves the caller's origin along the caller's direction, which for a hand
   * weapon is the eye down the camera axis — `fireInCameraDof 1`, the reason
   * a BF1942 rifle hits what the crosshair covers regardless of where the
   * viewmodel's barrel points. `spreadDeg` then wanders the direction inside
   * the deviation cone, on either path.
   */
  #muzzleVelocity(muzzle, group, speed, out) {
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
    if (spread > 0) this.#wander(out, spread);
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
   * free. Both draws come from `this.rand`, the same authority the flash
   * roll already answers to — `Math.random` unless a check has seeded it.
   */
  #wander(dir, degrees) {
    const theta = degrees * (Math.PI / 180) * Math.sqrt(this.rand());
    const phi = this.rand() * Math.PI * 2;
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

  #displaySpeed(group, velocity) {
    return velocity > PROJECTILE_SCALE_CUTOFF ? velocity * group.speedScale : velocity;
  }

  #spawnTracer(muzzle, group, bright) {
    const speed = this.#displaySpeed(group, group.stats.velocity || 100);
    // The velocity is the round's own for as long as it flies, so it is a
    // real allocation per shot; the unit direction is only needed to point
    // the streak and lives in scratch.
    const velocity = this.#muzzleVelocity(muzzle, group, speed, new THREE.Vector3());
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
    const authored = group.stats.velocity || 100;
    const speed = this.#displaySpeed(group, authored);
    const velocity = this.#muzzleVelocity(muzzle, group, speed, new THREE.Vector3());
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
    this.scene.add(mesh);
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
      gravityScale: (speed / authored) ** 2,
      ttl: Math.min(spec.timeToLive || 10, 20),
      trail: group.trailQuad ? spec.trail : null,
      run: null,
      age: 0,
      travelled: 0,
      sincePuff: 0,
      // A **fuse** round: one the engine gives an end-of-life explosion, no
      // impact explosion, and — the third condition, which is the one that is
      // easy to miss — that actually SURVIVES contact (HP-9d, HP-9e).
      // Vanilla's are exactly the two grenades, the explosives pack and the
      // landmine. Contact must neither detonate such a round nor end it, or
      // its only blast is deleted and a grenade thrown into the open does
      // nothing at all, which is what this viewer did until now.
      //
      // `diesOnContact` is not a restatement of `!impact`. A flak shell is
      // `damageType 4` (no impact explosion) *and* `hasCollisionEffect 1`, so
      // `Projectile::handleCollision` recycles it the moment it touches
      // something and it bursts neither way — see `diesOnContact`'s own note.
      // Without this term all three vanilla flak guns would land a 20 m blast
      // wherever their rounds came to rest.
      fuse: (() => {
        const splash = splashSpec(spec?.damage);
        return !!(splash && !splash.impact && splash.endOfLife)
          && !diesOnContact(spec?.damage);
      })(),
      // Set when a fuse round has come to rest on a surface; see `advance`.
      resting: false,
    };
    // The authored trail — `e_rocketFume` riding the bazooka round as an
    // `addTemplate` child: a looping smoke emitter at 100/s whose puffs
    // inherit the rocket's 50 m/s and `drag 20` to a stop, and a motor flame
    // that burns out after a second. Attached, so the bundle's frame is the
    // round's own each frame. The single-sprite stand-in stays for GLBs and
    // pages without the library.
    if (this.effects && spec.trailBundle && this.effects.has(spec.trailBundle)) {
      shot.run = this.effects.play(spec.trailBundle, {
        attach: { object: mesh, velocity: () => shot.velocity },
      });
      if (shot.run) shot.trail = null;
    }
    this.projectiles.push(shot);
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

  /** Record a hit, name the effect the game would play, and play or mark it. */
  #impact(group, spec, hit, velocity = null, travelled = 0) {
    const attacker = this.attackerMaterial(spec);
    const family = materialFamily(hit.material);
    // `Projectile::getDamage`: the attacker material's `materialDamage`, then
    // the falloff over the distance the round has flown since it left.
    const base = this.materials?.[attacker]?.damage ?? null;
    const factor = damageFactor(spec?.damage, travelled);
    // The two terms that were missing. `damageMod` is keyed by the attacker's
    // and defender's *groups*, not their material ids — most materials use
    // their own id for both, which is why a keyed-by-id lookup mostly works and
    // then silently doesn't on the ones that differ.
    const attGroup = this.materials?.[attacker]?.attGroup ?? attacker;
    const defGroup = this.materials?.[hit.material]?.defGroup ?? hit.material;
    const mod = this.modifiers?.[attGroup]?.[defGroup] ?? null;
    // `cos(angle)`: a round that arrives square on does full damage, one that
    // grazes does almost none. The engine's own term is the cosine between the
    // round's path and the face normal, so take the absolute dot of the two
    // unit vectors — the sign only says which side of the face we came from.
    let incidence = 1;
    if (velocity) {
      const len = velocity.length();
      if (len > 0) {
        incidence = Math.abs((velocity.x * hit.nx + velocity.y * hit.ny
                              + velocity.z * hit.nz) / len);
      }
    }
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
      travelled,
      damageFactor: factor,
      // The attacker/defender group pair and the two new terms, kept beside the
      // product so a readout can show why a round did what it did.
      attGroup,
      defGroup,
      damageMod: mod,
      incidence,
      // The engine's whole direct-hit formula. `damageMod` genuinely absent
      // (no table loaded) leaves the base damage alone rather than zeroing it;
      // a table that *does* load and says 0.0 for this pairing means exactly
      // that, and the round bounces.
      damage: base === null ? null
        : base * (mod === null ? 1 : mod) * incidence * factor,
      played: false,
    };
    // Splash / HE area pass. Direct HP is already in `damage`; these fields
    // tell the map page who else to hurt within `radius` of the blast centre.
    //
    // This is the **impact** explosion, and the engine gives it only to a
    // round with `damageType == 1` AND `hasCollisionEffect` (HP-9d, gates
    // 0x08153e79 / 0x08153ea9) — `splashSpec.impact` is that conjunction. A
    // grenade, satchel, explosives pack or landmine reaches this function with
    // `impact` false and gets no area pass here at all; its blast is the
    // end-of-life one in `#detonate`. The radius is the truncated integer
    // (HP-9), which is what the impact path holds.
    const splash = splashSpec(spec?.damage);
    if (splash?.impact) {
      record.blast = 'impact';
      record.splashMaterial2 = splash.material2;
      record.splashRadius = splash.radius;
      record.splashYMod = splash.yMod;
      // The blast is centred 0.1 m off the surface, along the collision
      // normal — `hitPos + 0.1 * normal`, lnxded 0x08153f5e-0x08153f8f, pushed
      // at 0x08154026 (see `IMPACT_BLAST_OFFSET`). Kept as its own field
      // rather than moving `point`, because `point` is where the **collision
      // effect** goes and the engine plays that one at the raw hit position,
      // before this offset is computed (0x08153e5b).
      record.splashPoint = [
        hit.x + hit.nx * IMPACT_BLAST_OFFSET,
        hit.y + hit.ny * IMPACT_BLAST_OFFSET,
        hit.z + hit.nz * IMPACT_BLAST_OFFSET,
      ];
    }
    this.hits.unshift(record);
    if (this.hits.length > 16) this.hits.length = 16;
    if (this.effects && record.effect) {
      const handle = this.effects.play(record.effect, {
        position: record.point,
        normal: record.normal,
        speed: velocity ? velocity.length() : 0,
      });
      record.played = !!handle;
    }
    this.#spawnImpact(hit, family);
    this.onImpact?.(record, hit);
  }

  /**
   * The **end-of-life** explosion: the one a fuse weapon gets, and the one a
   * round that simply runs out of `timeToLive` in mid-air gets.
   *
   * `Projectile::startEndEffect` (lnxded 0x0831f590) fires it for
   * `damageType == 1` (test at 0x0831f6bb) **or** `damageType == 4`
   * (0x0831f6c0), and tests `hasCollisionEffect` at neither — which is the
   * whole point of HP-9d's two-path rule. Three differences from `#impact`,
   * all read rather than assumed:
   *
   *   - the radius skips the impact path's second truncation (0x0831f73e vs
   *     0x08153f23), which is a no-op either way because the property is a
   *     console `int` truncated at parse — `splashSpec`'s own comment has the
   *     whole of why, and why handing this path a fractional radius would be
   *     wrong rather than faithful.
   *   - `sourceArmor` is pushed as **NULL** (0x0831f727), where the impact
   *     path passes the firer's. So this does not exclude the thrower, which
   *     is why your own grenade hurts you. UNVERIFIED, and named as such:
   *     what that argument actually gates downstream was not re-derived this
   *     round, only the fact that it is null here.
   *   - there is no surface: the engine stands the effect on world up,
   *     `startEndEffect` passing (0, 1, 0), so there is no material pair, no
   *     incidence cosine and no direct-hit HP — an end-of-life blast is
   *     splash and nothing else.
   *
   * Returns the record, or null when this round has no end-of-life blast.
   */
  #detonate(group, spec, position, travelled = 0) {
    const splash = splashSpec(spec?.damage);
    if (!splash?.endOfLife) return null;
    const attacker = this.attackerMaterial(spec);
    const record = {
      kind: 'endOfLife',
      material: null,
      family: null,
      attacker,
      // `endEffectTemplate` — `e_ExplGranade` on both grenades. Stood up on
      // world up, not on a surface normal.
      effect: spec?.endEffect ?? null,
      point: [position.x, position.y, position.z],
      normal: [0, 1, 0],
      gun: group.node.name,
      distance: 0,
      // Nothing was struck, so there is no owner to name and no firer to
      // exclude (`sourceArmor = NULL`, above).
      owner: -1,
      firer: -1,
      travelled,
      damageFactor: 1,
      attGroup: this.materials?.[attacker]?.attGroup ?? attacker,
      defGroup: null,
      damageMod: null,
      incidence: 1,
      damage: null,
      blast: 'endOfLife',
      splashMaterial2: splash.material2,
      splashRadius: splash.radius,
      splashYMod: splash.yMod,
      played: false,
    };
    if (this.effects && record.effect) {
      record.played = !!this.effects.play(record.effect, {
        position: record.point, normal: record.normal, speed: 0,
      });
    }
    this.hits.unshift(record);
    if (this.hits.length > 16) this.hits.length = 16;
    this.onImpact?.(record, null);
    return record;
  }

  #spawnImpact(hit, family) {
    if (!this.impactMarkers) return;
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
        // Idle emitters stay at age Infinity. Fired ones tick even while a
        // positive `delay` keeps them invisible (shell eject at 2.0 s).
        if (emitter.age === Infinity) continue;
        emitter.age += dt;
        const ttl = emitter.spec.timeToLive || 0.1;
        if (emitter.age < 0) {
          emitter.node.visible = false;
          active = true;
          continue;
        }
        if (emitter.age >= ttl) {
          emitter.node.visible = false;
          emitter.age = Infinity;
          continue;
        }
        emitter.node.visible = true;
        active = true;
        const phase = (emitter.age / ttl) * 100;
        // `sizeOverTime` is the absolute size ramp; a bare `size` is the fixed
        // size of particles that declare no ramp. Capped: the ramp's tail was
        // authored for particles streaming away from the muzzle, not for one
        // node parked on it. Mesh muzzle flashes (fx_1p_MuzzGun size 0.2) must
        // not fall back to 1 — that alone made 1P flashes ~5× retail (T2/V-R2).
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
            .multiply(_spin.setFromAxisAngle(_spinAxis, emitter.spin));
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
          _recoil.set(0, 0, kick).applyQuaternion(group.node.quaternion);
          group.node.position.copy(home).add(_recoil);
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
      } else if (group.cooldown > 0) {
        // The rate-of-fire timer keeps running with the trigger released —
        // see `setFiring` for why. The held branch above is untouched, down
        // to keeping its own fractional remainder across the `+= period`, so
        // a gun's pacing while you hold the trigger is bit-identical to what
        // it always was; this only stops a release from parking the clock.
        // Floored at zero rather than left to run negative so a gun idle for
        // a minute does not owe a burst the `while` above would then fire in
        // one frame.
        group.cooldown = Math.max(0, group.cooldown - dt);
        active = true;
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
        // Distance flown to the surface itself: the frame's step overshoots
        // it, and a slow frame at 1000 m/s overshoots it by tens of metres.
        this.#impact(tracer.group, tracer.group.stats.projectile, struck,
                     tracer.velocity, tracer.travelled - step + struck.t);
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
      let step = 0;
      // A fuse round that has come to rest is only running its fuse down: no
      // gravity, no motion, no sweep, until `timeToLive` detonates it below.
      if (!shot.resting) {
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
        step = shot.velocity.length() * dt;
        shot.travelled += step;
        shot.mesh.position.addScaledVector(shot.velocity, dt);
        // Nose (local -Z) along the velocity, so shells arc over.
        _aimBack.copy(shot.mesh.position).sub(shot.velocity);
        shot.mesh.lookAt(_aimBack);
        const struck = this.#sweep(shot.group, shot.mesh.position,
                                   shot.velocity, step, 0);
        if (struck && shot.fuse) {
          // HP-9d: a fuse round takes NO impact path. `hasCollisionEffect` is
          // clear, which is literally "play no collision effect", and the
          // explosion gate that same flag serves is why there is no blast here
          // either — a grenade bouncing off a wall does nothing at all. So
          // neither `#impact` nor removal: the round lives on, and its
          // `timeToLive` is what ends it.
          //
          // **The resting is an approximation, and a deliberate one.** The
          // engine's grenade is a rigid body (`setHasCollisionPhysics 1`,
          // `setHasResponsePhysics 1`) that genuinely bounces, and the contact
          // solver that would bounce it here belongs to the concurrent
          // collision round (COL-2..COL-12), not to this one. Rather than
          // invent a restitution coefficient, the round stops on the surface
          // it met and runs its fuse down there. Its own authored word for
          // this is `dieAfterColl 0` — on 2,311 templates across the installed
          // mods, but NOT aligned with `hasCollisionEffect` (1,676 templates
          // carry the flag set *and* `dieAfterColl 0`), and what the engine
          // does with it was not read. Recorded as the lead it is; not
          // consumed.
          shot.mesh.position.set(struck.x + struck.nx * 0.05,
                                 struck.y + struck.ny * 0.05,
                                 struck.z + struck.nz * 0.05);
          shot.velocity.set(0, 0, 0);
          shot.resting = true;
        } else if (struck) {
          shot.mesh.position.set(struck.x, struck.y, struck.z);
          this.#impact(shot.group, shot.group.stats.projectile, struck,
                       shot.velocity, shot.travelled - step + struck.t);
          shot.run?.stop();
          this.scene.remove(shot.mesh);
          shot.mesh.visible = false;
          shot.group.projectilePool.push(shot.mesh);
          this.projectiles.splice(i, 1);
          continue;
        }
      }
      const expired = shot.age > shot.ttl;
      if (expired || shot.travelled > shot.group.maxRange) {
        shot.run?.stop();
        const spec = shot.group.stats.projectile;
        // The end-of-life explosion (HP-9d): `damageType` 1 or 4, no
        // `hasCollisionEffect` test, an untruncated radius. This is how a
        // grenade, an explosives pack and a landmine deal every point of
        // damage they ever deal, and until now the viewer gave them none.
        // `#detonate` plays the `endEffectTemplate` itself; a round with no
        // end-of-life blast still gets its effect through the fallback.
        //
        // Only on `timeToLive`, never on the range cap: `maxRange` is this
        // viewer's own recycling guard (1,500 m on the map page, further than
        // any vanilla round's `timeToLive` carries it), not the engine's fuse,
        // and exploding there would invent a blast at an arbitrary distance.
        if (!(expired && this.#detonate(shot.group, spec, shot.mesh.position,
                                        shot.travelled))) {
          if (this.effects && spec?.endEffect) {
            const at = shot.mesh.position;
            this.effects.play(spec.endEffect,
                              { position: [at.x, at.y, at.z], normal: [0, 1, 0] });
          }
        }
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
