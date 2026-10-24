// The on-foot JUMP law, measured on a real server (move_law_probe.mjs with a
// jump plan; same log format, read it with jump_law_check.py).
//
// A sidecar soldier sends known words at an even 30 Hz and logs the server's
// control state for every ghost block (acked serial, position post-resolve,
// velocity pre-resolve, rotation, the state mask). Each phase presses
// c_PIAction (the jump, AI-2) on chosen words of the phase: a single word,
// held, every other word, at a run, a walk, a strafe, backing, crouched, and
// re-pressed at a range of delays after a landing, so the check can say which
// tick a press starts the jump on, what refuses one and when the next may go.
//
//   node lab/jump_law_probe.mjs 127.0.0.1:14688 probe.ndjson
//   python3 lab/jump_law_check.py probe.ndjson
//
// Spawns on team 2's first land groups (vanilla Wake), like the move probe.
import fs from 'node:fs';
import { Session } from '../sidecar/session.mjs';
import { InputSender, spawnSequence, actionFor } from '../sidecar/input.mjs';

const [target, outPath] = process.argv.slice(2);
const [host, portStr] = target.split(':');
const out = fs.createWriteStream(outPath);
const T0 = Date.now();
const log = (kind, rec = {}) => out.write(JSON.stringify({ kind, ms: Date.now() - T0, ...rec }) + '\n');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const NAME = process.env.NAME ?? `jump${Date.now() % 10000}`;
const TEAM = 2;
const KIT = Number(process.env.KIT ?? 0);
// GROUP: the spawn group asked for every try (Wake team 2: 1 is the open
// ground the move probe ran on; 3 stands under a roof that stops a jump).
const GROUP = Number(process.env.GROUP ?? 1);

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
  await spawnSequence(s, { team: TEAM, kit: KIT, spawnGroup: GROUP });
  for (let k = 0; k < 30 && !spawned; k++) await delay(100);
}
if (!spawned) { log('noSpawn'); console.log('no spawn'); process.exit(1); }
log('spawned', { kit: KIT });
await delay(2500);

// [name, ticks, held state, jump(i) -> bool]
const at = (...ks) => (i) => ks.includes(i);
const every = (n, from = 0, to = Infinity) => (i) => i >= from && i < to && (i - from) % n === 0;
const plan = [
  ['idle', 45, {}, () => false],
  ['stand1', 45, {}, at(0)],                       // one press, standing
  ['stand2', 45, {}, at(0)],                       // again, for repeatability
  ['held', 75, {}, (i) => i < 60],                 // held 60 words: a re-jump on landing?
  ['idle2', 30, {}, () => false],
  ['alt', 90, {}, (i) => i % 2 === 0],             // every other word for 3 s
  ['idle3', 30, {}, () => false],
  // a press, then one press N ticks later: the earliest re-jump after a landing
  ...[20, 22, 23, 24, 25, 26, 27, 28, 30].map((n) => [`re${n}`, n + 40, {}, at(0, n)]),
  ['run', 90, { forward: true }, at(30, 70)],      // at a full run
  ['runStop', 45, {}, () => false],
  ['walk', 75, { forward: true, walk: true }, at(30)],
  ['walkStop', 45, {}, () => false],
  ['strafe', 75, { strafe: 1 }, at(30)],
  ['strafeStop', 45, {}, () => false],
  ['back', 75, { back: true }, at(30)],
  ['backStop', 45, {}, () => false],
  ['crouch', 60, { crouch: true }, at(30)],        // crouched: refused?
  ['crouchUp', 45, {}, at(0, 1, 2, 3, 4, 5, 6, 7)], // the press as crouch is let go
  ['idle4', 45, {}, () => false],
  ['runHeld', 120, { forward: true }, (i) => i >= 30 && i < 100], // bunny hop at a run
  ['runHeldStop', 45, {}, () => false],
  // PLAN=2: which lower-body jump state each gait enters (its clip is the lock)
];
const plan2 = [
  ['idle', 45, {}, () => false],
  ['standHeld', 75, {}, (i) => i < 60],                          // Lb_StandJump
  ['idle2', 45, {}, () => false],
  ['backHeld', 105, { back: true }, (i) => i >= 20 && i < 95],   // Lb_RunJumpBackward
  ['backStop', 45, {}, () => false],
  ['strafeHeld', 105, { strafe: 1 }, (i) => i >= 20 && i < 95],  // Lb_RunJump
  ['strafeStop', 45, {}, () => false],
  ['walkHeld', 105, { forward: true, walk: true }, (i) => i >= 20 && i < 95], // Lb_StandJump
  ['walkStop', 45, {}, () => false],
  ['goHeld', 90, { forward: true }, (i) => i < 75],              // forward and jump on one word
  ['goStop', 45, {}, () => false],
  ['turnHeld', 90, { lookX: 0.05 }, (i) => i >= 10 && i < 85],   // Lb_TurnLeft/Right
  ['turnStop', 45, {}, () => false],
  ['backHeld2', 105, { back: true }, (i) => i >= 20 && i < 95],
  ['end', 60, {}, () => false],
];
const t0 = performance.now();
let n = 0;
for (const [phase, ticks, st, jump] of (process.env.PLAN === '2' ? plan2 : plan)) {
  log('phase', { phase, ticks, st });
  for (let i = 0; i < ticks; i++) {
    const due = t0 + n * (1000 / 30);
    const w = due - performance.now();
    if (w > 1) await delay(w);
    const j = !!jump(i);
    log('word', { n, phase, i, serial: sender.serial, st: { ...st, ...(j ? { jump: true } : {}) } });
    sender.enqueue(actionFor({ forward: !!st.forward, back: !!st.back, walk: !!st.walk, crouch: !!st.crouch,
      action: j, lookX: st.lookX ?? 0, ...(st.strafe ? { right: true } : {}) }));
    n++;
  }
}
await delay(1500);
sender.stop();
log('done', { ctrl, stats: sender.stats });
s.leave();
await delay(300);
out.end();
setTimeout(() => process.exit(0), 300);
