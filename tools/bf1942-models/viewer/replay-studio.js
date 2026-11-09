// The creator studio (features/replay-creator-view, "The studio"): the clip
// edited full screen, the way an editor is laid out. The 3D view itself is
// the monitor, shaped to the frame the clip is made in (16:9, 9:16, 1:1,
// 2.39:1) and set between a top bar, an inspector on the right and the
// clip's strip docked below with a transport over it. What is drawn over
// the footage -- the look, the text, the fades and the flash
// (replay-studio-fx.js) -- is drawn over the view as it will be recorded,
// and a recording takes the view full size, in its frame, with the panels
// out of the way.
//
// The inspector's tabs: Kills (the round's kills worth a clip), Camera
// (camera recipes, the clip's cameras with how each moves and takes over,
// bullet time, the lens), Look (one-click recipes, the grade, the vignette,
// the frame), Text (a title, a lower third that writes itself from the kill,
// a channel tag), Effects (fades, and the flash, zoom punch, shake and freeze
// as the round hits; the slow motion) and Export (record, a thumbnail, the
// kept clips). Under the monitor a tray of what can go on the clip --
// cameras, slow motion, text, effects -- to drag onto the strip
// (features/replay-creator-view, "Cameras on the strip"). Every change is
// one step of undo.

import { FOV_RANGE, fmt } from './replay-creator-panel.js';
import { moveIcon } from './replay-clipbar.js';
import { AB_MOVES, CAM_RECIPES, CAMS, HAND_OVERS, MOTIONS, camGlyph, camLabel, camTitle, camsFor, holdsEnd } from './replay-cuts.js';
import { RAMP_SPEEDS, screenSeconds, speedWord } from './replay-shot.js';
import { FADES, FRAMES, FREEZES, FX_WORDS, GRADES, drawOverlay, drawSafeArea, editsOf, editsShow, fxMoments, gradeOf } from './replay-studio-fx.js';
import { StudioTour } from './replay-studio-tour.js';

/** The game's outside views the Game view button names (replay-camera.js
 *  `EXTERNAL_LABELS`, in F10-F12's order). */
const GAME_VIEWS = Object.freeze({ chase: 'Chase', front: 'Front chase', flyby: 'Fly-by' });

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** The frame's aspect, width over height, or null for the whole view. */
export const FRAME_ASPECT = Object.freeze({ 169: 16 / 9, 916: 9 / 16, 11: 1, 239: 2.39, 185: 1.85 });

/**
 * The monitor's box inside the space the studio leaves it (`area`, CSS px:
 * { x, y, w, h }), the largest of the frame's aspect, centred; the whole
 * area for the whole view.
 */
export function monitorBox(area, frame) {
  const aspect = FRAME_ASPECT[frame];
  if (!aspect) return { ...area };
  let w = area.w;
  let h = w / aspect;
  if (h > area.h) {
    h = area.h;
    w = h * aspect;
  }
  w = Math.floor(w);
  h = Math.floor(h);
  return { x: Math.round(area.x + (area.w - w) / 2), y: Math.round(area.y + (area.h - h) / 2), w, h };
}

/**
 * One-click recipes: a set of edits and a frame at once (one undo step).
 * `[id, label, title, edits, frame]`; the edits are merged over what is
 * there, so the clip's own words stay.
 */
export const RECIPES = Object.freeze([
  ['clean', 'Clean', 'Natural colour, no text, no effects', {
    grade: 'none', vignette: 0, fadeIn: 0, fadeOut: 0, flash: false, punch: false, shake: false, freeze: 0,
  }, null],
  ['cinema', 'Cinematic', 'Graded, letterboxed, faded in and out, a title', {
    grade: 'cinematic', vignette: 0.45, fadeIn: 1, fadeOut: 1, flash: false, punch: false, shake: false, freeze: 0, title: { on: true },
  }, '239'],
  ['frag', 'Frag movie', 'Vivid, flash, punch and shake on the kill, the lower third', {
    grade: 'vivid', vignette: 0.25, fadeIn: 0.5, fadeOut: 0.5, flash: true, punch: true, shake: true, freeze: 0, feed: true, lower: { on: true },
  }, '169'],
  ['shorts', 'Shorts', 'Vertical 9:16, punchy, the lower third and your tag', {
    grade: 'vivid', vignette: 0.2, fadeIn: 0, fadeOut: 0.5, flash: true, punch: true, shake: false, freeze: 0.5, lower: { on: true }, tag: { on: true },
  }, '916'],
  ['noir', 'Noir', 'Black and white, a freeze on the kill', {
    grade: 'bw', vignette: 0.6, fadeIn: 1, fadeOut: 1, flash: false, punch: false, shake: false, freeze: 1,
  }, '169'],
]);

/** The edits a recipe makes of `edits`: its own fields over them, text
 *  switched on keeping its words. */
