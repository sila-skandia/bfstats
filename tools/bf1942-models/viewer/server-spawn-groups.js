// The server's spawn groups on a sidecar page: each group's side, whether a
// human can spawn on it now, and where its ring is, as a retail client has
// them.
//
// A retail client computes none of this. The server's BFSpawnPointManager is
// a networkable (`sidecar/ghost/spawn-manager.mjs`): per group it sends the
// side, `BFSpawnGroup::getActive(false)` (the human's test through every
// point: a carrier critically damaged, a seat point with no free door within
// 5 m, SPAWN-5, SPAWN-25) and the ring's x and z quantised to a byte of the
// terrain. The client's own `getActive` (BF1942.exe 0x00484bc0) returns that
// byte, and its spawn map draws a dot, and lets a click select, only for a
// group of the player's side that passes it (`BfMap::update` 0x0046df22..,
// the pick at 0x004695d8; ledger SPAWNGRP-11). The sidecar hands the table on
// as an `e:'spawnGroups'` row; this holds it and answers per group id.
//
// The wire never names a group: entry i is the i-th lowest id of every group
// the server's map holds, those with points and those some script named and
// gave none (Midway's 1, 2 and 5 sit among its 3, 4 and the fleet's 64..83).
// The page knows only the groups its level data names, so `alignGroups` lines
// the entries up with them in order: a group with points must take an entry,
// an entry with a ring must be a group with points (one with none has no
// position and is never active), and where a known group's ring is known the
// entry nearest it is preferred. Entries that could be either a known group
// or an unnamed one carry no ring and are off whichever they are, which is
// all the page reads of them.
//
// Free of `three` and the DOM, so `tests/server_spawn_groups_harness.mjs`
// drives the same bytes the page loads.

/** Wire byte -> world metres, and back (`BFSpawnPointManager::updateStateMask`
 *  0x081683f0 / `setNetUpdate` 0x081687f0: q = round(v / width x 255), and v =
 *  width x q / 255; below 0 is 0, past the width 255). The page's z is the
 *  engine's negated. */
export function dequantise(q, width) {
  return (q / 255) * width;
}
export function quantise(v, width) {
  if (!(width > 0)) return 0;
  if (v > width) return 255;
  if (v < 0) return 0;
  return Math.round((v / width) * 255);
}

/** An entry with no ring and not active: a group with no live point, or one
 *  no point ever joined. */
function bare(entry) {
  return !entry[1] && !entry[2] && !entry[3];
}

/**
 * Line the wire's entries up with the groups the page knows.
 *
 * `entries` is the table, `[[team, active, qx, qz]]` by ordinal. `known` is
 * every group id the level data names, each `{ id, expect }`, `expect` the
 * ring's `[qx, qz]` where the page can say (null where it cannot). Returns a
 * Map id -> ordinal, or null when the page names more groups than the server
 * holds (a different mode's data: nothing is safe to read then).
 *
 * The cost of putting group j on entry i: the byte distance to its expected
 * ring (capped) when both have one; a little when the group has an expected
 * ring and the entry none (its points all down); nothing more otherwise. An
 * entry left to an unnamed group costs nothing when it is bare and is barred
 * when it has a ring. Ties go to leaving the earliest entries unnamed, where
 * a level's scripts put their pointless groups.
 */
