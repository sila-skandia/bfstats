// Runs the real sidecar.mjs under the parity driver, unedited:
//   node --import ./lib/sidecar-preload.mjs <sidecar.mjs> <its arguments>
// with SIDECAR_PARITY_SCRIPT naming a JSON script and SIDECAR_PARITY_RESULT
// where the transcript goes.
//
// Before sidecar.mjs loads, this installs the fake clock (fake-time.mjs),
// replaces dgram.createSocket with fake sockets that log every datagram and
// let the script deliver the server's, points the page socket at
// fake-wsserver.mjs (a module hook), seeds crypto.randomInt, and logs
// console.log / console.error and process.exit. Then it plays the script:
// each step at its virtual time (a datagram from the server, the page opening,
// sending a frame, closing, SIGINT), and finally the recording and the review
// log the sidecar wrote. SidecarTest.kt plays the same script against
// Sidecar.kt. The Node sidecar itself is not changed.
import { registerHooks } from 'node:module';
import { EventEmitter } from 'node:events';
import dgram from 'node:dgram';
import crypto from 'node:crypto';
import fs from 'node:fs';
import util from 'node:util';
import { installFakeTime } from './fake-time.mjs';
import { enc, prng } from './fixture.mjs';

// sidecar.mjs's page socket (`import('./wsserver.mjs')`) resolves to the fake;
// nothing else is redirected.
const FAKE_WS = new URL('./fake-wsserver.mjs', import.meta.url).href;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === './wsserver.mjs' && context.parentURL?.endsWith('/sidecar/sidecar.mjs')) return { url: FAKE_WS, shortCircuit: true };
    return next(specifier, context);
  },
});

const script = JSON.parse(fs.readFileSync(process.env.SIDECAR_PARITY_SCRIPT, 'utf8'));
const realSetImmediate = setImmediate;
const realSetTimeout = setTimeout;
const realExit = process.exit.bind(process);
const lines = [];
// Date.now() a whole millisecond, as it is live (ManualScheduler floorWall).
const time = installFakeTime(0, { floorWall: true });
const P = globalThis.__sidecarParity = {
  at: () => time.now,
  line: (a) => lines.push(JSON.stringify(enc(a))),
  ws: null,
};

// Seeded randomness for the key hash (cdkey.mjs retailRand) and any key made.
const r = prng(script.seed ?? 1942);
crypto.randomInt = (max) => Math.floor(r() * max);

// The UDP sockets: the session's (bound) and the rejoin probes' (not).
const socks = [];
// The sockets in the order each first sent a datagram: a capture's client
// index (live/page-relay.mjs numbers them so) names one of these.
const sendOrder = [];
const DATA = 0xf;
const SERVER_INFO_REQUEST = 9;
dgram.createSocket = () => {
  const s = new EventEmitter();
  s.idx = socks.length; s.bound = false; s.closed = false; s.lastSent = 0;
  socks.push(s);
  s.bind = (port, cb) => { s.bound = true; if (typeof cb === 'function') cb(); };
  s.address = () => ({ address: '0.0.0.0', family: 'IPv4', port: 40000 + s.idx });
  s.send = (b, port, host, cb) => {
    const buf = Buffer.from(b);
    // A socket is a rejoin probe's when its first datagram is a ServerInfoRequest.
    if (s.kind === undefined) { s.kind = (buf[2] >> 4) === SERVER_INFO_REQUEST ? 'probe' : 'session'; sendOrder.push(s); }
    if ((buf[2] >> 4) === DATA) s.lastSent = buf[1] & 0x3f;
    P.line([time.now, 'out', s.idx, buf]);
    realSetImmediate(() => { if (typeof cb === 'function') cb(null); });
  };
  s.close = () => { if (s.closed) return; s.closed = true; P.line([time.now, 'sockClose', s.idx]); };
  s.unref = () => s; s.ref = () => s;
  return s;
};

console.log = (...a) => P.line([time.now, 'log', util.format(...a)]);
console.error = (...a) => P.line([time.now, 'log', util.format(...a)]);
console.warn = () => {};
process.exit = (code) => P.line([time.now, 'exit', code ?? 0]);
process.on('unhandledRejection', (e) => P.line([time.now, 'unhandled', e?.message ?? String(e)]));

// A server datagram's ack fields set to the newest Data sequence this socket
// sent, every earlier one delivered (the fake server's acknowledgement).
export function withAutoAck(hex, lastSent) {
  const b = Buffer.from(hex, 'hex');
  b[1] = (b[1] & 0x3f) | ((lastSent & 3) << 6);
  b[2] = (b[2] & 0xf0) | ((lastSent >> 2) & 0xf);
  b.writeUInt32LE(0xffffffff, 3);
  return b;
}

const settle = () => new Promise((res) => realSetImmediate(res));
// The server's datagrams go to the newest open session socket (else the
// newest session socket), a probe's answer to the newest open probe socket.
const newest = (kind, open) => [...socks].reverse().find((s) => s.kind === kind && (!open || !s.closed));
const sessionSock = () => newest('session', true) ?? newest('session', false);
const probeSock = () => newest('probe', true);
const pages = [];

async function drive() {
  for (let i = 0; i < 5; i++) await settle();
  for (const st of script.steps) {
    await time.stepTo(st.t);
    switch (st.op) {
      case 'in': case 'probeReply': {
        const s = st.op === 'in' ? sessionSock() : probeSock();
        if (!s) { P.line([time.now, 'noSocket', st.op]); break; }
        const buf = st.ack === 'auto' ? withAutoAck(st.hex, s.lastSent) : Buffer.from(st.hex, 'hex');
        s.emit('message', buf, { address: '10.0.0.9', family: 'IPv4', port: 14567, size: buf.length });
        break;
      }
      case 'udp': {
        // A captured datagram for the capture's client socket `c`; nothing
        // when that socket is not there yet or has closed (a closed socket
        // hears nothing).
        const s = sendOrder[st.c];
        if (s && !s.closed) {
          const buf = st.ack === 'auto' ? withAutoAck(st.hex, s.lastSent) : Buffer.from(st.hex, 'hex');
          s.emit('message', buf, { address: '10.0.0.9', family: 'IPv4', port: 14567, size: buf.length });
        }
        break;
      }
      case 'pageOpen': pages[st.sock] = P.ws.connectPage(st.sock); break;
      case 'pageText': pages[st.sock].emit('message', st.text, false); break;
      case 'pageBin': pages[st.sock].emit('message', Buffer.from(st.hex, 'hex'), true); break;
      case 'pageClose': pages[st.sock].close(); break;
      case 'sigint': process.emit('SIGINT'); break;
      case 'end': break;
      default: throw new Error(`bad op ${st.op}`);
    }
    await settle();
  }
  // Let the file streams flush.
  for (let i = 0; i < 5; i++) await settle();
  await new Promise((res) => realSetTimeout(res, 200));
  const read = (f) => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean); } catch { return []; } };
  for (const l of read(script.out)) lines.push(JSON.stringify(['rec', l]));
  for (const l of read(script.review)) lines.push(JSON.stringify(['review', l]));
  fs.writeFileSync(process.env.SIDECAR_PARITY_RESULT, lines.join('\n') + '\n');
  realExit(0);
}
realSetImmediate(() => drive().catch((e) => { fs.writeFileSync(process.env.SIDECAR_PARITY_RESULT, `driver failed: ${e.stack}\n`); realExit(2); }));
