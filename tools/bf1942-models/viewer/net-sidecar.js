// The sidecar wire seam: the same client surface `netcode-client.js` presents,
// sourced from the UDP sidecar instead of a room server.
//
// `net-room.js` joins a room by handing `createRoomClient` a WebSocket and then
// reading a fixed surface off it: the local slot, the roster, `remoteSlots()`,
// `remotePlayer(slot)`, `remoteVehicle(id)`, `teamOf`, `snapCount`, `action`,
// `sendInput`, `onevent`. The renderer (`netcode-render.js`) draws remotes from
// exactly that surface, and the reconciler reads the local player's row.
//
// A BF1942 server speaks none of that: it speaks the engine's ghost and event
// streams, which the sidecar (`tools/bf1942-models/sidecar/`) decodes and
// re-emits as the same bf42plus-v5 recording lines the replay viewer already
// parses. So this module keeps the room client's contract and changes only
// where the state comes from: v5 records in, room-shaped snapshots out, the
// engine's own PlayerAction back.
//
// Two pieces, deliberately separate:
//
//   createSidecarState()            pure, no socket: v5 record in, state out
//   createSidecarClient({ws, now})  the socket and the contract
//
// The pure half is what `tests/sidecar_client_harness.mjs` drives, the way the
// room client's own harness drives its protocol.
//
// WHAT THE SIDECAR SENDS, per WebSocket text frame, one JSON record:
//
//   {"k":"h","v":5,...}                       the recording header
//   {"k":"anim","states":[...]}               the engine's animation state table
//   {"k":"e","e":"createPlayer","pid":0,"name":"skandia","team":2,
//              "netId":1,"vehNetId":2,"camNetId":2}    roster and identity
//   {"k":"e","e":"control","pid":0,"netId":605}          what a player controls
//   {"k":"e","e":"enterVehicle","pid":0,"netId":560}     and when they board
//   {"k":"o","id":544,"tid":2790,"tmpl":"M3A1","team":0} an object's name
//   {"k":"s","t":108.03,"o":[[605,x,y,z,qx,qy,qz,qw],...]}  transforms
//   {"k":"st","t":108.03,"o":[[605,lower,upper,pitch,twist,item,bits],...]} states
//   {"k":"e","e":"score"|"chat"|...}          the event stream, as the page's feed
//
// WHAT THE PAGE SENDS BACK, binary frames, the room protocol's own type bytes
// so the page's input path is unchanged (netcode.js):
//
//   0x02 MSG_INPUT   u32le seq + the 17-byte action (encodeInput)
//   0x05 MSG_ACTION  JSON: {type:'radio'|'respawn'|...}
//   0x04 MSG_LEAVE   the page is done; the sidecar leaves the server
//
// The sidecar owns the connection to the server, so the page's `join` does not
// open a connection: it asks the sidecar to spawn the player and names them.

import {
  MSG_INPUT, MSG_ACTION, MSG_LEAVE,
  decodeInput, encodeInput,
} from './netcode.js';

// The engine's animation state names carry the stance, and the sidecar sends
// the engine's own table (the `anim` record), so the stance is read off the
// state's name the way the replay path reads it: a state whose name says lying
// is prone, one that says crouch is crouched. Kept as a prefix list so a mod's
// own table works without a per-mod rule.
const PRONE_RE = /(^|_)(Lb_)?(Lie|Lying|Crawl|SwimCrawl)/i;
const CROUCH_RE = /(^|_)(Lb_)?(Crouch|Kneel)/i;

const rad = (d) => (d * Math.PI) / 180;

/** `bf1942/levels/wake/` -> `wake`; a bare name passes through. */
export function levelName(path) {
  if (typeof path !== 'string') return path ?? null;
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : path;
}
const deg = (r) => (r * 180) / Math.PI;

