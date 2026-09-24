// Friendly fire (ledger FF-1..FF-5), driven outside a browser: the rule in
// `viewer/friendly-fire.js`, then the two places a round meets a soldier --
// the page's `vehicle-hits.js` (every gunfire.js round: hull guns, the human's
// hand weapon) and the referee's `resolveShot` (a bot's hand weapon) -- and
// the hull and blast damage `vehicle-hits.js` hands `vehicle-damage.js`.
//
// The wiring is checked at percentages that are not the shipped 100, so a
// ratio picked from the wrong pair shows: soldier 50, vehicle 25, soldier
// splash 10, vehicle splash 5. The modules are imported from the viewer tree
// in place. One JSON blob on stdout; run by `tests/test_friendly_fire.py`.

import {
  FRIENDLY_FIRE_SHIPPED, friendlyDamage, friendlyFireRatio, roundPasses,
} from '../viewer/friendly-fire.js';
import { createVehicleHits } from '../viewer/vehicle-hits.js';
import { VehicleDamageSet } from '../viewer/vehicle-damage.js';
import { BOT_BODY_HEIGHT, createBotReferee } from '../viewer/bot-referee.js';
import { Armor } from '../viewer/armor.js';

const PERCENT = { soldier: 50, vehicle: 25, soldierSplash: 10, vehicleSplash: 5 };
const out = {};

// --- the rule --------------------------------------------------------------------

out.ratio = {
  shipped: friendlyFireRatio(100), half: friendlyFireRatio(50), zero: friendlyFireRatio(0),
  // The setters clamp to [0, 2] (setSoldierFFRatio 0x081572d0 and siblings).
  over: friendlyFireRatio(300), under: friendlyFireRatio(-20),
  unset: friendlyFireRatio(undefined),
};

const price = (opts) => friendlyDamage(40, { settings: PERCENT, ...opts });
out.price = {
  // Same side, team 1 or 2: the pair the victim's root picks.
  soldier: price({ attackerTeam: 2, victimTeam: 2 }),
  vehicle: price({ attackerTeam: 2, victimTeam: 2, soldier: false }),
  soldierSplash: price({ attackerTeam: 1, victimTeam: 1, splash: true }),
  vehicleSplash: price({ attackerTeam: 1, victimTeam: 1, soldier: false, splash: true }),
  // Anything else is the enemy's price: `calcDamage`'s `dec eax; cmp eax,1; ja`.
  enemy: price({ attackerTeam: 2, victimTeam: 1 }),
  emptyHull: price({ attackerTeam: 2, victimTeam: 0, soldier: false }),
  noSide: price({ attackerTeam: 0, victimTeam: 0 }),
  unknownRound: price({ attackerTeam: null, victimTeam: 2 }),
  shipped: friendlyDamage(40, { attackerTeam: 2, victimTeam: 2 }),
  shippedSettings: FRIENDLY_FIRE_SHIPPED,
};

// --- who a round passes ------------------------------------------------------------

const hullA = { name: 'hullA' };
const hullB = { name: 'hullB' };
function worldOf(entries) {
  const players = new Map(entries);
  return {
    players,
    player: id => players.get(id) ?? null,
    armorOf: id => players.get(id)?.armor ?? null,
    collider: null,
  };
}
const passWorld = worldOf([
  ['gunner', { team: 2, occupancy: { root: hullA } }],
  ['driver', { team: 2, occupancy: { root: hullA } }],
  ['otherCrew', { team: 2, occupancy: { root: hullB } }],
  ['walker', { team: 2 }],
  ['enemy', { team: 1 }],
]);
out.passes = {
  himself: roundPasses(passWorld, 'gunner', 'gunner'),
  ownCrew: roundPasses(passWorld, 'gunner', 'driver'),
  otherCrew: roundPasses(passWorld, 'gunner', 'otherCrew'),
  friendOnFoot: roundPasses(passWorld, 'gunner', 'walker'),
  enemy: roundPasses(passWorld, 'gunner', 'enemy'),
  fromFootIntoHull: roundPasses(passWorld, 'walker', 'driver'),
  unknownFirer: roundPasses(passWorld, 'nobody', 'driver'),
};

// --- the page: vehicle-hits.js -------------------------------------------------------

