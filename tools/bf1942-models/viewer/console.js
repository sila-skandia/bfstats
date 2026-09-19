/**
 * The BF1942 in-game console, reconstructed from the retail client and the
 * Linux dedicated server.
 *
 * The two binaries share one class. In the unstripped server it is
 * `dice::ref2::io::OldConsole` (ctor lnxded `0x083dbfc0`); in the stripped
 * client it is the same code at `0x005a2230`, reached from the two static
 * singletons `0x009a9420` (`new OldConsole(true)`, the one the game draws)
 * and `0x009a9424` (`new OldConsole(false)`), both constructed at
 * `0x00856720`/`0x00856750`. Everything below carries the address it came
 * from; anything that could not be read out of a binary says so.
 *
 * What this module is NOT: the drawing is a faithful reconstruction of the
 * client's own layout rule, but it paints to a 2D canvas rather than through
 * D3D8, and the page's own keyboard is not the engine's `ControlMap`. The
 * model half (parse, dispatch, history, scrollback, the exact message text)
 * is the part that is engine-accurate.
 *
 * Deliberately free of `three` imports so `tests/console_harness.mjs` can
 * exercise it under plain node.
 */

// ---------------------------------------------------------------- constants

/** `OldConsole`'s default prompt, set in the constructor: client
 *  `0x005a2230` writes the literal `"> "` (string `0x008c3978`) into the
 *  prompt member, lnxded `0x083dc0be` writes `0x86eb09f`, the same two
 *  bytes. `setPrompt` (lnxded `0x083ec350`) appends a space to whatever it
 *  is given, so a prompt always ends in one. */
export const PROMPT = '> ';

/** Longest line the edit buffer takes: client ctor `param_1[0x4e] = 0x4d`,
 *  lnxded `0x083dc0a3` `[edi+0x160] = 0x4d`. `getMaxLineSize()` returns it.
 *  The buffer itself is inside the object (lnxded `this+0x60`), which is why
 *  it is a fixed 77 and not a growing string. */
export const MAX_LINE = 0x4d;

/** Scrollback cap: client ctor `param_1[0xbf] = 10000`, lnxded
 *  `0x083dc14c` `[edi+0x1bc] = 0x2710`. */
export const MAX_SCROLLBACK = 10000;

/** Lines PageUp / PageDown move by: client ctor `param_1[0x57] = 8`,
 *  lnxded `0x083dc0d6` `[edi+0x16c] = 8`. */
export const PAGE_LINES = 8;

/** How many lines the drawn console asks for, and therefore how tall its
 *  band is: the client's console drawer `FUN_00464ee0` pushes `0x14` at
 *  `0x00464f96` before calling `getLines` through the console vtable
 *  (`[eax+0x1c]`, slot 7 of the vtable at `0x009033a8`). The boot-time GDI
 *  console `FUN_004650d0` asks for the same 20 at `0x0046516f`. */
export const VIEW_LINES = 20;

/** The scrolled-up marker. When the scroll offset is non-zero `getLines`
 *  drops the prompt line and pushes this instead: lnxded `0x083ec28f`
 *  pushes `0x86e38e0`, sixty `+` characters (client copy `0x00903448`). */
export const SCROLL_MARKER = '+'.repeat(60);

/** The wash the console lays over the scene. `FUN_004649f0` — run by the
 *  show/hide setter `FUN_00464af0` every time the console is opened —
 *  loads `"texture/white.tga"`, builds the quad with alpha `0x3f000000`
 *  (0.5f) and blend mode 2, then immediately overrides both:
 *  `FUN_006084c0(quad, 1)` sets blend mode 1 and `FUN_006084e0(quad, 0x3f4ccccd)`
 *  sets alpha 0.8f. Mode 1 is `SetRenderState(D3DRS_SRCBLEND=0x13, 5)` /
 *  `(D3DRS_DESTBLEND=0x14, 6)` — SRCALPHA / INVSRCALPHA, ordinary alpha
 *  blending (`FUN_00608560` `0x006085e8`, `FUN_0045ff10`). The vertex colour
 *  is `(int)(alpha * 255.0f) << 24` (`0x006085b4`, the 255.0f at
 *  `0x008d1a70`), so the RGB comes from the white texture and the alpha from
 *  the quad: a flat white wash at 0.8. */
