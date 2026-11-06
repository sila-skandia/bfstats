/**
 * The end of a round on the page: the multiplayer debriefing over the world,
 * the win or lose cue, and the restart into the next round.
 *
 * What the game does (ledger ROUND-8, ROUND-9, ROUND-12, read 2026-10-06 and
 * 2026-10-22):
 *
 *  - `round-state.js` decides the winner the server's way and turns the
 *    status to EndGame, where nothing scores and no bot thinks (the AI runs
 *    only while the status is Playing, AI-4);
 *  - the client's debriefing (`0x006aad90`, ROUND-8) writes the title by the
 *    local side's result and the victory type, `DEBRIEFING_TOTAL / MAJOR /
 *    MINOR_VICTORY` or `_DEFEAT` (`DEBRIEFING_DRAW` for a draw; ObjectiveMode
 *    the bare `VICTORY` / `DEFEAT`), and plays the win cue (`setMusic(3)`)
 *    or the lose cue (`setMusic(5)`) once; a draw plays neither. It also
 *    writes the level's own line, but only the single-player plate draws it;
 *  - in a game joined or hosted (`StartingGame` 2 or 3) the screen is
 *    `menu/LoadMenu`'s multiplayer plate, drawn over the world with no score
 *    board under it (ROUND-12): the title, each side's ticket flag and
 *    count, BEST PLAYERS, the heading strip, and the client's own list of
 *    the top three by score (`FUN_006aa4f0`): rank digit, side flag, name,
 *    score, kills, deaths, ping and a medal by rank and side. No level line
 *    and no countdown;
 *  - a multiplayer server restarts the map 10 s later (`+0x21c`, ROUND-9).
 *
 * The plate itself is data, `debriefing/debriefing-layout.json`
 * (`extract_debriefing_layout.py`), painted leaf by leaf with the score
 * board's painter. The rows are the client's and live here
 * (`DEBRIEFING_LIST`, `bestPlayers`, `debriefingRowDraws`).
 *
 * The top half of the file is pure (no DOM, no page) so
 * `tests/round_end_harness.mjs` runs it; `createRoundEnd` is the page's.
 */

import { GAME_PLAY_MODE, VICTORY } from './round-state.js';
import { paintLeaves, scoreOrder, textureKey } from './scoreboard.js';
import { drawBitmapText, measureBitmapText } from './bitmap-text.js';

/** The debriefing's titles and heading in vanilla's English, for a tree
 *  whose `scene.json` predates `briefing.debriefing.titles`. */
export const DEBRIEFING_ENGLISH = Object.freeze({
  DEBRIEFING_TOTAL_VICTORY: 'TOTAL VICTORY', DEBRIEFING_MAJOR_VICTORY: 'MAJOR VICTORY',
  DEBRIEFING_MINOR_VICTORY: 'MINOR VICTORY', DEBRIEFING_TOTAL_DEFEAT: 'TOTAL DEFEAT',
  DEBRIEFING_MAJOR_DEFEAT: 'MAJOR DEFEAT', DEBRIEFING_MINOR_DEFEAT: 'MINOR DEFEAT',
  DEBRIEFING_DRAW: 'DRAW', DEBRIEFING_HEADING: 'BEST PLAYERS',
  VICTORY: 'VICTORY', DEFEAT: 'DEFEAT',
});

/**
 * What the debriefing shows for the local side (ROUND-8). `winner` is 1, 2
 * or 0 for a draw, `victoryType` a `VICTORY` value, `localTeam` the reader's
 * side. Null when the round has no result yet (type 4, `none`, which the
 * client refuses to build on).
 *
 * Returns `{ result, titleKey, lineKey, side, music }`: `result` 'victory',
 * 'defeat' or 'draw'; `lineKey` the level line's key under `side` ('allied'
 * for team 2, else 'axis', the client's own `== 2` test), null on a draw;
 * `music` 'win', 'lose' or null.
 */
