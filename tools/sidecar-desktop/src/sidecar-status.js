'use strict';
// Reads the sidecar's console lines (tools/bf1942-models/sidecar/sidecar.mjs)
// into the session state the tray shows. One line in, the state change it
// means out (or null for a line that changes nothing). Kept pure so the
// patterns are tested against the sidecar's real wording.

// state: starting -> listening -> connecting -> joined
//        joined -> rejoining -> joined
//        any -> unreachable (still trying) | denied | kicked | lost | ended
const RULES = [
  // ws.listen() resolved: the page can connect now.
  [/^\[sidecar\] live feed: http:\/\/127\.0\.0\.1:(\d+)\//, (m) => ({ state: 'listening', wsPort: Number(m[1]) })],
  [/^\[sidecar\] connected id=/, () => ({ state: 'connecting' })],
  [/^\[sidecar\] joined as player (\d+) team (\d+): (\d+) players/, (m) => ({
    state: 'joined', playerId: Number(m[1]), team: Number(m[2]), players: Number(m[3]),
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

function parseLine(line) {
  const t = String(line).trim();
  for (const [re, fn] of RULES) {
    const m = re.exec(t);
    if (m) return fn(m);
  }
  return null;
}

/** The one-line status the tray menu shows. */
function describe(session) {
  if (!session || session.state === 'idle') return 'Idle';
  const where = session.serverName ? `${session.serverName} (${session.address})` : session.address;
  const map = session.mapName ? ` - ${session.mapName}` : '';
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

module.exports = { parseLine, describe };
