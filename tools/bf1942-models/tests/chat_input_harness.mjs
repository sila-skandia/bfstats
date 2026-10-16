// Drives the typed chat line outside a browser and prints one JSON blob:
// `viewer/chat-input.js` on its own, then the page's routing of real key
// events through `viewer/page-input.js` into `viewer/comms.js`, with the DOM
// stubbed. `tests/test_chat_input.py` copies the modules in under their own
// names, so the files under test are the files the page loads.

const winHandlers = {};
const docHandlers = {};
const element = () => ({
  addEventListener() {}, classList: { toggle() {} }, hidden: false,
  setPointerCapture() {}, requestPointerLock() {},
});
globalThis.addEventListener = (type, fn) => { (winHandlers[type] ??= []).push(fn); };
globalThis.document = {
  getElementById: () => element(),
  addEventListener: (type, fn) => { (docHandlers[type] ??= []).push(fn); },
  pointerLockElement: null,
  exitPointerLock() {},
};
globalThis.fetch = () => Promise.reject(new Error('no network in the harness'));
console.warn = () => {};

const { ChatInput, CHAT_MAX_BYTES, CHAT_BOX, typeable, promptText } = await import('./chat-input.js');
const { createComms } = await import('./comms.js');
const { createPageInput } = await import('./page-input.js');

const out = {};

// --- the line on its own ------------------------------------------------------

{
  const sent = [];
  const line = new ChatInput({ send: (text, team) => sent.push({ text, team }) });
  const key = (code, k = '', mods = {}) => line.keydown({ code, key: k, ...mods });
  out.closedTakesNothing = key('KeyA', 'a');
  line.open(false);
  for (const ch of 'hello') key(`Key${ch.toUpperCase()}`, ch);
  out.typed = line.text;
  key('Backspace');
  out.lineAfterBackspace = line.text;
  key('ArrowLeft'); key('ArrowLeft');
  key('KeyX', 'x');
  out.insertAtCaret = { text: line.text, cursor: line.cursor };
  key('ArrowRight'); key('ArrowRight'); key('ArrowRight');
  out.caretClamped = line.cursor;
  out.tabTyped = (key('Tab'), line.text);
  out.ctrlChord = key('KeyC', 'c', { ctrlKey: true });
  out.altGr = (key('KeyQ', '@', { ctrlKey: true, altKey: true }), line.text.endsWith('@'));
  key('Enter');
  out.sentOnce = sent.slice();
  out.closedAfterEnter = line.state();
  line.open(true);
  key('Enter');
  out.emptySends = sent.length;
  out.emptyCloses = line.isOpen;
  line.open(false);
  for (let i = 0; i < 80; i++) key('KeyA', 'a');
  out.limit = { length: line.text.length, max: CHAT_MAX_BYTES };
  key('Escape');
  out.escape = { open: line.isOpen, text: line.text, sends: sent.length };
  out.typeable = Object.fromEntries(['a', ' ', '~', 'é', 'ÿ', '€', 'Ж', '\u0085', 'Shift', '\u007f']
    .map(ch => [ch, typeable(ch)]));
  line.open(false);
  const phases = [line.caretShown()];
  for (let i = 0; i < 6; i++) { line.tick(0.2); phases.push(line.caretShown()); }
  out.blink = phases;
  out.prompt = { all: promptText(false, null), team: promptText(true, null),
    lexicon: promptText(true, { INGAME_CHAT_SAY_TEAM: 'SagTeam>' }) };
  out.box = CHAT_BOX;
}

// --- the page: real key events through page-input.js into comms.js ------------

const calls = [];
const record = name => (...args) => { calls.push(name); return false; };
let consoleOpen = false;
let uiFocused = false;
let room = { joined: true, sent: [] };
const TRIGGERS = {
  KeyK: ['c_GISayAll', 'c_PISayAll'],
  KeyL: ['c_GISayTeam', 'c_PISayTeam'],
  KeyR: ['c_PIReload'],
  KeyM: ['c_PIMap'],
  Space: ['c_PIFire'],
  Enter: ['c_GIInGameMenu'],
};

const comms = createComms({
  hudPaths: { url: rel => rel },
  bust: () => '',
  MAPS_BASE: 'maps',
  localName: () => 'Hans',
  localTeam: () => 2,
  localAlive: () => true,
  roomSendChat: (text, team) => {
    if (!room.joined) return false;
    room.sent.push({ text, team });
    return true;
  },
});

