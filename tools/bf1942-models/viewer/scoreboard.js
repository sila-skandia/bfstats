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
 * player or a player the room server put in the roster. On the sidecar (a
 * retail server) every row's score, kills, deaths and ping are the server's
 * own BFPlayer stats, which is what the retail board prints (`stats`, from
 * `net-sidecar.js` statsOf; `sidecar/ghost/player.mjs` THE STAT BLOCK). In
 * the page's own room, kills and deaths are tallied from the room's `killed`
 * events (`slot` died, `other` killed him) and a room carries no score or
 * ping; offline, the round's own tally (`round-state.js`) has them.
 *
 * THE LIST BOX, as the client draws it (BF1942.exe, sha256 60c9452d...cd3699;
 * ledger MEME-21 for any list box, MEME-25 for what the board's row fill
 * `FUN_006e0380` puts in one):
 *   - columns: the ints passed to `addColumn` `FUN_007d4240` for both score
 *     lists (0x006dfa75..0x006dfb13, 0x006dfb33..0x006dfbd1), carried in the
 *     layout as `listColumns`. The row fill writes the kit glyph to column 0,
 *     the name to 1 and score, kills, deaths and ping to 3..6, which is what
 *     the heading strip's icons say too.
 *   - the rows: the first row's text baseline is the box's top + 2 row
 *     heights, each row one row height lower, and a row is drawn while its
 *     baseline is within the box's bottom less a row (`FUN_007d1390`). The
 *     row height is the file's own "Row height" (18), which the node's reader
 *     stores at +0x18 (0x007cffc7); the constructor's 12.0 there (0x007d1222)
 *     never reaches the draw. A 420-high board list draws 21 rows.
 *   - a text cell's pen starts at the box's left + 10 + its column's x, and
 *     it keeps glyphs until the advance passes the span to the next column
 *     less 20, the glyph that crosses included.
 *   - the kit glyph is a texture cell the row fill pushes as 16 x 16 at x 0,
 *     y 11: drawn at box left + 10 + 0, its top 11 above the baseline. The
 *     glyph is the `Debriefing/classes` 16x16 set the layout carries as
 *     `rowIcons`: the class icon for a live player, in the human or the bot
 *     colour, and the skull while he is dead.
 *   - the local player's row has a band under it, box left + 10 to the
 *     box's right less 10, from 11 above the baseline, 16 high, black at half
 *     alpha (a buddy's row is a blue at half alpha; the viewer has no buddy
 *     list).
 *   - column 7 (the `#` heading) is `<id>`, the player's id, for a human in
 *     a multiplayer game and empty for a bot or in single player (`idText`).
 *   - columns 11..13 are three 8 x 8 medal cells at x 340, 350, 360, 6 above
 *     the baseline: the player's best three medals by his counters, gold
 *     first, `empty_8x8` past them (`medalKinds`, the layout's `rowMedals`).
 *   Checked against a retail capture (Bocage, `leaderboard.webp` in the main
 *   checkout, 2.4 x 1.8 px per unit): the first kit glyph's square is at
 *   (15.0, 90.0), 16 x 16, rows 18 apart, and the local row's band runs
 *   414..785 x 252..268 on the Allied list.
 *   NOT read: how many rows the list data holds (+0x28), the sort order and
 *   the rows' text colour. `ROW_LIMIT_NOTE` below says what stands in.
 */

/** A list box's first row's text baseline is this many row heights below the
 *  box's top, and every row after it one row height lower (MEME-21). */
export const LIST_FIRST_BASELINE = 2;

/** The kit glyph's texture cell as the board's row fill pushes it
 *  (`0x007d4cf0`, column 0, at 0x006e0883..0x006e08b8): w, h, x, y. MEME-21
 *  draws a texture cell at box left + 10 + its own x, its top its own y
 *  above the row's baseline, at its own w x h. */
export const KIT_CELL = { w: 16, h: 16, x: 0, y: 11 };

/** The three medal cells the row fill pushes to columns 11, 12 and 13
 *  (0x006e0ad0..0x006e0c3f), each 8 x 8 at its own x, 6 above the baseline,
 *  placed the way `KIT_CELL` is. */
export const MEDAL_CELLS = [340, 350, 360].map(x => ({ w: 8, h: 8, x, y: 6 }));

/** What the three medal cells show for a player's medal counters `[gold,
 *  silver, bronze]` (the client's player +0x11c, +0x120, +0x124: the server's
 *  BFPlayer +0xe8, +0xec, +0xf0, ghosted): cell k (1..3) is gold while he has
 *  at least k golds, else silver while golds and silvers reach k, else bronze
 *  while all three reach k, else empty (the row fill's three tests). So his
 *  best three medals, best first. Null when the page does not know his
 *  counters: no cells are drawn then. */
export function medalKinds(medals) {
  if (!Array.isArray(medals)) return null;
  const [g, s, b] = [0, 1, 2].map(i => (Number.isFinite(medals[i]) ? medals[i] : 0));
  return [1, 2, 3].map(k => (g >= k ? 'gold' : g + s >= k ? 'silver' : g + s + b >= k ? 'bronze' : 'empty'));
}

/** `BfMenu+0x6dc` (`StartingGame`) values for which `0x0045d050` is true: the
 *  single-player games. The `#` column is empty in them. */
export const SINGLE_PLAYER_GAMES = [0, 1, 4];

/** Column 7's text (0x006e09cf..0x006e0a41): `<%d>` (0x009250cc) of the
 *  player's id for a human in a multiplayer game (`StartingGame` 2 or 3),
 *  else empty; a bot's is always empty. `serverId` is the id the server
 *  knows the player by, null when the page has none, and then the cell is
 *  empty too. */
export function idText({ serverId = null, bot = false } = {}, startingGame = 2) {
  if (bot || SINGLE_PLAYER_GAMES.includes(startingGame)) return '';
  return Number.isInteger(serverId) ? `<${serverId}>` : '';
}

/** The band a row is painted on: `0x007d0c60(row, rgba, 10, -11, 16, -20)`
 *  from the row fill (0x006e0c80..0x006e0d00), which the list draw puts at
 *  box left + x, baseline + y, box width + w wide and h high, before the
 *  row's cells (0x007d1c06..). */
export const ROW_BAND = { x: 10, y: -11, w: -20, h: 16 };

/** The band's colour, rgba as the row fill pushes it: the local player's own
 *  row, a buddy's, and the player the board has selected (painted over the
 *  first). Any other row's band is clear. The viewer has no buddy list and no
 *  board selection, so only `local` is ever painted. */
export const ROW_BAND_COLORS = {
  local: [0, 0, 0, 0.5],
  buddy: [0.0390625, 0.24609379470348358, 0.34375, 0.5],
  selected: [0, 0.1875, 0.5389999747276306, 0.800000011920929],
};

/** What stands in where the engine was not read: rows sort by score, then
 *  kills, then fewest deaths, then roster order. A row's colour is not a
 *  choice: see `rowColor`. */
export const ROW_LIMIT_NOTE = 'viewer choice: sort';

/** The board's own per-team row colours, at the values a retail capture shows,
 *  plus the local player's own green. The engine paints a row's name and its
 *  numbers itself and no con it ships carries the pair: `Menu.con`'s
 *  `Game.setAxisRadioColor` and `Game.setAlliedRadioColor` are the chat and
 *  radio text colours, a wider red on the Axis and a blue the board's Allies
 *  never are. A 2556x1441 capture of the stock game measures the name ink
 *  cores at (214,84,84) and (84,174,215), so those rounded are what our own
 *  renderer needs to land on the same screen colour (it draws a glyph at full
 *  coverage where the capture has the panel showing through). The values also
 *  stand in for a board pack extracted before the colours were recorded in it.
 *  Retailed source and the negative results behind it:
 *  `extract_scoreboard_layout.py`'s `BOARD_ROW_COLORS`. */
export const ROW_COLORS = { axis: [0.84, 0.33, 0.33], allies: [0.33, 0.67, 0.83], buddy: [0, 1, 0] };

/** The dim a dead player's row is drawn at, for the whole row and its numbers.
 *  Retail's dead rows measure 0.49 to 0.60 of a live row per channel (the
 *  Allied panel of a 2556x1441 capture: (84,174,215) live against (41,98,127)
 *  dead), so the side's own colour, dimmed by this. */
export const DEAD_ROW_DIM = 0.55;

/** The five classes a row's `kit` may name, as the layout's `rowIcons` key
 *  them; anything else (a mod's `Rocket pack`, an unknown kit) draws nothing. */
export const KIT_CLASSES = ['scout', 'assault', 'antitank', 'medic', 'engineer'];

/** The `class` label `_shared/loadouts.json` gives a kit (`bf42/kit.py`'s
 *  TYPE_LABELS: `Anti-tank`, `Assault`, ...) or the viewer's own row key
 *  (`antitank`, `at`) as a `KIT_CLASSES` entry, or null when it is neither —
 *  never a guess, so an unknown kit gets no icon rather than a wrong one. */
export function kitClassKey(label) {
  if (typeof label !== 'string' || !label) return null;
  const key = label.toLowerCase().replace(/[^a-z]/g, '');
  if (key === 'at') return 'antitank';
  return KIT_CLASSES.includes(key) ? key : null;
}

/** The glyph a row draws in its first column: the skull while the player is
 *  dead, else his class icon, each in the human or the bot colour; null when
 *  the layout has no `rowIcons` or the row's kit is unknown. */
export function rowIcon(row, icons) {
  if (!icons || !row) return null;
  if (row.dead) return (row.bot ? icons.botDead : icons.dead) || null;
  const set = row.bot ? icons.bot : icons.human;
  return (row.kit && set && set[row.kit]) || null;
}

/** The colour a row's text is drawn in. A row takes its side's colour, and the
 *  local player's own row takes the buddy green (retail draws it that way; the
 *  capture's ink core for it is #01f301, which is the pure green at the face's
 *  own coverage). A row on neither side returns null, and the leaf's own
 *  colour stands. `colors` is the board layout's table when the pack has one,
 *  and any entry in it may be null. */
export function rowColor(row, colors) {
  if (!row) return null;
  const c = colors || {};
  const pick = (key, fallback) =>
    (Array.isArray(c[key]) && c[key].length >= 3 ? c[key] : fallback);
  if (row.local) return pick('buddy', ROW_COLORS.buddy);
  if (row.team === 1) return pick('axis', ROW_COLORS.axis);
  if (row.team === 2) return pick('allies', ROW_COLORS.allies);
  return null;
}

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
 *  `{ slot, name, team, local, kit, bot, dead }` plus `id` for the ones the
 *  page simulates (`round-state.js`'s player id: the local player, or a bot),
 *  team 1 Axis and 2 Allied; anyone on neither side (a roster row whose team
 *  has not arrived yet) is on no list. `kit` is the player's class as
 *  `kitClassKey` spells it (null when the page does not know it: a room's
 *  roster carries none), `bot` marks the viewer's own bots, `dead` a player
 *  currently down.
 *
 *  `feed` is a room's event feed and `tally` the round's own counts
 *  (`round-state.js` `counts`, a Map by player id, or null in a room). A row
 *  carrying `stats` (`{ score, kills, deaths, ping }`, a retail server's own
 *  counters through the sidecar) takes all four from them, the local player's
 *  as much as anyone's. Otherwise a row with a room slot takes its kills and
 *  deaths from the feed, which is the server's word; a row without one takes
 *  all three numbers from the tally. A player nothing tracked shows zeroes,
 *  and the round's `score` is the layout's own column, not a viewer
 *  invention.
 *
 *  A player may also carry `serverId`, the id his server knows him by (the
 *  retail server's player id through the sidecar, the room's slot in the
 *  page's own room), which column 7 prints as `<n>` (`idText`, by
 *  `startingGame`), and `medals`, his `[gold, silver, bronze]` counters (a
 *  sidecar row's `stats.medals`, the round's own offline), which the medal
 *  cells show (`medalKinds`). A row without counters draws no medal cells. */
export function boardRows(players, feed, tally = null, { startingGame = 2 } = {}) {
  const feedTally = tallyFeed(feed);
  const rows = { 1: [], 2: [] };
  (players || []).forEach((p, order) => {
    if (p.team !== 1 && p.team !== 2) return;
    // Where a row's numbers come from. A player the page simulates (the local
    // one, or a bot: no room slot) has the round's own tally behind him
    // (`round-state.js`), which is where his score lives; a room player's are
    // the server's `killed` rows, and a room carries no score at all.
    const server = p.stats && typeof p.stats === 'object' ? p.stats : null;
    const own = !server && p.slot == null && p.id != null ? tally?.get?.(p.id) ?? null : null;
    const t = server ?? own ?? (p.slot != null ? feedTally.get(p.slot) : null) ?? { kills: 0, deaths: 0 };
    const num = v => (Number.isFinite(v) ? v : 0);
    rows[p.team].push({
      slot: p.slot ?? null,
      name: String(p.name ?? ''),
      team: p.team,
      local: !!p.local,
      kit: kitClassKey(p.kit),
      bot: !!p.bot,
      dead: !!p.dead,
      score: num((server ?? own)?.score),
      kills: num(t.kills),
      deaths: num(t.deaths),
      ping: num(server?.ping),
      idText: idText(p, startingGame),
      medals: Array.isArray(p.medals) ? p.medals.slice(0, 3)
        : Array.isArray(server?.medals) ? server.medals.slice(0, 3) : null,
      key: p.id ?? null,
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
 *             axisFlag, alliedFlag, rows, visibleRows, endGame, roundsWon }.
 *  Everything a lone viewer cannot do is off: no remote admin, no buddy list,
 *  no votes (so the four buttons draw in the file's own disabled 0.5 alpha in
 *  a room, and not at all in single player, where the file culls them). */
export function boardVars(layoutVars, state) {
  const rows = state.rows || { 1: [], 2: [] };
  const visible = state.visibleRows ?? Infinity;
  const vars = { ...(layoutVars || {}) };
  vars['Scoreboard/SpawnScoreBoard'] = true;
  vars['Scoreboard/FromSpawnScoreboard'] = !!state.fromSpawn;
  // The round is over (`Game+0x58` 2, ledger ROUND-1): the file culls the
  // button frame and every button under it, so the board stands alone.
  vars['Scoreboard/GameStatusEndGame'] = !!state.endGame;
  vars['Scoreboard/GameStatusSinglePlayer'] = !state.inRoom;
  vars['Scoreboard/RemoteAdmin'] = false;
  vars['Scoreboard/EnableAddBuddy'] = false;
  vars['Scoreboard/EnableRemBuddy'] = false;
  vars['Scoreboard/EnableVoteKick'] = false;
  vars['Scoreboard/EnableVoteKickTeam'] = false;
  vars['Kit/IsAlive'] = !!state.alive;
  vars['Scoreboard/ShowScrollBarAxis'] = rows[1].length > visible;
  vars['Scoreboard/ShowScrollBarAllied'] = rows[2].length > visible;
  // Rounds won on this level: `setWinner`'s count per side, which a restart
  // keeps (`round-state.js` `roundsWon`, ledger ROUND-5). Zero in a room,
  // whose round is the server's.
  vars['Scoreboard/AxisRoundWon'] = Number(state.roundsWon?.[1]) || 0;
  vars['Scoreboard/AlliedRoundWon'] = Number(state.roundsWon?.[2]) || 0;
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

/** Where a list box's rows and cells go, in the layout's virtual units, as
 *  `FUN_007d1390` puts them (MEME-21).
 *
 *  `box` is the layout's `listbox` leaf, `columns` its `listColumns`,
 *  `fontBaseline` how far the face's baseline sits below the top of its line
 *  (the glyph json's `baseline`), which turns a row's baseline into the line
 *  top the bitmap-text painter takes. Row `i`'s baseline is the box's top +
 *  (2 + i) row heights, and a row is drawn while its baseline is within the
 *  box's bottom less a row, which is `visibleRows`; there is no other floor.
 *  `cells(i, row)` gives each text cell `{ field, x, y, baseline, clip, text }`
 *  with `y` the line's top and `clip` the advance past which the cell draws
 *  no further glyph (the span to the next column, less 20). `icon(i)` is the
 *  kit glyph's texture cell `{ x, y, w, h }` (`KIT_CELL`: its own x past the
 *  text inset, its top its own y above the baseline), `medals(i)` the three
 *  medal cells placed the same way (`MEDAL_CELLS`), and `band(i)` the row's
 *  band (`ROW_BAND`). Column 7 (`id`) prints the row's `idText`. */
export function listGeometry(box, columns, fontBaseline = 0) {
  const [bx, by, bw, bh] = box.rect;
  const pitch = box.rowHeight;
  const left = bx + columns.textInset;
  const first = by + LIST_FIRST_BASELINE * pitch;
  const last = by + bh - pitch;
  const visibleRows = pitch > 0 && first <= last
    ? Math.floor((last - first) / pitch + 1e-9) + 1 : 0;
  const baseline = index => first + index * pitch;
  const cols = columns.columns;
  return {
    first,
    pitch,
    visibleRows,
    baseline,
    icon(index) {
      const c = KIT_CELL;
      return { x: left + c.x, y: baseline(index) - c.y, w: c.w, h: c.h };
    },
    band(index) {
      return { x: bx + ROW_BAND.x, y: baseline(index) + ROW_BAND.y,
               w: bw + ROW_BAND.w, h: ROW_BAND.h };
    },
    medals(index) {
      return MEDAL_CELLS.map(c => ({ x: left + c.x, y: baseline(index) - c.y, w: c.w, h: c.h }));
    },
    cells(index, row) {
      const line = baseline(index);
      const out = [];
      cols.forEach((col, at) => {
        if (!col.field || col.field === 'icon') return;
        const value = col.field === 'id' ? row.idText : row[col.field];
        if (value == null || value === '') return;
        // The last column's span runs to the list's own width, which no board
        // cell reaches; it is left uncut.
        const next = cols[at + 1];
        out.push({ field: col.field, x: left + col.x, y: line - fontBaseline, baseline: line,
                   clip: next ? next.x - col.x - 20 : Infinity, text: String(value) });
      });
      return out;
    },
  };
}

/** A cell's text as the list draw cuts it: glyph by glyph until the advance
 *  passes `limit`, the glyph that crosses it kept, no ellipsis (MEME-21).
 *  `measure(text)` is the face's own advance. */
export function clipText(text, limit, measure) {
  const str = String(text);
  for (let n = 1; n <= str.length; n += 1) {
    if (measure(str.slice(0, n)) > limit) return str.slice(0, n);
  }
  return str;
}

/** The band colour a row is painted on, rgba, or null for a clear one. */
export function rowBand(row) {
  if (!row) return null;
  if (row.local) return ROW_BAND_COLORS.local;
  if (row.buddy) return ROW_BAND_COLORS.buddy;
  return null;
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
 *   boundTexture(name)                 -> the same for a bound picture's live
 *                                         value (optional; `texture` if absent)
 *   measure(fontId, text)              -> the face's advance, virtual units
 *   drawText(ctx, fontId, text, x, y, rgb)
 *   baseline(fontId)                   -> the face's baseline below its line top
 *   hover(el)                          -> true when the pointer is over a button
 *   rowColor(row)                      -> the row's own text colour, or null
 * `rows` maps a list box's `data` name to its rows, placed by `listGeometry`.
 * A row's band (`rowBand`) goes down first, then its kit glyph, then its
 * text, the order the list draw paints them. The glyph is `layout.rowIcons`
 * resolved by `rowIcon` and fetched through `texture` like any plate; one the
 * page has not loaded (or a row with no known kit) leaves the column empty. A
 * row's text is drawn in its side's colour (`rowColor`), dimmed while the
 * player is down.
 * Returns the visible-row count per list, for the caller's scroll-bar
 * variables.
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
        // A bound picture shows the live value's art, which is the page's (the
        // side's ticket flag), so `boundTexture` resolves it when the caller
        // has one: the board's own copy of `flag_ticket_ger` is whatever the
        // layout's literal default happened to be, not the mod's.
        const bound = typeof live === 'string' && live;
        const img = bound
          ? (res.boundTexture || res.texture)(textureKey(live))
          : res.texture(el.texture);
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
        const geo = listGeometry(el, layout.listColumns, res.baseline?.(el.font) ?? 0);
        visible[el.data] = geo.visibleRows;
        list.slice(0, geo.visibleRows).forEach((row, index) => {
          const band = rowBand(row);
          if (band) {
            const r = geo.band(index);
            ctx.globalAlpha = band[3];
            ctx.fillStyle = `rgb(${band.slice(0, 3).map(v => Math.round(v * 255)).join(',')})`;
            ctx.fillRect(r.x, r.y, r.w, r.h);
            ctx.globalAlpha = color[3];
          }
          const icon = rowIcon(row, layout.rowIcons);
          const img = icon ? res.texture(icon) : null;
          if (img) {
            const cell = geo.icon(index);
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(img, cell.x, cell.y, cell.w, cell.h);
          }
          const kinds = medalKinds(row.medals);
          if (kinds && layout.rowMedals) {
            const cells = geo.medals(index);
            kinds.forEach((kind, i) => {
              const tex = layout.rowMedals[kind];
              const pic = tex ? res.texture(tex) : null;
              if (!pic) return;
              ctx.imageSmoothingEnabled = false;
              ctx.drawImage(pic, cells[i].x, cells[i].y, cells[i].w, cells[i].h);
            });
          }
          const base = res.rowColor?.(row) || color.slice(0, 3);
          const rgb = row.dead ? base.map(v => v * DEAD_ROW_DIM) : base;
          ctx.imageSmoothingEnabled = false;
          for (const cell of geo.cells(index, row)) {
            const text = clipText(cell.text, cell.clip, t => res.measure(el.font, t));
            res.drawText(ctx, el.font, text, Math.round(cell.x), Math.round(cell.y), rgb);
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
