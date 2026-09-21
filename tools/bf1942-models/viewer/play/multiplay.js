// MULTIPLAY, as the game draws it.
//
// `menu/InternetMenu` is the server browser: the plate, the sortable SERVER
// / PLAYERS / PING / GAME TYPE / MAP heads, the filter row, the list box and
// the "n/m  k PLAYERS ONLINE" footer. `extract_main_menu_layout.py`
// flattens it into `main-menu-layout.json` and this paints it leaf by leaf
// the way `skirmish.js` paints Instant Battle — the rectangles, the plates,
// the faces and the strings are the shipped files, and the page's own CSS is
// the black field the canvas sits in.
//
// What fills it is the room server's lobby (`GET /netcode/rooms`, the same
// origin and path prefix as the WebSocket), one row per running room. The
// engine's list is `Join/Internet/InternetServerList`, which the engine
// fills at runtime from GameSpy; this one is filled from the rooms, which is
// the same relationship the Instant Battle list has to the level archives.
//
// Three things in the shipped page are not drawn. The PunkBuster badge and
// the GameSpy logo name services that are not running here, and drawing them
// would be a claim, not a decoration. The rest of the page is the file's.
//
// JOIN and a row's double click both go to `../map.html?room=<code>&name=`,
// which is the same map page the mesh site serves; CREATE GAME swaps in
// `menu/CreateGameMenu` and starts a room on the level picked there.

import {
  drawBitmapText, elementVisible, inRect, measureText, paintElement,
  stageScale, toVirtual,
} from './menu-screen.js';
import { createMenuPack } from './menu-pack.js';
import { createNavStrip } from './nav-strip.js';
import { loadMods, servable, stored, VANILLA } from '../mods.js';
import { loadHudPaths, hudPaths as plainHudPaths } from '../hud-pack.js';

/** The room server's JSON lobby, and how often the browser re-reads it.
 *  The game's own list is a REFRESH button; this one is the room server on
 *  the same origin, so it can just keep looking. */
const ROOMS_URL = '/netcode/rooms';
const POLL_MS = 3000;

/** A room code the server will take: `ROOM_CODE_RE` in `server/rooms.mjs`. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from({ length: 6 },
  () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');

/** Plates for something this front end has not got: the PunkBuster badge
 *  and the GameSpy logo name services that are not running here (drawing
 *  them would be a claim, not a decoration), and the `?` opens a legend for
 *  the icon column the room list has no icons for. */
const NOT_OURS = new Set(['pb_logga', 'gamespy_logo', 'icon_legend_a']);

/** The variable that gates the SERVER INFO drawer — the rules and player
 *  tables the engine fills from a server's own reply. The lobby does not
 *  carry either, so the drawer and the handle that opens it are out. */
const DRAWER = 'Join/ShowServerInfo';

/** The two panels down the right-hand side — CUSTOM FILTER and CONNECTION
 *  SPEED — start here. Both are for a list of thousands: one filters it and
 *  the other tells GameSpy what bandwidth to advertise. This list is the
 *  rooms one server is running, a handful at most, and neither panel has
 *  anything to do. */
const SIDE_PANEL_X = 595;

/** The filter strip: the row of per-column filter boxes between the column
 *  heads and the first row (`menu_multipl_filterbg*` and the five 0.8-alpha
 *  quads over them). Out for the same reason, and its going is what lets
 *  the rows start at the top of the list box the way the file puts it. */
const FILTER_STRIP = [176, 200];

/** Below the "n/m  k PLAYERS ONLINE" line there is nothing left but the two
 *  badges and PunkBuster's tick box. */
const FOOTER_Y = 500;

/** The right-hand half of `menu/CreateGameMenu` — the GAME TYPE list and
 *  the SELECTED LEVELS rotation, with the arrows that move a level between
 *  the two — starts at the same x as the browser's own side panels. A room
 *  runs one level under that level's own default game type, so the whole
 *  column goes and CREATE GAME is: pick a map, START. */
const CREATE_ARROWS = new Set(['menu_rubr_pilh_16x32', 'menu_rubr_pilv_16x32',
                               'menu_pilupp_32x16', 'menu_pilner_32x16']);

