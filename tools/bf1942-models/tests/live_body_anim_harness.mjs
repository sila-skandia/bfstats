// Drives the live body animation modules outside a browser and prints one
// JSON blob. `tests/test_live_body_anim.py` hands in the viewer directory, so
// the files under test are the files the page loads, with their own imports.

import { pathToFileURL } from 'node:url';
import path from 'node:path';

const VIEWER = process.argv[2];
const load = name => import(pathToFileURL(path.join(VIEWER, name)).href);

const { IDLE_DWELL_BASE, IDLE_DWELL_STEPS, IdleClock, SoldierActions, VANILLA_STATES, idleDwell } = await load('soldier-actions.js');
const { LIVE_CLIPS, bodyLowerState, liveFamily, liveHalves, liveLower, recordedClip } = await load('remote-gait.js');
const { LOWER_WIRE, LOWER_WIRE_NONE, decodeSnapshot, encodeSnapshot, lowerStateCode } = await load('netcode.js');
const { HAND_SIGNS, HAND_SIGN_MORPH, HandSignOverlay, handSignState } = await load('hand-sign.js');
const { RADIO_MESSAGES } = await load('radio.js');
const { STANCE_CHAINS, isEjectClip, stanceClip } = await load('stance-clips.js');
const { wantViewmodelClip } = await load('viewmodel-anim.js');
const { SoldierJumpState } = await load('soldier-locomotion.js');

const out = {};

// --- the rig: what a tree baked on 2026-11-13 binds for a Thompson -----------
const BOUND = {
  'stand.lower': {}, 'stand.upper': {}, 'walk.lower': {}, 'walk.upper': {},
  'run.lower': {}, 'run.upper': {}, 'crouch.lower': {}, 'crouch.upper': {},
  'crouchwalk.lower': {}, 'crouchwalk.upper': {}, 'lie.lower': {}, 'lie.upper': {},
  'crawl.lower': {}, 'crawl.upper': {},
  Lb_StandJump: 1 / 1.1, Lb_RunJump: 1 / 1.18, Lb_RunJumpBackward: 1 / 1.2, Lb_RunBackward: 1 / 1.6,
  Lb_TurnLeft: 0.5, Lb_TurnRight: 0.5, Lb_StandRelax: 1 / 0.6,
  Ub_StandJump: 1 / 1.1, Ub_RunJump: 1 / 1.22, Ub_RunBackward: 1 / 1.6,
  Ub_StandRaiseWeapon: 1 / 1.6, Ub_CrouchRaiseWeapon: 1 / 1.6, Ub_LieRaiseWeapon: 1 / 1.6,
  Ub_Idle1: 2.0, Ub_CrouchIdle1: 1.0,
  Ub_Fire: 0.5,
  Lb_StandToCrouch: 1 / 12, Lb_CrouchToStand: 0.1,
};
function rig(random, drop = []) {
  const bound = { ...BOUND };
  for (const name of drop) delete bound[name];
  return {
    has: name => name in bound,
    info: name => (name === 'Ub_Fire' ? { loop: true, morph: 4, then: '_POSE_' } : null),
    duration: name => (typeof bound[name] === 'number' ? bound[name] : 0),
    random,
  };
}
/** A sequence generator for `rig.random`. */
const seq = values => { let i = 0; return () => values[i++ % values.length]; };
const names = (entries, half) => entries.filter(e => half == null || e.half === half).map(e => e.name);

// --- 9: the lower machine's word, and what each half enters ------------------
out.liveLower = Object.fromEntries(
  ['stand', 'walkForward', 'walkBackward', 'runForward', 'runBackward', 'turnLeft', 'turnRight',
   'strafeLeft', 'strafeRight', 'standJump', 'runJump', 'runJumpBackward', 'backward']
    .map(s => [s, liveLower(s)]));
