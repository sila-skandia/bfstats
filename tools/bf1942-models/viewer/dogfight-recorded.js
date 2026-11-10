// A dogfight found in a round's recording (`dogfight-detect.js`,
// `extract_dogfights.mjs`), turned into the fight the dogfight school's
// theatre plays (features/dogfight-recordings): the same shape `runDuel`
// gives it, so a recorded fight is drawn, slowed on its shots and explained
// exactly as a flown one is.
//
// The file holds only what the recording says: both planes every `dt`
// seconds in the recording's frame, the propellers' revs, every gun round
// and the evidence (aimed shots, hits, the kill). Everything the theatre
// reads beyond that is worked out here, by the school's own rules, so it
// improves without extracting again:
//
// - `o`, a shot that would land: the nose on the lead inside `GUN_RANGE`
//   (`gunSolution`, the duel's own test); `z` the kill zone round it.
// - `in`, what he is doing: going for the shot (on the other's tail, or
//   firing), getting out of the other's (the other on his), or setting up.
// - `ph` and its words, the situation held for `HOLD` seconds before it
//   counts, so a caption does not flicker through a crossing.
// - each round's hit, where its line passes within `HIT_RADIUS` of the
//   other's path (what the theatre sparks); the hits the recording proves
//   are counted apart (`meta.proven`).

import { geometry, situation } from './dogfight-pilot.js';
import { gunSolution, energyHeight } from './dogfight-flight.js';
import { HIT_RADIUS } from './dogfight-duel.js';
import { decodePlayerName } from './vehicle-players.js';
import { viewPosition, viewRotation } from './replay-recording.js';
import { endingWords, fightLine, planeName } from './dogfight-lines.js';

// The words for a fight in a list, shared with the replay's timeline.
export { endingWords, fightLine, planeName };

/** The range a recorded pilot's shot counts as one that would land at. */
export const GUN_RANGE = 400;
/** Seconds a situation holds before the caption says it. */
export const HOLD = 1;
/** Seconds a round flies when it meets nothing. */
const ROUND_LIFE = 1.5;
const ROUND_SPEED = 400;

/** The recording's frame to the viewer's: the replay's own
 *  (`replay-recording.js` `viewPosition` / `viewRotation`). */
const viewP = (x, y, z) => viewPosition([x, y, z]);
const viewQ = (x, y, z, w) => viewRotation([x, y, z, w]);


/**
 * A pilot's caption in his own words ("He is on my tail: breaking into
 * him", the lessons' pilots talk like that) as the school says it about him,
 * the two named: "Paciencia is on Minnie's tail: breaking into Paciencia".
 * Under a pilot's name a caption that says "my" reads as the viewer's own.
 * `me` speaks, `him` is the other; one pass, so a name is never rewritten.
 */
export function inThirdPerson(text, me, him) {
  if (!text) return text;
  // "you" (the school's own pilot) takes its own grammar: you are, your.
  const isYou = x => String(x).toLowerCase() === 'you';
  const poss = x => (isYou(x) ? 'your' : `${x}'s`);
  const own = poss(me), other = poss(him);
  const out = String(text).replace(/\b(I am|I have|I get|I'm|I|myself|mine|my|me|we|our|himself|he|his|him)\b/gi, word => {
    switch (word.toLowerCase()) {
      case 'i am': case "i'm": return isYou(me) ? 'you are' : `${me} is`;
      case 'i have': return isYou(me) ? 'you have' : `${me} has`;
      case 'i get': return isYou(me) ? 'you get' : `${me} gets`;
      case 'i': case 'me': return me;
      case 'myself': return isYou(me) ? 'yourself' : me;
      case 'mine': return isYou(me) ? 'yours' : own;
      case 'my': return own;
      case 'we': return /^[A-Z]/.test(word) ? 'They' : 'they';
      case 'our': return /^[A-Z]/.test(word) ? 'Their' : 'their';
      case 'he': case 'him': return him;
      case 'himself': return isYou(him) ? 'yourself' : him;
      case 'his': return other;
      default: return word;
    }
  });
  // "He is" said of you reads "you are".
  const agreed = isYou(me) || isYou(him)
    ? out.replace(/\b(you) (is|has|was|does)\b/gi, (_, y, v) => `${y} ${{ is: 'are', has: 'have', was: 'were', does: 'do' }[v.toLowerCase()]}`)
    : out;
  return agreed.charAt(0).toUpperCase() + agreed.slice(1);
}

/** What a pilot is doing, for the situation he is in, the two named: a
 *  recording's pilots are people, and a caption under one pilot's name that
 *  says "my" reads as the viewer's. `me` is the pilot the caption is under. */
