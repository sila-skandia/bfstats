// The plans break-turn needs on a jet (features/dogfight-lessons-jets,
// break-turn.md). In the Spitfire's units, like every plan: the duel shows a
// jet's pilot the fight at the Spitfire's size (`pilotView`).
import { PLANS, INTENTS, go, heading, climbing, turnToward } from './dogfight-pilot.js';
import { hardTurn } from './dogfight-flight.js';

/** Down to this height (the Spitfire's size; 512 m real on the F-16) the
 *  run goes `RUN_DOWN` degrees nose down, and level under it. */
const RUN_FLOOR = 400;
const RUN_DOWN = 6;

/**
 * THE DIP ON A JET: break, and once they are past, not up but straight on.
 * Break into them at once, as `btDip` does, until they have come past your
 * tail (the range 20 m past its least) or 10 s; then wings level, full
 * throttle, on the heading you are flying as they go by, nose 6 degrees
 * down to `RUN_FLOOR` and level. Their turn after you is slow and goes up
 * toward the top of the sky; by the time their nose is round you are out of
 * their reach and not being caught, and they let you go.
 */
PLANS.jetBtDip = {
  title: 'Break, then straight on', first: 'dip-break',
  says: {
    'dip-break': 'BREAK at once: hard into them before they are in reach',
    'dip-out': 'They are past: not up, not after them. Straight on, full throttle, out of here',
  },
  step(c) {
    const { me, g, mem } = c;
    if (mem.side === undefined) { mem.side = g.side; mem.minR = Infinity; }
    if (mem.phase === 'dip-break') {
      mem.minR = Math.min(mem.minR, g.range);
      if (!(g.range > mem.minR + 20 || mem.since > 10)) return { ...hardTurn(me, mem.side, { climb: 0, maxBank: 82, pull: 0.7 }), throttle: 1 };
      mem.runDir = heading(me.velocity);
      go(c, 'dip-out');
    }
    const down = me.position[1] > RUN_FLOOR ? RUN_DOWN : 0;
    return { ...turnToward(c, climbing(mem.runDir, -down), { maxUp: 0, maxDown: 12 }), throttle: 1, aimed: false };
  },
};
INTENTS.jetBtDip = { 'dip-break': 'defend', 'dip-out': 'defend' };
