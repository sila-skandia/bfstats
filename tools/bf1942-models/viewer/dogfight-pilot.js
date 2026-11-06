// The dogfight school's pilots (features/dogfight-school): the moves a
// skilled fighter pilot flies, and the plans that string them together.
// Pure: a pilot is handed both aircraft's states each tick and answers with
// the stick, the throttle, the trigger and what it is doing, in words the
// school can put on screen. The theatre flies two of them against each other
// offline, the proving ground puts one in a bot's seat (`bot.js` `ace`).
//
// Everything here is the school's own (INVENTION): the retail AI's plane law
// (AI-60) cannot loop, zoom or reverse. The airframe is the engine's, flown
// through the four channels a human has.

import { G, clamp, dot, cross, len, sub, add, scale, unit, basis, bodyRates, energyHeight, bankOf,
         pitchOf, pointNose, pullLift, hardTurn, bankAndPull, leadPoint, gunSolution, angleBetween } from './dogfight-flight.js';

const DEG = Math.PI / 180;
const UP = [0, 1, 0];

/** A level unit vector along `v`'s heading. */
export const heading = v => unit([v[0], 0, v[2]]);
/** A direction `deg` above the horizon along the level heading `h`. */
export const climbing = (h, deg) => add(scale(h, Math.cos(deg * DEG)), [0, Math.sin(deg * DEG), 0]);
const speedOf = s => len(s.velocity);

/**
 * The two fighters in the words of basic fighter manoeuvres, from `me`'s
 * seat: how far, where he sits off my nose (`ata`, 0 = dead ahead), where I
 * sit off his tail (`aspect`, 0 = I am dead astern of him, 180 = head on),
 * where I sit off his nose (`hisAta`), how fast we close, his height and
 * energy over mine, and which side of me he is on.
 */
export function geometry(me, him) {
  const rel = sub(him.position, me.position);
  const range = len(rel);
  const los = range > 1e-6 ? scale(rel, 1 / range) : [0, 0, -1];
  const mine = basis(me.orientation), his = basis(him.orientation);
  const ata = Math.acos(clamp(dot(mine.F, los))) / DEG;
  const hisAta = Math.acos(clamp(dot(his.F, scale(los, -1)))) / DEG;
  const aspect = Math.acos(clamp(dot(scale(his.F, -1), scale(los, -1)))) / DEG;
  const closure = -dot(los, sub(him.velocity, me.velocity));
  const myE = energyHeight(me.position[1], speedOf(me));
  const hisE = energyHeight(him.position[1], speedOf(him));
  return {
    range, los, ata, hisAta, aspect, closure,
    above: him.position[1] - me.position[1],
    energy: hisE - myE, myEnergy: myE, hisEnergy: hisE,
    mySpeed: speedOf(me), hisSpeed: speedOf(him),
    side: Math.sign(dot(mine.R, los)) || 1,
    hisSide: Math.sign(dot(his.R, scale(los, -1))) || 1,
  };
}

/** Who has whom: `offensive` (I am behind him), `defensive` (he is behind
 *  me), `headOn`, or `neutral`. */
export function situation(g) {
  if (g.range > 1400) return 'neutral';
  if (g.ata < 60 && g.hisAta > 100) return 'offensive';
  if (g.hisAta < 60 && g.ata > 100) return 'defensive';
  if (g.ata < 45 && g.hisAta < 45) return 'headOn';
  return 'neutral';
}

/** The school's pilots, by name. Each is a plan: a small state machine over
 *  the moves below. `role` says who it is in a lesson. */
export const PLANS = {};

/**
 * A fighter's guns in the pilots' terms: muzzle speed, reach, drop, and the
 * wing guns' spread and convergence. `range` is how far a burst still lands
 * on a fighter: past the point where the two converging streams have parted
 * by more than a wingspan, it does not (the Spitfire's 2.5 m out at 1.6
 * degrees in: about 270 m), and no further than the rounds fly. A gun whose
 * numbers have not loaded (a live seat's stats arrive with its glb) keeps the
 * Spitfire's: a muzzle speed of 0 would put the lead at infinity.
 */
export function gunOf(gun = {}) {
  const ok = (v, lo) => Number.isFinite(v) && v > lo;
  const speed = ok(gun.speed, 50) ? gun.speed : 400;
  const reach = ok(gun.reach, 50) ? gun.reach : 600;
  const span = Number.isFinite(gun.span) ? gun.span : 2.5;
  const converge = Number.isFinite(gun.converge) ? gun.converge : 1.6;
  const crossing = converge > 0.05 ? (span + 5) / Math.tan(converge * DEG) : Infinity;
  const range = ok(gun.range, 50) ? gun.range : Math.min(reach, crossing, 400);
  return { speed, reach, span, converge, range,
           gravity: Number.isFinite(gun.gravity) && gun.gravity >= 0 ? gun.gravity : 0 };
}

/**
 * A pilot: `plan` names one of `PLANS`, `skill` (0..1) blurs its aim and
 * slows its reactions, `gun` is the guns' muzzle speed, reach and drop.
 */
export function createPilot(plan, { skill = 1, gun = {}, seed = 1 } = {}) {
  const def = PLANS[plan];
  if (!def) throw new Error(`no dogfight plan ${plan}`);
  const pilot = {
    plan, skill,
    gun: gunOf(gun),
    mem: { phase: def.first ?? 'start', since: 0, t: 0, rng: seed >>> 0 || 1 },
    phase: def.first ?? 'start', say: '', move: def.title ?? plan, fire: false,
  };
  pilot.step = ctx => stepPilot(pilot, def, ctx);
  return pilot;
}

