// Which mod, level and game type a server is playing, before joining it, so
// the level's tables can be fetched ahead of the connect (level-tables.mjs).
//
// Two sources, both best effort and quick:
//   - the bfstats.io live server list (`/stats/LiveServers/bf1942/servers`),
//     whose rows carry `mapId` (the mod: BF1942, XPack1, DC_Final ...),
//     `mapName` ("market garden") and `gameType` ("conquest", "coop" ...);
//   - the server's own GameSpy `\status\` answer on its query port (the lab's
//     gameSpyPort 23001 for 14568, 23000 for 14567: game port + 8433; the LAN
//     port, + 7433, answers the same), keys `gameId`, `mapname`, `gametype`.
//
// The in-session SetLevel is the authority either way (session.mjs holds the
// level load until its tables are ready); this only saves that wait.
//
//   SIDECAR_LIVE_LIST   the live list URL ("off" skips it)

import dgram from 'node:dgram';

export const DEFAULT_LIVE_LIST = 'https://bfstats.io/stats/LiveServers/bf1942/servers';

/** `\gameId\bf1942\mapname\Wake\...` -> { gameId: 'bf1942', mapname: 'Wake', ... }. */
export function parseGamespy(text) {
  const parts = String(text).split('\\');
  const out = {};
  for (let i = 1; i + 1 < parts.length; i += 2) if (parts[i]) out[parts[i].toLowerCase()] = parts[i + 1];
  return out;
}

/** A GameSpy status answer as { mod, level, mode }, or null. */
export function levelFromGamespy(kv) {
  const mod = kv.gameid || kv.mapid || null;
  const level = kv.mapname || null;
  return mod && level ? { mod, level, mode: kv.gametype || null, source: 'gamespy' } : null;
}

/** A live list row as { mod, level, mode }, or null. */
export function levelFromLiveRow(row) {
  const mod = row?.mapId || row?.gameId || null;
  const level = row?.mapName || null;
  return mod && level ? { mod, level, mode: row.gameType || null, source: 'live list', queryPort: row.queryPort ?? null } : null;
}

export function gamespyStatus(host, port, { timeoutMs = 1200 } = {}) {
  return new Promise((resolve) => {
    const sock = dgram.createSocket('udp4');
    let done = false;
    const chunks = [];
    const end = (v) => {
      if (done) return; done = true;
      clearTimeout(timer); clearTimeout(settle);
      try { sock.close(); } catch { /* closed */ }
      resolve(v);
    };
    const timer = setTimeout(() => end(chunks.length ? parseGamespy(chunks.join('')) : null), timeoutMs);
    let settle = null;
    sock.on('error', () => end(null));
    sock.on('message', (msg) => {
      chunks.push(msg.toString('latin1'));
      // The answer can span datagrams; `\final\` closes it.
      if (chunks.join('').includes('\\final\\')) end(parseGamespy(chunks.join('')));
      else { clearTimeout(settle); settle = setTimeout(() => end(parseGamespy(chunks.join(''))), 150); }
    });
    try { sock.send(Buffer.from('\\status\\'), port, host, (err) => { if (err) end(null); }); } catch { end(null); }
  });
}

async function liveListRow(host, port, { timeoutMs, fetchImpl = globalThis.fetch, url = process.env.SIDECAR_LIVE_LIST ?? DEFAULT_LIVE_LIST } = {}) {
  if (!url || /^(off|none|0)$/i.test(url) || typeof fetchImpl !== 'function') return null;
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const j = await res.json();
    const rows = Array.isArray(j) ? j : (j.servers ?? []);
    return rows.find((r) => r.ip === host && Number(r.port) === Number(port)) ?? null;
  } catch { return null; }
}

/**
 * { mod, level, mode, source } for the server at host:port, or null when
 * neither source answers within about `timeoutMs`.
 */
export async function queryServerLevel(host, port, { queryPort = null, timeoutMs = 2500, fetchImpl } = {}) {
  const row = await liveListRow(host, port, { timeoutMs, fetchImpl });
  const listed = levelFromLiveRow(row);
  // The server's own answer is current; the list can be a minute old.
  const guesses = row?.queryPort ? [row.queryPort] : [port + 8433, port + 7433];
  const ports = [...new Set([queryPort, ...guesses].filter((p) => Number.isInteger(Number(p)) && Number(p) > 0).map(Number))];
  for (const qp of ports) {
    const kv = await gamespyStatus(host, qp, { timeoutMs: Math.min(1200, timeoutMs) });
    const got = kv && levelFromGamespy(kv);
    if (got) return { ...got, queryPort: qp };
  }
  return listed;
}
