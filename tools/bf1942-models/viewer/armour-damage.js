// The armour inspector's damage arithmetic: the MaterialManager tables out of
// Game.rfa (damage.json) and the weapon's own distance falloff. Direct damage
// is materialDamage(att) * damageMod(att, def) * cos(angle) * distanceMod; a
// pair with no damageMod entry is one the engine ignores entirely. Split out
// of `model-armour.js`, which keeps the selected weapon and the drawing.

/** The table lookups, bound to one `damage.json`. */
export function damageMath(tables) {
  function attGroup(material) {
    return tables?.materials?.[material]?.attGroup ?? material;
  }

  function defGroup(material) {
    return tables?.materials?.[material]?.defGroup ?? material;
  }

  function baseDamage(material) {
    const defined = tables?.materials?.[material];
    return defined ? defined.damage : null;
  }

  function damageMod(attMaterial, defMaterial) {
    if (attMaterial == null || defMaterial == null) return null;
    const value = tables?.modifiers?.[attGroup(attMaterial)]?.[defGroup(defMaterial)];
    return value === undefined ? null : value;
  }

  function headOnFor(weapon, material) {
    if (!weapon || weapon.material == null || material == null) return null;
    const base = baseDamage(weapon.material);
    const mod = damageMod(weapon.material, material);
    if (base == null || mod == null) return null;
    return base * mod;
  }

  return { attGroup, defGroup, baseDamage, damageMod, headOnFor };
}

export function distanceMod(weapon, distance) {
  if (!weapon || weapon.minDamage == null || weapon.distToStartLoseDamage == null
      || weapon.distToMinDamage == null) return 1;
  if (distance <= weapon.distToStartLoseDamage) return 1;
  if (distance >= weapon.distToMinDamage
      || weapon.distToMinDamage <= weapon.distToStartLoseDamage) return weapon.minDamage;
  const span = weapon.distToMinDamage - weapon.distToStartLoseDamage;
  return weapon.minDamage + (1 - weapon.minDamage) * (weapon.distToMinDamage - distance) / span;
}

export function hasDistanceFalloff(weapon) {
  return Boolean(weapon && weapon.minDamage != null && weapon.distToMinDamage != null);
}

export function shotsFor(hitpoints, perShot) {
  if (!(perShot > 0) || !(hitpoints > 0)) return null;
  return Math.ceil(hitpoints / perShot - 1e-9);
}

export function formatHp(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function weaponLabel(weapon) {
  return weapon.owner && weapon.owner.toLowerCase() !== weapon.name.toLowerCase()
    ? `${weapon.owner} · ${weapon.name}`
    : weapon.name;
}