export const WASH = 'rgba(255, 255, 255, 0.8)';

/** Text colour. Not read out of the binary — the text object at
 *  `Setup+0x2d8 + 0x08` is drawn through its own vtable slot `+0x10` and its
 *  colour is set somewhere this pass did not reach. Black is what the user's
 *  reference capture shows. */
export const TEXT_COLOR = '#000000';

/** Left inset and first-line offset, straight out of the drawer:
 *  `0x00465078` pushes `0x40000000` (2.0f) as x, and the y of line `i` is
 *  `(lineHeight + 1) * i + 2` (`0x00465063`-`0x00465067`). The band is
 *  `(lineHeight + 1) * lineCount + 4` px (`0x00464fca`-`0x00464fce`). */
export const TEXT_X = 2;
export const TEXT_Y0 = 2;
export const LINE_GAP = 1;
export const BAND_PAD = 4;

/**
 * `OldConsole::handleCommand` return codes, as the `executeLine` switch at
 * lnxded `0x083e9f5d`-`0x083e9f77` reads them. 1 is the quiet success path;
 * 2 is the one that prints. 0 and 3 exist and take other branches
 * (`0x083ea4c3`, `0x083ea069`) that this reconstruction does not model.
 */
export const OK = 1;
export const ERROR = 2;

/**
 * The dispatcher's own messages, verbatim. Client block
 * `0x00902cb8`-`0x00902d3c`, lnxded block `0x086eb01d`-`0x086eb07d`; both
 * binaries ship the same five strings in the same wording, including
 * "setable" with one t.
 */
export const MESSAGES = {
  notActive: 'Method is not active!',               // lnxded 0x086eb01d
  onlySetable: 'Property is only setable!',         // 0x086eb033
  onlyReadable: 'Property is only readable!',       // 0x086eb04d
  unauthorised: 'Unauthorised method!',             // 0x086eb068
  unknown: 'Unknown object or method!',             // 0x086eb07d
  tooFew: 'Too few arguments, the min no of arguments is ',   // 0x086eb5ee-ish, pushed at 0x083e45ee
  tooMany: 'Too many arguments, the max no of arguments is ', // pushed at 0x083e65b3
  oneArg: 'Properties only takes one argument!',    // pushed at 0x083e67e5
  wrongSyntax: 'Wrong syntax!',                     // pushed at 0x083e34ad
};

/**
 * The keywords `handleCommand` tests the first token against, before it ever
 * looks for a dot. Every one is compared with `strcasecmp` (lnxded
 * `0x083e41b1`, `0x083e41ef` for `run` and `include`), so the whole script
 * language is case-insensitive. Listed here so completion and the parser
 * agree with the engine about what is not an object name.
 */
export const KEYWORDS = [
  'rem', 'beginRem', 'endRem',                      // 0x086e3ab3 / ab7 / ac0
  'if', 'elseIf', 'else', 'endIf',                  // 0x086e3ac7 / aca / ad1 / ad6
  'while', 'endWhile',                              // 0x086e3b0f / b15
  'return', 'quit', 'exit',                         // 0x086e3adc / ae3 / ae8
  'var', 'const',                                   // 0x086e3b05 / b09
  'echo',                                           // 0x086bdabc
  'run', 'include',                                 // 0x086eb011 / 015
  'alias', 'listalias', 'unalias',                  // 0x086a2ff2-ish block
  'beginNoExecution', 'endNoExecution',             // 0x086eafd2 / fe3
];

const KEYWORD_SET = new Set(KEYWORDS.map(k => k.toLowerCase()));

// -------------------------------------------------------------- the parser

