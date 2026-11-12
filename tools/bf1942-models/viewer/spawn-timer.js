// The spawn screen's "TIME TO SPAWN: N" countdown, in authority mode.
//
// The server's own number wins: the relay sends the player's wait
// (`BFPlayer +0x8c`, decoded as `sw`, features/server-authoritative-multiplayer
// /README.md) and `net-room.js` paints it through `deployCountdownLine` with
// `spawnTime 0`. This file's wave arithmetic is the FALLBACK for a relay that
// does not send it, and it reproduces the server's own law (lnxded, read
// 2026-11-12, findings modes-spawns-supply F3 / netcode-replay F7):
//
//   - `Setup::initServerSettings` defaults `game.serverSpawnTime` to 20
//     (0x080c09e6) and `game.serverSpawnDelay` to 3 (0x080c09ed); the shipped
//     and the lab's `serversettings.con` say the same 20 / 3.
//   - `GameServer` keeps the time between waves (`+0x214`, from
//     `serverSpawnTime`), the spawn window (`+0x210`, `setSpawnWaveTime`
//     0x0813d780, 5.0 from `GameServer::init` 0x08131d7f/0x08131d89) and two
//     running clocks: `+0x208` to the next window and `+0x20c` left of the
//     open one. `resetTimers` (0x08157790) sets `+0x208 = 0`, `+0x20c = the
//     window`, so a round opens on a window; `gameStatusPlaying` (0x08152806)
//     runs `+0x208` to 0, then the window, then re-arms both (0x08152845). So
//     windows open every `serverSpawnTime + window` seconds from the round's
//     start, each `window` long.
//   - `killPlayer` (0x0814d920) with waves on (`+0x201`, 0x0814db80) sets the
//     wait: the time to the next window when that is MORE than the window's
//     length (0x0814dee8..0x0814defb), else that plus the rest of the open
//     window plus the time between waves (0x0814df01..0x0814df13), i.e. the
//     window after next; clamped 0..127 (127.0 at 0x086c0300). A team-kill
//     penalty adds whole cycles (not modelled). `serverSpawnDelay`
//     (`+0x204`) is read only with waves off (0x0814db90): the flat wait.
//
// The fallback's clock is the relay's `clock` (`net-relay.js`); that it starts
// at the round's `resetTimers` is this file's assumption, so a fallback number
// can be out of phase with a server whose clock does not. On a relay it only paints the
// wait, never gates the spawn (`spawning.js` `askServerSpawn`).

/** `game.serverSpawnTime` / `game.serverSpawnDelay` defaults (0x080c09e6,
 *  0x080c09ed; the shipped and lab `serversettings.con` agree). */
export const DEFAULT_SPAWN_TIME = 20;
export const DEFAULT_SPAWN_DELAY = 3;
/** The spawn window, `GameServer +0x210` (`GameServer::init` 5.0). */
export const DEFAULT_SPAWN_WINDOW = 5;
/** The wait's clamp in `killPlayer` (0x086c0300). */
export const MAX_SPAWN_WAIT = 127;

/**
 * The wait `killPlayer` gives a player who dies at `diedAt` on the server's
 * round clock: seconds from death until a spawn window has them.
 */
export function spawnWait(diedAt, { spawnTime = DEFAULT_SPAWN_TIME, spawnDelay = DEFAULT_SPAWN_DELAY,
  spawnWindow = DEFAULT_SPAWN_WINDOW } = {}) {
  const clamp = v => Math.min(MAX_SPAWN_WAIT, Math.max(0, v));
  if (!(spawnTime > 0)) return clamp(spawnDelay);
  const window = Math.max(0, spawnWindow);
  const cycle = spawnTime + window;
  const phase = ((diedAt % cycle) + cycle) % cycle;
  // Inside an open window: `+0x208` is 0, so the wait is the window's rest
  // plus the time between waves, the next window's start.
  if (phase < window) return clamp(cycle - phase);
  const toWindow = cycle - phase;               // `+0x208`
  return clamp(toWindow > window ? toWindow : toWindow + cycle);
}

