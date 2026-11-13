// Drives `viewer/soldier-sound.js` and `viewer/voice-pool.js` under node and
// prints one JSON blob. `tests/test_soldier_sound.py` copies both in beside it.
import {
  SST, SoldierSound, SoldierSoundState, ENGINE_FREQUENCIES, VANILLA_FREQUENCIES,
  LAND_GATE, CONTACT_NORMAL_Y, MATERIAL_PATCH, STANCE_STATES, VANILLA_STATE_TRIGGERS,
  distanceGain, triggerId, triggerName, triggerOfState,
} from './soldier-sound.js';
import { VoicePool, poolSizes, voiceKind, DEFAULT_CHANNELS } from './voice-pool.js';

const r = { SST, ENGINE_FREQUENCIES, VANILLA_FREQUENCIES, LAND_GATE, CONTACT_NORMAL_Y,
            MATERIAL_PATCH, STANCE_STATES, VANILLA_STATE_TRIGGERS };
const DT = 1 / 60;

/** Run `frames` of one trigger; the seconds each sound fired at. */
function run(machine, trigger, frames, t0 = 0, log = []) {
  for (let i = 0; i < frames; i++) {
    const out = machine.update(DT, typeof trigger === 'function' ? trigger(i) : trigger);
    if (out) log.push([+(t0 + i * DT).toFixed(3), out.name, out.patches]);
  }
  return log;
}
const fresh = (rand = 0.5) => new SoldierSound(VANILLA_FREQUENCIES, () => rand);

// The cadences: the first step at once (an interval starts at 0), then one
// every `frequency + random * rand` seconds, to the frame.
r.cadence = {};
for (const [name, id] of [['run', SST.Run], ['walk', SST.Walk], ['crouch', SST.CrouchMove],
                          ['crawl', SST.CrawlMove], ['swim', SST.Swim], ['ladder', SST.ClimbLadder]]) {
  const log = run(fresh(), id, 600);
  r.cadence[name] = { count: log.length, gap: +(log[2][0] - log[1][0]).toFixed(3),
                      patches: log[0][2], first: log[0][0] };
}

// Stand: only on the frame the trigger changes, and not within 1.5 s of the
// last stop.
{
  const m = fresh();
  const log = [];
  run(m, SST.Run, 120, 0, log);          // 2 s of running
  run(m, SST.Stand, 60, 2, log);         // stop: sounds (stand timer is 2 s)
  run(m, SST.Run, 30, 3, log);
  run(m, SST.Stand, 60, 3.5, log);       // 1.5 s after the last stop: not yet
  r.stand = log.filter(e => e[1] === 'c_SstStand').map(e => [e[0], e[2]]);
}

// The one-shots fire on the frame the trigger changes, once.
{
  const m = fresh();
  const log = [];
  run(m, SST.None, 10, 0, log);
  run(m, SST.ToCrouch, 5, 1, log);
  run(m, SST.None, 30, 2, log);
  run(m, SST.FromCrouch, 6, 3, log);
  run(m, SST.ToSwim, 20, 4, log);
  run(m, SST.SwimStand, 20, 5, log);
  run(m, SST.HealedByMedic, 1, 6, log);
  run(m, SST.None, 1, 6.1, log);
  run(m, SST.HealedByMedic, 1, 6.2, log);
  r.oneShots = log.map(e => [e[1], e[2]]);
}

// A jump: the script on the first frame, no walk or run in the air, and the
// landing on the first floor contact, on the material's patch. A second
// landing inside a second is silent. Walking off a ledge lands in silence.
{
  const m = fresh();
  const log = [];
  run(m, SST.Run, 30, 0, log);
  const before = log.length;
  run(m, SST.Jump, 52, 0.5, log);               // the jump state, 26 ticks
  run(m, SST.Run, 20, 1.4, log);                // state over, still in the air
  m.setMaterial(MATERIAL_PATCH.wood);           // the floor
  run(m, SST.Run, 1, 1.75, log);
  run(m, SST.Run, 30, 1.77, log);
  r.jump = log.slice(before).map(e => [e[1], e[2]]);
  // Again at once: the landing's 1 s gate.
  const log2 = [];
  run(m, SST.Jump, 10, 2.3, log2);
  m.setMaterial(null);
  run(m, SST.Run, 1, 2.5, log2);
  r.jumpAgain = log2.map(e => e[1]);
  const ledge = fresh();
  const log3 = [];
  run(ledge, SST.Run, 30, 0, log3);
  ledge.setMaterial(MATERIAL_PATCH.grass);
  run(ledge, SST.Run, 30, 0.5, log3);
  r.ledge = [...new Set(log3.map(e => e[1]))];
}

