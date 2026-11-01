// The replay's retail scoreboard and its round-end debriefing under node
// (features/replay-feature-sweep-2026-11-01, entries 4 and 5): the score paid
// from the recorded ScoreMsgs or taken from a server recording's `ps`, the
// board's order, the round's result from the record, the log or the tickets,
// and the presenter's show, dismiss and seek back.
//
// Same pattern as `replay_flights_harness.mjs`: the viewer's modules imported
// in place through `sim/env.mjs`'s hooks, one JSON report on stdout.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const [recording, chapters, debrief, roundState] = await Promise.all([
  imp('replay-recording.js'), imp('replay-chapters.js'), imp('replay-debrief.js'), imp('round-state.js'),
]);
const { parseRecording } = recording;
const { boardAt, killsOf, scoreTableOf, scoresAt } = chapters;
const { ReplayDebrief, debriefModel, dismissesDebrief, roundResultOf, ticketSharesOf, ticketWinner } = debrief;

const results = {};
const text = lines => lines.map(l => JSON.stringify(l)).join('\n');
const ev = (t, e, fields) => ({ k: 'e', t, e, ...fields });
const score = (t, pid, kind, victim) => ev(t, 'score', { pid, kind, ...(victim !== undefined ? { victim } : {}) });
const plain = m => Object.fromEntries([...m].map(([k, v]) => [k, v]));

// The pack's points for Conquest (vanilla's ScoreManagerSettings.con).
const pack = { files: { 'ScoreManagerSettings.con': { kill: 1, death: 0, capture: 10, attack: 2, defence: 5, tk: -2 } } };
const packTable = scoreTableOf({ scoreTable: null }, roundState.scoreTable(pack, 'Conquest'));

// --- a client file: no counters, no result ---------------------------------------
//
// Hans (1, Axis), Smith (2, Allies, the recording player) and Otto (3,
// Allies). Smith kills Hans twice and takes a flag (an Attack); Otto kills
// Hans twice; Hans team-kills nobody but kills Otto once. The round ends at
// 100 s on the Axis's last ticket; a kill after it pays nothing.
const client = text([
  { k: 'h', v: 5, plus: '2.0', start: '2026-11-01T10:00:00' },
  ev(0, 'gameStatus', { status: 3 }),
  ev(0.1, 'createPlayer', { pid: 1, name: 'Hans', team: 1, ai: 1 }),
  ev(0.1, 'createPlayer', { pid: 2, name: 'Smith', team: 2, ai: 0 }),
  ev(0.1, 'createPlayer', { pid: 3, name: 'Otto', team: 2, ai: 1 }),
  ev(1, 'gameStatus', { status: 1 }),
  { k: 'tk', t: 1, v: [50, 50] },
  score(10, 2, 3, 1), score(10, 1, 5),
  score(20, 3, 3, 1), score(20, 1, 5),
  score(30, 2, 1),
  score(40, 1, 3, 3), score(40, 3, 5),
  score(50, 3, 3, 1), score(50, 1, 5),
  score(60, 2, 3, 1), score(60, 1, 5),
  { k: 'tk', t: 99, v: [0, 40] },
  ev(100, 'gameStatus', { status: 2 }),
  score(101, 3, 3, 1),
  { k: 'end', t: 110 },
]);
{
  const rec = parseRecording(client);
  const kills = killsOf(rec, []);
  const s = scoresAt(rec, kills, 200, packTable);
  const board = boardAt(rec, kills, 200, { table: packTable, recordingPids: [2] });
  const result = roundResultOf(rec, { levelTickets: { team1: 50, team2: 50 } });
  const logged = roundResultOf(rec, { serverRows: [{ kind: 'roundstats', t: 100, winner: 1 }],
                                      levelTickets: { team1: 50, team2: 50 } });
  const model = debriefModel(rec, { followPid: 2, kills, table: packTable, recordingPids: [2],
                                    levelTickets: { team1: 50, team2: 50 } });
  const modelAxis = debriefModel(rec, { followPid: 1, kills, table: packTable, levelTickets: { team1: 50, team2: 50 } });
  results.client = {
    skipped: rec.skipped, scores: rec.scores.length, end: rec.roundEnded,
    at200: plain(s), at35: plain(scoresAt(rec, kills, 35, packTable)),
    defaults: plain(scoresAt(rec, kills, 200)),
    order: board.map(r => [r.pid, r.score, r.kills, r.deaths, r.local]),
    result, logged,
    noLevel: roundResultOf(rec, {}),
    title: model.words.title, axisTitle: modelAxis.words.title, players: model.players,
  };
}

