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
import { recordedFight, fightLine, pilotTable, inThirdPerson } from './dogfight-recorded.js';
import { VIEWER_ROOT } from './viewer-root.js';
import { decodePlayerName } from './vehicle-players.js';
import { nameManoeuvres, primaryAt, MANOEUVRES } from './dogfight-manoeuvres.js';
import { MOVE_INFO, stepsOf, stepTimes, bestMove, moveLabel } from './dogfight-steps.js';
import { whatIf, chasedAt, spliceFight } from './dogfight-whatif.js';
import { deadlockSpans, deadlockIn, extendFrom, momentOf, trackState, resultWords, RESULT_TAGS, KIND_WORDS } from './dogfight-deadlock.js';
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
/** On its map, the way the world arrives (features/dogfight-recordings,
 *  "The way in"): seconds of the map as a wire mesh sweeping in, of its
 *  paint sweeping over the mesh, of the two pilots appearing, and of the
 *  camera's glide down to the wide view. A click or a key skips it. */
const INTRO = { mesh: 1.8, paint: 1.8, spawn: 0.9, glide: 2.8 };
const INTRO_TOTAL = INTRO.mesh + INTRO.paint + INTRO.spawn + INTRO.glide;
/** A row of the list: text you can select and copy (a <button>'s cannot
 *  be), that acts as a button (click, Enter, Space). */
