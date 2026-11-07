// The pilots' eyes (features/dogfight-school/reviews/eyes.md) on their own.
// Run after the head of `dogfight_school_harness.mjs` (its imports, the
// Spitfire and `makePlane`), as `test_dogfight_eyes.py` joins them. Two
// planes stood in the sky by hand, then a few duels. Prints one JSON blob.
import { EYES, blind, sightLine, perceive } from './dogfight-pilot.js';

const EDT = 1 / 30;
const out = { eyes: { ...EYES } };
// A Spitfire flying level along -z at 60 m/s, wings level, at 500 m.
const LEVEL = { x: 0, y: 0, z: 0, w: 1 };
const me = { position: [0, 500, 0], velocity: [0, 0, -60], orientation: LEVEL, angularVelocity: [0, 0, 0] };
let flown = 0;
const deg = Math.PI / 180;
// A point `r` metres off my nose by `az` (0 ahead, to the right) and `el` up.
// I fly on along -z (`flown` metres so far), and he is placed off me.
const at = (az, el, r = 300) => [r * Math.cos(el * deg) * Math.sin(az * deg), 500 + r * Math.sin(el * deg), -flown - r * Math.cos(el * deg) * Math.cos(az * deg)];
const him = (p, v = [0, 0, -60]) => ({ position: p, velocity: v, orientation: LEVEL, angularVelocity: [0, 0, 0] });

// What the cockpit hides, by direction.
const dirs = {
  deadAstern: [180, 0], astern10: [170, 5], astern15Low: [165, -12], sixLow: [150, -10], belowWing: [90, -20],
  belowAhead: [45, -15], gunsightLow: [5, -12], abeam: [90, 0], aboveAbeam: [90, 30], overShoulderHigh: [150, 30],
  highAstern: [175, 45], ahead: [0, 0],
};
out.blind = Object.fromEntries(Object.entries(dirs).map(([k, [az, el]]) => {
  const s = sightLine(me, at(az, el));
  return [k, { az: +s.az.toFixed(1), el: +s.el.toFixed(1), blind: blind(s.az, s.el) }];
}));

// Fly the eyes tick by tick: `where(t)` puts him, `load` fakes my g.
function watch(seconds, where, { mem = { t: 0, rng: 1 }, load = 1 } = {}) {
  const log = [];
  for (let n = 0; n < Math.round(seconds / EDT); n++) {
    mem.t += EDT;
    flown += 60 * EDT;
    me.position = [0, 500, -flown];
    // A sideways push of `load` g on me: what the eyes read the load from.
    const side = load > 1 ? Math.sqrt(Math.max(0, (load * 9.80665) ** 2 - 14.7295379 ** 2)) : 0;
    mem.myV = [me.velocity[0] - side * EDT, me.velocity[1], me.velocity[2]];
    const e = perceive(mem, me, him(where(mem.t)), EDT);
    log.push({ t: +mem.t.toFixed(3), truth: where(mem.t), sees: e.sees, lost: e.lost, p: e.him.position.map(v => +v.toFixed(1)), glance: mem.eye.glancing });
  }
  return { log, mem };
}
const firstSeen = (log, after = 0) => log.find(k => k.t > after && k.sees)?.t ?? null;
const firstLost = log => log.find(k => k.lost)?.t ?? null;

// 1. Dead astern from the start: never seen; known, carried forward; lost
//    after `EYES.lose`.
{
  // He holds 300 m behind me, flying as I do; the estimate is carried on
  // along the velocity he had when last known.
  const { log } = watch(6, () => at(180, 0, 300));
  const k2 = log.find(k => k.t >= 2);
  out.astern = { seenEver: log.some(k => k.sees), lostAt: firstLost(log),
                 carriedOff: +Math.hypot(...k2.p.map((v, i) => v - k2.truth[i])).toFixed(1) };
}
// 2. Lost, then he comes out in front of me: noticed `EYES.notice` later.
{
  const mem = { t: 0, rng: 1 };
  watch(5, () => at(180, 0), { mem });
  const t0 = mem.t;
  const { log } = watch(3, () => at(30, 10), { mem });
  out.front = { lostBefore: firstLost(log) !== null && log[0].lost, appearsAt: +t0.toFixed(3), seenAt: firstSeen(log) };
}
// 3. Seen, slips behind the headrest for 1 s, comes out over my shoulder:
//    found again after `EYES.reacquire`, no glance needed.
{
  const mem = { t: 0, rng: 1 };
  watch(1, () => at(140, 10), { mem });
  const seenBefore = mem.eye.sees;
  watch(1, () => at(175, 0), { mem });
  const t0 = mem.t;
  const { log } = watch(1, () => at(140, 10), { mem });
  out.reacquire = { seenBefore, out: +t0.toFixed(3), seenAt: firstSeen(log) };
}
// 4. The scan: lost, he sits in my left rear quarter, level: I see him only
//    in a glance over my left shoulder, `EYES.notice` into it.
{
  const mem = { t: 0, rng: 1 };
  watch(5, () => at(180, 0), { mem });
  const { log } = watch(12, () => at(-130, 0), { mem });
  const k = log.find(x => x.sees);
  // The glance he was found in: how long it had run.
  let i = log.indexOf(k), into = 0;
  while (i > 0 && log[i - 1].glance === -1) { into += EDT; i--; }
  out.scan = { seenAt: k?.t ?? null, glanceThen: k?.glance ?? null, intoGlance: +into.toFixed(3), start: +(log[0].t - EDT).toFixed(3) };
}
// 5. The same in a 5 g turn: no glances, he is never found behind; up
//    through the canopy, in the turn, he is.
{
  const mem = { t: 0, rng: 1 };
  watch(5, () => at(180, 0), { mem });
  watch(1, () => at(180, 0), { mem, load: 5 });
  const { log } = watch(12, () => at(-130, 0), { mem, load: 5 });
  const mem2 = { t: 0, rng: 1 };
  watch(5, () => at(180, 0), { mem: mem2 });
  watch(1, () => at(180, 0), { mem: mem2, load: 5 });
  const up = watch(3, () => at(-130, 45), { mem: mem2, load: 5 });
  out.pulling = { rearSeen: log.some(k => k.sees), glances: log.some(k => k.glance !== 0), roofSeenAt: firstSeen(up.log), from: +(up.log[0].t - EDT).toFixed(3) };
}

