// The soldier's two packs, the medic bag and the wrench, as one law over plain
// positions: `BFSoldier::useMedPack` (lnxded 0x082768d0) and
// `BFSoldier::useRepairPack` (0x08276100). One copy, run by the human's pack
// on the page (`hand-fire.js`), by a bot's (`bot-referee.js`) and by the room
// server for every player in a room (`server/room-packs.mjs`), so a medic heals
// the same whoever holds the bag and wherever the round is priced.
//
// Free of three and of the DOM: a holder, a soldier and a hull are `{x, y, z}`
// with an Armor (`hitPoints`, `maxHitPoints`, `destroyed`); the caller applies
// what the law hands back.
//
// The packs are the templates NAMED `MedPack` and `RepairPack` (ledger SUP-27):
// `BFSoldierTemplate::init` keeps their ids at +0x2ac / +0x2b0, and
// `BFSoldier::handleMessage`'s Fire branch runs `useMedPack` / `useRepairPack`
// only on a match. A weapon whose AI entry says `healing 1` and is neither
// (BF1918's whistles, `BottleHeal`) throws its round like any other.

import { soldierTemplateValue } from './soldier-death.js';

/** `BFSoldier::useMedPack`'s numbers as vanilla `CommonSoldierData.inc` sets
 *  them (SUP-15): the sweep's reach `healDistance` (+0x2f4), the HP each
 *  soldier in it takes per invocation `healFactor` (+0x2d8), and what the
 *  holder takes `selfHealFactor` (+0x2dc). One invocation per round, at the
 *  MedPack's `roundOfFire` 10/s: 2.5 HP/s to everyone wounded in reach and
 *  1.5 HP/s to the medic. The stand-ins for a tree whose `gaits.json` predates
 *  the fields. */
export const MEDIC_PACK = Object.freeze({ radius: 10.0, allyHeal: 0.25, selfHeal: 0.15 });

/** `BFSoldier::useRepairPack`'s: the reach past a hull's radius
 *  `repairDistance` (+0x2ec) and the HP per invocation `repairFactor` (+0x2e0),
 *  vanilla's 2.0 / 0.15 (Desert Combat's factor is 0.20). `disarmRadius` is
 *  `disarmMinesDistance` (+0x2f0, ctor default 2.0 at `0x0827a39a`), the
 *  crouched branch's reach, which disarms; nothing here disarms yet. */
export const REPAIR_PACK = Object.freeze({ radius: 2.0, repairHeal: 0.15, disarmRadius: 2.0 });

/**
 * Which of the soldier's two packs a hand weapon is: `'medic'` for the
 * template named `MedPack`, `'repair'` for `RepairPack`, null for anything
 * else (SUP-27). Compared without case, as the template manager resolves names
 * (INFERRED: the lookup's case rule was not read).
 */
export function healingPackKind(name) {
  const key = String(name ?? '').toLowerCase();
  if (key === 'medpack') return 'medic';
  if (key === 'repairpack') return 'repair';
  return null;
}

/** The pack's use numbers for a holder wearing soldier `template`, off the
 *  tree's `gaits.json` `soldierBody` (`soldierTemplateValue`), each falling
 *  back to vanilla's. `kind` is `healingPackKind`'s; null for anything else. */
export function packParams(kind, soldierBody = null, template = null) {
  const value = (key, fallback) => {
    const v = soldierTemplateValue(soldierBody, template, key);
    return Number.isFinite(v) ? v : fallback;
  };
  if (kind === 'medic') {
    return {
      kind: 'medic',
      radius: value('healDistance', MEDIC_PACK.radius),
      allyHeal: value('healFactor', MEDIC_PACK.allyHeal),
      selfHeal: value('selfHealFactor', MEDIC_PACK.selfHeal),
    };
  }
  if (kind === 'repair') {
    return {
      kind: 'repair',
      radius: value('repairDistance', REPAIR_PACK.radius),
      repairHeal: value('repairFactor', REPAIR_PACK.repairHeal),
      disarmRadius: value('disarmMinesDistance', REPAIR_PACK.disarmRadius),
    };
  }
  return null;
}

const wounded = armor => !!armor && !armor.destroyed && armor.hitPoints < armor.maxHitPoints;

/**
 * One round of the medic bag, `useMedPack` 0x082768d0: what it heals, as
 * `[{ id, armor, amount }]`, the holder last. The caller applies each with
 * `armor.heal(amount)`.
 *
 * The sweep takes every soldier object within `healDistance` of the holder
 * (the `objectManager` vt+0x30 query at `0x08276949`, each candidate gated on
 * the soldier template class at `0x0827697b`, `distanceSqr <= healDistance²`
 * at `0x08276bd0`, then `isDestroyed` and hit points against the max at
 * `0x08276c1a` / `0x08276c45`) and heals each by `healFactor` through
 * `Armor::heal` (`0x08276c6f`). There is no team test anywhere in the
 * function (no read of the soldier's team, +0x53c): a wounded enemy in reach
 * is healed exactly like a friend. The holder is skipped in the sweep
 * (`0x08276962`) and healed after it by `selfHealFactor` (`0x082769f6`), when
 * wounded.
 *
 * `holder`: `{ id, x, y, z, armor }`. `soldiers`: an iterable of the same
 * shape, the holder may be among them. `pack`: `packParams('medic', ...)`.
 */
