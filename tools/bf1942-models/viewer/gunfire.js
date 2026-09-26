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
import { idleFirePose } from './idle-vehicle.js';
import { salvo } from './bomb-release.js';
import { advanceGroups, FLASH_RAMP_MAX, RECOIL_KICK_SCALE } from './gun-cycle.js';
import { advanceImpacts, advancePuffs, sampleCurve, shellMaterial, tracerGeometry,
         tracerMaterial } from './round-visuals.js';
import { advanceProjectiles, advanceTracers, endRound,
         TRACER_MIN_SCREEN_PX } from './projectile-flight.js';
import { collectGroups } from './gun-groups.js';
import { fireBarrel, lightMuzzle, PROJECTILE_SCALE_CUTOFF, TRACER_MAX_AGE, TRACER_MAX_RANGE,
         TRACER_SPEED_SCALE } from './round-launch.js';

export { FLASH_RAMP_MAX, PROJECTILE_SCALE_CUTOFF, RECOIL_KICK_SCALE, sampleCurve,
         TRACER_MAX_AGE, TRACER_MAX_RANGE, TRACER_MIN_SCREEN_PX, TRACER_SPEED_SCALE,
         tracerMaterial };

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
    // `firstPerson` is the observer's, and only his own guns spend it. A page
    // with other shooters in it sets `viewOf(group)` to `'third'` for a
    // group it knows is someone else's, and null to leave it to
    // `firstPerson` (round-launch.js `flashView`).
    this.viewOf = null;
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
    // The soldiers a round can meet. `collider` holds the level and the hulls;
    // a soldier is not in it, so without this a vehicle's round passed through
    // every man on the map and could only hurt one by splash — which is how an
    // AA gun, whose flak shell has no impact blast at all, never hurt anyone
    // on the ground. `(ox, oy, oz, dx, dy, dz, maxDist, group) => hit | null`,
    // `hit` shaped like a collider hit (`t`, point, normal, `material`,
    // `owner`) plus the page's own `target`. Only asked inside the collider's
    // own distance, so a wall still stops the round first.
    this.bodyCast = null;
    // The struck object's own `angleMod`, for the angle term of the direct-hit
    // law (`round-impact.js`): `(owner) => number | null`, null where the
    // object authors none and keeps the template's 0. Null (the model
    // browser) prices every object at 0.
    this.angleModOf = null;
    // What a proximity-fused round can burst on (`proximity-fuse.js`):
    // `(x, y, z, radius) => [{ x, y, z, mass, vx, vy, vz, owner }]`, every
    // vehicle hull whose origin might be within `radius`, whoever drives it.
    // Null (the model browser) leaves the fuse inert.
    this.nearObjects = null;
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
  /**
   * What a level hands the guns: the collider rounds run into, and the
   * `_shared/damage.json` tables that name each hit's effect and price it
   * (`effects`, `projectiles`, `materials`, and the `modifiers` matrix -- the
   * whole reason small arms do not kill armour). Either may be null.
   */
  useLevel(collider, tables) {
    this.collider = collider;
    this.damageEffects = tables?.effects || null;
    this.projectileMaterials = tables?.projectiles || null;
    this.materials = tables?.materials || null;
    this.modifiers = tables?.modifiers || null;
  }

  attackerMaterial(spec) {
    if (!spec) return null;
    if (Number.isFinite(spec.material)) return spec.material;
    const entry = this.projectileEntry(spec);
    return Number.isFinite(entry?.material) ? entry.material : null;
  }

  /**
   * The round's row in `damage.json`'s projectile table, or null: its attacker
   * material, and the words the baked `fireArms.projectile` block does not
   * carry (the `timeToLive` CRD, the proximity fuse).
   */
  projectileEntry(spec) {
    const table = this.projectileMaterials;
    if (!table || !spec?.template) return null;
    return table[spec.template.toLowerCase()] ?? null;
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

  /**
   * Index every FireArms under `root` and return the groups found.
   *
   * `replace` (the default) is the model browser's contract: one model at a
   * time, so a new one clears the last. The map flythrough collects one flown
   * vehicle out of a scene of many and passes `replace: false` so a second
   * vehicle does not evict the first.
   */
  collect(root, options = {}) {
    return collectGroups(this, root, options);
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
      fireBarrel(this, group, group.muzzles[barrel]);
    }
  }

  /**
   * The muzzle of one pull and nothing else: the flash, casing and smoke
   * emitters lit exactly as `fireShot` lights them, with no round, no
   * `onShot` and no recoil. For a shot something else has already resolved
   * -- a bot's rifle round is the referee's ray (`bot-referee.js`
   * `resolveShot`), and firing it a second time through here would bill it
   * twice. One barrel a pull, round-robin, which is every hand weapon.
   */
  flash(group) {
    if (!group?.muzzles?.length) return;
    const muzzle = group.muzzles[group.shots % group.muzzles.length];
    group.shots += 1;
    lightMuzzle(this, group, muzzle);
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
      endRound(this, shot, i, true);
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

  /** Advance flashes, recoil, firing cadence and rounds. True while active. */
  advance(dt) {
    let active = false;
    // The per-frame collision budget, spent by `sweep` and reset here.
    this.casts = 0;
    if (advanceGroups(this, dt)) active = true;
    if (advanceTracers(this, dt)) active = true;
    if (advanceProjectiles(this, dt)) active = true;
    if (advancePuffs(this, dt)) active = true;
    if (advanceImpacts(this, dt)) active = true;
    return active;
  }
}
