// A `useMMOnEndEffect` round's end effect, chosen by the surface under it
// (`round-impact.js` `endEffectFor`, `Projectile::startEndEffect` lnxded
// 0x0831f590). The table is vanilla `damage.json`'s row for material 205, the
// grenades' `material2`, cut to the cells the cases read. Run by
// `test_end_effect_surface.py`; prints one JSON object.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { viewerDir, installModuleHooks, routeConsole } = await import(path.join(HERE, '..', 'sim', 'env.mjs'));
const viewer = viewerDir(path.join(HERE, '..', 'viewer'));
installModuleHooks(viewer);
const imp = f => import(pathToFileURL(path.join(viewer, f)).href);
const { detonate, endEffectFor } = await imp('round-impact.js');
const { GunFire } = await imp('gunfire.js');
routeConsole(true);

const effects = {
  205: { 0: 'e_ExplGranade', 1: 'e_waterimpact', 3: 'GranadeExplDirt', 13: 'GranadeExplDry', 88: 'e_ExplGranade' },
  0: { 0: 'e_richoStone' },
};
const projectiles = {
  grenadealliesprojectile: { material: 70, hasOnTimeEffect: true, useMMOnEndEffect: true },
  bazookaprojectile: { material: 240 },
  oddprojectile: { material: 70, useMMOnEndEffect: true },
};
const played = [];
const guns = {
  materials: null, modifiers: null, projectileMaterials: projectiles, damageEffects: effects,
  hits: [], collider: { waterLevel: 40 },
  effects: { play: (name, at) => { played.push(name); return {}; } },
  attackerMaterial: GunFire.prototype.attackerMaterial,
  projectileEntry: GunFire.prototype.projectileEntry,
};
const damage = { damageType: 1, material2: 205, radius: 7 };
const GRENADE = { template: 'GrenadeAlliesProjectile', endEffect: 'e_ExplGranade', damage };
const group = { node: { name: 'GrenadeAllies' } };
const at = y => ({ x: 0, y, z: 0 });
const out = {
  // The last thing the round touched picks the bundle.
  grass: endEffectFor(guns, GRENADE, at(50), { material: 3 }),
  sand: endEffectFor(guns, GRENADE, at(50), { material: 13 }),
  concrete: endEffectFor(guns, GRENADE, at(50), { material: 88 }),
  // Under the water level it is material 1, whatever it last touched.
  water: endEffectFor(guns, GRENADE, at(39.5), { material: 3 }),
  // Nothing struck yet (Armor+0x8 = -1) and an id the row lacks: material 0.
  airburst: endEffectFor(guns, GRENADE, at(50), null),
  unlisted: endEffectFor(guns, GRENADE, at(50), { material: 77 }),
  // A material2 with no row is read as material 0's row.
  noRow: endEffectFor(guns, { template: 'OddProjectile', endEffect: 'e_ExplGranade',
    damage: { damageType: 1, material2: 999, radius: 7 } }, at(50), { material: 3 }),
  // A round without the word keeps its `endEffectTemplate`.
  fixed: endEffectFor(guns, { template: 'BazookaProjectile', endEffect: 'e_ExplAni',
    damage: { damageType: 1, material2: 240, radius: 5 } }, at(39), { material: 3 }),
  // No table loaded: nothing to ask, so the template's own.
  noTable: endEffectFor({ ...guns, damageEffects: null }, GRENADE, at(50), { material: 3 }),
};
// `detonate` plays what `endEffectFor` names and records it.
const record = detonate(guns, group, GRENADE, at(50), 12, null, { material: 3 });
out.detonate = { effect: record.effect, played: played.slice(), blast: record.blast,
                 splashMaterial2: record.splashMaterial2 };
process.stdout.write(JSON.stringify(out) + '\n');
