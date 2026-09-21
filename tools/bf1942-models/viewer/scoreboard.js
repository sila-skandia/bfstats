/* The in-game score board: what it is fed, and where its rows go.
 *
 * The board itself is data — `scoreboard/scoreboard-layout.json`, the
 * `Scoreboard/SpawnScoreBoard` group of `menu/InGame` flattened by
 * `extract_scoreboard_layout.py` — and `map.html` paints it leaf by leaf the
 * way it paints the spawn screen. What the file does not hold is what the
 * engine writes at runtime: the variable table and the two list boxes' rows.
 * This module is that half, free of `three` and of the DOM so
 * `tests/scoreboard_harness.mjs` drives the real thing under node.
 *
 * FED WITH WHAT THE PAGE HAS, NEVER WITH INVENTED PLAYERS. A row is the local
 * player or a player the room server put in the roster. Kills and deaths are
 * tallied from the room's own `killed` events (`slot` died, `other` killed
 * him); a page with no room has no such events and reads zero. Score and ping
 * are not tracked anywhere in this viewer and are always zero.
 *
 * THE LIST BOX, as far as it was read out of the client (BF1942.exe, sha256
 * 60c9452d...cd3699):
 *   - columns: the ints passed to `addColumn` `FUN_007d4240` for both score
 *     lists (0x006dfa75..0x006dfb13, 0x006dfb33..0x006dfbd1), carried in the
 *     layout as `listColumns`. Which column shows what is matched from the
 *     heading strip's icons, not read from the row-fill code.
 *   - a cell's text starts at the box's left edge + 10 + the column's int
 *     (`local_dbc = left + 10.0`, list box draw 0x007d1390).
 *   - the first row's top is the box's top + 2 x 12: the node's +0x18 is 12.0
 *     (ctor 0x007d1222) and the draw starts at `top + [+0x18] + [+0x18]`.
 *     Each row then advances by the file's own "Row height" (18), and the
 *     text is set from the row's BOTTOM edge up by the glyph metric the font
 *     call returns — taken here as the face's line height.
 *   NOT read: how many rows the engine shows (the list data's +0x28), the
 *   rows' text colour, the sort order, and any highlight of the local
 *   player. `ROW_LIMIT_NOTE` below says what stands in for each.
 */

/** The list box node's +0x18, doubled, is the first row's offset from the
 *  box's top (ctor 0x007d1222 stores 12.0; draw 0x007d1390 adds it twice). */
export const LIST_TOP_INSET = 24;

/** What stands in where the engine was not read. Rows are limited to the ones
 *  that end above the panel's lower olive strip (the next thing the file draws
 *  under the list); text is the leaf's own colour multiplier, white; rows sort
 *  by score, then kills, then fewest deaths, then roster order. */
export const ROW_LIMIT_NOTE = 'viewer choice: row count, text colour, sort';

/** Kills and deaths per slot from the room's event feed. A `killed` row names
 *  the victim in `slot` and the killer in `other` (null for a death nobody
 *  caused); a kill of oneself counts as a death only. */
export function tallyFeed(feed) {
  const tally = new Map();
  const at = slot => {
    let row = tally.get(slot);
    if (!row) { row = { kills: 0, deaths: 0 }; tally.set(slot, row); }
    return row;
  };
  for (const ev of feed || []) {
    if (!ev || ev.type !== 'killed') continue;
    if (ev.slot != null) at(ev.slot).deaths += 1;
    if (ev.other != null && ev.other !== ev.slot) at(ev.other).kills += 1;
  }
  return tally;
}

/** The two teams' rows. `players` is every real player the page knows:
 *  `{ slot, name, team, local }`, team 1 Axis and 2 Allied; anyone on neither
 *  side (a roster row whose team has not arrived yet) is on no list. */
export function boardRows(players, feed) {
  const tally = tallyFeed(feed);
  const rows = { 1: [], 2: [] };
  (players || []).forEach((p, order) => {
    if (p.team !== 1 && p.team !== 2) return;
    const t = (p.slot != null && tally.get(p.slot)) || { kills: 0, deaths: 0 };
    rows[p.team].push({
      slot: p.slot ?? null,
      name: String(p.name ?? ''),
      local: !!p.local,
      score: 0,
      kills: t.kills,
      deaths: t.deaths,
      ping: 0,
      order,
    });
  });
  const cmp = (a, b) => b.score - a.score || b.kills - a.kills
    || a.deaths - b.deaths || a.order - b.order;
  rows[1].sort(cmp);
  rows[2].sort(cmp);
  return rows;
}

const sum = (rows, key) => rows.reduce((n, r) => n + r[key], 0);

/** The variable table the board's leaves and conditions read: the layout's
 *  own sample values under what this page actually knows.
 *
 *  `state`: { fromSpawn, inRoom, alive, serverName, serverIp, mapName,
 *             axisFlag, alliedFlag, rows, visibleRows }.
 *  Everything a lone viewer cannot do is off: no remote admin, no buddy list,
 *  no votes (so the four buttons draw in the file's own disabled 0.5 alpha in
 *  a room, and not at all in single player, where the file culls them). */
