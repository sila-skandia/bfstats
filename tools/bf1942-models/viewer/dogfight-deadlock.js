// Deadlocks, and the ways out of them (features/dogfight-school, "Extend
// the scene"). Two pilots who cannot get a bead on each other: a turning
// fight (both round one circle the same way, half a turn apart) or a
// manoeuvre fest (both throwing the plane about, reversing, up and down).
// Nobody has held a landing shot for `window` seconds inside `near` metres
// and both have turned through `turned` degrees in that time.
//
// `deadlockSpans` finds them in any fight the theatre plays (flown or
// recorded), `createDeadlockWatch` finds one in the live fight a frame at a
// time, and `extendFrom` flies the school's break-outs from the moment
// itself: both airframes exactly where they are, the opponent flying on with
// their own plan and memory, the pilot in trouble flying each way out, and
// each flight scored on what the pilot wants to know: did it put you on
// their six, get you a shot, get you clear, leave you locked, or get you
// shot. Nothing is scripted: every result is the flight law's.
//
// Pure: no DOM, no renderer, so the theatre, the live fight and the tests
// share it.

import { runDuel } from './dogfight-duel.js';

const DEG = 180 / Math.PI;

export const DEADLOCK = {
  window: 6,      // seconds of nobody's shot before it is a deadlock
  near: 600,      // never further apart than this in the window
  shot: 0.2,      // seconds of landing shot a side may have had in it
  turned: 90,     // degrees each heading turned through in the window
  sameWay: 0.8,   // share of the window turning one way, for a circle
  every: 0.5,     // seconds between looks, finding the spans
  join: 0.6,      // looks this close join one span
  seconds: 30,    // seconds each way out is flown
};

/** The deadlocks in a pilot's words. */
export const KIND_WORDS = { circle: 'a turning fight', scramble: 'a manoeuvre fest' };

/**
 * The ways out the school flies from a deadlock: the circle lesson's tries
 * (`dogfight-pilot.js` `PLANS.ci*`), started from the moment itself
 * (`memory.after` 0) rather than after eight seconds of the circle. The
 * extension waits for the moment their nose is off you (`pick`).
 */
export const WAYS = [
  { id: 'leave', name: 'Leave', what: 'Roll out while their nose is off you, full throttle, nose a little down, and keep going', plan: 'ciDip', kind: 'dip' },
  { id: 'low', name: 'Nose low, then up into them', what: 'Sink round the turn for speed, come round behind them, then pull up into them', plan: 'ciLow', kind: 'flip' },
  { id: 'zoom', name: 'Go vertical', what: 'Straight up out of the turn, over the top, and down on them', plan: 'ciZoom', kind: 'ninja' },
  { id: 'reverse', name: 'Reverse the turn', what: 'Roll into the opposite turn so that you meet them', plan: 'ciReverse', kind: 'flip' },
  { id: 'chop', name: 'Throttle chop', what: 'Throttle back (S) to turn inside them', plan: 'ciChop', kind: 'flip' },
];

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const dist = (a, b) => len(sub(a, b));
const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / ((len(a) * len(b)) || 1)))) * DEG;
const r1 = v => Math.round(v * 10) / 10;

/** A track sample's nose, from its quaternion `q` ([x, y, z, w]). */
export function noseOf(q) {
  const [x, y, z, w] = q;
  return [-(2 * (x * z + w * y)), -(2 * (y * z - w * x)), -(1 - 2 * (x * x + y * y))];
}

/** Heading of a nose, radians, or null with the nose near the vertical. */
function yawOf(n) {
  if (Math.hypot(n[0], n[2]) < 0.2) return null;
  return Math.atan2(n[0], -n[2]);
}

const wrap = d => { while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };

/**
 * Whether the two are deadlocked at sample `i` of `tracks` (two arrays of
 * `{ t, p, q, o }`: time, place, attitude, and whether that side's guns had
 * a landing shot). Null when they are not, or the window has not filled;
 * else `{ kind, range: [min, max], turn: [dir, dir] }`, each side's `turn`
 * the way it has mostly been turning (+1 right).
 */
