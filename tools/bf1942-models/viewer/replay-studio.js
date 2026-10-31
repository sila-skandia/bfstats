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
// The inspector's tabs: Camera (the shot style up to the first keyframe,
// bullet time, the keyframes with their moves, the lens), Look (one-click
// recipes, the grade, the vignette, the frame), Text (a title, a lower third
// that writes itself from the kill, a channel tag), Effects (fades, and the
// flash, zoom punch, shake and freeze on the kill; the slow motion) and Clips
// (record, a thumbnail, the kept clips). Every change is one step of undo.

import { FOV_RANGE, fmt } from './replay-creator-panel.js';
import { END_MOVES, HANDOVERS, KEY_MOVES } from './replay-camtrack.js';
import { moveIcon } from './replay-clipbar.js';
import { SHOT_STYLES } from './replay-shotstyle.js';
import { RAMP_SPEEDS, keysIn, rampSpanOf, screenSeconds, speedWord } from './replay-shot.js';
import { FADES, FRAMES, FREEZES, GRADES, drawOverlay, drawSafeArea, editsOf, editsShow, gradeOf } from './replay-studio-fx.js';

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

const TABS = Object.freeze([
  ['kills', 'Kills'],
  ['camera', 'Camera'],
  ['look', 'Look'],
  ['text', 'Text'],
  ['fx', 'Effects'],
  ['clips', 'Export'],
]);

