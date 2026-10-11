// The creator view (features/replay-creator-view): the round replay for the
// people who make videos of it. On the replay's bar for a signed-in player (and on a
// page served from this PC), it adds, over the replay's own chrome:
//
//   picking       the 3D view is live to the pointer: a man, a vehicle or a
//                 round in flight is ringed and named under it, and a click
//                 follows the man, the vehicle's crew, or chases the round;
//                 a double-click looks through the man's eyes (replay-pick.js);
//   the round cam a camera riding behind a round to what it hits, in bullet
//                 time, from a click, the followed man's next shot (5), or a
//                 kill in his highlights, set up over his shoulder before he
//                 fires (replay-roundcam.js);
//   highlights    the followed man's round sliced -- streaks, longest shots,
//                 multi-kills, vehicles, deaths, weapons -- each a click from
//                 its moment with a lead-in (replay-dossier.js, the panel);
//   clips         in and out points on the timeline (I, O), a range played or
//                 looped (P), kept per recording, and recorded to a video file
//                 from the canvas alone (replay-clip.js);
//   the track     camera keys (K) and a smooth path through them
//                 (replay-camtrack.js);
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
import { RoundCam, BULLET_TIME, nextShotOf } from './replay-roundcam.js';
import { TrackRig, addKey, keyOf, keyValid, pathPoints } from './replay-camtrack.js';
import { pickAt, pickCandidates, shotOfRound } from './replay-pick.js';
import { ClipRecorder, clipName, download, recorderMime } from './replay-clip.js';
import { dossierOf, killFactsOf } from './replay-dossier.js';
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
    this.clips = [];
    this.keys = [];
    this.track = null;            // the TrackRig while the track camera flies
    this.pointer = null;          // the pointer over the view: { x, y } in the stage's pixels
    this.down = null;             // a press on the view that may be a click
    this.hover = null;            // what the pointer is over: pickAt's answer
    this.facts = null;            // every kill's facts, read the first time a dossier needs them
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
      .map(c => ({ name: String(c.name ?? '').slice(0, 80), in: c.in, out: c.out, pid: Number.isInteger(c.pid) ? c.pid : null }));
    this.keys = (Array.isArray(kept.keys) ? kept.keys : []).filter(k => keyValid(k) && inRound(k.t)).sort((a, b) => a.t - b.t);
    if (inRound(kept.range?.in) && inRound(kept.range?.out) && kept.range.out > kept.range.in) {
      this.range.in = kept.range.in;
      this.range.out = kept.range.out;
    }
  }

  saveKept() {
    writeJson(this.storeKey, { clips: this.clips, keys: this.keys, range: { in: this.range.in, out: this.range.out } });
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
    this.rangeBand.append(this.rangeIn, this.rangeOut);
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
      ['5', 'chase his next round'],
      ['X', 'stop the chase or the track'],
      ['I / O', 'in and out points'],
      ['P', 'play the range'],
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
      this.ui.flash('Creator view');
    } else {
      this.stopRecording(false);
      this.rounds.stop(false);
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
      case 'Digit5': case 'Numpad5': if (once) this.chaseNext(); return true;
      case 'Escape':
        if (this.recorder || this.rounds.active || this.track || this.queue) {
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
    return pickAt(pickCandidates(this.player), camera, p.x, p.y, p.w, p.h);
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
    this.reticle.className = `rc-reticle show k-${hit.cand.kind} t${team}`;
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
    const what = f?.weapon ? display(f.weapon) : cand.tracer ? 'Bullet' : 'Round';
    return { text: f ? `${nameAt(this.player.rec, f.pid, t)}'s ${what} · chase` : `${what} · chase`, team: f ? teamAt(this.player.rec, f.pid, t) : 0 };
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

  /** Chase a round in flight (a click on it), paused or not. */
  chaseRound(obj, f = null) {
    this.stopTrack();
    this.player.highlights?.setAuto(false, true);
    this.player.highlights?.stopReel();
    const kill = f ? this.killOfShot(f) : null;
    if (this.rounds.chaseObject(obj, f, { kill })) this.ui.flash(kill ? 'Bullet cam: a killing round' : 'Bullet cam');
  }

  /** The followed man's next round (5): armed now, chased when it leaves. */
  chaseNext() {
    const player = this.player;
    const pid = this.on ? this.subjectPid() : player.followPid;
    if (pid === null || pid === undefined) return;
    const f = nextShotOf(player.rec, pid, player.time);
    if (!f) {
      this.ui.flash(`${nameAt(player.rec, pid, player.time)} fires no more`, 1800);
      return;
    }
    this.armShot(f, this.killOfShot(f));
    const wait = f.t - player.time;
    this.ui.flash(wait > 0.5 ? `Next round in ${wait.toFixed(1)} s` : 'Next round', 1600);
  }

  /** The round cam armed with shot `f` (and the kill it made). */
  armShot(f, kill = null) {
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

  /** The kill a recorded shot made, if the dossier's facts tie one to it. */
  killOfShot(f) {
    const facts = this.killFacts();
    for (const [kill, fact] of facts) if (fact.round?.f === f) return kill;
    return null;
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
    this.saveKept();
    this.syncRange();
    this.panel?.refresh(true);
    this.ui.flash('Range set');
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
    this.rangeChanged('Range cleared');
  }

  rangeChanged(word) {
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

  /** From the in point, playing (P); round again at the out point when the
   *  loop is on. */
  playRange() {
    const span = this.span;
    if (!span) {
      this.ui.flash('Set an in and an out point first (I, O)', 2000);
      return;
    }
    this.rounds.stop(false);
    this.player.seek(span.t0);
    this.player.playing = true;
    this.rangePlaying = true;
  }

  toggleLoop() {
    this.range.loop = !this.range.loop;
    this.ui.flash(this.range.loop ? 'Loop on' : 'Loop off');
    this.panel?.refresh(true);
  }

  saveClip() {
    const span = this.span;
    if (!span) return;
    const pid = this.rangePid ?? this.player.followPid;
    const who = pid !== null && pid !== undefined ? nameAt(this.player.rec, pid, span.t0) : 'Clip';
    this.clips.push({ name: `${who} ${fmt(span.t0)}`, in: span.t0, out: span.t1, pid: pid ?? null });
    this.clips.sort((a, b) => a.in - b.in);
    this.saveKept();
    this.panel?.refresh(true);
    this.ui.flash('Clip saved');
  }

  /** A saved clip as the range, playing from its start on its man. */
  useClip(clip, play = true) {
    this.range.in = clip.in;
    this.range.out = clip.out;
    this.rangePid = clip.pid;
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
  }

  // --- recording a clip -------------------------------------------------------------------------

  /** The range recorded to a video file: from a little before its in point
   *  (the seek's bodies settle), the recorder started at the in point and
   *  stopped at the out point, whatever the camera is doing between. */
  record() {
    const span = this.span;
    if (!span) {
      this.ui.flash('Set an in and an out point first (I, O)', 2000);
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

  /** The view on screen kept as a key at the playhead (K). */
  addKey() {
    const cam = this.ctx.camera;
    const key = keyOf(cam, this.player.time);
    if (this.lens.fov === null) delete key.fov;
    if (!keyValid(key)) return;
    this.keys = addKey(this.keys, key);
    this.keysVersion = (this.keysVersion ?? 0) + 1;
    if (this.track) this.track.keys = this.keys;
    this.saveKept();
    this.syncKeyMarks();
    this.panel?.refresh(true);
    this.ui.flash(`Key ${this.keys.length} at ${fmt(key.t)}`);
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

  /** The path through the keys drawn in the level while the camera tab is
   *  up and the track is not flying. */
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
    if (this.recorder) {
      const r = this.recorder;
      kind = 'rec';
      text = r.started ? `REC ${fmt(Math.max(0, this.player.time - r.t0))} / ${fmt(r.t1 - r.t0)}` : 'REC · getting ready';
    } else if (this.rounds.active) {
      const d = this.rounds.describe(name, k => this.display(k));
      kind = d?.phase ?? '';
      text = d ? `${{ armed: 'BULLET CAM · WAITING', flying: 'BULLET CAM', impact: 'BULLET CAM · HIT' }[d.phase]} · ${d.text}` : null;
      if (text && this.queue) text = `${this.queue.i + 1} OF ${this.queue.list.length} · ${text}`;
    } else if (this.track) {
      kind = 'track';
      text = `TRACK · ${this.keys.length} keys`;
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
      if (!span || t < span.t0 - 0.5) this.rangePlaying = false;
      else if (t >= span.t1 && !this.recorder) {
        if (this.range.loop) this.player.seek(span.t0);
        else {
          this.player.playing = false;
          this.rangePlaying = false;
        }
      }
    }
  }

  /** After the frame: the recording, the pick ring, the plate, the panel. */
  update(t, dt) {
    if (!this.on) return;
    this.noteFollow();
    this.runRecorder(t);
    this.runQueue(dt);
    if (this.pointer && !this.ui.input.classList.contains('dragging')) this.setHover(this.pickUnder(this.pointer));
    else if (this.hover) this.setHover(null);
    if (this.rounds.active || this.recorder || this.track) this.syncPlate();
    else if (!this.plate?.hidden) this.syncPlate();
    this.panelClock += dt;
    if (this.panelClock >= PANEL_TICK) {
      this.panelClock = 0;
      this.panel?.refresh(false);
    }
    this.syncPath(this.panel?.tab === 'camera');
  }

  dispose() {
    this.disposed = true;
    quietly('the recording', () => this.stopRecording(false));
    quietly('the round cam', () => this.rounds.dispose());
    quietly('the track', () => this.stopTrack());
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

  /** A chase, the track and a recording, stopped. */
  stopAll() {
    const any = this.rounds.active || this.track || this.recorder || this.queue;
    this.queue = null;
    this.stopRecording(false);
    this.rounds.stop(false);
    this.stopTrack();
    if (any) this.ui.flash('Stopped');
    this.syncPlate();
  }
}

/** The bar button's icon: a clapperboard. */
const CLAPPER = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 6.6h12v7H2z" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M1.7 2.9 13.4 1.3l.4 2.9L2.1 5.8z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="m4.4 2.5 1.8 2.8M8 2l1.8 2.8" stroke="currentColor" stroke-width="1.3"/></svg>';
