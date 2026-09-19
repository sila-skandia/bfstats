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
  MAX_SCROLLBACK, MAX_COMMAND_HISTORY, OK, ERROR,
} from './console.js';

const results = {};

// -- constants, so a change to any of them has to be deliberate -------------

results.constants = {
  prompt: PROMPT,
  maxLine: MAX_LINE,
  pageLines: PAGE_LINES,
  viewLines: VIEW_LINES,
  maxScrollback: MAX_SCROLLBACK,
  maxCommandHistory: MAX_COMMAND_HISTORY,
  scrollMarkerLength: SCROLL_MARKER.length,
  scrollMarkerChars: [...new Set(SCROLL_MARKER)].join(''),
};

// -- the line parser --------------------------------------------------------

results.parse = {
  call: splitCommand('game.usehud 1'),
  noArgs: splitCommand('console.showfps'),
  equals: splitCommand('show.dev = 1'),
  equalsAlone: splitCommand('show.dev ='),
  // The three lines the `=` divergence must NOT touch: a quoted `"="`
  // argument, an `=` glued to its value, and an `=` that is not the first
  // argument. The engine passes all three straight through to the method.
  equalsQuoted: splitCommand('admin.say "=" tail'),
  equalsGlued: splitCommand('show.dev =1'),
  equalsLater: splitCommand('admin.say x = y'),
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
//
// The number in the parentheses is NOT a count of what the player has typed:
// `executeLine`'s fifth bool gates the increment (`0x083e9f7d`), the console
// keyboard passes it false (`0x083eabe5`), and only `run`/`include` pass it
// true -- both saving, zeroing and restoring the counter around the file.
// So it is whatever ambient value the console holds, and it is the SAME on
// every error of a session. The capture's 2 is that ambient value on the
// owner's client; this reconstruction cannot derive it, so the case below
// seeds it to prove the formatting and then checks that a second bad line
// prints the same number rather than a bigger one. The page itself starts at
// 0 and stays there.
{
  const c = new GameConsole();
  c.lineNumber = 2;
  c.output('Adding <skandia> (0) to buddylist');
  c.setLine('game.showHud');
  c.asciiKey(0x0d);
  const tail = c.getLines(5);
  c.setLine('game.showHud');
  c.asciiKey(0x0d);
  results.capture = {
    scrollback: c.scrollback.slice(),
    tail,
    lineNumberAfter: c.lineNumber,
    secondError: c.scrollback[c.scrollback.length - 2],
  };
}

// The page's own console, untouched, prints (0) -- and keeps printing it.
{
  const c = new GameConsole();
  c.setLine('game.showHud'); c.asciiKey(0x0d);
  c.setLine('game.showHud'); c.asciiKey(0x0d);
  results.freshCounter = {
    lines: c.scrollback.filter(l => l.startsWith('Error  (')),
    lineNumber: c.lineNumber,
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

  // The retail console remembers ten commands: ctor `[edi+0x5c] = 0xa`
  // (lnxded `0x083dc09c`, client `0x005a226e`), the cap
  // `setMaxCommandHistorySize` writes.
  const deep = new GameConsole();
  deep.register({ object: 'a', method: 'b', minArgs: 0, maxArgs: 9, run: () => {} });
  for (let i = 0; i < 25; i++) { deep.setLine(`a.b ${i}`); deep.asciiKey(0x0d); }
  results.history = {
    walk, size: c.history.length,
    cappedSize: deep.history.length,
    cappedOldest: deep.history[0],
  };
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
  c.setLine('typing');
  const steps = [];
  steps.push(c.scroll);
  c.gameInput('c_GIPageUp'); steps.push(c.scroll);
  c.gameInput('c_GIPageUp'); steps.push(c.scroll);
  const scrolledView = c.getLines(VIEW_LINES);
  for (let i = 0; i < 40; i++) c.gameInput('c_GIPageUp');
  steps.push(c.scroll);                  // clamped at pages - 1
  for (let i = 0; i < 40; i++) c.gameInput('c_GIPageDown');
  steps.push(c.scroll);                  // clamped at 0
  results.scroll = {
    steps,
    pages: Math.floor(60 / PAGE_LINES),
    scrolledCount: scrolledView.length,
    scrolledTail: scrolledView.slice(-1)[0],
    scrolledMarker: scrolledView.slice(-2)[0],
    scrolledFirst: scrolledView[0],
    bottomTail: c.getLines(VIEW_LINES).slice(-1)[0],
  };
}

// Typing anything at all snaps the view back to the bottom, and anything
// that is not Up/Down leaves the history walk: the common tail at
// `0x083ea973` multiplies both members by a 0/1 flag.
{
  const c = new GameConsole();
  c.register({ object: 'a', method: 'b', minArgs: 0, maxArgs: 9, run: () => {} });
  for (let i = 0; i < 60; i++) c.output(`line ${i}`);
  c.setLine('a.b 1'); c.asciiKey(0x0d);
  const after = {};
  c.gameInput('c_GIPageUp');
  after.scrolled = c.scroll;
  c.asciiKey('x'.charCodeAt(0));
  after.afterTyping = c.scroll;
  c.gameInput('c_GIPageUp');
  c.asciiKey(0x08);                      // Backspace counts too
  after.afterBackspace = c.scroll;
  c.gameInput('c_GIPageUp');
  c.gameInput('c_GIPageDown');
  after.pageKeysKeepIt = c.scroll;
  c.setLine('');
  c.asciiKey(0x10);                      // Up: recalls, and resets the scroll
  after.afterHistory = c.scroll;
  after.historyLine = c.line;
  results.tailResets = after;
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

// -- output: newlines, the 77-character wrap, and the 1024-line cap --------
{
  const c = new GameConsole();
  c.output('one\ntwo');
  const newlines = c.scrollback.slice();

  const d = new GameConsole();
  d.output('z'.repeat(MAX_LINE * 2 + 5));
  const wrapped = d.scrollback.map(l => l.length);

  const e = new GameConsole();
  for (let i = 0; i < MAX_SCROLLBACK + 30; i++) e.output(`l${i}`);
  results.output = {
    newlines,
    wrapped,
    capped: e.scrollback.length,
    oldestKept: e.scrollback[0],
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
  // Tab itself is consumed either way: the engine's key handler never lets
  // it through, so neither may the page -- or the browser moves focus into
  // the hidden debug panel behind the console.
  const noneKey = c3.asciiKey(0x09);
  const noneEvent = (() => {
    const c4 = new GameConsole();
    c4.setOpen(true);
    c4.setLine('zzz');
    return c4.keydown({ code: 'Tab', key: 'Tab', repeat: false });
  })();

  results.completion = { unique, ambiguous, none, noneKey, noneEvent };
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
  // Every key the game would otherwise act on, while the console is up.
  const c2 = new GameConsole();
  c2.setOpen(true);
  const gameKeys = {};
  for (const [code, key] of [['KeyW', 'w'], ['KeyA', 'a'], ['KeyS', 's'],
                             ['KeyD', 'd'], ['KeyE', 'e'], ['Space', ' '],
                             ['KeyC', 'c'], ['KeyM', 'm'], ['KeyN', 'n'],
                             ['Digit1', '1'], ['Digit5', '5'],
                             ['ShiftLeft', 'Shift'], ['ControlLeft', 'Control'],
                             ['F5', 'F5'], ['Home', 'Home']]) {
    gameKeys[code] = c2.keydown(ev(code, key));
  }
  const typed = c2.line;

  results.swallow = {
    closedTook, openTook, lineAfterW, ctrlTook, escTook,
    gameKeys, typed,
    isToggle: GameConsole.isToggleKey(ev('Backquote', '`')),
    isToggleRepeat: GameConsole.isToggleKey({ code: 'Backquote', repeat: true }),
    isToggleOther: GameConsole.isToggleKey(ev('KeyW', 'w')),
    // A non-US layout: the physical key left of `1` is `Backquote` whatever
    // it prints. On a French AZERTY it prints a superscript two, on a German
    // QWERTZ a circumflex, on a UK layout a grave. `code` is the physical
    // key, so all three toggle -- and a layout that prints `~` from some
    // OTHER physical key does not.
    isToggleAzerty: GameConsole.isToggleKey(ev('Backquote', '²')),
    isToggleQwertz: GameConsole.isToggleKey(ev('Backquote', '^')),
    isToggleTildeElsewhere: GameConsole.isToggleKey(ev('BracketRight', '~')),
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
