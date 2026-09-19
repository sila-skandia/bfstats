// What a thrown grenade does when it lands: the engine's rigid-body contact,
// read out of `ResponsePhysics` and driven by the two materials that touch.
//
// This is the missing half of the fuse weapons. `gunfire.js` used to stop a
// grenade dead on the surface it first met, because the last stream declined to
// invent a restitution coefficient. It does not have to be invented: the
// coefficient is authored, and the arithmetic that spends it is four
// instructions.
//
// THE PATH. `Projectile::handleCollision` (lnxded `0x0831ee80`) was read in
// full and it changes no velocity at all. Its whole body is the sticky
// attachment (`+0x1ab`, `0x0831ef16`), `BFSoldier::projectileHit`, the recycle
// (`dieAfterColl` `+0x1a7` / `hasCollisionEffect` `+0x1a4`, `0x0831ef4b` /
// `0x0831ef54`) and a **bool**. That bool is the whole of its say in the
// response: `checkObjectVsObject` skips the impulse for a handler that returns
// 0 (collision-response.md section 6.2), and the two `return 0` paths are a
// water contact without `detonateOnWaterCollision` (`+0x1ac`, `0x0831f3ae`)
// and nothing else. So the bounce is the GENERIC contact response, and a fuse
// round reaches it because all four vanilla fuse rounds declare
// `setHasPointPhysics 0`:
//
//     GrenadeAlliesProjectile   setHasCollisionPhysics 1  setHasResponsePhysics 1  setHasPointPhysics 0
//     GrenadeAxisProjectile     same           ExpPackProjectile  same
//     LandmineProjectile        same
//
// which matters because `ProjectileTemplate`'s constructor sets
// `hasPointPhysics` and a point body's `PointResponsePhysics::impulseOn` and
// `::addFriction` are **empty** (collision-response.md section 10). A shell is a
// point body and gets no response; the four fuse rounds opt out and get the
// real one.
//
// THE ARITHMETIC, per 30 Hz engine tick.
//
//   `ResponsePhysics::impulseOn` (`0x08258900`)
//     speedAdjust += -(v . n / n . n) * n            0x08258c47-0x08258c63
//     posAdjust   += -depth * n                      0x08258981-0x08258990
//     friction   (+0xa8) = 0.5 * (f(mat1) + f(mat2)) 0x08258b76-0x08258ba0
//     elasticity (+0xac) = 0.5 * (e(mat1) + e(mat2)) 0x08258bac-0x08258bd6
//     resistance (+0xb0) = 0.5 * (r(mat1) + r(mat2)) 0x08258be2-0x08258c06
//   the 0.5 is `ds:0x86b05e8`, read as bytes `0000003f`.
//
//   `ResponsePhysics::solveImpulse` (`0x08258d30`)
//     a = speedAdjust * 30 * (1 + elasticity) * 0.5
//   `fld1; fadd [edx+0xac]` at `0x08258ed4`/`0x08258ed6`, the 30.0 at
//   `ds:0x8716b5c` (`0000f041`) and the same 0.5 at `0x08258ee2`. The
//   integrator applies an accumulated acceleration for one tick and then
//   zeroes it, so the velocity change is `speedAdjust * (1 + e) / 2` ONCE, and
//   the normal component that survives is
//
//       v_n' = v_n * (1 - e) / 2
//
//   `ResponsePhysics::addFriction` (`0x0825b6e0`, collision-response.md
//   section 8) then spends the other two.
//
// WHAT THE DATA PUTS IN IT. `materialManagerdefine.con`, surveyed across all 18
// installed mods: **elasticity is 0 for every material in vanilla except id 70
// "Grenades", which is 2.0** (with friction 2.0 and resistance 2.0). GCMOD adds
// 543, interstate adds 11 (0.1) and 45 (-1.0), bfheroes adds 2011 (15.0) and
// 2012 (1.5); every other install that declares the word declares 70 alone.
//
// And the material a contact brings is the **collision vertex's**, the u16 in
// the low half of each `.sm` collision vertex's fourth float, not
// `ObjectTemplate.material`:
//
//     gran_al_Base_m1.sm   col0  6 verts   material 70    <- the only 70
//     granade_axis_m1.sm   col0  6 verts   material 70
//     demokit_m1.sm        col0  6 verts   material 195   (undefined -> material 0)
//     landmine_m1.sm       col0 12 verts   material 232   (undefined -> material 0)
//
// So the arithmetic comes out at:
//
//   * a **grenade** on any vanilla surface: e = (2.0 + 0)/2 = 1.0, so
//     `v_n * (1 - 1)/2` = **zero**. A grenade does not rebound. It cancels its
//     into-surface velocity exactly and keeps all of its along-surface
//     velocity, then sheds that against a friction of (2.0 + terrain)/2 and a
//     resistance of (2.0 + terrain)/2 -- both the largest in the game. That is
//     what elasticity 2.0 is FOR, and "the grenade bounces off the wall" is
//     refuted by the number that was supposed to prove it.
//   * an **explosives pack** or a **landmine**: e = 0, so `v_n/2` -- half the
//     closing speed removed per tick while the positional push-out separates
//     it. It settles where it is put, which is the whole point of both.
//
// The visible change from the old "stop dead" is therefore not a rebound: it is
// that a grenade thrown along the ground now SKIDS, and one thrown at a wall
// slides DOWN it (a vertical face has `N.y = 0`, and section 8's Coulomb budget
// is proportional to `N.y`, so a wall applies no friction at all -- only the
// viscous resistance term).
//
// Free of `three` and of the DOM, like `collision.js` and `physics.js`, so
// `tests/contact_response_harness.mjs` runs the real thing under node.

