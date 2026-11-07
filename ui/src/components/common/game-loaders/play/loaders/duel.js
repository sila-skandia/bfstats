// The duel: two men, ten paces, no hits. Each kneels at the very moment the
// other fires, so every round goes over his head. A beat of stillness, the
// trade, a double-take at where the rounds went, both firing and both ducking
// at once, the shy dance of standing and kneeling together, then escalation:
// one goes prone, the other dives behind sandbags and takes the burst in the
// bags, and pops up to fire over the prone man's back. Then the next pair.
//
// Every round is a miss, and the misses are tallied in chalk marks at the top,
// fives struck through, one tally per side. Four fives each and the board is
// wiped.
//
// The cast rotates across the game's mods, unnamed on screen (players know
// the models when they see them): BF1942's US soldier against Forgotten Hope's German, a skeleton pirate against a blue pirate (Pirates), a Mon
// Calamari rebel against an Imperial trooper (Galactic Conquest), and a Tommy
// against a Fritz in BF1918. Each man is one sprite strip of the pose glb's
// own stand, crouch and lie clips (scripts/render-loader-sprites.sh, "the
// duel"); the anchors are scripts/sprite-anchors.py's numbers for that strip.

import { W } from './kit.js';

const GROUND = 118;
const LEFT_X = 70;     // the left man's feet
const RIGHT_X = 310;   // the right man's
// Each strip is stand, four blends, crouch, four blends, lie (--tween 4): a
// pose change plays the frames between, so nobody snaps from one to the next.
const TWEEN = 4;
const FRAMES = 3 + 2 * TWEEN;
const STAND = 0, CROUCH = 1, LIE = 2;
const frameOf = pose => pose * (TWEEN + 1);
/** How long a change of pose takes: kneeling is quick, going prone less so. */
const POSE_MS = { 1: 230, 2: 330 };
/** How far ahead of the shot the other man starts down: he sees it coming. */
const DUCK_LEAD = 120;
/** A round's flight, ms per stage pixel: slow enough to follow over a head. */
const ROUND_MS_PER_PX = 1.1;
// The right man's sandbags (duel-sandbags.webp, 45.5 x 42.5, its base at 22.5, 36.6).
const BAGS = { left: 213, w: 45.5, h: 42.5, base: { x: 22.5, y: 36.6 } };
const BAGS_FACE = BAGS.left + 6;

// One strip per man: frame size, feet, and per pose the muzzle and the top of the head.
const MEN = {
  us: { sprite: 'duel-us.webp', frame: [89, 88], feet: [41.5, 70], muzzle: [[72, 12.8], [73, 35.7], [86, 62.5]], top: [2.5, 23.5, 50.5] },
  de: { sprite: 'duel-de.webp', frame: [94, 87], feet: [53, 69.5], muzzle: [[21, 12.4], [20, 36.5], [2, 57.5]], top: [2, 23, 51] },
  red: { sprite: 'duel-red.webp', frame: [93, 87], feet: [41.5, 69.5], muzzle: [[73.5, 12.1], [74.5, 36.5], [89.5, 62.4]], top: [2.5, 23, 51.5] },
  blue: { sprite: 'duel-blue.webp', frame: [93, 87], feet: [51, 69.5], muzzle: [[20.5, 13.4], [18, 34.5], [2.5, 61.3]], top: [2, 23, 51] },
  rebel: { sprite: 'duel-rebel.webp', frame: [92, 93], feet: [43, 75], muzzle: [[70.5, 18.2], [73, 38.6], [89, 66]], top: [2.5, 23, 51.5] },
  trooper: { sprite: 'duel-trooper.webp', frame: [88, 88], feet: [45, 70], muzzle: [[16.5, 14.7], [15.5, 37.9], [2, 64.2]], top: [2.5, 23, 50.5] },
  tommy: { sprite: 'duel-tommy.webp', frame: [106, 88], feet: [43, 70], muzzle: [[87, 12.5], [87.5, 36.4], [102.5, 61.9]], top: [2.5, 23, 51] },
  fritz: { sprite: 'duel-fritz.webp', frame: [110, 87], feet: [67, 69.5], muzzle: [[18, 12.4], [17.5, 36.8], [2.5, 61.8]], top: [2, 23, 51] },
};

