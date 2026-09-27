// A bf42plus round recording, read into object lives and sampled at a time:
// the part of the replay that is a pure function of the recording's text.
// Recording formats 1-4 are read; what an older format lacks (hit points and
// the player's own chat arrived in v3, every shot, the turrets, the engines
// and the seats in v4) is simply absent. bfstats
// features/round-replay-capture/README.md documents the format and how each
// mapping here was measured.

import { CHARACTER_HEIGHT } from './soldier-pose.js';
import { EXPLOSION_AIRBORNE, PARACHUTE_AIRBORNE } from './knockback.js';
import { RADIO_MESSAGES } from './radio.js';

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

/** The speaker of a line as the chat box prints it: `Name: text`, or `Name
 *  [allies]: text` on his side's channel. null for a line with no speaker
 *  (the server's own, `*Welcome...`, come from pid -1 and have none). */
export function speakerOf(line) {
  const at = String(line ?? '').indexOf(': ');
  if (at <= 0) return null;
  const name = line.slice(0, at).replace(/ \[(allies|axis)\]$/i, '');
  return name.trim() ? name : null;
}

/**
 * A chat-box line as the game draws it. MoonGamers' server lines separate
 * their words with byte 0x80 (`*Do\u0080not\u0080steal\u0080...` throughout
 * replay_20260927-203459), which the recorder writes as the byte came. The
 * game draws nothing for it, so the line reads as one word,
 * `*Donotsteal/destroyequipment...` (the owner, 2026-09-28). The byte is
 * dropped, not left for a browser font to draw as a box.
 */
export const chatText = text => String(text ?? '').replace(/\u0080/g, '');

/** A radio message's words for the replay log, from the lexicon key the
 *  game prints it with (radio.js `RADIO_MESSAGES`): `RADIO_ARMOR_SPOTTED` is
 *  "armor spotted". The message log itself prints the game's own string. */
export function radioWords(id) {
  const msg = RADIO_MESSAGES[id];
  if (!msg) return `radio message ${id}`;
  if (msg.cp != null) return `control point ${msg.cp + 1}`;
  return msg.key.replace(/^RADIO_(LOCAL_)?/, '').replace(/_/g, ' ').toLowerCase();
}

/** Each player the chat names, `pid -> { name, team }`: the name most of his
 *  lines carry, and the side of his last. Only the `chat` records are read. */
function chatSpeakers(lines) {
  const heard = new Map();
  for (const line of lines) {
    if (!line.includes('"k":"chat"')) continue;
    let r;
    try {
      r = JSON.parse(line);
    } catch {
      continue;
    }
    const name = r.k === 'chat' && r.pid >= 0 ? speakerOf(chatText(r.text)) : null;
    if (!name) continue;
    if (!heard.has(r.pid)) heard.set(r.pid, { counts: new Map(), team: 0 });
    const entry = heard.get(r.pid);
    entry.counts.set(name, (entry.counts.get(name) ?? 0) + 1);
    entry.team = r.team ?? entry.team;
  }
  const out = new Map();
  for (const [pid, { counts, team }] of heard) {
    const [name] = [...counts].sort((a, b) => b[1] - a[1])[0];
    out.set(pid, { name, team });
  }
  return out;
}

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
 *  picked them up (0x23), not by name, so they are marked later. A round is
 *  whatever a projectile pool made (0x05, `projPool`), whatever its name:
 *  the PT boats' `FloatingMineLauncher` pools `FloatingMine`, which no
 *  `...Projectile` suffix names, and read as a hull it asked for a
 *  `FloatingMine.glb` no tree has. */
function classify(life) {
  const tmpl = life.tmpl || '';
  life.soldier = /soldier/i.test(tmpl);
  life.camera = /camera/i.test(tmpl);
  life.projectile = Boolean(life.pooled) || /projectile$/i.test(tmpl);
}

/**
 * Mark as a round (`life.projectile`) every other life whose template
 * `isRound(tmpl)` names one, and return how many it marked.
 *
 * A pool made before the recording began is never announced, so its rounds
 * are met only as objects of their template: the parser marks them from the
 * pools it did see, and replay.js from the level's own projectile table
 * (`_shared/damage.json`, which names every Projectile the game declares).
 */
export function markRounds(rec, isRound) {
  let marked = 0;
  for (const life of rec.lives) {
    if (life.projectile || !life.tmpl || life.soldier || life.camera || life.kit || life.controlPoint) continue;
    if (!isRound(life.tmpl)) continue;
    life.projectile = true;
    marked += 1;
  }
  return marked;
}

