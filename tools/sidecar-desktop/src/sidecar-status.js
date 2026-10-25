'use strict';
// Reads the sidecar's console lines (tools/bf1942-models/sidecar/sidecar.mjs)
// into the session state the tray shows. One line in, the state change it
// means out (or null for a line that changes nothing). Kept pure so the
// patterns are tested against the sidecar's real wording.

// state: starting -> listening -> connecting -> joined
//        joined -> rejoining -> joined
//        any -> unreachable (still trying) | denied | kicked | lost | ended
const { decodeName } = require('./servers');

const RULES = [
  // ws.listen() resolved: the page can connect now.
  [/^\[sidecar\] live feed: http:\/\/127\.0\.0\.1:(\d+)\//, (m) => ({ state: 'listening', wsPort: Number(m[1]) })],
  [/^\[sidecar\] connected id=/, () => ({ state: 'connecting' })],
  // --name-from-page: who the sidecar joins as, the page's profile name or
  // the --name fallback.
  [/^\[sidecar\] player name: (.+) \((from the page|fallback)\)$/, (m) => ({
    playerName: m[1], playerNameFrom: m[2] === 'from the page' ? 'page' : 'fallback',
  })],
  // What the server is: its name (GameSpy hostname or the live list's), and
  // the level it plays, before the join and at every level load.
  [/^\[sidecar\] server name: (.+)$/, (m) => ({ reportedName: m[1].trim() })],
  [/^\[sidecar\] the server plays (.+?) (\S*) ?\(mod ([^,)]+)/, (m) => ({ mapName: m[1], gameType: m[2] || null, mod: m[3].trim() })],
  [/^\[sidecar\] loading (\S+) (\S+) \(mod ([^,)]+)/, (m) => ({ mapName: levelOf(m[1]), gameType: m[2].replace(/\.con$/i, ''), mod: m[3].trim() })],
  [/^\[sidecar\] joined as player (\d+) team (\d+): (\d+) players/, (m) => ({
    state: 'joined', playerId: Number(m[1]), team: Number(m[2]), joinedPlayers: Number(m[3]),
  })],
  [/^\[sidecar\] back on after/, () => ({ state: 'joined' })],
  [/^\[sidecar\] no answer from (\S+) after (\d+) s/, (m) => ({ state: 'unreachable', detail: `No answer from ${m[1]} after ${m[2]} s, still trying` })],
  [/^\[sidecar\] denied: (.*)$/, (m) => ({ state: 'denied', detail: `Denied: ${m[1]}` })],
  [/^\[sidecar\] server disconnected us: (.*)$/, (m) => ({ detail: `Disconnected: ${m[1]}` })],
  [/^\[sidecar\] level over:/, () => ({ state: 'rejoining', detail: 'Level change, rejoining' })],
  [/^\[sidecar\] rejoining \(attempt (\d+)/, (m) => ({ state: 'rejoining', detail: `Rejoining (attempt ${m[1]})` })],
  [/^\[sidecar\] not rejoining: (.*)$/, (m) => ({ state: 'ended', detail: m[1] })],
  [/^\[sidecar\] page connected/, () => ({ pageConnected: true })],
  [/^\[sidecar\] page socket closed \((\d+) open\)/, (m) => ({ pageConnected: Number(m[1]) > 0 })],
  [/^\[sidecar\] page refused: (.*)$/, (m) => ({ detail: `A page was refused: ${m[1]}` })],
  [/^\[sidecar\] leaving/, () => ({ state: 'leaving' })],
  [/EADDRINUSE.*?:(\d+)/, (m) => ({ state: 'failed', detail: `Port ${m[1]} is in use (another sidecar running?)` })],
];

/** `bf1942/levels/market_garden/` -> `market_garden`. */
function levelOf(levelPath) {
  const parts = String(levelPath).split(/[\\/]+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : String(levelPath);
}

function parseLine(line) {
  const t = String(line).trim();
  for (const [re, fn] of RULES) {
    const m = re.exec(t);
    if (m) return fn(m);
  }
  return null;
}

/** The server's name for display: the live list's, else what the sidecar
 * reported (decoded as the site decodes names), else its address. */
function displayName(session) {
  if (!session) return '';
  if (session.serverName) return session.serverName;
  if (session.reportedName) return decodeName(session.reportedName);
  return session.address;
}

/** The one-line status the tooltip and notifications show. */
function describe(session) {
  if (!session || session.state === 'idle') return 'Idle';
  const name = displayName(session);
  const where = name !== session.address ? `${name} (${session.address})` : session.address;
  const map = session.mapName ? ` - ${mapTitle(session.mapName)}` : '';
  switch (session.state) {
    case 'starting':
    case 'listening':
    case 'connecting':
      return `Joining ${where}`;
    case 'unreachable':
      return `Joining ${where}: no answer yet`;
    case 'joined':
      return `In game on ${where}${map}`;
    case 'rejoining':
      return `Rejoining ${where}`;
    case 'leaving':
      return `Leaving ${where}`;
    case 'denied':
    case 'ended':
    case 'failed':
      return `Ended: ${session.detail || session.state}`;
    default:
      return `${session.state} ${where}`;
  }
}

// The states the tray icon marks: in game (green dot) and on the way in
// (orange dot). Anything else is the plain icon.
const JOINING_STATES = new Set(['starting', 'listening', 'connecting', 'unreachable', 'rejoining', 'leaving']);

/** 'joined', 'joining' or null: which status dot the tray icon carries. */
function trayIconState(session) {
  if (!session) return null;
  if (session.state === 'joined') return 'joined';
  return JOINING_STATES.has(session.state) ? 'joining' : null;
}

/** A level's display name: `market_garden` -> `Market Garden`. */
function mapTitle(name) {
  if (!name) return '';
  return String(name).replace(/_/g, ' ').replace(/\b([a-z])/g, (c) => c.toUpperCase());
}

// Game modes as players say them (the list and the sidecar give the con names).
const GAME_TYPES = { conquest: 'Conquest', ctf: 'CTF', tdm: 'TDM', coop: 'Co-op', objectivemode: 'Objective', objective: 'Objective', singleplayer: 'Single player' };

/** `ctf` -> `CTF`, `coop` -> `Co-op`; anything else title-cased. */
function gameTypeTitle(type) {
  if (!type) return '';
  return GAME_TYPES[String(type).toLowerCase()] ?? mapTitle(type);
}

/** The menu's session header: what state, which server, what it plays. */
function sessionLines(session) {
  if (!session || session.state === 'idle') return { title: 'Not on a server', lines: [] };
  if (['denied', 'ended', 'failed'].includes(session.state)) {
    return { title: `Last session ended: ${session.detail || session.state}`, lines: [] };
  }
  const title = {
    starting: 'Joining...', listening: 'Joining...', connecting: 'Joining...',
    unreachable: 'Joining: no answer yet', joined: 'In game', rejoining: 'Rejoining...', leaving: 'Leaving...',
  }[session.state] ?? session.state;
  const name = displayName(session);
  const lines = [name !== session.address ? `${name} (${session.address})` : session.address];
  const map = [mapTitle(session.mapName), session.gameType ? mapTitle(session.gameType) : '']
    .filter(Boolean).join(', ');
  const count = session.players != null && session.maxPlayers
    ? `${session.players}/${session.maxPlayers} players`
    : (session.joinedPlayers != null ? `${session.joinedPlayers} players at join` : '');
  const second = [map, count].filter(Boolean).join(' - ');
  if (second) lines.push(second);
  if (session.playerName) lines.push(`Playing as ${session.playerName}`);
  else if (session.nameFromPage) lines.push("Playing as: waiting for the viewer's profile");
  return { title, lines };
}

module.exports = { parseLine, describe, displayName, sessionLines, trayIconState, mapTitle, gameTypeTitle, levelOf };
