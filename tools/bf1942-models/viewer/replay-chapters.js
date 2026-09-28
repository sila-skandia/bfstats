// What a replay's timeline, message log and scoreboard read out of a round:
// its chapters (kills and deaths, vehicles destroyed, flags taken, the round's
// start and end), the lines the game's own message log printed, and each
// player's state and tally at a time. Pure functions of the parsed recording
// and the aligned server log (replay-recording.js, replay-server-log.js), so
// `tests/replay_harness.mjs` runs them under node.
// features/round-replay-ux/README.md is the design.

import {
  controlledAt, crewOf, isReplicated, lifeAt, nameAt, playerAt, rootOf, teamAt, teamName,
} from './replay-recording.js';
import { captureLine, deathLine, killLine, killWord, teamKillLine } from './chat-log.js';

/** How far before its moment a chapter starts, seconds: a jump to a kill
 *  lands in time to see it happen, a capture on the last of the hold. */
const LEAD = { kill: 3, teamkill: 3, death: 3, vehicle: 3, capture: 6, spawn: 1, 'round-start': 0, 'round-end': 3 };

/** A server event this close to a recorded one is the same event, seconds. */
const SAME_EVENT = 1.5;

/** A spawn this close to a control point, metres, is at that point: the
 *  recorded levels' spawns stand within 185 m of their flag, a carrier's
 *  kilometres from any. */
const SPAWN_NEAR = 200;

/** `pid`'s name and side at recording time `t` (replay-recording.js
 *  `nameAt`, `teamAt`): a pid passes from player to player on a public
 *  server, and a player can change sides. Without `t`, the id's last. */
export const playerName = (rec, pid, t) => nameAt(rec, pid, t);
export const playerTeam = (rec, pid, t) => teamAt(rec, pid, t);

/** A kill line's two sides, as they stood when the server scored it
 *  (replay-recording.js stamps them), else at its time. */
export const killerTeamOf = (rec, k) => k.killerTeam ?? playerTeam(rec, k.killer, k.t);
export const victimTeamOf = (rec, k) => k.victimTeam ?? playerTeam(rec, k.victim, k.t);

/** The player whose client made the recording: the one the roster marks
 *  `local` (a file begun mid-round), else the one whose rounds the recorder
 *  marks `local` (v4), else the round's human. His own view is the
 *  recording's (the hit indicator is his alone, `rec.hitsTaken`). */
export function recordingPlayer(rec) {
  for (const [pid, list] of rec.sessions ?? []) if (list.some(s => s.local)) return pid;
  for (const [pid, player] of rec.players) if (player.local) return pid;
  const shot = rec.fires.find(f => f.local && f.pid !== null && f.pid !== undefined);
  if (shot) return shot.pid;
  for (const [pid, player] of rec.players) if (player.ai === false) return pid;
  return null;
}

/** The recording player's name, which a shared recording goes up under
 *  (features/replay-feed), found as the API finds it (RecordingInspector): the
 *  roster's `local`, else the name the pid of his own shots had when he fired
 *  (v4's `local` rounds, v3's trigger presses), else the round's only human.
 *  Stricter than `recordingPlayer`, which takes the first human for the
 *  replay's point of view: of several humans and nothing marking one, the
 *  file cannot say, and the answer is '', never a stand-in like `player 18`. */
export function recorderName(rec) {
  for (const list of rec.sessions?.values() ?? []) {
    const own = list.find(s => s.local && s.name);
    if (own) return String(own.name).trim();
  }
  for (const player of rec.players.values()) if (player.local && player.name) return String(player.name).trim();
  const shot = rec.fires.find(f => (f.local || f.press) && f.pid !== null && f.pid !== undefined);
  const shooter = shot ? playerAt(rec, shot.pid, shot.t)?.name : '';
  if (shooter) return String(shooter).trim();
  const humans = new Set([...rec.players.values()]
    .filter(p => p.ai === false).map(p => String(p.name ?? '').trim()).filter(Boolean));
  return humans.size === 1 ? [...humans][0] : '';
}