export function debriefingOf({ winner = null, victoryType = VICTORY.none, localTeam = 0,
                               objective = false } = {}) {
  if (victoryType === VICTORY.none || victoryType == null) return null;
  const side = localTeam === 2 ? 'allied' : 'axis';
  if (victoryType === VICTORY.draw || (winner !== 1 && winner !== 2)) {
    return { result: 'draw', titleKey: 'DEBRIEFING_DRAW', lineKey: null, side, music: null };
  }
  const won = winner === localTeam;
  if (objective) {
    // The level's objective lines: allied victory at `+0x1c`, allied defeat
    // `+0x38`, axis victory `+0x54`, axis defeat `+0x70` of the block at
    // `LevelManager+0x308`, by the same `== 2` side test.
    return {
      result: won ? 'victory' : 'defeat',
      titleKey: won ? 'VICTORY' : 'DEFEAT',
      lineKey: `${side}${won ? 'Victory' : 'Defeat'}`,
      side: 'objective',
      music: won ? 'win' : 'lose',
    };
  }
  const size = victoryType === VICTORY.total ? 'TOTAL'
    : victoryType === VICTORY.major ? 'MAJOR' : 'MINOR';
  const result = won ? 'victory' : 'defeat';
  // The level writes four lines a side: the total class reads the Major one,
  // the major and minor classes the Minor one (0x006aae86..0x006ab0b2).
  const lineSize = victoryType === VICTORY.total ? 'major' : 'minor';
  return {
    result,
    titleKey: `DEBRIEFING_${size}_${won ? 'VICTORY' : 'DEFEAT'}`,
    lineKey: `${lineSize}${won ? 'Victory' : 'Defeat'}`,
    side,
    music: won ? 'win' : 'lose',
  };
}

/** The words for a `debriefingOf` answer out of `scene.json.briefing`:
 *  `{ title, line, heading }`. A missing line is the empty string. */
export function debriefingWords(result, briefing = null) {
  const titles = { ...DEBRIEFING_ENGLISH, ...(briefing?.debriefing?.titles ?? {}) };
  if (!result) return { title: '', line: '', heading: titles.DEBRIEFING_HEADING };
  const line = result.lineKey ? briefing?.debriefing?.[result.side]?.[result.lineKey] ?? '' : '';
  return { title: titles[result.titleKey] ?? '', line: String(line).trim(), heading: titles.DEBRIEFING_HEADING };
}


// --- the client's list (FUN_006aa4f0, ROUND-12) --------------------------------

/**
 * `Debriefing/DebriefingList` as the client builds and fills it.
 *
 * - `columns`: the list's eight `addColumn` ints (BF1942.exe
 *   0x006aa40d..0x006aa46a), column 0 at 0; a text cell starts at the box's
 *   left + 10 + its column's int (the list draw, 0x007d1390).
 * - `text`: the text cells by column, each a field of the row; drawn white
 *   (the three 1.0 the fill pushes) in the list's own face.
 * - `pictures`: the picture cells, `[w, h, x, y]` as pushed for
 *   `FUN_007d4800` and stored by `0x007cf6e0` at +0x50..+0x5c. The draw puts
 *   one at the box's left + 10 + x, its top y above the row's line, at w x h;
 *   the column it sits in does not move it.
 * - The first row's line is the box's top plus twice the row height, each
 *   next one row height lower: the file's "Row height" (76 here) is read
 *   into the list node's +0x18 (0x007cffc7), which the draw adds twice
 *   before the first row and once per row. Text sits on the line.
 * - `rows`: three. A multiplayer game lists the top three of
 *   `getPlayersSortedByScore` (PlayerManager vt+0x30), whoever they are.
 */
export const DEBRIEFING_LIST = Object.freeze({
  textInset: 10,
  columns: [0, 25, 45, 220, 270, 320, 370, 420, 450],
  text: { 2: 'name', 3: 'score', 4: 'kills', 5: 'deaths', 6: 'ping' },
  pictures: { rank: [16, 16, 0, 11], flag: [16, 16, 16, 11], medal: [32, 32, 420, 11] },
  rows: 3,
  color: [1, 1, 1],
});

/** The rank digit a row's first cell shows (`ToolTip/<n>_16x16`). */
export function rankTexture(rank) {
  return rank >= 1 && rank <= 3 ? `${rank}_16x16` : 'empty_8x8';
}

const MEDAL_OF_RANK = ['gold', 'silver', 'bronze'];

/** `FUN_006a9f00`: the medal by rank and the player's side, the Axis set for
 *  team 1 and the Allied one for team 2; anything else is `empty_8x8`. */
export function medalTexture(rank, team) {
  const kind = MEDAL_OF_RANK[rank - 1];
  if (!kind || (team !== 1 && team !== 2)) return 'empty_8x8';
  return `${team === 1 ? 'axis' : 'allied'}_xl_${kind}_32x32`;
}

