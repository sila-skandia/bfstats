// The one entry point for generated bot layers (features/bot-map-generation):
//
//   node sim/botbatch.mjs baseline --maps <tree> --models <tree> --levels berlin,stalingrad,kharkov,bocage
//        builds sim/baselines/onfoot-dice.json from DICE's own layers
//   node sim/botbatch.mjs matrix   --maps <tree> --models <tree> --levels shigaisen_b
//        runs the seeded matrix on the tree as it is, detects and judges
//   node sim/botbatch.mjs level    --maps <tree> --models <tree> --mod bf1942 --levels shigaisen_b [--game-dir <dir>]
//        generates the layer, applies it with `patch_scene.py --layer ai`, lints, then as `matrix`
//   node sim/botbatch.mjs level ... --candidates ../../features/bot-map-generation/candidates.csv [--classes "contained on-foot"]
//        the same for every in-scope row of the candidates file whose level is in the tree
//
// A match is `sim/run.mjs` on foot (`--no-vehicles`), seeds 1..N at each side
// size; the verdict per level is written to <out>/<level>/verdict.json.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate, LAYERS_ROOT } from './botgen.mjs';
import { lintLevel } from './botlint.mjs';
import { detectRun } from './detect.mjs';
import { buildBaseline, judge, spread, unionCoverage } from './judge.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const BASELINE_FILE = path.join(HERE, 'baselines', 'onfoot-dice.json');
/** The classes of `candidates.csv` version one of the generator covers: on foot. */
export const IN_SCOPE = ['contained on-foot'];
/** `candidates.csv`'s tree column to the mod folder whose tree holds the level. */
const TREE_MOD = { community: 'bf1942', bf1942: 'bf1942' };

function runOne(args, cwd) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, args, { cwd, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', d => { err += d; });
    p.on('close', code => (code === 0 ? resolve() : reject(new Error(`run.mjs ${args.join(' ')}: ${err.slice(-400)}`))));
  });
}

/** Run the seeded matrix for one level; returns its detector rows. */
export async function runMatrix({ maps, models, level, out, seeds = 10, sizes = [8, 16], time = 600, traceEvery = 30, jobs = Math.max(1, Math.min(8, os.cpus().length - 2)), keepTraces = false, force = false }) {
  const tasks = [];
  for (const size of sizes) for (let seed = 1; seed <= seeds; seed++) tasks.push({ size, seed, dir: path.join(out, level, `b${size}`, `s${seed}`) });
  const rows = [];
  let next = 0;
  await Promise.all(Array.from({ length: jobs }, async () => {
    while (next < tasks.length) {
      const t = tasks[next++];
      const rowFile = path.join(t.dir, 'detect.json');
      if (!force && existsSync(rowFile)) { rows.push(JSON.parse(readFileSync(rowFile, 'utf8'))); continue; }
      mkdirSync(t.dir, { recursive: true });
      await runOne([path.join(HERE, 'run.mjs'), '--map', level, '--maps', maps, ...(models ? ['--models', models] : []),
                    '--bots', String(t.size), '--time', String(time), '--seed', String(t.seed), '--no-vehicles',
                    '--trace-every', String(traceEvery), '--quiet', '--out', t.dir], path.join(HERE, '..'));
      const row = await detectRun(t.dir);
      writeFileSync(rowFile, JSON.stringify(row) + '\n');
      if (!keepTraces) rmSync(path.join(t.dir, 'trace.jsonl'), { force: true });
      rows.push(row);
    }
  }));
  return rows.sort((a, b) => a.botsPerSide - b.botsPerSide || a.seed - b.seed);
}

/** The four movement rates the "better than nothing" comparison reads. */
export const MOVEMENT = ['stuckSecondsPerBotMinute', 'routeFailuresPerBotMinute', 'redeploysPerBotMinute', 'spawnTrapsPerBotMinute'];

/**
 * A layer that fails the bar against the same level with no layer, per side
 * size: it is better than nothing when it captures at least as much, at
 * least two movement rates fall by a quarter, and none rises by a quarter.
 */
