// What a collision costs, in hit points — for a vehicle against another
// vehicle, against a soldier it runs over, and against the ground or the sea.
//
// This is `SimpleObject::handleCollision` / `GameServer::handleCollision` /
// `handleCollisionObjectVsObject` / `handleCollisionLandOrWater`, written up
// in full in `features/bf1942-engine-reference/subsystems/collision-response.md`
// section 9 (call it "the spec"; section numbers below are its). The two
// verification passes that pinned the exact arithmetic are
// `features/vehicle-collision-physics/reports/V0-verification-of-L0.md`
// (C6-C10: the rate limiter, the object-vs-object product, the soldier
// branch's *real* roles) and `.../V4-verification-of-R4.md` (1.4, 3, 6: the
// material-table fallback rules and the worked numbers this file's tests
// assert). Nothing here is invented — every branch traces to one of those.
//
// **This contradicts `vehicle-damage.js`'s own header**, which states "a
// collision never costs hit points" and "do not add a crash-damage path — the
// engine has none" (citing HP-6). That finding was reversed by the round
// that produced this spec (section 9's own opening line says so); this
// module is the crash-damage path `vehicle-damage.js` says doesn't exist.
// Nothing in that file was touched to fix its docstring — see this track's
// final report.
//
// Three formulas share one shape — `angleFactor · speedMod · V² ·
// getDamageMod(matAttacker, matVictim) · getDamageForMaterial(matAttacker)`,
// gated at `> 1.0` — and diverge in exactly three ways: whether an attacker
// damage modifier multiplies in (never for a soldier victim, §9.3), whether
// the angle term is the `angleMod`-lerped `sin` or a bare `c²`/`c³` power law
// (object-vs-object uses the former, land/water uses the latter, §9.5), and
// whether the `> 1.0` gate applies at all (never for water, §9.5).
//
// **Mass never appears.** A Willy and a Sherman hitting the same plane at the
// same speed do the same damage (§9.3) — this file does not take a mass
// parameter anywhere.
//
// Framework-free like `armor.js`, `vehicle-damage.js` and `fall-damage.js` —
// no three.js, no DOM — so `tests/crash_damage_harness.mjs` runs it under
// plain node. No per-tick allocation: `CollisionList`'s two arrays are
// preallocated once in its constructor and never grow.

// --- constants ---------------------------------------------------------- //

/** `matOther == 99`: the kill material, §9.1. `giveDamage(self, 1e10, ...)`. */
export const KILL_MATERIAL = 99;

/**
 * `matSelf == 37 || matOther == 37`, §9.1: "no damage dispatch at all" —
 * physical response only, and (per V0's C7/C6 read of the instruction order)
 * before the rate-limiter's `isInColList`/`addColObject`, so a 37 contact
 * touches the victim's `CollisionList` not at all, not even to record it.
 */
export const NO_DAMAGE_MATERIAL = 37;

/** `MaterialManager`'s water id. Squares `c` instead of cubing it, §9.5. */
export const WATER_MATERIAL = 1;

/** The `> 1.0` delivery gate common to every branch but water, §9.3/§9.5. */
export const DAMAGE_THRESHOLD = 1.0;

/**
 * The 8 m/s allowance every soldier-collision branch subtracts before
 * anything else, §9.3/§9.5. Below it: no damage, from any material.
 */
export const SOLDIER_SPEED_FLOOR = 8;

/** What the kill material deals. Deliberately not "Infinity": the engine's
 *  own literal (`0x501502f9` decodes to exactly `1e10`), and a finite number
 *  survives being fed into ordinary HP arithmetic downstream. */
export const KILL_DAMAGE = 1e10;

/** `Armor::addColObject`'s ring size, §9.2. At most 15 entries stay live —
 *  see `CollisionList` for why the 16th slot never holds one. */
export const COLLISION_LIST_SIZE = 16;

