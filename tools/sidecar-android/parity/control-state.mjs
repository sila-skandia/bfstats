// Writes core/src/test/resources/parity/control-state.json.gz: the
// control-object state decoder (ghost/control-state.mjs) and the hull and seat
// decoders (ghost/pco.mjs) over the captures tests/sidecar_control_state_harness.mjs
// and sidecar_derived_children_harness.mjs read: a soldier walking and
// turning, a driven Sherman, the spawn-screen camera, a gunner's seat, the
// hit bool (set, cut short, live), records relative to a block's reference,
// and real hull and seat bodies of Wake and El Alamein. Every decode is
// printed whole. The inputs are copied beside it, so the Kotlin test needs
// nothing from the Node tree.
//   node parity/control-state.mjs
import fs from 'node:fs';
import path from 'node:path';
import { RES, SIDECAR, MODELS, HERE, writeGz, ensureTables, scratchCache, runNode } from './lib/tables.mjs';

const FIX = path.join(MODELS, 'tests', 'fixtures');
const INPUTS = ['sidecar_control_state.json', 'sidecar_control_state_vehicle.json', 'sidecar_control_state_camera.json',
  'sidecar_control_state_seat.json', 'sidecar_control_state_hit.json', 'sidecar_block_reference.json', 'sidecar_derived_children.json'];

if (process.argv[2] === '--case') {
  const { decodeControlState, ControlBaselines } = await import(path.join(SIDECAR, 'ghost/control-state.mjs'));
  const { decodePcoBody, decodeSeatBody } = await import(path.join(SIDECAR, 'ghost/pco.mjs'));
  const { useLevelTemplates, hullFor, seatSpecFor } = await import(path.join(SIDECAR, 'ghost/children.mjs'));
  const { levelTemplates } = await import(path.join(SIDECAR, 'template-table.mjs'));
  const inp = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  const out = {};
  const S = (v) => JSON.stringify(v);
  const tryS = (f) => { try { return S(f()); } catch (e) { return S({ threw: e.message }); } };
  const soldierCtx = (b) => ({ classOf: () => 'BFSoldierNetworkable', baselines: b, animStates: 1395 });
  for (const level of [null, 'wake']) {
    useLevelTemplates(level ? levelTemplates({ mod: 'bf1942', level, mode: 'coop' }) : null, level);
    const key = level ?? 'fallback';
    const o = (out[key] = {});
    { const b = new ControlBaselines(); o.soldier = inp.sidecar_control_state.map((r) => S(decodeControlState(r.hex, r.bits, soldierCtx(b)))); }
    { const b = new ControlBaselines(); const v = inp.sidecar_control_state_vehicle;
      o.vehicle = v.rows.map((r) => S(decodeControlState(r.hex, r.bits, { classOf: () => 'SimpleObjectNetworkable', templateOf: () => v.template, baselines: b }))); }
    { const b = new ControlBaselines(); o.camera = inp.sidecar_control_state_camera.map((r) => S(decodeControlState(r.hex, r.bits, { classOf: () => 'FreeCameraNetworkable', baselines: b }))); }
    { const seat = inp.sidecar_control_state_seat; const b = new ControlBaselines();
      o.seat = seat.rows.flatMap((r) => { const n = r.hex.length * 4; return Array.from({ length: 8 }, (_, i) => n - i).map((k) => S(decodeControlState(r.hex, k, {
        classOf: (id) => (id === seat.root.netId + 1 ? 'Seat' : null),
        seatOf: (id) => (id === seat.root.netId + 1 ? { root: seat.root.netId, seat: 1, tmpl: seat.root.tmpl } : null), baselines: b }))); }); }
    { // The hit bool set in a captured full state, and the state cut short.
      const rows = inp.sidecar_control_state;
      const r = rows.find((x) => !decodeControlState(x.hex, x.bits, soldierCtx(new ControlBaselines())).isDelta);
      const buf = Buffer.from(r.hex, 'hex'); buf[4] |= 1;
      o.hit = [r.bits, r.bits - 40, 60, 33, 20].map((bits) => tryS(() => decodeControlState(buf.toString('hex'), bits, soldierCtx(new ControlBaselines()))));
      o.liveHits = inp.sidecar_control_state_hit.shooterStates.map((s) => S(decodeControlState(s.hex, s.bits, soldierCtx(new ControlBaselines()))));
    }
    o.blockRef = inp.sidecar_block_reference.flatMap((x) => [tryS(() => decodePcoBody(x.rec.hex, x.rec.bodyBits, { template: x.t, strict: false, ref: x.rec.ref })),
      tryS(() => decodePcoBody(x.rec.hex, x.rec.bodyBits, { template: x.t, strict: false }))]);
    // Classes with no reader, and a delta with no baseline.
    o.other = [tryS(() => decodeControlState(inp.sidecar_control_state[0].hex, inp.sidecar_control_state[0].bits, {})),
      tryS(() => decodeControlState(inp.sidecar_control_state[1].hex, inp.sidecar_control_state[1].bits, { classOf: () => 'KitNetworkable' }))];
  }
  // Real hull and seat bodies, with the tables of the level each came from.
  const fix = inp.sidecar_derived_children;
  const wake = levelTemplates({ mod: 'bf1942', level: 'wake', mode: 'coop' });
  const alamein = levelTemplates({ mod: 'bf1942', level: 'el_alamein', mode: 'coop' });
  const levelOf = (k) => ((fix.source[k] ?? '').startsWith('el_alamein') ? alamein : wake);
  out.hulls = {};
  for (const [t, rows] of Object.entries(fix.hulls)) {
    useLevelTemplates(levelOf(t), t);
    const h = hullFor(t);
    out.hulls[t] = rows.map((r) => tryS(() => decodePcoBody(r.hex, r.bits, { template: t, ...(r.ref ? { ref: r.ref } : {}), maxHp: h.maxHp, mobile: h.mobile !== false, strict: true })));
  }
  out.seats = {};
  for (const [k, rows] of Object.entries(fix.seats)) {
    const [t, i] = k.split('+');
    useLevelTemplates(levelOf(k), k);
    const spec = seatSpecFor(t, +i);
    out.seats[k] = rows.map((r) => (spec ? tryS(() => decodeSeatBody(r.hex, r.bits, spec, { strict: true })) : 'null'));
  }
  useLevelTemplates(alamein, 'el_alamein');
  { const b = new ControlBaselines(); out.alameinControl = fix.control.rows.map((r) => S(decodeControlState(r.hex, r.bits, { classOf: () => 'SimpleObjectNetworkable', templateOf: () => fix.control.template, baselines: b }))); }
  fs.writeFileSync(process.argv[4], JSON.stringify(out));
  process.exit(0);
}

ensureTables();
const inputs = Object.fromEntries(INPUTS.map((f) => [f.replace(/\.json$/, ''), JSON.parse(fs.readFileSync(path.join(FIX, f), 'utf8'))]));
const inFile = path.join(RES, 'control-state.inputs.json.gz');
writeGz(inFile, JSON.stringify(inputs));
const cache = scratchCache(true);
const tmpIn = path.join(cache, 'in.json'), tmpOut = path.join(cache, 'out.json');
fs.writeFileSync(tmpIn, JSON.stringify(inputs));
runNode([path.join(HERE, 'control-state.mjs'), '--case', tmpIn, tmpOut], cache);
writeGz(path.join(RES, 'control-state.json.gz'), fs.readFileSync(tmpOut, 'utf8'));
fs.rmSync(cache, { recursive: true, force: true });
console.log('control states written');
