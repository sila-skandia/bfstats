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
// (G hides it), and the sphere (bottom right, `dogfight-sphere.js`): you at
// the centre of a sphere that holds the two of you, him where he is against
// you, both noses and trails, the horizon, and that pilot's next seconds
// drawn inside it in green, his in red, a gold ring where you would have
// the shot. The lines (the same seconds drawn into the world, rings to fly
// through) come up only while the fight is frozen: paused (P), or with the
// ways out of a deadlock up (X). The instructor (I) flies your seat through
// that counter until you touch the controls; Y starts the engagement again.

import { createPilot, gunOf } from './dogfight-pilot.js';
import * as THREE from 'three';
import { stateOf, len, sub, basis, clamp, dot, unit, gunSolution } from './dogfight-flight.js';
import { createDeadlockWatch, extendFrom, resultWords, RESULT_TAGS, KIND_WORDS } from './dogfight-deadlock.js';
import { placePlane, stage, runDuel, KILL_HITS, fitAirframe, paced, pilotView } from './dogfight-duel.js';
import { coach, TONE } from './dogfight-coach.js';
import { lessonById, KEY_WORDS, flightOf, setEra } from './dogfight-lessons.js';
import { createGuide, token } from './dogfight-guide.js';
import { MOVE_INFO, moveLabel } from './dogfight-steps.js';
import { seatCover } from './dogfight-cover.js';
import { createTacticalSphere } from './dogfight-sphere.js';
import { usefulRange, gunFromNode } from './dogfight-doctrine.js';

/** The moves' names as the coach says them: the pilot's name for each
 *  (`dogfight-steps.js`), as the theatre's tabs and move card say it. */
const MOVE_WORDS = Object.fromEntries(Object.entries(MOVE_INFO).map(([k, m]) => [k, m.name.toUpperCase()]));

/** Frames of each pilot's trail the view keeps: about four seconds. */
const TRAIL_SAMPLES = 240;

/** Seconds the lines fly ahead. They are flown once and stay where they are
 *  in the sky, rings to fly through; they are flown again only when you have
 *  used them up (two rings or fewer ahead) or left them (`OFF_PATH`), and
 *  never sooner than `REPLAN_MIN` after the last. Until 2026-11-08 they were
 *  flown again from your plane four times a second, so every ring rode along
 *  ahead of your nose, jumping 17-20 m forward at each re-flight. */
const LINE_SECONDS = 6.5;
/** The path and its rings start this far ahead of you (seconds): guidance
 *  in the middle distance, nothing in your face (the owner, 2026-11-08: the
 *  rings "appear right in front of your face and are very distracting"). */