/**
 * Split a line the way `OldConsole::handleCommand` does.
 *
 * The first whitespace-delimited token is scanned forward for the first `.`
 * (lnxded `0x083e422d` `cmp BYTE PTR [edi+ebx*1],0x2e`, then `substr(0, i)`
 * at `0x083e4244`); everything before it is the object, everything after is
 * the method. A token with no dot at all is a keyword or a syntax error.
 *
 * `=` is NOT part of this. The only `=` the engine's dispatcher understands
 * is the one in `var v_x = 1` / `const c_x = 1` and in assignment to an
 * existing `v_` variable (lnxded `0x083e14c3` and `0x083e78ce`, both leading
 * to `setVariable`); `OldConsole::getArgs` (`0x083de4d0`) reads arguments as
 * plain whitespace- or quote-delimited tokens and has no `=` case, so in the
 * real game `show.dev = 1` would hand the method two arguments. The viewer
 * accepts it anyway, because that is the spelling the page's own users were
 * told to type: `dropEquals` below drops a single leading `=` argument and
 * nothing else. That is this module's one deliberate divergence.
 */
export function splitCommand(line) {
  const text = String(line ?? '').trim();
  if (!text) return { kind: 'empty' };

  const firstSpace = text.search(/\s/);
  const token = firstSpace === -1 ? text : text.slice(0, firstSpace);
  const rest = firstSpace === -1 ? '' : text.slice(firstSpace + 1);

  if (KEYWORD_SET.has(token.toLowerCase())) {
    return { kind: 'keyword', keyword: token.toLowerCase(), rest, args: parseArgs(rest) };
  }

  const dot = token.indexOf('.');
  if (dot < 0) return { kind: 'bare', token, rest, args: parseArgs(rest) };

  return {
    kind: 'call',
    object: token.slice(0, dot),
    method: token.slice(dot + 1),
    args: dropEquals(parseArgs(rest)),
  };
}

/**
 * `OldConsole::getArgs` (lnxded `0x083de4d0`): arguments come off an
 * `istringstream` a token at a time, and a token that opens with `"` (0x22,
 * tested at `0x083de8cf`) runs to the closing quote so it may contain spaces
 * (0x20 at `0x083de8bd` / `0x083de8da`). Nothing else is special — no
 * escapes, no `=`.
 */
export function parseArgs(rest) {
  const out = [];
  const text = String(rest ?? '');
  let i = 0;
  while (i < text.length) {
    while (i < text.length && /\s/.test(text[i])) i++;
    if (i >= text.length) break;
    if (text[i] === '"') {
      i++;
      let start = i;
      while (i < text.length && text[i] !== '"') i++;
      out.push(text.slice(start, i));
      if (i < text.length) i++;           // the closing quote
    } else {
      let start = i;
      while (i < text.length && !/\s/.test(text[i])) i++;
      out.push(text.slice(start, i));
    }
  }
  return out;
}

/** The viewer's one divergence from the engine: see `splitCommand`. */
function dropEquals(args) {
  return args.length && args[0] === '=' ? args.slice(1) : args;
}

// ------------------------------------------------------------- the registry

/**
 * One registered command, shaped after the engine's own `ConsoleObject`
 * (field layout from bf42plus `src/bf/console.h`, which hooks these objects
 * in the live client; the client's own registrars, e.g. `FUN_004dfe20` for
 * `vehicleIcon`, fill exactly these slots):
 *
 *   type       1 read/write, 0 read only, 2 write only
 *   objectname the half before the dot
 *   functionname the half after it
 *   access     the permission level `Unauthorised method!` guards
 *   minargcount / maxargcount
 *   argdesc[] / retdesc  the strings Tab completion prints
 */
export class Command {
  constructor({ object, method, minArgs = 0, maxArgs = null, argTypes = [],
                returns = 'void', type = 1, access = 1, active = null, run }) {
    this.object = object;
    this.method = method;
    this.minArgs = minArgs;
    this.maxArgs = maxArgs === null ? Math.max(minArgs, argTypes.length) : maxArgs;
    this.argTypes = argTypes;
    this.returns = returns;
    this.type = type;
    this.access = access;
    this.active = active;                  // () => bool, or null for always
    this.run = run;
  }

  get name() { return `${this.object}.${this.method}`; }

  /** `object.method (argType, argType) -> returnType`, the shape
   *  `autoCompletion` builds from ` (` / `, ` / `)` / ` -> `
   *  (lnxded `0x083e9303`, `0x083e933e`, `0x083e936e`, `0x083e922e`). */
  get signature() {
    return `${this.name} (${this.argTypes.join(', ')}) -> ${this.returns}`;
  }
}

