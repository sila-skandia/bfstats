// The world's damage pass: a body-world crash billed to its hull, and each
// tick's water (HP-5) and tier pass over every registered owner. Plain
// functions of the `World` (world.js).

import { touchesWater } from './body-world.js';

/** A body-world crash cost `owner` hit points: the callback hooks first so
 *  the page's console record reads the pre-damage hit points (the reading
 *  the old crashLog always made), then the damage itself lands on the same
 *  Armor a round would have hurt, and the change is reported for the tier
 *  pass a few lines below to pick up this very tick. */
export function onBodyDamage(world, owner, result, at, other) {
  const vehicle = world.vehicleDamage.get(owner);
  if (world.onCrash) world.onCrash(owner, result, at, other);
  if (vehicle && !vehicle.destroyed) {
    vehicle.damage(result.kill ? vehicle.hitPoints : result.damage);
  }
  world.report.crashes.push({
    owner, other, damage: result.damage, kill: result.kill,
    cell: result.effectCell, at: [at[0], at[1], at[2]],
    hp: vehicle?.hitPoints ?? null,
  });
}

/**
 * The water pass (HP-5) and the tier pass, in the page's own order. The
 * positions come from the world's own bodies (fresh from this tick's body
 * step) plus the registration poses of static furniture; wrecks the page
 * has faded out are skipped through the `isWrecked` predicate.
 */
export function damageTick(world, dt) {
  const changes = world.vehicleDamage.update(dt, {
    inWaterOwners: inWaterOwners(world),
  });
  for (const change of changes) world.report.damage.push(change);
}

export function inWaterOwners(world) {
  const collider = world.collider;
  const waterLevel = collider?.waterLevel;
  if (!Number.isFinite(waterLevel)) return null;
  for (const [owner, entry] of world.bodyWorld?.entries ?? []) {
    if (entry.driven) {
      const s = entry.driven.vehicle.state.position;
      world.positions.set(owner, [s.x, s.y, s.z]);
    } else {
      world.positions.set(owner, entry.parked.body.pos);
    }
  }
  const owners = new Set();
  for (const [owner, pos] of world.positions) {
    if (world.isWrecked(owner)) continue;
    if (pos[1] <= waterLevel) {
      owners.add(owner);
      continue;
    }
    // Is there open water under this (x, z) at all? The body's own height is
    // the reference the deck query needs (see `WorldCollider.surfaceHeight`):
    // a tank on a bridge over a river is standing on the span, not in the
    // water, and a tank in the river UNDER the same span is in the water —
    // which the raster this replaced could not tell apart, because it lifted
    // the surface at an (x, z) for everyone.
    const surface = collider.surfaceHeight(pos[0], pos[2], pos[1]);
    if (Math.abs(surface - waterLevel) >= 0.01) continue;
    // ...and does the hull actually reach it? This second half is the whole
    // of the altitude test, and without it the answer above was the final
    // one: `surfaceHeight` is a function of x and z, so a plane at 400 m over
    // the sea read as "in water" and HP-5's drowning tick took
    // `hpLostWhileDamageFromWater` off it every second — 10 HP/s for every
    // vanilla aircraft, which kills a 100 HP Corsair over Wake in ten
    // seconds of ordinary flight with nothing shooting at it. `touchesWater`
    // is the engine's own geometric rule (collision-response §7).
    const entry = world.bodyWorld?.get(owner);
    // Furniture registered by position alone has no hull to test; its origin
    // is the only geometry there is, and the `<= waterLevel` test above has
    // already asked about it.
    if (entry && touchesWater(entry, pos[1], waterLevel)) owners.add(owner);
  }
  return owners;
}
