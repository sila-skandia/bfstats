// Drives `viewer/fall-damage.js` against the real `SoldierBody` and prints one
// JSON blob. `tests/test_fall_damage.py` asserts on the output.
//
// Two halves, deliberately. The first is the formula on its own, fed numbers
// straight out of HP-14 so each term can be pinned without a simulation in the
// way. The second drops a real body off a real height onto a real heightfield
// and bills it, which is the only way to find out whether the two ends agree —
// and it is where the "first damage near 4 m, death near 7.5 m" figures in the
// ledger have to come out.

import {
  fallSeverity, fallSeverityRaw, fallDamageFor, soldierFallScalars,
  FALL_SPEED_OFFSET, FALL_SPEED_SATURATION, FALL_SPEED_LERP_FROM,
  FALL_SPEED_LERP_SPAN, FALL_HEIGHT_LERP_FROM, FALL_HEIGHT_SATURATION,
  FALL_HEIGHT_FREE, DAMAGE_THRESHOLD, SOLDIER_SPEED_MOD, SOLDIER_MATERIAL,
  SOLDIER_HIT_POINTS, MATERIAL_WATER,
} from './fall-damage.mjs';
import { SoldierBody, TICK_DT, GRAVITY } from './physics.mjs';

const results = {};

results.constants = {
  speedOffset: FALL_SPEED_OFFSET,
  speedSaturation: FALL_SPEED_SATURATION,
  speedLerpFrom: FALL_SPEED_LERP_FROM,
  speedLerpSpan: FALL_SPEED_LERP_SPAN,
  heightLerpFrom: FALL_HEIGHT_LERP_FROM,
  heightSaturation: FALL_HEIGHT_SATURATION,
  heightFree: FALL_HEIGHT_FREE,
  threshold: DAMAGE_THRESHOLD,
  speedMod: SOLDIER_SPEED_MOD,
  soldierMaterial: SOLDIER_MATERIAL,
  hitPoints: SOLDIER_HIT_POINTS,
  water: MATERIAL_WATER,
};

// --- the tables the formula reads ------------------------------------------
//
// A stand-in for `_shared/damage.json` carrying exactly what the shipped one
// does for the materials that matter: every terrain id 0-15 damages 30 and
// modifies 0.001 against the soldier's 40, and water modifies 1.5e-05.
const tables = { materials: {}, modifiers: {} };
for (let id = 0; id <= 15; id++) {
  tables.materials[String(id)] = { attGroup: id, defGroup: id, damage: 30.0 };
  tables.modifiers[String(id)] = { 40: id === MATERIAL_WATER ? 1.5e-05 : 0.001 };
}
tables.materials['40'] = { attGroup: 40, defGroup: 40, damage: 10.0 };

results.scalars = {
  dryDirt: soldierFallScalars(tables, 4),
  water: soldierFallScalars(tables, MATERIAL_WATER),
  // An id the define file never mentions: DMG-1 says that is no damage, not a
  // default, so the pair comes back null and the formula returns 0.
  unlisted: soldierFallScalars(tables, 201),
  // The product both terrain numbers collapse to.
  product: 0.001 * 30.0,
};

// --- the formula, term by term ---------------------------------------------

const land = (over) => fallSeverityRaw({
  damageMod: 0.001, materialDamage: 30.0, ...over,
});

// The 8.0 and its early return. A soldier arriving at exactly 8 m/s takes
// nothing at all, however far he fell, because `v` is 0.
results.speedOffset = {
  at7: land({ impactSpeed: 7, fallHeight: 20 }),
  at8: land({ impactSpeed: 8, fallHeight: 20 }),
  at9: land({ impactSpeed: 9, fallHeight: 20 }),
  // And the term really is `(|v| - 8)^2` and not `|v|^2`: doubling the excess
  // must quadruple the severity, which a raw-speed formula cannot do.
  excess2: land({ impactSpeed: 10, fallHeight: 2, cosTheta: 1 }),
  excess4: land({ impactSpeed: 12, fallHeight: 2, cosTheta: 1 }),
};

// `X` and the squared `Q`. Below 2 m `X` is 1, so `Q` is 1; above it `Q` is
// `F - 1` and the severity goes with its square.
results.heightTerm = {
  q1: land({ impactSpeed: 12, fallHeight: 1.5 }),
  q1AtTwo: land({ impactSpeed: 12, fallHeight: 2.0 }),
  q2: land({ impactSpeed: 12, fallHeight: 3.0 }),
  q3: land({ impactSpeed: 12, fallHeight: 4.0 }),
};

// The angle term, and the two lerps that erase it.
results.angleTerm = {
  // Below both lerps: a glancing arrival is cubed away.
  straightDown: land({ impactSpeed: 9.5, fallHeight: 1.0, cosTheta: 1.0 }),
  glancing: land({ impactSpeed: 9.5, fallHeight: 1.0, cosTheta: 0.5 }),
  // Water squares the cosine instead of cubing it, so the same glancing
  // arrival keeps more of its severity before the scalars are applied.
  glancingCubed: fallSeverityRaw({
    impactSpeed: 9.5, fallHeight: 1.0, cosTheta: 0.5,
    damageMod: 0.001, materialDamage: 30.0, inWater: false,
  }),
  glancingSquared: fallSeverityRaw({
    impactSpeed: 9.5, fallHeight: 1.0, cosTheta: 0.5,
    damageMod: 0.001, materialDamage: 30.0, inWater: true,
  }),
  // Saturated by height at 3 m, so the angle stops mattering entirely.
  glancingHigh: land({ impactSpeed: 12, fallHeight: 3.0, cosTheta: 0.5 }),
  straightHigh: land({ impactSpeed: 12, fallHeight: 3.0, cosTheta: 1.0 }),
  // And saturated by speed above 30 m/s of *excess*.
  glancingFast: land({ impactSpeed: 39, fallHeight: 1.0, cosTheta: 0.2 }),
  straightFast: land({ impactSpeed: 39, fallHeight: 1.0, cosTheta: 1.0 }),
};