// --------------------------------------------------------------- the model

/**
 * The console itself: scrollback, edit line, history, dispatch.
 *
 * `access` is the caller's permission level, compared against each command's
 * own. The engine passes an `AccessType` into `handleCommand` (the `7` the
 * interactive path pushes at lnxded `0x083e9f4a`) and answers
 * `Unauthorised method!` when the command wants more.
 */
export class GameConsole {
  constructor({ viewLines = VIEW_LINES, access = 7 } = {}) {
    /** Everything `output()` has been handed, oldest first. */
    this.scrollback = [];
    /** The line being typed. Capped at MAX_LINE, like `this+0x60`. */
    this.line = '';
    /** PageUp/PageDown offset, in pages. `this+0x170`. */
    this.scroll = 0;
    /** Command history, newest last; Up walks back through it. */
    this.history = [];
    /** Where Up/Down currently sit. `history.length` means "on a fresh line". */
    this.historyIndex = 0;
    /** The number `Error  (N):` prints: `this+0x1d0`, bumped once per
     *  counted `executeLine` (lnxded `0x083e9f89`) and saved / zeroed /
     *  restored around `OldConsole::run` so that inside a `.con` file it is
     *  the line number within that file (`0x083ec6d3`, `0x083ec6f1`). */
    this.lineNumber = 0;
    /** The `workingFile` that sits between "Error " and the "(N): " — empty
     *  for a line typed at the console, which is why the capture reads
     *  `Error  (2):` with two spaces and `Error : ` with one. */
    this.workingFile = '';
    this.prompt = PROMPT;
    this.viewLines = viewLines;
    this.access = access;
    this.open = false;
    this.commands = new Map();             // "object.method" lowercased -> Command
    this.version = 0;                      // bumped on any visible change
  }

  // ------------------------------------------------------------- registry

  /** Add a command. Later streams call this; nothing here knows about them. */
  register(spec) {
    const cmd = spec instanceof Command ? spec : new Command(spec);
    this.commands.set(cmd.name.toLowerCase(), cmd);
    return cmd;
  }

  /** Case-insensitive, because the engine's is: the game's own
   *  `AliasedCommands.con` aliases `game.listplayers` to a method the binary
   *  spells `listPlayers`, and both work in the retail client. */
  lookup(object, method) {
    return this.commands.get(`${object}.${method}`.toLowerCase()) || null;
  }

  // ------------------------------------------------------------ scrollback

  /** `OldConsole::output` (lnxded `0x083dcf50`, console vtable slot `+0x10`).
   *  A message with newlines in it becomes one scrollback line each. */
  output(text) {
    for (const part of String(text ?? '').split('\n')) {
      this.scrollback.push(part);
    }
    while (this.scrollback.length > MAX_SCROLLBACK) this.scrollback.shift();
    this.version++;
  }

  /**
   * `OldConsole::getLines(n, out)` — lnxded `0x083ec0e0`, the client's
   * vtable slot 7. It hands back at most `n` strings:
   *
   *   - the last `n - 1` scrollback lines (fewer if there are fewer), offset
   *     upwards by `scroll * PAGE_LINES`;
   *   - then, as the final line, either `prompt + editLine` when the view is
   *     at the bottom, or `SCROLL_MARKER` when it is scrolled up — in which
   *     case one fewer scrollback line is emitted to make room
   *     (`0x083ec170` `dec edi`).
   */
  getLines(n = this.viewLines) {
    const out = [];
    const total = this.scrollback.length;
    let count = Math.min(total, n - 1);
    let first = 0;
    if (total > n - 1) {
      first = Math.max(0, total - (n - 1) - this.scroll * PAGE_LINES);
    }
    if (this.scroll !== 0) count = Math.max(0, count - 1);
    for (let i = 0; i < count; i++) out.push(this.scrollback[first + i]);
    out.push(this.scroll !== 0 ? SCROLL_MARKER : this.prompt + this.line);
    return out;
  }

  // -------------------------------------------------------------- dispatch

