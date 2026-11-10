// What the bots did in a recorded match, read from the runner's trace and
// summary (sim/README.md): stuck episodes, idle share, oscillation,
// self-inflicted deaths, spawn traps, flag coverage and the round's outcome,
// plus a heat grid of where they walked (features/bot-map-generation,
// section 6.2). Pure over the trace's lines; `detectRun` reads a run folder.
//
// The movement rates are also kept by side, with the worse side's as its own
// field: a rate over both sides halves a fault that only one side has, and
// the side a player watches may be that one (The_Maze, section 17.3).
//
// A match played with the level's vehicles gets the vehicle figures as well
// (`vehicleFigures`): hulls driven at a wall, units nobody sat in, tank seats
// that never fired, team kills from a seat, and the mounted share.
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
/** The two sides a figure is split by: 1 Axis, 2 Allies. */
export const SIDES = [1, 2];
/** The rates kept by side, with the decimals the two-side rate is rounded to. */
export const SIDE_RATES = { stuckSeconds: 3, spawnTraps: 4, routeFailures: 3, redeploys: 4 };

/**
 * A seating in a tank's armed seat this long with no round fired is a silent
 * one. The verifier's own length: a tank that has driven for a minute on a
 * level with a fight has met something to shoot at.
 */
export const TANK_SEATING_SECONDS = 60;

const newSide = () => ({ aliveSeconds: 0, redeploys: 0, routeFailures: 0, byEnemy: 0, self: 0, byTeam: 0, drivingSeconds: 0 });

export function newDetector(header) {
  return {
    header, bots: new Map(), dt: (header.traceEvery ?? 1) / (header.tickHz ?? 30),
    // Each bot's side: the header's list, then whatever a tick or an event says.
    sides: new Map((header.bots ?? []).filter(b => SIDES.includes(b.side)).map(b => [b.id, b.side])),
    bySide: { 1: newSide(), 2: newSide() },
    // With vehicles: the mounted and the driving seconds, the hulls' stuck
    // episodes, the units sat in and driven, every seating, the tank seats
    // seen to fire, and the team kills made from a seat.
    mountedSeconds: 0, drivingSeconds: 0, hullStuck: [], unitsUsed: new Set(), unitsDriven: new Set(),
    seatings: [], seated: new Map(), tankSeats: new Set(), mountedTeamKills: 0,
    aliveSeconds: 0, idleSeconds: 0, stuck: [], oscillations: 0, selfDeaths: 0, deaths: 0, traps: [],
    teamKills: 0, enemyKills: { 1: 0, 2: 0 },
    changed: new Set(), captures: { 1: 0, 2: 0 }, firstCapture: null, heat: new Map(), spawns: new Map(),
    behaviour: {},
  };
}

/** How near an order's point must be to a flag to count as that flag's, metres. */
export const OBJECTIVE_REACH = 25;

function objectiveOf(d, o) {
  const p = o.order?.point;
  if (p) {
    let best = null, bestD = OBJECTIVE_REACH;
    for (const f of d.header.flags ?? []) {
      if (!f.pos) continue;
      const dist = Math.hypot(f.pos[0] - p[0], f.pos[2] - p[1]);
      if (dist < bestD) { bestD = dist; best = f.name; }
    }
    if (best) return 'flag:' + best;
  }
  return o.area ?? (p ? p.map(v => Math.round(v)).join('/') : null);
}

/** The bot's side, 1 or 2, or null when nothing in the trace has said. */
function sideOf(d, id, said = null) {
  if (SIDES.includes(said)) { if (id != null) d.sides.set(id, said); return said; }
  return d.sides.get(id) ?? null;
}

function botState(d, id) {
  let b = d.bots.get(id);
  if (!b) { b = { track: [], stuckSince: null, stuckAt: null, orders: [], lastKey: null, hull: null, hullTrack: [], hullSince: null, hullAt: null }; d.bots.set(id, b); }
  return b;
}

