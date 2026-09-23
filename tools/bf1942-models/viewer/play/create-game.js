// CREATE GAME: `menu/CreateGameMenu` and its page-1 header, with START
// INTERNET from `menu/CreateGameNavigation`, over the MULTIPLAY screen.
//
// The dialog owns its own state — the level picked, the code typed into
// SERVER NAME, whether that field has the keyboard, and the caret's blink
// timer — as `state.create` on the screen's state object (null while the
// dialog is down), and it is modal: while it is up the screen routes every
// pointer and key here. START is a navigation like every other: the room is
// made by the first client to name a code the server has no room for. Split
// out of `multiplay.js`.

import { drawBitmapText, inRect, measureText, paintElement, rgb } from './menu-screen.js';
import { MAX_PLAYERS, ROOM_CODE_RE } from '../netcode.js';
import {
  ALERT, CREATE_ARROWS, SIDE_PANEL_X, listCapacity, listRowArea,
} from './multiplay-layout.js';

/** What the room server will take as a code: `ROOM_CODE_RE` in
 *  `netcode.js`, which `server/room-rules.mjs` reads too. The SERVER NAME
 *  field is typed against this rather than against
 *  `menu/CreateGameMenuPage1`'s own 32 characters — the file's limit is a
 *  dedicated server's name, and this one is an address. */
const CODE_CHAR_RE = /^[A-Za-z0-9_-]$/;
const CODE_MAX = 24;
const CODE_RULE = '3-24 LETTERS, NUMBERS, - OR _';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from({ length: 6 },
  () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');

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
  // The room's own `BfEditNode`, typed into. A room's name is its address:
  // it is what the browser lists and what another player needs, so the
  // field is the code.
  { key: 'CREATE_GAME_SERVERNAME', edit: 'Host/Create/ServerName',
    value: create => create.code },
  // `BfEditNodeInt` in the file, read-only here: a room's capacity is
  // `MAX_PLAYERS` (netcode.js, the room server's own) and is not negotiable
  // the way a dedicated server's is.
  { key: 'CREATE_GAME_MAX_PLAYERS', edit: 'Host/Create/MaxPlayers',
    value: () => String(MAX_PLAYERS) },
];

/** The one field of `menu/CreateGameMenuPage1` this screen types into. */
const EDITABLE = 'Host/Create/ServerName';

/**
 * @param {object} view  what the dialog reads of the screen it is over:
 *   `ctx`, `pack`, `state` (the screen's state; the dialog owns `create`),
 *   `root`, `onStart(url)`, and — live — `layout`, `levels`, `online()`,
 *   `page(name)`, `paintPage(name, table, skip)`, `thumbnailOf(level)`,
 *   `paint()`, `paintSoon()`
 */