export function betterThanNothing(rows, none) {
  const sizes = [...new Set(rows.map(r => r.botsPerSide))];
  const detail = {};
  let all = sizes.length > 0;
  for (const size of sizes) {
    const g = rows.filter(r => r.botsPerSide === size), n = none.filter(r => r.botsPerSide === size);
    if (!n.length) { all = false; continue; }
    const med = (set, k) => spread(set.map(r => r[k])).p50;
    const improved = MOVEMENT.filter(k => med(g, k) <= 0.75 * med(n, k));
    const worsened = MOVEMENT.filter(k => med(g, k) >= 1.25 * med(n, k) && med(g, k) > 0);
    const captures = med(g, 'capturesTotal') >= med(n, 'capturesTotal');
    detail[size] = { improved, worsened, captures: [med(g, 'capturesTotal'), med(n, 'capturesTotal')] };
    if (!(captures && improved.length >= 2 && worsened.length === 0)) all = false;
  }
  return { better: all, detail };
}

export function verdictOf(level, rows, baseline, lint = null, none = null) {
  const sizes = [...new Set(rows.map(r => r.botsPerSide))];
  const unreachable = lint?.facts?.unreachable ?? [];
  const judged = Object.fromEntries(sizes.map(s => [s, judge(rows.filter(r => r.botsPerSide === s), baseline, { unreachable })]));
  const lintOk = !lint || lint.errors.length === 0;
  const verdict = lintOk && Object.values(judged).every(j => j.verdict === 'pass') ? 'pass' : 'fail';
  // Balance: reported at every size, flagged when one side takes every seed at every size.
  const sides = Object.values(judged).map(j => j.balance?.oneSided ?? null);
  const oneSided = sides.length && sides.every(s => s && s === sides[0]) ? sides[0] : null;
  const versus = none && none.length ? betterThanNothing(rows, none) : null;
  const outcome = verdict === 'pass' ? 'pass' : versus ? (versus.better ? 'better-than-nothing' : 'no-better-than-nothing') : 'fail';
  return { level, verdict, outcome, oneSided, unreachable,
           lint: lint ? { errors: lint.errors, warnings: lint.warnings.map(w => w.text), facts: lint.facts } : null,
           sizes: judged, versusNothing: versus };
}