/** The pairs: who stands where, how many rounds a burst is, and what flies. */
export const PAIRS = [
  { left: 'us', right: 'de', label: 'BF1942 v Forgotten Hope', burst: [3, 3], round: 'tracer' },
  { left: 'red', right: 'blue', label: 'Pirates', burst: [1, 1], round: 'ball' },
  { left: 'rebel', right: 'trooper', label: 'Galactic Conquest', burst: [2, 3], round: 'bolt' },
  { left: 'tommy', right: 'fritz', label: 'BF1918', burst: [1, 1], round: 'tracer' },
];

/** Where a man's muzzle is on the stage in `pose`, standing with his feet at `x`. */
export function muzzleAt(man, x, pose) {
  const m = MEN[man];
  return { x: x - m.feet[0] + m.muzzle[pose][0], y: GROUND - m.feet[1] + m.muzzle[pose][1] };
}

/** The top of a man's head on the stage in `pose`. */
export function headTop(man, pose) {
  const m = MEN[man];
  return GROUND - m.feet[1] + m.top[pose];
}

/** The sandbags' top edge on the stage. */
export const BAGS_TOP = GROUND - BAGS.base.y + 2;

// --- the tally: chalk marks in fives ------------------------------------------
const MARK = 4;        // between strokes
const GROUP = 24;      // between fives
export const TALLY_MAX = 20;
const TALLY_Y = 12;
const TALLY_FROM = { left: 22, right: W - 22 };

/** The `i`th mark of a tally, from its first: `x` across from the tally's
 *  start (growing inward), and whether it is the stroke through a five. */
export function tallyMark(i) {
  const group = Math.floor(i / 5), k = i % 5;
  if (k < 4) return { x: group * GROUP + k * MARK, strike: false };
  return { x: group * GROUP + (1.5 * MARK), strike: true };
}

const css = `
.du-man { transition: opacity .35s ease; }
.du-man { transition: opacity .45s cubic-bezier(.4, 0, .2, 1), translate .45s cubic-bezier(.4, 0, .2, 1); }
.du-man.out { opacity: 0; translate: 0 6px; }
/* The double-take: a slow lean back on the heels to look after the round, and
   back again. Leans the other way for the man facing left (--lean). */
.du-man.take { animation: du-take 1100ms cubic-bezier(.45, 0, .3, 1); }
@keyframes du-take { 0%, 100% { rotate: 0deg; translate: 0 0; } 35%, 60% { rotate: calc(var(--lean) * -5deg); translate: calc(var(--lean) * -2px) 0; } }
.du-bags { transition: opacity .35s ease; }
.du-mark { width: 1.6px; height: 11px; border-radius: 1px; background: #d9d4b8; opacity: .85; box-shadow: 0 0 3px rgba(233, 228, 200, .25);
  transition: opacity .6s ease, translate .6s ease; }
.du-mark.strike { width: 20px; height: 1.6px; transform: rotate(-24deg); }
.du-mark.new { animation: du-chalk 260ms ease-out; }
@keyframes du-chalk { 0% { clip-path: inset(0 0 100% 0); } 100% { clip-path: inset(0 0 0 0); } }
.du-mark.strike.new { animation: du-strike 260ms ease-out; }
@keyframes du-strike { 0% { clip-path: inset(0 100% 0 0); } 100% { clip-path: inset(0 0 0 0); } }
.du-mark.gone { opacity: 0; translate: 0 4px; }
.sl-tracer.du-bolt { height: 2.5px; background: linear-gradient(90deg, rgba(255, 60, 40, 0), #ff5a3c 40%, #ffd6c8); box-shadow: 0 0 7px rgba(255, 70, 40, .9); }
.sl-tracer.du-bolt-green { height: 2.5px; background: linear-gradient(90deg, rgba(60, 255, 80, 0), #4cff6a 40%, #e0ffe4); box-shadow: 0 0 7px rgba(70, 255, 90, .9); }
.sl-tracer.du-ball { height: 3px; background: radial-gradient(circle at 90% 50%, #2a2a28 0 1.5px, transparent 2px); box-shadow: none; }
`;

