// The dogfight school's theatre (features/dogfight-school): a lesson's fights
// replayed the way a documentary draws them. Two fighters over a plain grid,
// each trailing its path in its own colour, a line from each down to its
// shadow on the ground so the height reads, the rounds as their guns' own tracers and the
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
import { gunOf } from './dogfight-pilot.js';
import { leadPoint } from './dogfight-flight.js';
import { COURSES } from './dogfight-rings.js';
import { LESSONS, demoSides, lessonById, RULES } from './dogfight-lessons.js';
import { recordedFight, fightLine, pilotTable } from './dogfight-recorded.js';
import { decodePlayerName } from './vehicle-players.js';
import { nameManoeuvres, primaryAt, MANOEUVRES } from './dogfight-manoeuvres.js';
import { whatIf, chasedAt, spliceFight } from './dogfight-whatif.js';
import { makeTracer, poseTracer, propellersOf, tracerGunOf, tracerRounds, turnPropellers } from './dogfight-plane-look.js';

/** A Neutral Depth token's value (tokens.css): the theatre's 3D colours
 *  are the site's, read where the page defines them, never written here. */
const token = (name, fallback) => {
  const v = typeof getComputedStyle === 'function'
    ? getComputedStyle(document.documentElement).getPropertyValue(name).trim() : '';
  return v || fallback;
};
const SPEEDS = [0.25, 0.5, 1, 2];
/** The replay's speed while a pilot is firing (`slowOnShots`). */
const SHOT_SPEED = 0.3;
/** Seconds between the time marks on both paths. */
const TICK = 2;
/** Seconds of the fight the From-above camera frames: the last ones. */
const TOP_WINDOW = 12;
/** Half the trail ribbon's width, metres: a little under a Spitfire's half span. */
const TRAIL_HALF = 4;
const CAMERAS = [
  { id: 'wide', label: 'Wide' },
  { id: 'ace', label: 'Behind the ace' },
  { id: 'you', label: 'Behind the other' },
  { id: 'sight-ace', label: 'Ace\'s gunsight' },
  { id: 'sight-you', label: 'Other\'s gunsight' },
  { id: 'top', label: 'From above' },
];
/** What each intent reads as on screen (`dogfight-pilot.js` `INTENTS`). */
const INTENT_WORDS = { attack: 'Going for the shot', defend: 'Evading', setup: 'Setting up' };
/** The guns' reach the school's pilots fire inside (`gunOf`): the gun
 *  lines are drawn this long. */
const GUN_REACH = gunOf({}).range;
/** How long a round that meets nothing flies: the duel's own cut-off,
 *  reach over muzzle speed (`dogfight-duel.js`). */
const ROUND_LIFE = gunOf({}).reach / gunOf({}).speed;
/** The three ways out of a fight (features/dogfight-school, "Can you
 *  survive it?"): what each is called on its tab. */
const MOVE_NAMES = { dip: 'The Dip', flip: 'The Flip', ninja: 'The Ninja' };
/** What a lesson's survival verdict reads as. */
const SURVIVAL_WORDS = { yes: 'Yes', partly: 'Partly', no: 'No' };
/** A move's verdict over the nine starts, as `dogfight_dfn_measure.mjs`
 *  `verdictOf` grades it: 7 or more works, 3 to 6 partly. */
