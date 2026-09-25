// Drives `viewer/supply.js` (plus `viewer/armor.js`, for a real target) outside
// a browser and prints one JSON blob. Neither module imports three.js or the
// DOM, so — like `effects_harness.mjs` — this is the whole harness.
//
// Depot fixtures below are transcribed verbatim from Wake's own
// `scene.glb` node extras (`dump_wake_supply.py`, run against
// `viewer/maps/wake/scene.glb` on 2026-09-16): the exact `radius`/`team`/
// `health`/`ammoTypes` rows each archetype ships, not invented numbers.

import { SupplyDepot, SupplyField, UPDATE_INTERVAL } from './supply.mjs';
import { Armor } from './armor.mjs';

const out = {};
out.constants = { UPDATE_INTERVAL };

const target = (overrides = {}) => ({
  x: 0, y: 0, z: 0, team: 2, armor: new Armor(30), refillAmmo: null,
  ...overrides,
});
const withCounter = t => {
  t.refillCount = 0;
  t.refillAmmo = () => { t.refillCount++; };
  return t;
};

/** Run `n` update cycles of exactly `UPDATE_INTERVAL` seconds each — the
 *  depot's own self-throttle interval, so every call is guaranteed to fire
 *  the leaky bucket exactly once (SUP-11). */
function runCycles(depot, t, n) {
  const results = [];
  for (let i = 0; i < n; i++) results.push(depot.tick(UPDATE_INTERVAL, t));
  return results;
}

// --- Wake's own depot archetypes (dump_wake_supply.py, 2026-09-16) ----------

const AMMOBOX = { radius: 3.0, team: 0,
  health: [0.0, 0.0, 0.0],
  ammoTypes: [[1, -1, 15.0, 0], [2, -1, 1.2, 0], [3, -1, 1.2, 0]],
  workOnSoldiers: true, workOnVehicles: false };
const MEDICLOCKER = { radius: 2.0, team: 0,
  health: [-1.0, 4.0, 0.0], workOnSoldiers: true, workOnVehicles: false };
// M3A1SupplyDepot ships no team/workOnSoldiers/workOnVehicles key at all —
// the sparse-data case the defaults exist for.
const M3A1_HYBRID = { radius: 1.3,
  health: [-1.0, 4.0, 0.0],
  ammoTypes: [[1, -1, 15.0, 0], [2, -1, 1.2, 0], [3, -1, 1.2, 0]] };
const AIRPLANE_AMMO = { radius: 20.0, team: 2,
  health: [0.0, 0.0, 0.0],
  ammoTypes: [[10, -1, 100.0, 0], [9, -1, 4.0, 0], [8, -1, 100.0, 0], [7, -1, 4.0, 0]],
  workOnSoldiers: false, workOnVehicles: true };

// --- defaults on sparse data --------------------------------------------

{
  const d = new SupplyDepot({ x: 0, y: 0, z: 0 }, M3A1_HYBRID, 'M3A1SupplyDepot');
  out.defaults = {
    team: d.team, workOnSoldiers: d.workOnSoldiers, workOnVehicles: d.workOnVehicles,
  };
}

// --- team gating (SUP-15/16/33) ------------------------------------------

{
  const axisDepot = new SupplyDepot({ x: 0, y: 0, z: 0 }, { ...AMMOBOX, team: 1 });
  const alliedDepot = new SupplyDepot({ x: 0, y: 0, z: 0 }, { ...AMMOBOX, team: 2 });
  const neutralDepot = new SupplyDepot({ x: 0, y: 0, z: 0 }, AMMOBOX);
  out.teamGate = {
    axisDepotVsAllied: axisDepot.eligibleForSoldier(target({ team: 2 })),
    axisDepotVsAxis: axisDepot.eligibleForSoldier(target({ team: 1 })),
    alliedDepotVsAllied: alliedDepot.eligibleForSoldier(target({ team: 2 })),
    neutralVsEither: [1, 2].map(team => neutralDepot.eligibleForSoldier(target({ team }))),
  };
}

// --- radius is inclusive, in 3-D (SUP-15) ---------------------------------

