// Drives the map's vehicle-icon rule (`viewer/map-vehicle-marks.js`), the
// hull's kill credit (`viewer/vehicle-damage.js` `killedBy`) and the death
// lines (`viewer/chat-log.js` `deathLines`) outside a browser and prints one
// JSON blob. `tests/test_vehicle_kill_credit.py` copies the modules in, so the
// files under test are the files the page loads.

import { mapVehicleMark, EMPTY_VEHICLE_TINT } from './map-vehicle-marks.js';
import { DamageableVehicle, VehicleDamageSet } from './vehicle-damage.mjs';
import { Armor } from './armor.mjs';
import { deathLines } from './chat-log.js';

const out = {};

// --- the icon rule ------------------------------------------------------------

const mark = args => mapVehicleMark({ localTeam: 2, ...args });
out.marks = {
  emptyAlive: mark({ hitPoints: 100 }),
  friendlyCrewed: mark({ hitPoints: 100, occupantTeams: [2] }),
  enemyCrewed: mark({ hitPoints: 100, occupantTeams: [1] }),
  enemyCrewedTwo: mark({ hitPoints: 100, occupantTeams: [1, 1] }),
  wreck: mark({ hitPoints: 0 }),
  wreckFriendlyCrew: mark({ hitPoints: 0, occupantTeams: [2] }),
  noArmor: mark({ hitPoints: undefined }),
  heldForEnemy: mark({ hitPoints: 100, heldTeam: 1 }),
  heldForUs: mark({ hitPoints: 100, heldTeam: 2 }),
  // The last man walked decides (0x0046b7b3..0x0046b88b).
  mixedLastFriendly: mark({ hitPoints: 100, occupantTeams: [1, 2] }),
  mixedLastEnemy: mark({ hitPoints: 100, occupantTeams: [2, 1] }),
  axisReaderSeesAxisCrew: mapVehicleMark({ hitPoints: 50, occupantTeams: [1], localTeam: 1 }),
};
out.emptyTint = EMPTY_VEHICLE_TINT;

// --- the hull's kill credit ---------------------------------------------------

const SHERMAN = {
  hitpoints: 100, maxHitpoints: 100,
  criticalDamage: 12, hpLostWhileCriticalDamage: 1.5,
  effects: [],
};

{
  const v = new DamageableVehicle(SHERMAN);
  v.damage(40, 'bot_3');
  const afterFirst = { last: v.lastHitPlayer, killedBy: v.killedBy };
  v.damage(30, null);                      // a hit with nobody behind it
  const afterAnon = { last: v.lastHitPlayer, killedBy: v.killedBy };
  v.damage(100, 'local');                  // the lethal one
  const afterKill = { last: v.lastHitPlayer, killedBy: v.killedBy, destroyed: v.destroyed };
  v.damage(50, 'bot_5');                   // a round into the wreck
  const afterWreckHit = { last: v.lastHitPlayer, killedBy: v.killedBy };
  v.reset();
  out.credit = { afterFirst, afterAnon, afterKill, afterWreckHit,
                 afterReset: { last: v.lastHitPlayer, killedBy: v.killedBy } };
}

{
  // Hit into critical, then the burn finishes it: the burn is
  // `giveDamage(..., attacker -1)` (0x0817322a), so nobody gets the crew.
  const v = new DamageableVehicle(SHERMAN);
  v.damage(95, 'local');
  let seconds = 0;
  while (!v.destroyed && seconds < 30) { v.update(1); seconds++; }
  out.burnDown = { destroyed: v.destroyed, last: v.lastHitPlayer, killedBy: v.killedBy, seconds };
}

{
  // The set's two round paths carry the attacker onto the hull.
  const set = new VehicleDamageSet();
  const a = set.add(7, SHERMAN, { name: 'Sherman' });
  set.applyHit({ owner: 7, damage: 1000 }, 'bot_1');
  const b = set.add(8, SHERMAN, { name: 'PanzerIV' });
  const soldier = new Armor(100);
  const splashed = set.applySplash(
    { splashMaterial2: 1, splashRadius: 10, splashPoint: [0, 0, 0] },
    [{ owner: 8, x: 0, y: 0, z: 0, splashMaterial: 1 },
     { owner: -1, armor: soldier, soldier: true, x: 1, y: 0, z: 0, splashMaterial: 1 }],
    { materials: { 1: { damage: 5000 } }, modifiers: { 1: { 1: 1 } }, attacker: 'local' });
  out.set = {
    hit: { killedBy: a.killedBy, destroyed: a.destroyed },
    splash: { killedBy: b.killedBy, destroyed: b.destroyed, soldierHit: splashed.some(s => s.target.soldier) },
  };
}

// --- the death lines ----------------------------------------------------------

const strings = { DEFAULT_KILL_TEXT: 'killed', DEATH: 'is no more', TEAM_KILL: 'killed a teammate' };
const names = { Sherman: 'Sherman', PanzerIV: 'PanzerIV', Thompson: 'Thompson', K98: 'K 98' };
const human = { id: 'local', name: 'Player', team: 2, vehicle: 'Sherman' };
const hans = { id: 'bot_1', name: 'Hans', team: 1, vehicle: null };
const hansInTank = { ...hans, vehicle: 'PanzerIV' };
const davis = { id: 'bot_6', name: 'Davis', team: 2, vehicle: 'Sherman' };
out.lines = {
  humanTankKillsCrew: deathLines(hans, human, strings, names),
  botTankKillsCrew: deathLines(hans, davis, strings, names),
  botTankKillsHuman: deathLines(human, hansInTank, strings, names),
  // On foot the word is the hand weapon that killed (`killStamp`): the
  // damage's own `weapon`, else the one he holds; splash and a man run over
  // carry no stamp. A weapon the lexicon lacks prints its template name.
  onFootKill: deathLines(hans, { ...human, vehicle: null, weapon: 'Thompson' }, strings, names),
  onFootNamedByDamage: deathLines(hans, { ...human, vehicle: null, weapon: 'Colt' }, strings, names,
                                  { weapon: 'Thompson' }),
  onFootSplash: deathLines(hans, { ...human, vehicle: null, weapon: 'GrenadeAllies' }, strings, names,
                           { splash: true, weapon: 'GrenadeAllies' }),
  onFootLexiconMiss: deathLines(hans, { ...human, vehicle: null }, strings, names, { weapon: 'K98Sniper' }),
  onFootNothingKnown: deathLines(hans, { ...human, vehicle: null }, strings, names),
  botRifleKillsHuman: deathLines(human, { ...hans, weapon: 'K98' }, strings, names, { weapon: 'K98' }),
  tankSplashKillsHuman: deathLines(human, hansInTank, strings, names, { splash: true }),
  runOver: deathLines(hans, human, strings, names, { roadkill: true }),
  hullDiedWithNobody: deathLines(hans, null, strings, names),
  ownHand: deathLines(human, human, strings, names),
  teamKill: deathLines({ ...hans, team: 2 }, davis, strings, names),
};

console.log(JSON.stringify(out));
