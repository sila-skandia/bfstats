// The loading animations' shared skeleton (skill `game-loading-animations`,
// features/replay-shorts/README.md "The loaders"). A scene module draws one
// small looping story out of game sprites; this file gives every scene the
// same stage, scaling, words, timers, reduced-motion still, and the effects
// they share (tracers, muzzle flashes, smoke, dust). `createLoader` wraps one
// or more scenes in a status line and picks one at random each time it
// starts: the Short loader's rotation (short-loader.js) and the gallery
// (loaders.html) are both built on it.
//
// A scene is `{ id, title, tactic, words, sub, css, mount(stage, kit) }`.
// `mount` builds its elements on the stage and returns `{ play, still }`:
// `play()` is an async loop that sets the scene to its opening picture and
// then runs for ever on `await kit.wait(ms)`; `still()` is the picture shown
// for reduced motion. Stopping clears every timer, so an abandoned `play()`
// simply never wakes; starting again calls `play()` afresh. Anything that
// grows (the accumulator) lives in the scene's closure and survives that.
//
// It is a nicety: nothing here may throw into the page that shows it.

import { VIEWER_ROOT } from '../../viewer-root.js';

/** The stage every scene draws on, in CSS pixels. */
export const W = 380;
export const H = 150;
/** The loader's size: at most this much bigger than the stage on a wide screen. */
const MAX_SCALE = 1.35;
const MIN_SCALE = 0.55;
/** Seconds before the words admit the wait is long. */
const SLOW_AFTER = 7;

/** A sprite beside the scene modules, from the viewer's root: modules are
 *  served from a versioned path the images are not copied to (viewer-root.js). */
export const sprite = name => new URL(`play/loaders/${name}`, VIEWER_ROOT).href;

export const reduced = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** The stage's scale for a parent `room` pixels wide. */
export function scaleFor(room) {
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, (room - 32) / W));
}

const SHELL = `
.sl-root { display: grid; justify-items: center; gap: 14px; color: #eeecd9; pointer-events: none;
  font: 13px/1.4 'Trebuchet MS', 'Geist Variable', 'Segoe UI', system-ui, sans-serif; }
.sl-fit { width: calc(${W}px * var(--sl-scale, 1)); height: calc(${H}px * var(--sl-scale, 1)); }
.sl-stage { position: relative; width: ${W}px; height: ${H}px; transform: scale(var(--sl-scale, 1)); transform-origin: 0 0;
  overflow: hidden; mask-image: linear-gradient(90deg, transparent, #000 4%, #000 96%, transparent); }
.sl-stage > * { position: absolute; }
.sl-ground { left: 0; right: 0; height: 1px;
  background: linear-gradient(90deg, transparent, rgba(185, 179, 138, .45) 12%, rgba(185, 179, 138, .45) 88%, transparent); }
.sl-ground::after { content: ''; position: absolute; left: 6%; right: 6%; top: 1px; height: 30px;
  background: radial-gradient(ellipse at 50% 0, rgba(163, 156, 108, .16), transparent 70%); }
.sl-shadow { height: 8px; border-radius: 50%; background: radial-gradient(ellipse, rgba(0, 0, 0, .55), transparent 70%); }
.sl-strip { background-repeat: no-repeat; }
.sl-man { left: 0; top: 0; width: 0; height: 0; }
.sl-man > * { position: absolute; }
.sl-flash { width: 26px; height: 18px; opacity: 0; transform-origin: 4px 9px; }
.sl-flash.on { animation: sl-flash 70ms steps(2, end); }
@keyframes sl-flash { 0% { opacity: 1; } 100% { opacity: .2; } }
.sl-glow { width: 60px; height: 60px; margin: -30px 0 0 -30px; border-radius: 50%; opacity: 0;
  background: radial-gradient(circle, rgba(255, 196, 92, .55), rgba(255, 140, 40, .12) 45%, transparent 70%); }
.sl-glow.on { animation: sl-glow 110ms ease-out; }
@keyframes sl-glow { 0% { opacity: 1; } 100% { opacity: 0; } }
.sl-tracer { height: 2px; margin-top: -1px; border-radius: 1px; transform-origin: 100% 50%;
  background: linear-gradient(90deg, rgba(255, 220, 140, 0), #ffe9a8 70%, #fff); box-shadow: 0 0 6px rgba(255, 190, 80, .8); }
.sl-puff { border-radius: 50%; background: radial-gradient(circle, rgba(220, 214, 190, .38), transparent 70%); }
.sl-grit { width: 2px; height: 2px; border-radius: 1px; background: #8c7d5a; }
.sl-words { margin: 0; font: 600 11px/1 ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace; letter-spacing: .22em;
  text-transform: uppercase; color: #eeecd9; text-shadow: 0 1px 4px rgba(0, 0, 0, .9); }
.sl-dots::after { content: ''; display: inline-block; width: 2.2em; text-align: left; animation: sl-dots 1.2s steps(4, end) infinite; }
@keyframes sl-dots { 0% { content: ''; } 25% { content: '.'; } 50% { content: '..'; } 75%, 100% { content: '...'; } }
.sl-sub { margin: -6px 0 0; font-size: 12px; color: #a9a690; text-shadow: 0 1px 4px rgba(0, 0, 0, .9); opacity: 0; transition: opacity .4s ease; }
.sl-root.slow .sl-sub { opacity: 1; }
.sl-boot { position: fixed; inset: 0; z-index: 1001; display: grid; place-items: center; background: #000;
  background: radial-gradient(ellipse at 50% 55%, #16160f, #000 70%); transition: opacity .25s ease; }
.sl-boot.out { opacity: 0; pointer-events: none; }
.sl-over { position: absolute; inset: 0; z-index: 2; display: grid; place-items: center;
  background: radial-gradient(ellipse at 50% 50%, rgba(0, 0, 0, .72), rgba(0, 0, 0, .35) 75%); transition: opacity .25s ease; }
.sl-over[hidden] { display: none; }
@media (prefers-reduced-motion: reduce) { .sl-dots::after { animation: none; content: '...'; } }
`;

