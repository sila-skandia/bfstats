// A replayed soldier's gait rig: the per-instance mixer over the pose pair's
// stance clip and the shared gait clips, posed from the replay clock, and the
// engine's morph carrying each half-body from one gait into the next. Fetching
// the clips is the loaders' job, not this one's.

import * as THREE from 'three';
import { selectGait } from './gait-select.js';
import { FAMILY_HALVES, MORPH_CUT, MorphBlend, stateInfo, stateMorph } from './soldier-actions.js';
import { trackNodes } from './clip-nodes.js';

// Gait selection (idle/walk/run) is `gait-select.js`'s job: ground speed and
// heading (forward/strafe/backward) from the life's own recorded samples,
// with hysteresis so a noisy single tick can't flip the animation. See that
// module's header and features/soldier-locomotion-animation/README.md for
// why a heading-aware threshold is necessary, not just a nicety -- a
// standing strafe measures almost exactly on top of a naive forward-only
// walk/run boundary.

// Phase-offset each soldier so a squad doesn't move in lockstep. The engine's
// own primitive (setUserRandomStartTime / State.random_start, already parsed
// by bf42/animstates.py -- see soldier-locomotion-animation/README.md section
// 6) never reaches the viewer: extract_pose.py's `state_meta` writes each
// clip's state, rate, loop, morph and follow-on state into the bundles'
// `extras.states`, but not random_start (checked against lower.gait.glb,
// 2026-09-29), and adding it is an extractor change and a re-bake of the
// bundles, not a viewer-side fix. Falls back to a per-life pseudo-random phase
// seeded off the soldier's network id, stable for the life's whole duration
// and already on hand.
export function phaseFor(nid) {
  const x = Math.sin(nid * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

// THE MORPH. A gait change enters each half-body's new state as the engine and
// the bots' bodies do (bot-visuals.js `buildHalfBodyRig`): the new clip at full
// weight at once, and the half's bones carried from wherever they stood toward
// it by `MorphBlend` (soldier-actions.js), whose weight starts at 0 and gains
// `dt x morph` a second (ledger ANIM-4): a morph of m puts the half on its new
// clip 1/m seconds after the change. The morph is each half's state's own
// `setMorphFactor`, from the gait bundles' `extras.states` (on each clip as
// `userData`, replay-assets.js `gaitBundle`): into a walk or a run, the legs
// 2.0 (0.5 s) and the torso 0.5 (2 s); to a stand, `Lb_Stand` 2.0 and
// `Ub_StandAim` 0.7 (1.4 s), whichever clip draws it (here the pose pair's
// `stand`). Bundles that predate the states get the vanilla scripts' same
// numbers (`stateInfo`). The fixed 0.2 s this rig used to fade every change
// over is left only as the fallback for a state with no morph: the engine's
// constructor default, 5.0 a second (`stateMorph`), is that 0.2 s.
const GAIT_FAMILY = Object.freeze({ idle: 'stand', walk: 'walk', run: 'run' });

// Builds the per-instance animation rig on a freshly skeletonClone()'d pose
// scene: one mixer, the pose's own `stand` stance clip for idle, and
// whichever of walk/run resolved a complete lower+upper pair. Actions are
// created once, played and parked at weight 0 -- same shape as poses.html's
// stance/gait actions -- then driven every frame by setGaitPose() below,
// never through mixer.update(dt): the replay clock is the single source of
// truth (round-replay-capture README section 12, "seeking is only setting
// it"), so each action's .time is set as a pure function of the recording
// time, not accumulated from frame deltas. Beside them, one `MorphBlend` per
// half over the bones that half's clips drive, and the morph each half
// enters each gait with.
export function buildGaitRig(scene, poseClips, gaitClips, phase) {
  const mixer = new THREE.AnimationMixer(scene);
  const action = name => {
    const clip = THREE.AnimationClip.findByName(name === 'stand' ? poseClips : gaitClips, name);
    if (!clip) return null;
    const a = mixer.clipAction(clip);
    a.setLoop(THREE.LoopRepeat, Infinity);
    a.play();
    a.setEffectiveWeight(0);
    a.paused = true;   // time is set explicitly from the replay clock, below
    return a;
  };
  const actions = {
    stand: action('stand'),
    runLower: action('run.lower'), runUpper: action('run.upper'),
    walkLower: action('walk.lower'), walkUpper: action('walk.upper'),
  };
  // A gait only counts when both halves resolved: half a body running
  // while the other holds still is worse than not running at all.
  if (!actions.runLower || !actions.runUpper) actions.runLower = actions.runUpper = null;
  if (!actions.walkLower || !actions.walkUpper) actions.walkLower = actions.walkUpper = null;

  const morphs = {};
  const halfClips = { lower: [], upper: [] };
  for (const [gait, family] of Object.entries(GAIT_FAMILY)) {
    morphs[gait] = {};
    for (const half of ['lower', 'upper']) {
      const name = FAMILY_HALVES[family][half];
      const clip = THREE.AnimationClip.findByName(gaitClips, name);
      morphs[gait][half] = stateMorph(stateInfo(clip, name));
      if (clip) halfClips[half].push(clip);
    }
  }
  // The bones each half's clips drive: the legs' 11 and the torso's 44 on the
  // published tree, which are exactly the bones the pose pair's `stand` drives.
  const halves = {
    lower: new MorphBlend(trackNodes(scene, ...halfClips.lower)),
    upper: new MorphBlend(trackNodes(scene, ...halfClips.upper)),
  };
  return { mixer, actions, phase, halves, morphs, currentGait: 'idle', lastT: null };
}

// Poses one soldier's gait rig at absolute replay time `t`. The clips' times
// are a pure function of `t` (and the entity's fixed phase offset); the morph
// cannot be, since it starts from the bones as they stood when the gait
// changed, so the rig keeps the time it last posed and steps the morph by the
// clock's own advance, as the map's replay bodies do. A clock that has not
// moved (paused) poses nothing and the bones hold still; a first pose, and
// the first after `snapGait` (a seek, or a frame he was not drawn), cut
// straight to the gait at `t` rather than morphing across the jump.
export function setGaitPose(entity, t) {
  const { anim, life } = entity;
  const dt = anim.lastT === null ? null : t - anim.lastT;
  if (dt === 0) return;
  anim.lastT = t;
  let desired = selectGait(life, t).gait;
  if (desired === 'run' && !anim.actions.runLower) desired = 'walk';
  if (desired === 'walk' && !anim.actions.walkLower) desired = 'idle';

  // The bots' order (bot-visuals.js `step`): the mixer's own pose back on the
  // bones a morph drew over (`MorphBlend.restore`: three writes a bone only
  // when its value changes, so one a clip holds still would keep the morph's
  // last frame), the entries, the mixer, the morph.
  const { lower, upper } = anim.halves;
  lower.restore();
  upper.restore();
  if (!(dt > 0)) {
    anim.currentGait = desired;
    lower.enter(MORPH_CUT);
    upper.enter(MORPH_CUT);
  } else if (desired !== anim.currentGait) {
    anim.currentGait = desired;
    lower.enter(anim.morphs[desired].lower);
    upper.enter(anim.morphs[desired].upper);
  }

  // The current gait's clips at full weight and the rest at none: the engine
  // drops the parked clip whenever the new state has one (ANIM-4), so the
  // blend is the morph's, never two clips'.
  const setPair = (lowerAction, upperAction, on) => {
    if (!lowerAction) return;
    if (!on) { lowerAction.setEffectiveWeight(0); upperAction.setEffectiveWeight(0); return; }
    const lowerPeriod = lowerAction.getClip().duration;
    const upperPeriod = upperAction.getClip().duration;
    lowerAction.time = (t + anim.phase * lowerPeriod) % lowerPeriod;
    upperAction.time = (t + anim.phase * upperPeriod) % upperPeriod;
    lowerAction.setEffectiveWeight(1);
    upperAction.setEffectiveWeight(1);
  };
  setPair(anim.actions.runLower, anim.actions.runUpper, anim.currentGait === 'run');
  setPair(anim.actions.walkLower, anim.actions.walkUpper, anim.currentGait === 'walk');
  if (anim.actions.stand) anim.actions.stand.setEffectiveWeight(anim.currentGait === 'idle' ? 1 : 0);
  anim.mixer.update(0);
  const step = dt > 0 ? dt : 0;
  lower.update(step);
  upper.update(step);
}

// The soldier's next pose cuts to his gait at its instant instead of morphing:
// after a seek, or a frame he was not drawn, there is no pose on screen to
// morph from.
export function snapGait(anim) {
  if (anim) anim.lastT = null;
}
