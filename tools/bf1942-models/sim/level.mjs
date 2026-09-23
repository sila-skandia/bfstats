// The two levels the runner can play: the synthetic harness level (built in
// memory, no assets) and a real extracted level (`viewer/maps/<map>/scene.json`
// + `scene.glb`).
//
// A real level is loaded the way `map.html` loads it, minus the renderer:
//
//  * `scene.glb` goes through the viewer's own `vendor/loaders/GLTFLoader.js`
//    with its images, textures and samplers stripped from the JSON chunk (node
//    has no image decoder). What comes back is the page's scene graph: the
//    same node names (GLTFLoader's sanitised, uniquified names), the same
//    `userData` from each node's extras, the same geometry.
//  * The collider is `map.html buildCollider`'s: `buildHeightfield` over the
//    `userData.kind === 'terrain'` meshes (`collectTerrain`), the owner roots
//    are the scene's top-level children with the spawner group's children
//    listed one by one, `buildCollisionIndex` + `buildDrivableMask`, and a
//    `WorldCollider` with the level's `waterLevel`.
//  * Departures, labelled SIM: the spawner group (the placed vehicles) is
//    left out of the static index, because the page settles those hulls
//    (`settlePlacedVehicles` / `floatPlacedVehicles`) and hands them to the
//    body world, which the nav map then skips (`statics._body`); the sim has
//    no body world, so it drops them up front. Ship deck spawns are not
//    rebased (`rebaseDeckSpawns`): a level whose soldiers spawn on a moving
//    deck is out of scope.
//  * The level's kits come from `_shared/loadouts.json` (`levels[map][team]
//    .slots`, the page's `botKitFor`), each weapon's fire data from its model
//    glb's `extras.weapon` (the page's `botWeaponData`), and a round's damage
//    from `damage.json` (`botRoundDamage`).

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// The synthetic harness level
// ---------------------------------------------------------------------------

/** The harness's frame: x in [0, 256], z in [-256, 0], flat ground at y = 0.
 *  Its two flags (`tests/bot_ai_harness.mjs` HOME / ENEMY) are kept where the
 *  harness put them, with a neutral flag between them and an uncapturable
 *  base behind each so a side that loses both flags still has somewhere to
 *  spawn (`World.spawnPlayer` would otherwise put the bot on an enemy flag
 *  and flip its team). The harness's sandbag line lies across the Allied
 *  approach and its mirror across the Axis one. */
export const SYNTHETIC = {
  worldSize: 256,
  home: [100, 0, -100],
  middle: [100, 0, -160],
  enemy: [100, 0, -220],
  alliedBase: [100, 0, -30],
  axisBase: [100, 0, -244],
};

/** Vanilla values copied from `_shared/loadouts.json` `aiWeapons` and the
 *  weapon glbs' `extras.weapon` (2026-09-23), so the synthetic level needs no
 *  assets. `damage` is `damage.json` material damage x the soldier's modifier
 *  (`botRoundDamage`): K98 5 x 10, Thompson 5 x 3, Colt 5 x 3.5. */
