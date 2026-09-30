// Drives `viewer/random-items.js` and the kit resolution in `viewer/kit-loadout.js`
// outside a browser and prints one JSON blob. `tests/test_random_items.py`
// copies the modules in under their own names.
//
// The kit rows are FHSW's own shape (`_shared/loadouts.json`, extract_loadouts.py):
// Counterattack-1950's British tank commander carries `RandomGBTankcommander`
// (`setRandomGeometries 4`: three No2 revolvers and a Sten) and a smoke roll.

import {
  heldItem, nextRoll, peekKit, randomCounter, resetRandomCounter, resolveKitRow, rollKit,
} from './random-items.js';
import { createKitLoadout } from './kit-loadout.js';

const out = {};

const TANKER = {
  nation: 'British', class: 'Engineer', team: 2,
  primary: 'RandomGBTankcommander',
  items: ['RandomGBTankcommander', 'KnifeAllies', 'RandomSmokeItem4M8', 'RepairPack'],
  weapons: [
    { slot: 1, weapon: 'KnifeAllies', icon: 'a' },
    { slot: 3, weapon: 'RandomGBTankcommander', icon: 'b' },
    { slot: 4, weapon: 'RandomSmokeItem4M8', icon: 'c' },
    { slot: 6, weapon: 'RepairPack', icon: 'd' },
  ],
  random: [
    { template: 'RandomGBTankcommander', count: 4,
      variants: ['RandomGBTankcommander1', 'RandomGBTankcommander2',
                 'RandomGBTankcommander3', 'RandomGBTankcommander4'] },
    // A roll that can land on a variant the mod never declared.
    { template: 'RandomSmokeItem4M8', count: 5,
      variants: [null, 'RandomSmokeItem4M82', 'RandomSmokeItem4M83', null, 'RandomSmokeItem4M85'] },
  ],
};
const RIFLEMAN = { nation: 'German', class: 'Assault', team: 1, primary: 'Mp40',
                   items: ['Mp40', 'GrenadeAxis'], weapons: [{ slot: 3, weapon: 'Mp40' }],
                   random: [] };

// --- the counter --------------------------------------------------------------
{
  resetRandomCounter();
  out.startsAt = randomCounter();
  // The engine's `inc`, then 1 once past N: from 1, a 4-way child lands on 2.
  out.fourWay = [nextRoll(4), nextRoll(4), nextRoll(4), nextRoll(4), nextRoll(4)];
  // One counter for every child: a 2-way roll after it wraps from 2.
  out.twoWayAfter = nextRoll(2);
  // A 6-way roll after a 2-way one continues from the shared value.
  out.sixWayAfter = nextRoll(6);
}

// --- a kit's whole roll -------------------------------------------------------
{
  resetRandomCounter();
  const peeked = peekKit(TANKER);
  out.peekSpends = randomCounter();
  const rolls = [];
  for (let i = 0; i < 4; i++) rolls.push(Object.fromEntries(rollKit(TANKER)));
  out.kitRolls = rolls;
  out.peekMatchesFirst = JSON.stringify(Object.fromEntries(peeked)) === JSON.stringify(rolls[0]);
  out.counterAfter = randomCounter();
}

// --- a row resolved -----------------------------------------------------------
{
  resetRandomCounter();
  const rolls = rollKit(TANKER);
  const row = resolveKitRow(TANKER, rolls);
  out.resolved = { primary: row.primary, items: row.items, weapons: row.weapons.map(w => w.weapon),
                   untouched: TANKER.primary };
  out.plainRow = resolveKitRow(RIFLEMAN, rollKit(RIFLEMAN)) === RIFLEMAN;
  out.held = { plain: heldItem('Mp40', rolls), rolled: heldItem('randomgbtankcommander', rolls),
               none: heldItem(null, rolls) };
}

// --- kit-loadout.js: the human's spawn and a bot's deal ------------------------
{
  resetRandomCounter();
  const LOADOUTS = {
    primaryItemIndex: 3,
    kits: { '5GB_TankCommanderNo2Smoke2R': TANKER, '1German_CloseQuartersMp40': RIFLEMAN },
    levels: { 'counterattack-1950': {
      1: { soldier: 'GermanSoldier', slots: { 0: '1German_CloseQuartersMp40' } },
      2: { soldier: 'FrenchSoldier', slots: { 4: '5GB_TankCommanderNo2Smoke2R' } },
    } },
    aiWeapons: {
      RandomGBTankcommander1: { aiTemplate: 'No2_ID3AI' },
      RandomGBTankcommander2: { aiTemplate: 'No2_ID3AI' },
      RandomGBTankcommander3: { aiTemplate: 'No2_ID3AI' },
      RandomGBTankcommander4: { aiTemplate: 'StenMK5_ID3AI' },
      KnifeAllies: { aiTemplate: 'KnifeAI' },
    },
  };
  globalThis.fetch = async url => (/loadouts\.json/.test(url)
    ? { ok: true, json: async () => LOADOUTS }
    : { ok: false, status: 404, json: async () => null });
  const page = {
    MAPS_BASE: 'maps/mods/fhsw', bust: () => '', currentDir: 'counterattack-1950',
    KITS: ['scout', 'assault', 'antitank', 'medic', 'engineer'], deployKit: 'engineer',
    deployTeamId: 2, params: new URLSearchParams(''), teamNation: () => 'brit',
  };
  const loadout = createKitLoadout(page);
  await loadout.loadoutsLoad;
  const flag = { team: 2 };
  const beforeSpawn = loadout.weaponTemplateFor(flag);
  const lives = [];
  for (let i = 0; i < 4; i++) {
    loadout.rollSpawnKit(flag);
    lives.push({
      weapon: loadout.weaponTemplateFor(flag),
      slots: loadout.kitSlotsFor(flag).map(w => `${w.slot}:${w.weapon}`),
      again: loadout.weaponTemplateFor(flag),
    });
  }
  const bots = [];
  for (let i = 0; i < 4; i++) {
    const kit = loadout.botKitFor(2, i);
    bots.push({ primary: kit.primary, weapons: kit.weapons.map(w => w.name) });
  }
  // A picked-up kit keeps the variant its owner raised.
  loadout.adoptKitRolls('5GB_TankCommanderNo2Smoke2R',
                        [{ name: 'RandomGBTankcommander4', rounds: 3 }]);
  const pickedUp = loadout.kitRowFor('5GB_TankCommanderNo2Smoke2R').primary;
  out.loadout = { beforeSpawn, lives, bots, pickedUp,
                  soldier: loadout.soldierTemplateFor(flag),
                  rifleman: loadout.weaponTemplateFor({ team: 1 }, 'assault') };
}

console.log(JSON.stringify(out));