const TUBE_FROM = 2;
const RING_FROM = 3;
const REPLAN_MIN = 1;
const OFF_PATH = 45;
/** Seconds between the rings on the green line. */
const RING_EVERY = 1.5;
/** The guide's smoothing, seconds. */
const GUIDE_TAU = 0.25;

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
 * `gunOf(bot)`, `snapPresentation()`, `openSchool(id)`, `keyboardTaken()`,
 * `releaseMouse()` and `captureMouse()` (the pointer lock, let go for the
 * ways-out card and taken again when a way is flown).
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
      <span class="dfl-rule" hidden><i></i><span></span></span>
      <div class="dfl-score"><span>the ace's hits on you <b class="dfl-his">0</b></span><span>yours on the ace <b class="dfl-yours">0</b></span><span>kills <b class="dfl-kills">0 : 0</b></span></div>
    </div>
    <div class="dfl-mark" hidden><i></i><span></span></div>
    <div class="dfl-view">
      <svg class="dfl-view-svg" aria-hidden="true">
        <g class="dfl-pin is-you"><text dy="14">YOU</text></g>
        <g class="dfl-pin is-him"><text dy="-9">ACE</text></g>
      </svg>
      <div class="dfl-view-foot"><span class="dfl-range"></span><span class="dfl-above"></span><span class="dfl-scale"></span><span class="dfl-said"></span></div>
    </div>
    <div class="dfl-shottag" hidden></div>
    <div class="dfl-extend" hidden><small class="dfl-extend-kicker"></small><b class="dfl-extend-title"></b><ol class="dfl-extend-list"></ol><div class="dfl-extend-acts"></div><span class="dfl-extend-foot"></span></div>
    <div class="dfl-banner" hidden></div>
    <div class="dfl-foot"><kbd>P</kbd> pause <kbd>X</kbd> extend the scene <kbd>G</kbd> guide <kbd>I</kbd> instructor <kbd>Y</kbd> again <kbd>V</kbd> school <kbd>O</kbd> end</div>`;
  page.stage.appendChild(hud);
  const guide = createGuide(hud);
  const cover = seatCover(hud);
  const q = s => hud.querySelector(s);
  const ui = {
    coach: q('.dfl-coach'), lesson: q('.dfl-lesson'), line: q('.dfl-line'), tip: q('.dfl-tip'), keys: q('.dfl-keys'), rule: q('.dfl-rule'),
    mark: q('.dfl-mark'), markText: q('.dfl-mark span'),
    view: q('.dfl-view'), svg: q('.dfl-view-svg'), pinYou: q('.dfl-pin.is-you'), pinHim: q('.dfl-pin.is-him'),
    range: q('.dfl-range'), above: q('.dfl-above'), scale: q('.dfl-scale'), said: q('.dfl-said'),
    his: q('.dfl-his'), yours: q('.dfl-yours'), kills: q('.dfl-kills'),
    shotTag: q('.dfl-shottag'),
    extend: q('.dfl-extend'), extendKicker: q('.dfl-extend-kicker'), extendTitle: q('.dfl-extend-title'), extendList: q('.dfl-extend-list'), extendActs: q('.dfl-extend-acts'), extendFoot: q('.dfl-extend-foot'),
    banner: q('.dfl-banner'),
  };

  const live = {
    lesson: null, phase: 'idle', t: 0, pilot: null, aceOut: null, bot: null, aceRoot: null,
    hisHits: 0, yourHits: 0, kills: [0, 0], instructor: false, guidePilot: null, lastInput: null,
    bannerUntil: 0, clock: 0, seatAsked: 0, coachAt: 0, trail: [], placedAt: -1, downAt: null, wouldHaveDied: false,
    instructorOut: null, trails: { you: [], him: [] }, you: null, him: null,
    guideOn: true, guide: { pitch: 0, roll: 0, rudder: 0, throttle: 1, fire: 0 }, guideOut: null, frozen: null, lines: null, lineRun: null, lineShot: null, lineAt: 0,
    // The deadlock watch, the scene extended from a frozen moment (its
    // ways out and the one picked), and the way the guide now flies.
    watch: createDeadlockWatch(), deadlock: null, extend: null, extendWay: null,
    // The sphere, built on first use (its colours are the page's tokens).
    sphere: null,
    // Boelcke's rules in the coach (features/dogfight-doctrine): your guns'
    // useful range and falloff, and how long he has been off your screen.
    myGun: null, offScreen: 0,
    // Each seat's airframe as the school fits it (`fitSeats`): 0 the ace's,
    // 1 yours; and the ace's gun as the world fires it, in real metres.
    fits: [NEUTRAL_FIT, NEUTRAL_FIT], aceGun: null, era: null,
  };

  function banner(text, seconds = 2.5, tone = 'info') {
    ui.banner.textContent = text;
    ui.banner.dataset.tone = tone;
    ui.banner.hidden = false;
    live.bannerUntil = live.clock + seconds;
  }

  /**
   * Into the fight: `lessonId`'s, and with `demoId` a Dip, Flip or Ninja to
   * practise, flown from its own staging against the ace it was measured
   * against, the guide and the instructor flying it (`flightOf`).
   */
  function start(lessonId, demoId = null) {
    // The lesson as the ace's airframe flies it: on a jet, its jet file.
    refit();
    const lesson = lessonById(lessonId);
    if (!lesson) return false;
    live.lesson = lesson;
    live.lessonId = lessonId;
    live.demoId = demoId;
    live.flight = flightOf(lesson, demoId);
    live.moveDone = false;
    live.quarterFor = 0;
    live.phase = 'seating';
    live.hisHits = live.yourHits = 0;
    live.kills = [0, 0];
    live.instructor = false;
    live.seatAsked = 0;
    live.trails = { you: [], him: [] };
    hud.hidden = false;
    // Dark from now until the plane is in the air: the seat is found on the
    // ground, and that is nothing to watch.
    cover.show();
    const move = live.flight.demo;
    ui.lesson.textContent = `DOGFIGHT SCHOOL · ${lesson.title.toUpperCase()}${move ? ` · ${moveLabel(move).toUpperCase()}` : ''}${page.planeName ? ` · YOUR ${page.planeName().toUpperCase()}` : ''}`;
    banner(move ? moveLabel(move).toUpperCase() : lesson.title.toUpperCase(), 3);
    return true;
  }

  function stop() {
    live.frozen = null;
    clearExtend(true);
    cover.hide();
    hideLines();
    if (live.bot) live.bot.ace = null;
    live.bot = null;
    live.lesson = null;
    live.flight = null;
    live.phase = 'idle';
    live.instructor = false;
    hud.hidden = true;
  }

  /** The fence the school's pilots fly inside, round the floor's middle. */
  function arena() {
    const rc = page.rangeCentre?.();
    return rc ? { centre: rc, radius: FENCE } : null;
  }

  /**
   * Both seats fitted to their airframes (`fitSeats`, off the page's scratch
   * airframes: 0 the ace's type, 1 yours), and the lessons' era set from the
   * ace's: a jet is taught the lessons' jet files. With no scratch airframes
   * nothing is fitted and the era is left alone. True when the era changed.
   */
  function refit() {
    if (!page.makePlane) return false;
    live.fits = fitSeats(page.makePlane);
    const era = live.fits[0].pace > 1 ? 'jet' : null;
    setEra(era);
    const changed = era !== live.era;
    live.era = era;
    return changed;
  }

  /** Both seats in the air at the lesson's start, the ace's pilot fresh. */
  function place() {
    const drive = page.playerDrive();
    const bot = live.bot;
    const aceDrive = bot?.vehicle?.drive;
    if (!drive || !aceDrive) return false;
    // Fitted again now both are seated, so the ace's type is the one flying.
    // An era other than the one the lesson was read in reads it again.
    if (refit() && lessonById(live.lessonId)) {
      live.lesson = lessonById(live.lessonId);
      live.flight = flightOf(live.lesson, live.demoId);
    }
    const lesson = live.lesson;
    const [cx, cz] = page.centre();
    const gy = page.groundAt(cx, cz);
    const origin = [cx, gy, cz];
    const f = live.flight;
    // Each at its own airframe's pace: a jet starts the fight larger.
    placePlane(drive, stage(origin, paced(f.you.start, live.fits[1].pace)));
    placePlane(aceDrive, stage(origin, paced(f.ace.start, live.fits[0].pace)));
    for (const d of [drive, aceDrive]) {
      if (d.state) d.state.grounded = false;
      d.state?.angularVelocity?.set?.(0, 0, 0);
    }
    bot._airborne = true;
    // The ace's pilot thinks with its airframe's own cannon where it has
    // one, shown at the Spitfire's size; the world's guns stay real.
    const worldGun = page.gunOf?.(bot) ?? {};
    live.pilot = seatPilot(f.ace.plan, live.fits[0], { gun: worldGun, memory: f.ace.memory ?? {} });
    live.aceGun = seatGun(live.fits[0], worldGun);
    {
      // Your guns: your plane's own round and its falloff (its FireArms'
      // extras), inside the ace's convergence.
      const mine = gunFromNode(page.playerRoot?.());
      live.myGun = { falloff: mine?.falloff ?? null, rate: mine?.rate ?? 12, useful: usefulRange({ range: live.aceGun.range, falloff: mine?.falloff }) };
    }
    // The gunnery drill's score (Boelcke's rule 3): rounds fired, how many
    // past the useful range, and every hit with its range.
    live.drill = lesson.drill === 'gunnery' ? { rounds: 0, past: 0, hits: [] } : null;
    live.offScreen = 0;
    live.moveDone = false;
    live.quarterFor = 0;
    live.guidePilot = null;
    live.frozen = null;
    live.origin = origin;
    live.t = 0;
    live.trails = { you: [], him: [] };
    live.placedAt = live.clock;
    live.downAt = null;
    live.wouldHaveDied = false;
    live.hisHits = live.yourHits = 0;
    clearExtend(true);
    // The old lines were flown from the last start: fly them afresh.
    live.lineRun = null;
    live.lineAt = -Infinity;
    hideLines();
    live.sphere?.reset();
    page.snapPresentation?.();
    live.phase = 'fight';
    cover.clear();
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
    if (live.frozen) { bot.isFiring = false; return; }
    if (!him) {
      // The player is not in the air: the ace holds a gentle climb and waits.
      bot._airInput = { power: 0.8, throttle: 0.8, roll: 0, pitch: -0.05, rudder: 0 };
      bot.isFiring = false;
      return;
    }
    const out = stepSeat(live.pilot, [live.fits[0], live.fits[1]], { me, him, dt, t: live.t, groundAt: page.groundAt, arena: arena() });
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
   *  the player moves a control himself. `live.firing` is the trigger that
   *  goes to the guns, yours or the instructor's: what the drill counts. */
  function flightOverride(input) {
    applyOverride(input);
    live.firing = !!input.fire;
  }
  function applyOverride(input) {
    live.lastInput = { roll: input.roll, pitch: input.pitch, rudder: input.rudder, throttle: input.forwardKeys, fire: input.fire };
    if (live.frozen) { input.fire = false; return; }
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
    if (live.phase !== 'fight' || live.frozen || !live.bot || firerId == null) return;
    const root = page.playerRoot?.();
    // A hull's hit names its owner id; the page's damage table has its node.
    const struck = typeof record.owner === 'number' ? page.ownerNode?.(record.owner) ?? null : record.owner;
    if (firerId === live.bot.playerId && root && isUnder(struck, root)) {
      live.hisHits++;
      if (live.hisHits >= KILL_HITS && !live.wouldHaveDied) {
        live.wouldHaveDied = true;
        live.kills[1]++;
        banner('THE ACE WOULD HAVE SHOT YOU DOWN · Y to go again', 4, 'danger');
      }
    }
    if (live.aceRoot && isUnder(struck, live.aceRoot) && firerId === page.localId) {
      live.yourHits++;
      if (live.drill && live.you && live.him) live.drill.hits.push(Math.round(len(sub(live.him.position, live.you.position))));
    }
  }

  function frame(dt) {
    live.clock += dt;
    live.frameDt = dt;
    if (!ui.banner.hidden && live.clock > live.bannerUntil) ui.banner.hidden = true;
    if (!live.lesson) return;
    if (page.covered?.()) { hud.style.visibility = 'hidden'; if (live.lines) live.lines.group.visible = false; return; }
    // The lines in the world only while the fight is held still: in motion
    // they are redrawn as the fight leaves them, and flash; the sphere
    // carries the same seconds meanwhile.
    if (live.lines) live.lines.group.visible = !!live.frozen && (live.guideOn || !!live.extend);
    hud.style.visibility = '';
    live.t += dt;
    const bot = page.aceBot?.() ?? null;
    if (bot !== live.bot) { if (live.bot) live.bot.ace = null; live.bot = bot; }
    live.aceRoot = bot ? page.aceRoot?.(bot) ?? null : null;
    const drive = page.playerDrive();
    if (live.phase === 'seating' || live.phase === 'down') {
      // The kill's pause is shown; from then until the plane is in the air
      // the picture is dark.
      if (!(live.phase === 'down' && live.clock - live.downAt < 3.5)) cover.show();
      if (!bot) {
        setCoach({ tone: TONE.warn, line: 'Waiting for the enemy pilot', tip: 'They are walking to their aircraft.', keys: [] });
      } else if (!drive) {
        if (live.clock - live.seatAsked > 3) { live.seatAsked = live.clock; page.seatPlayer?.(); }
        setCoach({ tone: TONE.info, line: 'Getting you into a fighter', tip: '', keys: [] });
      } else if (!bot.vehicle?.drive || bot.vehicle.kind !== 'air') {
        setCoach({ tone: TONE.info, line: 'The ace is climbing into their aircraft', tip: '', keys: [] });
      } else if (live.phase === 'down' && live.clock - live.downAt < 3.5) {
        // a pause on the kill
      } else {
        place();
        banner('FIGHT', 1.6, 'go');
      }
      guide.el.hidden = true;
      hideLines();
      return;
    }
    if (live.frozen) {
      holdStill(live.frozen);
      markHim(live.frozen.you, live.frozen.him);
      tagShot();
      drawSphere(live.frozen.you, live.frozen.him, dt);
      return;
    }
    // The fight. Is he down?
    const aceDown = !bot?.vehicle || bot.vehicle.kind !== 'air' || page.isWreck?.(live.aceRoot);
    if (aceDown) {
      live.kills[0]++;
      live.phase = 'down';
      live.downAt = live.clock;
      if (bot) bot.ace = null;
      banner('YOU SHOT THE ACE DOWN', 3.5, 'go');
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
    // The watch: whether the two of you are deadlocked (nobody's shot for
    // six seconds, both turning), judged on both guns' solutions.
    {
      const gun = { ...(live.aceGun ?? {}), width: 5 };
      const quat = o => [o.x, o.y, o.z, o.w];
      live.deadlock = live.watch.push({ t: live.t,
        ace: { p: him.position, q: quat(him.orientation), o: gunSolution(him, you, gun).fire },
        you: { p: you.position, q: quat(you.orientation), o: gunSolution(you, him, gun).fire } });
    }
    if (live.clock - live.coachAt > 0.12) {
      live.coachAt = live.clock;
      const way = live.extendWay;
      const move = live.flight?.demo && live.guideOut ? { name: MOVE_WORDS[live.flight.move], say: guideToYou(live.guideOut.say), phase: live.guideOut.phase }
        : way && live.guideOut ? { name: `WAY OUT · ${way.name.toUpperCase()}`, say: guideToYou(live.guideOut.say), phase: live.guideOut.phase } : null;
      const words = coach(live.lesson, live.aceOut, you, him, { ground: page.groundAt(you.position[0], you.position[2]), move,
        useful: live.myGun?.useful ?? null, falloff: live.myGun?.falloff ?? null,
        seen: live.pilot?.mem?.eye ? !!live.pilot.mem.eye.sees : null, offScreen: live.offScreen });
      // A deadlock: the coach names it and offers the scene extended, unless
      // the ground or a stall comes first, or a way out is being flown.
      const floor = words.line === 'GROUND' || words.line.startsWith('Slow');
      if (live.deadlock && !floor && !way) {
        Object.assign(words, { rule: null, tone: TONE.warn, line: `Deadlock: ${KIND_WORDS[live.deadlock.kind]}`,
          tip: `Nobody has had a shot for ${Math.round(live.deadlock.since)} s. X freezes the fight and flies the school's ways out from here.`, keys: ['X'] });
      }
      const rc = page.rangeCentre?.();
      if (rc && Math.hypot(you.position[0] - rc[0], you.position[2] - rc[1]) > LEAVING) {
        Object.assign(words, { rule: null, tone: TONE.warn, line: 'You are leaving the range', tip: 'Turn back toward the floor: the fight goes on there.', keys: ['Mouse', 'Arrows'] });
      }
      setCoach(words);
      if (live.drill) drawDrill();
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
    if (live.drill && live.firing && !live.frozen) {
      const n = (live.myGun?.rate ?? 12) * dt;
      live.drill.rounds += n;
      if (len(sub(him.position, you.position)) > (live.myGun?.useful ?? 268)) live.drill.past += n;
    }
    // The guide: the counter's pilot flies your seat in his head, a frame
    // at a time, and his stick, smoothed, is what the guide says.
    if (!live.guidePilot) live.guidePilot = guidePilot();
    const out = stepSeat(live.guidePilot, [live.fits[1], live.fits[0]], { me: you, him, dt, t: live.t, groundAt: page.groundAt, arena: arena() });
    live.guideOut = out;
    checkMove(you, him, dt);
    const a = 1 - Math.exp(-dt / GUIDE_TAU);
    const g = live.guide;
    g.pitch += (out.stick.pitch - g.pitch) * a;
    g.roll += (out.stick.roll - g.roll) * a;
    g.rudder += (out.stick.rudder - g.rudder) * a;
    g.throttle += ((out.throttle ?? 1) - g.throttle) * a;
    g.fire = out.fire ? 1 : Math.max(0, g.fire - dt * 3);
    drawGuide(g, live.lastInput, live.instructor ? 'INSTRUCTOR FLYING · touch the stick to take over' : 'DO THIS · the green path on the sphere');
    if (live.guideOn) followLines(you);
    const due = live.guideOn ? linesDue(you) : null;
    if (due && live.clock - live.lineAt > REPLAN_MIN) {
      live.lineAt = live.clock;
      // Used up: the rings still ahead stay exactly where they are and the
      // new ones carry on past them. Left behind: all of them afresh.
      updateLines(you, him, due === 'used');
    }
    tagShot();
    drawSphere(you, him, dt);
  }

  /** The pilot the guide and the instructor fly: the move being practised,
   *  else the lesson's counter (`flightOf`). */
  function guidePilot() {
    return seatPilot(live.flight.guide, live.fits[1], { skill: 0.9, gun: page.gunOf?.(live.bot) ?? {}, memory: live.flight.you.memory ?? {} });
  }

  /**
   * A move practised and done, said once: the Dip when you are past 900 m
   * and opening with no hit taken since the start, the Flip when you have
   * sat on his tail (rear quarter, nose on him, inside 350 m, 35 m/s) for
   * 2 s, as `tests/dogfight_dfn_measure.mjs` scores them.
   */
  function checkMove(you, him, dt) {
    const kind = live.flight?.move ?? live.extendWay?.kind;
    if (!kind || live.moveDone) return;
    const rel = sub(you.position, him.position);
    const range = len(rel);
    if (kind === 'dip') {
      const opening = dot(rel, sub(you.velocity, him.velocity)) > 0;
      if (range > 900 && opening && live.hisHits === 0) {
        live.moveDone = true;
        banner('CLEAR · THE EXTENSION WORKED', 4, 'go');
      }
    } else if (kind === 'flip') {
      const F = basis(him.orientation).F, myF = basis(you.orientation).F, u = unit(rel);
      const behind = -dot(F, u) > Math.cos(60 * Math.PI / 180);
      const onHim = -dot(myF, u) > Math.cos(30 * Math.PI / 180);
      live.quarterFor = behind && onHim && range < 350 && len(you.velocity) >= 35 ? live.quarterFor + dt : 0;
      if (live.quarterFor >= 2) {
        live.moveDone = true;
        banner('REVERSED · YOU ARE THE HUNTER NOW', 4, 'go');
      }
    }
  }

  // --- the guide --------------------------------------------------------------

  /**
   * What to do with the stick, drawn: the gate with the stick where it
   * should be (the filled dot) and where yours is (the ring), the arrows
   * lit the way to move it, and a row per control with its keys. Up is
   * the nose going up. A row turns green while you are doing it.
   */
  function drawGuide(k, mine, head) {
    guide.el.hidden = !live.guideOn && !live.instructor;
    if (!guide.el.hidden) guide.draw(k, mine, head);
  }

  // --- the lines -------------------------------------------------------------

  /**
   * The way to fly, drawn into the world: the next seconds flown off the
   * page from where you both are now (`runDuel` from both airframes' exact
   * states and both pilots' memories), you flying the counter the guide
   * follows. A green tube with a ring every half second to fly through, his path
   * in red, and a gold ring where your guns would have him. They stay put in
   * the sky; flown again only when used up or left (`linesDue`).
   */
  function updateLines(you, him, keep = false) {
    if (!page.makePlane || !live.guidePilot || !live.pilot) return;
    let r;
    try {
      r = runDuel({
        makePlane: (_, i) => page.makePlane(i), seconds: LINE_SECONDS, origin: live.origin, groundAt: page.groundAt,
        gun: page.gunOf?.(live.bot) ?? {}, arena: arena(),
        sides: [{ plan: live.flight.ace.plan, state: him, memory: live.pilot.mem, throttle: live.aceOut?.throttle ?? 1 },
                { plan: live.guidePilot.plan, skill: 0.9, state: you, memory: live.guidePilot.mem, throttle: live.guide.throttle }],
      });
    } catch (e) {
      console.warn('dogfight lines', e);
      return;
    }
    live.lineRun = r;
    drawLines(r, keep);
  }

  const _fwd = new THREE.Vector3(), _to = new THREE.Vector3();
  /** Whether you have flown past a ring (or the gold one): across the plane
   *  it stands in, the way the path goes through it. */
  function passed(mesh, at) {
    _fwd.set(0, 0, -1).applyQuaternion(mesh.quaternion);
    return _to.set(at[0], at[1], at[2]).sub(mesh.position).dot(_fwd) > 0;
  }

  /** Rings behind you go; the rest stay where they are. */
  function followLines(you) {
    const L = live.lines;
    if (!L || !live.lineRun) return;
    for (const ring of L.rings) if (ring.visible && passed(ring, you.position)) ring.visible = false;
    if (L.shot.visible && passed(L.shot, you.position)) { L.shot.visible = false; live.lineShot = null; }
  }

  /** Whether the lines want flying again, and why: 'new' (none yet),
   *  'off' (you have left them) or 'used' (one ring or none ahead); null
   *  while they still serve. */
  function linesDue(you) {
    const r = live.lineRun;
    if (!r || !live.lines) return 'new';
    let near = Infinity;
    const track = r.tracks[1];
    for (let i = 0; i < track.length; i += 3) {
      const p = track[i].p;
      near = Math.min(near, Math.hypot(p[0] - you.position[0], p[1] - you.position[1], p[2] - you.position[2]));
    }
    if (near > OFF_PATH) return 'off';
    return live.lines.rings.filter(ring => ring.visible).length <= 1 ? 'used' : null;
  }

  /** The sphere (`dogfight-sphere.js`), in the page's colours. */
  function sphereObject() {
    if (live.sphere) return live.sphere;
    live.sphere = createTacticalSphere({
      you: token('--dfs-you', '#7da34c'), him: token('--dfs-ace', '#d65a5a'), hit: token('--mm-load-busy', '#c5a23a'),
      ink: token('--mm-ink-muted', '#9a9a9a'), warn: token('--mm-load-busy', '#c5a23a'),
    });
    return live.sphere;
  }

  /** The sphere brought up to this frame: both of you, the trails, the
   *  guide's seconds (`live.lineRun`) and the ground under you. */
  function drawSphere(you, him, dt) {
    const S = sphereObject();
    const s = S.update({ you, him, dt, trails: live.trails, lines: live.guideOn || live.extend ? live.lineRun : null,
                         groundY: page.groundAt?.(you.position[0], you.position[2]) ?? null, guideOn: live.guideOn || !!live.extend });
    const scale = `sphere ${s.radius >= 1000 ? `${(s.radius / 1000).toFixed(1)} km` : `${Math.round(s.radius / 10) * 10} m`}`;
    if (ui.scale.textContent !== scale) ui.scale.textContent = scale;
  }

  function linesObject() {
    if (live.lines) return live.lines;
    const C = { you: token('--mm-success', '#7da34c'), him: token('--mm-kill', '#d65a5a'), hit: token('--mm-load-busy', '#c5a23a') };
    const group = new THREE.Group();
    group.name = 'dogfight-lines';
    const basic = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
    const you = new THREE.Mesh(new THREE.BufferGeometry(), basic(C.you, 0.55));
    const him = new THREE.Mesh(new THREE.BufferGeometry(), basic(C.him, 0.45));
    const ringGeo = new THREE.TorusGeometry(4, 0.22, 6, 36);
    // From RING_FROM seconds out, one every RING_EVERY: a ring closer than
    // that fills the cockpit, and a tunnel of them is all you can see.
    const count = Math.floor((LINE_SECONDS - RING_FROM) / RING_EVERY) + 1;
    const rings = Array.from({ length: count }, (_, i) => new THREE.Mesh(ringGeo, basic(C.you, 0.7 - (i / count) * 0.35)));
    const shot = new THREE.Mesh(new THREE.TorusGeometry(8, 0.5, 6, 40), basic(C.hit, 0.95));
    for (const m of [you, him, ...rings, shot]) { m.frustumCulled = false; m.renderOrder = 5; group.add(m); }
    live.lines = { group, you, him, rings, shot, ringGeo };
    return live.lines;
  }

  function drawLines(r, keep = false) {
    const L = linesObject();
    // The rings still ahead, kept where they stand when the lines are only
    // carried on (`keep`), nearest first.
    const kept = keep ? L.rings.filter(ring => ring.visible).map(ring => ({ p: ring.position.clone(), q: ring.quaternion.clone() })) : [];
    const scene = page.scene?.();
    if (scene && L.group.parent !== scene) scene.add(L.group);
    const tube = (mesh, track, from, radius) => {
      const pts = track.slice(from).filter((_, i) => i % 3 === 0).map(k => new THREE.Vector3(...k.p));
      if (pts.length < 2) { mesh.visible = false; return; }
      mesh.geometry.dispose();
      mesh.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 2, radius, 6, false);
      mesh.visible = true;
    };
    // Yours starts TUBE_FROM seconds ahead of the nose, so it never fills
    // the cockpit; his from where he is.
    tube(L.you, r.tracks[1], Math.round(TUBE_FROM / r.dt), 0.5);
    tube(L.him, r.tracks[0], 0, 0.45);
    const at = t => Math.min(r.tracks[1].length - 1, Math.round(t / r.dt));
    // The new flight's rings, one every RING_EVERY from RING_FROM seconds
    // out. A torus lies across its z axis, and the airframe flies down its
    // -z: the airframe's own turn faces the ring along the path.
    let fresh = [];
    for (let i = 0; i < L.rings.length; i++) {
      const n = at(RING_FROM + i * RING_EVERY);
      if (n !== Math.round((RING_FROM + i * RING_EVERY) / r.dt)) break;
      const k = r.tracks[1][n];
      fresh.push({ p: new THREE.Vector3(...k.p), q: new THREE.Quaternion(...k.q) });
    }
    // Carried on: only the new rings past the last one kept (and not on top
    // of it), so nothing ahead of you moves.
    const last = kept.at(-1);
    if (last) {
      const gap = Math.max(1, fresh.length > 1 ? fresh[0].p.distanceTo(fresh[1].p) : 1) * 0.5;
      _fwd.set(0, 0, -1).applyQuaternion(last.q);
      fresh = fresh.filter(f => _to.copy(f.p).sub(last.p).dot(_fwd) > 0 && f.p.distanceTo(last.p) > gap);
    }
    const all = [...kept, ...fresh].slice(0, L.rings.length);
    for (const [i, ring] of L.rings.entries()) {
      ring.visible = i < all.length;
      if (!ring.visible) continue;
      ring.position.copy(all[i].p);
      ring.quaternion.copy(all[i].q);
    }
    const first = r.tracks[1].findIndex(k => k.o);
    L.shot.visible = first >= 0;
    if (first >= 0) {
      const k = r.tracks[1][first];
      L.shot.position.set(...k.p);
      L.shot.quaternion.set(...k.q);
    }
    live.lineShot = first >= 0 ? { at: r.tracks[1][first].p, t: first * r.dt, range: r.tracks[1][first].sd } : null;
  }

  function hideLines() {
    live.lines?.group.removeFromParent();
    live.lineShot = null;
    ui.shotTag.hidden = true;
  }

  /** The gold ring's word, over it on the screen. */
  function tagShot() {
    const cam = page.camera?.();
    const shot = live.lineShot;
    const show = !!(cam && shot && live.guideOn && live.lines?.group.parent && live.lines.group.visible);
    if (!show) { ui.shotTag.hidden = true; return; }
    cam.updateMatrixWorld();
    _p.set(...shot.at).project(cam);
    const on = _p.z < 1 && Math.abs(_p.x) < 1 && Math.abs(_p.y) < 1;
    ui.shotTag.hidden = !on;
    if (!on) return;
    const w = page.stage.clientWidth, h = page.stage.clientHeight;
    ui.shotTag.style.transform = `translate(${(_p.x * 0.5 + 0.5) * w}px, ${(-_p.y * 0.5 + 0.5) * h}px)`;
    ui.shotTag.textContent = `YOUR SHOT · ${shot.t.toFixed(1)} S`;
  }

  // --- extend the scene -----------------------------------------------------------
  // X freezes the fight where it is and flies the school's five ways out of
  // a deadlock from this exact moment (`dogfight-deadlock.js` `extendFrom`):
  // both airframes as they stand, the ace flying on with their own plan and
  // memory. The card ranks them by what each got you (on their six, a shot,
  // clear, still locked, hit); the one picked is drawn as the lines, and X
  // or P again flies on with the guide and the instructor flying that way.

  function clearExtend(all = false) {
    live.extend = null;
    ui.extend.hidden = true;
    ui.extendActs.innerHTML = '';
    if (all) { live.extendWay = null; live.watch.reset(); live.deadlock = null; }
  }

  async function extendScene() {
    if (live.phase !== 'fight' || !page.makePlane || !live.pilot || live.extend?.busy) return;
    if (live.extend && live.frozen) { flyChosen(); return; }
    const you = stateOf(page.playerDrive()?.state), him = stateOf(live.bot?.vehicle?.drive?.state);
    if (!you || !him) return;
    live.frozen = { you, him };
    const dl = live.deadlock;
    const t0 = live.t;
    live.extend = { busy: true, results: null, chosen: 0, t: t0, turn: 1 };
    ui.extend.hidden = false;
    ui.extendKicker.textContent = dl ? `DEADLOCK · ${KIND_WORDS[dl.kind].toUpperCase()} · ${t0.toFixed(1)} S` : `FROM ${t0.toFixed(1)} S`;
    ui.extendTitle.textContent = dl ? `Nobody has had a shot for ${Math.round(dl.since)} s. The ways out, from here:` : 'The school\'s ways out, from here:';
    ui.extendList.innerHTML = '<li class="dfl-extend-busy">Flying the ways out on the flight law…</li>';
    ui.extendActs.innerHTML = '';
    ui.extendFoot.textContent = '';
    // The fight is held: the mouse comes back for the card.
    page.releaseMouse?.();
    const tracks = live.watch.tracks;
    const i0 = tracks[1].length - 1;
    // The watch's own last seconds stand in for the fight so far.
    const fight = { tracks, dt: 1 / 60, rounds: [], end: null };
    let w;
    try {
      w = await extendFrom(fight, 1, i0, {
        states: [him, you], mems: [live.pilot.mem, {}], throttles: [live.aceOut?.throttle ?? 1, 1],
        opponent: { plan: live.flight.ace.plan, memory: live.pilot.mem, skill: 1 },
        makePlanes: [() => page.makePlane(0), () => page.makePlane(1)], origin: live.origin, groundAt: page.groundAt,
        gun: page.gunOf?.(live.bot) ?? {}, arena: arena(), yieldTo: () => new Promise(r => setTimeout(r, 0)),
      });
    } catch (e) {
      console.warn('dogfight extend', e);
      clearExtend();
      live.frozen = null;
      banner('THE WAYS OUT COULD NOT BE FLOWN', 2, 'warn');
      return;
    }
    // Gone on (Y, O) while they flew: nothing to show.
    if (!live.extend?.busy || !live.frozen) return;
    live.extend = { busy: false, results: w.results, chosen: 0, t: t0, turn: w.turn };
    ui.extendList.innerHTML = w.results.map((r, i) => (r.score
      ? `<li><button type="button" data-way="${i}"><kbd>${i + 1}</kbd><i class="dfl-extend-tag is-${r.score.result}">${RESULT_TAGS[r.score.result]}</i><b>${esc(r.way.name)}</b><small>${esc(resultWords(r.score))}</small></button></li>`
      : `<li class="is-off"><kbd>${i + 1}</kbd><b>${esc(r.way.name)}</b><small>could not be flown</small></li>`)).join('');
    ui.extendActs.innerHTML = '<button type="button" class="dfl-extend-fly" data-act="fly">Fly it: the school takes the controls</button><button type="button" class="dfl-extend-back" data-act="back">Back to the fight</button>';
    ui.extendFoot.innerHTML = 'Pick a way: it is drawn in the sky and on the sphere. Fly it and the school flies your seat through it; touch the stick to take over. <kbd>1</kbd>–<kbd>5</kbd> <kbd>X</kbd> <kbd>Esc</kbd>';
    showWay(w.results.findIndex(r => r.flown));
  }

  /** Way `i` of the card drawn as the lines: your path in green, theirs in red. */
  function showWay(i) {
    const x = live.extend;
    const r = x?.results?.[i];
    if (!r?.flown) return;
    x.chosen = i;
    ui.extendList.querySelectorAll('button[data-way]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.way === i)));
    live.lineRun = r.flown;
    drawLines(r.flown, false);
    live.lineAt = live.clock;
  }

  /** Fly on, the guide and the instructor flying the way picked. */
  function flyChosen() {
    const x = live.extend;
    const r = x?.results?.[x.chosen];
    if (!r?.flown) { clearExtend(); live.frozen = null; return; }
    const p = seatPilot(r.way.plan, live.fits[1], { skill: 0.9, gun: page.gunOf?.(live.bot) ?? {} });
    // Its memory is in the space it sees: the height to hold, shrunk.
    const y0 = pilotView(live.fits[1].pace).see(live.frozen.you).position[1];
    Object.assign(p.mem, { after: 0, pick: true, side: x.turn, dir: x.turn, y0 });
    live.guidePilot = p;
    live.extendWay = r.way;
    live.moveDone = false;
    live.quarterFor = 0;
    live.frozen = null;
    // The school flies the way from your seat until you touch the stick.
    live.instructor = true;
    live.instructorSince = live.clock;
    clearExtend();
    page.captureMouse?.();
    banner(`THE SCHOOL FLIES · ${r.way.name.toUpperCase()} · touch the stick to take over`, 3, 'go');
  }

  /** Back from the card to the fight as it was, nothing flown. */
  function cancelExtend() {
    if (!live.extend || live.extend.busy) return;
    clearExtend(true);
    live.frozen = null;
    page.captureMouse?.();
    banner('AS YOU WERE', 1.2, 'info');
  }

  // --- pause --------------------------------------------------------------------

  /** P: the fight held where it is, the lines and the guide still up, so
   *  you can look at the way to fly before you fly it. */
  function togglePause() {
    if (live.phase !== 'fight') return;
    if (live.extend?.busy) return;
    if (live.extend && live.frozen) { flyChosen(); return; }
    if (live.frozen) {
      live.frozen = null;
      banner('FLY IT', 1.2, 'go');
      return;
    }
    const you = stateOf(page.playerDrive()?.state), him = stateOf(live.bot?.vehicle?.drive?.state);
    if (!you || !him) return;
    live.frozen = { you, him };
    banner('PAUSED · the lines are up · P to go', 2.5, 'info');
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

  let coachKey = '';
  /** The gunnery drill's running score, in the rule's row. */
  function drawDrill() {
    const d = live.drill, rounds = Math.round(d.rounds);
    const per = rounds ? (100 * d.hits.length / rounds).toFixed(1) : '0';
    const past = rounds ? Math.round(100 * d.past / d.rounds) : 0;
    const near = d.hits.length ? Math.round(d.hits.reduce((a, b) => a + b, 0) / d.hits.length) : null;
    ui.rule.hidden = false;
    ui.rule.querySelector('i').textContent = 'BOELCKE 3 · GUNNERY';
    ui.rule.querySelector('span').textContent = `${d.hits.length} hits in ${rounds} rounds (${per} per 100)`
      + `${near !== null ? `, from ${near} m on average` : ''}. Fired past ${Math.round(live.myGun?.useful ?? 268)} m: ${past}%.`;
  }

  function setCoach(w) {
    // Boelcke's rule in play, when the top line is not one: its own quiet
    // row, so the lesson's words keep their place.
    const rule = w.rule ? null : w.ruleLine ?? null;
    ui.rule.hidden = !rule && !w.rule;
    const shown = w.rule ? w : rule;
    if (shown) {
      ui.rule.querySelector('i').textContent = `BOELCKE ${shown.rule}`;
      ui.rule.querySelector('span').textContent = w.rule ? '' : `${shown.line}: ${shown.tip}`;
    }
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
    // How long he has been off the screen (rule 4's measure), on the
    // page's clock.
    live.offScreen = onScreen ? 0 : live.offScreen + Math.max(0, live.clock - (live.markAt ?? live.clock));
    live.markAt = live.clock;
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
   * The view: the sphere (`dogfight-sphere.js`) drawn into its window by
   * the page's own renderer after its render (`proving-ground-page.js`
   * `renderInset`), the two of you labelled over it.
   */
  const _vp = new THREE.Vector4(), _sc = new THREE.Vector4(), _cc = new THREE.Color();
  function renderInset(renderer) {
    const you = live.you, him = live.him;
    if (hud.hidden || live.phase !== 'fight' || !you || !him || hud.style.visibility === 'hidden' || !live.sphere) return;
    const el = renderer.domElement;
    const cr = el.getBoundingClientRect();
    const fr = ui.view.getBoundingClientRect();
    if (!cr.width || !fr.width) return;
    const S = live.sphere;
    S.camera.aspect = fr.width / fr.height;
    S.camera.updateProjectionMatrix();
    const sx = el.width / cr.width, sy = el.height / cr.height;
    renderer.getViewport(_vp);
    renderer.getScissor(_sc);
    const test = renderer.getScissorTest(), clear = renderer.autoClear;
    const x = (fr.left - cr.left) * sx, y = (cr.bottom - fr.bottom) * sy, w = fr.width * sx, h = fr.height * sy;
    renderer.setViewport(x, y, w, h);
    renderer.setScissor(x, y, w, h);
    renderer.setScissorTest(true);
    renderer.autoClear = false;
    // Its own dark ground: the cage and the paths read over any sky.
    renderer.getClearColor(_cc);
    const ca = renderer.getClearAlpha();
    renderer.setClearColor(0x121212, 1);
    renderer.clear(true, true, false);
    renderer.setClearColor(_cc, ca);
    renderer.render(S.scene, S.camera);
    renderer.autoClear = clear;
    renderer.setScissorTest(test);
    renderer.setScissor(_sc);
    renderer.setViewport(_vp);
    // The labels, over it.
    const W = fr.width, H = fr.height;
    ui.svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const at = (you2, pos) => {
      const n = S.project(pos, you2.position);
      return n ? [(n[0] * 0.5 + 0.5) * W, (-n[1] * 0.5 + 0.5) * H] : null;
    };
    const py = at(you, you.position), ph = at(you, him.position);
    for (const [pin, pt] of [[ui.pinYou, py], [ui.pinHim, ph]]) {
      pin.style.display = pt ? '' : 'none';
      if (pt) pin.setAttribute('transform', `translate(${pt[0].toFixed(1)},${pt[1].toFixed(1)})`);
    }
  }

  ui.extend.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || !live.extend || live.extend.busy) return;
    if (b.dataset.way !== undefined) {
      // The way already picked, clicked again: fly it.
      if (+b.dataset.way === live.extend.chosen && b.getAttribute('aria-pressed') === 'true') flyChosen();
      else showWay(+b.dataset.way);
      return;
    }
    if (b.dataset.act === 'fly') flyChosen();
    else if (b.dataset.act === 'back') cancelExtend();
  });

  function key(e) {
    if (!live.lesson) return false;
    // The ways out up: a digit picks one.
    if (live.extend && !live.extend.busy && /^Digit[1-5]$/.test(e.code)) { showWay(+e.code.slice(5) - 1); return true; }
    if (e.code === 'KeyX') { extendScene(); return true; }
    if (e.code === 'Escape' && live.extend && !live.extend.busy) { cancelExtend(); return true; }
    if (e.code === 'KeyY') {
      live.frozen = null;
      live.guidePilot = null;
      clearExtend(true);
      if (live.phase === 'fight' && place()) banner('AGAIN', 1.4, 'go');
      else live.phase = 'seating';
      return true;
    }
    if (e.code === 'KeyI') { toggleInstructor(); return true; }
    if (e.code === 'KeyP') { togglePause(); return true; }
    if (e.code === 'KeyG') { live.guideOn = !live.guideOn; if (!live.guideOn) { hideLines(); live.lineRun = null; } banner(live.guideOn ? 'GUIDE ON' : 'GUIDE OFF', 1.2); return true; }
    if (e.code === 'KeyO') { const id = live.lesson?.id ?? null; stop(); page.openSchool?.(id); return true; }
    return false;
  }

  return {
    start, stop, frame, key, flightOverride, noteImpact, toggleInstructor, renderInset, togglePause,
    get active() { return !!live.lesson; },
    get state() {
      return {
        lesson: live.lesson?.id ?? null, move: live.flight?.move ?? null, acePlan: live.flight?.ace.plan ?? null,
        guidePlan: live.guidePilot?.plan ?? live.flight?.guide ?? null, moveDone: !!live.moveDone, phase: live.phase, acePhase: live.aceOut?.phase ?? null, aceSays: live.aceOut?.say ?? null,
        hisHits: live.hisHits, yourHits: live.yourHits, kills: [...live.kills], instructor: live.instructor,
        coach: { tone: ui.coach.dataset.tone, line: ui.line.textContent, tip: ui.tip.textContent },
        bot: live.bot?.playerId ?? null,
        you: stateOf(page.playerDrive()?.state)?.position?.map(Math.round) ?? null,
        him: stateOf(live.bot?.vehicle?.drive?.state)?.position?.map(Math.round) ?? null,
        aceSpeed: Math.round(len(stateOf(live.bot?.vehicle?.drive?.state)?.velocity ?? [0, 0, 0])),
        youSpeed: Math.round(len(stateOf(page.playerDrive()?.state)?.velocity ?? [0, 0, 0])),
        // The types the two sit in, by template, as the page names them.
        aceType: typeOf(live.aceRoot), youType: typeOf(page.playerRoot?.()),
        fire: !!live.aceOut?.fire, t: +live.t.toFixed(1), gun: live.aceGun ?? null,
        fits: live.fits.map(f => ({ hand: f.hand, pace: f.pace, gun: f.gun })), era: live.era,
        guide: guide.state,
        frozen: !!live.frozen,
        deadlock: live.deadlock ? { kind: live.deadlock.kind, since: live.deadlock.since } : null,
        extend: live.extend ? { busy: live.extend.busy, chosen: live.extend.chosen, t: +live.extend.t.toFixed(1),
                                results: (live.extend.results ?? []).map(r => ({ id: r.way.id, result: r.score?.result ?? null, words: r.score ? resultWords(r.score) : null, error: r.error ?? null })) } : null,
        extendWay: live.extendWay?.id ?? null,
        sphere: live.sphere?.state ?? null,
        lines: live.lineRun ? { you: live.lineRun.tracks[1].length, rings: live.lines ? live.lines.rings.filter(r => r.visible).length : 0, seconds: +(live.lineRun.tracks[1].at(-1).t).toFixed(1), shot: live.lineShot ? { t: +live.lineShot.t.toFixed(1), range: live.lineShot.range } : null,
                                inScene: !!live.lines?.group.parent, tag: ui.shotTag.hidden ? null : ui.shotTag.textContent } : null,
      };
    },
  };
}

