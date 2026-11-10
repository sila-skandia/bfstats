// The plans under-the-height needs on a jet (features/dogfight-lessons-jets,
// under-the-height.md).
//
// The lesson's boom-and-zoomer (`boomAndZoom`, and `uhAce` who also chases
// a runner) zooms at 35 degrees on the dive's speed until it is slow. A
// Spitfire is slow long before the top of the sky; a jet is not, and the
// zoom carried it over 1,000 m, where a wing makes nothing, to come down at
// 15 to 34 m/s. The jet's ace flies the same dives, zooms and wingovers,
// but levels every climb off under the roof (`dogfight-jet-ceiling.js`)
// and turns over the top there, still fast.

import { PLANS, INTENTS, go } from './dogfight-pilot.js';
import { atRoof, underRoof } from './dogfight-jet-ceiling.js';

function roofed(name) {
  const base = PLANS[name];
  return {
    ...base,
    says: { ...base.says, zoom: 'Zooming back up on the dive\'s speed, levelling off under the top of the sky' },
    step(c) {
      const { mem } = c;
      // The zoom is over once the roof holds it level: over the top from there.
      if (mem.phase === 'zoom' && mem.since > 1.5 && atRoof(c)) { mem.climbDeg = undefined; go(c, 'reverse'); }
      return underRoof(c, base.step(c));
    },
  };
}

/** `boomAndZoom` that never climbs into the top of the sky. */
PLANS.jetBoomAndZoom = roofed('boomAndZoom');
INTENTS.jetBoomAndZoom = { ...INTENTS.boomAndZoom };

/** `uhAce` (the boom-and-zoomer who chases a runner) the same. */
PLANS.jetUhAce = roofed('uhAce');
INTENTS.jetUhAce = { ...INTENTS.uhAce };
