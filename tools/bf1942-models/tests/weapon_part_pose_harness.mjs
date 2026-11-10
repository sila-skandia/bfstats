// weapon-part-pose.js against a real three.js mixer: a bolt clip throws the
// spent case 0.43 m right and ends there (BF1918's BerthierBoltOperate.baf),
// the aim clip holds it at rest, and the arms fade from one to the other at
// the aim state's 0.7 (1.43 s). The case must be home the frame the bolt is
// done, not drift back across the fade (ledger ANIM-22).
import * as THREE from 'three';
import { collectWeaponParts, poseWeaponParts } from './weapon-part-pose.js';

const REST = [0, 0.045, -0.215];
const OUT = [0.433, 0.077, -0.228];

const root = new THREE.Group();
const arm = new THREE.Object3D(); arm.name = 'Bip01_R_Hand';
const shell = new THREE.Object3D(); shell.name = 'BerthierShell';
shell.userData.boundBone = 'shell';
shell.position.fromArray(REST);
const body = new THREE.Object3D(); body.name = 'BerthierBody';   // no boundBone
root.add(arm, shell, body);

const bolt = new THREE.AnimationClip('bolt', 1.4286, [
  new THREE.VectorKeyframeTrack('BerthierShell.position', [0, 0.7, 1.4286],
    [...REST, -0.03, -0.4, 0.2, ...OUT]),
  new THREE.VectorKeyframeTrack('Bip01_R_Hand.position', [0, 1.4286], [0, 0, 0, 0.1, 0, 0]),
]);
const idle = new THREE.AnimationClip('idle', 6.667, [
  new THREE.VectorKeyframeTrack('BerthierShell.position', [0, 6.667], [...REST, ...REST]),
  new THREE.VectorKeyframeTrack('Bip01_R_Hand.position', [0, 6.667], [0, 0, 0, 0, 0, 0]),
]);
// A clip with no track for the case at all (an arms-only family).
const deploy = new THREE.AnimationClip('deploy', 1, [
  new THREE.VectorKeyframeTrack('Bip01_R_Hand.position', [0, 1], [0, 0, 0, 0, 0.1, 0]),
]);

const parts = collectWeaponParts(root, [bolt, idle, deploy]);
const out = {};
out.parts = parts.map(p => p.node.name);
out.boltTracks = Object.keys(parts[0].tracks.get('bolt') ?? {});
out.deployTracks = parts[0].tracks.has('deploy');

const mixer = new THREE.AnimationMixer(root);
const aBolt = mixer.clipAction(bolt);
aBolt.setLoop(THREE.LoopOnce, 1); aBolt.clampWhenFinished = true;
const aIdle = mixer.clipAction(idle);
aIdle.setLoop(THREE.LoopRepeat, Infinity);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// The bolt plays to its last frame.
aBolt.play();
mixer.update(0.7);
poseWeaponParts(parts, 'bolt', aBolt.time, true);
out.midBoltOffRest = +dist(shell.position.toArray(), REST).toFixed(3);
mixer.update(1.0);   // past its end: clamped on the last frame
const clamped = shell.position.toArray();
out.clampedMixerOffRest = +dist(clamped, REST).toFixed(3);
poseWeaponParts(parts, 'bolt', aBolt.time, true);
out.clampedPosedOffRest = +dist(shell.position.toArray(), REST).toFixed(3);

// The arms fade to the aim over 1.43 s. What the mixer alone leaves 0.3 s in
// (the drift the owner saw), and what the posed parts are.
aIdle.reset().play();
aIdle.crossFadeFrom(aBolt, 1 / 0.7, false);
mixer.update(0.3);
out.fadeMixerOffRest = +dist(shell.position.toArray(), REST).toFixed(3);
poseWeaponParts(parts, 'idle', aIdle.time, false);
out.fadePosedOffRest = +dist(shell.position.toArray(), REST).toFixed(3);
// The hand still blends: only bound parts are posed.
out.handStillBlending = arm.position.x > 0.001 && arm.position.x < 0.099;

// A bolt fading in from the aim takes the clip at full weight at once.
aBolt.reset().play();
aBolt.crossFadeFrom(aIdle, 0.2, false);
mixer.update(0.7);
poseWeaponParts(parts, 'bolt', aBolt.time, true);
out.fadeInPosedMatchesClip = +dist(shell.position.toArray(), [-0.03, -0.4, 0.2]).toFixed(4);

// Nothing owns the arms, or the owner has no track for the part: rest.
shell.position.set(9, 9, 9);
poseWeaponParts(parts, null, 0, false);
out.noOwnerOffRest = +dist(shell.position.toArray(), REST).toFixed(3);
shell.position.set(9, 9, 9);
poseWeaponParts(parts, 'deploy', 0.5, true);
out.noTrackOffRest = +dist(shell.position.toArray(), REST).toFixed(3);
// A loop is sampled at its time, never reset.
poseWeaponParts(parts, 'bolt', 1.4286, false);
out.loopAtEndOffRest = +dist(shell.position.toArray(), REST).toFixed(3);

console.log(JSON.stringify(out));
