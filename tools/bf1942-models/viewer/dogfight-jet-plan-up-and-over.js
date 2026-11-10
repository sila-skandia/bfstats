// The plans up-and-over needs on a jet (features/dogfight-lessons-jets/up-and-over.md).
//
// On a jet the up and over is not a trap: straight up, the F-16 holds 77 to
// 90 m/s all the way to the lift ceiling, and the pilot who pulls up out of
// your chase goes on up past 1,000 m, where a wing makes nothing, and falls
// back out of it 15 s later. The way out is not after them but under them.

import { PLANS, INTENTS, go, heading, climbing, leadPursuit, easedClimb } from './dogfight-pilot.js';
import { pointNose, sub, pitchOf } from './dogfight-flight.js';

/**
 * THE DIP, for a jet: the shot as they pull, then straight on under them.
 * Chase; when their nose comes up, hold a 25 degree climb on their bearing
 * for `shot` seconds (their climb carries them through your sight about 400
 * m out), then roll out on the heading you had and run, full throttle, the
 * nose 6 degrees down to level between 240 and 180 m. They are going up
 * into air too thin to turn in, and by the time they are back down you are
 * well over a kilometre away.
 */
PLANS.jetUoDip = {
  title: 'Under them, then away', first: 'chase',
  says: {
    chase: 'On their tail, closing',
    'dip-shot': 'They went nearly straight up: holding a shallow climb and taking the shot as they pull',
    'dip-run': 'Not after them: straight on under them, full throttle',
  },
  step(c) {
    const { me, him, g, mem } = c;
    switch (mem.phase) {
      case 'chase': {
        if (pitchOf(him.orientation) > 20 && him.velocity[1] > 5) { mem.runDir = heading(me.velocity); go(c, 'dip-shot'); }
        const k = g.range > c.gun.range + 60 ? pointNose(me, sub(him.position, me.position), { fine: 20 }) : leadPursuit(c);
        return { ...k, throttle: 1 };
      }
      case 'dip-shot': {
        if (mem.since > (mem.shot ?? 2.5)) go(c, 'dip-run');
        const toward = heading(sub(him.position, me.position));
        return { ...pointNose(me, climbing(toward, easedClimb(c, 25, 20)), { fine: 6 }), throttle: 1 };
      }
      case 'dip-run': {
        const y = me.position[1];
        const angle = y > 240 ? -6 : y > 180 ? -6 * (y - 180) / 60 : 0;
        return { ...pointNose(me, climbing(mem.runDir ?? heading(me.velocity), angle), { fine: 8 }), throttle: 1 };
      }
      default: go(c, 'chase');
    }
    return null;
  },
};
INTENTS.jetUoDip = { chase: 'attack', 'dip-shot': 'attack', 'dip-run': 'defend' };
