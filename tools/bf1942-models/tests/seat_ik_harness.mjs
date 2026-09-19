// Drives `viewer/seat-ik.js` outside a browser and prints one JSON blob.
// The module imports nothing, so the copied file is the whole harness.
import {
  add, cross, dot, length, normalize, sub,
  quatApply, quatAxisAngle, quatFromTo, quatMul,
  refractorPoint, refractorYpr,
  seatBody, seatFlagMask, resolveSeatStates, seatPoseName, defaultSeatPoseName,
  ikTarget, prepareIkEntry, solveTwoBone, elbowAngle, collectIkBindings,
  SEAT_FLAG_BITS,
} from './seat-ik.mjs';

const out = {};

// -- the flag bits, against the jump table at lnxded 0x086e1e3c ---------------- //

out.flagBits = SEAT_FLAG_BITS;

// The real vanilla rows, verbatim from Objects.rfa.
const WILLY_SEAT = { flags: ['c_SeatShowFullBodySoldier', 'c_SeatIsOutside'] };
const WILLY_PASSENGER = {
  flags: ['c_SeatShowFullBodySoldier', 'c_SeatIsOutside'],
  poseAnimation: { upperBody: 'Ub_PassengerInWilly', lowerBody: 'Lb_PassengerInWilly' },
};
const SHERMAN_BROWNING = { flags: ['c_SeatShowHalfBodySoldier', 'c_SeatIsOutside'] };
const STATIONARY_BROWNING = { flags: ['c_SeatShowStandingSoldier', 'c_SeatIsOutside'] };

out.seatBody = {
  // The Sherman's own driving seat: its PCO subtree declares no SeatObject at
  // all, which is the entire reason the game draws nobody there.
  shermanDriver: seatBody([]),
  shermanGunner: seatBody([{ userData: { seat: SHERMAN_BROWNING } }]),
  willyDriver: seatBody([{ userData: { seat: WILLY_SEAT } }]),
  willyPassenger: seatBody([{ userData: { seat: WILLY_PASSENGER } }]),
  unknownFlag: seatFlagMask(['c_SeatHalfBodySoldier']),   // the data's own typo
};

out.seatStates = {
  willyDriver: resolveSeatStates([{ userData: { seat: WILLY_SEAT } }]),
  willyPassenger: resolveSeatStates([{ userData: { seat: WILLY_PASSENGER } }]),
  shermanGunner: resolveSeatStates([{ userData: { seat: SHERMAN_BROWNING } }]),
  standing: resolveSeatStates([{ userData: { seat: STATIONARY_BROWNING } }]),
  none: resolveSeatStates([]),
};

out.poseNames = {
  passenger: seatPoseName('Ub_PassengerInWilly', 'Lb_PassengerInWilly'),
  upperOnly: seatPoseName('Ub_PassengerInWilly', 'Lb_Stand'),
  sit: seatPoseName('Ub_SitInVehicle', 'Lb_SitInVehicle'),
  sitStanding: seatPoseName('Ub_SitInVehicle', 'Lb_StandInVehicle'),
  mixed: seatPoseName('Ub_PassengerInWilly', 'Lb_PassengerInHanomag'),
};

// -- the handedness conversion ------------------------------------------------- //

// The Willys' own two triples, and a handful of others spanning the range
// vanilla actually declares. `test_seat_ik.py` recomputes each with
// `bf42.gltf.quat_from_ypr` and compares, so a transcription slip in
// `refractorYpr` cannot pass.
out.ypr = [
  [-80, 60, 50], [-80, -60, 50], [-30, 80, 90], [30, -100, -90],
  [0, 180, 0], [0, 0, -90], [-90, 180, 0], [0, 0, 0], [180, -180, 180],
].map(ypr => ({ ypr, quat: refractorYpr(ypr) }));

out.point = refractorPoint([0.24, -0.1, -0.82]);

// -- the IK target ------------------------------------------------------------- //

