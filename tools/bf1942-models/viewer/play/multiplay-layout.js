// What of `menu/InternetMenu` and `menu/CreateGameMenu` the MULTIPLAY screen
// draws, and the few pure measurements its lists are laid out by. The
// screen (`multiplay.js`) and its CREATE GAME dialog (`create-game.js`) both
// read these. Split out of `multiplay.js`.

/** The one thing on this screen that is wrong rather than merely absent:
 *  the lobby has no answer, or what is typed in SERVER NAME will not do.
 *  Red, in the screen's own face. */
export const ALERT = [0.82, 0.24, 0.18];

/** Said where the rows would be when the lobby does not answer. The
 *  reasons it used to spell out — nothing can be joined, nothing can be
 *  created, Instant Battle still works — are now said by JOIN and CREATE
 *  GAME not being drawn at all. */
export const MASTER_DOWN = 'MASTER SERVER IS DOWN RIGHT NOW';

/** Plates for something this front end has not got: the PunkBuster badge
 *  and the GameSpy logo name services that are not running here (drawing
 *  them would be a claim, not a decoration), and the `?` opens a legend for
 *  the icon column the room list has no icons for. */
export const NOT_OURS = new Set(['pb_logga', 'gamespy_logo', 'icon_legend_a']);

/** The variable that gates the SERVER INFO drawer — the rules and player
 *  tables the engine fills from a server's own reply. The lobby does not
 *  carry either, so the drawer and the handle that opens it are out. */
export const DRAWER = 'Join/ShowServerInfo';

/** The two panels down the right-hand side — CUSTOM FILTER and CONNECTION
 *  SPEED — start here. Both are for a list of thousands: one filters it and
 *  the other tells GameSpy what bandwidth to advertise. This list is the
 *  rooms one server is running, a handful at most, and neither panel has
 *  anything to do. */
export const SIDE_PANEL_X = 595;

/** The filter strip: the row of per-column filter boxes between the column
 *  heads and the first row (`menu_multipl_filterbg*`, the FILTER label and
 *  the five 0.8-alpha quads, each with a `BfEditNode` in it). The art is
 *  painted from the page; the five edit fields are the screen's own
 *  (`multiplay.js`, they draw what is typed and take the keyboard), and the
 *  FILTER label's pointer region, which only lights the label, is left
 *  out. */
export const FILTER_STRIP = [176, 200];
export const STRIP_INERT = new Set(['edit', 'hit']);

// --- the filters, as BF1942.exe applies them ---------------------------------
//
// The row builder asks `FUN_0069e4a0` whether a server passes before it adds
// the row (ledger MEME-24). SERVER, GAME TYPE and MAP are text filters, PING
// and PLAYERS number filters.

/** The five edit fields by the variable each is bound to: what it reads off
 *  a row, and for a number filter the comparison a bare number means
 *  (0x0069ce63: PING at most, 0x0069cea4: PLAYERS at least). */
export const FILTERS = {
  'Filter/ServerFilter': { kind: 'text', value: r => r.name },
  'Filter/PlayersFilter': { kind: 'number', bare: 3, value: r => r.players },
  'Filter/PingFilter': { kind: 'number', bare: 4, value: r => r.ping ?? 0 },
  'Filter/GameFilter': { kind: 'text', value: r => r.gameType },
  'Filter/MapFilter': { kind: 'text', value: r => r.map },
};

const isDigit = c => c >= '0' && c <= '9';

/** C's `atoi`: leading blanks, a sign, then digits up to the first that is
 *  not one. */
export function atoi(text) {
  const m = /^\s*([+-]?\d+)/.exec(String(text ?? ''));
  return m ? parseInt(m[1], 10) : 0;
}

/** A number filter's text as `{ op, n }`, or null when the game would refuse
 *  it (ERROR_INVALID_FILTER). `FUN_0069bfc0`: `<` 1, `>` 2, `>=` 3, `<=` 4,
 *  `=` 5, a bare number the field's own `bare`; one space may sit between
 *  the operator and the number, and a number that reads as 0 has to be
 *  written `0`. */
