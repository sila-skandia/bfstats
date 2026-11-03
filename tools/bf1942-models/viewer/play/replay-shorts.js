// The REPLAY tab's Shorts (features/replay-shorts, "The strip and the
// player"): the week's 9:16 clips of notable kills, cut from the shared
// recordings by the render job, as a strip above the recordings and a
// full-screen player, one Short a screen.
//
// The strip is a row of cards that scrolls sideways; a card previews its clip
// muted under a mouse and opens the player on a click. The player is a
// vertical scroller snapped a Short a screen: the wheel, a swipe and the arrow
// keys move a Short at a time, the next one loading while this one plays. Each
// Short leads back into its recording, at the kill, with Watch the round.
//
// The Shorts are a nicety: a Shorts call that fails leaves the feed as it was,
// with no strip.

import { ago, count, shortShareHref, watchHref } from '../recordings-api.js';
import { decodePlayerName } from '../vehicle-players.js';

const PAGE_SIZE = 24;
const DAYS = 7;
/** Seconds of play that count as a view. */
const VIEW_AFTER = 2;
/** Seconds of the round before the kill that Watch the round opens on. */
const LEAD_IN = 5;
const MUTE_KEY = 'bf42-shorts-sound';

/** A Short's kind as its badge says it; `other` and unknown kinds are a Kill. */
const KINDS = {
  'air-to-air': 'Air to air',
  'ground-to-air': 'Ground to air',
  'tank-to-tank': 'Tank to tank',
  'long-shot': 'Long shot',
};
export const shortKindLabel = kind => KINDS[kind] ?? 'Kill';

/** `192 m`, or '' where no distance was measured. */
export function shortDistance(metres) {
  const m = Number(metres);
  return Number.isFinite(m) && m > 0 ? `${Math.round(m)} m` : '';
}

/** `1.2K views · 3 days ago`. */
export function shortMeta(short, now = Date.now()) {
  return [count(short?.views, 'view'), ago(short?.createdAt, now)].filter(Boolean).join(' · ');
}

/** Where in its round Watch the round opens a Short: a few seconds before the kill. */
export const shortWatchAt = killTime => Math.max(0, (Number(killTime) || 0) - LEAD_IN);

/** The replay page for a Short's round at the kill: the feed's own Watch for
 *  its recording (the API's recording, fetched by `recordingSlug`). */
export function shortWatchHref(short, recording, { root, fileUrl = path => path }) {
  return watchHref(recording, { root, fileUrl, at: shortWatchAt(short.killTime) });
}

/** The page's address with `short` open in the player, or none (`null`). */
export function shortAddress(href, slug) {
  const url = new URL(href);
  if (slug) url.searchParams.set('short', slug);
  else url.searchParams.delete('short');
  return url.href;
}

/** What the killer did to whom, decoded for display: `{ killer, victim,
 *  weapon, distance }`. */
export function shortLine(short) {
  return {
    killer: decodePlayerName(short?.killer ?? ''),
    victim: decodePlayerName(short?.victim ?? ''),
    weapon: short?.weapon || short?.killerVehicle || '',
    distance: shortDistance(short?.distance),
  };
}

const ICONS = {
  prev: '<path d="M10 3.2 5.2 8 10 12.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  next: '<path d="M6 3.2 10.8 8 6 12.8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  up: '<path d="M3.2 10 8 5.2 12.8 10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  down: '<path d="M3.2 6 8 10.8 12.8 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  close: '<path d="M3.5 3.5l9 9M12.5 3.5l-9 9" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  muted: '<path d="M2.5 6h2.4L8 3.3v9.4L4.9 10H2.5z" fill="currentColor"/><path d="M10.6 6.1l3.6 3.8M14.2 6.1l-3.6 3.8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  sound: '<path d="M2.5 6h2.4L8 3.3v9.4L4.9 10H2.5z" fill="currentColor"/><path d="M10.2 5.6a3.2 3.2 0 0 1 0 4.8M12 3.8a5.8 5.8 0 0 1 0 8.4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  play: '<path d="M5 3.2v9.6L13 8z" fill="currentColor"/>',
  round: '<path d="M5 3.2v9.6L13 8z" fill="currentColor"/>',
  // A link: two rounded loops, interlocked.
  link: '<path d="M6.6 9.4 9.4 6.6M7.2 4.6l1-1a2.6 2.6 0 0 1 3.7 3.7l-1 1M8.8 11.4l-1 1a2.6 2.6 0 0 1-3.7-3.7l1-1" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  eye: '<path d="M1.5 8S4 3.8 8 3.8 14.5 8 14.5 8 12 12.2 8 12.2 1.5 8 1.5 8z" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="8" r="2" fill="currentColor"/>',
  // The kill: the killer's weapon pointing at the victim.
  arrow: '<path d="M2 8h10.2M8.8 4.6 12.2 8l-3.4 3.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
};
const icon = name => `<svg viewBox="0 0 16 16" aria-hidden="true">${ICONS[name] ?? ''}</svg>`;

