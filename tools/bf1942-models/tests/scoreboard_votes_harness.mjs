// `viewer/scoreboard-votes.js` under node: the row under the pointer, the
// board's vote variables, the map list's rows and cells, and the hit tests
// and plate of `createBoardVotes` over a small layout.
import { createBoardVotes, mapCells, mapRows, rowAt, voteVars, MAP_COLUMNS, VOTE_BUTTONS } from './scoreboard-votes.js';

const box = { kind: 'listbox', rect: [5, 65, 391, 420], rowHeight: 18, data: 'Scoreboard/AxisScoreboardList',
              select: [0, 0.1875, 0.539, 0] };
const allied = { ...box, rect: [404, 65, 391, 420], data: 'Scoreboard/AlliedScoreboardList' };
const columns = { textInset: 0, columns: [] };
const list = [{ slot: 1, team: 1, local: true }, { slot: 4, team: 1 }, { slot: 9, team: 1 }];
const results = {};
// Rows sit on the list's pitch: baseline at y + 2 * 18 + i * 18, band from 11 above it, 16 high.
results.rowAt = [rowAt(box, columns, list, 100, 65 + 36 - 5)?.slot ?? null,
                 rowAt(box, columns, list, 100, 65 + 54 - 5)?.slot ?? null,
                 rowAt(box, columns, list, 100, 65 + 72 - 5)?.slot ?? null,
                 rowAt(box, columns, list, 100, 65 + 90 - 5)?.slot ?? null,
                 rowAt(box, columns, list, 500, 100)?.slot ?? null];
results.vars = {
  none: voteVars({ live: true, picked: null, localTeam: 1 }),
  self: voteVars({ live: true, picked: list[0], localTeam: 1 }),
  mate: voteVars({ live: true, picked: list[1], localTeam: 1, statusLine: 'No Kick Vote active' }),
  foe: voteVars({ live: true, picked: { slot: 7, team: 2 }, localTeam: 1 }),
  offline: voteVars({ live: false, picked: list[1], localTeam: 1 }),
  switchedOff: voteVars({ live: true, picked: list[1], localTeam: 1, enabled: kind => kind !== 1 }),
};
const maps = [{ level: 'wake', mode: null }, { level: 'berlin', mode: 'Tdm' }];
results.mapRows = mapRows(maps, { mod: 'bf1942', votes: id => (id === 1 ? 2 : 0) });
const heads = [['MAPVOTE_ID', 174], ['MAPVOTE_MAPNAME', 213], ['MAPVOTE_MOD', 354], ['MAPVOTE_GAMEMODE', 454],
               ['MAPVOTE_NUMVOTES', 566]].map(([key, x]) => ({ kind: 'text', key, rect: [x, 136, 100, 20], font: 'f', text: key }));
const mapBox = { kind: 'listbox', rect: [155, 125, 488, 255], rowHeight: 18, font: 'f', select: [0, 0.2, 0.5, 0] };
results.cells = mapCells(heads, mapBox, results.mapRows[1], 1, 6);
results.columns = MAP_COLUMNS.map(c => c[1]);
results.buttons = VOTE_BUTTONS;

