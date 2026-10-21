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
// What fills it is the real game's internet servers, read from the stats
// site (`server-list.js`, the endpoint its landing page reads), drawn row by
// row the way BF1942.exe builds `Join/Internet/InternetServerList`: the
// icon cells, the "> " before the name, the columns and the khaki text
// (`multiplay-layout.js`, "the server rows"). The room server's own rooms
// (`GET /netcode/rooms`) follow them when it answers.
//
// Three things in the shipped page are not drawn. The PunkBuster badge and
// the GameSpy logo name services that are not running here, and drawing them
// would be a claim, not a decoration. Nor are the filters. The rest of the
// page is the file's.
//
// JOIN and a row's double click on a server open its bf1942:// link, the
// one the stats site's join buttons use, which starts the installed game; on
// a room they go to `../map.html?room=<code>&name=`. CREATE GAME swaps in
// `menu/CreateGameMenu` and starts a room on the level picked there.
//
// The pieces: `server-list.js` polls the stats API, `lobby.js` the room
// server, `create-game.js` is the CREATE GAME dialog, `multiplay-layout.js`
// says what of the shipped pages is drawn and how a row is; this is the
// list and the screen.

import {
  drawBitmapText, elementVisible, inRect, measureText, paintElement, rgb,
} from './menu-screen.js';
import { beginStage, pointerToVirtual } from './stage.js';
import { createMenuPack } from './menu-pack.js';
import { createNavStrip } from './nav-strip.js';
import { createLobby } from './lobby.js';
import { asciiUpper, createServerList } from './server-list.js';
import { createGameDialog } from './create-game.js';
import {
  ALERT, CLIP_MARGIN, COLUMN_X, COLUMNS, DRAWER, FILTER_STRIP, FOOTER_Y, STRIP_INERT, THUMB_INSET,
  ICON_CELLS, ICON_SIZE, MASTER_DOWN, NAME_PREFIX, NOT_OURS, ROW_COLOR, ROW_INSET,
  SIDE_PANEL_X, SORT_ARROW, TEXT_COLUMNS, dedicatedIcon, mentions, modIcon, overlaps,
  rowGeometry,
} from './multiplay-layout.js';
import { loadMods, menuLevels, servable, stored, treeOf, VANILLA } from '../mods.js';
import { loadHudPaths, hudPaths as plainHudPaths } from '../hud-pack.js';

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
  let hover = null;

  const state = {
    index: 0,          // the selected row
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

  // --- the lobby and the dialog ----------------------------------------------

  function polled() {
    onStatus('');
    const count = sorted().length;
    state.index = Math.min(state.index, Math.max(0, count - 1));
    state.scroll = Math.min(state.scroll, Math.max(0, count - visibleRows()));
    paintSoon();
  }

  const servers = createServerList({ onPolled: polled });

  const lobby = createLobby({
    decorate: row => decorate(row),
    onPolled: () => {
      // A room server that goes away under an open CREATE GAME takes the
      // dialog with it, rather than leaving a START that cannot work.
      if (state.create && !online()) dialog.close();
      polled();
    },
  });

  /** Whether the room server answered the last time this asked
   *  (`lobby.js`). */
  const online = () => lobby.online();

  const dialog = createGameDialog({
    ctx, pack, state, root, onStart,
    get layout() { return layout; },
    get levels() { return levels; },
    // A level's report (its `scene.json`), for the game types it offers.
    report: level => (level?.report ? pack.json(`${MAPS}/${level.report}`).catch(() => null)
      : Promise.resolve(null)),
    online,
    page: name => page(name),
    paintPage: (name, table, skip) => paintPage(name, table, skip),
    thumbnailOf,
    paint: () => paint(),
    paintSoon: () => paintSoon(),
  });

  // --- the variable table ----------------------------------------------------

  /** What the page's `CullNode` conditions read: the file's own values with
   *  the live ones written over them. The sort arrows, the PunkBuster tick
   *  and the server-info drawer are all gated on variables in here. */
  function vars() {
    const list = rows();
    const table = { ...(layout.variables || {}) };
    table[SORT_ARROW] = state.sort;
    for (const [i, column] of COLUMNS.entries()) {
      table[column.asc] = state.sort === i + 1 ? state.asc : true;
    }
    table['Join/NumServers'] = list.length;
    table['Join/TotServers'] = list.length;
    table['Join/NumPlayers'] = list.reduce((n, r) => n + (r.players || 0), 0);
    // The bar under the list is the engine's own readout of the highlighted
    // server: name, address, ping. A room's address is its code (what a
    // player types to get in). Neither has a ping this page can take, and
    // an empty slot is not drawn.
    const row = sorted()[state.index];
    table['ServerInfo/ServerInfoName'] = row ? row.name : '';
    table['ServerInfo/ServerIpPort'] = row ? row.address : '';
    table['ServerInfo/ServerPing'] = row?.ping != null ? String(row.ping) : '';
    return table;
  }

  // --- geometry off the page -------------------------------------------------

  const page = name => layout.pages[name]?.elements || [];
  const byKey = (name, key) => page(name).find(el => el.key === key);

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
          || (leaf.rect[1] >= FILTER_STRIP[0] && leaf.rect[1] < FILTER_STRIP[1]
              && STRIP_INERT.has(leaf.kind))
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

  /** Where the engine draws the rows (`rowGeometry`): the first a row
   *  below the box's top, where the filter strip would be. */
  const geometry = () => rowGeometry(listBox());
  const visibleRows = () => (layout ? geometry().count : 1);

  // --- the rows ----------------------------------------------------------------

  /** A lobby room as a row. The room server names a level by its
   *  directory; the MAP column shows the level's own menu title. */
  function decorate(room) {
    const level = levels.find(l => l.map?.toLowerCase() === String(room.level).toLowerCase()
                                || l.dir?.toLowerCase() === String(room.level).toLowerCase());
    return {
      kind: 'room', code: room.code, level: room.level,
      name: String(room.code), address: String(room.code),
      players: room.players || 0, max: room.max || 0, reserved: 0, ping: null,
      gameType: asciiUpper(room.mode), map: asciiUpper(level?.title || room.level),
    };
  }

  /** The internet servers, then this site's own rooms. */
  const rows = () => [...servers.servers, ...lobby.rooms];

  function sorted() {
    const list = rows();
    if (!state.sort) return list;
    const column = COLUMNS[state.sort - 1];
    const key = column.sort;
    const out = [...list].sort((a, b) => {
      const x = key(a), y = key(b);
      return typeof x === 'number' && typeof y === 'number'
        ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
    });
    return state.asc ? out : out.reverse();
  }

  function start() { servers.start(); lobby.start(); }
  function stop() {
    servers.stop();
    lobby.stop();
    dialog.stopCaret();
  }

  // --- loading ---------------------------------------------------------------

  /** The levels CREATE GAME picks from: the same join `skirmish.js` makes —
   *  the game's own menu list narrowed to the levels this viewer has a scene
   *  for — because a room can only be started on a level the browser can
   *  draw. */
  function buildLevels(menuList, manifest) {
    const have = new Map(manifest.map(entry => [entry.name.toLowerCase(), entry]));
    const out = [];
    for (const level of menuList.levels || []) {
      const entry = have.get(level.dir) || have.get(level.level.toLowerCase());
      if (!entry) continue;
      out.push({ ...level, map: entry.name, title: level.title || entry.name, report: entry.report ?? null });
    }
    out.sort((a, b) => a.title.localeCompare(b.title));
    return out;
  }

  async function load() {
    const available = servable(await loadMods(), 'maps');
    const wanted = (qs.get('mod') || stored() || VANILLA.id).toLowerCase();
    const activeMod = available.find(mod => mod.id === wanted) || available[0];
    MAPS = qs.get('maps') || `${root}${activeMod.paths.maps}`;
    hudPaths = await loadHudPaths(treeOf(activeMod), { bust, root });

    layout = await pack.load(await pack.json(packUrl('main-menu-layout.json')));
    const [menuList, manifest] = await Promise.all([
      pack.json(packUrl('menu-levels.json')).catch(() => ({ levels: [] })),
      pack.json(`${MAPS}/maps.json`).catch(() => []),
    ]);
    levels = menuLevels(activeMod, available, buildLevels(menuList, manifest));

    if (tabs) {
      strip = createNavStrip({ layout, env: pack.env, rows: tabs,
                               active: 'multiplay', onPick: onTab });
    }
    start();
    paint();
  }

  /** JOIN. A server opens its bf1942:// link, which hands the address to
   *  the installed game. A room's level travels with the code: a bare
   *  `map.html?room=`
   *  names no level, and `map.html` sends anything that names no level
   *  straight back here (its `MENU_URL` redirect), so the join would never
   *  be attempted. The room server's word still wins — the HELLO carries
   *  the room's own level and the page switches to it — this only gets the
   *  page as far as asking. */
  function join(row) {
    if (!row) return;
    if (row.kind === 'server') {
      if (row.joinLink) onStart(row.joinLink);
      return;
    }
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

  function paintPage(name, table, skip = null) {
    for (const el of page(name)) {
      if (skip?.(el)) continue;
      if (!elementVisible(el, table)) continue;
      paintElement(ctx, el, layout, state, pack.env);
    }
  }

  /** The rows. The one part of the screen no file holds: the engine
   *  builds each from a server's GameSpy reply, and this builds them the
   *  same way from the stats API's copy of it — the same cells, at the
   *  same places, in the same colour (`multiplay-layout.js`). The list has
   *  no hover state of its own, so none is drawn. */
  function paintRows() {
    const box = listBox();
    const font = pack.env.font(box.font);
    const geo = geometry();
    const left = box.rect[0] + ROW_INSET;
    const list = sorted();
    for (let i = 0; i < geo.count; i++) {
      const index = state.scroll + i;
      const row = list[index];
      if (!row) break;
      const baseline = geo.baseline(i);
      if (index === state.index) {
        const [sx, sy, sw, sh] = geo.select(i);
        ctx.globalAlpha = box.select[3];
        ctx.fillStyle = rgb(box.select);
        ctx.fillRect(sx, sy, sw, sh);
      }
      ctx.globalAlpha = 1;
      ctx.imageSmoothingEnabled = false;
      for (const [cell, name] of Object.entries(rowIcons(row))) {
        const image = name && pack.env.texture(name);
        if (!image) continue;
        const [, x, y] = ICON_CELLS[cell];
        ctx.drawImage(image, left + x, baseline - y, ICON_SIZE, ICON_SIZE);
      }
      if (!font) continue;
      for (const [c, column] of COLUMNS.entries()) {
        const at = TEXT_COLUMNS[c];
        let text = String(column.value(row));
        if (c === 0) text = NAME_PREFIX + text;
        text = clipped(font, text, COLUMN_X[at + 1] - COLUMN_X[at] - CLIP_MARGIN);
        drawBitmapText(ctx, font, pack.env.tint, text, left + COLUMN_X[at],
                       baseline - font.meta.baseline, ROW_COLOR);
      }
    }
    // An empty list with the stats API not answering says so, where the
    // rows would be.
    if (!list.length && font && servers.lastError) {
      ctx.globalAlpha = 1;
      drawBitmapText(ctx, font, pack.env.tint, MASTER_DOWN, left + COLUMN_X[TEXT_COLUMNS[0]],
                     geo.baseline(0) - font.meta.baseline, ALERT);
    }
    paintThumb(box, list.length);
    ctx.globalAlpha = 1;
  }

  /** A row's icon cells by name; a room has none. */
  function rowIcons(row) {
    if (row.kind !== 'server') return {};
    return {
      mod: modIcon(row.gameId, layout.modBadges),
      password: row.password ? 'menu_icon_password_16x16' : null,
      dedicated: dedicatedIcon(row.dedicated, row.status),
      pure: row.pure ? 'menu_icon_pure_16x16' : null,
      punkbuster: row.punkbuster ? 'menu_icon_punkb_16x16' : null,
    };
  }

  /** As much of `text` as the engine draws in `limit` px: glyphs until the
   *  pen has passed the limit, the one that crosses it included. */
  function clipped(font, text, limit) {
    let pen = 0;
    let out = '';
    for (const ch of text) {
      if (pen > limit) break;
      out += ch;
      pen += measureText(font, ch);
    }
    return out;
  }

  function paintThumb(box, count) {
    const track = trackRect();
    const rows = visibleRows();
    if (!track || count <= rows) return;
    const [ix, iy] = THUMB_INSET;
    const span = track[3] - 2 * iy;
    const size = Math.max(0.08, rows / count);
    const offset = (state.scroll / (count - rows)) * (1 - size);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(track[0] + ix, track[1] + iy + offset * span,
                 box.scrollbarWidth ?? 6, size * span);
  }

  function paint() {
    if (!layout) return;
    if (!beginStage(canvas, ctx, layout.virtual)) return;

    const table = vars();
    pack.values = table;
    pack.env.hover = hover;
    paintPage('background', table);
    if (state.create) {
      dialog.paint(table);
    } else {
      paintPage('internet', table, el => notOurs(el)
        || (el.var?.startsWith('ServerInfo/') && !table[el.var]));
      paintRows();
      // The JOIN button only — the rest of `menu/InternetNavigation` is
      // REFRESH, STOP and the four filter and favourite buttons, none of
      // which this site answers for (the lobby refreshes itself).
      // JOIN goes with the rows. With none — an empty lobby, or a room
      // server that is not answering — there is nothing for it to do.
      if (sorted().length) paintPage('internetNav', table, el => el.rect[1] < FOOTER_Y);
    }
    strip?.paint(ctx);
    ctx.globalAlpha = 1;
  }

  const observer = new ResizeObserver(() => paint());
  observer.observe(canvas);

  // --- input -----------------------------------------------------------------

  function at(event) {
    return pointerToVirtual(canvas, event, layout.virtual);
  }

  const joinButton = () => page('internetNav').find(
    el => el.kind === 'button' && el.calls?.includes('Join/Internet/JoinInternetGame'));

  /** What the pointer is over. The dialog is modal: while it is up nothing
   *  behind it is live, which is what the engine's own page layers do. */
  function hitTest(x, y) {
    if (state.create) return dialog.hitTest(x, y);
    const navHit = strip?.hover(x, y);
    if (navHit) return navHit;
    const geo = geometry();
    for (let i = 0; i < geo.count; i++) {
      if (!inRect(geo.select(i), x, y)) continue;
      const index = state.scroll + i;
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
    if (go && sorted().length && inRect(go.rect, x, y)) {
      return { kind: 'button', action: 'join', rect: go.rect };
    }
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
      if (state.create) dialog.close();
      return;
    }
    // While the dialog is up every hit is the dialog's (it is modal).
    if (state.create) { dialog.click(hit); return; }
    if (hit.action === 'nav') strip.click(x, y);
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
    if (state.create) return dialog.keydown(event);
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
    openCreate: () => dialog.open(),
    closeCreate: () => dialog.close(),
    createRoom: () => dialog.createRoom(),
    get online() { return online(); },
    get codeOk() { return dialog.codeOk(); },
    join: () => join(sorted()[state.index]),
    setName(name) { state.name = name || 'Player'; },
    get state() { return state; },
    get rows() { return sorted(); },
    get rooms() { return lobby.rooms; },
    get servers() { return servers; },
    get levels() { return levels; },
    get strip() { return strip; },
  };
}