export function boardVars(layoutVars, state) {
  const rows = state.rows || { 1: [], 2: [] };
  const visible = state.visibleRows ?? Infinity;
  const vars = { ...(layoutVars || {}) };
  vars['Scoreboard/SpawnScoreBoard'] = true;
  vars['Scoreboard/FromSpawnScoreboard'] = !!state.fromSpawn;
  vars['Scoreboard/GameStatusEndGame'] = false;
  vars['Scoreboard/GameStatusSinglePlayer'] = !state.inRoom;
  vars['Scoreboard/RemoteAdmin'] = false;
  vars['Scoreboard/EnableAddBuddy'] = false;
  vars['Scoreboard/EnableRemBuddy'] = false;
  vars['Scoreboard/EnableVoteKick'] = false;
  vars['Scoreboard/EnableVoteKickTeam'] = false;
  vars['Kit/IsAlive'] = !!state.alive;
  vars['Scoreboard/ShowScrollBarAxis'] = rows[1].length > visible;
  vars['Scoreboard/ShowScrollBarAllied'] = rows[2].length > visible;
  // Rounds won: this page plays one round and never ends it.
  vars['Scoreboard/AxisRoundWon'] = 0;
  vars['Scoreboard/AlliedRoundWon'] = 0;
  for (const [team, side] of [[1, 'Axis'], [2, 'Allied']]) {
    vars[`Scoreboard/${side}PlayerTotal`] = rows[team].length;
    vars[`Scoreboard/${side}ScoreTotal`] = sum(rows[team], 'score');
    vars[`Scoreboard/${side}KillsTotal`] = sum(rows[team], 'kills');
    vars[`Scoreboard/${side}DeathsTotal`] = sum(rows[team], 'deaths');
    vars[`Scoreboard/${side}PingTotal`] = sum(rows[team], 'ping');
  }
  vars['Scoreboard/ServerName'] = state.serverName ?? '';
  vars['Scoreboard/ServerIp'] = state.serverIp ?? '';
  vars['Scoreboard/MapName'] = state.mapName ?? '';
  if (state.axisFlag) vars.AxisTicketFlag = state.axisFlag;
  if (state.alliedFlag) vars.AlliedTicketFlag = state.alliedFlag;
  return vars;
}

/** Where a list box's rows and cells go, in the layout's virtual units.
 *
 *  `box` is the layout's `listbox` leaf, `columns` its `listColumns`,
 *  `lineHeight` the face's, `floor` the y the rows must end above (the top of
 *  the olive strip under the list; see `ROW_LIMIT_NOTE`). Returns
 *  `{ visibleRows, cells(rowIndex, row) }`, each cell `{ x, y, text }` with
 *  `y` the text line's top. */
export function listGeometry(box, columns, lineHeight, floor) {
  const [bx, by, , bh] = box.rect;
  const pitch = box.rowHeight;
  const top = by + LIST_TOP_INSET;
  const limit = Math.min(floor ?? Infinity, by + bh);
  const visibleRows = Math.max(0, Math.floor((limit - top) / pitch));
  const inset = columns.textInset;
  const named = columns.columns.filter(c => c.field);
  return {
    top,
    pitch,
    visibleRows,
    cells(index, row) {
      const bottom = top + (index + 1) * pitch;
      const y = bottom - lineHeight;
      const out = [];
      for (const col of named) {
        const value = col.field === 'id' ? row.slot : row[col.field];
        if (value == null || value === '') continue;
        out.push({ field: col.field, x: bx + inset + col.x, y, text: String(value) });
      }
      return out;
    },
  };
}

/** A name cut to what fits before the next column, glyph by glyph, with no
 *  ellipsis — a bitmap face has none to give. `measure(text)` is the face's
 *  own advance. */
export function fitText(text, maxWidth, measure) {
  let out = String(text);
  while (out && measure(out) > maxWidth) out = out.slice(0, -1);
  return out;
}

// --- painting -----------------------------------------------------------------

/** Is a leaf's every `when` condition true under `vars`? The same evaluator
 *  `map.html` and `hud.js` run, including the `gt`/`ge` the extractor's operand
 *  flip can produce. */
export function condOk(c, vars) {
  if (c.op === 'and') return c.terms.every(t => condOk(t, vars));
  if (c.op === 'or') return c.terms.some(t => condOk(t, vars));
  const v = vars[c.var];
  const want = (c.value && typeof c.value === 'object') ? vars[c.value.var] : c.value;
  const same = v === want || Number(v) === Number(want);
  switch (c.op) {
    case 'eq': return same;
    case 'ne': return !same;
    case 'lt': return Number(v) < Number(want);
    case 'le': return Number(v) <= Number(want);
    case 'gt': return Number(v) > Number(want);
    case 'ge': return Number(v) >= Number(want);
    default: return true;
  }
}