/** The engine's simulation rate. Every budget below is per tick, not per second. */
export const SIM_HZ = 30;
export const SIM_DT = 1 / SIM_HZ;

/**
 * The gravity `addFriction` hard-codes: `1.5 * 9.82`, not `getGravity()`.
 *
 * It appears twice in one solver — once as the tick of gravity added to the
 * contact velocity before the tangent is taken, and once as the magnitude the
 * Coulomb budget is built from. collision-response.md section 8; the same 14.73
 * `physics.js` already uses for the soldier.
 */
export const CONTACT_GRAVITY = 14.73;

/** `limStatic = 1.5 * limKinetic` — the extra a latched contact must break. */
export const STATIC_FRICTION_FACTOR = 1.5;

/** `Material` constructor defaults (collision-response.md section 8). */
export const DEFAULT_FRICTION = 1.0;
export const DEFAULT_ELASTICITY = 0.0;
export const DEFAULT_RESISTANCE = 0.01;

/** What an accessor returns when material 0 is missing too: `fld1`. */
export const NO_MATERIAL_TABLE = 1.0;

/**
 * Material 70, "Grenades" — the only vanilla material with an elasticity.
 *
 * Named because the whole of a grenade's landing behaviour hangs off it and a
 * reader who finds `2.0` in the data will otherwise read it as a restitution
 * coefficient of 2, i.e. a round that leaves faster than it arrived.
 */
export const GRENADE_MATERIAL = 70;

/**
 * The collision-vertex material of each vanilla fuse round, by projectile
 * template name.
 *
 * **This is not `ObjectTemplate.material`, and the difference is load-bearing
 * for one of the four.** A contact brings the material of the collision VERTEX
 * that touched (collision-response.md section 9.4), which lives in the low 16
 * bits of each `.sm` collision vertex's fourth float, and read out of the
 * vanilla meshes it is:
 *
 *     gran_al_Base_m1.sm   6 col0 vertices   70    ObjectTemplate.material 70
 *     granade_axis_m1.sm   6 col0 vertices   70    ObjectTemplate.material 70
 *     demokit_m1.sm        6 col0 vertices   195   ObjectTemplate.material 70
 *     landmine_m1.sm      12 col0 vertices   232   ObjectTemplate.material 230
 *
 * So the explosives pack's damage material is the grenade material and its
 * CONTACT material is not — read `ObjectTemplate.material` for it and the pack
 * would stop dead like a grenade instead of settling like a mine. 195 and 232
 * are both undefined in `materialManagerdefine.con` and fall back to material
 * 0, so both land on the same coefficients; the table exists to get there for
 * the right reason.
 *
 * **The proper fix is an extractor word** — the collision material belongs on
 * the projectile spec the same way `material2` and `radius` do — and until
 * there is one this is four rows of verified data rather than a guess. A
 * template not listed falls back to whatever material the caller passes,
 * which for a mod is its own declared one.
 */