// The body's trigger.
{
  const s = new SoldierSoundState();
  const seq = [];
  const step = (view, n = 1) => { let t; for (let i = 0; i < n; i++) t = s.trigger(view, DT); seq.push(triggerName(t)); };
  step({ stance: 'stand', gait: 'stand' });
  step({ stance: 'stand', gait: 'run' });
  step({ stance: 'stand', gait: 'walk' });
  step({ stance: 'crouch', gait: 'stand' });          // Lb_StandToCrouch
  step({ stance: 'crouch', gait: 'crouch' }, 10);     // moving, crouched
  step({ stance: 'crouch', gait: 'stand' });          // Lb_Crouch: none
  step({ stance: 'prone', gait: 'stand' });           // Lb_CrouchToLie
  step({ stance: 'prone', gait: 'prone' }, 60);       // crawling
  step({ stance: 'crouch', gait: 'stand' });          // Lb_LieToCrouch
  step({ stance: 'stand', gait: 'stand' }, 40);       // Lb_CrouchToStand, then Lb_Stand
  step({ stance: 'prone', gait: 'run', dive: true }); // the dive: no trigger
  step({ stance: 'stand', gait: 'stand' });           // Lb_LieToStand: none...
  step({ stance: 'stand', gait: 'stand' }, 21);       // ...then Lb_CrouchToStand
  step({ stance: 'stand', gait: 'stand' }, 30);
  step({ stance: 'prone', gait: 'stand', backward: true }); // Lb_StandToLie
  step({ stance: 'stand', gait: 'stand' }, 60);       // up again, settled
  step({ stance: 'stand', gait: 'run', jumping: true });
  step({ stance: 'stand', gait: 'stand', swim: 'swimStart' });
  step({ stance: 'stand', gait: 'stand', swim: 'swimForward' });
  step({ stance: 'stand', gait: 'stand', swim: 'swimFloat' });
  step({ stance: 'stand', gait: 'stand', swim: 'swimEnd' });
  step({ stance: 'stand', gait: 'stand', climbing: true, climbY: 1 });
  step({ stance: 'stand', gait: 'stand', climbing: true, climbY: 1.1 });
  step({ stance: 'stand', gait: 'stand', climbing: true, climbY: 1.1 });
  step({ stance: 'stand', gait: 'run', quiet: true });
  r.body = seq;
}
r.states = {
  crouchForward: triggerName(triggerOfState('Lb_CrouchForward')),
  ladder: triggerName(triggerOfState('Lb_ClimbLadder2B')),
  ladderIdle: triggerOfState('Lb_ClimbLadderIdle1'),
  dive: triggerOfState('Lb_RunStandToLie'),
  // The parachute's and the deaths' sounds have their own paths.
  killed: triggerOfState('Lb_DieHead'),
  fromManifest: triggerName(triggerOfState('Lb_Mod', { Lb_Mod: 'c_SstCrawlMove' })),
  id: triggerId('c_sstclimbladder'),
};
r.ramp = [0, 2, 3, 4, 5, 9].map(d => +distanceGain([2, 6, 1, -1], d).toFixed(3));
r.noRamp = distanceGain(undefined, 50);

// --- the voice pool -------------------------------------------------------
r.sizes = { 32: poolSizes(32), 64: poolSizes(64), 16: poolSizes(16), default: DEFAULT_CHANNELS };
r.kinds = [voiceKind(true, 2), voiceKind(false, 1), voiceKind(false, 2)];
{
  const pool = new VoicePool(8);          // 4 mono, 2 stereo, 2 3D
  const stopped = [];
  const ask = (name, priority, distance, kind = '3d') =>
    pool.claim({ kind, priority, distance, stop: () => stopped.push(name) });
  const a = ask('a', 5, 10);
  const b = ask('b', 0, 50);
  r.pool = {};
  r.pool.full = [!!a, !!b];
  // The candidate is the oldest (a), not the cheapest (b): a lower asker
  // gets nothing though b would have lost to it.
  r.pool.lowerRefused = ask('c', 3, 1) === null;
  // Equal priority: only when the candidate is strictly farther.
  r.pool.equalNearerCandidate = ask('d', 5, 20) === null;
  r.pool.equalSameDistance = ask('d2', 5, 10) === null;
  const e = ask('e', 5, 2);               // a at 10 is farther than 2: taken
  r.pool.equalFartherCandidate = !!e;
  r.pool.stoppedAfterEqual = stopped.slice();
  // Higher priority takes the oldest, now b.
  const f = ask('f', 1, 500);
  r.pool.higherTakes = !!f;
  r.pool.stopped = stopped.slice();
  // A released voice is free again.
  pool.release(e);
  r.pool.afterRelease = !!ask('g', -5, 900);
  // 2D: the oldest of the kind is taken outright, whatever the priorities.
  for (const n of ['m1', 'm2', 'm3', 'm4']) ask(n, 11, 0, 'mono');
  r.pool.monoFifth = !!ask('m5', -12, 0, 'mono');
  ask('s1', 0, 0, 'stereo'); ask('s2', 0, 0, 'stereo');
  r.pool.stereoThird = !!ask('s3', 0, 0, 'stereo');
  r.pool.stopped2d = stopped.slice(2);
  r.pool.stats = pool.stats();
  // A distance that moves is read when it is compared.
  const live = new VoicePool(7);          // one 3D voice
  let far = 5;
  live.claim({ kind: '3d', priority: 0, distance: () => far, stop: () => {} });
  const first = live.claim({ kind: '3d', priority: 0, distance: 10 });
  far = 50;
  r.pool.liveDistance = [first === null, live.claim({ kind: '3d', priority: 0, distance: 10 }) !== null];
}
process.stdout.write(JSON.stringify(r));