// --- the seats fitted to their airframes ---------------------------------------
// The lessons were written on the school's Spitfire. A duel fits itself to the
// airframe it flies (`dogfight-duel.js` `fitAirframe`, `runDuel`); the live
// fight does the same for its two seats with these, so the ace on a jet flies
// with a jet's hands, from a jet's start, thinking with its own cannon and
// shown the fight at the Spitfire's size. What the player's screen is told
// (ranges, the sphere, the coach, the score) stays in real metres: only what
// a pilot's plan is handed is shrunk. On the Spitfire every one of these
// hands back what it was given (features/dogfight-lessons-jets/live-fight.md).

const NEUTRAL_FIT = Object.freeze({ hand: null, pace: 1, gun: null });

/** Both seats fitted: `makePlane(i)` builds a scratch airframe, 0 the ace's
 *  type and 1 yours. A seat that cannot be built is flown as the Spitfire. */
export function fitSeats(makePlane) {
  return [0, 1].map(i => {
    try {
      const make = () => makePlane(i);
      return fitAirframe(make(), make, i);
    } catch {
      return NEUTRAL_FIT;
    }
  });
}

/** A flight state as the seat's hands know it: its airframe's `hand`
 *  (`dogfight-flight.js` `HAND`) on it, as a duel's airframe carries it. */
