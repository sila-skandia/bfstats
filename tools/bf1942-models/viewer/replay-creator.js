// The creator view (features/replay-creator-view): the round replay for the
// people who make videos of it. On the replay's bar for a signed-in player (and on a
// page served from this PC), it adds, over the replay's own chrome:
//
//   picking       the 3D view is live to the pointer: a man, a vehicle or a
//                 round in flight is ringed and named under it, and a click
//                 follows the man, the vehicle's crew, or chases the round;
//                 a double-click looks through the man's eyes (replay-pick.js);
//   the round cam a camera riding behind a round to what it hits, in bullet
//                 time, from a click, the next round of his that kills (5),
//                 the next one big enough to watch (6), or a kill in his
//                 highlights, set up over his shoulder before he fires
//                 (replay-roundcam.js);
//   highlights    the followed man's round sliced -- streaks, longest shots,
//                 multi-kills, vehicles, deaths, weapons -- each a click from
//                 its moment with a lead-in (replay-dossier.js, the panel);
//   the shot      in and out points on the timeline (I, O), a camera move
//                 across them (A and B keep the view at each end), slow
//                 motion over the whole of it or part of it, played or looped
//                 (P) and recorded to a video file from the canvas alone
//                 (replay-shot.js, replay-camtrack.js, replay-clip.js); a
//                 shot kept as a clip keeps its camera and its slow motion;
//   the lens      field of view and a dutch roll, letterbox guides and a
//                 rule-of-thirds grid.
//
// It owns only its own DOM and state; the replay's player (replay.js) calls
// its `lead` before the camera is placed and its `update` after the frame,
// its keys come first in the replay's key map (replay-ui.js), and the camera
// takes its rigs and lens (replay-camera.js `setRig`, `setLensHook`).

import * as THREE from 'three';
import { isLocalHost, resolveApi, sharedRecordingsApi } from './recordings-api.js';
import { nameAt, teamAt } from './replay-recording.js';
import { RoundCam, BULLET_TIME, bulletTimeSpan, heavyRound, nextShotOf } from './replay-roundcam.js';
import { LeadInRig, TrackRig, addKey, keyOf, keyValid, moveStyleOf, pathPoints } from './replay-camtrack.js';
import { pickAt, pickCandidates, shotOfRound } from './replay-pick.js';
import { ClipRecorder, clipName, download, recorderMime } from './replay-clip.js';
import { dossierOf, killFactsOf } from './replay-dossier.js';
import { RAMP_SPEEDS, actionOf, fitKeys, keysIn, killByFire, nextKillShot, noRamp, rampBetweenKeys, rampOf, rampSpanOf, rampSpeedAt, ramping, speedWord } from './replay-shot.js';
import { CreatorPanel, FOV_RANGE, LEAD_INS, fmt } from './replay-creator-panel.js';
import { STYLE_IDS, angleOf, isMelee, styleLabel, styleOf, suggestAngles } from './replay-shotstyle.js';
import { whereIs } from './replay-battles.js';
import { CHARACTER_HEIGHT } from './soldier-pose.js';
import { ClipBar, crossedOut } from './replay-clipbar.js';

/** Seconds a clip set from a moment runs on past it. */
const TAIL = 2.5;
/** A take's tail: long enough that the man is seen down and the camera has
 *  settled before the loop goes round, rather than cutting on the kill. */
const TAKE_TAIL = 4;
/** A move's preview starts this long before its start and stops this long
 *  after its end, seconds. */
const PREVIEW_PAD = 0.75;
/** A recording starts this long before its in point, so the bodies a seek
 *  rebuilds and the rounds it refires are settled when the clip begins. */
const SETTLE = 0.8;
/** A pointer that moves less than this, pixels, between down and up is a
 *  click on the view, not a drag of the camera; one held longer is a hold. */
const CLICK_SLOP = 5;
const CLICK_TIME = 450;
const ROLL_MAX = 30;
/** How often the panel redraws, seconds. */
const PANEL_TICK = 0.25;
/** A round clicked that kills nobody is traded for its shooter's killing
 *  round when he makes one within this long: most rounds of a burst hit
 *  nothing, and the one worth riding is the one that kills. */
const SNAP_AHEAD = 2.5;
/** A kill shot further ahead than this is jumped to rather than waited for. */
const SKIP_AHEAD = 8;
/** How much a killing round is wanted over the rounds around it under the
 *  pointer (replay-pick.js `bonus`). */
const KILL_FIRST = 0.8;
/** Seconds the in and out points move by a nudge. */
const NUDGE = 0.1;
/** The least a dragged clip keeps between its ends, seconds. */
const DRAG_GAP = 0.2;

const PREFS_KEY = 'bf42-creator-prefs';
const STORE_KEY = 'bf42-creator:';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const _roll = new THREE.Quaternion();
const _z = new THREE.Vector3(0, 0, 1);

/** The part of a `w` x `h` view a frame guide keeps (`frame` a prefs value),
 *  whole pixels and even sizes for the encoder, or null for the whole view. */
/** A camera key's pose as a string: its picture's key, the same however its
 *  time moves. */
const poseSig = key => [...key.pos, ...key.quat].map(v => v.toFixed(3)).join(',');