function words(sit, g, me, him) {
  const range = `${Math.round(g.range / 10) * 10} m`;
  switch (sit) {
    case 'offensive': return `On ${him}'s six, ${range}`;
    case 'defensive': return `${him} is on ${me}'s six, ${range}`;
    case 'headOn': return `Head on with ${him}, closing`;
    default: return g.range > 900 ? `${range} from ${him}, turning for them` : 'Turning for position';
  }
}

/**
 * The theatre's fight from an extracted one (`raw`, one
 * `dogfights/<id>.json`). `origin` is the middle of the fight on the
 * ground's level (y 0, the recording's sea level), so heights read as
 * altitudes.
 */
export function recordedFight(raw) {
  const dt = raw.dt;
  const names = raw.sides.map(s => decodePlayerName(s.name ?? '') || 'pilot');
  const n = Math.min(...raw.sides.map(s => s.p.length / 3));
  // Positions and rotations in the viewer's frame, and velocities from them.
  const P = raw.sides.map(s => Array.from({ length: n }, (_, i) => viewP(s.p[i * 3], s.p[i * 3 + 1], s.p[i * 3 + 2])));
  const Q = raw.sides.map(s => Array.from({ length: n }, (_, i) => viewQ(s.q[i * 4], s.q[i * 4 + 1], s.q[i * 4 + 2], s.q[i * 4 + 3])));
  const V = P.map(ps => ps.map((_, i) => {
    const a = ps[Math.max(0, i - 1)], b = ps[Math.min(n - 1, i + 1)];
    const span = (Math.min(n - 1, i + 1) - Math.max(0, i - 1)) * dt || dt;
    return [(b[0] - a[0]) / span, (b[1] - a[1]) / span, (b[2] - a[2]) / span];
  }));
  let cx = 0, cz = 0;
  for (const ps of P) for (const p of ps) { cx += p[0]; cz += p[2]; }
  const origin = [cx / (2 * n), 0, cz / (2 * n)];
  const state = (s, i) => ({ position: P[s][i], velocity: V[s][i], orientation: { x: Q[s][i][0], y: Q[s][i][1], z: Q[s][i][2], w: Q[s][i][3] } });
  const shotsAt = raw.sides.map((_, s) => {
    const ticks = new Set();
    // The pilot's own guns: a gunner's rounds (`gunner`) are not the pilot firing.
    for (const sh of raw.shots) if (sh.side === s && !sh.gunner) ticks.add(Math.round(sh.t / dt));
    return ticks;
  });
  const hitTicks = raw.sides.map((_, s) => new Set(raw.evidence.filter(e => e.side === s && e.kind === 'hit').map(e => Math.round(e.t / dt))));
  const tracks = [[], []];
  const events = [];
  const held = [{ sit: null, since: 0, said: null }, { sit: null, since: 0, said: null }];
  for (let i = 0; i < n; i++) {
    const t = Math.round(i * dt * 1000) / 1000;
    for (let s = 0; s < 2; s++) {
      const me = state(s, i), him = state(1 - s, i);
      const g = geometry(me, him);
      const sol = gunSolution(me, him, { range: GUN_RANGE, width: 6 });
      const firing = shotsAt[s].has(i);
      const sit = situation(g);
      // The situation counts once it has held HOLD seconds.
      const h = held[s];
      if (sit !== h.sit) { h.sit = sit; h.since = t; }
      const speed = Math.hypot(...me.velocity);
      const intent = firing || sit === 'offensive' ? 'attack' : sit === 'defensive' ? 'defend' : 'setup';
      if (h.said !== sit && (t - h.since >= HOLD || i === 0)) {
        h.said = sit;
        events.push({ t, side: s, phase: sit, say: words(sit, g, names[s], names[1 - s]), move: planeName(raw.sides[s].tmpl),
                      intent: sit === 'offensive' ? 'attack' : sit === 'defensive' ? 'defend' : 'setup' });
      }
      const rv = raw.sides[s].rv?.[i];
      tracks[s].push({
        t, p: P[s][i], q: Q[s][i], v: speed, ph: h.said ?? sit, f: firing, h: hitTicks[s].has(i),
        e: energyHeight(P[s][i][1] - origin[1], speed),
        stick: [0, 0, 0, 0], in: intent,
        o: sol.fire, z: sol.dist < GUN_RANGE && sol.off < 8,
        so: Math.round(sol.off * 10) / 10, sd: Math.round(sol.dist),
        rv: Number.isFinite(rv) ? rv : 1,
      });
    }
  }
  // Every round, flown against the other's path: a hit where it passes
  // within HIT_RADIUS.
  const at = (s, t) => {
    const f = Math.max(0, Math.min(n - 1, t / dt));
    const i = Math.floor(f), j = Math.min(n - 1, i + 1), k = f - i;
    const a = P[s][i], b = P[s][j];
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  };
  const rounds = raw.shots.map(sh => {
    const start = viewP(...sh.pos);
    const d = viewP(...sh.dir);
    const dl = Math.hypot(...d) || 1;
    const pv = viewP(...(sh.pv ?? [0, 0, 0]));
    const v = d.map((c, k) => c / dl * ROUND_SPEED + pv[k]);
    const r = { side: sh.side, t: sh.t, start, p: start, v, age: 0, done: true, hit: false, weapon: sh.weapon };
    // A gunner's round, from the same plane's other seat (`sampleFight`):
    // drawn as that gun's own tracer, at its own muzzle speed once the
    // theatre has the plane's model (`timeGunnerRounds`).
    if (sh.gunner) Object.assign(r, { gunner: true, dir: d.map(c => c / dl), pv });
    for (let tau = 0; tau <= ROUND_LIFE && sh.t + tau <= (n - 1) * dt; tau += 0.02) {
      const q = at(1 - sh.side, sh.t + tau);
      const x = [start[0] + v[0] * tau, start[1] + v[1] * tau, start[2] + v[2] * tau];
      if (Math.hypot(x[0] - q[0], x[1] - q[1], x[2] - q[2]) <= HIT_RADIUS) {
        Object.assign(r, { hit: true, hitT: sh.t + tau, hitAt: x });
        break;
      }
    }
    return r;
  });
  const hits = [0, 1].map(s => rounds.filter(r => r.side === s && r.hit).length);
  let end = null;
  if (raw.kill) {
    end = { t: raw.kill.t, winner: raw.kill.side, why: 'shot down' };
    events.push({ t: raw.kill.t, side: raw.kill.side, phase: 'kill', say: `Shot ${names[1 - raw.kill.side]} down`, move: planeName(raw.sides[raw.kill.side].tmpl) });
  }
  events.sort((a, b) => a.t - b.t);
  return {
    tracks, events, rounds, hits, end, dt, origin, duration: tracks[0].at(-1).t,
    recorded: true, names, planes: raw.sides.map(s => planeName(s.tmpl)), templates: raw.sides.map(s => s.tmpl ?? null),
    // Why it stopped (the detector's rule 8), and where each plane was out
    // of the recording player's range (its path there is guessed).
    ending: raw.end ? { ...raw.end, words: endingWords(raw.end, names) } : null,
    lost: raw.sides.map(s => s.lost ?? []),
    meta: {
      ...raw.meta, id: raw.id, kind: raw.kind, mutual: raw.mutual, closest: raw.closest, t0: raw.t0,
      proven: [0, 1].map(s => raw.evidence.filter(e => e.side === s && e.kind === 'hit').length),
      aimed: raw.sides.map(s => s.aimed), turned: raw.sides.map(s => s.turned), kill: raw.kill,
    },
  };
}

