// A fight of more than two planes (features/dogfight-doctrine, Boelcke's
// rule 8: fight as a group, never two on one). The duel (`dogfight-duel.js`
// `runDuel`) flies two of the school's pilots; this flies any number, in
// teams, on the same airframes, hands, eyes and rounds, for the lessons a
// pair teaches: the wingman who clears his leader's tail, the Thach weave.
//
// Each pilot fights one enemy at a time, his target: the one his plan names
// (`out.target`, an index, kept until it says another), else the nearest
// enemy, kept while it lives unless another is a third nearer. He sees each
// enemy through eyes of his own (`perceive`'s memory, one per enemy), so
// losing one is not losing all. Every pilot is also handed the whole fight
// (`c.team`: `index`, `friends` and `enemies`, each `{ i, state }`, true
// positions: what a pair calls to each other on the radio), which team
// plans read and the others ignore.
//
// Every round is flown against every plane but its shooter's; the first it
// strikes takes the hit. A plane with `killHits` rounds in it is down and
// leaves the fight, as one that flies into the ground does. The fight ends
// when a team has nobody left, or at `seconds`.

import { createPilot, gunOf } from './dogfight-pilot.js';
import { stateOf, gunSolution, energyHeight, len, sub, add, scale, unit, dot, basis, leadPoint } from './dogfight-flight.js';
import { placePlane, stage, applyStick, fireRound, segmentNear, strikesAirframe, fitAirframe, paced, pilotView, HIT_RADIUS, KILL_HITS, DUEL_DT } from './dogfight-duel.js';

/** A target is kept unless another enemy is this much nearer. */
const SWITCH = 0.67;

/**
 * A two-seater's rear gunner (`side.gunner`): a turret that fires aft at
 * the nearest enemy inside its arc and range, after `react` seconds of
 * having him there. The arc is BF1918's (features/dogfight-doctrine,
 * "Research notes"): `yaw` degrees either side of astern, `down` below the
 * tail line to `up` above it; his aim wanders `spread` degrees.
 */
export const GUNNER = { yaw: 70, down: 5, up: 40, range: 400, react: 0.8, spread: 1.2, speed: 400 };

/** Whether `p` is inside a gunner's arc on plane `st`, and how far. */
export function inGunnerArc(st, p, arc = GUNNER) {
  const { F, U } = basis(st.orientation);
  const rel = sub(p, st.position), d = len(rel);
  if (d > arc.range || d < 1) return null;
  const los = scale(rel, 1 / d), aft = scale(F, -1);
  const up = Math.asin(Math.max(-1, Math.min(1, dot(los, U)))) * 180 / Math.PI;
  const flat = sub(los, scale(U, dot(los, U)));
  const off = Math.acos(Math.max(-1, Math.min(1, dot(unit(flat), aft)))) * 180 / Math.PI;
  return off <= arc.yaw && up >= -arc.down && up <= arc.up ? { d, off, up } : null;
}

/**
 * Fly a fight. `sides` is `{ plan, start, skill, team, memory }` each (team
 * any value; equal is friendly). Returns `{ tracks, events, rounds, hits,
 * hitsOn, hitsBy, downs, end, teamEnd, dt, teams }`: a track per plane (the
 * duel's sample, plus `target`), `hits[i]` the rounds plane i landed,
 * `hitsOn[j]` the rounds in plane j, `hitsBy[i][j]` the rounds plane i put
 * in plane j, `downs` each plane brought down (`{ i, t, by, why }`), `end`
 * the duel's shape for the theatre (the first of planes 0 and 1 to go down:
 * `{ t, winner: the plane that did it, why }`), `teamEnd` when a team had
 * nobody left (`{ t, winner: team, why }`).
 */
