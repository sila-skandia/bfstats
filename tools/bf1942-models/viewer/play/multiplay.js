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
//
// The pieces: `lobby.js` polls the room server and owns the rows,
// `create-game.js` is the CREATE GAME dialog, `multiplay-layout.js` says what
// of the shipped pages is drawn; this is the room list and the screen.

import {
  drawBitmapText, elementVisible, inRect, measureText, paintElement, rgb,
  stageScale, toVirtual,
} from './menu-screen.js';
import { createMenuPack } from './menu-pack.js';
import { createNavStrip } from './nav-strip.js';
import { createLobby } from './lobby.js';
import { createGameDialog } from './create-game.js';
import {
  ALERT, COLUMNS, DRAWER, FILTER_STRIP, FOOTER_Y, MASTER_DOWN, NOT_OURS,
  SIDE_PANEL_X, SORT_ARROW, mentions, overlaps,
} from './multiplay-layout.js';
import { loadMods, servable, stored, VANILLA } from '../mods.js';
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

  // --- the lobby and the dialog ----------------------------------------------

  const lobby = createLobby({
    decorate: row => decorate(row),
    onPolled: () => {
      onStatus('');
      state.index = Math.min(state.index, Math.max(0, lobby.rooms.length - 1));
      // A room server that goes away under an open CREATE GAME takes the
      // dialog with it, rather than leaving a START that cannot work.
      if (state.create && !online()) dialog.close();
      paintSoon();
    },
  });

  /** Whether the room server answered the last time this asked
   *  (`lobby.js`). */
  const online = () => lobby.online();

  const dialog = createGameDialog({
    ctx, pack, state, root, onStart,
    get layout() { return layout; },
    get levels() { return levels; },
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
    const rooms = lobby.rooms;
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

  // --- the room rows ---------------------------------------------------------

  /** A lobby row with the level's own menu title on it, which is what the
   *  MAP column shows — the room server names a level by its directory. */
  function decorate(row) {
    const level = levels.find(l => l.map?.toLowerCase() === String(row.level).toLowerCase()
                                || l.dir?.toLowerCase() === String(row.level).toLowerCase());
    return { ...row, title: level?.title || row.level };
  }

  function sorted() {
    const rooms = lobby.rooms;
    if (!state.sort) return rooms;
    const column = COLUMNS[state.sort - 1];
    const out = [...rooms].sort((a, b) =>
      String(column.value(a)).localeCompare(String(column.value(b)), undefined,
                                            { numeric: true }));
    return state.asc ? out : out.reverse();
  }

  function start() { lobby.start(); }
  function stop() {
    lobby.stop();
    dialog.stopCaret();
  }

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
    // An empty list says why, where the rows would be. One line either
    // way: with CREATE GAME and JOIN both gone while the master server is
    // down, the screen has already said everything the extra sentences
    // were saying.
    if (!list.length && font) {
      const lastError = lobby.lastError;
      ctx.globalAlpha = 1;
      drawBitmapText(ctx, font, pack.env.tint,
                     lastError ? MASTER_DOWN : 'NO ROOMS RUNNING',
                     Math.round(bx + 4), by + 1,
                     lastError ? ALERT : [0.55, 0.55, 0.55]);
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
      dialog.paint(table);
    } else {
      paintPage('internet', table, el => notOurs(el)
        || (el.var?.startsWith('ServerInfo/') && !table[el.var]));
      paintRows(table);
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
    const r = canvas.getBoundingClientRect();
    const s = stageScale(r.width, r.height, layout.virtual);
    return toVirtual(s, event.clientX - r.left, event.clientY - r.top);
  }

  const joinButton = () => page('internetNav').find(
    el => el.kind === 'button' && el.calls?.includes('Join/Internet/JoinInternetGame'));

  /** What the pointer is over. The dialog is modal: while it is up nothing
   *  behind it is live, which is what the engine's own page layers do. */
  function hitTest(x, y) {
    if (state.create) return dialog.hitTest(x, y);
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
    get rooms() { return sorted(); },
    get levels() { return levels; },
    get strip() { return strip; },
  };
}