{
  const d = new SupplyDepot({ x: 0, y: 0, z: 0 }, { ...AMMOBOX, radius: 5, team: 0 });
  const at = dist => d.inRange(target({ x: dist, team: 2 }));
  out.radius = {
    exactlyAtRadius: at(5),
    justInside: at(4.999),
    justOutside: at(5.001),
    // A vertical offset counts too — this is 3-D distance, not a flat radius.
    verticalAtRadius: d.inRange(target({ x: 0, y: 5, z: 0, team: 2 })),
  };
}

// --- self-throttle cadence (SUP-11) ---------------------------------------

{
  const d = new SupplyDepot({ x: 0, y: 0, z: 0 }, MEDICLOCKER);
  const t = target({ armor: new Armor(30, 10) });
  // `hp` must be read right after each call, not deferred into one object
  // literal at the end — property values in an object literal are evaluated
  // where the literal is built, which is after every `tick()` below has
  // already run, and would otherwise report the *final* HP for all three.
  const under = d.tick(0.2, t); const hpAfterUnder = t.armor.hitPoints;         // well under 0.5s: nothing
  const stillUnder = d.tick(0.2, t); const hpAfterStillUnder = t.armor.hitPoints; // 0.4s accumulated: still nothing
  const crosses = d.tick(0.2, t); const hpAfterCrosses = t.armor.hitPoints;     // 0.6s accumulated: fires once
  out.cadence = {
    under: { ...under, hp: hpAfterUnder },
    stillUnder: { ...stillUnder, hp: hpAfterStillUnder },
    crosses: { ...crosses, hp: hpAfterCrosses },
  };
}

// --- ammo leaky bucket pacing (SUP-21), against Ammobox's real rates ------

{
  const d = new SupplyDepot({ x: 0, y: 0, z: 0 }, AMMOBOX);
  const t = withCounter(target());
  // 15/s against a 0.5s check is 7.5 whole units every cycle: ammo should
  // fire on essentially every single tick.
  const results = runCycles(d, t, 20);
  out.ammoBoxPacing = {
    firedEveryTick: results.every(r => r.gaveAmmo === true),
    healedAny: results.some(r => r.healed),
    refillCalls: t.refillCount,
  };
}

// --- pure heal depot (mediclocker's real rate, 4.0 HP/s) -------------------

{
  const d = new SupplyDepot({ x: 0, y: 0, z: 0 }, MEDICLOCKER);
  const t = target({ armor: new Armor(30, 10) });
  // Five 0.5s cycles = 2.5s x 4 HP/s = 10 HP, landing exactly on 20/30 — a
  // clean number specifically so a clamp-order bug would visibly miss it.
  const results = runCycles(d, t, 5);
  out.mediclockerHeal = {
    healedEveryTick: results.every(r => r.healed === true && r.gaveAmmo === false),
    hpAfter5Cycles: t.armor.hitPoints,
  };
  // And it clamps at the target's own max, same as any other heal.
  const capped = target({ armor: new Armor(30, 28) });
  runCycles(d, capped, 5);
  out.mediclockerHeal.clampsAtMax = capped.armor.hitPoints;
}

// --- ammo-before-heal priority, on the one Wake depot with both (SUP-18) --

{
  const d = new SupplyDepot({ x: 0, y: 0, z: 0 }, M3A1_HYBRID);
  const t = withCounter(target({ team: 2, armor: new Armor(30, 10) }));
  const results = runCycles(d, t, 20);
  out.m3a1Priority = {
    ammoFiredCount: results.filter(r => r.gaveAmmo).length,
    healFiredCount: results.filter(r => r.healed).length,
    hpUnchanged: t.armor.hitPoints === 10,
    refillCalls: t.refillCount,
  };
}

// --- sign of rate selects heal vs. damage (SUP-26) — an FH-style trap, not
// anything Wake ships, exercised so the general mechanism is proven, not
// just the retail case. -----------------------------------------------------

{
  const trap = new SupplyDepot({ x: 0, y: 0, z: 0 },
    { radius: 10, team: 0, health: [-1, -4.0, 0], workOnSoldiers: true });
  const t = target({ armor: new Armor(30, 30) });
  const results = runCycles(trap, t, 3);   // 1.5s x 4 HP/s = 6 HP lost
  out.killTrapSign = {
    // No ammo types on this depot, so every cycle takes the heal/damage
    // branch, never the ammo one...
    tookHealBranch: results.every(r => r.gaveAmmo === false),
    // ...but `healed` correctly reads false throughout, since a negative
    // rate is reported as what it is (damage), not mislabelled as a heal.
    reportedAsHeal: results.every(r => r.healed === true),
    hpAfter: t.armor.hitPoints,
  };
}