function stepPilot(pilot, def, ctx) {
  const { me, him } = ctx;
  const mem = pilot.mem;
  mem.t += ctx.dt;
  mem.since += ctx.dt;
  const g = geometry(me, him);
  const ground = ctx.groundAt ? ctx.groundAt(me.position[0], me.position[2]) : 0;
  const agl = me.position[1] - ground;
  // His acceleration, from his velocity a tick ago, smoothed: what bends
  // the lead round a turning target.
  if (mem.hisV) {
    const a = scale(sub(him.velocity, mem.hisV), 1 / Math.max(1e-3, ctx.dt));
    mem.hisA = mem.hisA ? add(scale(mem.hisA, 0.8), scale(a, 0.2)) : a;
  }
  mem.hisV = him.velocity.slice();
  const c = { ...ctx, g, agl, mem, pilot, gun: { ...pilot.gun, accel: mem.hisA ?? null }, ground };
  // The floor and the ceiling come before any plan.
  const safe = guard(c);
  const evade = !safe && def.reflex ? reflex(c, def) : null;
  let out = safe ?? evade ?? def.step(c) ?? hold(c);
  if (safe) out.phase = mem.phase;
  const fire = shoot(c, out.aimed !== false);
  pilot.fire = fire;
  pilot.phase = mem.phase;
  pilot.say = out.say ?? def.says?.[mem.phase] ?? '';
  pilot.recovering = !!safe;
  const num = v => (Number.isFinite(v) ? v : 0);
  return {
    stick: { pitch: clamp(num(out.pitch)), roll: clamp(num(out.roll)), rudder: clamp(num(out.rudder)) },
    throttle: Number.isFinite(out.throttle) ? out.throttle : 1, fire, phase: mem.phase, say: pilot.say, move: def.title ?? pilot.plan,
    recovering: !!safe, geometry: g,
  };
}

/** Move a plan to its next phase. */
export function go(c, phase) {
  if (c.mem.phase !== phase) {
    c.mem.phase = phase;
    c.mem.since = 0;
    c.mem.enter = { ...(c.mem.enter ?? {}), [phase]: c.mem.t };
  }
}

/**
 * The floor and the ceiling. Below what the sink would eat in three seconds
 * (and never below 60 m) the pilot rolls upright and pulls; above 880 m,
 * where the wings are dying (the lift ceiling is 1000 m, flight-model.md),
 * the nose comes down to the horizon.
 */
function guard(c) {
  const { me } = c;
  const vy = me.velocity[1];
  const floor = 70 + Math.max(0, -vy) * 3.2;
  if (c.agl < floor) {
    const h = heading(me.velocity);
    const k = pointNose(me, climbing(len(h) > 0 ? h : basis(me.orientation).F, 25), { fine: 30 });
    return { ...k, throttle: 1, say: 'pulling out' };
  }
  if (me.position[1] - (c.ceilingBase ?? 0) > 880 && vy > 0) {
    return { ...pointNose(me, heading(me.velocity), { fine: 20 }), throttle: 1, say: 'too high: the wings are dying' };
  }
  return null;
}

/**
 * A plan with `reflex` set breaks into anyone who gets on its tail inside
 * gun range, whatever it was doing, and picks its plan up again after.
 */
function reflex(c, def) {
  const { g, mem } = c;
  const threat = g.hisAta < 30 && g.ata > 100 && g.range < (c.gun.range + 60);
  if (threat && !(def.committed ?? []).includes(mem.phase)) {
    if (mem.phase !== 'evade') { mem.resume = mem.phase; mem.breakSide = g.side; go(c, 'evade'); }
  }
  if (mem.phase !== 'evade') return null;
  if (!threat && mem.since > 2.5) { go(c, mem.resume ?? def.first); return null; }
  return { ...hardTurn(c.me, mem.breakSide ?? g.side), throttle: 1, say: 'He is on my tail: breaking into him' };
}

function hold(c) {
  return { ...pointNose(c.me, heading(c.me.velocity)), throttle: 1 };
}

/** The trigger: a gun solution inside the reach, held as long as it lasts.
 *  A less skilled pilot opens fire less tightly. */
function shoot(c, aimed) {
  if (!aimed) return false;
  const s = gunSolution(c.me, c.him, { ...c.gun, width: 7 + (1 - c.pilot.skill) * 6 });
  return s.fire;
}

// --- moves ------------------------------------------------------------------

/** Lead pursuit: the nose on where he will be when the rounds get there. */
export function leadPursuit(c, opts = {}) {
  const lp = add(leadPoint(c.me, c.him, c.gun), wander(c));
  return pointNose(c.me, sub(lp, c.me.position), { fine: 8, ...aim(c), ...opts });
}
/** A less than perfect pilot's aim: a slow wander about the true lead,
 *  4 degrees across at skill 0, none at skill 1. */
function wander(c) {
  const k = (1 - (c.pilot.skill ?? 1));
  if (k <= 0) return [0, 0, 0];
  const t = c.mem.t, r = c.g.range * Math.tan(4 * DEG) * k;
  return [r * Math.sin(t * 1.3 + 1), r * Math.sin(t * 0.9 + 2) * 0.8, r * Math.cos(t * 1.1)];
}

/** The throttle that holds `speed` (m/s): a cruise, not a race. */
export const holdSpeed = (c, speed) => clamp(0.55 + (speed - c.g.mySpeed) * 0.12, -1, 1);

