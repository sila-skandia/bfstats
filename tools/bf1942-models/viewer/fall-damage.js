// What a landing costs a soldier, in hit points.
//
// This is `GameServer::handleCollisionLandOrWater`'s **soldier** branch
// (lnxded `0x08154960`), which is ledger row **HP-14** and is written up in
// `features/bf1942-engine-reference/subsystems/hitpoints-and-damage.md`. The
// non-soldier branch — a vehicle crashing, and its object-versus-object twin —
// is a different formula with no height term and no 8.0, and it belongs to
// COL-3/COL-4 and `collision-response.md` §9. Do not reach for this for a jeep.
//
//     v        = |impact velocity| - 8.0,   and the engine RETURNS if that is
//                negative: no damage at all, not a small amount of it
//     F        = getLastCollisionHeight() - pos.y       (Armor +0x28)
//     X        = F < 2 ? 1 : F - 1
//     Q        = max(1, X * kitDamping)
//     A        = |cos(theta)| ^ (inWater ? 2 : 3)
//     A        -> lerped to 1 over 2 <= F < 3, saturated at F >= 3
//     A        -> lerped to 1 over 10 < v <= 30, saturated above 30
//     severity = Q^2 * A * (speedMod * v^2) * damageMod(att, def) * materialDamage(att)
//
// delivered only when `severity > 1.0`.
//
// Three details are worth stating because each was got wrong at least once:
//
//   - **The 8.0 comes off first.** `fsub ds:0x86c08c0` at `0x08155189`
//     overwrites `|v|` before anything downstream reads it, so the kinetic
//     term, the 30.0 saturation and the 10/20 lerp all use the *reduced*
//     speed. A formula without it overstates a 5 m fall by roughly eight
//     times, which is how the viewer's old fitted constant came to exist.
//   - **`F` is the last collision's height, not the apex.** A jump straight up
//     lands with `F = 0`, because the last thing the soldier touched was the
//     floor he jumped from. A jump off a ledge is billed the ledge, not the
//     apex above it. That is also why a jump can never hurt: the take-off and
//     landing speeds match at 6 m/s, and 6 - 8 is negative.
//   - **`Q` is squared.** `fmul st,st(2)` then `fmulp st(2),st` at
//     `0x08154dbb`/`0x08154dbd`, with `Q` in `st(2)`; two agents traced the
//     x87 stack independently to settle it.
//
// The two per-surface scalars are not fitted here either. They are the ordinary
// MaterialManager tables the extractor already writes into `_shared/damage.json`
// (HP-14, and `bf42/damage.py`'s own note): for **every** terrain material 0-15
// `materialDamage = 30` and `damageMod(ground, 40) = 0.001`, so their product is
// 0.030; water is the outlier at `1.5e-05`, about 67x gentler, and squares the
// cosine instead of cubing it. The old `FALL_KINETIC_HP = 10` was a single
// fitted number standing in for both, and it was close (it implied about 0.026)
// precisely because the real pair is 0.030.
//
// Imports nothing, so `tests/fall_damage_harness.mjs` runs it under node.

/** `0x086c08c0`, raw `00 00 00 41`. Subtracted from the impact speed first. */
export const FALL_SPEED_OFFSET = 8.0;

/** Above this the angle term saturates to 1 outright (`0x08154d9d`). */
export const FALL_SPEED_SATURATION = 30.0;

/** And between these two it is lerped toward 1 (`0x08154dc6`-`0x08154dfb`). */
export const FALL_SPEED_LERP_FROM = 10.0;
export const FALL_SPEED_LERP_SPAN = 20.0;

/** The height lerp and its saturation (`0x08154e16`, `0x08154e3b`). */
export const FALL_HEIGHT_LERP_FROM = 2.0;
export const FALL_HEIGHT_SATURATION = 3.0;

/** `X = 1` below this height, `F - 1` above it (`0x08154d62`/`0x08154d69`). */
export const FALL_HEIGHT_FREE = 2.0;

/** Severity is delivered only above this (`fucom st(1)` at `0x08154c6b`). */
export const DAMAGE_THRESHOLD = 1.0;

/** `Armor.speedMod`, vtable `+0x4c`. Vanilla soldier `SpeedMod 0.5`. */
export const SOLDIER_SPEED_MOD = 0.5;

/** Vanilla soldier `Material 40` and `HitPoints 30`. */
export const SOLDIER_MATERIAL = 40;
export const SOLDIER_HIT_POINTS = 30;

/** `materialManagerdefine.con` material 1, which takes the squared cosine. */
export const MATERIAL_WATER = 1;

/** No kit in vanilla declares damage damping, so `Q` rests on `X` alone. */
export const DEFAULT_KIT_DAMPING = 1.0;

