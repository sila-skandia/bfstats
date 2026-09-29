// The front end's background movie: `Movies/background.bik`, which retail's
// `menu/Background` plays in its `BfBinkNode` (gated on `PlayBink`) over the
// same 800x450 rect as the still `menu/Texture/Menu/Background.tga`. Every
// front-end page is drawn over `menu/Background`, so the movie loops behind
// all of them - Instant Battle, MULTIPLAY, OPTIONS, CUSTOM GAME and REPLAY -
// and keeps playing through a tab switch rather than starting over. The
// engine stops it once there is a game behind the menu, which is why only
// `play/index.html` starts it and `map.html`'s Esc menu never does.
//
// One movie per page, so this is module state rather than a screen's: every
// `menu-pack.js` env hands the playing frame back in place of the still
// plate (`MOVIE_PLATE`), and repaints on each new frame. Until a frame has
// decoded - or when the mod has no movie, or the browser plays no WebM - the
// still is what is drawn, exactly as before.
//
// The file is `extract_menu_movie.py`'s: `<maps>/_shared/movies/background.webm`
// in each mod's maps root. A mod without one keeps its still; vanilla's movie
// is not borrowed, since a mod's still is its own art and vanilla's footage
// would play over it.

/** The layout texture the movie stands in for (`menu/Background`'s plate). */
export const MOVIE_PLATE = 'background';

const listeners = new Set();
let video = null;
let src = null;
let failed = false;
let frames = 0;

function notify() {
  frames += 1;
  for (const fn of listeners) {
    try { fn(); } catch (error) { console.warn('menu-movie: a repaint threw', error); }
  }
}

/** Repaint on every frame the video presents; `requestVideoFrameCallback`
 *  where the browser has it (25 a second, the movie's own rate), otherwise
 *  the display's frame loop while it plays. */
function watchFrames(el) {
  if (typeof el.requestVideoFrameCallback === 'function') {
    const next = () => { if (el === video) { notify(); el.requestVideoFrameCallback(next); } };
    el.requestVideoFrameCallback(next);
    return;
  }
  const tick = () => {
    if (el !== video) return;
    if (!el.paused) notify();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** A browser that refused to autoplay (a muted movie normally may) starts
 *  it on the player's first press instead. */
function play(el) {
  const p = el.play();
  if (!p?.catch) return;
  p.catch(() => {
    const retry = () => { if (el === video) el.play().catch(() => {}); };
    document.addEventListener('pointerdown', retry, { once: true, capture: true });
    document.addEventListener('keydown', retry, { once: true, capture: true });
  });
}

function create() {
  const el = document.createElement('video');
  el.muted = true;
  el.defaultMuted = true;
  el.loop = true;
  el.playsInline = true;
  el.preload = 'auto';
  el.setAttribute('aria-hidden', 'true');
  // In the document, but not seen: some browsers stop decoding a video that
  // is detached or `display: none`, and the canvas draws it anyway.
  el.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;'
    + 'opacity:0;pointer-events:none;';
  // `paintElement` reads `width`/`height` to decide on smoothing: a 320x180
  // movie scaled to 800x450 wants it on.
  el.addEventListener('loadedmetadata', () => {
    el.width = el.videoWidth;
    el.height = el.videoHeight;
  });
  el.addEventListener('error', () => {
    if (el !== video) return;
    failed = true;
    console.warn(`menu-movie: ${src} did not load; the still plate stays`);
    notify();
  });
  document.body.appendChild(el);
  watchFrames(el);
  return el;
}

export const menuMovie = {
  /** Play `url` behind the front end. The same url again is a no-op, so a
   *  screen's `load` can ask on every mod change and only a mod with its own
   *  movie restarts it. */
  start(url) {
    if (url === src && video) return;
    src = url;
    failed = false;
    try {
      video ??= create();
      video.src = url;
      play(video);
    } catch (error) {
      failed = true;
      console.warn('menu-movie: left out', error);
    }
  },

  /** The frame to draw in place of the still, or null to draw the still. */
  frame() {
    if (!video || failed || video.readyState < 2 || !video.videoWidth) return null;
    return video;
  },

  /** Called on every new frame; returns the unsubscribe. */
  onFrame(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  /** For tests and `window.__menu`. */
  get state() {
    return {
      src,
      failed,
      frames,
      readyState: video?.readyState ?? 0,
      currentTime: video?.currentTime ?? 0,
      paused: video ? video.paused : true,
      size: video ? [video.videoWidth, video.videoHeight] : [0, 0],
    };
  },
};
