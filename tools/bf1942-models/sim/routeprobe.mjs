// The route probe: whether the page's own bots can finish a route on a
// layer's maps, asked of the page's own route code.
//
// The walk test (`walkflood.mjs`) says a soldier can walk from a spawn to a
// flag, and a cell-connectivity test says the map joins the two. Neither is
// what a bot does. A bot plans a strategic path over the coarse regions
// (`viewer/nav-search.js findStrategicPath`) and then refines it one leg at
// a time with a local search in a box around where it stands
// (`beginLocalSearch` / `stepLocalSearch`, as `viewer/bot-route.js
// extendRoute` runs them: the box 10 to 24 m, six wider tries of a failed
// leg, the route failed after those, the next route's box 16 m wider for
// each of its last three failures). A leg that never closes is a bot
// standing at the foot of a ramp until the no-progress redeploy: on the
// community map The_Maze two flags at the top of long narrow ramps were
// reachable by every other test and were never taken in twenty matches.
//
// So the probe runs that planner, with the page's own numbers, from each
// side's usable base spawns to each capturable flag's order position and
// between neighbouring flags, and says which routes close.
//
// On the bare map every route of The_Maze closes on the first plan. What
// shuts them is a teammate: a soldier plants a 2 m circle on a body of
// their own side standing still in their way, and in a passage three or
// four cells wide that circle is the passage (`chokePoints`). So a route
// is also asked how much of it one standing teammate shuts, and judged
// against the most DICE's own levels ask (`CHOKE_MAX`).
//
// INVENTION: the retail engine has no such check. It is this tool's
// verifier for whatever the map and the planner do.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { viewerDir } from './env.mjs';

/** The page's route code and its numbers, from the viewer's own modules. */
export async function probeTools(viewer = null) {
  const imp = f => import(pathToFileURL(path.join(viewerDir(viewer), f)).href);
  const [search, route, map] = await Promise.all(['nav-search.js', 'bot-route.js', 'nav-map.js'].map(imp));
  return {
    findStrategicPath: search.findStrategicPath, beginLocalSearch: search.beginLocalSearch, stepLocalSearch: search.stepLocalSearch,
    coarseCell: map.COARSE_CELL,
    // `extendRoute`'s box: the least it draws (10 + rand x 14, plus 1), so a leg that closes here closes on any draw.
    radius: route.LOCAL_SEARCH_RADIUS_MIN + 1,
    retryWiden: route.ROUTE_RETRY_WIDEN, widenings: route.ROUTE_LEG_WIDENINGS, wideNodes: route.ROUTE_LEG_WIDE_NODES,
    // `extendRoute` widens the next route's box for at most this many of the bot's last failures.
    failuresCounted: 3,
    // The circle a soldier plants on a teammate standing still in their way (`predictObstacles`: R_bot + R_body).
    teammate: 2 * route.BOT_RADIUS,
  };
}

/** One leg as `extendRoute` searches it: the box, then up to `widenings` wider ones. `{ widen, path }`, or null. */
function probeLeg(T, nav, from, to, failures, obstacles = null) {
  const radius = T.radius + T.retryWiden * failures;
  for (let w = 0; w <= T.widenings; w++) {
    const s = w === 0 ? T.beginLocalSearch(nav, from[0], from[1], to[0], to[1], { radius, obstacles })
      : T.beginLocalSearch(nav, from[0], from[1], to[0], to[1], { radius: radius + T.retryWiden * w, maxNodes: T.wideNodes * w, obstacles });
    const path = s ? T.stepLocalSearch(s, Infinity).path : null;
    if (path) return { widen: w, path };
  }
  return null;
}

/** The points a metre apart along a polyline of `[x, z]`. */
function along(points, step = 1) {
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const [ax, az] = points[i - 1], [bx, bz] = points[i];
    const d = Math.hypot(bx - ax, bz - az);
    for (let t = step; t < d; t += step) out.push([ax + (bx - ax) * t / d, az + (bz - az) * t / d]);
    out.push(points[i]);
  }
  return out;
}

