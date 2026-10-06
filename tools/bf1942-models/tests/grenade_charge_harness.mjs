// Drives a grenade's two throws through `hand-fire.js` `footFire` outside a
// browser and prints one JSON blob (ledger GUN-19): the alt-fire button held
// for a while and let go, a tap of it, the fire button, and the charge the
// HUD's bar is handed (`soldier-hud.js` reads `hw.charge.heat`).
//
// The page is a stub: 60 fps frames, `footFire` each frame, and the gun's own
// round fired on the next 30 Hz tick after `setFiring` turns it on, its launch
// speed read off `group.stats.velocity` as `round-launch.js` reads it.

import { createHandFire } from './hand-fire.js';
import { ThrowCharge } from './throw-charge.js';

const VELOCITY = 25;          // the shape of a grenade's `velocity` (vanilla's is 25)

function grenade() {
  const group = { node: {}, stats: { velocity: VELOCITY, projectile: { kind: 'shell' } },
                  muzzles: [{}], shots: 0, firing: false };
  return {
    name: 'GrenadeAllies', group, rounds: 4, mags: 0, reload: 0, cool: 0,
    pulse: false, throwWind: 0, hideFire: 0, fovCur: 1, worldFov: 57.3,
    rezoom: 0, zoomed: false,
    data: { roundOfFire: 1, fireOnce: true, throw: { fireDelay: 1.0, hideDuringFireTime: 0.4 },
            heat: { heatAddWhenFire: 0.03, velocityDependentOnHeat: true },
            magazine: { size: 4, magazines: 1, reloadTime: 2 } },
    model: { onShot() {}, update() {}, current: () => 0 },
    rig: { position: { set() {} }, visible: true },
    pos: { x: 0, y: 0, z: 0 }, viewHip: { x: 0, y: 0, z: 0 }, viewZoom: { x: 0, y: 0, z: 0 },
    clips: {}, actions: {}, active: 'idle',
    charge: new ThrowCharge(0.03),
  };
}

function run(script) {
  const hw = grenade();
  const page = {
    guns: {
      onShot: null, bodyCast: () => null, firstPerson: false, rand: Math.random,
      setFiring(group, on) { group.firing = !!on; },
    },
    fireStates: new WeakMap(),
    get handWeapon() { return hw; },
    isExplosives: () => false, isDetonator: () => false, healingPack: () => null,
    itemsLocked: () => false, packThrown() {}, vehicleAudio: null,
    soldier: { stance: 'stand', gait: 'stand', grounded: true }, mouseInput: null,
    camera: { fov: 57.3, updateProjectionMatrix() {} },
    params: new URLSearchParams('shots'), captured: true,
    triggerHeld: false, clickQueued: false, aimHeld: false,
    dropClick() { page.clickQueued = false; },
    releaseHandFireLoop() {}, refetchHandFireSound() {}, playHandFire() {},
    playViewmodelClip() { return true; }, updateViewmodelAnimation() {},
  };
  const fire = createHandFire(page);
  const dt = 1 / 60;
  const out = { throws: [], bar: [] };
  let clock = 0;
  for (let frame = 0; frame < script.frames; frame++) {
    const t = frame * dt;
    script.input(page, t);
    fire.footFire(dt, null);
    out.bar.push(+hw.charge.heat.toFixed(4));
    // The world's ticks in this frame: the round of a gun the trigger holds.
    for (clock += dt; clock >= 1 / 30 - 1e-9; clock -= 1 / 30) {
      if (hw.group.firing) {
        out.throws.push({ t: +t.toFixed(4), velocity: +hw.group.stats.velocity.toFixed(4) });
        hw.group.shots += 1;
        page.guns.onShot(hw.group, 1);
        page.guns.setFiring(hw.group, false);
      }
    }
  }
  out.after = { heat: hw.charge.heat, velocity: hw.group.stats.velocity, rounds: hw.rounds };
  out.peak = Math.max(...out.bar);
  const full = out.bar.findIndex(b => b >= 1);
  out.fullAt = full < 0 ? null : +(full * dt).toFixed(4);
  return out;
}

const out = {
  // Alt-fire held half a second (from t = 0.1), then let go.
  half: run({ frames: 240, input: (page, t) => { page.aimHeld = t >= 0.1 && t < 0.6; } }),
  // Held two seconds: full at 34 ticks, and no further.
  full: run({ frames: 300, input: (page, t) => { page.aimHeld = t >= 0.1 && t < 2.1; } }),
  // Two frames of alt-fire, one world tick: its 0.03, a throw at the feet.
  tap: run({ frames: 180, input: (page, t) => { page.aimHeld = t >= 0.1 && t < 0.13; } }),
  // The fire button: full strength, the bar at 1 through the wind-up.
  click: run({ frames: 180, input: (page, t) => {
    if (t >= 0.1 && t < 0.11) { page.clickQueued = true; page.triggerHeld = true; } else page.triggerHeld = false;
  } }),
};
for (const run of Object.values(out)) delete run.bar;
out.click.barDuringWindUp = run({ frames: 40, input: (page, t) => {
  if (t >= 0.1 && t < 0.11) { page.clickQueued = true; page.triggerHeld = true; } else page.triggerHeld = false;
} }).peak;
console.log(JSON.stringify(out));
