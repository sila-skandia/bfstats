// The room server's core: the transport-agnostic half of the P2 netcode.
//
// One Room per join code: a World (P1) stepped at the engine's 30 Hz by a
// fixed-step accumulator driven from the monotonic wall clock, input fed
// through `World.setInput(id, input, look, seq)` so the World's own receive
// law does the enforcing (trim <= 4 drop-oldest, exactly one consume per
// tick, zeroed idle word on an empty buffer, seq dedupe on `seq > lastSeen`,
// backlog > 9 collapses), one 20 Hz snapshot stream per connection under the
// R-1 choke, and the control channel's seat/spawn actions mirrored on the
// world. Everything here talks to abstract `{send(bytes), close()}` peers —
// `server.mjs` adapts the WebSocket, the harnesses drive the same core with
// in-memory peers, which is what keeps the protocol law in one place and the
// tests off the network.
//
// Laws pinned here, with the ledger in `features/bf1942-engine-reference/
// subsystems/netcode.md`:
//   LOOP/D-*  the receive law — enforced by World.setInput, fed verbatim
//   J-1/J-3   the control channel: seat enter/exit/switch and spawn arrive
//             as action rows, not as PlayerActions; 0xd is the explicit
//             MSG_LEAVE and its drop twin is the silent-10 s sweep
//   P-2       snapshots at 20 Hz (default), each connection its own rate
//   R-1       Σ(rate × 1044) ≤ cap; offenders lose 5, never below 10 —
//             the engine's own cap value was not recovered in P0, so the
//             cap is a documented P2 choice (see server/README.md)
//
// Divergences, all documented: one drive model per hull at a time (the
// World's #vehicleTick integrates player.vehicle once per seated player), a
// bare seat's snapshot pose comes from the root's live world matrix via the
// player.position feed, and fire events are throttled to ~0.35 s per player
// (map.html's 1/0.35 SMG cadence) pending P3's real GunFire rounds.
//
// Where each piece lives (this module re-exports every name it exported, so
// importers keep their `./rooms.mjs` path):
//   room-registry.mjs  RoomServerCore: the registry, routing, the join handshake
//   room.mjs           Room: join/leave/sweep, the 30 Hz loop, event rows
//   room-control.mjs   the control channel's seat/spawn actions
//   room-stream.mjs    the R-1 choke and the per-connection snapshot stream
//   room-rules.mjs     the code/name shapes, the choke/heartbeat/fire limits,
//                      the peer contract
//   room-wire.mjs      frame, encodeJsonMsg, eventRow, parseJson

export {
  ROOM_CODE_RE, NAME_MAX,
  RATE_BYTES, SNAPSHOT_RATE_DEFAULT, SNAPSHOT_RATE_MIN, CHOKE_CAP,
  HEARTBEAT_TIMEOUT_MS, DROP_SWEEP_MS, FIRE_EVENT_COOLDOWN_S, SPAWN_INDEX_MAX,
  RADIO_LOCAL_RANGE,
  isPeer,
} from './room-rules.mjs';
export { Room } from './room.mjs';
export { RoomServerCore } from './room-registry.mjs';
export { frame, encodeJsonMsg, eventRow, parseJson } from './room-wire.mjs';
