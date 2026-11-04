// Fire and movement: a commando section takes an MG 42 nest the way the
// manuals teach it (FM 7-10, 1942, para 144; The German Squad in Combat,
// 1943; features/replay-shorts/README.md "The loaders"). The Bren gun is the
// base of fire: it opens up and keeps the German gun's head down. While it
// fires, and only while it fires, one rifleman at a time gets up, rushes a
// short bound bent low, drops and fires; then the next. Then the Bren moves
// up while the riflemen fire for it. Two groups are never moving at once,
// and the covering group fires harder while the other is up. At the end a
// grenade goes over the sandbags, the German flag comes down and the Union
// flag goes up, and the captured flags stack up in the corner.
//
// Sprites (scripts/render-loader-sprites.sh, "fire and movement"): Secret
// Weapons' British commandos (Bren and No. 4 rifle), each a pose strip and a
// run-gait strip; Forgotten Hope's MG 42 gunner; the game's own flags; the
// sandbags out of the Battle of the Bulge bake.

import { W, CROUCH, LIE, STAND, muzzle, tracer, puff, dust } from './kit.js';

const GROUND = 118;
const NEAR = 128;                 // the nearer of the two rows the men lie in
const BOUND = 120;                // one rush, stage pixels
const RUN_MS = 1500;
/** The nest, in world pixels (the world pans with the section). */
const NEST_X = 470;
const BAGS = { w: 31, h: 29, base: [15.4, 25] };   // duel-sandbags at 0.68 (this scene's 25 px a metre)
const MG42 = { w: 73, h: 20, feet: [44.5, 14.9], muzzle: [2.5, 8.6] };
const FLAG = { w: 23.5, h: 19.5, hoist: [2, 1.8] };
const POLE_H = 46;
/** How many captured flags the corner shows before it starts a new row of them. */
export const FLAGS_MAX = 6;

const BREN = {
  pose: { sprite: 'rush-bren.webp', w: 71, h: 62, feet: [28.5, 47.9], muzzle: [[55.5, 14.5], [59, 25], [68.5, 41.5]] },
  run: { sprite: 'rush-bren-run.webp', w: 52, h: 49, feet: [20, 45.4], frames: 8, cycle: 700 },
};
const RIFLE = {
  pose: { sprite: 'rush-rifle.webp', w: 70, h: 62, feet: [28.5, 47.9], muzzle: [[55.5, 8.6], [56.5, 24.9], [66.5, 42.2]] },
  run: { sprite: 'rush-rifle-run.webp', w: 53, h: 48, feet: [20.5, 44.9], frames: 8, cycle: 600 },
};

/** Where each man lies at the start of a pass, and the bounds of the pass in
 *  order: who goes, and how far. Never two at once: the plan is one list. */
export const START = { bren: [40, GROUND], r1: [112, NEAR], r2: [150, GROUND] };
export const PLAN = [['r1', BOUND], ['r2', BOUND], ['bren', BOUND + 40], ['r1', BOUND + 10], ['r2', BOUND + 30]];
/** How far the world pans after each bound, so the section stays in frame. */
export function panAfter(i) {
  return i === 1 ? 110 : i === 2 ? 110 : i === 4 ? 100 : 0;
}

const css = `
.ru-world { left: 0; top: 0; width: ${W}px; height: 150px; }
.ru-world > * { position: absolute; }
.ru-mound { height: 12px; border-radius: 50% 50% 0 0; background: linear-gradient(#3a3527, #22201a); }
.ru-pole { width: 1.5px; height: ${POLE_H}px; background: linear-gradient(#cfc9ad, #6f6a55); }
.ru-flag { transition: translate 1.4s cubic-bezier(.45, 0, .3, 1), opacity .6s ease; }
.ru-flag.down { translate: 0 ${POLE_H - FLAG.h}px; opacity: 0; }
.ru-gunner { transition: opacity .8s ease; }
.ru-gunner.out { opacity: 0; }
.ru-nade { width: 3px; height: 3px; border-radius: 50%; background: #2b2a24; box-shadow: 0 0 0 .5px #6d6a58; }
.ru-tally { top: 10px; transition: opacity .5s ease, translate .5s ease; }
.ru-tally.new { animation: ru-in 600ms cubic-bezier(.3, 0, .2, 1); }
@keyframes ru-in { 0% { opacity: 0; translate: 0 -6px; } 100% { opacity: 1; translate: 0 0; } }
.ru-tally.gone { opacity: 0; translate: 0 4px; }
`;

