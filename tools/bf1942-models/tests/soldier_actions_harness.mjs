// Drives `viewer/soldier-actions.js` outside a browser and prints one JSON blob.
// `tests/test_soldier_actions.py` copies the module in under its own name, so
// the file under test is the file the page loads.

import {
  DIE_MORPH, FAMILY_HALVES, MorphBlend, SoldierActions, STANCE_ENTRY,
  VANILLA_STATES, stanceEntryKey,
} from './soldier-actions.js';

const results = {};

// A rig as the published tree binds it: the fourteen gait halves, the seven
// lower transitions, a Thompson's torso actions, and the deaths. Durations are
// `1 / |speed|` at the weapon's own rate (the Thompson's, from its states).
const THOMPSON = {
  Ub_CrouchToLie: { speed: 1.6, loop: false, morph: 4, then: 'Ub_Lie' },
  Ub_LieToCrouch: { speed: -2, loop: false, morph: 4, then: 'Ub_Crouch' },
  Ub_LieToStand: { speed: -3, loop: false, morph: 4, then: 'Ub_CrouchToStand' },
  Ub_RunStandToLie: { speed: 1.4, loop: false, morph: 4, then: 'Ub_Lie' },
  Ub_Fire: { speed: 2.0, loop: true, morph: 4, then: '_POSE_' },
  Ub_LieFire: { speed: 5.0, loop: true, morph: 4, then: '_POSE_' },
  Ub_StandReload: { speed: 0.47, loop: false, morph: 10000, then: '_POSE_' },
  Ub_LieReload: { speed: 0.53, loop: false, morph: 10000, then: '_POSE_' },
};
const NO4 = {
  ...THOMPSON,
  Ub_Fire: { speed: 1.0, loop: false, morph: 10000, then: 'Ub_StandReload' },
  Ub_LieFire: { speed: 1.0, loop: false, morph: 10000, then: 'Ub_LieReload' },
  Ub_StandReload: { speed: 0.52, loop: false, morph: 10000, then: '_POSE_' },
};

function rig(upper = THOMPSON, { transitions = true } = {}) {
  const bound = new Set();
  for (const f of Object.values(FAMILY_HALVES)) { bound.add(f.lower); bound.add(f.upper); }
  const states = { ...upper };
  if (transitions) {
    for (const name of Object.keys(VANILLA_STATES)) {
      if (name.startsWith('Lb_')) { bound.add(name); states[name] = VANILLA_STATES[name]; }
    }
    for (const name of Object.keys(upper)) bound.add(name);
  }
  for (const d of ['Lb_DieLie', 'Ub_DieLie']) bound.add(d);
  return {
    has: name => bound.has(name),
    info: name => states[name] ?? null,
    duration: name => {
      const s = states[name]?.speed;
      return Number.isFinite(s) && s !== 0 ? 1 / Math.abs(s) : 1;
    },
  };
}

/** Run `seconds` at 60 Hz and log every state entered, with its time. */
function run(actions, seconds, input, log, t0 = 0) {
  const dt = 1 / 60;
  let t = t0;
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    t += dt;
    for (const e of actions.update(input, dt)) {
      log.push({ t: +t.toFixed(3), half: e.half, name: e.name, morph: e.morph });
    }
  }
  return t;
}

function scenario(fn) {
  const log = [];
  fn(log);
  return log;
}

// Standing still, he drops prone: the dive (`Lb_RunStandToLie`, forward input
// not negative), then the lie loop, legs and torso each on their own clock.
results.dive = scenario(log => {
  const a = new SoldierActions(rig());
  let t = run(a, 0.2, { stance: 'stand', family: 'stand' }, log);
  a.stanceChanged('stand', 'prone');
  t = run(a, 1.2, { stance: 'prone', family: 'prone' }, log, t);
});

// Moving backward he lies down the long way: `Lb_StandToLie` into
// `Lb_CrouchToLie`, and the torso's `Ub_StandToLie` has no clip, so it goes
// straight on to `Ub_CrouchToLie`.
results.backward = scenario(log => {
  const a = new SoldierActions(rig());
  let t = run(a, 0.1, { stance: 'stand', family: 'stand' }, log);
  a.stanceChanged('stand', 'prone', { backward: true });
  run(a, 1.2, { stance: 'prone', family: 'prone' }, log, t);
});

// Getting up: `Lb_LieToStand` then `Lb_CrouchToStand`; the torso's
// `Ub_LieToStand` then the clipless `Ub_CrouchToStand`, i.e. the aim.
results.getUp = scenario(log => {
  const a = new SoldierActions(rig());
  let t = run(a, 0.1, { stance: 'prone', family: 'prone' }, log);
  a.stanceChanged('prone', 'stand');
  run(a, 1.0, { stance: 'stand', family: 'stand' }, log, t);
});

// Crouching: the legs' 1/12 s clip, the torso straight into the crouch aim.
results.crouch = scenario(log => {
  const a = new SoldierActions(rig());
  let t = run(a, 0.1, { stance: 'stand', family: 'stand' }, log);
  a.stanceChanged('stand', 'crouch');
  run(a, 0.5, { stance: 'crouch', family: 'crouch' }, log, t);
});

// A reload keeps the torso through a stance change (`isReadyToUse`).
results.reloadThroughDive = scenario(log => {
  const a = new SoldierActions(rig());
  let t = run(a, 0.1, { stance: 'stand', family: 'stand' }, log);
  a.reload();
  t = run(a, 0.5, { stance: 'stand', family: 'stand' }, log, t);
  a.stanceChanged('stand', 'prone');
  run(a, 2.0, { stance: 'prone', family: 'prone' }, log, t);
});

