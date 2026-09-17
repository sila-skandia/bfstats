// Round replay: a bf42plus recording played back over the level map.html has
// loaded, with the dedicated server's event log as an optional overlay.
//
//   map.html?replay=replays/<recording>.ndjson
//   map.html?replay=replays/<recording>.ndjson&serverlog=replays/<ev_log>.xml
//
// or drop a recording (and optionally its server log) onto the view.
//
// Everything drawn is a function of the recording's clock, so seeking is only
// setting that clock. Recording formats 1-3 are read; what an older format
// lacks (hit points and the player's own chat arrived in v3) is simply absent.
// bfstats features/round-replay-capture/README.md documents the format and how
// each mapping here was measured.

import * as THREE from 'three';
import { clone as skeletonClone } from './vendor/utils/SkeletonUtils.js';
import { selectGait } from './gait-select.js';

// --- conventions --------------------------------------------------------------

// Recorded samples are written at 10 Hz, and only when an object moved: a
// longer gap between two samples means it held still until the period before
// the later one, not that it drifted across the whole gap.
const SAMPLE_PERIOD = 0.1;

// How long a server-log marker stays on the level around its event, seconds.
const MARKER_LEAD = 0.5;
const MARKER_TAIL = 4;

// Server-log events are matched to recording events within this window when
// the two clocks are aligned. A player's own chat is shown locally up to
// ~0.6 s before the server logs it.
const ALIGN_WINDOW = 1;

// Labels further than this from the camera are not drawn.
const LABEL_RANGE = 450;

// Follow-camera distance from the followed object, and the lowest the orbit
// may go: close over a soldier, further back from a vehicle, and high above
// the spectator camera, which on the spawn screen is only a viewpoint.
const FOLLOW_SOLDIER = { distance: 9, minPitch: -0.15 };
const FOLLOW_VEHICLE = { distance: 20, minPitch: -0.15 };
const FOLLOW_SPECTATOR = { distance: 85, minPitch: 0.7 };

// Templates a recording names that have nothing to draw.
const NO_MODEL = new Set(['MultiPlayerFreeCamera']);

const SCORE_TEXT = {
  0: 'captured a flag', 1: 'scored an attack', 2: 'scored a defence', 3: 'killed',
  6: 'team-killed', 8: 'completed an objective', 9: 'team-killed on an objective',
};
const GAME_STATUS = { 1: 'round playing', 2: 'round over', 3: 'pre-game', 4: 'paused', 5: 'map over' };

const teamName = team => (team === 1 ? 'Axis' : team === 2 ? 'Allies' : 'no team');
const fmtHp = v => (Number.isInteger(v) ? String(v) : v.toFixed(1));

function fmtTime(seconds) {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
}

// --- coordinates ----------------------------------------------------------------
//
// The viewer's frame is BF1942's with z negated. A recorded rotation quaternion
// (x, y, z, w) is (-x, -y, z, w) here: measured against the vehicles baked into
// maps/wake/scene.glb at eight different headings, |dot| >= 0.998 for every one,
// where a pitched SBD rules out the alternatives.

function toViewPosition(p, out) {
  return out.set(p[0], p[1], -p[2]);
}

function toViewQuaternion(q, out) {
  return out.set(-q[0], -q[1], q[2], q[3]);
}

// The soldier model's root, unlike every vehicle's, is authored facing the
// opposite way (see place()). Same constant kits.html uses to flip a
// head-slot attachment 180 degrees.
const SOLDIER_YAW_FLIP = new THREE.Quaternion(0, 1, 0, 0);

