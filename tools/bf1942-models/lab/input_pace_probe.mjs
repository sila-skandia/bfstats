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
// PACE_REV (a git revision to take viewer/input-pace.js from, for an A/B
// against an older law; one without `feedFrame` runs the page's clock as it
// was before 2026-10-25), SIDECAR_PACE (server | bucket | slot: InputSender
// `pace`), FPS (60), JITTER (ms, 4), GAPS (60-180 ms frames a second, 0),
// STALL_MS (0), STALL_EVERY (ms, 4000), DUR (s, 60), NAME, SIDECAR_LAG_MS
// (netconn.mjs: an internet round trip on localhost), MERGE (InputSender `mergeAbove`; 3 was the law
// before 2026-10-25).
//
// Each server tick that ran no page word is in `acks[].st`; with the word
// log (`rec.sent`, `rec.words`) `input_pace_check.py` puts each down to the
// page's word coming late or the sender holding it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { Session } from '../sidecar/session.mjs';
import { InputSender, spawnSequence, actionFor } from '../sidecar/input.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// The page's modules, loaded as they are (they import nothing).
const PACE_REV = process.env.PACE_REV || '';
const paceSrc = PACE_REV
  ? execFileSync('git', ['-C', HERE, 'show', `${PACE_REV}:tools/bf1942-models/viewer/input-pace.js`], { encoding: 'utf8' })
  : fs.readFileSync(path.join(HERE, '../viewer/input-pace.js'), 'utf8');
const { createInputPacer, feedFrame } = await import('data:text/javascript,' + encodeURIComponent(paceSrc));
const { FixedStep } = await import('data:text/javascript,' + encodeURIComponent(fs.readFileSync(path.join(HERE, '../viewer/fixed-step.js'), 'utf8')));

const [target = '127.0.0.1:14568', outPath = 'pace.json'] = process.argv.slice(2);
const [host, portStr] = target.split(':');
const env = (k, d) => (process.env[k] != null && process.env[k] !== '' ? process.env[k] : d);
const PACE = env('PACE', 'lead');
const SIDECAR_PACE = env('SIDECAR_PACE', 'server');
const GAPS = Number(env('GAPS', 0));
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
const sender = new InputSender(s, { idle: 'zero', pace: SIDECAR_PACE,
  mergeAbove: SIDECAR_PACE === 'slot' ? Infinity : (process.env.MERGE ? Number(process.env.MERGE) : undefined) });
s.on('pong', (rtt) => sender.noteRtt(rtt));
sender.start();
for (let tries = 0; !spawned && tries < 40; tries++) {
  await spawnSequence(s, { team: 2, kit: 1, spawnGroup: 1 + (tries % 3) });
  for (let k = 0; k < 30 && !spawned; k++) await delay(100);
}
if (!spawned) { console.log('no spawn'); process.exit(1); }
await delay(1500);

const rec = { acks: [], words: [], sent: [], merges: [], presses: [], stalls: [], frames: 0, frameMs: [],
              mode: { PACE, PACE_REV, SIDECAR_PACE, FPS, JITTER, GAPS, STALL_MS, STALL_EVERY } };
const pacer = createInputPacer();
sender.on('sent', (e) => { if (!e.idle) rec.sent.push({ serial: e.serial, at: now() }); else rec.sent.push({ serial: e.serial, at: now(), idle: true }); });
sender.on('merged', (e) => rec.merges.push({ serial: e.serial, words: e.words, at: now() }));
const rows = [];
let n = 0;
s.on('control-state', (c) => {
  if (c.controlId == null || sender.session !== s) return;
  const a = sender.atAck(c.controlId, c.tick ?? null);
  const row = { n: ++n, at: now(), tick: c.tick ?? null, serial: c.controlId, seq: c.controlId, iq: a.iq, sq: a.sq, st: a.starved, ld: a.lead, tr: a.trimmed };
  rows.push(row);
  if (rows.length > 64) rows.shift();
  rec.acks.push(row);
});

// The page: frames at FPS, map.html's 0.1 s clamp, the world's 1/30 s clock
// at timeScale (with the pacer's feed, world.js `inputFeed`), one word a
// tick, each noted with how late its frame made it (net-room.js).
let acc = 0, scale = 1, last = now(), pressAt = null, frameEma = 100, feed = null;
const clock = new FixedStep({ rate: 30 });
const HITCH_DROP = PACE === 'lead';
const NEW_LAW = typeof feedFrame === 'function';
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
  const wallMs = f - last;
  const dt = Math.min(wallMs, 100);
  last = f;
  rec.frames++;
  rec.frameMs.push(+wallMs.toFixed(1));
  if (f >= nextPress) { pressAt = f; rec.presses.push({ at: f }); nextPress = f + 250 + Math.random() * 500; }
  let ticks, hitch = false;
  if (NEW_LAW) {
    const fd = PACE === 'lead' ? feedFrame(dt / 1000, feed) : { fed: dt / 1000, hitch: false };
    hitch = fd.hitch;
    ticks = clock.advance(fd.fed * scale);
  } else {
    acc += dt * scale;
    // The law before 2026-10-25: a 0.1 s frame on a page whose frames are
    // otherwise short runs one tick and drops the rest.
    if (dt < 100) frameEma += (dt - frameEma) * 0.05;
    if (HITCH_DROP && dt >= 100 && frameEma < 50 && acc >= 2 * P) acc = P + (acc % P);
    ticks = 0;
    while (acc >= P) { acc -= P; ticks++; }
  }
  for (let i = 0; i < ticks; i++) {
    walk++;
    const serial = sender.serial;
    // Walk a little, so the soldier moves; the press rides the next word.
    sender.enqueue(actionFor({ forward: (walk >> 6) % 2 === 0 }), serial);
    if (NEW_LAW) pacer.noteWord(serial, (clock.accumulator + (ticks - 1 - i) * clock.dt) * 1000);
    rec.words.push({ at: f, serial, press: pressAt });
    pressAt = null;
  }
  if (PACE === 'lead') {
    scale = pacer.update({ rows, now: f, frameMs: dt, wallMs, hitch });
    if (NEW_LAW) feed = pacer.feed();
  }
  else if (PACE === 'queue') { const q = sender.pending.length; if (q >= 2) scale = 0.97; else if (q === 0) scale = 1; }
  else scale = 1;
  let period = 1000 / FPS + Math.random() * JITTER;
  if (GAPS && Math.random() < (GAPS * period) / 1000) period = 60 + Math.random() * 120;
  // Spin the last few ms: a timer alone overshoots by a millisecond or more.
  const until = f + period;
  if (until - now() > 3) await delay(until - now() - 2);
  while (now() < until) { /* the frame's own work */ }
}
rec.path = sender.path;
rec.pace = pacer.state();
sender.stop();
s.leave();
fs.writeFileSync(outPath, JSON.stringify(rec));
console.log('wrote', outPath, 'words', rec.words.length, 'acks', rec.acks.length, 'frames', rec.frames);
await delay(300);
process.exit(0);