const LOCAL = 'local';
const SHERMAN = { hitpoints: 100, maxHitpoints: 100, splashMaterial: 50 };
/** A hull node: `splashTargets` asks where it is. */
const hullNode = (name, z) => ({ name, getWorldPosition: v => v.set(0, 0, z) });

function pageOf({ players, seats = new Map(), crews = new Map(), hulls = [] }) {
  const world = worldOf(players);
  const damage = new VehicleDamageSet();
  const visuals = new Map();
  for (const { owner, node } of hulls) {
    damage.add(owner, SHERMAN, { name: node.name });
    visuals.set(owner, { node });
  }
  const calls = [];
  const page = {
    LOCAL_PLAYER: LOCAL,
    friendlyFire: PERCENT,
    vehicles: {
      firerOf: group => seats.get(group) ?? null,
      instanceOf: node => (crews.has(node) ? { seats: crews.get(node) } : null),
    },
    damageVisuals: visuals,
    vehicleDamage: damage,
    world,
    bots: [...world.players.keys()].filter(id => id !== LOCAL).map(id => ({
      playerId: id, vehicle: null, getPosition: () => [0, 0, 0], recordHit() {},
    })),
    bodyAt: () => null,
    capsulesOf: () => null,
    soldier: null, soldierArmor: null, soldierDead: false,
    optOnFoot: { checked: true }, optPilot: { checked: false },
    guns: {
      // A blast of material 236 does 10 HP at its centre to either defender.
      materials: { 236: { attGroup: 236, defGroup: 236, damage: 10 }, 40: { defGroup: 40 }, 50: { defGroup: 50 } },
      modifiers: { 236: { 40: 1, 50: 1 } },
    },
    camera: { position: { toArray: () => [0, 0, 0] } },
    collider: null,
    applyDamage: (id, amount, attacker) => calls.push({ to: id, amount, attacker }),
    applyDamageToPlayer: (amount, from, team) => calls.push({ to: LOCAL, amount, team }),
    damageLanded: (id, lost) => calls.push({ landed: id, lost }),
    showDamageTier() {}, wreckVehicle() {}, raiseHitIndication() {},
  };
  return { hits: createVehicleHits(page), calls, damage };
}

const botGun = { name: 'bot seat' };
const handGun = { firer: LOCAL };
const orphanGun = {};
const soldierRound = (group, target, extra = {}) => ({
  kind: 'soldier', target, owner: -1, damage: 40, firerGroup: group, ...extra,
});
const people = [
  [LOCAL, { team: 2 }],
  ['b3', { team: 2, occupancy: { root: hullA } }],
  ['mate', { team: 2 }],
  ['foe', { team: 1 }],
];
const amountTo = (record) => {
  const { hits, calls } = pageOf({ players: people, seats: new Map([[botGun, 'b3']]) });
  hits.applyVehicleHit(record);
  return calls.map(c => [c.to, c.amount]);
};
out.round = {
  botOnMate: amountTo(soldierRound(botGun, 'mate')),
  botOnFoe: amountTo(soldierRound(botGun, 'foe')),
  // A man seated in a hull has the hull for his root: the vehicle ratio.
  botOnSeatedMate: amountTo(soldierRound(botGun, 'mate', { seated: true })),
  botOnHuman: amountTo(soldierRound(botGun, LOCAL)),
  humanOnMate: amountTo(soldierRound(handGun, 'mate')),
  // Nobody to name, so no side: never scaled.
  orphanOnMate: amountTo(soldierRound(orphanGun, 'mate')),
};

// Hulls: 6 crewed by the bot's own side, 7 by the other, 8 empty.
const friendHull = hullNode('friendHull', 0);
const foeHull = hullNode('foeHull', 0);
const emptyHull = hullNode('emptyHull', 0);
const hullWorld = () => pageOf({
  players: people,
  seats: new Map([[botGun, 'b3']]),
  crews: new Map([[friendHull, new Map([['driver', 'mate']])], [foeHull, new Map([['driver', 'foe']])]]),
  hulls: [{ owner: 6, node: friendHull }, { owner: 7, node: foeHull }, { owner: 8, node: emptyHull }],
});
const hullLoss = owner => {
  const { hits, damage } = hullWorld();
  hits.applyVehicleHit({ kind: 'object', owner, damage: 40, firerGroup: botGun });
  return 100 - damage.get(owner).hitPoints;
};
out.hull = { friendly: hullLoss(6), enemy: hullLoss(7), empty: hullLoss(8) };