function candidateLevels(file, classes) {
  const [head, ...lines] = readFileSync(file, 'utf8').trim().split('\n');
  const cols = head.split(',');
  const at = n => cols.indexOf(n);
  return lines.map(l => l.split(',')).filter(c => classes.includes(c[at('class')]) && c[at('published')] === 'yes' && TREE_MOD[c[at('tree')]])
    .map(c => ({ level: c[at('level')].toLowerCase(), mod: TREE_MOD[c[at('tree')]] }));
}

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--force' || k === '--keep-traces' || k === '--no-generate') a[k.slice(2)] = true;
    else if (k.startsWith('--')) a[k.slice(2)] = argv[++i];
    else a._.push(k);
  }
  return a;
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const cmd = a._[0];
  if (!['baseline', 'matrix', 'level'].includes(cmd) || !a.maps) {
    console.error('usage: node sim/botbatch.mjs <baseline|matrix|level> --maps <tree> [--models <tree>] --levels a,b | --candidates <csv> [--classes c1;c2]\n'
      + '       [--mod bf1942] [--game-dir <dir>] [--archives <dir of level .rfa>] [--out <dir>] [--seeds 10] [--sizes 8,16] [--time 600] [--jobs N] [--baseline <file>] [--force] [--keep-traces] [--no-generate]');
    process.exit(2);
  }
  const maps = path.resolve(a.maps), models = a.models ? path.resolve(a.models) : null;
  const out = path.resolve(a.out ?? path.join(HERE, '..', 'out', 'bot-layers', cmd));
  const opts = { maps, models, out, seeds: Number(a.seeds ?? 10), sizes: String(a.sizes ?? '8,16').split(',').map(Number), time: Number(a.time ?? 600),
                 force: !!a.force, keepTraces: !!a['keep-traces'], ...(a.jobs ? { jobs: Number(a.jobs) } : {}) };
  let levels = a.levels ? a.levels.split(',').map(l => ({ level: l.toLowerCase(), mod: a.mod ?? 'bf1942' })) : [];
  if (a.candidates) levels = candidateLevels(path.resolve(a.candidates), (a.classes ?? IN_SCOPE.join(';')).split(';'));
  levels = levels.filter(l => existsSync(path.join(maps, l.level, 'scene.json')) || (console.error(`skip ${l.level}: not in ${maps}`), false));
  if (cmd === 'baseline') {
    const rows = [];
    for (const l of levels) { console.error(`baseline ${l.level}`); rows.push(...await runMatrix({ ...opts, level: l.level })); }
    const file = path.resolve(a.baseline ?? BASELINE_FILE);
    mkdirSync(path.dirname(file), { recursive: true });
    const slim = buildBaseline(rows, `DICE layers on foot: ${levels.map(l => l.level).join(', ')}; seeds 1..${opts.seeds}, ${opts.time} s, --no-vehicles`);
    writeFileSync(file, JSON.stringify(slim, null, 1) + '\n');
    console.log(`baseline: ${rows.length} matches -> ${file}`);
    return;
  }
  const baseline = JSON.parse(readFileSync(path.resolve(a.baseline ?? BASELINE_FILE), 'utf8'));
  let failed = 0;
  for (const l of levels) {
    let lint = null, none = null;
    const layerDir = path.join(a.layers ? path.resolve(a.layers) : LAYERS_ROOT, l.mod.toLowerCase(), l.level);
    const patch = env => spawnSync('python3', [path.join(HERE, '..', 'patch_scene.py'), '--layer', 'ai', '--mod', l.mod, '--tree', maps,
                                              ...(a['game-dir'] ? ['--game-dir', path.resolve(a['game-dir'])] : []), l.level],
                                   { encoding: 'utf8', env: { ...process.env, ...env } });
    if (cmd === 'level') {
      // The level with no layer first: the arm a failing layer is compared with.
      const off = patch({ BOT_LAYERS_OFF: '1' });
      if (off.status !== 0) { console.error(`${l.level}: patch_scene failed: ${(off.stderr || off.stdout).slice(-300)}`); failed++; continue; }
      none = await runMatrix({ ...opts, out: path.join(out, l.level, 'none'), level: l.level });
      // The engine's own search maps, when the level's archive is at hand and the layer has none.
      if (a.archives && !existsSync(path.join(layerDir, 'Pathfinding', 'Infantry1Level0Map.raw'))) {
        const hit = readdirSync(path.resolve(a.archives)).find(f => f.toLowerCase() === `${l.level}.rfa`);
        if (hit) {
          const eng = spawnSync('python3', [path.join(HERE, '..', 'engine_search_maps.py'), '--mod', l.mod, '--archive', path.join(path.resolve(a.archives), hit),
                                            '--out', layerDir], { encoding: 'utf8' });
          console.error(`${l.level}: ${(eng.stdout || eng.stderr).trim().split('\n').pop()}`);
        }
      }
      if (!a['no-generate']) {
        const g = await generate({ maps, models, map: l.level, mod: l.mod, out: a.layers ? path.resolve(a.layers) : LAYERS_ROOT });
        console.error(`${l.level}: generated ${g.dir} (${g.changed.length ? g.changed.length + ' files written' : 'up to date'})`);
      }
      // The scratch tree takes the layer whatever its last verdict: this run is what judges it.
      const on = patch({ BOT_LAYERS_UNVERIFIED: '1' });
      if (on.status !== 0) { console.error(`${l.level}: patch_scene failed: ${(on.stderr || on.stdout).slice(-300)}`); failed++; continue; }
      lint = await lintLevel({ maps, models, map: l.level, source: layerDir });
    }
    const rows = await runMatrix({ ...opts, out: cmd === 'level' ? path.join(out, l.level, 'generated') : out, level: l.level });
    const v = verdictOf(l.level, rows, baseline, lint, none);
    mkdirSync(path.join(out, l.level), { recursive: true });
    writeFileSync(path.join(out, l.level, 'verdict.json'), JSON.stringify(v, null, 1) + '\n');
    if (cmd === 'level') {
      // The layer's own record, which the bake's gate reads (`bf42/ai_level.py generated_layer_gate`).
      const marker = JSON.parse(readFileSync(path.join(layerDir, 'generated.json'), 'utf8'));
      const short = { level: l.level, verdict: v.verdict, outcome: v.outcome, generatorVersion: marker.version, inputs: marker.inputs,
                      baseline: baseline.note, seeds: opts.seeds, sizes: Object.fromEntries(Object.entries(v.sizes).map(([s, j]) => [s, { verdict: j.verdict, failed: j.failed, winners: j.balance?.split }])),
                      oneSided: v.oneSided, unreachable: v.unreachable, lintErrors: lint.errors.map(e => e.text) };
      writeFileSync(path.join(layerDir, 'verdict.json'), JSON.stringify(short, null, 1) + '\n');
    }
    if (v.verdict !== 'pass') failed++;
    console.log(`${l.level}: ${v.outcome}` + (lint ? `, lint ${lint.errors.length} errors` : '')
      + Object.entries(v.sizes).map(([s, j]) => `; ${s} a side ${j.verdict}${j.failed?.length ? ' (' + j.failed.join(', ') + ')' : ''}`).join(''));
  }
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