export function alignGroups(entries, known) {
  const n = entries?.length ?? 0;
  const ids = [...new Map((known ?? []).filter(k => Number.isInteger(k?.id)).map(k => [k.id, k])).values()]
    .sort((a, b) => a.id - b.id);
  const k = ids.length;
  if (!n || !k || k > n) return null;
  const BAR = 1e6;
  const match = (i, j) => {
    const e = entries[i];
    const expect = ids[j].expect;
    if (bare(e)) return expect ? 1 : 0.5;
    if (!expect) return 2;
    return Math.min(Math.hypot(e[2] - expect[0], e[3] - expect[1]), 40) / 4;
  };
  const skip = i => (bare(entries[i]) ? i * 1e-6 : BAR);
  // cost[i][j]: the first i entries carry the first j known groups.
  const cost = Array.from({ length: n + 1 }, () => new Float64Array(k + 1).fill(Infinity));
  const took = Array.from({ length: n + 1 }, () => new Uint8Array(k + 1));
  cost[0][0] = 0;
  for (let i = 1; i <= n; i++) {
    for (let j = 0; j <= Math.min(i, k); j++) {
      let best = cost[i - 1][j] + skip(i - 1);
      let how = 0;
      if (j > 0) {
        const m = cost[i - 1][j - 1] + match(i - 1, j - 1);
        if (m < best) { best = m; how = 1; }
      }
      cost[i][j] = best;
      took[i][j] = how;
    }
  }
  if (!(cost[n][k] < BAR)) return null;
  const out = new Map();
  for (let i = n, j = k; i > 0; i--) {
    if (took[i][j]) { out.set(ids[j - 1].id, i - 1); j--; }
  }
  return out;
}

/**
 * The table and its answers. `known()` returns the level's groups for
 * `alignGroups` (asked again on every table, since a carried group's ring
 * moves with its ship); `width()` the terrain's width in metres.
 */
export function createServerSpawnGroups({ known = () => [], width = () => 0 } = {}) {
  let entries = null;
  let order = null;
  const state = {
    /** Whether the server's table has arrived: until it has, the page's own
     *  view of every group stands. */
    get live() { return !!(entries && order); },
    get entries() { return entries; },
    get order() { return order; },
    /** An `e:'spawnGroups'` row. */
    apply(row) {
      if (!Array.isArray(row?.g)) return false;
      entries = row.g.map(e => [e[0] | 0, e[1] ? 1 : 0, e[2] | 0, e[3] | 0]);
      order = alignGroups(entries, known());
      return true;
    },
    /** Line the table up again: the level's data may have landed after the
     *  row did (a page joining mid-round reads the snapshot first). */
    realign() {
      if (entries) order = alignGroups(entries, known());
      return !!order;
    },
    /** A level change: the old table is the old level's. */
    clear() { entries = null; order = null; },
    entry(group) {
      const i = order?.get(group);
      return i == null ? null : entries[i];
    },
    /** Whether a human can spawn on `group` now, or null when the table does
     *  not say. */
    active(group) {
      const e = state.entry(group);
      return e ? !!e[1] : null;
    },
    team(group) {
      const e = state.entry(group);
      return e ? e[0] : null;
    },
    /** The ring, `[x, z]` in the page's frame, or null when the server has
     *  none (every point down, the engine's (0,0,0)). */
    ring(group) {
      const e = state.entry(group);
      if (!e || (!e[2] && !e[3])) return null;
      const w = width();
      if (!(w > 0)) return null;
      return [dequantise(e[2], w), -dequantise(e[3], w)];
    },
  };
  return state;
}

/**
 * The groups a level's data names, for `alignGroups`: every soldier spawn's,
 * every carried point's and every control point's two, each with the average
 * of its points as the ring the server would send (the carried ones where
 * they stand now). `width` is the terrain's.
 */
export function knownGroups(extras, width) {
  const points = new Map();
  const add = (group, position) => {
    if (!Number.isInteger(group) || group < 0) return;
    if (!points.has(group)) points.set(group, []);
    if (Array.isArray(position)) points.get(group).push(position);
  };
  for (const p of extras?.soldierSpawns ?? []) add(p?.group, p?.position);
  for (const p of extras?.vehicleSoldierSpawns ?? []) add(p?.group, p?.position);
  for (const c of extras?.controlPoints ?? []) {
    add(c?.spawnGroupId, null);
    add(c?.secondSpawnGroupId, null);
  }
  return [...points].map(([id, list]) => {
    if (!list.length || !(width > 0)) return { id, expect: null };
    const x = list.reduce((s, p) => s + p[0], 0) / list.length;
    const z = list.reduce((s, p) => s + p[2], 0) / list.length;
    return { id, expect: [quantise(x, width), quantise(-z, width)] };
  });
}
