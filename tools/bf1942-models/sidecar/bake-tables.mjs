#!/usr/bin/env node
// Bake the sidecar's per-level tables from this PC's install, for a sidecar on
// a machine without one (level-tables.mjs fetches them from mesh.bfstats.io).
//
//   node sidecar/bake-tables.mjs                         # every exported tree
//   node sidecar/bake-tables.mjs --mods bf1942,xpack1,xpack2 --jobs 8
//   node sidecar/bake-tables.mjs --mods xpack2 --levels wake,essen --dry-run
//
// For every level in a tree's maps.json (viewer/maps/maps.json is bf1942,
// viewer/maps/mods/<mod>/maps.json each other mod; FHSW and FHSWEurope only
// the rows with a `loading` block) and every game type the level ships
// (sidecar_level_modes.py: the level's root <mode>.con), it writes
//
//   <tree>/<level>/sidecar/<mode>.json
//     { format, mod, level, mode,
//       tids: template-table.mjs's value (names, classes, specs, hulls,
//             soldiers, v = the code version),
//       animStates, cpNames: game-tables.mjs's }
//
// computed by the same code a sidecar with the install runs (and cached in
// its cache the same way). A file whose content did not change is left alone,
// so the mesh publisher's hash compare sends nothing for it. Publish with
// scripts/publish-mesh-delta.py (features/sidecar-desktop-app/README.md).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { FORMAT, modKey } from './level-tables.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODES_SCRIPT = path.resolve(HERE, '../sidecar_level_modes.py');
const args = process.argv.slice(2);
const opt = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const list = (v) => (v ? v.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) : null);

const viewer = path.resolve(opt('viewer', path.resolve(HERE, '../viewer')));
const LOADING_ONLY = new Set(['fhsw', 'fhsweurope']);

/** Every exported tree: { mod, dir, levels: [level dir names] }. */
export function exportedTrees(root = viewer) {
  const trees = [];
  const add = (mod, dir) => {
    let rows;
    try { rows = JSON.parse(fs.readFileSync(path.join(dir, 'maps.json'), 'utf8')); } catch { return; }
    if (!Array.isArray(rows)) rows = rows.maps ?? [];
    const levels = [];
    for (const r of rows) {
      if (LOADING_ONLY.has(mod) && !r.loading) continue;
      const lv = String(r.glb || r.name || '').split('/')[0].toLowerCase();
      if (lv && !levels.includes(lv)) levels.push(lv);
    }
    trees.push({ mod, dir, levels });
  };
  add('bf1942', path.join(root, 'maps'));
  let mods = [];
  try { mods = fs.readdirSync(path.join(root, 'maps', 'mods')).sort(); } catch { /* none */ }
  for (const m of mods) add(modKey(m), path.join(root, 'maps', 'mods', m));
  return trees;
}

function levelModes(mod) {
  const py = process.env.SIDECAR_PYTHON || 'python3';
  const extra = process.env.BF1942_DIR ? ['--game-dir', process.env.BF1942_DIR] : [];
  return JSON.parse(execFileSync(py, [MODES_SCRIPT, ...extra, '--mod', mod], { encoding: 'utf8', maxBuffer: 64 << 20 })).levels;
}