function closeHullStuck(d, id, b, t) {
  if (b.hullSince !== null) {
    d.hullStuck.push({ bot: id, t: b.hullSince, seconds: +(t - b.hullSince).toFixed(1), pos: b.hullAt, vehicle: b.hull?.id ?? null, template: b.hull?.template ?? null });
  }
  b.hullSince = null; b.hullAt = null;
}

/**
 * A hull driven at a wall: the driver holds the throttle, forward or back,
 * and the hull has moved less than `STUCK_MOVE` in `STUCK_WINDOW` s, the
 * soldier's window on the hull's position. Whatever the driver's behaviour:
 * a tank pushing at a house while it fires is as stuck as one on its way.
 */
function hullTick(d, o, b, side) {
  const v = o.veh ?? null;
  if (v) {
    d.mountedSeconds += d.dt;
    d.unitsUsed.add(v.id);
  }
  if (v?.drives) {
    d.drivingSeconds += d.dt;
    if (side) d.bySide[side].drivingSeconds += d.dt;
    d.unitsDriven.add(v.id);
  }
  const pushing = !!v?.drives && Array.isArray(o.ctl) && o.ctl[0] !== 0;
  if (!pushing || b.hull?.id !== v.id) { closeHullStuck(d, o.bot, b, o.t); b.hullTrack.length = 0; }
  b.hull = v;
  if (!pushing) return;
  b.hullTrack.push([o.t, o.pos[0], o.pos[2], o.pos[1]]);
  while (b.hullTrack.length && o.t - b.hullTrack[0][0] > STUCK_WINDOW) b.hullTrack.shift();
  const first = b.hullTrack[0];
  const spanned = o.t - first[0] >= STUCK_WINDOW - d.dt * 1.5;
  const moved = Math.hypot(o.pos[0] - first[1], o.pos[2] - first[2]);
  if (spanned && moved < STUCK_MOVE) {
    if (b.hullSince === null) { b.hullSince = first[0]; b.hullAt = [+first[1].toFixed(1), +first[3].toFixed(1), +first[2].toFixed(1)]; }
  } else closeHullStuck(d, o.bot, b, o.t);
}

