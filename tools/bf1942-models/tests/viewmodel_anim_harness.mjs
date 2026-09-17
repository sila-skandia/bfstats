// Asserts viewmodel-anim.js clip selection — especially that looping fire
// drops the moment the trigger latch clears even while LoopRepeat isRunning,
// and that stopLoopFire is raised so map.html can freeze/stop the fire action
// (idle morphFactor ~0.7 would otherwise keep LoopRepeat evaluating ~1.4 s).

import { wantViewmodelClip } from './viewmodel-anim.js';

const base = {
  reload: 0,
  reloadPlayed: false,
  reloadRunning: false,
  deployRunning: false,
  active: 'idle',
  fireRunning: false,
  fireLoops: false,
  fireReturnsToReload: false,
  firing: false,
  hasFire: true,
  hasReload: true,
  gait: 'stand',
};

function check(name, input, expect) {
  const got = wantViewmodelClip({ ...base, ...input });
  const keys = Object.keys(expect);
  for (const k of keys) {
    if (got[k] !== expect[k]) {
      throw new Error(`${name}: ${k}=${JSON.stringify(got[k])} want ${JSON.stringify(expect[k])} (full ${JSON.stringify(got)})`);
    }
  }
  // Explicitly forbid surprise stopLoopFire unless the expect named it.
  if (got.stopLoopFire && expect.stopLoopFire !== true) {
    throw new Error(`${name}: unexpected stopLoopFire (full ${JSON.stringify(got)})`);
  }
}

// BAR / Thompson: fire loop + trigger released + fire action still "running".
// The insufficient fix gated *starting* fire on group.firing but left
// `active===fire && fireRunning` first — LoopRepeat never stops.
check('looper release while running → idle + stopLoopFire', {
  active: 'fire', fireLoops: true, fireRunning: true, firing: false,
}, { want: 'idle', stopLoopFire: true });

check('looper held → fire', {
  active: 'fire', fireLoops: true, fireRunning: true, firing: true,
}, { want: 'fire', startFire: false });

check('looper held, fire not running → start fire', {
  active: 'idle', fireLoops: true, fireRunning: false, firing: true,
}, { want: 'fire', startFire: true });

// cool must not appear in the decision at all: a looper with cool-equivalent
// "still recovering" but trigger up is idle.
check('looper cool-window after release → idle + stopLoopFire', {
  active: 'fire', fireLoops: true, fireRunning: true, firing: false,
}, { want: 'idle', stopLoopFire: true });

// Stationary (gait stand) vs walk: both leave fire; walk forces a different
// clip branch that historically masked the bug because it replaced motion.
check('stationary fire→release → idle (gait stand)', {
  active: 'fire', fireLoops: true, fireRunning: true, firing: false,
  gait: 'stand',
}, { want: 'idle', stopLoopFire: true });

check('moving fire→release → walk + stopLoopFire', {
  active: 'fire', fireLoops: true, fireRunning: true, firing: false,
  gait: 'walk',
}, { want: 'walk', stopLoopFire: true });

// Already flipped to idle while LoopRepeat fire is still scheduled — the
// map.html belt must still freeze fire (want === active, no playViewmodelClip).
check('active already idle, fire still running → stopLoopFire', {
  active: 'idle', fireLoops: true, fireRunning: true, firing: false,
  gait: 'stand',
}, { want: 'idle', stopLoopFire: true });

// PlayOnce (Colt / non-bolt): finish the punch, then idle — not cool-held.
check('PlayOnce punch in flight → fire', {
  active: 'fire', fireLoops: false, fireRunning: true, firing: false,
}, { want: 'fire' });

check('PlayOnce finished → idle', {
  active: 'fire', fireLoops: false, fireRunning: false, firing: false,
}, { want: 'idle' });

// ANIM-7 bolt: returnTo StandReload after PlayOnce fire ends.
check('bolt fire done → reload', {
  active: 'fire', fireLoops: false, fireRunning: false,
  fireReturnsToReload: true, hasReload: true,
}, { want: 'reload', startReload: true });

check('bolt punch in flight → fire (not reload yet)', {
  active: 'fire', fireLoops: false, fireRunning: true,
  fireReturnsToReload: true,
}, { want: 'fire' });

// Mag reload owns the arms.
check('reload in progress starts clip', {
  reload: 1.2, reloadPlayed: false, active: 'idle',
}, { want: 'reload', markReloadPlayed: true, startReload: true });

check('walk gait loco', {
  active: 'idle', gait: 'walk',
}, { want: 'walk' });

console.log(JSON.stringify({ ok: true, cases: 13 }));
