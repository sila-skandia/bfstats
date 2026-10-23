// The input path's pacing on a real server, without a browser: a node "page"
// with the page's own clock (a fixed 1/30 s world tick off a frame loop,
// each frame clamped to 0.1 s as map.html does, the rate scaled by the
// pacer) makes one word per world tick and hands it to the sidecar's own
// InputSender, which joins the lab as a player. Per ack it reads the input
// path (`InputSender.atAck`: iq, sq, starved, the acked word's wait) and
// feeds the page's pacer (`viewer/input-pace.js`). Presses at random times
// are timed to the tick that runs the first word made after them.
//
// It isolates the pacing laws from a headless renderer's own frame gaps
// (28 fps with 60-180 ms gaps on this laptop): the frame loop runs at FPS
// with JITTER ms of random lateness, and STALL_MS of no frames every
// STALL_EVERY ms stands in for a busy main thread (the sender, like the
// real sidecar, keeps running through it).
//
//   node lab/input_pace_probe.mjs 127.0.0.1:14568 out.json
//   python3 lab/input_pace_check.py out.json
//
// Env: PACE (lead | queue | off: the page's law, net-room.js paceToServer),
// SIDECAR_PACE (bucket | slot: InputSender `pace`), FPS (60), JITTER (ms, 4),
// STALL_MS (0), STALL_EVERY (ms, 4000), DUR (s, 60), NAME.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Session } from '../sidecar/session.mjs';
import { InputSender, spawnSequence, actionFor } from '../sidecar/input.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// The page's module, loaded as it is (it imports nothing).
const paceSrc = fs.readFileSync(path.join(HERE, '../viewer/input-pace.js'), 'utf8');
const { createInputPacer } = await import('data:text/javascript,' + encodeURIComponent(paceSrc));

const [target = '127.0.0.1:14568', outPath = 'pace.json'] = process.argv.slice(2);
const [host, portStr] = target.split(':');
const env = (k, d) => (process.env[k] != null && process.env[k] !== '' ? process.env[k] : d);
const PACE = env('PACE', 'lead');
const SIDECAR_PACE = env('SIDECAR_PACE', 'bucket');
const FPS = Number(env('FPS', 60));
const JITTER = Number(env('JITTER', 4));
const STALL_MS = Number(env('STALL_MS', 0));
const STALL_EVERY = Number(env('STALL_EVERY', 4000));
const DUR = Number(env('DUR', 60));
const NAME = env('NAME', `pace${Date.now() % 10000}`);
const P = 1000 / 30;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => performance.now();

const s = new Session(host, Number(portStr), { name: NAME, team: 2 });
let spawned = false;
s.on('event', (ev) => {
  if ((ev.type === 'SetVehicle' || ev.type === 'SetDefaultVehicle') && ev.playerId === s.me.playerId && ev.netId) spawned = true;
});
const joined = new Promise((r) => s.once('joined', r));
await s.start();
await joined;
const sender = new InputSender(s, { idle: 'zero', pace: SIDECAR_PACE, mergeAbove: SIDECAR_PACE === 'slot' ? Infinity : undefined });
sender.start();
for (let tries = 0; !spawned && tries < 40; tries++) {
  await spawnSequence(s, { team: 2, kit: 1, spawnGroup: 1 + (tries % 3) });
  for (let k = 0; k < 30 && !spawned; k++) await delay(100);
}
if (!spawned) { console.log('no spawn'); process.exit(1); }
await delay(1500);

const rec = { acks: [], words: [], sent: [], presses: [], stalls: [], frames: 0, mode: { PACE, SIDECAR_PACE, FPS, JITTER, STALL_MS, STALL_EVERY } };
const pacer = createInputPacer();
sender.on('sent', (e) => { if (!e.idle) rec.sent.push({ serial: e.serial, at: now() }); });
const rows = [];
let n = 0;
s.on('control-state', (c) => {
  if (c.controlId == null || sender.session !== s) return;
  const a = sender.atAck(c.controlId, c.tick ?? null);
  const row = { n: ++n, at: now(), tick: c.tick ?? null, serial: c.controlId, iq: a.iq, sq: a.sq, st: a.starved, ld: a.lead, tr: a.trimmed };
  rows.push(row);
  if (rows.length > 64) rows.shift();
  rec.acks.push(row);
});

// The page: frames at FPS, a 1/30 s accumulator at timeScale, one word a tick.
let acc = 0, scale = 1, last = now(), pressAt = null, frameEma = 100;
const HITCH_DROP = PACE === 'lead';
const t0 = now();
let nextStall = STALL_MS > 0 ? t0 + STALL_EVERY : Infinity;
let nextPress = t0 + 200 + Math.random() * 400;
let walk = 0;
while (now() - t0 < DUR * 1000) {
  const t = now();
  if (t >= nextStall) {
    rec.stalls.push({ at: t, ms: STALL_MS });
    await delay(STALL_MS);
    nextStall += STALL_EVERY;
  }
  const f = now();
  const dt = Math.min(f - last, 100);
  last = f;
  rec.frames++;
  if (f >= nextPress) { pressAt = f; rec.presses.push({ at: f }); nextPress = f + 250 + Math.random() * 500; }
  acc += dt * scale;
  // net-room.js `HITCH_CATCH_UP`: a 0.1 s frame on a page whose frames are
  // otherwise short runs one tick and drops the rest (world.js hitchCatchUp).
  if (dt < 100) frameEma += (dt - frameEma) * 0.05;
  if (HITCH_DROP && dt >= 100 && frameEma < 50 && acc >= 2 * P) acc = P + (acc % P);
  while (acc >= P) {
    acc -= P;
    walk++;
    const serial = sender.serial;
    // Walk a little, so the soldier moves; the press rides the next word.
    sender.enqueue(actionFor({ forward: (walk >> 6) % 2 === 0 }));
    rec.words.push({ at: f, serial, press: pressAt });
    pressAt = null;
  }
  if (PACE === 'lead') scale = pacer.update({ rows, now: f, frameMs: dt });
  else if (PACE === 'queue') { const q = sender.pending.length; if (q >= 2) scale = 0.97; else if (q === 0) scale = 1; }
  else scale = 1;
  const period = 1000 / FPS;
  await delay(Math.max(0, period - (now() - f)) + Math.random() * JITTER);
}
rec.path = sender.path;
rec.pace = pacer.state();
sender.stop();
s.leave();
fs.writeFileSync(outPath, JSON.stringify(rec));
console.log('wrote', outPath, 'words', rec.words.length, 'acks', rec.acks.length, 'frames', rec.frames);
await delay(300);
process.exit(0);
