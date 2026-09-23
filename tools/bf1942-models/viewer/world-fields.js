// The two area fields a player stands in each tick: the combat area's
// out-of-bounds damage and the supply depots' heal and rearm. Plain
// functions of the `World` (world.js), called from its tick.

export function combatTick(world, player, dt) {
  if (!world.combatArea.active) {
    player.combat = null;
    return false;
  }
  const soldier = player.soldier;
  const occ = player.occupancy;
  let x, z;
  if (occ?.root) {
    if (player.vehicle) {
      x = player.vehicle.state.position.x;
      z = player.vehicle.state.position.z;
    } else if (player.position) {
      x = player.position[0];
      z = player.position[2];
    } else {
      player.combat = null;
      return false;
    }
  } else if (soldier && !player.armor?.destroyed) {
    x = soldier.x;
    z = soldier.z;
  } else {
    player.combat = null;
    return false;
  }
  const frame = world.combatArea.step(dt, x, z,
    combatMaterial(world, x, z));
  if (frame.damage > 0) {
    if (occ?.root) {
      const hull = world.occupiedDamageable(player.id);
      // A wreck has already died; the engine's own giveDamage on a
      // destroyed object is a no-op for the same reason.
      if (hull && !hull.destroyed) hull.damage(frame.damage);
    } else if (player.armor) {
      player.armor.applyDamage(frame.damage);
    }
  }
  player.combat = frame;
  return true;
}

/** The terrain material id under a world position, for the combat area's
 *  second test (CA-5) -- the page's own `combatMaterial` glue. */
export function combatMaterial(world, x, z) {
  const field = world.collider?.heightfield;
  if (!field || !field.materials) return null;
  return field.material(x, z);
}

export function supplyTick(world, player, dt) {
  // The tick law of the page's old hook, moved whole: the depot's 0.5 s
  // self-throttle (SUP-11) is what paces the give/heal, not this call rate.
  if (!player.soldier || !player.armor) return;
  player.supplyResult = world.supplyField.tick(dt, supplyTarget(world, player));
}

export function supplyTarget(world, player) {
  return {
    x: player.soldier.x,
    y: player.soldier.y,
    z: player.soldier.z,
    team: player.supply.team ?? player.team,
    armor: player.armor,
    refillAmmo: player.supply.refillAmmo,
  };
}