const SYNTHETIC_WEAPONS = {
  K98: {
    ai: { aiTemplate: 'K98AI', burst: 0, deviation: 5.0, deviationCorrectionTime: 10.0, minRange: 0, maxRange: 200,
          weaponFire: 'PIFire', strength: { Infantry: 4, LightArmour: 0, HeavyArmour: 0, NavalArmour: 0, Submarine: 0, Air: 1 },
          soundSphereRadius: 150, healing: false },
    fire: { roundOfFire: 0.37, velocity: 1000, projectile: 'k98Projectile', magazine: { size: 5, magazines: 5, reloadTime: 1.6 },
            deviation: { min: 0.25, fire: [0, 0, 0], mod: [1.0, 0.7, 0.5], speed: [1.5, 0.4, 0.4, 0.1], misc: [2.5, 2.5, 0.1] } },
    damage: 50,
  },
  Thompson: {
    ai: { aiTemplate: 'ThompsonSMG', burst: 1, deviation: 5.0, deviationCorrectionTime: 10.0, minRange: 0, maxRange: 100,
          weaponFire: 'PIFire', strength: { Infantry: 4, LightArmour: 0, HeavyArmour: 0, NavalArmour: 0, Submarine: 0, Air: 0 },
          soundSphereRadius: 100, healing: false },
    fire: { roundOfFire: 10, velocity: 1000, projectile: 'ThomsonProjectile', magazine: { size: 30, magazines: 5, reloadTime: 4.8 },
            deviation: { min: 0.4, fire: [2.0, 0.35, 0.06], mod: [1.2, 1.05, 0.9], speed: [0.8, 0.2, 0.2, 0.1], misc: [2.5, 2.5, 0.1] } },
    damage: 15,
  },
  Colt: {
    ai: { aiTemplate: 'ColtAI', burst: 0, deviation: 5.0, deviationCorrectionTime: 10.0, minRange: 0, maxRange: 60,
          weaponFire: 'PIFire', strength: { Infantry: 2, LightArmour: 0, HeavyArmour: 0, NavalArmour: 0, Submarine: 0, Air: 0 },
          soundSphereRadius: 80, healing: false },
    fire: { roundOfFire: 6, velocity: 400, projectile: 'coltProjectile', magazine: { size: 8, magazines: 4, reloadTime: 4.0 },
            deviation: { min: 0.2, fire: [2.5, 1.5, 0.07], speed: [1.5, 0.2, 0.2, 0.1], misc: [2.5, 2.5, 0.1] } },
    damage: 17.5,
  },
  MedPack: {
    ai: { aiTemplate: 'MedPackAI', burst: 0, deviation: 5.0, deviationCorrectionTime: 10.0, minRange: 0, maxRange: 2.5,
          weaponFire: 'PIFire', strength: { Infantry: 2, LightArmour: 0, HeavyArmour: 0, NavalArmour: 0, Submarine: 0, Air: 0 },
          soundSphereRadius: null, healing: true },
    fire: { roundOfFire: 10, velocity: null, projectile: null, magazine: { size: 1800, magazines: 1, reloadTime: 1.5 }, deviation: null },
    damage: 0,
  },
};

/** Three kits a side (a rifleman, an SMG, a medic), primary first. */
const SYNTHETIC_KITS = {
  Rifleman: { primary: 'K98', items: ['K98', 'Colt'] },
  Assault: { primary: 'Thompson', items: ['Thompson', 'Colt'] },
  Medic: { primary: 'Thompson', items: ['Thompson', 'Colt', 'MedPack'] },
};

/** `vehicle-ai.json` records for the two vehicle types the synthetic level
 *  parks (copied 2026-09-23). */
const SYNTHETIC_VEHICLE_AI = {
  Willy: { aiTemplate: 'Willy', aiWeapons: {}, class: 'Land', maxSpeed: 25, turnRadius: 5, strType: 'LightArmour',
           strategicStrength: { 0: 1, 1: 0 },
           seatsAi: { Willy: { aiWeapons: {}, secondary: false, strategicStrength: { 0: 1, 1: 0 } },
                      WillyPassengerPCO: { aiWeapons: {}, secondary: true, strategicStrength: { 0: 1, 1: 0 } } } },
  Sherman: { aiTemplate: 'Sherman', class: 'Land', maxSpeed: 16, turnRadius: 5, strType: 'HeavyArmour',
             strategicStrength: { 0: 3, 1: 3 },
             aiWeapons: { ShermanMainGun: { burst: 0, maxRange: 250, minRange: 2, weaponFire: 'PIFire',
               strength: { Air: 1, HeavyArmour: 2, Infantry: 10, LightArmour: 7, NavalArmour: 0, Submarine: 0 } } },
             seatsAi: {
               Sherman: { secondary: false, strategicStrength: { 0: 3, 1: 3 }, aiWeapons: {
                 Coaxial_BrowningAI: { burst: 1, maxRange: 250, minRange: 5, weaponFire: 'PIAltFire',
                   strength: { Air: 1, HeavyArmour: 0, Infantry: 12, LightArmour: 5, NavalArmour: 0, Submarine: 0 } },
                 ShermanMainGun: { burst: 0, maxRange: 250, minRange: 2, weaponFire: 'PIFire',
                   strength: { Air: 1, HeavyArmour: 2, Infantry: 10, LightArmour: 7, NavalArmour: 0, Submarine: 0 } } } },
               shermanBrowning_PCO1: { secondary: true, strategicStrength: { 0: 1, 1: 1 }, aiWeapons: {
                 Browning: { burst: 1, maxRange: 250, minRange: 1, weaponFire: 'PIFire',
                   strength: { Air: 3, HeavyArmour: 0, Infantry: 8, LightArmour: 3, NavalArmour: 0, Submarine: 0 } } } } } },
};

