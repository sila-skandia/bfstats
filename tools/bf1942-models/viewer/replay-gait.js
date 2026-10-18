// A replayed soldier's gait rig: the per-instance mixer over the pose pair's
// stance clip and the shared gait clips, posed from the replay clock, and the
// engine's morph carrying each half-body from one gait into the next. Fetching
// the clips is the loaders' job, not this one's.

import * as THREE from 'three';
import { selectGait } from './gait-select.js';
import { replayGait } from './remote-gait.js';
import { FAMILY_HALVES, MORPH_CUT, MorphBlend, stateInfo, stateMorph } from './soldier-actions.js';
import { trackNodes } from './clip-nodes.js';
import { AIM_TWIST_SCALE } from './replay-recording.js';

// The torso's own root. `lower.gait.glb`'s clips drive it -- it is one of the
// legs' eleven -- and every one of the torso's 44 bones hangs below it, so
// turning it turns the torso and leaves the feet planted. That is what a twist
// is: `BFSoldier` turns the upper body toward the aim and only drags the legs
// round when it runs out of travel.
export const TORSO_ROOT_BONE = 'Spine Root';

// A recorded degree of twist is this many degrees of turn, the same constant
// and the same sign the camera uses (`replay-camera.js` TWIST). Positive here
// because the viewer's frame negates BF1942's z.
const TWIST = AIM_TWIST_SCALE * Math.PI / 180;

const _axis = new THREE.Vector3();
const _bodyQ = new THREE.Quaternion();
const _parentQ = new THREE.Quaternion();
const _twistQ = new THREE.Quaternion();
const _UP = new THREE.Vector3(0, 1, 0);

/**
 * Turn the torso to where he is actually aiming.
 *
 * His rounds leave along his body turned by `AIM_TWIST_SCALE` times the
 * recorded twist (`replay-recording.js`), and the camera is built on exactly
 * that (`viewQuaternion`). The drawn body was not: it took the sample
 * quaternion alone, so a man firing across himself stood square while his
 * rounds left at an angle. Measured on replay_20261018-233939 at 1:54-1:56,
 * eight rounds of an M1A1 carbine: his sample yaw held at -18.19 degrees for
 * the whole burst while the rounds tracked the target, and `shot - body` came
 * to -2.99 +- 0.03 times the recorded twist, 21 to 23 degrees of it.
 *
 * About the BODY's up rather than the world's, which is `viewQuaternion`'s own
 * rule: a man lying on a slope lies along it and twists about that.
 *
 * three's `PropertyMixer` writes a bone only when its value changed since it
 * last wrote it, so on a frame the clip holds the torso still nothing rewrites
 * it -- and a turn applied on top of the previous frame's would compound into a
 * spin. Hence the base pose is cached and only refreshed when the bone is not
 * what this function last left there.
 */
function twistTorso(entity, body) {
  const { anim } = entity;
  const bone = anim.torso;
  if (!bone) return;
  const held = anim.twist;
  if (!held.has || !bone.quaternion.equals(held.applied)) {
    held.base.copy(bone.quaternion);
    held.has = true;
  }
  bone.quaternion.copy(held.base);
  const yaw = (body?.twist ?? 0) * TWIST;
  if (yaw) {
    _axis.copy(_UP);
    if (entity.group) _axis.applyQuaternion(entity.group.getWorldQuaternion(_bodyQ));
    if (bone.parent) _axis.applyQuaternion(bone.parent.getWorldQuaternion(_parentQ).invert());
    bone.quaternion.premultiply(_twistQ.setFromAxisAngle(_axis.normalize(), yaw));
  }
  held.applied.copy(bone.quaternion);
}

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
// Every family the bundles carry, not the three a speed guess could name.
// `gait-select.js` returns idle/walk/run and says why in its own header: it
// was written when the recorder captured no stance, so there was nothing to
// pick a crouch or a prone with. The recorder writes the engine's own lower
// state now (bf42plus `st`, and the state table it needs to be read through),
// so the other four are reachable -- and were sitting unbound in the bundles
// while a crouching man drew standing and a crawling one slid.
// `idle` keeps its name: it is the standing-still family and the pose pair's
// own `stand` clip draws it, from poseClips rather than the gait bundle.
const GAIT_FAMILY = Object.freeze({
  idle: 'stand',
  walk: 'walk',
  run: 'run',
  crouch: 'crouch',
  crouchwalk: 'crouchwalk',
  prone: 'prone',
  crawl: 'crawl',
});

