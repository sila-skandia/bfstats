// The one entry point for generated bot layers (features/bot-map-generation):
//
//   node sim/botbatch.mjs baseline --maps <tree> --models <tree> --levels berlin,stalingrad,kharkov,bocage
//        builds sim/baselines/onfoot-dice.json from DICE's own layers
//   node sim/botbatch.mjs matrix   --maps <tree> --models <tree> --levels shigaisen_b
//        runs the seeded matrix on the tree as it is, detects and judges
//   node sim/botbatch.mjs level    --maps <tree> --models <tree> --mod bf1942 --levels shigaisen_b [--game-dir <dir>]
//        generates the layer, applies it with `patch_scene.py --layer ai`, lints, then as `matrix`, twice:
//        the level with no layer and the level with it. A level with a lint error is not run: its
//        verdict is `unsuitable` with the errors (`--despite-lint` runs it all the same)
//   node sim/botbatch.mjs level ... --candidates ../../features/bot-map-generation/candidates.csv [--classes "contained on-foot"]
//        the same for every in-scope row of the candidates file whose level is in the tree
//
//   node sim/botbatch.mjs census --maps <tree> --models <tree> --mod bf1942 --game-dir <dir> --archives <dir> --levels a,b
//        per level: the engine's maps if the layer has none, generate, apply, lint, and ONE match (300 s,
//        8 a side, seed 1); one table row a level, also <out>/census.json. Says which levels are dead and
//        whether the lint saw it coming, before anybody pays for the matrix
//
//   node sim/botbatch.mjs accept --levels shigaisen_b --reason "<why it goes live short of the bar>" [--mod bf1942]
//        records an acceptance on a layer that failed the bar but beat the level with no layer
//
// A match is `sim/run.mjs` on foot (`--no-vehicles`), seeds 1..N at each side
// size; the verdict per level is written to <out>/<level>/verdict.json.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate, LAYERS_ROOT } from './botgen.mjs';
import { lintLevel, predictedDead, DEAD_CLASSES } from './botlint.mjs';
import { detectRun } from './detect.mjs';
import { aliveChecks, buildBaseline, judge, spread, unionCoverage } from './judge.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const BASELINE_FILE = path.join(HERE, 'baselines', 'onfoot-dice.json');
/** The bar for a match played with the level's vehicles in (`--vehicles`): DICE's levels, run the same way. */
export const VEHICLE_BASELINE_FILE = path.join(HERE, 'baselines', 'vehicles-dice.json');
/** The two ways a match is played, as a verdict names them. */
export const CONFIG = { foot: 'on foot', vehicles: 'with vehicles' };
export const baselineFileFor = vehicles => (vehicles ? VEHICLE_BASELINE_FILE : BASELINE_FILE);
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
export async function runMatrix({ maps, models, level, out, seeds = 10, sizes = [8, 16], time = 600, traceEvery = 30, jobs = Math.max(1, Math.min(8, os.cpus().length - 2)), keepTraces = false, force = false, vehicles = false }) {
  const tasks = [];
  // `b8` on foot, `v8` with the level's vehicles: the two never share a folder, so neither resumes from the other.
  for (const size of sizes) for (let seed = 1; seed <= seeds; seed++) tasks.push({ size, seed, dir: path.join(out, level, `${vehicles ? 'v' : 'b'}${size}`, `s${seed}`) });
  const rows = [];
  let next = 0;
  await Promise.all(Array.from({ length: jobs }, async () => {
    while (next < tasks.length) {
      const t = tasks[next++];
      const rowFile = path.join(t.dir, 'detect.json');
      if (!force && existsSync(rowFile)) { rows.push(JSON.parse(readFileSync(rowFile, 'utf8'))); continue; }
      mkdirSync(t.dir, { recursive: true });
      await runOne([path.join(HERE, 'run.mjs'), '--map', level, '--maps', maps, ...(models ? ['--models', models] : []),
                    '--bots', String(t.size), '--time', String(time), '--seed', String(t.seed), ...(vehicles ? [] : ['--no-vehicles']),
                    '--trace-every', String(traceEvery), '--quiet', '--out', t.dir], path.join(HERE, '..'));
      const row = { ...await detectRun(t.dir), config: vehicles ? CONFIG.vehicles : CONFIG.foot };
      writeFileSync(rowFile, JSON.stringify(row) + '\n');
      if (!keepTraces) rmSync(path.join(t.dir, 'trace.jsonl'), { force: true });
      rows.push(row);
    }
  }));
  return rows.sort((a, b) => a.botsPerSide - b.botsPerSide || a.seed - b.seed);
}

