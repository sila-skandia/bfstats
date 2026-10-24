// Which world tick the page's own hand-weapon round leaves on, against the tick
// whose input word first carried the press. Drives `hand-fire.js` over a stub
// page in map.html `frame()`'s order and the gun's real per-tick cycle
// (`gun-cycle.js` `advanceGroups`, the group cooldown GUN-13 counts):
//
//   sample the frame's input -> `footTrigger` -> the frame's world ticks
//   (`guns.advance`, rounds through `fireShot`'s `onShot` first) -> `footFire`
//
// and, as `order: 'old'`, the order the page ran until 2026-10-24, where the
// whole trigger ran in `footFire` after the ticks. A real server fires the
// press on the first word that carries it (features/udp-sidecar/wire.md
// section 42); a word is consumed by the first tick at or after the frame
// that sampled it, so a press in a frame that runs no tick is the next tick's.
//
// Prints one JSON blob: for each run, the ticks the words carried the trigger
// down from (`presses`), the ticks rounds left on (`rounds`), and the frames'
// tick counts.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir(process.argv[2] ?? null);
installModuleHooks(viewer);
const { createHandFire } = await import(pathToFileURL(path.join(viewer, 'hand-fire.js')).href);
const { advanceGroups, fireTicks } = await import(pathToFileURL(path.join(viewer, 'gun-cycle.js')).href);
const { delayTicks } = await import(pathToFileURL(path.join(viewer, 'fire-timer.js')).href);

const TICK = 1 / 30;

const WEAPONS = {
  // A bolt rifle's semi-auto pull (vanilla `Kar98k`-like: `fireOnce`, slow cycle).
  rifle: { roundOfFire: 0.5, fireOnce: true, magazine: { size: 5, magazines: 4, reloadTime: 3 } },
  // A semi-auto whose cycle is ONE tick: a pull held over a frame of two ticks
  // would fire twice if the pulse kept the trigger down past its round.
  fastSemi: { roundOfFire: 60, fireOnce: true, magazine: { size: 50, magazines: 1, reloadTime: 2 } },
  // A held automatic (`Thompson`, `roundOfFire 12`: every 3rd tick).
  smg: { roundOfFire: 12, magazine: { size: 200, magazines: 1, reloadTime: 2 } },
  // A held automatic at `roundOfFire 9.17` (FHSW Greasegun: every 4th tick).
  greasegun: { roundOfFire: 9.17, magazine: { size: 200, magazines: 1, reloadTime: 2 } },
  // A hand grenade: `fireDelay 0.8`, its round 23 ticks after the press.
  grenade: { roundOfFire: 1, fireOnce: true, throw: { fireDelay: 0.8 },
             magazine: { size: 4, magazines: 1, reloadTime: 2 } },
};

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

/**
 * `frames` is the list of frame lengths in seconds. `down(f)` says whether
 * the button is down in frame `f` (sampled at the frame's input phase); a
 * press queues one click, as `page-input.js` does on mousedown.
 */
function run(data, { frames, down, order = 'new' }) {
  const hw = handWeapon(data);
  const page = {
    guns: {
      onShot: null, bodyCast: () => null, firstPerson: false, rand: Math.random,
      groups: [hw.group], camera: null,
      roundsLeft: () => Infinity,
      setFiring(group, on) {
        if (!group || group.firing === !!on) return false;
        group.firing = !!on;
        return true;
      },
      // `gunfire.js` `fireShot`'s order: `onShot` first, then the barrel,
      // which counts the projectile (`fireBarrel`'s `group.shots += 1`).
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
  };
  const fire = createHandFire(page);
  const rounds = [];
  const presses = [];
  const frameTicks = [];
  let tick = 0;          // the tick being run (1-based once the first runs)
  let acc = 0;
  let wordDown = false;  // the last word's trigger bit
  let pressPending = false;
  for (let f = 0; f < frames.length; f++) {
    const dt = frames[f];
    // The input phase: the devices, then the frame's word.
    const isDown = !!down(f);
    if (isDown && !page.triggerHeld) page.clickQueued = true;
    page.triggerHeld = isDown;
    if (isDown && !wordDown) pressPending = true;
    wordDown = isDown;
    if (order === 'new') fire.footTrigger(dt, true);
    // The world's step: whole ticks off the accumulator.
    acc += dt;
    let n = 0;
    while (acc >= TICK - 1e-9) {
      acc -= TICK;
      n++;
      tick++;
      // The tick consumes the word: its first one carrying the press is the press's tick.
      if (pressPending) { presses.push(tick); pressPending = false; }
      advanceGroups(page.guns, TICK);
    }
    frameTicks.push(n);
    // The presentation: `footFire` (which, in the old order, is the whole trigger).
    fire.footFire(dt, null);
  }
  return { presses, rounds, frameTicks };
}

const frames = (count, dt) => Array.from({ length: count }, () => dt);
// 15 fps: every frame runs two ticks.
const F15 = frames(60, 2 / 30);
// 60 fps: ticks on every other frame (frame 0 runs none, frame 1 one, ...).
const F60 = frames(240, 1 / 60);
// A ragged mix: 60, 30, 20 and 15 fps frames.
const MIXED = Array.from({ length: 200 }, (_, i) => [1 / 60, 1 / 30, 1 / 20, 2 / 30][i % 4]);

const out = { fireTicks: { rifle: fireTicks(0.5), fastSemi: fireTicks(60), smg: fireTicks(12),
                           greasegun: fireTicks(9.17) },
              grenadeDelayTicks: delayTicks(0.8) };
for (const order of ['new', 'old']) {
  out[order] = {
    // A press sampled in a frame that runs two ticks.
    rifleTwoTickFrame: run(WEAPONS.rifle, { frames: F15, down: f => f === 5, order }),
    // A press sampled in a frame that runs no tick (60 fps, an even frame) ...
    rifleZeroTickFrame: run(WEAPONS.rifle, { frames: F60, down: f => f === 10, order }),
    // ... and one in a frame that runs one.
    rifleOneTickFrame: run(WEAPONS.rifle, { frames: F60, down: f => f === 11, order }),
    // A one-tick-cycle semi-auto clicked in a two-tick frame: one round.
    fastSemiTwoTickFrame: run(WEAPONS.fastSemi, { frames: F15, down: f => f === 5, order }),
    // ... held across many two-tick frames: still one round per press.
    fastSemiHeld: run(WEAPONS.fastSemi, { frames: F15, down: f => f >= 5 && f < 20, order }),
    // Rifle clicks spammed every frame for two seconds at 60 fps: the cycle paces them.
    rifleSpam: run(WEAPONS.rifle, { frames: F60, down: f => f >= 10 && f < 400 && f % 2 === 0, order }),
    // Held automatics.
    smgHeld60: run(WEAPONS.smg, { frames: F60, down: f => f >= 11 && f < 131, order }),
    smgHeld15: run(WEAPONS.smg, { frames: F15, down: f => f >= 3 && f < 33, order }),
    greasegunHeldMixed: run(WEAPONS.greasegun, { frames: MIXED, down: f => f >= 7 && f < 150, order }),
    // A grenade's wind-up: its round `delayTicks` after the press's tick.
    grenadeTwoTickFrame: run(WEAPONS.grenade, { frames: F15, down: f => f === 5, order }),
    grenadeOneTickFrame: run(WEAPONS.grenade, { frames: F60, down: f => f === 11, order }),
  };
}
console.log(JSON.stringify(out));
