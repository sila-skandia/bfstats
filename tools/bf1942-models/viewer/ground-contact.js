// Where a driven land vehicle's contacts meet the ground: the drivable-deck
// policy, the Coulomb friction budget and its clamp (PHY-2), the parking hold,
// a hull contact's friction, and the contact normal and plane a tyre works in.
// The spring, the `Wheel` and the probe that finds the surface under it are
// `suspension.js`'s. Shared by `GroundVehicle` (`wheeled-vehicle.js`) and
// `TrackedVehicle` (`tracked-vehicle.js`); holds no state of its own beyond
// private scratch vectors.

import * as THREE from 'three';

// --- drivable decks (bridges, repair/reload bays, ramps) --------------------
//
// A raised deck is a static collision mesh, not part of the level heightfield,
// so a driven vehicle needs two things from it that terrain gives for free: the
// wheels must find its real surface, and the hull must not treat that surface as
// a wall. `WorldCollider.deckHeight` answers the first with a ray against the
// deck's own triangles; these three numbers are the policy around it.

/**
 * How far ABOVE a wheel's axle the deck ray starts, i.e. the step a driven
 * vehicle may mount onto. The axle already sits a wheel radius above whatever
 * it is standing on, so the reachable step is this plus the wheel radius —
 * about a metre for a tank, 0.85 m for a jeep, which takes a bay's apron and a
 * bridge's abutment lip and refuses a loading platform. Raising it further
 * would let a tank levitate onto anything named like a deck. [free, numerics]
 */
export const DECK_STEP_UP = 0.5;   // metres

/**
 * The same allowance measured from the surface the hull is riding, for the hull
 * sweep's wall test: a drivable object's vertical face whose top is within this
 * of the current support is a kerb the suspension steps over, not a wall. A
 * parapet, a bridge pillar or a hut on the bay all rise well past it and still
 * stop the hull dead. [free, numerics]
 */
export const DECK_WALL_STEP = 1.0;   // metres

/**
 * |normal . up| above which a drivable object's triangle is a surface a vehicle
 * rides rather than a wall it hits: 0.5 is 60 degrees, comfortably past any
 * approach ramp or arched span and nowhere near a parapet. The hull sweep drops
 * those triangles entirely, which is what makes a deck behave like terrain —
 * the wheels carry the vehicle over it and the sphere never rams it.
 *
 * This is the whole of the old `CLIMB_STEP` hack's job, done where the geometry
 * is. That hack nudged `position.y` by 0.2 m a tick whenever the sweep reported
 * the deck and the raster claimed the deck was higher, which both launched a
 * hull the raster over-read and let one pass straight through a pad the raster
 * under-read (the "drives through the repair pad" report). [free, numerics]
 */
export const DECK_FLOOR_COS = 0.5;

// --- Coulomb friction, PHY-2 ------------------------------------------------
//
// `ResponsePhysics::addFriction` lnxded `0x0825b6e0` spends a per-tick
// tangential velocity budget, with no force and no mass anywhere in it:
//
//   limKinetic = A * 1.50 * 9.82 * L / 30      m/s of delta-v, one 30 Hz tick
//   limStatic  = 1.50 * limKinetic  =  A * 2.25 * 9.82 * L / 30
//
// read from `0x086be4d0` (1.5), `0x086d16e0` (2.25), `0x086d16e4` (9.82) and
// `0x08716b5c` (30), formed at `0x0825b7c9`. `1.5 * 9.82` is 14.73, which is
// the shipped gravity — so as an acceleration the kinetic budget is exactly
// `A * |g| * L` and the static one is half again.
//
// L, and this was the round's one open disagreement: it is the **y of the
// averaged contact normal**, `ResponsePhysics+0x6c`. Settled here by reading
// `impulseOn` `0x08258900`, whose tail at `0x08258a6a`-`0x08258abb` maintains
// `+0x68` as a running mean of its third Vec3 argument (the contact normal)
// — `mean = (mean*count + n)/(count+1)`, count at `+0xa4` — while `posAdjust`
// lives at `+0x14` and `speedAdjust` at `+0x2c`. There is no impulse
// accumulator at `+0x68`. `addFriction`'s branch at `0x0825b7a2` sends a
// `CID_BFSoldierTemplate` object to `0x0825c63e`, which points the load read
// at `+0x98` instead; everything else, a vehicle part included, falls through
// to `0x0825b7ae` and reads `+0x68`.
//
// A is NOT the surface's own coefficient: `impulseOn`'s tail
// (`0x08258b6a`-`0x08258ba0`) stores `0.5 * (friction(matA) + friction(matB))`
// into `+0xa8`. A wheel on grass runs at `0.5*(1.0 + 0.8) = 0.9`.
const COULOMB_SLIDING = 1.50;
const COULOMB_BREAKAWAY = 2.25;
const COULOMB_GRAVITY = 9.82;

