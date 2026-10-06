// A level's own effects and the objects spawn effects stand up, under node:
// `viewer/effects.js` (the library's level set, the object spawn),
// `viewer/effect-objects.js` (the object's own tier) and
// `viewer/vehicle-wrecks.js` (the death tier in the dying object's frame),
// through the page's own modules and the vendored three.js and GLTFLoader.
//
//   node effect_objects_harness.mjs [<level effects.glb> <tower.json>]
//
// With the two arguments (`test_effect_objects.py` bakes them from the
// install): the glb is a level's `effects.glb` (`extract_effects.py
// --levels`), read the way the page reads it, and the json is
// `{ name, armor }`, a placed objective's `armor` block as the exporter
// writes it. The harness kills that object through `wreckVehicle` and
// reports what its death played, what resolved, and what stood up where.
// Without them, only the synthetic cases run. Prints one JSON object.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { viewerDir, installModuleHooks, routeConsole } = await import(path.join(HERE, '..', 'sim', 'env.mjs'));
const viewer = viewerDir(path.join(HERE, '..', 'viewer'));
installModuleHooks(viewer);
const imp = f => import(pathToFileURL(path.join(viewer, f)).href);
const THREE = await imp('vendor/three.module.js');
const { GLTFLoader } = await imp('vendor/loaders/GLTFLoader.js');
const { EffectLibrary, EffectPlayer } = await imp('effects.js');
const { createEffectObjects } = await imp('effect-objects.js');
const { createVehicleWrecks } = await imp('vehicle-wrecks.js');
const { deathTier } = await imp('vehicle-damage.js');
routeConsole(!process.env.HARNESS_VERBOSE);

const round = v => Math.round(v * 1000) / 1000;
const vec = v => [v.x, v.y, v.z].map(round);

/** A glb with its images, textures and samplers taken out: node decodes none. */
function withoutTextures(file) {
  const buf = readFileSync(file);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const jsonLen = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(buf.subarray(20, 20 + jsonLen)));
  const binAt = 20 + jsonLen;
  const bin = binAt + 8 <= buf.length ? buf.subarray(binAt + 8, binAt + 8 + dv.getUint32(binAt, true)) : null;
  delete json.images; delete json.textures; delete json.samplers;
  for (const m of json.materials ?? []) {
    if (m.pbrMetallicRoughness) delete m.pbrMetallicRoughness.baseColorTexture;
    delete m.normalTexture; delete m.emissiveTexture; delete m.occlusionTexture;
    if (m.extensions) for (const k of Object.keys(m.extensions)) if (k !== 'KHR_materials_unlit') delete m.extensions[k];
  }
  const text = new TextEncoder().encode(JSON.stringify(json));
  const jl = text.length + ((4 - (text.length % 4)) % 4);
  const bl = bin ? bin.length + ((4 - (bin.length % 4)) % 4) : 0;
  const out = new Uint8Array(20 + jl + (bin ? 8 + bl : 0)).fill(0x20, 20 + text.length, 20 + jl);
  const o = new DataView(out.buffer);
  o.setUint32(0, 0x46546c67, true); o.setUint32(4, 2, true); o.setUint32(8, out.length, true);
  o.setUint32(12, jl, true); o.setUint32(16, 0x4e4f534a, true);
  out.set(text, 20);
  if (bin) {
    o.setUint32(20 + jl, bl, true); o.setUint32(24 + jl, 0x004e4942, true);
    out.set(bin, 28 + jl);
  }
  return out.buffer;
}

/** A library holding one synthetic bundle per name, each a single sprite emitter. */
function syntheticLibrary(names) {
  const root = new THREE.Group();
  for (const name of names) {
    const bundle = new THREE.Group();
    bundle.userData = { effectBundle: { name } };
    const emitter = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial());
    emitter.userData = { effectEmitter: {
      template: `em_${name}`, timeToLive: ['n', 0.1, 0, 0], intensity: ['n', 10, 0, 0],
      particle: { kind: 'sprite', template: `fx_${name}`, texture: 't', blend: 'add',
                  timeToLive: ['n', 0.5, 0, 0] },
    } };
    bundle.add(emitter);
    root.add(bundle);
  }
  return new EffectLibrary(root);
}

