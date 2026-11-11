// The plans boom-and-zoom needs on a jet (features/dogfight-lessons-jets,
// boom-and-zoom.md). In the Spitfire's units, like every plan: the duel shows
// a jet's pilot the fight at the Spitfire's size (`pilotView`).

import { PLANS, INTENTS, go, heading, climbing, turnToward } from './dogfight-pilot.js';
import { clamp } from './dogfight-flight.js';

const DEG = Math.PI / 180;

/**
 * The moves' ace on a jet: `bzAceMeet`, who dives as soon as you are
 * `mem.perchDown` degrees under its horizon (30 for the Dip) instead of
 * waiting on its perch for 35 or for 10 s.
 *
 * Under the roof a jet's perch is 372 m over you, not the Spitfire's 512,
 * and `meetTheDive` climbs at up to 20 degrees, 30 m/s up at a jet's speed.
 * In three starts of nine (you 10 m higher or 3 m/s faster) that climb took
 * you up to them before they were 35 degrees over you: their perch timed out
 * 60 m above you, the dive pulled out at once, and with no dive coming
 * neither `meetTheDive` nor the Dip ever turned to face one.
 */
PLANS.jetBzAceMeet = {
  ...PLANS.bzAceMeet,
  says: {
    ...PLANS.bzAceMeet.says,
    climb: 'Climbing to get my height back',
    perch: 'Sitting high: picking the moment',
    dive: 'Diving on them: all the speed of the fall',
    evade: 'They are on my tail: breaking into them',
    'let-go': 'They are out of my reach and I am not closing: letting them go, back up to my perch',
    meet: 'They are coming at me: turning to face them',
  },
  step(c) {
    const { mem, g } = c;
    const lookDown = Math.asin(clamp(-g.los[1])) / DEG;
    if (mem.perchDown && mem.phase === 'perch' && lookDown > mem.perchDown) go(c, 'dive');
    return PLANS.bzAceMeet.step(c);
  },
};
INTENTS.jetBzAceMeet = { ...INTENTS.bzAceMeet };

/**
 * FLY IT's ace on a jet: `bzAce` (the lesson's ace with the school's one
 * give-up rule) diving the same way, as soon as you are `mem.perchDown`
 * degrees under its horizon. Over a level's own ground the Range starts the
 * perch lower still (338 m over you above Desert Shield's 40 m), and a
 * pilot who climbs to meet the dive was level with `bzAce` before it had
 * the 35 degrees it waits for: its perch timed out and no dive came.
 */
PLANS.jetBzAce = {
  ...PLANS.bzAce,
  step(c) {
    const { mem, g } = c;
    const lookDown = Math.asin(clamp(-g.los[1])) / DEG;
    if (mem.perchDown && mem.phase === 'perch' && lookDown > mem.perchDown) go(c, 'dive');
    return PLANS.bzAce.step(c);
  },
};
INTENTS.jetBzAce = { ...INTENTS.bzAce };

/** The climb, degrees, the jet Dip runs at: up to the top of the sky. */
const RUN_CLIMB = 3;

/**
 * THE DIP ON A JET: meet their first dive head on (`meetTheDive`), then
 * straight on out of the pass the way it left you, full throttle, climbing
 * 3 degrees. Not down low, where the Spitfire's Dip (`bzDip`) runs: the
 * flight law thins the air with height, and with it the drag, so a jet is
 * fastest at the top of the sky (128 m/s level at 770 m on the F-16, 93 at
 * 215 m). Low, they dive after you from their height and close; high, they
 * have no height over you to dive with, are never closing, and give the
 * chase up (`bzAce`'s let-go). Climbing 5 to 8 degrees reaches the top
 * sooner and is chased there level at your own speed instead
 * (boom-and-zoom.md, "The Dip").
 */
PLANS.jetBzDip = {
  title: 'Running for it', first: 'climb',
  says: {
    climb: 'Keeping speed, climbing shallow, watching them',
    face: 'They are diving: turning to face them',
    pass: 'Head on: make their pass short',
    extend: 'They zoomed: not following, speed first',
    'dip-run': 'Their zoom took them the other way: straight on, full throttle, up to the fast air',
  },
  step(c) {
    const { me, mem } = c;
    if (mem.phase === 'extend') { mem.runDir = heading(me.velocity); go(c, 'dip-run'); }
    if (mem.phase !== 'dip-run') return PLANS.meetTheDive.step(c);
    return { ...turnToward(c, climbing(mem.runDir, RUN_CLIMB), { maxUp: 10, maxDown: 20 }), throttle: 1 };
  },
};
INTENTS.jetBzDip = { ...INTENTS.bzDip };