/**
 * The engine's simulation tick, `0x08716b5c`. It appears twice in the
 * friction solver: once dividing the budget into a per-tick velocity step,
 * and once multiplying the wanted velocity change back into an acceleration
 * (`addFrictionAtAbsolutePosition(F * 30)`). So a grip mode that asks for a
 * velocity change of `dV` is asking for `dV * 30` m/s^2, and the Coulomb
 * clamp is what decides how much of that the ground can actually answer.
 *
 * Where a grip mode asks for a whole velocity back **this tick**, the 30 is
 * `1/dt` and not a number — this file substeps at `h <= 1/60`, so the faithful
 * translation of "all of it, this tick" is `1/h`, and that is what the parking
 * holds below spend. Writing 30 there instead asked for half the correction
 * the engine asks for and left a parked M3A1 creeping at 0.054 m/s; with `1/h`
 * it is 0.014 (a residual the file's other comment explains). The constant
 * stays here because the *budget* side of the solver really is a fixed 30.
 */
export const ENGINE_TICK_HZ = 30;

/**
 * `MaterialManager.materialFriction` for a contact surface the level does not
 * name. An id the define file never mentions falls back to material 0, which
 * vanilla authors at 1.0, and that is also the `Material` constructor's own
 * default — so every path lands on the same number.
 */
export const DEFAULT_MATERIAL_FRICTION = 1.0;

/**
 * The wheel's own side of the pair. A Willy's wheels are material 37 and a
 * tank's road wheels 38 / 178; vanilla defines none of them, so all three fall
 * back to material 0 at 1.0 (collision-response.md section 9.4). Mods that
 * define them would change this, which is why it is a named constant and not
 * an inlined 1.
 */
export const WHEEL_MATERIAL_FRICTION = 1.0;