export function handed(state, fit) {
  return state && fit?.hand && state.hand === undefined ? { ...state, hand: fit.hand } : state;
}

/** The gun a seat's airframe fires, in the world's metres: its own cannon
 *  where it is fitted one, else `gun` (`dogfight-pilot.js` `gunOf`). */
export function seatGun(fit, gun = {}) {
  return gunOf(fit?.gun ?? gun);
}

/** A pilot for a seat fitted `fit`: thinking with the seat's gun as its
 *  pace shows it (`pilotView`), its `memory` copied in (a memory lives in
 *  the space the pilot sees). `skill` and `seed` as `createPilot` takes them. */
export function seatPilot(plan, fit, { gun = {}, skill, seed, memory } = {}) {
  const opts = { gun: pilotView(fit.pace).gun(fit.gun ?? gun) };
  if (skill !== undefined) opts.skill = skill;
  if (seed !== undefined) opts.seed = seed;
  const pilot = createPilot(plan, opts);
  if (memory) Object.assign(pilot.mem, clone(memory));
  return pilot;
}

/**
 * One tick of a seat's pilot, `fits` its own seat's then the other's: both
 * planes' states (real), the ground and the fence shown at its pace, as
 * `runDuel` steps a pilot. Its answer is a stick, and needs no undoing.
 */
