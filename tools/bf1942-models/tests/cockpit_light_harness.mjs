// A grafted cockpit interior is lit, not drawn flat (ledger DL-5, DL-8):
// level-shading.js `shadeCockpit` hands the interior to the `bindDynamicShading`
// pass every hull takes, with the level's fixed-function ambient + global
// ambient and diffuse scaled by k = min(1, 0.87 * animatedMeshAmbient /
// mean(ambient + global)), and gives a blended interior material its depth
// writes back unless the level lists it in `depthWriteOff`. One JSON report on
// stdout; `test_cockpit_light.py` asserts it.
//
// The combine is read back out of the program the pass builds: the fake
// shader below is what `onBeforeCompile` rewrites, and the constants it
// injects are parsed and evaluated, so the test pins the numbers the GPU
// would run and not a restatement of them.

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const viewer = viewerDir(path.join(HERE, '..', 'viewer'));
installModuleHooks(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const [THREE, { createLevelShading }] = await Promise.all([
  imp('vendor/three.module.js'), imp('level-shading.js'),
]);

// Raid on Agheila's declared light (maps/mods/xpack2/raid_on_agheila/scene.json,
// `Init.con`: animatedMeshAmbientColor 0.2, animatedMeshDiffuseFactor 0.75).
const AGHEILA = {
  lighting: {
    ambient: [0.15, 0.14, 0.14], diffuse: [0.35, 0.32, 0.18], globalAmbient: [0.1, 0.1, 0.12],
    animatedMeshAmbient: [0.2, 0.2, 0.2], animatedMeshDiffuseFactor: 0.75,
  },
  sunDirection: [-0.8376, 0.436, 0.3281],
};
// The same level as published before the animated terms were written.
const AGHEILA_STALE = {
  lighting: { ambient: [0.15, 0.14, 0.14], diffuse: [0.35, 0.32, 0.18], globalAmbient: [0.1, 0.1, 0.12] },
  sunDirection: [-0.8376, 0.436, 0.3281],
};
// Wake: animatedMeshAmbientColor 0.25, factor 0.8, ambient 0.1 and global
// 0.14 / 0.12 / 0.13.
const WAKE = {
  lighting: {
    ambient: [0.1, 0.1, 0.1], diffuse: [0.4, 0.38, 0.36], globalAmbient: [0.14, 0.12, 0.13],
    animatedMeshAmbient: [0.25, 0.25, 0.25], animatedMeshDiffuseFactor: 0.8,
  },
  sunDirection: [-0.295, 0.496, 0.816],
};
// Iwo Jima: animatedMeshAmbientColor 0.3, no factor declared (the client's 1.0).
const IWO = {
  lighting: {
    ambient: [0.068, 0.04, 0.07], diffuse: [0.4, 0.38, 0.25], globalAmbient: [0.15, 0.15, 0.15],
    animatedMeshAmbient: [0.3, 0.3, 0.3], animatedMeshDiffuseFactor: 1.0,
  },
  sunDirection: [0.764, 0.5867, 0.251],
};

function pass(extras, envCube = null) {
  return createLevelShading({
    extras, levelEnvCube: envCube, camera: new THREE.PerspectiveCamera(),
    bust: () => '', MAPS_BASE: '', renderer: null, texLoader: null,
  });
}

/** What `onBeforeCompile` writes into a program, evaluated: the stage-0
 *  multiplier for a unit normal, `2 * min(1, floor + sun * N.L)`. */
function combine(material, normal) {
  const shader = {
    uniforms: {},
    vertexShader: 'void main() {\n#include <begin_vertex>\n}',
    fragmentShader: 'void main() {\n#include <map_fragment>\n}',
  };
  material.onBeforeCompile(shader);
  const src = shader.fragmentShader;
  const grab = re => { const m = src.match(re); return m && m.slice(1, 4).map(Number); };
  const floor = grab(/bfLit = 2\.0 \* min\( vec3\( 1\.0 \),\s*vec3\( ([\d.]+), ([\d.]+), ([\d.]+) \)/);
  const sun = grab(/\+ vec3\( ([\d.]+), ([\d.]+), ([\d.]+) \) \* bfNdL/);
  const dir = grab(/dot\( bfN, vec3\( (-?[\d.]+), (-?[\d.]+), (-?[\d.]+) \) \)/);
  if (!floor || !sun || !dir) return { parsed: false, src };
  const ndl = Math.max(0, normal[0] * dir[0] + normal[1] * dir[1] + normal[2] * dir[2]);
  const lit = [0, 1, 2].map(i => 2 * Math.min(1, floor[i] + sun[i] * ndl));
  return { parsed: true, floor, sun, dir, ndl, lit: lit.map(v => +v.toFixed(4)), src };
}

const results = {};
const mesh = (material, name = 'part') => { const m = new THREE.Mesh(new THREE.BufferGeometry(), material); m.name = name; return m; };

// 1. A lit interior material (what the exporter writes for `lighting true`).
{
  const shading = pass(AGHEILA);
  const std = new THREE.MeshStandardMaterial({ color: 0xffffff });
  std.userData = { envmap: false };
  const root = new THREE.Group();
  root.add(mesh(std));
  shading.shadeCockpit(root);
  const out = root.children[0].material;
  results.lit = {
    kind: out.type,
    standardLeft: out.isMeshStandardMaterial === true,
    key: out.customProgramCacheKey ? out.customProgramCacheKey() : null,
    // a face the sun does not reach, a face square to the sun, and straight up
    away: combine(out, [-0.8379, -0.4361, 0.3282]).lit,
    toward: combine(out, [0.8376, 0.436, -0.3281]).lit,
    up: combine(out, [0, 1, 0]).lit,
    floor: combine(out, [0, -1, 0]).floor,
    sun: combine(out, [0, -1, 0]).sun,
    parsed: combine(out, [0, 1, 0]).parsed,
  };
}

// 1b. The hull OUTSIDE the cockpit keeps the fixed-function terms: one level,
//     two rules, and only the interior takes the animated ones.
{
  const shading = pass(AGHEILA);
  const std = new THREE.MeshStandardMaterial();
  const root = new THREE.Group();
  root.add(mesh(std));
  shading.bindDynamicShading(root);
  const out = root.children[0].material;
  const c = combine(out, [0, -1, 0]);
  results.hull = { floor: c.floor, sun: c.sun };
}

// 1c. A scene.json with no animated terms (published before they existed)
//     lights its interior by the fixed-function terms until it is re-patched.
{
  const shading = pass(AGHEILA_STALE);
  const root = new THREE.Group();
  root.add(mesh(new THREE.MeshStandardMaterial()));
  shading.shadeCockpit(root);
  const c = combine(root.children[0].material, [0, -1, 0]);
  results.stale = { floor: c.floor, sun: c.sun };
}

// 1e. Wake: k = 0.87 * 0.25 / 0.23 = 0.946, the tint of ambient + global.
{
  const shading = pass(WAKE);
  const root = new THREE.Group();
  root.add(mesh(new THREE.MeshStandardMaterial()));
  shading.shadeCockpit(root);
  const c = combine(root.children[0].material, [0, -1, 0]);
  results.wake = { floor: c.floor, sun: c.sun };
}

// 1f. A blended material gets its depth writes back unless listed.
{
  const scene = { ...AGHEILA, depthWriteOff: ['gunsight_glass'] };
  const shading = pass(scene);
  const root = new THREE.Group();
  const blended = new THREE.MeshStandardMaterial({ transparent: true, depthWrite: false });
  blended.name = 'ILyushin_Cockpit_M1_Material0';
  const glass = new THREE.MeshStandardMaterial({ transparent: true, depthWrite: false });
  glass.name = 'Gunsight_Glass';
  const opaque = new THREE.MeshStandardMaterial({ depthWrite: true });
  const faded = new THREE.MeshStandardMaterial({ transparent: true, depthWrite: false });
  faded.userData = { textureFade: true };
  faded.name = 'black_o';
  for (const m of [blended, glass, opaque, faded]) root.add(mesh(m));
  shading.shadeCockpit(root);
  const [a, b, c2, d] = root.children.map(m => m.material);
  results.depth = { blended: a.depthWrite, listed: b.depthWrite, opaque: c2.depthWrite, faded: d.depthWrite };
  // a scene.json with no list leaves every blended material as loaded
  const stale = pass(AGHEILA);
  const root2 = new THREE.Group();
  const m2 = new THREE.MeshStandardMaterial({ transparent: true, depthWrite: false });
  m2.name = 'x';
  root2.add(mesh(m2));
  stale.shadeCockpit(root2);
  results.depthStale = root2.children[0].material.depthWrite;
}

// 1d. Iwo Jima: a different level, a different floor.
{
  const shading = pass(IWO);
  const root = new THREE.Group();
  root.add(mesh(new THREE.MeshStandardMaterial()));
  shading.shadeCockpit(root);
  const c = combine(root.children[0].material, [0, 1, 0]);
  results.iwo = { floor: c.floor, sun: c.sun, up: c.lit };
}

// 2. `lighting false` arrives as a basic material and is left exactly alone.
{
  const shading = pass(AGHEILA);
  const basic = new THREE.MeshBasicMaterial({ color: 0x336699 });
  const root = new THREE.Group();
  root.add(mesh(basic));
  shading.shadeCockpit(root);
  results.unlit = { same: root.children[0].material === basic };
}

// 3. An additive glow is light: unlit, additive, never shaded; the userData
//    marks survive (gunfire.js and the hand rig read them).
{
  const shading = pass(AGHEILA);
  const glow = new THREE.MeshStandardMaterial({ color: 0xffffff });
  glow.userData = { additive: true };
  const root = new THREE.Group();
  root.add(mesh(glow));
  shading.shadeCockpit(root);
  const out = root.children[0].material;
  results.additive = {
    kind: out.type, additive: out.blending === THREE.AdditiveBlending,
    depthWrite: out.depthWrite, mark: out.userData.additive === true,
    lit: !!(out.customProgramCacheKey && out.customProgramCacheKey().includes('bf-dynamic-lit')),
  };
}

// 4. A material list (a mesh with two materials) is converted entry by entry.
{
  const shading = pass(AGHEILA);
  const a = new THREE.MeshStandardMaterial();
  const b = new THREE.MeshBasicMaterial();
  const root = new THREE.Group();
  root.add(mesh([a, b]));
  shading.shadeCockpit(root);
  const list = root.children[0].material;
  results.list = { isArray: Array.isArray(list), first: list[0].type, second: list[1] === b };
}

// 5. The level's own numbers drive it: a darker level is darker inside.
{
  const dark = pass({
    lighting: {
      ambient: [0.05, 0.05, 0.05], diffuse: [0.2, 0.2, 0.2], globalAmbient: [0.1, 0.1, 0.1],
      animatedMeshAmbient: [0.15, 0.15, 0.15], animatedMeshDiffuseFactor: 1,
    },
    sunDirection: [0, 1, 0],
  });
  const root = new THREE.Group();
  root.add(mesh(new THREE.MeshStandardMaterial()));
  dark.shadeCockpit(root);
  results.dark = { away: combine(root.children[0].material, [0, 1, 0]).lit };
}

// 6. The real Flettner interior, when the asset tree is on disk: its material
//    declares `envmap true`, and it takes the same pass.
{
  const file = path.join(viewer, 'models', 'mods', 'xpack2', 'Flettner.cockpit.glb');
  if (existsSync(file)) {
    const buf = readFileSync(file);
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const json = JSON.parse(new TextDecoder().decode(buf.subarray(20, 20 + dv.getUint32(12, true))));
    results.flettner = {
      materials: json.materials.length,
      envmap: json.materials.map(m => m.extras?.envmap === true),
      unlitExt: json.materials.map(m => !!m.extensions?.KHR_materials_unlit),
    };
  } else {
    results.flettner = null;
  }
}

process.stdout.write(JSON.stringify(results));