/**
 * The two caps **one contact** is tested against, as accelerations rather
 * than as per-tick velocity steps — the viewer integrates at its own rate.
 *
 * They carry no load, and that is the engine's own arithmetic rather than a
 * simplification: the budget is `A * N.y * 1.5 * 9.82 / 30` metres per second
 * of delta-v per tick, i.e. `A * N.y * |g|` as an acceleration, with no
 * normal force anywhere in it (collision-response.md section 8 — "there is no
 * force and no mass in this solver"). At `N.y = 1` on the flat that is
 * `A * 14.73`.
 *
 * **Where the viewer differs, named — and the engine's side of it is now
 * read, not inferred.** `addFriction` ends by handing the ROOT node (the
 * `getParent()` walk at `0x0825b852`-`0x0825b873`) its clamped `dV * 30`
 * through `PhysicsNode::addFrictionAtAbsolutePosition` `0x08254e50`, and that
 * function is a **running mean over the tick's calls**, not a sum:
 * `0x08254eab`-`0x08254f35` writes `positionalFriction = (positionalFriction
 * * n + v) / (n + 1)` into `+0x40`; `0x08254fc0`-`0x0825503f` does the same
 * for `rotationalFriction` `+0x4c` with `(pos - nodePos) x v`; `0x08255042`
 * increments the count `+0x64`. (`setPositionalFriction` `0x0824d270` and
 * `setRotationalFriction` `0x0824d290` fix the two offsets;
 * `updateRotationalPhysics` clears all three at `0x08253dcd`-`0x08253ddc`.)
 * The sibling `addAccelerationAtAbsolutePosition` `0x08255110` is a plain
 * `fadd` accumulate at `0x08255156`-`0x08255170` — so in the engine **the
 * springs sum and the tyres mean**, and a whole vehicle's Coulomb budget is
 * `A * |g|` however many wheels touch.
 *
 * **`n` counts PARTS, not contact points.** `ResponsePhysicsManager::update`
 * `0x0825d0b0` calls `checkVsTerrain` (`0x0825d160`, vtable `+0x24`) and then
 * `addFriction` exactly once (`0x0825d137`, vtable `+0x20`) per object per
 * tick, so however many vertices of a wheel are touching, that wheel adds one
 * term to the mean. The six floats the call site pushes
 * (`0.45, 0.9, 0.45, 2.0, 0, 0` at `0x0825d11d`-`0x0825d130`) are **dead** —
 * a scan of `addFriction`'s whole body finds no read of `[ebp+0x10]` through
 * `[ebp+0x24]`, so there is no per-call scale hiding in them.
 *
 * **This file now does the same**, and no normal load enters the tangential
 * solve anywhere: `#step` accumulates each contact's clamped in-plane
 * acceleration and its own `r x f` and divides both by the contact count,
 * while the spring loads keep summing.
 *
 * It used to weight each contact's answer by that wheel's share of standing
 * weight (`load / |g|`) and sum those. Two things were wrong with that:
 *
 *   - **the brake.** A jeep is rear-wheel drive and its rear pair carries
 *     34 % of the standing weight, so the weighted sum braked it at 0.34 of
 *     budget where the engine's mean gives the same pair 0.50 — 8.4 s and
 *     128 m from 30.9 m/s, against `main`'s 3.9 s and 56 m.
 *   - **a load spike multiplied the budget.** The damper reports a washboard
 *     landing at a load near 100 against a standing 4.9, so the weight share
 *     reached 7 and a single contact could answer with 100 m/s^2 of in-plane
 *     force. That is the pump that put the jeep at 176 km/h over ground whose
 *     flat top speed is 111.
 *
 * A first attempt at the swap (2026-09-20, by the reviewer) doubled a
 * Sherman's settled yaw rate and rolled the M3A1 over, because with the
 * weighting gone a barely-loaded contact answers at full budget. Two things
 * it did not have made the difference here: the budget's own **`N.y`** (read,
 * see below — a contact on a steep face now answers with less, and a side-on
 * one with nothing), and the tyre frame lying in the **contact plane** rather
 * than the hull's, so a saturated contact can no longer push the hull
 * sideways out of its own plane. See `intoContactPlane`.
 */
export function coulombCaps(friction, normalY = 1) {
  // `N.y` is read, not a refinement: `0x0825b80c fld DWORD PTR [eax+0x4]`
  // with `eax = this+0x68` is the averaged contact normal's **y**, and it
  // multiplies the budget formed at `0x0825b7c9`-`0x0825b804` from
  // `ds:0x86d16e4` (9.82), `ds:0x8716b5c` (30), `ds:0x86d16e0` (2.25) and
  // `ds:0x86be4d0` (1.5). So a steep contact face answers with less, and a
  // side-on one with nothing — collision-response.md section 8's "the budget
  // scales with the contact normal's Y, not with any normal force".
  const ny = normalY > 0 ? normalY : 0;
  return {
    kinetic: friction * COULOMB_SLIDING * COULOMB_GRAVITY * ny,
    breakaway: friction * COULOMB_BREAKAWAY * COULOMB_GRAVITY * ny,
  };
}

