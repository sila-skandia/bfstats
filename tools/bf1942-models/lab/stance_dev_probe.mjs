// What a human's hand-weapon cone is on the server, by stance and movement
// (ledger DEV-1, DEV-6, DEV-7, DEV-14): a sidecar soldier with the assault
// kit's BAR taps single rounds standing still, walking, at timed delays
// after he stops walking, at timed delays after a jump, in a burst, and
// crouched and prone, still and moving. The server's recorder (built with
// -DREC_FIRE_INDEX=1, see lab/dev_index_probe.mjs) logs each round's launch
// frame, flight and input index, and `stance_dev_check.py` reads each
// round's total off its draw at that index and replays the engine's
// deviation law over the words the probe sent, tick by tick.
//
//   BF42_LAB=<lab> BF42_LAB_PORT_OFFSET=<n> python3 lab/lab.py start lab/scenarios/sidecar-wake-dev-rec.json --wait 0
//     (its `preload` pointed at the REC_FIRE_INDEX recorder)
//   node lab/stance_dev_probe.mjs 127.0.0.1:<port> probe.ndjson
//   python3 lab/stance_dev_check.py probe.ndjson <run>/server/replay_*.ndjson
//
// The walking strokes alternate forward and back so the soldier stays near
// his spawn. Every word the sender puts on the wire is logged with its
// serial, its buttons and its throttle; `mark` rows name the phase.
import fs from 'node:fs';
import { Session } from '../sidecar/session.mjs';
import { InputSender, spawnSequence, BUTTON } from '../sidecar/input.mjs';

const [target, outPath] = process.argv.slice(2);
const [host, portStr] = target.split(':');
const out = fs.createWriteStream(outPath);
const T0 = Date.now();
const log = (kind, rec = {}) => out.write(JSON.stringify({ kind, ms: Date.now() - T0, wall: Date.now(), ...rec }) + '\n');
const say = (kind, rec = {}) => { log(kind, rec); console.log(kind, JSON.stringify(rec)); };
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const NAME = process.env.NAME ?? `sdev${Date.now() % 10000}`;
const TEAM = Number(process.env.TEAM ?? 2);
const KIT = Number(process.env.KIT ?? 1);
const FIRST = Number(process.env.FIRST ?? 7001);
const PHASES = (process.env.PHASES ?? 'still,walk,settle,jump,burst,crouch,prone').split(',');

const s = new Session(host, Number(portStr), { name: NAME, team: TEAM });
let spawned = false;
s.on('control-state', (c) => {
  log('cs', { serial: c.controlId ?? null, pos: c.body?.pos ?? null });
});
s.on('event', (ev) => {
  if ((ev.type === 'SetVehicle' || ev.type === 'SetDefaultVehicle') && ev.playerId === s.me.playerId && ev.netId) {
    spawned = true;
    say('spawn', { netId: ev.netId });
  }
});
s.on('disconnected', (i) => say('disconnected', i));
const joined = new Promise((r) => s.once('joined', r));
await s.start();
say('joined', await joined);

const sender = new InputSender(s, { idle: 'zero', firstSerial: FIRST });
sender.on('sent', (w) => log('sent', { serial: w.serial, idle: w.idle, tag: w.tag, b: w.action.buttons >>> 0, ax: w.action.axes }));
sender.on('merged', (m) => log('merged', m));
sender.start();

// One word a 33 ms: the held buttons, any one-word presses, the throttle.
let held = 0, once = 0, tag = 0, throttle = 0;
const pump = setInterval(() => {
  const b = held | once; once = 0;
  sender.enqueue({ buttons: b, throttle }, ++tag);
}, 33);
const press = async (name, after = 0) => { once |= BUTTON[name]; say('press', { b: name }); await delay(after); };
const mark = (label) => say('mark', { label });
let dir = 1;
const walk = async (ms) => { throttle = dir; dir = -dir; await delay(ms); };
const stop = () => { throttle = 0; };

const finish = async (code = 0) => {
  clearInterval(pump);
  sender.stop();
  say('done', { stats: sender.stats });
  s.leave();
  await delay(400);
  out.end();
  setTimeout(() => process.exit(code), 300);
};
process.on('SIGINT', () => finish(130));

for (let tries = 0, group = Number(process.env.SPAWN_GROUP ?? 0); !spawned && tries < 40; tries++) {
  await spawnSequence(s, { team: TEAM, kit: KIT, spawnGroup: group });
  for (let k = 0; k < 30 && !spawned; k++) await delay(100);
  if (!spawned && tries % 4 === 3) group = (group + 1) % 6;
}
if (!spawned) { say('noSpawn'); await finish(1); }

await delay(2500);
mark('select item 3'); await press('MENU3', 2500);
const reload = async () => { mark('reload'); await press('RELOAD', 5000); };

async function stancePhase(stance) {
  mark(`${stance}: still taps`);
  for (let i = 0; i < 3; i++) await press('FIRE', 1500);
  mark(`${stance}: moving taps`);
  for (let i = 0; i < 3; i++) {
    throttle = dir; dir = -dir;
    await delay(1500);
    await press('FIRE', 100);
    stop();
    await delay(1500);
  }
}

for (const phase of PHASES) {
  if (phase === 'still') {
    mark('still: taps'); for (let i = 0; i < 4; i++) await press('FIRE', 1500);
  } else if (phase === 'walk') {
    mark('walk: taps while walking');
    for (let i = 0; i < 3; i++) { await walk(1500); await press('FIRE', 100); stop(); await delay(1500); }
    await reload();
  } else if (phase === 'settle') {
    for (const after of [0, 100, 300, 600]) {
      await walk(1500); stop();
      mark(`settle: tap ${after} ms after release`);
      await delay(after);
      await press('FIRE', 2000);
    }
  } else if (phase === 'jump') {
    for (const after of [150, 400, 900, 1300]) {
      await delay(1500);
      mark(`jump: tap ${after} ms after the jump`);
      await press('ACTION', after);
      await press('FIRE', 2000);
    }
    await reload();
  } else if (phase === 'burst') {
    await delay(1500);
    mark('burst: fire held 700 ms'); held |= BUTTON.FIRE; await delay(700); held &= ~BUTTON.FIRE;
    await delay(1500);
    await reload();
  } else if (phase === 'crouch') {
    held |= BUTTON.CROUCH; await delay(2000);
    await stancePhase('crouch');
    held &= ~BUTTON.CROUCH; await delay(1000);
    await reload();
  } else if (phase === 'prone') {
    mark('lie'); await press('LIE', 3500);
    await stancePhase('prone');
  }
}
await delay(1000);
await finish(0);
