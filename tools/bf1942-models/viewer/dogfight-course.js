// The dogfight school's ring courses, live (features/dogfight-school): you
// in a fighter over the proving ground, a course of rings ahead of you laid
// along a manoeuvre the school's hands flew on this airframe
// (`dogfight-rings.js`), and the clock. Fly through each ring in turn; the
// one to fly through next is lit, the guide shows the stick for it, and an
// arrow on the screen's edge points to it when it is off the screen.
//
// Y again, N the next course, I the instructor (flies it for you until you
// touch the stick), G the guide, O end, V the school.

import * as THREE from 'three';
import { stateOf, len, sub, clamp } from './dogfight-flight.js';
import { placePlane, stage } from './dogfight-duel.js';
import { COURSES, courseById, flyCourse, steerCourse, crossing, RING_RADIUS } from './dogfight-rings.js';
import { createGuide, token } from './dogfight-guide.js';
import { KEY_WORDS } from './dogfight-lessons.js';

/** Seconds held at the start before the clock runs. */
const COUNT = 3;
/** Seconds flying away from the ring you are on before it counts as missed. */
const GIVE_UP = 2.5;
const GUIDE_TAU = 0.2;

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * `page` hands in: `stage`, `centre()` (x, z the course is flown over),
 * `groundAt(x, z)`, `playerDrive()`, `seatPlayer()`, `makePlane()` (an
 * airframe of the fighter you fly, for the hands to fly the course on),
 * `camera()`, `scene()`, `snapPresentation()`, `covered()`, `aceBot()`.
 */
