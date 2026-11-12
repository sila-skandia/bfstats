// A rifle round against a soldier on foot, priced by the page's own round
// (`round-impact.js impact`) and by a bot's (`vehicle-hits.js
// botRoundDamage`, which the page's and the headless runner's bot referee
// bill): both must come to the template's damage (ledger DMG-3: the Kar98k's
// 5 x 10 / 4 / 2 = 50 head, 20 chest, 10 limbs). The tables are vanilla
// `damage.json`'s own rows for those materials. Run by
// `test_round_damage_parity.py`; prints one JSON object.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { viewerDir, installModuleHooks, routeConsole } = await import(path.join(HERE, '..', 'sim', 'env.mjs'));
const viewer = viewerDir(path.join(HERE, '..', 'viewer'));
installModuleHooks(viewer);
const imp = f => import(pathToFileURL(path.join(viewer, f)).href);
const { createVehicleHits } = await imp('vehicle-hits.js');
const { impact } = await imp('round-impact.js');
const { GunFire } = await imp('gunfire.js');
routeConsole(true);

const materials = {
  0: { attGroup: 0, defGroup: 0, damage: 30 },
  219: { attGroup: 219, defGroup: 219, damage: 5 },
  40: { attGroup: 40, defGroup: 40, damage: 10 },
  41: { attGroup: 41, defGroup: 41, damage: 10 },
  42: { attGroup: 42, defGroup: 42, damage: 10 },
};
const modifiers = { 0: { 40: 0.001, 41: 0.001, 42: 0.001 }, 219: { 40: 10, 41: 4, 42: 2 } };
const projectiles = { k98projectile: { material: 219 }, nomaterialprojectile: {},
  k98riflegrenadeprojectile: { material: 219, noFFSound: true } };
const guns = {
  materials, modifiers, projectileMaterials: projectiles, damageEffects: null,
  hits: [], effects: null,
  attackerMaterial: GunFire.prototype.attackerMaterial,
  projectileEntry: GunFire.prototype.projectileEntry,
};
const page = { guns, world: null, vehicles: { firerOf: () => null } };
const hits = createVehicleHits(page);

// The K98's `fireArms.projectile` as the exporter writes it (assemble.py
// `_projectile_spec`: the template always, the material when authored).
const K98 = { template: 'K98Projectile', material: 219 };
const pageRound = (material, spec = K98) => (impact(guns, { node: { name: 'K98' } }, spec,
  { kind: 'soldier', material, owner: -1, x: 0, y: 1, z: 0, nx: 0, ny: 0, nz: -1 },
  null, 10), guns.hits[0].damage);
const botRound = (stats, material) => hits.botRoundDamage(stats, material, 10);
const out = {
  page: { head: pageRound(40), chest: pageRound(41), limbs: pageRound(42) },
  pageGaps: {
    // A spec the table does not list, with no material: our data, so no
    // direct damage, as `round-impact.js` priced it before F3.
    unlisted: pageRound(41, { template: 'NotInTheTable' }),
    // A listed template with no material: the engine's material 0.
    unauthored: pageRound(41, { template: 'NoMaterialProjectile' }),
  },
  bot: {
    head: botRound({ round: K98 }, 40),
    chest: botRound({ round: K98 }, 41),
    limbs: botRound({ round: K98 }, 42),
    // The weapon block names the round only by template: the table's row.
    byTemplate: botRound({ projectile: 'K98Projectile' }, 41),
    // No weapon data at all (a weapon glb not yet loaded, a tree without it):
    // our plumbing, so the stand-in, not the engine's material 0.
    noData: botRound(null, 41),
    unlisted: botRound({ round: { template: 'NotInTheTable' } }, 41),
    // A template the table lists with no `material`: the engine's material 0
    // (template +0x88 = -1, the contact's own 0).
    unauthored: botRound({ round: { template: 'NoMaterialProjectile' } }, 41),
  },
};
// `noFFSound` (`ProjectileTemplate+0x14f`, FF-6): the table's row rides on
// the impact record, which `vehicle-hits.js` hands `roundTouchedSoldier`.
const ffRecord = template => {
  guns.hits.length = 0;
  impact(guns, { node: { name: 'K98' } }, { template, material: 219 },
    { kind: 'soldier', material: 41, owner: -1, x: 0, y: 1, z: 0, nx: 0, ny: 0, nz: -1 }, null, 10);
  return guns.hits[0].noFFSound;
};
out.noFFSound = { riflegrenade: ffRecord('K98RifleGrenadeProjectile'), rifle: ffRecord('K98Projectile') };
process.stdout.write(JSON.stringify(out) + '\n');
