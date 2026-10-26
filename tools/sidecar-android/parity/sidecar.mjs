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
//   captureRejoin, options, namesGiveUp, unreachable, identityNull,
//               identityBad, nameNoWs: see each below (the branches no capture reaches)
//
// Runs against the committed level tables with no install and no downloads.
//   node parity/sidecar.mjs
import fs from 'node:fs';
import path from 'node:path';
import { RES, MODELS, writeGz, gunzip, ensureTables, scratchCache } from './lib/tables.mjs';
import { runScenario, KEY } from './lib/sidecar-run.mjs';
import { accept, data, disconnect, denied, pingReq, payload, bitsOf, CHALLENGE, serverInfo, setLevel, createPlayer, serverInfoReply, fakeJoin, keepalive } from './lib/wire-fakes.mjs';

const CAPTURE = path.join(RES, 'session', 'lab-wake-join.capture.ndjson.gz');
const { encodeInputFrame } = await import(path.join(MODELS, 'viewer', 'netcode.js'));

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

  // The same capture twice, a server restart between: the rejoined session
  // hears the same netIds again, so whatever the sidecar carries per netId
  // from one session's control states into the next shows in its acks (Node
  // keeps that state per wire(); the Kotlin port once kept it for the run).
  const inSteps = steps.filter((x) => x.op === 'in');
  const T2 = last + 1600;
  scenarios.captureRejoin = {
    args: ['10.0.0.9:14567', '--name', 'capnode', '--team', '2', '--ws', '17993', '--no-prejoin', '--cdkey', KEY],
    steps: byTime([
      ...inSteps,
      { t: 4500, op: 'pageOpen', sock: 0 }, { t: 4500, ...text(0, { type: 'join', team: 2 }) },
      { t: 6000, ...text(0, { type: 'spawn', team: 2, spawnGroup: 1, kitIndex: 0 }) },
      ...words(0, 6000, 14000, 1),
      { t: last + 100, op: 'in', hex: disconnect(0x19) },
      { t: last + 1150, op: 'probeReply', hex: serverInfoReply('parity lab') },
      ...inSteps.map((x) => ({ ...x, t: +(x.t + T2).toFixed(3) })),
      { t: T2 + 6000, ...text(0, { type: 'spawn', team: 2, spawnGroup: 1, kitIndex: 0 }) },
      ...words(0, T2 + 6000, T2 + 14000, 1000),
      { t: T2 + last + 500, op: 'sigint' },
      { t: T2 + last + 1000, op: 'end' },
    ]),
  };
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

// -- synthetic joins for the branches no capture reaches ---------------------------------
// Events with a reader but no writer, as raw bits in the reader's order.
const createObject = (tid, netId) => ({ type: 'raw', id: 0x07, bits: [...bitsOf(32, tid), ...bitsOf(16, netId), 0] });
const scoreKill = (playerId, victimId, weapon) => ({ type: 'raw', id: 0x2a, bits: [...bitsOf(4, 3), ...bitsOf(8, playerId), ...bitsOf(8, victimId), ...bitsOf(32, weapon), ...bitsOf(8, 0)] });

