// The proving ground (features/proving-ground): a level that is no level. A
// white floor two kilometres a side, the firing line at one end, and on it
// every vehicle a chosen battle fields, parked to be taken; down range the
// same vehicles stand as targets, and the enemy's soldiers spawn at the far
// end. The battle lends everything else: its kits (`loadouts.json` is keyed
// by the level's folder), its vehicles' paint and level variants, its damage
// tables and engine sounds. So a Panzerfaust here is the one FHSW's Kursk
// hands its German AT kit, and it flies and hurts as it does there.
//
// Nothing is baked. `provingGroundReport` turns the battle's own `scene.json`
// into the report a level load reads, and `buildProvingGroundScene` builds,
// in memory, the tree a scene glb parses into: terrain tiles (`kind:
// terrain`), a `spawners` group holding the vehicles from the models tree with
// their pad records, and an empty `controlPoints` group. `level-load.js`
// takes both through the same passes a baked level goes through, so a parked
// tank here is an ordinary pad vehicle: enterable, damageable, respawned.
//
// Frame: the glb's (x east, z negative into the map, y up). Down range is -z.
// A spawn's `rotation[0]` is the engine's yaw in degrees and the node's yaw
// about +y is its negative, so yaw 0 faces down range and 180 faces back at
// the firing line.

import * as THREE from 'three';
import { clone as skeletonClone } from './vendor/utils/SkeletonUtils.js';

/** The construct's dimensions, metres. */
export const PG = Object.freeze({
  WORLD: 2048,
  /** The floor's height: well above the sea the engine keeps at 0. */
  FLOOR: 40,
  /** The firing line's z, and its x (the middle of the floor). */
  LINE_Z: -320,
  LINE_X: 1024,
  /** Down-range distances of the target rows, metres from the firing line. */
  ROWS: [100, 250],
  /** Where the enemy's soldiers spawn, metres down range. */
  ENEMY_RANGE: 600,
  /** The neutral flag they walk up the range for, metres down range. */
  CONTEST_RANGE: 200,
  /** The player's spawn points besides the firing line, metres down range:
   *  half way to the first row, ten metres short of it, and ten short of
   *  the second (`features/proving-ground`, "Spawn anywhere"). */
  STATIONS: [50, 90, 240],
  /** Where the enemy's aircraft park, metres down range: the far end's
   *  own airfield, where its soldiers spawn, so a bot can take one. */
  ENEMY_AIR_RANGE: 560,
  /** The silhouette range's lane, x: right of the centre lane, short of
   *  the airfield (`proving-targets.js`). */
  SILHOUETTE_X: 1024 + 90,
  /** Seconds before a destroyed or abandoned pad vehicle stands again. */
  RESPAWN: 6,
  /** Vertex spacing of the floor's lattice. */
  SPACING: 32,
  /** Tiles a side. */
  TILES: 4,
  /** Most vehicles one row holds. */
  ROW_MAX: 14,
  /** Half the combat area's side, metres from the floor's middle. A level
   *  that declares no area is bounded by its terrain (`combat-area.js`
   *  `terrainRect`), here the 2 km floor, and an aircraft is out of it in
   *  fifteen seconds and dead some thirty after; the construct declares a
   *  10 km square instead, the floor repeating out to it, so a dogfight has
   *  room (features/dogfight-school, "Room to fight"). */
  ARENA: 5000,
});

/** The colours the construct is drawn in, linear 0..1. */
export const PG_COLOURS = Object.freeze({
  fog: [0.9, 0.915, 0.925],
  floor: [0.86, 0.875, 0.885],
  minor: [0.78, 0.795, 0.81],
  major: [0.62, 0.65, 0.67],
  range: [0.18, 0.62, 0.42],
});

const lower = s => String(s ?? '').toLowerCase();

/**
 * Every vehicle template the battle's pads can hand out, in the order its
 * spawns name them, each once: both sides' entry of every pad, in every game
 * type the level carries.
 */
