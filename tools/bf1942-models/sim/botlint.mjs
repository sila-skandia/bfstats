// Static lint of a level's bot layer, shipped or generated, with no match
// run (features/bot-map-generation, section 6.1): the layer loads, every
// reference resolves, every capturable control point is inside an area,
// order positions stand on free cells of the map the page's soldiers walk,
// and every capturable flag can be reached on foot from the rest.
//
// With the walk test's facts (`walkflood.mjs walkFacts`, which `lintLevel`
// hands in) it also predicts a dead level before any match runs: an error
// when a side has no spawn with a route to any flag it must take, when no
// capturable flag is reachable in 3D, and when the play surface is stacked
// floors a one-floor walk map cannot hold.
//
//   node sim/botlint.mjs --map shigaisen_b --maps <maps tree> [--models <tree>] [--source <layer folder>] [--json out.json]
//
// Exit 1 when it finds an error. `lintLayer` is the pure half the tests call.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadForBots, levelWalkFacts, flagsOf, spawnsOf, nearestFree, ORDER_SEARCH } from './botgen.mjs';
import { components, STOREY } from './walkflood.mjs';
import { CHOKE_MAX, probeLevel, probeTools, wayStop } from './routeprobe.mjs';

export { components };

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
export function lintLayer({ ai, flags, grid = null, isWalkable = null, ground = null, spawns = [], defined = [], pathIndex = null, walk = null, probe = null }) {
  const errors = [], warnings = [];
  // `dead`: the class of a finding that predicts a level nobody fights on (`DEAD_CLASSES`).
  const err = (check, text, dead = null) => errors.push({ check, text, ...(dead ? { dead } : {}) });
  const warn = (check, text) => warnings.push({ check, text });
  const areas = ai?.strategicAreas ?? [];
  if (!areas.length) { err('loads', 'no strategic areas'); return { errors, warnings, facts: {} }; }
  for (const m of pathIndex?.maps ?? []) if (!m.loaded) err('loads', `${m.name}: ${m.reason ?? 'does not load'}`);
  // The engine aborts before it writes a generated layer's strategic maps
  // (section 13); the page then plans on its own coarse layer.
  for (const m of pathIndex?.strategic ?? []) {
    if (!m.loaded) (ai.generated ? warn : err)('loads', `strategic map ${m.name}: ${m.reason ?? 'does not load'}`);
  }
  const excluded = new Set((ai.generated?.unreachable ?? []).map(n => n.toLowerCase()));
  const unreachable = [];
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
  if (probe) Object.assign(facts, lintProbe({ probe, err, warn }));
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
  if (walk) {
    Object.assign(facts, lintWalk({ walk, flags, excluded, err, warn }));
    return { errors, warnings, facts };
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
      if (lift > f.radius) {
        unreachable.push(f.name);
        const text = `control point ${f.name} is ${lift.toFixed(1)} m above the ground a soldier stands on, further than its ${f.radius} m radius`;
        if (excluded.has(f.name.toLowerCase())) warn('reach', `${text}: unreachable on foot, excluded`);
        else err('reach', text);
      }
    }
  }
  const tally = new Map();
  for (const f of capturable) { const c = where.get(f.name); if (c) tally.set(c, (tally.get(c) ?? 0) + 1); }
  const main = [...tally.entries()].sort((p, q) => q[1] - p[1] || sizes[q[0]] - sizes[p[0]])[0]?.[0] ?? 0;
  for (const f of flags) {
    const c = where.get(f.name);
    if (c && c !== main) (f.fixed || excluded.has(f.name.toLowerCase()) ? warn : err)('reach', `control point ${f.name} is cut off on foot: its ground is a pocket of ${sizes[c]} cells apart from the main ${sizes[main]}`);
  }
  let cut = 0;
  for (const s of spawns) {
    const p = nearestFree(grid, isWalkable, s[0], s[1], 3);
    if (!p || id[cellOf(grid, p[0], p[1])] !== main) cut++;
  }
  if (cut) warn('reach', `${cut} of ${spawns.length} soldier spawns stand off the main walkable ground`);
  Object.assign(facts, { unreachable, freeCells: sizes.reduce((s, v) => s + v, 0), mainComponent: sizes[main] ?? 0, pockets: sizes.length - 2 < 0 ? 0 : sizes.length - 2, spawnsCutOff: cut, spawns: spawns.length });
  return { errors, warnings, facts };
}

