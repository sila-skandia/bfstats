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
//   {"k":"e","e":"projPool","tid":1286,"tmpl":"GrenadeAlliesProjectile",
//              "netId":579,"count":3}         a pool of the rounds the server flies
//   {"k":"f","t":9.5,"id":544,"pid":2,"w":"ShermanGunBarrel","p":[..],"d":[..]}
//                                             a round from a vehicle's gun
//   {"k":"e","e":"score"|"chat"|...}          the event stream, as the page's feed
//
// WHAT THE PAGE SENDS BACK, binary frames, the room protocol's own type bytes
// so the page's input path is unchanged (netcode.js):
//
//   0x02 MSG_INPUT   u32le seq + the 17-byte action (encodeInput)
//   0x05 MSG_ACTION  JSON: {type:'radio'|'chat'|'respawn'|...}
//   0x04 MSG_LEAVE   the page is done; the sidecar leaves the server
//
// The sidecar owns the connection to the server, so the page's `join` does not
// open a connection: it asks the sidecar to spawn the player and names them.

import { CHARACTER_HEIGHT } from './soldier-pose.js';
import {
  MSG_INPUT, MSG_ACTION, MSG_LEAVE,
  decodeInput, encodeInput,
} from './netcode.js';

// The medal counters' order on a BFPlayer (+0xe8, +0xec, +0xf0), round-state.js
// MEDALS; and how long the end game waits for the result rows (seconds).
const MEDAL_NAMES = ['gold', 'silver', 'bronze'];
const ROUND_END_SETTLE_S = 0.25;
// The named stats a k:"ps" row carries besides `sc` and `md`, as the sidecar's
// ghost-writer.mjs PLAYER_STATS writes them (kept in step by hand: the page
// imports nothing from the sidecar).
const PLAYER_STAT_KEYS = ['kills', 'deaths', 'teamKills', 'captures', 'attacks', 'defences',
  'objectives', 'objectiveTeamKills', 'ping'];

// The engine's animation state names carry the stance, and the sidecar sends
// the engine's own table (the `anim` record), so the stance is read off the
// state's name the way the replay path reads it: a state whose name says lying
// is prone, one that says crouch is crouched. Kept as a prefix list so a mod's
// own table works without a per-mod rule.
// A projectile pool's size, and how many pooled ids the page keeps named. A
// kit's pool is 1 to 9 rounds (the replay parser's own cap is 64); the table
// holds a few hundred live rounds of a long round without growing forever.
const MAX_POOL = 64;
const MAX_ROUNDS = 2048;

const PRONE_RE = /(^|_)(Lb_)?(Lie|Lying|Crawl|SwimCrawl)/i;
const CROUCH_RE = /(^|_)(Lb_)?(Crouch|Kneel)/i;

const rad = (d) => (d * Math.PI) / 180;

/** An `s` row's sample time in seconds: the server's tick, else (an older
 *  recording) the sidecar's arrival time. */
export const sampleTime = (rec) => (Number.isInteger(rec.tick) ? rec.tick / SERVER_TICK_HZ : rec.t);

// The retail client's ghost smoothing, SimpleObjectNetworkable::predict
// 0x08237a90 (BFSoldierNetworkable::predict 0x08222e50 is the same scheme),
// in its default mode (NetworkManager::globalPredictionMode 1, set at
// NetworkManager::NetworkManager 0x0842b570):
//   * every object is drawn at now - interpolationTime, 100 ms
//     (NetworkManager+0x44 = 0x64, console `interpolationTime`), between the
//     two received samples that embrace that time (findEmbracingIndices);
//   * a pair further apart than 500 ms is not interpolated;
//   * past the newest sample it extrapolates along the velocity of the last
//     two (delta position over delta ms / 1000), by that velocity times
//     (elapsed ms / extrapolationTime), for at most extrapolationTime, 1200 ms
//     (NetworkManager+0x48 = 0x4b0, console `extrapolationTime`), and then
//     holds the newest.
// The ring is 16 samples on the engine; a few cover a 100 ms delay.
const TRACK_SAMPLES = 4;
// The server's simulation rate: an `s` row's `tick` over this is the time its
// samples describe (the ghost block header's tick, 30 a second on the lab).
export const SERVER_TICK_HZ = 30;
export const RENDER_LOOKBACK_S = 0.100;
const TRACK_MAX_GAP = 0.500;
const EXTRAPOLATION_S = 1.200;

// Normalised lerp of two unit quaternions, the short way round.
function nlerpQ(a, b, k) {
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const s = d < 0 ? -1 : 1;
  const q = [0, 1, 2, 3].map((i) => a[i] + (s * b[i] - a[i]) * k);
  const n = Math.hypot(...q) || 1;
  return q.map((v) => v / n);
}

/** The server's mode file (setLevel's `coop.con`) as the viewer's game type,
 *  the name a level's layers are selected by (`game-modes.js`: `CoOp` plays
 *  the SinglePlayer layer). Null for one the viewer has no layer name for. */
