// Brass: the Short loader's first scene (features/replay-shorts, "The
// loader"). A prone British rifleman from the game (the BritishSoldier BAR
// pose's `lie` clip; scripts/render-loader-sprites.sh draws brass-soldier.webp)
// fires short bursts; each spent case arcs out and lands end-on in a pile in
// front of him, and the pile stacks up into a pyramid. A full pyramid settles
// and he starts another.

import { W } from './kit.js';

// The sprite is 311.5 x 68.5 at 1x (drawn at 2x).
const SOLDIER = { left: 12, top: 44, width: 311.5, height: 68.5 };
const MUZZLE = { x: SOLDIER.left + 308.6, y: SOLDIER.top + 45.4 };
const PORT = { x: SOLDIER.left + 228.9, y: SOLDIER.top + 40.5 };
const GROUND = SOLDIER.top + 66;
// The pile: rows of cases seen end-on, seven at the bottom, on the ground in
// front of him (lower on the stage, nearer the eye) so it never hides the rifle.
const CASE = 7;
const ROWS = 7;
const PILE_X = 206;
const PILE_GROUND = GROUND + 22;
export const PILE = (ROWS * (ROWS + 1)) / 2;
// A BAR's magazine: twenty rounds, then a pause to change it.
const MAG = 20;

/** Where the `i`th case of the pile sits, its centre in stage pixels. */
export function pileSlot(i) {
  let row = 0;
  let left = i;
  while (left >= ROWS - row) { left -= ROWS - row; row++; }
  const across = ROWS - row;
  const x = PILE_X - ((across - 1) * CASE) / 2 + left * CASE;
  const y = PILE_GROUND - CASE / 2 - row * CASE * 0.86;
  return { x, y };
}

const css = `
.br-soldier { left: ${SOLDIER.left}px; top: ${SOLDIER.top}px; width: ${SOLDIER.width}px; height: ${SOLDIER.height}px; transform-origin: 30% 80%; }
.br-soldier.kick { animation: br-kick 70ms ease-out; }
@keyframes br-kick { 0% { transform: translateX(0); filter: brightness(1.25); } 40% { transform: translateX(-1.6px) rotate(-.25deg); }
  100% { transform: translateX(0); filter: brightness(1); } }
.br-soldier.reload { animation: br-reload 900ms ease-in-out; }
@keyframes br-reload { 0%, 100% { transform: none; } 35%, 65% { transform: translateY(1.5px) rotate(.6deg); } }
.br-case { width: 8px; height: 3px; margin: -1.5px 0 0 -4px; border-radius: 1.5px 1px 1px 1.5px;
  background: linear-gradient(180deg, #f6dd8a, #c99a35 60%, #8a6420); }
.br-brass { width: ${CASE}px; height: ${CASE}px; border-radius: 50%;
  background: radial-gradient(circle at 50% 50%, #3a2a10 0 17%, #b9872c 19% 26%, #e9c463 30%, #c4962f 62%, #7a5518 100%);
  box-shadow: 0 0 0 .5px rgba(0, 0, 0, .45); transition: opacity .5s ease, transform .5s ease; }
.br-brass.new { box-shadow: 0 0 0 .5px rgba(0, 0, 0, .45), 0 0 6px rgba(255, 210, 110, .7); }
.br-brass.gone { opacity: 0; transform: translateY(6px); }
`;

export default {
  id: 'brass',
  title: 'Brass',
  words: 'Loading',
  sub: "The server is taking its time. They'll keep firing.",
  tactic: 'A BAR gunner firing short bursts from the prone; a magazine is twenty rounds.',
  css,
  mount(stage, kit) {
    kit.ground(GROUND);
    kit.shadow(SOLDIER.left + 20 + (SOLDIER.width - 30) / 2, GROUND - 1, SOLDIER.width - 30);
    const soldier = document.createElement('img');
    soldier.className = 'br-soldier';
    soldier.src = kit.sprite('brass-soldier.webp');
    soldier.alt = '';
    soldier.decoding = 'async';
    stage.append(soldier);
    const flash = kit.muzzle(1);
    const pile = [];
    let fired = 0;

    function lay(i, fresh) {
      const slot = pileSlot(i);
      const brass = kit.div(`br-brass${fresh ? ' new' : ''}`, { left: slot.x - CASE / 2, top: slot.y - CASE / 2 });
      pile.push(brass);
      stage.append(brass);
      return brass;
    }

    /** A spent case: up and back out of the port, tumbling, then end-on into
     *  its place on the pile. */
    function eject() {
      if (pile.length >= PILE) return;
      const slot = pileSlot(pile.length);
      const brass = lay(pile.length, true);
      brass.style.opacity = '0';
      const flying = kit.div('br-case');
      stage.append(flying);
      const peak = PORT.y - 26 - Math.random() * 14;
      const spin = 540 + Math.random() * 540;
      const midX = PORT.x + (slot.x - PORT.x) * 0.45 + 6;
      const a = kit.fly(flying, [
        { transform: `translate(${PORT.x}px, ${PORT.y}px) rotate(0deg)`, easing: 'cubic-bezier(.2,.6,.4,1)' },
        { transform: `translate(${midX}px, ${peak}px) rotate(${spin * 0.5}deg)`, easing: 'cubic-bezier(.6,0,.9,.6)', offset: 0.42 },
        { transform: `translate(${slot.x}px, ${slot.y}px) rotate(${spin}deg) scaleX(.85)`, offset: 0.9 },
        { transform: `translate(${slot.x}px, ${slot.y}px) rotate(${spin}deg) scaleX(.3)`, opacity: 0 },
      ], { duration: 560 });
      a?.finished.then(() => {
        brass.style.opacity = '';
        brass.animate([{ transform: 'translateY(-2px)' }, { transform: 'translateY(0)' }], { duration: 120, easing: 'ease-out' });
        kit.after(500, () => brass.classList.remove('new'));
      }, () => {});
    }

    function shot() {
      kit.restart(soldier, 'kick');
      flash.fire(MUZZLE.x, MUZZLE.y);
      kit.tracer({ x: MUZZLE.x + 6, y: MUZZLE.y }, { x: W + 40, y: MUZZLE.y + (Math.random() - 0.5) * 3 }, { ms: 130, length: 34 });
      if (fired % 2 === 0) kit.puff(MUZZLE, { dx: 10 + Math.random() * 14, dy: -16 - Math.random() * 8 });
      eject();
      fired++;
    }

    /** A full pyramid settles away, top first, and the next one starts. */
    async function settle() {
      pile.slice().reverse().forEach((brass, i) => kit.after(i * 18, () => brass.classList.add('gone')));
      const gone = pile.splice(0);
      kit.after(gone.length * 18 + 600, () => gone.forEach(b => b.remove()));
      await kit.wait(gone.length * 18 + 800);
    }

    return {
      get count() { return pile.length; },
      async play() {
        await kit.wait(250);
        for (;;) {
          if (pile.length >= PILE) await settle();
          const rounds = 2 + Math.floor(Math.random() * 3);
          for (let n = 0; n < rounds && pile.length < PILE; n++) {
            shot();
            if (fired % MAG === 0) {
              await kit.wait(200);
              kit.restart(soldier, 'reload');
              await kit.wait(1000);
              break;
            }
            await kit.wait(115);
          }
          await kit.wait(380 + Math.random() * 380);
        }
      },
      still() { while (pile.length < 12) lay(pile.length, false); },
    };
  },
};