const ROW = '<div class="dfs-row" role="button" tabindex="0"';
/** The school's icons, drawn in its own line (no icon font on this page). */
const svg = (d, extra = '') => `<svg class="dfs-ico" viewBox="0 0 24 24" aria-hidden="true"${extra}>${d}</svg>`;
const ICON = {
  lessons: svg('<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 5.5h1.5v2M4 11h2l-2 2.5h2M4 17h2l-1 1 1 1H4" class="is-thin"/>'),
  rings: svg('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4"/><path d="M12 1.5v3M12 19.5v3"/>'),
  fights: svg('<path d="M2.5 18c5-1.5 5.5-11 10.5-10.5S17 15 21.5 5"/><path d="M2.5 9.5c4.5 1 7.5 9 11.5 6.5s4-7 7.5-4" class="is-alt"/>'),
  fold: svg('<path d="M14.5 6l-6 6 6 6"/><path d="M19.5 4v16" class="is-thin"/>'),
  caret: svg('<path d="M7 10l5 5 5-5"/>', ' data-caret'),
  cam: svg('<path d="M3 8.5h4l2-2.5h6l2 2.5h4V19H3z"/><circle cx="12" cy="13" r="3.2"/>'),
  notes: svg('<path d="M5.5 3.5h13v17h-13z"/><path d="M8.5 8h7M8.5 12h7M8.5 16h4.5" class="is-thin"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  restart: svg('<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 3.5v4h4"/>'),
};
/** The bfstats.io sigil, the site's own (the mesh pages' top bar wears it too). */
const LOGO = new URL('bfstats-logo.webp', VIEWER_ROOT).href;
/** A plane template as the arena list says it: `BF109` "Bf 109", `Yak9` "Yak 9". */
const prettyPlane = t => String(t ?? '').replace(/^BF(\d)/, 'Bf $1').replace(/([a-z])(\d)/g, '$1 $2').replace(/_/g, ' ');
/** The nearest the Wide camera comes to the point between the two, metres,
 *  however far the wheel zooms in. */
const WIDE_NEAREST = 6;
/** Seconds the map layer may take to load before the card says it did not. */
const MAP_PATIENCE = 180;
/** How far either side of the fight the sweeps run, metres. */
const INTRO_REACH = 2600;
const smooth01 = x => { const k = Math.min(1, Math.max(0, x)); return k * k * (3 - 2 * k); };
/** Seconds of the fight the From-above camera frames: the last ones. */
const TOP_WINDOW = 12;
/** Half the trail ribbon's width, metres, at true size: a thin tape, a
 *  tenth of a Spitfire's span, widened as the plane is drawn bigger than
 *  life (`drawScale`), so it stays the same share of the plane in every
 *  camera and never hides it. */
const TRAIL_HALF = 0.55;
/** Seconds of the trail nearest the plane that fade in from nothing: the
 *  plane's newest path never paints over the plane itself. */
const TRAIL_FADE = 1.2;
/** The ribbon's opacity where it is whole. */
const TRAIL_OPACITY = 0.8;
/** On its map the trail is a contrail off the tail, not a ribbon along the
 *  wings: this wide (half, metres), from this far behind the plane's middle,
 *  and only the last TRAIL_SECONDS of it, so the planes stay the picture. */
const MAP_TRAIL = { half: 0.3, back: 4.5, seconds: 8 };
const CAMERAS = [
  { id: 'wide', label: 'Wide' },
  { id: 'ace', label: 'Behind the ace' },
  { id: 'you', label: 'Behind you' },
  { id: 'sight-ace', label: 'Ace\'s gunsight' },
  { id: 'sight-you', label: 'Your gunsight' },
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
 *  survive it?"): what each is called on its tab, the pilot's name for it
 *  (`dogfight-steps.js`, "Move cards"). */
const MOVE_NAMES = Object.fromEntries(Object.entries(MOVE_INFO).map(([k, m]) => [k, m.name]));
/** A move's name with the school's nickname, as the notes say it. */
const moveFull = kind => `${MOVE_INFO[kind].name} (${MOVE_INFO[kind].nick})`;
/** What a lesson's survival verdict reads as. */
const SURVIVAL_WORDS = { yes: 'Yes', partly: 'Partly', no: 'No' };
/** What "worked" means for each move, as `tests/dogfight_dfn_measure.mjs`
 *  scores it, in plain words for the score card. */
const PASS_RULES = {
  dip: 'None of their rounds hit you, and you end the fight more than 900 m away, still pulling away.',
  flip: 'Within 20 s you go from chased to behind them with a shot that would hit for half a second, they never get a real shot back, and you stay on top.',
  ninja: 'You set up at least two separate attacks and land rounds, they never get a real shot or sit on your tail, and you keep the upper hand without circling.',
};
const VERDICT_WORDS = { works: 'works', partly: 'works sometimes', no: 'rarely works' };
/** The verdict as the move card heads it: a move that rarely works is
 *  shown so you can see why, not to be flown. */
const CARD_WORDS = { works: 'Works here', partly: 'Works sometimes here', no: 'Doesn\'t work here: watch why' };
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
 * called, `onFly(lessonId, moveDemoId)` puts the player in the air against
 * the lesson's ace, practising a Dip, Flip or Ninja when one is picked, `onFlyCourse(courseId)` starts a ring course (`dogfight-course.js`),
 * `onClose()` hands the page back its pointer. `planes()` lists the aircraft
 * you can fly (`{ template, name, fighter }`), `plane()` is the one chosen
 * and `onPlane(template)` chooses one. `recordings` is the index of the
 * dogfights found in round recordings (`extract_dogfights.mjs`,
 * features/dogfight-recordings), listed under FROM THE RECORDINGS; each
 * fight's file sits beside it. `planeVisualFor(template)` draws a recorded
 * pilot's own type when the battle has one, else null; `makePlaneFor(template,
 * mod)` resolves to a builder of that type's airframe (or null), which the
 * WHAT IF flights fly on (`dogfight-whatif.js`). `world` puts a recorded
 * fight on its own map (features/dogfight-recordings, "On its map, in the
 * school"): the replay page's `scene` (the level, the replayed planes and
 * their tracers), drawn by this theatre's cameras with its paths, rings and
 * gun lines over it. `drive(t, rate)` steps the replay to `t` seconds of the
 * clip, running at `rate` (this theatre's clock is the only one; its smoke,
 * fires and engines go by the rate), `look(camera)` hands the page the
 * camera it draws with (the level's sky, culling and ear follow it), and
 * `focus({ nids, pids })` leaves the two planes alone in the round, and
 * `health(nid)` reads a replayed plane's hit points (`{ hp, max }`). No grid,
 * no lessons, no WHAT IF there. `embed` is set when that page is the map
 * layer inside another school's window (its LAYERS card, below):
 * `leave(t, playing)` hands back to the schematic at `t`, `pick(id)` asks for
 * another fight.
 *
 * `arenas` (the school's own page, `dogfight.html`): `{ list(), current(),
 * pick(map) }`, the battles its lessons can be flown in (`dogfight-arena.js`),
 * chosen in the sidebar above YOUR PLANE.
 *
 * The LAYERS card in the stage's corner switches a recorded fight between
 * the schematic and its own map, the way a map site switches to satellite:
 * the map page loads hidden in this window, the schematic plays on, and when
 * the map is up it fades in and its way in plays, from the moment the
 * schematic was at.
 */
export function createDogfightTheatre({ host, makePlane, planeVisual = () => null, planeName = 'Spitfire',
                                        onFly = null, onFlyCourse = null, onClose = null, groundY = 0,
                                        planes = () => [], plane = () => null, onPlane = null,
                                        recordings = new URL('replays/dogfights/index.json', VIEWER_ROOT).href, planeVisualFor = () => null,
                                        makePlaneFor = null, world = null, embed = null, arenas = null }) {
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
      <nav class="dfs-rail" aria-label="School">
        <a class="dfs-brand-sigil" href="https://bfstats.io" target="_blank" rel="noopener" title="bfstats.io"><img src="${LOGO}" alt="bfstats.io" width="32" height="32"></a>
        <div class="dfs-sections" role="group" aria-label="School sections">
          <button type="button" class="dfs-rail-btn" data-section="lessons" title="Lessons (L)">${ICON.lessons}<span>Lessons</span></button>
          <button type="button" class="dfs-rail-btn" data-section="courses" title="Ring courses">${ICON.rings}<span>Rings</span></button>
          <button type="button" class="dfs-rail-btn" data-section="recordings" title="Recordings: fights real players flew">${ICON.fights}<span>Fights</span></button>
        </div>
        <button type="button" class="dfs-rail-btn dfs-list-toggle" aria-expanded="true" title="Hide the list (L)">${ICON.fold}<span>Hide</span></button>
      </nav>
      <div class="dfs-panel">
        <header class="dfs-brand">
          <div><a class="dfs-brand-site" href="https://bfstats.io" target="_blank" rel="noopener">bfstats.io</a><b>Dogfight school</b></div>
          <small>Moves, and their counters, flown on BF1942's own flight law</small>
        </header>
        <div class="dfs-arena" hidden><button type="button" class="dfs-arena-now" aria-expanded="false" title="Choose the arena"><span>ARENA</span><b></b><small></small>${ICON.caret}</button>
          <div class="dfs-arena-list" role="radiogroup" aria-label="Arena" hidden></div></div>
        <div class="dfs-plane" hidden><span>YOUR PLANE</span><div class="dfs-plane-list" role="radiogroup" aria-label="Your plane"></div></div>
        <ol class="dfs-lessons" role="list" data-show="lessons"></ol>
        <p class="dfs-rule"></p>
        <footer class="dfs-foot"><kbd>V</kbd> or <kbd>Esc</kbd> close · <kbd>L</kbd> list · <kbd>N</kbd> notes</footer>
      </div>
    </aside>
    <section class="dfs-main">
      <div class="dfs-stage">
        <canvas class="dfs-canvas"></canvas>
        <div class="dfs-tags"><span class="dfs-tag is-ace">ACE</span><span class="dfs-tag is-you">YOU</span>
          <span class="dfs-guns is-ace"></span><span class="dfs-guns is-you"></span></div>
        <div class="dfs-titlecard"><small class="dfs-tc-kicker"></small><b class="dfs-tc-title"></b><span class="dfs-tc-note"></span></div>
        <div class="dfs-meters">
          <div class="dfs-meter is-ace"><b>ACE</b><span class="dfs-m-plan"></span><em class="dfs-m-eye" hidden>Lost sight of them</em><dl>
            <dt>speed</dt><dd class="dfs-m-speed"></dd><dt>height</dt><dd class="dfs-m-height"></dd><dt>energy</dt><dd class="dfs-m-energy"></dd><dt class="dfs-m-hull-t" hidden>hull</dt><dd class="dfs-m-hull" hidden></dd></dl>
            <i class="dfs-bar"><i></i></i><em class="dfs-m-lost">OUT OF RANGE · PATH GUESSED</em></div>
          <div class="dfs-meter is-you"><b class="dfs-m-name">YOU</b><span class="dfs-m-plan"></span><em class="dfs-m-eye" hidden>Lost sight of them</em><dl>
            <dt>speed</dt><dd class="dfs-m-speed"></dd><dt>height</dt><dd class="dfs-m-height"></dd><dt>energy</dt><dd class="dfs-m-energy"></dd><dt class="dfs-m-hull-t" hidden>hull</dt><dd class="dfs-m-hull" hidden></dd></dl>
            <i class="dfs-bar"><i></i></i><em class="dfs-m-lost">OUT OF RANGE · PATH GUESSED</em></div>
        </div>
        <div class="dfs-captions">
          <p class="dfs-cap is-ace"><b>ACE</b><i class="dfs-intent"></i><span></span></p>
          <p class="dfs-cap is-you"><b>YOU</b><i class="dfs-intent"></i><span></span></p>
        </div>
        <div class="dfs-endcard" hidden><b></b><span></span><div class="dfs-end-acts"></div></div>
        <div class="dfs-helper" hidden data-step=""><small class="dfs-helper-kicker"></small><b class="dfs-helper-title"></b><span class="dfs-helper-words"></span><ol class="dfs-helper-ways"></ol><div class="dfs-helper-acts"></div></div>
        <button type="button" class="dfs-layer" hidden>
          <span class="dfs-layer-art"><img alt="" hidden>
            <svg class="dfs-layer-schematic" viewBox="0 0 96 72" aria-hidden="true"><path class="dfs-ls-grid" d="M0 18H96M0 36H96M0 54H96M24 0V72M48 0V72M72 0V72"/>
              <path class="dfs-ls-ace" d="M8 60C24 52 30 20 50 22S70 50 88 14"/><path class="dfs-ls-you" d="M10 40C26 44 36 62 54 52S74 20 86 30"/></svg>
            <i class="dfs-layer-scan"></i></span>
          <span class="dfs-layer-text"><small>LAYER</small><b></b><span></span></span>
        </button>
        <div class="dfs-shotcard" hidden><small></small><b></b><span class="dfs-shot-geo"></span><span class="dfs-shot-why"></span><span class="dfs-shot-other"></span></div>
        <div class="dfs-pins" aria-hidden="true"></div>
        <div class="dfs-score" hidden>
          <header class="dfs-card-head"><small class="dfs-card-name"></small><i class="dfs-card-best" hidden>Best answer here</i></header>
          <p class="dfs-card-what"></p>
          <ol class="dfs-steps"></ol>
          <p class="dfs-card-verdict"><b></b><span></span></p>
          <button type="button" class="dfs-score-how">How is this tested?</button></div>
        <div class="dfs-reticle" hidden><i class="dfs-ring"></i><i class="dfs-lead"></i><span></span></div>
      </div>
      <div class="dfs-timeline">
        <canvas class="dfs-chart" height="40"></canvas>
        <input class="dfs-scrub" type="range" min="0" max="1000" value="0" aria-label="Time in the fight" title="Drag along the fight: both pilots' energy, the shaded spans who had the kill shot, the ticks the hits">
      </div>
      <div class="dfs-bar-row">
        <div class="dfs-play">
          <button type="button" class="dfs-btn dfs-toggle" title="Space">Pause</button>
          <button type="button" class="dfs-btn dfs-restart" title="From the start" aria-label="Restart">${ICON.restart}</button>
          <span class="dfs-time"></span>
        </div>
        <div class="dfs-demos" role="tablist"></div>
        <div class="dfs-tools">
          <div class="dfs-menu"><button type="button" class="dfs-btn dfs-menu-btn" data-menu="speed" aria-haspopup="true" aria-expanded="false" title="Replay speed, slowing on shots, explaining shots"><span class="dfs-speed-now"></span>${ICON.caret}</button>
            <div class="dfs-pop" hidden><small>SPEED</small><span class="dfs-speeds"></span></div></div>
          <div class="dfs-menu"><button type="button" class="dfs-btn dfs-menu-btn" data-menu="cam" aria-haspopup="true" aria-expanded="false" title="Camera (keys 1 to 6)">${ICON.cam}<span class="dfs-cam-now"></span>${ICON.caret}</button>
            <div class="dfs-pop" hidden><small>CAMERA</small><span class="dfs-cams"></span></div></div>
          <button type="button" class="dfs-btn dfs-notes-btn" aria-expanded="false" title="The move, the counter and the numbers (N)">${ICON.notes}<span>Notes</span></button>
          <div class="dfs-flyrow"><button type="button" class="dfs-fly">Fly it yourself</button></div>
        </div>
      </div>
      <aside class="dfs-lower dfs-notes" aria-label="Notes" hidden>
        <header class="dfs-notes-head"><b>Notes</b><button type="button" class="dfs-btn dfs-notes-close" title="Close the notes (N)">${ICON.close}</button></header>
        <div class="dfs-extend" hidden><div class="dfs-extend-head"><small>WAYS OUT</small><span></span><span class="dfs-extend-acts"></span></div><ol></ol></div>
        <div class="dfs-whatif" hidden><div class="dfs-whatif-head"><small>WHAT IF</small><span></span><button type="button" class="dfs-chip" data-whatif="run">Fly their other ways out</button><button type="button" class="dfs-chip" data-whatif="back" hidden>Back to the recording</button></div><ol></ol></div>
        <div class="dfs-moves" hidden></div>
        <div class="dfs-watch" hidden><small>IN 3D</small><span>The fight on its own map, from the recording</span></div>
        <div class="dfs-survival" hidden><small>CAN YOU SURVIVE IT?</small><b></b><span></span></div>
        <div class="dfs-story">
          <div><h3 class="dfs-story-move">THE MOVE</h3><div class="dfs-move"></div></div>
          <div><h3 class="dfs-story-counter">THE COUNTER</h3><div class="dfs-counter"></div></div>
        </div>
        <p class="dfs-fly-note">You fly the green plane (YOU), in the air, against the ace flying this move. The coach tells you what they are doing and what beats it.</p>
        <div class="dfs-scoring" hidden><small>HOW THE SCORES ARE MEASURED</small>
          <p>Each extension, reversal and bounce (the school's Dip, Flip and Ninja) is flown 9 times on BF1942's flight law: from the start you watch, and from 8 others with the ace nudged up to 30 m left or right, 30 m nearer or further, 10 m higher or lower, and 3 m/s faster or slower. The badge on the tab, such as 7/9, is how many of the 9 the move did its job in.</p>
          <p>7 or more: it works. 3 to 6: it works sometimes. Under 3: it rarely works. A low score is not your chance of dying: the bounce asks for much more than staying alive.</p>
          <dl><dt>${moveFull('dip')}</dt><dd></dd><dt>${moveFull('flip')}</dt><dd></dd><dt>${moveFull('ninja')}</dt><dd></dd></dl>
          <p class="dfs-scoring-this"></p></div>
        <small class="dfs-legend"><span><i class="is-ace"></i><span class="is-ace-name">ace's energy</span></span><span><i class="is-you"></i><span class="is-you-name">your energy</span></span><span><i class="is-ace-shot"></i><span class="is-ace-shotname">ace has the shot</span></span><span><i class="is-you-shot"></i><span class="is-you-shotname">you have the shot</span></span><span><i class="is-hit"></i>hits</span></small>
      </aside>
    </section>`;
  (host?.ownerDocument?.body ?? document.body).appendChild(root);
  const q = sel => root.querySelector(sel);
  const ui = {
    planeBox: q('.dfs-plane'), planeList: q('.dfs-plane-list'), arenaBox: q('.dfs-arena'), arenaList: q('.dfs-arena-list'),
    layer: q('.dfs-layer'), layerImg: q('.dfs-layer-art img'), layerName: q('.dfs-layer-text b'), layerNote: q('.dfs-layer-text span'),
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
    survival: q('.dfs-survival'), score: q('.dfs-score'), steps: q('.dfs-steps'), pins: q('.dfs-pins'), scoring: q('.dfs-scoring'), moves: q('.dfs-moves'), whatif: q('.dfs-whatif'), extend: q('.dfs-extend'), watch: q('.dfs-watch'),
    end: q('.dfs-endcard'), helper: q('.dfs-helper'), demos: q('.dfs-demos'), toggle: q('.dfs-toggle'), restart: q('.dfs-restart'),
    speeds: q('.dfs-speeds'), cams: q('.dfs-cams'), chart: q('.dfs-chart'), scrub: q('.dfs-scrub'),
    move: q('.dfs-move'), counter: q('.dfs-counter'), fly: q('.dfs-fly'), flyNote: q('.dfs-fly-note'), flyRow: q('.dfs-flyrow'),
    arenaNow: q('.dfs-arena-now'), listToggle: q('.dfs-list-toggle'), notes: q('.dfs-notes'), notesBtn: q('.dfs-notes-btn'),
    time: q('.dfs-time'), speedNow: q('.dfs-speed-now'), camNow: q('.dfs-cam-now'), menus: [...root.querySelectorAll('.dfs-menu')],
  };

  const state = { open: false, lesson: null, demo: null, fight: null, moveShown: [null, null], planLabels: ["", ""], t: 0, playing: true, speed: 1, camera: 'wide', drawScale: 1, slowOnShots: true, explain: true, hold: 0, explained: new Set(),
                  orbit: { az: -0.9, el: 0.32, zoom: 1 }, rule: 0 };
  /** A side's name on screen: the pilot's own in a recorded fight. */
  const nameOf = i => (state.fight?.recorded ? state.fight.names[i] : i === 0 ? 'ACE' : 'YOU');
  /** A side as a sentence starts it. */
  const whoOf = i => (state.fight?.recorded ? state.fight.names[i] : i === 0 ? 'The ace' : 'You');
  /** A side mid-sentence: a recording's pilot by name, a lesson's as "the
   *  ace" or "the other pilot". */
  const partyOf = i => (state.fight?.recorded ? state.fight.names[i] : i === 0 ? 'the ace' : 'you');
  /** A pilot's caption about the two of them, both named (`inThirdPerson`). */
  const said3 = (text, i) => inThirdPerson(text, partyOf(i), partyOf(1 - i));
  /** Write the sides' names everywhere the picture carries them. */
  function setNames() {
    for (const i of [0, 1]) {
      const name = nameOf(i);
      ui.tags[i].textContent = name;
      ui.meters[i].querySelector('b').textContent = name;
      ui.capNames[i].textContent = name;
    }
    const rec = state.fight?.recorded;
    const label = { ace: rec ? `Behind ${nameOf(0)}` : 'Behind the ace', you: rec ? `Behind ${nameOf(1)}` : 'Behind you',
                    'sight-ace': rec ? `${nameOf(0)}'s gunsight` : 'Ace\'s gunsight', 'sight-you': rec ? `${nameOf(1)}'s gunsight` : 'Your gunsight' };
    ui.cams.querySelectorAll('button[data-cam]').forEach(b => { if (label[b.dataset.cam]) b.textContent = label[b.dataset.cam]; });
    ui.camNow.textContent = ui.cams.querySelector(`button[data-cam="${state.camera}"]`)?.textContent ?? '';
    ui.legendNames[0].textContent = `${rec ? nameOf(0) : 'ace'}'s energy`;
    ui.legendNames[1].textContent = rec ? `${nameOf(1)}'s energy` : 'your energy';
    ui.legendShots[0].textContent = `${rec ? nameOf(0) : 'ace'} has the shot`;
    ui.legendShots[1].textContent = rec ? `${nameOf(1)} has the shot` : 'you have the shot';
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
    const camera = new THREE.PerspectiveCamera(50, 1, 2, world ? 20000 : 9000);
    let floor = null, fine = null, coarse = null;
    if (!world) {
      scene.background = new THREE.Color(C.stage);
      scene.fog = new THREE.Fog(C.stage, 1600, 5200);
      scene.add(new THREE.HemisphereLight(0xffffff, 0x5a5a5a, 3.4));
      const sun = new THREE.DirectionalLight(0xffffff, 3.2);
      sun.position.set(-0.4, 1, 0.3);
      scene.add(sun);
      // The ground: a pale floor with a kilometre grid and a 100 m one.
      floor = new THREE.Mesh(new THREE.PlaneGeometry(12000, 12000),
        new THREE.MeshBasicMaterial({ color: C.floor }));
      floor.rotation.x = -Math.PI / 2;
      scene.add(floor);
      fine = new THREE.GridHelper(12000, 120, C.rule, C.rule);
      fine.position.y = 0.3;
      scene.add(fine);
      coarse = new THREE.GridHelper(12000, 12, C.ruleStrong, C.ruleStrong);
      coarse.position.y = 0.6;
      scene.add(coarse);
    }
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

  /** Lay an actor's trail ribbon out `half` metres either side of its path. */
  function shapeTrail(a, half) {
    if (Math.abs(a.half - half) < 0.02) return;
    a.half = half;
    const pos = a.trail.geometry.attributes.position, p = pos.array, m = a.mids, w = a.wings;
    for (let j = 0, n = m.length / 3; j < n; j++) {
      const x = m[j * 3], y = m[j * 3 + 1], z = m[j * 3 + 2], wx = w[j * 3] * half, wy = w[j * 3 + 1] * half, wz = w[j * 3 + 2] * half;
      p[j * 6] = x - wx; p[j * 6 + 1] = y - wy; p[j * 6 + 2] = z - wz;
      p[j * 6 + 3] = x + wx; p[j * 6 + 4] = y + wy; p[j * 6 + 5] = z + wz;
    }
    pos.needsUpdate = true;
  }

  /** The trail's newest `samples` fade from nothing at the plane (sample
   *  `n - 1`) to whole; the stretch faded last frame is made whole first. */
  function fadeTrail(a, n, samples) {
    const attr = a.trail.geometry.attributes.color, c = attr.array;
    const from = Math.max(0, n - samples);
    let lo = from, hi = n;
    if (a.fade) {
      for (let j = a.fade[0]; j < a.fade[1]; j++) c[j * 8 + 3] = c[j * 8 + 7] = 1;
      lo = Math.min(lo, a.fade[0]); hi = Math.max(hi, a.fade[1]);
    }
    for (let j = from; j < n; j++) {
      const f = Math.min(1, (n - 1 - j) / Math.max(1, samples));
      c[j * 8 + 3] = c[j * 8 + 7] = f * f * (3 - 2 * f);
    }
    a.fade = [from, n];
    attr.clearUpdateRanges();
    attr.addUpdateRange(lo * 8, Math.max(0, hi - lo) * 8);
    attr.needsUpdate = true;
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
      // On its map the replay draws the real planes: this one is only where
      // they are, for the rings, lines and cameras.
      if (world) plane = new THREE.Group();
      else if (fight.recorded && fight.templates?.[i]) {
        try {
          const got = planeVisualFor(fight.templates[i], fight.meta?.mod);
          if (got && typeof got.then === 'function') pending = got; else plane = got;
        } catch { plane = null; }
      }
      if (!plane && !world) {
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
      // RGBA: the alpha fades the newest stretch out at the plane (`fadeTrail`).
      tg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 8), 4));
      const index = new Uint32Array(Math.max(0, n - 1) * 6);
      for (let j = 0; j < n - 1; j++) index.set([2 * j, 2 * j + 1, 2 * j + 2, 2 * j + 1, 2 * j + 3, 2 * j + 2], j * 6);
      tg.setIndex(new THREE.BufferAttribute(index, 1));
      const trail = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true,
        opacity: TRAIL_OPACITY, depthWrite: false }));
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
      const col = tg.attributes.color.array, sp = sg.attributes.position.array;
      const wing = new THREE.Vector3(), q = new THREE.Quaternion();
      const back = world ? MAP_TRAIL.back : 0;
      const aft = new THREE.Vector3();
      // Each sample's middle and its wing's direction: the ribbon is laid
      // out from them at whatever width the camera wants (`shapeTrail`).
      const mids = new Float32Array(n * 3), wings = new Float32Array(n * 3);
      fight.tracks[i].forEach((k, j) => {
        q.set(...k.q);
        aft.set(0, 0, back).applyQuaternion(q);
        const x = k.p[0] - fight.origin[0] + aft.x, y = k.p[1] - fight.origin[1] + aft.y, z = k.p[2] - fight.origin[2] + aft.z;
        wing.set(1, 0, 0).applyQuaternion(q);
        mids.set([x, y, z], j * 3);
        wings.set([wing.x, wing.y, wing.z], j * 3);
        sp.set([x, 1.2, z], j * 3);
        // Brighter the faster: a trail that fades where the pilot ran out of speed.
        const f = Math.min(1, Math.max(0.15, (k.v - 15) / 70));
        const c = base.clone().lerp(new THREE.Color(0xffffff), 0.35 * f).multiplyScalar(0.45 + 0.55 * f);
        col.set([c.r, c.g, c.b, 1, c.r * 0.7, c.g * 0.7, c.b * 0.7, 1], j * 8);
      });
      tg.attributes.color.needsUpdate = sg.attributes.position.needsUpdate = true;
      // His gun line: where his rounds would go, out to the guns' reach.
      const gg = new THREE.BufferGeometry();
      gg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const gun = new THREE.Line(gg, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false }));
      gun.frustumCulled = false;
      // The path's shadow lies on the floor's zero; a map's ground is not there.
      shadow.visible = !world;
      s.scene.add(plane, trail, shadow, drop, marker, gun);
      // The plane's own propeller, turned on the revs the fight recorded,
      // and its guns' own tracer streak (`dogfight-plane-look.js`).
      const actor = { plane, trail, shadow, drop, marker, gun, props: propellersOf(plane), look: tracerGunOf(plane), streaks: [], pending, span: spanOf(plane),
                      mids, wings, half: 0, fade: null };
      shapeTrail(actor, world ? MAP_TRAIL.half : TRAIL_HALF);
      return actor;
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
    s.tracerSet = world ? new Set() : tracerRounds(fight.rounds, s.actors.map(a => a.look));
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
    // A demo can stop where its move has played out (`endAt`, seconds),
    // while the move is still scored over the whole fight it flies; a kill
    // after the cut is not shown.
    const last = r.tracks[0].at(-1).t;
    const duration = Math.min(last, demo.endAt ?? last);
    const end = r.end && r.end.t <= duration ? r.end : null;
    const fight = { ...r, end, fullEnd: r.end, origin, lesson, demo, duration };
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
    // Where nobody can get a bead on the other (the scene can be extended
    // from there, "Extend the scene").
    fight.deadlocks = deadlockSpans(fight);
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
    state.hullSeen = null;
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

  /** The score of the move on stage, said in words: how many of the nine
   *  test flights it worked in, and what "worked" means for it. */
  function drawScore(demo) {
    const v = demo ? verdictOf(demo.verdict) : null;
    const rule = demo ? PASS_RULES[demo.kind] : null;
    ui.score.hidden = !(v && rule);
    ui.scoring.hidden = !(state.lesson?.demos ?? []).some(d => PASS_RULES[d.kind] && verdictOf(d.verdict));
    const dd = ui.scoring.querySelectorAll('dd');
    ['dip', 'flip', 'ninja'].forEach((k, i) => { dd[i].textContent = PASS_RULES[k]; });
    const line = ui.scoring.querySelector('.dfs-scoring-this');
    if (!(v && rule)) { line.textContent = ''; return; }
    const { works, of = 9 } = demo.verdict;
    const info = MOVE_INFO[demo.kind];
    const card = stepsOf(state.lesson?.id, demo.id);
    ui.score.dataset.verdict = v;
    ui.score.querySelector('.dfs-card-name').textContent = `${info.name} · ${info.nick}`.toUpperCase();
    ui.score.querySelector('.dfs-card-best').hidden = bestMove(state.lesson?.demos ?? []) !== demo.id;
    ui.score.querySelector('.dfs-card-what').textContent = info.what;
    ui.score.querySelector('.dfs-card-verdict b').textContent = `${CARD_WORDS[v]} · ${works}/${of}`;
    ui.score.querySelector('.dfs-card-verdict span').textContent = card?.why ?? '';
    line.textContent = `${moveFull(demo.kind)} here: ${works} of ${of}. ${demo.verdict.line ?? ''}`.trim();
  }

  /**
   * The move card's steps and their numbered pins, for the fight on stage:
   * each step's time is where the seat's plan enters its phase in this
   * flight (`stepTimes`), so the pin sits on the path where it happens.
   * A step that never comes in the part shown is left out.
   */
  function drawSteps(fight) {
    const card = fight && !fight.recorded && state.demo ? stepsOf(state.lesson?.id, state.demo.id) : null;
    const end = fight ? fight.duration : 0;
    const steps = card ? stepTimes(fight.tracks[1], card.steps, state.startAt ?? 0).filter(s => s.t != null && s.t <= end) : [];
    state.steps = steps.map(s => {
      const k = fight.tracks[1][Math.min(fight.tracks[1].length - 1, Math.round(s.t / fight.dt))];
      return { ...s, at: [k.p[0] - fight.origin[0], k.p[1] - fight.origin[1], k.p[2] - fight.origin[2]] };
    });
    state.stepNow = -2;
    ui.steps.innerHTML = state.steps.map((s, i) => `<li><button type="button" data-step="${s.t}" title="Jump to ${s.t.toFixed(1)} s">`
      + `<i>${i + 1}</i><span>${esc(s.say)}</span><small>${s.t.toFixed(0)}s</small></button></li>`).join('');
    ui.steps.hidden = !state.steps.length;
    ui.pins.innerHTML = state.steps.map((s, i) => `<span class="dfs-pin">${i + 1}</span>`).join('');
  }

  /** Light the step the fight is in, on the card and among the pins. */
  function markStep(t) {
    const steps = state.steps ?? [];
    let now = -1;
    steps.forEach((s, i) => { if (s.t <= t + 0.05) now = i; });
    if (now === state.stepNow) return;
    state.stepNow = now;
    ui.steps.querySelectorAll('li').forEach((li, i) => {
      li.classList.toggle('is-now', i === now);
      li.classList.toggle('is-done', i < now);
    });
    ui.pins.querySelectorAll('.dfs-pin').forEach((p, i) => {
      p.classList.toggle('is-now', i === now);
      p.classList.toggle('is-ahead', i > now);
    });
  }

  function pickDemo(lesson, id) {
    const demo = lesson.demos.find(d => d.id === id) ?? lesson.demos[0] ?? null;
    state.demo = demo;
    drawScore(demo);
    ui.demos.querySelectorAll('button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.demo === demo?.id)));
    if (!demo) {
      state.fight = null;
      drawSteps(null);
      ui.stage.classList.add('is-empty');
      ui.tcKicker.textContent = lesson.title.toUpperCase();
      ui.tcTitle.textContent = 'No reconstruction for this one';
      ui.tcNote.textContent = 'They pick their own moves. Fly it.';
      ui.tc.classList.add('is-shown');
      ui.end.hidden = true;
      return;
    }
    const fight = fly(lesson, demo);
    // Another fight: the scene extended from the last one goes.
    if (state.extend && state.extend.base !== fight) clearExtend();
    // A long move can open where it starts to matter (`startAt`, seconds);
    // the scrub bar still reaches back to 0.
    state.startAt = Math.max(0, Math.min(fight.duration - 1, demo.startAt ?? 0));
    stageLesson(fight, { at: state.startAt });
    const plane = String(typeof planeName === 'function' ? planeName() : planeName).toUpperCase();
    ui.tcKicker.textContent = `${lesson.title.toUpperCase()} · ${plane} AGAINST ${plane}`;
    // A move's title is its pilot's name for it; what it does is on its
    // card, and the measured detail is in the notes.
    const info = MOVE_INFO[demo.kind];
    ui.tcTitle.textContent = moveLabel(demo);
    ui.tcNote.textContent = info ? info.what : demo.verdict?.line ? `${demo.note} ${demo.verdict.line}` : demo.note;
    // FLY IT practises the move on its tab, or flies the lesson.
    const name = MOVE_NAMES[demo.kind]?.toLowerCase();
    ui.fly.textContent = name ? `Practise the ${name}` : 'Fly it yourself';
    ui.flyNote.textContent = name
      ? `You fly the green plane (YOU), set up as this fight starts, against the ace it was measured against. The guide and the instructor (I) fly the ${name}: follow the green rings, and the numbered steps on the move card. ${demo.note}`
      : 'You fly the green plane (YOU), in the air, against the ace flying this move. The coach tells you what they are doing and what beats it.';
    ui.tc.classList.add('is-shown');
    clearTimeout(pickDemo.timer);
    pickDemo.timer = setTimeout(() => ui.tc.classList.remove('is-shown'), 3200);
  }

  /** A lesson's fight on stage (the demo's own, or one extended from it),
   *  from `at` seconds. */
  function stageLesson(fight, { at = 0 } = {}) {
    ui.stage.classList.remove('is-empty');
    if (!fight.extended) helperHide();
    state.fight = fight;
    state.orbit.az = sideOn(fight);
    state.t = at;
    state.explained = new Set(); state.hold = 0; ui.shot.hidden = true;
    state.playing = true;
    ui.toggle.textContent = 'Pause';
    buildActors(fight);
    setNames();
    state.planLabels = [0, 1].map(i => fight.events.find(e => e.side === i)?.move ?? '');
    setMoves(fight);
    // An extended fight's path is the way out's, not the move card's.
    drawSteps(fight.extended ? null : fight);
    ui.score.hidden = ui.score.hidden || !!fight.extended;
    ui.end.hidden = true;
    drawChart();
  }

  /** A demo's tab: a Dip, Flip or Ninja carries its name over its label
   *  and how many of the nine starts it worked from. A lesson with several
   *  tries of one kind names each (`tab`) where the nickname goes. */
  function demoTab(d, best) {
    const info = MOVE_INFO[d.kind];
    const v = verdictOf(d.verdict);
    const tip = info ? `${info.name} (${info.nick}): ${info.what} ${v ? `${CARD_WORDS[v]}, ${d.verdict.works} of ${d.verdict.of ?? 9} test flights.` : ''}` : '';
    return `<button type="button" role="tab" data-demo="${esc(d.id)}"${info ? ` data-kind="${esc(d.kind)}" title="${esc(tip)}"` : ''}${d.id === best ? ' data-best=""' : ''}${v ? ` data-verdict="${v}"` : ''}>`
      + (info ? `<small class="dfs-demo-kind">${esc(info.name.toUpperCase())}</small><em class="dfs-demo-nick">${esc(d.tab ?? info.nick)}</em>` : `<span>${esc(d.label)}</span>`)
      + (v ? `<i class="dfs-verdict is-${v}">${d.verdict.works}/${d.verdict.of ?? 9}</i>` : '')
      + '</button>';
  }

  /** A lesson's tabs: its own fights first, then its moves, the one that
   *  works most often first. */
  function demoOrder(demos) {
    const score = d => (MOVE_INFO[d.kind] ? d.verdict?.works ?? -1 : Infinity);
    return demos.map((d, i) => [d, i]).sort(([a, i], [b, j]) => score(b) - score(a) || i - j).map(([d]) => d);
  }

  /** The fights' tabs fade at the bar's end only when there are more of
   *  them than fit (they scroll sideways then). */
  function fitDemos() {
    // Too many for the bar beside play and the tools (the notes open, a
    // narrow window): the tabs take a row of their own rather than scroll
    // half out of sight. Only past that do they scroll, faded at the end.
    const row = ui.demos.parentElement;
    row.classList.remove('is-stacked');
    if (ui.demos.scrollWidth > ui.demos.clientWidth + 1) row.classList.add('is-stacked');
    ui.demos.classList.toggle('is-over', ui.demos.scrollWidth > ui.demos.clientWidth + 1);
  }

  function pickLesson(id) {
    helper.seen.clear();
    helperHide();
    const lesson = lessonById(id) ?? LESSONS[0];
    state.lesson = lesson;
    ui.lessons.querySelectorAll('.dfs-row').forEach(b => b.setAttribute('aria-current', String(b.dataset.lesson === lesson.id)));
    ui.storyHeads[0].textContent = 'THE MOVE';
    ui.storyHeads[1].textContent = 'THE COUNTER';
    ui.flyRow.hidden = ui.flyNote.hidden = false;
    ui.whatif.hidden = true;
    ui.notesBtn.classList.remove('has-news');
    ui.watch.hidden = true;
    clearExtend();
    closeMap();
    drawLayer(null);
    state.recording = null;
    ui.move.innerHTML = lesson.story.map(p => `<p>${esc(p)}</p>`).join('');
    ui.counter.innerHTML = lesson.counterStory.map(p => `<p>${esc(p)}</p>`).join('');
    const best = bestMove(lesson.demos);
    ui.demos.innerHTML = demoOrder(lesson.demos).map(d => demoTab(d, best)).join('');
    fitDemos();
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
    // The deadlocks (nobody's shot, both turning): hatched in the muted ink
    // across the whole strip, so a turning fight reads as the band it is.
    for (const span of fight.deadlocks ?? []) {
      const x0 = X(span.from), x1 = Math.max(x0 + 3, X(span.t1));
      x.save();
      x.beginPath(); x.rect(x0, 0, x1 - x0, h); x.clip();
      x.strokeStyle = C.muted;
      x.globalAlpha = 0.28;
      x.lineWidth = 1;
      for (let k = x0 - h; k < x1; k += 7) { x.beginPath(); x.moveTo(k, h); x.lineTo(k + h, 0); x.stroke(); }
      x.restore();
    }
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
    // Where the recording lost a plane (out of its player's range): hatched
    // in his colour, his half of the strip, his path there a guess.
    for (const [side, spans] of (fight.lost ?? []).entries()) {
      for (const [a, b] of spans) {
        const x0 = X(a), x1 = Math.max(x0 + 3, X(b)), y0 = side === 0 ? 0 : h / 2;
        x.save();
        x.beginPath();
        x.rect(x0, y0, x1 - x0, h / 2);
        x.clip();
        x.strokeStyle = side === 0 ? CSS_ACE : CSS_YOU;
        x.globalAlpha = 0.55;
        x.lineWidth = 1;
        for (let k = x0 - h; k < x1; k += 5) { x.beginPath(); x.moveTo(k, y0 + h / 2); x.lineTo(k + h / 2, y0); x.stroke(); }
        x.restore();
      }
    }
    // A recorded fight's own stop, when it is a moment (a death outside it,
    // a pilot leaving): a mark like the kill's, dashed.
    const stop = !fight.end && fight.ending?.words?.marks ? fight.ending : null;
    if (stop) {
      x.strokeStyle = C.ink;
      x.lineWidth = 2;
      x.setLineDash([4, 3]);
      x.beginPath(); x.moveTo(X(stop.t), 0); x.lineTo(X(stop.t), h); x.stroke();
      x.setLineDash([]);
    }
    // The move card's steps, numbered where each one starts.
    x.font = '600 9px ui-monospace, monospace';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    for (const [i, st] of (state.steps ?? []).entries()) {
      const sx = Math.max(7, Math.min(w - 7, X(st.t)));
      x.strokeStyle = CSS_YOU;
      x.globalAlpha = 0.6;
      x.lineWidth = 1;
      x.beginPath(); x.moveTo(sx + 0.5, 14); x.lineTo(sx + 0.5, h); x.stroke();
      x.globalAlpha = 1;
      x.fillStyle = CSS_YOU;
      x.beginPath(); x.arc(sx, 7, 6.5, 0, Math.PI * 2); x.fill();
      x.fillStyle = C.floor;
      x.fillText(String(i + 1), sx, 7.5);
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
    // The map layer covers this window: nothing of this one shows.
    if (mapFrame?.ready) return;
    const s = renderer();
    if (!s) return;
    const w = ui.canvas.clientWidth, h = ui.canvas.clientHeight;
    if (w && h && (s.w !== w || s.h !== h)) {
      s.w = w; s.h = h;
      s.renderer.setSize(w, h, false);
      s.camera.aspect = w / h;
      s.camera.updateProjectionMatrix();
      drawChart();
      fitDemos();
    }
    const fight = state.fight;
    if (!fight) { s.renderer.render(s.scene, s.camera); return; }
    const view = state.camera === 'top' ? s.ortho : s.camera;
    s.view = view;
    if (fight.recorded) drawWhatIfHead();
    if (!world) { drawExtendHead(); drawHelper(); }
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
    let rate = 0;
    if (state.playing && state.hold <= 0) {
      // Around every burst the replay slows, so the shot reads: the moment
      // the guns come on is the moment the move paid off.
      const shot = state.slowOnShots && (firingAt(fight, 0, state.t, 0.5) || firingAt(fight, 1, state.t, 0.5));
      rate = shot ? Math.min(state.speed, SHOT_SPEED) : state.speed;
      state.t += dt * rate;
      if (state.t >= fight.duration) { state.t = fight.duration; state.playing = false; ui.toggle.textContent = 'Play'; rate = 0; }
    }
    // On its map: this clock drives the replay's, every frame, and the
    // replay steps to it there and then (`ReplayPlayer.drive`), so its planes
    // stand where this frame's rings and paths do: no second clock to drift,
    // and a drag along the timeline moves the round rather than rebuilding it.
    if (world && fight.clip) world.drive(fight.clip.lead + state.t, rate);
    if (document.activeElement !== ui.scrub) ui.scrub.value = String(Math.round(state.t / fight.duration * 1000));
    ui.scrub.style.setProperty('--p', `${(state.t / fight.duration * 100).toFixed(2)}%`);
    const clock = `${state.t.toFixed(1)} / ${fight.duration.toFixed(0)} s`;
    if (ui.time.textContent !== clock) ui.time.textContent = clock;
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
      if (world) {
        // A contrail: the last few seconds, up to the plane.
        const from = Math.max(0, n - 1 - Math.round(MAP_TRAIL.seconds / fight.dt));
        a.trail.geometry.setDrawRange(from * 6, Math.max(0, n - 1 - from) * 6);
      } else {
        a.trail.geometry.setDrawRange(0, Math.max(0, n - 1 - (chased ? 45 : 0)) * 6);
        // As wide as the plane is drawn: a thin tape behind a tail, a wider
        // one when the wide view draws the planes bigger than life.
        shapeTrail(a, TRAIL_HALF * Math.round(Math.min(6, Math.max(1, state.drawScale)) * 4) / 4);
      }
      fadeTrail(a, n, Math.round(TRAIL_FADE / fight.dt));
      a.shadow.geometry.setDrawRange(0, n);
      if (i === 0 && s.ticks) {
        const shown = Math.floor(k.i / s.ticks.every) + 1;
        s.ticks.dots.geometry.setDrawRange(0, shown * 2);
        s.ticks.rungs.geometry.setDrawRange(0, shown * 2);
      }
      // Drawn bigger than life when the camera stands back, as a diagram
      // draws them; true size behind a tail.
      a.plane.scale.setScalar(state.drawScale);
      a.marker.scale.setScalar(state.drawScale * (state.intro ? state.intro.pulse : 1));
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
      if (world) meterHull(m, i, fight);
      // Out of the recording player's range here: his path is a guess.
      const lostNow = (fight.lost?.[i] ?? []).some(([a, b]) => state.t >= a && state.t <= b);
      m.classList.toggle('is-lost', lostNow);
      m.classList.toggle('is-slow', k.v < 30);
      // Every pilot sees only what a pilot could from his seat (reviews/eyes.md):
      // when he has not got the other plane, his meter says so.
      const blind = kk.sees === 0;
      const eye = m.querySelector('.dfs-m-eye');
      if (eye.hidden === blind) eye.hidden = !blind;
      m.classList.toggle('is-blind', blind);
      const said = sayingAt(fight, i, state.t);
      const text = said3(said?.say ?? '', i);
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
      // On its map the replayed plane fires its own flash and tracers.
      a.flash.visible = !world && firing && Math.sin(performance.now() * 0.09 + i) > -0.3;
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
    if (state.intro) introFrame(s, now2);
    drawReticle(s, now2, w, h);
    if (world) {
      // The map and the replayed planes, then this theatre's paths and rings
      // over them, behind the hills where they pass behind the hills.
      s.renderer.autoClear = true;
      // The map's fog is set for a pilot's eye; the school's cameras stand
      // hundreds of metres back. Pushed out for this draw, put back after.
      const fog = world.scene.fog;
      const kept = fog?.isFog ? [fog.near, fog.far] : null;
      if (kept) { fog.near = kept[0] * 4; fog.far = Math.max(kept[1] * 4, 6000); }
      // The page's camera stands where this one does: the level's sky, its
      // culling and the listener's ear go by it.
      world.look?.(view);
      if (state.intro) drawIntroWorld(s, view);
      else s.renderer.render(world.scene, view);
      if (kept) [fog.near, fog.far] = kept;
      s.renderer.autoClear = false;
      s.renderer.render(s.scene, view);
    } else {
      s.renderer.render(s.scene, view);
    }
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
    // The move's numbered steps, pinned to the path where each happens:
    // the ones still to come dimmed, the one under way lit.
    markStep(state.t);
    const pins = ui.pins.children;
    (state.steps ?? []).forEach((st, i) => {
      const pin = pins[i];
      if (!pin) return;
      _m.set(st.at[0], st.at[1], st.at[2]).project(view);
      const on = _m.z < 1 && Math.abs(_m.x) < 1.05 && Math.abs(_m.y) < 1.05 && state.camera !== 'sight-you' && state.camera !== 'sight-ace';
      pin.style.visibility = on ? 'visible' : 'hidden';
      if (on) pin.style.transform = `translate(${(_m.x * 0.5 + 0.5) * w}px, ${(-_m.y * 0.5 + 0.5) * h}px) translate(-50%, -50%)`;
    });
    // The end card, once the fight is decided.
    // A recorded fight's own stop (a death outside the fight, a pilot
    // leaving) is a moment, shown when it comes; any other at the last frame.
    const stopAt = fight.end ? fight.end.t : fight.ending?.words?.marks ? fight.ending.t : fight.duration;
    if (state.t >= stopAt + (fight.end || fight.ending?.words?.marks ? 0.3 : 0)) showEnd(fight);
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
    const said = [before?.say, now?.say].filter(Boolean).map(x => said3(x, side)).join('. Then: ');
    const theirs = said3(sayingAt(fight, 1 - side, window[0])?.say ?? '', 1 - side);
    const n = fight.shots[side].indexOf(window) + 1;
    ui.shot.dataset.side = side === 0 ? 'ace' : 'you';
    ui.shot.querySelector('small').textContent = `${who} · KILL SHOT ${n} OF ${fight.shots[side].length}`;
    ui.shot.querySelector('b').textContent = `${whoOf(side)} ${whoOf(side) === 'You' ? 'have' : 'has'} the shot`;
    ui.shot.querySelector('.dfs-shot-geo').textContent = `${k.sd} m out, ${partyOf(side) === 'you' ? 'your' : `${partyOf(side)}'s`} nose ${k.so} degrees off the lead, for ${(window[1] - window[0] + fight.dt).toFixed(1)} s`;
    ui.shot.querySelector('.dfs-shot-why').textContent = said ? `How ${partyOf(side)} got it: ${said}.` : '';
    ui.shot.querySelector('.dfs-shot-other').textContent = theirs ? `Meanwhile, ${partyOf(1 - side)}: ${theirs}.` : '';
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
    // The helper's own card carries the way out's verdict.
    if (fight.extended && helper.step === 'playing') return;
    const [aceHits, youHits] = fight.hits;
    const who = whoOf;
    const b = ui.end.querySelector('b'), sp = ui.end.querySelector('span');
    const said = fight.ending?.words;
    if (said) {
      b.textContent = said.title;
    } else if (fight.end?.why === 'shot down') {
      b.textContent = `${who(fight.end.winner)} wins at ${fight.end.t.toFixed(1)} s`;
    } else if (fight.end) {
      b.textContent = `${who(1 - fight.end.winner)} flew into the ground`;
    } else {
      b.textContent = `No kill in ${Math.round(fight.duration)} s`;
    }
    const e = fight.tracks.map(tr => Math.round(tr.at(-1).e));
    const shots = fight.shotTime.map(v => v.toFixed(1));
    sp.textContent = `Kill shots: the ace had ${shots[0]} s of them, you ${shots[1]} s. Hits: ace ${aceHits}, you ${youHits}. Energy at the end: ace ${e[0]} m, you ${e[1]} m.`;
    if (said) {
      const n = fight.names;
      sp.textContent = `${said.note} Kill shots: ${n[0]} had ${shots[0]} s of them, ${n[1]} ${shots[1]} s. Hits: ${n[0]} ${aceHits}, ${n[1]} ${youHits}. Energy at the end: ${n[0]} ${e[0]} m, ${n[1]} ${e[1]} m.`;
    }
    ui.end.classList.toggle('is-lost', fight.ending?.why === 'out of range');
    // A Dip, Flip or Ninja says how it fared from all nine starts.
    const demo = fight.extended ? null : state.demo, v = verdictOf(demo?.verdict);
    ui.end.dataset.verdict = v ?? '';
    if (v) sp.textContent = `${MOVE_NAMES[demo.kind] ?? demo.label}: worked from ${demo.verdict.works} of ${demo.verdict.of ?? 9} starts. ${demo.verdict.line} ${sp.textContent}`;
    // No kill: the scene can be extended from the end, right here, the
    // school's ways out flown from where the two of them stand.
    const acts = ui.end.querySelector('.dfs-end-acts');
    const open = !fight.end && !fight.extended && !fight.ending && fight.duration > 1;
    if (open) {
      const t = Math.max(0, fight.duration - fight.dt);
      const sides = fight.recorded ? [0, 1] : [1];
      const dl = deadlockIn(fight.deadlocks, t) ?? fight.deadlocks?.at(-1) ?? null;
      acts.innerHTML = `<small>${dl ? `${KIND_WORDS[dl.kind][0].toUpperCase()}${KIND_WORDS[dl.kind].slice(1)} at the end: nobody had a shot.` : 'Nobody won.'} `
        + `Extend the scene from the end to see the school's ways out, each flown from here against ${fight.recorded ? 'the other pilot' : 'the ace'} as they stand.</small>`
        + sides.map(side => `<button type="button" class="dfs-chip" data-extend="run" data-side="${side}" data-t="${t}">${fight.recorded ? `Extend for ${esc(fight.names[side])}` : 'Extend the scene'}</button>`).join('');
    } else acts.innerHTML = '';
    acts.hidden = !open;
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

  /** On its map, each pilot's hull as the recording has it (the replayed
   *  plane's hit points): the row reads it, and a hit flashes the meter red,
   *  so a burst that lands shows before the smoke does (a Bf 109 smokes only
   *  under 40 of its 100). */
  function meterHull(m, i, fight) {
    const h = world.health?.(fight.nids?.[i]);
    const row = m.querySelector('.dfs-m-hull'), head = m.querySelector('.dfs-m-hull-t');
    row.hidden = head.hidden = !h;
    if (!h) return;
    const pct = Math.max(0, Math.round(100 * h.hp / Math.max(1, h.max)));
    const text = pct > 0 ? `${pct}%` : 'down';
    if (row.textContent !== text) row.textContent = text;
    const was = state.hullSeen?.[i];
    (state.hullSeen ??= [])[i] = pct;
    if (was !== undefined && pct < was) {
      m.classList.remove('is-hit');
      void m.offsetWidth;
      m.classList.add('is-hit');
    }
    m.classList.toggle('is-hurt', pct > 0 && pct < 50);
    m.classList.toggle('is-down', pct <= 0);
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
      // A fighter drawn about 22 pixels long, whatever the fight's size.
      state.drawScale = Math.max(1, Math.min(8, 22 * scale / 11));
      camPos = null; camLook = null;
      return;
    } else {
      // On its map the planes are the picture: close in on them, the two
      // filling about half the frame. Over the bare floor the schematic
      // stands well back, where the whole path reads.
      // A tall, narrow picture (a phone held upright) stands further back,
      // so both planes stay in it side to side.
      const tall = Math.max(1, 0.9 / (s.camera.aspect || 1));
      const d = Math.max(WIDE_NEAREST, (world ? Math.max(55, span * 1.15 + 35) : Math.max(380, span * 1.5 + 160)) * tall * state.orbit.zoom);
      const { az, el } = state.orbit;
      pos = mid.clone().add(_u.set(Math.sin(az) * Math.cos(el) * d, Math.sin(el) * d, Math.cos(az) * Math.cos(el) * d));
      pos.y = Math.max(pos.y, 25);
      look = mid.clone();
    }
    const far = state.camera === 'wide' || state.camera === 'top';
    // A plane about a fifteenth of the picture's height across, wherever
    // the wide camera stands, up to five times life.
    state.drawScale = far ? Math.max(1, Math.min(5, pos.distanceTo(mid) / 125)) : 1;
    const k2 = 1 - Math.exp(-dt * 3.5);
    camPos = camPos ? camPos.lerp(pos, k2) : pos.clone();
    camLook = camLook ? camLook.lerp(look, k2) : look.clone();
    s.camera.position.copy(camPos);
    s.camera.lookAt(_look.copy(camLook));
  }

  // --- the way in ---------------------------------------------------------------
  // On its map the world arrives in four beats (`INTRO`): the map as a mesh
  // of scan lines swept in from the west over a dark sky, its paint swept
  // over the mesh, the two pilots' rings bursting in where they are, and the
  // camera's glide from high above down to the wide view, the school's
  // panels fading in as it lands. Then the fight plays.
  //
  // The mesh is not three.js's wireframe: a level's terrain from two
  // kilometres out has more edges than pixels and draws as a flat fill. It
  // is a grid laid in world space (`GRID` metres, so it reads the same at
  // any distance), contour lines every `CONTOUR` metres of height, and each
  // face lit faintly by its slope, so the hills stand out of the dark.
  const GRID = 40, CONTOUR = 12;
  const scan = new THREE.MeshBasicMaterial({ color: new THREE.Color(C.you), transparent: true, depthWrite: true });
  scan.onBeforeCompile = sh => {
    sh.uniforms.uSweep = scan.userData.sweep = { value: 0 };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vScanWorld;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 scanW = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          scanW = instanceMatrix * scanW;
        #endif
        vScanWorld = (modelMatrix * scanW).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vScanWorld;\nuniform float uSweep;')
      .replace('#include <opaque_fragment>', `
        vec3 scanN = normalize(cross(dFdx(vScanWorld), dFdy(vScanWorld)));
        vec2 g = abs(fract(vScanWorld.xz / ${GRID.toFixed(1)} - 0.5) - 0.5) / fwidth(vScanWorld.xz / ${GRID.toFixed(1)});
        float grid = 1.0 - min(min(g.x, g.y), 1.0);
        float h = abs(fract(vScanWorld.y / ${CONTOUR.toFixed(1)} - 0.5) - 0.5) / fwidth(vScanWorld.y / ${CONTOUR.toFixed(1)});
        float contour = 1.0 - min(h, 1.0);
        float slope = 1.0 - abs(scanN.y);
        float edge = smoothstep(0.0, 60.0, abs(vScanWorld.x - uSweep));
        float glow = max(grid * 0.55, contour * 0.9) + slope * 0.22 + 0.05 + (1.0 - edge) * 0.8;
        gl_FragColor = vec4(diffuseColor.rgb * glow, clamp(glow, 0.0, 1.0));`);
  };
  const darkSky = new THREE.Color(C.stage), _sky = new THREE.Color();
  /** The level's sky and sea: left out of the mesh, so the land stands in
   *  the dark (a sea as scan lines is a floor to the horizon). */
  let skyNodes = null;

  function startIntro() {
    if (!world) return;
    state.intro = { t: 0, start: performance.now(), pulse: 0 };
    state.camera = 'wide';
    markChips?.();
    state.playing = false;
    ui.toggle.textContent = 'Play';
    root.classList.add('is-intro');
  }

  function endIntro() {
    if (!state.intro) return;
    state.intro = null;
    root.classList.remove('is-intro');
    for (const a of gl?.actors ?? []) a.marker.scale.setScalar(state.drawScale);
    if (gl) gl.scene.visible = true;
    state.playing = true;
    ui.toggle.textContent = 'Pause';
    ui.tc.classList.remove('is-shown');
  }

  /** The map drawn for the way in: the mesh, then paint behind a moving line. */
  function drawIntroWorld(s, view) {
    const it = state.intro, sc = world.scene;
    if (!skyNodes) {
      skyNodes = [];
      sc.traverse(n => {
        const kind = n.userData?.kind ?? n.name;
        if (kind === 'sky' || kind === 'water') skyNodes.push(n);
      });
    }
    // The sweeps run across the level's whole ground (its terrain's extent,
    // measured once), or INTRO_REACH either side of the fight without one.
    if (!it.reach) {
      const box = new THREE.Box3(), part = new THREE.Box3();
      sc.traverse(n => { if (n.userData?.kind === 'terrain' && n.isMesh) box.union(part.setFromObject(n)); });
      const c = state.fight?.tracks[0][0].p ?? [0, 0, 0];
      it.reach = box.isEmpty() ? [c[0] - INTRO_REACH, c[0] + INTRO_REACH] : [box.min.x - 50, box.max.x + 50];
    }
    const x0 = it.reach[0], span = it.reach[1] - it.reach[0];
    const meshK = smooth01(it.t / INTRO.mesh), paintK = smooth01((it.t - INTRO.mesh) / INTRO.paint);
    if (paintK >= 1) {
      // Painted: the level as it always draws.
      s.renderer.render(sc, view);
      return;
    }
    const bg = sc.background, fog = sc.fog;
    const below = x => new THREE.Plane(new THREE.Vector3(-1, 0, 0), x); // keeps x below `x`
    const above = x => new THREE.Plane(new THREE.Vector3(1, 0, 0), -x); // keeps x above `x`
    const drawMesh = (planes, sweep) => {
      const shown = skyNodes.map(n => n.visible);
      for (const n of skyNodes) n.visible = false;
      sc.fog = null;
      sc.overrideMaterial = scan;
      if (scan.userData.sweep) scan.userData.sweep.value = sweep;
      s.renderer.clippingPlanes = planes;
      s.renderer.render(sc, view);
      skyNodes.forEach((n, i) => { n.visible = shown[i]; });
      sc.overrideMaterial = null;
      sc.fog = fog;
    };
    if (paintK > 0) {
      // The paint west of the line (the sky with it), the mesh east of it.
      // The sky's colour comes up from the dark with the paint.
      const line = x0 + span * paintK;
      sc.background = bg?.isColor ? _sky.lerpColors(darkSky, bg, paintK) : paintK > 0.5 ? bg : darkSky;
      s.renderer.clippingPlanes = [below(line)];
      s.renderer.render(sc, view);
      s.renderer.autoClear = false;
      sc.background = null;
      drawMesh([above(line)], line);
    } else {
      sc.background = darkSky;
      drawMesh([below(x0 + span * meshK)], x0 + span * meshK);
    }
    sc.background = bg;
    s.renderer.clippingPlanes = [];
  }

  /** The way in's clock (the wall's, so a slow frame does not stretch it),
   *  the pilots' rings, and the camera's glide. */
  function introFrame(s, now2) {
    const it = state.intro;
    it.t = (performance.now() - it.start) / 1000;
    if (it.t >= INTRO_TOTAL) { endIntro(); return; }
    const spawn = (it.t - INTRO.mesh - INTRO.paint) / INTRO.spawn;
    // The overlay (paths, rings, lines) appears with the pilots.
    s.scene.visible = spawn > 0;
    it.pulse = spawn <= 0 ? 0 : spawn >= 1 ? 1 : 1 + 2.2 * Math.sin(Math.PI * spawn) * (1 - spawn);
    // High above, circling slowly, then down into the wide view.
    const o = state.fight.origin;
    const mid = new THREE.Vector3((now2[0].p[0] + now2[1].p[0]) / 2 - o[0], (now2[0].p[1] + now2[1].p[1]) / 2 - o[1],
                                  (now2[0].p[2] + now2[1].p[2]) / 2 - o[2]);
    const az = state.orbit.az + 1.1 - 0.12 * it.t;
    const high = mid.clone().add(new THREE.Vector3(Math.sin(az) * 2300, 1500, Math.cos(az) * 2300));
    const glide = smooth01((it.t - INTRO.mesh - INTRO.paint - INTRO.spawn * 0.5) / INTRO.glide);
    if (camPos && camLook) {
      s.camera.position.lerpVectors(high, camPos, glide);
      _look.lerpVectors(mid, camLook, glide);
      s.camera.lookAt(_look);
    }
    if (glide > 0.7) root.classList.remove('is-intro');
  }

  // --- fights from the recordings ------------------------------------------------
  /** The index of recorded fights, once fetched: null before, [] when absent. */
  let recorded = null;
  /** Which recorded fights the list shows: the dogfights, or every one. */
  let recordedFilter = 'dogfights';
  /** How the list shows them: one list by duration or by date, or by pilot
   *  (a leaderboard, then one pilot's fights in the chosen order). */
  let recordedGroup = 'duration';
  /** The order of the list: by `duration` or `date`, longest or newest first
   *  unless flipped (the active chip clicked again). */
  let recordedOrder = 'duration';
  let recordedDesc = true;
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
    const kindRows = (recorded ?? []).filter(r => (recordedFilter === 'all' || r.kind === 'dogfight') && (!world || r.clip));
    const named = r => r.sides.some(s => (decodePlayerName(s.name ?? '') || 'pilot') === recordedPilot);
    const rows = recordedGroup === 'pilot' && recordedPilot ? kindRows.filter(named) : kindRows;
    const fightItem = r => {
      const line = fightLine(r);
      return `<li>${ROW} data-recorded="${esc(r.id)}"${r.mutual ? ' data-mutual="1"' : ''}${r.kill ? ' data-kill="1"' : ''}>`
        + `<b>${esc(line.title)}</b><small>${esc(line.sub)}</small>`
        + `<small class="dfs-recs-where">${esc(titleCase(r.level))} · ${esc(r.recorded ?? 'unknown day')}</small></div></li>`;
    };
    // One list, in the chosen order: duration (then the date), or the date
    // (the day, the round, and where in the round). Ties keep the other key.
    const byDate = (a, b) => (a.recorded ?? '').localeCompare(b.recorded ?? '') || a.slug.localeCompare(b.slug) || a.t0 - b.t0;
    const order = recordedOrder === 'date' ? byDate : (a, b) => a.duration - b.duration || byDate(a, b);
    const sorted = list => [...list].sort((a, b) => (recordedDesc ? order(b, a) : order(a, b)));
    const fights = n => `${n} fight${n === 1 ? '' : 's'}`;
    let html = '';
    let count = '';
    if (recordedGroup === 'pilot' && !recordedPilot) {
      // The leaderboard: who shot down the most, and lost the fewest.
      const table = pilotTable(kindRows);
      count = `${table.length} pilots`;
      html = table.map((p, i) => `<li><div class="dfs-row dfs-recs-pilot" role="button" tabindex="0" data-pilot="${esc(p.name)}">`
        + `<b><i>${i + 1}</i>${esc(p.name)}<em>${p.won}-${p.lost}</em></b>`
        + `<small>${p.fights} fight${p.fights === 1 ? '' : 's'} in ${p.rounds} round${p.rounds === 1 ? '' : 's'}`
        + `${p.mutual ? ` · ${p.mutualWon} of ${p.mutual} both-shooting won` : ''} · ${esc(p.planes.slice(0, 3).map(x => x.plane).join(', '))}</small></div></li>`).join('');
    } else if (recordedGroup === 'pilot') {
      const p = pilotTable(kindRows).find(x => x.name === recordedPilot);
      count = p ? `${p.won} won, ${p.lost} lost of ${p.fights}` : '';
      html = `<li class="dfs-recs-who"><button type="button" class="dfs-chip" data-pilot="">All pilots</button><span>${esc(recordedPilot)}</span></li>`
        + sorted(rows).map(fightItem).join('');
    } else {
      count = fights(rows.length);
      html = sorted(rows).map(fightItem).join('');
    }
    box.querySelector('.dfs-recs-count').textContent = recorded === null ? 'loading' : count;
    box.querySelector('ol').innerHTML = html;
    box.querySelectorAll('button[data-filter]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.filter === recordedFilter)));
    box.querySelectorAll('button[data-group]').forEach(b => {
      b.setAttribute('aria-pressed', String(b.dataset.group === recordedGroup));
      // The order's direction on its chip (a pilot's own list keeps it too).
      if (b.dataset.group !== 'pilot') b.dataset.dir = b.dataset.group === recordedOrder ? (recordedDesc ? 'desc' : 'asc') : '';
    });
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
    fight.deadlocks = deadlockSpans(fight);
    return fight;
  }

  async function pickRecorded(id, { at = 0 } = {}) {
    // Another fight picked here while its map loads or shows: that map goes.
    if (mapFrame && mapFrame.id !== id) closeMap();
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
    // On its map every path is where the map has it.
    if (world) fight.origin = [0, 0, 0];
    fight.clip = raw.clip ?? null;
    fight.pids = raw.sides.map(s => s.pid);
    fight.nids = raw.sides.map(s => s.nid);
    // On its map, the two of them alone: every other hull, man and shot in
    // the round hidden and silent.
    if (world) world.focus?.({ nids: fight.nids, pids: fight.pids });
    state.recording = { fight, row, id, airframes: null };
    const firstOnMap = world && !state.introDone;
    if (ui.lessons.dataset.show !== 'recordings') showSection('recordings');
    ui.lessons.querySelectorAll('.dfs-row').forEach(b => b.setAttribute('aria-current', String(b.dataset.recorded === id)));
    showRecorded(fight, row, { at: Math.min(Math.max(0, at), fight.duration) });
    if (firstOnMap) { state.introDone = true; startIntro(); }
  }

  /** Put a recorded fight (or one spliced from it, `fight.whatIf`) on stage. */
  function showRecorded(fight, row, { at = 0 } = {}) {
    if (!fight.extended) helperHide();
    state.lesson = null;
    state.demo = null;
    ui.demos.innerHTML = '';
    ui.survival.hidden = true;
    ui.score.hidden = ui.scoring.hidden = true;
    ui.flyRow.hidden = ui.flyNote.hidden = true;
    ui.stage.classList.remove('is-empty');
    state.fight = fight;
    drawSteps(fight);
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
    ui.tcKicker.textContent = wi ? `${wi.extend ? 'EXTENDED' : 'WHAT IF'} · FROM ${wi.t.toFixed(1)} S` : `${titleCase(m.level).toUpperCase()} · ${m.recorded ?? ''} · FROM A RECORDING`;
    ui.tcTitle.textContent = wi ? `${fight.names[wi.side]}: ${wi.label}` : `${fight.names[0]} v ${fight.names[1]}`;
    ui.tcNote.textContent = wi ? wi.note : recordedSummary(fight);
    ui.tc.classList.add('is-shown');
    clearTimeout(pickDemo.timer);
    pickDemo.timer = setTimeout(() => ui.tc.classList.remove('is-shown'), 4200);
    ui.end.hidden = true;
    ui.storyHeads[0].textContent = 'THE FIGHT';
    ui.storyHeads[1].textContent = 'THE NUMBERS';
    const story = recordedStory(fight, row);
    if (wi?.extend) story.unshift(`The scene extended: up to ${wi.t.toFixed(1)} s this is the recording; from there ${fight.names[wi.side]} flies "${wi.label}" on the flight law, and ${fight.names[1 - wi.side]} is flown by the school's hunter, who turns after them and gives up a chase it cannot close. ${wi.note}.`);
    else if (wi) story.unshift(`What if: up to ${wi.t.toFixed(1)} s this is the recording; from there ${fight.names[wi.side]} flies "${wi.label}" instead, on the flight law, and ${fight.names[1 - wi.side]} stays after them at full throttle, nose on the lead, firing inside 400 m. ${wi.note}`);
    ui.move.innerHTML = story.map(p => `<p>${esc(p)}</p>`).join('');
    ui.counter.innerHTML = recordedNumbers(fight).map(p => `<p>${esc(p)}</p>`).join('');
    ui.whatif.hidden = !!world;
    ui.whatif.querySelector('[data-whatif="back"]').hidden = !wi || !!wi.extend;
    // A fight picked afresh: the scene extended from another goes.
    if (!fight.extended && state.extend && state.extend.base !== fight) clearExtend();
    drawWatch(state.recording?.fight ?? fight);
    drawLayer(state.recording?.fight ?? fight);
    if (!wi) ui.whatif.querySelector('ol').innerHTML = '';
    state.whatIfShown = null;
    drawChart();
  }

  /** A recorded fight on its own map in the school (`world`): the replay
   *  page on its clip, with this theatre over it. */
  function worldUrl(row) {
    const url = new URL('map.html', location.href);
    url.search = '';
    url.searchParams.set('mod', row.mod ?? 'bf1942');
    url.searchParams.set('map', row.level ?? '');
    url.searchParams.set('replay', `${recordedBase}${row.id}.ndjson`);
    url.searchParams.set('clip', '1');
    url.searchParams.set('school', row.id);
    if (new URLSearchParams(location.search).has('mute')) url.searchParams.set('mute', '1');
    return url.href;
  }

  /** IN 3D: the fight's clip on its own map in the replay, riding with
   *  either pilot (a new tab: the school stays where it is). */
  // --- the layers: schematic or its own map --------------------------------------
  /** The map layer loading or up in this window: `{ el, id, ready, timer }`. */
  let mapFrame = null;
  /** Each level's in-game map picture, by mod and level: the card's art. */
  const levelArt = new Map();

  /** The level's own in-game map (`minimap` in its scene.json), as a URL, or
   *  null: the 3D MAP card's picture, as a map site shows the satellite. */
  function levelImage(mod, level) {
    const key = `${mod}/${level}`;
    if (!levelArt.has(key)) {
      levelArt.set(key, (async () => {
        const { loadMods } = await import('./mods.js');
        const mods = await loadMods();
        const base = mods.find(m => m.id === mod)?.paths?.maps ?? 'maps';
        const dir = `${base}/${String(level).toLowerCase()}`;
        const res = await fetch(`${dir}/scene.json`);
        if (!res.ok) return null;
        const image = (await res.json())?.minimap?.image;
        return image ? `${dir}/${image}` : null;
      })().catch(() => null));
    }
    return levelArt.get(key);
  }

  /** The LAYERS card for the fight on stage: 3D MAP over the schematic (its
   *  level's picture), SCHEMATIC over the map (the paths alone). A fight with
   *  no clip has no map to show; a map page of its own, nowhere to go back. */
  function drawLayer(fight) {
    const clip = fight?.recorded && fight.clip;
    ui.layer.hidden = !clip || (world && !embed);
    ui.stage.classList.toggle('has-layer', !ui.layer.hidden);
    if (ui.layer.hidden) return;
    const m = fight.meta;
    ui.layer.classList.toggle('is-schematic', !!world);
    if (world) {
      ui.layerName.textContent = 'Schematic';
      ui.layerNote.textContent = 'The paths alone';
      ui.layer.setAttribute('aria-label', 'Back to the schematic');
      return;
    }
    const name = titleCase(m.level);
    ui.layerName.textContent = '3D map';
    ui.layerNote.textContent = mapFrame && !mapFrame.ready ? `Loading ${name}` : name;
    ui.layer.setAttribute('aria-label', `See it on ${name}, in 3D`);
    ui.layerImg.hidden = true;
    const want = `${m.mod}/${m.level}`;
    ui.layer.dataset.level = want;
    levelImage(m.mod ?? 'bf1942', m.level).then(src => {
      if (!src || ui.layer.dataset.level !== want) return;
      ui.layerImg.src = src;
      ui.layerImg.hidden = false;
    });
  }

  ui.layer.addEventListener('click', () => {
    if (world && embed) embed.leave(state.t, state.playing);
    else if (mapFrame) closeMap();
    else openMap();
  });

  /** Load the fight's map into this window: its replay page, hidden over the
   *  schematic, which plays on until the map says it is up. */
  function openMap() {
    const rec = state.recording;
    const fight = rec?.fight;
    if (world || !fight?.clip || mapFrame) return;
    const m = fight.meta;
    const url = new URL(worldUrl(rec.row ?? { id: rec.id, mod: m.mod, level: m.level }));
    url.searchParams.set('embed', '1');
    url.searchParams.set('at', state.t.toFixed(2));
    const el = document.createElement('iframe');
    el.className = 'dfs-mapframe';
    el.title = `${titleCase(m.level)}, the fight on its map`;
    el.allow = 'autoplay; fullscreen';
    el.src = url.href;
    root.append(el);
    mapFrame = { el, id: rec.id, ready: false, timer: setTimeout(() => failMap('it took too long'), MAP_PATIENCE * 1000) };
    root.classList.add('is-map-loading');
    ui.layer.classList.add('is-loading');
    drawLayer(fight);
  }

  /** Back to the schematic, at `t` of the fight when the map says where it was. */
  function closeMap(t = null, playing = null) {
    if (!mapFrame) return;
    clearTimeout(mapFrame.timer);
    mapFrame.el.remove();
    mapFrame = null;
    root.classList.remove('is-map-loading', 'is-on-map');
    ui.layer.classList.remove('is-loading');
    if (Number.isFinite(t) && state.fight) {
      state.t = Math.min(Math.max(0, t), state.fight.duration);
      state.hold = 0;
      ui.shot.hidden = true;
    }
    if (playing !== null) {
      state.playing = !!playing;
      ui.toggle.textContent = state.playing ? 'Pause' : 'Play';
    }
    last = performance.now();
    if (state.fight) drawLayer(state.recording?.fight ?? state.fight);
    root.focus?.();
  }

  function failMap(why) {
    const name = state.recording ? titleCase(state.recording.fight.meta.level) : 'the map';
    closeMap();
    ui.layerNote.textContent = `${name} did not load: ${why}`;
  }

  // The map layer's page says when it is up, and when it hands back.
  addEventListener('message', e => {
    if (e.origin !== location.origin || !mapFrame || e.source !== mapFrame.el.contentWindow) return;
    const d = e.data;
    if (d?.type !== 'dfs-world') return;
    if (d.state === 'ready') {
      clearTimeout(mapFrame.timer);
      mapFrame.ready = true;
      root.classList.remove('is-map-loading');
      root.classList.add('is-on-map');
      ui.layer.classList.remove('is-loading');
      state.playing = false;
      ui.toggle.textContent = 'Play';
      mapFrame.el.focus();
    } else if (d.state === 'schematic') {
      closeMap(d.t, d.playing);
    } else if (d.state === 'pick') {
      closeMap();
      pickRecorded(d.id).then(() => openMap());
    } else if (d.state === 'failed') {
      failMap(d.reason || 'the page could not open it');
    }
  });

  function drawWatch(fight) {
    const clip = fight?.clip;
    ui.watch.hidden = !clip;
    ui.watch.querySelectorAll('a').forEach(a => a.remove());
    if (!clip) return;
    const m = fight.meta;
    ui.watch.querySelector('span').textContent = world
      ? `On its own map, from the recording. Esc for ${embed ? 'the schematic' : 'the replay itself'}.`
      : 'The fight on its own map, from the recording';
    if (world) return;
    const onMap = new URL(worldUrl(state.recording?.row ?? { id: state.recording?.id, mod: m.mod, level: m.level }));
    {
      const a = document.createElement('a');
      a.className = 'dfs-chip is-map';
      a.href = onMap.href;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = 'On its map, in the school';
      ui.watch.append(a);
    }
    for (const s of [0, 1]) {
      const url = new URL('map.html', location.href);
      url.search = '';
      url.searchParams.set('mod', m.mod ?? 'bf1942');
      url.searchParams.set('map', m.level ?? '');
      url.searchParams.set('replay', `${recordedBase}${clip.file}`);
      if (Number.isFinite(fight.pids?.[s])) url.searchParams.set('follow', String(fight.pids[s]));
      url.searchParams.set('clip', '1');
      if (new URLSearchParams(location.search).has('mute')) url.searchParams.set('mute', '1');
      const a = document.createElement('a');
      a.className = `dfs-chip is-${s === 0 ? 'ace' : 'you'}`;
      a.href = url.href;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = `Ride with ${fight.names[s]}`;
      ui.watch.append(a);
    }
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
    // A chased moment, with the notes shut: the button says there is one.
    ui.notesBtn.classList.toggle('has-news', side !== null && ui.notes.hidden);
    span.textContent = side === null
      ? 'Pause where a pilot is in the other\'s sights to fly their other ways out from there.'
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
      `in their line of fire ${s.exposed.toFixed(1)} s`,
      `their shot on you ${s.hisShot.toFixed(1)} s`,
      `${s.hits} hit${s.hits === 1 ? '' : 's'}`,
      ...(s.myShot ? [`your guns on them ${s.myShot.toFixed(1)} s`] : []),
      ...(s.shotDown ? ['shot down'] : s.crashed ? ['into the ground'] : []),
    ].join(' · ');
    list.innerHTML = `<li class="dfs-whatif-actual"><b>What they did</b><small>${esc(words(w.actual))}</small></li>`
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
    const note = `Over the next 8 s: in their line of fire ${s.exposed.toFixed(1)} s (${w.actual.exposed.toFixed(1)} s in the recording), `
      + `their shot on you ${s.hisShot.toFixed(1)} s (${w.actual.hisShot.toFixed(1)} s), ${s.hits} hit${s.hits === 1 ? '' : 's'}.`;
    const spliced = prepare(spliceFight(rec.fight, w.i0, r.flown, r.way.name));
    spliced.whatIf = { ...spliced.whatIf, side: w.side, note };
    spliced.meta = rec.fight.meta;
    showRecorded(spliced, rec.row, { at: Math.max(0, w.t - 2) });
    ui.whatif.querySelectorAll('button[data-way]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.way === i)));
  }

  // --- extend the scene: the ways out of a deadlock -------------------------------
  // A turning fight or a manoeuvre fest (`dogfight-deadlock.js`): nobody has
  // had a landing shot for six seconds, both turning. From any moment in one
  // the school flies its five ways out, each from both airframes exactly as
  // they stand, the opponent flying on with their own plan and memory, and
  // says what each got: on their six, a shot, clear, still locked, or hit.
  // Any of them plays on from that moment in place of the fight (`extended`).

  /** The fight the scene is extended from: the one on stage, or the base of
   *  the extension on stage. */
  const baseFight = () => (state.fight?.extended ? state.extend?.base ?? state.fight : state.fight);

  function clearExtend() {
    state.extend = null;
    state.extendShown = null;
    ui.extend.querySelector('ol').innerHTML = '';
  }

  /** The head line: whether this moment is a deadlock, and the way to extend it. */
  function drawExtendHead() {
    const fight = state.fight;
    if (!fight) { ui.extend.hidden = true; return; }
    ui.extend.hidden = false;
    const ext = fight.extended;
    const base = baseFight();
    const t = ext ? ext.t : state.t;
    const span = deadlockIn(base?.deadlocks, t);
    const first = (base?.deadlocks ?? [])[0] ?? null;
    const key = `${span ? span.t0 : ''}:${Math.round(t * 10)}:${ext ? ext.way.id : ''}:${first ? first.t0 : ''}`;
    if (state.extendShown === key) return;
    state.extendShown = key;
    const words = ui.extend.querySelector('.dfs-extend-head > span');
    const acts = ui.extend.querySelector('.dfs-extend-acts');
    if (ext) {
      words.textContent = `${whoOf(ext.side)} ${ext.side === 1 && !fight.recorded ? 'fly' : 'flies'} "${ext.way.name.toLowerCase()}" from ${ext.t.toFixed(1)} s. ${resultWords(ext.score)}.`;
      acts.innerHTML = '<button type="button" class="dfs-chip" data-extend="back">Back to the fight</button>';
      return;
    }
    const sides = fight.recorded ? [0, 1] : [1];
    const runButtons = sides.map(side => `<button type="button" class="dfs-chip" data-extend="run" data-side="${side}" data-t="${t}">`
      + `${fight.recorded ? `Fly them for ${esc(fight.names[side])}` : 'Fly them'}</button>`).join('');
    const sinceWords = from => (from < 0.5 ? 'the start' : `${from.toFixed(0)} s`);
    if (span) {
      words.textContent = `${kindWords(span.kind)} since ${sinceWords(span.from)}, nobody's shot. The ways out from ${t.toFixed(1)} s:`;
      acts.innerHTML = runButtons;
    } else if (first) {
      words.textContent = `${kindWords(first.kind)} from ${sinceWords(first.from)} to ${first.t1.toFixed(0)} s (hatched on the chart). The ways out from ${t.toFixed(1)} s:`;
      acts.innerHTML = `<button type="button" class="dfs-chip" data-extend="seek" data-t="${first.t0}">Go to it</button>` + runButtons;
    } else {
      // No deadlock found, but the ways out fly from any moment.
      words.textContent = `No deadlock in this fight. The ways out from ${t.toFixed(1)} s:`;
      acts.innerHTML = runButtons;
    }
  }

  /** Fly every way out for `side` from `t`, and list them, best first. */
  async function runExtend(side, t) {
    const fight = baseFight();
    if (!fight) return;
    const list = ui.extend.querySelector('ol');
    list.innerHTML = '<li class="dfs-extend-busy">Flying the ways out on the flight law…</li>';
    state.playing = false;
    ui.toggle.textContent = 'Play';
    helperBusy(side, t);
    const i0 = Math.max(1, Math.min(fight.tracks[0].length - 2, Math.round(t / fight.dt)));
    let moment, opponent, makers, origin = fight.origin ?? [0, 0, 0], ground = () => 0;
    if (fight.recorded) {
      makers = (await airframes()) ?? [() => makePlane(), () => makePlane()];
      moment = { states: [0, 1].map(k => trackState(fight.tracks[k], i0)), mems: [{}, {}], throttles: [1, 1] };
      // Nobody knows what a recorded pilot would have done: the school's
      // hunter, who turns after you and gives up a chase he cannot close.
      opponent = { plan: 'btHunter', skill: 1 };
    } else {
      const sides = demoSides(fight.lesson, fight.demo);
      ground = () => groundY;
      moment = momentOf(sides, i0 * fight.dt, { makePlane, origin, groundAt: ground, dt: fight.dt });
      opponent = { plan: sides[1 - side].plan, memory: moment.mems[1 - side], skill: sides[1 - side].skill };
      makers = [() => makePlane(), () => makePlane()];
    }
    let w;
    try {
      w = await extendFrom(fight, side, i0, { ...moment, opponent, makePlanes: makers, origin, groundAt: ground,
                                               yieldTo: () => new Promise(r => setTimeout(r, 0)) });
    } catch (e) {
      console.warn('dogfight extend', e);
      list.innerHTML = '<li class="dfs-extend-busy">The ways out could not be flown here.</li>';
      helperFailed();
      return;
    }
    state.extend = { base: fight, side, t: w.t, i0: w.i0, results: w.results, actual: w.actual, row: state.recording?.row ?? null };
    drawExtendList();
    helperWays();
  }

  // --- the helper -----------------------------------------------------------------
  // The deadlock breaker as a card on the picture, the moment it applies:
  // when the fight on stage is six seconds into a deadlock the card asks
  // whether to see the ways out (the fight plays on meanwhile); yes holds
  // the fight and flies them from this moment, lists them best first, and
  // one click plays it from here with the card saying how it went, "Try
  // another" and "Back to the fight". No, or the span passing, puts it away
  // for that deadlock; it comes back on the next one, or on a restart.
  const helper = { step: null, key: null, seen: new Set(), side: 1, t: 0 };
  const helperUi = {
    kicker: ui.helper.querySelector('.dfs-helper-kicker'), title: ui.helper.querySelector('.dfs-helper-title'),
    words: ui.helper.querySelector('.dfs-helper-words'), ways: ui.helper.querySelector('.dfs-helper-ways'), acts: ui.helper.querySelector('.dfs-helper-acts'),
  };
  const helperKey = span => `${state.lesson?.id ?? ''}:${state.demo?.id ?? ''}:${state.recording?.row ?? ''}:${span.t0}`;
  const kindWords = kind => `${KIND_WORDS[kind][0].toUpperCase()}${KIND_WORDS[kind].slice(1)}`;

  function helperDraw(step, { kicker = '', title = '', words = '', ways = '', acts = '' }) {
    helper.step = step;
    ui.helper.dataset.step = step;
    helperUi.kicker.textContent = kicker;
    helperUi.title.textContent = title;
    helperUi.words.textContent = words;
    helperUi.ways.innerHTML = ways;
    helperUi.acts.innerHTML = acts;
    ui.helper.hidden = false;
  }

  function helperHide() {
    helper.step = null;
    ui.helper.hidden = true;
  }

  /** Put away for this deadlock, by the viewer or by the span passing. */
  function helperLater() {
    if (helper.key) helper.seen.add(helper.key);
    helperHide();
    // The notes still offer it.
    ui.notesBtn.classList.toggle('has-news', ui.notes.hidden);
  }

  /** Every frame: the offer, when the fight is in a deadlock nobody has answered. */
  function drawHelper() {
    const fight = state.fight;
    if (!fight) { if (helper.step) helperHide(); return; }
    if (helper.step && helper.step !== 'offer') return;
    if (fight.extended || !ui.end.hidden) { if (helper.step === 'offer') helperHide(); return; }
    const span = deadlockIn(fight.deadlocks, state.t);
    if (!span || state.t < span.t0) { if (helper.step === 'offer') helperLater(); return; }
    const key = helperKey(span);
    if (helper.seen.has(key)) { if (helper.step === 'offer') helperHide(); return; }
    const title = `Nobody has had a shot for ${Math.max(0, Math.round(state.t - span.from))} s`;
    if (helper.step === 'offer' && helper.key === key) {
      if (helperUi.title.textContent !== title) helperUi.title.textContent = title;
      return;
    }
    helper.key = key;
    const sides = fight.recorded ? [0, 1] : [1];
    helperDraw('offer', {
      kicker: `DEADLOCK · ${KIND_WORDS[span.kind].toUpperCase()}`, title,
      words: 'Want to see the school\'s ways out? Each one is flown from this moment, and you can watch any of them play from here.',
      acts: sides.map(side => `<button type="button" class="dfs-helper-btn is-primary" data-helper="show" data-side="${side}">${fight.recorded ? `Show me, for ${esc(fight.names[side])}` : 'Show me the ways out'}</button>`).join('')
        + '<button type="button" class="dfs-helper-btn" data-helper="later">Keep watching</button>',
    });
  }

  function helperBusy(side, t) {
    helper.side = side;
    helper.t = t;
    helperDraw('busy', { kicker: `WAYS OUT · FROM ${t.toFixed(1)} S`, title: 'Flying the ways out\u2026', words: 'Each one on the flight law, from exactly where the two of them stand.' });
  }

  function helperFailed() {
    helperDraw('ways', { kicker: 'WAYS OUT', title: 'The ways out could not be flown here', acts: '<button type="button" class="dfs-helper-btn" data-helper="later">Close</button>' });
  }

  /** The ways, best first, each a button that plays it from the moment. */
  function helperWays() {
    const x = state.extend;
    if (!x) { helperHide(); return; }
    const tag = sc => `<i class="dfs-extend-tag is-${sc.result}">${RESULT_TAGS[sc.result]}</i>`;
    const playing = !!state.fight?.extended;
    helperDraw('ways', {
      kicker: `WAYS OUT · FROM ${x.t.toFixed(1)} S`,
      title: playing ? 'Try another' : 'Pick one to watch it from here',
      ways: x.results.map((r, i) => (r.score
        ? `<li><button type="button" data-helper-way="${i}"${state.fight?.extended?.way?.id === r.way.id ? ' aria-pressed="true"' : ''}>${tag(r.score)}<b>${esc(r.way.name)}</b><small>${esc(resultWords(r.score))}</small></button></li>`
        : `<li class="is-off"><b>${esc(r.way.name)}</b><small>could not be flown</small></li>`)).join(''),
      acts: playing ? '<button type="button" class="dfs-helper-btn" data-helper="back">Back to the fight</button>'
        : '<button type="button" class="dfs-helper-btn" data-helper="later">Keep watching</button>',
    });
  }

  /** The way on stage: how it went, and the way back. */
  function helperPlaying(r) {
    helperDraw('playing', {
      kicker: `EXTENDED · FROM ${state.extend.t.toFixed(1)} S`, title: r.way.name,
      words: `${resultWords(r.score)}. ${r.way.what}.`,
      acts: '<button type="button" class="dfs-helper-btn is-primary" data-helper="ways">Try another</button><button type="button" class="dfs-helper-btn" data-helper="back">Back to the fight</button>',
    });
  }

  ui.helper.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.helperWay !== undefined) { playExtended(+b.dataset.helperWay); return; }
    switch (b.dataset.helper) {
      case 'show': runExtend(+b.dataset.side, state.t); break;
      case 'later': helperLater(); break;
      case 'ways': helperWays(); break;
      case 'back': leaveExtended(); break;
    }
  });

  function drawExtendList() {
    const x = state.extend;
    const list = ui.extend.querySelector('ol');
    if (!x) { list.innerHTML = ''; return; }
    const tag = sc => `<i class="dfs-extend-tag is-${sc.result}">${RESULT_TAGS[sc.result]}</i>`;
    // From the fight's last moment there is nothing left of it to compare
    // the ways out with: the row says where it stood instead.
    const left = (x.base?.duration ?? 0) - x.t;
    const actual = left < 0.5
      ? `<li class="dfs-extend-actual"><b>Where it ends</b><small>${esc(`${Math.round(x.actual.endRange ?? x.actual.minRange ?? 0)} m apart at ${x.t.toFixed(1)} s, nobody's shot`)}</small></li>`
      : `<li class="dfs-extend-actual">${tag(x.actual)}<b>If nothing changes</b><small>${esc(resultWords(x.actual))}</small></li>`;
    list.innerHTML = actual
      + x.results.map((r, i) => (r.score
        ? `<li><button type="button" data-ext="${i}">${tag(r.score)}<b>${esc(r.way.name)}<em>${esc(MOVE_INFO[r.way.kind]?.name ?? '')}</em></b>`
          + `<small>${esc(resultWords(r.score))}</small><small class="dfs-extend-what">${esc(r.way.what)}</small></button></li>`
        : `<li class="dfs-extend-actual"><b>${esc(r.way.name)}</b><small>could not be flown</small></li>`)).join('');
  }

  /** Play one way out as the fight's continuation from the moment. */
  function playExtended(i) {
    const x = state.extend, r = x?.results[i];
    if (!r?.flown) return;
    const spliced = prepare(spliceFight(x.base, x.i0, r.flown, r.way.name));
    spliced.extended = { side: x.side, t: x.t, way: r.way, score: r.score };
    if (x.base.recorded) {
      spliced.whatIf = { label: r.way.name, t: x.t, side: x.side, note: resultWords(r.score), extend: true };
      spliced.meta = x.base.meta;
      showRecorded(spliced, x.row, { at: Math.max(0, x.t - 2) });
    } else {
      stageLesson(spliced, { at: Math.max(0, x.t - 2) });
      ui.tcKicker.textContent = `EXTENDED · FROM ${x.t.toFixed(1)} S`;
      ui.tcTitle.textContent = r.way.name;
      ui.tcNote.textContent = `${resultWords(r.score)}. ${MOVE_INFO[r.way.kind]?.name ?? ''}: ${r.way.what}.`;
      ui.tc.classList.add('is-shown');
      clearTimeout(pickDemo.timer);
      pickDemo.timer = setTimeout(() => ui.tc.classList.remove('is-shown'), 4200);
    }
    ui.extend.querySelectorAll('button[data-ext]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.ext === i)));
    helperPlaying(r);
  }

  /** Back from an extension to the fight it came from, just before the moment. */
  function leaveExtended() {
    const x = state.extend;
    if (!x) return;
    helperLater();
    const at = Math.max(0, x.t - 2);
    if (x.base.recorded) showRecorded(x.base, x.row, { at });
    else if (state.lesson && state.demo) { pickDemo(state.lesson, state.demo.id); state.t = at; }
    ui.extend.querySelectorAll('button[data-ext]').forEach(b => b.setAttribute('aria-pressed', 'false'));
  }

  /** One sentence for the title card: what kind of fight, and its end. */
  function recordedSummary(fight) {
    const m = fight.meta, [a, b] = fight.names;
    const kind = m.mutual ? 'Both shooting' : m.kind === 'dogfight' ? 'A turning fight' : `${a} bounces ${b}`;
    const said = fight.ending?.words;
    const end = fight.end ? `${fight.names[fight.end.winner]} shoots ${fight.names[1 - fight.end.winner]} down at ${fight.end.t.toFixed(1)} s.`
      : said ? `It ends: ${said.short} at ${fight.ending.t.toFixed(1)} s.` : 'Nobody is shot down.';
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
      lines.push(`The kill: ${fight.names[w]}${weapon}. The recording proves ${m.proven[w]} hit${m.proven[w] === 1 ? '' : 's'} of theirs before it.`);
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
      return `${fight.names[s]} (${fight.planes[s]}): on the other's tail ${tail.toFixed(1)} s, chased ${chased.toFixed(1)} s; `
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

  // --- the room for the picture -----------------------------------------------------
  // The fight is the page: the list folds to a rail of its three parts, the
  // notes (the move, the counter, the numbers, WHAT IF) open beside the
  // picture on demand, and speed and camera are menus on the one bar under
  // it. Both panels' state is this browser's, kept across visits.
  const LIST_KEY = 'dogfight-school:list', NOTES_KEY = 'dogfight-school:notes';
  const remembered = key => { try { return localStorage.getItem(key); } catch { return null; } };
  const remember = (key, v) => { try { localStorage.setItem(key, v); } catch { /* private window */ } };
  /** A phone's width: the list and the notes cover the picture, not share it. */
  const narrow = () => typeof matchMedia === 'function' && matchMedia('(max-width: 760px)').matches;
  function setList(open, keep = true) {
    root.classList.toggle('is-list-closed', !open);
    ui.listToggle.setAttribute('aria-expanded', String(open));
    ui.listToggle.title = open ? 'Hide the list (L)' : 'Show the list (L)';
    ui.listToggle.querySelector('span').textContent = open ? 'Hide' : 'List';
    if (keep && !narrow()) remember(LIST_KEY, open ? 'open' : 'closed');
  }
  function setNotes(open, keep = true) {
    ui.notes.hidden = !open;
    root.classList.toggle('is-notes-open', open);
    ui.notesBtn.setAttribute('aria-expanded', String(open));
    if (keep && !narrow()) remember(NOTES_KEY, open ? 'open' : 'closed');
    if (open) ui.notesBtn.classList.remove('has-news');
  }
  const listOpen = () => !root.classList.contains('is-list-closed');
  ui.listToggle.addEventListener('click', () => setList(!listOpen()));
  ui.notesBtn.addEventListener('click', () => setNotes(ui.notes.hidden));
  root.querySelector('.dfs-notes-close').addEventListener('click', () => setNotes(false));
  // The score card's question opens the notes at how the scores are measured.
  root.querySelector('.dfs-score-how').addEventListener('click', () => {
    setNotes(true);
    ui.scoring.scrollIntoView({ block: 'start', behavior: 'smooth' });
    ui.scoring.classList.remove('is-lit'); void ui.scoring.offsetWidth; ui.scoring.classList.add('is-lit');
  });
  {
    // On a wide screen the list starts open (it is the way round the
    // school); on a phone, and wherever it was folded last, it starts shut.
    const kept = remembered(LIST_KEY);
    setList(!narrow() && (kept ? kept === 'open' : (typeof innerWidth !== 'number' || innerWidth >= 1360)), false);
    setNotes(!narrow() && remembered(NOTES_KEY) === 'open', false);
  }
  /** The bar's menus (speed, camera): one open at a time, shut by a pick,
   *  a click elsewhere or Esc. */
  function closeMenus() {
    for (const m of ui.menus) { m.querySelector('.dfs-pop').hidden = true; m.querySelector('.dfs-menu-btn').setAttribute('aria-expanded', 'false'); }
  }
  for (const m of ui.menus) {
    m.querySelector('.dfs-menu-btn').addEventListener('click', () => {
      const pop = m.querySelector('.dfs-pop'), was = pop.hidden;
      closeMenus();
      pop.hidden = !was;
      m.querySelector('.dfs-menu-btn').setAttribute('aria-expanded', String(was));
    });
  }
  root.addEventListener('pointerdown', e => { if (!e.target.closest('.dfs-menu')) closeMenus(); });

  // --- input ------------------------------------------------------------------------
  ui.lessons.innerHTML = LESSONS.map((l, i) => `
    <li data-section="lessons">${ROW} data-lesson="${l.id}"><span class="dfs-n">${String(i + 1).padStart(2, '0')}</span>
      <b>${esc(l.title)}</b><small>${esc(l.tagline)}</small>${l.survival ? `<em class="dfs-surv" data-verdict="${esc(l.survival.verdict)}">${l.survival.verdict === 'yes' ? 'Survivable' : l.survival.verdict === 'partly' ? 'Sometimes survivable' : 'No way out'}</em>` : ''}</div></li>`).join('')
    // The ring courses: stick and rudder, nobody shooting. Each flies
    // straight away.
    + (onFlyCourse ? `<li class="dfs-group" data-section="courses"><span>RING COURSES</span><small>Fly through the rings against the clock</small></li>`
      + COURSES.map((c, i) => `
    <li data-section="courses">${ROW} data-course="${c.id}"><span class="dfs-n">R${i + 1}</span>
      <b>${esc(c.title)}</b><small>${esc(c.tagline)}</small></div></li>`).join('') : '')
    // Real fights out of the round recordings.
    + `<li class="dfs-group" data-section="recordings"><span>FROM THE RECORDINGS</span><small>Dogfights real players flew, found in the round recordings</small></li>
    <li class="dfs-recs" data-section="recordings"><div class="dfs-recs-bar"><button type="button" class="dfs-chip" data-filter="dogfights">Dogfights</button>`
    + `<button type="button" class="dfs-chip" data-filter="all">Every attack</button></div>`
    + `<div class="dfs-recs-bar"><button type="button" class="dfs-chip" data-group="duration" title="Longest first; again for shortest first">Duration</button>`
    + `<button type="button" class="dfs-chip" data-group="date" title="Newest first; again for oldest first">Date</button><button type="button" class="dfs-chip" data-group="pilot">By pilot</button>`
    + `<small class="dfs-recs-count">loading</small></div><ol role="list"></ol></li>`;
  ui.sections.addEventListener('click', e => {
    const b = e.target.closest('button[data-section]');
    if (!b) return;
    // From the rail: open the list on that part; its own part again folds it.
    if (listOpen() && ui.lessons.dataset.show === b.dataset.section) { setList(false); return; }
    showSection(b.dataset.section);
    if (!listOpen()) setList(true);
  });
  // No ring courses on this page: no tab for them. On a fight's map, only
  // the recorded fights.
  if (!onFlyCourse || world) ui.sections.querySelector('[data-section="courses"]')?.remove();
  if (world) ui.sections.querySelector('[data-section="lessons"]')?.remove();
  showSection(world ? 'recordings' : 'lessons');
  // A row's keys: Enter or Space opens it, as a button's would (and Space
  // is not the school's play and pause here).
  ui.lessons.addEventListener('keydown', e => {
    const row = e.target.closest?.('.dfs-row');
    if (!row || (e.code !== 'Enter' && e.code !== 'Space' && e.code !== 'NumpadEnter')) return;
    e.preventDefault();
    e.stopPropagation();
    row.click();
  });
  ui.lessons.addEventListener('click', e => {
    // A drag that selected a row's text is a copy, not a pick.
    const picked = getSelection?.();
    if (e.target.closest('.dfs-row') && picked && !picked.isCollapsed && ui.lessons.contains(picked.anchorNode)) return;
    const f = e.target.closest('button[data-filter]');
    if (f) { recordedFilter = f.dataset.filter; drawRecorded(); return; }
    const g = e.target.closest('button[data-group]');
    if (g) {
      const to = g.dataset.group;
      if (to === 'pilot') {
        recordedGroup = 'pilot';
        recordedPilot = null;
      } else {
        // The active order clicked again flips it; another starts longest or
        // newest first.
        if (recordedGroup === to || (recordedGroup === 'pilot' && recordedPilot && recordedOrder === to)) recordedDesc = !recordedDesc;
        else recordedDesc = true;
        recordedOrder = to;
        // From the leaderboard, back to the whole list; in a pilot's own
        // fights, his fights in the new order.
        if (!(recordedGroup === 'pilot' && recordedPilot)) recordedGroup = to;
      }
      drawRecorded();
      return;
    }
    const who = e.target.closest('[data-pilot]');
    if (who) { recordedPilot = who.dataset.pilot || null; drawRecorded(); ui.lessons.querySelector('.dfs-recs')?.scrollIntoView({ block: 'start' }); return; }
    const r = e.target.closest('[data-recorded]');
    if (r && world) {
      // Another fight is another clip, maybe another map: its own page.
      const row = (recorded ?? []).find(x => x.id === r.dataset.recorded);
      if (!row?.clip || row.id === state.recording?.id) return;
      // As a layer in another school's window, that window loads it.
      if (embed) embed.pick(row.id);
      else location.href = worldUrl(row);
      return;
    }
    if (r) { pickRecorded(r.dataset.recorded); if (narrow()) setList(false); return; }
    const c = e.target.closest('[data-course]');
    if (c && onFlyCourse) { close(false); onFlyCourse(c.dataset.course); return; }
    const b = e.target.closest('[data-lesson]');
    if (b) { pickLesson(b.dataset.lesson); if (narrow()) setList(false); }
  });
  // The way in gives way to a click on the picture or any key.
  ui.stage.addEventListener('pointerdown', () => endIntro(), true);
  root.addEventListener('keydown', () => endIntro(), true);
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
  ui.end.addEventListener('click', e => {
    const b = e.target.closest('button[data-extend="run"]');
    if (!b) return;
    runExtend(+b.dataset.side, +b.dataset.t);
  });
  ui.extend.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.extend === 'run') { runExtend(+b.dataset.side, +b.dataset.t); return; }
    if (b.dataset.extend === 'seek' && state.fight) { state.t = +b.dataset.t; state.playing = false; ui.toggle.textContent = 'Play'; return; }
    if (b.dataset.extend === 'back') { leaveExtended(); return; }
    if (b.dataset.ext !== undefined) playExtended(+b.dataset.ext);
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
  // A step on the move card plays from a second before it.
  ui.steps.addEventListener('click', e => {
    const b = e.target.closest('button[data-step]');
    if (!b || !state.fight) return;
    state.t = Math.max(0, +b.dataset.step - 1);
    state.playing = true;
    ui.toggle.textContent = 'Pause';
    ui.end.hidden = true;
    state.hold = 0; ui.shot.hidden = true;
    for (const key of [...state.explained]) if (+key.split(':')[1] > state.t) state.explained.delete(key);
  });
  ui.demos.addEventListener('click', e => {
    const b = e.target.closest('button[data-demo]');
    if (b && state.lesson) { helper.seen.clear(); pickDemo(state.lesson, b.dataset.demo); }
  });
  ui.speeds.innerHTML = SPEEDS.map(v => `<button type="button" class="dfs-chip" data-speed="${v}">${v}x</button>`).join('')
    + '<button type="button" class="dfs-chip" data-slow="1" title="Slow the replay while the guns fire">Slow on shots</button>'
    + '<button type="button" class="dfs-chip" data-explain="1" title="Stop on every new kill shot and say how it came">Explain shots</button>';
  ui.cams.innerHTML = CAMERAS.map((c, i) => `<button type="button" class="dfs-chip" data-cam="${c.id}" data-key="${i + 1}">${c.label}</button>`).join('');
  const markChips = () => {
    ui.speeds.querySelectorAll('button[data-speed]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.speed === state.speed)));
    ui.speeds.querySelector('[data-slow]')?.setAttribute('aria-pressed', String(state.slowOnShots));
    ui.speeds.querySelector('[data-explain]')?.setAttribute('aria-pressed', String(state.explain));
    ui.cams.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.cam === state.camera)));
    ui.speedNow.textContent = `${state.speed}x`;
    ui.camNow.textContent = ui.cams.querySelector(`button[data-cam="${state.camera}"]`)?.textContent ?? '';
  };
  ui.speeds.addEventListener('click', e => {
    if (e.target.closest('button[data-slow]')) { state.slowOnShots = !state.slowOnShots; markChips(); return; }
    if (e.target.closest('button[data-explain]')) { state.explain = !state.explain; state.hold = 0; ui.shot.hidden = true; markChips(); return; }
    const b = e.target.closest('button[data-speed]');
    if (b) { state.speed = +b.dataset.speed; markChips(); closeMenus(); }
  });
  ui.cams.addEventListener('click', e => {
    const b = e.target.closest('button[data-cam]');
    if (b) { state.camera = b.dataset.cam; markChips(); closeMenus(); }
  });
  markChips();
  const togglePlay = () => {
    if (!state.fight) return;
    if (!state.playing && state.t >= state.fight.duration) state.t = state.startAt ?? 0;
    state.playing = !state.playing;
    ui.toggle.textContent = state.playing ? 'Pause' : 'Play';
  };
  ui.toggle.addEventListener('click', togglePlay);
  const rewind = () => { state.explained = new Set(); state.hold = 0; ui.shot.hidden = true; };
  ui.restart.addEventListener('click', () => { helper.seen.clear(); state.t = state.startAt ?? 0; state.playing = true; ui.toggle.textContent = 'Pause'; ui.end.hidden = true; rewind(); });
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
    // On a Dip, Flip or Ninja tab, that move is what you practise.
    const move = MOVE_NAMES[state.demo?.kind] ? state.demo.id : null;
    close(false);
    onFly(id, move);
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
    // In as far as you like: the camera stops WIDE_NEAREST metres short.
    state.orbit.zoom = Math.max(0.01, Math.min(3, state.orbit.zoom * Math.exp(e.deltaY * 0.001)));
  }, { passive: false });
  root.addEventListener('keydown', e => {
    // The school holds the keyboard while it is up.
    e.stopPropagation();
    // Typing in a field (none yet) keeps its keys.
    if (e.target.matches?.('input:not([type=range]), textarea')) return;
    const menuOpen = ui.menus.some(m => !m.querySelector('.dfs-pop').hidden);
    if (e.code === 'Escape' && menuOpen) { e.preventDefault(); closeMenus(); return; }
    if (e.code === 'KeyL' && !e.metaKey && !e.ctrlKey) { setList(!listOpen()); return; }
    if (e.code === 'KeyN' && !e.metaKey && !e.ctrlKey) { setNotes(ui.notes.hidden); return; }
    // X extends the scene from a deadlock at this moment (the other seat), the
    // live fight's key (E is the game's own: it leaves the plane).
    if (e.code === 'KeyX' && !e.metaKey && !e.ctrlKey && state.fight && !world) {
      const base = baseFight();
      const t = state.fight.extended ? state.fight.extended.t : state.t;
      if (deadlockIn(base?.deadlocks, t)) runExtend(1, t);
      return;
    }
    const digit = /^Digit([1-6])$/.exec(e.code);
    if (digit && !e.metaKey && !e.ctrlKey) { state.camera = CAMERAS[+digit[1] - 1].id; markChips(); return; }
    if ((e.code === 'Escape' || e.code === 'KeyV') && embed) { e.preventDefault(); embed.leave(state.t, state.playing); }
    else if (e.code === 'Escape' || e.code === 'KeyV') { e.preventDefault(); close(); }
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
  /** The arenas, the one chosen pressed: its two sides' fighters, and the
   *  battle it is flown over. */
  function drawArenas() {
    const list = arenas?.list() ?? [];
    ui.arenaBox.hidden = list.length < 2;
    const chosen = arenas?.current();
    // The arena flown in, on one line: the list of them opens under it.
    const now = list.find(a => a.map === chosen);
    ui.arenaNow.querySelector('b').textContent = now ? `${now.allied.map(prettyPlane).join(', ')} v ${now.axis.map(prettyPlane).join(', ')}` : '';
    ui.arenaNow.querySelector('small').textContent = now?.name ?? '';
    ui.arenaList.innerHTML = list.map(a => `<button type="button" role="radio" data-arena="${esc(a.map)}" aria-checked="${a.map === chosen}">`
      + `<b>${esc(a.allied.map(prettyPlane).join(', '))} v ${esc(a.axis.map(prettyPlane).join(', '))}</b><small>${esc(a.name)}</small></button>`).join('');
  }
  ui.arenaList.addEventListener('click', e => {
    const b = e.target.closest('button[data-arena]');
    if (!b || !arenas) return;
    arenas.pick(b.dataset.arena);
    drawArenas();
    ui.arenaList.hidden = true;
    ui.arenaNow.setAttribute('aria-expanded', 'false');
  });
  ui.arenaNow.addEventListener('click', () => {
    ui.arenaList.hidden = !ui.arenaList.hidden;
    ui.arenaNow.setAttribute('aria-expanded', String(!ui.arenaList.hidden));
  });
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
    drawArenas();
    drawPlanes();
    state.rule = (state.rule + 1) % RULES.length;
    ui.rule.textContent = RULES[state.rule];
    if (!world && (lessonId || !state.fight?.recorded)) pickLesson(lessonId ?? state.lesson?.id ?? LESSONS[0].id);
    loadRecorded();
    root.focus({ preventScroll: true });
    last = performance.now();
    requestAnimationFrame(frame);
  }

  function close(handBack = true) {
    if (!state.open) return;
    closeMap();
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
    /** Open on one recorded fight (the `world` page's way in). */
    openRecording: async (id, { at = 0 } = {}) => {
      open();
      await loadRecorded();
      await pickRecorded(id, { at });
    },
    /** The arena and plane choosers drawn again (the page changed them). */
    redrawChoices: () => { drawArenas(); drawPlanes(); },
    /** The page's planes changed (another arena or plane): every lesson is
     *  flown again on the new airframe, and the demo on stage at once, at
     *  the second it was at. A recorded fight keeps its own types. */
    planesChanged: () => {
      flown.clear();
      drawArenas(); drawPlanes();
      if (!state.open || world || !state.lesson || !state.demo || state.fight?.recorded) return;
      const { t, playing } = state;
      pickDemo(state.lesson, state.demo.id);
      state.t = Math.min(t, state.fight.duration);
      state.playing = playing;
      ui.toggle.textContent = playing ? 'Pause' : 'Play';
    },
    /** The map layer for the fight on stage (the LAYERS card's 3D map). */
    openMap: () => openMap(),
    /** Whether the map layer is loading or up, for the tests. */
    get mapLayer() { return mapFrame ? (mapFrame.ready ? 'up' : 'loading') : null; },
    /** The deadlocks in the fight on stage (tests). */
    get deadlocks() { return state.fight?.deadlocks ?? null; },
    /** Extend the scene from `t` for `side`, and play way `i` (tests). */
    extend: async (t, i = null, side = 1) => {
      if (!baseFight()) return null;
      await runExtend(side, t);
      if (i !== null) playExtended(i);
      const x = state.extend;
      return x ? { side: x.side, t: x.t, actual: x.actual, results: x.results.map(r => ({ id: r.way.id, name: r.way.name, score: r.score ?? null, error: r.error ?? null })),
                   onStage: state.fight?.extended ? { way: state.fight.extended.way.id, duration: state.fight.duration, at: state.t } : null } : null;
    },
    /** Back from the extension on stage (tests). */
    leaveExtended: () => leaveExtended(),
    /** The helper card as drawn (tests). */
    get helper() {
      return ui.helper.hidden ? null : { step: helper.step, kicker: helperUi.kicker.textContent, title: helperUi.title.textContent,
                                         ways: [...helperUi.ways.querySelectorAll('button')].map(b => b.textContent), acts: [...helperUi.acts.querySelectorAll('button')].map(b => b.dataset.helper) };
    },
    /** Press one of the helper's buttons (tests): `show`, `later`, `ways`, `back`, or a way's index. */
    helperAct: act => { const b = typeof act === 'number' ? helperUi.ways.querySelector(`button[data-helper-way="${act}"]`) : helperUi.acts.querySelector(`button[data-helper="${act}"]`); if (b) b.click(); return !!b; },
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
    /** Play a recorded fight by its id (`replays/dogfights/index.json`). */
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
    /** For the tests: the stage's size in CSS pixels, and how many pixels
     *  each drawn plane covers across (its widest on-screen extent) in the
     *  camera of the last frame. */
    get screen() {
      const s = gl, c = ui.canvas;
      const w = c.clientWidth, h = c.clientHeight;
      const planes = (s?.actors ?? []).map(a => {
        if (!s.view || !a.plane.visible) return null;
        const box = new THREE.Box3();
        a.plane.updateMatrixWorld(true);
        a.plane.traverse(o => { if (o.isMesh) { let v = true; for (let n = o; n; n = n.parent) if (!n.visible) v = false; if (v) box.expandByObject(o, true); } });
        if (box.isEmpty()) return null;
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (let k = 0; k < 8; k++) {
          _m.set(k & 1 ? box.max.x : box.min.x, k & 2 ? box.max.y : box.min.y, k & 4 ? box.max.z : box.min.z).project(s.view);
          const x = (_m.x * 0.5 + 0.5) * w, y = (-_m.y * 0.5 + 0.5) * h;
          x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        }
        return Math.round(Math.max(x1 - x0, y1 - y0));
      });
      return { stage: [w, h], planes };
    },
    flown: (lessonId, demoId) => {
      const l = lessonById(lessonId);
      const d = l?.demos.find(x => x.id === demoId);
      return l && d ? fly(l, d) : null;
    },
  };
}
