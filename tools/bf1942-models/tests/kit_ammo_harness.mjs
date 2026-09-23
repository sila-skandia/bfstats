// Drives `viewer/kit-ammo.js` outside a browser and prints one JSON blob.
//
// The scenario is the owner's bug report verbatim: throw every grenade, change
// weapon, change back — the pouch must still be empty, and only a depot's
// give may fill it. The magazine rows are the weapons' own glb extras
// (`viewer/models/GrenadeAllies.glb`, `Thompson.glb`, `KnifeAllies.glb`,
// `ExpPack.glb`, read 2026-09-23), not invented numbers.
//
// `tests/test_kit_ammo.py` copies the module in as `kit-ammo.mjs`, the same
// pattern `test_supply.py` uses. Run it by hand from `tools/bf1942-models`
// with `node tests/kit_ammo_harness.mjs` after `cp viewer/kit-ammo.js
// tests/kit-ammo.mjs`, or just run the python test.

import { KitAmmo, magazineSize, spareMagazines } from './kit-ammo.mjs';

const GRENADE = { size: 3, magazines: 1, type: 0, reloadTime: 2.0, autoReload: true };
const THOMPSON = { size: 30, magazines: 5, type: 0, reloadTime: 4.8 };
const KNIFE = { size: -1, magazines: 4, type: 0, reloadTime: 1.0 };
const EXPPACK = { size: 4, magazines: 1, type: 0, reloadTime: 1.0, autoReload: false };

const out = {};

// What `map.html`'s `loadHandWeapon` does on a slot switch: the rig is
// destroyed and rebuilt, and asks the kit for the item's counts again.
const raise = (kit, name, magazine) => kit.entry(name, magazine);
const throwOne = entry => { entry.rounds = Math.max(0, entry.rounds - 1); };

// --- the bug report: throw all, switch away, switch back ------------------
{
  const kit = new KitAmmo();
  kit.reset();                                   // spawn
  let pouch = raise(kit, 'GrenadeAllies', GRENADE);
  const atSpawn = { rounds: pouch.rounds, mags: pouch.mags };
  throwOne(pouch); throwOne(pouch); throwOne(pouch);
  const afterThrowing = { rounds: pouch.rounds, mags: pouch.mags };
  raise(kit, 'Thompson', THOMPSON);              // key 3
  pouch = raise(kit, 'GrenadeAllies', GRENADE);  // key 4 again
  const afterSwitchBack = { rounds: pouch.rounds, mags: pouch.mags };
  // The kit files and the weapon's own `create` line disagree on casing;
  // the same item must not become two pouches.
  const recased = raise(kit, 'grenadeallies', GRENADE);
  const gave = kit.refill();                     // the depot's give
  const afterRefill = { rounds: pouch.rounds, mags: pouch.mags };
  const gaveAgain = kit.refill();                // standing on the box, full
  out.grenades = {
    atSpawn, afterThrowing, afterSwitchBack,
    sameEntryRecased: recased === pouch,
    gave, afterRefill, gaveAgain,
  };
}

// --- a rifle with spent magazines comes back as it was left ---------------
{
  const kit = new KitAmmo();
  let smg = raise(kit, 'Thompson', THOMPSON);
  const atSpawn = { rounds: smg.rounds, mags: smg.mags };
  for (let i = 0; i < 30; i++) throwOne(smg);   // one magazine dry
  smg.mags -= 1; smg.rounds = smg.size;          // the reload seats a spare
  for (let i = 0; i < 12; i++) throwOne(smg);   // half of the next
  const beforeSwitch = { rounds: smg.rounds, mags: smg.mags };
  raise(kit, 'KnifeAllies', KNIFE);
  raise(kit, 'GrenadeAllies', GRENADE);
  smg = raise(kit, 'Thompson', THOMPSON);
  const afterSwitchBack = { rounds: smg.rounds, mags: smg.mags };
  kit.refill();
  out.rifle = {
    atSpawn, beforeSwitch, afterSwitchBack,
    afterRefill: { rounds: smg.rounds, mags: smg.mags },
  };
}

// --- a spawn is the one reset ---------------------------------------------
{
  const kit = new KitAmmo();
  const pouch = raise(kit, 'GrenadeAllies', GRENADE);
  throwOne(pouch); throwOne(pouch); throwOne(pouch);
  kit.reset();
  const fresh = raise(kit, 'GrenadeAllies', GRENADE);
  out.respawn = {
    newEntry: fresh !== pouch,
    rounds: fresh.rounds, mags: fresh.mags,
    peekUnraised: kit.peek('Colt'),
  };
}

// --- the knife's unlimited magazine, and the pack's pouch -----------------
{
  const kit = new KitAmmo();
  const knife = raise(kit, 'KnifeAllies', KNIFE);
  const pack = raise(kit, 'ExpPack', EXPPACK);
  throwOne(pack); throwOne(pack); throwOne(pack); throwOne(pack);
  out.edges = {
    knifeUnlimited: knife.rounds === Infinity && knife.full,
    knifeMags: knife.mags,
    packLeft: pack.rounds, packMags: pack.mags,
    packFullAfterRefill: kit.refill() && pack.rounds === 4,
    sizeOfNone: magazineSize(null) === Infinity,
    sparesOfNone: spareMagazines(null),
    sparesOfOne: spareMagazines(GRENADE),
    sparesOfFive: spareMagazines(THOMPSON),
    // JSON has no Infinity; the knife's unlimited rows print as -1, the
    // engine's own spelling of them.
    snapshot: kit.snapshot().map(r => ({
      ...r,
      size: r.size === Infinity ? -1 : r.size,
      rounds: r.rounds === Infinity ? -1 : r.rounds,
    })),
  };
}

process.stdout.write(JSON.stringify(out));
