// The plans up-and-over needs on a jet (features/dogfight-lessons-jets/up-and-over.md).
//
// A jet does not run out of speed going up: straight up, the F-16 holds 77
// to 90 m/s all the way to the lift ceiling. The lesson's ace, flying the
// Spitfire's plan, waited for a slow top that never came and went on past
// 1,000 m, where a wing makes nothing. The jet's ace (below) goes over the
// top while the air still holds it, and comes straight back down at you.

import { PLANS, INTENTS, go, heading, climbing, leadPursuit, easedClimb, turnToward } from './dogfight-pilot.js';
import { pointNose, sub, add, unit, pitchOf } from './dogfight-flight.js';
import { seenHeight, atRoof } from './dogfight-jet-ceiling.js';

/**
 * THE DIP, for a jet: the shot as they pull, past them as they come down,
 * then away. Chase; when their nose comes up, climb after them at 25
 * degrees on their bearing (their climb carries them through your sight
 * about 400 m out: the shot), never into their climb; as they come back
 * over the top at you, past them, beside and under their dive (80 m to the
 * side away from theirs, 30 m under); then full throttle straight away from
 * them, the nose 6 degrees down to level between 240 and 180 m. Their loop
 * points them back the way they came while you go on.
 */
PLANS.jetUoDip = {
  title: 'Past them, then away', first: 'chase',
  says: {
    chase: 'On their tail, closing',
    'dip-shot': 'They pulled up: climbing after them at 25 degrees, not into their climb, and taking the shot as they pull',
    'dip-pass': 'They are coming back over the top: past them, beside and under their dive',
    'dip-run': 'Full throttle, straight away from them',
  },
  step(c) {
    const { me, him, g, mem } = c;
    switch (mem.phase) {
      case 'chase': {
        if (pitchOf(him.orientation) > 20 && him.velocity[1] > 5) go(c, 'dip-shot');
        const k = g.range > c.gun.range + 60 ? pointNose(me, sub(him.position, me.position), { fine: 20 }) : leadPursuit(c);
        return { ...k, throttle: 1 };
      }
      case 'dip-shot': {
        const over = pitchOf(him.orientation) < 30 && him.velocity[1] < 5 && mem.since > 3;
        const pounce = g.hisAta < 35 && g.range < 350 && g.closure > 5 && him.velocity[1] < 0;
        if (pounce || over) { mem.passSide = -g.side; go(c, 'dip-pass'); }
        const toward = heading(sub(him.position, me.position));
        return { ...pointNose(me, climbing(toward, easedClimb(c, mem.climb ?? 25, 20)), { fine: 6 }), throttle: 1 };
      }
      case 'dip-pass': {
        if (mem.since > 1.5 && (g.ata > 100 || g.closure < 0)) go(c, 'dip-run');
        const los = unit(sub(him.position, me.position));
        const across = unit([-los[2], 0, los[0]]), off = 80 * (mem.passSide ?? 1);
        return { ...pointNose(me, sub(add(him.position, [across[0] * off, -30, across[2] * off]), me.position), { fine: 8 }), throttle: 1 };
      }
      case 'dip-run': {
        const y = me.position[1];
        const angle = y > 240 ? -6 : y > 180 ? -6 * (y - 180) / 60 : 0;
        if (g.range > 150 || !mem.runDir) mem.runDir = heading(sub(me.position, him.position));
        return { ...pointNose(me, climbing(mem.runDir, angle), { fine: 8 }), throttle: 1 };
      }
      default: go(c, 'chase');
    }
    return null;
  },
};
INTENTS.jetUoDip = { chase: 'attack', 'dip-shot': 'attack', 'dip-pass': 'defend', 'dip-run': 'defend' };

