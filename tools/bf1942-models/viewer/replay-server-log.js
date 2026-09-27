// The dedicated server's event log beside a round recording: read, aligned to
// the recording's clock, and turned into feed rows. The optional overlay of
// replay.js (`&serverlog=`).

import { teamName } from './replay-recording.js';

// Server-log events are matched to recording events within this window when
// the two clocks are aligned. A player's own chat is shown locally up to
// ~0.6 s before the server logs it.
const ALIGN_WINDOW = 1;

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
  // The server's settings block (`<bf:setting name="maxplayers">32`), and each
  // round's final tickets by team as numbers.
  const settings = {};
  for (const m of text.matchAll(/<bf:setting name="([^"]*)">([^<]*)<\/bf:setting>/g)) {
    const value = unescapeXml(m[2]);
    settings[m[1]] = value !== '' && Number.isFinite(Number(value)) ? Number(value) : value;
  }
  const finals = [...text.matchAll(statsRe)].map(m => ({
    t: Number(m[1]),
    tickets: Object.fromEntries([...m[2].matchAll(/<bf:teamtickets team="(\d+)">(-?\d+)<\/bf:teamtickets>/g)]
      .map(x => [Number(x[1]), Number(x[2])])),
  }));
  return { events, settings, finals };
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
  // The server's own clock at the join: event 0x04 (SimulationEvent) carries
  // the world time, which counts from the log's `roundInit` (the PREGAME
  // reset, `WorldPref::mWorldTime`). One more candidate, which needs no
  // shared event at all, and it still has to win the vote below.
  const inits = byName.get('roundInit') || [];
  for (const c of rec.clocks) {
    if (!c.exact) continue;
    for (const init of inits) offsets.add(Math.round((init.t + c.seconds - c.t) * 1000) / 1000);
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

/** Server events that repeat every second or so of a round (an engineer
 *  holding his wrench on a hull logs a begin/end pair per tick of repair) and
 *  would bury the feed. */
const QUIET = new Set(['beginRepair', 'endRepair', 'beginMedPack', 'endMedPack']);

export function serverRows(rec, log, alignment) {
  const names = new Map();
  for (const e of log.events) {
    if (e.name === 'createPlayer') names.set(e.params.player_id, e.params.name);
  }
  // Bots have no createPlayer in the log; the recording's CreatePlayer names
  // them (the same ids: the server's).
  const who = id => names.get(id) ?? rec.players?.get(id)?.name ?? `player ${id}`;
  const rows = [];
  for (const e of log.events) {
    const t = e.t - alignment.offset;
    if (t < -2 || t > rec.duration + 2) continue;
    if (QUIET.has(e.name)) continue;
    const p = e.params;
    const at = Array.isArray(p.vehicle_pos) ? p.vehicle_pos
      : Array.isArray(p.player_location) ? p.player_location : null;
    let text;
    switch (e.name) {
      case 'createPlayer': text = `${p.name} connected`; break;
      case 'spawnEvent': text = `${who(p.player_id)} spawned`; break;
      case 'pickupKit': text = `${who(p.player_id)} picked up ${p.kit}`; break;
      case 'chat': text = `${who(p.player_id)}: ${p.text}`; break;
      case 'destroyVehicle':
        text = p.player_id !== undefined ? `${who(p.player_id)} destroyed ${p.vehicle}` : `${p.vehicle} destroyed`;
        break;
      case 'scoreEvent': {
        const weapon = p.weapon && p.weapon !== '(none)' ? ` with ${p.weapon}` : '';
        if (/kill/i.test(p.score_type ?? '') && p.victim_id !== undefined) {
          text = `${who(p.player_id)} ${/tk|team/i.test(p.score_type) ? 'team-killed' : 'killed'} ${who(p.victim_id)}${weapon}`;
        } else {
          text = `${who(p.player_id)}: ${String(p.score_type ?? 'score').toLowerCase()}${weapon}`;
        }
        break;
      }
      case 'reSpawnEvent': text = `${who(p.player_id)} respawned`; break;
      case 'enterVehicle': text = `${who(p.player_id)} got into ${p.vehicle}`; break;
      case 'exitVehicle': text = `${who(p.player_id)} got out of ${p.vehicle}`; break;
      case 'setTeam': text = `${who(p.player_id)} switched to ${teamName(p.team)}`; break;
      case 'disconnectPlayer': text = `${who(p.player_id)} disconnected`; break;
      case 'destroyPlayer': text = `${who(p.player_id)} removed`; break;
      // Both of roundInit's ticket params are team 1's: the server reads
      // getTeamScore(1) for each (ledger TKT-6), so team 2's is not in the log.
      case 'roundInit': text = `round started, ${teamName(1)} tickets ${p.tickets_team1}`; break;
      case 'restartMap': text = 'map restarted'; break;
      case 'roundstats': text = `round over: ${teamName(p.winner)} win (${p.tickets.join(', ')})`; break;
      default: text = p.player_id !== undefined ? `${e.name} (${who(p.player_id)})` : e.name;
    }
    // What the replay's chapters and kill log read beside the text: who, whom,
    // with what, and the destroyed template (replay-chapters.js).
    rows.push({
      t, kind: e.name, text, source: 'server', at,
      pid: p.player_id ?? null,
      victim: p.victim_id ?? null,
      weapon: p.weapon && p.weapon !== '(none)' ? p.weapon : null,
      vehicle: p.vehicle ?? null,
      scoreType: p.score_type ?? null,
      winner: e.name === 'roundstats' ? p.winner : null,
    });
  }
  return rows;
}
