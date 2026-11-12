// The vehicle reload bars' law under node (ledger VHUD-10): `vehicle-hud.js`
// `readyFraction` against retail's `Vehicle::updateAmmoBar` (client
// 0x006d6af0). One JSON report on stdout.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const { createVehicleHud } = await import(pathToFileURL(path.join(viewer, 'vehicle-hud.js')).href);

const node = {};
const group = { node, cooldown: 0, stats: { roundOfFire: 0.35 } };
const hud = createVehicleHud({
  mannedActive: () => true, mannedGuns: [group], vehicleGuns: [],
});
const state = (reloadRemaining, extra = {}) => ({
  reloadRemaining, stats: { reloadTime: 4, timeDelayOnOverheat: 2 }, hasHeat: true, overheatRemaining: 0, ...extra,
});
const at = (reload, cooldown, extra) => { group.cooldown = cooldown; return hud.readyFraction(state(reload, extra), node); };
const r4 = v => Math.round(v * 1e4) / 1e4;
console.log(JSON.stringify({
  ready: r4(at(0, 0)),
  reloading: r4(at(2, 0)),            // 1 - 2/4
  reloadWinsOverFire: r4(at(1, 2)),   // reload first, not the larger
  fireOnly: r4(at(0, 1.43)),          // 1 - 1.43 x 0.35
  reloadDeadBand: r4(at(0.1, 2)),     // reload not > 0.1: the fire timer
  fireDeadBand: r4(at(0, 0.1)),       // neither > 0.1: full
  overheatIgnored: r4(at(0, 0, { overheatRemaining: 1.5 })),
  noWeapon: hud.readyFraction(null, node),
}));
