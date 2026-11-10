// Boelcke's rules measured over a fight (features/dogfight-doctrine). Pure:
// a fight in the theatre's shape (`runDuel`'s, or `dogfight-recorded.js`'s
// from a recording) in, for each pilot the attacks he began, the bursts he
// fired, how long he kept the other in sight, and a verdict per rule.
//
// What each word means here:
//
// - An **attack** begins when a pilot's nose is within `attackAta` of the
//   other, inside `attackRange`, not opening faster than `opening` m/s, for
//   `attackHold` seconds; it ends
//   when the nose has been off (`offAta`) for `offHold`, the range opens past
//   `attackRange + breakAway`, or the fight ends. Begun with the advantage
//   (rule 1) when his energy lead (height plus speed, metres) is
//   `advantage` or more, or the other has not seen him. Carried through
//   (rule 2) when he fired a shot that would land or hit him; abandoned
//   when he did neither and was never threatened (the other's nose within
//   `threatAta` of him inside `threatRange`), the target never turned to
//   face it (the attacker off its tail by `meetAspect` at his closest: a
//   pass met head on is rightly broken off), and he turned away from it
//   before the fight ended. Leaving a pass he is losing is the extension,
//   not a broken rule.
// - A **burst** is a run of firing ticks, gaps under `burstGap` joined; its
//   rounds are the fight's rounds fired in it, each counted close (rule 3)
//   when the range was inside the plane's useful range (`usefulRange`) as
//   it left; from behind (rule 5)
//   when the first burst of an attack comes from within `astern` of his
//   tail.
// - **Sight** (rule 4) is the share of the fight a pilot had the other in
//   sight: the duel's own `sees` where it was flown, else `perceive` run
//   over both tracks (a recording carries no eyes).
// - **Meeting the dive** (rule 6): an attack on him begun from `diveAbove`
//   metres or more above him. Judged where it is decided, at the attacker's
//   first burst or, with none, at the closest the attacker came: met when
//   the attacker was off his tail by `meetAspect` or more (he had turned
//   into the dive, so the pass is head on or across), run when the attacker
//   sat within `runAspect` of his tail.

import { geometry, perceive } from './dogfight-pilot.js';
import { energyHeight } from './dogfight-flight.js';

export const DOCTRINE = Object.freeze({
  version: 1,
  attackAta: 30, attackRange: 700, attackHold: 0.5, opening: 5,
  offAta: 60, offHold: 2, breakAway: 200,
  advantage: 50,
  threatAta: 20, threatRange: 500,
  burstGap: 0.4,
  astern: 45,
  diveAbove: 100, meetAspect: 90, runAspect: 45,
  // A share kept above this keeps the rule.
  keepShare: 0.8, closeShare: 0.8, sightShare: 0.8,
  // Damage at the useful range, of full.
  usefulDamage: 0.5,
});

/** The rules, in plain words, for the cards and the end card. */
export const RULES = [
  { n: 1, id: 'advantage', name: 'Advantage first', rule: 'Try to secure advantages before attacking. If possible, keep the sun behind you.',
    plain: 'Height, speed or surprise before you go in.', lesson: ['boom-and-zoom', 'counter'],
    here: 'In the recorded fights an attack begun with the advantage won 33% and lost 5%; without it, 17% and 9%. The sun hides nothing in this engine; height is capped where the wings stop lifting, at 1000 m.' },
  { n: 2, id: 'commit', name: 'Carry it through', rule: 'Always carry through an attack when you have started it.',
    plain: 'Once you go in, finish the pass: fire, then get out.', lesson: ['boom-and-zoom', 'ninja'],
    here: 'The upper hand is the first pass, and the pass spends it. Break off a pass they have turned to meet; finish one they have not.' },
  { n: 3, id: 'close', name: 'Close, then closer', rule: 'Fire only at close range and only when your opponent is properly in your sights.',
    plain: 'Hold your fire until they are close and in the sight.', lesson: ['gunnery', null],
    here: 'In the recordings, 25 hits in 100 rounds inside 100 m, 13 at 300 to 400 m, 1 beyond. BF1918 rounds do full damage only to 100 m; FHSW rounds weaken from the muzzle.' },
  { n: 4, id: 'sight', name: 'Keep them in sight', rule: 'Always keep your eye on your opponent, and never let yourself be deceived by ruses.',
    plain: 'Never lose sight of them. A plane falling away may be faking.', lesson: ['falling-leaf', 'counter'],
    here: 'No enemy plane is ever on the minimap, and their name shows only while you aim at them. The winners of the recorded fights had the other in sight 95% of the time, the losers 82%.' },
  { n: 5, id: 'behind', name: 'From behind', rule: 'In any form of attack it is essential to assail your enemy from behind.',
    plain: 'Come in from their tail, where they cannot see you or shoot.', lesson: ['on-his-tail', 'move'],
    here: 'From their rear half the recorded attacks won 36 to 41% and lost 2 to 3%; from their front half, 18% and 7%.' },
  { n: 6, id: 'meet', name: 'Turn into the dive', rule: 'If your opponent dives on you, do not try to evade the onslaught, but fly to meet it.',
    plain: 'If they dive on you, turn and meet them. Running hands them the shot.', lesson: ['under-the-height', 'counter'],
    here: 'Recorded pilots who met a dive lost 28% of those fights; those who ran lost 62%.' },
  { n: 7, id: 'home', name: 'Know the way home', rule: "When over the enemy's lines never forget your own line of retreat.",
    plain: 'Over their ground, always know the way back to your guns and your airfield.', lesson: null,
    here: 'Your airfield repairs and rearms, your AA covers it, and the combat area burns a plane that strays out of it. Not in the school yet: its arena has no airfields.' },
  { n: 8, id: 'team', name: 'Fight as a team', rule: 'Attack on principle in groups of four or six. Avoid two aircraft attacking the same opponent.',
    plain: 'Fight as a group, and never two of you on one of them.', lesson: null,
    here: 'One recorded fight in eight ended with a third plane or gun taking the kill. Not in the school yet: it flies one plane a side.' },
];