/** Pure pursuit: the nose on him. */
export function purePursuit(c, opts = {}) {
  return pointNose(c.me, sub(c.him.position, c.me.position), { fine: 8, ...aim(c), ...opts });
}
/** Lag pursuit: the nose on a point behind him (his position `lag` seconds
 *  ago along his path), which holds the range instead of closing it. */
export function lagPursuit(c, lag = 1.5, opts = {}) {
  const p = sub(c.him.position, scale(c.him.velocity, lag));
  return pointNose(c.me, sub(p, c.me.position), { fine: 8, ...aim(c), ...opts });
}

/**
 * Come round to a direction the way a pilot does when it is behind him: a
 * level hard turn to its bearing (not a pull up and over the top, which
 * would cost all the speed), then the nose onto it, no more than `maxUp`
 * degrees above the horizon.
 */
export function turnToward(c, dir, { maxUp = 25, maxDown = 45 } = {}) {
  const h = heading(c.me.velocity);
  const flat = heading(dir);
  const off = angleBetween(h, flat);
  if (off > 55) {
    const side = Math.sign(dot([-h[2], 0, h[0]], flat)) || 1;
    return hardTurn(c.me, side);
  }
  const elev = clamp(Math.asin(clamp(unit(dir)[1])) / DEG, -maxDown, maxUp);
  return pointNose(c.me, climbing(flat, elev), { fine: 8, push: 0.4, ...aim(c) });
}

/** The climb a fast fighter can afford: 70 degrees on a dive's speed,
 *  easing to the 20 to 30 that a Spitfire holds all day at 40 to 50 m/s. */
export const climbAngle = speed => clamp(20 + (speed - 38) * 2.4, 12, 70);

/** The wanted climb angle moved no faster than 15 degrees a second, so the
 *  nose eases from a zoom into a steady climb instead of being pushed
 *  over and bouncing. */
export function easedClimb(c, want, rate = 15) {
  const was = c.mem.climbDeg ?? Math.max(0, pitchOf(c.me.orientation));
  const step = rate * c.dt;
  c.mem.climbDeg = was + clamp(want - was, -step, step);
  return c.mem.climbDeg;
}

/**
 * A wingover: at the top of a climb, roll the lift onto the horizon on
 * `side` and pull, so the nose slices sideways and down instead of looping
 * backwards through the vertical (which costs every m/s left). Toward the
 * enemy when `side` is not given.
 */
export function wingover(c, side = null) {
  const { me, him, g } = c;
  const h = heading(me.velocity);
  const right = [-h[2], 0, h[0]];
  const s = side ?? (Math.sign(dot(right, heading(sub(him.position, me.position)))) || g.side);
  if (c.mem.overSide === undefined) c.mem.overSide = s;
  const lift = add(scale(right, c.mem.overSide), [0, -0.15, 0]);
  return pullLift(me, lift, 1);
}

/** The aim's trim memory (`pointNose`'s integrals), kept per pilot. */
const aim = c => ({ mem: c.mem.aim ?? (c.mem.aim = {}), dt: c.dt });

/** A turn toward `side` that climbs `deg` degrees: what to fly to keep
 *  speed while climbing away, a spiral. */
export function climbingTurn(c, side, deg, rate = 0.35) {
  const h = heading(c.me.velocity);
  const right = [-h[2], 0, h[0]];
  const d = add(climbing(h, deg), scale(right, side * rate));
  return pointNose(c.me, d, { fine: 6 });
}

// --- the plans --------------------------------------------------------------

/**
 * BOOM AND ZOOM. Height first: climb above him and out of his reach, dive
 * on him at full speed, shoot as he fills the sight, and use the dive's
 * speed to zoom back up before he can turn to meet you. Never turn with him.
 */
PLANS.boomAndZoom = {
  title: 'Boom and zoom', first: 'climb', reflex: true, committed: ['dive'],
  says: {
    climb: 'Climbing above him, out of his reach',
    perch: 'Sitting high: picking the moment',
    dive: 'Diving on him: all the speed of the fall',
    zoom: 'Zooming back up on the dive\'s speed',
    reverse: 'Turning over the top to come down again',
    evade: 'He is on my tail: breaking into him',
  },
  step(c) {
    const { me, him, g, mem } = c;
    const h = heading(me.velocity);
    switch (mem.phase) {
      case 'climb': {
        // Climb away from him, keeping him in view to one side, until the
        // height is bought: 300 m over him and 600 m of air between. Slow,
        // the nose comes down to build speed first: the best sustained climb
        // is 20 to 30 degrees at 40 to 50 m/s.
        const away = heading(sub(me.position, him.position));
        const side = [-away[2], 0, away[0]];
        const angle = clamp((g.mySpeed - 36) * 1.6, -5, 26);
        const d = climbing(unit(add(scale(away, 0.5), scale(side, 0.9))), angle);
        if (g.above < -280 && g.range > 550) go(c, 'perch');
        return { ...pointNose(me, d, { fine: 6 }), throttle: 1 };
      }
      case 'perch': {
        // Turn to put him off the nose and below, then push over.
        const toward = heading(sub(him.position, me.position));
        if (g.ata < 45 || mem.since > 8) go(c, 'dive');
        return { ...pointNose(me, climbing(toward, -10), { fine: 6 }), throttle: 1 };
      }
      case 'dive': {
        // Lead him all the way down; break off before the pass gets close
        // enough to collide, or once he has turned to face us.
        const k = leadPursuit(c, { pull: 1, push: 0.7 });
        if (g.range < 70 || (g.ata > 60 && g.range < 300) || (mem.since > 3 && g.closure < -5) || mem.since > 22) go(c, 'zoom');
        return { ...k, throttle: 1 };
      }
      case 'zoom': {
        // Up at 60 degrees on the dive's speed, away from his nose.
        const k = pointNose(me, climbing(h, 60), { fine: 6 });
        if (g.mySpeed < 42 || mem.since > 9) go(c, 'reverse');
        return { ...k, throttle: 1 };
      }
      case 'reverse': {
        // A wingover: the lift onto his side of the sky, the nose coming down
        // toward him. With the height still over him, dive again; without
        // it, climb.
        const toward = heading(sub(him.position, me.position));
        const k = pitchOf(me.orientation) > 10 ? wingover(c) : pointNose(me, climbing(toward, g.above < -150 ? -25 : 0), { fine: 8 });
        if (g.ata < 40) { mem.overSide = undefined; go(c, g.above < -150 ? 'dive' : 'climb'); }
        if (mem.since > 7) { mem.overSide = undefined; go(c, 'climb'); }
        return { ...k, throttle: 1 };
      }
      default: go(c, 'climb');
    }
    return null;
  },
};

