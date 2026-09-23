#!/usr/bin/env node
// Doctrine comparison: run seeded matches per level and doctrine setting and
// print the per-side metrics side by side (features/bot-doctrines/README.md).
//
//   node sim/compare.mjs --maps el_alamein,bocage --seeds 1-10 --time 600 \
//        --configs sai,axis=squad,allies=squad --jobs 8 --out sim/out/compare
//   node sim/compare.mjs --out sim/out/compare --report-only --markdown table.md
//
// Every match is `run.mjs --no-trace` into <out>/<map>/<config>/s<seed>; a
// run whose summary.json is already there is not run again (--force re-runs).
// A config is a `--doctrine` spec: 'sai' is the engine's SAI on both sides
// (the baseline), 'axis=squad' the squad play for the Axis against the SAI.
// Running each play once per side and comparing it with the same side's
// baseline takes the level's own asymmetry out of the difference.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SIDE = { 1: 'Axis', 2: 'Allies' };

function parseArgs(argv) {
  const a = { maps: ['el_alamein', 'bocage'], seeds: range('1-10'), time: 600, bots: 8, jobs: 8,
              configs: ['sai', 'axis=squad', 'allies=squad'], out: path.join(HERE, 'out', 'compare'),
              mapsDir: null, modelsDir: null, reportOnly: false, force: false, markdown: null, extra: [] };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const next = () => { if (i + 1 >= argv.length) throw new Error(`${k} needs a value`); return argv[++i]; };
    switch (k) {
      case '--maps': a.maps = next().split(',').filter(Boolean); break;
      case '--seeds': a.seeds = range(next()); break;
      case '--time': a.time = Number(next()); break;
      case '--bots': a.bots = Number(next()); break;
      case '--jobs': a.jobs = Number(next()); break;
      case '--configs': a.configs = next().split(';').flatMap(s => s.split(/\s+/)).filter(Boolean); break;
      case '--out': a.out = path.resolve(next()); break;
      case '--maps-dir': a.mapsDir = next(); break;
      case '--models-dir': a.modelsDir = next(); break;
      case '--report-only': a.reportOnly = true; break;
      case '--force': a.force = true; break;
      case '--markdown': a.markdown = next(); break;
      case '-h': case '--help': a.help = true; break;
      default: throw new Error(`unknown argument ${k} (try --help)`);
    }
  }
  return a;
}

/** '1-10' or '1,3,5' or '1-3,7'. */
function range(spec) {
  const out = [];
  for (const part of String(spec).split(',')) {
    const m = part.match(/^(\d+)-(\d+)$/);
    if (m) for (let s = Number(m[1]); s <= Number(m[2]); s++) out.push(s);
    else if (part) out.push(Number(part));
  }
  return out;
}

const slug = (config) => config.replace(/[=,]/g, '_');

const HELP = `usage: node sim/compare.mjs [options]
  --maps a,b          levels (default el_alamein,bocage; 'synthetic' for the harness level)
  --seeds 1-10        seeds (ranges and lists)
  --time T            game seconds per match (default 600)
  --bots N            bots a side (default 8)
  --configs a b c     --doctrine specs, space or ';' separated (default: sai axis=squad allies=squad)
  --jobs J            matches at once (default 8)
  --out DIR           where the runs go (default sim/out/compare)
  --maps-dir DIR, --models-dir DIR   the extracted trees (run.mjs --maps / --models)
  --report-only       read the summaries that are there, run nothing
  --force             re-run matches that already have a summary
  --markdown FILE     also write the table as markdown`;

function runOne(a, map, config, seed) {
  const out = path.join(a.out, map, slug(config), `s${seed}`);
  if (!a.force && existsSync(path.join(out, 'summary.json'))) return Promise.resolve({ map, config, seed, skipped: true });
  mkdirSync(out, { recursive: true });
  const args = [path.join(HERE, 'run.mjs'), ...(map === 'synthetic' ? ['--synthetic'] : ['--map', map]),
                '--bots', String(a.bots), '--time', String(a.time), '--seed', String(seed),
                '--doctrine', config, '--no-trace', '--quiet', '--out', out];
  if (a.mapsDir) args.push('--maps', a.mapsDir);
  if (a.modelsDir) args.push('--models', a.modelsDir);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', d => { err += d; });
    child.on('close', code => (code === 0 ? resolve({ map, config, seed })
      : reject(new Error(`${map} ${config} s${seed} exited ${code}:\n${err.slice(-2000)}`))));
  });
}