function wrecksPage(effects) {
  return {
    effects,
    vehicles: { instanceOf: () => null, lastFlightOf: () => null },
    vehicleDamage: new Map(),
    world: { fireStates: new Map(), falling: new Set() },
    collider: null,
    MODELS_BASE: 'models/mods/desertcombat',
    extras: { level: 'DC_No_Fly_Zone' },
    loader: { loadAsync: () => Promise.reject(new Error('no wreck glb under node')) },
    isCollision: node => !!node.userData?.collision,
    bindDynamicShading() {},
    retireVehicleBody() {},
  };
}

/** Kill `node` (armour `armor`) through `wreckVehicle`, playing on `effects`. */
async function kill(effects, node, armor) {
  globalThis.fetch = async () => ({ ok: false, json: async () => null });
  const plays = [];
  const play = effects.play.bind(effects);
  effects.play = (name, opts) => {
    const anchor = opts?.attach?.object;
    let at = null;
    if (anchor) {
      anchor.updateWorldMatrix(true, false);
      const p = new THREE.Vector3(); const q = new THREE.Quaternion();
      anchor.getWorldPosition(p); anchor.getWorldQuaternion(q);
      at = { position: vec(p), forward: vec(new THREE.Vector3(0, 0, -1).applyQuaternion(q)) };
    }
    plays.push({ name, resolved: effects.has(name), attached: !!anchor, at,
                 position: opts?.position ?? null, phase });
    return play(name, opts);
  };
  let phase = 'death';
  const wrecks = createVehicleWrecks(wrecksPage(effects));
  wrecks.damageVisuals.set(7, { node, anchors: new Map(), handles: [], spawnDelay: null });
  // As every caller does it (`vehicle-hits.js`): the death comes with its
  // tier change, then the wreck.
  const vehicle = { owner: 7, effects: armor.effects, killedBy: null };
  const death = deathTier(armor.effects, { inWater: false });
  if (death) wrecks.showDamageTier(vehicle, death);
  await wrecks.wreckVehicle(vehicle);
  phase = 'after';
  for (let i = 0; i < 4; i++) effects.advance(1 / 30);
  effects.play = play;
  return plays;
}

const out = {};

// --- the library's level set ---------------------------------------------
{
  const mod = syntheticLibrary(['e_PanzFire', 'e_ExplGas']);
  const level = syntheticLibrary(['e_ExplGas', 'e_OwnOnly']);
  const before = { own: mod.has('e_ownonly'), names: mod.names.length };
  mod.setLevel(level);
  const during = {
    own: mod.has('E_OwnOnly'),
    shadowed: mod.get('e_explgas') === level.get('e_ExplGas'),
    modOnly: mod.get('e_PanzFire') === mod.bundles.get('e_panzfire'),
    names: mod.names.length,
  };
  mod.setLevel(null);
  out.library = { before, during, after: { own: mod.has('e_OwnOnly'), names: mod.names.length } };
}

// --- a death tier in the dying object's frame ------------------------------
// A Kubelwagen's `e_ExplGas` authored 1.2 m up, and Clacton's two
// `e_ScrapAABase` at two places. The hull stands at (10, 0, 20) turned 90
// degrees: each bundle starts at its offset in the hull's frame, facing the
// hull's own forward, and plays once.
{
  const scene = new THREE.Scene();
  const effects = new EffectPlayer({ scene, camera: new THREE.PerspectiveCamera(),
                                     library: syntheticLibrary(['e_ExplGas', 'e_ScrapAABase']) });
  const node = new THREE.Group();
  node.name = 'Kubelwagen';
  node.position.set(10, 0, 20);
  node.rotation.y = Math.PI / 2;
  scene.add(node);
  out.deathFrame = await kill(effects, node, { effects: [
    { hp: 0, effect: 'e_ExplGas', offset: [0, 1.2, 0] },
    { hp: 0, effect: 'e_ScrapAABase', offset: [6.6, 0.1, -3] },
    { hp: 0, effect: 'e_ScrapAABase', offset: [-4.599, 0.1, -3] },
    { hp: -1, effect: 'WaterWaterExplosion', offset: [0, 0, 0] },
  ] });
  // No death tier at all: the stand-in, once, on the ground's normal.
  const bare = new THREE.Group();
  bare.position.set(-5, 2, 7);
  scene.add(bare);
  out.standIn = await kill(effects, bare, { effects: [{ hp: 20, effect: 'e_PanzFire', offset: [0, 0, 0] }] });
}

