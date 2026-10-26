// Writes core/src/test/resources/parity/ghost-writer.json: GhostWriter and
// its helpers (ghost-writer.mjs), soldier-ghost.mjs's trackers and record.mjs,
// on scripted inputs the Kotlin GhostWriterTest replays:
//   - the sidecar halves of tests/sidecar_seat_state_harness.mjs (controlHp,
//     the hull scoped out as the wheel is taken, controlMagazines) and
//     sidecar_own_vehicle_fire_harness.mjs (a step down on the own hull);
//   - recoilAgo over its whole domain, animNamer across a table swap,
//     SoldierStateTracker and carrySelfAim over a run of bodies;
//   - a GhostWriter script through the rarer rows: a map reset, a destroyed
//     object, the exit hand-back, rounds that reset, count and go off, the
//     spawn manager's table changing size, a control point's name, a round's
//     result, a player's stats and respawn wait, an engine's running word,
//     a Daihatsu's ramp leaves (Wake's tables);
//   - recordFor over every event type, and header() at a fixed clock.
//   node parity/ghost-writer.mjs
import fs from 'node:fs';
import path from 'node:path';
import { RES, SIDECAR, HERE, writeJson, ensureTables, scratchCache, runNode } from './lib/tables.mjs';

if (process.argv[2] === '--case') {
  const { GhostWriter, controlMagazines, recoilAgo, animNamer } = await import(path.join(SIDECAR, 'ghost-writer.mjs'));
  const { SoldierStateTracker, carrySelfAim } = await import(path.join(SIDECAR, 'soldier-ghost.mjs'));
  const { recordFor, header } = await import(path.join(SIDECAR, 'record.mjs'));
  const { useLevelTemplates } = await import(path.join(SIDECAR, 'ghost/children.mjs'));
  const { levelTemplates } = await import(path.join(SIDECAR, 'template-table.mjs'));
  const out = [];
  const put = (label, v) => out.push([label, JSON.stringify(v === undefined ? 'undefined' : v)]);
  const script = JSON.parse(fs.readFileSync(path.join(RES, 'ghost-writer.script.json'), 'utf8'));

  // ---- seat state (sidecar_seat_state_harness.mjs) ----
  {
    const rows = [];
    const w = new GhostWriter({ write: (r) => rows.push(r), objInfo: new Map() });
    const said = [w.controlHp(1, 555, 100), w.controlHp(1.03, 555, 100), w.controlHp(2, 555, 62.5), w.controlHp(2.03, 555, NaN), w.controlHp(3, 555, 70), w.controlHp(3, 5.5, 70)];
    put('controlHp', { said, rows });
  }
  {
    const rows = [];
    const w = new GhostWriter({ write: (r) => rows.push(r), objInfo: new Map([[555, { tid: 1, tmpl: 'M3A1', team: 1 }]]) });
    w.block(1, [{ action: 1, netId: 555, cls: 'SimpleObjectNetworkable', body: { hp: 100 } }]);
    w.block(1.05, [{ action: 3, netId: 555 }]);
    put('scopeOutHp', { again: w.controlHp(1.06, 555, 100), rows });
  }
  {
    const first = controlMagazines([{ type: 'R' }, { type: 'R' }, { type: 'F', magA: 501, magB: 2 }], null, 1, null);
    const next = controlMagazines([{ type: 'R' }, { type: 'F', magA: 497 }], null, 1, first);
    put('controlMagazines', { first, next, none: controlMagazines([{ type: 'S' }, { type: 'E' }], 'M3A1', 0, null), notList: controlMagazines(null, 'M3A1'),
      named: controlMagazines([{ type: 'F', magA: 31 }, { type: 'F' }], 'Sherman', 0, [['x', 5, 6], ['y', 7, 8]]) });
  }
  // ---- own vehicle fire (sidecar_own_vehicle_fire_harness.mjs) ----
  for (const control of [true, false]) {
    const rows = [];
    const objInfo = new Map([[100, { tid: 1, tmpl: 'Sherman', team: 1 }]]);
    const gw = new GhostWriter({ write: (r) => rows.push(r), objInfo });
    gw.seated.set(100, [{ t: 0, pid: 5 }]);
    const rec = (magA) => ({ netId: 100, action: 1, cls: 'SimpleObjectNetworkable', body: { children: [{ type: 'F', magA }] }, ...(control ? { control: true } : {}) });
    gw.block(0.0, [rec(30)], 0);
    gw.block(0.1, [rec(29)], 1);
    gw.block(0.2, [rec(27)], 3);
    put(`ownFire ${control}`, { rows, stats: gw.stats });
  }
  // ---- helpers ----
  const ago = [];
  for (let c = 0; c <= 21; c++) for (let t = 0; t <= 22; t++) for (const g of [null, true, false]) ago.push(recoilAgo(c, t, g));
  put('recoilAgo', ago);
  {
    let table = [[0, 'Lb_Stand'], [5, 'Ub_Fire'], [5, 'Ub_Twice']];
    const name = animNamer(() => table);
    const a = [name(0), name(5), name(9), name(null)];
    table = [[0, 'Lb_LieStill']];
    const b = [name(0), name(5)];
    table = null;
    put('animNamer', [a, b, name(0)]);
  }
  {
    const tr = new SoldierStateTracker();
    const map = new Map();
    const rowsT = [], rowsA = [];
    for (const [nid, b] of script.bodies) { rowsT.push(tr.update(nid, b)); rowsA.push(carrySelfAim(map, nid, b)); }
    put('tracker', rowsT);
    put('selfAim', rowsA);
  }
  // ---- a GhostWriter script ----
  for (const level of [null, 'wake']) {
    useLevelTemplates(level ? levelTemplates({ mod: 'bf1942', level, mode: 'coop' }) : null, level);
    const rows = [];
    const objInfo = new Map(script.objInfo.map(([k, v]) => [k, { ...v }]));
    const anim = [[0, 'Lb_Stand'], [1, 'Lb_Crouch'], [2, 'Lb_LieStill'], [3, 'Ub_Fire'], [4, 'Ub_Idle']];
    const w = new GhostWriter({ write: (r) => rows.push(r), objInfo, cpNames: { ALLIES_base: 'Airfield' }, animName: animNamer(() => anim) });
    for (const step of script.steps) {
      if (step.note) for (const e of w.note(step.note, step.t)) rows.push({ derivedNote: e });
      else w.block(step.t, step.records, step.tick);
    }
    put(`script ${level}`, { rows, stats: w.stats });
  }
  // ---- record.mjs ----
  put('recordFor', script.events.map((ev) => { const r = recordFor(ev); return r === undefined ? 'undefined' : r; }));
  {
    const RealDate = Date;
    globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [RealDate.UTC(2026, 9, 26, 1, 2, 3, 456)])); } };
    put('header', [header(10), header(20, { host: '1.2.3.4', port: 14567, hz: 30 })]);
    globalThis.Date = RealDate;
  }
  fs.writeFileSync(process.argv[3], JSON.stringify(out));
  process.exit(0);
}

ensureTables();
const cache = scratchCache(true);
const file = path.join(cache, 'out.json.tmp');
runNode([path.join(HERE, 'ghost-writer.mjs'), '--case', file], cache);
writeJson(path.join(RES, 'ghost-writer.json'), JSON.parse(fs.readFileSync(file, 'utf8')));
fs.rmSync(cache, { recursive: true, force: true });
console.log('ghost-writer cases written');