/** The two rows of `menu/CreateGameMenuPage1` a room has an answer for, by
 *  the locale key of the label. The page's other fourteen — password,
 *  round time limit, number of rounds, spawn time, start delay, tickets,
 *  score limit, friendly fire and the AI settings on page two — are the
 *  dedicated server's, and the room server takes none of them.
 *
 *  `value(state)` is what goes in the box beside the label. A room's name
 *  is its code: that is what the browser lists and what another player
 *  needs. */
const ROOM_SETTINGS = [
  { key: 'CREATE_GAME_SERVERNAME', value: create => create.code },
  { key: 'CREATE_GAME_MAX_PLAYERS', value: () => String(MAX_PLAYERS) },
];

/** `MAX_PLAYERS` in `server/rooms.mjs` — a room's capacity, which is not
 *  negotiable the way a dedicated server's is. */
const MAX_PLAYERS = 16;

/** The column heads, by the locale key of the label and the sort the head's
 *  own pointer region calls. `arrow` is the `Headings/Flags/ShowSortArrow`
 *  value that lights that head's arrow, and `asc` the flag the file reads
 *  for its direction — both taken off the shipped conditions rather than
 *  numbered here. `row` is what a lobby row shows in the column. */
const COLUMNS = [
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

const SORT_ARROW = 'Headings/Flags/ShowSortArrow';

/**
 * @param {object} options
 * @param {HTMLCanvasElement} options.canvas
 * @param {string} [options.root]   the viewer root from the mounting page
 * @param {URLSearchParams} [options.params]
 * @param {(url: string) => void} [options.onStart]  JOIN / START INTERNET
 * @param {(text: string) => void} [options.onStatus]
 * @param {Array} [options.tabs]    the nav strip's rows (see nav-strip.js)
 * @param {(id: string) => void} [options.onTab]
 */
export function createMultiplayScreen({
  canvas,
  root = '../',
  params = new URLSearchParams(location.search),
  onStart = url => { location.href = url; },
  onStatus = () => {},
  tabs = null,
  onTab = () => {},
} = {}) {
  const qs = params;
  const bust = () => (qs.has('nocache') ? `?t=${Date.now()}` : '');
  const SCRATCH_PACK = qs.get('pack');
  let hudPaths = plainHudPaths('bf1942', null, { root });
  const packUrl = rel => (SCRATCH_PACK ? `${SCRATCH_PACK}/${rel}` : hudPaths.menuUrl(rel));

  const ctx = canvas.getContext('2d');
  const pack = createMenuPack({ url: packUrl, bust, onImage: () => paintSoon() });

  let layout = null;
  let strip = null;
  let levels = [];          // the level records CREATE GAME picks from
  let rooms = [];
  let lastError = null;
  let timer = null;
  let hover = null;

  const state = {
    index: 0,          // the selected room row
    scroll: 0,
    sort: 0,           // the column the list is sorted by, 0 = none
    asc: true,
    create: null,      // the CREATE GAME dialog's own state, or null
    name: 'Player',
  };

  // The dialog's level thumbnail rides the same slot the file gives it.
  pack.env.thumbnail = () => thumbnailOf(state.create?.level);

  function thumbnailOf(level) {
    if (level?.thumbnail) return pack.ready(pack.image(packUrl(level.thumbnail)));
    if (level?.previewBg) return pack.ready(pack.image(`${MAPS}/${level.previewBg}`));
    return null;
  }

  let MAPS = `${root}maps`;

  // --- the variable table ----------------------------------------------------

  /** What the page's `CullNode` conditions read: the file's own values with
   *  the live ones written over them. The sort arrows, the PunkBuster tick
   *  and the server-info drawer are all gated on variables in here. */
  function vars() {
    const table = { ...(layout.variables || {}) };
    table[SORT_ARROW] = state.sort;
    for (const [i, column] of COLUMNS.entries()) {
      table[column.asc] = state.sort === i + 1 ? state.asc : true;
    }
    table['Join/NumServers'] = rooms.length;
    table['Join/TotServers'] = rooms.length;
    table['Join/NumPlayers'] = rooms.reduce((n, r) => n + (r.players || 0), 0);
    // The bar under the list is the engine's own readout of the highlighted
    // server — name, address, ping. A room's address is its code (that is
    // what a player types to get in) and its ping is this origin's, so the
    // three slots carry the code, the level and the occupancy.
    const row = sorted()[state.index];
    table['ServerInfo/ServerInfoName'] = row ? row.code : '';
    table['ServerInfo/ServerIpPort'] = row ? (row.title || row.level || '') : '';
    table['ServerInfo/ServerPing'] = row ? `${row.players}/${row.max}` : '';
    return table;
  }

  // --- geometry off the page -------------------------------------------------

  const page = name => layout.pages[name]?.elements || [];
  const byKey = (name, key) => page(name).find(el => el.key === key);

  const mentions = (when, name) => (when || []).some(function walk(c) {
    return c.op === 'and' || c.op === 'or' ? c.terms.some(walk) : c.var === name;
  });

  const overlaps = (a, b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2]
    && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];

  /** The leaves of `menu/InternetMenu` this front end does not draw: the
   *  two side panels, the filter strip, the SERVER INFO drawer and the
   *  badges above. A pointer region left over one of them goes too — what
   *  is not drawn must not be clickable — which is why this is a set built
   *  once rather than a predicate over one element. */
  let skip = null;
  function notOurs(el) {
    if (skip) return skip.has(el);
    skip = new Set();
    for (const leaf of page('internet')) {
      if (NOT_OURS.has(leaf.texture)
          || leaf.rect[0] >= SIDE_PANEL_X
          || (leaf.rect[1] >= FILTER_STRIP[0] && leaf.rect[1] < FILTER_STRIP[1])
          || leaf.rect[1] > FOOTER_Y
          || mentions(leaf.when, DRAWER)) {
        skip.add(leaf);
      }
    }
    const orphans = page('internet').filter(
      leaf => leaf.kind === 'hit' && !skip.has(leaf)
        && [...skip].some(gone => gone.kind !== 'hit' && overlaps(leaf.rect, gone.rect)));
    for (const orphan of orphans) skip.add(orphan);
    return skip.has(el);
  }

  const listBox = () => page('internet').find(
    el => el.kind === 'listbox' && el.data === 'Join/Internet/InternetServerList');

  /** The scroll track beside the list: the file's own tall, narrow quad
   *  between the two arrows, `Join/ScrollbarHeight - 23` high. Found the
   *  way `menu-screen.js` finds the level list's — by shape, inside the
   *  box — rather than by index. */
  function trackRect() {
    const box = listBox();
    if (!box) return null;
    const [bx, , bw] = box.rect;
    return page('internet').find(el => el.kind === 'fill' && el.rect[3] > 40
      && el.rect[2] < 20 && el.rect[0] > bx && el.rect[0] < bx + bw)?.rect ?? null;
  }

  /** Where the rows go. The box's own rect, less the scroll column: with
   *  the filter strip gone nothing covers its top, so the first row sits
   *  where the file puts the box. */
  const rowArea = () => {
    const box = listBox();
    const width = (trackRect()?.[0] ?? box.rect[0] + box.rect[2]) - box.rect[0] - 4;
    return [box.rect[0] + 2, box.rect[1], width, box.rect[3]];
  };

  const visibleRows = () => Math.max(1, Math.floor(rowArea()[3] / listBox().rowHeight));

  // --- the lobby -------------------------------------------------------------

  /** A lobby row with the level's own menu title on it, which is what the
   *  MAP column shows — the room server names a level by its directory. */
  function decorate(row) {
    const level = levels.find(l => l.map?.toLowerCase() === String(row.level).toLowerCase()
                                || l.dir?.toLowerCase() === String(row.level).toLowerCase());
    return { ...row, title: level?.title || row.level };
  }

  function sorted() {
    if (!state.sort) return rooms;
    const column = COLUMNS[state.sort - 1];
    const out = [...rooms].sort((a, b) =>
      String(column.value(a)).localeCompare(String(column.value(b)), undefined,
                                            { numeric: true }));
    return state.asc ? out : out.reverse();
  }

  async function poll() {
    try {
      const res = await fetch(ROOMS_URL);
      if (!res.ok) throw new Error(String(res.status));
      // `server.mjs` answers `{rooms: [...]}`; a bare array is accepted too
      // so a hand-rolled lobby behind the same path still lists.
      const body = await res.json();
      const list = Array.isArray(body) ? body : body?.rooms;
      rooms = Array.isArray(list) ? list.map(decorate) : [];
      lastError = null;
      onStatus('');
    } catch (error) {
      lastError = error;
      rooms = [];
      onStatus(`room server unreachable (${error.message})`);
    }
    state.index = Math.min(state.index, Math.max(0, rooms.length - 1));
    paintSoon();
  }

  function start() { if (timer === null) { poll(); timer = setInterval(poll, POLL_MS); } }
  function stop() { if (timer !== null) clearInterval(timer); timer = null; }

  // --- loading ---------------------------------------------------------------

  /** The levels CREATE GAME picks from: the same join `skirmish.js` makes —
   *  the game's own menu list narrowed to the levels this viewer has a scene
   *  for — because a room can only be started on a level the browser can
   *  draw. */
  function buildLevels(menuLevels, manifest) {
    const have = new Map(manifest.map(entry => [entry.name.toLowerCase(), entry]));
    const out = [];
    for (const level of menuLevels.levels || []) {
      const entry = have.get(level.dir) || have.get(level.level.toLowerCase());
      if (!entry) continue;
      out.push({ ...level, map: entry.name, title: level.title || entry.name });
    }
    out.sort((a, b) => a.title.localeCompare(b.title));
    return out;
  }

  async function load() {
    const available = servable(await loadMods(), 'maps');
    const wanted = (qs.get('mod') || stored() || VANILLA.id).toLowerCase();
    const activeMod = available.find(mod => mod.id === wanted) || available[0];
    MAPS = qs.get('maps') || `${root}${activeMod.paths.maps}`;
    hudPaths = await loadHudPaths(activeMod.id, { bust, root });

    layout = await pack.load(await pack.json(packUrl('main-menu-layout.json')));
    const [menuLevels, manifest] = await Promise.all([
      pack.json(packUrl('menu-levels.json')).catch(() => ({ levels: [] })),
      pack.json(`${MAPS}/maps.json`).catch(() => []),
    ]);
    levels = buildLevels(menuLevels, manifest);

    if (tabs) {
      strip = createNavStrip({ layout, env: pack.env, rows: tabs,
                               active: 'multiplay', onPick: onTab });
    }
    start();
    paint();
  }

  // --- CREATE GAME -----------------------------------------------------------

  function openCreate() {
    state.create = { index: 0, scroll: 0, level: levels[0] || null, code: newCode() };
    paintSoon();
  }

  function pickCreateLevel(index) {
    const create = state.create;
    if (!create || !levels.length) return;
    create.index = Math.min(levels.length - 1, Math.max(0, index));
    create.level = levels[create.index];
    const rows = listCapacity(createBox('Host/Create/LevelsList'));
    if (create.index < create.scroll) create.scroll = create.index;
    else if (create.index >= create.scroll + rows) create.scroll = create.index - rows + 1;
    paintSoon();
  }

  const createBox = data =>
    page('createGame').find(el => el.kind === 'listbox' && el.data === data);

  /** START INTERNET: the room is made by the first client to name a code
   *  the server has no room for, so this is a navigation like every other.
   *  No `mode=`: the room server reads the game type off the level
   *  (`Room.mode()` in `server/rooms.mjs`), which is the default this
   *  dialog leaves alone. */
  function createRoom() {
    const create = state.create;
    if (!create?.level) return;
    const args = new URLSearchParams({ room: create.code, name: state.name,
                                       map: create.level.map });
    onStart(`${root}map.html?${args}`);
  }

  /** JOIN. The room's level travels with the code: a bare `map.html?room=`
   *  names no level, and `map.html` sends anything that names no level
   *  straight back here (its `MENU_URL` redirect), so the join would never
   *  be attempted. The room server's word still wins — the HELLO carries
   *  the room's own level and the page switches to it — this only gets the
   *  page as far as asking. */
  function join(row) {
    if (!row) return;
    const args = new URLSearchParams({ room: row.code, name: state.name });
    if (row.level) args.set('map', row.level);
    onStart(`${root}map.html?${args}`);
  }

  // --- painting --------------------------------------------------------------

  let pending = false;
  function paintSoon() {
    if (pending || !layout) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; paint(); });
  }

  const rgb = c => `rgb(${c.slice(0, 3).map(v => Math.round(v * 255)).join(',')})`;

  function paintPage(name, table, skip = null) {
    for (const el of page(name)) {
      if (skip?.(el)) continue;
      if (!elementVisible(el, table)) continue;
      paintElement(ctx, el, layout, state, pack.env);
    }
  }

  /** The room rows. The one part of the screen no file holds: the engine
   *  fills its list box from the master server, this one from the lobby. */
  function paintRows(table) {
    const box = listBox();
    const font = pack.env.font(box.font);
    const [bx, by, width] = rowArea();
    const list = sorted();
    const heads = COLUMNS.map(c => byKey('internet', c.key));
    for (let i = 0; i < visibleRows(); i++) {
      const index = state.scroll + i;
      const row = list[index];
      if (!row) break;
      const y = by + i * box.rowHeight;
      if (index === state.index) {
        ctx.globalAlpha = box.select[3];
        ctx.fillStyle = rgb(box.select);
        ctx.fillRect(bx, y, width, box.rowHeight);
      } else if (hover?.kind === 'row' && hover.index === index) {
        ctx.globalAlpha = box.select[3] * 0.4;
        ctx.fillStyle = rgb(box.select);
        ctx.fillRect(bx, y, width, box.rowHeight);
      }
      if (!font) continue;
      ctx.globalAlpha = 1;
      ctx.imageSmoothingEnabled = false;
      // Each cell under the head it belongs to, clipped to the head's own
      // width so a long room name cannot run into the next column.
      for (const [c, column] of COLUMNS.entries()) {
        const head = heads[c];
        if (!head) continue;
        let text = String(column.value(row));
        while (text && measureText(font, text) > head.rect[2]) text = text.slice(0, -1);
        drawBitmapText(ctx, font, pack.env.tint, text,
                       Math.round(head.rect[0]), y + 1, [0.78, 0.78, 0.78]);
      }
    }
    // The empty list says so where the rows would be, the way the room
    // server being down does.
    if (!list.length && font) {
      ctx.globalAlpha = 1;
      drawBitmapText(ctx, font, pack.env.tint,
                     lastError ? 'THE ROOM SERVER ISN\'T ANSWERING' : 'NO ROOMS RUNNING',
                     Math.round(bx + 4), by + 1, [0.55, 0.55, 0.55]);
    }
    paintThumb(box, list.length);
    ctx.globalAlpha = 1;
  }

  function paintThumb(box, count) {
    const track = trackRect();
    const rows = visibleRows();
    if (!track || count <= rows) return;
    const size = Math.max(0.08, rows / count);
    const offset = (state.scroll / (count - rows)) * (1 - size);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(track[0], track[1] + offset * track[3], track[2], size * track[3]);
  }

  /** CREATE GAME: `menu/CreateGameMenu` and its page-1 header, with START
   *  INTERNET from `menu/CreateGameNavigation`. A page, not an overlay —
   *  the engine's own `SetPathAction` swaps the browser out for it, and the
   *  plate is transparent enough that leaving the list underneath shows
   *  through it. START LOCAL is not drawn: there is one room server and it
   *  is this origin, so it would be the same button twice.
   *
   *  The arrow pairs beside the two level lists are not drawn either. They
   *  move a level in and out of the map rotation and reorder it; a room
   *  runs one level, so the rotation is the row LEVELS is sitting on. */
  function paintCreate(table) {
    const create = state.create;
    // The preview slot is a `VariablePictureNode` on
    // `Host/Create/LevelPicture`: the engine swaps the highlighted level's
    // own menu thumbnail into it, and the file's shipped value is whichever
    // level the page was saved on. Painted here rather than by
    // `paintElement`, which only knows the Instant Battle screen's slot.
    const slot = page('createGame').find(el => el.var === 'Host/Create/LevelPicture');
    paintPage('createGame', table, el => el === slot
      || CREATE_ARROWS.has(el.texture) || el.rect[0] >= SIDE_PANEL_X);
    const thumb = thumbnailOf(create.level);
    if (slot && thumb) {
      ctx.globalAlpha = 1;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(thumb, ...slot.rect);
    }
    // `menu/CreateGameMenuPage1` is drawn a row at a time by
    // `paintRoomSettings`, not as a page: it is placed by its layer rather
    // than by itself, and of its sixteen settings a room has two. Its own
    // "CREATE GAME 1/2" header goes with the rest — the plate already
    // carries a CREATE GAME heading, and there is no page two.
    paintRoomSettings(create, font0());
    paintPage('createGameNav', table, el => el.rect[0] < 600);

    const box = createBox('Host/Create/LevelsList');
    const font = pack.env.font(box.font);
    if (font) paintList(box, font, levels.map(l => l.title), create.index, create.scroll);
    ctx.globalAlpha = 1;
  }

  /** The page's own face, for the leaves this file draws itself. */
  const font0 = () => pack.env.font(createBox('Host/Create/LevelsList').font);

  /** The dialog's one list. */
  const levelsBox = () => createBox('Host/Create/LevelsList');

  /** The settings rows a room has: `menu/CreateGameMenuPage1`'s own label,
   *  its own recessed value box, and the value in it.
   *
   *  The page's coordinates are its own, not the screen's:
   *  `menu/CreateGameMenuPageLayer` places it and that layer is a
   *  `PathNode`, which the reader has no schema for (its transform is the
   *  one thing about this dialog that is inferred rather than read). The
   *  offset used is the CREATE GAME plate's own origin, which lands the
   *  page's labels at x 42 — exactly where the plate's own CREATE GAME
   *  heading sits. See the ledger's MEME row on `PathNode`. */
  function paintRoomSettings(create, font) {
    const plate = page('createGame').find(el => el.texture?.startsWith('menu_creategamexl'));
    if (!plate || !font) return;
    const [dx, dy] = plate.rect;
    const elements = page('createGamePage1');
    for (const setting of ROOM_SETTINGS) {
      const label = elements.find(el => el.key === setting.key);
      if (!label) continue;
      // The label's own row: the two nested quads beside it are the value
      // box, the outer its frame and the inner its well.
      const boxes = elements
        .filter(el => el.kind === 'fill' && Math.abs(el.rect[1] - label.rect[1]) < 8)
        .sort((a, b) => b.rect[2] - a.rect[2]);
      const shifted = el => ({ ...el, rect: [el.rect[0] + dx, el.rect[1] + dy,
                                             el.rect[2], el.rect[3]] });
      paintElement(ctx, shifted(label), layout, state, pack.env);
      for (const box of boxes) paintElement(ctx, shifted(box), layout, state, pack.env);
      const well = boxes[boxes.length - 1];
      if (!well) continue;
      ctx.globalAlpha = 1;
      ctx.imageSmoothingEnabled = false;
      drawBitmapText(ctx, font, pack.env.tint, setting.value(create),
                     Math.round(well.rect[0] + dx + 3), well.rect[1] + dy + 1,
                     [0.78, 0.78, 0.78]);
    }
    ctx.globalAlpha = 1;
  }

  /** The rows of a `menu/CreateGameMenu` list, inside the well its plate
   *  art has for them (`rows`, measured by `extract_main_menu_layout.py`).
   *  Drawn from the box's own top instead, the first row lands over the
   *  plate's heading band — the same thing `listRows` fixes for the level
   *  list on the Instant Battle screen. */
  function listRowArea(box) {
    const well = box.rows;
    if (!well) return [...box.rect];
    return [box.rect[0], well.top, box.rect[2], well.bottom - well.top];
  }

  const listCapacity = box =>
    Math.max(1, Math.floor(listRowArea(box)[3] / box.rowHeight));

  function paintList(box, font, rows, index, scroll) {
    const [ax, ay, aw] = listRowArea(box);
    for (let i = 0; i < listCapacity(box); i++) {
      const text = rows[scroll + i];
      if (text === undefined) break;
      const y = ay + i * box.rowHeight;
      if (scroll + i === index) {
        ctx.globalAlpha = box.select[3];
        ctx.fillStyle = rgb(box.select);
        ctx.fillRect(ax, y, aw, box.rowHeight);
      }
      ctx.globalAlpha = 1;
      ctx.imageSmoothingEnabled = false;
      drawBitmapText(ctx, font, pack.env.tint, String(text),
                     Math.round(ax + box.scrollbarOffset), y + 1, [0.78, 0.78, 0.78]);
    }
  }

  function paint() {
    if (!layout) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    const cw = Math.round(w * dpr);
    const chh = Math.round(h * dpr);
    if (canvas.width !== cw || canvas.height !== chh) {
      canvas.width = cw;
      canvas.height = chh;
    }
    const s = stageScale(w, h, layout.virtual);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, cw, chh);
    ctx.setTransform(s.sx * dpr, 0, 0, s.sy * dpr, s.ox * dpr, s.oy * dpr);

    const table = vars();
    pack.values = table;
    pack.env.hover = hover;
    paintPage('background', table);
    if (state.create) {
      paintCreate(table);
    } else {
      paintPage('internet', table, el => notOurs(el)
        || (el.var?.startsWith('ServerInfo/') && !table[el.var]));
      paintRows(table);
      // The JOIN button only — the rest of `menu/InternetNavigation` is
      // REFRESH, STOP and the four filter and favourite buttons, none of
      // which this site answers for (the lobby refreshes itself).
      paintPage('internetNav', table, el => el.rect[1] < FOOTER_Y);
    }
    strip?.paint(ctx);
    ctx.globalAlpha = 1;
  }

  const observer = new ResizeObserver(() => paint());
  observer.observe(canvas);

  // --- input -----------------------------------------------------------------

  function at(event) {
    const r = canvas.getBoundingClientRect();
    const s = stageScale(r.width, r.height, layout.virtual);
    return toVirtual(s, event.clientX - r.left, event.clientY - r.top);
  }

  const joinButton = () => page('internetNav').find(
    el => el.kind === 'button' && el.calls?.includes('Join/Internet/JoinInternetGame'));
  const startButton = () => page('createGameNav').find(
    el => el.kind === 'button' && el.calls?.includes('Host/Internet/HostInternetGame'));

  /** What the pointer is over. The dialog is modal: while it is up nothing
   *  behind it is live, which is what the engine's own page layers do. */
  function hitTest(x, y) {
    if (state.create) {
      const box = createBox('Host/Create/LevelsList');
      const area = listRowArea(box);
      if (inRect(area, x, y)) {
        const index = state.create.scroll + Math.floor((y - area[1]) / box.rowHeight);
        return index < levels.length ? { kind: 'create-level', index } : null;
      }
      for (const el of page('createGame')) {
        if (el.kind !== 'button' || !el.texture?.includes('scrollpil')) continue;
        if (el.rect[0] > box.rect[0] + box.rect[2] || !inRect(el.rect, x, y)) continue;
        return { kind: 'button', action: 'create-scroll',
                 by: el.texture.includes('upp') ? -1 : 1, rect: el.rect };
      }
      const go = startButton();
      if (go && inRect(go.rect, x, y)) {
        return { kind: 'button', action: 'create-go', rect: go.rect };
      }
      return { kind: 'modal' };
    }
    const navHit = strip?.hover(x, y);
    if (navHit) return navHit;
    const box = listBox();
    const area = rowArea();
    if (inRect(area, x, y)) {
      const index = state.scroll + Math.floor((y - area[1]) / box.rowHeight);
      return index < sorted().length ? { kind: 'row', index } : null;
    }
    const table = vars();
    for (const el of page('internet')) {
      if (notOurs(el) || !elementVisible(el, table) || !inRect(el.rect, x, y)) continue;
      const column = COLUMNS.findIndex(c => el.calls?.includes(c.call));
      if (el.kind === 'hit' && column >= 0) return { kind: 'sort', column: column + 1 };
      if (el.kind === 'button' && el.texture?.includes('scrollpil')) {
        return { kind: 'button', action: 'scroll',
                 by: el.texture.includes('upp') ? -1 : 1, rect: el.rect };
      }
    }
    const go = joinButton();
    if (go && inRect(go.rect, x, y)) return { kind: 'button', action: 'join', rect: go.rect };
    return null;
  }

  function scrollBy(by) {
    const max = Math.max(0, sorted().length - visibleRows());
    state.scroll = Math.min(max, Math.max(0, state.scroll + by));
    paintSoon();
  }

  canvas.addEventListener('pointermove', event => {
    if (!layout) return;
    const [x, y] = at(event);
    const next = hitTest(x, y);
    const changed = JSON.stringify(next) !== JSON.stringify(hover);
    hover = next;
    canvas.style.cursor = next && next.kind !== 'modal' ? 'pointer' : 'default';
    if (changed) paintSoon();
  });

  canvas.addEventListener('pointerleave', () => { hover = null; paintSoon(); });

  canvas.addEventListener('click', event => {
    if (!layout) return;
    const [x, y] = at(event);
    canvas.focus();
    const hit = hitTest(x, y);
    if (!hit) {
      // Outside everything, with the dialog up, is the way back out of it.
      if (state.create) { state.create = null; paintSoon(); }
      return;
    }
    if (hit.kind === 'create-level') pickCreateLevel(hit.index);
    else if (hit.action === 'create-scroll') {
      const max = Math.max(0, levels.length - listCapacity(levelsBox()));
      state.create.scroll = Math.min(max, Math.max(0, state.create.scroll + hit.by));
      paintSoon();
    } else if (hit.action === 'create-go') createRoom();
    else if (hit.kind === 'modal') { /* the dialog swallows it */ }
    else if (hit.action === 'nav') strip.click(x, y);
    else if (hit.kind === 'row') { state.index = hit.index; paintSoon(); }
    else if (hit.kind === 'sort') {
      state.asc = state.sort === hit.column ? !state.asc : true;
      state.sort = hit.column;
      paintSoon();
    } else if (hit.action === 'scroll') scrollBy(hit.by);
    else if (hit.action === 'join') join(sorted()[state.index]);
  });

  canvas.addEventListener('dblclick', event => {
    if (!layout || state.create) return;
    const [x, y] = at(event);
    // The list box's own "Select action" is `Join/Internet/JoinInternetGame`.
    const hit = hitTest(x, y);
    if (hit?.kind === 'row') join(sorted()[hit.index]);
  });

  canvas.addEventListener('wheel', event => {
    if (!layout) return;
    event.preventDefault();
    scrollBy(Math.sign(event.deltaY));
  }, { passive: false });

  function keydown(event) {
    if (!layout) return false;
    if (state.create) {
      if (event.key === 'Escape') { state.create = null; paintSoon(); return true; }
      if (event.key === 'ArrowDown') { pickCreateLevel(state.create.index + 1); return true; }
      if (event.key === 'ArrowUp') { pickCreateLevel(state.create.index - 1); return true; }
      if (event.key === 'Enter') { createRoom(); return true; }
      return false;
    }
    const count = sorted().length;
    if (event.key === 'ArrowDown') { select(state.index + 1); return true; }
    if (event.key === 'ArrowUp') { select(state.index - 1); return true; }
    if (event.key === 'Enter' && count) { join(sorted()[state.index]); return true; }
    return false;
  }

  function select(index) {
    const count = sorted().length;
    if (!count) return;
    state.index = Math.min(count - 1, Math.max(0, index));
    const rows = visibleRows();
    if (state.index < state.scroll) state.scroll = state.index;
    else if (state.index >= state.scroll + rows) state.scroll = state.index - rows + 1;
    paintSoon();
  }

  return {
    load,
    paint,
    paintSoon,
    keydown,
    start,
    stop,
    select,
    openCreate,
    createRoom,
    join: () => join(sorted()[state.index]),
    setName(name) { state.name = name || 'Player'; },
    get state() { return state; },
    get rooms() { return sorted(); },
    get levels() { return levels; },
    get strip() { return strip; },
  };
}
