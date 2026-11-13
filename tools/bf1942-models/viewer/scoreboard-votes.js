// The votes on the score board (`scoreboard-screen.js` builds one): the row a
// player picks, the board's VOTE KICK / VOTE KICK (TEAM) / MAP VOTE buttons,
// the map-vote screen and the vote plate a running vote shows over the game.
//
// All three are `menu/InGame`'s own: the buttons are leaves of the
// `Scoreboard/SpawnScoreBoard` group, and the pack's `vote` block
// (`extract_scoreboard_layout.py` `VOTE_GROUPS`) holds the map-vote screen
// (the group culled on `ScoreboardMapVote/MapVoteActive`) and the plate (the
// group culled on `Scoreboard/ShowVoteMessageIngame`, `tooltip_256x128` at
// 528, 224 with `Scoreboard/VoteMessageIngame` centred on it).
//
// The client's side of it, by the Mac client's symbols (a lead; the server's
// law is `server/room-votes.mjs`): `menu::Scoreboard::voteKickPlayer` /
// `voteKickTeamPlayer` vote on the row picked in a list
// (`Scoreboard/PlayerSelectAxis` / `PlayerSelectAllied`, each list's
// `onFocus`); `menu::MapVoteInterface` lists the map cycle under Id, Mapname,
// Mod, Gamemode and Votes, `selectMap` picks a row and `voteMap` votes for
// it; `HudManager::showVoteMessage` raises the plate with
// `VoteFeedback::generateMsg`'s text.
//
// Inferred, not read: where a map row's cells sit under their heads (each
// cell starts at its head's x, the rows on the list widget's own pitch), the
// selected row's band alpha (the file's `select` colour carries alpha 0; the
// local row's band alpha is used), and that the plate's text breaks into one
// line a part.
//
// Pure except `createBoardVotes`' DOM half, so `tests/scoreboard_votes_harness.mjs`
// runs the arithmetic under node.

import { listGeometry, paintLeaves } from './scoreboard.js';

/** The button ids the board's vote leaves carry (`menu/InGame`). */
export const VOTE_BUTTONS = Object.freeze({
  SCOREBOARD_VOTE_KICK: 'kick',
  SCOREBOARD_VOTE_KICK_TEAM: 'teamKick',
  SCOREBOARD_BRINGUP_MAPVOTE: 'mapVote',
  SCOREBOARD_VOTE_MAP: 'voteMap',
});

/** The map list's heads by their locale key, in column order, and the field
 *  of a row each shows. */
export const MAP_COLUMNS = Object.freeze([
  ['MAPVOTE_ID', 'id'], ['MAPVOTE_MAPNAME', 'level'], ['MAPVOTE_MOD', 'mod'],
  ['MAPVOTE_GAMEMODE', 'mode'], ['MAPVOTE_NUMVOTES', 'votes'],
]);

/** The band alpha of a picked row (see the header). */
export const SELECT_ALPHA = 0.5;

const inRect = (r, x, y) => x >= r[0] && x < r[0] + r[2] && y >= r[1] && y < r[1] + r[3];
const visible = (el, vars) => (el.when || []).every(c => {
  const same = vars[c.var] === c.value;
  return c.op === 'ne' ? !same : same;
});

/** The row of `list` (a board list's rows, top first) under virtual point
 *  (x, y) in list box `box`, or null. */
export function rowAt(box, columns, list, x, y) {
  if (!box || !inRect(box.rect, x, y)) return null;
  const geo = listGeometry(box, columns);
  for (let index = 0; index < Math.min(list.length, geo.visibleRows); index++) {
    const band = geo.band(index);
    if (y >= band.y && y < band.y + band.h) return list[index];
  }
  return null;
}

/** The board's vote variables for the row picked: VOTE KICK needs a picked
 *  player who is not the local one, VOTE KICK (TEAM) one of the local side;
 *  each only while the room takes that vote. */
export function voteVars({ live = false, picked = null, localTeam = 0, enabled = () => true,
                           statusLine = '' } = {}) {
  const target = live && picked && !picked.local && Number.isInteger(picked.slot);
  return {
    'Scoreboard/EnableVoteKick': !!(target && enabled(1)),
    'Scoreboard/EnableVoteKickTeam': !!(target && picked.team === localTeam && enabled(2)),
    'Scoreboard/KickVoteActive': statusLine,
  };
}

