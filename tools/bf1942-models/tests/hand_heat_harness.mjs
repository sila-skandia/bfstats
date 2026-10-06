// Drives a hand machine gun's heat outside a browser and prints one JSON blob:
// which items get a heat at all (`kit-ammo.js` `itemHeat`), what the HUD is
// handed (`soldier-hud.js` `writeSoldierAmmo`), and what a held trigger does
// to Desert Combat's M249 and PKM under the vehicle guns' law
// (`fire-state.js` `FireState`, ledger GUN-14 and GUN-15).
//
// The held trigger is the page's order (`hold`, below), each pull billed once
// (`registerShot(1)`, the hand weapon's `onShot`). The magazine is left out:
// this is the barrel alone.

import { KitAmmo, itemHeat } from './kit-ammo.mjs';
import { FireState } from './fire-state.js';
import { writeSoldierAmmo } from './soldier-hud.js';

// The weapons' blocks as `extract_viewmodel.py` writes them (`weaponStats`),
// from Desert Combat 0.7's `Objects.rfa`.
const M249 = {
  roundOfFire: 13.5, hudAmmo: 'ATIconAndStrengthBar',
  magazine: { size: 200, magazines: 3, type: 0, reloadTime: 3.8 },
  heat: { heatAddWhenFire: 0.0265, coolDownPerSec: 0.3, timeDelayOnOverheat: 2.0 },
};
const PKM = {
  roundOfFire: 10, hudAmmo: 'ATIconAndStrengthBar',
  magazine: { size: 100, magazines: 3, type: 0, reloadTime: 4 },
  heat: { heatAddWhenFire: 0.03, coolDownPerSec: 0.3, timeDelayOnOverheat: 2.0 },
};
const GRENADE = {
  roundOfFire: 1, hudAmmo: 'ATIconAndStrengthBar',
  magazine: { size: 3, magazines: 1, type: 0, reloadTime: 2.0 },
  heat: { heatAddWhenFire: 0.03, velocityDependentOnHeat: true },
};
const RIFLE = { roundOfFire: 13, hudAmmo: 'ATAmmoBar', magazine: { size: 30, magazines: 5 } };

const out = {};

// --- which items have a heat ------------------------------------------------
{
  const kit = new KitAmmo();
  const m249 = kit.entry('M249', M249.magazine);
  const heat = itemHeat(m249, M249);
  heat.registerShot(1);
  const afterOne = heat.heat;
  const again = itemHeat(kit.entry('m249', M249.magazine), M249);
  kit.refill();
  const afterRefill = heat.heat;
  const adopted = new KitAmmo();
  adopted.adopt(kit.snapshot());
  const picked = itemHeat(adopted.entry('M249', M249.magazine), M249);
  kit.reset();
  const respawned = itemHeat(kit.entry('M249', M249.magazine), M249);
  out.items = {
    m249: !!heat,
    pkm: !!itemHeat(kit.entry('PKM', PKM.magazine), PKM),
    grenade: itemHeat(kit.entry('GrenadeAllies', GRENADE.magazine), GRENADE),
    rifle: itemHeat(kit.entry('M16', RIFLE.magazine), RIFLE),
    noEntry: itemHeat(null, M249),
    afterOne,
    sameAcrossRaise: again === heat,
    afterRefill,
    pickedUpCold: picked?.heat ?? null,
    respawnedCold: respawned !== heat && respawned.heat === 0,
  };
}

// --- what the HUD is handed -------------------------------------------------
{
  const vars = {};
  writeSoldierAmmo(vars, M249, 150, 2, 0.4);
  const hot = { ...vars };
  writeSoldierAmmo(vars, RIFLE, 30, 4, null);
  const swapped = { ...vars };
  out.hud = {
    hotHeat: hot['Overheat/OverHeat'] ?? null,
    hotAmmoType: hot['Ammo/AmmoType'] ?? null,
    hotRounds: hot['Ammo/PrimaryAmmo'] ?? null,
    swappedHeat: swapped['Overheat/OverHeat'] ?? null,
  };
}