/** End the bot's seating, if it has one. */
function closeSeating(d, bot, t) {
  const s = d.seated.get(bot);
  if (!s) return;
  s.seconds = +(t - s.t).toFixed(2);
  d.seated.delete(bot);
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
    // A new life is a new run of decisions: dying on the way to A, standing
    // up at B and going back to A is one objective, not a change of mind.
    const side = sideOf(d, o.bot, o.side);
    if (!o.alive) {
      closeStuck(d, o.bot, b, o.t); b.track.length = 0; b.orders.length = 0; b.lastKey = null;
      closeHullStuck(d, o.bot, b, o.t); b.hullTrack.length = 0; b.hull = null;
      return;
    }
    d.aliveSeconds += d.dt;
    if (side) d.bySide[side].aliveSeconds += d.dt;
    hullTick(d, o, b, side);
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
    // The objective is the flag the order's point is at, whatever kind of
    // order names it (an area's, or the walk into a narrow flag's ring);
    // else the area, else the point. A bot with no order has none.
    const okey = objectiveOf(d, o);
    if (okey && okey !== b.lastKey) {
      b.orders.push([o.t, okey]);
      if (b.orders.length > 3) b.orders.shift();
      const n = b.orders.length;
      if (n === 3 && b.orders[0][1] === b.orders[2][1] && b.orders[2][0] - b.orders[0][0] <= OSCILLATION_WINDOW) d.oscillations++;
      b.lastKey = okey;
    }
  } else if (o.k === 'ev') {
    if (o.type === 'respawn') d.spawns.set(o.bot, { t: o.t, pos: o.pos });
    // The no-progress redeploy and a failed route, by the bot's side. The
    // runner writes a redeploy as its own event: no kill line, no death on
    // the bot's line of the summary, no ticket (`sim/match.mjs onRedeploy`).
    else if (o.type === 'redeploy' || o.type === 'route_failed') {
      const side = sideOf(d, o.bot, o.side);
      if (side) d.bySide[side][o.type === 'redeploy' ? 'redeploys' : 'routeFailures']++;
    } else if (o.type === 'mount') {
      // A seat taken: a new seating, and the end of the one the bot switched from.
      closeSeating(d, o.bot, o.t);
      const s = { bot: o.bot, side: sideOf(d, o.bot, o.side), vehicle: o.vehicle, template: o.template, seat: o.seat, driver: !!o.driver, t: o.t, seconds: null, fired: false };
      d.seatings.push(s); d.seated.set(o.bot, s);
      d.unitsUsed.add(o.vehicle);
      if (o.driver) d.unitsDriven.add(o.vehicle);
    } else if (o.type === 'dismount') closeSeating(d, o.bot, o.t);
    else if (o.type === 'vehicle_fire') {
      // The first pull of a seat's gun in a seating. A tank's names the seat as an armed one.
      const s = d.seated.get(o.bot);
      if (s && s.vehicle === o.vehicle) s.fired = true;
      if (o.kind === 'tank') d.tankSeats.add(`${o.template}|${o.seat}`);
    } else if (o.type === 'kill') {
      d.deaths++;
      const self = !o.killer || o.killer === o.victim;
      const victimSide = sideOf(d, o.victim, o.victimSide);
      if (self) d.selfDeaths++;
      // A kill of a soldier on the killer's own side is a team kill, not a fight.
      else if (o.killerSide === o.victimSide) { d.teamKills++; if (d.seated.has(o.killer)) d.mountedTeamKills++; }
      else d.enemyKills[o.killerSide] = (d.enemyKills[o.killerSide] ?? 0) + 1;
      // The same three, on the line of the side that lost the soldier.
      if (victimSide) d.bySide[victimSide][self ? 'self' : o.killerSide === o.victimSide ? 'byTeam' : 'byEnemy']++;
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
  for (const [id, b] of d.bots) { closeStuck(d, id, b, t); closeHullStuck(d, id, b, t); }
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
  const sides = sideFigures(d, summary);
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
    oscillations: d.oscillations, oscillationsPerBotMinute: +(d.oscillations / minutes).toFixed(4),
    selfDeaths: d.selfDeaths, selfDeathsPerBotMinute: +(d.selfDeaths / minutes).toFixed(4),
    deaths: d.deaths,
    teamKills: d.teamKills, teamKillsPerBotMinute: +(d.teamKills / minutes).toFixed(4),
    enemyKills: { 1: d.enemyKills[1] ?? 0, 2: d.enemyKills[2] ?? 0 },
    enemyKillsPerBotMinute: +(((d.enemyKills[1] ?? 0) + (d.enemyKills[2] ?? 0)) / minutes).toFixed(4),
    spawnTraps: d.traps.length, spawnTrapsPerBotMinute: +(d.traps.length / minutes).toFixed(4),
    routeFailuresPerBotMinute: +(total(m.routeFailures) / minutes).toFixed(3),
    redeploysPerBotMinute: +(total(m.redeploys) / minutes).toFixed(4),
    ...sides,
    ...(d.header.vehicles > 0 ? vehicleFigures(d, t) : {}),
    botErrors: total(m.botErrors),
    winner: summary?.result?.winner ?? null, reason: summary?.result?.reason ?? null, tickets,
    ticketsBled: start && tickets ? { 1: start[1] - tickets[1], 2: start[2] - tickets[2] } : null,
    behaviourShare: Object.fromEntries(Object.entries(d.behaviour).map(([k, v]) => [k, +(v / Math.max(1e-9, d.aliveSeconds)).toFixed(3)])),
    heat: [...d.heat.entries()].map(([k, v]) => [k, +v.toFixed(1)]),
  };
}

