// Who healed and repaired whom in a round: the board's SUPPORT view, from a
// server recording's `heal` visits (replay-recording.js `rec.heals`, core.c
// `heal_heard`, features/replay-feature-sweep-2026-11-01 entry 13).
//
// A visit is one medic on one patient, one engineer on one hull, or one depot
// on one soldier or vehicle, from its first heal to a second without one. The
// server's own event log writes a begin and an end for every heal applied
// (beginMedPack / endMedPack every 0.06 s); a visit is what a watcher counts.

import { nameAt, teamAt } from './replay-recording.js';

/**
 * Each player's support up to `t`, those with any:
 * `[{ pid, name, team, heals, healed, self, repairs, depot }]`, most first.
 * `heals` his medpack visits on others, `self` on himself, `healed` the
 * visits he took from a medic or a depot, `repairs` his wrench's visits on
 * hulls, `depot` the times a depot healed him.
 */
export function supportAt(rec, t = Infinity) {
  const by = new Map();
  const of = pid => {
    if (!by.has(pid)) by.set(pid, { pid, heals: 0, healed: 0, self: 0, repairs: 0, depot: 0 });
    return by.get(pid);
  };
  for (const v of rec?.heals ?? []) {
    if (!(v.t <= t)) continue;
    if (v.kind === 'medpack' && v.pid !== null) {
      if (v.to === v.pid) of(v.pid).self += 1;
      else {
        of(v.pid).heals += 1;
        if (v.to !== null) of(v.to).healed += 1;
      }
    } else if (v.kind === 'repair' && v.pid !== null) {
      of(v.pid).repairs += 1;
    } else if (v.kind === 'depot' && v.to !== null) {
      of(v.to).depot += 1;
      of(v.to).healed += 1;
    }
  }
  const out = [];
  for (const row of by.values()) {
    out.push({ ...row, name: nameAt(rec, row.pid, t) ?? `player ${row.pid}`, team: teamAt(rec, row.pid, t) ?? 0 });
  }
  out.sort((a, b) => (b.heals + b.repairs) - (a.heals + a.repairs) || b.healed - a.healed || a.name.localeCompare(b.name));
  return out;
}

/** The visits open at `t`: who is healing or repairing what right now. */
export function healsAt(rec, t) {
  return (rec?.heals ?? []).filter(v => v.t <= t && t <= v.t1);
}
