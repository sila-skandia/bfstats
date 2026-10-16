// The vehicle specs computed from the install (template-table.mjs: the level
// load's graph, derive-children.mjs deriveLevel) against the ones they
// replace and against real wire bodies from Wake and El Alamein
// (fixtures/sidecar_derived_children.json, sidecar review logs 2026-10-16):
//   - the six hand specs, hand gunner seats and hand joint rows once in
//     children.mjs (fixtures/sidecar_hand_specs.json);
//   - the vanilla derivation from an extracted Objects tree
//     (sidecar/ghost/derived-specs.json) and the hulls built from the
//     exported models (sidecar/hulls.json), on every vanilla level.
// Prints one JSON line. SIDECAR_CACHE points at a scratch directory.
import fs from 'node:fs';
import { levelTemplates } from '../sidecar/template-table.mjs';
import { useLevelTemplates, specFor, seatSpecFor, childrenFor, hullFor, jointPartsFor } from '../sidecar/ghost/children.mjs';
import { decodePcoBody, decodeSeatBody } from '../sidecar/ghost/pco.mjs';
import { decodeControlState, ControlBaselines } from '../sidecar/ghost/control-state.mjs';

const read = (rel) => JSON.parse(fs.readFileSync(new URL(rel, import.meta.url), 'utf8'));
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort()) : x));
const LEVELS = (process.env.VANILLA_LEVELS ?? 'wake,el_alamein').split(',');
const wake = levelTemplates({ mod: 'bf1942', level: 'wake', mode: 'coop' });
const alamein = levelTemplates({ mod: 'bf1942', level: 'el_alamein', mode: 'coop' });
const out = { install: !!(wake && alamein), hand: {}, handSeats: {}, handJoints: {}, specs: null, hulls: null, fresh: {}, bodies: {}, control: null };

if (out.install) {
  // The hand specs: every field they wrote.
  const hand = read('./fixtures/sidecar_hand_specs.json');
  useLevelTemplates(wake, 'bf1942 wake coop');
  for (const [t, h] of Object.entries(hand.specs)) {
    const c = specFor(t);
    out.hand[t] = Object.fromEntries(Object.keys(h).map((k) => [k, canon(h[k]) === canon(c?.[k]) ? true : [h[k], c?.[k] ?? null]]));
  }
  for (const [t, seats] of Object.entries(hand.seats)) {
    for (const [i, s] of Object.entries(seats)) {
      const c = seatSpecFor(t, +i);
      out.handSeats[`${t}+${i}`] = Object.fromEntries(Object.keys(s).map((k) => [k, canon(s[k]) === canon(c?.[k]) ? true : [s[k], c?.[k] ?? null]]));
    }
  }
  for (const [t, seats] of Object.entries(hand.joints)) {
    for (const [i, j] of Object.entries(seats)) {
      const derived = specFor(t)?.joints?.[i] ?? null;
      out.handJoints[`${t}+${i}`] = { served: canon(jointPartsFor(t, +i)) === canon(j), derived: canon(derived) === canon(j) };
    }
  }
  for (const t of ['Willy', 'Zero', 'Corsair']) out.fresh[t] = { children: specFor(t).children.join(''), nodes: specFor(t).nodes };

  // The vanilla derivation and hulls, on every vanilla level that has them.
  const fixSpecs = read('../sidecar/ghost/derived-specs.json').specs;
  const fixHulls = read('../sidecar/hulls.json');
  const specs = { compared: 0, templates: new Set(), diffs: [] };
  const hulls = { compared: 0, templates: new Set(), diffs: [] };
  for (const level of LEVELS) for (const mode of ['coop', 'conquest']) {
    const t = levelTemplates({ mod: 'bf1942', level, mode });
    if (!t) continue;
    for (const [name, f] of Object.entries(fixSpecs)) {
      const c = t.specs[name];
      if (!c) continue;
      specs.compared++; specs.templates.add(name);
      if (canon(f) !== canon(c)) specs.diffs.push(`${level} ${mode} ${name}`);
    }
    for (const [name, f] of Object.entries(fixHulls)) {
      const c = t.hulls[name];
      if (!c) continue;
      hulls.compared++; hulls.templates.add(name);
      const parts = Object.entries(f.parts ?? {}).every(([p, v]) => canon(v) === canon(c.parts?.[p]));
      if (f.maxHp !== c.maxHp || (f.mobile !== false) !== (c.mobile !== false) || !parts) hulls.diffs.push(`${level} ${mode} ${name}: ${canon(f)} -> ${canon(c)}`);
    }
  }
  out.specs = { compared: specs.compared, templates: specs.templates.size, of: Object.keys(fixSpecs).length, diffs: specs.diffs };
  out.hulls = { compared: hulls.compared, templates: hulls.templates.size, of: Object.keys(fixHulls).length, diffs: hulls.diffs, missing: Object.keys(fixHulls).filter((n) => !hulls.templates.has(n)) };

  // Real wire bodies, read with the computed specs of the level they came from.
  const fix = read('./fixtures/sidecar_derived_children.json');
  const levelOf = (k) => ((fix.source[k] ?? '').startsWith('el_alamein') ? alamein : wake);
  const exact = (fn) => { try { const b = fn(); return b.consumed === b.__bits; } catch { return false; } };
  for (const [t, rows] of Object.entries(fix.hulls)) {
    useLevelTemplates(levelOf(t), t);
    const h = hullFor(t);
    const base = (r) => ({ ...(r.ref ? { ref: r.ref } : {}), maxHp: h.maxHp, mobile: h.mobile !== false, strict: true });
    let ok = 0;
    for (const r of rows) if (exact(() => ({ ...decodePcoBody(r.hex, r.bits, { template: t, ...base(r) }), __bits: r.bits }))) ok++;
    out.bodies[t] = { n: rows.length, exact: ok, children: childrenFor(t)?.children.join('') };
  }
  for (const [k, rows] of Object.entries(fix.seats)) {
    const [t, i] = k.split('+');
    useLevelTemplates(levelOf(k), k);
    const spec = seatSpecFor(t, +i);
    let ok = 0;
    for (const r of rows) if (spec && exact(() => ({ ...decodeSeatBody(r.hex, r.bits, spec, { strict: true }), __bits: r.bits }))) ok++;
    out.bodies[k] = { n: rows.length, exact: ok, children: spec?.children.join('') ?? null };
  }
  {
    const c = fix.control;
    useLevelTemplates(alamein, 'el_alamein');
    const baselines = new ControlBaselines();
    let ok = 0;
    const pos = [];
    for (const r of c.rows) {
      const s = decodeControlState(r.hex, r.bits, { classOf: () => 'SimpleObjectNetworkable', templateOf: () => c.template, baselines });
      if (s.ok) { ok++; pos.push(s.body.pos); }
    }
    out.control = { n: c.rows.length, exact: ok, first: pos[0] ?? null, last: pos.at(-1) ?? null };
  }
}
console.log(JSON.stringify(out));
