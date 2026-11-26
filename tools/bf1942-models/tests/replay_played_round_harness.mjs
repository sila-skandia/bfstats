// The round a recording is about, of every round it holds (replay-recording.js
// `playedRound`), and where playback opens (`playFromOf`). A server on one
// level on repeat wrote every round into one file before the recorder split
// them (owlserver's q8uwcxrjcg: two empty rounds, a round waited out alone, a
// reset for the player minimum, then the 1v1). Same pattern as
// `replay_debrief_harness.mjs`: the viewer's modules in place, one JSON report.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const { parseRecording, playFromOf } = await import(pathToFileURL(path.join(viewer, 'replay-recording.js')).href);

const text = lines => [{ k: 'h', v: 5, plus: 'server-replay-recorder/3', hz: 30 }, ...lines].map(l => JSON.stringify(l)).join('\n');
const ev = (t, e, fields) => ({ k: 'e', t, e, ...fields });
const status = (t, s, more = {}) => ev(t, 'gameStatus', { status: s, ...more });
const kill = (t, pid, victim) => ev(t, 'score', { pid, kind: 3, victim, weaponName: 'Mp40' });
const summary = rec => ({
  started: rec.roundStarted, ended: rec.roundEnded, kills: rec.kills.map(k => k.t),
  result: rec.roundResult, playFrom: playFromOf(rec),
});
const results = {};

// owlserver's shape: empty rounds ending at 1220 and 2450, a join in play at
// 3046 (its status repeated), a reset with no end at 3148, the 1v1's kills,
// its end at 4731.
results.owl = summary(parseRecording(text([
  status(0, 3), status(19.9, 1), status(1220, 2, { winner: 1, victory: 3 }),
  status(1230, 3), status(1250, 1), status(2450, 2, { winner: 1, victory: 3 }),
  status(2460, 3), status(2480, 1),
  ev(3045.9, 'createPlayer', { pid: 0, name: 'heph', team: 1, ai: 0 }), status(3046, 1),
  ev(3145.3, 'createPlayer', { pid: 1, name: 'Black Mamba', team: 2, ai: 0 }), status(3145.4, 1),
  status(3148.3, 3), status(3168.3, 1),
  kill(3194.3, 0, 1), kill(3231.6, 0, 1), kill(3386.0, 1, 0),
  status(4731.2, 2, { winner: 1, victory: 3 }), status(4731.3, 5, { winner: 1, victory: 3 }),
])));

// One round, as every file the recorder split is: unchanged.
results.one = summary(parseRecording(text([
  status(0, 3), status(5, 1), kill(40, 0, 1), status(900, 2, { winner: 2, victory: 1 }), kill(905, 1, 0),
])));

// A join mid-round: no pre-game, so the round's start is not in the file.
results.joined = summary(parseRecording(text([status(0, 1), kill(30, 0, 1), status(300, 2)])));

// Two rounds, no kills in either: the first, as before.
results.quiet = summary(parseRecording(text([status(0, 3), status(5, 1), status(100, 2), status(110, 3), status(130, 1)])));

console.log(JSON.stringify(results));