/**
 * UP AND OVER, the vertical escape. With a chaser on your tail and more
 * speed than he has, pull straight up. He follows, but he runs out of speed
 * first and hangs under you with no control left; at the top you kick the
 * nose over (a hammerhead) and come down on him.
 */
PLANS.upAndOver = {
  title: 'Up and over', first: 'run',
  says: {
    run: 'Running fast and level: letting him chase',
    pull: 'Climbing away steep: he is slower and cannot follow',
    over: 'High above him now: over the top and down',
    pounce: 'Coming down on him: he has no speed left to turn',
    zoom: 'Back up again on the dive\'s speed',
    evade: 'He is on my tail: breaking into him',
  },
  step(c) {
    const { me, him, g, mem } = c;
    const h = heading(me.velocity);
    switch (mem.phase) {
      case 'run': {
        // Level, full throttle, a gentle weave so he commits to the chase,
        // kept outside his guns' reach.
        const weave = Math.sin(mem.t * 0.6) * 0.12;
        const d = add(climbing(h, 2), scale([-h[2], 0, h[0]], weave));
        if (g.hisAta < 35 && g.range < 600 && g.mySpeed > g.hisSpeed - 2 && mem.since > 0.4) go(c, 'pull');
        if (mem.since > 14 && g.hisAta < 60) go(c, 'pull');
        return { ...pointNose(me, d, { fine: 8 }), throttle: 1 };
      }
      case 'pull': {
        // Steep while the speed lasts, then the steepest climb that keeps
        // 38 m/s: straight up a Spitfire sheds 7 m/s a second and hangs in
        // his guns, but a climb it can hold walks away from a slower plane,
        // and every second he follows it, he gets slower.
        // Out of his reach the pull goes nearly vertical (the zoom that buys
        // the most height for the speed); inside it, the climb he can hold.
        const steep = mem.profile === 'steep';
        const want = steep && g.mySpeed > 34 ? 80 : climbAngle(g.mySpeed);
        const k = pointNose(me, climbing(len(h) > 0 ? h : basis(me.orientation).F, easedClimb(c, want, steep ? 40 : 15)), { fine: 8 });
        if (g.mySpeed < 30 || (g.above < -260 && g.range > 380) || mem.since > 22) go(c, 'over');
        return { ...k, throttle: 1 };
      }
      case 'over': {
        // A wingover: the lift onto the horizon on his side, the nose
        // slicing over and down toward him with speed still in hand.
        const k = pitchOf(me.orientation) < -10 ? pointNose(me, sub(him.position, me.position), { fine: 12 }) : wingover(c);
        if (g.ata < 30 || mem.since > 8) { mem.overSide = undefined; go(c, 'pounce'); }
        return { ...k, throttle: 1 };
      }
      case 'pounce': {
        const k = leadPursuit(c, { push: 0.6 });
        if (g.range < 90 || (g.ata > 70 && g.range < 250) || mem.since > 12) go(c, 'zoom');
        return { ...k, throttle: 1 };
      }
      case 'zoom': {
        const k = pointNose(me, climbing(h, easedClimb(c, climbAngle(g.mySpeed))), { fine: 6 });
        if ((g.above < -200 && g.range > 380) || mem.since > 16) go(c, 'over');
        return { ...k, throttle: 1 };
      }
      default: go(c, 'run');
    }
    return null;
  },
};

/**
 * THE BREAK TURN. With an attacker closing on your tail, wait until he is
 * committed, then turn as hard as the aeroplane will turn, toward him. He
 * cannot pull his nose round fast enough at his speed and flies past
 * (an overshoot); you reverse and you are behind him.
 */
