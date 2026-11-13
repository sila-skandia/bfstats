// The two area fields of a tick: the combat area's out-of-bounds damage, per
// player, and the supply depots' heal, rearm and repair, once for the whole
// world. Plain functions of the `World` (world.js), called from its tick.

import { ammoTypeOf, rearmTypeFor } from './fire-state.js';

export { rearmTypeFor };

/** A soldier's object origin stands 1.0 m over his feet (PHY-10: the five
 *  contact vertices of `SkeletonCollisionMeshTemplate`, the lowest at
 *  y = -1, `ResponsePhysics::checkVsTerrain` 0x0825a960), and a depot's reach
 *  is measured to his origin (`workOnSoldiers` 0x08323dc0 takes the soldier's
 *  `getAbsolutePosition`, vt+0x38, at 0x08323e67, SUP-23). `soldier-pose.js`
 *  `CHARACTER_HEIGHT` is the same number; a module of its own here keeps this
 *  file free of imports the test harnesses would have to copy. */
export const SOLDIER_ORIGIN_OVER_FEET = 1.0;

export function combatTick(world, player, dt) {
  if (!world.combatArea.active) {
    player.combat = null;
    return false;
  }
  // One accumulator per player (player+0x178), keyed by his id: a bot standing
  // inside zeroes ITS OWN timer, not the local player's.
  const area = world.combatArea;
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
      area.release(player.id);
      return false;
    }
  } else if (soldier && !player.armor?.destroyed) {
    x = soldier.x;
    z = soldier.z;
  } else {
    player.combat = null;
    area.release(player.id);
    return false;
  }
  const frame = area.step(dt, x, z, combatMaterial(world, x, z), player.id);
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

/**
 * The world's one depot pass of a tick (`SupplyField.update`): each depot's
 * own 0.5 s clock of world time paces it (SUP-4), not this call rate, and a
 * depot whose cycle comes due works on every soldier and every hull in reach
 * at once, as `SupplyDepot::update` runs `workOnSoldiers` and
 * `workOnVehicles` (SUP-18, SUP-19). The old pass ran once per player against
 * one shared clock, so with bots in the world each depot served whichever
 * player happened to be ticked when its cycle came due, and a hull nobody sat
 * in was never repaired at all.
 *
 * A player's `supplyResult` is what this tick's cycles did for him: on foot,
 * for his soldier; seated, for his hull (each of its crew reads the same) and
 * for his soldier when the depot rides that hull (SUP-20).
 */
export function supplyFieldTick(world, dt) {
  for (const player of world.players.values()) {
    const r = player.supplyResult;
    if (r) { r.gaveAmmo = false; r.healed = false; }
  }
  const field = world.supplyField;
  if (!field?.depots.length) return;
  field.update(dt, {
    soldiers: () => supplySoldiers(world),
    hulls: () => supplyHulls(world),
  }, depot => depotSuspended(world, depot));
}

/** Every living soldier a depot could work on: on foot, or seated (served
 *  only by a depot riding his own hull, `root`). */
function supplySoldiers(world) {
  const out = [];
  for (const player of world.players.values()) {
    if (!player.soldier || !player.armor || player.armor.destroyed) continue;
    const root = player.occupancy?.root ?? null;
    if (root) {
      // A seated soldier is the SeatObject's child (`SeatObject::enter`, SEAT-37),
      // so his absolute position is the seat object's; the PlayerControlObject
      // the registry publishes is the hull's origin for a half-track's rear
      // seats. Hanomag's depot (radius 1.4, 1.46 m from the hull origin) only
      // reaches its passengers from their seats (0.55 to 1.32 m). A seat with
      // no SeatObject has the PlayerControlObject for a parent.
      const at = seatBodyAt(player.occupancy, _seatBody) ?? player.position;
      if (!at) continue;
      out.push({
        x: at[0], y: at[1], z: at[2],
        team: player.supply.team ?? player.team,
        armor: player.armor,
        refillAmmo: player.supply.refillAmmo,
        root,
        results: [player.supplyResult],
      });
    } else {
      const target = supplyTarget(world, player);
      target.results = [player.supplyResult];
      out.push(target);
    }
  }
  return out;
}

/** Every hull a depot could work on: each living root PlayerControlObject the
 *  world registered, crewed or not, at its body's position, on its crew's
 *  side (0 empty, SEAT-27) and named by its root template, which a depot's
 *  `addVehicleType` rows are matched against. */
