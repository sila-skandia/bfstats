// What a recording shows too late or never, from the file's own traces.
//
// The sampler names an object (`o`) only when the server replicates it,
// within the level's view distance of the recording player, and CreateObject
// (0x07) announces each object once, when it is made. So an object that was
// there before it came into range, or before the file began, has no life
// until the recording first sees it -- and one out of range for the whole of a
// file begun after the join (recording switched on mid-round; a recorder
// before bf42plus `0254e92` kept none of the join's objects) has none at all,
// while the replay hides the level's own vehicles so that nothing is drawn
// twice. In replay_20260927-203459 (Midway, begun 41 s after the join) that
// was both carriers, the Yamato, both Hatsuzukis, the Fletcher and eight
// Daihatsus, and the PrinceOW and the Fletcher2 until 405.6 s.
//
// The file still holds a trace of each from its first sample: its moving
// parts (`jn`, keyed by the root's network id, named by template) and its
// engines (`g`), which the sampler reads off the client's object registry
// whether or not the root is replicated, and its removal (0x06) if it went.
//
// - An object the recording sees later is the same object: its life starts
//   at its first trace, drawn where the recording first saw it, when its
//   engine never ran between the two -- it has not moved.
// - A root nothing ever names is matched to the level vehicle whose own parts
//   it has (the Hatsuzuki's `HatsuzukiCannon`, a carrier's
//   `Carrier_AA_Cannon`), and stood in by it: the level's template at the
//   level's pose, from its first trace until the server removed it, its id
//   went to something else, or its engine started. So is a root seen later
//   whose engine ran before it was seen, on a place of its own template.
//
// Both are drawn as the replay draws any hull out of range that nobody has
// driven (`poseHeld`): solid, where it stands. Every unnamed root in that
// file has one engine record, not running, and one record per part.
//
// Where the parts cannot say which of several level vehicles a root is, the
// order of events can: a root removed, and a new object of a candidate's
// template made at that candidate's place after it, was that one (the
// Enterprise, sunk at 379 s, removed at 389 s and respawned at 499 s). Where
// nothing tells them apart and there are more places than roots, nothing is
// invented.
//
// Three.js-free and pure, so `tests/replay_harness.mjs` runs it in node.

import { sampleTime } from './replay-recording.js';

/** Metres within which a recorded object of a vehicle's template stands at
 *  that vehicle's place: a hull's spawn transform, a craft's deck. */
const NEAR = 40;

/** Metres within which a recorded object of any template holds a place: one
 *  place holds one hull, and a server may spawn another template on a
 *  level's pad (this one's Fletcher2 sits on Midway's first destroyer pad,
 *  the level's Fletcher's). Tighter than `NEAR`, as a carrier's deck craft
 *  park 20 m apart. */
const HELD = 10;

/** Seconds after a root's removal within which a new object of a place's
 *  template made there is that place's respawn (a vanilla ship's
 *  `maxSpawnDelay` is 110 s at most). */
const RESPAWN_WINDOW = 180;

/** Seconds of slack between a trace and a life: a creation and its first
 *  record share a packet. */
const SLACK = 0.5;

const lower = s => String(s ?? '').replace(/_\d+$/, '').toLowerCase();
const flat = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const isHullLife = l => Boolean(l.tmpl) && !l.soldier && !l.kit && !l.projectile && !l.camera && !l.controlPoint;

/** When the recording first shows `nid` as a root in its part and engine
 *  records, or null. */
function firstTrace(rec, nid) {
  let first = Infinity;
  for (const part of rec.joints?.get(nid)?.values() ?? []) {
    if (Number.isFinite(part.since)) first = Math.min(first, part.since);
    for (let i = 0; i < part.keys.length; i++) first = Math.min(first, sampleTime(part.keys, i));
  }
  for (const list of rec.engines?.get(nid)?.values() ?? []) for (const e of list) first = Math.min(first, e.t);
  return Number.isFinite(first) ? first : null;
}

/** The first time at or after `from` the recording has any of `nid`'s
 *  engines running (it may have moved from then), or Infinity. */
function engineStarts(rec, nid, from) {
  let at = Infinity;
  for (const list of rec.engines?.get(nid)?.values() ?? []) {
    for (const e of list) {
      if (e.running && e.t >= from - SLACK && e.t < at) at = Math.max(e.t, from);
    }
  }
  return at;
}

/** The first place a recorded life was seen or announced, BF1942's frame. */
const firstPlace = life => life.pose?.p ?? life.keys.at(0)?.p ?? null;

/**
 * Carry each hull the recording sees late back to its first trace, and stand
 * in for each root it never names (see above). `levelVehicles` are the level's
 * own placed vehicles and the craft its ships carry: `{ template, p, q, names
 * }`, `p`/`q` in BF1942's frame (the recording's) and `names` the lower-case
 * names of every node under the vehicle. Returns `{ extended, added }`: the
 * lives carried back (`created` moved, `seenLate` set), and the stand-in lives
 * (each also pushed onto `rec.lives`, `standIn` set).
 */