/** The map list's rows: `{ id, level, mod, mode, votes }` an entry. */
export function mapRows(maps, { mod = '', votes = () => 0 } = {}) {
  return (maps || []).map((entry, id) => ({
    id, level: String(entry.level ?? ''), mod, mode: entry.mode ? String(entry.mode) : '',
    votes: votes(id) || '',
  }));
}

/** Where a map row's cells go: the x of each head, the row's baseline. */
export function mapCells(elements, box, row, index, fontBaseline = 0) {
  const geo = listGeometry(box, { textInset: 0, columns: [] }, fontBaseline);
  const line = geo.baseline(index);
  return MAP_COLUMNS.map(([key, field]) => {
    const head = elements.find(el => el.kind === 'text' && el.key === key);
    return head ? { field, x: head.rect[0], y: line - fontBaseline, text: String(row[field] ?? '') } : null;
  }).filter(cell => cell && cell.text !== '');
}

/**
 * @param {object} ctx
 * @param {() => object|null} ctx.layout   the board's pack data (`vote` in it)
 * @param {() => object|null} ctx.host     `room-host-client.js`'s live half
 * @param {object} ctx.res                 the board's painter resources
 * @param {() => object} ctx.scale         the board's virtual-to-box scale
 * @param {HTMLElement} ctx.box            `#scoreboard`
 * @param {() => {1: object[], 2: object[]}} ctx.rows  the board's lists
 * @param {() => number} ctx.localTeam
 * @param {() => string} ctx.modId
 * @param {() => void} ctx.repaint         paint the board again
 * @param {(on: boolean) => void} ctx.openBoard  raise or drop `#scoreboard`
 */
