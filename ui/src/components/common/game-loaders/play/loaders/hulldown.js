// Hull down: a Tiger fighting from behind a crest, drawn as a field manual
// draws it, in cross-section, with the enemy's line of sight grazing the
// crest (FM 17-12, 1943, para 46; features/replay-shorts/README.md "The
// loaders"). The tank waits turret-down, wholly below that line, while a
// Sherman rolls up on the far ridge and fires at the crest on suspicion; the
// round digs into the earth. The Tiger creeps up the reverse slope until only
// its turret and gun clear the line (hull down), fires once, its muzzle blast
// raising dust off the crest, and backs straight down again before the reply.
// It never shows its hull or tracks, and never stops on the crest itself.
//
// Each kill is a white ring painted round the barrel, as German crews did.
// Twelve rings and the barrel is changed: the rings fade and it starts again.
//
// Sprites (scripts/render-loader-sprites.sh, "hull down"): FHSW's Tiger and
// FH's M4A1 Sherman, drawn side-on at 15 and 7.5 CSS pixels a metre.

import { W, H } from './kit.js';

// --- the Tiger sprite (hulldown-tiger.webp, 131.5 x 49.5) and its marks --------
const TIGER = { w: 131.5, h: 49.5 };
const T = {
  ground: [49.5, 47], muzzle: [129.4, 13.5], mantlet: [84.7, 13.5], cupola: [49.5, 1.7], turret: [70.5, 4.8],
  hullfront: [96.3, 15.2], hullrear: [2.3, 15.2], trackfront: [96, 45.6], trackrear: [3, 45.6],
};
// --- the Sherman (hulldown-sherman.webp, 48 x 28), facing left ------------------
const SHERMAN = { w: 48, h: 28, ground: [23, 24.9], muzzle: [3.1, 8.2], centre: [23, 13] };

// --- the ground, in cross-section ----------------------------------------------
// Two level steps behind the crest joined by a short slope. On the lower one
// the whole tank, gun and all, is under the enemy's line of sight: turret
// down. The upper one is the hull-down shelf, chosen level so the gun clears
// the crest while the glacis does not. In between the tank climbs pitched.
/** The slope between the steps, in degrees. */
export const SLOPE = 16;
const TAN = Math.tan((SLOPE * Math.PI) / 180);
/** The shelf (hull down), the step below it (turret down), and where the slope runs. */
const SHELF_Y = 108;
const STEP_Y = 124;
const KNEE_X = 160;                                  // the slope's top
const LOW_X = KNEE_X - (STEP_Y - SHELF_Y) / TAN;     // its foot
const FOOT_X = 252;                                  // the crest's hump starts
/** The crest's top. */
export const CREST = { x: 286, y: 76 };
/** The far ridge the Shermans come to, and where each stops. */
const RIDGE_Y = 92.5;
const ENEMY_X = 352;

/** The ground's height at `x` behind the crest. */
export const groundY = x => (x >= KNEE_X ? SHELF_Y : x <= LOW_X ? STEP_Y : SHELF_Y + (KNEE_X - x) * TAN);
/** The Tiger's pitch with its contact at `x`: level on either step, the slope's
 *  in between, eased over each edge by half a hull. */
export function pitchAt(x) {
  const half = (T.trackfront[0] - T.trackrear[0]) / 2;
  const ease = t => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
  return SLOPE * ease((x - (LOW_X - half)) / (2 * half)) * (1 - ease((x - (KNEE_X - half)) / (2 * half)));
}

/** The ground's surface, left to right, as an SVG path; and filled below. */
const SURFACE = [
  `M0 ${STEP_Y}`, `L${(LOW_X - 10).toFixed(1)} ${STEP_Y}`, `Q${LOW_X.toFixed(1)} ${STEP_Y} ${(LOW_X + 10).toFixed(1)} ${(STEP_Y - 10 * TAN).toFixed(1)}`,
  `L${KNEE_X - 10} ${(SHELF_Y + 10 * TAN).toFixed(1)}`, `Q${KNEE_X} ${SHELF_Y} ${KNEE_X + 10} ${SHELF_Y}`, `L${FOOT_X} ${SHELF_Y}`,
  `C${FOOT_X + 12} ${SHELF_Y - 4} ${CREST.x - 16} ${CREST.y} ${CREST.x} ${CREST.y}`,
  `C${CREST.x + 14} ${CREST.y} ${CREST.x + 22} ${RIDGE_Y + 18} ${CREST.x + 34} ${RIDGE_Y + 20}`,
  `C${CREST.x + 46} ${RIDGE_Y + 21} ${ENEMY_X - 24} ${RIDGE_Y} ${ENEMY_X} ${RIDGE_Y}`,
  `L${W} ${RIDGE_Y - 1}`,
].join(' ');
const GROUND_PATH = `${SURFACE} L${W} ${H} L0 ${H} Z`;

