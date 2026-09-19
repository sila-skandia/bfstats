// Drives `viewer/crash-damage.js` outside a browser and prints one JSON blob.
// `tests/test_crash_damage.py` asserts on the output. The module imports
// nothing, so — like `armor_harness.mjs` — this is the whole harness.
//
// The material table is `tests/fixtures/crash_damage_tables.json`, a small,
// hand-picked subset of the real `viewer/maps/_shared/damage.json` (copied,
// not depended on by path — see the fixture's own `_comment`), verified
// against `features/vehicle-collision-physics/reports/V4-verification-of-R4.md`
// section 3 and section 6's worked numbers.

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  materialOf, damageModifier, materialDamage, contactMaterialValues,
  angleFactor, objectCollisionDamage, soldierCollisionDamage,
  terrainCollisionDamage, classifyContact, CollisionList, CrashDamage,
  KILL_MATERIAL, NO_DAMAGE_MATERIAL, WATER_MATERIAL, DAMAGE_THRESHOLD,
  SOLDIER_SPEED_FLOOR, KILL_DAMAGE, COLLISION_LIST_SIZE, COLLISION_LIST_LIFETIME,
} from './crash-damage.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const tables = JSON.parse(fs.readFileSync(path.join(here, 'tables.json'), 'utf8'));

const out = {};

out.constants = {
  KILL_MATERIAL, NO_DAMAGE_MATERIAL, WATER_MATERIAL, DAMAGE_THRESHOLD,
  SOLDIER_SPEED_FLOOR, KILL_DAMAGE, COLLISION_LIST_SIZE, COLLISION_LIST_LIFETIME,
};

/** A contact velocity of magnitude `v`, straight along -z, against a +z
 *  normal: `c = 1`, "square on" in every worked example in the spec. */
function squareOn(v) { return { speed: [0, 0, -v], normal: [0, 0, 1] }; }

// --- material table plumbing, §9.4 ------------------------------------------

out.materials = {
  definedIs45: materialOf(tables, 45).attGroup === 45,
  // 37 and 99 are never defined in vanilla (§9.1 handles them specially,
  // before any material lookup) — an id nothing ever defined falls back to
  // material 0's own record.
  undefinedFallsBackToZero: materialOf(tables, 37).attGroup === 0
    && materialOf(tables, 99).attGroup === 0,
  noIdFallsBackToZero: materialOf(tables, undefined).attGroup === 0,
  modifier: {
    willyIntoSpitfireHull: damageModifier(tables, 45, 60),
    spitfireHullIntoWilly: damageModifier(tables, 60, 45),
    willyIntoSpitfireFace90: damageModifier(tables, 45, 90),   // no cell -> 0
    face90IntoWilly: damageModifier(tables, 90, 45),           // cell -> 0.1
    untabulatedPair: damageModifier(tables, 61, 52),           // no cell -> 0
  },
  damage: {
    willy: materialDamage(tables, 45),        // 1.0, every armour material
    groundDefault: materialDamage(tables, 0), // 30.0, every terrain material
  },
};

// contactMaterialValues: defined-material-missing-field defaults (1.0/0/0.01)
// vs. an undefined id falling back to material 0's own values.
out.contactValues = {
  bothDefined: contactMaterialValues(tables, 45, 50),   // (1+1)/2 friction, etc.
  oneUndefined: contactMaterialValues(tables, 45, 201), // 201 -> material 0's own
  material0FrictionOnly: tables.materials['0'].friction, // 1.0, elasticity/resistance absent
};

// --- angleFactor, §9.3/C8 ----------------------------------------------------

out.angleFactor = {
  aircraftAlwaysOne: angleFactor(0.2, 1),               // angleMod 1 -> always 1
  groundVehicleGrazeIsGentle: angleFactor(0.1, 0),       // sin(0.1*pi/2), small
  squareOnIsOneRegardlessOfMod: [0, 0.3, 0.7, 1].map(am => angleFactor(1, am)),
  // The exact literal the briefing names: angleMod 0 at 45 degrees between
  // velocity and normal (c = cos(45deg)) gives sin(cos(45deg) * pi/2).
  at45DegreesAngleMod0: angleFactor(Math.cos(Math.PI / 4), 0),
  at45DegreesExpected: Math.sin(Math.cos(Math.PI / 4) * Math.PI / 2),
};

