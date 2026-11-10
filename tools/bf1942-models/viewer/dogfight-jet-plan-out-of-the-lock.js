// The plans out-of-the-lock needs on a jet (features/dogfight-lessons-jets,
// out-of-the-lock.md).
//
// On the Spitfire the pilot who knows a hunter is coming in holds a gentle
// level turn toward them, 20 degrees of bank (`olLooking` in
// dogfight-pilot.js), which keeps the hunter over the shoulder and out of
// the cone the headrest hides until they are committed behind. A turn's
// rate is the bank over the speed: at a jet's speed the same 20 degrees
// turns the nose about three quarters as fast, the hunter slides into the
// cone from slightly wide of the tail, is lost, and comes in unseen. The
// jet's watchers hold the Spitfire's rate of turn instead, the bank eased
// until the nose turns as fast as 20 degrees turns a Spitfire at that speed
// (26 to 39 degrees on the F-16, 28 to 44 on the MiG-29: a rate, not a bank,
// so it fits any pace). Everything after the watch is the Spitfire's plan as
// it is.
import { PLANS, INTENTS, holdSpeed, heading } from './dogfight-pilot.js';
import { bankAndPull, clamp, angleBetween, G } from './dogfight-flight.js';

const DEG = Math.PI / 180;
/** The Spitfire's look turn: its bank, degrees. */
const SPIT_LOOK = 20;
/** The jet's: no shallower than the Spitfire's, no steeper than this. */
const JET_LOOK_MAX = 45;

function jetLookTurn(c) {
  const { me, g, mem } = c;
  const h = heading(me.velocity);
  if (mem.lookSide === undefined) {
    mem.lookSide = g.side; mem.lookY = me.position[1]; mem.lookV = g.mySpeed; mem.lookB = SPIT_LOOK;
    // The rate the Spitfire's 20 degrees turns it at this (Spitfire-sized) speed.
    mem.lookRate = G * Math.tan(SPIT_LOOK * DEG) / Math.max(20, g.mySpeed) / DEG;
  } else if (mem.lookH && c.dt > 0) {
    const rate = angleBetween(h, mem.lookH) / c.dt;
    mem.lookR = 0.9 * (mem.lookR ?? rate) + 0.1 * rate;
    // Once rolled in (a second), the bank eased until the rate is the Spitfire's.
    if (mem.t > 1) mem.lookB = clamp(mem.lookB + (mem.lookRate - mem.lookR) * 4 * c.dt, SPIT_LOOK, JET_LOOK_MAX);
  }
  mem.lookH = h;
  const pull = clamp(0.15 + (mem.lookY - me.position[1]) * 0.02 - me.velocity[1] * 0.08, -0.4, 1);
  return { ...bankAndPull(me, mem.lookSide * mem.lookB, pull), throttle: holdSpeed(c, mem.lookV) };
}

function jetLooking(name, title) {
  const base = PLANS[name];
  return { ...base, title,
    says: { ...base.says, watch: 'A turn toward them, enough to keep them in sight over my shoulder' },
    step(c) { const out = base.step(c); return c.mem.phase === 'watch' ? jetLookTurn(c) : out; } };
}

PLANS.jetOlHardTurn = jetLooking('lockHardTurn', 'Turning hard');
PLANS.jetOlChop = jetLooking('lockChop', 'Turn, then chop');
INTENTS.jetOlHardTurn = { ...INTENTS.olHardTurn };
INTENTS.jetOlChop = { ...INTENTS.olChop };
