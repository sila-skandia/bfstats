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

export function serverRows(rec, log, alignment) {
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
