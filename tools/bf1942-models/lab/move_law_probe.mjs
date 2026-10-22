// The on-foot MOVE law, measured on a real server (a copy of look_law_probe.mjs
// with a movement plan; same log format, read it with move_law_check.py).
// The on-foot look law's probe was the model: a sidecar soldier sends
// known look and move words at an even 30 Hz and logs the server's control
// state for every ghost block (tick, acked serial, body rotation, twist and
// aim registers, position, velocity). `look_law_check.py` replays the words
// through the engine's yaw lines and through the page's law and diffs both
// against the server at each acknowledged serial.
//
//   node lab/look_law_probe.mjs 127.0.0.1:14568 probe.ndjson
//   python3 lab/look_law_check.py probe.ndjson
//
// Spawns on team 2's first land groups (vanilla Wake). The plan pans
// standing (inside the twist clamp and past it), presses and releases
// forward and strafe mid-pan, and sends a sub-quantum hand.
import fs from 'node:fs';
import { Session } from '../sidecar/session.mjs';
import { InputSender, spawnSequence, actionFor } from '../sidecar/input.mjs';

const [target, outPath] = process.argv.slice(2);
const [host, portStr] = target.split(':');
const out = fs.createWriteStream(outPath);
const T0 = Date.now();
const log = (kind, rec = {}) => out.write(JSON.stringify({ kind, ms: Date.now() - T0, ...rec }) + '\n');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const NAME = process.env.NAME ?? `look${Date.now() % 10000}`;
const TEAM = 2;
// KIT: the kit index SpawnRequest asks for; CROUCH=1 holds crouch on every word.
const KIT = Number(process.env.KIT ?? 0);
const CROUCH = process.env.CROUCH === '1';

const s = new Session(host, Number(portStr), { name: NAME, team: TEAM });
let spawned = false;
let ctrl = 0;
s.on('control-state', (c) => {
  ctrl++;
  log('cs', { ok: c.ok, tick: c.tick, seq: c.seq, serial: c.controlId ?? null, cls: c.cls,
    pos: c.body?.pos ?? null, rot: c.body?.rot ?? null, vel: c.body?.vel ?? null,
    aimA: c.body?.aimA ?? null, aimB: c.body?.aimB ?? null, mask: c.body?.mask ?? null });
});
s.on('event', (ev) => {
  if ((ev.type === 'SetVehicle' || ev.type === 'SetDefaultVehicle') && ev.playerId === s.me.playerId && ev.netId) spawned = true;
});
const joined = new Promise((r) => s.once('joined', r));
await s.start();
log('joined', await joined);
const sender = new InputSender(s, { idle: 'zero' });
sender.on('sent', (e) => { if (!e.idle) log('sent', { serial: e.serial, axes: e.action.axes, buttons: e.action.buttons }); });
sender.start();

for (let tries = 0; !spawned && tries < 40; tries++) {
  await spawnSequence(s, { team: TEAM, kit: KIT, spawnGroup: 1 + (tries % 3) });
  for (let k = 0; k < 30 && !spawned; k++) await delay(100);
}
if (!spawned) { log('noSpawn'); console.log('no spawn'); process.exit(1); }
log('spawned', { kit: KIT, crouch: CROUCH });
await delay(2500);

// The script, in ticks: [ticks, {forward, lookX}]
const plan = [
  [45, {}],
  [60, { forward: true }],          // the ramp up and the steady run
  [45, {}],                         // the ramp down
  [3,  { forward: true }],          // a tap
  [45, {}],
  [45, { strafe: 1 }],              // strafe right
  [45, {}],
  [45, { back: true }],             // backwards
  [45, {}],
  [45, { forward: true, walk: true }], // the slow gait
  [45, {}],
  [30, { crouch: true }],
  [45, { forward: true, crouch: true }],
  [45, { crouch: true }],
  [45, {}],
  [30, { forward: true }, 'lie'],   // run, then a lie press mid-run (the dive)
  [60, {}],
];
let phase = 0;
const t0 = performance.now();
let n = 0;
for (const [ticks, st, press] of plan) {
  log('phase', { phase, ticks, st });
  for (let i = 0; i < ticks; i++) {
    const due = t0 + n * (1000 / 30);
    let w = due - performance.now();
    if (w > 1) await delay(w);
    log('word', { n, phase, serial: sender.serial, st });
    sender.enqueue(actionFor({ forward: !!st.forward, back: !!st.back, walk: !!st.walk, crouch: CROUCH || !!st.crouch,
      lie: press === 'lie' && i === 15, lookX: st.lookX ?? 0, ...(st.strafe ? { right: true } : {}) }));
    n++;
  }
  phase++;
}
await delay(1500);
sender.stop();
log('done', { ctrl, stats: sender.stats });
s.leave();
await delay(300);
out.end();
setTimeout(() => process.exit(0), 300);
