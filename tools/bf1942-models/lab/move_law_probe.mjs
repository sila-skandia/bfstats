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
const me = { pos: null, rot: null };
s.on('control-state', (c) => {
  ctrl++;
  if (c.ok && c.cls === 'BFSoldierNetworkable') { me.pos = c.body?.pos ?? me.pos; me.rot = c.body?.rot ?? me.rot; }
  log('cs', { ok: c.ok, tick: c.tick, seq: c.seq, serial: c.controlId ?? null, cls: c.cls,
    pos: c.body?.pos ?? null, rot: c.body?.rot ?? null, vel: c.body?.vel ?? null,
    aimA: c.body?.aimA ?? null, aimB: c.body?.aimB ?? null, mask: c.body?.mask ?? null,
    lower: c.body?.lower ?? null, upper: c.body?.upper ?? null });
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
  // SG=4,5: the spawn groups to try (default 1-3, vanilla Wake's).
  const groups = (process.env.SG ?? '1,2,3').split(',').map(Number);
  await spawnSequence(s, { team: TEAM, kit: KIT, spawnGroup: groups[tries % groups.length] });
  for (let k = 0; k < 30 && !spawned; k++) await delay(100);
}
if (!spawned) { log('noSpawn'); console.log('no spawn'); process.exit(1); }
log('spawned', { kit: KIT, crouch: CROUCH });
await delay(2500);

// HEADINGS='x,z:deg;...' (wire frame, atan2(dx, dz)): turn to the heading
// listed for the spawn point nearest where he stands, the look axis at 3
// degrees a unit-word (lab/look_law_check.py), before the plan, so each spawn
// point's run goes where its ground is open.
if (process.env.HEADINGS && me.pos && me.rot) {
  const rows = process.env.HEADINGS.split(';').map((r) => { const [xz, d] = r.split(':'); const [x, z] = xz.split(',').map(Number); return { x, z, d: Number(d) }; });
  rows.sort((a, b) => Math.hypot(a.x - me.pos[0], a.z - me.pos[2]) - Math.hypot(b.x - me.pos[0], b.z - me.pos[2]));
  const [x, y, z, w] = me.rot;
  const now = Math.atan2(2 * (x * z + y * w), 1 - 2 * (x * x + y * y)) * 180 / Math.PI;
  let delta = rows[0].d - now;
  delta -= Math.round(delta / 360) * 360;
  const words = Math.round(Math.abs(delta) / 3);
  log('turn', { from: now, to: rows[0].d, words });
  for (let i = 0; i < words; i++) {
    sender.enqueue(actionFor({ lookX: Math.sign(delta) }));
    await delay(1000 / 30);
  }
  await delay(1500);
}

// The script, in ticks: [ticks, {forward, lookX}]
// PLAN='[[ticks, {st}, "lie:15"], ...]' replaces the plan below; a third
// element presses lie or jump ("jump:3") on that word of the phase ("lie" is
// word 15).
const plan = process.env.PLAN ? JSON.parse(process.env.PLAN) : [
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
const pressAt = (press, key) => {
  if (!press) return -1;
  const [k, at] = String(press).split(':');
  return k === key ? (at === undefined ? 15 : Number(at)) : -1;
};
let phase = 0;
const t0 = performance.now();
let n = 0;
for (const [ticks, st, press] of plan) {
  log('phase', { phase, ticks, st });
  for (let i = 0; i < ticks; i++) {
    const due = t0 + n * (1000 / 30);
    let w = due - performance.now();
    if (w > 1) await delay(w);
    const pressed = pressAt(press, 'lie') === i ? 'lie' : pressAt(press, 'jump') === i ? 'jump' : undefined;
    log('word', { n, phase, serial: sender.serial, st, ...(pressed ? { press: pressed } : {}) });
    sender.enqueue(actionFor({ forward: !!st.forward, back: !!st.back, walk: !!st.walk, crouch: CROUCH || !!st.crouch,
      lie: pressAt(press, 'lie') === i, action: pressAt(press, 'jump') === i, lookX: st.lookX ?? 0, ...(st.strafe ? { right: true } : {}) }));
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