/**
 * Who dominates the recorded fights: one row a pilot (by decoded name) over
 * `rows` (the index's), best first: fights, won (he shot the other down),
 * lost, the fights where both shot (and how many of those he won), the
 * planes he flew, most first, and the rounds he flew them in. Ranked by wins,
 * then by fewest losses, then by fights. A name is not a person: two players
 * can share one, and one can change his; the rounds say where each row is.
 */
export function pilotTable(rows) {
  const by = new Map();
  for (const r of rows) {
    for (const [i, s] of r.sides.entries()) {
      const name = decodePlayerName(s.name ?? '') || 'pilot';
      const p = by.get(name) ?? { name, fights: 0, won: 0, lost: 0, mutual: 0, mutualWon: 0, planes: new Map(), rounds: new Set(), ids: [] };
      by.set(name, p);
      p.fights++;
      p.ids.push(r.id);
      p.rounds.add(r.slug);
      p.planes.set(planeName(s.tmpl), (p.planes.get(planeName(s.tmpl)) ?? 0) + 1);
      if (r.kill?.side === i) p.won++;
      else if (r.kill) p.lost++;
      if (r.mutual) {
        p.mutual++;
        if (r.kill?.side === i) p.mutualWon++;
      }
    }
  }
  return [...by.values()]
    .map(p => ({ ...p, planes: [...p.planes].sort((a, b) => b[1] - a[1]).map(([plane, n]) => ({ plane, n })), rounds: p.rounds.size }))
    .sort((a, b) => b.won - a.won || a.lost - b.lost || b.fights - a.fights || a.name.localeCompare(b.name));
}