// A unit quaternion [x,y,z,w] as the renderer wants it: yaw and pitch in
// degrees, YXZ with roll dropped (the snapshot has no roll field and
// netcode-render.js rebuilds the pose as Euler(pitch, yaw, 0, 'YXZ')).
export function yawPitchOf(q) {
  if (!q) return { yaw: 0, pitch: 0 };
  const [x, y, z, w] = q;
  const pitch = Math.asin(Math.max(-1, Math.min(1, 2 * (w * x - y * z))));
  const yaw = Math.atan2(2 * (w * y + x * z), 1 - 2 * (x * x + y * y));
  return { yaw: deg(yaw), pitch: deg(pitch) };
}

// A quaternion for a vehicle's pose, from the yaw and pitch the renderer draws
// soldiers from (Euler YXZ with roll 0, netcode-render.js's own construction).
export function quatFromYawPitch(yawDeg, pitchDeg) {
  const cy = Math.cos(rad(yawDeg) / 2), sy = Math.sin(rad(yawDeg) / 2);
  const cx = Math.cos(rad(pitchDeg) / 2), sx = Math.sin(rad(pitchDeg) / 2);
  return [cy * sx, sy * cx, -sy * sx, cy * cx];   // [x, y, z, w]
}

/**
 * A soldier's body yaw from his view-frame quaternion: the replay's own law
 * (replay-bodies.js: the soldier's yaw is that of q * SOLDIER_YAW_FLIP, a half
 * turn about Y), because a soldier's body walks along (sin yaw, 0, cos yaw)
 * while his quaternion's forward is -Z. Without the half turn the page's own
 * soldier, corrected to the server's yaw, walked backwards (live, 2026-10-16:
 * W moved him -z while the server walked him +z, the reconciler dragging him
 * along 2 m behind) and every remote soldier faced away from where he went.
 */
export function soldierYawPitch(q) {
  if (!q) return { yaw: 0, pitch: 0 };
  const { yaw, pitch } = yawPitchOf(q);
  let y = yaw + 180;
  if (y > 180) y -= 360;
  return { yaw: y, pitch };
}

/**
 * The pure state: feed it v5 records, read room-shaped state out. No socket, no
 * timers, no THREE.
 */