const STYLE = `
.rs-strip { margin: 0 0 18px; border: 1px solid var(--rf-edge); border-radius: 8px; background: var(--rf-plate-deep); overflow: hidden; }
.rs-strip[hidden] { display: none; }
.rs-head { display: flex; align-items: center; gap: 10px; min-height: 28px; padding: 0 8px 0 12px; background: var(--rf-khaki);
  color: var(--rf-khaki-ink); font: 800 11.5px/1 'Trebuchet MS', 'Segoe UI', sans-serif; letter-spacing: .16em; text-transform: uppercase; }
.rs-head h2 { margin: 0; font: inherit; }
.rs-head .rs-total { font-weight: 700; letter-spacing: .08em; opacity: .7; }
.rs-frame { position: relative; }
.rs-row { display: grid; grid-auto-flow: column; grid-auto-columns: 156px; gap: 10px; padding: 12px; overflow-x: auto; overflow-y: hidden;
  scroll-snap-type: x mandatory; scroll-padding: 0 12px; overscroll-behavior-x: contain; scrollbar-width: none; }
.rs-row::-webkit-scrollbar { display: none; }
.rs-card { position: relative; display: block; aspect-ratio: 9 / 16; border-radius: 6px; overflow: hidden; scroll-snap-align: start;
  background: #0d0d0b; border: 1px solid var(--rf-edge); color: #f4f1dc; text-decoration: none; isolation: isolate;
  transition: border-color .15s ease, transform .2s cubic-bezier(.2, .8, .2, 1); }
.rs-card:hover { border-color: var(--rf-edge-strong); }
.rs-card:focus-visible { outline: 1px solid var(--rf-gold); outline-offset: 1px; }
.rs-card img, .rs-card video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.rs-card video { opacity: 0; transition: opacity .2s ease; }
.rs-card.previewing video { opacity: 1; }
.rs-card::after { content: ''; position: absolute; inset: 0; z-index: 1; pointer-events: none;
  background: linear-gradient(to top, rgba(0, 0, 0, .86), rgba(0, 0, 0, .25) 42%, rgba(0, 0, 0, 0) 62%); }
.rs-badge { position: absolute; top: 7px; left: 7px; z-index: 2; display: inline-flex; align-items: center; gap: 5px; max-width: calc(100% - 14px);
  height: 18px; padding: 0 6px 0 5px; border-radius: 4px; background: rgba(0, 0, 0, .74); color: var(--rf-ink);
  box-shadow: 0 0 0 1px rgba(200, 194, 152, .32) inset; font: 800 9px/1 'Trebuchet MS', 'Segoe UI', sans-serif; letter-spacing: .11em;
  text-transform: uppercase; white-space: nowrap; overflow: hidden; }
.rs-badge::before { content: ''; flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--rs-kind, var(--rf-khaki));
  box-shadow: 0 0 6px var(--rs-kind, var(--rf-khaki)); }
.rs-kind-air-to-air { --rs-kind: #8fc0e8; }
.rs-kind-ground-to-air { --rs-kind: #e0a96a; }
.rs-kind-tank-to-tank { --rs-kind: #a3b46a; }
.rs-kind-long-shot { --rs-kind: #e8c35a; }
.rs-text { position: absolute; left: 8px; right: 8px; bottom: 8px; z-index: 2; display: grid; gap: 4px; }
.rs-title { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere;
  font: 700 12.5px/1.25 'Trebuchet MS', 'Segoe UI', sans-serif; text-shadow: 0 1px 4px rgba(0, 0, 0, .9); }
.rs-views { display: flex; align-items: center; gap: 4px; color: rgba(238, 236, 217, .78); font: 700 10.5px/1 'Trebuchet MS', 'Segoe UI', sans-serif;
  letter-spacing: .03em; }
.rf-root .rs-views svg { width: 11px; height: 11px; }
.rs-arrow { position: absolute; top: 50%; z-index: 3; display: none; place-items: center; width: 34px; height: 34px; margin-top: -17px;
  padding: 0; border: 1px solid rgba(200, 194, 152, .55); border-radius: 50%; background: rgba(20, 20, 17, .9); color: var(--rf-ink);
  box-shadow: 0 4px 14px rgba(0, 0, 0, .55); cursor: pointer; transition: opacity .15s ease, border-color .15s ease, background-color .15s ease; }
.rs-arrow:hover { border-color: var(--rf-edge-strong); background: rgba(48, 48, 40, .96); }
.rs-arrow:focus-visible { outline: 1px solid var(--rf-gold); outline-offset: 1px; }
.rs-arrow:disabled { opacity: 0; pointer-events: none; }
.rs-arrow.prev { left: 6px; }
.rs-arrow.next { right: 6px; }
.rf-root .rs-arrow svg { width: 16px; height: 16px; }
@media (hover: hover) and (pointer: fine) {
  .rs-arrow { display: grid; }
  .rs-card:hover { transform: translateY(-2px); }
}
@container rf (max-width: 560px) {
  .rs-row { grid-auto-columns: calc((100% - 24px - 20px) / 2.15); gap: 10px; }
  .rs-card .rs-badge { gap: 4px; padding: 0 5px 0 4px; font-size: 8px; letter-spacing: .06em; }
}

/* The player: a Short a screen. */
.rs-player { position: fixed; inset: 0; z-index: 1000; background: #000; color: #eeecd9;
  --rf-khaki: #a39c6c; --rf-khaki-ink: #15150e; --rf-ink: #eeecd9; --rf-muted: #a9a690; --rf-gold: #e8c35a;
  --rf-edge: rgba(200, 194, 152, .30); --rf-edge-strong: #b9b38a;
  font: 13px/1.4 'Trebuchet MS', 'Geist Variable', 'Segoe UI', system-ui, sans-serif; }
.rs-player[hidden] { display: none; }
.rs-player *, .rs-player *::before, .rs-player *::after { box-sizing: border-box; }
.rs-player svg { width: 18px; height: 18px; flex: none; }
.rs-track { position: absolute; inset: 0; overflow-y: auto; overflow-x: hidden; scroll-snap-type: y mandatory; overscroll-behavior: contain;
  scrollbar-width: none; outline: none; }
.rs-track::-webkit-scrollbar { display: none; }
.rs-slide { position: relative; height: 100%; display: grid; place-items: center; scroll-snap-align: start; scroll-snap-stop: always; }
.rs-screen { position: relative; height: 100%; aspect-ratio: 9 / 16; max-width: 100%; overflow: hidden; background: #000 center / contain no-repeat; }
.rs-screen video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; background: transparent; }
.rs-screen::after { content: ''; position: absolute; inset: 0; pointer-events: none;
  background: linear-gradient(to top, rgba(0, 0, 0, .82), rgba(0, 0, 0, .2) 30%, rgba(0, 0, 0, 0) 44%); }
.rs-paused { position: absolute; left: 50%; top: 50%; z-index: 2; display: grid; place-items: center; width: 64px; height: 64px;
  margin: -32px 0 0 -32px; border-radius: 50%; background: rgba(0, 0, 0, .55); color: #fff; pointer-events: none; opacity: 0;
  transition: opacity .15s ease; }
.rs-paused svg { width: 26px; height: 26px; margin-left: 4px; }
.rs-slide.paused .rs-paused { opacity: 1; }
.rs-info { position: absolute; left: 14px; right: 14px; bottom: max(16px, env(safe-area-inset-bottom)); z-index: 2; display: grid; gap: 7px; text-shadow: 0 1px 4px rgba(0, 0, 0, .9); }
.rs-info .rs-badge { position: static; justify-self: start; }
.rs-info h2 { margin: 0; font: 800 17px/1.25 'Trebuchet MS', 'Segoe UI', sans-serif; overflow-wrap: anywhere; }
.rs-kill { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 7px; font-size: 13px; color: #f4f1dc; }
.rs-kill b { font-weight: 800; overflow-wrap: anywhere; }
.rs-kill svg { width: 14px; height: 14px; color: var(--rf-khaki); }
.rs-kill .rs-with, .rs-sub { color: rgba(238, 236, 217, .74); }
.rs-sub { font-size: 12px; }
.rs-watch { justify-self: start; display: inline-flex; align-items: center; gap: 7px; height: 34px; margin-top: 3px; padding: 0 14px;
  border: 1px solid var(--rf-khaki); border-radius: 5px; background: var(--rf-khaki); color: var(--rf-khaki-ink); text-decoration: none;
  text-shadow: none; font: 800 11.5px/1 'Trebuchet MS', 'Segoe UI', sans-serif; letter-spacing: .1em; text-transform: uppercase; }
.rs-watch:hover { background: #b9b38a; border-color: #b9b38a; }
.rs-watch:focus-visible { outline: 1px solid var(--rf-gold); outline-offset: 2px; }
.rs-watch[aria-disabled="true"] { opacity: .6; pointer-events: none; }
.rs-watch svg { width: 13px; height: 13px; }
.rs-btn { appearance: none; display: grid; place-items: center; width: 42px; height: 42px; margin: 0; padding: 0;
  border: 1px solid rgba(200, 194, 152, .45); border-radius: 50%; background: rgba(20, 20, 17, .78); color: #eeecd9; cursor: pointer;
  transition: border-color .15s ease, background-color .15s ease, opacity .15s ease; }
.rs-btn:hover { border-color: var(--rf-edge-strong); background: rgba(48, 48, 40, .92); }
.rs-btn:focus-visible { outline: 1px solid var(--rf-gold); outline-offset: 2px; }
.rs-btn:disabled { opacity: .3; cursor: default; }
.rs-top { position: absolute; top: max(12px, env(safe-area-inset-top)); left: 12px; right: 12px; z-index: 3; display: flex;
  justify-content: space-between; pointer-events: none; }
.rs-top > * { pointer-events: auto; }
.rs-mute { width: auto; padding: 0 14px 0 11px; gap: 7px; display: inline-flex; align-items: center; border-radius: 21px;
  font: 800 11px/1 'Trebuchet MS', 'Segoe UI', sans-serif; letter-spacing: .1em; text-transform: uppercase; }
.rs-tools { display: flex; gap: 8px; }
.rs-share { width: auto; padding: 0 14px 0 11px; gap: 7px; display: inline-flex; align-items: center; border-radius: 21px;
  font: 800 11px/1 'Trebuchet MS', 'Segoe UI', sans-serif; letter-spacing: .1em; text-transform: uppercase; }
.rs-share.done { border-color: var(--rf-khaki); color: var(--rf-khaki); }
.rs-mute.on { padding: 0; width: 42px; justify-content: center; }
.rs-mute.on span { display: none; }
.rs-mute:not(.on) { border-color: var(--rf-khaki); box-shadow: 0 0 0 0 rgba(163, 156, 108, .6); animation: rs-call 2.2s ease-out infinite; }
@keyframes rs-call { 0% { box-shadow: 0 0 0 0 rgba(163, 156, 108, .55); } 70%, 100% { box-shadow: 0 0 0 10px rgba(163, 156, 108, 0); } }
.rs-nav { position: absolute; right: 18px; top: 50%; z-index: 3; display: none; flex-direction: column; gap: 10px; transform: translateY(-50%); }
.rs-count { position: absolute; left: 50%; top: max(20px, env(safe-area-inset-top)); z-index: 3; transform: translateX(-50%);
  color: rgba(238, 236, 217, .6); font: 700 11px/1 ui-monospace, monospace; pointer-events: none; }
.rs-empty { display: grid; place-items: center; height: 100%; color: var(--rf-muted); }
@media (hover: hover) and (pointer: fine) {
  .rs-nav { display: flex; }
}
@media (max-width: 600px) {
  .rs-count { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .rs-card, .rs-card video, .rs-arrow, .rs-btn, .rs-paused { transition: none; }
  .rs-mute:not(.on), }
`;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function iconButton(className, label, onClick, iconName) {
  const b = el('button', className);
  b.type = 'button';
  b.innerHTML = icon(iconName);
  b.setAttribute('aria-label', label);
  b.title = label;
  b.addEventListener('click', e => { e.preventDefault(); onClick(e); });
  return b;
}

