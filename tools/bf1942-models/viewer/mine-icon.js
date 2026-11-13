// The friendly-mine warning icon, `ShowMineIcon` (the HUD pack's `icon_mine`).
//
// Retail (gap audit 2026-11-12, entry 23). A round whose template says
// `addToProjectileList 1` is filed in the object manager's projectile map
// while it lives (`Projectile::activate` lnxded 0x0831e2f3; ProjectileTemplate
// byte +0x1d0). The client's `MenuMapNode::onPaint` (Mac 0x00556244) walks
// that map every paint. For each round whose template's `projectileType`
// (+0x1d4 on the server, constructor -1) is 1 and whose team is the local
// player's, with the local player alive and holding a control object:
//
//   - seated (the control object is not their soldier): the icon lights when
//     the round is within 30.0 m of the control object;
//   - on foot: only when the soldier is a BFSoldier (class 0x9493) and the
//     HUD's kit index is 4, the engineer (the same `+0x58` the medic and
//     engineer call sprites read as 3 and 4, HUD-25), and then within 15.0 m;
//   - on foot with any other kit: never.
//
// The compare is inclusive (`distance <= radius`), 3-D, from the control
// object's origin to the round's. The result is written to `GamePlay`'s
// `ShowMineIcon` (hudManager+0x48, +8) every paint, lit or not.
//
// Vanilla writes the two words on `LandmineProjectile` alone; Desert Combat
// adds `APLandmineProjectile`. The tree's `damage.json` projectile table
// carries the type (`extract_map.py` `projectile_materials`); a table baked
// before the word falls back to those two names.

/** `projectileType` of a round the icon counts. */
export const MINE_PROJECTILE_TYPE = 1;
/** Metres, on foot as an engineer (`MenuMapNode::onPaint`, 15.0). */
export const MINE_ICON_RADIUS_ENGINEER = 15;
/** Metres, seated in anything (`MenuMapNode::onPaint`, 30.0). */
export const MINE_ICON_RADIUS_SEATED = 30;
/** The deploy screen's kit index of the engineer (Scout 0 .. Engineer 4). */
export const ENGINEER_KIT = 4;

/** The rounds a table baked before `projectileType` still counts. */
const LEGACY_MINES = new Set(['landmineprojectile', 'aplandmineprojectile']);

/** A round template's `projectileType` from the tree's `damage.json`
 *  projectile table: the row's own, else 1 for the two shipped mines when
 *  the table predates the word (no row in it carries one), else -1, the
 *  constructor's. */
export function projectileTypeOf(template, table) {
  if (!template) return -1;
  const key = String(template).toLowerCase();
  const own = table?.[key]?.projectileType;
  if (Number.isFinite(own)) return own;
  if (tableCarriesType(table)) return -1;
  return LEGACY_MINES.has(key) ? MINE_PROJECTILE_TYPE : -1;
}

const carries = new WeakMap();
function tableCarriesType(table) {
  if (!table || typeof table !== 'object') return false;
  let known = carries.get(table);
  if (known === undefined) {
    known = false;
    for (const key in table) if (Number.isFinite(table[key]?.projectileType)) { known = true; break; }
    carries.set(table, known);
  }
  return known;
}

/** The radius the local player is warned at, or 0 for none: 30 m seated,
 *  15 m on foot as an engineer. `viewer`: `{ alive, seated, kit }`. */
export function mineIconRadius(viewer) {
  if (!viewer?.alive) return 0;
  if (viewer.seated) return MINE_ICON_RADIUS_SEATED;
  return viewer.kit === ENGINEER_KIT ? MINE_ICON_RADIUS_ENGINEER : 0;
}

/**
 * `ShowMineIcon` for this paint. `viewer`: `{ alive, seated, kit, team, x, y,
 * z }`, the place being the control object's (the hull seated, the soldier
 * on foot). `rounds`: the live rounds, each `{ x, y, z, team, type }`.
 */
export function showMineIcon(viewer, rounds) {
  const radius = mineIconRadius(viewer);
  if (!radius || !rounds) return false;
  const r2 = radius * radius;
  for (const round of rounds) {
    if (round.type !== MINE_PROJECTILE_TYPE || round.team !== viewer.team) continue;
    const dx = round.x - viewer.x, dy = round.y - viewer.y, dz = round.z - viewer.z;
    if (dx * dx + dy * dy + dz * dz <= r2) return true;
  }
  return false;
}

/**
 * The same over a `GunFire`'s live rounds, with no list built: the page asks
 * every frame. A round's side is its firer's when it was first seen here
 * (the projectile keeps the team it was fired for). `teamOf(firer)` answers
 * for a player id. `table`: the tree's `damage.json` `projectiles`.
 * Cost: nothing unless the viewer is seated or an engineer on foot, then one
 * pass over the live rounds (a template lookup and a distance each).
 */
const roundTeams = new WeakMap();
export function friendlyMineNear(viewer, projectiles, table, teamOf) {
  const radius = mineIconRadius(viewer);
  if (!radius || !projectiles?.length) return false;
  const r2 = radius * radius;
  for (const shot of projectiles) {
    const block = shot?.group?.stats?.projectile;
    const template = typeof block === 'string' ? block : block?.template;
    if (projectileTypeOf(template, table) !== MINE_PROJECTILE_TYPE) continue;
    let team = roundTeams.get(shot);
    if (team === undefined) {
      team = shot.team ?? teamOf?.(shot.stamp?.firer ?? shot.group?.firer ?? null) ?? null;
      if (team != null) roundTeams.set(shot, team);
    }
    if (team !== viewer.team) continue;
    const p = shot.mesh?.position;
    if (!p) continue;
    const dx = p.x - viewer.x, dy = p.y - viewer.y, dz = p.z - viewer.z;
    if (dx * dx + dy * dy + dz * dz <= r2) return true;
  }
  return false;
}
