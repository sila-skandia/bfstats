// Writes core/src/commonTest/resources/parity/sidecar.json.gz from the Node
// sidecar's sidecar.mjs, the glue between the Session and the page: the real
// script, unedited, run under lib/sidecar-preload.mjs (fake clock, fake UDP
// sockets, a fake page socket) through scripted scenarios. A transcript is
// every datagram out, every frame the page is sent, every console line, the
// exit, and the recording and review log written, in order with the virtual
// time. SidecarTest.kt plays the same scenarios against Sidecar.kt (with the
// same command line, read by SidecarMain's parser) and requires the same lines.
//
// Scenarios:
//   capture     the lab join of session.mjs (parity/live/udp-relay.mjs), with a
//               page that connects, joins a side, spawns, plays 8 s of input
//               words, reloads, switches seat, chats, radios, suicides, leaves;
//               a second page that joins mid-round (the live snapshot); SIGINT
//   rejoin      a synthetic server: a level change (GameStatus 5, Disconnect
//               0x19), the rejoin probe and a reconnect with the password, a
//               spawn, then a kick its chat announced (final, exit 1)
//   namedDenied --name-from-page: the page names the player, the server does
//               not answer (unreachable), then refuses (server full, exit 1)
//
// Runs against the committed level tables with no install and no downloads.
//   node parity/sidecar.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { RES, SIDECAR, MODELS, writeGz, gunzip, ensureTables, scratchCache, parityEnv } from './lib/tables.mjs';
import { accept, data, disconnect, denied, pingReq, payload, CHALLENGE, serverInfo, setLevel, createPlayer, serverInfoReply } from './lib/wire-fakes.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PRELOAD = path.join(HERE, 'lib', 'sidecar-preload.mjs');
const CAPTURE = path.join(RES, 'session', 'lab-wake-join.capture.ndjson.gz');
const { encodeInputFrame } = await import(path.join(MODELS, 'viewer', 'netcode.js'));
export const KEY = 'ABCDE-FGHJK-LMNPQ-RSTUV';

const text = (sock, obj) => ({ op: 'pageText', sock, text: `\x05${JSON.stringify(obj)}` });
const inputFrame = (sock, seq, input, look) => ({ op: 'pageBin', sock, hex: Buffer.concat([Buffer.from([2]), Buffer.from(encodeInputFrame(seq, input, look))]).toString('hex') });
// Page words at 30 Hz from t0 to t1, seq from `seq`: walking forward, turning a little.
function words(sock, t0, t1, seq, input = { forward: 1 }) {
  const out = [];
  for (let t = t0, n = seq; t < t1; t += 1000 / 30, n++) out.push({ t: +t.toFixed(3), ...inputFrame(sock, n, n % 45 === 0 ? { ...input, fire: true } : input, { x: 0.01, y: 0 }) });
  return out;
}
const byTime = (steps) => steps.map((s, i) => [s, i]).sort((a, b) => a[0].t - b[0].t || a[1] - b[1]).map(([s]) => s);

const scenarios = {};