// --- No Fly Zone's control tower, from the install -------------------------
const args = process.argv.slice(2);
const flag = name => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
const [glbPath, towerPath] = args.filter(a => !a.startsWith('--'));

// --- a spawned object's body -----------------------------------------------
// A raft shaped like `Elco80Raft`: a 5000 kg PCO hanging four
// `PTRaft_Floater`s (hullHeight 0.2, lift 6) at the corners of a 3.4 x 9 m
// hull. Water at 0, the sea bed 20 m down. The float law's rest for it is
// root y = +0.068 (`equilibriumRootY`); it is stood up 0.47 m under, where an
// `Elco80` afloat puts it. The same raft without the bit stays where it was
// stood; on dry land it falls to the ground.
const { equilibriumRootY, floatNodesOf } = await imp('body-float.js');

function syntheticRaft({ mobile = true } = {}) {
  const raft = new THREE.Group();
  raft.name = 'Elco80Raft';
  raft.userData = { templateKind: 'PlayerControlObject',
                    physics: { mass: 5000, drag: 0.999, vehicleCategory: 'VCSea' },
                    armor: { hitpoints: 35, maxHitpoints: 35, criticalDamage: 10, hasArmor: true,
                             damageFromWater: true, hpLostWhileDamageFromWater: 0.5 } };
  const hull = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.8, 9), new THREE.MeshBasicMaterial());
  hull.position.y = 0.1;
  raft.add(hull);
  raft.add(collisionBox(3.4, 0.8, 9, 0.1, 45));
  for (const [x, z] of [[1.7, 4.499], [-1.699, 4.499], [1.7, -4.5], [-1.699, -4.5]]) {
    const float = new THREE.Object3D();
    float.userData = { templateKind: 'FloatingBundle',
                       physics: { hullHeight: 0.2, floatMaxLift: 6, floatMinLift: 6, sinkingSpeedMod: 0 } };
    float.position.set(x, 0.05, z);
    raft.add(float);
  }
  const emitter = new THREE.Object3D();
  emitter.userData = { effectEmitter: {
    template: 'Em_PTBoatSpawnRaft', timeToLive: ['n', 1, 0, 0], intensity: ['n', 1, 0, 0],
    particle: { kind: 'object', template: 'Elco80Raft', hasMobilePhysics: mobile },
  } };
  emitter.add(raft);
  const bundle = new THREE.Group();
  bundle.userData = { effectBundle: { name: 'e_PTBoatWreck' } };
  bundle.add(emitter);
  const root = new THREE.Group();
  root.add(bundle);
  return new EffectLibrary(root);
}

/** Play `name` at `at`, then tick the bodies `ticks` times; the object's y
 *  at a few moments, and where it ends. */
function settle(library, at, { water = 0, ground = -20, ticks = 150 } = {}) {
  const scene = new THREE.Scene();
  let effects = null;
  const objects = createEffectObjects({
    get effects() { return effects; },
    isCollision: () => false,
    bindDynamicShading() {},
    collider: { waterLevel: water, heightfield: { height: () => ground } },
  });
  effects = new EffectPlayer({ scene, camera: new THREE.PerspectiveCamera(), library,
                               onObject: (object, spec) => objects.adopt(object, spec) });
  effects.play('e_PTBoatWreck', { position: at, normal: [0, 1, 0] });
  effects.advance(1 / 30);
  const [record] = objects.held;
  if (!record) return { held: 0 };
  const trace = [];
  for (let t = 1; t <= ticks; t++) {
    objects.step({ ticks: 1 });
    if ([1, 5, 10, 15, 30, 60, ticks].includes(t)) trace.push([t, round(record.object.position.y)]);
  }
  const floats = floatNodesOf(record.object);
  let hulls = 0;
  record.object.traverse(node => { if (node.isMesh && node.userData?.collision) hulls++; });
  return {
    held: objects.held.length, kind: record.kind, hulls, floats: floats.length,
    start: at[1], trace, end: round(record.object.position.y),
    rest: Number.isFinite(water) ? round(equilibriumRootY(floats, water)) : null,
    level: round(new THREE.Vector3(0, 1, 0).applyQuaternion(record.object.quaternion).y),
  };
}

