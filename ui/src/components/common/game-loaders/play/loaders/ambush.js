// The hedgerow ambush: a Panzerschreck team in the ditch of a Normandy
// hedgerow lets a Sherman go by on the lane beyond, then takes it in the
// side and rear (Der Panzerknacker, 1944; Intelligence Bulletin, Feb 1945;
// features/replay-shorts/README.md "The loaders"). They stay down while the
// tank comes on, front first, past their gap in the hedge: its frontal armour
// is the thick part and its guns point that way. Once it is past, the gunner
// rises in the gap, the loader steps out to the side, clear of the backblast,
// and the rocket goes into the engine deck from a few tens of metres. The
// backblast throws dust back at the viewer. Then both go flat and crawl away
// along the ditch to a new spot before anyone can answer.
//
// Each kill earns the gunner a tank destruction badge, the silver sleeve
// stripe with a black tank on it (Sonderabzeichen für das Niederkämpfen von
// Panzerkampfwagen durch Einzelkämpfer); the fifth is gold and stands for all
// five. They stack in the corner.
//
// Sprites (scripts/render-loader-sprites.sh, "the hedgerow ambush"): Forgotten
// Hope's Panzerschreck gunner and rifleman seen from behind, and FH's M4A1
// Sherman side-on.

import { W, H, STAND, CROUCH, LIE } from './kit.js';

const FEET_Y = 146;              // the team, in the ditch at the foot of the bank
const BANK_Y = 100;              // the top of the bank
const LANE_Y = 104;              // the Sherman's tracks, on the sunken lane beyond
const GUNNER_X = 172;
const LOADER_X = 206;
const GUNNER = { sprite: 'ambush-gunner.webp', w: 43, h: 78, feet: [21.5, 59.2], muzzle: [[32.5, 8.5], [34, 27.9], [40, 42.4]] };
const LOADER = { sprite: 'ambush-loader.webp', w: 42, h: 75, feet: [21.5, 56.7], muzzle: [[30, 12], [31, 30], [36, 44]] };
const SHERMAN = { w: 86, h: 51.5, ground: [44.5, 47], rear: [3.9, 26.1], deck: [13.7, 20.6] };
/** The Sherman's drive: from off the left edge to where the rocket meets it. */
const TANK_FROM = -60;
export const TANK_HIT = 262;
const SPEED = 62;                // stage pixels a second
const ROCKET_MS = 260;
/** Badges: silver for each kill, five silvers become one gold. */
export const BADGES_MAX = 15;

/** The badges for `kills`: `gold` golds then `silver` silvers. */
export function badgesFor(kills) {
  const k = kills % (BADGES_MAX + 1);
  return { gold: Math.floor(k / 5), silver: k % 5 };
}

/** When the gunner must fire, ms after the Sherman sets off, so the rocket
 *  meets its rear at TANK_HIT. */
export function fireAt() {
  return ((TANK_HIT - TANK_FROM) / SPEED) * 1000 - ROCKET_MS;
}

/** The Sherman's rear, where the rocket strikes, with its tracks at x. */
export function rearAt(x) {
  return { x: x - SHERMAN.ground[0] + SHERMAN.rear[0], y: LANE_Y - SHERMAN.ground[1] + SHERMAN.rear[1] };
}

/** Heights the scene depends on: the gunner is hidden crouching and clear standing. */
export function sightlines() {
  const top = st => FEET_Y - GUNNER.feet[1] + [2, 18.5, 37][st];
  return { bank: BANK_Y, crouchTop: top(CROUCH), standMuzzle: FEET_Y - GUNNER.feet[1] + GUNNER.muzzle[STAND][1] };
}

// The bank, its hedge, and the gap the team uses.
const GAP = [GUNNER_X - 22, GUNNER_X + 26];
function hedge() {
  const clumps = [];
  for (let x = -10; x < W + 20; x += 17) {
    if (x > GAP[0] - 8 && x < GAP[1] + 4) continue;
    const r = 13 + ((x * 7) % 9);
    clumps.push(`<ellipse cx="${x}" cy="${BANK_Y - r * 0.45}" rx="${r}" ry="${r * 0.8}" fill="url(#am-leaf)"/>`);
  }
  return clumps.join('');
}