/** Sizes the studio leaves the monitor, CSS px. */
const TOP_H = 52;
const SIDE_W = 356;
const DOCK_H = 214;
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
    ui.flash('Studio · right-click the strip\'s lanes, pick a recipe on the right, Esc to leave', 3200);
  }

  close() {
    if (!this.open) return;
    const creator = this.creator;
    if (creator.recorder) creator.stopRecording(false);
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
    const rel = t - span.t0;
    const clock = `${rel < 0 ? '-' : ''}${fmt(Math.abs(rel))} / ${fmt(span.t1 - span.t0)}`;
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
      for (const [id, b] of Object.entries(this.camBtns)) b.classList.toggle('on', id === cam);
      this.hint.textContent = cam === 'free'
        ? 'WASD fly · drag to look · Q / E down, up · K keyframes the view'
        : 'Right-click a lane · drag to move · K keyframes the view';
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
    const frames = this.seg(FRAMES.filter(([id]) => id !== 'none').map(([id, label]) => [id, label.split(' · ')[0], label]),
      () => creator.prefs.frame, v => {
        creator.setPref('frame', v);
        creator.saveKept();
        this.place();
      }, 'st-frames');
    this.thumbBtn = this.btn('Thumbnail', 'Save this frame as a PNG, for the video\'s thumbnail', () => creator.thumbnail(), 'st-ghost', 'image');
    this.recBtn = this.btn('Record', 'Record the clip to a video file, full size in its frame (Esc stops)', () => this.record(), 'st-rec-btn', 'rec');
    const done = this.btn('', 'Leave the studio (Esc)', () => this.close(), 'st-ghost st-close', 'close');
    top.append(brand, this.undoBtn, this.redoBtn, el('span', 'st-gap'), frames, this.thumbBtn, this.recBtn, done);

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
    const key = this.btn('Keyframe', 'Keyframe the view on screen at the playhead (K)', () => creator.keyframeHere(), 'st-ghost', 'key');
    this.hint = el('span', 'st-hint', 'Right-click a lane · drag to move · K keyframes the view');
    // Which camera is on the monitor: the clip's own, or one taken by hand
    // through the replay's own buttons (which let the clip's camera go).
    const cams = el('div', 'st-seg st-cams');
    this.camBtns = {};
    for (const [id, label, title] of [
      ['clip', 'Clip camera', 'The clip\'s own camera: its shot style and keyframes, from its start (P)'],
      ['orbit', 'Orbit', 'Round the man followed; drag to swing (1)'],
      ['pov', 'His eyes', 'First person (2)'],
      ['free', 'Free fly', 'Fly anywhere: WASD to move, drag to look, Q and E down and up (3)'],
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
          } else creator.ui.modeBtns?.[id]?.click();
        } catch (error) { console.warn('studio: a camera', error); }
      });
      this.camBtns[id] = b;
      cams.append(b);
    }
    transport.append(toStart, back, this.playBtn, fwd, toEnd, this.clock, this.where, this.speedText, el('span', 'st-gap'), this.hint, cams, key);
    this.stripHost = el('div', 'st-strip');
    dock.append(transport, this.stripHost);

    // While recording: only a chip with the time and Stop.
    const recbar = el('div', 'st-recbar');
    this.recLabel = el('span', '', 'REC');
    recbar.append(this.recLabel, this.btn('Stop', 'Stop and save (Esc)', () => creator.stopRecording(true), 'st-rec-btn on', 'rec'));

    root.append(top, side, dock, recbar);
    this.el = root;
    this.setTab(this.tab);
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
    const input = which === 'lower' ? this.lowerInput : this.titleInput;
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
    const sig = [creator.snapshot(), creator.rounds.style, creator.prefs.pace, creator.prefs.thirds, creator.lens.fov, creator.lens.roll,
      creator.clips.length, this.tab, creator.take?.f?.t, creator.takeHeld, this.momentMode, creator.player.followPid].join('|');
    if (!force && sig === this.sig) return;
    this.sig = sig;
    for (const fn of this.syncs) {
      try { fn(); } catch (error) { console.warn('studio: a control', error); }
    }
    const take = creator.fxKill.take;
    const lines = creator.lowerLines();
    this.titleText.textContent = take ? `Kill shot · ${lines?.[0] ?? ''}${lines?.[1] ? ` · ${lines[1]}` : ''}` : 'Clip';
    this.syncKeys(force);
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

  /** A row of choices: `[value, label, title?, glyph?]`. */
  seg(items, get, set, cls = '') {
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
    this.syncs.push(() => {
      const now = get();
      for (const [value, b] of buttons) {
        b.classList.toggle('on', value === now);
        b.setAttribute('aria-pressed', String(value === now));
      }
    });
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
    const mode = this.seg([['best', 'Best'], ['time', 'In order'], ['his', 'His']], () => this.momentMode, v => { this.momentMode = v; },
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
    const chaseOn = this.check('Chase the round', () => creator.edits.chase !== false, v => creator.setChase(v),
      'The kill shot films its round in the style below; off, your keyframes film the whole clip');
    const styles = this.seg(SHOT_STYLES.filter(([id]) => id !== 'fixed').map(([id, label, title]) => [id, label, title, `style:${id}`]),
      () => (creator.takeHeld || creator.edits.chase === false ? null : creator.rounds.style), v => creator.setShotStyle(v), 'st-styles');
    const handover = which => this.seg(HANDOVERS.map(([id, label, title]) => [id, label, title, id]), () => creator.edits[which],
      v => creator.setHandover(which, v));
    const into = handover('into');
    const out = handover('out');
    const pace = this.seg([['off', 'Off'], ['subtle', 'Subtle'], ['strong', 'Strong'], ['extreme', 'Extreme']],
      () => creator.prefs.pace, v => creator.setBulletTime(v));
    this.keyList = el('div', 'st-keys');
    const add = this.btn('Keyframe the view now', 'The view on screen at the playhead (K)', () => creator.keyframeHere(), 'st-wide', 'key');
    const fov = this.slider('Field of view', FOV_RANGE[0], FOV_RANGE[1], 1, () => creator.lens.fov ?? 70,
      v => creator.setFov(v), v => (creator.lens.fov === null ? 'auto' : `${Math.round(v)}°`));
    const roll = this.slider('Dutch roll', -30, 30, 1, () => creator.lens.roll, v => creator.setRoll(v), v => `${Math.round(v)}°`);
    const lensAuto = this.btn('Lens back to auto', 'The page\'s own field of view, no roll', () => {
      creator.setFov(null);
      creator.setRoll(0);
    }, 'st-ghost st-small');
    page.append(
      this.group('The chase', chaseOn, styles,
        this.note('How the round is filmed from the shot to the hit. Drag the view while it flies to swing round it; the next time round keeps it.')),
      this.group('Into the chase', into, this.note('From your keyframes before the shot, as the round leaves.')),
      this.group('Out of the chase', out, this.note('To your first keyframe after the hit, once the round lands. Cut snaps to it.')),
      this.group('Bullet time', pace),
      this.group('Keyframes', this.keyList, add, this.note('Keyframes before the shot are the lead-in, after the hit the lead-out. Pause, fly the camera (Free fly), keyframe it; pick each one\'s move here or by right-clicking it on the strip.')),
      this.group('Lens', fov, roll, lensAuto, this.note('A keyframe keeps the field of view it was made with: zoom in for the next one for a push.')),
    );
  }

  syncKeys(force) {
    const creator = this.creator;
    const span = creator.span;
    const keys = keysIn(creator.keys, span);
    const sig = keys.map(k => `${k.t}:${k.move ?? ''}`).join(',') + creator.moveStyle + creator.keyShots.size;
    if (!force && sig === this.keySig) return;
    this.keysWaiting = false;
    this.keySig = sig;
    this.keyList.textContent = '';
    if (!keys.length) {
      this.keyList.append(this.note('None yet: the shot style films the whole clip.'));
      return;
    }
    const shotT = creator.chaseSpan(span)?.t0 ?? null;
    keys.forEach((key, i) => {
      const lead = shotT !== null && key.t < shotT - 1e-3;
      // The last keyframe of the lead-in moves on until the shot.
      const last = i === keys.length - 1 || (lead && !(keys[i + 1].t < shotT - 1e-3));
      const row = el('div', 'st-key');
      const n = el('button', 'st-keyn', String(i + 1));
      n.type = 'button';
      n.title = 'Look through it';
      n.addEventListener('click', () => creator.lookAtKey(key));
      const at = el('span', 'st-keyt', `+${fmt(key.t - span.t0)}`);
      if (shotT !== null) at.append(el('small', 'st-part', lead ? 'lead-in' : 'lead-out'));
      const pick = el('select', 'st-select');
      pick.title = last ? (lead ? 'How the camera goes on until the shot' : 'How the camera goes on to the clip\'s end') : `How the camera goes to keyframe ${i + 2}`;
      const list = last ? END_MOVES : KEY_MOVES;
      const current = list.some(([m]) => m === key.move) ? key.move : last ? 'hold' : creator.moveStyle;
      for (const [id, label] of list) {
        const o = el('option', '', `${last ? '' : '→ '}${label}`);
        o.value = id;
        o.selected = id === current;
        pick.append(o);
      }
      pick.addEventListener('change', () => creator.setKeyMove(key, pick.value));
      pick.addEventListener('keydown', e => e.stopPropagation());
      const glyph = moveIcon(current) ?? el('span');
      const drop = this.btn('', 'Delete this keyframe', () => creator.deleteKey(key), 'st-ghost st-icon', 'close');
      // What the keyframe sees: a click looks through it.
      const pic = el('canvas', 'st-keypic');
      pic.width = 112;
      pic.height = 63;
      pic.title = 'Look through it';
      const shot = creator.keyShot(key);
      if (shot) pic.getContext('2d').drawImage(shot, 0, 0, shot.width, shot.height, 0, 0, pic.width, pic.height);
      else this.keysWaiting = true;
      pic.addEventListener('click', () => creator.lookAtKey(key));
      const line = el('div', 'st-keyline');
      line.append(at, glyph, pick);
      row.append(n, pic, line, drop);
      this.keyList.append(row);
    });
  }

  buildLook(page) {
    const creator = this.creator;
    const recipes = el('div', 'st-recipes');
    for (const [id, label, title, edits, frame] of RECIPES) {
      const b = el('button', 'st-recipe');
      b.type = 'button';
      b.title = title;
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
    page.append(
      this.group('Title', titleOn, titleRow, titleDur, this.note('Over the middle of the frame, ruled in gold. Drag it on the Text lane to move it.')),
      this.group('Lower third', lowerOn, lowerRow, lowerDur, lowerReset, this.note('Left blank it writes itself from the kill: the shooter, the weapon, the man killed, the distance.')),
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
    const speeds = this.seg(RAMP_SPEEDS.filter(v => v < 1).map(v => [v, speedWord(v)]), () => (creator.ownSlow() ? creator.ramp.speed : null), v => {
      const span = creator.span;
      const at = creator.ownSlow() ? rampSpanOf(creator.ramp, span) : creator.autoSlow(span) ?? creator.clipAction ?? { t0: span.t0, t1: span.t1 };
      creator.setSlowRange(at.t0, at.t1, v);
    });
    const clear = this.btn('No slow motion of my own', 'Remove the clip\'s own slow motion: the kill shot\'s bullet time comes back', () => creator.clearSlow(), 'st-ghost st-small');
    this.syncs.push(() => {
      const span = creator.span;
      const own = creator.ownSlow() ? rampSpanOf(creator.ramp, span) : null;
      const auto = creator.autoSlow(span);
      this.slowLine.textContent = own
        ? `Yours: ${speedWord(creator.ramp.speed)} from +${fmt(own.t0 - span.t0)} to +${fmt(own.t1 - span.t0)}. About ${Math.round(screenSeconds(creator.ramp, span, span.t0, span.t1))} s to watch.`
        : auto ? `The kill shot's bullet time (${creator.prefs.pace}) from +${fmt(auto.t0 - span.t0)} to +${fmt(auto.t1 - span.t0)}. Pick a speed to make it your own.`
          : 'Normal speed. Pick a speed, or drag across the Speed lane.';
      clear.hidden = !own;
    });
    page.append(
      this.group('Fade in from black', fadeIn),
      this.group('Fade out to black', fadeOut),
      this.group('On the kill', flash, punch, shake, el('span', 'st-label', 'Freeze frame'), freeze, killNote),
      this.group('Slow motion', this.slowLine, speeds, clear),
    );
  }

  buildClips(page) {
    const creator = this.creator;
    const rec = this.btn('Record the clip', 'The clip to a video file, full size in its frame, with its sound', () => this.record(), 'st-wide st-rec-btn', 'rec');
    const thumb = this.btn('Save a thumbnail', 'This frame as a PNG, cropped, graded and with its text', () => creator.thumbnail(), 'st-wide', 'image');
    this.sizeText = el('b', '', '');
    this.watchText = el('span', '', '');
    const facts = el('p', 'st-note st-facts');
    facts.append('Output ', this.sizeText, ' · ', this.watchText);
    this.syncs.push(() => {
      const span = creator.span;
      this.sizeText.textContent = this.outputSize();
      this.watchText.textContent = span ? `about ${Math.round(screenSeconds(creator.ramp, span, span.t0, span.t1))} s` : '';
    });
    const keep = this.btn('Keep the clip', 'Keep it with its camera, slow motion, look, text and effects', () => creator.saveClip(), 'st-wide st-ghost', 'plus');
    this.clipList = el('div', 'st-clips');
    const montage = this.btn('Record a montage', 'Every kept clip, one after another, as one video', () => this.record({ montage: true }), 'st-wide', 'film');
    const montageNote = el('p', 'st-note');
    this.syncs.push(() => {
      const n = creator.clips.length;
      montage.disabled = n < 2;
      montage.lastChild.textContent = n >= 2 ? `Record a montage of ${n} clips` : 'Record a montage';
      const secs = creator.clips.reduce((sum, c) => sum + screenSeconds(c.ramp ?? { speed: 1, in: null, out: null }, { t0: c.in, t1: c.out }, c.in, c.out), 0);
      montageNote.textContent = n >= 2
        ? `In the order they happened, each with its own camera, slow motion, look and effects: about ${Math.round(secs)} s.`
        : 'Keep two clips or more for a montage.';
    });
    page.append(
      this.group('Export', rec, thumb, facts, this.note('Recording plays the clip in real time, slow motion included, and saves it when it ends. Keep other windows quiet while it runs.')),
      this.group('Kept clips', keep, this.clipList, montage, montageNote),
    );
  }

  syncClips(force) {
    const creator = this.creator;
    const sig = creator.clips.map(c => `${c.name}|${c.in}|${c.out}`).join(';');
    if (!force && sig === this.clipSig) return;
    this.clipSig = sig;
    this.clipList.textContent = '';
    if (!creator.clips.length) {
      this.clipList.append(this.note('None kept yet.'));
      return;
    }
    for (const clip of creator.clips) {
      const row = el('div', 'st-clip');
      const name = el('input', 'st-clipname');
      name.value = clip.name;
      name.title = 'Rename';
      name.setAttribute('aria-label', 'Clip name');
      name.addEventListener('change', () => {
        creator.renameClip(clip, name.value);
        this.clipSig = '';
      });
      const when = el('span', 'st-keyt', `${fmt(clip.in)}-${fmt(clip.out)}`);
      row.append(name, when,
        this.btn('', 'Open this clip', () => creator.useClip(clip), 'st-ghost st-icon', 'play'),
        this.btn('', 'Forget this clip', () => creator.removeClip(clip), 'st-ghost st-icon', 'close'));
      this.clipList.append(row);
    }
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
  plus: 'M12 5v14M5 12h14',
  film: 'M4 4h16v16H4zM8 4v16M16 4v16M4 9h4M4 15h4M16 9h4M16 15h4',
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
.st-group:last-child { border-bottom: 0; }
.st-group h3 { margin: 0; color: var(--rp-muted); font: 800 10px var(--rp-font); letter-spacing: .16em; text-transform: uppercase; }
.st-label { color: var(--rp-muted); font-size: 12px; }
.st-note { margin: 0; color: var(--rp-muted); font-size: 12px; line-height: 1.45; }
.st-note[hidden] { display: none; }
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
.st-clips { display: flex; flex-direction: column; gap: 4px; }
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
.st-strip .rc-cb { padding: 0; }
.st-strip .rc-cb-pop { bottom: calc(100% + 6px); }
@media (max-width: 1280px) { .st-hint { display: none; } }
@media (max-width: 1100px) { .st-where { display: none; } .st-name { max-width: 20vw; } }
`;
