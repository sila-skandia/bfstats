// The Short loader (features/replay-shorts, "The loader"): what a Short shows
// while it is on its way. A prone British rifleman from the game (the
// BritishSoldier BAR pose's `lie` clip, drawn by scripts/render-game-sprite.mjs)
// fires short bursts; each spent case arcs out and lands end-on in a pile in
// front of him, and the pile stacks up into a pyramid until the Short is
// there. A full pyramid settles and he starts another.
//
// One loader serves the page twice: full screen from the first moment a
// `?short=` link is opened (`bootShortLoader`, before the REPLAY tab has even
// loaded), and over a Short's poster until its video plays (`createShortLoader`).
// It is a nicety: nothing here may throw into the player.

import { VIEWER_ROOT } from '../viewer-root.js';

// From the viewer's root, not this module: modules are served from a versioned
// path the sprite is not copied to (viewer-root.js).
const SPRITE = new URL('play/short-loader-soldier.webp', VIEWER_ROOT).href;

// The stage, in CSS pixels. The sprite is 311.5 x 68.5 at 1x (drawn at 2x).
const W = 380;
const H = 150;
const SOLDIER = { left: 12, top: 44, width: 311.5, height: 68.5 };
const MUZZLE = { x: SOLDIER.left + 308.6, y: SOLDIER.top + 45.4 };
const PORT = { x: SOLDIER.left + 228.9, y: SOLDIER.top + 40.5 };
const GROUND = SOLDIER.top + 66;
// The pile: rows of cases seen end-on, seven at the bottom, on the ground in
// front of him (lower on the stage, nearer the eye) so it never hides the rifle.
const CASE = 7;
const ROWS = 7;
const PILE_X = 206;
const PILE_GROUND = GROUND + 22;
/** The loader's size: at most this much bigger than the stage on a wide screen. */
const MAX_SCALE = 1.35;
const PILE_SIZE = (ROWS * (ROWS + 1)) / 2;
// A BAR's magazine: twenty rounds, then a pause to change it.
const MAG = 20;
/** Seconds before the words admit the wait is long. */
const SLOW_AFTER = 7;

