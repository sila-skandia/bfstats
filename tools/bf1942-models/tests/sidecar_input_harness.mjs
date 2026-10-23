// The sidecar's input layer under node: the page's level-speaking word turned
// into the retail record (PageButtonEdges), and the page's words reaching the
// server one for one (InputSender.enqueue). See test_sidecar_input.py.
import { InputSender, PageButtonEdges, BUTTON, AXIS, AXIS_CENTRE, encodeAxis } from '../sidecar/input.mjs';

const results = {};
const e = new PageButtonEdges();
const L = BUTTON.LIE, A = BUTTON.ACTION, F = BUTTON.FIRE, C = BUTTON.CROUCH, R = BUTTON.RELOAD;
// The page lies down (its prone state goes true and stays), holds fire and
// crouch, holds jump, and taps reload twice.
const levels = [L | F, L | F | A, L | F | A, L | A | R, L | R, 0, 0, R];
results.edges = levels.map((x) => {
  const b = e.apply(x);
  return { lie: !!(b & L), jump: !!(b & A), fire: !!(b & F), reload: !!(b & R), crouch: !!(b & C) };
});

// One record per page word, in order, each with its own serial and tag; an
// idle repeat carries no look delta and no one-shot press.
const sent = [];
const datagrams = [];
const session = { joined: true, conn: { state: 'connected', sendData: (payload, meta) => { datagrams.push(meta.input); return datagrams.length; } } };
const s = new InputSender(session, { rate: 30, idle: 'hold', mergeAbove: Infinity });
s.on('sent', (x) => sent.push({ serial: x.serial, tag: x.tag, lookX: x.action.axes[AXIS.MOUSELOOK_X], buttons: x.action.buttons, idle: x.idle }));
const look = encodeAxis(3);
// A slow frame's five words made at once: the first leaves at once, the rest
// wait and leave one a sender slot (one new word per server tick, D-2/D-3).
for (let i = 1; i <= 5; i++) s.enqueue({ axes: [AXIS_CENTRE, AXIS_CENTRE, AXIS_CENTRE, AXIS_CENTRE, look, AXIS_CENTRE], buttons: F | (i === 1 ? L : 0) }, 100 + i);
results.atOnce = sent.length;
let slot = s._releasedAt;
results.perSlot = [];
for (let k = 0; k < 6; k++) {
  slot += s.periodMs;
  const n = sent.length;
  s._tick(slot);
  results.perSlot.push(sent.length - n);
}
// Two slots fired back to back (a late timer's catch-up) each release one.
for (let i = 6; i <= 7; i++) s.enqueue({ axes: [AXIS_CENTRE, AXIS_CENTRE, AXIS_CENTRE, AXIS_CENTRE, look, AXIS_CENTRE], buttons: F }, 100 + i);
results.catchUp = [];
for (let k = 0; k < 2; k++) { slot += s.periodMs; const n = sent.length; s._tick(slot); results.catchUp.push(sent.length - n); }
// The page still active, its words all out: its slots are not filled.
const before = sent.length;
s._tick(slot + s.periodMs); s._tick(slot + 2 * s.periodMs);
results.freshTicksSent = sent.length - before;
// The page gone quiet: the idle records take the cadence back.
s._lastInputAt = 0;
s._tick(); s._tick(); s._tick();
// The law before 2026-10-24 ('slot'), for its A/B: one at once, then one a slot.
{
  const legacy = new InputSender(session, { rate: 30, idle: 'hold', pace: 'slot', mergeAbove: Infinity });
  const out = [];
  legacy.on('sent', (x) => out.push(x.serial));
  for (let i = 1; i <= 5; i++) legacy.enqueue({ axes: [AXIS_CENTRE, AXIS_CENTRE, AXIS_CENTRE, AXIS_CENTRE, look, AXIS_CENTRE], buttons: F }, 200 + i);
  const atOnce = out.length;
  let t = legacy._releasedAt;
  const perSlot = [];
  for (let k = 0; k < 6; k++) { t += legacy.periodMs; const n = out.length; legacy._tick(t); perSlot.push(out.length - n); }
  results.slotLaw = { atOnce, perSlot };
}

// The input path at an ack (atAck), on a clock the test holds: records the
// server holds unrun, its starved ticks and the acked word's wait.
{
  let clock = 1000;
  const sess = { joined: true, conn: { state: 'connected', sendData: () => 1 } };
  const p = new InputSender(sess, { rate: 30, idle: 'hold', clock: () => clock, firstSerial: 10 });
  const word = () => p.enqueue({ axes: [AXIS_CENTRE, AXIS_CENTRE, AXIS_CENTRE, AXIS_CENTRE, AXIS_CENTRE, AXIS_CENTRE], buttons: 0 }, 1);
  // Serial 10 at t=1000, 11 at 1033 (each released at once: the bucket is full).
  word(); p._tokens = 2; clock = 1033; word(); p._tokens = 2;
  clock = 1050;
  const first = p.atAck(10, 100);           // ran 10 at tick 100; 11 waits
  clock = 1060; word(); p._tokens = 2;      // serial 12, released 1 ms before the block
  clock = 1061;
  const second = p.atAck(11, 103);          // 3 ticks, one record run (11): 2 starved
  clock = 1100;
  const third = p.atAck(12, 104);
  results.path = { first, second, third, totals: p.path };
}

// A hitch's backlog merged: the look deltas summed, a one-shot pressed once,
// two prone toggles cancelling, the newest held state, the newest serial and
// tag, and nothing sent twice or lost.
{
  const sess = { joined: false, conn: { state: 'connected', sendData: () => 1 } };   // not joined: everything queues
  const m = new InputSender(sess, { rate: 30, idle: 'hold', firstSerial: 50 });
  const lookOf = (v) => encodeAxis(v);
  const merged = [];
  m.on('merged', (e) => merged.push(e));
  const W = (lx, buttons, tag) => m.enqueue({ axes: [AXIS_CENTRE, AXIS_CENTRE, AXIS_CENTRE, encodeAxis(1), lookOf(lx), AXIS_CENTRE], buttons }, tag);
  W(1, R | L, 301);      // a reload press and a prone toggle
  W(2, L, 302);          // the prone toggle back
  W(-0.5, C, 303);       // crouch held
  W(0.25, 0, 304);       // the newest: crouch released
  const q = m.pending.map((w) => ({ serial: w.serial, tag: w.tag, lookX: w.action.axes[AXIS.MOUSELOOK_X], buttons: w.action.buttons, merged: w.merged ?? 1 }));
  results.merge = { q, merged, centre: AXIS_CENTRE, sum: lookOf(1) + lookOf(2) + lookOf(-0.5) - 3 * AXIS_CENTRE, newestLook: lookOf(0.25), R, L, C, total: m.path.merged };
}

results.sent = sent;
results.datagramFirstSerials = datagrams;
results.look = look;
results.centre = AXIS_CENTRE;
console.log(JSON.stringify(results));