/**
 * Damage at `range`, of full, under a projectile's falloff (IMP-6): full to
 * `start`, falling straight to `min` at `end`, flat after. No falloff
 * (`start` 0 or `min` 1 or more) is full everywhere.
 */
export function damageAt(range, falloff) {
  if (!falloff) return 1;
  const { start, end, min } = falloff;
  if (!(start > 0) || !(min < 1) || !(end > start)) return 1;
  if (range <= start) return 1;
  if (range >= end) return min;
  return 1 - (1 - min) * (range - start) / (end - start);
}

/**
 * The range a gun is worth firing at: inside the guns' own reach (`range`,
 * `gunOf`'s: the wing guns' convergence for vanilla), and where a round
 * still does `usefulDamage` of full under its falloff.
 */
export function usefulRange(gun = {}, rules = DOCTRINE) {
  const reach = Number.isFinite(gun.range) && gun.range > 0 ? gun.range : 268;
  const f = gun.falloff;
  if (!f || !(f.start > 0) || !(f.min < 1) || !(f.end > f.start) || f.min >= rules.usefulDamage) return Math.round(reach);
  const at = f.start + (f.end - f.start) * (1 - rules.usefulDamage) / (1 - f.min);
  return Math.round(Math.min(reach, at));
}

/**
 * A plane's main guns from its node (the glb's extras): the FireArms bound
 * to `c_PIFire`, its round's speed and reach and its falloff. Null when the
 * node carries none.
 */
export function gunFromNode(node) {
  let found = null;
  node?.traverse?.(n => {
    const fa = n.userData?.fireArms;
    if (found || !fa || (fa.input && fa.input !== 'c_PIFire') || fa.projectile?.kind !== 'bullet') return;
    found = { speed: fa.velocity, reach: (fa.velocity ?? 0) * (fa.projectile.timeToLive ?? 1.5), falloff: falloffOf(fa.projectile.damage),
              rate: fa.roundOfFire ?? null };
  });
  return found;
}

/** A projectile's falloff from its glb extras (`fireArms.projectile.damage`). */
export function falloffOf(damage) {
  if (!damage) return null;
  const start = damage.distToStartLoseDamage, end = damage.distToMinDamage, min = damage.minDamage;
  return Number.isFinite(start) && Number.isFinite(end) && Number.isFinite(min) ? { start, end, min } : null;
}

const quat = q => (Array.isArray(q) ? { x: q[0], y: q[1], z: q[2], w: q[3] } : q);
const DEG = 180 / Math.PI;

/** Both tracks as flight states, velocities from the positions. */
function statesOf(fight) {
  const dt = fight.dt;
  const n = Math.min(fight.tracks[0].length, fight.tracks[1].length);
  const h = Math.max(1, Math.round(0.1 / dt));
  return fight.tracks.map(tr => Array.from({ length: n }, (_, i) => {
    const a = tr[Math.max(0, i - h)].p, b = tr[Math.min(n - 1, i + h)].p;
    const span = (Math.min(n - 1, i + h) - Math.max(0, i - h)) * dt || dt;
    return { position: tr[i].p, velocity: [(b[0] - a[0]) / span, (b[1] - a[1]) / span, (b[2] - a[2]) / span], orientation: quat(tr[i].q) };
  }));
}

