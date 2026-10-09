// A gun's own per-frame cycle, apart from its rounds: the muzzle flash
// emitters replaying their ramps, the barrel's recoil and recovery, and the
// rate-of-fire timer that turns a held trigger into shots. Split out of
// `gunfire.js`; `advanceGroups` takes the `GunFire` instance (`guns`) whose
// groups it steps and whose `fireShot` it calls.

import * as THREE from 'three';
import { sampleCurve } from './round-visuals.js';
import { syncLoadedRounds } from './loaded-rounds.js';

// The barrel's recoil, as `FireArms::handleUpdate` (lnxded `0x08288890`,
// ledger GUN-12) poses it. A round sets a countdown `tau = 3.14 /
// recoilSpeed` (`FireArms::Fire` `0x0828a209`, the constant is 3.14 and not
// pi); every tick after that the FireArms stands at its rest position plus
// `sin(recoilSpeed * tau) * recoilSize * 0.05 * -0.5` along its own forward
// axis, and `tau` runs down by the tick's dt. So the kick is a half sine
// `0.025 * recoilSize` metres deep that lasts `3.14 / recoilSpeed` seconds:
// the Sherman's `recoilSize 3` / `recoilSpeed 10` is 7.5 cm over 0.31 s, DC's
// M1A1 (15 / 10) 37.5 cm, the M-109 (40 / 10) a metre. A template that
// declares no `recoilSpeed` (the ctor's 0) never moves; one that declares no
// `recoilSize` kicks at the ctor's 1.0.
export const RECOIL_DEPTH_PER_SIZE = 0.05 * 0.5;
export const RECOIL_HALF_TURN = 3.14;
/** @deprecated The viewer's old guess at the depth (0.1 x `recoilSize`). */
export const RECOIL_KICK_SCALE = RECOIL_DEPTH_PER_SIZE;

/** Seconds a round's kick lasts: `3.14 / recoilSpeed`, 0 for a gun that
 *  declares no speed (the template ctor's 0, which `handleUpdate` skips). */
export function recoilSpan(recoil) {
  const speed = recoil?.speed ?? 0;
  return speed > 0 ? RECOIL_HALF_TURN / speed : 0;
}
// A lid on a parked sprite's `size x sizeOverTime`. The ramps were authored
// for particles that stream away from the muzzle (the Defgun's flare leaves
// at -60 m/s); parked on it, the tail would read as a fireball. Mesh flashes
// no longer ramp at all (IMP-5, see `advanceGroups`).
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
      //
      // This is the fallback: with the effect library loaded the map page
      // plays the bundle itself (round-launch.js `playMuzzleBundles`) and
      // these nodes stay dark. Even so it keeps the engine's size rules
      // (ledger IMP-5): a sprite is `size x sizeOverTime`; a mesh particle
      // with no `sizeModifier` draws at its authored size whatever its ramp
      // says -- `em_MuzzHeavy` has no `size` and no modifier, only the
      // 0.12 -> 9.4 ramp, and replaying that ramp is what made every
      // vehicle MG's flash a fireball. The baked extras carry no modifier,
      // so a mesh that declares a `size` (the `em_1P_*` flashes, all
      // `sizeModifier 1/1/1`) keeps it, and one that declares only a ramp
      // is drawn at 1.
      const ramp = emitter.spec.sizeOverTime
        ? sampleCurve(emitter.spec.sizeOverTime, phase)[0] : 1;
      // A sprite's `size` is a half-extent on the baked +-0.5 quad (ledger
      // SPR-7, `effects.js` SPRITE_QUAD_SPAN), hence the 2.
      const size = emitter.spec.kind === 'mesh'
        ? (emitter.spec.size ?? 1)
        : 2 * (emitter.spec.size ?? 1) * ramp;
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
    // The trigger, then the gun's own update: the engine's order inside one
    // tick (the player's input is handled before the world updates, GL-1).
    // `cooldown` is `timeToFireFinished` (`FireArms+0x170`): a round SETS it
    // to `1 / roundOfFire` (`Fire` `0x0828a230`, from `+0x234`), it is not
    // added to, and `handleUpdate` takes the tick's dt off it while it is
    // positive. `handleMessage` `0x082895c0` lets the fire message through
    // only while it is spent (`<= 0`, the `test 0x100` at `0x08289921`), and
    // the message comes once a tick. So one call fires at most one round,
    // whatever `roundOfFire` says, and a gun's real rate is `30 / ceil(30 /
    // roundOfFire)` on the 30 Hz tick (ledger GUN-13): DC Final's Patriot
    // (`roundOfFire 100000`) fires once, not 3,334 times in a frame, and a
    // `roundOfFire 12` coaxial fires every third tick, ten a second. Both
    // numbers are floats in the engine and the timer is stored back to one
    // every tick, so the count is taken in float32 too: that is what makes a
    // `roundOfFire 5` gun wait a seventh tick (`0.2f` minus six `1/30f` is
    // still above zero) and fire 4.29 rounds a second, not 5.
    if (group.firing) {
      active = true;
      // `handleMessage` marks the trigger held (`+0x225`) on every tick the
      // fire message passes the reload and overheat gates, round or no round
      // (`0x08289907`): a held trigger never releases between its rounds.
      group.soundHeld = true;
      if (group.cooldown <= 0 && hasRound(guns, group)) {
        guns.fireShot(group);
        group.cooldown = firePeriod(group.stats.roundOfFire);
      }
    } else if (group.sounding) {
      // A replayed gun has no trigger, only its rounds: its burst is the
      // window `replay-hulls.js` `holdSound` keeps open past each round, the
      // same one that gates its Fire Loop. The player behind it held his
      // trigger between those rounds, so it releases when the window shuts,
      // not 50 ms after every round.
      group.soundHeld = true;
    }
    if (group.cooldown > 0) {
      // Runs with the trigger released too -- see `setFiring` for why -- and
      // stops at the first tick that spends it, as `handleUpdate` does.
      // Floored where the engine leaves it negative: nothing reads the
      // remainder, because the next round sets the timer rather than adding.
      group.cooldown = Math.max(0, Math.fround(group.cooldown - Math.fround(dt)));
      active = true;
    }
    if (poseRecoil(group, dt)) active = true;
    if (releaseTick(guns, group, dt)) active = true;
    // The pylons follow the magazine, after this tick's round has been
    // billed: `roundsLeft` is the page's hook onto the seat's `FireState`
    // (hand-fire.js), Infinity where there is none (`loaded-rounds.js`).
    if (group.loadedRounds) syncLoadedRounds(group.node, guns.roundsLeft?.(group) ?? Infinity);
  }
  return active;
}