async function runAll(a) {
  const queue = [];
  for (const map of a.maps) for (const config of a.configs) for (const seed of a.seeds) queue.push([map, config, seed]);
  let done = 0;
  const started = Date.now();
  const worker = async () => {
    while (queue.length) {
      const [map, config, seed] = queue.shift();
      const r = await runOne(a, map, config, seed);
      done++;
      process.stderr.write(`  [${done}] ${map} ${config} s${seed}${r.skipped ? ' (kept)' : ''}  ${Math.round((Date.now() - started) / 1000)} s\n`);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, a.jobs) }, worker));
}

// --- the numbers -------------------------------------------------------------

const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const sd = (xs) => {
  if (xs.length < 2) return null;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
};
const fmt = (v, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? '-' : v.toFixed(d));
const pm = (xs, d = 1) => (xs.length ? `${fmt(mean(xs), d)} ± ${fmt(sd(xs) ?? 0, d)}` : '-');

/** One side's numbers from one summary. */
function sideNumbers(s, side) {
  const other = side === 1 ? 2 : 1;
  const m = s.metrics;
  const per = Object.values(s.perBot).filter(b => b.side === side);
  const sum = (k) => per.reduce((t, b) => t + (b[k] ?? 0), 0);
  const alive = sum('aliveSeconds');
  const doc = s.doctrine ?? {};
  return {
    doctrine: doc.sides?.[side] ?? 'sai',
    tickets: s.result.tickets[side],
    margin: s.result.tickets[side] - s.result.tickets[other],
    win: s.result.winner === side ? 1 : 0,
    flagsHeld: doc.flagsHeldMean?.[side] ?? null,
    firstCapture: doc.firstCapture?.[side] ?? null,
    captures: m.captures[side] ?? 0,
    deaths: m.deaths[side] ?? 0,
    kills: m.kills[side] ?? 0,
    mountedShare: alive > 0 ? sum('mountedSeconds') / alive : 0,
    routeFailures: sum('routeFailures'),
    redeploys: sum('redeploys'),
    errors: sum('errors'),
    stats: doc.stats?.[side] ?? null,
  };
}

function load(a) {
  const rows = [];
  for (const map of a.maps) {
    for (const config of a.configs) {
      for (const seed of a.seeds) {
        const file = path.join(a.out, map, slug(config), `s${seed}`, 'summary.json');
        if (!existsSync(file)) continue;
        const s = JSON.parse(readFileSync(file, 'utf8'));
        rows.push({ map, config, seed, s, sides: { 1: sideNumbers(s, 1), 2: sideNumbers(s, 2) } });
      }
    }
  }
  return rows;
}