export function createBoardVotes(ctx) {
  const state = { picked: null, mapVote: false, mapPick: -1, hover: null };
  const host = () => { const h = ctx.host?.(); return h?.live ? h : null; };
  const part = name => ctx.layout()?.vote?.[name] ?? null;

  /** The picked slot's row as the lists have it now (he may have left). */
  function pickedRow() {
    if (state.picked == null) return null;
    const rows = ctx.rows();
    return [...rows[1], ...rows[2]].find(r => r.slot === state.picked) ?? null;
  }

  function vars() {
    const h = host();
    return voteVars({ live: !!h, picked: pickedRow(), localTeam: ctx.localTeam(),
                      enabled: kind => h?.enabled(kind) ?? false,
                      statusLine: h ? h.statusLine(1) : '' });
  }

  /** The lists with the picked row marked (`paintLeaves` bands it). */
  function mark(rows) {
    if (state.picked == null) return rows;
    const pick = list => list.map(r => (r.slot === state.picked ? { ...r, selected: true } : r));
    return { 1: pick(rows[1]), 2: pick(rows[2]) };
  }

  // --- the map-vote screen ----------------------------------------------------

  function mapVars() {
    const h = host();
    return { ...(ctx.layout()?.variables || {}),
             'ScoreboardMapVote/MapVoteActive': true,
             'ScoreboardMapVote/FromSpawnMapVote': !!ctx.fromSpawn?.(),
             'ScoreboardMapVote/ShowMapScrollbar': false,
             'ScoreboardMapVote/MapVoteActiveMsg': h ? h.statusLine(0) : '' };
  }

  function paintMapVote(c) {
    const group = part('mapVote');
    const h = host();
    if (!group || !h) return false;
    const res = { ...ctx.res, hover: el => !!state.hover && el.rect === state.hover };
    paintLeaves(c, ctx.layout(), group.elements.filter(el => el.kind !== 'listbox'), mapVars(), res);
    const box = group.elements.find(el => el.kind === 'listbox');
    if (!box) return true;
    const geo = listGeometry(box, { textInset: 0, columns: [] });
    const fontBaseline = ctx.res.baseline?.(box.font) ?? 0;
    const running = h.running(0);
    mapRows(h.maps, { mod: ctx.modId(), votes: id => (running && running.target === id ? running.yes : 0) })
      .slice(0, geo.visibleRows).forEach((row, index) => {
        if (index === state.mapPick && box.select) {
          const band = geo.band(index);
          c.globalAlpha = box.select[3] || SELECT_ALPHA;
          c.fillStyle = `rgb(${box.select.slice(0, 3).map(v => Math.round(v * 255)).join(',')})`;
          c.fillRect(band.x, band.y, band.w, band.h);
        }
        c.globalAlpha = 1;
        c.imageSmoothingEnabled = false;
        for (const cell of mapCells(group.elements, box, row, index, fontBaseline)) {
          ctx.res.drawText(c, box.font, cell.text, Math.round(cell.x), Math.round(cell.y),
                           (box.color || [1, 1, 1]).slice(0, 3), true);
        }
      });
    return true;
  }

  function mapHit(x, y) {
    const group = part('mapVote');
    const h = host();
    if (!group || !h) return null;
    const table = mapVars();
    for (const el of group.elements) {
      if (el.kind !== 'button' || !visible(el, table) || !inRect(el.rect, x, y)) continue;
      if (el.id === 'RESPAWN_DONE') return { kind: 'done', rect: el.rect };
      if (VOTE_BUTTONS[el.id] === 'voteMap') return { kind: 'voteMap', rect: el.rect };
    }
    const box = group.elements.find(el => el.kind === 'listbox');
    if (box && inRect(box.rect, x, y)) {
      const geo = listGeometry(box, { textInset: 0, columns: [] });
      for (let index = 0; index < Math.min(h.maps.length, geo.visibleRows); index++) {
        const band = geo.band(index);
        if (y >= band.y && y < band.y + band.h) return { kind: 'map', index };
      }
    }
    return null;
  }

  // --- the board's own leaves ---------------------------------------------------

  function boardHit(x, y) {
    const data = ctx.layout();
    if (!data || !host()) return null;
    const table = { ...ctx.boardVars(), ...vars() };
    for (const el of data.elements) {
      if (el.kind !== 'button' || !VOTE_BUTTONS[el.id] || !inRect(el.rect, x, y)) continue;
      if (!visible(el, table)) continue;
      // The disabled twin of a vote button has no hover plate of its own.
      if (el.hover === el.texture && VOTE_BUTTONS[el.id] !== 'mapVote') continue;
      return { kind: VOTE_BUTTONS[el.id], rect: el.rect };
    }
    const rows = ctx.rows();
    for (const [team, name] of [[1, 'Scoreboard/AxisScoreboardList'], [2, 'Scoreboard/AlliedScoreboardList']]) {
      const box = data.elements.find(el => el.kind === 'listbox' && el.data === name);
      const row = rowAt(box, data.listColumns, rows[team], x, y);
      if (row) return { kind: 'row', slot: row.slot };
    }
    return null;
  }

  function toVirtual(event) {
    const s = ctx.scale();
    const r = ctx.box.getBoundingClientRect();
    return [(event.clientX - r.left - s.ox) / s.sx, (event.clientY - r.top - s.oy) / s.sy];
  }

  function click(event) {
    const [x, y] = toVirtual(event);
    const h = host();
    if (!h) return;
    if (state.mapVote) {
      const hit = mapHit(x, y);
      if (hit?.kind === 'map') state.mapPick = hit.index;
      else if (hit?.kind === 'voteMap' && state.mapPick >= 0) h.vote(0, state.mapPick);
      else if (hit?.kind === 'done') { showMapVote(false); return; }
      ctx.repaint();
      return;
    }
    const hit = boardHit(x, y);
    if (!hit) return;
    if (hit.kind === 'row') state.picked = Number.isInteger(hit.slot) ? hit.slot : null;
    else if (hit.kind === 'kick' && state.picked != null) h.vote(1, state.picked);
    else if (hit.kind === 'teamKick' && state.picked != null) h.vote(2, state.picked);
    else if (hit.kind === 'mapVote') { showMapVote(true); return; }
    ctx.repaint();
  }

  function move(event) {
    const [x, y] = toVirtual(event);
    const hit = state.mapVote ? mapHit(x, y) : boardHit(x, y);
    const rect = hit?.rect ?? null;
    ctx.box.style.cursor = hit ? 'pointer' : '';
    if (rect !== state.hover) { state.hover = rect; ctx.repaint(); }
  }

  /** The map-vote screen up or down. It stands on the board's own box; a
   *  board that was not up (SHOW MAP VOTE in play) is raised for it, with
   *  the pointer, and dropped again with it. */
  function showMapVote(on) {
    if (on && (!part('mapVote') || !host())) return false;
    if (on === state.mapVote) return true;
    state.mapVote = on;
    state.hover = null;
    if (on) {
      state.raised = ctx.box.hidden;
      if (state.raised) ctx.openBoard(true);
      ctx.box.style.pointerEvents = 'auto';
      try { document.exitPointerLock?.(); } catch { /* not locked */ }
    } else {
      ctx.box.style.pointerEvents = '';
      ctx.box.style.cursor = '';
      if (state.raised) ctx.openBoard(false);
      state.raised = false;
    }
    ctx.repaint();
    return true;
  }

  if (ctx.box?.addEventListener) {
    ctx.box.addEventListener('click', click);
    ctx.box.addEventListener('pointermove', move);
  }

  // --- the vote plate over the game -------------------------------------------------

  let plate = null;
  let plateKey = '';
  /** Whether the plate can be drawn: the pack has it and its face. */
  const plateReady = () => !!part('message') && !!ctx.hasFont?.(
    part('message').elements.find(el => el.kind === 'text')?.font);

  /** Twice a second while the page is in a room: the plate with the running
   *  vote's question, counts, keys and time left, or nothing. One map lookup
   *  a call when no vote runs. */
  function paintPlate() {
    const group = part('message');
    const h = host();
    const current = h && plateReady() && ctx.box.hidden ? h.current() : null;
    const key = current ? `${current.lines.join('|')}|${ctx.box.parentElement?.clientWidth}` : '';
    if (key === plateKey) return;
    plateKey = key;
    // By `display`, not the `hidden` attribute, which the page's own canvas
    // rules would override.
    if (!current) { if (plate) plate.style.display = 'none'; return; }
    if (!plate) {
      plate = document.createElement('canvas');
      // Over the spawn screen and the map as well as the game: a dead or
      // waiting player is asked too. Never over the board (`paintPlate`).
      plate.id = 'vote-plate';
      plate.setAttribute('aria-hidden', 'true');
      plate.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:12';
      ctx.box.parentElement.insertBefore(plate, ctx.box);
    }
    plate.style.display = '';
    const parent = ctx.box.parentElement;
    const W = parent.clientWidth || 800, H = parent.clientHeight || 600;
    const [vw, vh] = ctx.layout().virtual || [800, 600];
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    plate.width = Math.round(W * dpr);
    plate.height = Math.round(H * dpr);
    const c = plate.getContext('2d');
    c.setTransform(W / vw * dpr, 0, 0, H / vh * dpr, 0, 0);
    drawPlate(c, group, current.lines);
  }

  /** The plate's leaves, its text one centred line a part. */
  function drawPlate(c, group, lines) {
    const table = { 'Scoreboard/ShowVoteMessageIngame': true };
    paintLeaves(c, ctx.layout(), group.elements.filter(el => el.kind !== 'text'), table, ctx.res);
    const text = group.elements.find(el => el.kind === 'text');
    if (!text) return;
    const [x, y, w] = text.rect;
    const pitch = ctx.lineHeight?.(text.font) ?? 12;
    const color = text.color || [1, 1, 1, 1];
    c.globalAlpha = color[3] ?? 1;
    c.imageSmoothingEnabled = false;
    lines.forEach((line, i) => {
      const width = ctx.res.measure(text.font, line);
      ctx.res.drawText(c, text.font, line, Math.round(x + (w - width) / 2), y + i * pitch, color.slice(0, 3));
    });
    c.globalAlpha = 1;
  }

  const timer = typeof window !== 'undefined' && ctx.box?.parentElement
    ? setInterval(paintPlate, 500) : null;

  return {
    state,
    vars,
    mark,
    paintMapVote,
    showMapVote,
    plateReady,
    drawPlate,
    boardHit,
    mapHit,
    get mapVoteOpen() { return state.mapVote; },
    /** What the board's paint key must carry of the votes. */
    key: () => [state.picked, state.mapVote, state.mapPick, state.hover, host()?.statusLine(0), host()?.statusLine(1),
                host()?.running(0)?.yes],
    stop() { if (timer !== null) clearInterval(timer); },
  };
}
