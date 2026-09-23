#!/usr/bin/env node
// The headless match runner. See sim/README.md for the usage and the trace
// schema.
//
//   node sim/run.mjs [--map <dir> | --synthetic] [--bots N] [--time T] [--seed S] ...
//   node sim/run.mjs --replay-summary <trace.jsonl>
//   node sim/run.mjs --why <botId> <time> --trace <trace.jsonl>

import { mkdirSync, openSync, writeSync, closeSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { viewerDir, loadViewerModules, seedMathRandom } from './env.mjs';
import { syntheticLevel, realLevel } from './level.mjs';
import { Match } from './match.mjs';
import { replaySummary, why } from './report.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const a = { level: null, bots: 4, time: 120, seed: 1, skill: 0.75, traceEvery: 1, sampleEvery: 1,
              vehicles: true, out: null, maps: null, models: null, viewer: null, quiet: false,
              replay: null, why: null, trace: null, step: 30, noTrace: false, doctrine: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const next = () => { if (i + 1 >= argv.length) throw new Error(`${k} needs a value`); return argv[++i]; };
    switch (k) {
      case '--synthetic': a.level = 'synthetic'; break;
      case '--map': a.level = next(); break;
      case '--maps': a.maps = next(); break;
      case '--models': a.models = next(); break;
      case '--viewer': a.viewer = next(); break;
      case '--bots': a.bots = Number(next()); break;
      case '--time': a.time = Number(next()); break;
      case '--seed': a.seed = Number(next()); break;
      case '--skill': a.skill = Number(next()); break;
      case '--trace-every': a.traceEvery = Number(next()); break;
      case '--sample-every': a.sampleEvery = Number(next()); break;
      case '--no-vehicles': a.vehicles = false; break;
      case '--no-trace': a.noTrace = true; break;
      case '--doctrine': a.doctrine = next(); break;
      case '--out': a.out = next(); break;
      case '--quiet': a.quiet = true; break;
      case '--replay-summary': a.replay = next(); break;
      case '--step': a.step = Number(next()); break;
      case '--why': a.why = { bot: next(), time: Number(next()) }; break;
      case '--trace': a.trace = next(); break;
      case '-h': case '--help': a.help = true; break;
      default: throw new Error(`unknown argument ${k} (try --help)`);
    }
  }
  return a;
}

const HELP = `usage:
  node sim/run.mjs [--synthetic | --map <level dir>] [options]    run a match
  node sim/run.mjs --replay-summary <trace.jsonl> [--step 30]      print a timeline
  node sim/run.mjs --why <botId> <time> --trace <trace.jsonl>      inspect one decision

match options:
  --bots N          bots a side (default 4)
  --time T          game seconds (default 120); a side at 0 tickets ends it early
  --seed S          the random seed (default 1); the same seed replays the same match
  --skill A         botSkill (default 0.75, the engine's)
  --trace-every K   trace every K-th 30 Hz tick (default 1)
  --sample-every S  tickets/flags sample period in seconds (default 1)
  --no-vehicles     leave the level's land vehicles out
  --no-trace        write the summary only
  --doctrine D      each side's doctrine (viewer/doctrine.js): 'sai' (default,
                    the engine's SAI), 'squad', or per side 'axis=squad,allies=sai'
  --out DIR         output directory (default sim/out/<level>-s<seed>)
  --maps DIR        the extracted maps tree (default <viewer>/maps)
  --models DIR      the extracted models tree (default <viewer>/models)
  --viewer DIR      the viewer to load the AI from (default ../viewer)
  --quiet           no progress on stderr`;

