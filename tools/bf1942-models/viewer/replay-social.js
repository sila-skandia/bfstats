// A shared recording's life in the replay (features/replay-feed): the view it
// counts, the place a link starts it (`&t=21`), its comments beside the round
// with each time in them a place to jump to, their marks along the timeline,
// and the comments coming up as the round passes the moment they name. The
// uploader, or an admin, can make the frame on screen the recording's cover
// (F, or the menu).
//
// And the way in for a recording opened from disk: Share puts it in the
// REPLAY feed from here, with the frame F picked, or else the frame on
// screen, as its cover, and the page carries on as the shared recording,
// comments and all.
//
// A round several players shared plays merged (`?replay=` once per recording,
// features/replay-feed "Rounds"). Its comments stay on each recording, in that
// recording's own clock: here every recording's are shown together, each moved
// onto the merged clock by the header's `merged[i]`, and one written here goes on
// the recording whose stretch holds the moment it names (recordings-api.js
// `commentTarget`). Each recording counts a view; the cover and the way back to
// the feed are the first recording's.
//
// A recording of such a round, merged or alone, has a switch on the bar:
// Merged, or each recording alone, going there at the moment on screen
// (recordings-api.js `roundMoment`). One opened alone offers Watch merged; a
// set the merge refused (two rounds, replay-merge-guard.js) says why there.
//
// Its uploader, or an admin, can also rename the recording or delete it from
// the menu (the first recording's, when several play merged, as the cover is);
// deleted, the page goes back to the feed.
//
// The replay's own chrome (replay-ui.js) is not changed: this adds a button
// to its bar, a panel and marks to its root and timeline, and items to its
// menu, and gives its F the cover (`useFrameKey`), through the page's
// `opened(player)` hook, the way replay-open.js adds the bar's date and Open
// button.

import {
  ago, apiMode, clock, commentRuns, commentTarget, count, readableQuery, resolveApi, roundMoment, sharedRecordingsApi,
  roundRuns, sharedRecordingOf, shortHref, sourceClock, watchHref, watchRoundHref,
} from './recordings-api.js';
import { isLocalReplay, readLocalRecording } from './replay-open.js';
import { recorderName } from './replay-chapters.js';

/** A comment comes up this long as the round passes its moment, seconds. */
const BUBBLE_SECONDS = 5;
/** At most this many up at once. */
const BUBBLES = 3;
/** A jump in the clock bigger than this is a seek, which passes nothing. */
const SEEK_JUMP = 2;
const COVER_W = 640;
const COVER_H = 360;

const ICON = {
  chat: '<path d="M2.5 3.2h11v7.2H7.2L4.3 13v-2.6H2.5z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
  share: '<circle cx="12" cy="3.6" r="1.9" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="4" cy="8" r="1.9" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="12" cy="12.4" r="1.9" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M5.7 7.1 10.3 4.5M5.7 8.9l4.6 2.6" fill="none" stroke="currentColor" stroke-width="1.4"/>',
  close: '<path d="M3.5 3.5l9 9M12.5 3.5l-9 9" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  frame: '<rect x="2" y="3.5" width="12" height="9" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="8" r="2.2" fill="none" stroke="currentColor" stroke-width="1.4"/>',
  deck: '<rect x="1.8" y="5.2" width="9" height="7" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M4.6 3.2h8.4a1 1 0 0 1 1 1v6.3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M5.2 7.3v2.9l2.6-1.45z" fill="currentColor"/>',
  play: '<path d="M5 3.2v9.6L13 8z" fill="currentColor"/>',
  pencil: '<path d="M10.6 2.6l2.8 2.8-7.6 7.6H3v-2.8z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
  trash: '<path d="M3 4.5h10M6.3 4.5V3h3.4v1.5M4.4 4.5l.7 8.7h5.8l.7-8.7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
  link: '<path d="M6.6 9.4l2.8-2.8M7.5 4.7l1.2-1.2a2.6 2.6 0 0 1 3.7 3.7l-1.2 1.2M8.5 11.3l-1.2 1.2a2.6 2.6 0 0 1-3.7-3.7l1.2-1.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
};
const svg = name => `<svg viewBox="0 0 16 16" aria-hidden="true">${ICON[name] ?? ''}</svg>`;