// --- §9.3 object-vs-object worked numbers, V4 section 6 ----------------------

{
  const { speed, normal } = squareOn(15);
  // Willy (mat 45, speedMod 1, angleMod 0) into a parked Spitfire (face
  // 60/61/63, speedMod 2, angleMod 1).
  const spitfireHull = objectCollisionDamage({
    speed, normal, attackerDamageMod: 1,
    victimSpeedMod: 2, victimAngleMod: 1, matAttacker: 45, matVictim: 60,
  }, tables);
  const willyFromHull = objectCollisionDamage({
    speed, normal, attackerDamageMod: 1,
    victimSpeedMod: 1, victimAngleMod: 0, matAttacker: 60, matVictim: 45,
  }, tables);
  // The same contact, but the Spitfire face hit is material 90.
  const spitfireFace90 = objectCollisionDamage({
    speed, normal, attackerDamageMod: 1,
    victimSpeedMod: 2, victimAngleMod: 1, matAttacker: 45, matVictim: 90,
  }, tables);
  const willyFromFace90 = objectCollisionDamage({
    speed, normal, attackerDamageMod: 1,
    victimSpeedMod: 1, victimAngleMod: 0, matAttacker: 90, matVictim: 45,
  }, tables);
  // Willy into a Sherman (mat 50, speedMod 1, angleMod 0).
  const shermanFromWilly = objectCollisionDamage({
    speed, normal, attackerDamageMod: 1,
    victimSpeedMod: 1, victimAngleMod: 0, matAttacker: 45, matVictim: 50,
  }, tables);
  const willyFromSherman = objectCollisionDamage({
    speed, normal, attackerDamageMod: 1,
    victimSpeedMod: 1, victimAngleMod: 0, matAttacker: 50, matVictim: 45,
  }, tables);
  out.willySpitfireSherman = {
    spitfireHull, willyFromHull, spitfireFace90, willyFromFace90,
    shermanFromWilly, willyFromSherman,
  };
}

// The > 1.0 gate: a plane (speedMod 2, angleMod 1) hit square-on by a Willy
// (mat 45), at the two speeds either side of the threshold.
{
  const under = squareOn(2.2);
  const over = squareOn(2.3);
  out.threshold = {
    justUnder: objectCollisionDamage({
      speed: under.speed, normal: under.normal, attackerDamageMod: 1,
      victimSpeedMod: 2, victimAngleMod: 1, matAttacker: 45, matVictim: 60,
    }, tables),
    justOver: objectCollisionDamage({
      speed: over.speed, normal: over.normal, attackerDamageMod: 1,
      victimSpeedMod: 2, victimAngleMod: 1, matAttacker: 45, matVictim: 60,
    }, tables),
  };
}

// --- §9.5 terrain worked numbers, V4 section 6 --------------------------------

// A Spitfire into flat ground at 40 m/s, 30 degrees below the horizon: the
// angle between velocity and the surface normal is 60 degrees, c = cos(60) =
// 0.5.
{
  const speedMag = 40;
  const belowHorizon = 30 * Math.PI / 180;
  const speed = [
    speedMag * Math.cos(belowHorizon), -speedMag * Math.sin(belowHorizon), 0,
  ];
  const normal = [0, 1, 0];
  const against = (matTerrain, matSelf) => terrainCollisionDamage({
    speed, normal, victimSpeedMod: 2, matTerrain, matSelf,
  }, tables);
  out.spitfireIntoGround = {
    vertex60: against(0, 60),
    vertex61: against(0, 61),
    vertex61AgainstRock: against(12, 61),
    vertex90: against(0, 90),
    wheel178: against(0, 178),
  };
}

// A Willy coming down on its hull (mat 45) vs. on a wheel (mat 37 — no
// damage dispatch, §9.6's "why a jeep survives a jump it lands").
{
  const speed = [0, -10, 0];
  const normal = [0, 1, 0];
  out.willyLanding = {
    onHull: terrainCollisionDamage({
      speed, normal, victimSpeedMod: 1, matTerrain: 0, matSelf: 45,
    }, tables),
    onWheelIsNoDispatch: classifyContact(NO_DAMAGE_MATERIAL, 0) === 'none',
  };
}

