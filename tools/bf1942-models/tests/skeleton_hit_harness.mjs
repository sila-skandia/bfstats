// Drives `viewer/skeleton-hit.js` under node and prints one JSON blob.
import {
  HEAD_BONE, buildCapsules, capsuleSegment, isHeadBone, meetSoldier,
  segmentDistanceSq, skeletonHit,
} from './skeleton-hit.js';

const results = {};
// Brute-force the segment distance and compare.
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 4 - 2;
const pt = () => [rnd(), rnd(), rnd()];
let worst = 0;
for (let n = 0; n < 300; n++) {
  const p0 = pt(), p1 = pt(), q0 = pt(), q1 = pt();
  let best = Infinity;
  for (let i = 0; i <= 200; i++) for (let j = 0; j <= 200; j += 1) {
    const s = i / 200, t = j / 200;
    const x = p0[0] + (p1[0] - p0[0]) * s - q0[0] - (q1[0] - q0[0]) * t;
    const y = p0[1] + (p1[1] - p0[1]) * s - q0[1] - (q1[1] - q0[1]) * t;
    const z = p0[2] + (p1[2] - p0[2]) * s - q0[2] - (q1[2] - q0[2]) * t;
    best = Math.min(best, x * x + y * y + z * z);
  }
  worst = Math.max(worst, segmentDistanceSq(p0, p1, q0, q1) - best);
}
results.bruteForceExcess = worst;               // never above brute force
results.parallel = segmentDistanceSq([0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]);

// The capsule rule: [parent + d, bone + d], d = (bone - parent) * stretch.
results.headCapsule = capsuleSegment([0, 1.6, 0], [0, 1.5, 0], 2);
results.plainCapsule = capsuleSegment([0, 1, 0], [0, 0.5, 0], 0);

// A standing man: neck 1.5, head 1.6, spine2 1.3 over spine 1.1.
const bones = {
  Bip01_Head: { bone: [0, 1.6, 0], parent: [0, 1.5, 0] },
  Bip01_Spine2: { bone: [0, 1.3, 0], parent: [0, 1.1, 0] },
};
const table = [
  { bone: 'Bip01_Head', distSq: 0.02, stretch: 2, material: 40 },
  { bone: 'Bip01_Spine2', distSq: 0.08, stretch: -0.45, material: 41 },
  { bone: 'Bip01_L_Foot', distSq: 0.035, stretch: 0, material: 42 },
];
const caps = buildCapsules(table, name => bones[name] ?? null);
results.capsuleCount = caps.length;              // the foot is not on this rig
const dir = [0, 0, 1];
results.headShot = skeletonHit([0, 1.75, -10], dir, 20, caps);
results.chestShot = skeletonHit([0, 1.2, -10], dir, 20, caps);
results.overHead = skeletonHit([0, 2.0, -10], dir, 20, caps);
results.tooShort = skeletonHit([0, 1.2, -10], dir, 5, caps);
// One round through two capsules: the one declared first wins even though the
// round reaches the other first.
const near = { bone: 'Near', a: [0, 0, 0], b: [0, 2, 0], distSq: 0.05, material: 41 };
const far = { bone: 'Far', a: [0, 0, 5], b: [0, 2, 5], distSq: 0.05, material: 40 };
results.declarationOrder = [
  skeletonHit([0, 1, -10], dir, 30, [far, near])?.bone,
  skeletonHit([0, 1, -10], dir, 30, [near, far])?.bone,
];
results.isHead = [isHeadBone('Bip01_Head'), isHeadBone(HEAD_BONE), isHeadBone('bip01 head'),
                  isHeadBone('Bip01_Spine2'), isHeadBone(null)];
results.sphere = {
  hit: meetSoldier([0, 1, -10], dir, 20, { center: [0, 1, 0], radius: 0.6 }),
  miss: meetSoldier([0, 2, -10], dir, 20, { center: [0, 1, 0], radius: 0.6 }),
  behind: meetSoldier([0, 1, 10], dir, 20, { center: [0, 1, 0], radius: 0.6 }),
  capsulesWin: meetSoldier([0, 1.75, -10], dir, 20, { capsules: caps, center: [0, 1, 0], radius: 0.6 })?.bone,
};
console.log(JSON.stringify(results, null, 1));
