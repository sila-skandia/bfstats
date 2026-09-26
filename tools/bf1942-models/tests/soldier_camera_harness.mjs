// Drives `viewer/soldier-camera.js` and prints one JSON blob.
// `tests/test_soldier_camera.py` asserts on it.

import * as soldierCamera from './soldier-camera.js';
import {
  SoldierView, SOLDIER_CAMERA_CVM, SOLDIER_VIEW_CYCLE, PARACHUTE_VIEW_CYCLE,
  PARACHUTE_VIEW_RADIUS, VIEW_MODE_ID, VIEW_INSIDE, VIEW_CHASE, VIEW_FRONT,
} from './soldier-camera.js';

const results = {
  cvm: SOLDIER_CAMERA_CVM,
  engineCycle: SOLDIER_VIEW_CYCLE,
  parachuteCycle: PARACHUTE_VIEW_CYCLE,
  parachuteRadius: PARACHUTE_VIEW_RADIUS,
  modeIds: VIEW_MODE_ID,
  // Every name the module hands the page. The one widening a standing
  // soldier's cycle, `FOOT_VIEW_CYCLE`, is not among them.
  exports: Object.keys(soldierCamera),
};

// On foot: the shipped SoldierCamera authorises CVMInside alone, so C is a
// no-op however many times it is pressed.
{
  const v = new SoldierView();
  const seen = [v.mode];
  for (let i = 0; i < 4; i += 1) seen.push(v.cycle());
  results.onFoot = { modes: v.modes, seen, firstPerson: v.firstPerson };
}

// Under the canopy: the three-view cycle, back to first person on the fourth
// press.
{
  const v = new SoldierView({ cycle: PARACHUTE_VIEW_CYCLE });
  const seen = [v.mode];
  for (let i = 0; i < 3; i += 1) seen.push(v.cycle());
  results.underCanopy = {
    modes: v.modes, seen,
    ids: seen.map((m) => VIEW_MODE_ID[m]),
  };
}

// Opening and closing the chute swaps the cycle, and a landing taken in a
// chase view returns the page to first person rather than leaving a standing
// soldier in a mode the engine forbids.
{
  const v = new SoldierView();
  const onFoot = v.mode;
  v.setCycle(PARACHUTE_VIEW_CYCLE);
  v.cycle();
  const inAir = v.mode;
  v.setCycle(null);
  results.landingResets = { onFoot, inAir, afterLanding: v.mode };
}

// A mode outside the current cycle is refused, which is `setViewMode`'s own
// answer when the template's CVM word is zero.
{
  const v = new SoldierView();
  const refused = v.setMode(VIEW_CHASE);
  v.setCycle(PARACHUTE_VIEW_CYCLE);
  const allowed = v.setMode(VIEW_FRONT);
  results.gate = { refused, allowed, inside: VIEW_INSIDE };
}

process.stdout.write(JSON.stringify(results, null, 1));