// 6. Duels: a man flying straight with another closing from dead astern
//    never sees him (and so never breaks); one closing from his beam he does.
function duel(plans, behind, seconds = 12) {
  return runDuel({ makePlane, seconds, groundAt: () => 0, sides: [
    { plan: plans[0], start: { at: [0, 500, 0], headingDeg: 0, speed: 55 } },
    { plan: plans[1], start: behind },
  ] });
}
{
  const r = duel(['cruiser', 'cruiser'], { at: [0, 500, 600], headingDeg: 0, speed: 70 }, 8);
  out.duelAstern = { sees: r.tracks[0].map(k => k.sees), recorded: r.tracks.every(tr => tr.every(k => k.sees === 0 || k.sees === 1)),
                     phases: [...new Set(r.tracks[0].map(k => k.ph))] };
  const r2 = duel(['cruiser', 'cruiser'], { at: [500, 500, 0], headingDeg: -60, speed: 60 }, 4);
  out.duelBeam = { seenShare: r2.tracks[0].filter(k => k.sees).length / r2.tracks[0].length };
}
// 7. The guns: a man who has lost the other does not fire, even with him in
//    the gunsight, until he has noticed him.
{
  const r = runDuel({ makePlane, seconds: 3, groundAt: () => 0, sides: [
    { plan: 'chaser', start: { at: [0, 500, 0], headingDeg: 0, speed: 55 },
      // He lost him 4 s ago, flying where he is now (so the nose is already
      // on him), and is just back from a clearing turn.
      memory: { clearedAt: 0, eye: { sees: false, known: true, unseen: 4, look: 0, offset: 0, p: [0, 500, 70], v: [0, 0, -55], q: { x: 0, y: 0, z: 0, w: 1 } } } },
    { plan: 'cruiser', start: { at: [0, 500, -150], headingDeg: 0, speed: 55 } },
  ] });
  const fire = r.tracks[0].map(k => k.f);
  out.guns = { firstFire: r.tracks[0].find(k => k.f)?.t ?? null, firstSeen: r.tracks[0].find(k => k.sees)?.t ?? null,
               firedUnseen: r.tracks[0].some(k => k.f && !k.sees), anyFire: fire.some(Boolean) };
  // And in every lesson's demos, from their own starts: never a round fired
  // at a plane the pilot does not see.
  let ticks = 0, unseenFire = 0, unseen = 0;
  for (const L of LESSONS) for (const d of L.demos) {
    const rr = runDuel({ makePlane, seconds: d.seconds ?? L.seconds, groundAt: () => 0, sides: demoSides(L, d) });
    for (const tr of rr.tracks) for (const k of tr) { ticks++; if (k.f && !k.sees) unseenFire++; if (!k.sees) unseen++; }
  }
  out.demos = { ticks, unseenFire, unseenShare: +(unseen / ticks).toFixed(3) };
}
// 8. A pilot who has lost him turns to clear his tail, and finds him (the
//    man flying straight, `cruiser`, by design never looks; a climber does).
{
  const r = duel(['climbStraight', 'cruiser'], { at: [0, 500, 400], headingDeg: 0, speed: 56 }, 14);
  const A = r.tracks[0];
  const clearAt = A.find(k => k.ph === 'clear')?.t ?? null;
  const before = A.filter(k => clearAt !== null && k.t < clearAt && k.sees);
  out.clearing = { clearAt, lastSeen: before.length ? before[before.length - 1].t : 0,
                   seenAfter: clearAt === null ? null : A.find(k => k.t > clearAt && k.sees)?.t ?? null,
                   backToPlan: A.some(k => clearAt !== null && k.t > clearAt && k.ph === 'climb') };
}
console.log(JSON.stringify(out));