function qmul(a, b) {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

/** An object-creation event's rotation, degrees (yaw, pitch, roll), as the
 *  quaternion the recorder writes for the same object: yaw about +Y, then pitch
 *  about X. Checked against recorded quaternions for a Defgun (yaw -170.9) and
 *  a parked SBD (yaw -24.0, pitch -11.4). Roll last is assumed; every roll in
 *  the recordings so far is zero. */
function eulerToQuaternion(deg) {
  const half = d => (d * Math.PI) / 360;
  const yaw = [0, Math.sin(half(deg[0])), 0, Math.cos(half(deg[0]))];
  const pitch = [Math.sin(half(deg[1])), 0, 0, Math.cos(half(deg[1]))];
  const roll = [0, 0, Math.sin(half(deg[2])), Math.cos(half(deg[2]))];
  return qmul(qmul(yaw, pitch), roll);
}

// --- the client recording -------------------------------------------------------

function hexBytes(hex) {
  const out = new Uint8Array(hex.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

function cString(bytes, offset, length) {
  let s = '';
  for (let i = offset; i < offset + length && i < bytes.length && bytes[i]; i++) {
    s += String.fromCharCode(bytes[i]);
  }
  return s;
}

/**
 * A recording as lives: one per object lifetime, from its creation (event 0x07,
 * or first sight in recordings that started mid-round) to its destruction
 * (event 0x06). A respawned vehicle is a new life with a new network id.
 */
export function parseRecording(text) {
  const rec = {
    version: 1,
    start: '',
    duration: 0,
    level: '',
    server: '',
    lives: [],
    players: new Map(),   // pid -> { name, team }
    control: [],          // { t, pid, team, nid } from player records
    chat: [],             // { t, pid, team, text, body }
    events: [],           // feed rows
    clocks: [],           // { t, seconds, exact }
    matchable: [],        // { t, kind, text } for aligning a server log
  };
  const current = new Map();
  const tidNames = new Map();
  const kitIds = new Set();
  const cpTemplates = new Set();
  const cpState = new Map();
  const deferred = [];
  let joined = -Infinity;

  const row = (t, kind, text) => rec.events.push({ t, kind, text, source: 'client' });
  const playerName = pid => rec.players.get(pid)?.name ?? `player ${pid}`;

  const lifeFor = (nid, t) => {
    let life = current.get(nid);
    if (!life || life.destroyed !== Infinity) {
      life = {
        nid, tmpl: '', tid: 0, team: 0, created: t, destroyed: Infinity, pose: null,
        keys: [], replicated: [], hp: [], maxhp: 0, crit: 0, spawnedLate: false,
      };
      current.set(nid, life);
      rec.lives.push(life);
    }
    return life;
  };
  const closeReplicated = (life, t) => {
    const last = life.replicated[life.replicated.length - 1];
    if (last && last[1] === Infinity) last[1] = t;
  };

  function parseRaw(r, t) {
    const b = hexBytes(r.raw || '');
    const view = new DataView(b.buffer);
    const u16 = offset => (offset + 2 <= b.length ? view.getUint16(offset, true) : 0);
    switch (r.type) {
      case 0x07: {
        // Object created: u32 template, u16 network id, u8, vec3 position,
        // vec3 rotation in degrees. Announced for every object, including
        // those beyond the relevance radius that are never replicated.
        if (b.length < 31) return;
        const life = lifeFor(u16(4), t);
        life.tid = view.getUint32(0, true);
        if (r.tmpl) life.tmpl = r.tmpl;
        life.pose = {
          p: [view.getFloat32(7, true), view.getFloat32(11, true), view.getFloat32(15, true)],
          q: eulerToQuaternion([view.getFloat32(19, true), view.getFloat32(23, true), view.getFloat32(27, true)]),
        };
        life.created = Math.min(life.created, t);
        life.announced = true;
        return;
      }
      case 0x06: {
        const life = current.get(u16(0));
        if (life && life.destroyed === Infinity) {
          life.destroyed = t;
          closeReplicated(life, t);
        }
        return;
      }
      case 0x0a:
        deferred.push({ t, type: 'enter', pid: b[0], nid: u16(1) });
        rec.matchable.push({ t, kind: 'enterVehicle' });
        return;
      case 0x0b:
        // Flag 1 is the round-end teardown, not a player getting out.
        if (b[1]) return;
        deferred.push({ t, type: 'exit', pid: b[0] });
        rec.matchable.push({ t, kind: 'exitVehicle' });
        return;
      case 0x23:
        kitIds.add(u16(1));
        rec.matchable.push({ t, kind: 'pickupKit' });
        return;
      case 0x36:
        rec.level = cString(b, 0, 64).split('/').filter(Boolean).pop() || rec.level;
        return;
      case 0x13:
        if (!rec.level) rec.level = cString(b, 4, 64);
        return;
      case 0x1b:
        rec.server = cString(b, 0, 32);
        return;
      case 0x04:
        if (b.length >= 5) rec.clocks.push({ t, seconds: view.getFloat32(1, true), exact: true });
        return;
      case 0x29:
        if (b.length >= 8) rec.clocks.push({ t, seconds: view.getUint32(4, true), exact: false });
        return;
      default:
        return;
    }
  }

  function parseEvent(r, t) {
    switch (r.e) {
      case 'createPlayer':
        rec.players.set(r.pid, { name: r.name, team: r.team });
        row(t, 'player', `${r.name} joined ${teamName(r.team)}`);
        return;
      case 'destroyPlayer':
        row(t, 'player', `${playerName(r.pid)} left`);
        return;
      case 'setTeam': {
        const player = rec.players.get(r.pid);
        if (player) player.team = r.team;
        row(t, 'player', `${playerName(r.pid)} switched to ${teamName(r.team)}`);
        rec.matchable.push({ t, kind: 'setTeam' });
        return;
      }
      case 'score':
        if (r.kind === 7) {
          row(t, 'spawn', `${playerName(r.pid)} spawned`);
        } else if (r.kind === 3 || r.kind === 6) {
          row(t, 'kill', `${playerName(r.pid)} ${SCORE_TEXT[r.kind]} ${playerName(r.victim)}`);
        } else if (SCORE_TEXT[r.kind]) {
          // Deaths (4, 5) are skipped: a kill row carries them, and the rest
          // are the round-end teardown.
          row(t, 'score', `${playerName(r.pid)} ${SCORE_TEXT[r.kind]}`);
        }
        return;
      case 'chat':
        // From v3 the chat box itself is recorded, which also has the
        // player's own lines; the fragments are only needed before that.
        if (rec.version < 3) row(t, 'chat', `${playerName(r.pid)}: ${r.text}`);
        return;
      case 'gameStatus':
        row(t, 'round', GAME_STATUS[r.status] ?? `game status ${r.status}`);
        return;
      case 'dbComplete':
        joined = t;
        return;
      case 'createObject': {
        if (r.netId) {
          const life = lifeFor(r.netId, t);
          if (r.tmpl) life.tmpl = r.tmpl;
          if (r.tid) life.tid = r.tid;
          if (r.pos && r.rot) {
            life.pose = {
              p: r.pos,
              q: eulerToQuaternion(r.rot),
            };
          }
          life.created = Math.min(life.created, t);
          life.announced = true;
        }
        return;
      }
      case 'destroyObject': {
        if (r.netId) {
          const life = current.get(r.netId);
          if (life && life.destroyed === Infinity) {
            life.destroyed = t;
            closeReplicated(life, t);
          }
        }
        return;
      }
      case 'enterVehicle': {
        if (r.pid !== undefined && r.netId) {
          deferred.push({ t, type: 'enter', pid: r.pid, nid: r.netId });
          rec.matchable.push({ t, kind: 'enterVehicle' });
        }
        return;
      }
      case 'exitVehicle': {
        if (r.pid !== undefined) {
          deferred.push({ t, type: 'exit', pid: r.pid });
          rec.matchable.push({ t, kind: 'exitVehicle' });
        }
        return;
      }
      case 'pickupKit': {
        rec.matchable.push({ t, kind: 'pickupKit' });
        kitIds.add(r.netId);
        if (r.pid !== undefined && r.netId) {
          rec.playerKitEvents = rec.playerKitEvents || [];
          rec.playerKitEvents.push({ t, pid: r.pid, netId: r.netId });
        }
        return;
      }
      case 'fire': {
        rec.fires = rec.fires || [];
        rec.fires.push({ t, pid: r.pid, kind: r.kind, weapon: r.weapon, pos: r.pos, dir: r.dir });
        return;
      }
      case 'raw':
        parseRaw(r, t);
        return;
      default:
        return;
    }
  }

  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let r;
    try {
      r = JSON.parse(line);
    } catch {
      continue;   // a crash can cut the last line short
    }
    const t = typeof r.t === 'number' ? r.t : 0;
    if (t > rec.duration) rec.duration = t;
    switch (r.k) {
      case 'h':
        rec.version = r.v ?? 1;
        rec.start = r.start ?? '';
        break;
      case 'e':
        parseEvent(r, t);
        break;
      case 'o': {
        const life = lifeFor(r.id, t);
        if (!life.tmpl) life.tmpl = r.tmpl || '';
        if (!life.tid) life.tid = r.tid || 0;
        life.team = r.team ?? life.team;
        if (r.maxhp) {
          life.maxhp = r.maxhp;
          life.crit = r.crit ?? 0;
        }
        if (r.tmpl && r.tid) tidNames.set(r.tid, r.tmpl);
        closeReplicated(life, t);
        life.replicated.push([t, Infinity]);
        break;
      }
      case 's':
        for (const o of r.o) {
          lifeFor(o[0], t).keys.push({ t, p: [o[1], o[2], o[3]], q: [o[4], o[5], o[6], o[7]] });
        }
        break;
      case 'd': {
        const life = current.get(r.id);
        if (life) closeReplicated(life, t);
        break;
      }
      case 'p':
        for (const [pid, team, nid] of r.p) rec.control.push({ t, pid, team, nid });
        break;
      case 'a':
        for (const [nid, hp] of r.a) {
          const life = lifeFor(nid, t);
          const last = life.hp[life.hp.length - 1];
          if (!last || last.hp !== hp) life.hp.push({ t, hp });
        }
        break;
      case 'cp': {
        if (r.tmpl) cpTemplates.add(r.tmpl);
        const before = cpState.get(r.id);
        const name = r.name ?? before?.name ?? `control point ${r.id}`;
        cpState.set(r.id, { name, team: r.team });
        if (before && before.team > 0 && r.team > 0 && before.team !== r.team) {
          row(t, 'flag', `${name} taken by ${teamName(r.team)}`);
        }
        break;
      }
      case 'chat':
        rec.chat.push({ t, pid: r.pid, team: r.team, text: r.text ?? '' });
        break;
      default:
        break;
    }
  }

  // Names for lives announced only by template id (before v3), from any object
  // of the same template the client did replicate.
  for (const life of rec.lives) {
    if (!life.tmpl && life.tid) life.tmpl = tidNames.get(life.tid) || '';
    life.kit = kitIds.has(life.nid);
    life.controlPoint = cpTemplates.has(life.tmpl);
    life.soldier = /soldier/i.test(life.tmpl);
    // DataBaseComplete arrives after the join-time burst of creations, so
    // whether an object spawned during play can only be decided here.
    life.spawnedLate = Boolean(life.announced) && life.created > joined + 1;
  }

  // Resolve kit pickups to soldier lives
  if (rec.playerKitEvents) {
    for (const { t, pid, netId } of rec.playerKitEvents) {
      const kitLife = rec.lives.find(l => l.nid === netId);
      if (kitLife && kitLife.tmpl) {
        const weapon = weaponForKitTemplate(kitLife.tmpl);
        for (const life of rec.lives) {
          if (life.soldier) {
            life.kitTemplate = kitLife.tmpl;
            life.weapon = weapon;
          }
        }
      }
    }
  }

  // Resolve firing position, direction, weapon names, and add feed rows
  if (rec.fires) {
    for (const f of rec.fires) {
      const soldierLife = rec.lives.find(l => (f.pid !== undefined ? l.pid === f.pid : l.soldier) && l.soldier)
        || rec.lives.find(l => l.soldier);

      if (soldierLife) {
        if (!f.weapon || /soldier/i.test(f.weapon)) {
          if (soldierLife.weapon) f.weapon = soldierLife.weapon;
        }
        const sSample = sampleAt(soldierLife, f.t);
        if (sSample && sSample.a && sSample.a.p) {
          if (!f.pos || (f.pos[0] === 0 && f.pos[1] === 0 && f.pos[2] === 0)) {
            f.pos = [...sSample.a.p];
          }
        }
      }

      // Auto-aim target vector: resolve exact vector pointing to vehicle damaged shortly after fire
      let targetLife = null;
      for (const l of rec.lives) {
        if (!l.soldier && !l.kit && !l.controlPoint && l.tmpl) {
          const hit = l.hp.some(h => h.t >= f.t && h.t <= f.t + 2.5);
          if (hit) { targetLife = l; break; }
        }
      }
      if (targetLife) {
        const tSample = sampleAt(targetLife, f.t);
        if (tSample && tSample.a && tSample.a.p && f.pos) {
          const dx = tSample.a.p[0] - f.pos[0];
          const dy = (tSample.a.p[1] + 0.8) - (f.pos[1] + 1.2);
          const dz = tSample.a.p[2] - f.pos[2];
          const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
          f.dir = [dx / len, dy / len, dz / len];
        }
      }

      row(f.t, 'fire', `${playerName(f.pid)} fired ${f.weapon || 'weapon'}`);
    }
  }

  const lifeAt = (nid, t) => rec.lives.find(l => l.nid === nid && l.created <= t + 0.5 && t < l.destroyed);

  for (const d of deferred) {
    if (d.type === 'enter') {
      row(d.t, 'vehicle', `${playerName(d.pid)} got into ${lifeAt(d.nid, d.t)?.tmpl || `object ${d.nid}`}`);
    } else {
      row(d.t, 'vehicle', `${playerName(d.pid)} got out`);
    }
  }

  for (const life of rec.lives) {
    if (life.kit || life.controlPoint || !life.tmpl) continue;
    for (let i = 1; i < life.hp.length; i++) {
      const before = life.hp[i - 1].hp;
      const after = life.hp[i].hp;
      const t = life.hp[i].t;
      // Below critical damage hit points drain a little every sample; only a
      // real hit, the fire starting and the kill are worth a row.
      if (after <= 0 && before > 0) {
        life.killedAt = t;
        row(t, 'destroyed', `${life.tmpl} destroyed`);
      } else if (after < before - 0.5) {
        row(t, 'damage', `${life.tmpl} hit: ${fmtHp(before)} → ${fmtHp(after)} of ${fmtHp(life.maxhp)}`);
      } else if (life.crit > 0 && before > life.crit && after <= life.crit) {
        row(t, 'damage', `${life.tmpl} on fire`);
      }
    }
    if (life.killedAt !== undefined && life.destroyed !== Infinity) {
      row(life.destroyed, 'removed', `${life.tmpl} wreck removed`);
    }
    if (life.spawnedLate && !life.soldier) row(life.created, 'spawn', `${life.tmpl} spawned`);
    if (life.soldier && life.spawnedLate) rec.matchable.push({ t: life.created, kind: 'spawn' });
  }

  for (const c of rec.chat) {
    const name = playerName(c.pid);
    c.body = c.text.startsWith(`${name}: `) ? c.text.slice(name.length + 2) : c.text;
    row(c.t, 'chat', `${name}: ${c.body}`);
    rec.matchable.push({ t: c.t, kind: 'chat', text: c.body.trim() });
  }

  rec.events.sort((a, b) => a.t - b.t);
  rec.clocks.sort((a, b) => a.t - b.t);
  return rec;
}

/** Seconds into the round at recording time `t`: the exact 0x04 clock where
 *  there is one, else the 10-second 0x29 ticks, restarting when they reset. */
export function roundClock(rec, t) {
  let ref = null;
  for (const c of rec.clocks) {
    if (c.t > t) break;
    if (!ref || c.exact) {
      ref = c;
      continue;
    }
    const predicted = ref.seconds + (c.t - ref.t);
    if (!ref.exact || Math.abs(c.seconds - predicted) > 10.5) ref = c;
  }
  return ref ? ref.seconds + (t - ref.t) : null;
}

// --- the server's event log -----------------------------------------------------

const XML_ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
const unescapeXml = s => s.replace(/&(amp|lt|gt|quot|apos);/g, m => XML_ENTITIES[m]);

/** `mods/<mod>/logs/ev_<port>-<date>_<time>.xml`, as events on the server's
 *  clock. The server appends to the file while the round runs, so it is
 *  usually unterminated XML: every complete element is read and the rest is
 *  ignored, rather than handing it to an XML parser that would reject it. */
export function parseServerLog(text) {
  const events = [];
  const eventRe = /<bf:event name="([^"]*)" timestamp="([^"]*)">([\s\S]*?)<\/bf:event>/g;
  const paramRe = /<bf:param type="([^"]*)" name="([^"]*)">([\s\S]*?)<\/bf:param>/g;
  for (const m of text.matchAll(eventRe)) {
    const params = {};
    for (const p of m[3].matchAll(paramRe)) {
      const value = unescapeXml(p[3]);
      params[p[2]] = p[1] === 'vec3' && value.includes('/') ? value.split('/').map(Number)
        : p[1] === 'int' || p[1] === 'float' ? Number(value)
        : value;
    }
    events.push({ t: Number(m[2]), name: m[1], params });
  }
  const statsRe = /<bf:roundstats timestamp="([^"]*)">([\s\S]*?)<\/bf:roundstats>/g;
  for (const m of text.matchAll(statsRe)) {
    const winner = /<bf:winningteam>(\d+)<\/bf:winningteam>/.exec(m[2]);
    const tickets = [...m[2].matchAll(/<bf:teamtickets team="(\d+)">(-?\d+)<\/bf:teamtickets>/g)]
      .map(x => `${teamName(Number(x[1]))} ${x[2]}`);
    events.push({ t: Number(m[1]), name: 'roundstats', params: { winner: winner ? Number(winner[1]) : 0, tickets } });
  }
  events.sort((a, b) => a.t - b.t);
  return { events };
}

