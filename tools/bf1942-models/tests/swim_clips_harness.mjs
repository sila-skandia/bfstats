// Drives the swim clip selection outside a browser and prints one JSON blob:
// `swim.js`'s `SwimState` choosing the engine's swim state off the throttle,
// `soldier-actions.js` holding both half-bodies in it (the bots' body),
// `remote-gait.js` choosing it for a remote, `netcode.js` carrying it, and
// `swim.js` `switchFamily` morphing a whole-body rig into and out of it.
// `tests/test_swim_clips.py` copies the modules in under their own names, so
// the files under test are the files the page loads.

import {
  SWIM_CLIPS, SWIM_ENTER_DEPTH, SWIM_START_SECONDS, SWIM_END_SECONDS,
  SwimState, swimFamilyOfPair, swimMorphSeconds, switchFamily,
} from './swim.js';
import { FAMILY_HALVES, SoldierActions, VANILLA_STATES } from './soldier-actions.js';
import { remoteClipFamily } from './remote-gait.js';
import { SWIM_WIRE, decodeSnapshot, encodeSnapshot, swimWireCode } from './netcode.js';

const results = {};
const DT = 1 / 30;

/** A half-body rig as the published tree binds it: the gait halves, and the
 *  swim bundle unless `swim` is false. */
function rig({ swim = true } = {}) {
  const bound = new Set();
  for (const f of Object.values(FAMILY_HALVES)) { bound.add(f.lower); bound.add(f.upper); }
  bound.add('Ub_Fire');
  bound.add('Ub_StandReload');
  if (swim) {
    for (const pair of Object.values(SWIM_CLIPS)) { bound.add(pair.lower); bound.add(pair.upper); }
  }
  return {
    has: name => bound.has(name),
    info: name => VANILLA_STATES[name] ?? null,
    duration: name => {
      const s = VANILLA_STATES[name]?.speed;
      return Number.isFinite(s) && s !== 0 ? 1 / Math.abs(s) : 1;
    },
  };
}

/**
 * A soldier walked into deep water, one sim tick at a time: the depth and the
 * throttle per tick come from `script(t)`, `SwimState` runs the engine's
 * machine, and its clip pair drives `SoldierActions` the way `bot-visuals.js`
 * does. Every state either half enters is logged with its time and morph.
 */
function wade(script, seconds, opts = {}) {
  const swim = new SwimState();
  const actions = new SoldierActions(rig(opts));
  const log = [];
  const families = [];
  let t = 0;
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    t += DT;
    const { depth, throttle } = script(t);
    swim.update({ dt: DT, surfaceY: 10, feetY: 10 - depth, throttle });
    const pair = swim.clips(false);
    families.push(swim.family);
    const entered = actions.update({ stance: 'stand', family: throttle ? 'walk' : 'stand',
                                     swim: pair }, DT);
    // The events the page sends between frames: a round, a reload, a stance
    // change the tick caught -- every one of them while he swims.
    if (swim.swimming && swim.family !== 'swimEnd') {
      if (opts.fire) actions.fire();
      if (opts.reload) actions.reload();
      if (opts.crouch && Math.abs(t - opts.crouch) < DT / 2) {
        actions.stanceChanged('stand', 'crouch');
      }
    }
    for (const e of [...entered, ...actions.update({ swim: pair,
                                                     family: throttle ? 'walk' : 'stand' }, 0)]) {
      log.push({ t: +t.toFixed(3), half: e.half, name: e.name, morph: e.morph });
    }
  }
  return { log, families: [...new Set(families)], swimming: swim.swimming,
           lower: actions.lower.name, upper: actions.upper.name };
}

// In at a walk, stroke on, let go of the key, back-pedal, a half-press, then
// out onto the beach.
const DEEP = SWIM_ENTER_DEPTH + 0.5;
const course = t => {
  if (t < 0.5) return { depth: 0, throttle: 1 };
  if (t < 2.0) return { depth: DEEP, throttle: 1 };
  if (t < 3.0) return { depth: DEEP, throttle: 0 };
  if (t < 4.0) return { depth: DEEP, throttle: -1 };
  if (t < 5.0) return { depth: DEEP, throttle: 0.4 };
  return { depth: 0.1, throttle: 1 };
};
results.course = wade(course, 6.0);
results.courseNoFire = wade(course, 6.0, { fire: true, reload: true, crouch: 2.5 });
results.unbound = wade(course, 6.0, { swim: false });
results.startSeconds = SWIM_START_SECONDS;
results.endSeconds = SWIM_END_SECONDS;

