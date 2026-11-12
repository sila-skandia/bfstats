// The tank school's STUDY view (features/battle-schools, "Studying a
// fight"): one recorded tank fight recreated to learn from, not replayed.
//
//   01 From above: both tracks to scale, the tanks where they were with
//      their guns, every shell's path, hits and the kill, a scrubber and
//      play at a chosen speed.
//   02 Through the gunner's sight: at each shot, the other tank as the
//      gunner saw it (its own model, at its recorded range, heading, pitch
//      and roll), the crosshair where the gun pointed, where the shell went,
//      where the tank had got to when it arrived, and where the gun needed
//      to point; with what made it hit or miss in words.
//   03 The instruments: both hulls' speed and pitch, and the range, over
//      the fight, every shot marked.
//
// The numbers are `tank-duel.js`'s, from the fight file
// (`replays/tankfights/<id>.json`). The tank school page mounts it
// (`mountStudy`) and hands it its model loader.

import * as THREE from 'three';
import { sideAt, shellAt, studyFight, shotWords, timeline, samplesOf, LIFT } from './tank-duel.js';

// Remaster mode (features/remaster-browser) runs on three's WebGPU build,
// which has no WebGLRenderer: a side view then takes a WebGPU renderer from
// the remaster's hooks. Without `?remaster` this is the WebGLRenderer it was.
const remasterSideRenderer = options => globalThis.bfRemasterHooks?.sideRenderer?.(options)
  ?? new THREE.WebGLRenderer(options);


const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const n1 = v => (v == null || !Number.isFinite(v) ? '-' : Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(v)) : v.toFixed(1));
const COLORS = ['var(--tks-you)', 'var(--tks-them)'];
const HEX = ['#6fa36b', '#d65a5a'];
const D2R = Math.PI / 180;
/** Recorded frame (x east, y up, z north) to three's (z toward the viewer). */
const v3 = p => new THREE.Vector3(p[0], p[1], -p[2]);

export const STUDY_HTML = `
  <main class="tks-main tks-study" hidden>
    <header class="tks-head">
      <small class="mm-eyebrow">Study a fight</small>
      <h1><span class="tks-st-name is-a"></span> <i>against</i> <span class="tks-st-name is-b"></span></h1>
      <p class="tks-headline tks-st-meta"></p>
      <div class="tks-st-acts"><button type="button" class="tks-toggle tks-st-back">All fights</button><a class="tks-toggle tks-st-watch" target="_blank" rel="noopener">Watch in 3D</a><a class="tks-toggle tks-st-matchup">Matchup of the two tanks</a></div>
      <p class="tks-st-wait" role="status">Loading the fight</p>
    </header>
    <section class="tks-card" aria-labelledby="tks-h-st-map">
      <header class="tks-card-head"><small>01</small><h2 id="tks-h-st-map">From above</h2></header>
      <div class="tks-steady-bar tks-st-bar">
        <button type="button" class="tks-play tks-st-play" title="Play (Space)"><svg class="dfs-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10-6.5z"/></svg><span>Play</span></button>
        <input class="tks-scrub tks-st-scrub" type="range" min="0" max="10" step="0.05" value="0" aria-label="Time in the fight">
        <b class="tks-clock-now tks-st-clock">0.0 s</b>
        <span class="tks-seg tks-st-rate" role="radiogroup" aria-label="Speed"><button type="button" data-rate="0.25">1/4</button><button type="button" data-rate="0.5">1/2</button><button type="button" data-rate="1">1x</button><button type="button" data-rate="2">2x</button></span>
      </div>
      <svg class="tks-st-map" viewBox="0 0 760 440" role="img" aria-label="The fight from above"></svg>
      <ul class="tks-words tks-st-now"></ul>
    </section>
    <section class="tks-card" aria-labelledby="tks-h-st-sight">
      <header class="tks-card-head"><small>02</small><h2 id="tks-h-st-sight">Through the gunner's sight</h2></header>
      <p class="tks-intro">Each shot from the gun, as the gunner saw the other tank. The cross is where the gun pointed; the dot is where the shell went; the faint tank is where the target had got to by the time it arrived; the ring is where the gun needed to point to hit. The ground is not drawn.</p>
      <div class="tks-st-shots" role="radiogroup" aria-label="Shot"></div>
      <div class="tks-st-sight"><canvas width="760" height="428"></canvas><svg class="tks-st-hud" viewBox="0 0 760 428" aria-hidden="true"></svg><span class="tks-st-sight-wait" hidden>Loading the tank</span></div>
      <ul class="tks-words tks-st-shot-words"></ul>
    </section>
    <section class="tks-card" aria-labelledby="tks-h-st-inst">
      <header class="tks-card-head"><small>03</small><h2 id="tks-h-st-inst">The instruments</h2></header>
      <p class="tks-intro">Both hulls over the fight: how fast each was going, how far its nose was tipped (the gun tips with it), and the range between them. A mark is a shot: solid if it hit. Click to go there.</p>
      <svg class="tks-st-inst" viewBox="0 0 760 330" role="img" aria-label="Speed, hull pitch and range over the fight"></svg>
    </section>
  </main>`;

