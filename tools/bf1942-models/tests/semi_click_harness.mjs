// A semi-auto's clicks against its cycle, as the lab server takes them
// (test_semi_click.py; lab/mag_cycle_probe.mjs with PHASES=semi). Drives
// `hand-fire.js` over a stub page in map.html `frame()`'s order, as
// hand_trigger_tick_harness.mjs does, with the world's tick counter the click
// rule reads (`page.world.ticks`) and each tick's word's Fire bit as
// local-player.js builds it: the held button, or a semi-auto click the hand
// made since the last frame (page-input.js `wireFirePress`), carried over a frame
// that ran no tick (net-room.js ONE_SHOT_BITS). A Colt-like pistol,
// `roundOfFire 6`: a 6-tick cycle (GUN-13).
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir(process.argv[2] ?? null);
installModuleHooks(viewer);
const { createHandFire } = await import(pathToFileURL(path.join(viewer, 'hand-fire.js')).href);
const { advanceGroups } = await import(pathToFileURL(path.join(viewer, 'gun-cycle.js')).href);

const TICK = 1 / 30;
const COLT = { roundOfFire: 6, fireOnce: true, magazine: { size: 70, magazines: 1, reloadTime: 2 } };

function handWeapon(data) {
  const group = { node: { userData: {} }, stats: { roundOfFire: data.roundOfFire, velocity: 25,
                                                   projectile: { kind: 'bullet' } },
                  muzzles: [{}], emitters: [], shots: 0, firing: false, cooldown: 0, recoil: null };
  return {
    name: 'weapon', group, rounds: data.magazine.size, mags: data.magazine.magazines, reload: 0,
    cool: 0, pulse: false, throwWind: 0, hideFire: 0, fovCur: 1, worldFov: 57.3,
    rezoom: 0, zoomed: false, data, fire: { spec: {} }, weaponNode: { visible: true },
    model: { onShot() {}, update() {}, current: () => 0 },
    rig: { position: { set() {} }, visible: true },
    pos: { x: 0, y: 0, z: 0 }, viewHip: { x: 0, y: 0, z: 0 }, viewZoom: { x: 0, y: 0, z: 0 },
    clips: {}, actions: {}, active: 'idle',
  };
}

/** `downAt(f)`: the button is down at frame f's input phase. */
function run(data, frames, downAt, quickAt = () => false) {
  const hw = handWeapon(data);
  const rounds = [];
  const wires = [];
  let tick = 0;
  const page = {
    guns: {
      onShot: null, bodyCast: () => null, firstPerson: false, rand: Math.random,
      groups: [hw.group], camera: null, roundsLeft: () => Infinity,
      setFiring(group, on) {
        if (!group || group.firing === !!on) return false;
        group.firing = !!on;
        return true;
      },
      fireShot(group) {
        this.onShot?.(group, 1);
        rounds.push(tick);
        group.shots += 1;
      },
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
    selectBestLoadedWeapon() { return false; },
    world: { ticks: 0 },
  };
  const fire = createHandFire(page);
  let acc = 0;
  let pending = false;   // a zero-tick frame's click, for the next word
  for (let f = 0; f < frames.length; f++) {
    const dt = frames[f];
    const isDown = !!downAt(f);
    let firePress = false;
    if (isDown && !page.triggerHeld) {
      page.clickQueued = true;
      // page-input.js: the press, spent by this frame's word for a semi-auto.
      firePress = !!data.fireOnce;
    }
    // A click that went down and up between two input phases.
    if (quickAt(f)) {
      page.clickQueued = true;
      firePress = !!data.fireOnce;
    }
    page.triggerHeld = isDown;
    const wordFire = isDown || firePress || pending;
    fire.footTrigger(dt, true);
    acc += dt;
    let n = 0;
    while (acc >= TICK - 1e-9) {
      acc -= TICK;
      n++;
      tick++;
      page.world.ticks = tick;
      if (wordFire) wires.push(tick);
      advanceGroups(page.guns, TICK);
    }
    pending = n === 0 ? (pending || firePress) : false;
    fire.footFire(dt, null);
  }
  return { rounds, wires };
}

// The button is down on the words of these world ticks (1-based). At each
// frame rate, the frames whose input phase falls in such a tick hold it down.
const RATES = { fps30: 1 / 30, fps60: 1 / 60 };
function scenario(downTicks) {
  const want = new Set(downTicks);
  const out = {};
  for (const [name, dt] of Object.entries(RATES)) {
    const n = Math.round(80 * TICK / dt);
    const frames = Array.from({ length: n }, () => dt);
    // Frame f's word is consumed by the first tick at or after it.
    const tickOf = f => Math.floor((f * dt) / TICK + 1e-6) + 1;
    out[name] = run(COLT, frames, f => want.has(tickOf(f)));
  }
  return out;
}
const span = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
console.log(JSON.stringify({
  // G3 / G4: a one-word tap, then another 3 or 5 ticks into the cycle.
  tapThenTap3: scenario([10, 13]),
  tapThenTap5: scenario([10, 15]),
  // On the cycle's first ready tick: 6 ticks after.
  tapThenTap6: scenario([10, 16]),
  // G2: a tap, then a press 2 ticks later held for 13 ticks.
  tapThenHeld: scenario([10, ...span(12, 24)]),
  // A click shorter than a frame, at 60 fps: down and up before the input
  // phase of frame 21 (tick 11) samples the button.
  quickClick: { fps60: run(COLT, Array.from({ length: 160 }, () => 1 / 60), () => false, f => f === 21) },
  // H2: taps every 2 ticks.
  tapsEvery2: scenario(span(0, 11).map(i => 10 + 2 * i)),
}));