/** An entry's lifetime once added, §9.2 (`fld1`, a literal, not a memory
 *  constant — so it is exactly 1.0, not a tunable). */
export const COLLISION_LIST_LIFETIME = 1.0;

// --- material tables, §9.4 ------------------------------------------------
//
// `tables.materials[id] = {attGroup, defGroup, damage, friction, elasticity?,
// resistance?}`, `tables.modifiers[attGroup][defGroup] = number`. Every
// lookup below tries the numeric key first and the string form second,
// because a table that came in over JSON may carry either.

function lookupMaterial(tables, id) {
  const materials = tables?.materials;
  if (!materials) return undefined;
  if (id !== undefined && id !== null) {
    const direct = materials[id] ?? materials[String(id)];
    if (direct) return direct;
  }
  return materials[0] ?? materials['0'];
}

/**
 * The material record for `id`, or material 0's when `id` is `undefined`/
 * `null` or simply not in the table (§9.4: "an undefined material id falls
 * back to material 0"). `id` itself being absent (no vertex/face material at
 * all) is the same case as an id nothing ever defined.
 */
export function materialOf(tables, id) {
  return lookupMaterial(tables, id);
}

/**
 * `getDamageMod(matAttacker, matVictim)`, keyed by the attacker material's
 * `attGroup` and the victim material's `defGroup` (V4 1.4: group, not id — the
 * two differ only for materials 120/166, irrelevant to vehicles). A missing
 * cell is **0.0**, not a fallback to some default modifier: `defaultDamageMod`
 * is a dead field no console word can reach (V4 1.4), so "untabulated" really
 * does mean zero damage, every time, not "unauthored".
 */
export function damageModifier(tables, matAttacker, matVictim) {
  const modifiers = tables?.modifiers;
  if (!modifiers) return 0.0;
  const att = lookupMaterial(tables, matAttacker);
  const vic = lookupMaterial(tables, matVictim);
  const attGroup = att ? att.attGroup : matAttacker;
  const defGroup = vic ? vic.defGroup : matVictim;
  const row = modifiers[attGroup] ?? modifiers[String(attGroup)];
  if (!row) return 0.0;
  const cell = row[defGroup] ?? row[String(defGroup)];
  return cell == null ? 0.0 : cell;
}

/**
 * `getDamageForMaterial(id)` — `materialDamage`, 1.0 for every armour
 * material and 30.0 for every terrain material in vanilla (§9.4). Falls back
 * through `materialOf`'s id -> material-0 chain.
 */
export function materialDamage(tables, id) {
  const mat = lookupMaterial(tables, id);
  return mat ? (mat.damage ?? 0.0) : 0.0;
}

/**
 * The effect bundle `damage.json` names for an attacker material meeting a
 * victim material, or null when the cell is unauthored.
 *
 * The standalone form of `CrashDamage._effectCell`'s group resolution plus
 * the table read: attacker id to `attGroup`, victim id to `defGroup` (group,
 * not id — `damageModifier`'s own rule), then
 * `effects[attGroup][defGroup]`. Numeric and string keys both read, because a
 * table that came in over JSON may carry either. Case is deliberately NOT
 * resolved here: `EffectLibrary.get` lowercases every lookup, so the table's
 * `e_Collision_ship` and the library's `e_collision_ship` are one bundle
 * (assemble.py's `(n.lower(), n)` bake tie-break).
 */
export function effectNameFor(tables, matAttacker, matVictim) {
  const att = materialOf(tables, matAttacker);
  const vic = materialOf(tables, matVictim);
  const attGroup = att ? att.attGroup : matAttacker;
  const defGroup = vic ? vic.defGroup : matVictim;
  const row = tables?.effects?.[attGroup] ?? tables?.effects?.[String(attGroup)];
  if (!row) return null;
  return row[defGroup] ?? row[String(defGroup)] ?? null;
}

