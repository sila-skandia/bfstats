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
// between the areas on that map, and DICE's Kharkov strategies as the
// template for a level where both sides start with ground of their own.
//
// Version three adds the walk test (`walkflood.mjs`): the layer's own
// infantry map has the cells of a walked way opened where a spawn or a flag
// sits in a pocket of it, a level whose floor the engine's map does not hold
// gets a map painted from the walked ground, a flag is reachable when a
// soldier on walkable ground stands inside its 3D radius, and bots are kept
// off the spawns with no way to the main ground. Each rule that departs from
// the retail engine is labelled INVENTION where it is written.
// Version four adds the route probe (`routeprobe.mjs`): a flag neither
// side's bots can finish a route to on the layer's own map, by the page's
// own route code, is excluded as an unreachable one is.
//
// Version five chooses the strategy template by the capturable flags left in
// play (`templateFor`): DICE's Kursk for a few, Kharkov's for more.
//
// Deterministic: the same level tree and the same template give the same
// bytes. `generated.json` carries the generator's version and the hashes of
// what it read, and the bake copies it into `scene.json` `ai.generated`.
//
//   node sim/botgen.mjs --map shigaisen_b --mod bf1942 \
//        --maps <maps tree> --models <models tree> [--out <bot-layers root>] [--check]

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { viewerDir, loadViewerModules, seedMathRandom } from './env.mjs';
import { realLevel } from './level.mjs';
import { createStage } from './stage.mjs';
import { STOREY, MAP_COVER, components, paintGround, soldierBody, walkFacts, walkedGround, wayOut } from './walkflood.mjs';
import { CHOKE_MAX, probeLevel, probeTools, wayStop } from './routeprobe.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const GENERATOR = 'botgen';
export const GENERATOR_VERSION = 5;
export const LAYERS_ROOT = path.resolve(HERE, '..', 'bot-layers');
export const TEMPLATE_FILES = ['Strategies.con', 'conditions.con', 'prerequisites.con'];

/**
 * The strategy template by the capturable flags left in play: a flag a side
 * can take that neither the walk test nor the route probe took out. Up to
 * `FEW_FLAGS`, DICE's Kursk (`_templates/few`); above, Kharkov's
 * (`_templates/symmetric`). Kharkov's opening strategy on the page is
 * `bridge` (its `normal` is gated on `Enemy UnitConstant 1`, a state the page
 * never fills), which posts half a side to defend while it holds a single
 * flag; with few flags in play a side holds a single flag, its own base, for
 * most of a match. Kursk attacks with all of a side and posts no defender
 * while the enemy holds one flag or fewer (features/bot-map-generation, 19).
 * INVENTION: the rule and its threshold are this tool's, measured on the
 * levels of section 19; DICE chose per level by hand.
 */
export const FEW_FLAGS = 3;
export const TEMPLATE_FEW = 'few', TEMPLATE_MANY = 'symmetric';
export function templateFor(areas) {
  const inPlay = areas.filter(a => !a.flag.fixed && !a.unreachable).length;
  return { name: inPlay <= FEW_FLAGS ? TEMPLATE_FEW : TEMPLATE_MANY, inPlay,
           rule: `${inPlay} capturable flag${inPlay === 1 ? '' : 's'} in play, ${inPlay <= FEW_FLAGS ? 'at most' : 'more than'} ${FEW_FLAGS}` };
}

/** A route `C` lies on: `A -> C -> B` no more than this much longer than `A -> B`. */
export const ON_THE_WAY = 1.15;
/** How far from a flag its order position may be looked for, metres. */
export const ORDER_SEARCH = 30;
/** The same for a hull's, on the land vehicles' map, whose brush keeps it off every wall. */
export const VEHICLE_ORDER_SEARCH = 40;
/** The area box's half-width bounds, metres (the flag's capture radius between them). */
export const BOX_MIN = 5, BOX_MAX = 40;
/** A flag this far off the line between the bases, as a share of its length, is a flank. */
export const FLANK_OFFSET = 0.12;

/** The layer's map the walk test edits: DICE's infantry map. */
export const WALK_MAP = 'Infantry1';
/** The land vehicles' map (`pathFindingCon`), and its `ai.addSearchMap` parameters as the page's painter takes them. */
export const VEHICLE_MAP = 'Tank0';
export const VEHICLE_MAP_PARAMS = { waterDepth: 0, maxSlopeDeg: 25, brush: 3.0, lowClip: 0.3, hiClip: 2.5 };
/** The brushes a painted land vehicles' map is tried at, DICE's first (`paintedVehicleMap`), metres. */
export const VEHICLE_BRUSHES = [3.0, 2.5, 2.0, 1.5];
/** Where a layer whose map is painted from the walk test keeps the engine's own level 0: the next run decides
 *  again from it, and no bake reads it (a bake asks for `Pathfinding/<name>Level<L>Map.raw` by name). */
