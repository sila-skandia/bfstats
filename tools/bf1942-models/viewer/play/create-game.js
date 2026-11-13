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
import { gameTypes } from '../game-modes.js';
import { gamePlayModeOf } from '../round-state.js';
import { roomStore } from '../room-host-client.js';
import { ALERT, listCapacity, listRowArea } from './multiplay-layout.js';

/** What the room server will take as a code: `ROOM_CODE_RE` in
 *  `netcode.js`, which `server/room-rules.mjs` reads too. The SERVER NAME
 *  field is typed against this rather than against
 *  `menu/CreateGameMenuPage1`'s own 32 characters — the file's limit is a
 *  dedicated server's name, and this one is an address. */
const CODE_CHAR_RE = /^[A-Za-z0-9_-]$/;
const CODE_MAX = 24;
const CODE_RULE = '3-24 LETTERS, NUMBERS, - OR _';
/** Said beside SERVER NAME while the room server can take no new room. */
const SERVER_FULL = 'SERVER FULL: JOIN A RUNNING GAME';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from({ length: 6 },
  () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');

/** The settings pages, `menu/CreateGameMenuPage1` and `Page2`: every
 *  `BfEditNode` on them a room takes, by the variable the file binds it to.
 *  `field` is the room setting it writes (`server/room-settings.mjs`), and
 *  the ranges are the file's own `min` / `max`, except max players, which
 *  stops at the room server's `MAX_PLAYERS` (netcode.js) where the file's
 *  dedicated server goes to 64. The defaults are the engine's
 *  (`Setup::initServerSettings`, ledger NET-21), not the values the page
 *  was saved with.
 *
 *  The room's name is its code: what the browser lists and what another
 *  player needs, so SERVER NAME is typed against `ROOM_CODE_RE`.
 *
 *  Page two's AI SKILLS (`Host/Create/Coop/CoopAiSkill`, shown for a Co-op
 *  game as the file's `when` has it) is the room's bots' skill
 *  (`server/room-bots.mjs`; 75 is the engine's 0.75, AI-14, and the room
 *  holds it to 25 at the least). Not taken: CPU-TIME GIVEN TO AI, which no
 *  binary reads (AI-22) and which a room's own caps stand in for, and
 *  ObjectiveMode's ATTACKER TICKETS. The menu has no row for how many bots:
 *  retail's count is `aiSettings.setMaxNBots` in the game's data, and a
 *  room's is its `numberOfBots` setting, 64 (fill the room) by default. */
const FIELDS = {
  'Host/Create/ServerName': { code: true },
  'Host/Create/MaxPlayers': { field: 'maxPlayers', min: 2, max: MAX_PLAYERS, initial: MAX_PLAYERS },
  'Host/Create/Password': { field: 'password', text: true, maxChars: 30, initial: '' },
  'Host/Create/GameTime': { field: 'gameTime', min: 0, max: 999, initial: 0 },
  'Host/Create/NrOfRounds': { field: 'numberOfRounds', min: 0, max: 999, initial: 5 },
  'Host/Create/SpawnTime': { field: 'spawnTime', min: 0, max: 999, initial: 20 },
  'Host/Create/GameStartDelay': { field: 'gameStartDelay', min: 1, max: 999, initial: 20 },
  'Host/Create/Tickets': { field: 'ticketRatio', min: 10, max: 1000, initial: 100 },
  'Host/Create/ScoreLimit': { field: 'scoreLimit', min: 0, max: 999, initial: 0 },
  'Host/Create/FriendlyFire': { field: 'friendlyFire', min: 0, max: 100, initial: 100 },
  'Host/Create/AxisTeamRatio': { field: 'axisTeamRatio', min: 1, max: 10, initial: 1 },
  'Host/Create/AlliedTeamRatio': { field: 'alliedTeamRatio', min: 1, max: 10, initial: 1 },
  'Host/Create/Coop/CoopAiSkill': { field: 'coopAiSkill', min: 0, max: 100, initial: 75 },
};
const SERVER_NAME = 'Host/Create/ServerName';
const SETTINGS_PAGES = ['createGamePage1', 'createGamePage2'];

/** A fresh dialog's values, as the strings the boxes show. */
const initialValues = () => Object.fromEntries(Object.values(FIELDS)
  .filter(f => f.field).map(f => [f.field, String(f.initial)]));

/** A page leaf's `when` against the dialog's own variables (`Host/Create/
 *  GameType`, the game play mode's number). */
function whenOk(cond, vars) {
  if (!cond) return true;
  if (cond.op === 'or') return (cond.terms || []).some(t => whenOk(t, vars));
  if (cond.op === 'and') return (cond.terms || []).every(t => whenOk(t, vars));
  if (!(cond.var in vars)) return true;
  const same = vars[cond.var] === cond.value;
  return cond.op === 'ne' ? !same : same;
}

/** The settings as the create row carries them (`server/room-settings.mjs`
 *  `sanitizeSettings`): each box's number inside its range, the password,
 *  and the map list. */
export function createSettings(values, maps = []) {
  const out = {};
  for (const spec of Object.values(FIELDS)) {
    if (!spec.field) continue;
    const raw = values?.[spec.field];
    if (spec.text) { out[spec.field] = String(raw ?? ''); continue; }
    const n = Math.trunc(Number(raw));
    out[spec.field] = Number.isFinite(n) && String(raw ?? '').trim() !== ''
      ? Math.min(spec.max, Math.max(spec.min, n)) : spec.initial;
  }
  if (maps.length) out.maps = maps.map(entry => ({ level: entry.level, mode: entry.mode ?? null }));
  return out;
}

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
                     code: newCode(), editing: false, types: [], typeIndex: 0,
                     // The settings boxes (`FIELDS`), the box with the
                     // keyboard (its variable, or null), the page shown, and
                     // SELECTED LEVELS: the room's map list and its pick.
                     values: initialValues(), field: null, page: 0,
                     maps: [], mapIndex: -1 };
    loadTypes(state.create);
    startCaret();
    view.paintSoon();
    return true;
  }

  /** GAME TYPE's rows: the game types the level's own report offers
   *  (`scene.json` `gameTypes`, `game-modes.js`), its default first. The
   *  engine fills `Host/Create/GameTypeList` at run time from the level's
   *  `GameTypes`; a room plays the one picked (`?mode=`, the room server's
   *  `LevelData.instantiate(mode)`). A report that names none leaves the
   *  list empty and the room on the level's default layer. */
  const reports = new Map();
  function loadTypes(create) {
    const level = create?.level;
    if (!level || !view.report) return;
    if (!reports.has(level)) reports.set(level, view.report(level));
    reports.get(level).then(report => {
      if (state.create !== create || create.level !== level) return;
      const types = gameTypes(report);
      const first = report?.gameplayMode
        ? types.findIndex(t => String(t.mode).toLowerCase() === String(report.gameplayMode).toLowerCase())
        : -1;
      if (first > 0) types.unshift(...types.splice(first, 1));
      create.types = types;
      create.typeIndex = 0;
      view.paintSoon();
    });
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

  /** Leave the box that has the keyboard: a number comes back inside its
   *  range, an empty one to its default. */
  function blur() {
    const create = state.create;
    if (!create) return;
    const spec = FIELDS[create.field];
    if (spec?.field && !spec.text) {
      create.values[spec.field] = String(createSettings(create.values)[spec.field]);
    }
    create.field = null;
    create.editing = false;
  }

  /** Give `name`'s box the keyboard. */
  function focus(name) {
    blur();
    state.create.field = name;
    state.create.editing = true;
  }

  /** Typing into the box that has the keyboard. Returns whether the key was
   *  the box's; anything else falls back to the screen's own keys. */
  function typeInto(event) {
    const create = state.create;
    if (!create?.editing) return false;
    const spec = FIELDS[create.field] ?? FIELDS[SERVER_NAME];
    const get = () => (spec.code ? create.code : create.values[spec.field]);
    const set = text => { if (spec.code) create.code = text; else create.values[spec.field] = text; };
    if (event.key === 'Backspace') {
      set(get().slice(0, -1));
    } else if (event.key === 'Enter' || event.key === 'Escape' || event.key === 'Tab') {
      blur();
    } else if (event.key.length !== 1) {
      return false;
    } else if (spec.code) {
      if (!CODE_CHAR_RE.test(event.key)) return false;
      if (create.code.length < CODE_MAX) create.code += event.key;
    } else if (spec.text) {
      // A password has no blank (`ERROR_PASSWORD`) and holds 30 characters.
      if (event.key === ' ' || get().length >= spec.maxChars) return true;
      set(get() + event.key);
    } else {
      if (!/^[0-9]$/.test(event.key)) return true;
      if (get().length < String(spec.max).length) set(get() + event.key);
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
    create.types = [];
    create.typeIndex = 0;
    loadTypes(create);
    const rows = listCapacity(createBox('Host/Create/LevelsList'));
    if (create.index < create.scroll) create.scroll = create.index;
    else if (create.index >= create.scroll + rows) create.scroll = create.index - rows + 1;
    view.paintSoon();
  }

  const createBox = data =>
    view.page('createGame').find(el => el.kind === 'listbox' && el.data === data);

  /** START INTERNET: the room is made by the first client to name a code
   *  the server has no room for, so this is a navigation like every other.
   *  GAME TYPE's pick rides as `mode=`; the level's default needs none. The
   *  settings ride in the join row, not the address: they are left for the
   *  game page in this tab's session storage (`room-host-client.js`
   *  `roomStore`), the password with them. With SELECTED LEVELS filled the
   *  room starts on the list's first level and runs the list. */
  function createRoom() {
    const create = state.create;
    // The server's cap on live rooms (`lobby.js` `full`): no room is made,
    // and the dialog says why (`paintSettings`).
    if (!create?.level || !view.online() || !codeOk() || view.serverFull?.()) return;
    blur();
    const first = create.maps[0] ?? null;
    const args = new URLSearchParams({ room: create.code, name: state.name,
                                       map: first ? first.level : levelKey(create.level) });
    // The game type picked, when it is not the level's default: the room is
    // made on that layer (`server/room-registry.mjs` `createRoom`).
    const type = create.types?.[create.typeIndex];
    if (first) { if (first.mode) args.set('mode', first.mode); }
    else if (type && create.typeIndex > 0) args.set('mode', type.name);
    (view.store ?? roomStore()).setCreate(create.code, createSettings(create.values, create.maps));
    view.onStart(`${view.root}map.html?${args}`);
  }

  // --- SELECTED LEVELS: the room's map list ---------------------------------------

  /** The highlighted level under the game type picked, as a list entry. */
  function pickedEntry() {
    const create = state.create;
    if (!create?.level) return null;
    const type = create.types?.[create.typeIndex];
    return { level: levelKey(create.level), title: create.level.title,
             mode: type && create.typeIndex > 0 ? type.name : null };
  }

  /** The arrows between the two lists and over the second: add the
   *  highlighted level, take the picked one out, move it up or down. */
  function editMaps(action) {
    const create = state.create;
    const maps = create.maps;
    const at = create.mapIndex;
    if (action === 'add') {
      const entry = pickedEntry();
      if (entry && maps.length < 32) { maps.push(entry); create.mapIndex = maps.length - 1; }
    } else if (action === 'remove' && at >= 0) {
      maps.splice(at, 1);
      create.mapIndex = Math.min(at, maps.length - 1);
    } else if ((action === 'up' || action === 'down') && at >= 0) {
      const to = at + (action === 'up' ? -1 : 1);
      if (to >= 0 && to < maps.length) {
        [maps[at], maps[to]] = [maps[to], maps[at]];
        create.mapIndex = to;
      }
    }
    view.paintSoon();
  }

  const selectedBox = () => createBox('Host/Create/SelectedLevelsList');
  const MAP_ARROWS = { menu_rubr_pilh_16x32: 'add', menu_rubr_pilv_16x32: 'remove',
                       menu_pilupp_32x16: 'up', menu_pilner_32x16: 'down' };

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

  /** CREATE GAME: `menu/CreateGameMenu`, its two settings pages and START
   *  INTERNET from `menu/CreateGameNavigation`. A page, not an overlay —
   *  the engine's own `SetPathAction` swaps the browser out for it, and the
   *  plate is transparent enough that leaving the list underneath shows
   *  through it. START LOCAL is not drawn: there is one room server and it
   *  is this origin, so it would be the same button twice.
   *
   *  The right-hand column is the file's own: GAME TYPE, and SELECTED
   *  LEVELS with the arrows that move a level in and out of the room's map
   *  list and reorder it. */
  function paintCreate(table) {
    const create = state.create;
    // The preview slot is a `VariablePictureNode` on
    // `Host/Create/LevelPicture`: the engine swaps the highlighted level's
    // own menu thumbnail into it, and the file's shipped value is whichever
    // level the page was saved on. Painted here rather than by
    // `paintElement`, which only knows the Instant Battle screen's slot.
    const slot = view.page('createGame').find(el => el.var === 'Host/Create/LevelPicture');
    view.paintPage('createGame', table, el => el === slot);
    const thumb = view.thumbnailOf(create.level);
    if (slot && thumb) {
      ctx.globalAlpha = 1;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(thumb, ...slot.rect);
    }
    paintSettings(create, font0());
    view.paintPage('createGameNav', table, el => el.rect[0] < 600);

    const box = createBox('Host/Create/LevelsList');
    const font = pack.env.font(box.font);
    if (font) paintList(box, font, view.levels.map(l => l.title), create.index, create.scroll);
    const types = typesBox();
    const typeFont = types ? pack.env.font(types.font) : null;
    if (typeFont) {
      paintList(types, typeFont, (create.types ?? []).map(t => String(t.name).toUpperCase()),
                create.typeIndex, 0);
    }
    const selected = selectedBox();
    const selectedFont = selected ? pack.env.font(selected.font) : null;
    if (selectedFont) {
      paintList(selected, selectedFont,
                create.maps.map(m => (m.mode ? `${m.title} (${String(m.mode).toUpperCase()})` : m.title)),
                create.mapIndex, 0);
    }
    ctx.globalAlpha = 1;
  }

  /** GAME TYPE's list box (`Host/Create/GameTypeList`). */
  const typesBox = () => createBox('Host/Create/GameTypeList');

  /** The page's own face, for the leaves this file draws itself. */
  const font0 = () => pack.env.font(createBox('Host/Create/LevelsList').font);

  /** The variables the settings pages' conditions read: the game play
   *  mode's number for the layer the room will be made on (1 CTF, 2
   *  Conquest, 3 TDM, 4 Co-op, 5 ObjectiveMode), which picks TICKETS or
   *  SCORE LIMIT for the row they share. */
  function pageVars() {
    const create = state.create;
    const type = create.types?.[create.typeIndex];
    return { 'Host/Create/GameType': gamePlayModeOf(type?.mode ?? type?.name ?? '') };
  }

  /** The leaves of the settings page shown, already shifted into the CREATE
   *  GAME plate, with the leaves whose condition fails dropped.
   *
   *  Shifted, because the page's coordinates are its own:
   *  `menu/CreateGameMenuPageLayer` places it and that layer is a
   *  `PathNode`, which the reader has no schema for (its transform is the
   *  one thing about this dialog that is inferred rather than read). The
   *  offset used is the CREATE GAME plate's own origin, which lands the
   *  page's labels at x 42, exactly where the plate's own heading sits.
   *  Ledger MEME-17. */
  function settingLeaves() {
    const plate = view.page('createGame').find(el => el.texture?.startsWith('menu_creategamexl'));
    if (!plate) return [];
    const [dx, dy] = plate.rect;
    const vars = pageVars();
    const seen = new Set();
    const out = [];
    for (const el of view.page(SETTINGS_PAGES[state.create.page]) ?? []) {
      if (!(el.when || []).every(cond => whenOk(cond, vars))) continue;
      // MAX PLAYERS is two boxes on one rect (the demo's and the game's).
      const id = `${el.kind}:${el.var ?? el.key ?? el.text ?? el.texture ?? ''}:${el.rect.join(',')}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const { when, ...leaf } = el;
      out.push({ ...leaf, rect: [el.rect[0] + dx, el.rect[1] + dy, el.rect[2], el.rect[3]] });
    }
    return out;
  }

  /** The boxes of the page shown that a room takes, `{ name, spec, rect }`. */
  const settingFields = () => settingLeaves()
    .filter(el => el.kind === 'edit' && FIELDS[el.var])
    .map(el => ({ name: el.var, spec: FIELDS[el.var], rect: el.rect }));

  /** The page's flip arrows (`menu_rubr_pilh` on page one, `pilv` on two). */
  const pageArrows = () => settingLeaves().filter(el => el.kind === 'button');

  /** A box's own row: the leaves on its line, so a box a room does not take
   *  goes with its label, its plate and its unit. */
  const sameRow = (a, b) => Math.abs(a.rect[1] - b.rect[1]) < 8;

  /** The settings page shown: the file's labels, value boxes and units, the
   *  value in each box, and the page's own "CREATE GAME n/2" footer with its
   *  arrow. */
  function paintSettings(create, font) {
    if (!font) return;
    const leaves = settingLeaves();
    const untaken = leaves.filter(el => el.kind === 'edit' && !FIELDS[el.var]);
    for (const el of leaves) {
      if (el.kind === 'edit' || el.kind === 'hit') continue;
      if (untaken.some(box => sameRow(box, el))) continue;
      paintElement(ctx, el, view.layout, state, pack.env);
    }
    for (const { name, spec, rect } of settingFields()) {
      const text = spec.code ? create.code : create.values[spec.field];
      const bad = spec.code && !codeOk();
      ctx.globalAlpha = 1;
      ctx.imageSmoothingEnabled = false;
      const x = Math.round(rect[0] + 3);
      const y = rect[1] + 4;
      drawBitmapText(ctx, font, pack.env.tint, text, x, y, bad ? ALERT : [0.78, 0.78, 0.78], true);
      // The caret: a one-unit bar after the text, on the half second.
      if (create.editing && (create.field ?? SERVER_NAME) === name
          && Math.floor(Date.now() / 500) % 2 === 0) {
        ctx.fillStyle = '#c7c7b4';
        ctx.fillRect(x + measureText(font, text) + 1, y, 1, font.meta.lineHeight);
      }
    }
    // What SERVER NAME will take, said only when what is in it will not do.
    const name = settingFields().find(f => f.spec.code);
    if (name && !codeOk()) {
      ctx.globalAlpha = 1;
      drawBitmapText(ctx, font, pack.env.tint, CODE_RULE,
                     Math.round(name.rect[0] + name.rect[2] + 8), name.rect[1] + 4, ALERT);
    } else if (name && view.serverFull?.()) {
      ctx.globalAlpha = 1;
      drawBitmapText(ctx, font, pack.env.tint, SERVER_FULL,
                     Math.round(name.rect[0] + name.rect[2] + 8), name.rect[1] + 4, ALERT);
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
    const types = typesBox();
    if (types && inRect(listRowArea(types), x, y)) {
      const index = Math.floor((y - listRowArea(types)[1]) / types.rowHeight);
      return index < (state.create.types?.length ?? 0) ? { kind: 'create-type', index } : { kind: 'modal' };
    }
    const selected = selectedBox();
    if (selected && inRect(listRowArea(selected), x, y)) {
      const index = Math.floor((y - listRowArea(selected)[1]) / selected.rowHeight);
      return index < state.create.maps.length ? { kind: 'create-map', index } : { kind: 'modal' };
    }
    for (const el of view.page('createGame')) {
      if (el.kind !== 'button' || !inRect(el.rect, x, y)) continue;
      // The arrows that fill and order SELECTED LEVELS.
      if (MAP_ARROWS[el.texture]) {
        return { kind: 'button', action: 'create-maps', edit: MAP_ARROWS[el.texture], rect: el.rect };
      }
      if (!el.texture?.includes('scrollpil') || el.rect[0] > box.rect[0] + box.rect[2]) continue;
      return { kind: 'button', action: 'create-scroll',
               by: el.texture.includes('upp') ? -1 : 1, rect: el.rect };
    }
    for (const field of settingFields()) {
      if (inRect(field.rect, x, y)) return { kind: 'create-field', name: field.name };
    }
    for (const arrow of pageArrows()) {
      if (inRect(arrow.rect, x, y)) return { kind: 'button', action: 'create-page', rect: arrow.rect };
    }
    const go = startButton();
    if (go && inRect(go.rect, x, y)) {
      return { kind: 'button', action: 'create-go', rect: go.rect };
    }
    return { kind: 'modal' };
  }

  /** A click the dialog's `hitTest` answered. */
  function click(hit) {
    // A click anywhere in the dialog but a box takes the keyboard off the
    // one that had it, the way clicking away from a field does everywhere.
    if (state.create && hit.kind !== 'create-field') blur();
    if (hit.kind === 'create-field') {
      focus(hit.name);
      view.paintSoon();
    } else if (hit.kind === 'create-level') pickCreateLevel(hit.index);
    else if (hit.kind === 'create-type') {
      state.create.typeIndex = hit.index;
      view.paintSoon();
    } else if (hit.kind === 'create-map') {
      state.create.mapIndex = hit.index;
      view.paintSoon();
    } else if (hit.action === 'create-maps') editMaps(hit.edit);
    else if (hit.action === 'create-page') {
      state.create.page = state.create.page ? 0 : 1;
      view.paintSoon();
    }
    else if (hit.action === 'create-scroll') {
      const max = Math.max(0, view.levels.length - listCapacity(levelsBox()));
      state.create.scroll = Math.min(max, Math.max(0, state.create.scroll + hit.by));
      view.paintSoon();
    } else if (hit.action === 'create-go') createRoom();
    else if (hit.kind === 'modal') { view.paintSoon(); }
  }

  /** The dialog's one scrolled list. */
  const levelsBox = () => createBox('Host/Create/LevelsList');

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
    editMaps,
    focus,
    blur,
    paint: paintCreate,
    hitTest,
    click,
    keydown,
  };
}
