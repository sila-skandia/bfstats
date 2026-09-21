// Drives `viewer/soldier-body.js` outside a browser and prints one JSON blob.
//
// Same shape as the other harnesses here: `tests/test_soldier_body.py` copies
// the viewer modules in under their own names, so the files under test are the
// files the page loads, byte for byte. `soldier-body.js` imports nothing;
// `parachute.js` is copied in beside it so the assertion that the two tables
// agree is made against the real `PARA_CLIPS`, not a transcription of it.

import {
  BODY_CLIPS, BODY_ONCE, BODY_FALLBACKS, UPPER_STAND_AIM, LOWER_STAND,
  bodyClipFamily, bodyFamily, canopyClip, locoFamily, parachuteFamily,
  resolveBodyFamily,
} from './soldier-body.js';
import { PARA_CLIPS } from './parachute.js';

const results = {};

results.families = Object.keys(BODY_CLIPS);
results.clips = BODY_CLIPS;
results.once = [...BODY_ONCE];
results.standAim = UPPER_STAND_AIM;
results.standLower = LOWER_STAND;

// Every family names both halves, and every fallback chain ends at `stand`.
results.everyFamilyHasBothHalves = Object.values(BODY_CLIPS)
  .every(spec => typeof spec.lower === 'string' && typeof spec.upper === 'string');
results.everyChainEndsAtStand = Object.values(BODY_FALLBACKS)
  .every(chain => chain[chain.length - 1] === 'stand');
results.everyChainStartsWithItself = Object.entries(BODY_FALLBACKS)
  .every(([family, chain]) => chain[0] === family);
results.everyFamilyHasAChain = Object.keys(BODY_CLIPS)
  .every(family => Array.isArray(BODY_FALLBACKS[family]));

// The parachute half is keyed off `parachute.js`'s own table, so the two
// cannot drift. Every pair PARA_CLIPS can answer must resolve to a family.
results.paraPairs = Object.fromEntries(
  Object.entries(PARA_CLIPS).map(([key, pair]) => [key, parachuteFamily(pair)]));
results.paraUnknown = parachuteFamily({ lower: 'Lb_NoSuchState' });
results.paraNull = parachuteFamily(null);
results.paraCaseInsensitive = parachuteFamily({ lower: 'lb_parachuteIDLE' });
// The engine's glide torso, straight out of PARA_CLIPS.
results.glideUpperState = PARA_CLIPS.glide.upper;
results.glideBakedUpper = BODY_CLIPS.parachuteGlide.upper;

// `soldier.gait` against `soldier.stance`: the trap is that a stationary
// crouched man reads gait 'stand'.
results.loco = {
  standing: locoFamily('stand', 'stand'),
  walking: locoFamily('walk', 'stand'),
  running: locoFamily('run', 'stand'),
  crouchedStill: locoFamily('stand', 'crouch'),
  crouchedMoving: locoFamily('crouch', 'crouch'),
  proneStill: locoFamily('stand', 'prone'),
  proneMoving: locoFamily('prone', 'prone'),
  // A gait that proves its own posture wins over a disagreeing stance.
  crouchGaitStandStance: locoFamily('crouch', 'stand'),
  proneGaitStandStance: locoFamily('prone', 'stand'),
  garbage: locoFamily(undefined, undefined),
};

// The parachute outranks the gait: a man under a canopy is not also running.
results.parachuteWinsOverGait = bodyFamily({
  gait: 'run', stance: 'stand', parachute: PARA_CLIPS.glide,
});
results.noParachuteFallsThrough = bodyFamily({ gait: 'run', stance: 'stand' });
results.emptyState = bodyFamily({});

// Fallbacks against what a rig bound.
const only = (...names) => (family => names.includes(family));
results.fallback = {
  crawlToProne: resolveBodyFamily('crawl', only('prone', 'stand')),
  crawlToWalk: resolveBodyFamily('crawl', only('walk', 'stand')),
  crouchwalkToCrouch: resolveBodyFamily('crouchwalk', only('crouch', 'stand')),
  runToWalk: resolveBodyFamily('run', only('walk', 'stand')),
  // A tree published before parachute.gait.glb existed.
  glideWithoutBundle: resolveBodyFamily('parachuteGlide', only('stand')),
  openWithoutBundle: resolveBodyFamily('parachuteOpen', only('stand')),
  openWithGlideOnly: resolveBodyFamily('parachuteOpen',
    only('parachuteGlide', 'stand')),
  deadLandedToLanded: resolveBodyFamily('parachuteDeadLanded',
    only('parachuteLanded', 'stand')),
  nothingBound: resolveBodyFamily('crawl', () => false),
  noPredicate: resolveBodyFamily('crawl'),
  unknownFamily: resolveBodyFamily('nonsense', only('stand')),
};

results.endToEnd = {
  glideOnAFullRig: bodyClipFamily(
    { gait: 'run', parachute: PARA_CLIPS.glide }, () => true),
  glideOnAnOldRig: bodyClipFamily(
    { gait: 'run', parachute: PARA_CLIPS.glide }, only('stand', 'run', 'walk')),
  crouchedStillOnAFullRig: bodyClipFamily(
    { gait: 'stand', stance: 'crouch' }, () => true),
};

// The canopy: shown while the chute carries him, hidden in free fall.
results.canopy = {
  fall: canopyClip('parachuteFall'),
  open: canopyClip('parachuteOpen'),
  glide: canopyClip('parachuteGlide'),
  landed: canopyClip('parachuteLanded'),
  die: canopyClip('parachuteDie'),
  deadLanded: canopyClip('parachuteDeadLanded'),
  run: canopyClip('run'),
  stand: canopyClip('stand'),
};

console.log(JSON.stringify(results, null, 1));