out.raft = {
  float: settle(syntheticRaft(), [40, -0.47, -60]),
  dropped: settle(syntheticRaft(), [40, 4.4, -60]),
  immobile: settle(syntheticRaft({ mobile: false }), [40, -0.47, -60]),
  dryLand: settle(syntheticRaft(), [40, 12, -60], { ground: 3 }),
  noWater: settle(syntheticRaft(), [40, 12, -60], { water: null, ground: 3 }),
};

// --- the spawned object is part of the world -------------------------------
// A level of one static (a 200 m ground slab, owner 0) and the real collider,
// damage set and wreck module. A ruin shaped like `air_control_tower_des_wreck`
// (999999 hit points, burning at 1000000, a 10 x 20 x 10 m hull, static) is
// stood up at (30, 0, -30), and the raft above at (-30, -0.47, 30) over water
// at 0. Then: a boot coming down, a round fired along the ground and one
// fired down onto where the raft floats now, and a hit's hit points.
const { WorldCollider } = await imp('world-collider.js');
const { buildCollisionIndex } = await imp('static-index.js');
const { VehicleDamageSet } = await imp('vehicle-damage.js');

function collisionBox(sx, sy, sz, y, material) {
  const geometry = new THREE.BoxGeometry(sx, sy, sz);
  geometry.userData = { collision: true, defenseMaterial: material };
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  mesh.position.y = y;
  mesh.userData = { collision: true };
  return mesh;
}

function syntheticRuin() {
  const ruin = new THREE.Group();
  ruin.name = 'air_control_tower_des_wreck';
  ruin.userData = { templateKind: 'PlayerControlObject', armor: {
    hitpoints: 999999, maxHitpoints: 999999, hasArmor: true, splashMaterial: 51,
    effects: [{ hp: 1000000, effect: 'e_PanzFire', offset: [-18.498, 3.3, -9.998] }],
  } };
  ruin.add(collisionBox(10, 20, 10, 10, 51));
  const emitter = new THREE.Object3D();
  emitter.userData = { effectEmitter: {
    template: 'Em_air_control_tower_desWRECKPCO', timeToLive: ['n', 1, 0, 0], intensity: ['n', 1, 0, 0],
    particle: { kind: 'object', template: 'air_control_tower_des_wreck', hasMobilePhysics: false },
  } };
  emitter.add(ruin);
  const bundle = new THREE.Group();
  bundle.userData = { effectBundle: { name: 'e_air_control_tower_desWRECKPCO' } };
  bundle.add(emitter);
  return bundle;
}

