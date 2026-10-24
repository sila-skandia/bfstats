// The outbound half of playing: choose a team, a kit and a spawn point, then
// send PlayerAction records at the tick rate. This is roadmap phase E — what
// turns the sidecar from an observer into a client.
//
// Everything here is read from bf1942_lnxded.static (1.61 Linux dedicated
// server, the binary the lab runs); the addresses are the proof and the
// write-up is features/udp-sidecar/decodes/input.md.
//
//   PlayerActionManager::transmit       0x08148190  the input block (4-bit
//                                                   count, signed 32-bit first
//                                                   serial, then the records)
//   PlayerAction::writeToStream         0x08148750  six 12-bit axes, u32 buttons
//   PlayerAction::readFromStream        0x081486f0  the reader (the law)
//   PlayerAction::set                   0x081128a0  PlayerInput -> PlayerAction
//                                                   (channel order, button map)
//   PlayerAction::get                   0x0815c5a0  PlayerAction -> PlayerInput
//                                                   (the decode law)
//   floatToFixed                        0x08113480  v/16 clamped +-1, 12 bits
//   PlayerActionManager::processReceivedPacket 0x081484e0  the server's reader
//   PlayerActionManager::processRcvdPlayerActions 0x08148470  the serial check
//   PlayerActionManager::add            0x08148120  caps the client's own
//                                                   buffer at 3 records
//   SetTeamEvent::deSerialize           0x0811e340  u8 team, u8 playerId
//   ChangeKitEvent::deSerialize         0x0811ed10  u8 kit
//   SpawnRequestEvent::deSerialize      0x0811cd20  u8 spawnGroup, u8 spawnPoint
//   GameServer::handleGameEventManagerEvent 0x08135cb0  where they are consumed
//   GameServer::changeKit               0x08158700  key = team*256 + kit
//
// The three null-deref rules (see decodes/input.md §6). The server binds a
// BFPlayer to a connection while it handles CreatePlayer; before that:
//   - SpawnRequest  (0x08136be7) dereferences getPlayer() with no null check,
//   - the input stream dereferences this->player at +0x144
//     (processRcvdPlayerActions 0x08148470),
// while SetTeam (0x08136d11) and ChangeKit (0x08137080) both bail on a null
// player. So nothing but the join may be sent before the session is joined.

import { BitWriter, BitReader, writeActionBlock } from './events.mjs';

// --- the input block ---------------------------------------------------------

export const STREAM_INPUT = 1 << 0;   // ClientConnection stream slot 0 (wire.md §2)
export const ACTION_BITS = 6 * 12 + 32;  // 104: six 12-bit axes then u32 buttons
export const MAX_ACTIONS_PER_PACKET = 3; // PlayerActionManager::add 0x08148120 caps at 3
// The page's words are paced at one a server tick (`InputSender.enqueue`): a
// word made with the queue empty leaves at once if the last one left at least
// this much of a tick ago, and a sender slot releases the next waiting word if
// at least this much has passed. [free, numerics: margins for timer jitter]
const PACE_IMMEDIATE = 0.75;
const PACE_SLOT = 0.5;
// The records `InputSender.atAck` looks back over (a few seconds of them), and
// how long before a block arrives a record must have left to count as read
// by the server before that block's tick. [free, numerics: localhost's
// datagram is well under a millisecond; the server's own frame takes a few]
const RELEASED_KEEP = 128;
const SQ_MARGIN_MS = 2;
// The round trips `noteRtt` keeps (the session pings every 2 s), the least of
// which is taken out of each ack's wait: on an internet server the wait from
// a word reaching this sender to the block that says it ran is the round trip
// plus the server's buffer, and only the buffer is the page's to steer on.
const RTT_KEEP = 8;
// The pacing's burst: page words that may leave at once above one a tick
// (`InputSender._mayRelease`). Two keep the server's buffer under D-2's four
// with a word standing, and let a frame that owed two ticks send both.
// [free, numerics]
const PACE_BURST = 2;
// A queue longer than this is merged (`_mergePending`). A slow frame owes at
// most three ticks (the page clamps a frame to 0.1 s), so only a run of
// hitches or a backgrounded tab gets here. [free, numerics]
const MERGE_ABOVE = 3;
export const SERIAL_MAX = 0x3fffffff;    // writeSigned(32) = sign bit + 31 magnitude bits
export const DEFAULT_SERIAL = 1;         // the server starts at lastSerial 0, so 1 is the first it keeps

// --- axes --------------------------------------------------------------------
// The record's six channels, in wire order (PlayerAction::writeToStream
// 0x08148750 writes the short at +0, +2, +4, +6, +8, +10 in that order; the
// names are PlayerAction::set 0x081128a0's channel mapping and the c_PI* rodata
// at 0x086c86a5). Channel i of the PlayerInput is action channel i.
export const AXIS = {
  YAW: 0, PITCH: 1, ROLL: 2, THROTTLE: 3, MOUSELOOK_X: 4, MOUSELOOK_Y: 5,
};
export const AXIS_NAMES = ['yaw', 'pitch', 'roll', 'throttle', 'mouseLookX', 'mouseLookY'];

export const AXIS_BITS = 12;
export const AXIS_MAX = 4095;        // (1 << 12) - 1
export const AXIS_SCALE = 16;        // floatToFixed's third argument (0x41800000 = 16.0f)
export const AXIS_CENTRE = 2048;     // encode(0)
export const AXIS_FULL = 2175;       // encode(+1) = round(4095 * (1/16 + 1) / 2)
export const AXIS_SATURATE = 16;     // a channel value's magnitude saturates here

// What the channels are, per the game's own control maps
// (Mods/bf1942/settings/default/controls/*.con in the lab install and the
// templates' setInputTo* bindings):
//
//   Yaw        A/D strafe (on foot), rudder/steering wheels (vehicles)
//   Pitch      elevator (air), boat/plane pitch trim
//   Roll       ailerons (air)
//   Throttle   W/S on foot (forward/back), engine power in a vehicle
//   MouseLookX mouse X: the aim/turret yaw
//   MouseLookY mouse Y: the aim/turret pitch
//
// A digital key press writes exactly 1.0 into its channel
// (Input::setInput 0x0815cfc0 stores (float)bool), and a joystick axis lives in
// [-1, 1]; the /16 in floatToFixed is headroom above 1.0, not the range of full
// deflection. So a full stick is 1.0 here, not 16.0. BFSoldier::handlePlayerInput
// 0x08273c70 shows what the sim does with them: Yaw and Throttle are reduced to
// their sign with a +-0.1 dead zone (`if (0.1 < throttle) 1.0 else if (< -0.1) -1.0`),
// so on foot the magnitude of the movement axes does not matter, only the sign;
// a vehicle's throttle and the mouse-look axes are the ones that use a magnitude.