out.liveHalves = {
  runJumpAtRun: liveHalves('runJump', 'run'),
  runJumpBeforeTheBandsCatchUp: liveHalves('runJump', 'stand'),
  standJump: liveHalves('standJump', 'stand'),
  runBackwardAtRun: liveHalves('runBackward', 'run'),
  runBackwardAtWalkSpeed: liveHalves('runBackward', 'walk'),
  runBackwardOldTree: liveHalves('runBackward', 'run', () => false),
  walkBackward: liveHalves('walkBackward', 'walk'),
  crawlBackward: liveHalves('backward', 'crawl'),
  crouchStillBackward: liveHalves('backward', 'crouch'),
  turnStanding: liveHalves('turnLeft', 'stand'),
  turnWhileTheBandsSayWalk: liveHalves('turnRight', 'walk'),
  runForward: liveHalves('runForward', 'run'),
  none: liveHalves(null, 'run'),
};
out.liveFamily = {
  runJump: liveFamily('runJump', 'run', () => true),
  runJumpUnbound: liveFamily('runJump', 'run', () => false),
  runBackward: liveFamily('runBackward', 'run', () => true),
  runBackwardUnbound: liveFamily('runBackward', 'run', () => false),
  walkBackward: liveFamily('walkBackward', 'walk', () => true),
  turnLeft: liveFamily('turnLeft', 'stand', () => true),
  relaxed: liveFamily('stand', 'stand', () => true, true),
  relaxedButTurning: liveFamily('turnRight', 'stand', () => true, true),
  relaxedNoState: liveFamily(null, 'stand', () => true, true),
  crouchNotRelaxed: liveFamily(null, 'crouch', () => true, true),
};
out.liveClips = LIVE_CLIPS;

// The body's own machine is the source: a press at a run is `runJump`.
{
  const lower = new SoldierJumpState();
  const body = { lowerBody: lower, forwardRamp: 0, swimming: false };
  const seen = [];
  lower.transitions({ thr: 1, yaw: 0, look: 0, walk: false, act: false });
  seen.push(bodyLowerState(body));
  lower.transitions({ thr: 1, yaw: 0, look: 0, walk: false, act: true });
  seen.push(bodyLowerState(body));
  lower.reset();
  lower.transitions({ thr: -1, yaw: 0, look: 0, walk: false, act: false });
  seen.push(bodyLowerState(body));
  lower.reset();
  lower.transitions({ thr: 0, yaw: 0, look: -0.02, walk: false, act: false });
  seen.push(bodyLowerState(body));
  lower.reset();
  lower.transitions({ thr: 0, yaw: 0, look: 0.005, walk: false, act: false });
  seen.push(bodyLowerState(body));
  out.bodyLowerState = {
    seen,
    crouchBackward: bodyLowerState({ lowerBody: lower, forwardRamp: -40 }, 'crouch'),
    crouchForward: bodyLowerState({ lowerBody: lower, forwardRamp: 40 }, 'crouch'),
    swimming: bodyLowerState({ lowerBody: lower, forwardRamp: 0, swimming: true }),
  };
}

// A live jump on the two half machines: entered by name, run out, let go.
{
  const a = new SoldierActions(rig(seq([0])));
  const log = [];
  const step = (state, family, dt = 1 / 60) => {
    const live = liveHalves(state, family, a.rig.has);
    const e = a.update({ stance: 'stand', family, reverse: live.reverse, recorded: live }, dt);
    log.push(...e);
    return e;
  };
  step('runForward', 'run');
  log.length = 0;
  step('runJump', 'run');
  out.jumpEntered = log.map(e => ({ half: e.half, name: e.name, morph: e.morph }));
  let frames = 0;
  while (!a.lower.base && frames < 200) { step('runJump', 'run'); frames++; }
  out.jumpSeconds = frames / 60;
  out.jumpEndsOn = { lower: a.lower.name, upper: a.upper.name };
  log.length = 0;
  step('runForward', 'run');
  out.afterJumpNoReentry = log.length;
  // The backward run: its own clip while the state holds, the gait when it lets go.
  step('runBackward', 'run');
  out.backwardRun = { lower: a.lower.name, upper: a.upper.name, loop: a.lower.loop };
  step('runForward', 'run');
  out.backwardRunLeft = { lower: a.lower.name, upper: a.upper.name };
  // A backward walk: the walk reversed.
  log.length = 0;
  step('walkBackward', 'walk');
  out.backwardWalk = log.map(e => ({ half: e.half, name: e.name, reverse: !!e.reverse }));
  // The turn on the spot: the legs alone.
  step('stand', 'stand');
  log.length = 0;
  step('turnLeft', 'stand');
  out.turn = { entered: log.map(e => ({ half: e.half, name: e.name, morph: e.morph })), upper: a.upper.name };
  log.length = 0;
  step('stand', 'stand');
  out.turnLeft = log.map(e => ({ half: e.half, name: e.name, morph: e.morph }));
}

