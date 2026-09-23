// The room server's lobby, as the MULTIPLAY screen reads it.
//
// `GET /netcode/rooms` on the same origin and path prefix as the WebSocket,
// one row per running room. This owns the list, whether the last read
// answered, and the timer that keeps reading; the screen asks it for the rows
// and whether the server is there. Split out of `multiplay.js`.

/** The room server's JSON lobby, and how often the browser re-reads it.
 *  The game's own list is a REFRESH button; this one is the room server on
 *  the same origin, so it can just keep looking. */
export const ROOMS_URL = '/netcode/rooms';
export const POLL_MS = 3000;

/**
 * @param {object} [options]
 * @param {string} [options.url]
 * @param {number} [options.pollMs]
 * @param {(row: object) => object} [options.decorate]  a lobby row as the
 *                                screen lists it
 * @param {() => void} [options.onPolled]  after every read, answered or not
 */
export function createLobby({
  url = ROOMS_URL,
  pollMs = POLL_MS,
  decorate = row => row,
  onPolled = () => {},
} = {}) {
  let rooms = [];
  let lastError = null;
  let polled = false;
  let timer = null;

  /** Whether the room server answered the last time this asked. Until the
   *  first answer it is neither: nothing is offered and nothing is refused.
   *  CREATE GAME hangs off this — there is no point making a room on a
   *  server that is not there, and Instant Battle still works. */
  const online = () => polled && lastError === null;

  async function poll() {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      // `server.mjs` answers `{rooms: [...]}`; a bare array is accepted too
      // so a hand-rolled lobby behind the same path still lists.
      const body = await res.json();
      const list = Array.isArray(body) ? body : body?.rooms;
      rooms = Array.isArray(list) ? list.map(decorate) : [];
      lastError = null;
    } catch (error) {
      // Said on the canvas, where the rows would be, in the screen's own
      // face — not in the page's status bar, which is for the things that
      // stop the screen existing at all (a missing pack).
      lastError = error;
      rooms = [];
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
    online,
    get rooms() { return rooms; },
    get lastError() { return lastError; },
  };
}