PLANS.breakTurn = {
  title: 'The break turn', first: 'watch',
  says: {
    watch: 'Flying straight, watching him close',
    break: 'BREAK: as hard as it turns, into him',
    reverse: 'He flew past: reversing onto his tail',
    chase: 'On his tail now',
  },
  step(c) {
    const { me, him, g, mem } = c;
    switch (mem.phase) {
      case 'watch': {
        // Cruising, not racing: the attacker has to be let close enough to
        // commit before the break means anything.
        if (!mem.dir) mem.dir = heading(me.velocity);
        if (g.hisAta < 25 && g.range < c.gun.range + 30 && g.closure > 4) { mem.breakSide = g.side; go(c, 'break'); }
        return { ...pointNose(me, climbing(mem.dir, 0), { fine: 8 }), throttle: holdSpeed(c, 52) };
      }
      case 'break': {
        // Into him: the turn that makes his angle off the tail grow fastest.
        const k = hardTurn(me, mem.breakSide ?? g.side, { climb: 0 });
        if ((g.ata < 70 && g.hisAta > 70) || mem.since > 9) go(c, 'reverse');
        return { ...k, throttle: 1 };
      }
      case 'reverse': {
        // He is out in front and turning away: the hard turn the other way,
        // toward him, then the guns once the nose is close.
        const k = g.ata > 45 ? hardTurn(me, g.side) : leadPursuit(c);
        if (g.ata < 20) go(c, 'chase');
        if (mem.since > 8 && g.hisAta < 50) { mem.breakSide = g.side; go(c, 'break'); }
        return { ...k, throttle: 1 };
      }
      case 'chase': {
        if (g.hisAta < 40 && g.ata > 100) { mem.breakSide = g.side; go(c, 'break'); }
        if (g.ata > 50) go(c, 'reverse');
        return { ...leadPursuit(c), throttle: g.closure > 18 && g.range < 220 ? -0.2 : 1 };
      }
      default: go(c, 'watch');
    }
    return null;
  },
};

/**
 * THE FLAT SCISSORS. Two fighters side by side and slow, each reversing
 * into the other every time they cross. The one who goes slower without
 * stalling ends up behind: throttle back, reverse at every crossing.
 */
PLANS.scissors = {
  title: 'The flat scissors', first: 'reverse',
  says: {
    reverse: 'Turning into him as he crosses: slow and tight',
    cross: 'He crossed: reverse now',
    shoot: 'He drifted out in front of me',
  },
  step(c) {
    const { me, him, g, mem } = c;
    // The fast version is the natural one: full throttle every crossing,
    // which drifts him forward. The ace slows: throttle back early (the
    // brake takes seconds to bite), never below 30 m/s, where the
    // Spitfire stops answering.
    const fast = !!mem.fast;
    if (!fast && g.ata < 22 && g.range < 260) go(c, 'shoot');
    if (mem.phase === 'shoot') {
      if (g.ata > 60) go(c, 'reverse');
      return { ...leadPursuit(c), throttle: g.closure > 6 ? -0.3 : 0.7 };
    }
    // Turn into him; when he crosses to the other side, reverse.
    if (mem.side === undefined) mem.side = g.side;
    if (g.side !== mem.side && mem.since > 1.0) { mem.side = g.side; go(c, 'cross'); }
    if (mem.phase === 'cross' && mem.since > 0.6) go(c, 'reverse');
    const k = hardTurn(me, mem.side, { climb: 0, maxBank: clamp(40 + (g.mySpeed - 30) * 2.2, 45, 80) });
    const ahead = g.ata < 90 && g.hisAta > 90;
    const throttle = fast ? 1 : (g.mySpeed > 38 && !ahead ? -1 : g.mySpeed < 31 ? 1 : 0.4);
    return { ...k, throttle };
  },
};

/**
 * THE IMMELMANN AND THE SPLIT-S, the two ways to turn round in the
 * vertical. Fast: half a loop up and roll upright on top (Immelmann),
 * going back the other way with height. High and slow: roll upside down and
 * pull through half a loop down (split-S), going back with speed.
 */
PLANS.turnarounds = {
  title: 'The Immelmann and the split-S', first: 'pass',
  says: {
    pass: 'Passing him: about to turn round',
    immelmann: 'Immelmann: half a loop up',
    rollout: 'Rolling upright on top, going the other way',
    split: 'Split-S: rolling inverted',
    pullthrough: 'Pulling through half a loop down: speed back',
    attack: 'Back on him',
  },
  step(c) {
    const { me, him, g, mem } = c;
    const h = heading(me.velocity);
    switch (mem.phase) {
      case 'pass': {
        mem.from = h;
        if (g.ata > 120 || mem.since > 8) go(c, g.mySpeed > 52 && c.agl < 650 ? 'immelmann' : 'split');
        return { ...pointNose(me, climbing(h, 0), { fine: 6 }), throttle: 1 };
      }
      case 'immelmann': {
        // Wings level, full aft stick: the lift stays in the loop's plane.
        const k = pullLift(me, basis(me.orientation).U, 1);
        k.roll = bankAndPull(me, 0, 0).roll * (pitchOf(me.orientation) < 70 ? 1 : 0) + k.roll * 0;
        if (basis(me.orientation).U[1] < -0.2 && Math.abs(pitchOf(me.orientation)) < 25) go(c, 'rollout');
        if (mem.since > 9) go(c, 'attack');
        return { ...k, throttle: 1 };
      }
      case 'rollout': {
        const k = bankAndPull(me, 0, 0);
        if (Math.abs(bankOf(me.orientation).bank) < 20 || mem.since > 2.5) go(c, 'attack');
        return { ...k, throttle: 1 };
      }
      case 'split': {
        const k = bankAndPull(me, 180, 0);
        if (Math.abs(bankOf(me.orientation).bank) > 160 || mem.since > 2) go(c, 'pullthrough');
        return { ...k, throttle: 0.3 };
      }
      case 'pullthrough': {
        const k = pullLift(me, basis(me.orientation).U, 1);
        if ((pitchOf(me.orientation) > -15 && basis(me.orientation).U[1] > 0.5) || mem.since > 7) go(c, 'attack');
        return { ...k, throttle: 0.6 };
      }
      case 'attack': {
        if (g.ata > 120 && g.range > 250 && mem.since > 6) go(c, 'pass');
        return { ...leadPursuit(c), throttle: 1 };
      }
      default: go(c, 'pass');
    }
    return null;
  },
};

// --- the other side of each lesson ------------------------------------------