const STYLE = `
.sl-root { display: grid; justify-items: center; gap: 14px; color: #eeecd9; pointer-events: none;
  font: 13px/1.4 'Trebuchet MS', 'Geist Variable', 'Segoe UI', system-ui, sans-serif; }
.sl-fit { width: calc(${W}px * var(--sl-scale, 1)); height: calc(${H}px * var(--sl-scale, 1)); }
.sl-stage { position: relative; width: ${W}px; height: ${H}px; transform: scale(var(--sl-scale, 1)); transform-origin: 0 0; }
.sl-stage > * { position: absolute; }
.sl-ground { left: 0; right: 0; top: ${GROUND}px; height: 1px;
  background: linear-gradient(90deg, transparent, rgba(185, 179, 138, .45) 12%, rgba(185, 179, 138, .45) 88%, transparent); }
.sl-ground::after { content: ''; position: absolute; left: 6%; right: 6%; top: 1px; height: 30px;
  background: radial-gradient(ellipse at 50% 0, rgba(163, 156, 108, .16), transparent 70%); }
.sl-shadow { left: ${SOLDIER.left + 20}px; top: ${GROUND - 5}px; width: ${SOLDIER.width - 30}px; height: 10px; border-radius: 50%;
  background: radial-gradient(ellipse, rgba(0, 0, 0, .55), transparent 70%); }
.sl-soldier { left: ${SOLDIER.left}px; top: ${SOLDIER.top}px; width: ${SOLDIER.width}px; height: ${SOLDIER.height}px;
  transform-origin: 30% 80%; filter: drop-shadow(0 0 0 transparent); }
.sl-soldier.kick { animation: sl-kick 70ms ease-out; }
@keyframes sl-kick { 0% { transform: translateX(0); filter: brightness(1.25); } 40% { transform: translateX(-1.6px) rotate(-.25deg); }
  100% { transform: translateX(0); filter: brightness(1); } }
.sl-soldier.reload { animation: sl-reload 900ms ease-in-out; }
@keyframes sl-reload { 0%, 100% { transform: none; } 35%, 65% { transform: translateY(1.5px) rotate(.6deg); } }
.sl-flash { left: ${MUZZLE.x - 4}px; top: ${MUZZLE.y - 9}px; width: 26px; height: 18px; opacity: 0; transform-origin: 4px 9px; }
.sl-flash.on { animation: sl-flash 70ms steps(2, end); }
@keyframes sl-flash { 0% { opacity: 1; transform: scale(1.1); } 100% { opacity: .2; transform: scale(.7); } }
.sl-glow { left: ${MUZZLE.x - 30}px; top: ${MUZZLE.y - 30}px; width: 60px; height: 60px; border-radius: 50%; opacity: 0;
  background: radial-gradient(circle, rgba(255, 196, 92, .55), rgba(255, 140, 40, .12) 45%, transparent 70%); }
.sl-glow.on { animation: sl-glow 110ms ease-out; }
@keyframes sl-glow { 0% { opacity: 1; } 100% { opacity: 0; } }
.sl-tracer { left: ${MUZZLE.x + 6}px; top: ${MUZZLE.y - 1}px; width: 34px; height: 2px; border-radius: 1px;
  background: linear-gradient(90deg, rgba(255, 220, 140, 0), #ffe9a8 70%, #fff); box-shadow: 0 0 6px rgba(255, 190, 80, .8); }
.sl-smoke { width: 8px; height: 8px; border-radius: 50%; background: radial-gradient(circle, rgba(220, 214, 190, .35), transparent 70%); }
.sl-case { width: 8px; height: 3px; margin: -1.5px 0 0 -4px; border-radius: 1.5px 1px 1px 1.5px;
  background: linear-gradient(180deg, #f6dd8a, #c99a35 60%, #8a6420); }
.sl-brass { width: ${CASE}px; height: ${CASE}px; border-radius: 50%;
  background: radial-gradient(circle at 50% 50%, #3a2a10 0 17%, #b9872c 19% 26%, #e9c463 30%, #c4962f 62%, #7a5518 100%);
  box-shadow: 0 0 0 .5px rgba(0, 0, 0, .45); transition: opacity .5s ease, transform .5s ease; }
.sl-brass.new { box-shadow: 0 0 0 .5px rgba(0, 0, 0, .45), 0 0 6px rgba(255, 210, 110, .7); }
.sl-brass.gone { opacity: 0; transform: translateY(6px); }
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

function ensureStyle() {
  if (document.getElementById('sl-style')) return;
  const style = document.createElement('style');
  style.id = 'sl-style';
  style.textContent = STYLE;
  document.head.append(style);
}

function div(className) {
  const node = document.createElement('div');
  node.className = className;
  return node;
}

/** Where the `i`th case of the pile sits, its centre in stage pixels. */
export function pileSlot(i) {
  let row = 0;
  let left = i;
  while (left >= ROWS - row) { left -= ROWS - row; row++; }
  const across = ROWS - row;
  const x = PILE_X - ((across - 1) * CASE) / 2 + left * CASE;
  const y = PILE_GROUND - CASE / 2 - row * CASE * 0.86;
  return { x, y };
}

export const PILE = PILE_SIZE;

const reduced = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** A loader: `element` to place, `start()` and `stop()`. Starting again
 *  carries on the pile where it was. */
export function createShortLoader({ words = 'Loading the Short' } = {}) {
  ensureStyle();
  const root = div('sl-root');
  root.setAttribute('role', 'status');
  root.setAttribute('aria-live', 'polite');
  const fit = div('sl-fit');
  const stage = div('sl-stage');
  const soldier = document.createElement('img');
  soldier.className = 'sl-soldier';
  soldier.src = SPRITE;
  soldier.alt = '';
  soldier.decoding = 'async';
  const flash = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  flash.setAttribute('class', 'sl-flash');
  flash.setAttribute('viewBox', '0 0 26 18');
  flash.innerHTML = '<path d="M0 9 L9 6 L13 0 L14 6 L26 9 L14 12 L13 18 L9 12 Z" fill="#ffd77a"/>'
    + '<path d="M2 9 L9 7.5 L11 4 L12 7.5 L19 9 L12 10.5 L11 14 L9 10.5 Z" fill="#fff6d8"/>';
  const glow = div('sl-glow');
  stage.append(div('sl-ground'), div('sl-shadow'), glow, soldier, flash);
  fit.append(stage);
  const text = document.createElement('p');
  text.className = 'sl-words';
  const label = document.createElement('span');
  label.textContent = words;
  const dots = document.createElement('span');
  dots.className = 'sl-dots';
  dots.setAttribute('aria-hidden', 'true');
  text.append(label, dots);
  const sub = document.createElement('p');
  sub.className = 'sl-sub';
  sub.textContent = "The server is taking its time. He'll keep firing.";
  root.append(fit, text, sub);

  const pile = [];
  let fired = 0;
  let timer = 0;
  let slowTimer = 0;
  let running = false;

  function fitToWidth() {
    const room = (root.parentElement?.clientWidth || globalThis.innerWidth || W) - 32;
    root.style.setProperty('--sl-scale', String(Math.max(0.55, Math.min(MAX_SCALE, room / W))));
  }

  function restart(node, cls) {
    node.classList.remove(cls);
    void node.getBoundingClientRect();
    node.classList.add(cls);
  }

  function smoke() {
    const puff = div('sl-smoke');
    stage.append(puff);
    const drift = 10 + Math.random() * 14;
    puff.animate([
      { transform: `translate(${MUZZLE.x - 4}px, ${MUZZLE.y - 4}px) scale(.6)`, opacity: 0.9 },
      { transform: `translate(${MUZZLE.x + drift}px, ${MUZZLE.y - 16 - Math.random() * 8}px) scale(2.4)`, opacity: 0 },
    ], { duration: 900, easing: 'ease-out' }).finished.then(() => puff.remove(), () => puff.remove());
  }

  function tracer() {
    const line = div('sl-tracer');
    stage.append(line);
    const dip = (Math.random() - 0.5) * 3;
    line.animate([
      { transform: 'translateX(0)', opacity: 1 },
      { transform: `translate(${W - MUZZLE.x + 20}px, ${dip}px)`, opacity: 0.6 },
    ], { duration: 130, easing: 'linear' }).finished.then(() => line.remove(), () => line.remove());
  }

  /** A spent case: up and back out of the port, tumbling, then end-on into
   *  its place on the pile. */
  function eject() {
    if (pile.length >= PILE_SIZE) return;
    const slot = pileSlot(pile.length);
    const brass = div('sl-brass new');
    brass.style.left = `${slot.x - CASE / 2}px`;
    brass.style.top = `${slot.y - CASE / 2}px`;
    brass.style.opacity = '0';
    pile.push(brass);
    stage.append(brass);
    const flying = div('sl-case');
    stage.append(flying);
    const peak = PORT.y - 26 - Math.random() * 14;
    const spin = 540 + Math.random() * 540;
    const midX = PORT.x + (slot.x - PORT.x) * 0.45 + 6;
    flying.animate([
      { transform: `translate(${PORT.x}px, ${PORT.y}px) rotate(0deg)`, easing: 'cubic-bezier(.2,.6,.4,1)' },
      { transform: `translate(${midX}px, ${peak}px) rotate(${spin * 0.5}deg)`, easing: 'cubic-bezier(.6,0,.9,.6)', offset: 0.42 },
      { transform: `translate(${slot.x}px, ${slot.y}px) rotate(${spin}deg) scaleX(.85)`, offset: 0.9 },
      { transform: `translate(${slot.x}px, ${slot.y}px) rotate(${spin}deg) scaleX(.3)`, opacity: 0 },
    ], { duration: 560 }).finished.then(() => {
      flying.remove();
      brass.style.opacity = '';
      brass.animate([{ transform: 'translateY(-2px)' }, { transform: 'translateY(0)' }], { duration: 120, easing: 'ease-out' });
      setTimeout(() => brass.classList.remove('new'), 500);
    }, () => flying.remove());
  }

  function shot() {
    restart(soldier, 'kick');
    restart(flash, 'on');
    restart(glow, 'on');
    tracer();
    if (fired % 2 === 0) smoke();
    eject();
    fired++;
  }

  /** A full pyramid settles away, top first, and the next one starts. */
  function settle() {
    pile.slice().reverse().forEach((brass, i) => setTimeout(() => brass.classList.add('gone'), i * 18));
    const gone = pile.splice(0);
    setTimeout(() => gone.forEach(b => b.remove()), gone.length * 18 + 600);
    return gone.length * 18 + 500;
  }

  function burst() {
    if (!running) return;
    if (pile.length >= PILE_SIZE) {
      timer = setTimeout(burst, settle() + 300);
      return;
    }
    const rounds = 2 + Math.floor(Math.random() * 3);
    let n = 0;
    const next = () => {
      if (!running) return;
      shot();
      n++;
      if (fired % MAG === 0) {
        timer = setTimeout(() => { restart(soldier, 'reload'); timer = setTimeout(burst, 1000); }, 200);
      } else if (n < rounds && pile.length < PILE_SIZE) {
        timer = setTimeout(next, 115);
      } else {
        timer = setTimeout(burst, 380 + Math.random() * 380);
      }
    };
    next();
  }

  /** The still picture for reduced motion: a pile already there. */
  function still() {
    while (pile.length < 12) {
      const slot = pileSlot(pile.length);
      const brass = div('sl-brass');
      brass.style.left = `${slot.x - CASE / 2}px`;
      brass.style.top = `${slot.y - CASE / 2}px`;
      pile.push(brass);
      stage.append(brass);
    }
  }

  function onVisibility() {
    if (!running) return;
    clearTimeout(timer);
    if (!document.hidden) timer = setTimeout(burst, 200);
  }

  return {
    element: root,
    start() {
      if (running) return;
      running = true;
      fitToWidth();
      root.classList.remove('slow');
      clearTimeout(slowTimer);
      slowTimer = setTimeout(() => root.classList.add('slow'), SLOW_AFTER * 1000);
      if (reduced()) { still(); return; }
      globalThis.addEventListener('resize', fitToWidth);
      document.addEventListener('visibilitychange', onVisibility);
      timer = setTimeout(burst, 250);
    },
    stop() {
      running = false;
      clearTimeout(timer);
      clearTimeout(slowTimer);
      root.classList.remove('slow');
      globalThis.removeEventListener('resize', fitToWidth);
      document.removeEventListener('visibilitychange', onVisibility);
    },
    get running() { return running; },
    get pile() { return pile.length; },
  };
}

// --- the boot loader ----------------------------------------------------------

let boot = null;

/** Full screen from page load while a `?short=` link is on its way: the
 *  REPLAY tab, the feed and the Short all load behind it. Ends with
 *  `endBootShortLoader`, when the player opens or the Short is not there. */
export function bootShortLoader() {
  try {
    if (boot) return;
    ensureStyle();
    const loader = createShortLoader();
    const shade = div('sl-boot');
    shade.append(loader.element);
    document.body.append(shade);
    loader.start();
    boot = { shade, loader };
  } catch (error) {
    console.warn('short-loader: the boot loader', error);
  }
}

export function endBootShortLoader() {
  if (!boot) return;
  const { shade, loader } = boot;
  boot = null;
  shade.classList.add('out');
  setTimeout(() => { loader.stop(); shade.remove(); }, 260);
}
