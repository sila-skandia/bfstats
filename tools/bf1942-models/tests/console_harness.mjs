// Drives `viewer/console.js` outside a browser and prints one JSON blob.
//
// Same shape as the other harnesses here: `tests/test_console.py` copies the
// viewer module in under its own name, so the file under test is the file the
// page loads, byte for byte. `console.js` imports nothing at all and its model
// half touches no DOM, so plain node is enough for everything except the
// glyph drawing -- and even that only needs a recording 2D stub.

import {
  GameConsole, splitCommand, parseArgs, bandHeight, paintConsole,
  PROMPT, MAX_LINE, PAGE_LINES, VIEW_LINES, SCROLL_MARKER, MESSAGES,
  OK, ERROR,
} from './console.js';

const results = {};

// -- constants, so a change to any of them has to be deliberate -------------

results.constants = {
  prompt: PROMPT,
  maxLine: MAX_LINE,
  pageLines: PAGE_LINES,
  viewLines: VIEW_LINES,
  scrollMarkerLength: SCROLL_MARKER.length,
  scrollMarkerChars: [...new Set(SCROLL_MARKER)].join(''),
};

// -- the line parser --------------------------------------------------------

results.parse = {
  call: splitCommand('game.usehud 1'),
  noArgs: splitCommand('console.showfps'),
  equals: splitCommand('show.dev = 1'),
  quoted: splitCommand('admin.serverMessage "hello there" 2'),
  keyword: splitCommand('rem this is a comment'),
  keywordCased: splitCommand('REM shouting'),
  bare: splitCommand('showHud'),
  empty: splitCommand('   '),
  dottedMethod: splitCommand('a.b.c 1'),
  leadingSpace: splitCommand('   game.usehud 0'),
};
results.args = {
  plain: parseArgs('1 2 3'),
  quoted: parseArgs('"two words" tail'),
  unterminated: parseArgs('"never closed'),
  runs: parseArgs('  a   b  '),
};

// -- the reference capture, reproduced line for line ------------------------
//
// The user's screenshot, taken over the spawn view on Wake, reads:
//
//   Adding <skandia> (0) to buddylist
//   > game.showHud
//   Error  (2): game.showHud
//   Error : Unknown object or method!
//   >
//
// `game.showHud` does not exist in 1.61 -- `showHud` appears nowhere in
// BF1942.exe's string table, while `useHud` does (and the shipped
// `Mods/bf1942/Settings/AliasedCommands.con` aliases `hud` to `game.usehud`).
// So it takes the `Unknown object or method!` branch, and the two-line error
// is the shape `executeLine` prints.
{
  const c = new GameConsole();
  // The client console has already run two lines of its own by the time the
  // player types (the counter is a session counter, saved/zeroed/restored
  // only around `OldConsole::run`), which is why the capture reads (2).
  c.lineNumber = 2;
  c.output('Adding <skandia> (0) to buddylist');
  c.setLine('game.showHud');
  c.asciiKey(0x0d);
  results.capture = {
    scrollback: c.scrollback.slice(),
    tail: c.getLines(5),
    lineNumberAfter: c.lineNumber,
  };
}

// -- error text for every dispatcher branch ---------------------------------

{
  const c = new GameConsole({ access: 1 });
  c.register({ object: 'show', method: 'dev', minArgs: 1, maxArgs: 1,
               argTypes: ['int'], run: () => {} });
  c.register({ object: 'game', method: 'usehud', minArgs: 0, maxArgs: 1,
               argTypes: ['int'], run: () => {} });
  c.register({ object: 'admin', method: 'secret', minArgs: 0, maxArgs: 0,
               access: 9, run: () => {} });
  c.register({ object: 'game', method: 'later', minArgs: 0, maxArgs: 0,
               active: () => false, run: () => {} });
  c.register({ object: 'game', method: 'readonly', minArgs: 0, maxArgs: 1,
               type: 0, argTypes: ['int'], run: () => {} });
  c.register({ object: 'game', method: 'writeonly', minArgs: 0, maxArgs: 1,
               type: 2, argTypes: ['int'], run: () => {} });

  const probe = line => {
    const r = c.handleCommand(line);
    return { code: r.code, message: r.message };
  };
  results.dispatch = {
    unknownObject: probe('nosuch.method'),
    unknownMethod: probe('game.showHud'),
    bareToken: probe('showHud'),
    unauthorised: probe('admin.secret'),
    notActive: probe('game.later'),
    tooFew: probe('show.dev'),
    tooMany: probe('show.dev 1 2'),
    onlyReadable: probe('game.readonly 1'),
    onlySetable: probe('game.writeonly'),
    ok: probe('show.dev 1'),
    okEquals: probe('show.dev = 1'),
    knownMessages: MESSAGES,
  };
}

