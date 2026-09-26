// A gun's own per-frame cycle, apart from its rounds: the muzzle flash
// emitters replaying their ramps, the barrel's recoil and recovery, and the
// rate-of-fire timer that turns a held trigger into shots. Split out of
// `gunfire.js`; `advanceGroups` takes the `GunFire` instance (`guns`) whose
// groups it steps and whose `fireShot` it calls.

import * as THREE from 'three';
import { sampleCurve } from './round-visuals.js';

// `recoilSize 3` as 3 m of barrel travel is not a picture; a tenth reads as
// a gun. Recovery runs at the same scale so size/speed keeps the engine's
// ratio (Sherman: 0.3 m kick recovered in 0.3 s).
export const RECOIL_KICK_SCALE = 0.1;
// `fx_MuzzHeavy` ramps sizeOverTime 0.12 -> 9.4 on a mesh already 1.76 m
// long: replayed as absolute node scale that is a 16.5 m fireball. In game
// the late ramp plays on particles that have left the muzzle; parked here,
// the scale gets a lid instead.
export const FLASH_RAMP_MAX = 3;

const _billboard = new THREE.Quaternion();
const _spinAxis = new THREE.Vector3(0, 0, 1);
const _drift = new THREE.Vector3();
// Scratch for the per-frame and per-shot paths below: a flash's roll, a
// gun's recoil offset and a round's unit direction were each a fresh
// allocation before, per emitter per frame and per shot, and a frame that
// allocates is a frame that will pay for it at the collector's convenience
// (features/mesh-viewer-performance, rule 5).
const _spin = new THREE.Quaternion();
const _recoil = new THREE.Vector3();

/** Advance every group's flashes, recoil and firing cadence. True while any is active. */
export function advanceGroups(guns, dt) {
  let active = false;
  for (const group of guns.groups) {
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
          // The ramp is D3D's gamma-space vertex colour, like `effects.js`'s.
          material.color.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
          material.opacity = a / 255;
        }
      }
      if (emitter.spec.billboard) {
        // Face the camera, then the per-shot roll about the view axis.
        emitter.node.parent.getWorldQuaternion(_billboard).invert();
        emitter.node.quaternion.copy(_billboard).multiply(guns.camera.quaternion)
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
        guns.fireShot(group);
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
  return active;
}
