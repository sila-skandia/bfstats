// The P2 client wire seam: one object per room connection, holding the join
// handshake, the input seq, the snapshot buffer and the live feed — pure
// protocol, no THREE and no DOM, so `tests/netcode_client_harness.mjs` can
// drive it under node against a scripted transport. The page glue in
// `map.html` supplies the WebSocket and the rendering; this module decides
// what goes on the wire and what the renderer reads.
//
// The laws it pins are `netcode.js`'s (the engine's 104-bit record, the
// 20 Hz cadence, the sequence discipline) and the prediction law of
// `subsystems/netcode.md` §4: the client predicts its own soldier from the
// same action bytes it sends, and remote players are ghost state applied as
// the engine applied it — a single current state at ~0.1 s. The lerp between
// the last two snapshots is a RENDERING choice (netcode.md §6 makes that
// explicit), kept here so the page's renderer stays dumb.

import {
  MSG_JOIN, MSG_INPUT, MSG_PING, MSG_LEAVE, MSG_ACTION,
  MSG_HELLO, MSG_JOIN_SNAPSHOT, MSG_SNAPSHOT, MSG_EVENT, MSG_CLOSED, MSG_PONG,
  encodeInputFrame, decodeSnapshot, MAX_PLAYERS,
} from './netcode.js';

/**
 * The transport the page hands in: anything that looks like the browser's
 * WebSocket (addEventListener('message'), `send(bytes)`, `close()`) — the
 * harness stands a scripted fake in its place and drives `handleMessage`
 * directly. The client keeps a `.send(bytes)` for unframed payloads only;
 * every frame's type byte is this module's.
 */
