// The effect runtime's three-dependent half under node: a soldier's death tier
// (`viewer/soldier-armor-effects.js`), the `EffectPlayer`'s fault guard and the
// muzzle path's ramp sampler (`viewer/round-visuals.js`), all through the page's
// own modules and the vendored three.js.
//
// Run by `tests/test_effect_runtime.py`; prints one JSON object.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { viewerDir, installModuleHooks, routeConsole } = await import(path.join(HERE, '..', 'sim', 'env.mjs'));
const viewer = viewerDir(path.join(HERE, '..', 'viewer'));
installModuleHooks(viewer);
const imp = f => import(path.join(viewer, f));
const THREE = await imp('vendor/three.module.js');
const { deathKey, tierAt, effectFrame, createSoldierArmorEffects } = await imp('soldier-armor-effects.js');
const { EffectPlayer } = await imp('effects.js');
const { sampleCurve: roundSample } = await imp('round-visuals.js');
const { newParticleRecord, spawnParticleInto, basisFromNormal } = await imp('effects-core.js');
routeConsole(true);

const out = {};
const round = v => Math.round(v * 1e6) / 1e6;

// --- `Armor::getEffect` and the death key ------------------------------------
// A Sherman's vanilla tiers: smoke 50, fire 12, the death tier 0 (three
// bundles) and the water tier -1.
const sherman = [
  { hp: 50, effect: 'e_PanzDamage' }, { hp: 12, effect: 'e_PanzFire' },
  { hp: 0, effect: 'e_ExplGas' }, { hp: 0, effect: 'e_scrapmetal' }, { hp: 0, effect: 'e_scrapmetal2' },
  { hp: -1, effect: 'WaterWaterExplosion' },
];
const names = tier => (tier ? tier.effects.map(e => e.effect) : null);
out.getEffect = {
  full: names(tierAt(sherman, 100)),
  at50: names(tierAt(sherman, 50)),
  at30: names(tierAt(sherman, 30)),
  at12: names(tierAt(sherman, 12)),
  at1: names(tierAt(sherman, 1)),
  deadOnLand: names(tierAt(sherman, deathKey({ lastHitMaterial: -1 }))),
  deadInWater: names(tierAt(sherman, deathKey({ lastHitMaterial: 40, inWater: true }))),
  deadHitNoWater: names(tierAt(sherman, deathKey({ lastHitMaterial: 40 }))),
  deadKeyOwnTier: names(tierAt([...sherman, { hp: -40, effect: 'e_material40' }], deathKey({ lastHitMaterial: 40 }))),
  soldierAlive: names(tierAt([{ hp: 0, effect: 'e_soldierdeath_us' }], 30)),
  soldierDead: names(tierAt([{ hp: 0, effect: 'e_soldierdeath_us' }], deathKey())),
  none: tierAt([], 0),
};
out.deathKey = {
  noMaterial: deathKey(), noMaterialInWater: deathKey({ inWater: true }),
  material: deathKey({ lastHitMaterial: 40 }), materialInWater: deathKey({ lastHitMaterial: 40, inWater: true }),
};

// --- where the offset lands ---------------------------------------------------
// The report's offsets are the glb's (Refractor Z mirrored): the US soldier's
// `0/0/0.1` ships as [0, 0, -0.1], the Iraqi's `0/-0.1/0.5` as [0, -0.1, -0.5].
out.frame = {};
for (const [name, yaw, offset] of [
  ['usYaw0', 0, [0, 0, -0.1]],
  ['usYaw90', Math.PI / 2, [0, 0, -0.1]],
  ['iraqYaw180', Math.PI, [0, -0.1, -0.5]],
  ['rightYaw0', 0, [1, 0, 0]],
]) {
  const { position, turn } = effectFrame([10, 5, 20], yaw, offset);
  // The frame the effect player derives from the anchor: dof is its -Z.
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), turn);
  const dof = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
  out.frame[name] = {
    position: position.map(round),
    dof: [dof.x, dof.y, dof.z].map(round),
    right: [right.x, right.y, right.z].map(round),
    forward: [Math.sin(yaw), 0, Math.cos(yaw)].map(round),
  };
}