/** The four movement rates the "better than nothing" comparison reads. */
export const MOVEMENT = ['stuckSecondsPerBotMinute', 'routeFailuresPerBotMinute', 'redeploysPerBotMinute', 'spawnTrapsPerBotMinute'];

/** The movement rates that count deaths: nobody is killed at a spawn on a level where nobody is killed. */
export const NEEDS_A_FIGHT = ['spawnTrapsPerBotMinute'];

/**
 * A layer that fails the bar against the same level with no layer, per side
 * size: it is better than nothing when it captures at least as much, at
 * least two movement rates fall by a quarter, and none rises by a quarter.
 *
 * Where the level with no layer has no fight at that size (it fails
 * `aliveChecks`), the rates in `NEEDS_A_FIGHT` are left out of the
 * comparison and named in `notCompared`: its zero spawn traps are the zero
 * of a level where nobody dies, not a standard a fought match can be held
 * to. The same reasoning as `no-fight` on the layer's side (`verdictOf`).
 * The_Maze is the case: no kill in twenty matches with no layer, and 0.011
 * spawn traps a bot-minute with one read as "worse".
 */
export function betterThanNothing(rows, none) {
  const sizes = [...new Set(rows.map(r => r.botsPerSide))];
  const detail = {};
  let all = sizes.length > 0;
  for (const size of sizes) {
    const g = rows.filter(r => r.botsPerSide === size), n = none.filter(r => r.botsPerSide === size);
    if (!n.length) { all = false; continue; }
    const med = (set, k) => spread(set.map(r => r[k])).p50;
    const noneAlive = aliveChecks(n).every(c => c.pass);
    const compared = MOVEMENT.filter(k => noneAlive || !NEEDS_A_FIGHT.includes(k));
    const improved = compared.filter(k => med(g, k) <= 0.75 * med(n, k));
    const worsened = compared.filter(k => med(g, k) >= 1.25 * med(n, k) && med(g, k) > 0);
    const captures = med(g, 'capturesTotal') >= med(n, 'capturesTotal');
    detail[size] = { improved, worsened, captures: [med(g, 'capturesTotal'), med(n, 'capturesTotal')],
                     ...(noneAlive ? {} : { notCompared: MOVEMENT.filter(k => !compared.includes(k)) }) };
    if (!(captures && improved.length >= 2 && worsened.length === 0)) all = false;
  }
  return { better: all, detail };
}

/**
 * The checks a level must pass at every side size before a failing layer can
 * be called better than nothing: both sides kill in every seed, both lose
 * tickets in every seed, and no bot throws.
 */
export const ALIVE = ['bothSidesKill', 'ticketsBleed', 'botErrors'];

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
  // A match nobody fights is not better than anything: bots that stand still
  // do not get stuck, fail routes or redeploy either. So the comparison is
  // read only once the level is alive at every size (`ALIVE`).
  const dead = Object.entries(judged).flatMap(([s, j]) => (j.failed ?? []).filter(f => ALIVE.includes(f)).map(f => `${s}:${f}`));
  const outcome = verdict === 'pass' ? 'pass' : dead.length ? 'no-fight'
    : versus ? (versus.better ? 'better-than-nothing' : 'no-better-than-nothing') : 'fail';
  return { level, verdict, outcome, oneSided, unreachable, ...(dead.length ? { dead } : {}),
           lint: lint ? { errors: lint.errors, warnings: lint.warnings.map(w => w.text), facts: lint.facts } : null,
           sizes: judged, versusNothing: versus };
}

