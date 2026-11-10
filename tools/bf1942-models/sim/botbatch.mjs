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
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate, LAYERS_ROOT } from './botgen.mjs';
import { lintLevel } from './botlint.mjs';
import { detectRun } from './detect.mjs';
import { buildBaseline, judge } from './judge.mjs';

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

export function verdictOf(level, rows, baseline, lint = null) {
  const sizes = [...new Set(rows.map(r => r.botsPerSide))];
  const judged = Object.fromEntries(sizes.map(s => [s, judge(rows.filter(r => r.botsPerSide === s), baseline)]));
  const lintOk = !lint || lint.errors.length === 0;
  const verdict = lintOk && Object.values(judged).every(j => j.verdict === 'pass') ? 'pass' : 'fail';
  return { level, verdict, lint: lint ? { errors: lint.errors, warnings: lint.warnings.length, facts: lint.facts } : null, sizes: judged };
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
      + '       [--mod bf1942] [--game-dir <dir>] [--out <dir>] [--seeds 10] [--sizes 8,16] [--time 600] [--jobs N] [--baseline <file>] [--force] [--keep-traces] [--no-generate]');
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
    let lint = null;
    if (cmd === 'level') {
      if (!a['no-generate']) {
        const g = await generate({ maps, models, map: l.level, mod: l.mod, out: a.layers ? path.resolve(a.layers) : LAYERS_ROOT });
        console.error(`${l.level}: generated ${g.dir} (${g.changed.length ? g.changed.length + ' files written' : 'up to date'})`);
      }
      const patch = spawnSync('python3', [path.join(HERE, '..', 'patch_scene.py'), '--layer', 'ai', '--mod', l.mod, '--tree', maps,
                                          ...(a['game-dir'] ? ['--game-dir', path.resolve(a['game-dir'])] : []), l.level], { encoding: 'utf8' });
      if (patch.status !== 0) { console.error(`${l.level}: patch_scene failed: ${(patch.stderr || patch.stdout).slice(-300)}`); failed++; continue; }
      lint = await lintLevel({ maps, models, map: l.level, source: path.join(a.layers ? path.resolve(a.layers) : LAYERS_ROOT, l.mod.toLowerCase(), l.level) });
    }
    const rows = await runMatrix({ ...opts, level: l.level });
    const v = verdictOf(l.level, rows, baseline, lint);
    mkdirSync(path.join(out, l.level), { recursive: true });
    writeFileSync(path.join(out, l.level, 'verdict.json'), JSON.stringify(v, null, 1) + '\n');
    if (v.verdict !== 'pass') failed++;
    console.log(`${l.level}: ${v.verdict}` + (lint ? `, lint ${lint.errors.length} errors` : '')
      + Object.entries(v.sizes).map(([s, j]) => `; ${s} a side ${j.verdict}${j.failed?.length ? ' (' + j.failed.join(', ') + ')' : ''}`).join(''));
  }
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