// -- the lab capture, with a page -------------------------------------------------------
{
  const cap = gunzip(CAPTURE).trim().split('\n').map((l) => JSON.parse(l)).filter((x) => x.dir);
  const t0 = cap.find((x) => x.dir === 'out').t;
  const steps = [];
  for (const x of cap) if (x.dir === 'in') steps.push({ t: +(x.t - t0).toFixed(3), op: 'in', hex: x.hex });
  const last = steps.at(-1).t;
  steps.push(
    { t: 4500, op: 'pageOpen', sock: 0 }, { t: 4500, ...text(0, { type: 'join', team: 2 }) },
    { t: 6000, ...text(0, { type: 'spawn', team: 2, spawnGroup: 1, kitIndex: 0 }) },
    ...words(0, 6000, 14000, 1),
    { t: 9000, ...text(0, { type: 'reload' }) },
    { t: 10000, ...text(0, { type: 'seat', action: 'switch', seat: 1 }) },
    { t: 10500, ...text(0, { type: 'seat', action: 'enter' }) },
    { t: 11000, ...text(0, { type: 'chat', text: 'hello from the page', team: false }) },
    { t: 11500, ...text(0, { type: 'radio', msg: 3, team: true }) },
    { t: 12000, ...text(0, { type: 'suicide' }) },
    { t: 12500, ...text(0, { type: 'spawn', team: 2, spawnGroup: 0 }) },
    { t: 12600, op: 'pageText', sock: 0, text: '\x05{not json' },
    { t: 15000, op: 'pageBin', sock: 0, hex: '04' },
    { t: 16000, op: 'pageOpen', sock: 1 },
    { t: 16100, ...text(1, { type: 'identity', name: 'late' }) },
    { t: 16200, ...text(1, { type: 'join', team: 1 }) },
    ...words(1, 16300, 17300, 500, { forward: 0, strafe: 1 }),
    { t: 18000, op: 'pageClose', sock: 1 },
    { t: 19000, op: 'pageClose', sock: 0 },
    { t: last + 500, op: 'sigint' },
    { t: last + 1000, op: 'end' },
  );
  scenarios.capture = { args: ['10.0.0.9:14567', '--name', 'capnode', '--team', '2', '--ws', '17990', '--no-prejoin', '--cdkey', KEY], steps: byTime(steps) };
}

// -- a level change, the rejoin, a kick --------------------------------------------------
{
  const steps = [];
  const keepalive = (from, to, seq0) => { const o = []; for (let t = from, n = seq0; t < to; t += 300, n++) o.push({ t, op: 'in', ack: 'auto', hex: pingReq(n, 0, 0, 1000 + n) }); return o; };
  steps.push(
    { t: 40, op: 'in', hex: accept() },
    { t: 100, op: 'in', ack: 'auto', hex: data(1, 0, 0, payload({ index: 0, events: [...serverInfo('bf1942'), { type: 'Challenge', challenge: CHALLENGE, xpack: -1, mod: 'bf1942' }] })) },
    { t: 300, op: 'in', ack: 'auto', hex: data(2, 0, 0, payload({ index: 1, events: [
      setLevel('bf1942/levels/wake/', 'coop.con'), createPlayer(0, 1, false, 'lc', 200), createPlayer(1, 2, true, 'bot', 210),
      { type: 'SetDefaultVehicle', playerId: 0, netId: 202 }, { type: 'DataBaseComplete', a: 0, b: 0 },
    ] })) },
    { t: 600, op: 'in', ack: 'auto', hex: data(3, 0, 0, payload({ index: 2, events: [{ type: 'Simulation', running: true, worldTime: 1 }] })) },
    { t: 700, op: 'pageOpen', sock: 0 }, { t: 700, ...text(0, { type: 'join', team: 2 }) },
    { t: 1000, op: 'in', ack: 'auto', hex: data(4, 0, 0, payload({ index: 3, events: [{ type: 'SetTeam', team: 2, playerId: 0 }] })) },
    ...keepalive(1100, 1500, 5),
    { t: 1500, op: 'in', ack: 'auto', hex: data(7, 0, 0, payload({ index: 4, events: [{ type: 'GameStatus', status: 5, extra: '4711\0', text: 'bf1942' }] })) },
    { t: 1600, op: 'in', hex: disconnect(0x19) },
    { t: 2650, op: 'probeReply', hex: serverInfoReply('parity lab') },
    { t: 2700, op: 'in', hex: accept() },
    { t: 2750, op: 'in', ack: 'auto', hex: data(1, 0, 0, payload({ index: 0, events: [...serverInfo('bf1942'), { type: 'Challenge', challenge: CHALLENGE, xpack: -1, mod: 'bf1942' }] })) },
    { t: 2900, op: 'in', ack: 'auto', hex: data(2, 0, 0, payload({ index: 1, events: [setLevel('bf1942/levels/wake/', 'coop.con'), createPlayer(0, 2, false, 'lc', 300), { type: 'DataBaseComplete', a: 0, b: 0 }] })) },
    { t: 3100, op: 'in', ack: 'auto', hex: data(3, 0, 0, payload({ index: 2, events: [{ type: 'Simulation', running: true, worldTime: 2 }] })) },
    { t: 3500, ...text(0, { type: 'spawn', team: 2, spawnGroup: 2, kitIndex: 1 }) },
    // A kit index out of range: spawnSequence rejects, which the sidecar logs
    // (it was an unhandled rejection that ended the process).
    { t: 3550, ...text(0, { type: 'spawn', team: 2, spawnGroup: 2, kitIndex: 999 }) },
    ...words(0, 3600, 4300, 1),
    ...keepalive(3200, 5000, 4),
    { t: 5000, op: 'in', ack: 'auto', hex: data(20, 0, 0, payload({ index: 3, events: [
      { type: 'ChatFragment', first: true, team: false, noSender: true, serverFlag: true, total: 37, text: 'Player lc was k' },
      { type: 'ChatFragment', first: false, text: 'icked from the ' },
      { type: 'ChatFragment', first: false, text: 'server.' },
    ] })) },
    { t: 5100, op: 'in', hex: disconnect(0x0d) },
    { t: 6000, op: 'end' },
  );
  scenarios.rejoin = { args: ['10.0.0.9:14567', '--name', 'lc', '--team', '1', '--ws', '17991', '--no-prejoin', '--cdkey', KEY], steps: byTime(steps) };
}