// Water: only when damageFromWater, and — unlike land — no > 1.0 gate, so a
// product that would have been zeroed on land is returned as-is.
{
  const gentle = [0, -0.2, 0];      // small enough that the raw product < 1.0
  const brisk = [0, -3, 0];
  const normal = [0, 1, 0];
  out.water = {
    withoutFlagIsZero: terrainCollisionDamage({
      speed: brisk, normal, victimSpeedMod: 1, matTerrain: WATER_MATERIAL,
      matSelf: 45, damageFromWater: false,
    }, tables),
    noGateBelowThreshold: terrainCollisionDamage({
      speed: gentle, normal, victimSpeedMod: 1, matTerrain: WATER_MATERIAL,
      matSelf: 45, damageFromWater: true,
    }, tables),
    landEquivalentWouldBeZero: terrainCollisionDamage({
      speed: gentle, normal, victimSpeedMod: 1, matTerrain: 0, matSelf: 45,
    }, tables),
  };
}

// --- §9.1 classification -----------------------------------------------------

out.classify = {
  otherIsKill: classifyContact(45, KILL_MATERIAL),
  selfIsKillDoesNotMatter: classifyContact(KILL_MATERIAL, 45),
  selfIsNoDamage: classifyContact(NO_DAMAGE_MATERIAL, 45),
  otherIsNoDamage: classifyContact(45, NO_DAMAGE_MATERIAL),
  ordinary: classifyContact(45, 60),
};

// --- CollisionList, §9.2 ------------------------------------------------------

{
  const list = new CollisionList();
  const r = {};
  r.emptyHasNothing = list.has('a');
  list.add('a');
  r.hasRightAfterAdd = list.has('a');
  list.update(0.99);
  r.stillThereAtPoint99 = list.has('a');
  list.update(0.02);           // total elapsed 1.01 s
  r.goneAfterOneSecond = list.has('a');
  out.rateLimiterTiming = r;
}

{
  // A fresh add's timer is max(0, 1.0 - sum of queued timers): a second
  // key added immediately after the first gets a timer of 0 and expires on
  // the very next update, however small dt is.
  const list = new CollisionList();
  list.add('a');
  list.add('b');
  const r = { hasAOnAdd: list.has('a'), hasBOnAdd: list.has('b') };
  list.update(1 / 30);
  r.aGoneAfterOneTick = list.has('a');
  r.bGoneAfterOneTick = list.has('b');
  out.secondAddSharesTheBudget = r;
}

{
  // Terrain (null) and an object share the same 16 slots but are distinct
  // entries.
  const list = new CollisionList();
  list.add(null);
  list.add('obj');
  out.terrainAndObjectAreSeparateEntries = {
    hasTerrain: list.has(null), hasObj: list.has('obj'),
  };
}

{
  // The 16th insert evicts the oldest (index 0), leaving at most 15 live.
  const list = new CollisionList();
  for (let i = 0; i < 16; i++) list.add(`k${i}`);
  const live = [];
  for (let i = 0; i < 16; i++) if (list.has(`k${i}`)) live.push(i);
  out.sixteenthEvictsOldest = { firstStillThere: list.has('k0'), liveIndices: live };
}

// --- soldier branches, §9.3/§9.5, C8's written-out form -----------------------

{
  // Below the raw 8 m/s floor: nothing, however the projections look.
  const below = squareOn(7);
  out.soldierRawFloor = {
    below: soldierCollisionDamage({
      speed: below.speed, normal: below.normal,
      victimSpeedMod: 0.5, victimAngleMod: 0, matAttacker: 45, matVictim: 40,
      attackerSpeedAlong: 7, victimSpeedAlong: 0, fallHeight: 1,
    }, tables),
    // At exactly 8 the engine's own "return if 0 > V-8" does NOT return.
    atFloorIsNotZeroSpeedFactor: (() => {
      const at8 = squareOn(8);
      return soldierCollisionDamage({
        speed: at8.speed, normal: at8.normal,
        victimSpeedMod: 0.5, victimAngleMod: 0, matAttacker: 45, matVictim: 40,
        attackerSpeedAlong: 8, victimSpeedAlong: 8, fallHeight: 1,
      }, tables);
    })(),
  };
}

