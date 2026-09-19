// Drives `viewer/vehicle-damage.js` outside a browser and prints one JSON blob.
// The module imports `armor.js` and `effects-core.js`, neither of which imports
// anything, so the three copied files are the whole harness — no vendored
// three.js (contrast `ground_harness.mjs`).
import {
  activeTier, deathTier, DamageableVehicle, VehicleDamageSet,
  TIER_DEATH, TIER_WATER_DEATH, inputGate, CRITICAL_INPUT_SCALE,
} from './vehicle-damage.mjs';
import { Armor } from './armor.mjs';

const out = {};

// The Sherman's own tiers, verbatim from `objects/vehicles/land/sherman/
// objects.con` and reproduced by the assembler into the scene's `armor` extras.
const SHERMAN = {
  hitpoints: 100, maxHitpoints: 100,
  criticalDamage: 12, hpLostWhileCriticalDamage: 1.5,
  hpLostWhileDamageFromWater: 10, hpLostWhileUpSideDown: 10,
  damageFromWater: true,
  effects: [
    { hp: 50, effect: 'e_PanzDamage', offset: [0, 0.9, -1.8] },
    { hp: 12, effect: 'e_PanzFire', offset: [0, 1.2, -1.4] },
    { hp: 0, effect: 'e_ExplGas', offset: [0, 0, 0] },
    { hp: 0, effect: 'e_scrapmetal', offset: [0, 0, 0] },
    { hp: 0, effect: 'e_scrapmetalsmoke', offset: [0, 0, 0] },
    { hp: -1, effect: 'WaterWaterExplosion', offset: [0, 0, 0] },
  ],
};

// The Spitfire, which declares TWO effects at one threshold — the case a
// "one effect per tier" reading would drop.
const SPITFIRE = {
  hitpoints: 100, maxHitpoints: 100,
  criticalDamage: 20, hpLostWhileCriticalDamage: 1.5,
  hpLostWhileDamageFromWater: 10, damageFromWater: true,
  effects: [
    { hp: 65, effect: 'em_StukaDamage', offset: [0, 0.102, 2.11] },
    { hp: 65, effect: 'em_PlaneDamage', offset: [0, 0.103, 2.11] },
    { hp: 20, effect: 'e_StukaFire', offset: [0, 0.6, 2.11] },
    { hp: 0, effect: 'e_ExplGas', offset: [0, 0, 0] },
    { hp: -1, effect: 'WaterWaterExplosion', offset: [0, 0, 0] },
  ],
};

// A boat: damageFromWater is false, so it does not drown even in water.
const BOAT = {
  hitpoints: 500, maxHitpoints: 500,
  criticalDamage: 350, hpLostWhileCriticalDamage: null,
  hpLostWhileDamageFromWater: null, damageFromWater: false,
  effects: [
    { hp: 350, effect: 'em_LcvpDamage', offset: [0, 1, 0] },
    { hp: 200, effect: 'waterBoatSinkSmall', offset: [0, 0, 0] },
    { hp: 125, effect: 'waterBoatSinkLarge', offset: [0, 0, 0] },
    { hp: 0, effect: 'e_scrapmetal', offset: [0, 0, 0] },
    { hp: -1, effect: 'WaterWaterExplosion', offset: [0, 0, 0] },
  ],
};

out.constants = { TIER_DEATH, TIER_WATER_DEATH };

// Which tier is active across the Sherman's whole HP range.
out.shermanTiers = [100, 51, 50, 49, 13, 12, 11, 1].map(hp => {
  const tier = activeTier(SHERMAN.effects, hp);
  return { hp, threshold: tier?.threshold ?? null, names: tier?.names ?? [] };
});

// Two effects at one threshold both play.
out.spitfireAt65 = activeTier(SPITFIRE.effects, 65);

// The death tiers, dry and wet.
out.death = deathTier(SHERMAN.effects);
out.waterDeath = deathTier(SHERMAN.effects, { inWater: true });
// A template with no water tier falls back to the dry one.
out.waterDeathFallback = deathTier(
  [{ hp: 0, effect: 'e_ExplGas' }], { inWater: true });

// A vehicle that spawns full shows nothing and is not critical.
{
  const v = new DamageableVehicle(SHERMAN, { name: 'Sherman' });
  out.spawn = {
    hp: v.hitPoints, max: v.maxHitPoints, critical: v.critical,
    destroyed: v.destroyed, tier: v.update(1 / 30).tier,
  };
}