/** The lint's errors that predict a dead level, by class, as the census names them. */
export const DEAD_CLASSES = {
  'no-spawn': 'a side with no spawn at the start', sealed: 'a side sealed in',
  'no-route': 'a side that can reach no flag', 'no-flag': 'no flag a soldier can stand in',
  refused: 'spawns on ground the page refuses to climb',
};

/**
 * The route probe's findings on the layer as applied (`routeprobe.mjs
 * probeLevel` over the areas that carry an order position, `lintLevel`):
 * a flag in play no side's bots have an open way to is an error (the
 * generator takes such a flag out of play, so this is a layer made some
 * other way, or a stale one); a flag one side alone has a way to is a
 * warning that names the side; a side with a way to no flag is a dead
 * level.
 *
 * INVENTION, as the probe is.
 */
function lintProbe({ probe, err, warn }) {
  const stop = w => {
    const s = wayStop(w);
    return s.stage === 'choke' ? `${s.metres} m of it is shut by one teammate standing still (${s.points} choke points, DICE's levels have at most ${CHOKE_MAX})`
      : s.stage === 'strategic' ? 'the strategic search has no answer'
        : s.stage === 'leg' ? `the leg search from ${s.from.join(', ')} to ${s.to.join(', ')} never closes` : s.stage;
  };
  const names = Object.keys(probe.flags);
  const shut = [];
  for (const name of names) {
    const f = probe.flags[name];
    if (f.sides.length === 0) { shut.push(name); err('route', `control point ${name}: no bot's route to it is open (side 1: ${stop(f.direct[1])}; side 2: ${stop(f.direct[2])})`); }
    else if (f.sides.length === 1) {
      const other = f.sides[0] === 1 ? 2 : 1;
      warn('route', `control point ${name}: only side ${f.sides[0]}'s bots have an open route to it (side ${other}: ${stop(f.direct[other])})`);
    }
    for (const side of f.sides) {
      const w = f.direct[side];
      if (w?.open && w.failures > 0) warn('route', `control point ${name}: side ${side}'s route closes only after ${w.failures} failed plan${w.failures > 1 ? 's' : ''}`);
    }
  }
  if (names.length) {
    for (const side of [1, 2]) {
      if (probe.sides[side].spawns && !probe.sides[side].flags.length) err('route', `side ${side}'s bots have an open route to none of the ${names.length} flags in play`, 'no-route');
    }
  }
  for (const l of probe.links) if (!l.open) warn('route', `the way from ${l.from} to its neighbour ${l.to} is not open: ${stop(l.way)}`);
  return { routeShut: shut, routeSides: { 1: probe.sides[1].flags, 2: probe.sides[2].flags } };
}

/** The classes of dead level a lint result predicts: `[]` for none. */
export function predictedDead(lint) {
  return [...new Set((lint?.errors ?? []).map(e => e.dead).filter(Boolean))];
}

/** The walk test's facts as the lint and the census keep them: no flood, no per-cell arrays. */
export function slimFacts(facts) {
  return {
    cover: facts.cover, capped: facts.capped, joined: facts.joined ?? 0, mainPlaces: facts.mainPlaces, regions: facts.regions.length, objectFloor: facts.objectFloor,
    sidesMeet: facts.sidesMeet, ladders: facts.ladders,
    floors: facts.floors,
    spawns: facts.spawns.map(s => ({ name: s.name, side: s.side, landed: s.landed, onMainGround: s.onMainGround, usable: s.usable, refused: s.refused, fall: s.fall, over: s.over, under: s.under })),
    flags: facts.flags.map(f => ({ name: f.name, fixed: f.fixed, team: f.team, radius: f.radius, reachable: f.reachable, walked: !!f.inRing,
                                   onMainGround: !!f.onMainGround, poleLift: f.poleLift, over: f.over, under: f.under })),
  };
}

/**
 * The reach checks on the walk test's facts (`slimFacts`). A spawn serves
 * bots when it has a way to the main ground and no other floor under it; a
 * flag can be taken when a soldier on the map's main ground stands inside
 * its 3D radius.
 *
 * INVENTION: the retail engine has no such checks (a level with a sealed
 * base loads and its bots stand there). They are this tool's reading of what
 * the page's bots, which route on a one-floor map and neither jump nor climb
 * a ladder, can do; an error tagged `dead` predicts a level nobody fights on.
 */