/**
 * What a latched static contact really is: a **velocity constraint**, not a
 * force. `collision-response.md` section 8's "latched static: F = dV in full"
 * cancels the whole tangential velocity every tick and keeps cancelling
 * whatever is re-injected, so a parked vehicle in the engine does not creep.
 *
 * The per-wheel parking hold in the loops above cannot do that on its own: it
 * is a velocity-proportional force answering a constant one (PHY-5 leans the
 * spring axis with the hull, so a hull on its static rake pushes itself
 * along), and it settles where the two balance rather than at zero. On flat
 * analytic ground the residual is 5 mm of drift over ten parked seconds; on
 * Wake's real terrain, where the rake is bigger, it was 0.74 m for a jeep and
 * 0.30 m for a Sherman — visible wandering, against a main checkout that does
 * not move at all.
 *
 * So the constraint is applied where it belongs: after the forces are summed,
 * on a hull that is stopped, idle and standing entirely on latched contacts,
 * the **horizontal** acceleration and velocity are zeroed — but only while the
 * demand fits inside the summed break-away budget, which is what keeps this a
 * Coulomb result rather than glue. Past that budget (a slope steeper than
 * `atan(mu)`) it lets go and slides, exactly as the engine's latch does.
 *
 * Vertical motion is untouched: a hull still settles on its springs, and
 * anything that lifts a wheel clears its latch and so this hold with it.
 */
const STATIC_HOLD_SPEED = 0.35;

/**
 * And it waits for the hull to stop turning as well as stop moving. A vehicle
 * settling onto a slope pitches and slides at the same time, and freezing the
 * slide while the pitch is still coming round leaves it sitting a degree or so
 * off the ground it is standing on. [free, numerics]
 */
const STATIC_HOLD_SPIN = 0.05;

/**
 * And it waits for the springs to stop moving. A hull dropped onto a slope
 * settles by pitching and sliding together, and its velocity passes through
 * small values on the way; the thing that separates "still settling" from
 * "parked" is whether the suspension is still travelling. Holding before it
 * has stopped leaves a jeep sitting a degree and a quarter off the slope it is
 * standing on, which is exactly what this threshold was added to stop.
 * [free, numerics]
 */
const STATIC_HOLD_SETTLE = 0.02;

/**
 * And it waits a whole second with all three of the above holding together,
 * because a hull dropped onto a slope crosses every one of them transiently
 * on the way down. Nothing in the engine has a dwell at all — its latch is a
 * per-tick velocity constraint — so this is the viewer's own. [free,
 * numerics]
 */
const STATIC_HOLD_DWELL = 1.0;

export function staticHold(vehicle, s, accel, h, drive, braking, loaded, budget,
    allLatched, springRate) {
  const parked = loaded && allLatched && budget > 0
    && drive === 0 && braking === 0
    && s.velocity.lengthSq() <= STATIC_HOLD_SPEED * STATIC_HOLD_SPEED
    && s.angularVelocity.lengthSq() <= STATIC_HOLD_SPIN * STATIC_HOLD_SPIN;
  if (!parked) {
    vehicle._staticQuiet = 0;
    vehicle._staticHeld = false;
    return false;
  }
  // A hull dropped onto a slope crosses every one of those thresholds
  // transiently on the way down, so the hold waits for them to hold together
  // for a whole second, with the suspension stopped, before it takes effect.
  //
  // **The settle test gates entry only.** Once the hold is on, the spring
  // rate it measures is its own doing: zeroing the horizontal velocity moves
  // the contact patches by a hair, the springs answer, and the rate crosses
  // `STATIC_HOLD_SETTLE` again — which used to reset the dwell, let the hull
  // creep for another second, and re-engage, a limit cycle regulated by the
  // threshold itself. It cost a parked M3A1 0.54 m in ten seconds. Re-testing
  // a precondition against a state the test itself created is circular; the
  // conditions that genuinely mean "no longer parked" are the ones above, and
  // they are checked every sub-step.
  if (!vehicle._staticHeld) {
    if (springRate > STATIC_HOLD_SETTLE) {
      vehicle._staticQuiet = 0;
      return false;
    }
    vehicle._staticQuiet = (vehicle._staticQuiet ?? 0) + h;
    if (vehicle._staticQuiet < STATIC_HOLD_DWELL) return false;
    vehicle._staticHeld = true;
  }
  // What the contacts are being asked to hold, this substep: the horizontal
  // acceleration plus the horizontal velocity already on the hull, expressed
  // as one acceleration so both are measured against the same budget.
  const ax = accel.x + s.velocity.x / h;
  const az = accel.z + s.velocity.z / h;
  if (Math.hypot(ax, az) > budget) {
    // Past the break-away budget — a slope steeper than `atan(mu)` — the
    // latch lets go and the hull slides, exactly as the engine's does.
    vehicle._staticHeld = false;
    vehicle._staticQuiet = 0;
    return false;
  }
  accel.x = 0;
  accel.z = 0;
  s.velocity.x = 0;
  s.velocity.z = 0;
  return true;
}