function box(x0, x1, y0, y1, z0, z1) {
  const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
             [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  const q = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [0, 3, 7, 4]];
  const out = [];
  for (const [a, b, c, d] of q) out.push(...v[a], ...v[b], ...v[c], ...v[a], ...v[c], ...v[d]);
  return out;
}

function area(name, centre, half, radius, flags, neighbours, side, takeable = {}) {
  return {
    name, min: [centre[0] - half, centre[2] - half], max: [centre[0] + half, centre[2] + half], radius,
    neighbours, flags, orderPositions: { Infantery: [centre[0], centre[2]], Tank: [centre[0], centre[2]], Car: [centre[0], centre[2]] },
    allowedVehicleGroups: [], side, vehicleSearchRadius: null, takeable,
  };
}

/** The synthetic level: extras, collider, kits and weapon data. */
export function syntheticLevel(M, { vehicles = true } = {}) {
  const S = SYNTHETIC;
  const spawnsAround = (centre, group, team, n, name) => Array.from({ length: n }, (_, i) => ({
    name: `${name}${i + 1}`, group, team, spawnId: i, paratrooper: false,
    position: [centre[0] - 6 + 6 * i, 0, centre[2] + (team === 2 ? 4 : -4)],
    rotation: [team === 2 ? 180 : 0, 0, 0],
  }));
  const cp = (name, pos, team, group, radius, ttgc, uncapturable) => ({
    name, displayName: name, position: pos, rotation: [0, 0, 0], team, radius, areaValue: radius,
    spawnGroupId: group, secondSpawnGroupId: null, unableToChangeTeam: uncapturable, timeToGetControl: ttgc,
  });
  const extras = {
    level: 'Synthetic_Harness',
    worldSize: S.worldSize,
    waterLevel: null,
    gameplayMode: 'Conquest',
    tickets: { mode: 'Conquest', team1: 100, team2: 100, lossPerMin: { team1: 5, team2: 5 } },
    controlPoints: [
      cp('AlliedBase', S.alliedBase, 2, 10, 5, 9999, true),
      cp('Home', S.home, 2, 1, 10, 10, false),
      cp('Middle', S.middle, 0, 3, 10, 10, false),
      cp('Enemy', S.enemy, 1, 2, 10, 10, false),
      cp('AxisBase', S.axisBase, 1, 20, 5, 9999, true),
    ],
    soldierSpawns: [
      ...spawnsAround(S.alliedBase, 10, 2, 3, 'AlliedBaseSpawn'),
      ...spawnsAround(S.home, 1, 2, 2, 'HomeSpawn'),
      ...spawnsAround(S.middle, 3, 0, 2, 'MiddleSpawn'),
      ...spawnsAround(S.enemy, 2, 1, 2, 'EnemySpawn'),
      ...spawnsAround(S.axisBase, 20, 1, 3, 'AxisBaseSpawn'),
    ],
    objectSpawns: vehicles ? [
      { spawner: 'ScoutCarSpawner', vehicle: 'Willy', team: 2, position: [120, 0, -34], rotation: [180, 0, 0], minSpawnDelay: 10, maxSpawnDelay: 30 },
      { spawner: 'lighttankSpawner', vehicle: 'Sherman', team: 2, position: [80, 0, -36], rotation: [180, 0, 0], minSpawnDelay: 40, maxSpawnDelay: 80 },
      { spawner: 'ScoutCarSpawner', vehicle: 'Willy', team: 1, position: [120, 0, -238], rotation: [0, 0, 0], minSpawnDelay: 10, maxSpawnDelay: 30 },
      { spawner: 'lighttankSpawner', vehicle: 'Sherman', team: 1, position: [80, 0, -236], rotation: [0, 0, 0], minSpawnDelay: 40, maxSpawnDelay: 80 },
    ] : [],
    ai: {
      settings: { viewDistance: 300, worldMapSize: [S.worldSize, S.worldSize] },
      strategicAreas: [
        area('AlliedBase', S.alliedBase, 20, 20, ['Base'], ['Home'], 2, { 1: false }),
        area('Home', S.home, 20, 20, ['ControlPoint', 'North'], ['AlliedBase', 'Middle'], null),
        area('Middle', S.middle, 20, 20, ['ControlPoint', 'Centre'], ['Home', 'Enemy'], null),
        area('Enemy', S.enemy, 20, 20, ['ControlPoint', 'South'], ['Middle', 'AxisBase'], null),
        area('AxisBase', S.axisBase, 10, 10, ['Base'], ['Enemy'], 1, { 2: false }),
      ],
      conditions: [],
      prerequisites: [],
      strategies: [
        { name: 'push', aggression: 0.8, attacks: 1, defences: 1, timeLimit: 300, prerequisite: null,
          modifiers: [{ flag: 'ControlPoint', factor: 2.0, owner: null }, { flag: 'Centre', factor: 2.0, owner: 'Neutral' }] },
        { name: 'hold', aggression: 0.4, attacks: 1, defences: 1, timeLimit: 300, prerequisite: null,
          modifiers: [{ flag: 'ControlPoint', factor: 2.0, owner: 'Owned' }] },
      ],
      sideStrategies: { 1: ['push', 'hold'], 2: ['push', 'hold'] },
      searchMaps: [
        { name: 'Tank0', waterMap: false, waterDepth: 0, maxSlope: 30, brush: 3, lowClip: 0.3, hiClip: 2.5 },
        { name: 'Infantry1', waterMap: false, waterDepth: 1.5, maxSlope: 30, brush: 1, lowClip: 0.4, hiClip: 2.0 },
      ],
      coverValues: { sandbag_wall_north: 5, sandbag_wall_south: 5 },
    },
  };

  // The collider: a flat heightfield at y = 0 on a 4 m lattice, and the two
  // sandbag lines as collision meshes through the viewer's own index.
  const { THREE } = M;
  const dim = S.worldSize / 4;
  const heightfield = new M.Heightfield(dim, 4, new Float32Array((dim + 1) * (dim + 1)));
  const root = new THREE.Group();
  const wall = (name, tris) => {
    const g = new THREE.Group();
    g.name = name;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tris), 3));
    geo.userData = { collision: true, defenseMaterial: 0 };
    const mesh = new THREE.Mesh(geo);
    mesh.name = `${name} collision 0`;
    mesh.userData = { collision: true };
    g.add(mesh);
    root.add(g);
  };
  wall('Sandbag_Wall_North', box(80, 120, 0, 1.0, -110.3, -109.7));
  wall('Sandbag_Wall_South', box(80, 120, 0, 1.0, -210.3, -209.7));
  root.updateMatrixWorld(true);
  const statics = M.buildCollisionIndex(root, { ownerRoots: [...root.children] });
  const collider = new M.WorldCollider({ heightfield, statics, waterLevel: null, drivableMask: null });

  const weaponFire = new Map(Object.entries(SYNTHETIC_WEAPONS).map(([k, v]) => [k, v.fire]));
  const damageOf = new Map(Object.entries(SYNTHETIC_WEAPONS).map(([k, v]) => [k, v.damage]));
  const kitNames = Object.keys(SYNTHETIC_KITS);
  return {
    name: 'synthetic',
    extras,
    collider,
    kits: {
      /** The page's `botKitFor`: uniform among the side's kits. */
      kitFor(team, index) {
        const kitName = kitNames[Math.floor(Math.random() * kitNames.length)];
        const kit = SYNTHETIC_KITS[kitName];
        const weapons = kit.items.map(item => ({ ...SYNTHETIC_WEAPONS[item].ai, name: item }));
        return { name: kitName, primary: kit.primary, weapons };
      },
      maxHp: () => 30,
    },
    weaponFire: (name) => weaponFire.get(name) ?? null,
    roundDamage: (fire) => {
      for (const [k, v] of weaponFire) if (v === fire) return damageOf.get(k);
      return 30;
    },
    vehicleAi: (template) => SYNTHETIC_VEHICLE_AI[template] ?? SYNTHETIC_VEHICLE_AI[
      Object.keys(SYNTHETIC_VEHICLE_AI).find(k => k.toLowerCase() === String(template).toLowerCase())] ?? null,
    info: { source: 'synthetic harness level (in memory)', statics: statics?.count ?? 0 },
  };
}

