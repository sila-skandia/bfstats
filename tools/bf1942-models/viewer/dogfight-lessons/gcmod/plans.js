// The plans Galactic Conquest's lessons fly (features/dogfight-lessons-gcmod),
// registered on `PLANS` and `INTENTS` (`dogfight-pilot.js`) as this loads.
// Imported by `dogfight-duel.js`, so every duel and fight has them; the
// lessons themselves (`index.js`) stay data.
//
// GCMOD's fighters carry lift engines wound backwards on the throttle
// (`X-WingVTOLEngine`, `TieFighterVTOLEngine`: `setAcceleration 0/0/-10000`
// clipped to 0..100): full reverse (S) winds the main engine down and spins
// the lift engines up, and the craft stands on them. That is the brake these
// plans use. They fly at the craft's own size (the lessons' sides say
// `pace: 1`), so their distances are real metres.
import { PLANS, INTENTS, go, heading, climbing, leadPursuit } from '../../dogfight-pilot.js';
import { pointNose, hardTurn } from '../../dogfight-flight.js';

/** Inside this, with them behind and closing, the brake goes on (m). */
export const BRAKE_AT = 260;
/** How long the brake is held at most (s). */
export const BRAKE_FOR = 8;
/** The break turn: from this far (judged, m), held at most this long (s). */
export const BREAK_AT = 300;
export const BREAK_FOR = 8;

const level = c => pointNose(c.me, climbing(c.mem.dir, 0), { fine: 6 });

/** Where they are, judged: the range and closure they had when last seen
 *  (the fight starts with both pilots aware, `perceive`), run on by the
 *  clock. Dead astern a craft's tail hides them (`EYES.tail`, 20 degrees)
 *  and the eyes lose them in 4 s (`EYES.lose`), but a pilot who saw a TIE
 *  450 m back closing at 22 m/s knows when it will be in reach. */
function judged(c) {
  const { g, mem } = c;
  if (g.sees || mem.r0 === undefined) { mem.r0 = g.range; mem.c0 = g.closure; mem.t0 = mem.t; }
  return mem.r0 - mem.c0 * (mem.t - mem.t0);
}
/**
 * RUN FOR IT: straight and level at full throttle with a TIE on your tail.
 * The TIE is the faster craft (108 m/s level to the X-Wing's 79): this is
 * the move the lesson is about.
 */
PLANS.swRun = {
  title: 'Run for it', first: 'run',
  says: { run: 'Full throttle, straight: outrun them' },
  step(c) {
    if (!c.mem.dir) c.mem.dir = heading(c.me.velocity);
    return { ...level(c), throttle: 1, aimed: false };
  },
};
INTENTS.swRun = { run: 'defend' };

/**
 * HIT THE BRAKES: fly on until they are close behind and closing (by the
 * range you last saw them at, run on by the clock: `judged`), then full
 * reverse with the nose held level, so the lift engines stand the craft on
 * the air and they fly past; once they are in front, full throttle after
 * them and the guns on them.
 */
PLANS.swBrake = {
  title: 'Hit the brakes', first: 'run',
  says: {
    run: 'Flying on: they are closing, and I know how fast',
    brake: 'Full reverse: the lift engines stand me on the air',
    chase: 'They flew right past: full throttle, guns on them',
  },
  step(c) {
    const { g, mem } = c;
    if (!mem.dir) mem.dir = heading(c.me.velocity);
    if (mem.phase === 'run') {
      const r = judged(c);
      if (g.ata > 120 && r < BRAKE_AT && mem.c0 > 0) go(c, 'brake');
      else return { ...level(c), throttle: 1, aimed: false };
    }
    if (mem.phase === 'brake') {
      if (g.ata < 90 || mem.since > BRAKE_FOR) go(c, 'chase');
      else return { ...level(c), throttle: -1, aimed: false };
    }
    return { ...leadPursuit(c), throttle: 1 };
  },
};
INTENTS.swBrake = { run: 'defend', brake: 'defend', chase: 'attack' };

