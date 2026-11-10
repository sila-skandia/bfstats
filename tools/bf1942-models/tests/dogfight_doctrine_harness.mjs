// Boelcke's rules (`viewer/dogfight-doctrine.js`) on the dogfight school's
// own flown lessons, whose shapes are known. Run after the head of
// `dogfight_school_harness.mjs` (its imports, the Spitfire and `makePlane`),
// as `test_dogfight_doctrine.py` joins them. Prints, for each demo, both
// sides' attacks, bursts, dives met and the rules' verdicts; and the useful
// range of the mods' guns.
import { doctrineOf, usefulRange, damageAt, falloffOf, RULES } from './dogfight-doctrine.js';
import { movesOn, STARTS, nudge } from './dogfight-measure.js';
import { runFight } from './dogfight-fight.js';
import { fightSides } from './dogfight-lessons.js';

const DEMOS = ['boom-and-zoom/move', 'boom-and-zoom/counter', 'under-the-height/move', 'under-the-height/counter',
  'on-his-tail/move', 'out-of-the-lock/flat', 'break-turn/without', 'the-circle/circle', 'up-and-over/ninja'];
const r0 = v => Math.round(v);
const demos = {};
for (const key of DEMOS) {
  const [lid, did] = key.split('/');
  const L = LESSONS.find(l => l.id === lid), d = demoById(L, did);
  const sides = demoSides(L, d);
  const r = runDuel({ makePlane, seconds: d.seconds ?? L.seconds, groundAt: () => 0, sides });
  const gun = gunOf({ speed: 400, reach: 600, span: 2.5, converge: 1.6 });
  const doc = doctrineOf(r, { guns: [gun, gun] });
  demos[key] = {
    end: r.end, hits: r.hits,
    sides: doc.sides.map(s => ({
      useful: s.useful, sight: Math.round(s.sight * 100) / 100,
      attacks: s.attacks.map(a => ({ t0: a.t0, t1: a.t1, lead: a.lead, above: a.above, unseen: a.unseen, advantage: a.advantage,
        aspect: a.aspect, fired: a.fired, first: a.first, hits: a.hits, landed: a.landed, threatened: a.threatened, met: a.met, endedBy: a.endedBy, closest: a.closest, abandoned: a.abandoned })),
      bursts: s.bursts.map(b => ({ t0: b.t0, range: b.range, aspect: b.aspect, rounds: b.rounds, closeRounds: b.closeRounds, hits: b.hits, close: b.close })),
      dives: s.dives,
      rules: s.rules.map(v => ({ n: v.n, value: v.value === null ? null : Math.round(v.value * 100) / 100, kept: v.kept, words: v.words })),
    })),
  };
}
const guns = {
  vanilla: usefulRange(gunOf({ speed: 400, reach: 600, span: 2.5, converge: 1.6 })),
  bf1918: usefulRange({ range: 268, falloff: falloffOf({ distToStartLoseDamage: 100, distToMinDamage: 150, minDamage: 0.3 }) }),
  fhsw792: usefulRange({ range: 1000, falloff: falloffOf({ distToStartLoseDamage: 1, distToMinDamage: 510, minDamage: 0.1 }) }),
  fhsw20: usefulRange({ range: 1000, falloff: falloffOf({ distToStartLoseDamage: 1, distToMinDamage: 1000, minDamage: 0.001 }) }),
};
const damage = { bf1918at125: damageAt(125, { start: 100, end: 150, min: 0.3 }), bf1918at300: damageAt(300, { start: 100, end: 150, min: 0.3 }),
  none: damageAt(500, null) };
// The coach's Boelcke lines (`dogfight-coach.js`), from states built by
// hand: the nose runs down -z at the identity.
const at = (position, q = [0, 0, 0, 1], speed = 60) => {
  const o = { x: q[0], y: q[1], z: q[2], w: q[3] };
  const f = [-(2 * (o.x * o.z + o.w * o.y)), -(2 * (o.y * o.z - o.w * o.x)), -(1 - 2 * (o.x * o.x + o.y * o.y))];
  return { position, velocity: f.map(v => v * speed), orientation: o, angularVelocity: [0, 0, 0] };
};
const s15 = Math.sin(15 * Math.PI / 180), c15 = Math.cos(15 * Math.PI / 180), r2 = Math.SQRT1_2;
const bf1918 = { start: 100, end: 150, min: 0.3 };
const said = w => ({ line: w.line, rule: w.rule ?? null, tip: w.tip, ruleLine: w.ruleLine ? { line: w.ruleLine.line, rule: w.ruleLine.rule } : null,
  all: [w, ...w.others].map(l => l.line) });
const coachCases = {
  holdFire: said(coach(null, null, at([0, 500, 0]), at([0, 500, -220]), { useful: 136, falloff: bf1918 })),
  inRange: said(coach(null, null, at([0, 500, 0]), at([0, 500, -120]), { useful: 136, falloff: bf1918 })),
  noUseful: said(coach(null, null, at([0, 500, 0]), at([0, 500, -220]))),
  lostSight: said(coach(null, null, at([0, 500, 0]), at([0, 500, 400], [0, 0, 0, 1]), { offScreen: 3 })),
  noAdvantage: said(coach(null, null, at([0, 500, 0]), at([0, 500, -600], [0, 1, 0, 0]), { seen: true })),
  unseenNoLead: said(coach(null, null, at([0, 500, 0]), at([0, 500, -600], [0, 1, 0, 0]), { seen: false })),
  committed: said(coach(null, null, at([0, 800, 0], [-s15, 0, 0, c15], 70), at([0, 550, -500]), { seen: true })),
  fromSide: said(coach(null, null, at([0, 500, 0]), at([0, 500, -500], [0, -r2, 0, r2]))),
};
// The gunnery drill: the lesson's target against a chaser, 60 s.
const GL = LESSONS.find(l => l.id === 'gunnery');
const gr = runDuel({ makePlane, seconds: 60, groundAt: () => 0, sides: [
  { plan: GL.ace.plan, start: GL.ace.start, skill: 1 }, { plan: 'chaser', start: GL.you.start, skill: 0.9 }] });