{
  const scene = new THREE.Scene();
  const ground = new THREE.Group();
  ground.name = 'ground_slab';
  ground.add(collisionBox(200, 1, 200, -1.5, 30));
  scene.add(ground);
  scene.updateMatrixWorld(true);
  const statics = buildCollisionIndex(scene, { ownerRoots: [ground] });
  const collider = new WorldCollider({ statics, waterLevel: 0 });
  const damage = new VehicleDamageSet();
  const world = {
    fireStates: new Map(), falling: new Set(), positions: new Map(), nodeOwners: new Map(),
    addDamageable(owner, node, armor, { name = null, position = null } = {}) {
      this.nodeOwners.set(node, owner);
      const vehicle = damage.add(owner, armor, { name });
      if (vehicle && position) this.positions.set(owner, position);
      return vehicle;
    },
  };
  const library = syntheticRaft();
  library.root.add(syntheticRuin());
  const both = new EffectLibrary(library.root);
  let effects = null;
  const wrecks = createVehicleWrecks({ ...wrecksPage(null), get effects() { return effects; },
                                       world, vehicleDamage: damage, collider });
  const roundState = { over: false };
  const objects = createEffectObjects({
    get effects() { return effects; },
    isCollision: node => !!node.userData?.collision,
    bindDynamicShading() {},
    collider, world,
    registerDamageable: (owner, node, opts) => wrecks.registerDamageable(owner, node, opts),
    unregisterDamageable: owner => wrecks.unregisterDamageable(owner),
    get roundOver() { return roundState.over; },
  });
  effects = new EffectPlayer({ scene, camera: new THREE.PerspectiveCamera(), library: both,
                               onObject: (object, spec) => objects.adopt(object, spec) });
  const trisBefore = statics.count;
  effects.play('e_air_control_tower_desWRECKPCO', { position: [30, 0, -30], normal: [0, 1, 0] });
  effects.play('e_PTBoatWreck', { position: [-30, -0.47, 30], normal: [0, 1, 0] });
  effects.advance(1 / 30);
  const ruinRecord = objects.held.find(r => r.object.name === 'air_control_tower_des_wreck');
  const raftRecord = objects.held.find(r => r.object.name === 'Elco80Raft');
  for (let t = 0; t < 90; t++) objects.step({ ticks: 1 });
  const boot = collider.sweepSphere(30, 30, -30, 0, -1, 0, 40, 0.4);
  const rifle = collider.cast(-20, 10, -30, 1, 0, 0, 100);
  const rifleHit = rifle ? { owner: rifle.owner, x: round(rifle.x), material: rifle.material } : null;
  const raftTop = collider.cast(-30, 10, 30, 0, -1, 0, 20);
  const shot = damage.applyHit({ owner: ruinRecord.owner, damage: 50, point: [25, 10, -30] });
  // The damage system's first pass shows the ruin's own tier.
  const changes = damage.update(1 / 30, {});
  const plays = [];
  const play = effects.play.bind(effects);
  effects.play = (name, opts) => { plays.push(name); return play(name, opts); };
  for (const change of changes) if (change.changed) wrecks.showDamageTier(change.vehicle, change.tier);
  effects.play = play;
  out.world = {
    owners: { ruin: ruinRecord.owner, raft: raftRecord.owner },
    kinds: { ruin: ruinRecord.kind, raft: raftRecord.kind },
    trisAdded: statics.count - trisBefore,
    ownerNodes: statics.ownerNodes.map(n => n.name),
    boot: boot ? { owner: boot.owner, y: round(boot.y) } : null,
    round: rifleHit,
    raftTop: raftTop ? { owner: raftTop.owner, y: round(raftTop.y) } : null,
    raftY: round(raftRecord.object.position.y),
    raftPosition: world.positions.get(raftRecord.owner)?.map(round) ?? null,
    hit: shot ? { lost: shot.lost, hp: shot.vehicle.hitPoints } : null,
    damageables: [...damage.byOwner.keys()].sort(),
    tierPlays: plays,
    startedByAdopt: objects.tiers,
    visuals: [...wrecks.damageVisuals.entries()].map(([owner, v]) => ({ owner, spawned: v.spawned,
                                                                         spawnDelay: v.spawnDelay })),
  };

  // --- what removes them ---------------------------------------------------
  // The raft sinks: a killing hit, then the damage pass and the wreck clock
  // as `vehicle-hits.js` runs them, for ten seconds. Its template's
  // `timeToLiveAfterDeath 0` takes it on the next tick. The ruin, which
  // writes none and is not hurt, is still standing after ten minutes; the
  // round's end takes it.
  globalThis.fetch = async () => ({ ok: false, json: async () => null });
  raftRecord.object.userData.armor.timeToLiveAfterDeath = 0;
  damage.applyHit({ owner: raftRecord.owner, damage: 100 });
  const removal = {};
  for (let t = 0; t < 300; t++) {
    for (const change of damage.update(1 / 30, {})) {
      if (change.changed) wrecks.showDamageTier(change.vehicle, change.tier);
      if (change.died) await wrecks.wreckVehicle(change.vehicle);
    }
    wrecks.stepWrecks(1 / 30);
    objects.step({ ticks: 1 });
  }
  const sunk = collider.cast(-30, 10, 30, 0, -1, 0, 20);
  removal.raftHeld = objects.held.includes(raftRecord);
  removal.raftInScene = !!raftRecord.object.parent;
  removal.raftHit = sunk ? sunk.kind : null;
  removal.raftDamageable = damage.byOwner.has(raftRecord.owner);
  removal.objectsAfterRaft = effects.objects.map(o => o.name);
  for (let t = 0; t < 30 * 600; t++) objects.step({ ticks: 1 });
  removal.ruinAfterTenMinutes = !!ruinRecord.object.parent;
  roundState.over = true;
  objects.step({ ticks: 1 });
  removal.afterRoundEnd = {
    held: objects.held.length, objects: effects.objects.length,
    ruinInScene: !!ruinRecord.object.parent, removed: objects.removed,
    ruinSolid: collider.cast(-20, 10, -30, 1, 0, 0, 100)?.owner ?? null,
    damageables: [...damage.byOwner.keys()],
  };
  out.removal = removal;
}