/**
 * THE JOUST: straight at them, nose on them, guns from the moment the shot
 * bears, and through the pass without turning away.
 */
PLANS.swJoust = {
  title: 'Head-on', first: 'joust',
  says: { joust: 'Straight at them: guns' },
  step(c) {
    return { ...leadPursuit(c), throttle: 1 };
  },
};
INTENTS.swJoust = { joust: 'attack' };

/**
 * THE TIE PILOT'S ANSWER: no joust. Turn away before the X-Wing's guns
 * bear (they are 4 hits from going down and the X-Wing fires four times as
 * many bolts), out to the side at full throttle, and come back round onto
 * its tail with the speed the X-Wing cannot match.
 */
PLANS.swSlash = {
  title: 'Turn away and come back', first: 'away',
  says: {
    away: 'Not into those guns: off to the side, full throttle',
    back: 'Round onto their tail with my speed',
  },
  step(c) {
    const { g, mem, me } = c;
    if (mem.side === undefined) mem.side = g.side || 1;
    if (mem.phase === 'away') {
      // Out of the line until they are well to the side and behind.
      if (g.ata > 100 && mem.since > 4) go(c, 'back');
      else return { ...hardTurn(me, -mem.side, { climb: 0, maxBank: 70, pull: 0.6 }), throttle: 1, aimed: false };
    }
    return { ...leadPursuit(c), throttle: 1 };
  },
};
INTENTS.swSlash = { away: 'defend', back: 'attack' };


/**
 * TURN, DO NOT RACE: fly on until they are close behind and closing (judged,
 * as the brake is), then hard over at full throttle, the break turn, and
 * once they are in front the guns on them. A TIE is faster than an X-Wing
 * and brakes as well; it does not turn inside one that is turning hard.
 */
PLANS.swBreak = {
  title: 'Turn hard', first: 'run',
  says: {
    run: 'Flying on: they are closing, and I know how fast',
    turn: 'Hard over, full throttle: they cannot follow it round',
    chase: 'They are in front: guns on them',
  },
  step(c) {
    const { g, mem, me } = c;
    if (!mem.dir) mem.dir = heading(me.velocity);
    if (mem.phase === 'run') {
      if (judged(c) < (mem.breakAt ?? BREAK_AT) && mem.c0 > 0) { mem.side = g.side || 1; go(c, 'turn'); }
      else return { ...level(c), throttle: 1, aimed: false };
    }
    if (mem.phase === 'turn') {
      if ((g.ata < 60 && g.sees) || mem.since > BREAK_FOR) go(c, 'chase');
      else return { ...hardTurn(me, mem.side, { climb: 0, maxBank: 80, pull: 1 }), throttle: 1, aimed: g.ata < 30 };
    }
    return { ...leadPursuit(c), throttle: 1 };
  },
};
INTENTS.swBreak = { run: 'defend', turn: 'defend', chase: 'attack' };

/**
 * THE TIE PILOT'S OTHER ANSWER: off the line before the guns bear, then
 * straight away at full throttle, where the X-Wing (79 m/s level to the
 * TIE's 108) cannot follow.
 */
PLANS.swExtend = {
  title: 'Off the line and away', first: 'away',
  says: { away: 'Not into those guns: off the line', run: 'Full throttle away: they cannot catch me' },
  step(c) {
    const { g, mem, me } = c;
    if (mem.side === undefined) mem.side = g.side || 1;
    if (mem.phase === 'away') {
      if (g.ata > 150) { mem.runDir = heading(me.velocity); go(c, 'run'); }
      else return { ...hardTurn(me, -mem.side, { climb: 0, maxBank: 70, pull: 0.6 }), throttle: 1, aimed: false };
    }
    return { ...pointNose(me, climbing(mem.runDir, 0), { fine: 6 }), throttle: 1, aimed: false };
  },
};
INTENTS.swExtend = { away: 'defend', run: 'defend' };