/** Does this leaf draw at all? Its conditions, and the one effect the board
 *  adds: an `AlphaFadeEffect` at level 0 (`fade: 0`) is taken as fully faded.
 *  That reading is INFERRED, not read out of the client: the two leaves that
 *  carry it are the KICK and BAN plates a non-admin gets, and the BAN one sits
 *  on exactly the rect of ADD BUDDY, so drawn it would cover a live button. */
export function leafVisible(el, vars) {
  if (el.fade === 0) return false;
  return (el.when || []).every(c => condOk(c, vars));
}

/** A texture name as the pack spells it: a bound picture variable holds the
 *  game's own path (`flag_ticket_us.tga`), the pack the lower-cased stem. */
export function textureKey(name) {
  const base = String(name || '').slice(String(name || '').lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return (dot > 0 ? base.slice(0, dot) : base).toLowerCase();
}

/** The string a text leaf shows: a bound variable's live value, else the
 *  leaf's own resolved text. */
export function leafText(el, vars) {
  if (el.var && vars[el.var] != null) return String(vars[el.var]);
  return el.text || '';
}

/**
 * Paint a flat draw list onto a 2D context already scaled to the layout's
 * virtual units. `res` is the page's end of it:
 *   texture(name)                      -> a drawable with width/height, or null
 *   measure(fontId, text)              -> the face's advance, virtual units
 *   drawText(ctx, fontId, text, x, y, rgb)
 *   lineHeight(fontId)                 -> the face's line height
 *   hover(el)                          -> true when the pointer is over a button
 * `rows` maps a list box's `data` name to its rows; `floor(box)` is the y its
 * rows must end above. Returns the visible-row count per list, for the caller's
 * scroll-bar variables.
 */
export function paintLeaves(ctx, layout, elements, vars, res, rows = {}) {
  const visible = {};
  for (const el of elements) {
    if (!leafVisible(el, vars)) continue;
    const [x, y, w, h] = el.rect;
    const color = el.color || [1, 1, 1, 1];
    ctx.globalAlpha = color[3];
    switch (el.kind) {
      case 'fill':
        ctx.fillStyle = `rgb(${color.slice(0, 3).map(v => Math.round(v * 255)).join(',')})`;
        ctx.fillRect(x, y, w, h);
        break;
      case 'picture': {
        const live = el.var ? vars[el.var] : null;
        const img = res.texture(typeof live === 'string' && live ? textureKey(live) : el.texture);
        if (!img) break;
        ctx.imageSmoothingEnabled = !(img.width <= 16 && img.height <= 16);
        ctx.drawImage(img, x, y, w, h);
        break;
      }
      case 'button': {
        // Drawn at the texture's own size; Width/Height is the pointer
        // region (MEME-7).
        const img = res.texture(res.hover?.(el) && el.hover ? el.hover : el.texture);
        if (!img) break;
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(img, x, y, img.width, img.height);
        break;
      }
      case 'text': {
        const text = leafText(el, vars);
        const width = res.measure(el.font, text);
        const tx = el.align === 'center' ? x + (w - width) / 2
          : el.align === 'right' ? x + w - width : x;
        ctx.imageSmoothingEnabled = false;
        res.drawText(ctx, el.font, text, Math.round(tx), y, color.slice(0, 3));
        break;
      }
      case 'listbox': {
        const list = rows[el.data] || [];
        const geo = listGeometry(el, layout.listColumns, res.lineHeight(el.font),
                                 res.floor?.(el));
        visible[el.data] = geo.visibleRows;
        const cols = layout.listColumns.columns;
        ctx.imageSmoothingEnabled = false;
        list.slice(0, geo.visibleRows).forEach((row, index) => {
          for (const cell of geo.cells(index, row)) {
            let text = cell.text;
            if (cell.field === 'name') {
              // Cut at the next column so a long name cannot run under the
              // score.
              const at = cols.findIndex(c => c.field === 'name');
              const room = cols[at + 1] ? cols[at + 1].x - cols[at].x - 2 : Infinity;
              text = fitText(text, room, t => res.measure(el.font, t));
            }
            res.drawText(ctx, el.font, text, Math.round(cell.x), Math.round(cell.y),
                         color.slice(0, 3));
          }
        });
        break;
      }
      default:
        break;
    }
  }
  ctx.globalAlpha = 1;
  return visible;
}

/** The y a panel's list must end above: the top of the first `fill` leaf that
 *  starts below the list's first row and overlaps the box horizontally — the
 *  lower olive strip. Null when the file has none. */
export function listFloor(elements, box) {
  const [bx, by, bw] = box.rect;
  let best = null;
  for (const el of elements) {
    if (el.kind !== 'fill') continue;
    const [x, y, w] = el.rect;
    if (y <= by + LIST_TOP_INSET + box.rowHeight) continue;
    if (x + w <= bx || x >= bx + bw) continue;
    if (w < bw / 2) continue;          // the scroll track is a fill too
    if (best == null || y < best) best = y;
  }
  return best;
}