function lintWalk({ walk, flags, excluded, err, warn }) {
  const unreachable = [];
  const serves = s => s.usable && s.over < STOREY;
  const takeable = f => f.reachable && f.over < STOREY;
  if (walk.capped) warn('reach', `the walk test ran out of room before the ground did: its findings cover part of the level${walk.joined ? `, and ${walk.joined} of its unfinished grounds are joined through the walk map` : ''}`);
  if (walk.floors?.stacked) err('floors', `the play surface is stacked floors (${walk.floors.reason}): a one-floor walk map cannot hold it`);
  for (const f of walk.flags) {
    if (f.fixed || takeable(f)) {
      if (!f.fixed && excluded.has(f.name.toLowerCase())) warn('reach', `control point ${f.name} is excluded as unreachable, and the walk test finds a soldier can stand inside it`);
      continue;
    }
    unreachable.push(f.name);
    const text = f.reachable ? `control point ${f.name} stands ${f.over} m over another walked floor`
      : f.walked ? `control point ${f.name}: no soldier on the walk map's main ground stands inside its ${f.radius} m radius (the ground inside it is ${f.onMainGround ? 'blocked on the map' : 'cut off from the main ground'})`
        : `control point ${f.name}: no walked ground inside its ${f.radius} m radius${f.poleLift > f.radius ? ` (the pole is ${f.poleLift} m above the ground it stands over)` : ''}`;
    if (excluded.has(f.name.toLowerCase())) warn('reach', `${text}: unreachable on foot, excluded`);
    else err('reach', text);
  }
  const capturable = walk.flags.filter(f => !f.fixed);
  if (capturable.length && !capturable.some(takeable)) err('reach', `no capturable flag is reachable in 3D: none of the ${capturable.length} has a place inside its radius that a soldier on the one-floor walk map's main ground can stand in`, 'no-flag');
  for (const side of [1, 2]) {
    const own = walk.spawns.filter(s => s.side === side);
    const must = capturable.filter(f => f.team !== side);
    if (!own.length) { err('reach', `side ${side} holds no spawn point at the start of the round`, 'no-spawn'); continue; }
    const good = own.filter(serves);
    if (!good.length) {
      const sealed = own.filter(s => s.landed && !s.usable).length, air = own.filter(s => !s.landed).length;
      const refused = own.filter(s => s.landed && !s.usable && s.refused).length;
      err('reach', `side ${side} has no spawn with a route to any flag it must take: of its ${own.length} spawns ${sealed} have no way on foot to the main ground`
        + (refused ? ` (${refused} stand on terrain the page's soldier refuses to climb: its normal there, read across a lattice cell, is past the slope limit)` : '')
        + (air ? `, ${air} are in the air` : '') + (own.length - sealed - air ? `, ${own.length - sealed - air} stand over another floor` : '')
        + (walk.ladders ? `; the level places ${walk.ladders} ladders, which neither the walk test nor a bot climbs` : ''), 'sealed');
    } else if (must.length && !must.some(takeable)) {
      err('reach', `side ${side} has no spawn with a route to any flag it must take: none of the ${must.length} flags it does not hold can be reached`, 'no-route');
    } else if (good.every(s => s.refused)) {
      // The page's rule, not the engine's (`soldier-resolve.js tooSteep` reads the terrain's normal as a
      // central difference across a lattice cell): flat ground beside a tall terrain wall refuses every step up.
      err('reach', `side ${side} has no spawn on ground a soldier walks freely: all ${good.length} that reach the main ground stand on terrain whose normal the page reads as past its slope limit, where it refuses any step uphill and a bot leaves only downhill, if at all`, 'refused');
    }
  }
  const cut = walk.spawns.filter(s => !serves(s)).length;
  if (cut) warn('reach', `${cut} of ${walk.spawns.length} soldier spawns have no way to the main walkable ground`);
  return { unreachable, spawnsCutOff: cut, spawns: walk.spawns.length, flagsCutOff: unreachable.length,
           cover: walk.cover, objectFloor: walk.objectFloor, floors: walk.floors, sidesMeet: walk.sidesMeet ?? null,
           flagLift: Object.fromEntries(walk.flags.map(f => [f.name, f.poleLift])) };
}

/** Condition names a layer's own `conditions.con` defines, any kind. */
export function definedConditions(text) {
  return [...text.matchAll(/^\s*aiStrategy\.create\w*Condition\s+(\S+)/gim)].map(m => m[1]);
}

