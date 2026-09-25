// Drives `viewer/kit-drops.js` (and `kit-ammo.js`'s `adopt`) outside a browser
// and prints one JSON blob. `tests/test_kit_drops.py` copies both modules in
// as `.mjs` files, the pattern `test_kit_ammo.py` uses.

import {
  KitDrops, KIT_TIME_TO_LIVE, KIT_YAW_SPEED, PICKUP_COOLDOWN, PICKUP_RADIUS, WORLD_HZ,
  ammoRowsFromBotMags, pickupAllowed, restingPlace,
} from './kit-drops.mjs';
import { KitAmmo } from './kit-ammo.mjs';

const out = { constants: { KIT_TIME_TO_LIVE, KIT_YAW_SPEED, PICKUP_COOLDOWN, PICKUP_RADIUS, WORLD_HZ } };

// --- resting place: terrain vs the first surface below, nearer his height ----
{
  const flat = { terrain: () => ({ y: 10, normal: [0, 1, 0] }) };
  const floor = { terrain: () => ({ y: 10, normal: [0, 1, 0] }), castDown: () => ({ y: 14, normal: [0, 1, 0] }) };
  const slope = { terrain: () => ({ y: 3, normal: [0.6, 0.8, 0] }) };
  out.rest = {
    terrainOnly: restingPlace({ x: 1, y: 12, z: 2, yaw: 0.5 }, flat),
    upperFloor: restingPlace({ x: 1, y: 14.02, z: 2 }, floor),
    // A soldier dying in the air (a parachutist) lands it on the ground below.
    fromTheAir: restingPlace({ x: 0, y: 80, z: 0 }, flat),
    slope: restingPlace({ x: 0, y: 3, z: 0 }, slope),
    nothing: restingPlace({ x: 0, y: 7, z: 0 }, {}),
  };
}

// --- lifetime, spin, reach, take ----------------------------------------------
{
  const drops = new KitDrops();
  const a = drops.drop({ x: 0, y: 0, z: 0, yaw: 0, normal: [0, 1, 0] }, { kit: 'German_AT', radius: 0.78 });
  drops.tick(1);
  const spinAfter1s = a.spin;
  const b = drops.drop({ x: 10, y: 0, z: 0, yaw: 0, normal: [0, 1, 0] }, { kit: 'Us_Medic', radius: 0.61 });
  const reach = {
    at1m: drops.nearest(1.0, 0, 0)?.kit ?? null,
    at1_8m: drops.nearest(1.8, 0, 0)?.kit ?? null,           // 1.1 + 0.78 = 1.88
    at1_95m: drops.nearest(1.95, 0, 0)?.kit ?? null,
    between: drops.nearest(5.5, 0, 0)?.kit ?? null,
    nearMedic: drops.nearest(9.0, 0, 0)?.kit ?? null,
  };
  const leftA = drops.timeLeft(a);
  const expired28 = drops.tick(28.9).map(d => d.kit);
  const expired29 = drops.tick(0.2).map(d => d.kit);   // a at 30.1 s
  const alive = drops.drops.map(d => d.kit);
  const took = drops.take(b)?.kit ?? null;
  out.life = { spinAfter1s, leftA, expired28, expired29, alive, took, left: drops.drops.length, reach };
}

// --- the gate ------------------------------------------------------------------
out.gate = {
  onFootReady: pickupAllowed({ onFoot: true, ready: true, now: 10, lastPickupAt: 5 }),
  seated: pickupAllowed({ onFoot: false, ready: true, now: 10 }),
  firing: pickupAllowed({ onFoot: true, ready: false, now: 10 }),
  cooldown: pickupAllowed({ onFoot: true, ready: true, now: 7, lastPickupAt: 5 }),
  cooldownExact: pickupAllowed({ onFoot: true, ready: true, now: 7.01, lastPickupAt: 5 }),
};

// --- ammo carried, not refilled -------------------------------------------------
{
  const mags = new Map([
    ['Sg44', { rounds: 7, spare: 2, size: 30 }],
    ['KnifeAxis', { rounds: Infinity, spare: 0, size: 0 }],
    ['GrenadeAxis', { rounds: 1, spare: 0, size: 3 }],
  ]);
  const data = { Sg44: { magazine: { size: 30, magazines: 5 } }, GrenadeAxis: { magazine: { size: 3, magazines: 1 } } };
  const rows = ammoRowsFromBotMags(mags, data);
  const kit = new KitAmmo();
  kit.entry('Thompson', { size: 30, magazines: 5 });
  kit.adopt(rows);
  const sg = kit.entry('SG44', { size: 30, magazines: 5 });
  const nade = kit.entry('GrenadeAxis', { size: 3, magazines: 1 });
  const pistol = kit.entry('WalterP38', { size: 8, magazines: 4 });
  out.ammo = {
    rows,
    thompsonGone: kit.peek('Thompson') === null,
    sg44: { rounds: sg.rounds, mags: sg.mags, size: sg.size, spares: sg.spares },
    grenade: { rounds: nade.rounds, mags: nade.mags },
    unraisedPistol: { rounds: pistol.rounds, mags: pistol.mags },
    refilled: kit.refill(),
    sg44After: { rounds: sg.rounds, mags: sg.mags },
  };
}

console.log(JSON.stringify(out, (k, v) => (v === Infinity ? 'Infinity' : v)));