export function deadlockAt(tracks, i, rules = DEADLOCK) {
  const [A, B] = tracks;
  if (!A?.[i] || !B?.[i]) return null;
  const t1 = A[i].t;
  let j0 = i;
  while (j0 > 0 && A[j0 - 1].t >= t1 - rules.window) j0--;
  if (A[j0].t > t1 - rules.window + 0.5) return null;
  let near = Infinity, far = 0;
  const shot = [0, 0];
  const turn = [{ total: 0, pos: 0, neg: 0, prev: null }, { total: 0, pos: 0, neg: 0, prev: null }];
  for (let j = j0; j <= i; j++) {
    const dt = j > j0 ? A[j].t - A[j - 1].t : 0;
    const r = dist(A[j].p, B[j].p);
    near = Math.min(near, r); far = Math.max(far, r);
    for (const [s, tr] of [A, B].entries()) {
      if (tr[j].o) shot[s] += dt;
      const yaw = yawOf(noseOf(tr[j].q));
      const T = turn[s];
      if (yaw === null) { T.prev = null; continue; }
      if (T.prev !== null) {
        const d = wrap(yaw - T.prev);
        T.total += Math.abs(d);
        if (d > 0.002) T.pos += dt; else if (d < -0.002) T.neg += dt;
      }
      T.prev = yaw;
    }
  }
  if (far > rules.near || shot[0] > rules.shot || shot[1] > rules.shot) return null;
  if (turn.some(T => T.total * DEG < rules.turned)) return null;
  const span = t1 - A[j0].t;
  const dir = T => (T.pos >= T.neg ? 1 : -1);
  const share = T => Math.max(T.pos, T.neg) / span;
  const circle = turn.every(T => share(T) >= rules.sameWay) && dir(turn[0]) === dir(turn[1]);
  return { kind: circle ? 'circle' : 'scramble', range: [Math.round(near), Math.round(far)], turn: turn.map(dir) };
}

/**
 * The deadlocks in a fight, in time order: `{ t0, t1, kind, from }`, `t0`
 * the first moment the window is full of it (so it began at `from`,
 * `window` seconds earlier), `t1` the last. Looked for every `every`
 * seconds, up to the fight's end.
 */
export function deadlockSpans(fight, rules = DEADLOCK) {
  const tracks = fight.tracks;
  if (!tracks?.[0]?.length || !tracks?.[1]?.length) return [];
  const n = Math.min(tracks[0].length, tracks[1].length);
  const dt = fight.dt ?? ((tracks[0].at(-1).t - tracks[0][0].t) / Math.max(1, n - 1));
  const step = Math.max(1, Math.round(rules.every / dt));
  const stop = fight.end ? fight.end.t : Infinity;
  const spans = [];
  for (let i = 0; i < n; i += step) {
    const t = tracks[0][i].t;
    if (t > stop) break;
    const d = deadlockAt(tracks, i, rules);
    if (!d) continue;
    const last = spans.at(-1);
    if (last && t - last.t1 <= rules.join) { last.t1 = t; last.kinds[d.kind] = (last.kinds[d.kind] ?? 0) + 1; }
    else spans.push({ t0: t, t1: t, from: Math.max(0, t - rules.window), kinds: { [d.kind]: 1 }, turn: d.turn });
  }
  return spans.map(s => {
    const kind = Object.entries(s.kinds).sort((a, b) => b[1] - a[1])[0][0];
    return { t0: r1(s.t0), t1: r1(s.t1), from: r1(s.from), kind, turn: s.turn };
  });
}

/** The span of `spans` holding `t`, or null. */
export const deadlockIn = (spans, t) => (spans ?? []).find(s => t >= s.t0 - 1e-6 && t <= s.t1 + 1e-6) ?? null;

/**
 * The live fight's watch: samples pushed a frame at a time (`{ t, ace: { p,
 * q, o }, you: { p, q, o } }`), the deadlock judged four times a second on
 * the last `window` seconds. `state` is null or `{ kind, since }`, `since`
 * how long it has been one.
 */