/**
 * Whether the runner deals the level's bots a kit: each side needs a row in
 * the tree's `_shared/loadouts.json` (`levels[map][side].slots`) whose kits
 * hold a weapon the bots' table knows (`aiWeapons`), as `sim/level.mjs
 * kitFor` reads it. A side with none fires the stand-in weapon, whose kills
 * stop near 50 m: every community-level verdict of sections 14 to 18 was run
 * so (features/bot-map-generation, 19). `{ sides: { 1: n, 2: n }, missing: [side] }`,
 * n the kits of that side that arm a bot.
 */
export function kitsDealt(loadouts, map) {
  const row = loadouts?.levels?.[map] ?? loadouts?.levels?.[String(map).toLowerCase()] ?? null;
  const sides = {};
  for (const side of [1, 2]) {
    const slots = row?.[side]?.slots;
    const names = (Array.isArray(slots) ? slots : Object.values(slots ?? {})).filter(Boolean);
    sides[side] = names.filter(n => (loadouts?.kits?.[n]?.items ?? []).some(item => loadouts?.aiWeapons?.[item])).length;
  }
  return { sides, missing: [1, 2].filter(side => !sides[side]) };
}

export async function lintLevel({ maps, models = null, map, source = null }) {
  const loaded = await loadForBots({ maps, models, map, layerDir: source });
  const { nav, grid, extras, world } = loaded;
  const fullWalk = await levelWalkFacts(loaded);
  const walk = slimFacts(fullWalk);
  // The route probe on the layer as applied: its areas' own infantry order positions, each side's usable spawns.
  let probe = null;
  if (extras.ai?.strategicAreas?.length) {
    const fixed = new Set(flagsOf(extras).filter(f => f.fixed).map(f => f.name.toLowerCase()));
    const order = a => Object.entries(a.orderPositions ?? {}).find(([type]) => /^infant/i.test(type))?.[1] ?? null;
    const inPlay = extras.ai.strategicAreas.filter(a => !fixed.has(a.name.toLowerCase()) && order(a))
      .map(a => ({ name: a.name, order: order(a), neighbours: a.neighbours ?? [] }));
    const sideOf = new Map(spawnsOf(extras).map(sp => [sp.name, sp]));
    const starts = fullWalk.spawns.filter(sp => sp.usable && sp.over < STOREY && (sp.side === 1 || sp.side === 2) && sideOf.has(sp.name))
      .map(sp => ({ side: sp.side, x: sideOf.get(sp.name).x, z: sideOf.get(sp.name).z }));
    probe = probeLevel(await probeTools(), grid, { areas: inPlay, spawns: starts });
  }
  const file = source ? path.join(source, 'AI', 'conditions.con') : null;
  const indexFile = path.join(maps, map, 'pathfinding', 'index.json');
  const spawns = (extras.soldierSpawns ?? []).filter(s => s.position).map(s => [s.position[0], s.position[2]]);
  // A shipped layer's bots walk its own baked map; a generated one's the painted map.
  const ground = (x, z) => world.collider.surfaceHeight(x, z);
  const res = lintLayer({
    ai: extras.ai, flags: flagsOf(extras), grid, isWalkable: nav.isWalkable, ground, spawns,
    defined: file && existsSync(file) ? definedConditions(readFileSync(file, 'latin1')) : [],
    pathIndex: existsSync(indexFile) ? JSON.parse(readFileSync(indexFile, 'utf8')) : null,
    walk, probe,
  });
  // The kits: a level whose bots would hold the stand-in weapon is not judged.
  const loadoutsFile = path.join(maps, '_shared', 'loadouts.json');
  const kits = kitsDealt(existsSync(loadoutsFile) ? JSON.parse(readFileSync(loadoutsFile, 'utf8')) : null, map);
  if (kits.missing.length) {
    res.errors.push({ check: 'kits', text: `no kit for ${kits.missing.map(s => (s === 1 ? 'Axis' : 'Allies')).join(' or ')} in ${loadoutsFile}: `
      + 'the bots would fire the stand-in weapon; refresh the tree\'s loadouts.json from the published one' });
  }
  res.facts = { ...(res.facts ?? {}), kits: kits.sides };
  return { level: map, generated: extras.ai?.generated ?? null, mapSource: grid.source, ...res, walk };
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