// Delivered only above 1.0.
// `fallSeverity`, not the raw one: this is the delivery test itself. At a 4 m
// fall `Q` is 3 and `A` is saturated, so severity is 0.135 * (|v| - 8)^2 and
// crosses 1.0 at an impact of 10.72 m/s. These straddle it.
results.threshold = {
  justUnder: fallSeverity({ impactSpeed: 10.6, fallHeight: 4,
                            damageMod: 0.001, materialDamage: 30.0 }),
  justUnderRaw: land({ impactSpeed: 10.6, fallHeight: 4 }),
  justOver: fallSeverity({ impactSpeed: 10.9, fallHeight: 4,
                           damageMod: 0.001, materialDamage: 30.0 }),
};

// An unlisted pair is no damage (DMG-1), not a default.
results.unlistedPairIsNoDamage = fallDamageFor(
  { impactSpeed: 30, fallHeight: 20, cosTheta: 1, material: 201 }, tables);

// --- a real body, dropped ---------------------------------------------------

/** Flat ground at y = 0 of `material`, with no hulls. */
function flatWorld(material = 4, waterLevel = null) {
  return {
    waterLevel,
    surfaceHeight: () => 0,
    heightfield: {
      normal: (x, z, out) => { out[0] = 0; out[1] = 1; out[2] = 0; return out; },
      material: () => material,
    },
  };
}

/** Drop from `height`, land, and report what the fall was worth. */
function drop(height, { material = 4, waterLevel = null, input = {} } = {}) {
  const world = flatWorld(material, waterLevel);
  const body = new SoldierBody({ world, yaw: 0 });
  body.place(0, height, 0);
  // `place` sets `lastCollisionHeight` to where it was put, which is exactly
  // the engine's meaning: the drop is measured from the last contact.
  for (let i = 0; i < 60 * 10; i++) {
    body.step(TICK_DT, input);
    if (body.landed) {
      const landing = {
        impactSpeed: body.impactSpeed,
        fallHeight: body.fallHeight,
        cosTheta: body.impactCosTheta,
        material: body.impactMaterial,
      };
      return {
        height, ...landing,
        hp: fallDamageFor(landing, tables),
        ...soldierFallScalars(tables, body.impactMaterial),
      };
    }
  }
  return { height, never: true };
}

// The table the ledger's two landmarks have to fall out of.
results.dropTable = [];
for (const h of [1, 2, 3, 3.5, 3.9, 4, 4.5, 5, 6, 7, 7.5, 8, 9, 10, 12, 15, 20]) {
  results.dropTable.push(drop(h));
}

// The two landmarks, found by bisection rather than read off the table.
function firstHeightWhere(predicate, lo = 0.5, hi = 40) {
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (predicate(drop(mid))) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}
results.firstDamageHeight = firstHeightWhere(d => d.hp > 0);
results.lethalHeight = firstHeightWhere(d => d.hp >= SOLDIER_HIT_POINTS);

// Water is about 67x gentler, and a soldier who would have died on land walks
// away from the same drop into the sea.
results.intoWater = drop(10, { material: MATERIAL_WATER, waterLevel: 0 });
results.ontoLand = drop(10);

// A jump costs nothing: the take-off and landing speeds match at 6 m/s, which
// is under the 8.0, and `F` is 0 because the last contact was the floor.
{
  const world = flatWorld(4);
  const body = new SoldierBody({ world, yaw: 0 });
  body.place(0, 0, 0);
  for (let i = 0; i < 10; i++) body.step(TICK_DT, {});
  body.jump();
  let landing = null;
  for (let i = 0; i < 300; i++) {
    body.step(TICK_DT, {});
    if (body.landed) {
      landing = {
        impactSpeed: body.impactSpeed, fallHeight: body.fallHeight,
        cosTheta: body.impactCosTheta, material: body.impactMaterial,
      };
      break;
    }
  }
  results.jumpCostsNothing = {
    landing, hp: fallDamageFor(landing, tables),
  };
}

// A jump *off* a ledge is billed the ledge and not the apex above it: `F` is
// the last collision's height, so the extra 1.12 m of jump is free.
{
  const height = 6;
  const world = flatWorld(4);
  const body = new SoldierBody({ world, yaw: 0 });
  // Stand on a "ledge": start on the ground, jump, and compare against a plain
  // fall from the apex. The apex reading would bill 1.12 m more.
  body.place(0, height, 0);
  for (let i = 0; i < 300; i++) { body.step(TICK_DT, {}); if (body.landed) break; }
  results.plainFallFrom6 = { fallHeight: body.fallHeight,
                             impactSpeed: body.impactSpeed };
}

results.gravity = GRAVITY;
console.log(JSON.stringify(results));
