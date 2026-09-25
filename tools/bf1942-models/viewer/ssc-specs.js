// A vehicle's engine and gun patches, found in a level report's `sounds`.
// Split out of `engine-audio.js`, which re-exports them.

/**
 * The engine sound for one vehicle out of a level report, by template name.
 *
 * The report keys on the template the spawner actually resolved to, which is
 * how a Wake scene ends up with both `corsair` and `sbd`; the match is
 * case-insensitive because `ObjectSpawnTemplates.con` is.
 */
export function findEngineSpec(report, template) {
  const list = report?.sounds?.vehicles;
  if (!list || !template) return null;
  const want = template.toLowerCase();
  return list.find(v => (v.template || '').toLowerCase() === want) || null;
}

/**
 * Does this patch's owner carry `ObjectTemplate.setAttachToListener 1`?
 *
 * The extractor writes `attachToListener` on each engine and weapon entry. A
 * `scene.json` from before it did is answered from the engine's script path:
 * across vanilla, XPack1 and XPack2 every sound-bearing Engine under
 * `Objects/Vehicles/Land/` carries the flag (19 + 4 + 22, the only exception a
 * Katyusha rocket's projectile engine) and no aircraft or ship Engine, and no
 * FireArms in any of them, does (ledger SND-7). So a gun is never attached on
 * old data. Inferred for a mod tree, which is why the field wins when present.
 */
export function attachesToListener(spec, kind = 'engine') {
  if (typeof spec?.attachToListener === 'boolean') return spec.attachToListener;
  if (kind !== 'engine') return false;
  return /(^|\/)objects\/vehicles\/land\//i.test(spec?.script || '');
}

/**
 * The gun patches for one vehicle, in the same shape `loadEngineAudio` takes.
 *
 * The extractor hangs weapons off the vehicle that carries them, so this is the
 * engine lookup plus one hop. `engine` is set to the FireArms name because that
 * is what the field means to every caller — the node the voices belong on — and
 * for a gun that is the gun.
 */
export function findWeaponSpecs(report, template) {
  const vehicle = findEngineSpec(report, template);
  if (!vehicle?.weapons?.length) return [];
  return vehicle.weapons.map(weapon => ({
    template,
    engine: weapon.fireArms,
    fireArms: weapon.fireArms,
    script: weapon.script,
    level: vehicle.level,
    layers: weapon.layers,
    attachToListener: weapon.attachToListener,
  }));
}

/**
 * Look up gun patches by FireArms node name across every vehicle in the
 * report. Bare furniture mounts (Stationary MG42 / Browning) have no Engine
 * entry of their own, so `findWeaponSpecs(template)` is empty — but the same
 * `.ssc` was often extracted next to a tank or ship that carries that gun
 * (Hatsuzuki → `MG42_unlimited`, Sherman → `Browning`).
 *
 * `names` may include `_unlimited` variants; a bare `Browning` layer matches
 * `Browning_unlimited` when the exact name is missing.
 */
export function findWeaponSpecsByFireArms(report, names) {
  const list = report?.sounds?.vehicles;
  if (!list?.length || !names?.length) return [];
  const want = [...new Set(names)];
  const byName = new Map();
  for (const vehicle of list) {
    for (const weapon of vehicle.weapons || []) {
      if (!byName.has(weapon.fireArms)) {
        byName.set(weapon.fireArms, {
          template: vehicle.template,
          engine: weapon.fireArms,
          fireArms: weapon.fireArms,
          script: weapon.script,
          level: vehicle.level,
          layers: weapon.layers,
          attachToListener: weapon.attachToListener,
        });
      }
    }
  }
  const found = [];
  const claimed = new Set();
  for (const name of want) {
    const exact = byName.get(name);
    if (exact) {
      found.push(exact);
      claimed.add(name);
      continue;
    }
    if (name.endsWith('_unlimited')) {
      const bare = byName.get(name.slice(0, -'_unlimited'.length));
      if (bare && !claimed.has(name)) {
        found.push(bare);
        claimed.add(name);
      }
    }
  }
  return found;
}
