// The proximity fuse: why a flak shell bursts on the aircraft it meets.
//
// Read from `Projectile::handleUpdate` (lnxded 0x0831e940), the whole of
// which, bar a cosmetic body-scaling block, is this fuse (ledger PROX-1 to
// PROX-6, features/flak-proximity-fuse/README.md). Every update, once the
// round is older than its `ProximityFusePrimer`, it asks the object manager
// for everything within `explodeNearEnemyDistance` and detonates on the first
// object that passes. `Projectile::detonate` (0x0831e680) is the same call a
// spent `timeToLive` makes, so the burst is the end-of-life one: the
// `endEffectTemplate` and, for `damageType` 1 or 4, the splash.
//
// Vanilla authors it on the three flak shells (10 m), the landmine (3), the
// floating mine (3), the depth charge (50) and two naval rounds. Without it a
// flak shell only ever did two things: touch an aircraft's collision mesh
// (which a 300 m/s round rarely does, and which kills it silently with no
// burst, `diesOnContact`) or burst at the end of its `timeToLive`, in empty
// sky.
//
// This module is the law and nothing else; the page supplies the candidates
// (`guns.nearObjects`, `vehicle-hits.js`'s `proximityObjects`).

/** `ProjectileTemplate+0x168` off (ctor 0x0831f8d0 writes -1.0). */
const FUSE_OFF = -1;

/** `ProjectileTemplate+0x1a0`, `ProximityFusePrimer`: the ctor's -1.0, i.e.
 *  live from launch. */
export const DEFAULT_FUSE_PRIMER = -1;

/** A round's own mass when its template declares none: `SimpleObjectTemplate`
 *  +0x54, 1.0 in the ctor (0x081dbceb). The physics node reporting that same
 *  number through `getMass` is inferred, not read. */
export const DEFAULT_PROJECTILE_MASS = 1.0;

/** The target must be moving: `|v|^2 >= 6.25` (ds:0x086e1c58), 2.5 m/s. */
export const FUSE_MIN_SPEED_SQ = 6.25;

/** In air, nothing heavier than this sets it off (ds:0x086c089c). */
export const FUSE_MAX_MASS = 100000;

/** Under water, only this heavy or heavier does (ds:0x086e1c5c). */
export const FUSE_UNDERWATER_MIN_MASS = 50000;

/**
 * The fuse a round carries, or null when it has none.
 *
 * `entry` is the round's row in `damage.json`'s projectile table
 * (`extract_map.py`'s `projectile_materials`), which is where the fuse words
 * travel: they are not in the baked `fireArms.projectile` block. `spec` is
 * that block, whose `mass` wins when the table has none.
 */
export function proximityFuseOf(spec, entry) {
  const distance = Number(entry?.explodeNearEnemyDistance ?? FUSE_OFF);
  // The engine's own gate: `0 < +0x168` (0x0831ea4f-0x0831ea5c).
  if (!(distance > 0)) return null;
  const primer = Number(entry?.proximityFusePrimer);
  const mass = Number(entry?.mass ?? spec?.mass);
  return {
    distance,
    primer: Number.isFinite(primer) ? primer : DEFAULT_FUSE_PRIMER,
    mass: Number.isFinite(mass) && mass > 0 ? mass : DEFAULT_PROJECTILE_MASS,
  };
}

/**
 * Is the fuse live at this age?
 *
 * `primer < worldTime - launchTime` (0x0831ea62-0x0831ea7d), strictly, with
 * the launch time the one `Projectile::activate` (0x0831e120) stamps at
 * `+0x124`. The AA gun's 0.1 s keeps a shell from bursting on the aircraft
 * flying low over its own muzzle in the first 30 m.
 */
export function fuseArmed(fuse, age) {
  return !!fuse && age > fuse.primer;
}

/**
 * The first candidate that sets the fuse off, or null.
 *
 * `round` is `{ x, y, z, underWater }`. Each candidate is `{ x, y, z, mass,
 * vx, vy, vz }` at its transform origin (the engine reads the object's
 * position and its physics node's `getMass` / `getPositionalSpeed`), plus
 * `soldier: true` for a soldier.
 *
 * The two branches split on the round's own `getUnderWater` (0x0831ebaf):
 *
 *   in air     the target outweighs the round (0x0831ec65), weighs at most
 *              100,000 (0x0831ec72), its origin is within the distance
 *              (0x0831ed1f, squared), and it moves at 2.5 m/s or more
 *              (0x0831ed56);
 *   under water  the target weighs 50,000 or more (0x0831ebcc) and its
 *              height is within the distance (0x0831ec1c, `|dy|` only): a
 *              depth charge against the hull above it.
 *
 * What is NOT tested, and is easy to add by mistake:
 *
 *   - **team.** `explodeNearEnemyDistance` is a name, not a rule: the loop
 *     computes the firer's vehicle root (`getRootParent`, 0x0831ee3d) and
 *     throws it away, and no candidate is compared with any team. A friendly
 *     plane crossing the stream sets the shell off just the same.
 *   - **soldiers** are skipped outright (template class `CID_BFSoldierTemplate`
 *     0x9493, compared at 0x0831eb82), so flak never bursts on infantry and a
 *     landmine is never set off by a man walking over it.
 *   - **a parked vehicle** never sets off the air branch: it is not moving.
 */
export function fuseTarget(fuse, round, candidates) {
  if (!fuse || !candidates) return null;
  const d2 = fuse.distance * fuse.distance;
  for (const c of candidates) {
    if (!c || c.soldier) continue;
    const mass = Number.isFinite(c.mass) ? c.mass : DEFAULT_PROJECTILE_MASS;
    if (!round.underWater) {
      if (!(fuse.mass < mass) || mass > FUSE_MAX_MASS) continue;
      const dx = c.x - round.x, dy = c.y - round.y, dz = c.z - round.z;
      if (dx * dx + dy * dy + dz * dz > d2) continue;
      const v2 = (c.vx || 0) ** 2 + (c.vy || 0) ** 2 + (c.vz || 0) ** 2;
      if (v2 >= FUSE_MIN_SPEED_SQ) return c;
    } else {
      if (!(mass >= FUSE_UNDERWATER_MIN_MASS)) continue;
      if (Math.abs(round.y - c.y) <= fuse.distance) return c;
    }
  }
  return null;
}