export function createDeadlockWatch(rules = DEADLOCK) {
  const tracks = [[], []];
  let state = null, lookedAt = -Infinity, startedAt = null;
  return {
    push(sample) {
      tracks[0].push({ t: sample.t, p: sample.ace.p, q: sample.ace.q, o: !!sample.ace.o });
      tracks[1].push({ t: sample.t, p: sample.you.p, q: sample.you.q, o: !!sample.you.o });
      const keep = sample.t - rules.window - 1;
      for (const tr of tracks) while (tr.length > 2 && tr[1].t < keep) tr.shift();
      if (sample.t - lookedAt < 0.25) return state;
      lookedAt = sample.t;
      const d = deadlockAt(tracks, tracks[0].length - 1, rules);
      if (!d) { state = null; startedAt = null; return state; }
      startedAt ??= sample.t;
      state = { ...d, since: r1(sample.t - startedAt + rules.window) };
      return state;
    },
    reset() { tracks[0].length = tracks[1].length = 0; state = null; startedAt = null; lookedAt = -Infinity; },
    get state() { return state; },
    /** The last seconds as two tracks (`{ t, p, q, o }`), the ace's first. */
    get tracks() { return tracks; },
  };
}

/** A track sample as a flight state, its velocity from the samples either side. */
export function trackState(track, i) {
  const a = track[Math.max(0, i - 1)], b = track[Math.min(track.length - 1, i + 1)];
  const span = (b.t - a.t) || 1 / 30;
  const k = track[i];
  return {
    position: [...k.p],
    velocity: [(b.p[0] - a.p[0]) / span, (b.p[1] - a.p[1]) / span, (b.p[2] - a.p[2]) / span],
    orientation: { x: k.q[0], y: k.q[1], z: k.q[2], w: k.q[3] },
    angularVelocity: [0, 0, 0],
  };
}

/** The way a side has been turning over the last second of its track at
 *  `i`, +1 right, -1 left (right when it has not been turning). */
export function turnDirOf(track, i) {
  let j = i;
  while (j > 0 && track[j - 1].t >= track[i].t - 1) j--;
  let sum = 0, prev = null;
  for (let k = j; k <= i; k++) {
    const yaw = yawOf(noseOf(track[k].q));
    if (yaw === null) { prev = null; continue; }
    if (prev !== null) sum += wrap(yaw - prev);
    prev = yaw;
  }
  return sum < 0 ? -1 : 1;
}

/**
 * Where a flown lesson stands at `t`: both airframes' exact states, both
 * pilots' memories and the throttles they hold, found by flying the demo's
 * `sides` again to that moment (the duels are deterministic, so this is the
 * fight on stage to the tick). `t` is rounded to the duel's tick.
 */
export function momentOf(sides, t, { makePlane, origin = [0, 0, 0], groundAt = () => origin[1], gun = {}, dt = 1 / 30 } = {}) {
  const i0 = Math.max(1, Math.round(t / dt));
  // The duel's last tick integrates once more than it steps: `seconds` of
  // (i0 - 1) ticks leaves the airframes at tick i0 exactly.
  const r = runDuel({ makePlane, sides, seconds: (i0 - 1) * dt, origin, groundAt, gun, dt });
  return { i0, states: r.finals, mems: r.mems, throttles: r.tracks.map(tr => tr.at(-1)?.stick?.[3] ?? 1) };
}

/** Lower is better: the result first, then the hits you took, then their
 *  shot on you, then how soon it came. */
const RANK = { six: 0, shot: 1, clear: 2, neutral: 3, locked: 4, hit: 5, down: 6, ground: 6 };
export const rankOf = s => (s ? RANK[s.result] * 1000 + Math.min(99, s.hits) * 10 + Math.min(9, s.hisShot) + (s.at ?? 0) / 100 : 1e6);

