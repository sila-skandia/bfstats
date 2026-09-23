// Drives `viewer/scoreboard.js` outside a browser and prints one JSON blob.
//
// Same shape as the other harnesses here: `tests/test_scoreboard.py` copies
// the viewer module in under its own name, so the file under test is the file
// the page loads, byte for byte. The module imports nothing.

import { LIST_TOP_INSET, DEAD_ROW_COLOR, tallyFeed, boardRows, boardVars, listGeometry,
          fitText, condOk, leafVisible, textureKey, leafText, paintLeaves, listFloor,
          kitClassKey, rowIcon }
  from './scoreboard.js';

const results = {};

// --- the tally ---------------------------------------------------------------

const feed = [
  { type: 'join', slot: 3 },
  { type: 'killed', slot: 2, other: 1 },   // 1 killed 2
  { type: 'killed', slot: 2, other: 1 },   // again
  { type: 'killed', slot: 1, other: 3 },   // 3 killed 1
  { type: 'killed', slot: 3, other: null },// 3 died, nobody's kill
  { type: 'killed', slot: 1, other: 1 },   // 1 killed himself: a death only
  { type: 'killed', slot: 5, other: null }, // the Axis bot, down three times
  { type: 'killed', slot: 5, other: null },
  { type: 'killed', slot: 5, other: null },
  { type: 'fire', slot: 1 },
  null,
];
results.tally = Object.fromEntries([...tallyFeed(feed)].map(([k, v]) => [k, v]));
results.tallyEmpty = tallyFeed(undefined).size;

// --- the rows ----------------------------------------------------------------

const players = [
  { slot: 1, name: 'Local', team: 2, local: true, kit: 'engineer' },
  { slot: 2, name: 'Axis One', team: 1, kit: 'Anti-tank', bot: true },
  { slot: 3, name: 'Ally Two', team: 2 },                       // a room player: no kit
  { slot: 4, name: 'Teamless', team: 0 },
  { slot: 5, name: 'Axis Bot', team: 1, bot: true, kit: 'Scout', dead: true },
  { slot: null, name: 'Odd Kit', team: 2, kit: 'Rocket pack' },
];
results.rows = boardRows(players, feed);

// --- the kit glyph -----------------------------------------------------------

const rowIcons = {
  human: { scout: 'class_scout_16x16', assault: 'class_assault_16x16',
           antitank: 'class_at_16x16', medic: 'class_medic_16x16',
           engineer: 'class_engineer_16x16' },
  bot: { scout: 'class_bot_scout_16x16', assault: 'class_bot_assault_16x16',
         antitank: 'class_bot_at_16x16', medic: 'class_bot_medic_16x16',
         engineer: 'class_bot_engineer_16x16' },
  dead: 'dead_16x16',
  botDead: 'bot_dead_16x16',
};
results.kitKeys = {
  label: kitClassKey('Anti-tank'), key: kitClassKey('antitank'), at: kitClassKey('at'),
  medic: kitClassKey('Medic'), other: kitClassKey('Rocket pack'), none: kitClassKey(null),
  empty: kitClassKey(''),
};
results.icons = {
  human: rowIcon({ kit: 'engineer' }, rowIcons),
  bot: rowIcon({ kit: 'antitank', bot: true }, rowIcons),
  dead: rowIcon({ kit: 'scout', dead: true }, rowIcons),
  botDead: rowIcon({ kit: 'scout', bot: true, dead: true }, rowIcons),
  unknown: rowIcon({ kit: null }, rowIcons),
  noIcons: rowIcon({ kit: 'scout' }, undefined),
  fromRows: Object.fromEntries([...results.rows[1], ...results.rows[2]]
    .map(r => [r.name, rowIcon(r, rowIcons)])),
};
// A lone page: no slot, no feed.
results.lone = boardRows([{ slot: null, name: 'Player', team: 1, local: true }], []);
results.nobody = boardRows([], []);

// --- the variables -----------------------------------------------------------

