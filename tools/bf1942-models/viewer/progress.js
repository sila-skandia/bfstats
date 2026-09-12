// Load progress for the viewers.
//
// A map scene is ~70 MB in one .glb and a vehicle is 1-4 MB, so on anything
// short of a wired connection the honest answer to "is this broken or is it my
// wifi" is a byte counter and a transfer rate. That is what this draws: a
// weighted bar across the steps of one load, the bytes moved so far, the rate
// measured over a short trailing window, and an ETA derived from it.
//
// Weighted rather than equal steps because the steps are wildly uneven — the
// scene .glb dwarfs the report JSON and the loose textures put together, and a
// bar that jumps 33% for a 2 KB fetch reads as a lie.

const STYLE_ID = 'ld-overlay-style';

// Long enough that a cache hit never flashes the card, short enough that a real
// download feels acknowledged.
const SHOW_DELAY_MS = 180;
const FADE_MS = 220;
// Trailing window for the rate estimate. Shorter and it jitters with every
// chunk; longer and it lags a connection that has just dropped out.
const RATE_WINDOW_MS = 3000;

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.ld-overlay {
  position: absolute;
  inset: 0;
  z-index: 6;
  display: grid;
  place-items: center;
  pointer-events: none;
  opacity: 0;
  transition: opacity ${FADE_MS}ms ease;
  font: 12px/1.5 ui-monospace, "Geist Mono", "SF Mono", Menlo, monospace;
}
.ld-overlay[hidden] { display: none; }
.ld-overlay[data-shown="true"] { opacity: 1; }
.ld-card {
  width: min(360px, calc(100% - 32px));
  padding: 16px 18px 14px;
  background: rgba(20, 21, 15, .9);
  border: 1px solid #2e3125;
  border-radius: 3px;
  backdrop-filter: blur(10px);
  box-shadow: 0 18px 48px rgba(0, 0, 0, .55);
}
.ld-title {
  font-size: 11px;
  letter-spacing: .14em;
  text-transform: uppercase;
  color: #9aab5a;
  margin-bottom: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ld-bar {
  position: relative;
  height: 3px;
  background: #24261c;
  overflow: hidden;
}
.ld-bar i {
  display: block;
  height: 100%;
  width: 0;
  background: #9aab5a;
  transition: width 160ms linear;
}
/* Unknown length (no Content-Length, or a proxy that strips it): sweep rather
   than sit at zero, so a stalled load still looks different from a dead one. */
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
  color: #e6e4d9;
}
.ld-phase { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ld-pct { color: #9aab5a; font-variant-numeric: tabular-nums; }
.ld-sub {
  margin-top: 3px;
  color: #8d8f7e;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  min-height: 16px;
}
.ld-overlay[data-state="error"] .ld-title,
.ld-overlay[data-state="error"] .ld-pct { color: #c98a3e; }
.ld-overlay[data-state="error"] .ld-bar i { background: #c98a3e; }
/* Thumbnail tooling renders into the same canvas; nothing may sit over it. */
body.is-portrait .ld-overlay { display: none; }
@media (prefers-reduced-motion: reduce) {
  .ld-overlay, .ld-bar i { transition: none; }
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

export function createLoadOverlay(host) {
  injectStyle();

  const root = document.createElement('div');
  root.className = 'ld-overlay';
  root.hidden = true;
  root.setAttribute('role', 'status');
  root.setAttribute('aria-live', 'polite');
  root.innerHTML =
    '<div class="ld-card">' +
    '<div class="ld-title"></div>' +
    '<div class="ld-bar"><i></i></div>' +
    '<div class="ld-meta"><span class="ld-phase"></span><span class="ld-pct"></span></div>' +
    '<div class="ld-sub"></div>' +
    '</div>';
  host.appendChild(root);

  const elTitle = root.querySelector('.ld-title');
  const elBar = root.querySelector('.ld-bar');
  const elFill = root.querySelector('.ld-bar i');
  const elPhase = root.querySelector('.ld-phase');
  const elPct = root.querySelector('.ld-pct');
  const elSub = root.querySelector('.ld-sub');

  /** @type {Map<string, {label: string, weight: number, fraction: number|null, done: boolean, loaded: number, total: number}>} */
  const steps = new Map();
  let samples = [];
  let showTimer = null;
  let hideTimer = null;
  let visible = false;
  let generation = 0;

  function clearTimers() {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    showTimer = null;
    hideTimer = null;
  }

  function reveal() {
    showTimer = null;
    root.hidden = false;
    // Force a style flush so the opacity transition actually runs.
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
        // A step that has not reported yet is simply at zero. Only a step that
        // is actively transferring and still cannot say how big it is makes the
        // whole bar indeterminate — otherwise the later steps of every load
        // would hold the bar in its sweeping state from the first byte.
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

  function render() {
    const { fraction, unknown, loaded, total, active } = totals();
    const indeterminate = unknown && fraction < 1;
    elBar.dataset.indeterminate = String(indeterminate);
    if (!indeterminate) elFill.style.width = `${Math.min(100, fraction * 100).toFixed(1)}%`;
    // Hold at 99 until every step is genuinely done — a bar that reads 100%
    // while the last textures are still arriving is the thing this replaces.
    elPct.textContent = indeterminate
      ? ''
      : `${fraction >= 1 ? 100 : Math.min(99, Math.floor(fraction * 100))}%`;
    elPhase.textContent = active ? active.label : 'finishing';

    const parts = [];
    if (total > 0) parts.push(`${formatBytes(loaded)} / ${formatBytes(total)}`);
    else if (loaded > 0) parts.push(formatBytes(loaded));
    const speed = loaded > 0 ? rate(loaded) : null;
    const speedText = formatRate(speed);
    if (speedText) parts.push(speedText);
    const eta = speed && total > loaded ? formatEta((total - loaded) / speed) : null;
    if (eta) parts.push(eta);
    // Item-count steps (loose textures) carry no bytes of their own; name them
    // rather than leave the line blank between the .glb and the last texture.
    if (!parts.length && active && active.total > 0) {
      parts.push(`${active.loaded} / ${active.total}`);
    }
    elSub.textContent = parts.join('  ·  ');
  }

  // Every call is scoped to the generation that opened it. Swapping models
  // faster than they download is normal use, and an abandoned load keeps
  // emitting XHR progress events long after its successor has taken the bar
  // over — without this guard those events drive the wrong load's numbers.
  function handle(gen) {
    const live = () => gen === generation;
    return {
      /** Declare a weighted step. Weights are relative; any scale works. */
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

      /** Byte progress for a step, straight off an XHR ProgressEvent. */
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

      /** Item progress for a step that is a queue rather than one transfer. */
      count(key, done, total) {
        if (!live()) return;
        const step = steps.get(key);
        if (!step || step.done) return;
        step.started = true;
        step.fraction = total > 0 ? Math.min(1, done / total) : null;
        // Kept off the byte totals: these are counts, not sizes.
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

      /** Every step complete — fade out. */
      end() {
        if (!live()) return;
        for (const step of steps.values()) {
          step.done = true;
          step.fraction = 1;
        }
        root.dataset.state = 'done';
        elBar.dataset.indeterminate = 'false';
        elFill.style.width = '100%';
        elPct.textContent = '100%';
        clearTimeout(showTimer);
        showTimer = null;
        if (visible) conceal();
        else root.hidden = true;
      },

      fail(message) {
        if (!live()) return;
        clearTimers();
        root.dataset.state = 'error';
        if (!visible) reveal();
        elBar.dataset.indeterminate = 'false';
        elPhase.textContent = 'failed';
        elPct.textContent = '';
        elSub.textContent = message || 'load failed';
      },
    };
  }

  return {
    /**
     * Start a load and take the bar. Returns a handle whose calls are ignored
     * once a later begin() has superseded it.
     */
    begin(title) {
      generation += 1;
      clearTimers();
      steps.clear();
      samples = [];
      root.dataset.state = 'busy';
      elTitle.textContent = title || 'Loading';
      elPhase.textContent = '';
      elPct.textContent = '';
      elSub.textContent = '';
      elFill.style.width = '0%';
      elBar.dataset.indeterminate = 'true';
      if (!visible) showTimer = setTimeout(reveal, SHOW_DELAY_MS);
      return handle(generation);
    },
  };
}
