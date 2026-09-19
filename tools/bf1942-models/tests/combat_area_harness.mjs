// Drives `viewer/combat-area.js` outside a browser and prints one JSON blob.
//
// Same shape as the other harnesses here: `tests/test_combat_area.py` copies
// the viewer module in under its own name, so the file under test is the file
// the page loads, byte for byte. The module imports nothing.

import { CombatArea, combatAreaRect, isInside, distanceOutside,
         isDamagingMaterial, DEFAULT_TIME_ALLOWED, DEFAULT_DAMAGE_PER_SECOND,
         DEFAULT_MATERIAL_TO_GIVE_DAMAGE,
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
  for (const [dt, x, z, material] of samples) out.push(area.step(dt, x, z, material));
  return out;
}

// A level with no area at all and no material channel: inert, whatever the
// position. `active` is now true (the material half COULD fire if the level
// fed one) but nothing happens without a material, which is the behaviour
// every such level had before CA-5 was wired.
const inert = new CombatArea({ combatArea: null });
results.inert = {
  active: inert.active,
  hasRect: inert.hasRect,
  materialToGiveDamage: inert.materialToGiveDamage,
  frames: run(inert, [[1, 1e6, 1e6], [1, 1e6, 1e6]]),
};

// The same level with the material half switched off entirely.
const rectOnly = new CombatArea({ combatArea: null }, { materialToGiveDamage: null });
results.rectOnly = {
  active: rectOnly.active,
  materialToGiveDamage: rectOnly.materialToGiveDamage,
  // Standing on material 7 with the test off: still inside.
  frames: run(rectOnly, [[1, 10, -10, 7], [1, 10, -10, 7]]),
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

// The accumulator is written back to the allowance on every damage frame
// (0x081524a8 / 0x081524ac / 0x081524b2), not left to grow. A player who has
// been out for a minute reads 10, and the damage is unchanged because each
// later frame re-crosses by its own dt.
const clamped = new CombatArea(berlinReal);
const clampFrames = run(clamped, Array.from({ length: 60 }, () => [1, 1000, -1800]));
results.clamp = {
  // Frame 11 is the first past the 10 s allowance.
  atFirstDamage: clampFrames[10],
  afterSixtySeconds: {
    outsideFor: clamped.outsideFor,
    damage: clampFrames[59].damage,
    countdown: clampFrames[59].countdown,
  },
  // Every frame from the eleventh on damages, so the clamp costs no HP.
  damagingFrames: clampFrames.filter(f => f.damage > 0).length,
  totalDamage: Math.round(clampFrames.reduce((s, f) => s + f.damage, 0) * 1000) / 1000,
};

// Edge inclusivity, now read rather than assumed: the four x87 comparisons
// only leave the area when a coordinate is strictly beyond an edge.
const edge = new CombatArea(berlinReal);
results.edges = {
  // Berlin is x 1536..2048, z 1536..2048 -> gltf min/max after the z flip.
  minCorner: edge.step(1, 1536, -1536).inside,
  maxCorner: edge.step(1, 2048, -2048).inside,
  justOutsideMinX: edge.step(1, 1535.9, -1600).inside,
  justOutsideMaxX: edge.step(1, 2048.1, -1600).inside,
  justOutsideMinZ: edge.step(1, 1600, -1535.9).inside,
  justOutsideMaxZ: edge.step(1, 1600, -2048.1).inside,
};

// --- CA-5, the painted half ----------------------------------------------

results.material = {
  defaultId: DEFAULT_MATERIAL_TO_GIVE_DAMAGE,
  // `cmp eax,edx` at 0x08152546 is a plain equality on a byte.
  matches: isDamagingMaterial(7, 7),
  misses: isDamagingMaterial(8, 7),
  // A level with no `terrain/materials.png` feeds null, and null is not 7.
  nullMaterial: isDamagingMaterial(null, 7),
  undefinedMaterial: isDamagingMaterial(undefined, 7),
  // The channel exists but the test is switched off.
  testOff: isDamagingMaterial(7, null),
};

// Berlin: standing well inside the rectangle, on gravel and then on 7. The
// real level paints 7 over 84% of the samples inside its own box and puts
// every control point on 8 or 14, so this is the level's own shape.
const painted = new CombatArea(berlinReal);
results.paintedGround = {
  frames: run(painted, [
    [1, 1800, -1800, 8],    // gravel: inside
    [1, 1800, -1800, 7],    // painted: the countdown starts
    [1, 1800, -1800, 7],
    [1, 1800, -1800, 14],   // dirt road: back inside, accumulator zeroed
    [1, 1800, -1800, 7],
  ]),
};

// The painted half damages on exactly the same schedule as walking out, and
// stops when the man steps off it.
const paintedLong = new CombatArea(berlinReal);
const paintedFrames = run(paintedLong,
  Array.from({ length: 16 }, () => [1, 1800, -1800, 7]));
results.paintedDamage = {
  countdowns: paintedFrames.map(f => f.countdown),
  damage: paintedFrames.map(f => f.damage),
  total: Math.round(paintedFrames.reduce((s, f) => s + f.damage, 0) * 1000) / 1000,
  distanceIsZero: paintedFrames.every(f => f.distance === 0),
  everyFrameIsInsideTheRect: paintedFrames.every(f => f.inRect),
};

// A level that paints no 7 anywhere must behave exactly as it did before. The
// same walk, with every frame handed a material the level really uses.
const unpainted = new CombatArea(berlinReal);
const unpaintedFrames = run(unpainted, [
  [1, 1800, -1800, 11], [1, 1000, -1800, 11], [1, 1000, -1800, 11],
  [1, 1800, -1800, 11],
]);
const noMaterialFrames = (() => {
  const a = new CombatArea(berlinReal);
  return run(a, [[1, 1800, -1800], [1, 1000, -1800], [1, 1000, -1800],
                 [1, 1800, -1800]]);
})();
results.unpainted = {
  withMaterial: unpaintedFrames.map(f => ({ inside: f.inside, countdown: f.countdown,
                                            damage: f.damage })),
  withoutMaterial: noMaterialFrames.map(f => ({ inside: f.inside, countdown: f.countdown,
                                                damage: f.damage })),
};

// A level with NO rectangle that paints 7 anyway -- aberdeen, kharkov and
// kursk all do, and all three carry `combatArea: null`. The material half has
// to fire there, because the rectangle it would otherwise need is the whole
// heightfield and nothing is ever outside that.
const noRectPainted = new CombatArea({ combatArea: null });
results.noRectPainted = {
  active: noRectPainted.active,
  hasRect: noRectPainted.hasRect,
  frames: run(noRectPainted, [
    [1, 500, -500, 3],
    [1, 500, -500, 7],
    [1, 500, -500, 7],
  ]),
};

// Outside the rectangle, the material is never consulted: 0x08152525 is only
// reached from the in-bounds branch.
const outsideBox = new CombatArea(berlinReal);
results.outsideIgnoresMaterial = run(outsideBox, [
  [1, 1000, -1800, 3],    // outside AND on safe ground: still outside
]);

console.log(JSON.stringify(results));