export function parseNumberFilter(text, bare) {
  const t = String(text);
  let op = 0;
  let skip = 0;
  let plain = false;
  if (t.length < 2) {
    if (t.length === 1 && isDigit(t[0])) { plain = true; op = bare; }
  } else {
    const c0 = t[0];
    if (c0 === '>') { skip = 1; op = 2; }
    else if (c0 === '<') { skip = 1; op = 1; }
    else if (c0 === '=') { skip = 1; op = 5; }
    else if (isDigit(c0)) { plain = true; op = bare; }
    if (t.length > 2) {
      let c1 = t[1];
      if (c1 === ' ') {
        if (t.length < 4) return null;
        c1 = t[2];
        skip += 1;
      }
      if (c1 === '=') {
        if (op === 2) { skip += 1; op = 3; }
        else if (op === 1) { skip += 1; op = 4; }
        else op = 0;
      }
    }
  }
  if (t.length <= skip) return null;
  const rest = t.slice(skip);
  const n = atoi(rest);
  if (n === 0 && !(rest === '0' && t.length <= 2)) return null;
  // Text that starts with a digit keeps the bare comparison whatever came
  // after it; anything else that settled on no operator is refused.
  const result = plain ? bare : op;
  return result ? { op: result, n } : null;
}

/** Whether a row's number passes (`FUN_0069cf00`, the row's value read
 *  with `atoi`). */
export function numberPasses({ op, n }, value) {
  const v = atoi(value);
  switch (op) {
    case 1: return v < n;
    case 2: return v > n;
    case 3: return v >= n;
    case 4: return v <= n;
    case 5: return v === n;
    default: return true;
  }
}

const lower = c => (c >= 'A' && c <= 'Z' ? c.toLowerCase() : c);

/** `FUN_0069e0a0`: the whole of `value` against `pattern`, `*` any run and
 *  `?` any one character, ASCII letters compared without case. */
export function globMatch(value, pattern, i = 0, j = 0) {
  for (;;) {
    if (j === pattern.length) return i === value.length;
    if (pattern[j] === '*') {
      while (pattern[j] === '*') j += 1;
      if (j === pattern.length) return true;
      for (let k = i; k <= value.length; k++) {
        if (globMatch(value, pattern, k, j)) return true;
      }
      return false;
    }
    if (i === value.length) return false;
    if (pattern[j] !== '?' && lower(value[i]) !== lower(pattern[j])) return false;
    i += 1;
    j += 1;
  }
}

/** A text filter: what is typed, with a `*` after it (0x0069e443), so the
 *  field matches a value that starts with it. */
export const textPasses = (text, value) => globMatch(String(value ?? ''), `${text}*`);

/** Whether a row passes every filter that has text in it. A number filter
 *  the game would refuse is left out, as it would not be applied. */
export function passesFilters(row, filters) {
  for (const [name, text] of Object.entries(filters)) {
    const filter = FILTERS[name];
    if (!filter || !text) continue;
    if (filter.kind === 'text') {
      if (!textPasses(text, filter.value(row))) return false;
    } else {
      const parsed = parseNumberFilter(text, filter.bare);
      if (parsed && !numberPasses(parsed, filter.value(row))) return false;
    }
  }
  return true;
}

/** Whether a filter's text is one the game would refuse. */
export const filterInvalid = (name, text) => FILTERS[name]?.kind === 'number' && !!text
  && !parseNumberFilter(text, FILTERS[name].bare);

/** The scroll thumb sits inside the track: as wide as the list box's
 *  scrollbar, two in from the track's left and one in from its ends (the
 *  retail capture, 2026-10-21: track x 578.75-588.75, thumb 580.4-586.6). */
export const THUMB_INSET = [2, 1];

/** Below the "n/m  k PLAYERS ONLINE" line there is nothing left but the two
 *  badges and PunkBuster's tick box. */
export const FOOTER_Y = 500;