/**
 * The client's three rows out of the page's players: everyone on either
 * side, in `getPlayersSortedByScore`'s order (the client's 0x0057b450,
 * `scoreboard.js` `scoreOrder`): score, then kills, then fewest deaths,
 * then the local player, then the order the players came in (`order`, the
 * board's roster order). Each player is `{ name, team, score, kills,
 * deaths, ping, local?, order? }`; returns them with `rank` 1..3.
 */
export function bestPlayers(players = []) {
  const num = v => (Number.isFinite(v) ? v : 0);
  return (players ?? [])
    .filter(p => p && (p.team === 1 || p.team === 2))
    .map((p, i) => ({ ...p, order: Number.isFinite(p.order) ? p.order : i }))
    .sort(scoreOrder)
    .slice(0, DEBRIEFING_LIST.rows)
    .map((p, i) => ({
      name: String(p.name ?? ''), team: p.team, score: num(p.score), kills: num(p.kills),
      deaths: num(p.deaths), ping: num(p.ping), rank: i + 1,
    }));
}

/**
 * What the list draws for `rows` (from `bestPlayers`) in the layout's
 * `listbox` leaf, in virtual units: `{ kind: 'picture', texture | var, rect }`
 * and `{ kind: 'text', text, x, baseline, field }`. A flag cell names the
 * side's ticket-flag variable (`AxisTicketFlag` / `AlliedTicketFlag`), the
 * art `BfHud_loadTeamIcons` gives both it and the plate's own flags.
 */
export function debriefingRowDraws(box, rows) {
  const L = DEBRIEFING_LIST;
  const [bx, by] = box.rect;
  const pitch = box.rowHeight;
  const left = bx + L.textInset;
  const out = [];
  rows.slice(0, L.rows).forEach((row, i) => {
    const line = by + 2 * pitch + i * pitch;
    const pic = (name, extra) => {
      const [w, h, x, y] = L.pictures[name];
      out.push({ kind: 'picture', cell: name, rect: [left + x, line - y, w, h], ...extra });
    };
    pic('rank', { texture: rankTexture(row.rank) });
    pic('flag', { var: row.team === 1 ? 'AxisTicketFlag' : 'AlliedTicketFlag' });
    for (const [col, field] of Object.entries(L.text)) {
      out.push({ kind: 'text', field, text: String(row[field]), x: left + L.columns[col], baseline: line });
    }
    pic('medal', { texture: medalTexture(row.rank, row.team) });
  });
  return out;
}

/**
 * The variable table the plate's leaves read: the file's own sample values
 * under what the page knows. `title` is the debriefing's heading,
 * `tickets` the HUD's own counter strings and flags (`ticket-feed.js`
 * `ticketMemoFor`: what `HudTickets__update` writes to `AxisTicket` /
 * `AlliedTicket` and `BfHud_loadTeamIcons` to the flags), and
 * `startingGame` 2 for a game joined, 3 for one hosted.
 */
export function debriefingVars(layoutVars, { title = '', tickets = null, startingGame = 2 } = {}) {
  const vars = { ...(layoutVars || {}) };
  vars.StartingGame = startingGame;
  vars['Debriefing/DebriefingHeading'] = title;
  const show = !!tickets?.show;
  vars.AxisTicket = show ? String(tickets.axis) : '';
  vars.AlliedTicket = show ? String(tickets.allied) : '';
  vars.AxisTicketFlagLoad = show ? tickets.axisFlag || '' : '';
  vars.AlliedTicketFlagLoad = show ? tickets.alliedFlag || '' : '';
  vars.AxisTicketFlag = tickets?.axisFlag || '';
  vars.AlliedTicketFlag = tickets?.alliedFlag || '';
  return vars;
}

/** The layout's virtual screen onto a `W` x `H` box the way the score board
 *  maps it: stretched on a landscape box, fitted and centred on a portrait
 *  one. */
export function plateScale(W, H, virtual = [800, 600]) {
  const [vw, vh] = virtual;
  if (W / H < 1) {
    const s = Math.min(W / vw, H / vh);
    return { sx: s, sy: s, ox: (W - vw * s) / 2, oy: (H - vh * s) / 2 };
  }
  return { sx: W / vw, sy: H / vh, ox: 0, oy: 0 };
}

