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
 *  heads and the first row (`menu_multipl_filterbg*` and the five 0.8-alpha
 *  quads over them). Out for the same reason, and its going is what lets
 *  the rows start at the top of the list box the way the file puts it. */
export const FILTER_STRIP = [176, 200];

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