// Shot down to the smoke tier, then to the fire tier.
{
  const v = new DamageableVehicle(SHERMAN);
  v.damage(60);                                  // 40 HP
  const smoke = v.update(1 / 30);
  v.damage(30);                                  // 10 HP
  const fire = v.update(1 / 30);
  out.tierChanges = {
    smoke: { hp: v.hitPoints + 30, threshold: smoke.tier?.threshold,
             names: smoke.tier?.names, changed: smoke.changed },
    fire: { hp: v.hitPoints, threshold: fire.tier?.threshold,
            names: fire.tier?.names, changed: fire.changed,
            critical: v.critical },
  };
}

// The burn: 12 HP at 1.5/s is 8 whole seconds, and the loss is per firing, not
// scaled by dt. Step at 30 Hz from exactly critical and count.
{
  const v = new DamageableVehicle(SHERMAN);
  v.damage(88);                                   // exactly 12 HP: critical
  let elapsed = 0;
  let died = false;
  // Sample on the tick, not on the harness's own clock: summing 1/30 thirty
  // times lands just under 1.0 in binary floating point, so a second counted
  // here and a second counted inside the module drift apart by one step and a
  // by-the-clock sample would show a duplicate followed by a double loss.
  const ticks = [];
  let previous = v.hitPoints;
  for (let i = 0; i < 30 * 20 && !died; i++) {
    const result = v.update(1 / 30);
    elapsed += 1 / 30;
    if (v.hitPoints !== previous) {
      ticks.push({ at: Math.round(elapsed * 1000) / 1000,
                   hp: Math.round(v.hitPoints * 100) / 100 });
      previous = v.hitPoints;
    }
    if (result.died) died = true;
  }
  out.burn = {
    startedAt: 12, died, seconds: Math.round(elapsed * 100) / 100,
    tickCount: ticks.length, ticks, finalTier: v.shown,
  };
}

// A long frame checks in less often; it does not burn more. One 2 s step costs
// exactly two ticks.
{
  const v = new DamageableVehicle(SHERMAN);
  v.damage(88);
  v.update(2);
  out.longFrame = { hp: Math.round(v.hitPoints * 100) / 100 };
}

// Repaired back above the threshold: the tier clears and the burn resets.
{
  const v = new DamageableVehicle(SHERMAN);
  v.damage(90);                                   // 10 HP, burning
  v.update(1 / 30);
  const burning = v.shown?.threshold ?? null;
  v.heal(80);                                     // 90 HP
  const healed = v.update(1 / 30);
  out.repair = {
    burning, afterHeal: healed.tier, changed: healed.changed,
    critical: v.critical, accumulator: v.criticalAccumulator,
  };
}

// Death is announced once, then frozen.
{
  const v = new DamageableVehicle(SHERMAN);
  v.damage(100);
  const first = v.update(1 / 30);
  const second = v.update(1 / 30);
  out.deathOnce = {
    firstDied: first.died, firstNames: first.tier?.names ?? [],
    secondDied: second.died, secondChanged: second.changed,
    destroyed: v.destroyed,
  };
}

// Water damage: a Sherman in water loses hpLostWhileDamageFromWater (10)
// per second, starting immediately, flat (not scaled by dt).
{
  const v = new DamageableVehicle(SHERMAN);
  v.update(1.0, { inWater: true });          // first tick: 10 HP gone
  out.waterTick1 = { hp: v.hitPoints, acc: v.waterAccumulator };
  v.update(1.0, { inWater: true });          // second tick: another 10
  out.waterTick2 = { hp: v.hitPoints, acc: v.waterAccumulator };
  v.update(1.0, { inWater: true });          // third tick
  out.waterTick3 = { hp: v.hitPoints, acc: v.waterAccumulator };
}

// A long water frame does not over-damage: two whole seconds cost two ticks,
// not one.
{
  const v = new DamageableVehicle(SHERMAN);
  v.update(2.0, { inWater: true });          // 2s in one call
  out.waterLongFrame = { hp: v.hitPoints, acc: v.waterAccumulator };
}

// Leaving water resets the accumulator: re-entering starts a fresh second.
{
  const v = new DamageableVehicle(SHERMAN);
  v.update(0.5, { inWater: true });          // half-accumulated, no tick yet
  out.waterExitMid = { hp: v.hitPoints, acc: v.waterAccumulator };
  v.update(1 / 30, { inWater: false });       // dry: accumulator cleared
  out.waterExitDry = { acc: v.waterAccumulator };
}

// A boat (damageFromWater false) never drowns, even in water.
{
  const v = new DamageableVehicle(BOAT);
  v.update(3.0, { inWater: true });
  out.boatNoWaterDamage = { hp: v.hitPoints, acc: v.waterAccumulator };
}