export function stepSeat(pilot, fits, { me, him, dt, t, groundAt, arena = null }) {
  const view = pilotView(fits[0].pace);
  return pilot.step({ me: view.see(handed(me, fits[0])), him: view.see(handed(him, fits[1])), dt, t,
                      groundAt: view.ground(groundAt), ceilingBase: 0, arena: view.arena(arena) });
}

/** Verbs that do not lose an -s after "you": "he has" is "you have". */
const YOU_VERBS = { is: 'are', has: 'have', was: 'were', does: 'do', goes: 'go' };
/** Words that end in -s after "he" but are not verbs: "he always turns". */
const NOT_VERBS = new Set(['always', 'thus', 'less', 'across', 'unless', 'perhaps', 'its']);

/**
 * The ace's own words turned to the player: the school's pilots talk about
 * "him" (the other pilot, a placeholder that never reaches the screen), and
 * in the live fight the other pilot is you. "He breaks" is "you break".
 */
export function toYou(say) {
  return String(say)
    .replace(/\b(he) (\w+)\b/gi, (m, he, verb) => {
      const you = he[0] === 'H' ? 'You' : 'you', v = verb.toLowerCase();
      if (YOU_VERBS[v]) return `${you} ${YOU_VERBS[v]}`;
      if (NOT_VERBS.has(v) || !/[^s]s$/.test(v)) return `${you} ${verb}`;
      return `${you} ${verb.replace(/(ss|sh|ch|x|z)es$/, '$1').replace(/ies$/, 'y').replace(/s$/, '')}`;
    })
    .replace(/\bhe\b/g, 'you').replace(/\bHe\b/g, 'You')
    .replace(/\bhimself\b/g, 'yourself').replace(/\bhim\b/g, 'you').replace(/\bhis\b/g, 'your').replace(/\bHis\b/g, 'Your');
}