// floatToFixed(v, 12, 16.0) — 0x08113480: v/16 clamped to +-1, then
// round((2^bits - 1) * (v/16 + 1) * 0.5). 0 -> 2048, +1 -> 2175, -1 -> 1920,
// +-16 saturates at 4095/0.
export function encodeAxis(channelValue) {
  const v = Math.max(-1, Math.min(1, Number(channelValue) / AXIS_SCALE));
  return Math.round(AXIS_MAX * (v + 1) * 0.5);
}

// PlayerAction::get 0x0815c5a0: ((2n/4095) - 1) * 16, rounded to 0.01.
export function decodeAxis(n) {
  return Math.round((((2 * n) / AXIS_MAX) - 1) * AXIS_SCALE * 100) / 100;
}

// --- buttons -----------------------------------------------------------------
// The 32-bit mask at record byte 12. Bit -> PlayerInput channel, from
// PlayerAction::set 0x081128a0 (which sets these bits) and PlayerAction::get
// 0x0815c5a0 (which reads them back with setInput(channel, maskBit)).
//
//   0 Fire (ch8)      1 Action (9)        2 Use (10)       3 MouseLook (11)
//   4 Walk (12)       5 Run (13)          6..14 MenuSelect1..9 (14..22)
//   15 AltFire (23)   16 Reload (24)      17 Drop (25)     18 ToggleCameraMode (26)
//   19 ToggleCamera (27) 20 Lie (28)      21 Crouch (29)   22..25 ch30..ch33
//
// Buttons are level-triggered: the mask bit means "the channel's value > 0.5",
// i.e. held, not pressed (W-1, netcode.md §1). ch48 (Communication) is not in
// the mask: it lives at byte 16, which writeToStream/readFromStream never cover
// (W-4), so it never crosses the wire and the receiver reconstructs it as 0.
export const BUTTON = {
  FIRE: 1 << 0, ACTION: 1 << 1, USE: 1 << 2, MOUSELOOK: 1 << 3, WALK: 1 << 4, RUN: 1 << 5,
  MENU1: 1 << 6, MENU2: 1 << 7, MENU3: 1 << 8, MENU4: 1 << 9, MENU5: 1 << 10,
  MENU6: 1 << 11, MENU7: 1 << 12, MENU8: 1 << 13, MENU9: 1 << 14,
  ALT_FIRE: 1 << 15, RELOAD: 1 << 16, DROP: 1 << 17, TOGGLE_CAMERA_MODE: 1 << 18,
  TOGGLE_CAMERA: 1 << 19, LIE: 1 << 20, CROUCH: 1 << 21,
  CH30: 1 << 22, CH31: 1 << 23, CH32: 1 << 24, CH33: 1 << 25,
};
export const BUTTON_CHANNEL = {
  FIRE: 8, ACTION: 9, USE: 10, MOUSELOOK: 11, WALK: 12, RUN: 13,
  MENU1: 14, MENU2: 15, MENU3: 16, MENU4: 17, MENU5: 18, MENU6: 19, MENU7: 20,
  MENU8: 21, MENU9: 22, ALT_FIRE: 23, RELOAD: 24, DROP: 25, TOGGLE_CAMERA_MODE: 26,
  TOGGLE_CAMERA: 27, LIE: 28, CROUCH: 29, CH30: 30, CH31: 31, CH32: 32, CH33: 33,
};
// "altFire" / "ALT_FIRE" / "alt_fire" all reach BUTTON.ALT_FIRE.
const CAMEL_TO_SNAKE = Object.fromEntries(Object.keys(BUTTON).map((k) => [k.replace(/_/g, ''), k]));

// A button mask from names: buttonMask('FIRE') / buttonMask(['FIRE','CROUCH']) /
// buttonMask('FIRE|CROUCH') / buttonMask({ fire: true }). Unknown names throw:
// a typo in a mask is a silent nothing in the game otherwise.
export function buttonMask(spec) {
  if (spec == null) return 0;
  if (typeof spec === 'number') return spec >>> 0;
  if (typeof spec === 'string') return buttonMask(spec.split(/[|,\s]+/).filter(Boolean));
  if (Array.isArray(spec)) {
    let m = 0;
    for (const s of spec) m |= typeof s === 'number' ? s : lookupButton(s);
    return m >>> 0;
  }
  if (typeof spec === 'object') {
    let m = 0;
    for (const [k, v] of Object.entries(spec)) if (v) m |= lookupButton(k);
    return m >>> 0;
  }
  throw new Error(`buttonMask: cannot read ${typeof spec}`);
}
function lookupButton(name) {
  const key = String(name).trim().toUpperCase().replace(/[^A-Z0-9]/g, '_');
  const bit = BUTTON[key] ?? BUTTON[CAMEL_TO_SNAKE[key.replace(/_/g, '')]];
  if (bit === undefined) throw new Error(`unknown button "${name}"`);
  return bit;
}

export const ZERO_ACTION = Object.freeze({ axes: Object.freeze([AXIS_CENTRE, AXIS_CENTRE, AXIS_CENTRE, AXIS_CENTRE, AXIS_CENTRE, AXIS_CENTRE]), buttons: 0 });

// Encode one PlayerAction: axes in channel units (see the table above), buttons
// as a mask or names. Returns { axes: [6 ints], buttons: u32 } — the shape
// events.mjs's writeActionBlock takes.
export function encodeAction(input = {}) {
  const axes = new Array(6).fill(AXIS_CENTRE);
  const src = input.axes;
  if (Array.isArray(src)) {
    for (let i = 0; i < 6; i++) if (src[i] !== undefined) axes[i] = encodeAxis(src[i]);
  } else if (src && typeof src === 'object') {
    for (let i = 0; i < 6; i++) {
      const v = src[AXIS_NAMES[i]] ?? src[AXIS_NAMES[i].toUpperCase()];
      if (v !== undefined) axes[i] = encodeAxis(v);
    }
  } else if (input.channels) {
    for (let i = 0; i < 6; i++) if (input.channels[i] !== undefined) axes[i] = encodeAxis(input.channels[i]);
  }
  for (let i = 0; i < 6; i++) {
    const k = AXIS_NAMES[i];
    if (input[k] !== undefined) axes[i] = encodeAxis(input[k]);
  }
  const buttons = input.buttons !== undefined ? buttonMask(input.buttons) : (input.mask !== undefined ? buttonMask(input.mask) : 0);
  return { axes, buttons };
}