// The families with a lower+upper pair in the gait bundle. `idle` is not one:
// its lower half is the pose pair's stance clip.
const PAIRED = Object.freeze(Object.keys(GAIT_FAMILY).filter(g => g !== 'idle'));

// What to draw when a family's pair did not resolve: down to a slower one in
// the same stance, and only then out of the stance. A tree without a crouch
// bundle should still crouch-walk as a walk rather than stand still.
const FALLBACK = Object.freeze({
  run: 'walk', walk: 'idle',
  crawl: 'prone', prone: 'crouch',
  crouchwalk: 'crouch', crouch: 'idle',
});


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
  const actions = { stand: action('stand') };
  for (const gait of PAIRED) {
    const half = FAMILY_HALVES[GAIT_FAMILY[gait]];
    actions[`${gait}Lower`] = action(half.lower);
    actions[`${gait}Upper`] = action(half.upper);
    // A gait only counts when both halves resolved: half a body running
    // while the other holds still is worse than not running at all.
    if (!actions[`${gait}Lower`] || !actions[`${gait}Upper`]) {
      actions[`${gait}Lower`] = actions[`${gait}Upper`] = null;
    }
  }

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
  let torso = null;
  scene.traverse(node => { if (!torso && node.name === TORSO_ROOT_BONE) torso = node; });
  return {
    mixer, actions, phase, halves, morphs, currentGait: 'idle', lastT: null,
    torso,
    twist: { base: new THREE.Quaternion(), applied: new THREE.Quaternion(), has: false },
  };
}

// Poses one soldier's gait rig at absolute replay time `t`. The clips' times
// are a pure function of `t` (and the entity's fixed phase offset); the morph
// cannot be, since it starts from the bones as they stood when the gait
// changed, so the rig keeps the time it last posed and steps the morph by the
// clock's own advance, as the map's replay bodies do. A clock that has not
// moved (paused) steps it by nothing, and `MorphBlend` draws the pose of the
// frame before again; a first pose, the first after `snapGait` (a seek, or a
// frame he was not drawn) and a clock gone back cut straight to the gait at
// `t` rather than morphing across the jump.
export function setGaitPose(entity, t, body = null) {
  const { anim, life } = entity;
  const dt = anim.lastT === null ? null : t - anim.lastT;
  const cut = dt === null || !(dt >= 0);
  anim.lastT = t;
  // The stance comes from the recording (`body`, read through the engine's
  // state table); without one this is the old speed-only read, which is what a
  // file recorded before the table carries.
  let desired = replayGait(selectGait(life, t).speed, body);
  // Down the fallback chain until a family has its pair, `idle` always
  // drawable because the pose pair carries its clip.
  for (let hops = 0; desired !== 'idle' && !anim.actions[`${desired}Lower`]; hops++) {
    if (hops > PAIRED.length) { desired = 'idle'; break; }
    desired = FALLBACK[desired] ?? 'idle';
  }

  // The bots' order (bot-visuals.js `step`): the mixer's own pose back on the
  // bones a morph drew over (`MorphBlend.restore`: three writes a bone only
  // when its value changes, so one a clip holds still would keep the morph's
  // last frame), the entries, the mixer, the morph.
  const { lower, upper } = anim.halves;
  lower.restore();
  upper.restore();
  if (cut) {
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
  for (const gait of PAIRED) {
    setPair(anim.actions[`${gait}Lower`], anim.actions[`${gait}Upper`], anim.currentGait === gait);
  }
  if (anim.actions.stand) anim.actions.stand.setEffectiveWeight(anim.currentGait === 'idle' ? 1 : 0);
  anim.mixer.update(0);
  const step = cut ? 0 : dt;
  lower.update(step);
  upper.update(step);
  // Last, over the pose the mixer and the morph just drew.
  twistTorso(entity, body);
}

// The soldier's next pose cuts to his gait at its instant instead of morphing:
// after a seek, or a frame he was not drawn, there is no pose on screen to
// morph from.
export function snapGait(anim) {
  if (anim) anim.lastT = null;
}