// --- a held trigger -----------------------------------------------------------
/**
 * Hold the trigger for `seconds` at `fps`, the magazine left out. The page's
 * order: each rendered frame `footFire` steps the heat and sets the trigger
 * from `canFire`; the world's 30 Hz ticks in that frame then fire the gun
 * (`gun-cycle.js`: a round sets the timer to `1 / roundOfFire` and the tick
 * takes its 1/30 s off it, so a gun fires on whole ticks).
 */
function hold(data, seconds, fps = 60) {
  const kit = new KitAmmo();
  const heat = itemHeat(kit.entry('gun', data.magazine), data);
  const dt = 1 / fps;
  const tick = Math.fround(1 / 30);
  const period = Math.fround(1 / Math.fround(data.roundOfFire));
  let clock = 0;
  let cooldown = 0;
  let rounds = 0;
  let firstRefused = null;
  let peak = 0;
  const shots = [];
  for (let frame = 0, t = 0; t < seconds; frame++, t = frame * dt) {
    heat.step(dt);
    const firing = heat.canFire;
    if (!firing && firstRefused === null) firstRefused = { t, rounds };
    for (clock += dt; clock >= 1 / 30 - 1e-9; clock -= 1 / 30) {
      if (firing && cooldown <= 0) {
        heat.registerShot(1);
        rounds += 1;
        shots.push(t);
        peak = Math.max(peak, heat.heat);
        cooldown = period;
      }
      if (cooldown > 0) cooldown = Math.max(0, Math.fround(cooldown - tick));
    }
  }
  // The rate once it has overheated: rounds in the last ten seconds.
  const late = shots.filter(s => s >= seconds - 10).length / 10;
  return { rounds, firstRefused, peak, lateRate: late, heatAtEnd: heat.heat };
}
out.hold = {
  m249: hold(M249, 30),
  pkm: hold(PKM, 30),
  m249At30: hold(M249, 30, 30),
};

/**
 * A seat's gun held for `seconds`: `world-vehicle-tick.js` steps its
 * `FireState` once a world tick and gates the trigger on it, and the gun
 * fires in that tick's `guns.advance`. Vanilla's own numbers (the glbs'
 * FireArms extras): the stationary MG42, the pintle Browning, the coaxial
 * Browning.
 */
function holdSeat(stats, seconds) {
  const state = new FireState(stats);
  const tick = Math.fround(1 / 30);
  const period = Math.fround(1 / Math.fround(stats.roundOfFire));
  let cooldown = 0;
  let rounds = 0;
  let firstRefused = null;
  for (let i = 0; i * (1 / 30) < seconds; i++) {
    state.step(1 / 30);
    const firing = state.canFire;
    if (!firing && firstRefused === null) firstRefused = { t: i / 30, rounds };
    if (firing && cooldown <= 0) {
      state.registerShot(1);
      rounds += 1;
      cooldown = period;
    }
    if (cooldown > 0) cooldown = Math.max(0, Math.fround(cooldown - tick));
  }
  return { rounds, firstRefused };
}
const heatOnly = (roundOfFire, heatAddWhenFire, coolDownPerSec) =>
  ({ magSize: -1, roundOfFire, heatAddWhenFire, coolDownPerSec, timeDelayOnOverheat: 2 });
out.seats = {
  mg42: holdSeat(heatOnly(15, 0.04, 0.4), 20),
  browning: holdSeat(heatOnly(10, 0.04, 0.4), 20),
  coax: holdSeat(heatOnly(12, 0.05, 0.3), 20),
};

// --- cooling off --------------------------------------------------------------
{
  const kit = new KitAmmo();
  const heat = itemHeat(kit.entry('M249', M249.magazine), M249);
  for (let i = 0; i < 20; i++) heat.registerShot(1);
  const after20 = heat.heat;
  let t = 0;
  while (heat.heat > 0 && t < 10) { heat.step(1 / 60); t += 1 / 60; }
  out.cool = { after20, secondsToCold: t };
}

console.log(JSON.stringify(out));
