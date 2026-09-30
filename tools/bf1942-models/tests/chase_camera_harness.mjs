// Drives `viewer/chase-camera.js` outside a browser and prints one JSON blob.
//
// Same shape as the other harnesses here: `tests/test_chase_camera.py` copies
// the viewer module in under its own name, so the file under test is the file
// the page loads, byte for byte. `chase-camera.js` imports nothing at all.

import {
  CHASE_RADIUS_SCALE, CHASE_UP_FRACTION, CHASE_SPEED_LAG, CHASE_EASE_RATE,
  CHASE_FLOOR_CLEARANCE, CHASE_BEHIND, CHASE_AHEAD,
  boundingRadius, chaseTarget, chaseStep, chaseEye, chaseLawFor, chaseFrameNode,
} from './chase-camera.js';

const results = {};
const round = (v, p = 1e6) => v.map(n => Math.round(n * p) / p);

results.constants = {
  radiusScale: CHASE_RADIUS_SCALE, upFraction: CHASE_UP_FRACTION,
  speedLag: CHASE_SPEED_LAG, easeRate: CHASE_EASE_RATE,
  floorClearance: CHASE_FLOOR_CLEARANCE, behind: CHASE_BEHIND, ahead: CHASE_AHEAD,
};

// getBoundingRadius: own radius against |child offset| + child radius, recursive.
results.radiusLeaf = boundingRadius({ radius: 2.5 });
results.radiusChildWins = boundingRadius({
  radius: 1, children: [{ offset: [3, 0, 4], radius: 0.5 }],
});
results.radiusNested = boundingRadius({
  radius: 1,
  children: [{ offset: [0, 2, 0], radius: 0.1,
    children: [{ offset: [0, 0, 3], radius: 0.25 }] }],
});
results.radiusEmpty = boundingRadius(null);

// A frame facing -Z (the viewer's forward), level, radius 4: R = 4.8.
const FWD = [0, 0, -1];
const UP = [0, 1, 0];
results.targetBehind = round(chaseTarget(FWD, UP, 4, CHASE_BEHIND));
results.targetAhead = round(chaseTarget(FWD, UP, 4, CHASE_AHEAD));

// The same frame yawed 90 degrees left (forward = -X): the offset swings with it.
results.targetBehindYawed = round(chaseTarget([-1, 0, 0], UP, 4, CHASE_BEHIND));

// The ease: from rel = 0, one 0.5 s step closes 1 - e^-1 of the gap.
results.stepHalfSecond = round(chaseStep([0, 0, 0], [0, 1.44, 4.8], null, CHASE_BEHIND, 0.5));
// Frame-rate independence: thirty 1/60 steps land where one 0.5 s step does.
{
  const rel = [0, 0, 0];
  for (let i = 0; i < 30; i += 1) chaseStep(rel, [0, 1.44, 4.8], null, CHASE_BEHIND, 1 / 60);
  results.stepThirtyFrames = round(rel);
}
// A zero dt leaves the offset where it was.
results.stepZeroDt = chaseStep([1, 2, 3], [9, 9, 9], [5, 5, 5], CHASE_BEHIND, 0);
// Settled under way: the chase camera trails by 0.6 s of travel, front leads.
{
  const behind = [0, 0, 0];
  const ahead = [0, 0, 0];
  for (let i = 0; i < 1200; i += 1) {
    chaseStep(behind, [0, 1.44, 4.8], [0, 0, -10], CHASE_BEHIND, 1 / 60);
    chaseStep(ahead, [0, 1.44, -4.8], [0, 0, -10], CHASE_AHEAD, 1 / 60);
  }
  results.settledBehindMoving = round(behind, 1e3);
  results.settledAheadMoving = round(ahead, 1e3);
}

// The eye: anchor + rel, and the terrain clearance folded back into rel.
results.eyeClear = chaseEye([10, 5, 20], [0, 1.5, 4.8], 0);
{
  const rel = [0, -3, 4.8];
  results.eyeLifted = chaseEye([10, 5, 20], rel, 4);
  results.eyeLiftedRel = rel;
}
results.eyeNoFloor = chaseEye([10, 5, 20], [0, -30, 0], -Infinity);

// The ?chase= switch.
results.law = {
  defaultTurret: chaseLawFor(null, true),
  defaultPlain: chaseLawFor(null, false),
  engineTurret: chaseLawFor('engine', true),
  enginePlain: chaseLawFor('engine', false),
  turretTurret: chaseLawFor('turret', true),
  turretPlain: chaseLawFor('turret', false),
  legacyTurret: chaseLawFor('legacy', true),
  unknownTurret: chaseLawFor('nonsense', true),
};

// A pintle MG whose mount is turned round (the M1A1 commander's, the
// Sherman's): hull forward -Z, the Camera's own forward -Z along the gun, and
// the Camera's parent, the console, forward +Z. Each node is plain axes.
{
  const hull = { name: 'hull', forward: [0, 0, -1], up: [0, 1, 0] };
  const camera = { name: 'camera', forward: [0, 0, -1], up: [0, 1, 0] };
  const parent = { name: 'parent', forward: [0, 0, 1], up: [0, 1, 0] };
  const behind = node => chaseTarget(node.forward, node.up, 4, CHASE_BEHIND);
  const byDefault = chaseFrameNode(chaseLawFor(null, true), hull, camera);
  const byTurret = chaseFrameNode(chaseLawFor('turret', true), hull, camera);
  results.flipped = {
    defaultNode: byDefault.name,
    turretNode: byTurret.name,
    legacyNode: chaseFrameNode(chaseLawFor('legacy', true), hull, camera).name,
    nullLawNode: chaseFrameNode(null, hull, camera).name,
    defaultTarget: behind(byDefault),
    turretTarget: behind(byTurret),
    // What the old default (the Camera's parent) asked for.
    parentTarget: behind(parent),
  };
  // The gun swung 90 degrees right: its Camera looks down +X, the hull does not.
  const yawedCamera = { name: 'camera', forward: [1, 0, 0], up: [0, 1, 0] };
  results.flipped.defaultTargetYawed = behind(chaseFrameNode(chaseLawFor(null, true), hull, yawedCamera));
  results.flipped.turretTargetYawed = behind(chaseFrameNode(chaseLawFor('turret', true), hull, yawedCamera));
}

process.stdout.write(JSON.stringify(results));