/**
 * The verdict of a level the lint refuses, or null when it has no error: no
 * match is run for it. A sealed side, a flag nobody can stand in and a
 * stacked play surface are known before the first seed, and twenty minutes
 * of matches would only say "no-fight" again (`botlint.mjs lintWalk`).
 */
export function unsuitable(level, lint) {
  if (!lint || !lint.errors.length) return null;
  return { level, verdict: 'fail', outcome: 'unsuitable', oneSided: null, unreachable: lint.facts?.unreachable ?? [],
           predictedDead: predictedDead(lint),
           lint: { errors: lint.errors, warnings: lint.warnings.map(w => w.text), facts: lint.facts }, sizes: {}, versusNothing: null };
}

/** The outcomes a failing layer may be accepted at. */
export const ACCEPTABLE = ['better-than-nothing'];

const failedChecks = short => Object.entries(short.sizes ?? {}).flatMap(([size, j]) => (j.failed ?? []).map(f => `${size}:${f}`));

/**
 * Record an acceptance on a layer's verdict: the bake's gate then reads the
 * layer though it missed the bar (`bf42/ai_level.py generated_layer_gate`).
 * Only a layer with no lint error that measured better than the level with
 * no layer can take one, and it names the checks it was accepted short of.
 */
export function acceptVerdict(short, reason, date) {
  if (!String(reason ?? '').trim()) throw new Error('an acceptance needs a reason');
  if (short.verdict === 'pass') throw new Error(`${short.level} passes: it needs no acceptance`);
  if (!ACCEPTABLE.includes(short.outcome)) throw new Error(`${short.level} is ${short.outcome}: only ${ACCEPTABLE.join(', ')} can be accepted`);
  if (short.lintErrors?.length) throw new Error(`${short.level} has lint errors`);
  const { acceptanceWithdrawn, ...rest } = short;
  return { ...rest, accepted: { reason: String(reason).trim(), date, outcome: short.outcome, failed: failedChecks(short) } };
}

/**
 * A re-run's verdict with the acceptance the last one carried. It is kept
 * only while the result is no worse than the one accepted: still acceptable,
 * no lint error, and no check failing that did not fail then. Otherwise it is
 * withdrawn, and says so; a pass drops it as unneeded.
 */
export function carryAccepted(short, previous) {
  const was = previous?.accepted;
  if (!was || short.verdict === 'pass') return short;
  const fresh = failedChecks(short).filter(f => !(was.failed ?? []).includes(f));
  if (ACCEPTABLE.includes(short.outcome) && !short.lintErrors?.length && !fresh.length) return { ...short, accepted: was };
  return { ...short, acceptanceWithdrawn: { ...was, because: fresh.length ? `now also fails ${fresh.join(', ')}` : `now ${short.outcome}${short.lintErrors?.length ? ' with lint errors' : ''}` } };
}

/**
 * One census row: what the lint predicted and what one match showed.
 * `lint` is `lintLevel`'s result (or null when the level could not be
 * generated), `row` the match's detector row (or null), `marker` the
 * layer's `generated.json`.
 */
