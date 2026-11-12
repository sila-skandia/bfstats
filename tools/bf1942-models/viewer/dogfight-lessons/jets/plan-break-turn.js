// The plans break-turn needs on a jet (features/dogfight-lessons-jets,
// break-turn.md). In the Spitfire's units, like every plan: the duel shows a
// jet's pilot the fight at the Spitfire's size (`pilotView`).
import { PLANS, INTENTS, go, heading, climbing, turnToward } from '../../dogfight-pilot.js';
import { hardTurn, pointNose, pullLift, sub } from '../../dogfight-flight.js';

/** The zoom once they are past: degrees, and how long at most (s). */
const ZOOM_DEG = 70;
const ZOOM_FOR = 9;
/** How long over the top before the run (s). */
const OVER_FOR = 8;

/**
 * THE DIP ON A JET: the Spitfire's Dip (`btDip`), run level. Break into them
 * at once, until they have come past your tail (the range 20 m past its
 * least) or 10 s; up at 70 degrees (the roof levels it off); 8 s over the
 * top with the lift on them; then straight away from them at full throttle,
 * the nose on the horizon. `btDip` runs 8 degrees nose down, and a jet's
 * run is slower in the thicker air below: the hunter sits 500 to 550 m
 * behind, just inside the reach it gives up outside, and never lets go.
 * Level, you stay up where the air is thin and draw out past it.
 */
PLANS.jetBtDip = {
  title: 'Break, up, and away level', first: 'dip-break',
  says: {
    'dip-break': 'BREAK at once: hard into them before they are in reach',
    'dip-zoom': 'They are past: up out of their reach',
    'dip-over': 'Over the top, keeping my lift on them',
    'dip-out': 'Away from them, full throttle, the nose on the horizon: not down',
  },
  step(c) {
    const { me, him, g, mem } = c;
    if (mem.side === undefined) { mem.side = g.side; mem.minR = Infinity; }
    if (mem.phase === 'dip-break') {
      mem.minR = Math.min(mem.minR, g.range);
      if (!(g.range > mem.minR + 20 || mem.since > 10)) return { ...hardTurn(me, mem.side, { climb: 0, maxBank: 82, pull: 0.7 }), throttle: 1 };
      mem.zoomDir = heading(me.velocity);
      go(c, 'dip-zoom');
    }
    if (mem.phase === 'dip-zoom') {
      if (g.mySpeed > 52 && mem.since < ZOOM_FOR) return { ...pointNose(me, climbing(mem.zoomDir, ZOOM_DEG), { fine: 6, pull: 0.7 }), throttle: 1, aimed: false };
      go(c, 'dip-over');
    }
    if (mem.phase === 'dip-over') {
      if (mem.since < OVER_FOR) return { ...pullLift(me, sub(him.position, me.position), 1), throttle: 1, aimed: false };
      go(c, 'dip-out');
    }
    const away = heading(sub(me.position, him.position));
    return { ...turnToward(c, climbing(away, 0), { maxUp: 5, maxDown: 40 }), throttle: 1, aimed: false };
  },
};
INTENTS.jetBtDip = { 'dip-break': 'defend', 'dip-zoom': 'setup', 'dip-over': 'setup', 'dip-out': 'defend' };