/**
 * The kill log's lines (`rec.kills`), with a weapon the recording did not
 * carry filled from the server's own log where it names one: a v3 file's
 * score events have no `weaponName`, and the server's kill for the same
 * victim says `with Chi-ha`.
 */
export function killsOf(rec, serverRows = []) {
  const serverKills = serverRows.filter(r => r.kind === 'scoreEvent' && r.victim !== null && r.weapon);
  return rec.kills.map(k => {
    if (k.weapon || k.kind === 'death') return k;
    const match = serverKills.find(r => r.victim === k.victim && Math.abs(r.t - k.t) < SAME_EVENT);
    return match ? { ...k, weapon: match.weapon } : k;
  });
}

/** Each control point's team at `t`, as the message log's capture check
 *  reads flags: `{ name, team, controlPointName }`. */
export function pointsAt(rec, t) {
  const out = [];
  for (const point of rec.controlPoints?.values() ?? []) {
    let team = null;
    for (const change of point.changes) {
      if (change.t > t) break;
      team = change.team;
    }
    if (team !== null) out.push({ name: point.name, team, controlPointName: point.name });
  }
  return out;
}

const spawnCache = new WeakMap();

/**
 * `pid`'s spawns, in time order: `[{ t, life }]`, each new soldier of his
 * from the moment he took control of it. That is the spawn itself, even
 * where the recording saw the soldier only once it came into range, a few
 * seconds on. A soldier standing when the recording began is no spawn it
 * saw.
 */
export function spawnsOf(rec, pid) {
  let cache = spawnCache.get(rec);
  if (!cache) {
    const soldiers = new Map();
    for (const l of rec.lives) {
      if (!l.soldier) continue;
      if (!soldiers.has(l.nid)) soldiers.set(l.nid, []);
      soldiers.get(l.nid).push(l);
    }
    spawnCache.set(rec, cache = { soldiers, byPid: new Map() });
  }
  if (cache.byPid.has(pid)) return cache.byPid.get(pid);
  const control = rec.playerNids?.get(pid) ?? [];
  const spawns = [];
  const seen = new Set();
  control.forEach(({ t, nid }, i) => {
    // A soldier made as he took it (the object can land a moment before
    // the control does), or first seen while he still held it. His first
    // entry is only where the recording found him, so a soldier seen
    // after that is one he was already in.
    const until = control[i + 1]?.t ?? Infinity;
    const life = cache.soldiers.get(nid)?.find(l => l.created >= t - 1 && l.created < until);
    if (!life || seen.has(life)) return;
    seen.add(life);
    if (i === 0 && life.created > t + 1) return;
    const at = Math.min(t, life.created);
    if (at > 0.05) spawns.push({ t: at, life });
  });
  cache.byPid.set(pid, spawns);
  return spawns;
}

/** `pid`'s next spawn after `t`, `{ t, life }`, or null: none while he is
 *  in a soldier the recording has yet to see (spawned out of its range). */
export function nextSpawn(rec, pid, t) {
  for (const s of spawnsOf(rec, pid)) {
    if (s.t > t) return s;
    if (s.life.created > t) return null;
  }
  return null;
}

/** The control point a soldier spawned at: the nearest to where he was
 *  first seen, if it is near enough to be his spawn's. */
function spawnPoint(rec, life) {
  const p = life.keys[0]?.p;
  if (!p) return null;
  let best = null;
  let near = SPAWN_NEAR;
  for (const point of rec.controlPoints?.values() ?? []) {
    if (!point.pos) continue;
    const d = Math.hypot(point.pos[0] - p[0], point.pos[2] - p[2]);
    if (d < near) {
      best = point.name;
      near = d;
    }
  }
  return best;
}

