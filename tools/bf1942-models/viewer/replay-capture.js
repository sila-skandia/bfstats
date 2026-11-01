// A control point's capture progress in a replay, from the server's own
// timers (features/capture-progress-rings, features/replay-feature-sweep-
// 2026-11-01 entry 7). The ring it feeds is the page's own addition: retail
// draws no ring for a control point (HUD-15, OBJ-7).
//
// The server recorder writes a point's capture law as the server runs it
// (`cpt` records, `replay-recording.js` -> `point.timers`): the state at
// ControlPoint+0x17c, the getting team +0x170 and the get and lose timers
// +0x16c / +0x168 (AI-100), which no client is sent (NET-16). A client's
// file has none of it; there the rings stay the estimate over the
// recording's positions (capture-rings.js `createCaptureEstimate`).
//
// Pure, a function of the recording and the clock, so node tests it
// (tests/test_replay_capture.py).

/** The row of `point.timers` in force at `t`, the timers carried on
 *  between two rows of one run (the same state and getting team), as the
 *  server's run them down at one second a second; the recorder writes a
 *  running timer at most every quarter second. Null before the first row. */
export function timersAt(point, t) {
  const rows = point?.timers;
  if (!rows?.length || !(t >= rows[0].t)) return null;
  let lo = 0, hi = rows.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (rows[mid].t <= t) lo = mid; else hi = mid - 1;
  }
  const r = rows[lo], n = rows[lo + 1];
  if (!n || n.state !== r.state || n.by !== r.by || !(n.t > r.t)) return r;
  const k = (t - r.t) / (n.t - r.t);
  return { t, state: r.state, by: r.by, get: r.get + (n.get - r.get) * k, lose: r.lose + (n.lose - r.lose) * k };
}

/** The point's team at `t` from its `cp` changes, 0 before the first. */
export function ownerAt(point, t) {
  let team = 0;
  for (const c of point?.changes ?? []) {
    if (c.t > t) break;
    team = c.team;
  }
  return team > 0 ? team : 0;
}

const clamp01 = v => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/**
 * The ring the server's timers show at `t`, or null when nothing moves:
 * `{ kind, team, fraction }` as capture-rings.js `captureProgress` answers
 * the law's own state. State 3 with a getting team is being taken (fills
 * `1 - get / timeToGet` in the taker's colour); state 2 on an owned point is
 * being run down (drains `lose / timeToLose` in the holder's). State 1 after
 * `lostControl` leaves the point neutral, and state 4 is held: no ring.
 * `full` gives the template's times where the file did not (the level's
 * `timeToGetControl` / `timeToLoseControl`).
 */
export function captureProgressAt(point, t, full = {}) {
  const r = timersAt(point, t);
  if (!r) return null;
  if (r.state === 3 && r.by > 0) {
    const all = Number(point.timeToGet ?? full.timeToGet);
    return { kind: 'getting', team: r.by, fraction: all > 0 ? clamp01(1 - r.get / all) : 1 };
  }
  const owner = ownerAt(point, t);
  if (r.state === 2 && owner) {
    const all = Number(point.timeToLose ?? full.timeToLose);
    return { kind: 'losing', team: owner, fraction: all > 0 ? clamp01(r.lose / all) : 0 };
  }
  return null;
}
