// Drives `viewer/combat-area.js` outside a browser and prints one JSON blob.
//
// Same shape as the other harnesses here: `tests/test_combat_area.py` copies
// the viewer module in under its own name, so the file under test is the file
// the page loads, byte for byte. The module imports nothing.

import { CombatArea, combatAreaRect, isInside, distanceOutside,
         DEFAULT_TIME_ALLOWED, DEFAULT_DAMAGE_PER_SECOND,
         OUTSIDE_TEXT, OUTSIDE_COLOR } from './combat-area.js';

const results = {};

results.constants = {
  timeAllowed: DEFAULT_TIME_ALLOWED,
  damagePerSecond: DEFAULT_DAMAGE_PER_SECOND,
  text: OUTSIDE_TEXT,
  color: OUTSIDE_COLOR,
};

// Berlin, as `extract_map.py` writes it: `game.setActiveCombatArea 1536 1536
// 512 512` through `_to_gltf_vec`, which negates z. So `min` carries the
// LARGER z of the pair and the rect has to be normalised.
const berlin = {
  combatArea: { min: [1536, 0, -0], max: [2048, 0, -512] },
};
// The real Berlin scene.json (z already negated both ways).
const berlinReal = {
  combatArea: { min: [1536.0, 0.0, -1536.0], max: [2048.0, 0.0, -2048.0] },
};
results.rects = {
  berlinNormalised: combatAreaRect(berlin),
  berlinReal: combatAreaRect(berlinReal),
  wake: combatAreaRect({ combatArea: null }),
  missing: combatAreaRect({}),
  nullExtras: combatAreaRect(null),
  malformed: combatAreaRect({ combatArea: { min: [1, 2], max: 'x' } }),
  nonFinite: combatAreaRect({ combatArea: { min: [NaN, 0, 0], max: [1, 0, 1] } }),
  degenerate: combatAreaRect({ combatArea: { min: [10, 0, 10], max: [10, 0, 20] } }),
};

const rect = combatAreaRect(berlinReal);
results.inside = {
  centre: isInside(rect, 1800, -1800),
  cornerMin: isInside(rect, 1536, -1536),
  cornerMax: isInside(rect, 2048, -2048),
  westOut: isInside(rect, 1535, -1800),
  eastOut: isInside(rect, 2049, -1800),
  northOut: isInside(rect, 1800, -1535),
  southOut: isInside(rect, 1800, -2049),
  noRect: isInside(null, -99999, 99999),
};
results.distance = {
  inside: distanceOutside(rect, 1800, -1800),
  west10: distanceOutside(rect, 1526, -1800),
  corner: Math.round(distanceOutside(rect, 1533, -1532) * 1000) / 1000,
  noRect: distanceOutside(null, 1e9, 1e9),
};

// --- the state machine ---------------------------------------------------

function run(area, samples) {
  const out = [];
  for (const [dt, x, z] of samples) out.push(area.step(dt, x, z));
  return out;
}

// A level with no area at all: inert, whatever the position.
const inert = new CombatArea({ combatArea: null });
results.inert = {
  active: inert.active,
  frames: run(inert, [[1, 1e6, 1e6], [1, 1e6, 1e6]]),
};

// Walk out of Berlin and stand there. dt 1 s a frame makes the arithmetic
// readable; the module never reads a clock of its own.
const area = new CombatArea(berlinReal);
const OUT = [1, 1000, -1800];   // well west of minX 1536
const IN = [1, 1800, -1800];
results.walkOut = {
  active: area.active,
  frames: run(area, [IN, OUT, OUT, OUT, OUT, OUT, OUT, OUT, OUT, OUT, OUT, OUT, OUT]),
};

// Total damage over a long stay, and the HP a 30-point soldier has left.
const longStay = new CombatArea(berlinReal);
let hp = 30, seconds = 0, firstDamageAt = null, deadAt = null;
for (let i = 0; i < 400; i++) {
  const f = longStay.step(0.1, 1000, -1800);
  seconds += 0.1;
  if (f.damage > 0) {
    if (firstDamageAt === null) firstDamageAt = Math.round(seconds * 10) / 10;
    hp -= f.damage;
    if (hp <= 0 && deadAt === null) deadAt = Math.round(seconds * 10) / 10;
  }
}
results.lethality = {
  firstDamageAt,
  deadAt,
  hpAfter40s: Math.round(hp * 1000) / 1000,
};

// Re-entering zeroes the accumulator, like the engine's own
// `mov [esi+0x178], 0` on the in-bounds branch.
const reenter = new CombatArea(berlinReal);
run(reenter, [OUT, OUT, OUT, OUT, OUT]);
const back = reenter.step(1, 1800, -1800);
const outAgain = reenter.step(1, 1000, -1800);
results.reenter = { back, outAgain };

// The HUD variables the layout binds.
const feeding = new CombatArea(berlinReal);
const vars = {};
feeding.feed(vars, feeding.step(1, 1800, -1800));
results.feedInside = { ...vars };
const vars2 = {};
feeding.feed(vars2, feeding.step(2.5, 1000, -1800));
results.feedOutside = { ...vars2 };

// A dt that is not a number must not poison the accumulator.
const junk = new CombatArea(berlinReal);
results.junkDt = [
  junk.step(NaN, 1000, -1800),
  junk.step(-5, 1000, -1800),
  junk.step(undefined, 1000, -1800),
].map(f => f.outsideFor);

// Overridden constants (a bfheroes-style level).
const heroes = new CombatArea(berlinReal, { timeAllowed: 3, damagePerSecond: 300 });
results.overridden = {
  timeAllowed: heroes.timeAllowed,
  damagePerSecond: heroes.damagePerSecond,
  frames: run(heroes, [[1, 1000, -1800], [1, 1000, -1800], [1, 1000, -1800],
                       [1, 1000, -1800], [1, 1000, -1800]]),
};

console.log(JSON.stringify(results));