/** The eager amateur: always points at the enemy and chases wherever he
 *  goes, up included. What every move in the school beats. */
PLANS.chaser = {
  title: 'The eager chaser', first: 'chase',
  says: { chase: 'Guns on him, wherever he goes', turn: 'Pulling after him', lost: 'Where did he go? Lost sight of him' },
  step(c) {
    const { g, mem } = c;
    if (lostSight(c)) return { ...pointNose(c.me, climbing(mem.lostDir, 0), { fine: 6 }), throttle: 1 };
    go(c, g.ata < 40 ? 'chase' : 'turn');
    // He pulls lead to get the shot: up after a climbing target, steeper
    // than the target itself. He does know to ease the throttle when he is
    // about to fly into the back of him.
    return { ...leadPursuit(c, { pull: 1, push: 0.6 }), throttle: g.closure > 15 && g.range < 240 && g.ata < 30 ? 0.2 : 1 };
  },
};

/**
 * A green pilot whose target slips behind his wing loses sight of it for a
 * couple of seconds and flies straight on, looking: lose sight, lose the
 * fight. Only below skill 0.7.
 */
function lostSight(c) {
  const { g, mem } = c;
  if ((c.pilot.skill ?? 1) >= 0.7) return false;
  if (mem.phase === 'lost') {
    if (mem.since < 2.6) return true;
    go(c, 'turn');
    mem.lostAt = mem.t;
    return false;
  }
  if (g.ata > 110 && g.range < 250 && mem.t - (mem.lostAt ?? -99) > 8) {
    mem.lostDir = heading(c.me.velocity);
    go(c, 'lost');
    return true;
  }
  return false;
}

/** The answer to a climbing target: follow, but shallow. A climb of 20 to
 *  30 degrees keeps the speed while his steep one spends it, and when he
 *  hangs at the top he is slow and in front of you. */
PLANS.shallowFollow = {
  title: 'Following shallow', first: 'chase',
  says: {
    chase: 'Behind him, guns on',
    follow: 'He is climbing steep: following at 25 degrees, keeping my speed',
    face: 'He is coming down: turning to face him',
    shoot: 'He hung at the top: he is slow in front of me',
  },
  step(c) {
    const { me, him, g, mem } = c;
    const climbingHim = him.velocity[1] > 6;
    if (him.velocity[1] < -8 && g.hisAta < 60) go(c, 'face');
    else if (climbingHim && g.hisSpeed < 25 && g.range < c.gun.range) go(c, 'shoot');
    else if (climbingHim) go(c, 'follow');
    else go(c, 'chase');
    const lp = sub(leadPoint(me, him, c.gun), me.position);
    if (mem.phase === 'follow') return { ...turnToward(c, lp, { maxUp: 25 }), throttle: 1 };
    if (mem.phase === 'face') return { ...turnToward(c, lp, { maxUp: 30 }), throttle: 1 };
    return { ...leadPursuit(c, { push: 0.5 }), throttle: 1 };
  },
};

/** The pilot who never looks back: straight and level until the first
 *  pass goes by, then the eager chaser, up into the zoom and all. */
PLANS.unaware = {
  title: 'Not looking up', first: 'cruise',
  says: { cruise: 'Flying straight, not looking up', chase: 'He just went past: chasing him', turn: 'Turning after him' },
  step(c) {
    const { g, mem } = c;
    if (mem.phase === 'cruise') {
      if (!mem.dir) mem.dir = heading(c.me.velocity);
      if (g.range < 140 || (g.ata < 60 && g.range < 300)) go(c, 'chase');
      else return { ...pointNose(c.me, climbing(mem.dir, 0), { fine: 6 }), throttle: 1 };
    }
    go(c, g.ata < 40 ? 'chase' : 'turn');
    return { ...purePursuit(c, { pull: 1, push: 0.6 }), throttle: 1 };
  },
};

/** A target that flies a steady circle, as a pilot holding a turn does. */
PLANS.circler = {
  title: 'Holding a hard turn', first: 'turn',
  says: { turn: 'Holding a hard turn' },
  step(c) {
    if (c.mem.side === undefined) c.mem.side = c.mem.dir ?? 1;
    return { ...hardTurn(c.me, c.mem.side, { climb: 0, maxBank: 72 }), throttle: 1 };
  },
};

/** Straight and level: the sitting duck. */
PLANS.cruiser = {
  title: 'Flying straight', first: 'cruise',
  says: { cruise: 'Flying straight and level, not looking back' },
  step(c) {
    // Cruising, as the break turn's pilot does before he breaks: the speed
    // he started at, not the throttle against the stop.
    if (!c.mem.dir) { c.mem.dir = heading(c.me.velocity); c.mem.cruise = c.g.mySpeed; }
    return { ...pointNose(c.me, climbing(c.mem.dir, 0), { fine: 6 }), throttle: holdSpeed(c, c.mem.cruise) };
  },
};

/** The answer to boom and zoom: keep the speed up, climb shallow, and when
 *  he commits to the dive turn to face him, so his pass is a head-on snap
 *  shot. Never follow his zoom. */