const layoutVars = {
  'Scoreboard/AxisScoreTotal': 100, 'Scoreboard/ServerName': '-= Test =-',
  'Scoreboard/AxisRoundWon': 9999, 'Scoreboard/KickVoteActive': 'No kick vote active',
  AxisTicketFlag: 'flag_ticket_ger.tga',
};
results.varsRoom = boardVars(layoutVars, {
  fromSpawn: true, inRoom: true, alive: false, serverName: 'ABCD', serverIp: 'host:1',
  mapName: 'Wake', axisFlag: 'flag_ticket_jp.tga', alliedFlag: 'flag_ticket_us.tga',
  rows: results.rows, visibleRows: 20,
});
results.varsLone = boardVars(layoutVars, { rows: results.lone, visibleRows: 0 });
results.layoutVarsUntouched = layoutVars['Scoreboard/AxisScoreTotal'];

// --- the list geometry -------------------------------------------------------

const columns = {
  textInset: 10,
  columns: [
    { x: 0, field: 'icon' }, { x: 25, field: 'name' }, { x: 150, field: null },
    { x: 175, field: 'score' }, { x: 210, field: 'kills' }, { x: 245, field: 'deaths' },
    { x: 280, field: 'ping' }, { x: 310, field: 'id' }, { x: 355, field: null },
  ],
};
const box = { kind: 'listbox', rect: [5, 65, 391, 420], rowHeight: 18, font: 'standard6_latin',
              data: 'Scoreboard/AxisScoreboardList' };
const geo = listGeometry(box, columns, 8, 465);
results.geo = {
  inset: LIST_TOP_INSET, top: geo.top, pitch: geo.pitch, visibleRows: geo.visibleRows,
  row0: geo.cells(0, { slot: 7, name: 'A', score: 0, kills: 1, deaths: 2, ping: 0 }),
  row1: geo.cells(1, { slot: null, name: 'B', score: 0, kills: 0, deaths: 0, ping: 0 }),
  noFloor: listGeometry(box, columns, 8, undefined).visibleRows,
  icon0: geo.icon(0),
  icon1: geo.icon(1),
  iconNoColumn: listGeometry(box, { textInset: 10, columns: columns.columns.slice(1) }, 8, 465)
    .icon(0),
};

results.fit = {
  whole: fitText('abc', 100, t => t.length * 6),
  cut: fitText('abcdefgh', 20, t => t.length * 6),
  none: fitText('abc', 0, t => t.length * 6),
};

// --- conditions, visibility, names -------------------------------------------

results.cond = {
  eq: condOk({ var: 'a', op: 'eq', value: true }, { a: true }),
  ne: condOk({ var: 'a', op: 'ne', value: true }, { a: false }),
  lt: condOk({ var: 'a', op: 'lt', value: 3 }, { a: 2 }),
  gt: condOk({ var: 'a', op: 'gt', value: { var: 'b' } }, { a: 2, b: 1 }),
  and: condOk({ op: 'and', terms: [{ var: 'a', op: 'eq', value: 1 }, { var: 'b', op: 'eq', value: 2 }] }, { a: 1, b: 2 }),
  or: condOk({ op: 'or', terms: [{ var: 'a', op: 'eq', value: 9 }, { var: 'b', op: 'eq', value: 2 }] }, { a: 1, b: 2 }),
};
results.visible = {
  plain: leafVisible({ kind: 'fill' }, {}),
  fadedOut: leafVisible({ kind: 'button', fade: 0 }, {}),
  culled: leafVisible({ when: [{ var: 'x', op: 'eq', value: true }] }, { x: false }),
  shown: leafVisible({ when: [{ var: 'x', op: 'eq', value: true }] }, { x: true }),
};
results.key = [textureKey('flag_ticket_US.tga'), textureKey('Voting/scoreboard_512x470.tga'), textureKey('plain')];
results.text = [
  leafText({ text: '9999', var: 'n' }, { n: 0 }),
  leafText({ text: 'AXIS' }, {}),
  leafText({ text: 'sample', var: 'missing' }, {}),
];