/**
 * The round's chapters, in time order: `{ t, kind, lead, team, ... }` with
 * `kind` one of kill, teamkill, death (`killer`, `victim`, `weapon`),
 * vehicle (`tmpl`, `crew` the players aboard, `by` the destroyer when the
 * server's log names him), capture (`name`, `team`), spawn (the recording
 * player's: `pid`, `at` the control point), round-start and round-end
 * (`winner`). `team` is the side the chapter is drawn in.
 */
export function buildChapters(rec, serverRows = [], kills = killsOf(rec, serverRows)) {
  const chapters = [];
  const add = ch => chapters.push({ lead: LEAD[ch.kind] ?? 0, ...ch });

  for (const k of kills) {
    const team = k.kind === 'death' ? victimTeamOf(rec, k) : killerTeamOf(rec, k);
    add({ t: k.t, kind: k.kind, killer: k.killer, victim: k.victim, weapon: k.weapon, team });
  }

  // Vehicles destroyed: the recording's own (a hull whose hit points reached
  // nothing while the client could see it), each credited to whoever the
  // server says destroyed that template then; and the server's for hulls the
  // client never saw.
  const serverWrecks = serverRows.filter(r => r.kind === 'destroyVehicle' && r.vehicle
    && !/soldier/i.test(r.vehicle));
  const claimed = new Set();
  for (const life of rec.lives) {
    if (life.killedAt === undefined) continue;
    const t = life.killedAt;
    const server = serverWrecks.find(r => !claimed.has(r) && r.vehicle === life.tmpl && Math.abs(r.t - t) < SAME_EVENT);
    if (server) claimed.add(server);
    const crew = crewOf(rec, life, Math.max(life.created, t - 0.3)).map(c => c.pid);
    const by = server?.pid ?? null;
    add({ t, kind: 'vehicle', tmpl: life.tmpl, nid: life.nid, crew, by,
          team: by !== null ? playerTeam(rec, by, t) : life.team || 0 });
  }
  for (const r of serverWrecks) {
    if (claimed.has(r) || r.t < 0 || r.t > rec.duration) continue;
    add({ t: r.t, kind: 'vehicle', tmpl: r.vehicle, nid: null, crew: [], by: r.pid,
          team: r.pid !== null ? playerTeam(rec, r.pid, r.t) : 0, server: true });
  }

  for (const c of rec.captures ?? []) add({ t: c.t, kind: 'capture', name: c.name, team: c.team });

  // The recording player into the round, and back into it after each death.
  const own = recordingPlayer(rec);
  if (own !== null) {
    for (const { t, life } of spawnsOf(rec, own)) {
      add({ t, kind: 'spawn', pid: own, at: spawnPoint(rec, life), team: playerTeam(rec, own, t) });
    }
  }

  const init = serverRows.find(r => r.kind === 'roundInit' && r.t >= 0 && r.t <= rec.duration);
  const start = rec.roundStarted ?? init?.t ?? null;
  if (start !== null) add({ t: start, kind: 'round-start', team: 0 });
  const stats = serverRows.find(r => r.kind === 'roundstats' && r.t >= 0 && r.t <= rec.duration + 2);
  const end = Number.isFinite(rec.roundEnded) ? rec.roundEnded : stats?.t ?? null;
  if (end !== null) add({ t: Math.min(end, rec.duration), kind: 'round-end', team: stats?.winner ?? 0, winner: stats?.winner ?? null });

  chapters.sort((a, b) => a.t - b.t);
  return chapters;
}

/** Whether a chapter is `pid`'s: his kill, death or spawn, or a hull he
 *  rode or destroyed. */
export function involves(ch, pid) {
  if (pid === null || pid === undefined) return false;
  return ch.killer === pid || ch.victim === pid || ch.by === pid || Boolean(ch.crew?.includes(pid))
    || (ch.kind === 'spawn' && ch.pid === pid);
}

/** A chapter in the game's own words where it has them: the kill log's
 *  `killer [weapon] victim`, the capture line. `lexicon` is the message
 *  log's `{ strings, names }` (comms.js), or null for the plain templates. */