// The set: inWaterOwners routes the flag per vehicle, tank sinks, boat floats.
{
  const set = new VehicleDamageSet();
  set.add(3, SHERMAN, { name: 'Sherman' });
  set.add(4, BOAT, { name: 'LCVP' });
  set.update(3.0, { inWaterOwners: new Set([3, 4]) });
  out.setWater = {
    shermanHp: set.get(3).hitPoints,
    boatHp: set.get(4).hitPoints,
    shermanAcc: set.get(3).waterAccumulator,
  };
}

// The set: without inWaterOwners nothing burns underwater.
{
  const set = new VehicleDamageSet();
  set.add(3, SHERMAN, { name: 'Sherman' });
  set.update(3.0);
  out.setNoWater = { shermanHp: set.get(3).hitPoints };
}

// The set: register by owner id, apply a hit record, step everything.
{
  const set = new VehicleDamageSet();
  set.add(3, SHERMAN, { name: 'Sherman' });
  set.add(4, SPITFIRE, { name: 'Spitfire' });
  // A palm has no armor block at all, and a building one with no hit points.
  const palm = set.add(5, null);
  const noHp = set.add(6, { effects: [{ hp: 0, effect: 'e_ExplGas' }] });

  // A round that names a non-damageable owner, then one that lands on the tank.
  const missed = set.applyHit({ owner: 99, damage: 40 });
  const landed = set.applyHit({ owner: 3, damage: 60 });
  // A hit with no damage (a bounced rifle round: damageMod 0.0) costs nothing.
  const bounced = set.applyHit({ owner: 3, damage: 0 });

  const changes = set.update(1 / 30);
  out.set = {
    size: set.size, palm, noHp,
    missed, landedLost: landed?.lost ?? null, bounced,
    changes: changes.map(c => ({
      name: c.vehicle.name, threshold: c.tier?.threshold ?? null,
      names: c.tier?.names ?? [], died: c.died,
    })),
    shermanHp: set.get(3).hitPoints,
  };
}

