// Drives `viewer/soldier-exposure.js` outside a browser and prints one JSON blob.
//
// Same shape as the other harnesses here: `tests/test_soldier_exposure.py`
// copies the viewer module in under its own name, so the file under test is the
// file the page loads, byte for byte. The module imports nothing.

import {
  EXPOSURE_SAMPLES, EXPOSURE_DIVISOR, MAX_EXPOSURE, POSE_STAND, POSE_CROUCH,
  POSE_PRONE, knownPose, soldierExposure, exposurePoints, worldBlocker,
} from './soldier-exposure.js';

const results = {};

results.tables = {
  standing: EXPOSURE_SAMPLES[POSE_STAND].map(v => [...v]),
  crouching: EXPOSURE_SAMPLES[POSE_CROUCH].map(v => [...v]),
  prone: EXPOSURE_SAMPLES[POSE_PRONE].map(v => [...v]),
  divisors: [...EXPOSURE_DIVISOR],
  maxExposure: [...MAX_EXPOSURE],
  standingIsCrouching: EXPOSURE_SAMPLES[POSE_STAND] === EXPOSURE_SAMPLES[POSE_CROUCH],
  sampleCounts: EXPOSURE_SAMPLES.map(t => t.length),
};

const clear = () => false;
const opaque = () => true;

const origin = { x: 100, y: 10, z: -100 };
const nearby = { x: 100, y: 9.3, z: -101 };

results.openGround = {
  standing: soldierExposure(nearby, origin, POSE_STAND, clear),
  crouching: soldierExposure(nearby, origin, POSE_CROUCH, clear),
  prone: soldierExposure(nearby, origin, POSE_PRONE, clear),
};

results.fullyCovered = {
  standing: soldierExposure(nearby, origin, POSE_STAND, opaque),
  crouching: soldierExposure(nearby, origin, POSE_CROUCH, opaque),
  prone: soldierExposure(nearby, origin, POSE_PRONE, opaque),
};

results.unknownPose = {
  three: soldierExposure(nearby, origin, 3, clear),
  minusOne: soldierExposure(nearby, origin, -1, clear),
  undefinedPose: soldierExposure(nearby, origin, undefined, clear),
  known: [knownPose(0), knownPose(1), knownPose(2), knownPose(3)],
};

// A wall that blocks everything below a given world Y: the low samples are in
// cover, the high ones are not. Lets a test assert a partial fraction without
// building geometry.
function belowY(limit) {
  return (ox, oy, oz, dx, dy, dz, distance) => (oy + dy * distance) < limit;
}

results.partial = {
  // Standing samples sit at origin.y - 0.1, -0.3 and -0.7. A wall up to
  // origin.y - 0.2 hides the -0.3 and -0.7 rows, six of nine.
  standingLowSix: soldierExposure(nearby, origin, POSE_STAND, belowY(origin.y - 0.2)),
  crouchingLowSix: soldierExposure(nearby, origin, POSE_CROUCH, belowY(origin.y - 0.2)),
  // Up to -0.5 hides only the -0.7 row, three of nine.
  standingLowThree: soldierExposure(nearby, origin, POSE_STAND, belowY(origin.y - 0.5)),
  // Prone is one row: all three or none.
  proneAll: soldierExposure(nearby, origin, POSE_PRONE, belowY(origin.y - 0.5)),
};

results.points = {
  standing: exposurePoints(origin, POSE_STAND),
  prone: exposurePoints(origin, POSE_PRONE),
  unknown: exposurePoints(origin, 7),
};

// `worldBlocker` against a stub collider with `cast`'s real return shape.
function stubCollider(reply) {
  return { cast: (...args) => reply(...args) };
}

const calls = [];
const recording = worldBlocker(stubCollider((ox, oy, oz, dx, dy, dz, dist, owner) => {
  calls.push({ dist, owner });
  return null;
}), { skipOwner: 4 });
recording(0, 0, 0, 0, 1, 0, 5);
recording(0, 0, 0, 0, 1, 0, 0.01);

results.blocker = {
  calls,
  // A water hit is not cover.
  water: worldBlocker(stubCollider(() => ({ kind: 'water', t: 1 })))(0, 0, 0, 0, 1, 0, 5),
  terrain: worldBlocker(stubCollider(() => ({ kind: 'terrain', t: 1 })))(0, 0, 0, 0, 1, 0, 5),
  object: worldBlocker(stubCollider(() => ({ kind: 'object', t: 1 })))(0, 0, 0, 0, 1, 0, 5),
  none: worldBlocker(stubCollider(() => null))(0, 0, 0, 0, 1, 0, 5),
  noCollider: worldBlocker(null)(0, 0, 0, 0, 1, 0, 5),
};

// A grenade in the open versus the same grenade behind a wall, as the page
// would ask it: the blast is 3 m away and a wall stands between.
const blast = { x: 103, y: 9.3, z: -100 };
const wallAt = 101.5;
const wall = (ox, oy, oz, dx, dy, dz, distance) => {
  // The segment crosses the plane x = wallAt if it starts on one side and
  // ends on the other.
  const endX = ox + dx * distance;
  return (ox - wallAt) * (endX - wallAt) < 0;
};
results.cover = {
  open: soldierExposure(blast, origin, POSE_STAND, clear),
  behindWall: soldierExposure(blast, origin, POSE_STAND, wall),
};

process.stdout.write(JSON.stringify(results, null, 2));
