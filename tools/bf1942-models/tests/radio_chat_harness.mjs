// Drives `viewer/radio.js` and `viewer/chat-log.js` outside a browser and
// prints one JSON blob. `tests/test_radio_chat.py` copies both modules in
// under their own names, so the files under test are the files the page loads.

import {
  RADIO_MESSAGES, pressRadioKey, isTeamMessage, remapLocal, closestControlPoint,
  radioChatText, radioPatch, RadioSpamLimit, radioGameMode, radioVars, visibleLeaves,
  nationStems, ICON_ON_FOOT, ICON_LAND, ICON_AIR, ICON_SEA,
} from './radio.js';
import {
  GameplayAnnouncer, gamePlayMode, AUTO_LOSE_TICKETS, TICKET_LOW, LEAVING_COMBAT,
  GPM_CTF, GPM_CONQUEST, GPM_TDM, GPM_COOP, GPM_OBJECTIVE,
} from './announcer.js';
import {
  ChatLog, SECTION_CHAT, SECTION_INFO, SECTION_KILL, killWord, killLine,
  teamKillLine, deathLine, captureLine, allPointsLine, rowGeometry, dividerGeometry,
  lineColor,
} from './chat-log.js';

const out = {};

// --- the key handler: every key on every page -------------------------------

const sends = {};
for (const mode of [1, 2, 3]) {
  for (let cat = 1; cat <= 7; cat++) {
    for (let key = 1; key <= 8; key++) {
      const r = pressRadioKey({ category: cat, back: true }, key, { gameMode: mode, controlPoints: 4 });
      sends[`${mode}/${cat}/${key}`] = r.message;
    }
  }
}
out.sends = sends;
out.transitions = {
  rootF3: pressRadioKey({ category: 0, back: true }, 3),
  rootF8: pressRadioKey({ category: 0, back: true }, 8),
  offF8: pressRadioKey({ category: 8, back: false }, 8),
  offF2: pressRadioKey({ category: 8, back: false }, 2),
  pageClosesToOff: pressRadioKey({ category: 2, back: false }, 1),
  pageF8: pressRadioKey({ category: 5, back: true }, 8),
};
out.everySentIdKnown = Object.values(sends).filter(Boolean)
  .every(id => id === 50 || RADIO_MESSAGES[id]);
out.team = [1, 14, 22, 28, 29, 49, 50, 54, 55, 58, 59].map(id => [id, isTeamMessage(id)]);
out.remap = {
  stickTogetherInTank: remapLocal(47, ICON_LAND),
  stickTogetherOnFoot: remapLocal(47, ICON_ON_FOOT),
  medicInPlane: remapLocal(40, ICON_AIR),
  coverInPlane: remapLocal(41, ICON_AIR),
  coverInTank: remapLocal(41, ICON_LAND),
  bailOnShip: remapLocal(42, ICON_SEA),
  bailInPlane: remapLocal(42, ICON_AIR),
};
out.closest = closestControlPoint(
  [{ x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 0 }, { x: 10, y: 50, z: 0 }], { x: 90, y: 0, z: 0 });

const strings = { RADIO_ATTACK: 'Attack', RADIO_DEFEND: 'Defend', RADIO_ROGER: 'Roger that',
  RADIO_LOCAL_GO: 'Go go go!', RADIO_LOCAL_GO_FOR_ENEMY_FLAG: 'Go for the enemy flag' };
out.text = {
  cpAttack: radioChatText(24, { name: 'skandia', grid: 'C5', strings, pointName: 'Bridge', defend: false }),
  cpDefend: radioChatText(22, { name: 'skandia', grid: 'A1', strings, pointName: 'Bridge', defend: true }),
  roger: radioChatText(1, { name: 'skandia', grid: 'B2', strings }),
  go: radioChatText(49, { name: 'skandia', grid: 'B2', strings }),
  takePoint: radioChatText(45, { name: 'skandia', strings }),
};
out.patch = {
  attack: radioPatch(23, false), defend: radioPatch(23, true),
  medic: radioPatch(40), apc: radioPatch(14), protectFlag: radioPatch(56),
};
out.mode = ['Conquest', 'CTF', 'TDM', 'Coop', ''].map(radioGameMode);

// The spam limit: seven sends go, the eighth inside four seconds does not,
// and holding the key keeps it refused.
const spam = new RadioSpamLimit();
const spamRun = [];
for (let i = 0; i < 9; i++) { spamRun.push(spam.trySend()); spam.tick(0.1); }
for (let i = 0; i < 60; i++) spam.tick(0.1);   // 6 s idle
spamRun.push(spam.trySend());
out.spam = spamRun;