  /**
   * `OldConsole::handleCommand` (lnxded `0x083de990`). Returns
   * `{ code, message }`: `OK` with no message when the line ran, `ERROR`
   * with one of `MESSAGES` when it did not.
   */
  handleCommand(line) {
    const parsed = splitCommand(line);

    if (parsed.kind === 'empty') return { code: OK, message: '' };

    if (parsed.kind === 'keyword') {
      switch (parsed.keyword) {
        case 'rem':
          return { code: OK, message: '' };
        case 'echo':
          this.output(parsed.rest);
          return { code: OK, message: '' };
        default:
          // The flow-control and file-running keywords are real, and are
          // listed in KEYWORDS so the parser does not mistake them for
          // object names, but this reconstruction does not implement them.
          return { code: ERROR, message: MESSAGES.unknown };
      }
    }

    // A token with no dot never reaches the object table.
    if (parsed.kind === 'bare') return { code: ERROR, message: MESSAGES.unknown };

    const cmd = this.lookup(parsed.object, parsed.method);
    if (!cmd) return { code: ERROR, message: MESSAGES.unknown };
    if (cmd.access > this.access) return { code: ERROR, message: MESSAGES.unauthorised };
    if (cmd.active && !cmd.active()) return { code: ERROR, message: MESSAGES.notActive };

    const args = parsed.args;
    if (args.length < cmd.minArgs) {
      return { code: ERROR, message: MESSAGES.tooFew + cmd.minArgs + '!' };
    }
    if (args.length > cmd.maxArgs) {
      return { code: ERROR, message: MESSAGES.tooMany + cmd.maxArgs + '!' };
    }
    if (args.length === 0 && cmd.type === 2) {
      return { code: ERROR, message: MESSAGES.onlySetable };
    }
    if (args.length > 0 && cmd.type === 0) {
      return { code: ERROR, message: MESSAGES.onlyReadable };
    }

    let returned;
    try {
      returned = cmd.run ? cmd.run(args, this) : undefined;
    } catch (err) {
      return { code: ERROR, message: String(err && err.message ? err.message : err) };
    }
    if (returned !== undefined && returned !== null && cmd.returns !== 'void') {
      this.output(String(returned));
    }
    return { code: OK, message: '' };
  }

  /**
   * `OldConsole::executeLine` (lnxded `0x083e9ae0`).
   *
   * Echo, when on, is `prompt + line` pushed into the scrollback
   * (`0x083ea606`: a copy of `this+0x168` with the line appended, handed to
   * `output` through vtable `+0x10`).
   *
   * An error prints the two-line form the user's capture shows
   * (`0x083ea1b7` onward):
   *
   *     "Error " + workingFile + " (" + lineNumber + "): " + line
   *     "Error " + workingFile + ": " + message
   *
   * with the pieces being the literals `"Error "` (`0x086e38c8`), `" ("`
   * (`0x08706306`), `"): "` (`0x086b9c63`) and `": "` (`0x086f24a2`). With
   * `workingFile` empty — which is what a line typed at the console has —
   * the first reads `Error  (2): game.showHud`, two spaces because `"Error "`
   * ends in one and `" ("` starts with one, and the second reads
   * `Error : Unknown object or method!`.
   *
   * The counter is bumped after the dispatch, not before (`0x083e9f89` sits
   * past the switch), so the number printed is how many lines this console
   * had already run.
   */
  executeLine(line, { echo = true, echoErrors = true, count = true } = {}) {
    const text = String(line ?? '');
    if (echo) this.output(this.prompt + text);

    const result = this.handleCommand(text);

    if (result.code === ERROR && echoErrors) {
      this.output(`Error ${this.workingFile} (${this.lineNumber}): ${text}`);
      this.output(`Error ${this.workingFile}: ${result.message}`);
    }
    if (count) this.lineNumber++;
    return result;
  }

  // ----------------------------------------------------------- completion