export function applyRecipe(edits, recipe) {
  const next = editsOf(edits);
  for (const [k, v] of Object.entries(recipe)) {
    if (v && typeof v === 'object') next[k] = { ...next[k], ...v };
    else next[k] = v;
  }
  if (next.title.on && !next.title.text) next.title.text = 'Kill of the round';
  return editsOf(next);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** The tray's words for the cameras: short enough for one row. */
const TRAY_WORDS = Object.freeze({
  shoulder: 'Shoulder', chase: 'Chase', orbit: '360', incoming: 'From victim', victim: 'Circle victim', free: 'Replay cam',
});

const TABS = Object.freeze([
  ['kills', 'Kills'],
  ['camera', 'Camera'],
  ['look', 'Look'],
  ['text', 'Text'],
  ['fx', 'Effects'],
  ['montage', 'Montage'],
  ['clips', 'Export'],
]);

/** Sizes the studio leaves the monitor, CSS px. */
const TOP_H = 52;
const SIDE_W = 356;
const DOCK_H = 270;
const GAP = 12;

export class Studio {
  constructor(creator) {
    this.creator = creator;
    this.open = false;
    this.recording = false;
    this.tab = 'look';
    this.syncs = [];
    this.sig = '';
    this.keySig = '';
    this.clipSig = '';
    injectStyle();
    // The overlay over the view, for the clip editor and the studio alike.
    const stage = creator.ui.root.parentElement;
    this.stage = stage;
    this.ov = el('canvas', 'st-ov');
    this.tint = el('div', 'st-tint');
    stage.insertBefore(this.ov, creator.ui.root);
    stage.insertBefore(this.tint, creator.ui.root);
    this.ovCtx = this.ov.getContext('2d');
    this.ovSize = { w: stage.clientWidth, h: stage.clientHeight };
    this.sizes = new ResizeObserver(entries => {
      for (const e of entries) this.ovSize = { w: e.contentRect.width, h: e.contentRect.height };
      if (this.open) this.place();
    });
    this.sizes.observe(stage);
    this.onWindow = () => { if (this.open) this.place(); };
    addEventListener('resize', this.onWindow);
    // Undo and redo while a clip is edited. The replay's keys take no
    // Ctrl or Cmd chord, so these are caught here; inside a text box the
    // browser's own undo of the words stays.
    this.onKey = e => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || (e.code !== 'KeyZ' && e.code !== 'KeyY')) return;
      if (!creator.on || !creator.editing) return;
      if (e.target?.closest?.('input, textarea, select, [contenteditable]')) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      if (e.code === 'KeyY' || e.shiftKey) creator.redo();
      else creator.undo();
    };
    addEventListener('keydown', this.onKey, true);
    this.drawn = false;
  }

  // --- opening and closing ------------------------------------------------------------------------

  toggle() {
    if (this.open) this.close();
    else this.show();
  }

  /** The studio open on the clip on the strip (a new one round the playhead
   *  when there is none). */
  show() {
    const creator = this.creator;
    if (this.open) return;
    if (!creator.on) creator.toggle(true);
    if (!creator.on) return;
    if (!creator.span) creator.newClip();
    else creator.openEditor();
    if (!creator.span) return;
    this.build();
    this.open = true;
    const ui = creator.ui;
    this.wasBare = ui.root.classList.contains('rp-bare');
    if (!this.wasBare) ui.setBare(true);
    if (creator.prefs.frame === 'none' || !FRAMES.some(([id]) => id === creator.prefs.frame)) creator.setPref('frame', '169');
    document.documentElement.classList.add('replay-studio');
    document.body.append(this.back, this.el);
    // The clip's strip docks under the monitor while the studio is open.
    this.stripHome = creator.clipbar.el.parentElement;
    this.stripNext = creator.clipbar.el.nextSibling;
    this.stripHost.append(creator.clipbar.el);
    creator.clipbar.el.classList.add('studio');
    this.place();
    this.refresh(true);
    creator.clipbar.fit();
    creator.clipbar.sync(creator.player.time, true);
    ui.flash('Studio · click a camera on the strip to change it, drag from the tray, Esc to leave', 3200);
    // Not over a shared edit just opened from a link: the tour makes a clip
    // of its own, and would take the edit's place. Help still has it.
    if (!creator.sharedFrom) this.withTour(tour => tour.offer());
  }

  /** The tour (replay-studio-tour.js), made the first time it is wanted; an
   *  optional layer, so a fault in it never reaches the studio. */
  withTour(fn) {
    try {
      this.tour ??= new StudioTour(this);
      fn(this.tour);
    } catch (error) {
      console.warn('studio: the tour', error);
    }
  }

  close() {
    if (!this.open) return;
    const creator = this.creator;
    if (creator.recorder) creator.stopRecording(false);
    if (this.tour?.running) this.withTour(tour => tour.end(false));
    this.open = false;
    this.setRecording(false);
    document.documentElement.classList.remove('replay-studio');
    this.back.remove();
    this.el.remove();
    const bar = creator.clipbar.el;
    bar.classList.remove('studio');
    if (this.stripHome) this.stripHome.insertBefore(bar, this.stripNext ?? null);
    for (const p of ['left', 'top', 'width', 'height']) this.stage.style.removeProperty(p);
    if (!this.wasBare) creator.ui.setBare(false);
    creator.clipbar.closePop();
    creator.clipbar.sync(creator.player.time, true);
  }

  dispose() {
    this.close();
    this.tour?.dispose();
    if (this.onClearOutside) document.removeEventListener('pointerdown', this.onClearOutside, true);
    this.sizes.disconnect();
    removeEventListener('resize', this.onWindow);
    removeEventListener('keydown', this.onKey, true);
    this.ov.remove();
    this.tint.remove();
    this.setGrade(null);
  }

  /** The monitor's box: the space between the panels, in the frame's shape;
   *  the whole window, in the frame's shape, while recording. */
  place() {
    const W = innerWidth;
    const H = innerHeight;
    const area = this.recording
      ? { x: 0, y: 0, w: W, h: H }
      : { x: GAP, y: TOP_H + GAP / 2, w: Math.max(200, W - SIDE_W - GAP * 3), h: Math.max(150, H - TOP_H - DOCK_H - GAP * 1.5) };
    const box = monitorBox(area, this.creator.prefs.frame);
    const s = this.stage.style;
    s.left = `${box.x}px`;
    s.top = `${box.y}px`;
    s.width = `${box.w}px`;
    s.height = `${box.h}px`;
    if (this.sizeText) this.sizeText.textContent = this.outputSize();
  }

  /** What a recording will measure, device pixels, in the frame. */
  outputSize() {
    const ratio = devicePixelRatio || 1;
    const box = monitorBox({ x: 0, y: 0, w: innerWidth, h: innerHeight }, this.creator.prefs.frame);
    const w = Math.floor((box.w * ratio) / 2) * 2;
    const h = Math.floor((box.h * ratio) / 2) * 2;
    return `${w} x ${h}`;
  }

  // --- recording --------------------------------------------------------------------------------

  /** Record from the studio: the view full size in its frame first, then
   *  the recording once the renderer has taken that size. */
  record({ montage = false } = {}) {
    const creator = this.creator;
    if (creator.recorder) {
      creator.stopRecording(true);
      return;
    }
    const go = () => (montage ? creator.recordMontage() : creator.record());
    if (!this.open) {
      go();
      return;
    }
    this.setRecording(true);
    let frames = 0;
    const wait = () => {
      if (++frames < 3) {
        requestAnimationFrame(wait);
        return;
      }
      go();
      if (!creator.recorder) this.setRecording(false);
    };
    requestAnimationFrame(wait);
  }

  setRecording(on) {
    if (this.recording === on) return;
    this.recording = on;
    document.documentElement.classList.toggle('st-rec', on);
    if (this.open) this.place();
  }

  recordingEnded() {
    this.setRecording(false);
    this.refresh(true);
  }

  // --- keys -----------------------------------------------------------------------------------

  /** The studio's keys over the replay's: play and pause the clip, a frame
   *  at a time, its two ends. */
  key(e, once) {
    if (!this.open || this.recording) return false;
    const creator = this.creator;
    const player = creator.player;
    const span = creator.span;
    if (!span) return false;
    switch (e.code) {
      case 'Space':
        if (once) this.playPause();
        return true;
      case 'ArrowLeft':
      case 'ArrowRight':
        this.step(e.code === 'ArrowLeft' ? -1 : 1, e.shiftKey ? 10 : 1);
        return true;
      case 'Home':
        if (once) { player.playing = false; player.seek(span.t0); }
        return true;
      case 'End':
        if (once) { player.playing = false; player.seek(span.t1); }
        return true;
      default:
        return false;
    }
  }

  playPause() {
    const creator = this.creator;
    const player = creator.player;
    if (player.playing) {
      player.playing = false;
      creator.rangePlaying = false;
    } else if (creator.part) {
      creator.startPart();
    } else {
      const span = creator.span;
      const t = player.time;
      // From the playhead when it is inside the clip and past its start;
      // a take's camera needs its start.
      if (span && t > span.t0 + 0.05 && t < span.t1 - 0.05 && !creator.autoFilms(span)) creator.playFrom(t);
      else creator.playRange();
    }
  }

  /** A frame (1/30 s of the round) or `n` of them, paused. */
  step(dir, n = 1) {
    const creator = this.creator;
    const player = creator.player;
    const span = creator.span;
    player.playing = false;
    creator.rangePlaying = false;
    const lo = creator.clipbar.window?.w0 ?? span.t0;
    const hi = creator.clipbar.window?.w1 ?? span.t1;
    player.seek(clamp(player.time + (dir * n) / 30, lo, hi));
  }

  // --- per frame ----------------------------------------------------------------------------------

  /** Each frame: the overlay over the view and the grade on it while a clip
   *  is edited, and the studio's clock. */
  frame(t) {
    const creator = this.creator;
    const show = creator.on && Boolean(creator.editing) && !creator.recorder && (editsShow(creator.edits) || creator.edits.safe);
    this.setGrade(creator.on && creator.editing && !creator.recorder ? creator.edits.grade : null);
    if (show) this.drawOverlay(t);
    else if (this.drawn) this.clearOverlay();
    if (!this.open) return;
    const span = creator.span;
    if (!span) {
      this.close();
      return;
    }
    // Seconds of the video, slow motion played out, as the strip is laid out.
    const rel = creator.screenAt(t, span);
    const clock = `${rel < 0 ? '-' : ''}${fmt(Math.abs(rel))} / ${fmt(creator.screenLength(span))}`;
    if (this.clock.textContent !== clock) this.clock.textContent = clock;
    const where = `round ${fmt(t)}`;
    if (this.where.textContent !== where) this.where.textContent = where;
    const speed = creator.player.speed;
    const speedText = !creator.player.playing ? (creator.frozen ? 'freeze' : 'paused') : speed >= 0.999 ? '1x' : `${speedWord(speed)} speed`;
    if (this.speedText.textContent !== speedText) this.speedText.textContent = speedText;
    const play = creator.player.playing ? 'Pause' : 'Play';
    if (this.playBtn.dataset.state !== play) {
      this.playBtn.dataset.state = play;
      this.playBtn.title = `${play} (Space)`;
      this.playBtn.replaceChildren(icon(play === 'Play' ? 'play' : 'pause'));
    }
    this.recBtn.classList.toggle('on', Boolean(creator.recorder));
    const recWord = creator.recorder ? 'Stop' : 'Record';
    if (this.recBtn.lastChild.textContent !== recWord) this.recBtn.lastChild.textContent = recWord;
    if (this.recording && this.recLabel) {
      const r = creator.recorder;
      const part = r?.count > 1 ? ` · clip ${r.count - (r.queue?.length ?? 0)} of ${r.count}` : '';
      this.recLabel.textContent = r?.started ? `REC ${r.paused ? 'next clip' : `${fmt(Math.max(0, t - r.t0))} / ${fmt(r.t1 - r.t0)}`}${part}` : 'REC · getting ready';
    }
    const cam = creator.rounds.active || creator.track ? 'clip' : creator.ui.uiMode?.() ?? creator.player.camera.mode;
    if (this.camMode !== cam) {
      this.camMode = cam;
      // The game's views light one button, named for the one on.
      const lit = GAME_VIEWS[cam] ? 'game' : cam;
      for (const [id, b] of Object.entries(this.camBtns)) b.classList.toggle('on', id === lit);
      this.camBtns.game.textContent = GAME_VIEWS[cam] ?? 'Game view';
      this.hint.textContent = cam === 'free'
        ? 'WASD fly · drag to look · Q / E down, up · K makes the view a camera'
        : 'Click a camera to change it · drag from the tray onto the strip';
    }
    this.undoBtn.disabled = !creator.history.undo.length;
    this.redoBtn.disabled = !creator.history.redo.length;
    this.refresh();
  }

  setGrade(id) {
    const canvas = this.creator.ctx.renderer?.domElement;
    const g = id ? gradeOf(id) : null;
    const filter = g?.[2] ?? '';
    if (canvas && canvas.style.filter !== filter) canvas.style.filter = filter;
    const tint = g?.[3] ?? '';
    if (this.tint.dataset.tint !== tint) {
      this.tint.dataset.tint = tint;
      this.tint.style.background = tint || 'none';
      this.tint.hidden = !tint;
    }
  }

  /** The text, vignette, flash and fades over the view, inside the frame. */
  drawOverlay(t) {
    const ratio = devicePixelRatio || 1;
    const w = Math.max(1, Math.round(this.ovSize.w * ratio));
    const h = Math.max(1, Math.round(this.ovSize.h * ratio));
    if (this.ov.width !== w || this.ov.height !== h) {
      this.ov.width = w;
      this.ov.height = h;
    }
    const creator = this.creator;
    const ctx = this.ovCtx;
    ctx.clearRect(0, 0, w, h);
    const aspect = FRAME_ASPECT[creator.prefs.frame];
    const box = aspect ? monitorBox({ x: 0, y: 0, w, h }, creator.prefs.frame) : { x: 0, y: 0, w, h };
    // The tint is the overlay's own layer (`st-tint`, soft-light over the view).
    drawOverlay(ctx, box, creator.overlayState(t), { grade: null, vignette: creator.edits.vignette });
    // The safe area is a guide over the monitor, never in the recording.
    if (creator.edits.safe) drawSafeArea(ctx, box);
    this.drawn = true;
  }

  clearOverlay() {
    this.ovCtx.clearRect(0, 0, this.ov.width, this.ov.height);
    this.drawn = false;
  }

  // --- the panels -------------------------------------------------------------------------------

  build() {
    if (this.el) return;
    const creator = this.creator;
    this.back = el('div', 'st-back');
    const root = el('div', 'st');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Clip studio');

    // The top bar.
    const top = el('header', 'st-top');
    const brand = el('div', 'st-brand');
    brand.append(el('b', '', 'Studio'));
    this.titleText = el('span', 'st-name', '');
    brand.append(this.titleText);
    this.undoBtn = this.btn('Undo', 'Undo (Ctrl+Z)', () => creator.undo(), 'st-ghost', 'undo');
    this.redoBtn = this.btn('Redo', 'Redo (Ctrl+Shift+Z)', () => creator.redo(), 'st-ghost', 'redo');
    this.clearBtn = this.btn('Clear', 'Start the clip over: its cameras, or everything', () => this.toggleClear(), 'st-ghost', 'clear');
    this.clearMenu = el('div', 'st-menu');
    this.clearMenu.hidden = true;
    for (const [label, title, all] of [
      ['Clear the cameras', 'The kill shot\'s own cameras again; slow motion, look, text and effects stay', false],
      ['Clear everything', 'Cameras, slow motion, look, text and effects: the clip as Kill shot made it', true],
    ]) {
      const item = el('button', 'st-menuitem');
      item.type = 'button';
      item.title = title;
      item.append(el('b', '', label), el('small', '', title));
      item.addEventListener('click', e => {
        e.stopPropagation();
        this.toggleClear(false);
        try { creator.clearClip({ all }); } catch (error) { console.warn('studio: clearing', error); }
        this.refresh(true);
      });
      this.clearMenu.append(item);
    }
    this.onClearOutside = e => {
      if (!this.clearMenu.hidden && !this.clearMenu.contains(e.target) && !this.clearBtn.contains(e.target)) this.toggleClear(false);
    };
    document.addEventListener('pointerdown', this.onClearOutside, true);
    const frames = this.seg(FRAMES.filter(([id]) => id !== 'none').map(([id, label]) => [id, label.split(' · ')[0], label]),
      () => creator.prefs.frame, v => {
        creator.setPref('frame', v);
        creator.saveKept();
        this.place();
      }, 'st-frames');
    this.thumbBtn = this.btn('Thumbnail', 'Save this frame as a PNG, for the video\'s thumbnail', () => creator.thumbnail(), 'st-ghost', 'image');
    this.recBtn = this.btn('Record', 'Record the clip to a video file, full size in its frame (Esc stops)', () => this.record(), 'st-rec-btn', 'rec');
    const done = this.btn('', 'Leave the studio (Esc)', () => this.close(), 'st-ghost st-close', 'close');
    const help = this.btn('Help', 'How the studio works', () => this.toggleHelp(), 'st-ghost', 'help');
    const clearWrap = el('span', 'st-menuwrap');
    clearWrap.append(this.clearBtn, this.clearMenu);
    top.append(brand, this.undoBtn, this.redoBtn, clearWrap, el('span', 'st-gap'), frames, this.thumbBtn, this.recBtn, help, done);

    // The inspector.
    const side = el('aside', 'st-side');
    const tabs = el('nav', 'st-tabs');
    tabs.setAttribute('role', 'tablist');
    this.tabBtns = {};
    this.pages = {};
    const body = el('div', 'st-body');
    for (const [id, label] of TABS) {
      const b = el('button', 'st-tab', label);
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.addEventListener('click', () => this.setTab(id));
      this.tabBtns[id] = b;
      tabs.append(b);
      const page = el('section', 'st-page');
      page.setAttribute('role', 'tabpanel');
      this.pages[id] = page;
      body.append(page);
    }
    side.append(tabs, body);
    this.buildKills(this.pages.kills);
    this.buildCamera(this.pages.camera);
    this.buildLook(this.pages.look);
    this.buildText(this.pages.text);
    this.buildFx(this.pages.fx);
    this.buildMontage(this.pages.montage);
    this.buildClips(this.pages.clips);

    // The dock: the transport over the clip's strip.
    const dock = el('section', 'st-dock');
    const transport = el('div', 'st-transport');
    const toStart = this.btn('', 'To the clip\'s start (Home)', () => { creator.player.playing = false; creator.player.seek(creator.span.t0); }, 'st-ghost', 'start');
    const back = this.btn('', 'A frame back (Left; Shift: ten)', () => this.step(-1), 'st-ghost', 'stepback');
    this.playBtn = this.btn('', 'Play (Space)', () => this.playPause(), 'st-play', 'play');
    const fwd = this.btn('', 'A frame on (Right; Shift: ten)', () => this.step(1), 'st-ghost', 'step');
    const toEnd = this.btn('', 'To the clip\'s end (End)', () => { creator.player.playing = false; creator.player.seek(creator.span.t1); }, 'st-ghost', 'end');
    this.clock = el('span', 'st-clock', '');
    this.where = el('span', 'st-where', '');
    this.speedText = el('span', 'st-speed', '');
    const key = this.btn('Camera here', 'Your camera from the playhead on: the view on screen (K)', () => creator.cameraHere(), 'st-ghost', 'camera');
    this.hint = el('span', 'st-hint', 'Click a camera to change it · drag from the tray onto the strip');
    // Which camera is on the monitor: the clip's own, or one taken by hand
    // through the replay's own buttons (which let the clip's camera go).
    const cams = el('div', 'st-seg st-cams');
    this.camBtns = {};
    for (const [id, label, title] of [
      ['clip', 'Clip camera', 'The clip\'s own camera: its shot style and keyframes, from its start (P)'],
      ['orbit', 'Orbit', 'Round the player followed; drag to swing (1)'],
      ['pov', 'Their eyes', 'First person (2)'],
      ['free', 'Free fly', 'Fly anywhere: WASD to move, drag to look, Q and E down and up (3)'],
      ['game', 'Game view', 'The game\'s own cameras on what they drive: chase, front chase, fly-by; click again for the next (F10-F12)'],
    ]) {
      const b = el('button', 'st-segbtn', label);
      b.type = 'button';
      b.title = title;
      b.addEventListener('click', e => {
        e.stopPropagation();
        try {
          if (id === 'clip') {
            creator.takeHeld = false;
            creator.playRange();
          } else if (id === 'game') this.nextGameView();
          else creator.ui.modeBtns?.[id]?.click();
        } catch (error) { console.warn('studio: a camera', error); }
      });
      this.camBtns[id] = b;
      cams.append(b);
    }
    transport.append(toStart, back, this.playBtn, fwd, toEnd, this.clock, this.where, this.speedText, el('span', 'st-gap'), this.hint, cams, key);
    this.stripHost = el('div', 'st-strip');
    dock.append(transport, this.buildTray(), this.stripHost);

    // While recording: only a chip with the time and Stop.
    const recbar = el('div', 'st-recbar');
    this.recLabel = el('span', '', 'REC');
    recbar.append(this.recLabel, this.btn('Stop', 'Stop and save (Esc)', () => creator.stopRecording(true), 'st-rec-btn on', 'rec'));

    // While the montage plays: which clip of how many, over the monitor.
    const montageBar = el('div', 'st-montagebar');
    montageBar.hidden = true;
    const montageWords = el('span', 'st-montagewords', '');
    montageBar.append(el('b', '', 'MONTAGE'), montageWords, this.btn('Stop', 'Stop the montage and stay on this clip (Esc)', () => {
      creator.stopMontage();
      creator.player.playing = false;
    }, 'st-small', 'close'));
    this.syncs.push(() => {
      const m = creator.montage;
      montageBar.hidden = !m;
      if (m) montageWords.textContent = `${m.i + 1} of ${m.list.length} · ${m.list[m.i]?.name ?? ''}`;
    });

    this.help = this.buildHelp();
    root.append(top, side, dock, recbar, montageBar, this.help);
    this.el = root;
    this.setTab(this.tab);
  }

  /** The Game view button: the chase first, then round the game's views
   *  (F10-F12, replay-ui.js `cameraKey`), skipping one his seat or his feet
   *  refuse. Taking one lets the clip's camera go, as the other buttons do. */
  nextGameView() {
    const creator = this.creator;
    if (creator.rounds.active || creator.track) creator.stopRigs();
    const camera = creator.player.camera;
    const keys = Object.keys(GAME_VIEWS);
    const allowed = camera.outsideModesAt?.(creator.player.time);
    const order = allowed ? keys.filter(m => allowed.includes(m)) : keys;
    // Nothing allowed: the chase's key says why.
    if (!order.length) return creator.ui.cameraKey(2);
    const mode = order[(order.indexOf(camera.mode) + 1) % order.length];
    creator.ui.cameraKey(2 + keys.indexOf(mode));
  }

  // --- the tray ---------------------------------------------------------------------------------

  /**
   * What can go on the clip, under the monitor: the cameras, slow motion,
   * a title and a lower third, the effects on the hit. Each drags onto the
   * strip -- a camera films from where it lands to the next hand-over, slow
   * motion slows from there, text starts there, an effect goes off as the
   * round hits -- or, clicked, goes at the playhead.
   */
  buildTray() {
    const creator = this.creator;
    const tray = el('div', 'st-tray');
    tray.append(el('span', 'st-tray-label', 'Drag onto the strip'));
    // More chips than fit (1440 px wide, the 2026-11-09 audit lost Hit
    // effects off the right with no sign of it): the right edge fades until
    // the tray is scrolled to its end.
    const fade = () => {
      tray.classList.toggle('more', tray.scrollLeft + tray.clientWidth < tray.scrollWidth - 2);
      tray.classList.toggle('more-left', tray.scrollLeft > 2);
    };
    tray.addEventListener('scroll', fade, { passive: true });
    // The wheel over the tray scrolls it along (it has no height to scroll).
    tray.addEventListener('wheel', e => {
      if (tray.scrollWidth <= tray.clientWidth + 2) return;
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      tray.scrollLeft += d;
      e.preventDefault();
    }, { passive: false });
    if (typeof ResizeObserver === 'function') new ResizeObserver(fade).observe(tray);
    requestAnimationFrame(fade);
    this.trayCams = new Map();
    const group = (title, items) => {
      const g = el('div', 'st-tray-group');
      g.append(el('span', 'st-tray-head', title));
      for (const it of items) g.append(this.trayChip(it));
      tray.append(g);
      return g;
    };
    const kill = () => creator.fxKill.kill;
    // Let go on the kill (the drop line snaps to it), an effect is the
    // kill's; let go anywhere else, it goes off there, as many as wanted.
    const onKill = t => kill() !== null && Math.abs(t - kill()) < 1e-6;
    group('Speed', [
      { id: 'slow', label: 'Slow-mo', title: 'Slow motion at 1/4 from where it lands, a second of the round. Drop it again for another stretch', glyph: 'fx:slow', lane: 'speed',
        drop: t => creator.addSlow(t, Math.min(creator.span.t1, t + 1), 0.25) },
      { id: 'freeze', label: 'Freeze', title: 'The picture held a second: on the kill when let go there, else where it lands', glyph: 'fx:freeze', lane: 'fx', at: kill,
        drop: t => (onKill(t) ? creator.setEdit('freeze', 1) : creator.addFx('freeze', t, 1)) },
    ]);
    group('Text', [
      { id: 'title', label: 'Title', title: 'A title over the middle of the frame, from where it lands. Drop it again for another', glyph: 'txt:title', lane: 'text',
        drop: t => creator.addText('title', t) },
      { id: 'lower', label: 'Lower third', title: 'Who, with what, whom and how far, from where it lands. Drop it again for another, with words of its own', glyph: 'txt:lower', lane: 'text',
        drop: t => creator.addText('lower', t) },
    ]);
    group('Effects', [
      { id: 'hitfx', label: 'Hit effects', title: 'A flash, a zoom punch and a shake: on the kill when let go there (each on its own on the Effects tab), else where it lands',
        glyph: 'fx:flash', lane: 'fx', at: kill,
        drop: t => (onKill(t) ? creator.setEdits({ flash: true, punch: true, shake: true }, 'Hit effects on') : creator.addFx(['flash', 'punch', 'shake'], t)) },
    ]);
    // The cameras last: there are twelve, and what a narrow tray cuts off
    // is the tail of them, which the Camera lane's right-click offers too
    // (the 2026-11-09 audit lost Hit effects off the right at 1440 px).
    group('Camera', CAMS.map(([id, label, title, glyph]) => ({
      id: `cam:${id}`, label: TRAY_WORDS[id] ?? label, name: label, title: `${label}: ${title}. Drag onto the strip: it films from there to the next change`,
      glyph, lane: 'camera', drop: t => creator.addCamAt(t, id), cam: id,
    })));
    this.syncs.push(() => {
      const span = creator.span;
      const take = span && creator.autoFilms(span) ? creator.takeInside(span) : null;
      const usable = new Set(camsFor(take));
      for (const [id, chip] of this.trayCams) chip.hidden = !usable.has(id);
    });
    return tray;
  }

  /** One of the tray's chips: dragged, it lands where it is let go on the
   *  strip; clicked, at the playhead. */
  trayChip(it) {
    const creator = this.creator;
    const chip = el('button', 'st-chip');
    chip.type = 'button';
    chip.title = it.title;
    chip.dataset.tray = it.id;
    const glyph = moveIcon(it.glyph);
    if (glyph) chip.append(glyph);
    chip.append(el('span', '', it.label));
    if (it.cam) this.trayCams.set(it.cam, chip);
    const bar = () => creator.clipbar;
    const landAt = (x, y) => {
      if (it.at) {
        // An effect let go near the hit is the hit's (the drop line snaps
        // to it); let go elsewhere on the strip it goes off there.
        const r = bar().strip.getBoundingClientRect();
        const kill = it.at();
        const over = x >= r.left - 4 && x <= r.right + 4 && y >= r.top - 40 && y <= r.bottom + 12;
        if (!over) {
          bar().showDrop(null);
          return null;
        }
        const t = bar().timeAt(x);
        if (kill !== null && Math.abs(bar().sx(t) - bar().sx(kill)) < 0.6) {
          bar().showDrop(kill, it.lane, `${it.label} · as the round hits`);
          return kill;
        }
        return bar().dragOver(x, y, it.lane, `${it.label} · here`);
      }
      return bar().dragOver(x, y, it.lane, it.label);
    };
    chip.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const x0 = e.clientX;
      const y0 = e.clientY;
      let ghost = null;
      let t = null;
      const move = ev => {
        if (!ghost && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return;
        if (!ghost) {
          ghost = chip.cloneNode(true);
          ghost.className = 'st-chip st-chip-ghost';
          this.el.append(ghost);
          chip.classList.add('dragging');
        }
        ghost.style.transform = `translate(${ev.clientX + 10}px, ${ev.clientY - 14}px)`;
        t = landAt(ev.clientX, ev.clientY);
        ghost.classList.toggle('over', t !== null);
      };
      const up = ev => {
        chip.removeEventListener('pointermove', move);
        chip.removeEventListener('pointerup', up);
        chip.removeEventListener('pointercancel', up);
        chip.classList.remove('dragging');
        bar().showDrop(null);
        bar().showSnap(null);
        const dragged = Boolean(ghost);
        ghost?.remove();
        try {
          if (dragged) {
            if (ev.type === 'pointerup' && t !== null) it.drop(t);
          } else {
            // Clicked: at the playhead, inside the clip; an effect of the
            // kill's goes on the kill.
            const span = creator.span;
            const kill = it.at ? it.at() : null;
            if (span) it.drop(kill !== null ? kill : Math.min(span.t1, Math.max(span.t0, creator.player.time)));
          }
        } catch (error) { console.warn('studio: the tray', error); }
        this.refresh(true);
        creator.clipbar?.sync(creator.player.time, true);
      };
      try { chip.setPointerCapture(e.pointerId); } catch {}
      chip.addEventListener('pointermove', move);
      chip.addEventListener('pointerup', up);
      chip.addEventListener('pointercancel', up);
    });
    // The keyboard's way in: Enter or Space puts it at the playhead.
    chip.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      e.stopPropagation();
      const span = creator.span;
      try {
        if (span) it.drop(Math.min(span.t1, Math.max(span.t0, creator.player.time)));
      } catch (error) { console.warn('studio: the tray', error); }
      this.refresh(true);
    });
    return chip;
  }

  /** Clear's two choices, under it. */
  toggleClear(on = this.clearMenu.hidden) {
    this.clearMenu.hidden = !on;
  }

  get helpOpen() {
    return Boolean(this.help && !this.help.hidden);
  }

  toggleHelp(on = !this.helpOpen) {
    if (this.help) this.help.hidden = !on;
  }

  /** The studio's own help: a clip in a minute, the kill shot's camera, the
   *  timeline's grammar and the keys (features/replay-creator-view,
   *  STUDIO_GUIDE.md has the whole of it). */
  buildHelp() {
    const box = el('div', 'st-help');
    box.hidden = true;
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Studio help');
    const card = el('div', 'st-help-card');
    const head = el('div', 'st-help-head');
    const tour = this.btn('Take the tour', 'A kill from this round made into a clip, a step at a time', () => this.withTour(t => t.begin()), 'st-tourbtn', 'play');
    head.append(el('b', '', 'How the studio works'), tour, this.btn('', 'Close help (Esc)', () => this.toggleHelp(false), 'st-ghost st-icon', 'close'));
    const col = (title, items) => {
      const c = el('section', 'st-help-col');
      c.append(el('h3', '', title));
      const list = el('ol');
      for (const line of items) list.append(el('li', '', line));
      c.append(list);
      return c;
    };
    const keys = el('section', 'st-help-col');
    keys.append(el('h3', '', 'Keys'));
    const table = el('dl', 'st-help-keys');
    for (const [k, v] of [['Space', 'play or pause'], ['Left / Right', 'a frame (Shift: ten)'], ['Home / End', 'the clip\'s ends'],
      ['K', 'the view a camera of yours'], ['Enter', 'use this view (placing)'], ['WASD, Q, E', 'fly (Free fly, placing)'], ['F10-F12', 'the game\'s chase, front chase, fly-by'],
      ['Ctrl+Z', 'undo (Shift: redo)'], ['Esc', 'close, stop, leave']]) {
      table.append(el('dt', '', k), el('dd', '', v));
    }
    keys.append(table);
    const grid = el('div', 'st-help-grid');
    grid.append(
      col('A clip in a minute', [
        'Kill shot on a kill (the round\'s timeline, or the Kills tab) opens it here, filmed and looping.',
        'Look: pick a recipe. Frag movie and Shorts are good starts.',
        'Export: Record the clip. It plays once and downloads.',
        'Keep the clip, open the next kill, and the Montage tab plays the kept clips together and records them as one video.',
      ]),
      col('Cameras', [
        'The Camera lane is the clip\'s cameras in a row: over their shoulder, the bullet chase from the shot, the player it killed.',
        'Each has a camera icon at its start: click it to set the camera yourself (fly it, Use this view). Dashed means automatic.',
        'Your camera can have an end camera (the + at its end): it moves there by Glide, Orbit, 360 or Whip. Drag it to when it should get there; it holds it after.',
        'Right-click the Camera lane to start a new camera there: the chase again after your end camera, say.',
        'Click a camera to swap it or Loop it. Drag the gold line between two to change when; click its glyph for Cut, Glide or Whip.',
        'Every change loops the part it changed. Whole clip (or Play) plays all of it again; Clear starts over.',
        'Game chase, Game front chase and Game fly-by are the game\'s own cameras (F10-F12) on the shooter or what they drive.',
      ]),
      col('The timeline', [
        'It is laid out in seconds of the video: bullet time takes the room it takes on screen.',
        'Click goes there; drag scrubs. The monitor shows the clip\'s camera there.',
        'Drag from the tray onto the strip: cameras, slow-mo, text, effects. A click puts it at the playhead.',
        'Drag a thing to move it; drag its ends to resize it. Right-click a lane for more.',
        'Wheel zooms, Shift-wheel pans; drags snap to the shot, the hit and the hand-overs.',
        'Cutting to music? Right-click the Kill mark, Land the hit at a time of the video, type 0:41: the clip\'s start moves so the hit lands there. Drag the clip\'s start instead and the slow motion\'s speed is worked out. Add the song on the strip\'s Music lane to hear it and see its beats.',
      ]),
      keys,
    );
    card.append(head, grid, el('p', 'st-note', 'The full guide is STUDIO_GUIDE.md in features/replay-creator-view.'));
    box.append(card);
    box.addEventListener('pointerdown', e => {
      if (e.target === box) this.toggleHelp(false);
    });
    return box;
  }

  setTab(id) {
    this.tab = id;
    for (const [tid, b] of Object.entries(this.tabBtns)) {
      b.classList.toggle('on', tid === id);
      b.setAttribute('aria-selected', String(tid === id));
      this.pages[tid].hidden = tid !== id;
    }
    this.refresh(true);
  }

  /** The Text tab with the title's (`title`) or the lower third's words in
   *  hand. */
  focus(which) {
    if (!this.open) this.show();
    this.setTab('text');
    const input = which === 'lower' ? this.lowerInput : which === 'title' ? this.titleInput : this.textInputs?.get(which);
    requestAnimationFrame(() => {
      input?.focus();
      input?.select();
    });
  }

  /** The panels from the clip as it stands: every control's own sync, the
   *  keyframes and kept clips rebuilt when they changed. */
  refresh(force = false) {
    if (!this.open || !this.el) return;
    const creator = this.creator;
    const sig = [creator.snapshot(), creator.prefs.pace, creator.prefs.thirds, creator.lens.fov, creator.lens.roll, creator.timing()?.sig,
      creator.clips.length, this.tab, creator.take?.f?.t, creator.takeHeld, this.momentMode, creator.player.followPid, creator.placing?.i].join('|');
    if (!force && sig === this.sig) return;
    this.sig = sig;
    for (const fn of this.syncs) {
      try { fn(); } catch (error) { console.warn('studio: a control', error); }
    }
    const take = creator.fxKill.take;
    const lines = creator.lowerLines();
    this.titleText.textContent = take ? `Kill shot · ${lines?.[0] ?? ''}${lines?.[1] ? ` · ${lines[1]}` : ''}` : 'Clip';
    this.syncCams(force);
    this.syncClips(force);
    this.syncMoments(force);
  }

  // --- controls -------------------------------------------------------------------------------

  btn(label, title, fn, cls = '', glyph = null) {
    const b = el('button', `st-btn ${cls}`.trim());
    b.type = 'button';
    b.title = title;
    if (!label) b.setAttribute('aria-label', title);
    if (glyph) b.append(icon(glyph));
    if (label) b.append(el('span', '', label));
    b.addEventListener('click', e => {
      e.stopPropagation();
      try { fn(); } catch (error) { console.warn('studio:', error); }
      this.refresh(true);
    });
    return b;
  }

  /** A row of choices: `[value, label, title?, glyph?]`. One in a list that
   *  is rebuilt (`live` false) is set once, not kept in step. */
  seg(items, get, set, cls = '', { live = true } = {}) {
    const row = el('div', `st-seg ${cls}`.trim());
    const buttons = items.map(([value, label, title, glyph]) => {
      const b = el('button', 'st-segbtn');
      b.type = 'button';
      if (title) b.title = title;
      if (glyph) {
        const g = moveIcon(glyph) ?? icon(glyph);
        if (g) b.append(g);
      }
      b.append(el('span', '', label));
      b.addEventListener('click', e => {
        e.stopPropagation();
        try { set(value); } catch (error) { console.warn('studio:', error); }
        this.refresh(true);
      });
      row.append(b);
      return [value, b];
    });
    const sync = () => {
      const now = get();
      for (const [value, b] of buttons) {
        b.classList.toggle('on', value === now);
        b.setAttribute('aria-pressed', String(value === now));
      }
    };
    if (live) this.syncs.push(sync);
    else sync();
    return row;
  }

  check(label, get, set, title = '') {
    const row = el('label', 'st-toggle');
    const box = el('input');
    box.type = 'checkbox';
    box.addEventListener('change', () => {
      set(box.checked);
      this.refresh(true);
    });
    row.append(box, el('span', '', label));
    if (title) row.title = title;
    this.syncs.push(() => { box.checked = Boolean(get()); });
    return row;
  }

  slider(label, min, max, step, get, set, show) {
    const row = el('label', 'st-slider');
    const name = el('span', '', label);
    const out = el('output', '', '');
    const input = el('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.addEventListener('input', () => {
      set(Number(input.value));
      out.textContent = show(Number(input.value));
    });
    row.append(name, input, out);
    this.syncs.push(() => {
      const v = get();
      if (document.activeElement !== input) input.value = String(v);
      out.textContent = show(v);
    });
    return row;
  }

  textInput(label, get, set, placeholder = '', max = 80) {
    const row = el('label', 'st-text');
    row.append(el('span', '', label));
    const input = el('input');
    input.type = 'text';
    input.maxLength = max;
    if (typeof placeholder === 'string') input.placeholder = placeholder;
    input.spellcheck = false;
    input.addEventListener('input', () => set(input.value));
    // The replay's keys stay out of the words being typed.
    input.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter' || e.key === 'Escape') input.blur();
    });
    input.addEventListener('keyup', e => e.stopPropagation());
    row.append(input);
    this.syncs.push(() => {
      if (document.activeElement !== input) input.value = get() ?? '';
      if (typeof placeholder === 'function') input.placeholder = placeholder();
    });
    return [row, input];
  }

  group(title, ...children) {
    const g = el('div', 'st-group');
    if (title) g.append(el('h3', '', title));
    g.append(...children.filter(Boolean));
    return g;
  }

  note(text) {
    return el('p', 'st-note', text);
  }

  // --- the tabs ---------------------------------------------------------------------------------

  /** The round's kills worth a clip (creator `moments`): best first (the
   *  longest shots, multi-kills well up), in the order they happened, or the
   *  followed man's. One opens as a kill shot, the studio's look kept. */
  buildKills(page) {
    const creator = this.creator;
    this.momentMode ??= 'best';
    const mode = this.seg([['best', 'Best'], ['time', 'In order'], ['his', 'Theirs']], () => this.momentMode, v => { this.momentMode = v; },
      'st-kills-mode');
    this.momentList = el('div', 'st-moments');
    page.append(
      this.group('The round\'s kills', mode, this.note('Each opens as a kill shot here, with the look, text and effects you have on. Keep the clip on Export, then the next.')),
      this.momentList,
    );
  }

  syncMoments(force) {
    if (!this.momentList || this.tab !== 'kills') return;
    const creator = this.creator;
    const take = creator.take ?? creator.takeInside?.();
    const pid = creator.player.followPid;
    const sig = [this.momentMode, take?.kill?.t, pid].join('|');
    if (!force && sig === this.momentSig) return;
    this.momentSig = sig;
    let list = creator.moments();
    if (this.momentMode === 'best') list = [...list].sort((a, b) => b.score - a.score || a.t - b.t);
    else if (this.momentMode === 'his') list = list.filter(m => m.killer === pid);
    this.momentList.textContent = '';
    if (!list.length) {
      this.momentList.append(this.note(this.momentMode === 'his' ? 'The man followed has no kill the recording ties a round to.' : 'No kill in this recording has its round.'));
      return;
    }
    for (const m of list.slice(0, 60)) {
      const row = el('button', 'st-moment');
      row.type = 'button';
      const current = take?.kill === m.kill;
      row.classList.toggle('on', current);
      row.title = current ? 'The clip on the strip' : 'Open this kill as a kill shot';
      row.dataset.t = String(m.t);
      const when = el('time', '', fmt(m.t));
      const who = el('span', 'st-mwho');
      who.append(el('b', '', m.killerName), el('i', '', ' → '), el('span', '', m.victimName));
      const what = el('span', 'st-mwhat', [m.weapon, m.distance ? `${m.distance} m` : null].filter(Boolean).join(' · '));
      const tags = el('span', 'st-mtags');
      if (m.multi > 1) tags.append(el('em', 'multi', `x${m.multi}`));
      if ((m.distance ?? 0) >= 100) tags.append(el('em', 'long', 'long'));
      if (m.from === 'vehicle') tags.append(el('em', '', 'vehicle'));
      const main = el('span', 'st-mmain');
      main.append(who, what);
      row.append(when, main, tags);
      row.addEventListener('click', () => {
        try {
          creator.killShotAt(m.t, m.victim);
          creator.clipbar?.fit();
        } catch (error) { console.warn('studio: a kill', error); }
        this.refresh(true);
      });
      this.momentList.append(row);
    }
  }

  buildCamera(page) {
    const creator = this.creator;
    // Camera recipes: a kill shot's cameras in one click.
    this.camRecipes = el('div', 'st-camrecipes');
    for (const [id, label, title, cams] of CAM_RECIPES) {
      const b = el('button', 'st-camrecipe');
      b.type = 'button';
      b.title = title;
      const strip = el('span', 'st-camstrip');
      for (const c of cams) {
        const cell = el('i', `c-${c.cam}`);
        const glyph = moveIcon(camGlyph(c.cam));
        if (glyph) cell.append(glyph);
        strip.append(cell);
      }
      b.append(strip, el('b', '', label), el('small', '', title));
      b.addEventListener('click', () => {
        try { creator.applyCamRecipe(id); } catch (error) { console.warn('studio: a camera recipe', error); }
        this.refresh(true);
      });
      this.camRecipes.append(b);
    }
    this.camList = el('div', 'st-cams-list');
    const here = this.btn('Your camera from the playhead', 'The view on screen as a camera of yours from the playhead on (K)', () => creator.cameraHere(), 'st-wide', 'camera');
    const pace = this.seg([['off', 'Off'], ['subtle', 'Subtle'], ['strong', 'Strong'], ['extreme', 'Extreme']],
      () => creator.prefs.pace, v => creator.setBulletTime(v));
    const fov = this.slider('Field of view', FOV_RANGE[0], FOV_RANGE[1], 1, () => creator.lens.fov ?? 70,
      v => creator.setFov(v), v => (creator.lens.fov === null ? 'auto' : `${Math.round(v)}°`));
    const roll = this.slider('Dutch roll', -30, 30, 1, () => creator.lens.roll, v => creator.setRoll(v), v => `${Math.round(v)}°`);
    const lensAuto = this.btn('Lens back to auto', 'The page\'s own field of view, no roll', () => {
      creator.setFov(null);
      creator.setRoll(0);
    }, 'st-ghost st-small');
    this.recipeGroup = this.group('Camera recipes', this.camRecipes,
      this.note('A whole kill shot\'s cameras in one click. Ctrl+Z takes it back.'));
    page.append(
      this.recipeGroup,
      this.group('The clip\'s cameras', this.camList, here,
        this.note('Each camera films its part of the clip. Click one on the strip, or pick here; drag the gold line between two on the strip to change when. Your camera: fly the view there and press Use this view.')),
      this.group('Bullet time', pace, this.note('How far a kill shot slows from the trigger to the hit.')),
      this.group('Lens', fov, roll, lensAuto, this.note('Your camera keeps the field of view it was placed with: zoom in before Use this view for a tight shot.')),
    );
  }

  /** The clip's cameras, one row each: what it is, its stretch in seconds of
   *  the video, how it takes over and how one of yours moves. */
  syncCams(force) {
    const creator = this.creator;
    const span = creator.span;
    if (!span || !this.camList) return;
    const take = creator.autoFilms(span) ? creator.takeInside(span) : null;
    this.recipeGroup.hidden = !take;
    const list = creator.camStretches(span);
    const sig = JSON.stringify(list.map(c => [c.cam, c.t0, c.t1, c.into, c.motion, c.move, c.tEnd, c.view?.pos, c.end?.pos])) + creator.keyShots.size + (take ? 1 : 0);
    if (!force && sig === this.camSig) return;
    this.camSig = sig;
    this.camList.textContent = '';
    const s0 = creator.screenAt(span.t0);
    const usable = camsFor(take);
    const select = (options, value, title, onChange) => {
      const pick = el('select', 'st-select');
      pick.title = title;
      for (const [id, label] of options) {
        const o = el('option', '', label);
        o.value = id;
        o.selected = id === value;
        pick.append(o);
      }
      pick.addEventListener('change', () => {
        try { onChange(pick.value); } catch (error) { console.warn('studio: a camera', error); }
        this.refresh(true);
      });
      pick.addEventListener('keydown', e => e.stopPropagation());
      return pick;
    };
    for (const c of list) {
      const row = el('div', `st-cam c-${c.cam}`);
      const n = el('button', 'st-camn', String(c.i + 1));
      n.type = 'button';
      n.title = 'Go to it';
      n.addEventListener('click', () => {
        creator.player.playing = false;
        creator.rangePlaying = false;
        creator.player.seek(c.t0 + Math.min(0.3, (c.t1 - c.t0) / 2));
      });
      let face;
      const shot = c.cam === 'placed' && c.view ? creator.keyShot(c.view) : null;
      if (shot) {
        face = el('canvas', 'st-keypic');
        face.width = 112;
        face.height = 63;
        face.getContext('2d').drawImage(shot, 0, 0, shot.width, shot.height, 0, 0, face.width, face.height);
      } else {
        face = el('span', 'st-camface');
        const glyph = moveIcon(camGlyph(c.cam));
        if (glyph) face.append(glyph);
      }
      face.title = camTitle(c.cam);
      const what = select(usable.map(id => [id, camLabel(id)]), c.cam, 'What films this part', v => creator.setCamAt(c.i, v));
      const when = el('span', 'st-keyt', `${fmt(Math.max(0, creator.screenAt(c.t0) - s0))} to ${fmt(Math.max(0, creator.screenAt(c.t1) - s0))}`);
      const line = el('div', 'st-camline');
      line.append(when);
      if (c.i > 0) {
        line.append(select(HAND_OVERS.map(([id, label]) => [id, `${label} in`]), c.into ?? 'cut', 'How it takes over from the camera before',
          v => creator.setHandOverAt(c.i, v)));
      }
      const main = el('div', 'st-cammain');
      main.append(what, line);
      const set = el('div', 'st-camline');
      set.append(
        this.btn(c.cam === 'placed' ? 'Camera' : 'Set camera', 'Fly it where you want it and Use this view', () => creator.placeCam(c.i, { which: 'start' }), 'st-ghost st-small', 'camera'),
        this.btn(c.end ? 'End' : 'Add end', 'An end camera it moves to over its part', () => creator.placeCam(c.i, { which: 'end' }), 'st-ghost st-small', 'end'),
        this.btn('Loop', 'Play this camera\'s part over and over', () => creator.loopPart({ kind: 'cam', i: c.i }), 'st-ghost st-small', 'loop'),
      );
      main.append(set);
      if (c.cam === 'placed') {
        const more = el('div', 'st-camline');
        if (c.end) {
          more.append(select(AB_MOVES.map(([id, label]) => [id, `${label} to its end camera`]), c.move ?? 'glide', 'How it goes from its camera to its end camera',
            v => creator.setAbMoveAt(c.i, v)));
          more.append(this.btn('', 'No end camera: hold its camera', () => creator.removeEndAt(c.i), 'st-ghost st-icon', 'close'));
          if (holdsEnd(c)) {
            const by = el('span', 'st-keyt', `there by ${fmt(Math.max(0, creator.screenAt(c.tEnd) - s0))}, then held`);
            by.title = 'Drag the end camera on the strip to change when it gets there';
            more.append(by);
          }
        } else {
          more.append(select(MOTIONS.map(([id, label]) => [id, label]), c.motion ?? 'still', 'How it moves while it films', v => creator.setMotionAt(c.i, v)));
        }
        main.append(more);
      }
      const drop = this.btn('', 'Take this camera away', () => creator.removeCamAt(c.i), 'st-ghost st-icon', 'close');
      drop.disabled = list.length <= 1;
      row.append(n, face, main, drop);
      this.camList.append(row);
    }
  }

  buildLook(page) {
    const creator = this.creator;
    const recipes = el('div', 'st-recipes');
    for (const [id, label, title, edits, frame] of RECIPES) {
      const b = el('button', 'st-recipe');
      b.type = 'button';
      b.title = title;
      b.dataset.recipe = id;
      const sw = el('i', `st-sw st-sw-${id}`);
      sw.style.filter = gradeOf(edits.grade)[2] || 'none';
      b.append(sw, el('b', '', label), el('small', '', title));
      b.addEventListener('click', () => {
        if (frame) creator.prefs.frame = frame;
        creator.edits = applyRecipe(creator.edits, edits);
        creator.savePrefs();
        creator.syncFrame();
        creator.saveKept();
        this.place();
        creator.clipbar?.sync(creator.player.time, true);
        creator.ui.flash(`${label} · Ctrl+Z to undo`, 1800);
        this.refresh(true);
      });
      recipes.append(b);
    }
    const grades = el('div', 'st-grades');
    const gradeBtns = GRADES.map(([id, label, filter, tint]) => {
      const b = el('button', 'st-grade');
      b.type = 'button';
      b.title = label;
      const sw = el('i', 'st-sw');
      sw.style.filter = filter || 'none';
      const t = el('i', 'st-swtint');
      if (tint) t.style.background = tint;
      sw.append(t);
      b.append(sw, el('span', '', label));
      b.addEventListener('click', () => {
        creator.setEdit('grade', id);
        this.refresh(true);
      });
      grades.append(b);
      return [id, b];
    });
    this.syncs.push(() => {
      for (const [id, b] of gradeBtns) b.classList.toggle('on', creator.edits.grade === id);
    });
    const vignette = this.slider('Vignette', 0, 1, 0.05, () => creator.edits.vignette, v => creator.setEdit('vignette', v, 'slide:vignette'), v => `${Math.round(v * 100)}%`);
    const frame = this.seg(FRAMES.map(([id, label]) => [id, label.split(' · ')[0], label]), () => creator.prefs.frame, v => {
      creator.setPref('frame', v);
      creator.saveKept();
      this.place();
    }, 'st-wrap');
    const thirds = this.check('Rule-of-thirds grid', () => creator.prefs.thirds, v => creator.setPref('thirds', v));
    const safe = this.check('Safe area', () => creator.edits.safe, v => creator.setEdit('safe', v),
      'Where the video player puts its own captions and buttons (vertical), or the title-safe box: a guide, never recorded');
    page.append(
      this.group('Recipes', recipes, this.note('One click sets the look, the frame and the effects together; Ctrl+Z takes it back.')),
      this.group('Colour', grades, vignette),
      this.group('Frame', frame, thirds, safe),
    );
  }

  buildText(page) {
    const creator = this.creator;
    const e = () => creator.edits;
    const titleOn = this.check('Title', () => e().title.on, v => {
      creator.setEdit('title', { ...e().title, on: v, text: e().title.text || (v ? 'Kill of the round' : '') });
    });
    const [titleRow, titleInput] = this.textInput('Words', () => e().title.text, v => creator.setEdit('title', { ...e().title, text: v, on: true }, 'type:title'), 'Kill of the round');
    this.titleInput = titleInput;
    const titleDur = this.slider('On screen', 1, 8, 0.1, () => e().title.dur, v => creator.setEdit('title.dur', v, 'slide:title'), v => `${v.toFixed(1)} s`);
    const lowerOn = this.check('Lower third', () => e().lower.on, v => creator.setEdit('lower.on', v));
    const auto = () => (creator.lowerLines() ?? []).join(' · ') || 'who, with what, whom';
    const [lowerRow, lowerInput] = this.textInput('Words', () => e().lower.text, v => creator.setEdit('lower', { ...e().lower, text: v, on: true }, 'type:lower'), auto);
    this.lowerInput = lowerInput;
    const lowerDur = this.slider('On screen', 1, 8, 0.1, () => e().lower.dur, v => creator.setEdit('lower.dur', v, 'slide:lower'), v => `${v.toFixed(1)} s`);
    const lowerReset = this.btn('Place it at the shot again', 'Back to just before the shot', () => creator.setEdit('lower.t', null), 'st-ghost st-small');
    const feedOn = this.check('Kill feed', () => e().feed, v => creator.setEdit('feed', v));
    const tagOn = this.check('Channel tag', () => e().tag.on, v => creator.setEdit('tag.on', v));
    const [tagRow] = this.textInput('Words', () => e().tag.text, v => creator.setEdit('tag', { on: true, text: v }, 'type:tag'), 'your channel', 40);
    const lowerGroup = this.group('Lower third', lowerOn, lowerRow, lowerDur, lowerReset, this.note('Left blank it writes itself from the kill: the shooter, the weapon, the player killed, the distance.'));
    lowerGroup.dataset.tour = 'lower';
    // More text: a group each, rebuilt when one is added or taken away (not
    // while its words are typed), with its words in `textInputs` for `focus`.
    this.textInputs = new Map();
    const more = el('div', 'st-more');
    const moreAdd = el('div', 'st-line');
    moreAdd.append(
      this.btn('Another title', 'One more title, at the playhead', () => creator.addText('title', creator.player.time), 'st-ghost st-small', 'plus'),
      this.btn('Another lower third', 'One more lower third, at the playhead, with words of its own', () => creator.addText('lower', creator.player.time), 'st-ghost st-small', 'plus'),
    );
    let moreSig = null;
    const moreSyncs = [];
    this.syncs.push(() => {
      const texts = e().texts;
      const sig = texts.map(x => x.kind).join(',');
      if (sig !== moreSig) {
        moreSig = sig;
        moreSyncs.length = 0;
        more.textContent = '';
        this.textInputs.clear();
        texts.forEach((x, k) => {
          const key = `texts.${k}`;
          const row = el('label', 'st-text');
          row.append(el('span', '', 'Words'));
          const input = el('input');
          input.type = 'text';
          input.maxLength = 80;
          input.spellcheck = false;
          input.placeholder = x.kind === 'title' ? 'its words' : auto();
          input.value = x.text;
          input.addEventListener('input', () => creator.setEdit(`${key}.text`, input.value, `type:${key}`));
          input.addEventListener('keydown', ev => {
            ev.stopPropagation();
            if (ev.key === 'Enter' || ev.key === 'Escape') input.blur();
          });
          input.addEventListener('keyup', ev => ev.stopPropagation());
          row.append(input);
          this.textInputs.set(key, input);
          const dur = el('label', 'st-slider');
          const out = el('output', '', '');
          const range = el('input');
          range.type = 'range';
          range.min = '1';
          range.max = '8';
          range.step = '0.1';
          range.value = String(x.dur);
          out.textContent = `${x.dur.toFixed(1)} s`;
          range.addEventListener('input', () => {
            creator.setEdit(`${key}.dur`, Number(range.value), `slide:${key}`);
            out.textContent = `${Number(range.value).toFixed(1)} s`;
          });
          dur.append(el('span', '', 'On screen'), range, out);
          const n = texts.slice(0, k + 1).filter(y => y.kind === x.kind).length + 1;
          const g = this.group(`${x.kind === 'title' ? 'Title' : 'Lower third'} ${n}`, row, dur,
            this.btn('Take it away', 'Remove this piece of text', () => creator.removeText(key), 'st-ghost st-small', 'close'));
          more.append(g);
          moreSyncs.push(() => {
            const now = e().texts[k];
            if (!now) return;
            if (document.activeElement !== input) input.value = now.text;
            if (document.activeElement !== range) {
              range.value = String(now.dur);
              out.textContent = `${now.dur.toFixed(1)} s`;
            }
          });
        });
      }
      for (const fn of moreSyncs) fn();
    });
    page.append(
      this.group('Title', titleOn, titleRow, titleDur, this.note('Over the middle of the frame, ruled in gold. Drag it on the Text lane to move it.')),
      lowerGroup,
      more,
      this.group('More text', moreAdd, this.note('A clip can carry any number of titles and lower thirds, a bar each on the Text lane: drag one to move it, its ends to resize it. Right-click the lane to add one where you point, or drop Title or Lower third from the tray.')),
      this.group('Kill feed', feedOn, this.note('The round\'s kills in the corner as they happen, in the game\'s colours.')),
      this.group('Channel tag', tagOn, tagRow, this.note('In the corner the whole clip, for the video\'s credit.')),
    );
  }

  buildFx(page) {
    const creator = this.creator;
    const e = () => creator.edits;
    const fades = list => list.map(v => [v, v ? `${v} s` : 'Off']);
    const fadeIn = this.seg(fades(FADES), () => e().fadeIn, v => creator.setEdit('fadeIn', v));
    const fadeOut = this.seg(fades(FADES), () => e().fadeOut, v => creator.setEdit('fadeOut', v));
    const flash = this.check('Flash', () => e().flash, v => creator.setEdit('flash', v), 'A white flash as the round lands');
    const punch = this.check('Zoom punch', () => e().punch, v => creator.setEdit('punch', v), 'A quick zoom in and out on the kill');
    const shake = this.check('Shake', () => e().shake, v => creator.setEdit('shake', v), 'The camera jolts on the kill');
    const freeze = this.seg(fades(FREEZES), () => e().freeze, v => creator.setEdit('freeze', v));
    const killNote = el('p', 'st-note');
    this.syncs.push(() => {
      killNote.textContent = creator.fxKill.kill === null ? 'This clip has no kill: these do nothing until it has one.' : '';
      killNote.hidden = creator.fxKill.kill !== null;
    });
    this.slowLine = el('p', 'st-note');
    const speeds = this.seg(RAMP_SPEEDS.filter(v => v < 1).map(v => [v, speedWord(v)]), () => (creator.mainSlow() ? creator.ramp.speed : null), v => {
      const span = creator.span;
      const at = creator.mainSlow(span) ?? creator.autoSlow(span) ?? creator.clipAction ?? { t0: span.t0, t1: span.t1 };
      creator.pickSlowSpeed(at.t0, at.t1, v);
    });
    const clear = this.btn('No slow motion of my own', 'Remove the clip\'s own slow motion: the kill shot\'s bullet time comes back', () => creator.clearSlow(), 'st-ghost st-small');
    // The other stretches of slow motion, a line each with its speed and a
    // way to take it away (the Speed lane has the same by right-click).
    const moreSlow = el('div', 'st-list');
    let slowSig = null;
    this.syncs.push(() => {
      const span = creator.span;
      const own = creator.mainSlow(span);
      const auto = creator.autoSlow(span);
      this.slowLine.textContent = own
        ? `Yours: ${speedWord(creator.ramp.speed)} from +${fmt(creator.screenAt(own.t0))} to +${fmt(creator.screenAt(own.t1))}. About ${Math.round(creator.screenLength(span))} s to watch.`
        : auto ? `The kill shot's bullet time (${creator.prefs.pace}) from +${fmt(creator.screenAt(auto.t0))} to +${fmt(creator.screenAt(auto.t1))}. Pick a speed to make it your own.`
          : 'Normal speed. Pick a speed, or drag across the Speed lane.';
      if (creator.sync) this.slowLine.textContent += ` ${creator.syncSay()}.`;
      clear.hidden = !own;
      const more = creator.ramp.more ?? [];
      const sig = span ? more.map(m => `${m.in}|${m.out}|${m.speed}`).join(';') : '';
      if (sig === slowSig) return;
      slowSig = sig;
      moreSlow.textContent = '';
      moreSlow.hidden = !more.length;
      more.forEach((m, k) => {
        const line = el('div', 'st-item');
        const words = el('span', 'st-itemwords', `${speedWord(m.speed)} from +${fmt(creator.screenAt(m.in))} to +${fmt(creator.screenAt(m.out))}`);
        const speed = this.seg(RAMP_SPEEDS.filter(v => v < 1).map(v => [v, speedWord(v)]), () => creator.ramp.more?.[k]?.speed ?? null, v => creator.setMoreSlow(k, { speed: v }), 'st-tight', { live: false });
        line.append(words, speed, this.btn('', 'Take this slow motion away', () => creator.removeMoreSlow(k), 'st-ghost st-icon', 'close'));
        moreSlow.append(line);
      });
    });
    // The effects placed by hand, a line each: where it goes off, a freeze's
    // seconds, and a way to take it away.
    const placed = el('div', 'st-list');
    const placedNote = this.note('Right-click the FX lane where an effect should go off (a flash, a zoom punch, a shake or a freeze), or drop Hit effects or Freeze from the tray away from the kill. Drag a placed effect on the lane to move it. As many as you like.');
    let fxSig = null;
    this.syncs.push(() => {
      const span = creator.span;
      const list = span ? fxMoments(e(), span) : [];
      const sig = list.map(m => `${m.kind}|${m.at}|${m.dur}`).join(';');
      if (sig === fxSig) return;
      fxSig = sig;
      placed.textContent = '';
      placed.hidden = !list.length;
      for (const m of list) {
        const line = el('div', 'st-item');
        const words = el('span', 'st-itemwords', `${FX_WORDS[m.kind]} at +${fmt(creator.screenAt(m.at))}`);
        line.append(words);
        if (m.kind === 'freeze') {
          line.append(this.seg(FREEZES.filter(v => v > 0).map(v => [v, `${v} s`]), () => e().fx[m.k]?.dur ?? null, v => creator.setFx(m.k, { dur: v }), 'st-tight', { live: false }));
        }
        line.append(this.btn('', 'Take this effect away', () => creator.removeFx(m.k), 'st-ghost st-icon', 'close'));
        placed.append(line);
      }
    });
    page.append(
      this.group('Fade in from black', fadeIn),
      this.group('Fade out to black', fadeOut),
      this.group('On the kill', flash, punch, shake, el('span', 'st-label', 'Freeze frame'), freeze, killNote),
      this.group('Placed effects', placed, placedNote),
      this.group('Slow motion', this.slowLine, speeds, clear, moreSlow),
    );
  }

  buildClips(page) {
    const creator = this.creator;
    const rec = this.btn('Record the clip', 'The clip to a video file, full size in its frame, with its sound', () => this.record(), 'st-wide st-rec-btn', 'rec');
    rec.dataset.tour = 'record';
    const thumb = this.btn('Save a thumbnail', 'This frame as a PNG, cropped, graded and with its text', () => creator.thumbnail(), 'st-wide', 'image');
    this.sizeText = el('b', '', '');
    this.watchText = el('span', '', '');
    const facts = el('p', 'st-note st-facts');
    facts.append('Output ', this.sizeText, ' · ', this.watchText);
    this.syncs.push(() => {
      const span = creator.span;
      this.sizeText.textContent = this.outputSize();
      this.watchText.textContent = span ? `about ${Math.round(creator.screenLength(span))} s` : '';
    });
    const keep = this.btn('Keep the clip', 'Keep it with its cameras, slow motion, look, text and effects: it joins the montage', () => creator.saveClip(), 'st-wide st-ghost', 'plus');
    keep.dataset.tour = 'keep';
    const keptNote = this.note('');
    this.syncs.push(() => {
      const n = creator.clips.length;
      keptNote.textContent = n ? `${n} kept clip${n === 1 ? '' : 's'} on the Montage tab, where they play together and record as one video.`
        : 'Kept clips go on the Montage tab, where they play together and record as one video.';
    });
    // What sound goes in the file: the game's, the song's, both or none.
    const music = creator.music;
    const game = this.check('Game sound', () => creator.prefs.recordGame, v => creator.setPref('recordGame', v), 'The game\'s own sound in the recorded file');
    const song = this.check('The song on the Music lane', () => music.loaded && music.record, v => { music.record = v; },
      'The song in the recorded file, from the clip\'s start');
    const soundNote = this.note('');
    this.syncs.push(() => {
      const box = song.querySelector('input');
      if (box) box.disabled = !music.loaded;
      const g = creator.prefs.recordGame;
      const s = music.loaded && music.record;
      soundNote.textContent = g && s ? 'The game and the song, mixed.' : g ? 'The game\'s sound alone.'
        : s ? 'The song alone.' : 'No sound: a silent video, to lay the sound in another editor.';
    });
    page.append(
      this.group('Sound in the file', game, song, soundNote),
      this.buildShare(),
      this.group('Export', rec, thumb, facts, this.note('Recording plays the clip in real time, slow motion included, and saves it when it ends. Keep other windows quiet while it runs.')),
      this.group('Keep the clip', keep, keptNote),
    );
  }

  /**
   * The Montage tab (features/replay-creator-view, "The montage"): the kept
   * clips as cards in the order they play, each with its picture, its name
   * and what it carries; Play the montage plays them one after another on
   * the monitor, each on the strip as it plays, and Record the montage
   * records them into one file. Keep the clip (here and on Export) adds
   * the clip on the strip to the end.
   */
  buildMontage(page) {
    const creator = this.creator;
    const keep = this.btn('Keep the clip', 'The clip on the strip, with its cameras, slow motion, look, text and effects, at the end of the montage', () => creator.saveClip(), 'st-wide st-ghost', 'plus');
    const play = this.btn('Play the montage', 'Every kept clip one after another on the monitor, from the first (Esc stops)', () => {
      if (creator.montage) {
        creator.stopMontage();
        creator.player.playing = false;
      } else creator.playMontage(0);
    }, 'st-wide', 'play');
    const rec = this.btn('Record the montage', 'Every kept clip, one after another, as one video file', () => this.record({ montage: true }), 'st-wide st-rec-btn', 'rec');
    const facts = this.note('');
    this.syncs.push(() => {
      const n = creator.clips.length;
      const m = creator.montage;
      play.disabled = !n;
      play.lastChild.textContent = m ? 'Stop the montage' : 'Play the montage';
      rec.disabled = n < 2;
      rec.lastChild.textContent = n >= 2 ? `Record the montage of ${n} clips` : 'Record the montage';
      const secs = creator.clips.reduce((sum, c) => sum + screenSeconds(c.ramp ?? { speed: 1, in: null, out: null }, { t0: c.in, t1: c.out }, c.in, c.out), 0);
      facts.textContent = n ? `${n} clip${n === 1 ? '' : 's'}, about ${Math.round(secs)} s of video, in this order. Each plays with its own cameras, slow motion, look, text and effects.`
        : 'Keep the clip on the strip to start one.';
    });
    this.clipList = el('div', 'st-clips');
    page.append(
      this.group('The montage', play, rec, facts),
      this.group('Clips, in order', this.clipList, keep,
        this.note('Drag a card onto another to move it, or use its arrows. The camera opens a clip on the strip to change it; Keep the clip again keeps the changed version as a new clip.')),
    );
  }

  /** Sharing the edit (features/replay-creator-view, "Sharing an edit"): the
   *  clip's cameras, slow motion, pin, look, text and effects kept on
   *  bfstats.io against the shared round, and a link that opens them in the
   *  studio. The song is named, never sent. */
  buildShare() {
    const creator = this.creator;
    const [nameRow, nameInput] = this.textInput('Name', () => this.shareName ?? creator.editName(), v => { this.shareName = v; }, '', 80);
    nameInput.title = 'What the link is called where it is pasted';
    const out = el('div', 'st-sharelink');
    out.hidden = true;
    const link = el('input', 'st-sharebox');
    link.readOnly = true;
    link.setAttribute('aria-label', 'The edit\'s link');
    const copy = this.btn('Copy', 'Copy the link', () => this.copyLink(link.value, status), 'st-small');
    out.append(link, copy);
    const status = el('p', 'st-note st-sharestatus', '');
    const go = this.btn('Share this edit', 'Keep this edit on bfstats.io and copy a link that opens it in the studio', () => {
      go.disabled = true;
      status.textContent = 'Sharing...';
      status.classList.remove('bad');
      creator.shareEdit((this.shareName ?? creator.editName()).trim() || creator.editName()).then(made => {
        link.value = made.link;
        out.hidden = false;
        this.copyLink(made.link, status, `Shared as ${made.name}. The link is copied: paste it in Discord or send it.`);
      }).catch(error => {
        status.classList.add('bad');
        status.textContent = error?.status === 401
          ? 'Sign in on bfstats.io to share an edit.'
          : error?.message || 'The edit could not be shared.';
      }).finally(() => { go.disabled = false; });
    }, 'st-wide', 'film');
    const from = this.note('');
    this.syncs.push(() => {
      const f = creator.sharedFrom;
      from.hidden = !f;
      if (f) from.textContent = `Opened from ${f.authorName ? `${f.authorName}'s` : 'a shared'} edit, ${f.name}. Your changes are yours: share them as a new link.`;
    });
    const what = this.note('Shares the clip, its cameras (yours too), slow motion, the hit\'s pin, look, text and effects. The song on the Music lane is named, not sent.');
    return this.group('Share this edit', from, nameRow, go, out, status, what);
  }

  /** `text` to the clipboard, and `said` (or a word that it is) in `status`. */
  copyLink(text, status, said = 'Link copied') {
    status.classList.remove('bad');
    const done = () => { status.textContent = said; };
    try {
      navigator.clipboard.writeText(text).then(done, () => { status.textContent = `${said.replace(/ The link is copied:.*/, '')} Copy the link above.`; });
    } catch {
      status.textContent = 'Copy the link above.';
    }
  }

  /** The Montage tab's cards, one a kept clip, in the montage's order:
   *  rebuilt when a clip is kept, taken away, renamed, moved or given its
   *  picture; the card playing now is marked each refresh. */
  syncClips(force) {
    const creator = this.creator;
    const m = creator.montage;
    const sig = creator.clips.map(c => `${c.name}|${c.in}|${c.out}|${c.thumb ? 1 : 0}|${c.cams?.length ?? 0}`).join(';');
    if (force || sig !== this.clipSig) {
      this.clipSig = sig;
      this.clipList.textContent = '';
      if (!creator.clips.length) {
        this.clipList.append(this.note('Nothing kept yet. Keep the clip puts the clip on the strip here; every clip you keep joins the montage after it.'));
      }
      creator.clips.forEach((clip, i) => this.clipList.append(this.clipCard(clip, i)));
    }
    for (const card of this.clipList.querySelectorAll('.st-card')) {
      card.classList.toggle('playing', Boolean(m) && m.list[m.i] === creator.clips[Number(card.dataset.i)]);
    }
  }

  /** One kept clip's card: its picture, its name (typed over to rename),
   *  its seconds of video and what it carries, and what can be done with it.
   *  Dragged over another card it takes that place in the montage. */
  clipCard(clip, i) {
    const creator = this.creator;
    const card = el('div', 'st-card');
    card.draggable = true;
    card.dataset.i = String(i);
    const pic = el('div', 'st-thumb');
    if (clip.thumb) {
      const img = el('img');
      img.src = clip.thumb;
      img.alt = '';
      pic.append(img);
    } else pic.append(el('span', 'st-thumb-n', String(i + 1)));
    const body = el('div', 'st-card-body');
    const name = el('input', 'st-clipname');
    name.value = clip.name;
    name.title = 'Rename';
    name.setAttribute('aria-label', 'Clip name');
    name.addEventListener('change', () => {
      creator.renameClip(clip, name.value);
      this.clipSig = '';
    });
    name.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter' || e.key === 'Escape') name.blur();
    });
    name.addEventListener('keyup', e => e.stopPropagation());
    name.addEventListener('pointerdown', e => e.stopPropagation());
    const secs = screenSeconds(clip.ramp ?? { speed: 1, in: null, out: null }, { t0: clip.in, t1: clip.out }, clip.in, clip.out);
    const carries = [`${Math.round(secs)} s`, clip.cams?.length > 1 ? `${clip.cams.length} cameras` : null,
      clip.ramp && clip.ramp.speed < 1 ? `${speedWord(clip.ramp.speed)} slow` : null, clip.kill ? 'kill shot' : null].filter(Boolean);
    body.append(name, el('span', 'st-card-sub', `${i + 1} · ${fmt(clip.in)} · ${carries.join(' · ')}`));
    const acts = el('div', 'st-card-acts');
    acts.append(
      this.btn('', 'Play the montage from this clip', () => creator.playMontage(i), 'st-ghost st-icon', 'play'),
      this.btn('', 'Open this clip on the strip to change it', () => {
        creator.stopMontage({ quiet: true });
        creator.useClip(clip);
      }, 'st-ghost st-icon', 'camera'),
      this.btn('', 'Earlier in the montage', () => creator.moveClip(clip, i - 1), 'st-ghost st-icon', 'up'),
      this.btn('', 'Later in the montage', () => creator.moveClip(clip, i + 1), 'st-ghost st-icon', 'down'),
      this.btn('', 'Take this clip out of the montage', () => creator.removeClip(clip), 'st-ghost st-icon', 'close'),
    );
    card.append(pic, body, acts);
    // Dragged onto another card, it goes there.
    card.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/plain', String(i));
      e.dataTransfer.effectAllowed = 'move';
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
    card.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      card.classList.add('over');
    });
    card.addEventListener('dragleave', () => card.classList.remove('over'));
    card.addEventListener('drop', e => {
      e.preventDefault();
      card.classList.remove('over');
      const from = Number(e.dataTransfer.getData('text/plain'));
      if (Number.isInteger(from) && creator.clips[from] && from !== i) creator.moveClip(creator.clips[from], i);
    });
    return card;
  }
}