// The page's natural shape: held keys and a look delta. Everything is optional;
// what is not given is neutral, so a partial update is a full record (the
// engine's own buffers are full records too).
export function actionFor(state = {}) {
  const axes = new Array(6).fill(AXIS_CENTRE);
  const set = (i, v) => { if (v) axes[i] = encodeAxis(v); };
  set(AXIS.THROTTLE, (state.forward ? 1 : 0) + (state.back ? -1 : 0));
  set(AXIS.YAW, (state.right ? 1 : 0) + (state.left ? -1 : 0));
  set(AXIS.PITCH, (state.pitchUp ? 1 : 0) + (state.pitchDown ? -1 : 0));
  set(AXIS.ROLL, (state.rollRight ? 1 : 0) + (state.rollLeft ? -1 : 0));
  set(AXIS.MOUSELOOK_X, state.lookX ?? 0);
  set(AXIS.MOUSELOOK_Y, state.lookY ?? 0);
  let buttons = 0;
  if (state.fire) buttons |= BUTTON.FIRE;
  if (state.altFire) buttons |= BUTTON.ALT_FIRE;
  if (state.use) buttons |= BUTTON.USE;
  if (state.reload) buttons |= BUTTON.RELOAD;
  if (state.drop) buttons |= BUTTON.DROP;
  if (state.walk) buttons |= BUTTON.WALK;
  if (state.run) buttons |= BUTTON.RUN;
  if (state.crouch) buttons |= BUTTON.CROUCH;
  if (state.lie) buttons |= BUTTON.LIE;
  if (state.action) buttons |= BUTTON.ACTION;
  for (let i = 1; i <= 9; i++) if (state[`menu${i}`]) buttons |= BUTTON[`MENU${i}`];
  buttons |= buttonMask(state.buttons ?? 0);
  return { axes, buttons };
}

// True when the object is meant as an encoded record or explicit axes/buttons
// rather than the key-state shape actionFor() reads. Used by InputSender so a
// page can send either.
const ENCODED_KEYS = new Set(['axes', 'channels', 'buttons', 'mask', ...AXIS_NAMES]);
export function isEncodedShape(input) {
  for (const k of Object.keys(input ?? {})) if (ENCODED_KEYS.has(k)) return true;
  return false;
}
// An already-quantised record is passed through as-is; anything else is encoded.
export function normaliseAction(input) {
  const a = input.axes;
  if (Array.isArray(a) && a.length === 6 && a.every((n) => Number.isInteger(n) && n >= 0 && n <= AXIS_MAX)) {
    return { axes: a.slice(), buttons: buttonMask(input.buttons ?? input.mask ?? 0) };
  }
  return encodeAction(input);
}

// The input block for one datagram: the 6-bit stream-presence mask (bit 0 set)
// then PlayerActionManager::transmit's framing via events.mjs's writer.
// 6 + 4 + 32 + 104 * n bits, byte-aligned by the BitWriter (19 bytes for one
// action). The count is 4 bits (R-2), so at most 15 records parse; the client's
// own manager holds 3 (PlayerActionManager::add 0x08148120), which is the cap
// this module keeps.
export function inputPayload(actions, firstSerial, maskBits = STREAM_INPUT) {
  if (actions.length > MAX_ACTIONS_PER_PACKET) {
    throw new Error(`${actions.length} actions > ${MAX_ACTIONS_PER_PACKET} (PlayerActionManager::add caps at 3)`);
  }
  const w = new BitWriter(64);
  w.writeUnsigned(maskBits, 6);
  writeActionBlock(w, firstSerial, actions);
  return w.bytes();
}

// Read an input block back: the mask, the count, the first serial and the
// records, with the axes decoded to channel units. The round-trip half of the
// encoder, and what selfTest() checks itself against.
export function decodeInputBlock(bytes, bitLength = bytes.length * 8) {
  const r = new BitReader(bytes, bitLength);
  const mask = r.readUnsigned(6);
  const count = r.readUnsigned(4);
  const out = { mask, count, actions: [] };
  if (count > 0) {
    out.firstSerial = r.readSigned(32);
    for (let i = 0; i < count; i++) {
      const axes = [];
      for (let a = 0; a < 6; a++) axes.push(r.readUnsigned(12));
      const buttons = r.readUnsigned(32);
      out.actions.push({ axes, buttons, serial: out.firstSerial + i, channels: axes.map(decodeAxis) });
    }
  }
  out.bits = r.pos;
  return out;
}

// --- the sender --------------------------------------------------------------

const TICK_RATE = 30;   // GameServer's fixed 30 Hz step (D-1/D-3)
const MAX_RATE = 60;

export { TICK_RATE };

// Streams PlayerAction records at `rate` through the session's connection.
//
//   const sender = new InputSender(session);       // 30 Hz, idle: 'zero'
//   sender.start();
//   sender.setInput({ forward: true, lookX: 2.5 });
//
// Behaviour when the page stops sending (the browser bridge owns this: a
// background tab's timers are throttled, so the sidecar must not depend on it):
//   idle: 'zero'  (default) keep sending a neutral record at the tick rate —
//                 the wire rhythm stays constant and the soldier stops.
//   idle: 'hold'  keep sending the last record (a held key stays held).
//   idle: 'stop'  send nothing; the server's empty buffer is simulated as zero
//                 input anyway (D-4), so the soldier stops with less traffic.
// The three differ only in traffic and in whether a key stays down; all three
// leave the server simulating zero input if the page never sends.
export class InputSender {
  constructor(session, opts = {}) {
    this.session = session;
    this.rate = clampRate(opts.rate ?? TICK_RATE);
    this.idle = opts.idle ?? 'zero';
    if (!['zero', 'hold', 'stop'].includes(this.idle)) throw new Error(`unknown idle mode "${this.idle}"`);
    this.idleAfterMs = opts.idleAfterMs ?? 250;
    this.serial = opts.firstSerial ?? DEFAULT_SERIAL;
    this.action = opts.action ?? ZERO_ACTION;
    this.stats = { ticks: 0, sent: 0, actions: 0, skipped: 0, errors: 0, lastError: null };
    this._timer = null;
    this._nextAt = 0;
    this._lastInputAt = 0;
    this._sentOnce = false;
    this._listeners = [];
    // The page's own words, one per world tick, each sent as exactly one
    // engine record (enqueue). The look axes are per-tick deltas
    // (c_PIMouseLookX/Y), so a word sent twice turns the server's soldier
    // twice and a word dropped turns him not at all: a latest-value slot
    // re-sampled on this timer duplicated and dropped them against the page's
    // bursty frames, and the server's facing walked away from the page's.
    this.recent = [];   // the last words sent, resent beside each new one
    this.pending = [];  // words not yet on the wire (before the join, or paced)
    this.maxQueue = opts.maxQueue ?? 24;
    // When the last page word went on the wire (`_flushWords`), for the pacing.
    this._releasedAt = -Infinity;
    // Buttons an idle record carries (the caller's held presses): a press made
    // while the page sends no words (its deploy screen) still reaches the
    // server, as it would from a retail client, which never stops sending.
    this.idleButtons = typeof opts.idleButtons === 'function' ? opts.idleButtons : null;
    // Every record put on the wire as a new serial, oldest first: its serial,
    // when the page's word reached this sender (`recvAt`, null for an idle
    // record) and when it left (`relAt`), on `performance.now()`. What
    // `atAck` reads the server's buffer and its starved ticks from.
    this.released = [];
    this._ack = null;   // { serial, tick } of the previous acknowledgement
    this.path = { acks: 0, ticks: 0, starved: 0, trimmed: 0, merged: 0 };
    // The clock those times are on (a test passes its own).
    this.clock = typeof opts.clock === 'function' ? opts.clock : () => performance.now();
    // A queue longer than this after a hitch is merged into two words at once
    // (`_mergePending`), rather than drained one a tick: Infinity turns it off.
    this.mergeAbove = opts.mergeAbove ?? MERGE_ABOVE;
    // 'bucket' (2026-10-24): a page word leaves the moment one a tick allows,
    // with a burst of PACE_BURST. 'slot': the law before, which held a word
    // that came less than 3/4 of a tick after the last one for the sender's
    // own 30 Hz slot, whose phase against the server's tick is arbitrary.
    this.pace = opts.pace ?? 'bucket';
    this._tokens = PACE_BURST;
    this._tokensAt = null;
    this._rtts = [];
  }