// The area pass. Tables in `damage.json`'s own shape: material 236 is a tank
// shell's splash (`material2`), 50 a tank hull's `splashMaterial`, and the
// modifier table is keyed by group, as strings, the way JSON delivers it.
{
  const materials = {
    236: { attGroup: 236, defGroup: 236, damage: 10 },
    50: { attGroup: 50, defGroup: 50, damage: 0 },
    73: { attGroup: 73, defGroup: 73, damage: 0 },
  };
  const modifiers = { 236: { 50: 2, 73: 0 } };
  const tables = { materials, modifiers };
  const fresh = () => {
    const set = new VehicleDamageSet();
    set.add(1, { ...SHERMAN, splashMaterial: 50 }, { name: 'Firer' });
    set.add(2, { ...SHERMAN, splashMaterial: 50 }, { name: 'Near' });
    set.add(3, { ...SHERMAN, splashMaterial: 50 }, { name: 'Edge' });
    set.add(4, { ...SHERMAN, splashMaterial: 73 }, { name: 'Immune' });
    set.add(5, SHERMAN, { name: 'OldExtract' });
    return set;
  };
  const targets = [
    { owner: 1, x: 0, y: 0, z: 0 },
    { owner: 2, x: 5, y: 0, z: 0 },
    { owner: 3, x: 10, y: 0, z: 0 },
    { owner: 4, x: 1, y: 0, z: 0 },
    { owner: 5, x: 1, y: 0, z: 0 },
    { owner: 99, x: 1, y: 0, z: 0 },
  ];
  const blast = {
    point: [0, 0, 0], firer: 1, splashMaterial2: 236, splashRadius: 10,
  };
  const set = fresh();
  const hurt = set.applySplash(blast, targets, tables);
  out.splash = {
    hurt: hurt.map(h => ({ name: h.vehicle.name, lost: h.lost, distance: h.distance })),
    firerHp: set.get(1).hitPoints,
    directOnly: fresh().applySplash({ point: [0, 0, 0], firer: 1 }, targets, tables).length,
    noSplashMaterial: fresh().applySplash(
      { ...blast, splashMaterial2: -1 }, targets, tables).length,
    noTables: fresh().applySplash(blast, targets).length,
  };

  // HP-9: only the Y term of the blast distance is scaled, by
  // `YModOnExplosion`. A target 5 m straight up is inside a 10 m blast at the
  // default 1.0 and outside it at 2.0.
  const above = [{ owner: 2, x: 0, y: 5, z: 0 }];
  const withMod = (yMod) => {
    const set = fresh();
    const hit = set.applySplash({ ...blast, splashYMod: yMod }, above, tables);
    return hit.length ? Math.round(hit[0].distance * 1e6) / 1e6 : null;
  };
  out.yMod = {
    absent: withMod(undefined),   // 5 m: the plain distance
    one: withMod(1),              // 5 m
    two: withMod(2),              // 10 m -> at the radius, so out
    // A horizontal target is untouched by the scale: X and Z are never
    // multiplied (0x08156613 multiplies dy alone).
    horizontalAtTwo: (() => {
      const set = fresh();
      const hit = set.applySplash({ ...blast, splashYMod: 2 },
                                  [{ owner: 2, x: 5, y: 0, z: 0 }], tables);
      return hit.length ? Math.round(hit[0].distance * 1e6) / 1e6 : null;
    })(),
  };

  // HP-9: an IMPACT blast is centred `hitPos + 0.1 * normal`, not on the hit
  // point (lnxded 0x08153f5e-0x08153f8f). `gunfire.js` puts that on the record
  // as `splashPoint`; the hit point stays on `point`, because that is where
  // the collision effect goes. An end-of-life blast carries no `splashPoint`
  // and falls back to `point`, which is the projectile's own position.
  const centre = (record) => {
    const set = fresh();
    const hit = set.applySplash(record, [{ owner: 2, x: 5, y: 0, z: 0 }], tables);
    return hit.length ? Math.round(hit[0].distance * 1e6) / 1e6 : null;
  };
  out.blastCentre = {
    // Struck a wall at the origin, normal +X: the blast is at x = 0.1, so a
    // victim 5 m out along +X is 4.9 m away, not 5.
    impact: centre({ ...blast, point: [0, 0, 0], splashPoint: [0.1, 0, 0] }),
    // The same record without the offset, for the contrast.
    unoffset: centre({ ...blast, point: [0, 0, 0] }),
    // A fuse round: `point` only, and it is used.
    endOfLife: centre({ ...blast, point: [1, 0, 0] }),
  };

  // --- HP-10: the soldier half --------------------------------------------
  //
  // A grenade's own numbers: `material2 205`, `radius 15`, and
  // `damageMod(205, 40)` = 2.0 against the soldier's material 40 with
  // `materialDamage(205)` = 30. A soldier is not a registered vehicle, so he
  // arrives carrying his own Armor.
  const soldierTables = {
    materials: {
      205: { attGroup: 205, defGroup: 205, damage: 30 },
      40: { attGroup: 40, defGroup: 40, damage: 1 },
    },
    modifiers: { 205: { 40: 2 } },
  };
  const grenade = {
    point: [0, 0, 0], firer: -1, splashMaterial2: 205, splashRadius: 15,
  };
  const splashSoldier = (distance, exposureValue, options = {}) => {
    const set = new VehicleDamageSet();
    const armor = new Armor(30);
    const target = {
      owner: -1, armor, soldier: true, splashMaterial: 40,
      x: distance, y: 0, z: 0, ...options,
    };
    const hurt = set.applySplash(grenade, [target], {
      ...soldierTables,
      exposure: () => exposureValue,
    });
    return {
      hp: Math.round(armor.hitPoints * 1e4) / 1e4,
      lost: hurt.length ? Math.round(hurt[0].lost * 1e4) / 1e4 : 0,
      exposure: hurt.length ? hurt[0].exposure : null,
      dead: armor.destroyed,
    };
  };
  out.soldierSplash = {
    // At the blast, standing (0.5) and crouching (1.0): 60 HP before
    // exposure, so 30 and 60 -- a grenade at your feet kills either way.
    atFeetStanding: splashSoldier(0, 0.5),
    atFeetCrouching: splashSoldier(0, 1.0),
    // Half the radius out: 60 * 0.5 falloff = 30, times exposure.
    sevenFiveStanding: splashSoldier(7.5, 0.5),
    sevenFiveCrouching: splashSoldier(7.5, 1.0),
    // Two of nine samples through, standing: 2/18.
    sevenFiveBarely: splashSoldier(7.5, 2 / 18),
    // Exposure 0 short-circuits -- no damage at all, however close.
    inCover: splashSoldier(0, 0),
    // Outside the radius: the strict `radius > d` gate.
    outside: splashSoldier(15, 1.0),
    // No exposure callback at all: the term stays at the seeded 1.0.
    noCallback: (() => {
      const set = new VehicleDamageSet();
      const armor = new Armor(30);
      const hurt = set.applySplash(grenade, [{
        owner: -1, armor, soldier: true, splashMaterial: 40, x: 7.5, y: 0, z: 0,
      }], soldierTables);
      return { lost: Math.round(hurt[0].lost * 1e4) / 1e4, exposure: hurt[0].exposure };
    })(),
    // A target that is NOT marked a soldier never asks for exposure, however
    // loudly the callback would have answered: there is no occlusion at all
    // for a non-soldier victim.
    notASoldier: (() => {
      const set = new VehicleDamageSet();
      const armor = new Armor(100);
      let asked = false;
      const hurt = set.applySplash(grenade, [{
        owner: -1, armor, splashMaterial: 40, x: 7.5, y: 0, z: 0,
      }], { ...soldierTables, exposure: () => { asked = true; return 0; } });
      return { asked, lost: Math.round(hurt[0].lost * 1e4) / 1e4 };
    })(),
    // The blast point is handed to the callback, so a caller can cast from it.
    callbackArguments: (() => {
      const set = new VehicleDamageSet();
      const seen = [];
      set.applySplash({ ...grenade, splashPoint: [1, 2, 3] }, [{
        owner: -1, armor: new Armor(30), soldier: true, splashMaterial: 40,
        pose: 2, x: 1, y: 2, z: 3,
      }], { ...soldierTables,
            exposure: (target, blast) => { seen.push({ pose: target.pose, blast }); return 1; } });
      return seen;
    })(),
  };
}