/** The Sherman's muzzle when it has stopped on the ridge. */
export const ENEMY_MUZZLE = { x: ENEMY_X - SHERMAN.ground[0] + SHERMAN.muzzle[0], y: RIDGE_Y - SHERMAN.ground[1] + SHERMAN.muzzle[1] };

/** The enemy's line of sight over the crest, its height at `x`. */
export function sightY(x) {
  return CREST.y + ((x - CREST.x) * (ENEMY_MUZZLE.y - CREST.y)) / (ENEMY_MUZZLE.x - CREST.x) - 1;
}

/** Where a point of the Tiger sprite lands on the stage with its track
 *  contact (T.ground) at `x`. */
export function tigerPoint(x, p) {
  const a = (-pitchAt(x) * Math.PI) / 180;
  const dx = p[0] - T.ground[0], dy = p[1] - T.ground[1];
  return { x: x + dx * Math.cos(a) - dy * Math.sin(a), y: groundY(x) + dx * Math.sin(a) + dy * Math.cos(a) };
}

/** The two places the Tiger stops: turret down and hull down (contact x). */
export const TURRET_DOWN = 52;
export const HULL_DOWN = 204;

/** The named points of the Tiger at contact `x`, for the test. */
export function tigerAt(x) {
  return Object.fromEntries(Object.entries(T).map(([k, p]) => [k, tigerPoint(x, p)]));
}

// --- kill rings ----------------------------------------------------------------
export const RINGS = 12;
const RING_GAP = 2.2;
/** The `i`th ring's x on the barrel, in sprite pixels: from near the muzzle brake back. */
export function ringX(i) {
  return T.muzzle[0] - 16 - i * RING_GAP;
}

const css = `
.hd-ground { left: 0; top: 0; width: ${W}px; height: ${H}px; overflow: visible;
  mask-image: radial-gradient(ellipse 62% 80% at 50% 42%, #000 72%, transparent 100%); }
.hd-sight { stroke: #a39c6c; stroke-width: 1; stroke-dasharray: 3 4; opacity: 0; transition: opacity .8s ease; }
.hd-sight.on { opacity: .45; }
.hd-tank { left: 0; top: 0; width: ${TIGER.w}px; height: ${TIGER.h}px; transform-origin: ${T.ground[0]}px ${T.ground[1]}px; }
.hd-tank img { position: absolute; inset: 0; width: 100%; height: 100%; }
.hd-ring { position: absolute; width: 1.1px; height: 3.4px; margin: -1.7px 0 0 -.55px; border-radius: .6px; background: #f2efe0;
  box-shadow: 0 0 2px rgba(255, 255, 240, .5); transition: opacity .9s ease; }
.hd-ring.new { animation: hd-paint 700ms ease-out; }
@keyframes hd-paint { 0% { opacity: 0; transform: scaleY(.2); } 60% { opacity: 1; transform: scaleY(1.15); } 100% { transform: none; } }
.hd-ring.gone { opacity: 0; }
.hd-enemy { width: ${SHERMAN.w}px; height: ${SHERMAN.h}px; transition: filter 1.2s ease, opacity 1s ease; }
.hd-enemy.dead { filter: brightness(.45) saturate(.4); }
.hd-enemy.gone { opacity: 0; }
`;