// -- show.dev, the debug gate ----------------------------------------------

{
  const seen = [];
  const c = new GameConsole();
  c.register({
    object: 'show', method: 'dev', minArgs: 1, maxArgs: 1, argTypes: ['int'],
    run: args => { seen.push(args[0]); },
  });
  for (const line of ['show.dev 1', 'show.dev = 1', 'show.dev 0',
                      'SHOW.DEV 1', 'show.dev  =  0']) {
    c.executeLine(line, { echo: false, echoErrors: false });
  }
  results.showDev = { seen, codes: undefined };
}

// -- history, editing, scroll ----------------------------------------------

{
  const c = new GameConsole();
  c.register({ object: 'a', method: 'b', minArgs: 0, maxArgs: 9, run: () => {} });
  c.setLine('a.b 1'); c.asciiKey(0x0d);
  c.setLine('a.b 2'); c.asciiKey(0x0d);
  c.setLine('a.b 3'); c.asciiKey(0x0d);
  const walk = [];
  c.asciiKey(0x10); walk.push(c.line);   // ^P back
  c.asciiKey(0x10); walk.push(c.line);
  c.asciiKey(0x10); walk.push(c.line);
  c.asciiKey(0x10); walk.push(c.line);   // clamped at the oldest
  c.asciiKey(0x0e); walk.push(c.line);   // ^N forward
  c.asciiKey(0x0e); walk.push(c.line);
  c.asciiKey(0x0e); walk.push(c.line);   // back to a fresh line
  results.history = { walk, size: c.history.length };
}

{
  const c = new GameConsole();
  c.setLine('abc');
  c.asciiKey(0x08);                      // Backspace drops the last char
  const afterBackspace = c.line;
  c.asciiKey(0x7f);                      // Delete clears the line
  const afterDelete = c.line;
  c.asciiKey('x'.charCodeAt(0));
  const afterType = c.line;
  c.setLine('y'.repeat(MAX_LINE + 40));
  const clamped = c.line.length;
  c.setLine('z'.repeat(MAX_LINE));
  c.asciiKey('!'.charCodeAt(0));         // refused at the cap, not truncated
  results.editing = {
    afterBackspace, afterDelete, afterType, clamped,
    atCap: c.line.length, capTail: c.line.slice(-1),
  };
}

{
  const c = new GameConsole();
  for (let i = 0; i < 60; i++) c.output(`line ${i}`);
  const steps = [];
  steps.push(c.scroll);
  c.gameInput('c_GIPageUp'); steps.push(c.scroll);
  c.gameInput('c_GIPageUp'); steps.push(c.scroll);
  const scrolledTail = c.getLines(VIEW_LINES).slice(-1)[0];
  const scrolledFirst = c.getLines(VIEW_LINES)[0];
  for (let i = 0; i < 40; i++) c.gameInput('c_GIPageUp');
  steps.push(c.scroll);                  // clamped at pages - 1
  for (let i = 0; i < 40; i++) c.gameInput('c_GIPageDown');
  steps.push(c.scroll);                  // clamped at 0
  results.scroll = {
    steps,
    pages: Math.floor(60 / PAGE_LINES),
    scrolledTail,
    scrolledFirst,
    bottomTail: c.getLines(VIEW_LINES).slice(-1)[0],
  };
}

// -- getLines: the band's contents -----------------------------------------