const gdoc = doctrineOf(gr, { guns: [gunOf({}), gunOf({})] });
// Its pattern, flown with nobody near it.
const lone = runDuel({ makePlane, seconds: 60, groundAt: () => 0, sides: [
  { plan: GL.ace.plan, start: GL.ace.start, skill: 1 }, { plan: 'cruiser', start: { at: [2500, 300, 2500], headingDeg: 90, speed: 50 }, skill: 1 }] });
const gunnery = {
  targetRounds: gr.rounds.filter(r => r.side === 0).length, chaserRounds: gr.rounds.filter(r => r.side === 1).length, hits: gr.hits,
  phases: [...new Set(lone.events.filter(e => e.side === 0).map(e => e.phase))], loneRounds: lone.rounds.filter(r => r.side === 0).length,
  minY: Math.round(Math.min(...lone.tracks[0].map(k => k.p[1]))), maxY: Math.round(Math.max(...lone.tracks[0].map(k => k.p[1]))),
  speeds: [Math.round(Math.min(...lone.tracks[0].map(k => k.v))), Math.round(Math.max(...lone.tracks[0].map(k => k.v)))],
  chaserBursts: gdoc.sides[1].bursts.length, coachPhases: Object.keys(GL.coach),
};
// Every lesson's moves on the school's own Spitfire, as the theatre scores
// the airframe on stage: they must be the counts the lessons declare.
const onSpitfire = {};
for (const L of LESSONS) {
  const got = await movesOn(L, { makePlane, runDuel, demoSides });
  for (const [id, v] of Object.entries(got)) onSpitfire[`${L.id}/${id}`] = { works: v.works, declared: L.demos.find(d => d.id === id).verdict?.works ?? null };
}
// The falling leaf (rule 4), from the nine starts: the pilot who takes the
// fall for a kill, and the one who follows them down.
const leaf = {};
{
  const LL = LESSONS.find(l => l.id === 'falling-leaf');
  for (const id of ['move', 'counter']) {
    const d = LL.demos.find(x => x.id === id);
    leaf[id] = STARTS.map(st => {
      const sides = demoSides(LL, d);
      sides[1] = { ...sides[1], start: nudge(sides[1].start, st) };
      const r = runDuel({ makePlane, seconds: d.seconds ?? LL.seconds, groundAt: () => 0, sides });
      const fall = r.events.find(e => e.side === 0 && e.phase === 'fall')?.t ?? null;
      const after = r.tracks[1].filter(k => fall !== null && k.t > fall);
      const A = r.tracks[0].at(-1), B = r.tracks[1].at(-1);
      return { fall, recovered: r.events.some(e => e.side === 0 && e.phase === 'recover'),
        endRange: Math.round(Math.hypot(A.p[0] - B.p[0], A.p[1] - B.p[1], A.p[2] - B.p[2])),
        sight: after.length ? after.filter(k => k.sees).length / after.length : null,
        hitsAfter: r.rounds.filter(x => x.side === 1 && x.hit && fall !== null && x.t > fall).length,
        hisHits: r.rounds.filter(x => x.side === 0 && x.hit).length, down: r.end?.why === 'shot down' ? r.end.winner : null };
    });
  }
}
// The pair (rule 8), every fight from the nine starts, flown as the
// theatre flies it (`runFight` for a demo with planes beyond the two).
const pair = {};
{
  const LP = LESSONS.find(l => l.id === 'the-pair');
  for (const d of LP.demos) {
    pair[d.id] = STARTS.map(st => {
      const sides = fightSides(LP, d);
      sides[1] = { ...sides[1], start: nudge(sides[1].start, st) };
      const r = d.extra ? runFight({ makePlane, seconds: d.seconds ?? LP.seconds, groundAt: () => 0, sides })
        : runDuel({ makePlane, seconds: d.seconds ?? LP.seconds, groundAt: () => 0, sides: sides.slice(0, 2) });
      const on = r.hitsOn ?? [r.hits[1], r.hits[0]];
      return { youDown: r.end?.why === 'shot down' && r.end.winner !== 1 && r.end.winner !== 2 ? r.end.t : null,
        aceDown: !!r.downs?.some(x => x.i === 0), onYou: on[1], onAce: on[0], onWing: on[2] ?? null,
        phases: [...new Set(r.events.filter(e => e.side === 2).map(e => e.phase))] };
    });
  }
}
// The two-seater (rule 5, Mannock's rule), from the nine starts.
const twoSeater = {};
{
  const LT = LESSONS.find(l => l.id === 'two-seater');
  for (const d of LT.demos) {
    twoSeater[d.id] = STARTS.map(st => {
      const sides = fightSides(LT, d);
      sides[1] = { ...sides[1], start: nudge(sides[1].start, st) };
      const r = runFight({ makePlane, seconds: d.seconds ?? LT.seconds, groundAt: () => 0, sides });
      return { youDown: r.downs.some(x => x.i === 1), heDown: r.downs.some(x => x.i === 0), onYou: r.hitsOn[1], onHim: r.hitsOn[0],
        gunnerRounds: r.rounds.filter(x => x.gunner).length };
    });
  }
}
console.log(JSON.stringify({ demos, guns, damage, rules: RULES.map(r => r.n), coach: coachCases, gunnery, onSpitfire, leaf, pair, twoSeater }));
