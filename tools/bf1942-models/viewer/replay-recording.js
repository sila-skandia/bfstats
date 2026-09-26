// A bf42plus round recording, read into object lives and sampled at a time:
// the part of the replay that is a pure function of the recording's text.
// Recording formats 1-4 are read; what an older format lacks (hit points and
// the player's own chat arrived in v3, every shot, the turrets, the engines
// and the seats in v4) is simply absent. bfstats
// features/round-replay-capture/README.md documents the format and how each
// mapping here was measured.

// --- conventions --------------------------------------------------------------

// Recorded samples are written at 10 Hz, and only when an object moved: a
// longer gap between two samples means it held still until the period before
// the later one, not that it drifted across the whole gap.
const SAMPLE_PERIOD = 0.1;

// `ScoreMsg`'s event ids (bf42plus gameevent.h): FLAGCAPTURE 0, ATTACK 1,
// DEFENCE 2, KILL 3, DEATH 4, DEATHNOMSG 5, TK 6, SPAWNED 7, OBJECTIVE 8,
// OBJECTIVETK 9. A KILL and a TK name the dead man in `victim`; a DEATH and a
// DEATHNOMSG name him in `pid` and leave `victim` uninitialised.
export const SCORE = Object.freeze({
  CAPTURE: 0, ATTACK: 1, DEFENCE: 2, KILL: 3, DEATH: 4, DEATH_NO_MSG: 5, TEAMKILL: 6,
  SPAWNED: 7, OBJECTIVE: 8, OBJECTIVE_TEAMKILL: 9,
});
const SCORE_TEXT = {
  0: 'captured a flag', 1: 'scored an attack', 2: 'scored a defence', 3: 'killed',
  6: 'team-killed', 8: 'completed an objective', 9: 'team-killed on an objective',
};
const GAME_STATUS = { 1: 'round playing', 2: 'round over', 3: 'pre-game', 4: 'paused', 5: 'map over' };

// How far past a root's network id its seats' ids can reach. The server hands
// a template's nested PlayerControlObjects the ids straight after the root's
// (a Sherman at 532 has its hull gun at 533, the Shokaku at 534 its four AA
// batteries at 535..538, measured in replay_20260927-001120), and the most a
// vanilla hull carries is an M3A1's seven.
const MAX_SEATS = 12;

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

/** What a template name says the object is. Kits are recognised by what
 *  picked them up (0x23), not by name, so they are marked later. */
function classify(life) {
  const tmpl = life.tmpl || '';
  life.soldier = /soldier/i.test(tmpl);
  life.camera = /camera/i.test(tmpl);
  life.projectile = /projectile$/i.test(tmpl);
}

/**
 * A recording as lives: one per object lifetime, from its creation (event 0x07,
 * or first sight in recordings that started mid-round) to its destruction
 * (event 0x06). A respawned vehicle is a new life with a new network id.
 *
 * Beside the lives, who was where: every player's controlled object over time
 * (`controlledAt`), which a seat id resolves to the hull it belongs to
 * (`rootOf`), each soldier's player, kit and moment of death, and every shot.
 */