/** How far before and after a standing teammate the follower's search is asked, and how often along a route, metres. */
export const CHOKE_BEFORE = 6, CHOKE_AFTER = 6, CHOKE_EVERY = 3;

/**
 * Where one teammate standing still on a route shuts it for those behind.
 *
 * A soldier plants a circle on a still body of their own side that stands
 * in their way (`bot-route.js predictObstacles`, the engine's
 * `BBAvoid::calculateUrgency`): the two radii summed, 2 m. In open ground
 * the next leg goes round it. In a passage a few cells wide the circle is
 * the passage, the leg never closes, the route fails and is tried again
 * until the no-progress redeploy; every bot ordered the same way queues
 * behind the first one that stopped to fire. On The_Maze every one of 167
 * failed legs of a traced match carried such a circle, and none failed on
 * the bare map.
 *
 * So for each point `CHOKE_EVERY` metres along the planned route a circle
 * is stood on it and the follower's own search is run from `CHOKE_BEFORE`
 * metres short of it to `CHOKE_AFTER` metres past it, widenings and all.
 * Returns the points `[x, z]` where it does not close.
 */
export function chokePoints(T, nav, route) {
  const pts = along(route);
  const out = [];
  for (let i = CHOKE_BEFORE; i < pts.length - CHOKE_AFTER; i += CHOKE_EVERY) {
    const ob = [{ x: pts[i][0], z: pts[i][1], r: T.teammate, id: 'p:probe' }];
    if (!probeLeg(T, nav, pts[i - CHOKE_BEFORE], pts[i + CHOKE_AFTER], T.failuresCounted, ob)) out.push([+pts[i][0].toFixed(1), +pts[i][1].toFixed(1)]);
  }
  return out;
}

/**
 * One route, as a bot standing at `from` and ordered to `to` plans it
 * (`[x, z]` both): `ensureRoute`'s strategic path when the map has its own
 * strategic map or the goal is farther than two coarse cells, then every
 * leg in turn.
 *
 * Returns `{ ok, legs, failures, widen, failed, points }` (`points` the
 * route's own corners when it closes): `failures` is how many
 * times the route fails before every leg closes (0: it closes on the first
 * plan; the box grows with each of a bot's last three failures), `widen`
 * the most wider tries a leg took on that plan, and `failed`, when not ok,
 * says where it stops: `{ stage: 'strategic' }` (the coarse search has no
 * answer) or `{ stage: 'leg', leg, from, to }`.
 */
export function probeRoute(T, nav, from, to) {
  let coarse = null;
  if (nav.strategic || Math.hypot(to[0] - from[0], to[1] - from[1]) > T.coarseCell * 2) {
    coarse = T.findStrategicPath(nav, from[0], from[1], to[0], to[1]);
    if (!coarse) return { ok: false, legs: 0, failures: null, widen: null, failed: { stage: 'strategic' } };
    coarse = coarse.slice(1);                 // the first entry is the bot itself
  }
  const legs = coarse ?? [[to[0], to[1]]];
  let stop = null;
  for (let failures = 0; failures <= T.failuresCounted; failures++) {
    let at = from, widen = 0;
    const points = [from];
    stop = null;
    for (let i = 0; i < legs.length; i++) {
      const leg = probeLeg(T, nav, at, legs[i], failures);
      if (!leg) { stop = { stage: 'leg', leg: i, from: [+at[0].toFixed(1), +at[1].toFixed(1)], to: [+legs[i][0].toFixed(1), +legs[i][1].toFixed(1)] }; break; }
      widen = Math.max(widen, leg.widen);
      points.push(...leg.path.slice(1));
      at = legs[i];
    }
    if (!stop) return { ok: true, legs: legs.length, failures, widen, failed: null, points };
  }
  return { ok: false, legs: legs.length, failures: null, widen: null, failed: stop, points: null };
}