// --- the plate on a phone --------------------------------------------------------
//
// At the game's own 800 x 600 mapping a phone draws the plate's list face
// (`standard6`, 8 units a line) three or four pixels high: on a 375 px
// portrait screen the plate is 240 px wide. A small stage instead gets the
// same plate, the same art, faces and colours, laid out denser: the rows cut
// from 72 units to one line (`wide`, a landscape phone) or two (`narrow`, a
// portrait one, the numbers under the name), the plate's art cut to fit
// (its header, a row's panel, its separators and bottom kept at their own
// size), and the whole scaled up to the stage. A desktop stage is not
// compact and keeps the game's mapping.

/** The plate's own art (`mp_debriefing_512x512`): its corner on the 800 x 600
 *  screen, and the rows of the texture each part is cut from. */
export const PLATE_ART = Object.freeze({
  at: [150, 100],
  width: 512,
  header: [0, 96],          // the title, the tickets, BEST PLAYERS, the heading strip
  bodies: [96, 172, 248],   // each row's panel, under the strip for the first
  separators: [168, 244],   // the light rule between two panels, 4 high
  bottom: [320, 324],
  border: 4,                // the frame's right edge, kept at its own width
});

/** A stage this small is a phone's: the plate goes compact. */
export const COMPACT_STAGE = Object.freeze({ width: 600, height: 480 });

const COMPACT_ROWS = {
  // One line a row, the game's columns: a landscape phone.
  wide: { body: 20, width: PLATE_ART.width },
  // Two lines a row: the rank, flag, name and medal over the four numbers.
  narrow: { body: 36, width: 210, name: 40, numbers: [40, 76, 112, 148], icon: 8, medal: 40 },
};
/** The narrow plate is taken only when it draws this much larger than the
 *  wide one: a landscape phone keeps the game's columns. */
const NARROW_GAIN = 1.15;
/** How much of its size the plate gives up to stay clear of the card. */
const CARD_COST = 0.9;
/** Where the game's tickets sit about the plate's middle (255 units in). */
const TICKET_MIDDLE = PLATE_ART.at[0] + 255;
const NUMBER_FIELDS = ['score', 'kills', 'deaths', 'ping'];
const NUMBER_ICONS = ['menu_icon_score_16x16', 'menu_icon_kills_16x16', 'menu_icon_death_16x16', 'menu_icon_ping_16x16'];
const STAGE_MARGIN = 12;

/** Whether a `W` x `H` stage draws the compact plate. */
export function compactStage(W, H) {
  return W > 0 && H > 0 && (W < COMPACT_STAGE.width || H < COMPACT_STAGE.height);
}

/**
 * The compact plate for a `W` x `H` stage, or null for a stage that keeps
 * the game's mapping. `elements` are the layout's leaves (the listbox
 * aside), `rows` `bestPlayers`' rows, `titleWidth` the heading's width in
 * its own face. Everything is in plate units (its corner at 0, 0):
 * `{ mode, width, height, scale, ox, oy, slices: [{ src: [x, y, w, h],
 * dst: [x, y, w, h] }], leaves, draws }`, `leaves` the layout's own moved
 * to their places and `draws` the rows' cells as `debriefingRowDraws` gives
 * them.
 */