const GAME_TYPE_OF_MODE = { coop: 'CoOp', conquest: 'Conquest', ctf: 'Ctf', tdm: 'Tdm' };
export function gameTypeOfMode(file) {
  if (typeof file !== 'string' || !file) return null;
  const base = file.split(/[\\/]/).pop().replace(/\.con$/i, '').toLowerCase();
  return GAME_TYPE_OF_MODE[base] ?? null;
}

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
// Degrees of view per unit of the twist register, in the page's yaw sense
// (BFSoldier::handleUpdate 0x08271f86 rotateYDeg(-3.0 x +0x288); the page's
// frame mirrors the engine's, which flips the sign).
export const VIEW_TWIST_DEG = 3;
// Degrees of view pitch per degree of the aim register (the body's aimA, the
// `st` row's pitch and the ack's `aim`): BFSoldier::handleUpdate 0x08271f68
// poses the camera rotateXDeg(-2.5 x +0x284), and a hand weapon's round leaves
// down that camera (ledger VIEW-14, XHIT-12). Taking the register as the view
// put the page's crosshair 2.5 times too near level: up a slope its rounds
// went over the head it aimed at (Wake, 2026-10-17).
export const VIEW_PITCH_PER_AIM = 2.5;
const wrapDeg = (d) => ((((d + 180) % 360) + 360) % 360) - 180;

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
    rounds: new Map(),      // netId -> {tid, tmpl}: a pooled projectile (projPool)
    xform: new Map(),       // netId -> {x,y,z,q,at}
    states: new Map(),      // netId -> {lower, upper, pitch, twist, item, bits}
    events: [],             // the event stream, newest last (bounded)
    pending: [],            // rows not yet handed to the page (createSidecarClient drains it)
    hp: new Map(),          // netId -> hull hit points (k:"a")
    kits: new Map(),        // pid -> kit template (pickupKit)
    cps: new Map(),         // control point netId -> side
    tickets: [null, null],  // both sides' tickets (k:"tk")
    joints: new Map(),      // root netId -> Map<part id, {name, q}> (k:"jn" / "j")
    ack: 0,                 // the newest page input word the server has run
    selfHp: null,           // {id, hp}: the local soldier's hit points, from the ack row
    selfAim: null,          // {id, pitch, twist, q, ack}: his aim register, twist and body (page frame) at the acked tick, from the ack row
    selfHull: null,         // {id, ack, x, y, z, q, v}: the driven hull's state at the acked tick, from the ack row
    killers: new Map(),     // victim pid -> {pid, weapon}: the kill row ahead of his death row
    track: new Map(),       // netId -> the last few transforms, for the render-time lerp
    clock: 0,               // the newest sample time (the sidecar's seconds)
    mePid: null,            // the sidecar's own player id (k:"me")
    status: null,           // the server's GameStatus (1 playing, 2 end, 3 pre-game)
    live: false,            // past the replay a connecting page is sent (k:"live")
    // The end of a round (ROUND-1, ROUND-5, ROUND-8, ROUND-9): the server's
    // ScoreManager result (k:"win": winner +0x5c, victory type +0x5d, rounds
    // won), each player's score and medal counters (k:"ps"), and the end game
    // the page is shown once per round (endAt: the status-2 row's time).
    result: { w: 0, vt: 4 },
    roundsWon: [0, 0],
    scores: new Map(),      // pid -> { sc, md: [gold, silver, bronze], kills, deaths, ping, ... } (k:"ps")
    medalRises: [],         // [{ t, pid, medal }]: a counter the server raised
    endAt: null,
    endSent: false,
    lastT: 0,               // the newest row time, the settle window's clock
    tick: 0,
    // BF42++'s server-made statics (wire.md section 30): what the server has
    // created, moved and deleted for this connection's level, by the server's
    // own id, and whether the level loads without its StaticObjects.con. The
    // page reconciles its copies against this (`server-statics.js`), so a
    // long replay or a capped event list never loses one. `version` moves on
    // every change.
    statics: { off: false, objects: new Map(), version: 0 },
  };

  const slotOfPid = (pid) => (Number.isInteger(pid) ? pid + 1 : null); // rooms are 1..16, pids 0..
  const pidOfSlot = (slot) => (Number.isInteger(slot) ? slot - 1 : null);

  function pushEvent(row) {
    st.events.push(row);
    if (st.events.length > 500) st.events.shift();
    st.pending.push(row);
    if (st.pending.length > 500) st.pending.shift();
  }

  function ingest(rec) {
    if (!rec || typeof rec !== 'object') return;
    if (Number.isFinite(rec.t) && rec.t > st.lastT) st.lastT = rec.t;
    switch (rec.k) {
      case 'h':
        st.header = rec;
        st.server = rec.name ?? st.server;
        return;
      case 'anim':
        st.animStates = Array.isArray(rec.states) ? rec.states : null;
        return;
      case 'o': {
        // A pooled round comes into scope nameless: the sidecar's objInfo is
        // filled from createObject alone, and a pool is announced by
        // CreateMultipleObjects (`projPool`), which names no object. Its
        // template and its class come from the pool it was allocated in, so
        // that it is drawn as a round and never bound as a vehicle.
        const round = st.rounds.get(rec.id);
        st.objects.set(rec.id, {
          tid: rec.tid || round?.tid || 0,
          tmpl: rec.tmpl || round?.tmpl || '',
          team: rec.team ?? 0,
          cls: rec.cls ?? (round ? 'Projectile' : null),
        });
        return;
      }
      case 's': {
        st.tick++;
        // The recording's frame is the engine's; the page's is the viewer's,
        // z negated (replay-kinematics.js toViewPosition/toViewQuaternion, the
        // conversion the replay draws through). Converted once, here, so the
        // renderer and the reconciler both read the page's own frame.
        // One convention for every consumer (the renderer, the reconciler,
        // the seat and hull code): a soldier's wire position is his object
        // origin, a metre over his feet (PHY-10), and the page stands every
        // soldier on his feet, so the lift comes off here, by class, once.
        // Samples are timed in the server's clock, the ghost block's tick, as
        // the retail client times them: by arrival they were 50 ms apart
        // while describing one and two ticks in turn, and a walking soldier
        // was drawn at double and half speed alternately (live, 2026-10-16).
        const at = sampleTime(rec);
        for (const o of rec.o ?? []) {
          const [nid, x, y, z, qx, qy, qz, qw] = o;
          const lift = isSoldier(nid) ? CHARACTER_HEIGHT : 0;
          const xf = { x, y: y - lift, z: -z, q: [-qx, -qy, qz, qw], at };
          st.xform.set(nid, xf);
          let h = st.track.get(nid);
          if (!h) { h = []; st.track.set(nid, h); }
          if (h.length && at <= h[h.length - 1].at) h.length = 0; // a clock step back: start over
          h.push(xf);
          if (h.length > TRACK_SAMPLES) h.shift();
        }
        if (Number.isFinite(at)) st.clock = at;
        return;
      }
      case 'd':
        // Out of this client's scope (ghost action 3): the server stopped
        // sending it, and the engine's client disables the object.
        st.xform.delete(rec.id);
        st.track.delete(rec.id);
        return;
      case 'win':
        // The ScoreManager's result bytes and rounds won (ghost-writer.mjs).
        st.result = { w: rec.w ?? 0, vt: rec.vt ?? 4 };
        if (Array.isArray(rec.rw)) st.roundsWon = [rec.rw[0] ?? 0, rec.rw[1] ?? 0];
        return;
      case 'ps': {
        // A player's score (+0xc0), his stat block's counters and ping (the
        // named fields, ghost-writer.mjs PLAYER_STATS) and medal counters
        // (+0xe8, +0xec, +0xf0): the server's own BFPlayer, the numbers the
        // retail score board prints (sidecar/ghost/player.mjs, THE STAT
        // BLOCK). giveMedal raises a counter at the end of a round (ROUND-9),
        // so a rise is this round's medal. A row from a sidecar older than the
        // named fields carries `sc` and `md` alone, and the rest stays.
        const prev = st.scores.get(rec.pid);
        const md = Array.isArray(rec.md) ? rec.md : [0, 0, 0];
        for (let i = 0; i < 3; i++) {
          if (md[i] > (prev?.md[i] ?? 0)) st.medalRises.push({ t: rec.t ?? st.lastT, pid: rec.pid, medal: MEDAL_NAMES[i] });
        }
        if (st.medalRises.length > 64) st.medalRises.splice(0, st.medalRises.length - 64);
        const next = { sc: rec.sc ?? prev?.sc ?? 0, md };
        for (const k of PLAYER_STAT_KEYS) next[k] = Number.isFinite(rec[k]) ? rec[k] : (prev?.[k] ?? 0);
        st.scores.set(rec.pid, next);
        return;
      }
      case 'tk':
        // Both sides' tickets from the server's ScoreManager: the page's ticket
        // rows (net-room.js writes extras.tickets from them).
        // Both sides on every change: a row the page could not take yet (its
        // level not loaded, the rows of the sidecar's replay at connect) is
        // made good by the next, and a side that never bleeds is still shown
        // (it stayed on the level's 100 while the server had it at 50).
        if (Array.isArray(rec.v) && (rec.v[0] !== st.tickets[0] || rec.v[1] !== st.tickets[1])) {
          for (let i = 0; i < 2; i++) {
            if (!Number.isFinite(rec.v[i])) continue;
            st.tickets[i] = rec.v[i];
            pushEvent({ type: 'ticket', team: i + 1, count: rec.v[i] });
          }
        }
        return;
      case 'jn':
        for (const [root, nid, name] of rec.o ?? []) {
          if (!st.joints.has(root)) st.joints.set(root, new Map());
          const m = st.joints.get(root);
          m.set(nid, { name, q: m.get(nid)?.q ?? [0, 0, 0, 1] });
        }
        return;
      case 'j':
        // BF1942's frame relative to the root; the page's is (-x, -y, z, w)
        // (replay-hulls.js: the map is a homomorphism).
        for (const [root, nid, qx, qy, qz, qw] of rec.o ?? []) {
          const part = st.joints.get(root)?.get(nid);
          if (part) part.q = [-qx, -qy, qz, qw];
        }
        return;
      case 'me':
        if (Number.isInteger(rec.pid)) st.mePid = rec.pid;
        return;
      case 'live':
        // The sidecar has replayed the session so far: what follows is now.
        st.live = true;
        return;
      case 'ack':
        // The newest of the page's input words the server has run
        // (sidecar.mjs: the control-object state's serial echo, mapped back).
        if (Number.isInteger(rec.seq) && rec.seq > st.ack) st.ack = rec.seq;
        if (Number.isFinite(rec.hp)) st.selfHp = { id: rec.id, hp: rec.hp };
        // His aim at that tick (sidecar.mjs): the register's pitch, the
        // twist and the body's rotation, the control state's own, so the
        // view the reconciler closes to is the one tick's (the ghost rows of
        // the same datagram arrive after the ack, the twist last of all).
        if (Number.isFinite(rec.aim)) {
          const q = Array.isArray(rec.q) && rec.q.length === 4 ? [-rec.q[0], -rec.q[1], rec.q[2], rec.q[3]] : null;
          st.selfAim = { id: rec.id, pitch: rec.aim, twist: Number.isFinite(rec.twist) ? rec.twist : null, q, ack: rec.seq };
        }
        // A driven hull's state at that tick (sidecar.mjs): position,
        // rotation and velocity, converted to the page's frame as the
        // transform rows are (z negated).
        if (Array.isArray(rec.hp3) && Array.isArray(rec.hq) && Array.isArray(rec.hv)) {
          const [x, y, z] = rec.hp3, [qx, qy, qz, qw] = rec.hq, [vx, vy, vz] = rec.hv;
          st.selfHull = { id: rec.id, ack: rec.seq, x, y, z: -z, q: [-qx, -qy, qz, qw], v: [vx, vy, -vz] };
        }
        return;
      case 'a':
        // A hull's hit points: the page's own damage pass draws the tiers
        // and the wreck from them (net-room.js applyHull, the 'hull' row).
        for (const [nid, hp] of rec.a ?? []) {
          st.hp.set(nid, hp);
          pushEvent({ type: 'hull', vehicle: nid, hp, destroyed: hp <= 0 });
        }
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
          const firing = isFireState(upper), was = !!(prev && isFireState(prev.upper));
          if (firing !== was) {
            const pid = pidControlling(nid);
            // The fire state holds for as long as an automatic weapon's
            // trigger is down (a live BAR: 1.8 s of Ub_FireBar1918), so the
            // page keeps firing until it ends ('shotEnd').
            if (pid != null) pushEvent(firing
              ? { type: 'shot', slot: slotOfPid(pid), kit: st.kits.get(pid) ?? null, hold: true }
              : { type: 'shotEnd', slot: slotOfPid(pid) });
          }
          // A stab: his upper body entering the alternate fire's state
          // (`Ub_AltFire<W>`, `Ub_LieAltFire<W>`). A knife's press enters its
          // hub and the hub hands to one of its numbered swings
          // (`Ub_AltFireCommandoKnife` -> `...3`, XPack2's client table), so
          // a press is an entry from outside the state, or back into a hub
          // from its swing, and the hand-over is not a second one.
          // A magazine change: his upper body entering a reload state. The
          // page drew nothing of it -- a retail player reloading beside you
          // stood still (live, 2026-10-17).
          if (isReloadState(upper) && !(prev && isReloadState(prev.upper))) {
            const pid = pidControlling(nid);
            if (pid != null) pushEvent({ type: 'reload', slot: slotOfPid(pid) });
          }
          if (isAltFireState(upper) && upper !== prev?.upper) {
            const name = stateName(upper);
            const from = prev && isAltFireState(prev.upper) ? stateName(prev.upper) : null;
            const pid = pidControlling(nid);
            if (pid != null && (!from || (from !== name && from.startsWith(name)))) {
              pushEvent({ type: 'stab', slot: slotOfPid(pid), kit: st.kits.get(pid) ?? null,
                          item: Number.isInteger(item) ? item : null });
            }
          }
        }
        return;
      case 'f': {
        // A round from a vehicle's gun (ghost-writer.mjs: its magazine counter
        // stepping down), credited to whoever sits at it.
        // Its gun's template name (`w`, ghost/children.mjs `gunFor`: a
        // Sherman's `ShermanGunBarrel`, a Stuka's `StukaBombRack`) and the
        // muzzle the round left from (`p`) down its axis (`d`), both in
        // BF1942's frame, UNCONVERTED: `replay-hulls.js recordedLaunch`,
        // which is what draws a recorded hull's round, negates z itself.
        // This is the only word a client gets that a vehicle's weapon fired
        // -- a seated player sends no soldier animation, and the page's other
        // 'shot' rows are read off that animation (the `st` case above).
        const pid = Number.isInteger(rec.pid) ? rec.pid : null;
        pushEvent({ type: 'shot', slot: pid != null ? slotOfPid(pid) : null, vehicle: rec.id ?? null,
                    alt: !!rec.alt, seat: true,
                    gun: rec.w ?? null,
                    pos: Array.isArray(rec.p) ? rec.p : null, dir: Array.isArray(rec.d) ? rec.d : null });
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
      // The sidecar lost the server (a kick, a ban, a shutdown): retail shows
      // this in its menu and the page showed nothing -- it sat connected to a
      // sidecar that was no longer on any server (live, 2026-10-17).
      case 'serverLeft':
        pushEvent({ type: 'closed',
                    text: rec.final
                      ? `Disconnected from the server: ${rec.name || rec.kind || 'connection lost'}`
                      : `Lost the server (${rec.name || rec.kind || 'connection lost'}), reconnecting` });
        return;
      case 'setLevel': {
        // The server (re)loading a level: a map change, a restart of the same
        // map (the lab's round restart), or the world resent to a sidecar
        // that reconnected. Every object, player and score of the old world
        // is gone, and the server resends the world dump behind this event,
        // so the state starts over here whatever the reason. The page is told
        // only once the feed is live: the replay a page gets on connecting
        // runs through every earlier load, and those are history.
        const prev = st.level;
        if (prev != null) resetWorld();
        st.level = rec.level ?? st.level;
        st.modeFile = rec.mode ?? st.modeFile ?? null;
        st.status = null;
        st.endAt = null; st.endSent = false;
        // A new load: the server sends this level's statics again, and says
        // again (or not) that StaticObjects.con stays out (bf42++'s switch
        // rides the load, sidecar.mjs marks the setLevel row `statics: 0`).
        st.statics.objects.clear();
        st.statics.off = rec.statics === 0;
        st.statics.version++;
        if (prev != null && st.live) {
          pushEvent({ type: 'levelChange', level: levelName(st.level), mode: gameTypeOfMode(rec.mode),
                      same: levelName(prev) === levelName(st.level) });
        }
        return;
      }
      case 'createStatic': {
        // CreateStaticObjectEvent: an id the server already used replaces
        // that object (bf42plus object.cpp:102 addStaticObject). The scale is
        // read and never applied by the client; kept for the record.
        if (!Number.isInteger(rec.id)) return;
        st.statics.objects.set(rec.id, {
          id: rec.id, tid: rec.tid ?? null, tmpl: rec.tmpl ?? '',
          pos: Array.isArray(rec.pos) ? rec.pos : null, rot: Array.isArray(rec.rot) ? rec.rot : null,
          rev: ++st.statics.version,
        });
        return;
      }
      case 'updateStatic': {
        // UpdateStaticObjectEvent (gameevent.cpp:192-224): move sets the
        // position, rotate the rotation (position kept), scale does nothing,
        // delete removes it; an unknown id is ignored.
        const o = st.statics.objects.get(rec.id);
        if (!o) return;
        if (rec.action === 'delete') { st.statics.objects.delete(rec.id); st.statics.version++; return; }
        if (rec.action === 'move' && Array.isArray(rec.value)) o.pos = rec.value;
        else if (rec.action === 'rotate' && Array.isArray(rec.value)) o.rot = rec.value;
        else return;
        o.rev = ++st.statics.version;
        return;
      }
      case 'hudText':
        // HUDTextEvent: the server's own line in one of four HUD places. The
        // page has none of them; the line goes to the feed and the console.
        if (rec.text) pushEvent({ type: 'hudText', kind: rec.kind ?? 0, text: String(rec.text) });
        return;
      case 'projPool': {
        // CreateMultipleObjects (the server's 0x05): one projectile template,
        // `count` objects, consecutive netIds from `netId`. It is how every
        // round the server flies reaches a client -- a kit's grenades, mines
        // and packs, and the shells, bombs and rockets a hull launches -- and
        // the only word a client gets that they exist. The objects themselves
        // are never announced (no createObject), so without this the page saw
        // transform rows for ids it had nothing for and drew nothing: no
        // bomb, shell or remote grenade on the live page (2026-10-17).
        //
        // A pooled round waits at the origin, disabled, and is somewhere only
        // once it is thrown, laid or launched (replay-props.js, AT_ORIGIN);
        // its poses then arrive through the ordinary transform path, by netId,
        // like any other object's. So the pool is an identity table, and the
        // drawing reads the same `xfAt` as everything else.
        if (!Number.isInteger(rec.netId) || !(rec.count > 0)) return;
        const n = Math.min(rec.count, MAX_POOL);
        const tmpl = rec.tmpl ?? '';
        const tid = rec.tid ?? 0;
        for (let i = 0; i < n; i++) {
          const nid = rec.netId + i;
          st.rounds.delete(nid);              // a reallocated id keeps its place at the end
          st.rounds.set(nid, { tid, tmpl });
          const o = st.objects.get(nid);
          if (o) { o.cls = 'Projectile'; if (!o.tmpl) o.tmpl = tmpl; if (!o.tid) o.tid = tid; }
        }
        // A round's pool goes with the kit that carried it and the server
        // allocates fresh ids, so the table is bounded rather than tidied.
        while (st.rounds.size > MAX_ROUNDS) st.rounds.delete(st.rounds.keys().next().value);
        pushEvent({ type: 'projPool', netId: rec.netId, count: n, tmpl, tid });
        return;
      }
      case 'createObject':
        st.objects.set(rec.netId, { tid: rec.tid, tmpl: rec.tmpl ?? st.objects.get(rec.netId)?.tmpl ?? '', team: 0, cls: st.objects.get(rec.netId)?.cls ?? null });
        // On the field: the page stands its copy (a real server has no pad
        // rows; the object's existence is the word).
        pushEvent({ type: 'padSpawn', vehicle: rec.netId });
        return;
      case 'destroyObject':
        // Everyone the hull took with it leaves their seat. `playerRow` reads
        // `alive: !!xf || inVehicle`, so a pid left boarded on a hull that no
        // longer exists is a player the page draws alive and seated in
        // nothing, for the rest of the round. Resolved before the object goes,
        // because `seatOf` reads the object table to find a seat's root.
        for (const [pid, seatNetId] of [...st.boarded]) {
          if (seatOf(seatNetId).root === rec.netId) st.boarded.delete(pid);
        }
        for (const [pid, nid] of [...st.control]) if (nid === rec.netId) st.control.delete(pid);
        st.objects.delete(rec.netId);
        st.xform.delete(rec.netId);
        st.track.delete(rec.netId);
        st.rounds.delete(rec.netId);
        pushEvent({ type: 'vehicleGone', vehicle: rec.netId });
        return;
      case 'createPlayer': {
        const slot = slotOfPid(rec.pid);
        if (slot == null) return;
        st.roster.set(slot, {
          slot, pid: rec.pid, name: rec.name ?? '', team: rec.team ?? 0,
          ai: !!rec.ai, netId: rec.netId, vehNetId: rec.vehNetId,
          // The kit he holds when this client joins: a player already alive
          // in the world dump picked his up before we were here to see it.
          kitNetId: rec.kitNetId || null,
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
        // The server's ScoreEvent names the scorer: a kill (3, a team kill 6)
        // is the KILLER's, with the victim beside it; a death (4) is the dead
        // player's own, and every death has one, killed or not (a fall, a
        // suicide, a wreck). The page's 'killed' row is the room's shape:
        // `slot` is the one who died, `other` who killed him. Reading the
        // kill row as the victim's left a sidecar player shot dead on the
        // server crawling on the page (live, 2026-10-16).
        if (rec.kind === 3 || rec.kind === 6) {
          // `weaponName` is the template the sidecar resolved the row's
          // weapon id to (sidecar.mjs, the level's tidNames): the word the
          // message log prints after "killed" (netcode-client.js).
          if (Number.isInteger(rec.victim)) st.killers.set(rec.victim, { pid: rec.pid, weapon: rec.weapon ?? null, weaponName: rec.weaponName ?? null });
          pushEvent({ type: 'score', slot: slotOfPid(rec.pid), kind: rec.kind });
          return;
        }
        // Kind 4 is a death and kind 5 is a death without a message
        // (bf42plus's ScoreEventID names, features/server-replay-recorder/
        // src/core.c handleScore): both end a player, and the message is the
        // only difference. Reading 4 alone dropped more deaths than it kept
        // -- 29 kind-5 rows against 19 kind-4 in one El Alamein round -- and
        // the page's own kind-5 death left it alive in a seat it had been
        // shot out of (live, 2026-10-17).
        if (rec.kind === 4 || rec.kind === 5) {
          const by = st.killers.get(rec.pid);
          st.killers.delete(rec.pid);
          st.selfHp = null; st.selfAim = null; st.selfHull = null;
          // A death ends the seat as surely as an exitVehicle does, and the
          // server sends no exit for a man shot out of one: left boarded, a
          // dead player reads `alive` through `inVehicle` forever.
          st.boarded.delete(rec.pid);
          pushEvent({ type: 'killed', slot: slotOfPid(rec.pid),
                      other: by ? slotOfPid(by.pid) : null, weapon: by?.weapon ?? null,
                      weaponName: by?.weaponName ?? null });
          return;
        }
        pushEvent({ type: 'score', slot: slotOfPid(rec.pid), kind: rec.kind });
        return;
      }
      case 'cp': {
        // A control point's side from the server. The first report is how the
        // round stands as this client joins (quiet: the page sets its flags,
        // nobody announces it); a change after that is a capture.
        const before = st.cps.get(rec.id);
        st.cps.set(rec.id, rec.team);
        if (before === rec.team) return;
        pushEvent({ type: 'captured', cp: rec.tmpl ?? rec.name ?? null, team: rec.team, quiet: before === undefined });
        return;
      }
      case 'pickupKit': {
        const tmpl = st.objects.get(rec.netId)?.tmpl;
        if (tmpl) st.kits.set(rec.pid, tmpl);
        return;
      }
      case 'chat':
        // A line as typed (sidecar/chat.mjs): `team` is the sender's side only,
        // `server` the server's own line, which names nobody (pid -1).
        pushEvent({ type: 'chat', slot: rec.pid >= 0 && !rec.server ? slotOfPid(rec.pid) : null,
                    text: rec.text ?? '', team: !!rec.team, server: !!rec.server });
        return;
      case 'radio':
        pushEvent({ type: 'radio', slot: slotOfPid(rec.pid), msg: rec.msg });
        return;
      case 'hitFrom':
        // `HitFromPosEvent` (0x3c): the server's `_giveDamage` sends it to a
        // hurt player on a remote client, with the octant 0..7 and the alpha
        // as a byte. The retail receiver (BF1942.exe 0x00494dc3) calls
        // `BfMenu::setHitFromDir(octant + 1, byte * 0.003921569)` and nothing
        // else (ledger HFD-1..HFD-3).
        if (!Number.isInteger(rec.dir) || !Number.isFinite(rec.strength)) return;
        pushEvent({ type: 'hitFrom', dir: (rec.dir & 7) + 1,
                    alpha: Math.fround(Math.fround(rec.strength) * Math.fround(0.003921569)) });
        return;
      case 'gameStatus': {
        // The end game opens on status 2 (and 5, the end of a map, comes
        // between two 2s); the debriefing waits out the settle window for the
        // result and the medals, which ride the ghost stream behind the event.
        // Pre-game or play closes it: a round still unsettled is told first.
        if ((rec.status === 2 || rec.status === 5) && st.endAt == null && !st.endSent) st.endAt = rec.t ?? st.lastT;
        if (rec.status === 1 || rec.status === 3) { settleRoundEnd(true); st.endAt = null; st.endSent = false; }
        pushEvent({ type: 'status', status: rec.status, text: rec.text ?? '' });
        // GameStatus 1 playing, 2 end of round, 3 pre-game. A round that ends
        // and goes back to pre-game without a level load is the same map
        // restarted (the server clears and resends the world between the
        // two, and the tickets go back to the start): the page restarts its
        // round as it does for a load (the setLevel case above).
        const prev = st.status;
        st.status = rec.status;
        if (rec.status === 3 && prev === 2 && st.live) {
          pushEvent({ type: 'levelChange', level: levelName(st.level), mode: null, same: true });
        }
        return;
      }
      default:
        return;
    }
  }

  /**
   * The server's end of a round, as the room's `roundEnd` row (net-room.js
   * hands it to the page's `roomRoundEnd`, which opens the debriefing and
   * plays the cue for the local side, round-end.js). Sent once per round, a
   * settle window after the status-2 row so that the ScoreManager's winner
   * and victory type (sent the same tick, 3 ms behind on the lab) and the
   * medals (up to 50 ms either side) have landed; `force` sends it at once
   * (the status moved on). A draw sends no result bytes (both stay 0 from
   * `reset`), which is the draw the 0 / 0 already reads as. Only once the
   * feed is live: the replay a page gets on connecting is history.
   */
  function settleRoundEnd(force = false) {
    if (st.endAt == null || st.endSent || !st.live) return;
    if (!force && !(st.lastT >= st.endAt + ROUND_END_SETTLE_S)) return;
    st.endSent = true;
    const since = st.endAt - ROUND_END_SETTLE_S;
    const medals = st.medalRises
      .filter((m) => m.t >= since)
      .map((m) => {
        const slot = slotOfPid(m.pid);
        return { slot, team: st.roster.get(slot)?.team ?? 0, medal: m.medal, score: st.scores.get(m.pid)?.sc ?? 0 };
      })
      .sort((a, b) => MEDAL_NAMES.indexOf(a.medal) - MEDAL_NAMES.indexOf(b.medal));
    pushEvent({
      type: 'roundEnd', winner: st.result.w, victoryType: st.result.vt, reason: 'server',
      roundsWon: { 1: st.roundsWon[0], 2: st.roundsWon[1] }, medals,
    });
  }

  // A soldier object, by the networkable class the sidecar decoded it with
  // (its k:"o" row's cls); a feed without the class falls back on the name.
  function isSoldier(nid) {
    const o = st.objects.get(nid);
    if (o?.cls) return o.cls === 'BFSoldierNetworkable';
    return /soldier/i.test(o?.tmpl ?? '');
  }

  // The hull a seat id belongs to. A gunner's seat is its own nested
  // PlayerControlObject with no createObject: its netId is the hull's plus the
  // seat's position (the sidecar's body-decoder.mjs seatOf, the replay's
  // rootOf), so the nearest named object below it is the hull.
  const MAX_SEATS = 12;
  function seatOf(netId) {
    // A seat is never a hull: one that reached the page as an object of its
    // own (class Seat, no template) is still found under its root.
    if (!Number.isInteger(netId) || (st.objects.has(netId) && st.objects.get(netId).cls !== 'Seat')) return { root: netId, seat: 0 };
    for (let root = netId - 1; root >= netId - MAX_SEATS; root--) {
      const o = st.objects.get(root);
      if (o?.cls === 'Seat') continue;    // another seat of the same hull
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
  function isAltFireState(i) { return Number.isInteger(i) && /^Ub_(Lie)?AltFire/.test(stateName(i)); }
  // The magazine change: the engine's own `Ub_StandReload` / `Ub_LieReload`
  // (the two states `soldier-actions.js` plays on a bot).
  function isReloadState(i) { return Number.isInteger(i) && /^Ub_(Stand|Lie|Crouch)?Reload/.test(stateName(i)); }
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

  // Every ghosted object is drawn from its decoded state the same way, the
  // retail client's (the constants above): interpolated between the samples
  // that embrace the render time, extrapolated a little past the newest.
  // `t` is in the sidecar's clock; null is the newest sample, un-lerped (the
  // reconciler and the seat code read the wire, never the blend).
  function xfAt(nid, t = null) {
    const h = st.track.get(nid);
    if (t == null || !h || h.length < 2) return st.xform.get(nid) ?? null;
    if (t >= h[h.length - 1].at) {
      const b = h[h.length - 1], a = h[h.length - 2];
      const gap = b.at - a.at, past = t - b.at;
      if (!(gap > 0) || past > EXTRAPOLATION_S) return b;
      const k = past / EXTRAPOLATION_S / gap;   // v = (b - a) / gap, times past / 1.2 s
      return { x: b.x + (b.x - a.x) * k, y: b.y + (b.y - a.y) * k, z: b.z + (b.z - a.z) * k, q: b.q, at: t };
    }
    if (t <= h[0].at) return h[0];
    let i = h.length - 1;
    while (i > 0 && h[i - 1].at > t) i--;
    const a = h[i - 1], b = h[i];
    // A gap longer than a scope-out-and-back is a different appearance, not
    // a motion: hold the newer sample rather than sweep across the map.
    if (b.at - a.at > TRACK_MAX_GAP) return b;
    const k = (t - a.at) / (b.at - a.at);
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k,
             q: nlerpQ(a.q, b.q, k), at: t };
  }

  /** Whether an object is one the page draws as a vehicle: not a seat (drawn
   *  as part of its hull) and not a pooled round (drawn by `serverRounds`,
   *  which would otherwise be bound to a parked level node by its template). */
  function isHull(obj) {
    return obj.cls !== 'Seat' && obj.cls !== 'Projectile';
  }

  /**
   * Every pooled round the server is sending a pose for, at render time `t`:
   * `{ id, tmpl, x, y, z, q }` in the page's frame. An idle round sits at the
   * world origin in its pool, which is the caller's test for "somewhere"
   * (`net-server-rounds.js`, the replay's `replay-props.js` AT_ORIGIN).
   */
  function roundRows(t = null) {
    const out = [];
    for (const [nid, r] of st.rounds) {
      const xf = xfAt(nid, t);
      if (!xf) continue;
      out.push({ id: nid, tmpl: r.tmpl, x: xf.x, y: xf.y, z: xf.z, q: [...xf.q] });
    }
    return out;
  }

  // The old world, gone with a level load: everything the server will resend.
  function resetWorld() {
    st.roster.clear(); st.control.clear(); st.boarded.clear(); st.objects.clear();
    st.rounds.clear();
    st.xform.clear(); st.track.clear(); st.states.clear(); st.hp.clear(); st.kits.clear();
    st.cps.clear(); st.joints.clear(); st.killers.clear();
    st.tickets = [null, null]; st.selfHp = null; st.selfAim = null; st.selfHull = null;
    st.scores.clear(); st.medalRises.length = 0;
  }

  /** A roster player's numbers as the server keeps them (k:"ps"): the score
   *  board's score, kills, deaths and ping, and the rest of his stat block.
   *  A player the roster holds but no row has named yet has the zeroes the
   *  server's own resetStats leaves (a body equal to its baseline writes no
   *  row); a slot the roster does not hold is null. */
  function statsOf(slot) {
    const r = st.roster.get(slot);
    if (!r) return null;
    const s = st.scores.get(r.pid);
    const out = { score: s?.sc ?? 0, medals: [...(s?.md ?? [0, 0, 0])] };
    for (const k of PLAYER_STAT_KEYS) out[k] = s?.[k] ?? 0;
    return out;
  }

  function playerRow(slot, t = null) {
    const r = st.roster.get(slot);
    if (!r) return null;
    const nid = st.control.get(r.pid);
    const inVehicle = st.boarded.has(r.pid);
    // In a hull the soldier is not sent (his own object rides it); he is
    // alive and where the hull is.
    const hullXf = inVehicle ? xfAt(seatOf(st.boarded.get(r.pid)).root, t) : null;
    const footXf = Number.isInteger(nid) ? xfAt(nid, t) : null;
    const xf = inVehicle ? (hullXf ?? footXf) : footXf;
    const { yaw, pitch } = soldierYawPitch(xf?.q);
    const stance = Number.isInteger(nid) ? stanceOf(nid) : { prone: false, crouch: false };
    // The body yaw is not where a standing soldier looks: the look turns the
    // twist register (BFSoldier+0x288, the body's aimB, `st` twist) and
    // handleUpdate draws the view rotateYDeg(-3 x twist) off the body; moving
    // folds the twist into the body. Live: a standing turn left the twist at
    // -14 and the first moving tick turned the body 42 degrees.
    // The local player's own, at the acked tick, when the ack carries it
    // (sidecar.mjs): the body and the twist of one control state. The ghost
    // rows are a datagram behind it here (the ack goes first, the `st` row
    // last), and a standing turn measured against that stale twist took the
    // turn back off the page's view and left it there until the next row:
    // the page aimed on the target while the server's view sat a look step
    // (7 degrees) off it (Wake, 2026-10-17).
    const acked = st.selfAim && st.selfAim.id === nid && st.selfAim.ack === st.ack && !inVehicle ? st.selfAim : null;
    const twist = acked && acked.twist != null ? acked.twist
      : Number.isInteger(nid) && !inVehicle ? (st.states.get(nid)?.twist ?? 0) : 0;
    const bodyYaw = acked?.q ? soldierYawPitch(acked.q).yaw : yaw;
    const viewYaw = xf ? wrapDeg(bodyYaw + VIEW_TWIST_DEG * twist) : null;
    return {
      slot,
      alive: !!xf || inVehicle,
      seated: inVehicle,
      inVehicle,
      crouch: stance.crouch,
      prone: stance.prone,
      swim: null,
      flight: null,
      team: r.team,
      // The kit template he picked up (PickupKitEvent): his primary and his
      // worn parts on the page (netcode-render.js soldierAssets).
      kit: st.kits.get(r.pid) ?? (r.kitNetId ? st.objects.get(r.kitNetId)?.tmpl || null : null),
      x: xf?.x ?? 0, y: xf?.y ?? 0, z: xf?.z ?? 0,
      yaw, pitch, viewYaw,
      // His aim register in degrees (the body's aimA, the `st` row's pitch);
      // his view and his rounds pitch VIEW_PITCH_PER_AIM times it.
      aim: Number.isInteger(nid) ? (st.states.get(nid)?.pitch ?? 0) : 0,
      // The local player's own hit points come with the server's ack (the
      // control state's soldier body); another player's are not sent.
      hp: st.selfHp && st.selfHp.id === nid ? st.selfHp.hp : null,
      // And his view pitch as the server had it at the acked tick (degrees,
      // up positive, the page's own sense), which the reconciler closes to:
      // the register through the camera's x2.5.
      viewPitch: st.selfAim && st.selfAim.id === nid && st.selfAim.ack === st.ack ? st.selfAim.pitch * VIEW_PITCH_PER_AIM : null,
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
      if (!isHull(obj)) continue;   // a seat is drawn with its hull, a round by `serverRounds`
      const xf = st.xform.get(nid);
      if (!xf) continue;              // only objects the server has moved
      const { yaw, pitch } = yawPitchOf(xf.q);
      vehicles.push({ id: nid, x: xf.x, y: xf.y, z: xf.z, yaw, pitch, template: obj.tmpl, team: obj.team });
    }
    return { tick: st.tick, players, vehicles };
  }

  return {
    state: st,
    ingest(rec) { ingest(rec); settleRoundEnd(); },
    settleRoundEnd,
    snapshot,
    playerRow,
    statsOf,
    xfAt,
    seatRoot: (nid) => seatOf(nid).root,
    roundRows,
    isHull,
    slotOfPid,
    pidOfSlot,
    reset() {
      st.roster.clear(); st.control.clear(); st.boarded.clear();
      st.objects.clear(); st.rounds.clear();
      st.xform.clear(); st.track.clear(); st.states.clear(); st.events.length = 0;
      st.hp.clear(); st.ack = 0; st.killers.clear();
      st.statics.objects.clear(); st.statics.off = false; st.statics.version++;
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
  const clock = now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const out = {};
  const pure = createSidecarState();
  const st = pure.state;

  out.hello = null;                 // shaped like the room's hello, for the page's reads
  /** BF42++'s server-made statics and the StaticObjects.con switch for the
   *  level being played (`st.statics`, read by `server-statics.js`). */
  out.serverStatics = () => st.statics;
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
    // The sidecar names its player by id (k:"me"); the name is the fallback
    // for a feed without it, and a weak one: a server still holding a dropped
    // connection's player gives the new one "<name>_1".
    const want = st.header?.name ?? null;
    const me = (st.mePid != null ? st.roster.get(pure.slotOfPid(st.mePid)) : null)
      ?? (want
        ? ([...st.roster.values()].find((r) => r.name === want) ?? null)
        : ([...st.roster.values()].find((r) => !r.ai) ?? null));
    if (!me || out.slot === me.slot) return;
    out.slot = me.slot;
    out.hello = {
      // The server names the level by its path (`bf1942/levels/wake/`); the
      // page's maps are named by the folder, which is what the page compares.
      slot: me.slot, name: me.name, team: me.team, level: levelName(st.level), mod: st.mod,
      server: st.server, players: st.roster.size,
      // The server's game type, so the page plays its layer: a co-op server
      // plays the level's SinglePlayer layer, and a page on the default
      // Conquest one had Midway's whole fleet 1350 m from the server's
      // (2026-10-16). Conquest is every level's default layer.
      mode: gameTypeOfMode(st.modeFile),
      modeDefault: !gameTypeOfMode(st.modeFile) || gameTypeOfMode(st.modeFile) === 'Conquest',
    };
    out.state = 'joined';
    if (out.onjoined) out.onjoined();
  }

  // Kept entry by entry, not rebuilt: the page caches what it learns about a
  // vehicle on its entry (net-room.js binds each to its parked copy once).
  function refreshVehicles() {
    for (const [nid, obj] of st.objects) {
      // A seat is part of its hull, and a pooled round is drawn by
      // `net-server-rounds.js`: neither is a vehicle the page binds to a
      // parked level node by its template.
      if (!pure.isHull(obj)) continue;
      const v = out.vehicles.get(nid);
      if (v) { v.template = obj.tmpl; v.team = obj.team; } else out.vehicles.set(nid, { id: nid, template: obj.tmpl, team: obj.team, live: true, fresh: false });
    }
    for (const nid of out.vehicles.keys()) if (!st.objects.has(nid)) out.vehicles.delete(nid);
  }

  let endTimer = null;
  function apply(rec) {
    pure.ingest(rec);
    if (rec.k === 's') followServerClock(clock() / 1000 - st.clock);
    if ((rec.k === 'e' && rec.e === 'createPlayer') || rec.k === 'me') adoptSlot();
    if (rec.k === 'e' || rec.k === 'o' || rec.k === 'a') refreshVehicles();
    // (k:"tk" rows produce 'ticket' rows; drained below with the rest.)
    // Every row the record produced, in the shape the page's feed, comms and
    // hull sync read (a transform batch can carry several, a hit-point row
    // one per hull).
    const rows = st.pending.splice(0);
    if (out.onevent) for (const row of rows) out.onevent(row);
    // The end game's rows can stop with the field cleared (Wake, 2026-10-16:
    // 2.2 s with no row after status 2), so the settle window also runs on
    // the page's clock.
    if (st.endAt != null && !st.endSent && st.live && !endTimer && typeof setTimeout === 'function') {
      endTimer = setTimeout(() => {
        endTimer = null;
        pure.settleRoundEnd(true);
        const late = st.pending.splice(0);
        if (out.onevent) for (const row of late) out.onevent(row);
      }, ROUND_END_SETTLE_S * 1000);
    }
    switch (rec.k) {
      case 'e':
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

  // The render clock in the sidecar's: the newest sample's time, advanced by
  // the page time since it arrived, one lookback behind. `at` is the
  // renderer's performance.now(); without it a read is the newest state.
  // The server's clock against the page's: page seconds minus server seconds
  // at the earliest a sample has arrived. A packet can only be late, so the
  // least offset seen is the closest to the trip itself; it is taken at once
  // when a sample beats it and let rise slowly otherwise (a drift between the
  // two clocks, a longer route), and taken whole on a jump (a level load
  // restarts the tick, a stalled tab delivers a backlog). Re-anchoring on each
  // arrival instead moved the render time by the arrival jitter, and a drawn
  // soldier stepped back and forth.
  const CLOCK_RISE = 0.01;
  const CLOCK_JUMP_S = 0.5;
  let clockOffset = null;
  function followServerClock(sample) {
    if (!Number.isFinite(sample)) return;
    if (clockOffset == null || Math.abs(sample - clockOffset) > CLOCK_JUMP_S || sample < clockOffset) clockOffset = sample;
    else clockOffset += (sample - clockOffset) * CLOCK_RISE;
  }
  const sideTime = (at) => {
    if (at == null || clockOffset == null) return null;
    return at / 1000 - clockOffset - RENDER_LOOKBACK_S;
  };
  out.remotePlayer = (slot, at = null) => pure.playerRow(slot, sideTime(at));

  out.remoteSlots = () => [...st.roster.keys()].filter((s) => s !== out.slot);

  /** The server's stats for a slot, the local player's included
   *  (`createSidecarState` statsOf): what the score board shows for a
   *  sidecar player in place of the page's own `killed` tally. */
  out.statsOf = (slot) => pure.statsOf(slot);

  out.teamOf = (slot) => st.roster.get(slot)?.team ?? 0;
  out.nameOf = (slot) => st.roster.get(slot)?.name ?? '';

  // A vehicle's pose, in the shape netcode-render.js reads: id, position, a
  // quaternion, and whether it is occupied. The renderer sets the group's
  // quaternion straight from `q` (a vehicle's root carries no baked turn), so
  // the quaternion is built from the same yaw and pitch the soldiers are drawn
  // from. The wire's yaw is mirrored relative to the viewer's frame, the same
  // handedness flip the soldier decoder applies by negating y, and the vehicle
  // decoders pass it through, so it is negated here to match.
  out.remoteVehicle = (id, at = null) => {
    const xf = pure.xfAt(id, sideTime(at));
    if (!xf) return null;
    // Occupied while any player sits in the hull or one of its seats: an
    // empty hull is the page's own parked copy (it can be entered, and the
    // page moves it to the server's pose), a manned one the replica. Always
    // true hid every parked copy, and with it every vehicle a player could get
    // into on the page.
    let occupied = false;
    for (const nid of st.boarded.values()) if (pure.seatRoot(nid) === id) { occupied = true; break; }
    const parts = st.joints.get(id);
    const joints = parts ? [...parts.values()] : null;
    return { id, x: xf.x, y: xf.y, z: xf.z, q: [...xf.q], occupied, hp: st.hp.get(id) ?? null, joints };
  };

  /** Every round the server is flying, at the renderer's time: the rows
   *  `net-server-rounds.js` draws (the pools' objects, `projPool`). */
  out.serverRounds = (at = null) => pure.roundRows(sideTime(at));

  out.snapCount = () => st.tick;

  out.selfPlayer = () => (out.slot != null ? pure.playerRow(out.slot) : null);

  /** The driven hull's state at the newest acked tick, or null: `{ id, ack,
   *  x, y, z, q, v }` in the page's frame (the ack row's `hp3`/`hq`/`hv`). */
  out.selfHull = () => st.selfHull;

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

  /** A typed chat line, all or team; the sidecar sends it as the retail
   *  client does (sidecar/chat.mjs). The server never echoes it back. */
  out.chat = (text, team) => out.action({ type: 'chat', text: String(text ?? ''), team: !!team });

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
