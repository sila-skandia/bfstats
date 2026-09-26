// What a replay's timeline, message log and scoreboard read out of a round:
// its chapters (kills and deaths, vehicles destroyed, flags taken, the round's
// start and end), the lines the game's own message log printed, and each
// player's state and tally at a time. Pure functions of the parsed recording
// and the aligned server log (replay-recording.js, replay-server-log.js), so
// `tests/replay_harness.mjs` runs them under node.
// features/round-replay-ux/README.md is the design.

import { controlledAt, crewOf, lifeAt, rootOf, teamName } from './replay-recording.js';
import { captureLine, deathLine, killLine, killWord, teamKillLine } from './chat-log.js';

/** How far before its moment a chapter starts, seconds: a jump to a kill
 *  lands in time to see it happen, a capture on the last of the hold. */
const LEAD = { kill: 3, teamkill: 3, death: 3, vehicle: 3, capture: 6, 'round-start': 0, 'round-end': 3 };

/** A server event this close to a recorded one is the same event, seconds. */
const SAME_EVENT = 1.5;

export const playerName = (rec, pid) => rec.players.get(pid)?.name ?? `player ${pid}`;
export const playerTeam = (rec, pid) => rec.players.get(pid)?.team ?? 0;

/** The player whose client made the recording: the one whose rounds the
 *  recorder marks `local` (v4), else the round's human. His own view is the
 *  recording's (the hit indicator is his alone, `rec.hitsTaken`). */
export function recordingPlayer(rec) {
  const shot = rec.fires.find(f => f.local && f.pid !== null && f.pid !== undefined);
  if (shot) return shot.pid;
  for (const [pid, player] of rec.players) if (!player.ai) return pid;
  return null;
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

/**
 * The round's chapters, in time order: `{ t, kind, lead, team, ... }` with
 * `kind` one of kill, teamkill, death (`killer`, `victim`, `weapon`),
 * vehicle (`tmpl`, `crew` the players aboard, `by` the destroyer when the
 * server's log names him), capture (`name`, `team`), round-start and
 * round-end (`winner`). `team` is the side the chapter is drawn in.
 */
export function buildChapters(rec, serverRows = [], kills = killsOf(rec, serverRows)) {
  const chapters = [];
  const add = ch => chapters.push({ lead: LEAD[ch.kind] ?? 0, ...ch });

  for (const k of kills) {
    const team = k.kind === 'death' ? playerTeam(rec, k.victim) : playerTeam(rec, k.killer);
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
          team: by !== null ? playerTeam(rec, by) : life.team || 0 });
  }
  for (const r of serverWrecks) {
    if (claimed.has(r) || r.t < 0 || r.t > rec.duration) continue;
    add({ t: r.t, kind: 'vehicle', tmpl: r.vehicle, nid: null, crew: [], by: r.pid,
          team: r.pid !== null ? playerTeam(rec, r.pid) : 0, server: true });
  }

  for (const c of rec.captures ?? []) add({ t: c.t, kind: 'capture', name: c.name, team: c.team });

  const init = serverRows.find(r => r.kind === 'roundInit' && r.t >= 0 && r.t <= rec.duration);
  const start = rec.roundStarted ?? init?.t ?? null;
  if (start !== null) add({ t: start, kind: 'round-start', team: 0 });
  const stats = serverRows.find(r => r.kind === 'roundstats' && r.t >= 0 && r.t <= rec.duration + 2);
  const end = Number.isFinite(rec.roundEnded) ? rec.roundEnded : stats?.t ?? null;
  if (end !== null) add({ t: Math.min(end, rec.duration), kind: 'round-end', team: stats?.winner ?? 0, winner: stats?.winner ?? null });

  chapters.sort((a, b) => a.t - b.t);
  return chapters;
}

/** Whether a chapter is `pid`'s: his kill or death, or a hull he rode or
 *  destroyed. */
export function involves(ch, pid) {
  if (pid === null || pid === undefined) return false;
  return ch.killer === pid || ch.victim === pid || ch.by === pid || Boolean(ch.crew?.includes(pid));
}

/** A chapter in the game's own words where it has them: the kill log's
 *  `killer [weapon] victim`, the capture line. `lexicon` is the message
 *  log's `{ strings, names }` (comms.js), or null for the plain templates. */