export default {
  id: 'duel',
  title: 'Duck',
  words: 'Loading',
  sub: 'Nobody has hit anybody yet. Still loading.',
  tactic: 'Comedy: each soldier kneels as the other fires, so every round goes over a head.',
  css,
  mount(stage, kit) {
    kit.ground(GROUND);
    const bags = document.createElement('img');
    bags.className = 'du-bags';
    bags.src = kit.sprite('duel-sandbags.webp');
    bags.alt = '';
    kit.place(bags, { left: BAGS.left, top: GROUND - BAGS.base.y, width: BAGS.w, height: BAGS.h });

    const tally = { left: [], right: [] };
    let order = PAIRS.map((_, i) => i).sort(() => Math.random() - 0.5);
    let round = 0;
    let men = null;

    function cast(pair) {
      const make = (who, x) => {
        const m = MEN[who];
        const s = kit.strip(m.sprite, { w: m.frame[0], h: m.frame[1], frames: FRAMES, anchor: { x: m.feet[0], y: m.feet[1] } });
        s.node.classList.add('du-man');
        s.node.style.setProperty('--lean', x < W / 2 ? '1' : '-1');
        s.node.style.transformOrigin = `${m.feet[0]}px ${m.feet[1]}px`;
        s.who = who;
        s.x = x;
        s.stance = STAND;
        return s.pose(frameOf(STAND)).at(x, GROUND);
      };
      const next = { pair, a: make(pair.left, LEFT_X), b: make(pair.right, RIGHT_X) };
      next.a.flash = kit.muzzle(1);
      next.b.flash = kit.muzzle(-1);
      // The sandbags go in front of the right man, so they hide him prone.
      stage.append(next.a.node, next.b.node, bags);
      return next;
    }

    function pose(s, p) {
      if (s.stance === p) return;
      const span = Math.abs(p - s.stance);
      s.stance = p;
      s.to(frameOf(p), POSE_MS[span] ?? 230 * span);
    }

    function mark(side) {
      const list = tally[side];
      if (list.length >= TALLY_MAX) return;
      const m = tallyMark(list.length);
      const node = kit.div(`du-mark new${m.strike ? ' strike' : ''}`);
      const x = side === 'left' ? TALLY_FROM.left + m.x : TALLY_FROM.right - m.x - (m.strike ? 18 : 1.6);
      kit.place(node, { left: m.strike ? x - (side === 'left' ? 1 : -1) : x, top: m.strike ? TALLY_Y + 5 : TALLY_Y });
      stage.append(node);
      list.push(node);
    }

    /** A burst from `s` towards the far side (or into `stop`, an x where the
     *  rounds hit something), from its muzzle in its current pose. */
    async function fire(s, n, kind, dir, stop = null, stance = s.stance) {
      const from = muzzleAt(s.who, s.x, stance);
      for (let i = 0; i < n; i++) {
        s.flash.fire(from.x, from.y);
        const end = { x: stop ?? (dir > 0 ? W + 40 : -40), y: from.y + (Math.random() - 0.5) * 2 };
        const ms = Math.abs(end.x - from.x) * (kind === 'ball' ? 2.4 : ROUND_MS_PER_PX);
        const cls = kind === 'bolt' ? (dir > 0 ? 'du-bolt' : 'du-bolt-green') : kind === 'ball' ? 'du-ball' : '';
        kit.tracer({ x: from.x + dir * 6, y: from.y }, end, { ms, length: kind === 'ball' ? 6 : 26, cls });
        if (kind === 'ball') kit.puff(from, { dx: dir * 10, dy: -12, size: 12, grow: 3, ms: 1300 });
        else if (i === 0) kit.puff(from, { dx: dir * 8, dy: -10 });
        if (stop !== null) kit.after(ms, () => kit.dust({ x: stop, y: end.y }, { n: 4, rise: 10 }));
        await kit.wait(kind === 'bolt' ? 140 : 110);
      }
    }

    async function wipe() {
      const all = [...tally.left, ...tally.right];
      all.reverse().forEach((n, i) => kit.after(i * 25, () => n.classList.add('gone')));
      tally.left = [];
      tally.right = [];
      await kit.wait(all.length * 25 + 500);
      all.forEach(n => n.remove());
    }

    async function swap() {
      const pair = PAIRS[order[round % order.length]];
      round++;
      if (round % order.length === 0) order = order.sort(() => Math.random() - 0.5);
      if (men) {
        men.a.node.classList.add('out');
        men.b.node.classList.add('out');
        await kit.wait(380);
        men.a.node.remove();
        men.b.node.remove();
      }
      men = cast(pair);
      for (const s of [men.a, men.b]) {
        s.node.classList.add('out');
        void s.node.getBoundingClientRect();
        s.node.classList.remove('out');
      }
    }

    return {
      get tally() { return tally.left.length + tally.right.length; },
      get pair() { return men?.pair.label ?? null; },
      async play() {
        await swap();
        for (;;) {
          const { a, b, pair } = men;
          const [na, nb] = pair.burst;
          if (tally.left.length >= TALLY_MAX || tally.right.length >= TALLY_MAX) await wipe();
          pose(a, STAND);
          pose(b, STAND);
          await kit.wait(900);                       // the stillness
          // He shoulders the gun; the other is already going down as he fires.
          pose(b, CROUCH);
          await kit.wait(DUCK_LEAD);
          await fire(a, na, pair.round, 1);
          mark('left');
          await kit.wait(500);
          pose(b, STAND);
          await kit.wait(520);
          // The reply; the same luck the other way.
          pose(a, CROUCH);
          await kit.wait(DUCK_LEAD);
          await fire(b, nb, pair.round, -1);
          mark('right');
          await kit.wait(480);
          pose(a, STAND);
          await kit.wait(420);
          // The double-take: both lean back to look after the rounds.
          kit.restart(a.node, 'take');
          kit.restart(b.node, 'take');
          await kit.wait(1250);
          // Both fire at once, and both duck at once: the rounds cross over
          // two heads on the way down.
          pose(a, CROUCH);
          pose(b, CROUCH);
          fire(a, 1, pair.round, 1, null, STAND);
          await fire(b, 1, pair.round, -1, null, STAND);
          mark('left');
          mark('right');
          await kit.wait(800);
          // The shy dance: up together, down together, up together.
          pose(a, STAND); pose(b, STAND);
          await kit.wait(520);
          pose(a, CROUCH); pose(b, CROUCH);
          await kit.wait(620);
          pose(a, STAND); pose(b, STAND);
          await kit.wait(700);
          // Escalation: he goes prone, the other goes down behind the
          // sandbags, and the burst goes into the bags.
          pose(a, LIE);
          await kit.wait(200);
          pose(b, LIE);
          await kit.wait(560);
          await fire(a, Math.max(2, na), pair.round, 1, BAGS_FACE);
          mark('left');
          await kit.wait(600);
          // Up from behind the bags, and over the prone man's back.
          pose(b, STAND);
          await kit.wait(520);
          await fire(b, Math.max(2, nb), pair.round, -1);
          mark('right');
          await kit.wait(800);
          pose(a, STAND);
          await kit.wait(1000);
          await swap();
        }
      },
      still() {
        men ??= cast(PAIRS[0]);
        men.b.pose(frameOf(CROUCH));
        men.b.stance = CROUCH;
        for (let i = 0; i < 7; i++) mark('left');
        for (let i = 0; i < 6; i++) mark('right');
        stage.querySelectorAll('.du-mark').forEach(n => n.classList.remove('new'));
      },
    };
  },
};
