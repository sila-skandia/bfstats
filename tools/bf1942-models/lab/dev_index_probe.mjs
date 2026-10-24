// Which input index a human's round is drawn at (ledger DEV-9, DEV-14): a
// sidecar soldier lies still with the assault kit's BAR and fires single
// taps and one burst, while the server's recorder (a `*-rec` scenario) logs
// each round's launch frame (`f`) and its flight (`pn`/`pj`). Every word the
// sender puts on the wire is logged with its serial, so `dev_index_check.py`
// can fit each round's draw to a table index and read it against the word
// that fired it, as a serial and as a count of words released.
//
//   gcc -m32 -O2 -fPIC -shared -DREC_STAGE3=1 -DREC_TICK=1 -DREC_FIRE_INDEX=1 \
//       -o <scratch>/recorder-devix.so features/server-replay-recorder/src/{core,target_lnxded}.c -lpthread
//   (lab/scenarios/sidecar-wake-dev-rec.json with its `preload` pointed at it)
//   node lab/dev_index_probe.mjs 127.0.0.1:14568 probe.ndjson
//   python3 lab/dev_index_check.py probe.ndjson <run>/server/replay_*.ndjson
//
// The recorder's `gi` (Game+0x68 at each `fireBarrel`) is the server's own
// index; without it the check fits the draws alone, which a `d` written at
// 3 decimals cannot resolve (the shipped build's rounding is 0.1 hundredths
// of a radian, against a BAR's prone cone of 0.75).
//
// The serials start at FIRST (default 5001), not at the sender's usual 1, so
// a serial and a count of words released differ by thousands; a hitch's
// merge (`_mergePending`) and a quiet spell's idle records then move the two
// apart again mid-run. KIT is the SpawnRequest's kit (1, the US assault on
// vanilla Wake), SPAWN_GROUP the group asked for first.
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
const NAME = process.env.NAME ?? `devix${Date.now() % 10000}`;
const TEAM = Number(process.env.TEAM ?? 2);
const KIT = Number(process.env.KIT ?? 1);
const FIRST = Number(process.env.FIRST ?? 5001);

const s = new Session(host, Number(portStr), { name: NAME, team: TEAM });
let spawned = false;
s.on('control-state', (c) => {
  log('cs', { tick: c.tick ?? null, serial: c.controlId ?? null, cls: c.cls ?? null,
    pos: c.body?.pos ?? null, rot: c.body?.rot ?? null, aimA: c.body?.aimA ?? null });
});
s.on('event', (ev) => {
  if ((ev.type === 'SetVehicle' || ev.type === 'SetDefaultVehicle') && ev.playerId === s.me.playerId && ev.netId) {
    spawned = true;
    say('spawn', { netId: ev.netId });
  }
});
s.on('denied', (i) => say('denied', i));
s.on('disconnected', (i) => say('disconnected', i));
const joined = new Promise((r) => s.once('joined', r));
await s.start();
say('joined', await joined);

const sender = new InputSender(s, { idle: 'zero', firstSerial: FIRST });
sender.on('sent', (w) => log('sent', { serial: w.serial, idle: w.idle, tag: w.tag, b: w.action.buttons >>> 0 }));
sender.on('merged', (m) => log('merged', m));
sender.start();

// The pump: one word a 33 ms, its buttons the held set plus any one-word
// presses queued for it. `quiet` stops it (the sender's idle records take
// over after 250 ms).
let held = 0, once = 0, tag = 0, quiet = false;
const word = () => { const b = held | once; once = 0; sender.enqueue({ buttons: b }, ++tag); };
const pump = setInterval(() => { if (!quiet) word(); }, 33);
const press = async (name, after = 0) => { once |= BUTTON[name]; say('press', { b: name }); await delay(after); };
const mark = (label) => say('mark', { label });

let shutdown = false;
const finish = async (code = 0) => {
  if (shutdown) return;
  shutdown = true;
  clearInterval(pump);
  sender.stop();
  say('done', { stats: sender.stats, path: sender.path });
  s.leave();
  await delay(400);
  out.end();
  setTimeout(() => process.exit(code), 300);
};
process.on('SIGINT', () => finish(130));

for (let tries = 0, group = Number(process.env.SPAWN_GROUP ?? 0); !spawned && tries < 40; tries++) {
  await spawnSequence(s, { team: TEAM, kit: KIT, spawnGroup: group });
  say('spawnRequest', { kit: KIT, group, tries });
  for (let k = 0; k < 30 && !spawned; k++) await delay(100);
  if (!spawned && tries % 4 === 3) group = (group + 1) % 6;
}
if (!spawned) { say('noSpawn'); await finish(1); }

await delay(2500);
mark('select item 3'); await press('MENU3', 2000);
mark('lie'); await press('LIE', 3500);

const taps = async (n, gap) => { for (let i = 0; i < n; i++) { mark(`tap ${i}`); await press('FIRE', gap); } };
mark('A: twelve taps 1.2 s apart'); await taps(12, 1200);
mark('reload'); await press('RELOAD', 5000);

// A hitch: seven words at once. Above `mergeAbove` the queue merges, and the
// serials of all but the newest merged word never reach the wire.
mark('B: a hitch of seven words');
for (let i = 0; i < 7; i++) word();
await delay(1000);
await taps(5, 1200);

// A quiet spell: no page words, so the sender's idle records run a second
// and a half of ticks, each a serial of its own.
mark('C: quiet 1.5 s'); quiet = true; await delay(1500); quiet = false;
await delay(300);
await taps(5, 1200);
mark('reload'); await press('RELOAD', 5000);

mark('D: fire held 1 s'); held |= BUTTON.FIRE; await delay(1000); held &= ~BUTTON.FIRE;
await delay(2000);
await finish(0);