export function createSidecarState() {
  const st = {
    header: null,
    level: null,
    mod: null,
    server: null,
    animStates: null,
    roster: new Map(),      // slot -> {slot, pid, name, team, ai, netId, vehNetId}
    control: new Map(),     // pid -> netId the player controls (soldier or hull)
    boarded: new Map(),     // pid -> vehicle netId they are inside
    objects: new Map(),     // netId -> {tid, tmpl, team}
    xform: new Map(),       // netId -> {x,y,z,q,at}
    states: new Map(),      // netId -> {lower, upper, pitch, twist, item, bits}
    events: [],             // the event stream, newest last (bounded)
    hp: new Map(),          // netId -> hull hit points (k:"a")
    kits: new Map(),        // pid -> kit template (pickupKit)
    ack: 0,                 // the newest page input word the server has run
    tick: 0,
  };

  const slotOfPid = (pid) => (Number.isInteger(pid) ? pid + 1 : null); // rooms are 1..16, pids 0..
  const pidOfSlot = (slot) => (Number.isInteger(slot) ? slot - 1 : null);

  function pushEvent(row) {
    st.events.push(row);
    if (st.events.length > 500) st.events.shift();
  }

  function ingest(rec) {
    if (!rec || typeof rec !== 'object') return;
    switch (rec.k) {
      case 'h':
        st.header = rec;
        st.server = rec.name ?? st.server;
        return;
      case 'anim':
        st.animStates = Array.isArray(rec.states) ? rec.states : null;
        return;
      case 'o':
        st.objects.set(rec.id, { tid: rec.tid, tmpl: rec.tmpl ?? '', team: rec.team ?? 0 });
        return;
      case 's': {
        st.tick++;
        // The recording's frame is the engine's; the page's is the viewer's,
        // z negated (replay-kinematics.js toViewPosition/toViewQuaternion, the
        // conversion the replay draws through). Converted once, here, so the
        // renderer and the reconciler both read the page's own frame.
        for (const o of rec.o ?? []) {
          const [nid, x, y, z, qx, qy, qz, qw] = o;
          st.xform.set(nid, { x, y, z: -z, q: [-qx, -qy, qz, qw], at: rec.t });
        }
        return;
      }
      case 'd':
        // Out of this client's scope (ghost action 3): the server stopped
        // sending it, and the engine's client disables the object.
        st.xform.delete(rec.id);
        return;
      case 'ack':
        // The newest of the page's input words the server has run
        // (sidecar.mjs: the control-object state's serial echo, mapped back).
        if (Number.isInteger(rec.seq) && rec.seq > st.ack) st.ack = rec.seq;
        return;
      case 'a':
        for (const [nid, hp] of rec.a ?? []) st.hp.set(nid, hp);
        return;
      case 'st':
        for (const o of rec.o ?? []) {
          const [nid, lower, upper, pitch, twist, item, bits] = o;
          const prev = st.states.get(nid);
          st.states.set(nid, { lower, upper, pitch, twist, item, bits });
          // A soldier's round: his upper body entering a fire state (the
          // engine's own table names them, Ub_Fire, Ub_FireM1Garand, ...).
          // The server sends no shot event to a client; this is the replay's
          // reading of the same row.
          if (isFireState(upper) && !(prev && isFireState(prev.upper))) {
            const pid = pidControlling(nid);
            if (pid != null) pushEvent({ type: 'shot', slot: slotOfPid(pid), kit: st.kits.get(pid) ?? null });
          }
        }
        return;
      case 'f': {
        // A round from a vehicle's gun (ghost-writer.mjs: its magazine counter
        // stepping down), credited to whoever sits at it.
        const pid = Number.isInteger(rec.pid) ? rec.pid : null;
        pushEvent({ type: 'shot', slot: pid != null ? slotOfPid(pid) : null, vehicle: rec.id ?? null, alt: !!rec.alt, seat: true });
        return;
      }
      case 'e':
        return ingestEvent(rec);
      default:
        return;
    }
  }

  function ingestEvent(rec) {
    switch (rec.e) {
      case 'serverInfo': st.mod = rec.mod ?? st.mod; return;
      case 'serverName': st.server = rec.name ?? st.server; return;
      case 'setLevel': st.level = rec.level ?? st.level; return;
      case 'createObject':
        st.objects.set(rec.netId, { tid: rec.tid, tmpl: rec.tmpl ?? st.objects.get(rec.netId)?.tmpl ?? '', team: 0 });
        return;
      case 'createPlayer': {
        const slot = slotOfPid(rec.pid);
        if (slot == null) return;
        st.roster.set(slot, {
          slot, pid: rec.pid, name: rec.name ?? '', team: rec.team ?? 0,
          ai: !!rec.ai, netId: rec.netId, vehNetId: rec.vehNetId,
        });
        if (Number.isInteger(rec.vehNetId)) st.control.set(rec.pid, rec.vehNetId);
        pushEvent({ type: 'join', slot, text: rec.name ?? '', team: rec.team ?? 0, ai: !!rec.ai });
        return;
      }
      case 'destroyPlayer':
        st.roster.delete(slotOfPid(rec.pid));
        st.control.delete(rec.pid);
        st.boarded.delete(rec.pid);
        pushEvent({ type: 'leave', slot: slotOfPid(rec.pid) });
        return;
      case 'setTeam': {
        const slot = slotOfPid(rec.pid);
        const r = st.roster.get(slot);
        if (r) r.team = rec.team;
        return;
      }
      case 'control':
        if (Number.isInteger(rec.netId)) st.control.set(rec.pid, rec.netId);
        return;
      case 'enterVehicle':
        st.boarded.set(rec.pid, rec.netId);
        pushEvent({ type: 'seat', slot: slotOfPid(rec.pid), vehicle: rec.netId, entered: true });
        return;
      case 'exitVehicle':
        st.boarded.delete(rec.pid);
        pushEvent({ type: 'seat', slot: slotOfPid(rec.pid), entered: false });
        return;
      case 'score': {
        const row = { type: 'score', slot: slotOfPid(rec.pid), kind: rec.kind };
        if (rec.kind === 3 || rec.kind === 6) {
          row.type = 'killed';
          row.other = Number.isInteger(rec.victim) ? slotOfPid(rec.victim) : null;
          row.weapon = rec.weapon ?? null;
        }
        pushEvent(row);
        return;
      }
      case 'pickupKit': {
        const tmpl = st.objects.get(rec.netId)?.tmpl;
        if (tmpl) st.kits.set(rec.pid, tmpl);
        return;
      }
      case 'chat':
        pushEvent({ type: 'chat', slot: slotOfPid(rec.pid), text: rec.text ?? '' });
        return;
      case 'radio':
        pushEvent({ type: 'radio', slot: slotOfPid(rec.pid), msg: rec.msg });
        return;
      case 'gameStatus':
        pushEvent({ type: 'status', status: rec.status, text: rec.text ?? '' });
        return;
      default:
        return;
    }
  }

  // The hull a seat id belongs to. A gunner's seat is its own nested
  // PlayerControlObject with no createObject: its netId is the hull's plus the
  // seat's position (the sidecar's body-decoder.mjs seatOf, the replay's
  // rootOf), so the nearest named object below it is the hull.
  const MAX_SEATS = 12;
  function seatOf(netId) {
    if (!Number.isInteger(netId) || st.objects.has(netId)) return { root: netId, seat: 0 };
    for (let root = netId - 1; root >= netId - MAX_SEATS; root--) {
      const o = st.objects.get(root);
      if (o) return /soldier/i.test(o.tmpl || '') ? { root: netId, seat: 0 } : { root, seat: netId - root };
    }
    return { root: netId, seat: 0 };
  }

  // The engine's state table entry's name: the sidecar sends [index, name,
  // flags] rows, a bare name list works too.
  function stateName(i) {
    const e = st.animStates?.[i];
    return Array.isArray(e) ? (e[1] ?? '') : (e ?? '');
  }
  function isFireState(i) { return Number.isInteger(i) && /^Ub_(Lie|Crouch)?Fire/.test(stateName(i)); }
  function pidControlling(nid) {
    for (const [pid, n] of st.control) if (n === nid) return pid;
    return null;
  }

  // A state index names a stance through the engine's own table.
  function stanceOf(netId) {
    const s = st.states.get(netId);
    if (!s || !st.animStates) return { prone: false, crouch: false };
    const lower = stateName(s.lower);
    const upper = stateName(s.upper);
    return {
      prone: PRONE_RE.test(lower) || PRONE_RE.test(upper),
      crouch: CROUCH_RE.test(lower) || CROUCH_RE.test(upper),
    };
  }

  function playerRow(slot) {
    const r = st.roster.get(slot);
    if (!r) return null;
    const nid = st.control.get(r.pid);
    const xf = Number.isInteger(nid) ? st.xform.get(nid) : null;
    const inVehicle = st.boarded.has(r.pid);
    const { yaw, pitch } = soldierYawPitch(xf?.q);
    const stance = Number.isInteger(nid) ? stanceOf(nid) : { prone: false, crouch: false };
    return {
      slot,
      alive: !!xf,
      seated: inVehicle,
      inVehicle,
      crouch: stance.crouch,
      prone: stance.prone,
      swim: null,
      flight: null,
      team: r.team,
      x: xf?.x ?? 0, y: xf?.y ?? 0, z: xf?.z ?? 0,
      yaw, pitch,
      hp: null,                       // the sidecar does not carry hit points yet
      vehicleId: inVehicle ? seatOf(st.boarded.get(r.pid)).root : 0,
      seatIndex: inVehicle ? seatOf(st.boarded.get(r.pid)).seat : null,
      ack: st.ack,
    };
  }

  // The room snapshot's shape (netcode.js decodeSnapshot), rebuilt from what
  // the sidecar carries. tick is the sidecar's own transform-batch counter, the
  // page's only ordering signal.
  function snapshot() {
    const players = [];
    for (const slot of st.roster.keys()) {
      const row = playerRow(slot);
      if (row) players.push(row);
    }
    const vehicles = [];
    for (const [nid, obj] of st.objects) {
      const xf = st.xform.get(nid);
      if (!xf) continue;              // only objects the server has moved
      const { yaw, pitch } = yawPitchOf(xf.q);
      vehicles.push({ id: nid, x: xf.x, y: xf.y, z: xf.z, yaw, pitch, template: obj.tmpl, team: obj.team });
    }
    return { tick: st.tick, players, vehicles };
  }

  return {
    state: st,
    ingest,
    snapshot,
    playerRow,
    slotOfPid,
    pidOfSlot,
    reset() {
      st.roster.clear(); st.control.clear(); st.boarded.clear();
      st.objects.clear(); st.xform.clear(); st.states.clear(); st.events.length = 0;
      st.hp.clear(); st.ack = 0;
    },
  };
}

