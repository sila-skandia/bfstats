// The capture rings on a real server's stream, through the page's own path:
// a sidecar's recording (`sidecar.mjs --out`) of a lab capture is fed row by
// row to the page's sidecar state (`viewer/net-sidecar.js`
// createSidecarState), and `viewer/capture-rings.js` createCaptureRings runs
// on it as map.html runs it in sidecar play: `roomJoined`, the client's
// newest rows (`remotePlayerAtTime(slot, null)`), the server's clock, and
// the flags' teams set from the server's `cp` rows as net-room.js sets them.
// Prints one JSON object. Run by tests/test_capture_rings.py.
//
//   node tests/capture_ring_net_harness.mjs <stream.ndjson[.gz]> <points.json>

import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VIEWER = path.join(HERE, '..', 'viewer');
const { createSidecarState } = await import(path.join(VIEWER, 'net-sidecar.js'));
const { createCaptureRings } = await import(path.join(VIEWER, 'capture-rings.js'));

const read = p => {
  const buf = fs.readFileSync(p);
  return (p.endsWith('.gz') ? zlib.gunzipSync(buf) : buf).toString('utf8');
};
const [streamPath, pointsPath, mode = 'Conquest'] = process.argv.slice(2);
const rows = read(streamPath).split('\n').filter(Boolean).map(l => JSON.parse(l));
const scene = JSON.parse(read(pointsPath));
const flags = (scene.modes?.[mode]?.controlPoints ?? []).map(cp => ({
  ...cp, controlPointName: cp.name, uncapturable: !!cp.unableToChangeTeam,
}));
const byName = new Map(flags.map(f => [f.name.toLowerCase(), f]));

const st = createSidecarState();
const client = {
  slot: null,
  remoteSlots: () => [...st.state.roster.keys()],
  remotePlayerAtTime: (slot, t) => st.playerRow(slot, t),
  clock: () => st.state.clock,
};
// The page's frames: 30 a second on the rows' own clock (the sidecar's `t`,
// which runs at the server's rate), whether or not a row came.
let frameT = null;
const rings = createCaptureRings({
  flags, roomJoined: true, roomClient: client, LOCAL_PLAYER: 0, now: () => frameT * 1000,
  replayCapture: () => null, capturePosition: () => null, sprite: () => null,
});

const words = [];
const samples = [];
let lastSample = -1;
function frame() {
  rings.tick();
  const clock = st.state.clock;
  if (Number.isFinite(clock) && frameT - lastSample >= 0.5) {
    lastSample = frameT;
    for (const f of flags) {
      const g = rings.ringFor(f.name);
      if (g) samples.push({ t: +frameT.toFixed(2), name: f.name, kind: g.kind, team: g.team, sprite: g.sprite });
    }
  }
}
for (const r of rows) {
  if (Number.isFinite(r.t)) {
    if (frameT == null) frameT = r.t;
    while (frameT + 1 / 30 <= r.t) { frameT += 1 / 30; frame(); }
  }
  st.ingest(r);
  if (r.k === 'e' && r.e === 'cp') {
    const f = byName.get(String(r.tmpl ?? r.name ?? '').toLowerCase());
    if (f && f.team !== r.team) {
      const before = rings.ringFor(f.name);
      words.push({ name: f.name, t: r.t, clock: st.state.clock, from: f.team, to: r.team, ringBefore: before ? { kind: before.kind, team: before.team, sprite: before.sprite } : null });
      f.team = r.team;
    } else if (f) f.team = r.team;
  }
}
// Where the page has the probe: a cross-check of the frames.
const players = [...st.state.roster.keys()].map(s => st.playerRow(s, null)).filter(Boolean)
  .map(p => ({ team: p.team, alive: p.alive, x: +p.x.toFixed(1), y: +p.y.toFixed(1), z: +p.z.toFixed(1) }));
console.log(JSON.stringify({ source: rings.source(), words, samples, players, corrections: rings.estimate.corrections }));