// A blast at the origin, radius 10, 10 HP at its centre: the three hulls and
// two bots on foot (one of each side, their object origin on the blast) take
// the full 10 before friendly fire (`splashTargets`: the page's bots, their
// soldiers and Armors from the world).
{
  const armors = { mate: new Armor(100), foe: new Armor(100) };
  const onBlast = { x: 0, y: -1, z: 0, pose: 0 };
  const { hits, damage } = pageOf({
    players: [
      [LOCAL, { team: 2 }],
      ['b3', { team: 2, occupancy: { root: hullA } }],
      ['mate', { team: 2, soldier: onBlast, armor: armors.mate }],
      ['foe', { team: 1, soldier: onBlast, armor: armors.foe }],
    ],
    seats: new Map([[botGun, 'b3']]),
    crews: new Map([[friendHull, new Map([['driver', 'mate']])], [foeHull, new Map([['driver', 'foe']])]]),
    hulls: [{ owner: 6, node: friendHull }, { owner: 7, node: foeHull }, { owner: 8, node: emptyHull }],
  });
  hits.applyVehicleHit({
    kind: 'terrain', owner: -1, target: null, damage: 0, firerGroup: botGun,
    point: [0, 0, 0], splashMaterial2: 236, splashRadius: 10,
  });
  const lost = hp => +(100 - hp).toFixed(4);
  out.splash = {
    friendlySoldier: lost(armors.mate.hitPoints), enemySoldier: lost(armors.foe.hitPoints),
    friendlyHull: lost(damage.get(6).hitPoints), enemyHull: lost(damage.get(7).hitPoints),
    emptyHull: lost(damage.get(8).hitPoints),
  };
}

// --- the referee: a bot's hand-weapon round ----------------------------------------------

/**
 * `resolveShot` down +z from the origin at chest height, no deviation. The
 * shooter is team 2; `lineup` is who stands (or sits) where along the ray.
 */
function shot(lineup, { shooter = { team: 2 }, seatedBodies = new Map(), percent = PERCENT } = {}) {
  const world = worldOf([['shooter', shooter], ...lineup]);
  const referee = createBotReferee({
    world: () => world,
    groundAt: () => 0,
    armorFor: () => new Armor(30),
    roundDamage: () => 40,
    friendlyFire: percent,
    seatedBodyAt: id => seatedBodies.get(id) ?? null,
  });
  const bot = {
    playerId: 'shooter', aimDeviation: 0,
    aimRay: () => ({ origin: [0, BOT_BODY_HEIGHT, 0], dir: [0, 0, 1] }),
  };
  const hit = referee.resolveShot(bot, 40);
  return hit ? { target: hit.targetId, damage: hit.damage } : null;
}
const foot = z => ({ x: 0, y: 0, z });
out.resolve = {
  friendInFront: shot([['mate', { team: 2, soldier: foot(10) }], ['foe', { team: 1, soldier: foot(20) }]]),
  enemyInFront: shot([['foe', { team: 1, soldier: foot(10) }], ['mate', { team: 2, soldier: foot(20) }]]),
  // Seated in the shooter's own hull: passed. Seated in another: met, and
  // priced as the hull he sits in.
  ownCrewPassed: shot([
    ['driver', { team: 2, occupancy: { root: hullA } }],
    ['foe', { team: 1, soldier: foot(20) }],
  ], {
    shooter: { team: 2, occupancy: { root: hullA } },
    seatedBodies: new Map([['driver', foot(5)]]),
  }),
  otherCrewMet: shot([
    ['rider', { team: 2, occupancy: { root: hullB } }],
    ['foe', { team: 1, soldier: foot(20) }],
  ], {
    shooter: { team: 2, occupancy: { root: hullA } },
    seatedBodies: new Map([['rider', foot(5)]]),
  }),
  deadFriendPassed: shot([
    ['mate', { team: 2, soldier: foot(10), armor: { destroyed: true } }],
    ['foe', { team: 1, soldier: foot(20) }],
  ]),
  // No percentages handed in: the shipped file's 100, a friend costs what a foe does.
  shipped: shot([['mate', { team: 2, soldier: foot(10) }]], { percent: null }),
};

console.log(JSON.stringify(out));