// A whole tie on a client: its own player first, the rest in the order they
// joined.
{
  const rec = parseRecording(text([
    { k: 'h', v: 5, plus: '2.0' },
    ev(0, 'createPlayer', { pid: 7, name: 'Early', team: 1, ai: 1 }),
    ev(1, 'createPlayer', { pid: 8, name: 'Later', team: 1, ai: 1 }),
    ev(2, 'createPlayer', { pid: 9, name: 'Me', team: 1, ai: 0 }),
  ]));
  results.clientTie = boardAt(rec, [], 5, { recordingPids: [9] }).map(r => r.pid);
}

// --- a server file: the server's own counters and result ---------------------------
//
// pid 5 passes from Alpha (10..40 s, score 9 by his counters) to Zulu; Bravo
// (6) holds medals; Charlie (4) and Bravo tie, Charlie joined later. The
// scoreTable says a kill pays 2. The round ends at 90 s: winner 2, a major
// victory as ScoreManager holds it.
const server = text([
  { k: 'h', v: 5, plus: 'server-replay-recorder/3', start: '2026-11-01T10:00:00', hz: 30 },
  ev(0, 'scoreTable', { kill: 2, death: 0, tk: -2, capture: 10, attack: 2, defence: 5, objective: 5, objectiveTk: -15 }),
  ev(10, 'createPlayer', { pid: 5, name: 'Alpha', team: 1, ai: 1 }),
  ev(10, 'createPlayer', { pid: 6, name: 'Bravo', team: 2, ai: 1 }),
  ev(12, 'createPlayer', { pid: 4, name: 'Charlie', team: 2, ai: 1 }),
  { k: 'ps', t: 10, ps: [[5, 0, 0, 0, 0, 0, 0, 0], [6, 0, 0, 0, 0, 1, 0, 2]] },
  score(20, 5, 3, 6), score(20, 6, 5),
  { k: 'ps', t: 20, ps: [[5, 9, 1, 0, 0, 0, 0, 0], [6, 0, 0, 1, 0, 1, 0, 2]] },
  { k: 'ps', t: 30, ps: [[6, 4, 2, 1, 48, 1, 0, 2], [4, 4, 2, 1, 120, 0, 0, 0]] },
  ev(40, 'destroyPlayer', { pid: 5 }),
  ev(41, 'createPlayer', { pid: 5, name: 'Zulu', team: 1, ai: 1 }),
  score(50, 5, 3, 4),
  { k: 'tk', t: 85, v: [10, 60] },
  ev(90, 'gameStatus', { status: 2, winner: 2, victory: 2 }),
  { k: 'end', t: 95 },
]);
{
  const rec = parseRecording(server);
  const kills = killsOf(rec, []);
  const table = scoreTableOf(rec, roundState.scoreTable(pack, 'Conquest'));
  const s = scoresAt(rec, kills, 60, table);
  results.server = {
    skipped: rec.skipped, table, result: rec.roundResult,
    alphaAt25: scoresAt(rec, kills, 25, table).get(5),
    at60: plain(s),
    order: boardAt(rec, kills, 60, { table }).map(r => r.pid),
    resolved: roundResultOf(rec, { serverRows: [{ kind: 'roundstats', t: 90, winner: 1 }] }),
    model: debriefModel(rec, { followPid: 6, kills, table }),
  };
}

// --- the tickets alone --------------------------------------------------------------
results.tickets = {
  shares: ticketSharesOf({ tickets: [{ t: 1, v: [100, 100] }, { t: 50, v: [30, 0] }], roundEnded: 60, roundStarted: 0 }),
  noStart: ticketSharesOf({ tickets: [{ t: 1, v: [80, 90] }, { t: 50, v: [30, 0] }], roundEnded: 60, roundStarted: null }),
  levelScaled: ticketSharesOf({ tickets: [{ t: 50, v: [100, 50] }], roundEnded: 60 },
                              { levelTickets: { team1: 100, team2: 100 }, maxPlayers: 32 }),
  winners: [
    ticketWinner({ 1: 0.3, 2: 0, tickets: [30, 0] }),
    ticketWinner({ 1: 0, 2: 0.4, tickets: [0, 40] }),
    ticketWinner({ 1: 0, 2: 0, tickets: [0, 0] }),
    ticketWinner({ 1: 0.5, 2: 0.6, tickets: [50, 60] }),
    ticketWinner({ 1: 0.5, 2: 0.5, tickets: [50, 50] }),
  ],
};

// --- the presenter, with no page ------------------------------------------------------
{
  const rec = parseRecording(client);
  const music = [];
  const player = {
    rec, kills: killsOf(rec, []), followPid: 2, recordingPids: [2], serverRows: [], log: null,
    round: null, playing: true, scoreTable: () => packTable,
    ctx: { levelTickets: () => ({ team1: 50, team2: 50 }),
           playRoundMusic: k => music.push(`play:${k}`), stopRoundMusic: () => music.push('stop') },
  };
  const d = new ReplayDebrief(player);
  const frames = [];
  const step = (t, prev, label) => { d.update(t, prev); frames.push([label, d.shown, d.dismissed]); };
  step(99.9, 99.8, 'before');
  step(100.03, 99.9, 'played into');
  const shownState = d.state();
  step(100.06, 100.03, 'held');
  d.dismiss();
  step(100.1, 100.06, 'dismissed');
  step(50, 100.1, 'sought back');
  player.playing = false;
  step(105, 50, 'sought past');
  results.presenter = { frames, title: shownState.title, players: shownState.players.map(p => p.name), music };
}

