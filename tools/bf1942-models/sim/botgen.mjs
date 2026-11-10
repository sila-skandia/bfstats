// Generate a bot layer for a level that ships none: retail-format text
// (`AI.con`, `AI/StrategicAreas.con`, and the strategy template's three
// files) written as source under `bot-layers/<mod>/<level>/`, where the
// bake's `ai` layer finds it (`bf42/ai_level.py load_generated_ai`).
//
// Version one, for levels played on foot (features/bot-map-generation,
// sections 4.4 and 9.1): one strategic area per control point, the area's
// second corner on the flag and its first corner the capture radius away,
// sides and `setTakeable` from the flags, the order position on the nearest
// free cell of the infantry map the page paints, neighbours from the routes
// between the areas on that map, and DICE's Stalingrad strategies as the
// template for a level where both sides start with ground of their own.
//
// Deterministic: the same level tree and the same template give the same
// bytes. `generated.json` carries the generator's version and the hashes of
// what it read, and the bake copies it into `scene.json` `ai.generated`.
//
//   node sim/botgen.mjs --map shigaisen_b --mod bf1942 \
//        --maps <maps tree> --models <models tree> [--out <bot-layers root>] [--check]

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { viewerDir, loadViewerModules, seedMathRandom } from './env.mjs';
import { realLevel } from './level.mjs';
import { createStage } from './stage.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const GENERATOR = 'botgen';
export const GENERATOR_VERSION = 2;
export const LAYERS_ROOT = path.resolve(HERE, '..', 'bot-layers');
export const TEMPLATE_FILES = ['Strategies.con', 'conditions.con', 'prerequisites.con'];

/** A route `C` lies on: `A -> C -> B` no more than this much longer than `A -> B`. */
export const ON_THE_WAY = 1.15;
/** How far from a flag its order position may be looked for, metres. */
export const ORDER_SEARCH = 30;
/** The area box's half-width bounds, metres (the flag's capture radius between them). */
export const BOX_MIN = 5, BOX_MAX = 40;
/** A soldier spawn this far above the ground under it, or with no free ground within
 *  `SPAWN_REACH`, is one a bot cannot walk away from. */
export const SPAWN_MAX_LIFT = 8, SPAWN_REACH = 3;
/** A flag this far off the line between the bases, as a share of its length, is a flank. */
export const FLANK_OFFSET = 0.12;

const sha = data => createHash('sha256').update(data).digest('hex');
const r1 = v => (Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, '');
const clean = name => String(name).replace(/[^A-Za-z0-9_]/g, '_');

/** The control points the generator reads, in the level's own order. */
export function flagsOf(extras) {
  return (extras.controlPoints ?? []).map(c => ({
    name: clean(c.name), x: c.position[0], z: c.position[2], y: c.position[1],
    radius: Number.isFinite(c.radius) ? c.radius : 10,
    team: c.team === 1 || c.team === 2 ? c.team : 0,
    fixed: !!c.unableToChangeTeam,
  }));
}

/** The nearest free cell's centre to `(x, z)` within `reach` metres, or null. */
export function nearestFree(nav, isWalkable, x, z, reach = ORDER_SEARCH) {
  if (isWalkable(nav, x, z)) return [x, z];
  const cs = nav.cellSize;
  const cx = Math.floor(x / cs) * cs + cs / 2, cz = -(Math.floor(-z / cs) * cs + cs / 2);
  let best = null, bestD = Infinity;
  const n = Math.ceil(reach / cs);
  for (let dz = -n; dz <= n; dz++) {
    for (let dx = -n; dx <= n; dx++) {
      const px = cx + dx * cs, pz = cz + dz * cs;
      const d = Math.hypot(px - x, pz - z);
      // Ties go to the first cell in scan order, so the answer is one cell.
      if (d < bestD && d <= reach && isWalkable(nav, px, pz)) { best = [px, pz]; bestD = d; }
    }
  }
  return best;
}

function pathLength(points) {
  let d = 0;
  for (let i = 1; i < points.length; i++) d += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  return d;
}

/**
 * The areas of a level: one per control point. `route(a, b)` answers the
 * walking distance between two `[x, z]` points on the infantry map, or
 * Infinity. Pure: the tests hand it a synthetic map.
 */