const css = `
.am-bank { left: 0; top: 0; width: ${W}px; height: ${H}px;
  mask-image: radial-gradient(ellipse 62% 85% at 50% 40%, #000 72%, transparent 100%); }
.am-tank { width: ${SHERMAN.w}px; height: ${SHERMAN.h}px; left: 0; top: ${LANE_Y - SHERMAN.ground[1]}px; transition: filter 1.4s ease, opacity 1s ease; }
.am-tank.hit { filter: brightness(.5) saturate(.5); }
.am-tank.gone { opacity: 0; }
.am-team { transition: opacity .8s ease; }
.am-team.out { opacity: 0; }
.am-fire { width: 14px; height: 10px; border-radius: 50%; opacity: 0; background: radial-gradient(circle, rgba(255, 200, 90, .9), rgba(255, 110, 30, .5) 45%, transparent 70%);
  transition: opacity .5s ease; }
.am-fire.on { opacity: 1; animation: am-flicker 260ms ease-in-out infinite alternate; }
@keyframes am-flicker { 0% { transform: scale(.85, 1); } 100% { transform: scale(1.1, 1.25) translateY(-1px); } }
.am-rocket { width: 6px; height: 2px; border-radius: 1px; background: linear-gradient(90deg, #ffd27a, #fff4d0); box-shadow: 0 0 5px rgba(255, 180, 80, .9); }
.am-badges { left: 24px; top: 10px; display: flex; gap: 3px; transition: opacity .5s ease; }
.am-badge { position: relative; width: 20px; height: 8px; border-radius: 1px;
  background: linear-gradient(#262421 0 18%, #c9c9c2 18% 30%, #9b9b94 50%, #c9c9c2 70% 82%, #262421 82%); box-shadow: 0 0 0 .5px rgba(0, 0, 0, .5); }
.am-badge.gold { background: linear-gradient(#262421 0 18%, #f0d27a 18% 30%, #b9922f 50%, #f0d27a 70% 82%, #262421 82%); }
.am-badge::after { content: ''; position: absolute; left: 5px; top: 2px; width: 10px; height: 4px; background: #121210;
  clip-path: polygon(0 100%, 4% 55%, 30% 50%, 34% 15%, 64% 12%, 68% 40%, 100% 38%, 100% 50%, 70% 55%, 96% 60%, 100% 100%); }
.am-badge.new { animation: am-pin 700ms cubic-bezier(.3, 0, .2, 1); }
@keyframes am-pin { 0% { opacity: 0; transform: translateY(-5px) scale(1.3); } 100% { opacity: 1; transform: none; } }
`;

