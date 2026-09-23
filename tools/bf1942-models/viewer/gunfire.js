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
import { damageFactor, IMPACT_BLAST_OFFSET, isFuseRound, roundTimeToLive,
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
// The contact a fuse round gets when it lands — elasticity, friction and
// resistance off the material pair, at the engine's own 30 Hz. See
// `contact-response.js` for why a grenade does not rebound and what it does
// instead. Imports nothing itself, so this costs the page no extra module.
import { FuseRoundBody, contactMaterialFor, SURFACE_STANDOFF } from './contact-response.js';
import { idleFirePose } from './idle-vehicle.js';
import { dragAcceleration, entersWater, launchesADrawnBody,
         releaseSpeed, salvo } from './bomb-release.js';
import { TorpedoRun, runParts } from './torpedo-run.js';

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
// The drag acceleration of one round, per frame. Scratch, like every other
// vector on this page: a round in flight must not allocate.
const _drag = new THREE.Vector3();
const _tip = new THREE.Vector3();
// Where a fuse round stood at the top of the frame, so the distance it
// actually travelled under the contact solver can be measured rather than
// integrated (the solver moves it, snaps it to surfaces and pushes it out).
const _fuseFrom = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
// Scratch for `layOnSurface`: the basis a landed fuse round is stood up in.
const _restN = new THREE.Vector3();
const _restF = new THREE.Vector3();
const _restR = new THREE.Vector3();
const _restM = new THREE.Matrix4();
// Scratch for the per-frame and per-shot paths below: a flash's roll, a
// gun's recoil offset and a round's unit direction were each a fresh
// allocation before, per emitter per frame and per shot, and a frame that
// allocates is a frame that will pay for it at the collector's convenience
// (features/mesh-viewer-performance, rule 5).
const _spin = new THREE.Quaternion();
const _recoil = new THREE.Vector3();
const _direction = new THREE.Vector3();

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
      // A bomb rack declares no flash, no tracer and no recoil, and releases at
      // zero muzzle velocity -- so it matched every clause of the guard that
      // used to stand here and no plane in this viewer has ever dropped a bomb
      // (ledger BOMB-9). The guard is not deleted: what it protected against is
      // a `FireArms` placeholder with no signature AND nothing to launch, which
      // would still cost a trigger, a cooldown and a stream of invisible rounds
      // spending collision casts. `launchesADrawnBody` is the amended test and
      // carries the whole argument.
      if (!launchesADrawnBody(stats, projectileMesh)
          && !emitters.length && !stats.tracer && !stats.recoil
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
        // `PointPhysicsNode::updatePositionalDragSimple` (`0x00578990`) takes
        // the body's own `getBoundingRadius` (virtual slot `+0x1c`) into the
        // drag term as a frontal area, pi*r^2. Nothing exports it, so it is
        // measured here off the drawn body's geometry — the same object the
        // engine is measuring — once per group rather than once per round.
        boundingRadius: projectileMesh ? meshRadius(projectileMesh) : 0,
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
   * Retire one group: trigger off, out of the index, and the gun it was
   * driving left looking like a gun nobody is firing.
   *
   * The order matters and the last step is the one that was missing. Splicing
   * a group out of `this.groups` is what a seat exit has always done -- rounds
   * already in the air keep their own reference and finish their flight -- but
   * it also means `advance` never looks at that gun again. A muzzle flash lit
   * on the frame of the exit is therefore never advanced to its own
   * `timeToLive`, and a barrel caught mid-recoil is never walked back to
   * `home`: both are latches that outlive the object that drives them, and
   * they stay on the parked vehicle for the rest of the level. `idleFirePose`
   * is the reset, and it is here rather than in any caller because here is
   * where the group stops being stepped.
   */
  release(group) {
    if (!group) return false;
    group.firing = false;
    const index = this.groups.indexOf(group);
    if (index >= 0) this.groups.splice(index, 1);
    // Hiding a flash is not all of it: `advance` also *moves* one. An emitter
    // declaring `offsetInDof` or `speedInDof` is re-placed every frame at
    // `basePos + drift`, and a billboarded one has its quaternion rewritten
    // to face the camera -- and both stop the moment the group leaves the
    // index, leaving the node wherever the exit caught it. `collect` then
    // re-reads `basePos`/`baseQuat` off that node on the next entry, so the
    // drift is re-baked as the authored placement and the emitter walks one
    // more drift away from its muzzle on every enter-fire-exit cycle.
    // Measured on Kasserine Pass' AA_Allies, whose `Em_MuzzAAgunB_WSmoke`
    // declares `speedInDof 10` over a 0.5 s life: authored local z -1.0, then
    // -1.667, -2.0, -2.333 after one, two and three cycles, and it never
    // comes back. `basePos`/`baseQuat` are the authored pose, kept aside by
    // `collect` for exactly this reason, so putting the node back on them is
    // the whole reset. `age = Infinity` is what `advance` itself uses to mean
    // "idle", so a group handed back to a later `advance` starts there.
    for (const emitter of group.emitters) {
      emitter.age = Infinity;
      emitter.node.position.copy(emitter.basePos);
      emitter.node.quaternion.copy(emitter.baseQuat);
    }
    idleFirePose(group.node);
    return index >= 0;
  }

  /**
   * One trigger pull.
   *
   * How many barrels that is, and what it costs in ammunition, is `salvo()` in
   * `bomb-release.js` — read out of `FireArms::Fire` (lnxded `0x0828a090`) and
   * `FireArms::fireFinished` (`0x08288470`), ledger BOMB-1 to BOMB-5. In short:
   * a multi-barrel weapon fires **all** its barrels in one pull and is charged
   * one round **per barrel**, unless it declares `setAsynchronyFire`, in which
   * case it fires one barrel round-robin and is charged one.
   *
   * This corrects the reading that used to live here — and the Katyusha is the
   * wrong example to correct it with. The old comment argued from the shipped
   * data that Refractor cycles `addFireArmsPosition` entries one per round, and
   * on `KatyushaFireArmsBundle` that **conclusion was right**, for a reason the
   * old comment did not give: it declares `setAsynchronyFire 1`, so it takes the
   * round-robin branch and really does fire one rail per pull off its six.
   * `Elco80_Torpedos` declares the flag too — one tube a pull, not a salvo of
   * two. What the binary overturns is the general rule, not those two weapons.
   *
   * The weapons the charge really does change are the non-async multi-barrel
   * guns. A Corsair's two-barrel `CorsairGuns` puts 24 rounds a second into the
   * air out of a 12 rps template, so its `magSize 900` lasts 37.5 s rather than
   * 75. The 600-round magazines that halve from 50 s to 25 are `SBDGuns`,
   * `SBD-TGuns` and `IlyushinGuns`.
   *
   * `group.shots` counts PROJECTILES, as it always did, and so still paces the
   * tracer interval; the round-robin counter is the same field, which is what
   * BOMB-3's `FireArms+0x296` is.
   */
  fireShot(group) {
    const pull = salvo(group.muzzles.length, {
      asynchronyFire: !!group.stats.asynchronyFire,
      // BOMB-5's partial salvo needs the magazine, and the magazine lives in
      // `seats.js`'s `FireState`, which `gunfire.js` knows nothing about. One
      // optional hook, wired by the page the same way `onShot` is; unset means
      // unlimited, which is what the model browser's turntable is.
      roundsLeft: this.roundsLeft?.(group) ?? Infinity,
      nextBarrel: group.shots,
    });
    // Charged once for the whole pull, with the projectile count — BOMB-1. A
    // handler written before this signature existed ignores the second
    // argument and spends one, which is what it did before.
    this.onShot?.(group, pull.rounds);
    for (const barrel of pull.barrels) {
      this.#fireBarrel(group, group.muzzles[barrel]);
    }
  }

  /** One projectile, out of one barrel. */
  #fireBarrel(group, muzzle) {
    group.shots += 1;
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

  /**
   * Parent a spawned mesh into the world, on the world's own layer.
   *
   * A round belongs to the world the moment it leaves the gun, and `this.scene`
   * is the world scene — but a clone carries its template's `layers`, and a
   * first-person hand weapon's template is a node inside the arms rig, which
   * map.html puts wholesale on `VIEWMODEL_LAYER` so the near pass can draw it
   * over cleared depth. A grenade cloned from there is added to the world scene
   * and then drawn by nobody: the world camera's mask does not include layer 1
   * and the near camera only renders `vmScene`. That is the whole reason a
   * thrown grenade exploded where you threw it without ever being seen, and the
   * same silence hid the bazooka's rocket body (its smoke trail is separate
   * sprites spawned here, which is why nobody noticed).
   *
   * Every spawn path goes through this, so the rule is stated once: whatever is
   * parented into the world scene is visible to a default camera. Pooled meshes
   * are re-adopted rather than trusted — a pool outlives the weapon it came
   * from, and re-equipping re-clones from a fresh rig.
   */
  #adopt(mesh) {
    mesh.traverse(obj => obj.layers.set(0));
    this.scene.add(mesh);
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
    this.#adopt(mesh);
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
    // `releaseSpeed` is `velocity ?? 100`, not `velocity || 100`. Every one of
    // the thirteen vanilla aircraft racks declares `velocity 0`, which is a real
    // authored value meaning "the round leaves at no speed of its own"; `||`
    // read it as absent and launched a released bomb forward at 100 m/s
    // (ledger BOMB-8). At zero the muzzle transform contributes nothing and
    // `#muzzleVelocity` returns `group.platformVelocity` alone — the aircraft's
    // own motion, which is the whole of a bomb release.
    const authored = releaseSpeed(group.stats);
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
    this.#adopt(mesh);
    // A **fuse** round (HP-9d, HP-9e): end-of-life explosion, no impact
    // explosion, and — the condition that is easy to drop — it survives
    // contact. Vanilla's are exactly the two grenades, the explosives pack and
    // the landmine; the three flak shells pass the first two and fail the
    // third. Contact must neither detonate a fuse round nor end it, or its
    // only blast is deleted and a grenade thrown into the open does nothing at
    // all, which is what this viewer did until now. `isFuseRound` in
    // `effects-core.js` carries the rule and the addresses.
    const fuse = isFuseRound(spec?.damage);
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
      ttl: roundTimeToLive(spec.timeToLive, spec?.damage),
      trail: group.trailQuad ? spec.trail : null,
      run: null,
      age: 0,
      travelled: 0,
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
                                         this.attackerMaterial(spec)),
            materials: this.materials,
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
    this.#adopt(mesh);
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
      // The group itself, so a page with more than one seat on a hull can
      // say which seat's gun it was (a bot driver and a bot gunner share the
      // hull's owner id).
      firerGroup: group,
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
      firerGroup: group,
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

  /**
   * Take `shot` out of the world, blowing it up on the way when it earned it.
   *
   * `blast` is whether this is the end of the round's own fuse (or a hand
   * detonation, which the engine treats identically — `Projectile::detonate`
   * is the same call either way). The end-of-life explosion is HP-9d:
   * `damageType` 1 or 4, no `hasCollisionEffect` test, an untruncated radius.
   * This is how a grenade, an explosives pack and a landmine deal every point
   * of damage they ever deal. `#detonate` plays the `endEffectTemplate`
   * itself; a round with no end-of-life blast still gets its effect through
   * the fallback below.
   */
  #endRound(shot, index, blast) {
    shot.run?.stop();
    shot.wake?.stop();
    const spec = shot.group.stats.projectile;
    if (!(blast && this.#detonate(shot.group, spec, shot.mesh.position,
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
    this.projectiles.splice(index, 1);
  }

  /**
   * Blow up every round `group` still has in the world, now.
   *
   * `FireArms::detonateProjectiles` (lnxded `0x08287f80`) walks the array of
   * live projectiles the weapon keeps at `+0x1d8` (count at `+0x1e4`) and
   * calls `Projectile::detonate()` on each — the SAME call the end of a fuse
   * makes, which is why a hand-detonated explosives pack does exactly the
   * damage a timed-out one does. The array is per WEAPON, so one engineer's
   * plunger cannot set off another's charges; here the group is the weapon,
   * and the rounds already carry it.
   *
   * Returns how many went off.
   */
  detonateProjectiles(group) {
    if (!group) return 0;
    let count = 0;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const shot = this.projectiles[i];
      if (shot.group !== group) continue;
      this.#endRound(shot, i, true);
      count++;
    }
    return count;
  }

  /** How many rounds `group` still has in the world — the size of the array
   *  `detonateProjectiles` would walk. The HUD has no use for it; the tests
   *  and the detonator's own "is there anything to set off" do. */
  liveProjectiles(group) {
    let count = 0;
    for (const shot of this.projectiles) if (shot.group === group) count++;
    return count;
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
  #stepFuseRound(shot, dt) {
    if (shot.resting) return 0;
    const collider = this.collider;
    const before = _fuseFrom.copy(shot.mesh.position);
    // The contact probe. Same budget as `#sweep`: a round that has already
    // spent the frame's casts simply does not move this frame, which is
    // better than one that tunnels through the floor.
    const owner = this.#owner(shot.group);
    const probe = collider
      ? (ox, oy, oz, dx, dy, dz, maxDist) => {
          if (this.casts >= MAX_CASTS_PER_FRAME) return null;
          this.casts++;
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
  #throughWater(shot, hit) {
    if (hit.kind !== 'water') return false;
    const spec = shot.group.stats.projectile;
    if (!entersWater(spec)) return false;
    if (!shot.torpedo) {
      const waterLevel = this.collider?.waterLevel ?? hit.y;
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
      if (this.effects && spec.trailBundle && this.effects.has(spec.trailBundle)) {
        shot.run?.stop();
        shot.run = null;
        shot.wake = this.effects.play(spec.trailBundle, {
          attach: { object: shot.mesh, velocity: () => shot.velocity },
        });
      }
    }
    return true;
  }

  /** Take `shot` out of the world with no blast — the plain contact path. */
  #recycle(shot, index) {
    shot.run?.stop();
    shot.wake?.stop();
    this.scene.remove(shot.mesh);
    shot.mesh.visible = false;
    shot.group.projectilePool.push(shot.mesh);
    this.projectiles.splice(index, 1);
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
    this.#adopt(mesh);
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
      // A fuse round runs the rigid-body contact solver instead of this
      // loop's ballistic step: it has to keep moving after it touches
      // something, which is the whole of what `contact-response.js` adds.
      if (shot.body) {
        step = this.#stepFuseRound(shot, dt);
      } else if (shot.torpedo) {
        // A torpedo in the water runs its own integrator instead of the
        // ballistic one: buoyancy from its two floaters, levelling from its
        // wings, thrust from its `c_ETTorpedo` engine, drag at PHY-7's
        // submerged 25x. It still sweeps for contact below, so a hull kills a
        // ship through the ordinary `#impact` with material 250.
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
        const struck = this.#sweep(shot.group, shot.mesh.position,
                                   shot.velocity, step, 0);
        if (struck && !this.#throughWater(shot, struck)) {
          shot.mesh.position.set(struck.x, struck.y, struck.z);
          this.#impact(shot.group, shot.group.stats.projectile, struck,
                       shot.velocity, shot.travelled - step + struck.t);
          this.#recycle(shot, i);
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
        const struck = this.#sweep(shot.group, shot.mesh.position,
                                   shot.velocity, step, 0);
        if (struck && !this.#throughWater(shot, struck)) {
          shot.mesh.position.set(struck.x, struck.y, struck.z);
          this.#impact(shot.group, shot.group.stats.projectile, struck,
                       shot.velocity, shot.travelled - step + struck.t);
          this.#recycle(shot, i);
          continue;
        }
      }
      const expired = shot.age > shot.ttl;
      if (expired || shot.travelled > shot.group.maxRange) {
        // Only on `timeToLive`, never on the range cap: `maxRange` is this
        // viewer's own recycling guard (1,500 m on the map page, further than
        // any vanilla round's `timeToLive` carries it), not the engine's fuse,
        // and exploding there would invent a blast at an arbitrary distance.
        this.#endRound(shot, i, expired);
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

/**
 * The bounding-sphere radius of a template mesh, in its own frame, metres.
 *
 * Measured on the geometry rather than with `Box3.setFromObject`, for the same
 * reason the tracer width is (see `collect`): a world-space AABB of a body
 * rotated by the airframe reads the wrong number. Returns 0 for a node with no
 * geometry, which switches the drag term off rather than inventing an area.
 */
function meshRadius(node) {
  let radius = 0;
  node.traverse(part => {
    if (!part.isMesh || !part.geometry) return;
    if (!part.geometry.boundingSphere) part.geometry.computeBoundingSphere();
    radius = Math.max(radius, part.geometry.boundingSphere?.radius || 0);
  });
  return radius;
}

/** The `muzzle` node `node` hangs off, searching no further than `stop`. */
function ancestorMuzzle(node, stop) {
  for (let n = node; n && n !== stop; n = n.parent) {
    if (n.userData?.muzzle) return n;
  }
  return null;
}