/**
 * The wave law as a gate, for every path that stands a body up off a retail
 * server: the page's own player in solo play and Instant Battle
 * (`spawning.js`), the bots on the page and in the headless runner
 * (`bot-referee.js` `respawnTick`), and a room's players
 * (`server/authority.mjs`). Retail runs it for every BFPlayer, bots included
 * (SPAWN-35): `killPlayer` 0x0814d920 sets the wait with no AI test, and
 * `gameStatusPlaying` spawns any dead player who has a group once the wait
 * (`BFPlayer+0x8c`) is spent (0x08152917..0x08152987). When a window
 * closes, a dead player whose wait is spent but who has not spawned (no
 * group, nowhere to stand) is re-armed to the next window (`+0x8c = +0x214`,
 * 0x0815288c..0x081528ab).
 *
 *   readyAt  the round clock when this player's wait is spent:
 *            `spawnReadyAt(diedAt)` after a death
 *   now      the round clock (`round-state.js` `clock`, which starts at the
 *            round's `resetTimers` and goes back to 0 on a restart)
 *
 * Returns the seconds still to wait, 0 when the player may spawn now.
 */
export function spawnReadyAt(diedAt, params = {}) {
  return diedAt + spawnWait(diedAt, params);
}

export function waveSecondsLeft(now, readyAt, { spawnTime = DEFAULT_SPAWN_TIME, spawnDelay = DEFAULT_SPAWN_DELAY,
  spawnWindow = DEFAULT_SPAWN_WINDOW } = {}) {
  if (!Number.isFinite(now) || !Number.isFinite(readyAt)) return 0;
  if (now < readyAt) return readyAt - now;
  if (!(spawnTime > 0)) return 0;        // waves off: the flat wait, then any time
  const window = Math.max(0, spawnWindow);
  const cycle = spawnTime + window;
  // The window the wait ended in (or the next one, for a wait that ended
  // between windows) closes at `close`; until then a spent wait spawns.
  const close = Math.floor(readyAt / cycle) * cycle + window;
  const firstClose = close > readyAt ? close : close + cycle;
  if (now < firstClose) return 0;
  // Re-armed at that close: only an open window spawns from here on.
  const phase = ((now % cycle) + cycle) % cycle;
  return phase < window ? 0 : cycle - phase;
}

/**
 * Whole seconds until this player may spawn, or 0 when a window has them now.
 *
 *   now        the server clock now (the relay's `clock`, seconds)
 *   diedAt     the server clock at death (same units); null before any death
 *   spawnTime  the time between waves; <= 0 means no waves (the flat delay)
 *   spawnDelay the flat wait, read only with waves off
 *   spawnWindow the spawn window (5)
 *
 * Returns null when there is nothing to count (no death recorded, or a clock
 * that has not started), so the caller can leave the line blank rather than
 * paint a spurious 0.
 */
export function timeToSpawn(now, diedAt, params = {}) {
  if (!Number.isFinite(now) || !Number.isFinite(diedAt)) return null;
  return Math.max(0, Math.ceil(diedAt + spawnWait(diedAt, params) - now));
}

/**
 * The deploy line the countdown paints. `prompt` is the "select a spawn point"
 * line the retail screen shows beside the number; it stands alone before a
 * death (when there is no countdown yet) so a fresh join still gets the hint.
 * Returns `{ countdown, prompt, text }`: `countdown` the number or null, `text`
 * the full line ("TIME TO SPAWN: 7" / "SELECT A SPAWN POINT").
 */
export function deployCountdownLine(now, diedAt, params = {}, strings = null) {
  const n = timeToSpawn(now, diedAt, params);
  const label = strings?.TIME_TO_SPAWN ?? 'TIME TO SPAWN';
  const prompt = strings?.SELECT_SPAWN_POINT ?? 'SELECT A SPAWN POINT';
  if (n == null) return { countdown: null, prompt, text: prompt };
  return { countdown: n, prompt, text: n > 0 ? `${label}: ${n}` : prompt };
}

/**
 * The respawn plate's label (`TimerText`) over the same wait: the client
 * picks `TIME_TO_START` while the game status is 3, the pre-game, and
 * `TIME_TO_SPAWN` otherwise, and draws the player's `+0xc0` under either
 * (BF1942.exe `FUN_006ad0a0` 0x006adbeb..0x006adc2d; ledger HUD-23).
 */
export function respawnPlateLabel(strings, preGame = false) {
  return preGame
    ? (strings?.TIME_TO_START ?? 'TIME UNTIL GAME STARTS:')
    : (strings?.TIME_TO_SPAWN ?? 'TIME TO SPAWN:');
}