// -- the page names the player; no answer; then a refusal ----------------------------------
{
  const steps = [
    { t: 100, op: 'pageOpen', sock: 0 },
    { t: 200, ...text(0, { type: 'identity', name: 'Page Name' }) },
    { t: 300, ...text(0, { type: 'join', team: 1 }) },
    { t: 400, ...text(0, { type: 'identity', name: 'Other' }) },
    { t: 4000, op: 'in', hex: denied(2) },
    { t: 5000, op: 'end' },
  ];
  scenarios.namedDenied = { args: ['10.0.0.9:14567', '--name', 'fallback', '--ws', '17992', '--no-prejoin', '--name-from-page', '--name-wait', '5', '--connect-timeout', '3', '--cdkey', KEY], steps };
}

ensureTables();
const cache = scratchCache();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-parity-'));
const out = {};
for (const [name, sc] of Object.entries(scenarios)) {
  const OUT = path.join(tmp, `${name}.ndjson`), REVIEW = path.join(tmp, `${name}.review.ndjson`);
  const scriptFile = path.join(tmp, `${name}.script.json`), resultFile = path.join(tmp, `${name}.result.ndjson`);
  const seed = sc.seed ?? 1942;
  fs.writeFileSync(scriptFile, JSON.stringify({ seed, steps: sc.steps, out: OUT, review: REVIEW }));
  const args = [...sc.args, '--out', OUT, '--review', REVIEW];
  execFileSync(process.execPath, ['--import', PRELOAD, path.join(SIDECAR, 'sidecar.mjs'), ...args], {
    env: { ...parityEnv(cache), SIDECAR_PARITY_SCRIPT: scriptFile, SIDECAR_PARITY_RESULT: resultFile, SIDECAR_CDKEY_FILE: path.join(tmp, `${name}.cdkeys.json`), SIDECAR_DEBUG: '' },
    stdio: ['ignore', 'inherit', 'inherit'], maxBuffer: 1 << 30,
  });
  const raw = fs.readFileSync(resultFile, 'utf8');
  if (raw.startsWith('driver failed')) throw new Error(`${name}: ${raw}`);
  const lines = raw.trim().split('\n').map((l) => normalise(l, OUT, REVIEW));
  out[name] = { args: [...sc.args, '--out', 'OUT', '--review', 'REVIEW'], seed, steps: sc.steps, lines };
  console.log(`${name}: ${lines.length} lines`);
}
fs.rmSync(tmp, { recursive: true, force: true });
fs.rmSync(cache, { recursive: true, force: true });
writeGz(path.join(RES, 'sidecar.json.gz'), JSON.stringify(out));

/** Paths and the header's wall-clock start, which differ run to run. SidecarTest
 *  applies the same. */
function normalise(line, outPath, reviewPath) {
  return line.split(JSON.stringify(outPath).slice(1, -1)).join('OUT').split(JSON.stringify(reviewPath).slice(1, -1)).join('REVIEW')
    .replace(/\\"start\\":\\"[^"\\]*\\"/g, '\\"start\\":\\"START\\"');
}