/** "Stopped" is no round for longer than this: 1 / `Sound.soundStreamUpdate
 *  Frequency`, 20 in `Settings/Default.con` and the `SoundSetup` default. */
export const RELEASE_AFTER = 1 / 20;

/**
 * `FireArms::updateSound` (lnxded `0x0828cc10`, client `0x00539fb0`), the
 * last thing `handleUpdate` does each tick: once the last round is more than
 * `RELEASE_AFTER` old, a tick whose trigger was not held (or whose magazine is
 * empty) releases the burst -- once, until the next round (`+0x226`) -- and
 * any tick past that point clears the held mark. The release is Fire Loop
 * released, Release and Shell Bounce triggered, and MG distance too when
 * `+0x228` (seconds since it last played) has passed `+0x22c`, which is then
 * re-rolled to 0.5..1.5 s (ledger SND-12, SND-16). The FireArms ctor starts
 * the gate at 1 s with nothing to release (`0x08286470`).
 *
 * `guns.onRelease(group, { distance })` is told; the rounds' own `onShot`
 * already carries Fire and Fire Loop. True while a release is still owed.
 */
function releaseTick(guns, group, dt) {
  const last = group.sinceRound ?? Infinity;
  group.sinceRound = last + dt;
  group.sinceDistance = (group.sinceDistance ?? 0) + dt;
  if (!(last > RELEASE_AFTER)) return true;
  if (!group.soundHeld || magazineEmpty(guns, group)) {
    if (group.soundReleased === false) {
      const gate = group.distanceGate ?? 1;
      const distance = group.sinceDistance > gate;
      if (distance) {
        group.sinceDistance = 0;
        group.distanceGate = (guns.rand ?? Math.random)() + 0.5;
      }
      group.soundReleased = true;
      guns.onRelease?.(group, { distance });
    }
  }
  group.soundHeld = false;
  return group.soundReleased === false;
}

/** `mags()` holds no magazine, or the loaded one is empty. Unlimited (the
 *  -1 sentinel, or a page with no magazine hook) is never empty. */
function magazineEmpty(guns, group) {
  const left = guns.roundsLeft?.(group);
  return left != null && left <= 0;
}

/**
 * `timeToFireFinished` as a round sets it: the FireArms ctor's `1 /
 * roundOfFire` (`0x08286870` into `+0x234`), a float. A template that
 * declares no rate keeps the template ctor's 10 (`0x0828d4e0`, AI-133).
 */
export const DEFAULT_ROUND_OF_FIRE = 10;
export function firePeriod(roundOfFire) {
  const rate = roundOfFire > 0 ? roundOfFire : DEFAULT_ROUND_OF_FIRE;
  return Math.fround(1 / Math.fround(rate));
}

/**
 * Whether the magazine still holds a round for the next pull. `Fire` fires a
 * barrel only while `mags() > 0` or the magazine is the -1 sentinel (lnxded
 * `0x0828a1f8`); the page's `roundsLeft` hook is that count, and unset means
 * unlimited (the model browser's turntable).
 */
function hasRound(guns, group) {
  const left = guns.roundsLeft?.(group);
  return left == null || !(left <= 0);
}

/**
 * Stand the gun where its recoil puts it this tick, and run the countdown
 * down (GUN-12, see `RECOIL_DEPTH_PER_SIZE`). `group.recoil` is the engine's
 * `+0x250`, seconds of kick left; null for a gun that never recoils. True
 * while the barrel is out of battery.
 */
function poseRecoil(group, dt) {
  if (group.recoil == null) return false;
  const home = group.node.userData.home;
  const tau = group.recoil;
  const recoil = group.stats.recoil;
  const speed = recoil?.speed ?? 0;
  if (!(tau > 0) || !(speed > 0)) {
    // `+0x250 <= 0`: the rest position, written every tick (`0x08288f37`).
    group.recoil = 0;
    if (home && !group.node.position.equals(home)) group.node.position.copy(home);
    return false;
  }
  if (home) {
    // Clamped to +-1000 rad before the sine (`0x08288c84`), as the engine does.
    const phase = Math.min(1000, Math.max(-1000, speed * tau));
    const depth = (recoil.size ?? 1) * RECOIL_DEPTH_PER_SIZE * Math.sin(phase);
    // The engine moves the FireArms along minus its own forward (row 2 of its
    // local matrix). The mesh was Z-mirrored into glTF, so it points down -Z
    // and that is +Z of its own frame here.
    _recoil.set(0, 0, depth).applyQuaternion(group.node.quaternion);
    group.node.position.copy(home).add(_recoil);
  }
  group.recoil = tau - dt;
  return true;
}
