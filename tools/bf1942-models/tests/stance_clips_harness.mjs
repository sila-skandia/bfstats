// Drives `viewer/stance-clips.js` outside a browser and prints one JSON blob.
//
// The chains are the engine's declared upper-body families, so the assertions
// worth making here are the ones a reconstruction gets wrong: that a
// stationary crouched soldier resolves to the crouch family even though his
// `gait` reads 'stand', that crouch has no fire/reload/run family of its own,
// and that a rig missing the stance clips lands exactly where the page landed
// before they existed.

import {
  STANCE_CHAINS, fireVariantsFor, locoClip, locoRole, normaliseStance,
  stanceClip, stanceFor,
} from './stance-clips.js';

const FULL = new Set(['idle', 'walk', 'run', 'fire', 'reload', 'deploy',
  'crouch', 'crouchWalk', 'prone', 'crawl',
  'proneFire', 'proneReload', 'crouchDeploy', 'proneDeploy']);
const OLD = new Set(['idle', 'walk', 'run', 'fire', 'reload', 'deploy']);
const full = name => FULL.has(name);
const old = name => OLD.has(name);

const out = {};

// `soldier.js` answers 'stand' for any stationary soldier, whatever his
// stance. That is why the stance has to come in beside the gait.
out.stationary = {
  stand: locoClip('stand', 'stand', full),
  crouch: locoClip('stand', 'crouch', full),
  prone: locoClip('stand', 'prone', full),
};

out.moving = {
  walk: locoClip('walk', 'stand', full),
  run: locoClip('run', 'stand', full),
  crouch: locoClip('crouch', 'crouch', full),
  prone: locoClip('prone', 'prone', full),
  // A crouched run: the data declares no crouch-run state.
  crouchRun: locoClip('run', 'crouch', full),
};

out.actions = {
  fireStand: stanceClip('fire', 'stand', full),
  fireCrouch: stanceClip('fire', 'crouch', full),
  fireProne: stanceClip('fire', 'prone', full),
  reloadCrouch: stanceClip('reload', 'crouch', full),
  reloadProne: stanceClip('reload', 'prone', full),
  deployCrouch: stanceClip('deploy', 'crouch', full),
  deployProne: stanceClip('deploy', 'prone', full),
};

// A rig published before the stance families were baked.
out.oldRig = {
  crouchIdle: locoClip('stand', 'crouch', old),
  proneIdle: locoClip('stand', 'prone', old),
  crouchMove: locoClip('crouch', 'crouch', old),
  proneMove: locoClip('prone', 'prone', old),
  fireProne: stanceClip('fire', 'prone', old),
  reloadProne: stanceClip('reload', 'prone', old),
  deployProne: stanceClip('deploy', 'prone', old),
};

// No `has` at all: what the stance owes, not what a file carries.
out.noRig = {
  crouchIdle: locoClip('stand', 'crouch', null),
  proneMove: locoClip('prone', 'prone', undefined),
};

out.roles = {
  stand: locoRole('stand'), walk: locoRole('walk'), run: locoRole('run'),
  crouch: locoRole('crouch'), prone: locoRole('prone'),
  nothing: locoRole(undefined),
};

out.stance = {
  gaitWins: stanceFor('prone', 'stand'),
  reportedUsed: stanceFor('stand', 'crouch'),
  junk: stanceFor('stand', 'kneeling'),
  normalised: normaliseStance(null),
};

out.variants = {
  fire: fireVariantsFor('fire', ['idle', 'fire', 'fire2', 'fire10', 'fire1',
                                 'proneFire1', 'fireEnd']),
  prone: fireVariantsFor('proneFire', ['proneFire', 'proneFire2', 'proneFire1',
                                       'fire1']),
  none: fireVariantsFor('fire', ['idle', 'walk']),
};

// Every chain must end on a family the very first viewmodel export carried,
// so no chain can resolve to a clip an old rig lacks.
out.chainTails = {};
for (const [role, byStance] of Object.entries(STANCE_CHAINS)) {
  for (const [stance, chain] of Object.entries(byStance)) {
    out.chainTails[`${role}.${stance}`] = chain[chain.length - 1];
  }
}

// The chains themselves, for the two families the data does NOT declare.
// Resolving them through `has` is not enough: an invented `crouchFire` or
// `crouchRun` entry that no rig carries still resolves to the standing clip,
// so the chain would drift while every resolution test stayed green.
out.chains = {
  fireCrouch: [...STANCE_CHAINS.fire.crouch],
  reloadCrouch: [...STANCE_CHAINS.reload.crouch],
  runCrouch: [...STANCE_CHAINS.run.crouch],
  walkCrouch: [...STANCE_CHAINS.walk.crouch],
};

// An unknown role has no chain and says so rather than inventing one.
out.unknownRole = stanceClip('somersault', 'prone', full);

console.log(JSON.stringify(out));