export function chapterText(rec, ch, lexicon = null) {
  const strings = lexicon?.strings ?? null;
  const names = lexicon?.names ?? null;
  const display = key => (key ? names?.[key] ?? key : '');
  const name = pid => playerName(rec, pid);
  switch (ch.kind) {
    case 'kill': return killLine(name(ch.killer), name(ch.victim), killWord(ch.weapon, strings, names));
    case 'teamkill': return `${teamKillLine(name(ch.killer), strings)}: ${name(ch.victim)}`;
    case 'death': return deathLine(name(ch.victim), strings);
    case 'vehicle': return `${display(ch.tmpl)} destroyed${ch.by !== null && ch.by !== undefined ? ` by ${name(ch.by)}` : ''}`;
    case 'capture': return captureLine(display(ch.name), ch.team, strings).trim();
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
 * What `pid` is doing at `t`: `{ state }` with `state` one of foot (`life`,
 * his soldier), vehicle (`life` the hull, `seat`), dead (`killedBy`, the
 * kill line that did it, if any), spawning (on the spawn screen before his
 * first life), left, or absent (nothing recorded of him yet).
 */
export function playerStatusAt(rec, pid, t, kills = rec.kills) {
  const player = rec.players.get(pid);
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
    return { state: 'foot', life: own };
  }
  if (!own?.camera) {
    const root = rootOf(rec, nid, t, pid);
    if (root && !root.life.soldier && !root.life.camera) return { state: 'vehicle', life: root.life, seat: root.seat };
  }
  const lived = rec.lives.some(l => l.soldier && l.pid === pid && l.created <= t);
  return lived ? dead() : { state: 'spawning' };
}

/** Kills and deaths per player up to `t`, as the scoreboard counts them: a
 *  team kill is no kill, every death is a death. */
export function tallyAt(kills, t) {
  const out = new Map();
  const of = pid => {
    if (!out.has(pid)) out.set(pid, { kills: 0, deaths: 0 });
    return out.get(pid);
  };
  for (const k of kills) {
    if (k.t > t) break;
    if (k.kind === 'kill' && k.killer !== null && k.killer !== undefined) of(k.killer).kills++;
    if (k.victim !== null && k.victim !== undefined) of(k.victim).deaths++;
  }
  return out;
}

/** Everyone the recording knows of, in a steady order: Axis, then Allies,
 *  then anyone without a side, each by name. `[{ pid, name, team, ai }]`. */
export function rosterOf(rec) {
  const pids = new Set([...rec.players.keys(), ...(rec.playerNids?.keys() ?? [])]);
  const order = team => (team === 1 ? 0 : team === 2 ? 1 : 2);
  return [...pids].map(pid => ({
    pid,
    name: playerName(rec, pid),
    team: playerTeam(rec, pid) || rec.control.find(c => c.pid === pid)?.team || 0,
    ai: Boolean(rec.players.get(pid)?.ai),
  })).sort((a, b) => order(a.team) - order(b.team) || a.name.localeCompare(b.name));
}

/**
 * The lines the game's message log printed, in time order (comms.js writes
 * them): `{ t, type: 'kill', kind, killer, victim, weapon }`, `{ t, type:
 * 'capture', name, team }` and `{ t, type: 'chat', text, team }`. A v3+
 * recording has the chat box itself (`rec.chat`, the line as shown); an
 * older one only the fragments its feed rows carry.
 */
export function feedEvents(rec, kills = rec.kills) {
  const out = [];
  for (const k of kills) out.push({ t: k.t, type: 'kill', kind: k.kind, killer: k.killer, victim: k.victim, weapon: k.weapon });
  for (const c of rec.captures ?? []) out.push({ t: c.t, type: 'capture', name: c.name, team: c.team });
  if (rec.chat.length) {
    for (const c of rec.chat) out.push({ t: c.t, type: 'chat', text: c.text, team: c.team ?? playerTeam(rec, c.pid) });
  } else {
    const byName = new Map([...rec.players.values()].map(p => [p.name, p.team]));
    for (const row of rec.events) {
      if (row.kind !== 'chat' || row.source !== 'client') continue;
      const speaker = row.text.slice(0, Math.max(0, row.text.indexOf(': ')));
      out.push({ t: row.t, type: 'chat', text: row.text, team: byName.get(speaker) ?? 0 });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}
