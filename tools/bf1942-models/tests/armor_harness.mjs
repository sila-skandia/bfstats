// Drives `viewer/armor.js` outside a browser and prints one JSON blob.
// The module imports nothing, so this is the whole harness: no vendored
// three.js needed (contrast `ground_harness.mjs`).
import {
  Armor, DEATH_EPSILON, MAX_HITPOINTS_CEILING, TEMPLATE_HITPOINTS_DEFAULT,
  templateHitPoints,
} from './armor.mjs';

const out = {};
out.constants = { DEATH_EPSILON, MAX_HITPOINTS_CEILING, TEMPLATE_HITPOINTS_DEFAULT };

// A fresh soldier: 30/30, alive.
{
  const a = new Armor(30);
  out.spawn = { hp: a.hitPoints, max: a.maxHitPoints, destroyed: a.destroyed };
}

// Plain damage and heal, clamped at the max.
{
  const a = new Armor(30);
  const lost = a.damage(12);
  const afterDamage = { hp: a.hitPoints, lost, destroyed: a.destroyed };
  const gained = a.heal(5);
  const afterHeal = { hp: a.hitPoints, gained };
  const overheal = a.heal(100);   // must clamp at 30, not overshoot
  const afterOverheal = { hp: a.hitPoints, gained: overheal };
  out.damageAndHeal = { afterDamage, afterHeal, afterOverheal };
}

// A killing blow snaps to exactly 0, not a small positive remainder, and
// "lost" reports the true HP removed (23, not the 40 requested).
{
  const a = new Armor(30, 23);
  const lost = a.damage(40);
  out.killingBlow = { hp: a.hitPoints, lost, destroyed: a.destroyed };
}

// The comparison is "<= 0.001", not "< 0" or "== 0" (R4-2/R4-7): a result
// landing just below the epsilon must die, one landing just above it must
// not. (Testing 0.001 itself is not done here — it is not exactly
// representable in a double, so "damage that leaves exactly 0.001" is not a
// reproducible input; 0.0009/0.0011 straddle it with ample margin instead.)
{
  const justBelow = new Armor(30, 1);
  justBelow.damage(1 - 0.0009);
  const justAbove = new Armor(30, 1);
  justAbove.damage(1 - 0.0011);
  out.epsilonBoundary = {
    belowHp: justBelow.hitPoints, belowDestroyed: justBelow.destroyed,
    aboveDestroyed: justAbove.destroyed,
    aboveHpNear0011: Math.abs(justAbove.hitPoints - 0.0011) < 1e-9,
  };
}

// Destroyed is final: neither damage nor heal moves the number again.
{
  const a = new Armor(30, 5);
  a.damage(5);
  const damageAfterDeath = a.damage(10);
  const healAfterDeath = a.heal(10);
  out.deathIsFinal = {
    hp: a.hitPoints, destroyed: a.destroyed,
    damageAfterDeath, healAfterDeath,
  };
}

// Non-positive damage() and non-positive heal() are no-ops (the sign split
// belongs to applyDamage, not to these two).
{
  const a = new Armor(30, 20);
  const d = a.damage(0);
  const h = a.heal(-5);
  out.nonPositiveNoop = { hp: a.hitPoints, d, h };
}

// applyDamage: R4-19's sign dispatch. Positive damages; zero or negative
// heals by the absolute value.
{
  const a = new Armor(30, 20);
  a.applyDamage(6);
  const afterPositive = a.hitPoints;
  a.applyDamage(-4);
  const afterNegative = a.hitPoints;
  a.applyDamage(0);       // amt<=0 branch, heals by -0 = 0: a no-op in effect
  const afterZero = a.hitPoints;
  out.applyDamageSign = { afterPositive, afterNegative, afterZero };
}

// applyDamage can still kill (this is what a lethal fall calls).
{
  const a = new Armor(30, 10);
  a.applyDamage(15);
  out.applyDamageLethal = { hp: a.hitPoints, destroyed: a.destroyed };
}

// The spawn (HP-3, HP-17): setMaxHitPoints' 128 ceiling first, then
// setHitPoints, which raises the max to the starting value. An Elco80's
// 500/500 and DC's AC-130's 2000/2000 come through whole.
{
  const elco = new Armor(500, 500);
  const ac130 = new Armor(2000);
  out.spawnAboveCeiling = {
    elco: { max: elco.maxHitPoints, hp: elco.hitPoints, destroyed: elco.destroyed },
    ac130: { max: ac130.maxHitPoints, hp: ac130.hitPoints, destroyed: ac130.destroyed },
  };
  // Damage and heal work against the raised max.
  ac130.damage(700);
  const afterDamage = ac130.hitPoints;
  const gained = ac130.heal(5000);
  out.raisedMaxHeals = { afterDamage, gained, hp: ac130.hitPoints, max: ac130.maxHitPoints };
  // A pad respawn restores the raised max.
  ac130.damage(10000);
  ac130.reset();
  out.raisedMaxReset = { hp: ac130.hitPoints, max: ac130.maxHitPoints, destroyed: ac130.destroyed };
}

// Where the ceiling still bites: a start below an over-128 max (FHSW's
// BrokenTiger, 40 of 155) spawns under a 128 max.
{
  const a = new Armor(155, 40);
  out.ceilingBelowStart = { max: a.maxHitPoints, hp: a.hitPoints };
}

// A start above a max under the ceiling raises the max (DC's Forklift, 80
// hit points over a max of 50).
{
  const a = new Armor(50, 80);
  out.startAboveMax = { max: a.maxHitPoints, hp: a.hitPoints };
}

// The two setters on their own.
{
  const a = new Armor(30);
  a.setMaxHitPoints(600);
  const afterSetMax = { max: a.maxHitPoints, hp: a.hitPoints };
  a.setHitPoints(600);
  const afterSetHp = { max: a.maxHitPoints, hp: a.hitPoints };
  a.setHitPoints(20);
  const afterLower = { max: a.maxHitPoints, hp: a.hitPoints };
  a.setHitPoints(0.0005);
  const afterEpsilon = { hp: a.hitPoints, destroyed: a.destroyed };
  a.setHitPoints(50);
  const afterDeath = { hp: a.hitPoints, destroyed: a.destroyed };
  out.setters = { afterSetMax, afterSetHp, afterLower, afterEpsilon, afterDeath };
}

// A starting value at or below the epsilon spawns dead, at exactly 0.
{
  const a = new Armor(30, 0.0005);
  out.spawnDead = { hp: a.hitPoints, destroyed: a.destroyed };
}

// The template words: rounded up, and 10 when never authored.
out.templateWords = {
  authored: templateHitPoints(2000),
  fraction: templateHitPoints(12.2),
  missing: templateHitPoints(undefined),
  nullish: templateHitPoints(null),
};

process.stdout.write(JSON.stringify(out, null, 2));