/** Inject `css` once under `id`. */
export function ensureStyle(id, css) {
  if (document.getElementById(id)) return;
  const style = document.createElement('style');
  style.id = id;
  style.textContent = css;
  document.head.append(style);
}

export function div(className, at) {
  const node = document.createElement('div');
  node.className = className;
  if (at) place(node, at);
  return node;
}

/** Position a stage element: `{ left, top, width, height }`, any of them. */
export function place(node, at) {
  for (const k of ['left', 'top', 'width', 'height']) if (at[k] !== undefined) node.style[k] = `${at[k]}px`;
  return node;
}

/** Restart a CSS keyframe class: remove it, read the layout, add it back. */
export function restart(node, cls) {
  node.classList.remove(cls);
  void node.getBoundingClientRect();
  node.classList.add(cls);
}

/** Run a Web Animation on `node` and remove the node when it ends (or is cancelled). */
export function fly(node, keyframes, options) {
  const done = () => node.remove();
  try {
    const animation = node.animate(keyframes, options);
    animation.finished.then(done, done);
    return animation;
  } catch {
    done();
    return null;
  }
}

/** A sprite strip: `frames` poses side by side in one webp, each `w` x `h`
 *  CSS pixels. `pose(i)` shows frame i. `anchor` is where the strip's
 *  reference point (the feet) is inside a frame; `at(x, y)` puts that point
 *  at stage (x, y). */
export function strip(name, { w, h, frames, anchor = { x: 0, y: h } }) {
  const node = div('sl-strip', { width: w, height: h });
  node.style.backgroundImage = `url("${sprite(name)}")`;
  node.style.backgroundSize = `${w * frames}px ${h}px`;
  let current = 0;
  return {
    node,
    w, h, anchor,
    pose(i) {
      current = i;
      node.getAnimations().forEach(a => a.cancel());
      node.style.backgroundPosition = `${-i * w}px 0`;
      return this;
    },
    /** Play the frames from where it is to frame `i` over `ms`, eased: the
     *  in-between frames the sprite script blended (--tween), not a cut. */
    to(i, ms = 240) {
      const from = current;
      if (i === from) return this;
      current = i;
      node.style.backgroundPosition = `${-i * w}px 0`;
      const n = Math.abs(i - from);
      const step = i > from ? 1 : -1;
      const frames = Array.from({ length: n + 1 }, (_, k) => ({ backgroundPosition: `${-(from + k * step) * w}px 0`, offset: k / n, easing: 'steps(1, end)' }));
      try { node.animate(frames, { duration: ms, easing: 'cubic-bezier(.45, 0, .3, 1)' }); } catch { /* the style already holds the end */ }
      return this;
    },
    get frame() { return current; },
    at(x, y) { place(node, { left: x - anchor.x, top: y - anchor.y }); return this; },
  };
}