  // A ping's round trip (ms), from the session's 'pong'.
  noteRtt(ms) {
    if (!Number.isFinite(ms) || ms < 0 || ms > 5000) return;
    this._rtts.push(ms);
    if (this._rtts.length > RTT_KEEP) this._rtts.shift();
  }

  // The least recent round trip, 0 before the first ping (localhost's).
  rttMs() { return this._rtts.length ? Math.min(...this._rtts) : 0; }

  // The bucket: refills one a tick up to PACE_BURST, and a word needs one.
  // Holding a word the server could have run is a tick added to it and to
  // every word behind it; at the server's buffer of four (D-2), two at once
  // above the rate are safe, and a slow frame's eleven (D-7) still leave one
  // a tick after the first two.
  _mayRelease(at) {
    if (this._tokensAt !== null && at > this._tokensAt) {
      this._tokens = Math.min(PACE_BURST, this._tokens + (at - this._tokensAt) / this.periodMs);
    }
    if (this._tokensAt === null || at > this._tokensAt) this._tokensAt = at;
    // Wall-clock ms are ~1.8e12, whose float step (~2e-4 ms) is ~1e-5 of a
    // tick: a refill of exactly one period can come back 0.99999, which held
    // a word a whole tick more.
    return this._tokens >= 1 - 1e-4;
  }

  _spend() { this._tokens -= 1; }

  _noteReleased(serial, recvAt) {
    this.released.push({ serial, recvAt, relAt: this.clock() });
    if (this.released.length > RELEASED_KEEP) this.released.splice(0, this.released.length - RELEASED_KEEP);
  }

  /**
   * The input path's state at an acknowledgement: a control-object state
   * whose serial echo is `serial` (the newest record the server has run) for
   * server tick `tick`, read the moment its datagram arrived.
   *
   *   iq       page words waiting here, not yet on the wire (`pending`)
   *   sq       records on the wire the server holds unrun: released more than
   *            the round trip plus `SQ_MARGIN_MS` before this block arrived
   *            (the server reads its datagrams, ticks and sends in one frame,
   *            D-1, so those were read before the tick; a younger one was
   *            still in flight) with a serial newer than the echo
   *   starved  server ticks since the last acknowledgement that ran no record
   *            of ours (D-4's zeroed input): ticks advanced less records run
   *   trimmed  records the server skipped (D-2's trim), the other way round
   *   lead     ms from the acked word reaching this sender to the block that
   *            says it ran, less the round trip (null for an idle record):
   *            the page's word's wait for its tick, here and in the server's
   *            buffer. With the round trip in, a 170 ms internet server read
   *            as a 200 ms backlog, and the page ran its clock 6% slow for
   *            good: 1.8 ticks a second of zero input on the server.
   *   rtt      the round trip taken out (`rttMs`)
   *   hold     ms of that spent here, in `pending`
   */
  atAck(serial, tick) {
    const at = this.clock();
    const rtt = this.rttMs();
    const iq = this.pending.length;
    let sq = 0, run = 0, acked = null;
    const prev = this._ack;
    for (const r of this.released) {
      if (serialNewer(r.serial, serial)) { if (r.relAt < at - rtt - SQ_MARGIN_MS) sq++; continue; }
      if (r.serial === serial) acked = r;
      if (prev && serialNewer(r.serial, prev.serial)) run++;
    }
    let starved = 0, trimmed = 0;
    // A state with no tick (0: none yet, a free camera's) counts nothing.
    if (prev && tick > 0 && prev.tick > 0 && tick >= prev.tick && !serialNewer(prev.serial, serial)) {
      const dt = tick - prev.tick;
      if (dt > run) starved = dt - run; else trimmed = run - dt;
      this.path.ticks += dt;
    }
    this.path.acks += 1;
    this.path.starved += starved;
    this.path.trimmed += trimmed;
    this._ack = { serial, tick };
    const lead = acked && acked.recvAt != null ? Math.max(0, at - acked.recvAt - rtt) : null;
    const hold = acked && acked.recvAt != null ? acked.relAt - acked.recvAt : null;
    return { iq, sq, starved, trimmed, lead, hold, rtt };
  }

  // One page word: one engine record with its own serial, on the wire the
  // moment the page produces it, the way the retail client sends each tick's
  // record as it builds it. Every datagram also carries the two words before
  // it under their own serials, so a lost datagram costs nothing:
  // processRcvdPlayerActions (0x08148470) drops any serial no newer than the
  // last it used (D-4), so a repeat is free and a burst never overflows the
  // server's buffer of four (D-1). `tag` rides to the 'sent' event (the
  // page's own seq, for the ack).
  //
  // **At most one new word per server tick.** The server keeps at most four
  // buffered actions a frame, dropping the oldest (`clearPlayerActions`
  // 0x0815bb90, D-2), and consumes one a tick (D-3). A page whose frame is
  // slow makes a frame's worth of ticks at once (11 words at 2.7 fps on DC El
  // Alamein, 2026-10-17); sent as made, about half were trimmed and the
  // server simulated zero input on the ticks it then had nothing for. Its
  // soldier walked at 0.73 m/s against 1.59 for the same words sent evenly
  // (live, `staticcol/burst.mjs`), and the page, which had run all eleven,
  // was corrected back 0.6 to 1.2 m on every ack. So words leave through a
  // bucket of one a tick with a burst of two (`_mayRelease`); the rest wait
  // in `pending` and leave as it refills (`_tick`). A page at 60 fps sees no
  // added delay; a slow one sees its words reach the server late but all of
  // them, in order, one a tick. Until 2026-10-24 a word left at once only
  // when the queue was empty and the previous one had left most of a tick
  // ago, else at the sender's own 30 Hz slot (`pace: 'slot'`); with a page's
  // frames jittering, that held a word past the tick it could have made, and
  // the server starved with a word waiting here (wire.md section 39).
  //
  // What this replaced: words queued and drained up to three NEW ones per
  // 30 Hz slot, with a held repeat filling any slot the page had not reached.
  // The repeats were ticks the server ran and the page never had, mapped to
  // the page's last word for the ack, so every correction was measured a
  // tick off (p90 0.21 m, one tick of a run) and the bursts of three new
  // words overflowed the server's buffer and dropped words the page had run:
  // the body stuttered and slid sideways while turning (live, 2026-10-16).
  enqueue(input, tag = null) {
    const action = input ? (isEncodedShape(input) ? normaliseAction(input) : actionFor(input)) : ZERO_ACTION;
    this.action = action;
    this._lastInputAt = Date.now();
    const word = { action, tag, serial: this.serial, recvAt: this.clock() };
    this.serial = nextSerial(this.serial);
    this.pending.push(word);
    if (this.pending.length > this.mergeAbove) this._mergePending();
    if (this.pending.length > this.maxQueue) { this.pending.shift(); this.stats.dropped = (this.stats.dropped ?? 0) + 1; }
    if (this.pace === 'slot') {
      if (this.pending.length === 1 && Date.now() - this._releasedAt >= this.periodMs * PACE_IMMEDIATE) this._flushWords();
    } else {
      while (this.pending.length && this._mayRelease(Date.now()) && this._flushWords()) this._spend();
    }
    return action;
  }