export function createRoomClient({ ws, now = null }) {
  const out = {};
  /** The wire's per-tick seq: strictly increasing, starts at 1 (the World's
   *  `setInput(..., seq)` dedupes on `seq > lastSeen`). */
  let seq = 0;
  /** Snapshot history for render-space lerp: {at, snap} pairs, newest last. */
  let history = [];
  /** slot -> {name, team} — the roster from HELLO plus join/leave rows. */
  const roster = new Map();
  /** The last decoded MSG_EVENT row seen; kept for the page's feed. */
  let lastEvent = null;

  out.hello = null;         // the MSG_HELLO row once joined
  out.slot = null;          // my slot in the room (1..16)
  out.state = 'connecting'; // connecting | waiting | joined | closed
  out.feed = [];            // resolved feed rows for the page's console
  out.vehicles = new Map(); // vehicle table from HELLO: id -> {id, template}
  out.onclosed = null;      // (code) => {}
  out.onerror = null;       // (message) => {}
  out.onjoined = null;      // () => {} — hello landed, page spawns

  /** One input+look word per world tick consumed (the page calls it exactly
   *  when the local world ticked); never called between ticks. Returns the
   *  seq the word went out under, which is the tick's own name on the wire --
   *  the page records its predicted pose against it so the authority's `ack`
   *  can be reconciled against the right tick (netcode-reconcile.js). Returns
   *  0 when nothing went out. */
  out.sendInput = (input, look) => {
    if (out.state !== 'joined') return 0;
    seq += 1;
    ws.send(new Uint8Array([MSG_INPUT, ...encodeInputFrame(seq, input, look)]));
    return seq;
  };

  /** The highest seq the page has put on the wire (diagnostics; the
   *  reconciler's own ack is the authority's word, not this). */
  out.sentSeq = () => seq;

  /** The engine's control channel rows (netcode.js MSG_ACTION): seat
   *  enter/exit/switch and respawn. Kept in `sentActions` (bounded) so the
   *  page's diagnostics and the smoke can see what went out. */
  out.sentActions = [];
  out.action = row => {
    if (out.state !== 'joined') return;
    out.sentActions.push({ ...row });
    if (out.sentActions.length > 64) out.sentActions.shift();
    ws.send(new Uint8Array([MSG_ACTION, ...textBytes(JSON.stringify(row))]));
  };

  out.ping = () => {
    if (out.state !== 'joined') return;
    const at = Math.max(0, (now?.() ?? 0)) & 0xffffffff;
    ws.send(new Uint8Array([MSG_PING, at & 0xff, (at >> 8) & 0xff,
                            (at >> 16) & 0xff, (at >> 24) & 0xff]));
  };

  out.join = ({ room, name, team = 0, level = null }) => {
    const row = { room, name, team };
    if (level) row.level = level;   // create-on-join names the level
    ws.send(new Uint8Array([MSG_JOIN, ...textBytes(JSON.stringify(row))]));
    out.state = 'waiting';
  };

  out.close = () => {
    if (out.state === 'joined') {
      ws.send(new Uint8Array([MSG_LEAVE]));   // the engine's explicit 0xd (J-3)
    }
    out.state = 'closed';
    try { ws.close(); } catch { /* the page's adapter handles it */ }
  };

  /** Whole WebSocket binary messages; the adapter calls this on every data
   *  frame, with the frame's bytes as a Uint8Array (or ArrayBuffer — served
   *  either way). */
  out.handleMessage = data => {
    const bytes = data instanceof Uint8Array ? data : fullView(data);
    const type = bytes[0];
    const body = bytes.subarray ? bytes.subarray(1) : bytes.slice(1);
    switch (type) {
      case MSG_HELLO: return onHello(rowFrom(body));
      case MSG_JOIN_SNAPSHOT: return applySnapshot(body);
      case MSG_SNAPSHOT: return applySnapshot(body);
      case MSG_EVENT: return onEvent(rowFrom(body));
      case MSG_CLOSED: {
        const row = rowFrom(body);
        out.state = 'closed';
        if (out.onclosed) out.onclosed(row?.code ?? 'closed', row);
        return;
      }
      case MSG_PONG: return;   // liveness only; the server's law is the timeout
      default: return;         // future messages ride past, as the server's do
    }
  };

  // --- the handshake ------------------------------------------------------

  function onHello(row) {
    if (!row || !Number.isInteger(row.slot)) return;
    out.hello = row;
    out.slot = row.slot;
    out.state = 'joined';
    roster.set(row.slot, { slot: row.slot, name: row.name ?? '', team: row.team ?? 0 });
    // The roster at join: HELLO's slots array lists the players already in
    // the room (the server builds it for this connection).
    for (const s of Array.isArray(row.slots) ? row.slots : []) roster.set(s.slot, s);
    (row.vehicles ?? []).forEach(v => out.vehicles.set(v.id, { ...v }));
    if (out.onjoined) out.onjoined();
  }

  function applySnapshot(body) {
    if (out.state !== 'joined') return;
    const decoded = decodeSnapshot(fullView(body));
    const at = now?.() ?? 0;
    history.push({ at, snap: decoded });
    // The engine's ghost cadence: one current state per ~0.1 s. History rows
    // older than half a second are dead weight for a 20 Hz lerp window.
    while (history.length > 2 && history[history.length - 3].at < at - 500) {
      history.shift();
    }
    if (out.onsnapshot) out.onsnapshot(decoded, at);
  }

  function onEvent(row) {
    if (!row || typeof row !== 'object') return;
    lastEvent = row;
    const feedRow = {
      t: row.t ?? 0,
      type: row.type,
      slot: row.slot ?? null,
      other: row.other ?? null,
      flag: row.flag ?? null,
      team: row.team ?? null,
      name: row.name ?? null,
      duration: row.duration ?? null,
      text: feedText(row),
    };
    out.feed.push(feedRow);
    // Roster maintenance: join/leave rows carry names (the page labels
    // remotes with these).
    if (row.type === 'join' && Number.isInteger(row.slot)) {
      roster.set(row.slot, { slot: row.slot, name: row.text ?? '', team: 0 });
    } else if (row.type === 'leave' && Number.isInteger(row.slot)) {
      roster.delete(row.slot);
    }
    if (out.onevent) out.onevent(feedRow);
  }

  function feedText(row) {
    const who = s => (s != null ? (roster.get(s)?.name ?? `Player ${s}`) : null);
    const team = t => t === 1 ? 'Axis' : t === 2 ? 'Allies' : `team ${t}`;
    switch (row.type) {
      case 'join': return `${row.text ?? '?'} joined the room`;
      case 'leave': return `${row.text ?? who(row.slot) ?? '?'} left`;
      case 'spawn': return `${who(row.slot) ?? '?'} deployed`;
      case 'seatEnter': return seatWord(row, 'got in');
      case 'seatExit': return seatWord(row, 'got out');
      case 'fire': return `${who(row.slot) ?? '?'} opened fire`;
      case 'killed':
        return row.other != null
          ? `${who(row.other) ?? '?'} killed ${who(row.slot) ?? '?'}`
          : `${who(row.slot) ?? '?'} died`;
      case 'ticket': return `${team(row.team)} tickets: ${row.count}`;
      case 'captured': return `${team(row.team)} captured ${row.name ?? 'a flag'}`;
      case 'capturing': return `Capturing ${row.name ?? 'a flag'}`;
      case 'captureContested': return `${row.name ?? 'A flag'} is contested`;
      case 'captureCancelled': return `Capture of ${row.name ?? 'a flag'} was stopped`;
      case 'closed': return row.text ?? 'the room closed';
      default: return row.text ?? row.type;
    }
  }

  function seatWord(row, verb) {
    const who = nameOf(row.slot) ?? '?';
    const v = out.vehicles.get(row.vehicle);
    return `${who} ${verb} ${v ? v.template : 'a vehicle'}`;
  }

  function nameOf(slot) {
    return roster.get(slot)?.name ?? null;
  }

  // --- the renderer's reads -------------------------------------------------

  /** The remote player `slot`'s lerped state between the last two snapshots:
   *  {slot, x, y, z, yaw, pitch, alive, seated, crouch, prone, inVehicle,
   *   vehicleId, seatIndex, hp, team} or null before the first snapshot. */
  out.remotePlayer = (slot, at = null) => {
    const state = lerped(slot, at);
    return state ? { slot, ...state } : null;
  };

  /** The remote slots in the newest snapshot, own slot excluded — the
   *  renderer's iteration law. */
  out.remoteSlots = () => {
    const snap = history.length ? history[history.length - 1].snap : null;
    if (!snap) return [];
    return snap.players.filter(p => p.slot !== out.slot).map(p => p.slot);
  };

  /** How many snapshots the client has applied — the page's diagnostics and
   *  the smoke's liveness checks read this before trusting any remote. */
  out.snapCount = () => history.length;

  /** The LOCAL player's row in the newest snapshot: the authority's own word
   *  about this body, un-lerped (the reconciliation reads the wire, never the
   *  render-space blend) and null before the first snapshot. The correction
   *  law consumes it through `onsnapshot`; this is the same row for a check
   *  that wants to measure the gap from outside. */
  out.selfPlayer = () => {
    const snap = history.length ? history[history.length - 1].snap : null;
    return playerIn(snap, out.slot);
  };

  /** The vehicle `id`'s lerped pose between the last two snapshots:
   *  {id, x, y, z, q, occupied} or null. */
  out.remoteVehicle = (id, at = null) => {
    return lerpedVehicle(id, at);
  };

  out.nameOf = slot => roster.get(slot)?.name ?? `Player ${slot}`;
  out.teamOf = slot => roster.get(slot)?.team ?? 0;

  /**
 * Render-side lookback: the lerp window is `[t-100ms, t]` sampled at
 * `t-50ms` — one ghost interval behind, half the engine's 0.1 s cadence —
 * so a 60 fps page reads mid-window between two arrivals instead of
 * snapping to the newest the moment it lands. All a rendering choice
 * (netcode.md §6); the wire and the sim never see it.
 */
const RENDER_LOOKBACK_MS = 50;

function lerped(slot, at) {
    if (history.length === 0) return null;
    const [a, b] = sliceWindow(history);
    const t = (at ?? now?.() ?? 0) - RENDER_LOOKBACK_MS;
    const k = blend(a, b, t);
    const pa = playerIn(a.snap, slot);
    const pb = playerIn(b.snap, slot);
    if (pa && pb) return blendPlayer(pa, pb, k);
    return pa ?? pb ?? null;
  }

  function lerpedVehicle(id, at) {
    if (history.length === 0) return null;
    const [a, b] = sliceWindow(history);
    const t = (at ?? now?.() ?? 0) - RENDER_LOOKBACK_MS;
    const k = blend(a, b, t);
    const va = a.snap.vehicles.find(v => v.id === id);
    const vb = b.snap.vehicles.find(v => v.id === id);
    if (va && vb) {
      return {
        id,
        x: va.x + (vb.x - va.x) * k,
        y: va.y + (vb.y - va.y) * k,
        z: va.z + (vb.z - va.z) * k,
        q: slerpQ(va.q, vb.q, k),
        occupied: vb.occupied,
      };
    }
    return va ?? vb ?? null;
  }

  /** The lerp window: the newest snapshot and its immediate predecessor,
   *  both within the lookback (else the newest alone, at full weight). */
  function sliceWindow(hist) {
    if (hist.length === 1) return [hist[0], hist[0]];
    const back = hist[hist.length - 1];
    return [hist[hist.length - 2], back];
  }

  function blend(a, b, t) {
    const span = b.at - a.at;
    if (!(span > 0)) return 1;
    return Math.max(0, Math.min(1, (t - a.at) / span));
  }

  function playerIn(snap, slot) {
    return snap?.players?.find(p => p.slot === slot) ?? null;
  }

  function blendPlayer(pa, pb, k) {
    const lerp = (x, y) => (Number.isFinite(x) && Number.isFinite(y) ? x + (y - x) * k : Number.isFinite(x) ? x : Number.isFinite(y) ? y : NaN);
    return {
      team: pb.team ?? pa.team ?? 0,
      alive: pb.alive,
      seated: pb.seated,
      crouch: pb.crouch,
      prone: pb.prone,
      inVehicle: pb.inVehicle,
      x: lerp(pa.x, pb.x), y: lerp(pa.y, pb.y), z: lerp(pa.z, pb.z),
      yaw: lerp(pa.yaw, pb.yaw), pitch: lerp(pa.pitch, pb.pitch),
      hp: pb.hp ?? pa.hp ?? null,
      vehicleId: pb.vehicleId ?? 0,
      seatIndex: pb.seatIndex ?? null,
    };
  }

  return out;
}

