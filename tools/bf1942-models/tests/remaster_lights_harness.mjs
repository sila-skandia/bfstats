// `viewer/remaster-lights.js` under node (see `test_remaster_lights.py`):
// which effect bundle lights its surroundings in remaster mode, and how.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const { FIRE, fireFlicker, flashKind, isFire } = await import(pathToFileURL(path.join(viewer, 'remaster-lights.js')).href);

const NAMES = [
  'e_MuzzPanz', 'e_MuzzSexton', 'e_MuzzDefgun', 'e_MuzzAAGun', 'e_MuzzHeavy', 'e_MuzzSG44', 'e_MuzzM1',
  'e_ExplGas', 'e_ExplArmor', 'e_GranadeExpl', 'e_Bomb', 'e_ExplDrySand', 'e_ExplWindow', 'e_RichoMetal',
  'e_Shell792mm', 'e_PanzShootTrail', 'e_waterimpact', 'e_WillyDamage',
  'e_WillyFire', 'e_PanzFire', 'e_CorsairFire', 'e_fire4', 'e_scrapmetal_Spitfire', 'e_scrapmetal',
];
const flash = {};
const fire = {};
for (const name of NAMES) {
  const kind = flashKind(name);
  flash[name] = kind ? { intensity: kind.intensity, range: kind.range, life: kind.life, burst: kind.burst ?? 0 } : null;
  fire[name] = isFire(name);
}
let low = Infinity;
let high = -Infinity;
for (let t = 0; t < 120; t += 0.013) { const f = fireFlicker(t); low = Math.min(low, f); high = Math.max(high, f); }

console.log(JSON.stringify({
  flash, fire,
  none: [flashKind(''), flashKind(null), isFire(null), isFire(undefined)],
  flicker: { low, high },
  fireLight: { intensity: FIRE.intensity, range: FIRE.range, reach: FIRE.reach },
}));