export function censusRow(level, lint, row, { marker = null, layerBytes = 0, error = null } = {}) {
  const failed = row ? aliveChecks([row]).filter(c => !c.pass).map(c => c.metric) : null;
  const walk = lint?.walk ?? null;
  const lifts = walk ? walk.flags.filter(f => !f.fixed).map(f => f.poleLift) : [];
  const predicted = lint ? predictedDead(lint) : [];
  const capturable = walk ? walk.flags.filter(f => !f.fixed).length : null;
  return {
    level, error,
    alive: failed ? failed.length === 0 : null, dead: failed ?? [],
    kills: row ? [row.enemyKills?.[1] ?? 0, row.enemyKills?.[2] ?? 0] : null,
    captures: row ? row.capturesTotal : null,
    idleShare: row ? row.idleShare : null,
    routeFailuresPerBotMinute: row ? row.routeFailuresPerBotMinute : null,
    stuckSecondsPerBotMinute: row ? row.stuckSecondsPerBotMinute : null,
    spawnsOff: lint?.facts?.spawnsCutOff ?? null, spawns: lint?.facts?.spawns ?? null,
    flagsOff: lint?.facts?.flagsCutOff ?? null, capturable,
    flagLift: lifts.length ? [Math.min(...lifts), Math.max(...lifts)] : null,
    // How far the flags stand over another walked floor (an upper storey, a roof), least and most.
    flagOver: walk && capturable ? [Math.min(...walk.flags.filter(f => !f.fixed).map(f => f.over)), Math.max(...walk.flags.filter(f => !f.fixed).map(f => f.over))] : null,
    sidesMeet: walk?.sidesMeet ?? null,
    floors: walk ? (walk.floors.stacked ? 'stacked' : 'one') : null, floorsWhy: walk?.floors.reason ?? null,
    objectFloor: walk?.objectFloor ?? null, cover: walk?.cover ?? null,
    walkMap: marker?.walkMap ? { source: marker.walkMap.source, opened: marker.walkMap.opened.length,
                                 ways: marker.walkMap.ways.filter(w => w.way !== 'none').length, noWay: marker.walkMap.ways.filter(w => w.way === 'none').length } : null,
    lintErrors: lint ? lint.errors.map(e => e.text) : null,
    predictedDead: predicted, class: [...predicted.map(c => DEAD_CLASSES[c]), ...(walk?.floors.stacked ? ['stacked floors (classed out)'] : [])],
    // The lint is right when it calls a dead level dead and a live one live.
    lintAgrees: failed && lint ? (failed.length > 0) === (predicted.length > 0) : null,
    layerBytes,
  };
}

/** The census as a fixed-width table, one line a level. */
export function censusTable(rows) {
  const pad = (v, n) => String(v ?? '-').padEnd(n);
  const head = `${pad('level', 28)}${pad('alive', 7)}${pad('kills', 9)}${pad('capt', 5)}${pad('idle', 6)}${pad('routeF', 7)}${pad('spawnsOff', 10)}${pad('flagsOff', 9)}${pad('flagLift', 12)}${pad('flagOver', 12)}${pad('floors', 8)}${pad('meet', 5)}${pad('map', 10)}predicted`;
  return [head, ...rows.map(r => `${pad(r.level, 28)}${pad(r.alive === null ? '-' : r.alive ? 'yes' : 'NO', 7)}${pad(r.kills ? r.kills.join('/') : '-', 9)}${pad(r.captures, 5)}`
    + `${pad(r.idleShare === null ? '-' : r.idleShare.toFixed(2), 6)}${pad(r.routeFailuresPerBotMinute === null ? '-' : r.routeFailuresPerBotMinute.toFixed(1), 7)}`
    + `${pad(r.spawns === null ? '-' : `${r.spawnsOff}/${r.spawns}`, 10)}${pad(r.capturable === null ? '-' : `${r.flagsOff}/${r.capturable}`, 9)}`
    + `${pad(r.flagLift ? r.flagLift.join('..') : '-', 12)}${pad(r.flagOver ? r.flagOver.join('..') : '-', 12)}${pad(r.floors, 8)}${pad(r.sidesMeet === null ? '-' : r.sidesMeet ? 'yes' : 'no', 5)}${pad(r.walkMap ? r.walkMap.source : 'painted', 10)}`
    + (r.error ? `ERROR ${r.error}` : `${r.predictedDead.length ? 'dead' : 'alive'}${r.class.length ? ': ' + r.class.join('; ') : ''}`) + (r.lintAgrees === false ? '  [lint wrong]' : ''))].join('\n');
}

/** The engine's own search maps into a layer folder that has none, when the level's archive is at hand. */
function ensureEngineMaps(layerDir, level, mod, archives) {
  if (!archives || existsSync(path.join(layerDir, 'Pathfinding', 'Infantry1Level0Map.raw'))) return;
  const hit = readdirSync(path.resolve(archives)).find(f => f.toLowerCase() === `${level}.rfa`);
  if (!hit) return;
  const eng = spawnSync('python3', [path.join(HERE, '..', 'engine_search_maps.py'), '--mod', mod, '--archive', path.join(path.resolve(archives), hit),
                                    '--out', layerDir], { encoding: 'utf8' });
  console.error(`${level}: ${(eng.stdout || eng.stderr).trim().split('\n').pop().replace(/ in \S+/, '')}`);
}

