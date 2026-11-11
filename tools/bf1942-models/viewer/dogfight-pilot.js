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

import { underRoof } from './dogfight-jet-ceiling.js';
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
    side: sideOf(mine, los),
    hisSide: sideOf(his, scale(los, -1)),
  };
}

/**
 * Which side of me `los` lies, +1 right, -1 left, judged on the horizon
 * against my heading: in a hard bank the wings' own right points mostly
 * down, and "is he on my right" would come back as "is he below me". Only
 * with the nose near the vertical, where there is no heading, do the wings
 * answer.
 */
export function sideOf(b, los) {
  const fx = b.F[0], fz = b.F[2];
  if (Math.hypot(fx, fz) < 0.25) return Math.sign(b.R[0] * los[0] + b.R[2] * los[2]) || 1;
  // The horizon's right of the heading (the nose runs down -z at heading 0).
  return Math.sign(-fz * los[0] + fx * los[2]) || 1;
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
 * What a pilot is trying to do in each phase, the question the theatre
 * answers on screen: going for the shot (`attack`), getting out of the
 * other's (`defend`), or buying the height, speed or angle for the next one
 * (`setup`). Every phase of every plan is here; the tests hold it.
 */
export const INTENTS = {
  boomAndZoom: { climb: 'setup', perch: 'setup', dive: 'attack', zoom: 'setup', reverse: 'setup' },
  upAndOver: { run: 'setup', pull: 'setup', over: 'setup', pounce: 'attack', zoom: 'setup' },
  breakTurn: { watch: 'setup', break: 'defend', reverse: 'defend', turn: 'defend', chase: 'attack' },
  btFlip: { watch: 'setup', break: 'defend', turn: 'defend', 'flip-zoom': 'defend', 'flip-over': 'setup', 'flip-guns': 'attack', 'flip-up': 'setup', 'flip-top': 'setup', 'flip-dive': 'attack' },
  btNinja: { break: 'defend', zoom: 'setup', over: 'setup', dive: 'attack', leave: 'defend' },
  btDip: { break: 'defend', zoom: 'setup', over: 'setup', dive: 'attack', leave: 'defend', 'dip-run': 'defend' },
  scissors: { reverse: 'setup', cross: 'setup', shoot: 'attack' },
  scAce: { reverse: 'setup', cross: 'setup', shoot: 'attack', chase: 'attack', 'let-go': 'setup', meet: 'defend' },
  scDip: { reverse: 'setup', cross: 'setup', shoot: 'attack', 'dip-run': 'defend' },
  scClimber: { reverse: 'setup', cross: 'setup', shoot: 'attack', chase: 'attack', 'let-go': 'setup', meet: 'defend',
               climb: 'setup', face: 'defend', snap: 'attack' },
  scFlip: { reverse: 'setup', cross: 'setup', shoot: 'attack', 'flip-reverse': 'setup', 'flip-cross': 'setup', 'flip-shoot': 'attack' },
  scNinja: { 'ninja-up': 'setup', over: 'setup', find: 'setup', dive: 'attack', zoom: 'setup', beam: 'defend', climb: 'setup' },
  turnarounds: { pass: 'setup', immelmann: 'setup', rollout: 'setup', top: 'setup', split: 'setup', pullthrough: 'setup', run: 'setup', attack: 'attack' },
  turnaroundsMeetTop: { hold: 'setup', aim: 'attack', shoot: 'attack', extend: 'setup' },
  turnaroundsFollow: { pass: 'setup', up: 'attack', hang: 'setup', fall: 'setup', chase: 'attack' },
  turnaroundsLetGo: { cruise: 'setup', watch: 'setup' },
  turnaroundsBoom: { cruise: 'setup', dive: 'attack', zoom: 'setup', watch: 'setup' },
  taAce: { pass: 'setup', immelmann: 'setup', rollout: 'setup', top: 'setup', split: 'setup', pullthrough: 'setup', run: 'setup', attack: 'attack', chase: 'attack', 'let-go': 'setup', meet: 'defend' },
  taDip: { pass: 'setup', 'dip-turn': 'defend', 'dip-run': 'defend' },
  taNinja: { wait: 'setup', dive: 'attack', 'dip-out': 'defend', 'dip-turn': 'defend', 'dip-run': 'defend' },
  taFlip: { pass: 'setup', 'flip-turn': 'defend', 'flip-climb': 'attack', 'flip-seen': 'attack', find: 'setup', dive: 'attack', zoom: 'setup', over: 'setup', beam: 'defend', climb: 'setup', leave: 'setup', back: 'setup' },
  chaser: { chase: 'attack', turn: 'attack', lost: 'setup' },
  shallowFollow: { chase: 'attack', follow: 'setup', shoot: 'attack' },
  followStraightUp: { chase: 'attack', up: 'attack', hang: 'setup', recover: 'setup', search: 'setup', break: 'defend' },
  uoAce: { run: 'setup', pull: 'setup', over: 'setup', pounce: 'attack', zoom: 'setup', chase: 'attack', 'let-go': 'setup', meet: 'defend', break: 'defend' },
  uoDip: { chase: 'attack', 'dip-follow': 'setup', 'dip-pass': 'defend', 'dip-run': 'defend' },
  uoFlip: { chase: 'attack', up: 'setup', 'flip-dive': 'defend', 'flip-follow': 'setup', 'flip-shoot': 'attack', 'flip-pass': 'defend', 'flip-slice': 'setup', 'flip-back': 'attack', 'flip-stalk': 'attack',
    find: 'setup', dive: 'attack', zoom: 'setup', over: 'setup', beam: 'defend', climb: 'setup', leave: 'setup', back: 'setup' },
  uoNinja: { chase: 'attack', 'ninja-follow': 'setup', 'ninja-shoot': 'attack', 'ninja-pass': 'defend', 'ninja-slice': 'setup', 'ninja-back': 'attack', 'ninja-stalk': 'attack',
    find: 'setup', dive: 'attack', zoom: 'setup', over: 'setup', beam: 'defend', climb: 'setup', leave: 'setup', back: 'setup' },
  uoAceSharp: { run: 'setup', pull: 'setup', over: 'setup', pounce: 'attack', zoom: 'setup', chase: 'attack', 'let-go': 'setup', meet: 'defend', break: 'defend' },
  unaware: { cruise: 'setup' },
  circler: { turn: 'defend' },
  cruiser: { cruise: 'setup' },
  target: { straight: 'setup', turn: 'setup', jink: 'defend', climb: 'setup' },
  leafAce: { cruise: 'setup', fall: 'defend', recover: 'setup', attack: 'attack' },
  leafFooled: { chase: 'attack', done: 'setup' },
  leafFollow: { chase: 'attack', follow: 'setup', pounce: 'attack' },
  wingman: { station: 'setup', rejoin: 'setup', cover: 'attack', shoot: 'attack' },
  weaver: { abreast: 'setup', weave: 'defend', shoot: 'attack' },
  underTail: { approach: 'setup', climb: 'attack', drop: 'setup' },
  meetTheDive: { climb: 'setup', face: 'defend', pass: 'defend', extend: 'setup' },
  bzDip: { climb: 'setup', face: 'defend', pass: 'defend', extend: 'setup', 'dip-run': 'defend' },
  bzAce: { climb: 'setup', perch: 'setup', dive: 'attack', zoom: 'setup', reverse: 'setup', 'let-go': 'setup' },
  bzFlip: { climb: 'setup', face: 'defend', pass: 'defend', extend: 'setup', 'flip-in': 'attack', 'flip-off': 'setup', 'flip-leave': 'defend' },
  bzNinja: { climb: 'setup', face: 'defend', pass: 'defend', extend: 'setup', 'ninja-perch': 'setup', 'ninja-dive': 'attack', 'ninja-zoom': 'setup', 'ninja-over': 'setup', 'ninja-run': 'defend' },
  bzAceMeet: { climb: 'setup', perch: 'setup', dive: 'attack', zoom: 'setup', reverse: 'setup', 'let-go': 'setup', meet: 'defend' },
  dontFollow: { chase: 'attack', peel: 'setup', face: 'defend', shoot: 'attack' },
  patientAttacker: { close: 'attack', yoyo: 'setup', back: 'attack' },
  hunter: { hunt: 'attack', track: 'attack', lag: 'attack', follow: 'setup', extend: 'defend', headon: 'attack' },
  btHunter: { hunt: 'attack', track: 'attack', lag: 'attack', follow: 'setup', extend: 'defend', headon: 'attack', 'let-go': 'setup', meet: 'defend' },
  lockChop: { watch: 'setup', turn: 'defend', chop: 'defend', chase: 'attack', shoot: 'attack' },
  meetHim: { watch: 'setup', turn: 'defend', meet: 'attack', pass: 'setup' },
  olHunter: { hunt: 'attack', track: 'attack', lag: 'attack', follow: 'setup', extend: 'defend', headon: 'attack', 'let-go': 'setup', meet: 'attack' },
  olAce: { hunt: 'attack', track: 'attack', lag: 'attack', follow: 'setup', extend: 'defend', headon: 'attack', 'let-go': 'setup', meet: 'attack' },
  olDip: { watch: 'setup', turn: 'defend', meet: 'setup', 'dip-run': 'defend' },
  olFlip: { watch: 'setup', turn: 'defend', meet: 'setup', 'flip-up': 'attack', find: 'setup', dive: 'attack', zoom: 'setup', over: 'setup', beam: 'defend', climb: 'setup', leave: 'setup', back: 'setup' },
  olNinja: { watch: 'setup', turn: 'defend', meet: 'setup', 'ninja-up': 'attack', find: 'setup', dive: 'attack', zoom: 'setup', over: 'setup', beam: 'defend', climb: 'setup', leave: 'setup', back: 'setup', 'ninja-perch': 'setup' },
  olHardTurn: { watch: 'setup', turn: 'defend' },
  olChop: { watch: 'setup', turn: 'defend', chop: 'defend', chase: 'attack', shoot: 'attack' },
  olDiveOut: { watch: 'setup', dive: 'defend', zoom: 'setup', back: 'setup', turn: 'defend' },
  olMeetHim: { watch: 'setup', turn: 'defend', meet: 'attack', pass: 'setup' },
  flatTurn: { turn: 'defend' },
  chopper: { watch: 'setup', turn: 'defend', chop: 'defend', reverse: 'attack', shoot: 'attack' },
  lockHardTurn: { watch: 'setup', turn: 'defend' },
  diveOut: { watch: 'setup', dive: 'defend', zoom: 'setup', back: 'setup', turn: 'defend' },
  climbStraight: { climb: 'setup' },
  climbBetween: { climb: 'setup', break: 'defend' },
  uhAce: { climb: 'setup', perch: 'setup', dive: 'attack', zoom: 'setup', reverse: 'setup', chase: 'attack', 'let-go': 'setup', meet: 'defend' },
  uhDip: { climb: 'setup', break: 'defend', 'dip-run': 'defend' },
  uhFlip: { climb: 'setup', break: 'defend', 'flip-reverse': 'attack', find: 'setup', dive: 'attack', zoom: 'setup', over: 'setup', beam: 'defend', leave: 'setup', back: 'setup', out: 'defend' },
  uhNinja: { climb: 'setup', break: 'defend', find: 'setup', dive: 'attack', zoom: 'setup', over: 'setup', beam: 'defend', leave: 'setup', back: 'setup', out: 'defend' },
  breaker: { watch: 'setup', break: 'defend', chop: 'defend', reverse: 'attack' },
  arriveSlow: { close: 'attack', above: 'setup', shoot: 'attack' },
  lagBack: { close: 'attack', lag: 'setup', shoot: 'attack' },
  otBreaker: { watch: 'setup', break: 'defend', chop: 'defend', reverse: 'attack', chase: 'attack', letgo: 'setup', meet: 'defend', extend: 'defend' },
  otDip: { close: 'attack', circle: 'attack', 'dip-out': 'defend' },
  otYoyo: { close: 'attack', circle: 'attack', 'flip-up': 'setup', 'flip-dive': 'attack' },
  otOutWide: { close: 'attack', lag: 'setup', shoot: 'attack' },
  otAce: { watch: 'setup', break: 'defend', chop: 'defend', reverse: 'attack', chase: 'attack', letgo: 'setup', meet: 'defend', extend: 'defend', climb: 'setup' },
  otNinja: { 'ninja-climb': 'setup', 'ninja-in': 'attack', dive: 'attack', 'ninja-off': 'setup', zoom: 'setup', over: 'setup', find: 'setup', beam: 'defend' },
  ace: { climb: 'setup', dive: 'attack', zoom: 'setup', over: 'setup', break: 'defend', meet: 'defend', attack: 'attack', follow: 'setup' },
  ascend: { find: 'setup', dive: 'attack', zoom: 'setup', over: 'setup', beam: 'defend', climb: 'setup', leave: 'setup', back: 'setup' },
  ciCircle: { circle: 'defend' },
  ciDip: { circle: 'defend', 'dip-run': 'defend' },
  ciZoom: { circle: 'defend', zoom: 'setup', over: 'setup', dive: 'attack', up: 'setup', again: 'defend' },
  ciBack: { circle: 'defend', out: 'defend', back: 'setup', stalk: 'attack', guns: 'attack', off: 'defend' },
  ciChop: { circle: 'defend', 'flip-chop': 'defend' },
  ciReverse: { circle: 'defend', 'flip-reverse': 'setup', 'flip-guns': 'attack' },
  ciLow: { circle: 'defend', 'flip-low': 'setup', 'flip-up': 'attack', 'flip-off': 'defend' },
};

/** A phase's intent: its plan's word, `defend` for the reflex's break,
 *  `setup` for anything else (the floor, the fence). `stepPilot` makes it
 *  `attack` while he fires. */
export function intentOf(plan, phase, recovering = false) {
  if (recovering) return 'setup';
  if (phase === 'evade') return 'defend';
  return INTENTS[plan]?.[phase] ?? 'setup';
}

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

// --- the eyes (features/dogfight-school/reviews/eyes.md) --------------------

/**
 * What a Spitfire pilot sees of the other plane from his seat. Angles in
 * degrees off his own nose and wings, times in seconds; each number's source
 * is in eyes.md.
 */
export const EYES = {
  front: 15,       // the windscreen and the gunsight: always in view
  tail: 20,        // the cone astern hidden by the armoured headrest and the rear decking
  below: 10,       // more than this under the wings' plane the wing hides him ...
  belowTail: 5,    // ... rising to this astern, where the fuselage does
  watch: 90,       // the front hemisphere is watched all the time
  glance: 1,       // a look over one shoulder at the sky behind lasts this long ...
  glanceEvery: 2.5, // ... one every this, left and right in turn
  glanceG: 4,      // above this load no glances: the eyes stay forward and up into the turn
  roof: 30,        // the inside of a hard turn: this far above the wings, up through the canopy
  notice: 0.8,     // seeing a plane he has not been watching takes this long
  reacquire: 0.25, // finding again one he has just had, where he expected it
  lose: 4,         // working on where he was, carried forward, for this long
};

/** Where a point sits off a plane's nose (`az`, 0 ahead, 180 astern) and
 *  above its wings (`el`), and on which side (+1 right). */
export function sightLine(state, point) {
  const rel = sub(point, state.position);
  const d = len(rel);
  const los = d > 1e-6 ? scale(rel, 1 / d) : [0, 0, -1];
  const b = basis(state.orientation);
  return { az: Math.acos(clamp(dot(los, b.F))) / DEG, el: Math.asin(clamp(dot(los, b.U))) / DEG,
           side: Math.sign(dot(los, b.R)) || 1 };
}

/** Whether the cockpit hides a point at `az` and `el` (degrees, as
 *  `sightLine`): the cone astern and the sky under the wings. Ahead, in the
 *  windscreen, nothing is hidden. */
export function blind(az, el) {
  if (az <= EYES.front) return false;
  if (az >= 180 - EYES.tail) return true;
  const floor = az <= 90 ? -EYES.below : -EYES.below + (EYES.below - EYES.belowTail) * (az - 90) / 90;
  return el < floor;
}

/** Whether the pilot of `state` could see `point` from his seat if he looked. */
export const hiddenFrom = (state, point) => { const s = sightLine(state, point); return blind(s.az, s.el); };

/**
 * One tick of a pilot's eyes on the other plane. He watches his front
 * hemisphere all the time and glances behind over one shoulder, then the
 * other; a plane he has noticed he keeps his eyes on wherever the cockpit
 * lets him (over the shoulder in a break); one he has not been watching he
 * notices only after `EYES.notice`. Unseen, he flies on where he last saw
 * him, carried forward; after `EYES.lose` he knows he has lost him. Returns
 * the plane as he knows it and what he knows.
 */
export function perceive(mem, me, him, dt) {
  const line = sightLine(me, him.position);
  const blocked = blind(line.az, line.el);
  // His load: what his eyes can do under it.
  if (mem.myV) {
    const a = scale(sub(me.velocity, mem.myV), 1 / Math.max(1e-3, dt));
    // The wings' push on him in the Earth's g, what a body feels (the
    // engine's gravity is 1.5 of it).
    const n = len([a[0], a[1] + G, a[2]]) / 9.80665;
    mem.load = mem.load === undefined ? n : mem.load * 0.8 + n * 0.2;
  }
  mem.myV = me.velocity.slice();
  let eye = mem.eye;
  if (!eye) {
    // The fight starts with both pilots aware: he has the other plane if
    // the cockpit lets him see it at all (ahead, dipping a wing if he must),
    // and knows where it was if not.
    eye = mem.eye = { sees: !blocked || line.az <= EYES.watch, known: true, unseen: 0, look: 0, offset: ((mem.rng ?? 1) % 997) / 997 * 2 * EYES.glanceEvery,
                      p: him.position.slice(), v: him.velocity.slice(), q: { ...him.orientation } };
  }
  const recent = eye.known && eye.unseen < EYES.lose;
  // A plane he is watching that goes under his nose or wing ahead of the
  // beam he keeps in sight by dipping a wing to look; under the tail, or one
  // he has not been watching, stays hidden.
  const hidden = blocked && !(recent && line.az <= EYES.watch && line.az < 180 - EYES.tail);
  const cycle = (mem.t + eye.offset) % (2 * EYES.glanceEvery);
  const glanceSide = cycle < EYES.glance ? -1 : cycle >= EYES.glanceEvery && cycle < EYES.glanceEvery + EYES.glance ? 1 : 0;
  // Pulling hard he stops glancing behind, and looks where the turn is
  // going: up through the canopy, the inside of the turn.
  const pulling = (mem.load ?? 1) >= EYES.glanceG;
  const glancing = glanceSide !== 0 && !pulling;
  // In a clearing turn he looks back into the turn the whole time. A look
  // over either shoulder takes in the sky high behind, over the headrest.
  const clearing = mem.phase === 'clear' && line.side === mem.clearSide && !pulling;
  const inView = !hidden && (recent || line.az <= EYES.watch || clearing || (pulling && line.el >= EYES.roof)
    || (glancing && (line.side === glanceSide || line.el >= EYES.roof)));
  eye.look = inView ? eye.look + dt : 0;
  if (eye.sees && !inView) eye.sees = false;
  // In the windscreen, in front of his guns, he sees him at once.
  else if (!eye.sees && inView && (line.az <= EYES.front || eye.look >= (recent ? EYES.reacquire : EYES.notice))) eye.sees = true;
  if (eye.sees) {
    eye.p = him.position.slice(); eye.v = him.velocity.slice(); eye.q = { ...him.orientation };
    eye.unseen = 0; eye.known = true;
  } else eye.unseen += dt;
  eye.glancing = glancing ? glanceSide : 0;
  const lost = !eye.known || eye.unseen >= EYES.lose;
  const state = eye.sees ? him : {
    position: add(eye.p, scale(eye.v, Math.min(eye.unseen, EYES.lose))), velocity: eye.v.slice(),
    orientation: { ...eye.q }, angularVelocity: [0, 0, 0],
  };
  return { him: state, sees: eye.sees, lost, unseen: eye.unseen };
}

function stepPilot(pilot, def, ctx) {
  const { me } = ctx;
  const mem = pilot.mem;
  mem.t += ctx.dt;
  mem.since += ctx.dt;
  // Every plan sees the other plane through its pilot's eyes: where he is,
  // or, unseen, where he was last seen, carried forward.
  const eyes = perceive(mem, me, ctx.him, ctx.dt);
  const him = eyes.him;
  if (!eyes.sees) mem.hisV = undefined;
  const g = Object.assign(geometry(me, him), { sees: eyes.sees, lost: eyes.lost, unseen: eyes.unseen });
  const ground = ctx.groundAt ? ctx.groundAt(me.position[0], me.position[2]) : 0;
  const agl = me.position[1] - ground;
  // His acceleration, from his velocity a tick ago, smoothed: what bends
  // the lead round a turning target.
  if (mem.hisV) {
    const a = scale(sub(him.velocity, mem.hisV), 1 / Math.max(1e-3, ctx.dt));
    mem.hisA = mem.hisA ? add(scale(mem.hisA, 0.8), scale(a, 0.2)) : a;
  }
  mem.hisV = him.velocity.slice();
  const c = { ...ctx, him, g, agl, mem, pilot, gun: { ...pilot.gun, accel: mem.hisA ?? null }, ground };
  // The floor and the ceiling come before any plan.
  const safe = guard(c) ?? fence(c);
  const search = !safe ? clearTurn(c) : null;
  const evade = !safe && !search && def.reflex ? reflex(c, def) : null;
  let out = safe ?? search ?? evade ?? def.step(c) ?? hold(c);
  // A jet's pilot knows where the top of the sky is: whatever his plan
  // answers is kept under the roof (`dogfight-jet-ceiling.js`), unless it is
  // going over the top of a loop (`roof: false`). The Spitfire's (pace 1)
  // never get there and are not touched.
  if (!safe && c.pace > 1 && out.roof !== false) out = underRoof(c, out);
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
    recovering: !!safe, geometry: g, sees: eyes.sees,
    // A pilot on the trigger is going for the shot, whatever his phase was
    // for: the snap shot at the top of a zoom is still a shot.
    intent: fire ? 'attack' : intentOf(pilot.plan, mem.phase, !!safe),
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
 * the nose comes down to the horizon. The 880 m is the sky's, not the
 * airframe's: a pilot shown the fight at the Spitfire's size
 * (`dogfight-duel.js` `pilotView`) reads it over its pace (`c.pace`), or a
 * jet's guard would wait for 1,126 m real on the F-16, past where a wing
 * lifts at all.
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
  if (me.position[1] - (c.ceilingBase ?? 0) > 880 / (c.pace >= 1 ? c.pace : 1) && vy > 0) {
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
  // Only a man he has seen there: one who slips out of sight a moment he
  // still breaks from, where he last saw him.
  const threat = !g.lost && g.hisAta < 30 && g.ata > 100 && g.range < (c.gun.range + 60);
  if (threat && (g.sees || mem.phase === 'evade') && !(def.committed ?? []).includes(mem.phase)) {
    if (mem.phase !== 'evade') { mem.resume = mem.phase; mem.breakSide = g.side; go(c, 'evade'); }
  }
  if (mem.phase !== 'evade') return null;
  if (!threat && mem.since > 2.5) { go(c, mem.resume ?? def.first); return null; }
  return { ...hardTurn(c.me, mem.breakSide ?? g.side), throttle: 1, say: 'He is on my tail: breaking into him' };
}

/**
 * A pilot who has lost the other plane turns to find him: a level turn at
 * `CLEAR.bank` toward where he last had him, looking back into the turn
 * (`perceive`), until he sees him again or has turned `CLEAR.for` seconds;
 * then his plan goes on, and he clears again no sooner than `CLEAR.every`
 * later. Not while his plan is defending (running from him, breaking): a
 * pilot running from a man behind him does not turn back to look.
 */
const CLEAR = { bank: 60, for: 6, every: 4 };
/** The school's pilots who by design never look round: the man flying
 *  straight and level under attack, and the one who never looks up. */
const NEVER_CLEARS = new Set(['cruiser', 'unaware', 'target', 'leafFooled']);
function clearTurn(c) {
  const { g, mem, me } = c;
  if (NEVER_CLEARS.has(c.pilot.plan)) return null;
  if (mem.phase === 'clear') {
    if (g.sees || mem.since > CLEAR.for) {
      // Back to the plan's phase as if it had never left it: its clocks run on.
      const { since, entered } = mem.clearFrom ?? {};
      const was = mem.since;
      go(c, mem.clearResume ?? 'start');
      if (since !== undefined) {
        mem.since = since + was;
        mem.enter = { ...mem.enter, [mem.phase]: entered ?? mem.enter[mem.phase] };
      }
      mem.clearedAt = mem.t;
      return null;
    }
  } else {
    if (!g.lost || mem.t - (mem.clearedAt ?? -99) < CLEAR.every) return null;
    if (mem.phase === 'evade' || intentOf(c.pilot.plan, mem.phase) === 'defend') return null;
    mem.clearResume = mem.phase;
    mem.clearFrom = { since: mem.since, entered: mem.enter?.[mem.phase] };
    go(c, 'clear');
  }
  // Toward where he was last seen, by the horizon; rolled past the usual
  // bank when that is well below, so the wing does not hide it.
  const h = heading(me.velocity), right = [-h[2], 0, h[0]];
  const to = sub(c.him.position, me.position);
  const across = dot(to, right), down = -to[1];
  if (mem.phase === 'clear' && (mem.clearSide === undefined || mem.since === 0 || Math.abs(across) > Math.hypot(to[0], to[2]) * 0.5)) {
    mem.clearSide = Math.sign(across) || 1;
  }
  const bank = clamp(Math.atan2(down, Math.abs(across)) / DEG + 10, CLEAR.bank, 100);
  const pull = clamp(0.3 - me.velocity[1] * 0.08, -0.4, 1);
  return { ...bankAndPull(me, mem.clearSide * bank, pull), throttle: 1, aimed: false,
           say: 'I have lost him: turning to clear my tail' };
}

/**
 * The fight's fence: `ctx.arena` (`{ centre: [x, z], radius }`, metres) keeps
 * a pilot over the ground the fight belongs to. Past the radius and still
 * flying outward he turns back toward the middle, level, unless an enemy is
 * about to shoot him (then the plan's own break comes first). Without an
 * arena, as the theatre's duels fly, nothing is fenced.
 */
function fence(c) {
  const arena = c.arena;
  if (!arena) return null;
  const { me, g } = c;
  const dx = me.position[0] - arena.centre[0], dz = me.position[2] - arena.centre[1];
  const out = Math.hypot(dx, dz);
  const outward = (me.velocity[0] * dx + me.velocity[2] * dz) / Math.max(1, out);
  // Once over the fence he flies home until he is 500 m back inside it, so
  // his plan cannot turn him straight back out again.
  if (c.mem.fenced && out < arena.radius - 500) c.mem.fenced = false;
  if (!c.mem.fenced && (out < arena.radius || outward <= 0)) return null;
  if (g.hisAta < 35 && g.ata > 90 && g.range < c.gun.range + 60) return null;
  c.mem.fenced = true;
  const home = [-dx, 0, -dz];
  return { ...turnToward(c, home, { maxUp: 5, maxDown: 5 }), throttle: 1, say: 'Too far out: turning back to the fight' };
}

function hold(c) {
  return { ...pointNose(c.me, heading(c.me.velocity)), throttle: 1 };
}

/** The trigger: a gun solution inside the reach, held as long as it lasts.
 *  A less skilled pilot opens fire less tightly. */
function shoot(c, aimed) {
  if (!aimed || !c.g.sees) return false;
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

/** What the boom-and-zoomer says climbing once his height is gone. */
const LOST_HEIGHT = 'He has my height now: climbing to get it back';

/**
 * BOOM AND ZOOM. Height first: from above him, dive at full speed, hold
 * fire until he fills the sight, one short burst, and use the dive's speed
 * to zoom back up before he can turn to meet you. At the top, a wingover
 * and down again while the height lasts. Never turn with him. If he turns
 * to face the dive there is no free shot: pull out above him and zoom.
 */
PLANS.boomAndZoom = {
  title: 'Boom and zoom', first: 'climb', reflex: true, committed: ['dive', 'zoom'],
  says: {
    climb: 'Climbing above him, out of his reach',
    perch: 'Sitting high: picking the moment',
    dive: 'Diving on him: all the speed of the fall',
    zoom: 'Zooming back up on the dive\'s speed',
    reverse: 'Turning over the top to come down again',
    evade: 'He is on my tail: breaking into him',
  },
  step(c) {
    const { me, him, g, mem, dt } = c;
    const h = heading(me.velocity);
    const toward = heading(sub(him.position, me.position));
    const high = -g.above;
    // Whether he has turned to face me, read on the horizon: a fighter's
    // nose cannot come up to a diver 50 degrees above him.
    const facing = angleBetween(heading(him.velocity), heading(sub(me.position, him.position))) < 60;
    switch (mem.phase) {
      case 'climb': {
        // Buy the height back without wandering off: close in, straight on
        // the heading he came out of the reversal with (chasing a bearing
        // round a man turning hard is a sinking turn of his own); past
        // 700 m, a climbing turn back toward him. The climb is the best
        // sustained one, 20 to 30 degrees, slower with less speed.
        if (!mem.climbDir) mem.climbDir = h;
        const angle = clamp((g.mySpeed - 36) * 1.6, -5, 26);
        const flat = g.range > 700 ? toward : mem.climbDir;
        if (high > 150 && g.range > 450) { mem.climbDir = undefined; go(c, 'perch'); }
        const say = high < 30 ? LOST_HEIGHT : undefined;
        return { ...pointNose(me, climbing(flat, angle), { fine: 6 }), throttle: 1, aimed: false, say };
      }
      case 'perch': {
        // Level, toward him, until he is far enough below to dive on.
        const lookDown = Math.asin(clamp(-g.los[1])) / DEG;
        if (lookDown > 35 || mem.since > 10) go(c, 'dive');
        return { ...turnToward(c, climbing(toward, 0), { maxUp: 0, maxDown: 0 }), throttle: 1, aimed: false };
      }
      case 'dive': {
        // Lead him down, never steeper than 50 degrees (a target that has
        // turned under the dive is not worth a vertical pull-out), and hold
        // fire until he fills the sight: inside 130 m (`mem.open`), three seconds from
        // the merge on a slow one, or the last moment before the pull-out.
        const lp = sub(leadPoint(me, him, c.gun), me.position);
        const elev = Math.asin(clamp(unit(lp)[1])) / DEG;
        const k = elev < -50 ? pointNose(me, climbing(heading(lp), -50), { fine: 8, push: 0.7 }) : leadPursuit(c, { pull: 1, push: 0.7 });
        if (c.pilot.fire) mem.shotT = (mem.shotT ?? 0) + dt;
        // Back up after one short burst (`mem.burst`, 0.6 s unless the
        // lesson says: fewer rounds than bring a fighter down, so it takes
        // him more than one pass), a second from the merge, before the
        // pull-out would take him under his height (the arc of a pull at about 50 degrees a second from this
        // dive angle, and a moment to start it), or once he has turned to
        // face the dive inside 350 m.
        const toMerge = g.closure > 1 ? g.range / g.closure : Infinity;
        const dive = Math.max(0, -pitchOf(me.orientation)) * DEG;
        const bottom = high - (g.mySpeed / 0.9) * (1 - Math.cos(dive)) - 0.3 * Math.max(0, -me.velocity[1]) + 0.5 * Math.min(0, him.velocity[1]);
        if ((mem.shotT ?? 0) > (mem.burst ?? 0.6) || toMerge < 1.2 || bottom < 0 || (facing && g.range < 350) || mem.since > 25) {
          // The burst is over: guns quiet, nose coming up off him. Until it
          // is off him (half a second at most) the pass is still his.
          mem.offT = (mem.offT ?? 0) + dt;
          if (mem.offT < 0.5 && gunSolution(me, him, { ...c.gun, width: 5 }).fire) {
            return { ...pointNose(me, climbing(h, 15), { fine: 6 }), throttle: 1, aimed: false };
          }
          mem.offT = 0;
          mem.shotT = 0;
          mem.climbDeg = undefined;
          go(c, 'zoom');
          return { ...k, throttle: 1, aimed: false, say: facing && g.range < 350 ? 'He has turned to face me: no shot, back up' : undefined };
        }
        return { ...k, throttle: 1, aimed: g.range < (mem.open ?? 130) || (toMerge < 3 && g.range < 250) || (bottom < 15 && g.range < 250) };
      }
      case 'zoom': {
        // Up on the dive's speed at 35 degrees, away from his nose: steep
        // enough to be out of his reach, shallow enough to keep the energy.
        const k = pointNose(me, climbing(h, easedClimb(c, 35, 40)), { fine: 6 });
        if ((g.mySpeed < 55 && mem.since > 1.5) || mem.since > 9) go(c, 'reverse');
        return { ...k, throttle: 1, aimed: false };
      }
      case 'reverse': {
        // A wingover: the lift onto his side of the sky, the nose coming down
        // toward him. Still 100 m over him, dive again; without the height,
        // climb.
        const k = pitchOf(me.orientation) > 10 ? wingover(c) : pointNose(me, climbing(toward, high > 100 ? -25 : 0), { fine: 8 });
        // (Not straight back into a dive he is already facing.)
        if ((g.ata < 40 && mem.since > 1) || mem.since > 7) {
          mem.overSide = undefined;
          mem.climbDeg = undefined;
          mem.climbDir = undefined;
          const again = g.ata < 40 && high > 100 && !(facing && g.range < 450);
          go(c, again ? 'dive' : 'climb');
          if (!again) return { ...k, throttle: 1, aimed: false, say: high < 30 ? LOST_HEIGHT : undefined };
        }
        return { ...k, throttle: 1, aimed: false };
      }
      default: go(c, 'climb');
    }
    return null;
  },
};

/**
 * UP AND OVER, the vertical escape. With a chaser behind you and more
 * energy than he has, pull nearly straight up. If he follows you up he runs
 * out of speed first and hangs below you; you go over the top in a half
 * loop while you still have the speed to fly it, and come back down at him.
 */
/** The speed the half loop over the top starts at: below about 40 m/s full
 *  aft stick no longer carries a Spitfire's nose over the vertical (it
 *  hangs), so the pull ends while there is still this much in hand. */
const OVER_SPEED = 46;
PLANS.upAndOver = {
  title: 'Up and over', first: 'run',
  says: {
    run: 'Running fast and level: letting him chase',
    pull: 'Nearly straight up: he cannot follow me there',
    over: 'Over the top in a half loop, back toward him',
    pounce: 'Coming back down at him from above',
    zoom: 'Back up again on the dive\'s speed',
  },
  step(c) {
    const { me, him, g, mem } = c;
    const h = heading(me.velocity);
    switch (mem.phase) {
      case 'run': {
        // Level, full throttle, a gentle weave: a second and a half of a
        // real chase, then up, once he is behind.
        const weave = Math.sin(mem.t * 0.6) * 0.12;
        const d = add(climbing(h, 1), scale([-h[2], 0, h[0]], weave));
        if ((g.hisAta < 35 && mem.since > 1.5) || mem.since > 8) go(c, 'pull');
        return { ...pointNose(me, d, { fine: 8 }), throttle: 1 };
      }
      case 'pull': {
        // Nearly vertical, the nose eased up at 25 degrees a second (a
        // harder pull at 75 m/s throws height away in drag), until the
        // speed is down to what the half loop over the top needs.
        const want = g.mySpeed > 34 ? 80 : 60;
        const k = pointNose(me, climbing(len(h) > 0.05 ? h : basis(me.orientation).F, easedClimb(c, want, 25)), { fine: 8 });
        if (g.mySpeed < OVER_SPEED || mem.since > 10) go(c, 'over');
        return { ...k, throttle: 1 };
      }
      case 'over': {
        // Full aft stick, the lift toward him and the sky: the nose goes
        // back over the vertical and comes down toward him.
        const k = pullLift(me, add(unit(sub(him.position, me.position)), [0, 0.6, 0]), 1);
        if ((g.ata < 50 && pitchOf(me.orientation) < 30) || mem.since > 8) { mem.climbDeg = undefined; go(c, 'pounce'); }
        return { ...k, throttle: 1 };
      }
      case 'pounce': {
        // Down at him. Far out and high, the nose goes in under his line so
        // the height turns into speed; inside 320 m, the lead, pulled hard
        // (at 30 to 40 m/s over the top the nose falls away from a soft
        // pull). Off and up before the merge, never a head-on pass with a
        // pilot fast enough to fly his guns, and never below him.
        const far = g.range > 320 && g.above < -60;
        const k = far
          ? pointNose(me, sub(add(leadPoint(me, him, c.gun), [0, -Math.min(-g.above, (g.range - 300) * 0.6), 0]), me.position), { fine: 8, push: 0.6 })
          : leadPursuit(c, { push: 0.6, kPitch: 10 });
        const pass = g.aspect > 120 && g.hisAta < 35 && g.hisSpeed > 25 && g.range < 300;
        if (mem.since > 1 && (g.range < Math.max(60, g.closure * 1.5) || pass || g.above > 10 || mem.since > 10)) go(c, 'zoom');
        return { ...k, throttle: 1 };
      }
      case 'zoom': {
        const k = pointNose(me, climbing(len(h) > 0.05 ? h : basis(me.orientation).F, easedClimb(c, climbAngle(g.mySpeed), 30)), { fine: 6 });
        if ((mem.since > 2 && g.mySpeed < OVER_SPEED) || mem.since > 9) { mem.climbDeg = undefined; go(c, 'over'); }
        return { ...k, throttle: 1 };
      }
      default: go(c, 'run');
    }
    return null;
  },
};

/**
 * THE BREAK TURN. With an attacker closing on your tail, wait until he is
 * committed, then turn as hard as the aeroplane will turn, toward him. His
 * shot is gone, and his closure carries him past your tail (an overshoot):
 * reverse, into him again. In BF1942 a faster Spitfire also turns faster
 * (the pull grows with the speed: the turn's radius is 55 to 75 m from 45 to
 * 130 m/s), so he does not fly out in front for you: he swings back in
 * behind you, close and without the lead for a shot, as long as you keep
 * turning into him. Only if he does come out in front do you go for him.
 */
PLANS.breakTurn = {
  title: 'The break turn', first: 'watch',
  says: {
    watch: 'Flying straight, watching him close',
    break: 'BREAK: as hard as it turns, into him',
    reverse: 'He came past my tail: reversing, into him again',
    turn: 'He is back behind me, inside my turn: turning hard, he has no lead',
    chase: 'He is out in front of me: guns',
  },
  step(c) {
    const { me, him, g, mem } = c;
    // Where he sits across my heading, metres, right positive.
    const h = heading(me.velocity);
    const rel = sub(him.position, me.position);
    const across = -h[2] * rel[0] + h[0] * rel[2];
    // Out in front of me, inside 400 m, not far above (a nose pulled up
    // after a man 70 m overhead only flies into him).
    const inFront = g.ata < 60 && g.hisAta > 100 && g.range < 400 && g.above < 40;
    if (mem.phase === 'watch') {
      // Cruising, not racing. He breaks when the attacker is in his rear
      // cone, nose on him, just outside the guns' reach: however fast or
      // slow the attacker is closing.
      if (!mem.dir) mem.dir = heading(me.velocity);
      if (!(g.ata > 130 && g.hisAta < 45 && g.range < c.gun.range + 30)) {
        return { ...pointNose(me, climbing(mem.dir, 0), { fine: 8 }), throttle: holdSpeed(c, 52) };
      }
      mem.side = g.side;
      go(c, 'break');
    }
    if (mem.phase === 'chase') {
      if (inFront || g.ata < 90) return { ...leadPursuit(c), throttle: g.closure > 15 && g.range < 200 ? 0 : 1 };
      mem.side = g.side;
      go(c, 'break');
    }
    if (inFront) { go(c, 'chase'); return { ...leadPursuit(c), throttle: 1 }; }
    // He came past my tail to my other side, close: the turn reverses, into
    // him again.
    if (g.range < 150 && g.ata > 90 && Math.sign(across) === -mem.side && Math.abs(across) > 8) {
      mem.side = -mem.side;
      mem.reversals = (mem.reversals ?? 0) + 1;
      go(c, 'reverse');
    }
    // The reversal done, he has swung back in behind me, in my turn: keep
    // turning into him. His nose is behind me, so he has no lead.
    if (mem.phase === 'reverse' && g.ata > 120 && g.hisAta < 60 && mem.since > 1) go(c, 'turn');
    // Into him: the turn that makes his angle off the tail grow fastest.
    return { ...hardTurn(me, mem.side ?? g.side, { climb: 0 }), throttle: 1 };
  },
};

/** The break-turn lesson's defender, in the Flip's own circle. */
const BT_SAYS = {
  watch: 'Flying straight, watching him close',
  break: 'BREAK: as hard as it turns, into him',
  turn: 'He is sitting behind me in my circle: turning hard, holding my height',
};

/** Over the top toward him: the lift on him until the nose is within 40
 *  degrees of him (or 5 s). True while it is still pulling round. */
const btOnto = c => c.g.ata > 40 && c.mem.since < 5;

/**
 * The Flip: out of the circle up, then down on him and up again. Break at
 * `breakAt` (memory), hold the height in the circle, and with him dead
 * astern inside 120 m zoom at 70 degrees until 52 m/s are left (not to the
 * hang: a Spitfire at 25 m/s over him is a target). Over the top onto him
 * and guns with the lead (`ascAim`); off him before the paths cross, when
 * the lead is lost, when his nose comes onto me, or when he breaks with me
 * inside 120 m (a high yo-yo, never following his break round in the
 * flat); up again at 70 degrees to 58 m/s, over and down. What it buys
 * (reviews/dfn-bt.md, "Ascendancy", the review): 0 of 9.
 */
PLANS.btFlip = {
  title: 'Up out of the circle, down on them, up again', first: 'watch',
  says: {
    ...BT_SAYS,
    'flip-zoom': 'He is close behind: straight up out of the circle',
    'flip-over': 'He followed me up and slowed: over the top onto him',
    'flip-guns': 'Down on him with the lead: guns',
    'flip-up': 'Off him before he can turn into me: up again',
    'flip-top': 'Over the top, nose coming down on him',
    'flip-dive': 'Down on him again with the lead',
  },
  step(c) {
    const { me, him, g, mem } = c;
    const high = -g.above;
    if (mem.phase === 'watch') {
      if (!mem.dir) mem.dir = heading(me.velocity);
      if (!(g.ata > 130 && g.hisAta < 45 && g.range < (mem.breakAt ?? c.gun.range + 30))) {
        return { ...pointNose(me, climbing(mem.dir, 0), { fine: 8 }), throttle: holdSpeed(c, 52) };
      }
      mem.side = g.side; mem.y0 = me.position[1];
      go(c, 'break');
    }
    if (mem.phase === 'break') {
      if (mem.since < 5) return { ...hardTurn(me, mem.side, { climb: 0 }), throttle: 1 };
      go(c, 'turn');
    }
    if (mem.phase === 'turn') {
      if (!(g.ata > 150 && g.range < 120 && g.mySpeed > 44)) {
        return { ...hardTurn(me, mem.side, { climb: clamp((mem.y0 - me.position[1]) * 0.15, -3, 4), maxBank: 75 }), throttle: 1 };
      }
      go(c, 'flip-zoom');
    }
    // The zoom ends at 52 m/s (it tops out near 40, not hanging); a high
    // yo-yo when he breaks with me inside 120 m; "over the top" only while
    // the nose is above 20 degrees down and I am over him.
    const K = { zoomEnd: 52, yoyo: 120, minUp: 0, overDown: -20 };
    if (mem.phase === 'flip-zoom') {
      if (!(g.mySpeed < K.zoomEnd || (g.ata < 100 && g.above < -15))) {
        return { ...pointNose(me, climbing(heading(me.velocity), 70), { fine: 6 }), throttle: 1 };
      }
      go(c, 'flip-over');
    }
    // Over the top: until the nose is on him, or already well down.
    const overing = () => btOnto(c) && pitchOf(me.orientation) > K.overDown && high > 0;
    if (mem.phase === 'flip-over') {
      if (overing()) return { ...pullLift(me, sub(him.position, me.position), 1), throttle: 1, aimed: false };
      mem.ascAim = undefined;
      go(c, 'flip-guns');
    }
    if (mem.phase === 'flip-guns' || mem.phase === 'flip-dive') {
      const toMerge = g.closure > 1 ? g.range / g.closure : Infinity;
      // Off him before the paths cross, when the lead is lost or his nose
      // comes round; and when he breaks with me close behind, a high yo-yo
      // out of his turn instead of following it.
      const off = toMerge < 1 || g.range < 40 || (g.ata > 60 && mem.since > 1.5) || mem.since > 8
        || (g.hisAta < 20 && g.range < 300 && high < 40) || (g.range < K.yoyo && g.closure > 0 && mem.since > 1);
      if (!off) return { ...ascAim(c), throttle: 1, aimed: g.range < 262 };
      mem.zoomDir = heading(me.velocity);
      go(c, 'flip-up');
    }
    if (mem.phase === 'flip-up') {
      if ((g.mySpeed > 58 || mem.since < K.minUp) && mem.since < 9) {
        // A shot still there as the nose comes up is taken.
        const up = g.mySpeed > 58 ? 70 : clamp((g.mySpeed - 36) * 1.6, 10, 40);
        return { ...pointNose(me, climbing(mem.zoomDir, up), { fine: 6, pull: 0.7 }), throttle: 1, aimed: g.range < 262 };
      }
      go(c, 'flip-top');
    }
    if (mem.phase === 'flip-top') {
      if (overing()) return { ...pullLift(me, sub(him.position, me.position), 1), throttle: 1, aimed: false };
      mem.ascAim = undefined;
      go(c, 'flip-dive');
    }
    return { ...ascAim(c), throttle: 1, aimed: g.range < 262 };
  },
};

/**
 * The Ninja's best try, and what it shows: the upper hand is not to be had
 * here. Break into him at once, 500 m out, before he is inside 400 m (he
 * never sits on your six, his guns never have you); once he is past, up at
 * 70 degrees to 52 m/s (he follows and slows) and over the top toward him.
 * Down on him only when you are 35 m over him, he is 13 degrees under your
 * horizon, your nose within 60 degrees of him and HIS nose more than 60
 * degrees off you; off him 2.5 s before the paths cross or the moment his
 * nose comes onto you. A pure pursuer never takes his nose off you, so the
 * dive never comes: after 8 s over the top you leave, straight away and
 * down a little for speed, while he is slow, and he gives up the chase.
 * No circling with him (reviews/dfn-bt.md, "Ascendancy", the review).
 */
PLANS.btNinja = {
  title: 'Break at once, up, and away', first: 'break',
  says: {
    break: 'BREAK at once, 500 m out: he never gets in behind me',
    zoom: 'Up out of his reach: he follows me up and slows',
    over: 'Over the top: waiting for his nose to come off me',
    dive: 'His nose is off me: down on him with the lead',
    leave: 'His nose never leaves me: no dive. Away while he is slow',
  },
  step: c => btUpAndAway(c, 'leave'),
};

/** The Ninja's flight, `leave` naming its last phase (the Dip's `dip-run`). */
function btUpAndAway(c, leave) {
  {
    const { me, him, g, mem } = c;
    const high = -g.above;
    const look = Math.asin(clamp(-g.los[1])) / DEG;
    if (mem.side === undefined) { mem.side = g.side; mem.minR = Infinity; }
    if (mem.phase === 'break') {
      mem.minR = Math.min(mem.minR, g.range);
      if (!(g.range > mem.minR + 20 || mem.since > 10)) return { ...hardTurn(me, mem.side, { climb: 0, maxBank: 82, pull: 0.7 }), throttle: 1 };
      mem.zoomDir = heading(me.velocity);
      go(c, 'zoom');
    }
    if (mem.phase === 'zoom') {
      if (g.mySpeed > 52 && mem.since < 9) {
        return { ...pointNose(me, climbing(mem.zoomDir, 70), { fine: 6, pull: 0.7 }), throttle: 1, aimed: g.range < 262 };
      }
      go(c, 'over');
    }
    if (mem.phase === 'over') {
      if (high > 35 && look > 13 && g.hisAta > 60 && g.ata < 60 && g.mySpeed > 36) { mem.ascAim = undefined; go(c, 'dive'); }
      else if (mem.since < 8) return { ...pullLift(me, sub(him.position, me.position), 1), throttle: 1, aimed: g.range < 262 };
      else go(c, leave);
    }
    if (mem.phase === 'dive') {
      const toMerge = g.closure > 1 ? g.range / g.closure : Infinity;
      const off = toMerge < 2.5 || (g.hisAta < 25 && g.range < 400) || (g.ata > 50 && mem.since > 1.5) || mem.since > 9 || high < 15;
      if (!off) return { ...ascAim(c), throttle: 1, aimed: g.range < 262 };
      mem.zoomDir = heading(me.velocity);
      go(c, 'zoom');
      return { ...pointNose(me, climbing(mem.zoomDir, 70), { fine: 6, pull: 0.7 }), throttle: 1, aimed: g.range < 262 };
    }
    const away = heading(sub(me.position, him.position));
    return { ...turnToward(c, climbing(away, me.position[1] < 250 ? 0 : -8), { maxUp: 5, maxDown: 40 }), throttle: 1, aimed: false };
  }
}

/** The Dip flown the Ninja's way: break before he is in reach, up, and
 *  away from the top while he is slow (reviews/dfn-bt.md, the review). */
PLANS.btDip = {
  title: 'Break at once, up, and away', first: 'break',
  says: { ...PLANS.btNinja.says, 'dip-run': 'He has followed me up and slowed: away now, full throttle' },
  step: c => btUpAndAway(c, 'dip-run'),
};

/**
 * THE FLAT SCISSORS. Two fighters side by side and slow, each reversing
 * into the other every time they cross. The one who goes slower without
 * stalling ends up behind: throttle back, reverse at every crossing.
 */
/** How far either side of the fight's axis a scissors weaves, degrees. */
const SCISSORS_SWING = 60;

PLANS.scissors = {
  title: 'The flat scissors', first: 'reverse',
  says: {
    reverse: 'Turning into him as our paths cross: slow and tight',
    cross: 'We crossed: reverse, back into him',
    shoot: 'He drifted out in front of me',
  },
  step(c) {
    const { me, him, g, mem, dt } = c;
    // The fight's axis: the heading the two of them shared when the
    // scissors began (the overshoot that starts it leaves them side by side
    // on one heading). Every turn is measured against it.
    if (!mem.axis) mem.axis = heading(me.velocity);
    const axis = mem.axis, right = [-axis[2], 0, axis[0]];
    const rel = sub(him.position, me.position);
    const across = dot(rel, right);
    const h = heading(me.velocity);
    const off = Math.atan2(dot(h, right), dot(h, axis)) / DEG;
    // The shot: only once he has drifted out in front along the axis and
    // my nose comes onto him, never on the head-on moment of a crossing.
    const ahead = dot(rel, axis);
    if (ahead > 50 && g.ata < 30 && g.hisAta > 90 && g.range < 350) go(c, 'shoot');
    if (mem.phase === 'shoot') {
      if (g.ata > 60 || ahead < 20) go(c, 'reverse');
      else return { ...leadPursuit(c), throttle: mem.fast ? 1 : g.closure > 4 ? -0.4 : 0.6 };
    }
    // Turn into him: toward his side of me across the axis. When our paths
    // cross that side flips, and the turn reverses. Never more than about a
    // hundred degrees off the axis: past that the turn comes back.
    if (mem.side === undefined) mem.side = Math.sign(across) || 1;
    const want = Math.abs(across) > 6 ? Math.sign(across) : mem.side;
    if (want !== mem.side && mem.since > 0.8) { mem.side = want; go(c, 'cross'); }
    if (off * mem.side > 100) { mem.side = -mem.side; go(c, 'cross'); }
    if (mem.phase === 'cross' && mem.since > 0.8) go(c, 'reverse');
    // The nose on a level heading SWING degrees to his side of the axis:
    // the weave, flat, the nose on the horizon. A hard turn held instead
    // circles away and sinks.
    // Flat: the nose lifted a few degrees when he sinks or sits below the
    // height the scissors began at (each roll from bank to bank unloads the
    // wings, and a slow Spitfire drops).
    if (mem.y0 === undefined) mem.y0 = me.position[1];
    // Only with speed to spend: below 34 m/s the nose stays down and the
    // speed comes back first, or the climb starves the turn and he falls.
    const spare = clamp((g.mySpeed - 30) / 4, 0, 1);
    const lift = clamp((mem.y0 - me.position[1]) * 0.15 - me.velocity[1] * 1.2, -4, 14) * spare - 3 * (1 - spare);
    const a = mem.side * SCISSORS_SWING * DEG;
    const goal = add(scale(axis, Math.cos(a)), scale(right, Math.sin(a)));
    // Far off it, a hard turn toward it with the bank held at 72 degrees
    // (eased as he sinks): the general-purpose aim rolls past the vertical
    // and lets the nose fall. Near it, the aim takes the last few degrees.
    const err = Math.atan2(dot(h, [-goal[2], 0, goal[0]]), dot(h, goal)) / DEG;
    const k = Math.abs(err) > 12
      ? hardTurn(me, -Math.sign(err), { climb: lift * 0.6, maxBank: 72 })
      : pointNose(me, climbing(goal, lift), { fine: 12 });
    // The throttle: full for the pilot who forgets it. The ace brakes early
    // (the brake takes seconds to bite) and opens again before he is too
    // slow, so he sits at about 40 m/s: slower than a full throttle
    // weave (about 45), still fast enough to turn and hold his height.
    const v = g.mySpeed;
    const dv = mem.lastV === undefined ? 0 : (v - mem.lastV) / Math.max(1e-3, dt || 1 / 30);
    mem.lastV = v;
    const soon = v + dv * 2;
    const throttle = mem.fast ? 1 : soon > 42 ? -1 : soon < 38 ? 1 : 0;
    return { ...k, throttle };
  },
};

/**
 * THE SCISSORS ACE: the flat scissors flown to win, the threat in the
 * scissors' Dip, Flip and Ninja (features/dogfight-school/reviews/dfn-sc.md).
 * He chases a pilot who leaves the scissors, full throttle, his nose on the
 * lead. He gives the chase up once he has chased 6 s, sits 30 m past his
 * guns' reach and has not been closing for about 3 s: an equal fighter he
 * cannot catch. Let go, he climbs away home, and still turns to face a pilot
 * who comes back at him. On his own tail he breaks into him (the reflex).
 */
PLANS.scAce = {
  title: 'The flat scissors', first: 'reverse', reflex: true,
  says: {
    ...PLANS.scissors.says,
    chase: 'He is leaving the scissors: after him, full throttle',
    'let-go': 'He is out of my reach and I am not closing: letting him go',
    meet: 'He is coming back at me: turning to face him',
  },
  step(c) {
    const { me, him, g, mem } = c;
    if (!mem.axis) mem.axis = heading(me.velocity);
    // He has left: well out of the scissors' 200 m, turned far off its line
    // and going away, or diving away.
    const away = g.hisAta > 110;
    const left = g.range > 230 || (angleBetween(heading(him.velocity), mem.axis) > 110 && away)
      || (him.velocity[1] < -8 && away && g.range > 120);
    if (left && !['chase', 'let-go', 'meet'].includes(mem.phase)) { go(c, 'chase'); mem.closing = 0; }
    if (mem.phase === 'chase') {
      // His closure, smoothed over about three seconds.
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
    return PLANS.scissors.step(c);
  },
};

/**
 * THE SCISSORS ACE WHO KEEPS HIS HEIGHT: `scAce`, plus what a sensible ace
 * does about a man above him (reviews/dfn-sc.md, "Ascendancy", round two).
 * `scAce` turns hard and flat after a man 140 m over him that he cannot
 * reach, and gives his energy away (366 to 177 m in 50 s). This one, with
 * the other plane 50 m or more over him, climbs at 20 degrees at full
 * throttle, drifting toward him; a dive he sees coming at him inside 600 m
 * he turns to face; a man hanging slow over him inside 300 m he snaps up at,
 * for 4 s at most. The Flip and the Ninja fly against him; the Dip, the
 * classic demo and the ascendancy bench keep `scAce`.
 */
PLANS.scClimber = {
  ...PLANS.scAce,
  says: {
    ...PLANS.scAce.says,
    climb: 'He is above me: climbing for height, not turning flat under him',
    face: 'He is diving at me: turning to face him',
    snap: 'He is hanging slow over me: nose up at him for a shot',
  },
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
    return PLANS.scAce.step(c);
  },
};

/**
 * The scissors' Ninja, tried (features/dogfight-school/reviews/dfn-sc.md,
 * "Ascendancy", round two): `ascend`'s vertical pendulum cut to the
 * scissors' speeds, never hanging: up at the overshoot and over the top
 * while there are still 48 m/s, zooms that end at 50 m/s. Against
 * `scClimber`, who climbs when I am over him and turns to face a dive he
 * sees, it gets no shot: the start's 8 m/s is not an edge he cannot match.
 */
const SC = {
  entry: 45,        // the Ninja's pull at the overshoot, wings level, full throttle ...
  entryEnd: 48,     // ... over the top while this is left
  high: 15,         // dive only this far over him ...
  look: 10,         // ... he this far below my horizon ...
  diveAta: 80,      // ... my nose this close to him
  diveSpeed: 35,
  merge: 1.5,       // off him this long before the paths cross ...
  near: 40,         // ... or this close, closing
  floor: 5,         // ... or when the pull-out would bottom out under this over him
  noseOn: 40,       // ... or his nose this close to me inside 300 m
  lost: 50,         // ... or the lead this far off my nose, 1.5 s in
  zoom: 50,         // up at this ...
  zoomEnd: 50,      // ... down to this speed
  zoomPull: 0.7,
  overDown: 18,     // the wingover toward him until the nose is this far down
  nose: 30,         // his nose this close to me inside 500 m: across his line
  noseRange: 500,
  beam: 80,
  brake: 33,        // the Flip: the scissors flown at this, slower than his 40
};

/** Over the top: the lift rolled toward his side of the sky, a little below
 *  the horizon, until the nose is down; then look for the dive. */
function scOver(c, next) {
  const { me, him, mem } = c;
  if (pitchOf(me.orientation) > SC.overDown && mem.since < 5) {
    const h = heading(me.velocity), right = [-h[2], 0, h[0]];
    if (mem.overSide === undefined) mem.overSide = Math.sign(dot(right, heading(sub(him.position, me.position)))) || 1;
    return { ...pullLift(me, add(scale(right, mem.overSide), [0, -0.35, 0]), 1), throttle: 1, aimed: c.g.range < ASC.open };
  }
  go(c, next);
  return null;
}

/**
 * Down on him from above with the lead (`ascAim`), off him and up before
 * the pass, over the top toward him, and down again. His nose coming onto
 * me inside 500 m, across his line; below him, climbing toward him.
 */
function scPendulum(c) {
  const { me, him, g, mem } = c;
  const high = -g.above;
  const lookDown = Math.asin(clamp(-g.los[1])) / DEG;
  const zoom = () => { mem.ascAim = undefined; mem.zoomDir = heading(me.velocity); go(c, 'zoom'); };
  if (g.range < SC.near && g.closure > 0 && mem.phase !== 'zoom' && mem.phase !== 'over') zoom();
  if (mem.phase === 'dive') {
    const toMerge = g.closure > 1 ? g.range / g.closure : Infinity;
    const dive = Math.max(0, -pitchOf(me.orientation)) * DEG;
    const bottom = high - g.mySpeed * (1 - Math.cos(dive)) - 0.45 * Math.max(0, -me.velocity[1]) + 0.5 * Math.min(0, him.velocity[1]);
    const off = toMerge < SC.merge || g.range < SC.near || bottom < SC.floor || (g.hisAta < SC.noseOn && g.range < 300)
      || (g.ata > SC.lost && mem.since > 1.5) || mem.since > 9;
    if (!off) return { ...ascAim(c), throttle: 1, aimed: g.range < ASC.open };
    zoom();
  }
  if (mem.phase === 'zoom') {
    if (g.mySpeed > SC.zoomEnd && mem.since < 8) {
      // A snap as he slides through the sight on the pull-off is taken.
      return { ...pointNose(me, climbing(mem.zoomDir, SC.zoom), { fine: 6, pull: SC.zoomPull }), throttle: 1, aimed: g.range < ASC.open };
    }
    mem.overSide = undefined;
    go(c, 'over');
  }
  if (mem.phase === 'over') {
    const k = scOver(c, 'find');
    if (k) return k;
  }
  if (g.ata < SC.diveAta && high > SC.high && lookDown > SC.look && g.mySpeed > SC.diveSpeed) {
    go(c, 'dive');
    return { ...ascAim(c), throttle: 1, aimed: g.range < ASC.open };
  }
  if (g.hisAta < SC.nose && g.range < SC.noseRange) {
    go(c, 'beam');
    return { ...turnToward(c, climbing(ascOffLine(c, SC.beam), 5), { maxUp: 10 }), throttle: 1, aimed: g.range < ASC.open };
  }
  go(c, high < SC.high ? 'climb' : 'find');
  const angle = clamp((g.mySpeed - 36) * 1.6, -5, 26);
  return { ...pointNose(me, climbing(heading(sub(him.position, me.position)), angle), { fine: 8 }), throttle: 1, aimed: g.range < ASC.open };
}

/**
 * THE SCISSORS' DIP: the full-throttle pilot leaves at the second crossing.
 * He does not reverse: he holds the heading the crossing left him on, which
 * points away from the ace, who is turning the other way, and runs at full
 * throttle in a 6 degree dive down to 110 m. The ace has to turn about 150
 * degrees to follow, starts some 5 s behind, and an equal fighter at full
 * throttle never makes that up.
 */
PLANS.scDip = {
  title: 'The Dip: out at a crossing', first: 'reverse',
  says: {
    ...PLANS.scissors.says,
    'dip-run': 'Out at the crossing: no reversal, full throttle, a shallow dive away from him',
  },
  step(c) {
    const { me, mem } = c;
    if (mem.phase !== 'dip-run') {
      const was = mem.phase, h0 = heading(me.velocity);
      const out = PLANS.scissors.step(c);
      if (!(mem.phase === 'cross' && was !== 'cross' && (mem.crossings = (mem.crossings ?? 0) + 1) >= 2)) return out;
      mem.away = h0;
      go(c, 'dip-run');
    }
    const want = c.agl > 110 ? -6 : c.agl > 80 ? -1 : 3;
    return { ...turnToward(c, climbing(mem.away, want), { maxUp: 5, maxDown: 30 }), throttle: 1, aimed: false };
  },
};

/**
 * THE SCISSORS' FLIP, tried: what a pilot in front tries first. From the
 * first crossing he flies the scissors slower than the ace, the throttle
 * holding about 33 m/s to the ace's 40, so that the ace should drift out
 * in front. He never does: nobody sits in the other's rear quarter in a
 * flat scissors, and the ace's snap shots at the crossings go on
 * (reviews/dfn-sc.md). The phases are the scissors' own, marked `flip-`.
 */
PLANS.scFlip = {
  title: 'The Flip: slower than them', first: 'reverse',
  says: {
    ...PLANS.scissors.says,
    'flip-reverse': 'Throttle back: flying the scissors slower than him, so he drifts out in front',
    'flip-cross': 'We crossed, still slower than him: reverse, back into him',
    'flip-shoot': 'He drifted out in front of me',
  },
  step(c) {
    const { g, mem, dt } = c;
    if (!mem.flipping) {
      const was = mem.phase;
      const out = PLANS.scissors.step(c);
      if (!(mem.phase === 'cross' && was !== 'cross')) return out;
      mem.flipping = true;
      mem.scPh = 'cross';
      mem.scSince = 0;
    }
    // The scissors' own steering, its phase and clock kept apart from the
    // `flip-` name the fight shows.
    const outer = mem.phase, since = mem.since;
    mem.scSince += dt;
    mem.phase = mem.scPh;
    mem.since = mem.scSince;
    const out = PLANS.scissors.step(c);
    mem.scPh = mem.phase;
    mem.scSince = mem.since;
    mem.phase = `flip-${mem.scPh}`;
    mem.since = outer === mem.phase ? since : 0;
    const v = g.mySpeed, dv = mem.flipV === undefined ? 0 : (v - mem.flipV) / dt;
    mem.flipV = v;
    const soon = v + dv * 2;
    return { ...out, throttle: soon > SC.brake + 1 ? -1 : soon < SC.brake - 2 ? 1 : 0 };
  },
};

/**
 * THE SCISSORS' NINJA: never fly the scissors. At the overshoot, with the
 * speed he does not have, pull up 45 degrees at full throttle, over the top
 * toward him while there are still 48 m/s, and from there the pendulum
 * (`scPendulum`). Tried: against `scClimber` it gets no shot; he climbs
 * when I am over him and faces the dive, and the fight ends level.
 */
PLANS.scNinja = {
  title: 'The Ninja: up at the overshoot, tried', first: 'ninja-up',
  says: {
    'ninja-up': 'Not playing: up out of his plane on my extra speed, full throttle',
    over: 'Over the top toward him, the nose coming down on him',
    find: 'Over him: the nose down toward him, looking for the dive',
    dive: 'Down on him from above with the lead: guns inside 260 m',
    zoom: 'Off him before the pass: up on the dive\'s speed, out of his plane',
    beam: 'His nose is coming onto me: across his line',
    climb: 'Level with him or under him: pulling up, keeping him in front of me',
  },
  step(c) {
    const { me, g, mem } = c;
    if (mem.phase === 'ninja-up') {
      if (g.mySpeed > SC.entryEnd) {
        return { ...pointNose(me, climbing(heading(me.velocity), SC.entry), { fine: 8 }), throttle: 1, aimed: false };
      }
      mem.overSide = undefined;
      go(c, 'over');
    }
    return scPendulum(c);
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
    pass: 'Flying the pass: about to turn round',
    immelmann: 'Past him: Immelmann, half a loop up',
    rollout: 'Upside down on top: rolling upright, going the other way',
    top: 'On top, higher than him: keeping the height',
    split: 'High and slow, him coming at me: split-S, rolling upside down',
    pullthrough: 'Pulling through half a loop down: going back with speed',
    run: 'Going back the way I came, fast',
    attack: 'Back at him',
  },
  step(c) {
    const { me, him, g, mem } = c;
    const h = heading(me.velocity);
    const { F, U } = basis(me.orientation);
    const nose = pitchOf(me.orientation);
    switch (mem.phase) {
      case 'pass': {
        // Fast: take the pass, and once he is behind the wing (or the range
        // is opening past him) go up. High and slow with him coming at me:
        // refuse the pass and go down instead.
        // Neither (slow and low): no turnaround, back at him after a while.
        const slow = g.mySpeed < 52 && c.agl > 420;
        const fast = g.mySpeed > 58;
        if (slow && g.ata < 40 && g.hisAta < 40 && g.range < TURNAROUND_SPLIT_RANGE) {
          startLoop(c, h); go(c, 'split');
        } else if (fast && mem.since > 0.3 && (g.ata > 100 || (g.ata > 70 && g.closure < 0))) {
          startLoop(c, h); go(c, 'immelmann');
        } else if (mem.since > 20) go(c, 'attack');
        if (mem.y0p === undefined) mem.y0p = me.position[1];
        const say = g.ata > 90 ? 'Gone past him, fast: about to turn round'
          : slow ? 'High and slow, and he is coming at me' : 'Flying the pass: about to turn round';
        return { ...pointNose(me, climbing(h, clamp((mem.y0p - me.position[1]) * 0.1, -3, 3)), { fine: 6 }), throttle: 1, say };
      }
      case 'immelmann': {
        // Full aft stick with the lift held toward the loop's centre in the
        // vertical plane of the entry heading, until the nose is back on the
        // horizon, upside down: no roll until then.
        const phi = loopAngle(c, F);
        if (phi > 165 || (U[1] < -0.8 && Math.abs(nose) < 12 && phi > 150)) go(c, 'rollout');
        return { ...pullLift(me, loopCentre(F, mem.h0, 1), 1), throttle: 1 };
      }
      case 'rollout': {
        // The half roll upright with no pull, the nose held on the horizon
        // on the reversed heading.
        mem.yTop = Math.max(mem.yTop ?? 0, me.position[1]);
        if (Math.abs(bankOf(me.orientation).bank) < 15) go(c, 'top');
        return { ...rollNoseLevel(me, 0, mem.rollSide, 10), throttle: 1 };
      }
      case 'top': {
        // Higher than him and going the other way: the height is the point
        // of the move, so it is kept for three seconds before going for him.
        // The half roll at 35 m/s lets the nose sag; the climb back toward
        // the loop's top takes some of it back.
        const k = pointNose(me, climbing(h, clamp((mem.yTop - me.position[1]) * 0.25, -4, 12)), { fine: 8 });
        if (mem.since > 3) go(c, 'attack');
        return { ...k, throttle: 1 };
      }
      case 'split': {
        // The half roll with the nose on the horizon and no pull, until the
        // wings are level upside down and the roll has stopped.
        const rate = Math.abs(bodyRates(me.orientation, me.angularVelocity).roll) / DEG;
        if (Math.abs(bankOf(me.orientation).bank) > 170 && rate < 20) { startLoop(c, mem.h0); go(c, 'pullthrough'); }
        else if (mem.since > 4) { startLoop(c, mem.h0); go(c, 'pullthrough'); }
        return { ...rollNoseLevel(me, 180, mem.rollSide), throttle: 1 };
      }
      case 'pullthrough': {
        // Full aft stick from upside down, the lift toward the centre of a
        // loop in the entry heading's vertical plane, until the nose is on
        // the horizon going back the way he came.
        const phi = loopAngle(c, F);
        if (phi < -172 || (U[1] > 0.8 && Math.abs(nose) < 8 && phi < -150)) { mem.yTop = me.position[1]; go(c, 'run'); }
        return { ...pullLift(me, loopCentre(F, mem.h0, -1), 1), throttle: 1 };
      }
      case 'run': {
        // Wings level, straight out along the reversed heading: a wide
        // `fine` so the aim walks the nose down instead of rolling over.
        // The split-S was the way out: he keeps going until he is well clear.
        const k = pointNose(me, climbing(h, clamp((mem.yTop - me.position[1]) * 0.15, -3, 5)), { fine: 25 });
        if ((g.range > 1100 && g.ata > 90) || mem.since > 20) go(c, 'attack');
        return { ...k, throttle: 1 };
      }
      case 'attack': {
        // Back at him, no steeper than 30 degrees either way: a dive from
        // the Immelmann's height, a climb from the split-S's speed.
        if (g.ata > 120 && g.range > 250 && mem.since > 6) { mem.y0p = undefined; go(c, 'pass'); }
        const lp = sub(leadPoint(me, him, c.gun), me.position);
        const k = g.ata < 25 ? leadPursuit(c, { push: 0.5 }) : turnToward(c, lp, { maxUp: 30, maxDown: 30 });
        return { ...k, throttle: 1 };
      }
      default: go(c, 'pass');
    }
    return null;
  },
};

/** How close a head-on pilot comes before the high, slow turnarounds pilot
 *  refuses the pass and goes down (metres). */
const TURNAROUND_SPLIT_RANGE = 650;

/** Start a half loop: the entry heading's vertical plane and the angle the
 *  nose has come round it. */
function startLoop(c, h0) {
  const mem = c.mem;
  mem.h0 = h0;
  mem.loopPhi = undefined;
  mem.loopLast = undefined;
  const b = bankOf(c.me.orientation).bank;
  mem.rollSide = Math.abs(b) > 3 ? Math.sign(b) : 1;
}

/** The angle the nose has come round the vertical plane of `mem.h0`
 *  (degrees, unwrapped): 0 along it, 90 straight up, -90 straight down,
 *  +-180 level the other way. */
function loopAngle(c, F) {
  const mem = c.mem;
  const phi = Math.atan2(F[1], dot(F, mem.h0));
  if (mem.loopLast === undefined) mem.loopPhi = phi;
  else {
    let d = phi - mem.loopLast;
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    mem.loopPhi += d;
  }
  mem.loopLast = phi;
  return mem.loopPhi / DEG;
}

/** Where the lift points to fly a loop in the vertical plane of `h0`: at
 *  the loop's centre, a quarter turn round the plane from the nose. `dir`
 *  +1 pulls up and over, -1 (from upside down) down and through. */
function loopCentre(F, h0, dir) {
  const p = Math.atan2(F[1], dot(F, h0)) + dir * Math.PI / 2;
  return add(scale(h0, Math.cos(p)), [0, Math.sin(p), 0]);
}

/** Roll to `bankDeg` (the roll's way set by `side`) with no pull, the
 *  elevator and the rudder holding the nose on the horizon as the wings go
 *  round: the half roll of an Immelmann's top or a split-S's start. */
function rollNoseLevel(me, bankDeg, side = 1, lift = 0) {
  const q = me.orientation;
  const { U, R } = basis(q);
  const rates = bodyRates(q, me.angularVelocity);
  const bank = bankOf(q).bank;
  let err = bankDeg - bank;
  if (err > 180) err -= 360;
  if (err < -180) err += 360;
  // Most of the way round, keep rolling the way the roll began.
  if (Math.abs(err) > 150) err = side * Math.abs(err);
  const roll = clamp(2.6 * err * DEG - 1.0 * rates.roll);
  const nose = pitchOf(q) - lift;
  const pitch = clamp(0.06 * nose * U[1] + 0.5 * rates.pitch);
  const rudder = clamp(-0.06 * nose * R[1] - 0.3 * rates.yaw);
  return { pitch, roll, rudder, off: Math.abs(err) };
}

/**
 * The other side of the Immelmann, done right: after the pass he goes up,
 * and instead of following him I turn round flat at full throttle, keeping
 * my speed, put the nose on where his loop will top out and shoot him as he
 * hangs there, slow, a few hundred metres off.
 */
PLANS.turnaroundsMeetTop = {
  title: 'Meeting them at the top', first: 'hold',
  says: {
    hold: 'He went past me fast: holding off, keeping my speed',
    aim: 'He is going up: my nose on where his loop tops out',
    shoot: 'He is hanging at the top, slow: shooting',
    extend: 'He is past me: keeping my speed, not following him up',
  },
  step(c) {
    const { me, him, g, mem } = c;
    const h = heading(me.velocity);
    if (mem.y0 === undefined) mem.y0 = me.position[1];
    const level = climbing(h, clamp((mem.y0 - me.position[1]) * 0.1, -3, 4));
    // Where his loop tops out: above him by the height his climb still has
    // in it (most of what his upward speed would buy).
    const vy = Math.max(0, him.velocity[1]);
    const top = add(him.position, [0, vy * vy / (2 * G) * 0.8, 0]);
    const toTop = sub(top, me.position);
    switch (mem.phase) {
      case 'hold': {
        if (him.velocity[1] > 12) go(c, 'aim');
        return { ...pointNose(me, level, { fine: 6 }), throttle: 1 };
      }
      case 'aim': {
        // A climb no steeper than 30 degrees toward the top: the speed stays.
        if (g.hisSpeed < 45 && g.range < c.gun.range + 40 && g.ata < 25) go(c, 'shoot');
        if (g.ata > 80 && mem.since > 1) go(c, 'extend');
        return { ...turnToward(c, toTop, { maxUp: 30, maxDown: 10 }), throttle: 1 };
      }
      case 'shoot': {
        const lp = sub(leadPoint(me, him, c.gun), me.position);
        if (g.ata > 45 || g.range < 60 || unit(lp)[1] > 0.75) go(c, 'extend');
        return { ...leadPursuit(c, { push: 0.6 }), throttle: 1 };
      }
      case 'extend': {
        return { ...pointNose(me, level, { fine: 6 }), throttle: 1 };
      }
      default: go(c, 'hold');
    }
    return null;
  },
};

/**
 * The mistake against the Immelmann: after his pass he goes up, and I go
 * straight up after him from close in, guns on him. He went up first and
 * faster, and I run out of speed under his top.
 */
PLANS.turnaroundsFollow = {
  title: 'Following them up', first: 'pass',
  says: {
    pass: 'Flying level, watching him',
    up: 'He went up: pulling straight up after him',
    hang: 'Out of speed, hanging under him',
    fall: 'Falling off, getting my speed back',
    chase: 'Speed back: after him again',
  },
  step(c) {
    const { me, him, g, mem } = c;
    const h = heading(me.velocity);
    if (mem.y0 === undefined) mem.y0 = me.position[1];
    switch (mem.phase) {
      case 'pass': {
        if (him.velocity[1] > 12) go(c, 'up');
        return { ...pointNose(me, climbing(h, clamp((mem.y0 - me.position[1]) * 0.1, -3, 4)), { fine: 6 }), throttle: 1 };
      }
      case 'up': {
        if (g.mySpeed < 30) go(c, 'hang');
        else if (mem.since > 7) go(c, 'chase');
        return { ...purePursuit(c, { pull: 1 }), throttle: 1 };
      }
      case 'hang': {
        if ((me.velocity[1] < -5 && g.mySpeed > 30) || mem.since > 4) go(c, 'fall');
        return { ...purePursuit(c, { pull: 1 }), throttle: 1 };
      }
      case 'fall': {
        if (g.mySpeed > 45 || mem.since > 4) go(c, 'chase');
        return { ...leadPursuit(c, { push: 0.5 }), throttle: 1 };
      }
      case 'chase': {
        return { ...leadPursuit(c, { push: 0.5 }), throttle: 1 };
      }
      default: go(c, 'pass');
    }
    return null;
  },
};

/**
 * The old advice against a split-S: let him go and keep the height he gave
 * you. Flown, it is the escape it looks like: he runs out of the bottom of
 * his half loop as fast as I can follow up here, and nobody shoots.
 */
PLANS.turnaroundsLetGo = {
  title: 'Letting them go', first: 'cruise',
  says: {
    cruise: 'Flying at him, level',
    watch: 'He went down: letting him go, keeping my height',
  },
  step(c) {
    const { me, him, g, mem } = c;
    const h = heading(me.velocity);
    if (mem.y0 === undefined) mem.y0 = me.position[1];
    if (mem.phase === 'cruise' && him.velocity[1] < -8 && g.above < -20) go(c, 'watch');
    return { ...pointNose(me, climbing(h, clamp((mem.y0 - me.position[1]) * 0.1, -3, 4)), { fine: 6 }), throttle: 1 };
  },
};

/**
 * The answer to a split-S from above: he has given me the height. The
 * moment he rolls over and goes down I go down on him, not through his half
 * loop after him but straight at where he will come out, with my height
 * turned into speed; I shoot as I close on his run, and zoom back up instead
 * of staying down with him. A Spitfire's dive gains speed slowly, so it has
 * to start at once: started once he is out, it never catches him.
 */
PLANS.turnaroundsBoom = {
  title: 'Diving on them', first: 'cruise',
  says: {
    cruise: 'Flying at him, level',
    dive: 'He went down: diving on him from my height',
    zoom: 'Back up on the dive\'s speed',
    watch: 'Above him again, watching for the next dive',
  },
  step(c) {
    const { me, him, g, mem } = c;
    const h = heading(me.velocity);
    if (mem.y0 === undefined) mem.y0 = me.position[1];
    const level = climbing(h, clamp((mem.y0 - me.position[1]) * 0.1, -3, 4));
    switch (mem.phase) {
      case 'cruise': {
        if (him.velocity[1] < -8 && g.above < -20) go(c, 'dive');
        return { ...pointNose(me, level, { fine: 6 }), throttle: 1 };
      }
      case 'dive': {
        // Back up after the burst, or before I am down at his height, or if
        // he turns across me.
        if (c.pilot.fire) mem.burst = (mem.burst ?? 0) + c.dt;
        if ((mem.burst ?? 0) > 1.5 || g.range < 110 || g.ata > 70 || g.above > -25) { mem.burst = 0; go(c, 'zoom'); }
        return { ...leadPursuit(c, { pull: 1, push: 0.6 }), throttle: 1 };
      }
      case 'zoom': {
        if (mem.since > 4 || g.mySpeed < 45) go(c, 'watch');
        return { ...pointNose(me, climbing(h, easedClimb(c, climbAngle(g.mySpeed))), { fine: 6 }), throttle: 1 };
      }
      case 'watch': {
        if (g.above < -80 && g.range < 450 && g.ata < 50) go(c, 'dive');
        return { ...turnToward(c, sub(him.position, me.position), { maxUp: 5, maxDown: 0 }), throttle: 1 };
      }
      default: go(c, 'cruise');
    }
    return null;
  },
};

// --- turnarounds: the Dip, the Flip and the Ninja (reviews/dfn-ta.md) -------

/**
 * The turnarounds ace playing to win, for the lesson's Dip, Flip and Ninja:
 * the same Immelmann and split-S, and two things a real pilot adds. A target
 * going away from him is chased straight away, the height spent on speed,
 * for as long as the chase can be won. The school's one give-up rule (as
 * `scAce`): 6 s into the chase, beyond his guns' reach + 30 m and not closing
 * (closure smoothed over 3 s under 0.5 m/s), he lets him go and turns away,
 * and stays away unless the other turns back at him (then he faces him) or
 * gets on his tail. He breaks into anyone who gets onto his tail (the
 * reflex), except in the middle of a half loop or a half roll, where he is
 * committed. Bounced out of a split-S's run, he turns to fight instead of
 * running on for 20 s with the man over him.
 */
PLANS.taAce = {
  title: 'The Immelmann and the split-S', first: 'pass', reflex: true,
  committed: ['immelmann', 'rollout', 'split', 'pullthrough'],
  says: {
    ...PLANS.turnarounds.says,
    chase: 'He is running: after him, height into speed',
    'let-go': 'He is out of my reach and I am not closing: letting him go',
    meet: 'He is coming back at me: turning to face him',
  },
  step(c) {
    const { me, him, g, mem } = c;
    // Bounced out of my split-S run (I broke from him and have come out of
    // the break), I do not fly on straight with him over me: I turn to
    // fight (reviews/dfn-ta.md, "Ascendancy").
    if (mem.phase === 'run' && mem.resume === 'run') go(c, 'attack');
    // Going away from me: no threat, so after him.
    const running = g.aspect < 70 && g.range > 200;
    if ((mem.phase === 'top' || mem.phase === 'attack') && running) { go(c, 'chase'); mem.closing = 0; }
    if (mem.phase === 'let-go' && g.hisAta < 40 && g.range < 800 && g.closure > 5) go(c, 'meet');
    if (mem.phase === 'meet') {
      if (g.ata > 150 && g.range > 150) { go(c, 'chase'); mem.closing = 0; }
      else return { ...turnToward(c, sub(leadPoint(me, him, c.gun), me.position), { maxUp: 15, maxDown: 30 }), throttle: 1 };
    }
    if (mem.phase === 'let-go') {
      return { ...turnToward(c, climbing(mem.home, 15), { maxUp: 15, maxDown: 5 }), throttle: 1, aimed: false };
    }
    if (mem.phase === 'chase') {
      if (g.aspect > 110 && g.range < 600) { go(c, 'attack'); return PLANS.turnarounds.step(c); }
      // His closure, smoothed over about three seconds.
      mem.closing = (mem.closing ?? 0) + (g.closure - (mem.closing ?? 0)) * Math.min(1, c.dt / 3);
      if (mem.since > 6 && g.range > c.gun.range + 30 && mem.closing < 0.5) {
        go(c, 'let-go');
        mem.home = scale(heading(me.velocity), -1);
        return { ...turnToward(c, climbing(mem.home, 15), { maxUp: 15, maxDown: 5 }), throttle: 1, aimed: false };
      }
      const to = sub(leadPoint(me, him, c.gun), me.position);
      const k = g.ata < 20 ? leadPursuit(c, { push: 0.6 }) : turnToward(c, to, { maxUp: 20, maxDown: g.above < -20 ? 45 : 10 });
      return { ...k, throttle: 1 };
    }
    return PLANS.turnarounds.step(c);
  },
};

/**
 * THE DIP against the Immelmann: the moment he is past and pulling up, turn
 * back the way he came, flat at 60 degrees of bank so the speed stays, and
 * run under his loop at full throttle. He comes over the top slow and
 * pointing the wrong way, and has to turn round at 40 m/s before he can
 * chase; by then you are 750 m off, as fast as he is.
 */
PLANS.taDip = {
  title: 'Back under their loop', first: 'pass',
  says: {
    pass: 'Head on with him, holding my height',
    'dip-turn': 'He is past and going up: turning back under his loop',
    'dip-run': 'Running the way he came, full throttle, while he turns round',
  },
  step(c) {
    const { me, g, mem } = c;
    if (mem.y0 === undefined) mem.y0 = me.position[1];
    const h = heading(me.velocity);
    switch (mem.phase) {
      case 'pass': {
        if (g.ata > 100 && g.range < 600) { mem.h0 = h; mem.side = -g.side; go(c, 'dip-turn'); }
        return { ...pointNose(me, climbing(h, clamp((mem.y0 - me.position[1]) * 0.1, -3, 4)), { fine: 6 }), throttle: 1 };
      }
      case 'dip-turn': {
        if (dot(h, mem.h0) < Math.cos(170 * DEG)) go(c, 'dip-run');
        return { ...hardTurn(me, mem.side, { maxBank: 60 }), throttle: 1 };
      }
      case 'dip-run':
        return { ...pointNose(me, climbing(h, me.position[1] > 200 ? -3 : 0), { fine: 6 }), throttle: 1 };
      default: go(c, 'pass');
    }
    return null;
  },
};

/**
 * THE FLIP against the Immelmann, the moment he turns round to come back
 * down on you: the moment he is past and pulling up, turn back under his
 * loop, 60 degrees of bank, the nose a little down to keep the speed, and
 * keep turning, at 65 degrees, all the way round onto his heading. He comes
 * over the top slow and facing away, and you arrive under his tail, in the
 * one sky his cockpit hides (reviews/eyes.md); then the nose on him with
 * the lead, guns, and from there the ascendancy (`ascend`). Flown
 * (reviews/dfn-ta.md, "Ascendancy"), the circle puts you on his tail every
 * time, but it costs the speed the shot needs.
 */
const TA_FLIP = { bank: 60, sink: -4, bank2: 65, climb2: 0, onHim: 45, within: 90, burst: 1.5, close: 60, upAfter: 8, spotted: 4 };
PLANS.taFlip = {
  title: 'Round under their loop onto their tail', first: 'pass',
  says: {
    pass: 'Head on with him, holding my height',
    'flip-turn': 'He is past and going up: round under his loop, all the way onto his heading',
    'flip-climb': 'Under his tail, where he cannot see me: the nose on him, guns',
    'flip-seen': 'He saw me and turned back: no shot. Even now, take the Dip',
  },
  step(c) {
    const { me, g, mem } = c;
    // His nose coming round onto me from under his tail (my bearing off his
    // nose falling from its widest): he has seen me and is breaking.
    if (mem.phase === 'flip-climb') {
      mem.widest = Math.max(mem.widest ?? 0, g.hisAta);
      if (mem.widest - g.hisAta > TA_FLIP.spotted) go(c, 'flip-seen');
    }
    if (mem.handed) { const out = PLANS.ascend.step(c); return out && { ...out, say: out.say ?? PLANS.ascend.says[mem.phase] }; }
    if (mem.y0 === undefined) mem.y0 = me.position[1];
    const h = heading(me.velocity);
    switch (mem.phase) {
      case 'pass':
        if (g.ata > 100 && g.range < 600) { mem.h0 = h; mem.side = -g.side; go(c, 'flip-turn'); }
        return { ...pointNose(me, climbing(h, clamp((mem.y0 - me.position[1]) * 0.1, -3, 4)), { fine: 6 }), throttle: 1 };
      case 'flip-turn': {
        // Past the reversal, keep turning until he is in front of me.
        const turned = Math.acos(clamp(dot(h, mem.h0))) / DEG;
        if (turned >= 170) mem.past = true;
        if (mem.past && turned < TA_FLIP.within && g.ata < TA_FLIP.onHim) go(c, 'flip-climb');
        else return { ...hardTurn(me, mem.side, mem.past ? { maxBank: TA_FLIP.bank2, climb: TA_FLIP.climb2 } : { maxBank: TA_FLIP.bank, climb: TA_FLIP.sink }), throttle: 1 };
      }
      // falls through
      case 'flip-climb':
      case 'flip-seen': {
        if (c.pilot.fire) mem.burst = (mem.burst ?? 0) + c.dt;
        if ((mem.burst ?? 0) > TA_FLIP.burst || g.range < TA_FLIP.close || mem.t - mem.enter['flip-climb'] > TA_FLIP.upAfter) {
          mem.handed = true; mem.zoomDir = h; go(c, 'zoom');
          const out = PLANS.ascend.step(c);
          return out && { ...out, say: out.say ?? PLANS.ascend.says[mem.phase] };
        }
        return { ...leadPursuit(c, { pull: 1, push: 0.6 }), throttle: 1 };
      }
      default: go(c, 'pass');
    }
    return null;
  },
};

/**
 * THE NINJA against the split-S, a one-dive ambush: you meet him 140 m
 * above and he gives you his height on top of yours. Hold your height while
 * he rolls over and starts down; the moment his nose is 25 degrees below
 * the horizon, in his pull-through, where he is committed and cannot see
 * you, dive on him with the lead led (`taAim`, a copy of `ascend`'s aim:
 * that one is private to it). You arrive as he comes out and breaks, inside
 * his turn, and take every shot the guns give you. Off him before you pass
 * him; if he is still flying, take the Dip: straight away at full throttle,
 * nose a little down, rather than circle with him at even energy. Diving
 * the moment he rolls over instead, or once he is out, brings him down in
 * far fewer starts (reviews/dfn-ta.md, "Ascendancy").
 */
const TA_NINJA = { nose: -25, lead: 0.7, merge: 1, near: 28, lost: 50, maxDive: 9, run: -3 };
function taAim(c) {
  const D = unit(sub(leadPoint(c.me, c.him, c.gun), c.me.position));
  const m = c.mem.taAim ?? (c.mem.taAim = {});
  const Dd = m.D ? scale(sub(D, m.D), 1 / c.dt) : [0, 0, 0];
  m.Dd = m.Dd ? add(scale(m.Dd, 0.7), scale(Dd, 0.3)) : Dd;
  m.D = D;
  return pointNose(c.me, add(D, scale(m.Dd, TA_NINJA.lead)), { fine: 8, mem: m, dt: c.dt, pull: 0.95, push: 0.8 });
}
PLANS.taNinja = {
  title: 'The one-dive ambush', first: 'wait',
  says: {
    wait: 'Above him, holding my height: let him commit to his split-S',
    dive: 'His nose is down through his half loop and he cannot see me: diving on him with the lead',
    'dip-out': 'Off him before I pass him: if he is still flying, away at full throttle, not round with him',
    'dip-turn': 'He was too fast to split-S and is going up past me: no ambush, back under his loop',
    'dip-run': 'Running the way he came, full throttle, while he turns round',
  },
  step(c) {
    const { me, him, g, mem } = c;
    if (mem.y0 === undefined) mem.y0 = me.position[1];
    const h = heading(me.velocity);
    // Too fast to split-S, he went past and up instead (an Immelmann): no
    // ambush on, so the lesson's Dip, back under his loop (`taDip`).
    if (mem.phase === 'dip-turn' || mem.phase === 'dip-run') return PLANS.taDip.step(c);
    switch (mem.phase) {
      case 'wait':
        if (g.ata > 100 && g.range < 600) { mem.h0 = h; mem.side = -g.side; go(c, 'dip-turn'); return PLANS.taDip.step(c); }
        if (pitchOf(him.orientation) < TA_NINJA.nose && g.above < -20) { mem.taAim = undefined; go(c, 'dive'); }
        else return { ...pointNose(me, climbing(h, clamp((mem.y0 - me.position[1]) * 0.1, -3, 4)), { fine: 6 }), throttle: 1 };
      // falls through
      case 'dive': {
        const toMerge = g.closure > 1 ? g.range / g.closure : Infinity;
        const off = toMerge < TA_NINJA.merge || g.range < TA_NINJA.near || (g.ata > TA_NINJA.lost && mem.since > 1.5)
          || mem.since > TA_NINJA.maxDive || g.above > -5;
        if (!off) return { ...taAim(c), throttle: 1 };
        mem.away = heading(sub(me.position, him.position));
        go(c, 'dip-out');
      }
      // falls through
      case 'dip-out':
        return { ...turnToward(c, climbing(mem.away, TA_NINJA.run), { maxUp: 10, maxDown: 15 }), throttle: 1 };
      default: go(c, 'wait');
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
    chase: 'On his tail, closing',
    follow: 'He went nearly straight up: climbing after him at 25 degrees, nose under him, saving my speed',
    shoot: 'He is hanging at the top, slow and in front of me: guns',
  },
  step(c) {
    const { me, him, g, mem } = c;
    switch (mem.phase) {
      case 'chase': {
        if (pitchOf(him.orientation) > 20 && him.velocity[1] > 5) go(c, 'follow');
        // Closing fast and close: under him and past, not into him.
        if (g.range < 140 && g.closure > 12) return { ...pointNose(me, climbing(heading(me.velocity), -15), { fine: 8 }), throttle: 1, aimed: false };
        // Far out, the nose on him gently; a hard chase at 300 m only
        // weaves the wings and spends the speed.
        const k = g.range > c.gun.range + 60 ? pointNose(me, sub(him.position, me.position), { fine: 20 }) : leadPursuit(c);
        return { ...k, throttle: 1 };
      }
      case 'follow': {
        // The 25 degree climb on his bearing, eased in, whatever his own
        // angle: my speed lasts, his does not.
        const toward = heading(sub(him.position, me.position));
        const k = pointNose(me, climbing(len(toward) > 0.05 ? toward : heading(me.velocity), easedClimb(c, 25, 20)), { fine: 6 });
        if (g.hisSpeed < 38 && g.range < 320 && g.mySpeed > 45) go(c, 'shoot');
        if (him.velocity[1] < -10 && mem.since > 2) { mem.climbDeg = undefined; go(c, 'chase'); }
        return { ...k, throttle: 1 };
      }
      case 'shoot':
        // The nose up onto him for the shot, but never into his climb: back
        // to the shallow line before my own speed goes.
        if (g.mySpeed < 38 || pitchOf(me.orientation) > 60 || mem.since > 6 || g.range > 380 || g.range < 110) {
          mem.climbDeg = undefined;
          go(c, g.hisSpeed < 30 && g.range > 70 ? 'follow' : 'chase');
        }
        return { ...leadPursuit(c, { push: 0.6, kPitch: 4 }), throttle: 1 };
      default: go(c, 'chase');
    }
    return null;
  },
};

/**
 * The mistake the up and over is made for: follow him straight up. Nose up
 * after him as steep as he goes; slower to start with, he runs out of speed
 * first and hangs below him, falls, recovers, and has lost him.
 */
PLANS.followStraightUp = {
  title: 'Following them straight up', first: 'chase',
  says: {
    chase: 'On his tail, closing',
    up: 'He pulled up: following him up, as steep as he goes',
    hang: 'Out of speed below him: the nose is falling',
    recover: 'Nose down for speed',
    search: 'Level again: where did he go?',
    break: 'He is on my tail: breaking',
  },
  step(c) {
    const { me, him, g, mem } = c;
    const hisPitch = pitchOf(him.orientation);
    if (mem.phase !== 'break' && mem.phase !== 'chase' && g.hisAta < 25 && g.ata > 90 && g.range < 300) {
      mem.breakSide = g.side;
      go(c, 'break');
    }
    switch (mem.phase) {
      case 'chase': {
        if (hisPitch > 20 && him.velocity[1] > 5) go(c, 'up');
        const k = g.range > c.gun.range + 60 ? pointNose(me, sub(him.position, me.position), { fine: 20 }) : leadPursuit(c);
        return { ...k, throttle: 1 };
      }
      case 'up': {
        // His climb or the line to him, whichever is steeper, on his bearing.
        if (g.mySpeed < 24) go(c, 'hang');
        const toward = heading(sub(him.position, me.position));
        const elev = Math.asin(clamp(unit(sub(him.position, me.position))[1])) / DEG;
        const want = Math.min(80, Math.max(elev, hisPitch));
        return { ...pointNose(me, climbing(len(toward) > 0.05 ? toward : heading(me.velocity), want), { fine: 6 }), throttle: 1 };
      }
      case 'hang':
        // Nothing left to fly with: the stick forward, the nose falls.
        if (pitchOf(me.orientation) < -30 || mem.since > 5) go(c, 'recover');
        return { pitch: 0.4, roll: 0, rudder: 0, throttle: 1 };
      case 'recover': {
        const h = heading(me.velocity);
        const k = pointNose(me, climbing(len(h) > 0.05 ? h : basis(me.orientation).F, g.mySpeed < 45 ? -35 : 0), { fine: 8 });
        if (g.mySpeed > 45 && pitchOf(me.orientation) > -12) { mem.searchDir = heading(me.velocity); go(c, 'search'); }
        return { ...k, throttle: 1 };
      }
      case 'search': {
        // Straight and level at a cruise, looking ahead for him. In front
        // and climbing, I go up after him again; in front, the chase.
        if (g.ata < 35 && g.range < 600) { mem.searchDir = null; go(c, him.velocity[1] > 8 && hisPitch > 25 ? 'up' : 'chase'); }
        if (mem.since > 14) { mem.searchDir = null; go(c, 'chase'); }
        return { ...pointNose(me, climbing(mem.searchDir ?? heading(me.velocity), 0), { fine: 8 }), throttle: holdSpeed(c, 50) };
      }
      case 'break': {
        const k = hardTurn(me, mem.breakSide ?? g.side);
        if (mem.since > 3 && !(g.hisAta < 40 && g.range < 350)) { mem.searchDir = heading(me.velocity); go(c, 'search'); }
        return { ...k, throttle: 1 };
      }
      default: go(c, 'chase');
    }
    return null;
  },
};

// --- up and over: the Dip, the Flip and the Ninja ----------------------------
// The pilot in trouble is the follower once the leader goes vertical
// (features/dogfight-school/reviews/dfn-uo.md). `uoAce` is the up-and-over
// ace who also dives after a pilot who runs; the other three are the
// follower's answers.

/**
 * The up and over, flown to win: as `upAndOver`, but once he is down from
 * the top and the other pilot is going away from him out of his pounce's
 * reach, he goes after him, any height over him spent on speed. An ace who
 * zoomed back up while his target flew off would not be one. The school's
 * rule for every ace: once the chase has had him past his guns' reach +
 * 30 m and not closing for 6 s in a row, he lets you go, climbs away on the
 * way he came and stays out. Turn back at him and he faces you (the chase
 * is on again once you are past); get on his tail and he breaks into you.
 */
PLANS.uoAce = {
  title: 'Up and over', first: 'run',
  says: {
    ...PLANS.upAndOver.says,
    chase: 'He is running: diving after him',
    'let-go': 'He is out of my reach and I am not closing: letting him go',
    meet: 'He is coming back at me: turning to face him',
    break: 'He is on my tail: breaking into him',
  },
  step(c) {
    const { me, him, g, mem } = c;
    if (['let-go', 'meet', 'break'].includes(mem.phase)) {
      const onTail = g.hisAta < 30 && g.ata > 100 && g.range < c.gun.range + 60;
      if (onTail && mem.phase !== 'break') { mem.breakSide = g.side; go(c, 'break'); }
      if (mem.phase === 'break') {
        if (mem.since > 2.5 && !onTail) go(c, 'let-go');
        else return { ...hardTurn(me, mem.breakSide ?? g.side), throttle: 1 };
      }
      if (mem.phase === 'let-go' && g.hisAta < 40 && g.range < 800 && g.closure > 5) go(c, 'meet');
      if (mem.phase === 'meet') {
        if (!(g.ata > 150 && g.range > 150)) {
          return { ...turnToward(c, sub(leadPoint(me, him, c.gun), me.position), { maxUp: 15, maxDown: 30 }), throttle: 1 };
        }
        mem.outFor = 0; mem.closing = undefined;
        go(c, 'chase');
      }
      if (mem.phase === 'let-go') {
        return { ...turnToward(c, climbing(mem.home, 15), { maxUp: 15, maxDown: 5 }), throttle: 1, aimed: false };
      }
    }
    const running = g.hisAta > 100 && g.range > 320;
    if (['pounce', 'zoom', 'chase'].includes(mem.phase) && running) go(c, 'chase');
    else if (mem.phase === 'chase') { mem.climbDeg = undefined; go(c, 'pounce'); }
    if (mem.phase === 'chase') {
      // His closure, smoothed over about three seconds, and how long he has
      // been out of reach and not closing.
      mem.closing = (mem.closing ?? g.closure) + (g.closure - (mem.closing ?? g.closure)) * Math.min(1, c.dt / 3);
      mem.outFor = g.range > c.gun.range + 30 && mem.closing < 0.5 ? (mem.outFor ?? 0) + c.dt : 0;
      if (mem.outFor >= 6) {
        mem.outFor = 0; mem.closing = undefined;
        mem.home = scale(heading(me.velocity), -1);
        go(c, 'let-go');
        return { ...turnToward(c, climbing(mem.home, 15), { maxUp: 15, maxDown: 5 }), throttle: 1, aimed: false };
      }
    } else { mem.outFor = 0; mem.closing = undefined; }
    if (mem.phase !== 'chase') return PLANS.upAndOver.step(c);
    const toward = unit(sub(him.position, me.position));
    if (angleBetween(heading(me.velocity), heading(toward)) > 55) return { ...hardTurn(me, g.side), throttle: 1 };
    const height = -g.above;
    const dive = height > 20 ? -Math.min(14, height / g.range * 57 + 6) : 0;
    const elev = Math.asin(clamp(toward[1])) / DEG;
    return { ...pointNose(me, climbing(heading(toward), Math.max(dive, elev)), { fine: 6, push: 0.6 }), throttle: 1 };
  },
};

/** The aim that takes me past him instead of into him: `off` metres beside
 *  him, on the side away from his, and 30 m under. */
function uoPassBeside(c, side, off = 80) {
  const { me, him } = c;
  const los = unit(sub(him.position, me.position));
  const across = unit([-los[2], 0, los[0]]);
  return sub(add(him.position, [across[0] * off * side, -30, across[2] * off * side]), me.position);
}

/** He is over the top and coming back down at me: his nose near me,
 *  inside 350 m, closing, descending, and fast enough to aim. */
const uoPounce = (c, g) => g.hisAta < 35 && g.range < 350 && g.closure > 5 && c.him.velocity[1] < 0 && g.hisSpeed > 33;

/**
 * THE DIP: out from under him. Climb after him at 30 degrees (never into
 * his climb), and as he goes over the top, past him, beside and under his
 * dive, then full throttle straight away from him in a shallow dive. His
 * half loop points him back the way he came while you go on, so he has to
 * turn round, from slow, to chase you; the 30 degree climb banked height
 * that the run turns into speed.
 */
PLANS.uoDip = {
  title: 'Out from under them', first: 'chase',
  says: {
    chase: 'On his tail, closing',
    'dip-follow': 'He went nearly straight up: climbing after him at 30 degrees, not into his climb',
    'dip-pass': 'He is going over the top: past him, beside and under his dive',
    'dip-run': 'Full throttle, straight away from him',
  },
  step(c) {
    const { me, him, g, mem } = c;
    switch (mem.phase) {
      case 'chase': {
        if (pitchOf(him.orientation) > 20 && him.velocity[1] > 5) go(c, 'dip-follow');
        const k = g.range > c.gun.range + 60 ? pointNose(me, sub(him.position, me.position), { fine: 20 }) : leadPursuit(c);
        return { ...k, throttle: 1 };
      }
      case 'dip-follow': {
        const over = pitchOf(him.orientation) < 30 && him.velocity[1] < 5 && mem.since > 3;
        if (uoPounce(c, g) || over) { mem.passSide = -g.side; go(c, 'dip-pass'); }
        const toward = heading(sub(him.position, me.position));
        return { ...pointNose(me, climbing(toward, easedClimb(c, 30, 20)), { fine: 6 }), throttle: 1 };
      }
      case 'dip-pass':
        if (mem.since > 1.5 && (g.ata > 100 || g.closure < 0)) { mem.runDir = heading(me.velocity); go(c, 'dip-run'); }
        return { ...pointNose(me, uoPassBeside(c, mem.passSide ?? 1), { fine: 8 }), throttle: 1 };
      case 'dip-run': {
        // Six degrees down, easing to level between 240 and 180 m.
        const y = me.position[1];
        const angle = y > 240 ? -6 : y > 180 ? -6 * (y - 180) / 60 : 0;
        const away = g.range > 150 ? heading(sub(me.position, him.position)) : mem.runDir;
        return { ...pointNose(me, climbing(away, angle), { fine: 8 }), throttle: 1 };
      }
      default: go(c, 'chase');
    }
    return null;
  },
};

/**
 * The up-and-over ace who plays to win (features/dogfight-school/reviews/
 * dfn-uo.md, "Ascendancy, round two"): `uoAce`, but after his first loop he
 * does not go up again in front of a man he can see behind his beam or
 * pointing at him (he breaks into him instead, and then lets him go or
 * meets him), he breaks from a man he sees on his tail in any phase, and
 * his chase after a runner also starts over the top. Flown in the Dip, the
 * Flip and the Ninja; the trap and its counter keep `uoAce`, whose loops
 * are what the lesson is about.
 */
PLANS.uoAceSharp = {
  ...PLANS.uoAce,
  says: { ...PLANS.uoAce.says, 'let-go': 'Breaking it off: climbing away the way I came' },
  step(c) {
    const { g, mem } = c;
    mem.loops ??= 0;
    if (mem.phase === 'pounce' && mem.lastPh !== 'pounce') mem.loops++;
    mem.lastPh = mem.phase;
    const again = mem.loops >= 1;
    if (again && mem.phase === 'over' && g.sees && g.hisAta > 100 && g.range > 320) { mem.outFor = 0; mem.closing = undefined; go(c, 'chase'); }
    const threat = g.sees && g.range < 500 && (g.ata > 100 || g.hisAta < 45);
    const onTail = g.sees && g.hisAta < 30 && g.ata > 100 && g.range < c.gun.range + 60;
    if (again && ((mem.phase === 'zoom' && threat) || (onTail && !['let-go', 'meet', 'break'].includes(mem.phase)))) {
      mem.breakSide = g.side; mem.home ??= heading(c.me.velocity); go(c, 'break');
    }
    // Breaking it off close in, a shot that would land is still taken.
    const out = PLANS.uoAce.step(c);
    if (out && out.aimed === false && g.sees && gunSolution(c.me, c.him, { ...c.gun, accel: null, width: 5 }).fire) out.aimed = true;
    return out;
  },
};

/**
 * The ascendancy over a man who goes up and over (the Ninja), and the Flip
 * from following him up (`fromUp`): never follow him up, never give him a
 * target as he comes down, and never circle with him.
 *
 *   - Chase straight and level until he pulls up; follow at 24 degrees on
 *     his bearing, steered gently.
 *   - The shot as he slows over the top; off it at 40 m/s, or 41.5 while he
 *     hangs, so the speed comes back before it is gone.
 *   - Off him: nose down beside his dive, full forward stick.
 *   - The slice: round onto his line nose low, to the side his own heading
 *     lies, under and behind him.
 *   - If he goes up again: the follow and the shot at the next top. If he
 *     breaks off and flies away instead: in behind him, closing, guns only
 *     inside 200 m, under his tail where he loses me.
 *   - When he sees me and turns in: leave, straight away at full throttle
 *     (the shared `ascend` pilot's leave and return), never round with him.
 *     The return is too slow to bring a third attack inside 50 s.
 *
 * (features/dogfight-school/reviews/dfn-uo.md, "Ascendancy".)
 */
const UO = {
  climb: 24, followFine: 30,
  slow: 42, reach: 340, onSpeed: 36,
  offSpeed: 40, hangSpeed: 28, hangOff: 45, hangOffSpeed: 41.5, offPitch: 45, shotFor: 6, near: 100, far: 380,
  passOff: 80, passUp: -15, passFor: 1.5,
  sliceDown: 0.4, slicePull: 0.85, sliceDone: 75, sliceFor: 7, floor: 150,
  stalkFire: 200, stalkTurn: 150, stalkMin: 70,
  // The Flip from following him up: off the climb at this speed, nose down
  // and off his line until this speed.
  upOff: 42, diveTo: 50,
};
/** The shared ascendancy pilot's phases, flown as they are once it has me. */
const ASC_PHASES = ['find', 'dive', 'zoom', 'over', 'beam', 'climb', 'leave', 'back'];
function uoAscend(move, title, { fromUp = false } = {}) {
  const name = s => `${move}-${s}`;
  const step = s => s.replace(`${move}-`, '');
  const to = (c, s) => { c.mem.climbDeg = undefined; go(c, name(s)); };
  const says = {
    follow: 'He went nearly straight up: climbing after him at 24 degrees, nose under him, saving my speed',
    shoot: 'He is slow over the top and in front of me: guns',
    pass: 'Off the shot at 41 m/s: pushing the nose down, past him beside his dive',
    slice: 'Round onto his line nose low, under his tail',
    back: 'Behind him again, shallow, waiting for him to go up',
    stalk: 'He has turned away and lost me: in behind him, closing',
    ...(fromUp ? { dive: 'He is coming over the top at me and I am out of speed: nose down, off his line' } : {}),
  };
  return {
    title, first: 'chase',
    // The ascendancy pilot is defined further down: its words are read when asked for.
    get says() {
      return {
        chase: 'On his tail, closing',
        ...(fromUp ? { up: 'He pulled up: following him up, as steep as he goes' } : {}),
        ...Object.fromEntries(Object.entries(says).map(([k, v]) => [name(k), v])),
        ...PLANS.ascend.says,
        leave: 'He has seen me and turned in: leaving at full throttle rather than turn with him',
      };
    },
    step(c) {
      const { me, him, g, mem } = c;
      const hisPitch = pitchOf(him.orientation);
      const up = hisPitch > 20 && him.velocity[1] > 5;
      if (mem.asc) {
        // The ascendancy pilot has me; back to the follow if he goes up again.
        if (up && g.ata < 70 && -g.above < 35) { mem.asc = false; to(c, 'follow'); } else return PLANS.ascend.step(c);
      }
      if (!['chase', 'up', name('pass'), name('dive')].includes(mem.phase) && uoPounce(c, g)) { mem.passSide = -g.side; to(c, 'pass'); }
      switch (step(mem.phase)) {
        case 'chase':
          if (up) { if (fromUp) go(c, 'up'); else to(c, 'follow'); }
          if (fromUp) {
            const k = g.range > c.gun.range + 60 ? pointNose(me, sub(him.position, me.position), { fine: 20 }) : leadPursuit(c);
            return { ...k, throttle: 1 };
          }
          return { ...pointNose(me, climbing(heading(me.velocity), 0), { fine: 6 }), throttle: 1 };
        case 'up': {
          // The lesson's mistake, as `followStraightUp` flies it, until the
          // speed says he is going over the top and I am not.
          if (g.mySpeed < UO.upOff) { mem.diveSide = -g.side; to(c, 'dive'); break; }
          const toward = heading(sub(him.position, me.position));
          const elev = Math.asin(clamp(unit(sub(him.position, me.position))[1])) / DEG;
          const want = Math.min(80, Math.max(elev, hisPitch));
          return { ...pointNose(me, climbing(len(toward) > 0.05 ? toward : heading(me.velocity), want), { fine: 6 }), throttle: 1 };
        }
        case 'follow': {
          const toward = heading(sub(him.position, me.position));
          const k = pointNose(me, climbing(len(toward) > 0.05 ? toward : heading(me.velocity), easedClimb(c, UO.climb, 20)), { fine: UO.followFine });
          if (g.hisSpeed < UO.slow && g.range < UO.reach && g.mySpeed > UO.onSpeed) to(c, 'shoot');
          return { ...k, throttle: 1 };
        }
        case 'shoot': {
          const hanging = g.hisSpeed < UO.hangSpeed && g.hisAta > UO.hangOff;
          if (g.mySpeed < (hanging ? UO.hangOffSpeed : UO.offSpeed) || pitchOf(me.orientation) > UO.offPitch || mem.since > UO.shotFor
              || g.range > UO.far || g.range < UO.near) { mem.passSide = -g.side; to(c, 'pass'); }
          return { ...leadPursuit(c, { push: 0.6, kPitch: 4 }), throttle: 1 };
        }
        case 'pass': {
          if (mem.since > UO.passFor && !(g.hisAta < 50 && g.range < 350)) { mem.sliceSide = undefined; to(c, 'slice'); }
          let d = unit(uoPassBeside(c, mem.passSide ?? 1, UO.passOff));
          if (Math.asin(clamp(d[1])) / DEG > UO.passUp) d = climbing(heading(d), UO.passUp);
          return { ...pointNose(me, d, { fine: 8, push: 1 }), throttle: 1 };
        }
        case 'dive': {
          if (g.mySpeed > UO.diveTo && mem.since > 1) { mem.sliceSide = undefined; to(c, 'slice'); }
          const h = len(heading(me.velocity)) > 0.1 ? heading(me.velocity) : heading(basis(me.orientation).F);
          const right = [-h[2], 0, h[0]];
          return { ...pointNose(me, add(scale(right, (mem.diveSide ?? 1) * 1.5), [0, -1.5, 0]), { fine: 8, push: 1 }), throttle: 1 };
        }
        case 'slice': {
          // He is behind me: round, decisively, to the side his own heading
          // lies on, the lift below the horizon so the turn spends height.
          const h = heading(me.velocity), right = [-h[2], 0, h[0]];
          mem.sliceSide ??= Math.sign(dot(right, heading(him.velocity))) || 1;
          const toHim = heading(sub(him.position, me.position));
          const want = g.ata > 120 ? scale(right, mem.sliceSide) : toHim;
          const down = c.agl > UO.floor ? UO.sliceDown : -0.3;
          if (g.ata < UO.sliceDone || mem.since > UO.sliceFor) to(c, 'back');
          return { ...pullLift(me, add(want, [0, -down, 0]), UO.slicePull), throttle: 1 };
        }
        case 'back': {
          if (up && g.ata < 70) { to(c, 'follow'); return { ...pointNose(me, sub(him.position, me.position), { fine: 10 }), throttle: 1 }; }
          if (!up && g.ata < 60 && g.hisAta > UO.stalkTurn) { to(c, 'stalk'); break; }
          const lp = sub(leadPoint(me, him, c.gun), me.position);
          const k = g.range > 300 || g.ata > 40 ? turnToward(c, lp, { maxUp: 25 }) : leadPursuit(c);
          return { ...k, throttle: 1 };
        }
        case 'stalk': break;
        default: go(c, 'chase');
      }
      if (step(mem.phase) === 'stalk') {
        if (up && g.ata < 70) { to(c, 'follow'); return { ...pointNose(me, sub(him.position, me.position), { fine: 10 }), throttle: 1 }; }
        // He has seen me and is turning in, or I am on top of him: leave, and
        // let the ascendancy pilot bring me back with the height.
        if ((g.sees && g.hisAta < UO.stalkTurn - 20 && mem.since > 0.5) || g.range < UO.stalkMin) {
          mem.leaveDir = heading(sub(me.position, him.position));
          mem.asc = true;
          go(c, 'leave');
          return PLANS.ascend.step(c);
        }
        if (g.range > UO.stalkFire) return { ...pointNose(me, sub(leadPoint(me, him, c.gun), me.position), { fine: 8 }), throttle: 1 };
        return { ...leadPursuit(c), throttle: 1 };
      }
      return null;
    },
  };
}
PLANS.uoFlip = uoAscend('flip', 'Out of their pounce, round behind them', { fromUp: true });
PLANS.uoNinja = uoAscend('ninja', 'Never up after them, never round with them');

/** The pilot who never looks up: straight and level at his cruise the
 *  whole fight, whatever goes past him. */
PLANS.unaware = {
  title: 'Not looking up', first: 'cruise',
  says: { cruise: 'Flying straight and level, never looking up' },
  step(c) {
    const { g, mem } = c;
    if (!mem.cruiseDir) { mem.cruiseDir = heading(c.me.velocity); mem.cruise = g.mySpeed; }
    go(c, 'cruise');
    return { ...pointNose(c.me, climbing(mem.cruiseDir, 0), { fine: 6 }), throttle: holdSpeed(c, mem.cruise) };
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

/**
 * The gunnery drill's target (features/dogfight-doctrine, Boelcke's rule 3):
 * a towed sleeve's course that never shoots, never breaks and never looks
 * round. Straight, a gentle turn, straight, a jink, straight, a climbing
 * turn, and round again, each turn the other way from the last, at a
 * steady 50 m/s. Every round aimed at it is the pilot's lesson in range.
 */
const TARGET = { cruise: 50, order: ['straight', 'turn', 'straight', 'jink', 'straight', 'climb'],
  seconds: { straight: 4, turn: 6, jink: 4, climb: 5 } };
PLANS.target = {
  title: 'The target', first: 'straight',
  says: {
    straight: 'Flying straight: the easy shot, once you are close',
    turn: 'A gentle turn: lead them',
    jink: 'Jinking: wait for them to steady',
    climb: 'A climbing turn: lead them up',
  },
  step(c) {
    const { me, mem } = c;
    mem.k ??= 0;
    mem.side ??= 1;
    if (mem.since > TARGET.seconds[mem.phase]) {
      mem.k = (mem.k + 1) % TARGET.order.length;
      if (TARGET.order[mem.k] !== 'straight') mem.side = -mem.side;
      mem.dir = null;
      go(c, TARGET.order[mem.k]);
    }
    const throttle = holdSpeed(c, TARGET.cruise);
    let k;
    switch (mem.phase) {
      case 'turn': k = hardTurn(me, mem.side, { pull: 0.45, maxBank: 40 }); break;
      case 'climb': k = hardTurn(me, mem.side, { climb: 12, pull: 0.5, maxBank: 45 }); break;
      case 'jink': k = bankAndPull(me, (Math.floor(mem.since / 0.8) % 2 ? 1 : -1) * mem.side * 45, 0.35); break;
      default:
        mem.dir ??= heading(me.velocity);
        k = pointNose(me, climbing(mem.dir, 0), { fine: 6 });
    }
    return { ...k, throttle, aimed: false };
  },
};

/**
 * The falling leaf (features/dogfight-doctrine, Boelcke's rule 4: never be
 * deceived by ruses). A pilot with an enemy settled on his tail chops his
 * throttle and drops away in a spiral, as a plane that has been hit falls;
 * past `LEAF.drop` metres down he pulls out and comes back up at his
 * follower from below, where the wings hide him.
 */
const LEAF = { onTail: 300, settle: 2.5, bank: 110, drop: 170, fallMax: 6, recoverPitch: 5 };
PLANS.leafAce = {
  title: 'The falling leaf', first: 'cruise',
  says: {
    cruise: 'Cruising, letting them settle on my tail',
    fall: 'Hit, falling away: throttle off, spiralling down',
    recover: 'Pulling out low, under their wings',
    attack: 'Back up at them from below',
  },
  step(c) {
    const { me, g, mem } = c;
    switch (mem.phase) {
      case 'cruise': {
        // Him settled behind me inside the guns' reach for a moment: fall.
        const behind = g.hisAta < 25 && g.ata > 120 && g.range < LEAF.onTail;
        mem.behindT = behind ? (mem.behindT ?? 0) + c.dt : 0;
        if (mem.behindT > LEAF.settle) { mem.fallFrom = me.position[1]; mem.side = g.side || 1; go(c, 'fall'); break; }
        mem.dir ??= heading(me.velocity);
        return { ...pointNose(me, climbing(mem.dir, 0), { fine: 6 }), throttle: holdSpeed(c, 58) };
      }
      case 'fall': {
        if (mem.fallFrom - me.position[1] > LEAF.drop || mem.since > LEAF.fallMax) { go(c, 'recover'); break; }
        return { ...bankAndPull(me, mem.side * LEAF.bank, 0.8), throttle: -1, aimed: false };
      }
      case 'recover': {
        if (pitchOf(me.orientation) > LEAF.recoverPitch || mem.since > 3) { go(c, 'attack'); break; }
        return { ...pointNose(me, climbing(heading(me.velocity), 10), { fine: 20 }), throttle: 1, aimed: false };
      }
      default:
        break;
    }
    return { ...leadPursuit(c, { pull: 1, push: 0.5 }), throttle: 1 };
  },
};

/** Fooled by the falling leaf: on his tail and shooting until he drops away,
 *  then sure of the kill, flying on, never looking down or back. */
PLANS.leafFooled = {
  title: 'Taking the fall for a kill', first: 'chase',
  says: { chase: 'On their tail, guns on them', done: 'They are going down: flying on' },
  step(c) {
    const { me, him, g, mem } = c;
    if (mem.phase === 'chase' && him.velocity[1] < -15 && g.above < -40) { mem.dir = heading(me.velocity); go(c, 'done'); }
    if (mem.phase === 'done') return { ...pointNose(me, climbing(mem.dir, 0), { fine: 6 }), throttle: 1, aimed: false };
    return { ...leadPursuit(c, { pull: 1, push: 0.6 }), throttle: g.closure > 12 && g.range < 220 ? 0.2 : 1 };
  },
};

/** Not fooled: down after him, staying above and behind him through the
 *  fall, nose on, throttle back so as not to fly past; as he pulls out,
 *  in on him while his nose is still coming up. */
PLANS.leafFollow = {
  title: 'Following the fall', first: 'chase',
  says: { chase: 'On their tail, guns on them', follow: 'They are falling: following them down, above and behind', pounce: 'They are pulling out: in on them' },
  step(c) {
    const { me, him, g, mem } = c;
    if (mem.phase === 'chase' && him.velocity[1] < -15 && g.above < -40) go(c, 'follow');
    if (mem.phase === 'follow') {
      if (him.velocity[1] > -3 && mem.since > 1.5) { go(c, 'pounce'); }
      else {
        // His position a second and a half back along his path, 60 m above.
        const p = add(sub(him.position, scale(him.velocity, 1.5)), [0, 60, 0]);
        return { ...pointNose(me, sub(p, me.position), { fine: 10 }), throttle: g.range < 260 ? -1 : 0.3, aimed: true };
      }
    }
    return { ...leadPursuit(c, { pull: 1, push: 0.6 }), throttle: g.closure > 12 && g.range < 220 ? 0.2 : 1 };
  },
};

/**
 * The pair (features/dogfight-doctrine, Boelcke's rule 8; the Rotte): the
 * wingman flies a station off his leader's beam, a little behind, and his
 * whole job is the leader's tail: an enemy closing on it inside
 * `PAIR.cover` metres is his target until it is gone or off the tail.
 * Needs the fight's `c.team` (`dogfight-fight.js` `runFight`).
 */
const PAIR = { abeam: 180, behind: 60, cover: 800, tailCone: 60, hold: 4, holdCone: 90, turnBack: 90, rejoin: 250, faster: 1.03 };
PLANS.wingman = {
  title: 'The wingman', first: 'station',
  // Said under the wingman's own caption row, the leader being you: the
  // words name "your" tail, which no third-person rewrite touches.
  says: { station: 'Off your wing, a little behind, watching your tail', rejoin: 'Coming back to your wing',
          cover: 'Breaking onto the plane on your tail', shoot: 'On their tail, going for the shot' },
  step(c) {
    const { me, mem, team } = c;
    const lead = team?.friends.find(f => f.i === (mem.leader ?? f.i)) ?? team?.friends[0];
    if (!lead) { mem.target = null; return { ...leadPursuit(c, { pull: 1 }), throttle: 1 }; }
    const L = lead.state, lf = basis(L.orientation).F;
    // An enemy on the leader's tail: behind him, inside the cone, closing.
    // One he is already after, that has swung off the tail for a moment (a
    // hunter weaving behind a slow-rolling leader, FHSW's P-47), he stays
    // after for `PAIR.hold` seconds while its nose is still near the
    // leader's way: back on station he would be half a kilometre out when it
    // came back.
    const holding = (mem.phase === 'cover' || mem.phase === 'shoot') && mem.t - (mem.coverAt ?? -Infinity) < PAIR.hold;
    const threat = (team.enemies ?? []).map(e => {
      const rel = sub(L.position, e.state.position), d = len(rel);
      const ef = basis(e.state.orientation).F;
      const nose = Math.acos(clamp(dot(ef, scale(rel, 1 / Math.max(d, 1e-6))))) / DEG;
      const behind = Math.acos(clamp(dot(lf, scale(rel, 1 / Math.max(d, 1e-6))))) / DEG;
      const ok = d < PAIR.cover && nose < PAIR.tailCone && behind < 70;
      const held = !ok && holding && e.i === mem.target && d < PAIR.cover && nose < PAIR.holdCone && behind < PAIR.holdCone;
      return { e, d, ok: ok || held, held };
    }).filter(x => x.ok).sort((a, b) => a.d - b.d)[0];
    if (threat) {
      if (!threat.held) mem.coverAt = mem.t;
      mem.target = threat.e.i;
      const T = threat.e.state;
      // On its tail, nose on it: the shot. Else still breaking onto it.
      const fromIt = sub(me.position, T.position), dIt = len(fromIt);
      const onTail = dIt < 600 && angleBetween(scale(basis(T.orientation).F, -1), fromIt) < 60
        && angleBetween(basis(me.orientation).F, scale(fromIt, -1)) < 30;
      go(c, onTail ? 'shoot' : 'cover');
      // A hunter whose type flies faster than his own (the pair's own gap,
      // `team.level`: a Bf 109 on a Hurricane's tail), met nose to nose,
      // would be past him at a closing speed he cannot turn back from in
      // time. While it is still coming at him he holds his place on the
      // leader's wing, his heading, full throttle, and lets it come by: once
      // it is past his beam he is behind it, and goes for it.
      const faster = threat.e.level > 0 && team.level > 0 && threat.e.level > team.level * PAIR.faster;
      const ahead = angleBetween(basis(me.orientation).F, scale(fromIt, -1)) < PAIR.turnBack;
      const facing = angleBetween(basis(T.orientation).F, fromIt) < 90;
      if (!onTail && faster && facing && ahead) {
        return { ...pointNose(me, climbing(heading(L.velocity), 0), { fine: 8 }), throttle: 1, aimed: false };
      }
      // Past it, behind his beam (`PAIR.turnBack` degrees off his heading):
      // come round level and hard (`turnToward`) rather than chase the nose
      // round a point over his shoulder, which on FHSW's P-47 flew him
      // straight on and away from the fight after a head-on pass.
      const toThreat = sub(threat.e.state.position, me.position);
      if (angleBetween(heading(me.velocity), heading(toThreat)) > PAIR.turnBack) return { ...turnToward(c, toThreat), throttle: 1, aimed: false };
      // The target this tick may still be another: point at the threat
      // until the fight hands him over next tick.
      if (c.team.target === threat.e.i) return { ...leadPursuit(c, { pull: 1, push: 0.6 }), throttle: 1 };
      return { ...pointNose(me, sub(threat.e.state.position, me.position), { fine: 8 }), throttle: 1, aimed: false };
    }
    mem.target = null;
    // His station: abeam the leader on the side he is already on, a little
    // behind, at the leader's height.
    const lr = basis(L.orientation).R;
    const side = Math.sign(dot(sub(me.position, L.position), lr)) || 1;
    const spot = add(add(L.position, scale(lr, side * PAIR.abeam)), scale(lf, -PAIR.behind));
    const toSpot = sub(add(spot, scale(L.velocity, 2)), me.position);
    const gap = dot(sub(spot, me.position), lf);
    // Far off it (back from a fight) he says so: he is coming back.
    go(c, len(sub(spot, me.position)) > PAIR.rejoin ? 'rejoin' : 'station');
    return { ...pointNose(me, toSpot, { fine: 8 }), throttle: clamp(0.6 + gap * 0.02, -1, 1), aimed: false };
  },
};

/**
 * The Thach weave (Thach, 1941; features/dogfight-school research.md): two
 * fighters abreast; when an enemy settles on either one's tail, both turn
 * hard toward each other, and the attacker, following his target round,
 * is dragged across the other's nose. At each crossing they reverse, toward
 * each other again. Whoever has the attacker across his nose shoots.
 */
const WEAVE = { tail: 900, tailCone: 50, shootRange: 600, shootCone: 35, floor: 112 };
PLANS.weaver = {
  title: 'The weave', first: 'abreast',
  says: { abreast: 'Two abreast, each watching the other\'s tail', weave: 'Someone is on a tail: turning in toward the other plane', shoot: 'They are across my nose: shooting' },
  step(c) {
    const { me, mem, team, g } = c;
    const mate = team?.friends[0];
    if (!mate) return { ...leadPursuit(c, { pull: 1 }), throttle: 1 };
    const tailed = st => (team.enemies ?? []).some(e => {
      const rel = sub(st.position, e.state.position), d = len(rel);
      const nose = Math.acos(clamp(dot(basis(e.state.orientation).F, scale(rel, 1 / Math.max(d, 1e-6))))) / DEG;
      return d < WEAVE.tail && nose < WEAVE.tailCone;
    });
    const threat = tailed(me) || tailed(mate.state);
    // A shot: the enemy across my nose, close.
    if (threat && g.ata < WEAVE.shootCone && g.range < WEAVE.shootRange && g.sees) {
      go(c, 'shoot');
      return { ...leadPursuit(c, { pull: 1, push: 0.6 }), throttle: 1 };
    }
    if (threat) {
      // Toward the partner: on the horizon, which side of my heading he is.
      const side = sideOf(basis(me.orientation), sub(mate.state.position, me.position));
      if (mem.phase !== 'weave') mem.weaveSide = side;
      // Past each other (he is now on the other side): reverse, toward him again.
      if (mem.phase === 'weave' && side !== mem.weaveSide && mem.since > 2) { mem.weaveSide = side; mem.since = 0; }
      go(c, 'weave');
      // Under `WEAVE.floor` metres the turn climbs: BF1918's SE5, 42 m/s
      // level, sinks in every hard turn and otherwise weaves itself into the
      // ground inside the minute.
      const low = WEAVE.floor - c.agl;
      const climb = low > 0 ? clamp(low * 0.1, 0, 4) : 0;
      return { ...hardTurn(me, mem.weaveSide, { maxBank: 80, climb }), throttle: 1, aimed: false };
    }
    go(c, 'abreast');
    mem.dir ??= heading(me.velocity);
    return { ...pointNose(me, climbing(mem.dir, 0), { fine: 6 }), throttle: holdSpeed(c, 60), aimed: false };
  },
};

/**
 * Against a two-seater (features/dogfight-doctrine, Mannock's rule: "attack
 * two-seaters from beneath their tails"): close on a point `UNDER.below`
 * metres under his tail and `UNDER.back` behind it, where his gunner's ring
 * cannot depress; from there pull up into him and fire; after the burst drop
 * back under him and go again.
 */
const UNDER = { below: 90, back: 160, near: 60, climbFor: 3.5 };
PLANS.underTail = {
  title: 'From beneath the tail', first: 'approach',
  says: { approach: 'Closing under their tail, out of the gunner\'s ring', climb: 'Pulling up into them from below', drop: 'Back down under them' },
  step(c) {
    const { me, him, g, mem } = c;
    const hf = heading(him.velocity);
    const spot = add(add(him.position, scale(hf, -UNDER.back)), [0, -UNDER.below, 0]);
    const toSpot = sub(spot, me.position);
    if (mem.phase === 'approach' && len(toSpot) < UNDER.near) go(c, 'climb');
    if (mem.phase === 'climb' && (mem.since > UNDER.climbFor || g.range < 70)) go(c, 'drop');
    if (mem.phase === 'drop' && mem.since > 3) go(c, 'approach');
    if (mem.phase === 'climb') return { ...leadPursuit(c, { pull: 1, push: 0.6 }), throttle: 1 };
    // Ahead of the spot along his path, with his speed: station-keeping.
    const lead = add(spot, scale(him.velocity, 1.5));
    const along = dot(sub(spot, me.position), hf);
    // A shot that comes on the way in, from under the tail, is taken.
    return { ...pointNose(me, sub(lead, me.position), { fine: 8 }), throttle: clamp(0.5 + along * 0.02, -1, 1) };
  },
};

/** Straight and level: the sitting duck. */
PLANS.cruiser = {
  title: 'Flying straight', first: 'cruise',
  says: { cruise: 'Flying straight and level, not looking back' },
  step(c) {
    // Cruising, as the break turn's pilot does before he breaks: the speed
    // he started at, not the throttle against the stop.
    // An airframe that cannot fly that fast (BF1918's D.VII tops out at
    // 42 m/s) would hold its throttle on the stop for good, as fast as
    // anything chasing it; a lesson can cap the cruise (`mem.cruiseCap`).
    if (!c.mem.dir) { c.mem.dir = heading(c.me.velocity); c.mem.cruise = c.g.mySpeed; }
    return { ...pointNose(c.me, climbing(c.mem.dir, 0), { fine: 6 }),
             throttle: Math.min(holdSpeed(c, c.mem.cruise), c.mem.cruiseCap ?? 1) };
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
    extend: 'He zoomed: not following, speed first',
  },
  step(c) {
    const { me, him, g, mem } = c;
    const toward = heading(sub(him.position, me.position));
    // His dive: coming down at me from above, fast, nose on. Held half a
    // second, so a wingover's nose-down moment is not mistaken for one.
    const diving = him.velocity[1] < -12 && g.hisAta < 50 && g.above > 60 && g.closure > 20;
    mem.divingT = diving ? (mem.divingT ?? 0) + c.dt : 0;
    switch (mem.phase) {
      case 'climb': {
        // A shallow climb that keeps him in view: up to 20 degrees, less
        // while the speed is low, turning gently (about 12 degrees a second)
        // toward his side of the sky when he is off the nose, never flying
        // away from him with his dive behind.
        if (mem.divingT > 0.5 && g.range < 1000) go(c, 'face');
        const deg = clamp((g.mySpeed - 36) * 1.6, 0, 20);
        const off = angleBetween(heading(me.velocity), toward);
        return { ...climbingTurn(c, g.side, deg, clamp((off - 20) / 90, 0, 1) * 0.12), throttle: 1 };
      }
      case 'face': {
        // Turn to face him, the nose never more than 15 degrees above the
        // horizon so the speed stays: a head-on pass, short. Once he is
        // zooming away, let him go.
        const lp = sub(leadPoint(me, him, c.gun), me.position);
        if (g.range < 220) go(c, 'pass');
        if ((mem.divingT === 0 && mem.since > 4) || (him.velocity[1] > 0 && mem.since > 1)) go(c, 'extend');
        return { ...turnToward(c, lp, { maxUp: 15 }), throttle: 1 };
      }
      case 'pass': {
        if (g.closure < 0 || mem.since > 3 || him.velocity[1] > 0) go(c, 'extend');
        const lp = sub(leadPoint(me, him, c.gun), me.position);
        return { ...turnToward(c, lp, { maxUp: 15 }), throttle: 1 };
      }
      case 'extend': {
        // Not following his zoom: the nose on the horizon until the speed
        // is back over 45 m/s, then the shallow climb again.
        const h = heading(me.velocity);
        if (g.mySpeed > 45 && mem.since > 2) go(c, 'climb');
        return { ...pointNose(me, climbing(h, 2), { fine: 6 }), throttle: 1 };
      }
      default: go(c, 'climb');
    }
    return null;
  },
};

/**
 * BOOM AND ZOOM, THE DIP: leaving a boom-and-zoomer. Meet his first dive
 * head on (as `meetTheDive`), then run out of the pass the way it left you,
 * his zoom going the other way: flat out, the nose 6 degrees down to 150 m
 * for the speed, then level, turning only to keep him behind the wing. His
 * 400 m buys him a minute of dives after you, never inside his reach; an
 * ace who gives up a chase he cannot win (`bzAce`) lets you go at 62 to
 * 76 s (features/dogfight-school/reviews/dfn-bz.md).
 */
PLANS.bzDip = {
  title: 'Running for it', first: 'climb',
  says: {
    ...PLANS.meetTheDive.says,
    'dip-run': 'His zoom took him the other way: running, low and flat out',
  },
  step(c) {
    const { me, him, g, mem } = c;
    if (mem.phase === 'extend') { mem.runDir = heading(me.velocity); go(c, 'dip-run'); }
    if (mem.phase !== 'dip-run') return PLANS.meetTheDive.step(c);
    // Him ahead of the wing: run away from him instead.
    if (g.ata < 80 && g.range > 300) mem.runDir = heading(sub(me.position, him.position));
    // Down to 150 m once, then level there: switching between the two each
    // time the height wanders over 150 m bobs the nose and costs 8 m/s.
    if (me.position[1] <= 152) mem.low = true;
    const deg = !mem.low ? -6 : clamp((150 - me.position[1]) * 0.1, -2, 3);
    return { ...turnToward(c, climbing(mem.runDir, deg), { maxUp: 3, maxDown: 20 }), throttle: 1 };
  },
};

/**
 * Boom and zoom's aim on a man in front: lead pursuit with the lead's own
 * swing led 0.7 s, as the ascendancy pilot aims (`ascAim`, copied: that
 * one is private to `ascend`).
 */
function bzAim(c) {
  const D = unit(sub(leadPoint(c.me, c.him, c.gun), c.me.position));
  const m = c.mem.bzAim ?? (c.mem.bzAim = {});
  const Dd = m.D ? scale(sub(D, m.D), 1 / c.dt) : [0, 0, 0];
  m.Dd = m.Dd ? add(scale(m.Dd, 0.7), scale(Dd, 0.3)) : Dd;
  m.D = D;
  return pointNose(c.me, add(D, scale(m.Dd, 0.7)), { fine: 8, mem: m, dt: c.dt, pull: 0.95, push: 0.8 });
}

/** The phases in which a boom-and-zoom pilot under him is still meeting his dives. */
const BZ_MEET = ['climb', 'face', 'pass', 'extend'];

/**
 * Meeting his dives with his height spent: once my energy is up to his and
 * he is more than 800 m out, a climbing turn toward him at three times the
 * meet's rate, so the fight does not drift apart. Otherwise `meetTheDive`.
 */
function bzMeetAndClose(c) {
  const { me, him, g, mem } = c;
  if (mem.phase === 'climb' && -g.energy >= 0 && g.range > 800) {
    PLANS.meetTheDive.step(c);
    if (mem.phase === 'climb') {
      const deg = clamp((g.mySpeed - 36) * 1.6, 0, 20);
      const off = angleBetween(heading(me.velocity), heading(sub(him.position, me.position)));
      return { ...climbingTurn(c, g.side, deg, clamp((off - 10) / 60, 0, 1) * 0.35), throttle: 1 };
    }
  }
  return PLANS.meetTheDive.step(c);
}

/**
 * BOOM AND ZOOM, THE FLIP: from his target to behind him. His pass cannot
 * be turned round (he comes out of the dive 30 m/s faster and zooms out of
 * reach), so meet his dives until his height is spent (the demo opens
 * there, after two met dives, both climbing level). Then, with my energy up
 * to his, inside 500 m, his nose 100 degrees or more off me and mine within
 * 150 of him: in behind him with the lead (`flip-in`), guns inside 262 m.
 * Off him before the paths cross, inside 40 m, when his nose comes round
 * onto me inside 400 m, when the nose is still 60 degrees off him 3 s in,
 * or 5 s in without the shot; then up and away rather than follow his
 * break round (`flip-off`, `flip-leave`). (reviews/dfn-bz.md, "Ascendancy
 * (2026-11-07)": 0 of 9; level with him, the nose never comes onto him.)
 */
PLANS.bzFlip = {
  title: 'Behind them once their height is spent', first: 'climb',
  says: {
    ...PLANS.meetTheDive.says,
    'flip-in': 'His height is spent and his nose is away: in behind him, guns on his lead',
    'flip-off': 'Off him before he turns onto me: up on the speed',
    'flip-leave': 'Not following his break round: out and away, climbing',
  },
  step(c) {
    const { me, him, g, mem } = c;
    const toMerge = g.closure > 1 ? g.range / g.closure : Infinity;
    if (!mem.flipped && BZ_MEET.includes(mem.phase)) {
      const behind = ['climb', 'extend'].includes(mem.phase) && -g.energy >= 0 && g.range < 500 && g.hisAta > 100 && g.ata < 150;
      if (!behind) return bzMeetAndClose(c);
      mem.flipped = true;
      mem.bzAim = undefined;
      go(c, 'flip-in');
    }
    if (mem.phase === 'flip-in') {
      const off = toMerge < 1 || g.range < 40 || (g.hisAta < 30 && g.range < 400) || (g.ata > 60 && mem.since > 3) || mem.since > 5;
      if (!off) return { ...bzAim(c), throttle: 1, aimed: g.range < 262 };
      mem.offDir = heading(me.velocity);
      go(c, 'flip-off');
    }
    if (mem.phase === 'flip-off') {
      if (g.mySpeed > 62 && mem.since < 8) return { ...pointNose(me, climbing(mem.offDir, 60), { fine: 6, pull: 0.7 }), throttle: 1, aimed: false };
      mem.leaveDir = heading(sub(me.position, him.position));
      go(c, 'flip-leave');
    }
    go(c, 'flip-leave');
    mem.leaveDir ??= heading(sub(me.position, him.position));
    const el = clamp((g.mySpeed - 40) * 1.6, 0, 15);
    return { ...turnToward(c, climbing(mem.leaveDir, el), { maxUp: 15, maxDown: 5 }), throttle: 1, aimed: false };
  },
};

/**
 * BOOM AND ZOOM, THE NINJA: his height spent (the demo opens there, after
 * two met dives), the best try at being the one above. Climb with him
 * (`meetTheDive`, facing him if he dives) until I am 35 m over him with 30 m
 * of energy in hand (`ninja-perch`: level, toward him); then, he 15 degrees
 * or more below my horizon, inside 550 m, his nose 60 degrees off me and
 * mine within 75 of him, one pass down on him with the lead (`ninja-dive`).
 * Off it 1 s before the paths cross, inside 35 m, when the pull-out would
 * bottom out 20 m under him, when he turns his nose onto me inside 400 m
 * (he meets it), or 5 s in without the shot; up on the dive's speed
 * (`ninja-zoom`). A pass that landed a burst, he not meeting it and the
 * energy still mine: over the top and down again (`ninja-over`). Otherwise,
 * or after 25 s without the perch, out on the speed, the Dip (`ninja-run`),
 * never round and round with him at even energy (reviews/dfn-bz.md,
 * "Ascendancy (2026-11-07)": 0 of 9 against `bzAceMeet`, he meets the pass).
 */
PLANS.bzNinja = {
  title: 'One pass from above, then away', first: 'climb',
  says: {
    ...PLANS.meetTheDive.says,
    climb: 'His height is spent: climbing with him to get over him',
    'ninja-perch': 'Over him with the energy: turning toward him to dive',
    'ninja-dive': 'Down on him from above with the lead',
    'ninja-zoom': 'Off him: up on the dive\'s speed',
    'ninja-over': 'That pass landed: over the top and down again',
    'ninja-run': 'He met it, or no shot: away on the dive\'s speed, not round and round with him',
  },
  step(c) {
    const { me, him, g, mem } = c;
    const high = -g.above, look = Math.asin(clamp(-g.los[1])) / DEG;
    const toMerge = g.closure > 1 ? g.range / g.closure : Infinity;
    const gate = high >= 35 && look >= 15 && g.hisAta > 60 && g.range < 550 && g.ata < 75;
    const run = dir => { mem.runDir = dir; go(c, 'ninja-run'); };
    if (BZ_MEET.includes(mem.phase)) {
      if (mem.phase === 'climb' && gate) { mem.bzAim = undefined; mem.passShot = 0; go(c, 'ninja-dive'); }
      else if (mem.phase === 'climb' && high >= 35 && -g.energy >= 30) go(c, 'ninja-perch');
      else if (mem.phase === 'climb' && mem.t > 25) run(heading(sub(me.position, him.position)));
      else return PLANS.meetTheDive.step(c);
    }
    if (mem.phase === 'ninja-perch') {
      if (gate) { mem.bzAim = undefined; mem.passShot = 0; go(c, 'ninja-dive'); }
      else if (high < 20 || mem.t > 25) run(heading(sub(me.position, him.position)));
      else return { ...turnToward(c, climbing(heading(sub(him.position, me.position)), 3), { maxUp: 5, maxDown: 0 }), throttle: 1, aimed: false };
    }
    if (mem.phase === 'ninja-dive') {
      if (c.pilot.fire) mem.passShot += c.dt;
      const dive = Math.max(0, -pitchOf(me.orientation)) * DEG;
      const bottom = high - g.mySpeed * (1 - Math.cos(dive)) - 0.45 * Math.max(0, -me.velocity[1]) + 0.5 * Math.min(0, him.velocity[1]);
      mem.met = g.hisAta < 25 && g.range < 400;
      const off = toMerge < 1 || g.range < 35 || bottom < -20 || mem.met || (mem.passShot === 0 && mem.since > 5) || mem.since > 9;
      if (!off) return { ...bzAim(c), throttle: 1, aimed: g.range < 262 };
      mem.zoomDir = heading(me.velocity);
      mem.overSide = undefined;
      go(c, 'ninja-zoom');
    }
    if (mem.phase === 'ninja-zoom') {
      // The first half second the pass is still on: a shot that bears is taken.
      if (g.mySpeed > 62 && mem.since < 7) return { ...pointNose(me, climbing(mem.zoomDir, 70), { fine: 6, pull: 0.7 }), throttle: 1, aimed: mem.since < 0.5 };
      if (mem.passShot >= 0.3 && !mem.met && -g.energy >= 0) go(c, 'ninja-over');
      else run(mem.zoomDir);
    }
    if (mem.phase === 'ninja-over') {
      if (gate && pitchOf(me.orientation) < 30) {
        mem.bzAim = undefined; mem.passShot = 0; go(c, 'ninja-dive');
        return { ...bzAim(c), throttle: 1, aimed: g.range < 262 };
      }
      if (mem.since > 6) run(heading(sub(me.position, him.position)));
      else if (pitchOf(me.orientation) > 15) {
        const h = heading(me.velocity), right = [-h[2], 0, h[0]];
        if (mem.overSide === undefined) mem.overSide = Math.sign(dot(right, heading(sub(him.position, me.position)))) || 1;
        return { ...pullLift(me, add(scale(right, mem.overSide), [0, -0.35, 0]), 1), throttle: 1, aimed: false };
      } else return { ...pointNose(me, sub(him.position, me.position), { fine: 10, push: 0.8 }), throttle: 1, aimed: false };
    }
    // The run: flat out on the dive's speed, the nose a little down, him
    // kept behind the wing.
    go(c, 'ninja-run');
    mem.runDir ??= heading(sub(me.position, him.position));
    if (g.ata < 80 && g.range > 300) mem.runDir = heading(sub(me.position, him.position));
    return { ...turnToward(c, climbing(mem.runDir, -3), { maxUp: 3, maxDown: 20 }), throttle: 1, aimed: false };
  },
};

/**
 * BOOM AND ZOOM, the school's ace rule: `boomAndZoom` that gives up a chase
 * he cannot win. Diving, perched or reversing toward you, once you have been
 * beyond his guns' reach + 30 m and he has not been closing for 6 s in a
 * row, he lets you go and climbs away on the far heading back to his perch
 * height; from there he comes again as `boomAndZoom` does. Turning back at
 * him, or getting on his tail, ends the let-go at once.
 */
PLANS.bzAce = {
  ...PLANS.boomAndZoom,
  says: {
    ...PLANS.boomAndZoom.says,
    'let-go': 'He is out of my reach and I am not closing: letting him go, back up to my perch',
  },
  step(c) {
    const { me, him, g, mem } = c;
    const high = -g.above;
    if (['dive', 'perch', 'reverse'].includes(mem.phase)) {
      // His closure, smoothed over about three seconds.
      mem.closing = (mem.closing ?? g.closure) + (g.closure - (mem.closing ?? g.closure)) * Math.min(1, c.dt / 3);
      const losing = g.range > c.gun.range + 30 && mem.closing < 0.5;
      mem.losing = losing ? (mem.losing ?? 0) + c.dt : 0;
      if (mem.losing >= 6) {
        mem.losing = 0; mem.closing = undefined; mem.offT = 0; mem.shotT = 0;
        mem.overSide = undefined; mem.climbDeg = undefined; mem.climbDir = undefined;
        mem.home = heading(sub(me.position, him.position));
        go(c, 'let-go');
      }
    } else {
      mem.losing = 0;
      mem.closing = undefined;
    }
    if (mem.phase === 'let-go') {
      const back = g.hisAta < 40 && g.range < 800 && g.closure > 5;
      if (back || (high > 150 && g.range > 450)) go(c, high > 150 && !back ? 'perch' : 'climb');
      else {
        const angle = clamp((g.mySpeed - 36) * 1.6, -5, 26);
        return { ...turnToward(c, climbing(mem.home, angle), { maxUp: 26, maxDown: 5 }), throttle: 1, aimed: false };
      }
    }
    return PLANS.boomAndZoom.step(c);
  },
};

/**
 * BOOM AND ZOOM, the ace once his height is gone: `bzAce` with the answer
 * any pilot under a diving enemy has, the lesson's own counter. A target
 * above him that he can see diving on him, he turns to face, the nose no
 * more than 15 degrees up, until the dive is over (as `uhAce` does). Flown
 * by the boom-and-zoom lesson's Dip, Flip and Ninja: without it the Ninja's
 * dives land on a man who climbs straight on and never looks up from his
 * own plan (reviews/dfn-bz.md, "Ascendancy (2026-11-07)").
 */
PLANS.bzAceMeet = {
  ...PLANS.bzAce,
  says: {
    ...PLANS.bzAce.says,
    // The duel shows a phase's words from when it starts: a climb that
    // starts over him and ends under him must read true at both ends.
    climb: 'Climbing to get my height back',
    meet: 'He is coming at me: turning to face him',
  },
  step(c) {
    const { me, him, g, mem } = c;
    // Diving on him from above, or closing on him from the side at about his
    // height with his nose on me: either way, turn and face him.
    const bounced = g.sees && him.velocity[1] < -10 && g.hisAta < 40 && g.above > 60 && g.range < 900 && g.closure > 10;
    const closing = g.sees && g.hisAta < 60 && g.ata > 40 && Math.abs(g.above) < 60 && g.range < 700 && g.closure > 5;
    if ((bounced || closing) && ['climb', 'perch', 'let-go'].includes(mem.phase)) go(c, 'meet');
    if (mem.phase === 'meet') {
      if (g.closure >= 0 && g.hisAta < 60 && !(him.velocity[1] > 0 && g.above > 60)) {
        return { ...turnToward(c, sub(leadPoint(me, him, c.gun), me.position), { maxUp: 15 }), throttle: 1 };
      }
      go(c, 'climb');
    }
    return PLANS.bzAce.step(c);
  },
};

/** The answer to up and over: compare speeds before following. Slower, let
 *  him go up alone, keep your speed in a shallow climbing turn, and turn to
 *  face him when he comes down. */
PLANS.dontFollow = {
  title: 'Not following them up', first: 'chase',
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

/** Keep his path over the last three seconds (the circle a breaking
 *  pilot flies) in memory; returns how far his wings are over, degrees. */
function trackHisPath(c) {
  const trail = (c.mem.trail ??= []);
  trail.push(c.him.position.slice());
  if (trail.length > Math.round(3 / c.dt)) trail.shift();
  return Math.abs(bankOf(c.him.orientation).bank);
}

/** Up out of his turn and over it: the nose on the point 70 m above where
 *  he was a moment ago, at his speed (a little more when he draws away). A
 *  Spitfire's hard turn is a circle 120 m across, so this flies round above
 *  his circle instead of into it. */
function overHisTurn(c, { maxUp = null } = {}) {
  const trail = c.mem.trail;
  const was = trail[Math.max(0, trail.length - 1 - Math.round(0.6 / c.dt))];
  const to = sub([was[0], was[1] + 70, was[2]], c.me.position);
  // Arriving slow, no steeper than `maxUp` degrees: a slow Spitfire
  // hanging on its nose stalls.
  const k = maxUp === null ? pointNose(c.me, to, { fine: 6, push: 0.6 }) : turnToward(c, to, { maxUp, maxDown: 40 });
  const want = Math.max(40, c.g.hisSpeed + clamp((c.g.range - 80) * 0.05, -5, 8));
  return { ...k, throttle: holdSpeed(c, want) };
}

/** The answer to the break turn, flown by the attacker: the moment he
 *  breaks (his wings go over), don't pull after him into his circle and
 *  overshoot. Ease the closure and lift the nose up out of his turn (a high
 *  yo-yo): follow his own path round, 70 m above it, so you never come past
 *  his tail and he never gets his nose on you. When he stops turning, dive
 *  on him from up there. */
PLANS.patientAttacker = {
  title: 'The patient attacker', first: 'close',
  says: {
    close: 'Closing on his tail',
    yoyo: 'He broke: not following him in. Nose up out of his turn, staying above it',
    back: 'He stopped turning: diving on him from above',
  },
  step(c) {
    const { g, mem } = c;
    const hisBank = trackHisPath(c);
    if (mem.phase === 'close') {
      // He breaks (or I am about to run into him): up, now, not after him.
      if (!((hisBank > 45 && g.range < 450) || (g.range < 80 && g.closure > 5))) return { ...leadPursuit(c), throttle: 1 };
      go(c, 'yoyo');
    }
    if (mem.phase === 'back') {
      if (hisBank > 45 || g.range < 90) go(c, 'yoyo');
      else return { ...leadPursuit(c, { push: 0.8 }), throttle: closureThrottle(c, 150) };
    }
    if (hisBank < 25 && g.above < -30 && g.ata < 40 && g.range < 400) go(c, 'back');
    return overHisTurn(c);
  },
};

/** Where the hunter opens fire: inside 150 m, where the two wing guns'
 *  streams are still close together and a burst counts. Out to the 270 m
 *  the rounds reach, he has the shot and holds it while he closes. */
export const HUNTER_FIRE = 150;

/** How hard he is turning, degrees a second, smoothed over a third of a
 *  second: what tells a pursuer his target has broken. */
function turnRateOf(c) {
  const h = heading(c.him.velocity);
  const mem = c.mem;
  if (mem.hisH && c.dt > 0) mem.hisRate = 0.9 * (mem.hisRate ?? 0) + 0.1 * angleBetween(h, mem.hisH) / c.dt;
  mem.hisH = h;
  return mem.hisRate ?? 0;
}

/** The hardest turn toward `side` that holds the height `y`: the bank
 *  eased to 65 degrees, the climb asked of it by how far off `y` he is. */
function levelHardTurn(c, side, y, maxBank = 65) {
  return hardTurn(c.me, side, { climb: clamp((y - c.me.position[1]) * 0.15, -3, 4), maxBank });
}

/**
 * THE HUNTER: onto your tail and staying there, the lock the real game's
 * best pilots hold. Full throttle in from far out, the closure eased to
 * sit 100 m behind, the guns held until 150 m. When the target breaks he
 * does not cut across the circle after him (a Spitfire's hard turn is
 * 120 m across, and pulling lead across it flies him through it): he turns
 * the same hard turn, the same way, and follows him round, his nose behind
 * him. A shallow follow when the target climbs away. On his own tail, he breaks
 * (the `reflex`). Flown past a man who chopped in front of him, he runs:
 * he is the faster one now, so full throttle straight ahead out of the
 * slow man's guns is his way out, and turning back into him is not.
 */
PLANS.hunter = {
  title: 'The hunter', first: 'hunt', reflex: true, committed: ['extend'],
  says: {
    hunt: 'Closing on his tail',
    track: 'On his tail, closing: guns from 150 m in',
    lag: 'He is turning hard: turning the same way after him',
    follow: 'He is climbing away: following shallow',
    extend: 'I flew past him and he is behind me: running for it, full throttle',
    headon: 'He turned into me: we meet head-on, nobody on anybody\'s tail',
    evade: 'He is on my tail: breaking into him',
  },
  step(c) {
    const { me, him, g, mem } = c;
    const rate = turnRateOf(c);
    const aimed = g.range < HUNTER_FIRE;
    // Flown past him from behind: he is behind me now, close, and on my
    // heading (a head-on pass, headings opposed, is not this).
    const sameWay = angleBetween(heading(me.velocity), heading(him.velocity)) < 60;
    if (mem.phase === 'lag' && g.ata > 110 && g.range < 90 && sameWay) { mem.runDir = heading(me.velocity); go(c, 'extend'); }
    if (mem.phase === 'extend') {
      if (mem.since < 6 && g.range < 450) {
        return { ...pointNose(me, climbing(mem.runDir, -5), { fine: 6 }), throttle: 1, aimed: false };
      }
      go(c, 'hunt');
    }
    // The closure: fast from far out, easing as he gets in close. The throttle is
    // a rate and the brake bites late, so he leans on it lightly: a hard
    // brake now is a slow aeroplane in four seconds.
    const want = clamp((g.range - 30) * 0.12, -8, 30);
    const throttle = g.mySpeed < 38 ? 1 : clamp(0.5 + (want - g.closure) * 0.09, -1, 1);
    if (him.velocity[1] > 10 && pitchOf(him.orientation) > 35 && g.range > 120) {
      go(c, 'follow');
      return { ...turnToward(c, sub(leadPoint(me, him, c.gun), me.position), { maxUp: 25 }), throttle: 1, aimed };
    }
    if (rate > 15 && g.range < 450) {
      go(c, 'lag');
      // His height, followed slowly: he does not climb out of the circle
      // after every pull the other pilot makes.
      mem.yT = mem.yT === undefined ? him.position[1] : mem.yT + (him.position[1] - mem.yT) * Math.min(1, c.dt / 3);
      // Slow, he does not climb after him: a Spitfire under 36 m/s that
      // keeps climbing stalls.
      if (g.mySpeed < 36) mem.yT = Math.min(mem.yT, me.position[1] - 10);
      const d = sub(him.position, me.position);
      const elev = clamp(Math.atan2(mem.yT - me.position[1], Math.hypot(d[0], d[2])) / DEG, -15, 10);
      const k = g.ata > 20 ? levelHardTurn(c, g.side, mem.yT) : pointNose(me, climbing(heading(d), elev), { fine: 8, ...aim(c) });
      // He turned all the way round into me: not a chase any more, the
      // same turn flown, named for what it is.
      if (g.ata < 60 && g.hisAta < 60) go(c, 'headon');
      return { ...k, throttle: g.range < 30 && g.closure > 2 ? 0 : 1, aimed };
    }
    if (g.ata < 30 && g.range < 450) { go(c, 'track'); return { ...leadPursuit(c), throttle, aimed }; }
    go(c, 'hunt');
    return { ...(g.range > 450 ? leadPursuit(c) : purePursuit(c)), throttle: 1, aimed };
  },
};

/**
 * THE HUNTER WHO GIVES UP A CHASE HE CANNOT WIN (the break-turn lesson's
 * ace, the school's rule for every ace): `hunter` as it is, but once he has
 * been past his guns' reach + 30 m and not closing for 6 s in a row he lets
 * you go: climbs away on the way he came and stays out. If you turn back at
 * him he faces you, and the hunt is on again once you are past; get on his
 * tail and he breaks (the hunter's own reflex).
 */
PLANS.btHunter = {
  title: 'The hunter', first: 'hunt', reflex: true, committed: ['extend'],
  says: {
    ...PLANS.hunter.says,
    'let-go': 'He is out of my reach and I am not closing: letting him go',
    meet: 'He is coming back at me: turning to face him',
  },
  step(c) {
    const { me, him, g, mem } = c;
    if (mem.phase !== 'let-go' && mem.phase !== 'meet') {
      // His closure, smoothed over about three seconds, and how long he has
      // been out of reach and not closing.
      mem.closing = (mem.closing ?? g.closure) + (g.closure - (mem.closing ?? g.closure)) * Math.min(1, c.dt / 3);
      mem.outFor = g.range > c.gun.range + 30 && mem.closing < 0.5 ? (mem.outFor ?? 0) + c.dt : 0;
      if (mem.outFor >= 6) { go(c, 'let-go'); mem.home = scale(heading(me.velocity), -1); }
    }
    if (mem.phase === 'let-go' && g.hisAta < 40 && g.range < 800 && g.closure > 5) go(c, 'meet');
    if (mem.phase === 'meet') {
      if (!(g.ata > 150 && g.range > 150)) {
        return { ...turnToward(c, sub(leadPoint(me, him, c.gun), me.position), { maxUp: 15, maxDown: 30 }), throttle: 1 };
      }
      mem.outFor = 0; mem.closing = g.closure;
      go(c, 'hunt');
    }
    if (mem.phase === 'let-go') {
      return { ...turnToward(c, climbing(mem.home, 15), { maxUp: 15, maxDown: 5 }), throttle: 1, aimed: false };
    }
    return PLANS.hunter.step(c);
  },
};

/** The hard turn, held: the pilot who knows not to fly straight, and no
 *  more. With a hunter on him he is hard to hit, and he never gets out.
 *  Flat: three quarters of the stick at about 75 degrees of bank, the bank
 *  eased by the sink and by the height he has lost since the start, holds
 *  the height at about 40 degrees a second (full stick would turn faster
 *  and spiral down at 4 m/s). */
PLANS.flatTurn = {
  title: 'Turning hard', first: 'turn',
  says: { turn: 'Turning as hard as it goes, round and round' },
  step(c) {
    const { me, mem } = c;
    if (mem.side === undefined) mem.side = c.g.side;
    if (mem.y0 === undefined) mem.y0 = me.position[1];
    const climb = clamp((mem.y0 - me.position[1]) * 0.15, -3, 3);
    return { ...hardTurn(me, mem.side, { climb, pull: 0.75, maxBank: 75 }), throttle: 1 };
  },
};

/** Whether he is committed behind me: behind my wings, his nose on me,
 *  inside 180 m and closing. What a defender waits for before he turns. */
const committedBehind = g => g.ata > 130 && g.hisAta < 30 && g.range < 180 && g.closure > 0;

/** The chop's floor: below it the throttle opens again and the pull up
 *  stops. The brake bites on a moment after it is let go. */
const CHOP_FLOOR = 32;

/**
 * TURN AND CHOP. Fly on until he is committed behind you, then turn as
 * hard as it turns, holding the height: he follows you round, close, but
 * cannot pull the sight onto you. Once he has sat behind you in the circle
 * a few seconds (inside 90 m, closing), chop the throttle and pull up
 * through the turn: you go up and slow down, he cannot slow as fast (his
 * brake takes seconds to bite) and flies through underneath you and out in
 * front. Then turn onto him, full throttle, and shoot.
 */
PLANS.chopper = {
  title: 'Turn and chop', first: 'watch',
  says: {
    watch: 'Flying on, watching him come in behind me',
    turn: 'Turning hard: he cannot pull the sight round onto me',
    chop: 'He is close behind: throttle back and pull up, make him fly past',
    reverse: 'He flew past underneath: turning onto him',
    shoot: 'He is out in front of me: guns',
  },
  step(c) {
    const { me, g, mem } = c;
    if (!mem.dir) { mem.dir = heading(me.velocity); mem.cruise = g.mySpeed; }
    if (mem.phase === 'watch') {
      // `breakAt` (memory) breaks earlier, the first time, at that range.
      const first = !mem.rolled && mem.breakAt && g.ata > 130 && g.hisAta < 30 && g.range < mem.breakAt;
      if (first || committedBehind(g)) { mem.side = g.side; mem.y0 = me.position[1]; go(c, 'turn'); }
      else return { ...pointNose(me, climbing(mem.dir, 0), { fine: 6 }), throttle: holdSpeed(c, mem.cruise),
                    say: mem.rolled ? 'He did not follow me in: rolled out, flying on' : undefined };
    }
    // `rollOut` (memory): a full circle and more with him never inside
    // 150 m, and he stops turning, thinking he has shaken him off.
    if (g.range < 150) mem.nearT = mem.t;
    if (mem.rollOut && mem.phase === 'turn' && mem.since > 10 && mem.t - (mem.nearT ?? -99) > 10 && g.ata > 100) {
      mem.rolled = true; mem.dir = heading(me.velocity); mem.cruise = Math.max(45, g.mySpeed); go(c, 'watch');
      return { ...pointNose(me, climbing(mem.dir, 0), { fine: 6 }), throttle: 1, say: 'He did not follow me in: rolled out, flying on' };
    }
    // He has come past my wings and is out in front.
    if (mem.phase === 'chop' && g.ata < 90 && g.hisAta > 90) go(c, 'reverse');
    if (mem.phase === 'reverse' || mem.phase === 'shoot') {
      if (g.ata < 12 && g.range < c.gun.range) go(c, 'shoot');
      else if (mem.phase === 'shoot' && g.ata > 25) go(c, 'reverse');
      if (g.ata > 120 || mem.since > 8) { mem.y0 = me.position[1]; mem.side = g.side; go(c, 'turn'); }
      else return { ...(g.ata > 35 ? levelHardTurn(c, g.side, me.position[1]) : leadPursuit(c, { push: 0.8 })), throttle: 1 };
    }
    // The chop: only once he has followed me round a few seconds, and only
    // while he sits close behind me and is still closing.
    if (mem.phase === 'turn' && mem.since > 4 && g.ata > 130 && g.range < 90 && g.closure > 0 && g.mySpeed > 38) go(c, 'chop');
    if (mem.phase === 'chop') {
      if (mem.since > 6) { mem.y0 = me.position[1]; go(c, 'turn'); }
      else {
        // Down to 32 m/s: the brake bites on a moment after it is let go,
        // and he bottoms out near 26, as slow as a Spitfire dares to be.
        const v = g.mySpeed;
        const slow = v < CHOP_FLOOR;
        return { ...hardTurn(me, mem.side, { climb: slow ? 0 : 16, maxBank: 55 }), throttle: slow ? 1 : -1 };
      }
    }
    return { ...levelHardTurn(c, mem.side, mem.y0 ?? me.position[1]), throttle: 1 };
  },
};

/** The hard turn alone, flown as the chop's pilot flies it until the chop:
 *  on until he is committed behind, then as hard as it turns, holding the
 *  height, and nothing more. */
PLANS.lockHardTurn = {
  title: 'Turning hard', first: 'watch',
  says: {
    watch: 'Flying on, watching him come in behind me',
    turn: 'Turning as hard as it goes, holding my height',
  },
  step(c) {
    const { me, g, mem } = c;
    if (!mem.dir) { mem.dir = heading(me.velocity); mem.cruise = g.mySpeed; }
    if (mem.phase === 'watch') {
      if (committedBehind(g)) { mem.side = g.side; mem.y0 = me.position[1]; go(c, 'turn'); }
      else return { ...pointNose(me, climbing(mem.dir, 0), { fine: 6 }), throttle: holdSpeed(c, mem.cruise) };
    }
    return { ...levelHardTurn(c, mem.side, mem.y0), throttle: 1 };
  },
};

/**
 * TURN, THEN CHOP: "Out of his lock"'s counter. As `chopper` until he has
 * flown past: on until he is committed behind, the hard turn, and the chop
 * and pull up once he sits close behind in the circle, still closing. Then
 * the roles have changed and he keeps them changed: after him, nose on, full
 * throttle, as long as he is anywhere but on my tail again. He runs (the
 * hunter's `extend`); the burst is the first seconds of it.
 */
PLANS.lockChop = {
  title: 'Turn, then chop', first: 'watch',
  says: {
    watch: 'Flying on, watching him come in behind me',
    turn: 'Turning hard: he cannot pull the sight round onto me',
    chop: 'He is close behind and closing: throttle back and pull up, make him fly past',
    chase: 'He flew past and is running: after him, full throttle',
    shoot: 'He is in front of me: guns',
  },
  step(c) {
    const { me, g, mem } = c;
    if (!mem.dir) { mem.dir = heading(me.velocity); mem.cruise = g.mySpeed; }
    if (mem.phase === 'watch') {
      if (committedBehind(g)) { mem.side = g.side; mem.y0 = me.position[1]; go(c, 'turn'); }
      else return { ...pointNose(me, climbing(mem.dir, 0), { fine: 6 }), throttle: holdSpeed(c, mem.cruise) };
    }
    if (mem.phase === 'chop' && g.ata < 90 && g.hisAta > 90) go(c, 'chase');
    if (mem.phase === 'chase' || mem.phase === 'shoot') {
      if (g.ata < 12 && g.range < c.gun.range) go(c, 'shoot');
      else if (mem.phase === 'shoot' && g.ata > 25) go(c, 'chase');
      // Only his nose back on my tail, close, starts the defence again.
      if (g.ata > 130 && g.hisAta < 40 && g.range < 200) { mem.y0 = me.position[1]; mem.side = g.side; go(c, 'turn'); }
      // He runs downhill: the turn after him goes to his height, not mine.
      else return { ...(g.ata > 60 ? levelHardTurn(c, g.side, c.him.position[1]) : leadPursuit(c, { push: 0.8 })), throttle: 1 };
    }
    if (mem.phase === 'turn' && mem.since > 4 && g.ata > 130 && g.range < 90 && g.closure > 0 && g.mySpeed > 38) go(c, 'chop');
    if (mem.phase === 'chop') {
      if (mem.since > 6) { mem.y0 = me.position[1]; go(c, 'turn'); }
      else {
        const slow = g.mySpeed < CHOP_FLOOR;
        return { ...hardTurn(me, mem.side, { climb: slow ? 0 : 16, maxBank: 55 }), throttle: slow ? 1 : -1 };
      }
    }
    return { ...levelHardTurn(c, mem.side, mem.y0 ?? me.position[1]), throttle: 1 };
  },
};

/**
 * TURN INTO HIM EARLY. Seen while he is still far back (400 m), on your
 * tail and closing: turn as hard as it turns, into him, and keep turning
 * until your nose is on him. From that far he cannot follow you round inside
 * a 120 m circle, so the chase becomes a head-on pass: the tail is gone and
 * you are even. Pass over him, not through him, and turn into him again.
 */
PLANS.meetHim = {
  title: 'Turning into them', first: 'watch',
  says: {
    watch: 'Flying on, watching him come in behind me',
    turn: 'Turning hard into him: my nose to him, not my tail',
    meet: 'Nose on him: he is coming at me head-on, not from behind',
    pass: 'Passing over him, not through him',
  },
  step(c) {
    const { me, g, mem } = c;
    if (!mem.dir) { mem.dir = heading(me.velocity); mem.cruise = g.mySpeed; }
    if (mem.phase === 'watch') {
      if (g.ata > 120 && g.hisAta < 30 && g.range < (mem.breakAt ?? 400)) { mem.side = g.side; mem.y0 = me.position[1]; go(c, 'turn'); }
      else return { ...pointNose(me, climbing(mem.dir, 0), { fine: 6 }), throttle: holdSpeed(c, mem.cruise) };
    }
    if (mem.phase === 'turn' && g.ata < 40) go(c, 'meet');
    if (mem.phase === 'meet') {
      if (g.range < 130 && g.hisAta < 70) { mem.passH = heading(me.velocity); go(c, 'pass'); }
      else if (g.ata > 100) { mem.side = g.side; go(c, 'turn'); }
      else return { ...leadPursuit(c), throttle: 1 };
    }
    if (mem.phase === 'pass') {
      if (g.ata > 100 || mem.since > 3) { mem.side = g.side; mem.y0 = me.position[1]; go(c, 'turn'); }
      else return { ...pointNose(me, climbing(mem.passH, 18), { fine: 6 }), throttle: 1 };
    }
    return { ...levelHardTurn(c, mem.side, mem.y0 ?? me.position[1]), throttle: 1 };
  },
};

/**
 * OUT OF HIS LOCK's honest hunter (the Dip, the Flip and the Ninja demos):
 * `hunter`, with the run after a fly-past made what a sensible ace flies.
 * He runs once per fly-past, only while the slow man's nose is on him, and
 * breaks into him (the reflex) if he gets the sight on inside gun range;
 * once the nose is off him he turns back to hunt, because he is the faster
 * one. The plain hunter runs on for 6 s whatever the other does, and can
 * start the run again from his turn: 12 s straight in front of your guns.
 */
PLANS.olHunter = {
  title: 'The hunter', first: 'hunt', reflex: true, committed: [],
  says: { ...PLANS.hunter.says,
    extend: 'I flew past him and his nose is on me: running for it, full throttle',
    'let-go': 'He is out of my reach and I am not closing: letting him go',
    meet: 'He is coming back at me: turning to face him' },
  step(c) {
    const { me, him, g, mem } = c;
    // The school's rule for every ace: a chase he cannot win is given up.
    // Past his guns' reach + 30 m and not closing for 6 s in a row, he
    // climbs away home, and stays out unless you come back at him (he
    // faces you) or get on his tail (the reflex breaks him).
    const outOfReach = g.range > c.gun.range + 30;
    mem.notClosing = outOfReach && g.closure <= 0 ? (mem.notClosing ?? 0) + c.dt : 0;
    if (mem.phase !== 'let-go' && mem.phase !== 'meet' && mem.notClosing >= 6) {
      go(c, 'let-go');
      mem.home = scale(heading(me.velocity), -1);
    }
    if (mem.phase === 'let-go' && g.hisAta < 40 && g.range < 800 && g.closure > 5) go(c, 'meet');
    if (mem.phase === 'meet') {
      if (g.ata > 150 && g.range > 150) go(c, 'let-go');
      else return { ...turnToward(c, sub(leadPoint(me, him, c.gun), me.position), { maxUp: 15, maxDown: 30 }), throttle: 1 };
    }
    if (mem.phase === 'let-go') {
      return { ...turnToward(c, climbing(mem.home, 15), { maxUp: 15, maxDown: 5 }), throttle: 1, aimed: false };
    }
    const rate = turnRateOf(c);
    const aimed = g.range < HUNTER_FIRE;
    const sameWay = angleBetween(heading(me.velocity), heading(him.velocity)) < 60;
    if (mem.phase === 'lag' && g.ata > 110 && g.range < 90 && sameWay && !mem.ran) { mem.runDir = heading(me.velocity); mem.ran = true; go(c, 'extend'); }
    if (mem.phase === 'extend') {
      if (mem.since < 6 && g.range < 450 && (g.hisAta < 45 || mem.since < 0.5)) {
        return { ...pointNose(me, climbing(mem.runDir, -5), { fine: 6 }), throttle: 1, aimed: false };
      }
      go(c, 'hunt');
    }
    if (g.range > 200) mem.ran = false;
    const want = clamp((g.range - 30) * 0.12, -8, 30);
    const throttle = g.mySpeed < 38 ? 1 : clamp(0.5 + (want - g.closure) * 0.09, -1, 1);
    if (him.velocity[1] > 10 && pitchOf(him.orientation) > 35 && g.range > 120) {
      go(c, 'follow');
      return { ...turnToward(c, sub(leadPoint(me, him, c.gun), me.position), { maxUp: 25 }), throttle: 1, aimed };
    }
    if (rate > 15 && g.range < 450) {
      go(c, 'lag');
      mem.yT = mem.yT === undefined ? him.position[1] : mem.yT + (him.position[1] - mem.yT) * Math.min(1, c.dt / 3);
      if (g.mySpeed < 36) mem.yT = Math.min(mem.yT, me.position[1] - 10);
      const d = sub(him.position, me.position);
      const elev = clamp(Math.atan2(mem.yT - me.position[1], Math.hypot(d[0], d[2])) / DEG, -15, 10);
      const k = g.ata > 20 ? levelHardTurn(c, g.side, mem.yT) : pointNose(me, climbing(heading(d), elev), { fine: 8, ...aim(c) });
      if (g.ata < 60 && g.hisAta < 60) go(c, 'headon');
      return { ...k, throttle: g.range < 30 && g.closure > 2 ? 0 : 1, aimed };
    }
    if (g.ata < 30 && g.range < 450) { go(c, 'track'); return { ...leadPursuit(c), throttle, aimed }; }
    go(c, 'hunt');
    return { ...(g.range > 450 ? leadPursuit(c) : purePursuit(c)), throttle: 1, aimed };
  },
};

/**
 * OUT OF HIS LOCK's ace for the Dip, the Flip and the Ninja: `olHunter`
 * who does not chase a man up into a hang. Below 48 m/s, with the other
 * plane more than 15 degrees above his horizon, he keeps his nose within 5
 * degrees of level and turns to face him instead of pulling up after him
 * (the independent review, reviews/dfn-ol.md: without it every burst of the
 * Flip and the Ninja landed on him at 16-17 m/s, his nose 50-76 degrees up).
 */
PLANS.olAce = {
  ...PLANS.olHunter,
  step(c) {
    const out = PLANS.olHunter.step(c);
    const { me, him, g, mem } = c;
    const d = sub(him.position, me.position);
    const up = Math.atan2(d[1], Math.hypot(d[0], d[2])) / DEG;
    if (!['let-go', 'meet', 'extend'].includes(mem.phase) && g.mySpeed < 48 && up > 15) {
      return { ...turnToward(c, d, { maxUp: 5, maxDown: 30 }), throttle: 1, aimed: g.range < HUNTER_FIRE,
               say: 'Too slow to pull up at him: nose level, turning to face him' };
    }
    return out;
  },
};

/**
 * Out of his lock, seen 900 m back: turn into him at once and fly at a
 * point `below` metres under him and `across` to the side he is on, held
 * once he is inside `hold` (0: never held). Returns the controls, or null
 * once he is past (the range opening) or inside `pass`, with the phase still
 * `meet`. Going under him, his nose has to come down after you, and a
 * Spitfire pushes its nose down slowly: he gets less of a head-on shot.
 */
function olUnder(c, { below, across = 0, hold = 0, pass = 0 }) {
  const { me, him, g, mem } = c;
  if (mem.phase === 'watch') { mem.side = g.side; go(c, 'turn'); }
  if (mem.phase === 'turn' && g.ata < 40) go(c, 'meet');
  if (mem.phase === 'turn') return { ...hardTurn(me, mem.side, { climb: 0, maxBank: 75 }), throttle: 1 };
  const h = heading(sub(him.position, me.position)), right = [-h[2], 0, h[0]];
  const point = add(add(him.position, scale(right, mem.side * across)), [0, -below, 0]);
  if (hold && g.range < hold && !mem.underDir) mem.underDir = sub(point, me.position);
  if ((pass && g.range < pass) || (mem.underDir && g.closure < 0)) return null;
  return { ...pointNose(me, mem.underDir ?? sub(point, me.position), { fine: 6 }), throttle: 1, aimed: false };
}

/**
 * THE DIP, out of his lock: seen 900 m back, turn into him at once, pass
 * 50 m under him and 60 m to his side, and run on the heading the pass left
 * you on, full throttle, nose 2 degrees down. He turns round after you, but
 * the pass leaves you running at 74 m/s with him turning: he follows out of
 * his guns' reach, never closing, and gives the chase up (`olHunter`'s
 * let-go) about 30 s in.
 */
PLANS.olDip = {
  title: 'Under them, then away', first: 'watch',
  says: {
    watch: 'He is far back and closing: I have seen him',
    turn: 'Turning hard into him while he is far out',
    meet: 'Head-on, aiming 50 m under him: past him under his wing',
    'dip-run': 'Under his tail and past him: running on, full throttle, nose a little down',
  },
  step(c) {
    const { me, mem } = c;
    if (mem.phase !== 'dip-run') {
      const k = olUnder(c, { below: 50, across: 60, pass: 150 });
      if (k) return k;
      mem.runH = heading(me.velocity);
      go(c, 'dip-run');
    }
    return { ...pointNose(me, climbing(mem.runH, c.agl < 150 ? 0 : -2), { fine: 6 }), throttle: 1, aimed: false };
  },
};

/**
 * Under him, then up behind him: the Flip's and the Ninja's way in. Head-on
 * at a point 80 m under him, the line held from 250 m; once he is past
 * overhead, pull up toward him (half a loop, up behind him while he turns
 * back after you), and once above him with his nose away and he 13 degrees
 * under your horizon, `PLANS.ascend` flies the rest: down on him with the
 * lead, off before the pass, up again, across his line when his nose comes
 * round. `pre` names the decisive phase (`flip-up`, `ninja-up`).
 */
function olUnderUp(c, pre) {
  const { me, him, g, mem } = c;
  if (mem.handed) {
    const out = PLANS.ascend.step(c);
    // Pulling off him, the guns stay on while the burst still lands.
    if (mem.phase === 'zoom' && mem.since < 0.5) out.aimed = true;
    // Whatever the phase, a pilot with him in the sight says so.
    if (g.sees && g.range < c.gun.range && gunSolution(me, him, c.gun).fire) out.say = 'Guns: he is in my sight';
    return out;
  }
  if (mem.phase !== `${pre}up`) {
    const k = olUnder(c, { below: 80, hold: 250 });
    if (k) return k;
    go(c, `${pre}up`);
  }
  const high = -g.above, lookDown = Math.asin(clamp(-g.los[1])) / DEG;
  // The top of this loop is slow: 28-30 m/s for 2.2-2.7 s, 190 m from him.
  // Tipping over earlier, at 50-60 m/s, keeps the speed and loses the pass
  // (reviews/dfn-ol.md, "The review").
  if ((high > 35 && g.ata < 60 && lookDown > 13) || mem.since > 8) {
    mem.handed = true;
    go(c, 'find');
    return PLANS.ascend.step(c);
  }
  return { ...pullLift(me, sub(him.position, me.position), 1), throttle: 1, aimed: false };
}
const OL_UNDER_SAYS = {
  watch: 'He is far back and closing: I have seen him',
  turn: 'Turning hard into him while he is far out',
  meet: 'Head-on, aiming 80 m under him: under his guns, not into them',
};

/**
 * THE FLIP, out of his lock: from under him to over his tail. Seen 900 m
 * back, turn into him, pass 80 m under him, pull up behind him, and come
 * down on him from above (`olUnderUp`). The
 * shared measure (`tests/dogfight_dfn_measure.mjs`) counts what that buys
 * against the hunter (reviews/dfn-ol.md, "Ascendancy").
 */
PLANS.olFlip = {
  title: 'Under them, then up behind them', first: 'watch',
  // `PLANS.ascend` is defined further down: its words are read when asked for.
  get says() { return { ...OL_UNDER_SAYS, 'flip-up': 'He is past overhead: pulling up behind him', ...PLANS.ascend.says }; },
  step: c => olUnderUp(c, 'flip-'),
};

/**
 * THE NINJA, out of his lock (the best try; the measure counts it): the
 * Flip's way in from the start of the fight, under him and up behind him,
 * one pass down on him from above (`olUnderUp`, `PLANS.ascend`), and then
 * away: once the burst is over, the range opening and his nose more than 90
 * degrees off you, straight out at full throttle, nose 2 degrees down, as
 * the Dip runs. Staying on to circle with him buys no second shot
 * (reviews/dfn-ol.md, "Ascendancy").
 */
const OL_PERCH = { range: 450, high: 120, climb: 30 };
PLANS.olNinja = {
  title: 'Under them, down on them once, then away', first: 'watch',
  get says() {
    return { ...OL_UNDER_SAYS, 'ninja-up': 'He is past overhead: pulling up behind him', ...PLANS.ascend.says,
             'ninja-perch': 'One pass: up and away from his nose, out of his reach. His nose follows me: no second pass without meeting it' };
  },
  step(c) {
    const { me, him, g, mem } = c;
    if (mem.phase !== 'ninja-perch' && mem.handed && mem.lastShot !== undefined && mem.t - mem.lastShot > 0.5
        && g.closure < 0 && g.hisAta > 90 && mem.phase !== 'dive') go(c, 'ninja-perch');
    if (mem.phase === 'ninja-perch') {
      // Up and away from his nose to a perch out of his reach, then held
      // there: across his line, level, watching him.
      const away = heading(sub(me.position, him.position));
      const high = -g.above;
      if (g.range < OL_PERCH.range || high < OL_PERCH.high) {
        return { ...pointNose(me, climbing(away, clamp((g.mySpeed - 40) * 1.5, 0, OL_PERCH.climb)), { fine: 6 }), throttle: 1, aimed: false };
      }
      const right = [-away[2], 0, away[0]];
      const side = Math.sign(dot(heading(me.velocity), right)) || 1;
      return { ...pointNose(me, climbing(scale(right, side), 0), { fine: 6 }), throttle: 1, aimed: false };
    }
    return olUnderUp(c, 'ninja-');
  },
};

/**
 * OUT OF HIS LOCK under the eyes (reviews/eyes.md): the cone behind the
 * headrest hides a man closing from dead astern, so the pilot who knows one
 * is coming in does not fly straight: he holds a gentle level turn toward
 * him, `OL_LOOK` degrees of bank, which keeps him over the shoulder and out
 * of the cone until he is committed. `olLooking` wraps a plan whose first
 * phase is `watch` with that turn; the rest of the plan is the plan's own.
 */
const OL_LOOK = 20;
function olLookTurn(c) {
  const { me, g, mem } = c;
  if (mem.lookSide === undefined) { mem.lookSide = g.side; mem.lookY = me.position[1]; mem.lookV = g.mySpeed; }
  const pull = clamp(0.15 + (mem.lookY - me.position[1]) * 0.02 - me.velocity[1] * 0.08, -0.4, 1);
  return { ...bankAndPull(me, mem.lookSide * OL_LOOK, pull), throttle: holdSpeed(c, mem.lookV) };
}
function olLooking(name, title) {
  const base = PLANS[name];
  return { ...base, title, says: { ...base.says, watch: 'A gentle turn toward him, keeping him in sight over my shoulder' },
    step(c) { const out = base.step(c); return c.mem.phase === 'watch' ? olLookTurn(c) : out; } };
}

/** Dive away from him: the natural escape. On until he is committed
 *  behind, then nose down away from him for speed, pull out above the
 *  ground, zoom on the speed, and turn back to find him. */
PLANS.diveOut = {
  title: 'Diving away', first: 'watch',
  says: {
    watch: 'Flying on, watching him come in behind me',
    dive: 'Diving away from him for speed',
    zoom: 'Pulling up on the dive\'s speed',
    back: 'Turning back to find him',
    turn: 'Turning hard, looking for a way out',
  },
  step(c) {
    const { me, g, mem } = c;
    const h = heading(me.velocity);
    if (!mem.dir) { mem.dir = heading(me.velocity); mem.cruise = g.mySpeed; }
    switch (mem.phase) {
      case 'watch':
        if (committedBehind(g)) go(c, 'dive');
        return { ...pointNose(me, climbing(mem.dir, 0), { fine: 6 }), throttle: holdSpeed(c, mem.cruise) };
      case 'dive':
        // Down and away, the pull out started with height to spare.
        if (g.mySpeed > 95 || c.agl < 140 + Math.max(0, -me.velocity[1]) * 2) go(c, 'zoom');
        return { ...pointNose(me, climbing(heading(sub(me.position, c.him.position)), -35), { fine: 8, push: 0.6 }), throttle: 1 };
      case 'zoom':
        if (g.mySpeed < 45) go(c, 'back');
        return { ...pointNose(me, climbing(h, 30), { fine: 8 }), throttle: 1 };
      case 'back':
        if (mem.since > 6) { mem.side = g.side; go(c, 'turn'); }
        return { ...turnToward(c, sub(c.him.position, me.position), { maxUp: 10, maxDown: 20 }), throttle: 1 };
      case 'turn':
        if (mem.side === undefined) mem.side = g.side;
        return { ...hardTurn(me, mem.side), throttle: 1 };
      default: go(c, 'watch');
    }
    return null;
  },
};

// Out of his lock's watchers, each keeping him in sight until he is in.
PLANS.olHardTurn = olLooking('lockHardTurn', 'Turning hard');
PLANS.olChop = olLooking('lockChop', 'Turn, then chop');
PLANS.olDiveOut = olLooking('diveOut', 'Diving away');
PLANS.olMeetHim = olLooking('meetHim', 'Turning into them');

/** Climbing straight to get the height back, nose 30 degrees up, not
 *  looking at him: slow (about 35 m/s) and on a straight line. */
PLANS.climbStraight = {
  title: 'Climbing straight', first: 'climb',
  says: { climb: 'Nose 30 degrees up, straight for the height' },
  step(c) {
    if (!c.mem.dir) c.mem.dir = heading(c.me.velocity);
    return { ...pointNose(c.me, climbing(c.mem.dir, 30), { fine: 6 }), throttle: 1 };
  },
};

/** Under a boom-and-zoomer: climb while he is away, break only when he is
 *  committed to a dive at you inside 380 m, and climb again the moment he
 *  has gone past. His height runs out before yours does. */
PLANS.climbBetween = {
  title: 'Climbing between their dives', first: 'climb',
  says: {
    climb: 'He is not coming at me: climbing at full throttle, keeping him in sight',
    break: 'He is diving at me: break, hard',
  },
  step(c) {
    const { g, mem, me, him } = c;
    const coming = him.velocity[1] < -8 && g.hisAta < 30 && g.range < 380;
    if (coming && mem.phase !== 'break') { mem.side = g.side; go(c, 'break'); }
    if (mem.phase === 'break' && mem.since > 3 && !coming) go(c, 'climb');
    if (mem.phase === 'break') return { ...hardTurn(me, mem.side), throttle: 1 };
    // Up to 20 degrees, less while the break's speed comes back, turning
    // gently (about 12 degrees a second) toward his side of the sky when he
    // is off the nose: never climbing away with him behind.
    const deg = clamp((g.mySpeed - 36) * 2, 0, 20);
    const off = angleBetween(heading(me.velocity), heading(sub(him.position, me.position)));
    return { ...climbingTurn(c, g.side, deg, clamp((off - 20) / 90, 0, 1) * 0.12), throttle: 1 };
  },
};

/**
 * WHEN HE HAS THE HEIGHT, the ace: the boom-and-zoomer (`boomAndZoom`, the
 * same dives, zooms and wingovers) who also never lets a target run. A
 * target flying away from him past 550 m is chased: pure pursuit at full
 * throttle, his height over the target spent on speed, and inside 450 m
 * the pass again (a dive with the height for it, else the guns' lead from
 * behind). Bounced from above he turns to face the dive, and climbing back
 * round to a target behind him he turns level first (`boomAndZoom`'s climb
 * points the nose there and loops itself up to 30 m/s). He gives a chase
 * up by the school's one rule (`scAce`): 6 s in a row past his guns' reach
 * plus 30 m and not closing. Let go, he climbs away to his perch and stays
 * out unless the target turns back at him (he faces it) or gets on his tail
 * (the reflex).
 */
PLANS.uhAce = {
  title: 'Boom and zoom', first: 'climb', reflex: true, committed: ['dive', 'zoom'],
  says: {
    climb: 'Climbing above him, out of his reach',
    perch: 'Sitting high: picking the moment',
    dive: 'Diving on him: all the speed of the fall',
    zoom: 'Zooming back up on the dive\'s speed',
    reverse: 'Turning over the top to come down again',
    chase: 'He is running: after him, the height spent on speed',
    'let-go': 'He is out of my reach and I am not closing: letting him go',
    meet: 'He is diving on me: turning to face him',
    evade: 'He is on my tail: breaking into him',
  },
  step(c) {
    const { me, him, g, mem, dt } = c;
    const h = heading(me.velocity);
    const toward = heading(sub(him.position, me.position));
    const high = -g.above;
    const facing = angleBetween(heading(him.velocity), heading(sub(me.position, him.position))) < 60;
    // A target flying away from him, out past the pass: he is running.
    const running = g.hisAta > 110 && g.range > 550 && !facing;
    // A target above him diving on him: turn and face it, as he would want
    // done to his own dive.
    const bounced = him.velocity[1] < -10 && g.hisAta < 40 && g.above > 60 && g.range < 900 && g.closure > 10;
    if (bounced && ['climb', 'perch', 'chase', 'let-go'].includes(mem.phase)) go(c, 'meet');
    // Let go, he stays out unless the target turns back at him.
    if (mem.phase === 'let-go' && g.hisAta < 40 && g.range < 800 && g.closure > 5) go(c, 'meet');
    if (running && ['climb', 'perch', 'reverse'].includes(mem.phase) && !(mem.phase === 'reverse' && pitchOf(me.orientation) > 10)) {
      mem.overSide = undefined; mem.climbDeg = undefined; mem.climbDir = undefined;
      mem.closing = 0; mem.outT = 0;
      go(c, 'chase');
    }
    switch (mem.phase) {
      case 'let-go': {
        // Away from him and up to his perch height again.
        const angle = clamp((g.mySpeed - 36) * 1.6, -5, 26);
        return { ...turnToward(c, climbing(mem.home ?? scale(toward, -1), angle), { maxUp: angle, maxDown: 5 }), throttle: 1, aimed: false };
      }
      case 'chase': {
        // The school's give-up rule: 6 s in a row past the guns' reach plus
        // 30 m with the closure (smoothed over about 3 s) under 0.5 m/s.
        mem.closing = (mem.closing ?? 0) + (g.closure - (mem.closing ?? 0)) * Math.min(1, dt / 3);
        mem.outT = g.range > c.gun.range + 30 && mem.closing < 0.5 ? (mem.outT ?? 0) + dt : 0;
        if (mem.outT >= 6) { mem.home = scale(toward, -1); go(c, 'let-go'); return null; }
        // Straight after him, a shallow dive buying the speed to close
        // while there is height over him to spend.
        if (facing && g.range < 700) { go(c, 'climb'); return null; }
        if (g.range < 450 && high > 80) { go(c, 'dive'); return null; }
        // Below him there is no height to spend: say so.
        const say = high > 20 ? undefined : 'He is running and he is higher: after him, climbing at full throttle';
        if (g.range < 450) return { ...leadPursuit(c), throttle: 1, aimed: g.range < (mem.open ?? 130), say };
        const to = unit(sub(him.position, me.position));
        const dive = high > 20 ? -Math.min(20, high / g.range * 57 + 6) : 0;
        return { ...pointNose(me, climbing(heading(to), Math.max(dive, Math.asin(clamp(to[1])) / DEG)), { fine: 6, push: 0.6 }), throttle: 1, aimed: false, say };
      }
      case 'meet': {
        if (g.closure < 0 || him.velocity[1] > 0) { go(c, 'climb'); return null; }
        const lp = sub(leadPoint(me, him, c.gun), me.position);
        return { ...turnToward(c, lp, { maxUp: 15 }), throttle: 1 };
      }
      case 'climb': {
        if (!mem.climbDir) mem.climbDir = h;
        const angle = clamp((g.mySpeed - 36) * 1.6, -5, 26);
        const flat = g.range > 700 ? toward : mem.climbDir;
        if (high > 150 && g.range > 450) { mem.climbDir = undefined; go(c, 'perch'); }
        const say = high < 30 ? LOST_HEIGHT : undefined;
        // Far round to him, a level hard turn first: pointing the nose at a
        // heading behind him loops him up and stalls him.
        const k = angleBetween(h, flat) > 50 ? turnToward(c, climbing(flat, angle), { maxUp: angle }) : pointNose(me, climbing(flat, angle), { fine: 6 });
        return { ...k, throttle: 1, aimed: false, say };
      }
      case 'perch': {
        const lookDown = Math.asin(clamp(-g.los[1])) / DEG;
        if (lookDown > 35 || mem.since > 10) go(c, 'dive');
        return { ...turnToward(c, climbing(toward, 0), { maxUp: 0, maxDown: 0 }), throttle: 1, aimed: false };
      }
      case 'dive': {
        const lp = sub(leadPoint(me, him, c.gun), me.position);
        const elev = Math.asin(clamp(unit(lp)[1])) / DEG;
        const k = elev < -50 ? pointNose(me, climbing(heading(lp), -50), { fine: 8, push: 0.7 }) : leadPursuit(c, { pull: 1, push: 0.7 });
        if (c.pilot.fire) mem.shotT = (mem.shotT ?? 0) + dt;
        const toMerge = g.closure > 1 ? g.range / g.closure : Infinity;
        const dive = Math.max(0, -pitchOf(me.orientation)) * DEG;
        const bottom = high - (g.mySpeed / 0.9) * (1 - Math.cos(dive)) - 0.3 * Math.max(0, -me.velocity[1]) + 0.5 * Math.min(0, him.velocity[1]);
        if ((mem.shotT ?? 0) > (mem.burst ?? 0.6) || toMerge < 1.2 || bottom < 0 || (facing && g.range < 350) || mem.since > 25) {
          mem.offT = (mem.offT ?? 0) + dt;
          if (mem.offT < 0.5 && gunSolution(me, him, { ...c.gun, width: 5 }).fire) {
            return { ...pointNose(me, climbing(h, 15), { fine: 6 }), throttle: 1, aimed: false };
          }
          mem.offT = 0;
          mem.shotT = 0;
          mem.climbDeg = undefined;
          go(c, 'zoom');
          return { ...k, throttle: 1, aimed: false, say: facing && g.range < 350 ? 'He has turned to face me: no shot, back up' : undefined };
        }
        return { ...k, throttle: 1, aimed: g.range < (mem.open ?? 130) || (toMerge < 3 && g.range < 250) || (bottom < 15 && g.range < 250) };
      }
      case 'zoom': {
        const k = pointNose(me, climbing(h, easedClimb(c, 35, 40)), { fine: 6 });
        if ((g.mySpeed < 55 && mem.since > 1.5) || mem.since > 9) go(c, 'reverse');
        return { ...k, throttle: 1, aimed: false };
      }
      case 'reverse': {
        const k = pitchOf(me.orientation) > 10 ? wingover(c) : pointNose(me, climbing(toward, high > 100 ? -25 : 0), { fine: 8 });
        if ((g.ata < 40 && mem.since > 1) || mem.since > 7) {
          mem.overSide = undefined;
          mem.climbDeg = undefined;
          mem.climbDir = undefined;
          const again = g.ata < 40 && high > 100 && !(facing && g.range < 450);
          go(c, again ? 'dive' : 'climb');
          if (!again) return { ...k, throttle: 1, aimed: false, say: high < 30 ? LOST_HEIGHT : undefined };
        }
        return { ...k, throttle: 1, aimed: false };
      }
      default: go(c, 'climb');
    }
    return null;
  },
};

/** Under the height: the counter's climb and break (`climbBetween`), with
 *  the breaks counted. Climb while he is away, break when he is committed
 *  to a dive at you inside 380 m, and break the same way when he comes in
 *  behind you at your height: a chase from your rear quarter, his nose on
 *  you, closing inside 380 m (reviews/dfn-uh.md, "Ascendancy"; without it,
 *  climbing on in front of him under the eyes hands him the six for 3-33 s).
 *  `mem.brokeAt` is the last tick of a break. */
function uhClimbOrBreak(c) {
  const { g, mem, me, him } = c;
  const dive = him.velocity[1] < -8 && g.hisAta < 30 && g.range < 380;
  const chase = g.hisAta < 25 && g.range < 380 && g.closure > 0 && g.ata > 60;
  const coming = dive || chase;
  if (coming && mem.phase !== 'break') { mem.side = g.side; mem.breaks = (mem.breaks ?? 0) + 1; go(c, 'break'); }
  if (mem.phase === 'break' && mem.since > 3 && !coming) go(c, 'climb');
  if (mem.phase === 'break') { mem.brokeAt = mem.t; return { ...hardTurn(me, mem.side), throttle: 1 }; }
  if (mem.phase !== 'climb') go(c, 'climb');
  const deg = clamp((g.mySpeed - 36) * 2, 0, 20);
  const off = angleBetween(heading(me.velocity), heading(sub(him.position, me.position)));
  return { ...climbingTurn(c, g.side, deg, clamp((off - 20) / 90, 0, 1) * 0.12), throttle: 1 };
}

/**
 * Under the height, the Dip: you cannot outrun a Spitfire with 500 m over
 * you, he dives after you and closes. So climb between his dives (and break
 * his chases) until his height is spent and the energy is yours (50 m of
 * it), then run: straight away from him at full throttle, the nose 2
 * degrees down. Level, he cannot close on a Spitfire with more energy than
 * his.
 */
PLANS.uhDip = {
  title: 'Getting away', first: 'climb',
  says: {
    climb: 'He is not coming at me: climbing at full throttle, keeping him in sight',
    break: 'He is diving at me: break, hard',
    'dip-run': 'His height is spent and mine is won: running, nose just under the horizon',
  },
  step(c) {
    const { g, mem, me } = c;
    // Not straight down his nose line: only with his nose well off you, or
    // with him out past 600 m (reviews/dfn-uh.md, the review).
    if (mem.phase !== 'dip-run' && mem.phase !== 'break' && g.energy < -50 && (g.hisAta > 90 || g.range > 600)) go(c, 'dip-run');
    if (mem.phase !== 'dip-run') return uhClimbOrBreak(c);
    const away = heading(sub(me.position, c.him.position));
    const want = me.position[1] < 110 ? (110 - me.position[1]) * 0.05 : -2;
    return { ...turnToward(c, climbing(away, want), { maxUp: 10, maxDown: 25 }), throttle: 1 };
  },
};

/**
 * Under the height, the aim of the reversal: the lead with its own swing
 * led 0.7 s, pulled at 0.95. A copy of `ascAim` (the ascendancy's aim),
 * which the reversal needs before `ASC` is reached in this file and with
 * its own memory (`mem.uhAim`); the school's `leadPursuit` lags a man who
 * is still turning, and in this reversal it lands no shot in 8 of 9.
 */
function uhAim(c) {
  const D = unit(sub(leadPoint(c.me, c.him, c.gun), c.me.position));
  const m = c.mem.uhAim ?? (c.mem.uhAim = {});
  const Dd = m.D ? scale(sub(D, m.D), 1 / c.dt) : [0, 0, 0];
  m.Dd = m.Dd ? add(scale(m.Dd, 0.7), scale(Dd, 0.3)) : Dd;
  m.D = D;
  return pointNose(c.me, add(D, scale(m.Dd, 0.7)), { fine: 8, mem: m, dt: c.dt, pull: 0.95, push: 0.8 });
}

/** Under the height, what the Flip and the Ninja say once they fly the
 *  ascendancy (`PLANS.ascend`'s phases) on top of the climb and break. */
const UH_ASCEND_SAYS = {
  climb: 'He is not coming at me: climbing at full throttle, keeping him in sight',
  break: 'He is coming at me: break, hard, into him',
  find: 'The height is mine now: above him, his nose away, picking the moment',
  dive: 'Down on him from above with the lead: guns inside 260 m',
  zoom: 'Off him before the pass: up on the dive\'s speed, out of his reach',
  over: 'Over the top toward his side of the sky, nose coming down on him',
  beam: 'His nose is coming round onto me: across his line, out of his lead',
  leave: 'He has lost sight of me: out, full throttle, building the height back unseen',
  back: 'Coming back with the height, my nose off him so he does not turn to meet me',
};

/**
 * Under the height, the Ninja: never give him a shot, take the height back,
 * then hold it as the boom-and-zoomer. Climb between his dives and break
 * each one, and break his chase from behind the same way; once the energy is
 * yours (200 m of it, or 50 m with 80 m over him, his nose 45 degrees or
 * more off you, inside 600 m), the ascendancy (`PLANS.ascend`): down on him
 * from above, up and over, never turning with him. When a pass has spent the
 * edge and `ascend` would climb after him at his height (4 s inside 400 m,
 * under 35 m over him, his nose well off you), out instead: away from him,
 * climbing gently, to 900 m or 25 s, and back with the height. Without it
 * the four starts that get no shot spend 17-33 s circling after him; with it
 * they part from him (reviews/dfn-uh.md, "Ascendancy").
 */
PLANS.uhNinja = {
  title: 'Taking the height back, then holding it', first: 'climb',
  says: { ...UH_ASCEND_SAYS, out: 'Level with him and no shot: leaving, not circling with him' },
  step(c) {
    const { g, mem, me, him } = c;
    const high = -g.above, edge = -g.energy;
    const won = (edge > 200 && high > 35) || (edge > 50 && high > 80 && g.hisAta > 45 && g.range < 600);
    if (!mem.handed && mem.phase !== 'break' && won) { mem.handed = true; go(c, 'find'); }
    if (!mem.handed) return uhClimbOrBreak(c);
    if (mem.phase === 'out') {
      if (g.range > 900 || mem.since > 25) go(c, 'back');
      else {
        const away = heading(sub(me.position, him.position));
        return { ...turnToward(c, climbing(away, clamp(g.mySpeed - 50, 0, 8)), { maxUp: 8, maxDown: 5 }), throttle: 1 };
      }
    }
    if (mem.phase === 'climb' && g.range < 400 && high < 35) {
      mem.evenT = (mem.evenT ?? 0) + c.dt;
      if (mem.evenT > 4 && g.hisAta > 90) { mem.evenT = 0; go(c, 'out'); return { ...hardTurn(me, -g.side), throttle: 1 }; }
    } else if (mem.phase !== 'climb') mem.evenT = 0;
    // A shot that would land is taken in every phase, the zoom's snap shot
    // too (`ascend` holds its fire off the dive).
    const out = PLANS.ascend.step(c);
    if (!out) return out;
    const say = mem.phase === 'climb' ? 'Not above him now: climbing toward him, him in front of me' : undefined;
    return { ...out, aimed: true, say: out.say ?? say };
  },
};

/**
 * Under the height, the Flip: from chased to chaser. Climb between his
 * dives; when he comes in behind you at your height, break into him, and
 * the moment he has gone past you, no faster than you and not diving,
 * reverse onto him with the lead (`uhAim`), guns inside 260 m. Off it after
 * 12 s, past 450 m or with his nose back on you; from then on the Ninja
 * (`uhNinja`): climb and break until the energy is yours, then down on him
 * from above, never round the horizontal with him.
 */
PLANS.uhFlip = {
  title: 'Reversing onto their overshoot', first: 'climb',
  says: { ...UH_ASCEND_SAYS, 'flip-reverse': 'He has gone past me, slow: reversing onto his tail', out: 'Level with him and no shot: leaving, not circling with him' },
  step(c) {
    const { g, mem, him } = c;
    if (mem.phase === 'flip-reverse') {
      const threat = g.hisAta < 30 && g.range < 400 && g.ata > 90;
      if (mem.since > 12 || threat || g.range > 450) {
        mem.flipped = true;
        go(c, threat ? 'break' : 'climb');
        if (threat) mem.side = g.side;
      } else return { ...uhAim(c), throttle: 1 };
    }
    // Gone past: opening, close, the break just flown, he no faster than me by
    // more than 5 m/s and not diving.
    const past = g.closure < 0 && g.range < 250 && mem.t - (mem.brokeAt ?? -99) < 3 && (mem.breaks ?? 0) >= 1
      && g.hisSpeed < g.mySpeed + 5 && him.velocity[1] > -5;
    if (!mem.flipped && past) {
      mem.uhAim = undefined;
      go(c, 'flip-reverse');
      return { ...leadPursuit(c, { pull: 1 }), throttle: 1 };
    }
    if (mem.flipped) return PLANS.uhNinja.step(c);
    return uhClimbOrBreak(c);
  },
};

/**
 * THE BREAKER: a defender who knows his business. He cruises, breaks into
 * you the moment you are committed behind him (inside 450 m and closing),
 * keeps turning hard, chops his throttle if you sit close behind him so you
 * fly past, and reverses onto you if you do.
 */
PLANS.breaker = {
  title: 'The breaker', first: 'watch',
  says: {
    watch: 'Cruising, watching him come in behind me',
    break: 'He committed: breaking hard into him',
    chop: 'He is sitting close: throttle back and pull up, make him fly past',
    reverse: 'He flew past: turning onto him',
  },
  step(c) {
    const { me, g, mem } = c;
    if (mem.phase === 'watch') {
      if (!mem.dir) { mem.dir = heading(me.velocity); mem.cruise = g.mySpeed; }
      if (g.hisAta < 30 && g.range < 450 && g.closure > 2) { mem.side = g.side; go(c, 'break'); }
      else return { ...pointNose(me, climbing(mem.dir, 0), { fine: 6 }), throttle: holdSpeed(c, mem.cruise) };
    }
    if (g.ata < 60 && g.hisAta > 90 && g.range < 400) { go(c, 'reverse'); return { ...leadPursuit(c), throttle: 1 }; }
    // The chop, as `chopper` flies it: only with him close behind me in
    // the circle and still closing, throttle back and pull up through the
    // turn so he flies through underneath.
    if (mem.y0 === undefined) mem.y0 = me.position[1];
    if (mem.side === undefined) mem.side = g.side;
    const close = g.ata > 130 && g.range < 90 && g.closure > 0 && g.mySpeed > CHOP_FLOOR;
    go(c, close ? 'chop' : 'break');
    if (close) return { ...hardTurn(me, mem.side, { climb: 16, maxBank: 55 }), throttle: -1 };
    if (mem.since < c.dt) mem.y0 = me.position[1];
    return { ...levelHardTurn(c, mem.side, mem.y0), throttle: 1 };
  },
};

/** The throttle that holds the closure to `want(range)`: fast in from far
 *  out, nothing at the range he wants to sit at. */
function closureThrottle(c, sitAt) {
  const { g } = c;
  const want = clamp((g.range - sitAt) * 0.08, -4, 25);
  return g.mySpeed < 40 ? 1 : clamp(0.5 + (want - g.closure) * 0.12, -1, 1);
}

/** Arrive slow: the closure killed before you get there, 250 m back at his
 *  speed, so when he breaks you are not going fast enough to fly past his
 *  tail. When he breaks, do not follow him into his circle (120 m across:
 *  from 250 m back you cannot stay behind him in it): lift up over it and
 *  stay there, out of his reach, until he stops turning. */
PLANS.arriveSlow = {
  title: 'Arriving slow', first: 'close',
  says: {
    close: 'Closing, but slowing down before I get there',
    above: 'He broke: not following him in, staying above his turn',
    shoot: 'In his reach, his wings level: guns',
  },
  step(c) {
    const { g, mem } = c;
    const hisBank = trackHisPath(c);
    if (mem.phase !== 'above' && hisBank > 45 && g.range < 450) go(c, 'above');
    if (mem.phase === 'above') {
      if (!(hisBank < 25 && g.ata < 40 && g.range < 400)) return overHisTurn(c, { maxUp: 25 });
      go(c, 'shoot');
    }
    go(c, g.range < c.gun.range && g.ata < 30 ? 'shoot' : 'close');
    return { ...leadPursuit(c, { push: 0.8 }), throttle: closureThrottle(c, 250) };
  },
};

/**
 * LAG BACK: stay out of his circle. Close to 250 m behind him at his
 * speed. When he breaks, do not follow him into the turn (it is 120 m
 * across, and from 250 m he is round and facing you in five seconds):
 * turn the same hard turn the same way, where you are, so your circle and
 * his go round side by side 250 to 300 m apart. When he stops turning, the
 * nose onto him and guns.
 */
PLANS.lagBack = {
  title: 'Lagging back', first: 'close',
  says: {
    close: 'Closing to 250 m behind him at his speed',
    lag: 'He is turning: turning with him out here, not into his circle',
    shoot: 'He stopped turning: nose on him, guns',
  },
  step(c) {
    const { me, him, g, mem } = c;
    const rate = turnRateOf(c);
    const turning = rate > 15;
    if (turning && g.range < 450) mem.sawTurn = true;
    const want = Math.max(40, g.hisSpeed + clamp((g.range - 250) * 0.05, -6, 15));
    const throttle = holdSpeed(c, want);
    if (!turning && g.ata < 30 && g.range < 320 && g.aspect < 60) {
      go(c, mem.sawTurn ? 'shoot' : 'close');
      return { ...leadPursuit(c), throttle, aimed: mem.sawTurn || g.range < 260 };
    }
    if (turning) {
      go(c, 'lag');
      // His turn's sense, seen from above: +1 right, -1 left, held once seen.
      const hv = heading(him.velocity);
      if (mem.hisH0) {
        const turn = dot([-mem.hisH0[2], 0, mem.hisH0[0]], hv);
        if (Math.abs(turn) > 1e-3) mem.turnSide = Math.sign(turn);
      }
      mem.hisH0 = hv;
      // The same hard turn, the same way, out here: his circle and mine go
      // round together, 250 to 300 m apart, and neither nose is ever on
      // the other inside the guns' reach for long.
      if (mem.y0 === undefined) mem.y0 = me.position[1];
      return { ...levelHardTurn(c, mem.turnSide ?? g.side, mem.y0), throttle: 1, aimed: false };
    }
    go(c, 'close');
    return { ...leadPursuit(c), throttle, aimed: g.range < 260 };
  },
};

// --- on his tail: the Dip, the Flip and the Ninja (prefix `ot`) -------------

/**
 * THE BREAKER, PLAYING TO WIN (on his tail's Dip, Flip and Ninja). The
 * breaker, and the answers a sensible defender has that he lacks: anyone
 * sitting on his tail inside 350 m with his nose on him is broken into,
 * closing or not; turned onto a man in front of him, he eases the closure
 * (the hunter's) so he does not fly past; flown past all the same, he runs;
 * and a man running away is chased. He gives the chase up by the school's
 * one rule (`scAce`): 6 s in a row past his guns' reach + 30 m and not
 * closing. Then he turns away and climbs, out of it unless the other turns
 * back at him (he meets him) or gets on his tail (he breaks).
 */
PLANS.otBreaker = {
  title: 'The breaker', first: 'watch',
  says: {
    watch: 'Cruising, watching him come in behind me',
    break: 'He committed: breaking hard into him',
    chop: 'He is sitting close: throttle back and pull up, make him fly past',
    reverse: 'He is in front of me: turning onto him',
    chase: 'He is running: after him, full throttle',
    letgo: 'He is out of my reach and I am not closing: letting him go',
    meet: 'He is coming back at me: turning to face him',
    extend: 'I flew past him: running for it, full throttle',
  },
  step(c) {
    const { me, g, mem } = c;
    // My closure on him, smoothed over about three seconds (`scAce`'s).
    mem.cl = (mem.cl ?? g.closure) + (g.closure - (mem.cl ?? g.closure)) * Math.min(1, c.dt / 3);
    const onMyTail = g.ata > 90 && ((g.hisAta < 30 && g.range < 450 && g.closure > 2) || (g.hisAta < 40 && g.range < 350));
    if (mem.phase === 'letgo' || mem.phase === 'meet') {
      if (onMyTail) { mem.side = g.side; mem.y0 = undefined; go(c, 'break'); }
      else {
        if (mem.phase === 'letgo' && g.hisAta < 40 && g.range < 800 && g.closure > 5) go(c, 'meet');
        if (mem.phase === 'meet') {
          if (g.ata > 150 && g.range > 150) { mem.slow = 0; go(c, 'chase'); }
          else return { ...turnToward(c, sub(leadPoint(me, c.him, c.gun), me.position), { maxUp: 15, maxDown: 30 }), throttle: 1 };
        } else {
          return { ...turnToward(c, climbing(mem.home, 15), { maxUp: 15, maxDown: 5 }), throttle: 1 };
        }
      }
    }
    if (mem.phase === 'watch') {
      if (!mem.dir) { mem.dir = heading(me.velocity); mem.cruise = g.mySpeed; }
      if (onMyTail) { mem.side = g.side; mem.y0 = undefined; go(c, 'break'); }
      else return { ...pointNose(me, climbing(mem.dir, 0), { fine: 6 }), throttle: holdSpeed(c, mem.cruise) };
    }
    // Flown past him from behind, on his heading: run, out of his guns.
    const sameWay = angleBetween(heading(me.velocity), heading(c.him.velocity)) < 60;
    if ((mem.phase === 'reverse' || mem.phase === 'chase') && g.ata > 110 && g.range < 90 && sameWay) { mem.runDir = heading(me.velocity); go(c, 'extend'); }
    if (mem.phase === 'extend') {
      if (mem.since < 6 && g.range < 450) return { ...pointNose(me, climbing(mem.runDir, -5), { fine: 6 }), throttle: 1 };
      mem.side = g.side; mem.y0 = undefined; go(c, 'break');
    }
    const threat = g.hisAta < 45 && g.range < 600;
    const away = g.ata < 60 && g.hisAta > 90;
    const chasing = mem.phase === 'chase' || mem.phase === 'reverse';
    if (!threat && ((away && g.range < 400) || (chasing && g.range < 1500 && (away || g.range > 300)))) {
      // The school's give-up: 6 s in a row out of reach and not closing.
      mem.slow = g.range > c.gun.range + 30 && mem.cl < 0.5 ? (mem.slow ?? 0) + c.dt : 0;
      if (mem.slow >= 6) {
        mem.home = scale(heading(me.velocity), -1); mem.slow = 0; go(c, 'letgo');
        return { ...turnToward(c, climbing(mem.home, 15), { maxUp: 15, maxDown: 5 }), throttle: 1 };
      }
      go(c, g.range < 400 ? 'reverse' : 'chase');
      const want = clamp((g.range - 30) * 0.12, -8, 30);
      const throttle = g.range > 400 || g.mySpeed < 38 ? 1 : clamp(0.5 + (want - g.closure) * 0.09, -1, 1);
      if (away) return { ...leadPursuit(c), throttle };
      return { ...turnToward(c, sub(leadPoint(me, c.him, c.gun), me.position), { maxUp: 20, maxDown: 30 }), throttle: 1 };
    }
    if (chasing) { mem.side = g.side; mem.y0 = undefined; }
    if (mem.y0 === undefined) mem.y0 = me.position[1];
    if (mem.side === undefined) mem.side = g.side;
    const close = g.ata > 130 && g.range < 90 && g.closure > 0 && g.mySpeed > CHOP_FLOOR;
    go(c, close ? 'chop' : 'break');
    if (close) return { ...hardTurn(me, mem.side, { climb: 16, maxBank: 55 }), throttle: -1 };
    if (mem.since < c.dt) mem.y0 = me.position[1];
    return { ...levelHardTurn(c, mem.side, mem.y0), throttle: 1 };
  },
};

/** Which way he turns, seen from above: +1 right, -1 left, held once seen. */
function otTurnSide(c) {
  const hv = heading(c.him.velocity);
  const mem = c.mem;
  if (mem.otH) {
    const t = dot([-mem.otH[2], 0, mem.otH[0]], hv);
    if (Math.abs(t) > 2e-3) mem.otSide = Math.sign(t);
  }
  mem.otH = hv;
  return mem.otSide ?? c.g.side;
}

/** In his circle: in behind him at about his speed and, once he breaks,
 *  round his turn after him, the nose behind him. The fight that goes
 *  nowhere, which the Dip and the Flip start from. */
function otInHisCircle(c) {
  const { me, g, mem } = c;
  if (turnRateOf(c) > 15 && g.range < 500 && mem.brokeAt === undefined) mem.brokeAt = mem.t;
  if (mem.brokeAt === undefined) {
    go(c, 'close');
    const want = Math.max(40, g.hisSpeed + clamp((g.range - 200) * 0.05, -6, 15));
    return { ...leadPursuit(c), throttle: holdSpeed(c, want) };
  }
  go(c, 'circle');
  const side = otTurnSide(c);
  if (mem.y0 === undefined) mem.y0 = me.position[1];
  const d = sub(c.him.position, me.position);
  const k = g.ata > 25 ? levelHardTurn(c, side, mem.y0) : pointNose(me, climbing(heading(d), 0), { fine: 8, ...aim(c) });
  return { ...k, throttle: g.range < 130 && g.closure > 0 ? 0 : 1 };
}

/**
 * THE DIP from his circle. In behind him when he breaks, round his circle
 * after him: nowhere. Leave when he is across the circle going the other
 * way (headings 140 degrees apart, a turn and more after his break): wings
 * level, full throttle, a shallow dive to 140 m and level. He has half a
 * circle to fly before his nose is on you; by then you are 290-330 m ahead,
 * out of his reach and faster, and he cannot gain on you.
 */
PLANS.otDip = {
  title: 'Leaving their circle', first: 'close',
  says: {
    close: 'Closing on his tail at his speed',
    circle: 'In his circle after him: no lead, going nowhere',
    'dip-out': 'He is across the circle going away: rolling out, full throttle, out of here',
  },
  step(c) {
    const { me, g, mem } = c;
    if (mem.phase !== 'dip-out') {
      const opposed = angleBetween(heading(me.velocity), heading(c.him.velocity)) > 140;
      const after = mem.brokeAt === undefined ? -1 : mem.t - mem.brokeAt;
      // A turn and more after his break, when he is going the other way;
      // or, failing that, 20 s on, whatever he is doing.
      if (!((after > 8 && opposed && g.range > 90) || after > 20)) return otInHisCircle(c);
      mem.runDir = heading(me.velocity);
      go(c, 'dip-out');
    }
    return { ...turnToward(c, climbing(mem.runDir, c.agl > 140 ? -6 : 0), { maxUp: 0, maxDown: 8 }), throttle: 1 };
  },
};

/**
 * THE FLIP, the best try: the high yo-yo from his circle. Four seconds
 * after his break, up out of his turn onto a perch 100 m over his circle;
 * whenever you are over him and in his rear quarter inside 400 m, down on
 * him with the lead; up again before you fly past him. It keeps you safe;
 * it does not give you the shot (a Spitfire turning hard at 40 m/s turns
 * 39 degrees a second, and the dive's speed turns you no tighter).
 */
PLANS.otYoyo = {
  title: 'The high yo-yo', first: 'close',
  says: {
    close: 'Closing on his tail at his speed',
    circle: 'In his circle after him: no lead, going nowhere',
    'flip-up': 'Trying to get up over his turn: at his speed there is little height to be had',
    'flip-dive': 'Down at him from over his tail: he turns away faster than the dive follows',
  },
  step(c) {
    const { g, mem } = c;
    trackHisPath(c);
    if (!String(mem.phase).startsWith('flip')) {
      if (!(mem.brokeAt !== undefined && mem.t - mem.brokeAt > 4)) return otInHisCircle(c);
      go(c, 'flip-up');
    }
    if (mem.phase === 'flip-up' && g.above < -50 && g.aspect < 70 && g.range < 400 && g.mySpeed > 30) go(c, 'flip-dive');
    if (mem.phase === 'flip-dive' && (g.range < 70 || g.aspect > 110 || g.above > 15)) go(c, 'flip-up');
    if (mem.phase === 'flip-dive') return { ...leadPursuit(c, { pull: 1, push: 0.8 }), throttle: 1 };
    const trail = mem.trail;
    const was = trail[Math.max(0, trail.length - 1 - Math.round(0.6 / c.dt))];
    return { ...turnToward(c, sub([was[0], was[1] + 100, was[2]], c.me.position), { maxUp: 25, maxDown: 40 }), throttle: 1 };
  },
};

/**
 * THE NINJA, the best try: lag back out wide (`lagBack`), at his speed and,
 * once he breaks, the same hard turn the same way 250 to 300 m out, never
 * into his circle; the guns taken whenever they have him, in any phase.
 */
PLANS.otOutWide = {
  title: 'Out wide', first: 'close',
  says: {
    close: 'Closing to 250 m behind him at his speed',
    lag: 'He is turning: turning with him out here, not into his circle',
    shoot: 'He stopped turning: nose on him, guns',
  },
  step(c) {
    const { me, g, mem } = c;
    const turning = turnRateOf(c) > 15;
    if (turning && g.range < 450) mem.sawTurn = true;
    const throttle = holdSpeed(c, Math.max(40, g.hisSpeed + clamp((g.range - 250) * 0.05, -6, 15)));
    if (!turning && g.ata < 30 && g.range < 320 && g.aspect < 60) {
      go(c, mem.sawTurn ? 'shoot' : 'close');
      return { ...leadPursuit(c), throttle };
    }
    if (turning) {
      go(c, 'lag');
      if (mem.y0 === undefined) mem.y0 = me.position[1];
      return { ...levelHardTurn(c, otTurnSide(c), mem.y0), throttle: 1 };
    }
    go(c, 'close');
    return { ...leadPursuit(c), throttle };
  },
};

/**
 * THE BREAKER, AGAINST A BOUNCE TOO (on his tail's ace since the ascendancy,
 * reviews/dfn-ot.md): `otBreaker`, and the answer a man in a hard turn has
 * to a fighter diving on him from above: seen coming down on the side his
 * turn is carrying his nose away from, he reverses his break into him, so
 * the dive meets his nose instead of his tail. No sooner than 3 s after the
 * last reversal: rolling from one hard turn into the other takes a second.
 */
PLANS.otAce = {
  title: 'The breaker', first: 'watch',
  says: { ...PLANS.otBreaker.says, climb: 'Nobody on my tail and he is above me: out of the turn, climbing away to take the height back' },
  step(c) {
    const { me, g, mem } = c;
    if (mem.phase === 'break' && g.sees && g.above > 40 && g.hisAta < 35 && g.range < 700 && g.ata > 20
        && mem.side !== undefined && g.side !== mem.side && mem.t - (mem.reversedAt ?? -99) > 3) {
      mem.side = g.side; mem.reversedAt = mem.t; mem.y0 = undefined;
    }
    // Breaking with nobody on his tail and the other man seen above him, not
    // coming down at him: a hard turn there only waits to be bounced. Out of
    // it and away from him, climbing, to take the height back.
    const above = g.sees && g.above > OT_ACE.above && g.range > OT_ACE.clear && !(g.hisAta < 45 && g.range < 600);
    mem.calm = mem.phase === 'break' && above ? (mem.calm ?? 0) + c.dt : 0;
    if (mem.calm > OT_ACE.calm) { mem.away = scale(heading(sub(me.position, c.him.position)), 1); mem.calm = 0; go(c, 'climb'); }
    if (mem.phase === 'climb') {
      const onTail = g.ata > 90 && ((g.hisAta < 30 && g.range < 450 && g.closure > 2) || (g.hisAta < 40 && g.range < 350));
      if (onTail) { mem.side = g.side; mem.y0 = undefined; go(c, 'break'); }
      else if (g.sees && g.hisAta < 40 && g.range < 800 && g.closure > 5) go(c, 'meet');
      else return { ...turnToward(c, climbing(mem.away, OT_ACE.climb), { maxUp: OT_ACE.climb, maxDown: 5 }), throttle: 1 };
    }
    return PLANS.otBreaker.step(c);
  },
};
/** `otAce`'s way out of a pointless break: the other this far above him,
 *  this far out and not coming at him, for this long; then climbing away. */
const OT_ACE = { above: 50, clear: 250, calm: 3, climb: 15 };

/** Where I sit off his nose, seen from above, in his turn's sense: + ahead
 *  of his sweep (he is turning toward me), - behind it (his nose has just
 *  gone past me and is turning away). Degrees. */
function otSweep(c) {
  const h = heading(c.him.velocity), to = heading(sub(c.me.position, c.him.position));
  return otTurnSide(c) * Math.atan2(dot([-h[2], 0, h[0]], to), dot(h, to)) / DEG;
}
/** A level direction `deg` round from `v` (+ to the right). */
const otRound = (v, deg) => add(scale(v, Math.cos(deg * DEG)), scale([-v[2], 0, v[0]], Math.sin(deg * DEG)));
/** A turn by the horizon onto the level direction `want`, the bank no more
 *  than `maxBank`, the pull holding the vertical speed `vy` (`ascBankTo`'s,
 *  with the bank its caller's: the climb round him wants 50, not 60). */
function otBankTo(c, want, vy, maxBank) {
  const { me, mem } = c;
  const h = heading(me.velocity);
  const side = Math.sign(dot([-h[2], 0, h[0]], want)) || 1;
  const bank = clamp(angleBetween(h, want) * 1.2, 0, maxBank);
  mem.otI = clamp((mem.otI ?? 0) + (vy - me.velocity[1]) * c.dt * 0.02, -0.3, 0.3);
  return bankAndPull(me, side * bank, clamp(0.1 + (vy - me.velocity[1]) * 0.08 + mem.otI, -0.4, 1));
}

/**
 * The ascendancy's numbers against a breaker (`otNinja`), from the nine
 * starts. Metres, m/s, degrees, seconds.
 */
export const OT_UP = {
  need: 150,      // energy height over him before going in
  high: 90,       // and this much of it height
  ring: 280,      // climbing round him this far out, seen from above
  ringFrom: 220,  // going in from between these
  ringTo: 450,
  keep: 78,       // inside his reach my nose never further off him than this
  climb: 13,      // the best climb, m/s, at no less than
  climbSpeed: 52,
  bank: 50,
  inFrom: -60,    // turn in while his nose is this far round from me (otSweep) ...
  inTo: 30,
  diveFrom: -160, // ... and down on him once it has gone past me, this far
  diveTo: -10,
  look: 13,       // him at least this far below my horizon
  offFor: 2,      // after the pass up and past him for this long, inside
  offRange: 160,
  offUp: 30,      // at this climb
  straight: 1,    // a man out of his break, flying straight, is `ascend`'s ...
  straightHigh: 35, // ... from this far over him
  beam: 1,        // across his line when his nose comes onto me
};
const OT_ASCEND = new Set(['dive', 'zoom', 'over', 'find', 'beam']);
const OT_ASCEND_REST = new Set(['climb', 'leave', 'back']);

/**
 * THE NINJA, the ascendancy against a breaker. When he breaks, do not
 * follow him: climb on a line beside his circle and round it, 280 m out,
 * at the best climb, my nose never more than 78 degrees off him so I am
 * never in front of him going away (he reverses onto anyone who is). With
 * 150 m of energy over him, turn in as his nose comes round toward me and,
 * the moment it has swept past me, down on him from behind it (the
 * ascendancy's dive, `ascend`): he is turning away from my guns. After the
 * pass up and past him, never back into him; then `ascend` while it is
 * above him, and the climb round him again when it is not.
 */
PLANS.otNinja = {
  title: 'Above their break', first: 'ninja-climb',
  says: {
    'ninja-climb': 'Not into his circle: climbing beside it to take the height',
    'ninja-in': 'The height is there: turning in as his nose comes round',
    dive: 'His nose has gone past me: down on him from behind it, guns inside 230 m',
    'ninja-off': 'Off him and up past him, never back into him',
    zoom: 'Off him before the pass: up on the dive\'s speed, out of his plane',
    over: 'Over the top toward his side of the sky, nose coming down on him',
    find: 'Above him, his nose away from me: picking the moment',
    beam: 'His nose is coming round onto me: across his line, out of his lead',
  },
  step(c) {
    const K = OT_UP;
    const { me, him, g, mem } = c;
    const sweep = otSweep(c);
    const high = -g.above;
    // Turning hard, or flying straight (out of his break, climbing away):
    // a man flying straight is `ascend`'s, bounced from above as it bounces.
    const turning = turnRateOf(c) > 15;
    if (turning) mem.sawBreak = true;
    const straight = K.straight && mem.sawBreak && !turning;
    if (OT_ASCEND.has(mem.phase) || (straight && OT_ASCEND_REST.has(mem.phase))) {
      const was = mem.phase;
      const out = PLANS.ascend.step(c);
      if (was === 'dive' && mem.phase !== 'dive') mem.offUntil = mem.t + K.offFor;
      if (OT_ASCEND.has(mem.phase) || (straight && OT_ASCEND_REST.has(mem.phase))) return out;
      mem.orbit = undefined;
      go(c, 'ninja-climb');
    }
    if (mem.offUntil !== undefined && mem.t < mem.offUntil && g.range < K.offRange) {
      go(c, 'ninja-off');
      return { ...pointNose(me, climbing(heading(me.velocity), K.offUp), { fine: 6, pull: 1 }), throttle: 1, aimed: g.range < c.gun.range };
    }
    if (straight && high > K.straightHigh) { go(c, 'find'); return PLANS.ascend.step(c); }
    // His nose coming onto me inside 600 m: across his line (`ascend`'s beam).
    if (K.beam && g.hisAta < 20 && g.range < 600 && mem.phase !== 'ninja-in') { go(c, 'beam'); return PLANS.ascend.step(c); }
    const lookDown = Math.asin(clamp(-g.los[1])) / DEG;
    const toHim = heading(sub(him.position, me.position));
    const flat = Math.hypot(him.position[0] - me.position[0], him.position[2] - me.position[2]);
    const ready = g.myEnergy - g.hisEnergy > K.need && high > K.high && flat > K.ringFrom && flat < K.ringTo;
    const nose = () => ({ ...pointNose(me, sub(him.position, me.position), { fine: 10, push: 0.6 }), throttle: 1, aimed: g.range < c.gun.range });
    if (mem.phase === 'ninja-in') {
      if (lookDown > K.look && g.ata < 60 && sweep > K.diveFrom && sweep < K.diveTo) {
        mem.ascAim = undefined; go(c, 'dive');
        return PLANS.ascend.step(c);
      }
      if (mem.since < 4) return nose();
      go(c, 'ninja-climb');
    }
    if (ready && sweep > K.inFrom && sweep < K.inTo) { go(c, 'ninja-in'); return nose(); }
    go(c, 'ninja-climb');
    if (mem.orbit === undefined) mem.orbit = Math.sign(dot(heading(me.velocity), [-toHim[2], 0, toHim[0]])) || 1;
    // Toward the ring's tangent from outside it, round it on it.
    const ring = flat > K.ring + 40 ? Math.asin(clamp(K.ring / flat)) / DEG : clamp(90 - (flat - K.ring) * 0.15, 60, 110);
    // Inside his reach my nose never more than `keep` off him: the heading's
    // offset off him that allows, given my climb and how far below me he is.
    const pv = Math.asin(clamp(me.velocity[1] / Math.max(1, g.mySpeed)));
    const e = Math.asin(clamp(-g.los[1]));
    const cos = (Math.cos(K.keep * DEG) + Math.sin(pv) * Math.sin(e)) / Math.max(0.05, Math.cos(pv) * Math.cos(e));
    const most = g.range < 460 ? Math.acos(clamp(cos)) / DEG : 180;
    const off = clamp(Math.min(ring, most), 10, 110);
    const vy = clamp((g.mySpeed - K.climbSpeed) * 1.5, -2, K.climb);
    return { ...otBankTo(c, otRound(toHim, mem.orbit * off), vy, K.bank), throttle: 1, aimed: g.range < c.gun.range };
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

// --- the ascendancy (features/dogfight-school/reviews/ascend.md) ------------

/**
 * The ascendancy pilot's numbers, tuned on the flight law from the nine
 * nearby starts against every lesson's ace (`tests/test_dogfight_ascend.py`).
 * Distances in metres, speeds in m/s, angles in degrees, times in seconds.
 */
const ASC = {
  open: 262,        // guns from here in, inside the 268 m the wing guns reach
  lead: 0.7,        // how far ahead the aim leads the lead point's own swing
  aimPull: 0.95,    // the aim's elevator, a touch short of full
  diveAta: 60,      // dive only with him this close to the nose
  high: 35,         // and this far over him
  look: 13,         // and this far below my horizon
  diveSpeed: 35,    // and this fast
  merge: 1,         // off him this long before the paths cross
  near: 28,         // or this close
  floor: -20,       // or when the pull-out would bottom out this far over him
  sink: 0.45,       // a moment to start the pull-out, per m/s of sink
  lost: 50,         // or once the nose is this far off him, 1.5 s into the dive
  zoom: 80,         // the zoom's climb
  zoomPull: 0.7,    // pulled up firmly, not hauled: a hard pull costs the energy
  zoomEnd: 62,      // up until the speed is down to this
  overDown: 18,     // over the top until the nose is down to this
  overLift: 0.35,   // the wingover's lift, tipped this far below the horizon
  nose: 20,         // his nose this close to me ...
  noseRange: 600,   // ... inside this: across his line of sight
  beam: 80,         // that far off the line to him
  bank: 60,         // the beam turn's bank: a Spitfire holds 70 m/s at 60
  collide: 50,      // never closer than this, closing
  // Leaving, once there has been a shot: only once he has lost me, when I
  // have been this long where his cockpit hides me (his eyes give up after
  // `EYES.lose`). Leaving while he can see me, whatever his nose, a turner
  // follows (reviews/ascend.md, "Human eyes") ...
  lostFor: 4.2,
  quiet: 3,         // ... and no shot for this long, or the edge under this
  leaveEdge: 200,
  leaveClimb: 5,    // out straight, nose this far up, to this range ...
  climbFrom: 310,
  far: 1000,        // ... then climbing, out to this, or for this long
  farFor: 16,
  backOff: 45,      // back toward him with the nose this far off him
  rollIn: 450,      // and down on him again from inside this
};

/**
 * Lead pursuit with the lead's own swing led: the nose on where the lead
 * point will be `ASC.lead` s from now. Against a man turning hard the lead
 * point slides across the sky faster than a nose chasing it catches up; aimed
 * at where it is going, the nose gets there.
 */
function ascAim(c) {
  const D = unit(sub(leadPoint(c.me, c.him, c.gun), c.me.position));
  const m = c.mem.ascAim ?? (c.mem.ascAim = {});
  const Dd = m.D ? scale(sub(D, m.D), 1 / c.dt) : [0, 0, 0];
  m.Dd = m.Dd ? add(scale(m.Dd, 0.7), scale(Dd, 0.3)) : Dd;
  m.D = D;
  return pointNose(c.me, add(D, scale(m.Dd, ASC.lead)), { fine: 8, mem: m, dt: c.dt, pull: ASC.aimPull, push: 0.8 });
}

/** A turn by the horizon onto the level direction `want`, the bank no more
 *  than `ASC.bank`, the pull holding the vertical speed `vy`. */
function ascBankTo(c, want, vy) {
  const { me, mem } = c;
  const h = heading(me.velocity);
  const side = Math.sign(dot([-h[2], 0, h[0]], want)) || 1;
  const bank = clamp(angleBetween(h, want) * 1.2, 0, ASC.bank);
  mem.ascI = clamp((mem.ascI ?? 0) + (vy - me.velocity[1]) * c.dt * 0.02, -0.3, 0.3);
  const pull = clamp(0.1 + (vy - me.velocity[1]) * 0.08 + mem.ascI, -0.4, 1);
  return bankAndPull(me, side * bank, pull);
}

/** The level direction `deg` off the line to him, on the side I am already
 *  turning toward. */
function ascOffLine(c, deg) {
  const toHim = heading(sub(c.him.position, c.me.position));
  const right = [-toHim[2], 0, toHim[0]];
  const side = Math.sign(dot(heading(c.me.velocity), right)) || 1;
  return add(scale(toHim, Math.cos(deg * DEG)), scale(right, side * Math.sin(deg * DEG)));
}

/** Off him and up: the zoom starts on the heading the pass left me on. */
function ascZoom(c) {
  c.mem.ascAim = undefined;
  c.mem.zoomDir = heading(c.me.velocity);
  go(c, 'zoom');
}

/**
 * THE ASCENDANCY: an energy fighter holding the upper hand over a turning
 * opponent, never following him round in the horizontal and never showing
 * him its tail. It takes over from any state where it is above, faster or
 * behind him.
 *
 *   - Above him, nose within 60 degrees of him: dive with the lead (`ascAim`),
 *     guns inside 262 m.
 *   - Off him before the pass (1 s from the merge, inside 28 m, the
 *     pull-out about to bottom out at his height, his nose coming onto me, or
 *     the lead lost): up on the dive's speed, steep, pulled firmly but not
 *     hauled, until 62 m/s are left; then a wingover toward his side of the
 *     sky and down on him again.
 *   - His nose on me inside 600 m: across his line of sight, 80 degrees off
 *     it, holding my height, so his lead never builds.
 *   - After a shot, once he has lost me (4.2 s where his cockpit hides me,
 *     `EYES`): leave straight out at full throttle, climbing, to 1000 m or
 *     16 s, and come back with the height, nose 45 degrees off him, down on
 *     him again from inside 450 m.
 *   - Not above him: climb toward him at the best angle, him in front of me.
 *
 * What it buys and what it cannot (reviews/ascend.md, "Human eyes"): a
 * landing shot comes up in 154 of the bench's 180 fights, mostly 3.3 to 8.7
 * s in; he is shot down in 24, it never is, and the Ninja holds in 30. A
 * pass costs about 120 m of energy height (the hard pulls, not the dive),
 * which straight flight wins back in eight seconds, but a turner who sees me
 * reverses onto any tail shown inside 400 m 4-5 s after a pass. A turner who
 * has seen the dive keeps his eyes on me through the pass and after it; the
 * moment he has lost me rarely comes once the fight is close, so in 119 the
 * fight ends circling over or under his circle.
 */
PLANS.ascend = {
  title: 'The ascendancy', first: 'find',
  says: {
    find: 'Above him, his nose away from me: picking the moment',
    dive: 'Down on him from above with the lead: guns inside 230 m',
    zoom: 'Off him before the pass: up on the dive\'s speed, out of his plane',
    over: 'Over the top toward his side of the sky, nose coming down on him',
    beam: 'His nose is coming round onto me: across his line, out of his lead',
    climb: 'Not above him any more: climbing toward him, keeping him in front of me',
    leave: 'He has lost sight of me: leaving, full throttle, to build the height back unseen',
    back: 'Coming back with the height, my nose off him so he does not turn to meet me',
  },
  step(c) {
    const { me, him, g, mem } = c;
    const high = -g.above;
    const lookDown = Math.asin(clamp(-g.los[1])) / DEG;
    // The last moment my guns had a landing shot (the measure's: no lead
    // round his turn, the target's 5 m).
    if (g.sees && gunSolution(me, him, { ...c.gun, accel: null, width: 5 }).fire) mem.lastShot = mem.t;
    // How long I have been where his cockpit hides me, judged off his attitude.
    mem.hidFor = hiddenFrom(him, me.position) ? (mem.hidFor ?? 0) + c.dt : 0;
    if (g.range < ASC.collide && g.closure > 0 && mem.phase !== 'zoom') ascZoom(c);
    if (mem.phase === 'dive') {
      const toMerge = g.closure > 1 ? g.range / g.closure : Infinity;
      // The bottom of the pull-out from this dive: its arc, and a moment to start it.
      const dive = Math.max(0, -pitchOf(me.orientation)) * DEG;
      const bottom = high - g.mySpeed * (1 - Math.cos(dive)) - ASC.sink * Math.max(0, -me.velocity[1]) + 0.5 * Math.min(0, him.velocity[1]);
      const off = toMerge < ASC.merge || g.range < ASC.near || bottom < ASC.floor || (g.hisAta < 25 && g.range < 400)
        || (g.ata > ASC.lost && mem.since > 1.5) || mem.since > 9;
      if (!off) return { ...ascAim(c), throttle: 1, aimed: g.range < ASC.open };
      ascZoom(c);
    }
    if (mem.phase === 'zoom') {
      if (g.mySpeed > ASC.zoomEnd && mem.since < 8) {
        // A shot that comes up in the zoom is taken (the school's rule: a shot
        // that would land reads as going for it).
        return { ...pointNose(me, climbing(mem.zoomDir, ASC.zoom), { fine: 6, pull: ASC.zoomPull }), throttle: 1, aimed: true };
      }
      mem.overSide = undefined;
      go(c, 'over');
    }
    if (mem.phase === 'over') {
      if (pitchOf(me.orientation) > ASC.overDown && mem.since < 5) {
        const h = heading(me.velocity), right = [-h[2], 0, h[0]];
        if (mem.overSide === undefined) mem.overSide = Math.sign(dot(right, heading(sub(him.position, me.position)))) || 1;
        return { ...pullLift(me, add(scale(right, mem.overSide), [0, -ASC.overLift, 0]), 1), throttle: 1, aimed: true };
      }
      go(c, 'find');
    }
    // Leave when it is safe, build the height back far out, come back.
    const shot = mem.lastShot !== undefined;
    const quiet = shot && mem.t - mem.lastShot > ASC.quiet && g.range < 600;
    const spent = shot && g.myEnergy - g.hisEnergy < ASC.leaveEdge;
    if (!['leave', 'back', 'dive'].includes(mem.phase) && (quiet || spent) && mem.hidFor >= ASC.lostFor) {
      mem.leaveDir = heading(sub(me.position, him.position));
      go(c, 'leave');
    }
    if (mem.phase === 'leave') {
      if (!(g.range > ASC.far || mem.since > ASC.farFor)) {
        const el = g.range < ASC.climbFrom ? ASC.leaveClimb : clamp((g.mySpeed - 45) * 1.6, 0, 22);
        return { ...pointNose(me, climbing(mem.leaveDir, el), { fine: 6 }), throttle: 1, aimed: false };
      }
      go(c, 'back');
    }
    if (mem.phase === 'back') {
      if (g.range < ASC.rollIn && high > ASC.high && g.hisAta > 40) {
        mem.ascAim = undefined;
        go(c, 'dive');
        return { ...ascAim(c), throttle: 1, aimed: g.range < ASC.open };
      }
      if (g.range < ASC.rollIn * 0.6) go(c, 'find');
      else return { ...ascBankTo(c, ascOffLine(c, ASC.backOff), clamp((g.mySpeed - 50) * 0.6, -6, 10)), throttle: 1, aimed: false };
    }
    if (g.hisAta < ASC.nose && g.range < ASC.noseRange) {
      go(c, 'beam');
      return { ...ascBankTo(c, ascOffLine(c, ASC.beam), clamp((g.mySpeed - 50) * 0.5, -5, 6)), throttle: 1, aimed: g.range < ASC.open };
    }
    if (g.ata < ASC.diveAta && high > ASC.high && lookDown > ASC.look && g.mySpeed > ASC.diveSpeed) {
      go(c, 'dive');
      return { ...ascAim(c), throttle: 1, aimed: g.range < ASC.open };
    }
    if (high < ASC.high) {
      go(c, 'climb');
      const angle = clamp((g.mySpeed - 36) * 1.6, -5, 26);
      return { ...pointNose(me, climbing(heading(sub(him.position, me.position)), angle), { fine: 8 }), throttle: 1, aimed: g.range < ASC.open };
    }
    go(c, 'find');
    return { ...pointNose(me, sub(him.position, me.position), { fine: 10, push: 0.8 }), throttle: 1, aimed: g.range < ASC.open };
  },
};

// --- breaking the circle (features/dogfight-school, "Breaking the circle") --

/**
 * The circle's numbers: seconds, metres, m/s, degrees. Every try flies the
 * deadlock for `after` seconds first, so the theatre shows what it breaks.
 */
export const CI = {
  after: 8,         // in the circle this long before the move
  bank: 72,         // the circle's bank: a hard turn that holds its height
  onHim: 25,        // the nose onto him when he comes this close to it ...
  onHimRange: 400,  // ... inside this
  // The extension: rolled out on the circle's tangent, a shallow dive.
  dipDown: -6, dipFloor: 150,
  // The zoom: up at this until this slow, then over the top toward him.
  zoom: 60, zoomEnd: 30, overDown: -15, upFor: 6,
  // Out and back: out this long, back toward him under his height.
  outFor: 22, under: 40, fire: 260, off: 70, metAt: 600,
  // The chop: the throttle back to this speed, held in the circle.
  chopFloor: 33,
  // Nose low: the turn sinking this much (m/s), and up into him once he is
  // within `ahead` degrees of my heading and I am `aspect` round behind his,
  // seen from above, him above me. Up no longer than `upMax`, nor below
  // `upSlow`.
  sink: -5, ahead: 40, aspect: 100, upSlow: 34, upMax: 8,
};

/** How long a try circles before its move: the lesson's `CI.after`, or
 *  what its memory says (0 from a deadlock the scene is extended from,
 *  `dogfight-deadlock.js`). */
const ciAfter = mem => mem.after ?? CI.after;
/** Whether a try's moment has come: the circle flown long enough, and, for
 *  a pilot picking his moment (`mem.pick`), their nose off him, or six
 *  more seconds gone waiting for it. */
const ciReady = c => c.mem.t >= ciAfter(c.mem) && !(c.mem.pick && c.g.hisAta < 70 && c.mem.t < ciAfter(c.mem) + 6);

/** In the circle with him: the hard turn, held at the height the circle
 *  started at, the nose onto him the moment it comes near him. */
function ciCircle(c, phase = 'circle') {
  const { me, g, mem } = c;
  go(c, phase);
  if (mem.y0 === undefined) mem.y0 = me.position[1];
  if (mem.side === undefined) mem.side = mem.dir ?? 1;
  if (g.ata < CI.onHim && g.range < CI.onHimRange) return { ...leadPursuit(c), throttle: 1 };
  return { ...hardTurn(me, mem.side, { climb: clamp((mem.y0 - me.position[1]) * 0.15, -3, 4), maxBank: CI.bank }), throttle: 1 };
}

/** Where `to` lies off `from`'s heading `vel` seen from above, degrees, +
 *  to the right. */
function ciPlanOff(from, to, vel) {
  const h = heading(vel), b = heading(sub(to, from));
  return Math.atan2(dot([-h[2], 0, h[0]], b), dot(h, b)) / DEG;
}

/**
 * THE CIRCLE: two equal Spitfires half a turn apart on one circle, each
 * turning as hard as it holds its height, each after the other's tail.
 * Neither turns tighter, so neither gains: the deadlock every try below
 * starts from.
 */
PLANS.ciCircle = {
  title: 'Turning with them', first: 'circle',
  says: { circle: 'In the circle with him, half a turn apart: neither of us can bring the nose round' },
  step: c => ciCircle(c),
};

/**
 * THE EXTENSION: roll out on the circle's tangent with him across it going
 * the other way, full throttle, a shallow dive. He has half a circle to turn
 * before his nose is on you, and an equal Spitfire behind you never closes.
 * No looking back: a pilot running does not turn round to look.
 */
PLANS.ciDip = {
  title: 'Out of the circle', first: 'circle',
  says: {
    circle: PLANS.ciCircle.says.circle,
    'dip-run': 'He is across the circle going the other way: rolling out, full throttle, a shallow dive',
  },
  step(c) {
    const { me, mem } = c;
    if (mem.phase === 'circle') {
      if (!ciReady(c)) return ciCircle(c);
      mem.runDir = heading(me.velocity);
      go(c, 'dip-run');
    }
    return { ...turnToward(c, climbing(mem.runDir, c.agl > CI.dipFloor ? CI.dipDown : 0), { maxUp: 0, maxDown: 8 }), throttle: 1, aimed: false };
  },
};

/**
 * GOING VERTICAL: out of the circle straight up, the speed into height,
 * over the top toward him and down on him. Tried: he follows the climb
 * shallow and keeps his speed, and you come down into the same circle.
 */
PLANS.ciZoom = {
  title: 'Up out of the circle', first: 'circle',
  says: {
    circle: PLANS.ciCircle.says.circle,
    zoom: 'Out of the circle straight up: my speed into height',
    over: 'Over the top, toward him',
    dive: 'Down at him from above',
    up: 'Past him: back up',
    again: 'He followed me up and kept his speed: back in the circle with him',
  },
  step(c) {
    const { me, g, mem } = c;
    if (mem.phase === 'circle') {
      if (mem.t < ciAfter(mem)) return ciCircle(c);
      mem.upDir = heading(me.velocity);
      go(c, 'zoom');
    }
    if (mem.phase === 'zoom') {
      if (g.mySpeed > CI.zoomEnd) return { ...pointNose(me, climbing(mem.upDir, CI.zoom), { fine: 6 }), throttle: 1, aimed: false };
      mem.overSide = undefined;
      go(c, 'over');
    }
    if (mem.phase === 'over') {
      if (pitchOf(me.orientation) > CI.overDown) return { ...wingover(c), throttle: 1 };
      go(c, 'dive');
    }
    if (mem.phase === 'dive') {
      if (!(g.range < 60 || g.above > 10 || g.ata > 70)) return { ...leadPursuit(c, { pull: 1, push: 0.8 }), throttle: 1 };
      mem.upDir = heading(me.velocity);
      go(c, 'up');
    }
    if (mem.phase === 'up' && g.mySpeed > 40 && mem.since < CI.upFor) {
      return { ...pointNose(me, climbing(mem.upDir, 40), { fine: 6 }), throttle: 1, aimed: false };
    }
    mem.y0 = mem.phase === 'again' ? mem.y0 : me.position[1];
    return ciCircle(c, 'again');
  },
};

/**
 * OUT AND BACK: leave the circle as the extension does, run until he has
 * let you go, then turn back and come in under his tail, where his cockpit
 * hides you, for a burst. Tried: he looks round for you, sees you coming
 * and turns to meet you, and the pass is head-on. A shot that would land
 * is taken in any phase: on a head-on pass it is a snap at best.
 */
PLANS.ciBack = {
  title: 'Out, then back at them', first: 'circle',
  says: {
    circle: PLANS.ciCircle.says.circle,
    out: 'Out of the circle while he is across it: full throttle, a shallow dive',
    back: 'Clear of him: turning back to find him',
    stalk: 'Closing on him from under his tail, where he cannot see me',
    guns: 'Under his tail: nose on him, guns',
    off: 'He has turned to meet me: past him and away',
  },
  step(c) {
    const { me, g, mem } = c;
    if (mem.phase === 'circle') {
      if (mem.t < ciAfter(mem)) return ciCircle(c);
      mem.runDir = heading(me.velocity);
      go(c, 'out');
    }
    const run = () => ({ ...turnToward(c, climbing(mem.runDir, c.agl > CI.dipFloor ? CI.dipDown : 0), { maxUp: 0, maxDown: 8 }), throttle: 1 });
    if (mem.phase === 'out') {
      if (mem.since < CI.outFor) return run();
      go(c, 'back');
    }
    // He has turned to meet me: no burst from under his tail now.
    const met = g.sees && g.hisAta < 30 && g.range < CI.metAt;
    if (mem.phase === 'back') {
      if (g.ata < 40) go(c, met ? 'off' : 'stalk');
      else return { ...hardTurn(me, g.side, { climb: 0, maxBank: 75 }), throttle: 1 };
    }
    if (mem.phase === 'stalk') {
      if (met) go(c, 'off');
      else if (g.range < CI.fire) go(c, 'guns');
      else {
        const under = sub(c.him.position, [0, Math.min(CI.under, g.range * 0.12), 0]);
        return { ...pointNose(me, sub(add(under, c.him.velocity), me.position), { fine: 8 }), throttle: 1 };
      }
    }
    if (mem.phase === 'guns') {
      if (g.range < CI.off || g.ata > 60 || met) go(c, 'off');
      else return { ...leadPursuit(c), throttle: 1 };
    }
    if (mem.phase === 'off' && mem.since < c.dt) mem.runDir = heading(me.velocity);
    return run();
  },
};

/**
 * THE THROTTLE CHOP, in the circle: back to 33 m/s to turn inside him.
 * Tried: a slower Spitfire turns no tighter here, only slower, so he gains
 * on you round the circle while you sink under him.
 */
PLANS.ciChop = {
  title: 'Throttle back in the circle', first: 'circle',
  says: {
    circle: PLANS.ciCircle.says.circle,
    'flip-chop': 'Throttle back to turn inside him: he gains on me instead',
  },
  step(c) {
    const { mem, g } = c;
    if (mem.phase === 'circle' && mem.t < ciAfter(mem)) return ciCircle(c);
    const k = ciCircle(c, 'flip-chop');
    return { ...k, throttle: g.mySpeed > CI.chopFloor ? -1 : 1 };
  },
};

/**
 * REVERSING THE TURN: roll out of the circle into the opposite turn, so
 * the two of you meet. Tried: two equal Spitfires turning opposite ways
 * meet head-on every half circle, a pass with no time for a shot.
 */
PLANS.ciReverse = {
  title: 'Reversing the turn', first: 'circle',
  says: {
    circle: PLANS.ciCircle.says.circle,
    'flip-reverse': 'Reversed: turning the other way, into him',
    'flip-guns': 'Head-on: a snap at him as we pass',
  },
  step(c) {
    const { me, g, mem } = c;
    if (mem.phase === 'circle') {
      if (mem.t < ciAfter(mem)) return ciCircle(c);
      mem.side = -(mem.side ?? 1);
      go(c, 'flip-reverse');
    }
    if (g.ata < CI.onHim && g.range < CI.onHimRange && g.range > 60) { go(c, 'flip-guns'); return { ...leadPursuit(c), throttle: 1 }; }
    go(c, 'flip-reverse');
    return { ...hardTurn(me, mem.side, { climb: clamp((mem.y0 - me.position[1]) * 0.15, -3, 4), maxBank: CI.bank }), throttle: 1 };
  },
};

/**
 * NOSE LOW: the circle flown sinking. The engine's gravity adds speed, and
 * a faster Spitfire turns faster at the same radius, so you gain on him
 * round the circle; seen from above you come round behind him, under his
 * wing where he cannot see you. Then up into him. Tried: the angle costs
 * 100 m of height, and the climb back to him costs the speed: a snap from
 * below, a few rounds, then he sees you.
 */
PLANS.ciLow = {
  title: 'Nose low in the circle', first: 'circle',
  says: {
    circle: PLANS.ciCircle.says.circle,
    'flip-low': 'Nose low in the turn: gravity adds speed, and speed turns me faster than him',
    'flip-up': 'Round behind him and under him: up into him, guns',
    'flip-off': 'Out of speed under him: back into the turn',
  },
  step(c) {
    const { me, him, g, mem } = c;
    if (mem.phase === 'circle') {
      if (mem.t < ciAfter(mem)) return ciCircle(c);
      go(c, 'flip-low');
    }
    if (mem.phase === 'flip-low') {
      // He is ahead of my turn, and I am round behind his, seen from above.
      const ahead = Math.abs(ciPlanOff(me.position, him.position, me.velocity)) < CI.ahead;
      const behind = Math.abs(ciPlanOff(him.position, me.position, him.velocity)) > CI.aspect;
      if (ahead && behind && g.above > 0) go(c, 'flip-up');
      else return { ...hardTurn(me, mem.side, { climb: c.agl > CI.dipFloor ? CI.sink : 0, maxBank: 85 }), throttle: 1 };
    }
    if (mem.phase === 'flip-up') {
      // Past him (his nose no longer anywhere near mine once the pull has had a second).
      if (!(g.mySpeed < CI.upSlow || (mem.since > 1 && g.ata > 70) || g.range < 40 || mem.since > CI.upMax)) {
        return { ...leadPursuit(c, { pull: 1, push: 0.6 }), throttle: 1 };
      }
      go(c, 'flip-off');
    }
    if (mem.since > 2) go(c, 'flip-low');
    return { ...hardTurn(me, mem.side, { climb: 0, maxBank: 75 }), throttle: 1 };
  },
};