export function parseRecording(text) {
  const rec = {
    version: 1,
    start: '',
    duration: 0,
    level: '',
    modeFile: '',
    server: '',
    lives: [],
    players: new Map(),   // pid -> { name, team, ai, joinNid, joinKitNid }
    control: [],          // { t, pid, team, nid } from player records
    chat: [],             // { t, pid, team, text, body }
    events: [],           // feed rows
    clocks: [],           // { t, seconds, exact }
    matchable: [],        // { t, kind, text } for aligning a server log
    fires: [],            // { t, pid, kind, weapon, pos, dir, nid? } one per shot (v4) or per trigger press (v3)
    deaths: [],           // { t, pid } a player's death, as the score stream reports it
    joints: new Map(),    // v4: root nid -> Map<part nid, { name, keys: [{ t, q }] }>
    engines: new Map(),   // v4: root nid -> Map<engine nid, [{ t, revs, throttle, running, disabled, gear }]>
    stances: new Map(),   // v4: soldier nid -> [{ t, lower, upper, pitch, twist, item, bits }]
    animStates: [],       // v4: index -> { name, flags }, the engine's animation state table
    seats: new Map(),     // v4: pid -> [{ t, root, seat }]
    roundStats: new Map(),// pid -> { destroyed, fired, hit: [{ tid, tmpl, n }] } (0x30..0x32)
    timeLimit: 0,         // the round's time limit, seconds (0x29); 0 is none
    roundEnded: Infinity, // the first round-over status: the teardown after it is not play
  };
  const current = new Map();
  const tidNames = new Map();
  const kitIds = new Set();
  const cpTemplates = new Set();
  const cpState = new Map();
  const deferred = [];
  const kitPickups = [];        // { t, pid, nid }
  const nidEvents = [];         // { t, pid, nid } every report of what a player controls
  let joined = -Infinity;

  const row = (t, kind, text) => {
    const entry = { t, kind, text, source: 'client' };
    rec.events.push(entry);
    return entry;
  };
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
  const jointOf = (root, nid) => {
    if (!rec.joints.has(root)) rec.joints.set(root, new Map());
    const parts = rec.joints.get(root);
    if (!parts.has(nid)) parts.set(nid, { name: '', keys: [] });
    return parts.get(nid);
  };
  const closeReplicated = (life, t) => {
    const last = life.replicated[life.replicated.length - 1];
    if (last && last[1] === Infinity) last[1] = t;
  };

  /** A pool of rounds a kit carries, `count` objects from `first`. */
  function projectilePool(t, tid, first, count, tmpl) {
    for (let i = 0; i < Math.max(0, Math.min(count, 64)); i++) {
      const life = lifeFor(first + i, t);
      life.tid = tid;
      if (tmpl) life.tmpl = tmpl;
      life.created = Math.min(life.created, t);
      life.pooled = true;
    }
  }

  /** One player's round-end tally of one kind, by template. */
  function roundStat(t, stat, pid, rows) {
    if (!rec.roundStats.has(pid)) rec.roundStats.set(pid, { t, destroyed: [], fired: [], hit: [] });
    const entry = rec.roundStats.get(pid);
    for (const row of rows) entry[stat].push({ tid: row.tid, tmpl: row.tmpl ?? null, n: row.n });
  }

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
      case 0x09:
        nidEvents.push({ t, pid: b[0], nid: u16(1) });
        return;
      case 0x0a:
        deferred.push({ t, type: 'enter', pid: b[0], nid: u16(1) });
        nidEvents.push({ t, pid: b[0], nid: u16(1) });
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
        kitPickups.push({ t, pid: b[0], nid: u16(1) });
        rec.matchable.push({ t, kind: 'pickupKit' });
        return;
      case 0x36:
        rec.level = cString(b, 0, 64).split('/').filter(Boolean).pop() || rec.level;
        rec.modeFile = cString(b, 64, 64) || rec.modeFile;
        return;
      case 0x13:
        if (!rec.level) rec.level = cString(b, 4, 64);
        return;
      case 0x1b:
        rec.server = cString(b, 0, 32);
        return;
      case 0x04:
        // SimulationEvent: u8 running, f32 the server's world time, sent once
        // as this client's database completes.
        if (b.length >= 5) rec.clocks.push({ t, seconds: view.getFloat32(1, true), exact: true });
        return;
      case 0x29:
        // TimerSyncEvent, every 10 s: u32 time limit (0 none), u32 world time
        // rounded to the second.
        if (b.length >= 8) {
          rec.clocks.push({ t, seconds: view.getUint32(4, true), exact: false });
          rec.timeLimit = view.getUint32(0, true);
        }
        return;
      case 0x05:
        // CreateMultipleObjectsEvent: u32 template, u16 first network id, i32
        // count -- a kit's projectile pool (grenades, mines, charges), made at
        // its spawn, disabled until thrown.
        if (b.length >= 10) projectilePool(t, view.getUint32(0, true), u16(4), view.getInt32(6, true), r.tmpl);
        return;
      case 0x30:
      case 0x31:
      case 0x32: {
        // StatsKills/Shots/HitsEvent at the round's end: u8 rows-1, u8 player,
        // u32[10] template ids, u16[10] counts; only the first rows are real.
        if (b.length < 62) return;
        const n = b[0] + 1;
        const rows = [];
        for (let i = 0; i < Math.min(n, 10); i++) {
          rows.push({ tid: view.getUint32(2 + 4 * i, true), n: view.getUint16(42 + 2 * i, true) });
        }
        roundStat(t, ['destroyed', 'fired', 'hit'][r.type - 0x30], b[1], rows);
        return;
      }
      default:
        return;
    }
  }

  function parseEvent(r, t) {
    switch (r.e) {
      case 'createPlayer':
        rec.players.set(r.pid, {
          name: r.name, team: r.team, ai: Boolean(r.ai), joinT: t,
          joinNid: r.vehNetId ?? null, joinKitNid: r.kitNetId ?? null, camNid: r.camNetId ?? null,
        });
        if (r.vehNetId) nidEvents.push({ t, pid: r.pid, nid: r.vehNetId });
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
        if (t < rec.roundEnded) {
          if (r.kind === SCORE.KILL || r.kind === SCORE.TEAMKILL) rec.deaths.push({ t, pid: r.victim, killer: r.pid, weapon: r.weaponName ?? null });
          else if (r.kind === SCORE.DEATH || r.kind === SCORE.DEATH_NO_MSG) rec.deaths.push({ t, pid: r.pid, killer: null, weapon: null });
        }
        if (r.kind === SCORE.SPAWNED) {
          row(t, 'spawn', `${playerName(r.pid)} spawned`);
        } else if (r.kind === SCORE.KILL || r.kind === SCORE.TEAMKILL) {
          const how = r.weaponName ? ` with ${r.weaponName}` : '';
          row(t, 'kill', `${playerName(r.pid)} ${SCORE_TEXT[r.kind]} ${playerName(r.victim)}${how}`);
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
        if ((r.status === 2 || r.status === 5) && rec.roundEnded === Infinity) rec.roundEnded = t;
        row(t, 'round', GAME_STATUS[r.status] ?? `game status ${r.status}`);
        return;
      case 'dbComplete':
        joined = t;
        return;
      case 'createObject': {
        if (r.netId) {
          const life = lifeFor(r.netId, t);
          if (r.tmpl) life.tmpl = r.tmpl;
          if (r.tid) {
            life.tid = r.tid;
            if (r.tmpl) tidNames.set(r.tid, r.tmpl);
          }
          if (r.pos && r.rot) life.pose = { p: r.pos, q: eulerToQuaternion(r.rot) };
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
      case 'control':
        // `PlayerControlObject`: the object a player now controls -- his
        // soldier on spawning, his free camera when he dies.
        if (r.pid !== undefined && r.netId) nidEvents.push({ t, pid: r.pid, nid: r.netId });
        return;
      case 'enterVehicle':
        if (r.pid !== undefined && r.netId) {
          deferred.push({ t, type: 'enter', pid: r.pid, nid: r.netId });
          nidEvents.push({ t, pid: r.pid, nid: r.netId });
          rec.matchable.push({ t, kind: 'enterVehicle' });
        }
        return;
      case 'exitVehicle':
        if (r.pid !== undefined) {
          deferred.push({ t, type: 'exit', pid: r.pid });
          rec.matchable.push({ t, kind: 'exitVehicle' });
        }
        return;
      case 'pickupKit':
        rec.matchable.push({ t, kind: 'pickupKit' });
        if (r.netId) kitIds.add(r.netId);
        if (r.pid !== undefined && r.netId) kitPickups.push({ t, pid: r.pid, nid: r.netId });
        return;
      case 'setLevel':
        rec.level = String(r.level || '').split('/').filter(Boolean).pop() || rec.level;
        rec.modeFile = r.mode || rec.modeFile;
        return;
      case 'simStart':
        rec.clocks.push({ t, seconds: r.worldTime, exact: true });
        return;
      case 'clock':
        rec.clocks.push({ t, seconds: r.worldTime, exact: false });
        rec.timeLimit = r.timeLimit ?? rec.timeLimit;
        return;
      case 'serverName':
        rec.server = r.name ?? rec.server;
        return;
      case 'projPool':
        projectilePool(t, r.tid, r.netId, r.count, r.tmpl);
        return;
      case 'roundStats':
        roundStat(t, r.stat, r.pid, r.rows ?? []);
        return;
      case 'fire':
        // v3's shot: the recording player's own trigger press, from his input
        // (so one per press, not per round, and nobody else's). `weapon` is
        // the template of the object he controlled -- his soldier on foot --
        // and `pos`/`dir` that object's origin and forward axis.
        rec.fires.push({ t, pid: r.pid, kind: r.kind, weapon: r.weapon, pos: r.pos, dir: r.dir, press: true });
        return;
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
        // [pid, team, vehicle] from v1; v4 appends [root, seat]: the hull the
        // controlled object belongs to and the seat's place among its nested
        // PlayerControlObjects, 0 for the root seat itself.
        for (const entry of r.p) {
          const [pid, team, nid] = entry;
          rec.control.push({ t, pid, team, nid });
          nidEvents.push({ t, pid, nid });
          if (entry.length >= 5 && entry[3] >= 0) {
            if (!rec.seats.has(pid)) rec.seats.set(pid, []);
            rec.seats.get(pid).push({ t, root: entry[3], seat: entry[4] });
          }
        }
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
      case 'f':
        // v4: one round leaving a weapon, any weapon the client simulates.
        // `id` the root object it hangs under, `w` the weapon's template,
        // `p`/`d` the muzzle and the round's direction.
        rec.fires.push({ t, pid: r.pid ?? null, nid: r.id ?? null, kind: r.alt ? 2 : 1,
                         weapon: r.w ?? '', pos: r.p ?? null, dir: r.d ?? null, press: false,
                         local: Boolean(r.local) });
        break;
      case 'jn':
        // v4: a moving part's name, on first sight: `[root, part, template]`.
        for (const [root, nid, name] of r.o) jointOf(root, nid).name = name;
        break;
      case 'j':
        // v4: a moving part's rotation relative to its root object (a turret's
        // traverse, a gun's elevation), `[root, part, qx, qy, qz, qw]`.
        for (const [root, nid, qx, qy, qz, qw] of r.o) jointOf(root, nid).keys.push({ t, q: [qx, qy, qz, qw] });
        break;
      case 'g':
        // v4: an engine, `[root, revs, throttle servo, flags, gear, engine]`:
        // flags 1 running, 2 disabled by damage.
        for (const [root, revs, throttle, flags, gear, nid] of r.o) {
          if (!rec.engines.has(root)) rec.engines.set(root, new Map());
          const engines = rec.engines.get(root);
          const key = nid ?? root;
          if (!engines.has(key)) engines.set(key, []);
          engines.get(key).push({ t, revs, throttle, running: Boolean(flags & 1), disabled: Boolean(flags & 2), gear });
        }
        break;
      case 'st':
        // v4: a soldier's body, `[soldier, lower state, upper state, aim
        // pitch, torso twist, held item, state bits]`.
        for (const [nid, lower, upper, pitch, twist, item, bits] of r.o) {
          if (!rec.stances.has(nid)) rec.stances.set(nid, []);
          rec.stances.get(nid).push({ t, lower, upper, pitch, twist, item, bits });
        }
        break;
      case 'anim':
        // v4: the engine's animation state table, once: `[index, name, flags]`.
        for (const [index, name, flags] of r.states ?? []) rec.animStates[index] = { name, flags };
        break;
      default:
        break;
    }
  }

  // Names for lives announced only by template id (before v3), from any object
  // of the same template the client did replicate.
  for (const life of rec.lives) {
    if (!life.tmpl && life.tid) life.tmpl = tidNames.get(life.tid) || '';
    classify(life);
    life.kit = kitIds.has(life.nid);
    life.controlPoint = cpTemplates.has(life.tmpl);
    // DataBaseComplete arrives after the join-time burst of creations, so
    // whether an object spawned during play can only be decided here.
    life.spawnedLate = Boolean(life.announced) && life.created > joined + 1;
  }
  // A kit is also whatever a player carried at the join, before any pickup,
  // and anything else of a template a kit was: a kit dropped by a dead man
  // lies on the ground as the same template until somebody takes it.
  for (const player of rec.players.values()) {
    const kit = player.joinKitNid ? lifeAtIn(rec.lives, player.joinKitNid, player.joinT) : null;
    if (kit) kit.kit = true;
  }
  const kitTemplates = new Set(rec.lives.filter(l => l.kit && l.tmpl).map(l => l.tmpl.toLowerCase()));
  for (const life of rec.lives) {
    if (!life.kit && life.tmpl && kitTemplates.has(life.tmpl.toLowerCase())) life.kit = true;
  }

  // The round-end tallies, named where the recording knows the template, one
  // feed row a player.
  for (const [pid, entry] of rec.roundStats) {
    const words = [];
    for (const stat of ['destroyed', 'fired', 'hit']) {
      for (const row of entry[stat]) row.tmpl = row.tmpl || tidNames.get(row.tid) || `template ${row.tid}`;
      if (entry[stat].length) words.push(`${stat} ${entry[stat].map(x => `${x.tmpl} x${x.n}`).join(', ')}`);
    }
    if (words.length) row(entry.t, 'stats', `${playerName(pid)}: ${words.join('; ')}`);
  }

  // Who controlled what, per player, as a list of changes in time order.
  rec.playerNids = new Map();
  nidEvents.sort((a, b) => a.t - b.t);
  for (const { t, pid, nid } of nidEvents) {
    if (!rec.playerNids.has(pid)) rec.playerNids.set(pid, []);
    const list = rec.playerNids.get(pid);
    const last = list[list.length - 1];
    if (last && last.nid === nid) continue;
    list.push({ t, nid });
  }

  // Each soldier's player: a soldier object is made for one spawn of one
  // player, and whoever controls it is its owner for its whole life.
  for (const [pid, list] of rec.playerNids) {
    for (const { t, nid } of list) {
      const life = lifeAtIn(rec.lives, nid, t);
      if (life?.soldier && life.pid === undefined) life.pid = pid;
    }
  }

  // Each soldier's kit: what his player picked up at the spawn (0x23), or
  // carried at the join (CreatePlayer's kit id). Never another player's.
  const soldierOf = (pid, t) => {
    let best = null;
    for (const life of rec.lives) {
      if (!life.soldier || life.pid !== pid || life.created > t + 0.5 || t >= life.destroyed) continue;
      if (!best || life.created > best.created) best = life;
    }
    return best;
  };
  for (const { t, pid, nid } of kitPickups) {
    const soldier = soldierOf(pid, t);
    const kit = lifeAtIn(rec.lives, nid, t + 0.5);
    if (soldier && kit?.tmpl) soldier.kitTemplate = kit.tmpl;
  }
  for (const [pid, player] of rec.players) {
    const soldier = player.joinNid ? lifeAtIn(rec.lives, player.joinNid, player.joinT) : null;
    if (!soldier?.soldier || soldier.kitTemplate) continue;
    if (soldier.pid === undefined) soldier.pid = pid;
    const kit = player.joinKitNid ? lifeAtIn(rec.lives, player.joinKitNid, player.joinT) : null;
    if (kit?.tmpl) soldier.kitTemplate = kit.tmpl;
  }

  // Each soldier's death: the score stream's death for his player, else the
  // moment his player stopped controlling him while the body stayed (to his
  // free camera). The body lies until the server removes it (0x06).
  for (const life of rec.lives) {
    if (!life.soldier || life.pid === undefined) continue;
    const end = Math.min(life.destroyed, rec.roundEnded);
    const death = rec.deaths.find(d => d.pid === life.pid && d.t >= life.created && d.t < end + 0.05);
    if (death) {
      life.diedAt = death.t;
      life.killer = death.killer;
      continue;
    }
    const list = rec.playerNids.get(life.pid) || [];
    const handover = list.find(c => c.t > life.created && c.t < end
      && lifeAtIn(rec.lives, c.nid, c.t)?.camera);
    if (handover) life.diedAt = handover.t;
  }

  // A v4 recording has every round (`f`), the recording player's included;
  // its presses (the input edge v3 recorded) then stay in the feed and fire
  // nothing, or his rounds would fire twice.
  if (rec.fires.some(f => !f.press)) {
    for (const f of rec.fires) if (f.press) f.feedOnly = true;
  }

  // v3's press records name the controlled object's template, which on foot
  // is the soldier. The viewer wants what was in his hands.
  for (const f of rec.fires) {
    if (!f.press || f.pid === undefined || f.pid === null) continue;
    const nid = controlledAt(rec, f.pid, f.t);
    const life = nid !== null ? lifeAtIn(rec.lives, nid, f.t) : null;
    f.soldier = Boolean(life?.soldier);
    if (life?.soldier) f.kitTemplate = life.kitTemplate ?? null;
  }
  rec.fires.sort((a, b) => a.t - b.t);
  // One row per trigger press (v3); a v4 recording's every round is too many
  // for the feed. A soldier's weapon is named once the loadouts are known
  // (replay.js), his kit until then.
  for (const f of rec.fires) {
    if (!f.press) continue;
    f.row = row(f.t, 'fire', `${playerName(f.pid)} fired ${f.soldier ? (f.kitTemplate ?? 'a weapon') : (f.weapon || 'a weapon')}`);
    f.shooter = playerName(f.pid);
  }

  const lifeAt = (nid, t) => rec.lives.find(l => l.nid === nid && l.created <= t + 0.5 && t < l.destroyed);

  for (const d of deferred) {
    if (d.type === 'enter') {
      const root = rootOf(rec, d.nid, d.t);
      const what = root?.life.tmpl || lifeAt(d.nid, d.t)?.tmpl || `object ${d.nid}`;
      row(d.t, 'vehicle', `${playerName(d.pid)} got into ${what}${root?.seat ? ` (seat ${root.seat + 1})` : ''}`);
    } else {
      row(d.t, 'vehicle', `${playerName(d.pid)} got out`);
    }
  }

  for (const life of rec.lives) {
    if (life.kit || life.controlPoint || life.camera || life.projectile || !life.tmpl) continue;
    for (let i = 1; i < life.hp.length; i++) {
      const before = life.hp[i - 1].hp;
      const after = life.hp[i].hp;
      const t = life.hp[i].t;
      // Below critical damage hit points drain a little every sample; only a
      // real hit, the fire starting and the kill are worth a row.
      if (after <= 0 && before > 0) {
        if (!life.soldier) {
          life.killedAt = t;
          row(t, 'destroyed', `${life.tmpl} destroyed`);
        }
      } else if (after < before - 0.5) {
        if (!life.soldier) row(t, 'damage', `${life.tmpl} hit: ${fmtHp(before)} → ${fmtHp(after)} of ${fmtHp(life.maxhp)}`);
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

/** The life of `nid` at `t`: the one created by then (half a second of
 *  slack, since a creation and its first use share a packet) and not yet
 *  destroyed. */
function lifeAtIn(lives, nid, t) {
  let best = null;
  for (const l of lives) {
    if (l.nid !== nid || l.created > t + 0.5 || t >= l.destroyed) continue;
    if (!best || l.created > best.created) best = l;
  }
  return best;
}

export function lifeAt(rec, nid, t) {
  return lifeAtIn(rec.lives, nid, t);
}

/** The network id `pid` controlled at `t`: his soldier, a seat, his free
 *  camera, or null before anything was reported. */
export function controlledAt(rec, pid, t) {
  const list = rec.playerNids?.get(pid);
  if (!list?.length) return null;
  let lo = 0;
  let hi = list.length - 1;
  if (t < list[0].t) return null;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (list[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  return list[lo].nid;
}

/**
 * The hull a controlled network id belongs to, as `{ life, seat }`: the life
 * itself with seat 0 when it is a root object, else the root whose id the
 * seat's follows (a hull's nested PlayerControlObjects take the ids after its
 * own), with the seat's place among them. A v4 recording names the root
 * itself (`seats`), which wins.
 */
export function rootOf(rec, nid, t, pid = null) {
  if (nid === null || nid === undefined) return null;
  if (pid !== null && rec.seats?.has(pid)) {
    const list = rec.seats.get(pid);
    let hit = null;
    for (const s of list) {
      if (s.t > t) break;
      hit = s;
    }
    if (hit && hit.root >= 0) {
      const life = lifeAtIn(rec.lives, hit.root, t);
      if (life) return { life, seat: hit.seat };
    }
  }
  const own = lifeAtIn(rec.lives, nid, t);
  if (own && !own.kit && !own.projectile) return { life: own, seat: 0 };
  let best = null;
  for (const l of rec.lives) {
    if (l.nid >= nid || nid - l.nid > MAX_SEATS) continue;
    if (l.created > t + 0.5 || t >= l.destroyed) continue;
    if (l.soldier || l.kit || l.camera || l.controlPoint || l.projectile) continue;
    if (!best || l.nid > best.nid) best = l;
  }
  return best ? { life: best, seat: nid - best.nid } : null;
}

/** Everyone aboard `life` at `t`, as `[{ pid, seat }]`. */
export function crewOf(rec, life, t) {
  const crew = [];
  for (const pid of rec.playerNids?.keys() ?? []) {
    const nid = controlledAt(rec, pid, t);
    if (nid === null) continue;
    if (nid !== life.nid && (nid < life.nid || nid - life.nid > MAX_SEATS)) continue;
    const root = rootOf(rec, nid, t, pid);
    if (root?.life === life) crew.push({ pid, seat: root.seat });
  }
  return crew;
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

/** The recorded position at `t`, interpolated as `sampleAt` does, into `out`
 *  (a plain array); null when the life has no pose at all. */
export function positionAt(life, t, out = [0, 0, 0]) {
  const s = sampleAt(life, t);
  if (!s) return null;
  const a = s.a.p;
  if (!s.b) {
    out[0] = a[0]; out[1] = a[1]; out[2] = a[2];
    return out;
  }
  const b = s.b.p;
  out[0] = a[0] + (b[0] - a[0]) * s.k;
  out[1] = a[1] + (b[1] - a[1]) * s.k;
  out[2] = a[2] + (b[2] - a[2]) * s.k;
  return out;
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

/** The last v4 record in a time-ordered list at or before `t`, or null. */
export function latestAt(list, t) {
  if (!list?.length || t < list[0].t) return null;
  let lo = 0;
  let hi = list.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (list[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  return list[lo];
}

// The kit rows' primaries, for a maps tree with no `_shared/loadouts.json`
// entry for the kit: vanilla's own per nation, in the spawn screen's row order
// (scout, assault, anti-tank, medic, engineer), from the same
// `Objects/Items/<Nation>Kit/*/Objects.con` the extractor reads -- the table
// kit-loadout.js keeps as FALLBACK_PRIMARIES. The file wins whenever it knows
// the kit.
const NATION_PRIMARIES = {
  us: ['No4Sniper', 'Bar1918', 'Bazooka', 'Thompson', 'M1Garand'],
  brit: ['No4Sniper', 'Bar1918', 'Bazooka', 'Thompson', 'No4'],
  rus: ['No4Sniper', 'DP', 'Bazooka', 'Mp18', 'No4'],
  ger: ['K98Sniper', 'Sg44', 'Panzershreck', 'Mp40', 'K98'],
  jp: ['K98Sniper', 'Type99', 'Panzershreck', 'Mp18', 'Type5'],
};
const KIT_ROWS = ['scout', 'assault', 'at', 'medic', 'engineer'];

/** A vanilla kit template's nation and row, from its name: `UsMarine_Assault`
 *  is the US assault kit, `Jap_AT` the Japanese anti-tank. Exact suffixes
 *  only: nothing is read into a name that does not end in a row. */
function kitRow(tmpl) {
  const m = /^([a-z]+)[a-z]*_(scout|assault|at|medic|engineer)$/i.exec(tmpl || '');
  if (!m) return null;
  const prefix = m[1].toLowerCase();
  const nation = prefix.startsWith('jap') ? 'jp' : prefix.startsWith('ger') ? 'ger'
    : prefix.startsWith('brit') ? 'brit' : prefix.startsWith('rus') ? 'rus'
    : prefix.startsWith('us') ? 'us' : null;
  return nation ? { nation, row: KIT_ROWS.indexOf(m[2].toLowerCase()) } : null;
}

/**
 * The weapon a soldier life holds: his kit's primary (`itemIndex 3`, the slot
 * the engine selects on spawn) out of `_shared/loadouts.json`, else the
 * vanilla primary for the kit's nation and row, else null. Only ever his own
 * kit: the kit is the one his player picked up (`parseRecording`).
 */
export function primaryWeaponFor(life, loadouts = null) {
  const kit = life?.kitTemplate;
  if (!kit) return null;
  const kits = loadouts?.kits;
  if (kits) {
    const entry = kits[kit] ?? Object.entries(kits).find(([name]) => name.toLowerCase() === kit.toLowerCase())?.[1];
    if (entry?.primary) return entry.primary;
  }
  const at = kitRow(kit);
  return at ? NATION_PRIMARIES[at.nation][at.row] : null;
}

/** The pose pair's weapon for a soldier life: his kit's primary, else the
 *  pistol every soldier's pose tree carries. */
export function placeholderWeaponFor(life, loadouts = null) {
  return primaryWeaponFor(life, loadouts) ?? 'Colt';
}

/** The animation state flags the engine's movement code reads
 *  (`getCurrentStateFlags` 0x00613440, its caller at 0x005013DB): 0x20
 *  crouching, 0x40 lying, 0x08 swimming, 0x10 climbing, 0x80 jumping. */
export const ANIM_FLAGS = Object.freeze({ SWIMMING: 0x08, CLIMBING: 0x10, CROUCHING: 0x20, LYING: 0x40, JUMPING: 0x80 });

/** A soldier's recorded body at `t` (v4 `st`), read through the state table:
 *  `{ stance, lower, upper, firing, reloading, pitch, item }`, or null. */
export function bodyAt(rec, nid, t) {
  const entry = latestAt(rec.stances?.get(nid), t);
  if (!entry) return null;
  const lower = rec.animStates?.[entry.lower] ?? null;
  const upper = rec.animStates?.[entry.upper] ?? null;
  const flags = lower?.flags ?? 0;
  const stance = flags & ANIM_FLAGS.LYING ? 'prone' : flags & ANIM_FLAGS.CROUCHING ? 'crouch' : 'stand';
  const upperName = upper?.name ?? '';
  return {
    stance,
    swimming: Boolean(flags & ANIM_FLAGS.SWIMMING),
    lower: lower?.name ?? null,
    upper: upperName || null,
    firing: /fire/i.test(upperName) && !/end$/i.test(upperName),
    reloading: /reload/i.test(upperName),
    pitch: entry.pitch,
    item: entry.item,
  };
}

/** A hull's recorded engines at `t` (v4 `g`), folded into one:
 *  `{ revs, running, disabled }` (the loudest engine's revs), or null. */
export function engineAt(rec, nid, t) {
  const engines = rec.engines?.get(nid);
  if (!engines?.size) return null;
  let revs = 0;
  let running = false;
  let disabled = false;
  let any = false;
  for (const list of engines.values()) {
    const e = latestAt(list, t);
    if (!e) continue;
    any = true;
    revs = Math.max(revs, Math.abs(e.revs));
    running = running || e.running;
    disabled = disabled || e.disabled;
  }
  return any ? { revs, running, disabled } : null;
}