export const ENGINE_COPY = `Pathfinding/engine/${WALK_MAP}Level0Map.raw`;
/** How far a way out of a pocket is looked for, metres, and the most standing places one search may hold. */
export const WAY_REACH = 150, WAY_CELLS = 2000000;

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
export function buildAreas(flags, { orderPosition, route, ground = null, reach = null, vehicleOrder = null }) {
  const areas = flags.map(f => {
    const half = Math.min(BOX_MAX, Math.max(BOX_MIN, f.radius));
    // `reach(flag)` is the walk test's answer (`flagReach`): where a soldier
    // on walkable ground stands inside the ring, or that none can.
    const walked = reach ? reach(f) : null;
    const order = walked ? walked.order : orderPosition(f.x, f.z);
    // A capturable flag no soldier can stand inside: no free ground near it,
    // or its pole further above that ground than its own radius reaches.
    const lift = order && ground ? f.y - ground(order[0], order[1]) : 0;
    const unreachable = !f.fixed && (walked ? walked.unreachable : (!order || lift > f.radius));
    // Where a hull ordered to the area is sent: the free cell of the land vehicles' map nearest the flag
    // (`vehicleOrder`), when the level places any. An area out of play has none, as it has no infantry one.
    const tankOrder = vehicleOrder && !unreachable ? vehicleOrder(f.x, f.z) : null;
    return { name: f.name, flag: f, half, order, tankOrder, flags: [], neighbours: [], value: 150, unreachable };
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
    // The land vehicles' first, as DICE's files have it. Without one a hull ordered to a flag inside a hut is
    // sent to the flag itself (`AIStrategicArea::getOrderPos` falls back to the area's p2).
    if (a.tankOrder && !a.unreachable) out.push(`aiStrategicArea.setOrderPosition Tank ${r1(a.tankOrder[0])}/${r1(-a.tankOrder[1])}`);
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
export function pathFindingCon(painted = false, brush = VEHICLE_MAP_PARAMS.brush) {
  return [
    painted ? 'rem *** Search maps painted from the level as baked (sim/botgen.mjs): the walk test and the page painter ***'
      : 'rem *** Search maps painted by the engine itself (engine_search_maps.py) ***', '',
    'ai.numAStarResources 10', '',
    `ai.addSearchMap Tank0 0 0 25 ${brush.toFixed(1)} 0.3 2.5 0`, 'ai.addSearchType Tank 0 0', '',
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

/** Everything a layer's folder holds, as `{ relative path: text }`, and its marker: `buildLayer`, below the walk test's rules. */
/** The soldier spawns of a level as the walk test takes them: `[{ name, x, y, z, side }]`, the side its flag starts with. */
export function spawnsOf(extras) {
  const side = new Map((extras.controlPoints ?? []).map(c => [c.spawnGroupId, c.team === 1 || c.team === 2 ? c.team : 0]));
  return (extras.soldierSpawns ?? []).filter(s => s.position && s.name)
    .map(s => ({ name: s.name, x: s.position[0], y: s.position[1], z: s.position[2], side: side.get(s.group) ?? 0 }));
}

/**
 * The walk test's answer for one flag (`walkflood.mjs walkFacts`'s row):
 * the order position and whether bots are kept off it. A flag is out when no
 * soldier on walkable ground stands inside its 3D radius, or when the place
 * that does is a storey over another walked floor: a route on a one-floor
 * map cannot tell the two floors apart (INVENTION; shigaisen_B's windmill).
 */
export function flagReach(fact, fallback = null) {
  let order = fallback;
  if (fact.stand) {
    // The flag's own nearest free cell when a soldier there is inside the ring, else the cell of the place that is.
    const flat = Math.sqrt(Math.max(0, fact.radius ** 2 - (fact.stand[2] - fact.y) ** 2));
    const near = fallback && Math.hypot(fallback[0] - fact.x, fallback[1] - fact.z) <= flat;
    order = near ? fallback : [Math.floor(fact.stand[0]) + 0.5, -(Math.floor(-fact.stand[1]) + 0.5)];
  }
  return { order, unreachable: !fact.reachable || fact.over >= STOREY };
}

/**
 * The route probe over the generator's areas (`routeprobe.mjs probeLevel`),
 * as the marker keeps it: the capturable flags neither side's bots have an
 * open way to (`unreachable`, with where each way stops: the planner's own
 * failure, or more choke points than `CHOKE_MAX`), the flags only one side
 * has (`oneSided`), what each side reaches, and the neighbour links that
 * are shut.
 *
 * INVENTION: a flag in `unreachable` is taken out of play for both sides,
 * exactly as one no soldier can stand inside is. The engine orders its bots
 * to any area a side may take and lets them fail.
 */
export function probeAreas(tools, nav, areas, starts) {
  const targets = areas.filter(a => !a.flag.fixed && !a.unreachable && a.order)
    .map(a => ({ name: a.name, order: a.order, neighbours: a.neighbours }));
  const res = probeLevel(tools, nav, { areas: targets, spawns: starts });
  const unreachable = targets.filter(a => res.flags[a.name].sides.length === 0).map(a => a.name);
  const ways = targets.flatMap(a => [1, 2].map(side => [a.name, side, res.flags[a.name].direct[side]]));
  return {
    chokeMax: CHOKE_MAX,
    unreachable,
    stops: Object.fromEntries(unreachable.map(n => [n, { 1: wayStop(res.flags[n].direct[1]), 2: wayStop(res.flags[n].direct[2]) }])),
    oneSided: Object.fromEntries(targets.filter(a => res.flags[a.name].sides.length === 1).map(a => [a.name, res.flags[a.name].sides[0]])),
    sides: res.sides,
    // The choke points on each side's best way from its spawns to each flag (`routeprobe.mjs chokePoints`).
    chokes: Object.fromEntries(ways.filter(([, , w]) => w?.ok).map(([n, side, w]) => [`${n}:${side}`, w.chokes])),
    // A route that closes only after the bot's route has failed once or more is a route failure every time it is planned.
    late: Object.fromEntries(ways.filter(([, , w]) => w?.ok && w.failures > 0).map(([n, side, w]) => [`${n}:${side}`, w.failures])),
    shutLinks: res.links.filter(l => !l.open).map(l => `${l.from}>${l.to}`),
  };
}

/** The spawns bots are kept off, from the walk test: no way to the main ground, or a storey over another floor.
 *  INVENTION: the engine spawns a bot on any point of its side's group (`viewer/spawn-flags.js pickSpawn` honours the list). */
export function excludedByWalk(facts) {
  return facts.spawns.filter(s => !s.usable || s.over >= STOREY).map(s => s.name);
}

/** A decoded search-map level (`nav-baked.js BakedSearchMap`) as one byte a pixel, 1 blocked. */
export function searchMapPixels(map) {
  const out = new Uint8Array(map.width * map.height);
  for (let z = 0; z < map.height; z++) for (let x = 0; x < map.width; x++) out[z * map.width + x] = map.blocked(x, z) ? 1 : 0;
  return out;
}

/** The next pyramid level: a pixel is blocked when any of its four children is (measured on the engine's own files). */
export function coarserPixels(pixels, size) {
  const half = size >> 1;
  const out = new Uint8Array(half * half);
  for (let z = 0; z < half; z++) for (let x = 0; x < half; x++) {
    const i = 2 * z * size + 2 * x;
    out[z * half + x] = pixels[i] | pixels[i + 1] | pixels[i + size] | pixels[i + size + 1];
  }
  return out;
}

/**
 * One search-map level in the engine's file layout (`CellMap::loadRawFile`,
 * `nav-baked.js`): the five header words, the two special cells (all free,
 * all blocked), then a record a 64 x 64 block: the special cell's index, or
 * -1 and the block's 128 words. `pixels` is `size * size` bytes, 1 blocked.
 */
export function encodeSearchMap(pixels, size, level) {
  const blocks = size >> 6;
  if (blocks < 1 || blocks * 64 !== size || (blocks & (blocks - 1))) throw new Error(`a search map of ${size} pixels is not whole 64-pixel blocks`);
  const parts = [];
  const head = Buffer.alloc(32);
  [Math.log2(blocks), Math.log2(blocks), level + 6, level, 0, 2].forEach((v, i) => head.writeInt32LE(v, i * 4));
  head.writeUInt32LE(0, 24); head.writeUInt32LE(0xffffffff, 28);
  parts.push(head);
  for (let bz = 0; bz < blocks; bz++) for (let bx = 0; bx < blocks; bx++) {
    const words = new Uint32Array(128);
    let set = 0;
    for (let row = 0; row < 64; row++) {
      const at = (bz * 64 + row) * size + bx * 64;
      for (let col = 0; col < 64; col++) if (pixels[at + col]) { words[row * 2 + (col >> 5)] |= (1 << (col & 31)) >>> 0; set++; }
    }
    const rec = Buffer.alloc(4);
    if (set === 0 || set === 4096) { rec.writeInt32LE(set ? 1 : 0, 0); parts.push(rec); continue; }
    rec.writeInt32LE(-1, 0);
    const body = Buffer.alloc(512);
    for (let w = 0; w < 128; w++) body.writeUInt32LE(words[w] >>> 0, w * 4);
    parts.push(rec, body);
  }
  return Buffer.concat(parts);
}

/** The three pyramid levels of a map from its level-0 pixels: `{ 0: Buffer, 1: Buffer, 2: Buffer }`. */
export function encodePyramid(pixels, size) {
  const out = {};
  let px = pixels, n = size;
  for (let level = 0; level <= 2; level++) {
    out[level] = encodeSearchMap(px, n, level);
    px = coarserPixels(px, n); n >>= 1;
  }
  return out;
}

/**
 * The layer's own infantry map, made to hold the ground the walk test finds.
 * `engine` is the engine's level-0 map as pixels (`searchMapPixels`), or
 * the layer's last map with `previous`, the `walkMap` block of its last
 * `generated.json`, whose opened cells are shut again first.
 *
 * INVENTION, two rules, both recorded in the marker:
 *  - **the floor's own map.** When the engine's map holds less than
 *    `MAP_COVER` of the main ground free (a floor of objects high over the
 *    terrain, corridors its one-metre brush closes), the map is painted from
 *    the walked ground instead (`walkflood.mjs paintGround`).
 *  - **a way out of a pocket.** A spawn that lands on the main ground, or a
 *    flag with main ground inside its ring, whose cells the map keeps apart
 *    from its main component gets the cells of the walked way opened. A
 *    spawn on other ground is opened a way only when it can walk to the main
 *    ground with no fall that costs health. A way that needs a jump is not
 *    opened: the page's bots never jump.
 *
 * Returns `{ pixels, source, engineCover, opened, ways, facts }`;
 * `engineCover` is the share of the main ground the engine's map held free
 * (the marker keeps it for a painted map), `opened` is every cell
 * `[x, z]` (engine z) this run freed, so a later run can put the engine's
 * map back before it decides again.
 */
export function prepareWalkMap({ collider, size, flags, spawns, body, engine, previous = null }) {
  const gridOf = pixels => ({ width: size, height: size, cellSize: 1, blocked: pixels });
  const ground = walkedGround(collider, spawns, flags, body, size);
  let pixels = Uint8Array.from(engine);
  if (previous?.source === 'engine') for (const [x, z] of previous.opened ?? []) pixels[z * size + x] = 1;
  const original = Uint8Array.from(pixels);
  let facts = walkFacts({ collider, grid: gridOf(pixels), flags, spawns, body, ground });
  // What the engine's own map held of the main ground, kept for the record when the map is painted.
  const engineCover = facts.cover;
  const painted = facts.mainRegion >= 0 && facts.cover < MAP_COVER;
  if (painted) {
    pixels = paintGround(ground, size, facts.mainRegion);
    facts = walkFacts({ collider, grid: gridOf(pixels), flags, spawns, body, ground });
  }
  const { id } = facts.components;
  const opened = new Set();
  const ways = [];
  const cellOf = (x, z) => Math.floor(-z) * size + Math.floor(x);
  const onMain = (x, z, y) => {
    const c = cellOf(x, z);
    return c >= 0 && c < id.length && ((facts.mainComponent && id[c] === facts.mainComponent) || opened.has(c))
      && ground.regionOf(x, z, y) === facts.mainRegion;
  };
  const open = (who, kind, start, twoWay) => {
    const res = wayOut(collider, [start], body, onMain, { twoWay, reach: WAY_REACH, maxCells: WAY_CELLS });
    let n = 0;
    if (res.way === 'walk') {
      for (const [x, z] of res.path) { const c = cellOf(x, z); if (pixels[c]) { pixels[c] = 0; opened.add(c); n++; } }
    }
    const fell = res.path ? res.path.some((p, i) => i && res.path[i - 1][2] - p[2] > body.step) : false;
    ways.push({ who, kind, way: res.way === 'walk' && fell ? 'drop' : res.way, opened: n });
  };
  if (facts.mainRegion >= 0 && facts.mainComponent) {
    for (const s of facts.spawns) {
      if (!s.landed || s.usable || s.over >= STOREY) continue;
      open(s.name, 'spawn', [s.x, s.y, s.z], s.onMainGround);
    }
    for (const f of facts.flags) {
      if (f.reachable || !f.onMainGround || f.over >= STOREY) continue;
      open(f.name, 'flag', [f.onMainGround[0], f.onMainGround[2] + 0.01, f.onMainGround[1]], true);
    }
  }
  if (opened.size) facts = walkFacts({ collider, grid: gridOf(pixels), flags, spawns, body, ground });
  const cells = [...opened].sort((p, q) => p - q).map(c => [c % size, Math.floor(c / size)]);
  return { pixels, engine: original, source: painted ? 'walk test' : 'engine', engineCover, opened: cells, ways, facts };
}

/**
 * The land vehicles' map for a level the engine wrote none for: the page's
 * own painter (`viewer/nav-map.js buildNavMap`, the map a hull routes on
 * when a level ships no `Tank0`), with the seeds `viewer/bot-units.js
 * vehicleNav` gives it, written out as the layer's `Tank0` so the layer's
 * maps load in the engine's order.
 *
 * The brush is DICE's 3 m where that leaves the level in one piece, and
 * the widest of `VEHICLE_BRUSHES` that does where it does not: the one
 * that puts as many flags (the free cell nearest each, the hull's order
 * position) and as many spawners on one piece of the map as any brush
 * tried. A town's streets are narrower than the open ground DICE's 3 m was
 * set for: on Desert Combat's Basrah Nights 3 m leaves the map in nineteen
 * pieces, two flags of five and one vehicle of four on the largest, and the
 * drivers sit still all match; 1.5 m joins all five flags and all four.
 * The layer's `AIpathFinding.con` declares the brush used, so the page
 * reads this map for its hulls.
 *
 * Returns `{ pixels, brush, tried }`, one byte a pixel, 1 blocked.
 *
 * INVENTION: the engine floods its own from the objects' collision
 * outlines with the brush the level's script names; on a mod's level that
 * flood leaves a few dozen cells.
 */
export function paintedVehicleMap(nav, world, extras, size, flags = []) {
  const seeds = [];
  for (const spawn of extras.objectSpawns ?? []) if (spawn?.position) seeds.push([spawn.position[0], spawn.position[2]]);
  for (const flag of world.flags ?? []) for (const spawn of flag.spawns ?? []) if (spawn?.position) seeds.push([spawn.position[0], spawn.position[2]]);
  const tried = [];
  for (const brush of VEHICLE_BRUSHES) {
    const map = nav.buildNavMap(world.collider, size, { waterLevel: world.collider?.waterLevel, ...VEHICLE_MAP_PARAMS, brush, seeds, baked: false });
    const pixels = new Uint8Array(size * size);
    for (let i = 0; i < pixels.length; i++) pixels[i] = map.blocked[i] ? 1 : 0;
    const grid = { width: size, height: size, cellSize: 1, blocked: pixels };
    const { id, sizes } = components(grid);
    // The piece the level is played on: the one that holds most flags, then most spawners, then the largest.
    // Not the largest alone: a walled town's map has more open ground outside the wall than inside it.
    const pieceAt = (x, z) => { const c = Math.floor(-z) * size + Math.floor(x); return c >= 0 && c < id.length ? id[c] : 0; };
    const flagPiece = flags.map(f => { const p = nearestFree(grid, nav.isWalkable, f.x, f.z, VEHICLE_ORDER_SEARCH); return p ? pieceAt(p[0], p[1]) : 0; });
    const spawnerPiece = (extras.objectSpawns ?? []).filter(o => o?.position).map(o => pieceAt(o.position[0], o.position[2]));
    const tally = list => { const n = new Map(); for (const c of list) if (c) n.set(c, (n.get(c) ?? 0) + 1); return n; };
    const nf = tally(flagPiece), ns = tally(spawnerPiece);
    let main = 0;
    for (let i = 1; i < sizes.length; i++) {
      const better = !main || (nf.get(i) ?? 0) > (nf.get(main) ?? 0)
        || ((nf.get(i) ?? 0) === (nf.get(main) ?? 0) && ((ns.get(i) ?? 0) > (ns.get(main) ?? 0)
          || ((ns.get(i) ?? 0) === (ns.get(main) ?? 0) && sizes[i] > sizes[main])));
      if (better) main = i;
    }
    const flagsOn = main ? nf.get(main) ?? 0 : 0, spawnersOn = main ? ns.get(main) ?? 0 : 0;
    tried.push({ brush, pixels, flagsOn, spawnersOn, pieces: sizes.length - 1, main: main ? sizes[main] : 0 });
  }
  const best = { flags: Math.max(...tried.map(t => t.flagsOn)), spawners: Math.max(...tried.map(t => t.spawnersOn)) };
  const pick = tried.find(t => t.flagsOn === best.flags && t.spawnersOn === best.spawners) ?? tried[tried.length - 1];
  return { pixels: pick.pixels, brush: pick.brush, tried: tried.map(({ pixels, ...t }) => t) };
}

export function buildLayer({ mod, level, extras, areas, navSha, template, templateChoice = null, rawFiles = {}, botSpawnsExcluded = [], walkMap = null, routeProbe = null }) {
  const worldSize = Math.round(extras.worldSize || 1024);
  const viewDistance = Math.round(Math.min(400, Math.max(60, extras.drawDistance || 200)));
  const engineMaps = Object.keys(rawFiles).length > 0;
  const files = {
    'AI.con': aiCon({ worldSize, viewDistance, strategies: template.strategies, searchMaps: engineMaps }),
    ...(engineMaps ? { 'AIpathFinding.con': pathFindingCon(walkMap?.engine === 'none', walkMap?.vehicleBrush ?? VEHICLE_MAP_PARAMS.brush) } : {}),
    'AI/StrategicAreas.con': areasCon(areas),
    ...Object.fromEntries(TEMPLATE_FILES.map(f => [`AI/${f}`, template.files[f]])),
  };
  const flags = flagsOf(extras).map(f => [f.name, r1(f.x), r1(f.y), r1(f.z), f.radius, f.team, f.fixed]);
  const marker = {
    generator: GENERATOR, version: GENERATOR_VERSION, mod, level,
    // What the level places for a crew: its vehicle and gun spawners. Above none, the bake's gate asks for a
    // verdict of matches run with them (`bf42/ai_level.py generated_layer_gate`).
    objectSpawners: (extras.objectSpawns ?? []).length,
    template: template.name, templateSource: template.source, ...(templateChoice ? { templateChoice } : {}),
    scope: !engineMaps ? 'on foot: infantry order positions only, no search maps, no co-op layer'
      : walkMap?.engine === 'none'
        ? 'an infantry map painted from the walk test, a Tank0 map from the page painter, infantry order positions, no strategic maps, no co-op layer'
      : walkMap?.source === 'walk test'
        ? 'on foot: an infantry map painted from the walk test, the engine\'s own Tank0 map, infantry order positions, no strategic maps, no co-op layer'
        : 'on foot: the engine\'s own Tank0 and Infantry1 search maps, infantry order positions, no strategic maps, no co-op layer',
    unreachable: areas.filter(a => a.unreachable).map(a => a.name),
    // Why each is out: the walk test (no soldier stands inside it), or the route probe (no bot's route closes on it).
    unreachableReasons: Object.fromEntries(areas.filter(a => a.unreachable).map(a => [a.name, routeProbe?.unreachable?.includes(a.name) ? 'route probe' : 'walk test'])),
    botSpawnsExcluded,
    ...(walkMap ? { walkMap } : {}),
    ...(routeProbe ? { routeProbe } : {}),
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
export async function layerInfantryMap(layerDir, viewer = null, bytes = null) {
  const file = layerDir ? path.join(layerDir, 'Pathfinding', `${WALK_MAP}Level0Map.raw`) : null;
  if (!bytes && (!file || !existsSync(file))) return null;
  const baked = await import(pathToFileURL(path.join(viewerDir(viewer), 'nav-baked.js')).href);
  const map = baked.decodeSearchMap(new Uint8Array(bytes ?? readFileSync(file)));
  map.params = { name: 'Infantry1', waterMap: false, waterDepth: 1.5, maxSlope: 30, brush: 1.0, lowClip: 0.4, hiClip: 2.0, minLevel: 0, maxLevel: 2 };
  map.mapIndex = 1;
  return map;
}

/**
 * Load a baked level and the infantry map the page's soldiers will walk:
 * the level's own baked map when its tree has one, else the engine's map
 * from `layerDir` when the layer holds one, else the map the referee paints.
 */
export async function loadForBots({ maps, models, map, viewer = null, layerDir = null, layerFirst = false }) {
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
    // `layerFirst`: the generator's own call. A scratch tree the layer was applied to holds the
    // layer's last maps as its baked ones, and the layer folder is what is being rewritten.
    const shipped = !!world.collider?.searchMaps?.maps?.length && !(layerFirst && level.extras.ai?.generated);
    const searchMap = shipped ? null : await layerInfantryMap(layerDir, viewer);
    const build = map => nav.buildNavMap(world.collider, worldSize, { waterLevel: world.collider?.waterLevel, seeds,
      ...(map ? { searchMap: map } : {}), ...(shipped ? {} : { baked: !!map }) });
    const grid = build(searchMap);
    // `regrid(bytes)`: the same map the page would build from another level-0 file of the layer.
    const regrid = async bytes => build(await layerInfantryMap(null, viewer, bytes));
    return { M, level, world, nav, grid, extras: level.extras, worldSize, searchMap, shipped, regrid };
  } finally {
    console.log = log;
  }
}

/**
 * The walk test's facts for a loaded level (`loadForBots`'s result) against
 * the map its bots walk, with no edit: what the lint and the census read.
 */
export async function levelWalkFacts(loaded, viewer = null) {
  const body = await soldierBody(viewer);
  return walkFacts({ collider: loaded.world.collider, grid: loaded.grid, flags: flagsOf(loaded.extras), spawns: spawnsOf(loaded.extras), body });
}

export async function generate({ maps, models, map, mod, out = LAYERS_ROOT, template = null, check = false }) {
  const dir = path.join(out, mod.toLowerCase(), map.toLowerCase());
  const loaded = await loadForBots({ maps, models, map, layerDir: dir, layerFirst: true });
  const { nav, extras, world } = loaded;
  let grid = loaded.grid;
  const rawDir = path.join(dir, 'Pathfinding');
  const rawFiles = existsSync(rawDir)
    ? Object.fromEntries(readdirSync(rawDir).filter(f => /\.raw$/i.test(f)).sort().map(f => [`Pathfinding/${f}`, readFileSync(path.join(rawDir, f))]))
    : {};
  if (extras.ai?.strategicAreas?.length && !extras.ai.generated) {
    throw new Error(`${map} ships its own AI layer; a generated one never replaces it`);
  }
  const flags = flagsOf(extras);
  if (flags.length < 2) throw new Error(`${map} has ${flags.length} control points; nothing to order bots to`);
  // The walk test, and the layer's own infantry map made to hold what it finds.
  const body = await soldierBody();
  const spawns = spawnsOf(extras);
  const markerFile = path.join(dir, 'generated.json');
  const previous = existsSync(markerFile) ? JSON.parse(readFileSync(markerFile, 'utf8')).walkMap ?? null : null;
  const size = Math.round(loaded.worldSize);
  let facts, walkMap = null;
  const keptFile = path.join(dir, ENGINE_COPY);
  let dropCopy = false;
  // A layer the engine wrote no map for (a mod's level, a level with no archive at hand): the infantry map is
  // painted from the walk test alone, and the land vehicles' is the page's own painter's, written out.
  const kept = existsSync(keptFile) ? (await layerInfantryMap(null, null, readFileSync(keptFile))) : null;
  const noEngine = !kept && (!loaded.searchMap || previous?.engine === 'none');
  if (noEngine || loaded.searchMap.width === size) {
    const walk = prepareWalkMap({ collider: world.collider, size, flags, spawns, body,
                                  engine: noEngine ? new Uint8Array(size * size).fill(1) : searchMapPixels(kept ?? loaded.searchMap),
                                  previous: kept || noEngine ? null : previous });
    if (noEngine && (walk.source !== 'walk test' || walk.facts.capped)) {
      // The walk test found no main ground to paint (no spawn lands, or the flood ran out of room): no map is
      // written and the page paints its own, as it does for a level with no layer.
      for (const f of Object.keys(rawFiles)) delete rawFiles[f];
      // The same flood, asked of the page's own map: a capped flood's unfinished regions are joined through it.
      facts = walkFacts({ collider: world.collider, grid, flags, spawns, body, ground: walk.facts.flood });
      walkMap = { source: 'page painter', engine: 'none', opened: [], ways: [], cover: facts.cover, floors: facts.floors, capped: !!walk.facts.capped,
                  ...(facts.joined ? { joined: facts.joined } : {}) };
    } else {
      const pyramid = encodePyramid(walk.pixels, size);
      for (const level of [0, 1, 2]) rawFiles[`Pathfinding/${WALK_MAP}Level${level}Map.raw`] = pyramid[level];
      if (walk.source === 'walk test' && !noEngine) rawFiles[ENGINE_COPY] = encodeSearchMap(walk.engine, size, 0);
      else dropCopy = !!kept;
      let painted = null;
      if (noEngine) {
        painted = paintedVehicleMap(nav, world, extras, size, flags);
        const tank = encodePyramid(painted.pixels, size);
        for (const level of [0, 1, 2]) rawFiles[`Pathfinding/${VEHICLE_MAP}Level${level}Map.raw`] = tank[level];
      }
      grid = await loaded.regrid(pyramid[0]);
      facts = walk.facts;
      walkMap = { source: walk.source, ...(noEngine ? { engine: 'none', vehicleMap: 'page painter', vehicleBrush: painted.brush, vehicleBrushes: painted.tried } : {}),
                  ...(walk.source === 'walk test' && !noEngine ? { engineCover: walk.engineCover } : {}),
                  opened: walk.opened, ways: walk.ways, cover: facts.cover, floors: facts.floors, ...(walk.facts.capped ? { capped: true } : {}) };
    }
  } else {
    facts = walkFacts({ collider: world.collider, grid, flags, spawns, body });
  }
  const factOf = new Map(facts.flags.map(f => [f.name, f]));
  const noRoute = new Set();
  // The land vehicles' map of the layer, for a hull's order position: only on a level that places something to crew.
  const tankFile = `Pathfinding/${VEHICLE_MAP}Level0Map.raw`;
  let tankGrid = null;
  if ((extras.objectSpawns ?? []).length && rawFiles[tankFile]) {
    const baked = await import(pathToFileURL(path.join(viewerDir(), 'nav-baked.js')).href);
    const tm = baked.decodeSearchMap(new Uint8Array(rawFiles[tankFile]));
    if (tm.width === size) tankGrid = { width: size, height: size, cellSize: 1, blocked: searchMapPixels(tm) };
  }
  const build = () => buildAreas(flags, {
    vehicleOrder: tankGrid ? (x, z) => nearestFree(tankGrid, nav.isWalkable, x, z, VEHICLE_ORDER_SEARCH) : null,
    orderPosition: (x, z) => nearestFree(grid, nav.isWalkable, x, z),
    reach: f => {
      const r = flagReach(factOf.get(f.name), nearestFree(grid, nav.isWalkable, f.x, f.z, f.fixed ? ORDER_SEARCH : f.radius));
      return noRoute.has(f.name) ? { ...r, unreachable: true } : r;
    },
    route: (p, q) => {
      const pts = nav.findPath(grid, p[0], p[1], q[0], q[1]);
      return pts ? pathLength(pts) : Infinity;
    },
  });
  let areas = build();
  // The route probe: the page's own planner on this map, from each side's usable spawns to every flag still in play.
  const tools = await probeTools();
  const usable = new Set(facts.spawns.filter(sp => sp.usable && sp.over < STOREY).map(sp => sp.name));
  const starts = spawns.filter(sp => (sp.side === 1 || sp.side === 2) && usable.has(sp.name));
  let probe = probeAreas(tools, grid, areas, starts);
  if (probe.unreachable.length) {
    for (const name of probe.unreachable) noRoute.add(name);
    areas = build();
    // The neighbours are drawn again without them, so the links are probed again.
    probe = { ...probeAreas(tools, grid, areas, starts), unreachable: probe.unreachable, stops: probe.stops };
  }
  const bits = Buffer.alloc(grid.blocked.length);
  for (let i = 0; i < bits.length; i++) bits[i] = grid.blocked[i] ? 1 : 0;
  // The template: the one asked for, else by the flags left in play.
  const chosen = templateFor(areas);
  const templateChoice = template ? { ...chosen, name: template, rule: `asked for (${chosen.rule})` } : chosen;
  const layer = buildLayer({ mod, level: map, extras, areas, navSha: sha(bits), template: readTemplate(templateChoice.name, out), templateChoice, rawFiles,
                             botSpawnsExcluded: excludedByWalk(facts), walkMap, routeProbe: probe });
  const want = { ...layer.files, 'generated.json': JSON.stringify(layer.marker, null, 1) + '\n' };
  const stale = [];
  for (const [rel, text] of Object.entries(want)) {
    const file = path.join(dir, rel);
    const have = existsSync(file) ? readFileSync(file, 'latin1') : null;
    if (have === text) continue;
    stale.push(rel);
    if (!check) { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text, 'latin1'); }
  }
  for (const [rel, data] of Object.entries(rawFiles)) {
    const file = path.join(dir, rel);
    if (existsSync(file) && readFileSync(file).equals(data)) continue;
    stale.push(rel);
    if (!check) { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, data); }
  }
  if (dropCopy) { stale.push(ENGINE_COPY); if (!check) rmSync(keptFile); }
  return { dir, areas, marker: layer.marker, changed: stale, facts, probe };
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
    console.error('usage: node sim/botgen.mjs --map <level dir> --mod <mod folder> --maps <maps tree> [--models <models tree>] [--out <bot-layers root>] [--template few|symmetric, default by the flags in play] [--check]');
    process.exit(2);
  }
  const res = await generate({ maps: path.resolve(a.maps), models: a.models ? path.resolve(a.models) : null, map: a.map, mod: a.mod,
                               out: a.out ? path.resolve(a.out) : LAYERS_ROOT, template: a.template ?? null, check: a.check });
  for (const area of res.areas) {
    console.log(`${area.name.padEnd(22)} ${(area.unreachable ? 'unreachable on foot, excluded' : area.flags.join(',')).padEnd(34)} value ${String(area.value).padEnd(4)} neighbours ${area.neighbours.join(', ')}`);
  }
  console.log(`${a.check ? 'checked' : 'wrote'} ${res.dir}: ${res.changed.length ? (a.check ? 'STALE ' : '') + res.changed.join(', ') : 'up to date'}`);
  process.exit(a.check && res.changed.length ? 1 : 0);
}