export function buildAreas(flags, { orderPosition, route, ground = null }) {
  const areas = flags.map(f => {
    const half = Math.min(BOX_MAX, Math.max(BOX_MIN, f.radius));
    const order = orderPosition(f.x, f.z);
    // A capturable flag no soldier can stand inside: no free ground near it,
    // or its pole further above that ground than its own radius reaches.
    const lift = order && ground ? f.y - ground(order[0], order[1]) : 0;
    const unreachable = !f.fixed && (!order || lift > f.radius);
    return { name: f.name, flag: f, half, order, flags: [], neighbours: [], value: 150, unreachable };
  });
  // The line the battle runs along: base to base, else the two sides' own
  // flags, else the two flags furthest apart.
  const centre = side => {
    const own = flags.filter(f => f.team === side && f.fixed);
    const use = own.length ? own : flags.filter(f => f.team === side);
    if (!use.length) return null;
    return [use.reduce((s, f) => s + f.x, 0) / use.length, use.reduce((s, f) => s + f.z, 0) / use.length];
  };
  let a = centre(1), b = centre(2);
  if (!a || !b || Math.hypot(b[0] - a[0], b[1] - a[1]) < 1) {
    let far = 0;
    for (const p of flags) for (const q of flags) {
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d > far) { far = d; a = [p.x, p.z]; b = [q.x, q.z]; }
    }
  }
  const len = a && b ? Math.hypot(b[0] - a[0], b[1] - a[1]) : 0;
  const ux = len ? (b[0] - a[0]) / len : 1, uz = len ? (b[1] - a[1]) / len : 0;
  const mid = a && b ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] : [0, 0];
  let strong = null, strongD = Infinity;
  for (const area of areas) {
    const f = area.flag;
    if (f.fixed) { area.flags.push('Base'); area.value = 50; continue; }
    // Kept so the flag stays bound to an area of its own, and inert: no
    // side may take it, it borders nothing, and no order ever names it.
    if (area.unreachable) { area.value = 10; continue; }
    const off = len ? Math.abs((f.x - a[0]) * -uz + (f.z - a[1]) * ux) / len : 0;
    area.along = len ? ((f.x - a[0]) * ux + (f.z - a[1]) * uz) / len : 0.5;
    area.flags.push(off > FLANK_OFFSET ? 'Flank' : 'Centre');
    if (off <= FLANK_OFFSET) {
      area.value = 200;
      const d = Math.hypot(f.x - mid[0], f.z - mid[1]);
      if (d < strongD) { strongD = d; strong = area; }
    }
  }
  if (strong) { strong.flags.push('StrongPoint'); strong.value = 300; }
  // The capturable area nearest each base is its close approach.
  for (const base of areas.filter(x => x.flag.fixed)) {
    let near = null, nearD = Infinity;
    for (const area of areas) {
      if (area.flag.fixed || area.unreachable) continue;
      const d = Math.hypot(area.flag.x - base.flag.x, area.flag.z - base.flag.z);
      if (d < nearD) { nearD = d; near = area; }
    }
    if (near && !near.flags.includes('Close')) near.flags.push('Close');
  }
  for (const area of areas) if (!area.flag.fixed && !area.unreachable) area.flags.push('ControlPoint');

  // Neighbours: two areas are neighbours when a route joins them and no
  // third area lies on the way.
  const n = areas.length;
  const dist = Array.from({ length: n }, () => new Array(n).fill(Infinity));
  for (let i = 0; i < n; i++) {
    dist[i][i] = 0;
    for (let j = i + 1; j < n; j++) {
      const joined = areas[i].order && areas[j].order && !areas[i].unreachable && !areas[j].unreachable;
      const d = joined ? route(areas[i].order, areas[j].order) : Infinity;
      dist[i][j] = dist[j][i] = d;
    }
  }
  const linked = Array.from({ length: n }, () => new Set());
  const link = (i, j) => { linked[i].add(j); linked[j].add(i); };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (!Number.isFinite(dist[i][j])) continue;
      let between = false;
      for (let k = 0; k < n && !between; k++) {
        if (k === i || k === j) continue;
        between = dist[i][k] + dist[k][j] <= ON_THE_WAY * dist[i][j]
          && Math.max(dist[i][k], dist[k][j]) < dist[i][j];
      }
      if (!between) link(i, j);
    }
  }
  // One graph: join what the rule left apart by the shortest route between the parts.
  const group = areas.map((_, i) => i);
  const find = i => (group[i] === i ? i : (group[i] = find(group[i])));
  for (let i = 0; i < n; i++) for (const j of linked[i]) group[find(i)] = find(j);
  for (;;) {
    let best = null;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      if (find(i) !== find(j) && Number.isFinite(dist[i][j]) && (!best || dist[i][j] < best[2])) best = [i, j, dist[i][j]];
    }
    if (!best) break;
    link(best[0], best[1]);
    group[find(best[0])] = find(best[1]);
  }
  areas.forEach((area, i) => {
    area.neighbours = [...linked[i]].sort((p, q) => p - q).map(j => areas[j].name);
    area.reach = dist[i].map(d => (Number.isFinite(d) ? Math.round(d) : null));
  });
  return areas;
}