  // A hitch's backlog, at once: every waiting word but the newest becomes one
  // record, so the queue is two words and its latency goes with it rather
  // than draining one a tick. Nothing the page did is lost: the look axes
  // are per-tick deltas and are summed (saturating at the record's range,
  // AXIS_SATURATE a tick); a one-shot press in any of them is pressed once,
  // and the prone toggle once per odd number of changes; every other channel
  // and held button is the newest word's, a level. The record keeps the
  // newest merged word's serial and tag, so the ack maps to the page tick
  // whose state it reflects; the page's reconciler takes the newest of its
  // ticks at or below an ack (netcode-reconcile.js `accept`), and the server
  // ran one tick of motion for several of the page's, which is the
  // correction this costs. The skipped serials are free: the server keeps
  // any serial newer than its last (D-4).
  _mergePending() {
    const group = this.pending.slice(0, -1);
    if (group.length < 2) return;
    const newest = group[group.length - 1];
    const axes = newest.action.axes.slice();
    for (const ch of [AXIS.MOUSELOOK_X, AXIS.MOUSELOOK_Y]) {
      let sum = 0;
      for (const w of group) sum += w.action.axes[ch] - AXIS_CENTRE;
      axes[ch] = Math.max(0, Math.min(AXIS_MAX, AXIS_CENTRE + sum));
    }
    let presses = 0, toggles = 0;
    for (const w of group) {
      presses = (presses | (w.action.buttons & ONE_SHOT_BUTTONS & ~TOGGLE_STATE_BUTTONS)) >>> 0;
      toggles = (toggles ^ (w.action.buttons & TOGGLE_STATE_BUTTONS)) >>> 0;
    }
    const buttons = ((newest.action.buttons & ~ONE_SHOT_BUTTONS) | presses | toggles) >>> 0;
    const merged = { action: { axes, buttons }, tag: newest.tag, serial: newest.serial,
                     recvAt: group[0].recvAt, merged: group.length };
    this.pending = [merged, this.pending[this.pending.length - 1]];
    this.path.merged += group.length - 1;
    this._emit('merged', { words: group.length, serial: merged.serial, tag: merged.tag });
  }

  // Put the oldest waiting word on the wire, beside the two released before
  // it (oldest first, consecutive serials), once the connection can take it;
  // announce it as sent. One word a call: the pacing is the callers'.
  _flushWords() {
    if (!this.pending.length) return false;
    const conn = this.session?.conn;
    if (!conn || conn.state !== 'connected' || !this.session.joined) return false;
    const word = this.pending[0];
    const last = this.recent[this.recent.length - 1];
    const words = last && nextSerial(last.serial) === word.serial ? [...this.recent, word] : [word];
    if (words.length > MAX_ACTIONS_PER_PACKET) words.shift();
    try {
      const seq = conn.sendData(inputPayload(words.map(w => w.action), words[0].serial), { input: words[0].serial });
      this.stats.sent += 1;
      this.stats.actions += words.length;
      this._sentOnce = true;
      this.recent = words;
      this.pending.shift();
      this._noteReleased(word.serial, word.recvAt ?? null);
      this._releasedAt = Date.now();
      this._emit('sent', { serial: word.serial, seq, action: word.action, tag: word.tag, idle: false });
      return true;
    } catch (e) {
      this.stats.errors += 1;
      this.stats.lastError = e.message;
      this._emit('error', e);
      return false;
    }
  }

  get periodMs() { return 1000 / this.rate; }
  get running() { return this._timer !== null; }

  // A page input update. Takes either the state shape actionFor() reads
  // ({ forward, fire, lookX, ... }) or an already-encoded record
  // ({ axes, buttons }). Encodes immediately, so a bad axis or button name
  // throws at the caller rather than inside the send timer.
  setInput(input) {
    if (!input) { this.action = ZERO_ACTION; return this.action; }
    this.action = isEncodedShape(input) ? normaliseAction(input) : actionFor(input);
    this._lastInputAt = Date.now();
    return this.action;
  }

  setAction(action) { return this.setInput(action); }

  // Held-button helpers, for a page that tracks keyup/keydown separately.
  press(buttons) { return this.setInput({ ...this._decodeCurrent(), buttons: this.action.buttons | buttonMask(buttons) }); }
  release(buttons) { return this.setInput({ ...this._decodeCurrent(), buttons: this.action.buttons & ~buttonMask(buttons) }); }

  _decodeCurrent() { return { axes: this.action.axes, buttons: this.action.buttons }; }

  start() {
    if (this._timer) return this;
    this._nextAt = Date.now() + this.periodMs;
    // Poll faster than the period so the wall-clock slots, not the timer, set
    // the cadence: setInterval alone drifts a few ms per second, and a rate
    // that falls below the server's tick rate leaves it simulating zero input
    // on the ticks nothing arrives for.
    const poll = Math.max(5, Math.floor(this.periodMs / 2));
    this._timer = setInterval(() => this._pump(), poll);
    if (this._timer.unref) this._timer.unref();
    this._emit('started', { rate: this.rate, idle: this.idle, serial: this.serial });
    return this;
  }

  stop() {
    if (!this._timer) return this;
    clearInterval(this._timer);
    this._timer = null;
    this._emit('stopped', { sent: this.stats.sent, actions: this.stats.actions });
    return this;
  }