// A wheel node yawed 90 degrees about +Y at (1, 2, 3): the offset must come out
// rotated with it, not merely translated.
const yaw90 = quatAxisAngle([0, 1, 0], Math.PI / 2);
out.ikTarget = ikTarget(
  { bone: 'Bip01 R Hand', position: [1, 0, 0], rotation: [0, 0, 0] },
  [1, 2, 3], yaw90);
out.ikTargetIdentity = ikTarget(
  { bone: 'Bip01 R Hand', position: [0.24, -0.1, -0.82], rotation: [0, 0, 0] },
  [0, 0, 0], [0, 0, 0, 1]);

// -- the two-bone solve --------------------------------------------------------- //

/** Apply the solver's two world rotations the way `map.html` does and report
 *  where the end effector actually lands. */
function runSolve(root, mid, end, target) {
  const s = solveTwoBone(root, mid, end, target);
  // bend: the forearm turns about the elbow, which does not move.
  const bentEnd = add(mid, quatApply(s.bend, sub(end, mid)));
  // reach: the whole chain swings about the shoulder, carrying the bent elbow.
  const finalMid = add(root, quatApply(s.reach, sub(mid, root)));
  const finalEnd = add(root, quatApply(s.reach, sub(bentEnd, root)));
  return {
    finalEnd,
    error: length(sub(finalEnd, target)),
    upperLengthKept: Math.abs(length(sub(finalMid, root)) - length(sub(mid, root))),
    foreLengthKept: Math.abs(length(sub(finalEnd, finalMid)) - length(sub(end, mid))),
    elbowBefore: elbowAngle(root, mid, end),
    elbowAfter: elbowAngle(root, finalMid, finalEnd),
    clamped: s.clamped,
    degenerate: s.degenerate,
    // The limb plane's normal before and after: the solve must not flip the
    // elbow through to the other side.
    planeBefore: normalize(cross(sub(mid, root), sub(end, mid))),
    planeAfter: normalize(cross(sub(finalMid, root), sub(finalEnd, finalMid))),
  };
}

// An arm roughly like the soldier's: 0.28 m upper, 0.26 m forearm, bent.
const ROOT = [0, 1.4, 0];
const MID = [0.28, 1.36, 0.02];
const END = [0.40, 1.20, 0.18];

out.solves = {
  // Straight back to where it already is: nothing should move.
  identity: runSolve(ROOT, MID, END, END),
  // A near target (arm folds up) and a far one (arm extends).
  near: runSolve(ROOT, MID, END, [0.20, 1.30, 0.10]),
  far: runSolve(ROOT, MID, END, [0.28, 1.16, 0.34]),
  // A hair past full extension: clamped, but only by millimetres.
  justOutOfReach: runSolve(ROOT, MID, END, [0.30, 1.15, 0.40]),
  // Behind the shoulder, which needs a large swing.
  behind: runSolve(ROOT, MID, END, [-0.20, 1.30, -0.25]),
  // Out of reach: clamped, still aimed the right way.
  unreachable: runSolve(ROOT, MID, END, [2.0, 1.4, 0.0]),
  // A straight arm, where the limb plane is degenerate and the bend axis has
  // to be invented.
  straight: runSolve([0, 0, 0], [1, 0, 0], [2, 0, 0], [1.0, 1.0, 0.0]),
  // A target at the shoulder itself: shorter than |l1 - l2| can fold to.
  atShoulder: runSolve(ROOT, MID, END, ROOT),
};

// The Willys' real numbers: the wheel's own frame, both hands.
const WHEEL_POS = [-0.399, 0.95, 0.10];
const WHEEL_QUAT = refractorYpr([0, 34, 0]);
out.willyHands = [
  { bone: 'Bip01 R Hand', position: [0.24, -0.1, -0.82], rotation: [-80, 60, 50] },
  { bone: 'Bip01 L Hand', position: [-0.26, -0.1, -0.82], rotation: [-80, -60, 50] },
].map(entry => {
  const t = ikTarget(entry, WHEEL_POS, WHEEL_QUAT);
  return { bone: entry.bone, position: t.position, quaternion: t.quaternion };
});
// The two hands must be symmetric about the wheel's own axis: the same
// distance from it, one on each side.
out.willyHandSpan = length(sub(out.willyHands[0].position, out.willyHands[1].position));