/** `AI/StrategicAreas.con`: the engine's frame, z negated from the viewer's. */
export function areasCon(areas) {
  const out = ['rem *** Strategic areas: one per control point (botgen) ***', ''];
  for (const a of areas) {
    const f = a.flag, zE = -f.z;
    out.push(`aiStrategicArea.create ${a.name} ${r1(f.x - a.half)}/${r1(zE - a.half)} ${r1(f.x)}/${r1(zE)} ${a.value}`);
    for (const nb of a.neighbours) out.push(`aiStrategicArea.addNeighbour ${nb}`);
    for (const flag of a.flags) out.push(`aiStrategicArea.addObjectTypeFlag ${flag}`);
    // No order position for a flag nobody can stand in: sending bots to its
    // foot was tried and stuck more of them there (features/bot-map-generation, 15).
    if (a.order && !a.unreachable) out.push(`aiStrategicArea.setOrderPosition Infantry ${r1(a.order[0])}/${r1(-a.order[1])}`);
    if (f.team) out.push(`aiStrategicArea.setSide ${f.team}`);
    if (f.fixed && f.team) out.push(`aiStrategicArea.setTakeable ${f.team === 1 ? 2 : 1} 0`);
    if (a.unreachable) out.push('aiStrategicArea.setTakeable 1 0', 'aiStrategicArea.setTakeable 2 0');
    out.push('');
  }
  return out.join('\r\n');
}

/** `AI.con`: the settings DICE's levels carry, and each side's strategy list. */
export function aiCon({ worldSize, viewDistance, strategies, searchMaps = false }) {
  const lines = [
    'rem *** Bot layer generated by botgen: the level ships none ***', '',
    `aiSettings.setWorldMapSize ${worldSize} ${worldSize}`,
    `aiSettings.setViewDistance ${viewDistance}`,
    'aiSettings.setInformationGridDimension 32', '',
    'ai.init 2', '',
    'AIBotManager.setLodLevelTicks 6 6 6',
    'AIBotManager.setLodLevelPriority 3 3 3',
    'AIBotManager.setPlannedDecisionMakingThreshold 0.5 0.5 0.5',
    'AIBotManager.setUnplannedDecisionMakingThreshold 0.3 0.4 0.4',
    'AIBotManager.setDecisionMakingInterleave 2 2',
    'AIBotManager.setSensingQuotient 1 1',
    'AIBotManager.setSystemQuotient 40 40 20', '',
    'ai.saiMapXDimension 64', 'ai.saiMapYDimension 64', '',
    'ai.createSAI', '',
    'run AI/conditions.con v_arg1', 'run AI/prerequisites.con v_arg1', 'run AI/Strategies.con v_arg1', '',
    ...[1, 2].flatMap(side => [...strategies.map(s => `ai.addSAIStrategy ${side} ${s}`), '']),
    'ai.saiEnable 1', '',
    ...(searchMaps ? ['run AIpathFinding.con v_arg1', ''] : []),
    'run AI/StrategicAreas.con v_arg1', '',
  ];
  return lines.join('\r\n');
}

/** `AIpathFinding.con` for the engine's maps a layer holds (`engine_search_maps.py`): DICE's usual two. */
export function pathFindingCon() {
  return [
    'rem *** Search maps painted by the engine itself (engine_search_maps.py) ***', '',
    'ai.numAStarResources 10', '',
    'ai.addSearchMap Tank0 0 0 25 3.0 0.3 2.5 0', 'ai.addSearchType Tank 0 0', '',
    'ai.addSearchMap Infantry1 0 1.5 30 1.0 0.4 2.0 1', 'ai.addSearchType Infantry 1 0', '',
    'ai.loadMaps', '',
  ].join('\r\n');
}