// --- a hull contact's own friction (collision-response.md section 8) --------

const _hcRel = new THREE.Vector3();
const _hcU = new THREE.Vector3();
const _hcN = new THREE.Vector3();
const _hcVt = new THREE.Vector3();
const _hcF = new THREE.Vector3();

/**
 * Fold this tick's hull contacts into the tyres' friction accumulators.
 *
 * The contacts come from the rigid-body solver (`body-statics.js` finds them,
 * `vehicle-bodies.js` `DrivenBody.noteContact` hands them over) and they go in
 * as **samples in the same running mean the wheels feed**, never as extra
 * grip. That is the engine's arithmetic, not a simplification, and it is the
 * one thing about hull friction that is easy to get backwards:
 *
 * - the Coulomb budget is `mu * N.y * |g|` (`coulombCaps`), so a **side-on ram
 *   has no friction at all** — a wall's normal is horizontal and `N.y` is 0;
 * - `addFrictionAtAbsolutePosition` is a running MEAN over the tick's parts,
 *   so that zero sample *dilutes* the wheels' answer for the tick. A jeep
 *   scraping a wall with four wheels down keeps four fifths of its grip, and
 *   that is what the engine gives it.
 *
 * Every non-wheel part is **ContactGrip** (section 8): it asks for its whole
 * tangential contact velocity back, and the clamp decides what it gets. So a
 * hull lying on something horizontal — a crate, a deck, a wreck — does get
 * real friction out of this, which is the other half of the same rule.
 *
 * What it deliberately does NOT feed is `staticHold`'s budget or its
 * `allLatched` test. That hold is the viewer's own construct (see
 * `STATIC_HOLD_SPEED`), fitted against wheel contacts; the engine has no
 * vehicle-wide latch to put a hull contact into, and a hull touching a wall
 * must not stop a parked vehicle being held.
 *
 * @returns {number} samples added to the mean
 */