// The draw of a new item, by the pose the legs hold; kept through a stance change.
{
  const a = new SoldierActions(rig(seq([0])));
  a.update({ stance: 'stand', family: 'stand' }, 1 / 60);
  const drew = a.draw();
  const first = { name: a.upper.name, action: a.upper.action };
  const e = a.update({ stance: 'stand', family: 'stand' }, 0);
  a.stanceChanged('stand', 'crouch', {});
  const through = a.upper.name;
  let t = 0;
  while (!a.upper.base && t < 5) { a.update({ stance: 'crouch', family: 'crouch' }, 1 / 60); t += 1 / 60; }
  const b = new SoldierActions(rig(seq([0])));
  b.update({ stance: 'prone', family: 'prone' }, 1 / 60);
  b.draw();
  const c = new SoldierActions(rig(seq([0]), ['Ub_StandRaiseWeapon']));
  c.update({ stance: 'stand', family: 'stand' }, 1 / 60);
  out.draw = { drew, first, morph: e.find(x => x.half === 'upper')?.morph ?? null,
               through, seconds: Math.round(t * 1000) / 1000, endsOn: a.upper.name,
               prone: b.upper.name, oldTree: c.draw() };
}

// The idle timers (ANIM-6).
out.idleDwell = {
  base: IDLE_DWELL_BASE, steps: IDLE_DWELL_STEPS,
  draws: [0, 0.24, 0.25, 0.5, 0.75, 0.999].map(r => idleDwell(() => r)),
};
{
  const clock = new IdleClock(seq([0.5, 0.7]));
  const fired = [];
  let t = 0;
  clock.step('a', 0, 3);
  for (let i = 0; i < 60 * 8 && !fired.length; i++) {
    t += 1 / 60;
    const k = clock.step('a', 1 / 60, 3);
    if (k >= 0) fired.push({ t: Math.round(t * 100) / 100, k });
  }
  out.idleClock = { fired, afterFire: clock.left, rekeyed: (clock.step('b', 0, 3), clock.left) };
}
{
  // random: lower dwell, upper dwell, then the draws.
  const a = new SoldierActions(rig(seq([0, 0.26, 0.0, 0.0, 0.5, 0.5, 0.99, 0.4])));
  const log = [];
  let t = 0;
  const run = (seconds, input) => {
    for (let i = 0; i < Math.round(seconds * 60); i++) {
      t += 1 / 60;
      for (const e of a.update({ stance: 'stand', family: 'stand', idle: true, ...input }, 1 / 60)) {
        log.push({ t: Math.round(t * 100) / 100, half: e.half, name: e.name, morph: e.morph });
      }
    }
  };
  run(12, {});
  out.idle = { log: log.slice(), lower: a.lower.name, lowerLoops: a.lower.loop };
  // Walking off takes the legs out of the relaxed stand.
  log.length = 0;
  run(0.1, { family: 'walk' });
  out.idleLeft = log.filter(e => e.half === 'lower').map(e => e.name);
  // A replay (no `idle`) never runs them.
  const r = new SoldierActions(rig(seq([0])));
  let entries = 0;
  for (let i = 0; i < 60 * 20; i++) entries += r.update({ stance: 'stand', family: 'stand' }, 1 / 60).length;
  out.idleOffWithoutTheFlag = { entries, lower: r.lower.name };
  // A grip with no third-person fidget: the timer runs, nothing is entered.
  const n = new SoldierActions(rig(seq([0.3]), ['Ub_Idle1', 'Ub_CrouchIdle1']));
  const upper = [];
  for (let i = 0; i < 60 * 30; i++) {
    for (const e of n.update({ stance: 'stand', family: 'stand', idle: true }, 1 / 60)) {
      if (e.half === 'upper') upper.push(e.name);
    }
  }
  out.idleNoClip = upper;
}
out.vanillaIdles = {
  standLower: VANILLA_STATES['stand.lower'].idles,
  standUpper: VANILLA_STATES['stand.upper'].idles,
  crouchUpper: VANILLA_STATES['crouch.upper'].idles,
  turnLeft: VANILLA_STATES.Lb_TurnLeft, turnRight: VANILLA_STATES.Lb_TurnRight,
  relax: VANILLA_STATES.Lb_StandRelax,
};
out.recordedClips = {
  turn: recordedClip('Lb_TurnLeft', 'lower'), relax: recordedClip('Lb_StandRelax', 'lower'),
  run: recordedClip('Lb_RunForward', 'lower'),
};

// --- the snapshot's lower state ----------------------------------------------
{
  const players = [
    { slot: 1, alive: true, team: 1, x: 1, y: 2, z: 3, yaw: 0, pitch: 0, hp: 100, lower: 'runJump', ack: 1 },
    { slot: 2, alive: true, team: 2, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, hp: 100, lower: 'backward', crouch: true, ack: 1 },
    { slot: 3, alive: true, seated: true, seatIndex: 3, vehicleId: 4, team: 2, hp: null, ack: 0 },
    { slot: 4, alive: true, team: 2, hp: null, ack: 0 },
    { slot: 5, alive: true, team: 2, hp: null, lower: 'nonsense', ack: 0 },
  ];
  const bytes = new Uint8Array(encodeSnapshot(9, players, []).buffer);
  const decoded = decodeSnapshot(bytes);
  out.wire = {
    order: [...LOWER_WIRE], none: LOWER_WIRE_NONE,
    codes: Object.fromEntries(LOWER_WIRE.map(s => [s, lowerStateCode(s)])),
    bytes: bytes.length,
    seatBytes: players.map((_, i) => bytes[5 + i * 31 + 26]),
    decoded: decoded.players.map(p => ({ slot: p.slot, seatIndex: p.seatIndex, lower: p.lower })),
  };
  // An older server's record: 0xff in the seat byte on foot.
  bytes[5 + 26] = 0xff;
  out.wire.oldServer = decodeSnapshot(bytes).players[0].lower;
}