export function medPackHeals(holder, soldiers, pack) {
  const out = [];
  if (!holder || !pack) return out;
  const r2 = pack.radius * pack.radius;
  for (const s of soldiers ?? []) {
    if (!s || s.id === holder.id || !wounded(s.armor)) continue;
    const dx = s.x - holder.x, dy = s.y - holder.y, dz = s.z - holder.z;
    if (dx * dx + dy * dy + dz * dz <= r2) out.push({ id: s.id, armor: s.armor, amount: pack.allyHeal });
  }
  if (wounded(holder.armor)) out.push({ id: holder.id, armor: holder.armor, amount: pack.selfHeal });
  return out;
}

/**
 * One round of the wrench, `useRepairPack` 0x08276100: the hull it repairs,
 * or null. The caller heals it by `pack.repairHeal`.
 *
 * - **Crouched, nothing is repaired.** The function reads `getPose() == 1`
 *   (crouch, DIE-1) into a flag at `0x0827612d`..`0x08276139`; inside the
 *   loop a crouched holder takes the disarm branch (`0x082764ed`), which keeps
 *   only `ExpPackProjectile` / `LandmineProjectile` rounds (the templates at
 *   +0x2a0 / +0x2b4), and the best-hull local (-0x74) is written only in the
 *   standing branch, so the repair after the loop (`0x082761d6`) has nothing.
 *   (The disarm itself is not built.)
 * - **A hull held by the other side is skipped.** The candidate's Armor
 *   (interface 0xc4a4) must sit in a PlayerControlObject (the parent walk for
 *   interface 0xc4c5 at `0x082766d0`..`0x0827670f`; none found, skipped), and
 *   that object's team (vt+0x74) is compared with the soldier's +0x53c
 *   (`0x08276731`): set and different, skipped. An empty hull (team 0) is
 *   anyone's.
 * - **The closest wounded, undestroyed one in reach**, the reach
 *   `distanceSqr <= (getBoundingRadius() + repairDistance)²` to the object's
 *   origin (`0x08276762`..`0x0827678a`), the closest kept after the loop
 *   (`0x082767e6`..`0x08276841`).
 *
 * `holder`: `{ x, y, z, team, crouched }`. `hulls`: an iterable of
 * `{ x, y, z, radius, armor, team, pco }` (`pco` false: an object with an
 * Armor in no PlayerControlObject; absent counts as one). Returns the hull.
 */
export function repairPackTarget(holder, hulls, pack) {
  if (!holder || !pack || holder.crouched) return null;
  let best = null;
  let bestDist = Infinity;
  for (const h of hulls ?? []) {
    if (!h || h.pco === false || !wounded(h.armor)) continue;
    if (h.team && holder.team && h.team !== holder.team) continue;
    const dx = h.x - holder.x, dy = h.y - holder.y, dz = h.z - holder.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist > (h.radius ?? 0) + pack.radius) continue;
    if (dist < bestDist) { bestDist = dist; best = h; }
  }
  return best;
}

/**
 * The hulls a World holds, as `repairPackTarget` takes them: every
 * DamageableVehicle the world registered at its body's pose, its radius the
 * body's `boundingRadius` (`radiusOf(owner)` first, when the caller has a
 * better one), its team `teamOf(owner)`, else its crew's side off the world's
 * players (0 empty). `skip(owner)`: a hull the caller has taken out of the
 * world (a pad's hull not stood up).
 */
export function worldHulls(world, { teamOf = null, radiusOf = null, skip = null } = {}) {
  const out = [];
  if (!world?.vehicleDamage) return out;
  const crews = new Map();
  for (const player of world.players?.values?.() ?? []) {
    const root = player?.occupancy?.root;
    if (!root || !(player.team === 1 || player.team === 2)) continue;
    const owner = world.nodeOwners?.get?.(root);
    if (owner !== undefined && !crews.has(owner)) crews.set(owner, player.team);
  }
  for (const vehicle of world.vehicleDamage.values()) {
    const owner = vehicle.owner;
    if (vehicle.destroyed || world.isWrecked?.(owner) || skip?.(owner)) continue;
    const pose = world.vehiclePose?.(owner);
    if (!pose) continue;
    const radius = radiusOf?.(owner) ?? world.bodyWorld?.get?.(owner)?.spec?.boundingRadius ?? 0;
    out.push({
      // The DamageableVehicle itself: its `heal` keeps the damage tiers in step.
      owner, vehicle, armor: vehicle, pco: vehicle.isPco !== false,
      x: pose.x, y: pose.y, z: pose.z, radius,
      team: teamOf?.(owner) ?? crews.get(owner) ?? 0,
    });
  }
  return out;
}