/**
 * `damageMod(att, def)` and `materialDamage(att)` for a soldier landing on
 * `groundMaterial`, read out of `_shared/damage.json`.
 *
 * The attacker is the **ground**: it is the thing doing the damage, and the
 * soldier's own material 40 is the defender. Both keys can arrive as numbers or
 * strings depending on how the table was parsed, so both are tried — the same
 * dance `effects-core.js` does for splash.
 *
 * Returns nulls when the pair has no entry, which per **DMG-1** means no
 * damage rather than a default: `MaterialManager+0x24` is 0.0 for the life of
 * the process and no console word can change it.
 */
export function soldierFallScalars(tables, groundMaterial,
                                   defenderMaterial = SOLDIER_MATERIAL) {
  const materials = tables?.materials;
  const modifiers = tables?.modifiers;
  if (!materials || !modifiers) return { damageMod: null, materialDamage: null };
  const att = materials[groundMaterial] ?? materials[String(groundMaterial)];
  const def = materials[defenderMaterial] ?? materials[String(defenderMaterial)];
  if (!att) return { damageMod: null, materialDamage: null };
  const attGroup = att.attGroup ?? groundMaterial;
  const defGroup = def?.defGroup ?? defenderMaterial;
  const row = modifiers[attGroup] ?? modifiers[String(attGroup)];
  const damageMod = row == null ? null : (row[defGroup] ?? row[String(defGroup)] ?? null);
  const materialDamage = att.damage ?? null;
  return { damageMod, materialDamage };
}

/**
 * Hit points a landing costs, or 0 for one that costs nothing.
 *
 * `impactSpeed` is the body's `|v|` at the moment of contact — which has to be
 * sampled *before* the ground clamp, because a viewer that zeroes `velocity.y`
 * to plant the feet has destroyed the number by the time the tick returns.
 * `SoldierBody` captures it for exactly this reason.
 */
export function fallSeverity(options) {
  const severity = fallSeverityRaw(options);
  return severity > DAMAGE_THRESHOLD ? severity : 0;
}

/**
 * The same product without the `> 1.0` delivery test.
 *
 * Split out because the threshold hides the shape: every term below is a
 * multiplier, and a test that wants to prove `(|v| - 8)` is squared, or that
 * `Q` is, needs two severities it can take a ratio of — and near the
 * interesting magnitudes both are under 1.0 and would come back as two zeroes.
 * The engine has no such entry point; `fallSeverity` is the one to call.
 */
export function fallSeverityRaw({
  impactSpeed = 0,
  fallHeight = 0,
  cosTheta = 1,
  inWater = false,
  kitDamping = DEFAULT_KIT_DAMPING,
  speedMod = SOLDIER_SPEED_MOD,
  damageMod = null,
  materialDamage = null,
} = {}) {
  // The 8.0, first, and the early return with it.
  const v = impactSpeed - FALL_SPEED_OFFSET;
  if (!(v > 0)) return 0;
  if (damageMod == null || materialDamage == null) return 0;

  const F = fallHeight;
  const X = F < FALL_HEIGHT_FREE ? 1 : F - 1;
  const Q = Math.max(1, X * kitDamping);

  let A = Math.abs(cosTheta) ** (inWater ? 2 : 3);
  // Height first, then speed. Both lerp the angle term toward 1, which is what
  // makes a long fall hurt the same however you were facing when you left.
  if (F >= FALL_HEIGHT_SATURATION) A = 1;
  else if (F >= FALL_HEIGHT_LERP_FROM) A += (1 - A) * (F - FALL_HEIGHT_LERP_FROM);
  if (v > FALL_SPEED_SATURATION) A = 1;
  else if (v > FALL_SPEED_LERP_FROM) {
    A += (1 - A) * (v - FALL_SPEED_LERP_FROM) / FALL_SPEED_LERP_SPAN;
  }

  return Q * Q * A * (speedMod * v * v) * damageMod * materialDamage;
}

/**
 * The whole thing from a `SoldierBody` landing record plus the damage tables.
 *
 * `landing` is `{ impactSpeed, fallHeight, cosTheta, material }`, which is what
 * `Soldier.step` latches for the frame.
 */
export function fallDamageFor(landing, tables, {
  kitDamping = DEFAULT_KIT_DAMPING,
  speedMod = SOLDIER_SPEED_MOD,
  defenderMaterial = SOLDIER_MATERIAL,
} = {}) {
  if (!landing) return 0;
  const material = landing.material;
  const { damageMod, materialDamage } =
    soldierFallScalars(tables, material, defenderMaterial);
  return fallSeverity({
    impactSpeed: landing.impactSpeed,
    fallHeight: landing.fallHeight,
    cosTheta: landing.cosTheta,
    inWater: material === MATERIAL_WATER,
    kitDamping,
    speedMod,
    damageMod,
    materialDamage,
  });
}
