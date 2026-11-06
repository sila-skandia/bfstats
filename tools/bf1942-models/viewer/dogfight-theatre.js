// The dogfight school's theatre (features/dogfight-school): a lesson's fights
// replayed the way a documentary draws them. Two fighters over a plain grid,
// each trailing its path in its own colour, a line from each down to its
// shadow on the ground so the height reads, the rounds as tracers and the
// hits as sparks; what each pilot is doing in words under the picture, each
// one's speed, height and energy beside it, and the two energies drawn over
// the fight's timeline, where the story of most fights is.
//
// The fights are flown, not animated: `runDuel` puts the school's pilots in
// two of the engine's own airframes (`makePlane`) and records every tick.
// The theatre has its own renderer and scene, over the page, so nothing in
// the world moves while it is open.

import * as THREE from 'three';
import { runDuel } from './dogfight-duel.js';
import { LESSONS, demoSides, lessonById, RULES } from './dogfight-lessons.js';

const ACE = 0xe0573f;
const YOU = 0x4ea8e0;
const CSS_ACE = '#e0573f';
const CSS_YOU = '#4ea8e0';
const SPEEDS = [0.25, 0.5, 1, 2];
/** Half the trail ribbon's width, metres: a little under a Spitfire's half span. */
const TRAIL_HALF = 4;
const CAMERAS = [
  { id: 'wide', label: 'Wide' },
  { id: 'ace', label: 'Behind the ace' },
  { id: 'you', label: 'Behind the other' },
  { id: 'top', label: 'From above' },
];

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * Build the theatre over `host` (the page's stage). `makePlane()` is an
 * airframe for the duels, `planeVisual()` the drawn fighter (a clone of the
 * battle's own, or null for the school's plain one), `planeName` what it is
 * called, `onFly(lessonId)` puts the player in the air against the lesson's
 * ace, `onClose()` hands the page back its pointer.
 */
export function createDogfightTheatre({ host, makePlane, planeVisual = () => null, planeName = 'Spitfire',
                                        onFly = null, onClose = null, groundY = 0 }) {
  const root = document.createElement('div');
  root.className = 'dfs';
  root.hidden = true;
  root.tabIndex = -1;
  root.innerHTML = `
    <aside class="dfs-side">
      <header class="dfs-brand"><b>DOGFIGHT SCHOOL</b><small>moves, and their counters, flown on BF1942's own flight law</small></header>
      <ol class="dfs-lessons" role="list"></ol>
      <p class="dfs-rule"></p>
      <footer class="dfs-foot"><kbd>V</kbd> or <kbd>Esc</kbd> close</footer>
    </aside>
    <section class="dfs-main">
      <div class="dfs-stage">
        <canvas class="dfs-canvas"></canvas>
        <div class="dfs-tags"><span class="dfs-tag is-ace">ACE</span><span class="dfs-tag is-you">OTHER</span></div>
        <div class="dfs-titlecard"><small class="dfs-tc-kicker"></small><b class="dfs-tc-title"></b><span class="dfs-tc-note"></span></div>
        <div class="dfs-meters">
          <div class="dfs-meter is-ace"><b>ACE</b><span class="dfs-m-plan"></span><dl>
            <dt>speed</dt><dd class="dfs-m-speed"></dd><dt>height</dt><dd class="dfs-m-height"></dd><dt>energy</dt><dd class="dfs-m-energy"></dd></dl>
            <i class="dfs-bar"><i></i></i></div>
          <div class="dfs-meter is-you"><b class="dfs-m-name">OTHER</b><span class="dfs-m-plan"></span><dl>
            <dt>speed</dt><dd class="dfs-m-speed"></dd><dt>height</dt><dd class="dfs-m-height"></dd><dt>energy</dt><dd class="dfs-m-energy"></dd></dl>
            <i class="dfs-bar"><i></i></i></div>
        </div>
        <div class="dfs-captions">
          <p class="dfs-cap is-ace"><b>ACE</b><span></span></p>
          <p class="dfs-cap is-you"><b>OTHER</b><span></span></p>
        </div>
        <div class="dfs-endcard" hidden><b></b><span></span></div>
      </div>
      <div class="dfs-bar-row">
        <div class="dfs-demos" role="tablist"></div>
        <div class="dfs-play">
          <button type="button" class="dfs-btn dfs-restart" title="From the start">Restart</button>
          <button type="button" class="dfs-btn dfs-toggle" title="Space">Pause</button>
          <span class="dfs-speeds"></span>
          <span class="dfs-cams"></span>
        </div>
      </div>
      <div class="dfs-timeline">
        <canvas class="dfs-chart" height="64"></canvas>
        <input class="dfs-scrub" type="range" min="0" max="1000" value="0" aria-label="Time in the fight">
        <small class="dfs-legend"><i class="is-ace"></i>ace's energy <i class="is-you"></i>other's energy <i class="is-hit"></i>hits</small>
      </div>
      <div class="dfs-lower">
        <div class="dfs-flyrow">
          <button type="button" class="dfs-fly">FLY IT YOURSELF</button>
          <span class="dfs-fly-note">You take the other seat, in the air, against the ace flying this move. The coach tells you what he is doing and what beats it.</span>
        </div>
        <div class="dfs-story">
          <div><h3>THE MOVE</h3><div class="dfs-move"></div></div>
          <div><h3>THE COUNTER</h3><div class="dfs-counter"></div></div>
        </div>
      </div>
    </section>`;
  (host?.ownerDocument?.body ?? document.body).appendChild(root);
  const q = sel => root.querySelector(sel);
  const ui = {
    lessons: q('.dfs-lessons'), rule: q('.dfs-rule'), canvas: q('.dfs-canvas'), stage: q('.dfs-stage'),
    tags: [q('.dfs-tag.is-ace'), q('.dfs-tag.is-you')],
    tc: q('.dfs-titlecard'), tcKicker: q('.dfs-tc-kicker'), tcTitle: q('.dfs-tc-title'), tcNote: q('.dfs-tc-note'),
    meters: [q('.dfs-meter.is-ace'), q('.dfs-meter.is-you')],
    caps: [q('.dfs-cap.is-ace span'), q('.dfs-cap.is-you span')], youCap: q('.dfs-cap.is-you b'),
    end: q('.dfs-endcard'), demos: q('.dfs-demos'), toggle: q('.dfs-toggle'), restart: q('.dfs-restart'),
    speeds: q('.dfs-speeds'), cams: q('.dfs-cams'), chart: q('.dfs-chart'), scrub: q('.dfs-scrub'),
    move: q('.dfs-move'), counter: q('.dfs-counter'), fly: q('.dfs-fly'), flyRow: q('.dfs-flyrow'),
  };

  const state = { open: false, lesson: null, demo: null, fight: null, t: 0, playing: true, speed: 1, camera: 'wide', drawScale: 1,
                  orbit: { az: -0.9, el: 0.32, zoom: 1 }, rule: 0 };
  /** Fights flown once per lesson and demo, kept for the session. */
  const flown = new Map();

  // --- the scene ----------------------------------------------------------------
  let gl = null;
  function renderer() {
    if (gl) return gl;
    let r;
    try {
      r = new THREE.WebGLRenderer({ canvas: ui.canvas, antialias: true, powerPreference: 'high-performance' });
    } catch { return null; }
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x9fb4c4);
    scene.fog = new THREE.Fog(0x9fb4c4, 1400, 4200);
    scene.add(new THREE.HemisphereLight(0xdfeaf2, 0x55605a, 2.2));
    const sun = new THREE.DirectionalLight(0xfff3dd, 2.4);
    sun.position.set(-0.4, 1, 0.3);
    scene.add(sun);
    const camera = new THREE.PerspectiveCamera(50, 1, 2, 9000);
    // The ground: a pale floor with a kilometre grid and a 100 m one.
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(12000, 12000),
      new THREE.MeshBasicMaterial({ color: 0xc9d3cf }));
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);
    const fine = new THREE.GridHelper(12000, 120, 0xa9b6b0, 0xb3beb8);
    fine.position.y = 0.3;
    scene.add(fine);
    const coarse = new THREE.GridHelper(12000, 12, 0x7f8f88, 0x7f8f88);
    coarse.position.y = 0.6;
    scene.add(coarse);
    gl = { renderer: r, scene, camera, floor, fine, coarse, actors: [], tracers: null, sparks: null };
    return gl;
  }

  /** A plain fighter, for when the battle lends none: fuselage, wings, tail. */
  function plainFighter(color) {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x6f7a72, roughness: 0.7, metalness: 0.1 });
    const band = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.3, 9, 10), mat);
    body.rotation.x = Math.PI / 2;
    g.add(body);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(11.2, 0.18, 2.1), mat);
    wing.position.set(0, -0.2, -1.2);
    g.add(wing);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.12, 1.1), mat);
    tail.position.set(0, 0.1, 3.9);
    g.add(tail);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.5, 1.1), mat);
    fin.position.set(0, 0.8, 3.9);
    g.add(fin);
    const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.58, 0.6, 10), band);
    stripe.rotation.x = Math.PI / 2;
    stripe.position.z = 1.6;
    g.add(stripe);
    const tips = new THREE.Mesh(new THREE.BoxGeometry(11.3, 0.2, 0.5), band);
    tips.position.set(0, -0.2, -0.3);
    tips.scale.x = 1;
    g.add(tips);
    return g;
  }

  /** The two actors: a fighter each, its trail, its shadow's trail, its drop line. */
  function buildActors(fight) {
    const s = renderer();
    for (const a of s.actors) {
      s.scene.remove(a.plane, a.trail, a.shadow, a.drop, a.marker);
      a.trail.geometry.dispose();
      a.shadow.geometry.dispose();
    }
    s.actors = [0, 1].map(i => {
      const color = i === 0 ? ACE : YOU;
      let plane = null;
      try { plane = planeVisual(i); } catch { plane = null; }
      if (!plane) plane = plainFighter(color);
      // A ring of the side's colour round the drawn fighter, so it reads at
      // a distance whatever its paint.
      const marker = new THREE.Mesh(new THREE.RingGeometry(9, 10.5, 32),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
      const n = fight.tracks[i].length;
      // The trail is a ribbon along the wings: it twists as he rolls, so the
      // bank of every turn and the roll of every reversal stay on the sky.
      const tg = new THREE.BufferGeometry();
      tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 6), 3));
      tg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 6), 3));
      const index = new Uint32Array(Math.max(0, n - 1) * 6);
      for (let j = 0; j < n - 1; j++) index.set([2 * j, 2 * j + 1, 2 * j + 2, 2 * j + 1, 2 * j + 3, 2 * j + 2], j * 6);
      tg.setIndex(new THREE.BufferAttribute(index, 1));
      const trail = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }));
      trail.frustumCulled = false;
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      const shadow = new THREE.Line(sg, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.35 }));
      shadow.frustumCulled = false;
      const dg = new THREE.BufferGeometry();
      dg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const drop = new THREE.Line(dg, new THREE.LineDashedMaterial({ color, dashSize: 6, gapSize: 5, transparent: true, opacity: 0.7 }));
      drop.frustumCulled = false;
      // Fill the trail with every sample once; the draw range grows with time.
      const base = new THREE.Color(color);
      const pos = tg.attributes.position.array, col = tg.attributes.color.array, sp = sg.attributes.position.array;
      const wing = new THREE.Vector3(), q = new THREE.Quaternion();
      fight.tracks[i].forEach((k, j) => {
        const x = k.p[0] - fight.origin[0], y = k.p[1] - fight.origin[1], z = k.p[2] - fight.origin[2];
        wing.set(TRAIL_HALF, 0, 0).applyQuaternion(q.set(...k.q));
        pos.set([x - wing.x, y - wing.y, z - wing.z, x + wing.x, y + wing.y, z + wing.z], j * 6);
        sp.set([x, 1.2, z], j * 3);
        // Brighter the faster: a trail that fades where the pilot ran out of speed.
        const f = Math.min(1, Math.max(0.15, (k.v - 15) / 70));
        const c = base.clone().lerp(new THREE.Color(0xffffff), 0.35 * f).multiplyScalar(0.45 + 0.55 * f);
        col.set([c.r, c.g, c.b, c.r * 0.7, c.g * 0.7, c.b * 0.7], j * 6);
      });
      tg.attributes.position.needsUpdate = tg.attributes.color.needsUpdate = sg.attributes.position.needsUpdate = true;
      s.scene.add(plane, trail, shadow, drop, marker);
      return { plane, trail, shadow, drop, marker };
    });
    // The rounds: one segment each, drawn while it flies.
    if (s.tracers) { s.scene.remove(s.tracers); s.tracers.geometry.dispose(); }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(fight.rounds.length * 6), 3));
    rg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(fight.rounds.length * 6), 3));
    s.tracers = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95 }));
    s.tracers.frustumCulled = false;
    s.scene.add(s.tracers);
    if (s.sparks) { s.scene.remove(s.sparks); s.sparks.geometry.dispose(); }
    const hits = fight.rounds.filter(r => r.hit);
    const hg = new THREE.BufferGeometry();
    hg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(Math.max(1, hits.length) * 3), 3));
    s.sparks = new THREE.Points(hg, new THREE.PointsMaterial({ color: 0xffd36a, size: 9, sizeAttenuation: true, transparent: true, depthWrite: false }));
    s.sparks.frustumCulled = false;
    s.sparks.userData.hits = hits;
    s.scene.add(s.sparks);
  }

  // --- the fight ------------------------------------------------------------------
  function fly(lesson, demo) {
    const key = `${lesson.id}/${demo.id}`;
    if (flown.has(key)) return flown.get(key);
    const origin = [0, groundY, 0];
    const r = runDuel({ makePlane, seconds: lesson.seconds, origin, groundAt: () => groundY, sides: demoSides(lesson, demo) });
    const fight = { ...r, origin, lesson, demo, duration: r.tracks[0].at(-1).t };
    flown.set(key, fight);
    return fight;
  }

  const _q0 = new THREE.Quaternion(), _q1 = new THREE.Quaternion();
  /** A side's sample at time `t`, interpolated. */
  function sampleAt(track, t, dt) {
    const f = Math.max(0, Math.min(track.length - 1, t / dt));
    const i = Math.floor(f), j = Math.min(track.length - 1, i + 1), a = f - i;
    const k0 = track[i], k1 = track[j];
    _q0.set(...k0.q); _q1.set(...k1.q);
    return {
      i, k: a < 0.5 ? k0 : k1,
      p: [k0.p[0] + (k1.p[0] - k0.p[0]) * a, k0.p[1] + (k1.p[1] - k0.p[1]) * a, k0.p[2] + (k1.p[2] - k0.p[2]) * a],
      q: _q0.clone().slerp(_q1, a), v: k0.v + (k1.v - k0.v) * a, e: k0.e + (k1.e - k0.e) * a,
    };
  }

  /** What a side said last by time `t`. */
  function sayingAt(fight, side, t) {
    let last = null;
    for (const e of fight.events) {
      if (e.t > t) break;
      if (e.side === side && e.phase !== 'kill') last = e;
    }
    return last;
  }

  function pickDemo(lesson, id) {
    const demo = lesson.demos.find(d => d.id === id) ?? lesson.demos[0] ?? null;
    state.demo = demo;
    ui.demos.querySelectorAll('button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.demo === demo?.id)));
    if (!demo) {
      state.fight = null;
      ui.stage.classList.add('is-empty');
      ui.tcKicker.textContent = lesson.title.toUpperCase();
      ui.tcTitle.textContent = 'No reconstruction for this one';
      ui.tcNote.textContent = 'He picks his own moves. Fly it.';
      ui.tc.classList.add('is-shown');
      ui.end.hidden = true;
      return;
    }
    ui.stage.classList.remove('is-empty');
    state.fight = fly(lesson, demo);
    state.t = 0;
    state.playing = true;
    ui.toggle.textContent = 'Pause';
    buildActors(state.fight);
    ui.youCap.textContent = ui.meters[1].querySelector('b').textContent = 'OTHER';
    ui.tags[1].textContent = 'OTHER';
    ui.meters[0].querySelector('.dfs-m-plan').textContent = state.fight.events.find(e => e.side === 0)?.move ?? '';
    ui.meters[1].querySelector('.dfs-m-plan').textContent = state.fight.events.find(e => e.side === 1)?.move ?? '';
    ui.tcKicker.textContent = `${lesson.title.toUpperCase()} · ${planeName.toUpperCase()} AGAINST ${planeName.toUpperCase()}`;
    ui.tcTitle.textContent = demo.label;
    ui.tcNote.textContent = demo.note;
    ui.tc.classList.add('is-shown');
    clearTimeout(pickDemo.timer);
    pickDemo.timer = setTimeout(() => ui.tc.classList.remove('is-shown'), 3200);
    ui.end.hidden = true;
    drawChart();
  }

  function pickLesson(id) {
    const lesson = lessonById(id) ?? LESSONS[0];
    state.lesson = lesson;
    ui.lessons.querySelectorAll('button').forEach(b => b.setAttribute('aria-current', String(b.dataset.lesson === lesson.id)));
    ui.move.innerHTML = lesson.story.map(p => `<p>${esc(p)}</p>`).join('');
    ui.counter.innerHTML = lesson.counterStory.map(p => `<p>${esc(p)}</p>`).join('');
    ui.demos.innerHTML = lesson.demos.map(d => `<button type="button" role="tab" data-demo="${d.id}">${esc(d.label)}</button>`).join('');
    ui.fly.disabled = !onFly;
    pickDemo(lesson, lesson.demos.find(d => d.id === 'move')?.id ?? lesson.demos[0]?.id);
  }

  // --- the timeline's chart --------------------------------------------------------
  function drawChart() {
    const c = ui.chart, fight = state.fight;
    const w = c.clientWidth || 600, h = c.clientHeight || 64;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const x = c.getContext('2d');
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.clearRect(0, 0, w, h);
    if (!fight) return;
    let lo = Infinity, hi = -Infinity;
    for (const tr of fight.tracks) for (const k of tr) { lo = Math.min(lo, k.e); hi = Math.max(hi, k.e); }
    const pad = Math.max(30, (hi - lo) * 0.1);
    lo -= pad; hi += pad;
    const X = t => t / fight.duration * w, Y = e => h - 4 - (e - lo) / (hi - lo) * (h - 10);
    // Phase changes as faint ticks, the ace's above, the other's below.
    for (const e of fight.events) {
      x.fillStyle = e.side === 0 ? 'rgba(224,87,63,.35)' : 'rgba(78,168,224,.35)';
      x.fillRect(X(e.t), e.side === 0 ? 0 : h - 6, 1, 6);
    }
    for (const [i, tr] of fight.tracks.entries()) {
      x.strokeStyle = i === 0 ? CSS_ACE : CSS_YOU;
      x.lineWidth = 2;
      x.beginPath();
      tr.forEach((k, j) => { if (j % 3 === 0) j === 0 ? x.moveTo(X(k.t), Y(k.e)) : x.lineTo(X(k.t), Y(k.e)); });
      x.stroke();
    }
    x.fillStyle = '#ffd36a';
    for (const r of fight.rounds) if (r.hit) x.fillRect(X(r.hitT) - 1, r.side === 0 ? 8 : h - 14, 2, 6);
    if (fight.end) {
      x.fillStyle = '#f3ead7';
      x.fillRect(X(fight.end.t) - 1, 0, 2, h);
    }
  }

  // --- the frame ------------------------------------------------------------------
  const _m = new THREE.Vector3(), _f = new THREE.Vector3(), _u = new THREE.Vector3(), _look = new THREE.Vector3();
  let camPos = null, camLook = null;
  let last = performance.now();
  function frame(now) {
    if (!state.open) return;
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const s = renderer();
    if (!s) return;
    const w = ui.canvas.clientWidth, h = ui.canvas.clientHeight;
    if (w && h && (s.w !== w || s.h !== h)) {
      s.w = w; s.h = h;
      s.renderer.setSize(w, h, false);
      s.camera.aspect = w / h;
      s.camera.updateProjectionMatrix();
      drawChart();
    }
    const fight = state.fight;
    if (!fight) { s.renderer.render(s.scene, s.camera); return; }
    if (state.playing) {
      state.t += dt * state.speed;
      if (state.t >= fight.duration) { state.t = fight.duration; state.playing = false; ui.toggle.textContent = 'Play'; }
    }
    if (document.activeElement !== ui.scrub) ui.scrub.value = String(Math.round(state.t / fight.duration * 1000));
    const o = fight.origin;
    const now2 = [0, 1].map(i => sampleAt(fight.tracks[i], state.t, fight.dt));
    for (const [i, a] of s.actors.entries()) {
      const k = now2[i];
      a.plane.position.set(k.p[0] - o[0], k.p[1] - o[1], k.p[2] - o[2]);
      a.plane.quaternion.copy(k.q);
      a.marker.position.copy(a.plane.position);
      a.marker.quaternion.copy(s.camera.quaternion);
      const n = Math.max(1, k.i + 1);
      a.trail.geometry.setDrawRange(0, Math.max(0, n - 1) * 6);
      a.shadow.geometry.setDrawRange(0, n);
      // Drawn bigger than life when the camera stands back, as a diagram
      // draws them; true size behind a tail.
      a.plane.scale.setScalar(state.drawScale);
      a.marker.scale.setScalar(state.drawScale);
      a.marker.visible = !((state.camera === 'ace' && i === 0) || (state.camera === 'you' && i === 1));
      const d = a.drop.geometry.attributes.position.array;
      d.set([a.plane.position.x, a.plane.position.y, a.plane.position.z, a.plane.position.x, 1, a.plane.position.z]);
      a.drop.geometry.attributes.position.needsUpdate = true;
      a.drop.computeLineDistances();
      const m = ui.meters[i];
      m.querySelector('.dfs-m-speed').textContent = `${Math.round(k.v)} m/s`;
      m.querySelector('.dfs-m-height').textContent = `${Math.round(k.p[1] - o[1])} m`;
      m.querySelector('.dfs-m-energy').textContent = `${Math.round(k.e)} m`;
      m.querySelector('.dfs-bar > i').style.width = `${Math.max(2, Math.min(100, k.e / 12))}%`;
      m.classList.toggle('is-slow', k.v < 30);
      const said = sayingAt(fight, i, state.t);
      const text = said?.say ?? '';
      if (ui.caps[i].textContent !== text) {
        ui.caps[i].textContent = text;
        ui.caps[i].parentElement.classList.remove('is-new');
        void ui.caps[i].parentElement.offsetWidth;
        ui.caps[i].parentElement.classList.add('is-new');
      }
    }
    // The rounds in the air at `t`: each a short streak along its path.
    const rp = s.tracers.geometry.attributes.position.array, rc = s.tracers.geometry.attributes.color.array;
    let nr = 0;
    for (const r of fight.rounds) {
      const age = state.t - r.t;
      const life = r.hit ? r.hitT - r.t : 0.9;
      if (age < 0 || age > life) continue;
      const a0 = Math.max(0, age - 0.05);
      for (const [j, at] of [[0, a0], [1, age]]) {
        rp[nr * 6 + j * 3] = r.start[0] + r.v[0] * at - o[0];
        rp[nr * 6 + j * 3 + 1] = r.start[1] + r.v[1] * at - o[1];
        rp[nr * 6 + j * 3 + 2] = r.start[2] + r.v[2] * at - o[2];
        const c = r.side === 0 ? [1, 0.78, 0.55] : [0.7, 0.9, 1];
        rc.set(c, nr * 6 + j * 3);
      }
      nr++;
    }
    s.tracers.geometry.setDrawRange(0, nr * 2);
    s.tracers.geometry.attributes.position.needsUpdate = s.tracers.geometry.attributes.color.needsUpdate = true;
    const sp = s.sparks.geometry.attributes.position.array;
    let ns = 0;
    for (const r of s.sparks.userData.hits) {
      if (state.t < r.hitT || state.t > r.hitT + 0.35) continue;
      sp.set([r.hitAt[0] - o[0], r.hitAt[1] - o[1], r.hitAt[2] - o[2]], ns * 3);
      ns++;
    }
    s.sparks.geometry.setDrawRange(0, ns);
    s.sparks.geometry.attributes.position.needsUpdate = true;
    placeCamera(s, now2, dt);
    s.renderer.render(s.scene, s.camera);
    // The name tags over the fighters.
    for (const [i, a] of s.actors.entries()) {
      _m.copy(a.plane.position).add(_u.set(0, 14, 0)).project(s.camera);
      const tag = ui.tags[i];
      const on = _m.z < 1 && Math.abs(_m.x) < 1.1 && Math.abs(_m.y) < 1.1;
      tag.style.opacity = on ? '1' : '0';
      if (on) tag.style.transform = `translate(${(_m.x * 0.5 + 0.5) * w}px, ${(-_m.y * 0.5 + 0.5) * h}px) translate(-50%, -100%)`;
    }
    // The end card, once the fight is decided.
    if (fight.end && state.t >= fight.end.t + 0.3) showEnd(fight);
    else if (!fight.end && state.t >= fight.duration) showEnd(fight);
    else ui.end.hidden = true;
  }

  function showEnd(fight) {
    if (!ui.end.hidden) return;
    const [aceHits, youHits] = fight.hits;
    const who = i => (i === 0 ? 'The ace' : 'The other pilot');
    const b = ui.end.querySelector('b'), sp = ui.end.querySelector('span');
    if (fight.end?.why === 'shot down') {
      b.textContent = `${who(fight.end.winner)} wins at ${fight.end.t.toFixed(1)} s`;
    } else if (fight.end) {
      b.textContent = `${who(1 - fight.end.winner)} flew into the ground`;
    } else {
      b.textContent = `No kill in ${Math.round(fight.duration)} s`;
    }
    const e = fight.tracks.map(tr => Math.round(tr.at(-1).e));
    sp.textContent = `Hits: ace ${aceHits}, other ${youHits}. Energy at the end: ace ${e[0]} m, other ${e[1]} m.`;
    ui.end.hidden = false;
  }

  function placeCamera(s, k, dt) {
    const o = state.fight.origin;
    const a = new THREE.Vector3(k[0].p[0] - o[0], k[0].p[1] - o[1], k[0].p[2] - o[2]);
    const b = new THREE.Vector3(k[1].p[0] - o[0], k[1].p[1] - o[1], k[1].p[2] - o[2]);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const span = a.distanceTo(b);
    let pos, look;
    if (state.camera === 'ace' || state.camera === 'you') {
      const i = state.camera === 'ace' ? 0 : 1;
      const me = i === 0 ? a : b, other = i === 0 ? b : a;
      _f.set(0, 0, -1).applyQuaternion(k[i].q);
      pos = me.clone().addScaledVector(_f, -38).add(_u.set(0, 9, 0));
      look = me.clone().addScaledVector(_f, 60).lerp(other, 0.45);
    } else if (state.camera === 'top') {
      const d = Math.max(420, span * 1.8) * state.orbit.zoom;
      pos = mid.clone().add(_u.set(0.001, d, d * 0.12));
      look = mid.clone();
    } else {
      const d = Math.max(380, span * 1.5 + 160) * state.orbit.zoom;
      const { az, el } = state.orbit;
      pos = mid.clone().add(_u.set(Math.sin(az) * Math.cos(el) * d, Math.sin(el) * d, Math.cos(az) * Math.cos(el) * d));
      pos.y = Math.max(pos.y, 25);
      look = mid.clone();
    }
    const far = state.camera === 'wide' || state.camera === 'top';
    state.drawScale = far ? Math.max(1, Math.min(4, pos.distanceTo(mid) / 150)) : 1;
    const k2 = 1 - Math.exp(-dt * 3.5);
    camPos = camPos ? camPos.lerp(pos, k2) : pos.clone();
    camLook = camLook ? camLook.lerp(look, k2) : look.clone();
    s.camera.position.copy(camPos);
    s.camera.lookAt(_look.copy(camLook));
  }

  // --- input ------------------------------------------------------------------------
  ui.lessons.innerHTML = LESSONS.map((l, i) => `
    <li><button type="button" data-lesson="${l.id}"><span class="dfs-n">${String(i + 1).padStart(2, '0')}</span>
      <b>${esc(l.title)}</b><small>${esc(l.tagline)}</small></button></li>`).join('');
  ui.lessons.addEventListener('click', e => {
    const b = e.target.closest('button[data-lesson]');
    if (b) pickLesson(b.dataset.lesson);
  });
  ui.demos.addEventListener('click', e => {
    const b = e.target.closest('button[data-demo]');
    if (b && state.lesson) pickDemo(state.lesson, b.dataset.demo);
  });
  ui.speeds.innerHTML = SPEEDS.map(v => `<button type="button" class="dfs-chip" data-speed="${v}">${v}x</button>`).join('');
  ui.cams.innerHTML = CAMERAS.map(c => `<button type="button" class="dfs-chip" data-cam="${c.id}">${c.label}</button>`).join('');
  const markChips = () => {
    ui.speeds.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.speed === state.speed)));
    ui.cams.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.cam === state.camera)));
  };
  ui.speeds.addEventListener('click', e => {
    const b = e.target.closest('button[data-speed]');
    if (b) { state.speed = +b.dataset.speed; markChips(); }
  });
  ui.cams.addEventListener('click', e => {
    const b = e.target.closest('button[data-cam]');
    if (b) { state.camera = b.dataset.cam; markChips(); }
  });
  markChips();
  const togglePlay = () => {
    if (!state.fight) return;
    if (!state.playing && state.t >= state.fight.duration) state.t = 0;
    state.playing = !state.playing;
    ui.toggle.textContent = state.playing ? 'Pause' : 'Play';
  };
  ui.toggle.addEventListener('click', togglePlay);
  ui.restart.addEventListener('click', () => { state.t = 0; state.playing = true; ui.toggle.textContent = 'Pause'; ui.end.hidden = true; });
  ui.scrub.addEventListener('input', () => {
    if (!state.fight) return;
    state.t = +ui.scrub.value / 1000 * state.fight.duration;
    ui.end.hidden = true;
  });
  ui.fly.addEventListener('click', () => {
    if (!state.lesson || !onFly) return;
    const id = state.lesson.id;
    close(false);
    onFly(id);
  });
  // Dragging the picture swings the wide view round; the wheel brings it in.
  let drag = null;
  ui.canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY }; ui.canvas.setPointerCapture?.(e.pointerId); });
  ui.canvas.addEventListener('pointermove', e => {
    if (!drag) return;
    state.orbit.az -= (e.clientX - drag.x) * 0.006;
    state.orbit.el = Math.max(0.05, Math.min(1.45, state.orbit.el + (e.clientY - drag.y) * 0.005));
    drag = { x: e.clientX, y: e.clientY };
    if (state.camera !== 'wide' && state.camera !== 'top') { state.camera = 'wide'; markChips(); }
  });
  ui.canvas.addEventListener('pointerup', () => { drag = null; });
  ui.canvas.addEventListener('wheel', e => {
    e.preventDefault();
    state.orbit.zoom = Math.max(0.35, Math.min(3, state.orbit.zoom * Math.exp(e.deltaY * 0.001)));
  }, { passive: false });
  root.addEventListener('keydown', e => {
    // The school holds the keyboard while it is up.
    e.stopPropagation();
    if (e.code === 'Escape' || e.code === 'KeyV') { e.preventDefault(); close(); }
    else if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if (e.code === 'ArrowRight' && state.fight) state.t = Math.min(state.fight.duration, state.t + 2);
    else if (e.code === 'ArrowLeft' && state.fight) state.t = Math.max(0, state.t - 2);
  });
  root.addEventListener('keyup', e => e.stopPropagation());

  function open(lessonId = null) {
    if (state.open) return;
    state.open = true;
    root.hidden = false;
    state.rule = (state.rule + 1) % RULES.length;
    ui.rule.textContent = RULES[state.rule];
    pickLesson(lessonId ?? state.lesson?.id ?? LESSONS[0].id);
    root.focus({ preventScroll: true });
    last = performance.now();
    requestAnimationFrame(frame);
  }

  function close(handBack = true) {
    if (!state.open) return;
    state.open = false;
    root.hidden = true;
    if (handBack) onClose?.();
  }

  return {
    open,
    close,
    get isOpen() { return state.open; },
    /** For the tests: what the theatre shows. */
    get state() {
      const f = state.fight;
      return {
        open: state.open, lesson: state.lesson?.id ?? null, demo: state.demo?.id ?? null, t: state.t,
        playing: state.playing, camera: state.camera, speed: state.speed,
        fight: f ? { duration: f.duration, end: f.end, hits: f.hits, rounds: f.rounds.length, events: f.events.length } : null,
        captions: ui.caps.map(c => c.textContent), end: ui.end.hidden ? null : ui.end.textContent,
      };
    },
    seek(t) { state.t = t; },
    /** For the tests: what each drawn fighter is made of. */
    planes() {
      return (gl?.actors ?? []).map(a => {
        let meshes = 0, shown = 0;
        a.plane.traverse(o => { if (o.isMesh) { meshes++; let v = true; for (let n = o; n; n = n.parent) if (!n.visible) v = false; if (v) shown++; } });
        const box = new THREE.Box3().setFromObject(a.plane);
        return { meshes, shown, size: box.getSize(new THREE.Vector3()).toArray().map(v => +v.toFixed(1)), scale: a.plane.scale.x };
      });
    },
    flown: (lessonId, demoId) => {
      const l = lessonById(lessonId);
      const d = l?.demos.find(x => x.id === demoId);
      return l && d ? fly(l, d) : null;
    },
  };
}