// The layout's gates, on a hand-built two-leaf layout.
const layout = {
  defaults: { 'Radio/RadioAlpha': 0.5 },
  variableActions: [
    { when: [{ var: 'Radio/RadioGameMode', op: 'eq', value: 3 }], set: 'Radio/RadioAlpha', value: 0.5 },
    { when: [{ var: 'Radio/RadioGameMode', op: 'ne', value: 3 }], set: 'Radio/RadioAlpha', value: 1.0 },
  ],
  elements: [
    { kind: 'picture', when: [{ var: 'Radio/RadioCategory', op: 'eq', value: 4 }], alphaVars: ['Radio/RadioAlpha'] },
    { kind: 'picture', when: [{ var: 'Radio/RadioCategory', op: 'eq', value: 0 }] },
  ],
};
out.leaves = {
  conquestF4: visibleLeaves(layout, radioVars(layout, { category: 4, gameMode: 3 })).map(l => l.alpha),
  tdmF4: visibleLeaves(layout, radioVars(layout, { category: 4, gameMode: 1 })).map(l => l.alpha),
  idle: visibleLeaves(layout, radioVars(layout, { category: 0 })).length,
};

// --- which lines a language has ------------------------------------------------

// Desert Combat's manifest: UsEnglish and Iraqi ship every stem, English
// (the vanilla British set) lacks the ones DC added.
const dcSounds = {
  nations: { us: { stems: 97 }, iraq: { stems: 97 }, brit: { stems: 47 } },
  missing: [
    { nation: 'brit', stems: ['RogerThat1', 'RogerThat2', 'RogerThat3', 'RogerThat4', 'ProtectOurFlag2'] },
    { nation: 'brit', stem: 'Negative', why: 'a transcode failure, not an absent file' },
  ],
};
const roger = { stems: ['RogerThat1', 'RogerThat2', 'RogerThat3', 'RogerThat4'], random: true };
const protect = { stems: ['ProtectOurFlag', 'ProtectOurFlag2'], random: true };
out.nationStems = {
  usRoger: nationStems(dcSounds, roger, 'us'),
  britRoger: nationStems(dcSounds, roger, 'brit'),
  britProtect: nationStems(dcSounds, protect, 'brit'),
  unknownNation: nationStems(dcSounds, roger, 'fre'),
  noManifest: nationStems(null, protect, 'brit'),
};

// --- the side's announcer ----------------------------------------------------------

out.gpm = ['Conquest', 'Ctf', 'Tdm', 'SinglePlayer', 'CoOp', 'ObjectiveMode', ''].map(gamePlayMode);
const run = (frames, a = new GameplayAnnouncer()) => frames.map(f => a.frame(f));
const cq = { mode: GPM_CONQUEST, team: 1, playing: true, start: { 1: 100, 2: 100 } };
out.announcer = {
  // Heavy casualties: the enemy's weight crossing 100, once, again after it
  // falls away; the other side's weight means nothing to this side.
  heavy: run([
    { ...cq, held: { 1: 0, 2: 99 }, tickets: { 1: 100, 2: 100 } },
    { ...cq, held: { 1: 0, 2: 100 }, tickets: { 1: 100, 2: 100 } },
    { ...cq, held: { 1: 0, 2: 150 }, tickets: { 1: 99, 2: 100 } },
    { ...cq, held: { 1: 0, 2: 60 }, tickets: { 1: 99, 2: 100 } },
    { ...cq, held: { 1: 0, 2: 110 }, tickets: { 1: 98, 2: 100 } },
    { ...cq, held: { 1: 180, 2: 0 }, tickets: { 1: 98, 2: 100 } },
  ]),
  // Not in CTF or TDM.
  heavyTdm: run([{ ...cq, mode: GPM_TDM, held: { 1: 0, 2: 180 }, tickets: { 1: 100, 2: 100 } }]),
  heavyCtf: run([{ ...cq, mode: GPM_CTF, held: { 1: 0, 2: 180 }, tickets: { 1: 100, 2: 100 } }]),
  heavyCoop: run([{ ...cq, mode: GPM_COOP, held: { 1: 0, 2: 180 }, tickets: { 1: 100, 2: 100 } }]),
  // Objective: ten tickets or fewer instead of a weight, and no TicketLow.
  objective: run([
    { ...cq, mode: GPM_OBJECTIVE, held: { 1: 0, 2: 180 }, tickets: { 1: 11, 2: 100 } },
    { ...cq, mode: GPM_OBJECTIVE, held: { 1: 0, 2: 180 }, tickets: { 1: 10, 2: 100 } },
  ]),
  // Tickets low: (0.05, 0.2] of the start, once; above 0.2 re-arms it.
  low: run([
    { ...cq, held: {}, tickets: { 1: 21, 2: 100 } },
    { ...cq, held: {}, tickets: { 1: 20, 2: 100 } },
    { ...cq, held: {}, tickets: { 1: 10, 2: 100 } },
    { ...cq, held: {}, tickets: { 1: 5, 2: 100 } },
    { ...cq, held: {}, tickets: { 1: 30, 2: 100 } },
    { ...cq, held: {}, tickets: { 1: 15, 2: 100 } },
  ]),
  lowAlreadyUnderFloor: run([{ ...cq, held: {}, tickets: { 1: 5, 2: 100 } }]),
  lowRoundOver: run([{ ...cq, playing: false, held: { 1: 0, 2: 150 }, tickets: { 1: 10, 2: 0 } }]),
  lowNoSide: run([{ ...cq, team: 0, held: { 1: 0, 2: 150 }, tickets: { 1: 10, 2: 100 } }]),
  // Leaving the area: once the WHOLE seconds outside pass zero, once per
  // excursion, and not before the player has been inside once.
  leaving: run([
    { ...cq, held: {}, tickets: { 1: 100, 2: 100 }, outsideFor: 0 },
    { ...cq, held: {}, tickets: { 1: 100, 2: 100 }, outsideFor: 0.9 },
    { ...cq, held: {}, tickets: { 1: 100, 2: 100 }, outsideFor: 1.0 },
    { ...cq, held: {}, tickets: { 1: 100, 2: 100 }, outsideFor: 10 },
    { ...cq, held: {}, tickets: { 1: 100, 2: 100 }, outsideFor: 0 },
    { ...cq, held: {}, tickets: { 1: 100, 2: 100 }, outsideFor: 2.5 },
  ]),
  leavingSpawnedOutside: run([{ ...cq, held: {}, tickets: { 1: 100, 2: 100 }, outsideFor: 3 }]),
  ids: [AUTO_LOSE_TICKETS, TICKET_LOW, LEAVING_COMBAT],
};