export function addStandIns(rec, levelVehicles = []) {
  const livesOf = new Map();
  for (const life of rec.lives) {
    if (!livesOf.has(life.nid)) livesOf.set(life.nid, []);
    livesOf.get(life.nid).push(life);
  }
  for (const list of livesOf.values()) list.sort((a, b) => a.created - b.created);

  const extended = [];
  const wanted = [];   // { nid, tmpl?, parts, from, until, removed }
  for (const nid of new Set([...(rec.joints?.keys() ?? []), ...(rec.engines?.keys() ?? [])])) {
    const trace = firstTrace(rec, nid);
    if (trace === null) continue;
    const lives = livesOf.get(nid) ?? [];
    if (lives.some(l => l.created <= trace + SLACK && l.destroyed > trace)) continue;
    const from = trace <= SLACK ? 0 : trace;
    const next = lives.find(l => l.created > trace);
    const starts = engineStarts(rec, nid, from);
    const parts = new Set([...(rec.joints?.get(nid)?.values() ?? [])].map(p => lower(p.name)).filter(Boolean));
    // Seen later, and not a new object under the same id (a CreateObject
    // would have announced that one): the same hull.
    if (next && !next.announced && isHullLife(next)) {
      if (starts >= next.created) {
        next.created = from;
        next.seenLate = true;
        extended.push(next);
      } else {
        wanted.push({ nid, tmpl: next.tmpl, parts, from, until: starts, removed: Infinity });
      }
      continue;
    }
    if (!parts.size) continue;   // an engine alone names no template
    const removed = rec.unseenDestroys?.find(d => d.nid === nid && d.t >= trace)?.t ?? Infinity;
    wanted.push({ nid, tmpl: null, parts, from, until: Math.min(removed, next?.created ?? Infinity, starts), removed });
  }
  if (!wanted.length || !levelVehicles?.length) return { extended, added: [] };

  // A place is taken while a recorded object stands there: one of its
  // template near it, or one of any template on it.
  const hulls = rec.lives.filter(isHullLife);
  const places = levelVehicles.map(v => ({
    ...v,
    recorded: hulls.filter(l => {
      const at = firstPlace(l);
      if (!at) return false;
      const d = flat(at, v.p);
      return d <= HELD || (d <= NEAR && lower(l.tmpl) === lower(v.template));
    }),
  }));
  const overlaps = (l, from, until) => l.created < until && l.destroyed > from;
  const free = (v, from, until) => !v.recorded.some(l => overlaps(l, from, until));
  // Its parts name the place's model (a Fletcher2 shares the Fletcher's), or
  // without parts its own template does.
  const fits = (w, v) => (w.parts.size ? [...w.parts].every(n => v.names.has(n)) : lower(v.template) === lower(w.tmpl));
  const candidates = w => places.filter(v => fits(w, v) && free(v, w.from, w.until));
  const respawned = (w, v) => Number.isFinite(w.removed)
    && v.recorded.some(l => l.created >= w.removed && l.created <= w.removed + RESPAWN_WINDOW);

  // Pair them: one with a single place, or one place its removal and a
  // respawn there single out, first; then a family whose roots and places
  // are as many (identical craft on their decks: any pairing draws the same).
  const pairs = new Map();
  const taken = new Set();
  let progress = true;
  while (progress) {
    progress = false;
    for (const w of wanted) {
      if (pairs.has(w)) continue;
      const open = candidates(w).filter(v => !taken.has(v));
      const marked = open.filter(v => respawned(w, v));
      const pick = open.length === 1 ? open[0] : marked.length === 1 ? marked[0] : null;
      if (!pick) continue;
      pairs.set(w, pick);
      taken.add(pick);
      progress = true;
    }
  }
  const families = new Map();
  for (const w of wanted) {
    if (pairs.has(w)) continue;
    const open = candidates(w).filter(v => !taken.has(v));
    if (!open.length) continue;
    const key = open.map(v => places.indexOf(v)).sort((a, b) => a - b).join(',');
    if (!families.has(key)) families.set(key, { open, members: [] });
    families.get(key).members.push(w);
  }
  for (const { open, members } of families.values()) {
    if (members.length !== open.length) continue;   // more places than roots: which, nothing says
    members.sort((a, b) => a.nid - b.nid).forEach((w, i) => {
      pairs.set(w, open[i]);
      taken.add(open[i]);
    });
  }

  const added = [];
  for (const [w, v] of pairs) {
    if (!(w.until > w.from)) continue;
    const life = {
      nid: w.nid, tmpl: w.tmpl ?? v.template, tid: 0, team: 0, created: w.from, destroyed: w.until,
      pose: { p: [...v.p], q: [...v.q] }, keys: [], replicated: [], hp: [], maxhp: 0, crit: 0,
      spawnedLate: false, announced: true, standIn: true,
      soldier: false, camera: false, projectile: false, kit: false, controlPoint: false,
    };
    rec.lives.push(life);
    added.push(life);
  }
  return { extended, added };
}
