// Malformed and out-of-range inputs the sidecar must survive: each section
// is a defect the Kotlin port's authors found in the Node copy (2026-10-26),
// driven so the old code fails it. Prints one JSON object for
// `tests/test_sidecar_robustness.py`.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const mod = (f) => import(pathToFileURL(path.join(here, '..', 'sidecar', f)).href);
const results = {};
const attempt = (fn) => { try { return { ok: fn() }; } catch (e) { return { error: e.message }; } };

// --- netconn.mjs ---------------------------------------------------------------
{
  const { NetConnection, PT } = await mod('netconn.mjs');
  const fresh = () => {
    const c = new NetConnection('127.0.0.1', 9, { plus: null });
    c.sock.close();
    c.sock = { send: () => {}, close: () => {} };
    return c;
  };
  const header = (type, ack, seq = 0, size = 9) => {
    const b = Buffer.alloc(size);
    b[1] = (seq & 0x3f) | ((ack & 3) << 6);
    b[2] = (type << 4) | ((ack >> 2) & 0xf);
    return b;
  };
  // An ack for a sequence never sent, then a send.
  {
    const c = fresh();
    c.state = 'connected';
    const statuses = [];
    c.on('status', (s) => statuses.push(s.seq));
    c._onDatagram(header(PT.Data, 20, 1), {});
    const first = attempt(() => c.sendData(Buffer.from([1])));
    c._onDatagram(header(PT.Data, 1, 2), {});
    results.ackAhead = { first, lastConfirmed: c.lastConfirmed, statuses, second: attempt(() => c.sendData(Buffer.from([2]))) };
  }
  // A ConnectAccept cut short, then a whole one.
  {
    const c = fresh();
    c.state = 'connecting';
    const connected = [];
    c.on('connected', (e) => connected.push(e));
    const short = Buffer.alloc(12); short[2] = PT.ConnectAccept << 4; short[8] = 5;
    const whole = Buffer.alloc(13); whole[2] = PT.ConnectAccept << 4; whole[8] = 6; whole.writeUInt32LE(1234, 9);
    const shortRes = attempt(() => c._onDatagram(short, {}));
    const stateAfterShort = c.state;
    c._onDatagram(whole, {});
    results.shortAccept = { shortRes: shortRes.error ?? 'ok', stateAfterShort, connected, state: c.state };
  }
}

// --- events.mjs ------------------------------------------------------------------
{
  const { BitWriter, BitReader, writeEvent, readEvent } = await mod('events.mjs');
  const roundTrip = (name, body) => attempt(() => {
    const w = new BitWriter(1472);
    writeEvent(w, name, body);
    writeEvent(w, 'Suicide', {});
    const r = new BitReader(w.bytes(), w.pos);
    const a = readEvent(r);
    const b = readEvent(r);
    return { first: a, next: b.type, left: r.remaining };
  });
  results.events = {
    lstr300: roundTrip('ServerInfo2', { serverName: 'w'.repeat(300) }),
    vec2: roundTrip('UpdateStaticObject', { objectId: 1, action: 0, value: [7, 8] }),
    vec4: roundTrip('CreateStaticObject', { template: 1, objectId: 2, pos: [1, 2, 3, 4], rot: [5, 6, 7] }),
    strNumber: roundTrip('SessionId', { sessionId: 42 }),
    lstrNumber: roundTrip('ServerInfo2', { serverName: 12345 }),
    hudNumber: roundTrip('HUDText', { kind: 1, text: 404 }),
    chatBool: roundTrip('ChatFragment', { first: false, text: true }),
  };
}

// --- input.mjs -----------------------------------------------------------------
{
  const { actionFor, encodeAction, InputSender } = await mod('input.mjs');
  results.buttons = { actionFor: actionFor({ buttons: 2 ** 31 }).buttons, encodeAction: encodeAction({ buttons: 2 ** 31 }).buttons };
  // The sender on an injected clock that stands still while Date.now runs
  // ahead: a burst drains through the bucket by the injected clock alone.
  const session = { joined: true, conn: { state: 'connected', sendData: () => 1 } };
  let t = 0;
  const s = new InputSender(session, { rate: 30, idle: 'zero', pace: 'bucket', mergeAbove: Infinity, clock: () => t });
  const sent = [];
  s.on('sent', (x) => sent.push(x.serial));
  const realNow = Date.now;
  let wall = realNow();
  Date.now = () => (wall += 1000);   // a wall clock that leaps a second each read
  try {
    for (let i = 0; i < 5; i++) s.enqueue({ buttons: 0 }, i);
    results.clock = { atOnce: sent.length, nextAt: null };
    s.start(); s.stop();
    results.clock.nextAt = s._nextAt;
  } finally { Date.now = realNow; }
}

process.stdout.write(JSON.stringify(results));
