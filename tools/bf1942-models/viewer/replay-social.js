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
// The replay's own chrome (replay-ui.js) is not changed: this adds a button
// to its bar, a panel and marks to its root and timeline, and an item to its
// menu, and gives its F the cover (`useFrameKey`), through the page's
// `opened(player)` hook, the way replay-open.js adds the bar's date and Open
// button.

import {
  ago, apiMode, clock, commentRuns, count, createRecordingsApi, readableQuery, resolveApi, sharedRecordingOf,
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
 * @param {URLSearchParams} [options.params]
 * @param {URL} [options.menuUrl]      where the page's way back to the menu
 *                                     goes: a shared recording's page in the feed
 * @param {() => string} [options.levelName]  the level on screen
 * @param {() => string} [options.modId]      the page's mod
 */
export function installReplaySocial({ replayUrl, params = new URLSearchParams(location.search), menuUrl = null,
  levelName = () => '', modId = () => 'bf1942' } = {}) {
  const local = isLocalReplay(replayUrl);
  const shared = sharedRecordingOf(replayUrl);
  if (!shared && !local) return null;
  if (!document.getElementById('rs-style')) {
    const style = el('style');
    style.id = 'rs-style';
    style.textContent = STYLE;
    document.head.append(style);
  }

  let slug = shared?.slug ?? null;
  let api = shared ? createRecordingsApi({ base: shared.base, mode: apiMode(shared.base) }) : null;
  let detail = null;
  let comments = [];
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
    try {
      detail = await api.get(slug);
    } catch (error) {
      console.warn('replay-social: the recording', error);
      return;
    }
    if (player) dressShared();
    await loadComments();
  }

  async function loadComments() {
    try {
      const page = await api.comments(slug, { sort: 'time', pageSize: 200 });
      comments = page.items;
      if (detail) detail.commentCount = page.totalCount;
    } catch (error) {
      console.warn('replay-social: comments', error);
    }
    renderComments();
    renderMarks();
    syncCount();
  }

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
    if (detail?.canManage) addCoverItem();
    // One panel on the right at a time: the replay log opening shuts this.
    new MutationObserver(() => {
      if (ui.root.classList.contains('log-open') && ui.root.classList.contains('rs-open')) toggle(false);
    }).observe(ui.root, { attributes: true, attributeFilter: ['class'] });
    renderCompose();
    renderComments();
    renderMarks();
    syncCount();
  }

  function syncCount() {
    const n = detail?.commentCount ?? comments.length;
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

  function textWithTimes(text) {
    const p = el('p', 'rs-text');
    for (const run of commentRuns(text, player?.rec.duration ?? Infinity)) {
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
    if (!comments.length) {
      nodes.list.append(el('div', 'rs-empty', 'No comments yet. A time in yours, like 0:21, jumps there.'));
      return;
    }
    for (const comment of comments) {
      const item = el('div', 'rs-item');
      item.dataset.id = String(comment.id);
      if (comment.atSeconds !== null && comment.atSeconds !== undefined) item.dataset.at = String(comment.atSeconds);
      const who = el('div', 'rs-who');
      who.append(el('b', '', comment.authorName), document.createTextNode(ago(comment.createdAt)));
      if (comment.canDelete) {
        const del = el('button', 'rs-del', 'remove');
        del.type = 'button';
        del.addEventListener('click', async e => {
          e.stopPropagation();
          del.disabled = true;
          try {
            await api.removeComment(slug, comment.id);
            comments = comments.filter(c => c.id !== comment.id);
            if (detail) detail.commentCount = Math.max(0, detail.commentCount - 1);
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
      item.append(who, textWithTimes(comment.content));
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
    for (const comment of comments) {
      if (comment.atSeconds === null || comment.atSeconds === undefined) continue;
      const mark = el('button', 'rs-mk');
      mark.type = 'button';
      mark.tabIndex = -1;
      mark.style.left = `${Math.min(100, (comment.atSeconds / duration) * 100)}%`;
      mark.title = `${clock(comment.atSeconds)}  ${comment.authorName}: ${comment.content}`;
      mark.setAttribute('aria-label', mark.title);
      // Its own press: the timeline under it would scrub.
      mark.addEventListener('pointerdown', e => e.stopPropagation());
      mark.addEventListener('click', e => {
        e.stopPropagation();
        jump(comment.atSeconds);
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
        const comment = await api.comment(slug, content, as.value);
        try { localStorage.setItem('bf42-mesh-post-as', as.value); } catch {}
        comments = [...comments, comment].sort((a, b) =>
          (a.atSeconds ?? Infinity) - (b.atSeconds ?? Infinity) || a.id - b.id);
        if (detail) detail.commentCount += 1;
        text.value = '';
        text.blur();
        renderComments();
        renderMarks();
        syncCount();
        nodes.list.querySelector(`[data-id="${comment.id}"]`)?.scrollIntoView({ block: 'nearest' });
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
        api.view(slug).catch(error => console.warn('replay-social: the view', error));
      }
    }
    const t = player.time;
    if (lastTime !== null && player.playing && t > lastTime && t - lastTime < SEEK_JUMP) {
      for (const comment of comments) {
        const at = comment.atSeconds;
        if (at !== null && at !== undefined && at > lastTime && at <= t && !ui.root.classList.contains('rs-open')) bubble(comment);
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

  function addCoverItem() {
    if (!ui.moreMenu || ui.moreMenu.querySelector('.rs-cover-item')) return;
    const item = el('button', 'rp-mi rs-cover-item');
    item.type = 'button';
    item.setAttribute('role', 'menuitem');
    item.innerHTML = `${svg('frame')}<span>Use this frame as the cover</span><kbd class="rp-keys-only">F</kbd>`;
    item.addEventListener('click', e => {
      e.stopPropagation();
      ui.closeMore();
      takeCover();
    });
    ui.moreMenu.append(item);
    ui.useFrameKey?.(takeCover, 'Use this frame as the cover');
  }

  // --- sharing a recording from disk -----------------------------------------------

  function dressLocal() {
    if (!ui || nodes.share) return;
    nodes.share = ui.button('rs-share rp-roomy', null, 'Share this recording to the REPLAY feed', () => openShare(),
      `${svg('share')}<span class="rp-label">Share</span>`);
    ui.logBtn.before(nodes.share);
    ui.useFrameKey?.(takeCover, 'Use this frame as the cover');
  }

  async function openShare() {
    if (!api) api = createRecordingsApi(await resolveApi());
    if (!api.canWrite) {
      ui.flash('Sharing needs the site: this page reads the live feed read-only.', 3000);
      return;
    }
    const wasPlaying = player.playing;
    player.playing = false;
    const picked = Boolean(chosenCover);
    const cover = chosenCover ?? await capture().catch(() => null);
    const shade = el('div', 'rs-shade');
    const dialog = el('div', 'rp-panel rs-dialog');
    const head = el('div', 'rp-panel-head');
    const close = () => { shade.remove(); player.playing = wasPlaying; };
    head.append(el('span', '', 'Share to the REPLAY feed'), ui.button('', 'close', 'Close', close));
    const body = el('div', 'rs-compose');
    dialog.append(head, body);
    shade.append(dialog);
    shade.addEventListener('pointerdown', e => { if (e.target === shade) close(); });
    ui.root.append(shade);

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
    comments = [];
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
      if (local) dressLocal();
      if (detail) dressShared();
      requestAnimationFrame(tick);
    },
    get slug() { return slug; },
    get comments() { return comments; },
    toggle: on => toggle(on),
    capture,
  };
}
