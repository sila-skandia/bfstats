// The replay board's Accuracy view as a dashboard (features/replay-accuracy):
// every player's rounds fired, hits and accuracy down the left, and for the
// one picked, his accuracy as it ran through the round, the rounds he fired
// and the rounds fired at him, his weapons, his ranges and who he traded fire
// with.
//
// Owner's ask (2026-11-02): "it'd be nice to see it calculated as a moving
// value as the round plays ... if we know what their final accuracy will be
// ... plot it on a graph", "a rich dashboard ... accuracy, bullets fired, and
// whatever hard core data we can capture", "how many bullets were shot at
// them".
//
// The numbers follow the replay's clock ("so far"), or show the whole round.
// Where the server's round-end tally is the source, the recording saw only
// part of his firing: the running counts keep the recording's shape and are
// scaled to finish on the server's numbers (replay-accuracy.js `totalsAt`).

import { accuracySeries, countBy, fireBuckets, totalsAt, totalsOf } from './replay-accuracy.js';
import { fmtClock } from './replay-timeline.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const SVG = 'http://www.w3.org/2000/svg';
function svg(tag, attrs = {}) {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

const pct = v => (v === null || v === undefined || !Number.isFinite(v) ? '-' : `${(v * 100).toFixed(v >= 0.1 || v === 0 ? 1 : 2)}%`);
const int = v => (Number.isFinite(v) ? Math.round(v).toLocaleString('en-US') : '-');
const metres = v => (Number.isFinite(v) ? `${Math.round(v)} m` : '-');
const team = t => (t === 1 ? 1 : t === 2 ? 2 : 0);

/** Below this many rounds a running accuracy is noise, and is not drawn. */
const WARM_UP = 10;
/** A bucket of the fire band, seconds: the first of these giving at most
 *  70 buckets, fewer on a narrow chart. */
const BUCKETS = [5, 10, 15, 20, 30, 60, 120, 300];

const SOURCE = {
  server: ['SERVER TALLY', 'The server\'s round-end tally: exact for the whole round. The curve\'s shape is what this recording saw, scaled to finish on it.'],
  marks: ['HIT MARKS', 'Hits are the server\'s own crosshair hit marks for the recording player; blasts and rounds fired are counted from the recording.'],
  rebuilt: ['REBUILT', 'Not in the server\'s tally: counted from what this recording saw, so a distant player\'s share is a sample.'],
};

export const ACC_DASH_STYLE = `
.rp-root.board-acc .rp-board { width: min(1180px, calc(100% - 32px)); max-height: min(780px, calc(100% - var(--rp-bar-h) - 60px)); }
.rp-root.board-acc .rp-acc.rp-accd { display: grid; }
.rp-accd { grid-template-columns: minmax(250px, 300px) minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr) auto; }
.rp-accd > .rp-acc-head { grid-column: 1 / -1; border-bottom: 1px solid var(--rp-edge); }
.rp-accd .rp-acc-foot { grid-column: 1 / -1; }
.rp-accd-mode { display: flex; gap: 0; border: 1px solid var(--rp-edge); border-radius: 4px; overflow: hidden; }
.rp-accd-mode button { padding: 2px 9px; border: 0; background: none; color: var(--rp-muted); font: 700 11px/1.5 var(--rp-font); cursor: pointer; }
.rp-accd-mode button + button { border-left: 1px solid var(--rp-edge); }
.rp-accd-mode button[aria-pressed="true"] { background: rgba(232, 195, 90, .16); color: var(--rp-ink); }
.rp-accd-list { display: flex; flex-direction: column; min-height: 0; border-right: 1px solid var(--rp-edge); }
.rp-accd-list .rp-acc-cols, .rp-accd-list .rp-arow { grid-template-columns: 22px minmax(0, 1fr) 48px 40px 52px; column-gap: 6px; }
.rp-accd-list .rp-arow { padding: 4px 10px; }
.rp-accd-list .rp-acc-cols { padding: 3px 10px; }
.rp-accd-list .rp-arow.sel { background: rgba(232, 195, 90, .2); box-shadow: inset 3px 0 0 var(--rp-gold); }
.rp-accd-list .rp-arow .est { color: var(--rp-muted); }

.rp-accd-dash { min-height: 0; overflow: auto; padding: 10px 14px 12px; display: flex; flex-direction: column; gap: 10px;
  font: 12px/1.35 var(--rp-font); color: var(--rp-ink); }
.rp-accd-who { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 10px; }
.rp-accd-who b { font: 800 20px/1.1 var(--rp-font); letter-spacing: .01em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
.rp-accd-who b.t1 { color: #ff8b8b; } .rp-accd-who b.t2 { color: #9ab8ff; }
.rp-accd-chip { padding: 1px 6px; border: 1px solid var(--rp-edge); border-radius: 3px; color: var(--rp-muted);
  font: 800 9px/1.5 var(--rp-font); letter-spacing: .1em; cursor: help; }
.rp-accd-chip.server { border-color: var(--rp-life); color: var(--rp-life); }
.rp-accd-at { margin-left: auto; color: var(--rp-muted); font: 11px/1 var(--rp-mono); font-variant-numeric: tabular-nums; }
.rp-accd-watch { padding: 3px 10px; border: 1px solid var(--rp-gold); border-radius: 3px; background: none; color: var(--rp-gold);
  font: 800 10px/1.4 var(--rp-font); letter-spacing: .1em; cursor: pointer; }
.rp-accd-watch:hover { background: var(--rp-gold); color: var(--rp-khaki-ink); }

.rp-accd-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(118px, 1fr)); gap: 8px; }
.rp-accd-tile { position: relative; padding: 8px 10px 7px; border: 1px solid var(--rp-edge); border-radius: 6px;
  background: linear-gradient(180deg, rgba(255, 255, 255, .045), rgba(255, 255, 255, 0)); overflow: hidden; }
.rp-accd-tile .k { color: var(--rp-muted); font: 800 9px/1.3 var(--rp-font); letter-spacing: .12em; }
.rp-accd-tile .v { margin-top: 3px; font: 700 22px/1.1 var(--rp-mono); font-variant-numeric: tabular-nums; white-space: nowrap; }
.rp-accd-tile .s { margin-top: 2px; color: var(--rp-muted); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rp-accd-tile.lead { border-color: rgba(232, 195, 90, .55); }
.rp-accd-tile.lead .v { color: var(--rp-gold); font-size: 26px; }
.rp-accd-tile.hot .v { color: var(--rp-fire); }
.rp-accd-tile .meter { position: absolute; left: 0; bottom: 0; height: 2px; background: var(--rp-gold); transition: width .5s ease; }
.rp-accd-tile .vs { position: absolute; top: 7px; right: 8px; padding: 0 4px; border-radius: 3px; font: 700 10px/1.5 var(--rp-mono); }
.rp-accd-tile .vs.up { color: var(--rp-life); background: rgba(169, 195, 106, .14); }
.rp-accd-tile .vs.down { color: var(--rp-axis); background: rgba(255, 89, 89, .14); }
.rp-accd-panel h4 .whole { margin-left: auto; font-weight: 700; letter-spacing: .08em; opacity: .7; }

.rp-accd-chart { position: relative; border: 1px solid var(--rp-edge); border-radius: 6px; padding: 8px 10px 4px;
  background: rgba(10, 10, 9, .25); }
.rp-accd-chart h4, .rp-accd-panel h4 { margin: 0 0 6px; color: var(--rp-muted); font: 800 9px/1.3 var(--rp-font); letter-spacing: .12em; display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }
.rp-accd-chart h4 .key { display: inline-flex; align-items: center; gap: 5px; font-weight: 700; letter-spacing: .06em; }
.rp-accd-chart h4 .key i { display: inline-block; width: 14px; height: 0; border-top: 2px solid; }
.rp-accd-chart h4 .key i.dash { border-top-style: dashed; }
.rp-accd-chart h4 .key i.box { height: 8px; border: 0; border-radius: 1px; width: 8px; }
.rp-accd-chart svg { display: block; width: 100%; height: auto; overflow: visible; cursor: crosshair; touch-action: pan-y; }
.rp-accd-chart .grid { stroke: rgba(238, 236, 217, .09); stroke-width: 1; }
.rp-accd-chart .axis { fill: var(--rp-muted); font: 9px var(--rp-mono); }
.rp-accd-chart .acc { fill: none; stroke: var(--rp-gold); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
.rp-accd-chart .acc.ghost { opacity: .28; }
.rp-accd-chart .area { fill: url(#rp-accd-fill); }
.rp-accd-chart .final { stroke: var(--rp-gold); stroke-dasharray: 5 4; stroke-width: 1; opacity: .75; }
.rp-accd-chart .avg { stroke: var(--rp-ink); stroke-dasharray: 1 3; stroke-width: 1.2; opacity: .55; }
.rp-accd-chart .lbl { font: 700 9px var(--rp-mono); }
.rp-accd-chart .now { stroke: var(--rp-ink); stroke-width: 1; opacity: .7; }
.rp-accd-chart .dot { fill: var(--rp-gold); stroke: #15150e; stroke-width: 1.5; }
.rp-accd-chart .out { fill: var(--rp-khaki); opacity: .55; }
.rp-accd-chart .outhit { fill: var(--rp-gold); }
.rp-accd-chart .in { fill: var(--rp-axis); opacity: .38; }
.rp-accd-chart .inhit { fill: var(--rp-axis); }
.rp-accd-chart .future { opacity: .3; }
.rp-accd-chart .kill { stroke: var(--rp-gold); stroke-width: 1.5; }
.rp-accd-chart .death { stroke: var(--rp-axis); stroke-width: 1.5; }
.rp-accd-chart .hover { stroke: var(--rp-ink); stroke-width: 1; stroke-dasharray: 2 2; opacity: 0; }
.rp-accd-tip { position: absolute; top: 6px; pointer-events: none; padding: 5px 8px; border: 1px solid var(--rp-edge-strong);
  border-radius: 4px; background: var(--rp-plate-menu); font: 11px/1.4 var(--rp-mono); white-space: nowrap; opacity: 0; transition: opacity .12s; }
.rp-accd-tip b { color: var(--rp-gold); }
.rp-accd-tip.on { opacity: 1; }

.rp-accd-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 10px; }
.rp-accd-panel { border: 1px solid var(--rp-edge); border-radius: 6px; padding: 8px 10px 9px; min-width: 0; }
.rp-accd-bars { display: flex; flex-direction: column; gap: 6px; }
.rp-accd-bar { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 1px 8px; align-items: baseline; }
.rp-accd-bar .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rp-accd-bar .nm.t1 { color: #ff9a9a; } .rp-accd-bar .nm.t2 { color: #a6c0ff; }
.rp-accd-bar .num { font: 11px var(--rp-mono); color: var(--rp-muted); font-variant-numeric: tabular-nums; }
.rp-accd-bar .num b { color: var(--rp-ink); font-weight: 700; }
.rp-accd-bar .track { grid-column: 1 / -1; position: relative; height: 5px; border-radius: 3px; background: rgba(255, 255, 255, .08); overflow: hidden; }
.rp-accd-bar .track i { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 3px; background: rgba(163, 156, 108, .7); }
.rp-accd-bar .track i + i { background: var(--rp-gold); }
.rp-accd-bar.foe .track i { background: rgba(255, 89, 89, .45); }
.rp-accd-bar.foe .track i + i { background: var(--rp-axis); }
.rp-accd-hist { display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px; align-items: end; height: 74px; }
.rp-accd-hist div { display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; gap: 2px; }
.rp-accd-hist i { width: 100%; min-height: 1px; border-radius: 2px 2px 0 0; background: linear-gradient(180deg, var(--rp-gold), rgba(232, 195, 90, .35)); }
.rp-accd-hist span { color: var(--rp-muted); font: 9px var(--rp-mono); }
.rp-accd-hist b { font: 700 10px var(--rp-mono); }
.rp-accd-split { display: flex; height: 8px; border-radius: 4px; overflow: hidden; margin: 10px 0 5px; background: rgba(255, 255, 255, .08); }
.rp-accd-split i { height: 100%; }
.rp-accd-split .soldier { background: var(--rp-gold); } .rp-accd-split .armour { background: var(--rp-khaki); } .rp-accd-split .air { background: #8fb7d6; }
.rp-accd-legend { display: flex; gap: 10px; flex-wrap: wrap; color: var(--rp-muted); font-size: 11px; }
.rp-accd-legend span::before { content: ''; display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 4px; vertical-align: -1px; background: var(--c); }
.rp-accd-facts { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 10px; }
.rp-accd-facts dt { color: var(--rp-muted); }
.rp-accd-facts dd { margin: 0; text-align: right; font: 700 12px var(--rp-mono); font-variant-numeric: tabular-nums; }
.rp-accd-empty { padding: 30px 12px; color: var(--rp-muted); text-align: center; }
.rp-accd-note { color: var(--rp-muted); font-size: 11px; }

@media (max-width: 720px) {
  .rp-root.board-acc .rp-board { width: calc(100% - 12px); }
  .rp-root.board-acc .rp-acc.rp-accd { display: flex; flex-direction: column; overflow: auto; }
  .rp-accd > * { flex: none; }
  .rp-accd-dash { overflow: visible; padding: 10px; }
  .rp-accd-list { border-right: 0; border-top: 1px solid var(--rp-edge); order: 3; }
  .rp-accd-list .rp-acc-rows { max-height: 320px; }
  .rp-accd > .rp-acc-foot { order: 4; }
  .rp-accd-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .rp-accd-tile .v { font-size: 19px; }
  .rp-accd-tile.lead .v { font-size: 22px; }
}
@media (prefers-reduced-motion: reduce) { .rp-accd-tile .meter { transition: none; } }
`;

/**
 * The dashboard, drawn into the board's Accuracy panel. `ui` is the replay's
 * ReplayUi: its `player` (replay.js), `lexicon()` and `follow(pid)`.
 */
export class AccuracyDash {
  constructor(ui) {
    this.ui = ui;
    this.kind = 'all';
    this.sort = 'hit';
    this.mode = 'now';
    this.selected = null;
    this.build();
  }

  get player() { return this.ui.player; }

  build() {
    const box = el('div', 'rp-panel rp-acc rp-accd');
    this.box = box;
    const head = el('div', 'rp-acc-head');
    head.append(el('b', '', 'ACCURACY'));
    const mode = el('div', 'rp-accd-mode');
    mode.setAttribute('role', 'group');
    mode.setAttribute('aria-label', 'Numbers at');
    this.modeButtons = {};
    for (const [m, text, title] of [['now', 'So far', 'Numbers up to the replay\'s clock'], ['final', 'Whole round', 'The whole round\'s numbers']]) {
      const b = el('button', '', text);
      b.type = 'button';
      b.title = title;
      b.setAttribute('aria-pressed', String(m === this.mode));
      b.addEventListener('click', e => {
        e.stopPropagation();
        this.mode = m;
        for (const [k, node] of Object.entries(this.modeButtons)) node.setAttribute('aria-pressed', String(k === m));
        this.render(true);
      });
      mode.append(b);
      this.modeButtons[m] = b;
    }
    const kinds = el('div', 'rp-acc-kinds');
    this.kindButtons = {};
    for (const [kind, text] of [['all', 'All'], ['infantry', 'Infantry'], ['vehicle', 'Vehicles'], ['air', 'Air']]) {
      const b = el('button', 'rp-acc-kind', text);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(kind === 'all'));
      b.addEventListener('click', e => {
        e.stopPropagation();
        this.kind = kind;
        for (const [k, node] of Object.entries(this.kindButtons)) node.setAttribute('aria-pressed', String(k === kind));
        this.render(true);
      });
      kinds.append(b);
      this.kindButtons[kind] = b;
    }
    head.append(mode, kinds);

    // The players.
    const list = el('div', 'rp-accd-list');
    const cols = el('div', 'rp-acc-cols');
    cols.append(el('span', '', '#'), el('span', '', 'PLAYER'));
    this.cols = {};
    for (const [key, text, label] of [['fired', 'FIRED', 'Sort by rounds fired'], ['hit', 'HITS', 'Sort by hits'], ['acc', 'ACC', 'Sort by accuracy']]) {
      const b = el('button', '', text);
      b.type = 'button';
      b.title = label;
      b.addEventListener('click', e => {
        e.stopPropagation();
        this.sort = key;
        this.render(true);
      });
      cols.append(b);
      this.cols[key] = b;
    }
    this.rows = el('div', 'rp-acc-rows');
    this.rows.addEventListener('click', e => {
      const row = e.target.closest?.('.rp-arow[data-key]');
      if (!row) return;
      e.stopPropagation();
      this.selected = row.dataset.key;
      this.render(true);
    });
    list.append(cols, this.rows);

    this.dash = el('div', 'rp-accd-dash');
    // The chart is drawn at its own width, so its type stays legible on a
    // phone: a change of width draws it again.
    this.resize = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
      const w = this.chartWidth();
      if (this.d?.chart && Math.abs(w - this.d.chart.W) > 30) {
        this.shown = null;
        this.render(true);
      }
    }) : null;
    this.resize?.observe(this.dash);
    this.foot = el('div', 'rp-acc-foot');
    box.append(head, list, this.dash, this.foot);
  }

  /** The board, and each entry's numbers in the current mode, sorted. */
  rowsAt(board, t) {
    const kind = this.kind;
    const rows = [];
    for (const p of board) {
      const final = totalsOf(p, kind);
      if (!(final.fired > 0)) continue;
      let at = final;
      let estimated = false;
      if (this.mode === 'now') {
        const now = totalsAt(p, kind, t);
        if (!now || !(now.fired >= 0.5)) continue;
        at = now;
        estimated = now.estimated;
      }
      rows.push({ p, fired: at.fired, hit: at.hit, accuracy: at.accuracy, estimated, final });
    }
    const by = {
      fired: (a, b) => b.fired - a.fired || b.hit - a.hit,
      hit: (a, b) => b.hit - a.hit || b.fired - a.fired,
      // A handful of rounds is no measure of a shot: those under 20 go last.
      acc: (a, b) => (b.fired >= 20) - (a.fired >= 20) || (b.accuracy ?? 0) - (a.accuracy ?? 0) || b.fired - a.fired,
    }[this.sort];
    rows.sort((a, b) => by(a, b) || a.p.name.localeCompare(b.p.name));
    return rows;
  }

  /** Drawn again when the board, a control or (so far) the clock's second changes. */
  render(force) {
    const player = this.player;
    const board = player.accuracy?.() ?? [];
    const t = player.time;
    const sec = Math.floor(t);
    const key = [board, this.kind, this.sort, this.mode, this.selected, player.followPid, sec];
    if (!force && this.key && key.every((v, i) => v === this.key[i])) return;
    const listChanged = force || !this.key || key.slice(0, 6).some((v, i) => v !== this.key[i]) || this.mode === 'now';
    this.key = key;
    const rows = this.rowsAt(board, t);
    // Whom the dashboard shows: the one picked, else the man followed, else the top.
    // Anyone with no rounds on this board gives way.
    const fired = p => totalsOf(p, this.kind).fired > 0;
    let entry = board.find(p => p.key === this.selected && fired(p)) ?? null;
    if (!entry) {
      entry = board.find(p => p.pid === player.followPid && fired(p)) ?? rows[0]?.p ?? board.find(fired) ?? null;
    }
    if (listChanged) this.renderList(rows, entry);
    this.renderDash(board, entry, t);
    this.renderFoot(board);
  }

  renderList(rows, entry) {
    const player = this.player;
    for (const [k, b] of Object.entries(this.cols)) {
      if (k === this.sort) b.setAttribute('aria-sort', 'descending');
      else b.removeAttribute('aria-sort');
    }
    const best = Math.max(0.01, ...rows.map(r => (r.fired >= 20 ? r.accuracy ?? 0 : 0)));
    this.rows.textContent = '';
    if (!rows.length) {
      this.rows.append(el('div', 'rp-acc-empty', this.mode === 'now' ? 'Nobody has fired yet.'
        : this.kind === 'all' ? 'No rounds fired in this recording.' : 'No rounds fired on this board.'));
      return;
    }
    rows.forEach((r, i) => {
      const p = r.p;
      const row = el('button', `rp-arow t${team(p.team)}${p.pid === player.followPid ? ' me' : ''}${p === entry ? ' sel' : ''}`);
      row.type = 'button';
      row.dataset.key = p.key;
      row.setAttribute('aria-pressed', String(p === entry));
      const nm = el('span', 'nm');
      nm.append(el('span', 'who', p.name));
      if ((player.recordingPids ?? [player.recordingPid]).includes(p.pid)) nm.append(el('span', 'rp-card-rec', 'REC'));
      if (p.source === 'rebuilt') {
        const tag = el('small', '', 'rebuilt');
        tag.title = SOURCE.rebuilt[1];
        nm.append(tag);
      }
      const pc = el('span', `pc${r.estimated ? ' est' : ''}`, pct(r.accuracy));
      const bar = el('i');
      bar.style.width = `${Math.round(Math.min(1, (r.accuracy ?? 0) / best) * 100)}%`;
      pc.append(bar);
      if (r.estimated) row.title = 'So far, estimated: the server\'s whole-round tally, spread as this recording saw them fire';
      row.append(el('span', 'rk', String(i + 1)), nm, el('span', `n${r.estimated ? ' est' : ''}`, int(r.fired)),
        el('span', `n${r.estimated ? ' est' : ''}`, int(r.hit)), pc);
      this.rows.append(row);
    });
  }

  renderDash(board, entry, t) {
    const player = this.player;
    const kind = this.kind;
    if (!entry) {
      if (this.shown !== null) {
        this.dash.textContent = '';
        this.dash.append(el('div', 'rp-accd-empty', 'No rounds fired in this recording.'));
        this.shown = null;
      }
      return;
    }
    const detail = player.accuracyDetail?.(entry) ?? null;
    const shape = [entry, kind, detail];
    if (!this.shown || shape.some((v, i) => v !== this.shown[i])) {
      this.shown = shape;
      this.buildDash(board, entry, detail);
    }
    this.tickDash(board, entry, detail, t);
  }

  /** The parts that change only with the player or the board. */
  buildDash(board, entry, detail) {
    const player = this.player;
    const kind = this.kind;
    const duration = player.rec.duration || 1;
    const display = name => this.ui.lexicon?.()?.names?.[name] ?? name;
    this.dash.textContent = '';
    const d = {};
    this.d = d;

    // Who.
    const who = el('div', 'rp-accd-who');
    who.append(el('b', `t${team(entry.team)}`, entry.name));
    const [chipText, chipTitle] = SOURCE[entry.source] ?? SOURCE.rebuilt;
    const chip = el('span', `rp-accd-chip ${entry.source}`, chipText);
    chip.title = chipTitle;
    who.append(chip);
    if (entry.ai) who.append(el('span', 'rp-accd-chip', 'BOT'));
    d.at = el('span', 'rp-accd-at');
    const watch = el('button', 'rp-accd-watch', 'WATCH');
    watch.type = 'button';
    watch.title = 'Follow them in the replay';
    watch.addEventListener('click', e => {
      e.stopPropagation();
      this.ui.follow?.(entry.pid);
      this.ui.root?.classList.remove('board-open');
    });
    who.append(d.at, watch);

    // The tiles.
    const tiles = el('div', 'rp-accd-tiles');
    const tile = (k, cls = '') => {
      const node = el('div', `rp-accd-tile ${cls}`);
      const v = el('div', 'v');
      const s = el('div', 's');
      node.append(el('div', 'k', k), v, s);
      tiles.append(node);
      return { node, v, s };
    };
    d.acc = tile('ACCURACY', 'lead');
    d.acc.meter = el('i', 'meter');
    d.acc.vs = el('span', 'vs');
    d.acc.node.append(d.acc.meter, d.acc.vs);
    d.fired = tile('ROUNDS FIRED');
    d.hits = tile('HITS');
    d.perKill = tile('ROUNDS A KILL');
    d.incoming = tile('FIRED AT THEM', 'hot');
    d.far = tile('LONGEST HIT');

    // The chart.
    const chart = el('div', 'rp-accd-chart');
    const h4 = el('h4');
    h4.append(document.createTextNode('ACCURACY THROUGH THE ROUND'));
    const key = (cls, color, text) => {
      const k = el('span', 'key');
      const i = el('i', cls);
      i.style.borderColor = color;
      if (cls === 'box') i.style.background = color;
      k.append(i, document.createTextNode(text));
      return k;
    };
    h4.append(key('', 'var(--rp-gold)', 'theirs'), key('dash', 'var(--rp-gold)', 'final'), key('dash', 'var(--rp-ink)', 'round average'),
      key('box', 'var(--rp-gold)', 'their rounds / hits'), key('box', 'var(--rp-axis)', 'rounds at them'));
    chart.append(h4);
    d.chart = this.buildChart(board, entry, detail, duration);
    chart.append(d.chart.svg, d.chart.tip);

    // The panels.
    const grid = el('div', 'rp-accd-grid');
    grid.append(this.weaponsPanel(entry, display), this.rangePanel(detail), this.tradePanel(detail), this.triggerPanel(entry, detail));

    this.dash.append(who, tiles, chart, grid);
  }

  /** The tiles, the playhead and the clock: every second. */
  tickDash(board, entry, detail, t) {
    const d = this.d;
    const kind = this.kind;
    const final = totalsOf(entry, kind);
    const now = this.mode === 'now' ? totalsAt(entry, kind, t) : null;
    const at = this.mode === 'now' ? now ?? { fired: 0, hit: 0, accuracy: null } : final;
    const avg = roundAverage(board, kind);
    d.at.textContent = this.mode === 'now' ? `${fmtClock(t)} / ${fmtClock(this.player.rec.duration)}` : 'WHOLE ROUND';
    const approx = now?.estimated ? '~' : '';
    d.acc.v.textContent = `${approx}${pct(at.accuracy)}`;
    d.acc.s.textContent = this.mode === 'now' ? `final ${pct(final.accuracy)}` : `round average ${pct(avg)}`;
    d.acc.vs.textContent = '';
    d.acc.vs.className = 'vs';
    if (avg !== null && at.accuracy !== null) {
      const diff = at.accuracy - avg;
      d.acc.vs.className = `vs ${diff >= 0 ? 'up' : 'down'}`;
      d.acc.vs.textContent = `${diff >= 0 ? '+' : '-'}${(Math.abs(diff) * 100).toFixed(1)}`;
      d.acc.vs.title = `${diff >= 0 ? 'Above' : 'Below'} the round's average of ${pct(avg)}, in points`;
    }
    // The meter: his accuracy against the round's best (20 rounds or more).
    const best = Math.max(0.01, ...board.map(p => totalsOf(p, kind)).filter(x => x.fired >= 20).map(x => x.accuracy ?? 0));
    d.acc.meter.style.width = `${Math.min(100, ((at.accuracy ?? 0) / best) * 100).toFixed(1)}%`;
    d.acc.node.title = `The bar is their accuracy against the round's best, ${pct(best)}`;
    d.fired.v.textContent = `${approx}${int(at.fired)}`;
    d.fired.s.textContent = this.mode === 'now' ? `of ${int(final.fired)}` : `${(final.fired / Math.max(1, (this.player.rec.duration || 60) / 60)).toFixed(0)} a minute`;
    d.hits.v.textContent = `${approx}${int(at.hit)}`;
    d.hits.s.textContent = this.mode === 'now' ? `of ${int(final.hit)}` : `${int(final.fired - final.hit)} missed`;
    const until = this.mode === 'now' ? t : Infinity;
    const kills = detail ? detail.kills.filter(k => k <= until).length : 0;
    const deaths = detail ? detail.deaths.filter(k => k <= until).length : 0;
    // Kills are not by weapon in the recording's tally: only on All.
    d.perKill.v.textContent = kind === 'all' && kills && at.fired >= 1 ? `${approx}${int(at.fired / kills)}` : '-';
    d.perKill.s.textContent = `${kills} kill${kills === 1 ? '' : 's'}, ${deaths} death${deaths === 1 ? '' : 's'}`;
    if (detail) {
      const incoming = countBy(detail.incoming, until);
      const taken = detail.incoming.filter(x => x.hit && x.t <= until).length;
      d.incoming.v.textContent = int(incoming);
      d.incoming.s.textContent = `${taken} hit them${incoming ? `, ${pct(taken / incoming)}` : ''}`;
      let far = null;
      for (const h of detail.hitDists) {
        if (h.t > until || (far && h.dist <= far.dist)) continue;
        if (kind !== 'all' && entry.kinds?.get(String(h.tmpl).toLowerCase()) !== kind) continue;
        far = h;
      }
      d.far.v.textContent = far ? metres(far.dist) : '-';
      d.far.s.textContent = far ? (this.ui.lexicon?.()?.names?.[far.tmpl] ?? far.tmpl) : 'no bullet hit seen yet';
    }
    this.movePlayhead(this.mode === 'now' ? t : this.player.rec.duration);
  }

  /** The running accuracy over the round, the fire band beneath it, the
   *  kills and deaths along its foot. A click seeks the replay. */
  buildChart(board, entry, detail, duration) {
    const kind = this.kind;
    const W = this.chartWidth();
    const H = W < 520 ? 210 : 230;
    const L = 38;
    const R = 46;
    const top = 8;
    const accH = 128;
    const bandTop = top + accH + 18;
    const bandH = 56;
    const mid = bandTop + bandH / 2;
    const x = t => L + (t / duration) * (W - L - R);
    const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' });
    const final = totalsOf(entry, kind);
    const avg = roundAverage(board, kind);
    const series = accuracySeries(entry, kind, duration, 300).filter(p => p.fired >= WARM_UP);
    root.setAttribute('aria-label', `${entry.name}'s accuracy through the round, finishing at ${pct(final.accuracy)}`);
    const peak = Math.max(0.05, final.accuracy ?? 0, avg ?? 0, ...series.map(p => p.accuracy ?? 0));
    const yMax = Math.min(1, niceCeil(peak * 1.12));
    const y = v => top + accH - (Math.min(v, yMax) / yMax) * accH;

    const defs = svg('defs');
    const grad = svg('linearGradient', { id: 'rp-accd-fill', x1: 0, y1: 0, x2: 0, y2: 1 });
    grad.append(svg('stop', { offset: '0%', 'stop-color': '#e8c35a', 'stop-opacity': 0.28 }), svg('stop', { offset: '100%', 'stop-color': '#e8c35a', 'stop-opacity': 0 }));
    const clip = svg('clipPath', { id: 'rp-accd-past' });
    const clipRect = svg('rect', { x: 0, y: 0, width: W, height: H });
    clip.append(clipRect);
    defs.append(grad, clip);
    root.append(defs);

    // Grid and axes.
    for (let i = 0; i <= 4; i++) {
      const v = (yMax * i) / 4;
      root.append(svg('line', { class: 'grid', x1: L, x2: W - R, y1: y(v), y2: y(v) }));
      const lab = svg('text', { class: 'axis', x: L - 5, y: y(v) + 3, 'text-anchor': 'end' });
      lab.textContent = `${Math.round(v * 100)}%`;
      root.append(lab);
    }
    const step = niceStep(duration, Math.max(3, Math.floor((W - L - R) / 80)));
    for (let t = 0; t <= duration + 0.1; t += step) {
      root.append(svg('line', { class: 'grid', x1: x(t), x2: x(t), y1: top, y2: bandTop + bandH }));
      const lab = svg('text', { class: 'axis', x: x(t), y: H - 2, 'text-anchor': 'middle' });
      lab.textContent = fmtClock(t);
      root.append(lab);
    }

    // The fire band: his rounds up, rounds at him down, hits brighter.
    const most = Math.min(70, Math.floor((W - L - R) / 7));
    const width = BUCKETS.find(w => duration / w <= most) ?? 600;
    const out = fireBuckets(entry, kind, duration, width);
    const incoming = new Array(out.length).fill(0).map(() => ({ n: 0, hit: 0 }));
    for (const r of detail?.incoming ?? []) {
      const b = Math.min(out.length - 1, Math.max(0, Math.floor(r.t / width)));
      incoming[b].n += r.n;
      if (r.hit) incoming[b].hit++;
    }
    const outMax = Math.max(1, ...out.map(b => b.fired));
    const inMax = Math.max(1, ...incoming.map(b => b.n));
    const scale = Math.max(outMax, inMax);
    const half = bandH / 2 - 1;
    const bw = Math.max(1, x(width) - x(0) - 1);
    const band = svg('g');
    out.forEach((b, i) => {
      const bx = x(b.t) + 0.5;
      if (b.fired) {
        const h = (b.fired / scale) * half;
        band.append(svg('rect', { class: 'out', x: bx, y: mid - h, width: bw, height: h, 'data-t': b.t }));
        if (b.hit) {
          const hh = Math.max(1, (Math.min(b.hit, b.fired) / scale) * half);
          band.append(svg('rect', { class: 'outhit', x: bx, y: mid - hh, width: bw, height: hh, 'data-t': b.t }));
        }
      }
      const inc = incoming[i];
      if (inc.n) {
        const h = (inc.n / scale) * half;
        band.append(svg('rect', { class: 'in', x: bx, y: mid, width: bw, height: h, 'data-t': b.t }));
        if (inc.hit) band.append(svg('rect', { class: 'inhit', x: bx, y: mid, width: bw, height: Math.max(1, (inc.hit / scale) * half), 'data-t': b.t }));
      }
    });
    root.append(svg('line', { class: 'grid', x1: L, x2: W - R, y1: mid, y2: mid }));
    const bandLabel = (text, yy) => {
      const lab = svg('text', { class: 'axis', x: L - 5, y: yy, 'text-anchor': 'end' });
      lab.textContent = text;
      root.append(lab);
    };
    bandLabel('OUT', mid - 6);
    bandLabel('IN', mid + 12);
    root.append(band);

    // Kills and deaths along the band's foot.
    for (const k of detail?.kills ?? []) root.append(svg('line', { class: 'kill', x1: x(k), x2: x(k), y1: bandTop - 7, y2: bandTop - 1 }));
    for (const k of detail?.deaths ?? []) {
      const cx = x(k);
      const cy = bandTop - 4;
      root.append(svg('path', { class: 'death', d: `M${cx - 2.5} ${cy - 2.5}L${cx + 2.5} ${cy + 2.5}M${cx + 2.5} ${cy - 2.5}L${cx - 2.5} ${cy + 2.5}` }));
    }

    // The reference lines.
    const refLabel = (cls, v, text, dy = 0) => {
      root.append(svg('line', { class: cls, x1: L, x2: W - R, y1: y(v), y2: y(v) }));
      const lab = svg('text', { class: 'lbl', x: W - R + 4, y: y(v) + 3 + dy, fill: cls === 'final' ? 'var(--rp-gold)' : 'var(--rp-muted)' });
      lab.textContent = text;
      root.append(lab);
    };
    // Two labels closer than a line apart are pushed off each other.
    const gap = avg !== null && final.accuracy !== null ? y(avg) - y(final.accuracy) : Infinity;
    const push = Math.abs(gap) < 11 ? (11 - Math.abs(gap)) / 2 * Math.sign(gap || 1) : 0;
    if (avg !== null) refLabel('avg', avg, `avg ${Math.round(avg * 100)}%`, push);
    if (final.accuracy !== null) refLabel('final', final.accuracy, `${(final.accuracy * 100).toFixed(1)}%`, -push);

    // The curve: all of it faint, the part up to the playhead bright.
    let dot = null;
    if (series.length > 1) {
      const line = series.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)} ${y(p.accuracy ?? 0).toFixed(1)}`).join('');
      const area = `${line}L${x(series[series.length - 1].t).toFixed(1)} ${top + accH}L${x(series[0].t).toFixed(1)} ${top + accH}Z`;
      root.append(svg('path', { class: 'acc ghost', d: line }));
      const past = svg('g', { 'clip-path': 'url(#rp-accd-past)' });
      past.append(svg('path', { class: 'area', d: area }), svg('path', { class: 'acc', d: line }));
      root.append(past);
      dot = svg('circle', { class: 'dot', r: 4, cx: -10, cy: -10 });
    } else {
      const lab = svg('text', { class: 'axis', x: (L + W - R) / 2, y: top + accH / 2, 'text-anchor': 'middle' });
      lab.textContent = final.fired ? 'Too few of their rounds seen to draw their accuracy over time' : 'No rounds fired';
      root.append(lab);
    }
    // The future band's dimming and the playhead.
    const shade = svg('rect', { x: 0, y: bandTop, width: 0, height: bandH, fill: 'rgba(10,10,9,.55)' });
    root.append(shade);
    const now = svg('line', { class: 'now', x1: -10, x2: -10, y1: top, y2: bandTop + bandH });
    root.append(now);
    const hover = svg('line', { class: 'hover', x1: 0, x2: 0, y1: top, y2: bandTop + bandH });
    root.append(hover);
    if (dot) root.append(dot);

    // Hover reads out the moment; a click goes there.
    const tip = el('div', 'rp-accd-tip');
    const timeAt = ev => {
      const box = root.getBoundingClientRect();
      const vx = ((ev.clientX - box.left) / box.width) * W;
      return Math.max(0, Math.min(duration, ((vx - L) / (W - L - R)) * duration));
    };
    root.addEventListener('pointermove', ev => {
      const t = timeAt(ev);
      const at = totalsAt(entry, kind, t);
      const b = Math.min(out.length - 1, Math.floor(t / width));
      hover.setAttribute('x1', x(t));
      hover.setAttribute('x2', x(t));
      hover.style.opacity = '1';
      tip.textContent = '';
      tip.append(document.createTextNode(`${fmtClock(t)}  `));
      tip.append(el('b', '', at && at.fired >= WARM_UP ? `${at.estimated ? '~' : ''}${pct(at.accuracy)}` : '-'));
      tip.append(document.createTextNode(`  ${int(at?.fired ?? 0)} fired, ${int(at?.hit ?? 0)} hits`));
      tip.append(el('br'));
      tip.append(document.createTextNode(`${fmtClock(b * width)}-${fmtClock((b + 1) * width)}: ${out[b].fired} out, ${incoming[b].n} in`));
      const box = root.getBoundingClientRect();
      const left = ev.clientX - box.left;
      tip.style.left = `${Math.min(Math.max(0, left + 12), box.width - 220)}px`;
      tip.classList.add('on');
    });
    root.addEventListener('pointerleave', () => {
      hover.style.opacity = '0';
      tip.classList.remove('on');
    });
    root.addEventListener('click', ev => {
      ev.stopPropagation();
      this.player.seek?.(timeAt(ev));
      this.render(true);
    });
    return { svg: root, tip, x, y, clipRect, now, dot, shade, series, bandTop, bandH, W, R };
  }

  /** The chart's width in pixels: the dashboard's, less its padding. */
  chartWidth() {
    const w = this.dash?.clientWidth ?? 0;
    return w > 100 ? Math.max(300, Math.round(w - 50)) : 760;
  }

  movePlayhead(t) {
    const c = this.d?.chart;
    if (!c) return;
    const px = c.x(t);
    c.clipRect.setAttribute('width', Math.max(0, px));
    c.now.setAttribute('x1', px);
    c.now.setAttribute('x2', px);
    c.shade.setAttribute('x', px);
    c.shade.setAttribute('width', Math.max(0, c.W - c.R - px));
    if (c.dot) {
      let p = null;
      for (const s of c.series) {
        if (s.t > t) break;
        p = s;
      }
      c.dot.setAttribute('cx', p ? c.x(p.t) : -10);
      c.dot.setAttribute('cy', p ? c.y(p.accuracy ?? 0) : -10);
    }
  }

  weaponsPanel(entry, display) {
    const panel = el('div', 'rp-accd-panel');
    panel.append(heading('WEAPONS'));
    const bars = el('div', 'rp-accd-bars');
    const rows = entry.rows.filter(r => (this.kind === 'all' || r.kind === this.kind) && (r.fired || r.hit));
    const max = Math.max(1, ...rows.map(r => r.fired));
    for (const r of rows.slice(0, 8)) {
      const bar = el('div', 'rp-accd-bar');
      const num = el('span', 'num');
      num.append(el('b', '', pct(r.fired ? r.hit / r.fired : null)), document.createTextNode(`  ${int(r.hit)} / ${int(r.fired)}`));
      const track = el('div', 'track');
      const a = el('i');
      a.style.width = `${(r.fired / max) * 100}%`;
      const b = el('i');
      b.style.width = `${(Math.min(r.hit, r.fired) / max) * 100}%`;
      track.append(a, b);
      bar.append(el('span', 'nm', display(r.tmpl)), num, track);
      bars.append(bar);
    }
    if (!rows.length) bars.append(el('div', 'rp-accd-note', 'None on this board.'));
    panel.append(bars);
    return panel;
  }

  rangePanel(detail) {
    const panel = el('div', 'rp-accd-panel');
    panel.append(heading('HITS BY RANGE', this.kind !== 'all'));
    if (!detail) return panel;
    const hist = el('div', 'rp-accd-hist');
    const max = Math.max(1, ...detail.ranges.map(r => r.n));
    for (const r of detail.ranges) {
      const col = el('div');
      const bar = el('i');
      bar.style.height = `${(r.n / max) * 100}%`;
      col.append(el('b', '', r.n ? String(r.n) : ''), bar, el('span', '', r.to === Infinity ? `${r.from}+` : `${r.from}-${r.to}`));
      hist.append(col);
    }
    panel.append(hist);
    const { soldier, armour, air } = detail.targets;
    const total = soldier + armour + air;
    if (total) {
      const split = el('div', 'rp-accd-split');
      for (const [k, n] of [['soldier', soldier], ['armour', armour], ['air', air]]) {
        if (!n) continue;
        const i = el('i', k);
        i.style.width = `${(n / total) * 100}%`;
        i.title = `${n} on ${k === 'soldier' ? 'soldiers' : k === 'air' ? 'aircraft' : 'armour'}`;
        split.append(i);
      }
      const legend = el('div', 'rp-accd-legend');
      for (const [k, n, c, text] of [['soldier', soldier, 'var(--rp-gold)', 'soldiers'], ['armour', armour, 'var(--rp-khaki)', 'armour'], ['air', air, '#8fb7d6', 'aircraft']]) {
        const s = el('span', '', `${text} ${n}`);
        s.style.setProperty('--c', c);
        legend.append(s);
      }
      panel.append(split, legend);
    }
    const note = el('div', 'rp-accd-note', detail.meanDist !== null ? `Average bullet hit at ${metres(detail.meanDist)}. Metres, from the hits this recording saw.` : 'No bullet hits seen.');
    note.style.marginTop = '6px';
    panel.append(note);
    return panel;
  }

  /** Who he traded fire with: the men who fired most at him, and the men he hit most. */
  tradePanel(detail) {
    const panel = el('div', 'rp-accd-panel');
    panel.append(heading('UNDER FIRE', this.kind !== 'all'));
    if (!detail) return panel;
    const bars = el('div', 'rp-accd-bars');
    const list = detail.shooters.slice(0, 4);
    const max = Math.max(1, ...list.map(s => s.rounds));
    for (const s of list) {
      const bar = el('div', 'rp-accd-bar foe');
      const num = el('span', 'num');
      num.append(el('b', '', int(s.rounds)), document.createTextNode(` rounds, ${s.hits} hit`));
      const track = el('div', 'track');
      const a = el('i');
      a.style.width = `${(s.rounds / max) * 100}%`;
      const b = el('i');
      b.style.width = `${(Math.min(s.hits, s.rounds) / max) * 100}%`;
      track.append(a, b);
      bar.append(el('span', `nm t${team(s.team)}`, s.name), num, track);
      bars.append(bar);
    }
    if (!list.length) bars.append(el('div', 'rp-accd-note', 'No enemy rounds seen passing near them.'));
    panel.append(bars);
    const facts = el('dl', 'rp-accd-facts');
    facts.style.marginTop = '8px';
    const fact = (k, v) => facts.append(el('dt', '', k), el('dd', '', v));
    fact('Rounds at them', int(countBy(detail.incoming, Infinity)));
    fact('Hits taken', int(detail.hitsTaken));
    if (detail.closest) fact('Closest miss', `${detail.closest.miss.toFixed(1)} m, ${detail.closest.by}`);
    if (detail.victims[0]) fact('Hit most', `${detail.victims[0].name} (${detail.victims[0].hits})`);
    panel.append(facts);
    return panel;
  }

  triggerPanel(entry, detail) {
    const panel = el('div', 'rp-accd-panel');
    panel.append(heading('TRIGGER'));
    if (!detail) return panel;
    const facts = el('dl', 'rp-accd-facts');
    const fact = (k, v) => facts.append(el('dt', '', k), el('dd', '', v));
    const seen = (entry.shots ?? []).reduce((n, s) => n + s.n, 0);
    fact('Bursts', int(detail.bursts));
    fact('Rounds a burst', detail.bursts ? (seen / detail.bursts).toFixed(1) : '-');
    fact('Longest burst', `${int(detail.longestBurst)} rounds`);
    fact('Hits in a row', int(detail.bestStreak));
    const final = totalsOf(entry, this.kind);
    fact('Rounds a hit', final.hit ? (final.fired / final.hit).toFixed(1) : '-');
    const kills = detail.kills.length;
    fact('Hits a kill', kills ? (final.hit / kills).toFixed(1) : '-');
    panel.append(facts);
    if (entry.source === 'server' && seen < entry.fired) {
      const note = el('div', 'rp-accd-note', `This recording saw ${int(seen)} of their ${int(entry.fired)} rounds.`);
      note.style.marginTop = '6px';
      panel.append(note);
    }
    return panel;
  }

  renderFoot(board) {
    const rec = this.player.rec;
    const rebuilt = board.some(p => p.source === 'rebuilt');
    const counted = rec.hitsGiven?.length
      ? 'Hits as the server counted them during the round.'
      : rec.roundStats?.size ? 'Whole-round numbers are the server\'s round-end tally; "so far" spreads them as this recording saw each player fire (marked ~).'
        : rec.hitMarks?.size ? 'The recording player\'s hits are the server\'s own hit marks.' : '';
    const text = [counted, rebuilt
      ? (counted ? 'Rows marked rebuilt are counted from what this recording saw.' : 'Counted from what this recording saw: the server\'s count is not in it.')
      : '', 'Ranges, targets and rounds fired at them are from what this recording saw. Click the graph to go to that moment.'].filter(Boolean).join(' ');
    if (this.foot.textContent !== text) this.foot.textContent = text;
  }
}

/** A panel's heading: its numbers are the whole round's. */
function heading(text, allWeapons = false) {
  const h = el('h4', '', text);
  h.append(el('span', 'whole', allWeapons ? 'WHOLE ROUND, ALL WEAPONS' : 'WHOLE ROUND'));
  return h;
}

/** Everyone's hits over everyone's rounds on `kind`, whole round. */
function roundAverage(board, kind) {
  let fired = 0;
  let hit = 0;
  for (const p of board) {
    const t = totalsOf(p, kind);
    fired += t.fired;
    hit += t.hit;
  }
  return fired > 0 ? hit / fired : null;
}

function niceCeil(v) {
  for (const s of [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.8, 1]) if (v <= s) return s;
  return 1;
}

function niceStep(duration, ticks = 8) {
  for (const s of [60, 120, 180, 300, 600, 900, 1200, 1800, 3600]) if (duration / s <= ticks) return s;
  return 7200;
}