const SERVER_NAME = {
  spawn: 'spawnEvent', enterVehicle: 'enterVehicle', exitVehicle: 'exitVehicle',
  setTeam: 'setTeam', chat: 'chat', pickupKit: 'pickupKit',
};

/**
 * The offset between the server's clock and the recording's. Every event the
 * two share (spawns, vehicle entries and exits, team changes, kit pickups, and
 * from v3 chat by its text) proposes an offset; the one that lines up the most
 * of them wins. A log holds every connection since the map loaded, so this
 * also picks out the session the recording belongs to.
 */
export function alignServerLog(rec, log) {
  const byName = new Map();
  for (const e of log.events) {
    if (!byName.has(e.name)) byName.set(e.name, []);
    byName.get(e.name).push(e);
  }
  const candidates = (m) => (byName.get(SERVER_NAME[m.kind]) || [])
    .filter(e => m.kind !== 'chat' || String(e.params.text ?? '').trim() === m.text);

  const offsets = new Set();
  for (const m of rec.matchable) {
    if (m.kind !== 'spawn' && m.kind !== 'chat') continue;
    for (const e of candidates(m)) offsets.add(Math.round((e.t - m.t) * 1000) / 1000);
  }
  let best = null;
  for (const offset of offsets) {
    let matched = 0;
    let error = 0;
    for (const m of rec.matchable) {
      let nearest = Infinity;
      for (const e of candidates(m)) nearest = Math.min(nearest, Math.abs(e.t - offset - m.t));
      if (nearest < ALIGN_WINDOW) {
        matched++;
        error += nearest;
      }
    }
    if (!best || matched > best.matched || (matched === best.matched && error < best.error)) {
      best = { offset, matched, error };
    }
  }
  if (!best || best.matched === 0) return null;
  return { offset: best.offset, matched: best.matched, total: rec.matchable.length, meanError: best.error / best.matched };
}

function serverRows(rec, log, alignment) {
  const names = new Map();
  for (const e of log.events) {
    if (e.name === 'createPlayer') names.set(e.params.player_id, e.params.name);
  }
  const who = id => names.get(id) ?? `player ${id}`;
  const rows = [];
  for (const e of log.events) {
    const t = e.t - alignment.offset;
    if (t < -2 || t > rec.duration + 2) continue;
    const p = e.params;
    const at = Array.isArray(p.vehicle_pos) ? p.vehicle_pos
      : Array.isArray(p.player_location) ? p.player_location : null;
    let text;
    switch (e.name) {
      case 'createPlayer': text = `${p.name} connected`; break;
      case 'spawnEvent': text = `${who(p.player_id)} spawned`; break;
      case 'pickupKit': text = `${who(p.player_id)} picked up ${p.kit}`; break;
      case 'chat': text = `${who(p.player_id)}: ${p.text}`; break;
      case 'destroyVehicle': text = `${who(p.player_id)} destroyed ${p.vehicle}`; break;
      case 'enterVehicle': text = `${who(p.player_id)} got into ${p.vehicle}`; break;
      case 'exitVehicle': text = `${who(p.player_id)} got out of ${p.vehicle}`; break;
      case 'setTeam': text = `${who(p.player_id)} switched to ${teamName(p.team)}`; break;
      case 'disconnectPlayer': text = `${who(p.player_id)} disconnected`; break;
      case 'destroyPlayer': text = `${who(p.player_id)} removed`; break;
      case 'roundInit': text = `round started, tickets ${p.tickets_team1} / ${p.tickets_team2}`; break;
      case 'restartMap': text = 'map restarted'; break;
      case 'roundstats': text = `round over: ${teamName(p.winner)} win (${p.tickets.join(', ')})`; break;
      default: text = p.player_id !== undefined ? `${e.name} (${who(p.player_id)})` : e.name;
    }
    rows.push({ t, kind: e.name, text, source: 'server', at });
  }
  return rows;
}

// --- sampling a life at a time --------------------------------------------------