// The options most runs never give, the page's odd frames, a pre-join look
// that answers, an unknown level, a score with a named weapon, bf42++
// settings and an unknown event; the stay timer ends it.
{
  const j = fakeJoin(100, { extra: [createObject(1242, 300), createObject(99999, 301), { type: 'raw', id: 0x7e }] });
  const s = j.seq;
  const steps = [
    ...j.steps,
    { t: 600, op: 'pageOpen', sock: 0 },
    { t: 610, op: 'pageBin', sock: 0, hex: '' },                         // empty frame
    { t: 620, op: 'pageBin', sock: 0, hex: '0301020304' },               // the room protocol's ping: nothing here
    { t: 630, op: 'pageText', sock: 0, text: '\x055' },                 // JSON, not an object
    { t: 640, op: 'pageText', sock: 0, text: '\x05null' },
    { t: 650, ...text(0, { type: 'identity', name: 'not asked' }) },   // no --name-from-page
    { t: 660, ...text(0, { type: 'join' }) },                           // no side
    { t: 700, ...text(0, { type: 'spawn', team: 2 }) },                 // no spawn group
    { t: 710, ...text(0, { type: 'spawn', team: 2, spawnGroup: 1, kitIndex: 1.5 }) }, // a kit that is not an integer
    { t: 720, ...text(0, { type: 'spawn', spawnGroup: 1 }) },           // no side named
    { t: 800, ...text(0, { type: 'chat', text: '' }) },                 // empty: dropped
    { t: 810, ...text(0, { type: 'chat' }) },
    ...[1, 2, 3, 4, 5, 6].map((i) => ({ t: 820 + i, ...text(0, { type: 'chat', text: `line ${i}`, team: i % 2 === 0 }) })), // past four waiting
    { t: 900, ...text(0, { type: 'seat', action: 'switch', seat: 12 }) }, // out of range: Use
    { t: 910, ...text(0, { type: 'seat', action: 'switch', seat: 2 }) },
    { t: 920, ...text(0, { type: 'reload' }) },
    { t: 930, ...text(0, { type: 'radio', msg: 7 }) },
    { t: 940, ...text(0, { type: 'unknown-row' }) },
    // An input word with the page's jump bit (22) and its pad bit (23).
    { t: 1000, op: 'pageBin', sock: 0, hex: Buffer.concat([Buffer.from([2]), Buffer.from(encodeInputFrame(5, { forward: 1, jump: true, pad: true }, { x: 0, y: 0 }))]).toString('hex') },
    { t: 1010, op: 'pageBin', sock: 0, hex: '0201' },                    // a short word
    ...words(0, 1040, 2600, 6),
    { t: 1500, op: 'in', ack: 'auto', hex: data(s, 0, 0, payload({ index: 3, events: [
      scoreKill(1, 0, 1242), scoreKill(1, 0, 77777),
      { type: 'WelcomeMsg', message: 'Welcome %UI&nfr&hen~ %3DM&D=50&C=red~', index: 0 },
      { type: 'SetTeam', team: 1, playerId: 0 },
    ] })) },
    ...keepalive(1600, 2400, s + 1),
    // A level the cache has no tables for: the saved map stands in, loudly.
    { t: 2500, op: 'in', ack: 'auto', hex: data(s + 4, 0, 0, payload({ index: 4, events: [setLevel('bf1942/levels/berlin/', 'conquest.con'), { type: 'DataBaseComplete', a: 0, b: 0 }] })) },
    ...keepalive(2600, 3600, s + 5),
    { t: 2700, op: 'pageClose', sock: 0 },
    { t: 4500, op: 'end' },
  ];
  scenarios.options = {
    args: ['10.0.0.9:14567', '--name', 'ed', '--team', '2', '--ws', '17994', '--plus-version', '2.1.3', '--pace', 'bucket', '--word-log',
      '--stay', '3.5', '--allow-origin', 'https://x.example', '--allow-origin', '--query-port', '23001', '--tables-url', 'off', '--level-wait', '1', '--cdkey', KEY],
    env: { SIDECAR_DEBUG: '1' },
    prejoin: { mod: 'bf1942', level: 'Wake', mode: 'coop', name: 'parity\r\nlab', source: 'gamespy', queryPort: 23001 },
    steps: byTime(steps),
  };
}

// --names (a saved map with its own animation table, no control point
// names), --retail and --pace slot; a level change whose rejoin is refused
// as full, retried, unanswered and given up at the horizon.
{
  const j = fakeJoin(100, { me: 'nm', team: 1 });
  const s = j.seq;
  const steps = [
    ...j.steps,
    { t: 600, op: 'pageOpen', sock: 0 }, { t: 610, ...text(0, { type: 'join', team: 1 }) },
    { t: 700, ...text(0, { type: 'spawn', team: 1, spawnGroup: 1 }) },
    ...words(0, 720, 1400, 1),
    ...keepalive(700, 1500, s),
    { t: 1500, op: 'in', ack: 'auto', hex: data(s + 3, 0, 0, payload({ index: 3, events: [{ type: 'GameStatus', status: 5, extra: '1234\0', text: 'bf1942' }] })) },
    { t: 1600, op: 'in', hex: disconnect(0x19) },
    // The retail pinger's first probe is 16 s after the drop.
    { t: 17650, op: 'probeReply', hex: serverInfoReply('parity lab') },
    { t: 17700, op: 'in', hex: denied(2) },                              // full: retried
    { t: 40000, op: 'end' },
  ];
  scenarios.namesGiveUp = {
    args: ['10.0.0.9:14567', '--name', 'nm', '--team', '1', '--ws', '17995', '--names', '@PARITY/sidecar-names.json', '--retail', '--pace', 'slot',
      '--rejoin-horizon', '25', '--cdkey', KEY],
    env: { SIDECAR_DEBUG: '1' },
    steps: byTime(steps),
  };
}

