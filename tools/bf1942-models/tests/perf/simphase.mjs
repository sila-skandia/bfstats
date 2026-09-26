#!/usr/bin/env node
// Phase-timed headless match on the viewer's own sim (sim/match.mjs), with
// an optional staged close-quarters infantry fight. Prints ms per 30 Hz tick
// per phase, the collider's casts per tick and their cost, and the fight's
// shots and hits. No browser: this is the sim half of a frame on its own.
//
//   node simphase.mjs --map el_alamein --bots 8 --time 60 --warm 10
//   node simphase.mjs --map berlin --bots 8 --stage Reichstag --restage 12 --gap 30
//   node simphase.mjs --viewer /path/to/other/checkout/viewer ...   # A/B a build
//
// `--stage <flag>` puts every bot on foot (the vehicles stay in the level but
// nobody boards) and lays the two sides out in lines `--gap` metres apart
// across the flag every `--restage` seconds, which is the "bots in a battle
// in close proximity" case (features/bot-fight-performance/README.md). The
// phases nest: `referee.tick` contains `bot.tick`, which contains the sense,
// decision and plan phases; `world.step` contains the soldier bodies.
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SIM = path.resolve(HERE, '..', '..', 'sim');
const ASSETS = path.resolve(HERE, '..', '..', 'viewer');
const imp = f => import(pathToFileURL(path.join(SIM, f)).href);
const { loadViewerModules, seedMathRandom, routeConsole } = await imp('env.mjs');
const { realLevel } = await imp('level.mjs');
const { Match } = await imp('match.mjs');

const a = { map: 'el_alamein', bots: 8, time: 60, warm: 10, seed: 3, stage: null, restage: 12, gap: 30,
            spacing: 3, foot: true, out: null, vehicles: true, viewer: null, assets: null };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const k = argv[i], v = () => argv[++i];
  if (k === '--map') a.map = v(); else if (k === '--bots') a.bots = +v(); else if (k === '--time') a.time = +v();
  else if (k === '--warm') a.warm = +v(); else if (k === '--seed') a.seed = +v(); else if (k === '--stage') a.stage = v();
  else if (k === '--restage') a.restage = +v(); else if (k === '--gap') a.gap = +v(); else if (k === '--spacing') a.spacing = +v();
  else if (k === '--viewer') a.viewer = v(); else if (k === '--assets') a.assets = v();
  else if (k === '--allow-vehicles') a.foot = false; else if (k === '--out') a.out = v(); else if (k === '--no-vehicles') a.vehicles = false;
  else throw new Error(`unknown ${k}`);
}
const V = a.viewer ? path.resolve(a.viewer) : ASSETS;
const assets = a.assets ? path.resolve(a.assets) : ASSETS;

const M = await loadViewerModules(V);
routeConsole(true);
seedMathRandom(a.seed);
const level = await realLevel(M, { maps: path.join(assets, 'maps'), models: path.join(assets, 'models'), map: a.map });
seedMathRandom(a.seed);
const match = new Match({ M, level, botsPerSide: a.bots, botSkill: 0.75, duration: a.time, seed: a.seed,
                          traceEvery: 1e9, sampleEvery: 1e9, vehicles: a.vehicles, sink: null, doctrine: null, seats: [] });

// --- instrumentation ---------------------------------------------------------
let acc = {};
const counts = {};
const add = (k, ms) => { acc[k] = (acc[k] || 0) + ms; };
const cnt = (k, n = 1) => { counts[k] = (counts[k] || 0) + n; };
function wrap(obj, name, key, count = false) {
  const o = obj[name];
  if (typeof o !== 'function') return;
  obj[name] = function (...args) {
    const t = performance.now();
    try { return o.apply(this, args); } finally { add(key, performance.now() - t); if (count) cnt(key); }
  };
}
const proto = M.BotController.prototype;
for (const n of ['_sensePass', '_decisionMaking', '_runPlan', '_pollPose', '_writeInput']) wrap(proto, n, `bot.${n}`);
wrap(proto, 'tick', 'bot.tick(all)');
wrap(proto, 'onShotFired', 'bot.onShotFired(hearing)');

match.setup();
const w = match.world, ref = match.referee, stage = match.stage;
wrap(w, 'step', 'world.step(all)');
if (w.guns) wrap(w.guns, 'advance', 'world.guns.advance');
if (w.bodyWorld) wrap(w.bodyWorld, 'step', 'world.bodyWorld.step');
{
  const anySoldier = [...w.players.values()].find(p => p.soldier)?.soldier;
  if (anySoldier) wrap(Object.getPrototypeOf(anySoldier), 'step', 'world.soldier.step (bodies)');
}
wrap(ref, 'tick', 'referee.tick(all)');
wrap(ref, 'fireTick', 'referee.fireTick');
wrap(ref, 'resolveShot', 'referee.resolveShot', true);
wrap(ref, 'captureTick', 'referee.captureTick');
wrap(ref, 'vehicleTick', 'referee.vehicleTick');
if (ref.strategy) wrap(ref.strategy, 'update', 'strategy.update');
if (stage) { wrap(stage, 'afterCapture', 'stage.afterCapture(vehicle bodies+matrix)'); wrap(stage, 'afterBots', 'stage.afterBots'); }
{
  const o = ref.resolveShot;
  ref.resolveShot = function (...args) { const r = o.apply(this, args); if (r) cnt('hits'); return r; };
}

