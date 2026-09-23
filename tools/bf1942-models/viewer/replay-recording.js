// A bf42plus round recording, read into object lives and sampled at a time:
// the part of the replay that is a pure function of the recording's text.
// Recording formats 1-3 are read; what an older format lacks (hit points and
// the player's own chat arrived in v3) is simply absent. bfstats
// features/round-replay-capture/README.md documents the format and how each
// mapping here was measured.

// --- conventions --------------------------------------------------------------

// Recorded samples are written at 10 Hz, and only when an object moved: a
// longer gap between two samples means it held still until the period before
// the later one, not that it drifted across the whole gap.
const SAMPLE_PERIOD = 0.1;

const SCORE_TEXT = {
  0: 'captured a flag', 1: 'scored an attack', 2: 'scored a defence', 3: 'killed',
  6: 'team-killed', 8: 'completed an objective', 9: 'team-killed on an objective',
};
const GAME_STATUS = { 1: 'round playing', 2: 'round over', 3: 'pre-game', 4: 'paused', 5: 'map over' };

export const teamName = team => (team === 1 ? 'Axis' : team === 2 ? 'Allies' : 'no team');
export const fmtHp = v => (Number.isInteger(v) ? String(v) : v.toFixed(1));

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

// --- sampling a life at a time --------------------------------------------------

export function sampleAt(life, t) {
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

export function hpAt(life, t) {
  let hp = null;
  for (const entry of life.hp) {
    if (entry.t > t) break;
    hp = entry.hp;
  }
  return hp;
}

export const isReplicated = (life, t) => life.replicated.some(([from, to]) => t >= from && t < to);

function weaponForKitTemplate(tmpl) {
  if (!tmpl) return 'Colt';
  if (/_AT$/i.test(tmpl) || /bazooka|panzershreck|at/i.test(tmpl)) return 'Bazooka';
  if (/_Assault$/i.test(tmpl) || /bar1918|stg44/i.test(tmpl)) return 'Bar1918';
  if (/_Scout$/i.test(tmpl) || /sniper|k98/i.test(tmpl)) return 'No4Sniper';
  if (/_Engineer$/i.test(tmpl) || /garand|engineer/i.test(tmpl)) return 'M1Garand';
  if (/_Medic$/i.test(tmpl) || /thompson|mp18|medic/i.test(tmpl)) return 'Thompson';
  return 'Colt';
}

export function placeholderWeaponFor(life) {
  if (life && life.weapon) return life.weapon;
  if (life && life.kitTemplate) return weaponForKitTemplate(life.kitTemplate);
  return 'Colt';
}