/** Stances in a pose strip drawn `--clips stand,crouch,lie --tween n`. */
export const STAND = 0, CROUCH = 1, LIE = 2;
/** How long a change of stance takes, by how many stances it crosses. */
const STANCE_MS = [0, 260, 420];

/** A soldier made of a pose strip (stand | blends | crouch | blends | lie) and,
 *  optionally, a run strip (one cycle of the run gait). `pose` and `run` are
 *  `{ sprite, w, h, feet: [x, y] }`; the pose strip also carries `muzzle`, one
 *  [x, y] per stance, and `tween` (4); the run strip `frames` and `cycle` (ms
 *  for one cycle). The man stands on the stage at his feet: `at(x, y)`. */
export function man(stage, { pose, run = null, stance = STAND, dir = 1 }) {
  const tween = pose.tween ?? 4;
  const frameOf = st => st * (tween + 1);
  const box = div('sl-man');
  const body = strip(pose.sprite, { w: pose.w, h: pose.h, frames: 3 + 2 * tween, anchor: { x: pose.feet[0], y: pose.feet[1] } });
  body.at(0, 0);
  box.append(body.node);
  let legs = null;
  if (run) {
    legs = strip(run.sprite, { w: run.w, h: run.h, frames: run.frames, anchor: { x: run.feet[0], y: run.feet[1] } });
    legs.at(0, 0);
    legs.node.style.visibility = 'hidden';
    box.append(legs.node);
  }
  stage.append(box);
  const self = {
    node: box,
    x: 0, y: 0,
    stance,
    dir,
    at(x, y = self.y) {
      self.x = x; self.y = y;
      box.style.transform = `translate(${x}px, ${y}px)`;
      return self;
    },
    /** Change stance through the blended frames. */
    to(st, ms) {
      if (st === self.stance) return self;
      const span = Math.abs(st - self.stance);
      self.stance = st;
      body.to(frameOf(st), ms ?? STANCE_MS[span]);
      return self;
    },
    set(st) { self.stance = st; body.pose(frameOf(st)); return self; },
    /** The muzzle on the stage in the current stance. */
    get muzzle() {
      const m = pose.muzzle[self.stance];
      return { x: self.x + m[0] - pose.feet[0], y: self.y + m[1] - pose.feet[1] };
    },
    /** Run `dx` along the ground over `ms`: up from crouch into the run gait,
     *  easing in and out, and back to a crouch at the end. */
    run(dx, ms) {
      if (!legs) return null;
      const from = self.x;
      body.node.style.visibility = 'hidden';
      legs.node.style.visibility = '';
      const cycle = legs.node.animate(
        [{ backgroundPosition: '0 0' }, { backgroundPosition: `${-run.w * run.frames}px 0` }],
        { duration: run.cycle, iterations: Infinity, easing: `steps(${run.frames}, end)` });
      self.at(from + dx);
      const move = box.animate([{ transform: `translate(${from}px, ${self.y}px)` }, { transform: `translate(${from + dx}px, ${self.y}px)` }],
        { duration: ms, easing: 'cubic-bezier(.35, 0, .45, 1)' });
      const done = () => {
        cycle.cancel();
        legs.node.style.visibility = 'hidden';
        body.node.style.visibility = '';
        self.set(CROUCH);
      };
      move.finished.then(done, done);
      return move;
    },
  };
  self.set(stance);
  return self;
}

/** A muzzle flash star pointing `dir` (1 right, -1 left), for `flash.fire(x, y)`. */
export function muzzle(stage, dir = 1) {
  const flash = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  flash.setAttribute('class', 'sl-flash');
  flash.setAttribute('viewBox', '0 0 26 18');
  flash.innerHTML = '<path d="M0 9 L9 6 L13 0 L14 6 L26 9 L14 12 L13 18 L9 12 Z" fill="#ffd77a"/>'
    + '<path d="M2 9 L9 7.5 L11 4 L12 7.5 L19 9 L12 10.5 L11 14 L9 10.5 Z" fill="#fff6d8"/>';
  if (dir < 0) flash.style.transform = 'scaleX(-1)';
  const glow = div('sl-glow');
  stage.append(glow, flash);
  return {
    fire(x, y) {
      place(flash, { left: dir > 0 ? x - 4 : x - 22, top: y - 9 });
      place(glow, { left: x, top: y });
      restart(flash, 'on');
      restart(glow, 'on');
    },
  };
}

