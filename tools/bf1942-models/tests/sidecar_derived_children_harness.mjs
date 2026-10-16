// The derived vehicle specs (sidecar/ghost/derive-children.mjs ->
// derived-specs.json, read by children.mjs) against the hand-proven ones and
// against real wire bodies from Wake and El Alamein
// (fixtures/sidecar_derived_children.json, sidecar review logs 2026-10-16).
import fs from 'node:fs';
import { readTemplateGraph, deriveSpec } from '../sidecar/ghost/derive-children.mjs';
import { TEMPLATE_SPECS, HAND_SEAT_SPECS, derivedSpecs, seatSpecFor, childrenFor } from '../sidecar/ghost/children.mjs';
import { decodePcoBody, decodeSeatBody } from '../sidecar/ghost/pco.mjs';
import { decodeControlState, ControlBaselines } from '../sidecar/ghost/control-state.mjs';

const OBJECTS = process.env.BF42_OBJECTS ?? '/home/dylan/bf1942-extracted/objects/Objects';
const hulls = JSON.parse(fs.readFileSync(new URL('../sidecar/hulls.json', import.meta.url), 'utf8'));
const out = { tree: fs.existsSync(OBJECTS), hand: {}, handSeats: {}, inSync: null, fresh: {}, bodies: {}, control: null };

if (out.tree) {
  const graph = readTemplateGraph(OBJECTS);
  const pick = (s) => s && ({ children: s.children.join(''), gearBits: s.gearBits, mags: s.mags ?? [], guns: s.guns ?? [], objects: s.objects ?? [] });
  for (const [t, h] of Object.entries(TEMPLATE_SPECS)) out.hand[t] = { hand: pick(h), derived: pick(deriveSpec(graph, t)) };
  for (const [t, seats] of Object.entries(HAND_SEAT_SPECS)) {
    const d = deriveSpec(graph, t);
    for (const [i, s] of Object.entries(seats)) {
      out.handSeats[`${t}+${i}`] = { hand: { children: s.children.join(''), mags: s.mags }, derived: d?.seats?.[i] ? { children: d.seats[i].children.join(''), mags: d.seats[i].mags } : null };
    }
  }
  // derived-specs.json is the derivation's current output
  const file = derivedSpecs();
  const fresh = Object.fromEntries(Object.keys(file).map((t) => [t, deriveSpec(graph, t)]));
  out.inSync = JSON.stringify(fresh) === JSON.stringify(file);
  for (const t of ['Willy', 'Zero', 'Corsair', 'Spitfire', 'B17']) out.fresh[t] = { children: fresh[t].children.join(''), nodes: fresh[t].nodes };
}

const fix = JSON.parse(fs.readFileSync(new URL('./fixtures/sidecar_derived_children.json', import.meta.url), 'utf8'));
const M3A1 = TEMPLATE_SPECS.M3A1;
const exact = (fn) => { try { const b = fn(); return b.consumed === b.__bits; } catch { return false; } };
for (const [t, rows] of Object.entries(fix.hulls)) {
  const h = hulls[t];
  const base = (r) => ({ ...(r.ref ? { ref: r.ref } : {}), maxHp: h.maxHp, mobile: h.mobile !== false, strict: true });
  let ok = 0, m3 = 0;
  for (const r of rows) {
    if (exact(() => ({ ...decodePcoBody(r.hex, r.bits, { template: t, ...base(r) }), __bits: r.bits }))) ok++;
    if (exact(() => ({ ...decodePcoBody(r.hex, r.bits, { children: M3A1.children, gearBits: M3A1.gearBits, ...base(r) }), __bits: r.bits }))) m3++;
  }
  out.bodies[t] = { n: rows.length, exact: ok, m3a1: m3, children: childrenFor(t)?.children.join('') };
}
for (const [k, rows] of Object.entries(fix.seats)) {
  const [t, i] = k.split('+');
  const spec = seatSpecFor(t, +i);
  let ok = 0;
  for (const r of rows) if (spec && exact(() => ({ ...decodeSeatBody(r.hex, r.bits, spec, { strict: true }), __bits: r.bits }))) ok++;
  out.bodies[k] = { n: rows.length, exact: ok, children: spec?.children.join('') ?? null };
}
{
  const c = fix.control;
  const baselines = new ControlBaselines();
  let ok = 0;
  const pos = [];
  for (const r of c.rows) {
    const s = decodeControlState(r.hex, r.bits, { classOf: () => 'SimpleObjectNetworkable', templateOf: () => c.template, baselines });
    if (s.ok) { ok++; pos.push(s.body.pos); }
  }
  out.control = { n: c.rows.length, exact: ok, first: pos[0] ?? null, last: pos.at(-1) ?? null };
}
console.log(JSON.stringify(out));