async function runMatch(a) {
  const viewer = viewerDir(a.viewer);
  const M = await loadViewerModules(viewer);
  // Seeded before anything is built: the kit draw, the strategic roulette,
  // the sense rays' jitter and every other draw come from this stream.
  seedMathRandom(a.seed);
  const levelName = a.level ?? 'synthetic';
  const level = levelName === 'synthetic'
    ? syntheticLevel(M, { vehicles: a.vehicles })
    : await realLevel(M, { maps: a.maps ?? path.join(viewer, 'maps'), models: a.models ?? path.join(viewer, 'models'), map: levelName });
  // Re-seed after the level load so a real level's load order cannot move
  // the match's first draw.
  seedMathRandom(a.seed);
  // The doctrine names, checked before the match is built (an unknown one throws).
  const doctrine = M.parseDoctrineSpec(a.doctrine);
  const tag = doctrine[1] === 'sai' && doctrine[2] === 'sai' ? '' : `-${doctrine[1]}-${doctrine[2]}`;
  const outDir = path.resolve(a.out ?? path.join(HERE, 'out', `${level.name}-s${a.seed}${tag}`));
  mkdirSync(outDir, { recursive: true });
  const traceFile = path.join(outDir, 'trace.jsonl');
  const fd = a.noTrace ? null : openSync(traceFile, 'w');
  let buffer = [];
  const flush = () => { if (fd !== null && buffer.length) { writeSync(fd, buffer.join('\n') + '\n'); } buffer = []; };
  const sink = (line) => { if (fd === null) return; buffer.push(line); if (buffer.length >= 2000) flush(); };
  const match = new Match({ M, level, botsPerSide: a.bots, botSkill: a.skill, duration: a.time, seed: a.seed,
                            traceEvery: a.traceEvery, sampleEvery: a.sampleEvery, vehicles: a.vehicles, sink,
                            doctrine: a.doctrine });
  const started = performance.now();
  match.setup();
  let lastReport = 0;
  while (match.step()) {
    if (!a.quiet && match.clock - lastReport >= 30) {
      lastReport = match.clock;
      process.stderr.write(`  t=${Math.round(match.clock)} s  tickets ${match.tickets[1].toFixed(1)} / ${match.tickets[2].toFixed(1)}  `
                           + `${Math.round(performance.now() - started)} ms\n`);
    }
  }
  const summary = match.summary(performance.now() - started);
  // The trace's last line: the summary without the wall-clock parts, so the
  // file is byte-identical for a seed.
  match.emit({ k: 'summary', ...summary, trace: undefined, runtime: undefined, level_info: undefined, doctrine: undefined });
  flush();
  if (fd !== null) closeSync(fd);
  writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  const m = summary.metrics;
  const lines = [
    `level ${summary.level}  seed ${summary.seed}  ${summary.botsPerSide} a side  ${summary.duration} s  (${summary.runtime.wallMs} ms)`,
    `result: ${summary.result.reason}, tickets Axis ${summary.result.tickets[1]} / Allies ${summary.result.tickets[2]}`
      + `${summary.result.winner ? `, ${summary.result.winner === 1 ? 'Axis' : 'Allies'} ahead` : ', level'}`,
    `captures ${m.captures.total} (Axis ${m.captures[1]}, Allies ${m.captures[2]}), first ${m.timeToFirstCapture ? `${m.timeToFirstCapture.flag} at ${m.timeToFirstCapture.t} s` : 'none'}`,
    `kills Axis ${m.kills[1]} / Allies ${m.kills[2]}, deaths per capture ${m.deathsPerCapture ?? '-'}`,
    `vehicles ${m.vehicleUtilisation.vehicles}, mounts ${m.vehicleUtilisation.mounts}, mounted share ${m.vehicleUtilisation.mountedShare}`,
    `route failures ${m.routeFailures.total}, redeploys ${m.redeploys}, strategy changes ${m.strategyChanges}`
      + `${m.botErrors ? `, BOT ERRORS ${m.botErrors} (see the bot_error events)` : ''}`,
    `doctrine Axis ${summary.doctrine.sides[1]} / Allies ${summary.doctrine.sides[2]}`,
    `out: ${outDir}`,
  ];
  process.stdout.write(lines.join('\n') + '\n');
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a.help) { process.stdout.write(HELP + '\n'); return; }
  if (a.replay) { await replaySummary(a.replay, { step: a.step }); return; }
  if (a.why) {
    let file = a.trace;
    if (!file) throw new Error('--why needs --trace <trace.jsonl>');
    if (existsSync(file) && !file.endsWith('.jsonl')) file = path.join(file, 'trace.jsonl');
    await why(file, a.why.bot, a.why.time);
    return;
  }
  await runMatch(a);
}

main().catch(err => { process.stderr.write(`${err.stack ?? err}\n`); process.exit(1); });