export function compactPlate(W, H, elements = [], rows = [], { titleWidth = 0, inset = null } = {}) {
  if (!compactStage(W, H)) return null;
  // The room the page's own controls leave: `bottom` all of them (a
  // replay's bar and the card over it), `barBottom` the bar alone. The card
  // is kept clear only where that costs the plate little; on a landscape
  // phone it would halve it, and the plate goes over the card instead.
  const header = PLATE_ART.header[1];
  const plan = (mode, top, bottom) => {
    const room = H - top - bottom;
    const spec = COMPACT_ROWS[mode];
    const width = Math.max(spec.width, Math.ceil(titleWidth) + 16);
    const height = header + 3 * spec.body + 2 * 4 + 4;
    const scale = Math.min((W - 2 * STAGE_MARGIN) / width, (room - 2 * STAGE_MARGIN) / height);
    return { mode, spec, width, height, scale, top, room };
  };
  const best = (top, bottom) => {
    if (H - top - bottom < H * 0.3) return null;
    const wide = plan('wide', top, bottom);
    const narrow = plan('narrow', top, bottom);
    return narrow.scale > wide.scale * NARROW_GAIN ? narrow : wide;
  };
  const top = Math.max(0, inset?.top ?? 0);
  const all = best(top, Math.max(0, inset?.bottom ?? 0));
  const bar = best(top, Math.max(0, inset?.barBottom ?? inset?.bottom ?? 0));
  const bare = best(0, 0);
  let p = all && bar && all.scale >= bar.scale * CARD_COST ? all : bar ?? bare;
  if (!p || p.scale < bare.scale * 0.5) p = bare;
  const { spec, width, height, scale, mode } = p;
  const [ax, ay] = PLATE_ART.at;
  const B = PLATE_ART.border;

  // The art: each band cut once across, the frame's right edge kept.
  const slices = [];
  const band = (srcY, h, dstY) => {
    if (h <= 0) return;
    slices.push({ src: [0, srcY, width - B, h], dst: [0, dstY, width - B, h] });
    slices.push({ src: [PLATE_ART.width - B, srcY, B, h], dst: [width - B, dstY, B, h] });
  };
  band(0, header, 0);
  let y = header;
  const rowTops = [];
  for (let i = 0; i < 3; i++) {
    const top = i === 0 ? header : PLATE_ART.bodies[i];
    rowTops.push(y);
    band(top, spec.body, y);
    y += spec.body;
    if (i < 2) { band(PLATE_ART.separators[i], 4, y); y += 4; }
  }
  band(PLATE_ART.bottom[0], PLATE_ART.bottom[1] - PLATE_ART.bottom[0], y);

  // The layout's leaves at their places: the game's on a wide plate, the
  // header's centred pieces about the narrow one's middle.
  const leaves = [];
  for (const el of elements) {
    if (el.kind === 'listbox') continue;
    if (el.kind === 'picture' && el.texture && /debriefing/i.test(el.texture)) continue;  // the art, cut above
    const [x, ey, w, h] = el.rect;
    let rect = [x - ax, ey - ay, w, h];
    if (mode === 'narrow') {
      const iconAt = NUMBER_ICONS.indexOf(el.texture);
      if (iconAt >= 0) continue;  // each row carries its own, beside its number
      if (el.var === 'Debriefing/DebriefingHeading') rect = [5, rect[1], width - 10, h];
      else if (/Ticket/.test(el.var ?? '')) rect = [width / 2 + (x - TICKET_MIDDLE), rect[1], w, h];
      else if (el.kind === 'fill') rect = [rect[0], rect[1], width - rect[0] - (PLATE_ART.width - (x - ax) - w), h];
      else if (el.kind === 'text' && el.text === 'PLAYERNAME') rect = [spec.name, rect[1], w, h];
    }
    leaves.push({ ...el, rect });
  }

  // The rows: the game's cells on one line, or two.
  const L = DEBRIEFING_LIST;
  const box = elements.find(el => el.kind === 'listbox');
  const left = (box?.rect[0] ?? 145) + L.textInset - ax;  // the box's left + 10, in plate units
  const draws = [];
  rows.slice(0, L.rows).forEach((row, i) => {
    const line = rowTops[i] + 11;
    const pic = (name, x, top, w, h, extra) => draws.push({ kind: 'picture', cell: name, rect: [x, top, w, h], ...extra });
    const flagVar = row.team === 1 ? 'AxisTicketFlag' : 'AlliedTicketFlag';
    if (mode === 'wide') {
      const [rw, rh, rx, ry] = L.pictures.rank;
      pic('rank', left + rx, line - ry, rw, rh, { texture: rankTexture(row.rank) });
      const [fw, fh, fx, fy] = L.pictures.flag;
      pic('flag', left + fx, line - fy, fw, fh, { var: flagVar });
      for (const [col, field] of Object.entries(L.text)) {
        draws.push({ kind: 'text', field, text: String(row[field]), x: left + L.columns[col], baseline: line });
      }
      // The medal is 32 high against a 20-unit row: halved, on the line.
      pic('medal', left + L.pictures.medal[2], line - 13, 16, 16, { texture: medalTexture(row.rank, row.team) });
      return;
    }
    pic('rank', left, line - 11, 16, 16, { texture: rankTexture(row.rank) });
    pic('flag', left + 16, line - 11, 16, 16, { var: flagVar });
    draws.push({ kind: 'text', field: 'name', text: String(row.name), x: spec.name, baseline: line });
    const second = line + 16;
    NUMBER_FIELDS.forEach((field, k) => {
      const x = spec.numbers[k];
      pic(`${field}-icon`, x - spec.icon - 3, second - spec.icon, spec.icon, spec.icon, { texture: NUMBER_ICONS[k] });
      draws.push({ kind: 'text', field, text: String(row[field]), x, baseline: second });
    });
    pic('medal', width - spec.medal + 4, rowTops[i] + 2, 32, 32, { texture: medalTexture(row.rank, row.team) });
  });

  return {
    mode, width, height, scale,
    ox: (W - width * scale) / 2, oy: p.top + (p.room - height * scale) / 2,
    slices, leaves, draws,
  };
}