  on(name, fn) { this._listeners.push([name, fn]); return this; }
  _emit(name, payload) { for (const [n, fn] of this._listeners) if (n === name) fn(payload); }

  _pump() {
    const now = Date.now();
    let sent = 0;
    while (now >= this._nextAt && sent < 4) {   // catch up at most 4 slots
      this._tick(this._nextAt);
      this._nextAt += this.periodMs;
      sent += 1;
    }
    if (now > this._nextAt + this.periodMs * 8) this._nextAt = now + this.periodMs; // fell far behind
  }

  _tick(slotAt = Date.now()) {
    this.stats.ticks += 1;
    const conn = this.session?.conn;
    if (!conn || conn.state !== 'connected' || !this.session.joined) {
      // Never send input before the server has a BFPlayer bound to this
      // connection: processRcvdPlayerActions dereferences it (crash rule 2).
      this.stats.skipped += 1;
      return;
    }
    // A page driving the soldier owns every serial: its words go out as it
    // makes them (enqueue). A slot it has not reached is not filled, for the
    // server's empty buffer is zero input on its own (D-4) and a filler would
    // be a tick the page never ran. Only a page gone quiet hands the
    // cadence back to the idle records.
    if (this.pending.length) {
      // A slot hard on a word released at once (`enqueue`) leaves the next
      // for the slot after: one new word a tick.
      // A late timer's catch-up slots are each a tick: timed by the slot.
      if (this.pace === 'slot') {
        if (slotAt - this._releasedAt >= this.periodMs * PACE_SLOT && this._flushWords()) this._releasedAt = slotAt;
      } else {
        while (this.pending.length && this._mayRelease(slotAt) && this._flushWords()) this._spend();
      }
      return;
    }
    const fresh = Date.now() - this._lastInputAt < this.idleAfterMs;
    if (fresh) { this.stats.skipped += 1; return; }
    if (this.idle === 'stop') { this.stats.skipped += 1; return; }
    let held = this.idle === 'hold' ? holdOf(this.action) : ZERO_ACTION;
    const extra = this.idleButtons ? this.idleButtons() >>> 0 : 0;
    if (extra) held = { axes: held.axes, buttons: (held.buttons | extra) >>> 0 };
    const batch = [{ action: held, tag: null }];
    const idle = true;
    this.recent = [];
    const serial = this.serial;
    try {
      const payload = inputPayload(batch.map(b => b.action), serial);
      const seq = conn.sendData(payload, { input: serial });
      this.stats.sent += 1;
      this.stats.actions += batch.length;
      this._sentOnce = true;
      let sr = serial;
      for (const b of batch) {
        this._noteReleased(sr, null);
        this._emit('sent', { serial: sr, seq, action: b.action, tag: b.tag, idle });
        sr = nextSerial(sr);
      }
      this.serial = sr;
    } catch (e) {
      // A full send window or a closed socket must not kill the sender: the
      // action is dropped, and the server's empty-buffer law covers the tick.
      this.stats.errors += 1;
      this.stats.lastError = e.message;
      this._emit('error', e);
    }
  }
}

// The non-repetitive triggers (c_CMNonRepetive in Infantry.con: Action, the
// MenuSelects, Reload, Drop, Lie, the camera toggles) are one-tick presses on
// the wire; the push-and-hold ones stay down while held.
export const ONE_SHOT_BUTTONS = (BUTTON.ACTION | BUTTON.RELOAD | BUTTON.DROP | BUTTON.LIE
  | BUTTON.MENU1 | BUTTON.MENU2 | BUTTON.MENU3 | BUTTON.MENU4 | BUTTON.MENU5
  | BUTTON.MENU6 | BUTTON.MENU7 | BUTTON.MENU8 | BUTTON.MENU9
  | BUTTON.TOGGLE_CAMERA_MODE | BUTTON.TOGGLE_CAMERA) >>> 0;

// The room protocol's word (the page's) speaks levels: a push-and-hold key
// while held, its prone bit the page's toggle STATE, its jump bit the held
// key. The engine's record carries the client's control map already applied:
// push-and-hold triggers (Fire, Crouch, Walk, Use) down while held, and every
// c_CMNonRepetive trigger (Infantry.con: Action, Reload, Drop, Lie, the
// MenuSelects, the camera toggles) down for ONE tick per press, because
// BFSoldier::handlePlayerInput 0x08273c70 acts on every tick a channel is
// down (the Lie arm at 0x08275593 tests channel 28 each tick against the
// current state's flags). Held as a level, Lie toggled the server's soldier
// prone and back for as long as the page lay down (live, 2026-10-16). This
// turns one into the other for every bit at once: a non-repetitive bit is
// pressed on its rising edge, and a toggle-state bit (Lie) on each change.
export const TOGGLE_STATE_BUTTONS = BUTTON.LIE;
export class PageButtonEdges {
  constructor() { this.prev = 0; }
  reset() { this.prev = 0; }
  apply(levels, extra = 0) {
    const now = levels >>> 0;
    const rising = (now & ~this.prev) >>> 0;
    const changed = (now ^ this.prev) >>> 0;
    let b = (now & ~ONE_SHOT_BUTTONS) >>> 0;
    b = (b | (rising & ONE_SHOT_BUTTONS & ~TOGGLE_STATE_BUTTONS)) >>> 0;
    if (changed & TOGGLE_STATE_BUTTONS) b = (b | (changed & TOGGLE_STATE_BUTTONS)) >>> 0;
    this.prev = now;
    return (b | (extra >>> 0)) >>> 0;
  }
}

// A held record's repeat: the same keys, no look delta, no one-shot press.
export function holdOf(action) {
  const axes = action.axes.slice();
  axes[AXIS.MOUSELOOK_X] = AXIS_CENTRE;
  axes[AXIS.MOUSELOOK_Y] = AXIS_CENTRE;
  return { axes, buttons: (action.buttons & ~ONE_SHOT_BUTTONS) >>> 0 };
}

function clampRate(rate) {
  const r = Number(rate);
  if (!Number.isFinite(r) || r <= 0) throw new Error(`bad rate ${rate}`);
  if (r > MAX_RATE) throw new Error(`rate ${r} > ${MAX_RATE}`);
  return r;
}
/**
 * The input index the server runs a record at, from its serial (ledger
 * DEV-14): what `Game::getCurrentInputIndex` returns while that record's tick
 * runs, and so what `FireArms::fireBarrel` 0x0828aba0 draws a round's
 * deviation from (`(index + barrel) & 0x3ff`, DEV-9). The server queues a
 * human's records with `ActionBuffer::pushBack` 0x08112750
 * (`processRcvdPlayerActions` 0x08148470), which keeps the record's own
 * +0x14, and that is the serial the record came under (+0x88 of the received
 * entry, the field D-4 dedupes on); `simulatePlayerUpdate` 0x0815bd00 sets
 * Game+0x68 from it. `ActionBuffer::add` 0x081125c0, which would number them
 * by arrival, has no caller. So the index is the serial itself: idle records
 * count, and the serials a merge skips (`_mergePending`) are skipped by it
 * too. Measured on the lab with the recorder reading Game+0x68 at each
 * round (`lab/dev_index_probe.mjs`): 30 of 30 BAR rounds drew at their fire
 * word's serial, from serial 5623 on, through a merge and an idle spell.
 * A tick with nothing queued runs at the last record's index + 1.
 */