/** The strategy template: its three files and each side's list, in the template's own order. */
export function readTemplate(name, root = LAYERS_ROOT) {
  const dir = path.join(root, '_templates', name);
  const files = Object.fromEntries(TEMPLATE_FILES.map(f => [f, readFileSync(path.join(dir, f), 'latin1')]));
  const sides = JSON.parse(readFileSync(path.join(dir, 'template.json'), 'utf8'));
  return { name, files, strategies: sides.strategies, source: sides.source };
}

/** Everything a layer's folder holds, as `{ relative path: text }`, and its marker. */
/** The soldier spawns a bot should not be stood on: `[name]`. `free(x, z)` answers whether main walkable ground is within reach. */
export function excludedSpawns(spawns, { free, ground }) {
  return spawns.filter(s => s.position && s.name
    && (!free(s.position[0], s.position[2]) || s.position[1] - ground(s.position[0], s.position[2]) > SPAWN_MAX_LIFT)).map(s => s.name);
}

export function buildLayer({ mod, level, extras, areas, navSha, template, rawFiles = {}, botSpawnsExcluded = [] }) {
  const worldSize = Math.round(extras.worldSize || 1024);
  const viewDistance = Math.round(Math.min(400, Math.max(60, extras.drawDistance || 200)));
  const engineMaps = Object.keys(rawFiles).length > 0;
  const files = {
    'AI.con': aiCon({ worldSize, viewDistance, strategies: template.strategies, searchMaps: engineMaps }),
    ...(engineMaps ? { 'AIpathFinding.con': pathFindingCon() } : {}),
    'AI/StrategicAreas.con': areasCon(areas),
    ...Object.fromEntries(TEMPLATE_FILES.map(f => [`AI/${f}`, template.files[f]])),
  };
  const flags = flagsOf(extras).map(f => [f.name, r1(f.x), r1(f.y), r1(f.z), f.radius, f.team, f.fixed]);
  const marker = {
    generator: GENERATOR, version: GENERATOR_VERSION, mod, level,
    template: template.name, templateSource: template.source,
    scope: engineMaps
      ? 'on foot: the engine\'s own Tank0 and Infantry1 search maps, infantry order positions, no strategic maps, no co-op layer'
      : 'on foot: infantry order positions only, no search maps, no co-op layer',
    unreachable: areas.filter(a => a.unreachable).map(a => a.name),
    botSpawnsExcluded,
    inputs: {
      controlPoints: sha(JSON.stringify(flags)),
      infantryMap: navSha,
      template: sha(TEMPLATE_FILES.map(f => template.files[f]).join('\n')),
    },
    files: {
      ...Object.fromEntries(Object.entries(files).map(([k, v]) => [k, sha(Buffer.from(v, 'latin1'))])),
      ...Object.fromEntries(Object.entries(rawFiles).map(([k, v]) => [k, sha(v)])),
    },
  };
  return { files, marker };
}

/** The engine's own infantry map kept in a layer folder (`engine_search_maps.py`), or null. */
export async function layerInfantryMap(layerDir, viewer = null) {
  const file = layerDir ? path.join(layerDir, 'Pathfinding', 'Infantry1Level0Map.raw') : null;
  if (!file || !existsSync(file)) return null;
  const baked = await import(pathToFileURL(path.join(viewerDir(viewer), 'nav-baked.js')).href);
  const map = baked.decodeSearchMap(new Uint8Array(readFileSync(file)));
  map.params = { name: 'Infantry1', waterMap: false, waterDepth: 1.5, maxSlope: 30, brush: 1.0, lowClip: 0.4, hiClip: 2.0, minLevel: 0, maxLevel: 2 };
  map.mapIndex = 1;
  return map;
}

/**
 * Load a baked level and the infantry map the page's soldiers will walk:
 * the level's own baked map when its tree has one, else the engine's map
 * from `layerDir` when the layer holds one, else the map the referee paints.
 */
