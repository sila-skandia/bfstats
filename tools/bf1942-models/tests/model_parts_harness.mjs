// Drives `viewer/model-parts-index.js` outside a browser and prints one JSON
// blob for `test_model_parts.py`. The module imports nothing; the scene graph
// here is plain objects shaped the way GLTFLoader builds the Fletcher's
// (node extras in `userData`, primitive extras in `geometry.userData`).

import { BUILDER, buildPartIndex, builderDuration, builderProgress, chainOf, describePart, describeRig,
         materialNumber, partsWithArmour, popProgress, popVector, searchParts, subtreeOf, templateOf,
         textureLabel } from './model-parts-index.js';

let nextId = 0;
function node(name, userData = {}, children = []) {
  const n = { uid: nextId++, name, userData, children, parent: null, visible: true };
  for (const c of children) c.parent = n;
  return n;
}
function mesh(name, { tris = 10, material = null, collision = null, userData = {} } = {}) {
  const geometry = { index: { count: tris * 3 }, attributes: {}, userData: collision ? { collision: true, defenseMaterial: collision } : {} };
  const m = node(name, userData);
  m.isMesh = true;
  m.geometry = geometry;
  m.material = material ? [material].flat() : { name: 'defense material', visible: true };
  if (!Array.isArray(material) && material) m.material = material;
  return m;
}
const mat = (name, texture) => ({ name, visible: true, map: texture ? { name: texture } : null });

// Fletcher, cut down: PCO -> Lod -> hull bundle (a Group of primitives) with a
// turret and its barrel, the barrel's gun with a muzzle flash, collision on
// both, a ladder with two armour materials, and a template placed twice.
const hullPrims = [
  mesh('FletcherComplex_1', { tris: 300, material: mat('Fletch_hull_M1_Material7', 'texture/Fle_base2_Z.dds') }),
  mesh('FletcherComplex_2', { tris: 100, material: mat('Fletch_hull_M1_Material23', 'texture/Fle_Wall1_Z.dds') }),
];
const flash = node('e_MuzzDefGun', { templateKind: 'EffectBundle' }, [
  mesh('Em_MuzzDefGun_Flare', { tris: 2, material: mat('fx e_muz1_I', 'texture/e_muz1_I.dds') }),
]);
const gun = node('fletcher_GunBarrel', { templateKind: 'FireArms', control: 'Fletcher',
  fireArms: { projectile: { template: 'FletcherProjectile', kind: 'shell' }, roundOfFire: 0.2, velocity: 160 } }, [flash]);
const barrelCollision = node('Fletcher_cannon_barrel_collision_0', { collision: true, sourceTemplate: 'Fletcher_cannon_barrel' });
const barrelCollisionMesh = mesh('Fletcher_cannon_barrel_collision_0m', { tris: 4, collision: 59 });
barrelCollision.children.push(barrelCollisionMesh); barrelCollisionMesh.parent = barrelCollision;
const barrelMesh = mesh('Fletcher_cannon_barrel_m', { tris: 20, material: mat('Fletch_hull_M1_Material7', 'texture/Fle_base2_Z.dds') });
const barrel = node('Fletcher_cannon_barrel', { templateKind: 'RotationalBundle', geometry: 'Fletch_canonbar_m1', control: 'Fletcher',
  rig: { axes: { pitch: { input: 'c_PIMouseLookY', min: -60, max: 10, driver: 'position', maxSpeed: 45 } }, automaticReset: false } },
  [barrelMesh, gun, barrelCollision]);
const turretCollision = mesh('Fletcher_cannon_collision_0', { tris: 10, collision: 57, userData: { collision: true } });
const turretPrims = [
  mesh('Fletcher_cannon_p0', { tris: 80, material: mat('Fletch_hull_M1_Material7', 'texture/Fle_base2_Z.dds') }),
  mesh('Fletcher_cannon_p1', { tris: 24, material: mat('Fletch_hull_M1_Material13', 'texture/Fle_black_Z.dds') }),
];
const turret = node('Fletcher_cannon', { templateKind: 'RotationalBundle', geometry: 'Fletch_canon_m1', control: 'Fletcher',
  rig: { axes: { yaw: { input: 'c_PIMouseLookX', min: -120, max: 120, driver: 'position', maxSpeed: 45 } } } },
  [...turretPrims, barrel, turretCollision]);
const turret2 = node('Fletcher_cannon_1', { templateKind: 'RotationalBundle', geometry: 'Fletch_canon_m1', control: 'Fletcher' },
  [mesh('Fletcher_cannon_1_p0', { tris: 80, material: mat('Fletch_hull_M1_Material7', 'texture/Fle_base2_Z.dds') }),
   mesh('Fletcher_cannon_1_collision_0', { tris: 10, collision: 57 })]);
const radar = node('Fletcher_Radar', { templateKind: 'RotationalBundle', geometry: 'fletch_radar_m1' },
  [mesh('Fletcher_Radar_m', { tris: 40, material: mat('Fletch_hull_M1_Material12', 'texture/Fle_radar.dds') })]);