// --- pin on foot and stage --------------------------------------------------
if (a.stage && a.foot) {
  for (const bot of match.bots) {
    Object.defineProperty(bot, 'vehicleCandidates', { get: () => [], set() {}, configurable: true });
    Object.defineProperty(bot, 'enterRequest', { get: () => null, set() {}, configurable: true });
  }
}
function flagOf(name) {
  const f = w.flags.find(x => x.name === name) ?? w.flags[0];
  return { f, pos: f.position ?? f.spawns?.[0]?.position };
}
function stageFight() {
  const { pos } = flagOf(a.stage);
  const [cx, , cz] = pos;
  const byTeam = { 1: [], 2: [] };
  for (const bot of match.bots) byTeam[bot.team]?.push(bot);
  let placed = 0;
  for (const team of [1, 2]) {
    const list = byTeam[team];
    const zc = cz + (team === 1 ? -a.gap / 2 : a.gap / 2);
    const yaw = team === 1 ? 0 : Math.PI;
    list.forEach((bot, i) => {
      if (w.armorOf(bot.playerId)?.destroyed || bot.vehicle) return;
      const x = cx + (i - (list.length - 1) / 2) * a.spacing + (Math.random() - 0.5);
      const z = zc + (Math.random() - 0.5) * 2;
      const y = match.groundAt(x, z, pos[1] + 5);
      const p = w.player(bot.playerId);
      if (!p?.soldier || !Number.isFinite(y)) return;
      p.soldier.spawn(x, y, z, yaw);
      bot.setPosition(x, y, z);
      bot.route = null;
      bot.onRespawn?.();
      placed++;
    });
  }
  return placed;
}

// --- run ---------------------------------------------------------------------
let measuring = false, startTick = 0, startClock = 0, nextStage = a.stage ? 3 : Infinity;
let hrStart = 0;
const perTick = [];
let staged = 0;
while (true) {
  if (!measuring && match.clock >= a.warm) {
    measuring = true; acc = {}; for (const k in counts) delete counts[k];
    w.collider.drainCost(); startTick = match.tickIndex; startClock = match.clock; hrStart = performance.now();
  }
  if (match.clock >= nextStage) { staged += stageFight(); nextStage += a.restage; }
  const t0 = performance.now();
  const more = match.step();
  if (measuring) perTick.push(performance.now() - t0);
  if (!more) break;
}
const wall = performance.now() - hrStart;
const ticks = match.tickIndex - startTick;
const cost = w.collider.drainCost();
const sorted = [...perTick].sort((x, y) => x - y);
const pct = p => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
const alive = match.bots.filter(b => !w.armorOf(b.playerId)?.destroyed).length;
const mounted = match.bots.filter(b => b.vehicle).length;
const lines = [];
lines.push(`${a.map} ${a.bots}x2 bots, ${a.stage ? `staged at ${a.stage} gap ${a.gap} m, restaged every ${a.restage} s (${staged} placements)` : 'natural match'}${a.viewer ? `, viewer ${V}` : ''}`);
lines.push(`measured ${ticks} ticks (${(match.clock - startClock).toFixed(1)} game s) in ${Math.round(wall)} ms wall: ${(wall / ticks).toFixed(2)} ms/tick mean, p50 ${pct(0.5).toFixed(2)}, p95 ${pct(0.95).toFixed(2)}, max ${pct(1).toFixed(2)}`);
lines.push(`alive ${alive}/${match.bots.length}, mounted ${mounted}; memory sizes ${match.bots.map(b => b.senses?.memory?.size ?? 0).join(',')}`);
lines.push(`collider casts ${cost.casts} (${(cost.casts / ticks).toFixed(1)}/tick, ${cost.microsPerCast.toFixed(1)} us each, ${(cost.microsTotal / 1000 / ticks).toFixed(2)} ms/tick); statics queries ${cost.statics?.queries} cells ${cost.statics?.cells} candidates ${cost.statics?.candidates} tests ${cost.statics?.tests}`);
lines.push(`shots ${counts['referee.resolveShot'] || 0} (${((counts['referee.resolveShot'] || 0) / ticks * 30).toFixed(1)}/s), hits ${counts.hits || 0}`);
lines.push('--- ms per tick by phase (wrapped; nested phases overlap their parents)');
for (const [k, v] of Object.entries(acc).sort((x, y) => y[1] - x[1])) lines.push(`  ${(v / ticks).toFixed(3).padStart(8)}  ${k}`);
process.stdout.write(lines.join('\n') + '\n');
if (a.out) writeFileSync(a.out, JSON.stringify({ a, ticks, wall, acc, counts, cost, perTickP: { p50: pct(0.5), p95: pct(0.95), max: pct(1) } }, null, 2));
