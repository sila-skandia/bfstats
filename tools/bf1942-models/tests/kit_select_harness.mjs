// Drives `viewer/kit-select.js` and `viewer/kit-ammo.js` under node and prints
// one JSON blob: the kit's own item order, the switch's choice, the refusal.
//
// The kit rows are `_shared/loadouts.json`'s own (vanilla `GB_Medic`, FHSW
// `2Us_AssaultGarand` and `1Us_ClosequartersGreasegunSmoke2R`, read
// 2026-10-17); the magazines are the weapons' words.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir(process.argv[2] ?? null);
installModuleHooks(viewer);
const load = name => import(pathToFileURL(path.join(viewer, name)).href);
const { bestLoadedSlot, kitItemOrder, refusesRaise, totalAmmo, wantsSwitch } = await load('kit-select.js');
const { KitAmmo } = await load('kit-ammo.js');

const ROWS = {
  vanillaMedic: {
    items: ['Thompson', 'Colt', 'KnifeAllies', 'MedPack', 'GrenadeAllies'],
    weapons: [{ slot: 1, weapon: 'KnifeAllies' }, { slot: 2, weapon: 'Colt' },
              { slot: 3, weapon: 'Thompson' }, { slot: 4, weapon: 'GrenadeAllies' },
              { slot: 5, weapon: 'MedPack' }],
  },
  fhswGarand: {
    items: ['M1Garand', 'GarandGrenade', 'GrenadeAllies', 'M1GarandBay', 'Knife_M1Bayonet_ID2', 'scoldID7'],
    weapons: [{ slot: 1, weapon: 'M1GarandBay' }, { slot: 2, weapon: 'Knife_M1Bayonet_ID2' },
              { slot: 3, weapon: 'M1Garand' }, { slot: 4, weapon: 'GrenadeAllies' },
              { slot: 6, weapon: 'GarandGrenade' }, { slot: 7, weapon: 'scoldID7' }],
  },
  // A row an older tree wrote, with no `items`.
  noItems: { weapons: [{ slot: 3, weapon: 'Mp40' }, { slot: 1, weapon: 'KnifeAxis' }] },
  // A carried name with no slot (an ammo bundle) is no item.
  bundle: { items: ['Thompson', 'AmmoBox', 'KnifeAllies'],
            weapons: [{ slot: 1, weapon: 'KnifeAllies' }, { slot: 3, weapon: 'Thompson' }] },
};

const MAG = {
  thompson: { size: 30, magazines: 5 },
  colt: { size: 7, magazines: 4 },
  knife: { size: -1, magazines: 4 },
  grenade: { size: 3, magazines: 1, cantSelectWhenNoAmmo: true, changeWeaponWhenNoAmmo: true },
  medpack: { size: 1800, magazines: 1, type: 1 },
};

const out = { order: {}, choice: {}, refusal: {}, wants: {}, kitAmmo: {} };
for (const [name, row] of Object.entries(ROWS)) out.order[name] = kitItemOrder(row);

// The vanilla medic, by the counts the kit holds.
function medic(spent) {
  const kit = new KitAmmo();
  const names = { 3: ['Thompson', MAG.thompson], 2: ['Colt', MAG.colt], 1: ['KnifeAllies', MAG.knife],
                  5: ['MedPack', MAG.medpack], 4: ['GrenadeAllies', MAG.grenade] };
  for (const slot of spent) {
    const [n, m] = names[slot];
    const e = kit.entry(n, m);
    e.rounds = 0; e.mags = 0;
  }
  const order = kitItemOrder(ROWS.vanillaMedic);
  return bestLoadedSlot(order, {
    filled: s => s in names,
    total: s => totalAmmo(kit.peek(names[s][0])),
  });
}
out.choice.grenadesGone = medic([4]);              // the Thompson, first in the kit
out.choice.thompsonAndGrenadesGone = medic([3, 4]); // the Colt
out.choice.allGunsGone = medic([3, 2, 4]);         // the knife: -1 is not 0
// Nothing loaded at all: the list's first.
out.choice.nothingLoaded = bestLoadedSlot([3, 2, 1], { filled: () => true, total: () => 0 });
// The only loaded item sits at index 0: the list's first, as `jle` reads it.
out.choice.indexZero = bestLoadedSlot([3, 0], { filled: () => true, total: s => (s === 0 ? 5 : 0) });
// A slot the soldier does not hold is passed over.
out.choice.unfilled = bestLoadedSlot([3, 2, 1], { filled: s => s !== 3, total: () => 5 });
// The explosives pack spent in hand: the detonator.
out.choice.packSpent = bestLoadedSlot([3, 2, 1, 4], { filled: () => true, total: () => 5,
                                                      heldIsPack: true, heldTotal: 0 });
out.choice.packLeft = bestLoadedSlot([3, 2, 1, 4], { filled: () => true, total: () => 5,
                                                     heldIsPack: true, heldTotal: 2 });
out.choice.emptyKit = bestLoadedSlot([], { filled: () => true, total: () => 5 });

out.refusal.emptyGrenade = refusesRaise(MAG.grenade, 0);
out.refusal.grenadeLeft = refusesRaise(MAG.grenade, 1);
out.refusal.emptyThompson = refusesRaise(MAG.thompson, 0);

const hw = (over = {}) => ({ data: { magazine: MAG.grenade }, rounds: 0, mags: 0, cool: 0,
                             hideFire: 0, throwWind: 0, pulse: false,
                             ammo: { rounds: 0, mags: 0, size: 3 }, ...over });
out.wants.spent = wantsSwitch(hw());
out.wants.cycling = wantsSwitch(hw({ cool: 0.2 }));
out.wants.hidden = wantsSwitch(hw({ hideFire: 0.1 }));
out.wants.windingUp = wantsSwitch(hw({ throwWind: 0.3 }));
out.wants.oneLeft = wantsSwitch(hw({ ammo: { rounds: 1, mags: 0, size: 3 } }));
out.wants.spareLeft = wantsSwitch(hw({ ammo: { rounds: 0, mags: 1, size: 3 } }));
out.wants.noWord = wantsSwitch(hw({ data: { magazine: MAG.thompson } }));
out.wants.bareRig = wantsSwitch({ ...hw(), ammo: undefined });

// `cantSelect` rides the kit's counts, through a drop and a pickup.
{
  const kit = new KitAmmo();
  const g = kit.entry('GrenadeAllies', MAG.grenade);
  g.rounds = 0;
  kit.entry('Thompson', MAG.thompson);
  const rows = kit.snapshot();
  const picked = new KitAmmo();
  picked.adopt(rows);
  out.kitAmmo = {
    own: g.cantSelect,
    thompson: kit.peek('Thompson').cantSelect,
    adopted: picked.peek('GrenadeAllies').cantSelect,
    adoptedTotal: totalAmmo(picked.peek('GrenadeAllies')),
  };
}

console.log(JSON.stringify(out));
