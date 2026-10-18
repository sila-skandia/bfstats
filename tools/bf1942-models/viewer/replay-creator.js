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
import { RoundCam, BULLET_TIME, heavyRound, nextShotOf } from './replay-roundcam.js';
import { TrackRig, addKey, keyOf, keyValid, pathPoints } from './replay-camtrack.js';
import { pickAt, pickCandidates, shotOfRound } from './replay-pick.js';
import { ClipRecorder, clipName, download, recorderMime } from './replay-clip.js';
import { dossierOf, killFactsOf } from './replay-dossier.js';
import { RAMP_SPEEDS, keysIn, killByFire, nextKillShot, noRamp, rampOf, rampSpanOf, rampSpeedAt, ramping, speedWord } from './replay-shot.js';
import { CreatorPanel, FOV_RANGE, LEAD_INS, fmt } from './replay-creator-panel.js';

/** Seconds a clip set from a moment runs on past it. */
const TAIL = 2.5;
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

const PREFS_KEY = 'bf42-creator-prefs';
const STORE_KEY = 'bf42-creator:';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const _roll = new THREE.Quaternion();
const _z = new THREE.Vector3(0, 0, 1);

/** The part of a `w` x `h` view a frame guide keeps (`frame` a prefs value),
 *  whole pixels and even sizes for the encoder, or null for the whole view. */
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
    this.range = { in: null, out: null, loop: false };
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
      }));
    this.keys = (Array.isArray(kept.keys) ? kept.keys : []).filter(k => keyValid(k) && inRound(k.t)).sort((a, b) => a.t - b.t);
    if (inRound(kept.range?.in) && inRound(kept.range?.out) && kept.range.out > kept.range.in) {
      this.range.in = kept.range.in;
      this.range.out = kept.range.out;
    }
    this.ramp = rampOf(kept.ramp);
    if (!inRound(this.ramp.in)) this.ramp.in = null;
    if (!inRound(this.ramp.out)) this.ramp.out = null;
  }

  saveKept() {
    writeJson(this.storeKey, { clips: this.clips, keys: this.keys, ramp: this.ramp, range: { in: this.range.in, out: this.range.out } });
  }

  savePrefs() {
    writeJson(PREFS_KEY, this.prefs);
  }

  applyPrefs() {
    this.rounds.bulletTime = Object.hasOwn(BULLET_TIME, this.prefs.pace) ? BULLET_TIME[this.prefs.pace] : BULLET_TIME.strong;
    this.rounds.afterHit = this.prefs.afterHit;
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
    this.rangeBand = el('div', 'rc-range');
    this.rangeIn = el('i', 'rc-range-in');
    this.rangeOut = el('i', 'rc-range-out');
    this.rangeSlow = el('i', 'rc-range-slow');
    this.rangeBand.append(this.rangeSlow, this.rangeIn, this.rangeOut);
    this.keyMarks = el('div', 'rc-keymarks');
    ui.timeline.track.append(this.rangeBand);
    ui.timeline.el.append(this.keyMarks);
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
      ['5', 'ride his next round that kills'],
      ['shift 5', 'ride his next round, whatever it hits'],
      ['6', 'ride the next rocket, shell or grenade'],
      ['X', 'stop the chase or the camera move'],
      ['I / O', 'the clip\'s in and out points'],
      ['P', 'play the clip'],
      ['K', 'keep the view as a camera key'],
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
      case 'KeyK': if (once) this.addKey(); return true;
      case 'KeyX': if (once) this.stopAll(); return true;
      case 'Digit5': case 'Numpad5':
        if (once) {
          if (e.shiftKey) this.chaseNext();
          else this.chaseKillShot();
        }
        return true;
      case 'Digit6': case 'Numpad6': if (once) this.chaseHeavy(); return true;
      case 'Escape':
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

  /** A chase or the track let go, the camera to its mode. */
  stopRigs() {
    this.queue = null;
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
    this.rideShot(next.f, next.kill, 'Kill shot');
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
    this.rideShot(f, this.killOfShot(f), this.display(f.weapon) || 'Big round');
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

  /** The round cam armed with shot `f` (and the kill it made). */
  armShot(f, kill = null) {
    this.releaseRamp();
    this.stopTrack();
    this.player.highlights?.setAuto(false, true);
    this.player.highlights?.stopReel();
    this.followQuietly(f.pid);
    if (this.player.camera.mode === 'free') this.player.camera.setMode('orbit');
    this.rounds.arm(f, { kill });
    this.syncPlate();
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
  bulletCam(row) {
    const f = row?.round?.f;
    if (!f) return;
    const player = this.player;
    this.rounds.stop(false);
    player.seek(Math.max(0, f.t - this.prefs.leadIn));
    const kill = row.kill ?? this.killAt(row.t, row.victim)?.kill ?? null;
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
    this.bulletCam(list[0]);
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
    this.bulletCam(q.list[q.i]);
  }

  /** The range around a moment: the lead-in before `t0`, TAIL after `t1`. */
  clipAround(t0, t1 = t0, pid = this.subjectPid()) {
    const d = this.player.rec.duration;
    this.range.in = clamp(t0 - this.prefs.leadIn, 0, d);
    this.range.out = clamp(t1 + TAIL, 0, d);
    this.rangePid = pid;
    this.rangeChanged('Clip marked');
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

  rangeChanged(word) {
    // A slow stretch the clip's new ends leave nothing of goes back to the
    // whole clip rather than quietly doing nothing.
    if (ramping(this.ramp) && (this.ramp.in !== null || this.ramp.out !== null) && !rampSpanOf(this.ramp, this.span)) {
      this.ramp.in = null;
      this.ramp.out = null;
    }
    this.saveKept();
    this.syncRange();
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
    if (this.track || keysIn(this.keys, span).length < 2) return false;
    this.player.highlights?.setAuto(false, true);
    this.player.highlights?.stopReel();
    this.track = new TrackRig(this.keys);
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

  /**
   * The replay's clock under the clip's slow motion, before the frame: the
   * ramp holds it inside its stretch while the clip plays and gives it back
   * as it found it outside. The round cam's bullet time wins where both
   * would run -- it saves and restores the clock itself.
   */
  runRamp(t) {
    const player = this.player;
    if (this.rounds.active || !player.playing || this.ui.scrubbing || !this.span) {
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
    this.endFly();
    if (Array.isArray(clip.keys)) {
      this.keys = clip.keys.map(k => ({ ...k }));
      this.keysVersion = (this.keysVersion ?? 0) + 1;
      if (this.track) this.track.keys = this.keys;
      this.syncKeyMarks();
    }
    if (clip.ramp) this.ramp = rampOf(clip.ramp);
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

  /** The range recorded to a video file: from a little before its in point
   *  (the seek's bodies settle), the recorder started at the in point and
   *  stopped at the out point, whatever the camera is doing between. */
  record() {
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
    this.flyShot(span);
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
    if (this.track) this.track.keys = this.keys;
    this.saveKept();
    this.syncKeyMarks();
    this.syncRange();
    this.panel?.refresh(true);
    this.ui.flash(word ? `Camera ${word} at ${fmt(key.t)}` : `Key ${this.keys.length} at ${fmt(key.t)}`);
  }

  /** The view on screen kept as the camera at one end of the clip (A, B):
   *  two of those are the camera move the clip flies. */
  keyAtPoint(which) {
    const t = this.range[which];
    if (t === null) {
      this.ui.flash(which === 'in' ? 'Mark the clip\'s start first (I)' : 'Mark the clip\'s end first (O)', 2400);
      return;
    }
    this.addKey(t, which === 'in' ? 'A' : 'B');
  }

  removeKey(key) {
    this.keys = this.keys.filter(k => k !== key);
    this.keysVersion = (this.keysVersion ?? 0) + 1;
    if (this.track) this.track.keys = this.keys;
    if (this.keys.length < 2) this.stopTrack();
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
    this.track = new TrackRig(this.keys);
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

  /** The keys as diamonds along the timeline. */
  syncKeyMarks() {
    if (!this.keyMarks) return;
    const d = Math.max(0.001, this.player.rec.duration);
    this.keyMarks.textContent = '';
    for (const key of this.keys) {
      const mark = el('button', 'rc-key');
      mark.type = 'button';
      mark.title = `Camera key ${fmt(key.t)}`;
      mark.style.left = `${(key.t / d) * 100}%`;
      mark.addEventListener('pointerdown', e => e.stopPropagation());
      mark.addEventListener('click', e => {
        e.stopPropagation();
        quietly('a camera key', () => this.player.seek(key.t));
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
    const stop = el('button', 'rp-btn', 'Stop');
    stop.type = 'button';
    stop.title = 'Stop (X)';
    stop.addEventListener('click', e => {
      e.stopPropagation();
      quietly('stopping', () => this.stopAll());
    });
    plate.append(this.plateDot, this.plateText, stop);
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
    if (this.recorder) {
      const r = this.recorder;
      kind = 'rec';
      text = r.started ? `REC ${fmt(Math.max(0, this.player.time - r.t0))} / ${fmt(r.t1 - r.t0)}${slowly}` : 'REC · getting ready';
    } else if (this.rounds.active) {
      const d = this.rounds.describe(name, k => this.display(k));
      kind = d?.phase ?? '';
      text = d ? `${{ armed: 'BULLET CAM · WAITING', flying: 'BULLET CAM', impact: 'BULLET CAM · HIT' }[d.phase]} · ${d.text}` : null;
      if (text && this.queue) text = `${this.queue.i + 1} OF ${this.queue.list.length} · ${text}`;
    } else if (this.track) {
      kind = 'track';
      text = `${this.autoTrack ? 'CLIP · CAMERA MOVE' : 'TRACK'} · ${this.keys.length} keys${slowly}`;
    } else if ((this.rangePlaying || this.ramped) && this.span) {
      // The slow motion says so even when the clip was not started with P:
      // a replay that slows down on its own is a mystery otherwise.
      kind = 'clip';
      const span = this.span;
      text = `CLIP ${fmt(Math.max(0, this.player.time - span.t0))} / ${fmt(span.t1 - span.t0)}${slowly}`;
    }
    const show = this.on && text !== null;
    this.plate.hidden = !show;
    if (!show) return;
    this.plate.className = `rc-plate k-${kind}`;
    if (this.plateText.textContent !== text) this.plateText.textContent = text;
  }

  // --- per frame ------------------------------------------------------------------------------------

  /** Before the camera is placed: the round cam finds and follows its round
   *  and sets the clock; the range loops. */
  lead(t, dt) {
    if (!this.on) return;
    this.rounds.step(t, dt);
    // Past its last key the track lets go, the free camera where it ended.
    if (this.track && this.player.playing && t > this.keys[this.keys.length - 1].t + 1) this.stopTrack();
    if (this.rangePlaying) {
      const span = this.span;
      if (!span || t < span.t0 - 0.5) {
        this.rangePlaying = false;
        this.endFly();
      } else if (t >= span.t1 && !this.recorder) {
        if (this.range.loop) this.player.seek(span.t0);
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
    for (const node of [this.button, this.plate, this.reticle, this.frameGuide, this.rangeBand, this.keyMarks, this.panel?.el]) node?.remove();
  }

  /** A chase, the camera move, the slow motion and a recording, stopped. */
  stopAll() {
    const any = this.rounds.active || this.track || this.recorder || this.queue || this.rangePlaying;
    this.queue = null;
    this.rangePlaying = false;
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
