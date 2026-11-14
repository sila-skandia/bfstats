// `viewer/remaster-lights.js` under node (see `test_remaster_lights.py`):
// which effect bundle lights its surroundings in remaster mode, and how.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const { FIRE, fireFlicker, flashKind, isFire, pickFlashSlot } = await import(pathToFileURL(path.join(viewer, 'remaster-lights.js')).href);

const NAMES = [
  'e_MuzzPanz', 'e_MuzzSexton', 'e_MuzzDefgun', 'e_MuzzAAGun', 'e_MuzzHeavy', 'e_MuzzSG44', 'e_MuzzM1',
  'e_ExplGas', 'e_ExplArmor', 'e_GranadeExpl', 'e_Bomb', 'e_ExplDrySand', 'e_ExplWindow', 'e_RichoMetal',
  'e_Shell792mm', 'e_PanzShootTrail', 'e_waterimpact', 'e_WillyDamage',
  'e_WillyFire', 'e_PanzFire', 'e_CorsairFire', 'e_fire4', 'e_scrapmetal_Spitfire', 'e_scrapmetal',
  'e_FlakBig', 'e_ScrapAAFlak38',
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

// The flash pool: four lights, the eye at the origin, a gun 10 m off.
const lit = (t, x, peak = 16) => ({ t, life: 0.07, peak, at: { x, y: 0, z: 0 } });
const eye = { x: 0, y: 0, z: 0 };
const pool = {
  free: pickFlashSlot([lit(0.05, 150), lit(0, 150), lit(0.05, 150), lit(0.05, 150)], eye, 16, { x: 10, y: 0, z: 0 }),
  // Every slot held by a gun 150 m off: the near gun takes the farthest's.
  near: pickFlashSlot([lit(0.07, 150), lit(0.07, 160), lit(0.07, 140), lit(0.07, 155)], eye, 16, { x: 10, y: 0, z: 0 }),
  // Every slot held by a gun 10 m off: a gun 150 m off is not lit.
  far: pickFlashSlot([lit(0.07, 10), lit(0.07, 11), lit(0.07, 12), lit(0.07, 9)], eye, 16, { x: 150, y: 0, z: 0 }),
  // A near flash all but spent gives way to a fresh one as near.
  spent: pickFlashSlot([lit(0.07, 10), lit(0.005, 10), lit(0.07, 10), lit(0.07, 10)], eye, 16, { x: 10, y: 0, z: 0 }),
};

console.log(JSON.stringify({ pool,
  flash, fire,
  none: [flashKind(''), flashKind(null), isFire(null), isFire(undefined)],
  flicker: { low, high },
  fireLight: { intensity: FIRE.intensity, range: FIRE.range, reach: FIRE.reach },
}));
