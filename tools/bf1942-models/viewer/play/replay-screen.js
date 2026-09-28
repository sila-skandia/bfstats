// The REPLAY tab (features/replay-feed): what the front end draws behind
// every tab — `menu/Background` out of `main-menu-layout.json`, the
// navigation strip over it, REPLAY lit on INTRO's plate — with the feed of
// shared recordings (`recordings-feed.js`) laid into the frame where a page of
// the menu sits, from under the strip to above the bottom bar.
//
// On a screen taller than the menu's 4:3 (a phone held upright) the menu is
// drawn at the top rather than in the middle, and the feed takes the rest of
// the screen under the strip: the menu's own plates would leave it a strip
// of a few hundred pixels.

import { createNavStrip } from './nav-strip.js';
import { createMenuPack } from './menu-pack.js';
import { elementVisible, inRect, paintElement, stageScale, toVirtual } from './menu-screen.js';
import { createReplayFeed } from './recordings-feed.js';
import { hudPaths as plainHudPaths } from '../hud-pack.js';

/** The feed's box in the menu's 800x600: under the tab strip, above the
 *  bottom bar's edge. */
const FEED_BOX = [24, 90, 752, 492];
/** On a stage letterboxed top and bottom, the feed runs from under the strip
 *  to this far off the bottom of the screen, CSS pixels. */
const GUTTER = 8;

/** stageScale, drawn from the top rather than centred when the screen is
 *  taller than the menu. */
function topStage(width, height, virtual) {
  const s = stageScale(width, height, virtual);
  return s.oy > 0 ? { ...s, oy: 0 } : s;
}

/**
 * @param {object} options
 * @param {HTMLCanvasElement} options.canvas
 * @param {string} [options.root]
 * @param {Array} [options.tabs]   the front end's navigation rows (nav-strip.js)
 * @param {(id: string) => void} [options.onTab]
 * @param {(text: string) => void} [options.onStatus]
 * @param {() => void} [options.onWatchFile]  Open recording's file picker
 * @param {() => string} [options.playerName]
 */
export function createReplayScreen({
  canvas,
  root = '../',
  tabs = null,
  onTab = () => {},
  onStatus = () => {},
  onWatchFile = null,
  playerName = () => '',
} = {}) {
  const params = new URLSearchParams(location.search);
  const bust = () => (params.has('nocache') ? `?t=${Date.now()}` : '');
  // The strip and the background are vanilla's, as on every other tab until a
  // mod is loaded into them: the feed spans every mod.
  const hudPaths = plainHudPaths('bf1942', null, { root });
  const packUrl = rel => (params.get('pack') ? `${params.get('pack')}/${rel}` : hudPaths.menuUrl(rel));
  const ctx = canvas.getContext('2d');
  let layout = null;
  let strip = null;
  let hover = null;
  const pack = createMenuPack({ url: packUrl, bust, onImage: () => paintSoon(), env: { get hover() { return hover; } } });
  const feed = createReplayFeed({ root, onWatchFile, playerName });

  async function load() {
    layout = await pack.load(await pack.json(packUrl('main-menu-layout.json')));
    if (tabs) strip = createNavStrip({ layout, env: pack.env, rows: tabs, active: 'replay', onPick: onTab });
    onStatus('');
    paint();
  }

  function stage() {
    return topStage(canvas.clientWidth, canvas.clientHeight, layout?.virtual ?? [800, 600]);
  }

  /** The feed's box on screen, CSS pixels. */
  function feedBox() {
    const r = canvas.getBoundingClientRect();
    const s = stage();
    const [x, y, w, h] = FEED_BOX;
    const box = { left: r.left + s.ox + x * s.sx, top: r.top + s.oy + y * s.sy, width: w * s.sx, height: h * s.sy };
    if (r.height - (s.oy + 600 * s.sy) > 1) {
      // Letterboxed: the rest of the screen, under the strip and the music
      // switch in the corner (loading-audio-ui.js), which sits lower than the
      // strip on a narrow screen.
      const mute = document.querySelector('.ld-mute-btn')?.getBoundingClientRect();
      if (mute?.height) box.top = Math.max(box.top, mute.bottom + GUTTER);
      box.left = r.left + GUTTER;
      box.width = r.width - 2 * GUTTER;
      box.height = r.bottom - GUTTER - box.top;
    }
    return box;
  }

  let pending = false;
  function paintSoon() {
    if (pending || !layout) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; paint(); });
  }

  function paint() {
    if (!layout || canvas.hidden) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    const cw = Math.round(w * dpr);
    const ch = Math.round(h * dpr);
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
    const s = stage();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, cw, ch);
    ctx.setTransform(s.sx * dpr, 0, 0, s.sy * dpr, s.ox * dpr, s.oy * dpr);
    const table = layout.variables || {};
    for (const el of layout.pages?.background?.elements || []) {
      if (elementVisible(el, table)) paintElement(ctx, el, layout, null, pack.env);
    }
    strip?.paint(ctx);
    ctx.globalAlpha = 1;
    feed.place(feedBox());
  }

  new ResizeObserver(() => paint()).observe(canvas);
  window.addEventListener('scroll', () => { if (!canvas.hidden) feed.place(feedBox()); }, { passive: true });

  const at = event => {
    const r = canvas.getBoundingClientRect();
    return toVirtual(topStage(r.width, r.height, layout.virtual), event.clientX - r.left, event.clientY - r.top);
  };

  canvas.addEventListener('pointermove', event => {
    if (!layout) return;
    const [x, y] = at(event);
    const next = strip?.hover(x, y) ?? null;
    const changed = JSON.stringify(next) !== JSON.stringify(hover);
    hover = next;
    canvas.style.cursor = next ? 'pointer' : 'default';
    if (changed) paintSoon();
  });
  canvas.addEventListener('pointerleave', () => { hover = null; paintSoon(); });
  canvas.addEventListener('click', event => {
    if (!layout) return;
    const [x, y] = at(event);
    if (strip?.click(x, y)) return;
    // A click on the frame round the feed is not a click on the strip: nothing.
    if (!inRect(FEED_BOX, x, y)) canvas.focus();
  });

  return {
    load,
    paint,
    feed,
    /** The tab is up: the feed shows what the URL names. */
    show(query = new URLSearchParams(location.search)) {
      paint();
      feed.show(query);
    },
    hide() { feed.hide(); },
    keydown() { return false; },
    get strip() { return strip; },
  };
}