// The raft the bake made (`--raft=<effects.glb>`: `test_effect_objects.py`
// bakes vanilla's `e_PTBoatWreck` from the install).
const raftGlb = flag('raft');
if (raftGlb) {
  const gltf = await new Promise((resolve, reject) =>
    new GLTFLoader().parse(withoutTextures(raftGlb), '', resolve, reject));
  out.bakedRaft = settle(new EffectLibrary(gltf.scene), [40, -0.47, -60]);
}

if (glbPath && towerPath) {
  const gltf = await new Promise((resolve, reject) =>
    new GLTFLoader().parse(withoutTextures(glbPath), '', resolve, reject));
  const level = new EffectLibrary(gltf.scene);
  const mod = syntheticLibrary(['e_PanzFire', 'e_DefGunDamage']);
  mod.setLevel(level);
  const scene = new THREE.Scene();
  const tierPlays = [];
  let effects = null;
  const objects = createEffectObjects({
    get effects() { return effects; },
    isCollision: node => !!node.userData?.collision,
    bindDynamicShading() {},
  });
  effects = new EffectPlayer({ scene, camera: new THREE.PerspectiveCamera(), library: mod,
                               onObject: object => objects.adopt(object) });
  const tower = JSON.parse(readFileSync(towerPath, 'utf8'));
  const node = new THREE.Group();
  node.name = tower.name;
  node.userData = { armor: tower.armor };
  node.position.set(-120, 31.5, 640);
  node.rotation.y = 0.6;
  scene.add(node);
  node.updateMatrixWorld(true);
  const plays = await kill(effects, node, tower.armor);
  const spawned = effects.objects.map(object => {
    let meshes = 0;
    object.traverse(o => { if (o.isMesh && !o.userData?.collision) meshes++; });
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(object.quaternion);
    const towerFwd = new THREE.Vector3(0, 0, -1).applyQuaternion(node.quaternion);
    return {
      name: object.name, kind: object.userData?.templateKind ?? null,
      spawnedBy: object.userData?.spawnedBy ?? null,
      position: vec(object.position), meshes,
      headingError: round(fwd.angleTo(towerFwd)),
      inScene: object.parent === scene,
    };
  });
  out.tower = {
    levelBundles: level.names.sort(),
    deathPlays: plays.filter(p => p.phase === 'death')
      .map(p => ({ name: p.name, resolved: p.resolved, attached: p.attached })),
    spawned,
    // What the ruin's own Armor shows from its first tick (effect-objects.js).
    ruinTier: plays.filter(p => p.phase === 'after').map(p => p.name).sort(),
    adopted: objects.adopted,
    stats: effects.stats(),
  };
  effects.clear();
  out.tower.afterClear = { objects: effects.objects.length, inScene: scene.children.filter(c => c !== effects.root && c !== node).length };
}

process.stdout.write(JSON.stringify(out));
