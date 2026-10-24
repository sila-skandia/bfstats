// When the server lets a human's hand weapon fire through its magazines,
// reloads and item switches: a sidecar soldier with the assault kit (BAR,
// item 3; Colt, item 2) holds the trigger through a magazine and on past it,
// reloads part-spent, switches mid-reload and holds the trigger across a
// switch. The server's recorder (`*-rec` scenario; REC_FIRE_INDEX for `gi`)
// logs each round with its weapon and input index, so `mag_cycle_check.py`
// can put every round on the tick of the word that fired it and read the
// magazine sizes, the reload's length and the switch's delay off the gaps.
//
//   node lab/mag_cycle_probe.mjs 127.0.0.1:<port> probe.ndjson
//   python3 lab/mag_cycle_check.py probe.ndjson <run>/server/replay_*.ndjson
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
const NAME = process.env.NAME ?? `mag${Date.now() % 10000}`;
const TEAM = Number(process.env.TEAM ?? 2);
const KIT = Number(process.env.KIT ?? 1);
const FIRST = Number(process.env.FIRST ?? 20001);

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

const sender = new InputSender(s, { idle: 'zero', firstSerial: FIRST });
sender.on('sent', (w) => log('sent', { serial: w.serial, idle: w.idle, b: w.action.buttons >>> 0 }));
sender.start();

let held = 0, once = 0, tag = 0;
const pump = setInterval(() => { const b = held | once; once = 0; sender.enqueue({ buttons: b }, ++tag); }, 33);
const press = async (name, after = 0) => { once |= BUTTON[name]; say('press', { b: name }); await delay(after); };
const hold = async (ms) => { held |= BUTTON.FIRE; say('hold', { ms }); await delay(ms); held &= ~BUTTON.FIRE; say('release', {}); };
const mark = (label) => say('mark', { label });

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
const word1 = async (name) => { once |= BUTTON[name]; say('press', { b: name }); };
const ticks = (n) => delay(33 * n);
if (process.env.PHASES === 'raise') {
  // Each raise, then the trigger held from the word after it: the first
  // round's tick is the first the raised item takes a press on.
  for (let i = 0; i < 4; i++) {
    for (const [item, name] of [['MENU2', 'Colt'], ['MENU3', 'BAR']]) {
      mark(`R: raise the ${name}, fire held from the next word`);
      await word1(item); await ticks(1);
      held |= BUTTON.FIRE; await ticks(12); held &= ~BUTTON.FIRE;
      await delay(1500);
    }
  }
  mark('reload'); await press('RELOAD', 5000);
} else if ((process.env.PHASES ?? 'mag') === 'semi') {
  mark('select Colt'); await press('MENU2', 2500);
  mark('G1: Colt held 2 s'); await hold(2000); await delay(1000);
  mark('G2: Colt tap, then a press 2 ticks later held 400 ms');
  await word1('FIRE'); await ticks(2); await hold(400); await delay(1000);
  mark('G3: Colt tap, then a one-word tap 3 ticks later');
  await word1('FIRE'); await ticks(3); await word1('FIRE'); await delay(1000);
  mark('G4: Colt tap, then a one-word tap 5 ticks later');
  await word1('FIRE'); await ticks(5); await word1('FIRE'); await delay(1000);
  mark('reload'); await press('RELOAD', 4000);
  mark('H: switch to the BAR, hold fire from the switch'); held |= BUTTON.FIRE; await press('MENU3', 2000); held &= ~BUTTON.FIRE;
  await delay(1000);
  mark('H2: switch to the Colt, taps every 2 ticks'); await press('MENU2', 0);
  for (let i = 0; i < 12; i++) { await ticks(1); await word1('FIRE'); await ticks(1); }
  await delay(1000);
} else {
await delay(2500);
mark('select BAR'); await press('MENU3', 2500);
mark('A: hold through the magazine and 7 s on'); await hold(10000);
await delay(1500);
mark('B: 5 rounds, then reload, then hold'); await hold(600); await delay(500);
await press('RELOAD', 1500); mark('B: hold from 1.5 s into the reload'); await hold(5000);
await delay(1500);
mark('C: reload, switch to the Colt 1 s in, back 1 s later, hold');
await press('RELOAD', 1000); await press('MENU2', 1000); await press('MENU3', 300); await hold(6000);
await delay(1500);
mark('D: hold, switch to the Colt while held'); held |= BUTTON.FIRE; await delay(400);
await press('MENU2', 3000); held &= ~BUTTON.FIRE; await delay(1500);
mark('E: Colt taps 100 ms apart'); for (let i = 0; i < 10; i++) await press('FIRE', 100);
await delay(1500);
mark('F: back to the BAR while held'); held |= BUTTON.FIRE; await press('MENU3', 3000); held &= ~BUTTON.FIRE;
}
await delay(1000);
await finish(0);
