// The spawn screen's "TIME TO SPAWN: N" countdown, in authority mode.
//
// Grounded in the lnxded RE (features/server-authoritative-multiplayer/README.md,
// "the spawn model"): spawning is WAVE-based. `dice::bf::GameServer` carries
// `serverSpawnTime` (the wave period, lab + vanilla default 15 s) and
// `serverSpawnDelay` (the minimum wait after death, default 5 s). A dead player
// becomes eligible `serverSpawnDelay` after death and is then stood up by
// `reSpawnPlayer` on the next GLOBAL wave boundary -- the waves are a grid on
// the server's own clock, shared by everyone, which is why two players who die
// seconds apart spawn together. The retail client counts down to that boundary.
//
// The server does NOT send the wave timing in any decoded in-game event
// (`GameRules` 0x16 carries no spawn timing; `GameStatus` 0x24 status-5 is the
// restart message), so the number here is computed the way the client's own is:
// from the wave params (config, defaulted to vanilla) and the running server
// clock (the sidecar's `clock`, `net-sidecar.js`). The actual spawn stays
// server-authoritative (`spawning.js` `askServerSpawn`/`standServerSpawn`); this
// only paints the wait, so a wave period that differs from a non-default server
// mistimes the DISPLAY, never the spawn itself.

/** Vanilla / lab defaults (ServerSettings.con `game.serverSpawnTime`/`Delay`). */
export const DEFAULT_SPAWN_TIME = 15;
export const DEFAULT_SPAWN_DELAY = 5;

/**
 * Whole seconds until this player may spawn, or 0 when a wave is due now.
 *
 *   now        the server clock now (the sidecar's `clock`, seconds)
 *   diedAt     the server clock at death (same units); null before any death
 *   spawnTime  the wave period; <= 0 means no waves (the flat delay alone)
 *   spawnDelay the minimum wait after death
 *
 * Returns null when there is nothing to count (no death recorded, or a clock
 * that has not started), so the caller can leave the line blank rather than
 * paint a spurious 0.
 */
export function timeToSpawn(now, diedAt, { spawnTime = DEFAULT_SPAWN_TIME, spawnDelay = DEFAULT_SPAWN_DELAY } = {}) {
  if (!Number.isFinite(now) || !Number.isFinite(diedAt)) return null;
  const eligibleAt = diedAt + Math.max(0, spawnDelay);
  // Without waves the countdown is the flat delay from death.
  if (!(spawnTime > 0)) return Math.max(0, Math.ceil(eligibleAt - now));
  // With waves: the first grid boundary at or after eligibility. The grid is on
  // the server clock (boundaries at k * spawnTime), so a player already past a
  // boundary waits for the next one -- never spawns "half a wave" early.
  const nextWave = Math.ceil(eligibleAt / spawnTime) * spawnTime;
  return Math.max(0, Math.ceil(nextWave - now));
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