export async function loadForBots({ maps, models, map, viewer = null, layerDir = null }) {
  const M = await loadViewerModules(viewerDir(viewer));
  const log = console.log;
  console.log = () => {};
  try {
    seedMathRandom(1);
    const level = await realLevel(M, { maps, models, map });
    const stage = createStage(M, level, { vehicles: false, seed: 1 });
    const world = stage.world;
    const nav = await import(pathToFileURL(path.join(viewerDir(viewer), 'nav-grid.js')).href);
    const worldSize = level.extras.worldSize || 2048;
    const seeds = [];
    for (const flag of world.flags ?? []) {
      for (const spawn of flag.spawns ?? []) if (spawn?.position) seeds.push([spawn.position[0], spawn.position[2]]);
    }
    // `bot-referee.js spawn`'s own call: the map the page's soldiers walk.
    const searchMap = world.collider?.searchMaps?.maps?.length ? null : await layerInfantryMap(layerDir, viewer);
    const grid = nav.buildNavMap(world.collider, worldSize, { waterLevel: world.collider?.waterLevel, seeds, ...(searchMap ? { searchMap } : {}) });
    return { M, level, world, nav, grid, extras: level.extras, worldSize };
  } finally {
    console.log = log;
  }
}

export async function generate({ maps, models, map, mod, out = LAYERS_ROOT, template = 'symmetric', check = false }) {
  const dir = path.join(out, mod.toLowerCase(), map.toLowerCase());
  const { nav, grid, extras, world } = await loadForBots({ maps, models, map, layerDir: dir });
  const rawDir = path.join(dir, 'Pathfinding');
  const rawFiles = existsSync(rawDir)
    ? Object.fromEntries(readdirSync(rawDir).filter(f => /\.raw$/i.test(f)).sort().map(f => [`Pathfinding/${f}`, readFileSync(path.join(rawDir, f))]))
    : {};
  if (extras.ai?.strategicAreas?.length && !extras.ai.generated) {
    throw new Error(`${map} ships its own AI layer; a generated one never replaces it`);
  }
  const flags = flagsOf(extras);
  if (flags.length < 2) throw new Error(`${map} has ${flags.length} control points; nothing to order bots to`);
  const areas = buildAreas(flags, {
    orderPosition: (x, z) => nearestFree(grid, nav.isWalkable, x, z),
    route: (p, q) => {
      const pts = nav.findPath(grid, p[0], p[1], q[0], q[1]);
      return pts ? pathLength(pts) : Infinity;
    },
    ground: (x, z) => world.collider.surfaceHeight(x, z),
  });
  const bits = Buffer.alloc(grid.blocked.length);
  for (let i = 0; i < bits.length; i++) bits[i] = grid.blocked[i] ? 1 : 0;
  const botSpawnsExcluded = excludedSpawns(extras.soldierSpawns ?? [], {
    free: (x, z) => !!nearestFree(grid, nav.isWalkable, x, z, SPAWN_REACH),
    ground: (x, z) => world.collider.surfaceHeight(x, z),
  });
  const layer = buildLayer({ mod, level: map, extras, areas, navSha: sha(bits), template: readTemplate(template, out), rawFiles, botSpawnsExcluded });
  const want = { ...layer.files, 'generated.json': JSON.stringify(layer.marker, null, 1) + '\n' };
  const stale = [];
  for (const [rel, text] of Object.entries(want)) {
    const file = path.join(dir, rel);
    const have = existsSync(file) ? readFileSync(file, 'latin1') : null;
    if (have === text) continue;
    stale.push(rel);
    if (!check) { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text, 'latin1'); }
  }
  return { dir, areas, marker: layer.marker, changed: stale };
}

function parseArgs(argv) {
  const a = { check: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--check') a.check = true;
    else if (k.startsWith('--')) a[k.slice(2)] = argv[++i];
  }
  return a;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = parseArgs(process.argv.slice(2));
  if (!a.map || !a.mod || !a.maps) {
    console.error('usage: node sim/botgen.mjs --map <level dir> --mod <mod folder> --maps <maps tree> [--models <models tree>] [--out <bot-layers root>] [--template symmetric] [--check]');
    process.exit(2);
  }
  const res = await generate({ maps: path.resolve(a.maps), models: a.models ? path.resolve(a.models) : null, map: a.map, mod: a.mod,
                               out: a.out ? path.resolve(a.out) : LAYERS_ROOT, template: a.template ?? 'symmetric', check: a.check });
  for (const area of res.areas) {
    console.log(`${area.name.padEnd(22)} ${(area.unreachable ? 'unreachable on foot, excluded' : area.flags.join(',')).padEnd(34)} value ${String(area.value).padEnd(4)} neighbours ${area.neighbours.join(', ')}`);
  }
  console.log(`${a.check ? 'checked' : 'wrote'} ${res.dir}: ${res.changed.length ? (a.check ? 'STALE ' : '') + res.changed.join(', ') : 'up to date'}`);
  process.exit(a.check && res.changed.length ? 1 : 0);
}
