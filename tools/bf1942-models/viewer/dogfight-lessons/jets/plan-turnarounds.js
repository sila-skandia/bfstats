// The plans turnarounds needs on a jet (features/dogfight-lessons-jets,
// turnarounds.md): the lesson's two aces, `turnarounds` and `taAce`, with an
// Immelmann a jet can fly under the roof.
//
// Every jet pilot flies under a roof (`dogfight-jet-ceiling.js` `underRoof`,
// 800 m real). It leaves a loop alone when the loop's top, read from the
// pitch rate already under way, is under the roof; at the start of a fast
// pull the rate has not built yet, so the top reads high, the cap keeps the
// rate from building, and the loop never begins: the MiG-29's Immelmann from
// 456 m at 119 m/s climbed straight ahead for the rest of the fight. So the
// jet aces say for themselves whether their loop fits:
//
// - Pulled up under `LOOP_UNDER` (530 m real), the half loop and the roll
//   out on top are flown with `roof: false`. Flown with no roof from a level
//   start at full throttle, a loop from 538 m tops out at 702 to 716 m on
//   the F-16 and one from 525 m at 752 to 777 m on the MiG-29 (from 540 m:
//   776 to 805 m), so from under 530 m every one tops out under 800 m on
//   both jets.
// - Higher, the loop would go through the roof, so it is not started: the
//   plan has no other way round for a fast pilot (its split-S needs them slow),
//   so they turn round flat, as hard as the jet turns, toward you, and come
//   back at you (`attack`).
//
// The lesson's other plans (the seats) do not loop and are flown as written.

import { PLANS, INTENTS, go, heading } from '../../dogfight-pilot.js';
import { hardTurn, dot } from '../../dogfight-flight.js';
import { seenHeight } from '../../dogfight-jet-ceiling.js';

const DEG = Math.PI / 180;

/** The highest a jet ace starts an Immelmann from (real metres): under it,
 *  the loop tops out under the roof on the F-16 and the MiG-29. */
export const LOOP_UNDER = 530;

/** The phases of a loop under way, flown with no roof. */
const LOOPING = ['immelmann', 'rollout'];

function jetLoop(name) {
  const base = PLANS[name];
  return {
    ...base,
    says: { ...base.says, turn: 'Too high for a half loop under the top of the sky: turning round flat, toward him' },
    step(c) {
      const { me, g, mem } = c;
      if (mem.phase === 'turn') {
        // Round until the nose is on him or the heading has come round.
        if (g.ata < 30 || dot(heading(me.velocity), mem.h0) < Math.cos(170 * DEG)) go(c, 'attack');
        else return { ...hardTurn(me, mem.turnSide), throttle: 1 };
      }
      const was = mem.phase;
      const out = base.step(c);
      if (mem.phase === 'immelmann' && was !== 'immelmann' && me.position[1] > seenHeight(c, LOOP_UNDER)) {
        mem.turnSide = g.side || 1;
        go(c, 'turn');
        return { ...hardTurn(me, mem.turnSide), throttle: 1 };
      }
      return out && LOOPING.includes(mem.phase) ? { ...out, roof: false } : out;
    },
  };
}

/** The lesson's ace (`turnarounds`) with a jet's Immelmann. */
PLANS.jetTurnarounds = jetLoop('turnarounds');
INTENTS.jetTurnarounds = { ...INTENTS.turnarounds, turn: 'setup' };

/** The Dip's, Flip's and Ninja's ace, and FLY IT's (`taAce`), the same. */
PLANS.jetTaAce = jetLoop('taAce');
INTENTS.jetTaAce = { ...INTENTS.taAce, turn: 'setup' };