{
  // V' = |attacker proj| + max(|victim proj| - 8, 0): doubling the victim's
  // own speed past the 8 floor adds to V' at half rate, doubling the
  // attacker's contributes at full rate.
  const { speed, normal } = squareOn(20);
  const base = (attackerSpeedAlong, victimSpeedAlong) => soldierCollisionDamage({
    speed, normal, victimSpeedMod: 0.5, victimAngleMod: 0,
    matAttacker: 45, matVictim: 40, attackerSpeedAlong, victimSpeedAlong,
    fallHeight: 1,
  }, tables);
  out.soldierVprime = {
    attackerOnly: base(12, 0),          // V' = 12
    doubledAttacker: base(24, 0),       // V' = 24 -> 4x the damage (V'^2)
    victimContributesPastFloor: base(12, 16), // V' = 12 + (16-8) = 20
    victimUnderFloorContributesNothing: base(12, 6), // V' = 12 + 0
  };
}

{
  // No attacker damage modifier anywhere in the soldier product: an
  // attackerDamageMod field is not even accepted, so passing one in the
  // options object (as objectCollisionDamage takes) must have no effect —
  // confirmed by the function signature itself, not re-tested numerically
  // here (there is nothing to multiply by).
  out.soldierHasNoAttackerDamageModParam =
    !soldierCollisionDamage.toString().includes('attackerDamageMod');
}

// terrain soldier variant: cross-check against fall-damage.js's own formula,
// which is the identical arithmetic reached a different way (ids + table
// lookup here, precomputed scalars there).
{
  const speed = [0, -12, 0];
  const normal = [0, 1, 0];
  out.terrainSoldier = {
    straightDownV12F4: terrainCollisionDamage({
      speed, normal, victimSpeedMod: 0.5, matTerrain: 0, matSelf: 40,
      soldier: { fallHeight: 4, kitDamping: 1 },
    }, tables),
    // fall-damage.js's own number for the identical inputs (damageMod 0.001,
    // materialDamage 30 — this fixture's own (0,40) cell and material 0's
    // damage, both read from the table here instead of being fed in raw).
    expectedFromFallDamageShape: (() => {
      const v = 12 - SOLDIER_SPEED_FLOOR;
      const h = 4 - 1;
      const hPrime = h >= 1 ? h : 1;
      const k = Math.max(hPrime, 1);
      let a = Math.abs(1) ** 3;
      if (h >= 1) a = h >= 2 ? 1 : a + (1 - a) * (h - 1);
      if (v > 30) a = 1; else if (v > 10) a = a + (1 - a) * (v - 10) / 20;
      return k * k * a * (0.5 * v * v) * 0.001 * 30;
    })(),
  };
}

// --- CrashDamage glue, §9.1/§9.2/§9.7 -----------------------------------------

{
  const cd = new CrashDamage(tables);
  cd.register('willy', { speedMod: 1, angleMod: 0, damageMod: 1 });
  cd.register('spitfire', { speedMod: 2, angleMod: 1, damageMod: 1 });
  const { speed, normal } = squareOn(15);

  const spitfireResult = cd.onObjectContact(
    'spitfire', 'willy', speed, normal, 60, 45);
  const willyResult = cd.onObjectContact(
    'willy', 'spitfire', speed, normal, 45, 60);
  out.crashDamageWorkedContact = { spitfireResult, willyResult };

  // Rate limiter: the same pair again within 1.0 s is null.
  const again = cd.onObjectContact('spitfire', 'willy', speed, normal, 60, 45);
  out.crashDamageRateLimited = again;

  // Advance exactly to (and one tick past) 1.0 s: fires again.
  cd.update(0.99);
  const stillLimited = cd.onObjectContact('spitfire', 'willy', speed, normal, 60, 45);
  cd.update(1 / 30);
  const firesAgain = cd.onObjectContact('spitfire', 'willy', speed, normal, 60, 45);
  out.crashDamageRateLimiterExpiry = {
    stillLimitedAtPoint99: stillLimited,
    firesAgainAfterOneSecond: firesAgain !== null,
  };
}

