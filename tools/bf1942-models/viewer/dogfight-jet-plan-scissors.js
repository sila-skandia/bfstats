// The plans scissors needs on a jet (features/dogfight-lessons-jets/scissors.md).
import { PLANS, INTENTS, heading, climbing, go, leadPursuit, turnToward } from './dogfight-pilot.js';
import { clamp, dot, add, scale, sub, unit, hardTurn, pointNose, leadPoint, angleBetween } from './dogfight-flight.js';

const DEG = Math.PI / 180;

/** What the jet plans say, phase by phase (the school's words, they/them). */
const SAYS = {
  reverse: 'Turning into them as our paths cross: slow, the reversal started early',
  cross: 'We crossed: reverse, back into them',
  shoot: 'They drifted out in front of me',
  chase: 'They are leaving the scissors: after them, full throttle',
  'let-go': 'They are out of my reach and I am not closing: letting them go',
  meet: 'They are coming back at me: turning to face them',
  climb: 'They are above me: climbing for height, not turning flat under them',
  face: 'They are diving at me: turning to face them',
  snap: 'They are hanging slow over me: nose up at them for a shot',
  'dip-run': 'Out at the crossing: no reversal, full throttle, a shallow dive away from them',
  'flip-reverse': 'Throttle back: flying the scissors slower than them, so they drift out in front',
  'flip-cross': 'We crossed, still slower than them: reverse, back into them',
  'flip-shoot': 'They drifted out in front of me',
};
const saysOf = plan => Object.fromEntries(Object.keys(PLANS[plan].says ?? {}).map(k => [k, SAYS[k] ?? PLANS[plan].says[k]]));

/**
 * THE FLAT SCISSORS ON A JET: the school's scissors (`PLANS.scissors`) flown
 * with a nose that answers late. The reversal and the roll-out are flown on
 * where the heading will be `mem.lead` seconds on, not where it is.
 * Memory: `swing` the weave's angle off the axis, `cap` the most the
 * heading may swing before the turn comes back, `lead` seconds, `band`
 * [low, high] the speed the throttle holds (Spitfire m/s), `fast` full.
 */
PLANS.jetScissors = {
  ...PLANS.scissors,
  says: saysOf('scissors'),
  step(c) {
    const { me, him, g, mem, dt } = c;
    const swing = mem.swing ?? 60, cap = mem.cap ?? 100, lead = mem.lead ?? 0;
    if (!mem.axis) mem.axis = heading(me.velocity);
    const axis = mem.axis, right = [-axis[2], 0, axis[0]];
    const rel = sub(him.position, me.position);
    const across = dot(rel, right);
    const h = heading(me.velocity);
    const off = Math.atan2(dot(h, right), dot(h, axis)) / DEG;
    const step = dt || 1 / 30;
    const rate = mem.jetOff === undefined ? 0 : clamp((off - mem.jetOff) / step, -60, 60);
    mem.jetOff = off;
    mem.jetRate = (mem.jetRate ?? 0) + (rate - (mem.jetRate ?? 0)) * Math.min(1, step / 0.3);
    const soonOff = off + mem.jetRate * lead;
    const ahead = dot(rel, axis);
    if (ahead > 50 && g.ata < 30 && g.hisAta > 90 && g.range < 350) go(c, 'shoot');
    if (mem.phase === 'shoot') {
      if (g.ata > 60 || ahead < 20) go(c, 'reverse');
      else return { ...leadPursuit(c), throttle: mem.fast ? 1 : g.closure > 4 ? -0.4 : 0.6 };
    }
    if (mem.side === undefined) mem.side = Math.sign(across) || 1;
    const want = Math.abs(across) > 6 ? Math.sign(across) : mem.side;
    if (want !== mem.side && mem.since > 0.8) { mem.side = want; go(c, 'cross'); }
    if (soonOff * mem.side > cap) { mem.side = -mem.side; go(c, 'cross'); }
    if (mem.phase === 'cross' && mem.since > 0.8) go(c, 'reverse');
    if (mem.y0 === undefined) mem.y0 = me.position[1];
    const spare = clamp((g.mySpeed - 30) / 4, 0, 1);
    const lift = clamp((mem.y0 - me.position[1]) * 0.15 - me.velocity[1] * 1.2, -4, 14) * spare - 3 * (1 - spare);
    const a = mem.side * swing * DEG;
    const goal = add(scale(axis, Math.cos(a)), scale(right, Math.sin(a)));
    // The error on where the heading will be once the nose has answered.
    const err = Math.atan2(dot(h, [-goal[2], 0, goal[0]]), dot(h, goal)) / DEG + mem.jetRate * lead;
    const k = Math.abs(err) > 12
      ? hardTurn(me, -Math.sign(err), { climb: lift * 0.6, maxBank: 72 })
      : pointNose(me, climbing(goal, lift), { fine: 12 });
    const v = g.mySpeed;
    const dv = mem.lastV === undefined ? 0 : (v - mem.lastV) / step;
    mem.lastV = v;
    const soon = v + dv * 2;
    const [lo, hi] = mem.band ?? [38, 42];
    const throttle = mem.fast ? 1 : soon > hi ? -1 : soon < lo ? 1 : 0;
    return { ...k, throttle };
  },
};
INTENTS.jetScissors = { ...INTENTS.scissors };

/**
 * THE SCISSORS ACE ON A JET: `PLANS.scAce` (chase a pilot who leaves, give
 * up a chase that does not close, meet one who comes back), its scissors
 * flown as `jetScissors`.
 */