// HP-15: the input gate. A wreck takes no input at all; a critically damaged
// vehicle's rotational bundles take 0.2x.
{
  const set = new VehicleDamageSet();
  const sherman = set.add(1, SHERMAN, { name: 'Sherman' });
  const states = [];
  const snap = (label) => states.push({
    label, hp: sherman.hitPoints, critical: sherman.critical,
    destroyed: sherman.destroyed, ...inputGate(sherman),
  });
  snap('healthy');
  sherman.damage(60);            // 40 HP: damaged, tier shown, not critical
  snap('damaged');
  sherman.damage(30);            // 10 HP: below criticalDamage 12
  snap('critical');
  sherman.damage(100);           // dead
  snap('destroyed');
  sherman.reset();               // the wreck-respawn timer's effect
  snap('respawned');
  out.inputGate = {
    states,
    scale: CRITICAL_INPUT_SCALE,
    // An object with no Armor registered at all — a palm, a bare manned gun —
    // is not gated.
    unregistered: inputGate(null),
    // The caller-owned result object `map.html` passes every frame: filled in
    // place, returned, and the SAME object each time, so polling the gate
    // sixty times a second allocates nothing.
    inPlace: (() => {
      const slot = { blocked: false, rotationalScale: 1 };
      const dead = new VehicleDamageSet().add(1, SHERMAN, { name: 'Wreck' });
      dead.damage(200);
      const first = inputGate(dead, slot);
      // Snapshot before the next call: `first` IS `slot`, which is the point.
      const afterWreck = { ...first };
      const healthy = new VehicleDamageSet().add(1, SHERMAN, { name: 'Fresh' });
      const second = inputGate(healthy, slot);
      return {
        sameObject: first === slot && second === slot,
        // And it is genuinely rewritten, not just returned: the wreck's
        // `blocked` must not survive into the healthy read.
        afterWreck,
        afterHealthy: { ...second },
      };
    })(),
  };

  // The gate is read from the live Armor, so a hull killed by something other
  // than a shell is gated identically. The combat area's own per-frame
  // `giveDamage` lands on this same `Armor` (`stepCombatArea` in map.html),
  // and so does the critical burn's own `hpLostWhileCriticalDamage` tick.
  const burned = new VehicleDamageSet().add(1, SHERMAN, { name: 'Burner' });
  burned.damage(89);                       // 11 HP: critical, burning
  const whileBurning = inputGate(burned);
  for (let t = 0; t < 12; t++) burned.update(1);   // 1.5 HP/s for 12 s
  out.inputGate.byOtherCauses = {
    whileBurning,
    burnedDown: { destroyed: burned.destroyed, ...inputGate(burned) },
    // Combat-area damage, the same path `stepCombatArea` takes.
    combatArea: (() => {
      const v = new VehicleDamageSet().add(1, SHERMAN, { name: 'Strayed' });
      for (let t = 0; t < 30; t++) v.damage(5);    // 5 HP/s, the engine default
      return { destroyed: v.destroyed, ...inputGate(v) };
    })(),
  };
}

process.stdout.write(JSON.stringify(out, null, 1));
