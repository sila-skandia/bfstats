// Headless checks of the soldier's two packs and of what a destroyed kit takes
// with it: `viewer/healing-packs.js` (the law the page, the bots and the room
// server share), the bots' use of it (`bot-referee.js` `usePack`), and a kit's
// rounds leaving the world unexploded (`gunfire.js` `releaseRounds`,
// `kit-drops-page.js`). Prints one JSON object; `test_healing_packs.py`
// asserts on it. argv[2] is the repo's tools/bf1942-models directory.

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.argv[2];
const url = rel => pathToFileURL(join(ROOT, rel)).href;
const { installModuleHooks, viewerDir } = await import(url('sim/env.mjs'));
installModuleHooks(viewerDir(join(ROOT, 'viewer')));

const P = await import(url('viewer/healing-packs.js'));
const { Armor } = await import(url('viewer/armor.js'));
const { createBotReferee } = await import(url('viewer/bot-referee.js'));
const { GunFire } = await import(url('viewer/gunfire.js'));
const { createKitDropsPage } = await import(url('viewer/kit-drops-page.js'));

const out = {};
const r3 = v => Math.round(v * 1000) / 1000;
const hurt = (max, lost) => { const a = new Armor(max); a.applyDamage(lost); return a; };

// --- the medic bag ----------------------------------------------------------
{
  const pack = P.packParams('medic');
  const holder = { id: 'me', x: 0, y: 0, z: 0, armor: hurt(30, 10) };
  const soldiers = [
    holder,
    { id: 'friend', x: 3, y: 0, z: 4, armor: hurt(30, 10) },        // 5 m
    { id: 'enemy', x: 0, y: 0, z: 9.9, armor: hurt(30, 10) },       // 9.9 m
    { id: 'edge', x: 10, y: 0, z: 0, armor: hurt(30, 10) },         // exactly 10 m
    { id: 'far', x: 10.1, y: 0, z: 0, armor: hurt(30, 10) },        // past it
    { id: 'whole', x: 1, y: 0, z: 0, armor: new Armor(30) },        // unhurt
    { id: 'dead', x: 1, y: 0, z: 1, armor: hurt(30, 40) },          // destroyed
  ];
  const heals = P.medPackHeals(holder, soldiers, pack);
  out.bag = {
    pack,
    healed: Object.fromEntries(heals.map(h => [h.id, r3(h.amount)])),
    selfLast: heals.at(-1)?.id ?? null,
    wholeHolder: P.medPackHeals({ ...holder, armor: new Armor(30) }, soldiers, pack).some(h => h.id === 'me'),
  };
}

// --- the wrench ---------------------------------------------------------------
{
  const pack = P.packParams('repair');
  const hull = (id, x, team = 0, extra = {}) => ({ id, x, y: 0, z: 0, radius: 2, team,
                                                   armor: hurt(100, 50), ...extra });
  const hulls = [
    hull('near-enemy', 2.5, 2),
    hull('mine', 3.5, 1),
    hull('empty', 3.0, 0),
    hull('static', 1.0, 0, { pco: false }),
    hull('whole', 0.5, 0, { armor: new Armor(100) }),
    hull('far', 4.1, 0),
  ];
  const pick = holder => P.repairPackTarget({ x: 0, y: 0, z: 0, team: 1, ...holder }, hulls, pack)?.id ?? null;
  out.wrench = {
    pack,
    standing: pick({}),
    crouched: pick({ crouched: true }),
    noEmpty: P.repairPackTarget({ x: 0, y: 0, z: 0, team: 1 }, hulls.filter(h => h.id !== 'empty'), pack)?.id ?? null,
    asEnemy: pick({ team: 2 }),
    outOfReach: P.repairPackTarget({ x: 0, y: 0, z: 0, team: 1 }, [hull('far', 4.1, 0)], pack)?.id ?? null,
  };
}

// --- the numbers, the names ---------------------------------------------------
out.params = {
  dc: P.packParams('repair', { templates: { DCSoldier: { repairFactor: 0.2 } } }, 'dcsoldier'),
  topLevel: P.packParams('medic', { healFactor: 0.5 }, null),
  none: P.packParams(null),
  kinds: ['MedPack', 'medpack', 'RepairPack', 'Officer-Ger', 'BottleHeal', null].map(P.healingPackKind),
};