const page = new Proxy({
  chatCaptures: () => comms.sayCaptures(),
  chatKeydown: e => comms.sayKeydown(e),
  chatOpen: team => comms.sayOpen(team),
  throttleKey: code => code === 'KeyW' || code === 'KeyS',
  codeTriggers: code => TRIGGERS[code] ?? [],
  activeCodes: () => new Set(['KeyW', 'KeyS', 'KeyA', 'KeyD', ...Object.keys(TRIGGERS)]),
  consoleCaptures: () => consoleOpen,
  escMenuCaptures: () => false,
  uiFocused: () => uiFocused,
  deployActive: () => false,
  scoreboardOpen: () => false,
  radioKeydown: e => { if (/^F[1-8]$/.test(e.code)) { calls.push('radio'); return true; } return false; },
  gameConsole: { open: false, keydown: () => { calls.push('console'); return true; } },
  setConsoleOpen: record('setConsoleOpen'),
  setEscMenu: record('setEscMenu'),
  openDeploy: record('openDeploy'),
  startReload: record('startReload'),
  toggleFullMap: record('toggleFullMap'),
  spawnAtFlag: record('spawnAtFlag'),
  fullmapBox: { hidden: true },
  optOnFoot: { checked: true },
  optPilot: { checked: false },
  soldier: {},
  handWeapon: { data: { magazine: 30 } },
  params: new URLSearchParams(''),
  renderer: { domElement: element() },
  stage: element(),
  FLY_KEYS: new Set(),
  overlay: null,
  scoreFromSpawn: false,
}, {
  get(target, name) {
    if (name in target) return target[name];
    return record(String(name));
  },
});
const input = createPageInput(page);

function event(type, code, key = '', mods = {}) {
  let prevented = false;
  const e = { type, code, key, repeat: false, ctrlKey: false, metaKey: false, altKey: false,
    shiftKey: false, ...mods, preventDefault() { prevented = true; }, stopPropagation() {} };
  for (const fn of winHandlers[type] ?? []) fn(e);
  return prevented;
}
const down = (code, key = '', mods) => event('keydown', code, key, mods);
const up = code => event('keyup', code);
const typeText = text => {
  for (const ch of text) down(ch === ' ' ? 'Space' : `Key${ch.toUpperCase()}`, ch);
};
const keysNow = () => [...input.keys].sort();

down('KeyW', 'w');
down('KeyA', 'a');
out.heldBefore = keysNow();
out.kPrevented = down('KeyK', 'k');
out.afterOpen = { say: comms.sayState(), keys: keysNow() };
calls.length = 0;
typeText('gg r m');
down('F1', 'F1');
out.typedOnPage = comms.sayState().text;
out.gameCallsWhileOpen = calls.slice();
up('KeyA');
up('KeyW');
out.throttleHeldUnderLine = keysNow();
down('Backspace', 'Backspace');
out.afterBackspace = comms.sayState().text;
out.enterPrevented = down('Enter', 'Enter');
out.roomSent = room.sent.slice();
out.afterEnter = { say: comms.sayState(), keys: keysNow() };
calls.length = 0;
down('Enter', 'Enter');
out.secondEnterSendsNothing = room.sent.length;
out.secondEnterReachedPage = calls.slice();

down('KeyL', 'l');
out.teamOpen = comms.sayState();
typeText('hold');
down('Enter', 'Enter');
out.teamSent = room.sent.at(-1);

calls.length = 0;
down('KeyK', 'k');
typeText('never sent');
down('Escape', 'Escape');
out.escapeCancels = { say: comms.sayState(), sends: room.sent.length, calls: calls.slice() };

down('KeyK', 'k');
down('Enter', 'Enter');
out.emptyLine = { sends: room.sent.length, open: comms.sayCaptures() };

down('KeyK', 'k');
for (let i = 0; i < 70; i++) down('KeyZ', 'z');
out.pageLimit = comms.sayState().text.length;
out.ctrlChordPrevented = down('KeyC', 'c', { ctrlKey: true });
out.ctrlChordTyped = comms.sayState().text.includes('c');
down('Escape', 'Escape');

consoleOpen = true;
calls.length = 0;
down('KeyK', 'k');
out.consoleFirst = { open: comms.sayCaptures(), calls: calls.slice() };
consoleOpen = false;

uiFocused = true;
down('KeyK', 'k');
out.formFieldFirst = comms.sayCaptures();
uiFocused = false;

room = { joined: false, sent: [] };
comms.clear();
down('KeyK', 'k');
typeText('offline');
down('Enter', 'Enter');
down('KeyL', 'l');
typeText('team');
down('Enter', 'Enter');
out.offline = { sent: room.sent.length, rows: comms.state().rows };

console.log(JSON.stringify(out));
process.exit(0);