// ---------------------------------------------------------------------------
// A real extracted level
// ---------------------------------------------------------------------------

/** Read a glb's JSON and BIN chunks. */
function readGlb(file) {
  const buf = readFileSync(file);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error(`${file}: not a glb`);
  const jsonLen = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(buf.subarray(20, 20 + jsonLen)));
  const binAt = 20 + jsonLen;
  const bin = binAt + 8 <= buf.length ? buf.subarray(binAt + 8, binAt + 8 + dv.getUint32(binAt, true)) : null;
  return { json, bin };
}

/** A glb's document `extras`, JSON chunk only (the page's `botWeaponData`). */
function glbExtras(file) {
  const buf = readFileSync(file);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (buf.length < 20 || dv.getUint32(0, true) !== 0x46546c67 || dv.getUint32(16, true) !== 0x4e4f534a) return null;
  const len = dv.getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(buf.subarray(20, 20 + len)))?.extras ?? null;
}

/** Rebuild a glb with no images, textures or samplers (node decodes none). */
function stripTextures({ json, bin }) {
  delete json.images; delete json.textures; delete json.samplers;
  for (const m of json.materials ?? []) {
    const p = m.pbrMetallicRoughness;
    if (p) { delete p.baseColorTexture; delete p.metallicRoughnessTexture; }
    delete m.normalTexture; delete m.emissiveTexture; delete m.occlusionTexture;
    if (m.extensions) for (const k of Object.keys(m.extensions)) if (k !== 'KHR_materials_unlit') delete m.extensions[k];
  }
  const text = new TextEncoder().encode(JSON.stringify(json));
  const pad = (4 - (text.length % 4)) % 4;
  const jl = text.length + pad;
  const binLen = bin ? bin.length : 0;
  const binPad = (4 - (binLen % 4)) % 4;
  const total = 12 + 8 + jl + (bin ? 8 + binLen + binPad : 0);
  const out = new Uint8Array(total);
  const o = new DataView(out.buffer);
  o.setUint32(0, 0x46546c67, true); o.setUint32(4, 2, true); o.setUint32(8, total, true);
  o.setUint32(12, jl, true); o.setUint32(16, 0x4e4f534a, true);
  out.set(text, 20);
  for (let i = 0; i < pad; i++) out[20 + text.length + i] = 0x20;
  if (bin) {
    o.setUint32(20 + jl, binLen + binPad, true); o.setUint32(24 + jl, 0x004e4942, true);
    out.set(bin, 28 + jl);
  }
  return out.buffer;
}

