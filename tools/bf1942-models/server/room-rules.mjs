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

/** The R-1 choke's shape. A connection starts at rate 20 (`conn+0xc`) with a
 *  byte budget of 1400 per update (`conn+0x10` = 0x578, ClientConnection ctor
 *  lnxded 0x081142ce; J-1, R-1). */
export const RATE_BYTES = 1400;
export const SNAPSHOT_RATE_DEFAULT = 20;
export const SNAPSHOT_RATE_MIN = 10;
/** The cap `game.serverBandwidthChokeLimit` sets (`GameServer+0x46c`): 0 in
 *  the GameServer ctor (lnxded 0x0812f261), in `Setup::initServerSettings`
 *  (0x080c0a37) and in the shipped serversettings.con, and 0 turns the choke
 *  off (`chokeBandwidth` 0x08132cd7). The room runs the engine's default. */
export const CHOKE_CAP = 0;
/** A connection whose fair share would leave it this many bytes per update
 *  or fewer loses rate instead of budget (`cmpl $0x104` at 0x08132da5). */
export const CHOKE_BUDGET_MIN = 260;
/** The rate step and the period the server re-runs the choke at: every
 *  connection's timer sync, 10 s (`updateConnections` 0x08139402 re-arms
 *  `nextTimerSync` to 10.0 and calls `chokeBandwidth` at 0x0813940c), and at
 *  each join (`processReceivedPackets` 0x08138560). */
export const CHOKE_RATE_STEP = 5;
export const CHOKE_PERIOD_MS = 10_000;

/** A server frame owing more than this many ticks runs ONE, and the rest are
 *  lost to its tick clock for good (`GameServer::update` lnxded 0x08132955:
 *  `cmp $0x9,%ebx; jle`, else n - 1 added to +0x4f8 and n = 1; D-4, P-10).
 *  The room server's loop only: the page's FixedStep keeps its own 12. */
export const STALL_COLLAPSE_TICKS = 9;

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

/** A reload row's weapon: a template name's shape (letters, digits, `_`,
 *  `-`, `.`), at most 64 long. */
export const WEAPON_NAME_OK = /^[A-Za-z0-9_.-]{1,64}$/;

/** The least time between two relayed magazine changes from one player: the
 *  shortest non-zero `reloadTime` any tree ships is 0.1 s (the first-person
 *  reports under `viewer/models/viewmodels`, every mod), so a faster pair is
 *  a page repeating itself, not a second change. */
export const RELOAD_GAP_MS = 100;

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