// Turning the wheel has to move both hands while keeping them rigidly the same
// distance apart — the hands ride the rim, they do not slide along it.
const turned = refractorYpr([0, 34, 25]);
out.willyHandsTurned = [
  { bone: 'Bip01 R Hand', position: [0.24, -0.1, -0.82], rotation: [-80, 60, 50] },
  { bone: 'Bip01 L Hand', position: [-0.26, -0.1, -0.82], rotation: [-80, -60, 50] },
].map(entry => ikTarget(entry, WHEEL_POS, turned).position);
out.willyHandsTurnedSpan = length(
  sub(out.willyHandsTurned[0], out.willyHandsTurned[1]));
out.willyHandTravel = [
  length(sub(out.willyHandsTurned[0], out.willyHands[0].position)),
  length(sub(out.willyHandsTurned[1], out.willyHands[1].position)),
];

// -- binding collection ---------------------------------------------------------- //

const wheel = { name: 'WillySteering' };
const column = { name: 'WillyColumn' };
const dummy = {
  name: 'WillySteeringDummy',
  children: [wheel, column],
  userData: {
    skeletonIK: [
      { bone: 'Bip01 R Hand', position: [0.24, -0.1, -0.82],
        rotation: [-80, 60, 50], targetChild: 0, targetNode: 'WillySteering' },
      { bone: 'Bip01 L Hand', position: [-0.26, -0.1, -0.82],
        rotation: [-80, -60, 50], targetChild: 0, targetNode: 'WillySteering' },
    ],
  },
};
const loose = {
  name: 'Browning',
  children: [],
  userData: {
    skeletonIK: [{ bone: 'Bip01 R Hand', position: [0.12, 0.08, -0.68],
                   rotation: [-30, 80, 90], targetChild: -1 }],
  },
};
// The pose a seat drops to when the one it names was never declared -- Road
// to Rome's `Ub_PassengerInM3GMC`. `map.html` asks for this when the declared
// asset 404s, and `extract_pose.resolve_seat_states` writes the same pair.
out.defaultPose = {
  sitting: defaultSeatPoseName(seatFlagMask(['c_SeatShowFullBodySoldier'])),
  standing: defaultSeatPoseName(seatFlagMask(['c_SeatShowStandingSoldier'])),
  nothingDeclared: defaultSeatPoseName(0),
};

const resolve = (node, index) => node.children?.[index] || null;
out.bindings = collectIkBindings([dummy, loose, { name: 'Plain', userData: {} }], resolve)
  .map(b => ({ node: b.node.name, target: b.target.name, bone: b.bone }));
// An index pointing past the built children falls back to the declaring node,
// the same as the engine's negative case.
out.bindingsNoResolver = collectIkBindings([dummy], null)
  .map(b => ({ node: b.node.name, target: b.target.name }));

// The offset and the baked rotation are computed once, at bind time, the way
// the engine bakes them once at parse time. A prepared entry and a raw one
// must give the same target.
const rawEntry = dummy.userData.skeletonIK[0];
const prepared = collectIkBindings([dummy], resolve)[0].entry;
out.prepared = {
  hasPrepared: !!prepared.prepared,
  rawHasPrepared: !!rawEntry.prepared,
  matches: JSON.stringify(ikTarget(prepared, [1, 2, 3], [0, 0, 0, 1]))
        === JSON.stringify(ikTarget(rawEntry, [1, 2, 3], [0, 0, 0, 1])),
  baked: prepareIkEntry(rawEntry).baked.map(n => +n.toFixed(6)),
  offset: prepareIkEntry(rawEntry).offset,
};

console.log(JSON.stringify(out, null, 1));