function sampleAt(life, t) {
  const keys = life.keys;
  if (!keys.length || t < keys[0].t) {
    if (life.pose) return { a: life.pose, b: null, k: 0 };
    return keys.length ? { a: keys[0], b: null, k: 0 } : null;
  }
  let hi = keys.length - 1;
  if (t >= keys[hi].t) return { a: keys[hi], b: null, k: 0 };
  let lo = 0;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (keys[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = keys[lo];
  const b = keys[hi];
  const start = Math.max(a.t, b.t - SAMPLE_PERIOD);
  if (t <= start) return { a, b: null, k: 0 };
  return { a, b, k: (t - start) / (b.t - start) };
}

function hpAt(life, t) {
  let hp = null;
  for (const entry of life.hp) {
    if (entry.t > t) break;
    hp = entry.hp;
  }
  return hp;
}

const isReplicated = (life, t) => life.replicated.some(([from, to]) => t >= from && t < to);

function weaponForKitTemplate(tmpl) {
  if (!tmpl) return 'Colt';
  if (/_AT$/i.test(tmpl) || /bazooka|panzershreck|at/i.test(tmpl)) return 'Bazooka';
  if (/_Assault$/i.test(tmpl) || /bar1918|stg44/i.test(tmpl)) return 'Bar1918';
  if (/_Scout$/i.test(tmpl) || /sniper|k98/i.test(tmpl)) return 'No4Sniper';
  if (/_Engineer$/i.test(tmpl) || /garand|engineer/i.test(tmpl)) return 'M1Garand';
  if (/_Medic$/i.test(tmpl) || /thompson|mp18|medic/i.test(tmpl)) return 'Thompson';
  return 'Colt';
}

function placeholderWeaponFor(life) {
  if (life && life.weapon) return life.weapon;
  if (life && life.kitTemplate) return weaponForKitTemplate(life.kitTemplate);
  return 'Colt';
}

// Gait selection (idle/walk/run) is `gait-select.js`'s job: ground speed and
// heading (forward/strafe/backward) from the life's own recorded samples,
// with hysteresis so a noisy single tick can't flip the animation. See that
// module's header and features/soldier-locomotion-animation/README.md for
// why a heading-aware threshold is necessary, not just a nicety -- a
// standing strafe measures almost exactly on top of a naive forward-only
// walk/run boundary.

// Phase-offset each soldier so a squad doesn't move in lockstep. The engine's
// own primitive (setUserRandomStartTime / State.random_start, already parsed
// by bf42/animstates.py -- see soldier-locomotion-animation/README.md section
// 6) never reaches the viewer: extract_pose.py's gait export writes only
// state/clip/speed/frames/period per gait into extras (checked directly
// against the live lower.gait.glb), not random_start or morph_factor, and
// adding it means extending that extractor and bf42/gltf.py's extras writer
// -- real pipeline work, not a viewer-side fix. Falls back to a per-life
// pseudo-random phase seeded off the soldier's network id, stable for the
// life's whole duration and already on hand.
function phaseFor(nid) {
  const x = Math.sin(nid * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

// Same investigate-then-fall-back call for the transition itself: the
// engine's setMorphFactor / State.morph_factor (also already parsed by
// bf42/animstates.py) is equally absent from the gait extras, so a real
// per-state crossfade rate isn't reachable either. A fixed fade, short
// against both gait periods (run 0.625 s/cycle, walk 1.0 s/cycle), stands in.
const CROSSFADE_DURATION = 0.2;   // seconds

// --- drawing --------------------------------------------------------------------

const modelCache = new Map();
const posePairCache = new Map();     // "Soldier|Weapon" -> Promise<{scene, animations} | null>
const gaitBundleCache = new Map();   // relative sidecar path -> Promise<AnimationClip[]>
let gaitsManifestPromise = null;     // Promise<gaits.json>, fetched once and shared

// Out-of-range objects are drawn in this: announced and placed, but not updated.
const ghostMaterial = new THREE.MeshBasicMaterial({
  color: 0x9aa666, transparent: true, opacity: 0.2, depthWrite: false,
});

function setGhost(entity, ghost) {
  if (entity.ghost === ghost) return;
  entity.ghost = ghost;
  for (const { mesh, material } of entity.meshes) mesh.material = ghost ? ghostMaterial : material;
}

class ReplayPlayer {
  constructor(ctx, rec, log, alignment, label) {
    this.ctx = ctx;
    this.rec = rec;
    this.log = log;
    this.alignment = alignment;
    this.label = label;
    this.time = 0;
    this.speed = 1;
    this.playing = true;
    this.showServer = Boolean(alignment);
    this.showGhosts = true;
    this.entities = [];
    this.markers = [];
    this.root = new THREE.Group();
    this.root.name = 'replay';
    ctx.scene.add(this.root);
    this.rows = [...rec.events, ...(log && alignment ? serverRows(rec, log, alignment) : [])]
      .sort((a, b) => a.t - b.t);
    const pids = [...new Set([...rec.players.keys(), ...rec.control.map(c => c.pid)])];
    this.followPid = pids.length ? pids[0] : null;
    this.v1 = new THREE.Vector3();
    this.v2 = new THREE.Vector3();
    this.v3 = new THREE.Vector3();
    this.q1 = new THREE.Quaternion();
    this.followReady = false;
    // Where the follow camera sits around its object: dragged or turned with
    // the mouse, zoomed with the wheel.
    this.orbit = { yaw: -Math.PI / 4, pitch: 0.35, zoom: 1 };
    this.ui = new ReplayUi(this, pids);
  }

  async load() {
    this.ctx.hideBakedVehicles();
    const drawable = this.rec.lives.filter(l => l.tmpl && !l.kit && !l.controlPoint && !NO_MODEL.has(l.tmpl));
    const templates = [...new Set(drawable.map(l => l.tmpl))];
    const models = new Map();
    let done = 0;
    this.ui.status(`loading ${templates.length} models`);
    // One (soldier, weapon) pose pair per distinct soldier template present
    // (today, one pair per template -- every soldier gets the same
    // placeholder weapon), plus its gait clips. Both are cached per pair/grip
    // (posePair / gaitClipsFor above), so this never refetches per soldier
    // instance, only per distinct pair actually seen in the recording.
    const soldierPairs = [...new Set(
      drawable.filter(l => l.soldier).map(l => `${l.tmpl}|${placeholderWeaponFor(l)}`),
    )];
    let poseDone = 0;
    const poses = new Map();
    await Promise.all([
      ...templates.map(async name => {
        const [normal, wreck] = await Promise.all([this.model(name), this.model(`${name}.wreck`)]);
        models.set(name, { normal, wreck });
        this.ui.status(`loading models ${++done}/${templates.length}`);
      }),
      ...soldierPairs.map(async key => {
        const [soldier, weapon] = key.split('|');
        const [pose, gaitClips] = await Promise.all([this.posePair(soldier, weapon), this.gaitClipsFor(weapon)]);
        poses.set(key, pose ? { pose, gaitClips } : null);
        this.ui.status(`loading gaits ${++poseDone}/${soldierPairs.length}`);
      }),
    ]);
    for (const life of drawable) {
      const group = new THREE.Group();
      group.name = `replay ${life.tmpl} ${life.nid}`;
      group.visible = false;
      const rigged = life.soldier ? poses.get(`${life.tmpl}|${placeholderWeaponFor(life)}`) : null;
      let normal;
      let wreck = null;
      let anim = null;
      let gunGroup = null;
      if (rigged) {
        // A wrapper group carries the recorded transform, so the pose keeps
        // its own root orientation (see SOLDIER_YAW_FLIP in place()).
        //
        // Plain Object3D.clone() shares one Skeleton (and its bones) across
        // every clone (three.js SkinnedMesh.copy() copies the reference, not
        // the bones), so every soldier but the first would read bone
        // transforms off an unparented template that never gets
        // updateMatrixWorld() -- the hand (farthest from the root) is the
        // most visibly wrong. SkeletonUtils.clone() rebuilds a parallel bone
        // hierarchy per clone, same fix as the plain-model path below.
        normal = skeletonClone(rigged.pose.scene);
        anim = this.buildGaitRig(normal, rigged.pose.animations, rigged.gaitClips, phaseFor(life.nid));
        if (this.ctx.guns) {
          const found = this.ctx.guns.collect(normal, {
            replace: false,
            speedScale: 1,
            maxRange: 1200,
            roundLifetime: 'data',
          });
          gunGroup = found[0] || null;
        }
      } else {
        const model = models.get(life.tmpl);
        if (!model?.normal) continue;
        normal = skeletonClone(model.normal);
        if (model.wreck) {
          wreck = skeletonClone(model.wreck);
          wreck.visible = false;
        }
      }
      group.add(normal);
      if (wreck) group.add(wreck);
      const meshes = [];
      group.traverse(obj => { if (obj.isMesh) meshes.push({ mesh: obj, material: obj.material }); });
      this.root.add(group);
      this.entities.push({ life, group, normal, wreck, meshes, anim, gunGroup, ghost: false, label: null, hp: null });
    }
    if (this.ctx.guns?.collider) {
      this.ctx.guns.collider.dynamicCast = (ox, oy, oz, dx, dy, dz, maxDist, skipOwner) => {
        return this.dynamicCast(ox, oy, oz, dx, dy, dz, maxDist, skipOwner);
      };
    }
    this.buildMarkers();
    const aligned = this.alignment
      ? ` · server log aligned on ${this.alignment.matched} of ${this.alignment.total} shared events`
      : this.log ? ' · server log loaded but could not be aligned' : '';
    this.ui.status(`${this.label} · ${this.rec.level || 'level ?'} · ${this.entities.length} objects${aligned}`);
    this.ui.renderFeed();
  }

  model(name) {
    if (!modelCache.has(name)) {
      const url = `${this.ctx.modelsBase}/${name}.glb${this.ctx.bust()}`;
      modelCache.set(name, this.ctx.loader.loadAsync(url).then(gltf => {
        gltf.scene.traverse(obj => {
          const data = obj.userData || {};
          // What show() hides on the level: baked weapon-effect payloads. And
          // collision hulls, which are geometry but not for drawing.
          if (data.effect || data.projectileMesh || data.projectileTrail
              || data.collision || /collision/i.test(obj.name || '')) obj.visible = false;
        });
        // The page's own vehicle shading, so a replayed tank is lit like a
        // parked one rather than by raw glTF materials.
        this.ctx.shadeModel?.(gltf.scene);
        return gltf.scene;
      }).catch(() => null));
    }
    return modelCache.get(name);
  }

  // --- soldier gait animation: loading and retargeting ---------------------
  //
  // models/<Template>.glb (model() above) is rigid, unskinned geometry for a
  // soldier -- extract_models.py bakes a fixed part arrangement with no
  // skeleton at all (verified against the live asset: 5 nodes, 0 skins,
  // "USMarine3PBody" etc. as static children). There is nothing a clip could
  // bind onto. The only soldier asset with a skeleton is the weapon-pose
  // matrix poses.html already animates --
  // models/poses/<Soldier>__<Weapon>.pose.glb, mesh + skin + stance clips
  // (verified: its skeleton's node names are a strict superset of
  // gaits/lower.gait.glb's 67 joint names). A soldier life's drawable mesh
  // comes from there instead of the plain body model now, falling back to
  // the plain model if the pose pair fails to load -- never a broken page.
  //
  // Retargeting the shared lower.gait.glb / <grip>.gait.glb clips onto that
  // skeleton is the identical name-based binding poses.html already proved:
  // three.js resolves a clip's tracks by node NAME against whatever root the
  // AnimationMixer holds, so a sidecar carrying only a joint hierarchy binds
  // straight onto a different file's skinned scene, no track rewriting.

  posesBase() {
    return `${this.ctx.modelsBase}/poses`;
  }

  gaitsManifest() {
    if (!gaitsManifestPromise) {
      gaitsManifestPromise = fetch(`${this.posesBase()}/gaits/gaits.json${this.ctx.bust()}`)
        .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
        .catch(() => ({ lower: null, grips: {}, weaponGrip: {} }));
    }
    return gaitsManifestPromise;
  }

  gaitBundle(relative) {
    if (!gaitBundleCache.has(relative)) {
      const url = `${this.posesBase()}/${relative}${this.ctx.bust()}`;
      gaitBundleCache.set(relative, this.ctx.loader.loadAsync(url)
        .then(gltf => gltf.animations ?? [])
        .catch(() => []));
    }
    return gaitBundleCache.get(relative);
  }

  // The shared lower-body clips plus the two upper-body clips for whatever
  // grip `weapon` resolves to (gaits.json mirrors copyState's donor sharing:
  // 23 grips, not one per weapon), cached per grip so soldiers sharing a
  // weapon -- or sharing a donor grip -- fetch its bundle once.
  async gaitClipsFor(weapon) {
    const manifest = await this.gaitsManifest();
    const grip = manifest.weaponGrip?.[weapon] ?? weapon;
    const gripPath = manifest.grips?.[grip];
    if (!manifest.lower) return [];
    let upper = gripPath ? await this.gaitBundle(gripPath) : [];
    if ((!upper || !upper.length) && gripPath !== 'gaits/Colt.gait.glb') {
      upper = await this.gaitBundle('gaits/Colt.gait.glb');
    }
    const lower = await this.gaitBundle(manifest.lower);
    return [...lower, ...upper];
  }

  // Mesh + skeleton + stance clips for one (soldier, weapon) pair, cached --
  // several lives sharing a pair (every soldier gets the same placeholder
  // weapon today) fetch it once. Never thrown: a missing pair resolves to
  // null so load() can fall back to the plain body model.
  posePair(soldier, weapon) {
    const key = `${soldier}|${weapon}`;
    if (!posePairCache.has(key)) {
      const url = `${this.posesBase()}/${soldier}__${weapon}.pose.glb${this.ctx.bust()}`;
      posePairCache.set(key, this.ctx.loader.loadAsync(url).then(gltf => {
        gltf.scene.traverse(obj => {
          const data = obj.userData || {};
          if (data.effect || data.projectileMesh || data.projectileTrail
              || data.collision || /collision/i.test(obj.name || '')) obj.visible = false;
        });
        this.ctx.shadeModel?.(gltf.scene);
        return { scene: gltf.scene, animations: gltf.animations ?? [] };
      }).catch(() => null));
    }
    return posePairCache.get(key);
  }

  // Builds the per-instance animation rig on a freshly skeletonClone()'d pose
  // scene: one mixer, the pose's own `stand` stance clip for idle, and
  // whichever of walk/run resolved a complete lower+upper pair. Actions are
  // created once, played and parked at weight 0 -- same shape as poses.html's
  // stance/gait actions -- then driven every frame by setGaitPose() below,
  // never through mixer.update(dt): the replay clock is the single source of
  // truth (round-replay-capture README section 12, "seeking is only setting
  // it"), so each action's .time is set as a pure function of the recording
  // time, not accumulated from frame deltas.
  buildGaitRig(scene, poseClips, gaitClips, phase) {
    const mixer = new THREE.AnimationMixer(scene);
    const action = name => {
      const clip = THREE.AnimationClip.findByName(name === 'stand' ? poseClips : gaitClips, name);
      if (!clip) return null;
      const a = mixer.clipAction(clip);
      a.setLoop(THREE.LoopRepeat, Infinity);
      a.play();
      a.setEffectiveWeight(0);
      a.paused = true;   // time is set explicitly from the replay clock, below
      return a;
    };
    const actions = {
      stand: action('stand'),
      runLower: action('run.lower'), runUpper: action('run.upper'),
      walkLower: action('walk.lower'), walkUpper: action('walk.upper'),
    };
    // A gait only counts when both halves resolved: half a body running
    // while the other holds still is worse than not running at all.
    if (!actions.runLower || !actions.runUpper) actions.runLower = actions.runUpper = null;
    if (!actions.walkLower || !actions.walkUpper) actions.walkLower = actions.walkUpper = null;
    return { mixer, actions, phase, currentGait: 'idle', fadeFrom: null, fadeStart: null };
  }

  // Advances one soldier's gait mixer to the pose for absolute replay time
  // `t`. Every quantity here is a pure function of `t` (and the entity's
  // fixed phase offset) except which gait is "current" and when the last
  // change happened, which is unavoidable for a crossfade -- blending FROM
  // something needs to remember what that was. A seek that jumps back across
  // an old transition can therefore replay a stale 200 ms fade; harmless and
  // not worth the bookkeeping a fully stateless crossfade would need, since
  // continuous playback (the common case) is exactly right.
  setGaitPose(entity, t) {
    const { anim, life } = entity;
    let desired = selectGait(life, t).gait;
    if (desired === 'run' && !anim.actions.runLower) desired = 'walk';
    if (desired === 'walk' && !anim.actions.walkLower) desired = 'idle';

    if (desired !== anim.currentGait) {
      anim.fadeFrom = anim.currentGait;
      anim.fadeStart = t;
      anim.currentGait = desired;
    }
    const elapsed = anim.fadeFrom !== null ? t - anim.fadeStart : -Infinity;
    const fading = elapsed >= 0 && elapsed < CROSSFADE_DURATION;
    const k = fading ? elapsed / CROSSFADE_DURATION : 1;
    const weights = { idle: 0, walk: 0, run: 0 };
    weights[anim.currentGait] = k;
    if (fading) weights[anim.fadeFrom] += 1 - k;
    else anim.fadeFrom = null;

    const setHalf = (lowerAction, upperAction, weight) => {
      if (!lowerAction) return;
      if (weight <= 0) { lowerAction.setEffectiveWeight(0); upperAction.setEffectiveWeight(0); return; }
      const lowerPeriod = lowerAction.getClip().duration;
      const upperPeriod = upperAction.getClip().duration;
      lowerAction.time = (t + anim.phase * lowerPeriod) % lowerPeriod;
      upperAction.time = (t + anim.phase * upperPeriod) % upperPeriod;
      lowerAction.setEffectiveWeight(weight);
      upperAction.setEffectiveWeight(weight);
    };
    setHalf(anim.actions.runLower, anim.actions.runUpper, weights.run);
    setHalf(anim.actions.walkLower, anim.actions.walkUpper, weights.walk);
    if (anim.actions.stand) anim.actions.stand.setEffectiveWeight(weights.idle);
    anim.mixer.update(0);
  }

  buildMarkers() {
    if (!this.alignment) return;
    const ring = new THREE.RingGeometry(1.0, 1.4, 40);
    ring.rotateX(-Math.PI / 2);
    const beam = new THREE.CylinderGeometry(0.05, 0.05, 24, 6);
    beam.translate(0, 12, 0);
    for (const row of this.rows) {
      if (row.source !== 'server' || !row.at) continue;
      const material = new THREE.MeshBasicMaterial({
        color: row.kind === 'destroyVehicle' ? 0xe07a5a : 0xd9b36a,
        transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,
      });
      const marker = new THREE.Group();
      marker.add(new THREE.Mesh(ring, material));
      if (row.kind === 'destroyVehicle') marker.add(new THREE.Mesh(beam, material));
      toViewPosition(row.at, marker.position);
      marker.visible = false;
      this.root.add(marker);
      this.markers.push({ row, marker, material });
    }
  }

  dynamicCast(ox, oy, oz, dx, dy, dz, maxDist, skipOwner = -1) {
    if (!this.entities.length) return null;
    const rayOrigin = new THREE.Vector3(ox, oy, oz);
    const rayDir = new THREE.Vector3(dx, dy, dz).normalize();
    const raycaster = new THREE.Raycaster(rayOrigin, rayDir, 0.01, maxDist);
    let bestHit = null;
    let bestDist = maxDist;

    for (const entity of this.entities) {
      if (!entity.group.visible || entity.life.soldier) continue;
      if (skipOwner >= 0 && entity.life.nid === skipOwner) continue;
      const targetObj = (entity.wreck && entity.wreck.visible) ? entity.wreck : entity.normal;
      if (!targetObj) continue;

      const hits = raycaster.intersectObject(targetObj, true);
      if (hits.length > 0 && hits[0].distance < bestDist) {
        const hit = hits[0];
        bestDist = hit.distance;
        let nx = 0, ny = 1, nz = 0;
        if (hit.face) {
          const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
          const worldNorm = hit.face.normal.clone().applyNormalMatrix(normalMatrix).normalize();
          nx = worldNorm.x; ny = worldNorm.y; nz = worldNorm.z;
        }
        bestHit = {
          t: hit.distance,
          x: hit.point.x,
          y: hit.point.y,
          z: hit.point.z,
          nx, ny, nz,
          material: 61,
          owner: entity.life.nid,
          kind: 'object',
        };
      }
    }
    return bestHit;
  }

  triggerGunFire(f) {
    if (!this.ctx.guns) return;
    const entity = this.entities.find(e => e.life.soldier && (f.pid !== undefined ? e.life.pid === f.pid : true)) || this.entities.find(e => e.life.soldier);
    if (!entity?.gunGroup) return;

    const dirVec = f.dir ? new THREE.Vector3(f.dir[0], f.dir[1], -f.dir[2]).normalize() : new THREE.Vector3(0, 0, -1);
    const startPos = new THREE.Vector3(f.pos[0], f.pos[1] + 1.35, -f.pos[2]).addScaledVector(dirVec, 0.7);

    entity.gunGroup.aimRay = () => ({ origin: startPos, dir: dirVec });
    this.ctx.guns.fireShot(entity.gunGroup);

    if (this.ctx.fetchHandFireSound && this.ctx.playHandFire && f.weapon) {
      this.ctx.fetchHandFireSound(f.weapon).then(fire => {
        if (fire) this.ctx.playHandFire(fire);
      }).catch(() => {});
    }
  }

  seek(t) {
    this.time = Math.min(Math.max(0, t), this.rec.duration);
    this.lastFiredTime = this.time;
    if (this.ctx.guns) {
      this.ctx.guns.clear();
      if (this.rec.fires) {
        for (const f of this.rec.fires) {
          const age = this.time - f.t;
          if (age >= 0 && age <= 0.6) {
            this.triggerGunFire(f);
            this.ctx.guns.advance(age);
          }
        }
      }
    }
  }

  update(dt) {
    const prevT = this.lastFiredTime !== undefined ? this.lastFiredTime : this.time;
    if (this.playing && !this.ui.scrubbing) {
      this.time = Math.min(this.rec.duration, this.time + dt * this.speed);
      if (this.time >= this.rec.duration) this.playing = false;
    }
    const t = this.time;
    for (const entity of this.entities) this.place(entity, t);
    for (const m of this.markers) {
      const age = t - m.row.t;
      const on = this.showServer && age >= -MARKER_LEAD && age <= MARKER_TAIL;
      m.marker.visible = on;
      if (on) {
        const k = Math.max(0, age) / MARKER_TAIL;
        m.material.opacity = 0.6 * (1 - k);
        m.marker.scale.set(1 + k * 2.5, 1, 1 + k * 2.5);
      }
    }
    if (this.rec.fires && this.ctx.guns) {
      for (const f of this.rec.fires) {
        if (f.t > prevT && f.t <= t) {
          this.triggerGunFire(f);
        }
      }
    }
    this.lastFiredTime = t;
    if (this.followPid !== null) this.followCamera(dt, t);
    this.ui.update(t);
  }

  place(entity, t) {
    const { life, group } = entity;
    entity.hp = null;
    if (t < life.created || t >= life.destroyed) {
      group.visible = false;
      return;
    }
    const replicated = isReplicated(life, t);
    // A soldier out of the replicated set is in a vehicle, or out of range:
    // there is no pose worth holding.
    if ((life.soldier && !replicated) || (!replicated && !this.showGhosts)) {
      group.visible = false;
      return;
    }
    const s = sampleAt(life, t);
    if (!s) {
      group.visible = false;
      return;
    }
    group.visible = true;
    toViewPosition(s.a.p, group.position);
    toViewQuaternion(s.a.q, group.quaternion);
    if (s.b) {
      group.position.lerp(toViewPosition(s.b.p, this.v1), s.k);
      group.quaternion.slerp(toViewQuaternion(s.b.q, this.q1), s.k);
    }
    // The soldier glb's own root carries a baked 180-degree turn that a
    // vehicle's root doesn't (README §12): toViewQuaternion alone was only
    // ever fitted against vehicles baked into the level scene. Measured
    // exactly 180.00 degrees off at the spawn instant of both soldier lives
    // in replay_20260915-213110.ndjson, against spawnYaw()'s convention.
    if (life.soldier) group.quaternion.multiply(SOLDIER_YAW_FLIP);

    // Aim assist during firing: align soldier model directly towards the target/shot direction
    if (life.soldier && this.rec.fires) {
      const activeFire = this.rec.fires.find(f => Math.abs(t - f.t) <= 0.8);
      if (activeFire && activeFire.dir) {
        const dirVec = new THREE.Vector3(activeFire.dir[0], 0, -activeFire.dir[2]).normalize();
        const lookTarget = group.position.clone().add(dirVec);
        group.lookAt(lookTarget.x, group.position.y, lookTarget.z);
      }
    }
    setGhost(entity, !replicated);
    const hp = hpAt(life, t);
    entity.hp = hp;
    const wrecked = Boolean(entity.wreck) && hp !== null && hp <= 0;
    entity.normal.visible = !wrecked;
    if (entity.wreck) entity.wreck.visible = wrecked;
    if (entity.anim && !wrecked) this.setGaitPose(entity, t);
  }

  /** The followed player's controlled object: their soldier, their vehicle,
   *  or before spawning the spectator camera, which has a pose but no model. */
  focusLife(t) {
    let nid = null;
    for (const c of this.rec.control) {
      if (c.t > t) break;
      if (c.pid === this.followPid) nid = c.nid;
    }
    if (nid === null) return null;
    return this.rec.lives.find(l => l.nid === nid && t >= l.created && t < l.destroyed) || null;
  }

  followCamera(dt, t) {
    const life = this.focusLife(t);
    const s = life && sampleAt(life, t);
    if (!s) return;
    const focus = toViewPosition(s.a.p, this.v1);
    if (s.b) focus.lerp(toViewPosition(s.b.p, this.v2), s.k);
    focus.y += life.soldier ? 1.4 : 2.5;
    const cam = this.ctx.camera;
    const rig = life.tmpl === 'MultiPlayerFreeCamera' ? FOLLOW_SPECTATOR
      : life.soldier ? FOLLOW_SOLDIER : FOLLOW_VEHICLE;
    const pitch = Math.max(this.orbit.pitch, rig.minPitch);
    const offset = this.v3.set(
      Math.sin(this.orbit.yaw) * Math.cos(pitch),
      Math.sin(pitch),
      Math.cos(this.orbit.yaw) * Math.cos(pitch),
    ).multiplyScalar(rig.distance * this.orbit.zoom);
    const desired = this.v2.copy(focus).add(offset);
    const jump = !this.followReady || desired.distanceTo(cam.position) > 150;
    cam.position.lerp(desired, jump ? 1 : 1 - Math.exp(-dt * 4));
    this.followReady = true;
    cam.lookAt(focus);
    // lookAt sets the rotation only. The page refreshed the camera's matrices
    // for its own free-look before this ran, so anything projected through
    // the camera before the render would otherwise use that stale view.
    cam.updateMatrixWorld();
  }

  dispose() {
    if (this.ctx.guns?.collider?.dynamicCast) {
      this.ctx.guns.collider.dynamicCast = null;
    }
    this.ctx.guns?.clear();
    this.ctx.scene.remove(this.root);
    this.ui.dispose();
  }
}

// --- the page -------------------------------------------------------------------

const STYLE = `
.rp-bar { position: absolute; left: 12px; right: 12px; bottom: 12px; z-index: 30;
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; padding: 8px 12px;
  background: var(--panel, rgba(19,19,19,.82)); border: 1px solid var(--line, #2d2d2d);
  border-radius: 6px; color: var(--text, #c8c8c8); font: 12px/1.4 var(--mm-font-mono, monospace); }
.rp-bar button, .rp-bar select { font: inherit; color: var(--text, #c8c8c8); width: auto; margin: 0;
  background: var(--mm-bg-mute, #222); border: 1px solid var(--line, #2d2d2d); border-radius: 4px; padding: 3px 10px; }
.rp-bar button:hover { border-color: var(--accent, #9aa666); }
.rp-bar input[type=range] { flex: 1 1 220px; accent-color: var(--accent, #9aa666); }
.rp-bar label { display: inline-flex; align-items: center; gap: 5px; color: var(--muted, #8a8a8a); }
.rp-time { min-width: 15ch; font-variant-numeric: tabular-nums; }
.rp-clock { color: var(--muted, #8a8a8a); font-variant-numeric: tabular-nums; }
.rp-status { flex-basis: 100%; color: var(--muted, #8a8a8a); font-size: 11px; }
.rp-feed { position: absolute; right: 12px; top: 212px; bottom: 96px; z-index: 30;
  width: min(390px, calc(100% - 24px)); display: flex; flex-direction: column;
  background: var(--panel, rgba(19,19,19,.82)); border: 1px solid var(--line, #2d2d2d);
  border-radius: 6px; font: 12px/1.45 var(--mm-font-mono, monospace); }
.rp-feed-head { display: flex; justify-content: space-between; align-items: center; gap: 8px;
  padding: 6px 10px; border-bottom: 1px solid var(--line, #2d2d2d); color: var(--muted, #8a8a8a); cursor: pointer; }
.rp-feed.collapsed { bottom: auto; }
.rp-feed.collapsed .rp-feed-list { display: none; }
.rp-feed.collapsed .rp-feed-head { border-bottom: 0; }
.rp-feed-list { overflow: auto; min-height: 0; }
.rp-row { display: grid; grid-template-columns: 6ch 6.5ch 1fr; gap: 8px; padding: 3px 10px;
  color: var(--muted, #8a8a8a); cursor: pointer; opacity: .5; }
.rp-row.past { opacity: 1; color: var(--text, #c8c8c8); }
.rp-row.current { background: rgba(154,166,102,.16); }
.rp-row:hover { background: rgba(255,255,255,.05); }
.rp-row.hidden { display: none; }
.rp-row time { font-variant-numeric: tabular-nums; }
.rp-src { font-size: 10px; letter-spacing: .06em; text-transform: uppercase; text-align: center;
  border: 1px solid; border-radius: 3px; padding: 0 3px; align-self: start; }
.rp-src.client { color: var(--accent, #9aa666); border-color: rgba(154,166,102,.5); }
.rp-src.server { color: #d9b36a; border-color: rgba(217,179,106,.5); }
.rp-row.k-destroyed .rp-text, .rp-row.k-destroyVehicle .rp-text { color: #e07a5a; }
.rp-row.k-damage .rp-text { color: #d9b36a; }
.rp-labels { position: absolute; inset: 0; z-index: 25; pointer-events: none; overflow: hidden; }
.rp-label { position: absolute; transform: translate(-50%, -100%); padding: 2px 6px; white-space: nowrap;
  background: rgba(19,19,19,.8); border: 1px solid var(--line, #2d2d2d); border-radius: 4px;
  color: var(--text, #c8c8c8); font: 11px/1.3 var(--mm-font-mono, monospace); }
.rp-label.player { border-color: rgba(154,166,102,.7); color: #fff; }
.rp-hp { height: 4px; margin-top: 3px; background: rgba(255,255,255,.12); border-radius: 2px; overflow: hidden; }
.rp-hp > i { display: block; height: 100%; background: #9aa666; }
.rp-hp.smoke > i { background: #d9b36a; }
.rp-hp.fire > i { background: #e07a5a; }
.rp-toast { position: absolute; left: 50%; top: 16px; transform: translateX(-50%); z-index: 40;
  max-width: calc(100% - 32px); padding: 8px 12px; background: var(--panel, rgba(19,19,19,.9));
  border: 1px solid #d9b36a; border-radius: 6px; color: var(--text, #c8c8c8); font: 12px var(--mm-font-mono, monospace); }
@media (max-width: 720px) {
  .rp-feed { top: auto; bottom: 150px; height: 34%; }
}
`;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function toast(stage, message) {
  const node = el('div', 'rp-toast', message);
  stage.appendChild(node);
  setTimeout(() => node.remove(), 9000);
}

class ReplayUi {
  constructor(player, pids) {
    this.player = player;
    this.stage = player.ctx.stage;
    this.scrubbing = false;
    this.currentRow = -1;
    if (!document.getElementById('rp-style')) {
      const style = el('style');
      style.id = 'rp-style';
      style.textContent = STYLE;
      document.head.appendChild(style);
    }
    const rec = player.rec;

    this.bar = el('div', 'rp-bar');
    this.playBtn = el('button', '', 'Pause');
    this.playBtn.addEventListener('click', () => {
      if (!player.playing && player.time >= rec.duration) player.seek(0);
      player.playing = !player.playing;
    });
    this.timeText = el('span', 'rp-time');
    this.clockText = el('span', 'rp-clock');
    this.range = el('input');
    this.range.type = 'range';
    this.range.min = '0';
    this.range.max = String(rec.duration);
    this.range.step = '0.05';
    this.range.addEventListener('input', () => { this.scrubbing = true; player.seek(Number(this.range.value)); });
    this.range.addEventListener('change', () => { this.scrubbing = false; });
    const speed = el('select');
    for (const s of [0.25, 0.5, 1, 2, 4, 8]) speed.appendChild(new Option(`${s}x`, String(s), s === 1, s === 1));
    speed.addEventListener('change', () => { player.speed = Number(speed.value); });
    const follow = el('select');
    follow.appendChild(new Option('free camera', ''));
    for (const pid of pids) {
      const name = rec.players.get(pid)?.name ?? `player ${pid}`;
      follow.appendChild(new Option(`follow ${name}`, String(pid), pid === player.followPid, pid === player.followPid));
    }
    follow.addEventListener('change', () => {
      player.followPid = follow.value === '' ? null : Number(follow.value);
      player.followReady = false;
    });
    const serverToggle = this.checkbox('server log', player.showServer, on => {
      player.showServer = on;
      this.applyRowFilter();
    });
    serverToggle.title = player.alignment ? 'show the server event log on the level and in the feed'
      : 'load a server log (&serverlog=) to overlay it';
    serverToggle.querySelector('input').disabled = !player.alignment;
    const ghosts = this.checkbox('out-of-range objects', player.showGhosts, on => { player.showGhosts = on; });
    ghosts.title = 'objects announced to the client but beyond its ~520 m update radius';
    this.statusText = el('span', 'rp-status');
    this.bar.append(this.playBtn, this.timeText, this.range, speed, follow, serverToggle, ghosts, this.clockText, this.statusText);

    this.feed = el('div', 'rp-feed');
    const head = el('div', 'rp-feed-head');
    head.append(el('span', '', 'events'), this.legend());
    head.title = 'show or hide the event list';
    head.addEventListener('click', () => this.feed.classList.toggle('collapsed'));
    this.list = el('div', 'rp-feed-list');
    this.feed.append(head, this.list);

    this.labels = el('div', 'rp-labels');
    for (const node of [this.bar, this.feed]) {
      // The view takes pointer-lock on a click; the replay's own controls must
      // not hand the mouse to the camera.
      node.addEventListener('pointerdown', e => e.stopPropagation());
      node.addEventListener('mousedown', e => e.stopPropagation());
      node.addEventListener('keydown', e => e.stopPropagation());
    }
    this.stage.append(this.labels, this.feed, this.bar);
    // The click-to-fly gate would sit over the middle of a replay that needs
    // no mouse; the free camera still takes one when it is chosen.
    const gate = document.getElementById('gate');
    if (gate) gate.hidden = true;

    // Orbiting the followed object: drag, or move the mouse while the view
    // holds the pointer lock; the wheel zooms. Off the replay's own panels.
    const onPanel = e => Boolean(e.target?.closest?.('.rp-bar, .rp-feed'));
    this.onMouseMove = e => {
      if (player.followPid === null || onPanel(e)) return;
      if (!document.pointerLockElement && !(e.buttons & 1)) return;
      player.orbit.yaw -= e.movementX * 0.005;
      player.orbit.pitch = Math.min(1.45, Math.max(-0.15, player.orbit.pitch + e.movementY * 0.004));
    };
    this.onWheel = e => {
      if (player.followPid === null || onPanel(e)) return;
      player.orbit.zoom = Math.min(6, Math.max(0.2, player.orbit.zoom * Math.exp(e.deltaY * 0.0012)));
    };
    document.addEventListener('mousemove', this.onMouseMove);
    this.stage.addEventListener('wheel', this.onWheel, { passive: true });
  }

  checkbox(text, checked, onChange) {
    const label = el('label');
    const input = el('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.addEventListener('change', () => onChange(input.checked));
    label.append(input, document.createTextNode(text));
    return label;
  }

  legend() {
    const wrap = el('span');
    wrap.append(el('span', 'rp-src client', 'client'), document.createTextNode(' '), el('span', 'rp-src server', 'server'));
    return wrap;
  }

  status(text) {
    this.statusText.textContent = text;
  }

  renderFeed() {
    this.list.textContent = '';
    this.rowNodes = this.player.rows.map(row => {
      const node = el('div', `rp-row k-${row.kind}`);
      node.append(el('time', '', fmtTime(row.t)), el('span', `rp-src ${row.source}`, row.source), el('span', 'rp-text', row.text));
      node.addEventListener('click', () => this.player.seek(row.t - 1.5));
      this.list.appendChild(node);
      return node;
    });
    this.applyRowFilter();
  }

  applyRowFilter() {
    if (!this.rowNodes) return;
    this.player.rows.forEach((row, i) => {
      this.rowNodes[i].classList.toggle('hidden', row.source === 'server' && !this.player.showServer);
    });
  }

  update(t) {
    const player = this.player;
    const rec = player.rec;
    this.playBtn.textContent = player.playing ? 'Pause' : 'Play';
    this.timeText.textContent = `${fmtTime(t)} / ${fmtTime(rec.duration)}`;
    if (!this.scrubbing) this.range.value = String(t);
    const clock = roundClock(rec, t);
    this.clockText.textContent = clock === null ? '' : `round ${fmtTime(clock).replace(/\.\d$/, '')}`;

    if (this.rowNodes) {
      let index = -1;
      const rows = player.rows;
      let lo = 0;
      let hi = rows.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (rows[mid].t <= t) { index = mid; lo = mid + 1; } else hi = mid - 1;
      }
      if (index !== this.currentRow) {
        const from = Math.min(index, this.currentRow) + 1;
        const to = Math.max(index, this.currentRow);
        for (let i = Math.max(0, from - 1); i <= to && i < rows.length; i++) {
          if (i >= 0) this.rowNodes[i].classList.toggle('past', i <= index);
        }
        if (this.currentRow >= 0) this.rowNodes[this.currentRow]?.classList.remove('current');
        if (index >= 0) {
          this.rowNodes[index].classList.add('current');
          if (!this.list.matches(':hover')) this.rowNodes[index].scrollIntoView({ block: 'nearest' });
        }
        this.currentRow = index;
      }
    }
    this.updateLabels(t);
  }

  updateLabels(t) {
    const player = this.player;
    const camera = player.ctx.camera;
    // This runs before the frame's render, and projects through the camera:
    // its matrices must describe where it points now.
    camera.updateMatrixWorld();
    const width = this.stage.clientWidth;
    const height = this.stage.clientHeight;
    const focus = player.followPid !== null ? player.focusLife(t) : null;
    const name = player.followPid !== null ? (player.rec.players.get(player.followPid)?.name ?? '') : '';
    const v = player.v2;
    for (const entity of player.entities) {
      const { life } = entity;
      const isFocus = focus === life;
      const damaged = life.maxhp > 0 && entity.hp !== null && entity.hp < life.maxhp;
      let show = entity.group.visible && !entity.ghost && (isFocus || damaged);
      if (show) {
        v.copy(entity.group.position);
        v.y += life.soldier ? 2.2 : 4.5;
        const distance = v.distanceTo(camera.position);
        v.project(camera);
        show = distance < LABEL_RANGE && v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      }
      if (!show) {
        if (entity.label) entity.label.style.display = 'none';
        continue;
      }
      if (!entity.label) {
        entity.label = el('div', 'rp-label');
        entity.label.append(el('div', 'rp-label-text'), el('div', 'rp-hp'));
        entity.label.lastChild.appendChild(el('i'));
        this.labels.appendChild(entity.label);
      }
      const label = entity.label;
      label.style.display = '';
      label.style.left = `${((v.x + 1) / 2) * width}px`;
      label.style.top = `${((1 - v.y) / 2) * height}px`;
      label.classList.toggle('player', isFocus);
      const hp = entity.hp;
      const text = isFocus ? (life.soldier ? name : `${name} · ${life.tmpl}`) : life.tmpl;
      label.firstChild.textContent = life.maxhp > 0 && hp !== null
        ? `${text} ${hp <= 0 ? 'wreck' : `${fmtHp(Math.round(hp * 10) / 10)}/${fmtHp(life.maxhp)}`}`
        : text;
      const bar = label.lastChild;
      bar.style.display = life.maxhp > 0 && hp !== null ? '' : 'none';
      if (life.maxhp > 0 && hp !== null) {
        bar.firstChild.style.width = `${Math.max(0, Math.min(1, hp / life.maxhp)) * 100}%`;
        // The recording carries the fire threshold; the smoke threshold is a
        // per-template armor effect it does not, and half health is where the
        // vanilla vehicles put it.
        bar.classList.toggle('fire', life.crit > 0 && hp <= life.crit);
        bar.classList.toggle('smoke', hp <= life.maxhp / 2 && !(life.crit > 0 && hp <= life.crit));
      }
    }
  }

  dispose() {
    document.removeEventListener('mousemove', this.onMouseMove);
    this.stage.removeEventListener('wheel', this.onWheel);
    this.bar.remove();
    this.feed.remove();
    this.labels.remove();
  }
}

// --- entry points for map.html --------------------------------------------------

const textCache = new Map();

function fetchText(url) {
  if (!textCache.has(url)) {
    textCache.set(url, fetch(url).then(r => {
      if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
      return r.text();
    }));
  }
  return textCache.get(url);
}

/** The level a recording was made on, from its SetLevel event. */
export async function recordingLevel(url) {
  return parseRecording(await fetchText(url)).level;
}

/**
 * The replay controller map.html creates once its level is showing.
 *
 * ctx: { scene, camera, loader, stage, bust, modelsBase, levelName(),
 *        hideBakedVehicles() }
 */
export function createReplayController(ctx) {
  let player = null;

  async function open({ recordingText, logText, label }) {
    const rec = parseRecording(recordingText);
    const level = ctx.levelName();
    if (rec.level && level && rec.level.toLowerCase() !== level.toLowerCase()) {
      toast(ctx.stage, `${label} was recorded on ${rec.level}, and this view shows ${level}. Open it with ?map=${rec.level}.`);
      return null;
    }
    player?.dispose();
    const log = logText ? parseServerLog(logText) : null;
    const alignment = log ? alignServerLog(rec, log) : null;
    player = new ReplayPlayer(ctx, rec, log, alignment, label);
    if (typeof window !== 'undefined') window.replay = player;
    await player.load();
    return player;
  }

  ctx.stage.addEventListener('dragover', e => {
    if ([...(e.dataTransfer?.items || [])].some(item => item.kind === 'file')) e.preventDefault();
  });
  ctx.stage.addEventListener('drop', async e => {
    const files = [...(e.dataTransfer?.files || [])];
    const recording = files.find(f => /\.ndjson$/i.test(f.name));
    if (!recording) return;
    e.preventDefault();
    const log = files.find(f => /\.xml$/i.test(f.name));
    open({ recordingText: await recording.text(), logText: log ? await log.text() : null, label: recording.name })
      .catch(error => toast(ctx.stage, `could not play ${recording.name}: ${error.message}`));
  });

  return {
    update(dt) {
      player?.update(dt);
    },
    async openFromUrl(url, logUrl) {
      const [recordingText, logText] = await Promise.all([
        fetchText(url),
        logUrl ? fetchText(logUrl).catch(() => null) : null,
      ]);
      return open({ recordingText, logText, label: url.split('/').pop() });
    },
  };
}