export function chapterText(rec, ch, lexicon = null) {
  const strings = lexicon?.strings ?? null;
  const names = lexicon?.names ?? null;
  const display = key => (key ? names?.[key] ?? key : '');
  const name = pid => playerName(rec, pid, ch.t);
  switch (ch.kind) {
    case 'kill': return killLine(name(ch.killer), name(ch.victim), killWord(ch.weapon, strings, names));
    case 'teamkill': return `${teamKillLine(name(ch.killer), strings)}: ${name(ch.victim)}`;
    case 'death': return deathLine(name(ch.victim), strings);
    case 'vehicle': return `${display(ch.tmpl)} destroyed${ch.by !== null && ch.by !== undefined ? ` by ${name(ch.by)}` : ''}`;
    case 'capture': return captureLine(display(ch.name), ch.team, strings).trim();
    case 'spawn': {
      const at = ch.at ? names?.[ch.at] ?? String(ch.at).replace(/_/g, ' ') : null;
      return `${name(ch.pid)} spawned${at ? ` at ${at}` : ''}`;
    }
    case 'round-start': return 'Round started';
    case 'round-end': return ch.winner ? `Round over: ${teamName(ch.winner)} win` : 'Round over';
    default: return ch.kind;
  }
}

/** Where a jump to a chapter lands. */
export const chapterStart = ch => Math.max(0, ch.t - ch.lead);

/** The next chapter to jump to after `t` (its start past the playhead), or
 *  null; `pid` keeps only his. */
export function nextChapter(chapters, t, pid = null) {
  for (const ch of chapters) {
    if (pid !== null && !involves(ch, pid)) continue;
    if (chapterStart(ch) > t + 0.25) return ch;
  }
  return null;
}

/** The chapter before `t`: the last one starting more than a moment behind
 *  the playhead, so a second press steps back again. */
export function prevChapter(chapters, t, pid = null) {
  let found = null;
  for (const ch of chapters) {
    if (pid !== null && !involves(ch, pid)) continue;
    if (chapterStart(ch) < t - 1.5) found = ch;
    else break;
  }
  return found;
}

/**
 * Whether the recording client had `life` in range at `t`. The server stops
 * sending an object beyond the map's view distance from the recording
 * player (`Game.setViewDistance`: Wake's 500 m cut at about 520, Kursk's
 * 400 m at 407 to 416 in replay_20260927-140921), so the replay has only its
 * last pose until it comes back, drawn as a ghost. `{ since }`, the time it
 * went (null when it was never in range), or undefined while it is.
 */
export function outOfRange(life, t) {
  if (!life || isReplicated(life, t)) return undefined;
  let since = null;
  for (const [, to] of life.replicated) {
    if (to <= t && (since === null || to > since)) since = to;
  }
  return { since };
}

/**
 * What `pid` is doing at `t`: `{ state }` with `state` one of foot (`life`,
 * his soldier), vehicle (`life` the hull, `seat`), dead (`killedBy`, the
 * kill line that did it, if any), spawning (on the spawn screen before his
 * first life), left, or absent (nothing recorded of him yet). On foot and in
 * a vehicle, `outOfRange` says when the recording lost sight of him.
 */
export function playerStatusAt(rec, pid, t, kills = rec.kills) {
  const player = playerAt(rec, pid, t);
  if (player?.leftT !== undefined && t >= player.leftT) return { state: 'left' };
  const nid = controlledAt(rec, pid, t);
  if (nid === null) return { state: 'absent' };
  const own = lifeAt(rec, nid, t);
  const dead = () => {
    let killedBy = null;
    for (const k of kills) {
      if (k.t > t) break;
      if (k.victim === pid) killedBy = k;
    }
    return { state: 'dead', killedBy };
  };
  if (own?.soldier) {
    if (own.diedAt !== undefined && t >= own.diedAt) return dead();
    return { state: 'foot', life: own, outOfRange: outOfRange(own, t) };
  }
  if (!own?.camera) {
    const root = rootOf(rec, nid, t, pid);
    if (root && !root.life.soldier && !root.life.camera) {
      return { state: 'vehicle', life: root.life, seat: root.seat, outOfRange: outOfRange(root.life, t) };
    }
  }
  const lived = rec.lives.some(l => l.soldier && l.pid === pid && l.created <= t);
  return lived ? dead() : { state: 'spawning' };
}

