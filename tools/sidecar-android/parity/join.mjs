// Writes core/src/commonTest/resources/parity/join.json.gz from the Node
// sidecar's join.mjs (the bare-client POC tester), run unedited under
// lib/sidecar-preload.mjs as parity/sidecar.mjs runs sidecar.mjs: every
// datagram out, every console line, the exit and the --log file. JoinTest.kt
// plays the same scripts against tools/JoinCli.kt.
//   node parity/join.mjs
import path from 'node:path';
import { RES, writeGz, ensureTables, scratchCache } from './lib/tables.mjs';
import { runScenario, KEY } from './lib/sidecar-run.mjs';
import { data, payload, disconnect, denied, fakeJoin, keepalive } from './lib/wire-fakes.mjs';
import fs from 'node:fs';

const scenarios = {};
{
  // Joins, hears a world dump and an unknown event, stays 2 s, leaves.
  const j = fakeJoin(100, { me: 'probe', extra: [{ type: 'raw', id: 0x7e }] });
  scenarios.stay = { args: ['10.0.0.9:14567', '--name', 'probe', '--team', '2', '--stay', '2', '--cdkey', KEY], steps: [...j.steps, ...keepalive(700, 2600, j.seq), { t: 3000, op: 'end' }] };
}
{
  // --verbose (every event and ghost logged), then Ctrl-C twice.
  const j = fakeJoin(100, { me: 'loud' });
  scenarios.verbose = { args: ['10.0.0.9:14567', '--name', 'loud', '--verbose', '--cdkey', KEY], steps: [...j.steps, ...keepalive(700, 1300, j.seq), { t: 1400, op: 'sigint' }, { t: 1401, op: 'sigint' }, { t: 2000, op: 'end' }] };
}
{
  // The server refuses the join.
  scenarios.denied = { args: ['10.0.0.9:14567', '--name', 'full', '--cdkey', KEY], steps: [{ t: 100, op: 'in', hex: denied(2) }, { t: 500, op: 'end' }] };
}
{
  // The server drops the client mid-session; a malformed datagram first.
  const j = fakeJoin(100, { me: 'dropped' });
  scenarios.dropped = { args: ['10.0.0.9:14567', '--name', 'dropped', '--cdkey', KEY, '--stay'],
    steps: [...j.steps, { t: 800, op: 'in', hex: '0000' }, { t: 900, op: 'in', ack: 'auto', hex: data(j.seq, 0, 0, Buffer.from([0xff])) }, { t: 1000, op: 'in', hex: disconnect(0x0d) }, { t: 1500, op: 'end' }] };
}

ensureTables();
const cache = scratchCache();
const out = {};
for (const [name, sc] of Object.entries(scenarios)) {
  const seed = 1942;
  const lines = runScenario(name, { ...sc, seed }, cache, {}, { entry: 'join.mjs', files: (o) => ['--log', o] });
  out[name] = { args: [...sc.args, '--log', 'OUT'], seed, steps: sc.steps, lines };
  console.log(`${name}: ${lines.length} lines`);
}
fs.rmSync(cache, { recursive: true, force: true });
writeGz(path.join(RES, 'join.json.gz'), JSON.stringify(out));