// --- the ace on a jet --------------------------------------------------------
//
// `upAndOver` (and `uoAce`, `uoAceSharp` over it) pulls straight up until it
// is down to the speed a Spitfire's half loop needs, 46 m/s at the
// Spitfire's size. A jet never gets that slow going up: it went on to 1,180
// m, past where a wing makes anything, and wallowed back down at 15 to 60
// m/s, full aft stick and no air. The jet's ace goes over the top while the
// air still holds it (`OVER_AT` real metres), turns over the top of a climb
// the roof has levelled in a wingover, not a loop, and never hangs: slow and
// not diving, the nose goes down until the speed is back.
//
// Every jet pilot's answer goes under the roof in `stepPilot`
// (`dogfight-jet-ceiling.js` `underRoof`), so this plan no longer puts its
// own answers under it. The roof caps how hard a pull goes toward the sky
// and takes the throttle off a nose well over the climb it allows; it leaves
// a loop that fits under it, and an inverted plane, alone. The plan opts out
// (`roof: false`) where that still spoils what it means to do:
//   - the pull, which ends at `OVER_AT`, under the roof anyway. Capped, the
//     MiG-29's pull reaches only 44 degrees and its Dip works 3 of 9; left
//     alone it pulls to 53 degrees and loops over at 775 m. The F-16's pull
//     reaches 72 degrees either way.
//   - the loop, from `over`.
//   - the recovery, nose 35 degrees down at full throttle: with the throttle
//     off the F-16 ace fell to 33 m/s, out of the roof never under 44.
// And the zoom back up off a pounce climbs at `ZOOM_MAX` at most: a pounce
// up at you pitched the F-16 to 74 degrees at 600 m, too steep for the thin
// air to bring back, and the ace either climbed on to 1,154 m (full throttle)
// or hung at 9 m/s (the roof's throttle off).

/** The real height the pull goes over the top at, metres (`mem.overAt`,
 *  also real metres: it is where the air is, not a size of the fight). */
const OVER_AT = 550;
/** Under this (the Spitfire's size, m/s) the jet ace unloads and dives. */
const JET_SLOW = 45;
/** ... and pulls again once back over this. */
const JET_AGAIN = 60;
/** The steepest the zoom back up off a pounce climbs, degrees. */
const ZOOM_MAX = 35;
const RECOVER = 'Too slow: nose down for speed';

function jetUp(name) {
  const base = PLANS[name];
  return {
    ...base,
    says: { ...base.says,
      pull: 'Nearly straight up, but not into the thin air',
      over: 'Over the top while the air still holds me, back toward them' },
    step(c) {
      const { me, mem } = c;
      const y = me.position[1], pitch = pitchOf(me.orientation), overAt = mem.overAt ?? OVER_AT;
      if (mem.phase === 'pull' && y >= seenHeight(c, overAt)) { mem.climbDeg = undefined; go(c, 'over'); }
      if (mem.phase === 'zoom' && mem.since > 1 && atRoof(c, 6)) { mem.climbDeg = undefined; go(c, 'over'); }
      // Slow and not diving: no loop, no turn, the nose down until fast again.
      const loose = ['over', 'pounce', 'zoom'];
      if (loose.includes(mem.phase) && c.g.mySpeed < JET_SLOW && pitch > -25) mem.jetSlow = true;
      if (mem.jetSlow && c.g.mySpeed > JET_AGAIN) mem.jetSlow = false;
      const out = base.step(c);
      if (mem.jetSlow && loose.includes(mem.phase)) {
        return { ...pointNose(me, climbing(heading(me.velocity), -35), { fine: 10, push: 0.7 }), throttle: 1, aimed: false, say: RECOVER, roof: false };
      }
      if (mem.phase === 'pull') return { ...out, roof: false };
      if (mem.phase !== 'over') mem.jetLoop = undefined;
      // Back up off the pounce, no steeper than `ZOOM_MAX`.
      if (mem.phase === 'zoom' && pitch > ZOOM_MAX) return { ...out, ...pointNose(me, climbing(heading(me.velocity), ZOOM_MAX), { fine: 6 }) };
      if (mem.phase !== 'over') return out;
      // A steep climb no higher than the pull's goes over the top in the
      // loop; any other turns back to them level or nose down (the shared
      // roof over it).
      mem.jetLoop ??= pitch >= 45 && y <= seenHeight(c, overAt + 60);
      if (mem.jetLoop) return { ...out, roof: false };
      const to = sub(c.him.position, me.position);
      return { ...turnToward(c, to, { maxUp: 25, maxDown: 45 }), throttle: 1 };
    },
  };
}

/** `upAndOver`, `uoAce` and `uoAceSharp` on a jet. */
PLANS.jetUpAndOver = jetUp('upAndOver');
PLANS.jetUoAce = jetUp('uoAce');
PLANS.jetUoAceSharp = jetUp('uoAceSharp');
INTENTS.jetUpAndOver = { ...INTENTS.upAndOver };
INTENTS.jetUoAce = { ...INTENTS.uoAce };
INTENTS.jetUoAceSharp = { ...INTENTS.uoAceSharp };