// --- the page ------------------------------------------------------------------

const STYLE = `
.debriefing-plate { position: absolute; inset: 0; pointer-events: none; z-index: 40; }
.debriefing-plate[hidden] { display: none; }
.debriefing-plate canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
`;
let styled = false;

/**
 * The multiplayer plate over the world (ROUND-12): `debriefing/
 * debriefing-layout.json`, its faces and plates, and the client's three
 * rows, painted on a canvas over `stage`. Shared by the page's round end
 * (`createRoundEnd`) and the replay's (replay-debrief.js).
 *
 * `opts`: `id` (the element's), `stage` (the element to draw over, or a
 * function answering it), `inset()` (optional: `{ top, bottom }`, the
 * stage's pixels the page's own controls cover, which the compact plate
 * keeps clear of), `spriteUrl(rel)` (a HUD-pack path to a URL) and
 * `sprite(name)` (a loaded HUD sprite, for the side flags). `show(model)`
 * paints `{ vars, players }` (`debriefingVars`, `bestPlayers`); a layout
 * that lands later takes its own sample values under the model's.
 */
export function createDebriefingPlate(opts = {}) {
  const plate = { shown: false, model: null, compact: null };
  let root = null;
  let canvas = null;
  const layout = { data: null, fonts: new Map(), textures: new Map(), loading: null };

  function build() {
    if (root || typeof document === 'undefined') return;
    if (!styled) {
      styled = true;
      const style = document.createElement('style');
      style.textContent = STYLE;
      document.head.appendChild(style);
    }
    root = document.createElement('div');
    root.id = opts.id ?? 'round-end';
    root.className = 'debriefing-plate';
    root.hidden = true;
    root.setAttribute('aria-live', 'polite');
    canvas = document.createElement('canvas');
    root.appendChild(canvas);
    const stage = typeof opts.stage === 'function' ? opts.stage() : opts.stage;
    (stage ?? document.body).appendChild(root);
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => paint()).observe(root);
  }

  /** `debriefing/debriefing-layout.json`, its faces and its plates, once. */
  function loadLayout() {
    if (layout.loading || typeof fetch === 'undefined' || !opts.spriteUrl) return layout.loading;
    const url = rel => opts.spriteUrl(`debriefing/${rel}`);
    const image = src => new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
    layout.loading = (async () => {
      let data;
      try {
        data = await fetch(url('debriefing-layout.json')).then(r => r.json());
      } catch (error) {
        console.warn('debriefing layout unavailable', error);
        return;
      }
      await Promise.all([
        ...Object.entries(data.fontFiles || {}).map(async ([id, entry]) => {
          const [meta, img] = await Promise.all([
            fetch(url(entry.glyphs)).then(r => r.json()).catch(() => null), image(url(entry.file))]);
          if (meta && img) layout.fonts.set(id, { meta, img, tinted: new Map() });
        }),
        ...Object.entries(data.textures || {}).map(async ([name, entry]) => {
          const img = await image(url(entry.file));
          if (img) layout.textures.set(name, img);
        }),
      ]);
      layout.data = data;
      paint();
    })();
    return layout.loading;
  }

  const res = {
    texture: name => (name ? layout.textures.get(name) ?? opts.sprite?.(name) ?? null : null),
    // A side flag is the HUD pack's art (the mod's own), as on the board.
    boundTexture: name => opts.sprite?.(name) ?? layout.textures.get(name) ?? null,
    measure: (fontId, text) => {
      const font = layout.fonts.get(fontId);
      return font ? measureBitmapText(font, text) : 0;
    },
    drawText: (ctx, fontId, text, x, y, rgb) => {
      const font = layout.fonts.get(fontId);
      if (font) drawBitmapText(ctx, font, text, x, y, { rgb });
    },
    lineHeight: fontId => layout.data?.fontFiles?.[fontId]?.lineHeight || 8,
  };

  /** One paint of the plate and its rows, from the model shown. */
  function paint() {
    const data = layout.data;
    if (!plate.shown || !canvas || !data || !plate.model) return;
    const W = root.clientWidth || 800;
    const H = root.clientHeight || 600;
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 3);
    const cw = Math.round(W * dpr);
    const ch = Math.round(H * dpr);
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    const { vars, players } = plate.model;
    const box = data.elements.find(el => el.kind === 'listbox' && el.data === 'Debriefing/DebriefingList');
    // A phone's stage: the same plate, denser (`compactPlate`).
    const heading = data.elements.find(el => el.var === 'Debriefing/DebriefingHeading');
    const compact = box ? compactPlate(W, H, data.elements, players, {
      titleWidth: heading ? res.measure(heading.font, String(vars['Debriefing/DebriefingHeading'] ?? '')) : 0,
      inset: opts.inset?.() ?? null,
    }) : null;
    plate.compact = compact ? { mode: compact.mode, scale: compact.scale, width: compact.width, height: compact.height,
                                ox: compact.ox, oy: compact.oy } : null;
    if (compact) {
      ctx.setTransform(compact.scale * dpr, 0, 0, compact.scale * dpr, compact.ox * dpr, compact.oy * dpr);
      const art = data.elements.find(el => el.kind === 'picture' && el.texture && /debriefing/i.test(el.texture));
      const img = art ? res.texture(art.texture) : null;
      if (img) {
        // The art's own pixels a plate unit (it is drawn 512 to 512).
        const k = img.width / PLATE_ART.width;
        ctx.imageSmoothingEnabled = true;
        for (const { src, dst } of compact.slices) {
          ctx.drawImage(img, src[0] * k, src[1] * k, src[2] * k, src[3] * k, ...dst);
        }
      }
      paintLeaves(ctx, data, compact.leaves, vars, res);
      drawRows(ctx, compact.draws, box, vars);
      return;
    }
    const s = plateScale(W, H, data.virtual);
    ctx.setTransform(s.sx * dpr, 0, 0, s.sy * dpr, s.ox * dpr, s.oy * dpr);
    // The list box leaf is the rows' frame, drawn here rather than as the
    // board's list (whose columns and cells are the board's).
    const leaves = data.elements.filter(el => el.kind !== 'listbox');
    paintLeaves(ctx, data, leaves, vars, res);
    if (!box) return;
    drawRows(ctx, debriefingRowDraws(box, players), box, vars);
  }

  /** The rows' cells (`debriefingRowDraws` or the compact plate's). */
  function drawRows(ctx, draws, box, vars) {
    const meta = layout.fonts.get(box.font)?.meta;
    for (const d of draws) {
      if (d.kind === 'picture') {
        const img = d.var ? res.boundTexture(textureKey(vars[d.var])) : res.texture(d.texture);
        if (!img) continue;
        // A small icon drawn smaller than its own pixels (the compact
        // plate's number icons) is filtered, not dropped to every other row.
        ctx.imageSmoothingEnabled = !(img.width <= 16 && img.height <= 16) || d.rect[2] < img.width;
        ctx.drawImage(img, ...d.rect);
      } else {
        ctx.imageSmoothingEnabled = false;
        res.drawText(ctx, box.font, d.text, Math.round(d.x), Math.round(d.baseline - (meta?.baseline ?? 0)),
                     DEBRIEFING_LIST.color);
      }
    }
  }

  /** Paint `model` over the world. */
  function show(model) {
    plate.model = model;
    plate.shown = true;
    build();
    if (!root) return;
    root.hidden = false;
    const loaded = layout.data;
    loadLayout();
    // A layout that arrives after the end takes its own sample values
    // under the model's.
    if (!loaded && layout.loading) {
      layout.loading.then(() => {
        if (plate.model && layout.data) {
          plate.model.vars = { ...layout.data.variables, ...plate.model.vars };
          paint();
        }
      });
    }
    paint();
  }

  function hide() {
    plate.shown = false;
    if (root) root.hidden = true;
  }

  plate.show = show;
  plate.hide = hide;
  plate.paint = paint;
  plate.loadLayout = loadLayout;
  /** The layout's own variables, once it has landed (null before). */
  plate.variables = () => layout.data?.variables ?? null;
  plate.loaded = () => !!layout.data;
  plate.dispose = () => {
    hide();
    root?.remove();
    root = null;
    canvas = null;
  };
  return plate;
}

