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
import { stateOf, gunSolution, energyHeight, len, sub, add, scale, unit, rotate, leadPoint } from './dogfight-flight.js';
import { GUNNER, inArc, toBody } from './dogfight-gunners.js';
import { fireTicks } from './fire-timer.js';
import { placePlane, stage, applyStick, fireRound, segmentNear, strikesAirframe, fitAirframe, paced, pilotView, HIT_RADIUS, KILL_HITS, DUEL_DT } from './dogfight-duel.js';

/** A target is kept unless another enemy is this much nearer. */
const SWITCH = 0.67;

/** A gunner's wander and their gun's own cone, as one spread in radians:
 *  `GUNNER.spread` degrees, plus the FireArms' least deviation (hundredths
 *  of a radian, DEV-11). */
const spreadOf = gun => GUNNER.spread * Math.PI / 180 + (gun.deviation || 0) / 100;

/**
 * One tick of a plane's gunners (`side.gunners`, `dogfight-gunners.js`):
 * each fires at the nearest enemy inside its gun's own arc and `GUNNER.range`
 * of its muzzle, once it has had them there `GUNNER.react` seconds, at its
 * gun's own rate (whole ticks, GUN-13), with the lead its muzzle speed asks.
 * A round the rig could not lay (the lead carried it out of the arc) is not
 * fired. Each round carries its gunner (`gunner`, the index), its weapon
 * and its own life. Returns whether any of them fired.
 */
function gunnersTick({ gunners, mem, me, enemies, t, k, i, dt, rand, rounds }) {
  mem.gunners ??= gunners.map(() => ({ seen: 0, next: 0 }));
  let fired = false;
  for (const [gi, gun] of gunners.entries()) {
    const gm = mem.gunners[gi];
    const muzzle = add(me.position, rotate(me.orientation, gun.at));
    let best = null;
    for (const e of enemies) {
      const rel = sub(e.state.position, muzzle), d = len(rel);
      if (d > GUNNER.range || d < 1 || !inArc(gun, toBody(me.orientation, rel))) continue;
      if (!best || d < best.d) best = { e, d };
    }
    gm.seen = best ? gm.seen + dt : 0;
    if (!best || gm.seen < GUNNER.react || k < gm.next) continue;
    const lp = leadPoint({ position: muzzle, velocity: me.velocity }, best.e.state, { speed: gun.speed, gravity: gun.gravity });
    const w = spreadOf(gun);
    const dir = unit(add(unit(sub(lp, muzzle)), [(rand() - 0.5) * 2 * w, (rand() - 0.5) * 2 * w, (rand() - 0.5) * 2 * w]));
    if (!inArc(gun, toBody(me.orientation, dir))) continue;
    gm.next = k + fireTicks(gun.rate);
    rounds.push({ side: i, t, p: muzzle, start: muzzle, v: add(me.velocity, scale(dir, gun.speed)), age: 0, done: false, hit: false,
                  gunner: gi, weapon: gun.weapon, life: gun.life });
    fired = true;
  }
  return fired;
}

/**
 * Fly a fight. `sides` is `{ plan, start, skill, team, memory }` each (team
 * any value; equal is friendly), and may carry its own airframe (`make()`,
 * in place of `makePlane`) and its plane's gunners (`gunners`,
 * `dogfight-gunners.js`: a two-seater's rear gun, off its own model).
 * Returns `{ tracks, events, rounds, hits,
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
  const make = (side, i) => (sides[i]?.make ? sides[i].make() : makePlane(side, i));
  const planes = sides.map((side, i) => {
    const plane = make(side, i);
    const fit = fitted[i] = fitAirframe(plane, make, i);
    plane.groundHeight = (x, z) => groundAt(x, z);
    placePlane(plane, stage(origin, paced(side.start, fit.pace, origin[1])));
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
      // The plane's gunners, on their own: each the nearest enemy in its arc.
      if (sides[i].gunners?.length && enemies.length) {
        const mem2 = pilots[i].mem;
        const firing = gunnersTick({ gunners: sides[i].gunners, mem: mem2, me, enemies, t, k, i, dt, rand, rounds });
        if (firing && mem2.gunnerFiring === undefined) events.push({ t, side: i, phase: 'gunner', say: 'The gunner opens fire', intent: 'defend' });
        if (firing) mem2.gunnerFiring = t;
        else if (mem2.gunnerFiring !== undefined && t - mem2.gunnerFiring > 1) mem2.gunnerFiring = undefined;
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
      if (!r.done && r.age > (r.life ?? (guns[r.side].reach ?? 600) / guns[r.side].speed)) r.done = true;
    }
  }
  const first = downs.find(d => d.i === 0 || d.i === 1);
  const duelEnd = first ? { t: first.t, winner: first.by ?? 1 - first.i, why: first.why } : null;
  return { tracks, events, rounds, hits: hitsBy.map(row => row.reduce((a, b) => a + b, 0)), hitsOn, hitsBy, downs,
           end: duelEnd, teamEnd: end, dt, teams };
}
