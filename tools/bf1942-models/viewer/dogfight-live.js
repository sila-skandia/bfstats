// The dogfight school's live fight (features/dogfight-school): the player in
// the air against one of the school's aces, on the proving ground. The ace is
// an ordinary bot whose seat the school flies (`bot.js` `ace`), so his
// airframe, guns and rounds are the world's; on the range his rounds hurt
// nobody, and the school counts the ones that met the player instead. The
// player's rounds are priced as ever: shoot him down and he is down.
//
// On screen, and no more: the coach (what he is doing, what beats it, the
// keys), the view (a window on the two of you: a camera behind you, looking
// past you at him, so where he is against you reads at a glance), a marker on
// him in the main view or an arrow at the edge pointing to him, and a line of
// score. The instructor (I) flies your seat through the lesson's counter
// until you touch the controls, his stick drawn while he does; Y starts the
// engagement again.

import { createPilot } from './dogfight-pilot.js';
import * as THREE from 'three';
import { stateOf, len, sub, basis, clamp, dot, unit } from './dogfight-flight.js';
import { placePlane, stage, KILL_HITS } from './dogfight-duel.js';
import { coach, TONE } from './dogfight-coach.js';
import { lessonById, KEY_WORDS } from './dogfight-lessons.js';

/** Frames of each pilot's trail the view keeps: about four seconds. */
const TRAIL_SAMPLES = 240;

/** Metres from the floor's middle past which the coach turns you back. */
const LEAVING = 2000;

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * `page` hands in, as getters and functions: `stage`, `centre()` (the fight's
 * x, z), `groundAt(x, z)`, `playerDrive()` (the aircraft drive he holds, or
 * null), `playerRoot()`, `seatPlayer()` (into a fighter of his airfield),
 * `aceBot()` (the bot to fly, seated in an aircraft or not), `aceRoot(bot)`,
 * `gunOf(bot)`, `snapPresentation()`, `openSchool(id)`, `keyboardTaken()`.
 */
