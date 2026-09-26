// A room's outbound stream: the R-1 choke over its connections' rates, each
// connection's own snapshot cadence, and the 20 Hz record itself
// (netcode.js's encodeSnapshot) with the wire-edge conversions. Split out of
// `rooms.mjs`'s Room, whose `#choke`, `#broadcastSnapshots` and
// `snapshotPayload` call these.

import { MSG_SNAPSHOT, encodeSnapshot } from '../viewer/netcode.js';
import { CHOKE_CAP, RATE_BYTES, SNAPSHOT_RATE_MIN } from './room-rules.mjs';
import { frame } from './room-wire.mjs';

/** Radians (the World's facing) to the degrees the snapshot record carries.
 *  NaN travels as NaN -- a seated player's facing is the hull's. */
function degreesOf(radians) {
  return Number.isFinite(radians) ? radians * 180 / Math.PI : NaN;
}

/** R-1: while Σ(rate × 1044) > cap, the highest-rate connections above the
 *  floor lose 5 — the engine's "lower the offending rates" (netcode.md §5).
 *  The snapshot is ~52 B/player-equivalent at 20 Hz, so this is a capacity
 *  law, not a bandwidth panic. */
export function chokeRates(players) {
  let total = 0;
  for (const connection of players.values()) total += connection.rate * RATE_BYTES;
  if (total <= CHOKE_CAP) return;
  const sorted = [...players.values()].sort((a, b) => b.rate - a.rate);
  let at = 0;
  while (total > CHOKE_CAP && at < sorted.length) {
    const c = sorted[at];
    if (c.rate <= SNAPSHOT_RATE_MIN) { at++; continue; }
    c.rate = Math.max(SNAPSHOT_RATE_MIN, c.rate - 5);
    total -= 5 * RATE_BYTES;
    if (at === sorted.length - 1) at = 0;    // another pass round the list
    else at++;
  }
}

export function sendSnapshots(players, nowMs, payload) {
  for (const connection of players.values()) {
    if (nowMs < connection.nextSendAt) continue;
    connection.peer.send(frame(MSG_SNAPSHOT, payload()));
    // The cadence is the connection's own rate; roll the phase instead of
    // snapping to now, so a lagging burst of frames does not ride one tick.
    connection.nextSendAt = nowMs + (1000 / connection.rate);
  }
}

/** The 20 Hz record (netcode.js's encodeSnapshot), built once per send —
 *  every connection at whatever rate ships the same bytes. `Room.
 *  snapshotPayload` is this, public because the core's join handshake sends
 *  it as MSG_JOIN_SNAPSHOT. */
export function snapshotRecord(room) {
  const world = room.world;
  const rows = new Map(world.playersSnapshot().map(r => [r.id, r]));
  const players = [];
  for (const [slot, connection] of room.players) {
    const row = rows.get(slot);
    if (!row) continue;
    let { x, y, z } = row;
    // A seated player whose seat has no drivetrain: the world's own
    // snapshot falls back to the soldier's (stale) pose; the room's live
    // root-matrix feed is the truth here.
    const wp = world.player(slot);
    if (row.seated && wp && !wp.vehicle && wp.position) {
      x = wp.position[0]; y = wp.position[1]; z = wp.position[2];
    }
    const entry = row.vehicleOwner != null
      ? room.instance.ownerToEntry.get(row.vehicleOwner) : null;
    players.push({
      slot,
      alive: row.alive, seated: row.seated,
      crouch: row.crouch, prone: row.prone, swim: row.swim ?? null,
      inVehicle: row.inVehicle,
      team: row.team, x, y, z,
      // DEGREES on the wire, which is what the record says it carries
      // (netcode.js) and what `netcode-render.js` converts back with its
      // own `rad()`. The World keeps the soldier's facing in radians, so
      // the conversion belongs here, at the wire's edge -- shipping the
      // radian value under a field documented as degrees drew every remote
      // soldier at a 57th of its real heading.
      yaw: degreesOf(row.yaw), pitch: degreesOf(row.pitch),
      hp: row.hp,
      vehicleId: entry ? entry.id : 0,
      seatIndex: row.seatIndex >= 0 ? Math.min(row.seatIndex, 15) : null,
      // The input acknowledgement: the highest seq this world has consumed
      // for the player (raised in `#tick`). The client reconciles against
      // the tick it names, so the input latency is not read as error.
      ack: connection.ack,
    });
  }
  const vehicles = [];
  for (const entry of room.instance.table) {
    const pose = world.vehiclePose(entry.owner);
    if (!pose) continue;
    vehicles.push({
      id: entry.id,
      occupied: entry.seated > 0,
      air: entry.kind === 'air',
      ground: entry.kind === 'ground',
      x: pose.x, y: pose.y, z: pose.z, q: pose.q,
    });
  }
  return encodeSnapshot(room.tick, players, vehicles);
}