// --- a vehicle-only depot never fires for a soldier target, whatever its
// ammo/team data says. -------------------------------------------------------

{
  const d = new SupplyDepot({ x: 0, y: 0, z: 0 }, AIRPLANE_AMMO);
  const t = withCounter(target({ team: 2 }));
  runCycles(d, t, 10);
  out.vehicleOnlyIgnoresSoldier = {
    eligible: d.eligibleForSoldier(t),
    refillCalls: t.refillCount,
  };
}

// --- vehicle supply: `workOnVehicles` depots serve a mounted player's hull
// (the airstrip rearm) on the same team/radius/cadence rules. ---------------

{
  // A hybrid depot (soldier AND vehicle capable, the vehicle ammoboxes')
  // must serve each kind only its own half.
  const hybrid = new SupplyDepot({ x: 0, y: 0, z: 0 },
    { ...AMMOBOX, workOnVehicles: true });
  const foot = withCounter(target({ team: 2 }));
  const seated = withCounter(target({ team: 2, vehicle: true }));
  runCycles(hybrid, foot, 2);
  runCycles(hybrid, seated, 2);
  out.hybridServesBothKinds = {
    foot: { refillCalls: foot.refillCount },
    seated: { refillCalls: seated.refillCount },
  };

  // The airstrip's own depot, verbatim: team 2, radius 20, ammo-only. A
  // mounted allied player inside 20 m gets a refill on the depot's 0.5 s
  // cadence; the same player on foot gets nothing; an enemy hull none.
  const strip = new SupplyDepot({ x: 0, y: 0, z: 0 }, AIRPLANE_AMMO,
    'AlliedAirplaneSupplyDepot');
  const hull = withCounter(target({ team: 2, vehicle: true }));
  const results = runCycles(strip, hull, 20);
  out.airplaneDepotRearmsHull = {
    firedEveryTick: results.every(r => r.gaveAmmo === true),
    healedAny: results.some(r => r.healed),
    refillCalls: hull.refillCount,
  };
  const enemyHull = withCounter(target({ team: 1, vehicle: true }));
  runCycles(strip, enemyHull, 4);
  out.airplaneDepotTeamGate = {
    refillCalls: enemyHull.refillCount,
    eligible: strip.eligibleForVehicle(enemyHull),
  };
  // Same depot, soldier standing under the pad: still nothing.
  const footUnder = withCounter(target({ team: 2 }));
  runCycles(strip, footUnder, 4);
  out.airplaneDepotIgnoresFoot = {
    refillCalls: footUnder.refillCount,
  };

  // The kind gates are mutually exclusive at the predicate level, hybrid or
  // not: a vehicle target is not also a soldier, and the other way.
  const both = new SupplyDepot({ x: 0, y: 0, z: 0 },
    { ...M3A1_HYBRID, workOnVehicles: true, workOnSoldiers: true });
  out.kindGates = {
    vehiclePredicateOnFootTarget: both.eligibleForVehicle(target({ team: 2 })),
    soldierPredicateOnVehicleTarget: both.eligibleForSoldier(target({ team: 2, vehicle: true })),
  };
}

// --- SupplyField: icon eligibility is continuous, not throttled -----------

{
  const field = new SupplyField([
    new SupplyDepot({ x: 100, y: 0, z: 0 }, AMMOBOX, 'far ammobox'),
    new SupplyDepot({ x: 0, y: 0, z: 0 }, MEDICLOCKER, 'near mediclocker'),
  ]);
  const near = target({ x: 0.5, y: 0, z: 0, team: 2 });
  const far = target({ x: 500, y: 0, z: 0, team: 2 });
  out.field = {
    nearCanHeal: field.canHeal(near),
    nearCanRearm: field.canRearm(near),   // false: the ammobox is 100m away
    farCanHeal: field.canHeal(far),
    farCanRearm: field.canRearm(far),
    nearestName: field.nearest(near)?.depot.name,
    nearestDistance: +field.nearest(near).distance.toFixed(2),
  };
}

process.stdout.write(JSON.stringify(out, null, 2));