// Prone variants.
results.proneReload = scenario(log => {
  const a = new SoldierActions(rig());
  let t = run(a, 0.1, { stance: 'prone', family: 'prone' }, log);
  a.reload();
  run(a, 2.2, { stance: 'prone', family: 'prone' }, log, t);
});

// An automatic loops its fire while the trigger is held and returns to the
// pose on release; a round during a transition changes nothing.
results.automatic = scenario(log => {
  const a = new SoldierActions(rig());
  let t = run(a, 0.1, { stance: 'stand', family: 'stand' }, log);
  a.fire();
  t = run(a, 0.2, { stance: 'stand', family: 'stand', trigger: true }, log, t);
  a.fire();                                   // a second round: still the loop
  t = run(a, 0.2, { stance: 'stand', family: 'stand', trigger: true }, log, t);
  t = run(a, 0.1, { stance: 'stand', family: 'stand', trigger: false }, log, t);
  a.stanceChanged('stand', 'prone');
  a.fire();                                   // during the dive: ignored
  run(a, 0.2, { stance: 'prone', family: 'prone', trigger: true }, log, t);
});

// A bolt-action rifle: the shot, then the bolt (`Ub_StandReload`), then the pose.
results.bolt = scenario(log => {
  const a = new SoldierActions(rig(NO4));
  let t = run(a, 0.1, { stance: 'stand', family: 'stand' }, log);
  a.fire();
  run(a, 3.2, { stance: 'stand', family: 'stand' }, log, t);
});

// A tree published before the transitions: nothing to play, straight to the
// new stance's loop, and nothing throws.
results.oldTree = scenario(log => {
  const a = new SoldierActions(rig(THOMPSON, { transitions: false }));
  let t = run(a, 0.1, { stance: 'stand', family: 'stand' }, log);
  a.stanceChanged('stand', 'prone');
  a.fire();
  a.reload();
  run(a, 0.3, { stance: 'prone', family: 'prone' }, log, t);
});

// A stance that comes straight back: prone, one world tick standing, prone
// again (the bots' Fire -> Change -> Fire tick). The legs are still lying in
// `Lb_LieToStand`, so they settle back into the lie loop -- no dive.
results.flicker = scenario(log => {
  const a = new SoldierActions(rig());
  let t = run(a, 0.1, { stance: 'prone', family: 'prone' }, log);
  a.stanceChanged('prone', 'stand');
  t = run(a, 2 / 60, { stance: 'stand', family: 'stand' }, log, t);
  a.stanceChanged('stand', 'prone');
  run(a, 1.0, { stance: 'prone', family: 'prone' }, log, t);
});

// Crouch then prone a tick later: the legs are crouching (`Lb_StandToCrouch`
// carries `c_AsmIsCrouching`), so the lie-down is the crouch's.
results.crouchThenProne = scenario(log => {
  const a = new SoldierActions(rig());
  let t = run(a, 0.1, { stance: 'stand', family: 'stand' }, log);
  a.stanceChanged('stand', 'crouch');
  t = run(a, 2 / 60, { stance: 'crouch', family: 'crouch' }, log, t);
  a.stanceChanged('crouch', 'prone');
  run(a, 1.0, { stance: 'prone', family: 'prone' }, log, t);
});

// A family change on the base (standing -> running) re-enters the base.
results.gait = scenario(log => {
  const a = new SoldierActions(rig());
  let t = run(a, 0.1, { stance: 'stand', family: 'stand' }, log);
  run(a, 0.1, { stance: 'stand', family: 'run' }, log, t);
});

// A death: both halves, the die morph, and nothing after it.
results.death = scenario(log => {
  const a = new SoldierActions(rig());
  let t = run(a, 0.1, { stance: 'prone', family: 'prone' }, log);
  a.die('Lb_DieLie', 'Ub_DieLie');
  a.stanceChanged('prone', 'stand');
  a.fire();
  run(a, 1.0, { stance: 'stand', family: 'run' }, log, t);
});
results.dieMorph = DIE_MORPH;

results.entryKeys = {
  still: stanceEntryKey('stand', 'prone', false),
  backward: stanceEntryKey('stand', 'prone', true),
  crouchedBackward: stanceEntryKey('crouch', 'prone', true),
};
results.entries = STANCE_ENTRY;

// The morph: nothing moves on the frame a state is entered, then each bone
// slerps from where it stood toward the clip by `w += dt x morph`.
function bone(angle, y) {
  return { quaternion: { x: 0, y: Math.sin(angle / 2), z: 0, w: Math.cos(angle / 2) },
           position: { x: 0, y, z: 0 } };
}
{
  const b = bone(0, 1.0);
  const blend = new MorphBlend([b]);
  blend.enter(2.0);
  const trace = [];
  for (let i = 0; i < 40; i++) {
    // The mixer writes the new clip's pose every frame: 90 degrees, y 0.5.
    const target = bone(Math.PI / 2, 0.5);
    b.quaternion = { ...target.quaternion };
    b.position = { ...target.position };
    const w = blend.update(1 / 60);
    trace.push({ w: +w.toFixed(4), y: +b.position.y.toFixed(4),
                 angle: +(2 * Math.atan2(b.quaternion.y, b.quaternion.w) * 180 / Math.PI).toFixed(2) });
  }
  results.morph = trace;
}
{
  const b = bone(0, 1.0);
  const blend = new MorphBlend([b]);
  blend.enter(10000);
  const target = bone(Math.PI / 2, 0.5);
  b.quaternion = { ...target.quaternion };
  b.position = { ...target.position };
  results.cut = { w: blend.update(1 / 60), y: b.position.y };
}

console.log(JSON.stringify(results));
