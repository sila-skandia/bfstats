// Where another client draws a soldier's round from, against where the server
// fires it (wire.md section 44, "The line a remote's round is drawn on"): a
// sidecar soldier fires single taps, taps while turning and short bursts
// standing, crouched and prone, looking up and down between them, while the
// server's recorder (a `*-rec` scenario) logs each round's launch frame (`f`)
// and a second sidecar (`sidecar/sidecar.mjs --team <same>`) records the
// soldier's ghost, from which `ghost-writer.mjs` writes its own `k:"f"` rows.
// `fire_line_check.py` pairs the two and prints the miss in mrad and metres.
//
//   node sidecar/sidecar.mjs 127.0.0.1:14568 --name watch --team 2 \
//       --out watch.ndjson --review /dev/null --stay 0 &
//   node lab/fire_line_probe.mjs 127.0.0.1:14568 probe.ndjson
//   python3 lab/fire_line_check.py watch.ndjson <run>/server/replay_*.ndjson
//
// KIT is the SpawnRequest's kit (1, the US assault on vanilla Wake: the BAR,
// item 3, whose recoil never goes back), ITEM the item selected.
import fs from 'node:fs';
import { Session } from '../sidecar/session.mjs';
import { InputSender, spawnSequence, BUTTON } from '../sidecar/input.mjs';

const [target, outPath] = process.argv.slice(2);
const [host, portStr] = target.split(':');
const out = fs.createWriteStream(outPath);
const T0 = Date.now();
const log = (kind, rec = {}) => out.write(JSON.stringify({ kind, ms: Date.now() - T0, ...rec }) + '\n');
const say = (kind, rec = {}) => { log(kind, rec); console.log(kind, JSON.stringify(rec)); };
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const NAME = process.env.NAME ?? `fline${Date.now() % 10000}`;
const TEAM = Number(process.env.TEAM ?? 2);
const KIT = Number(process.env.KIT ?? 1);
const ITEM = process.env.ITEM ?? 'MENU3';

const s = new Session(host, Number(portStr), { name: NAME, team: TEAM });
let spawned = false;
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

const sender = new InputSender(s, { idle: 'zero' });
sender.start();

// One word a 33 ms: the held buttons, any one-word presses, and the look.
let held = 0, once = 0, tag = 0, lookX = 0, lookY = 0, throttle = 0, strafe = 0;
const pump = setInterval(() => {
  const b = held | once; once = 0;
  sender.enqueue({ buttons: b, mouseLookX: lookX, mouseLookY: lookY, throttle, yaw: strafe }, ++tag);
}, 33);
const press = async (name, after = 0) => { once |= BUTTON[name]; await delay(after); };
const mark = (label) => say('mark', { label });
const look = async (x, y, ms) => { lookX = x; lookY = y; await delay(ms); lookX = 0; lookY = 0; };

const finish = async (code = 0) => {
  clearInterval(pump);
  sender.stop();
  say('done', {});
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
await press(ITEM, 2000);

// One stance's drill: level taps, taps looking up and down, taps while
// turning (the look still moving as the round leaves), a short burst.
async function drill(stance) {
  mark(`${stance}: taps`);
  for (let i = 0; i < 4; i++) await press('FIRE', 1200);
  mark(`${stance}: look up, taps`);
  await look(0, -0.5, 400);
  for (let i = 0; i < 3; i++) await press('FIRE', 1200);
  mark(`${stance}: look down, taps`);
  await look(0, 0.8, 400);
  for (let i = 0; i < 3; i++) await press('FIRE', 1200);
  await look(0, -0.3, 400);
  mark(`${stance}: taps turning`);
  for (let i = 0; i < 4; i++) { lookX = i % 2 ? -0.6 : 0.6; await delay(150); await press('FIRE', 150); lookX = 0; await delay(900); }
  mark(`${stance}: burst`);
  held |= BUTTON.FIRE; await delay(500); held &= ~BUTTON.FIRE;
  await delay(1500);
  await press('RELOAD', 5000);
}

// MOVE=1: first, taps and a burst walking forward and strafing while
// turning, standing (a soldier on the move is in every block).
if (process.env.MOVE) {
  mark('moving: taps walking');
  throttle = 1;
  for (let i = 0; i < 4; i++) await press('FIRE', 700);
  throttle = 0; strafe = 1;
  mark('moving: taps strafing and turning');
  for (let i = 0; i < 4; i++) { lookX = i % 2 ? -0.4 : 0.4; await press('FIRE', 700); }
  lookX = 0;
  mark('moving: burst strafing');
  strafe = -1; held |= BUTTON.FIRE; await delay(500); held &= ~BUTTON.FIRE; strafe = 0;
  await delay(1000);
  await press('RELOAD', 5000);
}
await drill('stand');
mark('crouch'); held |= BUTTON.CROUCH; await delay(2000);
await drill('crouch');
held &= ~BUTTON.CROUCH; await delay(500);
mark('lie'); await press('LIE', 3500);
await drill('prone');
await finish(0);