PLANS.meetTheDive = {
  title: 'Meeting the dive', first: 'climb',
  says: {
    climb: 'Keeping speed, climbing shallow, watching him',
    face: 'He is diving: turning to face him',
    pass: 'Head on: make his pass short',
    extend: 'He zoomed: not following, climbing on my own',
  },
  step(c) {
    const { me, him, g, mem } = c;
    const h = heading(me.velocity);
    const diving = him.velocity[1] < -12 && g.hisAta < 50;
    switch (mem.phase) {
      case 'climb':
        if (diving && g.range < 900) go(c, 'face');
        return { ...climbingTurn(c, 1, 18, 0.15), throttle: 1 };
      case 'face': {
        // Turn to face him, but never stand on the tail to do it: far out,
        // a level hard turn round to his bearing, the nose kept within 25
        // degrees of the horizon so the speed stays.
        const lp = sub(leadPoint(me, him, c.gun), me.position);
        const k = g.range > 320 ? turnToward(c, lp, { maxUp: 25 }) : pointNose(me, lp, { fine: 8, push: 0.4, ...aim(c) });
        if (g.range < 200) go(c, 'pass');
        if (!diving && mem.since > 4) go(c, 'extend');
        return { ...k, throttle: 1 };
      }
      case 'pass':
        if (g.closure < 0 || mem.since > 4) go(c, 'extend');
        return { ...leadPursuit(c), throttle: 1 };
      case 'extend': {
        // Away from where he is going, climbing at the angle that holds speed.
        const away = heading(sub(me.position, him.position));
        if (mem.since > 6) go(c, 'climb');
        return { ...pointNose(me, climbing(unit(add(away, scale(h, 0.5))), 16), { fine: 6 }), throttle: 1 };
      }
      default: go(c, 'climb');
    }
    return null;
  },
};

/** The answer to up and over: compare speeds before following. Slower, let
 *  him go up alone, keep your speed in a shallow climbing turn, and turn to
 *  face him when he comes down. */
PLANS.dontFollow = {
  title: 'Not following him up', first: 'chase',
  says: {
    chase: 'Chasing him: watching his speed against mine',
    peel: 'He went vertical faster than me: not following',
    face: 'He tipped over: turning to face his dive',
    shoot: 'He is out of speed in front of me',
  },
  step(c) {
    const { me, him, g, mem } = c;
    const hisPitch = pitchOf(him.orientation);
    switch (mem.phase) {
      case 'chase':
        if (hisPitch > 45 && g.hisSpeed >= g.mySpeed - 3) { mem.side = -g.side; go(c, 'peel'); }
        return { ...leadPursuit(c), throttle: g.closure > 20 && g.range < 180 ? 0.4 : 1 };
      case 'peel':
        if (him.velocity[1] < -5 && mem.since > 3) go(c, 'face');
        if (g.hisSpeed < 12 && g.ata < 30 && g.range < 400) go(c, 'shoot');
        return { ...climbingTurn(c, mem.side ?? 1, 14, 0.5), throttle: 1 };
      case 'face':
        if (g.range < 150 || (mem.since > 8 && g.closure < 0)) go(c, 'chase');
        return { ...leadPursuit(c, { push: 0.5 }), throttle: 1 };
      case 'shoot':
        if (g.hisSpeed > 20 || mem.since > 5) go(c, 'face');
        return { ...leadPursuit(c), throttle: 1 };
      default: go(c, 'chase');
    }
    return null;
  },
};

/** The answer to the break turn, flown by the attacker: when he breaks,
 *  don't pull after him and overshoot. Ease off, lift out of his turn
 *  (a high yo-yo) and come down behind him again. */
PLANS.patientAttacker = {
  title: 'The patient attacker', first: 'close',
  says: {
    close: 'Closing on his tail',
    lag: 'He broke: not following inside, lifting out of his turn',
    back: 'Back down behind him',
  },
  step(c) {
    const { me, him, g, mem } = c;
    switch (mem.phase) {
      case 'close': {
        const k = leadPursuit(c);
        if (g.ata > 25 && g.range < 400) go(c, 'lag');
        return { ...k, throttle: g.closure > 18 && g.range < 300 ? 0.5 : 1 };
      }
      case 'lag': {
        const d = add(scale(unit(sub(him.position, me.position)), 0.7), [0, 0.6, 0]);
        if (mem.since > 2.4) go(c, 'back');
        return { ...pointNose(me, d, { fine: 6 }), throttle: 0.6 };
      }
      case 'back': {
        const k = lagPursuit(c, 0.6, { push: 0.5 });
        if (g.ata < 12 || mem.since > 6) go(c, 'close');
        return { ...k, throttle: 1 };
      }
      default: go(c, 'close');
    }
    return null;
  },
};

/**
 * THE ACE: a pilot who picks his own moves, from the ones the school's
 * fights proved (features/dogfight-school, "The lessons"):
 *
 *   - someone on his tail inside the guns' reach: break into him;
 *   - someone diving on him: turn flat to face the dive;
 *   - a target ahead and inside the guns' reach: lead pursuit, the throttle
 *     eased so he does not fly past, and shallow (25 degrees at most) if the
 *     target climbs away;
 *   - height over the target and the target not facing him: boom and zoom;
 *   - otherwise: bank energy, the climb a Spitfire holds all day, out to one
 *     side of him and out of his reach, until he has the height to bounce.
 *
 * A move holds for a moment once chosen (a break for 2.5 s, a dive until its
 * pass is done) so he does not dither between two.
 */
