// `fireDelay` weapons through `hand-fire.js` `footFire` under node, and one
// JSON blob: when the trigger starts the arms' clip, when the round leaves,
// when the report plays, and whether the weapon is in the hand, for a rifle
// grenade, a hand grenade and FHSW's Molotov (no `fireOnce`).
//
// The engine's reading (`hand-fire.js` `reportsOnRound`): `FireArms::Fire`
// on the trigger flags the shot pending and returns; `handleUpdate` fires it
// `fireDelay` later, and only that call triggers the Fire slot. The page is a
// stub at 60 fps; the gun's own round is fired on the next 30 Hz tick after
// `setFiring` turns it on, `onShot` first, in `gunfire.js` `fireShot`'s order.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

// argv[2], when given, is another viewer tree to load (a before/after run).
const viewer = viewerDir(process.argv[2] ?? null);
installModuleHooks(viewer);
const { createHandFire } = await import(pathToFileURL(path.join(viewer, 'hand-fire.js')).href);

// The weapons' own words, as the exporter files them (`extras.weapon`).
const WEAPONS = {
  // FHSW `K98Grenade`: a launcher on the rifle, no `hideDuringFireTime`.
  rifleGrenade: { roundOfFire: 1, fireOnce: true, throw: { fireDelay: 0.8 },
                  magazine: { size: 1, magazines: 2, reloadTime: 5, autoReload: true } },
  // Vanilla `GrenadeAllies`.
  handGrenade: { roundOfFire: 1, fireOnce: true,
                 throw: { fireDelay: 1.0, hideDuringFireTime: 0.4, rotationalSpeed: [8, 0, 0] },
                 magazine: { size: 4, magazines: 1, reloadTime: 2, autoReload: true } },
  // FHSW `Molli`: no `fireOnce`, so the trigger's message comes every tick held.
  molotov: { roundOfFire: 1,
             throw: { fireDelay: 0.8, hideDuringFireTime: 0.4, rotationalSpeed: [8, 0, 0] },
             magazine: { size: 3, magazines: 1, reloadTime: 2, autoReload: false } },
};

function handWeapon(data, { rounds = data.magazine.size, mags = 0 } = {}) {
  const group = { node: {}, stats: { velocity: 25, projectile: { kind: 'shell' } },
                  muzzles: [{}], shots: 0, firing: false };
  return {
    name: 'weapon', group, rounds, mags, reload: 0, cool: 0,
    pulse: false, throwWind: 0, hideFire: 0, fovCur: 1, worldFov: 57.3,
    rezoom: 0, zoomed: false, data,
    fire: { spec: {} },
    weaponNode: { visible: true },
    model: { onShot() {}, update() {}, current: () => 0 },
    rig: { position: { set() {} }, visible: true },
    pos: { x: 0, y: 0, z: 0 }, viewHip: { x: 0, y: 0, z: 0 }, viewZoom: { x: 0, y: 0, z: 0 },
    clips: {}, actions: {}, active: 'idle',
  };
}

/** `seconds` of frames; `input(page, t)` sets the buttons each frame. */
function run(data, { seconds, input, rounds, mags }) {
  const hw = handWeapon(data, { rounds, mags });
  const log = { clips: [], reports: [], rounds: [], hidden: [], switches: [] };
  let now = 0;
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
    releaseHandFireLoop() {}, refetchHandFireSound() {},
    playHandFire() { log.reports.push(+now.toFixed(4)); },
    playViewmodelClip() { log.clips.push(+now.toFixed(4)); return true; },
    updateViewmodelAnimation() {},
    // `BFSoldier::selectBestLoadedWeapon` (`kit-select.js`): logged, and
    // answered "nothing else came up", so the weapon stays the harness's.
    selectBestLoadedWeapon() { log.switches.push(+now.toFixed(4)); return false; },
  };
  const fire = createHandFire(page);
  const dt = 1 / 60;
  let clock = 0;
  let wasVisible = true;
  for (let frame = 0; frame * dt < seconds; frame++) {
    now = frame * dt;
    input(page, now);
    fire.footFire(dt, null);
    for (clock += dt; clock >= 1 / 30 - 1e-9; clock -= 1 / 30) {
      if (hw.group.firing) {
        page.guns.onShot(hw.group, 1);
        log.rounds.push(+now.toFixed(4));
        hw.group.shots += 1;
      }
    }
    const visible = !!hw.weaponNode.visible;
    if (visible !== wasVisible) log.hidden.push({ t: +now.toFixed(4), visible });
    wasVisible = visible;
  }
  log.end = { rounds: hw.rounds, mags: hw.mags, visible: hw.weaponNode.visible };
  return log;
}

const click = (...ats) => (page, t) => {
  const down = ats.some(at => t >= at && t < at + 0.01);
  if (down && !page.triggerHeld) page.clickQueued = true;
  page.triggerHeld = down;
};
const hold = (from, to) => (page, t) => {
  const down = t >= from && t < to;
  if (down && !page.triggerHeld) page.clickQueued = true;
  page.triggerHeld = down;
};

const out = {
  // One click at 0.1 s with the last grenade on the rifle.
  rifleGrenade: run(WEAPONS.rifleGrenade, { seconds: 3, input: click(0.1), rounds: 1, mags: 0 }),
  // The same launcher saying `changeWeaponWhenNoAmmo 1`, as FHSW's do.
  rifleGrenadeSwitch: run({ ...WEAPONS.rifleGrenade,
                            magazine: { ...WEAPONS.rifleGrenade.magazine, changeWeaponWhenNoAmmo: true } },
                          { seconds: 3, input: click(0.1), rounds: 1, mags: 0 }),
  handGrenade: run(WEAPONS.handGrenade, { seconds: 3, input: click(0.1), rounds: 1, mags: 0 }),
  // The last grenade of a pouch of two: the fist keeps one after the first.
  handGrenadeTwo: run(WEAPONS.handGrenade, { seconds: 6, input: click(0.1, 3.0),
                                             rounds: 2, mags: 0 }),
  // A click on the Molotov: one throw, its report on the round.
  molotovClick: run(WEAPONS.molotov, { seconds: 3, input: click(0.1) }),
  // The Molotov's trigger held 0.1..4.0 s: a throw a wind-up plus a cycle.
  molotovHeld: run(WEAPONS.molotov, { seconds: 6, input: hold(0.1, 4.0) }),
};
console.log(JSON.stringify(out));
