// `audit_replay_states.mjs`'s pure half under node: the clip vocabulary and
// the recorded-against-drawn count, over small synthetic recordings read with
// the viewer's own helpers (bodyAt, kitAt, lifeAt, lowerHeldByLod,
// recordedGait). No network, no browser: main() is gated on being invoked as
// a script, so the import is side-effect free.
//
// Same pattern as `replay_assets_harness.mjs` -- one node run, one JSON report.

import path from 'node:path';
import { pathToFileURL } from 'node:url';

const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.join(here, '..');
const { installModuleHooks, viewerDir } = await import(pathToFileURL(path.join(root, 'sim', 'env.mjs')).href);
const viewer = viewerDir(path.join(root, 'viewer'));
installModuleHooks(viewer);
const recording = await import(pathToFileURL(path.join(viewer, 'replay-recording.js')).href);
const gait = await import(pathToFileURL(path.join(viewer, 'remote-gait.js')).href);
const lean = await import(pathToFileURL(path.join(viewer, 'strafe-lean.js')).href);
const audit = await import(pathToFileURL(path.join(root, 'audit_replay_states.mjs')).href);
const { auditFrames, drawnFamily, upperKind, windowsFor, runsOf } = audit;

const h = {
  bodyAt: recording.bodyAt, kitAt: recording.kitAt, lifeAt: recording.lifeAt, nameAt: recording.nameAt,
  lowerHeldByLod: recording.lowerHeldByLod, recordedGait: gait.recordedGait,
  strafeLeanTarget: lean.strafeLeanTarget, strafeLeanAt: lean.strafeLeanAt, latestAt: recording.latestAt,
};

// A recording of one soldier (nid 5, pid 1): `states` is [t, lower, upper]
// rows by name, `kits` the life's kits, `lods` his AI LOD rows.
function recordingOf({ states, kits = [{ t: 0, tmpl: 'German_Assault' }], lods = null }) {
  const names = [...new Set(states.flatMap(([, l, u]) => [l, u]))];
  const animStates = names.map(name => ({ name, flags: /^Lb_(Crouch|StandToCrouch)/.test(name) ? 0x20
    : /^Lb_Lie/.test(name) ? 0x40 : 0 }));
  const idx = new Map(names.map((n, i) => [n, i]));
  return {
    animStates,
    stances: new Map([[5, states.map(([t, l, u]) => ({ t, lower: idx.get(l), upper: idx.get(u), item: 0 }))]]),
    lives: [{ nid: 5, created: 0, kits, kitTemplate: kits[0].tmpl }],
    players: new Map([[1, { name: 'Tester', ai: true }]]),
    lods: lods ? new Map([[1, lods]]) : undefined,
  };
}

// Frames at 30 Hz from t0 to t1, each with the drawn fields of `drawn(t)`.
function framesOf(t0, t1, drawn, w = 0) {
  const out = [];
  for (let t = t0; t <= t1 + 1e-9; t += 1 / 30) {
    out.push({ t: +t.toFixed(4), pid: 1, nid: 5, drawn: true, lower: 'stand.lower', upper: 'stand.upper',
      kit: 'German_Assault', settle: false, w, ...drawn(t) });
  }
  return out;
}

const tallyOf = (r, check, key) => r.tally.find(x => x.check === check && x.key === key) ?? null;
const results = {};

results.vocab = {
  lie: drawnFamily('lie', gait.recordedGait),
  runLower: drawnFamily('run.lower', gait.recordedGait),
  standLower: drawnFamily('stand.lower', gait.recordedGait),
  jump: drawnFamily('Lb_RunJump', gait.recordedGait),
  junk: drawnFamily('nonsense', gait.recordedGait),
  fireEnd: upperKind('Ub_FireEndMp40'),
  fireDrawn: upperKind('Ub_Fire'),
  altFire: upperKind('Ub_LieAltFireKnife'),
  reload: upperKind('Ub_LieReload'),
  bolt: upperKind('Ub_StandBoltOperateK98'),
  hit: upperKind('Ub_HitBackCrouch'),
  hitLie: upperKind('Ub_HitLie'),
  raise: upperKind('Ub_CrouchRaiseWeaponMp40'),
  reset: upperKind('Ub_StandResetRaiseWeaponGrenade'),
  jumpUpper: upperKind('Ub_RunJump'),
  gaitUpper: upperKind('run.upper'),
};