export function actionIndexOf(serial) {
  return Number.isInteger(serial) ? serial : null;
}

// Signed 32-bit serials wrap to 1 past SERIAL_MAX (nextSerial): newer is
// ahead by less than half the range.
function serialNewer(a, b) {
  const d = a - b;
  return d > 0 ? d < SERIAL_MAX / 2 : d < -SERIAL_MAX / 2;
}
function nextSerial(serial) {
  const n = serial + 1;
  return n > SERIAL_MAX ? 1 : n;   // the server compares signed 32-bit, keeps strictly greater
}

// --- team, kit, spawn --------------------------------------------------------

export const SPAWN_GROUP_MAX = 0x7f;   // BFSpawnPointTemplate::createObject 0x0816a650: "Spawngroup to big" above 0x7f
export const TEAMS = { AXIS: 1, ALLIES: 2 };  // what the lab's Wake round logs (Init.con game.setKit 1|2, spawnEvent team)

function requirePlayer(session) {
  if (!session || !session.me || session.me.playerId === null || session.me.playerId === undefined) {
    throw new Error('no player bound to the connection yet: send nothing but the join until the server has created your player');
  }
}

// SetTeamEvent (0x39): u8 team, u8 playerId. The server ignores the playerId
// and applies the team to the connection's own player (0x08136d11 reads byte
// +0xd and calls vtable+0x51); it also bails out on a null player, so this is
// safe but pointless before the player exists.
export function sendTeam(session, team, playerId = null) {
  requirePlayer(session);
  session.queue('SetTeam', { team: team & 0xff, playerId: (playerId ?? session.me.playerId) & 0xff });
  return { team };
}

// ChangeKitEvent (0x3e): u8 kit. The kit is the per-team slot index of the
// level's `game.setKit <team> <slot> <kit>` lines: GameServer::changeKit
// 0x08158700 looks the pair up as key (team << 8) | kit in its kit table.
// Wake: 1 -> 0 Jap_Scout 1 Jap_Assault 2 Jap_AT 3 Jap_Medic 4 Jap_Engineer,
//       2 -> 0 US_Scout 1 Us_Assault 2 Us_AT 3 US_Medic 4 US_Engineer.
export function sendKit(session, kit) {
  requirePlayer(session);
  if (kit < 0 || kit > 0xff) throw new Error(`kit ${kit} out of range`);
  session.queue('ChangeKit', { kit: kit & 0xff });
  return { kit };
}

// A chat line (chat.mjs): queued on the session's ChatSender, which sends it
// as the retail client's StringManager does, a ChatFragment of up to 15 bytes
// every 0.5 s, the text cut to 63 and at most four lines waiting. `team` is
// team chat (SayTarget 0): the server relays it to the sender's side only.
// Returns false when the line was dropped (empty, or four already waiting).
// The server never sends a player his own line, so the caller shows it.
export function sendChat(session, text, { team = false } = {}) {
  requirePlayer(session);
  return session.chatOut.say(text, { team: !!team });
}

