// Drives `viewer/vehicle-players.js` outside a browser and prints one JSON blob.
//
// `tests/test_vehicle_players.py` copies the viewer module in under its own
// name, so the file under test is the file the page loads. It imports nothing.

import {
  MENU_STEP, VEHICLE_PLAYERS_TIMEOUT, VEHICLE_PLAYERS_SLOTS, SHOW_VAR, TEXT_VARS,
  VehiclePlayersList, vehiclePlayersRows, decodePlayerName, hudPlayerName,
} from './vehicle-players.js';

const results = {};

results.constants = {
  step: MENU_STEP, timeout: VEHICLE_PLAYERS_TIMEOUT, slots: VEHICLE_PLAYERS_SLOTS,
  show: SHOW_VAR, texts: TEXT_VARS,
};

const me = { id: 'local', name: 'skandia' };
const bot = { id: 'slot:3', name: 'Rommel' };
const gunner = { id: 'slot:4', name: 'Patton' };

// The rows: seat place, 1-based, and blank rows for empty seats.
results.rows = vehiclePlayersRows([me, null, bot]);
results.rowsAlone = vehiclePlayersRows([null, me]);
// A seat past the seventh is counted but has no row.
results.rowsEight = vehiclePlayersRows([me, null, null, null, null, null, null, bot]);

/** Frames the list is drawn, from now until it is not (cap 400). */
function framesShown(list, vars, onFrame = null) {
  let n = 0;
  for (let f = 0; f < 400; f++) {
    if (onFrame) onFrame(f, list);
    list.frame(vars);
    if (!vars[SHOW_VAR]) break;
    n += 1;
  }
  return n;
}

// Alone in a jeep: the rows are written, the list stays down.
{
  const list = new VehiclePlayersList();
  const vars = {};
  list.observe('jeep', [me]);
  list.frame(vars);
  results.alone = { shown: vars[SHOW_VAR], text1: vars[TEXT_VARS[0]], text2: vars[TEXT_VARS[1]] };
}

// Into a Sherman beside a gunner: up for the layout's 3.0 of menu time.
{
  const list = new VehiclePlayersList();
  const vars = {};
  list.observe('sherman', [me, gunner]);
  results.enterFrames = framesShown(list, vars);
  results.enterTexts = TEXT_VARS.map(v => vars[v]);
  // Steady crew: nothing brings it back.
  list.observe('sherman', [me, gunner]);
  list.frame(vars);
  results.steadyShown = vars[SHOW_VAR];
  // A third man climbs in: up again, his row added.
  list.observe('sherman', [me, gunner, bot]);
  results.joinFrames = framesShown(list, vars);
  results.joinTexts = TEXT_VARS.map(v => vars[v]);
  // A number key while seated, for a seat that is taken or not.
  list.press(1);
  results.keyFrames = framesShown(list, vars);
  // Keys 7..9 (positions 6..8) are not the six the client wires.
  list.press(6);
  list.frame(vars);
  results.key7Shown = vars[SHOW_VAR];
}

// A second trigger while it is up does not stretch it.
{
  const list = new VehiclePlayersList();
  const vars = {};
  list.observe('sherman', [me, gunner]);
  results.retriggerFrames = framesShown(list, vars, (f, l) => {
    if (f === 45) l.observe('sherman', [me, gunner, bot]);
  });
}

// The crew thins to one while it is up: the rows change, the list stays up.
{
  const list = new VehiclePlayersList();
  const vars = {};
  list.observe('sherman', [me, gunner]);
  list.frame(vars);
  list.observe('sherman', [me, null]);
  list.frame(vars);
  results.thinned = { shown: vars[SHOW_VAR], texts: TEXT_VARS.map(v => vars[v]) };
  // A key alone does not bring it up.
  const lone = new VehiclePlayersList();
  const v2 = {};
  lone.observe('jeep', [me]);
  lone.press(0);
  lone.frame(v2);
  results.keyAlone = v2[SHOW_VAR];
}

// Out of the vehicle mid-list: down at once, and the layout's counter keeps
// what it had, so the next showing is the rest of it.
{
  const list = new VehiclePlayersList();
  const vars = {};
  list.observe('sherman', [me, gunner]);
  for (let i = 0; i < 30; i++) list.frame(vars);
  list.leave();
  list.frame(vars);
  results.leftShown = vars[SHOW_VAR];
  results.leftClock = list.clock;
  list.observe('willys', [me, bot]);
  results.reenterFrames = framesShown(list, vars);
}

// A key on foot does nothing.
{
  const list = new VehiclePlayersList();
  list.press(0);
  results.keyOnFoot = list.shown;
}

// Names: a cp1251 name read as cp1252 decodes; Latin passes through; the
// HUD face (Latin glyphs, 32..511) keeps the raw name when it cannot draw it.
const mojibake = 'Ïðèâåò';   // "Привет" as cp1252
const latinGlyphs = {};
for (let c = 32; c < 512; c++) latinGlyphs[c] = [1, 4, 1];
const allGlyphs = { ...latinGlyphs };
for (let c = 0x400; c < 0x460; c++) allGlyphs[c] = [1, 4, 1];
results.names = {
  decoded: decodePlayerName(mojibake),
  latin: decodePlayerName('[GR]Bloke'),
  latinFace: hudPlayerName(mojibake, latinGlyphs),
  fullFace: hudPlayerName(mojibake, allGlyphs),
  noFace: hudPlayerName(mojibake, null),
};
{
  const list = new VehiclePlayersList({ display: name => hudPlayerName(name, latinGlyphs) });
  const vars = {};
  list.observe('t34', [{ id: 'a', name: mojibake }, { id: 'b', name: 'Ivan' }]);
  list.frame(vars);
  results.drawnName = vars[TEXT_VARS[0]];
}

console.log(JSON.stringify(results));