export function hullContactFriction(vehicle, s, qInv, vBody, w, gravityTick,
                             tanForce, tanTorque, force) {
  const contacts = vehicle.hullContacts;
  if (!contacts || !contacts.length) return 0;
  let added = 0;
  for (const c of contacts) {
    // The contact point and its normal, in the body frame the tyre solve uses.
    _hcRel.set(c.x - s.position.x, c.y - s.position.y, c.z - s.position.z)
      .applyQuaternion(qInv);
    _hcN.set(c.normal[0], c.normal[1], c.normal[2]).applyQuaternion(qInv);
    const nn = _hcN.lengthSq();
    if (!(nn > 1e-9)) continue;
    // Contact-patch velocity with next tick's gravity already in it, exactly
    // as the wheels take it.
    _hcU.copy(vBody).add(_hcVt.crossVectors(w, _hcRel)).add(gravityTick);
    _hcVt.copy(_hcN).multiplyScalar(_hcU.dot(_hcN) / nn);
    _hcVt.subVectors(_hcU, _hcVt);
    // `resistance` is a plain velocity-proportional acceleration at the root
    // and it SUMS, unlike everything else here (section 8). Hull on hull it is
    // 0.01: a scrape that costs a little speed, not a brake.
    if (c.resistance > 0) force.addScaledVector(_hcVt, -c.resistance);
    // ContactGrip: the whole tangential velocity back, this tick.
    _hcF.copy(_hcVt).multiplyScalar(-ENGINE_TICK_HZ);
    const caps = coulombCaps(c.friction, c.normalY);
    const demand = _hcF.length();
    // No latch: a `Response`'s static latch lives on the part, and a hull
    // contact that lasts is a scrape rather than something being stood on.
    const grip = coulombClamp(demand, caps, false);
    if (grip.scale !== 1) _hcF.multiplyScalar(grip.scale);
    tanForce.add(_hcF);
    tanTorque.add(_hcRel.cross(_hcF));
    added += 1;
  }
  return added;
}

/**
 * Clamp a tangential demand into the Coulomb budget, with the engine's
 * **state-dependent hysteresis** — not two passes, the two arms of one branch
 * (`0x0825bb72 mov dl,[esi+0xb4]; test dl,dl; jns 0x0825bebc`):
 *
 *   latched static  |demand| > breakaway -> latch breaks, scale to kinetic
 *                   otherwise            -> apply in full, up to 1.5x kinetic
 *   not latched     |demand| > kinetic   -> scale to kinetic, stay sliding
 *                   otherwise            -> the latch sets
 *
 * The clamp is **isotropic on the tangential plane** — a vector scale and
 * nothing more. There is no slip-angle curve anywhere in the engine, and no
 * separate lateral coefficient; where this file keeps either, it says so.
 *
 * @returns {{scale: number, latched: boolean}} the factor to apply to both
 *   components of the demand, and the latch state for the next tick
 */
export function coulombClamp(demand, caps, latched) {
  if (latched) {
    if (demand > caps.breakaway && demand > 1e-9) {
      return { scale: caps.kinetic / demand, latched: false };
    }
    return { scale: 1, latched: true };
  }
  if (demand > caps.kinetic && demand > 1e-9) {
    return { scale: caps.kinetic / demand, latched: false };
  }
  return { scale: 1, latched: true };
}

/** Half-width of the central difference the contact normal is taken over. The
 * terrain under a viewer level is a 4 m lattice, so anything much smaller
 * reads interpolation noise and anything much larger smooths away the dune a
 * wheel is actually sitting on. [free, numerics] */
const NORMAL_PROBE = 0.5;

/**
 * The contact normal under a world (x, z), from the height field's own
 * gradient.
 *
 * The engine does not need this — it keeps a running mean of the unit normals
 * of the frame's actual contacts at `ResponsePhysics+0x68`, which is what
 * `addFriction` reads at `0x0825b80c` for the budget and at `0x0825bfce` for
 * the tangent plane. A probe down a spring axis has no contact to take a
 * normal from, so the surface it probed against supplies one. Named as the
 * approximation it is; everything spent on it below is read.
 */
function groundNormal(groundHeight, x, z, fromY, out) {
  const e = NORMAL_PROBE;
  const hx0 = groundHeight(x - e, z, fromY);
  const hx1 = groundHeight(x + e, z, fromY);
  const hz0 = groundHeight(x, z - e, fromY);
  const hz1 = groundHeight(x, z + e, fromY);
  if (![hx0, hx1, hz0, hz1].every(Number.isFinite)) return out.set(0, 1, 0);
  return out.set(-(hx1 - hx0) / (2 * e), 1, -(hz1 - hz0) / (2 * e)).normalize();
}

/** Scratch for one deck normal, so asking for one allocates nothing. */
const _deckN = [0, 1, 0];