/**
 * Score a side's next seconds in a fight (flown or recorded) from sample
 * `i0`: `result` is one of `six` (in their rear quarter for 2 s with half a
 * second of landing shot, or you shoot them down), `shot` (a landing shot
 * you did not hold), `clear` (past 900 m and opening, no hit taken),
 * `neutral`, `locked` (a deadlock at the end), `hit` (their shot on you for
 * half a second, or a round on you), `down`, `ground`. With the seconds of
 * each side's landing shot, the hits either way, the ranges, and when.
 */
export function scoreBreak(fight, side, i0 = 0, rules = DEADLOCK) {
  const me = fight.tracks[side], him = fight.tracks[1 - side], dt = fight.dt;
  const t0 = me[i0].t;
  const end = fight.end && fight.end.t >= t0 ? fight.end : null;
  const stopAt = end ? end.t : Infinity;
  let n = Math.min(me.length, him.length);
  while (n - 1 > i0 && me[n - 1].t > stopAt) n--;
  let myShot = 0, hisShot = 0, quarter = 0, outFor = 0, sixAt = null, firstShot = null, near = Infinity, far = 0;
  for (let i = i0; i < n; i++) {
    const step = i > i0 ? me[i].t - me[i - 1].t : 0;
    const rel = sub(me[i].p, him[i].p);
    const r = len(rel);
    near = Math.min(near, r); far = Math.max(far, r);
    if (me[i].o) { myShot += step; firstShot ??= me[i].t; }
    if (him[i].o) hisShot += step;
    const hisNose = noseOf(him[i].q), myNose = noseOf(me[i].q);
    const aspect = angle([-hisNose[0], -hisNose[1], -hisNose[2]], rel);
    const ata = angle(myNose, [-rel[0], -rel[1], -rel[2]]);
    const inQuarter = aspect < 60 && ata < 30 && r < 350 && (me[i].v ?? 99) >= 35;
    if (inQuarter) { quarter += step; outFor = 0; }
    else { outFor += step; if (outFor > 0.5) quarter = 0; }
    if (sixAt === null && quarter >= 2 && myShot >= 0.5) sixAt = me[i].t;
  }
  const last = n - 1;
  const hits = (fight.rounds ?? []).filter(x => x.side === 1 - side && x.hit && x.hitT >= t0 && x.hitT <= me[last].t).length;
  const hitsOn = (fight.rounds ?? []).filter(x => x.side === side && x.hit && x.hitT >= t0 && x.hitT <= me[last].t).length;
  const endRange = dist(me[last].p, him[last].p);
  let back = last;
  while (back > i0 && me[back].t > me[last].t - 1) back--;
  const opening = endRange > dist(me[back].p, him[back].p) + 5;
  const killed = end?.why === 'shot down' && end.winner === side;
  const shotDown = end?.why === 'shot down' && end.winner === 1 - side;
  const crashed = end?.why === 'flew into the ground' && end.winner === 1 - side;
  const theyCrashed = end?.why === 'flew into the ground' && end.winner === side;
  const locked = !end && !!deadlockAt(fight.tracks, last, rules);
  let result, at = null;
  if (killed) { result = 'six'; at = end.t; }
  else if (shotDown) { result = 'down'; at = end.t; }
  else if (crashed) { result = 'ground'; at = end.t; }
  else if (sixAt !== null) { result = 'six'; at = sixAt; }
  else if (myShot >= 0.3) { result = 'shot'; at = firstShot; }
  else if (hits >= 1 || hisShot >= 0.5) result = 'hit';
  // Past 900 m and opening, or past it with an equal who never closes and
  // never had the shot: out of their reach either way.
  else if (theyCrashed || (endRange > 900 && (opening || hisShot === 0))) { result = 'clear'; at = theyCrashed ? end.t : null; }
  else if (locked) result = 'locked';
  else result = 'neutral';
  return {
    result, at: at === null ? null : r1(at - t0), killed, theyCrashed,
    myShot: r1(myShot), hisShot: r1(hisShot), hits, hitsOn, firstShot: firstShot === null ? null : r1(firstShot - t0),
    near: Math.round(near), far: Math.round(far), endRange: Math.round(endRange), opening,
    seconds: r1(me[last].t - t0), t0: r1(t0),
  };
}