/** The decoded view of a socket message's body (ArrayBuffer or Uint8Array). */
function fullView(bytes) {
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
}

function textBytes(s) {
  return new TextEncoder().encode(s);
}

function rowFrom(body) {
  const bytes = fullView(body);
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

/** Spherical lerp over a unit quaternion, shortest path — the render-side
 *  smoothing the engine never shipped (netcode.md §6). Fallbacks: identity
 *  when either side is degenerate. */
export function slerpQ(a, b, k) {
  if (!a || !b || a.length !== 4 || b.length !== 4) return a ? [...a] : b ? [...b] : [0, 0, 0, 1];
  let [ax, ay, az, aw] = a;
  let [bx, by, bz, bw] = b;
  let dot = ax * bx + ay * by + az * bz + aw * bw;
  if (dot < 0) { dot = -dot; bx = -bx; by = -by; bz = -bz; bw = -bw; }
  if (dot > 0.9995) {              // nearly parallel: lerp suffices
    const q = [
      ax + (bx - ax) * k, ay + (by - ay) * k,
      az + (bz - az) * k, aw + (bw - aw) * k,
    ];
    return normalizeQ(q);
  }
  const theta = Math.acos(dot);
  const s = Math.sin(theta);
  const wa = Math.sin((1 - k) * theta) / s;
  const wb = Math.sin(k * theta) / s;
  return normalizeQ([ax * wa + bx * wb, ay * wa + by * wb,
                     az * wa + bz * wb, aw * wa + bw * wb]);
}

function normalizeQ(q) {
  const len = Math.hypot(q[0], q[1], q[2], q[3]);
  if (!(len > 0)) return [0, 0, 0, 1];
  return q.map(v => v / len);
}

// The engine's join law has no record of a cap the room side must advertise;
// the room's own 16-slot rule is netcode.js's MAX_PLAYERS, surfaced here so
// the lobby never offers a fuller room.
export { MAX_PLAYERS };