export function battleTemplates(report) {
  const seen = new Map();
  const add = name => {
    const key = lower(name);
    if (key && !seen.has(key)) seen.set(key, String(name));
  };
  const lists = [report?.objectSpawns ?? []];
  for (const mode of Object.values(report?.modes ?? {})) lists.push(mode?.objectSpawns ?? []);
  for (const list of lists) {
    for (const spawn of list) {
      const templates = spawn?.templates ?? {};
      const names = Object.keys(templates).length ? Object.values(templates) : [spawn?.vehicle];
      for (const name of names) add(name);
    }
  }
  return [...seen.values()];
}

/**
 * The battle's machines the models catalogue names (`models.json` rows whose
 * `levels` list it): what its pads miss, chiefly the aircraft a carrier's own
 * spawners launch (Coral Sea's Corsairs and Zeros come off the Enterprise and
 * the Shokaku, not off a pad). Ships stay in harbour, the floor has no water;
 * soldiers and hand weapons are not vehicles.
 */
export function catalogueTemplates(rows, level) {
  const want = lower(level);
  const out = [];
  for (const row of rows ?? []) {
    if (!['land', 'air', 'emplacement'].includes(row?.category)) continue;
    if (!(row.levels ?? []).some(l => lower(l) === want)) continue;
    if (!out.some(n => lower(n) === lower(row.name))) out.push(String(row.name));
  }
  return out;
}

/** What a loaded vehicle is, for where it parks: air, sea, or land (a gun is land). */
export function vehicleClass(node) {
  const category = node?.userData?.physics?.vehicleCategory ?? '';
  if (/air/i.test(category)) return 'air';
  if (/sea/i.test(category)) return 'sea';
  return 'land';
}

/** A vehicle's footprint across its row and along it, metres, from its bounds. */
function footprint(node) {
  const box = new THREE.Box3().setFromObject(node);
  if (box.isEmpty()) return { width: 4, length: 6 };
  const size = box.getSize(new THREE.Vector3());
  return { width: Math.max(2, size.x), length: Math.max(2, size.z) };
}

/**
 * Where each vehicle goes. `vehicles` is `[{ template, cls, width }]`; the
 * answer is `[{ template, role, team, x, z, yaw }]` with `yaw` the engine's
 * degrees. The garage is the firing line's row, every land vehicle and gun
 * facing down range, the player's side; the aircraft park on the right, nose
 * down range, with two kilometres of floor to take off over; each target row
 * stands the land vehicles again, facing back, the enemy's side; the enemy's
 * aircraft park at the far end. A ship has no water to float in and is left
 * out.
 */
export function provingGroundLayout(vehicles, { team = 1, rows = PG.ROWS, wingAir = 0 } = {}) {
  const enemy = team === 1 ? 2 : 1;
  const land = vehicles.filter(v => v.cls === 'land').slice(0, PG.ROW_MAX);
  const air = vehicles.filter(v => v.cls === 'air').slice(0, PG.ROW_MAX);
  const out = [];
  const row = (list, z, role, side, yaw, gap, centre) => {
    const widths = list.map(v => Math.max(2, v.width ?? 4) + gap);
    const span = widths.reduce((a, b) => a + b, 0);
    let x = centre - span / 2;
    list.forEach((v, i) => {
      out.push({ template: v.template, role, team: side, x: x + widths[i] / 2, z, yaw });
      x += widths[i];
    });
  };
  // The garage sits a few metres past the line, so a soldier spawned on the
  // line walks straight to it.
  row(land, PG.LINE_Z - 18, 'garage', team, 0, 5, PG.LINE_X - 40);
  row(air, PG.LINE_Z + 10, 'airfield', team, 0, 8, PG.LINE_X + 300);
  // The dogfight school's wingmen (`wingAir`, the pair lesson flown): a row
  // of the player's side's aircraft again behind the airfield for each, so a
  // wingman has a plane of the player's own type to take.
  for (let k = 0; k < wingAir; k++) row(air, PG.LINE_Z + 40 + 30 * k, 'wingAir', team, 0, 8, PG.LINE_X + 300);
  for (const range of rows) row(land, PG.LINE_Z - range, 'target', enemy, 180, 10, PG.LINE_X);
  // The enemy's aircraft at the far end, nose toward the firing line: an
  // enemy pilot's plane to shoot down (a bot spawning there takes one,
  // bot-units.js `candidates`), stood again by its pad when it falls.
  row(air, PG.LINE_Z - PG.ENEMY_AIR_RANGE, 'enemyAir', enemy, 180, 8, PG.LINE_X - 300);
  return out;
}