export default {
  id: 'ambush',
  title: 'Hedgerow',
  words: 'Loading',
  sub: 'Still loading. They are letting this one get past first.',
  tactic: 'Anti-tank ambush: let the tank pass out of its frontal arc, then hit the side or rear from a few tens of metres, loader clear of the backblast, and move before anyone answers (Der Panzerknacker, 1944).',
  css,
  mount(stage, kit) {
    const tank = document.createElement('img');
    tank.className = 'am-tank';
    tank.src = kit.sprite('ambush-sherman.webp');
    tank.alt = '';
    const fire = kit.div('am-fire');
    const bank = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    bank.setAttribute('class', 'am-bank');
    bank.setAttribute('viewBox', `0 0 ${W} ${H}`);
    bank.innerHTML = `<defs>
        <radialGradient id="am-leaf" cx=".45" cy=".35" r=".7"><stop offset="0" stop-color="#3f4a2a"/><stop offset=".6" stop-color="#262d1a"/><stop offset="1" stop-color="#171b10"/></radialGradient>
        <linearGradient id="am-earth" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3d372a"/><stop offset=".5" stop-color="#25221a"/><stop offset="1" stop-color="#151411"/></linearGradient></defs>
      <path d="M0 ${BANK_Y} Q${W * 0.25} ${BANK_Y - 3} ${W / 2} ${BANK_Y} T${W} ${BANK_Y} L${W} ${H} L0 ${H} Z" fill="url(#am-earth)"/>
      <path d="M0 ${BANK_Y} Q${W * 0.25} ${BANK_Y - 3} ${W / 2} ${BANK_Y} T${W} ${BANK_Y}" fill="none" stroke="rgba(185, 179, 138, .35)"/>
      ${hedge()}`;
    const badges = kit.div('am-badges');
    stage.append(tank, fire, bank, badges);

    const gunner = kit.man({ pose: GUNNER, stance: CROUCH });
    const loader = kit.man({ pose: LOADER, stance: CROUCH });
    gunner.node.classList.add('am-team');
    loader.node.classList.add('am-team');
    let kills = 0;

    function drawBadges(fresh) {
      const { gold, silver } = badgesFor(kills);
      badges.replaceChildren(...[...Array(gold).fill('gold'), ...Array(silver).fill('')].map((kind, i, all) => {
        const b = kit.div(`am-badge ${kind}${fresh && i === all.length - 1 ? ' new' : ''}`);
        return b;
      }));
    }

    function tankAt(x) { tank.style.transform = `translateX(${x - SHERMAN.ground[0]}px)`; }

    function reset() {
      tank.classList.remove('hit', 'gone');
      fire.classList.remove('on');
      tankAt(TANK_FROM);
      gunner.set(CROUCH).at(GUNNER_X, FEET_Y);
      loader.set(CROUCH).at(LOADER_X, FEET_Y);
      gunner.node.classList.remove('out');
      loader.node.classList.remove('out');
    }

    async function burn() {
      const deck = { x: TANK_HIT + 18 - SHERMAN.ground[0] + SHERMAN.deck[0], y: LANE_Y - SHERMAN.ground[1] + SHERMAN.deck[1] };
      kit.place(fire, { left: deck.x - 7, top: deck.y - 8 });
      fire.classList.add('on');
      for (let i = 0; i < 14; i++) {
        kit.puff({ x: deck.x + Math.random() * 4, y: deck.y - 4 }, { dx: 10 + Math.random() * 8, dy: -30 - Math.random() * 10, size: 9, grow: 3.6, ms: 2400, colour: 'rgba(40, 38, 34, .6)' });
        await kit.wait(300);
      }
    }

    return {
      get kills() { return kills; },
      async play() {
        reset();
        drawBadges(false);
        for (;;) {
          await kit.wait(600);
          // The Sherman comes along the lane; they stay down as it passes the gap.
          const drive = (TANK_HIT - TANK_FROM) / SPEED * 1000;
          tankAt(TANK_HIT);
          tank.animate([{ transform: `translateX(${TANK_FROM - SHERMAN.ground[0]}px)` }, { transform: `translateX(${TANK_HIT - SHERMAN.ground[0]}px)` }],
            { duration: drive, easing: 'linear' });
          const shot = fireAt();
          // Past them: the loader steps out to the side, the gunner rises in the gap.
          await kit.wait(shot - 1100);
          loader.node.animate([{ translate: '0 0' }, { translate: '16px 0' }], { duration: 500, easing: 'cubic-bezier(.4, 0, .2, 1)', fill: 'forwards' });
          await kit.wait(250);
          gunner.to(STAND, 420);
          await kit.wait(850);
          // Fire: the rocket into the engine deck, the backblast at us.
          const m = gunner.muzzle;
          kit.muzzle(1).fire(m.x, m.y);
          kit.puff({ x: m.x - 12, y: m.y + 6 }, { dx: -30, dy: 22, size: 30, grow: 3, ms: 1500, colour: 'rgba(200, 190, 160, .7)' });
          kit.puff({ x: m.x - 8, y: m.y + 4 }, { dx: -14, dy: 34, size: 24, grow: 2.6, ms: 1300, colour: 'rgba(175, 165, 135, .6)' });
          const rocket = kit.div('am-rocket');
          stage.append(rocket);
          const rear = rearAt(TANK_HIT);
          const angle = Math.atan2(rear.y - m.y, rear.x - m.x);
          kit.fly(rocket, [
            { transform: `translate(${m.x}px, ${m.y}px) rotate(${angle}rad) scale(1.2)` },
            { transform: `translate(${rear.x}px, ${rear.y}px) rotate(${angle}rad) scale(.6)` },
          ], { duration: ROCKET_MS, easing: 'cubic-bezier(.3, 0, .9, .6)' });
          await kit.wait(ROCKET_MS);
          // The hit: it rolls on a few metres and stops, burning.
          kit.dust(rear, { n: 8, rise: 14, colour: 'rgba(255, 170, 80, .55)' });
          tankAt(TANK_HIT + 18);
          tank.animate([{ transform: `translateX(${TANK_HIT - SHERMAN.ground[0]}px)` }, { transform: `translateX(${TANK_HIT + 18 - SHERMAN.ground[0]}px)` }],
            { duration: 900, easing: 'cubic-bezier(.2, .6, .3, 1)' });
          tank.classList.add('hit');
          burn();
          kills++;
          kit.after(700, () => drawBadges(true));
          // Down, and away along the ditch.
          await kit.wait(350);
          gunner.to(LIE, 480);
          loader.to(LIE, 480);
          await kit.wait(700);
          for (const m2 of [gunner, loader]) {
            m2.node.animate([{ translate: m2 === loader ? '16px 0' : '0 0' }, { translate: m2 === loader ? '96px 2px' : '80px 2px' }],
              { duration: 2600, easing: 'cubic-bezier(.4, 0, .6, 1)', fill: 'forwards' });
          }
          await kit.wait(1600);
          gunner.node.classList.add('out');
          loader.node.classList.add('out');
          await kit.wait(2200);
          tank.classList.add('gone');
          await kit.wait(1100);
          for (const m2 of [gunner, loader]) m2.node.getAnimations().forEach(a => a.cancel());
          reset();
          for (const m2 of [gunner, loader]) m2.node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 700, easing: 'ease-out' });
        }
      },
      still() {
        reset();
        tankAt(TANK_HIT + 18);
        tank.classList.add('hit');
        gunner.set(CROUCH);
        kills = 3;
        drawBadges(false);
      },
    };
  },
};