/** Each result's short tag, for a tab or a card. */
export const RESULT_TAGS = {
  six: 'ON THEIR SIX', shot: 'A SHOT', clear: 'CLEAR', neutral: 'NOTHING SETTLED', locked: 'STILL LOCKED',
  hit: 'THEY GET THE SHOT', down: 'SHOT DOWN', ground: 'INTO THE GROUND',
};

/** A score in one line, to the pilot it is about. */
export function resultWords(s) {
  const secs = v => `${v.toFixed(1)} s`;
  const hitsTaken = s.hits ? ` · ${s.hits} hit${s.hits === 1 ? '' : 's'} taken` : '';
  switch (s.result) {
    case 'six':
      return s.killed ? `You shoot them down ${secs(s.at)} in${hitsTaken}`
        : `On their six ${secs(s.at)} in · your shot ${secs(s.myShot)}${hitsTaken}`;
    case 'shot': return `A shot ${secs(s.at)} in, ${secs(s.myShot)} of it, not held${hitsTaken}`;
    case 'clear': return s.theyCrashed ? `They fly into the ground ${secs(s.at)} in`
      : `Clear: ${s.endRange >= 1000 ? `${(s.endRange / 1000).toFixed(1)} km` : `${s.endRange} m`} apart at ${secs(s.seconds)}, ${s.opening ? 'and opening' : 'out of their reach'}`;
    case 'neutral': return `Nothing settled: ${s.endRange} m apart at ${secs(s.seconds)}, nobody's shot${hitsTaken}`;
    case 'locked': return `Still locked after ${secs(s.seconds)}: ${s.near} to ${s.far} m apart, nobody's shot`;
    case 'hit': return `They get the shot: ${secs(s.hisShot)} on you${hitsTaken}`;
    case 'down': return `Shot down ${secs(s.at)} in`;
    case 'ground': return `Into the ground ${secs(s.at)} in`;
    default: return '';
  }
}

/**
 * Fly every way out for `side` from sample `i0` of a fight. `states`,
 * `mems` and `throttles` are both sides' exact states, memories and
 * throttles at that moment (`momentOf` for a flown lesson, `trackState` for
 * a recording); `opponent` is `{ plan, memory, skill }` for the other seat,
 * who flies on as they were; `makePlanes` builds a fresh airframe a side.
 * Returns what happens if nothing changes (`actual`, the fight's own next
 * seconds scored) and each way with its flown fight and score, best first.
 * `yieldTo` lets a page breathe between flights.
 */
export async function extendFrom(fight, side, i0, { states, mems = [{}, {}], throttles = [1, 1], opponent, makePlanes, seconds = DEADLOCK.seconds,
                                                      origin = [0, 0, 0], groundAt = () => origin[1], gun = {}, arena = null, skill = 0.85, yieldTo = null, rules = DEADLOCK } = {}) {
  const turn = turnDirOf(fight.tracks[side], i0);
  const results = [];
  for (const way of WAYS) {
    const sides = [];
    sides[side] = { plan: way.plan, state: states[side], throttle: throttles[side], skill,
                    memory: { after: 0, pick: true, side: turn, dir: turn, y0: states[side].position[1] } };
    sides[1 - side] = { plan: opponent.plan, state: states[1 - side], throttle: throttles[1 - side], skill: opponent.skill ?? 1,
                        memory: opponent.memory ?? mems[1 - side] ?? {} };
    let flown;
    try {
      flown = runDuel({ makePlane: (_, i) => makePlanes[i](), sides, seconds, origin, groundAt, gun, arena });
    } catch (e) {
      results.push({ way, error: String(e?.message ?? e) });
      continue;
    }
    results.push({ way, flown, score: scoreBreak(flown, side, 0, rules) });
    if (yieldTo) await yieldTo();
  }
  results.sort((a, b) => rankOf(a.score) - rankOf(b.score));
  const actual = scoreBreak(fight, side, i0, rules);
  return { side, t: r1(fight.tracks[side][i0].t), i0, turn, actual, results };
}