/**
 * A soldier's samples, stood on his feet. The sampler writes where the engine
 * holds a soldier, his origin, which the template's `setCharacterHeight -1.00`
 * puts a metre over the ground he stands on (soldier-pose.js
 * `CHARACTER_HEIGHT`); the body renderer, the plain fallback and the camera
 * stand a man on his feet. Measured in replay_20260927-075756: the recording
 * player's live samples lie 1.00 m (median) over Wake's terrain and 25 bots'
 * the same, and his shots leave his camera 0.65, 0.12 and -0.70 m over his
 * sample standing, crouched and prone, the template's `setPoseCameraPos`. A
 * creation event is the spawn point, on the ground already, and keeps its
 * height.
 */
function standOnFeet(life) {
  for (const key of life.keys) key.p[1] -= CHARACTER_HEIGHT;
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
    mod: '',              // the server's mod (ServerInfoEvent 0x1A): 'bf1942', 'XPack1', ...
    server: '',
    lives: [],
    // pid -> his latest session. A session is one player's time under a
    // pid: `{ pid, name, team, ai, joinT, leftT?, local?, joinNid, joinKitNid,
    // camNid, teams: [{ t, team }] }`, `team` his side at the end of it.
    players: new Map(),
    // pid -> every session, in join order: a public server hands a leaver's
    // id to the next player to join (pid 11 is Omen at 496.8 s and Niconan
    // at 850.8 s of replay_20260927-203459), so who a pid is, and his side,
    // are answered at a time (`playerAt`, `nameAt`, `teamAt`).
    sessions: new Map(),
    control: [],          // { t, pid, team, nid } from player records
    chat: [],             // { t, pid, team, text, body }
    events: [],           // feed rows
    clocks: [],           // { t, seconds, exact }
    matchable: [],        // { t, kind, text } for aligning a server log
    fires: [],            // { t, pid, kind, weapon, pos, dir, nid? } one per shot (v4) or per trigger press (v3)
    deaths: [],           // { t, pid } a player's death, as the score stream reports it
    joints: new Map(),    // v5: root nid -> Map<part id, { name, since, pos, keys: [{ t, q }] }>
    keyedParts: new Map(),// v4: root nid -> [{ t, parts: [q...], before }], keyed 0 (replay-aim.js)
    engines: new Map(),   // v4: root nid -> Map<engine nid, [{ t, revs, throttle, running, disabled, gear }]>
    stances: new Map(),   // v4: soldier nid -> [{ t, lower, upper, pitch, twist, item, bits }]
    animStates: [],       // v4: index -> { name, flags }, the engine's animation state table
    seats: new Map(),     // v4: pid -> [{ t, root, seat }]
    roundStats: new Map(),// pid -> { destroyed, fired, hit: [{ tid, tmpl, n }] } (0x30..0x32)
    hitsTaken: [],        // { t, dir, strength } the recording player's own hits (0x3C)
    tickets: [],          // { t, v: [team1, team2] } both sides' tickets as they moved (tk)
    // { t, kind, killer, victim, weapon, killerTeam, victimTeam } one per
    // line the kill log printed, both sides as they stood when it was scored
    kills: [],
    radio: [],            // { t, pid, msg, global } radio messages the recording player heard (0x3A)
    unseenDestroys: [],   // { t, nid } an object removed (0x06) that no life of the recording holds
    refills: [],          // { t } the recording player's ammo refilled at a depot (0x27, type 0)
    captures: [],         // { t, id, name, team, from } a control point taken during play
    controlPoints: new Map(), // cp id -> { id, name, tmpl, pos, changes: [{ t, team }] }
    timeLimit: 0,         // the round's time limit, seconds (0x29); 0 is none
    roundStarted: null,   // the first round-playing status, or null for a join mid-round
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
  const plainDeaths = [];       // { t, victim } score DEATH (4): "is no more", unless a team kill wrote it
  let joined = -Infinity;
  let sawPregame = false;
  let lastStatus = null;
  let beganAfterJoin = false;
  let lastRefill = -Infinity;

  const lines = text.split('\n');
  // Who the chat box names, for players nothing else introduces (see the
  // roster below): read first, so the feed's rows carry the names too.
  const spoken = chatSpeakers(lines);

  const row = (t, kind, text) => {
    const entry = { t, kind, text, source: 'client' };
    rec.events.push(entry);
    return entry;
  };
  const playerName = (pid, t) => playerAt(rec, pid, t)?.name ?? spoken.get(pid)?.name ?? `player ${pid}`;
  /** `pid`'s side now, in the file's own order: a kill is scored against
   *  the sides as they stand at that line (pid 11 switched from Axis to
   *  Allies in the same tick Rut's bazooka killed him, 599.74 s). */
  const teamNow = pid => rec.players.get(pid)?.team ?? 0;

  /** A new session for `pid` from `t`, ending any he has open: the server
   *  gives a leaver's id to the next player to join. */
  const startSession = (pid, t, fields) => {
    const open = rec.players.get(pid);
    if (open && open.leftT === undefined && t > open.joinT) open.leftT = t;
    const session = { pid, ...fields, joinT: t, teams: [] };
    if (fields.team === 1 || fields.team === 2) session.teams.push({ t, team: fields.team });
    if (!rec.sessions.has(pid)) rec.sessions.set(pid, []);
    rec.sessions.get(pid).push(session);
    rec.players.set(pid, session);
    return session;
  };
  /** `pid`'s side from `t`: a team switch (0x39), or a player record's team,
   *  which the server sends with his every change of state. */
  const noteTeam = (pid, t, team) => {
    const session = rec.players.get(pid);
    if (!session) return;
    const last = session.teams[session.teams.length - 1];
    if (last?.team !== team) session.teams.push({ t, team });
    session.team = team;
  };

  /** HitFromPosEvent (0x3C), sent to the damaged player's client alone: the
   *  sector the damage came from (45 degrees each: 0 ahead, 4 behind, 1-3
   *  one side and 5-7 the other, which side unconfirmed) and its strength,
   *  255 x the damage over his maximum hit points (lnxded
   *  `GameServer::_giveDamage` 0x0814b870). The game's hit indicator. */
  const hitTaken = (t, dir, strength) => {
    rec.hitsTaken.push({ t, dir, strength });
    const from = dir === 0 ? 'ahead' : dir === 4 ? 'behind' : `sector ${dir}`;
    row(t, 'damage', `hit from ${from}, ${Math.round(strength / 2.55)}% of full health`);
  };

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
  // A v4 recorder keyed every part 0 and wrote a part only when it differed
  // from the last part it wrote, whichever hull's that was (bf42plus 4fc0352
  // `sampleParts`). Its walk is the object manager's registry, so a record
  // lists each hull's parts together and in the same order every time; each
  // hull's run is kept with the entry written just before it, which is what
  // a part left out of the run's head was equal to (replay-aim.js
  // `decodeKeyedParts`).
  let lastKeyed = null;
  const keyedRuns = (t, entries) => {
    let run = null;
    for (const [root, , qx, qy, qz, qw] of entries) {
      const q = [qx, qy, qz, qw];
      if (run?.root !== root) {
        run = { root, t, parts: [], before: lastKeyed };
        if (!rec.keyedParts.has(root)) rec.keyedParts.set(root, []);
        rec.keyedParts.get(root).push(run);
      }
      run.parts.push(q);
      lastKeyed = q;
    }
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
      case 0x1a:
        // ServerInfoEvent: 3 x { char[16], u8 length }: map id, mod, game id.
        rec.mod = cString(b, 17, 16) || rec.mod;
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
      case 0x3c:
        if (b.length >= 2) hitTaken(t, b[0], b[1]);
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
        startSession(r.pid, t, {
          name: r.name, team: r.team, ai: Boolean(r.ai),
          joinNid: r.vehNetId ?? null, joinKitNid: r.kitNetId ?? null, camNid: r.camNetId ?? null,
        });
        if (r.vehNetId) nidEvents.push({ t, pid: r.pid, nid: r.vehNetId });
        // One held from before the file began is a player already in the round.
        if (r.ago === undefined) row(t, 'player', `${r.name} joined ${teamName(r.team)}`);
        return;
      case 'destroyPlayer': {
        row(t, 'player', `${playerName(r.pid, t)} left`);
        const player = rec.players.get(r.pid);
        if (player && player.leftT === undefined) player.leftT = t;
        return;
      }
      case 'setTeam': {
        noteTeam(r.pid, t, r.team);
        row(t, 'player', `${playerName(r.pid, t)} switched to ${teamName(r.team)}`);
        rec.matchable.push({ t, kind: 'setTeam' });
        return;
      }
      case 'score':
        if (t < rec.roundEnded) {
          if (r.kind === SCORE.KILL || r.kind === SCORE.TEAMKILL) {
            rec.deaths.push({ t, pid: r.victim, killer: r.pid, weapon: r.weaponName ?? null });
            // The kill log's line (chat-log.js `deathLines`): a kill names its
            // killer and his weapon, a team kill only the killer. The kind is
            // the server's word for it, and the sides are as they stood.
            rec.kills.push({ t, kind: r.kind === SCORE.TEAMKILL ? 'teamkill' : 'kill',
                             killer: r.pid, victim: r.victim, weapon: r.weaponName ?? null,
                             killerTeam: teamNow(r.pid), victimTeam: teamNow(r.victim) });
          } else if (r.kind === SCORE.DEATH || r.kind === SCORE.DEATH_NO_MSG) {
            rec.deaths.push({ t, pid: r.pid, killer: null, weapon: null });
            if (r.kind === SCORE.DEATH) plainDeaths.push({ t, victim: r.pid, victimTeam: teamNow(r.pid) });
          }
        }
        if (r.kind === SCORE.SPAWNED) {
          row(t, 'spawn', `${playerName(r.pid, t)} spawned`);
        } else if (r.kind === SCORE.KILL || r.kind === SCORE.TEAMKILL) {
          const how = r.weaponName ? ` with ${r.weaponName}` : '';
          row(t, 'kill', `${playerName(r.pid, t)} ${SCORE_TEXT[r.kind]} ${playerName(r.victim, t)}${how}`);
        } else if (SCORE_TEXT[r.kind]) {
          // Deaths (4, 5) are skipped: a kill row carries them, and the rest
          // are the round-end teardown.
          row(t, 'score', `${playerName(r.pid, t)} ${SCORE_TEXT[r.kind]}`);
        }
        return;
      case 'radio':
        // RadioMessageEvent (0x3A): `msg` the engine's message id (radio.js
        // `RADIO_MESSAGES`), `global` 1 for team radio and 0 for a shout. The
        // server sends team radio to the speaker's side and a shout to anyone
        // within 70 m, so the file holds what its player heard.
        rec.radio.push({ t, pid: r.pid, msg: r.msg, global: Boolean(r.global) });
        row(t, 'radio', `${playerName(r.pid, t)}: ${radioWords(r.msg)}`);
        return;
      case 'special':
        // SpecialGameEvent (0x27). Type 0 is a refill: the server's
        // `GameServer::triggerSpecialGameEvent` (lnxded 0x081591a0) sends it
        // to the client of a player a depot is resupplying, whose soldier
        // plays `SoldierRefillAmmo.ssc` (`BFSoldier::triggerRefillAmmoSound`
        // 0x0827ebc0, sound trigger 0x1a). So a file holds its own player's,
        // one every half second he stands at a depot; one row a visit.
        if (r.action === 0) {
          rec.refills.push({ t });
          if (t - lastRefill > 2) row(t, 'supply', 'ammo refilled at a depot');
          lastRefill = t;
        }
        return;
      case 'chat':
        // From v3 the chat box itself is recorded, which also has the
        // player's own lines; the fragments are only needed before that.
        if (rec.version < 3) row(t, 'chat', `${playerName(r.pid, t)}: ${chatText(r.text)}`);
        return;
      case 'gameStatus':
        if ((r.status === 2 || r.status === 5) && rec.roundEnded === Infinity) rec.roundEnded = t;
        // The round began inside the recording only when PREGAME (3) came
        // first: a join mid-round is sent PLAYING straight away
        // (replay_20260927-001120 joined 277 s into its round).
        if (r.status === 3) sawPregame = true;
        if (r.status === 1 && rec.roundStarted === null && sawPregame) rec.roundStarted = t;
        // The server sends every client the status again whenever someone
        // joins (ten "round playing" in replay_20260927-203459, each a
        // millisecond after a createPlayer): a row is a change. A file begun
        // after the join has missed the status the join was sent, and
        // PLAYING then is only the first repeat.
        if (r.status !== lastStatus && !(lastStatus === null && beganAfterJoin && r.status === 1)) {
          row(t, 'round', GAME_STATUS[r.status] ?? `game status ${r.status}`);
        }
        lastStatus = r.status;
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
          } else {
            // An object the recording never saw made or sampled: one the join
            // made before the file began, out of range (replay-standins.js).
            rec.unseenDestroys.push({ t, nid: r.netId });
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
      case 'serverInfo':
        rec.mod = r.mod || rec.mod;
        return;
      case 'projPool':
        projectilePool(t, r.tid, r.netId, r.count, r.tmpl);
        return;
      case 'roundStats':
        roundStat(t, r.stat, r.pid, r.rows ?? []);
        return;
      case 'hitFrom':
        hitTaken(t, r.dir, r.strength);
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

  for (const line of lines) {
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
        // An event with `ago` arrived before the file began and heads it (a
        // file begun after the join, bf42plus ea600c1 and later): the join's
        // own, and the objects, pools, kits and players it made. What it made
        // was there at the file's start, not spawned during it.
        if (r.ago !== undefined) joined = Math.max(joined, t);
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
          if (team === 1 || team === 2) noteTeam(pid, t, team);
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
        // The first team a point reports (-1 until the server sets it) is
        // where the round opened it; a change after that is play. A capture
        // goes through neutral: 2, then 0 as the flag comes down, then 1 as
        // the attackers raise theirs (Landing_Beach at 185.5 and 195.5 s in
        // replay_20260927-075756), so a point turning to a side from neutral
        // is taken as well as one turning from the other side.
        const opened = Boolean(before?.opened) || r.team >= 0;
        cpState.set(r.id, { name, team: r.team, opened });
        if (!rec.controlPoints.has(r.id)) {
          rec.controlPoints.set(r.id, { id: r.id, name, tmpl: r.tmpl ?? '', pos: r.pos ?? null, changes: [] });
        }
        const point = rec.controlPoints.get(r.id);
        point.name = name;
        if (r.team >= 0 && point.changes[point.changes.length - 1]?.team !== r.team) point.changes.push({ t, team: r.team });
        if (before?.opened && r.team > 0 && before.team !== r.team) {
          rec.captures.push({ t, id: r.id, name, team: r.team, from: before.team });
          row(t, 'flag', `${name} taken by ${teamName(r.team)}`);
        }
        break;
      }
      case 'chat':
        rec.chat.push({ t, pid: r.pid, team: r.team, text: chatText(r.text) });
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
        // A moving part's name, on first sight: `[root, part, template]`, and
        // from v5 where it sits in its root's frame, `x, y, z` (BF1942's; the
        // viewer's has z negated). A v4 recorder keyed every part 0 -- a child
        // networkable has no id of its own -- so a v4 file's parts cannot be
        // told apart by key and are not put on nodes; its `j` runs are kept
        // per hull instead (`keyedParts`).
        if (rec.version === 4) break;
        for (const [root, nid, name, x, y, z] of r.o) {
          const part = jointOf(root, nid);
          part.name = name;
          part.since = t;
          if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) part.pos = [x, y, -z];
        }
        break;
      case 'j':
        // A moving part's rotation relative to its root object (a turret's
        // traverse, a gun's elevation), `[root, part, qx, qy, qz, qw]`.
        if (rec.version === 4) {
          keyedRuns(t, r.o ?? []);
          break;
        }
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
      case 'tk':
        // Both sides' tickets, the client's ScoreManager's (from bf42plus
        // e692f14), written whenever either moves.
        if (Array.isArray(r.v) && r.v.length >= 2) rec.tickets.push({ t, v: [r.v[0], r.v[1]] });
        break;
      case 'anim':
        // v4: the engine's animation state table, once: `[index, name, flags]`.
        for (const [index, name, flags] of r.states ?? []) rec.animStates[index] = { name, flags };
        break;
      case 'roster':
        // Who was playing when a file begun after the join began (bf42plus
        // ea600c1): `[pid, team, ai, name, local]`, local the recording
        // player. Their createPlayer events all went by before the file.
        beganAfterJoin = true;
        for (const [pid, team, ai, name, local] of r.p ?? []) {
          // A player the file already knows from his held createPlayer (a
          // recorder after ea600c1) joined on the side he had then: the
          // roster has the side he is on as the file begins.
          const known = rec.players.get(pid);
          if (known) {
            if (team === 1 || team === 2) noteTeam(pid, t, team);
            if (local) known.local = true;
            continue;
          }
          startSession(pid, t, {
            name, team, ai: Boolean(ai), joinNid: null, joinKitNid: null, camNid: null, local: Boolean(local),
          });
        }
        break;
      default:
        break;
    }
  }

  // Everyone else the recording shows playing. A file begun after the join
  // (recording switched on mid-round) by a recorder that wrote no roster has
  // no createPlayer for anyone already in the round: the chat names whoever
  // talked, and his player records carry every player's side.
  const sides = new Map();
  for (const { pid, team } of rec.control) sides.set(pid, team);
  for (const pid of new Set([...spoken.keys(), ...sides.keys()])) {
    if (rec.players.has(pid)) continue;
    const said = spoken.get(pid);
    const session = startSession(pid, 0, {
      name: said?.name, team: sides.get(pid) ?? said?.team ?? 0,
      // Bots do not talk; of a silent player the recording cannot say.
      ai: said ? false : null,
      joinNid: null, joinKitNid: null, camNid: null,
    });
    // His sides as his player records had them.
    session.teams = [];
    for (const c of rec.control) {
      if (c.pid !== pid || (c.team !== 1 && c.team !== 2)) continue;
      if (session.teams[session.teams.length - 1]?.team !== c.team) session.teams.push({ t: c.t, team: c.team });
    }
  }

  // Names for lives announced only by template id (before v3), from any object
  // of the same template the client did replicate.
  for (const life of rec.lives) {
    if (!life.tmpl && life.tid) life.tmpl = tidNames.get(life.tid) || '';
    classify(life);
    if (life.soldier) standOnFeet(life);
    life.kit = kitIds.has(life.nid);
    life.controlPoint = cpTemplates.has(life.tmpl);
    // DataBaseComplete arrives after the join-time burst of creations, so
    // whether an object spawned during play can only be decided here.
    life.spawnedLate = Boolean(life.announced) && life.created > joined + 1;
  }
  // A kit is also whatever a player carried at the join, before any pickup,
  // and anything else of a template a kit was: a kit dropped by a dead man
  // lies on the ground as the same template until somebody takes it.
  const allSessions = [...rec.sessions.values()].flat();
  for (const player of allSessions) {
    const kit = player.joinKitNid ? lifeAtIn(rec.lives, player.joinKitNid, player.joinT) : null;
    if (kit) kit.kit = true;
  }
  const kitTemplates = new Set(rec.lives.filter(l => l.kit && l.tmpl).map(l => l.tmpl.toLowerCase()));
  for (const life of rec.lives) {
    if (!life.kit && life.tmpl && kitTemplates.has(life.tmpl.toLowerCase())) life.kit = true;
  }
  // A round is anything else of a template a pool made: the boats at the
  // join laid mines from pools the recording never saw made.
  const poolTemplates = new Set(rec.lives.filter(l => l.pooled && l.tmpl).map(l => l.tmpl.toLowerCase()));
  markRounds(rec, tmpl => poolTemplates.has(tmpl.toLowerCase()));

  // The round-end tallies, named where the recording knows the template, one
  // feed row a player.
  for (const [pid, entry] of rec.roundStats) {
    const words = [];
    for (const stat of ['destroyed', 'fired', 'hit']) {
      for (const row of entry[stat]) row.tmpl = row.tmpl || tidNames.get(row.tid) || `template ${row.tid}`;
      if (entry[stat].length) words.push(`${stat} ${entry[stat].map(x => `${x.tmpl} x${x.n}`).join(', ')}`);
    }
    if (words.length) row(entry.t, 'stats', `${playerName(pid, entry.t)}: ${words.join('; ')}`);
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
  const livesOf = new Map();
  for (const life of rec.lives) {
    if (!livesOf.has(life.nid)) livesOf.set(life.nid, []);
    livesOf.get(life.nid).push(life);
  }
  for (const [pid, list] of rec.playerNids) {
    for (const { t, nid } of list) {
      const life = lifeAtIn(rec.lives, nid, t);
      if (life?.soldier && life.pid === undefined) life.pid = pid;
    }
  }
  // The control can come before the recording first sees the soldier: a man
  // who spawned out of range, or one alive when a file begun mid-round
  // opened (soldiers 806, 814 and 740 of replay_20260927-203459 are held
  // from 0.0 s and first seen at 8.5 s). His is then the life of that id his
  // hold on it overlaps; without it the man had no death, corpse or kit.
  for (const [pid, list] of rec.playerNids) {
    list.forEach(({ t, nid }, i) => {
      const until = list[i + 1]?.t ?? Infinity;
      for (const life of livesOf.get(nid) ?? []) {
        if (life.soldier && life.pid === undefined && life.created < until && life.destroyed > t) life.pid = pid;
      }
    });
  }

  // Each soldier's kit: what his player picked up at the spawn (0x23), or
  // carried at the join (CreatePlayer's kit id). Never another player's.
  const soldierOf = (pid, t) => {
    let best = null;
    for (const life of rec.lives) {
      if (!life.soldier || life.pid !== pid || life.created > t + 0.5 || t >= life.destroyed) continue;
      if (!best || life.created > best.created) best = life;
    }
    if (best) return best;
    // A soldier the recording first sees after the pickup: the one he holds.
    const held = controlledAt(rec, pid, t + 0.5);
    return (livesOf.get(held) ?? [])
      .filter(l => l.soldier && l.pid === pid && l.destroyed > t)
      .sort((a, b) => a.created - b.created)[0] ?? null;
  };
  for (const { t, pid, nid } of kitPickups) {
    const soldier = soldierOf(pid, t);
    const kit = lifeAtIn(rec.lives, nid, t + 0.5);
    if (soldier && kit?.tmpl) soldier.kitTemplate = kit.tmpl;
  }
  for (const player of allSessions) {
    const soldier = player.joinNid ? lifeAtIn(rec.lives, player.joinNid, player.joinT) : null;
    if (!soldier?.soldier || soldier.kitTemplate) continue;
    if (soldier.pid === undefined) soldier.pid = player.pid;
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
    f.shooter = playerName(f.pid, f.t);
    f.row = row(f.t, 'fire', `${f.shooter} fired ${f.soldier ? (f.kitTemplate ?? 'a weapon') : (f.weapon || 'a weapon')}`);
  }

  const lifeAt = (nid, t) => rec.lives.find(l => l.nid === nid && l.created <= t + 0.5 && t < l.destroyed);

  for (const d of deferred) {
    if (d.type === 'enter') {
      const root = rootOf(rec, d.nid, d.t);
      const what = root?.life.tmpl || lifeAt(d.nid, d.t)?.tmpl || `object ${d.nid}`;
      row(d.t, 'vehicle', `${playerName(d.pid, d.t)} got into ${what}${root?.seat ? ` (seat ${root.seat + 1})` : ''}`);
    } else {
      row(d.t, 'vehicle', `${playerName(d.pid, d.t)} got out`);
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
    // The server's own lines (pid -1, `*Welcome...`) have no speaker.
    const name = c.pid < 0 ? null : playerName(c.pid, c.t);
    const at = c.text.indexOf(': ');
    c.body = name !== null && at > 0 && speakerOf(c.text) === name ? c.text.slice(at + 2) : c.text;
    row(c.t, 'chat', name === null ? c.text : `${name}: ${c.body}`);
    rec.matchable.push({ t: c.t, kind: 'chat', text: c.body.trim() });
  }

  // A death with its own message (4) is `is no more`: a suicide, a fall, a
  // crewman lost with a hull nobody was credited for. A team kill sends one
  // for its victim right after its own line (6, then 4), and the kill log
  // prints both from the one death, so that one is the team kill's.
  for (const d of plainDeaths) {
    const own = rec.kills.some(k => k.victim === d.victim && k.kind === 'teamkill' && Math.abs(k.t - d.t) < 0.25);
    if (!own) rec.kills.push({ t: d.t, kind: 'death', killer: null, victim: d.victim, weapon: null, victimTeam: d.victimTeam });
  }
  rec.kills.sort((a, b) => a.t - b.t);

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

/**
 * Who `pid` was at recording time `t`: the session he had joined by then
 * (the last to join at or before `t`), else his first; without `t`, his
 * latest. A public server gives a leaver's pid to the next player to join,
 * so a name or a side read without a time is only the id's last holder:
 * Rut's bazooka kill of Omen at 599.7 s of replay_20260927-203459 printed
 * "Rut killed a teammate / Niconan is no more", Niconan being who held pid
 * 11 at the end of the round, and on Rut's side.
 */
export function playerAt(rec, pid, t) {
  const list = rec.sessions?.get(pid);
  if (!list?.length) return rec.players?.get(pid) ?? null;
  if (t === undefined || t === null) return list[list.length - 1];
  let hit = list[0];
  for (const session of list) {
    if (session.joinT > t) break;
    hit = session;
  }
  return hit;
}

/** `pid`'s name at `t` (`playerAt`), or `player <pid>`. */
export const nameAt = (rec, pid, t) => playerAt(rec, pid, t)?.name ?? `player ${pid}`;

/** `pid`'s side at `t`: his session's last change of side by then (a team
 *  switch, or a player record's team), 0 for none. */
export function teamAt(rec, pid, t) {
  const session = playerAt(rec, pid, t);
  if (!session) return 0;
  if (t === undefined || t === null || !session.teams?.length) return session.team ?? 0;
  let team = session.teams[0].team;
  for (const change of session.teams) {
    if (change.t > t) break;
    team = change.team;
  }
  return team;
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

/** The soldier's state bit `0x10`, the chute carrying him: set and cleared by
 *  `BFSoldier::setIsParachuting` (lnxded `0x08276f90`, its `+0x3e6`; the
 *  client's `+0x416` is what `st` records). replay_20260927-140921's bail-out
 *  has it up from `Lb_ParachuteOpen` (72.76 s) through `Lb_ParachuteIdle`
 *  (84.36 s) and down from `Lb_ParachuteHitGround` (84.46 s). */
export const CHUTE_OPEN_BIT = 0x10;

/** A soldier's recorded body at `t` (v4 `st`), read through the state table:
 *  `{ stance, lower, upper, firing, reloading, pitch, item }` and whether
 *  his chute is open (`chuteOpen`), or null. */
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
    chuteOpen: Boolean((entry.bits ?? 0) & CHUTE_OPEN_BIT),
    lower: lower?.name ?? null,
    upper: upperName || null,
    firing: /fire/i.test(upperName) && !/end$/i.test(upperName),
    reloading: /reload/i.test(upperName),
    pitch: entry.pitch,
    item: entry.item,
  };
}

/** How far a body's recorded die state may lead or trail the score stream's
 *  death, seconds: the body's record follows the kill by 0.05 to 0.14 s in
 *  replay_20260927-140921, the sampler's tick. */
const DIE_LEAD = 0.2;
const DIE_LAG = 0.6;

/**
 * The die state a soldier's body entered at his death (v4 `st`), the one the
 * engine chose (`BFSoldier::handleDamage`, soldier-death.js): the first lower
 * state named `Lb_Die...` or `Lb_ParachuteDie` recorded around `diedAt`, or
 * null. A man blown off his feet can go straight into the explosion states,
 * which name no death.
 */
export function recordedDeath(rec, nid, diedAt) {
  const list = rec.stances?.get(nid);
  if (!list?.length || !Number.isFinite(diedAt)) return null;
  for (const entry of list) {
    if (entry.t < diedAt - DIE_LEAD) continue;
    if (entry.t > diedAt + DIE_LAG) break;
    const lower = rec.animStates?.[entry.lower]?.name ?? '';
    if (/^Lb_(Die|ParachuteDie)/.test(lower)) return lower;
  }
  return null;
}

/** A lower state in which the body is in the air: a blast's flight or
 *  bounce, or the parachute's fall, opening, glide and death. */
const inTheAir = lower => EXPLOSION_AIRBORNE.has(lower) || PARACHUTE_AIRBORNE.has(lower);

/**
 * Where a dead man's body went after his death, when it was in the air (v4
 * `st`): thrown by a blast (`knockback.js` -- the engine throws a dead body
 * too, and a blast is what kills most men it throws), or riding his canopy
 * down in `Lb_ParachuteDie`. From the record current at his death, or the
 * first within `DIE_LAG` after it, while his lower state is one of those, to
 * the first record after that is not: `{ until, landing }`, the moment the
 * body came to rest and the lower state it came to rest in
 * (`Lb_ExplosionLandFront`, `Lb_ParachuteDeadHitGround`, ...), `until`
 * Infinity when the recording never lands him. Null when his body was not
 * in the air, or went straight into a death of `handleDamage`'s.
 *
 * In replay_20260927-140921 all eight bodies a blast threw were dead men,
 * killed from 0.2 s before the flight to 1.9 s into it, each coming to rest
 * 0.02 to 3.1 s after his death.
 */
export function recordedFlight(rec, nid, diedAt) {
  const list = rec.stances?.get(nid);
  if (!list?.length || !Number.isFinite(diedAt)) return null;
  const name = entry => rec.animStates?.[entry.lower]?.name ?? '';
  const current = latestAt(list, diedAt);
  let i = current ? list.indexOf(current) : 0;
  while (i < list.length && list[i].t <= diedAt + DIE_LAG) {
    const lower = name(list[i]);
    if (inTheAir(lower)) break;
    if (/^Lb_Die/.test(lower) && list[i].t >= diedAt - DIE_LEAD) return null;
    i++;
  }
  if (i >= list.length || list[i].t > diedAt + DIE_LAG) return null;
  for (let j = i + 1; j < list.length; j++) {
    if (!inTheAir(name(list[j]))) return { until: list[j].t, landing: name(list[j]) };
  }
  return { until: Infinity, landing: null };
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