function supplyHulls(world) {
  const crews = new Map();
  for (const player of world.players.values()) {
    const root = player.occupancy?.root;
    if (!root) continue;
    const owner = world.nodeOwners.get(root);
    if (owner === undefined) continue;
    let crew = crews.get(owner);
    if (!crew) crews.set(owner, crew = []);
    crew.push(player);
  }
  const out = [];
  for (const vehicle of world.vehicleDamage.values()) {
    if (!vehicle.isPco || vehicle.destroyed || world.isWrecked(vehicle.owner)) continue;
    const at = hullPosition(world, vehicle.owner);
    if (!at) continue;
    const crew = crews.get(vehicle.owner) ?? null;
    const lead = crew?.[0] ?? null;
    out.push({
      x: at[0], y: at[1], z: at[2],
      team: lead ? (lead.supply.team ?? lead.team) : 0,
      template: vehicle.template,
      armor: vehicle.armor,
      vehicle: true,
      // The hull's rearm: every FireArms node its crew can fire (each
      // occupant's drivetrain guns and manned ones) takes its ammo type's
      // units of this cycle through `FireState.rearm` (SUP-8): spare
      // magazines back, a one-magazine gun topped up, the loaded magazine of
      // any other left to its own reload. Refilling the whole state here
      // (`reset()`, until 2026-10-19) gave a B17 parked on El Alamein's
      // airfield its eight bombs back within half a second of dropping
      // them. An empty hull's guns keep the state they were left in: the
      // world holds no seat's guns until someone takes it. The rearm is
      // silent here (its SoundScript never shipped an in-view path -- open,
      // not approximated).
      refillAmmo: crew ? types => {
        const seen = new Set();
        // Each gun's depot tag (SUP-2): its own words, else the tree's
        // `damage.json` table by template name, else the engine's 0.
        const table = world.damageTables?.ammoTypes ?? null;
        for (const p of crew) {
          for (const group of [...p.groups, ...p.manned]) {
            if (seen.has(group.node)) continue;
            seen.add(group.node);
            const state = world.fireStateFor(group.node);
            const type = rearmTypeFor(state.stats, types,
              ammoTypeOf(state.stats, group.node?.name, table));
            if (type) state.rearm(type.units);
          }
        }
      } : null,
      results: crew ? crew.map(p => p.supplyResult) : [],
    });
  }
  return out;
}

/** Where a hull is now: its body (driven or parked), else where it was
 *  registered (a gun or a static hull with no body). */
function hullPosition(world, owner) {
  const entry = world.bodyWorld?.entries?.get(owner);
  if (entry?.driven) {
    const s = entry.driven.vehicle.state.position;
    return [s.x, s.y, s.z];
  }
  if (entry?.parked) return entry.parked.body.pos;
  return world.positions.get(owner) ?? null;
}

/** A depot riding a hull stops with it (`update`'s first test, SUP-19), and
 *  is not there at all while its hull is not: a pad has not stood it up, or
 *  the end of the round took it off the field (`level-statics.js`
 *  `markAbsent`, `vehicle-wrecks.js` `clearWorld`). */
function depotSuspended(world, depot) {
  if (!depot.root) return false;
  if (depot.root.userData?.padAbsent || depot.root.userData?.cleared) return true;
  const owner = world.nodeOwners.get(depot.root);
  if (owner === undefined) return false;
  return !!world.vehicleDamage.get(owner)?.destroyed;
}

const _seatBody = [0, 0, 0];

/** Where the soldier of an occupied seat is: the active seat's SeatObject, in
 *  world space, into `out`; null when the seat has none (the caller falls back
 *  to the seat's PlayerControlObject). Read only on a cycle that came due. */
export function seatBodyAt(occ, out) {
  const seat = occ?.seatInfo?.(occ.activeSeatId);
  const node = seat?.seatObjects?.[0];
  if (!node?.updateWorldMatrix) return null;
  node.updateWorldMatrix(true, false);
  const e = node.matrixWorld.elements;
  out[0] = e[12]; out[1] = e[13]; out[2] = e[14];
  return out;
}

export function supplyTarget(world, player) {
  return {
    x: player.soldier.x,
    y: player.soldier.y + SOLDIER_ORIGIN_OVER_FEET,
    z: player.soldier.z,
    team: player.supply.team ?? player.team,
    armor: player.armor,
    refillAmmo: player.supply.refillAmmo,
  };
}