/** Kills and deaths per player up to `t`, as the scoreboard counts them: a
 *  team kill is no kill, every death is a death. With `rec`, only the ones
 *  of the player who holds each pid at `t`: the one before him under that
 *  id took his score with him when he left. */
export function tallyAt(kills, t, rec = null) {
  const out = new Map();
  const of = pid => {
    if (!out.has(pid)) out.set(pid, { kills: 0, deaths: 0 });
    return out.get(pid);
  };
  const his = (pid, at) => !rec || playerAt(rec, pid, at) === playerAt(rec, pid, t);
  for (const k of kills) {
    if (k.t > t) break;
    if (k.kind === 'kill' && k.killer !== null && k.killer !== undefined && his(k.killer, k.t)) of(k.killer).kills++;
    if (k.victim !== null && k.victim !== undefined && his(k.victim, k.t)) of(k.victim).deaths++;
  }
  return out;
}

/** Everyone the recording knows of, in a steady order: Axis, then Allies,
 *  then anyone without a side, each by name. `[{ pid, name, team, ai }]`,
 *  each as he was at `t` (the id's last holder without it). */
export function rosterOf(rec, t = null) {
  const pids = new Set([...rec.players.keys(), ...(rec.playerNids?.keys() ?? [])]);
  const order = team => (team === 1 ? 0 : team === 2 ? 1 : 2);
  return [...pids].map(pid => ({
    pid,
    name: playerName(rec, pid, t),
    team: playerTeam(rec, pid, t) || rec.control.find(c => c.pid === pid)?.team || 0,
    ai: Boolean(playerAt(rec, pid, t)?.ai),
  })).sort((a, b) => order(a.team) - order(b.team) || a.name.localeCompare(b.name));
}

/**
 * The lines the game's message log printed, in time order (comms.js writes
 * them): `{ t, type: 'kill', kind, killer, victim, weapon, killerTeam,
 * victimTeam }`, `{ t, type: 'capture', name, team }`, `{ t, type: 'chat',
 * text, team }` and `{ t, type: 'radio', pid, msg, global }`, the radio the
 * recording player heard. A v3+ recording has the chat box itself
 * (`rec.chat`, the line as shown); an older one only the fragments its feed
 * rows carry.
 */
export function feedEvents(rec, kills = rec.kills) {
  const out = [];
  for (const k of kills) {
    out.push({ t: k.t, type: 'kill', kind: k.kind, killer: k.killer, victim: k.victim, weapon: k.weapon,
               killerTeam: k.killer === null || k.killer === undefined ? 0 : killerTeamOf(rec, k),
               victimTeam: victimTeamOf(rec, k) });
  }
  for (const c of rec.captures ?? []) out.push({ t: c.t, type: 'capture', name: c.name, team: c.team });
  for (const r of rec.radio ?? []) out.push({ t: r.t, type: 'radio', pid: r.pid, msg: r.msg, global: r.global });
  if (rec.chat.length) {
    for (const c of rec.chat) out.push({ t: c.t, type: 'chat', text: c.text, team: c.team ?? playerTeam(rec, c.pid, c.t) });
  } else {
    const byName = new Map([...rec.sessions?.values() ?? []].flat().map(p => [p.name, p.team]));
    for (const row of rec.events) {
      if (row.kind !== 'chat' || row.source !== 'client') continue;
      const speaker = row.text.slice(0, Math.max(0, row.text.indexOf(': ')));
      out.push({ t: row.t, type: 'chat', text: row.text, team: byName.get(speaker) ?? 0 });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}
