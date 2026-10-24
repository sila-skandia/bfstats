// Another soldier's rounds on a sidecar page, one for each round the server
// fired, on the server's own line (wire.md section 44, "The line a remote's
// round is drawn on").
//
// A server sends a client no shot. The sidecar reads each of a soldier's
// rounds off his ghost (ghost-writer.mjs `_handFire`: his recoil counter, or
// his fire state for a weapon with none) and writes a `k:"f"` row with the
// server's launch point `p` (his eye for his pose) and its direction `d`,
// timed to the round's own tick. `net-sidecar.js` hands it to the page as a
// `handRound` row, `at` in the clock the samples are timed in.
//
// The page draws the remotes on its own clock (`drawnTime`, wire.md section
// 38): normally a little past the newest sample, so a round is already due
// when its row arrives, and under the old lookback law 100 ms behind it, when
// it waits. Either way the round is laid where the shooter is drawn when it
// goes: the server's launch point moved by however far the drawn shooter has
// moved since the round's moment, so a running man's round leaves him and
// not the spot he was at a few ticks back. A still shooter's round leaves
// from `p` exactly.
//
// Pure (no three): `net-room.js` draws what `due` returns, the flash, the
// round and the report together.

/** Longest a round waits for the drawn clock, seconds: past it the row is
 *  stale or the clock is wrong, and the round goes now. */
export const HAND_ROUND_MAX_WAIT_S = 0.5;
/** A shooter drawn further than this from where he stood at the round has
 *  been put somewhere else (a respawn, a scope change), not moved: the round
 *  keeps the server's point. */
export const HAND_ROUND_MAX_SHIFT_M = 3;

/** BF1942's frame to the page's: z negated (the replay's `recordedLaunch`). */
function pageVec(v) {
  return Array.isArray(v) && v.length >= 3 && v.every(Number.isFinite) ? { x: v[0], y: v[1], z: -v[2] } : null;
}

/**
 * ctx: {
 *   drawnTime(nowMs) -> server seconds the remotes are drawn for, or null;
 *   playerAt(slot, nowMs) -> the drawn row (`remotePlayer`);
 *   playerAtTime(slot, t) -> his row at server time t (`remotePlayerAtTime`);
 * }
 * Returns { push(row, nowMs), due(nowMs) -> [{ slot, nid, origin, dir, shooter, shift, late, row }],
 *           pending() }.
 * `origin` and `dir` are in the page's frame; either is null when the row
 * carried none, and the caller falls back on the shooter's eye and view.
 */
export function createHandRounds(ctx, { maxWait = HAND_ROUND_MAX_WAIT_S, maxShift = HAND_ROUND_MAX_SHIFT_M } = {}) {
  const queue = [];

  function push(row, nowMs) {
    if (!row || row.slot == null) return;
    queue.push({ row, came: nowMs });
  }

  function lay(row, nowMs) {
    const shooter = ctx.playerAt(row.slot, nowMs);
    let origin = pageVec(row.pos);
    const d = pageVec(row.dir);
    let dir = null;
    if (d) {
      const n = Math.hypot(d.x, d.y, d.z);
      if (n > 0.1) dir = { x: d.x / n, y: d.y / n, z: d.z / n };
    }
    let shift = 0;
    if (origin && shooter?.alive && !shooter.inVehicle && Number.isFinite(row.at)) {
      const then = ctx.playerAtTime?.(row.slot, row.at);
      if (then?.alive && !then.inVehicle) {
        const dx = shooter.x - then.x, dy = shooter.y - then.y, dz = shooter.z - then.z;
        shift = Math.hypot(dx, dy, dz);
        if (shift < maxShift) origin = { x: origin.x + dx, y: origin.y + dy, z: origin.z + dz };
      }
    }
    return { slot: row.slot, nid: row.nid ?? null, origin, dir, shooter, shift, row };
  }

  function due(nowMs) {
    if (!queue.length) return [];
    const drawn = ctx.drawnTime?.(nowMs);
    const out = [];
    for (let i = 0; i < queue.length;) {
      const { row, came } = queue[i];
      const wait = Number.isFinite(drawn) && Number.isFinite(row.at) ? row.at - drawn : 0;
      if (wait > 0 && wait <= maxWait && nowMs - came < maxWait * 1000) { i++; continue; }
      queue.splice(i, 1);
      const shot = lay(row, nowMs);
      // How far the drawn clock had passed the round when it went, seconds.
      shot.late = Number.isFinite(drawn) && Number.isFinite(row.at) ? drawn - row.at : null;
      out.push(shot);
    }
    return out;
  }

  return { push, due, pending: () => queue.length, clear: () => { queue.length = 0; } };
}