{
  const empty = new GameConsole();
  const short = new GameConsole();
  for (let i = 0; i < 4; i++) short.output(`m${i}`);
  const full = new GameConsole();
  for (let i = 0; i < 50; i++) full.output(`m${i}`);
  full.setLine('typing');
  results.getLines = {
    emptyCount: empty.getLines(20).length,
    emptyOnly: empty.getLines(20),
    shortCount: short.getLines(20).length,
    shortLines: short.getLines(20),
    fullCount: full.getLines(20).length,
    fullFirst: full.getLines(20)[0],
    fullLast: full.getLines(20).slice(-1)[0],
  };
}

// -- completion -------------------------------------------------------------

{
  const c = new GameConsole();
  c.register({ object: 'game', method: 'usehud', argTypes: ['int'], returns: 'void' });
  c.register({ object: 'game', method: 'useTrees', argTypes: ['int'], returns: 'void' });
  c.register({ object: 'show', method: 'dev', argTypes: ['int'], returns: 'void' });

  c.setLine('show.d');
  const unique = { took: c.autoComplete(), line: c.line, printed: c.scrollback.length };

  const c2 = new GameConsole();
  c2.register({ object: 'game', method: 'usehud', argTypes: ['int'], returns: 'void' });
  c2.register({ object: 'game', method: 'useTrees', argTypes: ['int'], returns: 'void' });
  c2.setLine('game.use');
  const ambiguous = { took: c2.autoComplete(), line: c2.line, printed: c2.scrollback.slice() };

  const c3 = new GameConsole();
  c3.setLine('zzz');
  const none = { took: c3.autoComplete(), line: c3.line };

  results.completion = { unique, ambiguous, none };
}

// -- toggle + swallow -------------------------------------------------------

{
  const c = new GameConsole();
  const ev = (code, key, extra = {}) => ({ code, key, repeat: false, ...extra });
  const closedTook = c.keydown(ev('KeyW', 'w'));
  c.setOpen(true);
  const openTook = c.keydown(ev('KeyW', 'w'));
  const lineAfterW = c.line;
  const ctrlTook = c.keydown(ev('KeyW', 'w', { ctrlKey: true }));
  const escTook = c.keydown(ev('Escape', 'Escape'));
  results.swallow = {
    closedTook, openTook, lineAfterW, ctrlTook, escTook,
    isToggle: GameConsole.isToggleKey(ev('Backquote', '`')),
    isToggleRepeat: GameConsole.isToggleKey({ code: 'Backquote', repeat: true }),
    isToggleOther: GameConsole.isToggleKey(ev('KeyW', 'w')),
  };
}

// -- band geometry ----------------------------------------------------------
//
// `(lineHeight + 1) * lineCount + 4`, the client drawer's own arithmetic at
// 0x00464fca-0x00464fce. At the capture's 1124 px screen with a pitch of 22
// and a full 20-line band that is 444 px, 39.5% -- the capture measured 442
// px / 39%.

results.band = {
  twentyAt21: bandHeight(20, 20),
  twentyAt22: bandHeight(20, 21),
  fiveAt21: bandHeight(5, 20),
  fractionAt1124: bandHeight(20, 21) / 1124,
};

// -- the painter, through a recording 2D stub -------------------------------

{
  const calls = { rects: [], texts: [] };
  const ctx = {
    fillStyle: '', font: '', textBaseline: '',
    clearRect() {},
    fillRect(x, y, w, h) { calls.rects.push([x, y, w, h, ctx.fillStyle]); },
    fillText(t, x, y) { calls.texts.push([t, x, y]); },
    drawImage() {},
  };
  const c = new GameConsole();
  for (let i = 0; i < 40; i++) c.output(`m${i}`);
  c.setLine('game.usehud');
  const band = paintConsole(ctx, c, { width: 2000, height: 1124, pitch: 22 });
  results.paint = {
    band,
    wash: calls.rects[0],
    firstText: calls.texts[0],
    lastText: calls.texts[calls.texts.length - 1],
    textCount: calls.texts.length,
  };
}

console.log(JSON.stringify(results));
