// Drives `viewer/ctf.js` (with `viewer/round-state.js` behind it) outside a
// browser and prints one JSON blob. `tests/test_ctf.py` copies both modules
// in under their own names, so the files under test are the files the page
// loads.

import { createCtf, ctfPatch, ctfLine, normaliseBase, DROP_HEIGHT, FLAG_DEFAULTS }
  from './ctf.js';
import { createRoundState, SCORE_MSG } from './round-state.js';

const results = {};

// El Alamein's CTF script: UKbase (team 2) and GEbase (team 1), the vanilla
// FlagBase templates (radius 5, flag at 0/7.6/0), the flags' own radius 5
// and TimeToReSpawn 30.
const bases = [
  { name: 'UKbase', template: 'UKbase', team: 2, position: [1694.08, 60, -804.904],
    radius: 5, flagLocation: [0, 7.6, 0],
    flag: { template: 'BrittishFlag', team: 2, radius: 5, timeToRespawn: 30, nation: 'brit' } },
  { name: 'GEbase', template: 'GEbase', team: 1, position: [451.573, 40.2, -1271.61],
    radius: 5, flagLocation: [0, 7.6, 0],
    flag: { template: 'GermanFlag', team: 1, radius: 5, timeToRespawn: 30, nation: 'ger' } },
];
const vanilla = { files: {
  'ScoreManagerSettings.con': { kill: 1, death: 0, capture: 10, attack: 2, defence: 5, tk: -2 },
  'ScoreManagerSettingsCTF.con': { kill: 1, death: 0, capture: 10, attack: 0, defence: 3, tk: -2 },
} };

const ukBase = bases[0].position, geBase = bases[1].position;
const at = (p, dx = 0, dy = 0, dz = 0) => [p[0] + dx, p[1] + dy, p[2] + dz];
const player = (id, team, position, extra = {}) => ({ id, team, alive: true, onFoot: true,
  position, name: `p${id}`, ...extra });

results.defaults = { ...FLAG_DEFAULTS, drop: DROP_HEIGHT };
results.patches = {
  stoleAxis: ctfPatch('stole', 1), stoleAllied: ctfPatch('stole', 2),
  capturedAxis: ctfPatch('captured', 1), capturedAllied: ctfPatch('captured', 2),
  returnedAxis: ctfPatch('returned', 1), returnedAllied: ctfPatch('returned', 2),
  dropped: ctfPatch('dropped', 1),
};
results.lines = {
  stole: ctfLine('stole', 'Hans', 1),
  captured: ctfLine('captured', 'Smith', 2, { CAPTURED_THE_FLAG: 'captured the flag',
                                              TEAM_CHAT_ALLIES: 'Coalition' }),
  dropped: ctfLine('dropped', 'Otto', 1),
  none: ctfLine('nothing', 'x', 1),
};
results.normalised = normaliseBase({ team: 1, position: [1, 2, 3] });

