// Drives a soldier's rearm at an ammo box outside a browser and prints one
// JSON blob: `world-fields.js` `supplyFieldTick` over a stand-in world, the
// real `supply.js` depot and the real `kit-ammo.js` kit, wired the way
// `hand-weapon.js` wires `supplyTarget.refillAmmo` (`kitAmmo.rearm(types)`).
//
// The magazine words are vanilla's `Objects/HandWeapons/<item>/Objects.con`
// (with their `AmmoType` word: 1 the guns, 2 the grenades, 3 the launchers),
// and the box is `Objects/Buildings/Common/Ammobox/Objects.con`'s
// `AmmoboxSupplyDepot`.

import { SupplyDepot, SupplyField } from './supply.js';
import { KitAmmo } from './kit-ammo.js';
import { supplyFieldTick } from './world-fields.js';

const THOMPSON = { size: 30, magazines: 5, reloadTime: 4.8 };
const BAZOOKA = { size: 1, magazines: 6, reloadTime: 5.6, autoReload: true };
const GRENADE = { size: 3, magazines: 1, reloadTime: 2, autoReload: true };
const KNIFE = { size: -1, magazines: -1 };
const AMMO_BOX = { radius: 3, team: 0, health: [0, 0, 0],
  ammoTypes: [[1, -1, 15, 0], [2, -1, 1.2, 0], [3, -1, 1.2, 0]],
  workOnSoldiers: true, workOnVehicles: false };
const TICK = 1 / 30;

/** One soldier on foot at `at`, his kit's refill wired as the page wires it,
 *  and the box at the origin. `tags` gives the items their `AmmoType`. */
function makeWorld({ at = [0, 0, 0], tags = true, seatedOn = null } = {}) {
  const kit = new KitAmmo();
  const tag = (words, t) => (tags ? { ...words, ammoType: t } : words);
  const items = {
    smg: kit.entry('Thompson', tag(THOMPSON, 1)),
    tube: kit.entry('Bazooka', tag(BAZOOKA, 3)),
    pouch: kit.entry('GrenadeAllies', tag(GRENADE, 2)),
    knife: kit.entry('KnifeAllies', KNIFE),
  };
  const gives = [];
  let t = 0;
  const refillAmmo = types => { if (kit.rearm(types)) gives.push(Math.round(t * 100) / 100); };
  const player = {
    soldier: { x: at[0], y: at[1], z: at[2] }, armor: { destroyed: false, applyDamage() {} },
    occupancy: seatedOn ? { root: seatedOn } : null, position: at,
    supply: { team: 2, refillAmmo }, team: 2, supplyResult: { gaveAmmo: false, healed: false },
  };
  const world = {
    players: new Map([[1, player]]),
    nodeOwners: new Map(), vehicleDamage: new Map(), isWrecked: () => false,
    bodyWorld: null, positions: new Map(),
    supplyField: new SupplyField([new SupplyDepot({ x: 0, y: 0, z: 0 }, AMMO_BOX, 'AmmoboxSupplyDepot')]),
  };
  return { world, kit, items, gives, run(seconds) {
    for (let s = 0; s < seconds - 1e-9; s += TICK) { supplyFieldTick(world, TICK); t += TICK; }
  } };
}

const snap = e => ({ rounds: e.rounds, mags: e.mags });
const out = {};

// A Thompson run dry with no spare left, standing on the box: the loaded
// magazine stays empty (no `autoReload`: R reloads it), the box puts whole
// 30-round spares back at the row's 15 a second.
{
  const w = makeWorld();
  w.items.smg.rounds = 0; w.items.smg.mags = 0;
  w.run(0.6);
  const oneCycle = { ...snap(w.items.smg), pool: w.items.smg.pool };
  w.run(1.6);
  const after2s = snap(w.items.smg);
  w.run(10);
  out.dryThompson = { oneCycle, after2s, after12s: snap(w.items.smg), gives: w.gives.length };
}

// A half-spent magazine with every spare: nothing to give, so no give and no
// sound (the old code filled the loaded magazine back to 30).
{
  const w = makeWorld();
  w.items.smg.rounds = 12;
  w.run(5);
  out.halfSpent = { smg: snap(w.items.smg), gives: w.gives.length };
}

// The launcher, dry with no spare: rockets come back one a magazine at its
// row's 1.2 a second, and the loaded tube is left for its own reload
// (`stepDryMagazine` starts it in hand, `autoReload 1`).
{
  const w = makeWorld();
  w.items.tube.rounds = 0; w.items.tube.mags = 0;
  w.run(1.1);
  const first = snap(w.items.tube);
  w.run(10);
  out.dryTube = { first, after11s: snap(w.items.tube) };
}

// The grenade pouch, `numOfMag 1`: topped up in place, one grenade per unit
// of its own row (1.2 a second).
{
  const w = makeWorld();
  w.items.pouch.rounds = 0;
  w.run(1.1);
  const first = snap(w.items.pouch);
  w.run(2);
  out.pouch = { first, after3s: snap(w.items.pouch), knife: snap(w.items.knife) };
}

// Items without their `AmmoType` (today's exports) take the first row that
// gave units: the pouch at the guns' 15 a second, but still never the loaded
// magazine of a multi-magazine item.
{
  const w = makeWorld({ tags: false });
  w.items.pouch.rounds = 0;
  w.items.smg.rounds = 0; w.items.smg.mags = 0;
  w.run(0.6);
  out.untagged = { pouch: snap(w.items.pouch), smg: snap(w.items.smg) };
}

// Out of the box's reach nothing comes back.
{
  const w = makeWorld({ at: [0, 0, 10] });
  w.items.smg.rounds = 0; w.items.smg.mags = 0;
  w.run(5);
  out.away = { smg: snap(w.items.smg), gives: w.gives.length };
}

console.log(JSON.stringify(out));