  /**
   * `OldConsole::autoCompletion` (lnxded `0x083e83a0`), reached from Tab.
   *
   * It walks `ConsoleObjects::getConsoleObjects()` (`0x083e8684`), splits the
   * current edit line on `.` (`0x083e87d8`) and prefix-matches the object and
   * the method halves with `strncasecmp` (`0x083e8862`, `0x083e89a2`), then
   * writes the result back into the edit buffer with `strncpy`
   * (`0x083e8b07`). The candidate list it prints is built with ` (`, `, `,
   * `)` and ` -> ` — argument types and a return type.
   *
   * Whether the engine completes to the longest common prefix or to the first
   * match was not read out of the binary; this completes to the longest
   * common prefix, and lists the candidates when there is more than one.
   */
  autoComplete() {
    const text = this.line;
    const lead = text.match(/^\s*/)[0];
    const token = text.slice(lead.length);
    if (/\s/.test(token)) return false;        // past the command word
    const matches = [...this.commands.values()]
      .filter(c => c.name.toLowerCase().startsWith(token.toLowerCase()))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (!matches.length) return false;

    const common = longestCommonPrefix(matches.map(c => c.name));
    if (common.length > token.length) this.setLine(lead + common);
    if (matches.length > 1) {
      for (const m of matches) this.output(m.signature);
    }
    this.version++;
    return true;
  }

  // ------------------------------------------------------------ edit line

  setLine(text) {
    this.line = String(text ?? '').slice(0, MAX_LINE);
    this.version++;
  }

  /**
   * `OldConsole::updateAsciiKey(char)` — lnxded `0x083ea900`, console vtable
   * slot `+0x14`. The engine folds every console key into one char:
   *
   *   0x0d Enter      execute the line, then clear it (`0x083eaba7`)
   *   0x08 Backspace  drop the last character (`0x083eab93`) — the console
   *                   has no cursor, so this is always the last one
   *   0x7f Delete     clear the whole line (`0x083eab80`)
   *   0x09 Tab        autoCompletion() (`0x083eab6e`)
   *   0x10 / 0x0e     history back / forward (`0x083eaa35`)
   *   0x02 / 0x06     scroll a page up / down (`0x083ea9bf`)
   *   anything else   append, up to MAX_LINE
   */
  asciiKey(ch) {
    const code = typeof ch === 'number' ? ch : String(ch).charCodeAt(0);
    switch (code) {
      case 0x0d: return this.commit();
      case 0x08:
        if (this.line.length) this.setLine(this.line.slice(0, -1));
        return true;
      case 0x7f: this.setLine(''); return true;
      case 0x09: return this.autoComplete();
      case 0x10: return this.historyStep(-1);
      case 0x0e: return this.historyStep(+1);
      case 0x02: return this.scrollBy(+1);
      case 0x06: return this.scrollBy(-1);
      default:
        if (code < 0x20) return false;
        if (this.line.length >= MAX_LINE) return true;
        this.setLine(this.line + String.fromCharCode(code));
        return true;
    }
  }

  /**
   * `updateGameInput` (lnxded `0x083eac60`) consumes exactly four of the
   * engine's game inputs and turns each into one of the control chars above:
   *
   *   c_GIUp (3)        -> 0x10   history back
   *   c_GIDown (4)      -> 0x0e   history forward
   *   c_GIPageUp (12)   -> 0x02   scroll up
   *   c_GIPageDown (13) -> 0x06   scroll down
   *
   * (the ordinals are `dice::ref2::io::addConstantHelper` registrations in
   * `io::Module::init`, lnxded `0x083f7f40`; client twin `0x00583bf0`).
   * c_GILeft and c_GIRight are bound in the default control map but the
   * console never reads them — there is no cursor to move.
   */
  gameInput(name) {
    switch (name) {
      case 'c_GIUp': return this.asciiKey(0x10);
      case 'c_GIDown': return this.asciiKey(0x0e);
      case 'c_GIPageUp': return this.asciiKey(0x02);
      case 'c_GIPageDown': return this.asciiKey(0x06);
      default: return false;
    }
  }

  commit() {
    const text = this.line;
    if (text.trim()) {
      this.history.push(text);
      while (this.history.length > MAX_SCROLLBACK) this.history.shift();
    }
    this.historyIndex = this.history.length;
    this.scroll = 0;
    this.setLine('');
    this.executeLine(text);
    return true;
  }

  historyStep(delta) {
    if (!this.history.length) return true;
    const next = Math.min(this.history.length,
                          Math.max(0, this.historyIndex + delta));
    this.historyIndex = next;
    this.setLine(next >= this.history.length ? '' : this.history[next]);
    return true;
  }