/** A tracer from `a` to `b` taking `ms`: a bright streak, head first. */
export function tracer(stage, a, b, { ms = 160, length = 30, cls = '' } = {}) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const angle = Math.atan2(dy, dx);
  const line = div(`sl-tracer ${cls}`, { left: a.x - length, top: a.y, width: length });
  line.style.transformOrigin = '100% 50%';
  stage.append(line);
  const turn = `rotate(${angle}rad)`;
  return fly(line, [
    { transform: `translate(0, 0) ${turn}`, opacity: 1 },
    { transform: `translate(${dx}px, ${dy}px) ${turn}`, opacity: 0.85 },
  ], { duration: ms, easing: 'linear' });
}

/** A smoke puff at `p` that grows and drifts. */
export function puff(stage, p, { dx = 12, dy = -14, size = 8, grow = 2.4, ms = 900, colour } = {}) {
  const node = div('sl-puff', { left: 0, top: 0, width: size, height: size });
  if (colour) node.style.background = `radial-gradient(circle, ${colour}, transparent 70%)`;
  stage.append(node);
  return fly(node, [
    { transform: `translate(${p.x - size / 2}px, ${p.y - size / 2}px) scale(.6)`, opacity: 0.9 },
    { transform: `translate(${p.x - size / 2 + dx}px, ${p.y - size / 2 + dy}px) scale(${grow})`, opacity: 0 },
  ], { duration: ms, easing: 'ease-out' });
}

/** Earth or sand kicked up where a round lands: `n` grains and a puff. */
export function dust(stage, p, { n = 5, spread = 10, rise = 14, colour = 'rgba(160, 140, 100, .45)' } = {}) {
  for (let i = 0; i < n; i++) {
    const g = div('sl-grit', { left: 0, top: 0 });
    stage.append(g);
    const dx = (Math.random() - 0.5) * spread * 2;
    const up = rise * (0.5 + Math.random() * 0.7);
    fly(g, [
      { transform: `translate(${p.x}px, ${p.y}px)`, opacity: 1 },
      { transform: `translate(${p.x + dx * 0.6}px, ${p.y - up}px)`, opacity: 1, offset: 0.45 },
      { transform: `translate(${p.x + dx}px, ${p.y + 2}px)`, opacity: 0 },
    ], { duration: 420 + Math.random() * 200, easing: 'ease-out' });
  }
  puff(stage, p, { dx: 0, dy: -8, size: 10, grow: 2.6, ms: 700, colour });
}

/** One loader: a stage, one line of words and a slow-wait line. `scenes` is
 *  one or more scene modules; each `start()` mounts one at random (never the
 *  same twice running when there is a choice). */
