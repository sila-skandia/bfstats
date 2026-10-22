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
import { paintLeaves, textureKey } from './scoreboard.js';
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
 * side, by score, highest first. How `getPlayersSortedByScore` orders a tie
 * was not read; a tie keeps the order the players came in (`order`, the
 * board's roster order). Each player is `{ name, team, score, kills,
 * deaths, ping, order? }`; returns them with `rank` 1..3.
 */
export function bestPlayers(players = []) {
  const num = v => (Number.isFinite(v) ? v : 0);
  return (players ?? [])
    .filter(p => p && (p.team === 1 || p.team === 2))
    .map((p, i) => ({ ...p, order: Number.isFinite(p.order) ? p.order : i }))
    .sort((a, b) => num(b.score) - num(a.score) || a.order - b.order)
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

// --- the page ------------------------------------------------------------------

const STYLE = `
#round-end { position: absolute; inset: 0; pointer-events: none; z-index: 40; }
#round-end[hidden] { display: none; }
#round-end canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
`;

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
 * runs the page's `restartMap`.
 */
export function createRoundEnd(page) {
  const roundEnd = { shown: false, model: null, restarts: 0 };
  let root = null;
  let canvas = null;
  /** The round the screen opened for: a new level's round closes it. */
  let openedFor = null;
  const layout = { data: null, fonts: new Map(), textures: new Map(), loading: null };

  function build() {
    if (root || typeof document === 'undefined') return;
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);
    root = document.createElement('div');
    root.id = 'round-end';
    root.hidden = true;
    root.setAttribute('aria-live', 'polite');
    canvas = document.createElement('canvas');
    root.appendChild(canvas);
    (page.stage ?? document.body).appendChild(root);
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => paint()).observe(root);
  }

  /** `debriefing/debriefing-layout.json`, its faces and its plates, once. */
  function loadLayout() {
    if (layout.loading || typeof fetch === 'undefined' || !page.spriteUrl) return layout.loading;
    const url = rel => page.spriteUrl(`debriefing/${rel}`);
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
    texture: name => (name ? layout.textures.get(name) ?? page.sprite?.(name) ?? null : null),
    // A side flag is the HUD pack's art (the mod's own), as on the board.
    boundTexture: name => page.sprite?.(name) ?? layout.textures.get(name) ?? null,
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

  /** One paint of the plate and its rows, from the model `open` made. */
  function paint() {
    const data = layout.data;
    if (!roundEnd.shown || !canvas || !data || !roundEnd.model) return;
    const W = root.clientWidth || 800;
    const H = root.clientHeight || 600;
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 3);
    const cw = Math.round(W * dpr);
    const ch = Math.round(H * dpr);
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    const s = plateScale(W, H, data.virtual);
    ctx.setTransform(s.sx * dpr, 0, 0, s.sy * dpr, s.ox * dpr, s.oy * dpr);
    const { vars, players } = roundEnd.model;
    // The list box leaf is the rows' frame, drawn here rather than as the
    // board's list (whose columns and cells are the board's).
    const leaves = data.elements.filter(el => el.kind !== 'listbox');
    paintLeaves(ctx, data, leaves, vars, res);
    const box = data.elements.find(el => el.kind === 'listbox' && el.data === 'Debriefing/DebriefingList');
    if (!box) return;
    const meta = layout.fonts.get(box.font)?.meta;
    for (const d of debriefingRowDraws(box, players)) {
      if (d.kind === 'picture') {
        const img = d.var ? res.boundTexture(textureKey(vars[d.var])) : res.texture(d.texture);
        if (!img) continue;
        ctx.imageSmoothingEnabled = !(img.width <= 16 && img.height <= 16);
        ctx.drawImage(img, ...d.rect);
      } else {
        ctx.imageSmoothingEnabled = false;
        res.drawText(ctx, box.font, d.text, Math.round(d.x), Math.round(d.baseline - (meta?.baseline ?? 0)),
                     DEBRIEFING_LIST.color);
      }
    }
  }

  function open(round) {
    const result = debriefingOf({ winner: round.winner, victoryType: round.victoryType,
                                  localTeam: page.localTeam(),
                                  objective: round.gamePlayMode === GAME_PLAY_MODE.objective });
    const words = debriefingWords(result, page.extras?.briefing ?? null);
    // The rows are read before the end game's first tick empties the field
    // (`clearWorld`, ROUND-10); nothing scores after the end (ROUND-7).
    const players = bestPlayers(page.players?.() ?? []);
    const vars = debriefingVars(layout.data?.variables, {
      title: words.title,
      tickets: page.tickets?.() ?? null,
      startingGame: page.roomJoined ? 2 : 3,
    });
    roundEnd.model = { result, words, players, vars, winner: round.winner, victoryType: round.victoryType,
                       reason: round.endReason, music: result?.music ?? null };
    page.clearWorld?.();
    roundEnd.shown = true;
    openedFor = round;
    build();
    if (root) {
      root.hidden = false;
      const loaded = layout.data;
      loadLayout();
      // A layout that arrives after the end takes its own sample values
      // under the model's.
      if (!loaded && layout.loading) {
        layout.loading.then(() => {
          if (roundEnd.model && layout.data) {
            roundEnd.model.vars = { ...layout.data.variables, ...roundEnd.model.vars };
            paint();
          }
        });
      }
      paint();
    }
    page.releasePointer?.();
    if (result?.music) page.playRoundMusic?.(result.music);
  }

  function close() {
    roundEnd.shown = false;
    openedFor = null;
    if (root) root.hidden = true;
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
  roundEnd.resize = paint;
  roundEnd.loadLayout = loadLayout;
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
      layout: !!layout.data,
    };
  };
  return roundEnd;
}
