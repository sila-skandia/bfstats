// The replay's page chrome (features/round-replay-ux): the bar with the
// timeline and the transport, the player card, the scoreboard to pick whom to
// follow, the name tags, the replay log (the recorder's raw rows, a debug
// panel), the shortcuts overlay, and the replay's own input -- a layer over
// the 3D view for the camera's drags and wheel, and the replay's key map,
// which the play page's own keys never see past. Reads and drives a
// ReplayPlayer (replay.js); owns only DOM.
//
// On a phone (features/round-replay-ux, "Phones"): the bar folds to its own
// width, a tap on the view slides the chrome away and back, the free camera
// flies on a thumbstick, and fullscreen is one button wherever the browser
// allows it.

import { GameConsole } from './console.js';
import { fmtHp, nameAt, roundClock, teamAt } from './replay-recording.js';
import { chapterStart, nextChapter, nextSpawn, playerStatusAt, prevChapter, rosterOf, tallyAt } from './replay-chapters.js';
import { ReplayTimeline, fmtClock } from './replay-timeline.js';

export const SPEEDS = Object.freeze([0.25, 0.5, 1, 2, 4, 8]);

/** Name tags are for the players near the camera: whole within TAG_NEAR
 *  metres of it, faded out by TAG_FAR, a vehicle's 1.6 times as far. The
 *  followed player's is drawn wherever he is while the orbit is on him. */
const TAG_NEAR = 35;
const TAG_FAR = 60;
const TAG_VEHICLE = 1.6;
/** At most this many tags, the nearest. */
const TAG_MAX = 12;
/** Seconds without a pointer move or key before a playing replay's chrome
 *  fades; on a touch screen, where a tap brought it up, a little longer for
 *  the thumb to reach it. */
const IDLE_AFTER = 2.8;
const IDLE_TOUCH = 4;
/** A finger lifted within TAP_TIME ms, having moved less than TAP_SLOP
 *  pixels, is a tap on the view. */
const TAP_SLOP = 10;
const TAP_TIME = 350;
/** The free camera's thumbstick: a finger down on the left STICK_ZONE of the
 *  view, full speed at STICK_R pixels from where it went down. */
const STICK_ZONE = 0.4;
const STICK_R = 48;
/** How often the card and the open scoreboard redraw, seconds. */
const SLOW_TICK = 0.2;