export function createRingCourse(page) {
  const hud = document.createElement('div');
  hud.className = 'dfl dfr';
  hud.hidden = true;
  hud.innerHTML = `
    <div class="dfl-coach" data-tone="info">
      <span class="dfl-lesson"></span>
      <b class="dfl-line"></b>
      <span class="dfl-tip"></span>
      <span class="dfl-keys"></span>
      <div class="dfl-score dfr-score"><span>ring <b class="dfr-ring">0 / 0</b></span><span>time <b class="dfr-time">0.0 s</b></span><span>missed <b class="dfr-missed">0</b></span><span>best <b class="dfr-best">-</b></span></div>
    </div>
    <div class="dfl-mark dfr-mark" hidden><i></i><span></span></div>
    <div class="dfr-end" hidden><small></small><b></b><span></span><span class="dfr-end-keys"></span></div>
    <div class="dfl-banner" hidden></div>
    <div class="dfl-foot"><kbd>Y</kbd> again <kbd>N</kbd> next course <kbd>I</kbd> instructor <kbd>G</kbd> guide <kbd>V</kbd> school <kbd>O</kbd> end</div>`;
  page.stage.appendChild(hud);
  const guide = createGuide(hud);
  const q = s => hud.querySelector(s);
  const ui = {
    coach: q('.dfl-coach'), lesson: q('.dfl-lesson'), line: q('.dfl-line'), tip: q('.dfl-tip'), keys: q('.dfl-keys'),
    ring: q('.dfr-ring'), time: q('.dfr-time'), missed: q('.dfr-missed'), best: q('.dfr-best'),
    mark: q('.dfr-mark'), markText: q('.dfr-mark span'), end: q('.dfr-end'), banner: q('.dfl-banner'),
  };

  const run = {
    course: null, phase: 'idle', flown: null, origin: null, i: 0, hits: 0, misses: 0, offs: [], t: 0, count: 0,
    clock: 0, seatAsked: 0, bannerUntil: 0, last: null, best: Infinity, away: 0, mem: {}, guideOn: true, instructor: false,
    instructorSince: 0, out: null, smooth: { pitch: 0, roll: 0, rudder: 0, throttle: 1 }, lastInput: null, start: null, rings: null,
    flash: [],
  };

  function banner(text, seconds = 2, tone = 'info') {
    ui.banner.textContent = text;
    ui.banner.dataset.tone = tone;
    ui.banner.hidden = false;
    run.bannerUntil = run.clock + seconds;
  }

  function start(id) {
    const course = courseById(id) ?? COURSES[0];
    run.course = course;
    run.phase = 'seating';
    run.instructor = false;
    hud.hidden = false;
    ui.end.hidden = true;
    ui.lesson.textContent = `RING COURSE · ${course.title.toUpperCase()}`;
    ui.line.textContent = course.tagline;
    ui.tip.textContent = course.tip;
    ui.keys.innerHTML = (course.keys ?? []).map(k => `<kbd>${esc(KEY_WORDS[k] ?? k)}</kbd>`).join('');
    ui.best.textContent = bestText(course.id);
    banner(course.title.toUpperCase(), 2.5);
    return true;
  }

  function stop() {
    run.course = null;
    run.phase = 'idle';
    run.instructor = false;
    clearRings();
    hud.hidden = true;
  }

  /** The course put in front of you: the airframe at its start, the rings
   *  laid along the path the hands flew from there, and the count. */
  function place() {
    const drive = page.playerDrive();
    if (!drive) return false;
    const [cx, cz] = page.centre();
    const origin = [cx, page.groundAt(cx, cz), cz];
    const key = `${run.course.id}@${origin.map(Math.round).join(',')}`;
    if (run.flownKey !== key) {
      run.flown = flyCourse(run.course, () => page.makePlane(), { origin, groundAt: page.groundAt });
      run.flownKey = key;
    }
    placePlane(drive, stage(origin, run.course.start));
    if (drive.state) drive.state.grounded = false;
    run.start = stateOf(drive.state);
    run.origin = origin;
    run.i = 0; run.hits = 0; run.misses = 0; run.offs = []; run.t = 0; run.best = Infinity; run.away = 0; run.mem = {};
    run.last = null;
    run.phase = 'count';
    run.count = COUNT;
    ui.end.hidden = true;
    buildRings();
    page.snapPresentation?.();
    return true;
  }

  // --- the rings in the world ---------------------------------------------------

  function buildRings() {
    clearRings();
    const scene = page.scene?.();
    if (!scene) return;
    const C = { next: token('--mm-success', '#7da34c'), ring: token('--mm-accent-soft', '#9aa666'), hit: token('--mm-load-busy', '#c5a23a'), miss: token('--mm-kill', '#d65a5a') };
    const group = new THREE.Group();
    group.name = 'dogfight-rings';
    const geo = new THREE.TorusGeometry(RING_RADIUS, 0.45, 8, 48);
    const meshes = run.flown.rings.map(r => {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: C.ring, transparent: true, opacity: 0.5, depthWrite: false }));
      m.position.set(...r.p);
      // A torus lies across its own z: turned so z runs along the path.
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...r.dir));
      m.frustumCulled = false;
      group.add(m);
      return m;
    });
    // The path, faint, so the shape of the manoeuvre reads ahead of you.
    const pts = run.flown.track.filter((_, i) => i % 3 === 0).map(k => new THREE.Vector3(...k.p));
    const path = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 2, 0.35, 5, false),
      new THREE.MeshBasicMaterial({ color: C.ring, transparent: true, opacity: 0.22, depthWrite: false }));
    path.frustumCulled = false;
    group.add(path);
    scene.add(group);
    run.rings = { group, meshes, path, geo, C };
  }

  function clearRings() {
    const r = run.rings;
    if (!r) return;
    r.group.removeFromParent();
    r.geo.dispose();
    r.path.geometry.dispose();
    r.path.material.dispose();
    for (const m of r.meshes) m.material.dispose();
    run.rings = null;
  }

  function paintRings() {
    const r = run.rings;
    if (!r) return;
    const pulse = 1 + 0.06 * Math.sin(run.clock * 6);
    for (const [n, m] of r.meshes.entries()) {
      const flash = run.flash.find(f => f.n === n);
      if (flash) {
        const age = run.clock - flash.at;
        m.visible = age < 0.6;
        m.material.color.set(flash.hit ? r.C.hit : r.C.miss);
        m.material.opacity = Math.max(0, 1 - age / 0.6);
        m.scale.setScalar(1 + age * 0.8);
        continue;
      }
      m.visible = n >= run.i;
      if (!m.visible) continue;
      const ahead = n - run.i;
      m.material.color.set(ahead === 0 ? r.C.next : r.C.ring);
      m.material.opacity = ahead === 0 ? 0.95 : Math.max(0.15, 0.7 - ahead * 0.1);
      m.scale.setScalar(ahead === 0 ? pulse : 1);
    }
    run.flash = run.flash.filter(f => run.clock - f.at < 0.6);
  }

  // --- each frame ------------------------------------------------------------

  function frame(dt) {
    run.clock += dt;
    if (!ui.banner.hidden && run.clock > run.bannerUntil) ui.banner.hidden = true;
    if (!run.course) return;
    if (page.covered?.()) { hud.style.visibility = 'hidden'; if (run.rings) run.rings.group.visible = false; return; }
    hud.style.visibility = '';
    if (run.rings) run.rings.group.visible = true;
    parkAce();
    const drive = page.playerDrive();
    if (run.phase === 'seating') {
      if (!drive) {
        if (run.clock - run.seatAsked > 3) { run.seatAsked = run.clock; page.seatPlayer?.(); }
        return;
      }
      place();
    }
    if (!drive) {
      if (run.phase !== 'seating') { run.phase = 'seating'; banner('DOWN · back up in a moment', 2.5, 'danger'); }
      return;
    }
    const me = stateOf(drive.state);
    if (run.phase === 'count') {
      hold(drive);
      const before = Math.ceil(run.count);
      run.count -= dt;
      if (Math.ceil(run.count) !== before && run.count > 0) banner(String(Math.ceil(run.count)), 0.8);
      if (run.count <= 0) { run.phase = 'fly'; banner('GO', 0.8, 'go'); run.last = stateOf(drive.state).position; }
      steer(stateOf(drive.state), dt);
      paintRings();
      markRing(stateOf(drive.state));
      score();
      return;
    }
    if (run.phase === 'fly') {
      run.t += dt;
      passRings(me.position);
      if (me.position[1] - page.groundAt(me.position[0], me.position[2]) < 4) finish(true);
    }
    run.last = me.position;
    steer(me, dt);
    paintRings();
    markRing(me);
    score();
  }

  /** The airframe held at the start through the count. */
  function hold(drive) {
    const s = drive.state, st = run.start;
    s.position.set(...st.position);
    s.velocity.set(...st.velocity);
    s.orientation.set(st.orientation.x, st.orientation.y, st.orientation.z, st.orientation.w);
    s.angularVelocity?.set?.(0, 0, 0);
    s.grounded = false;
    page.snapPresentation?.();
  }

  /** The move since the last frame against the ring you are on and the
   *  one after it: through it is a hit, past it outside is a miss, and
   *  flying on away from it gives it up. */
  function passRings(pos) {
    const rings = run.flown.rings;
    const from = run.last;
    if (!from || run.i >= rings.length) return;
    for (const n of [run.i, run.i + 1]) {
      const ring = rings[n];
      if (!ring) continue;
      const off = crossing(ring, from, pos);
      if (off === null) continue;
      if (n === run.i + 1) take(run.i, false);
      take(n, off <= RING_RADIUS, off);
      return;
    }
    const d = len(sub(rings[run.i].p, pos));
    run.best = Math.min(run.best, d);
    run.away = d > run.best + 60 ? run.away + (run.frameDt ?? 0.016) : 0;
    if (run.away > GIVE_UP) take(run.i, false);
  }

  function take(n, hit, off = null) {
    if (n !== run.i) return;
    run.flash.push({ n, at: run.clock, hit });
    if (hit) { run.hits++; run.offs.push(off); } else run.misses++;
    run.i++;
    run.best = Infinity;
    run.away = 0;
    if (run.i >= run.flown.rings.length) finish(false);
  }

  function finish(crashed) {
    run.phase = 'done';
    const total = run.flown.rings.length;
    const time = run.t;
    const centre = run.offs.length ? run.offs.reduce((a, b) => a + b, 0) / run.offs.length : null;
    let best = null, isBest = false;
    if (!crashed) {
      best = readBest(run.course.id);
      const better = !best || run.hits > best.hits || (run.hits === best.hits && time < best.time);
      if (better) { writeBest(run.course.id, { hits: run.hits, time }); isBest = true; }
    }
    ui.end.querySelector('small').textContent = `RING COURSE · ${run.course.title.toUpperCase()}`;
    ui.end.querySelector('b').textContent = crashed ? 'Into the ground' : `${run.hits} of ${total} rings in ${time.toFixed(1)} s`;
    ui.end.querySelector('span').textContent = crashed
      ? `${run.hits} of ${total} rings before it. Start higher in the pull, or ease it.`
      : `${centre !== null ? `On average ${centre.toFixed(1)} m from the middle. ` : ''}${isBest ? 'Your best yet.' : `Best: ${bestText(run.course.id)}.`}`;
    ui.end.querySelector('.dfr-end-keys').innerHTML = '<kbd>Y</kbd> again <kbd>N</kbd> next course';
    ui.end.dataset.tone = crashed ? 'danger' : run.hits === total ? 'go' : 'info';
    ui.end.hidden = false;
    ui.best.textContent = bestText(run.course.id);
    // The card says it all; the instructor lets go and the guide stands down.
    ui.banner.hidden = true;
    run.instructor = false;
    guide.el.hidden = true;
  }

  /** The guide's stick for the course from where you are, smoothed. */
  function steer(me, dt) {
    run.frameDt = dt;
    if (!run.flown) return;
    const out = steerCourse(me, run.flown, run.mem, dt);
    run.out = out;
    const a = 1 - Math.exp(-dt / GUIDE_TAU);
    const g = run.smooth;
    g.pitch += (out.stick.pitch - g.pitch) * a;
    g.roll += (out.stick.roll - g.roll) * a;
    g.rudder += (out.stick.rudder - g.rudder) * a;
    g.throttle += ((out.throttle ?? 1) - g.throttle) * a;
    guide.el.hidden = run.phase === 'done' || (!run.guideOn && !run.instructor);
    if (!guide.el.hidden) {
      guide.draw(g, run.lastInput, run.instructor ? 'INSTRUCTOR FLYING · touch the stick to take over'
        : run.phase === 'count' ? 'GET READY · this is the stick for the first rings' : 'FLY THROUGH THE LIT RING');
    }
  }

  /** The next ring on the screen: nothing when it is in view (it is lit),
   *  else an arrow on the edge pointing the way to it. */
  const _p = new THREE.Vector3(), _c = new THREE.Vector3();
  function markRing(me) {
    const ring = run.flown?.rings[run.i];
    const cam = page.camera?.();
    if (!ring || !cam || run.phase === 'done') { ui.mark.hidden = true; return; }
    cam.updateMatrixWorld();
    _c.set(...ring.p).applyMatrix4(cam.matrixWorldInverse);
    _p.set(...ring.p).project(cam);
    const ahead = _c.z < 0;
    const onScreen = ahead && Math.abs(_p.x) < 0.92 && Math.abs(_p.y) < 0.86;
    const w = page.stage.clientWidth, h = page.stage.clientHeight;
    const dist = Math.round(len(sub(ring.p, me.position)));
    ui.mark.hidden = false;
    ui.mark.classList.toggle('is-edge', !onScreen);
    if (onScreen) {
      ui.mark.style.transform = `translate(${(_p.x * 0.5 + 0.5) * w}px, ${(-_p.y * 0.5 + 0.5) * h}px)`;
      ui.markText.textContent = `${dist} m`;
      return;
    }
    let dx = _c.x, dy = _c.y;
    if (!ahead) dy -= Math.abs(_c.z) * 0.6;
    const l = Math.hypot(dx, dy) || 1;
    dx /= l; dy /= l;
    const k = Math.min(0.9 / Math.max(Math.abs(dx), 1e-3), 0.8 / Math.max(Math.abs(dy), 1e-3));
    ui.mark.style.transform = `translate(${(dx * k * 0.5 + 0.5) * w}px, ${(-dy * k * 0.5 + 0.5) * h}px)`;
    ui.mark.style.setProperty('--a', `${Math.atan2(-dy, dx)}rad`);
    ui.markText.textContent = `next ring ${dist} m`;
  }

  function score() {
    const total = run.flown?.rings.length ?? 0;
    ui.ring.textContent = `${Math.min(run.i + 1, total)} / ${total}`;
    ui.time.textContent = `${run.t.toFixed(1)} s`;
    ui.missed.textContent = String(run.misses);
  }

  /** An enemy pilot, if the range has one, kept out of the way. */
  function parkAce() {
    const bot = page.aceBot?.();
    if (!bot || bot.vehicle?.kind !== 'air') return;
    bot.ace = b => {
      b._airInput = { power: 0.7, throttle: 0.7, roll: 0.25, pitch: -0.08, rudder: 0 };
      b.isFiring = false;
    };
  }

  // --- the best times, this browser's own ---------------------------------------

  function readBest(id) {
    try { return JSON.parse(localStorage.getItem(`dogfight-rings:${id}`) ?? 'null'); } catch { return null; }
  }
  function writeBest(id, v) {
    try { localStorage.setItem(`dogfight-rings:${id}`, JSON.stringify(v)); } catch { /* private window */ }
  }
  function bestText(id) {
    const b = readBest(id);
    return b ? `${b.hits} rings, ${b.time.toFixed(1)} s` : '-';
  }

  // --- controls ------------------------------------------------------------------

  /** The instructor's hands on your seat: the guide's stick, until you move
   *  a control yourself. */
  function flightOverride(input) {
    run.lastInput = { roll: input.roll, pitch: input.pitch, rudder: input.rudder, throttle: input.forwardKeys, fire: input.fire };
    if (!run.course || !run.instructor || !run.out || run.phase === 'done') return;
    const touched = Math.abs(input.roll) > 0.12 || Math.abs(input.pitch) > 0.12 || Math.abs(input.rudder) > 0.3 || Math.abs(input.forwardKeys) > 0.3;
    if (touched && run.clock - run.instructorSince > 0.6) { run.instructor = false; banner('YOU HAVE CONTROL', 1.5, 'go'); return; }
    input.forwardKeys = run.out.throttle;
    input.forward = run.out.throttle;
    input.roll = run.out.stick.roll;
    input.pitch = run.out.stick.pitch;
    input.rudder = run.out.stick.rudder;
    input.fire = false;
  }

  function key(e) {
    if (!run.course) return false;
    if (e.code === 'KeyY') { if (!place()) run.phase = 'seating'; return true; }
    if (e.code === 'KeyN') {
      const i = COURSES.indexOf(run.course);
      start(COURSES[(i + 1) % COURSES.length].id);
      if (page.playerDrive()) place();
      return true;
    }
    if (e.code === 'KeyI') {
      run.instructor = !run.instructor;
      run.instructorSince = run.clock;
      banner(run.instructor ? 'INSTRUCTOR FLYING · move the stick to take over' : 'YOU HAVE CONTROL', 2, run.instructor ? 'warn' : 'go');
      return true;
    }
    if (e.code === 'KeyG') { run.guideOn = !run.guideOn; banner(run.guideOn ? 'GUIDE ON' : 'GUIDE OFF', 1.2); return true; }
    if (e.code === 'KeyO') { stop(); return true; }
    return false;
  }

  return {
    start, stop, frame, key, flightOverride,
    get active() { return !!run.course; },
    get state() {
      return {
        course: run.course?.id ?? null, phase: run.phase, ring: run.i, rings: run.flown?.rings.length ?? 0, hits: run.hits, misses: run.misses,
        t: +run.t.toFixed(1), instructor: run.instructor, guide: guide.state, off: run.out ? +run.out.off.toFixed(1) : null,
        end: ui.end.hidden ? null : ui.end.textContent.replace(/\s+/g, ' ').trim(),
        mark: ui.mark.hidden ? null : ui.markText.textContent,
        you: stateOf(page.playerDrive()?.state)?.position?.map(Math.round) ?? null,
      };
    },
  };
}

export { COURSES };
