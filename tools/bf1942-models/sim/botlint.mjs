// Static lint of a level's bot layer, shipped or generated, with no match
// run (features/bot-map-generation, section 6.1): the layer loads, every
// reference resolves, every capturable control point is inside an area,
// order positions stand on free cells of the map the page's soldiers walk,
// and every capturable flag can be reached on foot from the rest.
//
//   node sim/botlint.mjs --map shigaisen_b --maps <maps tree> [--models <tree>] [--source <layer folder>] [--json out.json]
//
// Exit 1 when it finds an error. `lintLayer` is the pure half the tests call.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadForBots, flagsOf, nearestFree, ORDER_SEARCH } from './botgen.mjs';

/** 4-connected components of the free cells: `Int32Array` of ids, 0 blocked. */
export function components(grid) {
  const { width, height, blocked } = grid;
  const id = new Int32Array(width * height);
  const sizes = [0];
  const stack = [];
  for (let start = 0; start < id.length; start++) {
    if (blocked[start] || id[start]) continue;
    const n = sizes.length;
    let size = 0;
    id[start] = n; stack.push(start);
    while (stack.length) {
      const i = stack.pop(); size++;
      const x = i % width, z = (i - x) / width;
      if (x > 0 && !blocked[i - 1] && !id[i - 1]) { id[i - 1] = n; stack.push(i - 1); }
      if (x < width - 1 && !blocked[i + 1] && !id[i + 1]) { id[i + 1] = n; stack.push(i + 1); }
      if (z > 0 && !blocked[i - width] && !id[i - width]) { id[i - width] = n; stack.push(i - width); }
      if (z < height - 1 && !blocked[i + width] && !id[i + width]) { id[i + width] = n; stack.push(i + width); }
    }
    sizes.push(size);
  }
  return { id, sizes };
}

const cellOf = (grid, x, z) => Math.floor(-z / grid.cellSize) * grid.width + Math.floor(x / grid.cellSize);

/** The page's binding box: twice the authored rectangle about the second corner, grown by `grow`. */
function inBox(area, x, z, grow = 0) {
  const px = area.max[0], pz = area.min[1];
  return Math.abs(x - px) <= (area.max[0] - area.min[0]) + grow && Math.abs(z - pz) <= (area.max[1] - area.min[1]) + grow;
}

/**
 * Lint one layer. `ai` is `scene.json`'s block, `flags` `flagsOf(extras)`,
 * `grid` the infantry map (or null to skip the map checks), `isWalkable` and
 * `ground(x, z)` the map's own tests, `spawns` `[x, z]` soldier spawn points,
 * `defined` extra condition names the layer's own script defines.
 */