// The live half over a small layout.
const cond = (name, value = true, op = 'eq') => ({ var: name, op, value });
const layout = {
  virtual: [800, 600], variables: {}, listColumns: columns,
  elements: [
    box, allied,
    { kind: 'button', id: 'SCOREBOARD_VOTE_KICK', rect: [280, 557, 109, 25], texture: 'n', hover: 'mo', when: [cond('Scoreboard/EnableVoteKick')] },
    { kind: 'button', id: 'SCOREBOARD_VOTE_KICK', rect: [280, 557, 109, 25], texture: 'n', hover: 'n', when: [cond('Scoreboard/EnableVoteKick', true, 'ne')] },
    { kind: 'button', id: 'SCOREBOARD_VOTE_KICK_TEAM', rect: [400, 557, 109, 25], texture: 'n', hover: 'mo', when: [cond('Scoreboard/EnableVoteKickTeam')] },
    { kind: 'button', id: 'SCOREBOARD_BRINGUP_MAPVOTE', rect: [520, 557, 109, 25], texture: 'n', hover: 'mo' },
  ],
  vote: {
    mapVote: { elements: [...heads, mapBox,
      { kind: 'button', id: 'SCOREBOARD_VOTE_MAP', rect: [270, 415, 109, 25], texture: 'n', hover: 'mo' },
      { kind: 'button', id: 'RESPAWN_DONE', rect: [400, 415, 109, 25], texture: 'x', hover: 'xo' }] },
    message: { elements: [{ kind: 'picture', rect: [528, 224, 296, 110], texture: 'tooltip_256x128' },
                          { kind: 'text', rect: [534, 230, 260, 74], font: 'f', align: 'center', color: [1, 1, 1, 0.9] }] },
  },
};
const sent = [];
const drawn = [];
const host = { live: true, maps, enabled: () => true, statusLine: kind => (kind ? 'No Kick Vote active' : 'No Map Vote active'),
               running: () => null, vote: (kind, target) => sent.push([kind, target]), current: () => null };
let hidden = true;
const listeners = {};
const boxEl = { get hidden() { return hidden; }, style: {}, addEventListener: (t, fn) => { listeners[t] = fn; },
                getBoundingClientRect: () => ({ left: 0, top: 0 }) };
const votes = createBoardVotes({
  layout: () => layout, host: () => host, box: boxEl,
  res: { texture: () => null, measure: (f, t) => t.length * 5, baseline: () => 6,
         drawText: (c, f, text, x, y) => drawn.push([text, x, y]) },
  scale: () => ({ sx: 1, sy: 1, ox: 0, oy: 0 }),
  rows: () => ({ 1: list, 2: [{ slot: 7, team: 2 }] }),
  boardVars: () => ({}), localTeam: () => 1, modId: () => 'bf1942', fromSpawn: () => true,
  hasFont: () => true, lineHeight: () => 12, repaint: () => {}, openBoard: on => { hidden = !on; },
});
const at = (x, y) => ({ clientX: x, clientY: y });
const before = votes.boardHit(300, 565)?.kind ?? null;        // nobody picked: VOTE KICK is the dead twin
listeners.click(at(100, 65 + 54 - 5));                         // pick slot 4
const marked = votes.mark({ 1: list, 2: [] })[1].map(r => !!r.selected);
const picked = { vars: votes.vars(), kick: votes.boardHit(300, 565)?.kind ?? null };
listeners.click(at(300, 565));                                 // VOTE KICK
listeners.click(at(410, 565));                                 // VOTE KICK (TEAM)
listeners.click(at(500, 65 + 36 - 5));                         // pick the enemy, slot 7
const foe = votes.vars();
listeners.click(at(530, 565));                                 // MAP VOTE
const mapOpen = { open: votes.mapVoteOpen, pointer: boxEl.style.pointerEvents };
listeners.click(at(280, 420));                                 // VOTE FOR MAP with no row: nothing
listeners.click(at(300, 125 + 54 - 5));                        // the second map
listeners.click(at(280, 420));                                 // VOTE FOR MAP
const painted = votes.paintMapVote({ fillRect() {}, set globalAlpha(v) {}, set fillStyle(v) {}, set imageSmoothingEnabled(v) {} });
const mapText = drawn.map(d => d[0]);
listeners.click(at(410, 420));                                 // DONE
drawn.length = 0;
votes.drawPlate({ set globalAlpha(v) {}, set imageSmoothingEnabled(v) {} }, layout.vote.message,
                ['Vote to kick Griefer (3)?', '[1 Cast, 4 Needed]', 'Yes: 7  No: 8', 'Time Left: 41']);
results.live = { before, marked, picked, foe, sent, mapOpen, painted, mapText, closed: !votes.mapVoteOpen,
                 plate: drawn.slice(), plateReady: votes.plateReady() };
votes.stop();
console.log(JSON.stringify(results));