/** Who sees whom, tick by tick: the duel's `sees`, or `perceive` over the tracks. */
export function sightOf(fight, S = statesOf(fight)) {
  const n = S[0].length;
  return [0, 1].map(s => {
    const tr = fight.tracks[s];
    if (tr.slice(0, n).every(k => k.sees === 0 || k.sees === 1)) return tr.slice(0, n).map(k => !!k.sees);
    const mem = { t: 0, rng: s + 1 };
    return Array.from({ length: n }, (_, i) => {
      mem.t = i * fight.dt;
      return perceive(mem, S[s][i], S[1 - s][i], fight.dt).sees;
    });
  });
}

/**
 * The doctrine over a fight. `opts.guns` is one gun per side
 * (`{ range, falloff }`, `usefulRange`'s); `opts.sun` the direction toward
 * the sun in the fight's frame, for each attack's sun angle (null leaves it
 * out). Returns `{ sides: [two { attacks, bursts, sight, useful, rules }] }`.
 */
export function doctrineOf(fight, opts = {}, R = DOCTRINE) {
  const dt = fight.dt;
  const S = statesOf(fight);
  const n = S[0].length;
  const sees = sightOf(fight, S);
  const end = fight.end?.t ?? Infinity;
  const G = [0, 1].map(s => Array.from({ length: n }, (_, i) => geometry(S[s][i], S[1 - s][i])));
  const E = [0, 1].map(s => S[s].map(st => energyHeight(st.position[1], Math.hypot(...st.velocity))));
  const t = i => fight.tracks[0][i].t;
  const sides = [0, 1].map(s => {
    const o = 1 - s;
    const tr = fight.tracks[s], gun = opts.guns?.[s] ?? {};
    const useful = usefulRange(gun, R);
    // Rounds by the tick they left.
    const rounds = (fight.rounds ?? []).filter(r => r.side === s);
    // Bursts.
    const bursts = [];
    for (let i = 0; i < n; i++) {
      if (!tr[i].f || t(i) > end) continue;
      const last = bursts.at(-1);
      if (last && t(i) - t(last.i1) <= R.burstGap) { last.i1 = i; continue; }
      bursts.push({ i0: i, i1: i });
    }
    for (const b of bursts) {
      const t0 = t(b.i0), t1 = t(b.i1) + dt;
      const mine = rounds.filter(r => r.t >= t0 - 1e-6 && r.t < t1 + 1e-6);
      const g = G[s][b.i0];
      // Each round at the range it left at: the rounds themselves, or a
      // round a firing tick where the fight carries none.
      const tickOf = tt => Math.max(b.i0, Math.min(b.i1, Math.round(tt / dt)));
      const ticks = mine.length ? mine.map(r => tickOf(r.t)) : Array.from({ length: b.i1 - b.i0 + 1 }, (_, k) => b.i0 + k).filter(k => tr[k].f);
      Object.assign(b, {
        t0, t1: t(b.i1), range: Math.round(g.range), aspect: Math.round(g.aspect), ata: Math.round(g.ata),
        rounds: ticks.length, closeRounds: ticks.filter(k => G[s][k].range <= useful).length, hits: mine.filter(r => r.hit).length,
        landing: tr.slice(b.i0, b.i1 + 1).some(k => k.o),
      });
      b.close = b.closeRounds >= b.rounds / 2;
    }
    // Attacks.
    const attacks = [];
    let i = 0;
    while (i < n && t(i) <= end) {
      const on = k => G[s][k].ata <= R.attackAta && G[s][k].range <= R.attackRange && G[s][k].closure > -R.opening;
      if (!on(i)) { i++; continue; }
      let j = i;
      while (j < n && on(j) && t(j) - t(i) < R.attackHold) j++;
      if (j >= n || !on(j)) { i = j + 1; continue; }
      // Begun at i; runs until the nose is off for offHold, or the range opens.
      let k = j, offSince = null, endedBy = 'end';
      for (; k < n && t(k) <= end; k++) {
        const g = G[s][k];
        if (g.range > R.attackRange + R.breakAway) { endedBy = 'apart'; break; }
        if (g.ata > R.offAta) { offSince ??= t(k); if (t(k) - offSince >= R.offHold) { endedBy = 'off'; break; } } else offSince = null;
      }
      const k1 = Math.min(k, n - 1);
      const a = { i0: i, i1: k1, t0: t(i), t1: t(k1) };
      const g0 = G[s][i];
      a.lead = Math.round(E[s][i] - E[o][i]);
      a.above = Math.round(-g0.above);
      a.unseen = !sees[o][i];
      a.advantage = a.lead >= R.advantage || a.unseen;
      a.aspect = Math.round(g0.aspect);
      if (opts.sun) {
        // From the target to the attacker, against the sun.
        const los = g0.los.map(v => -v), sd = opts.sun, m = Math.hypot(...sd) || 1;
        a.sun = Math.round(Math.acos(Math.max(-1, Math.min(1, (los[0] * sd[0] + los[1] * sd[1] + los[2] * sd[2]) / m))) * DEG);
      }
      const inside = bursts.filter(b => b.t0 >= a.t0 - 1e-6 && b.t0 <= a.t1 + 1e-6);
      a.fired = inside.length > 0;
      a.first = inside[0] ? { t: inside[0].t0, range: inside[0].range, aspect: inside[0].aspect } : null;
      a.hits = inside.reduce((x, b) => x + b.hits, 0);
      a.landed = inside.some(b => b.landing) || a.hits > 0;
      a.threatened = false;
      for (let q = i; q <= k1; q++) if (G[o][q].ata <= R.threatAta && G[o][q].range <= R.threatRange) { a.threatened = true; break; }
      let closest = i;
      for (let q = i; q <= k1; q++) if (G[s][q].range < G[s][closest].range) closest = q;
      a.closest = Math.round(G[s][closest].range);
      a.met = G[s][closest].aspect >= R.meetAspect;
      a.endedBy = endedBy;
      a.finished = a.landed;
      a.abandoned = !a.landed && !a.threatened && !a.met && endedBy !== 'end';
      attacks.push(a);
      i = k1 + 1;
    }
    const seen = sees[s].slice(0, Math.min(n, Math.ceil(Math.min(end, t(n - 1)) / dt) + 1));
    return { useful, bursts, attacks, sight: seen.length ? seen.filter(Boolean).length / seen.length : 1 };
  });
  // Rule 6, from the other side's attacks: dives on me.
  for (const s of [0, 1]) {
    const o = 1 - s;
    sides[s].dives = sides[o].attacks.filter(a => a.above >= R.diveAbove).map(a => {
      let q = a.first ? Math.round(a.first.t / dt) : a.i0;
      if (!a.first) for (let k = a.i0; k <= a.i1; k++) if (G[o][k].range < G[o][q].range) q = k;
      const aspect = Math.round(G[o][q].aspect);
      return { t0: a.t0, above: a.above, at: t(q), range: Math.round(G[o][q].range), aspect,
               met: aspect >= R.meetAspect, ran: aspect <= R.runAspect, hitMe: a.hits };
    });
  }
  for (const side of sides) side.rules = verdicts(side, R);
  return { version: R.version, sides };
}

