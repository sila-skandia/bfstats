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
// score. Under it, the guide: what to do with the stick right now, as
// arrows and keys, from a pilot flying the lesson's counter in your seat
// (G hides it). The instructor (I) flies your seat through that counter
// until you touch the controls. Show me (P) freezes the fight, flies the
// next seconds both ways (the counter, and holding on as you are) and
// plays them as ghosts with the guide showing the counter's hands, then
// puts you back at the frozen moment to fly it. Y starts the engagement
// again.

import { createPilot } from './dogfight-pilot.js';
import * as THREE from 'three';
import { stateOf, len, sub, basis, clamp, dot, unit } from './dogfight-flight.js';
import { placePlane, stage, runDuel, KILL_HITS } from './dogfight-duel.js';
import { coach, TONE } from './dogfight-coach.js';
import { lessonById, KEY_WORDS } from './dogfight-lessons.js';

/** Frames of each pilot's trail the view keeps: about four seconds. */
const TRAIL_SAMPLES = 240;

/** Seconds of the fight Show me flies ahead, and the count before it is
 *  yours again. */
const PREVIEW_SECONDS = 10;
const COUNTDOWN = 2;
/** The guide's smoothing (seconds) and the deflection below which a
 *  channel says nothing. */
const GUIDE_TAU = 0.25;
const DEAD = 0.2;

/** Metres from the floor's middle past which the coach turns you back. */
const LEAVING = 3500;
/** Metres from the floor's middle past which the ace and the instructor turn
 *  back toward it (`dogfight-pilot.js` `fence`): inside the coach's warning
 *  and well inside the range's 10 km combat area (`proving-ground.js`
 *  `PG.ARENA`). */
