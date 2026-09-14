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
// c_ETRocket motors light after launch; a gentle ramp reads as the Katyusha's
// kick without turning the rocket into a bullet.
const ROCKET_ACCEL = 25;         // m/s^2
const GRAVITY = 9.81;
const TRAIL_PUFF_SPACING = 0.9;  // metres of flight between smoke puffs
const MAX_TRAIL_PUFFS = 96;

// Game tracers are 0.006 m wide TLight quads; 0.01 m keeps them visible in a
// viewer without turning into glow sticks.
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
  constructor({ scene, camera, onMaterial = null, onShot = null } = {}) {
    this.scene = scene;
    this.camera = camera;
    this.onMaterial = onMaterial;
    this.onShot = onShot;
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
  }

  /** Put every round in the air back in its pool. Call on a scene change. */
  clear() {
    for (const tracer of this.tracers) {
      this.scene.remove(tracer.mesh);
      this.tracerPool.push(tracer.mesh);
    }
    this.tracers.length = 0;
    // Projectile and puff meshes are clones of the outgoing model's baked
    // nodes; drop them rather than pooling across models.
    for (const shot of this.projectiles) this.scene.remove(shot.mesh);
    this.projectiles.length = 0;
    for (const puff of this.puffs) this.scene.remove(puff.mesh);
    this.puffs.length = 0;
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
            || obj.userData?.projectileTrail) obj.visible = false;
      });
    }
    root.traverse(obj => {
      const stats = obj.userData?.fireArms;
      if (!stats) return;
      const muzzles = [];
      const emitters = [];
      let projectileMesh = null;
      let trailQuad = null;
      obj.traverse(node => {
        if (node.userData?.muzzle) muzzles.push(node);
        if (node.userData?.projectileMesh) projectileMesh = node;
        if (node.userData?.projectileTrail) trailQuad = node;
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
        projectilePool: [],
        puffPool: [],
        firing: false,
        cooldown: 0,
        shots: 0,
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
    // 50` stretches `TLight_m1` (0.006 x 0.006 x 1.0 m) fifty times along its
    // flight — the game's tracer is a 50 m streak, and that length is the only
    // reason a round travelling 6.7 m per frame reads as anything at all.
    // A 50 m streak leaving a model on a turntable runs off the stage, so the
    // browser keeps its 1..4 m stand-in and the world path takes the data.
    const scaler = group.stats.tracer?.scaler ?? 50;
    const length = group.tracerLength === 'data'
      ? Math.max(scaler, 1)
      : Math.min(Math.max(scaler * 0.04, 1), 4);
    const mesh = this.tracerPool.pop() || new THREE.Mesh(tracerGeometry, tracerMaterial);
    mesh.material = bright ? tracerMaterial : shellMaterial;
    mesh.scale.set(1, 1, length);
    mesh.position.copy(_origin).addScaledVector(direction, length / 2);
    mesh.lookAt(_aimBack.copy(mesh.position).add(direction));
    this.scene.add(mesh);
    this.tracers.push({
      mesh,
      bright,
      velocity,
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

  /** Advance flashes, recoil, firing cadence and rounds. True while active. */
  advance(dt) {
    let active = false;
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
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tracer = this.tracers[i];
      tracer.age += dt;
      const step = tracer.velocity.length() * dt;
      tracer.travelled += step;
      tracer.mesh.position.addScaledVector(tracer.velocity, dt);
      if (tracer.age > tracer.ttl || tracer.travelled > tracer.maxRange) {
        this.scene.remove(tracer.mesh);
        this.tracerPool.push(tracer.mesh);
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