/**
 * The level report the load reads, from the battle's own: its kits, paint,
 * damage, vehicle sounds and material tables kept, its ground, sky, sea,
 * statics, flags and AI dropped, and the construct's points, spawns and pads
 * written in. `placed` is `provingGroundLayout`'s answer. The round never
 * ends: the tickets do not bleed and the bases cannot change hands.
 */
export function provingGroundReport(source, placed, { team = 1 } = {}) {
  const enemy = team === 1 ? 2 : 1;
  const H = PG.FLOOR;
  const lineZ = PG.LINE_Z;
  const enemyZ = PG.LINE_Z - PG.ENEMY_RANGE;
  const point = (name, side, z, groupId, locked = true, x = PG.LINE_X) => ({
    name, position: [x, H, z], rotation: [0, 0, 0], team: side,
    displayName: name, radius: 20, areaValue: 0, spawnGroupId: groupId,
    secondSpawnGroupId: null, objectSpawnerId: null, unableToChangeTeam: locked,
    timeToGetControl: locked ? 0 : 10, timeToLoseControl: locked ? 0 : 10, disableIfEnemyInsideRadius: false,
    disableWhenLosingControl: false, loseControlWhenEnemyClose: false,
    loseControlWhenNotClose: false, minNrToTakeControl: null, onlyTakeableByTeam: null,
    flagMesh: null, flagHeight: 0, visible: false,
  });
  // The bases cannot change hands, so a lost one never takes the player's
  // spawn; the neutral flag between them, with no spawns of its own, is what
  // brings the enemy's soldiers up the range (the strategic AI goes for the
  // points it can take) and into a rifle's reach.
  // The player's stations down the range are spawn points of his own,
  // locked like the firing line, so the spawn screen's map offers them:
  // a soldier starts where he wants to shoot from. Their spawn groups are
  // numbered past the two sides' (10, 11, 12).
  const stations = PG.STATIONS.map((range, i) => ({
    name: `Range${range}`, z: lineZ - range, group: 10 + i,
  }));
  const points = [
    point('FiringLine', team, lineZ, team),
    ...stations.map(st => ({ ...point(st.name, team, st.z, st.group), displayName: `${st.name.replace('Range', '')} m down range` })),
    // The silhouette range's firing point (`proving-targets.js`), its own
    // spawn group (13).
    { ...point('Silhouettes', team, lineZ, 13, true, PG.SILHOUETTE_X), displayName: 'Silhouette range' },
    point('FarEnd', enemy, enemyZ, enemy),
    point('Contest', 0, lineZ - PG.CONTEST_RANGE, null, false),
  ];
  // Soldiers: the firing line's eight a step behind the garage, facing down
  // range; four at each station, off the lane's centre so a round fired
  // down it meets nobody; the enemy's twelve spread across the far end,
  // facing back.
  const soldierSpawns = [];
  let spawnId = 1;
  for (let i = 0; i < 8; i++) {
    soldierSpawns.push({
      name: `FiringLine_${i + 1}`, position: [PG.LINE_X - 21 + i * 6, H, lineZ + 4],
      rotation: [0, 0, 0], group: team, spawnId: spawnId++, team, paratrooper: false,
    });
  }
  for (const st of stations) {
    for (let i = 0; i < 4; i++) {
      soldierSpawns.push({
        name: `${st.name}_${i + 1}`, position: [PG.LINE_X + 30 + i * 4, H, st.z],
        rotation: [0, 0, 0], group: st.group, spawnId: spawnId++, team, paratrooper: false,
      });
    }
  }
  for (let i = 0; i < 4; i++) {
    soldierSpawns.push({
      name: `Silhouettes_${i + 1}`, position: [PG.SILHOUETTE_X - 6 + i * 4, H, lineZ + 3],
      rotation: [0, 0, 0], group: 13, spawnId: spawnId++, team, paratrooper: false,
    });
  }
  for (let i = 0; i < 12; i++) {
    soldierSpawns.push({
      name: `FarEnd_${i + 1}`, position: [PG.LINE_X - 110 + i * 20, H, enemyZ],
      rotation: [180, 0, 0], group: enemy, spawnId: spawnId++, team: enemy, paratrooper: false,
    });
  }
  const objectSpawns = placed.map((p, i) => ({
    spawner: `pg_${p.role}_${i}`, vehicle: p.template, team: p.team,
    position: [p.x, H, p.z], rotation: [p.yaw, 0, 0],
    minSpawnDelay: PG.RESPAWN, maxSpawnDelay: PG.RESPAWN, spawnDelayAtStart: 0,
    // A garage vehicle left out on the floor goes back to its pad: the
    // engine's abandon clock (`deployables.js` `AbandonClock`), short. A
    // target is never abandoned: it costs nothing to stand away from its
    // pad, so only rounds destroy it.
    timeToLive: p.role === 'target' || p.role === 'enemyAir' ? 0 : 30,
    distance: p.role === 'target' || p.role === 'enemyAir' ? 1e6 : 25,
    damageWhenLost: p.role === 'target' || p.role === 'enemyAir' ? 0 : 100,
    templates: { 1: p.template, 2: p.template },
  }));
  const keep = ['damage', 'materialDiffuse', 'alphaBlend', 'depthWriteOff', 'alphaLodDistance',
                'meshCull', 'collisionGroups', 'envmap', 'envmapTexture'];
  const report = {};
  for (const key of keep) if (source?.[key] !== undefined) report[key] = source[key];
  const tickets = { mode: 'Conquest', team1: 999, team2: 999, lossPerMin: { team1: 0, team2: 0 } };
  Object.assign(report, {
    level: source?.level ?? 'The Range',
    worldSize: PG.WORLD,
    waterLevel: 0,
    fogColor: [...PG_COLOURS.fog],
    fogStart: 500,
    fogEnd: 2400,
    drawDistance: 2400,
    sunDirection: source?.sunDirection ?? [0.4, 0.6, 0.7],
    camera: [PG.LINE_X, H + 6, lineZ + 20],
    combatArea: {
      min: [PG.WORLD / 2 - PG.ARENA, 0, -PG.WORLD / 2 + PG.ARENA],
      max: [PG.WORLD / 2 + PG.ARENA, 0, -PG.WORLD / 2 - PG.ARENA],
    },
    terrain: { tiles: PG.TILES * PG.TILES, triangles: 0, missingTiles: [], detail: false,
               defaultTiles: 0, materials: null },
    objects: { placed: 0, skipped: [], spawners: placed.length, controlPoints: points.length,
               soldierSpawns: soldierSpawns.length },
    skybox: null,
    sky: null,
    water: null,
    lensFlare: null,
    heightmap: null,
    terrainShade: null,
    terrainDetail: null,
    minimap: null,
    // Even and grey: the construct has no time of day, and a vehicle's paint
    // reads as its texture does.
    lighting: {
      ambient: [0.22, 0.22, 0.22], diffuse: [0.42, 0.42, 0.42], globalAmbient: [0.2, 0.2, 0.2],
      shadowColor: 0.5, animatedMeshAmbient: [0.4, 0.4, 0.4], animatedMeshDiffuseFactor: 1.0,
    },
    gameplayMode: 'Conquest',
    controlPoints: points,
    soldierSpawns,
    vehicleSoldierSpawns: [],
    objectSpawns,
    tickets,
    gameTypes: { Conquest: { mode: 'Conquest', tickets } },
    briefing: {
      objectives: 'The Range. Every vehicle this battle fields is parked on the firing '
        + 'line; the same vehicles stand down range at 100 and 250 metres, and the enemy\'s '
        + 'aircraft at the far end. Spawn at any point on the map, or press X on the range to '
        + 'stand where you aim. B opens the arsenal: '
        + 'a faction, a kit, a vehicle. Fire at the targets: each round draws its path and the '
        + 'hit log says what it met and what it cost. H shows the collision mesh, coloured by '
        + 'what your weapon does to each part. The soldiers down range cannot hurt you.',
      mapType: 'The Range',
    },
    sounds: {
      ambient: source?.sounds?.ambient ? { ...source.sounds.ambient, volume: 0.35 } : null,
      areas: [],
      vehicles: source?.sounds?.vehicles ?? [],
      flags: null,
    },
    provingGround: { team, source: source?.level ?? null },
  });
  return report;
}