function badge(kind) {
  const b = el('span', `rs-badge rs-kind-${kind || 'other'}`, shortKindLabel(kind));
  return b;
}

const canHover = () => globalThis.matchMedia?.('(hover: hover) and (pointer: fine)').matches ?? false;

function soundWanted() {
  try { return globalThis.sessionStorage?.getItem(MUTE_KEY) === 'on'; } catch { return false; }
}
function rememberSound(on) {
  try { globalThis.sessionStorage?.setItem(MUTE_KEY, on ? 'on' : 'off'); } catch {}
}

/**
 * The strip and the player for one feed.
 * @param {object} options
 * @param {() => Promise<object|null>} options.api  the feed's recordings-api.js
 *        client, once found (null when the API was not reached)
 * @param {string} options.root  the viewer root, for Watch the round
 */
export function createShorts({ api: apiOf, root = '../' }) {
  if (!document.getElementById('rs-style')) {
    const style = el('style');
    style.id = 'rs-style';
    style.textContent = STYLE;
    document.head.append(style);
  }

  const state = {
    api: null,
    items: [],
    total: 0,
    page: 0,
    loading: null,   // the page being fetched
    failed: false,
  };
  const media = path => state.api?.fileUrl(path) ?? path;

  // --- the strip ------------------------------------------------------------------

  const strip = el('section', 'rs-strip');
  strip.hidden = true;
  strip.setAttribute('aria-label', 'Shorts this week');
  const head = el('div', 'rs-head');
  const totalEl = el('span', 'rs-total');
  head.append(el('h2', '', 'Shorts this week'), totalEl);
  const frame = el('div', 'rs-frame');
  const row = el('div', 'rs-row');
  row.setAttribute('role', 'list');
  const prev = iconButton('rs-arrow prev', 'Previous Shorts', () => page(-1), 'prev');
  const next = iconButton('rs-arrow next', 'More Shorts', () => page(1), 'next');
  frame.append(row, prev, next);
  strip.append(head, frame);

  let rowScroll = 0;
  let arrowsFrame = 0;
  row.addEventListener('scroll', () => {
    rowScroll = row.scrollLeft;
    cancelAnimationFrame(arrowsFrame);
    arrowsFrame = requestAnimationFrame(() => {
      arrows();
      if (row.scrollLeft + row.clientWidth >= row.scrollWidth - row.clientWidth * 0.6) more();
    });
  }, { passive: true });
  new ResizeObserver(() => arrows()).observe(row);

  function arrows() {
    prev.disabled = row.scrollLeft <= 2;
    next.disabled = row.scrollLeft + row.clientWidth >= row.scrollWidth - 2 && state.items.length >= state.total;
  }

  /** A row's worth sideways, by whole cards. */
  function page(direction) {
    const card = row.querySelector('.rs-card');
    const step = card ? card.getBoundingClientRect().width + 10 : 166;
    const cards = Math.max(1, Math.floor((row.clientWidth - 24) / step));
    row.scrollBy({ left: direction * cards * step, behavior: 'smooth' });
    if (direction > 0) more();
  }

  /** Puts the strip at the top of the feed's `body`, as the user left it. */
  function place(body) {
    body.prepend(strip);
    if (row.scrollLeft !== rowScroll) row.scrollLeft = rowScroll;
    arrows();
  }

  let loaded = null;
  /** The first page of the week's Shorts. A failure is a warning and no strip. */
  function load() {
    loaded ??= (async () => {
      state.api = await apiOf();
      if (!state.api) return;
      await fetchPage();
    })();
    return loaded;
  }

  async function fetchPage() {
    if (state.loading) return state.loading;
    state.loading = (async () => {
      try {
        const page = await state.api.shorts({ days: DAYS, sort: 'new', page: state.page + 1, pageSize: PAGE_SIZE });
        const fresh = (page?.items ?? []).filter(s => s?.slug && !state.items.some(o => o.slug === s.slug));
        state.items.push(...fresh);
        state.total = Math.max(Number(page?.total) || 0, state.items.length);
        state.page = Number(page?.page) || state.page + 1;
        // A page that brought nothing new is the end, whatever the total says.
        if (!fresh.length) state.total = state.items.length;
        row.append(...fresh.map(card));
        player.more(fresh);
      } catch (error) {
        console.warn('replay-shorts: the Shorts', error);
        if (!state.page) state.failed = true;
        else {
          state.total = state.items.length;
        }
      } finally {
        state.loading = null;
      }
      strip.hidden = !state.items.length;
      totalEl.textContent = state.items.length ? String(state.total) : '';
      arrows();
    })();
    return state.loading;
  }

  function more() {
    if (state.items.length < state.total && !state.loading) return fetchPage();
    return state.loading;
  }

  function card(short) {
    const a = el('a', 'rs-card');
    a.setAttribute('role', 'listitem');
    a.href = shortAddress(location.href, short.slug);
    a.dataset.slug = short.slug;
    a.setAttribute('aria-label', `Play the Short: ${short.title}, ${count(short.views, 'view')}`);
    if (short.posterUrl) {
      const img = el('img');
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.src = media(short.posterUrl);
      img.addEventListener('error', () => img.remove());
      a.append(img);
    }
    const text = el('span', 'rs-text');
    const views = el('span', 'rs-views');
    views.innerHTML = icon('eye');
    views.append(count(short.views, 'view'));
    text.append(el('span', 'rs-title', short.title), views);
    a.append(badge(short.kind), text);
    a.addEventListener('click', e => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      stopPreview(a);
      player.open(short.slug, { from: a });
    });
    // A muted preview under a mouse, its video fetched on the first hover.
    a.addEventListener('pointerenter', e => {
      if (e.pointerType !== 'mouse' || !canHover()) return;
      let video = a.querySelector('video');
      if (!video) {
        video = el('video');
        Object.assign(video, { muted: true, loop: true, playsInline: true, preload: 'none' });
        video.setAttribute('muted', '');
        video.setAttribute('playsinline', '');
        video.setAttribute('aria-hidden', 'true');
        video.src = media(short.videoUrl);
        video.addEventListener('playing', () => { if (a.matches(':hover')) a.classList.add('previewing'); });
        a.insertBefore(video, a.querySelector('.rs-badge'));
      }
      video.play().catch(() => {});
    });
    a.addEventListener('pointerleave', () => stopPreview(a));
    return a;
  }

  function stopPreview(a) {
    const video = a.querySelector('video');
    a.classList.remove('previewing');
    if (!video) return;
    video.pause();
    try { video.currentTime = 0; } catch {}
  }

  // --- the player -----------------------------------------------------------------

  const player = createPlayer();

  function createPlayer() {
    const overlay = el('div', 'rs-player');
    overlay.hidden = true;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Shorts');
    const track = el('div', 'rs-track');
    track.tabIndex = -1;
    track.setAttribute('aria-label', 'Shorts: the arrow keys, the wheel or a swipe move between them');
    const top = el('div', 'rs-top');
    const close = iconButton('rs-btn rs-close', 'Close the Shorts', () => shut(), 'close');
    const mute = el('button', 'rs-btn rs-mute');
    mute.type = 'button';
    mute.addEventListener('click', () => setSound(!sound));
    const share = el('button', 'rs-btn rs-share');
    share.type = 'button';
    share.title = 'Copy a link to this Short: it plays in Discord';
    share.addEventListener('click', () => shareActive());
    renderShare();
    const tools = el('div', 'rs-tools');
    tools.append(share, mute);
    top.append(close, tools);
    const nav = el('div', 'rs-nav');
    const up = iconButton('rs-btn', 'Previous Short', () => go(active - 1), 'up');
    const down = iconButton('rs-btn', 'Next Short', () => go(active + 1), 'down');
    nav.append(up, down);
    const counter = el('div', 'rs-count');
    counter.setAttribute('aria-hidden', 'true');
    overlay.append(track, top, nav, counter);
    document.body.append(overlay);

    let list = [];          // the Shorts the player moves through
    let slides = [];
    let active = -1;
    let from = null;        // the card to give focus back to
    let pushed = false;     // the open player is a history entry of its own
    let sound = soundWanted();
    let counted = new Set();
    const recordings = new Map();   // recordingSlug -> Promise<recording>

    function renderMute() {
      mute.classList.toggle('on', sound);
      mute.innerHTML = icon(sound ? 'sound' : 'muted');
      if (!sound) mute.append(el('span', '', 'Unmute'));
      mute.setAttribute('aria-label', sound ? 'Mute' : 'Unmute');
      mute.setAttribute('aria-pressed', String(sound));
      mute.title = sound ? 'Mute' : 'Unmute';
    }
    renderMute();

    let shared = 0;   // the timer that puts the Share button back
    function renderShare(said = 'Share') {
      share.innerHTML = icon('link');
      share.append(el('span', '', said));
      share.setAttribute('aria-label', said === 'Share' ? 'Copy a link to this Short' : said);
      share.classList.toggle('done', said !== 'Share');
    }

    /** Copies the open Short's share link; a phone offers its own share sheet
     *  (Discord's app among them). */
    async function shareActive() {
      const short = slides[active]?.short;
      if (!short) return;
      const href = shortShareHref(short.slug, { base: state.api?.base ?? '' }) ?? shortAddress(location.href, short.slug);
      if (navigator.share && matchMedia('(pointer: coarse)').matches) {
        try { await navigator.share({ title: short.title, url: href }); } catch {}
        return;
      }
      try {
        await navigator.clipboard.writeText(href);
        renderShare('Link copied');
        clearTimeout(shared);
        shared = setTimeout(() => renderShare(), 2200);
      } catch {
        window.prompt('The link to this Short:', href);
      }
    }

    function setSound(on) {
      sound = on;
      rememberSound(on);
      renderMute();
      const video = slides[active]?.video;
      if (video) {
        video.muted = !on;
        if (video.paused) play(slides[active]);
      }
    }

    function slide(short) {
      const node = el('div', 'rs-slide');
      node.dataset.slug = short.slug;
      const screen = el('div', 'rs-screen');
      if (short.posterUrl) screen.style.backgroundImage = `url("${media(short.posterUrl)}")`;
      const paused = el('span', 'rs-paused');
      paused.innerHTML = icon('play');
      const info = el('div', 'rs-info');
      const line = shortLine(short);
      const kill = el('div', 'rs-kill');
      if (line.killer || line.victim) {
        kill.append(el('b', '', line.killer || 'Someone'));
        kill.insertAdjacentHTML('beforeend', icon('arrow'));
        kill.append(el('b', '', line.victim || 'someone'));
        const said = [line.weapon, line.distance].filter(Boolean).join(' · ');
        if (said) kill.append(el('span', 'rs-with', said));
      }
      const watch = el('a', 'rs-watch');
      watch.innerHTML = icon('round');
      watch.append('Watch the round');
      watch.setAttribute('aria-label', `Watch the round from ${Math.floor(shortWatchAt(short.killTime))} seconds in, just before the kill`);
      watch.setAttribute('aria-disabled', 'true');
      const sub = el('div', 'rs-sub', shortMeta(short));
      info.append(badge(short.kind), el('h2', '', short.title), kill, sub, watch);
      screen.append(paused, info);
      node.append(screen);
      // A click on the picture pauses and plays; the info's links are their own.
      screen.addEventListener('click', e => {
        if (e.target.closest('a, button')) return;
        const s = slides.find(x => x.node === node);
        if (!s?.video) return;
        if (s.video.paused) play(s);
        else s.video.pause();
      });
      return { node, short, screen, watch, sub, video: null };
    }

    /** The slide's video, loaded with `preload`. */
    function arm(s, preload) {
      if (!s) return null;
      if (!s.video) {
        const video = el('video');
        Object.assign(video, { loop: true, playsInline: true, muted: true, preload });
        video.setAttribute('playsinline', '');
        video.disablePictureInPicture = true;
        video.src = media(s.short.videoUrl);
        video.addEventListener('play', () => s.node.classList.remove('paused'));
        video.addEventListener('pause', () => { if (slides[active] === s) s.node.classList.add('paused'); });
        video.addEventListener('timeupdate', () => {
          if (slides[active] === s && video.currentTime >= VIEW_AFTER) countView(s);
        });
        s.screen.prepend(video);
        s.video = video;
      } else if (preload === 'auto' && s.video.preload !== 'auto') {
        s.video.preload = 'auto';
        s.video.load();
      }
      return s.video;
    }

    function disarm(s) {
      if (!s?.video) return;
      s.video.pause();
      s.video.removeAttribute('src');
      s.video.load();
      s.video.remove();
      s.video = null;
      s.node.classList.remove('paused');
    }

    function play(s) {
      const video = s.video;
      video.muted = !sound;
      video.play().catch(() => {
        // Sound without a tap this page: muted, and the button says so.
        if (!video.muted) {
          sound = false;
          renderMute();
          video.muted = true;
          video.play().catch(() => s.node.classList.add('paused'));
        } else {
          s.node.classList.add('paused');
        }
      });
    }

    function countView(s) {
      const slug = s.short.slug;
      if (counted.has(slug)) return;
      counted.add(slug);
      state.api?.viewShort(slug).then(answer => {
        if (!Number.isFinite(answer?.views)) return;
        s.short.views = answer.views;
        s.sub.textContent = shortMeta(s.short);
      }).catch(error => console.warn('replay-shorts: counting a view', error));
    }

    /** Watch the round: the recording's own Watch, at the kill, once the
     *  recording is read. */
    function linkWatch(s) {
      if (s.watch.getAttribute('aria-disabled') !== 'true' || !s.short.recordingSlug) return;
      const slug = s.short.recordingSlug;
      if (!recordings.has(slug)) recordings.set(slug, state.api.get(slug));
      recordings.get(slug).then(recording => {
        s.watch.href = shortWatchHref(s.short, recording, { root, fileUrl: media });
        s.watch.removeAttribute('aria-disabled');
      }, error => {
        recordings.delete(slug);
        console.warn('replay-shorts: the Short\'s recording', error);
      });
    }

    function activate(index) {
      if (index === active || !slides[index]) return;
      const was = slides[active];
      if (was?.video) was.video.pause();
      active = index;
      const s = slides[index];
      s.node.classList.remove('paused');
      arm(s, 'auto');
      play(s);
      linkWatch(s);
      // The next one loads while this one plays; the one before stays ready.
      arm(slides[index + 1], 'auto');
      if (slides[index + 1]) linkWatch(slides[index + 1]);
      arm(slides[index - 1], 'metadata');
      slides.forEach((other, i) => { if (Math.abs(i - index) > 2) disarm(other); });
      up.disabled = index <= 0;
      down.disabled = index >= slides.length - 1 && state.items.length >= state.total;
      counter.textContent = `${index + 1} / ${Math.max(list.length, state.total)}`;
      history.replaceState(history.state, '', shortAddress(location.href, s.short.slug));
      if (index >= slides.length - 3) more();
    }

    // The wheel moves a Short a notch: a trackpad's flick, however long its
    // tail of events, is one Short, as it is on YouTube.
    let wheelLast = 0;
    let wheelFrom = 0;
    overlay.addEventListener('wheel', e => {
      if (overlay.hidden) return;
      e.preventDefault();
      const now = performance.now();
      const quiet = now - wheelLast > 180;
      wheelLast = now;
      if (Math.abs(e.deltaY) < 4 || (!quiet && now - wheelFrom < 900)) return;
      wheelFrom = now;
      go(active + Math.sign(e.deltaY));
    }, { passive: false });

    let settle = 0;
    track.addEventListener('scroll', () => {
      cancelAnimationFrame(settle);
      settle = requestAnimationFrame(() => {
        const h = track.clientHeight || 1;
        const index = Math.round(track.scrollTop / h);
        if (Math.abs(track.scrollTop - index * h) < h * 0.35) activate(Math.min(index, slides.length - 1));
      });
    }, { passive: true });

    function go(index, behavior = 'smooth') {
      if (index < 0) return;
      if (index >= slides.length) {
        more();
        return;
      }
      track.scrollTo({ top: index * track.clientHeight, behavior });
      // A jump with no scroll to speak of (instant, or already there).
      if (behavior !== 'smooth') activate(index);
    }

    // Keys while the player is up are the player's: the feed's Escape and the
    // page's own keys wait.
    window.addEventListener('keydown', e => {
      if (overlay.hidden) return;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName ?? '');
      if (e.key === 'Escape') shut();
      else if (typing) return;
      else if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === 'j') go(active + 1);
      else if (e.key === 'ArrowUp' || e.key === 'PageUp' || e.key === 'k') go(active - 1);
      else if (e.key === 'm') setSound(!sound);
      else if (e.key === ' ' && !e.target?.closest?.('a, button')) {
        const video = slides[active]?.video;
        if (video) { if (video.paused) play(slides[active]); else video.pause(); }
      } else return;
      e.preventDefault();
      e.stopPropagation();
    }, true);

    // Resizing keeps the Short on screen.
    new ResizeObserver(() => {
      if (!overlay.hidden && active >= 0) track.scrollTop = active * track.clientHeight;
    }).observe(track);

    /** Opens the player on `slug`, from the strip's Shorts (fetching it when
     *  it is not among them). */
    async function open(slug, { from: card = null, push = true } = {}) {
      from = card ?? strip.querySelector(`.rs-card[data-slug="${CSS.escape(slug)}"]`) ?? document.activeElement;
      await load();
      if (!state.api) return;
      let short = state.items.find(s => s.slug === slug);
      list = [...state.items];
      if (!short) {
        try {
          short = await state.api.short(slug);
        } catch (error) {
          console.warn('replay-shorts: the Short', slug, error);
          history.replaceState(history.state, '', shortAddress(location.href, null));
          return;
        }
        list = [short, ...list.filter(s => s.slug !== slug)];
      }
      counted = new Set();
      slides.forEach(disarm);
      slides = list.map(slide);
      track.replaceChildren(...slides.map(s => s.node));
      active = -1;
      if (push && !pushed && new URL(location.href).searchParams.get('short') !== slug) {
        history.pushState({ ...(history.state ?? {}), tab: 'replay', short: slug }, '', shortAddress(location.href, slug));
        pushed = true;
      }
      overlay.hidden = false;
      const index = Math.max(0, list.findIndex(s => s.slug === slug));
      track.scrollTop = index * track.clientHeight;
      activate(index);
      close.focus({ preventScroll: true });
    }

    /** Appends the strip's newly loaded Shorts. */
    function moreSlides(fresh) {
      if (overlay.hidden || !fresh.length) return;
      const add = fresh.filter(s => !list.some(o => o.slug === s.slug));
      list.push(...add);
      const made = add.map(slide);
      slides.push(...made);
      track.append(...made.map(s => s.node));
      down.disabled = active >= slides.length - 1;
      counter.textContent = `${active + 1} / ${Math.max(list.length, state.total)}`;
      if (active >= slides.length - 1 - made.length) arm(slides[active + 1], 'auto');
    }

    /** Closes the player: by its button or Escape (`fromHistory` false) or by
     *  the browser's Back. */
    function shut({ fromHistory = false } = {}) {
      if (overlay.hidden) return;
      overlay.hidden = true;
      slides.forEach(disarm);
      slides = [];
      track.replaceChildren();
      active = -1;
      if (!fromHistory) {
        if (pushed) history.back();
        else history.replaceState(history.state, '', shortAddress(location.href, null));
      }
      pushed = false;
      const card = from?.isConnected ? from : null;
      from = null;
      card?.focus({ preventScroll: false });
    }

    return { open, shut, more: moreSlides, get open_() { return !overlay.hidden; }, element: overlay };
  }

  /** What the address says of the player: `short` opens it, its absence
   *  closes it (the browser's Back). */
  function route(params) {
    const slug = params.get('short');
    if (slug) {
      if (!player.open_ || !player.element.querySelector(`.rs-slide[data-slug="${CSS.escape(slug)}"]`)) {
        player.open(slug, { push: false });
      }
    } else if (player.open_) {
      player.shut({ fromHistory: true });
    }
  }

  return {
    strip,
    place,
    load,
    route,
    open: (slug, options) => player.open(slug, options),
    /** Closes the player; `quiet` leaves the address to whoever is changing it. */
    close: ({ quiet = false } = {}) => player.shut({ fromHistory: quiet }),
    get isOpen() { return player.open_; },
    get state() { return state; },
  };
}
