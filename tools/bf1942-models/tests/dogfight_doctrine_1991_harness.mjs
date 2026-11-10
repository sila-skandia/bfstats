// The jet age's rules (`viewer/dogfight-doctrine-1991.js`) on two jets in
// Desert Combat's own numbers, and the airframe measure
// (`viewer/dogfight-airframe.js`) on the school's Spitfire. Run after the
// head of `dogfight_school_harness.mjs` (its imports, the Spitfire and
// `makePlane`), as `test_dogfight_doctrine_1991.py` joins them.
import * as J from './dogfight-doctrine-1991.js';
import { measureAirframe, AIRFRAME } from './dogfight-airframe.js';

// A jet's node as the glb's extras give it: its armour on the root, a cannon
// on the fire key, a rack of missiles on the other, and a bomb rack that is
// neither.
const jetNode = ({ hp, rounds, missile, rack, racks }) => {
  const nodes = [
    { userData: { armor: { hitpoints: hp } } },
    { userData: { fireArms: { input: 'c_PIFire', velocity: 1000, roundOfFire: 20, magSize: rounds, numOfMag: 1,
      projectile: { template: '30mm_Projectile', kind: 'bullet', timeToLive: 5, damage: { radius: 3 } } } } },
    { userData: { fireArms: { input: 'c_PIFire', velocity: 20, roundOfFire: 3, magSize: 4,
      projectile: { template: 'Mk83Bomb', kind: 'shell', timeToLive: 20, damage: { radius: 20 } } } } },
    { userData: { fireArms: { input: 'c_PIAltFire', velocity: 500, roundOfFire: 3, magSize: rack, numOfMag: racks,
      projectile: { template: missile, kind: 'rocket', timeToLive: 20, damage: { radius: 8 } } } } },
  ];
  return { traverse: fn => nodes.forEach(fn) };
};
// What the page measured on the published tree's two jets (2026-11-10).
const f16Law = { level: 94.3, pull: [{ speed: 60, rate: 50.2, radius: 68 }, { speed: 100, rate: 80, radius: 72 }, { speed: 140, rate: 104.9, radius: 76 }],
  up: { stalls: false, at: null, gained: 705, speed: 79.7 } };
const migLaw = { level: 101.6, pull: [{ speed: 60, rate: 32, radius: 107 }, { speed: 100, rate: 59.5, radius: 96 }, { speed: 140, rate: 83.6, radius: 96 }],
  up: { stalls: false, at: null, gained: 703, speed: 75.1 } };
const f16 = J.jetOf(jetNode({ hp: 125, rounds: 500, missile: 'Aim9', rack: 8, racks: 2 }), 'F-16', f16Law);
const mig = J.jetOf(jetNode({ hp: 150, rounds: 500, missile: 'AA-10', rack: 6, racks: 2 }), 'MiG-29', migLaw);
const say = list => Object.fromEntries(list.map(r => [r.id, r.verdict]));
const rules = J.rulesOn({ you: f16, them: mig });

const spit = measureAirframe(makePlane);
console.log(JSON.stringify({
  ids: rules.map(r => r.id),
  sources: rules.every(r => r.source?.doc && /^https:\/\//.test(r.source.url)),
  quotes: rules.map(r => (r.quote ? r.quote.split(/\s+/).length : 0)),
  lessons: rules.map(r => (r.lesson ? [r.lesson[0], LESSONS.some(l => l.id === r.lesson[0] && (r.lesson[1] == null || demoById(l, r.lesson[1]))) ] : null)),
  boelcke: rules.map(r => r.boelcke),
  f16: { hp: f16.hp, gun: f16.gun, missile: f16.missile },
  verdicts: say(rules),
  asMig: say(J.rulesOn({ you: mig, them: f16 })),
  bare: Object.fromEntries(J.rulesOn({ you: J.jetOf(null, 'Spitfire'), them: J.jetOf(null, 'Bf 109') }).map(r => [r.id, r.verdict.status])),
  // A propeller fighter on the same card: it runs out of speed going up.
  prop: J.rulesOn({ you: { ...f16, name: 'Spitfire', law: spit }, them: mig }).find(r => r.id === 'energy').verdict,
  flown: { aim9: [0.5, 1, 2, 3, 5].map(t => Math.round(J.flown(J.LAB_FLIGHT.aim9, t))), aa10: [1, 2].map(t => Math.round(J.flown(J.LAB_FLIGHT.aa10, t))),
    speed: [J.speedAt(J.LAB_FLIGHT.aim9, 0), J.speedAt(J.LAB_FLIGHT.aim9, 1), J.speedAt(J.LAB_FLIGHT.aim9, 9)] },
  fight: { yours: J.FIGHT.yours, theirs: J.FIGHT.theirs, lesson: J.FIGHT.lesson, story: J.FIGHT.story.length, sources: J.FIGHT.sources.length,
    words: J.FIGHT.words({ you: { ...f16, name: 'F-15C' }, them: mig }) },
  card: J.CARD,
  spitfire: spit,
  airframe: AIRFRAME,
}));