/** The floor's material: a grid in world space, finer lines every 10 m,
 *  heavier every 50 m, and the range lines counted from the firing line. */
export function floorMaterial() {
  const c = PG_COLOURS;
  const vec = a => new THREE.Vector3(a[0], a[1], a[2]);
  const mat = new THREE.ShaderMaterial({
    name: 'provingGroundFloor',
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uFloor: { value: vec(c.floor) },
        uMinor: { value: vec(c.minor) },
        uMajor: { value: vec(c.major) },
        uRange: { value: vec(c.range) },
        uLineZ: { value: PG.LINE_Z },
        uLineX: { value: PG.LINE_X },
      },
    ]),
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      varying vec3 vWorld;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        vec4 mvPosition = viewMatrix * world;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      uniform vec3 uFloor, uMinor, uMajor, uRange;
      uniform float uLineZ, uLineX;
      varying vec3 vWorld;
      // Coverage of a line every 'period' metres, a pixel or so wide at any
      // distance (fwidth), so the grid neither shimmers nor vanishes.
      float grid(vec2 p, float period, float width) {
        vec2 q = p / period;
        vec2 d = abs(fract(q - 0.5) - 0.5) / fwidth(q);
        return 1.0 - clamp(min(d.x, d.y) - width, 0.0, 1.0);
      }
      void main() {
        vec2 p = vWorld.xz;
        vec3 col = uFloor;
        col = mix(col, uMinor, grid(p, 10.0, 0.0) * 0.6);
        col = mix(col, uMajor, grid(p, 50.0, 0.5) * 0.7);
        // Down range of the line, every 50 m across the whole floor.
        float down = uLineZ - p.y;
        if (down > 1.0) {
          float q = down / 50.0;
          float d = abs(fract(q - 0.5) - 0.5) / fwidth(q);
          col = mix(col, uRange, (1.0 - clamp(d - 1.0, 0.0, 1.0)) * 0.85);
        }
        // The firing line itself, and the lane's centre.
        float line = 1.0 - clamp(abs(p.y - uLineZ) / max(fwidth(p.y), 1e-4) - 2.0, 0.0, 1.0);
        col = mix(col, uRange, line);
        float lane = 1.0 - clamp(abs(p.x - uLineX) / max(fwidth(p.x), 1e-4) - 0.5, 0.0, 1.0);
        col = mix(col, uMajor, lane * step(0.0, down) * 0.8);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  return mat;
}

