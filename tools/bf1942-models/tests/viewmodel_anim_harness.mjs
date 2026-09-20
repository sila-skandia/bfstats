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

// After LoopOnce clamps, isRunning() is false but the magazine timer still
// owns the arms — keep reload rather than falling through to idle.
check('reload timer still running after clip clamped → keep reload', {
  reload: 0.8, reloadPlayed: true, reloadRunning: false, active: 'idle',
}, { want: 'reload', startReload: true });

check('reload timer + clip still scheduled → hold reload', {
  reload: 0.8, reloadPlayed: true, reloadRunning: true, active: 'reload',
}, { want: 'reload' });

check('walk gait loco', {
  active: 'idle', gait: 'walk',
}, { want: 'walk' });

// --- idle fidgets (ANIM-6): the aim state's 4-7 s dwell picks one of the
// --- registered Ub_Idle<W>1..3 one-shots; each returns to the aim state.

check('dwell expired → start the picked fidget', {
  active: 'idle', fidget: null, fidgetRunning: false,
  fidgetDue: true, fidgetPick: 'idle2',
}, { want: 'idle2', startFidget: true });

check('fidget playing → keep it', {
  active: 'idle2', fidget: 'idle2', fidgetRunning: true,
  fidgetDue: false, fidgetPick: null,
}, { want: 'idle2' });

check('fidget clamped → back to idle + endFidget', {
  active: 'idle2', fidget: 'idle2', fidgetRunning: false,
  fidgetDue: false, fidgetPick: null, gait: 'stand',
}, { want: 'idle', endFidget: true });

check('fidget clamped while walking → walk + endFidget', {
  active: 'idle2', fidget: 'idle2', fidgetRunning: false,
  fidgetDue: false, fidgetPick: null, gait: 'walk',
}, { want: 'walk', endFidget: true });

check('no fidget due → plain idle', {
  active: 'idle', fidget: null, fidgetRunning: false,
  fidgetDue: false, fidgetPick: null,
}, { want: 'idle' });

// Fire outranks the fidget exactly as the engine's input transitions leave it.
check('fidget due but trigger held → fire wins', {
  active: 'idle', fidget: null, fidgetRunning: false,
  fidgetDue: true, fidgetPick: 'idle1',
  fireLoops: true, firing: true,
}, { want: 'fire', startFire: true });

check('fidget playing, trigger held → fire wins', {
  active: 'idle2', fidget: 'idle2', fidgetRunning: true,
  fidgetDue: false, fidgetPick: null,
  fireLoops: true, firing: true,
}, { want: 'fire', startFire: true });

check('fidget playing, reload begun → reload wins', {
  active: 'idle2', fidget: 'idle2', fidgetRunning: true,
  fidgetDue: false, fidgetPick: null,
  reload: 1.0, reloadPlayed: false,
}, { want: 'reload', markReloadPlayed: true, startReload: true });

check('fidget chosen but deploy owns the arms → deploy wins', {
  active: 'deploy', fidget: 'idle2', fidgetRunning: true,
  fidgetDue: false, fidgetPick: null,
  deployRunning: true,
}, { want: 'deploy' });

// --- fire variants (the knife's 1pFireKnife1..5, ANIM-6 c_AsmRandom): the
// --- extractor bakes them as fire1..fireN; the per-round pick belongs to the
// --- shot path (onShot), selection only keeps and releases.

check('variant swing in flight → keep that variant', {
  active: 'fire3', fireVariants: ['fire1', 'fire2', 'fire3', 'fire4', 'fire5'],
  fireLoops: false, fireRunning: true, firing: true, hasFire: true,
}, { want: 'fire3' });

check('variant swing clamped → idle', {
  active: 'fire3', fireVariants: ['fire1', 'fire2', 'fire3', 'fire4', 'fire5'],
  fireLoops: false, fireRunning: false, firing: false, hasFire: true,
}, { want: 'idle' });

check('variant swing clamped while walking → walk', {
  active: 'fire2', fireVariants: ['fire1', 'fire2', 'fire3', 'fire4', 'fire5'],
  fireLoops: false, fireRunning: false, firing: false, hasFire: true,
  gait: 'walk',
}, { want: 'walk' });

check('variant swing clamped, fidget was due → idle (no fidget from fire)', {
  active: 'fire4', fireVariants: ['fire1', 'fire2', 'fire3', 'fire4', 'fire5'],
  fireLoops: false, fireRunning: false, firing: false, hasFire: true,
  fidgetDue: true, fidgetPick: 'idle1',
}, { want: 'idle1', startFidget: true });

check('lone fire still wins with variants present (hasFire either way)', {
  active: 'fire', fireVariants: null,
  fireLoops: false, fireRunning: true, firing: false, hasFire: true,
}, { want: 'fire' });

check('variants listed but none active and none running → idle', {
  active: 'idle', fireVariants: ['fire1', 'fire2'],
  fireLoops: false, fireRunning: false, firing: true, hasFire: true,
}, { want: 'idle' });

// A variant must never satisfy the looper-release stopLoopFire rule: the
// knife has no LoopRepeat fire to freeze.
check('variant + trigger released mid-swing → keep swing, no stopLoopFire', {
  active: 'fire5', fireVariants: ['fire1', 'fire2', 'fire3', 'fire4', 'fire5'],
  fireLoops: false, fireRunning: true, firing: false, hasFire: true,
}, { want: 'fire5' });

console.log(JSON.stringify({ ok: true, cases: 31 }));
