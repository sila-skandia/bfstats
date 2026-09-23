// A replayed soldier's gait rig: the per-instance mixer over the pose pair's
// stance clip and the shared gait clips, posed as a pure function of the
// replay clock. Fetching the clips is the loaders' job, not this one's.

import * as THREE from 'three';
import { selectGait } from './gait-select.js';

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
// 6) never reaches the viewer: extract_pose.py's gait export writes only
// state/clip/speed/frames/period per gait into extras (checked directly
// against the live lower.gait.glb), not random_start or morph_factor, and
// adding it means extending that extractor and bf42/gltf.py's extras writer
// -- real pipeline work, not a viewer-side fix. Falls back to a per-life
// pseudo-random phase seeded off the soldier's network id, stable for the
// life's whole duration and already on hand.
export function phaseFor(nid) {
  const x = Math.sin(nid * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

// Same investigate-then-fall-back call for the transition itself: the
// engine's setMorphFactor / State.morph_factor (also already parsed by
// bf42/animstates.py) is equally absent from the gait extras, so a real
// per-state crossfade rate isn't reachable either. A fixed fade, short
// against both gait periods (run 0.625 s/cycle, walk 1.0 s/cycle), stands in.
const CROSSFADE_DURATION = 0.2;   // seconds

// Builds the per-instance animation rig on a freshly skeletonClone()'d pose
// scene: one mixer, the pose's own `stand` stance clip for idle, and
// whichever of walk/run resolved a complete lower+upper pair. Actions are
// created once, played and parked at weight 0 -- same shape as poses.html's
// stance/gait actions -- then driven every frame by setGaitPose() below,
// never through mixer.update(dt): the replay clock is the single source of
// truth (round-replay-capture README section 12, "seeking is only setting
// it"), so each action's .time is set as a pure function of the recording
// time, not accumulated from frame deltas.
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
  return { mixer, actions, phase, currentGait: 'idle', fadeFrom: null, fadeStart: null };
}

// Advances one soldier's gait mixer to the pose for absolute replay time
// `t`. Every quantity here is a pure function of `t` (and the entity's
// fixed phase offset) except which gait is "current" and when the last
// change happened, which is unavoidable for a crossfade -- blending FROM
// something needs to remember what that was. A seek that jumps back across
// an old transition can therefore replay a stale 200 ms fade; harmless and
// not worth the bookkeeping a fully stateless crossfade would need, since
// continuous playback (the common case) is exactly right.
export function setGaitPose(entity, t) {
  const { anim, life } = entity;
  let desired = selectGait(life, t).gait;
  if (desired === 'run' && !anim.actions.runLower) desired = 'walk';
  if (desired === 'walk' && !anim.actions.walkLower) desired = 'idle';

  if (desired !== anim.currentGait) {
    anim.fadeFrom = anim.currentGait;
    anim.fadeStart = t;
    anim.currentGait = desired;
  }
  const elapsed = anim.fadeFrom !== null ? t - anim.fadeStart : -Infinity;
  const fading = elapsed >= 0 && elapsed < CROSSFADE_DURATION;
  const k = fading ? elapsed / CROSSFADE_DURATION : 1;
  const weights = { idle: 0, walk: 0, run: 0 };
  weights[anim.currentGait] = k;
  if (fading) weights[anim.fadeFrom] += 1 - k;
  else anim.fadeFrom = null;

  const setHalf = (lowerAction, upperAction, weight) => {
    if (!lowerAction) return;
    if (weight <= 0) { lowerAction.setEffectiveWeight(0); upperAction.setEffectiveWeight(0); return; }
    const lowerPeriod = lowerAction.getClip().duration;
    const upperPeriod = upperAction.getClip().duration;
    lowerAction.time = (t + anim.phase * lowerPeriod) % lowerPeriod;
    upperAction.time = (t + anim.phase * upperPeriod) % upperPeriod;
    lowerAction.setEffectiveWeight(weight);
    upperAction.setEffectiveWeight(weight);
  };
  setHalf(anim.actions.runLower, anim.actions.runUpper, weights.run);
  setHalf(anim.actions.walkLower, anim.actions.walkUpper, weights.walk);
  if (anim.actions.stand) anim.actions.stand.setEffectiveWeight(weights.idle);
  anim.mixer.update(0);
}