/** The floor as terrain tiles, `kind: terrain`, their vertices on the
 *  lattice the collider snaps to (`heightfield.js` `buildHeightfield`). */
export function floorTiles(material = floorMaterial()) {
  const size = PG.WORLD / PG.TILES;
  const segments = size / PG.SPACING;
  const tiles = [];
  for (let i = 0; i < PG.TILES; i++) {
    for (let k = 0; k < PG.TILES; k++) {
      const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
      geometry.rotateX(-Math.PI / 2);
      geometry.translate(i * size + size / 2, PG.FLOOR, -(k * size + size / 2));
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `Tx${String(i).padStart(2, '0')}x${String(k).padStart(2, '0')}`;
      // The terrain pass keeps a tile it is told is done (`unlightTerrain`).
      mesh.userData = { kind: 'terrain', unlitTerrain: true };
      tiles.push(mesh);
    }
  }
  return tiles;
}

/**
 * The construct's scene, as `GLTFLoader` would have handed a baked level's:
 * `{ scene, animations }`. `models` maps a lower-case template to its loaded
 * vehicle root (`loadVehicles`); each placement gets its own copy at its pad,
 * named as the bake names a second instance.
 */
export function buildProvingGroundScene(placed, models) {
  const scene = new THREE.Group();
  scene.name = 'ProvingGround';
  for (const tile of floorTiles()) scene.add(tile);
  const spawners = new THREE.Group();
  spawners.name = 'spawners';
  spawners.userData = { kind: 'spawners' };
  const used = new Map();
  for (const p of placed) {
    const source = models.get(lower(p.template));
    if (!source) continue;
    const n = used.get(source) ?? 0;
    used.set(source, n + 1);
    const node = n === 0 ? source : skeletonClone(source);
    if (n > 0) node.name = `${source.name}_${n}`;
    node.position.set(p.x, PG.FLOOR, p.z);
    node.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(-p.yaw));
    node.userData.provingGround = p.role;
    spawners.add(node);
  }
  scene.add(spawners);
  const points = new THREE.Group();
  points.name = 'controlPoints';
  points.userData = { kind: 'controlPoints' };
  scene.add(points);
  scene.updateMatrixWorld(true);
  return { scene, animations: [] };
}