/** A defined material's own field, or the `Material::Material()` ctor
 *  default (friction 1.0, elasticity 0.0, resistance 0.01 — V4 1.4 "O4
 *  closed") for a defined material that never authored it. */
function definedField(mat, field, ctorDefault) {
  const v = mat[field];
  return v == null ? ctorDefault : v;
}

/**
 * `{friction, elasticity, resistance}` for a contact between `matA` and
 * `matB`: each scalar is `0.5 * (a + b)`, the per-field value of each side
 * coming from its own record when the id is defined (with the
 * `Material::Material()` ctor default — 1.0 / 0 / 0.01 — standing in for a
 * field that record never authored) and from **material 0's own value**
 * (by the same rule) when the id itself is not in the table at all.
 *
 * This is exactly what `body-contact.js`'s `handlers.materialValues` is
 * wired to (briefing, "Shared interfaces").
 */
export function contactMaterialValues(tables, matA, matB) {
  const a = lookupMaterial(tables, matA) ?? {};
  const b = lookupMaterial(tables, matB) ?? {};
  return {
    friction: 0.5 * (definedField(a, 'friction', 1.0) + definedField(b, 'friction', 1.0)),
    elasticity: 0.5 * (definedField(a, 'elasticity', 0.0) + definedField(b, 'elasticity', 0.0)),
    resistance: 0.5 * (definedField(a, 'resistance', 0.01) + definedField(b, 'resistance', 0.01)),
  };
}

// --- the shared geometry term --------------------------------------------- //