const FENCE = 2600;

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
    <div class="dfl-guide" hidden>
      <span class="dfl-guide-head">DO THIS</span>
      <div class="dfl-guide-body">
        <div class="dfl-gate-box"><svg class="dfl-gate" viewBox="-50 -50 100 100" aria-hidden="true">
          <circle class="dfl-gate-ring" r="36"></circle>
          <line class="dfl-gate-axis" x1="-36" y1="0" x2="36" y2="0"></line>
          <line class="dfl-gate-axis" x1="0" y1="-36" x2="0" y2="36"></line>
          <path class="dfl-arrow" data-dir="up" d="M0,-49 L-7,-40 L7,-40 Z"></path>
          <path class="dfl-arrow" data-dir="down" d="M0,49 L-7,40 L7,40 Z"></path>
          <path class="dfl-arrow" data-dir="left" d="M-49,0 L-40,-7 L-40,7 Z"></path>
          <path class="dfl-arrow" data-dir="right" d="M49,0 L40,-7 L40,7 Z"></path>
          <line class="dfl-want-line" x1="0" y1="0" x2="0" y2="0"></line>
          <circle class="dfl-want" r="6"></circle>
          <circle class="dfl-have" r="8"></circle>
        </svg><small>up is nose up</small></div>
        <ul class="dfl-guide-rows"></ul>
      </div>
    </div>
    <div class="dfl-preview" hidden>
      <small class="dfl-pv-kicker"></small>
      <b class="dfl-pv-title"></b>
      <ol class="dfl-pv-steps"></ol>
      <div class="dfl-pv-outcome"><span class="is-fly"></span><span class="is-hold"></span></div>
      <span class="dfl-pv-foot"></span>
    </div>
    <div class="dfl-banner" hidden></div>
    <div class="dfl-foot"><kbd>P</kbd> show me <kbd>G</kbd> guide <kbd>I</kbd> instructor <kbd>Y</kbd> again <kbd>V</kbd> school <kbd>O</kbd> end</div>`;
  page.stage.appendChild(hud);
  const q = s => hud.querySelector(s);
  const ui = {
    coach: q('.dfl-coach'), lesson: q('.dfl-lesson'), line: q('.dfl-line'), tip: q('.dfl-tip'), keys: q('.dfl-keys'),
    mark: q('.dfl-mark'), markText: q('.dfl-mark span'),
    view: q('.dfl-view'), svg: q('.dfl-view-svg'), trailYou: q('.dfl-trail.is-you'), trailHim: q('.dfl-trail.is-him'),
    los: q('.dfl-los'), pinYou: q('.dfl-pin.is-you'), pinHim: q('.dfl-pin.is-him'),
    range: q('.dfl-range'), above: q('.dfl-above'), said: q('.dfl-said'),
    his: q('.dfl-his'), yours: q('.dfl-yours'), kills: q('.dfl-kills'),
    guide: q('.dfl-guide'), guideHead: q('.dfl-guide-head'), rows: q('.dfl-guide-rows'),
    want: q('.dfl-want'), wantLine: q('.dfl-want-line'), have: q('.dfl-have'), arrows: [...hud.querySelectorAll('.dfl-arrow')],
    preview: q('.dfl-preview'), pvKicker: q('.dfl-pv-kicker'), pvTitle: q('.dfl-pv-title'), pvSteps: q('.dfl-pv-steps'),
    pvFly: q('.dfl-pv-outcome .is-fly'), pvHold: q('.dfl-pv-outcome .is-hold'), pvFoot: q('.dfl-pv-foot'),
    banner: q('.dfl-banner'),
  };

  const live = {
    lesson: null, phase: 'idle', t: 0, pilot: null, aceOut: null, bot: null, aceRoot: null,
    hisHits: 0, yourHits: 0, kills: [0, 0], instructor: false, guidePilot: null, lastInput: null,
    bannerUntil: 0, clock: 0, seatAsked: 0, coachAt: 0, trail: [], placedAt: -1, downAt: null, wouldHaveDied: false,
    instructorOut: null, trails: { you: [], him: [] }, you: null, him: null,
    guideOn: true, guide: { pitch: 0, roll: 0, rudder: 0, throttle: 1, fire: 0 }, guideOut: null, preview: null,
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
    endPreview(false);
    if (live.bot) live.bot.ace = null;
    live.bot = null;
    live.lesson = null;
    live.phase = 'idle';
    live.instructor = false;
    hud.hidden = true;
  }

  /** The fence the school's pilots fly inside, round the floor's middle. */
  function arena() {
    const rc = page.rangeCentre?.();
    return rc ? { centre: rc, radius: FENCE } : null;
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
    live.guidePilot = null;
    endPreview(false);
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
    if (live.preview) { bot.isFiring = false; return; }
    if (!him) {
      // The player is not in the air: the ace holds a gentle climb and waits.
      bot._airInput = { power: 0.8, throttle: 0.8, roll: 0, pitch: -0.05, rudder: 0 };
      bot.isFiring = false;
      return;
    }
    const out = live.pilot.step({ me, him, dt, t: live.t, groundAt: page.groundAt, ceilingBase: 0, arena: arena() });
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
    if (live.preview) { input.fire = false; return; }
    if (!live.instructor || live.phase !== 'fight') return;
    const touched = Math.abs(input.roll) > 0.12 || Math.abs(input.pitch) > 0.12 || Math.abs(input.rudder) > 0.3
      || Math.abs(input.forwardKeys) > 0.3 || input.fire;
    if (touched && live.clock - live.instructorSince > 0.6) {
      live.instructor = false;
      banner('YOU HAVE CONTROL', 2, 'go');
      return;
    }
    const out = live.guideOut;
    if (!out) return;
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
    banner(live.instructor ? 'INSTRUCTOR FLYING · move the stick to take over' : 'YOU HAVE CONTROL', 2.5, live.instructor ? 'warn' : 'go');
  }

  /** A round the world landed: the ace's on the player's aircraft count. */
  function noteImpact(record, firerId) {
    if (live.phase !== 'fight' || live.preview || !live.bot || firerId == null) return;
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
      ui.guide.hidden = true;
      return;
    }
    if (live.preview) { framePreview(dt); return; }
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
    // The guide: the counter's pilot flies your seat in his head, a frame
    // at a time, and his stick, smoothed, is what the guide says.
    if (!live.guidePilot) live.guidePilot = guidePilot();
    const out = live.guidePilot.step({ me: you, him, dt, t: live.t, groundAt: page.groundAt, ceilingBase: 0, arena: arena() });
    live.guideOut = out;
    const a = 1 - Math.exp(-dt / GUIDE_TAU);
    const g = live.guide;
    g.pitch += (out.stick.pitch - g.pitch) * a;
    g.roll += (out.stick.roll - g.roll) * a;
    g.rudder += (out.stick.rudder - g.rudder) * a;
    g.throttle += ((out.throttle ?? 1) - g.throttle) * a;
    g.fire = out.fire ? 1 : Math.max(0, g.fire - dt * 3);
    drawGuide(g, live.lastInput, live.instructor ? 'INSTRUCTOR FLYING · touch the stick to take over' : 'DO THIS');
  }

  /** The pilot the guide and the instructor fly: the lesson's counter. */
  function guidePilot() {
    const plan = live.lesson.demos.find(d => d.id === 'counter')?.seat ?? 'meetTheDive';
    const p = createPilot(plan, { skill: 0.9, gun: page.gunOf?.(live.bot) ?? {} });
    Object.assign(p.mem, clone(live.lesson.you.memory ?? {}));
    return p;
  }

  // --- the guide --------------------------------------------------------------

  /**
   * What to do with the stick, drawn: the gate with the stick where it
   * should be (the filled dot) and where yours is (the ring), the arrows
   * lit the way to move it, and a row per control with its keys. Up is
   * the nose going up. A row turns green while you are doing it.
   */
  function drawGuide(k, mine, head) {
    ui.guide.hidden = !live.guideOn && !live.preview && !live.instructor;
    if (ui.guide.hidden) return;
    ui.guideHead.textContent = head;
    const up = -clamp(k.pitch ?? 0), right = clamp(k.roll ?? 0);
    ui.want.setAttribute('cx', (right * 34).toFixed(1));
    ui.want.setAttribute('cy', (-up * 34).toFixed(1));
    ui.wantLine.setAttribute('x2', (right * 34).toFixed(1));
    ui.wantLine.setAttribute('y2', (-up * 34).toFixed(1));
    const myUp = -clamp(mine?.pitch ?? 0), myRight = clamp(mine?.roll ?? 0);
    ui.have.setAttribute('cx', (myRight * 34).toFixed(1));
    ui.have.setAttribute('cy', (-myUp * 34).toFixed(1));
    const lit = { up: Math.max(0, up), down: Math.max(0, -up), right: Math.max(0, right), left: Math.max(0, -right) };
    for (const el of ui.arrows) {
      const v = lit[el.dataset.dir];
      el.style.opacity = String(v > DEAD ? 0.45 + 0.55 * Math.min(1, v) : 0.12);
    }
    const near = (a, b) => Math.abs(a - b) < 0.35 || (Math.sign(a) === Math.sign(b) && Math.abs(b) > Math.abs(a) * 0.6);
    ui.have.classList.toggle('is-match', !!mine && Math.hypot(myUp - up, myRight - right) < 0.35);
    const rows = [];
    const hard = v => (Math.abs(v) > 0.7 ? 'hard ' : '');
    if (up > DEAD) rows.push(['pitch', `Pull ${hard(up)}· nose up`, 'down', ['\u2193', 'mouse back'], near(up, myUp)]);
    else if (up < -DEAD) rows.push(['pitch', `Push ${hard(up)}· nose down`, 'up', ['\u2191', 'mouse forward'], near(up, myUp)]);
    if (right > DEAD) rows.push(['roll', `Roll ${hard(right)}right`, 'roll-right', ['\u2192', 'mouse right'], near(right, myRight)]);
    else if (right < -DEAD) rows.push(['roll', `Roll ${hard(right)}left`, 'roll-left', ['\u2190', 'mouse left'], near(right, myRight)]);
    const rud = clamp(k.rudder ?? 0), myRud = clamp(mine?.rudder ?? 0);
    if (rud > 0.3) rows.push(['rudder', 'Rudder right', 'right', ['D'], myRud > 0.3]);
    else if (rud < -0.3) rows.push(['rudder', 'Rudder left', 'left', ['A'], myRud < -0.3]);
    const thr = k.throttle ?? 1;
    if (thr < 0.4) rows.push(['throttle', 'Throttle back', 'down', ['S'], (mine?.throttle ?? 0) < -0.3]);
    else rows.push(['throttle', 'Full throttle', 'up', ['W'], (mine?.throttle ?? 0) > 0.3 || thr >= 0.4]);
    if ((k.fire ?? 0) > 0.5) rows.push(['fire', 'Fire', 'fire', ['Space', 'click'], !!mine?.fire]);
    if (!rows.some(r => r[0] === 'pitch' || r[0] === 'roll')) rows.unshift(['pitch', 'Hold the stick steady', 'steady', [], Math.hypot(myUp, myRight) < 0.3]);
    const html = rows.map(([ch, words, icon, keys, ok]) =>
      `<li data-ch="${ch}" class="${ok ? 'is-match' : ''}">${ICONS[icon] ?? ''}<b>${esc(words)}</b>${keys.length ? `<kbd>${keys.map(esc).join(' or ')}</kbd>` : ''}</li>`).join('');
    if (ui.rows.innerHTML !== html) ui.rows.innerHTML = html;
  }

  // --- show me ----------------------------------------------------------------

  /**
   * Freeze the fight where it is and fly the next seconds from it twice,
   * off the page (`runDuel` from both airframes' exact states): you flying
   * the counter, and you holding the stick as it is. Both play as ghosts in
   * the world; then the moment is handed back.
   */
  function showMe() {
    if (live.phase !== 'fight' || !live.lesson) return false;
    if (live.preview) {
      if (live.preview.stage === 'play') { live.preview.stage = 'count'; live.preview.count = COUNTDOWN; }
      else { live.preview.stage = 'play'; live.preview.t = 0; }
      return true;
    }
    const drive = page.playerDrive(), aceDrive = live.bot?.vehicle?.drive;
    const you = stateOf(drive?.state), him = stateOf(aceDrive?.state);
    if (!you || !him || !page.makePlane) return false;
    if (!live.guidePilot) live.guidePilot = guidePilot();
    const gun = page.gunOf?.(live.bot) ?? {};
    const ace = { plan: live.lesson.ace.plan, state: him, memory: clone(live.pilot.mem), throttle: live.aceOut?.throttle ?? 1 };
    const fly = (side) => runDuel({
      makePlane: (_, i) => page.makePlane(i), seconds: PREVIEW_SECONDS, origin: live.origin, groundAt: page.groundAt, gun, arena: arena(),
      sides: [ace, side],
    });
    let counter, hold;
    try {
      counter = fly({ plan: live.guidePilot.plan, skill: 0.9, state: you, memory: clone(live.guidePilot.mem), throttle: live.guide.throttle });
      const mine = live.lastInput ?? {};
      hold = fly({ state: you, stick: { pitch: mine.pitch ?? 0, roll: mine.roll ?? 0, rudder: mine.rudder ?? 0, throttle: (mine.throttle ?? 0) < -0.3 ? -1 : 1 } });
    } catch (e) {
      console.warn('dogfight show me', e);
      banner('SHOW ME could not fly this moment', 2, 'warn');
      return true;
    }
    live.preview = { stage: 'play', t: 0, count: 0, snap: { you, him }, counter, hold, ghosts: ghostsOf(counter, hold) };
    const name = live.lesson.demos.find(d => d.id === 'counter')?.label ?? 'The counter';
    ui.pvKicker.textContent = `SHOW ME · ${live.lesson.title.toUpperCase()}`;
    ui.pvTitle.textContent = `From here: ${name}`;
    const steps = counter.events.filter(e => e.side === 1 && e.phase !== 'kill' && e.say);
    ui.pvSteps.innerHTML = steps.map(e => `<li data-t="${e.t}"><span>${e.t.toFixed(1)} s</span>${esc(e.say)}</li>`).join('');
    ui.pvFly.textContent = outcome('Fly it', counter);
    ui.pvHold.textContent = outcome('Hold on as you are', hold);
    ui.preview.hidden = false;
    banner('SHOW ME · the fight is frozen', 1.4, 'info');
    return true;
  }

  /** One future in words: his hits, your shot, and the picture it ends on. */
  function outcome(label, r) {
    const shot = side => (r.tracks[side].filter(k => k.o).length * r.dt).toFixed(1);
    const a = r.tracks[0].at(-1), y = r.tracks[1].at(-1);
    const end = r.end?.winner === 0 ? 'he has shot you down'
      : r.end?.winner === 1 ? 'you have shot him down'
      : a.so < 8 && a.sd < 400 ? `his guns are on you at ${a.sd} m`
      : y.so < 8 && y.sd < 400 ? `your guns are on him at ${y.sd} m`
      : a.so < 35 ? `he is ${a.sd} m off, his nose ${Math.round(a.so)} degrees from you`
      : `he is ${a.sd} m off and cannot point at you`;
    return `${label}: he lands ${r.hits[0]}, you have the shot ${shot(1)} s. At the end ${end}.`;
  }

  function framePreview(dt) {
    const pv = live.preview;
    holdStill(pv.snap);
    const dur = pv.counter.tracks[1].length * pv.counter.dt;
    if (pv.stage === 'play') {
      pv.t += dt;
      if (pv.t >= dur) { pv.stage = 'count'; pv.count = COUNTDOWN; }
    } else {
      pv.count -= dt;
      if (pv.count <= 0) { endPreview(true); return; }
    }
    const t = Math.min(pv.t, dur);
    placeGhosts(pv, t);
    // The counter's hands at this moment of it: how to fly it.
    const i = Math.min(pv.counter.tracks[1].length - 1, Math.floor(t / pv.counter.dt));
    const k = pv.counter.tracks[1][i];
    const [pitch, roll, rudder, throttle] = k.stick;
    drawGuide({ pitch, roll, rudder, throttle, fire: k.f ? 1 : 0 }, live.lastInput,
      pv.stage === 'play' ? 'SHOW ME · how the counter flies it' : 'YOUR TURN · fly what you just saw');
    for (const li of ui.pvSteps.children) {
      const at = +li.dataset.t;
      li.classList.toggle('is-now', at <= t && !([...ui.pvSteps.children].some(o => +o.dataset.t <= t && +o.dataset.t > at)));
      li.classList.toggle('is-done', at <= t);
    }
    ui.pvFoot.textContent = pv.stage === 'play'
      ? `${t.toFixed(1)} / ${dur.toFixed(1)} s · P skip`
      : `Back to the frozen moment. Yours in ${Math.ceil(pv.count)} · P watch again`;
  }

  /** Both airframes held at the frozen moment: put back every frame. */
  function holdStill(snap) {
    const put = (drive, st) => {
      const s = drive?.state;
      if (!s) return;
      s.position.set(...st.position);
      s.velocity.set(...st.velocity);
      s.orientation.set(st.orientation.x, st.orientation.y, st.orientation.z, st.orientation.w);
      s.angularVelocity?.set?.(...st.angularVelocity);
      s.grounded = false;
    };
    put(page.playerDrive(), snap.you);
    put(live.bot?.vehicle?.drive, snap.him);
    page.snapPresentation?.();
  }

  function endPreview(resume) {
    const pv = live.preview;
    if (!pv) return;
    live.preview = null;
    ui.preview.hidden = true;
    pv.ghosts?.group.removeFromParent();
    pv.ghosts?.dispose();
    if (resume) {
      holdStill(pv.snap);
      banner('YOURS · fly it', 1.6, 'go');
    }
  }

  /** The two flights drawn into the world: lines for the paths, a ghost
   *  airframe moving along each, the counter's shot windows as dots. */
  function ghostsOf(counter, hold) {
    const scene = page.scene?.();
    const group = new THREE.Group();
    group.name = 'dogfight-show-me';
    const made = [];
    const mat = m => (made.push(m), m);
    const geo = g => (made.push(g), g);
    const C = { you: token('--mm-success', '#7da34c'), him: token('--mm-kill', '#d65a5a'), hit: token('--mm-load-busy', '#c5a23a'), ink: token('--mm-ink-soft', '#a8a8a8') };
    const path = (track, color, dashed, opacity = 1) => {
      const g = geo(new THREE.BufferGeometry().setFromPoints(track.map(k => new THREE.Vector3(...k.p))));
      const m = mat(dashed ? new THREE.LineDashedMaterial({ color, dashSize: 6, gapSize: 5, transparent: true, opacity })
        : new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
      const line = new THREE.Line(g, m);
      if (dashed) line.computeLineDistances();
      line.frustumCulled = false;
      group.add(line);
    };
    path(counter.tracks[1], C.you, false);
    path(counter.tracks[0], C.him, false, 0.85);
    path(hold.tracks[1], C.ink, true, 0.7);
    path(hold.tracks[0], C.him, true, 0.35);
    const shots = counter.tracks[1].filter(k => k.o).map(k => new THREE.Vector3(...k.p));
    if (shots.length) {
      const pts = new THREE.Points(geo(new THREE.BufferGeometry().setFromPoints(shots)),
        mat(new THREE.PointsMaterial({ color: C.hit, size: 7, sizeAttenuation: false })));
      pts.frustumCulled = false;
      group.add(pts);
    }
    const cone = geo(new THREE.ConeGeometry(2.2, 9, 10).rotateX(-Math.PI / 2));
    const ghost = (color, opacity) => {
      const m = new THREE.Mesh(cone, mat(new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false })));
      group.add(m);
      return m;
    };
    const ghosts = { you: ghost(C.you, 0.95), him: ghost(C.him, 0.95), holdYou: ghost(C.ink, 0.6), holdHim: ghost(C.him, 0.35) };
    scene?.add(group);
    return { group, ghosts, dispose: () => made.forEach(x => x.dispose?.()) };
  }

  function placeGhosts(pv, t) {
    const at = (track, m) => {
      const k = track[Math.min(track.length - 1, Math.floor(t / pv.counter.dt))];
      m.position.set(...k.p);
      m.quaternion.set(...k.q);
    };
    const g = pv.ghosts.ghosts;
    at(pv.counter.tracks[1], g.you);
    at(pv.counter.tracks[0], g.him);
    at(pv.hold.tracks[1], g.holdYou);
    at(pv.hold.tracks[0], g.holdHim);
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
    // During Show me the view follows the ghosts, so the move plays in it.
    const pv = live.preview;
    const ghost = pv && pv.ghosts.ghosts;
    const you = ghost ? { position: ghost.you.position.toArray() } : live.you;
    const him = ghost ? { position: ghost.him.position.toArray() } : live.him;
    ui.view.classList.toggle('is-preview', !!pv);
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
    if (pv) {
      const n = Math.min(pv.counter.tracks[1].length, Math.floor(pv.t / pv.counter.dt) + 1);
      line(ui.trailYou, pv.counter.tracks[1].slice(Math.max(0, n - TRAIL_SAMPLES / 2), n).map(k => k.p));
      line(ui.trailHim, pv.counter.tracks[0].slice(Math.max(0, n - TRAIL_SAMPLES / 2), n).map(k => k.p));
    } else {
      line(ui.trailYou, live.trails.you);
      line(ui.trailHim, live.trails.him);
    }
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

  function key(e) {
    if (!live.lesson) return false;
    if (e.code === 'KeyY') {
      endPreview(false);
      live.guidePilot = null;
      if (live.phase === 'fight' && place()) banner('AGAIN', 1.4, 'go');
      else live.phase = 'seating';
      return true;
    }
    if (e.code === 'KeyI') { toggleInstructor(); return true; }
    if (e.code === 'KeyP') { showMe(); return true; }
    if (e.code === 'KeyG') { live.guideOn = !live.guideOn; banner(live.guideOn ? 'GUIDE ON' : 'GUIDE OFF', 1.2); return true; }
    if (e.code === 'KeyO') { stop(); return true; }
    return false;
  }

  return {
    start, stop, frame, key, flightOverride, noteImpact, toggleInstructor, renderInset, showMe,
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
        guide: ui.guide.hidden ? null : { head: ui.guideHead.textContent, rows: [...ui.rows.children].map(li => li.textContent) },
        preview: live.preview ? { stage: live.preview.stage, t: +live.preview.t.toFixed(1), hits: [live.preview.counter.hits[0], live.preview.hold.hits[0]],
                                  aceShot: [live.preview.counter, live.preview.hold].map(r => +(r.tracks[0].filter(k => k.o).length * r.dt).toFixed(1)),
                                  aceRounds: [live.preview.counter, live.preview.hold].map(r => r.rounds.filter(x => x.side === 0).length),
                                  acePhases: [live.preview.counter, live.preview.hold].map(r => r.events.filter(e => e.side === 0).map(e => `${e.t.toFixed(1)}:${e.phase}`).join(' ')),
                                  range: Math.round(len(sub(live.preview.snap.him.position, live.preview.snap.you.position))),
                                  aceEnd: live.preview.hold.tracks[0].at(-1).sd,
                                  card: ui.preview.textContent.replace(/\s+/g, ' ').trim() } : null,
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

/** The guide's row icons: plain strokes, coloured by the row. */
const ICONS = {
  up: '<svg viewBox="0 0 16 16"><path d="M8 2 L13 8 H10 V14 H6 V8 H3 Z"/></svg>',
  down: '<svg viewBox="0 0 16 16"><path d="M8 14 L13 8 H10 V2 H6 V8 H3 Z"/></svg>',
  left: '<svg viewBox="0 0 16 16"><path d="M2 8 L8 3 V6 H14 V10 H8 V13 Z"/></svg>',
  right: '<svg viewBox="0 0 16 16"><path d="M14 8 L8 3 V6 H2 V10 H8 V13 Z"/></svg>',
  'roll-right': '<svg viewBox="0 0 16 16"><path class="is-stroke" d="M3 11 A6 6 0 0 1 13 6"/><path d="M14.5 2.5 L14 8.5 L9 6 Z"/></svg>',
  'roll-left': '<svg viewBox="0 0 16 16"><path class="is-stroke" d="M13 11 A6 6 0 0 0 3 6"/><path d="M1.5 2.5 L2 8.5 L7 6 Z"/></svg>',
  fire: '<svg viewBox="0 0 16 16"><circle class="is-stroke" cx="8" cy="8" r="5"/><circle cx="8" cy="8" r="1.6"/></svg>',
  steady: '<svg viewBox="0 0 16 16"><circle class="is-stroke" cx="8" cy="8" r="5"/></svg>',
};

/** A design token's value, or `fallback` off the page. */
function token(name, fallback) {
  try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback; } catch { return fallback; }
}

/** A plain copy of a pilot's memory (numbers, strings, arrays). */
function clone(v) {
  try { return structuredClone(v); } catch { return JSON.parse(JSON.stringify(v)); }
}

function isUnder(node, root) {
  for (let n = node; n; n = n.parent) if (n === root) return true;
  return false;
}
