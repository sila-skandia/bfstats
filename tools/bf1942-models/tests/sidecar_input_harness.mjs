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
const s = new InputSender(session, { rate: 30, idle: 'hold' });
s.on('sent', (x) => sent.push({ serial: x.serial, tag: x.tag, lookX: x.action.axes[AXIS.MOUSELOOK_X], buttons: x.action.buttons, idle: x.idle }));
const look = encodeAxis(3);
for (let i = 1; i <= 5; i++) s.enqueue({ axes: [AXIS_CENTRE, AXIS_CENTRE, AXIS_CENTRE, AXIS_CENTRE, look, AXIS_CENTRE], buttons: F | (i === 1 ? L : 0) }, 100 + i);
// The page still active: its slots are not filled.
const before = sent.length;
s._tick(); s._tick();
results.freshTicksSent = sent.length - before;
// The page gone quiet: the idle records take the cadence back.
s._lastInputAt = 0;
s._tick(); s._tick(); s._tick();
results.sent = sent;
results.datagramFirstSerials = datagrams;
results.look = look;
results.centre = AXIS_CENTRE;
console.log(JSON.stringify(results));