// The family a pair is.
results.familyOfPair = Object.fromEntries(Object.entries(SWIM_CLIPS)
  .map(([family, pair]) => [family, swimFamilyOfPair(pair)]));
results.familyOfNull = swimFamilyOfPair(null);

// The morph as a cross-fade, and the switch that applies it.
results.morph = {
  into: swimMorphSeconds('walk', 'swimStart'),
  stroke: swimMorphSeconds('swimFloat', 'swimForward'),
  exit: swimMorphSeconds('swimForward', 'swimEnd'),
  out: swimMorphSeconds('swimEnd', 'stand'),
  die: swimMorphSeconds('swimFloat', 'swimDie'),
  dry: swimMorphSeconds('walk', 'run'),
  fresh: swimMorphSeconds(null, 'swimFloat'),
};

function fakeAction(name) {
  const a = { name, weight: 0, fade: null, resets: 0, playing: false, paused: true };
  a.reset = () => { a.resets++; return a; };
  a.play = () => { a.playing = true; return a; };
  a.setEffectiveWeight = w => { a.weight = w; a.fade = null; return a; };
  a.fadeIn = d => { a.fade = ['in', d]; return a; };
  a.fadeOut = d => { a.fade = ['out', d]; return a; };
  return a;
}
function fakeFamilies() {
  const out = {};
  for (const f of ['stand', 'walk', 'swimFloat', 'swimForward']) {
    out[f] = [fakeAction(`${f}.lower`), fakeAction(`${f}.upper`)];
  }
  return out;
}
const snap = families => Object.fromEntries(Object.entries(families).map(([f, acts]) =>
  [f, acts.map(a => ({ weight: a.weight, fade: a.fade, resets: a.resets }))]));
{
  const fam = fakeFamilies();
  switchFamily(fam, null, 'walk');
  results.switchFresh = snap(fam);
  switchFamily(fam, 'walk', 'swimFloat');
  results.switchInto = snap(fam);
  switchFamily(fam, 'swimFloat', 'swimForward');
  results.switchStroke = snap(fam);
  switchFamily(fam, 'swimForward', 'stand');
  results.switchOut = snap(fam);
  switchFamily(fam, 'stand', 'walk');
  results.switchDry = snap(fam);
}

// A remote: the snapshot's swim state outranks his measured speed; a family
// his rig did not bind falls back to the tread, and past that to the gait.
const all = () => true;
const noSwim = f => !f.startsWith('swim');
const floatOnly = f => !f.startsWith('swim') || f === 'swimFloat';
results.remote = {
  forward: remoteClipFamily(2.0, {}, all, 'swimForward'),
  float: remoteClipFamily(0, {}, all, 'swimFloat'),
  backward: remoteClipFamily(2.0, { crouch: true }, all, 'swimBackward'),
  fallbackFloat: remoteClipFamily(2.0, {}, floatOnly, 'swimForward'),
  unbound: remoteClipFamily(2.0, {}, noSwim, 'swimForward'),
  dry: remoteClipFamily(6.0, {}, all, null),
  unknown: remoteClipFamily(0, {}, all, 'swimSideways'),
};

// The wire: every state round-trips in the flag byte's spare bits, beside the
// other flags, and without changing the record's size.
const player = (swim, extra = {}) => ({
  slot: 3, alive: true, seated: false, crouch: false, prone: false, inVehicle: false,
  team: 2, x: 1, y: 2, z: 3, yaw: 0, pitch: 0, hp: 30, vehicleId: 0, seatIndex: null,
  ack: 7, swim, ...extra,
});
results.wire = {
  table: SWIM_WIRE,
  codes: Object.fromEntries(Object.keys(SWIM_CLIPS).map(f => [f, swimWireCode(f)])),
  roundTrip: Object.fromEntries([null, ...SWIM_WIRE.slice(1)].map(f => {
    const p = decodeSnapshot(encodeSnapshot(9, [player(f, { crouch: true })], [])).players[0];
    return [String(f), { swim: p.swim, crouch: p.crouch, alive: p.alive, prone: p.prone }];
  })),
  bytesDry: encodeSnapshot(9, [player(null)], []).length,
  bytesSwim: encodeSnapshot(9, [player('swimForward')], []).length,
};

console.log(JSON.stringify(results));