// --- the page half, with a stubbed fetch and effect player ---------------------
const reports = {
  'models/mods/desertcombat/USSoldier.report.json': {
    armor: { effects: [{ hp: 0.0, effect: 'e_soldierdeath_us', offset: [0.0, 0.0, -0.1] }] },
  },
  'models/GermanSoldier.report.json': { armor: { hitpoints: 30 } },
};
let fetches = 0;
globalThis.fetch = async url => {
  fetches++;
  const body = reports[url.split('?')[0]];
  return body ? { ok: true, json: async () => body } : { ok: false, json: async () => null };
};
const played = [];
const fakeEffects = {
  play(name, opts) {
    const anchor = opts.attach.object;
    anchor.updateWorldMatrix(true, false);
    const p = new THREE.Vector3(); anchor.getWorldPosition(p);
    const dof = new THREE.Vector3(0, 0, -1).applyQuaternion(anchor.getWorldQuaternion(new THREE.Quaternion()));
    const v = opts.attach.velocity();
    played.push({ name, position: [p.x, p.y, p.z].map(round), dof: [dof.x, dof.y, dof.z].map(round),
                   velocity: [v.x, v.y, v.z] });
    return { run: {}, stop() {} };
  },
};
let base = 'models/mods/desertcombat';
const page = { get MODELS_BASE() { return base; }, bust: () => '?t=1', get effects() { return fakeEffects; } };
const soldiers = createSoldierArmorEffects(page);
const us = await soldiers.died({ template: 'USSoldier', x: 10, y: 5, z: 20, yaw: Math.PI / 2,
                                  velocity: { x: 3, y: 0, z: 0 } });
const again = await soldiers.died({ template: 'USSoldier', x: 0, y: 0, z: 0, yaw: 0 });
base = 'models';
const vanilla = await soldiers.died({ template: 'GermanSoldier', x: 0, y: 0, z: 0, yaw: 0 });
const missing = await soldiers.died({ template: 'NoSuchSoldier', x: 0, y: 0, z: 0, yaw: 0 });
const notANumber = await soldiers.died({ template: 'USSoldier', x: NaN, y: 0, z: 0, yaw: 0 });
out.page = { us, again, vanilla, missing, notANumber, fetches, plays: soldiers.plays, played };

// --- the effect player drops a particle that throws, and the frame goes on -----
{
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  const player = new EffectPlayer({ scene, camera });
  const spawn = particle => {
    const p = spawnParticleInto(newParticleRecord(), { particle }, basisFromNormal([0, 1, 0]), [0, 0, 0], null, () => 0.5);
    p.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
    player.particles.push(p);
    return p;
  };
  const sprite = { kind: 'sprite', template: 'Fx_Good', timeToLive: ['n', 2, 0, 0], size: ['n', 1, 0, 0] };
  // The ramp DC's wreck smoke used to bake: an empty point between two real ones.
  const legacy = { ...sprite, template: 'Fx_Browning_Destroy',
                   colorRGBAOverTime: [[0, 255, 255, 255, 133], [40, 41, 38, 36, 133], [], [100, 26, 23, 19, 0]] };
  const broken = { ...sprite, template: 'Fx_Broken' };
  Object.defineProperty(broken, 'sizeOverTime', { get() { throw new Error('bad ramp'); }, enumerable: true });
  spawn(sprite); spawn(legacy); spawn(broken);
  let threw = null;
  const alive = [];
  try {
    for (let i = 0; i < 40; i++) { player.advance(1 / 30); alive.push(player.particles.length); }
  } catch (error) { threw = String(error); }
  out.guard = { threw, alive, faults: player.stats().faults, faulted: [...player.faulted],
                legacyOpacity: round(player.particles.find(p => p.spec.template === 'Fx_Browning_Destroy')?.mesh.material.opacity ?? -1) };
}

// --- the muzzle path's sampler ---------------------------------------------------
out.roundSample = {
  emptyBetween: roundSample([[0, 1], [], [100, 3]], 50),
  onlyEmpty: roundSample([[]], 50),
  none: roundSample(null, 50),
  clean: roundSample([[0, 255, 255, 255, 204], [100, 0, 0, 0, 0]], 50),
};

process.stdout.write(JSON.stringify(out) + "\n");