// --- glyphs -------------------------------------------------------------------------------------

const GLYPHS = Object.freeze({
  play: 'M7 4v16l13-8z',
  pause: 'M7 4h4v16H7zM13 4h4v16h-4z',
  start: 'M5 4v16M19 4 8 12l11 8z',
  end: 'M19 4v16M5 4l11 8-11 8z',
  step: 'M6 5l9 7-9 7zM17 5v14',
  stepback: 'M18 5l-9 7 9 7zM7 5v14',
  undo: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  redo: 'M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3',
  rec: 'M12 12m-6 0a6 6 0 1 0 12 0a6 6 0 1 0-12 0',
  image: 'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M15.5 9.5m-1.5 0a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0',
  close: 'M6 6l12 12M18 6 6 18',
  key: 'M12 3l7 9-7 9-7-9z',
  camera: 'M3 7h12v10H3zM15 10l6-3v10l-6-3',
  clear: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  loop: 'M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4',
  plus: 'M12 5v14M5 12h14',
  up: 'M12 19V5M5 12l7-7 7 7',
  down: 'M12 5v14M5 12l7 7 7-7',
  film: 'M4 4h16v16H4zM8 4v16M16 4v16M4 9h4M4 15h4M16 9h4M16 15h4',
  help: 'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5v.5',
});