function table(a, rows) {
  const lines = [];
  const push = (l = '') => lines.push(l);
  push(`Doctrine comparison: ${a.bots} bots a side, ${a.time} s, seeds ${a.seeds.join(', ')}.`);
  push(`Configs: ${a.configs.join(', ')} (a side not named runs the engine's SAI).`);
  for (const map of a.maps) {
    const mapRows = rows.filter(r => r.map === map);
    if (!mapRows.length) continue;
    push();
    push(`### ${map}`);
    push();
    const cols = [];
    for (const config of a.configs) {
      const rs = mapRows.filter(r => r.config === config);
      if (!rs.length) continue;
      for (const side of [1, 2]) cols.push({ config, side, rs, label: `${config}: ${SIDE[side]} (${rs[0].sides[side].doctrine})` });
    }
    push(`| metric | ${cols.map(c => c.label).join(' | ')} |`);
    push(`|---|${cols.map(() => '---:').join('|')}|`);
    const metric = (name, f, d = 1) => {
      push(`| ${name} | ${cols.map(c => f(c.rs.map(r => r.sides[c.side]), c)).join(' | ')} |`);
      void d;
    };
    metric('runs', xs => String(xs.length));
    metric('tickets at the end', xs => pm(xs.map(x => x.tickets)));
    metric('ticket margin (side - other)', xs => pm(xs.map(x => x.margin)));
    metric('ahead at the end', xs => `${xs.reduce((t, x) => t + x.win, 0)} / ${xs.length}`);
    metric('control points held (time mean)', xs => pm(xs.map(x => x.flagsHeld).filter(v => v !== null), 2));
    metric('first capture, s (runs with one)', xs => {
      const t = xs.map(x => x.firstCapture).filter(v => v !== null);
      return `${pm(t, 0)} (${t.length}/${xs.length})`;
    });
    metric('captures', xs => pm(xs.map(x => x.captures)));
    metric('deaths', xs => pm(xs.map(x => x.deaths)));
    metric('kills', xs => pm(xs.map(x => x.kills)));
    metric('deaths per capture (pooled)', xs => {
      const c = xs.reduce((t, x) => t + x.captures, 0);
      return c ? fmt(xs.reduce((t, x) => t + x.deaths, 0) / c, 2) : '-';
    });
    metric('mounted share', xs => pm(xs.map(x => x.mountedShare), 2));
    metric('route failures', xs => pm(xs.map(x => x.routeFailures), 0));
    metric('redeploys', xs => pm(xs.map(x => x.redeploys)));
    metric('bot errors', xs => String(xs.reduce((t, x) => t + x.errors, 0)));
    const squadCols = cols.filter(c => c.rs[0].sides[c.side].stats);
    if (squadCols.length) {
      const st = (k, d = 1) => metric(`play: ${k}`, (xs) => {
        const v = xs.map(x => x.stats?.[k]).filter(u => u !== null && u !== undefined);
        return v.length ? pm(v, d) : '';
      });
      st('holds', 1); st('holdSeconds', 0); st('boardOrders', 1); st('boardings', 1); st('leaveOrders', 1);
      st('leaderChanges', 1); st('meanFollowerDistance', 1); st('withinRegroupShare', 2); st('sharedHullShare', 2);
    }
    // Each play against the same side's baseline, seed by seed.
    const base = mapRows.filter(r => r.config === 'sai');
    const deltas = [];
    for (const config of a.configs) {
      if (config === 'sai') continue;
      const rs = mapRows.filter(r => r.config === config);
      for (const side of [1, 2]) {
        if (!rs.length || rs[0].sides[side].doctrine === 'sai') continue;
        const paired = rs.map(r => [r, base.find(b => b.seed === r.seed)]).filter(([, b]) => b);
        if (!paired.length) continue;
        const d = (k) => paired.map(([r, b]) => (r.sides[side][k] ?? 0) - (b.sides[side][k] ?? 0));
        const better = paired.filter(([r, b]) => r.sides[side].margin > b.sides[side].margin).length;
        deltas.push(`| ${config} | ${SIDE[side]} | ${pm(d('margin'))} | ${better} / ${paired.length} | ${pm(d('flagsHeld'), 2)} | ${pm(d('captures'))} | ${pm(d('deaths'))} |`);
      }
    }
    if (deltas.length) {
      push();
      push('Against the same side under the SAI, paired by seed (play minus baseline):');
      push();
      push('| config | side | ticket margin | seeds better | control points held | captures | deaths |');
      push('|---|---|---:|---:|---:|---:|---:|');
      for (const l of deltas) push(l);
    }
  }
  return lines.join('\n') + '\n';
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a.help) { process.stdout.write(HELP + '\n'); return; }
  if (!a.reportOnly) await runAll(a);
  const rows = load(a);
  const md = table(a, rows);
  process.stdout.write(md);
  if (a.markdown) writeFileSync(a.markdown, md);
}

main().catch(err => { process.stderr.write(`${err.stack ?? err}\n`); process.exit(1); });