{
  // Kill material: instant, no list interaction, no effect cell.
  const cd = new CrashDamage(tables);
  cd.register('victim', { speedMod: 1, angleMod: 0 });
  const { speed, normal } = squareOn(15);
  const result = cd.onObjectContact('victim', 'attacker', speed, normal, 45, KILL_MATERIAL);
  out.crashDamageKill = {
    result,
    listUntouched: !cd.owners.get('victim').list.has('attacker'),
  };
}

{
  // Material 37: null, and per the spec's read of the instruction order, the
  // list is not touched either (checked both ways: victim's own material and
  // the attacker's).
  const cd = new CrashDamage(tables);
  cd.register('victim', { speedMod: 1, angleMod: 0 });
  const { speed, normal } = squareOn(15);
  const victimIsWheel = cd.onObjectContact(
    'victim', 'attackerA', speed, normal, NO_DAMAGE_MATERIAL, 45);
  const attackerIsWheel = cd.onObjectContact(
    'victim', 'attackerB', speed, normal, 45, NO_DAMAGE_MATERIAL);
  out.crashDamageNoDamageMaterial = {
    victimIsWheel, attackerIsWheel,
    listUntouchedA: !cd.owners.get('victim').list.has('attackerA'),
    listUntouchedB: !cd.owners.get('victim').list.has('attackerB'),
  };
}

{
  // An unregistered attacker contributes damageMod 1.0 — proven against a
  // registered attacker whose authored damageMod is 2, not 1: if the
  // multiplication were not actually wired up, this pair would coincide too.
  const cdUnregistered = new CrashDamage(tables);
  cdUnregistered.register('victim', { speedMod: 2, angleMod: 1 });
  const cdRegistered = new CrashDamage(tables);
  cdRegistered.register('victim', { speedMod: 2, angleMod: 1 });
  cdRegistered.register('attacker', { speedMod: 1, angleMod: 0, damageMod: 2 });
  const { speed, normal } = squareOn(15);
  out.unregisteredAttackerDefaultsToOne = {
    unregistered: cdUnregistered.onObjectContact(
      'victim', 'attacker', speed, normal, 60, 45),
    registeredWithDoubleDamageMod: cdRegistered.onObjectContact(
      'victim', 'attacker', speed, normal, 60, 45),
  };
}

{
  // Terrain contact through CrashDamage, and that it shares the victim's
  // CollisionList with object contacts (a terrain hit does not reset an
  // object's own rate limit, and vice versa).
  const cd = new CrashDamage(tables);
  cd.register('spitfire', { speedMod: 2, angleMod: 1 });
  cd.register('willy', { speedMod: 1, angleMod: 0 });
  const groundSpeed = [0, -10, 0];
  const groundNormal = [0, 1, 0];
  const contactSpeed = squareOn(15);

  const terrainHit = cd.onTerrainContact('spitfire', groundSpeed, groundNormal, 60, 0);
  const objectHit = cd.onObjectContact(
    'spitfire', 'willy', contactSpeed.speed, contactSpeed.normal, 60, 45);
  const terrainAgainIsLimited = cd.onTerrainContact(
    'spitfire', groundSpeed, groundNormal, 60, 0);
  out.crashDamageTerrainContact = {
    terrainHit, objectHit, terrainAgainIsLimited,
  };
}

{
  // A soldier registered owner takes vehicle-collision damage through
  // onObjectContact's soldier branch (no attacker damageMod anywhere).
  const cd = new CrashDamage(tables);
  cd.register('soldier', { speedMod: 0.5, angleMod: 0, soldier: true });
  const { speed, normal } = squareOn(20);
  const result = cd.onObjectContact(
    'soldier', 'willy', speed, normal, 40, 45,
    { attackerSpeedAlong: 20, victimSpeedAlong: 0, fallHeight: 1 });
  out.crashDamageSoldierRunOver = result;
}

console.log(JSON.stringify(out, null, 2));