results.windows = {
  short: windowsFor(185, {}),
  long: windowsFor(1800, { n: 4, len: 60 }),
  given: windowsFor(1800, { from: 100, to: 130 }),
};

results.runs = runsOf([
  { t: 0, nid: 5, pid: 1, w: 0, v: 'a' }, { t: 0.1, nid: 5, pid: 1, w: 0, v: 'a' },
  { t: 0.2, nid: 5, pid: 1, w: 0, v: null }, { t: 0.3, nid: 5, pid: 1, w: 0, v: 'a' },
  { t: 0.4, nid: 5, pid: 1, w: 1, v: 'a' },
], f => f.v).map(r => [r.w, r.value, r.t0, r.t1, r.frames.length]);

// A recorded hit flinch the page never draws: one episode, none drawn.
{
  const rec = recordingOf({ states: [[0, 'Lb_Stand', 'Ub_StandRelax'], [1, 'Lb_Stand', 'Ub_HitChestStand'],
    [2, 'Lb_Stand', 'Ub_StandRelax']] });
  const r = auditFrames(rec, framesOf(0, 3, () => ({})), h);
  results.hitMissed = { tally: tallyOf(r, 'upper', 'hit'), misses: r.misses.filter(m => m.check === 'upper') };
}

// The same flinch drawn 0.2 s after the recorded state ends still counts.
{
  const rec = recordingOf({ states: [[0, 'Lb_Stand', 'Ub_StandRelax'], [1, 'Lb_Stand', 'Ub_HitChestStand'],
    [1.5, 'Lb_Stand', 'Ub_StandRelax']] });
  const r = auditFrames(rec, framesOf(0, 3, t => (t > 1.65 && t < 1.75 ? { upper: 'Ub_HitChestStand' } : {})), h);
  results.hitLate = tallyOf(r, 'upper', 'hit');
}

// Five recorded flinches, none drawn: under the share, a failure.
{
  const states = [];
  for (let i = 0; i < 5; i++) states.push([i * 2, 'Lb_Stand', 'Ub_StandRelax'], [i * 2 + 1, 'Lb_Stand', 'Ub_HitLie']);
  const rec = recordingOf({ states });
  const r = auditFrames(rec, framesOf(0, 10, () => ({})), h);
  results.hitFails = r.failures;
}

// A recorded run drawn as a run, and one drawn standing.
{
  const rec = recordingOf({ states: [[0, 'Lb_RunForward', 'Ub_StandRelax'], [2, 'Lb_Stand', 'Ub_StandRelax'],
    [3, 'Lb_RunForward', 'Ub_StandRelax'], [5, 'Lb_Stand', 'Ub_StandRelax']] });
  const r = auditFrames(rec, framesOf(0, 6, t => (t < 2 ? { lower: 'run.lower' } : {})), h);
  results.lower = { run: tallyOf(r, 'lower', 'Lb_RunForward'),
    misses: r.misses.filter(m => m.check === 'lower').map(m => [m.t0, m.recorded]) };
}

// A bot at AI LOD 2 resting in Lb_Stand while his body runs: excused, and
// from the frame his LOD drops to 0 the state is judged again.
{
  const rec = recordingOf({ states: [[0, 'Lb_Stand', 'Ub_StandRelax']],
    lods: [{ t: 0, lod: 2 }, { t: 3, lod: 0 }] });
  const r = auditFrames(rec, framesOf(0, 6, t => (t < 3 ? { lower: 'run.lower' } : {})), h);
  results.lod = { stand: tallyOf(r, 'lower', 'Lb_Stand'), misses: r.misses.length };
}