// --- 34: the hand signs ----------------------------------------------------
out.handSigns = {
  order: [...HAND_SIGNS], morph: HAND_SIGN_MORPH,
  states: [0, 6, 7, 'Medic', 'handsign_come', 'Wave'].map(handSignState),
  radio: Object.fromEntries(Object.entries(RADIO_MESSAGES)
    .filter(([, m]) => m.sign).map(([id, m]) => [id, [m.kind, m.sign, handSignState(m.sign)]])),
};
{
  // One bone turning a quarter turn about Y over the clip, from identity.
  const track = {
    name: 'Bip01_L_UpperArm.quaternion',
    createInterpolant() {
      return { evaluate: t => {
        const half = (Math.PI / 2) * Math.min(1, t) / 2;
        return [0, Math.sin(half), 0, Math.cos(half)];
      } };
    },
  };
  const bone = { quaternion: { x: 0, y: 0, z: 0, w: 1 }, position: { x: 0, y: 0, z: 0 } };
  const clips = [{ name: 'HandSign_Medic', duration: 1, tracks: [track], userData: { speed: 1, morph: 2.5 } },
                 { name: 'Ub_Fire', duration: 1, tracks: [track], userData: {} }];
  const sign = new HandSignOverlay(clips, name => (name === 'Bip01_L_UpperArm' ? bone : null));
  const angle = () => Math.round(2 * Math.atan2(bone.quaternion.y, bone.quaternion.w) * 180 / Math.PI * 100) / 100;
  const frames = [];
  out.signPlay = { unknown: sign.play('Wave'), notASign: sign.has('Ub_Fire'), medic: sign.play('Medic') };
  let t = 0;
  for (let i = 0; i < 70; i++) {
    sign.restore();
    const beforeMixer = angle();
    // The body's mixer holds this bone still and so writes nothing.
    const playing = sign.update(1 / 60);
    if (i === 0 || i === 6 || i === 12 || i === 24 || i === 30 || i === 59 || i === 60 || i === 61) {
      frames.push({ i, t: Math.round(t * 1000) / 1000, playing, restored: beforeMixer, drawn: angle() });
    }
    t += 1 / 60;
  }
  sign.restore();
  out.signFrames = frames;
  out.signAfter = { playing: sign.playing, angle: angle() };
}

// --- 35: the clip eject -----------------------------------------------------
out.eject = {
  chains: STANCE_CHAINS.eject,
  stand: stanceClip('eject', 'stand', n => n === 'eject' || n === 'proneEject'),
  crouch: stanceClip('eject', 'crouch', n => n === 'eject' || n === 'proneEject'),
  prone: stanceClip('eject', 'prone', n => n === 'eject' || n === 'proneEject'),
  proneOnAStandOnlyRig: stanceClip('eject', 'prone', n => n === 'eject'),
  is: ['eject', 'proneEject', 'reload', null].map(isEjectClip),
};
{
  const base = {
    reload: 0, reloadPlayed: false, reloadRunning: false, chainRunning: false, deployRunning: false,
    fireRunning: false, fireLoops: false, fireReturnsToReload: false, fireReturnsToDeploy: false,
    fireReturnsToBolt: false, hasBolt: false, boltRunning: false, firing: false, hasFire: true,
    fireVariants: null, altRunning: false, hasReload: true, hasDeploy: true,
    gait: 'stand', stance: 'stand', has: n => ['idle', 'fire', 'reload', 'eject'].includes(n),
    fidget: null, fidgetRunning: false, fidgetDue: false, fidgetPick: null,
  };
  out.ejectSelection = {
    kept: wantViewmodelClip({ ...base, active: 'eject', ejectRunning: true }),
    over: wantViewmodelClip({ ...base, active: 'eject', ejectRunning: false }),
    reloadCutsIn: wantViewmodelClip({ ...base, active: 'eject', ejectRunning: true, reload: 2.5 }),
  };
}

console.log(JSON.stringify(out));