  /** The clamp is the engine's: `pages = totalLines / PAGE_LINES`, offset
   *  held in `[0, pages - 1]` (lnxded `0x083ea9f0` divides, `0x083eaa13`
   *  clamps at zero with the `shr 31 / dec / and` idiom, `0x083eaa27`
   *  clamps at the top). */
  scrollBy(delta) {
    const pages = Math.floor(this.scrollback.length / PAGE_LINES);
    if (pages <= 0) { this.scroll = 0; return true; }
    let next = this.scroll + delta;
    if (next < 0) next = 0;
    if (next >= pages) next = pages - 1;
    this.scroll = next;
    this.version++;
    return true;
  }

  // ------------------------------------------------------- browser keyboard

  /**
   * A browser `KeyboardEvent` folded into the engine's own alphabet. Returns
   * true when the console consumed it, which is the caller's cue to swallow
   * it rather than let the game see it.
   *
   * The engine's own bindings, for reference: the console opens on
   * `c_GIToggleConsole`, which the shipped
   * `Mods/bf1942/Settings/Default/Controls/Common.con` lines 26-27 bind to
   * `IDKey_Grave` and `IDKey_Capital` — backquote/tilde and Caps Lock, both
   * `c_CMNonRepetive`. The same two lines are compiled into the client's own
   * fallback control map at `0x00927088` and `0x00927020`. This page already
   * spends Caps Lock on the spawn menu, so only the tilde key toggles here.
   */
  keydown(event) {
    if (!this.open) return false;
    const { code, key } = event;
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    switch (code) {
      case 'Enter':
      case 'NumpadEnter': return this.asciiKey(0x0d);
      case 'Backspace': return this.asciiKey(0x08);
      case 'Delete': return this.asciiKey(0x7f);
      case 'Tab': return this.asciiKey(0x09);
      case 'ArrowUp': return this.gameInput('c_GIUp');
      case 'ArrowDown': return this.gameInput('c_GIDown');
      case 'PageUp': return this.gameInput('c_GIPageUp');
      case 'PageDown': return this.gameInput('c_GIPageDown');
      default:
        if (typeof key === 'string' && key.length === 1) {
          const ch = key.charCodeAt(0);
          if (ch >= 0x20 && ch !== 0x7f) return this.asciiKey(ch);
        }
        return false;
    }
  }

  /** The tilde key, `IDKey_Grave`. */
  static isToggleKey(event) {
    return event.code === 'Backquote' && !event.ctrlKey && !event.metaKey
      && !event.altKey && !event.repeat;
  }

  setOpen(on) {
    const next = Boolean(on);
    if (next === this.open) return false;
    this.open = next;
    // Opening rebuilds the wash quad in the engine (`FUN_00464af0` calls
    // `FUN_004649f0`) and leaves the edit line where it was; closing keeps
    // the scrollback. Only the scroll offset is reset, so a reopened console
    // is at the bottom.
    this.scroll = 0;
    this.version++;
    return true;
  }

  toggle() { return this.setOpen(!this.open); }
}

function longestCommonPrefix(names) {
  if (!names.length) return '';
  let prefix = names[0];
  for (const n of names.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < n.length
           && prefix[i].toLowerCase() === n[i].toLowerCase()) i++;
    prefix = prefix.slice(0, i);
    if (!prefix) break;
  }
  return prefix;
}

// ----------------------------------------------------------------- the view

/**
 * The band's height in CSS pixels, by the drawer's own arithmetic:
 * `(lineHeight + 1) * lineCount + 4` (client `0x00464fca`-`0x00464fce`),
 * where `lineCount` is however many strings `getLines(20)` actually handed
 * back and `lineHeight` is what the text object reports for a line.
 *
 * At the user's capture resolution (2000x1124) with the installed
 * `Font.rfa` — a 256x256 atlas whose header `Height` is 20 — that is
 * 21 * 20 + 4 = 424 px, or 37.7% of the screen. The capture measures 442 px
 * (39.3%), i.e. a pitch of 22 rather than 21, so the text object's reported
 * height is one more than the font header's `Height`. `bandHeight` takes the
 * pitch it is given rather than deriving it, so the page can use the
 * measured 22 and the arithmetic stays the engine's.
 */