// No answer within --connect-timeout (the page is told), then the join; a
// second Ctrl-C while leaving does nothing.
{
  const j = fakeJoin(1600, { me: 'late' });
  const steps = [
    { t: 100, op: 'pageOpen', sock: 0 },
    ...j.steps,
    { t: 2200, ...text(0, { type: 'join', team: 2 }) },
    ...keepalive(2200, 2600, j.seq),
    { t: 2600, op: 'sigint' },
    { t: 2601, op: 'sigint' },
    { t: 3000, op: 'end' },
  ];
  scenarios.unreachable = {
    args: ['10.0.0.9:14567', '--name', 'late', '--ws', '17996', '--connect-timeout', '1', '--cdkey', KEY],
    prejoin: 'throw',
    steps: byTime(steps),
  };
}

// --name-from-page: a page with no profile name, then one too late.
{
  const j = fakeJoin(400, { me: 'fallback' });
  scenarios.identityNull = {
    args: ['10.0.0.9:14567', '--name', 'fallback', '--ws', '17997', '--no-prejoin', '--name-from-page', '--cdkey', KEY],
    steps: byTime([
      { t: 100, op: 'pageOpen', sock: 0 }, { t: 150, ...text(0, { type: 'identity', name: null }) },
      { t: 200, ...text(0, { type: 'identity', name: 'Too Late' }) }, ...j.steps,
      { t: 900, ...text(0, { type: 'identity', name: 'Later Still' }) },
      { t: 1200, op: 'sigint' }, { t: 1500, op: 'end' },
    ]),
  };
}
// --name-from-page: a name that cannot be sent.
{
  const j = fakeJoin(400, { me: 'fallback' });
  scenarios.identityBad = {
    args: ['10.0.0.9:14567', '--name', 'fallback', '--ws', '17998', '--no-prejoin', '--name-from-page', '--cdkey', KEY],
    steps: byTime([
      { t: 100, op: 'pageOpen', sock: 0 }, { t: 150, ...text(0, { type: 'identity', name: 'bad "quote"\u0001' }) }, ...j.steps,
      { t: 1200, op: 'sigint' }, { t: 1500, op: 'end' },
    ]),
  };
}
// --name-from-page with no page socket: the name is --name at once. Ctrl-C
// before the connect has gone (it waits for the pre-join look).
{
  scenarios.nameNoWs = {
    args: ['10.0.0.9:14567', '--name', 'solo', '--name-from-page', '--cdkey', KEY],
    prejoin: null, prejoinDelayMs: 1000,
    steps: [{ t: 100, op: 'sigint' }, { t: 1500, op: 'end' }],
  };
}

ensureTables();
const cache = scratchCache();
const out = {};
for (const [name, sc] of Object.entries(scenarios)) {
  const seed = sc.seed ?? 1942;
  const lines = runScenario(name, { ...sc, seed }, cache, sc.env);
  out[name] = { args: [...sc.args, '--out', 'OUT', '--review', 'REVIEW'], seed, ...(sc.env ? { env: sc.env } : {}),
    ...('prejoin' in sc ? { prejoin: sc.prejoin } : {}), ...(sc.prejoinDelayMs ? { prejoinDelayMs: sc.prejoinDelayMs } : {}), steps: sc.steps, lines };
  console.log(`${name}: ${lines.length} lines`);
}
fs.rmSync(cache, { recursive: true, force: true });
writeGz(path.join(RES, 'sidecar.json.gz'), JSON.stringify(out));