// --- the painter, against a recording context --------------------------------

function recorder() {
  const calls = [];
  const ctx = {
    globalAlpha: 1, fillStyle: '', imageSmoothingEnabled: true,
    fillRect: (...a) => calls.push(['fillRect', ctx.fillStyle, ctx.globalAlpha, ...a]),
    drawImage: (img, ...a) => calls.push(['drawImage', img.name, ...a]),
  };
  return { ctx, calls };
}
const elements = [
  { kind: 'fill', rect: [14, 72, 371, 18], color: [0, 0, 0, 1] },
  { kind: 'picture', rect: [364, 74, 16, 16], texture: 'flag_ticket_ger', var: 'AxisTicketFlag' },
  { kind: 'button', rect: [660, 557, 109, 25], texture: 'knappext_n', hover: 'knappext_mo' },
  { kind: 'button', rect: [30, 557, 109, 25], texture: 'knapp3_n', fade: 0 },
  { kind: 'text', rect: [230, 43, 150, 20], text: '9999', var: 'Scoreboard/AxisRoundWon',
    font: 'f', align: 'right', color: [0, 0, 0, 1] },
  { kind: 'text', rect: [660, 566, 114, 20], text: 'DONE', font: 'f', align: 'center',
    when: [{ var: 'Scoreboard/FromSpawnScoreboard', op: 'eq', value: true }] },
  { kind: 'text', rect: [660, 566, 114, 20], text: 'LOCK', font: 'f', align: 'center',
    when: [{ var: 'Scoreboard/FromSpawnScoreboard', op: 'ne', value: true }] },
  box,
  { kind: 'fill', rect: [388, 89, 10, 372], color: [0, 0, 0, 0.8] },
  { kind: 'fill', rect: [14, 465, 371, 18], color: [0, 0, 0, 1] },
];
results.floor = listFloor(elements, box);
{
  const { ctx, calls } = recorder();
  const texts = [];
  const res = {
    texture: name => ({ name, width: 128, height: 128 }),
    measure: (font, text) => text.length * 6,
    drawText: (c, font, text, x, y, rgb) => texts.push([text, x, y, rgb.join(',')]),
    lineHeight: () => 8,
    hover: el => el.texture === 'knappext_n',
    floor: el => listFloor(elements, el),
  };
  const vars = boardVars({}, { fromSpawn: true, rows: results.rows, visibleRows: 20,
                               axisFlag: 'flag_ticket_jp.tga' });
  const visibleRows = paintLeaves(ctx, { listColumns: columns, rowIcons }, elements, vars, res,
                                  { 'Scoreboard/AxisScoreboardList': results.rows[1] });
  results.paint = { calls, texts, visibleRows, deadColor: DEAD_ROW_COLOR };
}
// The same list with a glyph the page never loaded, and no `rowIcons` at all:
// the column stays empty and the text still lands.
{
  const { ctx, calls } = recorder();
  const texts = [];
  const res = {
    texture: name => (name.startsWith('class_') || name.endsWith('dead_16x16')
      ? null : { name, width: 128, height: 128 }),
    measure: (font, text) => text.length * 6,
    drawText: (c, font, text, x, y, rgb) => texts.push([text, x, y, rgb.join(',')]),
    lineHeight: () => 8,
    floor: el => listFloor(elements, el),
  };
  const vars = boardVars({}, { rows: results.rows, visibleRows: 20 });
  paintLeaves(ctx, { listColumns: columns, rowIcons }, [box], vars, res,
              { 'Scoreboard/AxisScoreboardList': results.rows[1] });
  const unloaded = { icons: calls.filter(c => c[0] === 'drawImage').length, texts: texts.length };
  const texts2 = [];
  paintLeaves(ctx, { listColumns: columns }, [box], vars,
              { ...res, drawText: (c, f, text) => texts2.push(text) },
              { 'Scoreboard/AxisScoreboardList': results.rows[1] });
  results.paintNoIcons = { unloaded, noManifest: { texts: texts2.length } };
}

console.log(JSON.stringify(results));