/** The right-hand half of `menu/CreateGameMenu` — the GAME TYPE list and
 *  the SELECTED LEVELS rotation, with the arrows that move a level between
 *  the two — starts at the same x as the browser's own side panels. A room
 *  runs one level under that level's own default game type, so the whole
 *  column goes and CREATE GAME is: pick a map, START. */
export const CREATE_ARROWS = new Set(['menu_rubr_pilh_16x32', 'menu_rubr_pilv_16x32',
                                      'menu_pilupp_32x16', 'menu_pilner_32x16']);

/** The column heads, by the locale key of the label and the sort the head's
 *  own pointer region calls. `asc` is the flag the file reads for the head's
 *  arrow direction, taken off the shipped conditions rather than numbered
 *  here. `value` is what a row shows in the column and `key` what it sorts
 *  by. */
export const COLUMNS = [
  { key: 'MULTIPLAYER_SERVER', call: 'Headings/SortServerAsc',
    asc: 'Headings/Flags/ServerAsc', value: r => r.name, sort: r => r.name.toLowerCase() },
  { key: 'MULTIPLAYER_PLAYERS', call: 'Headings/SortPlayersAsc',
    asc: 'Headings/Flags/PlayersAsc', value: r => playersText(r), sort: r => r.players },
  { key: 'MULTIPLAYER_PING', call: 'Headings/SortPingAsc',
    asc: 'Headings/Flags/PingAsc', value: r => r.ping ?? '', sort: r => r.ping ?? Infinity },
  { key: 'MULTIPLAYER_GAME_TYPE', call: 'Headings/SortGameAsc',
    asc: 'Headings/Flags/GameAsc', value: r => r.gameType || '', sort: r => r.gameType || '' },
  { key: 'MULTIPLAYER_MAPNAME', call: 'Headings/SortMapAsc',
    asc: 'Headings/Flags/MapAsc', value: r => r.map || '', sort: r => (r.map || '').toLowerCase() },
];

// --- the server rows, as BF1942.exe draws them ------------------------------
//
// None of this is in a file: the engine builds each row of
// `Join/Internet/InternetServerList` in code. Read out of BF1942.exe
// (md5 ed9f9f57); `features/multiplay-front-end/README.md`, "The server
// rows", has the addresses and the reading.

/** Where each column starts, from the list box's left edge plus
 *  `ROW_INSET`. The list's constructor makes column 0 at 0, and the lobby's
 *  setup adds the rest with `addColumn(x)` (0x0069f429..0x0069f499). 0-5
 *  are the icon columns (6 is the name); 11 and 12 carry the address and
 *  port, past the right edge of what is drawn. */
export const COLUMN_X = [0, 16, 20, 32, 45, 57, 69, 223, 283, 323, 419, 540];

/** The text cells, by column: name, players, ping, game type, map
 *  (`FUN_00402150`, the `addTextCell(n)` calls at 0x004028b5..0x0040298d).
 *  The name is drawn as `"> " + hostname` (0x008c3978). */
export const TEXT_COLUMNS = [6, 7, 8, 9, 10];
export const NAME_PREFIX = '> ';

/** Every cell is drawn this far in from the list box's left edge
 *  (`FUN_007d1390`, 10.0 at 0x008dbe18). */
export const ROW_INSET = 10;

/** A text cell stops drawing once its pen has passed the next column, less
 *  ten twice over: `FUN_007d0fa0` returns the span less 10 and the glyph
 *  loop breaks once the advance passes that less 10 again. The glyph that
 *  crosses the line is drawn. */
export const CLIP_MARGIN = 20;

/** The icon cells: `[column, x, y]`, a 16x16 quad drawn at the list's
 *  left + `ROW_INSET` + x (not from the column's own start) with its top
 *  `y` above the row's baseline (`addTextureCell` at 0x00402783..0x00402884).
 *  Column 4 is the ranking icon, which the row builder works out and never
 *  adds. */