export function cropOf(frame, w, h) {
  const aspect = { 239: 2.39, 185: 1.85, 916: 9 / 16 }[frame];
  if (!aspect || !(w > 0) || !(h > 0)) return null;
  let cw = w;
  let ch = w / aspect;
  if (ch > h) {
    ch = h;
    cw = h * aspect;
  }
  cw = Math.floor(cw / 2) * 2;
  ch = Math.floor(ch / 2) * 2;
  return { x: Math.floor((w - cw) / 2), y: Math.floor((h - ch) / 2), w: cw, h: ch };
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A nicety that throws is a warning, never a frame or a click undone. */
function quietly(what, fn) {
  try {
    return fn();
  } catch (error) {
    console.warn(`creator: ${what} threw`, error);
    return undefined;
  }
}

function readJson(key, fallback) {
  try {
    const text = globalThis.localStorage?.getItem(key);
    return text ? JSON.parse(text) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    // A private window or a full store: kept for this page only.
  }
}

/**
 * Whether this visitor gets the creator view: anyone signed in to bfstats.io
 * (any role), or a page served from this PC, where the viewer is tested and
 * there is usually no API to sign in to. `onChange` is called again when the
 * sign-in changes (Share's sign-in, a sign-out). Never throws.
 */
export async function creatorAccess({ page = globalThis.location, onChange = null } = {}) {
  if (!page || isLocalHost(page.hostname)) return true;
  try {
    const api = sharedRecordingsApi(await resolveApi(page));
    if (onChange) api.onChange(() => onChange(api.signedIn));
    if (!api.signedIn) await api.ready();
    return api.signedIn;
  } catch (error) {
    console.warn('creator: the sign-in could not be read', error);
    return false;
  }
}

/** A `{ t0, t1 }` read back from the browser's storage, or null: one of them
 *  not a time of this round makes it nothing rather than a bad stretch. */
function spanIn(kept, inRound) {
  if (!kept || typeof kept !== 'object') return null;
  const { t0, t1 } = kept;
  return inRound(t0) && inRound(t1) && t1 > t0 ? { t0, t1 } : null;
}

/** Preferences kept across recordings: the lead-in, bullet time, what the
 *  camera does after a hit, the frame guides. */
function loadPrefs() {
  const kept = readJson(PREFS_KEY, {});
  return {
    leadIn: LEAD_INS.includes(kept.leadIn) ? kept.leadIn : 3,
    pace: Object.hasOwn(BULLET_TIME, kept.pace) ? kept.pace : 'strong',
    afterHit: ['victim', 'shooter', 'stay'].includes(kept.afterHit) ? kept.afterHit : 'victim',
    frame: ['none', '239', '185', '916'].includes(kept.frame) ? kept.frame : 'none',
    thirds: Boolean(kept.thirds),
    snapKill: kept.snapKill !== false,
    shotStyle: styleOf(kept.shotStyle),
    angleAim: kept.angleAim === 'lock' ? 'lock' : 'track',
  };
}

export class ReplayCreator {
  constructor(player) {
    this.player = player;
    this.ui = player.ui;
    this.ctx = player.ctx;
    this.granted = false;
    this.on = false;
    this.disposed = false;
    this.prefs = loadPrefs();
    this.lens = { fov: null, roll: 0 };
    // A clip loops by default: people try a shot again and again until it is
    // right, and a clip that plays on past its end loses their place.
    this.range = { in: null, out: null, loop: true };
    this.take = null;             // { f, kill }: the kill the clip is a shot of, re-armed each time round
    this.takeHeld = false;        // ... the camera taken by hand: the clip loops in it, the shot is not re-armed
    this.suggestions = null;      // { list, thumbs, job }: angles worth trying on the take (replay-shotstyle.js)
    this.editing = null;          // the clip editor open: { t, playing, pid, mode } to go back to (replay-clipbar.js)
    this.leadT = null;            // the clock at the last frame: the loop goes round when it crosses the out point
    this.keyShots = new Map();    // a camera key's pose -> a small picture of its view (`keyShot`)
    this.useMove = true;          // the clip filmed by the views kept (A to B) rather than the shot style, when it has two
    this.moveStyle = 'glide';     // how the camera gets from A to B (replay-camtrack.js MOVE_STYLES)
    this.shotWanted = null;       // the pose whose picture the next frame takes
    this.action = null;           // { t0, t1 }: what the clip is of, inside its ends (`beat`)
    this.ramp = noRamp();         // the shot's slow motion (replay-shot.js)
    this.ramped = null;           // { base, applied } while the ramp owns the clock
    this.clips = [];
    this.keys = [];
    this.track = null;            // the TrackRig while the track camera flies
    this.autoTrack = false;       // ... and it is the clip's own camera move
    this.pointer = null;          // the pointer over the view: { x, y } in the stage's pixels
    this.down = null;             // a press on the view that may be a click
    this.hover = null;            // what the pointer is over: pickAt's answer
    this.facts = null;            // every kill's facts, read the first time a dossier needs them
    this.fireKills = null;        // the kill each killing round made (replay-shot.js)
    this.roundShots = new WeakMap(); // a round in flight -> the shot that fired it and its kill
    this.dossierKey = '';
    this.subject = null;          // whose highlights the panel shows (`subjectPid`)
    this.quietPid = null;         // a man the creator's own camera followed, not the viewer
    this.panelClock = 0;
    this.recorder = null;         // { clip: ClipRecorder, t0, t1, started, speed }
    this.rounds = new RoundCam(player, {
      follow: pid => this.handTo(pid),
      free: (pos, quat) => this.freeAt(pos, quat),
      changed: () => this.syncPlate(),
      missed: () => this.ui.flash('That round was never drawn', 1800),
      clockOwned: () => this.ownSlow(),
    });
    this.applyPrefs();
    this.loadKept();
    // The gate is the API's, and it may take a moment: the bar gains the
    // button when it answers.
    creatorAccess({ onChange: admin => this.grant(admin) }).then(ok => this.grant(ok));
  }

  /** The recording's own key in the browser's storage: its level, its start
   *  and its length, so the same round finds its clips again. */
  get storeKey() {
    const { rec } = this.player;
    return `${STORE_KEY}${rec.level}|${rec.start}|${Math.round(rec.duration)}`;
  }

  loadKept() {
    const kept = readJson(this.storeKey, null);
    if (!kept) return;
    const d = this.player.rec.duration;
    const inRound = t => Number.isFinite(t) && t >= 0 && t <= d + 0.01;
    this.clips = (Array.isArray(kept.clips) ? kept.clips : [])
      .filter(c => inRound(c.in) && inRound(c.out) && c.out > c.in).slice(0, 200)
      .map(c => ({
        name: String(c.name ?? '').slice(0, 80), in: c.in, out: c.out, pid: Number.isInteger(c.pid) ? c.pid : null,
        // A clip kept since the shot's camera and slow motion: an older one
        // has neither, and loading it leaves what is on the bench alone.
        keys: Array.isArray(c.keys) ? c.keys.filter(k => keyValid(k) && inRound(k.t)).sort((a, b) => a.t - b.t) : null,
        ramp: c.ramp ? rampOf(c.ramp) : null,
        // The action inside it, where it was kept with one.
        action: spanIn(c.action, inRound),
        // Its shot style and placed camera, where it was kept with them.
        shot: c.shot ? { style: styleOf(c.shot.style), angle: angleOf(c.shot.angle), moveStyle: moveStyleOf(c.shot.moveStyle) } : null,
      }));
    this.rounds.angle = angleOf(kept.angle);
    this.moveStyle = moveStyleOf(kept.moveStyle);
    this.keys = (Array.isArray(kept.keys) ? kept.keys : []).filter(k => keyValid(k) && inRound(k.t)).sort((a, b) => a.t - b.t);
    if (inRound(kept.range?.in) && inRound(kept.range?.out) && kept.range.out > kept.range.in) {
      this.range.in = kept.range.in;
      this.range.out = kept.range.out;
    }
    this.ramp = rampOf(kept.ramp);
    if (!inRound(this.ramp.in)) this.ramp.in = null;
    if (!inRound(this.ramp.out)) this.ramp.out = null;
    this.action = spanIn(kept.action, inRound);
  }

  saveKept() {
    writeJson(this.storeKey, {
      clips: this.clips, keys: this.keys, ramp: this.ramp, action: this.action,
      range: { in: this.range.in, out: this.range.out }, angle: this.rounds.angle, moveStyle: this.moveStyle,
    });
  }

  savePrefs() {
    writeJson(PREFS_KEY, this.prefs);
  }

  applyPrefs() {
    this.rounds.bulletTime = Object.hasOwn(BULLET_TIME, this.prefs.pace) ? BULLET_TIME[this.prefs.pace] : BULLET_TIME.strong;
    this.rounds.afterHit = this.prefs.afterHit;
    this.rounds.style = this.prefs.shotStyle;
    if (this.rounds.angle) this.rounds.angle.aim = this.prefs.angleAim;
  }

  // --- the gate and the switch ---------------------------------------------------------

  /** The gate's answer: the button comes, or goes with the view. */
  grant(ok) {
    if (this.disposed) return;
    ok = Boolean(ok);
    if (ok === this.granted) return;
    this.granted = ok;
    if (ok) quietly('the creator view', () => this.install());
    else {
      this.toggle(false);
      this.button?.remove();
      this.button = null;
    }
  }

  /** The bar's button, the shortcuts' section and the panel, once. */
  install() {
    if (this.button || this.disposed) return;
    const ui = this.ui;
    this.button = ui.button('rc-btn', null, 'Creator view (V)', () => this.toggle(),
      `${CLAPPER}<span class="rp-label">Creator</span>`);
    ui.playersBtn.before(this.button);
    this.panel = new CreatorPanel(this);
    this.plate = this.buildPlate();
    this.reticle = el('div', 'rc-reticle');
    this.reticleLabel = el('div', 'rc-reticle-label');
    this.reticle.append(this.reticleLabel);
    this.frameGuide = el('div', 'rc-frame');
    // Under the chrome, over the view: the guides and the ring go in just
    // after the name tags; the plate and the panel on top.
    ui.tags.after(this.frameGuide, this.reticle);
    ui.root.append(this.plate, this.panel.el);
    this.clipbar = new ClipBar(this);
    ui.timeline.el.after(this.clipbar.el);
    this.rangeBand = el('div', 'rc-range');
    this.rangeIn = el('i', 'rc-range-in');
    this.rangeOut = el('i', 'rc-range-out');
    this.rangeSlow = el('i', 'rc-range-slow');
    this.rangeBand.append(this.rangeSlow, this.rangeIn, this.rangeOut);
    this.keyMarks = el('div', 'rc-keymarks');
    ui.timeline.track.append(this.rangeBand);
    ui.timeline.el.append(this.keyMarks);
    this.bindHandles();
    this.addHelp();
    this.bindPointer();
    this.onModeClick = () => {
      if (this.on && (this.rounds.active || this.track)) quietly('a camera button', () => this.stopRigs());
    };
    for (const b of Object.values(ui.modeBtns ?? {})) b.addEventListener('click', this.onModeClick, true);
    this.syncRange();
    this.syncKeyMarks();
    this.syncFrame();
  }

  /** The shortcuts overlay (?) gains the creator's keys. */
  addHelp() {
    const cols = this.ui.help?.querySelector('.rp-help-cols');
    if (!cols) return;
    const col = el('div', 'rc-help');
    col.innerHTML = `<h3>Creator view</h3><dl>${[
      ['V', 'creator view on / off'],
      ['click', 'follow a man, a vehicle\'s crew; chase a round'],
      ['double-click', 'his eyes'],
      ['5', 'his next kill as a take: its clip, looping'],
      ['shift 5', 'ride his next round, whatever it hits'],
      ['6', 'the next rocket, shell or grenade as a take'],
      ['G', 'the take\'s next shot style'],
      ['U', 'use this view as the take\'s camera'],
      ['X', 'stop the chase or the camera move'],
      ['I / O', 'the clip\'s in and out points'],
      ['drag', 'a gold handle trims the clip; a diamond moves a camera key'],
      ['P', 'play the clip'],
      ['K', 'keyframe the view on screen at the playhead (the + on the strip)'],
      ['drag', 'the playhead across a move: see the pan'],
      ['click', 'the move or the speed lane on the strip: how it moves, how slow'],
    ].map(([k, v]) => `<dt><kbd>${k}</kbd></dt><dd>${v}</dd>`).join('')}</dl>`;
    cols.append(col);
  }

  /** The view on or off (V, the button). Off, everything of the creator's
   *  stops: a chase, the track, a recording, the lens. */
  toggle(on = !this.on) {
    if (!this.granted && on) return;
    if (on === this.on) return;
    this.on = on;
    const root = this.ui.root;
    root.classList.toggle('rc-on', on);
    this.button?.classList.toggle('on', on);
    if (on) {
      // One panel on the right: the replay log and the comments give way.
      root.classList.remove('log-open', 'rs-open');
      this.ui.logBtn?.classList.remove('on');
      this.player.camera.setLensHook(cam => this.shapeLens(cam));
      this.subject = this.player.followPid;
      this.lastFollow = this.player.followPid;
      this.panel?.show();
      this.ui.flash('Creator view · click anyone, 5 rides the next kill shot', 3200);
    } else {
      this.closeEditor({ quiet: true });
      this.stopRecording(false);
      this.rounds.stop(false);
      this.rangePlaying = false;
      this.releaseRamp();
      this.stopTrack();
      this.player.camera.setLensHook(null);
      this.setHover(null);
      this.syncPath(false);
      this.ui.flash('Creator view off');
    }
    this.syncFrame();
    this.syncPlate();
  }

  // --- the keys ---------------------------------------------------------------------------

  /** One key, before the replay's own map (replay-ui.js `key`): true when it
   *  is taken here, undefined when it is not one of these. */
  key(e, once) {
    if (!this.granted) return undefined;
    if (e.code === 'KeyV') {
      if (once) this.toggle();
      return true;
    }
    if (!this.on) return undefined;
    // A camera picked by hand takes over from a chase or the track; the key
    // goes on to the replay's own map.
    if (/^(Digit|Numpad)[1-4]$|^KeyC$/.test(e.code) && (this.rounds.active || this.track)) {
      if (once) this.stopRigs();
      return undefined;
    }
    switch (e.code) {
      case 'KeyI': if (once) this.setIn(); return true;
      case 'KeyO': if (once) this.setOut(); return true;
      case 'KeyP': if (once) this.playRange(); return true;
      case 'KeyK': if (once) this.keyframeHere(); return true;
      case 'KeyX': if (once) this.stopAll(); return true;
      case 'KeyG': if (once) this.cycleShotStyle(); return true;
      case 'KeyU': if (once) this.useView(); return true;
      case 'Digit5': case 'Numpad5':
        if (once) {
          if (e.shiftKey) this.chaseNext();
          else this.chaseKillShot();
        }
        return true;
      case 'Digit6': case 'Numpad6': if (once) this.chaseHeavy(); return true;
      case 'Escape':
        if (this.clipbar && !this.clipbar.pop.hidden) {
          this.clipbar.closePop();
          return true;
        }
        if (this.editing && !this.recorder) {
          this.closeEditor();
          return true;
        }
        if (this.recorder || this.rounds.active || this.track || this.queue || this.rangePlaying) {
          this.stopAll();
          return true;
        }
        return undefined;
      default:
        return undefined;
    }
  }

  // --- picking in the view ---------------------------------------------------------------

  /** The view's pointer, beside the replay's own drag handling (replay-ui.js
   *  `bindPointer`): a press and a lift in one place is a click on whatever
   *  is under it. */
  bindPointer() {
    const input = this.ui.input;
    const at = e => {
      const r = this.ui.stage.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height };
    };
    this.onMove = e => {
      if (!this.on || e.pointerType === 'touch') return;
      this.pointer = at(e);
      if (this.down && Math.hypot(e.clientX - this.down.cx, e.clientY - this.down.cy) > CLICK_SLOP) this.down.moved = true;
    };
    this.onDown = e => {
      if (!this.on || e.button !== 0) return;
      this.down = { cx: e.clientX, cy: e.clientY, at: performance.now(), moved: false, p: at(e) };
    };
    this.onUp = e => {
      const down = this.down;
      this.down = null;
      if (!this.on || !down || down.moved || e.button !== 0 || performance.now() - down.at > CLICK_TIME) return;
      quietly('a click on the view', () => this.click(down.p, false));
    };
    this.onDouble = e => {
      if (!this.on) return;
      // The first click has already set the camera moving: what it picked is
      // what the double-click means.
      const last = this.lastClick;
      if (last && performance.now() - last.at < 700) quietly('a double-click on the view', () => this.act(last.cand, true));
      else quietly('a double-click on the view', () => this.click(at(e), true));
    };
    this.onLeave = () => {
      this.pointer = null;
      this.setHover(null);
    };
    input.addEventListener('pointermove', this.onMove);
    input.addEventListener('pointerdown', this.onDown);
    input.addEventListener('pointerup', this.onUp);
    input.addEventListener('dblclick', this.onDouble);
    input.addEventListener('pointerleave', this.onLeave);
  }

  /** What is under `p` (the stage's pixels) now, or null. */
  pickUnder(p) {
    if (!p) return null;
    const camera = this.ctx.camera;
    return pickAt(this.candidates(), camera, p.x, p.y, p.w, p.h);
  }

  /** Everything the pointer can pick now (replay-pick.js), each round in the
   *  air carrying the shot that fired it and the kill it makes: a killing
   *  round is asked for ahead of the rounds around it, so the one that
   *  counts is pickable in the middle of a burst. */
  candidates() {
    const t = this.player.time;
    const list = pickCandidates(this.player);
    for (const cand of list) {
      if (cand.kind !== 'round') continue;
      const known = this.roundFacts(cand.obj, t);
      cand.shot = known.f ?? false;
      cand.kill = known.kill;
      if (known.kill) cand.bonus = KILL_FIRST;
    }
    return list;
  }

  /** What fired a round in flight and whom it kills, worked out once for
   *  each round: `{ f, kill }`, `f` null where no recorded shot matches. */
  roundFacts(obj, t) {
    let known = this.roundShots.get(obj);
    if (!known) {
      const f = shotOfRound(this.player.rec.fires ?? [], obj, t);
      known = { f, kill: f ? this.killOfShot(f) : null };
      this.roundShots.set(obj, known);
    }
    return known;
  }

  /** The ring and the name over what the pointer is on; the view's cursor. */
  setHover(hit) {
    this.hover = hit;
    if (!this.reticle) return;
    this.ui.input.classList.toggle('rc-over', Boolean(hit));
    if (!hit) {
      this.reticle.classList.remove('show');
      return;
    }
    const d = Math.round(hit.r * 2 + 10);
    this.reticle.style.transform = `translate(${(hit.x - d / 2).toFixed(1)}px, ${(hit.y - d / 2).toFixed(1)}px)`;
    this.reticle.style.width = `${d}px`;
    this.reticle.style.height = `${d}px`;
    const { text, team } = this.labelOf(hit.cand);
    if (this.reticleLabel.textContent !== text) this.reticleLabel.textContent = text;
    this.reticle.className = `rc-reticle show k-${hit.cand.kind} t${team}${hit.cand.kill ? ' kills' : ''}`;
  }

  /** What a picked thing is called, and its side. */
  labelOf(cand) {
    const t = this.player.time;
    const display = key => this.display(key);
    if (cand.kind === 'soldier') return { text: cand.name ?? nameAt(this.player.rec, cand.pid, t), team: cand.team ?? 0 };
    if (cand.kind === 'hull') {
      const vehicle = display(cand.life?.tmpl);
      const lead = cand.crew.find(c => c.seat === 0) ?? cand.crew[0];
      if (!lead) return { text: `${vehicle} · empty`, team: cand.life?.team ?? 0 };
      const extra = cand.crew.length > 1 ? ` +${cand.crew.length - 1}` : '';
      return { text: `${nameAt(this.player.rec, lead.pid, t)} · ${vehicle}${extra}`, team: teamAt(this.player.rec, lead.pid, t) };
    }
    cand.shot ??= shotOfRound(this.player.rec.fires ?? [], cand.obj, t) ?? false;
    const f = cand.shot || null;
    cand.kill ??= f ? this.killOfShot(f) : null;
    const what = f?.weapon ? display(f.weapon) : cand.tracer ? 'Bullet' : 'Round';
    // A round known to kill says so: in a burst it is the one to ride.
    const tail = cand.kill ? `kills ${nameAt(this.player.rec, cand.kill.victim, cand.kill.t)}` : 'chase';
    return { text: f ? `${nameAt(this.player.rec, f.pid, t)}'s ${what} · ${tail}` : `${what} · ${tail}`, team: f ? teamAt(this.player.rec, f.pid, t) : 0 };
  }

  /** A click on the view: follow the man, the vehicle's crew (or look at an
   *  empty one), chase the round; `double`, his eyes. */
  click(p, double) {
    const hit = this.pickUnder(p);
    if (!hit) return;
    this.lastClick = { cand: hit.cand, at: performance.now() };
    this.act(hit.cand, double);
  }

  /** What a click on `cand` does. */
  act(cand, double) {
    if (cand.kind === 'round') {
      this.chaseRound(cand.obj, cand.shot || shotOfRound(this.player.rec.fires ?? [], cand.obj, this.player.time));
      return;
    }
    if (cand.kind === 'hull') {
      const lead = cand.crew.find(c => c.seat === 0) ?? cand.crew[0];
      if (lead) this.followPlayer(lead.pid, double ? 'pov' : null);
      else this.lookAtHull(cand);
      return;
    }
    this.followPlayer(cand.pid, double ? 'pov' : null);
  }

  /** Follow `pid` by hand: the Auto camera and any chase let go, the orbit
   *  close behind him (or `mode`). */
  followPlayer(pid, mode = null) {
    if (pid === null || pid === undefined) return;
    this.queue = null;
    this.rounds.stop(false);
    this.stopTrack();
    const highlights = this.player.highlights;
    if (highlights) highlights.follow(pid);
    else this.ui.follow(pid);
    if (mode) this.ui.setMode(mode);
    this.syncPlate();
  }

  /** An empty vehicle: the free camera a little off it, looking at it. */
  lookAtHull(cand) {
    this.rounds.stop(false);
    this.stopTrack();
    this.player.highlights?.setAuto(false, true);
    const camera = this.player.camera;
    const cam = this.ctx.camera;
    const r = Math.max(4, cand.radius);
    const from = cam.position.clone().sub(cand.pos).setY(0);
    if (from.lengthSq() < 1e-6) from.set(0, 0, 1);
    from.normalize().multiplyScalar(r * 2.6);
    const pos = cand.pos.clone().add(from).setY(cand.pos.y + r * 0.9);
    this.freeAt(pos, null, cand.pos);
    this.ui.flash(this.display(cand.life?.tmpl));
  }

  /** Whose highlights the panel shows: the man last followed by the viewer
   *  (a click, the players list, the card's arrows, the Auto camera), not
   *  one the bullet cam took the view to. */
  subjectPid() {
    return this.subject ?? this.player.followPid;
  }

  /** Follow `pid` for the creator's own camera: the panel stays on its man. */
  followQuietly(pid) {
    if (pid === null || pid === undefined || pid === this.player.followPid) return;
    this.quietPid = pid;
    this.player.follow(pid);
  }

  /** A change of the followed man, seen once a frame: the viewer's own makes
   *  him the panel's subject. */
  noteFollow() {
    const pid = this.player.followPid;
    if (pid === this.lastFollow) return;
    this.lastFollow = pid;
    if (pid === this.quietPid) {
      this.quietPid = null;
      return;
    }
    this.subject = pid;
    // Somebody followed by hand (the players list, a tag, the battle map):
    // the creator's camera lets go.
    if (this.rounds.active || this.track) this.stopRigs();
  }

  /** A chase or the track let go, the camera to its mode. A take goes on
   *  looping in the camera taken by hand -- that is setting it yourself --
   *  until a shot style is picked again. */
  stopRigs() {
    this.queue = null;
    if (this.take && !this.takeHeld) {
      this.takeHeld = true;
      this.ui.flash('Your camera · the clip keeps looping · Use this view keeps it', 2600);
    }
    this.rounds.stop(false);
    this.stopTrack(false);
    this.syncPlate();
  }

  /** Where the round cam hands the view after a hit: the orbit on `pid`,
   *  seen from where the chase ended. */
  handTo(pid) {
    const camera = this.player.camera;
    const cam = this.ctx.camera;
    if (camera.mode !== 'orbit') camera.setMode('orbit');
    this.followQuietly(pid);
    // The orbit picks up on the side of him the chase camera already is.
    const w = this.player.highlights?.model.where(pid, this.player.time);
    if (w?.pos) {
      const dx = cam.position.x - w.pos[0];
      const dz = cam.position.z - w.pos[2];
      if (Math.hypot(dx, dz) > 0.5) {
        camera.yaw = Math.atan2(dx, dz);
        camera.eased.yaw = camera.yaw;
        camera.aimed = true;
      }
    }
    camera.zoom = Math.min(camera.zoom, 1.2);
    this.ui.syncMode();
  }

  /** The free camera at `pos`, turned as `quat`, or looking at `look`. */
  freeAt(pos, quat = null, look = null) {
    const camera = this.player.camera;
    if (camera.mode !== 'free') camera.setMode('free');
    camera.free.pos.copy(pos);
    const e = new THREE.Euler(0, 0, 0, 'YXZ');
    if (look) {
      const d = look.clone().sub(pos);
      camera.free.yaw = Math.atan2(-d.x, -d.z);
      camera.free.pitch = clamp(Math.atan2(d.y, Math.hypot(d.x, d.z)), -1.5, 1.5);
    } else if (quat) {
      e.setFromQuaternion(quat, 'YXZ');
      camera.free.yaw = e.y;
      camera.free.pitch = clamp(e.x, -1.5, 1.5);
    }
    this.ui.syncMode();
  }

  // --- the round cam ----------------------------------------------------------------------

  /** Chase a round in flight (a click on it), paused or not. One that kills
   *  nobody is traded for the killing round of its burst where the man
   *  firing makes one within SNAP_AHEAD (the `snapKill` preference): a click
   *  into a machine gun's stream otherwise rides a round into the dirt. */
  chaseRound(obj, f = null) {
    this.releaseRamp();
    this.stopTrack();
    this.player.highlights?.setAuto(false, true);
    this.player.highlights?.stopReel();
    let round = obj;
    let shot = f;
    let kill = f ? this.killOfShot(f) : null;
    if (!kill && f && this.prefs.snapKill && !heavyRound(f.weapon)) {
      // His killing round already in the air beats the one clicked; one he
      // has yet to fire is waited for over his shoulder.
      const live = this.liveKillRound(f.pid);
      if (live && live.obj !== obj) {
        round = live.obj;
        shot = live.f;
        kill = live.kill;
      } else {
        const soon = this.burstKill(f);
        if (soon) {
          this.rideShot(soon.f, soon.kill, 'Kill shot');
          return;
        }
      }
    }
    if (this.rounds.chaseObject(round, shot, { kill })) {
      this.ui.flash(kill ? `Bullet cam · kills ${nameAt(this.player.rec, kill.victim, kill.t)}` : 'Bullet cam');
    }
  }

  /** A round of `pid`'s in the air now that kills somebody: the round of the
   *  burst worth riding, when it has already left. Drawn or not -- a hand
   *  weapon's round is `invisible 1` and the chase draws its own. */
  liveKillRound(pid) {
    const guns = this.ctx.guns;
    if (!guns) return null;
    const t = this.player.time;
    for (const list of [guns.projectiles ?? [], guns.tracers ?? []]) {
      for (const round of list) {
        if (!round.mesh) continue;
        const known = this.roundFacts(round, t);
        if (known.kill && known.f?.pid === pid) return { obj: round, f: known.f, kill: known.kill };
      }
    }
    return null;
  }

  /** The killing round of the burst shot `f` belongs to: its man's next one
   *  within SNAP_AHEAD, or null. A rocket or a shell is one round a shot and
   *  is ridden as clicked. */
  burstKill(f) {
    if (!f || !this.prefs.snapKill || heavyRound(f.weapon)) return null;
    const t = this.player.time;
    const next = nextKillShot(this.killFacts(), f.pid, t);
    return next && next.f.t - t <= SNAP_AHEAD ? next : null;
  }

  /**
   * The next round that kills (5): the followed man's, else anybody's in the
   * round. The chase ends on the man it killed as he falls, which is the
   * shot people want; his very next round is as likely to be the ninth of a
   * burst into a wall.
   */
  chaseKillShot() {
    const player = this.player;
    const t = player.time;
    const pid = this.on ? this.subjectPid() : player.followPid;
    const facts = this.killFacts();
    const mine = pid === null || pid === undefined ? null : nextKillShot(facts, pid, t);
    const next = mine ?? nextKillShot(facts, null, t);
    if (!next) {
      this.ui.flash('No more kills after this point', 2000);
      return;
    }
    const name = who => nameAt(player.rec, who, t);
    if (!mine && pid !== null && pid !== undefined) {
      this.ui.flash(`${name(pid)} has no more kills · riding ${name(next.f.pid)}'s`, 2400);
      this.subject = next.f.pid;
    }
    this.startTake(next.f, next.kill, isMelee(next.f.weapon) ? 'Knife kill' : 'Kill shot');
  }

  /** A kill picked off the timeline (its tooltip's Kill shot): the creator
   *  view on, the kill's round as a take, framed round it and looping, as 5
   *  does for the next one. False when the recording ties no round to it. */
  killShotAt(t, victim) {
    if (!this.granted) return false;
    const hit = this.killAt(t, victim);
    const f = hit?.round?.f ?? null;
    if (!f) {
      this.ui.flash('The recording ties no round to that kill', 2200);
      return false;
    }
    if (!this.on) this.toggle(true);
    this.subject = f.pid;
    this.startTake(f, hit.kill, isMelee(f.weapon) ? 'Knife kill' : 'Kill shot');
    return true;
  }

  /** The next round big enough to watch (6): a rocket, a shell, a bomb or a
   *  grenade, the followed man's else anybody's. One round a shot, slow in
   *  the air -- what a bullet cam is for. */
  chaseHeavy() {
    const player = this.player;
    const t = player.time;
    const pid = this.on ? this.subjectPid() : player.followPid;
    const mine = pid === null || pid === undefined ? null : nextShotOf(player.rec, pid, t, { heavy: true });
    const f = mine ?? nextShotOf(player.rec, null, t, { heavy: true });
    if (!f) {
      this.ui.flash('No more rockets, shells or grenades after this point', 2200);
      return;
    }
    if (!mine) this.subject = f.pid;
    this.startTake(f, this.killOfShot(f), this.display(f.weapon) || 'Big round');
  }

  /** The followed man's next round (shift 5), whatever it goes on to hit. */
  chaseNext() {
    const player = this.player;
    const pid = this.on ? this.subjectPid() : player.followPid;
    if (pid === null || pid === undefined) {
      this.ui.flash('Follow somebody first', 1800);
      return;
    }
    const f = nextShotOf(player.rec, pid, player.time);
    if (!f) {
      this.ui.flash(`${nameAt(player.rec, pid, player.time)} fires no more`, 1800);
      return;
    }
    this.rideShot(f, this.killOfShot(f), 'Next round');
  }

  /** The round cam set on recorded shot `f`: waiting over the shooter's
   *  shoulder for one a few seconds off, jumped to with the lead-in for one
   *  further away than SKIP_AHEAD -- nobody waits a minute for a rocket. */
  rideShot(f, kill = null, word = 'Round') {
    const player = this.player;
    const wait = f.t - player.time;
    if (wait > SKIP_AHEAD) player.seek(Math.max(0, f.t - this.prefs.leadIn));
    this.armShot(f, kill);
    player.playing = true;
    const hit = kill?.victim !== null && kill?.victim !== undefined ? ` · kills ${nameAt(player.rec, kill.victim, kill.t)}` : '';
    const left = Math.min(Math.max(0, wait), this.prefs.leadIn);
    this.ui.flash(left > 0.5 ? `${word} in ${left.toFixed(1)} s${hit}` : `${word}${hit}`, 2000);
  }

  /** The round cam armed with shot `f` (and the kill it made); `again` for
   *  the same shot once more, the camera's swing kept. */
  armShot(f, kill = null, { again = false } = {}) {
    this.releaseRamp();
    this.stopTrack();
    this.player.highlights?.setAuto(false, true);
    this.player.highlights?.stopReel();
    this.followQuietly(f.pid);
    if (this.player.camera.mode === 'free') this.player.camera.setMode('orbit');
    this.rounds.arm(f, { kill, again });
    this.syncPlate();
  }

  // --- the take: a kill's clip, looping, shot by the style picked -----------------------------

  /**
   * A kill as a take (5, 6, a kill row's bullet cam): the clip marked round
   * it with the lead-in and the tail, looping, the round cam re-armed on it
   * each time round in the shot style picked. Pick another style, place the
   * camera, drag it round, and the next time round shows it; nothing plays
   * on past the clip and loses the place.
   */
  startTake(f, kill = null, word = 'Kill shot') {
    if (!f) return;
    this.queue = null;
    this.stopTrack();
    this.take = { f, kill };
    this.takeHeld = false;
    this.suggestions = null;
    this.clipAround(f.t, kill?.t ?? f.t, f.pid, { tail: TAKE_TAIL });
    this.range.loop = true;
    this.openEditor();
    this.armTake();
    const hit = kill?.victim !== null && kill?.victim !== undefined ? ` · kills ${nameAt(this.player.rec, kill.victim, kill.t)}` : '';
    this.ui.flash(`${word}${hit} · ${styleLabel(this.rounds.style)} · looping the clip`, 2400);
  }

  /** The take from the clip's start, armed (`again`: round once more). */
  armTake(again = false) {
    const span = this.span;
    const take = this.take;
    if (!span || !take) return;
    const player = this.player;
    this.rounds.stop(false);
    player.seek(span.t0);
    this.armShot(take.f, take.kill, { again });
    this.leadInto(span);
    player.playing = true;
    this.rangePlaying = true;
    this.syncPlate();
    this.panel?.refresh(true);
  }

  /** The clip's keyframes after the take's auto camera: it films up to the
   *  first of them and glides into it (replay-camtrack.js `LeadInRig`). */
  leadInto(span = this.span) {
    if (!span || !this.movesCamera || !this.rounds.active) return false;
    const take = this.take ?? this.takeInside(span);
    this.track = new LeadInRig(this.rounds, this.moveRig(span), { after: take?.kill?.t ?? take?.f?.t ?? null });
    this.player.camera.setRig(this.track);
    this.autoTrack = true;
    return true;
  }

  /** Whether the take's auto camera films the start of the clip: a kill
   *  inside it, the camera not taken by hand, and no keyframe on the clip's
   *  start (one there is the creator's camera from the first frame). */
  autoFilms(span = this.span) {
    if (!span || this.takeHeld || !this.takeInside(span)) return false;
    const first = keysIn(this.keys, span)[0];
    return !first || first.t > span.t0 + 0.05;
  }

  // --- the clip editor ---------------------------------------------------------------------------

  /** The clip as the recording for a while (replay-clipbar.js): the round's
   *  timeline gives way to the clip and a few seconds either side, and the
   *  panel to the Clip tab. Where the round was is kept for `closeEditor`. */
  openEditor() {
    if (!this.span || !this.clipbar) return false;
    if (!this.editing) {
      const player = this.player;
      // The clip loops while it is open: the shot is tried again and again.
      this.range.loop = true;
      this.editing = { t: player.time, playing: player.playing, pid: player.followPid, mode: player.camera.mode };
      this.ui.root.classList.add('rc-editing');
      this.panel?.setTab('clips');
    }
    this.clipbar.show();
    return true;
  }

  /** Back to the round: the clip's camera and its loop let go, and the
   *  playhead, the man followed and the camera mode as they were before the
   *  clip was opened. The clip stays marked, to open again. */
  closeEditor({ quiet = false } = {}) {
    const back = this.editing;
    if (!back) return;
    this.editing = null;
    this.clipbar?.hide();
    this.ui.root.classList.remove('rc-editing');
    this.queue = null;
    this.rangePlaying = false;
    this.take = null;
    this.takeHeld = false;
    this.suggestions = null;
    this.stopRecording(false);
    this.rounds.stop(false);
    this.stopTrack(false);
    this.releaseRamp();
    if (quiet) return;
    const player = this.player;
    player.seek(back.t);
    if (back.pid !== null && back.pid !== undefined && back.pid !== player.followPid) this.ui.follow(back.pid);
    if (back.mode && player.camera.mode !== back.mode) player.camera.setMode(back.mode);
    this.ui.syncMode();
    player.playing = back.playing;
    this.syncPlate();
    this.panel?.refresh(true);
    this.ui.flash(`Back to the round · ${fmt(back.t)}`);
  }

  /** The clip from its start again, after its ends moved: the take armed
   *  afresh, or the playhead at the in point, playing. */
  replayClip() {
    const span = this.span;
    if (!span) return;
    if (this.autoFilms(span)) {
      this.take = this.takeInside(span);
      this.armTake(true);
      return;
    }
    this.player.seek(span.t0);
    this.player.playing = true;
    this.rangePlaying = true;
    this.endFly();
    if (this.movesCamera) this.flyShot(span);
  }

  /**
   * The clip slid `by` seconds from where its ends were (`t0`, `t1`), its
   * length kept and held inside the round. The views pinned inside it and
   * its action go with it, so the move and the slow stretch keep their place
   * in the shot. While dragging (`preview`) only the ends move; on the drop
   * the rest follows and the clip plays from its new start.
   */
  slideClip(t0, t1, by, { preview = false } = {}) {
    if (t0 === null || t1 === null) return;
    const d = this.player.rec.duration;
    const len = t1 - t0;
    const shift = clamp(by, -t0, d - t1);
    this.range.in = t0 + shift;
    this.range.out = this.range.in + len;
    this.syncRange();
    if (preview) return;
    if (Math.abs(shift) < 1e-3) return;
    const moves = k => k.t >= t0 - 1e-6 && k.t <= t1 + 1e-6;
    const moved = this.keys.filter(moves).map(k => ({ ...k, t: k.t + shift }));
    if (moved.length) {
      // Pictures follow the pose, not the time: they carry over.
      this.keys = [...this.keys.filter(k => !moves(k)), ...moved].sort((a, b) => a.t - b.t);
      this.keysVersion = (this.keysVersion ?? 0) + 1;
      if (this.track) this.track.keys = keysIn(this.keys, this.span);
      this.syncKeyMarks();
    }
    if (this.action) this.action = { t0: this.action.t0 + shift, t1: this.action.t1 + shift };
    if (this.ramp.in !== null) this.ramp.in += shift;
    if (this.ramp.out !== null) this.ramp.out += shift;
    // A take slid off its kill is a clip of whatever is there now.
    if (this.take && (this.take.f.t < this.range.in || this.take.f.t > this.range.out)) {
      this.take = null;
      this.rounds.stop(false);
    }
    this.rangeChanged(`Clip slid ${shift > 0 ? 'later' : 'earlier'} ${Math.abs(shift).toFixed(1)} s`);
    this.endFly();
    this.replayClip();
  }

  /** A clip of anything, round the playhead: a little before, a few seconds
   *  after, opened in the editor with no kill to it -- the camera is the
   *  creator's, A and B or by hand. */
  newClip() {
    const player = this.player;
    const t = player.time;
    const d = player.rec.duration;
    this.queue = null;
    this.closeEditor({ quiet: true });
    this.rounds.stop(false);
    this.stopTrack(false);
    this.take = null;
    this.takeHeld = false;
    this.action = null;
    this.suggestions = null;
    this.range.in = clamp(t - 2, 0, d);
    this.range.out = clamp(t + 5, 0, d);
    this.range.loop = true;
    this.rangePid = player.followPid;
    this.rangeChanged(null);
    this.openEditor();
    player.playing = false;
    this.ui.flash('New clip · drag its ends or its top rail, + keyframes the view, right-click a lane for more', 3200);
  }

  /** Round again at the out point. */
  loopClip() {
    const span = this.span;
    if (!span) return;
    if (this.takeLive) this.armTake(true);
    else {
      this.player.seek(span.t0);
      this.rangePlaying = true;
      // Round again with A to B, from A.
      if (this.movesCamera && !this.track) this.flyShot(span);
    }
  }

  /** Whether the clip is a take still shot by its style: marked round its
   *  kill and the camera not taken by hand. */
  get takeLive() {
    const span = this.span;
    const f = this.take?.f;
    return Boolean(f && span && f.t >= span.t0 - 1e-3 && f.t <= span.t1 + 1e-3 && this.autoFilms(span));
  }

  /** Whether the clip has keyframes of its own: one holds its view from its
   *  moment, two or more are a move. A take's auto camera films the clip up
   *  to the first of them (`leadInto`), so a keyframe added never switches
   *  the shot style off. */
  get movesCamera() {
    return this.useMove && keysIn(this.keys, this.span).length >= 1;
  }

  /** View A (`a`) or B (`b`) of the clip: the key pinned as it, else, for
   *  keys kept before views had names, the first or the last inside the
   *  clip. Null when there is none, or it is outside the clip. */
  viewKey(role) {
    const inside = keysIn(this.keys, this.span);
    const named = inside.find(k => k.role === role);
    if (named) return named;
    if (inside.some(k => k.role)) return null;
    if (role === 'a') return inside[0] ?? null;
    return inside.length >= 2 ? inside[inside.length - 1] : null;
  }

  /** The rig that flies the clip's views, A to B, the way picked. */
  moveRig(span = this.span) {
    const keys = keysIn(this.keys, span);
    const centre = this.moveStyle === 'orbit' ? this.takeGeometry()?.to ?? null : null;
    return new TrackRig(keys.length ? keys : this.keys, { mode: this.moveStyle, centre });
  }

  /** How the camera goes between keyframes: glides, orbits the action, or cuts. */
  setMoveStyle(id) {
    this.moveStyle = moveStyleOf(id);
    this.useMove = true;
    this.saveKept();
    this.endFly();
    this.panel?.refresh(true);
    this.clipbar?.sync(this.player.time, true);
    // The new way shown at once: the move alone, not the whole clip.
    if (this.movesCamera) this.previewMove();
  }

  /** Pin view, as kept clips and older keys call it: a keyframe here. */
  pinView() {
    this.keyframeHere();
  }

  /**
   * A keyframe (the strip's +, K, a lane's right-click): this moment and the
   * view on screen, numbered by its place in the clip. The playhead stays
   * where it was scrubbed to, the replay holds still, and the camera is left
   * free on the view just kept, to be moved on for the next. A take's auto
   * camera keeps filming the clip up to the first keyframe and glides into
   * it; between keyframes the camera moves the way picked; after the last it
   * holds. Replaces Pin A / Pin B (features/replay-creator-view, "Keyframes
   * on the strip").
   */
  keyframeHere(t = this.player.time, { replace = null } = {}) {
    const span = this.span;
    if (!span) {
      this.ui.flash('Mark a clip first: Kill shot (5), or New clip here', 2400);
      return null;
    }
    if (t < span.t0 - 1e-3 || t > span.t1 + 1e-3) {
      this.ui.flash('Keyframes go inside the clip: scrub back into it', 2400);
      return null;
    }
    // The view on screen is the keyframe; what was filming lets go, and the
    // take's auto camera is not taken by hand for it.
    this.queue = null;
    this.rounds.stop(false);
    this.stopTrack(false);
    this.takeHeld = false;
    this.rangePlaying = false;
    this.player.playing = false;
    if (Math.abs(this.player.time - t) > 1e-3) this.player.seek(t);
    const cam = this.ctx.camera;
    const key = keyOf(cam, t);
    if (this.lens.fov === null) delete key.fov;
    if (!keyValid(key)) return null;
    // Keyframes are numbered, not named: A and B kept before go plain.
    const plain = this.keys.filter(k => k !== replace).map(({ role, ...k }) => k);
    this.keys = addKey(plain, key);
    this.keysVersion = (this.keysVersion ?? 0) + 1;
    this.useMove = true;
    this.shotWanted = { sig: poseSig(key), live: true };
    this.freeAt(cam.position.clone(), cam.quaternion.clone());
    this.saveKept();
    this.syncKeyMarks();
    this.syncRange();
    this.panel?.refresh(true);
    this.clipbar?.sync(t, true);
    const inside = keysIn(this.keys, span);
    const n = inside.findIndex(k => Math.abs(k.t - key.t) < 1e-6) + 1;
    const next = inside.length === 1 ? ' · move the camera, scrub on and add another for a move' : ' · drag the playhead across to see the move';
    this.ui.flash(`${replace ? 'Keyframe' : 'Keyframe'} ${n} at ${fmt(t - span.t0)} in the clip${replace ? ' now holds this view' : next}`, 3200);
    return key;
  }

  /** A keyframe's view replaced by the one on screen, at its own moment. */
  replaceKey(key) {
    if (!key) return;
    this.keyframeHere(key.t, { replace: key });
  }

  /** A keyframe taken away; with none left, the clip is the take's again. */
  deleteKey(key) {
    if (!key) return;
    this.removeKey(key);
    this.endFly();
    this.syncRange();
    this.clipbar?.sync(this.player.time, true);
    this.ui.flash(keysIn(this.keys, this.span).length ? 'Keyframe deleted' : 'Keyframe deleted · the shot style films the clip again');
  }

  /** The slow stretch painted on the strip: `t0` to `t1` at `speed`. */
  setSlowRange(t0, t1, speed = this.ramp.speed < 1 ? this.ramp.speed : 0.25, { quiet = false } = {}) {
    const span = this.span;
    if (!span) return;
    const a = clamp(Math.min(t0, t1), span.t0, span.t1);
    const b = clamp(Math.max(t0, t1), span.t0, span.t1);
    if (b - a < 0.1) return;
    this.ramp.in = a;
    this.ramp.out = b;
    this.ramp.speed = RAMP_SPEEDS.includes(speed) ? speed : 0.25;
    this.releaseRamp();
    this.saveKept();
    this.syncRange();
    this.panel?.refresh(true);
    this.clipbar?.sync(this.player.time, true);
    const replaced = this.rounds.bulletTime && this.autoFilms(span);
    this.slowChanged();
    if (!quiet) {
      this.ui.flash(`${speedWord(this.ramp.speed)} over ${(b - a).toFixed(1)} s${replaced ? ' · in place of the kill shot\'s bullet time' : ''}`, 2400);
    }
  }

  /** The clip's slow motion gone: normal speed throughout, or a take's own
   *  bullet time back. */
  clearSlow() {
    this.ramp.in = null;
    this.ramp.out = null;
    this.ramp.speed = 1;
    this.releaseRamp();
    this.saveKept();
    this.syncRange();
    this.panel?.refresh(true);
    this.clipbar?.sync(this.player.time, true);
    this.slowChanged();
    this.ui.flash(this.autoSlow() ? 'Your slow motion is gone · the kill shot\'s bullet time is back' : 'Normal speed');
  }

  /** Whether the clip has slow motion of its own: then it runs the clock,
   *  and a take's bullet time stands aside (replay-roundcam.js `easeClock`). */
  ownSlow() {
    const span = this.span;
    return Boolean(span && ramping(this.ramp) && rampSpanOf(this.ramp, span));
  }

  /** The take's own bullet time over the clip, as the speed lane draws it:
   *  `{ t0, t1, pace }` where it slows, or null (no take, the camera taken by
   *  hand, bullet time off, or the clip's own slow motion in its place). */
  autoSlow(span = this.span) {
    if (!span || this.ownSlow() || !this.rounds.bulletTime || !this.autoFilms(span)) return null;
    const take = this.takeInside(span);
    const at = bulletTimeSpan(take?.f, take?.kill);
    if (!at) return null;
    const t0 = Math.max(span.t0, at.t0);
    const t1 = Math.min(span.t1, at.t1);
    return t1 > t0 ? { t0, t1, pace: this.prefs.pace } : null;
  }

  /** How the take slows, from the speed lane: a BULLET_TIME preset or 'off'. */
  setBulletTime(pace) {
    this.setPref('pace', pace);
    this.slowChanged();
    this.clipbar?.sync(this.player.time, true);
    this.ui.flash(pace === 'off' ? 'Bullet time off: the kill shot plays at normal speed' : `Bullet time ${pace}`);
  }

  /** The take played again from the clip's start when what slows it
   *  changed under a round cam that is playing, so the change is seen at
   *  once and the clock is never left where the old owner put it. Paused,
   *  it stays paused where it is: Play arms the take afresh. */
  slowChanged() {
    if (this.rounds.active && this.span && this.player.playing) this.replayClip();
  }

  /** One end of the clip moved to `t` from the strip's menu. */
  setEnd(which, t) {
    const gap = 0.3;
    if (which === 'in') this.range.in = Math.min(t, (this.range.out ?? t + gap) - gap);
    else this.range.out = Math.max(t, (this.range.in ?? t - gap) + gap);
    this.syncRange();
    this.clipbar?.fit();
    this.rangeChanged(`${which === 'in' ? 'Starts' : 'Ends'} ${fmt(this.range[which])}`);
    this.replayClip();
    this.clipbar?.sync(this.player.time, true);
  }

  /** The clip fitted round its kill again: the lead-in, the action and the
   *  take's tail, as Kill shot marks it. */
  fitToKill() {
    const take = this.take ?? this.takeInside();
    if (!take) {
      this.ui.flash('This clip has no kill to fit to', 2000);
      return;
    }
    this.take = take;
    this.clipAround(take.f.t, take.kill?.t ?? take.f.t, take.f.pid, { tail: TAKE_TAIL });
    this.clipbar?.fit();
    this.replayClip();
    this.clipbar?.sync(this.player.time, true);
  }

  /** The clip from `t`, playing and looping, the playhead where it is put. */
  playFrom(t) {
    const span = this.span;
    if (!span) return;
    if (t <= span.t0 + 0.05) {
      this.playRange();
      return;
    }
    this.player.seek(t);
    this.player.playing = true;
    this.rangePlaying = true;
    if (this.movesCamera && !this.track) this.flyShot(span);
  }

  /** The move alone, once: from just before A to just after B, then paused
   *  on B. The quick look at a pan without sitting through the whole clip. */
  previewMove() {
    const span = this.span;
    const a = this.viewKey('a');
    const b = this.viewKey('b');
    if (!span || !a || !b) {
      this.ui.flash('Add two keyframes first: + on the strip, or K', 2400);
      return;
    }
    this.useMove = true;
    // Not `stopRigs`: a preview is not the take's camera taken by hand.
    this.queue = null;
    this.rounds.stop(false);
    this.stopTrack(false);
    this.previewFrom = Math.max(span.t0, a.t - PREVIEW_PAD);
    this.player.seek(this.previewFrom);
    this.flyShot(span);
    this.previewUntil = Math.min(span.t1, b.t + PREVIEW_PAD);
    this.rangePlaying = true;
    this.player.playing = true;
    this.panel?.refresh(true);
    this.clipbar?.sync(this.player.time, true);
    this.ui.flash('Previewing the move', 1400);
  }

  /** A drag on the clip's strip with a move pinned: the camera rides the
   *  move as the playhead goes, so the pan is seen at any moment by
   *  scrubbing through it. */
  scrubPreview() {
    if (!this.movesCamera || this.track || this.rounds.active) return;
    this.flyShot(this.span);
  }

  /** What the slow stretch covers now: 'action', 'move', 'clip' or null
   *  (none, or a stretch set some other way). */
  slowOver() {
    const span = this.span;
    if (!span || !ramping(this.ramp)) return null;
    const slow = rampSpanOf(this.ramp, span);
    if (!slow) return null;
    const same = (x0, x1) => Math.abs(slow.t0 - x0) < 0.06 && Math.abs(slow.t1 - x1) < 0.06;
    const a = this.viewKey('a');
    const b = this.viewKey('b');
    if (a && b && same(a.t, b.t)) return 'move';
    const action = this.clipAction;
    if (action && same(action.t0, action.t1)) return 'action';
    if (same(span.t0, span.t1)) return 'clip';
    return null;
  }

  /**
   * Slow motion in one step: how slow (`speed`, 1 for none) over what
   * (`over`: the move between its pinned ends, the action, or the whole
   * clip). The strip's speed chip and the move's chip both set it here.
   */
  setSlow(speed, over = this.slowOver() ?? (this.viewKey('a') && this.viewKey('b') ? 'move' : this.clipAction ? 'action' : 'clip')) {
    const span = this.span;
    if (!span) return;
    let range = { in: null, out: null };
    if (over === 'move') {
      const a = this.viewKey('a');
      const b = this.viewKey('b');
      if (!a || !b) {
        this.ui.flash('Add two keyframes first: + on the strip, or K', 2200);
        return;
      }
      range = { in: a.t, out: b.t };
    } else if (over === 'action' && this.clipAction) {
      range = { in: this.clipAction.t0, out: this.clipAction.t1 };
    }
    this.ramp.in = range.in;
    this.ramp.out = range.out;
    this.ramp.speed = RAMP_SPEEDS.includes(speed) ? speed : 1;
    this.releaseRamp();
    this.saveKept();
    this.syncRange();
    this.panel?.refresh(true);
    this.clipbar?.sync(this.player.time, true);
    const what = { move: 'over the move', action: 'over the action', clip: 'over the whole clip' }[over] ?? '';
    this.ui.flash(ramping(this.ramp) ? `${speedWord(this.ramp.speed)} ${what}` : 'Normal speed');
  }

  /** The take's kill, or the one killing round inside the clip when there
   *  is no take (a kept clip played again). */
  takeInside(span = this.span) {
    if (!span) return null;
    if (this.take && this.take.f.t >= span.t0 - 1e-3 && this.take.f.t <= span.t1 + 1e-3) return this.take;
    let only = null;
    for (const [kill, fact] of this.killFacts()) {
      const f = fact?.round?.f;
      if (kill.kind !== 'kill' || !f || f.t < span.t0 || kill.t > span.t1) continue;
      if (only) return null;
      only = { f, kill };
    }
    return only;
  }

  /** The shot style (replay-shotstyle.js): kept as the creator's own, and
   *  the take started again from the clip's start to show it. */
  setShotStyle(style) {
    const id = styleOf(style);
    if (id === 'fixed' && !this.rounds.angle) {
      this.ui.flash('Place the camera first: pause, fly the free camera there, then Use this view', 3200);
      return;
    }
    this.prefs.shotStyle = id;
    this.savePrefs();
    this.applyPrefs();
    // A style films the clip up to its first keyframe; the keyframes stay.
    this.endFly();
    if (!this.take) this.take = this.takeInside();
    if (this.take && this.span) {
      this.takeHeld = false;
      this.armTake();
    }
    this.ui.flash(styleLabel(id));
    this.syncPlate();
    this.panel?.refresh(true);
  }

  /** The next style along (the plate's style button, G). */
  cycleShotStyle() {
    const usable = STYLE_IDS.filter(id => id !== 'fixed' || this.rounds.angle);
    const i = usable.indexOf(this.rounds.style);
    this.setShotStyle(usable[(i + 1) % usable.length]);
  }

  /** The view on screen kept as the take's camera (Your angle), looking
   *  where it looks now; the take started again from it. */
  useView() {
    const cam = this.ctx.camera;
    const look = new THREE.Vector3(0, 0, -20).applyQuaternion(cam.quaternion).add(cam.position);
    this.rounds.angle = { pos: cam.position.toArray(), look: look.toArray(), aim: this.prefs.angleAim };
    this.saveKept();
    this.setShotStyle('fixed');
  }

  /** Whether the placed camera turns to keep the action in frame (track) or
   *  holds the framing it was kept with (lock). */
  setAngleAim(aim) {
    this.prefs.angleAim = aim === 'lock' ? 'lock' : 'track';
    this.savePrefs();
    this.applyPrefs();
    this.saveKept();
    if (this.rounds.style === 'fixed' && this.takeLive) this.armTake();
    this.panel?.refresh(true);
  }

  /** Where the take's shot leaves from and the man it kills, in the view's
   *  frame: `{ from, to }`, or null. */
  takeGeometry() {
    const take = this.take ?? this.takeInside();
    const f = take?.f;
    if (!f || !Array.isArray(f.pos)) return null;
    const from = [f.pos[0], f.pos[1], -f.pos[2]];
    const kill = take.kill;
    let to = null;
    if (kill && kill.victim !== null && kill.victim !== undefined) {
      const w = whereIs(this.player.rec, kill.victim, kill.t - 0.05, this.player.kills ?? this.player.rec.kills);
      if (w.pos) to = [w.pos[0], w.pos[1] + (w.state === 'foot' ? CHARACTER_HEIGHT : 0) + 0.3, w.pos[2]];
    }
    if (!to && Array.isArray(f.dir)) {
      const n = Math.hypot(f.dir[0], f.dir[1], f.dir[2]) || 1;
      to = [from[0] + (f.dir[0] / n) * 30, from[1] + (f.dir[1] / n) * 30, from[2] - (f.dir[2] / n) * 30];
    }
    return to ? { from, to, take } : null;
  }

  /**
   * Angles worth trying on the take, worked out from where it happened, each
   * with a small picture of the view from it: the replay paused in the
   * middle of the action, and the pictures drawn after the next renders
   * (`afterRender`).
   */
  suggest() {
    const g = this.takeGeometry();
    if (!g) {
      this.ui.flash('Mark a kill first: Kill shot, or a kill row on the Player tab', 2400);
      return;
    }
    this.take ??= g.take;
    const ground = (x, z) => this.ctx.groundHeight?.(x, z);
    // The level's own line of sight, the one the page's rounds fly by: a
    // wall between the camera and the men is what the terrain cannot say.
    const collider = this.ctx.guns?.collider;
    const sees = collider?.cast ? (a, b) => {
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const dz = b[2] - a[2];
      const n = Math.hypot(dx, dy, dz);
      if (n < 0.7) return true;
      return !collider.cast(a[0], a[1], a[2], dx / n, dy / n, dz / n, n - 0.6);
    } : null;
    const list = suggestAngles({ from: g.from, to: g.to, ground, sees });
    const beat = this.beat ?? { t0: g.take.f.t, t1: g.take.kill?.t ?? g.take.f.t };
    const at = clamp(Math.min(beat.t1, (g.take.kill?.t ?? beat.t1) - 0.1), 0, this.player.rec.duration);
    this.rounds.stop(false);
    this.takeHeld = true;
    this.player.playing = false;
    this.player.seek(at);
    this.suggestions = { list, thumbs: new Map(), job: { frames: 0 } };
    this.panel?.refresh(true);
  }

  /** A suggested angle as the take's camera: Your angle, started again. */
  useSuggestion(a) {
    if (!a) return;
    this.rounds.angle = { pos: [...a.pos], look: [...a.look], aim: this.prefs.angleAim };
    this.saveKept();
    this.setShotStyle('fixed');
  }

  /** The suggestions' pictures, a few renders after the seek (the bodies
   *  built), drawn in the task that drew the frame, then the view drawn
   *  again so the screen shows the page's own camera. */
  drawThumbs(canvas) {
    const job = this.suggestions?.job;
    if (!job) return;
    job.frames += 1;
    if (job.frames < 4) return;
    this.suggestions.job = null;
    const renderer = this.ctx.renderer;
    const scene = this.ctx.scene;
    const main = this.ctx.camera;
    if (!renderer || !scene || !main) return;
    const cam = main.clone();
    const w = 192;
    const h = Math.round(w / Math.max(0.5, canvas.width / Math.max(1, canvas.height)));
    for (const a of this.suggestions.list) {
      quietly('a suggested angle', () => {
        cam.position.fromArray(a.pos);
        cam.lookAt(new THREE.Vector3().fromArray(a.look));
        cam.updateMatrixWorld(true);
        renderer.render(scene, cam);
        const thumb = document.createElement('canvas');
        thumb.width = w;
        thumb.height = h;
        thumb.getContext('2d').drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, w, h);
        this.suggestions.thumbs.set(a, thumb);
      });
    }
    quietly('the view', () => renderer.render(scene, main));
    this.panel?.refresh(true);
  }

  /** The kill at `t` of `victim`, and the round that made it, from the
   *  round's facts: `{ kill, round }`, or null. */
  killAt(t, victim) {
    for (const [kill, fact] of this.killFacts()) {
      if (kill.victim === victim && Math.abs(kill.t - t) < 1e-3) return { kill, round: fact.round ?? null };
    }
    return null;
  }

  /** The kill a recorded shot made, if the dossier's facts tie one to it.
   *  Through an index (replay-shot.js): a round in flight asks every frame. */
  killOfShot(f) {
    this.fireKills ??= killByFire(this.killFacts());
    return (f ? this.fireKills.get(f) : null) ?? null;
  }

  /** Every kill's facts (replay-dossier.js), read once, the first time. */
  killFacts() {
    if (!this.facts) {
      const t0 = performance.now();
      this.facts = killFactsOf(this.player.rec, this.player.kills);
      const ms = performance.now() - t0;
      if (ms > 200) console.info(`creator: the round's kills read in ${ms.toFixed(0)} ms`);
    }
    return this.facts;
  }

  /** `pid`'s highlights (replay-dossier.js), rebuilt when he changes. */
  dossier(pid) {
    if (pid === null || pid === undefined) return null;
    const key = `${pid}`;
    if (this.dossierKey !== key || !this.lastDossier) {
      const player = this.player;
      const medals = player.highlights?.model.medals ?? [];
      this.lastDossier = dossierOf(player.rec, pid, {
        kills: player.kills, facts: this.killFacts(), medals, chapters: player.chapters, display: k => this.display(k),
      });
      this.dossierKey = key;
    }
    return this.lastDossier;
  }

  /** A template or weapon as the game names it (the message log's lexicon). */
  display(key) {
    if (!key) return '';
    const names = this.ui.lexicon?.()?.names ?? null;
    return names?.[key] ?? String(key).replace(/_/g, ' ');
  }

  // --- going to a moment --------------------------------------------------------------------

  /** Watch a moment of `pid`'s: the lead-in before it, the orbit close behind
   *  him, playing. */
  goTo(t, pid = this.subjectPid()) {
    const player = this.player;
    this.queue = null;
    this.rounds.stop(false);
    this.stopTrack();
    player.seek(Math.max(0, t - this.prefs.leadIn));
    if (pid !== null && pid !== undefined) {
      const highlights = player.highlights;
      if (highlights) {
        highlights.setAuto(false, true);
        highlights.stopReel();
        highlights.frameOn(pid);
        highlights.shot();
      } else {
        this.ui.follow(pid);
      }
    }
    player.playing = true;
    this.ui.syncMode();
  }

  /** The bullet cam on a kill: the lead-in before its round, the camera over
   *  the shooter's shoulder, then riding the round to the man it killed. */
  bulletCam(row, { reel = false } = {}) {
    const f = row?.round?.f;
    if (!f) return;
    const player = this.player;
    const kill = row.kill ?? this.killAt(row.t, row.victim)?.kill ?? null;
    // One kill is a take, looping; a reel rides each once.
    if (!reel) {
      this.startTake(f, kill, isMelee(f.weapon) ? 'Knife kill' : 'Bullet cam');
      return;
    }
    this.rounds.stop(false);
    player.seek(Math.max(0, f.t - this.prefs.leadIn));
    this.armShot(f, kill);
    player.playing = true;
  }

  /** The bullet cam on each of `rows` that has a round, one after another
   *  (a section's Play all): his longest shots as a reel. */
  playAll(rows) {
    const list = rows.filter(r => r.round?.f);
    if (!list.length) {
      this.ui.flash('No rounds to ride', 1600);
      return;
    }
    this.queue = { list, i: 0, idle: 0 };
    this.take = null;
    this.rangePlaying = false;
    this.bulletCam(list[0], { reel: true });
  }

  /** The reel's next ride, a moment after the last one hands back. */
  runQueue(dt) {
    const q = this.queue;
    if (!q) return;
    if (this.rounds.active) {
      q.idle = 0;
      return;
    }
    q.idle += Math.max(0, dt);
    if (q.idle < 0.8) return;
    q.i += 1;
    q.idle = 0;
    if (q.i >= q.list.length) {
      this.queue = null;
      this.player.playing = false;
      this.ui.flash('End of the reel');
      this.syncPlate();
      return;
    }
    this.bulletCam(q.list[q.i], { reel: true });
  }

  /** The range around a moment: the lead-in before `t0`, TAIL after `t1`,
   *  and `t0` to `t1` kept as the clip's action -- what the camera move and
   *  the slow motion go on, rather than the padded ends. */
  clipAround(t0, t1 = t0, pid = this.subjectPid(), { tail = TAIL } = {}) {
    const d = this.player.rec.duration;
    this.range.in = clamp(t0 - this.prefs.leadIn, 0, d);
    this.range.out = clamp(t1 + tail, 0, d);
    this.rangePid = pid;
    this.setAction(t0, t1);
    this.rangeChanged('Clip marked');
  }

  /** What the clip is of: the shot at `fire` and what it hit at `hit`, grown
   *  so a camera move across it is a move (replay-shot.js `actionOf`). The
   *  slow motion goes there too -- the lead-in and the tail run at speed, so
   *  the viewer waits only over the part worth watching. */
  setAction(fire, hit = fire) {
    this.action = actionOf(fire, hit, this.span);
    if (!this.action) return;
    this.ramp.in = this.action.t0;
    this.ramp.out = this.action.t1;
    this.releaseRamp();
  }

  /**
   * The stretch inside the clip that the camera move and the slow motion
   * belong on: the action where the clip was cut round one, else the whole
   * clip. A clip marked round a bazooka kill runs 6.4 s and the round is in
   * the air for 0.9 s of it; keys stamped at the clip's own ends crawl the
   * camera on for seconds after the tank has blown up, and slow motion only
   * makes that wait longer, because it slows the action by the same factor.
   */
  get beat() {
    return this.clipAction ?? this.span;
  }

  /** The clip's action, held inside its ends: the one it was marked with, or
   *  the one killing round inside it (`actionInside`). Null where the clip
   *  is its own action -- then A and B are its ends, as they always were. */
  get clipAction() {
    const span = this.span;
    if (!span) return null;
    const action = this.action ?? this.actionInside(span);
    if (!action) return null;
    const t0 = clamp(action.t0, span.t0, span.t1);
    const t1 = clamp(action.t1, span.t0, span.t1);
    // Nothing left of it inside the clip, or all of the clip: no action.
    if (!(t1 - t0 > 0.05) || (t0 - span.t0 < 0.05 && span.t1 - t1 < 0.05)) return null;
    return { t0, t1 };
  }

  /** The action of a clip marked without one: the single killing round
   *  inside it. A clip marked by hand round a kill, or kept before this
   *  pass, is as much a shot of that kill as one marked from its row -- but
   *  a clip with several kills in it is a stretch of the round, not one
   *  shot, and gets none. Worked out once per clip. */
  actionInside(span) {
    const key = `${span.t0}|${span.t1}`;
    if (this.actionFound?.key === key) return this.actionFound.action;
    let only = null;
    quietly('the clip\'s action', () => {
      for (const [kill, fact] of this.killFacts()) {
        const f = fact?.round?.f;
        if (kill.kind !== 'kill' || !f || f.t < span.t0 || kill.t > span.t1) continue;
        if (only) {
          only = null;
          return;
        }
        only = actionOf(f.t, kill.t, span);
      }
    });
    this.actionFound = { key, action: only };
    return only;
  }

  // --- the range and the clips ----------------------------------------------------------------

  setIn(t = this.player.time) {
    this.range.in = t;
    if (this.range.out !== null && this.range.out <= t) this.range.out = null;
    this.rangeChanged(`In ${fmt(t)}`);
  }

  setOut(t = this.player.time) {
    this.range.out = t;
    if (this.range.in !== null && this.range.in >= t) this.range.in = null;
    this.rangeChanged(`Out ${fmt(t)}`);
  }

  clearRange() {
    this.range.in = null;
    this.range.out = null;
    this.action = null;
    this.take = null;
    this.suggestions = null;
    this.closeEditor({ quiet: true });
    this.rangeChanged('Clip cleared');
  }

  /** An end of the clip moved a nudge earlier (`dir` -1) or later (1), the
   *  playhead with it: the last tenth of a second trimmed off by eye. */
  nudgePoint(which, dir) {
    const t = this.range[which];
    if (t === null) return;
    const next = clamp(t + dir * NUDGE, 0, this.player.rec.duration);
    const other = which === 'in' ? this.range.out : this.range.in;
    if (other !== null && (which === 'in' ? next >= other : next <= other)) return;
    this.range[which] = next;
    this.player.seek(next);
    this.rangeChanged(null);
  }

  /** The playhead at one end of the clip. */
  goToPoint(which) {
    const t = this.range[which];
    if (t !== null) this.player.seek(t);
  }

  /** A timeline handle dragged: each move hands `at` the time under the
   *  pointer, the lift hands `done` the last. The timeline's own scrub never
   *  sees the press. */
  dragHandle(handle, at, done) {
    handle.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      const move = ev => quietly('a handle', () => at(this.ui.timeline.timeAt(ev.clientX)));
      const up = ev => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        quietly('a handle', () => done?.(this.ui.timeline.timeAt(ev.clientX)));
      };
      try { handle.setPointerCapture?.(e.pointerId); } catch {}
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
  }

  /** The clip's ends dragged along the timeline. The playhead stays put
   *  until the lift -- a seek rebuilds every body -- then goes to the
   *  dragged end. The slow stretch is not dragged here: a clip is a few
   *  seconds of a round that runs minutes, so its band is pixels wide and
   *  anything on it sits under the clip's own handles; the stretch keeps
   *  its buttons (From here, To here, Between A and B). */
  bindHandles() {
    this.dragHandle(this.rangeIn, t => {
      this.range.in = clamp(t, 0, (this.range.out ?? this.player.rec.duration) - DRAG_GAP);
      this.syncRange();
    }, () => {
      this.player.seek(this.range.in);
      this.rangeChanged(`In ${fmt(this.range.in)}`);
    });
    this.dragHandle(this.rangeOut, t => {
      this.range.out = clamp(t, (this.range.in ?? 0) + DRAG_GAP, this.player.rec.duration);
      this.syncRange();
    }, () => {
      this.player.seek(this.range.out);
      this.rangeChanged(`Out ${fmt(this.range.out)}`);
    });
  }

  rangeChanged(word) {
    // A slow stretch the clip's new ends leave nothing of goes back to the
    // whole clip rather than quietly doing nothing.
    if (ramping(this.ramp) && (this.ramp.in !== null || this.ramp.out !== null) && !rampSpanOf(this.ramp, this.span)) {
      this.ramp.in = null;
      this.ramp.out = null;
    }
    // An action the clip has been re-marked away from is forgotten: the clip
    // is then its own action, and A and B go back to its ends. Trimming an
    // end keeps it -- it is still inside.
    const span = this.span;
    if (this.action && (!span || this.action.t1 <= span.t0 || this.action.t0 >= span.t1)) this.action = null;
    this.saveKept();
    this.syncRange();
    if (this.editing) {
      if (!this.span) this.closeEditor({ quiet: true });
      else this.clipbar?.sync(this.player.time, true);
    }
    this.panel?.refresh(true);
    if (word) this.ui.flash(word);
  }

  /** The range as it stands: `{ t0, t1 }` with both ends, else null. */
  get span() {
    const { in: t0, out: t1 } = this.range;
    return t0 !== null && t1 !== null && t1 > t0 ? { t0, t1 } : null;
  }

  /** The clip from its in point, playing (P): the camera move flying, the
   *  slow motion running, round again at the out point when the loop is on. */
  playRange() {
    const span = this.span;
    if (!span) {
      this.ui.flash('Mark the clip first (I, O)', 2000);
      return;
    }
    this.openEditor();
    // A clip round one kill is a take: its shot style films it up to the
    // clip's first keyframe, and the keyframes from there.
    this.takeHeld = false;
    if (this.autoFilms(span)) {
      this.take = this.takeInside(span);
      this.armTake();
      return;
    }
    this.rounds.stop(false);
    this.player.seek(span.t0);
    this.player.playing = true;
    this.rangePlaying = true;
    this.flyShot(span);
    this.syncPlate();
  }

  /** The clip's camera move: with two keys or more inside it the track flies
   *  them while the clip plays, and hands back at its out point. Nothing
   *  where the clip has no keys of its own -- the camera stays as it is. */
  flyShot(span = this.span) {
    if (this.track || !this.movesCamera) return false;
    this.player.highlights?.setAuto(false, true);
    this.player.highlights?.stopReel();
    this.track = this.moveRig(span);
    this.player.camera.setRig(this.track);
    this.autoTrack = true;
    return true;
  }

  /** The clip's camera move let go at its end. */
  endFly() {
    if (this.autoTrack) this.stopTrack();
  }

  toggleLoop() {
    this.range.loop = !this.range.loop;
    this.ui.flash(this.range.loop ? 'Loop on' : 'Loop off');
    this.panel?.refresh(true);
  }

  // --- the clip's slow motion -------------------------------------------------------------

  /** How slowly the clip runs over its slow stretch; 1 is off. */
  setRampSpeed(speed) {
    this.ramp.speed = RAMP_SPEEDS.includes(speed) ? speed : 1;
    this.releaseRamp();
    this.saveKept();
    this.syncRange();
    this.panel?.refresh(true);
    this.ui.flash(ramping(this.ramp) ? `Slow motion ${speedWord(this.ramp.speed)}` : 'Slow motion off');
  }

  /** Where the slow stretch starts or ends: the playhead by default, null
   *  for the clip's own end. Ends that cross put the other back to the
   *  clip's. */
  setRampPoint(which, t = this.player.time) {
    const span = this.span;
    this.ramp[which] = t === null ? null : span ? clamp(t, span.t0, span.t1) : t;
    if (!rampSpanOf(this.ramp, span)) this.ramp[which === 'in' ? 'out' : 'in'] = null;
    this.releaseRamp();
    this.saveKept();
    this.syncRange();
    this.panel?.refresh(true);
  }

  /** The slow stretch over the whole clip again. */
  slowWhole() {
    this.ramp.in = null;
    this.ramp.out = null;
    this.releaseRamp();
    this.saveKept();
    this.syncRange();
    this.panel?.refresh(true);
  }

  /** The slow stretch between the clip's first and last camera keys -- slow
   *  down between the key frames in one move. Slow motion off picks 1/4. */
  slowBetweenKeys() {
    const between = rampBetweenKeys(this.keys, this.span);
    if (!between) {
      this.ui.flash(this.span ? 'Add two keyframes to the clip first (K)' : 'Mark the clip first (I, O)', 2200);
      return;
    }
    this.ramp.in = between.in;
    this.ramp.out = between.out;
    if (!ramping(this.ramp)) this.ramp.speed = 0.25;
    this.releaseRamp();
    this.saveKept();
    this.syncRange();
    this.panel?.refresh(true);
    this.ui.flash(`${speedWord(this.ramp.speed)} between the keys`);
  }

  /**
   * The replay's clock under the clip's slow motion, before the frame: the
   * ramp holds it inside its stretch while the clip plays and gives it back
   * as it found it outside. The round cam's bullet time wins where both
   * would run -- it saves and restores the clock itself.
   */
  runRamp(t) {
    const player = this.player;
    if ((this.rounds.active && !this.ownSlow()) || !player.playing || this.ui.scrubbing || !this.span) {
      this.releaseRamp();
      return;
    }
    // A speed picked by hand while the ramp held the clock is the clip's own
    // speed from then on.
    if (this.ramped && Math.abs(player.speed - this.ramped.applied) > 1e-4) this.ramped.base = player.speed;
    const base = this.ramped?.base ?? player.speed;
    const want = rampSpeedAt(this.ramp, this.span, t, base);
    if (want === null) {
      this.releaseRamp();
      return;
    }
    this.ramped ??= { base, applied: base };
    player.speed = want;
    this.ramped.applied = want;
  }

  /** The clock back as the ramp found it, if it is still the ramp's. */
  releaseRamp() {
    const held = this.ramped;
    this.ramped = null;
    if (held && Math.abs(this.player.speed - held.applied) < 1e-4) this.player.speed = held.base;
  }

  /** What the plate says of the slow motion now, or null. */
  slowWord() {
    return this.ramped ? speedWord(this.ramp.speed) : null;
  }

  saveClip() {
    const span = this.span;
    if (!span) return;
    const pid = this.rangePid ?? this.player.followPid;
    const who = pid !== null && pid !== undefined ? nameAt(this.player.rec, pid, span.t0) : 'Clip';
    // The whole shot, not just its two ends: a clip played again is the
    // camera move and the slow motion it was kept with.
    this.clips.push({
      name: `${who} ${fmt(span.t0)}`, in: span.t0, out: span.t1, pid: pid ?? null,
      keys: keysIn(this.keys, span).map(k => ({ ...k })), ramp: { ...this.ramp },
      action: this.action ? { ...this.action } : null,
      shot: { style: this.rounds.style, angle: this.rounds.angle ? { ...this.rounds.angle } : null, moveStyle: this.moveStyle },
    });
    this.clips.sort((a, b) => a.in - b.in);
    this.saveKept();
    this.panel?.refresh(true);
    this.ui.flash('Clip saved');
  }

  /** A saved clip back on the bench: its range, and the camera move and slow
   *  motion it was kept with, playing from its start on its man. */
  useClip(clip, play = true) {
    this.range.in = clip.in;
    this.range.out = clip.out;
    this.rangePid = clip.pid;
    // A clip kept before the action was a thing has none: the clip is then
    // its own action, as it was when it was kept.
    this.action = clip.action ? { ...clip.action } : null;
    this.endFly();
    if (Array.isArray(clip.keys)) {
      this.keys = clip.keys.map(k => ({ ...k }));
      this.keysVersion = (this.keysVersion ?? 0) + 1;
      if (this.track) this.track.keys = keysIn(this.keys, this.span);
      this.syncKeyMarks();
      this.ui.flash('Clip on the bench · its camera keys took the bench\'s', 2200);
    }
    if (clip.ramp) this.ramp = rampOf(clip.ramp);
    if (clip.shot) {
      if (clip.shot.moveStyle) this.moveStyle = moveStyleOf(clip.shot.moveStyle);
      if (clip.shot.angle) this.rounds.angle = { ...clip.shot.angle, aim: this.prefs.angleAim };
      if (clip.shot.style !== 'fixed' || this.rounds.angle) {
        this.prefs.shotStyle = clip.shot.style;
        this.savePrefs();
        this.applyPrefs();
      }
    }
    this.take = null;
    this.suggestions = null;
    this.releaseRamp();
    this.saveKept();
    this.syncRange();
    if (clip.pid !== null && clip.pid !== undefined) this.followPlayer(clip.pid);
    if (play) this.playRange();
    this.panel?.refresh(true);
  }

  removeClip(clip) {
    this.clips = this.clips.filter(c => c !== clip);
    this.saveKept();
    this.panel?.refresh(true);
  }

  renameClip(clip, name) {
    clip.name = String(name ?? '').trim().slice(0, 80) || clip.name;
    this.saveKept();
  }

  /** The range's band and handles on the timeline. */
  syncRange() {
    if (!this.rangeBand) return;
    const d = Math.max(0.001, this.player.rec.duration);
    const { in: t0, out: t1 } = this.range;
    const on = t0 !== null || t1 !== null;
    this.rangeBand.hidden = !on;
    if (!on) return;
    const a = t0 ?? 0;
    const b = t1 ?? d;
    this.rangeBand.style.left = `${(a / d) * 100}%`;
    this.rangeBand.style.width = `${(Math.max(0, b - a) / d) * 100}%`;
    this.rangeIn.hidden = t0 === null;
    this.rangeOut.hidden = t1 === null;
    // The slow stretch, darker, inside the band.
    const slow = ramping(this.ramp) ? rampSpanOf(this.ramp, this.span) : null;
    this.rangeSlow.hidden = !slow;
    if (slow) {
      const width = Math.max(1e-6, b - a);
      this.rangeSlow.style.left = `${clamp(((slow.t0 - a) / width) * 100, 0, 100)}%`;
      this.rangeSlow.style.width = `${clamp(((slow.t1 - slow.t0) / width) * 100, 0, 100)}%`;
    }
  }

  // --- recording a clip -------------------------------------------------------------------------

  /** A kill row's one-click short: the clip marked round the kill with the
   *  lead-in and the tail, the bullet cam armed on its round, recorded to a
   *  file. An armed chase survives the recording's own seek back
   *  (replay-roundcam.js `step` lets an armed shot through a jump before
   *  its round), so the ride is in the file from the shoulder to the fall. */
  recordShort(row) {
    const f = row?.round?.f;
    if (!f || this.recorder) return;
    const kill = row.kill ?? this.killAt(row.t, row.victim)?.kill ?? null;
    this.clipAround(f.t, kill?.t ?? row.t ?? f.t);
    this.take = { f, kill };
    this.takeHeld = false;
    this.armShot(f, kill);
    this.record({ fly: false });
  }

  /** The ride on screen recorded (the plate's Record): the same shot armed
   *  again from the clip's start, written to a file. */
  recordRide() {
    const target = this.rounds.target;
    const f = target?.f;
    if (!f || this.recorder) return;
    const kill = target.kill ?? null;
    this.rounds.stop(false);
    this.clipAround(f.t, kill?.t ?? f.t);
    this.take = { f, kill };
    this.takeHeld = false;
    this.armShot(f, kill);
    this.record({ fly: false });
  }

  /** The range recorded to a video file: from a little before its in point
   *  (the seek's bodies settle), the recorder started at the in point and
   *  stopped at the out point, whatever the camera is doing between.
   *  `fly` false leaves the clip's camera keys alone: an armed bullet cam
   *  is the shot's camera. */
  record({ fly = true } = {}) {
    const span = this.span;
    if (!span) {
      this.ui.flash('Mark the clip first (I, O)', 2000);
      return;
    }
    if (this.recorder) return;
    if (!recorderMime(false)) {
      this.ui.flash('This browser cannot record video', 2400);
      return;
    }
    const canvas = this.ctx.renderer?.domElement;
    if (!canvas?.captureStream) {
      this.ui.flash('This page has no canvas to record', 2400);
      return;
    }
    this.ctx.ensureAudio?.();
    // A frame guide set is the clip's shape: the view cropped to it, drawn
    // after each render (`afterRender`).
    const crop = cropOf(this.prefs.frame, canvas.width, canvas.height);
    let source = canvas;
    if (crop) {
      source = document.createElement('canvas');
      source.width = crop.w;
      source.height = crop.h;
    }
    const clip = new ClipRecorder(source, { sound: () => this.ctx.audioTap?.() ?? null });
    this.recorder = { clip, t0: span.t0, t1: span.t1, started: false, level: this.player.rec.level, crop, source };
    this.player.seek(Math.max(0, span.t0 - SETTLE));
    this.player.playing = true;
    // What is recorded is what P plays: the camera move and the slow motion.
    this.rangePlaying = true;
    if (fly) {
      // A take is recorded as it plays: its shot armed from the start.
      const take = this.autoFilms(span) ? this.takeInside(span) : null;
      if (take) {
        this.take = take;
        this.armShot(take.f, take.kill, { again: true });
        this.leadInto(span);
      } else this.flyShot(span);
    }
    this.syncPlate();
    this.panel?.refresh(true);
  }

  /** The recording's turn in a frame: started at the in point, finished at
   *  the out point; the clock taken elsewhere (a seek away) abandons it. */
  runRecorder(t) {
    const r = this.recorder;
    if (!r) return;
    if (!r.started) {
      if (t < r.t0 - SETTLE - 0.5 || t > r.t1) {
        this.stopRecording(false);
        return;
      }
      if (t >= r.t0) {
        try {
          r.clip.start();
          r.started = true;
          r.startT = t;
        } catch (error) {
          console.warn('creator: recording', error);
          this.ui.flash(`Could not record: ${error.message}`, 2600);
          this.recorder = null;
        }
        this.syncPlate();
      }
      return;
    }
    if (t < r.startT - 0.5) {
      this.stopRecording(false);
      this.ui.flash('Recording abandoned', 1800);
      return;
    }
    if (t >= r.t1 || !this.player.playing && t >= this.player.rec.duration) this.stopRecording(true);
  }

  /** After each render, in the task that drew it: the cropped clip's frame. */
  afterRender(canvas) {
    if (this.suggestions?.job) quietly('the suggested angles', () => this.drawThumbs(canvas));
    else if (this.shotWanted && this.on) quietly('a view\'s picture', () => this.drawKeyShot(canvas));
    const r = this.recorder;
    if (!r?.started || !r.crop) return;
    const c = r.crop;
    r.draw ??= r.source.getContext('2d');
    r.draw.drawImage(canvas, c.x, c.y, c.w, c.h, 0, 0, c.w, c.h);
  }

  /** Stop recording; `keep` saves the clip as a file. */
  stopRecording(keep = true) {
    const r = this.recorder;
    if (!r) return;
    this.recorder = null;
    if (!r.started) {
      this.syncPlate();
      return;
    }
    if (!keep) {
      r.clip.cancel();
      this.syncPlate();
      return;
    }
    const mime = r.clip.mime;
    r.clip.stop().then(blob => {
      if (!blob?.size) {
        this.ui.flash('The recording came out empty', 2400);
        return;
      }
      download(blob, clipName(r.level, r.t0, r.t1, mime));
      this.ui.flash(`Clip saved: ${(blob.size / 1e6).toFixed(1)} MB`, 2600);
    }).catch(error => console.warn('creator: finishing the recording', error));
    this.player.playing = false;
    this.syncPlate();
    this.panel?.refresh(true);
  }

  // --- the camera track -------------------------------------------------------------------------

  /** The view on screen kept as a key at the playhead (K), or at `at`. */
  addKey(at = this.player.time, word = null) {
    const cam = this.ctx.camera;
    const key = keyOf(cam, Number.isFinite(at) ? at : this.player.time);
    if (this.lens.fov === null) delete key.fov;
    if (!keyValid(key)) return;
    this.keys = addKey(this.keys, key);
    this.keysVersion = (this.keysVersion ?? 0) + 1;
    if (this.track) this.track.keys = keysIn(this.keys, this.span);
    this.useMove = true;
    // Its picture is the next frame: the view on screen as it was kept.
    this.shotWanted = { sig: poseSig(key), live: true };
    this.saveKept();
    this.syncKeyMarks();
    this.syncRange();
    this.panel?.refresh(true);
    this.ui.flash(word ? `View ${word} kept at ${fmt(key.t)}` : `View kept at ${fmt(key.t)}`);
  }

  /** A small picture of what a camera key sees, or null until one is drawn:
   *  taken from the frame when the key was kept, else drawn from its pose
   *  (a key read back from the browser's storage) the next frame. */
  keyShot(key) {
    const sig = poseSig(key);
    const shot = this.keyShots.get(sig);
    if (shot) return shot;
    if (!this.shotWanted) this.shotWanted = { sig, key, live: false };
    return null;
  }

  /** The picture a key wants, in the task that drew the frame. */
  drawKeyShot(canvas) {
    const want = this.shotWanted;
    if (!want) return;
    this.shotWanted = null;
    const w = 192;
    const h = Math.round(w / Math.max(0.5, canvas.width / Math.max(1, canvas.height)));
    const pic = document.createElement('canvas');
    pic.width = w;
    pic.height = h;
    if (!want.live) {
      const renderer = this.ctx.renderer;
      const scene = this.ctx.scene;
      const main = this.ctx.camera;
      if (!renderer || !scene || !main) return;
      const cam = main.clone();
      cam.position.fromArray(want.key.pos);
      cam.quaternion.fromArray(want.key.quat);
      if (Number.isFinite(want.key.fov)) cam.fov = want.key.fov;
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld(true);
      renderer.render(scene, cam);
      pic.getContext('2d').drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, w, h);
      renderer.render(scene, main);
    } else {
      pic.getContext('2d').drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, w, h);
    }
    this.keyShots.set(want.sig, pic);
    this.panel?.refresh(true);
  }

  /** What a camera key sees, on screen: the replay paused at its moment and
   *  the free camera on its view. */
  lookAtKey(key) {
    if (!key) return;
    const player = this.player;
    this.stopRigs();
    this.rangePlaying = false;
    player.playing = false;
    player.seek(key.t);
    this.freeAt(new THREE.Vector3().fromArray(key.pos), new THREE.Quaternion().fromArray(key.quat));
    const inside = keysIn(this.keys, this.span);
    const i = inside.indexOf(key);
    const name = i < 0 ? 'This view' : `Keyframe ${i + 1}`;
    this.ui.flash(`${name} · what the camera sees at ${fmt(key.t)}`, 2200);
  }





  /** The camera move fitted to the action: the keys inside the clip slid and
   *  scaled so the first lands where the action starts and the last where it
   *  ends (replay-shot.js `fitKeys`). One press for a move built across a
   *  clip's padded ends -- the camera then travels while the round is in the
   *  air, and arrives as it lands. */
  fitMove() {
    const beat = this.clipAction;
    if (!beat) {
      this.ui.flash(this.span ? 'This clip has no one kill inside it: the move runs over all of it' : 'Mark the clip first (I, O)', 2800);
      return;
    }
    const fitted = fitKeys(this.keys, this.span, beat);
    if (!fitted) {
      this.ui.flash(keysIn(this.keys, this.span).length >= 2 ? 'The move already runs over the action' : 'Add two keyframes to the clip first (K)', 2400);
      return;
    }
    this.keys = fitted;
    this.keysVersion = (this.keysVersion ?? 0) + 1;
    if (this.track) this.track.keys = keysIn(this.keys, this.span);
    this.saveKept();
    this.syncKeyMarks();
    this.syncRange();
    this.panel?.refresh(true);
    this.ui.flash(`The move runs the action, ${fmt(beat.t0)} to ${fmt(beat.t1)}`, 2400);
  }

  removeKey(key) {
    this.keys = this.keys.filter(k => k !== key);
    this.keysVersion = (this.keysVersion ?? 0) + 1;
    if (this.track) this.track.keys = keysIn(this.keys, this.span);
    if (!keysIn(this.keys, this.span).length) this.stopTrack();
    this.saveKept();
    this.syncKeyMarks();
    this.panel?.refresh(true);
  }

  clearKeys() {
    this.stopTrack();
    this.keys = [];
    this.keysVersion = (this.keysVersion ?? 0) + 1;
    this.saveKept();
    this.syncKeyMarks();
    this.panel?.refresh(true);
  }

  /** The camera along the keys from the first, playing. */
  playTrack(fromStart = true) {
    if (this.keys.length < 2) {
      this.ui.flash('Keep two keys at least (K)', 2000);
      return;
    }
    this.rounds.stop(false);
    this.player.highlights?.setAuto(false, true);
    this.player.highlights?.stopReel();
    this.track = this.moveRig(this.span);
    this.player.camera.setRig(this.track);
    if (fromStart) this.player.seek(this.keys[0].t);
    this.player.playing = true;
    this.syncPlate();
    this.panel?.refresh(true);
  }

  stopTrack(free = true) {
    this.autoTrack = false;
    if (!this.track) return;
    if (this.player.camera.rig === this.track) {
      this.player.camera.setRig(null);
      // Where the track left the camera, the free camera takes over.
      const cam = this.ctx.camera;
      if (free) this.freeAt(cam.position.clone(), cam.quaternion.clone());
    }
    this.track = null;
    this.syncPlate();
    this.panel?.refresh(true);
  }

  /** A key dragged along the timeline to `t`: the track re-knotted. A key
   *  dropped on another replaces it, as a key kept again does. */
  moveKey(key, t) {
    if (!Number.isFinite(t)) return;
    const at = clamp(t, 0, this.player.rec.duration);
    this.keys = addKey(this.keys.filter(k => k !== key), { ...key, t: at });
    this.keysVersion = (this.keysVersion ?? 0) + 1;
    if (this.track) this.track.keys = keysIn(this.keys, this.span);
    this.saveKept();
    this.syncKeyMarks();
    this.syncRange();
    this.panel?.refresh(true);
    this.ui.flash(`Key at ${fmt(at)}`);
  }

  /** The keys as diamonds along the timeline: a click goes there, a drag
   *  moves the key. */
  syncKeyMarks() {
    if (!this.keyMarks) return;
    const d = Math.max(0.001, this.player.rec.duration);
    this.keyMarks.textContent = '';
    for (const key of this.keys) {
      const mark = el('button', 'rc-key');
      mark.type = 'button';
      mark.title = `Camera key ${fmt(key.t)} · drag to move`;
      mark.style.left = `${(key.t / d) * 100}%`;
      mark.addEventListener('pointerdown', e => {
        if (e.button !== 0) {
          e.stopPropagation();
          return;
        }
        e.stopPropagation();
        e.preventDefault();
        const x0 = e.clientX;
        let dragT = null;
        const move = ev => {
          if (dragT === null && Math.abs(ev.clientX - x0) <= CLICK_SLOP) return;
          dragT = this.ui.timeline.timeAt(ev.clientX);
          mark.style.left = `${(dragT / d) * 100}%`;
        };
        const up = () => {
          mark.removeEventListener('pointermove', move);
          mark.removeEventListener('pointerup', up);
          mark.removeEventListener('pointercancel', up);
          quietly('a camera key', () => {
            if (dragT !== null) this.moveKey(key, dragT);
            else this.player.seek(key.t);
          });
        };
        try { mark.setPointerCapture?.(e.pointerId); } catch {}
        mark.addEventListener('pointermove', move);
        mark.addEventListener('pointerup', up);
        mark.addEventListener('pointercancel', up);
      });
      this.keyMarks.append(mark);
    }
  }

  /** The path through the keys drawn in the level while the clip tab is up
   *  and the track is not flying. */
  syncPath(show) {
    const want = show && this.keys.length >= 2 && !this.track;
    const sig = want ? `${this.keysVersion ?? 0}` : '';
    if (sig === this.pathSig) return;
    this.pathSig = sig;
    if (this.path) {
      this.path.removeFromParent();
      this.path.traverse(o => {
        o.geometry?.dispose();
        o.material?.dispose();
      });
      this.path = null;
    }
    if (!want) return;
    const group = new THREE.Group();
    group.name = 'creator track';
    const points = pathPoints(this.keys).map(p => new THREE.Vector3(p[0], p[1], p[2]));
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color: 0xe8c35a, transparent: true, opacity: 0.85, depthTest: false }));
    line.renderOrder = 10;
    group.add(line);
    const dot = new THREE.SphereGeometry(0.35, 12, 8);
    const mat = new THREE.MeshBasicMaterial({ color: 0xf3f0da, depthTest: false });
    for (const key of this.keys) {
      const m = new THREE.Mesh(dot, key === this.keys[0] ? mat : mat);
      m.position.set(key.pos[0], key.pos[1], key.pos[2]);
      m.renderOrder = 11;
      group.add(m);
    }
    for (const o of group.children) o.frustumCulled = false;
    this.ctx.scene.add(group);
    this.path = group;
  }

  // --- the lens and the frame -------------------------------------------------------------------

  /** The camera's lens this frame (replay-camera.js `setLensHook`): the
   *  track's own where it flies, else the one set here; then the roll. */
  shapeLens(cam) {
    const fov = this.track?.fovAt(this.player.time) ?? this.lens.fov;
    const near = this.rounds.nearPlane() ?? this.player.camera.pageLens.near;
    let changed = false;
    if (fov !== null && Math.abs(cam.fov - fov) > 1e-3) {
      cam.fov = fov;
      changed = true;
    }
    if (near > 0 && cam.near !== near) {
      cam.near = near;
      changed = true;
    }
    if (changed) cam.updateProjectionMatrix();
    if (this.lens.roll) cam.quaternion.multiply(_roll.setFromAxisAngle(_z, (this.lens.roll * Math.PI) / 180));
  }

  setFov(deg) {
    this.lens.fov = deg === null ? null : clamp(deg, FOV_RANGE[0], FOV_RANGE[1]);
    if (deg === null) {
      // The page's own lens back, whatever the slider left.
      this.player.camera.setLensHook(null);
      if (this.on) this.player.camera.setLensHook(cam => this.shapeLens(cam));
    }
  }

  setRoll(deg) {
    this.lens.roll = clamp(deg, -ROLL_MAX, ROLL_MAX);
  }

  /** Letterbox and vertical guides, and the thirds, over the view. */
  syncFrame() {
    if (!this.frameGuide) return;
    const frame = this.on ? this.prefs.frame : 'none';
    this.frameGuide.className = `rc-frame f-${frame}${this.on && this.prefs.thirds ? ' thirds' : ''}`;
    this.frameGuide.hidden = !this.on || (frame === 'none' && !this.prefs.thirds);
  }

  setPref(name, value) {
    this.prefs[name] = value;
    this.savePrefs();
    this.applyPrefs();
    this.syncFrame();
    this.panel?.refresh(true);
  }

  // --- the plate over the view ------------------------------------------------------------------

  buildPlate() {
    const plate = el('div', 'rc-plate');
    plate.hidden = true;
    this.plateText = el('span', 'rc-plate-text');
    this.plateDot = el('i', 'rc-plate-dot');
    const rec = el('button', 'rp-btn rc-plate-rec', 'Record');
    rec.type = 'button';
    rec.title = 'Record this ride to a video file, from the clip\'s start';
    rec.hidden = true;
    rec.addEventListener('click', e => {
      e.stopPropagation();
      quietly('recording the ride', () => this.recordRide());
    });
    this.plateRec = rec;
    // The take's shot style, one press to the next: try them as it loops.
    const style = el('button', 'rp-btn rc-plate-style', 'Chase');
    style.type = 'button';
    style.title = 'The next shot style (G)';
    style.hidden = true;
    style.addEventListener('click', e => {
      e.stopPropagation();
      quietly('the shot style', () => this.cycleShotStyle());
    });
    this.plateStyle = style;
    const stop = el('button', 'rp-btn', 'Stop');
    stop.type = 'button';
    stop.title = 'Stop (X)';
    stop.addEventListener('click', e => {
      e.stopPropagation();
      quietly('stopping', () => this.stopAll());
    });
    plate.append(this.plateDot, this.plateText, style, rec, stop);
    return plate;
  }

  /** What the creator's camera is doing, over the card. */
  syncPlate() {
    if (!this.plate) return;
    const name = pid => nameAt(this.player.rec, pid, this.player.time);
    let text = null;
    let kind = '';
    const slow = this.slowWord();
    const slowly = slow ? ` · SLOW ${slow}` : '';
    // Past the first keyframe a take's camera is the keyframes'.
    const onKeys = Boolean(this.track) && (!this.rounds.active || this.player.time >= (this.track.firstAt?.() ?? Infinity));
    if (this.recorder) {
      const r = this.recorder;
      kind = 'rec';
      text = r.started ? `REC ${fmt(Math.max(0, this.player.time - r.t0))} / ${fmt(r.t1 - r.t0)}${slowly}` : 'REC · getting ready';
    } else if (this.rounds.active && !onKeys) {
      const d = this.rounds.describe(name, k => this.display(k));
      kind = d?.phase ?? '';
      const melee = Boolean(this.rounds.target?.melee);
      const words = melee ? { armed: 'KNIFE · WAITING', flying: 'KNIFE', impact: 'KNIFE' }
        : { armed: 'BULLET CAM · WAITING', flying: 'BULLET CAM', impact: 'BULLET CAM · HIT' };
      text = d ? `${this.takeLive ? 'TAKE · ' : ''}${words[d.phase]} · ${d.text}` : null;
      if (text && this.queue) text = `${this.queue.i + 1} OF ${this.queue.list.length} · ${text}`;
    } else if (this.track) {
      kind = 'track';
      const n = keysIn(this.keys, this.span).length;
      text = `${this.autoTrack ? 'CLIP · ' : ''}CAMERA ON YOUR KEYFRAMES · ${n || this.keys.length}${slowly}`;
    } else if ((this.rangePlaying || this.ramped) && this.span) {
      // The slow motion says so even when the clip was not started with P:
      // a replay that slows down on its own is a mystery otherwise.
      kind = 'clip';
      const span = this.span;
      text = `${this.take ? (this.takeHeld ? 'TAKE · YOUR CAMERA' : 'TAKE') : 'CLIP'} ${fmt(Math.max(0, this.player.time - span.t0))} / ${fmt(span.t1 - span.t0)}${slowly}${this.range.loop ? ' · LOOP' : ''}`;
    }
    const show = this.on && text !== null;
    this.plate.hidden = !show;
    if (!show) return;
    this.plate.className = `rc-plate k-${kind}`;
    if (this.plateText.textContent !== text) this.plateText.textContent = text;
    // A ride on a known shot can be recorded as it stands, in one press.
    this.plateRec.hidden = Boolean(this.recorder) || !(this.rounds.active && this.rounds.target?.f);
    this.plateStyle.hidden = Boolean(this.recorder) || !(this.take || this.movesCamera);
    const label = this.autoFilms() ? styleLabel(this.rounds.style) : this.movesCamera ? 'Keyframes' : this.takeHeld ? 'Your camera' : styleLabel(this.rounds.style);
    if (this.plateStyle.textContent !== label) this.plateStyle.textContent = label;
  }

  // --- per frame ------------------------------------------------------------------------------------

  /** Before the camera is placed: the round cam finds and follows its round
   *  and sets the clock; the range loops. */
  lead(t, dt) {
    if (!this.on) return;
    this.rounds.step(t, dt);
    // Past its last key the track lets go, the free camera where it ended.
    // The clip's own move holds B to the clip's end; one flown by hand lets go.
    if (this.track && !this.autoTrack && this.player.playing && t > this.keys[this.keys.length - 1].t + 1) this.stopTrack();
    const prev = this.leadT;
    this.leadT = t;
    // The loop's jump landed at the top of this frame (`loopDue`): the shot
    // goes round again now, on a frame whose clock is already the clip's
    // start. Made in the frame that crossed the out point, the jump left the
    // rest of that frame on the old clock, and one frame of the end was
    // drawn on the start.
    if (this.loopDue) {
      const span = this.span;
      this.loopDue = false;
      // The frame steps the clock on from the jump: a frame's worth past it.
      if (span && t >= span.t0 - 1e-3 && t < span.t0 + 0.5) this.loopClip();
    }
    // A move's preview stops paused on its end.
    if (this.previewUntil !== null && this.previewUntil !== undefined) {
      // Paused, or taken back before it by hand: the preview is over.
      if (!this.player.playing || t < this.previewFrom - 0.5) this.previewUntil = null;
      else if (t >= this.previewUntil) {
        this.previewUntil = null;
        this.player.playing = false;
        this.rangePlaying = false;
      }
    }
    if (this.editing && this.span) {
      // In the editor the clip is the recording: the loop goes round when
      // the playhead crosses the out point playing, and stops at the strip's
      // edge. Played on from beyond the out point by hand, it plays on.
      const span = this.span;
      const player = this.player;
      if (!this.recorder && player.playing && crossedOut(prev, t, span.t1)) {
        if (this.range.loop) {
          this.loopDue = true;
          this.ui.timeline.scrubTo = span.t0;
        }
        else {
          player.playing = false;
          this.rangePlaying = false;
          this.endFly();
        }
      } else if (player.playing && this.clipbar?.window && t >= this.clipbar.window.w1 - 1e-3) {
        player.playing = false;
      }
    } else if (this.rangePlaying) {
      const span = this.span;
      if (!span || t < span.t0 - 0.5) {
        this.rangePlaying = false;
        this.endFly();
      } else if (t > span.t1 + 1) {
        // Taken past the clip by hand: the loop lets go rather than pull the
        // playhead back from where it was put.
        this.rangePlaying = false;
        this.endFly();
      } else if (t >= span.t1 && !this.recorder) {
        if (this.range.loop && this.takeLive) this.armTake(true);
        else if (this.range.loop) this.player.seek(span.t0);
        else {
          this.player.playing = false;
          this.rangePlaying = false;
          this.endFly();
        }
      }
    }
    this.runRamp(t);
  }

  /** After the frame: the recording, the pick ring, the plate, the panel. */
  update(t, dt) {
    if (!this.on) return;
    this.noteFollow();
    this.runRecorder(t);
    this.runQueue(dt);
    if (this.pointer && !this.ui.input.classList.contains('dragging')) this.setHover(this.pickUnder(this.pointer));
    else if (this.hover) this.setHover(null);
    if (this.rounds.active || this.recorder || this.track || this.rangePlaying || this.ramped) this.syncPlate();
    else if (!this.plate?.hidden) this.syncPlate();
    this.panelClock += dt;
    if (this.panelClock >= PANEL_TICK) {
      this.panelClock = 0;
      this.panel?.refresh(false);
    }
    this.syncPath(this.panel?.tab === 'clips');
    if (this.editing) this.clipbar?.sync(t);
  }

  dispose() {
    this.disposed = true;
    quietly('the recording', () => this.stopRecording(false));
    quietly('the round cam', () => this.rounds.dispose());
    quietly('the track', () => this.stopTrack());
    quietly('the clock', () => this.releaseRamp());
    quietly('the lens', () => this.player.camera.setLensHook(null));
    quietly('the path', () => this.syncPath(false));
    for (const b of Object.values(this.ui.modeBtns ?? {})) b.removeEventListener('click', this.onModeClick, true);
    const input = this.ui.input;
    if (this.onMove) {
      input.removeEventListener('pointermove', this.onMove);
      input.removeEventListener('pointerdown', this.onDown);
      input.removeEventListener('pointerup', this.onUp);
      input.removeEventListener('dblclick', this.onDouble);
      input.removeEventListener('pointerleave', this.onLeave);
    }
    for (const node of [this.button, this.plate, this.reticle, this.frameGuide, this.rangeBand, this.keyMarks, this.panel?.el, this.clipbar?.el]) node?.remove();
    this.ui.root?.classList.remove('rc-editing');
  }

  /** A chase, the camera move, the slow motion and a recording, stopped. */
  stopAll() {
    const any = this.rounds.active || this.track || this.recorder || this.queue || this.rangePlaying;
    this.queue = null;
    this.rangePlaying = false;
    this.take = null;
    this.stopRecording(false);
    this.rounds.stop(false);
    this.stopTrack();
    this.releaseRamp();
    if (any) this.ui.flash('Stopped');
    this.syncPlate();
  }
}

/** The bar button's icon: a clapperboard. */
const CLAPPER = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 6.6h12v7H2z" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M1.7 2.9 13.4 1.3l.4 2.9L2.1 5.8z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="m4.4 2.5 1.8 2.8M8 2l1.8 2.8" stroke="currentColor" stroke-width="1.3"/></svg>';