PLANS.ace = {
  title: 'The ace', first: 'climb',
  says: {
    climb: 'Buying height, out of his reach',
    dive: 'Diving on him from above',
    zoom: 'Zooming back up on the dive\'s speed',
    over: 'Over the top, nose back down on him',
    break: 'He is on my tail: breaking into him',
    meet: 'He is coming at me: turning to face him',
    attack: 'Behind him, closing to shoot',
    follow: 'He is climbing away: following shallow',
  },
  step(c) {
    const { me, him, g, mem } = c;
    const h = heading(me.velocity);
    const reach = c.gun.range;
    // Close in, his nose needs to be less on me to be a threat.
    const threat = g.hisAta < (g.range < 160 ? 60 : 35) && g.ata > 90 && g.range < reach + 120;
    // Coming at him, from above or behind and still out of reach: face him
    // now rather than climb slowly away and let him in behind.
    const diving = (him.velocity[1] < -10 && g.hisAta < 45 && g.above > 60 && g.range < 900)
      || (g.hisAta < 40 && g.ata > 60 && g.range < 900 && g.range > reach);
    // A target going away from him is no threat: go for him, from any range.
    const shot = (g.ata < 70 && g.hisAta > 70 && g.range < reach * 2) || (g.hisAta > 110 && g.range < 2000);
    const height = -g.above;
    const hold = { break: 2.5, meet: 2, dive: 3, zoom: 3, over: 2 }[mem.phase] ?? 0;
    const busy = mem.since < hold || (mem.phase === 'dive' && g.range > 90 && mem.since < 30 && g.ata < 70 && (g.closure > 0 || mem.since < 6));
    if (!busy || threat) {
      if (threat) { if (mem.phase !== 'break') mem.breakSide = g.side; go(c, 'break'); }
      else if (diving) go(c, 'meet');
      else if (mem.phase === 'dive' && (g.range < 90 || g.ata > 70)) go(c, 'zoom');
      else if (mem.phase === 'zoom' && (g.mySpeed < 40 || mem.since > 8)) { mem.overSide = undefined; go(c, 'over'); }
      else if (mem.phase === 'over' && (g.ata < 40 || mem.since > 6)) go(c, height > 150 ? 'dive' : 'climb');
      else if (shot) go(c, him.velocity[1] > 8 && pitchOf(him.orientation) > 30 ? 'follow' : 'attack');
      else if (height > 220 && g.hisAta > 50 && g.range < 1300) go(c, 'dive');
      else if (!['zoom', 'over'].includes(mem.phase)) go(c, 'climb');
    }
    switch (mem.phase) {
      case 'break': {
        // Stuck in a circle with him close behind, chop the throttle: the
        // brake bites after three seconds and he flies out in front.
        const chop = mem.since > 4 && g.range < 160 && g.mySpeed > 32;
        return { ...hardTurn(me, mem.breakSide ?? g.side), throttle: chop ? -1 : 1, say: chop ? 'Throttle back: making him fly past' : undefined };
      }
      case 'meet': {
        const lp = sub(leadPoint(me, him, c.gun), me.position);
        return { ...(g.range > 320 ? turnToward(c, lp, { maxUp: 30 }) : pointNose(me, lp, { fine: 8, push: 0.4, ...aim(c) })), throttle: 1 };
      }
      case 'attack': {
        // Far out, the run in: pure pursuit, any height over him spent on
        // speed; inside 450 m, the guns' lead, the throttle eased so he does
        // not fly past.
        if (g.range > 450) {
          const toward = unit(sub(him.position, me.position));
          const dive = height > 20 ? -Math.min(14, height / g.range * 57 + 6) : 0;
          return { ...pointNose(me, climbing(heading(toward), Math.max(dive, Math.asin(clamp(toward[1])) / DEG)), { fine: 6, push: 0.6 }), throttle: 1 };
        }
        return { ...leadPursuit(c), throttle: g.closure > 15 && g.range < 220 ? 0.2 : 1 };
      }
      case 'follow': {
        const lp = sub(leadPoint(me, him, c.gun), me.position);
        return { ...turnToward(c, lp, { maxUp: 25 }), throttle: 1 };
      }
      case 'dive': {
        // Far out, the dive goes under him, steep enough to turn the height
        // into speed; inside 500 m it is the guns' lead.
        if (g.range < 500) return { ...leadPursuit(c, { push: 0.7 }), throttle: 1 };
        const lp = leadPoint(me, him, c.gun);
        const under = Math.min(0.3 * g.range, Math.max(0, height) * 0.9 + 40);
        return { ...pointNose(me, sub(sub(lp, [0, under, 0]), me.position), { fine: 8, push: 0.7 }), throttle: 1 };
      }
      case 'zoom': return { ...pointNose(me, climbing(h, easedClimb(c, climbAngle(g.mySpeed))), { fine: 6 }), throttle: 1 };
      case 'over': {
        const k = pitchOf(me.orientation) > 10 ? wingover(c) : pointNose(me, sub(him.position, me.position), { fine: 12 });
        return { ...k, throttle: 1 };
      }
      case 'climb':
      default: {
        // Round him at a stand-off, about 700 m out and outside his guns,
        // keeping to the side he is already turning on, at the climb that
        // banks the most energy for the speed.
        const toward = heading(sub(him.position, me.position));
        // Never let him run: past 900 m, straight after him, a shallow dive
        // buying the speed to close.
        if (g.range > 900) {
          const angle = height > 30 ? -8 : clamp((g.mySpeed - 75) * 0.8, -12, 4);
          return { ...pointNose(me, climbing(toward, angle), { fine: 6 }), throttle: 1, say: 'He is running: closing on him' };
        }
        const side = [-toward[2], 0, toward[0]];
        if (mem.orbit === undefined || mem.since < c.dt) mem.orbit = Math.sign(dot(h, side)) || 1;
        const pull = clamp((g.range - 700) / 300, -0.9, 1.5);
        const dir = unit(add(scale(side, mem.orbit), scale(toward, pull)));
        const angle = clamp((g.mySpeed - 36) * 1.6, -5, 26);
        return { ...pointNose(me, climbing(dir, angle), { fine: 6 }), throttle: 1 };
      }
    }
  },
};
