// The plans on-his-tail needs on a jet (features/dogfight-lessons-jets,
// on-his-tail.md). In the Spitfire's units, like every plan: the duel shows a
// jet's pilot the fight at the Spitfire's size (`pilotView`).
import { PLANS, INTENTS, go, heading, climbing, turnToward } from '../../dogfight-pilot.js';

/**
 * THE DIP ON A JET: never into their circle. In behind them at their speed
 * and a little more (`otDip`'s run-in) and, the moment they break, straight
 * on: wings level, full throttle, nose 6 degrees down to 140 m and level.
 * A jet's one-barrel cannon has no crossing point, so its pilot opens fire
 * inside 400 m at the Spitfire's size (512 m real), not 268; the Spitfire's
 * moment to leave, when they are across their circle going away, puts you
 * 250 m in front of them and inside it. At the break you are 20 to 35 m/s
 * faster than them and they turn toward you: you go past them while they
 * come round, and by the time their nose finds you, you are out of reach.
 */
PLANS.jetOtLeave = {
  title: 'Not into their circle', first: 'close',
  says: {
    close: 'Closing on their tail at their speed',
    circle: 'Closing on their tail at their speed',
    'dip-out': 'They broke: not after them into their turn. Straight on, full throttle, out of here',
  },
  step(c) {
    const { me, mem } = c;
    if (mem.phase !== 'dip-out') {
      // `otDip` flies the run-in and notes the break (`brokeAt`).
      const out = PLANS.otDip.step(c);
      if (mem.brokeAt === undefined) return out;
      mem.runDir = heading(me.velocity);
      go(c, 'dip-out');
    }
    return { ...turnToward(c, climbing(mem.runDir, c.agl > 140 ? -6 : 0), { maxUp: 0, maxDown: 8 }), throttle: 1 };
  },
};
INTENTS.jetOtLeave = { close: 'attack', circle: 'attack', 'dip-out': 'defend' };