/**
 * Built once by the page. `page` hands in, as getters or functions:
 * `round` (the live `round-state.js` round, rebuilt per level), `extras`
 * (the level's `scene.json`), `stage` (the element to draw over),
 * `spriteUrl(rel)` (a HUD-pack path to a URL), `sprite(name)` (a loaded HUD
 * sprite, for the side flags), `localTeam()`, `players()` (the score
 * board's rows: `{ name, team, score, kills, deaths, ping, order }`),
 * `tickets()` (`ticket-feed.js` `ticketMemoFor`), `roomJoined`,
 * `playRoundMusic(kind)`, `stopRoundMusic()`, `releasePointer()`,
 * `clearWorld()`, the end game's first tick, and `restartRound()`, which
 * runs the page's `restartMap`. `campaign`, on a campaign mission, is
 * `campaign-debriefing.js`'s plate, shown in the multiplayer one's place.
 */
export function createRoundEnd(page) {
  const roundEnd = { shown: false, model: null, restarts: 0 };
  /** The round the screen opened for: a new level's round closes it. */
  let openedFor = null;
  const plate = createDebriefingPlate({
    id: 'round-end',
    stage: () => page.stage,
    spriteUrl: page.spriteUrl ? rel => page.spriteUrl(rel) : null,
    sprite: name => page.sprite?.(name) ?? null,
  });

  function open(round) {
    const result = debriefingOf({ winner: round.winner, victoryType: round.victoryType,
                                  localTeam: page.localTeam(),
                                  objective: round.gamePlayMode === GAME_PLAY_MODE.objective });
    const words = debriefingWords(result, page.extras?.briefing ?? null);
    // The rows are read before the end game's first tick empties the field
    // (`clearWorld`, ROUND-10); nothing scores after the end (ROUND-7).
    const everyone = page.players?.() ?? [];
    // The page's own round is the server, so it gives the medals too
    // (`giveMedal`, ROUND-9): the counters the score board's medal cells
    // show (MEME-25). A room's or a relay's are the server's.
    if (!page.roomJoined) {
      round.giveMedals?.(everyone.filter(p => p.key != null).map(p => ({ id: p.key, team: p.team })));
    }
    const players = bestPlayers(everyone);
    const vars = debriefingVars(plate.variables(), {
      title: words.title,
      tickets: page.tickets?.() ?? null,
      startingGame: page.roomJoined ? 2 : 3,
    });
    roundEnd.model = { result, words, players, vars, winner: round.winner, victoryType: round.victoryType,
                       reason: round.endReason, music: result?.music ?? null };
    page.clearWorld?.();
    roundEnd.shown = true;
    openedFor = round;
    // A campaign mission ends on the single-player plate instead, which
    // applies the campaign's score rule (campaign-debriefing.js).
    if (page.campaign) page.campaign.show(roundEnd.model, round);
    else plate.show(roundEnd.model);
    page.releasePointer?.();
    if (result?.music) page.playRoundMusic?.(result.music);
  }

  function close() {
    roundEnd.shown = false;
    openedFor = null;
    plate.hide();
    page.campaign?.hide();
    page.stopRoundMusic?.();
  }

  /**
   * One frame, after the round's own tick: open on the edge into EndGame and
   * run the restart when the multiplayer timer is out (`restartDue`). A level
   * change (a new round object) closes the screen.
   */
  roundEnd.tick = () => {
    const round = page.round;
    if (roundEnd.shown && openedFor && openedFor !== round) close();
    if (!round) return;
    if (!roundEnd.shown && round.status === 'endGame') open(round);
    if (!roundEnd.shown) return;
    // In a room the restart is the server's row, which turns the round back
    // to Playing; the screen waits for it rather than restarting here.
    if (round.restartDue() && !page.roomJoined) {
      roundEnd.restarts += 1;
      close();
      page.restartRound?.();
    } else if (round.status === 'playing') {
      if (page.roomJoined) roundEnd.restarts += 1;
      close();
    }
  };

  roundEnd.close = close;
  roundEnd.resize = plate.paint;
  roundEnd.loadLayout = plate.loadLayout;
  /** What the screen shows, for the test hooks. */
  roundEnd.state = () => {
    const m = roundEnd.model;
    return {
      shown: roundEnd.shown,
      restarts: roundEnd.restarts,
      title: m?.words.title ?? '',
      heading: m?.words.heading ?? '',
      tickets: m ? { axis: m.vars.AxisTicket, allied: m.vars.AlliedTicket,
                     axisFlag: m.vars.AxisTicketFlagLoad, alliedFlag: m.vars.AlliedTicketFlagLoad } : null,
      startingGame: m?.vars.StartingGame ?? null,
      players: m?.players ?? [],
      result: m?.result ?? null,
      music: m?.music ?? null,
      layout: plate.loaded(),
    };
  };
  return roundEnd;
}