/**
 * The most choke points DICE's own levels put on the best route to a flag
 * (the four levels of `baselines/onfoot-dice.json`, their shipped maps,
 * every side to every capturable flag, measured 2026-11-10: Stalingrad's
 * city flag 4, both sides; Kharkov 1; Berlin at most 1; Bocage 0). A route
 * with more is more single file than any the bar was set on. At
 * `CHOKE_EVERY` 3 m that is 12 m of passage one standing teammate shuts.
 * The_Maze's two tower flags have 16 to 20 from either side.
 */
export const CHOKE_MAX = 4;
/** The spawns of a side a flag is probed from: the nearest few. A base's spawns stand together. */
export const PROBE_SPAWNS = 4;

/** `probeRoute` and the route's choke points, and whether a bot can be sent that way: it closes and is no more single file than DICE's. */
export function probeWay(T, nav, from, to) {
  const p = probeRoute(T, nav, from, to);
  const chokes = p.ok ? chokePoints(T, nav, p.points) : null;
  const { points, ...rest } = p;
  return { ...rest, chokes: chokes ? chokes.length : null, chokeAt: chokes ? chokes.slice(0, 3) : null, open: p.ok && chokes.length <= CHOKE_MAX };
}

/** Why a way is not open, as the marker and the lint say it. */
export function wayStop(w) {
  if (!w) return { stage: 'no usable spawn' };
  if (!w.ok) return w.failed;
  return { stage: 'choke', points: w.chokes, metres: w.chokes * CHOKE_EVERY, first: w.chokeAt };
}

/**
 * The probe over a level. `areas` are the flags in play (`name`, `order`
 * `[x, z]`, `neighbours`), `spawns` the usable soldier spawns of each
 * side's starting flags (`[{ side, x, z }]`).
 *
 * A side reaches a flag when a way from one of its spawns to the flag's
 * order position is open (`probeWay`), or one from the order position of a
 * flag it reaches to a neighbouring flag's is (a side that has taken a
 * flag is ordered on from it).
 *
 * Returns `{ flags, links, sides }`:
 *  - `flags[name]` `{ sides: [1 and/or 2], direct: { 1: way|null, 2: way|null } }`,
 *    `direct` the best way from that side's spawns (open first, then fewest chokes);
 *  - `links` every neighbour pair probed, `{ from, to, open, way }`;
 *  - `sides[s]` `{ spawns, flags: [names it reaches] }`.
 */
export function probeLevel(T, nav, { areas, spawns }) {
  const targets = areas.filter(a => a.order);
  const byName = new Map(targets.map(a => [a.name, a]));
  const flags = {};
  const rank = w => (w.open ? 0 : w.ok ? 1 + w.chokes : 1e6);
  for (const a of targets) {
    const direct = {};
    for (const side of [1, 2]) {
      const own = spawns.filter(s => s.side === side)
        .sort((p, q) => Math.hypot(p.x - a.order[0], p.z - a.order[1]) - Math.hypot(q.x - a.order[0], q.z - a.order[1])).slice(0, PROBE_SPAWNS);
      let best = null;
      for (const s of own) {
        const w = probeWay(T, nav, [s.x, s.z], a.order);
        if (!best || rank(w) < rank(best)) best = w;
        if (best.open && best.failures === 0 && best.chokes === 0) break;
      }
      direct[side] = best;
    }
    flags[a.name] = { direct, sides: [] };
  }
  const links = [];
  for (const a of targets) {
    for (const n of a.neighbours ?? []) {
      const b = byName.get(n);
      if (!b) continue;
      const w = probeWay(T, nav, a.order, b.order);
      links.push({ from: a.name, to: b.name, open: w.open, way: w });
    }
  }
  const sides = {};
  for (const side of [1, 2]) {
    const reached = new Set(targets.filter(a => flags[a.name].direct[side]?.open).map(a => a.name));
    for (let grew = true; grew;) {
      grew = false;
      for (const l of links) if (l.open && reached.has(l.from) && !reached.has(l.to)) { reached.add(l.to); grew = true; }
    }
    for (const name of reached) flags[name].sides.push(side);
    sides[side] = { spawns: spawns.filter(s => s.side === side).length, flags: [...reached].sort() };
  }
  return { flags, links, sides };
}