const ladder = node('ShipLadder03', { templateKind: 'SimpleObject', geometry: 'shipladder03_m1' }, [
  mesh('ShipLadder03_collision_a', { tris: 6, collision: 85 }),
  mesh('ShipLadder03_collision_b', { tris: 6, collision: 195 }),
]);   // collision only: no render mesh
const entry = node('Fletcher_Entry', { templateKind: 'EntryPoint', seat: { control: 'Fletcher', entryRadius: 6 } });
const hidden = node('lodHidden', { templateKind: 'Bundle', geometry: 'hidden_m1' }, [mesh('hidden_m', { tris: 5, material: mat('hidden_Material1', null) })]);
hidden.visible = false;
const hull = node('FletcherComplex', { templateKind: 'Bundle', geometry: 'Fletch_hull_M1' },
  [...hullPrims, radar, turret, turret2, ladder, entry]);
const lod = node('lodFletcher', { templateKind: 'LodObject' }, [hull, hidden]);
const root = node('Fletcher', { templateKind: 'PlayerControlObject', control: 'Fletcher' }, [lod]);

const index = buildPartIndex(root);
const byName = Object.fromEntries(index.parts.map(p => [p.name, p]));
const brief = p => p && {
  name: p.name, label: p.label, copy: p.copy, kind: p.kind, depth: p.depth, geometry: p.geometry,
  meshes: p.meshes.map(m => m.name), collisionMeshes: p.collisionMeshes.map(m => m.name),
  triangles: p.triangles, collisionTriangles: p.collisionTriangles,
  renderMaterials: p.renderMaterials.map(m => ({ name: m.name, number: m.number, texture: m.texture })),
  armour: p.armour, children: p.children.map(c => c.name), parent: p.parent?.name ?? null, shown: p.shown,
};

const mapping = {};
for (const [m, part] of index.partOfMesh) mapping[m.name] = part.name;

const search = q => searchParts(index, q).map(g => ({ kind: g.kind, label: g.label, title: g.title, parts: g.parts.map(p => p.name) }));

const results = {
  partNames: index.parts.map(p => p.name),
  parts: Object.fromEntries(index.parts.map(p => [p.name, brief(p)])),
  mapping,
  flashMapped: index.partOfMesh.has(flash.children[0]),
  templateOf: {
    barrelCollisionMesh: templateOf(barrelCollisionMesh)?.name,
    flashMesh: templateOf(flash.children[0])?.name,
    hullPrim: templateOf(hullPrims[0])?.name,
  },
  chain: chainOf(byName.Fletcher_cannon_barrel).map(p => p.name),
  subtree: subtreeOf(byName.Fletcher_cannon).map(p => p.name),
  search: {
    armour57: search('57'),
    n23: search('23'),
    n7: search('7'),
    mesh: search('canonbar'),
    texture: search('fle_black'),
    template: search('radar'),
    collisionOnly: search('85'),
    none: search('zzz'),
    blank: search('  '),
  },
  withArmour57: partsWithArmour(index, 57).map(p => p.name),
  describe: {
    turret: describePart(byName.Fletcher_cannon),
    radar: describePart(byName.Fletcher_Radar, { animatedParts: ['Fletcher_Radar continuous yaw 30 deg/s'] }),
    gun: describePart(byName.fletcher_GunBarrel),
    entry: describePart(byName.Fletcher_Entry),
    rate: describeRig({ axes: { roll: { input: 'c_PIThrottle', driver: 'rate', maxSpeed: 5000 } } }),
    springs: describeRig({ axes: { pitch: { input: 'c_PIYaw', min: -25, max: 25, driver: 'position', maxSpeed: 15 } }, automaticReset: true }),
  },
  materialNumber: [materialNumber('Fletch_hull_M1_Material7'), materialNumber('defense material 56'), materialNumber('x_Material23')],
  textureLabel: [textureLabel('texture/Fle_base2_Z.dds'), textureLabel('Fle_black_Z')],
  pop: {
    side: popVector([0, 0, 0], [10, 0, 0], 100),
    centre: popVector([0, 0, 0], [0.1, 0, 0], 100),
    lengths: [popVector([0, 0, 0], [3, 4, 0], 100).reduce((a, v) => a + v * v, 0) ** 0.5,
              popVector([0, 0, 0], [3, 4, 0], 100, 0.1).reduce((a, v) => a + v * v, 0) ** 0.5],
  },
  popProgress: [popProgress(0), popProgress(0.45), popProgress(10), popProgress(0, false), popProgress(10, false)],
  builder: {
    timing: BUILDER,
    duration3: builderDuration(3),
    root: [0, 0.5, 2, 5].map(t => builderProgress(0, 3, t)),
    depth1: [0, 0.3, 0.6, 1.5, builderDuration(3)].map(t => builderProgress(1, 3, t)),
    depth3Start: builderProgress(3, 3, 2 * BUILDER.stagger - 0.01),
    depth3Out: builderProgress(3, 3, 2 * BUILDER.stagger + BUILDER.fly + 0.01),
    end: [1, 2, 3].map(d => builderProgress(d, 3, builderDuration(3))),
  },
};
console.log(JSON.stringify(results));