export function runFight({ makePlane, sides, seconds = 60, origin = [0, 0, 0], groundAt = () => origin[1],
                           gun = {}, killHits = KILL_HITS, dt = DUEL_DT, arena = null }) {
  const n = sides.length;
  const teams = sides.map(s => s.team ?? 0);
  // Each airframe fitted as a duel's is (`fitAirframe`): its hands, its
  // pace, and for a jet its own cannon and the fight seen at the Spitfire's
  // size.
  const fitted = [];
  const planes = sides.map((side, i) => {
    const plane = makePlane(side, i);
    const fit = fitted[i] = fitAirframe(plane, makePlane, i);
    plane.groundHeight = (x, z) => groundAt(x, z);
    placePlane(plane, stage(origin, paced(side.start, fit.pace)));
    return plane;
  });
  const guns = sides.map((_, i) => gunOf(fitted[i].gun ?? gun));
  const views = sides.map((_, i) => pilotView(fitted[i].pace));
  const pilots = sides.map((side, i) => createPilot(side.plan ?? 'cruiser', { skill: side.skill ?? 1, gun: views[i].gun(fitted[i].gun ?? gun), seed: i + 1 }));
  const grounds = views.map(v => v.ground(groundAt));
  const fences = views.map(v => v.arena(arena));
  for (const [i, side] of sides.entries()) Object.assign(pilots[i].mem, structuredClone(side.memory ?? {}));
  const alive = sides.map(() => true);
  const tracks = sides.map(() => []);
  const events = [];
  const rounds = [];
  const hitsOn = sides.map(() => 0);
  const hitsBy = sides.map(() => sides.map(() => 0));
  const downs = [];
  const lastPhase = sides.map(() => '');
  const targets = sides.map(() => ({ i: -1 }));
  let rng = 0x2545f491;
  const rand = () => ((rng = (rng * 1103515245 + 12345) >>> 0) / 4294967296);
  let end = null;
  const down = (j, t, by, why) => {
    if (!alive[j]) return;
    alive[j] = false;
    downs.push({ i: j, t, by, why });
    events.push({ t, side: j, phase: 'down', say: why === 'shot down' ? 'Shot down' : 'Into the ground', by });
  };
  const ticks = Math.round(seconds / dt);
  for (let k = 0; k <= ticks; k++) {
    const t = k * dt;
    const states = planes.map(p => stateOf(p.state));
    for (let i = 0; i < n; i++) {
      const me = states[i];
      if (!alive[i]) { tracks[i].push({ ...tracks[i].at(-1), t, f: false, h: false, o: false, z: false, down: 1 }); continue; }
      const enemies = [], friends = [];
      for (let j = 0; j < n; j++) {
        if (j === i || !alive[j]) continue;
        (teams[j] === teams[i] ? friends : enemies).push({ i: j, state: states[j] });
      }
      const mem = pilots[i].mem;
      let out;
      if (!enemies.length) {
        out = { stick: { pitch: 0, roll: 0, rudder: 0 }, throttle: 1, fire: false, phase: 'clear', say: 'Nobody left', intent: 'setup', sees: true };
      } else {
        // The target: the plan's, else the nearest, kept unless another is a
        // third nearer.
        const cur = targets[i];
        const range = j => len(sub(states[j].position, me.position));
        const nearest = enemies.reduce((a, b) => (range(b.i) < range(a.i) ? b : a)).i;
        const wanted = Number.isInteger(mem.target) && alive[mem.target] && teams[mem.target] !== teams[i] ? mem.target : null;
        if (wanted !== null) cur.i = wanted;
        else if (cur.i < 0 || !alive[cur.i] || range(nearest) < SWITCH * range(cur.i)) cur.i = nearest;
        // His eyes on this enemy, kept apart from his eyes on the others.
        mem.eyes ??= {};
        mem.eye = mem.eyes[cur.i];
        const seen = x => ({ ...x, state: views[i].see(x.state) });
        out = pilots[i].step({ me: views[i].see(me), him: views[i].see(states[cur.i]), dt, t, groundAt: grounds[i], ceilingBase: 0, arena: fences[i], pace: fitted[i].pace,
                               team: { index: i, target: cur.i, friends: friends.map(seen), enemies: enemies.map(seen) } });
        mem.eyes[cur.i] = mem.eye;
      }
      applyStick(planes[i], out);
      // The rear gunner, on his own: the nearest enemy in his arc.
      if (sides[i].gunner && enemies.length) {
        const arc = { ...GUNNER, ...sides[i].gunner };
        const mem2 = pilots[i].mem;
        const seen = enemies.map(e => ({ e, a: inGunnerArc(me, e.state.position, arc) })).filter(x => x.a).sort((x, y) => x.a.d - y.a.d)[0];
        mem2.gunnerT = seen ? (mem2.gunnerT ?? 0) + dt : 0;
        if (seen && mem2.gunnerT >= arc.react) {
          const lp = leadPoint(me, seen.e.state, { speed: arc.speed });
          const j = (rand() - 0.5) * 2 * arc.spread * Math.PI / 180, j2 = (rand() - 0.5) * 2 * arc.spread * Math.PI / 180;
          const dir = unit(add(unit(sub(lp, me.position)), [j, j2, -j]));
          const v = add(me.velocity, scale(dir, arc.speed));
          const p0 = add(me.position, scale(dir, 4));
          rounds.push({ side: i, t, p: p0, start: p0, v, age: 0, done: false, hit: false, gunner: true });
          if (!mem2.gunnerFiring) events.push({ t, side: i, phase: 'gunner', say: 'The gunner opens fire', intent: 'defend' });
          mem2.gunnerFiring = true;
        } else mem2.gunnerFiring = false;
      }
      const him = targets[i].i >= 0 && alive[targets[i].i] ? states[targets[i].i] : null;
      const sol = him ? gunSolution(me, him, { ...guns[i], width: 5 }) : { fire: false, dist: Infinity, off: 180 };
      if (out.fire) rounds.push(fireRound(me, guns[i], rand, i, t, k));
      tracks[i].push({
        t, p: me.position, q: [me.orientation.x, me.orientation.y, me.orientation.z, me.orientation.w],
        v: len(me.velocity), ph: out.phase, f: out.fire, h: out.fire && sol.fire,
        e: energyHeight(me.position[1] - origin[1], len(me.velocity)),
        stick: [out.stick.pitch, out.stick.roll, out.stick.rudder, out.throttle],
        in: out.intent, o: sol.fire, z: sol.dist < guns[i].range && sol.off < 8,
        so: Math.round(sol.off * 10) / 10, sd: Math.round(sol.dist),
        rv: planes[i].rotorEngine ? Math.round(planes[i].rotorEngine.revs * 1000) / 1000 : null,
        sees: out.sees === false ? 0 : 1, target: targets[i].i,
      });
      if (out.phase !== lastPhase[i]) {
        events.push({ t, side: i, phase: out.phase, say: out.say, move: out.move, intent: out.intent });
        lastPhase[i] = out.phase;
      }
      if (me.position[1] - groundAt(me.position[0], me.position[2]) < 3) down(i, t, null, 'flew into the ground');
    }
    if (end === null) {
      const standing = [...new Set(teams.filter((_, j) => alive[j]))];
      if (standing.length < 2) end = { t, winner: standing[0] ?? null, why: standing.length ? 'the other side is down' : 'all down' };
    }
    if (end && t > end.t + 2.5) break;
    for (const [j, p] of planes.entries()) if (alive[j]) p.integrate(dt);
    const after = planes.map(p => stateOf(p.state));
    for (const r of rounds) {
      if (r.done) continue;
      const from = r.p;
      r.p = [from[0] + r.v[0] * dt, from[1] + r.v[1] * dt, from[2] + r.v[2] * dt];
      r.age += dt;
      for (let j = 0; j < n; j++) {
        if (j === r.side || !alive[j]) continue;
        if (segmentNear(from, r.p, after[j].position, HIT_RADIUS) && strikesAirframe(from, r.p, after[j])) {
          r.done = true; r.hit = true; r.hitT = t + dt; r.hitAt = r.p; r.target = j;
          hitsOn[j]++;
          hitsBy[r.side][j]++;
          if (hitsOn[j] >= killHits) down(j, t + dt, r.side, 'shot down');
          break;
        }
      }
      if (!r.done && r.age > (guns[r.side].reach ?? 600) / guns[r.side].speed) r.done = true;
    }
  }
  const first = downs.find(d => d.i === 0 || d.i === 1);
  const duelEnd = first ? { t: first.t, winner: first.by ?? 1 - first.i, why: first.why } : null;
  return { tracks, events, rounds, hits: hitsBy.map(row => row.reduce((a, b) => a + b, 0)), hitsOn, hitsBy, downs,
           end: duelEnd, teamEnd: end, dt, teams };
}