const verdictOf = v => (!v ? null : v.works >= 7 ? 'works' : v.works >= 3 ? 'partly' : 'no');
/** How long a freeze on a new shot holds, seconds of the page's clock. */
const HOLD = 2.8;

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * Build the theatre over `host` (the page's stage). `makePlane()` is an
 * airframe for the duels, `planeVisual()` the drawn fighter (a clone of the
 * battle's own, or null for the school's plain one), `planeName` what it is
 * called, `onFly(lessonId)` puts the player in the air against the lesson's
 * ace, `onFlyCourse(courseId)` starts a ring course (`dogfight-course.js`),
 * `onClose()` hands the page back its pointer. `planes()` lists the aircraft
 * you can fly (`{ template, name, fighter }`), `plane()` is the one chosen
 * and `onPlane(template)` chooses one. `recordings` is the index of the
 * dogfights found in round recordings (`extract_dogfights.mjs`,
 * features/dogfight-recordings), listed under FROM THE RECORDINGS; each
 * fight's file sits beside it. `planeVisualFor(template)` draws a recorded
 * pilot's own type when the battle has one, else null; `makePlaneFor(template,
 * mod)` resolves to a builder of that type's airframe (or null), which the
 * WHAT IF flights fly on (`dogfight-whatif.js`).
 */
export function createDogfightTheatre({ host, makePlane, planeVisual = () => null, planeName = 'Spitfire',
                                        onFly = null, onFlyCourse = null, onClose = null, groundY = 0,
                                        planes = () => [], plane = () => null, onPlane = null,
                                        recordings = 'dogfights/index.json', planeVisualFor = () => null,
                                        makePlaneFor = null }) {
  // The two pilots in the site's team tints (the enemy kill red, the other
  // seat the olive side's green), the hits in its amber, the stage, floor
  // and grid in its surfaces and rules.
  const C = {
    ace: token('--mm-kill', '#d65a5a'), you: token('--mm-success', '#7da34c'), hit: token('--mm-load-busy', '#c5a23a'),
    stage: token('--mm-stage', '#0c0c0c'), floor: token('--mm-bg', '#131313'), rule: token('--mm-rule', '#2d2d2d'),
    ruleStrong: token('--mm-rule-strong', '#3d3d3d'), muted: token('--mm-ink-muted', '#8a8a8a'), ink: token('--mm-ink', '#ffffff'),
  };
  const ACE = new THREE.Color(C.ace).getHex(), YOU = new THREE.Color(C.you).getHex();
  const rgb = c => new THREE.Color(c).toArray();
  const aceRgb = rgb(C.ace), youRgb = rgb(C.you);
  const CSS_ACE = C.ace, CSS_YOU = C.you;
  const root = document.createElement('div');
  root.className = 'dfs';
  // Its lists scroll with the wheel: the page's own wheel (weapons, the
  // camera) leaves it alone (`page-input.js`).
  root.dataset.ownWheel = '';
  root.hidden = true;
  root.tabIndex = -1;
  root.innerHTML = `
    <aside class="dfs-side">
      <header class="dfs-brand"><b>Dogfight school</b><small>Moves, and their counters, flown on BF1942's own flight law</small></header>
      <div class="dfs-plane" hidden><span>YOUR PLANE</span><div class="dfs-plane-list" role="radiogroup" aria-label="Your plane"></div></div>
      <nav class="dfs-sections" aria-label="School sections"><button type="button" class="dfs-chip" data-section="lessons">Lessons</button><button type="button" class="dfs-chip" data-section="courses">Ring courses</button><button type="button" class="dfs-chip" data-section="recordings">Recordings</button></nav>
      <ol class="dfs-lessons" role="list" data-show="lessons"></ol>
      <p class="dfs-rule"></p>
      <footer class="dfs-foot"><kbd>V</kbd> or <kbd>Esc</kbd> close</footer>
    </aside>
    <section class="dfs-main">
      <div class="dfs-stage">
        <canvas class="dfs-canvas"></canvas>
        <div class="dfs-tags"><span class="dfs-tag is-ace">ACE</span><span class="dfs-tag is-you">OTHER</span>
          <span class="dfs-guns is-ace"></span><span class="dfs-guns is-you"></span></div>
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
          <p class="dfs-cap is-ace"><b>ACE</b><i class="dfs-intent"></i><span></span></p>
          <p class="dfs-cap is-you"><b>OTHER</b><i class="dfs-intent"></i><span></span></p>
        </div>
        <div class="dfs-endcard" hidden><b></b><span></span></div>
        <div class="dfs-shotcard" hidden><small></small><b></b><span class="dfs-shot-geo"></span><span class="dfs-shot-why"></span><span class="dfs-shot-other"></span></div>
        <div class="dfs-reticle" hidden><i class="dfs-ring"></i><i class="dfs-lead"></i><span></span></div>
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
        <small class="dfs-legend"><span><i class="is-ace"></i><span class="is-ace-name">ace's energy</span></span><span><i class="is-you"></i><span class="is-you-name">other's energy</span></span><span><i class="is-ace-shot"></i><span class="is-ace-shotname">ace has the shot</span></span><span><i class="is-you-shot"></i><span class="is-you-shotname">other has the shot</span></span><span><i class="is-hit"></i>hits</span></small>
      </div>
      <div class="dfs-lower">
        <div class="dfs-survival" hidden><small>CAN YOU SURVIVE IT?</small><b></b><span></span></div>
        <div class="dfs-moves" hidden></div>
        <div class="dfs-whatif" hidden><div class="dfs-whatif-head"><small>WHAT IF</small><span></span><button type="button" class="dfs-chip" data-whatif="run">Fly his other ways out</button><button type="button" class="dfs-chip" data-whatif="back" hidden>Back to the recording</button></div><ol></ol></div>
        <div class="dfs-flyrow">
          <button type="button" class="dfs-fly">Fly it yourself</button>
          <span class="dfs-fly-note">You take the other seat, in the air, against the ace flying this move. The coach tells you what he is doing and what beats it.</span>
        </div>
        <div class="dfs-story">
          <div><h3 class="dfs-story-move">THE MOVE</h3><div class="dfs-move"></div></div>
          <div><h3 class="dfs-story-counter">THE COUNTER</h3><div class="dfs-counter"></div></div>
        </div>
      </div>
    </section>`;
  (host?.ownerDocument?.body ?? document.body).appendChild(root);
  const q = sel => root.querySelector(sel);
  const ui = {
    planeBox: q('.dfs-plane'), planeList: q('.dfs-plane-list'),
    lessons: q('.dfs-lessons'), sections: q('.dfs-sections'), rule: q('.dfs-rule'), canvas: q('.dfs-canvas'), stage: q('.dfs-stage'),
    tags: [q('.dfs-tag.is-ace'), q('.dfs-tag.is-you')], guns: [q('.dfs-guns.is-ace'), q('.dfs-guns.is-you')],
    tc: q('.dfs-titlecard'), tcKicker: q('.dfs-tc-kicker'), tcTitle: q('.dfs-tc-title'), tcNote: q('.dfs-tc-note'),
    meters: [q('.dfs-meter.is-ace'), q('.dfs-meter.is-you')],
    caps: [q('.dfs-cap.is-ace span'), q('.dfs-cap.is-you span')], youCap: q('.dfs-cap.is-you b'),
    capNames: [q('.dfs-cap.is-ace b'), q('.dfs-cap.is-you b')],
    legendNames: [q('.dfs-legend .is-ace-name'), q('.dfs-legend .is-you-name')],
    legendShots: [q('.dfs-legend .is-ace-shotname'), q('.dfs-legend .is-you-shotname')],
    storyHeads: [q('.dfs-story-move'), q('.dfs-story-counter')],
    intents: [q('.dfs-cap.is-ace .dfs-intent'), q('.dfs-cap.is-you .dfs-intent')],
    shot: q('.dfs-shotcard'), reticle: q('.dfs-reticle'), lead: q('.dfs-lead'), reticleText: q('.dfs-reticle span'),
    survival: q('.dfs-survival'), moves: q('.dfs-moves'), whatif: q('.dfs-whatif'),
    end: q('.dfs-endcard'), demos: q('.dfs-demos'), toggle: q('.dfs-toggle'), restart: q('.dfs-restart'),
    speeds: q('.dfs-speeds'), cams: q('.dfs-cams'), chart: q('.dfs-chart'), scrub: q('.dfs-scrub'),
    move: q('.dfs-move'), counter: q('.dfs-counter'), fly: q('.dfs-fly'), flyRow: q('.dfs-flyrow'),
  };

  const state = { open: false, lesson: null, demo: null, fight: null, moveShown: [null, null], planLabels: ["", ""], t: 0, playing: true, speed: 1, camera: 'wide', drawScale: 1, slowOnShots: true, explain: true, hold: 0, explained: new Set(),
                  orbit: { az: -0.9, el: 0.32, zoom: 1 }, rule: 0 };
  /** A side's name on screen: the pilot's own in a recorded fight. */
  const nameOf = i => (state.fight?.recorded ? state.fight.names[i] : i === 0 ? 'ACE' : 'OTHER');
  /** A side as a sentence starts it. */
  const whoOf = i => (state.fight?.recorded ? state.fight.names[i] : i === 0 ? 'The ace' : 'The other pilot');
  /** Write the sides' names everywhere the picture carries them. */
  function setNames() {
    for (const i of [0, 1]) {
      const name = nameOf(i);
      ui.tags[i].textContent = name;
      ui.meters[i].querySelector('b').textContent = name;
      ui.capNames[i].textContent = name;
    }
    const rec = state.fight?.recorded;
    const label = { ace: rec ? `Behind ${nameOf(0)}` : 'Behind the ace', you: rec ? `Behind ${nameOf(1)}` : 'Behind the other',
                    'sight-ace': rec ? `${nameOf(0)}'s gunsight` : 'Ace\'s gunsight', 'sight-you': rec ? `${nameOf(1)}'s gunsight` : 'Other\'s gunsight' };
    ui.cams.querySelectorAll('button[data-cam]').forEach(b => { if (label[b.dataset.cam]) b.textContent = label[b.dataset.cam]; });
    ui.legendNames[0].textContent = `${rec ? nameOf(0) : 'ace'}'s energy`;
    ui.legendNames[1].textContent = `${rec ? nameOf(1) : 'other'}'s energy`;
    ui.legendShots[0].textContent = `${rec ? nameOf(0) : 'ace'} has the shot`;
    ui.legendShots[1].textContent = `${rec ? nameOf(1) : 'other'} has the shot`;
  }
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
    scene.background = new THREE.Color(C.stage);
    scene.fog = new THREE.Fog(C.stage, 1600, 5200);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x5a5a5a, 3.4));
    const sun = new THREE.DirectionalLight(0xffffff, 3.2);
    sun.position.set(-0.4, 1, 0.3);
    scene.add(sun);
    const camera = new THREE.PerspectiveCamera(50, 1, 2, 9000);
    // The ground: a pale floor with a kilometre grid and a 100 m one.
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(12000, 12000),
      new THREE.MeshBasicMaterial({ color: C.floor }));
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);
    const fine = new THREE.GridHelper(12000, 120, C.rule, C.rule);
    fine.position.y = 0.3;
    scene.add(fine);
    const coarse = new THREE.GridHelper(12000, 12, C.ruleStrong, C.ruleStrong);
    coarse.position.y = 0.6;
    scene.add(coarse);
    // From above: a flat map, not a perspective. Near and far parts of the
    // fight drawn the same size, so a steady turn reads as one circle.
    const ortho = new THREE.OrthographicCamera(-100, 100, 100, -100, 1, 20000);
    ortho.up.set(0, 0, -1);
    gl = { renderer: r, scene, camera, ortho, floor, fine, coarse, actors: [], sparks: null };
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

  /** A drawn plane's widest visible extent, metres, at its own scale. */
  function spanOf(node) {
    const box = new THREE.Box3();
    node.updateMatrixWorld(true);
    node.traverse(o => {
      if (!o.isMesh) return;
      for (let n = o; n; n = n.parent) if (!n.visible) return;
      box.expandByObject(o, true);
    });
    if (box.isEmpty()) return 11;
    const size = box.getSize(new THREE.Vector3());
    return Math.max(size.x, size.z) / (node.scale.x || 1);
  }

  /** Put `node` in an actor's place: its own propeller and tracers too. */
  function swapPlane(s, fight, a, node) {
    // Measured level, before it takes the actor's pose.
    a.span = spanOf(node);
    s.scene.remove(a.plane);
    node.position.copy(a.plane.position);
    node.quaternion.copy(a.plane.quaternion);
    node.scale.copy(a.plane.scale);
    a.plane = node;
    s.scene.add(node);
    a.props = propellersOf(node);
    a.look = tracerGunOf(node);
    for (const m of a.streaks) s.scene.remove(m);
    a.streaks = [];
    s.tracerSet = tracerRounds(fight.rounds, s.actors.map(x => x.look));
  }

  /** The two actors: a fighter each, its trail, its shadow's trail, its drop line. */
  function buildActors(fight) {
    const s = renderer();
    for (const a of s.actors) {
      s.scene.remove(a.plane, a.trail, a.shadow, a.drop, a.marker, a.gun);
      if (a.flash) { s.scene.remove(a.flash); a.flash.geometry.dispose(); }
      for (const m of a.streaks) s.scene.remove(m);
      a.trail.geometry.dispose();
      a.shadow.geometry.dispose();
    }
    s.actors = [0, 1].map(i => {
      const color = i === 0 ? ACE : YOU;
      let plane = null;
      // A recorded pilot's own type: at once when the battle parks it, or
      // swapped in when its model has loaded (`swapPlane`).
      let pending = null;
      if (fight.recorded && fight.templates?.[i]) {
        try {
          const got = planeVisualFor(fight.templates[i], fight.meta?.mod);
          if (got && typeof got.then === 'function') pending = got; else plane = got;
        } catch { plane = null; }
      }
      if (!plane) {
        try { plane = planeVisual(i); } catch { plane = null; }
      }
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
      // His gun line: where his rounds would go, out to the guns' reach.
      const gg = new THREE.BufferGeometry();
      gg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const gun = new THREE.Line(gg, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false }));
      gun.frustumCulled = false;
      s.scene.add(plane, trail, shadow, drop, marker, gun);
      // The plane's own propeller, turned on the revs the fight recorded,
      // and its guns' own tracer streak (`dogfight-plane-look.js`).
      return { plane, trail, shadow, drop, marker, gun, props: propellersOf(plane), look: tracerGunOf(plane), streaks: [], pending, span: spanOf(plane) };
    });
    // Time on the paths: a dot on each every TICK seconds and a faint rung
    // between the two at the same moment, so two paths that cross at
    // different times never pass for a braid.
    if (s.ticks) { s.scene.remove(s.ticks.dots, s.ticks.rungs); s.ticks.dots.geometry.dispose(); s.ticks.rungs.geometry.dispose(); }
    {
      const every = Math.max(1, Math.round(TICK / fight.dt));
      const n = Math.floor((Math.min(fight.tracks[0].length, fight.tracks[1].length) - 1) / every) + 1;
      const dp = new Float32Array(n * 6), dc = new Float32Array(n * 6), rp = new Float32Array(n * 6);
      const at = (i, j) => { const k = fight.tracks[i][j * every].p; return [k[0] - fight.origin[0], k[1] - fight.origin[1], k[2] - fight.origin[2]]; };
      for (let j = 0; j < n; j++) {
        const a = at(0, j), b = at(1, j);
        dp.set([...a, ...b], j * 6);
        dc.set([...aceRgb, ...youRgb], j * 6);
        rp.set([...a, ...b], j * 6);
      }
      const dg = new THREE.BufferGeometry();
      dg.setAttribute('position', new THREE.BufferAttribute(dp, 3));
      dg.setAttribute('color', new THREE.BufferAttribute(dc, 3));
      const rg2 = new THREE.BufferGeometry();
      rg2.setAttribute('position', new THREE.BufferAttribute(rp, 3));
      const dots = new THREE.Points(dg, new THREE.PointsMaterial({ vertexColors: true, size: 7, sizeAttenuation: false, depthWrite: false }));
      const rungs = new THREE.LineSegments(rg2, new THREE.LineBasicMaterial({ color: C.muted, transparent: true, opacity: 0.35, depthWrite: false }));
      dots.frustumCulled = rungs.frustumCulled = false;
      s.scene.add(dots, rungs);
      s.ticks = { dots, rungs, every };
    }
    // The rounds that carry a tracer: the guns' own rate and tracer interval
    // (`tracerRounds`); the rounds between them fly unseen, as in the game.
    s.tracerSet = tracerRounds(fight.rounds, s.actors.map(a => a.look));
    // A recorded type's model, when it lands, in place of the stand-in.
    for (const a of s.actors) {
      a.pending?.then(node => {
        if (!node || state.fight !== fight || !s.actors.includes(a)) return;
        swapPlane(s, fight, a, node);
      }).catch(() => {});
    }
    if (s.sparks) { s.scene.remove(s.sparks); s.sparks.geometry.dispose(); }
    const hits = fight.rounds.filter(r => r.hit);
    const hg = new THREE.BufferGeometry();
    hg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(Math.max(1, hits.length) * 3), 3));
    s.sparks = new THREE.Points(hg, new THREE.PointsMaterial({ color: C.hit, size: 14, sizeAttenuation: false, transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending }));
    s.sparks.frustumCulled = false;
    s.sparks.userData.hits = hits;
    s.scene.add(s.sparks);
    // The guns: a flash at each pilot's nose while he fires.
    for (const a of s.actors) {
      const fg = new THREE.BufferGeometry();
      fg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
      a.flash = new THREE.Points(fg, new THREE.PointsMaterial({ color: C.hit, size: 22, sizeAttenuation: false, transparent: true,
        depthWrite: false, blending: THREE.AdditiveBlending }));
      a.flash.frustumCulled = false;
      s.scene.add(a.flash);
    }
  }

  // --- the fight ------------------------------------------------------------------
  /**
   * The wide camera's bearing for a fight: side-on to the line it runs
   * along (the main horizontal axis of both paths), so a loop or a dive in
   * that line's vertical plane reads as itself, not as a hook seen end-on;
   * looking so the fight runs left to right.
   */
  function sideOn(fight) {
    let n = 0, mx = 0, mz = 0;
    for (const tr of fight.tracks) for (const k of tr) { mx += k.p[0]; mz += k.p[2]; n++; }
    mx /= n; mz /= n;
    let xx = 0, zz = 0, xz = 0;
    for (const tr of fight.tracks) for (const k of tr) {
      const dx = k.p[0] - mx, dz = k.p[2] - mz;
      xx += dx * dx; zz += dz * dz; xz += dx * dz;
    }
    // The principal axis of the spread, signed by the way the fight went.
    const ang = 0.5 * Math.atan2(2 * xz, xx - zz);
    let ux = Math.cos(ang), uz = Math.sin(ang);
    const a = fight.tracks[0], b = fight.tracks[1];
    const gx = (a.at(-1).p[0] + b.at(-1).p[0]) - (a[0].p[0] + b[0].p[0]);
    const gz = (a.at(-1).p[2] + b.at(-1).p[2]) - (a[0].p[2] + b[0].p[2]);
    if (ux * gx + uz * gz < 0) { ux = -ux; uz = -uz; }
    return Math.atan2(-uz, ux);
  }

  function fly(lesson, demo) {
    const key = `${lesson.id}/${demo.id}`;
    if (flown.has(key)) return flown.get(key);
    const origin = [0, groundY, 0];
    const r = runDuel({ makePlane, seconds: demo.seconds ?? lesson.seconds, origin, groundAt: () => groundY, sides: demoSides(lesson, demo) });
    const fight = { ...r, origin, lesson, demo, duration: r.tracks[0].at(-1).t };
    // Each side's bursts, and its shot windows (a solution that lands,
    // whether or not he fired), as spans of time.
    const spansOf = (track, key, gap = 0.25) => {
      const spans = [];
      for (const k of track) {
        const last = spans.at(-1);
        if (!k[key]) continue;
        if (last && k.t - last[1] < gap) last[1] = k.t; else spans.push([k.t, k.t]);
      }
      return spans;
    };
    fight.bursts = r.tracks.map(track => spansOf(track, 'f', 0.15));
    // A kill shot is one he takes: the trigger down and the rounds going
    // where they will land. A solution he holds while closing to his own
    // firing range is not one (the gun line still shows it).
    for (const track of r.tracks) for (const k of track) k.ko = !!(k.o && k.f);
    fight.shots = r.tracks.map(track => spansOf(track, 'ko'));
    fight.shotTime = fight.shots.map(spans => spans.reduce((n, [a, b]) => n + (b - a) + r.dt, 0));
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

  /** Whether a side's guns are firing at `t`, within `pad` seconds. */
  function firingAt(fight, side, t, pad = 0) {
    for (const [a, b] of fight.bursts[side]) if (t >= a - pad && t <= b + pad) return true;
    return false;
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

  /** The manoeuvres each pilot flew (`dogfight-manoeuvres.js`), named once
   *  a fight, and listed under the picture to jump to. */
  const GENERIC = new Set(['Tail chase', 'Climb', 'Dive', 'Hard turn', 'Spiral dive', 'Zoom climb']);
  const LINES = new Map(MANOEUVRES);
  function setMoves(fight) {
    let moves = [];
    try { moves = nameManoeuvres(fight); } catch (e) { console.warn('dogfight manoeuvres', e); }
    fight.moves = moves;
    state.moveShown = [null, null];
    ui.moves.hidden = !moves.length;
    ui.moves.innerHTML = [0, 1].map(side => {
      const mine = moves.filter(m => m.side === side);
      return `<div class="dfs-moves-row is-${side === 0 ? 'ace' : 'you'}"><b>${esc(nameOf(side))}</b><span>`
        + (mine.length ? mine.map(m => `<button type="button" class="dfs-move-chip${GENERIC.has(m.name) ? ' is-generic' : ''}" data-seek="${m.t0}"`
          + ` title="${esc(`${LINES.get(m.name) ?? ''}, ${m.t0.toFixed(1)} to ${m.t1.toFixed(1)} s`)}">${esc(m.name)}<i>${m.t0.toFixed(0)}s</i></button>`).join('')
          : '<small>Nothing but flying straight</small>')
        + '</span></div>';
    }).join('');
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
    state.orbit.az = sideOn(state.fight);
    state.t = 0;
    state.explained = new Set(); state.hold = 0; ui.shot.hidden = true;
    state.playing = true;
    ui.toggle.textContent = 'Pause';
    buildActors(state.fight);
    setNames();
    state.planLabels = [0, 1].map(i => state.fight.events.find(e => e.side === i)?.move ?? '');
    setMoves(state.fight);
    ui.tcKicker.textContent = `${lesson.title.toUpperCase()} · ${planeName.toUpperCase()} AGAINST ${planeName.toUpperCase()}`;
    ui.tcTitle.textContent = demo.label;
    ui.tcNote.textContent = demo.verdict?.line ? `${demo.note} ${demo.verdict.line}` : demo.note;
    ui.tc.classList.add('is-shown');
    clearTimeout(pickDemo.timer);
    pickDemo.timer = setTimeout(() => ui.tc.classList.remove('is-shown'), 3200);
    ui.end.hidden = true;
    drawChart();
  }

  /** A demo's tab: a Dip, Flip or Ninja carries its name over its label
   *  and how many of the nine starts it worked from. */
  function demoTab(d) {
    const name = MOVE_NAMES[d.kind];
    const label = name ? String(d.label).replace(new RegExp(`^${name}\\s*[:\\-]\\s*`, 'i'), '') : d.label;
    const v = verdictOf(d.verdict);
    return `<button type="button" role="tab" data-demo="${esc(d.id)}"${name ? ` data-kind="${esc(d.kind)}"` : ''}>`
      + (name ? `<small class="dfs-demo-kind">${esc(name.toUpperCase())}</small>` : '')
      + `<span>${esc(label)}</span>`
      + (v ? `<i class="dfs-verdict is-${v}" title="${esc(d.verdict.line ?? '')}">${d.verdict.works}/${d.verdict.of ?? 9}</i>` : '')
      + '</button>';
  }

  function pickLesson(id) {
    const lesson = lessonById(id) ?? LESSONS[0];
    state.lesson = lesson;
    ui.lessons.querySelectorAll('button').forEach(b => b.setAttribute('aria-current', String(b.dataset.lesson === lesson.id)));
    ui.storyHeads[0].textContent = 'THE MOVE';
    ui.storyHeads[1].textContent = 'THE COUNTER';
    ui.flyRow.hidden = false;
    ui.whatif.hidden = true;
    state.recording = null;
    ui.move.innerHTML = lesson.story.map(p => `<p>${esc(p)}</p>`).join('');
    ui.counter.innerHTML = lesson.counterStory.map(p => `<p>${esc(p)}</p>`).join('');
    ui.demos.innerHTML = lesson.demos.map(demoTab).join('');
    const sv = lesson.survival;
    ui.survival.hidden = !sv;
    if (sv) {
      ui.survival.dataset.verdict = sv.verdict;
      ui.survival.querySelector('b').textContent = SURVIVAL_WORDS[sv.verdict] ?? sv.verdict;
      ui.survival.querySelector('span').textContent = sv.line;
    }
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
    // The shot windows, in each pilot's colour, the ace's on the top half
    // and the other's on the bottom: who had the kill shot, and when.
    x.globalAlpha = 0.3;
    for (const [side, spans] of fight.shots.entries()) {
      x.fillStyle = side === 0 ? C.ace : C.you;
      for (const [a, b] of spans) x.fillRect(X(a), side === 0 ? 0 : h / 2, Math.max(3, X(b) - X(a)), h / 2);
    }
    x.globalAlpha = 0.45;
    for (const e of fight.events) {
      x.fillStyle = e.side === 0 ? C.ace : C.you;
      x.fillRect(X(e.t), e.side === 0 ? 0 : h - 6, 1, 6);
    }
    x.globalAlpha = 1;
    for (const [i, tr] of fight.tracks.entries()) {
      x.strokeStyle = i === 0 ? CSS_ACE : CSS_YOU;
      x.lineWidth = 2;
      x.beginPath();
      tr.forEach((k, j) => { if (j % 3 === 0) j === 0 ? x.moveTo(X(k.t), Y(k.e)) : x.lineTo(X(k.t), Y(k.e)); });
      x.stroke();
    }
    x.fillStyle = C.hit;
    for (const r of fight.rounds) if (r.hit) x.fillRect(X(r.hitT) - 1, r.side === 0 ? 8 : h - 14, 2, 6);
    if (fight.end) {
      x.fillStyle = C.ink;
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
    const view = state.camera === 'top' ? s.ortho : s.camera;
    if (fight.recorded) drawWhatIfHead();
    if (state.hold > 0) {
      state.hold -= dt;
      if (state.hold <= 0) ui.shot.hidden = true;
    } else if (state.playing) {
      // A new kill shot: the replay stops on it and says how it came.
      if (state.explain) {
        for (const side of [0, 1]) {
          const win = fight.shots[side].find(([a]) => a <= state.t && a > state.t - 0.5);
          const key = win ? `${side}:${win[0]}` : null;
          if (win && !state.explained.has(key)) {
            state.explained.add(key);
            explainShot(fight, side, win);
            state.hold = HOLD;
            break;
          }
        }
      }
    }
    if (state.playing && state.hold <= 0) {
      // Around every burst the replay slows, so the shot reads: the moment
      // the guns come on is the moment the move paid off.
      const shot = state.slowOnShots && (firingAt(fight, 0, state.t, 0.5) || firingAt(fight, 1, state.t, 0.5));
      state.t += dt * (shot ? Math.min(state.speed, SHOT_SPEED) : state.speed);
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
      a.marker.quaternion.copy(view.quaternion);
      const n = Math.max(1, k.i + 1);
      // Behind a tail, that tail's own newest ribbon would fill the picture.
      const chased = (state.camera === 'ace' && i === 0) || (state.camera === 'you' && i === 1);
      a.trail.geometry.setDrawRange(0, Math.max(0, n - 1 - (chased ? 45 : 0)) * 6);
      a.shadow.geometry.setDrawRange(0, n);
      if (i === 0 && s.ticks) {
        const shown = Math.floor(k.i / s.ticks.every) + 1;
        s.ticks.dots.geometry.setDrawRange(0, shown * 2);
        s.ticks.rungs.geometry.setDrawRange(0, shown * 2);
      }
      // Drawn bigger than life when the camera stands back, as a diagram
      // draws them; true size behind a tail.
      a.plane.scale.setScalar(state.drawScale);
      a.marker.scale.setScalar(state.drawScale);
      a.marker.visible = !((state.camera === 'ace' && i === 0) || (state.camera === 'you' && i === 1));
      a.plane.visible = !(state.camera === `sight-${i === 0 ? 'ace' : 'you'}`);
      // The gun line: faint while the other is out of it, his colour when he
      // is in the kill zone, the hit colour when the shot would land.
      _f.set(0, 0, -1).applyQuaternion(k.q);
      const gp = a.gun.geometry.attributes.position.array;
      gp.set([a.plane.position.x, a.plane.position.y, a.plane.position.z,
              a.plane.position.x + _f.x * GUN_REACH, a.plane.position.y + _f.y * GUN_REACH, a.plane.position.z + _f.z * GUN_REACH]);
      a.gun.geometry.attributes.position.needsUpdate = true;
      const kk = k.k;
      a.gun.material.color.set(kk.o ? C.hit : (i === 0 ? C.ace : C.you));
      a.gun.material.opacity = kk.o ? 1 : kk.z ? 0.75 : 0.18;
      const intent = kk.in ?? 'setup';
      ui.intents[i].textContent = INTENT_WORDS[intent];
      ui.intents[i].dataset.intent = intent;
      const d = a.drop.geometry.attributes.position.array;
      d.set([a.plane.position.x, a.plane.position.y, a.plane.position.z, a.plane.position.x, 1, a.plane.position.z]);
      a.drop.geometry.attributes.position.needsUpdate = true;
      a.drop.computeLineDistances();
      const m = ui.meters[i];
      // His plan or plane, and the manoeuvre he is flying now.
      const now = state.fight.moves ? primaryAt(state.fight.moves, i, state.t) : null;
      const planText = now ? `${state.planLabels?.[i] ?? ''} · ${now.name}` : (state.planLabels?.[i] ?? '');
      if (state.moveShown?.[i] !== planText) {
        state.moveShown[i] = planText;
        m.querySelector('.dfs-m-plan').textContent = planText;
        ui.moves.querySelectorAll(`.dfs-moves-row.is-${i === 0 ? 'ace' : 'you'} button`).forEach(b => b.classList.toggle('is-now', !!now && +b.dataset.seek === now.t0));
      }
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
    // The propellers, turned on the revs the fight recorded over the fight
    // time this frame moved (a seek or a pause turns nothing).
    const moved = state.t - (state.lastT ?? state.t);
    state.lastT = state.t;
    for (const [i, a] of s.actors.entries()) {
      if (a.props.length) turnPropellers(a.props, now2[i].k.rv ?? 1, moved > 0 && moved < 0.5 ? moved : 0);
    }
    // The tracer rounds in the air at `t`, each its gun's own streak.
    const used = [0, 0];
    const pxAt1m = view.isPerspectiveCamera ? 2 * Math.tan(view.fov * Math.PI / 360) / Math.max(1, h) : 0;
    const pxFlat = view.isOrthographicCamera ? (view.top - view.bottom) / view.zoom / Math.max(1, h) : 0;
    for (const r of s.tracerSet) {
      const age = state.t - r.t;
      const life = r.hit ? r.hitT - r.t : ROUND_LIFE;
      if (age < 0 || age > life) continue;
      const a = s.actors[r.side];
      let mesh = a.streaks[used[r.side]];
      if (!mesh) { mesh = makeTracer(a.look); a.streaks.push(mesh); s.scene.add(mesh); }
      used[r.side]++;
      mesh.visible = true;
      _m.set(r.start[0] + r.v[0] * age - o[0], r.start[1] + r.v[1] * age - o[1], r.start[2] + r.v[2] * age - o[2]);
      _u.set(...r.v);
      const speed = _u.length();
      _u.divideScalar(speed || 1);
      const mpp = pxFlat || pxAt1m * _m.distanceTo(view.position);
      poseTracer(mesh, a.look, _m, _u, speed * age, state.drawScale, mpp);
    }
    for (const [i, a] of s.actors.entries()) for (let j = used[i]; j < a.streaks.length; j++) a.streaks[j].visible = false;
    // The flash at a firing pilot's nose, flickering, and the GUNS callout
    // beside him with the range he is firing from.
    for (const [i, a] of s.actors.entries()) {
      const firing = firingAt(fight, i, state.t, 0);
      const fp = a.flash.geometry.attributes.position.array;
      _f.set(0, 0, -1).applyQuaternion(now2[i].q);
      fp[0] = now2[i].p[0] - o[0] + _f.x * 6 * state.drawScale;
      fp[1] = now2[i].p[1] - o[1] + _f.y * 6 * state.drawScale;
      fp[2] = now2[i].p[2] - o[2] + _f.z * 6 * state.drawScale;
      a.flash.geometry.attributes.position.needsUpdate = true;
      a.flash.visible = firing && Math.sin(performance.now() * 0.09 + i) > -0.3;
    }
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
    drawReticle(s, now2, w, h);
    s.renderer.render(s.scene, view);
    // The name tags over the fighters.
    for (const [i, a] of s.actors.entries()) {
      _m.copy(a.plane.position).add(_u.set(0, 14, 0)).project(view);
      const tag = ui.tags[i];
      const on = _m.z < 1 && Math.abs(_m.x) < 1.1 && Math.abs(_m.y) < 1.1;
      tag.style.opacity = on ? '1' : '0';
      if (on) tag.style.transform = `translate(${(_m.x * 0.5 + 0.5) * w}px, ${(-_m.y * 0.5 + 0.5) * h}px) translate(-50%, -100%)`;
      // GUNS, with the range he is firing from, and HIT when a round of his
      // has just struck: the shot the move bought.
      const guns = ui.guns[i];
      const firing = on && firingAt(fight, i, state.t, 0);
      guns.classList.toggle('is-on', firing);
      if (firing) {
        const range = Math.hypot(now2[0].p[0] - now2[1].p[0], now2[0].p[1] - now2[1].p[1], now2[0].p[2] - now2[1].p[2]);
        const struck = fight.rounds.some(r => r.side === i && r.hit && state.t >= r.hitT && state.t < r.hitT + 0.4);
        guns.textContent = `GUNS · ${Math.round(range)} M${struck ? ' · HIT' : ''}`;
        guns.style.transform = `translate(${(_m.x * 0.5 + 0.5) * w}px, ${(-_m.y * 0.5 + 0.5) * h}px) translate(-50%, -230%)`;
      }
    }
    // The end card, once the fight is decided.
    if (fight.end && state.t >= fight.end.t + 0.3) showEnd(fight);
    else if (!fight.end && state.t >= fight.duration) showEnd(fight);
    else ui.end.hidden = true;
  }

  /**
   * The freeze on a kill shot: who has it, from where (range, how far off
   * the lead), what his move was (his own words as the window opened), and
   * what the other pilot was doing to let it happen.
   */
  function explainShot(fight, side, window) {
    const k = sampleAt(fight.tracks[side], window[0], fight.dt).k;
    const who = nameOf(side).toUpperCase();
    // The move that made the shot: the last thing he said that was not
    // about the shot itself, and what he says as he takes it.
    const mine = fight.events.filter(e => e.side === side && e.phase !== 'kill' && e.t <= window[0] + 0.05);
    const now = mine.at(-1);
    const before = [...mine].reverse().find(e => e.intent !== 'attack' && e.say && e.say !== now?.say);
    const said = [before?.say, now?.say].filter(Boolean).join('. Then: ');
    const theirs = sayingAt(fight, 1 - side, window[0])?.say ?? '';
    const n = fight.shots[side].indexOf(window) + 1;
    ui.shot.dataset.side = side === 0 ? 'ace' : 'you';
    ui.shot.querySelector('small').textContent = `${who} · KILL SHOT ${n} OF ${fight.shots[side].length}`;
    ui.shot.querySelector('b').textContent = `${whoOf(side)} has the shot`;
    ui.shot.querySelector('.dfs-shot-geo').textContent = `${k.sd} m out, his nose ${k.so} degrees off the lead, for ${(window[1] - window[0] + fight.dt).toFixed(1)} s`;
    ui.shot.querySelector('.dfs-shot-why').textContent = said ? `How he got it: ${said.charAt(0).toLowerCase()}${said.slice(1)}.` : '';
    ui.shot.querySelector('.dfs-shot-other').textContent = theirs
      ? `Meanwhile ${state.fight?.recorded ? nameOf(1 - side) : side === 0 ? 'the other pilot' : 'the ace'}: ${theirs.charAt(0).toLowerCase()}${theirs.slice(1)}.`
      : '';
    ui.shot.hidden = false;
  }

  /** The gunsight camera's reticle: the ring is the guns' line, the dot the
   *  lead his rounds need; the dot inside the ring is the shot. */
  function drawReticle(s, now2, w, h) {
    const sight = state.camera.startsWith('sight-') ? (state.camera === 'sight-ace' ? 0 : 1) : -1;
    ui.reticle.hidden = sight < 0;
    if (sight < 0) return;
    const f = state.fight, i = sight, j = 1 - sight;
    const vel = side => {
      const tr = f.tracks[side], a = sampleAt(tr, state.t, f.dt), b = sampleAt(tr, state.t + f.dt, f.dt);
      return [(b.p[0] - a.p[0]) / f.dt, (b.p[1] - a.p[1]) / f.dt, (b.p[2] - a.p[2]) / f.dt];
    };
    const me = { position: now2[i].p, velocity: vel(i), orientation: { x: now2[i].q.x, y: now2[i].q.y, z: now2[i].q.z, w: now2[i].q.w } };
    const him = { position: now2[j].p, velocity: vel(j) };
    const lp = leadPoint(me, him, gunOf({}));
    const o = f.origin;
    _m.set(lp[0] - o[0], lp[1] - o[1], lp[2] - o[2]).project(s.camera);
    const on = _m.z < 1;
    ui.lead.style.opacity = on ? '1' : '0';
    ui.lead.style.transform = `translate(${(_m.x * 0.5 + 0.5) * w}px, ${(-_m.y * 0.5 + 0.5) * h}px)`;
    const k = now2[i].k;
    ui.reticle.dataset.on = k.o ? 'shot' : k.z ? 'zone' : 'off';
    ui.reticleText.textContent = k.o ? `ON TARGET · ${k.sd} M` : k.z ? `KILL ZONE · ${k.sd} M` : `${k.sd} M`;
  }

  function showEnd(fight) {
    if (!ui.end.hidden) return;
    const [aceHits, youHits] = fight.hits;
    const who = whoOf;
    const b = ui.end.querySelector('b'), sp = ui.end.querySelector('span');
    if (fight.end?.why === 'shot down') {
      b.textContent = `${who(fight.end.winner)} wins at ${fight.end.t.toFixed(1)} s`;
    } else if (fight.end) {
      b.textContent = `${who(1 - fight.end.winner)} flew into the ground`;
    } else {
      b.textContent = `No kill in ${Math.round(fight.duration)} s`;
    }
    const e = fight.tracks.map(tr => Math.round(tr.at(-1).e));
    const shots = fight.shotTime.map(v => v.toFixed(1));
    sp.textContent = `Kill shots: the ace had ${shots[0]} s of them, the other ${shots[1]} s. Hits: ace ${aceHits}, other ${youHits}. Energy at the end: ace ${e[0]} m, other ${e[1]} m.`;
    // A Dip, Flip or Ninja says how it fared from all nine starts.
    const demo = state.demo, v = verdictOf(demo?.verdict);
    ui.end.dataset.verdict = v ?? '';
    if (v) sp.textContent = `${MOVE_NAMES[demo.kind] ?? demo.label}: worked from ${demo.verdict.works} of ${demo.verdict.of ?? 9} starts. ${demo.verdict.line} ${sp.textContent}`;
    ui.end.hidden = false;
  }

  /** Where both fighters were over the From-above window ending at `t`:
   *  its middle, from the fight's origin, and its size, metres. */
  function windowBounds(f, t) {
    const end = Math.max(t, Math.min(TOP_WINDOW, f.duration));
    const from = Math.max(0, end - TOP_WINDOW);
    const o = f.origin;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const tr of f.tracks) {
      const i0 = Math.max(0, Math.floor(from / f.dt)), i1 = Math.min(tr.length - 1, Math.ceil(end / f.dt));
      for (let i = i0; i <= i1; i++) {
        const q = tr[i].p;
        x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); z0 = Math.min(z0, q[2]); z1 = Math.max(z1, q[2]);
      }
    }
    return { cx: (x0 + x1) / 2 - o[0], cz: (z0 + z1) / 2 - o[2], ww: x1 - x0, wh: z1 - z0 };
  }

  function placeCamera(s, k, dt) {
    const o = state.fight.origin;
    const a = new THREE.Vector3(k[0].p[0] - o[0], k[0].p[1] - o[1], k[0].p[2] - o[2]);
    const b = new THREE.Vector3(k[1].p[0] - o[0], k[1].p[1] - o[1], k[1].p[2] - o[2]);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const span = a.distanceTo(b);
    let pos, look;
    if (state.camera.startsWith('sight-')) {
      // Through his gunsight: from his nose, looking down his guns.
      const i = state.camera === 'sight-ace' ? 0 : 1;
      const me = i === 0 ? a : b;
      _f.set(0, 0, -1).applyQuaternion(k[i].q);
      s.camera.position.copy(me).addScaledVector(_f, 3).add(_u.set(0, 1.2, 0).applyQuaternion(k[i].q));
      s.camera.up.set(0, 1, 0).applyQuaternion(k[i].q);
      s.camera.lookAt(_look.copy(s.camera.position).addScaledVector(_f, 100));
      s.camera.fov = 34; s.camera.updateProjectionMatrix();
      camPos = null; camLook = null;
      state.drawScale = 1;
      return;
    }
    if (s.camera.fov !== 50) { s.camera.fov = 50; s.camera.updateProjectionMatrix(); }
    s.camera.up.set(0, 1, 0);
    if (state.camera === 'ace' || state.camera === 'you') {
      const i = state.camera === 'ace' ? 0 : 1;
      const me = i === 0 ? a : b, other = i === 0 ? b : a;
      _f.set(0, 0, -1).applyQuaternion(k[i].q);
      // Back by the plane's size: 38 m behind a Spitfire's 11 m span, twice
      // that behind a Ju 88. The look leans toward the other plane, less the
      // further off he is, so the plane you ride behind stays in the picture.
      const size = Math.min(2.5, Math.max(1, (s.actors[i]?.span ?? 11) / 11));
      pos = me.clone().addScaledVector(_f, -38 * size).add(_u.set(0, 9 * size, 0));
      look = me.clone().addScaledVector(_f, 60).lerp(other, 0.35 * Math.min(1, 150 / Math.max(1, me.distanceTo(other))));
    } else if (state.camera === 'top') {
      // Straight down as a flat map, the start's heading up the screen,
      // framed on the last TOP_WINDOW seconds of the fight (the first ones at
      // the start), so the move being flown fills the picture, in the part
      // of it the meters (top) and the captions (bottom) leave clear. The
      // frame eases along as the fight plays and jumps with a seek.
      const f = state.fight;
      if (!f.bounds) {
        let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y1 = -Infinity;
        for (const tr of f.tracks) for (const q of tr) {
          x0 = Math.min(x0, q.p[0]); x1 = Math.max(x1, q.p[0]); z0 = Math.min(z0, q.p[2]); z1 = Math.max(z1, q.p[2]); y1 = Math.max(y1, q.p[1]);
        }
        // The map's turn is the whole fight's, so it never flips mid-fight.
        f.bounds = { w: x1 - x0, h: z1 - z0, top: y1 - o[1] };
      }
      const B = { ...f.bounds, ...windowBounds(f, state.t) };
      const W = ui.canvas.clientWidth || 600, H = ui.canvas.clientHeight || 400;
      const cr = ui.canvas.getBoundingClientRect();
      const meters = ui.meters[0]?.parentElement?.getBoundingClientRect();
      const caps = ui.caps[0]?.closest('.dfs-captions')?.getBoundingClientRect();
      const top = meters?.height ? Math.min(H * 0.4, meters.bottom - cr.top + 10) : 20;
      const bottom = caps?.height ? Math.min(H * 0.4, cr.bottom - caps.top + 10) : 20;
      const usable = Math.max(60, H - top - bottom);
      // A fight long along its heading lies across a wide picture: the map
      // turned a quarter, the start's heading to the right.
      const across = f.bounds.h > f.bounds.w * 1.2 && W > usable * 1.2;
      const long = across ? B.ww : B.wh, wide = across ? B.wh : B.ww;
      const want = { cx: B.cx, cz: B.cz,
                     scale: Math.max(long / usable, wide / Math.max(60, W - 40), 0.4) * 1.15 * state.orbit.zoom };
      // Eased along in play; a seek, a new fight or a new size snaps.
      const tv = state.topView;
      if (!tv || tv.fight !== f || Math.abs(state.t - tv.t) > 1) {
        state.topView = { fight: f, t: state.t, ...want };
      } else {
        const e = 1 - Math.exp(-dt * 2.5);
        tv.cx += (want.cx - tv.cx) * e; tv.cz += (want.cz - tv.cz) * e; tv.scale += (want.scale - tv.scale) * e;
        tv.t = state.t;
      }
      const { cx, cz, scale } = state.topView;
      B.cx = cx; B.cz = cz;
      const shift = (top + usable / 2 - H / 2) * scale;
      const cam = s.ortho;
      cam.left = -W / 2 * scale; cam.right = W / 2 * scale; cam.top = H / 2 * scale; cam.bottom = -H / 2 * scale;
      cam.updateProjectionMatrix();
      // Screen up is -z (heading 0 up the screen), or -x turned a quarter
      // (heading 0, -z, then runs to the right, so time reads left to
      // right); the frame is moved so the fight sits between the meters and
      // the captions.
      if (across) {
        cam.up.set(-1, 0, 0);
        cam.position.set(B.cx - shift, B.top + 1500, B.cz);
        cam.lookAt(B.cx - shift, 0, B.cz);
      } else {
        cam.up.set(0, 0, -1);
        cam.position.set(B.cx, B.top + 1500, B.cz - shift);
        cam.lookAt(B.cx, 0, B.cz - shift);
      }
      cam.updateMatrixWorld();
      // A fighter drawn about 16 pixels long, whatever the fight's size.
      state.drawScale = Math.max(1, Math.min(6, 16 * scale / 11));
      camPos = null; camLook = null;
      return;
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

  // --- fights from the recordings ------------------------------------------------
  /** The index of recorded fights, once fetched: null before, [] when absent. */
  let recorded = null;
  /** Which recorded fights the list shows: the dogfights, or every one. */
  let recordedFilter = 'dogfights';
  /** How the list groups them: by day, by round, or by pilot (a leaderboard,
   *  then one pilot's fights). */
  let recordedGroup = 'day';
  let recordedPilot = null;
  const recordedBase = String(recordings).replace(/[^/]*$/, '');
  const titleCase = s => String(s ?? '').replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  async function loadRecorded() {
    if (recorded) return recorded;
    try {
      const res = await fetch(recordings);
      recorded = res.ok ? await res.json() : [];
    } catch {
      recorded = [];
    }
    drawRecorded();
    return recorded;
  }

  /** The recorded fights in the list, grouped by day, by round or by
   *  pilot, best first in each group. */
  function drawRecorded() {
    const box = ui.lessons.querySelector('.dfs-recs');
    if (!box) return;
    const kindRows = (recorded ?? []).filter(r => recordedFilter === 'all' || r.kind === 'dogfight');
    const named = r => r.sides.some(s => (decodePlayerName(s.name ?? '') || 'pilot') === recordedPilot);
    const rows = recordedGroup === 'pilot' && recordedPilot ? kindRows.filter(named) : kindRows;
    // Both pilots shooting first, then the kills, then the longest.
    const score = r => (r.mutual ? 1000 : 0) + (r.kill ? 100 : 0) + r.duration;
    const fightItem = r => {
      const line = fightLine(r);
      return `<li><button type="button" data-recorded="${esc(r.id)}"${r.mutual ? ' data-mutual="1"' : ''}${r.kill ? ' data-kill="1"' : ''}>`
        + `<b>${esc(line.title)}</b><small>${esc(line.sub)}</small></button></li>`;
    };
    const groupBy = (list, key) => {
      const m = new Map();
      for (const r of list) { const k = key(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
      return m;
    };
    const roundHead = r0 => `<li class="dfs-recs-round"><span>${esc(titleCase(r0.level))}</span><small>${esc(r0.recorded ?? '')} · ${esc(r0.mod ?? '')}</small></li>`;
    const byRound = list => [...groupBy(list, r => r.slug).values()]
      .map(l => roundHead(l[0]) + [...l].sort((a, b) => score(b) - score(a)).map(fightItem).join('')).join('');
    let html = '';
    let count = '';
    if (recordedGroup === 'pilot' && !recordedPilot) {
      // The leaderboard: who shot down the most, and lost the fewest.
      const table = pilotTable(kindRows);
      count = `${table.length} pilots`;
      html = table.map((p, i) => `<li><button type="button" data-pilot="${esc(p.name)}" class="dfs-recs-pilot">`
        + `<b><i>${i + 1}</i>${esc(p.name)}<em>${p.won}-${p.lost}</em></b>`
        + `<small>${p.fights} fight${p.fights === 1 ? '' : 's'} in ${p.rounds} round${p.rounds === 1 ? '' : 's'}`
        + `${p.mutual ? ` · ${p.mutualWon} of ${p.mutual} both-shooting won` : ''} · ${esc(p.planes.slice(0, 3).map(x => x.plane).join(', '))}</small></button></li>`).join('');
    } else if (recordedGroup === 'pilot') {
      const p = pilotTable(kindRows).find(x => x.name === recordedPilot);
      count = p ? `${p.won} won, ${p.lost} lost of ${p.fights}` : '';
      html = `<li class="dfs-recs-who"><button type="button" class="dfs-chip" data-pilot="">All pilots</button><span>${esc(recordedPilot)}</span></li>` + byRound(rows);
    } else if (recordedGroup === 'day') {
      const days = groupBy(rows, r => r.recorded ?? 'unknown day');
      count = `${rows.length} fight${rows.length === 1 ? '' : 's'} on ${days.size} day${days.size === 1 ? '' : 's'}`;
      html = [...days.entries()].sort((a, b) => b[0].localeCompare(a[0]))
        .map(([day, list]) => `<li class="dfs-recs-day"><span>${esc(day)}</span><small>${list.length} fight${list.length === 1 ? '' : 's'}</small></li>` + byRound(list)).join('');
    } else {
      const rounds = groupBy(rows, r => r.slug);
      count = `${rows.length} fight${rows.length === 1 ? '' : 's'} in ${rounds.size} round${rounds.size === 1 ? '' : 's'}`;
      html = byRound(rows);
    }
    box.querySelector('.dfs-recs-count').textContent = recorded === null ? 'loading' : count;
    box.querySelector('ol').innerHTML = html;
    box.querySelectorAll('button[data-filter]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.filter === recordedFilter)));
    box.querySelectorAll('button[data-group]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.group === recordedGroup)));
  }

  /** Play one recorded fight. */
  /** The theatre's own derived fields on a fight, as `fly` makes them. */
  function prepare(fight) {
    const spansOf = (track, key, gap = 0.25) => {
      const spans = [];
      for (const k of track) {
        const last = spans.at(-1);
        if (!k[key]) continue;
        if (last && k.t - last[1] < gap) last[1] = k.t; else spans.push([k.t, k.t]);
      }
      return spans;
    };
    fight.bursts = fight.tracks.map(track => spansOf(track, 'f', 0.15));
    for (const track of fight.tracks) for (const k of track) k.ko = !!(k.o && k.f);
    fight.shots = fight.tracks.map(track => spansOf(track, 'ko'));
    fight.shotTime = fight.shots.map(spans => spans.reduce((n, [a, b]) => n + (b - a) + fight.dt, 0));
    return fight;
  }

  async function pickRecorded(id) {
    const row = (recorded ?? []).find(r => r.id === id);
    let raw;
    try {
      const res = await fetch(`${recordedBase}${id}.json`);
      if (!res.ok) throw new Error(String(res.status));
      raw = await res.json();
    } catch (e) {
      console.warn('dogfight recording', id, e);
      return;
    }
    const fight = prepare(recordedFight(raw));
    state.recording = { fight, row, id, airframes: null };
    if (ui.lessons.dataset.show !== 'recordings') showSection('recordings');
    ui.lessons.querySelectorAll('button').forEach(b => b.setAttribute('aria-current', String(b.dataset.recorded === id)));
    showRecorded(fight, row);
  }

  /** Put a recorded fight (or one spliced from it, `fight.whatIf`) on stage. */
  function showRecorded(fight, row, { at = 0 } = {}) {
    state.lesson = null;
    state.demo = null;
    ui.demos.innerHTML = '';
    ui.survival.hidden = true;
    ui.flyRow.hidden = true;
    ui.stage.classList.remove('is-empty');
    state.fight = fight;
    state.orbit.az = sideOn(fight);
    state.t = at;
    state.explained = new Set(); state.hold = 0; ui.shot.hidden = true;
    state.playing = true;
    ui.toggle.textContent = 'Pause';
    buildActors(fight);
    setNames();
    state.planLabels = [...fight.planes];
    setMoves(fight);
    const m = fight.meta;
    const wi = fight.whatIf;
    ui.tcKicker.textContent = wi ? `WHAT IF · FROM ${wi.t.toFixed(1)} S` : `${titleCase(m.level).toUpperCase()} · ${m.recorded ?? ''} · FROM A RECORDING`;
    ui.tcTitle.textContent = wi ? `${fight.names[wi.side]}: ${wi.label}` : `${fight.names[0]} v ${fight.names[1]}`;
    ui.tcNote.textContent = wi ? wi.note : recordedSummary(fight);
    ui.tc.classList.add('is-shown');
    clearTimeout(pickDemo.timer);
    pickDemo.timer = setTimeout(() => ui.tc.classList.remove('is-shown'), 4200);
    ui.end.hidden = true;
    ui.storyHeads[0].textContent = 'THE FIGHT';
    ui.storyHeads[1].textContent = 'THE NUMBERS';
    const story = recordedStory(fight, row);
    if (wi) story.unshift(`What if: up to ${wi.t.toFixed(1)} s this is the recording; from there ${fight.names[wi.side]} flies "${wi.label}" instead, on the flight law, and ${fight.names[1 - wi.side]} stays after him at full throttle, nose on the lead, firing inside 400 m. ${wi.note}`);
    ui.move.innerHTML = story.map(p => `<p>${esc(p)}</p>`).join('');
    ui.counter.innerHTML = recordedNumbers(fight).map(p => `<p>${esc(p)}</p>`).join('');
    ui.whatif.hidden = false;
    ui.whatif.querySelector('[data-whatif="back"]').hidden = !wi;
    if (!wi) ui.whatif.querySelector('ol').innerHTML = '';
    state.whatIfShown = null;
    drawChart();
  }

  // --- what if: his other ways out ------------------------------------------------
  /** Both sides' airframe builders for the recording: its own types where
   *  the page can build them, else the battle's fighter. */
  async function airframes() {
    const rec = state.recording;
    if (!rec) return null;
    rec.airframes ??= Promise.all([0, 1].map(async s => {
      try {
        const make = makePlaneFor ? await makePlaneFor(rec.fight.templates[s], rec.fight.meta?.mod) : null;
        return make ?? (() => makePlane());
      } catch {
        return () => makePlane();
      }
    }));
    return rec.airframes;
  }

  /** The head line: who is chased now, if anyone, and whether to fly it. */
  function drawWhatIfHead() {
    const rec = state.recording;
    if (!rec || !state.fight?.recorded || ui.whatif.hidden) return;
    const base = rec.fight;
    const t = state.fight.whatIf ? Math.min(state.t, state.fight.whatIf.t) : state.t;
    const side = chasedAt(base, Math.min(t, base.duration));
    const key = `${side}:${Math.round(t * 10)}:${!!state.fight.whatIf}`;
    if (state.whatIfShown === key) return;
    state.whatIfShown = key;
    const span = ui.whatif.querySelector('.dfs-whatif-head span');
    const run = ui.whatif.querySelector('[data-whatif="run"]');
    if (state.fight.whatIf) {
      span.textContent = `${state.fight.names[state.fight.whatIf.side]} flies "${state.fight.whatIf.label}" from ${state.fight.whatIf.t.toFixed(1)} s.`;
      run.hidden = true;
      return;
    }
    run.hidden = side === null;
    span.textContent = side === null
      ? 'Pause where a pilot is in the other\'s sights to fly his other ways out from there.'
      : `${base.names[side]} is in ${base.names[1 - side]}'s sights at ${t.toFixed(1)} s.`;
    run.dataset.side = side ?? '';
    run.dataset.t = String(t);
  }

  /** Fly every way out from now, and list them, best first. */
  async function runWhatIf(side, t) {
    const rec = state.recording;
    if (!rec) return;
    const list = ui.whatif.querySelector('ol');
    list.innerHTML = '<li class="dfs-whatif-busy">Flying them on the flight law…</li>';
    state.playing = false;
    ui.toggle.textContent = 'Play';
    const makers = await airframes();
    const w = await whatIf(rec.fight, side, t, { makePlanes: makers, yieldTo: () => new Promise(r => setTimeout(r, 0)) });
    rec.whatIf = w;
    const words = s => [
      `in his line of fire ${s.exposed.toFixed(1)} s`,
      `his shot on you ${s.hisShot.toFixed(1)} s`,
      `${s.hits} hit${s.hits === 1 ? '' : 's'}`,
      ...(s.myShot ? [`your guns on him ${s.myShot.toFixed(1)} s`] : []),
      ...(s.shotDown ? ['shot down'] : s.crashed ? ['into the ground'] : []),
    ].join(' · ');
    list.innerHTML = `<li class="dfs-whatif-actual"><b>What he did</b><small>${esc(words(w.actual))}</small></li>`
      + w.results.map((r, i) => (r.score
        ? `<li><button type="button" data-way="${i}"><b>${esc(r.way.name)}</b><small>${esc(words(r.score))}</small></button></li>`
        : `<li class="dfs-whatif-actual"><b>${esc(r.way.name)}</b><small>could not be flown</small></li>`)).join('');
  }

  /** Play one way out as the recording's continuation. */
  function playWay(i) {
    const rec = state.recording, w = rec?.whatIf;
    const r = w?.results[i];
    if (!r?.flown) return;
    const s = r.score;
    const note = `Over the next 8 s: in his line of fire ${s.exposed.toFixed(1)} s (${w.actual.exposed.toFixed(1)} s in the recording), `
      + `his shot on you ${s.hisShot.toFixed(1)} s (${w.actual.hisShot.toFixed(1)} s), ${s.hits} hit${s.hits === 1 ? '' : 's'}.`;
    const spliced = prepare(spliceFight(rec.fight, w.i0, r.flown, r.way.name));
    spliced.whatIf = { ...spliced.whatIf, side: w.side, note };
    spliced.meta = rec.fight.meta;
    showRecorded(spliced, rec.row, { at: Math.max(0, w.t - 2) });
    ui.whatif.querySelectorAll('button[data-way]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.way === i)));
  }

  /** One sentence for the title card: what kind of fight, and its end. */
  function recordedSummary(fight) {
    const m = fight.meta, [a, b] = fight.names;
    const kind = m.mutual ? 'Both shooting' : m.kind === 'dogfight' ? 'A turning fight' : `${a} bounces ${b}`;
    const end = fight.end ? `${fight.names[fight.end.winner]} shoots ${fight.names[1 - fight.end.winner]} down at ${fight.end.t.toFixed(1)} s.` : 'Nobody is shot down.';
    return `${kind}, ${Math.round(fight.duration)} s, as close as ${m.closest} m. ${end}`;
  }

  /** Seconds a side spends on the other's tail, and with a shot that would land. */
  function timeIn(fight, side, test) {
    return fight.tracks[side].reduce((n, k) => n + (test(k) ? fight.dt : 0), 0);
  }

  function recordedStory(fight, row) {
    const m = fight.meta, [a, b] = fight.names, [pa, pb] = fight.planes;
    const lines = [
      `${a} in a ${pa} against ${b} in a ${pb}, on ${titleCase(m.level)} (${m.mod}), recorded ${m.recorded ?? 'on an unknown day'}`
        + `${m.server ? ` on ${m.server}` : ''}, ${Math.round(m.t0 / 60)} min into the round.`,
      recordedSummary(fight),
    ];
    if (fight.end) {
      const w = fight.end.winner;
      // A plane's own guns are named for the plane: say the guns.
      const weapon = m.kill?.weapon && m.kill.weapon !== fight.planes[w].replace(/ /g, '_') && m.kill.weapon !== fight.planes[w] ? ` with ${m.kill.weapon}` : ` with the ${fight.planes[w]}'s guns`;
      lines.push(`The kill: ${fight.names[w]}${weapon}. The recording proves ${m.proven[w]} hit${m.proven[w] === 1 ? '' : 's'} of his before it.`);
    }
    lines.push('Every move here is what the two players flew: the paths, the shots and the kill are the recording\'s, '
      + 'and the words are the school\'s reading of where each one was.');
    return lines;
  }

  function recordedNumbers(fight) {
    const m = fight.meta;
    return [0, 1].map(s => {
      const tail = timeIn(fight, s, k => k.ph === 'offensive');
      const chased = timeIn(fight, s, k => k.ph === 'defensive');
      const k0 = fight.tracks[s][0], k1 = fight.tracks[s].at(-1);
      return `${fight.names[s]} (${fight.planes[s]}): on his tail ${tail.toFixed(1)} s, chased ${chased.toFixed(1)} s; `
        + `${m.aimed[s]} aimed rounds, ${fight.shotTime[s].toFixed(1)} s with a shot that would land, `
        + `${m.proven[s]} hits the recording proves; turned through ${m.turned[s]} degrees; `
        + `${Math.round(k0.v)} to ${Math.round(k1.v)} m/s, ${Math.round(k0.p[1])} to ${Math.round(k1.p[1])} m up.`;
    });
  }

  /** Show one part of the list: the lessons, the ring courses or the
   *  recorded fights, so the recordings are not 8 lessons and 6 courses down. */
  function showSection(section) {
    ui.lessons.dataset.show = section;
    ui.sections.querySelectorAll('button[data-section]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.section === section)));
    ui.lessons.scrollTop = 0;
  }

  // --- input ------------------------------------------------------------------------
  ui.lessons.innerHTML = LESSONS.map((l, i) => `
    <li data-section="lessons"><button type="button" data-lesson="${l.id}"><span class="dfs-n">${String(i + 1).padStart(2, '0')}</span>
      <b>${esc(l.title)}</b><small>${esc(l.tagline)}</small>${l.survival ? `<em class="dfs-surv" data-verdict="${esc(l.survival.verdict)}">${l.survival.verdict === 'yes' ? 'Survivable' : l.survival.verdict === 'partly' ? 'Sometimes survivable' : 'No way out'}</em>` : ''}</button></li>`).join('')
    // The ring courses: stick and rudder, nobody shooting. Each flies
    // straight away.
    + (onFlyCourse ? `<li class="dfs-group" data-section="courses"><span>RING COURSES</span><small>Fly through the rings against the clock</small></li>`
      + COURSES.map((c, i) => `
    <li data-section="courses"><button type="button" data-course="${c.id}"><span class="dfs-n">R${i + 1}</span>
      <b>${esc(c.title)}</b><small>${esc(c.tagline)}</small></button></li>`).join('') : '')
    // Real fights out of the round recordings.
    + `<li class="dfs-group" data-section="recordings"><span>FROM THE RECORDINGS</span><small>Dogfights real players flew, found in the round recordings</small></li>
    <li class="dfs-recs" data-section="recordings"><div class="dfs-recs-bar"><button type="button" class="dfs-chip" data-filter="dogfights">Dogfights</button>`
    + `<button type="button" class="dfs-chip" data-filter="all">Every attack</button></div>`
    + `<div class="dfs-recs-bar"><button type="button" class="dfs-chip" data-group="day">By day</button>`
    + `<button type="button" class="dfs-chip" data-group="round">By round</button><button type="button" class="dfs-chip" data-group="pilot">By pilot</button>`
    + `<small class="dfs-recs-count">loading</small></div><ol role="list"></ol></li>`;
  ui.sections.addEventListener('click', e => {
    const b = e.target.closest('button[data-section]');
    if (b) showSection(b.dataset.section);
  });
  // No ring courses on this page: no tab for them.
  if (!onFlyCourse) ui.sections.querySelector('[data-section="courses"]')?.remove();
  showSection('lessons');
  ui.lessons.addEventListener('click', e => {
    const f = e.target.closest('button[data-filter]');
    if (f) { recordedFilter = f.dataset.filter; drawRecorded(); return; }
    const g = e.target.closest('button[data-group]');
    if (g) { recordedGroup = g.dataset.group; recordedPilot = null; drawRecorded(); return; }
    const who = e.target.closest('button[data-pilot]');
    if (who) { recordedPilot = who.dataset.pilot || null; drawRecorded(); ui.lessons.querySelector('.dfs-recs')?.scrollIntoView({ block: 'start' }); return; }
    const r = e.target.closest('button[data-recorded]');
    if (r) { pickRecorded(r.dataset.recorded); return; }
    const c = e.target.closest('button[data-course]');
    if (c && onFlyCourse) { close(false); onFlyCourse(c.dataset.course); return; }
    const b = e.target.closest('button[data-lesson]');
    if (b) pickLesson(b.dataset.lesson);
  });
  ui.whatif.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.whatif === 'run' && b.dataset.side !== '') { runWhatIf(+b.dataset.side, +b.dataset.t); return; }
    if (b.dataset.whatif === 'back' && state.recording) {
      const keep = ui.whatif.querySelector('ol').innerHTML;
      showRecorded(state.recording.fight, state.recording.row, { at: Math.max(0, (state.recording.whatIf?.t ?? 2) - 2) });
      ui.whatif.querySelector('ol').innerHTML = keep;
      return;
    }
    if (b.dataset.way !== undefined) playWay(+b.dataset.way);
  });
  ui.moves.addEventListener('click', e => {
    const b = e.target.closest('button[data-seek]');
    if (!b || !state.fight) return;
    state.t = Math.max(0, +b.dataset.seek - 1);
    state.playing = true;
    ui.toggle.textContent = 'Pause';
    ui.end.hidden = true;
    state.hold = 0; ui.shot.hidden = true;
    for (const key of [...state.explained]) if (+key.split(':')[1] > state.t) state.explained.delete(key);
  });
  ui.demos.addEventListener('click', e => {
    const b = e.target.closest('button[data-demo]');
    if (b && state.lesson) pickDemo(state.lesson, b.dataset.demo);
  });
  ui.speeds.innerHTML = SPEEDS.map(v => `<button type="button" class="dfs-chip" data-speed="${v}">${v}x</button>`).join('')
    + '<button type="button" class="dfs-chip" data-slow="1" title="Slow the replay while the guns fire">Slow on shots</button>'
    + '<button type="button" class="dfs-chip" data-explain="1" title="Stop on every new kill shot and say how it came">Explain shots</button>';
  ui.cams.innerHTML = CAMERAS.map(c => `<button type="button" class="dfs-chip" data-cam="${c.id}">${c.label}</button>`).join('');
  const markChips = () => {
    ui.speeds.querySelectorAll('button[data-speed]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.speed === state.speed)));
    ui.speeds.querySelector('[data-slow]')?.setAttribute('aria-pressed', String(state.slowOnShots));
    ui.speeds.querySelector('[data-explain]')?.setAttribute('aria-pressed', String(state.explain));
    ui.cams.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.cam === state.camera)));
  };
  ui.speeds.addEventListener('click', e => {
    if (e.target.closest('button[data-slow]')) { state.slowOnShots = !state.slowOnShots; markChips(); return; }
    if (e.target.closest('button[data-explain]')) { state.explain = !state.explain; state.hold = 0; ui.shot.hidden = true; markChips(); return; }
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
  const rewind = () => { state.explained = new Set(); state.hold = 0; ui.shot.hidden = true; };
  ui.restart.addEventListener('click', () => { state.t = 0; state.playing = true; ui.toggle.textContent = 'Pause'; ui.end.hidden = true; rewind(); });
  ui.scrub.addEventListener('input', () => {
    if (!state.fight) return;
    state.t = +ui.scrub.value / 1000 * state.fight.duration;
    ui.end.hidden = true;
    // A scrub back lets the shots it passes be explained again.
    for (const key of [...state.explained]) if (+key.split(':')[1] > state.t) state.explained.delete(key);
    state.hold = 0; ui.shot.hidden = true;
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

  /** The planes you can fly, the chosen one pressed. */
  function drawPlanes() {
    const list = onPlane ? planes() : [];
    ui.planeBox.hidden = list.length < 2;
    const chosen = plane();
    ui.planeList.innerHTML = list.map(p => `<button type="button" class="dfs-chip${p.fighter ? '' : ' is-other'}" role="radio"
      data-plane="${esc(p.template)}" aria-checked="${p.template === chosen}">${esc(p.name)}</button>`).join('');
  }
  ui.planeList.addEventListener('click', e => {
    const b = e.target.closest('button[data-plane]');
    if (!b || !onPlane) return;
    onPlane(b.dataset.plane);
    drawPlanes();
  });

  function open(lessonId = null) {
    if (state.open) return;
    state.open = true;
    root.hidden = false;
    drawPlanes();
    state.rule = (state.rule + 1) % RULES.length;
    ui.rule.textContent = RULES[state.rule];
    if (lessonId || !state.fight?.recorded) pickLesson(lessonId ?? state.lesson?.id ?? LESSONS[0].id);
    loadRecorded();
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
        fight: f ? { duration: f.duration, end: f.end, hits: f.hits, rounds: f.rounds.length, events: f.events.length, bursts: f.bursts } : null,
        guns: ui.guns.map(g => (g.classList.contains('is-on') ? g.textContent : null)),
        shots: f ? f.shots : null, shotTime: f ? f.shotTime : null, hold: state.hold,
        shotCard: ui.shot.hidden ? null : ui.shot.textContent,
        intents: ui.intents.map(x => x.textContent), reticle: ui.reticle.hidden ? null : ui.reticleText.textContent,
        captions: ui.caps.map(c => c.textContent), end: ui.end.hidden ? null : ui.end.textContent,
      };
    },
    seek(t) { state.t = t; state.hold = 0; ui.shot.hidden = true; },
    /** WHAT IF from `t` for the chased side, and play way `i` (tests). */
    whatIf: async (t, i = null) => {
      const side = state.recording ? chasedAt(state.recording.fight, t) : null;
      if (side === null) return null;
      await runWhatIf(side, t);
      if (i !== null) playWay(i);
      const w = state.recording.whatIf;
      const probe = r => r.flown && [0, 1].map(k => r.flown.tracks[k].filter((_, j) => j % 15 === 0).map(x => [Math.round(x.v), x.so, x.sd, x.ph, x.f ? 'F' : '']));
      return { side, actual: w.actual, results: w.results.map(r => ({ name: r.way.name, score: r.score ?? null, error: r.error ?? null, probe: probe(r) })) };
    },
    /** Play a recorded fight by its id (`dogfights/index.json`). */
    playRecorded: id => loadRecorded().then(() => pickRecorded(id)),
    get recorded() { return recorded; },
    /** For the tests: what each drawn fighter is made of. */
    planes() {
      return (gl?.actors ?? []).map(a => {
        let meshes = 0, shown = 0;
        a.plane.traverse(o => { if (o.isMesh) { meshes++; let v = true; for (let n = o; n; n = n.parent) if (!n.visible) v = false; if (v) shown++; } });
        const box = new THREE.Box3().setFromObject(a.plane, true);
        // The visible meshes alone, and where their middle sits off the
        // plane's own point (a model drawn away from its path shows here).
        const seen = new THREE.Box3();
        a.plane.updateMatrixWorld(true);
        a.plane.traverse(o => { if (o.isMesh) { let v = true; for (let n = o; n; n = n.parent) if (!n.visible) v = false; if (v) seen.expandByObject(o, true); } });
        const off = seen.isEmpty() ? null : seen.getCenter(new THREE.Vector3()).sub(a.plane.position).toArray().map(v => +v.toFixed(1));
        return { meshes, shown, size: box.getSize(new THREE.Vector3()).toArray().map(v => +v.toFixed(1)), scale: a.plane.scale.x,
                 seenSize: seen.isEmpty() ? null : seen.getSize(new THREE.Vector3()).toArray().map(v => +v.toFixed(1)), off,
                 tops: a.plane.children.map(c => [c.name, c.visible, c.position.toArray().map(v => Math.round(v))]).slice(0, 6),
                 // The propeller (disc or blades, and how far round) and the
                 // tracer streaks in the air, own mesh or stand-in.
                 props: a.props.map(p => ({ disc: p.blurred.visible, angle: Math.round(p.blurredAngle + p.staticAngle), revs: p.revs })),
                 tracers: a.streaks.filter(m => m.visible).length, ownTracer: !!a.look.template,
                 tracerRounds: [...(gl.tracerSet ?? [])].filter(r => r.side === gl.actors.indexOf(a)).length };
      });
    },
    flown: (lessonId, demoId) => {
      const l = lessonById(lessonId);
      const d = l?.demos.find(x => x.id === demoId);
      return l && d ? fly(l, d) : null;
    },
  };
}