export default {
  id: 'rush',
  title: 'Fire and movement',
  words: 'Loading',
  sub: 'Still loading. The section is working forward, one rush at a time.',
  tactic: 'Fire and movement: the Bren keeps the enemy gun down while one rifleman at a time rushes a short bound, drops and fires; then the Bren moves up under their fire (FM 7-10, 1942).',
  css,
  mount(stage, kit) {
    kit.ground(GROUND + 2);
    const world = kit.div('ru-world');
    stage.append(world);
    const tally = [];

    // The nest: a mound with the gunner on it behind the sandbags, and the flag.
    const mound = kit.div('ru-mound', { left: NEST_X + 18, top: GROUND - 10, width: 70 });
    const gunner = document.createElement('img');
    gunner.className = 'ru-gunner';
    gunner.src = kit.sprite('rush-mg42.webp');
    gunner.alt = '';
    const gunnerFeet = { x: NEST_X + 78, y: GROUND - 9 };
    kit.place(gunner, { left: gunnerFeet.x - MG42.feet[0], top: gunnerFeet.y - MG42.feet[1], width: MG42.w, height: MG42.h });
    const bags = document.createElement('img');
    bags.src = kit.sprite('duel-sandbags.webp');
    bags.alt = '';
    kit.place(bags, { left: NEST_X, top: GROUND + 1 - BAGS.base[1], width: BAGS.w, height: BAGS.h });
    const pole = kit.div('ru-pole', { left: NEST_X + 96, top: GROUND - POLE_H });
    const flagDe = document.createElement('img');
    const flagUk = document.createElement('img');
    for (const [img, src] of [[flagDe, 'rush-flag-de.webp'], [flagUk, 'rush-flag-uk.webp']]) {
      img.className = 'ru-flag';
      img.src = kit.sprite(src);
      img.alt = '';
      kit.place(img, { left: NEST_X + 96.7 - FLAG.hoist[0], top: GROUND - POLE_H - FLAG.hoist[1], width: FLAG.w, height: FLAG.h });
    }
    world.append(mound, gunner, bags, pole, flagDe, flagUk);
    const mgMuzzle = { x: gunnerFeet.x - MG42.feet[0] + MG42.muzzle[0], y: gunnerFeet.y - MG42.feet[1] + MG42.muzzle[1] };
    const mgFlash = muzzle(world, -1);

    const men = {
      bren: kit.man({ ...BREN, stance: LIE }),
      r1: kit.man({ ...RIFLE, stance: LIE }),
      r2: kit.man({ ...RIFLE, stance: LIE }),
    };
    for (const m of Object.values(men)) {
      world.append(m.node);
      m.flash = muzzle(world, 1);
    }
    let pan = 0;

    function panTo(to, ms) {
      const from = pan;
      pan = to;
      world.style.transform = `translateX(${-to}px)`;
      world.animate([{ transform: `translateX(${-from}px)` }, { transform: `translateX(${-to}px)` }], { duration: ms, easing: 'cubic-bezier(.45, 0, .3, 1)' });
    }

    /** One burst (or one rifle shot) at the nest. */
    function shoot(m, rounds, gap) {
      for (let i = 0; i < rounds; i++) {
        kit.after(i * gap, () => {
          const from = m.muzzle;
          m.flash.fire(from.x, from.y);
          const to = { x: NEST_X + 6 + Math.random() * 14, y: GROUND - 18 - Math.random() * 8 };
          tracer(world, from, to, { ms: Math.max(120, (to.x - from.x) * 0.7), length: 18 });
          kit.after(Math.max(120, (to.x - from.x) * 0.7), () => dust(world, to, { n: 3, rise: 8 }));
          if (i === 0) puff(world, from, { dx: 8, dy: -8, size: 6 });
        });
      }
    }

    /** The MG 42's burst at the section: long, and low over the men. */
    function enemyBurst(rounds = 6) {
      for (let i = 0; i < rounds; i++) {
        kit.after(i * 70, () => {
          mgFlash.fire(mgMuzzle.x, mgMuzzle.y);
          const to = { x: pan - 30, y: GROUND - 16 - Math.random() * 10 };
          tracer(world, mgMuzzle, to, { ms: (mgMuzzle.x - to.x) * 0.55, length: 22 });
        });
      }
    }

    /** Covering fire from `who` until `cover.on` goes false: harder while
     *  someone is up (`cover.hard`). */
    async function covering(names, cover) {
      while (cover.on) {
        for (const name of names) {
          if (!cover.on) break;
          const m = men[name];
          if (name === 'bren') shoot(m, cover.hard ? 4 + Math.floor(Math.random() * 2) : 3, 95);
          else shoot(m, 1, 0);
          await kit.wait(cover.hard ? 260 : 420);
        }
        await kit.wait(cover.hard ? 280 : 650);
      }
    }

    /** One man's rush: up, run bent low, down, and ready to fire. */
    async function rush(m, dx) {
      m.to(CROUCH, 280);
      await kit.wait(300);
      m.run(dx, RUN_MS);
      await kit.wait(RUN_MS);
      m.to(LIE, 420);
      await kit.wait(520);
    }

    function addFlag() {
      if (tally.length >= FLAGS_MAX) {
        tally.splice(0).forEach((f, i) => { kit.after(i * 60, () => f.classList.add('gone')); kit.after(i * 60 + 600, () => f.remove()); });
      }
      const icon = document.createElement('img');
      icon.className = 'ru-tally new';
      icon.src = kit.sprite('rush-flag-uk.webp');
      icon.alt = '';
      kit.place(icon, { left: 24 + (tally.length % FLAGS_MAX) * 15, width: 12, height: 10 });
      stage.append(icon);
      tally.push(icon);
    }

    function reset() {
      panTo(0, 0);
      world.getAnimations({ subtree: true }).forEach(a => a.cancel());
      for (const [name, [x, y]] of Object.entries(START)) men[name].set(LIE).at(x, y);
      gunner.classList.remove('out');
      flagDe.classList.remove('down');
      flagUk.classList.add('down');
    }

    return {
      get flags() { return tally.length; },
      async play() {
        reset();
        world.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 600, easing: 'ease-out' });
        await kit.wait(700);
        for (;;) {
          // The German gun has the section pinned.
          enemyBurst();
          await kit.wait(1000);
          enemyBurst(5);
          await kit.wait(900);
          // The Bren opens up: the base of fire. The MG goes quiet.
          const cover = { on: true, hard: false };
          covering(['bren'], cover);
          await kit.wait(1100);
          // The bounds, one man at a time, each under the others' fire.
          const firing = new Set(['bren']);
          for (const [i, [who, dx]] of PLAN.entries()) {
            firing.delete(who);
            cover.on = false;
            await kit.wait(10);
            const next = { on: true, hard: true };
            covering([...firing], next);
            await rush(men[who], dx);
            next.on = false;
            firing.add(who);
            const pans = panAfter(i);
            if (pans) panTo(pan + pans, 1200);
            Object.assign(cover, { on: true, hard: false });
            covering([...firing], cover);
            await kit.wait(pans ? 1300 : 700);
          }
          // The assault: a grenade over the bags, the gun is silenced.
          cover.on = false;
          const thrower = men.r2;
          thrower.to(CROUCH, 260);
          await kit.wait(360);
          const nade = kit.div('ru-nade');
          world.append(nade);
          const from = { x: thrower.x + 10, y: thrower.y - 30 };
          const to = { x: NEST_X + 50, y: GROUND - 10 };
          kit.fly(nade, [
            { transform: `translate(${from.x}px, ${from.y}px)` },
            { transform: `translate(${(from.x + to.x) / 2}px, ${from.y - 34}px)`, easing: 'cubic-bezier(.5, 0, 1, 1)', offset: 0.5 },
            { transform: `translate(${to.x}px, ${to.y}px)` },
          ], { duration: 800, easing: 'cubic-bezier(0, .3, .6, 1)' });
          thrower.to(LIE, 420);
          await kit.wait(1300);   // the fuze runs on after it lands
          dust(world, to, { n: 9, spread: 16, rise: 24, colour: 'rgba(120, 112, 90, .55)' });
          puff(world, to, { dx: 4, dy: -18, size: 16, grow: 3, ms: 1600, colour: 'rgba(80, 76, 66, .5)' });
          gunner.classList.add('out');
          await kit.wait(900);
          // The flag comes down; ours goes up.
          flagDe.classList.add('down');
          await kit.wait(700);
          flagUk.classList.remove('down');
          for (const m of Object.values(men)) m.to(CROUCH, 400);
          await kit.wait(1400);
          addFlag();
          await kit.wait(1500);
          world.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 600, easing: 'ease-in', fill: 'forwards' });
          await kit.wait(650);
          reset();
          world.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 600, easing: 'ease-out' });
          await kit.wait(700);
        }
      },
      still() {
        reset();
        men.r1.at(START.r1[0] + BOUND);
        men.bren.set(LIE);
        addFlag();
        addFlag();
      },
    };
  },
};