const bothSides = f => Object.fromEntries(SIDES.map(s => [s, f(s)]));

/** The greater of the two sides' figures; a side with none (null) is left out, and with neither there is none. */
export function worseSide(bySide) {
  const v = SIDES.map(s => bySide?.[s]).filter(x => Number.isFinite(x));
  return v.length ? Math.max(...v) : null;
}

/**
 * The row's figures by side. A rate is the side's count over the side's own
 * bot-minutes (its bots' traced alive seconds), and `...WorseSide` the
 * greater of the two.
 *
 * Counts: stuck seconds and spawn traps by the side of the bot the episode
 * or the trap is; redeploys and route failures from the summary's `perBot`
 * lines, which the two-side rates' totals are the sums of, or from the
 * trace's `redeploy` and `route_failed` events when there is no summary.
 *
 * `nonEnemyDeathShare`: of the times a side's soldier was taken off the
 * field, the share that no enemy caused. The numerator `notEnemy` is the
 * side's redeploys, its deaths with no killer or by the soldier's own hand
 * (`self`) and its soldiers killed by their own side (`byTeam`); the
 * denominator `shown` is that plus its soldiers killed by the enemy
 * (`byEnemy`). A side with nothing to show (no death, no redeploy) has no
 * share: null. The worse side is the greater of the shares there are, and
 * null when neither side has one.
 *
 * INVENTION: the redeploy is the page's own (ledger AI-101), so a death
 * count with redeploys in it has no counterpart in the retail engine.
 */
export function sideFigures(d, summary = null) {
  const perBot = summary?.perBot ? Object.values(summary.perBot) : null;
  const fromSummary = k => bothSides(s => perBot.filter(b => b.side === s).reduce((n, b) => n + (b[k] ?? 0), 0));
  const sideOfBot = id => d.sides.get(id) ?? null;
  const count = {
    stuckSeconds: bothSides(s => +d.stuck.filter(e => sideOfBot(e.bot) === s).reduce((n, e) => n + e.seconds, 0).toFixed(1)),
    spawnTraps: bothSides(s => d.traps.filter(t => sideOfBot(t.bot) === s).length),
    routeFailures: perBot ? fromSummary('routeFailures') : bothSides(s => d.bySide[s].routeFailures),
    redeploys: perBot ? fromSummary('redeploys') : bothSides(s => d.bySide[s].redeploys),
  };
  const minutes = bothSides(s => d.bySide[s].aliveSeconds / 60);
  const out = { botMinutesBySide: bothSides(s => +minutes[s].toFixed(2)) };
  for (const [k, digits] of Object.entries(SIDE_RATES)) {
    const rate = bothSides(s => (minutes[s] > 0 ? +(count[k][s] / minutes[s]).toFixed(digits) : null));
    out[`${k}BySide`] = count[k];
    out[`${k}PerBotMinuteBySide`] = rate;
    out[`${k}PerBotMinuteWorseSide`] = worseSide(rate);
  }
  const deaths = bothSides(s => {
    const { byEnemy, self, byTeam } = d.bySide[s];
    const notEnemy = count.redeploys[s] + self + byTeam;
    return { byEnemy, self, byTeam, redeploys: count.redeploys[s], notEnemy, shown: notEnemy + byEnemy };
  });
  const share = bothSides(s => (deaths[s].shown > 0 ? +(deaths[s].notEnemy / deaths[s].shown).toFixed(4) : null));
  return { ...out, deathsBySide: deaths, nonEnemyDeathShareBySide: share, nonEnemyDeathShareWorseSide: worseSide(share) };
}

