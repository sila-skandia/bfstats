// Load progress for the viewers.
//
// Two presentations share one API:
//   - placement: 'corner' — compact card for the models page
//   - anything else (map.html default) — authentic BF1942 loading screen:
//     fullscreen setLoadPicture art, menu_loading plate, loading_bar fill,
//     and optional loading music via LoadingAudioController
//
// Weighted steps keep the bar honest across an uneven pipeline (one ~70 MB
// scene glb against a 2 KB report and a handful of loose textures).

import { createLoadingAudioController } from './audio.js';

const STYLE_ID = 'ld-overlay-style';

const SHOW_DELAY_MS = 180;
const FADE_MS = 400;
const RATE_WINDOW_MS = 3000;

const DEFAULT_CHROME = {
  plate: '_shared/load/menu_loading.png',
  bar: '_shared/load/loading_bar.png',
  music: '_shared/music/vehicle4.mp3',
  background: '_shared/load/western.webp',
};

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.ld-overlay {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: block;
  pointer-events: none;
  opacity: 0;
  transition: opacity ${FADE_MS}ms cubic-bezier(0.4, 0, 0.2, 1);
  overflow: hidden;
  user-select: none;
  background: #000;
  font: 12px/1.5 var(--mm-font-mono, ui-monospace, "Geist Mono", "SF Mono", Menlo, monospace);
}
.ld-overlay[hidden] { display: none; }
.ld-overlay[data-shown="true"] { opacity: 1; }

.ld-overlay[data-placement="corner"] {
  display: grid;
  place-items: start end;
  padding: 16px;
  background: transparent;
  z-index: 6;
}
.ld-overlay[data-placement="corner"] .ld-bg-layer,
.ld-overlay[data-placement="corner"] .ld-stage {
  display: none;
}
.ld-overlay[data-placement="corner"] .ld-card { display: block; }
.ld-overlay:not([data-placement="corner"]) .ld-card { display: none; }

