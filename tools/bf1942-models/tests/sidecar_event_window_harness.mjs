// The event stream's send window, under node (session.mjs `_flush` and
// `_onStatus`, retail's GameEventManager::transmit 0x0812d770 and
// getNumUnconfirmed 0x0812e540). A Session whose datagram layer is a stub:
// every block it sends is recorded, and the harness reports each datagram
// delivered or lost the way NetConnection's ack walk does.
//
//   node tests/sidecar_event_window_harness.mjs
//
// Prints one JSON line.
import { Session, eventWindowFull, EVENT_WINDOW } from '../sidecar/session.mjs';

const out = {};

function session() {
  const s = new Session('127.0.0.1', 1, { name: 'w' });
  const sent = [];
  s.conn.state = 'connected';
  s.conn.sendData = (_payload, tag) => { sent.push(tag.block); return sent.length; };
  try { s.conn.sock.close(); } catch { /* never bound */ }
  return { s, sent };
}

// 1. A fresh stream opens blocks 0..13 and holds the 15th event: the window
//    is (next - lastConfirmed) & 31 < 15 with lastConfirmed starting at 31.
{
  const { s, sent } = session();
  for (let i = 0; i < 20; i++) { s.queue('Suicide', {}); s._flush(); }
  out.freshBlocks = sent.slice();
  out.freshHeld = s.outbox.length;
}

// 2. Block 0 lost, 1..13 delivered: retail's window does not move past the
//    lost block, so nothing new goes out until 0's resend lands; then the
//    window opens over every block delivered behind it at once.
{
  const { s, sent } = session();
  for (let i = 0; i < 14; i++) { s.queue('Suicide', {}); s._flush(); }
  s._onStatus({ delivered: false, tag: { block: 0 } });
  for (let b = 1; b < 14; b++) s._onStatus({ delivered: true, tag: { block: b } });
  for (let i = 0; i < 5; i++) { s.queue('Suicide', {}); s._flush(); }
  out.afterLoss = sent.slice(14);
  out.lastConfirmedWhileLost = s.lastConfirmedBlock;
  s._onStatus({ delivered: true, tag: { block: 0 } });
  out.lastConfirmedAfterResend = s.lastConfirmedBlock;
  for (let i = 0; i < 20; i++) s._flush();
  out.afterResend = sent.slice(14);
}

// 3. The law itself at the wrap.
out.law = {
  cap: EVENT_WINDOW,
  start: eventWindowFull(0, 31),
  thirteenOut: eventWindowFull(14, 31),
  wrapOpen: eventWindowFull(33, 20),
  wrapShut: eventWindowFull(35, 20),
};

console.log(JSON.stringify(out));
process.exit(0);