function icon(id) {
  const d = GLYPHS[id];
  if (!d) return null;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', `st-glyph g-${id}`);
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', d);
  svg.append(path);
  return svg;
}

// --- the look ---------------------------------------------------------------------------------

function injectStyle() {
  if (document.getElementById('st-style')) return;
  const style = el('style');
  style.id = 'st-style';
  style.textContent = STYLE;
  document.head.appendChild(style);
}

const STYLE = `
/* Over the view, under the replay's chrome: the studio's text and effects,
   and the grade's tint. */
.st-ov { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.st-tint { position: absolute; inset: 0; pointer-events: none; mix-blend-mode: soft-light; }
.st-tint[hidden] { display: none; }

/* The studio: the view is the monitor, set between the panels. */
html.replay-studio, html.replay-studio body { overflow: hidden; }
html.replay-studio #stage { position: fixed !important; z-index: 1001; border-radius: 6px; box-shadow: 0 0 0 1px rgba(200, 194, 152, .28), 0 18px 48px rgba(0, 0, 0, .6); }
html.replay-studio.st-rec #stage { border-radius: 0; box-shadow: none; }
.st-back { position: fixed; inset: 0; z-index: 1000; background: #0b0b09; }
html.st-rec .st-back { background: #000; }
.st { --rp-plate: rgba(33, 33, 29, .8); --rp-plate-deep: rgba(20, 20, 17, .9); --rp-plate-menu: rgba(20, 20, 17, .97);
  --rp-edge: rgba(200, 194, 152, .34); --rp-edge-strong: #b9b38a; --rp-khaki: #a39c6c; --rp-khaki-ink: #15150e; --rp-ink: #eeecd9;
  --rp-muted: #a9a690; --rp-gold: #e8c35a; --rp-font: 'Trebuchet MS', 'Geist Variable', 'Segoe UI', system-ui, sans-serif;
  --rp-mono: var(--mm-font-mono, ui-monospace, monospace);
  position: fixed; inset: 0; z-index: 1002; pointer-events: none; color: var(--rp-ink); font: 13px/1.4 var(--rp-font); }
.st > * { pointer-events: auto; }
html.st-rec .st > :not(.st-recbar) { display: none; }
.st-recbar { display: none; }
html.st-rec .st-recbar { position: fixed; top: 12px; left: 12px; display: flex; align-items: center; gap: 10px; padding: 6px 8px 6px 12px;
  border-radius: 6px; background: rgba(0, 0, 0, .7); font: 700 12px var(--rp-mono); letter-spacing: .06em; }
.st-top { position: absolute; left: 0; right: 0; top: 0; height: ${TOP_H}px; display: flex; align-items: center; gap: 8px; padding: 0 12px;
  box-sizing: border-box; border-bottom: 1px solid rgba(200, 194, 152, .16); background: #13130f; }
.st-brand { display: flex; align-items: baseline; gap: 10px; min-width: 0; margin-right: 6px; }
.st-brand b { color: var(--rp-gold); font: 800 12px var(--rp-font); letter-spacing: .2em; text-transform: uppercase; padding: 3px 8px;
  border: 1px solid var(--rp-gold); border-radius: 3px; }
.st-name { color: var(--rp-ink); font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 32vw; }
.st-gap { flex: 1; }
.st-btn { appearance: none; display: inline-flex; align-items: center; justify-content: center; gap: 7px; height: 34px; padding: 0 12px;
  border: 1px solid var(--rp-edge); border-radius: 6px; background: rgba(255, 255, 255, .04); color: var(--rp-ink);
  font: 700 12px var(--rp-font); letter-spacing: .04em; cursor: pointer; white-space: nowrap; }
.st-btn:hover { background: rgba(255, 255, 255, .1); }
.st-btn:focus-visible, .st-segbtn:focus-visible, .st-tab:focus-visible, .st-recipe:focus-visible, .st-grade:focus-visible { outline: 2px solid var(--rp-gold); outline-offset: 1px; }
.st-btn:disabled { opacity: .35; cursor: default; }
.st-btn[hidden] { display: none; }
.st-ghost { border-color: transparent; background: none; }
.st-ghost:hover { border-color: var(--rp-edge); }
.st-icon { width: 30px; height: 30px; padding: 0; }
.st-small, .st-ghost.st-small { align-self: flex-start; height: 28px; font-size: 11px; color: var(--rp-ink); border-color: var(--rp-edge); }
.st-wide { width: 100%; margin-top: 6px; }
.st-rec-btn { border-color: #c9352a; color: #fff; background: rgba(201, 53, 42, .25); }
.st-rec-btn .st-glyph { color: #ff5b4d; fill: currentColor; stroke: none; }
.st-rec-btn.on { background: #c9352a; }
.st-rec-btn.on .st-glyph { color: #fff; animation: st-blink 1s steps(2, start) infinite; }
@keyframes st-blink { to { visibility: hidden; } }
.st-glyph { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; flex: none; }
.st-glyph.g-play, .st-glyph.g-pause, .st-glyph.g-start, .st-glyph.g-end, .st-glyph.g-step, .st-glyph.g-stepback { fill: currentColor; stroke-width: 1.5; }
.st-close .st-glyph { width: 18px; height: 18px; }
.st-seg { display: flex; flex-wrap: nowrap; border: 1px solid var(--rp-edge); border-radius: 6px; overflow: hidden; }
.st-seg.st-wrap, .st-seg.st-styles { flex-wrap: wrap; }
.st-segbtn { appearance: none; flex: 1 1 auto; display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 32px; padding: 0 10px;
  border: 0; border-left: 1px solid var(--rp-edge); background: none; color: var(--rp-ink); font: 700 11px var(--rp-font); cursor: pointer; white-space: nowrap; }
.st-segbtn:first-child { border-left: 0; }
.st-segbtn:hover { background: rgba(255, 255, 255, .08); }
.st-segbtn.on { background: var(--rp-gold); color: #17150f; }
.st-segbtn .rc-cb-icon { width: 15px; height: 15px; stroke-width: 2; }
.st-styles .st-segbtn { flex: 1 1 45%; border-top: 1px solid var(--rp-edge); margin-top: -1px; }
.st-frames { margin-right: 6px; }
.st-frames .st-segbtn { min-height: 32px; }
/* The inspector. */
.st-side { position: absolute; top: ${TOP_H}px; right: 0; bottom: ${DOCK_H}px; width: ${SIDE_W}px; display: flex; flex-direction: column;
  border-left: 1px solid rgba(200, 194, 152, .16); background: #13130f; }
.st-tabs { display: flex; border-bottom: 1px solid rgba(200, 194, 152, .16); }
.st-tab { appearance: none; flex: 1; height: 40px; padding: 0 2px; border: 0; border-bottom: 2px solid transparent; background: none; color: var(--rp-muted);
  font: 800 10px var(--rp-font); letter-spacing: .06em; text-transform: uppercase; cursor: pointer; }
.st-tab:hover { color: var(--rp-ink); }
.st-tab.on { color: var(--rp-gold); border-bottom-color: var(--rp-gold); }
.st-body { flex: 1; min-height: 0; overflow: auto; padding: 4px 14px 18px; scrollbar-width: thin; scrollbar-color: rgba(200, 194, 152, .38) transparent; }
.st-page[hidden] { display: none; }
.st-group { padding: 12px 0 6px; border-bottom: 1px solid rgba(200, 194, 152, .1); display: flex; flex-direction: column; gap: 8px; }
.st-more:empty { display: none; }
.st-list { display: flex; flex-direction: column; gap: 6px; }
.st-list[hidden] { display: none; }
.st-item { display: flex; align-items: center; gap: 8px; min-height: 30px; }
.st-itemwords { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.st-seg.st-tight { flex: none; }
.st-seg.st-tight .st-segbtn { height: 26px; min-width: 0; padding: 0 7px; font-size: 10px; }
.st-group:last-child { border-bottom: 0; }
.st-group h3 { margin: 0; color: var(--rp-muted); font: 800 10px var(--rp-font); letter-spacing: .16em; text-transform: uppercase; }
.st-label { color: var(--rp-muted); font-size: 12px; }
.st-note { margin: 0; color: var(--rp-muted); font-size: 12px; line-height: 1.45; }
.st-note[hidden] { display: none; }
.st-toggle[hidden], .st-slider[hidden], .st-text[hidden] { display: none; }
/* A shared edit's link, and Copy beside it. */
.st-sharelink { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px; align-items: center; }
.st-sharelink[hidden] { display: none; }
.st-sharebox { height: 30px; min-width: 0; padding: 0 8px; border: 1px solid var(--rp-edge); border-radius: 5px; background: rgba(0, 0, 0, .35);
  color: var(--rp-ink); font: 12px var(--rp-mono); }
.st-sharestatus.bad { color: #ff9d93; }
/* The song's start: a longer label than the Text tab's boxes. */
.st-text.wide { grid-template-columns: 130px minmax(0, 1fr); }
.st-facts b { color: var(--rp-ink); font-family: var(--rp-mono); }
.st-toggle { display: flex; align-items: center; gap: 9px; min-height: 30px; cursor: pointer; font-weight: 700; }
.st-toggle input { width: 18px; height: 18px; accent-color: var(--rp-gold); margin: 0; }
.st-slider { display: grid; grid-template-columns: 96px minmax(0, 1fr) 52px; align-items: center; gap: 8px; font-size: 12px; color: var(--rp-muted); }
.st-slider input { width: 100%; accent-color: var(--rp-gold); }
.st-slider output { text-align: right; color: var(--rp-ink); font: 12px var(--rp-mono); }
.st-text { display: grid; grid-template-columns: 52px minmax(0, 1fr); align-items: center; gap: 8px; font-size: 12px; color: var(--rp-muted); }
.st-text input, .st-select { height: 32px; box-sizing: border-box; padding: 0 9px; border: 1px solid var(--rp-edge); border-radius: 5px;
  background: rgba(0, 0, 0, .35); color: var(--rp-ink); font: 13px var(--rp-font); min-width: 0; }
.st-text input:focus, .st-select:focus { outline: 2px solid var(--rp-gold); outline-offset: 0; }
.st-select option { background: #1b1b16; }
.st-keys { display: flex; flex-direction: column; gap: 6px; }
.st-key { display: grid; grid-template-columns: 30px 72px minmax(0, 1fr) 30px; align-items: center; gap: 8px; }
/* The page draws every canvas absolutely over its stage (map.css): these sit in their rows. */
.st-keypic { position: static; inset: auto; display: block; width: 72px; height: 40px; border-radius: 4px; background: #000; cursor: pointer; box-shadow: 0 0 0 1px var(--rp-edge); }
.st-keypic:hover { box-shadow: 0 0 0 2px var(--rp-gold); }
.st-keyline { display: grid; grid-template-columns: 56px 16px minmax(0, 1fr); align-items: center; gap: 6px; min-width: 0; }
.st-key .rc-cb-icon { width: 16px; height: 16px; color: var(--rp-gold); stroke-width: 2; }
.st-keyn { appearance: none; width: 28px; height: 28px; border: 1.5px solid var(--rp-gold); border-radius: 4px; transform: rotate(45deg) scale(.78);
  background: #17150f; color: var(--rp-gold); font: 800 12px var(--rp-font); cursor: pointer; padding: 0; }
.st-keyn:hover { background: var(--rp-gold); color: #17150f; }
.st-keyt { color: var(--rp-muted); font: 12px var(--rp-mono); }
.st-part { display: block; color: var(--rp-gold); font: 800 9px var(--rp-font); letter-spacing: .08em; text-transform: uppercase; }
.st-recipes { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.st-recipe { appearance: none; display: grid; grid-template-columns: 38px minmax(0, 1fr); grid-template-rows: auto auto; column-gap: 9px; align-items: center;
  padding: 8px; border: 1px solid var(--rp-edge); border-radius: 7px; background: rgba(255, 255, 255, .03); color: var(--rp-ink); text-align: left; cursor: pointer; }
.st-recipe:hover { background: rgba(255, 255, 255, .08); border-color: var(--rp-gold); }
.st-recipe .st-sw { grid-row: 1 / 3; width: 38px; height: 38px; }
.st-recipe b { font-size: 13px; }
.st-recipe small { color: var(--rp-muted); font-size: 11px; line-height: 1.3; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.st-sw { position: relative; display: block; border-radius: 5px; overflow: hidden;
  background: linear-gradient(180deg, #8fb3d6 0 38%, #c9c2a0 38% 46%, #6f7a3e 46% 72%, #4b4026 72%); }
.st-sw::after { content: ''; position: absolute; left: 30%; top: 30%; width: 22%; height: 34%; border-radius: 2px 2px 0 0; background: #5a3b2a; }
.st-swtint { position: absolute; inset: 0; mix-blend-mode: soft-light; z-index: 1; }
.st-grades { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.st-grade { appearance: none; display: flex; flex-direction: column; gap: 5px; padding: 4px; border: 1px solid transparent; border-radius: 7px;
  background: none; color: var(--rp-muted); font: 700 10px var(--rp-font); cursor: pointer; text-align: center; }
.st-grade .st-sw { width: 100%; aspect-ratio: 4 / 3; }
.st-grade:hover { color: var(--rp-ink); border-color: var(--rp-edge); }
.st-grade.on { color: var(--rp-gold); border-color: var(--rp-gold); }
.st-clips { display: flex; flex-direction: column; gap: 6px; }
.st-card { display: grid; grid-template-columns: 64px minmax(0, 1fr); align-items: center; gap: 8px; padding: 5px; box-sizing: border-box;
  border: 1px solid var(--rp-edge); border-radius: 7px; background: rgba(255, 255, 255, .025); cursor: grab; }
.st-card.playing { border-color: var(--rp-gold); box-shadow: inset 0 0 0 1px var(--rp-gold); }
.st-card.dragging { opacity: .45; }
.st-card.over { outline: 2px dashed var(--rp-gold); outline-offset: 1px; }
.st-thumb { width: 64px; height: 36px; display: flex; align-items: center; justify-content: center; border-radius: 4px; overflow: hidden;
  background: #000; color: var(--rp-muted); font: 800 14px var(--rp-mono); }
.st-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.st-card-body { display: flex; flex-direction: column; min-width: 0; gap: 1px; }
.st-card-body .st-clipname { height: 26px; }
.st-card-sub { padding: 0 8px; color: var(--rp-muted); font: 11px var(--rp-mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.st-card-acts { grid-column: 1 / -1; display: flex; gap: 2px; justify-content: flex-end; }
.st-card-acts .st-icon { width: 28px; height: 28px; }
.st-montagebar { position: absolute; left: 50%; top: ${TOP_H + 12}px; transform: translateX(-50%); display: flex; align-items: center; gap: 10px;
  padding: 5px 6px 5px 12px; border-radius: 6px; border: 1px solid var(--rp-gold); background: rgba(0, 0, 0, .72); font: 700 12px var(--rp-mono); letter-spacing: .06em; }
.st-montagebar[hidden] { display: none; }
.st-montagebar b { color: var(--rp-gold); letter-spacing: .18em; }
.st-montagewords { max-width: 40vw; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.st-moments { display: flex; flex-direction: column; gap: 2px; padding: 8px 0 4px; }
.st-moment { appearance: none; display: grid; grid-template-columns: 46px minmax(0, 1fr) auto; align-items: center; gap: 10px; width: 100%;
  padding: 7px 8px; border: 1px solid transparent; border-radius: 6px; background: none; color: var(--rp-ink); text-align: left; cursor: pointer; font: inherit; }
.st-moment:hover { background: rgba(255, 255, 255, .06); border-color: var(--rp-edge); }
.st-moment:focus-visible { outline: 2px solid var(--rp-gold); }
.st-moment.on { border-color: var(--rp-gold); background: rgba(232, 195, 90, .1); }
.st-moment time { color: var(--rp-muted); font: 12px var(--rp-mono); }
.st-mmain { display: flex; flex-direction: column; min-width: 0; }
.st-mwho { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.st-mwho i { color: var(--rp-muted); font-style: normal; }
.st-mwhat { color: var(--rp-muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.st-mtags { display: flex; gap: 4px; }
.st-mtags em { padding: 1px 6px; border-radius: 3px; background: rgba(255, 255, 255, .08); color: var(--rp-muted); font: 800 10px var(--rp-font);
  font-style: normal; letter-spacing: .06em; text-transform: uppercase; }
.st-mtags em.multi { background: rgba(240, 145, 60, .3); color: #ffd2a8; }
.st-mtags em.long { background: rgba(232, 195, 90, .22); color: var(--rp-gold); }
.st-clip { display: grid; grid-template-columns: minmax(0, 1fr) auto 30px 30px; align-items: center; gap: 6px; }
.st-clipname { min-width: 0; height: 30px; box-sizing: border-box; padding: 0 8px; border: 1px solid transparent; border-radius: 5px;
  background: none; color: var(--rp-ink); font: 700 13px var(--rp-font); text-overflow: ellipsis; }
.st-clipname:hover { border-color: var(--rp-edge); }
.st-clipname:focus { border-color: var(--rp-gold); outline: none; background: rgba(0, 0, 0, .35); }
/* Help. */
.st-help { position: absolute; inset: 0; z-index: 3; display: grid; place-items: center; background: rgba(0, 0, 0, .55); }
.st-help[hidden] { display: none; }
.st-help-card { width: min(980px, calc(100% - 48px)); max-height: calc(100% - 48px); overflow: auto; box-sizing: border-box; padding: 18px 22px 16px;
  border: 1px solid var(--rp-edge); border-radius: 10px; background: #15150f; box-shadow: 0 24px 64px rgba(0, 0, 0, .6); }
.st-help-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.st-help-head b { color: var(--rp-gold); font: 800 13px var(--rp-font); letter-spacing: .16em; text-transform: uppercase; }
.st-help-head .st-tourbtn { margin-left: auto; margin-right: 8px; border-color: var(--rp-gold); color: var(--rp-gold); }
.st-help-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 18px 22px; margin-bottom: 10px; }
.st-help-col h3 { margin: 4px 0 8px; color: var(--rp-muted); font: 800 10px var(--rp-font); letter-spacing: .16em; text-transform: uppercase; }
.st-help-col ol { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 6px; font-size: 13px; line-height: 1.45; }
.st-help-keys { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 6px 12px; margin: 0; font-size: 13px; }
.st-help-keys dt { color: var(--rp-gold); font: 700 12px var(--rp-mono); white-space: nowrap; }
.st-help-keys dd { margin: 0; }
/* The dock: transport and strip. */
.st-dock { position: absolute; left: 0; right: 0; bottom: 0; height: ${DOCK_H}px; box-sizing: border-box; padding: 6px 12px 10px;
  border-top: 1px solid rgba(200, 194, 152, .16); background: #13130f; display: flex; flex-direction: column; gap: 6px; }
.st-transport { display: flex; align-items: center; gap: 4px; height: 40px; }
.st-transport .st-btn.st-ghost { width: 34px; padding: 0; }
.st-transport .st-btn.st-ghost:last-child { width: auto; padding: 0 12px; }
.st-play { width: 46px; height: 38px; padding: 0; border-color: var(--rp-gold); color: var(--rp-gold); }
.st-play .st-glyph { width: 20px; height: 20px; }
.st-clock { margin-left: 12px; font: 700 15px var(--rp-mono); }
.st-where { margin-left: 10px; color: var(--rp-muted); font: 12px var(--rp-mono); }
.st-speed { margin-left: 12px; padding: 2px 8px; border-radius: 4px; background: rgba(110, 170, 220, .2); color: #cfe3f3; font: 700 11px var(--rp-mono);
  text-transform: uppercase; letter-spacing: .06em; }
.st-cams { margin-right: 6px; }
.st-cams .st-segbtn { min-height: 30px; padding: 0 9px; font-size: 11px; }
.st-hint { color: var(--rp-muted); font: 800 10px var(--rp-font); letter-spacing: .1em; text-transform: uppercase; margin-right: 10px; }
.st-strip { flex: 1; min-height: 0; position: relative; }
/* The tray: what can go on the clip, dragged onto the strip. */
.st-tray { display: flex; align-items: center; gap: 8px; height: 34px; padding-left: 66px; overflow-x: auto; overflow-y: hidden; scrollbar-width: none; }
.st-tray.more { mask-image: linear-gradient(90deg, #000 calc(100% - 56px), transparent); -webkit-mask-image: linear-gradient(90deg, #000 calc(100% - 56px), transparent); }
.st-tray.more-left { mask-image: linear-gradient(90deg, transparent, #000 56px); -webkit-mask-image: linear-gradient(90deg, transparent, #000 56px); }
.st-tray.more.more-left { mask-image: linear-gradient(90deg, transparent, #000 56px, #000 calc(100% - 56px), transparent);
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 56px, #000 calc(100% - 56px), transparent); }
.st-tray::-webkit-scrollbar { display: none; }
.st-tray-label { color: var(--rp-muted); font: 800 9px var(--rp-font); letter-spacing: .12em; text-transform: uppercase; white-space: nowrap; }
.st-tray-group { flex: none; display: flex; align-items: center; gap: 3px; padding-left: 7px; border-left: 1px solid rgba(200, 194, 152, .16); }
.st-tray-group:first-of-type { border-left: 0; padding-left: 0; }
.st-tray-head { margin-right: 2px; color: var(--rp-muted); font: 800 9px var(--rp-font); letter-spacing: .1em; text-transform: uppercase; white-space: nowrap; }
.st-chip { appearance: none; flex: none; display: inline-flex; align-items: center; gap: 5px; height: 28px; padding: 0 8px; border: 1px solid var(--rp-edge);
  border-radius: 14px; background: rgba(255, 255, 255, .04); color: var(--rp-ink); font: 700 11px var(--rp-font); white-space: nowrap;
  cursor: grab; touch-action: none; }
.st-chip[hidden] { display: none; }
.st-chip:hover, .st-chip:focus-visible { border-color: var(--rp-gold); background: rgba(255, 255, 255, .09); outline: none; }
.st-chip .rc-cb-icon { width: 14px; height: 14px; stroke-width: 2; color: var(--rp-gold); }
.st-chip.dragging { opacity: .45; }
.st-chip-ghost { position: fixed; left: 0; top: 0; z-index: 10; pointer-events: none; cursor: grabbing; border-color: var(--rp-gold);
  background: #17150f; box-shadow: 0 6px 18px rgba(0, 0, 0, .6); opacity: .9; }
.st-chip-ghost.over { border-color: #6ee7ff; color: #d9f8ff; }
@media (max-width: 1700px) { .st-tray-label { display: none; } .st-tray { padding-left: 0; } }
@media (max-width: 1450px) { .st-tray-head { display: none; } .st-chip { padding: 0 6px; } }
/* The Camera tab: recipes and the clip's cameras. */
.st-camrecipes { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.st-camrecipe { appearance: none; display: flex; flex-direction: column; gap: 3px; padding: 8px; border: 1px solid var(--rp-edge); border-radius: 7px;
  background: rgba(255, 255, 255, .03); color: var(--rp-ink); text-align: left; cursor: pointer; }
.st-camrecipe:hover, .st-camrecipe:focus-visible { background: rgba(255, 255, 255, .08); border-color: var(--rp-gold); outline: none; }
.st-camrecipe b { font-size: 13px; }
.st-camrecipe small { color: var(--rp-muted); font-size: 11px; line-height: 1.3; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.st-camstrip { display: flex; gap: 2px; margin-bottom: 3px; }
.st-camstrip i { flex: 1; display: grid; place-items: center; height: 20px; border-radius: 3px; --c: 150, 150, 150; background: rgba(var(--c), .45); color: #fff; }
.st-camstrip .rc-cb-icon { width: 13px; height: 13px; stroke-width: 2.2; }
.st-camstrip i.c-eyes, .st-camstrip i.c-shoulder, .st-camstrip i.c-front, .st-cam.c-eyes .st-camface, .st-cam.c-shoulder .st-camface, .st-cam.c-front .st-camface { --c: 196, 140, 70; }
.st-camstrip i.c-chase, .st-camstrip i.c-orbit, .st-camstrip i.c-side, .st-cam.c-chase .st-camface, .st-cam.c-orbit .st-camface, .st-cam.c-side .st-camface { --c: 80, 150, 215; }
.st-camstrip i.c-incoming, .st-cam.c-incoming .st-camface { --c: 150, 110, 210; }
.st-camstrip i.c-victim, .st-cam.c-victim .st-camface { --c: 205, 85, 75; }
.st-cam.c-placed .st-camface { --c: 232, 195, 90; }
.st-cams-list { display: flex; flex-direction: column; gap: 6px; }
.st-cam { display: grid; grid-template-columns: 24px 56px minmax(0, 1fr) 28px; align-items: start; gap: 7px; padding: 6px 0;
  border-bottom: 1px solid rgba(200, 194, 152, .08); }
.st-cam:last-child { border-bottom: 0; }
.st-cam > .st-camn, .st-cam > .st-icon { margin-top: 4px; }
.st-camn { appearance: none; width: 24px; height: 24px; border: 1.5px solid var(--rp-gold); border-radius: 50%; background: #17150f; color: var(--rp-gold);
  font: 800 11px var(--rp-font); cursor: pointer; padding: 0; }
.st-camn:hover { background: var(--rp-gold); color: #17150f; }
.st-cam .st-keypic { width: 56px; height: 32px; }
.st-camface { display: grid; place-items: center; width: 56px; height: 32px; border-radius: 4px; --c: 125, 125, 115; background: rgba(var(--c), .4);
  box-shadow: inset 0 0 0 1px rgba(var(--c), .9); color: #fff; }
.st-camface .rc-cb-icon { width: 20px; height: 20px; stroke-width: 2; }
.st-cammain { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.st-cammain > .st-select { width: 100%; height: 30px; font-size: 13px; font-weight: 700; }
.st-camline { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; }
.st-camline .st-btn.st-small { height: 26px; padding: 0 8px; gap: 5px; }
.st-camline .st-btn.st-small .st-glyph { width: 13px; height: 13px; }
.st-camline .st-keyt { flex: none; font-size: 11px; }
.st-camline .st-select { flex: 1; min-width: 0; height: 26px; padding: 0 6px; font-size: 12px; }
.st-camline .st-small { height: 28px; align-self: auto; }
.st-group[hidden] { display: none; }
/* Clear's menu. */
.st-menuwrap { position: relative; display: inline-flex; }
.st-menu { position: absolute; top: calc(100% + 6px); left: 0; z-index: 4; display: flex; flex-direction: column; gap: 2px; width: 280px; padding: 5px;
  border: 1px solid var(--rp-edge); border-radius: 7px; background: #17150f; box-shadow: 0 10px 28px rgba(0, 0, 0, .6); }
.st-menu[hidden] { display: none; }
.st-menuitem { appearance: none; display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; border: 0; border-radius: 5px; background: none;
  color: var(--rp-ink); text-align: left; cursor: pointer; font: inherit; }
.st-menuitem:hover, .st-menuitem:focus-visible { background: rgba(255, 255, 255, .08); outline: none; }
.st-menuitem b { font-size: 13px; }
.st-menuitem small { color: var(--rp-muted); font-size: 11px; line-height: 1.3; }
.st-strip .rc-cb { padding: 0; }
.st-strip .rc-cb-pop { bottom: calc(100% + 6px); }
@media (max-width: 1280px) { .st-hint { display: none; } }
@media (max-width: 1100px) { .st-where { display: none; } .st-name { max-width: 20vw; } }
`;