export function createGameDialog(view) {
  const { ctx, pack, state } = view;
  let caret = null;   // the blink, while a field has the keyboard

  function openCreate() {
    if (!view.online()) return false;
    state.create = { index: 0, scroll: 0, level: view.levels[0] || null,
                     code: newCode(), editing: false };
    startCaret();
    view.paintSoon();
    return true;
  }

  function closeCreate() {
    state.create = null;
    stopCaret();
    view.paintSoon();
  }

  /** The caret blinks only while a field has the keyboard, so the screen is
   *  still a paint-on-demand one the rest of the time. */
  function startCaret() {
    if (caret !== null) return;
    caret = setInterval(() => { if (state.create?.editing) view.paint(); }, 500);
  }
  function stopCaret() {
    if (caret !== null) clearInterval(caret);
    caret = null;
  }

  const codeOk = () => ROOM_CODE_RE.test(state.create?.code ?? '');

  /** Typing into the SERVER NAME field. Returns whether the key was the
   *  field's — anything else falls back to the screen's own keys. */
  function typeInto(event) {
    const create = state.create;
    if (!create?.editing) return false;
    if (event.key === 'Backspace') {
      create.code = create.code.slice(0, -1);
    } else if (event.key === 'Enter' || event.key === 'Escape'
               || event.key === 'Tab') {
      create.editing = false;
    } else if (event.key.length === 1 && CODE_CHAR_RE.test(event.key)) {
      if (create.code.length >= CODE_MAX) return true;
      create.code += event.key;
    } else {
      return false;
    }
    view.paintSoon();
    return true;
  }

  function pickCreateLevel(index) {
    const create = state.create;
    const levels = view.levels;
    if (!create || !levels.length) return;
    create.index = Math.min(levels.length - 1, Math.max(0, index));
    create.level = levels[create.index];
    const rows = listCapacity(createBox('Host/Create/LevelsList'));
    if (create.index < create.scroll) create.scroll = create.index;
    else if (create.index >= create.scroll + rows) create.scroll = create.index - rows + 1;
    view.paintSoon();
  }

  const createBox = data =>
    view.page('createGame').find(el => el.kind === 'listbox' && el.data === data);

  /** START INTERNET: the room is made by the first client to name a code
   *  the server has no room for, so this is a navigation like every other.
   *  No `mode=`: the room server reads the game type off the level
   *  (`Room.mode()` in `server/room.mjs`), which is the default this
   *  dialog leaves alone. */
  function createRoom() {
    const create = state.create;
    if (!create?.level || !view.online() || !codeOk()) return;
    const args = new URLSearchParams({ room: create.code, name: state.name,
                                       map: levelKey(create.level) });
    view.onStart(`${view.root}map.html?${args}`);
  }

  /** How the room server names a level.
   *
   *  It builds its table by reading the `maps/` directory
   *  (`buildLevelTable` in `server/level-table.mjs`), so its keys are
   *  directory names — `el_alamein`. `maps.json` names the same level
   *  `El_Alamein`, and `map.html` lowercases before it looks, so the
   *  difference is invisible everywhere except here: a create that asks for
   *  `El_Alamein` finds nothing in the table and the join is refused
   *  `bad_room`. The menu record's `dir` is the directory. */
  const levelKey = level => level.dir || level.map;

  // --- painting --------------------------------------------------------------

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
    const slot = view.page('createGame').find(el => el.var === 'Host/Create/LevelPicture');
    view.paintPage('createGame', table, el => el === slot
      || CREATE_ARROWS.has(el.texture) || el.rect[0] >= SIDE_PANEL_X);
    const thumb = view.thumbnailOf(create.level);
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
    view.paintPage('createGameNav', table, el => el.rect[0] < 600);

    const box = createBox('Host/Create/LevelsList');
    const font = pack.env.font(box.font);
    if (font) paintList(box, font, view.levels.map(l => l.title), create.index, create.scroll);
    ctx.globalAlpha = 1;
  }

  /** The page's own face, for the leaves this file draws itself. */
  const font0 = () => pack.env.font(createBox('Host/Create/LevelsList').font);

  /** One settings row, already shifted into the CREATE GAME plate: the
   *  label, the two quads that draw the value box, and the file's own
   *  `BfEditNode` rect, which is where the text and the caret go and what
   *  a click on the field is tested against.
   *
   *  Shifted, because the page's coordinates are its own:
   *  `menu/CreateGameMenuPageLayer` places it and that layer is a
   *  `PathNode`, which the reader has no schema for — the offset used is
   *  the CREATE GAME plate's own origin, which lands the page's labels at
   *  x 42, exactly where the plate's own heading sits. Ledger MEME-17. */
  function settingRow(setting) {
    const plate = view.page('createGame').find(el => el.texture?.startsWith('menu_creategamexl'));
    if (!plate) return null;
    const [dx, dy] = plate.rect;
    const shift = el => ({ ...el, rect: [el.rect[0] + dx, el.rect[1] + dy,
                                         el.rect[2], el.rect[3]] });
    const elements = view.page('createGamePage1');
    const label = elements.find(el => el.key === setting.key);
    if (!label) return null;
    const near = el => Math.abs(el.rect[1] - label.rect[1]) < 8;
    const field = elements.find(el => el.kind === 'edit' && el.var === setting.edit
                                   && near(el));
    if (!field) return null;
    return {
      label: shift(label),
      field: shift(field),
      boxes: elements.filter(el => el.kind === 'fill' && near(el))
        .sort((a, b) => b.rect[2] - a.rect[2]).map(shift),
    };
  }

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
    if (!font) return;
    for (const setting of ROOM_SETTINGS) {
      const row = settingRow(setting);
      if (!row) continue;
      paintElement(ctx, row.label, view.layout, state, pack.env);
      for (const box of row.boxes) paintElement(ctx, box, view.layout, state, pack.env);
      const text = setting.value(create);
      const typed = setting.edit === EDITABLE;
      const bad = typed && !codeOk();
      ctx.globalAlpha = 1;
      ctx.imageSmoothingEnabled = false;
      const x = Math.round(row.field.rect[0] + 3);
      const y = row.field.rect[1] + 4;
      drawBitmapText(ctx, font, pack.env.tint, text, x, y,
                     bad ? ALERT : [0.78, 0.78, 0.78]);
      // The caret: a one-unit bar after the text, on the half second.
      if (typed && create.editing && Math.floor(Date.now() / 500) % 2 === 0) {
        ctx.fillStyle = '#c7c7b4';
        ctx.fillRect(x + measureText(font, text) + 1, y, 1, font.meta.lineHeight);
      }
    }
    // What the field will take, said only when what is in it will not do.
    const rule = settingRow(ROOM_SETTINGS[1]);
    if (rule && !codeOk()) {
      ctx.globalAlpha = 1;
      drawBitmapText(ctx, font, pack.env.tint, CODE_RULE,
                     Math.round(rule.label.rect[0]), rule.label.rect[1] + 26,
                     ALERT);
    }
    ctx.globalAlpha = 1;
  }

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

  // --- input -----------------------------------------------------------------

  const startButton = () => view.page('createGameNav').find(
    el => el.kind === 'button' && el.calls?.includes('Host/Internet/HostInternetGame'));

  /** What the pointer is over. The dialog is modal: while it is up nothing
   *  behind it is live, which is what the engine's own page layers do. */
  function hitTest(x, y) {
    const box = createBox('Host/Create/LevelsList');
    const area = listRowArea(box);
    if (inRect(area, x, y)) {
      const index = state.create.scroll + Math.floor((y - area[1]) / box.rowHeight);
      return index < view.levels.length ? { kind: 'create-level', index } : null;
    }
    for (const el of view.page('createGame')) {
      if (el.kind !== 'button' || !el.texture?.includes('scrollpil')) continue;
      if (el.rect[0] > box.rect[0] + box.rect[2] || !inRect(el.rect, x, y)) continue;
      return { kind: 'button', action: 'create-scroll',
               by: el.texture.includes('upp') ? -1 : 1, rect: el.rect };
    }
    const name = settingRow(ROOM_SETTINGS[0]);
    if (name && inRect(name.field.rect, x, y)) return { kind: 'create-name' };
    const go = startButton();
    if (go && inRect(go.rect, x, y)) {
      return { kind: 'button', action: 'create-go', rect: go.rect };
    }
    return { kind: 'modal' };
  }

  /** A click the dialog's `hitTest` answered. */
  function click(hit) {
    // A click anywhere in the dialog but the field takes the keyboard off
    // it, the way clicking away from a field does everywhere else.
    if (state.create && hit.kind !== 'create-name') state.create.editing = false;
    if (hit.kind === 'create-name') {
      state.create.editing = true;
      view.paintSoon();
    } else if (hit.kind === 'create-level') pickCreateLevel(hit.index);
    else if (hit.action === 'create-scroll') {
      const max = Math.max(0, view.levels.length - listCapacity(levelsBox()));
      state.create.scroll = Math.min(max, Math.max(0, state.create.scroll + hit.by));
      view.paintSoon();
    } else if (hit.action === 'create-go') createRoom();
    else if (hit.kind === 'modal') { view.paintSoon(); }
  }

  function keydown(event) {
    // The field has the keyboard while it is focused, so Escape leaves
    // the field before it leaves the dialog.
    if (typeInto(event)) return true;
    if (event.key === 'Escape') { closeCreate(); return true; }
    if (event.key === 'ArrowDown') { pickCreateLevel(state.create.index + 1); return true; }
    if (event.key === 'ArrowUp') { pickCreateLevel(state.create.index - 1); return true; }
    if (event.key === 'Enter') { createRoom(); return true; }
    return false;
  }

  return {
    open: openCreate,
    close: closeCreate,
    stopCaret,
    codeOk,
    createRoom,
    paint: paintCreate,
    hitTest,
    click,
    keydown,
  };
}
