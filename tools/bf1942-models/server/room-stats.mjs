// A room's score board numbers on the wire: every player's score, kills,
// deaths and ping, in HELLO for a player joining and in a `stats` row when
// one changes.
//
// Retail keeps the four on the server's BFPlayer (score `+0xc0`, kills
// `+0xa4`, deaths `+0xa0`, ping `+0x94`; the reads in `bfPlayersCallback`,
// lnxded 0x0804d485..0x0804d4c5) and ghosts each to every client under its own
// state-mask bit (MEME-27), so a client joining mid-round is sent them with
// the player (`sendDatabase` 0x08134400, J-1) and the board is the server's
// from the first frame. The ping is the transport's own: the server stamps a
// ping request (`NetServer::sendPingRequest` 0x08436040, from
// `_updateConnections` 0x08433df7) and, when its answer comes back, stores
// the round trip in milliseconds on the connection (`SWConnection+0x9c`,
// `NetServer::_update` 0x084341e2), which `NetServer::getPing` 0x084382e0
// hands out.
//
// Here the tallies are the authority's round (`round-state.js` `counts`, by
// slot) and the ping is the round trip of the room's own pong: the page
// answers a MSG_PONG with a MSG_PING that carries the pong's server time back
// (`netcode-client.js`), and the room times it on its own clock.

import { eventRow } from './room-wire.mjs';

/** How often the room looks for a changed number, in 30 Hz ticks: twice a
 *  second. Sixteen players, four compares each. */
export const STATS_PERIOD_TICKS = 15;
/** A round trip longer than this is a page that slept, not a ping. */
const PING_MAX_MS = 60_000;

export function createRoomStats({ room }) {
  /** slot -> the `[score, kills, deaths, ping]` last sent. */
  const sent = new Map();

  function of(slot) {
    const tally = room.authority.round?.counts?.get(slot);
    const ping = room.players.get(slot)?.ping;
    return {
      score: tally?.score ?? 0, kills: tally?.kills ?? 0, deaths: tally?.deaths ?? 0,
      ping: Number.isFinite(ping) ? ping : 0,
    };
  }

  /** A MSG_PING body that carries a pong's server time back (bytes 4..7):
   *  the round trip, kept on the connection. True when it was one, and the
   *  room then sends no pong for it. */
  function onPingEcho(connection, body, nowMs) {
    if (body.length < 8) return false;
    const stamp = (body[4] | (body[5] << 8) | (body[6] << 16) | (body[7] << 24)) >>> 0;
    const trip = ((Math.max(0, Math.round(nowMs)) >>> 0) - stamp) >>> 0;
    if (trip <= PING_MAX_MS) connection.ping = trip;
    return true;
  }

  /** Once a room tick: every `STATS_PERIOD_TICKS`, the players whose numbers
   *  moved since they were last sent go to everyone in one `stats` row. */
  function step() {
    if (room.tick % STATS_PERIOD_TICKS !== 0) return;
    let rows = null;
    const slots = room.bots?.count ? [...room.players.keys(), ...room.bots.slots.keys()] : room.players.keys();
    for (const slot of slots) {
      const now = of(slot);
      const was = sent.get(slot);
      if (was && was[0] === now.score && was[1] === now.kills && was[2] === now.deaths
          && was[3] === now.ping) continue;
      const row = [now.score, now.kills, now.deaths, now.ping];
      sent.set(slot, row);
      (rows ??= []).push([slot, ...row]);
    }
    if (rows) room.broadcast(eventRow('stats', room.tick, { rows }), null);
  }

  function forget(slot) { sent.delete(slot); }

  return { of, onPingEcho, step, forget };
}