// In the replay chrome's look, on its own variables (`.rp-root`).
const STYLE = `
.rs-count { min-width: 16px; padding: 0 4px; border-radius: 8px; background: rgba(255, 255, 255, .12); font: 700 10px/16px var(--rp-mono); }
.rp-btn.on .rs-count { background: rgba(0, 0, 0, .18); }
.rs-panel { position: absolute; right: 12px; top: var(--rp-log-top); bottom: calc(var(--rp-bar-h) + 22px); width: min(380px, calc(100% - 24px));
  display: none; flex-direction: column; font: 12px/1.45 var(--rp-font); }
.rp-root.rs-open .rs-panel { display: flex; }
.rs-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rs-list { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 4px 0; -webkit-user-select: text; user-select: text;
  scrollbar-width: thin; scrollbar-color: rgba(200, 194, 152, .38) transparent; }
.rs-item { padding: 6px 12px; border-bottom: 1px solid rgba(200, 194, 152, .1); }
.rs-item.now { background: rgba(232, 195, 90, .1); box-shadow: inset 2px 0 0 var(--rp-gold); }
.rs-who { display: flex; align-items: baseline; gap: 6px; color: var(--rp-muted); font-size: 11px; }
.rs-who b { color: var(--rp-ink); font-size: 12px; }
.rs-who .rs-del { margin-left: auto; appearance: none; border: 0; background: none; padding: 0 2px; color: var(--rp-muted); font: inherit;
  cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
.rs-who .rs-del:hover { color: var(--rp-ink); }
.rs-text { margin: 2px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.rs-time { appearance: none; border: 0; padding: 0; background: none; color: #9fc3ff; font: 700 12px/1.45 var(--rp-mono); cursor: pointer; }
.rs-time:hover { text-decoration: underline; }
.rs-empty { padding: 14px 12px; color: var(--rp-muted); }
.rs-compose { display: grid; gap: 6px; padding: 8px 10px 10px; border-top: 1px solid var(--rp-edge); }
.rs-compose textarea, .rs-compose input, .rs-compose select { width: 100%; min-width: 0; margin: 0; padding: 6px 8px; border: 1px solid rgba(200, 194, 152, .42);
  border-radius: 5px; background: rgba(0, 0, 0, .3); color: var(--rp-ink); font: 12px/1.4 var(--rp-font); }
.rs-compose textarea { min-height: 48px; resize: vertical; }
.rs-compose select { width: auto; }
.rs-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.rs-row .rs-hint { flex: 1 1 auto; color: var(--rp-muted); font-size: 11px; }
.rs-go { appearance: none; height: 26px; padding: 0 10px; border: 1px solid var(--rp-khaki); border-radius: 5px; background: var(--rp-khaki);
  color: var(--rp-khaki-ink); font: 700 11px/1 var(--rp-font); letter-spacing: .08em; text-transform: uppercase; cursor: pointer; }
.rs-go:hover { background: var(--rp-edge-strong); }
.rs-go.quiet { background: transparent; color: var(--rp-ink); border-color: var(--rp-edge); }
.rs-go.destroy { background: #c46f3e; border-color: #c46f3e; color: #1c1008; }
.rs-go.destroy:hover { background: #d9824a; border-color: #d9824a; }
.rs-go:disabled { opacity: .45; cursor: default; }
.rs-error { color: #f2c25a; font-size: 11px; }
.rs-marks { position: absolute; left: 0; right: 0; top: 27px; height: 5px; pointer-events: none; }
.rs-mk { position: absolute; top: 0; width: 8px; height: 5px; margin-left: -4px; padding: 0; border: 0; border-radius: 2px;
  background: #cfe0ff; opacity: .85; box-shadow: 0 0 0 1px rgba(0, 0, 0, .45); pointer-events: auto; cursor: pointer; }
.rs-mk:hover { opacity: 1; transform: scaleY(1.6); }
.rs-bubbles { position: absolute; left: 12px; bottom: calc(var(--rp-bar-h) + 24px); display: flex; flex-direction: column; gap: 6px;
  max-width: min(360px, calc(100% - 24px)); pointer-events: none; }
.rs-bubble { padding: 6px 10px; border-radius: 8px; background: rgba(20, 20, 17, .86); border: 1px solid var(--rp-edge);
  box-shadow: 0 6px 18px rgba(0, 0, 0, .4); overflow-wrap: anywhere; animation: rs-in .25s ease both; }
.rs-bubble b { color: var(--rp-gold); margin-right: 6px; }
.rs-bubble.out { animation: rs-out .4s ease both; }
.rp-root.rp-bare .rs-bubbles { display: none; }
@keyframes rs-in { from { opacity: 0; transform: translateY(6px); } }
@keyframes rs-out { to { opacity: 0; transform: translateY(-4px); } }
.rs-shade { position: absolute; inset: 0; z-index: 8; display: grid; place-items: center; padding: 16px; background: rgba(6, 6, 5, .55);
  pointer-events: auto; }
.rs-shade[hidden] { display: none; }
.rs-dialog { width: min(420px, 100%); display: flex; flex-direction: column; }
.rs-dialog .rs-compose { border-top: 0; padding: 12px; gap: 10px; }
.rs-dialog label > span { display: block; margin-bottom: 4px; color: var(--rp-muted); font: 700 10px/1 var(--rp-font); letter-spacing: .12em; text-transform: uppercase; }
.rs-cover { width: 100%; aspect-ratio: 16 / 9; border-radius: 5px; border: 1px solid var(--rp-edge); background: #000 center / cover no-repeat; }
.rs-ask { margin: 0; color: var(--rp-ink); font: 700 13px/1.4 var(--rp-font); overflow-wrap: anywhere; }
/* The recording's items in the menu: Copy link, and for its uploader the cover, Rename, Delete. */
.rs-menu-rule { flex: none; height: 1px; margin: 3px 6px; background: var(--rp-edge); }
/* The round's switch: merged, or each recording alone. Its menu is the bar's
   own (.rp-more-menu), opening upward. */
.rs-view { position: relative; }
.rs-view-menu { position: absolute; z-index: 5; right: -4px; bottom: calc(100% + 8px); display: none; flex-direction: column; gap: 1px;
  width: max-content; min-width: 250px; max-width: min(340px, calc(100vw - 24px)); padding: 4px; background: var(--rp-plate-menu);
  border: 1px solid var(--rp-edge); border-radius: 6px; box-shadow: 0 8px 24px rgba(0, 0, 0, .5); }
.rs-view.open .rs-view-menu { display: flex; }
.rs-view-head { padding: 3px 8px 6px; margin-bottom: 3px; border-bottom: 1px solid var(--rp-edge); color: var(--rp-muted);
  font: 700 9px/1.4 var(--rp-font); letter-spacing: .12em; text-transform: uppercase; }
.rp-mi.rs-view-mi { height: auto; min-height: 38px; padding: 5px 8px; text-decoration: none; white-space: normal; }
.rs-view-mi > span { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.rs-view-mi i { font-style: normal; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rs-view-mi .rs-name { text-transform: none; letter-spacing: .02em; font-size: 12px; }
.rs-view-mi small { color: var(--rp-muted); font: 400 11px/1.35 var(--rp-font); letter-spacing: 0; text-transform: none; }
.rp-mi.rs-view-mi.off { cursor: default; }
.rp-mi.rs-view-mi.off:hover { background: none; }
.rs-view-mi.off > svg, .rs-view-mi.off i { opacity: .55; }
.rs-view-mi.off small { color: #f2c25a; }
.rs-view-btn .rs-warn { display: inline-block; width: 6px; height: 6px; margin-left: -1px; border-radius: 50%; background: #f2c25a;
  box-shadow: 0 0 6px #f2c25a; }
@media (max-width: 720px) {
  .rs-panel { top: auto; height: 46%; }
  .rs-bubbles { bottom: calc(var(--rp-bar-h) + 70px); }
}
/* A phone on its side: little height, so the panel starts at the top, as the
   replay's own board and help do, and the box is one line until it grows. */
@media (max-height: 500px) {
  .rs-panel { top: 8px; height: auto; }
  .rs-compose { padding: 6px 8px 8px; }
  .rs-compose textarea { min-height: 32px; height: 32px; }
}
@media (prefers-reduced-motion: reduce) { .rs-bubble, .rs-bubble.out { animation: none; } }
`;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** The frame on `canvas`, cropped to 16:9 and scaled to the cover's size, as a JPEG. */
function frameOf(canvas) {
  const out = document.createElement('canvas');
  out.width = COVER_W;
  out.height = COVER_H;
  const ctx = out.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const scale = Math.max(COVER_W / w, COVER_H / h);
  const sw = COVER_W / scale;
  const sh = COVER_H / scale;
  ctx.drawImage(canvas, (w - sw) / 2, (h - sh) / 2, sw, sh, 0, 0, COVER_W, COVER_H);
  return new Promise(resolve => out.toBlob(resolve, 'image/jpeg', 0.86));
}

