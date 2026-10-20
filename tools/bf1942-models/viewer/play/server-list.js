// The internet servers, as the MULTIPLAY screen lists them.
//
// The game fills `Join/Internet/InternetServerList` from the GameSpy master
// and each server's own reply. That master is long gone; the stats site
// keeps the same list (BFList, polled every 30 s) and its landing page reads
// it from `GET /stats/liveservers/bf1942/servers`. This reads the same
// endpoint and turns each server into the fields the engine's row builder
// reads off a GameSpy reply (`features/multiplay-front-end/README.md`, "The
// server rows").
//
// Where the API is: on play.bfstats.io it is this origin (HAProxy sends the
// play host's /stats to the API). A page served from this PC uses the API
// running here when one answers, else bfstats.io — whose CORS policy does
// not admit localhost for this endpoint, so a local page without a local API
// says the master server is down. `recordings-api.js` `resolveApi` decides.

import { resolveApi } from '../recordings-api.js';

/** The API's own edge cache holds the list for 30 s, so reading it more
 *  often would only read the same answer. */
export const POLL_MS = 30000;

/** One server off the API, as a row. Names are kept as the API sends them:
 *  the game draws a server's raw bytes in its Latin face, which is what the
 *  API's string already is (`$pn` decoding is the stats site's, for its own
 *  type, not the game's). The ping is the client's own round trip to the
 *  server, which a browser cannot take, so the column stays empty. */
export function serverRow(s) {
  return {
    kind: 'server',
    name: String(s.name ?? ''),
    players: Number(s.numPlayers) || 0,
    max: Number(s.maxPlayers) || 0,
    reserved: Number(s.reservedSlots) || 0,
    ping: null,
    gameType: String(s.gameType ?? ''),
    map: String(s.mapName ?? ''),
    address: s.ip ? `${s.ip}:${s.port}` : '',
    gameId: String(s.gameId || s.mapId || ''),
    password: !!s.password,
    dedicated: Number(s.dedicated) || 0,
    status: Number(s.status) || 0,
    pure: !!s.contentCheck,
    punkbuster: !!s.anticheat,
    joinLink: s.joinLink || (s.ip ? `bf1942://${s.ip}:${s.port}` : ''),
  };
}

/**
 * @param {object} [options]
 * @param {number} [options.pollMs]
 * @param {() => Promise<{base: string}>} [options.api]  where the API is
 * @param {() => void} [options.onPolled]  after every read, answered or not
 */
export function createServerList({
  pollMs = POLL_MS,
  api = () => resolveApi(),
  onPolled = () => {},
} = {}) {
  let servers = [];
  let lastError = null;
  let polled = false;
  let timer = null;
  let base = null;

  async function poll() {
    try {
      base ??= (await api()).base;
      const res = await fetch(`${base}/stats/liveservers/bf1942/servers`, {
        cache: 'no-cache',
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) throw new Error(String(res.status));
      const body = await res.json();
      const list = Array.isArray(body) ? body : body?.servers;
      servers = Array.isArray(list) ? list.map(serverRow) : [];
      lastError = null;
    } catch (error) {
      // Said on the canvas, where the rows would be, as the screen says the
      // room server's being down.
      lastError = error;
      servers = [];
    }
    polled = true;
    onPolled();
  }

  function start() { if (timer === null) { poll(); timer = setInterval(poll, pollMs); } }
  function stop() {
    if (timer !== null) clearInterval(timer);
    timer = null;
  }

  return {
    poll,
    start,
    stop,
    get polled() { return polled; },
    get servers() { return servers; },
    get lastError() { return lastError; },
  };
}