.ld-card {
  width: min(360px, calc(100% - 32px));
  padding: 12px 14px;
  background: var(--mm-bg, #131313);
  border: 1px solid var(--mm-rule-strong, #3d3d3d);
  border-radius: 2px;
  pointer-events: none;
}
.ld-overlay[data-placement="corner"] .ld-card { width: min(300px, 100%); }
.ld-card .ld-title {
  position: static;
  width: auto;
  height: auto;
  left: auto;
  top: auto;
  font: inherit;
  font-size: 10px;
  letter-spacing: .14em;
  text-transform: uppercase;
  color: var(--mm-accent-soft, #9aa666);
  margin-bottom: 9px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ld-bar {
  position: relative;
  height: 2px;
  background: var(--mm-bg-mute, #222222);
  overflow: hidden;
}
.ld-bar i {
  display: block;
  height: 100%;
  width: 0;
  background: var(--mm-accent, #7d8849);
  transition: width 160ms linear;
}
.ld-bar[data-indeterminate="true"] i {
  width: 34% !important;
  transition: none;
  animation: ld-sweep 1.1s ease-in-out infinite;
}
@keyframes ld-sweep {
  0%   { transform: translateX(-110%); }
  100% { transform: translateX(330%); }
}
.ld-meta {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-top: 9px;
  color: var(--mm-ink, #ffffff);
  font-size: 11px;
}
.ld-phase { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ld-pct { color: var(--mm-accent-soft, #9aa666); font-variant-numeric: tabular-nums; }
.ld-sub {
  margin-top: 4px;
  color: var(--mm-ink-muted, #8a8a8a);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  min-height: 15px;
}
.ld-overlay[data-state="error"] .ld-card .ld-title,
.ld-overlay[data-state="error"] .ld-pct { color: var(--mm-load-busy, #c5a23a); }
.ld-overlay[data-state="error"] .ld-bar i { background: var(--mm-load-busy, #c5a23a); }

.ld-bg-layer {
  position: absolute;
  inset: 0;
  overflow: hidden;
}
.ld-bg-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
  pointer-events: none;
}
.ld-stage {
  position: absolute;
  width: 800px;
  height: 600px;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%) scale(var(--ld-scale, 1));
  transform-origin: center center;
  pointer-events: none;
}
.ld-box {
  position: absolute;
  left: 260px;
  top: 465px;
  width: 290px;
  height: 64px;
  background-image: var(--ld-menu-loading-img);
  background-size: 290px 64px;
  background-repeat: no-repeat;
  box-sizing: border-box;
}
.ld-stage .ld-title {
  position: absolute;
  left: 10px;
  top: 6px;
  width: 268px;
  height: 16px;
  font-family: "Trebuchet MS", "Lucida Grande", "Segoe UI", sans-serif;
  font-size: 11px;
  font-weight: 700;
  line-height: 16px;
  color: #000;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ld-trough {
  position: absolute;
  left: 17px;
  top: 33px;
  width: 258px;
  height: 18px;
  border: 1px solid #8c8c8c;
  box-sizing: border-box;
  background: #000;
  overflow: hidden;
}
.ld-fill {
  position: absolute;
  left: 1px;
  top: 1px;
  height: 14px;
  width: 0;
  max-width: 256px;
  background-image: var(--ld-loading-bar-img);
  background-size: 256px 14px;
  background-repeat: no-repeat;
  background-color: var(--ld-fill-color, #847d4a);
  transition: width 120ms linear;
}
.ld-overlay[data-theme="eod"] {
  --ld-fill-color: #f7e7b5;
}
.ld-prompt {
  position: absolute;
  left: 0;
  top: 535px;
  width: 800px;
  height: 20px;
  text-align: center;
  font-family: var(--mm-font-mono, monospace);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 1.5px;
  color: #d7baa6;
  text-transform: uppercase;
}
.ld-overlay[data-state="error"] .ld-prompt { color: #c5a23a; }
.ld-briefing {
  position: absolute;
  left: 150px;
  top: 96px;
  width: 500px;
  height: 330px;
  box-sizing: border-box;
  padding: 22px 30px;
  overflow: hidden;
  color: #d7d2c4;
  font-family: "Trebuchet MS", "Lucida Grande", "Segoe UI", sans-serif;
  text-align: center;
}
.ld-briefing[data-empty="true"] { display: none; }
.ld-briefing-type {
  display: inline-block;
  padding: 3px 14px;
  margin-bottom: 14px;
  border: 1px solid #8c8c8c;
  color: #e8e3d4;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 3px;
  text-transform: uppercase;
}
.ld-briefing-heading {
  margin-bottom: 12px;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 4px;
  color: #f0ead6;
  text-transform: uppercase;
}
.ld-briefing-heading::before,
.ld-briefing-heading::after {
  content: "";
  display: inline-block;
  width: 40px;
  height: 1px;
  margin: 0 10px;
  vertical-align: middle;
  background: #8c8c8c;
}
.ld-briefing-text {
  font-size: 12px;
  line-height: 1.65;
  text-align: left;
  white-space: pre-line;
  overflow: hidden;
}

body.is-portrait .ld-overlay { display: none; }
@media (prefers-reduced-motion: reduce) {
  .ld-overlay, .ld-bar i, .ld-fill { transition: none; }
  .ld-bar[data-indeterminate="true"] i { animation: none; }
}
`;
  document.head.appendChild(style);
}

function formatBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '0 MB';
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

function formatRate(bytesPerSecond) {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return null;
  if (bytesPerSecond < 1024 * 1024) return `${(bytesPerSecond / 1024).toFixed(0)} KB/s`;
  return `${(bytesPerSecond / 1048576).toFixed(1)} MB/s`;
}

function formatEta(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  if (seconds < 1) return 'almost there';
  if (seconds < 60) return `${Math.ceil(seconds)}s left`;
  return `${Math.floor(seconds / 60)}m ${String(Math.ceil(seconds % 60)).padStart(2, '0')}s left`;
}

function resolveUrl(base, rel) {
  if (!rel) return '';
  if (/^(?:https?:|data:|blob:)/i.test(rel)) return rel;
  const root = (base || '').replace(/\/+$/, '');
  const path = String(rel).replace(/^\/+/, '');
  return root ? `${root}/${path}` : path;
}

function cssUrl(url) {
  return `url("${String(url).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}")`;
}

function loadingTitle(name, explicit) {
  if (explicit) {
    const t = String(explicit).trim();
    return /^loading\b/i.test(t) ? t.toUpperCase() : `LOADING ${t.toUpperCase()}`;
  }
  const clean = String(name || 'MAP').replace(/_/g, ' ').trim().toUpperCase();
  return `LOADING ${clean}`;
}

/** `placement`: 'corner' for the models page, otherwise authentic map load. */
export function createLoadOverlay(host, {
  placement = 'authentic',
  assetBase = 'maps',
  audioController = null,
  audioOptions = undefined,
} = {}) {
  injectStyle();

  const authentic = placement !== 'corner';
  const root = document.createElement('div');
  root.className = 'ld-overlay';
  root.dataset.placement = authentic ? 'authentic' : 'corner';
  root.hidden = true;
  root.setAttribute('role', 'status');
  root.setAttribute('aria-live', 'polite');

  if (authentic) {
    root.innerHTML =
      '<div class="ld-bg-layer" aria-hidden="true"><img class="ld-bg-img" alt=""></div>' +
      '<div class="ld-stage">' +
      '<div class="ld-briefing" data-empty="true" aria-hidden="true">' +
      '<div class="ld-briefing-type"></div>' +
      '<div class="ld-briefing-heading">MISSION BRIEFING</div>' +
      '<div class="ld-briefing-text"></div>' +
      '</div>' +
      '<div class="ld-box">' +
      '<div class="ld-title"></div>' +
      '<div class="ld-trough" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">' +
      '<div class="ld-fill"></div>' +
      '</div></div>' +
      '<div class="ld-prompt">PRESS ESCAPE TO CANCEL</div>' +
      '</div>' +
      '<div class="ld-card" hidden>' +
      '<div class="ld-title"></div>' +
      '<div class="ld-bar"><i></i></div>' +
      '<div class="ld-meta"><span class="ld-phase"></span><span class="ld-pct"></span></div>' +
      '<div class="ld-sub"></div>' +
      '</div>';
  } else {
    root.innerHTML =
      '<div class="ld-card">' +
      '<div class="ld-title"></div>' +
      '<div class="ld-bar"><i></i></div>' +
      '<div class="ld-meta"><span class="ld-phase"></span><span class="ld-pct"></span></div>' +
      '<div class="ld-sub"></div>' +
      '</div>';
  }
  host.appendChild(root);

  const elBg = root.querySelector('.ld-bg-img');
  const elStage = root.querySelector('.ld-stage');
  const elAuthTitle = authentic ? root.querySelector('.ld-box .ld-title') : null;
  const elBriefing = authentic ? root.querySelector('.ld-briefing') : null;
  const elBriefingType = authentic ? root.querySelector('.ld-briefing-type') : null;
  const elBriefingText = authentic ? root.querySelector('.ld-briefing-text') : null;
  const elTrough = root.querySelector('.ld-trough');
  const elFill = root.querySelector('.ld-fill');
  const elPrompt = root.querySelector('.ld-prompt');
  const elCardTitle = root.querySelector('.ld-card .ld-title') || root.querySelector('.ld-title');
  const elBar = root.querySelector('.ld-bar');
  const elBarFill = root.querySelector('.ld-bar i');
  const elPhase = root.querySelector('.ld-phase');
  const elPct = root.querySelector('.ld-pct');
  const elSub = root.querySelector('.ld-sub');

  /** @type {Map<string, {label: string, weight: number, fraction: number|null, done: boolean, loaded: number, total: number, started: boolean}>} */
  const steps = new Map();
  let samples = [];
  let showTimer = null;
  let hideTimer = null;
  let visible = false;
  let generation = 0;
  let displayFraction = 0;
  let animFrame = 0;
  let base = assetBase;
  let audio = audioController;
  if (authentic && !audio && audioOptions !== null) {
    try {
      audio = createLoadingAudioController(audioOptions || {});
    } catch (_) {
      audio = null;
    }
  }
  if (authentic && audio) {
    try { audio.attachUnmuteButton(root); } catch (_) { /* headless */ }
  }

  function clearTimers() {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    showTimer = null;
    hideTimer = null;
  }

  function fitStage() {
    if (!elStage || !host) return;
    const w = host.clientWidth || 800;
    const h = host.clientHeight || 600;
    const s = Math.min(w / 800, h / 600);
    elStage.style.setProperty('--ld-scale', String(s > 0 ? s : 1));
  }

  let resizeObs = null;
  if (authentic && typeof ResizeObserver === 'function') {
    resizeObs = new ResizeObserver(fitStage);
    resizeObs.observe(host);
    fitStage();
  }

  function reveal() {
    showTimer = null;
    root.hidden = false;
    fitStage();
    void root.offsetWidth;
    root.dataset.shown = 'true';
    visible = true;
  }

  function conceal() {
    root.dataset.shown = 'false';
    visible = false;
    hideTimer = setTimeout(() => { root.hidden = true; }, FADE_MS);
  }

  function totals() {
    let weightSum = 0;
    let progressed = 0;
    let loaded = 0;
    let total = 0;
    let unknown = false;
    let active = null;
    for (const step of steps.values()) {
      weightSum += step.weight;
      const fraction = step.done ? 1 : step.fraction;
      if (fraction == null) {
        if (step.started) unknown = true;
      } else {
        progressed += step.weight * fraction;
      }
      loaded += step.loaded;
      total += step.total;
      if (!active && !step.done) active = step;
    }
    return {
      fraction: weightSum ? progressed / weightSum : 0,
      unknown,
      loaded,
      total,
      active,
    };
  }

  function rate(loaded) {
    const now = performance.now();
    samples.push({ t: now, bytes: loaded });
    while (samples.length > 2 && now - samples[0].t > RATE_WINDOW_MS) samples.shift();
    const first = samples[0];
    const elapsed = (now - first.t) / 1000;
    if (elapsed < 0.35) return null;
    const moved = loaded - first.bytes;
    return moved > 0 ? moved / elapsed : null;
  }

  function stopAnim() {
    if (animFrame) {
      cancelAnimationFrame(animFrame);
      animFrame = 0;
    }
  }

  function tickAnim() {
    animFrame = 0;
    const { fraction, unknown } = totals();
    const target = unknown && fraction < 1 ? Math.max(displayFraction, fraction) : fraction;
    const delta = target - displayFraction;
    if (Math.abs(delta) > 0.0005) {
      displayFraction += delta * Math.min(1, 0.18);
      animFrame = requestAnimationFrame(tickAnim);
    } else {
      displayFraction = target;
    }
    paintBar(displayFraction, unknown && fraction < 1);
  }

  function paintBar(fraction, indeterminate) {
    const pct = Math.min(100, Math.max(0, fraction * 100));
    const shown = indeterminate ? Math.min(99, Math.floor(pct)) : (fraction >= 1 ? 100 : Math.min(99, Math.floor(pct)));
    if (elFill) {
      elFill.style.width = indeterminate ? `${Math.max(8, pct * 0.34).toFixed(1)}%` : `${((pct / 100) * 256).toFixed(1)}px`;
    }
    if (elTrough) elTrough.setAttribute('aria-valuenow', String(shown));
    if (elBar) elBar.dataset.indeterminate = String(!!indeterminate);
    if (elBarFill && !indeterminate) elBarFill.style.width = `${pct.toFixed(1)}%`;
    if (elPct) elPct.textContent = indeterminate ? '' : `${shown}%`;
  }

  function render() {
    const { fraction, unknown, loaded, total, active } = totals();
    const indeterminate = unknown && fraction < 1;
    if (!animFrame) animFrame = requestAnimationFrame(tickAnim);

    if (elPhase) elPhase.textContent = active ? active.label : 'finishing';

    if (elSub) {
      const parts = [];
      if (total > 0) parts.push(`${formatBytes(loaded)} / ${formatBytes(total)}`);
      else if (loaded > 0) parts.push(formatBytes(loaded));
      const speed = loaded > 0 ? rate(loaded) : null;
      const speedText = formatRate(speed);
      if (speedText) parts.push(speedText);
      const eta = speed && total > loaded ? formatEta((total - loaded) / speed) : null;
      if (eta) parts.push(eta);
      if (!parts.length && active && active.total > 0) {
        parts.push(`${active.loaded} / ${active.total}`);
      }
      elSub.textContent = parts.join('  ·  ');
    }
  }

  function applyChrome(opts = {}) {
    base = opts.assetBase || base || assetBase;
    const theme = opts.theme || 'vanilla';
    root.dataset.theme = theme;
    const plate = resolveUrl(base, opts.plate || DEFAULT_CHROME.plate);
    const bar = resolveUrl(base, opts.bar || DEFAULT_CHROME.bar);
    root.style.setProperty('--ld-menu-loading-img', cssUrl(plate));
    root.style.setProperty('--ld-loading-bar-img', cssUrl(bar));
    if (elBg) {
      const bg = resolveUrl(base, opts.background || DEFAULT_CHROME.background);
      elBg.src = bg;
    }
  }

  function setBriefing(briefing) {
    if (!elBriefing) return;
    const text = briefing && typeof briefing.objectives === 'string'
      ? briefing.objectives.trim() : '';
    const type = briefing && typeof briefing.mapType === 'string'
      ? briefing.mapType.trim() : '';
    elBriefing.dataset.empty = String(!text);
    if (elBriefingText) elBriefingText.textContent = text;
    if (elBriefingType) {
      elBriefingType.textContent = type;
      elBriefingType.style.display = type ? '' : 'none';
    }
  }

  function handle(gen) {
    const live = () => gen === generation;
    return {
      /** The level's `briefing` from scene.json (objectives/mapType/mapId);
       *  paints the MISSION BRIEFING panel onto the loading screen. The text
       *  is stored as extracted, plain English from Menu/Init.con + the chain
       *  lexicon, so no player-name decoding applies. */
      briefing(data) {
        if (!live()) return;
        setBriefing(data);
      },

      step(key, { label, weight = 1 } = {}) {
        if (!live()) return;
        steps.set(key, {
          label: label || key,
          weight,
          fraction: null,
          started: false,
          done: false,
          loaded: 0,
          total: 0,
        });
        render();
      },

      bytes(key, loaded, total) {
        if (!live()) return;
        const step = steps.get(key);
        if (!step || step.done) return;
        step.started = true;
        step.loaded = loaded || 0;
        step.total = total > 0 ? total : 0;
        step.fraction = step.total ? Math.min(1, step.loaded / step.total) : null;
        render();
      },

      count(key, done, total) {
        if (!live()) return;
        const step = steps.get(key);
        if (!step || step.done) return;
        step.started = true;
        step.fraction = total > 0 ? Math.min(1, done / total) : null;
        step.label = total > 0
          ? `${step.label.replace(/ \d+\/\d+$/, '')} ${done}/${total}`
          : step.label;
        render();
      },

      finish(key) {
        if (!live()) return;
        const step = steps.get(key);
        if (!step) return;
        step.done = true;
        step.fraction = 1;
        if (step.total) step.loaded = step.total;
        render();
      },

      end() {
        if (!live()) return;
        for (const step of steps.values()) {
          step.done = true;
          step.fraction = 1;
        }
        root.dataset.state = 'done';
        displayFraction = 1;
        paintBar(1, false);
        if (elPct) elPct.textContent = '100%';
        clearTimeout(showTimer);
        showTimer = null;
        stopAnim();
        const fade = audio?.fadeOut?.(800);
        if (visible) conceal();
        else root.hidden = true;
        return fade || Promise.resolve();
      },

      fail(message) {
        if (!live()) return;
        clearTimers();
        stopAnim();
        root.dataset.state = 'error';
        if (!visible) reveal();
        if (elBar) elBar.dataset.indeterminate = 'false';
        if (elPhase) elPhase.textContent = 'failed';
        if (elPct) elPct.textContent = '';
        if (elSub) elSub.textContent = message || 'load failed';
        if (elPrompt) elPrompt.textContent = (message || 'LOAD FAILED').toUpperCase();
        try { audio?.cancel?.(); } catch (_) { /* ignore */ }
      },
    };
  }

  return {
    /**
     * Start a load. Second argument carries authentic-screen art and music:
     * `{ background, music, theme, title, assetBase }`.
     */
    begin(title, options = {}) {
      generation += 1;
      clearTimers();
      stopAnim();
      steps.clear();
      samples = [];
      displayFraction = 0;
      root.dataset.state = 'busy';

      const opts = (options && typeof options === 'object') ? options : {};
      if (opts.assetBase) base = opts.assetBase;
      const headline = loadingTitle(title, opts.title);
      if (elAuthTitle) elAuthTitle.textContent = headline;
      if (elCardTitle) elCardTitle.textContent = authentic ? headline : (title || 'Loading');
      if (elPhase) elPhase.textContent = '';
      if (elPct) elPct.textContent = '';
      if (elSub) elSub.textContent = '';
      if (elPrompt) elPrompt.textContent = 'PRESS ESCAPE TO CANCEL';
      if (elBarFill) elBarFill.style.width = '0%';
      if (elBar) elBar.dataset.indeterminate = 'true';
      paintBar(0, true);

      if (authentic) applyChrome(opts);

      if (authentic && audio) {
        const music = resolveUrl(base, opts.music || DEFAULT_CHROME.music);
        const fallback = resolveUrl(base, DEFAULT_CHROME.music);
        try { audio.start(music, fallback); } catch (_) { /* autoplay / missing */ }
      }

      if (!visible) {
        if (authentic) reveal();
        else showTimer = setTimeout(reveal, SHOW_DELAY_MS);
      }
      return handle(generation);
    },
  };
}
