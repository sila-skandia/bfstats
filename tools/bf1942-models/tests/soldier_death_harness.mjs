// Drives `viewer/soldier-death.js` outside a browser and prints one JSON blob.
// `tests/test_soldier_death.py` copies the module in under its own name, so the
// file under test is the file the page loads.

import {
  CORPSE_SECONDS, DIE_CLIPS, HEAD_HIT_FLOOR, deathFamily, hitFromBehind,
  isHeadHit, resolveDeathFamily, roundHit,
} from './soldier-death.js';

const results = {};
const fixed = v => () => v;              // a rand() that always answers `v`
const NORTH = 0;                         // yaw 0 faces +z
// A round travelling +z meets a man facing +z from behind; -z from the front.
const fromBehind = { travel: [0, 0, 5], height: 1.2 };
const fromFront = { travel: [0, 0, -5], height: 1.2 };
const toTheHead = { travel: [0, 0, -5], height: 1.6 };

results.corpseSeconds = CORPSE_SECONDS;
results.headFloor = HEAD_HIT_FLOOR;
results.families = Object.keys(DIE_CLIPS);

// `handleDamage`'s order: seat, canopy, swim, free fall, then the pose.
const all = { seated: true, parachuteOpen: true, swimming: true, freeFall: true,
              stance: 'crouch', hit: toTheHead, rand: fixed(0) };
results.order = [
  deathFamily(all),
  deathFamily({ ...all, seated: false }),
  deathFamily({ ...all, seated: false, parachuteOpen: false }),
  deathFamily({ ...all, seated: false, parachuteOpen: false, swimming: false }),
  deathFamily({ ...all, seated: false, parachuteOpen: false, swimming: false,
                freeFall: false }),
];

results.standing = {
  front: deathFamily({ hit: fromFront, yaw: NORTH, rand: fixed(0.5) }),
  behind: deathFamily({ hit: fromBehind, yaw: NORTH, rand: fixed(0.5) }),
  // Turned round, the same round is now in his chest.
  behindTurned: deathFamily({ hit: fromBehind, yaw: Math.PI, rand: fixed(0.5) }),
  // No collision at all is Chest (`bone < 0` leaves Back at 0).
  noHit: deathFamily({ rand: fixed(0.5) }),
  head: deathFamily({ hit: toTheHead, rand: fixed(0) }),
  slow: deathFamily({ hit: fromBehind, rand: fixed(0.1) }),
  notSlow: deathFamily({ hit: fromBehind, rand: fixed(0.25) }),
};
// A round that met a drawn skeleton is judged by its bone, not its height.
results.byBone = {
  headLow: deathFamily({ hit: { travel: [0, 0, -5], height: 0.5, bone: 'Bip01_Head' }, rand: fixed(0.5) }),
  chestHigh: deathFamily({ hit: { travel: [0, 0, -5], height: 1.7, bone: 'Bip01_Spine2' }, rand: fixed(0.5) }),
};
results.crouched = {
  front: deathFamily({ stance: 'crouch', hit: fromFront }),
  behind: deathFamily({ stance: 'crouch', hit: fromBehind }),
  // The head test and the slow roll are standing-only.
  head: deathFamily({ stance: 'crouch', hit: toTheHead, rand: fixed(0) }),
};
results.prone = {
  behind: deathFamily({ stance: 'prone', hit: fromBehind, rand: fixed(0) }),
  head: deathFamily({ stance: 'prone', hit: toTheHead }),
};

// The slow death is one draw in four: `rand() & 3 == 0`.
let slow = 0;
for (let i = 0; i < 400; i++) {
  if (deathFamily({ rand: fixed((i + 0.5) / 400) }) === 'dieSlow') slow++;
}
results.slowShare = slow / 400;

results.geometry = {
  sideOn: hitFromBehind([5, 0, 0], NORTH),
  verticalIgnored: hitFromBehind([0, -100, 0.01], NORTH),
  nullTravel: hitFromBehind(null, NORTH),
  headAtFloor: isHeadHit(HEAD_HIT_FLOOR),
  chest: isHeadHit(1.2),
  noHeight: isHeadHit(null),
};
results.roundHit = {
  hit: roundHit([0, 1.5, -10], [0, 1.6, 0], 0),
  seated: roundHit([0, 1.5, -10], [0, 1.6, 0], 0, true),
  zero: roundHit([1, 1, 1], [1, 1, 1], 0),
  noFeet: roundHit([0, 0, 0], [0, 1, 1], undefined),
};
results.fallback = {
  bound: resolveDeathFamily('dieHead', f => f === 'dieHead'),
  toChest: resolveDeathFamily('dieBackCrouch', f => f === 'dieChestStand'),
  crouchFirst: resolveDeathFamily('dieBackCrouch',
                                  f => f === 'dieChestCrouch' || f === 'dieChestStand'),
  nothing: resolveDeathFamily('dieLie', () => false),
  noPredicate: resolveDeathFamily('dieSlow'),
};

console.log(JSON.stringify(results, null, 1));