/** The guide's words, "I" to "you" and "him" (a placeholder for the other
 *  pilot) to the ace, as `inThirdPerson` (`dogfight-recorded.js`) does in
 *  the theatre: the guide flies your seat, so its "I" is you. */
const GUIDE_WORDS = { 'i am': 'you are', "i'm": 'you are', 'i have': 'you have', i: 'you', me: 'you', my: 'your', mine: 'yours',
  myself: 'yourself', we: 'you both', our: 'your', he: 'the ace', him: 'the ace', himself: 'the ace', his: "the ace's" };

export function guideToYou(say) {
  if (!say) return say;
  const out = String(say).replace(/\b(I am|I'm|I have|I|me|my|mine|myself|we|our|he|him|himself|his)\b/gi, w => GUIDE_WORDS[w.toLowerCase()]);
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/** A plain copy of a pilot's memory (numbers, strings, arrays). */
function clone(v) {
  try { return structuredClone(v); } catch { return JSON.parse(JSON.stringify(v)); }
}

/** A vehicle node's template: its name without the instance's `_<n>`. */
const typeOf = node => (node?.name ? String(node.name).replace(/_\d+$/, '') : null);

function isUnder(node, root) {
  for (let n = node; n; n = n.parent) if (n === root) return true;
  return false;
}
