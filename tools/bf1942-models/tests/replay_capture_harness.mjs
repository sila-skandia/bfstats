// A replay's capture rings from the server's own timers (viewer/replay-
// capture.js; the server recorder's `cpt` records, features/replay-feature-
// sweep-2026-11-01 entry 7). Parses a small server file and a client file
// of the same flag, answers the rings at chosen times, and runs the page's
// ring source (capture-rings.js) over both. Run by
// `tests/test_replay_capture.py`; prints one JSON object.
//
//   node tests/replay_capture_harness.mjs

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VIEWER = path.join(HERE, '..', 'viewer');
const imp = name => import(pathToFileURL(path.join(VIEWER, name)).href);
const { parseRecording } = await imp('replay-recording.js');
const { captureProgressAt, timersAt } = await imp('replay-capture.js');
const { createCaptureRings } = await imp('capture-rings.js');

const header = plus => JSON.stringify({ k: 'h', t: 0, v: 5, plus, start: 0, hz: 30 });
const cp = { k: 'cp', t: 0, id: 12289, name: 'ALLIES_village', tmpl: 'ControlPoint', pos: [400, 30, 500], team: 2 };
const lines = [
  header('server-replay-recorder/3'),
  JSON.stringify(cp),
  '{"k":"cpt","t":0,"id":12289,"state":4,"by":0,"get":10.00,"lose":10.00,"timeToGet":10.00,"timeToLose":10.00}',
  // Run down from 20 s: a row a quarter second, then lost at 30 s.
  ...Array.from({ length: 40 }, (_, i) => {
    const t = 20 + i * 0.25;
    return JSON.stringify({ k: 'cpt', t, id: 12289, state: 2, by: 0, get: 10, lose: +(10 - (t - 20)).toFixed(2) });
  }),
  '{"k":"cp","t":30,"id":12289,"team":0}',
  '{"k":"cpt","t":30,"id":12289,"state":1,"by":0,"get":10.00,"lose":0.00}',
  // Taken by 1 from 31 s; at 33 s the taker left (faildGettingControl: team 0, timers full).
  '{"k":"cpt","t":31,"id":12289,"state":3,"by":1,"get":9.97,"lose":0.00}',
  '{"k":"cpt","t":32,"id":12289,"state":3,"by":1,"get":8.97,"lose":0.00}',
  '{"k":"cpt","t":33,"id":12289,"state":3,"by":0,"get":10.00,"lose":10.00}',
  '{"k":"cpt","t":40,"id":99,"state":3,"by":1,"get":5,"lose":0}',
];
const server = parseRecording(lines.join('\n'));
const client = parseRecording([header('bf42plus/2'), JSON.stringify(cp), '{"k":"cp","t":30,"id":12289,"team":0}'].join('\n'));
const point = server.controlPoints.get(12289);

const at = t => captureProgressAt(point, t);
const round = r => (r ? { ...r, fraction: Math.round(r.fraction * 1000) / 1000 } : null);
const out = {
  cpTimers: server.cpTimers ?? null,
  rows: point.timers.length,
  full: [point.timeToGet ?? null, point.timeToLose ?? null],
  skipped: server.skipped,
  clientTimers: client.cpTimers ?? null,
  clientPointTimers: client.controlPoints.get(12289).timers ?? null,
  between: timersAt(point, 20.125),
  rings: Object.fromEntries([0, 10, 20, 25.1, 29.99, 30, 30.5, 31, 31.5, 32.5, 33, 40].map(t => [t, round(at(t))])),
  noFullTimes: round(captureProgressAt({ ...point, timeToGet: undefined }, 31.5, { timeToGet: 20 })),
};

// The page's ring source: the server's timers when the replay hands them in,
// the estimate otherwise. A replay's page has no flags of its own listed
// (the spawn screen fills them), so the repaint key walks the names the
// replay gives.
const flags = [];
let input = null;
const rings = createCaptureRings({ flags, replayCapture: () => input });
input = { t: 31.5, playersAt: () => [], timerNames: ['ALLIES_village'],
          progressOf: name => (name === 'ALLIES_village' ? at(31.5) : null) };
rings.tick();
out.pageTimers = { source: rings.source(), ring: rings.ringFor('ALLIES_village'), other: rings.ringFor('nowhere'), key: rings.key() };
input = { t: 31.5, playersAt: () => [] };
rings.tick();
out.pageEstimate = { source: rings.source(), ring: rings.ringFor('ALLIES_village') };

console.log(JSON.stringify(out));
