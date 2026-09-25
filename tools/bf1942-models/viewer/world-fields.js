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
  // Seated, the target is the hull — the supply radius reaches the vehicle,
  // and `workOnVehicles` depots (Wake's two airplane depots on the airstrip,
  // the vehicle ammoboxes) rearm its guns — with the hull's own Armor so a
  // depot that ships a repair rate would heal it. Dismounted, the target is
  // the soldier as before. Both take the same 0.5 s cadence on one shared
  // depot clock: whichever kind the player is is the kind the depots see.
  if (!player.soldier) return;
  if (player.occupancy?.root) {
    const hull = world.occupiedDamageable(player.id);
    // A wreck's depots are done with it (the engine's giveDamage on a
    // destroyed object is a no-op for the same reason).
    if (!hull || hull.destroyed) return;
    const pos = player.vehicle?.state?.position;
    const at = pos ?? player.position;
    if (!at) return;
    player.supplyResult = world.supplyField.tick(dt, {
      x: at.x, y: at.y, z: at.z,
      team: player.supply.team ?? player.team,
      armor: hull.armor,
      // The hull's refill: every FireArms node this seat can fire — the
      // drivetrain's own guns plus the active seat's manned ones — back to
      // a full magazine and its spares. The same "refill fully"
      // approximation the on-foot kit refill stands on (SUP-8, SUP-23),
      // and the world owns the states, so no page hook is needed. The
      // depot's give sound is the on-foot kit's page closure; a hull's
      // rearm is silent here (its SoundScript never shipped an in-view
      // path — open, not approximated).
      refillAmmo: () => {
        for (const group of [...player.groups, ...player.manned]) {
          const state = world.fireStateFor(group.node);
          if (!state.unlimited) state.reset();
        }
      },
      vehicle: true,
    });
    return;
  }
  if (!player.armor) return;
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
