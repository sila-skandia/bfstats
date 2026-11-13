// A room's outbound stream: the R-1 choke over its connections' rates, each
// connection's own snapshot cadence, and the 20 Hz record itself
// (netcode.js's encodeSnapshot) with the wire-edge conversions. Split out of
// `rooms.mjs`'s Room, whose `#choke`, `#broadcastSnapshots` and
// `snapshotPayload` call these.

import { MSG_SNAPSHOT, encodeSnapshot } from '../viewer/netcode.js';
import {
  CHOKE_BUDGET_MIN, CHOKE_CAP, CHOKE_RATE_STEP, RATE_BYTES, SNAPSHOT_RATE_MIN,
} from './room-rules.mjs';
import { frame } from './room-wire.mjs';

/** The flight a knockback family is in, for the wire (`FLIGHT_WIRE`). */
function flightOf(family) {
  if (family === 'flyForward' || family === 'bounceFront') return 'flyForward';
  if (family === 'flyBackward' || family === 'bounceBack') return 'flyBackward';
  return null;
}

/** Radians (the World's facing) to the degrees the snapshot record carries.
 *  NaN travels as NaN -- a seated player's facing is the hull's. */
function degreesOf(radians) {
  return Number.isFinite(radians) ? radians * 180 / Math.PI : NaN;
}

/**
 * R-1, `GameServer::chokeBandwidth` (lnxded 0x08132cc0), one pass:
 *
 *   * a cap of 0 is no choke at all (0x08132cd7), and that is the engine's
 *     and the shipped default (`CHOKE_CAP`);
 *   * nothing happens while Σ(rate × budget) is at or under the cap
 *     (0x08132d09);
 *   * otherwise every connection gets an equal share, cap / connections
 *     (`divl 0x104(%edi)` at 0x08132d15, integer). One whose rate × budget is
 *     over its share has its budget cut to share / rate (truncated) while that
 *     stays above 260 bytes (0x08132da5); when it would fall to 260 or under,
 *     its rate drops by 5 instead, never under 10 (0x08132db0..0x08132dc9),
 *     and its budget is left as it was. A connection already at 10 is left.
 *
 * Mutates each connection's `rate` and `budget` (bytes per update, defaulting
 * to RATE_BYTES). Returns the connections whose rate changed, the ones retail
 * tells with an event (0x08132df2). `cap` defaults to the room's CHOKE_CAP.
 */
export function chokeRates(players, cap = CHOKE_CAP) {
  if (!(cap > 0)) return [];
  const connections = [...players.values()];
  for (const c of connections) if (!Number.isFinite(c.budget)) c.budget = RATE_BYTES;
  let total = 0;
  for (const c of connections) total += Math.trunc(c.rate * c.budget);
  if (total <= cap || !connections.length) return [];
  const share = Math.floor(cap / connections.length);
  const changed = [];
  for (const c of connections) {
    if (!(share < c.budget * c.rate)) continue;
    const budget = Math.trunc(share / c.rate);
    if (budget > CHOKE_BUDGET_MIN) { c.budget = budget; continue; }
    if (c.rate <= SNAPSHOT_RATE_MIN) continue;
    c.rate = Math.max(SNAPSHOT_RATE_MIN, c.rate - CHOKE_RATE_STEP);
    changed.push(c);
  }
  return changed;
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

/** A player row's lower state for the wire: standing, the walking body's
 *  own machine (`SoldierJumpState`); crouched or lying, only whether it
 *  moves backward (the forward ramp's sign). Null seated, swimming or dead. */
function lowerOf(row, body, soldier = null) {
  if (!body || !row.alive || row.seated || row.inVehicle || row.swim) return null;
  if (soldier?.climb?.active) return 'climb';
  if (!row.crouch && !row.prone) return body.lowerBody?.state ?? null;
  return body.forwardRamp < 0 ? 'backward' : null;
}

/** The 20 Hz record (netcode.js's encodeSnapshot), built once per send —
 *  every connection at whatever rate ships the same bytes. `Room.
 *  snapshotPayload` is this, public because the core's join handshake sends
 *  it as MSG_JOIN_SNAPSHOT. */
export function snapshotRecord(room) {
  const world = room.world;
  const rows = new Map(world.playersSnapshot().map(r => [r.id, r]));
  const players = [];
  // Every player of the room: the humans' connections, then the bots, which
  // have a slot and no connection (`room-bots.mjs`).
  const roster = room.bots?.count
    ? [...room.players, ...[...room.bots.slots.keys()].map(slot => [slot, null])] : room.players;
  for (const [slot, connection] of roster) {
    const row = rows.get(slot);
    if (!row) continue;
    let { x, y, z } = row;
    const wp = world.player(slot);
    // A seated player whose seat has no drivetrain: the world's own
    // snapshot falls back to the soldier's (stale) pose; the room's live
    // root-matrix feed is the truth here.
    if (row.seated && wp && !wp.vehicle && wp.position) {
      x = wp.position[0]; y = wp.position[1]; z = wp.position[2];
    }
    const entry = row.vehicleOwner != null
      ? room.instance.ownerToEntry.get(row.vehicleOwner) : null;
    players.push({
      slot,
      alive: row.alive, seated: row.seated,
      crouch: row.crouch, prone: row.prone, swim: row.swim ?? null,
      // A blast's flight (`room-hits.mjs` throws him; `knockback.js` flies
      // him): a bounce rides the flight it hands back to.
      flight: flightOf(wp?.soldier?.body?.knockback?.family),
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
      // The lower machine's state his walking body ran this tick
      // (`netcode.js` `LOWER_WIRE`): the jumps, the backward run, the turns.
      lower: lowerOf(row, wp?.soldier?.body, wp?.soldier),
      // The input acknowledgement: the highest seq this world has consumed
      // for the player (raised in `#tick`). The client reconciles against
      // the tick it names, so the input latency is not read as error.
      ack: connection?.ack ?? 0,
    });
  }
  const vehicles = [];
  for (const entry of room.instance.table) {
    // A hull out of the world (a pad's other side, a cleared wreck) has no
    // pose to send (`room-pads.mjs`).
    if (entry.live === false) continue;
    // A ship at rest is scenery the body world does not hold: her node's own
    // pose (`room-ships.mjs`), where the world would answer her pad's.
    const pose = room.instance.ships?.poseOf(entry) ?? world.vehiclePose(entry.owner);
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