// SpawnRequestEvent (0x2f): u8 spawnGroup, u8 kit.
//
// The second byte is the KIT, not a spawn point: the handler stores it at
// BFPlayer+0x80, the field GameServer::changeKit 0x08158700 writes the kit
// index to, and the lab settles it (2026-10-16): ChangeKit 2 then
// SpawnRequest(3, 0) spawned a USMarine_Scout, ChangeKit 0 then
// SpawnRequest(3, 3) a USMarine_Medic. The point inside the group is the
// server's choice (GameServer::spawnPlayer 0x0814c990 asks
// BFSpawnGroup::getSpawnPoint): three spawns into group 3 landed on three
// different points. The wire field keeps its old name, spawnPoint.
// spawnGroup is the level's spawn group id — the control point's
// `ObjectTemplate.spawnGroupId` (Wake Conquest: The_Beach 1, The_Airfield 2,
// South_Base 3, North_Base 4, and the fifth flag 5), or 64..83 for the
// ship-borne groups declared in Game/GlobalSpawnGroups.con. 0..127 is legal
// (BFPlayer::init 0x08052c70 zeroes anything outside it); 0 clears the group
// and makes the server ignore the second byte (handler 0x08136be7).
export function sendSpawnRequest(session, spawnGroup = 0, spawnPoint = 0) {
  requirePlayer(session);
  if (spawnGroup < 0 || spawnGroup > SPAWN_GROUP_MAX) throw new Error(`spawnGroup ${spawnGroup} > ${SPAWN_GROUP_MAX}`);
  session.queue('SpawnRequest', { spawnGroup: spawnGroup & 0xff, spawnPoint: spawnPoint & 0xff });
  return { spawnGroup, spawnPoint };
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// The spawn sequence: team, then kit, then the spawn request, one event per
// step and `stepMs` apart (the join's own rule is that events which bind state
// to a player must not share a datagram with the event that creates it, J-8;
// the session flushes every 33 ms, so a step is a tick or two).
//
// Ordering caveat, read but not settled live: SpawnRequest's second byte and
// ChangeKit's kit byte both land on BFPlayer+0x80 (0x08136c33 / 0x081588c8),
// so whichever goes last wins that field. ChangeKit after the spawn request is
// therefore the safe order if the kit comes out wrong — see decodes/input.md §5.
export async function spawnSequence(session, opts = {}) {
  const { team = null, kit = null, spawnGroup = 0, spawnPoint = 0, stepMs = 100 } = opts;
  requirePlayer(session);
  const sent = [];
  if (team !== null && team !== undefined && team !== session.me.team) {
    sendTeam(session, team);
    sent.push('SetTeam');
    if (stepMs) await delay(stepMs);
  }
  if (kit !== null && kit !== undefined) {
    sendKit(session, kit);
    sent.push('ChangeKit');
    if (stepMs) await delay(stepMs);
  }
  // The request's second byte is the kit (above), so it carries the kit when
  // one is given; spawnPoint is only the fallback for callers that name none.
  sendSpawnRequest(session, spawnGroup, kit ?? spawnPoint);
  sent.push('SpawnRequest');
  return sent;
}

// --- self-test ---------------------------------------------------------------
// node --input-type=module -e "import('./input.mjs').then(m=>m.selfTest())"
// Checks the encoder against the two laws (the derive-in-place version of
// netcode.md §1), against an independent bit-packer that implements the
// LSB-first bit order from the header comment of bitstream.mjs, and against the
// repo's own writeActionBlock. Throws on any mismatch.

export function selfTest({ verbose = true } = {}) {
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push({ name, ok: Boolean(ok), detail });
    if (!ok) throw new Error(`selfTest failed: ${name} ${detail}`);
    if (verbose) console.log(`  ok  ${name}${detail ? `  (${detail})` : ''}`);
  };

  // 1. the encode law, written out from netcode.md W-2 rather than called
  const lawEncode = (v) => Math.round(4095 * (Math.max(-1, Math.min(1, v / 16)) + 1) * 0.5);
  let worst = 0;
  for (let v = -20; v <= 20; v += 0.03125) worst = Math.max(worst, Math.abs(encodeAxis(v) - lawEncode(v)));
  check('encode law matches floatToFixed 0x08113480', worst === 0, `max delta ${worst}`);

  const fixed = [[0, 2048], [1, 2175], [-1, 1920], [16, 4095], [-16, 0], [32, 4095], [-32, 0], [0.5, 2111]];
  check('encode corner values', fixed.every(([v, n]) => encodeAxis(v) === n), JSON.stringify(fixed.map(([v]) => [v, encodeAxis(v)])));

  // 2. the decode law (W-3): ((2n/4095) - 1) * 16 rounded to 0.01
  const lawDecode = (n) => Math.round((((2 * n) / 4095) - 1) * 16 * 100) / 100;
  let dworst = 0;
  for (let n = 0; n <= 4095; n++) dworst = Math.max(dworst, Math.abs(decodeAxis(n) - lawDecode(n)));
  check('decode law matches PlayerAction::get 0x0815c5a0', dworst === 0, `max delta ${dworst}`);

  // 3. the round trip: encode then decode returns the channel value to 0.01
  let rworst = 0, rwhere = 0;
  for (let v = -16; v <= 16; v += 0.005) {
    const back = decodeAxis(encodeAxis(v));
    const d = Math.abs(back - v);
    if (d > rworst) { rworst = d; rwhere = v; }
  }
  check('round trip within the 0.01 quantisation', rworst <= 0.0099, `max ${rworst.toFixed(4)} at ${rwhere.toFixed(3)}`);
  check('centre and full deflection round trip exactly',
    decodeAxis(encodeAxis(0)) === 0 && decodeAxis(encodeAxis(1)) === 1 && decodeAxis(encodeAxis(-1)) === -1);

  // 4. bit order, independently: LSB-first, bit i of the stream is bit i&7 of
  // byte i>>3, a signed value is a sign bit then |v| (bitstream.mjs header,
  // writeBits 0x083db030 / writeSigned 0x083da150). This packer shares no code
  // with bitstream.mjs.
  const pack = (fields) => {
    const bits = [];
    for (const [value, n, kind] of fields) {
      if (kind === 's') {   // a signed write is a sign bit then |v| in n-1 bits
        bits.push(value < 0 ? 1 : 0);
        for (let i = 0; i < n - 1; i++) bits.push((Math.abs(value) >>> i) & 1);
        continue;
      }
      for (let i = 0; i < n; i++) bits.push((i < 32 ? (value >>> i) & 1 : 0));
    }
    const out = new Uint8Array(Math.ceil(bits.length / 8));
    bits.forEach((b, i) => { if (b) out[i >> 3] |= 1 << (i & 7); });
    return out;
  };
  const action = { axes: [encodeAxis(1), encodeAxis(-1), encodeAxis(0), encodeAxis(0.25), encodeAxis(0), encodeAxis(0)], buttons: BUTTON.FIRE | BUTTON.RELOAD };
  const payload = inputPayload([action], 7);
  const expected = pack([[STREAM_INPUT, 6], [1, 4], [7, 32, 's'],
    ...action.axes.map((a) => [a, 12]), [action.buttons, 32]]);
  check('payload matches an independent LSB-first packer', Buffer.compare(Buffer.from(payload), Buffer.from(expected)) === 0,
    `len ${payload.length} bytes (${6 + 4 + 32 + 104} bits)`);
  check('the block leaves the writer at 146 bits', decodeInputBlock(payload).bits === 146, `bits ${decodeInputBlock(payload).bits}`);

  // 5. against the repo's own writer (events.mjs writeActionBlock) — the
  // function the encoder is meant to be byte-compatible with.
  const w = new BitWriter(64);
  w.writeUnsigned(STREAM_INPUT, 6);
  writeActionBlock(w, 7, [action]);
  check('payload equals events.mjs writeActionBlock output', Buffer.compare(Buffer.from(payload), Buffer.from(w.bytes())) === 0);

  // 6. serials: strictly increasing, signed 32-bit, and the server drops
  // anything not greater than its last (processRcvdPlayerActions 0x08148470).
  let s = DEFAULT_SERIAL, okSerial = true;
  for (let i = 0; i < 5; i++) s = nextSerial(s);
  okSerial = s === DEFAULT_SERIAL + 5;
  const a = decodeInputBlock(inputPayload([{ axes: ZERO_ACTION.axes.slice(), buttons: 0 }], 1000));
  check('serials increase and decode back', okSerial && a.firstSerial === 1000 && a.actions[0].serial === 1000, `first ${a.firstSerial}`);

  // 7. the button map: bit i must be the channel PlayerAction::get reads back
  // (0x0815c5a0: bit 0 -> setInput(ch8), bit 15 -> ch23, bit 16 -> ch24 ...).
  const mapOk = BUTTON.FIRE === 1 && BUTTON.ALT_FIRE === 0x8000 && BUTTON.RELOAD === 0x10000
    && BUTTON.CROUCH === 0x200000 && BUTTON_CHANNEL.FIRE === 8 && BUTTON_CHANNEL.CROUCH === 29
    && buttonMask('fire|crouch') === (BUTTON.FIRE | BUTTON.CROUCH) && buttonMask({ reload: true }) === BUTTON.RELOAD;
  check('button map and names', mapOk);

  // 8. the block cap: 3 records fit (the manager's own limit), 4 do not.
  let threw = false;
  try { inputPayload([action, action, action, action], 1); } catch { threw = true; }
  check('more than 3 records in one packet is refused', threw);

  // 9. decodeInputBlock reads back what encodeAction wrote.
  const dec = decodeInputBlock(inputPayload([action], 3));
  check('decode round trip', dec.count === 1 && dec.mask === STREAM_INPUT
    && dec.actions[0].buttons === action.buttons
    && dec.actions[0].channels.every((c, i) => Math.abs(c - decodeAxis(action.axes[i])) < 1e-9));

  return results;
}

export default { encodeAxis, decodeAxis, encodeAction, actionFor, inputPayload, decodeInputBlock, InputSender, spawnSequence, sendTeam, sendKit, sendSpawnRequest, sendChat, selfTest };