// --- a bot's pack through the referee ---------------------------------------
{
  const players = new Map();
  const armors = new Map();
  const add = (id, team, x, z, lost, stance = 'stand') => {
    players.set(id, { team, soldier: { x, y: 0, z, stance } });
    armors.set(id, hurt(30, lost));
  };
  add('bot', 1, 0, 0, 10);
  add('friendBehind', 1, 0, -6, 10);     // behind it: the old cone never reached him
  add('enemy', 2, 5, 0, 10);
  add('farFriend', 1, 0, 12, 10);
  const vehicle = { owner: 7, isPco: true, hitPoints: 50, maxHitPoints: 100, destroyed: false,
                    heal(a) { this.hitPoints = Math.min(this.maxHitPoints, this.hitPoints + a); return a; } };
  const world = {
    players,
    player: id => players.get(id) ?? null,
    armorOf: id => armors.get(id) ?? null,
    vehicleDamage: { values: () => [vehicle][Symbol.iterator]() },
    vehiclePose: owner => (owner === 7 ? { x: 2, y: 0, z: 0 } : null),
    bodyWorld: { get: () => ({ spec: { boundingRadius: 1.5 } }) },
    nodeOwners: new Map(),
  };
  const referee = createBotReferee({ world: () => world });
  const bot = { playerId: 'bot', team: 1, getPosition: () => [0, 0, 0], weaponAi: { name: 'MedPack' } };
  const before = Object.fromEntries([...armors].map(([id, a]) => [id, a.hitPoints]));
  const healed = referee.usePack(bot, 'medic');
  const after = Object.fromEntries([...armors].map(([id, a]) => [id, r3(a.hitPoints - before[id])]));
  const v0 = vehicle.hitPoints;
  const repaired = referee.usePack(bot, 'repair');
  const standingRepair = r3(vehicle.hitPoints - v0);
  players.get('bot').soldier.stance = 'crouch';
  const v1 = vehicle.hitPoints;
  referee.usePack(bot, 'repair');
  const crouchedRepair = r3(vehicle.hitPoints - v1);
  out.bot = { healed: healed?.map(h => h.id) ?? null, after, repaired, standingRepair, crouchedRepair };
}

// --- a destroyed kit's rounds -------------------------------------------------
{
  const removed = [];
  const fake = { scene: { remove: m => removed.push(m) }, projectiles: [] };
  const lifeA = { kit: 'A' }, lifeB = { kit: 'B' };
  const group = { projectilePool: [] };
  const shot = (life, name) => ({ kitLife: life, group, mesh: { name, visible: true } });
  fake.projectiles.push(shot(lifeA, 'mineA1'), shot(lifeB, 'mineB'), shot(lifeA, 'packA'), shot(null, 'bullet'));
  const count = GunFire.prototype.releaseRounds.call(fake, lifeA);
  out.release = {
    count, left: fake.projectiles.map(s => s.mesh.name), pooled: group.projectilePool.length,
    none: GunFire.prototype.releaseRounds.call(fake, null),
  };
}

// --- when the kit is destroyed (kit-drops-page.js) ---------------------------
{
  const released = [];
  const page = {
    roomJoined: false, soldierDead: false, occupancy: null,
    soldier: { x: 0, y: 0, z: 0, yaw: 0 },
    kitLife: { kit: 'first' },
    currentKit: () => 'US_Engineer', carriedAmmo: () => [], LOCAL_PLAYER: 'me', deployTeamId: 2,
    groundHeight: () => 0, params: new Map(),
    releaseKitRounds: life => released.push(life.kit),
  };
  const drops = createKitDropsPage(page);
  // On foot: the kit lies 30 s, and its rounds go with it then.
  drops.tick(1 / 30);
  page.soldierDead = true;
  drops.localDied();
  drops.tick(29);
  const at29 = [...released];
  drops.tick(1.1);
  const at30 = [...released];
  // A new life, then a death in a seat: no kit is laid, and it goes at once.
  page.soldierDead = false;
  page.kitLife = { kit: 'second' };
  drops.tick(1 / 30);
  page.soldierDead = true;
  drops.tick(1 / 30);
  const seat = [...released];
  // In a room no kit is laid, but it is still destroyed 30 s on.
  page.roomJoined = true;
  page.soldierDead = false;
  page.kitLife = { kit: 'third' };
  drops.tick(1 / 30);
  page.soldierDead = true;
  drops.localDied();
  drops.tick(1 / 30);
  const roomAtOnce = [...released];
  drops.tick(30.1);
  out.kitDeath = { at29, at30, seat, roomAtOnce, room30: [...released] };
}

console.log(JSON.stringify(out));