/** Load a real level. `maps` is the maps tree (`viewer/maps`), `models` the
 *  models tree (`viewer/models`), `map` the level's directory name. */
export async function realLevel(M, { maps, models, map }) {
  const dir = path.join(maps, map);
  const sceneJson = path.join(dir, 'scene.json');
  const sceneGlb = path.join(dir, 'scene.glb');
  if (!existsSync(sceneJson)) throw new Error(`${sceneJson} not found (pass --maps <viewer/maps>)`);
  const extras = JSON.parse(readFileSync(sceneJson, 'utf8'));
  const started = performance.now();

  let collider = null, statics = null, root = null;
  if (existsSync(sceneGlb)) {
    const GLTFLoader = await M.loadGltfLoader();
    const data = stripTextures(readGlb(sceneGlb));
    const gltf = await new Promise((resolve, reject) => new GLTFLoader().parse(data, '', resolve, reject));
    root = gltf.scene;
    root.updateMatrixWorld(true);
    // `collectTerrain`: every mesh the exporter tagged `kind: terrain`.
    const terrain = [];
    let spawners = null;
    root.traverse(o => {
      if (o.isMesh && o.userData?.kind === 'terrain') terrain.push(o);
      if (o.userData?.kind === 'spawners' && !spawners) spawners = o;
    });
    const heightfield = M.buildHeightfield(terrain, {
      worldSize: extras.worldSize || 0, dim: extras.terrain?.materials?.dim || 0,
    });
    // SIM: the placed vehicles are not statics here (see the header).
    if (spawners?.parent) spawners.parent.remove(spawners);
    const ownerRoots = [...root.children];
    statics = M.buildCollisionIndex(root, { ownerRoots });
    const drivableMask = M.buildDrivableMask(root);
    collider = new M.WorldCollider({ heightfield, statics, waterLevel: extras.waterLevel, drivableMask });
  }

  // Kits: `loadouts.levels[map][team].slots` -> `kits[name].items` ->
  // `aiWeapons[item]` (the page's `botKitFor`).
  const loadoutsFile = path.join(maps, '_shared', 'loadouts.json');
  const loadouts = existsSync(loadoutsFile) ? JSON.parse(readFileSync(loadoutsFile, 'utf8')) : null;
  const levelKits = loadouts?.levels?.[map] ?? loadouts?.levels?.[map.toLowerCase()] ?? null;
  const kitFor = (team, index) => {
    const slots = levelKits?.[team]?.slots;
    const names = (Array.isArray(slots) ? slots : Object.values(slots ?? {})).filter(Boolean);
    if (!names.length) return null;
    const kitName = names[Math.floor(Math.random() * names.length)];
    const kit = loadouts?.kits?.[kitName];
    if (!kit) return null;
    const items = [...(kit.items ?? [])];
    if (kit.primary) items.sort((a, b) => (a === kit.primary ? -1 : 0) - (b === kit.primary ? -1 : 0));
    const weapons = items.map(item => {
      const ai = loadouts?.aiWeapons?.[item];
      return ai ? { ...ai, name: item } : null;
    }).filter(Boolean);
    return { name: kitName, primary: kit.primary ?? items[0] ?? null, weapons };
  };
  const maxHp = (kitName) => {
    const hp = loadouts?.kits?.[kitName]?.maxHitpoints;
    return Number.isFinite(hp) ? hp : 30;
  };

  // Weapon fire data from the model glbs, matched case-insensitively.
  const modelIndex = new Map();
  if (models && existsSync(models)) {
    for (const f of readdirSync(models)) if (f.endsWith('.glb')) modelIndex.set(f.slice(0, -4).toLowerCase(), path.join(models, f));
  }
  const fireCache = new Map();
  const weaponFire = (name) => {
    if (!name) return null;
    if (fireCache.has(name)) return fireCache.get(name);
    const file = modelIndex.get(String(name).toLowerCase());
    let fire = null;
    try { fire = file ? (glbExtras(file)?.weapon ?? null) : null; } catch { fire = null; }
    fireCache.set(name, fire);
    return fire;
  };

  // `botRoundDamage`: the projectile's material damage x the soldier's
  // modifier (material 40), 30 until a projectile resolves.
  const damageFile = path.join(maps, 'damage.json');
  const damage = existsSync(damageFile) ? JSON.parse(readFileSync(damageFile, 'utf8')) : null;
  const roundDamage = (fire) => {
    const proj = fire?.projectile ? damage?.projectiles?.[String(fire.projectile).toLowerCase()] : null;
    const attacker = Number.isFinite(proj?.material) ? proj.material : null;
    const mat = attacker !== null ? damage?.materials?.[attacker] : null;
    const base = mat?.damage ?? 30;
    const attGroup = mat?.attGroup ?? attacker;
    const defGroup = damage?.materials?.[40]?.defGroup ?? 40;
    const mod = damage?.modifiers?.[attGroup]?.[defGroup] ?? null;
    return base * (mod === null ? 1 : mod);
  };

  const vehicleFile = path.join(maps, '_shared', 'vehicle-ai.json');
  const vehicleJson = existsSync(vehicleFile) ? JSON.parse(readFileSync(vehicleFile, 'utf8')) : null;
  const vehicleByName = new Map(Object.entries(vehicleJson?.vehicles ?? {}).map(([k, v]) => [k.toLowerCase(), { name: k, ...v }]));

  return {
    name: map,
    extras,
    collider,
    kits: { kitFor, maxHp },
    weaponFire,
    roundDamage,
    vehicleAi: (template) => vehicleByName.get(String(template).toLowerCase()) ?? null,
    info: {
      source: `${dir}`,
      loadMs: Math.round(performance.now() - started),
      statics: statics?.count ?? 0,
      heightfield: !!collider?.heightfield,
      kits: !!levelKits,
      models: modelIndex.size,
      damage: !!damage,
    },
  };
}