/**
 * The figures of a match played with the level's vehicles in (the header's
 * `vehicles` over 0), each a thing a player would notice.
 *
 * `hullStuckSecondsPerDrivingMinute`: the seconds of `hullTick`'s episodes
 * over the minutes a bot sat in a driver's seat, also by side and for the
 * worse side.
 *
 * `unitsNeverUsedShare`: of the units the bots can take (the header's count:
 * every hull and fixed gun with AI data, of any kind), the share no bot sat
 * in all match. The trace names a unit only when a bot mounts it, so the
 * ones left out cannot be told apart by kind: it is not "land hulls".
 *
 * `tankSilentShare`: of the seatings of at least `TANK_SEATING_SECONDS` in a
 * tank's armed seat, the share in which the seat's gun was never fired. An
 * armed seat is a template's seat that a `vehicle_fire` of kind `tank` names
 * somewhere in the same trace; a mount names no kind, so a seat nobody fires
 * from all match is not counted at all. Null with no such seating.
 *
 * `mountedTeamKillsPerBotMinute`: team kills whose killer was in a seat. A
 * soldier run over is not among them: no hull's collision hurts a bot's
 * soldier in the runner, so the trace has no such death to count.
 *
 * `mountedShare`: mounted seconds over alive seconds. Context, not a fault.
 */
export function vehicleFigures(d, endT) {
  for (const bot of [...d.seated.keys()]) closeSeating(d, bot, endT);
  const minutes = Math.max(1e-9, d.aliveSeconds / 60);
  const driving = bothSides(s => d.bySide[s].drivingSeconds / 60);
  const stuck = bothSides(s => +d.hullStuck.filter(e => (d.sides.get(e.bot) ?? null) === s).reduce((n, e) => n + e.seconds, 0).toFixed(1));
  const rate = bothSides(s => (driving[s] > 0 ? +(stuck[s] / driving[s]).toFixed(3) : null));
  const places = new Map();
  for (const e of d.hullStuck) {
    const key = `${Math.round(e.pos[0] / 4) * 4},${Math.round(e.pos[2] / 4) * 4}`;
    const p = places.get(key) ?? { at: key, episodes: 0, seconds: 0, templates: [] };
    p.episodes++; p.seconds += e.seconds;
    if (e.template && !p.templates.includes(e.template)) p.templates.push(e.template);
    places.set(key, p);
  }
  const units = d.header.vehicles;
  const tank = d.seatings.filter(s => s.seconds >= TANK_SEATING_SECONDS && d.tankSeats.has(`${s.template}|${s.seat}`));
  const silent = tank.filter(s => !s.fired).length;
  return {
    units, unitsUsed: d.unitsUsed.size, unitsDriven: d.unitsDriven.size,
    unitsNeverUsedShare: +(Math.max(0, units - d.unitsUsed.size) / units).toFixed(4),
    mountedShare: +(d.mountedSeconds / Math.max(1e-9, d.aliveSeconds)).toFixed(4),
    drivingMinutes: +(d.drivingSeconds / 60).toFixed(2), drivingMinutesBySide: bothSides(s => +driving[s].toFixed(2)),
    hullStuckEpisodes: d.hullStuck.length,
    hullStuckSecondsPerDrivingMinute: d.drivingSeconds > 0 ? +(d.hullStuck.reduce((n, e) => n + e.seconds, 0) / (d.drivingSeconds / 60)).toFixed(3) : null,
    hullStuckSecondsBySide: stuck, hullStuckSecondsPerDrivingMinuteBySide: rate, hullStuckSecondsPerDrivingMinuteWorseSide: worseSide(rate),
    hullStuckPlaces: [...places.values()].sort((p, q) => q.seconds - p.seconds).slice(0, 8).map(p => ({ ...p, seconds: +p.seconds.toFixed(1) })),
    seatings: d.seatings.length, tankSeatings: tank.length, tankSeatingsSilent: silent,
    tankSilentShare: tank.length ? +(silent / tank.length).toFixed(4) : null,
    mountedTeamKills: d.mountedTeamKills, mountedTeamKillsPerBotMinute: +(d.mountedTeamKills / minutes).toFixed(4),
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
