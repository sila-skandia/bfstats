// Writes core/src/test/resources/parity/rebuild/: for each case, the inputs
// (a sidecar recording and its review log) and what Node's
// tools/bf1942-models/sidecar/rebuild.mjs makes of them, run against the
// committed level tables (lib.mjs) with no install and no downloads. The
// Kotlin RebuildTest runs Rebuild over the same inputs and tables and
// requires every output line identical.
//
//   node parity/rebuild.mjs [--refresh-inputs] [--refresh-tables]
//
// The inputs are cut once from real recordings and then committed, so a
// regen on another machine needs neither the recordings nor an install:
//   run       the owner's Wake co-op round of 2026-10-15 (run.ndjson and
//             run.review.ndjson in the main checkout, gitignored), the first
//             4000 framed records; with and without --ref, and once with no
//             tables at all (the vanilla fallback);
//   m3a1      tests/fixtures/sidecar_m3a1_round (test_sidecar_rebuild.py),
//             and its blank-templates variant (the harness's `unnamed` case);
//   zero_sherman, player_stats   tests/fixtures/sidecar_wake_zero_sherman,
//             sidecar_player_stats (Kursk, no ServerInfo: the fallback names);
//   fire_line tests/fixtures/sidecar_fire_line_moving (test_sidecar_fire_line.py),
//             the first 3000 framed records.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RES, SIDECAR, MODELS, gunzip, writeGz, writeJson, ensureTables, scratchCache, runNode } from './lib.mjs';

const OUT = path.join(RES, 'rebuild');
const MAIN = path.resolve(MODELS, '../../../../..'); // worktrees sit in <main>/.claude/worktrees/<name>
const MAIN_CHECKOUT = fs.existsSync(path.join(MAIN, 'run.ndjson')) ? MAIN : path.resolve(MODELS, '../..');
const FIX = path.join(MODELS, 'tests', 'fixtures');
const refresh = process.argv.includes('--refresh-inputs');

const lines = (text) => text.split('\n').filter(Boolean);
const parse = (l) => { try { return JSON.parse(l); } catch { return null; } };

// Keep the first `n` framed records of a review log and the recording rows up
// to their time.
function cut(rec, review, n) {
  const rv = [];
  let last = 0;
  let kept = 0;
  for (const l of lines(review)) {
    const d = parse(l);
    if (d?.tag === 'ghost-record') { if (kept >= n) break; kept++; last = d.dt; }
    rv.push(l);
  }
  const rc = lines(rec).filter((l) => { const r = parse(l); return !r || r.t == null || r.t <= last + 0.5; });
  return { rec: rc.join('\n') + '\n', review: rv.join('\n') + '\n' };
}

const SOURCES = {
  run: () => cut(fs.readFileSync(path.join(MAIN_CHECKOUT, 'run.ndjson'), 'utf8'), fs.readFileSync(path.join(MAIN_CHECKOUT, 'run.review.ndjson'), 'utf8'), 4000),
  m3a1: () => ({ rec: gunzip(path.join(FIX, 'sidecar_m3a1_round.ndjson.gz')), review: gunzip(path.join(FIX, 'sidecar_m3a1_round.review.ndjson.gz')) }),
  m3a1_blank: () => {
    // The same round as a sidecar started without --names writes it: every
    // template blank and no animation table (sidecar_rebuild_harness.mjs).
    const rec = lines(gunzip(path.join(FIX, 'sidecar_m3a1_round.ndjson.gz'))).map(JSON.parse)
      .filter((x) => x.k !== 'anim').map((x) => JSON.stringify(x.tmpl != null ? { ...x, tmpl: '' } : x)).join('\n') + '\n';
    return { rec, review: gunzip(path.join(FIX, 'sidecar_m3a1_round.review.ndjson.gz')) };
  },
  zero_sherman: () => ({ rec: gunzip(path.join(FIX, 'sidecar_wake_zero_sherman.ndjson.gz')), review: gunzip(path.join(FIX, 'sidecar_wake_zero_sherman.review.ndjson.gz')) }),
  player_stats: () => ({ rec: gunzip(path.join(FIX, 'sidecar_player_stats.ndjson.gz')), review: gunzip(path.join(FIX, 'sidecar_player_stats.review.ndjson.gz')) }),
  fire_line: () => {
    const streams = { rec: [], review: [] };
    for (const l of lines(gunzip(path.join(FIX, 'sidecar_fire_line_moving.ndjson.gz')))) {
      const [s, row] = JSON.parse(l);
      if (streams[s]) streams[s].push(JSON.stringify(row));
    }
    return cut(streams.rec.join('\n'), streams.review.join('\n'), 3000);
  },
};

// name -> [input, extra args, tables?]
const CASES = {
  run: ['run', [], true],
  run_ref: ['run', ['--ref', '870,97,873'], true],
  run_no_tables: ['run', [], false],
  m3a1: ['m3a1', [], true],
  m3a1_blank: ['m3a1_blank', [], true],
  zero_sherman: ['zero_sherman', [], true],
  player_stats: ['player_stats', [], true],
  fire_line: ['fire_line', [], true],
};

ensureTables();
for (const [name, make] of Object.entries(SOURCES)) {
  const recFile = path.join(OUT, `${name}.rec.ndjson.gz`);
  const revFile = path.join(OUT, `${name}.review.ndjson.gz`);
  if (refresh || !fs.existsSync(recFile) || !fs.existsSync(revFile)) {
    const { rec, review } = make();
    writeGz(recFile, rec);
    writeGz(revFile, review);
  }
}

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'parity-rebuild-'));
const index = [];
for (const [name, [input, args, tables]] of Object.entries(CASES)) {
  const rec = path.join(scratch, `${input}.rec.ndjson`);
  const review = path.join(scratch, `${input}.review.ndjson`);
  fs.writeFileSync(rec, gunzip(path.join(OUT, `${input}.rec.ndjson.gz`)));
  fs.writeFileSync(review, gunzip(path.join(OUT, `${input}.review.ndjson.gz`)));
  const out = path.join(scratch, `${name}.out.ndjson`);
  const cache = scratchCache(tables);
  const stdout = runNode([path.join(SIDECAR, 'rebuild.mjs'), rec, review, out, ...args], cache);
  const summary = stdout.trim().split('\n').at(-1);
  writeGz(path.join(OUT, `${name}.out.ndjson.gz`), fs.readFileSync(out, 'utf8'));
  index.push({ name, input, args, tables, summary });
  fs.rmSync(cache, { recursive: true, force: true });
  console.log(`${name}: ${summary}`);
}
writeJson(path.join(OUT, 'cases.json'), index);
fs.rmSync(scratch, { recursive: true, force: true });