/**
 * Mount the view in `root` (the page's own, holding `STUDY_HTML`).
 * `deps`: `{ loadModel(template) -> Promise<scene|null>, prettyTank, playerName,
 * fightUrl(id), watchUrl(row), matchupUrl(row), back() }`. Returns `{ open(id), close() }`.
 */
export function mountStudy(root, deps) {
  const q = sel => root.querySelector(sel);
  const ui = {
    main: q('.tks-study'), names: [q('.tks-st-name.is-a'), q('.tks-st-name.is-b')], meta: q('.tks-st-meta'), wait: q('.tks-st-wait'),
    watch: q('.tks-st-watch'), matchup: q('.tks-st-matchup'), back: q('.tks-st-back'),
    play: q('.tks-st-play'), scrub: q('.tks-st-scrub'), clock: q('.tks-st-clock'), rate: q('.tks-st-rate'),
    map: q('.tks-st-map'), now: q('.tks-st-now'),
    shots: q('.tks-st-shots'), canvas: q('.tks-st-sight canvas'), hud: q('.tks-st-hud'), sightWait: q('.tks-st-sight-wait'), shotWords: q('.tks-st-shot-words'),
    inst: q('.tks-st-inst'),
  };
  const state = { fight: null, studies: [], tl: [], t: 0, rate: 1, playing: false, raf: 0, pick: -1, names: ['', ''], tanks: ['', ''], ticket: 0 };

  // --- loading ---------------------------------------------------------------------
  async function open(id) {
    const ticket = ++state.ticket;
    ui.wait.hidden = false;
    ui.wait.textContent = 'Loading the fight';
    let fight;
    try {
      const res = await fetch(deps.fightUrl(id));
      if (!res.ok) throw new Error(String(res.status));
      fight = await res.json();
    } catch (e) {
      ui.wait.textContent = `This fight did not load (${e.message}).`;
      return;
    }
    if (ticket !== state.ticket) return;
    state.fight = fight;
    state.studies = studyFight(fight);
    state.tl = timeline(fight);
    state.names = fight.sides.map(s => deps.playerName(s.name) || 'someone');
    state.tanks = fight.sides.map(s => deps.prettyTank(s.tmpl));
    state.pick = state.studies.findIndex(st => st.shot.aimed);
    ui.wait.hidden = true;
    ui.names.forEach((el, i) => { el.textContent = `${state.names[i]} (${state.tanks[i]})`; el.style.color = COLORS[i]; });
    const row = fight.row ?? {};
    const end = fight.kill ? `${state.names[fight.kill.side]} killed ${state.names[1 - fight.kill.side]}${fight.range ? ` at ${fight.range} m` : ''}` : 'no kill';
    ui.meta.textContent = `${String(row.level ?? fight.meta?.level ?? '').replace(/_/g, ' ')} · ${row.date ?? fight.meta?.date ?? ''} · ${n1(fight.duration)} s · ${end}`
      + (fight.sides[0].pitch ? '' : '. This fight was found before hull pitch was kept: the pitch lane is empty until the fights are next rebuilt.');
    ui.watch.href = deps.watchUrl(row);
    ui.matchup.href = deps.matchupUrl(row);
    ui.scrub.max = String(fight.duration);
    setTime(state.pick >= 0 ? state.studies[state.pick].t : 0);
    drawShots();
    drawSight();
  }

  // --- time --------------------------------------------------------------------------
  function setTime(t) {
    const f = state.fight;
    if (!f) return;
    state.t = Math.max(0, Math.min(f.duration, t));
    ui.scrub.value = String(state.t);
    ui.clock.textContent = `${n1(state.t)} s`;
    drawMap();
    drawInstruments();
    drawNow();
  }
  function stop() {
    state.playing = false;
    cancelAnimationFrame(state.raf);
    ui.play.querySelector('span').textContent = 'Play';
  }
  function play() {
    const f = state.fight;
    if (!f) return;
    if (state.t >= f.duration - 0.05) setTime(0);
    state.playing = true;
    ui.play.querySelector('span').textContent = 'Pause';
    let last = performance.now();
    const tick = now => {
      if (!state.playing) return;
      const dt = (now - last) / 1000;
      last = now;
      setTime(state.t + dt * state.rate);
      if (state.t >= f.duration) { stop(); return; }
      state.raf = requestAnimationFrame(tick);
    };
    state.raf = requestAnimationFrame(tick);
  }
  ui.play.addEventListener('click', () => (state.playing ? stop() : play()));
  ui.scrub.addEventListener('input', () => { stop(); setTime(Number(ui.scrub.value)); });
  ui.rate.addEventListener('click', e => {
    const b = e.target.closest('button[data-rate]');
    if (!b) return;
    state.rate = Number(b.dataset.rate);
    for (const x of ui.rate.querySelectorAll('button')) x.setAttribute('aria-checked', String(x === b));
  });
  for (const x of ui.rate.querySelectorAll('button')) x.setAttribute('aria-checked', String(x.dataset.rate === '1'));
  ui.back.addEventListener('click', () => { stop(); deps.back(); });
  root.addEventListener('keydown', e => {
    if (ui.main.hidden || e.target.closest('input, textarea')) return;
    if (e.code === 'Space') { e.preventDefault(); state.playing ? stop() : play(); }
  });

  // --- 01: from above ------------------------------------------------------------------
  const W = 760, H = 440, PAD = 28;
  function frame() {
    const f = state.fight;
    const xs = [], zs = [];
    for (const s of f.sides) for (let i = 0; i < samplesOf(s); i++) { xs.push(s.p[3 * i]); zs.push(s.p[3 * i + 2]); }
    for (const st of state.studies) { xs.push(st.pass[0]); zs.push(st.pass[2]); }
    let x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
    const span = Math.max(x1 - x0, z1 - z0, 60);
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const k = Math.min((W - 2 * PAD) / Math.max(x1 - x0, span * 0.3, 60), (H - 2 * PAD - 18) / Math.max(z1 - z0, span * 0.3, 60));
    // North up, east right.
    return { k, X: x => W / 2 + (x - cx) * k, Y: z => (H - 18) / 2 - (z - cz) * k };
  }
  function tankGlyph(s, at, P) {
    const { X, Y } = P;
    const x = X(at.pos[0]), y = Y(at.pos[2]);
    const col = COLORS[s];
    const yaw = at.yaw ?? 0, gun = yaw + (at.turret ?? 0);
    const hull = `<rect x="-5" y="-8" width="10" height="16" rx="2" transform="rotate(${n1(yaw)})" fill="${col}" fill-opacity="${at.live ? 0.9 : 0.25}" stroke="#0c0c0c" stroke-width="1"/>`;
    const barrel = at.turret == null ? '' : `<line x1="0" y1="0" x2="0" y2="-20" transform="rotate(${n1(gun)})" stroke="${col}" stroke-width="2.4" stroke-linecap="round"/>`;
    return `<g class="tks-st-tank" transform="translate(${n1(x)} ${n1(y)})">${hull}${barrel}<circle r="3" fill="#0c0c0c"/></g>`;
  }
  function drawMap() {
    const f = state.fight;
    const P = frame();
    const { X, Y, k } = P;
    let svg = '';
    // A scale bar: 10, 50 or 100 m.
    const bar = [10, 25, 50, 100, 200].find(m => m * k >= 60) ?? 200;
    svg += `<g class="tks-st-scale"><line x1="${PAD}" y1="${H - 12}" x2="${PAD + bar * k}" y2="${H - 12}"/><text x="${PAD + bar * k + 6}" y="${H - 8}">${bar} m</text></g>`
      + `<text class="tks-st-north" x="${W - PAD}" y="${PAD - 6}">N</text><path class="tks-st-north" d="M${W - PAD - 4} ${PAD + 10}l4 -10l4 10z"/>`;
    // Tracks: the whole run faint, the run so far solid.
    for (const [s, side] of f.sides.entries()) {
      const n = samplesOf(side);
      const all = [], past = [];
      for (let i = 0; i < n; i++) {
        const pt = `${n1(X(side.p[3 * i]))},${n1(Y(side.p[3 * i + 2]))}`;
        all.push(pt);
        if (i * f.dt <= state.t) past.push(pt);
      }
      svg += `<polyline class="tks-st-track" points="${all.join(' ')}" stroke="${COLORS[s]}"/>`;
      if (past.length > 1) svg += `<polyline class="tks-st-track is-past" points="${past.join(' ')}" stroke="${COLORS[s]}"/>`;
    }
    // Shots fired so far: the shell's track over the ground to its pass,
    // in flight a moving dot.
    for (const [i, st] of state.studies.entries()) {
      if (st.t > state.t) continue;
      const end = Math.min(st.tau, state.t - st.t);
      const a = st.shot.pos, b = shellAt(st.shot, end);
      const cls = `tks-st-shell${st.hit ? ' is-hit' : ''}${i === state.pick ? ' is-picked' : ''}`;
      svg += `<line class="${cls}" data-shot="${i}" x1="${n1(X(a[0]))}" y1="${n1(Y(a[2]))}" x2="${n1(X(b[0]))}" y2="${n1(Y(b[2]))}" stroke="${COLORS[st.s]}"/>`;
      if (end < st.tau) svg += `<circle class="tks-st-round" cx="${n1(X(b[0]))}" cy="${n1(Y(b[2]))}" r="3"/>`;
      else if (st.hit) svg += `<circle class="tks-st-burst" cx="${n1(X(b[0]))}" cy="${n1(Y(b[2]))}" r="6" stroke="${COLORS[st.s]}"/>`;
    }
    // The shot being studied, its whole path, and where its target was when it got there.
    const picked = state.studies[state.pick];
    if (picked) {
      const pts = [];
      for (let k = 0; k <= 24; k++) { const p = shellAt(picked.shot, picked.tau * k / 24); pts.push(`${n1(X(p[0]))},${n1(Y(p[2]))}`); }
      svg += `<polyline class="tks-st-studied" points="${pts.join(' ')}" stroke="${COLORS[picked.s]}"/>`;
      if (picked.shot.aimed) {
        const at = picked.targetAtPass.pos;
        svg += `<circle class="tks-st-arrive" cx="${n1(X(at[0]))}" cy="${n1(Y(at[2]))}" r="8"/>`
          + `<text class="tks-st-maplabel" x="${n1(X(at[0]) + 11)}" y="${n1(Y(at[2]) + 4)}">${picked.hit ? 'hit here' : 'here when it arrived'}</text>`;
      }
    }
    for (const s of [0, 1]) svg += tankGlyph(s, sideAt(f, s, state.t), P);
    if (f.kill && state.t >= f.kill.t) {
      const v = sideAt(f, 1 - f.kill.side, f.kill.t);
      svg += `<path class="tks-st-kill" d="M${n1(X(v.pos[0]) - 7)} ${n1(Y(v.pos[2]) - 7)}l14 14M${n1(X(v.pos[0]) + 7)} ${n1(Y(v.pos[2]) - 7)}l-14 14"/>`;
    }
    ui.map.innerHTML = svg;
  }
  ui.map.addEventListener('click', e => {
    const el = e.target.closest('[data-shot]');
    if (el) pickShot(Number(el.dataset.shot));
  });

  function drawNow() {
    const f = state.fight;
    const a = sideAt(f, 0, state.t), b = sideAt(f, 1, state.t);
    const range = Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1], a.pos[2] - b.pos[2]);
    const line = (s, at) => `<li class="${s ? 'is-them' : 'is-you'}"><b>${esc(state.names[s])}</b>: ${at.live ? `${n1(at.speed)} m/s` : 'out of sight of the recording'}`
      + `${at.pitch != null ? `, hull ${n1(Math.abs(at.pitch))} deg ${at.pitch >= 0 ? 'nose-up' : 'nose-down'}` : ''}${at.hp != null ? `, ${at.hp} hit points` : ''}</li>`;
    ui.now.innerHTML = `<li>${Math.round(range)} m apart</li>${line(0, a)}${line(1, b)}`;
  }

  // --- 02: through the gunner's sight ---------------------------------------------------------
  function drawShots() {
    ui.shots.innerHTML = state.studies.map((st, i) => `<button type="button" class="dfs-chip tks-st-chip${st.hit ? ' is-hit' : ''}" role="radio" aria-checked="${i === state.pick}" data-shot="${i}" style="--st-col:${COLORS[st.s]}">`
      + `<b>${n1(st.t)} s</b><small>${esc(state.tanks[st.s])} · ${st.shot.aimed ? `${Math.round(st.range)} m · ${st.hit ? 'hit' : 'miss'}` : 'not at them'}</small></button>`).join('')
      || '<span class="tks-empty">No main-gun shot in this fight.</span>';
  }
  function pickShot(i) {
    state.pick = i;
    for (const b of ui.shots.querySelectorAll('button')) b.setAttribute('aria-checked', String(Number(b.dataset.shot) === i));
    stop();
    setTime(state.studies[i].t);
    drawSight();
  }
  ui.shots.addEventListener('click', e => {
    const b = e.target.closest('button[data-shot]');
    if (b) pickShot(Number(b.dataset.shot));
  });

  let sight = null;
  function sightScene() {
    if (sight) return sight;
    const renderer = remasterSideRenderer({ canvas: ui.canvas, antialias: true });
    renderer.setPixelRatio(Math.min(2, globalThis.devicePixelRatio || 1));
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xa9b6bb);
    scene.fog = new THREE.Fog(0xa9b6bb, 400, 2500);
    scene.add(new THREE.HemisphereLight(0xf2f0e6, 0x4a4636, 2.4));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(300, 800, 400);
    scene.add(sun);
    const camera = new THREE.PerspectiveCamera(10, 760 / 428, 0.5, 5000);
    // The close-up: the tank alone, from the same eye, in a corner.
    const close = new THREE.PerspectiveCamera(2, 240 / 150, 0.5, 5000);
    sight = { renderer, scene, camera, close, tank: null, ghost: null, key: null };
    return sight;
  }
  /** Stand a model at a side's recorded pose (three's frame). */
  function pose(obj, at) {
    obj.position.copy(v3(at.pos));
    obj.rotation.set((at.pitch ?? 0) * D2R, -(at.yaw ?? 0) * D2R, (at.roll ?? 0) * D2R, 'YXZ');
  }
  async function drawSight() {
    const st = state.studies[state.pick];
    ui.shotWords.innerHTML = st ? shotWords(st, state.names.map((n, i) => `${n}'s ${state.tanks[i]}`)).map(w => `<li>${esc(w)}</li>`).join('') : '';
    if (!st) { ui.hud.innerHTML = ''; return; }
    let S;
    try { S = sightScene(); } catch { ui.shotWords.insertAdjacentHTML('beforeend', '<li>This browser could not draw the sight.</li>'); return; }
    const tmpl = state.fight.sides[st.o].tmpl;
    if (S.key !== tmpl) {
      ui.sightWait.hidden = false;
      const model = await deps.loadModel(tmpl);
      ui.sightWait.hidden = true;
      if (S.tank) S.scene.remove(S.tank, S.ghost);
      S.tank = model ? model.clone(true) : new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.4, 6.5), new THREE.MeshLambertMaterial({ color: 0x6f6a55 }));
      S.tank.traverse(o => { if (o.isMesh && o.geometry?.userData?.collision) o.visible = false; });
      S.ghost = S.tank.clone(true);
      S.ghost.traverse(o => { if (o.isMesh) { o.material = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false }); } });
      S.scene.add(S.tank, S.ghost);
      S.key = tmpl;
    }
    if (state.studies[state.pick] !== st) return;
    pose(S.tank, st.target);
    pose(S.ghost, st.targetAtPass);
    S.ghost.visible = st.shot.aimed && Math.hypot(...[0, 1, 2].map(k => st.targetAtPass.pos[k] - st.target.pos[k])) > 0.5;
    // The gunner's eye at the muzzle. A slow shell's gun points well over
    // the tank (a vanilla round falls 29 m by 240 m), so the view looks
    // between where the gun points and the tank, wide enough for both and
    // the aim that would have hit; the cross is drawn where the gun points.
    const cam = S.camera;
    const muzzle = v3(st.shot.pos), dir = v3(st.shot.dir).normalize();
    const los = v3([st.target.pos[0], st.target.pos[1] + LIFT, st.target.pos[2]]).sub(muzzle).normalize();
    const needDir = v3(st.need).normalize();
    const look = dir.clone().add(los).normalize();
    cam.position.copy(muzzle);
    cam.up.set(0, 1, 0);
    cam.lookAt(muzzle.clone().add(look));
    const off = Math.max(look.angleTo(dir), look.angleTo(los), look.angleTo(needDir)) / D2R;
    const tankFov = 2 * Math.atan(9 / Math.max(10, st.range)) / D2R * 1.6;
    cam.fov = Math.max(1.5, Math.min(50, Math.max(tankFov, off * 2.3 + tankFov * 0.6)));
    cam.updateProjectionMatrix();
    const w = 760, h = 428;
    S.renderer.setSize(w, h, false);
    S.renderer.setScissorTest(false);
    S.renderer.setViewport(0, 0, w, h);
    S.renderer.render(S.scene, cam);
    // The close-up, bottom right: the tank at its own size in the frame.
    const CW = 240, CH = 150, CX = w - CW - 10, CY = h - CH - 10;
    const aimP = v3([st.target.pos[0], st.target.pos[1] + LIFT, st.target.pos[2]]);
    const close = S.close;
    close.position.copy(muzzle);
    close.up.set(0, 1, 0);
    close.lookAt(aimP);
    close.fov = Math.max(0.3, 2 * Math.atan(4.2 / Math.max(10, st.range)) / D2R);
    close.updateProjectionMatrix();
    S.renderer.setScissorTest(true);
    S.renderer.setScissor(CX, 10, CW, CH);
    S.renderer.setViewport(CX, 10, CW, CH);
    S.renderer.render(S.scene, close);
    S.renderer.setScissorTest(false);
    S.renderer.setViewport(0, 0, w, h);
    const inClose = p => { const v = v3(p).project(close); return { x: CX + (v.x + 1) / 2 * CW, y: CY + (1 - v.y) / 2 * CH, behind: v.z > 1 }; };
    const toScreen = p => { const v = v3(p).project(cam); return { x: (v.x + 1) / 2 * w, y: (1 - v.y) / 2 * h, behind: v.z > 1 }; };
    // The HUD: the cross (the gun), the dot (the shell's pass), the ring (the
    // aim that would have hit).
    const at = d => toScreen([st.shot.pos[0] + d[0] * st.range, st.shot.pos[1] + d[1] * st.range, st.shot.pos[2] + d[2] * st.range]);
    const len = Math.hypot(...st.shot.dir);
    const c = at(st.shot.dir.map(v => v / len));
    let svg = `<path class="tks-st-cross" d="M${n1(c.x - 16)} ${n1(c.y)}h10M${n1(c.x + 6)} ${n1(c.y)}h10M${n1(c.x)} ${n1(c.y - 16)}v10M${n1(c.x)} ${n1(c.y + 6)}v10"/>`
      + `<text class="tks-st-label" x="${n1(c.x + 13)}" y="${n1(c.y + 18)}">the gun</text>`;
    const over = Math.atan2(dir.y, Math.hypot(dir.x, dir.z)) - Math.atan2(los.y, Math.hypot(los.x, los.z));
    if (Math.abs(over) / D2R >= 0.5) {
      const tk = toScreen([st.target.pos[0], st.target.pos[1] + LIFT, st.target.pos[2]]);
      svg += `<line class="tks-st-gap is-hold" x1="${n1(c.x - 30)}" y1="${n1(c.y)}" x2="${n1(c.x - 30)}" y2="${n1(tk.y)}"/>`
        + `<text class="tks-st-label" x="${n1(c.x - 36)}" y="${n1((c.y + tk.y) / 2 + 4)}" text-anchor="end">${n1(Math.abs(over) / D2R)} deg ${over > 0 ? 'over' : 'under'} the tank</text>`;
    }
    if (st.shot.aimed) {
      const pass = toScreen(st.pass);
      const needAt = [st.shot.pos[0] + st.need[0] * st.range, st.shot.pos[1] + st.need[1] * st.range, st.shot.pos[2] + st.need[2] * st.range];
      const ring = toScreen(needAt);
      if (!ring.behind) {
        svg += `<line class="tks-st-gap" x1="${n1(c.x)}" y1="${n1(c.y)}" x2="${n1(ring.x)}" y2="${n1(ring.y)}"/>`
          + `<circle class="tks-st-need" cx="${n1(ring.x)}" cy="${n1(ring.y)}" r="9"/>`
          + `<text class="tks-st-label" x="${n1(ring.x + 13)}" y="${n1(ring.y - 8)}">aim here</text>`;
      }
      if (!pass.behind) {
        svg += `<circle class="tks-st-pass${st.hit ? ' is-hit' : ''}" cx="${n1(pass.x)}" cy="${n1(pass.y)}" r="5"/>`
          + `<text class="tks-st-label" x="${n1(pass.x + 10)}" y="${n1(pass.y + 16)}">${st.hit ? 'hit' : 'the shell'}</text>`;
      }
    }
    svg += `<rect class="tks-st-close" x="${CX}" y="${CY}" width="${CW}" height="${CH}"/><text class="tks-st-label" x="${CX + 6}" y="${CY + 14}">close up</text>`;
    if (st.shot.aimed) {
      const pc = inClose(st.pass);
      if (!pc.behind && pc.x > CX && pc.x < CX + CW && pc.y > CY && pc.y < CY + CH) {
        svg += `<circle class="tks-st-pass${st.hit ? ' is-hit' : ''}" cx="${n1(pc.x)}" cy="${n1(pc.y)}" r="4"/>`;
      } else if (!pc.behind) {
        // Off the close-up: an arrow on its edge, the way it went.
        const ex = Math.max(CX + 6, Math.min(CX + CW - 6, pc.x)), ey = Math.max(CY + 6, Math.min(CY + CH - 6, pc.y));
        svg += `<circle class="tks-st-pass" cx="${n1(ex)}" cy="${n1(ey)}" r="3"/><text class="tks-st-label" x="${n1(Math.min(ex, CX + CW - 70))}" y="${n1(ey - 6)}">passed</text>`;
      }
    }
    // What the gunner read off the hull: range, own speed and pitch.
    const sh = st.shooter;
    svg += `<text class="tks-st-read" x="14" y="22">${Math.round(st.range)} m · ${n1(st.tau)} s flight</text>`
      + `<text class="tks-st-read" x="14" y="40">own speed ${n1(sh.speed)} m/s${sh.pitch != null ? ` · hull ${n1(sh.pitch)} deg` : ''} · target ${n1(st.target.speed)} m/s, ${esc(st.aspect.face)}</text>`;
    ui.hud.innerHTML = svg;
  }

  // --- 03: the instruments -----------------------------------------------------------------
  const IW = 760, IH = 330, L = 46, R = 12;
  function drawInstruments() {
    const f = state.fight, tl = state.tl;
    if (!tl.length) { ui.inst.innerHTML = ''; return; }
    const T = f.duration;
    const x = t => L + (t / T) * (IW - L - R);
    const lanes = [
      { key: 'speed', label: 'Speed, m/s', top: 10, h: 90, get: (r, s) => r.speed[s], min: 0 },
      { key: 'pitch', label: 'Hull pitch, deg', top: 120, h: 90, get: (r, s) => r.pitch[s], sym: true },
      { key: 'range', label: 'Range, m', top: 230, h: 80, get: r => r.range, min: 0, one: true },
    ];
    let svg = '';
    for (const lane of lanes) {
      const vals = tl.flatMap(r => (lane.one ? [lane.get(r)] : [lane.get(r, 0), lane.get(r, 1)])).filter(v => v != null && Number.isFinite(v));
      svg += `<text class="tks-st-lane" x="${L}" y="${lane.top - 1}">${lane.label}</text>`;
      if (!vals.length) { svg += `<text class="tks-st-empty" x="${L + 8}" y="${lane.top + lane.h / 2}">Not in this fight's file yet</text>`; continue; }
      let lo = lane.min ?? Math.min(...vals), hi = Math.max(...vals);
      if (lane.sym) { const m = Math.max(2, ...vals.map(Math.abs)); lo = -m; hi = m; }
      if (hi - lo < 1) hi = lo + 1;
      const y = v => lane.top + 6 + (1 - (v - lo) / (hi - lo)) * (lane.h - 8);
      svg += `<rect class="tks-st-lane-bg" x="${L}" y="${lane.top + 2}" width="${IW - L - R}" height="${lane.h}"/>`
        + `<text class="tks-tick" x="${L - 6}" y="${n1(y(hi) + 4)}" text-anchor="end">${n1(hi)}</text><text class="tks-tick" x="${L - 6}" y="${n1(y(lo) + 4)}" text-anchor="end">${n1(lo)}</text>`;
      if (lane.sym) svg += `<line class="tks-st-zero" x1="${L}" x2="${IW - R}" y1="${n1(y(0))}" y2="${n1(y(0))}"/>`;
      const series = lane.one ? [[null, r => lane.get(r)]] : [[0, r => lane.get(r, 0)], [1, r => lane.get(r, 1)]];
      for (const [s, get] of series) {
        let d = '', pen = false;
        for (const r of tl) {
          const v = get(r);
          if (v == null || !Number.isFinite(v)) { pen = false; continue; }
          d += `${pen ? 'L' : 'M'}${n1(x(r.t))} ${n1(y(v))}`;
          pen = true;
        }
        svg += `<path class="tks-st-line" d="${d}" stroke="${s == null ? 'var(--mm-ink-soft)' : COLORS[s]}"/>`;
      }
    }
    for (const [i, st] of state.studies.entries()) {
      svg += `<line class="tks-st-mark${st.hit ? ' is-hit' : ''}${i === state.pick ? ' is-picked' : ''}" data-shot="${i}" x1="${n1(x(st.t))}" x2="${n1(x(st.t))}" y1="8" y2="${IH - 18}" stroke="${COLORS[st.s]}"/>`;
    }
    if (f.kill) svg += `<text class="tks-st-lane" x="${n1(x(f.kill.t))}" y="${IH - 4}" text-anchor="middle">kill</text>`;
    svg += `<line class="tks-st-now-line" x1="${n1(x(state.t))}" x2="${n1(x(state.t))}" y1="4" y2="${IH - 16}"/>`;
    for (let t = 0; t <= T; t += T > 40 ? 10 : 5) svg += `<text class="tks-tick" x="${n1(x(t))}" y="${IH - 4}" text-anchor="middle">${t} s</text>`;
    ui.inst.innerHTML = svg;
  }
  ui.inst.addEventListener('click', e => {
    const mark = e.target.closest('[data-shot]');
    if (mark) { pickShot(Number(mark.dataset.shot)); return; }
    const f = state.fight;
    if (!f) return;
    const r = ui.inst.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width * IW;
    stop();
    setTime((px - L) / (IW - L - R) * f.duration);
  });

  return {
    open,
    close: stop,
    get state() { return { id: state.fight?.id ?? null, t: state.t, pick: state.pick, shots: state.studies.length,
      words: state.studies[state.pick] ? shotWords(state.studies[state.pick], state.names) : [] }; },
  };
}

export { LIFT };
