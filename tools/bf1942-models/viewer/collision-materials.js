// Material ids and what a hit on one looks and sounds like.
//
// The two ids every collider reads, and the three lookups that turn a
// material id into an impact effect, a stand-in colour family and a footstep
// patch. Split out of `collision.js`, which re-exports all of it; see that
// file's header for the collider as a whole.

/** Terrain material id when a map ships no `Materialmap.raw` — "Default". */
export const DEFAULT_TERRAIN_MATERIAL = 0;
/** MaterialManager's water id. `materialFriction 0.1`, `materialDamage 30`. */
export const WATER_MATERIAL = 1;

// --- impact effect selection ----------------------------------------------

/**
 * The EffectBundle the game plays for this pairing, or null.
 *
 * `effects` is the `attacker -> defender -> template` table out of
 * `_shared/damage.json`, which is `MaterialManager.setEffectTemplate` after
 * last-wins resolution: 4,099 pairs naming 73 bundles. A Sherman round
 * (attacker 236) resolves to `e_waterimpact` in water, `GroundExplDry` in El
 * Alamein's sand, `Exp2CascadesStone` into concrete and `e_ExplArmor` into
 * another tank's hull — all four out of this one lookup.
 */
export function impactEffect(effects, attacker, defender) {
  if (!effects || attacker == null) return null;
  const row = effects[String(attacker)];
  if (!row) return null;
  return row[String(defender)] ?? null;
}

/**
 * A coarse family for a material id, for picking a stand-in impact colour.
 *
 * The families are the `rem` headers in `materialManagerdefine.con`, not
 * invented buckets: 0-15 terrain, 79-98 basic materials, 100-120 and 165-195
 * building materials. Only used where the authored bundle is not available to
 * bake; see `features/bf1942-3d-models/projectile-collision.md`.
 */
export function materialFamily(id) {
  if (id === WATER_MATERIAL) return 'water';
  if (id <= 15) return 'ground';
  if (id >= 39 && id <= 76) return 'armour';
  if ((id >= 84 && id <= 87) || id === 90 || id === 193) return 'metal';
  if ((id >= 79 && id <= 83) || id === 107 || id === 113 || id === 117
      || id === 166) return 'wood';
  return 'stone';
}

/**
 * Maps a terrain or static mesh material ID to one of the 8 soldier footstep
 * sound patches declared in High/SoldierWalk.ssc and High/SoldierRun.ssc:
 * 'sand', 'metal', 'wood', 'concrete', 'grass', 'gravel', 'ice', 'mud'.
 *
 * Derived from materialManagerDefine.con and High/SoldierWalk.ssc.
 */
export function footstepMaterial(id) {
  if (id === 2 || id === 3) return 'grass';
  if (id === 6) return 'mud';
  if (id === 8 || id === 13 || id === 14) return 'gravel';
  if (id === 9) return 'ice';
  if (id === 12 || id === 15) return 'concrete';
  if (id <= 15) return 'sand';
  if ((id >= 79 && id <= 83) || id === 97 || id === 107 || id === 113 || id === 117 || id === 166) return 'wood';
  if ((id >= 84 && id <= 87) || id === 90 || id === 98 || id === 193 || (id >= 39 && id <= 76)) return 'metal';
  return 'concrete';
}