function dot3(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function length3(a) { return Math.sqrt(dot3(a, a)); }

/**
 * `c = |unit(speed) . unit(normal)|`: how square-on the contact is, 0 for a
 * graze, 1 for a head-on hit. `speed` is the relative contact velocity of
 * §6.2, a 3-vector; a zero-length `speed` or `normal` reads as a graze (0)
 * rather than dividing by zero.
 */
function contactCosine(speed, normal) {
  const v = length3(speed);
  const n = length3(normal);
  if (!(v > 0) || !(n > 0)) return 0;
  return Math.abs(dot3(speed, normal) / (v * n));
}

/**
 * `angleMod + (1 - angleMod) * sin(min(c * PI/2, 1000))`, §9.3/C8. The 1000
 * clamp is the engine's own (`clamp(c*pi/2, -1000, +1000)`, C8) — `c` is
 * already `|...|` so only the upper bound can ever bind, and never does for
 * a real contact, but it is here because the engine's is.
 *
 * `angleMod 1` (aircraft) makes this always 1: a glancing scrape costs as
 * much as a head-on hit. `angleMod 0` (ground vehicles) makes it `sin(c*pi/2)`,
 * which is why a shallow graze costs a tank almost nothing.
 */
export function angleFactor(c, angleMod) {
  return angleMod + (1 - angleMod) * Math.sin(Math.min(c * Math.PI / 2, 1000));
}

// --- §9.3: object against object ------------------------------------------ //

/**
 * The non-soldier branch of §9.3. Both objects in a contact are victims of
 * it, each through its own call with its own `victimSpeedMod`/`victimAngleMod`
 * and the *other's* material as `matAttacker` — call this twice, once per
 * side, the way `SimpleObject::handleCollision` runs it twice (mass never
 * appears, deliberately: a Willy and a Sherman hitting the same plane at the
 * same speed do the same damage).
 *
 * Returns the damage, or 0 when it does not exceed the 1.0 threshold — the
 * gate is inside this function, not left to the caller, because the raw
 * product below it is not itself a meaningful "damage that didn't land"
 * value (§9.6's threshold table is exactly this boundary).
 */
export function objectCollisionDamage({
  speed, normal, attackerDamageMod = 1, victimSpeedMod, victimAngleMod,
  matAttacker, matVictim,
}, tables) {
  const V = length3(speed);
  const c = contactCosine(speed, normal);
  const af = angleFactor(c, victimAngleMod);
  const damage = attackerDamageMod * af * victimSpeedMod * V * V
    * damageModifier(tables, matAttacker, matVictim)
    * materialDamage(tables, matAttacker);
  return damage > DAMAGE_THRESHOLD ? damage : 0;
}

/**
 * The soldier-victim branch of §9.3 (a vehicle running someone over), C8's
 * corrected form — L0's draft had the 8 m/s allowance on the wrong side.
 *
 * `attackerSpeedAlong`/`victimSpeedAlong` are each body's own positional
 * speed projected onto the contact direction (signed magnitudes; this
 * function takes their absolute values itself) — the caller supplies them
 * because computing "positional speed along a direction" needs the body's
 * own velocity state, which this framework-free module never holds.
 * `fallHeight` is `lastCollisionHeight - y` (`F`, the same quantity
 * `fall-damage.js` calls `fallHeight`) — `h = fallHeight - 1` inside.
 *
 * No `attackerDamageMod` anywhere in the product — C8 confirmed the soldier
 * branch skips it (`flds -0x1e4`, not `-0x1f0`): a heavy tank does not hit a
 * soldier any harder than a jeep does at the same speed, either.
 */
export function soldierCollisionDamage({
  speed, normal, victimSpeedMod, victimAngleMod, matAttacker, matVictim,
  attackerSpeedAlong = 0, victimSpeedAlong = 0, fallHeight = 0, kitDamping = 1,
}, tables) {
  const rawSpeed = length3(speed);
  if (rawSpeed < SOLDIER_SPEED_FLOOR) return 0;

  const Vp = Math.abs(attackerSpeedAlong)
    + Math.max(Math.abs(victimSpeedAlong) - SOLDIER_SPEED_FLOOR, 0);

  const c = contactCosine(speed, normal);
  let af = angleFactor(c, victimAngleMod);

  const h = fallHeight - 1;
  if (h >= 1) af = h >= 2 ? 1 : af + (1 - af) * (h - 1);
  const hPrime = h >= 1 ? h : 1;
  const k = Math.max(hPrime * kitDamping, 1);

  if (Vp > 30) af = 1;
  else if (Vp > 10) af = af + (1 - af) * (Vp - 10) / 20;

  const damage = af * victimSpeedMod * Vp * Vp
    * damageModifier(tables, matAttacker, matVictim)
    * materialDamage(tables, matAttacker)
    * k * k;
  return damage > DAMAGE_THRESHOLD ? damage : 0;
}

// --- §9.5: against the ground, and water ----------------------------------- //

/**
 * `handleCollisionLandOrWater`, §9.5. Land cubes `c`, gates at `> 1.0`.
 * Water (`matTerrain === WATER_MATERIAL`) squares `c` instead, applies only
 * when `damageFromWater` is set, and has **no** `> 1.0` gate at all (a
 * damage-from-water hull takes whatever the product comes to, however
 * small) — passing `damageFromWater: false` against water returns 0 outright
 * rather than computing and discarding a value, matching the engine not
 * reaching the arithmetic when `armor->getDamageFromWater()` is false.
 *
 * `soldier`, when given, is `{ fallHeight, kitDamping = 1 }` and switches to
 * the soldier variant: `V -= 8` first (0 below the floor — the engine's own
 * "return if 0 > V-8" leaves `V === 8` in, not out), then the same h/k/af
 * lerps `soldierCollisionDamage` uses, except the angle term **starts from
 * `|c|^2`/`|c|^3`**, not `angleFactor` — §9.5 never mentions `angleMod` for a
 * ground contact, only "the h/k/af terms of §9.3" layered on top of the c
 * power law already in play. This is exactly `fall-damage.js`'s own formula
 * (its `A = |cosTheta|^(inWater?2:3)` with the same two lerps) — this
 * function reaches the same numbers for a soldier through a different call
 * shape (ids + a table lookup instead of precomputed scalars), not a
 * different formula; the duplication is deliberate rather than an oversight
 * (see this track's report for why they were not merged).
 */
export function terrainCollisionDamage({
  speed, normal, victimSpeedMod, matTerrain, matSelf,
  damageFromWater = false, soldier = null,
}, tables) {
  const isWater = matTerrain === WATER_MATERIAL;
  if (isWater && !damageFromWater) return 0;

  const c = contactCosine(speed, normal);
  const dm = damageModifier(tables, matTerrain, matSelf);
  const md = materialDamage(tables, matTerrain);
  const exponent = isWater ? 2 : 3;

  if (soldier) {
    const v = length3(speed) - SOLDIER_SPEED_FLOOR;
    if (v < 0) return 0;

    let af = Math.abs(c) ** exponent;
    const h = (soldier.fallHeight ?? 0) - 1;
    if (h >= 1) af = h >= 2 ? 1 : af + (1 - af) * (h - 1);
    const hPrime = h >= 1 ? h : 1;
    const kitDamping = soldier.kitDamping ?? 1;
    const k = Math.max(hPrime * kitDamping, 1);

    if (v > 30) af = 1;
    else if (v > 10) af = af + (1 - af) * (v - 10) / 20;

    const damage = victimSpeedMod * v * v * dm * md * k * k * af;
    return isWater ? damage : (damage > DAMAGE_THRESHOLD ? damage : 0);
  }

  const V = length3(speed);
  const damage = (Math.abs(c) ** exponent) * victimSpeedMod * V * V * dm * md;
  return isWater ? damage : (damage > DAMAGE_THRESHOLD ? damage : 0);
}

// --- §9.1: the dispatch gates ---------------------------------------------- //

/**
 * `'kill'` when the other side's material is 99 (§9.1: `matOther == 99`,
 * checked on `matOther` alone — a body carrying 99 on *its own* side is not
 * itself a kill), `'none'` when either side is 37 (no damage dispatch at
 * all), otherwise `'normal'`.
 */
export function classifyContact(matSelf, matOther) {
  if (matOther === KILL_MATERIAL) return 'kill';
  if (matSelf === NO_DAMAGE_MATERIAL || matOther === NO_DAMAGE_MATERIAL) return 'none';
  return 'normal';
}

// --- §9.2: the rate limiter ------------------------------------------------- //

/**
 * `Armor::addColObject`/`isInColList`/`Armor::update` (§9.2, C7): a 16-slot
 * ring of `{key, timer}`. A new entry's timer is `max(0, 1.0 - sum of every
 * queued timer)` — so a `CollisionList` that already totals 1.0 s or more of
 * queued expiry hands the new entry a timer of exactly 0, expiring it on the
 * very next `update`. Inserting past 16 immediately evicts the oldest (C7:
 * `tail = (tail+1)&15; if (tail == head) head++`), so **at most 15 entries
 * are ever live at once** — this is the engine's own arithmetic, not a
 * simplification of it.
 *
 * `key` is compared with `===`; `null` is the terrain's own entry, sharing
 * the same 16 slots as every object contact (§9.2: "or from the terrain,
 * which is the entry NULL").
 */
export class CollisionList {
  constructor() {
    this.keys = new Array(COLLISION_LIST_SIZE);
    this.timers = new Float64Array(COLLISION_LIST_SIZE);
    this.head = 0;
    this.tail = 0;
  }

  /** True exactly when the ring holds no live entries. */
  get isEmpty() { return this.head === this.tail; }

  has(key) {
    if (this.isEmpty) return false;
    for (let i = this.head; i !== this.tail; i = (i + 1) & (COLLISION_LIST_SIZE - 1)) {
      if (this.keys[i] === key) return true;
    }
    return false;
  }

  /**
   * Insert `key`. Its timer is `max(0, 1.0 - sum of the queued timers)`;
   * when the ring would grow past 16 live slots the oldest is dropped in the
   * same step, exactly as `addColObject` does.
   */
  add(key) {
    let sum = 0;
    if (!this.isEmpty) {
      for (let i = this.head; i !== this.tail; i = (i + 1) & (COLLISION_LIST_SIZE - 1)) {
        sum += this.timers[i];
      }
    }
    const timer = Math.max(0, COLLISION_LIST_LIFETIME - sum);
    this.keys[this.tail] = key;
    this.timers[this.tail] = timer;
    this.tail = (this.tail + 1) & (COLLISION_LIST_SIZE - 1);
    if (this.tail === this.head) {
      this.keys[this.head] = undefined;
      this.head = (this.head + 1) & (COLLISION_LIST_SIZE - 1);
    }
  }

  /**
   * `Armor::update(dt)`: age the head down by `dt`; while it has gone
   * negative, pop it and carry the overflow into the new head (C7: every
   * path through `update` reaches this block, so this runs unconditionally,
   * even on an empty list where it is simply a no-op).
   */
  update(dt) {
    if (this.isEmpty) return;
    this.timers[this.head] -= dt;
    while (!this.isEmpty && this.timers[this.head] < 0) {
      const remainder = -this.timers[this.head];
      this.keys[this.head] = undefined;
      this.head = (this.head + 1) & (COLLISION_LIST_SIZE - 1);
      if (this.isEmpty) break;
      this.timers[this.head] -= remainder;
    }
  }

  /** Pad respawn, or a fresh spawn: no history of who has already hit this. */
  clear() {
    this.keys.fill(undefined);
    this.head = 0;
    this.tail = 0;
  }
}

// --- the glue ---------------------------------------------------------------- //

/**
 * The per-owner bookkeeping `CrashDamage` needs: its `CollisionList`, the
 * Armor scalars a `.con` would author, and whether it is a soldier (routes
 * through `soldierCollisionDamage`/the terrain soldier variant instead of
 * the plain object/land formula).
 */
class RegisteredOwner {
  constructor({ speedMod, angleMod, damageMod, damageFromWater, soldier }) {
    this.list = new CollisionList();
    this.speedMod = speedMod;
    this.angleMod = angleMod;
    this.damageMod = damageMod;
    this.damageFromWater = damageFromWater;
    this.soldier = soldier;
  }
}

/**
 * The glue between a scene's contact events and the formulas above:
 * `SimpleObjectTemplate`'s three authored scalars per owner, one
 * `CollisionList` per owner (§9.2), and the §9.1 dispatch order — 99 kills
 * outright, 37 does nothing and touches no list, otherwise the rate limiter
 * gates the call and the entry is added regardless of the damage it produces.
 *
 * This never touches an owner's hit points itself — the caller feeds
 * `damage` into the existing `VehicleDamageSet` (`vehicle-damage.js`), the
 * way `giveDamage` hands off to `Armor::damage` downstream of everything
 * here (§9.7).
 */
export class CrashDamage {
  constructor(tables) {
    this.tables = tables;
    this.owners = new Map();
  }

  /**
   * `defaults` are the engine's own (§3 of the briefing, `Armor`/
   * `SimpleObjectTemplate`'s constructors, V4 1.1): `speedMod` 0.05,
   * `angleMod` 0, `damageMod` 1 — a `.con` that authors nothing gets exactly
   * these, not zero.
   */
  register(owner, {
    speedMod = 0.05, angleMod = 0, damageMod = 1,
    damageFromWater = false, soldier = false,
  } = {}) {
    this.owners.set(owner,
      new RegisteredOwner({ speedMod, angleMod, damageMod, damageFromWater, soldier }));
  }

  /** One tick: age every registered owner's `CollisionList`. */
  update(dt) {
    for (const entry of this.owners.values()) entry.list.update(dt);
  }

  /**
   * `victimOwner` was hit by `attackerOwner`. `matVictim`/`matAttacker` are
   * the two contact materials (§9.4: the moving side's vertex, the struck
   * side's face). `extra` carries what the soldier branch needs and nothing
   * else can supply: `attackerSpeedAlong`, `victimSpeedAlong`, `fallHeight`,
   * `kitDamping`.
   *
   * Returns `null` when `victimOwner` is not registered, the contact is a
   * rate-limited repeat, or either material is 37. An unregistered
   * `attackerOwner` contributes `damageMod` 1.0 (the engine's own default —
   * a body this module never saw a `register()` call for is exactly a body
   * that authored nothing).
   */
  onObjectContact(victimOwner, attackerOwner, speed, normal, matVictim, matAttacker, extra = {}) {
    const victim = this.owners.get(victimOwner);
    if (!victim) return null;

    if (matAttacker === KILL_MATERIAL) {
      return { damage: KILL_DAMAGE, kill: true, effectCell: null };
    }
    if (matVictim === NO_DAMAGE_MATERIAL || matAttacker === NO_DAMAGE_MATERIAL) {
      return null;
    }
    if (victim.list.has(attackerOwner)) return null;
    victim.list.add(attackerOwner);

    const attacker = this.owners.get(attackerOwner);
    const attackerDamageMod = attacker ? attacker.damageMod : 1.0;

    const damage = victim.soldier
      ? soldierCollisionDamage({
        speed, normal,
        victimSpeedMod: victim.speedMod,
        victimAngleMod: victim.angleMod,
        matAttacker, matVictim,
        attackerSpeedAlong: extra.attackerSpeedAlong ?? 0,
        victimSpeedAlong: extra.victimSpeedAlong ?? 0,
        fallHeight: extra.fallHeight ?? 0,
        kitDamping: extra.kitDamping ?? 1,
      }, this.tables)
      : objectCollisionDamage({
        speed, normal, attackerDamageMod,
        victimSpeedMod: victim.speedMod,
        victimAngleMod: victim.angleMod,
        matAttacker, matVictim,
      }, this.tables);

    return { damage, kill: false, effectCell: this._effectCell(matAttacker, matVictim) };
  }

  /**
   * `victimOwner` hit the ground or the sea. `matSelf` is the victim's own
   * contact material, `matTerrain` the terrain's. `extra` carries
   * `fallHeight`/`kitDamping` for the soldier variant. Same null cases as
   * `onObjectContact`, keyed by `null` — the terrain's own slot in the
   * victim's `CollisionList`, shared with every object contact (§9.2).
   */
  onTerrainContact(victimOwner, speed, normal, matSelf, matTerrain, extra = {}) {
    const victim = this.owners.get(victimOwner);
    if (!victim) return null;

    if (matTerrain === KILL_MATERIAL) {
      return { damage: KILL_DAMAGE, kill: true, effectCell: null };
    }
    if (matSelf === NO_DAMAGE_MATERIAL || matTerrain === NO_DAMAGE_MATERIAL) {
      return null;
    }
    if (victim.list.has(null)) return null;
    victim.list.add(null);

    const damage = terrainCollisionDamage({
      speed, normal,
      victimSpeedMod: victim.speedMod,
      matTerrain, matSelf,
      damageFromWater: victim.damageFromWater,
      soldier: victim.soldier
        ? { fallHeight: extra.fallHeight ?? 0, kitDamping: extra.kitDamping ?? 1 }
        : null,
    }, this.tables);

    return { damage, kill: false, water: matTerrain === WATER_MATERIAL,
             effectCell: this._effectCell(matTerrain, matSelf) };
  }

  _effectCell(matAttacker, matVictim) {
    const att = materialOf(this.tables, matAttacker);
    const vic = materialOf(this.tables, matVictim);
    return [att ? att.attGroup : matAttacker, vic ? vic.defGroup : matVictim];
  }
}
