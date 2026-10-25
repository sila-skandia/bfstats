'use strict';
// The live server list bfstats.io shows, for the Join server submenu.

const LIVE_URL = 'https://bfstats.io/stats/LiveServers/bf1942/servers';

// Server names arrive as cp1251 bytes read as cp1252 when the server is
// Cyrillic; decoded for display only, as the site does
// (ui/src/utils/playerName.ts, api/Utils/PlayerNameDecoder.cs; keep in sync).
const CP1252_HIGH = {
  '\u20ac': 0x80, '\u201a': 0x82, '\u0192': 0x83, '\u201e': 0x84, '\u2026': 0x85, '\u2020': 0x86,
  '\u2021': 0x87, '\u02c6': 0x88, '\u2030': 0x89, '\u0160': 0x8a, '\u2039': 0x8b, '\u0152': 0x8c,
  '\u017d': 0x8e, '\u2018': 0x91, '\u2019': 0x92, '\u201c': 0x93, '\u201d': 0x94, '\u2022': 0x95,
  '\u2013': 0x96, '\u2014': 0x97, '\u02dc': 0x98, '\u2122': 0x99, '\u0161': 0x9a, '\u203a': 0x9b,
  '\u0153': 0x9c, '\u017e': 0x9e, '\u0178': 0x9f,
};
let cp1251 = null;
try { cp1251 = new TextDecoder('windows-1251'); } catch { /* no ICU: names stay raw */ }

function decodeName(raw) {
  if (!raw || !cp1251) return raw ?? '';
  const bytes = Uint8Array.from(raw, (c) => CP1252_HIGH[c] ?? (c.charCodeAt(0) <= 0xff ? c.charCodeAt(0) : 0x3f));
  let latin = 0; let nonLatin = 0;
  for (const b of bytes) {
    if ((b >= 65 && b <= 90) || (b >= 97 && b <= 122)) latin++;
    else if (b >= 192) nonLatin++;
  }
  const total = latin + nonLatin;
  return total && nonLatin / total >= 0.8 ? cp1251.decode(bytes) : raw;
}

/** Populated servers first (most players first), then the empty ones by name. */
function sortServers(list) {
  return [...list].sort((a, b) => (b.numPlayers ?? 0) - (a.numPlayers ?? 0)
    || String(a.name ?? '').localeCompare(String(b.name ?? '')));
}

/** Keep only the fields the menu uses, and only entries with an address. */
function normalise(raw) {
  const servers = Array.isArray(raw?.servers) ? raw.servers : [];
  return servers
    .filter((s) => s && typeof s.ip === 'string' && Number.isInteger(s.port))
    .map((s) => ({
      name: decodeName(String(s.name ?? `${s.ip}:${s.port}`)),
      ip: s.ip,
      port: s.port,
      mapId: s.mapId ?? null,
      mapName: s.mapName ?? null,
      gameType: s.gameType ?? null,
      numPlayers: Number(s.numPlayers ?? 0),
      maxPlayers: Number(s.maxPlayers ?? 0),
      anticheat: s.anticheat === true,
      password: s.password === true,
    }));
}

async function fetchServers({ url = LIVE_URL, timeoutMs = 10000, fetchImpl = globalThis.fetch } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return sortServers(normalise(await res.json()));
  } finally {
    clearTimeout(timer);
  }
}

/** The menu label of a server: players, name, map, and the markers. */
function serverLabel(s) {
  const marks = [s.anticheat ? '[AC]' : '', s.password ? '[PW]' : ''].filter(Boolean).join(' ');
  const map = s.mapName ? ` - ${s.mapName}` : '';
  return `${s.numPlayers}/${s.maxPlayers}  ${s.name}${map}${marks ? `  ${marks}` : ''}`;
}

module.exports = { LIVE_URL, decodeName, fetchServers, sortServers, normalise, serverLabel };