export function bandHeight(lineCount, lineHeight) {
  return (lineHeight + LINE_GAP) * lineCount + BAND_PAD;
}

/**
 * A `Font/BF1942.font` glyph table, as `extract_console_font.py` writes it.
 * `Font::buildQuads` (client `0x0065ce10`) advances by `width + betweenWidth`
 * per glyph, except a space, which draws nothing and advances `spaceWidth`.
 */
export class BitmapFont {
  constructor(meta, image) {
    this.meta = meta;
    this.image = image;
    this.tinted = new Map();
  }

  get height() { return this.meta.height; }

  glyph(code) {
    const row = this.meta.glyphs[String(code)];
    return row ? { x0: row[0], y: row[1], x1: row[2], width: row[3] } : null;
  }

  advance(code) {
    if (code === 0x20) return this.meta.spaceWidth;
    const g = this.glyph(code);
    return g ? g.width + this.meta.betweenWidth : 0;
  }

  measure(text) {
    let w = 0;
    for (const ch of String(text)) w += this.advance(ch.charCodeAt(0));
    return w;
  }
}

/**
 * Draw one console frame into a 2D context sized `width` x `height` CSS px.
 *
 * `font` may be a `BitmapFont` (the game's own glyphs) or null, in which case
 * the text falls back to the platform monospace face at the same pitch. The
 * geometry is the drawer's either way: full width, `bandHeight` tall, the
 * wash first, then line `i` at `x = 2`, `y = (pitch) * i + 2`.
 */
export function paintConsole(ctx, consoleModel, {
  width, height, font = null, pitch = null,
  wash = WASH, color = TEXT_COLOR,
} = {}) {
  const lines = consoleModel.getLines(consoleModel.viewLines);
  const lineHeight = font ? font.height : 20;
  const step = pitch === null ? lineHeight + LINE_GAP : pitch;
  const band = Math.min(height, step * lines.length + BAND_PAD);

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, width, band);

  if (font && font.image) {
    const atlas = tintedAtlas(font, color);
    for (let i = 0; i < lines.length; i++) {
      drawBitmapLine(ctx, font, atlas, lines[i], TEXT_X, step * i + TEXT_Y0);
    }
  } else {
    ctx.fillStyle = color;
    ctx.textBaseline = 'top';
    ctx.font = `${Math.round(lineHeight * 0.8)}px ui-monospace, "DejaVu Sans Mono", monospace`;
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], TEXT_X, step * i + TEXT_Y0);
    }
  }
  return band;
}

/** The atlas ships white with the glyph in its alpha channel
 *  (`decode_alpha_tga`), so a colour is a `source-in` fill of a copy. */
function tintedAtlas(font, color) {
  let c = font.tinted.get(color);
  if (c) return c;
  const doc = typeof document !== 'undefined' ? document : null;
  if (!doc) return font.image;
  c = doc.createElement('canvas');
  c.width = font.image.width;
  c.height = font.image.height;
  const g = c.getContext('2d');
  g.drawImage(font.image, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  font.tinted.set(color, c);
  return c;
}

function drawBitmapLine(ctx, font, atlas, text, x, y) {
  let pen = x;
  for (const ch of String(text)) {
    const code = ch.charCodeAt(0);
    if (code === 0x20) { pen += font.meta.spaceWidth; continue; }
    const g = font.glyph(code);
    if (!g) continue;
    if (g.width > 0) {
      ctx.drawImage(atlas, g.x0, g.y, g.width, font.meta.height,
                    pen, y, g.width, font.meta.height);
    }
    pen += g.width + font.meta.betweenWidth;
  }
  return pen - x;
}

/** Load the atlas pair `extract_console_font.py` writes. Browser only;
 *  resolves to null if either half is missing, and the caller falls back to
 *  the platform monospace face. */
export async function loadConsoleFont(base = './fonts/bf1942') {
  try {
    const meta = await fetch(`${base}.json`).then(r => r.ok ? r.json() : null);
    if (!meta) return null;
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = `${base}.png`;
    });
    return new BitmapFont(meta, image);
  } catch {
    return null;
  }
}
