// Writes core/src/test/resources/parity/page-team.json: page-team.mjs over the
// sequence of test_sidecar_page_team.py and seeded random sequences of offers
// and joins, recording each call's answer, what was sent and logged, and the
// held side after it.
//   node parity/page-team.mjs
import fs from 'node:fs';
import { createPageTeam } from '../../bf1942-models/sidecar/page-team.mjs';
import { rng } from './lib/fake-time.mjs';

const S = (joined, team, everSpawned) => ({ joined, team, everSpawned });
const scripted = [
  { op: 'offer', team: 2, state: S(false, 0, false) },
  { op: 'offer', team: 0, state: S(false, 0, false) },
  { op: 'joined', state: S(true, 1, false) },
  { op: 'joined', state: S(true, 1, false) },
  { op: 'offer', team: 1, state: S(false, 0, false) },
  { op: 'joined', state: S(true, 1, false) },
  { op: 'offer', team: 2, state: S(false, 1, true) },
  { op: 'joined', state: S(true, 1, true) },
  { op: 'offer', team: 2, state: S(true, 1, false) },
  { op: 'offer', team: 2, state: S(true, 1, true) },
];

function run(ops) {
  const sent = [], logs = [];
  const pt = createPageTeam({ send: (t) => sent.push(t), log: (l) => logs.push(l) });
  return ops.map((o) => {
    const s0 = sent.length, l0 = logs.length;
    const ret = o.op === 'offer' ? pt.offer(o.team, o.state) : pt.joined(o.state);
    return { ret, sent: sent.slice(s0), logs: logs.slice(l0), held: pt.held };
  });
}

const rand = rng(42);
const pick = (a) => a[Math.floor(rand() * a.length)];
const teams = [0, 1, 2, 3, -1, 1.5, '2', '1', null, 'x', true];
const sequences = [scripted];
for (let n = 0; n < 40; n++) {
  const ops = [];
  for (let i = 0; i < 12; i++) {
    const state = S(rand() < 0.5, pick([0, 1, 2, null]), rand() < 0.3);
    ops.push(rand() < 0.6 ? { op: 'offer', team: pick(teams), state } : { op: 'joined', state });
  }
  sequences.push(ops);
}
const out = { cases: sequences.map((ops) => ({ ops, out: run(ops) })) };
fs.writeFileSync(new URL('../core/src/test/resources/parity/page-team.json', import.meta.url), JSON.stringify(out));
console.log(`${out.cases.length} sequences`);