PLANS.jetScAce = {
  ...PLANS.scAce,
  says: saysOf('scAce'),
  step(c) {
    const { me, him, g, mem } = c;
    if (!mem.axis) mem.axis = heading(me.velocity);
    const away = g.hisAta > 110;
    const left = g.range > (mem.leftAt ?? 230) || (angleBetween(heading(him.velocity), mem.axis) > 110 && away)
      || (him.velocity[1] < -8 && away && g.range > 120);
    if (left && !['chase', 'let-go', 'meet'].includes(mem.phase)) { go(c, 'chase'); mem.closing = 0; }
    if (mem.phase === 'chase') {
      mem.closing += (g.closure - mem.closing) * Math.min(1, c.dt / 3);
      if (mem.since > 6 && g.range > c.gun.range + 30 && mem.closing < 0.5) {
        go(c, 'let-go');
        mem.home = scale(heading(me.velocity), -1);
      } else {
        return { ...turnToward(c, sub(leadPoint(me, him, c.gun), me.position), { maxUp: 20, maxDown: 50 }), throttle: 1 };
      }
    }
    if (mem.phase === 'let-go' && g.hisAta < 40 && g.range < 800 && g.closure > 5) go(c, 'meet');
    if (mem.phase === 'meet') {
      if (g.ata > 150 && g.range > 150) go(c, 'chase');
      return { ...turnToward(c, sub(leadPoint(me, him, c.gun), me.position), { maxUp: 15, maxDown: 30 }), throttle: 1 };
    }
    if (mem.phase === 'let-go') {
      return { ...turnToward(c, climbing(mem.home, 15), { maxUp: 15, maxDown: 5 }), throttle: 1, aimed: false };
    }
    return PLANS.jetScissors.step(c);
  },
};
INTENTS.jetScAce = { ...INTENTS.scAce };

/** `PLANS.scClimber` (climb under a pilot above, face a dive, snap at a
 *  hanging one) over `jetScAce`. */
PLANS.jetScClimber = {
  ...PLANS.scClimber,
  says: saysOf('scClimber'),
  step(c) {
    const { me, him, g, mem } = c;
    const above = him.position[1] - me.position[1];
    mem.snapT ??= 0;
    if (g.sees && g.hisSpeed < 22 && g.range < 300 && above > 30 && g.mySpeed > 26 && mem.snapT < 4) {
      mem.snapT += c.dt;
      go(c, 'snap');
      return { ...pointNose(me, sub(leadPoint(me, him, c.gun), me.position), { fine: 8 }), throttle: 1 };
    }
    if (g.hisSpeed >= 22) mem.snapT = 0;
    if (above > 50) {
      if (g.sees && g.hisAta < 35 && g.closure > 0 && g.range < 600) {
        go(c, 'face');
        return { ...pointNose(me, sub(leadPoint(me, him, c.gun), me.position), { fine: 8 }), throttle: 1 };
      }
      go(c, 'climb');
      const h = heading(me.velocity), to = heading(sub(him.position, me.position));
      return { ...pointNose(me, climbing(unit(add(h, scale(to, 0.5))), 20), { fine: 8 }), throttle: 1 };
    }
    if (mem.phase === 'climb' || mem.phase === 'face' || mem.phase === 'snap') { go(c, 'chase'); mem.closing = 0; }
    return PLANS.jetScAce.step(c);
  },
};
INTENTS.jetScClimber = { ...INTENTS.scClimber };

/** `PLANS.scDip` over `jetScissors`: out at crossing `mem.dipAt` (2), no
 *  reversal, full throttle, a shallow dive. */
PLANS.jetScDip = {
  ...PLANS.scDip,
  says: saysOf('scDip'),
  step(c) {
    const { me, mem } = c;
    if (mem.phase !== 'dip-run') {
      const was = mem.phase, h0 = heading(me.velocity);
      const out = PLANS.jetScissors.step(c);
      if (!(mem.phase === 'cross' && was !== 'cross' && (mem.crossings = (mem.crossings ?? 0) + 1) >= (mem.dipAt ?? 2))) return out;
      mem.away = h0;
      go(c, 'dip-run');
    }
    const want = c.agl > 110 ? (mem.dipDive ?? -6) : c.agl > 80 ? -1 : 3;
    return { ...turnToward(c, climbing(mem.away, want), { maxUp: 5, maxDown: 30 }), throttle: 1, aimed: false };
  },
};
INTENTS.jetScDip = { ...INTENTS.scDip };

/** `PLANS.scFlip` over `jetScissors`: from the first crossing the scissors
 *  flown slower than him, the throttle holding `mem.brake` (33). */
PLANS.jetScFlip = {
  ...PLANS.scFlip,
  says: saysOf('scFlip'),
  step(c) {
    const { mem, dt } = c;
    if (!mem.flipping) {
      const was = mem.phase;
      const out = PLANS.jetScissors.step(c);
      if (!(mem.phase === 'cross' && was !== 'cross')) return out;
      mem.flipping = true;
      mem.scPh = 'cross';
      mem.scSince = 0;
      const b = mem.brake ?? 33;
      mem.band = [b - 2, b + 1];
      mem.fast = false;
    }
    const outer = mem.phase, since = mem.since;
    mem.scSince += dt;
    mem.phase = mem.scPh;
    mem.since = mem.scSince;
    const out = PLANS.jetScissors.step(c);
    mem.scPh = mem.phase;
    mem.scSince = mem.since;
    mem.phase = `flip-${mem.scPh}`;
    mem.since = outer === mem.phase ? since : 0;
    return out;
  },
};
INTENTS.jetScFlip = { ...INTENTS.scFlip };
