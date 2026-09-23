// The room's rules and limits: the join code and name shapes, the R-1 choke's
// constants, the heartbeat and sweep, the fire-event throttle, the room
// clock's frame cadence, the peer contract and the slot pick. Split out of
// `rooms.mjs`, which re-exports every name it exported before.

import { MAX_PLAYERS, ROOM_CODE_RE } from '../viewer/netcode.js';
import { WORLD_TICK_DT } from '../viewer/world.js';

/** A join code's shape: netcode.js's, which the page's MULTIPLAY screen
 *  types its SERVER NAME field against too. */
export { ROOM_CODE_RE };
export const NAME_MAX = 24;
export const NAME_OK = /^[^\x00-\x1f\x7f]{1,24}$/;

/** The R-1 choke's shape: conn+0x10 = 1044 byte-budget per rate unit... */
export const RATE_BYTES = 1044;
export const SNAPSHOT_RATE_DEFAULT = 20;
export const SNAPSHOT_RATE_MIN = 10;
/** ... and the capacity law the room server honors. 1044 x 16 x 20 — every
 *  player at the default rate — is the P2 choice for the engine's own value
 *  (not recovered in P0; see server/README.md §decisions). */
export const CHOKE_CAP = RATE_BYTES * MAX_PLAYERS * SNAPSHOT_RATE_DEFAULT;

/** Silent connections are dropped — the peer's 0xd-equivalent (J-3). */
/** A connection the server heard nothing from for this long is gone. The
 *  page pings every 4 s, so 25 s tolerates a paused main thread without
 *  drifting into the engine's 30 s keepalive period — and the pause is
 *  real: a joining page parses the level's scene.glb in one synchronous
 *  chunk while its own timers cannot run (observed >15 s under software
 *  GL, where every documented silent-timeout trace landed). */
export const HEARTBEAT_TIMEOUT_MS = 25_000;
export const DROP_SWEEP_MS = 1_000;

/** Fire-event throttle: map.html's 1/0.35 s SMG cadence. P3's GunFire rounds
 *  will own the real cadence; this is the room's event copy. */
export const FIRE_EVENT_COOLDOWN_S = 0.35;

/** A deploy row's `spawnIndex` is a walk over one flag's spawn points, and
 *  `pickSpawn` wraps it; this only keeps a hostile row from arriving with
 *  something that would cost a modulo over a huge number. */
export const SPAWN_INDEX_MAX = 0xffff;

/** How far a shouted radio message carries: the 70.0 in
 *  `GameServer::radioMessage` (lnxded 0x0813a120). */
export const RADIO_LOCAL_RANGE = 70;

/** The room clock's own frame cadence (33.33 ms); the FixedStep interior
 *  means the cadence is a target, not a law. */
export const FRAME_MS = Math.max(1, Math.round(WORLD_TICK_DT * 1000));

/**
 * The `{send, close}` peer contract one adapter must meet (documented in
 * server/README.md; server.mjs's socket adapter is the reference).
 * `send` takes the whole frame (type byte + payload) as Uint8Array.
 */
export function isPeer(peer) {
  return peer && typeof peer.send === 'function' && typeof peer.close === 'function';
}

export function nextFreeSlot(players) {
  for (let slot = 1; slot <= MAX_PLAYERS; slot++) {
    if (!players.has(slot)) return slot;
  }
  return null;
}

export function error(code) { return { ok: false, code }; }
