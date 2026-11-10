// The plans under-the-height needs on a jet (features/dogfight-lessons-jets,
// under-the-height.md).
//
// The lesson's boom-and-zoomer (`boomAndZoom`, and `uhAce` who also chases
// a runner) zooms at 35 degrees on the dive's speed until it is slow. A
// Spitfire is slow long before the top of the sky; a jet is not. Every
// jet pilot's answer is kept under the roof (`stepPilot`, `underRoof` in
// `dogfight-jet-ceiling.js`), so the jet's ace is the same plan, told that
// its zoom is over once the roof holds it level: it turns over the top
// there, still fast, instead of waiting to be slow.

import { PLANS, INTENTS, go, heading, climbing, turnToward } from './dogfight-pilot.js';
import { atRoof, seenHeight } from './dogfight-jet-ceiling.js';
import { sub } from './dogfight-flight.js';

function roofed(name) {
  const base = PLANS[name];
  return {
    ...base,
    says: { ...base.says, zoom: 'Zooming back up on the dive\'s speed, levelling off under the top of the sky' },
    step(c) {
      const { mem } = c;
      // The zoom is over once the roof holds it level: over the top from there.
      if (mem.phase === 'zoom' && mem.since > 1.5 && atRoof(c)) { mem.climbDeg = undefined; go(c, 'reverse'); }
      return base.step(c);
    },
  };
}

/** `boomAndZoom` that turns over the top under the roof. */
PLANS.jetBoomAndZoom = roofed('boomAndZoom');
INTENTS.jetBoomAndZoom = { ...INTENTS.boomAndZoom };

/** `uhAce` (the boom-and-zoomer who chases a runner) the same. */
PLANS.jetUhAce = roofed('uhAce');
INTENTS.jetUhAce = { ...INTENTS.uhAce };

/**
 * THE DIP ON A JET: `uhDip`, run once level. On a Spitfire you climb
 * between their dives until the energy is yours, 50 m of it, and run. Under
 * the roof nobody gets 50 m: both planes end at the roof at the same speed,
 * so their edge is gone but yours never comes. So run once it is even
 * (`EVEN`, the Spitfire's metres), level with them, their nose more than
 * 90 degrees off you and them more than 120 degrees off your nose (the two
 * of you flying apart), the same way: straight away, full throttle, the
 * nose 2 degrees down. From over the roof, 5 degrees down until under
 * `UNDER` real metres first, out from under the roof (`roof: false`):
 * flown level up there, `underRoof` holds the nose and keeps a bank going
 * round, and a run begun in a turn turned back at them (0 of 9).
 * Also run, as `uhDip` does, with 50 m of energy on them.
 */
const EVEN = 10;
const UNDER = 780;
PLANS.jetUhDip = {
  ...PLANS.uhDip,
  step(c) {
    const { g, mem, me } = c;
    if (mem.phase !== 'dip-run' && mem.phase !== 'break' && g.energy < EVEN && g.above < 10
        && g.hisAta > 90 && g.ata > 120) go(c, 'dip-run');
    if (mem.phase !== 'dip-run') return PLANS.uhDip.step(c);
    const away = heading(sub(me.position, c.him.position));
    const over = me.position[1] > seenHeight(c, UNDER);
    const want = over ? -5 : me.position[1] < 110 ? (110 - me.position[1]) * 0.05 : -2;
    return { ...turnToward(c, climbing(away, want), { maxUp: 10, maxDown: 25 }), throttle: 1, ...(over ? { roof: false } : {}) };
  },
};
INTENTS.jetUhDip = { ...INTENTS.uhDip };