// --- the message log ----------------------------------------------------------

const log = new ChatLog({ kill: 3, info: 2, chat: 6, timeUntilMessageRemoved: 5 });
out.firstRows = [SECTION_KILL, SECTION_INFO, SECTION_CHAT].map(s => log.firstRow(s));
for (let i = 0; i < 4; i++) log.add(SECTION_KILL, { text: `k${i}`, team: 1 });
out.killFull = log.lines[SECTION_KILL].map(l => l.text);
// The kill timer runs on regardless of new lines; only chat's is reset.
log.tick(4.9);
log.add(SECTION_CHAT, { text: 'c0', team: 2 });
log.tick(0.2);
out.afterFive = { kill: log.lines[SECTION_KILL].map(l => l.text), chat: log.lines[SECTION_CHAT].length };
log.tick(4.7);   // the chat line is now 4.9 s old
out.chatAt4_9 = log.lines[SECTION_CHAT].length;
log.tick(0.2);
out.chatAt5_1 = log.lines[SECTION_CHAT].length;
out.exactlyFive = (() => {
  const l = new ChatLog({ timeUntilMessageRemoved: 5 });
  l.add(SECTION_INFO, { text: 'x' });
  l.tick(2.5); l.tick(2.5);
  return l.lines[SECTION_INFO].length;
})();

const lay = { box: [0, 85, 620, 240], rowHeight: 14, dividerX: 5,
  colors: { axis: [1, 0.35, 0.35], allies: [0.4, 0.6, 1], normal: [0.7, 0.7, 0.7], buddy: [0, 1, 0] } };
out.geometry = { row0: rowGeometry(lay, 0), row7: rowGeometry(lay, 7), div: dividerGeometry(lay, 4, 2) };
out.colors = [{ team: 1 }, { team: 2 }, { team: 0 }, { team: 2, buddy: true }].map(l => lineColor(lay, l));

const cs = { DEFAULT_KILL_TEXT: 'killed', TEAM_KILL: 'killed a teammate', DEATH: 'is no more',
  ALLIES_CAPTURED: 'Allies captured the control point', AXIS_HOLD_ALL_CONTROLPOINTS: 'Axis now hold all controlpoints!' };
out.lines = {
  onFoot: killLine('Steffen Schneider', 'Robbie Pastriani', killWord(null, cs, {})),
  onFootThompson: killLine('Steffen Schneider', 'Robbie Pastriani', killWord('Thompson', cs, { Thompson: 'Thompson' })),
  tank: killLine('Johannes Werner', 'Larry Vaughn', killWord('Tiger', cs, { Tiger: 'Tiger' })),
  unnamedVehicle: killWord('Willys', cs, {}),
  tk: teamKillLine('skandia', cs),
  death: deathLine('Roger Harris', cs),
  capture: captureLine('Sawmill', 2, cs),
  allPoints: allPointsLine(1, cs),
};

console.log(JSON.stringify(out));
