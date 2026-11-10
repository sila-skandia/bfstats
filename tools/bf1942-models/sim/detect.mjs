// What the bots did in a recorded match, read from the runner's trace and
// summary (sim/README.md): stuck episodes, idle share, oscillation,
// self-inflicted deaths, spawn traps, flag coverage and the round's outcome,
// plus a heat grid of where they walked (features/bot-map-generation,
// section 6.2). Pure over the trace's lines; `detectRun` reads a run folder.
//
//   node sim/detect.mjs <run dir> [--json out.json]

import { createReadStream, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** A bot holding its throttle that moves less than this in `STUCK_WINDOW` s is stuck. */
export const STUCK_MOVE = 2, STUCK_WINDOW = 10;
/** An order that goes A, B, A inside this many seconds is an oscillation. */
export const OSCILLATION_WINDOW = 60;
/** A death or a stuck episode this soon and this near after a spawn is a spawn trap. */
export const TRAP_SECONDS = 10, TRAP_METRES = 15;
/** The heat grid's cell, metres. */
export const HEAT_CELL = 4;
const IDLE = new Set(['Idle', 'Scout']);

export function newDetector(header) {
  return {
    header, bots: new Map(), dt: (header.traceEvery ?? 1) / (header.tickHz ?? 30),
    aliveSeconds: 0, idleSeconds: 0, stuck: [], oscillations: 0, selfDeaths: 0, deaths: 0, traps: [],
    changed: new Set(), captures: { 1: 0, 2: 0 }, firstCapture: null, heat: new Map(), spawns: new Map(),
    behaviour: {},
  };
}

function botState(d, id) {
  let b = d.bots.get(id);
  if (!b) { b = { track: [], stuckSince: null, stuckAt: null, orders: [], lastKey: null }; d.bots.set(id, b); }
  return b;
}

function closeStuck(d, id, b, t) {
  if (b.stuckSince === null) return;
  const ep = { bot: id, t: b.stuckSince, seconds: +(t - b.stuckSince).toFixed(1), pos: b.stuckAt };
  d.stuck.push(ep);
  const sp = d.spawns.get(id);
  if (sp && ep.t - sp.t <= TRAP_SECONDS && Math.hypot(ep.pos[0] - sp.pos[0], ep.pos[2] - sp.pos[2]) <= TRAP_METRES) {
    d.traps.push({ bot: id, t: sp.t, kind: 'stuck', pos: sp.pos });
  }
  b.stuckSince = null; b.stuckAt = null;
}

export function feed(d, o) {
  if (o.k === 'tick') {
    const b = botState(d, o.bot);
    if (!o.alive) { closeStuck(d, o.bot, b, o.t); b.track.length = 0; return; }
    d.aliveSeconds += d.dt;
    d.behaviour[o.beh] = (d.behaviour[o.beh] ?? 0) + d.dt;
    if (IDLE.has(o.beh) && !o.target) d.idleSeconds += d.dt;
    const hx = Math.floor(o.pos[0] / HEAT_CELL), hz = Math.floor(-o.pos[2] / HEAT_CELL);
    const key = hx + ',' + hz;
    d.heat.set(key, (d.heat.get(key) ?? 0) + d.dt);
    // Stuck: wants to move (MoveTo with the throttle on) and has not, for the window.
    const pushing = o.beh === 'MoveTo' && Array.isArray(o.ctl) && o.ctl[0] > 0 && !o.veh;
    if (!pushing) { closeStuck(d, o.bot, b, o.t); b.track.length = 0; }
    else {
      b.track.push([o.t, o.pos[0], o.pos[2], o.pos[1]]);
      while (b.track.length && o.t - b.track[0][0] > STUCK_WINDOW) b.track.shift();
      const first = b.track[0];
      const spanned = o.t - first[0] >= STUCK_WINDOW - d.dt * 1.5;
      const moved = Math.hypot(o.pos[0] - first[1], o.pos[2] - first[2]);
      if (spanned && moved < STUCK_MOVE) {
        if (b.stuckSince === null) { b.stuckSince = first[0]; b.stuckAt = [+first[1].toFixed(1), +first[3].toFixed(1), +first[2].toFixed(1)]; }
      } else closeStuck(d, o.bot, b, o.t);
    }
    // Oscillation: the order's target goes A, B, A.
    const okey = o.area ?? (o.order?.point ? o.order.point.map(v => Math.round(v)).join('/') : null);
    if (okey && okey !== b.lastKey) {
      b.orders.push([o.t, okey]);
      if (b.orders.length > 3) b.orders.shift();
      const n = b.orders.length;
      if (n === 3 && b.orders[0][1] === b.orders[2][1] && b.orders[2][0] - b.orders[0][0] <= OSCILLATION_WINDOW) d.oscillations++;
      b.lastKey = okey;
    }
  } else if (o.k === 'ev') {
    if (o.type === 'respawn') d.spawns.set(o.bot, { t: o.t, pos: o.pos });
    else if (o.type === 'kill') {
      d.deaths++;
      const self = !o.killer || o.killer === o.victim;
      if (self) d.selfDeaths++;
      const sp = d.spawns.get(o.victim);
      if (sp && o.t - sp.t <= TRAP_SECONDS && o.pos && Math.hypot(o.pos[0] - sp.pos[0], o.pos[2] - sp.pos[2]) <= TRAP_METRES) {
        d.traps.push({ bot: o.victim, t: sp.t, kind: self ? 'self-death' : 'killed', pos: sp.pos });
      }
    } else if (o.type === 'capture' || o.type === 'neutralise') {
      d.changed.add(o.flag);
      if (o.type === 'capture') {
        d.captures[o.to] = (d.captures[o.to] ?? 0) + 1;
        if (d.firstCapture === null) d.firstCapture = o.t;
      }
    }
  }
}

/** The match's detector row, per bot-minute where a rate. `summary` is the runner's summary.json. */
export function finish(d, summary = null, endT = null) {
  const t = endT ?? d.header.duration;
  for (const [id, b] of d.bots) closeStuck(d, id, b, t);
  const minutes = Math.max(1e-9, d.aliveSeconds / 60);
  const capturable = (d.header.flags ?? []).filter(f => f.controlPoint && !f.uncapturable).map(f => f.name);
  const never = capturable.filter(n => !d.changed.has(n));
  const m = summary?.metrics ?? {};
  const total = v => (v && typeof v === 'object' ? v.total ?? 0 : v ?? 0);
  const places = new Map();
  for (const s of d.stuck) {
    const key = `${Math.round(s.pos[0] / 4) * 4},${Math.round(s.pos[2] / 4) * 4}`;
    const p = places.get(key) ?? { at: key, episodes: 0, seconds: 0, y: s.pos[1] };
    p.episodes++; p.seconds += s.seconds; places.set(key, p);
  }
  const tickets = summary?.result?.tickets ?? null;
  const start = d.header.tickets ?? null;
  return {
    level: d.header.level, seed: d.header.seed, botsPerSide: d.header.botsPerSide, duration: d.header.duration,
    strategic: !!d.header.strategic, botMinutes: +minutes.toFixed(2),
    captures: { 1: d.captures[1] ?? 0, 2: d.captures[2] ?? 0 },
    capturesTotal: (d.captures[1] ?? 0) + (d.captures[2] ?? 0),
    firstCapture: d.firstCapture,
    capturable: capturable.length, flagsNeverChanged: never,
    flagCoverage: capturable.length ? +(1 - never.length / capturable.length).toFixed(3) : null,
    stuckEpisodes: d.stuck.length,
    stuckSecondsPerBotMinute: +(d.stuck.reduce((s, e) => s + e.seconds, 0) / minutes).toFixed(3),
    stuckPlaces: [...places.values()].sort((p, q) => q.seconds - p.seconds).slice(0, 12).map(p => ({ ...p, seconds: +p.seconds.toFixed(1) })),
    idleShare: +(d.idleSeconds / Math.max(1e-9, d.aliveSeconds)).toFixed(4),
    oscillationsPerBotMinute: +(d.oscillations / minutes).toFixed(4),
    selfDeaths: d.selfDeaths, selfDeathsPerBotMinute: +(d.selfDeaths / minutes).toFixed(4),
    deaths: d.deaths,
    spawnTraps: d.traps.length, spawnTrapsPerBotMinute: +(d.traps.length / minutes).toFixed(4),
    routeFailuresPerBotMinute: +(total(m.routeFailures) / minutes).toFixed(3),
    redeploysPerBotMinute: +(total(m.redeploys) / minutes).toFixed(4),
    botErrors: total(m.botErrors),
    winner: summary?.result?.winner ?? null, reason: summary?.result?.reason ?? null, tickets,
    ticketsBled: start && tickets ? { 1: start[1] - tickets[1], 2: start[2] - tickets[2] } : null,
    behaviourShare: Object.fromEntries(Object.entries(d.behaviour).map(([k, v]) => [k, +(v / Math.max(1e-9, d.aliveSeconds)).toFixed(3)])),
    heat: [...d.heat.entries()].map(([k, v]) => [k, +v.toFixed(1)]),
  };
}

export async function detectRun(dir) {
  const trace = path.join(dir, 'trace.jsonl');
  const summaryFile = path.join(dir, 'summary.json');
  const summary = existsSync(summaryFile) ? JSON.parse(readFileSync(summaryFile, 'utf8')) : null;
  let d = null, last = 0;
  const rl = createInterface({ input: createReadStream(trace), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    const o = JSON.parse(line);
    if (o.k === 'match') d = newDetector(o);
    else if (d) { feed(d, o); if (typeof o.t === 'number') last = o.t; }
  }
  if (!d) throw new Error(`${trace}: no match header`);
  return finish(d, summary, last);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [dir, flag, out] = process.argv.slice(2);
  if (!dir) { console.error('usage: node sim/detect.mjs <run dir> [--json out.json]'); process.exit(2); }
  const row = await detectRun(path.resolve(dir));
  if (flag === '--json' && out) writeFileSync(out, JSON.stringify(row) + '\n');
  const { heat, ...rest } = row;
  console.log(JSON.stringify(rest, null, 1));
}