const share = (xs, f) => (xs.length ? xs.filter(f).length / xs.length : null);

/** Each rule kept, broken, or not in play, with the numbers behind it. */
function verdicts(side, R) {
  const v = (n, value, keep, words) => ({ n, value, kept: value === null ? null : value >= keep, words });
  const { attacks, bursts, dives } = side;
  const rounds = bursts.reduce((x, b) => x + b.rounds, 0);
  const closeRounds = bursts.reduce((x, b) => x + b.closeRounds, 0);
  const firsts = attacks.filter(a => a.first);
  const pct = x => `${Math.round(x * 100)}%`;
  const of = (k, n, one, many = `${one}s`) => `${k} of ${n} ${n === 1 ? one : many}`;
  const abandoned = attacks.filter(a => a.abandoned).length;
  const adv = share(attacks, a => a.advantage), done = share(attacks.filter(a => a.landed || a.abandoned), a => a.finished);
  const close = rounds ? closeRounds / rounds : null, astern = share(firsts, a => a.first.aspect <= R.astern);
  const meet = share(dives, d => d.met);
  return [
    v(1, adv, R.keepShare, adv === null ? 'No attack' : `${of(attacks.filter(a => a.advantage).length, attacks.length, 'attack')} begun with the advantage`),
    v(2, done, R.keepShare, done === null ? 'No attack to finish' : abandoned ? `${abandoned} ${abandoned === 1 ? 'attack' : 'attacks'} abandoned before a shot` : 'Every attack finished'),
    v(3, close, R.closeShare, close === null ? 'No rounds fired' : `${pct(close)} of rounds fired inside ${side.useful} m`),
    v(4, side.sight, R.sightShare, `Them in sight ${pct(side.sight)} of the fight`),
    v(5, astern, R.keepShare, astern === null ? 'No burst fired' : `${of(firsts.filter(a => a.first.aspect <= R.astern).length, firsts.length, 'attack')} opened from their tail`),
    v(6, meet, R.keepShare, meet === null ? 'Nobody dived on you' : `${of(dives.filter(d => d.met).length, dives.length, 'dive')} on you met`),
  ];
}