export function lintLayer({ ai, flags, grid = null, isWalkable = null, ground = null, spawns = [], defined = [], pathIndex = null }) {
  const errors = [], warnings = [];
  const err = (check, text) => errors.push({ check, text });
  const warn = (check, text) => warnings.push({ check, text });
  const areas = ai?.strategicAreas ?? [];
  if (!areas.length) { err('loads', 'no strategic areas'); return { errors, warnings, facts: {} }; }
  for (const m of [...(pathIndex?.maps ?? []), ...(pathIndex?.strategic ?? [])]) {
    if (!m.loaded) err('loads', `${m.name}: ${m.reason ?? 'does not load'}`);
  }
  // References.
  const byName = new Map(areas.map(a => [a.name.toLowerCase(), a]));
  if (byName.size !== areas.length) err('references', 'two areas share a name');
  for (const a of areas) {
    for (const nb of a.neighbours ?? []) {
      const other = byName.get(nb.toLowerCase());
      if (!other) err('references', `${a.name}: neighbour ${nb} is not an area`);
      else if (other === a) err('references', `${a.name} is its own neighbour`);
      else if (!(other.neighbours ?? []).some(n => n.toLowerCase() === a.name.toLowerCase())) {
        warn('references', `${a.name} names ${nb} a neighbour, ${nb} does not name it back`);
      }
    }
  }
  const strategies = new Map((ai.strategies ?? []).map(s => [s.name.toLowerCase(), s]));
  const prereqs = new Map((ai.prerequisites ?? []).map(p => [p.name.toLowerCase(), p]));
  const conds = new Set([...(ai.conditions ?? []).map(c => c.name.toLowerCase()), ...defined.map(d => d.toLowerCase())]);
  if (!strategies.size) err('references', 'no strategies');
  for (const [side, list] of Object.entries(ai.sideStrategies ?? {})) {
    for (const s of list) if (!strategies.has(s.toLowerCase())) err('references', `side ${side} lists strategy ${s}, which is not defined`);
  }
  for (const side of ['1', '2']) if (!(ai.sideStrategies?.[side] ?? []).length) err('references', `side ${side} has no strategy`);
  const areaFlags = new Set(areas.flatMap(a => a.flags ?? []).map(f => f.toLowerCase()));
  const computed = new Set(['front', 'safe', 'enemy', 'neutral']);
  for (const s of strategies.values()) {
    if (s.prerequisite && !prereqs.has(s.prerequisite.toLowerCase())) err('references', `strategy ${s.name}: prerequisite ${s.prerequisite} is not defined`);
    for (const m of s.modifiers ?? []) {
      const f = String(m.flag).toLowerCase();
      if (!areaFlags.has(f) && !computed.has(f)) warn('references', `strategy ${s.name}: no area carries the flag ${m.flag}`);
    }
  }
  for (const p of prereqs.values()) {
    for (const c of p.conditions ?? []) if (!conds.has(c.name.toLowerCase())) err('references', `prerequisite ${p.name}: condition ${c.name} is not defined`);
  }
  // Coverage.
  const capturable = flags.filter(f => !f.fixed);
  for (const f of flags) {
    if (!areas.some(a => inBox(a, f.x, f.z, a.radius ?? 0))) {
      (f.fixed ? warn : err)('coverage', `control point ${f.name} is inside no area`);
    }
  }
  for (const a of areas) {
    const marked = (a.flags ?? []).some(f => f === 'ControlPoint' || f === 'Base');
    if (marked && !flags.some(f => inBox(a, f.x, f.z))) err('coverage', `area ${a.name} is flagged for a control point and holds none`);
  }
  const facts = { areas: areas.length, controlPoints: flags.length, capturable: capturable.length };
  if (!grid || !isWalkable) return { errors, warnings, facts };
  // Order positions.
  for (const a of areas) {
    const entries = Object.entries(a.orderPositions ?? {});
    for (const [type, p] of entries) {
      if (!/^infant/i.test(type)) continue;
      if (!isWalkable(grid, p[0], p[1])) err('order', `${a.name}: the ${type} order position is not a free cell`);
      else if (!inBox(a, p[0], p[1], ORDER_SEARCH)) warn('order', `${a.name}: the ${type} order position is ${Math.round(Math.hypot(p[0] - a.max[0], p[1] - a.min[1]))} m from the area`);
    }
  }
  // Reach on foot.
  const { id, sizes } = components(grid);
  const where = new Map();
  for (const f of flags) {
    const p = nearestFree(grid, isWalkable, f.x, f.z);
    where.set(f.name, p ? id[cellOf(grid, p[0], p[1])] : 0);
    if (!p) { (f.fixed ? warn : err)('reach', `control point ${f.name}: no free cell within ${ORDER_SEARCH} m`); continue; }
    if (ground && !f.fixed) {
      const lift = f.y - ground(p[0], p[1]);
      if (lift > f.radius) err('reach', `control point ${f.name} is ${lift.toFixed(1)} m above the ground a soldier stands on, further than its ${f.radius} m radius`);
    }
  }
  const tally = new Map();
  for (const f of capturable) { const c = where.get(f.name); if (c) tally.set(c, (tally.get(c) ?? 0) + 1); }
  const main = [...tally.entries()].sort((p, q) => q[1] - p[1] || sizes[q[0]] - sizes[p[0]])[0]?.[0] ?? 0;
  for (const f of flags) {
    const c = where.get(f.name);
    if (c && c !== main) (f.fixed ? warn : err)('reach', `control point ${f.name} is cut off on foot: its ground is a pocket of ${sizes[c]} cells apart from the main ${sizes[main]}`);
  }
  let cut = 0;
  for (const s of spawns) {
    const p = nearestFree(grid, isWalkable, s[0], s[1], 3);
    if (!p || id[cellOf(grid, p[0], p[1])] !== main) cut++;
  }
  if (cut) warn('reach', `${cut} of ${spawns.length} soldier spawns stand off the main walkable ground`);
  Object.assign(facts, { freeCells: sizes.reduce((s, v) => s + v, 0), mainComponent: sizes[main] ?? 0, pockets: sizes.length - 2 < 0 ? 0 : sizes.length - 2, spawnsCutOff: cut, spawns: spawns.length });
  return { errors, warnings, facts };
}

/** Condition names a layer's own `conditions.con` defines, any kind. */
export function definedConditions(text) {
  return [...text.matchAll(/^\s*aiStrategy\.create\w*Condition\s+(\S+)/gim)].map(m => m[1]);
}

export async function lintLevel({ maps, models = null, map, source = null }) {
  const { nav, grid, extras, world } = await loadForBots({ maps, models, map });
  const file = source ? path.join(source, 'AI', 'conditions.con') : null;
  const indexFile = path.join(maps, map, 'pathfinding', 'index.json');
  const spawns = (extras.soldierSpawns ?? []).filter(s => s.position).map(s => [s.position[0], s.position[2]]);
  // A shipped layer's bots walk its own baked map; a generated one's the painted map.
  const ground = (x, z) => world.collider.surfaceHeight(x, z);
  const res = lintLayer({
    ai: extras.ai, flags: flagsOf(extras), grid, isWalkable: nav.isWalkable, ground, spawns,
    defined: file && existsSync(file) ? definedConditions(readFileSync(file, 'latin1')) : [],
    pathIndex: existsSync(indexFile) ? JSON.parse(readFileSync(indexFile, 'utf8')) : null,
  });
  return { level: map, generated: extras.ai?.generated ?? null, mapSource: grid.source, ...res };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) a[argv[i].slice(2)] = argv[++i];
  if (!a.map || !a.maps) { console.error('usage: node sim/botlint.mjs --map <level dir> --maps <maps tree> [--models <tree>] [--source <layer folder>] [--json <file>]'); process.exit(2); }
  const res = await lintLevel({ maps: path.resolve(a.maps), models: a.models ? path.resolve(a.models) : null, map: a.map, source: a.source ? path.resolve(a.source) : null });
  if (a.json) writeFileSync(a.json, JSON.stringify(res, null, 1) + '\n');
  console.log(`${res.level}: ${res.errors.length} errors, ${res.warnings.length} warnings (${res.mapSource} map)`, JSON.stringify(res.facts));
  for (const e of res.errors) console.log(`  ERROR ${e.check}: ${e.text}`);
  for (const w of res.warnings) console.log(`  warn  ${w.check}: ${w.text}`);
  process.exit(res.errors.length ? 1 : 0);
}