// A kit picked up at 2 s and drawn in the old kit for 1.5 s more.
{
  const rec = recordingOf({ states: [[0, 'Lb_Stand', 'Ub_StandRelax']],
    kits: [{ t: 0, tmpl: 'German_Medic' }, { t: 2, tmpl: 'German_Scout' }] });
  const r = auditFrames(rec, framesOf(0, 5, t => ({ kit: t < 3.5 ? 'German_Medic' : 'German_Scout' })), h);
  results.kit = { misses: r.misses.filter(m => m.check === 'kit').map(m => [m.recorded, m.drawn, m.t0]),
    failures: r.failures, kitShare: r.frames.kitShare };
}

// A body missing for 3 s, outside a seek's settle, fails; one missing only
// while the seek settles is not judged.
{
  const rec = recordingOf({ states: [[0, 'Lb_Stand', 'Ub_StandRelax']] });
  const r = auditFrames(rec, framesOf(0, 8, t => ({ drawn: !(t > 4 && t < 7), settle: t < 1 })), h);
  const settled = auditFrames(rec, framesOf(0, 8, t => ({ drawn: t > 3, settle: t <= 3 })), h);
  results.body = { failures: r.failures, drawnShare: r.frames.drawnShare,
    settledMisses: settled.misses.length, settledWait: settled.seek };
}

// The strafe lean: five right strafes and a forward-left diagonal in the
// state bits. A page that draws no lean misses all six and fails; one that
// draws the recorded lean draws them all, and a lean of the wrong sign is a
// miss.
{
  const states = [];
  for (let i = 0; i < 5; i++) states.push([i * 2, 'Lb_RunForward', 'Ub_StandRelax', 0x1], [i * 2 + 1, 'Lb_StrafeRight', 'Ub_StandRelax', 0x8]);
  states.push([10, 'Lb_RunForward', 'Ub_StandRelax', 0x5], [11, 'Lb_RunForward', 'Ub_StandRelax', 0x1]);
  const rec = recordingOf({ states: states.map(([t, l, u]) => [t, l, u]) });
  rec.stances.get(5).forEach((row, i) => { row.bits = states[i][3]; });
  const want = t => lean.strafeLeanAt(rec.stances.get(5), t);
  const none = auditFrames(rec, framesOf(0, 12, () => ({ lower: 'run.lower', lean: null })), h);
  const drawn = auditFrames(rec, framesOf(0, 12, t => ({ lower: 'run.lower', lean: want(t) })), h);
  const flipped = auditFrames(rec, framesOf(0, 12, t => ({ lower: 'run.lower', lean: -want(t) })), h);
  // A 0.1 s tap right out of a settled left strafe: the engine's lean is
  // still on the left when the tap ends, so the tap is excused, not missed.
  const tapStates = [[0, 'Lb_StrafeLeft', 'Ub_StandRelax', 0x4], [2, 'Lb_StrafeRight', 'Ub_StandRelax', 0x8],
    [2.1, 'Lb_StrafeLeft', 'Ub_StandRelax', 0x4]];
  const tapRec = recordingOf({ states: tapStates.map(([t, l, u]) => [t, l, u]) });
  tapRec.stances.get(5).forEach((row, i) => { row.bits = tapStates[i][3]; });
  const tap = auditFrames(tapRec, framesOf(0, 3, t => ({ lower: 'run.lower', lean: lean.strafeLeanAt(tapRec.stances.get(5), t) })), h);
  results.lean = {
    tap: tallyOf(tap, 'lean', 'right'),
    none: { right: tallyOf(none, 'lean', 'right'), left: tallyOf(none, 'lean', 'left diagonal'), failures: none.failures },
    drawn: { right: tallyOf(drawn, 'lean', 'right'), left: tallyOf(drawn, 'lean', 'left diagonal'), failures: drawn.failures },
    flippedMisses: flipped.misses.filter(m => m.check === 'lean').length,
  };
}

console.log(JSON.stringify(results));
