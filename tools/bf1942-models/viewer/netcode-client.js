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
// same action bytes it sends, and remote players are drawn the way the
// retail client draws every object it does not control (ledger P-2, P-6..P-9):
// from a 16-snapshot history stamped with the snapshot's own server tick, at
// the client's tick clock less `interpolationTime` (100 ms), the embracing
// pair interpolated, run on past the newest for up to `extrapolationTime`
// (1.2 s). The law's constants and clock are `ghost-draw.js`'s, shared with the
// relay seam (`net-relay.js`), and kept here so the page's renderer stays dumb.

import {
  MSG_JOIN, MSG_INPUT, MSG_PING, MSG_LEAVE, MSG_ACTION,
  MSG_HELLO, MSG_JOIN_SNAPSHOT, MSG_SNAPSHOT, MSG_EVENT, MSG_CLOSED, MSG_PONG,
  encodeInputFrame, decodeSnapshot, MAX_PLAYERS,
} from './netcode.js';
import {
  TRACK_SAMPLES, SERVER_TICK_HZ, RENDER_LOOKBACK_S, TRACK_MAX_GAP, EXTRAPOLATION_S,
  clientClockShift, followShift, extrapolateQ,
} from './ghost-draw.js';

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
  /** Snapshot history: {at, snap}, newest last, at most TRACK_SAMPLES (the
   *  engine's 16-record ring, P-3). `at` is the snapshot's server tick in
   *  seconds (`tick / 30`), never its arrival time (P-6). */
  let history = [];
  /** Page seconds to add to reach the client's tick clock (P-6: the newest
   *  snapshot's tick plus this page's words still in flight), filtered as the
   *  relay filters it (`followShift`). Null before the first snapshot. */
  let clockShift = null;
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

  /** A radio message (MSG_ACTION `{type: 'radio', msg, team}`): the server
   *  relays it to whoever should hear it. */
  out.radio = (msg, team) => out.action({ type: 'radio', msg, team: !!team });

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
    const arrived = now?.() ?? 0;
    const at = Number.isFinite(decoded.tick) ? decoded.tick / SERVER_TICK_HZ : arrived / 1000;
    // A round restart or a new room resets the tick: start the ring again.
    if (history.length && at < history[history.length - 1].at) history = [];
    history.push({ at, snap: decoded });
    if (history.length > TRACK_SAMPLES) history.splice(0, history.length - TRACK_SAMPLES);
    // The clock retail draws remotes by (P-6): the block's tick plus the words
    // this page has made that the authority has not yet run.
    const own = playerIn(decoded, out.slot);
    const acked = Number.isInteger(own?.ack) && own.ack > 0 ? own.ack : seq;
    const sample = clientClockShift({
      tick: decoded.tick, acked, sent: seq, pageNow: arrived / 1000,
    });
    clockShift = followShift(clockShift, sample ?? (at - arrived / 1000));
    if (out.onsnapshot) out.onsnapshot(decoded, arrived);
  }

  function onEvent(row) {
    if (!row || typeof row !== 'object') return;
    lastEvent = row;
    // The whole row rides through: every key a row type carries is the
    // page's to read (a round's result, a pad's spawn, a hull's damage), and
    // the common keys below are defaulted so a reader can test them bare.
    const feedRow = {
      ...row,
      t: row.t ?? 0,
      type: row.type,
      slot: row.slot ?? null,
      other: row.other ?? null,
      flag: row.flag ?? null,
      team: row.team ?? null,
      name: row.name ?? null,
      duration: row.duration ?? null,
      msg: row.msg ?? null,
      broadcast: row.broadcast ?? null,
      at: row.at ?? null,
      // A ticket row's count (`net-room.js` writes it into the level's
      // tickets) and a CTF row's event (`server/authority.mjs`: what
      // happened, who did it, where the flag now is; `ctf-page.js` `onRow`).
      count: row.count ?? null,
      kind: row.kind ?? null,
      player: row.player ?? null,
      position: row.position ?? null,
      text: feedText(row),
    };
    out.feed.push(feedRow);
    // Roster maintenance: join/leave rows carry names (the page labels
    // remotes with these).
    if (row.type === 'join' && Number.isInteger(row.slot)) {
      roster.set(row.slot, { slot: row.slot, name: row.text ?? '', team: 0 });
    } else if (row.type === 'leave' && Number.isInteger(row.slot)) {
      roster.delete(row.slot);
    } else if (row.type === 'team' && Number.isInteger(row.slot) && (row.team === 1 || row.team === 2)) {
      // A change of side on the deploy screen (`server/room-control.mjs`
      // `changeSide`, `GameServer::setTeam` 0x08131800).
      const entry = roster.get(row.slot);
      if (entry) entry.team = row.team;
      if (row.slot === out.slot && out.hello) out.hello.team = row.team;
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
      case 'killed': {
        if (row.cleared) return '';
        // Retail names what did it. The relay resolves the kill's weapon
        // template id against the level's own name table and sends it as
        // `weaponName`; without one the line stays as it was.
        const with_ = row.weaponName ? ` with ${row.weaponName}` : '';
        return row.other != null
          ? `${who(row.other) ?? '?'} killed ${who(row.slot) ?? '?'}${with_}`
          : `${who(row.slot) ?? '?'} died${with_}`;
      }
      case 'ticket': return `${team(row.team)} tickets: ${row.count}`;
      case 'captured': return `${team(row.team)} captured ${row.name ?? 'a flag'}`;
      case 'capturing': return `Capturing ${row.name ?? 'a flag'}`;
      case 'captureContested': return `${row.name ?? 'A flag'} is contested`;
      case 'captureCancelled': return `Capture of ${row.name ?? 'a flag'} was stopped`;
      case 'closed': return row.text ?? 'the room closed';
      // The message log prints radio lines itself (comms.js), and the CTF
      // lines (`ctf-page.js`, in the mod's words).
      case 'radio': return '';
      case 'ctf': return '';
      // The debriefing shows a round's end and the restart writes its own
      // line; a refused spawn is the spawn screen's business.
      case 'roundEnd': return '';
      case 'restart': return '';
      case 'spawnRefused': return '';
      case 'team': return '';
      case 'seatRefused': return '';
      // A remote's magazine change and stab are heard (`net-room.js`), not printed; nor
      // are the pads' and the hulls' rows, which the field itself shows.
      case 'reload': return '';
      case 'stab': return '';
      case 'padSpawn': return '';
      case 'vehicleGone': return '';
      case 'hull': return '';
      case 'object': return '';
      case 'blast': return '';
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
   *  {slot, x, y, z, yaw, pitch, alive, seated, crouch, prone, swim,
   *   inVehicle, vehicleId, seatIndex, hp, team} or null before the first
   *  snapshot. `swim` is the swim family (`netcode.js` `SWIM_WIRE`) or null. */
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

  /** The render time for page time `atMs` (default now): the client's tick
   *  clock less interpolationTime, in the snapshots' own seconds. */
  function drawTime(atMs) {
    const pageS = (atMs ?? now?.() ?? 0) / 1000;
    return pageS + (clockShift ?? 0) - RENDER_LOOKBACK_S;
  }

  /**
   * One object's drawn state at render time `t` from the history, retail's
   * `predict` (SimpleObjectNetworkable 0x08237a90, BFSoldierNetworkable
   * 0x08222e50, prediction mode 1): `get(snap)` picks the object's row out of
   * a snapshot, `mix(a, b, k, extrapolating)` blends two rows. Before the
   * oldest, the oldest; between two, the embracing pair when 0 < gap < 0.5 s
   * (a wider gap is a different appearance: the newer whole); past the
   * newest, the last pair carried on by `(t - newest) / gap` for at most 1.2 s
   * (`extrapolationTime`), then the newest held.
   */
  function sampleAt(get, mix, t) {
    const h = [];
    for (const e of history) {
      const row = get(e.snap);
      if (row) h.push({ at: e.at, row });
    }
    if (!h.length) return null;
    const newest = h[h.length - 1];
    if (h.length === 1) return newest.row;
    if (t >= newest.at) {
      const a = h[h.length - 2];
      const gap = newest.at - a.at, past = t - newest.at;
      if (!(gap > 0) || past > EXTRAPOLATION_S) return newest.row;
      return mix(a.row, newest.row, 1 + past / gap, true);
    }
    if (t <= h[0].at) return h[0].row;
    let i = h.length - 1;
    while (i > 0 && h[i - 1].at > t) i--;
    const a = h[i - 1], b = h[i];
    const gap = b.at - a.at;
    if (!(gap > 0 && gap < TRACK_MAX_GAP)) return b.row;
    return mix(a.row, b.row, (t - a.at) / gap, false);
  }

  function lerped(slot, at) {
    if (history.length === 0) return null;
    const newest = playerIn(history[history.length - 1].snap, slot);
    const drawn = sampleAt(snap => playerIn(snap, slot), blendPlayer, drawTime(at));
    if (!drawn) return null;
    // P-7: a soldier's states, state bits and held item are the NEWEST
    // record's whatever the render time; only his transform and aim ride the
    // clock.
    return newest ? { ...drawn, ...discreteOf(newest) } : drawn;
  }

  function lerpedVehicle(id, at) {
    if (history.length === 0) return null;
    const get = snap => snap?.vehicles?.find(v => v.id === id) ?? null;
    const newest = get(history[history.length - 1].snap);
    const v = sampleAt(get, (va, vb, k, past) => ({
      id,
      x: va.x + (vb.x - va.x) * k,
      y: va.y + (vb.y - va.y) * k,
      z: va.z + (vb.z - va.z) * k,
      q: past ? extrapolateQ(va.q, vb.q, k - 1) : slerpQ(va.q, vb.q, k),
      occupied: vb.occupied,
    }), drawTime(at));
    if (!v) return null;
    return {
      id, x: v.x, y: v.y, z: v.z, q: v.q,
      occupied: (newest ?? v).occupied,
    };
  }

  function playerIn(snap, slot) {
    return snap?.players?.find(p => p.slot === slot) ?? null;
  }

  /** The fields P-7 takes from the newest record, not the clock. */
  function discreteOf(p) {
    return {
      team: p.team ?? 0,
      alive: p.alive,
      seated: p.seated,
      crouch: p.crouch,
      prone: p.prone,
      swim: p.swim ?? null,
      // A blast's flight (`netcode.js` `FLIGHT_WIRE`), the newest word.
      flight: p.flight ?? null,
      inVehicle: p.inVehicle,
      hp: p.hp ?? null,
      vehicleId: p.vehicleId ?? 0,
      seatIndex: p.seatIndex ?? null,
    };
  }

  /** Two rows of one player blended at `k`. Past the newest (`past`) the
   *  position runs on and the facing and aim are held at the newest, as
   *  `BFSoldierNetworkable::predict` holds a soldier's rotation (P-7). */
  function blendPlayer(pa, pb, k, past = false) {
    const lerp = (x, y) => (Number.isFinite(x) && Number.isFinite(y) ? x + (y - x) * k : Number.isFinite(x) ? x : Number.isFinite(y) ? y : NaN);
    const hold = (x, y) => (Number.isFinite(y) ? y : x);
    return {
      ...discreteOf(pb),
      team: pb.team ?? pa.team ?? 0,
      hp: pb.hp ?? pa.hp ?? null,
      x: lerp(pa.x, pb.x), y: lerp(pa.y, pb.y), z: lerp(pa.z, pb.z),
      yaw: past ? hold(pa.yaw, pb.yaw) : lerp(pa.yaw, pb.yaw),
      pitch: past ? hold(pa.pitch, pb.pitch) : lerp(pa.pitch, pb.pitch),
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

/** Spherical lerp over a unit quaternion, shortest path: the embracing pair's
 *  rotation as `SimpleObjectNetworkable::predict` (0x08237a90) draws it with
 *  `BaseQuaternion::slerp` (P-2). Fallbacks: identity when either side is
 *  degenerate. */
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