{
  const round = createRoundState({ settings: vanilla, mode: 'Ctf', scoreLimit: 2 });
  const ctf = createCtf({ bases, round, groundHeight: () => 40 });
  const log = [];
  const step = (players, dt = 1 / 30) => { const ev = ctf.tick(dt, players); log.push(...ev.map(e => e.kind)); return ev; };

  // An Axis soldier walks into the British base: he takes their flag.
  const thief = player(1, 1, at(ukBase, 3, 0, 0));
  const stole = step([thief]);
  const afterSteal = { home: ctf.flags[0].home, carrier: ctf.flags[0].carrier,
                       carried: ctf.carriedBy(1)?.team ?? null };
  // Outside the radius nothing happens.
  const far = createCtf({ bases });
  const farEvents = far.tick(1 / 30, [player(9, 1, at(ukBase, 6, 0, 0))]);

  // He runs home while his own flag is at home: a capture, the British flag
  // back to its base, 10 points and one flag capture for the Axis.
  thief.position = at(geBase, 1, 0, 1);
  const captured = step([thief]);
  const afterCapture = { ukHome: ctf.flags[0].home, carrier: ctf.flags[0].carrier,
    axisCaptures: round.teams[1].captures, score: round.tally(1).score,
    flags: round.tally(1).flags };

  // A second theft; this time a British soldier has the German flag, so the
  // Axis carrier cannot capture until it is back.
  thief.position = at(ukBase, 0, 0, 2);
  step([thief]);
  const brit = player(2, 2, at(geBase, 2, 0, 0));
  step([thief, brit]);
  thief.position = at(geBase, 0, 0, 1);
  brit.position = at(ukBase, 400, 0, 0);
  const blocked = step([thief, brit]);
  const whileAway = { axisCaptures: round.teams[1].captures, ukCarrier: ctf.flags[0].carrier,
                      geCarrier: ctf.flags[1].carrier };

  // The British carrier dies in the open: the German flag falls at the terrain
  // under him plus 1.5; an Axis soldier who reaches it returns it (Defence).
  brit.alive = false;
  const dropped = step([thief, brit]);
  const dropPos = ctf.flags[1].position.slice();
  // Now the Axis carrier is standing at his base with his flag... away, until
  // a teammate returns it.
  const returner = player(3, 1, [dropPos[0] + 2, dropPos[1], dropPos[2]]);
  const returned = step([thief, brit, returner]);
  // Home again: the next frame at his base the carrier captures, and the
  // score limit of 2 ends the round.
  const second = step([thief, brit, returner]);
  results.play = {
    stole: stole.map(e => ({ kind: e.kind, flag: e.flag, team: e.team, player: e.player })),
    afterSteal, farEvents: farEvents.length,
    captured: captured.map(e => ({ kind: e.kind, flag: e.flag, team: e.team })),
    afterCapture, blocked: blocked.map(e => e.kind), whileAway,
    dropped: dropped.map(e => ({ kind: e.kind, team: e.team, player: e.player })), dropPos,
    returned: returned.map(e => ({ kind: e.kind, team: e.team, player: e.player })),
    returnerScore: round.tally(3).score, returnerDefences: round.tally(3).defences,
    second: second.map(e => e.kind),
    round: { status: round.status, winner: round.winner, reason: round.endReason,
             captures: { 1: round.teams[1].captures, 2: round.teams[2].captures } },
    log,
  };
}

{
  // A flag on the ground goes home by itself 30 s after it fell.
  const ctf = createCtf({ bases });
  const p = player(1, 1, at(ukBase, 0, 0, 1));
  ctf.tick(1 / 30, [p]);
  p.alive = false;
  ctf.tick(1 / 30, [p]);
  const ev = [];
  let t = 0;
  while (!ctf.flags[0].home && t < 40) { ev.push(...ctf.tick(1, []).map(e => e.kind)); t += 1; }
  // An enemy walking over a dropped flag picks it up again.
  const ctf2 = createCtf({ bases });
  const a = player(1, 1, at(ukBase, 0, 0, 1));
  ctf2.tick(1 / 30, [a]);
  a.alive = false;
  ctf2.tick(1 / 30, [a]);
  const b = player(4, 1, ctf2.flags[0].position.slice());
  const again = ctf2.tick(1 / 30, [a, b]).map(e => e.kind);
  // A soldier in a vehicle takes nothing; a carrier who climbs into one keeps it.
  const ctf3 = createCtf({ bases });
  const driver = player(5, 1, at(ukBase, 1, 0, 0), { onFoot: false });
  const inVehicle = ctf3.tick(1 / 30, [driver]).map(e => e.kind);
  driver.onFoot = true;
  ctf3.tick(1 / 30, [driver]);
  driver.onFoot = false;
  driver.position = at(geBase, 0, 0, 0);
  const noCaptureInVehicle = ctf3.tick(1 / 30, [driver]).map(e => e.kind);
  const keeps = ctf3.carriedBy(5)?.team ?? null;
  // restartMap: every flag home.
  ctf3.reset();
  results.more = { seconds: t, events: ev, again, inVehicle, noCaptureInVehicle, keeps,
                   resetHome: ctf3.flags.every(f => f.home && f.carrier == null) };
}

console.log(JSON.stringify(results));