export const CONTACT_MATERIALS = Object.freeze({
  grenadealliesprojectile: 70,
  grenadeaxisprojectile: 70,
  exppackprojectile: 195,
  landmineprojectile: 232,
});

/** `CONTACT_MATERIALS` by template name, or `fallback`. */
export function contactMaterialFor(template, fallback) {
  if (typeof template === 'string') {
    const known = CONTACT_MATERIALS[template.toLowerCase()];
    if (Number.isFinite(known)) return known;
  }
  return fallback;
}

/**
 * One material's value for one of the three physical words, with the engine's
 * own fallback chain.
 *
 * `getFrictionForMaterial` / `getElasticityForMaterial` /
 * `getResistanceForMaterial` (lnxded `0x081751b0` / `0x081751f0` /
 * `0x08175230`) are the same five instructions three times: ask
 * `getMaterialPtr(id)` (vtable `+0x14`); on a hit read `+0x0c` / `+0x10` /
 * `+0x14`; on a miss ask for material **0** and read the same field; if that
 * misses too, push **1.0**. So an id the define file never mentions is not the
 * constructor default — it is material 0's authored value, which for friction
 * is 1.0 and for resistance is 0.02, not 0.01.
 *
 * ONE CASE THE ENGINE CANNOT HAVE, AND THIS TABLE CAN. In the engine a
 * `Material` always carries all three words — the constructor writes 1.0 / 0 /
 * 0.01 and the `.con` overrides what it names — so "the material exists but
 * this word does not" is not a state `getMaterialPtr` can return. It IS a
 * state `damage.json` can be in: `elasticity` and `resistance` only joined
 * `bf42/damage.py` in this round, so any asset tree extracted before it (a mod
 * subtree under `maps/mods/<id>/` that has not been re-extracted, say) carries
 * `friction` alone. Running the engine's own miss chain on that gives **1.0**
 * for every elasticity and every resistance in the game, which silently turns
 * a landmine into a grenade and over-damps everything by a factor of twenty.
 * So a table whose material 0 is present but lacks the word is read as the
 * pre-round table it is, and answers the engine's CONSTRUCTOR default. A table
 * with no material 0 at all still answers `fld1`, which is the real chain.
 */
