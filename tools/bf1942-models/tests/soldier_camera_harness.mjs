// Drives `viewer/soldier-camera.js` and prints one JSON blob.
// `tests/test_soldier_camera.py` asserts on it.

import * as soldierCamera from './soldier-camera.js';
import {
  SoldierView, SOLDIER_CAMERA_CVM, SOLDIER_VIEW_CYCLE, PARACHUTE_VIEW_CYCLE,
  PARACHUTE_VIEW_RADIUS, VIEW_MODE_ID, VIEW_INSIDE, VIEW_CHASE, VIEW_FRONT,
  FOOT_VIEW_CYCLE, FOOT_CHASE_RADIUS, FOOT_CHASE_SHOULDER, FOOT_AIM_REACH, FOOT_AIM_NEAR,
  aimDistance, lookAngles,
} from './soldier-camera.js';

const results = {
  cvm: SOLDIER_CAMERA_CVM,
  engineCycle: SOLDIER_VIEW_CYCLE,
  parachuteCycle: PARACHUTE_VIEW_CYCLE,
  parachuteRadius: PARACHUTE_VIEW_RADIUS,
  modeIds: VIEW_MODE_ID,
  // Every name the module hands the page.
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

// On foot since 2026-10-15: inside and chase, reached by F10 / F9 (setMode)
// and not by C (cycle), except the touch layout's forced press.
{
  const v = new SoldierView();
  v.setCycle(FOOT_VIEW_CYCLE, { toggles: false });
  const start = v.mode;
  const afterC = v.cycle();
  const afterF11 = v.setMode(VIEW_FRONT);
  const afterF10 = v.setMode(VIEW_CHASE);
  const afterF9 = v.setMode(VIEW_INSIDE);
  const touch = v.cycle({ force: true });
  const touchBack = v.cycle({ force: true });
  results.footCycle = {
    cycle: FOOT_VIEW_CYCLE, modes: v.modes, toggles: v.toggles,
    start, afterC, afterF11, afterF10, afterF9, touch, touchBack,
    radius: FOOT_CHASE_RADIUS, shoulder: FOOT_CHASE_SHOULDER,
  };
}

// A landing: the canopy's chase view carries onto the foot's, its front view
// (which a man on the ground does not have) drops to first person.
{
  const chase = new SoldierView({ cycle: PARACHUTE_VIEW_CYCLE });
  chase.setMode(VIEW_CHASE);
  chase.setCycle(FOOT_VIEW_CYCLE, { toggles: false });
  const front = new SoldierView({ cycle: PARACHUTE_VIEW_CYCLE });
  front.setMode(VIEW_FRONT);
  front.setCycle(FOOT_VIEW_CYCLE, { toggles: false });
  const reopened = new SoldierView({ cycle: FOOT_VIEW_CYCLE, toggles: false });
  reopened.setCycle(PARACHUTE_VIEW_CYCLE);
  results.footLanding = { fromChase: chase.mode, fromFront: front.mode,
                          canopyToggles: reopened.toggles };
}

// The aim point the chase view converges on.
{
  const eye = [0, 2, 0];
  const flat = () => 0;
  const down = [0, -Math.sin(Math.PI / 6), Math.cos(Math.PI / 6)];   // 30 degrees down
  const level = [0, 0, 1];
  const up = [0, 1, 0];
  const wall = (ox, oy, oz, dx, dy, dz, reach) => (dz > 0 && 7.5 / dz <= reach ? { t: 7.5 / dz } : null);
  results.aim = {
    groundAhead: aimDistance(eye, down, { ground: flat }),
    levelNoHit: aimDistance(eye, level, { ground: flat }),
    straightUp: aimDistance(eye, up, { ground: flat }),
    wall: aimDistance(eye, level, { ground: flat, cast: wall }),
    nearClamp: aimDistance(eye, [0, -1, 0], { ground: () => 1.5 }),
    nothing: aimDistance(eye, level),
    reach: FOOT_AIM_REACH,
    near: FOOT_AIM_NEAR,
    look: lookAngles([0, 0, 0], [1, 1, 0]),
    lookBack: lookAngles([0, 0, 0], [0, 0, -2]),
  };
}

process.stdout.write(JSON.stringify(results, null, 1));