/**
 * The contact normal under a wheel: the drivable deck's own triangle where the
 * wheel is on a deck, and the heightfield's gradient everywhere else.
 *
 * A finite difference is the right answer for terrain — it IS a height function,
 * sampled off a 4 m lattice — and the wrong one for a deck, whose surface is a
 * few large triangles with hard edges: half a metre either side of a wheel near
 * the lip straddles a drop of metres, and the normal that comes out of that is
 * nearly horizontal, which through `nAxis` turns the spring off on the tick the
 * tank is trying to mount the thing. The deck answers with the triangle it
 * actually found, which is exact on the flat, exact up the incline, and steady.
 */
export function surfaceNormalAt(vehicle, x, z, fromY, out) {
  if (vehicle.deckNormal && vehicle.deckNormal(x, z, fromY, _deckN)) {
    return out.set(_deckN[0], _deckN[1], _deckN[2]);
  }
  return groundNormal(vehicle.groundHeight, x, z, fromY, out);
}

/**
 * Lay an axis into the contact plane, the way `addFriction` lays a wheel's
 * axle into it — **byte for byte, and this is the fix for the launch**:
 *
 * ```
 * 0825bf99  RollGrip branch: [ebp-0x48..] = node transform row 0, the AXLE
 * 0825bfce  |N|^2 from [esi+0x68..];  == 0 -> the demand is zeroed
 * 0825c14b  s = (axle . N) / |N|^2   (0825c153-0825c171), then s*N
 * 0825bfff  the projection: axle - s*N  (0825c00b-0825c021)
 * 0825c063  |proj|^2 == 0 -> the degenerate arm, demand zeroed
 * ```
 *
 * so RollGrip's direction is `axle - N*(axle.N)/(N.N)` and never the raw
 * axle.
 *
 * **EngineGrip is the same, and it is read here too rather than taken from
 * section 8.** It projects the finished target instead of the axis it was
 * built from, at the other end of the branch:
 *
 * ```
 * 0825c3d7-0825c40d  the blend is summed into T [ebp-0x48..] and copied to
 *                    [ebp-0x78..], which is what ebx points at
 * 0825c410  eax = [ebp-0x1e4] = this+0x68, the averaged contact normal
 * 0825c416-0825c430  |N|^2
 * 0825c432  fldz;  0825c436 fucom st(1);  0825c440 jne 0825c493
 *                    -- a LITERAL zero, so |N|^2 == 0 falls through and the
 *                       target is left alone (0825c442-0825c48e)
 * 0825c493-0825c4ab  s = (T . N) / |N|^2      (fdivrp st(1),st)
 * 0825c4ad-0825c4de  [ebx] = s*N
 * 0825c453-0825c48b  T := T - s*N, stored back to [ebp-0x48..]
 * ```
 *
 * and only then does `0825c2a3` take `dV = T - Vt`. So both grips end up
 * tangential, by two different routes. `Vt` is tangential too, and that one
 * is read as well: `0825b91a`-`0825b982` forms `|N|^2` from the same vector
 * and `0825c579`-`0825c591` divides the dot by it, `0825b985`-`0825b9a0`
 * subtracting the result — `Vt = V - N*(V.N)/(N.N)`, section 8's own
 * expression, byte for byte.
 *
 * Why it matters to this file and not only to fidelity: the tyre frame used
 * to be the HULL's own XZ plane. A Coulomb-saturated longitudinal demand on
 * a hull pitched 60 degrees is then two thirds world-vertical, and full
 * throttle becomes a rocket. In the contact plane it cannot be: every
 * tangential demand is perpendicular to the surface normal by construction.
 *
 * @returns {boolean} false when the axis is parallel to the normal and the
 *   projection is degenerate — the engine zeroes that contact's demand
 */
export function intoContactPlane(axis, normal) {
  const d = axis.dot(normal);
  axis.addScaledVector(normal, -d);
  const len = axis.length();
  if (!(len > 1e-4)) return false;
  axis.multiplyScalar(1 / len);
  return true;
}