/** Whether a loaded root draws anything: a mesh that is neither a collision
 *  hull nor a baked effect payload. */
export function drawsMesh(root) {
  let found = false;
  root.traverse(obj => {
    if (found || !obj.isMesh) return;
    if (obj.geometry?.userData?.collision || /collision/i.test(obj.name || '') || obj.userData?.effect) return;
    if ((obj.geometry?.attributes?.position?.count ?? 0) > 0) found = true;
  });
  return found;
}

/**
 * The battle's vehicles from the models tree: `load(template)` is the level
 * load's own (its level variant and paint). Resolves to the roots that
 * loaded, by lower-case template, and the list `provingGroundLayout` reads.
 * A template that does not load, or loads as no vehicle, is left out.
 */
export async function loadVehicles(templates, load) {
  const models = new Map();
  const list = [];
  const results = await Promise.all(templates.map(async template => {
    try {
      const gltf = await load(template);
      const root = gltf?.scene?.children?.find(c => c.userData?.templateKind || c.userData?.armor)
        ?? gltf?.scene?.children?.[0] ?? null;
      return { template, root };
    } catch (error) {
      console.warn(`[proving ground] ${template}: ${error?.message ?? error}`);
      return { template, root: null };
    }
  }));
  for (const { template, root } of results) {
    // A vehicle has a body and something to see: FHSW's
    // `ArtyEffectPCOMortar8cm` is a pad's PlayerControlObject with a mass and
    // no mesh, the effect a mortar strike stands, and is no vehicle to park.
    if (!root || !root.userData?.physics || !drawsMesh(root)) continue;
    root.removeFromParent();
    root.position.set(0, 0, 0);
    root.quaternion.identity();
    root.updateMatrixWorld(true);
    models.set(lower(template), root);
    list.push({ template, cls: vehicleClass(root), width: footprint(root).width });
  }
  return { models, list };
}

/**
 * The manifest row `level.show` loads for the proving ground over `source`,
 * the battle's own row: its folder (so its kits and paint answer), the
 * construct's name and loading screen, and `synthetic`, which `level-load.js`
 * asks for the report and then for the scene. `fetchJson(url)` reads the
 * battle's `scene.json`. The vehicles are laid out once they have loaded,
 * because where one parks depends on what it is, and the pads go into the
 * live report (`extras`) then, before anything indexes the scene.
 */