/**
 * @param {object} options
 * @param {string} options.replayUrl   the page's `?replay=`
 * @param {string[]} [options.replayUrls]  every `?replay=`: several are one
 *                                     round's recordings, merged
 * @param {URLSearchParams} [options.params]
 * @param {URL} [options.menuUrl]      where the page's way back to the menu
 *                                     goes: a shared recording's page in the feed
 * @param {() => string} [options.levelName]  the level on screen
 * @param {() => string} [options.modId]      the page's mod
 */
export function installReplaySocial({ replayUrl, replayUrls = [replayUrl], params = new URLSearchParams(location.search),
  menuUrl = null, levelName = () => '', modId = () => 'bf1942' } = {}) {
  const local = isLocalReplay(replayUrl);
  const shared = sharedRecordingOf(replayUrl);
  if (!shared && !local) return null;
  // The other recordings of the round, when the page merges several of one API's.
  const others = shared && replayUrls.length > 1 ? replayUrls.slice(1).map(u => sharedRecordingOf(u)) : [];
  const alsoShared = others.length && others.every(o => o && o.base === shared.base) ? others.map(o => o.slug) : [];
  if (!document.getElementById('rs-style')) {
    const style = el('style');
    style.id = 'rs-style';
    style.textContent = STYLE;
    document.head.append(style);
  }

  let slug = shared?.slug ?? null;
  let api = shared ? sharedRecordingsApi({ base: shared.base, mode: apiMode(shared.base) }) : null;
  let detail = null;
  // The recordings whose comments show: the one played, or each of a merged round's.
  let members = slug ? [slug, ...alsoShared].map(s => ({ slug: s, detail: null })) : [];
  let comments = [];        // each with `member`, its recording's index in `members`
  let commentTotal = 0;
  let viewer = null;
  let player = null;
  let ui = null;
  let counted = false;
  let started = false;
  let pendingCapture = null;
  let chosenCover = null;        // a recording from disk: the frame F picked for Share
  let coverBusy = false;
  let lastTime = null;
  const startAt = Number(params.get('t'));

  const nodes = {};

  function pointMenuAtFeed() {
    if (!menuUrl || !slug) return;
    menuUrl.searchParams.set('tab', 'replay');
    menuUrl.searchParams.set('rec', slug);
    menuUrl.searchParams.delete('mod');
  }
  pointMenuAtFeed();

  async function loadShared() {
    if (!api || !slug) return;
    await api.ready();
    viewer = api.signedIn ? await api.viewer().catch(() => null) : null;
    const details = await Promise.all(members.map(m => api.get(m.slug).catch(error => {
      console.warn('replay-social: the recording', m.slug, error);
      return null;
    })));
    members.forEach((m, i) => { m.detail = details[i]; });
    detail = details[0];
    if (!detail) return;
    if (player) dressShared();
    await loadComments();
  }

  async function loadComments() {
    const pages = await Promise.all(members.map((m, i) => (m.detail || i === 0
      ? api.comments(m.slug, { sort: 'time', pageSize: 200 }).catch(error => {
        console.warn('replay-social: comments', m.slug, error);
        return null;
      })
      : null)));
    comments = pages.flatMap((page, i) => (page?.items ?? []).map(c => ({ ...c, member: i })));
    commentTotal = pages.reduce((sum, page) => sum + (page?.totalCount ?? 0), 0);
    if (detail && pages[0]) detail.commentCount = pages[0].totalCount;
    renderComments();
    renderMarks();
    syncCount();
  }

  // --- a merged round's clocks -----------------------------------------------------

  /** The merged header's sources, one per `replay` of the page, when this page
   *  merged them; else null: one recording (which may itself be a merged file,
   *  its comments already in its own clock), or a merge that fell back to the
   *  first. Member i is source i: the members are the page's recordings in its
   *  order, or the first alone. */
  function mergedSources() {
    const merged = replayUrls.length > 1 ? player?.rec.merged : null;
    return merged?.length === replayUrls.length ? merged : null;
  }

  /** Where a comment's moment is on the page's clock, or null for none. */
  function atOf(comment) {
    if (comment.atSeconds === null || comment.atSeconds === undefined) return null;
    const merged = mergedSources();
    return merged ? sourceClock(merged[comment.member]).toRound(comment.atSeconds) : comment.atSeconds;
  }

  /** The comments this page shows, in round order: every member's when merged,
   *  else the one's. */
  function shownComments() {
    const merged = mergedSources();
    return comments.filter(c => merged || c.member === 0)
      .sort((a, b) => (atOf(a) ?? Infinity) - (atOf(b) ?? Infinity) || a.member - b.member || a.id - b.id);
  }

  const memberDuration = i => members[i]?.detail?.durationSeconds ?? Infinity;

  // --- the bar and the panel ------------------------------------------------------

  function dressShared() {
    if (!ui || nodes.panel) return;
    const title = detail?.title;
    if (title) document.title = `${title} · replay`;
    nodes.button = ui.button('rs-comments', null, 'Comments (T)', () => toggle(), `${svg('chat')}<span class="rs-count">0</span>`);
    ui.logBtn.before(nodes.button);
    const panel = el('div', 'rp-panel rs-panel');
    const head = el('div', 'rp-panel-head');
    const heading = el('span', 'rs-title', 'Comments');
    head.append(heading, ui.button('', 'close', 'Close (T)', () => toggle(false)));
    nodes.heading = heading;
    nodes.list = el('div', 'rs-list');
    nodes.compose = el('div', 'rs-compose');
    panel.append(head, nodes.list, nodes.compose);
    ui.root.append(panel);
    nodes.panel = panel;
    nodes.marks = el('div', 'rs-marks');
    ui.timeline.el.append(nodes.marks);
    nodes.bubbles = el('div', 'rs-bubbles');
    ui.root.append(nodes.bubbles);
    addLinkItem();
    if (detail?.canManage) addOwnItems();
    buildSwitch();
    // One panel on the right at a time: the replay log opening shuts this.
    new MutationObserver(() => {
      if (ui.root.classList.contains('log-open') && ui.root.classList.contains('rs-open')) toggle(false);
    }).observe(ui.root, { attributes: true, attributeFilter: ['class'] });
    renderCompose();
    renderComments();
    renderMarks();
    syncCount();
  }

  // --- the round's switch: merged, or each recording alone -----------------------

  /** The round the page's recordings are of, as the first's page lists it
   *  (every recording of it in the feed), or null for a recording alone. */
  function roundList() {
    const round = members[0]?.detail?.round;
    return Array.isArray(round) && round.length > 1 ? round : null;
  }

  /** The page's recordings, by slug, in its order. */
  const pageSlugs = () => replayUrls.map(u => sharedRecordingOf(u)?.slug ?? null);

  /** The page's own address for watching `to` (a slug, or 'merged' led by
   *  what plays first) from the moment on screen. */
  function switchHref(round, to) {
    const slugs = pageSlugs();
    const at = player ? roundMoment(round, { slugs, sources: mergedSources() }, to, player.time) : null;
    const place = { mod: detail.mod, level: detail.level };
    const fileUrl = path => api.fileUrl(path);
    if (to === 'merged') {
      const lead = round.find(m => m.slug === slugs[0]) ?? round[0];
      return watchRoundHref({ ...lead, ...place }, round, { root: './', fileUrl, at });
    }
    return watchHref({ ...round.find(m => m.slug === to), ...place }, { root: './', fileUrl, at });
  }

  /** The switch on the bar, for a recording of a round of several: what plays
   *  (Merged, or Alone) and how many recordings the round has; its menu goes to
   *  Merged or to each recording alone. A merge that was asked for and refused
   *  (`player.notMerged`) marks it, and its Merged says why. */
  function buildSwitch() {
    const round = roundList();
    if (!round || !ui || !nodes.button || nodes.view) return;
    const merged = Boolean(mergedSources());
    const refused = !merged && replayUrls.length > 1 ? player?.notMerged?.message ?? 'The recordings could not be merged.' : null;
    const wrap = el('div', 'rs-view');
    const label = `${merged ? 'Merged' : 'Alone'}: ${round.length} recordings of this round`;
    // Each item's address, at the moment on screen (for a middle click too).
    const refresh = [];
    const btn = ui.button('rs-view-btn', null, `${label}. Watch them merged or each alone`, () => {
      const open = !wrap.classList.contains('open');
      ui.closeMore?.();
      if (open) for (const fn of refresh) fn();
      wrap.classList.toggle('open', open);
      btn.classList.toggle('on', open);
      btn.setAttribute('aria-expanded', String(open));
    }, `${svg('deck')}<span class="rp-label">${merged ? 'Merged' : 'Alone'}</span><small>${round.length}</small>${refused ? '<i class="rs-warn"></i>' : ''}`);
    btn.setAttribute('aria-haspopup', 'menu');
    btn.setAttribute('aria-expanded', 'false');
    const menu = el('div', 'rs-view-menu');
    menu.setAttribute('role', 'menu');
    menu.append(el('div', 'rs-view-head', `This round: ${count(round.length, 'recording')}`));
    const playing = pageSlugs()[0];
    const item = (to, icon, name, note, { on = false, off = false } = {}) => {
      const a = el('a', `rp-mi rs-view-mi${on ? ' on' : ''}${off ? ' off' : ''}`);
      a.setAttribute('role', 'menuitemradio');
      a.setAttribute('aria-checked', String(on));
      a.innerHTML = `${svg(icon)}<span><i class="${to === 'merged' ? '' : 'rs-name'}"></i><small></small></span>${on ? '<b>ON</b>' : ''}`;
      a.querySelector('i').textContent = name;
      a.querySelector('small').textContent = note;
      if (off) a.setAttribute('aria-disabled', 'true');
      else {
        // The moment on screen when it is picked, not when the menu was drawn.
        const update = () => { a.href = switchHref(round, to); };
        update();
        refresh.push(update);
        a.addEventListener('pointerenter', update);
        a.addEventListener('focus', update);
      }
      a.addEventListener('click', e => {
        e.stopPropagation();
        if (off || on) {
          e.preventDefault();
          if (on) wrap.classList.remove('open');
          return;
        }
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault();
        location.assign(switchHref(round, to));
      });
      menu.append(a);
    };
    item('merged', 'deck', merged ? 'Merged' : 'Watch merged',
      refused ? `Not merged. ${refused}` : `${round.length === 2 ? 'Both' : `All ${round.length}`} recordings as one round`,
      { on: merged, off: Boolean(refused) });
    for (const member of round) {
      const by = member.recordedBy && member.recordedBy !== member.uploaderName ? `recorded by ${member.recordedBy} · ` : '';
      item(member.slug, 'play', member.uploaderName || member.recordedBy || member.title, `${by}${clock(member.durationSeconds)} alone`,
        { on: !merged && member.slug === playing });
    }
    wrap.append(btn, menu);
    nodes.button.before(wrap);
    nodes.view = wrap;
    // A press anywhere else shuts it.
    document.addEventListener('pointerdown', e => {
      if (wrap.classList.contains('open') && !wrap.contains(e.target)) {
        wrap.classList.remove('open');
        btn.classList.remove('on');
        btn.setAttribute('aria-expanded', 'false');
      }
    }, true);
  }

  function syncCount() {
    const n = mergedSources() ? commentTotal : detail?.commentCount ?? comments.length;
    const badge = nodes.button?.querySelector('.rs-count');
    if (badge) badge.textContent = String(n);
    if (nodes.heading) nodes.heading.textContent = n ? count(n, 'comment') : 'Comments';
  }

  function toggle(on = !ui.root.classList.contains('rs-open')) {
    if (!ui) return;
    // Out of the hidden HUD, the comments bring it back (replay-ui.js `toggle`).
    if (on) ui.setBare?.(false, true);
    if (on) ui.root.classList.remove('log-open');
    ui.root.classList.toggle('rs-open', on);
    nodes.button?.classList.toggle('on', on);
    if (on) {
      ui.closeMore?.();
      scrollToNow();
    }
  }

  function jump(t) {
    if (!player) return;
    player.seek(t);
    lastTime = player.time;
    ui?.activity?.();
  }

  function textWithTimes(comment) {
    const p = el('p', 'rs-text');
    const merged = mergedSources();
    // On a merged round each time is said on the round's clock, where it jumps to.
    const runs = merged
      ? roundRuns(comment.content, merged[comment.member], memberDuration(comment.member))
      : commentRuns(comment.content, player?.rec.duration ?? Infinity);
    for (const run of runs) {
      if (run.at === undefined) {
        p.append(document.createTextNode(run.text));
        continue;
      }
      const b = el('button', 'rs-time', run.text);
      b.type = 'button';
      b.title = `Go to ${clock(run.at)}`;
      b.addEventListener('click', e => { e.stopPropagation(); jump(run.at); });
      p.append(b);
    }
    return p;
  }

  function renderComments() {
    if (!nodes.list) return;
    nodes.list.replaceChildren();
    const shown = shownComments();
    if (!shown.length) {
      nodes.list.append(el('div', 'rs-empty', 'No comments yet. A time in yours, like 0:21, jumps there.'));
      return;
    }
    const merged = mergedSources();
    for (const comment of shown) {
      const item = el('div', 'rs-item');
      item.dataset.id = `${comment.member}:${comment.id}`;
      const at = atOf(comment);
      if (at !== null) item.dataset.at = String(at);
      const who = el('div', 'rs-who');
      who.append(el('b', '', comment.authorName), document.createTextNode(ago(comment.createdAt)));
      // Whose recording it is on, when several play as one.
      const owner = merged && members[comment.member]?.detail?.uploaderName;
      if (owner) who.append(document.createTextNode(` · on ${owner}'s`));
      if (comment.canDelete) {
        const del = el('button', 'rs-del', 'remove');
        del.type = 'button';
        del.addEventListener('click', async e => {
          e.stopPropagation();
          del.disabled = true;
          try {
            await api.removeComment(members[comment.member]?.slug ?? slug, comment.id);
            comments = comments.filter(c => c !== comment);
            commentTotal = Math.max(0, commentTotal - 1);
            if (comment.member === 0 && detail) detail.commentCount = Math.max(0, detail.commentCount - 1);
            renderComments();
            renderMarks();
            syncCount();
          } catch (error) {
            del.disabled = false;
            ui.flash(error.message, 2500);
          }
        });
        who.append(del);
      }
      item.append(who, textWithTimes(comment));
      nodes.list.append(item);
    }
    highlightNow();
  }

  /** The comment nearest before the playhead, lit. */
  function highlightNow() {
    if (!nodes.list || !player) return;
    let now = null;
    for (const item of nodes.list.children) {
      const at = Number(item.dataset.at);
      if (item.dataset.at !== undefined && at <= player.time) now = item;
      item.classList.remove('now');
    }
    now?.classList.add('now');
    return now;
  }

  function scrollToNow() {
    highlightNow()?.scrollIntoView({ block: 'center' });
  }

  function renderMarks() {
    if (!nodes.marks || !player) return;
    nodes.marks.replaceChildren();
    const duration = Math.max(0.001, player.rec.duration);
    for (const comment of shownComments()) {
      const at = atOf(comment);
      if (at === null) continue;
      const mark = el('button', 'rs-mk');
      mark.type = 'button';
      mark.tabIndex = -1;
      mark.style.left = `${Math.min(100, Math.max(0, (at / duration) * 100))}%`;
      mark.title = `${clock(at)}  ${comment.authorName}: ${comment.content}`;
      mark.setAttribute('aria-label', mark.title);
      // Its own press: the timeline under it would scrub.
      mark.addEventListener('pointerdown', e => e.stopPropagation());
      mark.addEventListener('click', e => {
        e.stopPropagation();
        jump(at);
        toggle(true);
      });
      nodes.marks.append(mark);
    }
  }

  // --- writing a comment -----------------------------------------------------------

  function renderCompose() {
    const box = nodes.compose;
    if (!box) return;
    box.replaceChildren();
    if (!api.canWrite) {
      box.append(el('div', 'rs-hint', 'Comments are read-only on this page.'));
      return;
    }
    if (!api.signedIn) {
      const row = el('div', 'rs-row');
      const go = el('button', 'rs-go', api.mode === 'local' ? 'Sign in (dev)' : 'Sign in to comment');
      go.type = 'button';
      go.addEventListener('click', () => signIn());
      row.append(el('span', 'rs-hint', 'Sign in with Discord to comment.'), go);
      box.append(row);
      return;
    }
    const names = viewer?.names ?? [];
    if (!names.length) {
      const input = el('input');
      input.placeholder = 'Your in-game name';
      input.maxLength = 32;
      const go = el('button', 'rs-go', 'Use this name');
      go.type = 'button';
      go.addEventListener('click', async () => {
        if (!input.value.trim()) return;
        go.disabled = true;
        try {
          viewer = await api.linkName(input.value.trim());
          renderCompose();
        } catch (error) {
          go.disabled = false;
          ui.flash(error.message, 2500);
        }
      });
      const row = el('div', 'rs-row');
      row.append(input, go);
      box.append(el('span', 'rs-hint', 'Comments go up under your in-game name.'), row);
      return;
    }
    const text = el('textarea');
    text.maxLength = 1000;
    text.placeholder = 'Add a comment. A time like 0:21 jumps there.';
    text.setAttribute('aria-label', 'Comment');
    // The moment on screen, put in front of what is written about it.
    text.addEventListener('focus', () => {
      if (!text.value && player) text.value = `${clock(player.time)} `;
    });
    const as = el('select');
    as.setAttribute('aria-label', 'Post as');
    for (const name of names) as.append(new Option(name, name));
    try {
      const kept = localStorage.getItem('bf42-mesh-post-as');
      if (kept && names.includes(kept)) as.value = kept;
    } catch {}
    as.disabled = names.length === 1;
    const go = el('button', 'rs-go', 'Post');
    go.type = 'button';
    const post = async () => {
      const content = text.value.trim();
      if (!content || go.disabled) return;
      go.disabled = true;
      try {
        // On a merged round, the recording whose stretch holds the moment it names,
        // its times said on that recording's clock.
        const merged = mergedSources();
        const target = merged
          ? commentTarget(content, merged.slice(0, members.length).map((m, i) => ({ ...m, duration: memberDuration(i) })))
          : { index: 0, text: content };
        const comment = await api.comment(members[target.index]?.slug ?? slug, target.text, as.value);
        try { localStorage.setItem('bf42-mesh-post-as', as.value); } catch {}
        comments = [...comments, { ...comment, member: target.index }];
        commentTotal += 1;
        if (target.index === 0 && detail) detail.commentCount += 1;
        text.value = '';
        text.blur();
        renderComments();
        renderMarks();
        syncCount();
        nodes.list.querySelector(`[data-id="${target.index}:${comment.id}"]`)?.scrollIntoView({ block: 'nearest' });
      } catch (error) {
        ui.flash(error.message, 3000);
      } finally {
        go.disabled = false;
      }
    };
    go.addEventListener('click', post);
    nodes.post = post;
    nodes.text = text;
    const row = el('div', 'rs-row');
    row.append(el('span', 'rs-hint', 'Posting as'), as, go);
    box.append(text, row);
  }

  async function signIn() {
    if (api.mode === 'same') {
      // Back to this moment of the round after signing in.
      const back = new URL(location.href);
      if (player) back.searchParams.set('t', String(Math.floor(player.time)));
      history.replaceState(history.state, '', back);
    }
    try {
      if (await api.signIn()) {
        viewer = await api.viewer({ fresh: true }).catch(() => null);
        renderCompose();
        loadComments();
        // Whether this viewer may set its cover, rename or delete it.
        const fresh = slug ? await api.get(slug).catch(() => null) : null;
        if (fresh) {
          detail = fresh;
          members[0].detail = fresh;
          if (fresh.canManage) addOwnItems();
        }
      }
    } catch (error) {
      ui?.flash(error.message, 3000);
    }
  }

  // --- the round passing the comments ----------------------------------------------

  function bubble(comment) {
    if (!nodes.bubbles) return;
    const b = el('div', 'rs-bubble');
    b.append(el('b', '', comment.authorName));
    const words = comment.content.replace(/\s+/g, ' ');
    b.append(document.createTextNode(words.length > 160 ? `${words.slice(0, 157)}...` : words));
    nodes.bubbles.append(b);
    while (nodes.bubbles.children.length > BUBBLES) nodes.bubbles.firstChild.remove();
    setTimeout(() => {
      b.classList.add('out');
      setTimeout(() => b.remove(), 450);
    }, BUBBLE_SECONDS * 1000 / Math.max(1, player?.speed ?? 1));
  }

  function tick() {
    requestAnimationFrame(tick);
    if (!player) return;
    // Loaded: the view counts, and a link's moment is where it starts.
    if (!started && player.statusLine !== undefined) {
      started = true;
      if (Number.isFinite(startAt) && startAt > 0) jump(Math.min(startAt, player.rec.duration));
      if (slug && !counted) {
        counted = true;
        // Each recording of a merged round was watched; of a merge refused,
        // only the first, which plays alone.
        for (const m of mergedSources() ? members : [{ slug }]) {
          api.view(m.slug).catch(error => console.warn('replay-social: the view', error));
        }
      }
    }
    const t = player.time;
    if (lastTime !== null && player.playing && t > lastTime && t - lastTime < SEEK_JUMP) {
      for (const comment of shownComments()) {
        const at = atOf(comment);
        if (at !== null && at > lastTime && at <= t && !ui.root.classList.contains('rs-open')) bubble(comment);
      }
    }
    if (lastTime === null || Math.floor(t) !== Math.floor(lastTime)) {
      if (ui?.root.classList.contains('rs-open')) highlightNow();
    }
    lastTime = t;
  }

  // --- the cover -------------------------------------------------------------------

  function capture() {
    return new Promise(resolve => { pendingCapture = canvas => frameOf(canvas).then(resolve); });
  }

  function hookCapture() {
    const after = player.afterRender.bind(player);
    player.afterRender = canvas => {
      after(canvas);
      // In the task that drew it, while the drawing buffer is whole.
      if (pendingCapture) {
        const take = pendingCapture;
        pendingCapture = null;
        take(canvas);
      }
    };
  }

  /** The frame on screen as the cover (F, or the menu): a shared recording's
   *  is set there and then; one from disk keeps it for Share to send. */
  async function takeCover() {
    if (coverBusy) return;
    coverBusy = true;
    try {
      const blob = await capture();
      if (!blob) throw new Error('The frame could not be taken.');
      if (slug) {
        await api.setThumbnail(slug, blob);
        ui.flash('Cover set', 1600);
      } else {
        chosenCover = blob;
        ui.flash('Cover chosen', 1600);
      }
    } catch (error) {
      ui.flash(error.message, 3000);
    } finally {
      coverBusy = false;
    }
  }

  /** An item of this recording's in the bar's menu. */
  function menuItem(className, icon, text, onClick, key = '') {
    const b = el('button', `rp-mi ${className}`);
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.innerHTML = `${svg(icon)}<span></span>${key ? `<kbd class="rp-keys-only">${key}</kbd>` : ''}`;
    b.querySelector('span').textContent = text;
    b.addEventListener('click', e => {
      e.stopPropagation();
      ui.closeMore();
      onClick();
    });
    ui.moreMenu.append(b);
  }

  /** The menu's Copy link, for anyone. */
  function addLinkItem() {
    if (!ui?.moreMenu || ui.moreMenu.querySelector('.rs-link-item')) return;
    ui.moreMenu.append(el('div', 'rs-menu-rule'));
    menuItem('rs-link-item', 'link', 'Copy link at this moment', copyLink);
  }

  /** The recording's short link at the moment on screen, on its own clock
   *  when the page plays its round merged: the link opens it alone, the round's
   *  switch a press away. */
  async function copyLink() {
    if (!slug || !detail) return;
    const merged = mergedSources();
    const own = !player ? 0 : merged ? sourceClock(merged[0]).fromRound(player.time) : player.time;
    const at = own >= 1 ? Math.min(own, detail.durationSeconds ?? own) : null;
    const href = shortHref(slug, { base: api.base, at })
      ?? watchHref(detail, { root: './', fileUrl: p => new URL(api.fileUrl(p), location.href).href, at });
    try {
      await navigator.clipboard.writeText(href);
      ui.flash(at === null ? 'Link copied' : `Link copied at ${clock(at)}`, 1600);
    } catch {
      window.prompt('The link to this moment:', href);
    }
  }

  /** The menu's items for its uploader or an admin: the frame on screen as
   *  the cover (F), Rename and Delete. */
  function addOwnItems() {
    if (!ui?.moreMenu || ui.moreMenu.querySelector('.rs-cover-item')) return;
    ui.moreMenu.append(el('div', 'rs-menu-rule'));
    menuItem('rs-cover-item', 'frame', 'Use this frame as the cover', takeCover, 'F');
    menuItem('rs-rename-item', 'pencil', 'Rename', openRename);
    menuItem('rs-delete-item', 'trash', 'Delete', openDelete);
    ui.useFrameKey?.(takeCover);
  }

  // --- renaming and deleting it -----------------------------------------------------

  /** A dialog over the round, which waits while it is up: `{ body, close,
   *  submit }`, `submit` what Enter in its box does. `resume` is whether the
   *  round plays again once it shuts. The keys are the dialog's while it is up
   *  (the keyboard handler below). */
  function modal(heading, { resume = player.playing } = {}) {
    player.playing = false;
    const shade = el('div', 'rs-shade');
    const dialog = el('div', 'rp-panel rs-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-label', heading);
    const head = el('div', 'rp-panel-head');
    const box = { body: el('div', 'rs-compose'), submit: null };
    box.close = () => {
      shade.remove();
      if (nodes.modal === box) nodes.modal = null;
      player.playing = resume;
    };
    head.append(el('span', '', heading), ui.button('', 'close', 'Close', box.close));
    dialog.append(head, box.body);
    shade.append(dialog);
    shade.addEventListener('pointerdown', e => { if (e.target === shade) box.close(); });
    ui.root.append(shade);
    nodes.modal = box;
    return box;
  }

  /** Whose it is and how long, under the question. */
  const whose = recording => [recording.uploaderName && `Shared by ${recording.uploaderName}`,
    clock(recording.durationSeconds)].filter(Boolean).join(' · ');

  function openRename() {
    if (!detail) return;
    const dialog = modal('Rename recording');
    const { body, close } = dialog;
    const label = el('label');
    const title = el('input');
    title.maxLength = 100;
    title.value = detail.title;
    label.append(el('span', '', 'Title'), title);
    const status = el('div', 'rs-hint');
    const cancel = el('button', 'rs-go quiet', 'Cancel');
    cancel.type = 'button';
    cancel.addEventListener('click', close);
    const go = el('button', 'rs-go', 'Save');
    go.type = 'button';
    const row = el('div', 'rs-row');
    row.append(status, cancel, go);
    body.append(label, el('span', 'rs-hint', whose(detail)), row);
    const save = async () => {
      const text = title.value.trim();
      if (go.disabled || !text) return;
      if (text === detail.title) { close(); return; }
      go.disabled = true;
      status.classList.remove('rs-error');
      status.textContent = 'Saving';
      try {
        detail = await api.rename(slug, text);
        members[0].detail = detail;
        document.title = `${detail.title} · replay`;
        close();
        ui.flash('Renamed', 1600);
      } catch (error) {
        go.disabled = false;
        status.classList.add('rs-error');
        status.textContent = error.message;
      }
    };
    go.addEventListener('click', save);
    dialog.submit = save;
    title.focus();
    title.select();
  }

  function openDelete() {
    if (!detail) return;
    const { body, close } = modal('Delete recording');
    const status = el('div', 'rs-hint');
    const keep = el('button', 'rs-go quiet', 'Keep it');
    keep.type = 'button';
    keep.addEventListener('click', close);
    const go = el('button', 'rs-go destroy', 'Delete');
    go.type = 'button';
    const row = el('div', 'rs-row');
    row.append(status, keep, go);
    body.append(el('p', 'rs-ask', `Delete "${detail.title}"?`),
      el('span', 'rs-hint', `${whose(detail)}. Its comments go with it. There is no undo.`), row);
    go.addEventListener('click', async () => {
      if (go.disabled) return;
      go.disabled = true;
      status.classList.remove('rs-error');
      status.textContent = 'Deleting';
      try {
        await api.remove(slug);
        // Nothing left to watch: back to the feed.
        const feed = new URL(menuUrl ?? new URL('./play/index.html', location.href));
        feed.searchParams.set('tab', 'replay');
        feed.searchParams.delete('rec');
        location.assign(feed);
      } catch (error) {
        go.disabled = false;
        status.classList.add('rs-error');
        status.textContent = error.message;
      }
    });
    keep.focus();
  }

  // --- sharing a recording from disk -----------------------------------------------

  function dressLocal() {
    if (!ui || nodes.share) return;
    nodes.share = ui.button('rs-share rp-roomy', null, 'Share this recording to the REPLAY feed', () => openShare(),
      `${svg('share')}<span class="rp-label">Share</span>`);
    ui.logBtn.before(nodes.share);
    ui.useFrameKey?.(takeCover);
  }

  async function openShare() {
    if (!api) api = sharedRecordingsApi(await resolveApi());
    if (!api.canWrite) {
      ui.flash('Sharing needs the site: this page reads the live feed read-only.', 3000);
      return;
    }
    const wasPlaying = player.playing;
    player.playing = false;
    const picked = Boolean(chosenCover);
    const cover = chosenCover ?? await capture().catch(() => null);
    const { body, close } = modal('Share to the REPLAY feed', { resume: wasPlaying });

    await api.ready();
    if (!api.signedIn) {
      const go = el('button', 'rs-go', api.mode === 'local' ? 'Sign in (dev)' : 'Sign in with Discord');
      go.type = 'button';
      go.addEventListener('click', async () => {
        if (await api.signIn()) { close(); openShare(); }
      });
      body.append(el('p', 'rs-hint', 'Sign in to share a recording.'), go);
      return;
    }
    viewer = await api.viewer().catch(() => null);
    const names = viewer?.names ?? [];
    const rec = player.rec;
    // Shared as the player who recorded it, as the file names him, unless one
    // of the account's linked names is picked instead.
    const recorder = recorderName(rec);
    const options = [recorder, ...names].filter(Boolean)
      .filter((name, i, all) => all.findIndex(n => n.toLowerCase() === name.toLowerCase()) === i);
    const preview = el('div', 'rs-cover');
    if (cover) preview.style.backgroundImage = `url("${URL.createObjectURL(cover)}")`;
    const titleLabel = el('label');
    const title = el('input');
    title.maxLength = 100;
    title.value = [levelName() && levelName().replace(/_/g, ' '), rec.server && `on ${rec.server}`].filter(Boolean).join(' ');
    titleLabel.append(el('span', '', 'Title'), title);
    const asLabel = el('label');
    let as = null;
    if (options.length) {
      as = el('select');
      for (const name of options) as.append(new Option(name, name));
      as.disabled = options.length === 1;
      asLabel.append(el('span', '', 'Shared by'), as);
    } else {
      as = el('input');
      as.placeholder = 'Your in-game name';
      as.maxLength = 32;
      asLabel.append(el('span', '', 'Your in-game name'), as);
    }
    const status = el('div', 'rs-hint');
    const go = el('button', 'rs-go', 'Share');
    go.type = 'button';
    const row = el('div', 'rs-row');
    row.append(status, go);
    body.append(preview, el('span', 'rs-hint', picked ? 'The frame you picked with F is its cover.' : 'The frame on screen is its cover.'),
      titleLabel, asLabel, row);
    title.focus();
    go.addEventListener('click', async () => {
      if (go.disabled) return;
      go.disabled = true;
      status.classList.remove('rs-error');
      try {
        const author = as.value.trim();
        if (!options.length) {
          if (!author) throw new Error('Your in-game name first.');
          viewer = await api.linkName(author);
        }
        const kept = await readLocalRecording(new URLSearchParams(location.search).get('replay'));
        const recording = new File([kept.text], kept.name || 'replay.ndjson');
        const serverLog = kept.log ? new File([kept.log.text], kept.log.name) : null;
        const shared = await api.upload({
          recording,
          serverLog,
          thumbnail: cover,
          meta: {
            title: title.value,
            // The recording's own player goes up as the API reads him from the
            // file; only another name is sent.
            authorName: author === recorder ? '' : author,
            level: String(rec.level || levelName() || '').toLowerCase(),
            mod: modId(),
            gameMode: String(rec.modeFile || '').replace(/\.con$/i, '').toLowerCase(),
            serverName: rec.server || '',
            recordedBy: recorder,
            start: rec.start || '',
            durationSeconds: rec.duration,
            players: [...new Set([...rec.players.values()].map(p => p.name).filter(Boolean))].slice(0, 128),
          },
          onStage: text => { status.textContent = text; },
          onProgress: p => { status.textContent = p >= 1 ? 'Checking it' : `Uploading ${Math.round(p * 100)}%`; },
        });
        close();
        becomeShared(shared);
      } catch (error) {
        go.disabled = false;
        status.classList.add('rs-error');
        status.textContent = error.status === 409 && error.body?.existingSlug
          ? `${error.message} Its page: ?tab=replay&rec=${error.body.existingSlug}`
          : error.message;
      }
    });
  }

  /** A recording from disk, shared: the page is now that recording's, in the
   *  address and in the chrome, without loading the round again. */
  function becomeShared(recording) {
    slug = recording.slug;
    detail = recording;
    members = [{ slug, detail }];
    comments = [];
    commentTotal = 0;
    counted = true;
    const kept = [...new URLSearchParams(location.search)].filter(([name]) => !['replay', 'serverlog', 't'].includes(name));
    const search = readableQuery([
      ...kept,
      ['replay', api.fileUrl(recording.recordingUrl)],
      ['serverlog', recording.serverLogUrl ? api.fileUrl(recording.serverLogUrl) : null],
    ]);
    history.replaceState(history.state, '', `${location.pathname}?${search}`);
    pointMenuAtFeed();
    nodes.share?.remove();
    dressShared();
    renderCompose();
    toggle(true);
    ui.flash('Shared', 1600);
  }

  // --- the keyboard ----------------------------------------------------------------

  // On the window's capture phase, ahead of the replay's own keys (installed
  // after this): T opens the comments, as T opens the chat in the game; Enter
  // in the comment box posts it; Escape shuts the panel.
  window.addEventListener('keydown', e => {
    // A dialog of this file's up (Share, Rename, Delete): the keys are its,
    // the round's shortcuts wait. Escape shuts it; Enter in its box sends it;
    // anything else does what it does there (types, moves the focus, presses).
    if (nodes.modal) {
      e.stopImmediatePropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        nodes.modal.close();
      } else if (e.key === 'Enter' && e.target?.tagName === 'INPUT' && nodes.modal.submit) {
        e.preventDefault();
        nodes.modal.submit();
      }
      return;
    }
    if (!ui || !nodes.panel) return;
    const typing = e.target === nodes.text;
    if (typing && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      e.stopImmediatePropagation();
      nodes.post?.();
      return;
    }
    if (e.code === 'Escape' && ui.root.classList.contains('rs-open')) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (typing) e.target.blur();
      else toggle(false);
      return;
    }
    if (e.code === 'KeyT' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey
        && !/^(INPUT|SELECT|TEXTAREA)$/.test(e.target?.tagName ?? '')) {
      e.preventDefault();
      e.stopImmediatePropagation();
      toggle(true);
      nodes.text?.focus();
    }
  }, true);

  if (shared) loadShared();

  return {
    /** The page's `opened(player)`: the replay's chrome is built. */
    decorate(opened) {
      player = opened;
      ui = opened.ui;
      hookCapture();
      // F on a shared recording, until the feed says this viewer may set its
      // cover (`addOwnItems`).
      if (slug) ui.useFrameKey?.(() => ui.flash('Only its uploader or an admin can set the cover', 2400));
      if (local) dressLocal();
      if (detail) dressShared();
      requestAnimationFrame(tick);
    },
    get slug() { return slug; },
    /** The recordings whose comments show, the one played first. */
    get members() { return members.map(m => m.slug); },
    get comments() { return shownComments(); },
    toggle: on => toggle(on),
    capture,
  };
}