export function createLoader({ scenes, words, pick = null, step = false } = {}) {
  ensureStyle('sl-style', SHELL);
  const root = div('sl-root');
  root.setAttribute('role', 'status');
  root.setAttribute('aria-live', 'polite');
  const fit = div('sl-fit');
  const stage = div('sl-stage');
  fit.append(stage);
  const text = document.createElement('p');
  text.className = 'sl-words';
  const label = document.createElement('span');
  const dots = document.createElement('span');
  dots.className = 'sl-dots';
  dots.setAttribute('aria-hidden', 'true');
  text.append(label, dots);
  const sub = document.createElement('p');
  sub.className = 'sl-sub';
  root.append(fit, text, sub);

  const timers = new Set();
  // The step clock (`step: true`, the gallery's ?step): time moves only when
  // `advance(ms)` says so. Waits queue on it, and every animation on the stage
  // is paused and seeked to the clock, so a beat can be looked at exactly,
  // whatever the browser does with timers in a background tab.
  const clock = step ? { now: 0, queue: [], seen: new Map() } : null;
  let slowTimer = 0;
  let running = false;
  let scene = null;    // the module on the stage
  let live = null;     // what its mount returned
  let last = null;

  const kit = {
    stage,
    /** Resolves after `ms`, unless the loader stops first: then never. */
    wait(ms) {
      return new Promise(resolve => {
        if (clock) { clock.queue.push({ at: clock.now + ms, resolve }); return; }
        const t = setTimeout(() => { timers.delete(t); resolve(); }, ms);
        timers.add(t);
      });
    },
    /** Run `fn` after `ms` on the loader's clock (never once it has stopped). */
    after(ms, fn) { kit.wait(ms).then(fn); },
    get running() { return running; },
    strip, div, place, restart, fly, sprite,
    man: options => man(stage, options),
    muzzle: dir => muzzle(stage, dir),
    tracer: (a, b, o) => tracer(stage, a, b, o),
    puff: (p, o) => puff(stage, p, o),
    dust: (p, o) => dust(stage, p, o),
    ground(y) { const g = div('sl-ground', { top: y }); stage.append(g); return g; },
    shadow(x, y, w) { const s = div('sl-shadow', { left: x - w / 2, top: y - 4, width: w }); stage.append(s); return s; },
  };

  function clearTimers() {
    for (const t of timers) clearTimeout(t);
    timers.clear();
    if (clock) clock.queue = [];
  }

  /** Pause every animation on the stage and seek it to the step clock. */
  function syncClock() {
    for (const a of stage.getAnimations?.({ subtree: true }) ?? []) {
      if (!clock.seen.has(a)) { clock.seen.set(a, clock.now); a.pause(); }
      const t = Math.max(0, clock.now - clock.seen.get(a));
      const end = a.effect?.getComputedTiming().endTime ?? Infinity;
      // A paused animation never finishes on its own: finish it, so whatever
      // waits on .finished (removing a tracer) runs as it would in real time.
      if (t >= end) a.finish();
      else a.currentTime = t;
    }
  }

  const settle = () => new Promise(resolve => setTimeout(resolve, 0));

  /** Step clock only: move time on by `ms`, waking each wait in order. */
  async function advance(ms) {
    if (!clock) return;
    const end = clock.now + ms;
    for (;;) {
      clock.queue.sort((a, b) => a.at - b.at);
      const next = clock.queue[0];
      if (!next || next.at > end) break;
      clock.queue.shift();
      clock.now = next.at;
      syncClock();
      next.resolve();
      await settle();
      syncClock();
    }
    clock.now = end;
    syncClock();
    await settle();
  }

  function mount(next) {
    clearTimers();
    for (const a of stage.getAnimations?.({ subtree: true }) ?? []) a.cancel();
    stage.replaceChildren();
    scene = next;
    if (scene.css) ensureStyle(`sl-scene-${scene.id}`, scene.css);
    live = scene.mount(stage, kit);
    label.textContent = words ?? scene.words ?? 'Loading';
    sub.textContent = scene.sub ?? '';
    root.dataset.scene = scene.id;
  }

  function choose() {
    if (pick) return scenes.find(s => s.id === pick) ?? scenes[0];
    const pool = scenes.length > 1 ? scenes.filter(s => s !== last) : scenes;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function fitToWidth() {
    const room = root.parentElement?.clientWidth || globalThis.innerWidth || W;
    root.style.setProperty('--sl-scale', String(scaleFor(room)));
  }

  function run() {
    try {
      const r = live?.play();
      r?.catch?.(error => console.warn(`loader ${scene?.id}:`, error));
    } catch (error) {
      console.warn(`loader ${scene?.id}:`, error);
    }
  }

  function onVisibility() {
    if (!running) return;
    clearTimers();
    if (!document.hidden && !reduced()) run();
  }

  return {
    element: root,
    get scene() { return scene?.id ?? null; },
    get running() { return running; },
    /** Start, on a scene of `id` if given, else one at random. */
    start(id) {
      if (running) return;
      running = true;
      try {
        const next = id ? scenes.find(s => s.id === id) : choose();
        if (next && next !== scene) mount(next);
        last = scene;
      } catch (error) {
        console.warn('loader: mount', error);
      }
      fitToWidth();
      root.classList.remove('slow');
      clearTimeout(slowTimer);
      slowTimer = setTimeout(() => root.classList.add('slow'), SLOW_AFTER * 1000);
      if (reduced()) { try { live?.still(); } catch (error) { console.warn('loader: still', error); } return; }
      globalThis.addEventListener('resize', fitToWidth);
      document.addEventListener('visibilitychange', onVisibility);
      run();
    },
    stop() {
      running = false;
      clearTimers();
      clearTimeout(slowTimer);
      root.classList.remove('slow');
      globalThis.removeEventListener('resize', fitToWidth);
      document.removeEventListener('visibilitychange', onVisibility);
    },
    /** The mounted scene's own handle, for tests and the gallery. */
    get live() { return live; },
    /** The step clock: `advance(ms)` and the time it reads (`step: true` only). */
    advance,
    get now() { return clock?.now ?? null; },
  };
}

// --- the boot loader ----------------------------------------------------------

/** A full-screen shade with a loader in it from the first frame of a page,
 *  until `end()`. */
export function bootLoader(options) {
  const loader = createLoader(options);
  const shade = div('sl-boot');
  shade.append(loader.element);
  document.body.append(shade);
  loader.start();
  return {
    loader,
    end() {
      shade.classList.add('out');
      setTimeout(() => { loader.stop(); shade.remove(); }, 260);
    },
  };
}
