// A sidecar page's remote soldiers' rounds: one drawn for each `k:"f"` round
// row the sidecar wrote, on the row's line, at the drawn shooter
// (`viewer/net-hand-rounds.js`, wire.md section 44, "Who reads the rows").
//
// Feeds a sidecar recording, row by row in its order, through the page's
// sidecar state (`net-sidecar.js`) and the round queue, on a page clock that
// is the newest row's time (a row is read as it arrives). Two laws for the
// remotes' drawn clock: `retail` (section 38: the client's clock, a little
// past the newest sample, here +0.05 s) and `lookback` (the newest sample's
// time less 0.1 s, the old law), under which a round waits for the drawn
// clock to reach it.
//
// Prints counts and the drawn rounds' distances from the rows' own points.
// Run by tests/test_sidecar_hand_rounds.py.
import fs from 'node:fs';
import { createSidecarState } from '../viewer/net-sidecar.js';
import { createHandRounds } from '../viewer/net-hand-rounds.js';

const [file] = process.argv.slice(2);
const rows = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

function run(law) {
  const st = createSidecarState();
  // The page's clock is the rows' own (`t`, the sidecar's session seconds,
  // which runs on through a round restart's tick reset); the samples' clock
  // is that plus the newest sample's offset between the two.
  const drawnTime = (nowMs) => nowMs / 1000 + (st.state.clock - (st.state.clockT ?? 0)) + (law === 'retail' ? 0.05 : -0.1);
  const q = createHandRounds({
    drawnTime,
    playerAt: (slot, nowMs) => st.playerRow(slot, drawnTime(nowMs)),
    playerAtTime: (slot, t) => st.playerRow(slot, t),
  });
  const out = { rows: 0, handRows: 0, soldierShots: 0, fireStateShots: 0, drawn: 0, noLine: 0,
                waited: 0, late: [], fromP: [], shift: [] };
  let nowMs = 0;
  for (const r of rows) {
    st.ingest(r);
    if (Number.isFinite(r.t)) nowMs = Math.max(nowMs, r.t * 1000);
    if (r.k === 'f' && !r.w && st.state.objects.get(r.id)?.cls === 'BFSoldierNetworkable') out.rows++;
    for (const e of st.state.pending.splice(0)) {
      if (e.type === 'handRound') { out.handRows++; q.push(e, nowMs); }
      // A soldier's round row must no longer reach the 'shot' path (it played
      // a second report at him, as a hull's).
      if (e.type === 'shot' && e.seat && st.state.objects.get(e.vehicle)?.cls === 'BFSoldierNetworkable') out.soldierShots++;
      if (e.type === 'shot' && !e.seat) out.fireStateShots++;
    }
    const pendingBefore = q.pending();
    for (const s of q.due(nowMs)) take(s);
    if (q.pending() && q.pending() === pendingBefore) out.waited = Math.max(out.waited, q.pending());
  }
  for (const s of q.due(nowMs + 10_000)) take(s);
  function take(s) {
    out.drawn++;
    if (!s.origin || !s.dir) { out.noLine++; return; }
    out.late.push(s.late);
    const row = s.row;
    const p = { x: row.pos[0], y: row.pos[1], z: -row.pos[2] };
    out.fromP.push(Math.hypot(s.origin.x - p.x, s.origin.y - p.y, s.origin.z - p.z));
    out.shift.push(s.shift);
  }
  const stat = (a) => {
    const v = [...a].filter(Number.isFinite).sort((x, y) => x - y);
    return v.length ? { n: v.length, median: v[v.length >> 1], p90: v[Math.floor(v.length * 0.9)], max: v[v.length - 1], min: v[0] } : null;
  };
  return { ...out, late: stat(out.late), fromP: stat(out.fromP), shift: stat(out.shift) };
}

console.log(JSON.stringify({ retail: run('retail'), lookback: run('lookback') }));
