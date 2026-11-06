// The dogfight school's live fight (features/dogfight-school): the player in
// the air against one of the school's aces, on the proving ground. The ace is
// an ordinary bot whose seat the school flies (`bot.js` `ace`), so his
// airframe, guns and rounds are the world's; on the range his rounds hurt
// nobody, and the school counts the ones that met the player instead. The
// player's rounds are priced as ever: shoot him down and he is down.
//
// On screen: the coach (what he is doing, what beats it, the keys), a scope
// (him from above and the energy each of you holds), the score, and a stick
// that shows what the controls are doing. The instructor (I) flies your seat
// through the lesson's counter until you touch the controls; Y starts the
// engagement again.

import { createPilot } from './dogfight-pilot.js';
import { stateOf, len, sub, basis, clamp } from './dogfight-flight.js';
import { placePlane, stage, KILL_HITS } from './dogfight-duel.js';
import { coach, energyWords, TONE } from './dogfight-coach.js';
import { lessonById, KEY_WORDS } from './dogfight-lessons.js';

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
      <small class="dfl-lesson"></small>
      <b class="dfl-line"></b>
      <span class="dfl-tip"></span>
      <span class="dfl-keys"></span>
      <small class="dfl-more"></small>
    </div>
    <div class="dfl-score">
      <b>IN HIS COCKPIT</b><span class="dfl-phase"></span>
      <dl><dt>his hits on you</dt><dd class="dfl-his">0</dd><dt>your hits on him</dt><dd class="dfl-yours">0</dd><dt>kills</dt><dd class="dfl-kills">0 : 0</dd></dl>
    </div>
    <div class="dfl-scope">
      <canvas width="220" height="220"></canvas>
      <div class="dfl-energy"><i class="is-you"><i></i></i><i class="is-him"><i></i></i></div>
      <small class="dfl-energy-words"></small>
    </div>
    <div class="dfl-stick" title="The controls this moment">
      <div class="dfl-pad"><i></i></div>
      <div class="dfl-throttle"><i></i></div>
      <div class="dfl-rudder"><i></i></div>
      <small class="dfl-who">YOU</small>
    </div>
    <div class="dfl-banner" hidden></div>
    <div class="dfl-foot"><kbd>Y</kbd> again <kbd>I</kbd> instructor <kbd>V</kbd> school <kbd>O</kbd> end the lesson</div>`;
  page.stage.appendChild(hud);
  const q = s => hud.querySelector(s);
  const ui = {
    coach: q('.dfl-coach'), lesson: q('.dfl-lesson'), line: q('.dfl-line'), tip: q('.dfl-tip'), keys: q('.dfl-keys'), more: q('.dfl-more'),
    phase: q('.dfl-phase'), his: q('.dfl-his'), yours: q('.dfl-yours'), kills: q('.dfl-kills'),
    scope: q('.dfl-scope canvas'), eYou: q('.dfl-energy .is-you > i'), eHim: q('.dfl-energy .is-him > i'), eWords: q('.dfl-energy-words'),
    pad: q('.dfl-pad > i'), throttle: q('.dfl-throttle > i'), rudder: q('.dfl-rudder > i'), who: q('.dfl-who'),
    banner: q('.dfl-banner'),
  };

  const live = {
    lesson: null, phase: 'idle', t: 0, pilot: null, aceOut: null, bot: null, aceRoot: null,
    hisHits: 0, yourHits: 0, kills: [0, 0], instructor: false, instructorPilot: null, lastInput: null,
    bannerUntil: 0, clock: 0, seatAsked: 0, coachAt: 0, trail: [], placedAt: -1, downAt: null, wouldHaveDied: false,
    instructorOut: null,
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
    live.trail = [];
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
    live.trail = [];
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
      ui.phase.textContent = live.aceOut?.say ? `"${toYou(live.aceOut.say)}"` : '';
      ui.his.textContent = String(live.hisHits);
      ui.yours.textContent = String(live.yourHits);
      ui.kills.textContent = `${live.kills[0]} : ${live.kills[1]}`;
      const ey = Math.max(0, words.energy.you), eh = Math.max(0, words.energy.him);
      const top = Math.max(400, ey, eh);
      ui.eYou.style.width = `${ey / top * 100}%`;
      ui.eHim.style.width = `${eh / top * 100}%`;
      ui.eWords.textContent = energyWords(words.energy.lead);
      live.trail.push([him.position[0], him.position[1], him.position[2]]);
      if (live.trail.length > 60) live.trail.shift();
    }
    drawScope(you, him);
    const showing = live.instructor && live.instructorOut
      ? { roll: live.instructorOut.stick.roll, pitch: live.instructorOut.stick.pitch, rudder: live.instructorOut.stick.rudder, throttle: live.instructorOut.throttle }
      : live.lastInput;
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
    ui.more.textContent = (w.others ?? []).map(o => o.line).join(' · ');
    ui.coach.classList.remove('is-new');
    void ui.coach.offsetWidth;
    ui.coach.classList.add('is-new');
  }

  /** The scope: you in the middle, nose up the screen; him where he is,
   *  his nose a tick, his last six seconds a fading line; his height over
   *  yours down the right edge. */
  function drawScope(you, him) {
    const c = ui.scope, x = c.getContext('2d');
    const W = c.width, H = c.height, R = W / 2 - 8;
    x.clearRect(0, 0, W, H);
    x.save();
    x.translate(W / 2, H / 2);
    x.strokeStyle = 'rgba(233,228,216,.18)';
    x.lineWidth = 1;
    for (const r of [0.33, 0.66, 1]) { x.beginPath(); x.arc(0, 0, R * r, 0, Math.PI * 2); x.stroke(); }
    x.fillStyle = 'rgba(233,228,216,.5)';
    x.font = '10px ui-monospace, monospace';
    x.fillText('350 m', R * 0.33 + 3, -3);
    x.fillText('700', R * 0.66 + 3, -3);
    // Your nose is up the screen.
    const F = basis(you.orientation).F;
    const yaw = Math.atan2(F[0], -F[2]);
    const toScope = p => {
      const dx = p[0] - you.position[0], dz = p[2] - you.position[2];
      const cs = Math.cos(-yaw), sn = Math.sin(-yaw);
      const rx = dx * cs + dz * -sn, rz = dx * sn + dz * cs;
      const k = R / 1050;
      return [rx * k, rz * k];
    };
    x.strokeStyle = 'rgba(224,87,63,.55)';
    x.beginPath();
    live.trail.forEach((p, i) => { const [sx, sy] = toScope(p); i ? x.lineTo(sx, sy) : x.moveTo(sx, sy); });
    x.stroke();
    let [hx, hy] = toScope(him.position);
    const d = Math.hypot(hx, hy);
    if (d > R) { hx *= R / d; hy *= R / d; }
    const hf = basis(him.orientation).F;
    const [fx, fy] = toScope([him.position[0] + hf[0] * 120, 0, him.position[2] + hf[2] * 120]);
    x.strokeStyle = '#e0573f';
    x.lineWidth = 2;
    x.beginPath(); x.moveTo(hx, hy); x.lineTo(hx + (fx - hx) * 0.6, hy + (fy - hy) * 0.6); x.stroke();
    x.fillStyle = '#e0573f';
    x.beginPath(); x.arc(hx, hy, 5, 0, Math.PI * 2); x.fill();
    // You.
    x.fillStyle = '#4ea8e0';
    x.beginPath(); x.moveTo(0, -8); x.lineTo(6, 6); x.lineTo(0, 3); x.lineTo(-6, 6); x.closePath(); x.fill();
    x.restore();
    // His height over yours, on the right edge.
    const dh = him.position[1] - you.position[1];
    const y = H / 2 - clamp(dh / 400, -1, 1) * (H / 2 - 12);
    x.fillStyle = 'rgba(233,228,216,.25)';
    x.fillRect(W - 6, 8, 2, H - 16);
    x.fillStyle = '#e0573f';
    x.fillRect(W - 12, y - 2, 14, 4);
    x.fillStyle = 'rgba(233,228,216,.85)';
    x.font = '11px ui-monospace, monospace';
    x.textAlign = 'right';
    x.fillText(`${dh >= 0 ? '+' : ''}${Math.round(dh)} m`, W - 16, Math.max(14, Math.min(H - 4, y + 4)));
    x.textAlign = 'left';
    x.fillText(`${Math.round(len(sub(him.position, you.position)))} m`, 6, H - 8);
    x.fillText(`${Math.round(len(you.velocity))} m/s`, 6, 14);
  }

  function drawStick(k, instructor) {
    ui.who.textContent = instructor ? 'INSTRUCTOR' : 'YOU';
    hud.classList.toggle('is-instructor', !!instructor);
    if (!k) return;
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
    start, stop, frame, key, flightOverride, noteImpact, toggleInstructor,
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