export function provingGroundEntry(source, { mapsBase, bust = () => '', team = 1,
                                             fetchJson = url => fetch(url).then(r => r.json()),
                                             catalogue = async () => [], only = null, wingAir = 0 } = {}) {
  let battle = null;
  let report = null;
  return {
    ...source,
    name: 'The Range',
    loading: { ...(source.loading ?? {}), title: 'THE RANGE' },
    provingGround: true,
    synthetic: {
      async report() {
        battle = await fetchJson(`${mapsBase}/${source.report}${bust()}`);
        report = provingGroundReport(battle, [], { team });
        return report;
      },
      async scene(load, extras, progress = () => {}) {
        const rows = await catalogue().catch(() => []);
        let templates = [...battleTemplates(battle)];
        for (const name of catalogueTemplates(rows, source.name)) {
          if (!templates.some(t => lower(t) === lower(name))) templates.push(name);
        }
        // `only` (a catalogue category, 'air' for the dogfight arena): the
        // battle's vehicles of that kind alone, the rest never loaded.
        if (only) {
          const kind = new Set(rows.filter(r => r?.category === only).map(r => lower(r.name)));
          templates = templates.filter(t => kind.has(lower(t)));
        }
        let done = 0;
        progress(0, templates.length);
        const counted = async template => {
          try { return await load(template); } finally { progress(++done, templates.length); }
        };
        const { models, list } = await loadVehicles(templates, counted);
        const placed = provingGroundLayout(list, { team, wingAir });
        const full = provingGroundReport(battle, placed, { team });
        const minimap = provingGroundMinimap(placed, { team });
        for (const target of new Set([report, extras])) {
          if (!target) continue;
          target.objectSpawns = full.objectSpawns;
          target.objects = full.objects;
          target.provingGround = { ...full.provingGround, placed, vehicles: list };
          if (minimap) target.minimap = minimap;
        }
        return buildProvingGroundScene(placed, models);
      },
    },
  };
}

/**
 * The construct's map, drawn: the floor's grid, the firing line, the range
 * lines every 100 m and a mark per parked vehicle (the player's side green,
 * the targets red), as the `minimap` a level carries, its picture a data URL
 * (`map-surfaces.js` takes `url` before a file). Null where there is no
 * canvas.
 */
export function provingGroundMinimap(placed, { team = 1, size = 512 } = {}) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const W = PG.WORLD;
  const px = x => (x / W) * size;
  const py = z => (z / W + 1) * size;
  ctx.fillStyle = '#d9dee0';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(80, 96, 104, 0.25)';
  ctx.lineWidth = 1;
  for (let m = 0; m <= W; m += 64) {
    ctx.beginPath(); ctx.moveTo(px(m), 0); ctx.lineTo(px(m), size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, px(m)); ctx.lineTo(size, px(m)); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(46, 158, 107, 0.7)';
  ctx.fillStyle = '#2e9e6b';
  ctx.font = '600 11px monospace';
  for (let r = 100; r <= 1500; r += 100) {
    const y = py(PG.LINE_Z - r);
    ctx.beginPath(); ctx.moveTo(px(PG.LINE_X - 400), y); ctx.lineTo(px(PG.LINE_X + 400), y); ctx.stroke();
    ctx.fillText(`${r}`, px(PG.LINE_X - 400) - 26, y + 4);
  }
  ctx.strokeStyle = '#2e9e6b';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(px(PG.LINE_X - 420), py(PG.LINE_Z)); ctx.lineTo(px(PG.LINE_X + 420), py(PG.LINE_Z)); ctx.stroke();
  for (const p of placed) {
    ctx.fillStyle = p.team === team ? '#1f7a52' : '#c0392b';
    ctx.fillRect(px(p.x) - 2.5, py(p.z) - 2.5, 5, 5);
  }
  // The silhouette lane: a tick per plywood man.
  ctx.fillStyle = '#8a6d3b';
  for (const r of [25, 50, 75, 100, 150, 200, 300, 400, 500]) {
    ctx.fillRect(px(PG.SILHOUETTE_X) - 1.5, py(PG.LINE_Z - r) - 1.5, 3, 3);
  }
  // The places, named on the art itself, so the spawn screen's rings and the
  // big map read without a legend: the owner could not tell the firing
  // range's point from the line's.
  const label = (text, x, z, { dx = 8, dy = 4, color = '#1f3b2d', size = 11 } = {}) => {
    ctx.font = `700 ${size}px "Trebuchet MS", "Segoe UI", sans-serif`;
    ctx.textAlign = dx < 0 ? 'right' : 'left';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(232, 236, 236, 0.9)';
    ctx.strokeText(text, px(x) + dx, py(z) + dy);
    ctx.fillStyle = color;
    ctx.fillText(text, px(x) + dx, py(z) + dy);
  };
  // Spread about the dense end of the lane: a metre is a quarter of a pixel
  // here, so a word is three hundred metres long. The line's words to its
  // left, the stations' to the right, the targets' to the left, the range
  // and the airfield below and above the line.
  label('FIRING LINE', PG.LINE_X - 150, PG.LINE_Z + 40, { dx: -4, dy: 4 });
  label('GARAGE', PG.LINE_X - 130, PG.LINE_Z - 18, { dx: -4, dy: -2 });
  label('FIRING RANGE', PG.SILHOUETTE_X, PG.LINE_Z + 70, { dx: -14, dy: 4, color: '#6b4a1a' });
  label('AIRFIELD', PG.LINE_X + 240, PG.LINE_Z - 60, { dx: -4, dy: 0 });
  for (const r of PG.STATIONS) label(`${r} m`, PG.LINE_X + 90, PG.LINE_Z - r, { dx: 4, size: 10 });
  label('TARGETS', PG.LINE_X - 110, PG.LINE_Z - 100, { dx: -4 });
  label('TARGETS', PG.LINE_X - 110, PG.LINE_Z - 250, { dx: -4 });
  label('ENEMY AIRFIELD', PG.LINE_X - 200, PG.LINE_Z - PG.ENEMY_AIR_RANGE - 40, { dx: -4, color: '#8a2b22' });
  label('FAR END', PG.LINE_X + 40, PG.LINE_Z - PG.ENEMY_RANGE, { dx: 6, color: '#8a2b22' });
  return {
    url: canvas.toDataURL('image/png'),
    image: 'proving-ground.png',
    worldToImage: [1 / W, 0, 0, 0, 1 / W, 1],
    pixels: [size, size],
  };
}

