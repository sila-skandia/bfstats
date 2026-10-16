// `foot-body.js` `ensureFootBody` under node, with poses that arrive when the
// harness says: which weapon the third-person body ends on when the hand
// changes twice before a pose lands (FHX-15). One JSON blob.
//
// The page's case (Battle_Of_Foy, 2Us_AssaultGarand): the knife in hand and
// on the body, then the rifle and the knife raised in one tick. The rifle's
// pose load starts; the knife's request meets the body that already holds the
// knife and returns; the rifle's pose then lands.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir(process.argv[2] ?? null);
installModuleHooks(viewer);
globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => null });
const THREE = await import('three');
const { createFootBody } = await import(pathToFileURL(path.join(viewer, 'foot-body.js')).href);

const page = {
  scene: new THREE.Scene(),
  MODELS_BASE: 'models', bust: () => '', bindDynamicShading() {},
  deployTeamId: 2, deployKit: 'assault', currentKit: () => null,
};
const bodies = createFootBody(page);

// Each pose request waits on the harness: `release(weapon)` lands it.
const waiting = new Map();
bodies.footPoses.pose = (soldier, weapon) => new Promise(resolve => {
  waiting.set(weapon, () => {
    const scene = new THREE.Group();
    scene.name = `${soldier}__${weapon}`;
    resolve({ scene, animations: [], userData: {}, weaponName: weapon, recipe: null });
  });
});
const release = async weapon => { waiting.get(weapon)?.(); waiting.delete(weapon); await settle(); };
const settle = () => new Promise(r => setTimeout(r, 10));
const onBody = () => bodies.footBody?.weapon ?? null;

const out = {};
const ensure = weapon => bodies.ensureFootBody('USSoldier', weapon).catch(() => null);

ensure('Knife_M1Bayonet_ID2');
await settle();
await release('Knife_M1Bayonet_ID2');
out.start = onBody();

// The rifle, then the knife again, in one tick.
ensure('M1Garand');
ensure('Knife_M1Bayonet_ID2');
await settle();
await release('M1Garand');
out.afterRace = onBody();

// An ordinary change still lands.
ensure('M1Garand');
await settle();
await release('M1Garand');
out.afterChange = onBody();

console.log(JSON.stringify(out));