export function materialProperty(materials, id, key) {
  if (!materials) return NO_MATERIAL_TABLE;
  const own = materials[id] ?? materials[String(id)];
  const value = own?.[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const zero = materials[0] ?? materials['0'];
  const fallback = zero?.[key];
  if (typeof fallback === 'number' && Number.isFinite(fallback)) return fallback;
  if (zero && key in CONSTRUCTOR_DEFAULTS) return CONSTRUCTOR_DEFAULTS[key];
  return NO_MATERIAL_TABLE;
}

/** `Material`'s own constructor values, for the pre-round-table case above. */
const CONSTRUCTOR_DEFAULTS = Object.freeze({
  friction: DEFAULT_FRICTION,
  elasticity: DEFAULT_ELASTICITY,
  resistance: DEFAULT_RESISTANCE,
});

/**
 * The three contact coefficients for a material pair, each the plain mean.
 *
 * `impulseOn` writes `0.5 * (value(mat1) + value(mat2))` into `+0xa8`, `+0xac`
 * and `+0xb0`, and **the last contact of the tick wins** — they are stored, not
 * accumulated. One contact per tick is what a fuse round has, so the mean is
 * the whole story here.
 */
export function contactPair(materials, materialA, materialB) {
  return {
    friction: 0.5 * (materialProperty(materials, materialA, 'friction')
                     + materialProperty(materials, materialB, 'friction')),
    elasticity: 0.5 * (materialProperty(materials, materialA, 'elasticity')
                       + materialProperty(materials, materialB, 'elasticity')),
    resistance: 0.5 * (materialProperty(materials, materialA, 'resistance')
                       + materialProperty(materials, materialB, 'resistance')),
  };
}

/**
 * The fraction of the normal velocity a contact leaves behind: `(1 - e) / 2`.
 *
 * Negative for `e > 1` — that is the rebound case, and nothing in vanilla
 * reaches it. Clamped at nothing: a mod's elasticity 15 really would throw a
 * body back seven times faster, and that is the engine's own arithmetic rather
 * than a bug to defend against here.
 */
export function normalRestitution(elasticity) {
  return (1 - elasticity) / 2;
}

/**
 * One contact tick, in place, on a `{ x, y, z }` velocity and position.
 *
 * `n` need not be unit: the engine divides by `n . n` throughout (the averaged
 * normal `addFriction` reads is a mean of unit normals and is deliberately not
 * re-normalised), so this does too.
 *
 * `depth` is the penetration, **negative or zero at a contact**, and the
 * push-out is `-depth * n` — for a viewer that has already placed the body on
 * the surface, pass 0.
 *
 * `latched` is the static-friction bit (`0x80` on the response's `+0xb4`): once
 * a contact has slowed below the kinetic budget the engine latches it and the
 * next tick has to break `1.5x` that budget to slide. Pass the previous tick's
 * value back in; the return carries the new one.
 *
 * Returns `{ latched, tangentSpeed }` — `tangentSpeed` is the along-surface
 * speed the friction solver saw, which is what a caller uses to decide the body
 * has come to rest.
 */
export function applyContact(velocity, position, contact, pair,
                             { latched = false, gravity = CONTACT_GRAVITY } = {}) {
  const nx = contact.nx, ny = contact.ny, nz = contact.nz;
  const nn = nx * nx + ny * ny + nz * nz;
  if (!(nn > 0)) return { latched, tangentSpeed: 0 };

  // --- impulseOn + solveImpulse -------------------------------------------
  // speedAdjust = -(v . n / n . n) * n, then v += speedAdjust * (1 + e) / 2.
  const k = -(velocity.x * nx + velocity.y * ny + velocity.z * nz) / nn;
  const share = (1 + pair.elasticity) * 0.5;
  velocity.x += k * nx * share;
  velocity.y += k * ny * share;
  velocity.z += k * nz * share;

  // posAdjust = -depth * n. Immediate, not integrated: `solveImpulse` writes
  // it straight onto the node's position before the acceleration is queued.
  const depth = Number.isFinite(contact.depth) ? contact.depth : 0;
  if (position && depth) {
    position.x += -depth * nx;
    position.y += -depth * ny;
    position.z += -depth * nz;
  }

  // --- addFriction ---------------------------------------------------------
  // `V = avgContactSpeed - surfaceSpeed; V.y += g/30` — next tick's gravity,
  // folded in first so a body held on a slope does not creep downhill one
  // tick's worth per tick. Then the tangent is taken against the same normal.
  const gy = -gravity * SIM_DT;
  const vx = velocity.x, vy = velocity.y + gy, vz = velocity.z;
  const along = (vx * nx + vy * ny + vz * nz) / nn;
  const tx = vx - nx * along;
  const ty = vy - ny * along;
  const tz = vz - nz * along;

  // `resistance > 0: root.addAccelerationAtRelativePosition(0, -resistance * Vt)`
  // — an acceleration, so one tick of it is `-resistance * Vt / 30`. It is
  // NOT clamped by the Coulomb budget and it applies on a vertical face too,
  // which is the only thing slowing a grenade sliding down a wall.
  if (pair.resistance > 0) {
    velocity.x += -pair.resistance * tx * SIM_DT;
    velocity.y += -pair.resistance * ty * SIM_DT;
    velocity.z += -pair.resistance * tz * SIM_DT;
  }

  // ContactGrip — every non-wheel part — wants `dV = -Vt` and is allowed
  // `mu * N.y * 14.73/30` of it, `1.5x` that while the static latch holds.
  // **The budget scales with the contact normal's Y, not with a normal
  // force**: a vertical face contributes no Coulomb friction at all.
  const limKinetic = pair.friction * ny * gravity * SIM_DT;
  const tangentSpeed = Math.hypot(tx, ty, tz);
  let nextLatched = latched;
  if (limKinetic > 0) {
    const limit = latched ? limKinetic * STATIC_FRICTION_FACTOR : limKinetic;
    if (tangentSpeed > limit) {
      // Over budget: spend all of it, in the direction that opposes sliding,
      // and the latch is broken (or never sets).
      const scale = limKinetic / tangentSpeed;
      velocity.x += -tx * scale;
      velocity.y += -ty * scale;
      velocity.z += -tz * scale;
      nextLatched = false;
    } else {
      // Inside the budget: the whole wanted change lands and the latch sets.
      velocity.x += -tx;
      velocity.y += -ty;
      velocity.z += -tz;
      nextLatched = true;
    }
  } else {
    nextLatched = false;
  }
  return { latched: nextLatched, tangentSpeed };
}

/**
 * Below this speed a round that is in contact is called at rest and stops
 * asking the collider anything.
 *
 * **A viewer number, not an engine one.** The engine sleeps a body on
 * `|acceleration|^2` thresholds inside its own integrator
 * (collision-response.md section 4.3) and that machinery is not reproduced
 * here; what this buys is that a grenade lying on the ground for the last two
 * seconds of its fuse costs no casts. It is deliberately well below a speed a
 * player could see: 5 cm/s moves a grenade 15 cm over a whole three-second
 * fuse.
 */
export const REST_SPEED = 0.05;

/**
 * How far a latched round may move in one 30 Hz tick and still be called at
 * rest: 2 mm, i.e. 6 cm/s.
 *
 * **A viewer number**, and the one the rest test actually uses — see `tick`
 * for why a speed threshold does not work here.
 */
export const REST_MOVE = 0.002;

/**
 * How far above a contact the per-tick re-seat probe starts, in metres.
 *
 * **A viewer number.** The engine has a real penetration depth because it
 * drops collision vertices through the surface and measures how far they went;
 * a viewer whose collider is a ray that stops at the crossing never has one, so
 * the depth is recovered by casting from a fixed height back down. 5 cm is
 * comfortably more than a tick of gravity (1.6 cm) and comfortably less than
 * anything a round could be said to have left.
 */
export const CONTACT_SKIN = 0.05;

/**
 * A fuse round between contacts: gravity, travel, and the contact when it meets
 * one.
 *
 * The caller owns the mesh and the collider; this owns the physics. `probe` is
 * `(ox, oy, oz, dx, dy, dz, maxDist) -> hit | null` with the shape
 * `collision.js`'s `WorldCollider.cast` returns (`t`, `x`/`y`/`z`,
 * `nx`/`ny`/`nz`, `material`, `kind`), so `gunfire.js` passes a one-line
 * closure over the collider it already has and this module still imports
 * nothing.
 *
 * Steps at a fixed `SIM_DT` with a carried remainder, because every number in
 * `applyContact` is a per-tick budget rather than an acceleration — running it
 * at a 144 Hz frame's dt would shed friction five times too fast.
 */
export class FuseRoundBody {
  /**
   * @param {object}  options
   * @param {number}  options.material   the round's own contact material
   * @param {object}  options.materials  `damage.json`'s materials table
   * @param {number} [options.gravity]   signed, m/s^2; the viewer's -14.73
   */
  constructor({ material, materials, gravity = -CONTACT_GRAVITY } = {}) {
    this.material = Number.isFinite(material) ? material : 0;
    this.materials = materials || null;
    this.gravity = gravity;
    /** The contact the last tick found, or null while airborne. */
    this.contact = null;
    /** The static-friction latch, carried between ticks. */
    this.latched = false;
    /** True once the round has settled and stopped sweeping. */
    this.resting = false;
    /** Leftover frame time, so the 30 Hz step is not resampled per frame. */
    this.carry = 0;
    /** Contacts resolved, for a readout and for the tests. */
    this.contacts = 0;
  }

  /** The pair coefficients against a struck material. */
  pairWith(otherMaterial) {
    return contactPair(this.materials, this.material, otherMaterial);
  }

  /**
   * Advance by `dt` seconds. `position` and `velocity` are mutated in place.
   *
   * Returns the number of 30 Hz ticks actually run, so a caller can tell a
   * frame that did nothing from one that did.
   */
  step(dt, position, velocity, probe) {
    if (!(dt > 0)) return 0;
    this.carry += dt;
    let ticks = 0;
    // A long frame is caught up, but only so far: a tab that was hidden for a
    // minute must not run 1,800 contact ticks on resume.
    const budget = Math.min(this.carry, SIM_DT * 8);
    this.carry -= budget;
    let left = budget;
    while (left >= SIM_DT - 1e-9) {
      left -= SIM_DT;
      ticks++;
      this.tick(position, velocity, probe);
    }
    this.carry += left;
    return ticks;
  }

  /** One 30 Hz tick: gravity, travel, contact. */
  tick(position, velocity, probe) {
    if (this.resting) return;
    const wasX = position.x, wasY = position.y, wasZ = position.z;
    velocity.y += this.gravity * SIM_DT;
    const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
    const travel = speed * SIM_DT;
    let hit = null;
    if (travel > 1e-6 && probe) {
      hit = probe(position.x, position.y, position.z,
                  velocity.x / speed, velocity.y / speed, velocity.z / speed,
                  travel);
    }
    if (hit) {
      // Put the body on the surface first — the engine's `posAdjust` is the
      // penetration push-out and a viewer that stops the sweep at the crossing
      // has no penetration to undo.
      position.x = hit.x;
      position.y = hit.y;
      position.z = hit.z;
      this.contact = { nx: hit.nx, ny: hit.ny, nz: hit.nz, material: hit.material };
      this.contacts++;
    } else {
      position.x += velocity.x * SIM_DT;
      position.y += velocity.y * SIM_DT;
      position.z += velocity.z * SIM_DT;
      // Re-seat against the surface the last tick found, the way
      // `checkVsTerrain` (`0x0825a960`) re-drops every col0 vertex onto the
      // heightfield EVERY tick rather than only on a crossing. Without this a
      // resting round sinks by one tick of gravity per tick: the crossing
      // sweep cannot fire from a point already on the plane, so nothing would
      // ever push it back out, and a grenade would spend its fuse burrowing.
      this.contact = this.#reseat(position, probe, travel);
    }
    if (!this.contact) {
      this.latched = false;
      return;
    }
    const pair = this.pairWith(this.contact.material);
    const result = applyContact(velocity, position, this.contact, pair,
                                { latched: this.latched,
                                  gravity: Math.abs(this.gravity) });
    this.latched = result.latched;
    // Rest is judged on **distance moved**, not on speed, and the reason is
    // the engine's own `V.y += g/30`: the friction solver cancels NEXT tick's
    // gravity in advance, so a body held on a slope carries a standing
    // velocity of about `mu * g / 30` that never decays even though it is not
    // going anywhere. A speed test on a 45-degree slope reads 0.36 m/s while
    // the round sits within a tenth of a millimetre of the same spot.
    const moved = Math.hypot(position.x - wasX, position.y - wasY,
                             position.z - wasZ);
    if (this.latched && moved < REST_MOVE) {
      velocity.x = 0; velocity.y = 0; velocity.z = 0;
      this.resting = true;
    }
  }

  /**
   * Lift the body back onto the surface it is resting on, or drop the contact.
   *
   * Casts from above along the contact normal back down through it. A hit is
   * the surface: the body is placed exactly on it, which is the
   * `posAdjust = -depth * n` push-out with the depth measured rather than
   * carried. A miss means it has left — rolled off the edge, or been thrown
   * clear — and the next tick is airborne.
   *
   * The lift covers this tick's own travel as well as the skin, because a body
   * whose contact only removed HALF its closing speed (elasticity 0, which is
   * every material but the grenade) is still descending and can be a whole
   * tick's fall below the surface by the time this runs. A fixed 5 cm lift
   * loses the landmine and the explosives pack through the floor.
   */
  #reseat(position, probe, travel) {
    const c = this.contact;
    if (!c || !probe) return null;
    const lift = CONTACT_SKIN + Math.max(0, travel || 0);
    const hit = probe(position.x + c.nx * lift,
                      position.y + c.ny * lift,
                      position.z + c.nz * lift,
                      -c.nx, -c.ny, -c.nz, lift * 2);
    if (!hit) return null;
    position.x = hit.x;
    position.y = hit.y;
    position.z = hit.z;
    return { nx: hit.nx, ny: hit.ny, nz: hit.nz, material: hit.material };
  }
}