export default {
  id: 'hulldown',
  title: 'Hull down',
  words: 'Loading',
  sub: 'Still loading. The Tiger is waiting for a better shot.',
  tactic: 'Hull-down on a crest: wait turret-down, rise until only the turret clears the enemy\'s line of sight, fire once, back down before the reply (FM 17-12, 1943).',
  css,
  mount(stage, kit) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'hd-ground');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML = `<defs><linearGradient id="hd-earth" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#4d4632"/><stop offset=".3" stop-color="#2c2920"/><stop offset="1" stop-color="#141412"/></linearGradient></defs>
      <path d="${GROUND_PATH}" fill="url(#hd-earth)"/>
      <path d="${SURFACE}" fill="none" stroke="rgba(185, 179, 138, .5)" stroke-width="1"/>
      <line class="hd-sight" x1="${ENEMY_MUZZLE.x}" y1="${ENEMY_MUZZLE.y}" x2="0" y2="${sightY(0).toFixed(1)}"/>`;
    const sight = svg.querySelector('.hd-sight');

    const tank = kit.div('hd-tank');
    const hull = document.createElement('img');
    hull.src = kit.sprite('hulldown-tiger.webp');
    hull.alt = '';
    tank.append(hull);
    const enemy = document.createElement('img');
    enemy.className = 'hd-enemy';
    enemy.src = kit.sprite('hulldown-sherman.webp');
    enemy.alt = '';
    enemy.style.opacity = '0';
    stage.append(enemy, tank, svg);
    const flash = kit.muzzle(1);
    const enemyFlash = kit.muzzle(-1);
    const rings = [];

    const pose = x => `translate(${x - T.ground[0]}px, ${groundY(x) - T.ground[1]}px) rotate(${-pitchAt(x)}deg)`;
    let at = TURRET_DOWN;
    tank.style.transform = pose(at);

    function drive(to, ms) {
      const from = at;
      at = to;
      tank.style.transform = pose(to);
      // Through the poses between, so it follows the ground over the knee.
      const steps = 12;
      const frames = Array.from({ length: steps + 1 }, (_, k) => ({ transform: pose(from + ((to - from) * k) / steps) }));
      tank.animate(frames, { duration: ms, easing: 'cubic-bezier(.45, 0, .25, 1)' });
    }

    function placeEnemy(x) {
      kit.place(enemy, { left: x - SHERMAN.ground[0], top: RIDGE_Y - SHERMAN.ground[1] });
    }

    function paint(fresh) {
      const ring = kit.div(`hd-ring${fresh ? ' new' : ''}`, { left: ringX(rings.length), top: T.muzzle[1] });
      tank.append(ring);
      rings.push(ring);
    }

    async function shoot() {
      const m = tigerPoint(at, T.muzzle);
      flash.fire(m.x, m.y);
      // Recoil: the hull rocks back on its suspension and settles.
      tank.animate([{ translate: '0 0', rotate: '0deg' }, { translate: '-2.5px 0', rotate: '-.8deg', offset: 0.18 }, { translate: '0 0', rotate: '0deg' }],
        { duration: 520, easing: 'cubic-bezier(.3, 0, .2, 1)', composite: 'add' });
      // Muzzle blast lifts dust off the crest in front: what gives a tank away.
      for (let i = 0; i < 3; i++) kit.puff({ x: CREST.x - 14 + i * 9, y: CREST.y + 3 }, { dx: 6 + i * 4, dy: -10, size: 14, grow: 2.6, ms: 1400, colour: 'rgba(150, 132, 96, .38)' });
      kit.puff(m, { dx: 16, dy: -12, size: 12, grow: 3, ms: 1300 });
      const target = { x: ENEMY_X - 6, y: RIDGE_Y - 16 };
      kit.tracer(m, target, { ms: 240, length: 22 });
      await kit.wait(240);
      kit.dust(target, { n: 6, rise: 12, colour: 'rgba(255, 180, 90, .5)' });
      enemy.classList.add('dead');
    }

    /** A burning wreck: smoke rising off it while the next act plays. */
    async function burn(n) {
      for (let i = 0; i < n; i++) {
        kit.puff({ x: ENEMY_X - 2 + Math.random() * 6, y: RIDGE_Y - 18 }, { dx: -6 - Math.random() * 6, dy: -26, size: 10, grow: 3.4, ms: 2200, colour: 'rgba(60, 58, 52, .55)' });
        await kit.wait(260);
      }
    }

    return {
      get rings() { return rings.length; },
      async play() {
        for (;;) {
          if (rings.length >= RINGS) {
            // A new barrel: the old one's rings go with it.
            rings.forEach((r, i) => kit.after(i * 60, () => r.classList.add('gone')));
            await kit.wait(rings.length * 60 + 900);
            rings.splice(0).forEach(r => r.remove());
          }
          // Turret down, waiting. A Sherman comes up on the far ridge.
          if (at !== TURRET_DOWN) drive(TURRET_DOWN, 900);
          enemy.classList.remove('dead', 'gone');
          placeEnemy(ENEMY_X);
          enemy.animate([{ translate: '64px 0', opacity: 0 }, { translate: '0 0', opacity: 1 }], { duration: 1800, easing: 'cubic-bezier(.2, .6, .3, 1)' });
          enemy.style.opacity = '';
          sight.classList.add('on');
          await kit.wait(2000);
          // It fires at the crest on suspicion: the round goes into the earth.
          enemyFlash.fire(ENEMY_MUZZLE.x, ENEMY_MUZZLE.y);
          kit.puff(ENEMY_MUZZLE, { dx: -10, dy: -8, size: 9 });
          kit.tracer(ENEMY_MUZZLE, { x: CREST.x + 6, y: CREST.y + 2 }, { ms: 200, length: 16 });
          kit.after(200, () => kit.dust({ x: CREST.x + 6, y: CREST.y + 2 }, { n: 7, rise: 16 }));
          await kit.wait(1100);
          // Up the slope, hull down: only the turret above the line.
          drive(HULL_DOWN, 1300);
          await kit.wait(1700);
          await shoot();
          kit.after(400, () => paint(true));
          burn(8);
          await kit.wait(450);
          // Straight back down before the reply.
          drive(TURRET_DOWN, 1100);
          sight.classList.remove('on');
          await kit.wait(2200);
          enemy.classList.add('gone');
          await kit.wait(1000);
        }
      },
      still() {
        tank.style.transform = pose(HULL_DOWN);
        at = HULL_DOWN;
        placeEnemy(ENEMY_X);
        enemy.style.opacity = '';
        enemy.classList.add('dead');
        sight.classList.add('on');
        for (let i = 0; i < 4; i++) paint(false);
      },
    };
  },
};