function fmtTime(seconds) {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const esc = text => String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** Whether `pid` made (one file of) the recording: a merged recording has a
 *  recording player per file. */
const isRecordingPlayer = (player, pid) => (player.recordingPids ?? [player.recordingPid]).includes(pid);

/** An input's action, run so that one which throws is a console warning,
 *  once a message, and never a click or a key left half done: the frame's
 *  rule (replay-guard.js) for the replay's buttons, keys and pointer. */
const warnedInput = new Set();
function quietly(what, fn) {
  try {
    return fn();
  } catch (error) {
    const key = `${what}: ${error?.message ?? error}`;
    if (!warnedInput.has(key) && warnedInput.size < 64) {
      warnedInput.add(key);
      console.warn(`replay: ${what} threw`, error);
    }
    return undefined;
  }
}

// Fullscreen, with Safari's prefixed names (an iPad's before iPadOS 16.4).
const fullscreenElement = () => document.fullscreenElement ?? document.webkitFullscreenElement ?? null;
const canFullscreen = () => Boolean(document.fullscreenEnabled || document.webkitFullscreenEnabled);
function exitFullscreen() {
  try {
    Promise.resolve((document.exitFullscreen ?? document.webkitExitFullscreen)?.call(document)).catch(() => {});
  } catch {}
}

/** What a seat of a replayed hull is to the man in it, from the hull's own
 *  seat table (seats.js): the root seat drives, flies or steers what it can,
 *  a seat with guns is a gunner's. */
function seatRole(hull, index) {
  const occupancy = hull?.occupancy;
  if (!occupancy) return index === 0 ? 'driver' : `seat ${index + 1}`;
  if (index === 0) {
    return { air: 'pilot', ship: 'helm', ground: 'driver', tank: 'driver', gun: 'gunner' }[occupancy.rootKind] ?? 'seat 1';
  }
  const id = hull.seatIdAt(index);
  const kind = id ? occupancy.seatKind(id) : null;
  return kind === 'gun' || occupancy.seatInfo(id)?.fireArms?.length ? `gunner, seat ${index + 1}` : `seat ${index + 1}`;
}

// Inline icons, 16x16, drawn in the text colour.
const ICON = {
  play: '<path d="M4.5 2.5v11l9-5.5z"/>',
  pause: '<path d="M4 2.5h3v11H4zM9 2.5h3v11H9z"/>',
  back: '<path d="M8 3.5 2.5 8 8 12.5zM14 3.5 8.5 8 14 12.5z"/>',
  forward: '<path d="M8 3.5 13.5 8 8 12.5zM2 3.5 7.5 8 2 12.5z"/>',
  prev: '<path d="M2.5 3h2v10h-2zM13.5 3v10L6 8z"/>',
  next: '<path d="M11.5 3h2v10h-2zM2.5 3v10L10 8z"/>',
  orbit: '<circle cx="8" cy="8" r="2.2"/><ellipse cx="8" cy="8" rx="6.6" ry="3.1" fill="none" stroke="currentColor" stroke-width="1.4" transform="rotate(-18 8 8)"/>',
  pov: '<path d="M1 8s2.6-4.6 7-4.6S15 8 15 8s-2.6 4.6-7 4.6S1 8 1 8z" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="8" r="2.2"/>',
  free: '<path d="M8 .8 10.2 3.4H8.9v3.7h3.7V5.8L15.2 8l-2.6 2.2V8.9H8.9v3.7h1.3L8 15.2l-2.2-2.6h1.3V8.9H3.4v1.3L.8 8l2.6-2.2v1.3h3.7V3.4H5.8z"/>',
  players: '<path d="M5.5 7.5a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2zM1 13.6c0-2.6 2-4.4 4.5-4.4S10 11 10 13.6zM11.4 7.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4zM11 8.6c2.3 0 4 1.6 4 3.9h-3.8c0-1.5-.5-2.8-1.4-3.8z"/>',
  log: '<path d="M3 1.8h10v12.4H3z" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M5.3 5h5.4M5.3 8h5.4M5.3 11h3.4" stroke="currentColor" stroke-width="1.4"/>',
  full: '<path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  unfull: '<path d="M6 2v4H2M10 2v4h4M14 10h-4v4M2 10h4v4" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  more: '<circle cx="3" cy="8" r="1.6"/><circle cx="8" cy="8" r="1.6"/><circle cx="13" cy="8" r="1.6"/>',
  tags: '<path d="M1.8 4h8.4l4 4-4 4H1.8z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><circle cx="5" cy="8" r="1.3"/>',
  markers: '<circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="8" r="2.2"/>',
  hide: '<path d="M1 8s2.6-4.6 7-4.6S15 8 15 8s-2.6 4.6-7 4.6S1 8 1 8z" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="8" r="2.2"/><path d="M2.5 13.5l11-11" stroke="currentColor" stroke-width="1.6"/>',
  upload: '<path d="M8 10.6V2.8M4.7 6 8 2.7 11.3 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M2.6 9.8v3.6h10.8V9.8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  chevLeft: '<path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  chevRight: '<path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  close: '<path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" stroke-width="1.6"/>',
  dead: '<path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="2"/>',
  vehicle: '<path d="M1.5 10.5h13v2h-13zM3 8l1.5-3.5h5L12 8h2.5v2h-13V8z"/>',
  auto: '<path d="M1.5 4.5h9v7h-9z" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M10.5 7l4-2.5v7l-4-2.5z"/><circle cx="6" cy="8" r="1.6"/>',
  flame: '<path d="M8 1c1.9 2.7 4.1 4.3 3.7 8-.3 2.8-2 5-3.7 5-2 0-3.8-1.7-3.8-4.1 0-2.1 1.3-3.1 2.2-4.6.4 1.6 1 2.3 1.8 2.6.4-2 .1-4.4-.2-6.9z"/>',
  crown: '<path d="M1.8 12.5h12.4l1-7.6-3.9 3L8 2.5 4.7 7.9l-3.9-3z"/>',
};
const svg = name => `<svg viewBox="0 0 16 16" aria-hidden="true">${ICON[name] ?? ''}</svg>`;

/** The streak and kill-leader marks a name carries (replay-highlights.js). */
function streakMark(n) {
  return n >= 2 ? `<span class="rp-hl-streak" title="${n} kills without dying">${svg('flame')}${n}</span>` : '';
}
const leaderMark = () => `<span class="rp-hl-lead" title="Kill leader">${svg('crown')}</span>`;

// --- the look ----------------------------------------------------------------------
//
// The game's own screens (the spawn screen and the scoreboard, see
// features/round-replay-ux): translucent dark plates, khaki heading strips,
// olive-edged buttons with upper-case labels, and the message log's team
// colours (chat-layout.json: Axis 1, .35, .35; Allies .4, .6, 1).

const STYLE = `
html.replay-on #mobile-controls { display: none !important; }
/* The crosshair is the followed player's own, in his first person only
   (replay-hud.js sets replay-sight). */
html.replay-on:not(.replay-sight) #crosshair { display: none !important; }
html.replay-on #side { z-index: 8; }
/* No HUD (H): the page's own layers over the view go with the replay's --
   the counters and gauges, the crosshair, the message log and the radio, the
   minimap, the flythrough's panel. Hidden rather than undisplayed, so each
   keeps its size and its pixels and comes back as it was. */
html.replay-bare #hud-canvas, html.replay-bare #comms-canvas, html.replay-bare #minimap,
html.replay-bare #crosshair,
html.replay-bare #side, html.replay-bare .map-controls-fab { visibility: hidden !important; }
.rp-root {
  --rp-plate: rgba(33, 33, 29, .8);
  --rp-plate-deep: rgba(20, 20, 17, .9);
  --rp-plate-menu: rgba(20, 20, 17, .97);
  --rp-edge: rgba(200, 194, 152, .34);
  --rp-edge-strong: #b9b38a;
  --rp-khaki: #a39c6c;
  --rp-khaki-ink: #15150e;
  --rp-ink: #eeecd9;
  --rp-muted: #a9a690;
  --rp-axis: #ff5959;
  --rp-allies: #6699ff;
  --rp-gold: #e8c35a;
  --rp-fire: #f0913c;
  --rp-life: #a9c36a;
  --rp-font: 'Trebuchet MS', 'Geist Variable', 'Segoe UI', system-ui, sans-serif;
  --rp-mono: var(--mm-font-mono, ui-monospace, monospace);
  --rp-bar-h: 88px;
  --rp-card-h: 46px;
  --rp-log-top: 280px;
  position: absolute; inset: 0; z-index: 4; pointer-events: none; overflow: hidden;
  font: 12px/1.35 var(--rp-font); color: var(--rp-ink);
  -webkit-user-select: none; user-select: none; -webkit-tap-highlight-color: transparent; touch-action: manipulation;
}
.rp-root svg { width: 16px; height: 16px; fill: currentColor; flex: none; }
.rp-input { position: absolute; inset: 0; pointer-events: auto; cursor: grab; touch-action: none; }
.rp-input.dragging { cursor: grabbing; }
.rp-root.mode-free .rp-input { cursor: crosshair; }
.rp-root.rp-idle .rp-input { cursor: none; }

/* The bar: the timeline over a row of controls, the playback's on the left
   and the view's on the right. It folds to its own width (the container
   queries at the end) rather than cutting any control off. */
.rp-bar { position: absolute; left: 12px; right: 12px; bottom: 10px; pointer-events: auto; container: rp-bar / inline-size;
  padding: 5px 12px 7px; border: 1px solid var(--rp-edge); border-radius: 8px;
  background: linear-gradient(to top, rgba(16, 16, 14, .9), rgba(32, 32, 28, .76));
  box-shadow: 0 8px 28px rgba(0, 0, 0, .45); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
  transition: opacity .3s ease, transform .35s cubic-bezier(.2, .8, .2, 1); }
/* Controls keep their size; the recording's date takes what room is left
   (from nothing, so it never pushes a control onto a second row); anything
   that still does not fit wraps rather than going off the edge. */
.rp-ctl { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; margin-top: 3px; min-width: 0; }
.rp-ctl > * { flex: none; }
.rp-ctl > .rp-stamp { flex: 1 1 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.rp-ctl > .rp-seg { margin-left: auto; }
.rp-break { display: none; }
.rp-grp { display: flex; align-items: center; gap: 2px; }
.rp-btn[hidden] { display: none; }
.rp-btn { appearance: none; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  min-width: 30px; height: 28px; padding: 0 7px; margin: 0; border: 1px solid transparent; border-radius: 5px;
  background: transparent; color: var(--rp-ink); font: 700 11px/1 var(--rp-font); letter-spacing: .08em;
  text-transform: uppercase; cursor: pointer; white-space: nowrap; }
.rp-btn:hover { background: rgba(255, 255, 255, .08); border-color: var(--rp-edge); }
.rp-btn:focus-visible, .rp-brow:focus-visible { outline: 1px solid var(--rp-gold); outline-offset: 1px; }
.rp-btn.on { background: var(--rp-khaki); color: var(--rp-khaki-ink); border-color: var(--rp-khaki); }
.rp-btn.play { width: 38px; height: 32px; border-color: var(--rp-edge-strong); background: rgba(0, 0, 0, .32); }
.rp-btn.play svg { width: 18px; height: 18px; }
.rp-btn small { font: 700 9px/1 var(--rp-mono); letter-spacing: 0; margin-left: -3px; opacity: .8; }
.rp-seg { display: flex; border: 1px solid var(--rp-edge); border-radius: 6px; overflow: hidden; }
.rp-seg .rp-btn { border: 0; border-radius: 0; height: 26px; }
.rp-seg .rp-btn + .rp-btn { border-left: 1px solid var(--rp-edge); }
.rp-time { font: 12px var(--rp-mono); font-variant-numeric: tabular-nums; white-space: nowrap; }
.rp-time b { font-weight: 600; color: var(--rp-ink); }
.rp-time span { color: var(--rp-muted); }
.rp-round { color: var(--rp-muted); font: 700 10px var(--rp-font); letter-spacing: .12em; white-space: nowrap; }
.rp-speed { position: relative; }
/* The menus open over the timeline, above its marks' own stacking. */
.rp-speed-menu { position: absolute; z-index: 5; bottom: calc(100% + 8px); left: 50%; transform: translateX(-50%);
  display: none; flex-direction: column; padding: 4px; gap: 1px; background: var(--rp-plate-menu);
  border: 1px solid var(--rp-edge); border-radius: 6px; box-shadow: 0 8px 24px rgba(0, 0, 0, .5); }
.rp-speed.open .rp-speed-menu { display: flex; }
.rp-speed-menu .rp-btn { justify-content: flex-end; min-width: 56px; font-family: var(--rp-mono); }

/* The menu (...): the view's switches, and the bar's controls it has folded away. */
.rp-more { position: relative; }
.rp-more-menu { position: absolute; z-index: 5; right: -4px; bottom: calc(100% + 8px); display: none; flex-direction: column; gap: 1px;
  width: max-content; min-width: 210px; max-width: calc(100vw - 24px); padding: 4px; background: var(--rp-plate-menu);
  border: 1px solid var(--rp-edge); border-radius: 6px; box-shadow: 0 8px 24px rgba(0, 0, 0, .5); }
.rp-more.open .rp-more-menu { display: flex; }
.rp-more-when { display: none; padding: 3px 8px 6px; margin-bottom: 3px; border-bottom: 1px solid var(--rp-edge); color: var(--rp-muted);
  font: 700 9px/1.4 var(--rp-font); letter-spacing: .12em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rp-mi { appearance: none; display: flex; align-items: center; gap: 10px; width: 100%; height: 32px; padding: 0 8px; margin: 0;
  border: 0; border-radius: 4px; background: none; color: var(--rp-ink); font: 700 11px/1 var(--rp-font); letter-spacing: .08em;
  text-transform: uppercase; text-align: left; white-space: nowrap; cursor: pointer; }
.rp-mi:hover { background: rgba(255, 255, 255, .08); }
.rp-mi:focus-visible { outline: 1px solid var(--rp-gold); outline-offset: -1px; }
.rp-mi > span { flex: 1 1 auto; }
.rp-mi kbd { min-width: 18px; padding: 1px 4px; border: 1px solid var(--rp-edge); border-radius: 3px; text-align: center;
  color: var(--rp-muted); font: 10px/1.3 var(--rp-mono); }
.rp-mi b { padding: 2px 5px; border-radius: 3px; background: rgba(255, 255, 255, .1); color: var(--rp-muted);
  font: 800 9px/1.2 var(--rp-font); letter-spacing: .1em; }
.rp-mi.on b { background: var(--rp-khaki); color: var(--rp-khaki-ink); }
.rp-mi-roomy { display: none; }
.rp-mi[hidden] { display: none; }

/* The timeline. */
.rp-tl { position: relative; height: 32px; cursor: pointer; touch-action: none; outline: none; }
.rp-tl-marks { position: absolute; left: 0; right: 0; top: 1px; height: 16px; }
.rp-tl-track { position: absolute; left: 0; right: 0; top: 21px; height: 5px; border-radius: 3px;
  background: rgba(255, 255, 255, .17); transition: top .12s, height .12s; }
.rp-tl:hover .rp-tl-track, .rp-tl.scrubbing .rp-tl-track { top: 20px; height: 7px; }
.rp-tl-zone { position: absolute; top: 0; bottom: 0; border-radius: 3px;
  background: repeating-linear-gradient(135deg, rgba(0, 0, 0, .42) 0 3px, rgba(255, 255, 255, .05) 3px 6px); }
.rp-tl-fill { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 3px; background: var(--rp-khaki);
  box-shadow: 0 0 8px rgba(163, 156, 108, .45); }
.rp-tl-hover { position: absolute; top: -4px; bottom: -4px; width: 2px; margin-left: -1px; background: rgba(255, 255, 255, .6); display: none; }
.rp-tl:hover .rp-tl-hover { display: block; }
.rp-tl-knob { position: absolute; top: 50%; width: 13px; height: 13px; margin: -6.5px 0 0 -6.5px; border-radius: 50%;
  background: #f3f0da; box-shadow: 0 0 0 3px rgba(163, 156, 108, .5), 0 1px 4px rgba(0, 0, 0, .6); transform: scale(0); transition: transform .12s; }
.rp-tl:hover .rp-tl-knob, .rp-tl.scrubbing .rp-tl-knob { transform: scale(1); }
.rp-mk { position: absolute; bottom: 0; transform: translateX(-50%); padding: 0; margin: 0; border: 0; background: none;
  color: var(--rp-muted); cursor: pointer; line-height: 0; opacity: .75; }
.rp-mk:hover { opacity: 1; z-index: 3; }
.rp-mk.tick { width: 2px; height: 8px; border-radius: 1px; background: currentColor; bottom: 1px; }
.rp-mk.glyph svg { width: 9px; height: 9px; filter: drop-shadow(0 1px 1px rgba(0, 0, 0, .8)); }
.rp-mk.mine { opacity: 1; z-index: 2; }
.rp-mk.mine svg { width: 14px; height: 14px; }
.rp-mk.capture svg { width: 11px; height: 11px; }
.rp-mk.t1 { color: var(--rp-axis); } .rp-mk.t2 { color: var(--rp-allies); }
.rp-mk.kill.mine { color: var(--rp-gold); }
.rp-mk.death { color: var(--rp-axis); }
.rp-mk.teamkill { color: #d8a24a; }
.rp-mk.vehicle { color: var(--rp-fire); opacity: .55; }
.rp-mk.vehicle.mine { opacity: 1; }
.rp-mk.spawn { color: var(--rp-life); }
.rp-mk.round { width: 2px; height: 30px; bottom: -14px; background: var(--rp-khaki); opacity: .9; }
.rp-mini { position: absolute; left: 0; right: 0; bottom: 0; height: 3px; background: rgba(255, 255, 255, .1);
  opacity: 0; transition: opacity .35s; }
.rp-mini > i { display: block; height: 100%; width: 0; background: var(--rp-khaki); }

/* The tooltip over the timeline. */
.rp-tip { position: absolute; transform: translateX(-50%); padding: 6px; width: max-content; max-width: 280px;
  background: var(--rp-plate-deep); border: 1px solid var(--rp-edge); border-radius: 6px;
  box-shadow: 0 8px 26px rgba(0, 0, 0, .55); opacity: 0; visibility: hidden; transition: opacity .12s; pointer-events: none; }
.rp-tip.show { opacity: 1; visibility: visible; }
/* map.css lays every canvas over the whole stage; this one sits in its box. */
.rp-tip-img { display: block; position: static; inset: auto; z-index: auto; width: 176px; height: auto;
  border-radius: 3px; margin: 0 auto 5px; background: #000; }
.rp-tip-img[hidden] { display: none; }
.rp-tip-time { font: 600 12px var(--rp-mono); text-align: center; }
.rp-tip-time span { margin-left: 8px; color: var(--rp-muted); font: 700 9px var(--rp-font); letter-spacing: .12em; }
.rp-tip-list { list-style: none; margin: 4px 0 0; padding: 0; }
.rp-tip-list li { display: flex; align-items: center; gap: 6px; padding: 2px 2px; font-size: 11px; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; color: var(--rp-muted); }
.rp-tip-list li.mine { color: var(--rp-ink); }
.rp-tip-list i { display: inline-flex; width: 11px; justify-content: center; }
.rp-tip-list i svg { width: 11px; height: 11px; }
.rp-tip-list i.dot::before { content: ''; width: 2px; height: 8px; background: currentColor; }
.rp-tip-list li.t1 i { color: var(--rp-axis); } .rp-tip-list li.t2 i { color: var(--rp-allies); }
.rp-tip-list li.kill.mine i { color: var(--rp-gold); } .rp-tip-list li.death i { color: var(--rp-axis); }
.rp-tip-list li.vehicle i { color: var(--rp-fire); }
.rp-tip-list li.spawn i { color: var(--rp-life); }

/* The player card. Its own width, not the half of the view left of its
   anchor, or a phone cuts the spawn countdown short. */
.rp-card { position: absolute; left: 50%; bottom: calc(var(--rp-bar-h) + 18px); transform: translateX(-50%);
  display: flex; align-items: stretch; width: max-content; max-width: calc(100% - 24px); pointer-events: auto;
  background: var(--rp-plate); border: 1px solid var(--rp-edge); border-radius: 8px; overflow: hidden;
  box-shadow: 0 6px 22px rgba(0, 0, 0, .4); transition: opacity .3s ease, transform .35s cubic-bezier(.2, .8, .2, 1); }
.rp-card .rp-btn { height: auto; border-radius: 0; min-width: 28px; }
.rp-card-main { display: grid; grid-template-columns: auto 1fr; grid-template-rows: auto auto; column-gap: 9px;
  align-items: center; padding: 5px 12px; min-width: 220px; max-width: 420px; border-left: 1px solid var(--rp-edge);
  border-right: 1px solid var(--rp-edge); background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.rp-card-main:hover { background: rgba(255, 255, 255, .05); }
.rp-card-flag { grid-row: 1 / 3; width: 24px; height: 24px; object-fit: contain; image-rendering: pixelated; }
.rp-card-flag.none { visibility: hidden; }
.rp-card-name { font: 700 14px/1.2 var(--rp-font); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rp-card-name.t1 { color: #ff8b8b; } .rp-card-name.t2 { color: #9ab8ff; }
.rp-card-rec { margin-left: 7px; padding: 1px 4px; border-radius: 2px; background: var(--rp-khaki); color: var(--rp-khaki-ink);
  font: 800 9px/1.2 var(--rp-font); letter-spacing: .1em; vertical-align: 2px; }
.rp-card-state { display: flex; align-items: center; gap: 8px; color: var(--rp-muted); font-size: 11px; white-space: nowrap; overflow: hidden; }
.rp-card-state .dead { color: var(--rp-axis); min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.rp-card-state .range { color: #b7c27a; }
/* Waiting to spawn: the time left, and a beat while it runs. */
.rp-card-state .spawn { flex: none; display: inline-flex; align-items: center; gap: 6px; color: var(--rp-life); }
.rp-card-state .spawn::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor;
  box-shadow: 0 0 6px currentColor; animation: rp-spawn-beat 1s ease-in-out infinite; }
.rp-card-state .spawn b { color: var(--rp-ink); font: 700 12px/1 var(--rp-mono); font-variant-numeric: tabular-nums; }
@keyframes rp-spawn-beat { 50% { opacity: .3; transform: scale(.7); } }
@media (prefers-reduced-motion: reduce) { .rp-card-state .spawn::before { animation: none; } }
.rp-hp { display: inline-block; width: 64px; height: 4px; border-radius: 2px; background: rgba(255, 255, 255, .15); overflow: hidden; flex: none; }
.rp-hp > i { display: block; height: 100%; background: #a9c36a; }
.rp-hp.smoke > i { background: var(--rp-gold); } .rp-hp.fire > i { background: var(--rp-axis); }

/* Name tags. */
.rp-tags { position: absolute; inset: 0; pointer-events: none; }
.rp-tag { position: absolute; left: 0; top: 0; display: flex; flex-direction: column; align-items: center; gap: 2px;
  padding: 1px 6px 2px; border: 1px solid rgba(255, 255, 255, .1); border-radius: 3px; margin: 0;
  background: rgba(10, 10, 9, .55); color: #e6e6e6; font: 700 11px/1.25 var(--rp-font); white-space: nowrap;
  pointer-events: auto; cursor: pointer; will-change: transform; }
.rp-tag:hover { background: rgba(10, 10, 9, .85); border-color: var(--rp-edge-strong); }
.rp-tag.t1 { color: #ff9a9a; } .rp-tag.t2 { color: #a6c0ff; }
.rp-tag.me { color: #fff; border-color: var(--rp-gold); box-shadow: 0 0 0 1px rgba(232, 195, 90, .35); }
.rp-tag small { color: var(--rp-muted); font-weight: 400; font-size: 10px; }
.rp-tag .rp-hp { width: 48px; height: 3px; }

/* Panels: the scoreboard, the shortcuts, the replay log. */
.rp-panel { pointer-events: auto; background: var(--rp-plate); border: 1px solid var(--rp-edge); border-radius: 8px;
  box-shadow: 0 12px 36px rgba(0, 0, 0, .55); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }
.rp-board { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -54%); display: none;
  grid-template-columns: 1fr 1fr; gap: 12px; width: min(880px, calc(100% - 32px));
  max-height: min(600px, calc(100% - var(--rp-bar-h) - 90px)); pointer-events: none; }
.rp-root.board-open .rp-board { display: grid; }
.rp-team { display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
.rp-team-head { display: flex; align-items: center; gap: 10px; padding: 7px 12px 6px; }
.rp-team-head img { width: 26px; height: 26px; object-fit: contain; image-rendering: pixelated; }
.rp-team-head b { font: 800 22px/1 var(--rp-font); letter-spacing: .02em; }
.rp-team-head span { margin-left: auto; font: 700 18px/1 var(--rp-mono); color: var(--rp-muted); }
.rp-team-cols, .rp-brow { display: grid; grid-template-columns: 20px minmax(0, 1fr) minmax(0, .8fr) 38px 38px; align-items: center; column-gap: 6px; }
.rp-team-cols { padding: 3px 10px; background: var(--rp-khaki); color: var(--rp-khaki-ink); font: 800 10px/1.4 var(--rp-font); letter-spacing: .1em; }
.rp-team-cols span:nth-last-child(-n+2), .rp-brow span:nth-last-child(-n+2) { text-align: right; font-family: var(--rp-mono); }
.rp-team-rows { overflow: auto; min-height: 0; padding: 2px 0 4px; }
.rp-brow { width: 100%; padding: 3px 10px; margin: 0; border: 0; background: none; color: var(--rp-ink); font: 12px/1.3 var(--rp-font);
  text-align: left; cursor: pointer; }
.rp-brow:hover { background: rgba(255, 255, 255, .07); }
.rp-brow.me { background: rgba(232, 195, 90, .16); box-shadow: inset 2px 0 0 var(--rp-gold); }
.rp-brow.dead, .rp-brow.left, .rp-brow.absent { color: var(--rp-muted); }
.rp-brow .st { display: inline-flex; justify-content: center; color: var(--rp-muted); }
.rp-brow .st svg { width: 12px; height: 12px; }
.rp-brow.dead .st { color: var(--rp-axis); }
.rp-brow .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 700; }
.rp-brow .vh { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--rp-muted); font-size: 11px; }
.rp-team.t1 .rp-team-head b { color: #ff8b8b; } .rp-team.t2 .rp-team-head b { color: #9ab8ff; }
.rp-help { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -54%); display: none;
  width: min(760px, calc(100% - 32px)); max-height: calc(100% - var(--rp-bar-h) - 60px); overflow: auto; padding: 0 0 12px; }
.rp-root.help-open .rp-help { display: block; }
.rp-panel-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 4px 6px 4px 12px;
  background: var(--rp-khaki); color: var(--rp-khaki-ink); font: 800 11px/1.8 var(--rp-font); letter-spacing: .14em;
  text-transform: uppercase; border-radius: 7px 7px 0 0; }
.rp-panel-head .rp-btn { color: var(--rp-khaki-ink); height: 22px; min-width: 22px; }
.rp-help-cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 4px 22px; padding: 10px 14px 0; }
.rp-help h3 { margin: 8px 0 4px; font: 800 10px var(--rp-font); letter-spacing: .14em; text-transform: uppercase; color: var(--rp-muted); }
.rp-help dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 10px; margin: 0; align-items: baseline; }
.rp-help dt { white-space: nowrap; }
.rp-help dd { margin: 0; color: var(--rp-muted); }
.rp-help kbd { display: inline-block; min-width: 20px; padding: 1px 5px; margin-right: 2px; text-align: center;
  border: 1px solid var(--rp-edge); border-bottom-width: 2px; border-radius: 4px; background: rgba(0, 0, 0, .3);
  color: var(--rp-ink); font: 11px/1.4 var(--rp-mono); }
.rp-log { position: absolute; right: 12px; top: var(--rp-log-top); bottom: calc(var(--rp-bar-h) + 22px); width: min(400px, calc(100% - 24px));
  display: none; flex-direction: column; font: 11px/1.45 var(--rp-mono); }
.rp-root.log-open .rp-log { display: flex; }
.rp-log-opts { display: flex; flex-wrap: wrap; gap: 4px 12px; padding: 5px 10px; border-bottom: 1px solid var(--rp-edge); color: var(--rp-muted); }
.rp-log-opts label { display: inline-flex; align-items: center; gap: 5px; cursor: pointer; }
.rp-log-opts input { margin: 0; accent-color: var(--rp-khaki); }
.rp-log-status { flex-basis: 100%; font-size: 10px; }
.rp-log-list { overflow: auto; min-height: 0; flex: 1 1 auto; -webkit-user-select: text; user-select: text; }
.rp-row { display: grid; grid-template-columns: 6ch 6.5ch 1fr; gap: 8px; padding: 2px 10px; color: var(--rp-muted); cursor: pointer; opacity: .5; }
.rp-row.past { opacity: 1; color: var(--rp-ink); }
.rp-row.current { background: rgba(163, 156, 108, .2); }
.rp-row:hover { background: rgba(255, 255, 255, .06); }
.rp-row.hidden { display: none; }
.rp-row time { font-variant-numeric: tabular-nums; }
.rp-src { font-size: 9px; letter-spacing: .06em; text-transform: uppercase; text-align: center; border: 1px solid; border-radius: 3px; padding: 0 3px; align-self: start; }
.rp-src.client { color: #b8c47a; border-color: rgba(184, 196, 122, .5); }
.rp-src.server { color: var(--rp-gold); border-color: rgba(232, 195, 90, .5); }
.rp-row.k-destroyed .rp-text, .rp-row.k-destroyVehicle .rp-text { color: #f08a6a; }
.rp-row.k-damage .rp-text { color: var(--rp-gold); }

/* The notice: one word of feedback for a key. */
.rp-notice { position: absolute; left: 50%; top: 17%; transform: translate(-50%, -6px); padding: 5px 14px;
  background: rgba(12, 12, 10, .72); border: 1px solid var(--rp-edge); border-radius: 6px; font: 800 12px/1.4 var(--rp-font);
  letter-spacing: .14em; text-transform: uppercase; opacity: 0; transition: opacity .2s, transform .2s; }
.rp-notice.show { opacity: 1; transform: translate(-50%, 0); }
.rp-toast { position: absolute; left: 50%; top: 16px; transform: translateX(-50%); z-index: 40; max-width: calc(100% - 32px);
  padding: 8px 12px; background: var(--panel, rgba(19, 19, 19, .9)); border: 1px solid #d9b36a; border-radius: 6px;
  color: var(--text, #c8c8c8); font: 12px var(--mm-font-mono, monospace); }

/* The free camera's thumbstick (touch): a ring where the thumb went down,
   the knob where it has pushed to; faint at its home while the free camera
   waits for a thumb. */
.rp-stick { position: absolute; left: 0; top: 0; width: ${STICK_R * 2 + 8}px; height: ${STICK_R * 2 + 8}px;
  margin: -${STICK_R + 4}px 0 0 -${STICK_R + 4}px; border-radius: 50%; pointer-events: none; opacity: 0;
  border: 1.5px solid rgba(238, 236, 217, .4); background: radial-gradient(circle, rgba(20, 20, 17, .15), rgba(20, 20, 17, .45));
  transition: opacity .25s ease; }
.rp-stick > i { position: absolute; left: 50%; top: 50%; width: 42px; height: 42px; margin: -21px 0 0 -21px; border-radius: 50%;
  background: rgba(238, 236, 217, .6); box-shadow: 0 0 0 1px rgba(0, 0, 0, .35), 0 2px 8px rgba(0, 0, 0, .45); }
.rp-stick.home { opacity: .4; }
.rp-stick.on { opacity: 1; transition: none; }

/* Hidden: idle while it plays, or a tap on the view. The bar slides down
   off the view's edge and the card goes with it. */
.rp-root.rp-idle .rp-bar { opacity: 0; transform: translateY(calc(100% + 16px)); pointer-events: none; }
.rp-root.rp-idle .rp-card { opacity: 0; transform: translate(-50%, calc(var(--rp-bar-h) + 16px)); pointer-events: none; }
.rp-root.rp-idle .rp-mini { opacity: 1; }
.rp-root.rp-bare > :not(.rp-input):not(.rp-notice):not(.rp-stick) { display: none !important; }
@media (prefers-reduced-motion: reduce) { .rp-bar, .rp-card { transition: opacity .2s ease; } }

/* Touch: targets a thumb can hit. */
@media (pointer: coarse) {
  .rp-btn { min-width: 38px; height: 38px; }
  .rp-btn.play { width: 46px; height: 40px; }
  .rp-seg .rp-btn { min-width: 40px; height: 38px; }
  .rp-grp { gap: 4px; }
  .rp-card .rp-btn { min-width: 40px; }
  .rp-speed-menu .rp-btn { height: 36px; }
  .rp-panel-head .rp-btn { height: 30px; min-width: 30px; }
  .rp-mi { height: 40px; }
}
@media (hover: none) {
  .rp-keys-only { display: none; }
  /* Nothing hovers to bring the playhead's knob up: it stays, to be grabbed. */
  .rp-tl-knob { transform: scale(1); }
}

/* The bar folds as it narrows: the date, the labels, the log and the open
   button (into the menu), the round clock, the 5 s steps, and then the view's
   controls take a row of their own. */
@container rp-bar (max-width: 1100px) { .rp-stamp { display: none; } .rp-more-when:not(:empty) { display: block; } }
@container rp-bar (max-width: 1000px) { .rp-label { display: none; } }
@container rp-bar (max-width: 920px) { .rp-roomy { display: none; } .rp-mi-roomy { display: flex; } }
@container rp-bar (max-width: 830px) { .rp-round { display: none; } }
@container rp-bar (max-width: 740px) { .rp-step { display: none; } .rp-ctl { column-gap: 6px; } }
@container rp-bar (max-width: 610px) {
  .rp-ctl { gap: 3px 6px; }
  .rp-break { display: block; flex-basis: 100%; height: 0; }
  .rp-ctl > .rp-speed { margin-left: auto; }
  .rp-ctl > .rp-seg { margin-left: 0; margin-right: auto; }
  .rp-step { display: inline-flex; }
  /* The speed sits at the row's end: its menu opens leftward, on screen. */
  .rp-speed-menu { left: auto; right: -4px; transform: none; }
}
@container rp-bar (max-width: 380px) { .rp-step { display: none; } }
@container rp-bar (max-width: 345px) {
  .rp-btn { min-width: 34px; }
  .rp-seg .rp-btn { min-width: 36px; }
  .rp-ctl { column-gap: 4px; }
}

@media (max-width: 720px) {
  .rp-bar { left: 6px; right: 6px; bottom: 6px; padding: 4px 8px 6px; }
  .rp-card { bottom: calc(var(--rp-bar-h) + 12px); }
  .rp-card-name .rp-card-rec { display: none; }
  .rp-card-main { min-width: 0; }
  .rp-board { grid-template-columns: 1fr; overflow: auto; }
  .rp-log { top: auto; height: 38%; }
}
/* A phone on its side: little height, so the panels start at the top. */
@media (max-height: 500px) {
  .rp-bar { bottom: 6px; padding-top: 3px; padding-bottom: 5px; }
  .rp-card { bottom: calc(var(--rp-bar-h) + 12px); }
  .rp-board, .rp-help { top: 8px; transform: translateX(-50%); max-height: calc(100% - var(--rp-bar-h) - 26px); }
  .rp-team-head { padding: 4px 10px 3px; }
  .rp-team-head b { font-size: 16px; }
  .rp-team-head span { font-size: 14px; }
}
`;

export function toast(stage, message) {
  const node = el('div', 'rp-toast', message);
  stage.appendChild(node);
  setTimeout(() => node.remove(), 9000);
}

export class ReplayUi {
  constructor(player) {
    this.player = player;
    this.ctx = player.ctx;
    this.stage = player.ctx.stage;
    this.currentRow = -1;
    this.showTags = true;
    this.lastActivity = performance.now();
    this.overChrome = false;
    this.userHidden = false;     // a tap on the view put the chrome away
    this.chromeHidden = false;   // the bar and the card are away, for either reason
    this.touchUi = false;        // the last hand on the replay was a finger
    this.coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    this.stick = null;           // the free camera's thumb: { id, x, y, at, moved, floated }
    this.frameKey = null;        // F: the frame on screen as the cover (`useFrameKey`)
    this.slowClock = 0;
    this.tagNodes = new Map();
    this.boardKey = '';
    this.disposed = false;
    if (!document.getElementById('rp-style')) {
      const style = el('style');
      style.id = 'rp-style';
      style.textContent = STYLE;
      document.head.appendChild(style);
    }
    // The replay owns the screen, as a match does (map.css `shell-playing`),
    // and the flythrough's own buttons go, and the page's crosshair but in
    // the followed player's first person (replay-hud.js). The page lets go
    // of the pointer if a click while loading took it.
    const html = document.documentElement;
    this.addedShell = !html.classList.contains('shell-playing');
    html.classList.add('shell-playing', 'replay-on');
    player.ctx.releasePageInput?.();

    this.root = el('div', 'rp-root');
    this.input = el('div', 'rp-input');
    this.tags = el('div', 'rp-tags');
    this.timeline = new ReplayTimeline(this);
    this.buildBar();
    this.buildCard();
    this.buildBoard();
    this.buildHelp();
    this.buildLog();
    this.notice = el('div', 'rp-notice');
    this.mini = el('div', 'rp-mini');
    this.miniFill = el('i');
    this.mini.append(this.miniFill);
    this.stickEl = el('div', 'rp-stick');
    this.stickKnob = el('i');
    this.stickEl.append(this.stickKnob);
    this.root.append(this.input, this.tags, this.stickEl, this.card, this.bar, this.log, this.board, this.help,
      this.timeline.tip, this.mini, this.notice);
    this.stage.append(this.root);

    // A finger on the chrome keeps it up; one on the view decides for itself
    // (`bindPointer`: a tap toggles it, a drag leaves it be).
    this.root.addEventListener('pointerdown', e => {
      player.ctx.ensureAudio?.();
      if (e.pointerType === 'touch') {
        this.touchUi = true;
        if (e.target !== this.input) this.activity();
      }
    }, true);
    this.bindPointer();
    this.bindKeys();
    this.onFullscreen = () => this.syncFullscreen();
    document.addEventListener('fullscreenchange', this.onFullscreen);
    document.addEventListener('webkitfullscreenchange', this.onFullscreen);
    this.sizes = new ResizeObserver(() => this.measure());
    this.sizes.observe(this.bar);
    this.sizes.observe(this.card);
    this.sizes.observe(this.stage);
    this.measure();
  }

  /** A timeline drag holds the clock (replay.js `update`). */
  get scrubbing() {
    return this.timeline.scrubbing;
  }

  /** The replay log (the debug panel) is up, and not hidden with the HUD. */
  get logOpen() {
    return this.root.classList.contains('log-open') && !this.root.classList.contains('rp-bare');
  }

  // --- building -----------------------------------------------------------------

  button(className, icon, label, onClick, text = '') {
    const b = el('button', `rp-btn ${className}`.trim());
    b.type = 'button';
    b.innerHTML = `${icon ? svg(icon) : ''}${text}`;
    b.title = label;
    b.setAttribute('aria-label', label);
    b.addEventListener('click', e => {
      e.stopPropagation();
      quietly(label, () => onClick(e));
    });
    return b;
  }

  /** The bar's controls, in one row that folds (the style's container
   *  queries): the transport, the clocks and the speed, then the view's --
   *  the cameras, the panels, the menu and fullscreen. A control marked
   *  `rp-step`, `rp-label`, `rp-roomy`, `rp-round` or `rp-stamp` is one the
   *  bar lets go of as it narrows; the menu takes up the `rp-roomy` ones. */
  buildBar() {
    this.bar = el('div', 'rp-bar');
    const transport = el('div', 'rp-grp');
    this.prevBtn = this.button('', 'prev', 'Previous event (,)', () => this.stepChapter(-1));
    this.backBtn = this.button('rp-step', 'back', 'Back 5 s (Left)', () => this.skip(-5), '<small>5</small>');
    this.playBtn = this.button('play', 'pause', 'Pause (Space)', () => this.togglePlay());
    this.fwdBtn = this.button('rp-step', 'forward', 'Forward 5 s (Right)', () => this.skip(5), '<small>5</small>');
    this.nextBtn = this.button('', 'next', 'Next event (.)', () => this.stepChapter(1));
    transport.append(this.prevBtn, this.backBtn, this.playBtn, this.fwdBtn, this.nextBtn);

    this.timeText = el('span', 'rp-time');
    this.roundText = el('span', 'rp-round');

    const modes = el('div', 'rp-seg');
    this.modeBtns = {
      orbit: this.button('', 'orbit', 'Orbit camera (1)', () => this.setMode('orbit')),
      pov: this.button('', 'pov', 'First person (2)', () => this.setMode('pov')),
      free: this.button('', 'free', 'Free camera (3)', () => this.setMode('free')),
      auto: this.button('', 'auto', 'Auto camera: follows the action (4)', () => this.setMode('auto')),
    };
    modes.append(this.modeBtns.orbit, this.modeBtns.pov, this.modeBtns.free, this.modeBtns.auto);

    this.speedWrap = el('div', 'rp-speed');
    this.speedBtn = this.button('', null, 'Playback speed (- / =)', () => {
      this.closeMore();
      this.speedWrap.classList.toggle('open');
    }, '1x');
    const menu = el('div', 'rp-speed-menu');
    this.speedItems = SPEEDS.map(s => {
      const item = this.button('', null, `${s}x`, () => {
        this.setSpeed(s);
        this.speedWrap.classList.remove('open');
      }, `${s}x`);
      menu.append(item);
      return item;
    });
    this.speedWrap.append(this.speedBtn, menu);

    this.playersBtn = this.button('', 'players', 'Players (Tab)', () => this.toggle('board-open'), '<span class="rp-label">Players</span>');
    this.logBtn = this.button('rp-roomy', 'log', 'Replay log (L)', () => this.toggle('log-open'));
    this.helpBtn = this.button('rp-keys-only', null, 'Shortcuts (?)', () => this.toggle('help-open'), '?');
    this.fullBtn = this.button('', 'full', 'Fullscreen', () => this.toggleFullscreen());
    this.buildMore();

    // The break is where a phone's bar starts its second row.
    const ctl = el('div', 'rp-ctl');
    ctl.append(transport, this.timeText, this.roundText, this.speedWrap, el('i', 'rp-break'), modes,
      this.playersBtn, this.logBtn, this.moreWrap, this.helpBtn, this.fullBtn);
    this.bar.append(this.timeline.el, ctl);
    this.syncMode();
    this.syncSpeed();
    this.syncFullscreen();
  }

  /** The menu: the name tags and the battle markers (keys N and B, nothing
   *  else to press on a phone), hiding the interface, and the log and the
   *  open button once the bar has folded them away. */
  buildMore() {
    this.moreWrap = el('div', 'rp-more');
    this.moreBtn = this.button('', 'more', 'More', () => this.toggleMore());
    this.moreBtn.setAttribute('aria-haspopup', 'menu');
    this.moreBtn.setAttribute('aria-expanded', 'false');
    this.moreMenu = el('div', 'rp-more-menu');
    this.moreMenu.setAttribute('role', 'menu');
    this.moreWhen = el('div', 'rp-more-when');
    this.moreMenu.append(this.moreWhen);
    const item = (className, icon, text, key, onClick, check = false) => {
      const b = el('button', `rp-mi ${className}`.trim());
      b.type = 'button';
      b.setAttribute('role', check ? 'menuitemcheckbox' : 'menuitem');
      b.innerHTML = `${svg(icon)}<span>${esc(text)}</span>${check ? '<b></b>' : ''}${key ? `<kbd class="rp-keys-only">${key}</kbd>` : ''}`;
      b.addEventListener('click', e => {
        e.stopPropagation();
        quietly(text, onClick);
        // A switch shows its new state; anything else is done with the menu.
        if (check) quietly(text, () => this.syncMore());
        else quietly(text, () => this.closeMore());
      });
      this.moreMenu.append(b);
      return b;
    };
    this.moreItems = {
      tags: item('', 'tags', 'Name tags', 'N', () => this.toggleTags(), true),
      markers: item('', 'markers', 'Battle markers', 'B', () => this.player.highlights?.toggleMarkers(), true),
      log: item('rp-mi-roomy', 'log', 'Replay log', 'L', () => this.toggle('log-open')),
      open: item('rp-mi-roomy', 'upload', 'Open a recording', '', () => this.bar.querySelector('.ro-open')?.click()),
      bare: item('', 'hide', 'Hide the HUD', 'H', () => this.setBare(true)),
    };
    this.moreWrap.append(this.moreBtn, this.moreMenu);
  }

  toggleMore() {
    const open = !this.moreWrap.classList.contains('open');
    if (open) {
      this.speedWrap.classList.remove('open');
      this.syncMore();
    }
    this.moreWrap.classList.toggle('open', open);
    this.moreBtn.classList.toggle('on', open);
    this.moreBtn.setAttribute('aria-expanded', String(open));
  }

  closeMore() {
    this.moreWrap.classList.remove('open');
    this.moreBtn.classList.remove('on');
    this.moreBtn.setAttribute('aria-expanded', 'false');
  }

  /** The menu's switches as they stand, and what it offers here: markers
   *  with the highlights up, Open where the bar has its button. */
  syncMore() {
    const check = (item, on) => {
      item.classList.toggle('on', on);
      item.setAttribute('aria-checked', String(on));
      item.querySelector('b').textContent = on ? 'ON' : 'OFF';
    };
    check(this.moreItems.tags, this.showTags);
    const highlights = this.player.highlights;
    this.moreItems.markers.hidden = !highlights;
    if (highlights) check(this.moreItems.markers, highlights.showMarkers);
    this.moreItems.open.hidden = !this.bar.querySelector('.ro-open');
    // When the round was recorded, once the bar has folded its date away.
    const stamp = this.bar.querySelector('.rp-stamp');
    this.moreWhen.textContent = stamp?.textContent ?? '';
    this.moreWhen.title = stamp?.title ?? '';
  }

  toggleTags() {
    this.showTags = !this.showTags;
    this.flash(this.showTags ? 'Name tags on' : 'Name tags off');
  }

  buildCard() {
    this.card = el('div', 'rp-card');
    const prev = this.button('', 'chevLeft', 'Previous player (Up)', () => this.stepPlayer(-1));
    const next = this.button('', 'chevRight', 'Next player (Down)', () => this.stepPlayer(1));
    this.cardMain = el('button', 'rp-card-main');
    this.cardMain.type = 'button';
    this.cardMain.title = 'Players (Tab)';
    this.cardMain.addEventListener('click', e => {
      e.stopPropagation();
      quietly('the players button', () => this.toggle('board-open'));
    });
    this.cardFlag = el('img', 'rp-card-flag none');
    this.cardFlag.alt = '';
    this.cardName = el('span', 'rp-card-name');
    this.cardState = el('span', 'rp-card-state');
    this.cardMain.append(this.cardFlag, this.cardName, this.cardState);
    this.card.append(prev, this.cardMain, next);
  }

  buildBoard() {
    this.board = el('div', 'rp-board');
    this.teams = {};
    for (const team of [1, 2]) {
      const box = el('div', `rp-panel rp-team t${team}`);
      const head = el('div', 'rp-team-head');
      const flag = el('img');
      flag.alt = '';
      const name = el('b', '', team === 1 ? 'AXIS' : 'ALLIED');
      const count = el('span');
      head.append(flag, name, count);
      const cols = el('div', 'rp-team-cols');
      for (const text of ['', 'PLAYER', 'IN', 'K', 'D']) cols.append(el('span', '', text));
      const rows = el('div', 'rp-team-rows');
      box.append(head, cols, rows);
      this.board.append(box);
      this.teams[team] = { box, flag, count, rows };
    }
    // A name clicked is the player followed, and the board goes.
    this.board.addEventListener('click', e => {
      const row = e.target.closest?.('.rp-brow');
      if (!row) return;
      e.stopPropagation();
      quietly('following a player', () => this.follow(Number(row.dataset.pid)));
      this.root.classList.remove('board-open');
    });
  }

  buildHelp() {
    this.help = el('div', 'rp-panel rp-help');
    const head = el('div', 'rp-panel-head');
    head.append(el('span', '', 'Replay controls'), this.button('', 'close', 'Close (Esc)', () => this.root.classList.remove('help-open')));
    const cols = el('div', 'rp-help-cols');
    const k = keys => keys.map(key => `<kbd>${key}</kbd>`).join('');
    const groups = [
      ['Playback', [
        [k(['Space']), 'Play / pause'],
        [k(['&larr;', '&rarr;']), 'Back / forward 5 s (Shift: 15 s)'],
        [k([',', '.']), 'Previous / next event (Shift: his only)'],
        [k(['-', '=']), 'Slower / faster'],
        [k(['Home', 'End']), 'Start / end'],
      ]],
      ['Camera', [
        [k(['1', '2', '3', '4']), 'Orbit / first person / free / auto'],
        [k(['C']), 'Next camera (in a plane, the nose cam after the cockpit)'],
        ['Drag, wheel', 'Orbit and zoom'],
        [k(['W', 'S']), 'Zoom in / out (free: move)'],
        [k(['A', 'D']), 'Orbit (free: strafe)'],
        [k(['Q', 'E']), 'Tilt (free: down / up)'],
        ['Right button', 'Free: look (held)'],
        [k(['R']), 'Behind him again'],
      ]],
      ['Players', [
        [k(['&uarr;', '&darr;']), 'Previous / next player'],
        [k(['Tab']), 'Players'],
        ['Click a name', 'Follow him'],
        [k(['M']), 'Battle map: click a man, a fight or the ground'],
        [k(['B']), 'Battle markers'],
      ]],
      ['View', [
        [k(['N']), 'Name tags (the players near the camera)'],
        [k(['L']), 'Replay log'],
        [k(['H']), 'Hide the HUD'],
        [k(['F']), 'Use this frame as the cover'],
        [k(['?']), 'This list'],
        [k(['Esc']), 'Close a panel; then the game menu'],
      ]],
    ];
    for (const [title, rows] of groups) {
      const col = el('div');
      col.append(el('h3', '', title));
      const dl = el('dl');
      for (const [keysHtml, what] of rows) {
        const dt = el('dt');
        dt.innerHTML = keysHtml;
        dl.append(dt, el('dd', '', what));
      }
      col.append(dl);
      cols.append(col);
    }
    this.help.append(head, cols);
  }

  buildLog() {
    const player = this.player;
    this.log = el('div', 'rp-panel rp-log');
    const head = el('div', 'rp-panel-head');
    head.append(el('span', '', 'Replay log'), this.button('', 'close', 'Close (L)', () => this.root.classList.remove('log-open')));
    const opts = el('div', 'rp-log-opts');
    const serverToggle = this.checkbox('server log', player.showServer, on => {
      player.showServer = on;
      this.applyRowFilter();
    });
    serverToggle.title = player.alignment ? 'show the server event log on the level and in this list'
      : 'load a server log (&serverlog=) to overlay it';
    serverToggle.querySelector('input').disabled = !player.alignment;
    const ghosts = this.checkbox('out-of-range vehicles', player.showGhosts, on => { player.showGhosts = on; });
    ghosts.title = 'vehicles driven beyond the recording player\'s view distance (the map\'s fog line), where the server stops sending them: drawn translucent where they were last seen. One nobody has driven since is where it was, drawn solid';
    this.statusText = el('span', 'rp-log-status');
    opts.append(serverToggle, ghosts, this.statusText);
    this.list = el('div', 'rp-log-list');
    this.log.append(head, opts, this.list);
  }

  checkbox(text, checked, onChange) {
    const label = el('label');
    const input = el('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.addEventListener('change', () => onChange(input.checked));
    label.append(input, document.createTextNode(text));
    return label;
  }

  measure() {
    const h = this.bar.offsetHeight;
    if (h) this.root.style.setProperty('--rp-bar-h', `${h}px`);
    this.barH = h;
    this.stageW = this.stage.clientWidth;
    this.stageH = this.stage.clientHeight;
    this.cardW = this.card.offsetWidth;
    // What sits over the card (the Auto caption, the reel, a phone's ticker)
    // clears it at its own height.
    const card = this.card.offsetHeight;
    if (card) this.root.style.setProperty('--rp-card-h', `${card}px`);
    this.cardH = card;
    // The log docks under the game's minimap, whose frame ends at y 205 of
    // the HUD's 600 (map.css `#minimap`).
    const stageH = this.stage.clientHeight || 600;
    this.root.style.setProperty('--rp-log-top', `${Math.round((205 / 600) * stageH) + 14}px`);
  }

  // --- what the controls do ---------------------------------------------------------

  lexicon() {
    return this.ctx.comms?.lexicon?.() ?? null;
  }

  /** A pointer move or a key: the chrome comes back, and stays `extra`
   *  seconds longer than an idle moment would keep it. */
  activity(extra = 0) {
    this.lastActivity = performance.now() + extra * 1000;
  }

  flash(text, ms = 1100) {
    this.notice.textContent = text;
    this.notice.classList.add('show');
    clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => this.notice.classList.remove('show'), ms);
  }

  togglePlay() {
    const player = this.player;
    if (!player.playing && player.time >= player.rec.duration) player.seek(0);
    player.playing = !player.playing;
  }

  skip(seconds) {
    this.player.seek(this.player.time + seconds);
  }

  jumpTo(ch) {
    this.player.seek(chapterStart(ch));
  }

  stepChapter(dir, own = false) {
    const player = this.player;
    const pid = own ? player.followPid : null;
    const ch = dir > 0 ? nextChapter(player.chapters, player.time, pid) : prevChapter(player.chapters, player.time, pid);
    if (ch) this.jumpTo(ch);
    else if (dir < 0) player.seek(0);
  }

  setSpeed(speed) {
    this.player.speed = speed;
    this.syncSpeed();
    this.flash(`${speed}x`);
  }

  stepSpeed(dir) {
    const i = SPEEDS.indexOf(this.player.speed);
    const next = SPEEDS[Math.min(SPEEDS.length - 1, Math.max(0, (i < 0 ? SPEEDS.indexOf(1) : i) + dir))];
    this.setSpeed(next);
  }

  syncSpeed() {
    this.speedBtn.textContent = `${this.player.speed}x`;
    this.speedItems.forEach((item, i) => item.classList.toggle('on', SPEEDS[i] === this.player.speed));
  }

  setMode(mode) {
    // Auto is the orbit with the director choosing whom (replay-highlights.js).
    const highlights = this.player.highlights;
    if (mode === 'auto') {
      highlights?.setAuto(true);
      this.syncMode();
      return;
    }
    const wasAuto = Boolean(highlights?.auto);
    highlights?.setAuto(false, true);
    // First person again, in an aircraft: its other view, as the game's
    // first-person key does on a second press.
    if (mode === 'pov' && !wasAuto && this.player.camera.mode === 'pov') {
      const view = this.player.camera.toggleNose();
      if (view) this.flash(view === 'nose' ? 'Nose camera' : 'Cockpit');
      this.syncMode();
      return;
    }
    if (this.player.camera.setMode(mode) || wasAuto) {
      // On a touch screen the free camera's flying is the thumbstick's, which
      // nothing else would say is there.
      if (mode === 'free' && this.coarse) this.flash('Free camera: left thumb flies, drag looks', 2600);
      else this.flash(mode === 'orbit' ? 'Orbit' : mode === 'pov' ? 'First person' : 'Free camera');
    }
    this.syncMode();
  }

  /** The camera the bar shows as chosen: Auto while the director has it. */
  uiMode() {
    return this.player.highlights?.auto ? 'auto' : this.player.camera.mode;
  }

  syncMode() {
    const mode = this.uiMode();
    for (const [name, b] of Object.entries(this.modeBtns)) b.classList.toggle('on', name === mode);
    this.root?.classList.toggle('mode-free', mode === 'free');
  }

  follow(pid) {
    if (pid === this.player.followPid) return;
    this.player.follow(pid);
    this.flash(nameAt(this.player.rec, pid, this.player.time));
    this.syncMode();
    this.slowClock = SLOW_TICK;
  }

  /** The next or previous player in the scoreboard's order, skipping those
   *  not in the round at this moment. */
  stepPlayer(dir) {
    const player = this.player;
    const roster = rosterOf(player.rec, player.time);
    if (!roster.length) return;
    const present = roster.filter(p => {
      const s = playerStatusAt(player.rec, p.pid, player.time).state;
      return s !== 'left' && s !== 'absent';
    });
    const list = present.length ? present : roster;
    const at = list.findIndex(p => p.pid === player.followPid);
    const next = list[(at + dir + list.length) % list.length] ?? list[0];
    this.follow(next.pid);
  }

  toggle(cls) {
    // Out of the hidden HUD, a panel's key brings it back with that panel up.
    const bare = this.root.classList.contains('rp-bare');
    const on = bare || !this.root.classList.contains(cls);
    if (bare) this.setBare(false, true);
    // One overlay in the middle at a time.
    if (on && cls === 'board-open') this.root.classList.remove('help-open');
    if (on && cls === 'help-open') this.root.classList.remove('board-open');
    if (on) {
      this.player.highlights?.map.close();
      this.closeMore();
    }
    this.root.classList.toggle(cls, on);
    this.playersBtn.classList.toggle('on', this.root.classList.contains('board-open'));
    this.logBtn.classList.toggle('on', this.root.classList.contains('log-open'));
    if (cls === 'board-open' && on) this.renderBoard(true);
    if (cls === 'log-open' && on) this.scrollLogToCurrent();
  }

  /** The whole page fullscreen, not the stage, so the page's own panels
   *  (Open recording's) still show over it; a phone turns on its side for
   *  it. An iPhone's Safari has no fullscreen for a page, only for a video:
   *  there the HUD goes instead, and a tap brings it back. */
  toggleFullscreen() {
    if (fullscreenElement()) {
      exitFullscreen();
      return;
    }
    if (!canFullscreen()) {
      this.setBare(!this.root.classList.contains('rp-bare'));
      return;
    }
    const page = document.documentElement;
    let asked;
    try {
      asked = (page.requestFullscreen ?? page.webkitRequestFullscreen).call(page, { navigationUI: 'hide' });
    } catch {
      return;
    }
    // A phone's view of a round is a wide one. A tablet, or a phone the
    // browser will not turn, stays as it is held.
    Promise.resolve(asked).then(() => {
      if (!this.coarse || Math.min(screen.width, screen.height) >= 600) return;
      screen.orientation?.lock?.('landscape')?.catch?.(() => {});
    }, () => {});
  }

  /** The button's icon and words follow the fullscreen, however it ended. */
  syncFullscreen() {
    const on = Boolean(fullscreenElement());
    if (this.shownFullscreen === on) return;
    this.shownFullscreen = on;
    const label = on ? 'Exit fullscreen' : 'Fullscreen';
    this.fullBtn.innerHTML = svg(on ? 'unfull' : 'full');
    this.fullBtn.title = label;
    this.fullBtn.setAttribute('aria-label', label);
    if (!on) {
      try { screen.orientation?.unlock?.(); } catch {}
    }
  }

  /** The HUD away (H, the menu, a phone's fullscreen), or back: every panel
   *  and mark of the replay's, and the page's own layers over the view, the
   *  message log and the minimap among them (the style's `replay-bare`). On
   *  a touch screen a tap brings it back. `quiet`: no word on the view. */
  setBare(on, quiet = false) {
    const root = this.root;
    if (on === root.classList.contains('rp-bare')) return;
    if (on) this.closeFloating();
    root.classList.toggle('rp-bare', on);
    document.documentElement.classList.toggle('replay-bare', on);
    this.userHidden = false;
    if (!quiet) this.flash(on ? (this.touchUi || this.coarse ? 'Tap to show' : 'H to show') : 'HUD');
    // A panel brought it back: 'H to show' is not so any more.
    else if (!on) this.notice.classList.remove('show');
  }

  /** What F does: the page's REPLAY feed makes it the recording's cover,
   *  or says why it cannot be (replay-social.js). */
  useFrameKey(run) {
    this.frameKey = run;
  }

  // --- the input ------------------------------------------------------------------

  bindPointer() {
    const input = this.input;
    const camera = () => this.player.camera;
    // The fingers on the view that orbit, look and pinch (the thumbstick's
    // is not among them).
    const touches = new Map();
    let drag = null;
    let pinch = 0;
    // A finger down on the view that may yet be a tap: { id, x, y, at, floated }.
    let tap = null;
    const lockHeld = () => document.pointerLockElement === input;
    // Each of the view's pointer handlers runs quietly (`quietly`): one that
    // throws leaves the camera and the rest of the replay's input working.
    const on = (type, fn, options) => input.addEventListener(type, e => quietly(`the view's ${type}`, () => fn(e)), options);
    on('pointerdown', e => {
      const touch = e.pointerType === 'touch';
      // Whatever floated over the view goes; a tap that closed it does no more.
      const floated = this.closeFloating();
      if (!touch) this.activity();
      else {
        if (this.startStick(e, floated)) return;
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        tap = touches.size === 1 ? { id: e.pointerId, x: e.clientX, y: e.clientY, at: performance.now(), floated } : null;
        if (touches.size === 2) {
          const [a, b] = [...touches.values()];
          pinch = Math.hypot(a.x - b.x, a.y - b.y);
        }
      }
      if (e.button !== 0 && e.button !== 2) return;
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, button: e.button };
      try { input.setPointerCapture(e.pointerId); } catch {}
      input.classList.add('dragging');
      camera().looking = true;
      // The free camera looks while the right button is held, with the
      // pointer locked for as long as it is -- and only then.
      if (camera().mode === 'free' && e.button === 2 && e.pointerType === 'mouse') {
        try {
          const lock = input.requestPointerLock();
          if (lock?.catch) lock.catch(() => {});
        } catch {}
      }
    });
    on('pointermove', e => {
      if (this.moveStick(e)) return;
      // A finger dragging the view leaves the chrome as it is.
      if (e.pointerType !== 'touch') this.activity();
      if (tap && e.pointerId === tap.id && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > TAP_SLOP) tap = null;
      if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (touches.size >= 2) {
          const [a, b] = [...touches.values()];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (pinch > 0 && d > 0) camera().pinch(d / pinch);
          pinch = d;
          return;
        }
      }
      if (!drag || e.pointerId !== drag.id) return;
      const locked = lockHeld();
      const dx = locked ? e.movementX : e.clientX - drag.x;
      const dy = locked ? e.movementY : e.clientY - drag.y;
      drag.x = e.clientX;
      drag.y = e.clientY;
      if (dx || dy) camera().drag(dx, dy);
    });
    const end = e => {
      if (this.endStick(e)) return;
      if (e.pointerType === 'touch') {
        touches.delete(e.pointerId);
        if (touches.size < 2) pinch = 0;
        // Out of a pinch, the finger left dragging goes on from where it is,
        // not from where the pinch began.
        const still = drag && touches.get(drag.id);
        if (still) {
          drag.x = still.x;
          drag.y = still.y;
        }
        if (tap && e.pointerId === tap.id) {
          const tapped = e.type === 'pointerup' && performance.now() - tap.at < TAP_TIME && !tap.floated;
          tap = null;
          if (tapped) this.tapView();
        }
      }
      if (!drag || e.pointerId !== drag.id) return;
      try { input.releasePointerCapture(e.pointerId); } catch {}
      // Out of a pinch, the finger still down carries on the drag.
      const [rest] = touches.entries();
      if (rest) {
        drag = { id: rest[0], x: rest[1].x, y: rest[1].y, button: 0 };
        return;
      }
      drag = null;
      if (lockHeld()) document.exitPointerLock();
      input.classList.remove('dragging');
      camera().looking = false;
    };
    // A lift that throws still ends the drag: a camera left `looking` never
    // springs back to his view.
    const lift = e => {
      if (quietly(`the view's ${e.type}`, () => { end(e); return true; })) return;
      drag = null;
      touches.clear();
      pinch = 0;
      tap = null;
      input.classList.remove('dragging');
      camera().looking = false;
    };
    input.addEventListener('pointerup', lift);
    input.addEventListener('pointercancel', lift);
    input.addEventListener('contextmenu', e => e.preventDefault());
    on('wheel', e => {
      e.preventDefault();
      this.activity();
      const scale = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
      camera().wheel((e.deltaY * scale) / 100);
      // Wheeling out of first person leaves it for the orbit.
      this.syncMode();
    }, { passive: false });
    // Any mouse move over the view brings the chrome back, and the pointer
    // resting on the bar or the card keeps it up. A finger does neither: a
    // tap is what brings the chrome back on a touch screen.
    this.onStageMove = e => {
      if (e.pointerType === 'touch') return;
      this.touchUi = false;
      this.userHidden = false;
      this.activity();
      this.overChrome = Boolean(e.target?.closest?.('.rp-bar, .rp-card'));
    };
    this.stage.addEventListener('pointermove', this.onStageMove);
    // Name tags follow on a click.
    this.tags.addEventListener('click', e => {
      const tag = e.target.closest?.('.rp-tag');
      if (!tag) return;
      e.stopPropagation();
      quietly('following a player', () => this.follow(Number(tag.dataset.pid)));
    });
  }

  /** The menus and anything else that floats close on a click away: true
   *  when one was open. */
  closeFloating() {
    const open = this.speedWrap.classList.contains('open') || this.moreWrap.classList.contains('open')
      || this.root.matches('.board-open, .help-open, .map-open');
    this.speedWrap.classList.remove('open');
    this.closeMore();
    this.root.classList.remove('board-open', 'help-open');
    this.playersBtn.classList.remove('on');
    this.player.highlights?.map.close();
    return open;
  }

  /** A tap on the view (a touch screen): the chrome slides away, or back;
   *  out of the hidden interface, everything comes back. */
  tapView() {
    if (this.root.classList.contains('rp-bare')) this.setBare(false);
    else this.userHidden = !this.chromeHidden;
    this.activity();
    this.syncChrome();
  }

  // --- the free camera's thumbstick (touch) ------------------------------------------

  /** A finger down on the left of the view, with the free camera on, is the
   *  thumbstick's: the camera flies the way it pushes (replay-camera.js
   *  `stick`), while another finger looks. */
  startStick(e, floated) {
    const camera = this.player.camera;
    if (camera.mode !== 'free' || this.stick) return false;
    const r = this.stage.getBoundingClientRect();
    if (e.clientX - r.left > r.width * STICK_ZONE) return false;
    this.stick = { id: e.pointerId, x: e.clientX, y: e.clientY, at: performance.now(), moved: 0, floated };
    try { this.input.setPointerCapture(e.pointerId); } catch {}
    camera.stick = { x: 0, y: 0 };
    this.stickEl.classList.remove('home');
    this.stickEl.classList.add('on');
    this.stickEl.style.transform = `translate(${(e.clientX - r.left).toFixed(1)}px, ${(e.clientY - r.top).toFixed(1)}px)`;
    this.stickKnob.style.transform = '';
    return true;
  }

  moveStick(e) {
    const s = this.stick;
    if (!s || e.pointerId !== s.id) return false;
    let dx = e.clientX - s.x;
    let dy = e.clientY - s.y;
    const d = Math.hypot(dx, dy);
    s.moved = Math.max(s.moved, d);
    if (d > STICK_R) {
      dx *= STICK_R / d;
      dy *= STICK_R / d;
    }
    this.stickKnob.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
    // Up the screen is ahead.
    if (this.player.camera.stick) this.player.camera.stick = { x: dx / STICK_R, y: -dy / STICK_R };
    return true;
  }

  /** The thumb lifted: the camera stops. One that went down and up without
   *  pushing was a tap on the view. */
  endStick(e) {
    const s = this.stick;
    if (!s || e.pointerId !== s.id) return false;
    this.dropStick();
    if (e.type === 'pointerup' && s.moved < TAP_SLOP && performance.now() - s.at < TAP_TIME && !s.floated) this.tapView();
    return true;
  }

  dropStick() {
    const s = this.stick;
    if (!s) return;
    this.stick = null;
    this.player.camera.stick = null;
    this.stickEl.classList.remove('on');
    this.stickKnob.style.transform = '';
    try { this.input.releasePointerCapture(s.id); } catch {}
  }

  /** Where the stick waits while the free camera is on a touch screen: low
   *  on the left, over the bar while the bar is up, and over the card too
   *  where the card reaches that far left (a phone held upright). */
  placeStickHome() {
    const home = this.coarse && !this.stick && this.player.camera.mode === 'free' && !this.root.classList.contains('rp-bare');
    this.stickEl.classList.toggle('home', home);
    if (!home) return;
    const x = STICK_R + 28;
    let clear = 0;
    if (!this.chromeHidden) {
      clear = (this.barH ?? 0) + 10;
      if (((this.stageW ?? 0) - (this.cardW ?? 0)) / 2 < x + STICK_R + 8) clear += (this.cardH ?? 0) + 12;
    }
    const y = (this.stageH ?? 0) - clear - STICK_R - 30;
    const at = `translate(${x}px, ${Math.round(y)}px)`;
    if (this.stickEl.style.transform !== at) this.stickEl.style.transform = at;
  }

  bindKeys() {
    // Capture phase on the window: the replay's keys are read before the
    // play page's own handler (page-input.js, on the window's bubble), and
    // the page never sees a key while a replay is up -- WASD moves nothing,
    // Caps Lock and Enter open no spawn screen, F1..F8 send no radio. The
    // console, the Escape menu and the briefing keep the keyboard while they
    // are up, as they do in play.
    this.onKeyDown = e => {
      if (this.disposed || quietly('the keyboard', () => this.ctx.keyboardTaken?.())) return;
      if (GameConsole.isToggleKey(e)) return;
      quietly('the chrome', () => this.activity());
      const inForm = /^(INPUT|SELECT|TEXTAREA)$/.test(e.target?.tagName ?? '');
      // A key whose action throws is still the replay's, and Escape still
      // goes on to the page's own menu: the way out of the replay is never
      // behind something of the replay's that broke.
      const handled = inForm && e.code !== 'Escape' ? false
        : quietly(`the ${e.code} key`, () => this.key(e)) ?? (e.code === 'Escape' ? 'pass' : true);
      if (handled === 'pass') return;
      e.stopPropagation();
      if (handled) e.preventDefault();
    };
    this.onKeyUp = e => {
      if (this.disposed) return;
      this.player.camera?.keys?.delete(e.code);
      if (quietly('the keyboard', () => this.ctx.keyboardTaken?.())) return;
      e.stopPropagation();
    };
    this.onBlur = () => this.player.camera?.keys?.clear();
    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('keyup', this.onKeyUp, true);
    window.addEventListener('blur', this.onBlur);
  }

  /** One key: true when the replay took it, false when it means nothing
   *  here (the page still never sees it), 'pass' for the page's Escape. */
  key(e) {
    const player = this.player;
    const camera = player.camera;
    const once = !e.repeat;
    const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
    if (!plain) return false;
    // The shortcuts by the character, wherever a layout puts it.
    if (e.key === '?') {
      if (once) this.toggle('help-open');
      return true;
    }
    // The creator view's keys (features/replay-creator-view), then the battle
    // map, the markers, the Auto camera and the reel's.
    const mine = player.creator?.key(e, once);
    if (mine !== undefined) return mine;
    const taken = player.highlights?.key(e, once);
    if (taken !== undefined) return taken;
    switch (e.code) {
      case 'Space': if (once) this.togglePlay(); return true;
      case 'ArrowLeft': this.skip(e.shiftKey ? -15 : -5); return true;
      case 'ArrowRight': this.skip(e.shiftKey ? 15 : 5); return true;
      case 'ArrowUp': if (once) this.stepPlayer(-1); return true;
      case 'ArrowDown': if (once) this.stepPlayer(1); return true;
      case 'Comma': if (once) this.stepChapter(-1, e.shiftKey); return true;
      case 'Period': if (once) this.stepChapter(1, e.shiftKey); return true;
      case 'Minus': case 'NumpadSubtract': if (once) this.stepSpeed(-1); return true;
      case 'Equal': case 'NumpadAdd': if (once) this.stepSpeed(1); return true;
      case 'Home': player.seek(0); return true;
      case 'End': player.seek(player.rec.duration); return true;
      case 'Digit1': case 'Numpad1': if (once) this.setMode('orbit'); return true;
      case 'Digit2': case 'Numpad2': if (once) this.setMode('pov'); return true;
      case 'Digit3': case 'Numpad3': if (once) this.setMode('free'); return true;
      case 'KeyC':
        if (once) {
          // In an aircraft the first person goes on from the cockpit to the
          // nose cam before the next camera.
          if (this.uiMode() === 'pov' && camera.povView === 'cockpit' && camera.sight?.nose) {
            this.setMode('pov');
            return true;
          }
          const cycle = ['orbit', 'pov', 'free', 'auto'];
          this.setMode(cycle[(cycle.indexOf(this.uiMode()) + 1) % cycle.length]);
        }
        return true;
      case 'KeyW': case 'KeyA': case 'KeyS': case 'KeyD': case 'KeyQ': case 'KeyE':
        camera.keys.add(e.code);
        return true;
      case 'ShiftLeft': case 'ShiftRight':
        camera.keys.add(e.code);
        return false;
      case 'KeyR': if (once) { camera.resetOrbit(); this.flash('Behind'); } return true;
      case 'Tab': if (once) this.toggle('board-open'); return true;
      case 'KeyL': if (once) this.toggle('log-open'); return true;
      case 'KeyN': if (once) this.toggleTags(); return true;
      case 'KeyH': if (once) this.setBare(!this.root.classList.contains('rp-bare')); return true;
      // The frame on screen as the cover; fullscreen is the bar's button.
      case 'KeyF':
        if (once) {
          if (this.frameKey) this.frameKey();
          else this.flash('Covers are for recordings in the REPLAY feed', 2400);
        }
        return true;
      case 'Escape': {
        const open = ['help-open', 'board-open'].find(c => this.root.classList.contains(c))
          || (this.speedWrap.classList.contains('open') ? 'speed' : null)
          || (this.moreWrap.classList.contains('open') ? 'more' : null)
          || (this.root.classList.contains('rp-bare') ? 'rp-bare' : null);
        if (!open) return 'pass';
        if (open === 'speed') this.speedWrap.classList.remove('open');
        else if (open === 'more') this.closeMore();
        else if (open === 'rp-bare') this.setBare(false);
        else this.root.classList.remove(open);
        this.playersBtn.classList.remove('on');
        return true;
      }
      default:
        // F1..F8 are the radio in play; here they mean nothing, and must not
        // reach the browser's help or reload either.
        return /^F[1-8]$/.test(e.code);
    }
  }

  // --- the log panel ------------------------------------------------------------------

  status(text) {
    this.statusText.textContent = text;
    // While the vehicles load, the card says so.
    if (!this.rowNodes) this.loadingText = text;
  }

  renderFeed() {
    this.loadingText = null;
    this.list.textContent = '';
    this.rowNodes = this.player.rows.map(row => {
      const node = el('div', `rp-row k-${row.kind}`);
      node.append(el('time', '', fmtTime(row.t)), el('span', `rp-src ${row.source}`, row.source), el('span', 'rp-text', row.text));
      node.addEventListener('click', () => quietly('a log line', () => this.player.seek(row.t - 1.5)));
      this.list.appendChild(node);
      return node;
    });
    this.currentRow = -1;
    this.applyRowFilter();
  }

  applyRowFilter() {
    if (!this.rowNodes) return;
    this.player.rows.forEach((row, i) => {
      this.rowNodes[i].classList.toggle('hidden', row.source === 'server' && !this.player.showServer);
    });
  }

  updateLog(t) {
    if (!this.rowNodes) return;
    const rows = this.player.rows;
    let index = -1;
    let lo = 0;
    let hi = rows.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (rows[mid].t <= t) { index = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (index === this.currentRow) return;
    const from = Math.min(index, this.currentRow) + 1;
    const to = Math.max(index, this.currentRow);
    for (let i = Math.max(0, from - 1); i <= to && i < rows.length; i++) {
      if (i >= 0) this.rowNodes[i].classList.toggle('past', i <= index);
    }
    if (this.currentRow >= 0) this.rowNodes[this.currentRow]?.classList.remove('current');
    if (index >= 0) this.rowNodes[index].classList.add('current');
    this.currentRow = index;
    if (this.root.classList.contains('log-open') && !this.list.matches(':hover')) this.scrollLogToCurrent();
  }

  scrollLogToCurrent() {
    this.rowNodes?.[this.currentRow]?.scrollIntoView({ block: 'nearest' });
  }

  // --- per frame ---------------------------------------------------------------------

  update(t, dt = 0.016) {
    const player = this.player;
    const rec = player.rec;
    if (this.shownPlaying !== player.playing) {
      this.shownPlaying = player.playing;
      const label = player.playing ? 'Pause (Space)' : 'Play (Space)';
      this.playBtn.innerHTML = svg(player.playing ? 'pause' : 'play');
      this.playBtn.title = label;
      this.playBtn.setAttribute('aria-label', label);
    }
    const timeText = `<b>${fmtClock(t)}</b> <span>/ ${fmtClock(rec.duration)}</span>`;
    if (this.timeHtml !== timeText) {
      this.timeHtml = timeText;
      this.timeText.innerHTML = timeText;
    }
    const clock = roundClock(rec, t);
    const round = clock === null ? '' : `ROUND ${fmtClock(clock)}`;
    if (this.roundText.textContent !== round) this.roundText.textContent = round;
    // Each part of the chrome on its own (`quietly`): the name tags that
    // cannot be placed leave the clock, the card and the board working.
    quietly('the timeline', () => this.timeline.update(t));
    const mini = this.timeline.shownAt;
    if (mini !== this.miniAt) {
      this.miniAt = mini;
      this.miniFill.style.width = mini;
    }
    quietly('the replay log', () => this.updateLog(t));

    this.slowClock += dt;
    if (this.slowClock >= SLOW_TICK) {
      this.slowClock = 0;
      quietly("the followed player's card", () => this.renderCard(t));
      if (this.root.classList.contains('board-open')) quietly('the board', () => this.renderBoard(false));
    }
    quietly('the name tags', () => this.updateTags(t));
    quietly('the chrome', () => this.syncChrome());
    // The thumbstick is the free camera's alone.
    if (this.stick && player.camera.mode !== 'free') this.dropStick();
    if (this.coarse) this.placeStickHome();
  }

  /** The bar and the card, up or away. They go while it plays untouched,
   *  and on a tap on the view; paused, while the followed player waits to
   *  spawn (the card's countdown), or while his first person is out of the
   *  recording's range (the view holds where he was last seen, and without
   *  the card's word for it that read as the replay hanging), they stay
   *  unless a tap put them away. A menu or a panel open holds them up. */
  syncChrome() {
    const root = this.root;
    const open = root.matches('.board-open, .help-open, .map-open')
      || this.speedWrap.classList.contains('open') || this.moreWrap.classList.contains('open');
    if (open) this.userHidden = false;
    const quiet = (performance.now() - this.lastActivity) / 1000 > (this.touchUi ? IDLE_TOUCH : IDLE_AFTER);
    const idle = this.player.playing && quiet && !this.overChrome && !this.spawnWait && !this.rangeWait;
    const hidden = !open && !this.timeline.scrubbing && (this.userHidden || idle);
    if (hidden === this.chromeHidden) return;
    this.chromeHidden = hidden;
    root.classList.toggle('rp-idle', hidden);
    if (hidden) this.timeline.hideTip();
  }

  /** The followed player: who, his side, and what he is doing. */
  renderCard(t) {
    const player = this.player;
    const rec = player.rec;
    const pid = player.followPid;
    if (pid === null) {
      this.cardName.textContent = 'Nobody to follow';
      this.cardState.textContent = '';
      this.spawnWait = false;
      this.rangeWait = false;
      return;
    }
    // Whoever holds the pid now, on his side now: an id passes to the next
    // player to join once its own leaves.
    const team = teamAt(rec, pid, t);
    const name = nameAt(rec, pid, t);
    if (this.cardName.dataset.key !== `${pid}|${team}|${name}`) {
      this.cardName.dataset.key = `${pid}|${team}|${name}`;
      this.cardName.textContent = name;
      // A recording player: his first person is his recording's own view,
      // hit indicator and all.
      if (isRecordingPlayer(player, pid)) {
        const badge = el('span', 'rp-card-rec', 'REC');
        badge.title = 'A recording player: first person is his own view';
        this.cardName.append(badge);
      }
      this.cardName.className = `rp-card-name t${team}`;
    }
    // The side's flag sprite, once the HUD pack has it.
    const flag = this.ctx.teamFlag?.(team) ?? null;
    this.cardFlag.classList.toggle('none', !flag);
    if (flag && this.cardFlag.src !== flag) this.cardFlag.src = flag;
    const status = playerStatusAt(rec, pid, t, player.kills);
    // Not in the round yet, on the spawn screen or dead: when the recording
    // has him spawn next.
    const waiting = status.state === 'absent' || status.state === 'spawning' || status.state === 'dead';
    const spawn = waiting ? nextSpawn(rec, pid, t)?.t ?? null : null;
    this.spawnWait = spawn !== null;
    this.rangeWait = Boolean(status.outOfRange) && player.camera.mode === 'pov';
    let html = '';
    let hp = null;
    const display = key => this.lexicon()?.names?.[key] ?? key;
    switch (status.state) {
      case 'foot': {
        const kit = status.life.kitTemplate ? player.kitClass(status.life.kitTemplate) : null;
        const weapon = player.heldWeapon(status.life, t);
        html = esc([kit, weapon ? display(weapon) : null].filter(Boolean).join(' / ') || 'on foot');
        break;
      }
      case 'vehicle': {
        const life = status.life;
        const hull = player.hulls.get(life);
        html = esc(`${display(life.tmpl)} / ${seatRole(hull, status.seat)}`);
        if (hull && life.maxhp > 0 && hull.hp !== null) hp = { hp: hull.hp, max: life.maxhp, crit: life.crit };
        break;
      }
      case 'dead': {
        const k = status.killedBy;
        const by = k && k.killer !== null && k.killer !== undefined && k.killer !== pid
          ? `killed by ${nameAt(rec, k.killer, k.t)}${k.weapon ? ` [${display(k.weapon)}]` : ''}`
          : 'dead';
        html = `<span class="dead">${esc(by)}</span>`;
        break;
      }
      case 'spawning': html = spawn === null ? 'spawn screen' : ''; break;
      case 'left': html = 'left the game'; break;
      default: html = spawn === null ? 'not in the round yet' : '';
    }
    if (spawn !== null) {
      html += `<span class="spawn" title="Spawns at ${fmtClock(spawn)}">`
        + `${status.state === 'dead' ? 'respawns' : 'spawns'} in <b>${fmtClock(Math.ceil(spawn - t))}</b></span>`;
    }
    // Beyond the recording players' view distance the server sends nothing,
    // and the replay holds his last pose as a ghost until he is back.
    if (status.outOfRange) {
      const since = status.outOfRange.since;
      const whose = (player.recordingPids?.length ?? 0) > 1 ? "every recording player's" : "the recording player's";
      html += `<span class="range" title="Beyond ${whose} view distance: the server sent no updates, so this is where he was last seen">`
        + `out of range${since !== null ? ` since ${fmtTime(since)}` : ''}</span>`;
    }
    if (this.loadingText) html = esc(this.loadingText);
    else if (player.highlights && (status.state === 'foot' || status.state === 'vehicle')) {
      html += streakMark(player.highlights.streakOf(pid, t));
      if (player.highlights.leaderAt(t)?.pid === pid) html += leaderMark();
    }
    if (hp) {
      const k = Math.max(0, Math.min(1, hp.hp / hp.max));
      const cls = hp.crit > 0 && hp.hp <= hp.crit ? 'fire' : hp.hp <= hp.max / 2 ? 'smoke' : '';
      html += `<span class="rp-hp ${cls}" title="${fmtHp(Math.round(hp.hp * 10) / 10)} / ${fmtHp(hp.max)}"><i style="width:${(k * 100).toFixed(1)}%"></i></span>`;
    }
    if (this.cardHtml !== html) {
      this.cardHtml = html;
      this.cardState.innerHTML = html;
    }
  }

  /** The scoreboard: both sides, kills and deaths so far, who is where. */
  renderBoard(force) {
    const player = this.player;
    const rec = player.rec;
    const t = player.time;
    const tally = tallyAt(player.kills, t, rec);
    const display = key => this.lexicon()?.names?.[key] ?? key;
    // Anyone without a side sits under the Allies.
    const rows = { 1: [], 2: [] };
    for (const p of rosterOf(rec, t)) {
      const status = playerStatusAt(rec, p.pid, t, player.kills);
      const score = tally.get(p.pid) ?? { kills: 0, deaths: 0 };
      rows[p.team === 1 ? 1 : 2].push({ ...p, status, ...score });
    }
    const highlights = player.highlights;
    const leader = highlights?.leaderAt(t)?.pid ?? null;
    for (const team of [1, 2]) for (const r of rows[team]) r.streak = highlights?.streakOf(r.pid, t) ?? 0;
    const key = JSON.stringify([player.followPid, leader, [1, 2].map(team => rows[team].map(r => [r.pid, r.status.state, r.status.life?.tmpl ?? '', r.kills, r.deaths, r.streak]))]);
    if (!force && key === this.boardKey) return;
    this.boardKey = key;
    for (const team of [1, 2]) {
      const box = this.teams[team];
      const list = rows[team].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || a.name.localeCompare(b.name));
      const flag = this.ctx.teamFlag?.(team) ?? null;
      box.flag.hidden = !flag;
      if (flag && box.flag.src !== flag) box.flag.src = flag;
      box.count.textContent = String(list.reduce((n, r) => n + r.kills, 0));
      box.count.title = 'kills';
      box.rows.textContent = '';
      for (const r of list) {
        const row = el('button', `rp-brow ${r.status.state}${r.pid === player.followPid ? ' me' : ''}`);
        row.type = 'button';
        row.dataset.pid = String(r.pid);
        const st = el('span', 'st');
        st.innerHTML = r.status.state === 'dead' ? svg('dead') : r.status.state === 'vehicle' ? svg('vehicle') : '';
        const where = r.status.state === 'vehicle' ? display(r.status.life.tmpl)
          : r.status.state === 'dead' ? 'dead' : r.status.state === 'spawning' ? 'spawning'
            : r.status.state === 'left' ? 'left' : r.status.state === 'foot' ? 'on foot' : '';
        const nm = el('span', 'nm', r.name);
        if (isRecordingPlayer(player, r.pid)) nm.append(el('span', 'rp-card-rec', 'REC'));
        if (r.pid === leader || r.streak >= 2) nm.insertAdjacentHTML('beforeend', `${r.pid === leader ? leaderMark() : ''}${streakMark(r.streak)}`);
        row.append(st, nm, el('span', 'vh', where), el('span', '', String(r.kills)), el('span', '', String(r.deaths)));
        box.rows.append(row);
      }
    }
  }

  /** Names over the players near the camera, and over the followed player
   *  while the orbit is on him; a click follows one. */
  updateTags(t) {
    const seen = new Set();
    const player = this.player;
    if (this.showTags && !this.root.classList.contains('rp-bare')) {
      const camera = this.ctx.camera;
      // The stage's size as `measure` keeps it: read here, after the frame's
      // own writes to the bar, it forced a layout every frame.
      const width = this.stageW ?? this.stage.clientWidth;
      const height = this.stageH ?? this.stage.clientHeight;
      const v = player.v2;
      const hideOwn = player.camera.hidePid;
      // Through his eyes, only his side's names, as the game tags friends.
      const ownTeam = hideOwn !== null ? teamAt(player.rec, hideOwn, t) || null : null;
      const orbit = player.camera.mode === 'orbit';
      const candidates = [];
      for (const target of player.tagTargets(t)) {
        // Not over the head the first-person camera is inside.
        if (hideOwn !== null && target.pids?.includes(hideOwn)) continue;
        if (ownTeam !== null && target.team !== ownTeam) continue;
        const me = Boolean(target.pids?.includes(player.followPid));
        v.copy(target.at);
        const distance = v.distanceTo(camera.position);
        // Only the players round the camera carry a name: whole close to it,
        // fading out further off.
        const reach = target.vehicle ? TAG_VEHICLE : 1;
        const fade = me && orbit ? 1
          : 1 - Math.min(1, Math.max(0, (distance - TAG_NEAR * reach) / ((TAG_FAR - TAG_NEAR) * reach)));
        if (fade < 0.05) continue;
        v.project(camera);
        if (!(v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05)) continue;
        candidates.push({ target, distance, fade, x: ((v.x + 1) / 2) * width, y: ((1 - v.y) / 2) * height });
      }
      candidates.sort((a, b) => a.distance - b.distance);
      const highlights = player.highlights;
      const leader = highlights?.leaderAt(t)?.pid ?? null;
      for (const { target, fade, x, y } of candidates.slice(0, TAG_MAX)) {
        seen.add(target.key);
        let tag = this.tagNodes.get(target.key);
        if (!tag) {
          tag = el('button', 'rp-tag');
          tag.type = 'button';
          tag.append(el('span', 'nm'), el('span', 'rp-hp'));
          tag.lastChild.append(el('i'));
          this.tags.append(tag);
          this.tagNodes.set(target.key, tag);
        }
        const me = Boolean(target.pids?.includes(player.followPid));
        const streak = target.pid !== null && target.pid !== undefined ? highlights?.streakOf(target.pid, t) ?? 0 : 0;
        const lead = target.pid !== null && target.pid === leader;
        const text = `${target.name}${target.extra ? ` ${target.extra}` : ''}|${streak}|${lead}`;
        if (tag.dataset.text !== text) {
          tag.dataset.text = text;
          tag.firstChild.textContent = target.name;
          if (lead || streak >= 2) tag.firstChild.insertAdjacentHTML('beforeend', `${lead ? leaderMark() : ''}${streakMark(streak)}`);
          if (target.extra) tag.firstChild.append(el('small', '', ` ${target.extra}`));
        }
        tag.dataset.pid = String(target.pid ?? '');
        tag.disabled = target.pid === null || target.pid === undefined;
        const cls = `rp-tag t${target.team}${me ? ' me' : ''}`;
        if (tag.className !== cls) tag.className = cls;
        const bar = tag.lastChild;
        if (target.hp) {
          bar.style.display = '';
          const k = Math.max(0, Math.min(1, target.hp.hp / target.hp.max));
          bar.firstChild.style.width = `${(k * 100).toFixed(1)}%`;
          bar.classList.toggle('fire', target.hp.crit > 0 && target.hp.hp <= target.hp.crit);
          bar.classList.toggle('smoke', target.hp.hp <= target.hp.max / 2 && !(target.hp.crit > 0 && target.hp.hp <= target.hp.crit));
        } else {
          bar.style.display = 'none';
        }
        tag.style.opacity = fade.toFixed(2);
        tag.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
        if (tag.style.display) tag.style.display = '';
      }
    }
    for (const [key, tag] of this.tagNodes) {
      if (!seen.has(key) && tag.style.display !== 'none') tag.style.display = 'none';
    }
  }

  dispose() {
    this.disposed = true;
    window.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('keyup', this.onKeyUp, true);
    window.removeEventListener('blur', this.onBlur);
    this.stage.removeEventListener('pointermove', this.onStageMove);
    document.removeEventListener('fullscreenchange', this.onFullscreen);
    document.removeEventListener('webkitfullscreenchange', this.onFullscreen);
    this.dropStick();
    this.sizes.disconnect();
    this.timeline.dispose();
    if (document.pointerLockElement === this.input) document.exitPointerLock();
    this.root.remove();
    const html = document.documentElement;
    html.classList.remove('replay-on', 'replay-bare', 'replay-sight');
    if (this.addedShell) html.classList.remove('shell-playing');
  }
}