async function bakeOne({ mod, level, mode, out }) {
  const { templateValue } = await import('./template-table.mjs');
  const { gameTables } = await import('./game-tables.mjs');
  const t = Date.now();
  const tids = templateValue({ mod, level, mode, baked: false });
  const g = gameTables({ mod, level, mode, baked: false });
  if (!tids || !g.animStates) return { mod, level, mode, ok: false, why: !tids ? 'no template table' : 'no animation table', ms: Date.now() - t };
  const doc = { format: FORMAT, mod, level, mode, tids, animStates: g.animStates, cpNames: g.cpNames ?? {} };
  const text = JSON.stringify(doc);
  let same = false;
  try { same = fs.readFileSync(out, 'utf8') === text; } catch { /* new */ }
  if (!same) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const tmp = `${out}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, out);
  }
  return { mod, level, mode, ok: true, bytes: text.length, changed: !same, ids: tids.names.length, ms: Date.now() - t };
}

// ---- worker: bake the jobs in a file, one JSON line each -------------------
if (args[0] === '--worker') {
  const jobs = JSON.parse(fs.readFileSync(args[1], 'utf8'));
  for (const job of jobs) {
    let r;
    try { r = await bakeOne(job); } catch (e) { r = { ...job, ok: false, why: e.message }; }
    process.stdout.write(`${JSON.stringify(r)}\n`);
  }
  process.exit(0);
}

// ---- main -----------------------------------------------------------------
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const wantMods = list(opt('mods'));
  const wantLevels = list(opt('levels'));
  const nJobs = Math.max(1, Number(opt('jobs', Math.min(8, os.cpus().length))));
  const dry = args.includes('--dry-run');
  const t0 = Date.now();
  const jobs = [];
  for (const tree of exportedTrees()) {
    if (wantMods && !wantMods.includes(tree.mod)) continue;
    let modes;
    try { modes = levelModes(tree.mod); } catch (e) { console.error(`[bake] ${tree.mod}: cannot list its levels' game types: ${String(e.stderr || e.message).trim()}`); continue; }
    let n = 0;
    for (const lv of tree.levels) {
      if (wantLevels && !wantLevels.includes(lv)) continue;
      const ms = modes[lv];
      if (!ms?.length) { console.error(`[bake] ${tree.mod} ${lv}: exported, but the install's ${tree.mod} has no game type script for it; skipped`); continue; }
      for (const mode of ms) { jobs.push({ mod: tree.mod, level: lv, mode, out: path.join(tree.dir, lv, 'sidecar', `${mode}.json`) }); n++; }
    }
    console.log(`[bake] ${tree.mod}: ${tree.levels.length} exported levels, ${n} level+mode tables`);
  }
  if (dry) { for (const j of jobs) console.log(path.relative(viewer, j.out)); process.exit(0); }
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'bake-tables-'));
  // Round-robin, so each worker gets a mix of cheap and dear levels.
  const shares = Array.from({ length: Math.min(nJobs, jobs.length) }, () => []);
  jobs.forEach((j, i) => shares[i % shares.length].push(j));
  const results = [];
  await Promise.all(shares.map((share, w) => new Promise((resolve) => {
    const file = path.join(scratch, `jobs-${w}.json`);
    fs.writeFileSync(file, JSON.stringify(share));
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--worker', file], { stdio: ['ignore', 'pipe', 'inherit'] });
    let buf = '';
    child.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let r; try { r = JSON.parse(line); } catch { if (line.trim()) console.log(line); continue; }
        if (r.mod === undefined) { console.log(line); continue; }
        results.push(r);
        console.log(`[bake] ${results.length}/${jobs.length} ${r.mod} ${r.level} ${r.mode}: ${r.ok ? `${r.ids} ids, ${(r.bytes / 1024).toFixed(0)} KB${r.changed ? '' : ' (unchanged)'}` : `FAILED: ${r.why}`} in ${r.ms} ms`);
      }
    });
    child.on('close', resolve);
  })));
  fs.rmSync(scratch, { recursive: true, force: true });
  const ok = results.filter((r) => r.ok);
  const byMod = {};
  for (const r of ok) { const m = (byMod[r.mod] ??= { files: 0, bytes: 0, changed: 0 }); m.files++; m.bytes += r.bytes; m.changed += r.changed ? 1 : 0; }
  for (const [m, s] of Object.entries(byMod)) console.log(`[bake] ${m}: ${s.files} tables, ${(s.bytes / 1048576).toFixed(1)} MB, ${s.changed} written`);
  const failed = results.filter((r) => !r.ok);
  console.log(`[bake] ${ok.length} of ${jobs.length} tables in ${((Date.now() - t0) / 1000).toFixed(1)} s, ${(ok.reduce((a, r) => a + r.bytes, 0) / 1048576).toFixed(1)} MB${failed.length ? `; ${failed.length} FAILED` : ''}`);
  process.exit(failed.length || results.length < jobs.length ? 1 : 0);
}