function folderBytes(dir) {
  let n = 0;
  if (!existsSync(dir)) return 0;
  for (const f of readdirSync(dir, { withFileTypes: true })) n += f.isDirectory() ? folderBytes(path.join(dir, f.name)) : statSync(path.join(dir, f.name)).size;
  return n;
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
    if (k === '--force' || k === '--keep-traces' || k === '--no-generate' || k === '--no-match' || k === '--despite-lint' || k === '--vehicles') a[k.slice(2)] = true;
    else if (k.startsWith('--')) a[k.slice(2)] = argv[++i];
    else a._.push(k);
  }
  return a;
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const cmd = a._[0];
  if (cmd === 'accept') {
    let bad = 0;
    for (const level of String(a.levels ?? '').split(',').map(l => l.trim().toLowerCase()).filter(Boolean)) {
      const file = path.join(a.layers ? path.resolve(a.layers) : LAYERS_ROOT, (a.mod ?? 'bf1942').toLowerCase(), level, 'verdict.json');
      try {
        const next = acceptVerdict(JSON.parse(readFileSync(file, 'utf8')), a.reason, new Date().toISOString().slice(0, 10));
        writeFileSync(file, JSON.stringify(next, null, 1) + '\n');
        console.log(`${level}: accepted short of ${next.accepted.failed.join(', ')}`);
      } catch (e) { bad++; console.error(`${level}: not accepted: ${e.code === 'ENOENT' ? 'no verdict.json' : e.message}`); }
    }
    process.exit(bad ? 1 : 0);
  }
  if (!['baseline', 'matrix', 'level', 'census'].includes(cmd) || !a.maps) {
    console.error('usage: node sim/botbatch.mjs <baseline|matrix|level|census> --maps <tree> [--models <tree>] --levels a,b | --candidates <csv> [--classes c1;c2]\n'
      + '       census: one 300 s match a level, 8 a side [--time 300] [--bots 8] [--seed 1] [--no-match] [--no-generate]\n'
      + '       node sim/botbatch.mjs accept --levels a,b --reason "<why>" [--mod bf1942] [--layers <dir>]\n'
      + '       [--vehicles] the vehicles of the level in, judged against baselines/vehicles-dice.json (default: on foot)\n'
      + '       [--mod bf1942] [--game-dir <dir>] [--archives <dir of level .rfa>] [--out <dir>] [--seeds 10] [--sizes 8,16] [--time 600] [--jobs N] [--baseline <file>] [--force] [--keep-traces] [--no-generate]\n'
      + '       level: a level with a lint error is not run (outcome "unsuitable") unless --despite-lint');
    process.exit(2);
  }
  const maps = path.resolve(a.maps), models = a.models ? path.resolve(a.models) : null;
  const out = path.resolve(a.out ?? path.join(HERE, '..', 'out', 'bot-layers', cmd));
  const opts = { maps, models, out, seeds: Number(a.seeds ?? 10), sizes: String(a.sizes ?? '8,16').split(',').map(Number), time: Number(a.time ?? 600),
                 force: !!a.force, keepTraces: !!a['keep-traces'], vehicles: !!a.vehicles, ...(a.jobs ? { jobs: Number(a.jobs) } : {}) };
  const config = opts.vehicles ? CONFIG.vehicles : CONFIG.foot;
  let levels = a.levels ? a.levels.split(',').map(l => ({ level: l.toLowerCase(), mod: a.mod ?? 'bf1942' })) : [];
  if (a.candidates) levels = candidateLevels(path.resolve(a.candidates), (a.classes ?? IN_SCOPE.join(';')).split(';'));
  levels = levels.filter(l => existsSync(path.join(maps, l.level, 'scene.json')) || (console.error(`skip ${l.level}: not in ${maps}`), false));
  if (cmd === 'baseline') {
    const rows = [];
    for (const l of levels) { console.error(`baseline ${l.level}`); rows.push(...await runMatrix({ ...opts, level: l.level })); }
    const file = path.resolve(a.baseline ?? baselineFileFor(opts.vehicles));
    mkdirSync(path.dirname(file), { recursive: true });
    const slim = buildBaseline(rows, `DICE layers ${config}: ${levels.map(l => l.level).join(', ')}; seeds 1..${opts.seeds}, ${opts.time} s${opts.vehicles ? '' : ', --no-vehicles'}`);
    writeFileSync(file, JSON.stringify(slim, null, 1) + '\n');
    console.log(`baseline: ${rows.length} matches -> ${file}`);
    return;
  }
  const layersRoot = a.layers ? path.resolve(a.layers) : LAYERS_ROOT;
  const patchScene = (l, env) => spawnSync('python3', [path.join(HERE, '..', 'patch_scene.py'), '--layer', 'ai', '--mod', l.mod, '--tree', maps,
                                                       ...(a['game-dir'] ? ['--game-dir', path.resolve(a['game-dir'])] : []), l.level],
                                           { encoding: 'utf8', env: { ...process.env, ...(a.layers ? { BOT_LAYERS_ROOT: layersRoot } : {}), ...env } });
  if (cmd === 'census') {
    const time = Number(a.time ?? 300), bots = Number(a.bots ?? 8), seed = Number(a.seed ?? 1);
    const prepared = [];
    // One level at a time up to the match: the lab's server is shared, and the bake writes one tree.
    for (const l of levels) {
      const layerDir = path.join(layersRoot, l.mod.toLowerCase(), l.level);
      const item = { ...l, layerDir, lint: null, error: null };
      prepared.push(item);
      try {
        ensureEngineMaps(layerDir, l.level, l.mod, a.archives);
        if (!a['no-generate']) await generate({ maps, models, map: l.level, mod: l.mod, out: layersRoot });
        const on = patchScene(l, { BOT_LAYERS_UNVERIFIED: '1' });
        if (on.status !== 0) throw new Error(`patch_scene: ${(on.stderr || on.stdout).trim().split('\n').pop()}`);
        item.lint = await lintLevel({ maps, models, map: l.level, source: layerDir });
        console.error(`${l.level}: lint ${item.lint.errors.length} errors${predictedDead(item.lint).length ? ', predicted dead' : ''}`);
      } catch (e) { item.error = e.message; console.error(`${l.level}: ${e.message}`); }
    }
    // The matches, side by side.
    let next = 0;
    const jobs = Math.max(1, Number(a.jobs ?? Math.min(8, os.cpus().length - 2)));
    await Promise.all(Array.from({ length: jobs }, async () => {
      while (next < prepared.length) {
        const item = prepared[next++];
        if (item.error || a['no-match']) continue;
        try {
          const rows = await runMatrix({ maps, models, out, level: item.level, seeds: seed, sizes: [bots], time, jobs: 1, force: true, vehicles: opts.vehicles });
          item.row = rows.find(r => r.seed === seed) ?? rows[rows.length - 1];
        } catch (e) { item.error = e.message.slice(0, 200); }
      }
    }));
    const rows = prepared.map(item => {
      const markerFile = path.join(item.layerDir, 'generated.json');
      return censusRow(item.level, item.lint, item.row ?? null, { error: item.error, layerBytes: folderBytes(item.layerDir),
        marker: existsSync(markerFile) ? JSON.parse(readFileSync(markerFile, 'utf8')) : null });
    });
    mkdirSync(out, { recursive: true });
    writeFileSync(path.join(out, 'census.json'), JSON.stringify({ time, bots, seed, config, rows }, null, 1) + '\n');
    console.log(censusTable(rows));
    console.log(`census: ${rows.length} levels, ${rows.filter(r => r.alive).length} alive, ${rows.filter(r => r.alive === false).length} dead, `
      + `lint wrong on ${rows.filter(r => r.lintAgrees === false).length} -> ${path.join(out, 'census.json')}`);
    return;
  }
  const baseline = JSON.parse(readFileSync(path.resolve(a.baseline ?? baselineFileFor(opts.vehicles)), 'utf8'));
  let failed = 0;
  for (const l of levels) {
    let lint = null, none = null;
    const layerDir = path.join(layersRoot, l.mod.toLowerCase(), l.level);
    const patch = env => patchScene(l, env);
    let refused = null;
    if (cmd === 'level') {
      // The engine's own search maps, when the level's archive is at hand and the layer has none.
      ensureEngineMaps(layerDir, l.level, l.mod, a.archives);
      if (!a['no-generate']) {
        const g = await generate({ maps, models, map: l.level, mod: l.mod, out: layersRoot });
        console.error(`${l.level}: generated ${g.dir} (${g.changed.length ? g.changed.length + ' files written' : 'up to date'})`);
      }
      // The scratch tree takes the layer whatever its last verdict: this run is what judges it.
      const on = patch({ BOT_LAYERS_UNVERIFIED: '1' });
      if (on.status !== 0) { console.error(`${l.level}: patch_scene failed: ${(on.stderr || on.stdout).slice(-300)}`); failed++; continue; }
      lint = await lintLevel({ maps, models, map: l.level, source: layerDir });
      // A level the lint refuses is not run (`unsuitable`), unless asked for.
      refused = a['despite-lint'] ? null : unsuitable(l.level, lint);
      if (!refused) {
        // The level with no layer: the arm a failing layer is compared with.
        const off = patch({ BOT_LAYERS_OFF: '1' });
        if (off.status !== 0) { console.error(`${l.level}: patch_scene failed: ${(off.stderr || off.stdout).slice(-300)}`); failed++; continue; }
        none = await runMatrix({ ...opts, out: path.join(out, l.level, 'none'), level: l.level });
        const back = patch({ BOT_LAYERS_UNVERIFIED: '1' });
        if (back.status !== 0) { console.error(`${l.level}: patch_scene failed: ${(back.stderr || back.stdout).slice(-300)}`); failed++; continue; }
      }
    }
    const rows = refused ? [] : await runMatrix({ ...opts, out: cmd === 'level' ? path.join(out, l.level, 'generated') : out, level: l.level });
    const v = { ...(refused ?? verdictOf(l.level, rows, baseline, lint, none)), config };
    mkdirSync(path.join(out, l.level), { recursive: true });
    writeFileSync(path.join(out, l.level, 'verdict.json'), JSON.stringify(v, null, 1) + '\n');
    if (cmd === 'level') {
      // The layer's own record, which the bake's gate reads (`bf42/ai_level.py generated_layer_gate`).
      const marker = JSON.parse(readFileSync(path.join(layerDir, 'generated.json'), 'utf8'));
      const short = { level: l.level, verdict: v.verdict, outcome: v.outcome, config, generatorVersion: marker.version, inputs: marker.inputs,
                      baseline: baseline.note, seeds: opts.seeds, sizes: Object.fromEntries(Object.entries(v.sizes).map(([s, j]) => [s, { verdict: j.verdict, failed: j.failed, winners: j.balance?.split }])),
                      oneSided: v.oneSided, unreachable: v.unreachable, lintErrors: lint.errors.map(e => e.text) };
      const file = path.join(layerDir, 'verdict.json');
      const kept = carryAccepted(short, existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null);
      if (kept.acceptanceWithdrawn) console.error(`${l.level}: acceptance withdrawn, ${kept.acceptanceWithdrawn.because}`);
      writeFileSync(file, JSON.stringify(kept, null, 1) + '\n');
    }
    if (v.verdict !== 'pass') failed++;
    console.log(`${l.level}: ${v.outcome}` + (lint ? `, lint ${lint.errors.length} errors` : '')
      + Object.entries(v.sizes).map(([s, j]) => `; ${s} a side ${j.verdict}${j.failed?.length ? ' (' + j.failed.join(', ') + ')' : ''}`).join(''));
  }
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
