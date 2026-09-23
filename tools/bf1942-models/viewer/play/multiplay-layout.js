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
 *  own pointer region calls. `arrow` is the `Headings/Flags/ShowSortArrow`
 *  value that lights that head's arrow, and `asc` the flag the file reads
 *  for its direction — both taken off the shipped conditions rather than
 *  numbered here. `row` is what a lobby row shows in the column. */
export const COLUMNS = [
  { key: 'MULTIPLAYER_SERVER', call: 'Headings/SortServerAsc',
    asc: 'Headings/Flags/ServerAsc', value: r => r.code },
  { key: 'MULTIPLAYER_PLAYERS', call: 'Headings/SortPlayersAsc',
    asc: 'Headings/Flags/PlayersAsc', value: r => `${r.players}/${r.max}` },
  // The room server is this origin: there is no ping to show that the page
  // is not already paying. The head stays — it is the file's — and the
  // column reads as the game's does for a server that has not answered.
  { key: 'MULTIPLAYER_PING', call: 'Headings/SortPingAsc',
    asc: 'Headings/Flags/PingAsc', value: () => '-' },
  { key: 'MULTIPLAYER_GAME_TYPE', call: 'Headings/SortGameAsc',
    asc: 'Headings/Flags/GameAsc', value: r => r.mode || '' },
  { key: 'MULTIPLAYER_MAPNAME', call: 'Headings/SortMapAsc',
    asc: 'Headings/Flags/MapAsc', value: r => r.title || r.level || '' },
];

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