// --- the front end's side (play/proving-ground-screen.js) --------------------

/** Each battle's vehicles in a models catalogue (`models.json`): the drivable
 *  and flyable ones whose `levels` name it, by lower-case level. */
export function vehiclesByLevel(rows) {
  const out = new Map();
  for (const row of rows ?? []) {
    if (!['land', 'air', 'sea', 'emplacement'].includes(row?.category)) continue;
    for (const level of row.levels ?? []) {
      const key = String(level).toLowerCase();
      if (!out.has(key)) out.set(key, []);
      const list = out.get(key);
      if (!list.some(v => v.name === row.name)) list.push({ name: row.name, cls: row.category });
    }
  }
  return out;
}

/** The address ENTER opens: the construct over `map`, from `root`. */
export function provingGroundUrl(root, { map, team = 1, soldiers = 0, mod = null, vehicle = null, spawn = null, school = null,
                                          base = globalThis.location?.href }) {
  const url = new URL(`${root}map.html`, base);
  url.searchParams.set('proving', '1');
  url.searchParams.set('map', map);
  url.searchParams.set('team', String(team === 2 ? 2 : 1));
  url.searchParams.set('botCount', String(Math.max(0, soldiers | 0)));
  url.searchParams.set('botSkill', '0.5');
  if (mod) url.searchParams.set('mod', mod);
  // The machine to be seated in as soon as the man stands (`proving-ground-page.js`).
  if (vehicle) url.searchParams.set('vehicle', vehicle);
  // The point to stand up at straight away, no briefing and no spawn screen
  // (map.html, `SPAWN_AT`): a control point's name.
  if (spawn) url.searchParams.set('spawn', spawn);
  // The dogfight school's theatre opens on arrival (a lesson, or '' for the
  // first), features/dogfight-school.
  if (school != null) url.searchParams.set('school', school);
  return url.toString();
}

/** The places THE RANGE tab offers to start at: the control
 *  point's name (`provingGroundReport`) and the words for it. */
export const START_POINTS = Object.freeze([
  { id: 'FiringLine', label: 'Firing line' },
  { id: 'Silhouettes', label: 'Firing range' },
  { id: 'Range90', label: '10 m short of the targets' },
  { id: 'Range240', label: 'The far targets' },
]);