/**
 * The client `net-room.js` expects, over a WebSocket to the sidecar.
 *
 * The sidecar's frames are text (one JSON record each). Input goes back as the
 * room protocol's own binary frames, which the sidecar unwraps.
 */
export function createSidecarClient({ ws, now = null }) {
  const out = {};
  const pure = createSidecarState();
  const st = pure.state;

  out.hello = null;                 // shaped like the room's hello, for the page's reads
  out.slot = null;
  out.state = 'connecting';         // connecting | waiting | joined | closed
  out.feed = [];
  out.vehicles = new Map();         // id -> {id, template, team}
  out.onclosed = null;
  out.onerror = null;
  out.onjoined = null;
  out.onevent = null;
  out.onsnapshot = null;

  let seq = 0;
  out.sentActions = [];
  out.sentSeq = () => seq;

  // The local player is the sidecar's own: the page knows it by the name the
  // sidecar joined under (its header carries it). Waiting for that name
  // matters, because in a real capture the human's createPlayer arrives before
  // sidecar's, so adopting the first player would name the wrong slot. With no
  // name in the header, the first human is the best guess available.
  function adoptSlot() {
    const want = st.header?.name ?? null;
    const me = want
      ? ([...st.roster.values()].find((r) => r.name === want) ?? null)
      : ([...st.roster.values()].find((r) => !r.ai) ?? null);
    if (!me || out.slot === me.slot) return;
    out.slot = me.slot;
    out.hello = {
      // The server names the level by its path (`bf1942/levels/wake/`); the
      // page's maps are named by the folder, which is what the page compares.
      slot: me.slot, name: me.name, team: me.team, level: levelName(st.level), mod: st.mod,
      server: st.server, players: st.roster.size,
    };
    out.state = 'joined';
    if (out.onjoined) out.onjoined();
  }

  function refreshVehicles() {
    out.vehicles.clear();
    for (const [nid, obj] of st.objects) out.vehicles.set(nid, { id: nid, template: obj.tmpl, team: obj.team });
  }

  function apply(rec) {
    pure.ingest(rec);
    switch (rec.k) {
      case 'e':
        if (rec.e === 'createPlayer') adoptSlot();
        // The event stream, in the shape the page's feed and comms read.
        if (out.onevent) {
          const row = st.events[st.events.length - 1];
          if (row) out.onevent(row);
        }
        return;
      case 's':
        refreshVehicles();
        if (out.onsnapshot) out.onsnapshot(pure.snapshot(), rec.t ?? 0);
        return;
      default:
        return;
    }
  }

  out.handleMessage = (data) => {
    // The sidecar's frames are JSON text. A page may hand them on as text (the
    // usual case) or, if the socket was opened as an arraybuffer, as bytes.
    let text;
    if (typeof data === 'string') text = data;
    else if (data instanceof ArrayBuffer) text = new TextDecoder().decode(new Uint8Array(data));
    else if (ArrayBuffer.isView(data)) text = new TextDecoder().decode(data);
    else if (typeof Buffer !== 'undefined' && Buffer.isBuffer?.(data)) text = data.toString('utf8');
    else return;
    for (const line of text.split('\n')) {
      if (!line) continue;
      let rec; try { rec = JSON.parse(line); } catch { continue; }
      apply(rec);
    }
  };

  // --- the contract ------------------------------------------------------

  out.remotePlayer = (slot) => pure.playerRow(slot);

  out.remoteSlots = () => [...st.roster.keys()].filter((s) => s !== out.slot);

  out.teamOf = (slot) => st.roster.get(slot)?.team ?? 0;
  out.nameOf = (slot) => st.roster.get(slot)?.name ?? '';

  // A vehicle's pose, in the shape netcode-render.js reads: id, position, a
  // quaternion, and whether it is occupied. The renderer sets the group's
  // quaternion straight from `q` (a vehicle's root carries no baked turn), so
  // the quaternion is built from the same yaw and pitch the soldiers are drawn
  // from. The wire's yaw is mirrored relative to the viewer's frame, the same
  // handedness flip the soldier decoder applies by negating y, and the vehicle
  // decoders pass it through, so it is negated here to match.
  out.remoteVehicle = (id) => {
    const xf = st.xform.get(id);
    if (!xf) return null;
    return { id, x: xf.x, y: xf.y, z: xf.z, q: [...xf.q], occupied: true, hp: st.hp.get(id) ?? null };
  };

  out.snapCount = () => st.tick;

  out.selfPlayer = () => (out.slot != null ? pure.playerRow(out.slot) : null);

  /** One input word per world tick, exactly as the room client sends it. The
   *  sidecar wraps the 17 bytes in a PlayerAction block and sends it on. */
  out.sendInput = (input, look) => {
    if (out.state !== 'joined') return 0;
    seq += 1;
    const a = encodeInput(input, look);
    const frame = new Uint8Array(1 + 4 + a.length);
    frame[0] = MSG_INPUT;
    frame[1] = seq & 0xff; frame[2] = (seq >> 8) & 0xff;
    frame[3] = (seq >> 16) & 0xff; frame[4] = (seq >> 24) & 0xff;
    frame.set(a, 5);
    try { ws.send(frame); } catch { /* the socket's close handler reports it */ }
    return seq;
  };

  out.action = (row) => {
    out.sentActions.push({ ...row });
    if (out.sentActions.length > 64) out.sentActions.shift();
    const body = new TextEncoder().encode(JSON.stringify(row));
    const frame = new Uint8Array(1 + body.length);
    frame[0] = MSG_ACTION; frame.set(body, 1);
    try { ws.send(frame); } catch { /* as above */ }
  };

  out.radio = (msg, team) => out.action({ type: 'radio', msg, team: !!team });

  out.ping = () => {};              // the sidecar owns the connection's liveness

  /** Not a connection: the sidecar is already on the server. This asks it to
   *  spawn the page's player and carry the page's name and team. It must not
   *  un-join a client the sidecar's roster already joined. */
  out.join = ({ name = '', team = 0 } = {}) => {
    out.action({ type: 'join', name, team });
    if (out.state !== 'joined') out.state = 'waiting';
  };

  out.close = () => {
    try { ws.send(new Uint8Array([MSG_LEAVE])); } catch { /* nothing to leave */ }
    out.state = 'closed';
    try { ws.close(); } catch { /* the page's adapter handles it */ }
  };

  out.stats = () => ({ slot: out.slot, players: st.roster.size, objects: st.objects.size, snapshots: st.tick });

  return out;
}