export const ICON_CELLS = {
  mod: [0, -8, 12],
  password: [1, 4, 11],
  dedicated: [2, 15, 11],
  pure: [3, 29, 11],
  punkbuster: [5, 42, 11],
};
export const ICON_SIZE = 16;

/** The rows' text colour: the lobby's default (0x0040145c), khaki. The
 *  engine greys (0.5) a server running another version or a mod the
 *  client has not got, and draws a favourite in pale yellow (1, 1, 0.8);
 *  neither is said here — this list joins through the bf1942:// link, so
 *  what this browser has installed is beside the point, and it keeps no
 *  favourites. */
export const ROW_COLOR = [0.6796, 0.7109, 0.5195];

/** The first row's baseline is two rows below the box's top - one row is
 *  under the filter strip - and rows are drawn while the baseline is a row
 *  clear of the box's bottom (`FUN_007d1390`). The highlight is the row's
 *  height, from 2 px under the previous baseline, from the box's left + 2
 *  to its right less the scroll column. */
export function rowGeometry(box) {
  const [bx, by, bw, bh] = box.rect;
  const row = box.rowHeight;
  const first = by + 2 * row;
  const count = Math.max(1, Math.floor((bh - 3 * row) / row) + 1);
  // 2 * (scrollbar width + 1) + scrollbar offset + 4 (0x008d8f34): the
  // two fields' roles are inferred from where they sit, not traced.
  const width = bw - (2 * ((box.scrollbarWidth ?? 6) + 1) + (box.scrollbarOffset ?? 4) + 4);
  return {
    count,
    baseline: i => first + i * row,
    select: i => [bx + 2, first + i * row - row + 2, width, row],
  };
}

/** The PLAYERS cell: `numplayers/maxplayers`, with the reserved slots in
 *  brackets when the server has any (`FUN_004012f0`). */
export function playersText(r) {
  const base = `${r.players}/${r.max}`;
  return r.reserved > 0 ? `${base}(${r.reserved})` : base;
}

/** The icon a dedicated-server cell draws: the Windows box or the penguin
 *  (`dedicated` 1 or 2), in the server's status colour (1 red, 2 yellow,
 *  3 or 4 green, anything else the plain icon), and a listen server's
 *  player icon otherwise. */
export function dedicatedIcon(dedicated, status) {
  const kind = dedicated === 2 ? 'linux' : dedicated === 1 ? 'dedicated' : null;
  if (!kind) return 'menu_icon_player_16x16';
  const tint = { 1: '_red', 2: '_yellow', 3: '_green', 4: '_green' }[status] ?? '';
  return `menu_icon_${kind}${tint}_16x16`;
}

/** The mod badge: the installed mod's own `serverInfo` (the pack's
 *  `modBadges`), nothing for vanilla or an installed mod without one, and
 *  `unknown_game` for a mod the client has not got (`FUN_00452d70`). */
export function modIcon(gameId, badges = {}) {
  const id = String(gameId || '').toLowerCase();
  if (!id || id === '(none)' || id === 'bf1942') return null;
  if (id in badges) return badges[id];
  return 'unknown_game';
}

export const SORT_ARROW = 'Headings/Flags/ShowSortArrow';

export const mentions = (when, name) => (when || []).some(function walk(c) {
  return c.op === 'and' || c.op === 'or' ? c.terms.some(walk) : c.var === name;
});

export const overlaps = (a, b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2]
  && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];

/** The rows of a `menu/CreateGameMenu` list, inside the well its plate
 *  art has for them (`rows`, measured by `extract_main_menu_layout.py`).
 *  Drawn from the box's own top instead, the first row lands over the
 *  plate's heading band — the same thing `listRows` fixes for the level
 *  list on the Instant Battle screen. */
export function listRowArea(box) {
  const well = box.rows;
  if (!well) return [...box.rect];
  return [box.rect[0], well.top, box.rect[2], well.bottom - well.top];
}

export const listCapacity = box =>
  Math.max(1, Math.floor(listRowArea(box)[3] / box.rowHeight));