export function createDogfightLive(page) {
  const hud = document.createElement('div');
  hud.className = 'dfl';
  hud.hidden = true;
  hud.innerHTML = `
    <div class="dfl-coach" data-tone="info">
      <span class="dfl-lesson"></span>
      <b class="dfl-line"></b>
      <span class="dfl-tip"></span>
      <span class="dfl-keys"></span>
      <div class="dfl-score"><span>his hits on you <b class="dfl-his">0</b></span><span>yours on him <b class="dfl-yours">0</b></span><span>kills <b class="dfl-kills">0 : 0</b></span></div>
    </div>
    <div class="dfl-mark" hidden><i></i><span></span></div>
    <div class="dfl-view">
      <svg class="dfl-view-svg" aria-hidden="true">
        <polyline class="dfl-trail is-you"></polyline><polyline class="dfl-trail is-him"></polyline>
        <line class="dfl-los"></line>
        <g class="dfl-pin is-you"><circle r="5"></circle><text dy="-10">YOU</text></g>
        <g class="dfl-pin is-him"><circle r="5"></circle><text dy="-10">HIM</text></g>
      </svg>
      <div class="dfl-view-foot"><span class="dfl-range"></span><span class="dfl-above"></span><span class="dfl-said"></span></div>
    </div>
    <div class="dfl-stick" hidden>
      <div class="dfl-pad"><i></i></div>
      <div class="dfl-throttle"><i></i></div>
      <div class="dfl-rudder"><i></i></div>
      <span class="dfl-who">INSTRUCTOR</span>
    </div>
    <div class="dfl-banner" hidden></div>
    <div class="dfl-foot"><kbd>Y</kbd> again <kbd>I</kbd> instructor <kbd>V</kbd> school <kbd>O</kbd> end the lesson</div>`;
  page.stage.appendChild(hud);
  const q = s => hud.querySelector(s);
  const ui = {
    coach: q('.dfl-coach'), lesson: q('.dfl-lesson'), line: q('.dfl-line'), tip: q('.dfl-tip'), keys: q('.dfl-keys'),
    mark: q('.dfl-mark'), markText: q('.dfl-mark span'),
    view: q('.dfl-view'), svg: q('.dfl-view-svg'), trailYou: q('.dfl-trail.is-you'), trailHim: q('.dfl-trail.is-him'),
    los: q('.dfl-los'), pinYou: q('.dfl-pin.is-you'), pinHim: q('.dfl-pin.is-him'),
    range: q('.dfl-range'), above: q('.dfl-above'), said: q('.dfl-said'),
    his: q('.dfl-his'), yours: q('.dfl-yours'), kills: q('.dfl-kills'),
    stick: q('.dfl-stick'), pad: q('.dfl-pad > i'), throttle: q('.dfl-throttle > i'), rudder: q('.dfl-rudder > i'),
    banner: q('.dfl-banner'),
  };

  const live = {
    lesson: null, phase: 'idle', t: 0, pilot: null, aceOut: null, bot: null, aceRoot: null,
    hisHits: 0, yourHits: 0, kills: [0, 0], instructor: false, instructorPilot: null, lastInput: null,
    bannerUntil: 0, clock: 0, seatAsked: 0, coachAt: 0, trail: [], placedAt: -1, downAt: null, wouldHaveDied: false,
    instructorOut: null, trails: { you: [], him: [] }, you: null, him: null,
  };

  function banner(text, seconds = 2.5, tone = 'info') {
    ui.banner.textContent = text;
    ui.banner.dataset.tone = tone;
    ui.banner.hidden = false;
    live.bannerUntil = live.clock + seconds;
  }

  function start(lessonId) {
    const lesson = lessonById(lessonId);
    if (!lesson) return false;
    live.lesson = lesson;
    live.phase = 'seating';
    live.hisHits = live.yourHits = 0;
    live.kills = [0, 0];
    live.instructor = false;
    live.seatAsked = 0;
    live.trails = { you: [], him: [] };
    hud.hidden = false;
    ui.lesson.textContent = `DOGFIGHT SCHOOL · ${lesson.title.toUpperCase()}`;
    banner(lesson.title.toUpperCase(), 3);
    return true;
  }

  function stop() {
    if (live.bot) live.bot.ace = null;
    live.bot = null;
    live.lesson = null;
    live.phase = 'idle';
    live.instructor = false;
    hud.hidden = true;
  }

  /** Both seats in the air at the lesson's start, the ace's pilot fresh. */
  function place() {
    const lesson = live.lesson;
    const drive = page.playerDrive();
    const bot = live.bot;
    const aceDrive = bot?.vehicle?.drive;
    if (!drive || !aceDrive) return false;
    const [cx, cz] = page.centre();
    const gy = page.groundAt(cx, cz);
    const origin = [cx, gy, cz];
    placePlane(drive, stage(origin, lesson.you.start));
    placePlane(aceDrive, stage(origin, lesson.ace.start));
    for (const d of [drive, aceDrive]) {
      if (d.state) d.state.grounded = false;
      d.state?.angularVelocity?.set?.(0, 0, 0);
    }
    bot._airborne = true;
    live.pilot = createPilot(lesson.ace.plan, { gun: page.gunOf?.(bot) ?? {} });
    Object.assign(live.pilot.mem, structuredClone(lesson.ace.memory ?? {}));
    live.instructorPilot = null;
    live.origin = origin;
    live.t = 0;
    live.trails = { you: [], him: [] };
    live.placedAt = live.clock;
    live.downAt = null;
    live.wouldHaveDied = false;
    live.hisHits = live.yourHits = 0;
    page.snapPresentation?.();
    live.phase = 'fight';
    bot.ace = flyAce;
    return true;
  }

  /** The bot's seat, a tick at a time (`bot.js` calls it after the plan). */
  function flyAce(bot, dt) {
    if (!live.lesson || live.phase !== 'fight' || bot !== live.bot) { bot.ace = null; return; }
    const me = stateOf(bot.vehicle?.drive?.state);
    const youDrive = page.playerDrive();
    const him = stateOf(youDrive?.state);
    if (!me) return;
    if (!him) {
      // The player is not in the air: the ace holds a gentle climb and waits.
      bot._airInput = { power: 0.8, throttle: 0.8, roll: 0, pitch: -0.05, rudder: 0 };
      bot.isFiring = false;
      return;
    }
    const out = live.pilot.step({ me, him, dt, t: live.t, groundAt: page.groundAt, ceilingBase: 0 });
    live.aceOut = out;
    bot._airInput = { power: out.throttle, throttle: out.throttle, roll: out.stick.roll, pitch: out.stick.pitch,
                      rudder: out.stick.rudder };
    bot._airborne = true;
    // The guns, never the bombs.
    const guns = (bot.weapons ?? []).findIndex(w => w?.weaponFire !== 'PIAltFire');
    if (guns >= 0) bot.weaponIndex = guns;
    bot.isFiring = !!out.fire;
  }

  /** The instructor's hands on the player's seat: the lesson's counter, until
   *  the player moves a control himself. */
  function flightOverride(input) {
    live.lastInput = { roll: input.roll, pitch: input.pitch, rudder: input.rudder, throttle: input.forwardKeys, fire: input.fire };
    if (!live.instructor || live.phase !== 'fight') return;
    const touched = Math.abs(input.roll) > 0.12 || Math.abs(input.pitch) > 0.12 || Math.abs(input.rudder) > 0.3
      || Math.abs(input.forwardKeys) > 0.3 || input.fire;
    if (touched && live.clock - live.instructorSince > 0.6) {
      live.instructor = false;
      banner('YOU HAVE CONTROL', 2, 'go');
      return;
    }
    const me = stateOf(page.playerDrive()?.state);
    const him = stateOf(live.bot?.vehicle?.drive?.state);
    if (!me || !him) return;
    if (!live.instructorPilot) {
      const plan = live.lesson.demos.find(d => d.id === 'counter')?.seat ?? 'meetTheDive';
      live.instructorPilot = createPilot(plan, { skill: 0.9 });
      Object.assign(live.instructorPilot.mem, structuredClone(live.lesson.you.memory ?? {}));
    }
    const out = live.instructorPilot.step({ me, him, dt: live.frameDt ?? 1 / 60, t: live.t, groundAt: page.groundAt, ceilingBase: 0 });
    live.instructorOut = out;
    input.forwardKeys = out.throttle;
    input.forward = out.throttle;
    input.roll = out.stick.roll;
    input.pitch = out.stick.pitch;
    input.rudder = out.stick.rudder;
    input.fire = !!out.fire;
  }

  function toggleInstructor() {
    if (live.phase !== 'fight') return;
    live.instructor = !live.instructor;
    live.instructorSince = live.clock;
    live.instructorPilot = null;
    banner(live.instructor ? 'INSTRUCTOR FLYING · move the stick to take over' : 'YOU HAVE CONTROL', 2.5, live.instructor ? 'warn' : 'go');
  }

  /** A round the world landed: the ace's on the player's aircraft count. */
  function noteImpact(record, firerId) {
    if (live.phase !== 'fight' || !live.bot || firerId == null) return;
    const root = page.playerRoot?.();
    // A hull's hit names its owner id; the page's damage table has its node.
    const struck = typeof record.owner === 'number' ? page.ownerNode?.(record.owner) ?? null : record.owner;
    if (firerId === live.bot.playerId && root && isUnder(struck, root)) {
      live.hisHits++;
      if (live.hisHits >= KILL_HITS && !live.wouldHaveDied) {
        live.wouldHaveDied = true;
        live.kills[1]++;
        banner('HE WOULD HAVE SHOT YOU DOWN · Y to go again', 4, 'danger');
      }
    }
    if (live.aceRoot && isUnder(struck, live.aceRoot) && firerId === page.localId) live.yourHits++;
  }

  function frame(dt) {
    live.clock += dt;
    live.frameDt = dt;
    if (!ui.banner.hidden && live.clock > live.bannerUntil) ui.banner.hidden = true;
    if (!live.lesson) return;
    if (page.covered?.()) { hud.style.visibility = 'hidden'; return; }
    hud.style.visibility = '';
    live.t += dt;
    const bot = page.aceBot?.() ?? null;
    if (bot !== live.bot) { if (live.bot) live.bot.ace = null; live.bot = bot; }
    live.aceRoot = bot ? page.aceRoot?.(bot) ?? null : null;
    const drive = page.playerDrive();
    if (live.phase === 'seating' || live.phase === 'down') {
      if (!bot) {
        setCoach({ tone: TONE.warn, line: 'Waiting for the enemy pilot', tip: 'He is walking to his aircraft.', keys: [] });
      } else if (!drive) {
        if (live.clock - live.seatAsked > 3) { live.seatAsked = live.clock; page.seatPlayer?.(); }
        setCoach({ tone: TONE.info, line: 'Getting you into a fighter', tip: '', keys: [] });
      } else if (!bot.vehicle?.drive || bot.vehicle.kind !== 'air') {
        setCoach({ tone: TONE.info, line: 'He is climbing into his aircraft', tip: '', keys: [] });
      } else if (live.phase === 'down' && live.clock - live.downAt < 3.5) {
        // a pause on the kill
      } else {
        place();
        banner('FIGHT', 1.6, 'go');
      }
      drawStick(live.lastInput, false);
      return;
    }
    // The fight. Is he down?
    const aceDown = !bot?.vehicle || bot.vehicle.kind !== 'air' || page.isWreck?.(live.aceRoot);
    if (aceDown) {
      live.kills[0]++;
      live.phase = 'down';
      live.downAt = live.clock;
      if (bot) bot.ace = null;
      banner('YOU SHOT HIM DOWN', 3.5, 'go');
      return;
    }
    if (!drive) {
      live.phase = 'down';
      live.downAt = live.clock;
      bot.ace = null;
      banner('YOU ARE DOWN · back up in a moment', 3.5, 'danger');
      return;
    }
    if (bot.ace !== flyAce) bot.ace = flyAce;
    const you = stateOf(drive.state), him = stateOf(bot.vehicle.drive.state);
    if (live.clock - live.coachAt > 0.12) {
      live.coachAt = live.clock;
      const words = coach(live.lesson, live.aceOut, you, him, { ground: page.groundAt(you.position[0], you.position[2]) });
      const rc = page.rangeCentre?.();
      if (rc && Math.hypot(you.position[0] - rc[0], you.position[2] - rc[1]) > LEAVING) {
        Object.assign(words, { tone: TONE.warn, line: 'You are leaving the range', tip: 'Turn back toward the floor: the fight goes on there.', keys: ['Mouse', 'Arrows'] });
      }
      setCoach(words);
      ui.said.textContent = live.aceOut?.say ? `"${toYou(live.aceOut.say)}"` : '';
      ui.his.textContent = String(live.hisHits);
      ui.yours.textContent = String(live.yourHits);
      ui.kills.textContent = `${live.kills[0]} : ${live.kills[1]}`;
      const range = len(sub(him.position, you.position));
      const dh = him.position[1] - you.position[1];
      ui.range.textContent = `${Math.round(range)} m`;
      ui.above.textContent = Math.abs(dh) < 15 ? 'level with you' : dh > 0 ? `${Math.round(dh)} m above` : `${Math.round(-dh)} m below`;
    }
    live.trails.you.push(you.position.slice());
    live.trails.him.push(him.position.slice());
    for (const t of Object.values(live.trails)) if (t.length > TRAIL_SAMPLES) t.shift();
    live.you = you;
    live.him = him;
    markHim(you, him);
    const showing = live.instructor && live.instructorOut
      ? { roll: live.instructorOut.stick.roll, pitch: live.instructorOut.stick.pitch, rudder: live.instructorOut.stick.rudder, throttle: live.instructorOut.throttle }
      : null;
    drawStick(showing, live.instructor);
  }

  let coachKey = '';
  function setCoach(w) {
    const key = `${w.tone}|${w.line}|${w.tip}`;
    if (key === coachKey) return;
    coachKey = key;
    ui.coach.dataset.tone = w.tone;
    ui.line.textContent = w.line;
    ui.tip.textContent = w.tip ?? '';
    ui.keys.innerHTML = (w.keys ?? []).map(k => `<kbd>${esc(KEY_WORDS[k] ?? k)}</kbd>`).join('');
    ui.coach.classList.remove('is-new');
    void ui.coach.offsetWidth;
    ui.coach.classList.add('is-new');
  }

  /**
   * Him in the main view: a ring on him with the range when he is in front
   * of the camera and on screen, else an arrow at the edge of the screen
   * pointing the way to turn to find him.
   */
  const _p = new THREE.Vector3(), _c = new THREE.Vector3();
  function markHim(you, him) {
    const cam = page.camera?.();
    const el = page.stage;
    if (!cam || !el) { ui.mark.hidden = true; return; }
    const w = el.clientWidth, h = el.clientHeight;
    // Where he is in the camera's own frame: x right, y up, z back.
    cam.updateMatrixWorld();
    _c.set(him.position[0], him.position[1], him.position[2]).applyMatrix4(cam.matrixWorldInverse);
    const ahead = _c.z < 0;
    _p.set(him.position[0], him.position[1], him.position[2]).project(cam);
    const onScreen = ahead && Math.abs(_p.x) < 0.92 && Math.abs(_p.y) < 0.86;
    const range = Math.round(len(sub(him.position, you.position)));
    ui.mark.hidden = false;
    ui.mark.classList.toggle('is-edge', !onScreen);
    if (onScreen) {
      ui.mark.style.transform = `translate(${(_p.x * 0.5 + 0.5) * w}px, ${(-_p.y * 0.5 + 0.5) * h}px)`;
      ui.markText.textContent = `${range} m`;
      return;
    }
    // Off the screen: an arrow on its edge, pointing the way he is. Behind
    // you, the arrow leans to the bottom edge however little he is off the
    // tail, so "behind" always reads as down.
    let dx = _c.x, dy = _c.y;
    if (!ahead) dy -= Math.abs(_c.z) * 0.6;
    const l = Math.hypot(dx, dy) || 1;
    dx /= l; dy /= l;
    const k = Math.min(0.9 / Math.max(Math.abs(dx), 1e-3), 0.8 / Math.max(Math.abs(dy), 1e-3));
    const ex = dx * k, ey = dy * k;
    ui.mark.style.transform = `translate(${(ex * 0.5 + 0.5) * w}px, ${(-ey * 0.5 + 0.5) * h}px)`;
    ui.mark.style.setProperty('--a', `${Math.atan2(-dy, dx)}rad`);
    ui.markText.textContent = `${range} m${ahead ? '' : ' behind'}`;
  }

  /**
   * The view: the world drawn again into its window, from behind you and a
   * little above, looking past you at him, so the two of you are always in
   * it; each of you pinned and trailed over it. Called by the page after its
   * own render (`proving-ground-page.js` `renderInset`).
   */
  const viewCam = new THREE.PerspectiveCamera(48, 1.6, 2, 6000);
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _m = new THREE.Vector3();
  const _vp = new THREE.Vector4(), _sc = new THREE.Vector4();
  function renderInset(renderer) {
    const you = live.you, him = live.him;
    if (hud.hidden || live.phase !== 'fight' || !you || !him || hud.style.visibility === 'hidden') return;
    const scene = page.scene?.();
    if (!scene) return;
    const el = renderer.domElement;
    const cr = el.getBoundingClientRect();
    const fr = ui.view.getBoundingClientRect();
    if (!cr.width || !fr.width) return;
    // Behind you on the line from him to you, raised a third of the way up,
    // far enough back that both fit.
    _a.set(...you.position);
    _b.set(...him.position);
    const range = _a.distanceTo(_b);
    const back = clamp(range * 0.45, 45, 320);
    const los = _m.copy(_b).sub(_a).normalize();
    viewCam.position.copy(_a).addScaledVector(los, -back).add(new THREE.Vector3(0, back * 0.35 + 10, 0));
    viewCam.lookAt(_m.copy(_a).lerp(_b, 0.45));
    viewCam.aspect = fr.width / fr.height;
    viewCam.updateProjectionMatrix();
    viewCam.updateMatrixWorld();
    const sx = el.width / cr.width, sy = el.height / cr.height;
    renderer.getViewport(_vp);
    renderer.getScissor(_sc);
    const test = renderer.getScissorTest(), clear = renderer.autoClear;
    const x = (fr.left - cr.left) * sx, y = (cr.bottom - fr.bottom) * sy, w = fr.width * sx, h = fr.height * sy;
    renderer.setViewport(x, y, w, h);
    renderer.setScissor(x, y, w, h);
    renderer.setScissorTest(true);
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(scene, viewCam);
    renderer.autoClear = clear;
    renderer.setScissorTest(test);
    renderer.setScissor(_sc);
    renderer.setViewport(_vp);
    // The pins and trails, over it.
    const W = fr.width, H = fr.height;
    ui.svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const toView = p => {
      _m.set(p[0], p[1], p[2]).project(viewCam);
      return _m.z > 1 ? null : [(_m.x * 0.5 + 0.5) * W, (-_m.y * 0.5 + 0.5) * H];
    };
    const line = (el2, pts) => el2.setAttribute('points', pts.map(toView).filter(Boolean).map(q => q.map(v => v.toFixed(1)).join(',')).join(' '));
    line(ui.trailYou, live.trails.you);
    line(ui.trailHim, live.trails.him);
    const py = toView(you.position), ph = toView(him.position);
    for (const [pin, pt] of [[ui.pinYou, py], [ui.pinHim, ph]]) {
      pin.style.display = pt ? '' : 'none';
      if (pt) pin.setAttribute('transform', `translate(${pt[0].toFixed(1)},${pt[1].toFixed(1)})`);
    }
    if (py && ph) {
      ui.los.setAttribute('x1', py[0]); ui.los.setAttribute('y1', py[1]);
      ui.los.setAttribute('x2', ph[0]); ui.los.setAttribute('y2', ph[1]);
    }
  }

  function drawStick(k, instructor) {
    ui.stick.hidden = !instructor;
    if (!instructor || !k) return;
    ui.pad.style.transform = `translate(${clamp(k.roll ?? 0) * 26}px, ${clamp(k.pitch ?? 0) * 26}px)`;
    ui.throttle.style.height = `${(clamp(k.throttle ?? 0) * 0.5 + 0.5) * 100}%`;
    ui.rudder.style.transform = `translateX(${clamp(k.rudder ?? 0) * 26}px)`;
  }

  function key(e) {
    if (!live.lesson) return false;
    if (e.code === 'KeyY') {
      if (live.phase === 'fight' && place()) banner('AGAIN', 1.4, 'go');
      else live.phase = 'seating';
      return true;
    }
    if (e.code === 'KeyI') { toggleInstructor(); return true; }
    if (e.code === 'KeyO') { stop(); return true; }
    return false;
  }

  return {
    start, stop, frame, key, flightOverride, noteImpact, toggleInstructor, renderInset,
    get active() { return !!live.lesson; },
    get state() {
      return {
        lesson: live.lesson?.id ?? null, phase: live.phase, acePhase: live.aceOut?.phase ?? null, aceSays: live.aceOut?.say ?? null,
        hisHits: live.hisHits, yourHits: live.yourHits, kills: [...live.kills], instructor: live.instructor,
        coach: { tone: ui.coach.dataset.tone, line: ui.line.textContent, tip: ui.tip.textContent },
        bot: live.bot?.playerId ?? null,
        you: stateOf(page.playerDrive()?.state)?.position?.map(Math.round) ?? null,
        him: stateOf(live.bot?.vehicle?.drive?.state)?.position?.map(Math.round) ?? null,
        aceSpeed: Math.round(len(stateOf(live.bot?.vehicle?.drive?.state)?.velocity ?? [0, 0, 0])),
        fire: !!live.aceOut?.fire, t: +live.t.toFixed(1), gun: live.pilot?.gun ?? null,
      };
    },
  };
}

/**
 * The ace's own words turned to the player: the school's pilots talk about
 * "him", and in the live fight "him" is you.
 */
export function toYou(say) {
  return String(say)
    .replace(/\bhe is\b/gi, m => (m[0] === 'H' ? 'You are' : 'you are'))
    .replace(/\bhe\b/g, 'you').replace(/\bHe\b/g, 'You')
    .replace(/\bhim\b/g, 'you').replace(/\bhis\b/g, 'your').replace(/\bHis\b/g, 'Your');
}

function isUnder(node, root) {
  for (let n = node; n; n = n.parent) if (n === root) return true;
  return false;
}