// --- which keys put the plate away ----------------------------------------------------
{
  const key = (code, key, extra = {}) => ({ code, key, repeat: false, ctrlKey: false, metaKey: false, altKey: false, ...extra });
  const taken = () => true;
  results.dismissKeys = {
    space: dismissesDebrief(key('Space', ' ')),
    escape: dismissesDebrief(key('Escape', 'Escape')),
    held: dismissesDebrief(key('Space', ' ', { repeat: true })),
    shift: dismissesDebrief(key('ShiftLeft', 'Shift')),
    console: dismissesDebrief(key('Backquote', '`')),
    typedInConsole: dismissesDebrief(key('KeyL', 'l'), { keyboardTaken: taken }),
    pageThrows: dismissesDebrief(key('KeyL', 'l'), { keyboardTaken: () => { throw new Error('x'); } }),
  };
}

// --- the board's IN after the round's end ----------------------------------------------
//
// The end game's first tick kills everyone still in the field and destroys
// every hull (ROUND-10), with no kill line. One (Axis) is shot by Two at 20 s
// and stays down; the round ends at 30 s; the field is cleared at 31 s with
// Two on foot and Three in a Sherman. One stays dead by Two's hand; Two and
// Three are dead by the round's end, not by the last man who killed them.
{
  const L = [];
  const line = o => L.push(JSON.stringify(o));
  line({ k: 'h', v: 5, start: '', hz: 10 });
  line(ev(0, 'gameStatus', { status: 1 }));
  for (const [pid, name, team] of [[1, 'One', 1], [2, 'Two', 2], [3, 'Three', 2]]) {
    line(ev(0.1, 'createPlayer', { pid, name, team, ai: 1 }));
  }
  const make = (t, nid, tmpl, team) => {
    line(ev(t, 'createObject', { netId: nid, tmpl, tid: nid, pos: [0, 0, 0], rot: [0, 0, 0] }));
    line({ k: 'o', t, id: nid, tmpl, tid: nid, team, maxhp: 100 });
  };
  make(1, 600, 'GermanSoldier', 1);
  make(1, 700, 'USSoldier', 2);
  make(1, 800, 'USSoldier', 2);
  make(1, 500, 'Sherman', 0);
  line({ k: 'p', t: 1, p: [[1, 1, 600, -1, 0], [2, 2, 700, -1, 0], [3, 2, 800, -1, 0]] });
  for (let t = 1; t <= 35; t += 0.5) {
    const o = [];
    if (t < 20) o.push([600, t, 1, 0, 0, 0, 0, 1]);
    if (t < 31) o.push([700, -t, 1, 0, 0, 0, 0, 1], [500, 50, 1, t, 0, 0, 0, 1]);
    line({ k: 's', t, o });
  }
  // One killed Three once at 8 s; Three came back at 9 s and took the Sherman.
  line(ev(8, 'score', { kind: 3, pid: 1, victim: 3, weaponName: 'Kar98k' }));
  line(ev(8, 'destroyObject', { netId: 800 }));
  make(9, 810, 'USSoldier', 2);
  line({ k: 'p', t: 9, p: [[3, 2, 810, -1, 0]] });
  line(ev(12, 'enterVehicle', { pid: 3, netId: 500 }));
  line({ k: 'p', t: 12.05, p: [[3, 2, 500, 500, 0]] });
  line(ev(20, 'score', { kind: 3, pid: 2, victim: 1, weaponName: 'Thompson' }));
  line(ev(20, 'destroyObject', { netId: 600 }));
  line(ev(30, 'gameStatus', { status: 2 }));
  line(ev(31, 'destroyObject', { netId: 700 }));
  line(ev(31, 'destroyObject', { netId: 810 }));
  line(ev(31, 'destroyObject', { netId: 500 }));
  line({ k: 'end', t: 35 });
  const rec = parseRecording(L.join('\n'));
  const at = t => Object.fromEntries([1, 2, 3].map(pid => {
    const s = chapters.playerStatusAt(rec, pid, t);
    return [pid, { state: s.state, cleared: Boolean(s.cleared), killer: s.killedBy?.killer ?? null }];
  }));
  results.cleared = { end: rec.roundEnded, at25: at(25), at30: at(30.5), at33: at(33) };
}

console.log(JSON.stringify(results));
